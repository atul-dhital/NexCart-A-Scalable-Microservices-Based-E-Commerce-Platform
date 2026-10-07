const mongoose = require("mongoose")
const Product = require("../models/product")
const Reservation = require("../models/reservation")
const { HttpError } = require("../../shared/errors")
const { items: normalize, hash } = require("../../shared/utils")
const reserve = async (id, input) => {
  const items = normalize(input)
  const fingerprint = hash(items)
  return mongoose.connection.transaction(async (session) => {
    const existing = await Reservation.findById(id).session(session)
    if (existing) {
      if (existing.status === "Released") throw new HttpError(409, "Reservation already released")
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, "Reservation items changed")
      return existing
    }
    let amountMinor = 0
    const snapshots = []
    for (const item of items) {
      const product = await Product.findOneAndUpdate(
        { _id: item.productId, deleted: { $ne: true }, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } }, { returnDocument: "after", session }
      )
      if (!product) throw new HttpError(409, "Product unavailable or insufficient stock")
      const unitAmount = Math.round(product.price * 100)
      amountMinor += unitAmount * item.quantity
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new HttpError(400, "Invalid order value")
      snapshots.push({ ...item, unitAmount })
    }
    const [reservation] = await Reservation.create([{
      _id: id, fingerprint, items: snapshots, amountMinor, currency: "npr", status: "Reserved",
    }], { session })
    return reservation
  })
}
const release = async (id) => mongoose.connection.transaction(async (session) => {
  const reservation = await Reservation.findById(id).session(session)
  if (!reservation) {
    const [tombstone] = await Reservation.create([{ _id: id, status: "Released", items: [] }], { session })
    return tombstone
  }
  if (reservation.status === "Released") return reservation
  if (reservation.status === "Committed") throw new HttpError(409, "Committed inventory cannot be released")
  for (const item of reservation.items) {
    const result = await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } }, { session })
    if (result.matchedCount !== 1) throw new Error("Reserved product is missing")
  }
  reservation.status = "Released"
  await reservation.save({ session })
  return reservation
})
const commit = async (id) => {
  const reservation = await Reservation.findOneAndUpdate(
    { _id: id, status: "Reserved" }, { $set: { status: "Committed" } }, { returnDocument: "after" })
  if (reservation) return reservation
  const existing = await Reservation.findById(id)
  if (existing?.status === "Committed") return existing
  throw new HttpError(409, "No active reservation")
}
module.exports = { reserve, release, commit }
