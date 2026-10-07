const mongoose = require("mongoose")
const schema = new mongoose.Schema({
  _id: String,
  intentId: { type: String, required: true },
  processed: { type: Boolean, default: false },
}, { timestamps: true })
schema.index({ processed: 1, updatedAt: 1 })
module.exports = mongoose.model("WebhookEvent", schema)
