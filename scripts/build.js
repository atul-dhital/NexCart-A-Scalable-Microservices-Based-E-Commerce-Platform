const { spawnSync } = require("node:child_process")
const path = require("node:path")
const { root, services } = require("./env")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const run = (exe, args, cwd = root) => {
  const result = spawnSync(exe, args, { cwd, stdio: "inherit", shell: process.platform === "win32" && exe === npm })
  if (result.error) { console.error(result.error.message); process.exit(1) }
  if (result.status !== 0) process.exit(result.status || 1)
}
for (const service of services) run(npm, ["ci", "--no-fund", "--cache", path.join(root, ".npm-cache")], path.join(root, service))
run(npm, ["test"])
const docker = spawnSync("docker", ["info"], { stdio: "ignore" })
if (docker.error || docker.status !== 0) {
  console.error("Dependency rebuild and tests complete. Docker image rebuild blocked: install/start Docker Engine or Docker Desktop.")
  process.exit(1)
}
for (const service of services) run("docker", ["build", "--pull", "-f", `${service}/Dockerfile`, "-t", `${process.env.IMAGE_PREFIX || "ecommerce"}/${service}:${process.env.IMAGE_TAG || "local"}`, "."])
