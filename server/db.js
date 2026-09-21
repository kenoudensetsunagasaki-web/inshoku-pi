// MongoDB-backed data store. Replaces the old JSON-file store — Render's
// free tier disk is ephemeral (wiped on every redeploy/restart), so a local
// JSON file cannot survive in production. MongoDB Atlas's free tier (M0)
// persists indefinitely and is what this is written against.
//
// Design note: documents keep using our own `id` (crypto.randomUUID()) as
// a plain field, exactly like the old JSON records did, instead of Mongo's
// own `_id`. That way every other file that already does `restaurant.id` /
// `db.getById(id)` / `{ id: record.id }` keeps working unchanged.
const { MongoClient } = require("mongodb");
const crypto = require("crypto");

const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "inshoku_pi";
const COLLECTION = "restaurants";

let client = null;
let collection = null;

// Call once at server startup (see server.js) before handling any requests.
async function connect() {
  if (collection) return collection;
  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set — see .env.example for how to get one from MongoDB Atlas's free tier."
    );
  }
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  collection = db.collection(COLLECTION);
  return collection;
}

function requireCollection() {
  if (!collection) {
    throw new Error("db.connect() has not completed yet — call it before handling requests.");
  }
  return collection;
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

async function all() {
  return requireCollection().find({}).toArray();
}

async function getById(id) {
  return requireCollection().findOne({ id });
}

async function findByExternal(externalSource, externalId) {
  return requireCollection().findOne({
    external_source: externalSource,
    external_id: externalId,
  });
}

async function findBySubmitter(username) {
  return requireCollection().find({ submitted_by: username }).toArray();
}

async function insert(restaurant) {
  const record = {
    id: restaurant.id || crypto.randomUUID(),
    name: restaurant.name || "",
    name_en: restaurant.name_en || "",
    address: restaurant.address || "",
    cuisine: restaurant.cuisine || "",
    phone: restaurant.phone || "",
    website: restaurant.website || "",
    // Store owner's contact email — optional, only used to send a reminder
    // before the listing expires (see services/reminders.js). Never sent
    // back in any public API response — see routes/restaurants.js.
    email: restaurant.email || "",
    lat: Number(restaurant.lat),
    lng: Number(restaurant.lng),
    accepted_currencies: restaurant.accepted_currencies || [],
    source: restaurant.source || "user_submitted",
    status: restaurant.status || "pending",
    listing_paid: !!restaurant.listing_paid,
    listing_tx_id: restaurant.listing_tx_id || null,
    listing_expires_at: restaurant.listing_expires_at || null,
    reminder_sent_at: restaurant.reminder_sent_at || null,
    sponsored: !!restaurant.sponsored,
    sponsored_until: restaurant.sponsored_until || null,
    submitted_by: restaurant.submitted_by || null,
    note: restaurant.note || "",
    contact: restaurant.contact || "",
    external_source: restaurant.external_source || null,
    external_id: restaurant.external_id || null,
    votes: restaurant.votes || { up: 0, down: 0 },
    stats: restaurant.stats || { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 },
    hours: restaurant.hours || "",
    menu_highlights: Array.isArray(restaurant.menu_highlights) ? restaurant.menu_highlights : [],
    reviews: Array.isArray(restaurant.reviews) ? restaurant.reviews : [],
    rating_avg: restaurant.rating_avg || 0,
    rating_count: restaurant.rating_count || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await requireCollection().insertOne(record);
  return record;
}

async function update(id, patch) {
  const col = requireCollection();
  const res = await col.updateOne(
    { id },
    { $set: { ...patch, updated_at: new Date().toISOString() } }
  );
  if (res.matchedCount === 0) return null;
  return col.findOne({ id });
}

async function search({ lat, lng, radiusKm, currencies, verifiedOnly }) {
  const col = requireCollection();
  const now = Date.now();
  const candidates = await col.find({ status: "verified" }).toArray();
  const list = candidates.filter((r) => {
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
      if (aSponsored !== bSponsored) return aSponsored ? -1 : 1;
      return a.distance_km - b.distance_km;
    });

  try {
    await Promise.all(
      results.map((r) => col.updateOne({ id: r.id }, { $inc: { "stats.impressions": 1 } }))
    );
  } catch (err) {
    console.error("impression tracking failed:", err.message);
  }

  return results;
}

async function pending() {
  return requireCollection().find({ status: "pending" }).toArray();
}

async function incrementStat(id, field) {
  await requireCollection().updateOne({ id }, { $inc: { [`stats.${field}`]: 1 } });
}

async function extendExpiry(id, days) {
  const col = requireCollection();
  const doc = await col.findOne({ id });
  if (!doc) return null;
  const current = doc.listing_expires_at ? new Date(doc.listing_expires_at).getTime() : Date.now();
  const base = Math.max(current, Date.now());
  await col.updateOne(
    { id },
    {
      $set: {
        listing_expires_at: new Date(base + days * 24 * 60 * 60 * 1000).toISOString(),
        reminder_sent_at: null,
        updated_at: new Date().toISOString(),
      },
    }
  );
  return col.findOne({ id });
}

async function dueForExpiryReminder(daysAhead) {
  const col = requireCollection();
  const now = Date.now();
  const threshold = now + daysAhead * 24 * 60 * 60 * 1000;
  const candidates = await col
    .find({ source: "self_registered", status: "verified" })
    .toArray();
  return candidates.filter((r) => {
    if (!r.email) return false;
    if (!r.listing_expires_at) return false;
    if (r.reminder_sent_at) return false;
    const exp = new Date(r.listing_expires_at).getTime();
    return exp > now && exp <= threshold;
  });
}

async function markReminderSent(id) {
  const col = requireCollection();
  await col.updateOne({ id }, { $set: { reminder_sent_at: new Date().toISOString() } });
  return col.findOne({ id });
}

async function extendSponsor(id, days) {
  const col = requireCollection();
  const doc = await col.findOne({ id });
  if (!doc) return null;
  const current = doc.sponsored_until ? new Date(doc.sponsored_until).getTime() : Date.now();
  const base = Math.max(current, Date.now());
  await col.updateOne(
    { id },
    {
      $set: {
        sponsored: true,
        sponsored_until: new Date(base + days * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    }
  );
  return col.findOne({ id });
}

function recomputeRatingFields(reviews) {
  const visible = (reviews || []).filter((rv) => rv.status !== "hidden");
  const rating_count = visible.length;
  const rating_avg = visible.length
    ? Math.round((visible.reduce((sum, rv) => sum + rv.rating, 0) / visible.length) * 10) / 10
    : 0;
  return { rating_avg, rating_count };
}

async function addReview(restaurantId, { rating, comment, author }) {
  const col = requireCollection();
  const doc = await col.findOne({ id: restaurantId });
  if (!doc) return null;
  const review = {
    id: crypto.randomUUID(),
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    comment: (comment || "").slice(0, 280),
    author: (author || "").slice(0, 40) || null,
    status: "visible",
    created_at: new Date().toISOString(),
  };
  const reviews = [...(doc.reviews || []), review];
  const { rating_avg, rating_count } = recomputeRatingFields(reviews);
  await col.updateOne(
    { id: restaurantId },
    { $set: { reviews, rating_avg, rating_count, updated_at: new Date().toISOString() } }
  );
  const updated = await col.findOne({ id: restaurantId });
  return { restaurant: updated, review };
}

async function hideReview(restaurantId, reviewId) {
  const col = requireCollection();
  const doc = await col.findOne({ id: restaurantId });
  if (!doc) return null;
  const review = (doc.reviews || []).find((rv) => rv.id === reviewId);
  if (!review) return null;
  const reviews = doc.reviews.map((rv) => (rv.id === reviewId ? { ...rv, status: "hidden" } : rv));
  const { rating_avg, rating_count } = recomputeRatingFields(reviews);
  await col.updateOne(
    { id: restaurantId },
    { $set: { reviews, rating_avg, rating_count, updated_at: new Date().toISOString() } }
  );
  return col.findOne({ id: restaurantId });
}

async function allReviews() {
  const list = await requireCollection().find({}).toArray();
  const out = [];
  list.forEach((r) => {
    (r.reviews || []).forEach((rv) => {
      out.push({ ...rv, restaurant_id: r.id, restaurant_name: r.name });
    });
  });
  return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

const OWNER_EDITABLE_FIELDS = ["hours", "menu_highlights", "phone", "website", "cuisine"];
async function updateOwnListing(id, username, patch) {
  const col = requireCollection();
  const doc = await col.findOne({ id });
  if (!doc) return null;
  if (doc.submitted_by !== username) return "forbidden";
  const safePatch = {};
  OWNER_EDITABLE_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) safePatch[field] = patch[field];
  });
  await col.updateOne({ id }, { $set: { ...safePatch, updated_at: new Date().toISOString() } });
  return col.findOne({ id });
}

module.exports = {
  connect,
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
