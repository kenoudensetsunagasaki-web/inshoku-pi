// 飲食.Pi — store owner dashboard (マイ店舗)
(function () {
  "use strict";

  applyI18n();
  const langToggle = document.getElementById("langToggle");
  langToggle.textContent = getLocale() === "ja" ? "EN" : "日本語";
  langToggle.addEventListener("click", () => {
    setLocale(getLocale() === "ja" ? "en" : "ja");
    applyI18n();
    langToggle.textContent = getLocale() === "ja" ? "EN" : "日本語";
    if (state.accessToken) loadMine();
  });

  const RENEWAL_FEE_PI = 1;
  const SPONSOR_FEE_PI = 2;

  const state = { accessToken: null, username: null };

  const signedOutView = document.getElementById("signedOutView");
  const listingsEl = document.getElementById("listings");

  document.getElementById("piSignInBtn").addEventListener("click", async () => {
    try {
      await Pi.init({ version: "2.0", sandbox: false });
      const auth = await Pi.authenticate(["username", "payments"], onIncompletePaymentFound);
      state.accessToken = auth.accessToken;
      state.username = auth.user.username;
      signedOutView.style.display = "none";
      loadMine();
    } catch (e) {
      console.warn("Pi auth unavailable (likely not in Pi Browser):", e);
      alert(t("piRequired"));
    }
  });

  function onIncompletePaymentFound(payment) {
    fetch("/api/payments/incomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment }),
    }).catch(() => {});
  }

  function loadMine() {
    fetch("/api/restaurants/mine", {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => renderListings(data.results || []))
      .catch(() => {
        listingsEl.innerHTML = `<div class="empty-state">${t("myStoreError")}</div>`;
      });
  }

  function daysLeft(isoDate) {
    if (!isoDate) return null;
    return Math.ceil((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }

  function renderListings(list) {
    if (list.length === 0) {
      listingsEl.innerHTML = `<div class="empty-state">
        <div class="title">${t("myStoreNone")}</div>
        <div><a href="/register.html" style="color:var(--accent-mint);">${t("navRegister")}</a></div>
      </div>`;
      return;
    }
    listingsEl.innerHTML = "";
    list.forEach((r) => listingsEl.appendChild(buildListingCard(r)));
  }

  function buildListingCard(r) {
    const card = document.createElement("div");
    card.className = "stall-card";
    card.dataset.tier = r.source === "self_registered" ? "self" : "admin";

    const expDays = daysLeft(r.listing_expires_at);
    const expired = expDays != null && expDays < 0;
    const sponsorDays = daysLeft(r.sponsored_until);
    const isSponsored = r.sponsored && sponsorDays != null && sponsorDays > 0;
    // Testnet-campaign free listings have no expires_at and were never paid
    // for — no renewal is ever needed, so don't show the renew button or it
    // reads as "you owe money" to an owner who registered for free.
    const isFreeCampaignListing = r.source === "self_registered" && !r.listing_paid && r.listing_expires_at == null;

    const stats = r.stats || { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 };

    card.innerHTML = `
      <div class="stall-top">
        <div class="stall-name">${escapeHtml(r.name)}</div>
      </div>
      <div class="stall-meta">${escapeHtml(r.address || "")}</div>
      <div class="badge-row">
        ${isFreeCampaignListing ? `<span class="badge currency">${t("myStoreFreeCampaign")}</span>` : ""}
        ${expired ? `<span class="badge" style="color:var(--accent-danger);border-color:var(--accent-danger);">${t("myStoreExpired")}</span>` : ""}
        ${!expired && expDays != null ? `<span class="badge currency">${t("myStoreDaysLeft").replace("{n}", expDays)}</span>` : ""}
        ${isSponsored ? `<span class="badge trust-self">PR · ${t("myStoreDaysLeft").replace("{n}", sponsorDays)}</span>` : ""}
      </div>
      <div class="stall-meta" style="margin-top:10px;">
        ${t("myStoreImpressions")}: <strong style="color:var(--text-primary);">${stats.impressions}</strong>
        &nbsp;·&nbsp;
        ${t("myStoreDirectionsClicks")}: <strong style="color:var(--text-primary);">${stats.directions_clicks}</strong>
        &nbsp;·&nbsp;
        ${t("myStoreGmapsClicks")}: <strong style="color:var(--text-primary);">${stats.gmaps_clicks}</strong>
      </div>
      <div class="stall-actions">
        ${isFreeCampaignListing ? "" : `<button class="action-btn primary" data-action="renew">${t("myStoreRenew").replace("{fee}", RENEWAL_FEE_PI)}</button>`}
        <button class="action-btn" data-action="sponsor">${isSponsored ? t("myStoreExtendSponsor") : t("myStoreBecomeSponsor")}${" (" + SPONSOR_FEE_PI + "π)"}</button>
      </div>
      <button class="detail-toggle" data-action="toggleEdit">${t("myStoreEditInfo")}</button>
      <div class="stall-detail" data-role="editPanel">
        <div class="field">
          <label data-i18n="storeName">${t("storeName")}</label>
          <input type="text" data-role="editName" value="${escapeHtml(r.name || "")}" />
        </div>
        <div class="field">
          <label data-i18n="storeNameEn">${t("storeNameEn")}</label>
          <input type="text" data-role="editNameEn" value="${escapeHtml(r.name_en || "")}" />
        </div>
        <div class="field">
          <label data-i18n="address">${t("address")}</label>
          <input type="text" data-role="editAddress" value="${escapeHtml(r.address || "")}" />
        </div>
        <div class="field">
          <label data-i18n="cuisine">${t("cuisine")}</label>
          <input type="text" data-role="editCuisine" value="${escapeHtml(r.cuisine || "")}" />
        </div>
        <div class="field">
          <label data-i18n="phone">${t("phone")}</label>
          <input type="tel" data-role="editPhone" value="${escapeHtml(r.phone || "")}" />
        </div>
        <div class="field">
          <label data-i18n="website">${t("website")}</label>
          <input type="url" data-role="editWebsite" value="${escapeHtml(r.website || "")}" />
        </div>
        <div class="field">
          <label data-i18n="hours">${t("hours")}</label>
          <input type="text" data-role="editHours" value="${escapeHtml(r.hours || "")}" placeholder="${t("hoursPlaceholder")}" />
        </div>
        <div class="field">
          <label>${t("menuHighlights")}</label>
          <textarea data-role="editMenu" placeholder="${t("menuHighlightsPlaceholder")}">${escapeHtml((r.menu_highlights || []).join("\n"))}</textarea>
        </div>
        <div class="field">
          <label data-i18n="currencies">${t("currencies")}</label>
          <div class="checkbox-grid" data-role="editCurrencyGrid"></div>
        </div>
        <div class="field">
          <label data-i18n="address">緯度・経度</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="action-btn" data-action="editGeocode">${t("geocodeFromAddress")}</button>
            <button type="button" class="action-btn" data-action="editUseLocation">${t("useMyLocation")}</button>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <input type="number" step="any" data-role="editLat" value="${r.lat != null ? r.lat : ""}" placeholder="緯度 / Lat" style="flex:1;" />
            <input type="number" step="any" data-role="editLng" value="${r.lng != null ? r.lng : ""}" placeholder="経度 / Lng" style="flex:1;" />
          </div>
          <div class="stall-meta" style="margin-top:4px;font-size:12px;">${t("manualCoordsHint")}</div>
        </div>
        <div class="stall-actions">
          <button class="action-btn primary" data-action="saveEdit">${t("myStoreEditSave")}</button>
        </div>
        <div class="status-msg" data-role="editMsg"></div>
        <hr style="border:none;border-top:1px solid var(--border-color, #333);margin:16px 0;" />
        <button class="action-btn" data-action="deleteListing" style="color:var(--accent-danger);border-color:var(--accent-danger);">${t("myStoreDelete")}</button>
      </div>
      <div class="status-msg" data-role="msg"></div>
    `;

    // Populate the currency checkboxes, pre-checking whatever this listing
    // already accepts.
    const editCurrencyGrid = card.querySelector('[data-role="editCurrencyGrid"]');
    const acceptedSet = new Set(r.accepted_currencies || []);
    CURRENCIES.forEach((c) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" value="${c.code}" ${acceptedSet.has(c.code) ? "checked" : ""} /> ${c.symbol} ${c.label}`;
      editCurrencyGrid.appendChild(label);
    });

    // Coordinates are plain editable number inputs — the geocode/location
    // buttons just fill them in, but the owner can also type coordinates in
    // directly (e.g. looked up on Google Maps) when automatic lookup can't
    // find an address.
    const editLatInput = card.querySelector('[data-role="editLat"]');
    const editLngInput = card.querySelector('[data-role="editLng"]');

    card.querySelector('[data-action="editGeocode"]').addEventListener("click", async (e) => {
      const address = card.querySelector('[data-role="editAddress"]').value.trim();
      if (!address) {
        alert(t("required"));
        return;
      }
      const btn = e.currentTarget;
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
        editLatInput.value = parseFloat(data[0].lat);
        editLngInput.value = parseFloat(data[0].lon);
      } catch (err) {
        alert(t("geocodeError"));
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    card.querySelector('[data-action="editUseLocation"]').addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          editLatInput.value = pos.coords.latitude;
          editLngInput.value = pos.coords.longitude;
        },
        (err) => alert("Could not get location: " + err.message)
      );
    });

    const editPanel = card.querySelector('[data-role="editPanel"]');
    card.querySelector('[data-action="toggleEdit"]').addEventListener("click", (e) => {
      const open = editPanel.classList.toggle("open");
      e.currentTarget.textContent = open ? t("myStoreEditCancel") : t("myStoreEditInfo");
    });

    const editMsgEl = card.querySelector('[data-role="editMsg"]');
    card.querySelector('[data-action="saveEdit"]').addEventListener("click", async () => {
      const name = card.querySelector('[data-role="editName"]').value.trim();
      const name_en = card.querySelector('[data-role="editNameEn"]').value.trim();
      const address = card.querySelector('[data-role="editAddress"]').value.trim();
      const cuisine = card.querySelector('[data-role="editCuisine"]').value.trim();
      const phone = card.querySelector('[data-role="editPhone"]').value.trim();
      const website = card.querySelector('[data-role="editWebsite"]').value.trim();
      const hours = card.querySelector('[data-role="editHours"]').value.trim();
      const menu_highlights = card
        .querySelector('[data-role="editMenu"]')
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const accepted_currencies = [...editCurrencyGrid.querySelectorAll("input:checked")].map((i) => i.value);

      // Same auto-lookup fallback as the registration form: if the
      // coordinate fields are empty (e.g. address changed but coords
      // weren't refreshed), try geocoding the address automatically before
      // giving up.
      let latVal = parseFloat(editLatInput.value);
      let lngVal = parseFloat(editLngInput.value);
      if ((Number.isNaN(latVal) || Number.isNaN(lngVal)) && address) {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
          );
          const data = await res.json();
          if (data.length) {
            latVal = parseFloat(data[0].lat);
            lngVal = parseFloat(data[0].lon);
            editLatInput.value = latVal;
            editLngInput.value = lngVal;
          }
        } catch (err) {
          // fall through — patch just won't include lat/lng this time
        }
      }

      const patch = {
        name,
        name_en,
        address,
        cuisine,
        phone,
        website,
        hours,
        menu_highlights,
        accepted_currencies,
      };
      if
