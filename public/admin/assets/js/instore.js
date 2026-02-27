let allMenuItems = [];
let selectedCategory = "__all__";
let menuPage = 1;
const MENU_PAGE_SIZE = 12;
const cart = new Map();
let momoVerification = null;
let customerSearchTimer = null;
let customerSuggestionMap = new Map();
const OFFLINE_QUEUE_KEY = "instore_offline_queue_v1";
const OFFLINE_QUEUE_CRYPTO_KEY = "instore_offline_queue_crypto_key_v1";
const PAYMENT_MONITOR_KEY = "instore_payment_monitors_v1";
const PAYMENT_MONITOR_POLL_MS = 1800;
const PAYMENT_MONITOR_PENDING_RETRY_COOLDOWN_MS = 60000;
const PAYMENT_MONITOR_RETRY_OVERRIDE_WINDOW_MS = 180000;
const PAYMENT_MONITOR_MAX_ITEMS = 16;
const paymentMonitors = new Map();
let paymentMonitorIntervalId = null;
let paymentMonitorCountdownTickId = null;
let paymentMonitorRefreshInFlight = false;
let monitorPermissionWarningShown = false;
const monitorRetryInFlight = new Set();
const monitorStatusCheckInFlight = new Set();

const ALLOWED_MOMO_CHANNELS = new Set(["mtn-gh", "vodafone-gh", "tigo-gh"]);

const CATEGORY_COLORS = [
  "fern",
  "berry",
  "lilac",
  "lime",
  "sand",
  "rose",
];

const PAYMENT_SUCCESS_STATUSES = new Set([
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
]);

const PAYMENT_FAILURE_STATUSES = new Set([
  "PAYMENT_FAILED",
  "CANCELED",
  "REFUNDED",
]);

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

function timestampToMs(input) {
  const date = parseAppTimestamp(input);
  return date ? date.getTime() : 0;
}

