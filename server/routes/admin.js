const express = require("express");
const router = express.Router();
const db = require("../db");
const { fetchCoinmapVenues } = require("../importers/coinmap");
const { fetchCandidates: fetchPiCandidates } = require("../importers/pi-directories");
const { checkAndSendExpiryReminders } = require("../services/reminders");

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

router.get("/restaurants/pending", requireAdmin, async (req, res) => {
  try {
    res.json({ results: await db.pending() });
  } catch (err) {
    console.error("pending error:", err.message);
    res.status(502).json({ error: "failed to load pending listings" });
  }
});

router.post("/restaurants/:id/approve", requireAdmin, async (req, res) => {
  try {
    const r = await db.update(req.params.id, { status: "verified", source: "admin" });
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(r);
  } catch (err) {
    console.error("approve error:", err.message);
    res.status(502).json({ error: "approve failed" });
  }
});

router.post("/restaurants/:id/reject", requireAdmin, async (req, res) => {
  try {
    const r = await db.update(req.params.id, { status: "rejected" });
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(r);
  } catch (err) {
    console.error("reject error:", err.message);
    res.status(502).json({ error: "reject failed" });
  }
});

// GET /api/admin/restaurants/all — every listing regardless of status, for
// the admin panel's "掲載中の店舗一覧" section (lets the operator find and
// remove something that's already live, not just review the pending queue).
router.get("/restaurants/all", requireAdmin, async (req, res) => {
  try {
    res.json({ results: await db.all() });
  } catch (err) {
    console.error("all listings error:", err.message);
    res.status(502).json({ error: "failed to load listings" });
  }
});

// DELETE /api/admin/restaurants/:id — hard delete, any status. Unlike the
// owner-facing DELETE /api/restaurants/mine/:id, this has no ownership
// check — it's gated by the admin token instead.
router.delete("/restaurants/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await db.adminDeleteListing(req.params.id);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin delete error:", err.message);
    res.status(502).json({ error: "delete failed" });
  }
});

// Manual entry by the operator — goes live immediately as admin-verified.
router.post("/restaurants", requireAdmin, async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.address || body.lat == null || body.lng == null) {
    return res.status(400).json({ error: "name, address, lat and lng are required" });
  }
  try {
    const record = await db.insert({
      ...body,
      source: "admin",
      status: "verified",
    });
    res.status(201).json(record);
  } catch (err) {
    console.error("admin insert error:", err.message);
    res.status(502).json({ error: "insert failed" });
  }
});

// GET /api/admin/reviews — every review across every listing, newest first,
// for moderation (spam / abuse).
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    res.json({ results: await db.allReviews() });
  } catch (err) {
    console.error("allReviews error:", err.message);
    res.status(502).json({ error: "failed to load reviews" });
  }
});

// POST /api/admin/restaurants/:id/reviews/:reviewId/hide
router.post("/restaurants/:id/reviews/:reviewId/hide", requireAdmin, async (req, res) => {
  try {
    const r = await db.hideReview(req.params.id, req.params.reviewId);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(r);
  } catch (err) {
    console.error("hideReview error:", err.message);
    res.status(502).json({ error: "hide failed" });
  }
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
      if (c.external_source && c.external_id && (await db.findByExternal(c.external_source, c.external_id))) {
        skipped++;
        continue;
      }
      await db.insert({ ...c, status: shouldAutoApprove ? "verified" : "pending" });
      imported++;
    }
    res.json({ found: candidates.length, imported, skipped, autoApproved: shouldAutoApprove });
  } catch (err) {
    console.error("import run error:", err.message);
    res.status(502).json({ error: "import failed: " + err.message });
  }
});

// POST /api/admin/check-expiring — manually trigger (or have an external
// cron service like cron-job.org / UptimeRobot call) the expiry-reminder
// check, instead of waiting for the in-process daily scheduler in server.js.
router.post("/check-expiring", requireAdmin, async (req, res) => {
  try {
    const result = await checkAndSendExpiryReminders();
    res.json(result);
  } catch (err) {
    console.error("check-expiring error:", err.message);
    res.status(500).json({ error: "check failed" });
  }
});

module.exports = router;
