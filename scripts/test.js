const { spawnSync } = require("node:child_process")
const path = require("node:path")
const { root, services } = require("./env")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
for (const service of services) {
  const result = spawnSync(npm, ["test"], { cwd: path.join(root, service), stdio: "inherit", shell: process.platform === "win32" })
  if (result.status !== 0) process.exit(result.status || 1)
}
const result = spawnSync(npm, ["run", "test:integration"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, MONGOMS_DOWNLOAD_DIR: path.join(root, ".cache", "mongodb") } })
process.exit(result.status === 0 ? 0 : 1)
