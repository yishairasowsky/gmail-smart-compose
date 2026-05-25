require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRouter = require("./routes/auth");
const apiRouter = require("./routes/api");
const stripeRouter = require("./routes/stripe");

const app = express();

app.use(cors({ origin: "*" }));

// Stripe webhooks need raw body
app.use("/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.use("/auth", authRouter);
app.use("/api", apiRouter);
app.use("/stripe", stripeRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const db = require("./db");
const PORT = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch((err) => { console.error("DB init failed:", err); process.exit(1); });
