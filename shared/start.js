const { errorHandler } = require("./errors")
module.exports = async ({ app, mongoose, models = [], port, recover, required = [], transactions = false }) => {
  for (const name of ["JWT_SECRET", "SERVICE_TOKEN", ...required]) {
    if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`)
  }
  for (const name of ["JWT_SECRET", "SERVICE_TOKEN"]) {
    if (process.env[name].length < 32) throw new Error(`${name} must contain at least 32 characters`)
  }
  app.get("/health/live", (req, res) => res.json({ ok: true }))
  app.get("/health/ready", (req, res) => {
    const ready = !mongoose || mongoose.connection.readyState === 1
    res.status(ready ? 200 : 503).json({ ok: ready })
  })
  app.use(errorHandler)
  if (mongoose) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
    if (transactions) {
      const topology = await mongoose.connection.db.admin().command({ hello: 1 })
      if (!topology.setName && topology.msg !== "isdbgrid") throw new Error("Inventory requires a MongoDB replica set or sharded cluster")
    }
    for (const model of models) await model.init()
  }
  const stopWorker = recover ? require("./utils").startWorker(recover) : () => {}
  const server = app.listen(process.env.PORT || port, () => console.log(`Service listening on ${process.env.PORT || port}`))
  const shutdown = () => {
    stopWorker()
    server.close(async () => { if (mongoose) await mongoose.disconnect(); process.exit(0) })
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
  return server
}
