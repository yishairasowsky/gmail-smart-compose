const router = require("express").Router();
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const FREE_LIMIT = 20;

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

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getUsage(userId, action) {
  const month = currentMonth();
  const row = await db.get(
    "SELECT count FROM usage WHERE user_id=$1 AND action=$2 AND month=$3",
    [userId, action, month]
  );
  return row ? row.count : 0;
}

async function incrementUsage(userId, action) {
  const month = currentMonth();
  await db.run(
    `INSERT INTO usage (user_id, action, month, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id, action, month) DO UPDATE SET count = usage.count + 1`,
    [userId, action, month]
  );
}

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

async function getOrRecreateUser(req) {
  let user = await db.get("SELECT * FROM users WHERE id=$1", [req.user.userId]);
  if (!user && req.user.email) {
    user = await db.get("SELECT * FROM users WHERE email=$1", [req.user.email]);
    if (!user) {
      user = await db.get(
        "INSERT INTO users (email) VALUES ($1) RETURNING *",
        [req.user.email]
      );
    }
  }
  return user;
}

router.post("/polish", requireAuth, async (req, res) => {
  const user = await getOrRecreateUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });

  if (user.plan === "free" && await getUsage(user.id, "polish") >= FREE_LIMIT)
    return res.status(402).json({ error: `Free limit reached (${FREE_LIMIT}/month). Upgrade to continue.` });

  const { text, threadContext } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  const threadHint = threadContext
    ? `\n\nConversation thread for tone context (DO NOT include in output):\n---\n${threadContext}\n---`
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
    await incrementUsage(user.id, "polish");
    const remaining = user.plan === "free" ? FREE_LIMIT - await getUsage(user.id, "polish") : null;
    res.json({ result, remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/translate", requireAuth, async (req, res) => {
  const user = await getOrRecreateUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });

  if (user.plan === "free" && await getUsage(user.id, "translate") >= FREE_LIMIT)
    return res.status(402).json({ error: `Free limit reached (${FREE_LIMIT}/month). Upgrade to continue.` });

  const { text, targetLanguage } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  try {
    const result = await callClaude(
      `You are a translator. Translate the following text to ${targetLanguage || "Hebrew"}. ` +
      "Return ONLY the translated text, nothing else.",
      text
    );
    await incrementUsage(user.id, "translate");
    const remaining = user.plan === "free" ? FREE_LIMIT - await getUsage(user.id, "translate") : null;
    res.json({ result, remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/usage", requireAuth, async (req, res) => {
  const user = await getOrRecreateUser(req);
  if (!user) return res.status(401).json({ error: "User not found" });

  res.json({
    plan: user.plan,
    polish: await getUsage(user.id, "polish"),
    translate: await getUsage(user.id, "translate"),
    limit: user.plan === "free" ? FREE_LIMIT : null,
  });
});

module.exports = router;
