jest.mock("nodemailer", () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn() })) }))
jest.mock("twilio", () => jest.fn(() => ({ messages: { create: jest.fn() } })))
const nodemailer = require("nodemailer")
const twilio = require("twilio")
const sendEmail = require("../services/emailService")
const sendSMS = require("../services/smsService")
const router = require("../routes/notification")
const invoke = require("../../tests/route-helper")
const transport = nodemailer.createTransport.mock.results[0].value
const client = twilio.mock.results[0].value
beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())
test("email service propagates provider failure", async () => {
  transport.sendMail.mockRejectedValue(new Error("provider unavailable"))
  await expect(sendEmail("to@example.com", "subject", "text")).rejects.toThrow("provider unavailable")
})
test("SMS service propagates provider failure", async () => {
  client.messages.create.mockRejectedValue(new Error("provider unavailable"))
  await expect(sendSMS("+1234567890", "text")).rejects.toThrow("provider unavailable")
})
test("email endpoint returns failure rather than false success", async () => {
  transport.sendMail.mockRejectedValue(new Error("provider unavailable"))
  const res = await invoke(router, "post", "/email", { body: { to: "to@example.com", subject: "subject", text: "text" } })
  expect(res.statusCode).toBe(500)
})
test("SMS endpoint returns failure rather than false success", async () => {
  client.messages.create.mockRejectedValue(new Error("provider unavailable"))
  const res = await invoke(router, "post", "/sms", { body: { to: "+1234567890", message: "text" } })
  expect(res.statusCode).toBe(500)
})
