// 飲食.Pi — store self-registration + Pi payment
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

    const LISTING_FEE_PI = 1; // per month — see onReadyForServerCompletion below
  let piUser = null;
  let piAccessToken = null;
  let coords = null;
  let freeRegistration = false; // set from /api/config below — server-controlled, never client-decided

  // ---- Testnet-period free registration banner ----
  // Checked against the server on every load; the server is the only thing
  // that can actually turn this on (see FREE_REGISTRATION_TESTNET in
  // .env.example), so there's nothing to spoof by editing this file.
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      freeRegistration = !!cfg.freeRegistration;
      const banner = document.getElementById("freeRegistrationBanner");
      if (freeRegistration && banner) {
        banner.textContent = t("freeRegistrationBanner");
        banner.classList.add("show");
      }
      if (freeRegistration) payBtn.textContent = t("payAndListFree");
    })
    .catch(() => {});

  // currency checkboxes
  const grid = document.getElementById("currencyGrid");
  CURRENCIES.forEach((c) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${c.code}" /> ${c.symbol} ${c.label}`;
    grid.appendChild(label);
  });

  const payBtn = document.getElementById("payBtn");
  const statusEl = document.getElementById("statusMsg");
  const authStatusEl = document.getElementById("piAuthStatus");

  function showStatus(msg, ok) {
    statusEl.textContent = msg;
    statusEl.className = "status-msg show " + (ok ? "ok" : "err");
  }

  // ---- Pi auth (required before payment) ----
  (async function initPi() {
    try {
      await Pi.init({ version: "2.0", sandbox: false });
           const auth = await Pi.authenticate(["username", "payments"], onIncompletePaymentFound);
      piUser = auth.user;
      piAccessToken = auth.accessToken;
      authStatusEl.textContent = `${t("piSignedIn")}: ${piUser.username}`;
      payBtn.disabled = false;
    } catch (e) {
      console.warn("Pi auth unavailable:", e);
      authStatusEl.textContent = t("piRequired");
      payBtn.disabled = true;
    }
  })();

  function onIncompletePaymentFound(payment) {
    fetch("/api/payments/incomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment }),
    }).catch(() => {});
  }

  // ---- interactive map for picking the exact location ----
  // Leaflet + OpenStreetMap tiles — free, no API key needed. Tapping the
  // map or dragging the pin is the primary way to set coordinates now;
  // address-lookup and GPS below are just shortcuts that move the same pin.
  const map = L.map("locationMap").setView([36.2048, 138.2529], 5); // Japan-wide default view
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
  let marker = null;

  function setMarker(lat, lng, pan) {
    coords = { lat, lng };
    document.getElementById("lat").value = lat;
    document.getElementById("lng").value = lng;
    document.getElementById("coordsPreview").textContent =
      `${t("coordsCaptured")}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setMarker(pos.lat, pos.lng, false);
      });
    }
    if (pan) map.setView([lat, lng], 16);
  }

  map.on("click", (e) => {
    setMarker(e.latlng.lat, e.latlng.lng, false);
  });

  // Option 1: geocode the typed address (via OpenStreetMap's free Nominatim
  // API) — moves the pin there automatically so the owner can just confirm
  // or nudge it, instead of typing anything.
  document.getElementById("geocodeBtn").addEventListener("click", async () => {
    const address = document.getElementById("address").value.trim();
    if (!address) {
      alert(t("required"));
      return;
    }
    const btn = document.getElementById("geocodeBtn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("geocoding");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
      );
      const data = await res.json();
      if (!data.length) {
        alert(t("geocodeError"));
        return;
      }
      setMarker(parseFloat(data[0].lat), parseFloat(data[0].lon), true);
    } catch (err) {
      alert(t("geocodeError"));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Option 2: use the device's actual GPS location (moves the pin there too).
  document.getElementById("useLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMarker(pos.coords.latitude, pos.coords.longitude, true),
      (err) => alert("Could not get location: " + err.message)
    );
  });

  // ---- submit: create payment, then register on completion ----
  document.getElementById("regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!piUser) {
      showStatus(t("piRequired"), false);
      return;
    }
    const selectedCurrencies = [...grid.querySelectorAll("input:checked")].map((i) => i.value);
    if (selectedCurrencies.length === 0) {
      showStatus(t("selectAtLeastOne"), false);
      return;
    }

    // If no pin has been placed on the map yet, try geocoding the typed
    // address automatically before asking the owner to do anything extra.
    if (!coords) {
      const address = document.getElementById("address").value.trim();
      if (!address) {
