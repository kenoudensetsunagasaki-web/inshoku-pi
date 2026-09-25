// 飲食.Pi — search page logic
(function () {
  "use strict";

  const state = {
    userLoc: null, // {lat, lng}
    radiusKm: "3", // "1".."100" or "unlimited"
    activeCurrencies: new Set(), // empty = all
    verifiedOnly: false,
    travelMode: "WALKING", // WALKING | DRIVING | TRANSIT
    map: null,
    markers: [],
    userMarker: null,
    routeLine: null,
    piUser: null,
    lowDataMode: localStorage.getItem("ip_low_data") === "true",
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

  // ---------- low-data mode (offline/low-bandwidth support) ----------
  // The map (OpenStreetMap tiles) is by far the heaviest thing this page
  // loads. Turning it off skips tile requests entirely and reloads so the
  // map never gets created in the first place — everything else (search,
  // directions link, reviews) keeps working exactly as before, since the
  // rest of the app already null-checks state.map.
  const lowDataChip = document.getElementById("lowDataChip");
  lowDataChip.classList.toggle("active", state.lowDataMode);
  document.getElementById("map").style.display = state.lowDataMode ? "none" : "";
  lowDataChip.addEventListener("click", () => {
    const next = !state.lowDataMode;
    localStorage.setItem("ip_low_data", String(next));
    location.reload();
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
    state.radiusKm = e.target.value; // "1".."100" or "unlimited"
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
  if (!state.lowDataMode) initMap();

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
  const CACHE_KEY = "ip_last_results";
  const offlineBanner = document.getElementById("offlineBanner");

  function showOfflineBanner(show) {
    offlineBanner.classList.toggle("show", show);
    offlineBanner.textContent = t("offlineBanner");
  }

  function cacheResults(results) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ results, cachedAt: Date.now() }));
    } catch {
      /* localStorage full/unavailable — offline cache just won't work, no big deal */
    }
  }

  function loadCachedResults() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw).results : null;
    } catch {
      return null;
    }
  }

  function fetchResults() {
    const params = new URLSearchParams({
      lat: state.userLoc.lat,
      lng: state.userLoc.lng,
      radius: state.radiusKm, // backend treats "unlimited" as no distance cap
    });
    if (state.activeCurrencies.size > 0) {
      params.set("currencies", [...state.activeCurrencies].join(","));
    }
    if (state.verifiedOnly) params.set("verifiedOnly", "true");

    fetch(`/api/restaurants/search?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        showOfflineBanner(false);
        lastResults = data.results || [];
        cacheResults(lastResults);
        renderResults(lastResults);
        renderMarkers(lastResults);
      })
      .catch(() => {
        // Offline, or the API server is unreachable — the service worker
        // may already have served a cached response for this exact query;
        // if not (e.g. first load with no connection at all), fall back to
        // whatever we last successfully fetched, from localStorage.
        const cached = loadCachedResults();
        if (cached && cached.length > 0) {
          showOfflineBanner(true);
          lastResults = cached;
          renderResults(lastResults);
          renderMarkers(lastResults);
        } else {
          document.getElementById("resultsCount").textContent = "—";
          document.getElementById("results").innerHTML =
            '<div class="empty-state"><div class="title">通信エラー</div>API サーバーに接続できませんでした。</div>';
        }
      });
  }

  window.addEventListener("online", () => {
    showOfflineBanner(false);
    if (state.userLoc) fetchResults();
  });
  window.addEventListener("offline", () => showOfflineBanner(true));

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

    const now = Date.now();
    const isSponsored = r.sponsored && r.sponsored_until && new Date(r.sponsored_until).getTime() > now;

    const currencyBadges = (r.accepted_currencies || [])
      .map((c) => `<span class="badge currency">${currencyLabel(c)}</span>`)
      .join("");

    const ratingSummary = r.rating_count > 0
      ? `<div class="rating-summary"><span class="stars">${starString(r.rating_avg)}</span> ${r.rating_avg.toFixed(1)} (${r.rating_count} ${t("reviewsCount")})</div>`
      : "";

    card.innerHTML = `
      <div class="stall-top">
        <div>
          <div class="stall-name">${isSponsored ? '<span style="color:var(--accent-lantern);font-size:11px;font-weight:700;margin-right:4px;">PR</span>' : ""}${escapeHtml(r.name)}</div>
          <div class="stall-meta">${escapeHtml(r.cuisine || "")}${r.cuisine ? " · " : ""}${escapeHtml(r.address || "")}</div>
          ${ratingSummary}
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
      <button class="detail-toggle" data-action="toggleDetail">${t("viewDetails")}</button>
      <div class="stall-detail" data-role="detail"></div>
    `;

    card.querySelector('[data-action="toggleDetail"]').addEventListener("click", (e) => {
      const detailEl = card.querySelector('[data-role="detail"]');
      const isOpen = detailEl.classList.toggle("open");
      e.currentTarget.textContent = isOpen ? t("hideDetails") : t("viewDetails");
      if (isOpen && !detailEl.dataset.loaded) {
        detailEl.dataset.loaded = "true";
        renderDetail(detailEl, r);
      }
    });

    const dirBtn = card.querySelector('[data-action="directions"]');
    const openLink = card.querySelector('[data-action="open"]');
    const gmapsUrl = buildGmapsUrl(r);
    openLink.href = gmapsUrl;
    openLink.addEventListener("click", () => trackEvent(r.id, "gmaps"));

    dirBtn.addEventListener("click", () => {
      trackEvent(r.id, "directions");
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

  function starString(avg) {
    const full = Math.round(avg);
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  // Detail panel is built lazily (only when the user expands a card) and
  // fetches the full restaurant record — reviews aren't included in the
  // lightweight /search response, keeping that endpoint fast and small
  // for low-bandwidth users.
  function renderDetail(detailEl, r) {
    detailEl.innerHTML = `<div class="detail-row">${t("hours")}: …</div>`;
    fetch(`/api/restaurants/${r.id}`)
      .then((res) => res.json())
      .then((full) => {
           const hoursHtml = `<div class="detail-row"><strong>${t("hours")}</strong>${full.hours ? escapeHtml(full.hours) : `<span style="color:var(--text-faint);">${t("noHours")}</span>`}</div>`;
        const websiteHtml = full.website
          ? `<div class="detail-row"><a href="${escapeHtml(full.website)}" target="_blank" rel="noopener" style="color:var(--accent-mint);">${t("visitWebsite")} ↗</a></div>`
          : "";
        const menuItems = full.menu_highlights || [];
        const menuHtml = `<div class="detail-row"><strong>${t("menuHighlightsShort")}</strong>${
          menuItems.length
            ? "<ul>" + menuItems.map((m) => `<li>${escapeHtml(m)}</li>`).join("") + "</ul>"
            : `<span style="color:var(--text-faint);">${t("noMenu")}</span>`
        }</div>`;

        const reviews = (full.reviews || []).filter((rv) => rv.status !== "hidden").slice().reverse();
        const reviewListHtml = reviews.length
          ? `<div class="review-list">${reviews
              .map(
                (rv) => `<div class="review-item">
                  <span class="stars">${starString(rv.rating)}</span>
                  <span class="review-author">${escapeHtml(rv.author || t("anonymous"))}</span>
                  ${rv.comment ? `<div class="review-comment">${escapeHtml(rv.comment)}</div>` : ""}
                </div>`
              )
              .join("")}</div>`
          : `<div class="detail-row" style="color:var(--text-faint);">${t("noReviews")}</div>`;

               detailEl.innerHTML = `
          ${hoursHtml}
          ${websiteHtml}
          ${menuHtml}
          <div class="detail-row"><strong>${t("reviews")} (${full.rating_count || 0})</strong></div>
          ${reviewListHtml}
          <div class="review-form">
            <div class="detail-row" style="margin-bottom:4px;"><strong>${t("writeReview")}</strong></div>
            <div class="star-picker" data-role="starPicker">
              ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}">★</button>`).join("")}
            </div>
            <input type="text" data-role="reviewName" placeholder="${t("yourName")}" />
            <textarea data-role="reviewComment" placeholder="${t("yourComment")}"></textarea>
            <button type="button" class="submit-btn mint" data-role="submitReview">${t("submitReview")}</button>
            <div class="status-msg" data-role="reviewStatus"></div>
          </div>
        `;

        let selectedStars = 0;
        const starBtns = [...detailEl.querySelectorAll('[data-role="starPicker"] button')];
        starBtns.forEach((btn) => {
          btn.addEventListener("click", () => {
            selectedStars = Number(btn.dataset.star);
            starBtns.forEach((b) => b.classList.toggle("on", Number(b.dataset.star) <= selectedStars));
          });
        });

        const reviewStatusEl = detailEl.querySelector('[data-role="reviewStatus"]');
        detailEl.querySelector('[data-role="submitReview"]').addEventListener("click", () => {
          if (selectedStars < 1) {
            reviewStatusEl.textContent = t("ratingRequired");
            reviewStatusEl.className = "status-msg show err";
            return;
          }
          const author = detailEl.querySelector('[data-role="reviewName"]').value.trim();
          const comment = detailEl.querySelector('[data-role="reviewComment"]').value.trim();
          fetch(`/api/restaurants/${r.id}/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating: selectedStars, comment, author }),
          })
            .then((res) => {
              if (!res.ok) throw new Error("failed");
              return res.json();
            })
            .then(() => {
              reviewStatusEl.textContent = t("reviewSuccess");
              reviewStatusEl.className = "status-msg show ok";
              detailEl.dataset.loaded = ""; // force reload of the detail panel next time
              renderDetail(detailEl, r);
              if (state.userLoc) fetchResults(); // refresh the card's rating summary too
            })
            .catch(() => {
              reviewStatusEl.textContent = t("reviewError");
              reviewStatusEl.className = "status-msg show err";
            });
        });
      })
      .catch(() => {
        detailEl.innerHTML = `<div class="detail-row">${t("noHours")}</div>`;
      });
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

  // Fire-and-forget click tracking for the store-owner dashboard (マイ店舗).
  function trackEvent(restaurantId, event) {
    fetch(`/api/restaurants/${restaurantId}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    }).catch(() => {});
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
