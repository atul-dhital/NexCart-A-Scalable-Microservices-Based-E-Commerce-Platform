const { test, before, beforeEach, after, mock } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const request = require("supertest")
const { MongoMemoryReplSet } = require("mongodb-memory-server")
process.env.JWT_SECRET = "test-jwt-secret-".repeat(4)
process.env.SERVICE_TOKEN = "test-service-secret-".repeat(4)
process.env.STRIPE_SECRET_KEY = "sk_test_integration"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration"
const mockIntents = new Map()
const mockKeys = new Map()
const mockProvider = {
  paymentIntents: {
    create: mock.fn(async (params, options) => {
      if (mockKeys.has(options.idempotencyKey)) return mockIntents.get(mockKeys.get(options.idempotencyKey))
      const id = `pi_${mockIntents.size + 1}`
      const intent = { ...params, id, status: "requires_confirmation", client_secret: `${id}_secret_test` }
      mockKeys.set(options.idempotencyKey, id)
      mockIntents.set(id, intent)
      return intent
    }),
    cancel: mock.fn(async (id) => {
      const intent = mockIntents.get(id)
      if (intent.status === "succeeded") throw new Error("Cannot cancel successful payment")
      intent.status = "canceled"
      return intent
    }),
    retrieve: mock.fn(async (id) => {
      if (!mockIntents.has(id)) throw new Error("Unknown intent")
      return mockIntents.get(id)
    }),
  },
}
const stripePath = require.resolve("../../payment-service/node_modules/stripe")
const ActualStripe = require(stripePath)
const realWebhooks = new ActualStripe("sk_test_integration").webhooks
require.cache[stripePath].exports = () => ({ ...mockProvider, webhooks: realWebhooks })
const jwt = require("../../user-service/node_modules/jsonwebtoken")
const userDb = require("../../user-service/node_modules/mongoose")
const productDb = require("../../product-service/node_modules/mongoose")
const orderDb = require("../../order-service/node_modules/mongoose")
const paymentDb = require("../../payment-service/node_modules/mongoose")
const cartDb = require("../../shopping-cart-service/node_modules/mongoose")
const Product = require("../../product-service/models/product")
const Reservation = require("../../product-service/models/reservation")
const Order = require("../../order-service/models/order")
const Payment = require("../../payment-service/models/payment")
const Event = require("../../payment-service/models/event")
const Cart = require("../../shopping-cart-service/models/cart")
const User = require("../../user-service/models/user")
const productApp = require("../../product-service/app")
const orderApp = require("../../order-service/app")
const paymentApp = require("../../payment-service/app")
const cartApp = require("../../shopping-cart-service/app")
const userApp = require("../../user-service/app")
const saga = require("../../order-service/services/saga")
const payments = require("../../payment-service/services/payments")
const userId = "1".repeat(24)
const otherId = "2".repeat(24)
const token = (id = userId, role = "customer", options = {}) => jwt.sign({ userId: id, role }, process.env.JWT_SECRET, {
  algorithm: "HS256", issuer: "ecommerce-users", audience: "ecommerce-api", expiresIn: "1h", ...options,
})
const auth = (call, id = userId, role = "customer") => call.set("Authorization", `Bearer ${token(id, role)}`)
const internal = (call) => call.set("X-Service-Token", process.env.SERVICE_TOKEN)
const product = (stock = 10) => Product.create({ name: "Test", description: "Desc", category: "test", price: 25.5, stock })
const place = (items, key = "order-key-0001") => auth(request(orderApp).post(`/api/orders/${userId}`)).set("Idempotency-Key", key).send({ items, totalAmount: 0.01 })
const pay = (id, key = "payment-key-0001") => auth(request(paymentApp).post(`/api/payments/${id}`)).set("Idempotency-Key", key).send({ paymentMethodId: "pm_test", amount: 1 })
let repl
const servers = []
before(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, binary: { downloadDir: path.resolve(__dirname, "../../.cache/mongodb") } })
  for (const [db, name] of [[userDb,"users"],[productDb,"products"],[orderDb,"orders"],[paymentDb,"payments"],[cartDb,"carts"]]) await db.connect(repl.getUri(name))
  await Promise.all([Product,Reservation,Order,Payment,Event,Cart,User].map((model) => model.init()))
  const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => { servers.push(server); resolve(`http://127.0.0.1:${server.address().port}`) })
  })
  process.env.PRODUCT_SERVICE_URI = await listen(productApp)
  process.env.ORDER_SERVICE_URI = await listen(orderApp)
})
beforeEach(async () => {
  await Promise.all([Product,Reservation,Order,Payment,Event,Cart,User].map((model) => model.deleteMany({})))
  mockIntents.clear(); mockKeys.clear(); 
})
after(async () => {
  mock.restoreAll()
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  await Promise.all([userDb,productDb,orderDb,paymentDb,cartDb].map((db) => db.disconnect()))
  if (repl) await repl.stop()
})
test("registration ignores requested admin role; issued token authenticates customer", async () => {
  const res = await request(userApp).post("/api/users/register").send({ name: "Tester", email: "test@example.com", password: "password123", role: "admin" })
  assert.equal(res.status, 200)
  assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET).role, "customer")
  const mutation = await request(productApp).post("/api/products/create").set("Authorization", `Bearer ${res.body.token}`).send({})
  assert.equal(mutation.status, 403)
})
test("unsigned, expired and wrong-audience tokens cannot read protected API", async () => {
  const endpoint = `/api/cart/${userId}`
  assert.equal((await request(cartApp).get(endpoint)).status, 401)
  assert.equal((await request(cartApp).get(endpoint).set("Authorization", "Bearer bogus")).status, 401)
  for (const options of [{ expiresIn: -1 }, { audience: "wrong" }]) {
    assert.equal((await request(cartApp).get(endpoint).set("Authorization", `Bearer ${token(userId, "customer", options)}`)).status, 401)
  }
})
test("customer cannot access another customer's cart or catalog mutations", async () => {
  assert.equal((await auth(request(cartApp).get(`/api/cart/${otherId}`))).status, 403)
  assert.equal((await auth(request(productApp).post("/api/products/create")).send({})).status, 403)
  const res = await auth(request(productApp).post("/api/products/create"), userId, "admin").send({ name: "New", description: "Desc", category: "test", price: 20, stock: 5 })
  assert.equal(res.status, 201)
})
test("multi-product shortage rolls back every deduction", async () => {
  const a = await product(5), b = await product(0)
  const res = await internal(request(productApp).put("/internal/inventory/reserve-1/reserve")).send({ items: [{ productId: String(a._id), quantity: 2 }, { productId: String(b._id), quantity: 1 }] })
  assert.equal(res.status, 409)
  assert.equal((await Product.findById(a._id)).stock, 5)
  assert.equal(await Reservation.countDocuments(), 0)
})
test("concurrent reservations cannot oversell", async () => {
  const a = await product(5)
  const responses = await Promise.all(["reserve-1", "reserve-2"].map((id) => internal(request(productApp).put(`/internal/inventory/${id}/reserve`)).send({ items: [{ productId: String(a._id), quantity: 4 }] })))
  assert.deepEqual(responses.map((r) => r.status).sort(), [200,409])
  assert.equal((await Product.findById(a._id)).stock, 1)
})
test("release is idempotent and blocks late reserve requests", async () => {
  const a = await product(5)
  const items = [{ productId: String(a._id), quantity: 2 }]
  assert.equal((await internal(request(productApp).put("/internal/inventory/reserve-1/reserve")).send({ items })).status, 200)
  for (let i=0;i<2;i++) assert.equal((await internal(request(productApp).put("/internal/inventory/reserve-1/release")).send({})).status, 200)
  assert.equal((await Product.findById(a._id)).stock, 5)
  assert.equal((await internal(request(productApp).put("/internal/inventory/reserve-1/reserve")).send({ items })).status, 409)
})
test("release-before-reserve creates durable cancellation tombstone", async () => {
  const a = await product(5)
  await internal(request(productApp).put("/internal/inventory/late/release")).send({})
  const res = await internal(request(productApp).put("/internal/inventory/late/reserve")).send({ items: [{ productId: String(a._id), quantity: 1 }] })
  assert.equal(res.status, 409)
  assert.equal((await Product.findById(a._id)).stock, 5)
})
test("order retry reuses ID and server price snapshot", async () => {
  const a = await product(10), items = [{ productId: String(a._id), quantity: 2 }]
  const first = await place(items), second = await place(items)
  assert.equal(first.status, 201); assert.equal(second.status, 200)
  assert.equal(first.body._id, second.body._id)
  assert.equal(first.body.amountMinor, 5100)
  assert.equal((await Product.findById(a._id)).stock, 8)
  assert.equal((await place([{ productId: String(a._id), quantity: 3 }])).status, 409)
})
test("recovery finishes order after reservation succeeds but order write fails", async () => {
  const a = await product(10)
  const originalUpdate = Order.updateOne
  let failed = false
  const failure = mock.method(Order, "updateOne", async function (...args) {
    if (!failed) { failed = true; throw new Error("simulated crash") }
    return originalUpdate.apply(this, args)
  })
  const res = await place([{ productId: String(a._id), quantity: 2 }])
  assert.equal(res.status, 202)
  assert.equal(res.body.status, "Reserving")
  failure.mock.restore()
  await saga.recover()
  const recovered = await Order.findById(res.body._id)
  assert.equal(recovered.status, "Pending")
  assert.equal((await Product.findById(a._id)).stock, 8)
})
test("order cancellation restores reserved stock once", async () => {
  const a = await product(10), res = await place([{ productId: String(a._id), quantity: 2 }])
  for (let i=0;i<2;i++) assert.equal((await auth(request(orderApp).post(`/api/orders/${userId}/${res.body._id}/cancel`)).send({})).status, 200)
  assert.equal((await Product.findById(a._id)).stock, 10)
  assert.equal((await Order.findById(res.body._id)).status, "Cancelled")
})
test("concurrent cart creation and increments preserve all accepted updates", async () => {
  const a = await product(100)
  const add = () => auth(request(cartApp).post(`/api/cart/${userId}/add`)).send({ productId: String(a._id), quantity: 1 })
  let responses = await Promise.all(Array.from({ length: 20 }, add))
  for (let round=0;round<10 && responses.some((r)=>r.status===409);round++) {
    responses = await Promise.all(responses.map((res) => res.status === 409 ? add() : Promise.resolve(res)))
  }
  assert.equal(responses.every((res) => res.status === 201), true)
  assert.equal(await Cart.countDocuments({ userId }), 1)
  assert.equal((await Cart.findOne({ userId })).items[0].quantity, 20)
})
test("payment uses order value; retries create one intent; foreign user denied", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 2 }])
  const denied = await auth(request(paymentApp).post(`/api/payments/${order.body._id}`), otherId).set("Idempotency-Key", "payment-key-other").send({ paymentMethodId: "pm_test" })
  assert.equal(denied.status, 403)
  const first = await pay(order.body._id), second = await pay(order.body._id)
  assert.equal(first.status, 200); assert.equal(second.status, 200)
  assert.equal(first.body.payment._id, second.body.payment._id)
  const caseVariant = await pay(order.body._id.toUpperCase())
  assert.equal(caseVariant.status, 200)
  assert.equal(caseVariant.body.payment._id, first.body.payment._id)
  assert.equal(mockIntents.size, 1)
  assert.equal([...mockIntents.values()][0].amount, 5100)
  assert.equal((await Order.findById(order.body._id)).status, "PaymentPending")
  assert.equal((await auth(request(orderApp).post(`/api/orders/${userId}/${order.body._id}/cancel`)).send({})).status, 409)
})
const signedWebhook = async (intentId, eventId = "evt_test") => {
  const sdk = new ActualStripe("sk_test_integration")
  const raw = JSON.stringify({ id: eventId, type: "payment_intent.succeeded", data: { object: { id: intentId } } })
  const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: process.env.STRIPE_WEBHOOK_SECRET })
  return request(paymentApp).post("/api/payments/webhook").set("Content-Type", "application/json").set("Stripe-Signature", signature).send(raw)
}
test("real webhook signature validation rejects altered raw payload", async () => {
  const res = await request(paymentApp).post("/api/payments/webhook").set("Stripe-Signature", "bogus").send({ id: "evt_fake" })
  assert.equal(res.status, 400)
})
test("duplicate signed webhook commits stock and order exactly once", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 2 }])
  const paid = await pay(order.body._id), intentId = paid.body.payment.stripePaymentIntentId
  mockIntents.get(intentId).status = "succeeded"
  assert.equal((await signedWebhook(intentId)).status, 200)
  assert.equal((await signedWebhook(intentId)).status, 200)
  assert.equal((await Order.findById(order.body._id)).status, "Paid")
  assert.equal((await Reservation.findById(order.body._id)).status, "Committed")
  assert.equal((await Product.findById(a._id)).stock, 8)
  assert.equal(await Event.countDocuments(), 1)
})
test("payment reconciliation worker handles missing webhook", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const paid = await pay(order.body._id)
  mockIntents.get(paid.body.payment.stripePaymentIntentId).status = "succeeded"
  await payments.recover()
  assert.equal((await Order.findById(order.body._id)).status, "Paid")
})
test("provider cancellation compensates stock", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const paid = await pay(order.body._id)
  mockIntents.get(paid.body.payment.stripePaymentIntentId).status = "canceled"
  await payments.recover()
  assert.equal((await Order.findById(order.body._id)).status, "Cancelled")
  assert.equal((await Product.findById(a._id)).stock, 10)
})