function formatRelativeTime(input) {
  const date = parseAppTimestamp(input);
  if (!date) return "-";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatClockTime(input) {
  const date = parseAppTimestamp(input);
  if (!date) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getMonitorStatusBadgeClass(status) {
  if (status === "PENDING_PAYMENT") return "pending";
  if (PAYMENT_FAILURE_STATUSES.has(status)) return "error";
  return "success";
}

function getMonitorStatusText(status) {
  switch (status) {
    case "PENDING_PAYMENT":
      return "Awaiting PIN";
    case "PAYMENT_FAILED":
      return "Payment Failed";
    case "PAID":
      return "Paid";
    case "PREPARING":
      return "Confirmed";
    case "READY_FOR_PICKUP":
      return "Kitchen Ready";
    case "OUT_FOR_DELIVERY":
      return "Dispatched";
    case "DELIVERED":
      return "Completed";
    case "CANCELED":
      return "Canceled";
    case "REFUNDED":
      return "Refunded";
    default:
      return String(status || "Unknown")
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/^\w/, (char) => char.toUpperCase());
  }
}

function shouldMonitorPoll(monitor) {
  if (!monitor?.orderId) return false;
  if (monitor.monitorDisabled) return false;
  return monitor.status === "PENDING_PAYMENT";
}

function getPendingRetryCooldownMs(monitor) {
  const updatedAtMs = timestampToMs(monitor?.updatedAt || monitor?.watchedAt);
  if (!updatedAtMs) return PAYMENT_MONITOR_PENDING_RETRY_COOLDOWN_MS;
  const elapsedMs = Date.now() - updatedAtMs;
  return Math.max(0, PAYMENT_MONITOR_PENDING_RETRY_COOLDOWN_MS - elapsedMs);
}

function hasRecentManualStatusCheckRetryOverride(monitor) {
  if (!monitor || monitor.lastStatusCheckPaid !== false || !monitor.allowRetryAfterStatusCheck) {
    return false;
  }
  const checkedAtMs = timestampToMs(monitor.lastManualStatusCheckAt);
  if (!checkedAtMs) return false;
  return Date.now() - checkedAtMs <= PAYMENT_MONITOR_RETRY_OVERRIDE_WINDOW_MS;
}

function canRetryPaymentPromptForMonitor(monitor) {
  const status = String(monitor?.status || "").toUpperCase();
  if (status === "PAYMENT_FAILED") return true;
  if (status !== "PENDING_PAYMENT") return false;
  if (hasRecentManualStatusCheckRetryOverride(monitor)) return true;
  return getPendingRetryCooldownMs(monitor) <= 0;
}

function canStatusCheckMonitor(monitor) {
  const status = String(monitor?.status || "").toUpperCase();
  if (!monitor?.orderId || !monitor?.clientReference) return false;
  return status === "PENDING_PAYMENT" || status === "PAYMENT_FAILED";
}

function retryBlockedMessage(monitor) {
  if (!monitor) return "Retry target not found.";
  const status = String(monitor.status || "").toUpperCase();
  if (status === "PENDING_PAYMENT") {
    const waitMs = getPendingRetryCooldownMs(monitor);
    if (waitMs > 0) {
      const waitSeconds = Math.ceil(waitMs / 1000);
      return `Prompt still active for ${monitor.orderNumber}. Retry in ${waitSeconds}s if no callback arrives.`;
    }
  }
  return `Order ${monitor.orderNumber} cannot retry in status ${monitor.status}.`;
}

function formatRetryCountdownLabel(monitor, prefix = "Regenerate in") {
  const waitMs = getPendingRetryCooldownMs(monitor);
  const waitSeconds = Math.max(0, Math.ceil(waitMs / 1000));
  return `${prefix} ${waitSeconds}s`;
}

function shouldRunCountdownTicker(monitors = getSortedMonitors()) {
  return monitors.some((monitor) => {
    const status = String(monitor?.status || "").toUpperCase();
    if (status !== "PENDING_PAYMENT") return false;
    if (monitorRetryInFlight.has(monitor.orderId)) return false;
    return !canRetryPaymentPromptForMonitor(monitor) && getPendingRetryCooldownMs(monitor) > 0;
  });
}

function resolveMonitorPaymentChannel(input) {
  const normalized = String(input || "")
    .trim()
    .toLowerCase();
  if (ALLOWED_MOMO_CHANNELS.has(normalized)) return normalized;
  return null;
}

function resolveOrderPaymentMethod(order, fallbackMethod = "") {
  const resolved =
    order?.payment_method ||
    order?.paymentMethod ||
    fallbackMethod ||
    "";
  return String(resolved).trim().toLowerCase();
}

function isMomoOrder(order, fallbackMethod = "") {
  if (order?.paymentPrompt) return true;
  return resolveOrderPaymentMethod(order, fallbackMethod) === "momo";
}

function sanitizeMonitorPayload(input) {
  if (!input || typeof input !== "object") return null;
  const orderId = String(input.orderId || "").trim();
  if (!orderId) return null;
  return {
    orderId,
    orderNumber: String(input.orderNumber || "-").trim() || "-",
    clientReference: String(input.clientReference || "").trim(),
    paymentChannel: resolveMonitorPaymentChannel(input.paymentChannel) || "",
    phone: String(input.phone || "").trim(),
    status: String(input.status || "PENDING_PAYMENT").trim().toUpperCase(),
    stageLabel: String(input.stageLabel || "Awaiting payment").trim(),
    updatedAt: input.updatedAt || null,
    watchedAt: input.watchedAt || new Date().toISOString(),
    lastNotifiedStatus: String(input.lastNotifiedStatus || "").trim().toUpperCase(),
    lastManualStatusCheckAt: input.lastManualStatusCheckAt || null,
    lastStatusCheckPaid:
      typeof input.lastStatusCheckPaid === "boolean" ? input.lastStatusCheckPaid : null,
    allowRetryAfterStatusCheck: Boolean(input.allowRetryAfterStatusCheck),
    monitorDisabled: Boolean(input.monitorDisabled),
    errorHint: String(input.errorHint || "").trim(),
  };
}

function getSortedMonitors() {
  return [...paymentMonitors.values()].sort((left, right) => {
    const diff = timestampToMs(right.watchedAt || right.updatedAt) - timestampToMs(left.watchedAt || left.updatedAt);
    if (diff !== 0) return diff;
    return String(right.orderNumber || "").localeCompare(String(left.orderNumber || ""));
  });
}

function persistPaymentMonitors() {
  const sorted = getSortedMonitors().slice(0, PAYMENT_MONITOR_MAX_ITEMS);
  localStorage.setItem(PAYMENT_MONITOR_KEY, JSON.stringify(sorted));
}

function prunePaymentMonitors() {
  const sorted = getSortedMonitors();
  if (sorted.length <= PAYMENT_MONITOR_MAX_ITEMS) return;
  const keepIds = new Set(sorted.slice(0, PAYMENT_MONITOR_MAX_ITEMS).map((item) => item.orderId));
  paymentMonitors.forEach((_, key) => {
    if (!keepIds.has(key)) {
      paymentMonitors.delete(key);
    }
  });
}

function renderPaymentMonitors() {
  const e = AdminCore.escapeHtml;
  const listEl = document.getElementById("paymentMonitorList");
  const metaEl = document.getElementById("paymentMonitorMeta");
  const panelEl = document.querySelector(".instore-live-monitor");
  if (!listEl || !metaEl) return;

  const monitors = getSortedMonitors();
  const pendingCount = monitors.filter((item) => item.status === "PENDING_PAYMENT").length;
  const successCount = monitors.filter((item) => PAYMENT_SUCCESS_STATUSES.has(item.status)).length;
  const failedCount = monitors.filter((item) => PAYMENT_FAILURE_STATUSES.has(item.status)).length;
  metaEl.textContent = `Pending ${pendingCount} | Confirmed ${successCount} | Failed ${failedCount}`;

  if (panelEl) {
    const needsAttention = pendingCount > 0 || failedCount > 0;
    panelEl.open = needsAttention;
  }

  if (!monitors.length) {
    listEl.innerHTML = '<div class="payment-monitor-empty">No live payment prompts yet.</div>';
    updatePaymentMonitorLoopState();
    return;
  }

  listEl.innerHTML = monitors
    .map((monitor) => {
      const badgeClass = getMonitorStatusBadgeClass(monitor.status);
      const badgeText = getMonitorStatusText(monitor.status);
      const lastSeen = monitor.updatedAt || monitor.watchedAt;
      const statusLine = monitor.stageLabel || badgeText;
      const hintLine = monitor.errorHint
        ? `<div class="payment-monitor-updated">${e(monitor.errorHint)}</div>`
        : "";
      const channelLabel = resolveMonitorPaymentChannel(monitor.paymentChannel) || "-";
      const canRetry = canRetryPaymentPromptForMonitor(monitor);
      const retryBusy = monitorRetryInFlight.has(monitor.orderId);
      const retryCooldown = String(monitor.status || "").toUpperCase() === "PENDING_PAYMENT"
        ? getPendingRetryCooldownMs(monitor)
        : 0;
      const canStatusCheck = canStatusCheckMonitor(monitor);
      const statusCheckBusy = monitorStatusCheckInFlight.has(monitor.orderId);
      const statusCheckAction = canStatusCheck
        ? `
            <button
              type="button"
              class="btn payment-btn-check"
              data-role="status-check-monitor"
              data-order-id="${e(monitor.orderId)}"
              ${statusCheckBusy ? "disabled" : ""}
            >
              ${statusCheckBusy ? `Checking ${e(monitor.orderNumber)}...` : `Check ${e(monitor.orderNumber)}`}
            </button>
          `
        : "";
      let retryAction = "";
      if (canRetry) {
        retryAction = `
            <button
              type="button"
              class="btn payment-btn-regen"
              data-role="retry-monitor"
              data-order-id="${e(monitor.orderId)}"
              ${retryBusy ? "disabled" : ""}
            >
              ${retryBusy ? `Regenerating ${e(monitor.orderNumber)}...` : `Regenerate ${e(monitor.orderNumber)}`}
            </button>
          `;
      } else if (retryCooldown > 0) {
        retryAction = `
            <button
              type="button"
              class="btn payment-btn-regen"
              disabled
            >
              ${e(formatRetryCountdownLabel(monitor, `Regenerate ${monitor.orderNumber} in`))}
            </button>
          `;
      }
      return `
        <article class="payment-monitor-card">
          <div class="payment-monitor-top">
            <span class="payment-monitor-id">${e(monitor.orderNumber)}</span>
            <span class="payment-monitor-status ${e(badgeClass)}">${e(badgeText)}</span>
          </div>
          <div class="payment-monitor-line">
            <span>Customer: <strong>${e(monitor.phone || "-")}</strong></span>
            <span>Ref: <strong>${e(monitor.clientReference || "-")}</strong></span>
          </div>
          <div class="payment-monitor-line">
            <span>Stage: <strong>${e(statusLine)}</strong></span>
            <span>Network: <strong>${e(channelLabel)}</strong></span>
          </div>
          <div class="payment-monitor-updated">
            Last update ${e(formatRelativeTime(lastSeen))} at ${e(formatClockTime(lastSeen))}
          </div>
          <div class="payment-monitor-actions">
            ${statusCheckAction}
            ${retryAction}
          </div>
          ${hintLine}
        </article>
      `;
    })
    .join("");

  updatePaymentMonitorLoopState();
}

function updatePaymentMonitorLoopState() {
  const hasPending = [...paymentMonitors.values()].some((monitor) => shouldMonitorPoll(monitor));
  if (hasPending && !paymentMonitorIntervalId) {
    paymentMonitorIntervalId = window.setInterval(() => {
      refreshPaymentMonitors().catch(() => {
        // non-blocking poll cycle
      });
    }, PAYMENT_MONITOR_POLL_MS);
  }
  if (!hasPending && paymentMonitorIntervalId) {
    window.clearInterval(paymentMonitorIntervalId);
    paymentMonitorIntervalId = null;
  }

  const runCountdown = shouldRunCountdownTicker([...paymentMonitors.values()]);
  if (runCountdown && !paymentMonitorCountdownTickId) {
    paymentMonitorCountdownTickId = window.setInterval(() => {
      renderPaymentMonitors();
    }, 1000);
  }
  if (!runCountdown && paymentMonitorCountdownTickId) {
    window.clearInterval(paymentMonitorCountdownTickId);
    paymentMonitorCountdownTickId = null;
  }
}

function upsertPaymentMonitor(entry) {
  const sanitized = sanitizeMonitorPayload(entry);
  if (!sanitized) return;
  const existing = paymentMonitors.get(sanitized.orderId) || {};
  paymentMonitors.set(sanitized.orderId, {
    ...existing,
    ...sanitized,
  });
  prunePaymentMonitors();
  persistPaymentMonitors();
  renderPaymentMonitors();
  updatePaymentMonitorLoopState();
}

function removeCompletedMonitors() {
  let removed = 0;
  paymentMonitors.forEach((monitor, key) => {
    if (monitor.status !== "PENDING_PAYMENT") {
      paymentMonitors.delete(key);
      removed += 1;
    }
  });
  persistPaymentMonitors();
  renderPaymentMonitors();
  updatePaymentMonitorLoopState();
  if (removed > 0) {
    setActionFeedback(`Cleared ${removed} completed monitor item(s).`, "helper");
  } else {
    setActionFeedback("No completed monitor items to clear.", "helper");
  }
}

function hydratePaymentMonitors() {
  let raw = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PAYMENT_MONITOR_KEY) || "[]");
    raw = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    raw = [];
  }

  paymentMonitors.clear();
  raw.forEach((entry) => {
    const sanitized = sanitizeMonitorPayload(entry);
    if (!sanitized) return;
    paymentMonitors.set(sanitized.orderId, sanitized);
  });

  prunePaymentMonitors();
  persistPaymentMonitors();
  renderPaymentMonitors();
  updatePaymentMonitorLoopState();
}

