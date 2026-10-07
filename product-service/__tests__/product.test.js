const request = require("supertest")
const Product = require("../models/product")
const app = require("../app")
test.each([0, -1, 1.234])("rejects invalid product price %p", async (price) => {
  await expect(new Product({ name: "name", description: "desc", category: "cat", price }).validate()).rejects.toThrow()
})
test("catalog mutation requires authentication", async () => {
  expect((await request(app).post("/api/products/create").send({})).status).toBe(401)
})
test("inventory is internal and requires service credentials", async () => {
  expect((await request(app).put("/internal/inventory/order/reserve").send({ items: [] })).status).toBe(401)
})
