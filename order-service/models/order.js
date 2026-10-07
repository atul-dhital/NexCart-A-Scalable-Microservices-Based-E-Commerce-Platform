const mongoose = require("mongoose")
const schema = new mongoose.Schema({
  userId: { type: String, required: true },
  idempotencyKey: String,
  fingerprint: String,
  items: [{ productId: String, quantity: Number, unitAmount: Number }],
  totalAmount: { type: Number, min: 0 },
  amountMinor: { type: Number, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, default: "npr" },
  status: { type: String, enum: ["Reserving", "Pending", "PaymentPending", "Completing", "Paid", "Shipped", "Delivered", "Releasing", "Cancelled", "Failed"], default: "Reserving" },
  paymentId: String,
  expiresAt: Date,
  releaseResult: { type: String, enum: ["Cancelled", "Failed"] },
}, { timestamps: true })
schema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } })
schema.index({ status: 1, updatedAt: 1 })
schema.index({ status: 1, expiresAt: 1 })
module.exports = mongoose.model("Order", schema)
