// 飲食.Pi — search page logic
(function () {
  "use strict";

  const state = {
    userLoc: null, // {lat, lng}
    radiusKm: 3,
    activeCurrencies: new Set(), // empty = all
    verifiedOnly: false,
    travelMode: "WALKING", // WALKING | DRIVING | TRANSIT
    map: null,
    markers: [],
    userMarker: null,
    routeLine: null,
    piUser: null,
  };

  // ---------- i18n / locale toggle ----------
  applyI18n();
  document.title = t("appName") + " — " + t("tagline");
  const langToggle = document.getElementById("langToggle");
  function refreshLangBtn() {
    langToggle.textContent = getLocale() === "ja" ? "EN" : "日本語";
  }
  refreshLangBtn();
  langToggle.addEventListener("click", () => {
    setLocale(getLocale() === "ja" ? "en" : "ja");
    applyI18n();
    refreshLangBtn();
    renderResults(lastResults);
  });

  // ---------- currency chips ----------
  const chipRow = document.getElementById("currencyChips");
  const allChip = document.createElement("button");
  allChip.className = "chip active";
  allChip.textContent = t("all");
  allChip.dataset.all = "true";
  chipRow.appendChild(allChip);

  CURRENCIES.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = `${c.symbol} ${c.code}`;
    chip.dataset.code = c.code;
    chipRow.appendChild(chip);
  });

  chipRow.addEventListener("click", (e) => {
    const el = e.target.closest(".chip");
    if (!el) return;
    if (el.dataset.all) {
      state.activeCurrencies.clear();
      [...chipRow.children].forEach((c) => c.classList.remove("active"));
      el.classList.add("active");
    } else {
      allChip.classList.remove("active");
      const code = el.dataset.code;
      if (state.activeCurrencies.has(code)) {
        state.activeCurrencies.delete(code);
        el.classList.remove("active");
      } else {
        state.activeCurrencies.add(code);
        el.classList.add("active");
      }
      if (state.activeCurrencies.size === 0) allChip.classList.add("active");
    }
    if (state.userLoc) fetchResults();
  });

  document.getElementById("verifiedOnlyChip").addEventListener("click", (e) => {
    state.verifiedOnly = !state.verifiedOnly;
    e.currentTarget.classList.toggle("active", state.verifiedOnly);
    if (state.userLoc) fetchResults();
  });

  // ---------- travel mode ----------
  const travelChipRow = document.getElementById("travelModeChips");
  travelChipRow.addEventListener("click", (e) => {
    const el = e.target.closest(".chip");
    if (!el) return;
    state.travelMode = el.dataset.mode;
    [...travelChipRow.children].forEach((c) => c.classList.remove("active"));
    el.classList.add("active");
    // Rebuild cards so their directions/links reflect the new travel mode.
    if (lastResults.length) renderResults(lastResults);
  });

  document.getElementById("radiusSelect").addEventListener("change", (e) => {
    state.radiusKm = Number(e.target.value);
    if (state.userLoc) fetchResults();
  });

  // ---------- Map (Leaflet + OpenStreetMap — free, no API key, no billing) ----------
  function initMap() {
    state.map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
      [35.681236, 139.767125], // Tokyo Station, default before geolocation
      12
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(state.map);
  }
  initMap();

  // ---------- locate ----------
  const locateBtn = document.getElementById("locateBtn");
  const locateLabel = document.getElementById("locateBtnLabel");

  locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported on this device.");
      return;
    }
    locateBtn.dataset.busy = "true";
    locateLabel.textContent = t("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locateBtn.dataset.busy = "false";
        locateLabel.textContent = t("locateBtn");
        if (state.map) {
          state.map.setView([state.userLoc.lat, state.userLoc.lng], 14);
          if (state.userMarker) state.map.removeLayer(state.userMarker);
          state.userMarker = L.circleMarker([state.userLoc.lat, state.userLoc.lng], {
            radius: 7,
            color: "#12151c",
            weight: 2,
            fillColor: "#46d6b3",
            fillOpacity: 1,
          })
            .addTo(state.map)
            .bindTooltip("You");
        }
        fetchResults();
      },
      (err) => {
        locateBtn.dataset.busy = "false";
        locateLabel.textContent = t("locateBtn");
        alert("Could not get your location: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // ---------- fetch + render ----------
  let lastResults = [];

  function fetchResults() {
    const params = new URLSearchParams({
      lat: state.userLoc.lat,
      lng: state.userLoc.lng,
      radius: state.radiusKm,
    });
    if (state.activeCurrencies.size > 0) {
      params.set("currencies", [...state.activeCurrencies].join(","));
    }
    if (state.verifiedOnly) params.set("verifiedOnly", "true");

    fetch(`/api/restaurants/search?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        lastResults = data.results || [];
        renderResults(lastResults);
        renderMarkers(lastResults);
      })
      .catch(() => {
        document.getElementById("resultsCount").textContent = "—";
        document.getElementById("results").innerHTML =
          '<div class="empty-state"><div class="title">通信エラー</div>API サーバーに接続できませんでした。</div>';
      });
  }

  function clearMarkers() {
    state.markers.forEach((m) => state.map.removeLayer(m));
    state.markers = [];
  }

  function renderMarkers(list) {
    clearMarkers();
    if (!state.map) return;
    list.forEach((r) => {
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 6,
        color: "#12151c",
        weight: 1.5,
        fillColor: tierColor(r.status, r.source),
        fillOpacity: 1,
      })
        .addTo(state.map)
        .bindTooltip(r.name);
      state.markers.push(marker);
    });
  }

  function tierColor(status, source) {
    if (source === "coinmap_import") return "#6c9bf0";
    if (status === "verified" && source === "admin") return "#46d6b3";
    if (source === "self_registered") return "#e8a33d";
    return "#8d93a3";
  }

  function tierInfo(r) {
    if (r.source === "coinmap_import") return { css: "external", label: t("tierExternal") };
    if (r.status === "verified" && r.source === "admin") return { css: "admin", label: t("tierAdmin") };
    if (r.source === "self_registered") return { css: "self", label: t("tierSelf") };
    return { css: "community", label: t("tierCommunity") };
  }

  function renderResults(list) {
    const el = document.getElementById("results");
    const countEl = document.getElementById("resultsCount");
    if (!state.userLoc) {
      countEl.textContent = "—";
      el.innerHTML = "";
      return;
    }
    countEl.textContent = `${list.length} ${t("resultsFound")}`;
    if (list.length === 0) {
      el.innerHTML = `<div class="empty-state">
        <div class="title">${t("noResults")}</div>
        <div>${t("noResultsSub")}</div>
      </div>`;
      return;
    }
    el.innerHTML = "";
    list.forEach((r) => el.appendChild(buildCard(r)));
  }

  function buildCard(r) {
    const tier = tierInfo(r);
    const card = document.createElement("div");
    card.className = "stall-card";
    card.dataset.tier = tier.css;

    const currencyBadges = (r.accepted_currencies || [])
      .map((c) => `<span class="badge currency">${currencyLabel(c)}</span>`)
      .join("");

    card.innerHTML = `
      <div class="stall-top">
        <div>
          <div class="stall-name">${escapeHtml(r.name)}</div>
          <div class="stall-meta">${escapeHtml(r.cuisine || "")}${r.cuisine ? " · " : ""}${escapeHtml(r.address || "")}</div>
        </div>
        <div class="stall-dist">${r.distance_km != null ? r.distance_km.toFixed(1) + " km " + t("away") : ""}</div>
      </div>
      <div class="badge-row">
        <span class="badge trust-${tier.css}">${tier.label}</span>
        ${currencyBadges}
      </div>
      <div class="stall-actions">
        <button class="action-btn primary" data-action="directions">${t("directions")}</button>
        <a class="action-btn" data-action="open" target="_blank" rel="noopener">Google Maps ↗</a>
      </div>
    `;

    const dirBtn = card.querySelector('[data-action="directions"]');
    const openLink = card.querySelector('[data-action="open"]');
    const gmapsUrl = buildGmapsUrl(r);
    openLink.href = gmapsUrl;

    dirBtn.addEventListener("click", () => {
      if (!state.userLoc || !state.map) {
        window.open(gmapsUrl, "_blank");
        return;
      }
      // We don't call any routing API here (that's what keeps this free with
      // no usage limits) — instead we draw a straight preview line so the
      // person can see roughly where the place is and how far, then hand
      // off to the Google Maps app/site for the actual turn-by-turn route.
      if (state.routeLine) state.map.removeLayer(state.routeLine);
      const from = [state.userLoc.lat, state.userLoc.lng];
      const to = [r.lat, r.lng];
      state.routeLine = L.polyline([from, to], {
        color: "#46d6b3",
        weight: 3,
        dashArray: "6 8",
      }).addTo(state.map);
      state.map.fitBounds(L.latLngBounds([from, to]), { padding: [40, 40] });
      document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return card;
  }

  const GMAPS_TRAVELMODE = { WALKING: "walking", DRIVING: "driving", TRANSIT: "transit" };

  function buildGmapsUrl(r) {
    const dest = `${r.lat},${r.lng}`;
    const origin = state.userLoc ? `${state.userLoc.lat},${state.userLoc.lng}` : "";
    const params = new URLSearchParams({
      api: "1",
      destination: dest,
      travelmode: GMAPS_TRAVELMODE[state.travelMode] || "walking",
    });
    if (origin) params.set("origin", origin);
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- Pi auth ----------
  const piBtn = document.getElementById("piSignIn");
  piBtn.addEventListener("click", async () => {
    if (state.piUser) return;
    try {
      await Pi.init({ version: "2.0", sandbox: false });
      const scopes = ["username", "payments"];
      const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
      state.piUser = auth.user;
      piBtn.textContent = `${t("piSignedIn")}: ${auth.user.username}`;
      piBtn.classList.add("active");
    } catch (e) {
      console.warn("Pi auth unavailable (likely not in Pi Browser):", e);
    }
  });

  function onIncompletePaymentFound(payment) {
    // Forward to backend so a previously-started listing payment can be
    // resolved even if the browser was closed mid-flow.
    fetch("/api/payments/incomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment }),
    }).catch(() => {});
  }
})();
