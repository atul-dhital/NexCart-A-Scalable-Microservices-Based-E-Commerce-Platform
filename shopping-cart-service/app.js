const express = require("express")
const app = express()
app.disable("x-powered-by")
app.use(express.json({ limit: "1mb" }))
app.use("/api/cart", require("./routes/cart"))
app.use(require("../shared/errors").errorHandler)
module.exports = app
