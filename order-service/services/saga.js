const axios = require("axios")
const Order = require("../models/order")
const { HttpError } = require("../../shared/errors")
const { serviceOptions } = require("../../shared/utils")
const base = () => `${process.env.PRODUCT_SERVICE_URI || "http://localhost:5001"}/internal/inventory`
const advance = async (order) => {
  if (order.status === "Reserving") {
    let reservation
    try {
      reservation = (await axios.put(`${base()}/${order._id}/reserve`, { items: order.items }, serviceOptions())).data
    } catch (err) {
      if (![400, 404, 409].includes(err.response?.status)) throw err
      await Order.updateOne({ _id: order._id, status: "Reserving" }, { status: "Releasing", releaseResult: "Failed" })
      return advance(await Order.findById(order._id))
    }
    await Order.updateOne({ _id: order._id, status: "Reserving" }, {
      status: "Pending", expiresAt: new Date(Date.now() + 15 * 60 * 1000), items: reservation.items, amountMinor: reservation.amountMinor,
      totalAmount: reservation.amountMinor / 100, currency: reservation.currency,
    })
  } else if (order.status === "Releasing") {
    await axios.put(`${base()}/${order._id}/release`, {}, serviceOptions())
    await Order.updateOne({ _id: order._id, status: "Releasing" }, { status: order.releaseResult || "Cancelled" })
  } else if (order.status === "Completing") {
    await axios.put(`${base()}/${order._id}/commit`, {}, serviceOptions())
    await Order.updateOne({ _id: order._id, status: "Completing" }, { status: "Paid" })
  }
  return Order.findById(order._id)
}
const recover = async () => {
  await Order.updateMany({ status: "Reserving", createdAt: { $lte: new Date(Date.now() - 15 * 60 * 1000) } }, { status: "Releasing", releaseResult: "Failed" })
  await Order.updateMany({ status: "Pending", expiresAt: { $lte: new Date() } }, { status: "Releasing", releaseResult: "Cancelled" })
  const orders = await Order.find({ status: { $in: ["Reserving", "Releasing", "Completing"] } }).sort({ updatedAt: 1 }).limit(100)
  for (const order of orders) {
    try { await advance(order) } catch (err) {
      await Order.updateOne({ _id: order._id }, { updatedAt: new Date() })
      console.error("Order recovery pending", { orderId: String(order._id), code: err.code })
    }
  }
}
const claimPayment = async (id, paymentId) => {
  const order = await Order.findOneAndUpdate({ _id: id, status: "Pending", expiresAt: { $gt: new Date() } }, { status: "PaymentPending", paymentId }, { returnDocument: "after" })
  if (order) return order
  const existing = await Order.findById(id)
  if (existing?.paymentId === paymentId && ["PaymentPending", "Completing", "Paid"].includes(existing.status)) return existing
  throw new HttpError(409, "Order cannot be paid")
}
const paid = async (id, paymentId, amountMinor, currency) => {
  const order = await Order.findOneAndUpdate({ _id: id, status: "PaymentPending", paymentId, amountMinor, currency }, { status: "Completing" }, { returnDocument: "after" })
  const existing = order || await Order.findById(id)
  if (!existing || existing.paymentId !== paymentId || existing.amountMinor !== amountMinor || existing.currency !== currency ||
      !["Completing", "Paid", "Shipped", "Delivered"].includes(existing.status)) throw new HttpError(409, "Payment does not match order")
  return advance(existing)
}
module.exports = { advance, recover, claimPayment, paid }
