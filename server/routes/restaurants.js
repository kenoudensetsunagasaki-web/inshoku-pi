const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/restaurants/search?lat=&lng=&radius=&currencies=PI,BTC&verifiedOnly=true
router.get("/search", (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusKm = parseFloat(req.query.radius) || 3;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }
  const currencies = req.query.currencies ? req.query.currencies.split(",") : [];
  const verifiedOnly = req.query.verifiedOnly === "true";

  const results = db.search({ lat, lng, radiusKm, currencies, verifiedOnly });
  res.json({ results });
});

router.get("/:id", (req, res) => {
  const r = db.getById(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
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