test("payment recovers unknown create result without a second intent", async (t) => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const original = Payment.updateOne
  let failed = false
  const failure = mock.method(Payment, "updateOne", async function (...args) {
    if (!failed && args[1].stripePaymentIntentId) { failed = true; throw new Error("response lost before persistence") }
    return original.apply(this, args)
  })
  t.after(() => failure.mock.restore())
  assert.equal((await pay(order.body._id)).status, 500)
  assert.equal(mockIntents.size, 1)
  failure.mock.restore()
  await payments.recover()
  assert.equal(mockIntents.size, 1)
  assert.equal((await pay(order.body._id)).status, 200)
})
test("webhook recovery retries failed order delivery from durable event", async (t) => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const paid = await pay(order.body._id), intentId = paid.body.payment.stripePaymentIntentId
  mockIntents.get(intentId).status = "succeeded"
  const client = require("../../payment-service/node_modules/axios")
  const original = client.put
  let failed = false
  const failure = mock.method(client, "put", async (...args) => {
    if (!failed && args[0].endsWith("/paid")) { failed = true; throw new Error("order offline") }
    return original(...args)
  })
  t.after(() => failure.mock.restore())
  assert.equal((await signedWebhook(intentId)).status, 500)
  assert.equal((await Event.findById("evt_test")).processed, false)
  assert.equal((await Payment.findById(paid.body.payment._id)).needsSync, true)
  failure.mock.restore()
  await payments.recover()
  assert.equal((await Event.findById("evt_test")).processed, true)
  assert.equal((await Order.findById(order.body._id)).status, "Paid")
})
test("payment versus cancellation race leaves one valid outcome", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const [paymentResponse, cancelResponse] = await Promise.all([
    pay(order.body._id), auth(request(orderApp).post(`/api/orders/${userId}/${order.body._id}/cancel`)).send({}),
  ])
  const persisted = await Order.findById(order.body._id)
  if (persisted.status === "Cancelled") {
    assert.equal(cancelResponse.status, 200)
    assert.equal(mockIntents.size, 0)
    assert.equal((await Product.findById(a._id)).stock, 10)
  } else {
    assert.equal(persisted.status, "PaymentPending")
    assert.equal(paymentResponse.status, 200)
    assert.equal(cancelResponse.status, 409)
    assert.equal((await Product.findById(a._id)).stock, 9)
  }
})
test("soft-deleted product remains compensatable", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  assert.equal((await auth(request(productApp).delete(`/api/products/${a._id}`), userId, "admin")).status, 200)
  assert.equal((await request(productApp).get(`/api/products/${a._id}`)).status, 404)
  assert.equal((await auth(request(orderApp).post(`/api/orders/${userId}/${order.body._id}/cancel`)).send({})).status, 200)
  assert.equal((await Product.findById(a._id)).stock, 10)
})

