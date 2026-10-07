const axios = require("axios")
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const Payment = require("../models/payment")
const Event = require("../models/event")
const { HttpError } = require("../../shared/errors")
const { hash, serviceOptions } = require("../../shared/utils")
const orders = () => `${process.env.ORDER_SERVICE_URI || "http://localhost:5003"}/internal/orders`
const lookupOrder = async (id) => (await axios.get(`${orders()}/${encodeURIComponent(id)}`, serviceOptions())).data
const assertIntent = (payment, intent) => {
  if ((payment.stripePaymentIntentId && payment.stripePaymentIntentId !== intent.id) ||
      intent.metadata?.paymentId !== String(payment._id) || intent.metadata?.orderId !== payment.orderId ||
      intent.amount !== payment.amount || intent.currency !== payment.currency) throw new Error("Stripe intent does not match persisted payment")
}
const reconcile = async (payment, intent) => {
  assertIntent(payment, intent)
  const status = intent.status === "succeeded" ? "Succeeded" : intent.status === "canceled" ? "Cancelled" : "Pending"
  await Payment.updateOne({ _id: payment._id, status: { $nin: ["Succeeded", "Cancelled"] } }, {
    status, stripePaymentIntentId: intent.id, needsSync: ["Succeeded", "Cancelled"].includes(status),
  })
  payment = await Payment.findById(payment._id)
  if (payment.needsSync) {
    const operation = payment.status === "Succeeded" ? "paid" : "cancel-payment"
    await axios.put(`${orders()}/${payment.orderId}/${operation}`, {
      paymentId: String(payment._id), amountMinor: payment.amount, currency: payment.currency,
    }, serviceOptions())
    await Payment.updateOne({ _id: payment._id, status: payment.status }, { needsSync: false })
  }
  return payment
}
const ensureIntent = async (payment) => {
  if (payment.stripePaymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId)
    await reconcile(payment, intent)
    return intent
  }
  try {
    await axios.put(`${orders()}/${payment.orderId}/claim-payment`, { paymentId: String(payment._id) }, serviceOptions())
  } catch (err) {
    if (err.response?.status === 409) {
      const order = await lookupOrder(payment.orderId)
      if (["Releasing", "Cancelled", "Failed"].includes(order.status)) {
        await Payment.updateOne({ _id: payment._id, status: "Creating" }, { status: "Cancelled", needsSync: false })
      }
    }
    throw err
  }
  // Stripe may expire request keys after 24h. Never recreate an ambiguous old attempt.
  if (Date.now() - payment.createdAt.getTime() > 23 * 60 * 60 * 1000) {
    await Payment.updateOne({ _id: payment._id, stripePaymentIntentId: { $exists: false } }, { status: "Review" })
    throw new HttpError(409, "Payment requires provider reconciliation; no new charge was attempted")
  }
  const intent = await stripe.paymentIntents.create({
    amount: payment.amount, currency: payment.currency, payment_method: payment.paymentMethodId,
    // Confirmation occurs only after the intent ID is durably persisted.
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { paymentId: String(payment._id), orderId: payment.orderId },
  }, { idempotencyKey: `create-${payment._id}` })
  assertIntent(payment, intent)
  await Payment.updateOne({ _id: payment._id, status: { $in: ["Creating", "Review"] } }, { stripePaymentIntentId: intent.id, status: "Pending" })
  return intent
}
const begin = async (user, orderId, key, method) => {
  const order = await lookupOrder(orderId)
  if (order.userId !== user.userId && user.role !== "admin") throw new HttpError(403, "Access denied")
  orderId = String(order._id)
  if (!Number.isSafeInteger(order.amountMinor) || order.amountMinor <= 0 || order.currency !== "npr") throw new HttpError(409, "Order has no payable price snapshot")
  const fingerprint = hash({ orderId, method })
  let payment = await Payment.findOne({ orderId })
  if (!payment) {
    if (order.status !== "Pending") throw new HttpError(409, "Order cannot be paid")
    try {
      payment = await Payment.create({ orderId, userId: order.userId, idempotencyKey: key, fingerprint,
        amount: order.amountMinor, currency: order.currency, paymentMethodId: method })
    } catch (err) {
      if (err.code !== 11000) throw err
      payment = await Payment.findOne({ orderId })
      if (!payment) throw new HttpError(409, "Idempotency key already used for another order")
    }
  }
  if (payment.fingerprint !== fingerprint || payment.idempotencyKey !== key) throw new HttpError(409, "Order already has a payment; reuse original request or existing client secret")
  const intent = await ensureIntent(payment)
  // Client confirms this single existing intent using Stripe.js, including any SCA step.
  return { payment: await Payment.findById(payment._id), clientSecret: intent.client_secret }
}
const cancel = async (payment) => {
  const current = await ensureIntent(payment)
  if (current.status === "succeeded") throw new HttpError(409, "Payment already succeeded; refund requires a separate operation")
  if (current.status === "canceled") return Payment.findById(payment._id)
  let cancelled
  try { cancelled = await stripe.paymentIntents.cancel(current.id, {}, { idempotencyKey: `cancel-${payment._id}` }) }
  catch (err) {
    // A concurrent confirmation can win; reconcile provider truth before returning.
    await reconcile(payment, await stripe.paymentIntents.retrieve(current.id))
    throw new HttpError(409, "Provider could not cancel payment; retry after reconciliation")
  }
  return reconcile(payment, cancelled)
}
const processEvent = async (event) => {
  if (event.processed) return
  const intent = await stripe.paymentIntents.retrieve(event.intentId)
  const paymentId = intent.metadata?.paymentId
  const payment = /^[a-f0-9]{24}$/i.test(paymentId || "") ? await Payment.findById(paymentId) : null
  if (payment) await reconcile(payment, intent)
  await Event.updateOne({ _id: event._id }, { processed: true })
}
const webhook = async (raw, signature) => {
  let signed
  try { signed = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET) }
  catch { throw new HttpError(400, "Invalid webhook signature") }
  if (!signed.type.startsWith("payment_intent.")) return
  let event
  try { event = await Event.create({ _id: signed.id, intentId: signed.data.object.id }) }
  catch (err) { if (err.code !== 11000) throw err; event = await Event.findById(signed.id) }
  await processEvent(event)
}
const recover = async () => {
  const events = await Event.find({ processed: false }).sort({ updatedAt: 1 }).limit(100)
  for (const event of events) {
    try { await processEvent(event) } catch (err) {
      await Event.updateOne({ _id: event._id }, { updatedAt: new Date() })
      console.error("Webhook recovery pending", { eventId: event._id, code: err.code })
    }
  }
  const payments = await Payment.find({ $or: [{ status: "Creating" }, { status: "Pending" }, { needsSync: true }] }).sort({ updatedAt: 1 }).limit(100)
  for (const payment of payments) {
    try {
      if (payment.status === "Pending" && Date.now() - payment.createdAt.getTime() > 30 * 60 * 1000) await cancel(payment)
      else await ensureIntent(payment)
    } catch (err) {
      await Payment.updateOne({ _id: payment._id }, { updatedAt: new Date() })
      console.error("Payment recovery pending", { paymentId: String(payment._id), code: err.code })
    }
  }
}
module.exports = { cancel, begin, webhook, recover, ensureIntent, reconcile, processEvent, lookupOrder }
