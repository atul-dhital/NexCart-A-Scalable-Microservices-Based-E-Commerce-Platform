const fs = require("node:fs")
const { randomUUID } = require("node:crypto")
const path = require("node:path")
const YAML = require("yaml")
const { root, services, keys } = require("./env")
module.exports = (values, prefix, tag, namespace, registryUser, registryPassword) => {
  const documents = [{ apiVersion: "v1", kind: "Secret", metadata: { name: "ecommerce-secrets", namespace }, type: "Opaque", data: Object.fromEntries(keys.map((key) => [key, Buffer.from(values[key]).toString("base64")])) }]
  if (registryUser && registryPassword) {
    const config = { auths: { "https://index.docker.io/v1/": { username: registryUser, password: registryPassword, auth: Buffer.from(`${registryUser}:${registryPassword}`).toString("base64") } } }
    documents.push({ apiVersion: "v1", kind: "Secret", metadata: { name: "ecommerce-registry", namespace }, type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": Buffer.from(JSON.stringify(config)).toString("base64") } })
  }
  documents.push(YAML.parse(fs.readFileSync(path.join(root, "deploy/configmap.yaml"), "utf8")))
  for (const service of services) {
    const deployment = YAML.parse(fs.readFileSync(path.join(root, service, "deployment.yaml"), "utf8"))
    deployment.spec.template.metadata.annotations = { "ecommerce/config-revision": randomUUID() }
    if (registryUser && registryPassword) deployment.spec.template.spec.imagePullSecrets = [{ name: "ecommerce-registry" }]
    deployment.spec.template.spec.containers[0].image = `${prefix}/${service}:${tag}`
    documents.push(deployment, YAML.parse(fs.readFileSync(path.join(root, service, "service.yaml"), "utf8")))
  }
  documents.push({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "ecommerce-gateway" }, data: { "nginx.conf": fs.readFileSync(path.join(root, "nginx.conf"), "utf8") } })
  documents.push(...YAML.parseAllDocuments(fs.readFileSync(path.join(root, "deploy/gateway.yaml"), "utf8")).map((doc) => doc.toJSON()))
  for (const document of documents) document.metadata.namespace = namespace
  return documents
}
