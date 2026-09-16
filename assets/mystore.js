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
          <label data-i18n="hours">${t("hours")}</label>
          <input type="text" data-role="editHours" value="${escapeHtml(r.hours || "")}" placeholder="${t("hoursPlaceholder")}" />
        </div>
        <div class="field">
          <label>${t("menuHighlights")}</label>
          <textarea data-role="editMenu" placeholder="${t("menuHighlightsPlaceholder")}">${escapeHtml((r.menu_highlights || []).join("\n"))}</textarea>
        </div>
        <div class="stall-actions">
          <button class="action-btn primary" data-action="saveEdit">${t("myStoreEditSave")}</button>
        </div>
        <div class="status-msg" data-role="editMsg"></div>
      </div>
      <div class="status-msg" data-role="msg"></div>
    `;

    const editPanel = card.querySelector('[data-role="editPanel"]');
    card.querySelector('[data-action="toggleEdit"]').addEventListener("click", (e) => {
      const open = editPanel.classList.toggle("open");
      e.currentTarget.textContent = open ? t("myStoreEditCancel") : t("myStoreEditInfo");
    });

    const editMsgEl = card.querySelector('[data-role="editMsg"]');
    card.querySelector('[data-action="saveEdit"]').addEventListener("click", () => {
      const hours = card.querySelector('[data-role="editHours"]').value.trim();
      const menu_highlights = card
        .querySelector('[data-role="editMenu"]')
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      fetch(`/api/restaurants/mine/${r.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify({ hours, menu_highlights }),
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
