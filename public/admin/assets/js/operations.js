const ORDER_REFRESH_MS = 12000;
const ORDER_HEALTHCHECK_MS = 60000;
const OPS_STREAM_RECONNECT_MS = 8000;
const RIDER_REFRESH_MS = 30000;
const REALTIME_MIN_REFRESH_GAP_MS = 1500;
const DELAY_THRESHOLD_MINUTES = 30;
const OPS_ALERT_DEFAULT_SOUND_URL = "/admin/assets/sounds/ops-incoming-alert.m4a";
const MAX_VISIBLE_ORDER_CARDS_PER_LANE = 8;
const MAX_VISIBLE_RIDER_CARDS_PER_LANE = 10;
const MAX_VISIBLE_RIDER_DELIVERY_PER_LANE = 8;

const ACTION_TO_STATUS = {
  START_PROCESSING: "PREPARING",
  MARK_READY_PICKUP: "READY_FOR_PICKUP",
  DISPATCH_ORDER: "OUT_FOR_DELIVERY",
  COMPLETE_PICKUP: "DELIVERED",
  MARK_RETURNED: "RETURNED",
  ISSUE_REFUND: "REFUNDED",
  CANCEL_ORDER: "CANCELED",
};

const ACTION_LABELS = {
  START_PROCESSING: "Start Processing",
  MARK_READY_PICKUP: "Ready for Pickup",
  DISPATCH_ORDER: "Dispatch Order",
  COMPLETE_PICKUP: "Complete Pickup",
  MARK_RETURNED: "Mark Returned",
  ISSUE_REFUND: "Issue Refund",
  CANCEL_ORDER: "Cancel Order",
};

const DANGER_ACTIONS = new Set(["MARK_RETURNED", "ISSUE_REFUND", "CANCEL_ORDER"]);
const FINAL_STATUSES = new Set(["DELIVERED", "RETURNED", "REFUNDED", "CANCELED", "PAYMENT_FAILED"]);

const ACTIVE_ORDER_LANES = [
  {
    key: "awaitingPayment",
    laneId: "awaitingPaymentLane",
    countId: "awaitingPaymentCount",
    statuses: ["PENDING_PAYMENT", "PAYMENT_FAILED"],
  },
  {
    key: "kitchen",
    laneId: "kitchenLane",
    countId: "kitchenCount",
    statuses: ["PAID", "PREPARING"],
  },
  {
    key: "readyDispatch",
    laneId: "readyDispatchLane",
    countId: "readyDispatchCount",
    statuses: ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
  },
];

const COMPLETED_ORDER_LANES = [
  {
    key: "completed",
    laneId: "completedLane",
    countId: "completedCount",
    statuses: ["DELIVERED"],
  },
];

const EXCEPTION_ORDER_LANES = [
  {
    key: "refundQueue",
    laneId: "refundQueueLane",
    countId: "refundQueueCount",
    statuses: ["REFUNDED"],
  },
  {
    key: "canceled",
    laneId: "canceledLane",
    countId: "canceledCount",
    statuses: ["CANCELED", "RETURNED"],
  },
];

const state = {
  orders: [],
  riders: [],
  activeView: "orders",
  refreshTimerId: null,
  lastRidersFetchAt: 0,
  lastBoardRefreshAt: 0,
  opsEventSource: null,
  opsStreamConnected: false,
  opsStreamRetryTimerId: null,
  realtimeRefreshTimerId: null,
  expandedOrderIds: new Set(),
  alertIntervalId: null,
  alertAudio: null,
  alertAudioTone: null,
  riderFeedUnavailable: false,
  orderPolicy: {
    cancelReasons: [],
  },
};

function getAdminLayoutApi() {
  if (typeof AdminLayout !== "undefined" && AdminLayout) return AdminLayout;
  if (typeof window !== "undefined" && window.AdminLayout) return window.AdminLayout;
  return null;
}

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.00";
  return number.toFixed(2);
}

function alertSettings() {
  const settings = (window.AdminCore && typeof window.AdminCore.getSettings === "function")
    ? window.AdminCore.getSettings()
    : {};
  const tone = String(settings.alertTone || "ops_default").trim().toLowerCase();
  const normalizedTone = tone === "rider_arrival" ? "dispatch_pop" : tone;
  return {
    enabled: settings.alertEnabled !== false,
    tone: normalizedTone || "ops_default",
    intervalMs: Math.max(700, Number(settings.alertIntervalMs || 1400)),
    volume: Math.max(0, Math.min(1, Number(settings.alertVolume ?? 0.75))),
  };
}

