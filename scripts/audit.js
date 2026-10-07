const { spawnSync } = require("node:child_process")
const path = require("node:path")
const fs = require("node:fs")
const { root, services } = require("./env")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
fs.mkdirSync(path.join(root, ".cache", "audits"), { recursive: true })
let failed = false
for (const service of [".", ...services]) {
  const result = spawnSync(npm, ["audit", "--json", "--cache", path.join(root, ".npm-cache")], { cwd: path.join(root, service), encoding: "utf8", shell: process.platform === "win32" })
  let report
  try { report = JSON.parse(result.stdout) } catch { console.error(`${service}: audit failed`); failed = true; continue }
  fs.writeFileSync(path.join(root, ".cache", "audits", `${service === "." ? "workspace" : service}.json`), JSON.stringify(report, null, 2))
  if (!report.metadata) { console.error(`${service}: registry audit unavailable`); failed = true; continue }
  console.log(`${service}: ${JSON.stringify(report.metadata.vulnerabilities)}`)
  if (report.metadata.vulnerabilities.total > 0) failed = true
}
process.exit(failed ? 1 : 0)
