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

        const LISTING_FEE_PI = 1; // per 6 months (180 days) — see onReadyForServerCompletion below
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

   // ---- coordinates ----
  // Option 1: geocode the typed address (via OpenStreetMap's free Nominatim
  // API — no API key needed) so an owner can register without having to
  // physically stand at the store.
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
      coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      document.getElementById("lat").value = coords.lat;
      document.getElementById("lng").value = coords.lng;
      document.getElementById("coordsPreview").textContent =
        `${t("coordsCaptured")}: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    } catch (err) {
      alert(t("geocodeError"));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Option 2: use the device's actual GPS location (more accurate when
  // physically on-site, but requires being there).
  document.getElementById("useLocationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById("lat").value = coords.lat;
        document.getElementById("lng").value = coords.lng;
        document.getElementById("coordsPreview").textContent =
          `${t("coordsCaptured")}: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      },
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
    if (!coords) {
      showStatus(t("useMyLocation"), false);
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
      email: document.getElementById("email").value.trim(),
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
                   memo: `飲食.Pi listing (6 months): ${restaurant.name}`,
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