function notifyMonitorStatusTransition({ previousStatus, nextStatus, monitor }) {
  if (previousStatus !== "PENDING_PAYMENT" || !nextStatus || previousStatus === nextStatus) {
    return;
  }

  if (PAYMENT_SUCCESS_STATUSES.has(nextStatus)) {
    setActionFeedback(`Payment confirmed for ${monitor.orderNumber}. Continue with next customer.`, "success");
    AdminLayout.notifyAction(
      `${monitor.orderNumber} payment confirmed. Order moved to ${monitor.stageLabel || "next stage"}.`,
      { title: "Payment Confirmed" },
    ).catch(() => {
      // notification failures should not block checkout workflow
    });
    return;
  }

  if (PAYMENT_FAILURE_STATUSES.has(nextStatus)) {
    setActionFeedback(`Payment failed for ${monitor.orderNumber}. Retry customer prompt.`, "error");
    AdminLayout.notifyAction(
      `${monitor.orderNumber} payment failed. Staff can retry prompt or switch to cash.`,
      { title: "Payment Failed" },
    ).catch(() => {
      // notification failures should not block checkout workflow
    });
  }
}

function getDefaultRetryChannel() {
  const selected = resolveMonitorPaymentChannel(document.getElementById("paymentChannel")?.value);
  return selected || "mtn-gh";
}

function resolveRetryChannelForMonitor(monitor) {
  const fromMonitor = resolveMonitorPaymentChannel(monitor?.paymentChannel);
  if (fromMonitor) return fromMonitor;
  return getDefaultRetryChannel();
}

function buildMonitorPatchFromOrder({
  existingMonitor,
  order,
  prompt = null,
  fallbackChannel = "",
  errorHint = "",
  statusCheckState = "preserve",
}) {
  const promptChannel = resolveMonitorPaymentChannel(prompt?.channel || fallbackChannel || existingMonitor?.paymentChannel);
  const normalizedStatus = String(order?.status || existingMonitor?.status || "PENDING_PAYMENT").toUpperCase();
  const nextStatusCheckState = String(statusCheckState || "preserve").trim().toLowerCase();
  let allowRetryAfterStatusCheck = existingMonitor?.allowRetryAfterStatusCheck;
  let lastManualStatusCheckAt = existingMonitor?.lastManualStatusCheckAt || null;
  let lastStatusCheckPaid = existingMonitor?.lastStatusCheckPaid ?? null;

  if (nextStatusCheckState === "paid") {
    allowRetryAfterStatusCheck = false;
    lastManualStatusCheckAt = new Date().toISOString();
    lastStatusCheckPaid = true;
  } else if (nextStatusCheckState === "failed") {
    allowRetryAfterStatusCheck = true;
    lastManualStatusCheckAt = new Date().toISOString();
    lastStatusCheckPaid = false;
  } else if (nextStatusCheckState === "pending") {
    allowRetryAfterStatusCheck = false;
    lastManualStatusCheckAt = null;
    lastStatusCheckPaid = null;
  }

  return {
    ...(existingMonitor || {}),
    orderId: String(order?.id || existingMonitor?.orderId || "").trim(),
    orderNumber: order?.order_number || existingMonitor?.orderNumber || "-",
    clientReference:
      prompt?.clientReference ||
      order?.client_reference ||
      existingMonitor?.clientReference ||
      "",
    paymentChannel: promptChannel || "",
    phone: order?.phone || existingMonitor?.phone || "",
    status: normalizedStatus,
    stageLabel: order?.stageLabel || existingMonitor?.stageLabel || "Awaiting payment",
    updatedAt: order?.updated_at || new Date().toISOString(),
    watchedAt: new Date().toISOString(),
    monitorDisabled: false,
    errorHint,
    allowRetryAfterStatusCheck,
    lastManualStatusCheckAt,
    lastStatusCheckPaid,
  };
}

