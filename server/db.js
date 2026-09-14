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
    submitted_by: restaurant.submitted_by || null,
    note: restaurant.note || "",
    contact: restaurant.contact || "",
    external_source: restaurant.external_source || null, // e.g. "coinmap"
    external_id: restaurant.external_id || null,
    votes: restaurant.votes || { up: 0, down: 0 },
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
  const list = load().filter((r) => r.status === "verified");
  return list
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
    .sort((a, b) => a.distance_km - b.distance_km);
}

function pending() {
  return load().filter((r) => r.status === "pending");
}

module.exports = { all, getById, findByExternal, insert, update, search, pending, haversineKm };
