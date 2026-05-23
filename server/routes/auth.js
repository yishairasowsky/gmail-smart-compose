const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const hash = await bcrypt.hash(password, 10);
  try {
    const stmt = db.prepare(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)"
    );
    const result = stmt.run(email.toLowerCase(), hash);
    const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, {
      expiresIn: "90d",
    });
    res.json({ token, plan: "free" });
  } catch (e) {
    if (e.message.includes("UNIQUE"))
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "90d" });
  res.json({ token, plan: user.plan });
});

module.exports = router;
