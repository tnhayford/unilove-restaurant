const KITCHEN_REFRESH_MS = 8000;
const KITCHEN_ALERT_SOUND_URL = "/admin/assets/sounds/ops-incoming-alert.m4a";

const state = {
  orders: [],
  refreshTimerId: null,
  alertIntervalId: null,
  alertAudio: null,
};

function getAdminLayoutApi() {
  if (typeof AdminLayout !== "undefined" && AdminLayout) return AdminLayout;
  if (typeof window !== "undefined" && window.AdminLayout) return window.AdminLayout;
  return null;
}

function setKitchenStatus(message, kind = "helper") {
  const el = document.getElementById("kitchenStatus");
  if (!el) return;
  el.className = kind;
  el.textContent = message;
}

function setSyncStamp() {
  const el = document.getElementById("kitchenLastSync");
  if (!el) return;
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = `Sync: ${stamp}`;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeOrder(raw) {
  return {
    id: String(raw.id || ""),
    orderNumber: String(raw.order_number || raw.orderNumber || "-").trim(),
    customerName: String(raw.full_name || raw.fullName || "Guest").trim(),
    deliveryType: String(raw.delivery_type || raw.deliveryType || "pickup").trim().toLowerCase() || "pickup",
    source: String(raw.source || "online").trim().toLowerCase() || "online",
    status: normalizeStatus(raw.status),
    opsMonitoredAt: raw.ops_monitored_at || raw.opsMonitoredAt || null,
  };
}

async function apiGet(path) {
  if (window.AdminCore && typeof window.AdminCore.api === "function") {
    return window.AdminCore.api(path);
  }
  throw new Error("Admin API bootstrap unavailable");
}

async function apiMutate(path, { method = "POST", body = {} } = {}) {
  if (window.AdminCore && typeof window.AdminCore.api === "function") {
    return window.AdminCore.api(path, {
      method,
      body: JSON.stringify(body || {}),
    });
  }
  throw new Error("Admin API bootstrap unavailable");
}

function alertSettings() {
  const settings = (window.AdminCore && typeof window.AdminCore.getSettings === "function")
    ? window.AdminCore.getSettings()
    : {};
  return {
    enabled: settings.alertEnabled !== false,
    intervalMs: Math.max(700, Number(settings.alertIntervalMs || 1400)),
    volume: Math.max(0, Math.min(1, Number(settings.alertVolume ?? 0.75))),
  };
}

function stopAlertLoop() {
  if (state.alertIntervalId) {
    clearInterval(state.alertIntervalId);
    state.alertIntervalId = null;
  }
  if (state.alertAudio) {
    try {
      state.alertAudio.pause();
      state.alertAudio.currentTime = 0;
    } catch (_error) {
      // no-op
    }
  }
}

function ensureAlertAudio() {
  if (state.alertAudio) return state.alertAudio;
  const audio = new Audio(KITCHEN_ALERT_SOUND_URL);
  audio.preload = "auto";
  state.alertAudio = audio;
  return audio;
}

function isKitchenAlertCandidate(order) {
  if (!order) return false;
  if (order.status !== "PAID") return false;
  if (!["online", "ussd"].includes(order.source)) return false;
  return !String(order.opsMonitoredAt || "").trim();
}

function playAlertOnce(volume) {
  if (document.hidden) return;
  const audio = ensureAlertAudio();
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // browser autoplay restrictions
      });
    }
  } catch (_error) {
    // no-op
  }
}

function syncAlertLoop() {
  stopAlertLoop();
  const settings = alertSettings();
  if (!settings.enabled) return;
  const hasCandidates = state.orders.some((order) => isKitchenAlertCandidate(order));
  if (!hasCandidates) return;

  playAlertOnce(settings.volume);
  state.alertIntervalId = setInterval(() => {
    const stillHasCandidates = state.orders.some((order) => isKitchenAlertCandidate(order));
    if (!stillHasCandidates) {
      stopAlertLoop();
      return;
    }
    playAlertOnce(settings.volume);
  }, settings.intervalMs);
}

function renderLane(laneId, countId, orders, kind) {
  const lane = document.getElementById(laneId);
  const count = document.getElementById(countId);
  if (!lane || !count) return;

  count.textContent = String(orders.length);
  if (!orders.length) {
    lane.innerHTML = '<div class="order-meta">No orders in this lane.</div>';
    return;
  }

  lane.innerHTML = orders
    .map((order) => `
      <article class="order-card normal">
        <div class="order-head-btn" style="cursor:default;">
          <div class="order-head-main">
            <span class="order-id">${escapeHtml(order.orderNumber)}</span>
            <span class="order-meta">${escapeHtml(order.customerName)}</span>
          </div>
          <div class="order-head-side">
            <span class="pill ${order.deliveryType === "delivery" ? "delivery" : "pickup"}">${escapeHtml(order.deliveryType)}</span>
          </div>
        </div>
        <div class="order-collapse" style="display:block;">
          <div class="order-meta">Source: ${escapeHtml(order.source)}</div>
          <div class="order-actions-row">
            <button class="btn btn-sm primary" data-role="kitchen-open" data-order-id="${escapeHtml(order.id)}">
              Open
            </button>
            ${
              kind === "paid"
                ? `<button class="btn btn-sm primary" data-role="kitchen-accept" data-order-id="${escapeHtml(order.id)}">Accept & Start</button>`
                : `<button class="btn btn-sm primary" data-role="kitchen-ready" data-order-id="${escapeHtml(order.id)}">Mark Ready</button>`
            }
          </div>
        </div>
      </article>
    `)
    .join("");
}

