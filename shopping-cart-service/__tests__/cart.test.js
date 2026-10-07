const Cart = require("../models/cart")
const { mutate } = require("../services/cart")
afterEach(() => jest.restoreAllMocks())
test("cart item array persists and validates", async () => {
  const cart = new Cart({ userId: "user", items: [{ productId: "product", quantity: 2 }] })
  await expect(cart.validate()).resolves.toBeUndefined()
  expect(cart.toObject().items[0]).toMatchObject({ productId: "product", quantity: 2 })
})
test.each([0, -1, 1.5])("rejects quantity %p", async (quantity) => {
  await expect(new Cart({ userId: "user", items: [{ productId: "product", quantity }] }).validate()).rejects.toThrow()
})
test("version conflict reloads and reapplies increment", async () => {
  const stale = new Cart({ userId: "user", items: [{ productId: "product", quantity: 2 }] })
  const fresh = new Cart({ userId: "user", items: [{ productId: "product", quantity: 3 }] })
  jest.spyOn(Cart, "findOne").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
  jest.spyOn(stale, "save").mockRejectedValue({ name: "VersionError" })
  jest.spyOn(fresh, "save").mockResolvedValue(fresh)
  const result = await mutate("user", (cart) => { cart.items[0].quantity += 1 })
  expect(result.items[0].quantity).toBe(4)
})
test("new-cart duplicate key reloads winner", async () => {
  const existing = new Cart({ userId: "user", items: [{ productId: "product", quantity: 1 }] })
  jest.spyOn(Cart, "findOne").mockResolvedValueOnce(null).mockResolvedValueOnce(existing)
  jest.spyOn(Cart.prototype, "save").mockRejectedValueOnce({ code: 11000 }).mockResolvedValue(existing)
  const result = await mutate("user", (cart) => {
    if (cart.items.length) cart.items[0].quantity++
    else cart.items.push({ productId: "product", quantity: 1 })
  }, true)
  expect(result.items[0].quantity).toBe(2)
})
