const router = require("express").Router()
router.post("/", require("express").raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  await require("../services/payments").webhook(req.body, req.get("Stripe-Signature"))
  res.json({ received: true })
})
module.exports = router
