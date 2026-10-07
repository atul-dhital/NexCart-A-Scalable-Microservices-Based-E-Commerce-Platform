const { timingSafeEqual } = require("node:crypto")
module.exports = (jwt) => {
  const authenticate = (req, res, next) => {
    const match = /^Bearer ([^ ]+)$/i.exec(req.headers.authorization || "")
    if (!match || !process.env.JWT_SECRET) return res.status(401).json({ msg: "Authentication required" })
    try {
      const payload = jwt.verify(match[1], process.env.JWT_SECRET, {
        algorithms: ["HS256"], issuer: "ecommerce-users", audience: "ecommerce-api",
      })
      if (typeof payload.userId !== "string" || !["customer", "admin"].includes(payload.role)) throw new Error("Invalid claims")
      req.user = { userId: payload.userId, role: payload.role }
      next()
    } catch {
      res.status(401).json({ msg: "Invalid or expired token" })
    }
  }
  const admin = (req, res, next) => req.user?.role === "admin" ? next() : res.status(403).json({ msg: "Administrator required" })
  const owner = (parameter = "userId") => (req, res, next) =>
    req.user?.role === "admin" || req.user?.userId === req.params[parameter]
      ? next() : res.status(403).json({ msg: "Access denied" })
  const service = (req, res, next) => {
    const expected = Buffer.from(process.env.SERVICE_TOKEN || "")
    const supplied = Buffer.from(req.headers["x-service-token"] || "")
    if (expected.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ msg: "Service authentication required" })
    }
    next()
  }
  const adminOrService = (req, res, next) => {
    if (req.headers["x-service-token"]) return service(req, res, next)
    authenticate(req, res, () => admin(req, res, next))
  }
  return { authenticate, admin, owner, service, adminOrService }
}
