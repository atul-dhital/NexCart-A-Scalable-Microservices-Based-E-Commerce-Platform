const mongoose = require("mongoose")
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0.01, validate: (value) =>
    Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 },
  description: { type: String, required: true },
  category: { type: String, required: true },
  stock: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  deleted: { type: Boolean, default: false },
})
module.exports = mongoose.model("Product", schema)
