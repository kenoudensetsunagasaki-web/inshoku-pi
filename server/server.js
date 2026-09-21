require("dotenv").config();
const express = require("express");
const path = require("path");

const restaurantRoutes = require("./routes/restaurants");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const db = require("./db");
const { fetchCoinmapVenues } = require("./importers/coinmap");
const { checkAndSendExpiryReminders } = require("./services/reminders");

const app = express();
const PORT = process.env.PORT || 3000;

// Render sits in front of this app behind its own proxy, so without this,
// req.ip would show Render's proxy address for every visitor instead of
// their real IP — which would make the per-IP rate limiting in
// routes/restaurants.js useless (everyone would share one bucket).
app.set("trust proxy", true);

app.use(express.json());

// GET /api/config — lets the frontend know which capabilities are turned
// on server-side, without ever letting the client decide sensitive things
// (like whether registration is free) on its own. See FREE_REGISTRATION_TESTNET
// in .env.example: flip it off once the Pi Developer Portal review passes and
// the app is live on Mainnet, so real Pi payments are required again.
app.get("/api/config", (req, res) => {
  res.json({
    freeRegistration: process.env.FREE_REGISTRATION_TESTNET === "true",
  });
});

// API routes
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

// Static frontend (index.html, register.html, submit.html, admin.html, assets/)
app.use(express.static(path.join(__dirname, "..")));

// MongoDB Atlas connection must be ready before we start accepting
// requests — every route handler now awaits a db.* call. See db.js and
// .env.example (MONGODB_URI) for setup.
async function main() {
  await db.connect();
  console.log("✓ Connected to MongoDB");

  app.listen(PORT, () => {
    console.log(`飲食.Pi server listening on http://localhost:${PORT}`);
    if (!process.env.PI_API_KEY) {
      console.warn("⚠ PI_API_KEY is not set — Pi payments will fail. See .env.example.");
    }
    if (!process.env.ADMIN_TOKEN) {
      console.warn("⚠ ADMIN_TOKEN is not set — /admin.html will be unusable. See .env.example.");
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      console.warn("⚠ EMAIL_USER / EMAIL_APP_PASSWORD are not set — expiry reminder emails will be skipped. See .env.example.");
    }
    startImportScheduler();
    startExpiryReminderScheduler();
  });
}

main().catch((err) => {
  console.error("✗ Failed to start server:", err.message);
  process.exit(1);
});

// Optional background import: set IMPORT_REGIONS to a JSON array like
//   [{"name":"Fukuoka","lat":33.5904,"lng":130.4017,"radiusKm":15}]
// and IMPORT_INTERVAL_HOURS (e.g. 24) to periodically pull new Coinmap
// listings for those regions without anyone clicking the admin button.
// New listings still land as "pending" unless IMPORT_AUTO_APPROVE=true.
function startImportScheduler() {
  const regionsRaw = process.env.IMPORT_REGIONS;
  const intervalHours = parseFloat(process.env.IMPORT_INTERVAL_HOURS);
  if (!regionsRaw || !intervalHours) return;

  let regions;
  try {
    regions = JSON.parse(regionsRaw);
  } catch {
    console.warn("⚠ IMPORT_REGIONS is not valid JSON — background import disabled.");
    return;
  }

  const autoApprove = process.env.IMPORT_AUTO_APPROVE === "true";

  async function runOnce() {
    for (const region of regions) {
      try {
        const candidates = await fetchCoinmapVenues({
          lat: region.lat,
          lng: region.lng,
          radiusKm: region.radiusKm || 10,
        });
        let imported = 0;
        for (const c of candidates) {
          if (await db.findByExternal(c.external_source, c.external_id)) continue;
          await db.insert({ ...c, status: autoApprove ? "verified" : "pending" });
          imported++;
        }
        console.log(`[import] ${region.name || "region"}: +${imported} new (of ${candidates.length} found)`);
      } catch (err) {
        console.error(`[import] ${region.name || "region"} failed:`, err.message);
      }
    }
  }

  runOnce();
  setInterval(runOnce, intervalHours * 60 * 60 * 1000);
  console.log(`[import] background Coinmap import scheduled every ${intervalHours}h for ${regions.length} region(s).`);
}

// Runs the expiry-reminder check once at startup, then every 24h. Uses the
// same checkAndSendExpiryReminders() as the manual /api/admin/check-expiring
// endpoint, so a free external cron (e.g. cron-job.org) hitting that endpoint
// and this in-process timer never do conflicting things — whichever runs
// first for a given listing just marks it as sent, and the other sees
// reminder_sent_at already set and skips it.
function startExpiryReminderScheduler() {
  checkAndSendExpiryReminders().catch((err) =>
    console.error("[reminder] initial check failed:", err.message)
  );
  setInterval(() => {
    checkAndSendExpiryReminders().catch((err) =>
      console.error("[reminder] scheduled check failed:", err.message)
    );
  }, 24 * 60 * 60 * 1000);
  console.log("[reminder] expiry reminder scheduler started (checks every 24h).");
}
