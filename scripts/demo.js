const path = require("node:path")
const fs = require("node:fs")
const http = require("node:http")
const { randomBytes } = require("node:crypto")
const root = path.resolve(__dirname, "..")
fs.mkdirSync(path.join(root, ".cache"), { recursive: true })
const load = (name) => require(path.join(root, name))
const { MongoMemoryReplSet } = load("node_modules/mongodb-memory-server")
process.env.JWT_SECRET = randomBytes(32).toString("hex")
process.env.SERVICE_TOKEN = randomBytes(32).toString("hex")
process.env.STRIPE_SECRET_KEY = "sk_test_local_simulator"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_simulator"
const intents = new Map(), keys = new Map(), messages = []
const stripePath = require.resolve(path.join(root, "payment-service/node_modules/stripe"))
const RealStripe = require(stripePath)
const webhooks = new RealStripe("sk_test_local_simulator").webhooks
require.cache[stripePath].exports = () => ({ webhooks, paymentIntents: {
  create: async (params, options) => {
    if (keys.has(options.idempotencyKey)) return intents.get(keys.get(options.idempotencyKey))
    const id = `pi_demo_${intents.size + 1}`
    const intent = { ...params, id, status: "requires_confirmation", client_secret: `${id}_demo_only` }
    intents.set(id, intent); keys.set(options.idempotencyKey, id); return intent
  },
  retrieve: async (id) => { if (!intents.has(id)) throw new Error("Demo intent missing"); return intents.get(id) },
  cancel: async (id) => { const intent = intents.get(id); if (intent.status === "succeeded") throw new Error("Already paid"); intent.status = "canceled"; return intent },
} })
for (const [file, kind] of [["emailService", "email"], ["smsService", "sms"]]) {
  const filename = require.resolve(path.join(root, `notification-service/services/${file}.js`))
  require.cache[filename] = { id: filename, filename, loaded: true, exports: async (...args) => { messages.push({ kind, args, at: new Date().toISOString() }); console.log(`SIMULATED ${kind}: saved to demo outbox`) } }
}
const serviceNames = ["user-service", "product-service", "shopping-cart-service", "order-service", "payment-service", "notification-service"]
const dbNames = ["users", "products", "carts", "orders", "payments"]
const dbs = serviceNames.slice(0,5).map(name => load(`${name}/node_modules/mongoose`))
const User = load("user-service/models/user")
const Product = load("product-service/models/product")
const models = [User, Product, load("product-service/models/reservation"), load("shopping-cart-service/models/cart"), load("order-service/models/order"), load("payment-service/models/payment"), load("payment-service/models/event")]
const jwt = load("user-service/node_modules/jsonwebtoken")
const services = {}, servers = [], stops = []
let repl, demoUser, demoAdmin
const json = (res, code, value) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(value, null, 2)) }
const token = (user) => jwt.sign({ userId: String(user._id), role: user.role }, process.env.JWT_SECRET, { algorithm: "HS256", issuer: "ecommerce-users", audience: "ecommerce-api", expiresIn: "1h" })
const api = async (service, endpoint, method = "GET", body, headers = {}) => {
  const response = await fetch(services[service] + endpoint, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let result; try { result = JSON.parse(text) } catch { result = text }
  if (!response.ok) throw new Error(`${service} ${response.status}: ${JSON.stringify(result)}`)
  return result
}

const handler = async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1:8081").pathname
  if (req.headers.origin && !["http://127.0.0.1:8081", "http://localhost:8081"].includes(req.headers.origin)) return json(res, 403, { error: "Local origin required" })
  if (pathname === "/" && req.method === "GET") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(path.join(root, "demo/index.html"))) }
  if (pathname === "/demo/status") {
    const states = await Promise.all(serviceNames.map(async name => ({ service: name, ...await api(name, "/health/ready") })))
    return json(res, 200, { mode: "LOCAL DEMO - providers simulated", services: states })
  }
  if (pathname === "/demo/outbox") return json(res, 200, { simulated: true, messages })
  if (pathname === "/demo/checkout" && req.method === "POST") {
    let raw = ""
    for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return json(res, 413, { error: "Request too large" }) }
    let body; try { body = JSON.parse(raw || "{}") } catch { return json(res, 400, { error: "Invalid checkout request" }) }
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20 || body.items.some(item => !item || typeof item.productId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) return json(res, 400, { error: "Choose products and quantities first" })
    const products = await Product.find({ deleted: false, stock: { $gte: 1 } })
    if (!products.length) return json(res, 409, { error: "Demo inventory exhausted" })
    const suffix = randomBytes(8).toString("hex")
    const headers = { Authorization: `Bearer ${token(demoUser)}`, "Idempotency-Key": `demo-order-${suffix}` }
    const order = await api("order-service", `/api/orders/${demoUser._id}`, "POST", { items: body.items }, headers)
    const payment = await api("payment-service", `/api/payments/${order._id}`, "POST", { paymentMethodId: "pm_local_demo" }, { ...headers, "Idempotency-Key": `demo-payment-${suffix}` })
    intents.get(payment.payment.stripePaymentIntentId).status = "succeeded"
    await load("payment-service/services/payments").recover()
    const paidOrder = await api("order-service", `/api/orders/${demoUser._id}/${order._id}`, "GET", undefined, headers)
    const notificationHeaders = { Authorization: `Bearer ${token(demoAdmin)}` }
    await api("notification-service", "/api/notification/email", "POST", { to: "customer@example.invalid", subject: "Demo order paid", text: `Demo order ${order._id} paid` }, notificationHeaders)
    await api("notification-service", "/api/notification/sms", "POST", { to: "+15555550123", message: `Demo order ${order._id} paid` }, notificationHeaders)
    return json(res, 200, { simulatedProviders: true, order: paidOrder, notificationsRecorded: 2 })
  }
  const prefixes = { "/api/users": "user-service", "/api/products": "product-service", "/api/cart": "shopping-cart-service", "/api/orders": "order-service", "/api/payments": "payment-service", "/api/notification": "notification-service" }
  const entry = Object.entries(prefixes).find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"))
  if (!entry) return json(res, 404, { error: "Route not found" })
  const destination = new URL(req.url, services[entry[1]])
  const upstream = http.request(destination, { method: req.method, headers: { ...req.headers, host: destination.host } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
  upstream.on("error", () => { if (!res.headersSent) json(res, 502, { error: "Demo service unavailable" }); else res.end() })
  req.pipe(upstream)
}
const shutdown = async () => {
  stops.forEach(stop => stop())
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  await Promise.all(dbs.map(db => db.disconnect()))
  if (repl) await repl.stop()
}
;(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, binary: { downloadDir: path.join(root, ".cache/mongodb") } })
  for (let i=0; i<dbs.length; i++) await dbs[i].connect(repl.getUri(`nexcart-demo-${dbNames[i]}`))
  await Promise.all(models.map(model => model.init()))
  demoUser = await User.create({ name: "Demo customer", email: "demo@nexcart.local", password: "NexCartDemo123!", role: "customer" })
  demoAdmin = await User.create({ name: "Demo admin", email: "admin@nexcart.local", password: "NexCartAdmin123!", role: "admin" })
  await Product.create([{ name: "Mechanical Keyboard", description: "Local demo keyboard", category: "Accessories", price: 2499, stock: 20 }, { name: "Wireless Mouse", description: "Local demo mouse", category: "Accessories", price: 899, stock: 20 }])
  for (let i=0; i<serviceNames.length; i++) {
    const name = serviceNames[i], app = load(`${name}/app`), db = dbs[i]
    app.get("/health/ready", (req,res) => res.json({ ok: !db || db.connection.readyState === 1 }))
    await new Promise((resolve,reject) => {
      const server = app.listen(0, "127.0.0.1", () => { servers.push(server); services[name] = `http://127.0.0.1:${server.address().port}`; resolve() })
      server.once("error", reject)
    })
  }
  process.env.PRODUCT_SERVICE_URI = services["product-service"]
  process.env.ORDER_SERVICE_URI = services["order-service"]
  const { startWorker } = load("shared/utils")
  stops.push(startWorker(load("order-service/services/saga").recover), startWorker(load("payment-service/services/payments").recover))
  await new Promise((resolve,reject) => {
    const server = http.createServer((req,res) => handler(req,res).catch(error => { console.error(error.message); if (!res.headersSent) json(res,500,{error:error.message}); else res.end() }))
    server.listen(8081,"127.0.0.1", () => { servers.push(server);resolve() })
    server.once("error",reject)
  })
  fs.writeFileSync(path.join(root, ".cache/storefront-runtime.json"), JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:8081", services, simulated: true }, null, 2))
  console.log("DEMO_READY http://127.0.0.1:8081")
  process.once("SIGTERM", () => shutdown().then(() => process.exit(0)))
  process.once("SIGINT", () => shutdown().then(() => process.exit(0)))
})().catch(async error => { console.error(error.message); await shutdown(); process.exit(1) })
