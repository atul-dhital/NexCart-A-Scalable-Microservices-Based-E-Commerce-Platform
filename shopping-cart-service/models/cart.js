const mongoose = require("mongoose")
const itemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
}, { _id: false })
const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  items: { type: [itemSchema], default: [] },
}, { optimisticConcurrency: true, timestamps: true })
module.exports = mongoose.model("Cart", schema)
