const express = require("express");
const router = express.Router();
const db = require("../db");

const PI_API_BASE = "https://api.minepi.com/v2";

// GET /api/restaurants/search?lat=&lng=&radius=&currencies=PI,BTC&verifiedOnly=true
// radius accepts a number (km) or the literal "unlimited" for no distance cap.
router.get("/search", (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }
  const radiusKm = req.query.radius === "unlimited" ? Infinity : parseFloat(req.query.radius) || 3;
  const currencies = req.query.currencies ? req.query.currencies.split(",") : [];
  const verifiedOnly = req.query.verifiedOnly === "true";

  const results = db.search({ lat, lng, radiusKm, currencies, verifiedOnly });
  res.json({ results });
});

// GET /api/restaurants/mine — the store owner's own listings, for the
// "マイ店舗" dashboard. Requires the Pi accessToken the client got from
// Pi.authenticate(); we verify it against Pi's own /v2/me endpoint rather
// than trusting a client-supplied username, so people can't peek at
// someone else's stats by guessing a username.
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
    const mine = db.findBySubmitter(me.username);
    res.json({ results: mine });
  } catch (err) {
    console.error("mine lookup error:", err.message);
    res.status(502).json({ error: "failed to verify Pi session" });
  }
});

router.get("/:id", (req, res) => {
  const r = db.getById(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

// POST /api/restaurants/:id/track  { event: "directions" | "gmaps" }
// Fire-and-forget click tracking for the store-owner dashboard. No auth —
// it's just an anonymous counter, same trust level as a page-view count.
router.post("/:id/track", (req, res) => {
  const { event } = req.body || {};
  const field = { directions: "directions_clicks", gmaps: "gmaps_clicks" }[event];
  if (!field) return res.status(400).json({ error: "unknown event" });
  db.incrementStat(req.params.id, field);
  res.json({ ok: true });
});

// POST /api/restaurants/submit — free crowdsourced tip, goes to pending queue
router.post("/submit", (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.address) {
    return res.status(400).json({ error: "name and address are required" });
  }
  if (!Array.isArray(body.accepted_currencies) || body.accepted_currencies.length === 0) {
    return res.status(400).json({ error: "at least one currency is required" });
  }
  const record = db.insert({
    name: body.name,
    address: body.address,
    lat: body.lat ?? 0,
    lng: body.lng ?? 0,
    accepted_currencies: body.accepted_currencies,
    note: body.note || "",
    contact: body.contact || "",
    source: "user_submitted",
    status: "pending",
  });
  res.status(201).json({ id: record.id });
});

module.exports = router;
