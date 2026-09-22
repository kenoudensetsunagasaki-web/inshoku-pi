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

  // ---- interactive map for coordinates ----
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

  // ---- coordinates: GPS ----
  document.getElementById("useLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMarker(pos.coords.latitude, pos.coords.longitude, true);
      },
      (err) => alert("Could not get location: " + err.message)
    );
  });

  // ---- coordinates: geocode from address ----
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

  // ---- submit: create payment, then register on completion ----
  document.getElementById("regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!piUser) {
      showStatus(t("piRequired"), false);
      return;
    }

    // If the owner never tapped the map or a geocode/GPS button, try one
    // last automatic geocode from the typed address before giving up — but
    // the map is now the primary, reliable way to set the location.
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

    const selectedCurrencies = [...grid.querySelectorAll("input:checked")].map((i) => i.value);
    if (selectedCurrencies.length === 0) {
      showStatus(t("selectAtLeastOne"), false);
      return;
    }

    const restaurant = {
      name: document.getElementById("name").value.trim(),
      name_en: document.getElementById("nameEn").value.trim(),
      address: document.getElementById("address").value.trim(),
      cuisine: document.getElementById("cuisine").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      website: document.getElementById("website").value.trim(),
      hours: document.getElementById("hours").value.trim(),
      menu_highlights: document
        .getElementById("menuHighlights")
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      lat: coords.lat,
      lng: coords.lng,
      accepted_currencies: selectedCurrencies,
      source: "self_registered",
      submitted_by: piUser.username,
    };

    payBtn.disabled = true;
    payBtn.textContent = t("processingPayment");

    // ---- Testnet period: skip Pi payment entirely, register for free ----
    if (freeRegistration) {
      fetch("/api/restaurants/free-register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${piAccessToken}`,
        },
        body: JSON.stringify(restaurant),
      })
        .then((r) => {
          if (!r.ok) throw new Error("failed");
          return r.json();
        })
        .then(() => {
          showStatus(t("regSuccess"), true);
          payBtn.disabled = false;
          payBtn.textContent = t("payAndListFree");
          document.getElementById("regForm").reset();
        })
        .catch(() => {
          showStatus(t("regError"), false);
          payBtn.disabled = false;
          payBtn.textContent = t("payAndListFree");
        });
      return;
    }

    try {
      await Pi.createPayment(
        {
          amount: LISTING_FEE_PI,
          memo: `飲食.Pi listing (1st month): ${restaurant.name}`,
          metadata: { type: "new_listing", restaurant },
        },
        {
          onReadyForServerApproval: (paymentId) => {
            fetch("/api/payments/approve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentId }),
            });
          },
          onReadyForServerCompletion: (paymentId, txid) => {
            fetch("/api/payments/complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentId, txid, paymentType: "new_listing", restaurant }),
            })
              .then((r) => r.json())
              .then(() => {
                showStatus(t("regSuccess"), true);
                payBtn.textContent = t("payAndList");
                document.getElementById("regForm").reset();
              })
              .catch(() => {
                showStatus(t("regError"), false);
                payBtn.disabled = false;
                payBtn.textContent = t("payAndList");
              });
          },
          onCancel: () => {
            payBtn.disabled = false;
            payBtn.textContent = t("payAndList");
          },
          onError: () => {
            showStatus(t("regError"), false);
            payBtn.disabled = false;
            payBtn.textContent = t("payAndList");
          },
        }
      );
    } catch (err) {
      showStatus(t("regError"), false);
      payBtn.disabled = false;
      payBtn.textContent = t("payAndList");
    }
  });
})();
