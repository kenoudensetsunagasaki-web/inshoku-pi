const express = require("express");
const router = express.Router();
const db = require("../db");
const { fetchCoinmapVenues } = require("../importers/coinmap");
const { fetchCandidates: fetchPiCandidates } = require("../importers/pi-directories");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const IMPORTERS = {
  coinmap: fetchCoinmapVenues,
  pi_directories: fetchPiCandidates,
};

// Simple shared-secret gate. This is fine for a solo operator running
// their own review queue, but is not real multi-user auth — replace
// with proper login/session handling before handing admin access to
// more than one trusted person.
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN is not configured on the server" });
  }
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

router.get("/restaurants/pending", requireAdmin, (req, res) => {
  res.json({ results: db.pending() });
});

router.post("/restaurants/:id/approve", requireAdmin, (req, res) => {
  const r = db.update(req.params.id, { status: "verified", source: "admin" });
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

router.post("/restaurants/:id/reject", requireAdmin, (req, res) => {
  const r = db.update(req.params.id, { status: "rejected" });
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

// Manual entry by the operator — goes live immediately as admin-verified.
router.post("/restaurants", requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.address || body.lat == null || body.lng == null) {
    return res.status(400).json({ error: "name, address, lat and lng are required" });
  }
  const record = db.insert({
    ...body,
    source: "admin",
    status: "verified",
  });
  res.status(201).json(record);
});

// GET /api/admin/reviews — every review across every listing, newest first,
// for moderation (spam / abuse).
router.get("/reviews", requireAdmin, (req, res) => {
  res.json({ results: db.allReviews() });
});

// POST /api/admin/restaurants/:id/reviews/:reviewId/hide
router.post("/restaurants/:id/reviews/:reviewId/hide", requireAdmin, (req, res) => {
  const r = db.hideReview(req.params.id, req.params.reviewId);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

// POST /api/admin/import/run  { source: "coinmap", lat, lng, radiusKm, autoApprove? }
// Pulls candidate restaurants from an external directory and adds any new
// ones (deduped by external_source+external_id). `source: "pi_directories"`
// is wired to the same interface but currently returns no results — see
// importers/pi-directories.js for why.
router.post("/import/run", requireAdmin, async (req, res) => {
  const { source, lat, lng, radiusKm, autoApprove } = req.body || {};
  const importer = IMPORTERS[source];
  if (!importer) {
    return res.status(400).json({ error: `unknown import source "${source}"` });
  }
  if (lat == null || lng == null) {
    return res.status(400).json({ error: "lat and lng are required" });
  }
  try {
    const candidates = await importer({ lat, lng, radiusKm: radiusKm || 10 });
    const shouldAutoApprove =
      autoApprove != null ? !!autoApprove : process.env.IMPORT_AUTO_APPROVE === "true";

    let imported = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (c.external_source && c.external_id && db.findByExternal(c.external_source, c.external_id)) {
        skipped++;
        continue;
      }
      db.insert({ ...c, status: shouldAutoApprove ? "verified" : "pending" });
      imported++;
    }
    res.json({ found: candidates.length, imported, skipped, autoApproved: shouldAutoApprove });
  } catch (err) {
    console.error("import run error:", err.message);
    res.status(502).json({ error: "import failed: " + err.message });
  }
});

module.exports = router;
