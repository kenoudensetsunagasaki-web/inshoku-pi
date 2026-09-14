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

  const LISTING_FEE_PI = 3;
  let piUser = null;
  let coords = null;

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
      lat: coords.lat,
      lng: coords.lng,
      accepted_currencies: selectedCurrencies,
      source: "self_registered",
      submitted_by: piUser.username,
    };

    payBtn.disabled = true;
    payBtn.textContent = t("processingPayment");

    try {
      await Pi.createPayment(
        {
          amount: LISTING_FEE_PI,
          memo: `飲食.Pi listing: ${restaurant.name}`,
          metadata: { type: "restaurant_listing", restaurant },
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
              body: JSON.stringify({ paymentId, txid, restaurant }),
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