async function runStatusCheckForMonitor(orderId) {
  const monitor = paymentMonitors.get(orderId);
  if (!monitor) {
    setActionFeedback("Status check target not found. Refresh and try again.", "error");
    return;
  }
  if (!canStatusCheckMonitor(monitor)) {
    setActionFeedback(`Status check unavailable for ${monitor.orderNumber} in ${monitor.status}.`, "helper");
    return;
  }
  if (monitorStatusCheckInFlight.has(orderId)) return;

  monitorStatusCheckInFlight.add(orderId);
  renderPaymentMonitors();

  try {
    const response = await AdminCore.api(
      `/api/admin/orders/${encodeURIComponent(orderId)}/payments/momo/status-check`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    const data = response?.data || {};
    const order = data.order || {};
    const paid = Boolean(data.paid);
    const providerOutcome = String(data.providerOutcome || "").trim().toLowerCase();
    const providerStatus = String(data.providerStatus || "").trim();
    const failureHint = String(data.failureHint || "").trim();
    const statusHint = data.skipped
      ? `Status check skipped (${data.reason || "configuration missing"}).`
      : (failureHint || (providerStatus ? `Provider status: ${providerStatus}` : ""));
    const statusCheckState = paid
      ? "paid"
      : (providerOutcome === "failed" ? "failed" : "pending");

    upsertPaymentMonitor(
      buildMonitorPatchFromOrder({
        existingMonitor: monitor,
        order,
        fallbackChannel: monitor.paymentChannel,
        errorHint: statusHint,
        statusCheckState,
      }),
    );

    renderResult(order);
    if (paid) {
      setActionFeedback(`Payment confirmed for ${monitor.orderNumber}.`, "success");
    } else if (providerOutcome === "failed") {
      setActionFeedback(
        failureHint
          ? `${monitor.orderNumber}: ${failureHint}`
          : `Hubtel reports failed payment for ${monitor.orderNumber}. Regenerate Prompt to retry collection.`,
        "error",
      );
    } else {
      setActionFeedback(
        failureHint
          ? `${monitor.orderNumber}: ${failureHint}`
          : `Payment not confirmed for ${monitor.orderNumber}. Use Regenerate Prompt if customer did not receive prompt.`,
        failureHint ? "warn" : "helper",
      );
    }
    await refreshPaymentMonitors().catch(() => {
      // non-blocking follow-up refresh
    });
  } catch (error) {
    setActionFeedback(`Status check failed: ${toHumanInstoreError(error)}`, "error");
  } finally {
    monitorStatusCheckInFlight.delete(orderId);
    renderPaymentMonitors();
  }
}

async function retryMomoPromptForMonitor(orderId) {
  const monitor = paymentMonitors.get(orderId);
  if (!monitor) {
    setActionFeedback("Regenerate target not found. Refresh and try again.", "error");
    return;
  }

  if (!canRetryPaymentPromptForMonitor(monitor)) {
    setActionFeedback(retryBlockedMessage(monitor), "helper");
    return;
  }

  if (monitorRetryInFlight.has(orderId)) return;

  const paymentChannel = resolveRetryChannelForMonitor(monitor);
  const confirmed = await AdminLayout.confirmAction(
    `Regenerate MoMo prompt for ${monitor.orderNumber} on ${paymentChannel}?`,
    { title: "Regenerate Payment Prompt", confirmLabel: "Regenerate" },
  );
  if (!confirmed) return;

  monitorRetryInFlight.add(orderId);
  renderPaymentMonitors();

  try {
    const response = await AdminCore.api(
      `/api/admin/orders/${encodeURIComponent(orderId)}/payments/momo/retry`,
      {
        method: "POST",
        body: JSON.stringify({ paymentChannel }),
      },
    );
    const order = response?.data?.order || {};
    const prompt = response?.data?.paymentPrompt || {};
    const promptChannel = resolveMonitorPaymentChannel(prompt.channel || paymentChannel) || paymentChannel;

    upsertPaymentMonitor(
      buildMonitorPatchFromOrder({
        existingMonitor: monitor,
        order,
        prompt,
        fallbackChannel: promptChannel,
        errorHint: "",
        statusCheckState: "pending",
      }),
    );

    renderResult({
      ...order,
      paymentPrompt: {
        ...prompt,
        channel: promptChannel,
      },
    });

    setActionFeedback(`Prompt regenerated for ${monitor.orderNumber}.`, "success");
    await AdminLayout.notifyAction(
      `Prompt regenerated for ${monitor.orderNumber} on ${promptChannel}.`,
      { title: "Prompt Regenerated" },
    );
    await refreshPaymentMonitors().catch(() => {
      // non-blocking follow-up refresh
    });
  } catch (error) {
    if (error?.status === 409) {
      await refreshPaymentMonitors().catch(() => {
        // non-blocking follow-up refresh
      });
    }
    setActionFeedback(`Regenerate failed: ${toHumanInstoreError(error)}`, "error");
  } finally {
    monitorRetryInFlight.delete(orderId);
    renderPaymentMonitors();
  }
}

async function refreshPaymentMonitors() {
  if (paymentMonitorRefreshInFlight) return;
  const targets = [...paymentMonitors.values()].filter((monitor) => shouldMonitorPoll(monitor));
  if (!targets.length) {
    updatePaymentMonitorLoopState();
    return;
  }

  paymentMonitorRefreshInFlight = true;
  try {
    for (const monitor of targets) {
      try {
        const payload = await AdminCore.api(`/api/admin/orders/${encodeURIComponent(monitor.orderId)}`);
        const order = payload?.data || {};
        const nextStatus = String(order.status || monitor.status || "PENDING_PAYMENT").toUpperCase();
        const previousStatus = String(monitor.status || "PENDING_PAYMENT").toUpperCase();
        const updatedMonitor = {
          ...monitor,
          orderNumber: order.order_number || monitor.orderNumber,
          clientReference: order.client_reference || monitor.clientReference,
          phone: order.phone || monitor.phone,
          status: nextStatus,
          stageLabel: order.stageLabel || monitor.stageLabel,
          updatedAt: order.updated_at || monitor.updatedAt || new Date().toISOString(),
          monitorDisabled: false,
          errorHint: PAYMENT_FAILURE_STATUSES.has(nextStatus) ? monitor.errorHint : "",
          lastNotifiedStatus: monitor.lastNotifiedStatus || previousStatus,
          allowRetryAfterStatusCheck: PAYMENT_SUCCESS_STATUSES.has(nextStatus)
            ? false
            : monitor.allowRetryAfterStatusCheck,
          lastStatusCheckPaid: PAYMENT_SUCCESS_STATUSES.has(nextStatus)
            ? true
            : monitor.lastStatusCheckPaid ?? null,
        };
        paymentMonitors.set(updatedMonitor.orderId, updatedMonitor);
        notifyMonitorStatusTransition({
          previousStatus,
          nextStatus,
          monitor: updatedMonitor,
        });
      } catch (error) {
        const fallbackMonitor = {
          ...monitor,
          errorHint: `Auto-refresh paused: ${error.message}`,
        };
        if (error?.status === 401 || error?.status === 403) {
          fallbackMonitor.monitorDisabled = true;
          fallbackMonitor.errorHint = "No permission for live refresh (orders.view).";
          if (!monitorPermissionWarningShown) {
            monitorPermissionWarningShown = true;
            setActionFeedback("Live payment refresh requires orders.view permission.", "error");
          }
        }
        paymentMonitors.set(fallbackMonitor.orderId, fallbackMonitor);
      }
    }
  } finally {
    persistPaymentMonitors();
    renderPaymentMonitors();
    updatePaymentMonitorLoopState();
    paymentMonitorRefreshInFlight = false;
  }
}

function trackMomoPromptOrder(order) {
  if (!order || !isMomoOrder(order)) return;
  const prompt = order.paymentPrompt || {};
  upsertPaymentMonitor({
    orderId: order.id,
    orderNumber: order.order_number,
    clientReference: prompt.clientReference || order.client_reference || "",
    paymentChannel: resolveMonitorPaymentChannel(prompt.channel) || getDefaultRetryChannel(),
    phone: order.phone || "",
    status: order.status || "PENDING_PAYMENT",
    stageLabel: order.stageLabel || "Awaiting payment",
    updatedAt: order.updated_at || new Date().toISOString(),
    watchedAt: new Date().toISOString(),
    lastNotifiedStatus: order.status || "PENDING_PAYMENT",
    monitorDisabled: false,
    errorHint: "",
  });
  refreshPaymentMonitors().catch(() => {
    // best-effort immediate refresh after prompt creation
  });
}

function getActiveItems() {
  return allMenuItems.filter((item) => item.isActive);
}

function setDeliveryType(type) {
  document.getElementById("deliveryType").value = type;
  const pickupBtn = document.getElementById("pickupBtn");
  const deliveryBtn = document.getElementById("deliveryBtn");
  const addressWrap = document.getElementById("addressWrap");

  if (type === "pickup") {
    pickupBtn.classList.add("primary");
    deliveryBtn.classList.remove("primary");
    pickupBtn.setAttribute("aria-pressed", "true");
    deliveryBtn.setAttribute("aria-pressed", "false");
    addressWrap.style.display = "none";
  } else {
    deliveryBtn.classList.add("primary");
    pickupBtn.classList.remove("primary");
    deliveryBtn.setAttribute("aria-pressed", "true");
    pickupBtn.setAttribute("aria-pressed", "false");
    addressWrap.style.display = "block";
  }
}

function setPaymentMethod(method) {
  const wrap = document.getElementById("momoChannelWrap");
  wrap.style.display = method === "momo" ? "block" : "none";
  if (method !== "momo") {
    clearVerificationState();
  }
  updateActionButtonState();
}

function setActionFeedback(message, kind = "helper") {
  const element = document.getElementById("actionFeedback");
  if (!element) return;
  element.className = `inline-feedback ${kind}`;
  element.textContent = message;
}

function isNetworkLikeFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    !error?.status ||
    error?.status === 0 ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("timeout") ||
    message.includes("aborted")
  );
}

