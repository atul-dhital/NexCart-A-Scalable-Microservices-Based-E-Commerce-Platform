const express = require("express")
const app = express()
app.disable("x-powered-by")
app.use("/api/payments/webhook", require("./routes/webhook"))
app.use(express.json({ limit: "1mb" }))
app.use("/api/payments", require("./routes/payment"))
app.use(require("../shared/errors").errorHandler)
module.exports = app