function stopIncomingOrderAlertLoop() {
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

function resolveAlertToneUrl(_tone) {
  return OPS_ALERT_DEFAULT_SOUND_URL;
}

function ensureIncomingOrderAlertAudio(tone) {
  const targetTone = String(tone || "ops_default").trim().toLowerCase() || "ops_default";
  if (state.alertAudio && state.alertAudioTone === targetTone) return state.alertAudio;
  if (state.alertAudio) {
    try {
      state.alertAudio.pause();
      state.alertAudio.currentTime = 0;
    } catch (_error) {
      // no-op
    }
  }
  const audio = new Audio(resolveAlertToneUrl(targetTone));
  audio.preload = "auto";
  state.alertAudio = audio;
  state.alertAudioTone = targetTone;
  return audio;
}

function isAlertCandidateOrder(order) {
  if (!order) return false;
  if (normalizeStatus(order.status) !== "PAID") return false;
  const source = String(order.source || "").trim().toLowerCase();
  if (!["online", "ussd"].includes(source)) return false;
  const paymentMethod = String(order.paymentMethod || "momo").trim().toLowerCase();
  const paymentStatus = String(order.paymentStatus || "PENDING").trim().toUpperCase();
  const prepaidCaptured = paymentStatus === "PAID";
  const codPending = paymentMethod === "cash_on_delivery" && paymentStatus === "PENDING";
  if (!prepaidCaptured && !codPending) return false;
  return !String(order.opsMonitoredAt || "").trim();
}

function currentAlertCandidateCount() {
  return state.orders.filter((order) => isAlertCandidateOrder(order)).length;
}

function playIncomingOrderAlertOnce(volume, tone) {
  if (document.hidden) return;
  const audio = ensureIncomingOrderAlertAudio(tone);
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // autoplay restrictions are browser-controlled
      });
    }
  } catch (_error) {
    // no-op
  }
}

function syncIncomingOrderAlertLoop() {
  stopIncomingOrderAlertLoop();

  const settings = alertSettings();
  if (!settings.enabled) return;

  const pendingCount = currentAlertCandidateCount();
  if (!pendingCount) return;

  playIncomingOrderAlertOnce(settings.volume, settings.tone);
  state.alertIntervalId = setInterval(() => {
    if (!currentAlertCandidateCount()) {
      stopIncomingOrderAlertLoop();
      return;
    }
    playIncomingOrderAlertOnce(settings.volume, settings.tone);
  }, settings.intervalMs);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setBoardStatus(message, kind = "helper") {
  const el = document.getElementById("opsBoardStatus");
  if (!el) return;
  el.className = kind;
  el.textContent = message;
}

function setSyncStamp() {
  const el = document.getElementById("opsLastSync");
  if (!el) return;
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = `Sync: ${stamp}`;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function parseAppTimestamp(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  const withTimezone = /z$/i.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withTimezone);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function ageMinutesFromOrder(order) {
  if (Number.isFinite(Number(order.ageMinutes))) {
    return Math.max(0, Number(order.ageMinutes));
  }
  const createdAt = parseAppTimestamp(order.createdAt || order.created_at);
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 60000));
}

