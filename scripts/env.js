const fs = require("node:fs")
const path = require("node:path")
const root = path.resolve(__dirname, "..")
const readEnv = () => {
  const values = {}
  const text = process.env.APP_ENV || (fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "")
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (!match) throw new Error("Invalid environment file line")
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return { ...values, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key in values)) }
}
const services = ["user-service", "product-service", "shopping-cart-service", "order-service", "payment-service", "notification-service"]
const keys = ["JWT_SECRET", "SERVICE_TOKEN", "MONGO_URI_USERS", "MONGO_URI_PRODUCTS", "MONGO_URI_CART", "MONGO_URI_ORDER", "MONGO_URI_PAYMENT", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NODEMAILER_EMAIL", "NODEMAILER_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
const validate = (values) => {
  for (const key of keys) if (!values[key]) throw new Error(`Missing environment value: ${key}`)
  for (const key of ["JWT_SECRET", "SERVICE_TOKEN"]) if (values[key].length < 32) throw new Error(`${key} must contain at least 32 characters`)
  for (const key of keys.filter((key) => key.startsWith("MONGO_URI"))) if (!/^mongodb(?:\+srv)?:\/\//.test(values[key])) throw new Error(`Invalid MongoDB URI: ${key}`)
}
module.exports = { root, services, keys, readEnv, validate }
