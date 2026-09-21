const express = require("express");
const router = express.Router();
const db = require("../db");

const PI_API_BASE = "https://api.minepi.com/v2";

// ---- tiny in-memory rate limiter ----
// Good enough for a single-instance app at this scale: keyed by whatever
// string the caller builds (usually req.ip + restaurant id + action), each
// key can fire at most `max` times per `windowMs`. Resets on server
// restart, which is fine — it only needs to blunt casual spam/abuse, not
// survive as a permanent ledger. Requires app.set("trust proxy", true) in
// server.js so req.ip reflects the real client IP behind Render's proxy.
const rateLimitHits = new Map();
function rateLimit(key, windowMs, max) {
  const now = Date.now();
  const hits = (rateLimitHits.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    rateLimitHits.set(key, hits);
    return false;
  }
  hits.push(now);
  rateLimitHits.set(key, hits);
  return true;
}
// Periodic cleanup so this Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitHits.entries()) {
    const fresh = hits.filter((t) => now - t < 10 * 60 * 1000);
    if (fresh.length === 0) rateLimitHits.delete(key);
    else rateLimitHits.set(key, fresh);
  }
}, 10 * 60 * 1000).unref();

// Strips fields that should never leave the server in a public API
// response: `email` (collected only for expiry-reminder emails — see
// server/services/mailer.js) and `contact` (collected only so an admin can
// follow up on a submitted tip). Both are still visible to the store owner
// themselves via /mine, and to the admin panel, since those routes don't
// use this.
function toPublic(r) {
  if (!r) return r;
  const { email, contact, ...pub } = r;
  return pub;
}

// GET /api/restaurants/search?lat=&lng=&radius=&currencies=PI,BTC&verifiedOnly=true
// radius accepts a number (km) or the literal "unlimited" for no distance cap.
router.get("/search", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }
  const radiusKm = req.query.radius === "unlimited" ? Infinity : parseFloat(req.query.radius) || 3;
  const currencies = req.query.currencies ? req.query.currencies.split(",") : [];
  const verifiedOnly = req.query.verifiedOnly === "true";

  try {
    const results = await db.search({ lat, lng, radiusKm, currencies, verifiedOnly });
    res.json({ results: results.map(toPublic) });
  } catch (err) {
    console.error("search error:", err.message);
    res.status(502).json({ error: "search failed" });
  }
});

// GET /api/restaurants/mine — the store owner's own listings, for the
// "マイ店舗" dashboard. Requires the Pi accessToken the client got from
// Pi.authenticate(); we verify it against Pi's own /v2/me endpoint rather
// than trusting a client-supplied username, so people can't peek at
// someone else's stats by guessing a username. This is the owner's own
// data, so — unlike /search and /:id below — it's fine to include email.
// NOTE: this must be registered before the "/:id" route below, or Express
// will match "mine" as an :id.
router.get("/mine", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing Pi access token" });
  try {
    const meRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return res.status(401).json({ error: "invalid Pi session" });
    const me = await meRes.json();
    const mine = await db.findBySubmitter(me.username);
    res.json({ results: mine });
  } catch (err) {
    console.error("mine lookup error:", err.message);
    res.status(502).json({ error: "failed to verify Pi session" });
  }
});

// GET /api/restaurants/:id — public detail view. email/contact stripped;
// see toPublic() above.
router.get("/:id", async (req, res) => {
  try {
    const r = await db.getById(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(toPublic(r));
  } catch (err) {
    console.error("getById error:", err.message);
    res.status(502).json({ error: "lookup failed" });
  }
});

// POST /api/restaurants/:id/reviews  { rating: 1-5, comment, author }
// Open to anyone, same trust level as the free "submit a tip" flow. Rating
// and comment length are clamped server-side regardless of what's sent.
// Rate-limited per IP+restaurant to blunt review-bombing / self-review spam.
router.post("/:id/reviews", async (req, res) => {
  if (!rateLimit(`review:${req.ip}:${req.params.id}`, 10 * 60 * 1000, 3)) {
    return res.status(429).json({ error: "too many reviews from this connection, try again later" });
  }
  const { rating, comment, author } = req.body || {};
  const numRating = Number(rating);
  if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: "rating must be a number from 1 to 5" });
  }
  try {
    const result = await db.addReview(req.params.id, { rating: numRating, comment, author });
    if (!result) return res.status(404).json({ error: "not found" });
    res.status(201).json({ restaurant: toPublic(result.restaurant), review: result.review });
  } catch (err) {
    console.error("addReview error:", err.message);
    res.status(502).json({ error: "failed to save review" });
  }
});

