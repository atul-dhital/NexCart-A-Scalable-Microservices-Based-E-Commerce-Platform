const express = require("express")
const app = express()
app.disable("x-powered-by")
app.use(express.json({ limit: "1mb" }))
app.use("/internal/orders", require("./routes/internal"))
app.use("/api/orders", require("./routes/order"))
app.use(require("../shared/errors").errorHandler)
module.exports = app
