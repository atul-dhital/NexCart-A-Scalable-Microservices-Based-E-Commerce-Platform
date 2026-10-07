const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const YAML = require("yaml")
const { root, services, keys, readEnv, validate } = require("./env")
if (process.env.GITHUB_ACTIONS === "true" && !process.env.KUBE_CONFIG_BASE64) throw new Error("Configure KUBE_CONFIG_BASE64 in production environment secrets")
const values = readEnv()
validate(values)
const namespace = process.env.DEPLOY_NAMESPACE || "ecommerce"
const prefix = process.env.IMAGE_PREFIX
const tag = process.env.IMAGE_TAG
if (!prefix || !/^[a-f0-9]{40}$/.test(tag || "")) throw new Error("Set IMAGE_PREFIX and immutable 40-character IMAGE_TAG commit SHA")
if (!/^[a-z0-9][a-z0-9-]*$/.test(namespace)) throw new Error("Invalid namespace")
let temporary
const env = { ...process.env }
if (process.env.KUBE_CONFIG_BASE64) {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ecommerce-kube-"))
  env.KUBECONFIG = path.join(temporary, "config")
  fs.writeFileSync(env.KUBECONFIG, Buffer.from(process.env.KUBE_CONFIG_BASE64, "base64"), { mode: 0o600 })
}
const run = (args, input) => {
  const result = spawnSync("kubectl", args, { env, input, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] })
  if (result.error || result.status !== 0) throw new Error(`kubectl ${args[0]} failed`)
}
try {
  run(["apply", "-f", "-"], YAML.stringify({ apiVersion: "v1", kind: "Namespace", metadata: { name: namespace } }))
  const documents = require("./k8s-manifests")(values, prefix, tag, namespace, process.env.DOCKER_USERNAME, process.env.DOCKER_PASSWORD)
  // Server-side apply avoids storing a second copy of secrets in last-applied annotations.
  run(["apply", "--server-side", "--field-manager=ecommerce-deploy", "-f", "-"], documents.map((doc) => YAML.stringify(doc)).join("---\n"))
  for (const service of [...services, "ecommerce-gateway"]) run(["rollout", "status", `deployment/${service}`, "-n", namespace, "--timeout=180s"])
} finally {
  if (temporary) { fs.unlinkSync(path.join(temporary, "config")); fs.rmdirSync(temporary) }
}