function toHumanInstoreError(error) {
  const message = String(error?.message || "Request failed");
  const lower = message.toLowerCase();
  if (error?.status === 403 && (lower.includes("hubtel") || lower.includes("verification"))) {
    return "MoMo verification blocked (403). Hubtel needs this server public IP whitelisted.";
  }
  if (error?.status === 403) {
    return "Access denied by upstream provider (403). Confirm API credentials and whitelist.";
  }
  return message;
}

function clearVerificationState() {
  momoVerification = null;
  const banner = document.getElementById("verifiedCustomerBanner");
  if (banner) {
    banner.style.display = "none";
    banner.textContent = "";
    banner.className = "inline-verify helper";
  }
}

function showVerificationState(verification) {
  const e = AdminCore.escapeHtml;
  const banner = document.getElementById("verifiedCustomerBanner");
  if (!banner) return;
  banner.style.display = "block";
  banner.className = "inline-verify success";
  banner.innerHTML = `Wallet: <strong>${e(verification.verifiedName || "-")}</strong>`;
}

function updateActionButtonState() {
  const paymentMethod = document.getElementById("paymentMethod").value;
  const button = document.getElementById("checkoutActionBtn");
  if (!button) return;

  if (paymentMethod === "cash") {
    button.textContent = "Create Order";
    return;
  }

  if (momoVerification?.checked) {
    button.textContent = "Take Payment";
    return;
  }

  button.textContent = "Verify Wallet";
}

function updateInstoreMenuSummary(visibleItems = null) {
  const activeItems = getActiveItems();
  const categories = [...new Set(activeItems.map((item) => item.category))];
  const visible = Array.isArray(visibleItems) ? visibleItems : getFilteredItems();
  const query = document.getElementById("menuSearch").value.trim();

  const activeCountEl = document.getElementById("menuActiveCount");
  if (activeCountEl) activeCountEl.textContent = String(activeItems.length);

  const categoryCountEl = document.getElementById("menuCategoryCount");
  if (categoryCountEl) categoryCountEl.textContent = String(categories.length);

  const visibleCountEl = document.getElementById("menuVisibleCount");
  if (visibleCountEl) visibleCountEl.textContent = String(visible.length);

  const categoryHintEl = document.getElementById("selectedCategoryHint");
  if (categoryHintEl) {
    const categoryLabel = selectedCategory === "__all__" ? "All categories" : selectedCategory;
    categoryHintEl.textContent = query ? `${categoryLabel} | "${query}"` : categoryLabel;
  }
}

function renderCategoryButtons() {
  const categories = [...new Set(getActiveItems().map((item) => item.category))].sort();
  if (selectedCategory !== "__all__" && !categories.includes(selectedCategory)) {
    selectedCategory = "__all__";
  }
  const container = document.getElementById("categoryButtons");
  container.innerHTML = "";
  if (!categories.length) {
    container.innerHTML = '<div class="order-meta">No active categories.</div>';
    updateInstoreMenuSummary([]);
    return;
  }

  const options = [{ value: "__all__", label: "All" }].concat(
    categories.map((category) => ({ value: category, label: category })),
  );
  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-chip ${selectedCategory === option.value ? "active" : ""}`;
    btn.textContent = option.label;
    btn.addEventListener("click", () => {
      selectedCategory = option.value;
      menuPage = 1;
      renderCategoryButtons();
      renderMenuGrid();
    });
    container.appendChild(btn);
  });
  updateInstoreMenuSummary();
}

function addToCart(item) {
  const existing = cart.get(item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.set(item.id, {
      itemId: item.id,
      name: item.name,
      category: item.category,
      priceCedis: Number(item.priceCedis),
      quantity: 1,
    });
  }
  renderCart();
}

function removeFromCart(itemId) {
  cart.delete(itemId);
  renderCart();
}

function adjustQuantity(itemId, delta) {
  const entry = cart.get(itemId);
  if (!entry) return;
  const next = entry.quantity + delta;
  if (next <= 0) {
    cart.delete(itemId);
  } else {
    entry.quantity = next;
  }
  renderCart();
  updateActionButtonState();
}

function getFilteredItems() {
  const query = document.getElementById("menuSearch").value.trim().toLowerCase();
  return getActiveItems()
    .filter((item) => {
      const matchesCategory =
        selectedCategory === "__all__" || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;
      const haystack = `${item.name} ${item.category}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => {
      const catDiff = String(left.category).localeCompare(String(right.category));
      if (catDiff !== 0) return catDiff;
      return String(left.name).localeCompare(String(right.name));
    });
}

