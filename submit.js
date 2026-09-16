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

  const statusEl = document.getElementById("statusMsg");
  function showStatus(msg, ok) {
    statusEl.textContent = msg;
    statusEl.className = "status-msg show " + (ok ? "ok" : "err");
  }

  document.getElementById("subForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const selectedCurrencies = [...grid.querySelectorAll("input:checked")].map((i) => i.value);
    if (selectedCurrencies.length === 0) {
      showStatus(t("selectAtLeastOne"), false);
      return;
    }
    const tip = {
      name: document.getElementById("name").value.trim(),
      address: document.getElementById("address").value.trim(),
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
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
      })
      .catch(() => showStatus(t("subError"), false));
  });
})();
