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

  async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }

  function buildListingCard(r) {
    const card = document.createElement("div");
    card.className = "stall-card";
    card.dataset.tier = r.source === "self_registered" ? "self" : "admin";

    const expDays = daysLeft(r.listing_expires_at);
    const expired = expDays != null && expDays < 0;
    const sponsorDays = daysLeft(r.sponsored_until);
    const isSponsored = r.sponsored && sponsorDays != null && sponsorDays > 0;
    const isFreeCampaignListing = r.source === "self_registered" && !r.listing_paid && r.listing_expires_at == null;

    const stats = r.stats || { impressions: 0, directions_clicks: 0, gmaps_clicks: 0 };

    const currencyCheckboxes = (CURRENCIES || [])
      .map((c) => {
        const checked = (r.accepted_currencies || []).includes(c.code) ? "checked" : "";
        return `<label><input type="checkbox" value="${c.code}" ${checked} /> ${c.symbol} ${c.label}</label>`;
      })
      .join("");

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
          <div class="checkbox-grid" data-role="editCurrencyGrid">${currencyCheckboxes}</div>
        </div>
        <div class="field">
          <label>${t("coordinates")}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="action-btn" data-action="editGeocode">${t("geocodeFromAddress")}</button>
            <button type="button" class="action-btn" data-action="editUseLocation">${t("useMyLocation")}</button>
          </div>
          <div data-role="editMap" style="height:220px;border-radius:8px;margin-top:8px;"></div>
          <div class="stall-meta" data-role="editCoordsPreview" style="margin-top:8px;"></div>
          <div class="stall-meta" style="margin-top:4px;font-size:12px;">${t("mapTapHint")}</div>
        </div>
        <div class="stall-actions">
          <button class="action-btn primary" data-action="saveEdit">${t("myStoreEditSave")}</button>
        </div>
        <div class="status-msg" data-role="editMsg"></div>
        <hr style="border:none;border-top:1px solid var(--border-color,#333);margin:16px 0;" />
        <button class="action-btn" style="color:var(--accent-danger);border-color:var(--accent-danger);" data-action="deleteListing">${t("myStoreDelete")}</button>
      </div>
      <div class="status-msg" data-role="msg"></div>
    `;

    // ---- edit panel toggle + Leaflet map (lazy-init, fixed on open) ----
    const editPanel = card.querySelector('[data-role="editPanel"]');
    const mapContainer = card.querySelector('[data-role="editMap"]');
    let editMap = null;
    let editMarker = null;
    let editCoords = (r.lat != null && r.lng != null) ? { lat: r.lat, lng: r.lng } : null;

    function updateEditCoordsPreview() {
      const preview = card.querySelector('[data-role="editCoordsPreview"]');
      if (editCoords) {
        preview.textContent = `${t("coordsCaptured")}: ${editCoords.lat.toFixed(5)}, ${editCoords.lng.toFixed(5)}`;
      }
    }

    function setEditMarker(lat, lng, pan) {
      editCoords = { lat, lng };
      if (editMarker) {
        editMarker.setLatLng([lat, lng]);
      } else {
        editMarker = L.marker([lat, lng], { draggable: true }).addTo(editMap);
        editMarker.on("dragend", () => {
          const pos = editMarker.getLatLng();
          editCoords = { lat: pos.lat, lng: pos.lng };
          updateEditCoordsPreview();
        });
      }
      if (pan) editMap.setView([lat, lng], 17);
      updateEditCoordsPreview();
    }

    function initEditMapIfNeeded() {
      if (editMap) return;
      const startCenter = editCoords ? [editCoords.lat, editCoords.lng] : [35.681236, 139.767125];
      editMap = L.map(mapContainer).setView(startCenter, editCoords ? 17 : 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(editMap);
      if (editCoords) setEditMarker(editCoords.lat, editCoords.lng, false);
      editMap.on("click", (e) => setEditMarker(e.latlng.lat, e.latlng.lng, false));
    }

    card.querySelector('[data-action="toggleEdit"]').addEventListener("click", (e) => {
      const open = editPanel.classList.toggle("open");
      e.currentTarget.textContent = open ? t("myStoreEditCancel") : t("myStoreEditInfo");
      if (open) {
        initEditMapIfNeeded();
        // The map is created while its container may still be at zero
        // height (mid-transition), so tiles can render blank/grey until we
        // tell Leaflet to recheck its size once the panel is actually visible.
        setTimeout(() => {
          if (editMap) editMap.invalidateSize();
        }, 100);
      }
    });

    card.querySelector('[data-action="editUseLocation"]').addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => setEditMarker(pos.coords.latitude, pos.coords.longitude, true),
        (err) => alert("Could not get location: " + err.message)
      );
    });

    const editMsgEl = card.querySelector('[data-role="editMsg"]');
    const editGeocodeBtn = card.querySelector('[data-action="editGeocode"]');
    editGeocodeBtn.addEventListener("click", async () => {
      const address = card.querySelector('[data-role="editAddress"]').value.trim();
      if (!address) return;
      editGeocodeBtn.disabled = true;
      const originalLabel = editGeocodeBtn.textContent;
      editGeocodeBtn.textContent = t("geocoding");
      try {
        const result = await geocodeAddress(address);
        if (!result) {
          editMsgEl.textContent = t("geocodeError");
          editMsgEl.className = "status-msg show err";
        } else {
          setEditMarker(result.lat, result.lng, true);
        }
      } catch (e) {
        editMsgEl.textContent = t("geocodeError");
        editMsgEl.className = "status-msg show err";
      } finally {
        editGeocodeBtn.disabled = false;
        editGeocodeBtn.textContent = originalLabel;
      }
    });

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
      const accepted_currencies = [...card.querySelectorAll('[data-role="editCurrencyGrid"] input:checked')].map(
        (i) => i.value
      );

      if (!editCoords && address) {
        try {
          const result = await geocodeAddress(address);
          if (result) editCoords = result;
        } catch (e) {
          /* ignore — falls through without coords, keeping the existing ones server-side */
        }
      }

      const patch = { name, name_en, address, cuisine, phone, website, hours, menu_highlights, accepted_currencies };
      if (editCoords) {
        patch.lat = editCoords.lat;
        patch.lng = editCoords.lng;
      }

      fetch(`/api/restaurants/mine/${r.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify(patch),
      })
        .then((res) => {
          if (!res.ok) throw new Error("failed");
          return res.json();
        })
        .then(() => {
          editMsgEl.textContent = t("myStoreEditSuccess");
          editMsgEl.className = "status-msg show ok";
        })
        .catch(() => {
          editMsgEl.textContent = t("myStorePayError");
          editMsgEl.className = "status-msg show err";
        });
    });

    card.querySelector('[data-action="deleteListing"]').addEventListener("click", () => {
      if (!confirm(t("myStoreDeleteConfirm"))) return;
      fetch(`/api/restaurants/mine/${r.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${state.accessToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error("failed");
          return res.json();
        })
        .then(() => {
          editMsgEl.textContent = t("myStoreDeleteSuccess");
          editMsgEl.className = "status-msg show ok";
          loadMine();
        })
        .catch(() => {
          editMsgEl.textContent = t("myStoreDeleteError");
          editMsgEl.className = "status-msg show err";
        });
    });

    const msgEl = card.querySelector('[data-role="msg"]');
    function showMsg(text, ok) {
      msgEl.textContent = text;
      msgEl.className = "status-msg show " + (ok ? "ok" : "err");
    }

    const renewBtn = card.querySelector('[data-action="renew"]');
    if (renewBtn) {
      renewBtn.addEventListener("click", () => {
        payFor(r.id, "renewal", RENEWAL_FEE_PI, `飲食.Pi renewal: ${r.name}`, showMsg);
      });
    }
    card.querySelector('[data-action="sponsor"]').addEventListener("click", () => {
      payFor(r.id, "sponsor", SPONSOR_FEE_PI, `飲食.Pi sponsor: ${r.name}`, showMsg);
    });

    return card;
  }

  function payFor(restaurantId, paymentType, amount, memo, showMsg) {
    Pi.createPayment(
      { amount, memo, metadata: { type: paymentType, restaurantId } },
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
            body: JSON.stringify({ paymentId, txid, paymentType, restaurantId }),
          })
            .then((r) => r.json())
            .then(() => {
              showMsg(t("myStorePaySuccess"), true);
              loadMine();
            })
            .catch(() => showMsg(t("myStorePayError"), false));
        },
        onCancel: () => {},
        onError: () => showMsg(t("myStorePayError"), false),
      }
    );
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
})();
