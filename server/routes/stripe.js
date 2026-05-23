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

// Create Stripe checkout session
router.post("/checkout", requireAuth, async (req, res) => {
  const stripe = getStripe();
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: user.email,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_URL}/cancel`,
    metadata: { userId: String(user.id) },
  });

  res.json({ url: session.url });
});

// Stripe webhook — updates user plan on payment
router.post("/webhook", (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata.userId;
    db.prepare(
      "UPDATE users SET plan='paid', stripe_customer_id=?, stripe_subscription_id=? WHERE id=?"
    ).run(session.customer, session.subscription, userId);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    db.prepare(
      "UPDATE users SET plan='free' WHERE stripe_subscription_id=?"
    ).run(sub.id);
  }

  res.json({ received: true });
});

module.exports = router;
