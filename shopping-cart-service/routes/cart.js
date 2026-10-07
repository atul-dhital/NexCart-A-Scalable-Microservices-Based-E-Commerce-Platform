const router = require("express").Router()
const axios = require("axios")
const Cart = require("../models/cart")
const { mutate } = require("../services/cart")
const { authenticate, owner } = require("../../shared/auth")(require("jsonwebtoken"))
const { HttpError } = require("../../shared/errors")
router.use(authenticate)
const quantity = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new HttpError(400, "Quantity must be a positive integer")
}
router.post("/:userId/add", owner(), async (req, res) => {
  quantity(req.body.quantity)
  const productId = req.body.productId
  if (typeof productId !== "string" || !/^[a-f0-9]{24}$/i.test(productId)) throw new HttpError(400, "Invalid product ID")
  const canonicalId = productId.toLowerCase()
  try { await axios.get(`${process.env.PRODUCT_SERVICE_URI || "http://localhost:5001"}/api/products/${canonicalId}`, { timeout: 5000 }) }
  catch (err) { if (err.response?.status === 404) throw new HttpError(404, "Product not found"); throw err }
  const cart = await mutate(req.params.userId, (cart) => {
    const item = cart.items.find((item) => item.productId === canonicalId)
    if (item) {
      const total = item.quantity + req.body.quantity
      quantity(total)
      item.quantity = total
    } else cart.items.push({ productId: canonicalId, quantity: req.body.quantity })
  }, true)
  res.status(201).json(cart)
})
router.get("/:userId", owner(), async (req, res) => {
  const cart = await Cart.findOne({ userId: req.params.userId })
  if (!cart) throw new HttpError(404, "Cart not found")
  res.json(cart)
})
router.delete("/:userId/remove/:productId", owner(), async (req, res) => res.json(await mutate(req.params.userId, (cart) => {
  cart.items = cart.items.filter((item) => item.productId !== req.params.productId.toLowerCase())
})))
router.put("/:userId/update/:productId", owner(), async (req, res) => {
  quantity(req.body.quantity)
  res.json(await mutate(req.params.userId, (cart) => {
    const item = cart.items.find((item) => item.productId === req.params.productId.toLowerCase())
    if (!item) throw new HttpError(404, "Product not found in cart")
    item.quantity = req.body.quantity
  }))
})
module.exports = router
