// Placeholder for Pi Network's own merchant directories — Map of Pi
// (github.com/map-of-pi), Piketplace, and similar community dApps.
//
// As of writing, none of these publish a documented public API for
// third-party querying:
//   - Map of Pi's backend is open source, but it's a specific team's
//     Node/MongoDB service with its own auth — not an open data feed.
//   - Piketplace doesn't publish an API either.
// Scraping their app/web UI directly would be fragile (breaks on every
// redesign) and likely against their terms of service, so this module
// intentionally does nothing yet rather than fake a working integration.
//
// Two real paths forward:
//   1. Contact the Map of Pi / Piketplace teams about API or data-sharing
//      access — plausible, since you're both building in the same
//      ecosystem.
//   2. Until then, use /admin.html to manually cross-reference listings
//      you find in those apps — this is exactly the "運営が手動で調査・
//      入力する" path already built into this project.
//
// Once real access exists, implement fetchCandidates({lat,lng,radiusKm})
// to return the same shape as importers/coinmap.js's output so it plugs
// straight into the same review queue (see routes/admin.js).
async function fetchCandidates(/* { lat, lng, radiusKm } */) {
  return [];
}

module.exports = { fetchCandidates };
