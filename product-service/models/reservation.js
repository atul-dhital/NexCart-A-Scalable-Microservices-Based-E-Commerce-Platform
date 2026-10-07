const mongoose = require("mongoose")
const schema = new mongoose.Schema({
  _id: { type: String },
  fingerprint: String,
  items: [{ productId: String, quantity: Number, unitAmount: Number }],
  amountMinor: Number,
  currency: { type: String, default: "npr" },
  status: { type: String, enum: ["Reserved", "Released", "Committed"], required: true },
}, { timestamps: true })
// Released tombstones are retained to reject delayed reserve requests.
module.exports = mongoose.model("Reservation", schema)
