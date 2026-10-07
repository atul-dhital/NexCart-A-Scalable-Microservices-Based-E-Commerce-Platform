const express = require("express")
const User = require("../models/user")
const argon2 = require("argon2")
const jwt = require("jsonwebtoken")

const router = express.Router()

// Register a new user
router.post("/register", async (req, res) => {
  try {
    const { name, password } = req.body
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : req.body.email

    if (typeof name !== "string" || !name.trim() ||
        typeof email !== "string" || !email.trim() ||
        typeof password !== "string" || password.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid name/email and password of at least 8 characters are required" })
    }

    let user = await User.findOne({ email })
    if (user) {
      return res.status(400).json({ error: "User already exists" })
    }

    user = new User({ name, email, password, role: "customer" })
    await user.save()

    const token = jwt.sign({ userId: String(user._id), role: user.role || "customer" }, process.env.JWT_SECRET, {
      algorithm: "HS256", issuer: "ecommerce-users", audience: "ecommerce-api",
      expiresIn: "1h",
    })
    res.json({ token })
  } catch (error) {
    res.status(500).json({ error: "Server error" })
  }
})

// Login a user
router.post("/login", async (req, res) => {
  try {
    const { password } = req.body
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : req.body.email

    if (typeof email !== "string" || !email.trim() ||
        typeof password !== "string" || !password) {
      return res.status(400).json({ msg: "Email and password are required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" })
    }

    const isMatch = await argon2.verify(user.password, password)
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" })

    const token = jwt.sign({ userId: String(user._id), role: user.role || "customer" }, process.env.JWT_SECRET, {
      algorithm: "HS256", issuer: "ecommerce-users", audience: "ecommerce-api",
      expiresIn: "1h",
    })

    res.json({ token })
  } catch (error) {
    res.status(500).json({ error: "Server error" })
  }
})

module.exports = router
