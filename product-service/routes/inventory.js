const router = require("express").Router()
const { service } = require("../../shared/auth")(require("jsonwebtoken"))
const inventory = require("../services/inventory")
router.use(service)
router.put("/:orderId/reserve", async (req, res) => res.json(await inventory.reserve(req.params.orderId, req.body.items)))
router.put("/:orderId/release", async (req, res) => res.json(await inventory.release(req.params.orderId)))
router.put("/:orderId/commit", async (req, res) => res.json(await inventory.commit(req.params.orderId)))
module.exports = router
