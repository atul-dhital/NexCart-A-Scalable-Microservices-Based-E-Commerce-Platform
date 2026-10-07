// Invoke actual route middleware/handler chain. Router-level authentication is
// covered separately by HTTP integration tests.
module.exports = async (router, method, path, input = {}) => {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method])
  if (!layer) throw new Error(`Missing route: ${method} ${path}`)
  const req = { params: {}, body: {}, headers: {}, user: { userId: "user", role: "customer" }, ...input }
  req.get = (name) => req.headers[name.toLowerCase()]
  const res = { statusCode: 200, headersSent: false }
  res.status = jest.fn((code) => { res.statusCode = code; return res })
  res.json = jest.fn((body) => { res.body = body; res.headersSent = true; return res })
  res.send = jest.fn((body) => { res.body = body; res.headersSent = true; return res })
  try {
    for (const step of layer.route.stack) {
      let continued = false
      await step.handle(req, res, (err) => { if (err) throw err; continued = true })
      if (!continued || res.headersSent) break
    }
  } catch (err) { require("../shared/errors").errorHandler(err, req, res, () => {}) }
  return res
}
