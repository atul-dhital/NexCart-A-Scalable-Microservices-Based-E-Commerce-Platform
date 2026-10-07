const router = require("express").Router()
const Payment = require("../models/payment")
const payments = require("../services/payments")
const { authenticate } = require("../../shared/auth")(require("jsonwebtoken"))
const { HttpError } = require("../../shared/errors")
const { idempotencyKey } = require("../../shared/utils")
router.use(authenticate)
router.post("/:orderId", async (req, res) => {
  const method = req.body.paymentMethodId
  if (typeof method !== "string" || !/^pm_[a-zA-Z0-9_]+$/.test(method)) throw new HttpError(400, "Invalid payment method ID")
  const result = await payments.begin(req.user, req.params.orderId, idempotencyKey(req), method)
  res.status(200).json(result)
})
router.post("/:paymentId/cancel", async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId)
  if (!payment) throw new HttpError(404, "Payment not found")
  if (payment.userId !== req.user.userId && req.user.role !== "admin") throw new HttpError(403, "Access denied")
  res.json(await payments.cancel(payment))
})
router.get("/order/:orderId", async (req, res) => {
  const order = await payments.lookupOrder(req.params.orderId)
  if (order.userId !== req.user.userId && req.user.role !== "admin") throw new HttpError(403, "Access denied")
  res.json(await Payment.find({ orderId: String(order._id) }).select("-paymentMethodId -fingerprint"))
})
router.get("/:paymentId", async (req, res) => {
  const payment = await Payment.findById(req.params.paymentId).select("-paymentMethodId -fingerprint")
  if (!payment) throw new HttpError(404, "Payment not found")
  if (payment.userId !== req.user.userId && req.user.role !== "admin") throw new HttpError(403, "Access denied")
  res.json(payment)
})
module.exports = router