function findOrder(orderId) {
  return state.orders.find((order) => String(order.id) === String(orderId));
}

async function markOrderMonitored(orderId) {
  try {
    await apiMutate(`/api/admin/orders/${encodeURIComponent(orderId)}/monitor`, {
      method: "POST",
      body: {},
    });
  } catch (_error) {
    // non-blocking
  }
}

async function applyKitchenStatus(order, status, label) {
  if (!order) return;
  try {
    await apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, {
      method: "PATCH",
      body: { status },
    });
    await markOrderMonitored(order.id);
    setKitchenStatus(`${label} applied for ${order.orderNumber}.`, "success");
    await refreshKitchen({ silent: true });
  } catch (error) {
    setKitchenStatus(error.message || `Unable to apply ${label}.`, "error");
  }
}

function attachLaneHandlers() {
  document.querySelectorAll("button[data-role='kitchen-open']").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderId = String(button.dataset.orderId || "").trim();
      if (!orderId) return;
      await markOrderMonitored(orderId);
      window.location.href = `/admin/order-detail.html?id=${encodeURIComponent(orderId)}`;
    });
  });

  document.querySelectorAll("button[data-role='kitchen-accept']").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = findOrder(button.dataset.orderId || "");
      await applyKitchenStatus(order, "PREPARING", "Start processing");
    });
  });

  document.querySelectorAll("button[data-role='kitchen-ready']").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = findOrder(button.dataset.orderId || "");
      await applyKitchenStatus(order, "READY_FOR_PICKUP", "Ready for pickup");
    });
  });
}

function renderKitchenBoard() {
  const paid = state.orders.filter((order) => order.status === "PAID");
  const preparing = state.orders.filter((order) => order.status === "PREPARING");
  renderLane("kitchenPaidLane", "kitchenPaidCount", paid, "paid");
  renderLane("kitchenPreparingLane", "kitchenPreparingCount", preparing, "preparing");
  attachLaneHandlers();
}

async function fetchOrders() {
  const payload = await apiGet("/api/admin/orders?limit=150");
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => normalizeOrder(row));
}

async function refreshKitchen({ silent = false } = {}) {
  if (!silent) {
    setKitchenStatus("Refreshing kitchen queue...", "helper");
  }
  state.orders = await fetchOrders();
  renderKitchenBoard();
  syncAlertLoop();
  setSyncStamp();
  setKitchenStatus(`Loaded ${state.orders.length} order(s).`, "success");
}

function mountRefreshLoop() {
  if (state.refreshTimerId) {
    clearInterval(state.refreshTimerId);
    state.refreshTimerId = null;
  }
  state.refreshTimerId = setInterval(() => {
    if (document.hidden) return;
    refreshKitchen({ silent: true }).catch(() => {
      // best effort auto-refresh
    });
  }, KITCHEN_REFRESH_MS);
}

function mountBackHandler() {
  const backBtn = document.getElementById("backBtn");
  if (!backBtn) return;
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = backBtn.dataset.fallback || "/admin/operations.html";
  });
}

(async function initKitchenPortal() {
  const layoutApi = getAdminLayoutApi();
  if (!layoutApi || typeof layoutApi.initProtectedPage !== "function") {
    throw new Error("Admin layout bootstrap is unavailable on kitchen page.");
  }
  const admin = await layoutApi.initProtectedPage();
  if (!admin) return;

  mountBackHandler();

  const refreshBtn = document.getElementById("kitchenRefreshBtn");
  refreshBtn?.addEventListener("click", () => {
    refreshKitchen({ silent: false }).catch((error) => {
      setKitchenStatus(error.message || "Refresh failed.", "error");
    });
  });

  mountRefreshLoop();

  window.addEventListener("admin:alert-setting-changed", () => {
    syncAlertLoop();
  });
  window.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAlertLoop();
      return;
    }
    refreshKitchen({ silent: true }).catch(() => {
      // best effort
    });
  });
  window.addEventListener("beforeunload", () => {
    stopAlertLoop();
    if (state.refreshTimerId) clearInterval(state.refreshTimerId);
  });

  await refreshKitchen({ silent: false });
})();
