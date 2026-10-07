const { createHash } = require("node:crypto")
const { HttpError } = require("./errors")
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const items = (input) => {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) throw new HttpError(400, "Supply 1 to 100 order items")
  const quantities = new Map()
  for (const item of input) {
    if (!item || typeof item.productId !== "string" || !/^[a-f0-9]{24}$/i.test(item.productId) ||
        !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new HttpError(400, "Invalid product ID or quantity")
    const id = item.productId.toLowerCase()
    const quantity = (quantities.get(id) || 0) + item.quantity
    if (!Number.isSafeInteger(quantity)) throw new HttpError(400, "Quantity too large")
    quantities.set(id, quantity)
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }))
}
const idempotencyKey = (req) => {
  const key = req.get("Idempotency-Key")
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new HttpError(400, "Supply Idempotency-Key (8-128 letters, numbers, underscores or hyphens)")
  return key
}
const serviceOptions = () => ({ headers: { "X-Service-Token": process.env.SERVICE_TOKEN }, timeout: 10000 })
const startWorker = (work, milliseconds = 5000) => {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await work() } catch (err) { console.error("Recovery pending", { name: err.name, code: err.code }) }
    finally { running = false }
  }
  const timer = setInterval(tick, milliseconds)
  timer.unref()
  tick()
  return () => clearInterval(timer)
}
module.exports = { hash, items, idempotencyKey, serviceOptions, startWorker }
