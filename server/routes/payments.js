const express = require("express");
const router = express.Router();
const db = require("../db");

const PI_API_BASE = "https://api.minepi.com/v2";
const PI_API_KEY = process.env.PI_API_KEY || "";

const LISTING_PERIOD_DAYS = 180; // 6 months
const SPONSOR_PERIOD_DAYS = 30;

// Prices are fixed here, on the server. The amount the browser passes to
// Pi.createPayment() is never trusted: every payment is re-fetched from
// Pi's API and must match this table before we approve or complete it.
const PRICES_PI = { new_listing: 1, renewal: 1, sponsor: 2 };

// Payment IDs this process has already finalized (extra guard against a
// double "complete" request creating two effects; Pi's own
// developer_completed flag is the durable check).
const finalizedPayments = new Set();

function piHeaders() {
  return {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchPayment(paymentId) {
  const r = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: piHeaders(),
  });
  if (!r.ok) throw new Error(`Pi API get payment failed: ${r.status}`);
  return r.json();
}

// Returns a short error message if the payment is not a valid payment for
// this app, or null if it is fine. `payment` always comes from Pi's API.
function validatePayment(payment) {
  const type = payment && payment.metadata && payment.metadata.type;
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(PRICES_PI, type)) {
    return "unknown payment type";
  }
  if (payment.direction && payment.direction !== "user_to_app") return "wrong payment direction";
  if (Number(payment.amount) !== PRICES_PI[type]) return "unexpected amount";
  const s = payment.status || {};
  if (s.cancelled || s.user_cancelled) return "payment was cancelled";
  return null;
}

