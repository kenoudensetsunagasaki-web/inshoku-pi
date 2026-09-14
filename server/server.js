require("dotenv").config();
const express = require("express");
const path = require("path");

const restaurantRoutes = require("./routes/restaurants");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const db = require("./db");
const { fetchCoinmapVenues } = require("./importers/coinmap");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API routes
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);

// Static frontend (index.html, register.html, submit.html, admin.html, assets/)
app.use(express.static(path.join(__dirname, "..")));

app.listen(PORT, () => {
  console.log(`飲食.Pi server listening on http://localhost:${PORT}`);
  if (!process.env.PI_API_KEY) {
    console.warn("⚠ PI_API_KEY is not set — Pi payments will fail. See .env.example.");
  }
  if (!process.env.ADMIN_TOKEN) {
    console.warn("⚠ ADMIN_TOKEN is not set — /admin.html will be unusable. See .env.example.");
  }
  startImportScheduler();
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
          if (db.findByExternal(c.external_source, c.external_id)) continue;
          db.insert({ ...c, status: autoApprove ? "verified" : "pending" });
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

