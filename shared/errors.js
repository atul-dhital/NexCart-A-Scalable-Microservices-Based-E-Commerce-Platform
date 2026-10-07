class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status || (["CastError", "ValidationError"].includes(err.name) ? 400 : err.code === 11000 ? 409 : 500)
  if (status >= 500) console.error("Request failed", { name: err.name, code: err.code })
  res.status(status).json({ msg: status >= 500 ? "Service unavailable" : err.message })
}
module.exports = { HttpError, errorHandler }
