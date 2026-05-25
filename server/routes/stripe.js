const router = require("express").Router();
const jwt = require("jsonwebtoken");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

function getStripe() {
  return require("stripe")(process.env.STRIPE_SECRET_KEY);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

router.post("/checkout", requireAuth, async (req, res) => {
  const stripe = getStripe();
  const user = await db.get("SELECT * FROM users WHERE id=$1", [req.user.userId]);
  if (!user) return res.status(401).json({ error: "User not found" });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: user.email,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/cancel`,
    metadata: { userId: String(user.id) },
  });

  res.json({ url: session.url });
});

router.post("/webhook", async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    await db.run(
      "UPDATE users SET plan='paid', stripe_customer_id=$1, stripe_subscription_id=$2 WHERE id=$3",
      [session.customer, session.subscription, session.metadata.userId]
    );
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    await db.run("UPDATE users SET plan='free' WHERE stripe_subscription_id=$1", [sub.id]);
  }

  res.json({ received: true });
});

module.exports = router;
