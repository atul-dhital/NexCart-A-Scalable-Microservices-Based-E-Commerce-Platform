const mongoose = require("mongoose")
const argon2 = require("argon2")
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["customer", "admin"], default: "customer" },
})
schema.pre("save", async function () {
  if (this.isModified("password")) this.password = await argon2.hash(this.password)
})
module.exports = mongoose.model("User", schema)