// PATCH /api/restaurants/mine/:id — store owner edits their own venue's
// hours / menu highlights / phone / website / cuisine. Verified against
// Pi's /v2/me the same way GET /mine is, so people can't edit listings
// that aren't theirs by guessing an id.
router.patch("/mine/:id", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing Pi access token" });
  try {
    const meRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return res.status(401).json({ error: "invalid Pi session" });
    const me = await meRes.json();
    const result = await db.updateOwnListing(req.params.id, me.username, req.body || {});
    if (result === "forbidden") return res.status(403).json({ error: "not your listing" });
    if (!result) return res.status(404).json({ error: "not found" });
    res.json(result);
  } catch (err) {
    console.error("mine update error:", err.message);
    res.status(502).json({ error: "failed to verify Pi session" });
  }
});

// POST /api/restaurants/:id/track  { event: "directions" | "gmaps" }
// Fire-and-forget click tracking for the store-owner dashboard. No auth —
// it's just an anonymous counter, same trust level as a page-view count.
// Rate-limited per IP+restaurant+event so a script can't trivially inflate
// the numbers.
router.post("/:id/track", async (req, res) => {
  const { event } = req.body || {};
  const field = { directions: "directions_clicks", gmaps: "gmaps_clicks" }[event];
  if (!field) return res.status(400).json({ error: "unknown event" });
  if (!rateLimit(`track:${req.ip}:${req.params.id}:${event}`, 30 * 1000, 1)) {
    return res.json({ ok: true }); // silently drop — no need to tell a script it was throttled
  }
  try {
    await db.incrementStat(req.params.id, field);
    res.json({ ok: true });
  } catch (err) {
    console.error("track error:", err.message);
    res.status(502).json({ error: "failed" });
  }
});

// POST /api/restaurants/submit — free crowdsourced tip, goes to pending queue
router.post("/submit", async (req, res) => {
  if (!rateLimit(`submit:${req.ip}`, 10 * 60 * 1000, 5)) {
    return res.status(429).json({ error: "too many submissions from this connection, try again later" });
  }
  const body = req.body || {};
  if (!body.name || !body.address) {
    return res.status(400).json({ error: "name and address are required" });
  }
  if (!Array.isArray(body.accepted_currencies) || body.accepted_currencies.length === 0) {
    return res.status(400).json({ error: "at least one currency is required" });
  }
  try {
    const record = await db.insert({
      name: body.name,
      address: body.address,
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      accepted_currencies: body.accepted_currencies,
      hours: body.hours || "",
      menu_highlights: Array.isArray(body.menu_highlights) ? body.menu_highlights : [],
      note: body.note || "",
      contact: body.contact || "",
      source: "user_submitted",
      status: "pending",
    });
    res.status(201).json({ id: record.id });
  } catch (err) {
    console.error("submit error:", err.message);
    res.status(502).json({ error: "failed to save submission" });
  }
});

// POST /api/restaurants/free-register — Testnet-period alternative to the
// paid Pi flow in payments.js. Only works when the server-side
// FREE_REGISTRATION_TESTNET switch is on (see .env.example); the client
// cannot turn this on by itself. Still requires a valid Pi sign-in (same
// /v2/me check as the /mine endpoints) so a listing is always tied to a
// real Pi username, even though no payment changes hands.
router.post("/free-register", async (req, res) => {
  if (process.env.FREE_REGISTRATION_TESTNET !== "true") {
    return res.status(403).json({ error: "free registration is not currently enabled" });
  }
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing Pi access token" });
  const restaurant = req.body || {};
  if (!restaurant.name || !restaurant.address) {
    return res.status(400).json({ error: "name and address are required" });
  }
  try {
    const meRes = await fetch(`${PI_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return res.status(401).json({ error: "invalid Pi session" });
    const me = await meRes.json();
    const record = await db.insert({
      ...restaurant,
      source: "self_registered",
      status: "verified",
      submitted_by: me.username,
      listing_paid: false,
      listing_tx_id: null,
      note: (restaurant.note ? restaurant.note + " / " : "") + "テストネット期間中の無料登録",
    });
    res.status(201).json({ id: record.id });
  } catch (err) {
    console.error("free-register error:", err.message);
    res.status(502).json({ error: "failed to verify Pi session" });
  }
});

module.exports = router;
