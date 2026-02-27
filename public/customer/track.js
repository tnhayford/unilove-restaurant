const STATUS_STEPS = [
  { key: "PENDING_PAYMENT", label: "Awaiting Payment" },
  { key: "PAID", label: "Order Confirmed" },
  { key: "PREPARING", label: "Kitchen Processing" },
  { key: "READY_FOR_PICKUP", label: "Ready" },
  { key: "OUT_FOR_DELIVERY", label: "On The Way" },
  { key: "DELIVERED", label: "Completed" },
];

const FAILURE_STATUSES = new Set(["PAYMENT_FAILED", "CANCELED", "REFUNDED", "RETURNED"]);
const TRACK_REFRESH_MS = 15000;
const TRACK_STREAM_RECONNECT_MS = 8000;

let activeOrderNumber = "";
let activeTrackingToken = "";
let refreshTimerId = null;
let trackingEventSource = null;
let trackingStreamConnected = false;
let trackingStreamRetryTimerId = null;

function parseAppTimestamp(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const normalizedBase = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  const normalized = /z$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateTime(input) {
  const date = parseAppTimestamp(input);
  if (!date) return "-";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNowTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function sanitizeOrderNumber(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function sanitizeTrackingToken(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
}

function toTitle(input) {
  return String(input || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value;
}

function stageLabelFromStatus(status, fallback) {
  const normalized = String(status || "").toUpperCase();
  const fromMap = STATUS_STEPS.find((step) => step.key === normalized)?.label;
  return fromMap || fallback || toTitle(normalized) || "-";
}

function setStatus(message, kind = "helper") {
  const element = document.getElementById("statusText");
  element.className = `status ${kind}`;
  element.textContent = message;
}

function setLoadingState(isLoading) {
  const trackBtn = document.getElementById("trackBtn");
  const refreshBtn = document.getElementById("refreshNowBtn");
  trackBtn.disabled = isLoading;
  refreshBtn.disabled = isLoading || !activeOrderNumber || !activeTrackingToken;
  trackBtn.textContent = isLoading ? "Checking..." : "Track Order";
}

function currentStepIndex(status) {
  const normalized = String(status || "").toUpperCase();
  const index = STATUS_STEPS.findIndex((step) => step.key === normalized);
  if (index >= 0) return index;
  if (normalized === "DELIVERED") return STATUS_STEPS.length - 1;
  return -1;
}

function statusPillClass(status) {
  const normalized = String(status || "").toUpperCase();
  if (FAILURE_STATUSES.has(normalized)) return "alert";
  if (normalized === "DELIVERED") return "done";
  if (normalized === "PENDING_PAYMENT") return "pending";
  return "progress";
}

function journeyNodeState(stepIndex, currentIndex, status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "DELIVERED" && stepIndex === STATUS_STEPS.length - 1) {
    return "done";
  }
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "blocked";
}

function renderJourneyRail(status) {
  const rail = document.getElementById("journeyRail");
  const index = currentStepIndex(status);
  rail.innerHTML = STATUS_STEPS.map((step, stepIndex) => {
    const state = journeyNodeState(stepIndex, index, status);
    return `<div class="journey-node ${state}">${step.label}</div>`;
  }).join("");
}

function renderTimeline(status) {
  const list = document.getElementById("timelineList");
  const index = currentStepIndex(status);
  const entries = STATUS_STEPS.map((step, stepIndex) => {
    const stateClass = journeyNodeState(stepIndex, index, status);
    const stateLabel = stateClass === "done" ? "Done" : stateClass === "active" ? "Current" : "Pending";
    return `
      <li class="${stateClass}">
        <span class="dot">${stepIndex + 1}</span>
        <span class="stage-name">${step.label}</span>
        <span class="stage-state">${stateLabel}</span>
      </li>
    `;
  });
  list.innerHTML = entries.join("");
}

function renderItems(items) {
  const list = document.getElementById("itemsList");
  list.innerHTML = "";

  const safeItems = Array.isArray(items) ? items : [];
  const totalCount = safeItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const badgeValue = `${totalCount} item(s)`;
  setText("itemCountValue", badgeValue);
  setText("itemCountBadge", badgeValue);

  if (!safeItems.length) {
    const empty = document.createElement("li");
    empty.className = "items-item empty";
    empty.textContent = "Item details will appear here once available.";
    list.appendChild(empty);
    return;
  }

  safeItems.forEach((item) => {
    const row = document.createElement("li");
    row.className = "items-item";

    const left = document.createElement("div");
    left.className = "items-main";

    const name = document.createElement("p");
    name.className = "item-name";
    name.textContent = item.name || "Item";

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `${Number(item.quantity || 0)} x GHS ${formatMoney(item.unitPriceCedis)}`;

    left.appendChild(name);
    left.appendChild(meta);

    const total = document.createElement("p");
    total.className = "item-total";
    total.textContent = `GHS ${formatMoney(item.lineTotalCedis)}`;

    row.appendChild(left);
    row.appendChild(total);
    list.appendChild(row);
  });
}

function renderTracking(data) {
  const status = String(data.status || "").toUpperCase();
  const stageLabel = stageLabelFromStatus(status, data.stage);
  const subtotalValue = `GHS ${formatMoney(data.subtotalCedis)}`;
  const deliveryType = String(data.deliveryType || "").toLowerCase();
  const addressText = deliveryType === "delivery"
    ? data.address || "Address not yet set."
    : "Pickup at restaurant";
  const paymentConfirmedValue = data.paymentConfirmedAt ? formatDateTime(data.paymentConfirmedAt) : "Pending";
  const etaValue = data.etaLabel ? data.etaLabel : "-";

  setText("orderNumberValue", data.orderNumber || "-");
  setText("stageValue", stageLabel);
  setText("deliveryTypeValue", toTitle(data.deliveryType || "-"));
  setText("sourceValue", toTitle(data.source || "-"));
  setText("paymentMethodValue", toTitle(data.paymentMethod || "-"));
  setText("paymentStatusValue", data.paymentStatus || "-");
  setText("subtotalValue", subtotalValue);
  setText("etaValue", etaValue);
  setText("customerNameValue", data.customerName || "-");
  setText("customerPhoneValue", data.customerPhone || "-");
  setText("addressValue", addressText);
  setText("createdAtValue", formatDateTime(data.createdAt));
  setText("updatedAtValue", formatDateTime(data.updatedAt));
  setText("paymentConfirmedAtValue", paymentConfirmedValue);
  setText("lastSyncValue", formatNowTime());

  const pill = document.getElementById("statusPill");
  pill.className = `status-pill ${statusPillClass(status)}`;
  pill.textContent = stageLabel;

  renderJourneyRail(status);
  renderTimeline(status);
  renderItems(data.items);
}

async function fetchTracking(orderNumber, trackingToken) {
  const url = new URL(`/api/orders/track/${encodeURIComponent(orderNumber)}`, window.location.origin);
  url.searchParams.set("token", trackingToken);
  url.searchParams.set("ts", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to find this order");
  }
  return payload.data;
}

function autoRefreshEnabled() {
  return document.getElementById("autoRefreshToggle").checked;
}

function setOrderQuery(orderNumber) {
  const url = new URL(window.location.href);
  if (orderNumber) {
    url.searchParams.set("order", orderNumber);
  } else {
    url.searchParams.delete("order");
  }
  // Do not persist secure tokens in browser history/query state.
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url);
}

function syncRefreshTimer() {
  if (refreshTimerId) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }

  if (!activeOrderNumber || !activeTrackingToken || !autoRefreshEnabled()) return;
  if (trackingStreamConnected) return;

  refreshTimerId = setInterval(() => {
    if (!activeOrderNumber || !activeTrackingToken || document.hidden) return;
    runTrack(activeOrderNumber, activeTrackingToken, {
      silent: true,
      skipRealtimeReconnect: true,
    }).catch(() => {
      // best effort auto refresh
    });
  }, TRACK_REFRESH_MS);
}

function closeTrackingStream() {
  if (trackingStreamRetryTimerId) {
    clearTimeout(trackingStreamRetryTimerId);
    trackingStreamRetryTimerId = null;
  }
  if (trackingEventSource) {
    trackingEventSource.close();
    trackingEventSource = null;
  }
  trackingStreamConnected = false;
}

function scheduleTrackingStreamReconnect(orderNumber, trackingToken) {
  if (trackingStreamRetryTimerId) {
    clearTimeout(trackingStreamRetryTimerId);
  }
  trackingStreamRetryTimerId = setTimeout(() => {
    if (!activeOrderNumber || !activeTrackingToken || document.hidden) return;
    if (activeOrderNumber !== orderNumber || activeTrackingToken !== trackingToken) return;
    connectTrackingStream(orderNumber, trackingToken);
  }, TRACK_STREAM_RECONNECT_MS);
}

function connectTrackingStream(orderNumber, trackingToken) {
  if (!window.EventSource || !autoRefreshEnabled()) {
    closeTrackingStream();
    syncRefreshTimer();
    return;
  }

  closeTrackingStream();

  const url = new URL(
    `/api/orders/track/${encodeURIComponent(orderNumber)}/stream`,
    window.location.origin,
  );
  url.searchParams.set("token", trackingToken);

  const source = new EventSource(url.toString());
  trackingEventSource = source;

  source.addEventListener("connected", () => {
    trackingStreamConnected = true;
    syncRefreshTimer();
  });

  const refreshFromRealtime = () => {
    if (!activeOrderNumber || !activeTrackingToken) return;
    runTrack(activeOrderNumber, activeTrackingToken, {
      silent: true,
      skipRealtimeReconnect: true,
    }).catch(() => {
      // best effort realtime refresh
    });
  };

  source.addEventListener("tracking.snapshot", refreshFromRealtime);
  source.addEventListener("tracking.update", refreshFromRealtime);

  source.onerror = () => {
    if (trackingEventSource !== source) return;
    trackingStreamConnected = false;
    source.close();
    trackingEventSource = null;
    syncRefreshTimer();
    scheduleTrackingStreamReconnect(orderNumber, trackingToken);
  };
}

async function runTrack(
  orderNumber,
  trackingTokenInput = null,
  { silent = false, skipRealtimeReconnect = false } = {},
) {
  const normalized = sanitizeOrderNumber(orderNumber);
  const normalizedToken = sanitizeTrackingToken(
    trackingTokenInput === null
      ? document.getElementById("trackingTokenInput").value
      : trackingTokenInput,
  );
  if (!normalized) {
    setStatus("Please enter a valid order number.", "error");
    return;
  }
  if (!normalizedToken) {
    setStatus("Use the secure tracking token from your SMS link.", "error");
    return;
  }

  if (!silent) {
    setLoadingState(true);
    setStatus("Checking live order progress...", "helper");
  }

  try {
    const data = await fetchTracking(normalized, normalizedToken);
    const previousOrder = activeOrderNumber;
    const previousToken = activeTrackingToken;
    activeOrderNumber = normalized;
    activeTrackingToken = normalizedToken;
    document.getElementById("trackingTokenInput").value = normalizedToken;
    setOrderQuery(normalized);
    renderTracking(data);
    syncRefreshTimer();
    if (
      !skipRealtimeReconnect &&
      (previousOrder !== normalized ||
        previousToken !== normalizedToken ||
        !trackingEventSource)
    ) {
      connectTrackingStream(normalized, normalizedToken);
    }
    setStatus(`Order ${data.orderNumber} is currently ${stageLabelFromStatus(data.status, data.stage)}.`, "success");
  } catch (error) {
    if (!silent) {
      closeTrackingStream();
    }
    setStatus(error.message || "Unable to track this order.", "error");
  } finally {
    if (!silent) {
      setLoadingState(false);
    }
  }
}

function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = sanitizeOrderNumber(params.get("order"));
  const tokenFromQuery = sanitizeTrackingToken(params.get("token"));
  if (!fromQuery || !tokenFromQuery) return;
  document.getElementById("orderNumberInput").value = fromQuery;
  document.getElementById("trackingTokenInput").value = tokenFromQuery;
  runTrack(fromQuery, tokenFromQuery).catch(() => {
    // first-load error is shown in UI
  });
}

