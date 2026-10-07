const express = require("express")
const app = express()
app.disable("x-powered-by")
app.use(express.json({ limit: "1mb" }))
app.use("/internal/inventory", require("./routes/inventory"))
app.use("/api/products", require("./routes/product"))
app.use(require("../shared/errors").errorHandler)
module.exports = app