function formatAgeLabel(ageMinutes) {
  const value = Math.max(0, Math.floor(Number(ageMinutes || 0)));
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function stageFromStatus(status) {
  switch (status) {
    case "PENDING_PAYMENT":
      return "Awaiting payment";
    case "PAID":
      return "Incoming order";
    case "PREPARING":
      return "Kitchen processing";
    case "READY_FOR_PICKUP":
      return "Ready for rider";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery";
    case "DELIVERED":
      return "Delivered";
    case "RETURNED":
      return "Returned";
    case "REFUNDED":
      return "Refunded";
    case "CANCELED":
      return "Canceled";
    case "PAYMENT_FAILED":
      return "Payment failed";
    default:
      return String(status || "-")
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function paymentMethodLabel(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "cash_on_delivery") return "Cash on delivery";
  if (token === "momo") return "MoMo";
  if (token === "cash") return "Cash";
  return token || "Unknown";
}

function paymentStatusLabel(value, paymentMethod) {
  const token = String(value || "").trim().toUpperCase();
  if (token === "PAID") return "Paid";
  if (token === "FAILED") return "Failed";
  if (String(paymentMethod || "").trim().toLowerCase() === "cash_on_delivery") {
    return "Collect on delivery";
  }
  return "Pending";
}

function normalizeOrder(raw) {
  const status = normalizeStatus(raw.status);
  const ageMinutes = ageMinutesFromOrder(raw);
  const deliveryType = String(raw.delivery_type || raw.deliveryType || "pickup").toLowerCase();
  const paymentMethod = String(raw.payment_method || raw.paymentMethod || "momo").trim().toLowerCase() || "momo";
  const paymentStatus = String(raw.payment_status || raw.paymentStatus || "PENDING").trim().toUpperCase() || "PENDING";
  return {
    id: String(raw.id || ""),
    orderNumber: String(raw.order_number || raw.orderNumber || "-").trim(),
    customerName: String(raw.full_name || raw.fullName || "Guest").trim(),
    phone: String(raw.phone || "").trim(),
    source: String(raw.source || "online").trim().toLowerCase() || "online",
    deliveryType,
    paymentMethod,
    paymentStatus,
    address: String(raw.address || "").trim(),
    status,
    assignedRiderId: String(raw.assigned_rider_id || raw.assignedRiderId || "").trim() || null,
    stageLabel: String(raw.stageLabel || stageFromStatus(status)).trim(),
    subtotalCedis: Number(raw.subtotal_cedis ?? raw.subtotalCedis ?? 0),
    ageMinutes,
    isDelayed: Boolean(raw.isDelayed) || (!FINAL_STATUSES.has(status) && ageMinutes > DELAY_THRESHOLD_MINUTES),
    items: Array.isArray(raw.items) ? raw.items : [],
    createdAt: raw.created_at || raw.createdAt || null,
    updatedAt: raw.updated_at || raw.updatedAt || null,
    cancelReason: raw.cancel_reason || raw.cancelReason || "",
    opsMonitoredAt: raw.ops_monitored_at || raw.opsMonitoredAt || null,
    paymentConfirmedAt: raw.payment_confirmed_at || raw.paymentConfirmedAt || null,
    availableActions: Array.isArray(raw.availableActions) ? raw.availableActions : [],
  };
}

function normalizeRider(raw) {
  const riderId = String(raw.id || raw.riderId || "").trim();
  const name = String(raw.fullName || raw.full_name || raw.name || raw.riderName || riderId || "Rider").trim();
  const statusRaw = String(raw.status || raw.shiftStatus || raw.availability || "offline").trim().toLowerCase();

  let status = "offline";
  if (["available", "online", "idle", "free"].includes(statusRaw)) {
    status = "available";
  } else if (["busy", "active", "delivering", "out_for_delivery", "assigned"].includes(statusRaw)) {
    status = "busy";
  }

  return {
    id: riderId || name,
    name: name || "Rider",
    status,
    mode: String(raw.mode || "staff").toLowerCase(),
  };
}

function actionButtonClass(action) {
  const base = "btn btn-sm";
  if (DANGER_ACTIONS.has(action)) return `${base} danger`;
  return `${base} primary`;
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

function summarizeItems(order) {
  if (!Array.isArray(order.items) || !order.items.length) return "Items unavailable";
  return order.items
    .slice(0, 3)
    .map((item) => `${Number(item.quantity || 0)}x ${String(item.item_name_snapshot || item.itemName || item.name || "Item")}`)
    .join(" | ");
}

function orderCardClass(order) {
  if (order.status === "DELIVERED") return "order-card completed";
  if (["RETURNED", "REFUNDED", "CANCELED", "PAYMENT_FAILED"].includes(order.status)) return "order-card exception";
  if (order.isDelayed) return "order-card delayed";
  return "order-card normal";
}

function deliveryPillClass(order) {
  return order.deliveryType === "delivery" ? "delivery" : "pickup";
}

function getRiderById(riderId) {
  const normalized = String(riderId || "").trim();
  if (!normalized) return null;
  return state.riders.find((row) => String(row.id || "").trim() === normalized) || null;
}

function getAssignedRiderLabel(order) {
  const assignedId = String(order?.assignedRiderId || "").trim();
  if (!assignedId) return "Unassigned";
  const rider = getRiderById(assignedId);
  if (!rider) return assignedId;
  return `${rider.name || assignedId} (${assignedId})`;
}

function renderCancelReasonSelect(order) {
  const actions = Array.isArray(order.availableActions) ? order.availableActions : [];
  if (!actions.includes("CANCEL_ORDER")) return "";

  const reasons = Array.isArray(state.orderPolicy.cancelReasons) && state.orderPolicy.cancelReasons.length
    ? state.orderPolicy.cancelReasons
    : ["Customer requested cancel", "Kitchen unable to fulfill", "Fraud suspected", "Duplicate order", "Other operational reason"];

  const options = reasons
    .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
    .join("");

  return `
    <div class="order-cancel-row">
      <label class="order-meta" for="cancelReason-${escapeHtml(order.id)}">Cancel reason</label>
      <select id="cancelReason-${escapeHtml(order.id)}" class="select order-cancel-select" data-cancel-reason-for="${escapeHtml(order.id)}">
        <option value="">Select reason</option>
        ${options}
      </select>
    </div>
  `;
}

function renderOrderActionButtons(order) {
  const actions = (Array.isArray(order.availableActions) ? order.availableActions : [])
    .filter((action) => Boolean(ACTION_TO_STATUS[action]));

  if (!actions.length) {
    return '<div class="order-meta">No stage action available for this order.</div>';
  }

  return `
    <div class="order-actions-row">
      ${actions
        .map(
          (action) => `
            <button
              type="button"
              class="${actionButtonClass(action)}"
              data-order-action="${escapeHtml(action)}"
              data-order-id="${escapeHtml(order.id)}"
            >
              ${escapeHtml(actionLabel(action))}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRecoveryButtons(order) {
  const canRecover = order.deliveryType === "delivery" && ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(order.status);
  if (!canRecover) return "";

  return `
    <div class="order-actions-row order-actions-row-subtle">
      <button type="button" class="btn btn-sm" data-delivery-action="reset" data-order-id="${escapeHtml(order.id)}">
        Reset OTP Attempts
      </button>
      <button type="button" class="btn btn-sm" data-delivery-action="regen" data-order-id="${escapeHtml(order.id)}">
        Regenerate OTP
      </button>
      <button type="button" class="btn btn-sm danger" data-delivery-action="force" data-order-id="${escapeHtml(order.id)}">
        Force Complete
      </button>
    </div>
  `;
}

function renderOrderCard(order) {
  const expanded = state.expandedOrderIds.has(order.id);
  const isDeliveryOrder = order.deliveryType === "delivery";
  const assignedLabel = isDeliveryOrder ? getAssignedRiderLabel(order) : "Not required";
  const paymentLabel = `${paymentMethodLabel(order.paymentMethod)} • ${paymentStatusLabel(order.paymentStatus, order.paymentMethod)}`;

  return `
    <article class="${orderCardClass(order)} ${expanded ? "" : "is-collapsed"}" data-order-id="${escapeHtml(order.id)}">
      <button
        type="button"
        class="order-head-btn"
        data-role="toggle-order"
        data-order-id="${escapeHtml(order.id)}"
        aria-expanded="${expanded ? "true" : "false"}"
      >
        <div class="order-head-main">
          <span class="order-id">${escapeHtml(order.orderNumber)}</span>
          <span class="order-meta">${escapeHtml(order.customerName)}</span>
        </div>
        <div class="order-head-side">
          <span class="pill ${deliveryPillClass(order)}">${escapeHtml(order.deliveryType)}</span>
          <span class="order-chevron" aria-hidden="true">▾</span>
        </div>
      </button>

      <div class="order-collapse">
        <div class="order-meta">Assigned rider: ${escapeHtml(assignedLabel)}</div>
        <div class="order-meta">Source: ${escapeHtml(order.source || "online")}</div>
        <div class="order-meta">Payment: ${escapeHtml(paymentLabel)}</div>
        <div class="order-actions-row" style="margin-top: 8px;">
          <button
            type="button"
            class="btn btn-sm primary"
            data-role="manage-order"
            data-order-id="${escapeHtml(order.id)}"
          >
            Manage Order
          </button>
        </div>
      </div>
    </article>
  `;
}

function riderStatusClass(status) {
  switch (status) {
    case "available":
      return "rider-chip available";
    case "busy":
      return "rider-chip busy";
    default:
      return "rider-chip offline";
  }
}

function renderRiderLane(laneId, riders, countId) {
  const lane = document.getElementById(laneId);
  const count = document.getElementById(countId);
  if (!lane || !count) return;

  count.textContent = String(riders.length);
  if (!riders.length) {
    lane.innerHTML = '<div class="order-meta">No riders in this column.</div>';
    return;
  }

  const visible = riders.slice(0, MAX_VISIBLE_RIDER_CARDS_PER_LANE);
  const hiddenCount = Math.max(0, riders.length - visible.length);

  lane.innerHTML = visible
    .map((rider) => `
      <article class="${riderStatusClass(rider.status)}">
        <div class="rider-chip-name">${escapeHtml(rider.name)}</div>
        <div class="rider-chip-meta">${escapeHtml(rider.mode)}</div>
      </article>
    `)
    .join("");

  if (hiddenCount > 0) {
    lane.insertAdjacentHTML(
      "beforeend",
      `<div class="order-meta">+${hiddenCount} more rider(s) not shown in compact view.</div>`,
    );
  }
}

function riderDeliveryColumns(orders) {
  const deliveryOrders = orders.filter((order) => order.deliveryType === "delivery");
  return {
    ready: deliveryOrders.filter((order) => order.status === "READY_FOR_PICKUP"),
    pending: deliveryOrders.filter((order) => order.status === "OUT_FOR_DELIVERY"),
    delivered: deliveryOrders.filter((order) => order.status === "DELIVERED"),
  };
}

function renderMiniOrderCard(order) {
  const delayedIcon = order.isDelayed ? '<span class="mini-delay-dot" aria-hidden="true"></span>' : "";
  const assignedLabel = getAssignedRiderLabel(order);
  return `
    <article class="rider-order-card">
      <div class="rider-order-top">
        <strong>${escapeHtml(order.orderNumber)}</strong>
        ${delayedIcon}
      </div>
      <div class="order-meta">${escapeHtml(order.customerName)}</div>
      <div class="order-meta">Rider: ${escapeHtml(assignedLabel)}</div>
      <div class="order-meta">${escapeHtml(stageFromStatus(order.status))} • ${escapeHtml(formatAgeLabel(order.ageMinutes))}</div>
    </article>
  `;
}

function orderSortTimestamp(order) {
  const updatedAt = parseAppTimestamp(order.updatedAt || order.updated_at);
  if (updatedAt) return updatedAt.getTime();
  const createdAt = parseAppTimestamp(order.createdAt || order.created_at);
  if (createdAt) return createdAt.getTime();
  return null;
}

function compareOrdersNewestFirst(a, b) {
  const tsA = orderSortTimestamp(a);
  const tsB = orderSortTimestamp(b);

  if (tsA != null && tsB != null && tsA !== tsB) return tsB - tsA;
  if (tsA != null && tsB == null) return -1;
  if (tsA == null && tsB != null) return 1;

  if (a.ageMinutes !== b.ageMinutes) return a.ageMinutes - b.ageMinutes;
  return String(b.orderNumber || "").localeCompare(String(a.orderNumber || ""));
}

function renderRiderOrderLane(laneId, countId, items) {
  const lane = document.getElementById(laneId);
  const count = document.getElementById(countId);
  if (!lane || !count) return;

  count.textContent = String(items.length);
  if (!items.length) {
    lane.innerHTML = '<div class="order-meta">No orders.</div>';
    return;
  }

  const sorted = items.sort(compareOrdersNewestFirst);
  const visible = sorted.slice(0, MAX_VISIBLE_RIDER_DELIVERY_PER_LANE);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  lane.innerHTML = visible.map((order) => renderMiniOrderCard(order)).join("");
  if (hiddenCount > 0) {
    lane.insertAdjacentHTML(
      "beforeend",
      `<div class="order-meta">+${hiddenCount} more order(s) in this lane.</div>`,
    );
  }
}

function renderLaneSet(lanes) {
  lanes.forEach((lane) => {
    const container = document.getElementById(lane.laneId);
    const count = document.getElementById(lane.countId);
    if (!container || !count) return;

    const items = state.orders
      .filter((order) => lane.statuses.includes(order.status))
      .sort(compareOrdersNewestFirst);

    count.textContent = String(items.length);
    if (!items.length) {
      container.innerHTML = '<div class="order-meta">No orders in this lane.</div>';
      return;
    }

    const visible = items.slice(0, MAX_VISIBLE_ORDER_CARDS_PER_LANE);
    const hiddenCount = Math.max(0, items.length - visible.length);

    container.innerHTML = visible.map((order) => renderOrderCard(order)).join("");
    if (hiddenCount > 0) {
      container.insertAdjacentHTML(
        "beforeend",
        `<div class="order-meta">+${hiddenCount} more order(s) hidden in compact mode.</div>`,
      );
    }
    attachOrderHandlers(container);
  });
}

function renderOrdersBoard() {
  const activeOrderIds = new Set(state.orders.map((order) => String(order.id)));
  state.expandedOrderIds.forEach((orderId) => {
    if (!activeOrderIds.has(String(orderId))) {
      state.expandedOrderIds.delete(orderId);
    }
  });

  renderLaneSet(ACTIVE_ORDER_LANES);
  renderLaneSet(EXCEPTION_ORDER_LANES);
  renderLaneSet(COMPLETED_ORDER_LANES);
}

function renderRidersBoard() {
  const available = state.riders.filter((rider) => rider.status === "available");
  const busy = state.riders.filter((rider) => rider.status === "busy");
  const offline = state.riders.filter((rider) => rider.status === "offline");

  renderRiderLane("availableRidersLane", available, "availableRiderCount");
  renderRiderLane("busyRidersLane", busy, "busyRiderCount");
  renderRiderLane("offlineRidersLane", offline, "offlineRiderCount");

  const columns = riderDeliveryColumns(state.orders);
  renderRiderOrderLane("readyForDeliveryLane", "readyForDeliveryCount", columns.ready);
  renderRiderOrderLane("pendingAcceptanceLane", "pendingAcceptanceCount", columns.pending);
  renderRiderOrderLane("deliveredLane", "deliveredCount", columns.delivered);
}

function getOrderById(orderId) {
  return state.orders.find((order) => String(order.id) === String(orderId));
}

async function confirmAction(message, options = {}) {
  const layoutApi = getAdminLayoutApi();
  if (layoutApi && typeof layoutApi.confirmAction === "function") {
    return layoutApi.confirmAction(message, options);
  }
  return window.confirm(message);
}

async function apiGet(path) {
  if (window.AdminCore && typeof window.AdminCore.api === "function") {
    return window.AdminCore.api(path);
  }

  const response = await fetch(path, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function apiMutate(path, { method = "POST", body = {} } = {}) {
  if (window.AdminCore && typeof window.AdminCore.api === "function") {
    return window.AdminCore.api(path, {
      method,
      body: JSON.stringify(body || {}),
    });
  }

  const csrf = sessionStorage.getItem("admin_csrf_token") || "";
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body || {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function runOrderAction(order, action, button) {
  if (!order || !ACTION_TO_STATUS[action]) return;

  const status = ACTION_TO_STATUS[action];
  const label = actionLabel(action);
  const payload = { status };

  if (action === "CANCEL_ORDER") {
    const reasonEl = document.getElementById(`cancelReason-${order.id}`);
    const cancelReason = String(reasonEl?.value || "").trim();
    if (!cancelReason) {
      setBoardStatus("Cancel reason is required.", "error");
      return;
    }
    payload.cancelReason = cancelReason;
  }

  const confirmed = await confirmAction(`Apply \"${label}\" to ${order.orderNumber}?`, {
    title: "Confirm Order Update",
    confirmLabel: "Apply",
  });
  if (!confirmed) return;

  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Applying...";
  }

  try {
    await apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, {
      method: "PATCH",
      body: payload,
    });
    setBoardStatus(`${label} applied to ${order.orderNumber}.`, "success");
    await refreshBoard({ silent: true });
  } catch (error) {
    setBoardStatus(error.message || "Unable to update order.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function runMonitorAction(order, button) {
  if (!order) return;
  const confirmed = await confirmAction(`Mark ${order.orderNumber} as monitored?`, {
    title: "Confirm Monitor",
    confirmLabel: "Mark",
  });
  if (!confirmed) return;

  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Updating...";
  }

  try {
    await apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/monitor`, {
      method: "POST",
      body: {},
    });
    setBoardStatus(`Order ${order.orderNumber} marked as monitored.`, "success");
    await refreshBoard({ silent: true });
  } catch (error) {
    setBoardStatus(error.message || "Unable to mark monitored.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function runDeliveryAction(order, deliveryAction, button) {
  if (!order) return;

  const actionConfig = {
    reset: {
      label: "Reset OTP Attempts",
      request: () => apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/delivery/reset-attempts`, {
        method: "POST",
        body: {},
      }),
    },
    regen: {
      label: "Regenerate OTP",
      request: () => apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/delivery/regenerate-code`, {
        method: "POST",
        body: {},
      }),
    },
    force: {
      label: "Force Complete",
      request: () => apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, {
        method: "PATCH",
        body: { status: "DELIVERED" },
      }),
    },
  }[deliveryAction];

  if (!actionConfig) return;

  const confirmed = await confirmAction(`${actionConfig.label} for ${order.orderNumber}?`, {
    title: "Confirm Delivery Recovery",
    confirmLabel: "Apply",
  });
  if (!confirmed) return;

  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Applying...";
  }

  try {
    const payload = await actionConfig.request();
    if (deliveryAction === "regen" && payload?.data?.sent === false) {
      setBoardStatus(
        `OTP regeneration skipped for ${order.orderNumber}: SMS policy currently disables OTP messages.`,
        "helper",
      );
    } else {
      setBoardStatus(`${actionConfig.label} applied for ${order.orderNumber}.`, "success");
    }
    await refreshBoard({ silent: true });
  } catch (error) {
    setBoardStatus(error.message || "Delivery recovery action failed.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function attachOrderHandlers(root) {
  root.querySelectorAll("button[data-role='toggle-order']").forEach((button) => {
    button.addEventListener("click", () => {
      const orderId = String(button.dataset.orderId || "").trim();
      if (!orderId) return;

      const card = button.closest("article[data-order-id]");
      if (!card) return;

      const collapsed = card.classList.toggle("is-collapsed");
      if (collapsed) {
        state.expandedOrderIds.delete(orderId);
      } else {
        state.expandedOrderIds.add(orderId);
      }
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  });

  root.querySelectorAll("button[data-role='manage-order']").forEach((button) => {
    button.addEventListener("click", async () => {
      const orderId = button.dataset.orderId || "";
      const order = getOrderById(orderId);
      if (!order) return;
      const orderDetailUrl = `/admin/order-detail.html?id=${encodeURIComponent(order.id)}`;

      button.disabled = true;
      button.textContent = "Opening...";

      try {
        await apiMutate(`/api/admin/orders/${encodeURIComponent(order.id)}/monitor`, {
          method: "POST",
          body: {},
        });
      } catch (_error) {
        // non-blocking; order detail page also marks monitored on load
      }

      window.location.href = orderDetailUrl;
    });
  });

}

function updateTabButtons(view) {
  const tabs = document.querySelectorAll(".ops-tab-btn");
  tabs.forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  const ordersView = document.getElementById("ordersBoardView");
  const exceptionsView = document.getElementById("exceptionsBoardView");
  const completedView = document.getElementById("completedBoardView");
  const ridersView = document.getElementById("ridersBoardView");
  if (ordersView) ordersView.classList.toggle("ops-view-hidden", view !== "orders");
  if (exceptionsView) exceptionsView.classList.toggle("ops-view-hidden", view !== "exceptions");
  if (completedView) completedView.classList.toggle("ops-view-hidden", view !== "completed");
  if (ridersView) ridersView.classList.toggle("ops-view-hidden", view !== "riders");
}

function mountTabHandlers() {
  document.querySelectorAll(".ops-tab-btn").forEach((tab) => {
    tab.addEventListener("click", () => {
      const requested = String(tab.dataset.view || "").trim();
      const view = ["orders", "exceptions", "completed", "riders"].includes(requested)
        ? requested
        : "orders";
      state.activeView = view;
      updateTabButtons(view);
    });
  });
}

function clearOpsStream() {
  if (state.opsStreamRetryTimerId) {
    clearTimeout(state.opsStreamRetryTimerId);
    state.opsStreamRetryTimerId = null;
  }
  if (state.opsEventSource) {
    state.opsEventSource.close();
    state.opsEventSource = null;
  }
  state.opsStreamConnected = false;
}

function queueRealtimeRefresh() {
  if (state.realtimeRefreshTimerId) return;
  state.realtimeRefreshTimerId = setTimeout(() => {
    state.realtimeRefreshTimerId = null;
    const elapsed = Date.now() - Number(state.lastBoardRefreshAt || 0);
    if (elapsed < REALTIME_MIN_REFRESH_GAP_MS) {
      queueRealtimeRefresh();
      return;
    }
    if (document.hidden) return;
    refreshBoard({ silent: true }).catch(() => {
      // best effort realtime refresh
    });
  }, 300);
}

function scheduleOpsStreamReconnect() {
  if (state.opsStreamRetryTimerId) {
    clearTimeout(state.opsStreamRetryTimerId);
  }
  state.opsStreamRetryTimerId = setTimeout(() => {
    if (document.hidden) return;
    connectOpsStream();
  }, OPS_STREAM_RECONNECT_MS);
}

function syncPollingLoop() {
  if (state.refreshTimerId) {
    clearInterval(state.refreshTimerId);
    state.refreshTimerId = null;
  }

  const intervalMs = state.opsStreamConnected ? ORDER_HEALTHCHECK_MS : ORDER_REFRESH_MS;
  state.refreshTimerId = setInterval(() => {
    if (document.hidden) return;
    refreshBoard({ silent: true }).catch(() => {
      // best-effort polling
    });
  }, intervalMs);
}

function connectOpsStream() {
  if (!window.EventSource) {
    clearOpsStream();
    syncPollingLoop();
    return;
  }

  clearOpsStream();

  const stream = new EventSource("/api/admin/events/ops-stream");
  state.opsEventSource = stream;

  stream.addEventListener("connected", () => {
    state.opsStreamConnected = true;
    syncPollingLoop();
  });
  stream.addEventListener("ops.snapshot", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("order.created", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("order.updated", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("order.assignment_updated", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("order.monitored", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("rider.presence", () => {
    queueRealtimeRefresh();
  });
  stream.addEventListener("rider.device", () => {
    queueRealtimeRefresh();
  });

  stream.onerror = () => {
    if (state.opsEventSource !== stream) return;
    state.opsStreamConnected = false;
    stream.close();
    state.opsEventSource = null;
    syncPollingLoop();
    scheduleOpsStreamReconnect();
  };
}

async function fetchOrders() {
  try {
    const payload = await apiGet("/api/admin/orders?limit=120");
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => normalizeOrder(row));
  } catch (error) {
    if (window.console && typeof console.warn === "function") {
      console.warn("Unable to fetch /api/admin/orders", error);
    }
    return [];
  }
}

async function fetchRiders({ force = false } = {}) {
  if (
    !force &&
    state.lastRidersFetchAt > 0 &&
    Date.now() - state.lastRidersFetchAt < RIDER_REFRESH_MS
  ) {
    return state.riders;
  }

  try {
    const payload = await apiGet("/api/admin/riders");
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    state.riderFeedUnavailable = false;
    const normalized = rows.map((row) => normalizeRider(row));
    state.lastRidersFetchAt = Date.now();
    return normalized;
  } catch (_error) {
    state.riderFeedUnavailable = true;
    return state.riders;
  }
}

async function fetchOrderPolicy() {
  try {
    const payload = await apiGet("/api/admin/orders/policy");
    const data = payload?.data || {};
    state.orderPolicy = {
      cancelReasons: Array.isArray(data.cancelReasons) ? data.cancelReasons : [],
    };
  } catch (_error) {
    state.orderPolicy = {
      cancelReasons: [],
    };
  }
}

async function refreshBoard({ silent = false } = {}) {
  state.lastBoardRefreshAt = Date.now();
  if (!silent) {
    setBoardStatus("Refreshing operations board...", "helper");
  }

  const orders = await fetchOrders();
  const riders = await fetchRiders({ force: !silent });

  state.orders = orders;
  state.riders = riders;

  renderOrdersBoard();
  renderRidersBoard();
  syncIncomingOrderAlertLoop();
  setSyncStamp();

  if (!orders.length) {
    setBoardStatus("No live orders currently.", "helper");
  } else if (state.riderFeedUnavailable) {
    setBoardStatus(
      `Loaded ${orders.length} order(s). Rider availability feed is unavailable; retrying automatically.`,
      "error",
    );
  } else {
    setBoardStatus(`Loaded ${orders.length} order(s) and ${riders.length} rider(s).`, "success");
  }
}

function mountRefreshHandlers() {
  const refreshButton = document.getElementById("opsRefreshBtn");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      refreshBoard({ silent: false }).catch((error) => {
        setBoardStatus(error.message || "Refresh failed.", "error");
      });
    });
  }

  syncPollingLoop();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopIncomingOrderAlertLoop();
      return;
    }
    if (!state.opsStreamConnected) {
      connectOpsStream();
    }
    refreshBoard({ silent: true }).catch(() => {
      // best-effort
    });
  });
}

function mountBackHandler() {
  const backBtn = document.getElementById("backBtn");
  if (!backBtn) return;
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = backBtn.dataset.fallback || "/admin/order-history.html";
  });
}

(async function initOperationsBoard() {
  const layoutApi = getAdminLayoutApi();
  if (!layoutApi || typeof layoutApi.initProtectedPage !== "function") {
    throw new Error("Admin layout bootstrap is unavailable on operations page.");
  }
  const admin = await layoutApi.initProtectedPage();
  if (!admin) return;

  const manageRidersBtn = document.getElementById("manageRidersBtn");
  if (manageRidersBtn && admin && String(admin.role || "").toLowerCase() !== "admin") {
    manageRidersBtn.style.display = "none";
  }

  mountTabHandlers();
  mountBackHandler();
  updateTabButtons(state.activeView);
  mountRefreshHandlers();
  connectOpsStream();
  window.addEventListener("admin:alert-setting-changed", () => {
    syncIncomingOrderAlertLoop();
  });
  window.addEventListener("beforeunload", () => {
    stopIncomingOrderAlertLoop();
    clearOpsStream();
    if (state.realtimeRefreshTimerId) {
      clearTimeout(state.realtimeRefreshTimerId);
      state.realtimeRefreshTimerId = null;
    }
  });
  await refreshBoard({ silent: false });
})();
