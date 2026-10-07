jest.mock("stripe", () => jest.fn(() => ({ webhooks: { constructEvent: jest.fn() }, paymentIntents: { create: jest.fn(), retrieve: jest.fn() } })))
jest.mock("../models/payment", () => ({ updateOne: jest.fn(), findById: jest.fn(), findOne: jest.fn(), create: jest.fn() }))
jest.mock("axios", () => ({ get: jest.fn(), put: jest.fn() }))
const Payment = require("../models/payment")
const axios = require("axios")
const { begin, ensureIntent, webhook, reconcile } = require("../services/payments")
const stripe = require("stripe").mock.results[0].value
let payment
beforeEach(() => {
  jest.clearAllMocks()
  payment = { _id: "a".repeat(24), userId: "user", orderId: "order", amount: 2500, currency: "npr", paymentMethodId: "pm_test", status: "Creating", createdAt: new Date() }
  Payment.findById.mockImplementation(async () => payment)
  Payment.updateOne.mockImplementation(async (filter, update) => { Object.assign(payment, update) })
  axios.put.mockResolvedValue({ data: {} })
})
test("provider uses persisted amount and stable request key", async () => {
  stripe.paymentIntents.create.mockResolvedValue({ id: "pi_test", amount: 2500, currency: "npr", metadata: { paymentId: payment._id, orderId: "order" } })
  await ensureIntent(payment)
  expect(stripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500 }), { idempotencyKey: `create-${payment._id}` })
  expect(payment.stripePaymentIntentId).toBe("pi_test")
})
test("expired ambiguous creation fails closed", async () => {
  payment.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await expect(ensureIntent(payment)).rejects.toThrow("reconciliation")
  expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  expect(payment.status).toBe("Review")
})
test("foreign user cannot initiate payment", async () => {
  axios.get.mockResolvedValue({ data: { userId: "other" } })
  await expect(begin({ userId: "user", role: "customer" }, "order", "key12345", "pm_test")).rejects.toMatchObject({ status: 403 })
  expect(Payment.create).not.toHaveBeenCalled()
})
test("mismatched provider amount cannot mark order paid", async () => {
  await expect(reconcile(payment, { id: "pi_test", status: "succeeded", amount: 1, currency: "npr", metadata: { paymentId: payment._id, orderId: "order" } })).rejects.toThrow("does not match")
  expect(axios.put).not.toHaveBeenCalled()
})
test("invalid webhook signature is rejected", async () => {
  stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error("signature") })
  await expect(webhook(Buffer.from("{}"), "invalid")).rejects.toMatchObject({ status: 400 })
})
