// Imports food & drink venues from the public Coinmap API.
// Coinmap (coinmap.org) is a real, free, no-auth-required API backed by
// OpenStreetMap tags (payment:bitcoin=yes etc.), licensed ODbL — so any
// data pulled from it must credit "Map data © OpenStreetMap contributors,
// via Coinmap" wherever it's shown (see index.html footer / README).
//
// IMPORTANT LIMITATION: Coinmap tracks classic on-chain crypto acceptance
// (almost always Bitcoin) tagged by the OSM community. It has no concept
// of Pi Network, so anything imported from here is tagged "BTC", never
// "PI" — this importer will never by itself find a Pi-accepting
// restaurant. It's useful for the "already-known-crypto-friendly
// restaurants on the regular internet" half of the request; the Pi-side
// equivalent is `pi-directories.js` in this same folder, which is
// currently a stub (see that file for why).
//
// NOTE: field names below follow Coinmap's documented list-mode response
// shape as of this writing. If Coinmap changes their API, verify the
// shape with a plain fetch before trusting this in production.

const COINMAP_API = "https://coinmap.org/api/v1/venues/";

const FOOD_CATEGORIES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "bakery",
  "fastfood",
  "fast_food",
  "pub",
  "food",
  "foodtruck",
  "food_truck",
]);

async function fetchCoinmapVenues({ lat, lng, radiusKm }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    distance: String(radiusKm),
  });
  const res = await fetch(`${COINMAP_API}?${params.toString()}`);
  if (!res.ok) throw new Error(`Coinmap API error: ${res.status}`);
  const data = await res.json();
  const venues = Array.isArray(data.venues) ? data.venues : [];

  return venues
    .map((entry) => entry.venue ? { ...entry.venue, _id: entry.id } : null)
    .filter(Boolean)
    .filter((v) => FOOD_CATEGORIES.has(String(v.category || "").toLowerCase()))
    .filter((v) => v.lat != null && v.lon != null && v.name)
    .map((v) => ({
      external_source: "coinmap",
      external_id: String(v._id),
      name: v.name,
      address: [v.street, v.city, v.country].filter(Boolean).join(", "),
      lat: v.lat,
      lng: v.lon,
      cuisine: v.category || "",
      accepted_currencies: ["BTC"],
      source: "coinmap_import",
      note: "Coinmap (OpenStreetMapタグ) から自動取込。実際の受け付け状況が変わっている場合があります。",
    }));
}

module.exports = { fetchCoinmapVenues };