function renderMenuPager(totalItems, shownItems) {
  const pageLabel = document.getElementById("menuPageLabel");
  const rangeLabel = document.getElementById("menuRangeLabel");
  const prevBtn = document.getElementById("menuPrevBtn");
  const nextBtn = document.getElementById("menuNextBtn");
  const totalPages = Math.max(1, Math.ceil(totalItems / MENU_PAGE_SIZE));
  if (menuPage > totalPages) {
    menuPage = totalPages;
  }
  const startIndex = totalItems ? (menuPage - 1) * MENU_PAGE_SIZE + 1 : 0;
  const endIndex = totalItems ? startIndex + shownItems - 1 : 0;

  if (pageLabel) {
    pageLabel.textContent = totalItems ? `Page ${menuPage}/${totalPages}` : "Page 0/0";
  }
  if (rangeLabel) {
    rangeLabel.textContent = totalItems
      ? `Items ${startIndex}-${endIndex} of ${totalItems}`
      : "Items 0-0 of 0";
  }
  if (prevBtn) prevBtn.disabled = menuPage <= 1;
  if (nextBtn) nextBtn.disabled = menuPage >= totalPages;
}

function renderMenuGrid() {
  const e = AdminCore.escapeHtml;
  const container = document.getElementById("menuGrid");
  const filteredItems = getFilteredItems();
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / MENU_PAGE_SIZE));
  if (menuPage > totalPages) menuPage = totalPages;
  const start = (menuPage - 1) * MENU_PAGE_SIZE;
  const items = filteredItems.slice(start, start + MENU_PAGE_SIZE);
  container.innerHTML = "";
  renderMenuPager(filteredItems.length, items.length);

  if (!filteredItems.length) {
    container.innerHTML = '<div class="menu-grid-empty">No active items in this filter.</div>';
    updateInstoreMenuSummary(filteredItems);
    return;
  }

  const categoryMap = [...new Set(filteredItems.map((item) => item.category))];

  items.forEach((item) => {
    const colorClass =
      CATEGORY_COLORS[categoryMap.indexOf(item.category) % CATEGORY_COLORS.length];
    const cartQty = cart.get(item.id)?.quantity || 0;
    const card = document.createElement("article");
    card.className = `menu-card color-${colorClass}`;
    card.innerHTML = `
      <div class="title">${e(item.name)}</div>
      <div class="cat">${e(item.category)}</div>
      <div><strong>GHS ${AdminCore.money(item.priceCedis)}</strong></div>
      <div class="menu-card-qty ${cartQty > 0 ? "filled" : "empty"}">${
        cartQty > 0 ? `In Cart: ${cartQty}` : "In Cart: 0"
      }</div>
      <button class="btn primary" data-role="add">Add to Cart</button>
    `;

    card.querySelector('[data-role="add"]').addEventListener("click", () => addToCart(item));
    container.appendChild(card);
  });
  updateInstoreMenuSummary(filteredItems);
}

function calculateCartTotal() {
  let total = 0;
  cart.forEach((entry) => {
    total += entry.priceCedis * entry.quantity;
  });
  return total;
}

function renderCart() {
  const e = AdminCore.escapeHtml;
  const list = document.getElementById("cartList");
  list.innerHTML = "";

  const entries = [...cart.values()];
  const totalUnits = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const lineCountEl = document.getElementById("cartLineCount");
  if (lineCountEl) lineCountEl.textContent = String(entries.length);
  const qtyCountEl = document.getElementById("cartQtyCount");
  if (qtyCountEl) qtyCountEl.textContent = String(totalUnits);

  if (!entries.length) {
    list.innerHTML = '<div class="order-meta">Cart is empty.</div>';
  }

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const lineTotal = entry.priceCedis * entry.quantity;
    row.innerHTML = `
      <div class="cart-item-main">
        <div class="cart-item-name">${e(entry.name)}</div>
        <div class="cart-item-meta">${e(entry.category)} | GHS ${AdminCore.money(entry.priceCedis)} each</div>
      </div>
      <div class="cart-item-side">
        <div class="cart-item-line-total">GHS ${AdminCore.money(lineTotal)}</div>
        <div class="controls">
          <button type="button" class="btn cart-btn cart-btn-minus" data-role="minus">-</button>
          <span>${entry.quantity}</span>
          <button type="button" class="btn cart-btn cart-btn-plus" data-role="plus">+</button>
          <button type="button" class="btn cart-btn cart-btn-remove" data-role="remove">x</button>
        </div>
      </div>
    `;

    row.querySelector('[data-role="minus"]').addEventListener("click", () => adjustQuantity(entry.itemId, -1));
    row.querySelector('[data-role="plus"]').addEventListener("click", () => adjustQuantity(entry.itemId, 1));
    row.querySelector('[data-role="remove"]').addEventListener("click", () => removeFromCart(entry.itemId));
    list.appendChild(row);
  });

  const totalLabel = `GHS ${AdminCore.money(calculateCartTotal())}`;
  document.getElementById("cartTotal").textContent = totalLabel;
  const inlineTotalEl = document.getElementById("cartTotalInline");
  if (inlineTotalEl) inlineTotalEl.textContent = totalLabel;
  renderMenuGrid();
}

async function loadMenu() {
  const payload = await AdminCore.api("/api/admin/menu");
  allMenuItems = payload.data || [];
  menuPage = 1;
  renderCategoryButtons();
  renderMenuGrid();
}

