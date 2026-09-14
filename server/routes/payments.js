const express = require("express");
const router = express.Router();
const db = require("../db");

const PI_API_BASE = "https://api.minepi.com/v2";
const PI_API_KEY = process.env.PI_API_KEY || "";

function piHeaders() {
  return {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Pi calls this via onReadyForServerApproval — we must approve within
// a few seconds or the payment expires client-side.
router.post("/approve", async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: "paymentId required" });
  try {
    const r = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: "POST",
      headers: piHeaders(),
    });
    if (!r.ok) throw new Error(`Pi API approve failed: ${r.status}`);
    res.json({ approved: true });
  } catch (err) {
    console.error("payment approve error:", err.message);
    res.status(502).json({ error: "approval failed" });
  }
});

const LISTING_PERIOD_DAYS = 30;
const SPONSOR_PERIOD_DAYS = 30;

// Pi calls this via onReadyForServerCompletion once the txid is on chain.
// We complete the payment with Pi, then apply whichever effect this
// payment was for: a brand-new listing, a monthly renewal, or a sponsor
// (featured placement) upgrade. `paymentType` tells us which.
router.post("/complete", async (req, res) => {
  const { paymentId, txid, paymentType, restaurant, restaurantId } = req.body || {};
  if (!paymentId || !txid || !paymentType) {
    return res.status(400).json({ error: "paymentId, txid and paymentType are required" });
  }
  try {
    const r = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: "POST",
      headers: piHeaders(),
      body: JSON.stringify({ txid }),
    });
    if (!r.ok) throw new Error(`Pi API complete failed: ${r.status}`);

    // NOTE: for production, re-fetch the payment from Pi's API here and
    // check its `amount` and `metadata` match what you expect before
    // trusting client-supplied data — this applies to all three branches
    // below (restaurant payload, restaurantId, and the implied amount).
    if (paymentType === "new_listing") {
      if (!restaurant) return res.status(400).json({ error: "restaurant is required" });
      const record = db.insert({
        ...restaurant,
        source: "self_registered",
        status: "verified", // paid listings go live immediately as "self-listed"
        listing_paid: true,
        listing_tx_id: txid,
        listing_expires_at: new Date(Date.now() + LISTING_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      });
      return res.json({ id: record.id });
    }

    if (paymentType === "renewal") {
      if (!restaurantId) return res.status(400).json({ error: "restaurantId is required" });
      const record = db.extendExpiry(restaurantId, LISTING_PERIOD_DAYS);
      if (!record) return res.status(404).json({ error: "listing not found" });
      return res.json({ id: record.id, listing_expires_at: record.listing_expires_at });
    }

    if (paymentType === "sponsor") {
      if (!restaurantId) return res.status(400).json({ error: "restaurantId is required" });
      const record = db.extendSponsor(restaurantId, SPONSOR_PERIOD_DAYS);
      if (!record) return res.status(404).json({ error: "listing not found" });
      return res.json({ id: record.id, sponsored_until: record.sponsored_until });
    }

    return res.status(400).json({ error: `unknown paymentType "${paymentType}"` });
  } catch (err) {
    console.error("payment complete error:", err.message);
    res.status(502).json({ error: "completion failed" });
  }
});

// Handles Pi's onIncompletePaymentFound callback, forwarded from the client
// when a previous payment session was interrupted before completing.
router.post("/incomplete", async (req, res) => {
  const { payment } = req.body || {};
  if (!payment || !payment.identifier) return res.status(400).json({ error: "payment required" });
  try {
    if (payment.transaction && payment.transaction.txid) {
      await fetch(`${PI_API_BASE}/payments/${payment.identifier}/complete`, {
        method: "POST",
        headers: piHeaders(),
        body: JSON.stringify({ txid: payment.transaction.txid }),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("incomplete payment handling error:", err.message);
    res.status(502).json({ error: "failed" });
  }
});

module.exports = router;
