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
    // 店舗オーナーの連絡先メールアドレス(任意)。掲載期限が近づいた際の
    // お知らせメール送信にのみ使用します(server/services/reminders.js参照)。
    email: restaurant.email || "",
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
    // このサイクルで期限お知らせメールを送信済みかどうか。更新(延長)される
    // たびにnullにリセットされます(下のextendExpiry参照)。
    reminder_sent_at: restaurant.reminder_sent_at || null,
    sponsored: !!restaurant.sponsored,
    sponsored_until: restaurant.sponsored_until || null,
    submitted_by: restaurant.submitted_by || null,
    note: restaurant.note || "",
    contact: restaurant.contact || "",
    external_source: restaurant.external_source || null, // e.g. "coinmap"
    external_id: restaurant.external_id || null,
    votes: restaurant.votes || { up: 0, down: 0 },
    stats: restaurant.stats || { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 },
    // ---- richer venue info ----
    hours: restaurant.hours || "", // freeform text, e.g. "月-金 11:00-22:00 / 土日 定休"
    menu_highlights: Array.isArray(restaurant.menu_highlights) ? restaurant.menu_highlights : [],
    // ---- reviews / ratings ----
    reviews: Array.isArray(restaurant.reviews) ? restaurant.reviews : [],
    rating_avg: restaurant.rating_avg || 0,
    rating_count: restaurant.rating_count || 0,
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
  list[idx].reminder_sent_at = null; // 更新したので次のサイクルでまたお知らせできるようにする
  list[idx].updated_at = new Date().toISOString();
  save(list);
  return list[idx];
}

// 自己登録・現在掲載中(verified)で、(a)メールアドレスが登録されており、
// (b) daysAhead日以内に掲載期限が来て、(c) このサイクルではまだお知らせ
// メールを送っていない店舗の一覧を返す。
function dueForExpiryReminder(daysAhead) {
  const now = Date.now();
  const threshold = now + daysAhead * 24 * 60 * 60 * 1000;
  return load().filter((r) => {
    if (r.source !== "self_registered") return false;
    if (r.status !== "verified") return false;
    if (!r.email) return false;
    if (!r.listing_expires_at) return false;
    if (r.reminder_sent_at) return false;
    const exp = new Date(r.listing_expires_at).getTime();
    return exp > now && exp <= threshold;
  });
}

function markReminderSent(id) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx].reminder_sent_at = new Date().toISOString();
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

function recomputeRating(record) {
  const visible = (record.reviews || []).filter((rv) => rv.status !== "hidden");
  record.rating_count = visible.length;
  record.rating_avg = visible.length
    ? Math.round((visible.reduce((sum, rv) => sum + rv.rating, 0) / visible.length) * 10) / 10
    : 0;
}

// Reviews are open to anyone (no Pi sign-in required — same trust level as
// the crowdsourced "submit a tip" flow), but are capped in length and rating
// range at the route layer. Admins can hide abusive ones via hideReview.
function addReview(restaurantId, { rating, comment, author }) {
  const list = load();
  const idx = list.findIndex((r) => r.id === restaurantId);
  if (idx === -1) return null;
  const review = {
    id: crypto.randomUUID(),
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    comment: (comment || "").slice(0, 280),
    author: (author || "").slice(0, 40) || null,
    status: "visible", // visible | hidden (admin-moderated)
    created_at: new Date().toISOString(),
  };
  if (!list[idx].reviews) list[idx].reviews = [];
  list[idx].reviews.push(review);
  recomputeRating(list[idx]);
  list[idx].updated_at = new Date().toISOString();
  save(list);
  return { restaurant: list[idx], review };
}

function hideReview(restaurantId, reviewId) {
  const list = load();
  const idx = list.findIndex((r) => r.id === restaurantId);
  if (idx === -1) return null;
  const review = (list[idx].reviews || []).find((rv) => rv.id === reviewId);
  if (!review) return null;
  review.status = "hidden";
  recomputeRating(list[idx]);
  list[idx].updated_at = new Date().toISOString();
  save(list);
  return list[idx];
}

// Every review across every restaurant, newest first — for the admin
// moderation panel. Small dataset, so an in-memory flatten is fine.
function allReviews() {
  const list = load();
  const out = [];
  list.forEach((r) => {
    (r.reviews || []).forEach((rv) => {
      out.push({ ...rv, restaurant_id: r.id, restaurant_name: r.name });
    });
  });
  return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Lets a store owner edit their own venue's richer info (hours, menu
// highlights) without going through the admin queue. Verified against the
// Pi-authenticated username by the route, not trusted from the client.
const OWNER_EDITABLE_FIELDS = ["hours", "menu_highlights", "phone", "website", "cuisine"];
function updateOwnListing(id, username, patch) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  if (list[idx].submitted_by !== username) return "forbidden";
  const safePatch = {};
  OWNER_EDITABLE_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) safePatch[field] = patch[field];
  });
  list[idx] = { ...list[idx], ...safePatch, updated_at: new Date().toISOString() };
  save(list);
  return list[idx];
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
  addReview,
  hideReview,
  allReviews,
    updateOwnListing,
  dueForExpiryReminder,
  markReminderSent,
};
