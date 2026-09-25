// 飲食.Pi — admin panel (password gate is a basic deterrent only; see README
// for a note on hardening this before real-world use)
(function () {
  "use strict";
  let token = sessionStorage.getItem("ip_admin_token") || "";

  const loginBox = document.getElementById("loginBox");
  const panel = document.getElementById("panel");
  const statusEl = document.getElementById("statusMsg");

  function showStatus(msg, ok) {
    statusEl.textContent = msg;
    statusEl.className = "status-msg show " + (ok ? "ok" : "err");
  }

   function showPanel() {
    loginBox.style.display = "none";
    panel.style.display = "block";
    loadPending();
    loadAll();
    loadReviews();
  }

  if (token) showPanel();

  document.getElementById("loginBtn").addEventListener("click", () => {
    token = document.getElementById("pw").value;
    fetch("/api/admin/restaurants/pending", { headers: { "x-admin-token": token } })
      .then((r) => {
        if (!r.ok) throw new Error("bad auth");
        sessionStorage.setItem("ip_admin_token", token);
        showPanel();
      })
      .catch(() => alert("パスワードが違います"));
  });

  function loadPending() {
    fetch("/api/admin/restaurants/pending", { headers: { "x-admin-token": token } })
      .then((r) => r.json())
      .then((data) => renderPending(data.results || []));
  }

  // ---- external import trigger ----
  const importStatusEl = document.getElementById("importStatusMsg");
  function showImportStatus(msg, ok) {
    importStatusEl.textContent = msg;
    importStatusEl.className = "status-msg show " + (ok ? "ok" : "err");
  }
  document.getElementById("importForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const body = {
      source: "coinmap",
      lat: parseFloat(document.getElementById("importLat").value),
      lng: parseFloat(document.getElementById("importLng").value),
      radiusKm: parseFloat(document.getElementById("importRadius").value) || 15,
      autoApprove: document.getElementById("importAutoApprove").checked,
    };
    showImportStatus("取込中…", true);
    fetch("/api/admin/import/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        showImportStatus(
          `${data.found}件見つかり、${data.imported}件を新規追加(${data.skipped}件は既存のためスキップ)。ステータス: ${data.autoApproved ? "即公開" : "審査待ち"}`,
          true
        );
        loadPending();
      })
      .catch(() => showImportStatus("取込に失敗しました", false));
  });

  function renderPending(list) {
    const el = document.getElementById("pendingList");
    if (list.length === 0) {
      el.innerHTML = '<div class="empty-state">審査待ちの投稿はありません</div>';
      return;
    }
    el.innerHTML = "";
    list.forEach((r) => {
      const card = document.createElement("div");
      card.className = "stall-card";
      card.dataset.tier = "community";
      card.innerHTML = `
        <div class="stall-name">${r.name}</div>
        <div class="stall-meta">${r.address || ""}</div>
        <div class="stall-meta">通貨: ${(r.accepted_currencies || []).join(", ")}</div>
        <div class="stall-meta">メモ: ${r.note || "—"}</div>
        <div class="stall-actions">
          <button class="action-btn primary" data-id="${r.id}" data-do="approve">承認</button>
          <button class="action-btn" data-id="${r.id}" data-do="reject">却下</button>
        </div>
      `;
      el.appendChild(card);
    });
  }

   document.getElementById("pendingList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-do]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.do;
    fetch(`/api/admin/restaurants/${id}/${action}`, {
      method: "POST",
      headers: { "x-admin-token": token },
    }).then(loadPending);
  });

  // ---- all listings (published + rejected), with a delete option ----
  const STATUS_LABEL = { verified: "掲載中", pending: "審査待ち", rejected: "却下済み" };
  function loadAll() {
    fetch("/api/admin/restaurants/all", { headers: { "x-admin-token": token } })
      .then((r) => r.json())
      .then((data) => renderAll(data.results || []));
  }

  function renderAll(list) {
    const el = document.getElementById("allListingsList");
    if (list.length === 0) {
      el.innerHTML = '<div class="empty-state">登録されている店舗がありません</div>';
      return;
    }
    el.innerHTML = "";
    list.forEach((r) => {
      const card = document.createElement("div");
      card.className = "stall-card";
      card.dataset.tier = "community";
      const lat = typeof r.lat === "number" ? r.lat.toFixed(5) : r.lat;
      const lng = typeof r.lng === "number" ? r.lng.toFixed(5) : r.lng;
      card.innerHTML = `
        <div class="stall-name">${r.name}</div>
        <div class="stall-meta">${r.address || ""}</div>
        <div class="stall-meta">状態: ${STATUS_LABEL[r.status] || r.status} ・ 座標: ${lat}, ${lng}</div>
        <div class="stall-actions">
          <button class="action-btn" style="color:var(--accent-danger);border-color:var(--accent-danger);" data-id="${r.id}" data-name="${r.name}" data-do="delete">削除</button>
        </div>
      `;
      el.appendChild(card);
    });
  }

  document.getElementById("allListingsList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-do='delete']");
    if (!btn) return;
    if (!confirm(`「${btn.dataset.name}」を完全に削除します。よろしいですか？`)) return;
    fetch(`/api/admin/restaurants/${btn.dataset.id}`, {
      method: "DELETE",
      headers: { "x-admin-token": token },
    }).then(() => {
      loadAll();
      loadPending();
    });
  });

  // manual add
  const grid = document.getElementById("currencyGrid");
  CURRENCIES.forEach((c) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${c.code}" /> ${c.symbol} ${c.label}`;
    grid.appendChild(label);
  });

  document.getElementById("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const restaurant = {
      name: document.getElementById("name").value.trim(),
      address: document.getElementById("address").value.trim(),
      lat: parseFloat(document.getElementById("lat").value),
      lng: parseFloat(document.getElementById("lng").value),
      cuisine: document.getElementById("cuisine").value.trim(),
      hours: document.getElementById("hours").value.trim(),
      menu_highlights: document
        .getElementById("menuHighlights")
        .value.split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      accepted_currencies: [...grid.querySelectorAll("input:checked")].map((i) => i.value),
    };
    fetch("/api/admin/restaurants", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(restaurant),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        showStatus("追加しました", true);
        document.getElementById("addForm").reset();
      })
      .catch(() => showStatus("追加に失敗しました", false));
  });

  // ---- review moderation ----
  function loadReviews() {
    fetch("/api/admin/reviews", { headers: { "x-admin-token": token } })
      .then((r) => r.json())
      .then((data) => renderReviews(data.results || []));
  }

  function renderReviews(list) {
    const el = document.getElementById("reviewsList");
    const visible = list.filter((rv) => rv.status !== "hidden");
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty-state">口コミはまだありません</div>';
      return;
    }
    el.innerHTML = "";
    visible.slice(0, 50).forEach((rv) => {
      const card = document.createElement("div");
      card.className = "stall-card";
      card.dataset.tier = "community";
      card.innerHTML = `
        <div class="stall-name">${"★".repeat(rv.rating)}${"☆".repeat(5 - rv.rating)} — ${rv.restaurant_name}</div>
        <div class="stall-meta">${rv.author || "匿名"}: ${rv.comment || "(コメントなし)"}</div>
        <div class="stall-actions">
          <button class="action-btn" data-rid="${rv.restaurant_id}" data-vid="${rv.id}" data-do="hide">非表示にする</button>
        </div>
      `;
      el.appendChild(card);
    });
  }

  document.getElementById("reviewsList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-do]");
    if (!btn) return;
    fetch(`/api/admin/restaurants/${btn.dataset.rid}/reviews/${btn.dataset.vid}/hide`, {
      method: "POST",
      headers: { "x-admin-token": token },
    }).then(loadReviews);
  });
})();