function buildPayload() {
  const deliveryType = document.getElementById("deliveryType").value;
  const paymentMethod = document.getElementById("paymentMethod").value;
  const address = document.getElementById("deliveryAddress").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();

  const clientReference = `instore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    clientReference,
    fullName: document.getElementById("customerName").value.trim(),
    phone,
    deliveryType,
    address: deliveryType === "delivery" ? address : undefined,
    paymentMethod,
    paymentChannel:
      paymentMethod === "momo" ? document.getElementById("paymentChannel").value : undefined,
    items: [...cart.values()].map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity })),
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary);
}

function base64ToBytes(text) {
  const binary = window.atob(String(text || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getOrCreateQueueKeyMaterial() {
  let raw = localStorage.getItem(OFFLINE_QUEUE_CRYPTO_KEY);
  if (raw) return raw;
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  raw = bytesToBase64(bytes);
  localStorage.setItem(OFFLINE_QUEUE_CRYPTO_KEY, raw);
  return raw;
}

async function getOfflineQueueCryptoKey() {
  const material = base64ToBytes(getOrCreateQueueKeyMaterial());
  return window.crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptOfflineQueue(queue) {
  const key = await getOfflineQueueCryptoKey();
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);
  const payload = new TextEncoder().encode(JSON.stringify(queue || []));
  const cipher = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    payload,
  );
  return {
    encrypted: true,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

async function decryptOfflineQueue(blob) {
  const key = await getOfflineQueueCryptoKey();
  const iv = base64ToBytes(blob?.iv || "");
  const data = base64ToBytes(blob?.data || "");
  const plain = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  const decoded = new TextDecoder().decode(plain);
  const parsed = JSON.parse(decoded);
  return Array.isArray(parsed) ? parsed : [];
}

async function readOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed?.encrypted) {
      return await decryptOfflineQueue(parsed);
    }
    return [];
  } catch (_) {
    return [];
  }
}

async function writeOfflineQueue(queue) {
  const encryptedPayload = await encryptOfflineQueue(queue || []);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(encryptedPayload));
  const countEl = document.getElementById("offlineQueueCount");
  if (countEl) countEl.textContent = String((queue || []).length);
}

async function enqueueOfflineOrder(payload, reason = "network_error") {
  const queue = await readOfflineQueue();
  queue.push({
    id: payload.clientReference,
    payload,
    reason,
    queuedAt: new Date().toISOString(),
  });
  await writeOfflineQueue(queue);
}

async function syncOfflineQueue() {
  const queue = await readOfflineQueue();
  if (!queue.length) {
    AdminLayout.setStatus("No queued offline orders.", "helper");
    return;
  }

  const remaining = [];
  let synced = 0;
  for (const item of queue) {
    try {
      await AdminCore.api("/api/admin/orders/instore", {
        method: "POST",
        body: JSON.stringify(item.payload),
      });
      synced += 1;
    } catch (error) {
      remaining.push(item);
      if (error?.status && error.status < 500) {
        AdminLayout.setStatus(`Queue item failed validation: ${error.message}`, "error");
      }
    }
  }

  await writeOfflineQueue(remaining);
  if (synced > 0) {
    await AdminLayout.notifyAction(`${synced} queued order(s) synced successfully.`, {
      title: "Offline Queue Synced",
    });
  }
}

function resetCheckoutForm() {
  document.getElementById("customerName").value = "";
  document.getElementById("customerPhone").value = "";
  document.getElementById("deliveryAddress").value = "";
  document.getElementById("paymentMethod").value = "cash";
  document.getElementById("paymentChannel").value = "mtn-gh";
  setDeliveryType("pickup");
  setPaymentMethod("cash");
  clearVerificationState();
  const latestPending = getSortedMonitors().find((monitor) => monitor.status === "PENDING_PAYMENT");
  if (latestPending) {
    setActionFeedback(`Pending prompt: ${latestPending.orderNumber}.`, "warn");
  } else {
    setActionFeedback("Ready.", "helper");
  }
}

function renderCustomerSuggestions(customers) {
  const datalist = document.getElementById("customerPhoneSuggestions");
  if (!datalist) return;
  datalist.innerHTML = "";
  customerSuggestionMap = new Map();
  customers.forEach((customer) => {
    const option = document.createElement("option");
    option.value = customer.phone;
    option.label = `${customer.fullName} (${customer.phone})`;
    datalist.appendChild(option);
    customerSuggestionMap.set(customer.phone, customer);
  });
}

async function searchCustomersByPhone(phonePrefix) {
  if (!phonePrefix || phonePrefix.length < 3) {
    renderCustomerSuggestions([]);
    return;
  }
  const payload = await AdminCore.api(
    `/api/admin/customers/search?phone=${encodeURIComponent(phonePrefix)}&limit=8`,
  );
  renderCustomerSuggestions(payload.data || []);
}

function applySuggestedCustomerFromPhone(phone) {
  const customer = customerSuggestionMap.get(phone);
  if (!customer) return;
  const customerName = document.getElementById("customerName");
  if (!customerName.value.trim()) {
    customerName.value = customer.fullName || "";
  }
}

function getVerificationInput() {
  return {
    fullName: document.getElementById("customerName").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
    paymentChannel: document.getElementById("paymentChannel").value,
  };
}

function hasVerificationInputChanged() {
  if (!momoVerification?.checked) return true;
  const input = getVerificationInput();
  return !(
    input.phone === momoVerification.phone &&
    input.paymentChannel === momoVerification.paymentChannel
  );
}

async function verifyCustomerForMomo() {
  const input = getVerificationInput();
  if (!input.phone) {
    throw new Error("Customer phone is required for verification.");
  }

  const response = await AdminCore.api("/api/admin/payments/verify-customer", {
    method: "POST",
    body: JSON.stringify(input),
  });

  momoVerification = {
    checked: true,
    verifiedName: response.data?.verifiedName || "",
    phone: input.phone,
    paymentChannel: input.paymentChannel,
  };
  showVerificationState(momoVerification);
  const verifiedNameLabel = momoVerification.verifiedName || "registered wallet";
  setActionFeedback("Verification passed. Tap Take Payment.", "success");
  await AdminLayout.notifyAction(
    `Wallet verified as ${verifiedNameLabel}. Customer and payer names can differ.`,
    { title: "Verification Passed" },
  );
  updateActionButtonState();
}

function renderResult(order) {
  const result = document.getElementById("instoreResult");
  const prompt = order.paymentPrompt;
  if (prompt && isMomoOrder(order)) {
    result.className = "instore-result";
    result.textContent = `${order.order_number || "Order"} awaiting PIN confirmation.`;
    return;
  }

  result.className = "instore-result";
  result.textContent = `Order ${order.order_number || "-"} created (${order.status || "-"})`;
}

(async function initInstoreUi() {
  await AdminLayout.initProtectedPage();
  AdminLayout.setStatus("Ready.", "helper");

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = backBtn.dataset.fallback;
    });
  }

  document.getElementById("pickupBtn").addEventListener("click", () => setDeliveryType("pickup"));
  document.getElementById("deliveryBtn").addEventListener("click", () => setDeliveryType("delivery"));
  setDeliveryType("pickup");

  const paymentMethod = document.getElementById("paymentMethod");
  paymentMethod.addEventListener("change", () => setPaymentMethod(paymentMethod.value));
  setPaymentMethod(paymentMethod.value);

  const clearPaidMonitorsBtn = document.getElementById("clearPaidMonitorsBtn");
  if (clearPaidMonitorsBtn) {
    clearPaidMonitorsBtn.addEventListener("click", removeCompletedMonitors);
  }
  hydratePaymentMonitors();
  const paymentMonitorList = document.getElementById("paymentMonitorList");
  if (paymentMonitorList) {
    paymentMonitorList.addEventListener("click", (event) => {
      const statusCheckTrigger = event.target.closest('[data-role="status-check-monitor"]');
      if (statusCheckTrigger) {
        const orderId = String(statusCheckTrigger.getAttribute("data-order-id") || "").trim();
        if (!orderId) return;
        runStatusCheckForMonitor(orderId).catch((error) => {
          setActionFeedback(`Status check failed: ${toHumanInstoreError(error)}`, "error");
        });
        return;
      }

      const retryTrigger = event.target.closest('[data-role="retry-monitor"]');
      if (!retryTrigger) return;
      const orderId = String(retryTrigger.getAttribute("data-order-id") || "").trim();
      if (!orderId) return;
      retryMomoPromptForMonitor(orderId).catch((error) => {
        setActionFeedback(`Regenerate failed: ${toHumanInstoreError(error)}`, "error");
      });
    });
  }

  document.getElementById("customerPhone").addEventListener("input", () => {
    clearVerificationState();
    updateActionButtonState();
    const phone = document.getElementById("customerPhone").value.trim();
    clearTimeout(customerSearchTimer);
    customerSearchTimer = setTimeout(() => {
      searchCustomersByPhone(phone).catch(() => {
        // non-blocking suggestions
      });
    }, 180);
  });
  document.getElementById("customerPhone").addEventListener("change", () => {
    applySuggestedCustomerFromPhone(document.getElementById("customerPhone").value.trim());
  });
  document.getElementById("customerPhone").addEventListener("blur", () => {
    applySuggestedCustomerFromPhone(document.getElementById("customerPhone").value.trim());
  });
  document.getElementById("paymentChannel").addEventListener("change", () => {
    clearVerificationState();
    updateActionButtonState();
  });

  document.getElementById("menuSearch").addEventListener("input", () => {
    menuPage = 1;
    renderMenuGrid();
  });
  document.getElementById("reloadMenuBtn").addEventListener("click", async () => {
    try {
      await loadMenu();
      AdminLayout.setStatus("Menu reloaded.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });
  const menuPrevBtn = document.getElementById("menuPrevBtn");
  if (menuPrevBtn) {
    menuPrevBtn.addEventListener("click", () => {
      menuPage = Math.max(1, menuPage - 1);
      renderMenuGrid();
    });
  }
  const menuNextBtn = document.getElementById("menuNextBtn");
  if (menuNextBtn) {
    menuNextBtn.addEventListener("click", () => {
      menuPage += 1;
      renderMenuGrid();
    });
  }
  document.getElementById("checkoutForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!cart.size) {
      AdminLayout.setStatus("Add at least one item to cart.", "error");
      return;
    }

    const payload = buildPayload();
    if (!payload.fullName) {
      setActionFeedback("Customer name is required.", "error");
      return;
    }
    if (payload.deliveryType === "delivery" && !payload.address) {
      AdminLayout.setStatus("Delivery address is required for delivery orders.", "error");
      return;
    }
    if (!payload.phone) {
      setActionFeedback("Customer phone is required.", "error");
      return;
    }
    try {
      if (payload.paymentMethod === "momo") {
        if (hasVerificationInputChanged()) {
          clearVerificationState();
          updateActionButtonState();
        }

        if (!momoVerification?.checked) {
          const confirmedVerify = await AdminLayout.confirmAction(
            `Verify customer wallet for ${payload.phone}?`,
            { title: "Confirm Verification" },
          );
          if (!confirmedVerify) return;
          await verifyCustomerForMomo();
          return;
        }
      }

      const actionLabel = payload.paymentMethod === "momo" ? "Take payment prompt" : "Create cash order";
      const confirmedApply = await AdminLayout.confirmAction(
        `${actionLabel} for ${payload.fullName} (${payload.phone})?`,
        { title: "Confirm In-Store Update", confirmLabel: "Apply" },
      );
      if (!confirmedApply) return;

      const response = await AdminCore.api("/api/admin/orders/instore", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const order = response.data;
      if (isMomoOrder(order, payload.paymentMethod)) {
        trackMomoPromptOrder(order);
      }
      renderResult(order);
      cart.clear();
      renderCart();
      resetCheckoutForm();

      if (isMomoOrder(order, payload.paymentMethod)) {
        setActionFeedback(
          `Prompt sent: ${order.order_number}.`,
          "success",
        );
        await AdminLayout.notifyAction(
          `Payment prompt sent for ${order.order_number}. Live monitor will auto-update payment status.`,
          { title: "Payment Prompt Sent" },
        );
        clearVerificationState();
        updateActionButtonState();
      } else {
        setActionFeedback(`Cash order ${order.order_number} moved to kitchen queue.`, "success");
        await AdminLayout.notifyAction(
          `Cash order ${order.order_number} created and moved to kitchen queue.`,
          { title: "Order Created" },
        );
      }
    } catch (error) {
      if (error?.status === 503) {
        // Business-state error (e.g., store closed) should not be queued as offline.
        setActionFeedback(toHumanInstoreError(error) || "Store is currently closed for new orders.", "error");
        return;
      }

      const shouldQueue = !navigator.onLine || isNetworkLikeFailure(error);
      if (shouldQueue) {
        await enqueueOfflineOrder(payload, error.message || "network_failure");
        setActionFeedback("Network issue detected. Order queued for sync.", "error");
        await AdminLayout.notifyAction(
          "Order queued offline. Use Sync Queued Orders when connectivity is restored.",
          { title: "Queued Offline" },
        );
        cart.clear();
        renderCart();
        resetCheckoutForm();
        return;
      }
      setActionFeedback(toHumanInstoreError(error), "error");
    }
  });

  document.getElementById("syncOfflineQueueBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Sync all queued offline orders now?",
        { title: "Confirm Queue Sync", confirmLabel: "Sync" },
      );
      if (!confirmed) return;
      await syncOfflineQueue();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  window.addEventListener("online", () => {
    syncOfflineQueue().catch(() => {
      // best effort auto sync
    });
    refreshPaymentMonitors().catch(() => {
      // best effort monitor refresh on reconnect
    });
  });

  await loadMenu();
  const initialQueue = await readOfflineQueue();
  await writeOfflineQueue(initialQueue);
  if (navigator.onLine && initialQueue.length > 0) {
    syncOfflineQueue().catch(() => {
      // best-effort auto sync on page init
    });
  }
  if (navigator.onLine) {
    refreshPaymentMonitors().catch(() => {
      // best-effort monitor refresh on page init
    });
  }
  renderCart();
  updateActionButtonState();
})();
