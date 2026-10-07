const router = require("express").Router()
const Order = require("../models/order")
const saga = require("../services/saga")
const { authenticate, admin, owner } = require("../../shared/auth")(require("jsonwebtoken"))
const { HttpError } = require("../../shared/errors")
const { items: normalize, hash, idempotencyKey } = require("../../shared/utils")
router.use(authenticate)
router.post("/:userId", owner(), async (req, res) => {
  const items = normalize(req.body.items)
  const key = idempotencyKey(req)
  const fingerprint = hash(items)
  let created = false
  let order = await Order.findOne({ userId: req.params.userId, idempotencyKey: key })
  if (!order) {
    try {
      order = await Order.create({ userId: req.params.userId, items, idempotencyKey: key, fingerprint, status: "Reserving" })
      created = true
    } catch (err) {
      if (err.code !== 11000) throw err
      order = await Order.findOne({ userId: req.params.userId, idempotencyKey: key })
    }
  }
  if (order.fingerprint !== fingerprint) throw new HttpError(409, "Idempotency key reused with different items")
  try { order = await saga.advance(order) } catch { order = await Order.findById(order._id) }
  const code = ["Failed", "Cancelled"].includes(order.status) ? 409 : ["Reserving", "Releasing"].includes(order.status) ? 202 : created ? 201 : 200
  res.status(code).json(order)
})
router.get("/:userId", owner(), async (req, res) => res.json(await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 }).limit(100)))
router.get("/:userId/:orderId", owner(), async (req, res) => {
  const order = await Order.findOne({ _id: req.params.orderId, userId: req.params.userId })
  if (!order) throw new HttpError(404, "Order not found")
  res.json(order)
})
router.post("/:userId/:orderId/cancel", owner(), async (req, res) => {
  let order = await Order.findOneAndUpdate({ _id: req.params.orderId, userId: req.params.userId, status: "Pending" }, { status: "Releasing", releaseResult: "Cancelled" }, { returnDocument: "after" })
  if (!order) {
    order = await Order.findOne({ _id: req.params.orderId, userId: req.params.userId })
    if (!order) throw new HttpError(404, "Order not found")
    if (!["Releasing", "Cancelled"].includes(order.status)) throw new HttpError(409, "Order cannot be cancelled after payment starts")
  }
  try { order = await saga.advance(order) } catch { order = await Order.findById(order._id) }
  res.status(order.status === "Releasing" ? 202 : 200).json(order)
})
router.put("/:orderId/status", admin, async (req, res) => {
  const previous = { Shipped: "Paid", Delivered: "Shipped" }[req.body.status]
  if (!previous) throw new HttpError(400, "Only Shipped or Delivered fulfillment transitions are allowed")
  const order = await Order.findOneAndUpdate({ _id: req.params.orderId, status: previous }, { status: req.body.status }, { returnDocument: "after" })
  if (!order) throw new HttpError(409, "Invalid fulfillment transition")
  res.json(order)
})
module.exports = router