test("customer cancellation of pending intent compensates reservation", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const payment = await pay(order.body._id)
  const cancelled = await auth(request(paymentApp).post(`/api/payments/${payment.body.payment._id}/cancel`)).send({})
  assert.equal(cancelled.status, 200)
  assert.equal((await Order.findById(order.body._id)).status, "Cancelled")
  assert.equal((await Product.findById(a._id)).stock, 10)
})
test("expired unpaid order releases stock durably", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  await Order.updateOne({ _id: order.body._id }, { expiresAt: new Date(Date.now() - 1) })
  await saga.recover()
  assert.equal((await Order.findById(order.body._id)).status, "Cancelled")
  assert.equal((await Product.findById(a._id)).stock, 10)
})
test("expired payment is provider-cancelled before releasing inventory", async () => {
  const a = await product(), order = await place([{ productId: String(a._id), quantity: 1 }])
  const payment = await pay(order.body._id)
  await Payment.collection.updateOne({ _id: new paymentDb.Types.ObjectId(payment.body.payment._id) }, { $set: { createdAt: new Date(Date.now() - 31 * 60 * 1000) } })
  await payments.recover()
  assert.equal((await Order.findById(order.body._id)).status, "Cancelled")
  assert.equal((await Product.findById(a._id)).stock, 10)
})
