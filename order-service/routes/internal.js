const router = require("express").Router()
const Order = require("../models/order")
const saga = require("../services/saga")
const { service } = require("../../shared/auth")(require("jsonwebtoken"))
const { HttpError } = require("../../shared/errors")
router.use(service)
router.get("/:orderId", async (req, res) => {
  const order = await Order.findById(req.params.orderId)
  if (!order) throw new HttpError(404, "Order not found")
  res.json(order)
})
router.put("/:orderId/claim-payment", async (req, res) => {
  if (typeof req.body.paymentId !== "string" || !/^[a-f0-9]{24}$/i.test(req.body.paymentId)) throw new HttpError(400, "Invalid payment ID")
  res.json(await saga.claimPayment(req.params.orderId, req.body.paymentId))
})
router.put("/:orderId/paid", async (req, res) => res.json(await saga.paid(req.params.orderId, req.body.paymentId, req.body.amountMinor, req.body.currency)))
router.put("/:orderId/cancel-payment", async (req, res) => {
  let order = await Order.findOneAndUpdate({ _id: req.params.orderId, status: "PaymentPending", paymentId: req.body.paymentId },
    { status: "Releasing", releaseResult: "Cancelled" }, { returnDocument: "after" })
  if (!order) {
    order = await Order.findById(req.params.orderId)
    if (!order || order.paymentId !== req.body.paymentId || !["Releasing", "Cancelled"].includes(order.status)) throw new HttpError(409, "Payment cancellation conflicts with order")
  }
  res.json(await saga.advance(order))
})
module.exports = router
