jest.mock("axios", () => ({ put: jest.fn() }))
jest.mock("../models/order", () => ({ updateOne: jest.fn(), findById: jest.fn(), find: jest.fn() }))
const axios = require("axios")
const Order = require("../models/order")
const { advance } = require("../services/saga")
const { items } = require("../../shared/utils")
let order
beforeEach(() => {
  jest.clearAllMocks()
  order = { _id: "order", status: "Reserving", items: [{ productId: "a".repeat(24), quantity: 2 }] }
  Order.updateOne.mockImplementation(async (filter, update) => { Object.assign(order, update) })
  Order.findById.mockImplementation(async () => order)
})
test("reservation snapshot supplies total", async () => {
  axios.put.mockResolvedValue({ data: { items: order.items, amountMinor: 5000, currency: "npr" } })
  const result = await advance(order)
  expect(result.status).toBe("Pending")
  expect(result.totalAmount).toBe(50)
})
test("rejected reservation triggers durable release", async () => {
  axios.put.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce({ data: {} })
  const result = await advance(order)
  expect(result.status).toBe("Failed")
  expect(axios.put.mock.calls[1][0]).toMatch(/release$/)
})
test("temporary failure retains recoverable order state", async () => {
  axios.put.mockRejectedValue(new Error("network"))
  await expect(advance(order)).rejects.toThrow("network")
  expect(order.status).toBe("Reserving")
})
test("repeated products combine deterministically", () => {
  expect(items([{ productId: "a".repeat(24), quantity: 2 }, { productId: "a".repeat(24), quantity: 3 }])).toEqual([{ productId: "a".repeat(24), quantity: 5 }])
})
test.each([undefined, [], [null], [{ productId: "a".repeat(24), quantity: -1 }]])("rejects malformed items %p", (input) => expect(() => items(input)).toThrow())
