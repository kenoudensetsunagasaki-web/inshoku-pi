// 飲食.Pi — crowdsourced tip submission (free, no Pi payment)
(function () {
  "use strict";

  applyI18n();
  const langToggle = document.getElementById("langToggle");
  langToggle.textContent = getLocale() === "ja" ? "EN" : "日本語";
  langToggle.addEventListener("click", () => {
    setLocale(getLocale() === "ja" ? "en" : "ja");
    applyI18n();
    langToggle.textContent = getLocale() === "ja" ? "EN" : "日本語";
  });

  let coords = null;

  const grid = document.getElementById("currencyGrid");
  CURRENCIES.forEach((c) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${c.code}" /> ${c.symbol} ${c.label}`;
    grid.appendChild(label);
  });

  const statusEl = document.getElementById("statusMsg");
  function showStatus(msg, ok) {
    statusEl.textContent = msg;
    statusEl.className = "status-msg show " + (ok ? "ok" : "err");
  }

  // ---- interactive map for coordinates ----
  // A tip is usually about someone else's shop, not the submitter's own
  // location, so the map (tap/drag or address geocode) is the primary way
  // to set the location — GPS is offered too, in case the submitter is
  // standing at the venue while filling this in.
  const DEFAULT_CENTER = [35.681236, 139.767125]; // Tokyo Station — just a starting view
  const map = L.map("locationMap").setView(DEFAULT_CENTER, 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  let marker = null;

  function setMarker(lat, lng, pan) {
    coords = { lat, lng };
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        coords = { lat: pos.lat, lng: pos.lng };
        updateCoordsPreview();
      });
    }
    if (pan) map.setView([lat, lng], 17);
    updateCoordsPreview();
  }

  function updateCoordsPreview() {
    document.getElementById("lat").value = coords.lat;
    document.getElementById("lng").value = coords.lng;
    document.getElementById("coordsPreview").textContent =
      `${t("coordsCaptured")}: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  }

  map.on("click", (e) => {
    setMarker(e.latlng.lat, e.latlng.lng, false);
  });

  document.getElementById("useLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMarker(pos.coords.latitude, pos.coords.longitude, true),
      (err) => alert("Could not get location: " + err.message)
    );
  });

  async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }

  const geocodeBtn = document.getElementById("geocodeBtn");
  geocodeBtn.addEventListener("click", async () => {
    const address = document.getElementById("address").value.trim();
    if (!address) {
      showStatus(t("required"), false);
      return;
    }
    geocodeBtn.disabled = true;
    const originalLabel = geocodeBtn.textContent;
    geocodeBtn.textContent = t("geocoding");
    try {
      const result = await geocodeAddress(address);
      if (!result) {
        showStatus(t("geocodeError"), false);
      } else {
        setMarker(result.lat, result.lng, true);
      }
    } catch (e) {
      showStatus(t("geocodeError"), false);
    } finally {
      geocodeBtn.disabled = false;
      geocodeBtn.textContent = originalLabel;
    }
  });

  document.getElementById("subForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const selectedCurrencies = [...grid.querySelectorAll("input:checked")].map((i) => i.value);
    if (selectedCurrencies.length === 0) {
      showStatus(t("selectAtLeastOne"), false);
      return;
    }

    // Same safety net as the store-registration form: if the submitter
    // typed an address but never touched the map, try one automatic
    // geocode before giving up, instead of silently sending no location.
    if (!coords) {
      const address = document.getElementById("address").value.trim();
      if (address) {
        try {
          const result = await geocodeAddress(address);
          if (result) setMarker(result.lat, result.lng, true);
        } catch (e) {
          /* ignore — handled by the coords check below */
        }
      }
    }
    if (!coords) {
      showStatus(t("coordsRequired"), false);
      return;
    }

    const tip = {
      name: document.getElementById("name").value.trim(),
      address: document.getElementById("address").value.trim(),
      lat: coords.lat,
      lng: coords.lng,
      accepted_currencies: selectedCurrencies,
      hours: document.getElementById("hours").value.trim(),
      menu_highlights: document
        .getElementById("menuHighlights")
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      note: document.getElementById("note").value.trim(),
      contact: document.getElementById("contact").value.trim(),
      source: "user_submitted",
    };

    fetch("/api/restaurants/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tip),
    })
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then(() => {
        showStatus(t("subSuccess"), true);
        document.getElementById("subForm").reset();
        document.getElementById("coordsPreview").textContent = "";
        coords = null;
        if (marker) {
          map.removeLayer(marker);
          marker = null;
        }
        map.setView(DEFAULT_CENTER, 5);
      })
      .catch(() => showStatus(t("subError"), false));
  });
})();
