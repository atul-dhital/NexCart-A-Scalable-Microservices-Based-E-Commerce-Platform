const mongoose = require("mongoose")
const schema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true },
  paymentMethodId: { type: String, required: true },
  paymentMethod: { type: String, default: "stripe" },
  status: { type: String, enum: ["Creating", "Pending", "Succeeded", "Cancelled", "Review"], default: "Creating" },
  stripePaymentIntentId: { type: String, unique: true, sparse: true },
  needsSync: { type: Boolean, default: false },
}, { timestamps: true })
schema.index({ userId: 1, idempotencyKey: 1 }, { unique: true })
schema.index({ status: 1, updatedAt: 1 })
module.exports = mongoose.model("Payment", schema)