function cleanString(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanStringList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string")
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

// Only these fields are copied from the browser-supplied restaurant data.
// Anything else (status, sponsored_until, id, ...) is dropped.
function sanitizeRestaurant(input) {
  const r = input && typeof input === "object" ? input : {};
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  const website = cleanString(r.website, 300);
  return {
    name: cleanString(r.name, 100),
    name_en: cleanString(r.name_en, 100),
    address: cleanString(r.address, 200),
    cuisine: cleanString(r.cuisine, 100),
    phone: cleanString(r.phone, 50),
    // Only http(s) links: blocks "javascript:" and similar schemes.
    website: /^https?:\/\//i.test(website) ? website : "",
    hours: cleanString(r.hours, 300),
    menu_highlights: cleanStringList(r.menu_highlights, 30, 200),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    accepted_currencies: cleanStringList(r.accepted_currencies, 20, 30),
    submitted_by: cleanString(r.submitted_by, 100),
  };
}

// Apply what this payment was for. All data comes from the payment as
// stored at Pi (metadata), never from the request body.
async function applyPaymentEffect(payment, txid) {
  const type = payment.metadata.type;

  if (type === "new_listing") {
    const restaurant = sanitizeRestaurant(payment.metadata.restaurant);
    if (!restaurant.name || !restaurant.address) {
      return { status: 400, body: { error: "restaurant name and address are required" } };
    }
    if (restaurant.lat === null || restaurant.lng === null) {
      return { status: 400, body: { error: "restaurant location is required" } };
    }
    const record = await db.insert({
      ...restaurant,
      source: "self_registered",
      status: "verified", // paid listings go live immediately as "self-listed"
      listing_paid: true,
      listing_tx_id: txid,
      listing_expires_at: new Date(Date.now() + LISTING_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    return { status: 200, body: { id: record.id } };
  }

  const restaurantId = payment.metadata.restaurantId;
  if (typeof restaurantId !== "string" || !restaurantId) {
    return { status: 400, body: { error: "restaurantId is required" } };
  }

  if (type === "renewal") {
    const record = await db.extendExpiry(restaurantId, LISTING_PERIOD_DAYS);
    if (!record) return { status: 404, body: { error: "listing not found" } };
    return { status: 200, body: { id: record.id, listing_expires_at: record.listing_expires_at } };
  }

  if (type === "sponsor") {
    const record = await db.extendSponsor(restaurantId, SPONSOR_PERIOD_DAYS);
    if (!record) return { status: 404, body: { error: "listing not found" } };
    return { status: 200, body: { id: record.id, sponsored_until: record.sponsored_until } };
  }

  return { status: 400, body: { error: "unknown payment type" } };
}

// Verify, complete with Pi, then apply the effect. Used by both /complete
// and /incomplete. Returns { status, body } for the HTTP response.
async function finalizePayment(paymentId, clientTxid) {
  const payment = await fetchPayment(paymentId);

  const problem = validatePayment(payment);
  if (problem) return { status: 400, body: { error: problem } };

  const s = payment.status || {};
  if (!s.developer_approved) return { status: 400, body: { error: "payment was not approved" } };
  if (s.developer_completed || finalizedPayments.has(paymentId)) {
    return { status: 409, body: { error: "payment already completed" } };
  }

  const chainTxid = payment.transaction && payment.transaction.txid;
  const txid = clientTxid || chainTxid;
  if (!txid) return { status: 400, body: { error: "txid is required" } };
  if (chainTxid && clientTxid && chainTxid !== clientTxid) {
    return { status: 400, body: { error: "txid mismatch" } };
  }

  finalizedPayments.add(paymentId);
  try {
    const r = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: piHeaders(),
      body: JSON.stringify({ txid }),
    });
    if (!r.ok) throw new Error(`Pi API complete failed: ${r.status}`);
    return await applyPaymentEffect(payment, txid);
  } catch (err) {
    finalizedPayments.delete(paymentId);
    throw err;
  }
}

// Pi calls this via onReadyForServerApproval — we must approve within
// a few seconds or the payment expires client-side. We only approve
// payments whose type and amount match our price table.
router.post("/approve", async (req, res) => {
  const { paymentId } = req.body || {};
  if (!paymentId || typeof paymentId !== "string") {
    return res.status(400).json({ error: "paymentId required" });
  }
  if (!PI_API_KEY) return res.status(503).json({ error: "payments are not configured" });
  try {
    const payment = await fetchPayment(paymentId);
    const problem = validatePayment(payment);
    if (problem) {
      console.warn(`payment approve rejected (${paymentId}): ${problem}`);
      return res.status(400).json({ error: problem });
    }
    if (!(payment.status && payment.status.developer_approved)) {
      const r = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}/approve`, {
        method: "POST",
        headers: piHeaders(),
      });
      if (!r.ok) throw new Error(`Pi API approve failed: ${r.status}`);
    }
    res.json({ approved: true });
  } catch (err) {
    console.error("payment approve error:", err.message);
    res.status(502).json({ error: "approval failed" });
  }
});

// Pi calls this via onReadyForServerCompletion once the txid is on chain.
// The payment type, amount and listing details are read back from Pi, not
// from this request, so a tampered browser cannot change what is applied.
router.post("/complete", async (req, res) => {
  const { paymentId, txid } = req.body || {};
  if (!paymentId || typeof paymentId !== "string" || !txid || typeof txid !== "string") {
    return res.status(400).json({ error: "paymentId and txid are required" });
  }
  if (!PI_API_KEY) return res.status(503).json({ error: "payments are not configured" });
  try {
    const result = await finalizePayment(paymentId, txid);
    if (result.status >= 400) console.warn(`payment complete rejected (${paymentId}): ${result.body.error}`);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("payment complete error:", err.message);
    res.status(502).json({ error: "completion failed" });
  }
});

// Handles Pi's onIncompletePaymentFound callback, forwarded from the client
// when a previous payment session was interrupted before completing. We
// look the payment up at Pi ourselves and finish it (including applying the
// listing / renewal / sponsor effect) only if it is valid and on chain.
router.post("/incomplete", async (req, res) => {
  const { payment } = req.body || {};
  const paymentId = payment && payment.identifier;
  if (!paymentId || typeof paymentId !== "string") {
    return res.status(400).json({ error: "payment required" });
  }
  if (!PI_API_KEY) return res.status(503).json({ error: "payments are not configured" });
  try {
    const fresh = await fetchPayment(paymentId);
    const s = fresh.status || {};
    const txid = fresh.transaction && fresh.transaction.txid;
    if (s.developer_approved && !s.developer_completed && !s.cancelled && !s.user_cancelled && txid) {
      const result = await finalizePayment(paymentId, txid);
      if (result.status >= 400) {
        console.warn(`incomplete payment not finalized (${paymentId}): ${result.body.error}`);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("incomplete payment handling error:", err.message);
    res.status(502).json({ error: "failed" });
  }
});

module.exports = router;
