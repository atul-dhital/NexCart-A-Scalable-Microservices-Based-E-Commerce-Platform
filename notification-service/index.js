require("dotenv").config()
const start = require("../shared/start")
const app = require("./app")
start({ app, port: 5005, required: ["NODEMAILER_EMAIL", "NODEMAILER_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] }).catch((err) => { console.error(err.message); process.exit(1) })
