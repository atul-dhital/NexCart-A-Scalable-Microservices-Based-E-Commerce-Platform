const router = require("express").Router()
const Product = require("../models/product")
const { authenticate, admin } = require("../../shared/auth")(require("jsonwebtoken"))
const { HttpError } = require("../../shared/errors")
const fields = (body) => Object.fromEntries(["name", "description", "price", "category", "stock"]
  .filter((key) => body[key] !== undefined).map((key) => [key, body[key]]))
router.get("/", async (req, res) => res.json(await Product.find({ deleted: { $ne: true } })))
router.get("/:id", async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, deleted: { $ne: true } })
  if (!product) throw new HttpError(404, "Product not found")
  res.json(product)
})
router.post("/create", authenticate, admin, async (req, res) => res.status(201).json(await Product.create(fields(req.body))))
router.put("/:id", authenticate, admin, async (req, res) => {
  const product = await Product.findOneAndUpdate({ _id: req.params.id, deleted: { $ne: true } }, fields(req.body), { returnDocument: "after", runValidators: true })
  if (!product) throw new HttpError(404, "Product not found")
  res.json(product)
})
router.delete("/:id", authenticate, admin, async (req, res) => {
  // Keep the document so outstanding reservations can still be compensated.
  const product = await Product.findOneAndUpdate({ _id: req.params.id, deleted: { $ne: true } }, { deleted: true }, { returnDocument: "after" })
  if (!product) throw new HttpError(404, "Product not found")
  res.json({ msg: "Product deleted" })
})
module.exports = router
