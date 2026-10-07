const Cart = require("../models/cart")
const { HttpError } = require("../../shared/errors")
const mutate = async (userId, change, create = false) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    let cart = await Cart.findOne({ userId })
    if (!cart) {
      if (!create) throw new HttpError(404, "Cart not found")
      cart = new Cart({ userId, items: [] })
    }
    change(cart)
    try { await cart.save(); return cart }
    catch (err) {
      if (err.name !== "VersionError" && err.code !== 11000) throw err
    }
  }
  throw new HttpError(409, "Concurrent cart update; retry request")
}
module.exports = { mutate }