document.getElementById("trackForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const orderNumber = document.getElementById("orderNumberInput").value;
  const trackingToken = document.getElementById("trackingTokenInput").value;
  await runTrack(orderNumber, trackingToken);
});

document.getElementById("refreshNowBtn").addEventListener("click", async () => {
  if (!activeOrderNumber) {
    setStatus("Track an order first, then refresh.", "error");
    return;
  }
  await runTrack(activeOrderNumber, activeTrackingToken);
});

document.getElementById("autoRefreshToggle").addEventListener("change", () => {
  if (!autoRefreshEnabled()) {
    closeTrackingStream();
  } else if (activeOrderNumber && activeTrackingToken) {
    connectTrackingStream(activeOrderNumber, activeTrackingToken);
  }
  syncRefreshTimer();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activeOrderNumber && activeTrackingToken) {
    runTrack(activeOrderNumber, activeTrackingToken, { silent: true }).catch(() => {
      // best effort foreground refresh
    });
  }
  syncRefreshTimer();
});

window.addEventListener("focus", () => {
  if (!activeOrderNumber || !activeTrackingToken) return;
  runTrack(activeOrderNumber, activeTrackingToken, {
    silent: true,
    skipRealtimeReconnect: true,
  }).catch(() => {
    // best effort focus refresh
  });
});

window.addEventListener("beforeunload", () => {
  closeTrackingStream();
});

setText("autoRefreshLabel", `Auto refresh every ${Math.round(TRACK_REFRESH_MS / 1000)} seconds`);
setLoadingState(false);
initFromQuery();
