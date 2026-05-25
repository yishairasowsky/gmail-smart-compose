const router = require("express").Router();
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const FREE_LIMIT = 20;

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please log in again" });
  }
}

// ---------------------------------------------------------------------------
// Usage helpers
// ---------------------------------------------------------------------------

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getUsage(userId, action) {
  const month = currentMonth();
  const row = db
    .prepare("SELECT count FROM usage WHERE user_id=? AND action=? AND month=?")
    .get(userId, action, month);
  return row ? row.count : 0;
}

function incrementUsage(userId, action) {
  const month = currentMonth();
  db.prepare(`
    INSERT INTO usage (user_id, action, month, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, action, month) DO UPDATE SET count = count + 1
  `).run(userId, action, month);
}

// ---------------------------------------------------------------------------
// AI proxy
// ---------------------------------------------------------------------------

async function callClaude(systemPrompt, userContent) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${err}`);
  }
  const json = await resp.json();
  return json.content[0].text;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post("/polish", requireAuth, async (req, res) => {
  let user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.userId);
  if (!user && req.user.email) {
    user = db.prepare("SELECT * FROM users WHERE email=?").get(req.user.email);
    if (!user) {
      const r = db.prepare("INSERT INTO users (email) VALUES (?)").run(req.user.email);
      user = db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid);
    }
  }
  if (!user) return res.status(401).json({ error: "User not found" });

  if (user.plan === "free" && getUsage(user.id, "polish") >= FREE_LIMIT) {
    return res.status(402).json({
      error: `Free limit reached (${FREE_LIMIT}/month). Upgrade to continue.`,
      upgrade: true,
    });
  }

  const { text, threadContext } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  const threadHint = threadContext
    ? `\n\nHere is the prior conversation thread for tone context (DO NOT include any of this in your output):\n---\n${threadContext}\n---`
    : "";

  try {
    const result = await callClaude(
      "You are a writing assistant. Polish the given text: fix spelling, grammar, and punctuation. " +
        "Make it clear, professional, and well-worded. " +
        "Preserve the original language — do not translate. " +
        "Preserve the user's intent exactly — do not add, remove, or change the meaning. " +
        "No matter how short or incomplete the text looks, just polish it as-is. Never ask questions or add commentary. " +
        "Return ONLY the polished text, nothing else.",
      text + threadHint
    );
    incrementUsage(user.id, "polish");
    const remaining = user.plan === "free"
      ? FREE_LIMIT - getUsage(user.id, "polish")
      : null;
    res.json({ result, remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/translate", requireAuth, async (req, res) => {
  let user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.userId);
  if (!user && req.user.email) {
    user = db.prepare("SELECT * FROM users WHERE email=?").get(req.user.email);
    if (!user) {
      const r = db.prepare("INSERT INTO users (email) VALUES (?)").run(req.user.email);
      user = db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid);
    }
  }
  if (!user) return res.status(401).json({ error: "User not found" });

  if (user.plan === "free" && getUsage(user.id, "translate") >= FREE_LIMIT) {
    return res.status(402).json({
      error: `Free limit reached (${FREE_LIMIT}/month). Upgrade to continue.`,
      upgrade: true,
    });
  }

  const { text, targetLanguage } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  try {
    const result = await callClaude(
      `You are a translator. Translate the following text to ${targetLanguage || "English"}. ` +
        "Return ONLY the translated text, nothing else.",
      text
    );
    incrementUsage(user.id, "translate");
    const remaining = user.plan === "free"
      ? FREE_LIMIT - getUsage(user.id, "translate")
      : null;
    res.json({ result, remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/usage", requireAuth, (req, res) => {
  let user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.userId);
  if (!user && req.user.email) {
    user = db.prepare("SELECT * FROM users WHERE email=?").get(req.user.email);
    if (!user) {
      const r = db.prepare("INSERT INTO users (email) VALUES (?)").run(req.user.email);
      user = db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid);
    }
  }
  if (!user) return res.status(401).json({ error: "User not found" });

  res.json({
    plan: user.plan,
    polish: getUsage(user.id, "polish"),
    translate: getUsage(user.id, "translate"),
    limit: user.plan === "free" ? FREE_LIMIT : null,
  });
});

module.exports = router;
