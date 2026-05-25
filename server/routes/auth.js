const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

router.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await db.get(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
      [email.toLowerCase(), hash]
    );
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "90d" });
    res.json({ token, plan: "free" });
  } catch (e) {
    if (e.message.includes("unique") || e.message.includes("duplicate"))
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = await db.get("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "90d" });
  res.json({ token, plan: user.plan });
});

router.post("/google", async (req, res) => {
  const { googleToken } = req.body;
  if (!googleToken) return res.status(400).json({ error: "No token provided" });

  try {
    const gResp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + googleToken },
    });
    if (!gResp.ok) return res.status(401).json({ error: "Invalid Google token" });

    const gUser = await gResp.json();
    const email = gUser.email?.toLowerCase();
    const googleId = gUser.sub;
    if (!email) return res.status(401).json({ error: "Could not get email from Google" });

    let user = await db.get("SELECT * FROM users WHERE email = $1", [email]);
    if (!user) {
      user = await db.get(
        "INSERT INTO users (email, google_id) VALUES ($1, $2) RETURNING *",
        [email, googleId]
      );
    } else if (!user.google_id) {
      await db.run("UPDATE users SET google_id = $1 WHERE id = $2", [googleId, user.id]);
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "90d" });
    res.json({ token, plan: user.plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
