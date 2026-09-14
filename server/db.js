// Minimal JSON-file data store. Good enough for a demo / early launch;
// swap this module out for a real database (Postgres + PostGIS, etc.)
// once listing volume grows — the function signatures below are the
// seam to replace.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "data", "restaurants.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function save(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function all() {
  return load();
}

function getById(id) {
  return load().find((r) => r.id === id);
}

function findByExternal(externalSource, externalId) {
  return load().find(
    (r) => r.external_source === externalSource && r.external_id === externalId
  );
}

function insert(restaurant) {
  const list = load();
  const record = {
    id: restaurant.id || crypto.randomUUID(),
    name: restaurant.name || "",
    name_en: restaurant.name_en || "",
    address: restaurant.address || "",
    cuisine: restaurant.cuisine || "",
    phone: restaurant.phone || "",
    website: restaurant.website || "",
    lat: Number(restaurant.lat),
    lng: Number(restaurant.lng),
    accepted_currencies: restaurant.accepted_currencies || [],
    source: restaurant.source || "user_submitted", // admin | self_registered | user_submitted | coinmap_import
    status: restaurant.status || "pending", // pending | verified | rejected
    listing_paid: !!restaurant.listing_paid,
    listing_tx_id: restaurant.listing_tx_id || null,
    // Self-registered listings are a recurring 1π/month subscription.
    // Pi has no silent auto-billing, so this is enforced by hiding the
    // listing from search once listing_expires_at passes, until the
    // owner comes back and pays to renew (see routes/payments.js).
    listing_expires_at: restaurant.listing_expires_at || null,
    sponsored: !!restaurant.sponsored,
    sponsored_until: restaurant.sponsored_until || null,
    submitted_by: restaurant.submitted_by || null,
    note: restaurant.note || "",
    contact: restaurant.contact || "",
    external_source: restaurant.external_source || null, // e.g. "coinmap"
    external_id: restaurant.external_id || null,
    votes: restaurant.votes || { up: 0, down: 0 },
    stats: restaurant.stats || { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  list.push(record);
  save(list);
  return record;
}

function update(id, patch) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updated_at: new Date().toISOString() };
  save(list);
  return list[idx];
}

function search({ lat, lng, radiusKm, currencies, verifiedOnly }) {
  // Both admin-verified and paid self-registered listings carry
  // status "verified" — the frontend tells them apart via `source`
  // and shows a different trust badge for each.
  const now = Date.now();
  const list = load().filter((r) => {
    if (r.status !== "verified") return false;
    // Self-registered listings are a monthly subscription — once the
    // paid period lapses, they drop out of search until renewed.
    if (r.source === "self_registered" && r.listing_expires_at) {
      if (new Date(r.listing_expires_at).getTime() < now) return false;
    }
    return true;
  });
  const results = list
    .map((r) => ({ ...r, distance_km: haversineKm(lat, lng, r.lat, r.lng) }))
    .filter((r) => r.distance_km <= radiusKm)
    .filter((r) => {
      if (!currencies || currencies.length === 0) return true;
      return r.accepted_currencies.some((c) => currencies.includes(c));
    })
    .filter((r) => {
      if (!verifiedOnly) return true;
      return r.source === "admin";
    })
    .sort((a, b) => {
      const aSponsored = a.sponsored && a.sponsored_until && new Date(a.sponsored_until).getTime() > now;
      const bSponsored = b.sponsored && b.sponsored_until && new Date(b.sponsored_until).getTime() > now;
      if (aSponsored !== bSponsored) return aSponsored ? -1 : 1; // sponsored listings float to the top
      return a.distance_km - b.distance_km;
    });

  // Count this as an "impression" for each listing that made it into the
  // results — cheap analytics for the store-owner dashboard. Batched into
  // a single read-modify-write instead of one per listing.
  try {
    if (results.length > 0) {
      const resultIds = new Set(results.map((r) => r.id));
      const fullList = load();
      fullList.forEach((r) => {
        if (resultIds.has(r.id)) {
          if (!r.stats) r.stats = { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 };
          r.stats.impressions = (r.stats.impressions || 0) + 1;
        }
      });
      save(fullList);
    }
  } catch (err) {
    console.error("impression tracking failed:", err.message);
  }

  return results;
}

function findBySubmitter(username) {
  return load().filter((r) => r.submitted_by === username);
}

function incrementStat(id, field) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  if (!list[idx].stats) list[idx].stats = { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 };
  list[idx].stats[field] = (list[idx].stats[field] || 0) + 1;
  save(list);
}

function extendExpiry(id, days) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const current = list[idx].listing_expires_at ? new Date(list[idx].listing_expires_at).getTime() : Date.now();
  const base = Math.max(current, Date.now()); // renewing early doesn't lose remaining days
  list[idx].listing_expires_at = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  list[idx].updated_at = new Date().toISOString();
  save(list);
  return list[idx];
}

function extendSponsor(id, days) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const current = list[idx].sponsored_until ? new Date(list[idx].sponsored_until).getTime() : Date.now();
  const base = Math.max(current, Date.now());
  list[idx].sponsored = true;
  list[idx].sponsored_until = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  list[idx].updated_at = new Date().toISOString();
  save(list);
  return list[idx];
}

function pending() {
  return load().filter((r) => r.status === "pending");
}

module.exports = {
  all,
  getById,
  findByExternal,
  findBySubmitter,
  insert,
  update,
  search,
  pending,
  haversineKm,
  incrementStat,
  extendExpiry,
  extendSponsor,
};
