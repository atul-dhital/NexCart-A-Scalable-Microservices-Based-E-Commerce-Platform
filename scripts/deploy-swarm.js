const { spawnSync } = require("node:child_process")
const { root, readEnv, validate } = require("./env")
const values = readEnv()
validate(values)
if (!process.env.IMAGE_PREFIX || !/^[a-f0-9]{40}$/.test(process.env.IMAGE_TAG || "")) throw new Error("Set IMAGE_PREFIX and immutable 40-character IMAGE_TAG commit SHA")
const manager = spawnSync("docker", ["info", "--format", "{{.Swarm.ControlAvailable}}"], { encoding: "utf8" })
if (manager.status !== 0 || manager.stdout.trim() !== "true") throw new Error("Deployment requires an actual Docker Swarm manager")
const result = spawnSync("docker", ["stack", "deploy", "--with-registry-auth", "-c", "docker-stack.yml", "ecommerce"], { cwd: root, env: { ...process.env, ...values, IMAGE_PREFIX: process.env.IMAGE_PREFIX, IMAGE_TAG: process.env.IMAGE_TAG }, stdio: "inherit" })
if (result.status !== 0) process.exit(result.status || 1)
const { services } = require("./env")
;(async () => {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const state = spawnSync("docker", ["stack", "services", "ecommerce", "--format", "{{.Name}} {{.Replicas}}"], { encoding: "utf8" })
    const counts = new Map((state.stdout || "").trim().split(/\r?\n/).map((line) => line.split(/\s+/)))
    const ready = services.every((service) => counts.get(`ecommerce_${service}`) === "3/3") && counts.get("ecommerce_nginx") === "1/1"
    if (ready) {
      const correct = services.every((service) => {
        const image = spawnSync("docker", ["service", "inspect", `ecommerce_${service}`, "--format", "{{.Spec.TaskTemplate.ContainerSpec.Image}}"], { encoding: "utf8" })
        const expected = `${process.env.IMAGE_PREFIX}/${service}:${process.env.IMAGE_TAG}`
        return image.status === 0 && (image.stdout.trim() === expected || image.stdout.trim().startsWith(`${expected}@`))
      })
      if (correct) { console.log("Swarm rollout complete"); return }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  throw new Error("Swarm rollout did not converge within 180 seconds")
})().catch((err) => { console.error(err.message); process.exitCode = 1 })
