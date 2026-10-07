const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const YAML = require("yaml")
const { root, services, keys, validate } = require("../../scripts/env")
const render = require("../../scripts/k8s-manifests")
const fixture = Object.fromEntries(keys.map((key) => [key, key.startsWith("MONGO_URI") ? "mongodb://replica:27017/test?replicaSet=rs0" : "fixture-value-".repeat(4)]))
test("deployment renderer supplies every referenced secret and config key", () => {
  const documents = render(fixture, "registry/example", "a".repeat(40), "test", "registry-user", "registry-password")
  const secret = documents.find((doc) => doc.kind === "Secret" && doc.metadata.name === "ecommerce-secrets")
  const config = documents.find((doc) => doc.kind === "ConfigMap" && doc.metadata.name === "ecommerce-config")
  for (const service of services) {
    const deployment = documents.find((doc) => doc.kind === "Deployment" && doc.metadata.name === service)
    const container = deployment.spec.template.spec.containers[0]
    assert.equal(container.image, `registry/example/${service}:${"a".repeat(40)}`)
    assert.equal(deployment.metadata.namespace, "test")
    assert.equal(deployment.spec.template.spec.securityContext.runAsNonRoot, true)
    for (const env of container.env) {
      if (env.valueFrom.secretKeyRef) assert.ok(secret.data[env.valueFrom.secretKeyRef.key])
      if (env.valueFrom.configMapKeyRef) assert.ok(config.data[env.valueFrom.configMapKeyRef.key])
    }
    assert.deepEqual(deployment.spec.template.spec.imagePullSecrets, [{ name: "ecommerce-registry" }])
  }
})
test("Compose and Swarm reference required runtime variables and root build context", () => {
  const compose = YAML.parse(fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8"))
  const stack = YAML.parse(fs.readFileSync(path.join(root, "docker-stack.yml"), "utf8"))
  for (const service of services) {
    assert.equal(compose.services[service].build.context, ".")
    assert.ok(compose.services[service].environment.JWT_SECRET)
    assert.ok(compose.services[service].environment.SERVICE_TOKEN)
    assert.ok(stack.services[service].image.includes("${IMAGE_TAG}"))
    assert.equal(stack.services[service].deploy.replicas, 3)
  }
  assert.ok(compose.services.mongo.command.includes("--replSet"))
  assert.equal(compose.services.mongo.ports, undefined)
  assert.equal(stack.services.mongo, undefined)
})
test("incomplete or weak secrets fail before deployment", () => {
  assert.throws(() => validate({}), /Missing/)
  assert.throws(() => validate({ ...fixture, JWT_SECRET: "weak" }), /32/)
  assert.doesNotThrow(() => validate(fixture))
})
test("workflow and Kubernetes YAML parse successfully", () => {
  for (const name of fs.readdirSync(path.join(root, ".github/workflows"))) {
    const workflow = YAML.parse(fs.readFileSync(path.join(root, ".github/workflows", name), "utf8"))
    assert.ok(workflow.jobs)
  }
  assert.ok(YAML.parse(fs.readFileSync(path.join(root, "kustomization.yaml"), "utf8")).resources)
})
