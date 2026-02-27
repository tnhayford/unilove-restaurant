const crypto = require("crypto");
const { uuidv4 } = require("../utils/uuid");
const { runInWriteTransaction } = require("../db/connection");
const env = require("../config/env");
const { findMenuItemsByIds } = require("../repositories/menuRepository");
const { upsertCustomer } = require("../repositories/customerRepository");
const {
  createOrder,
  createOrderItems,
  getOrderById,
  getOrderByClientReference,
  getOrderByOrderNumber,
  listOrders,
  listOutForDeliveryOrders,
  listOrderHistory,
  getOrderItems,
  updateOrderStatus,
  setPaymentStatus,
  setAssignedRider,
  setOpsMonitoredAt,
} = require("../repositories/orderRepository");
const { getSetting } = require("../repositories/systemSettingsRepository");
const {
  insertPendingPayment,
  getPaymentByClientReference,
  hasPaidPromptAttempt,
  insertPromptAttempt,
  setLatestPromptTransaction,
} = require("../repositories/paymentRepository");
const { ORDER_STATUS, canTransition } = require("../utils/orderStatus");
const { logSensitiveAction } = require("./auditService");
const {
  revokeLoyaltyForOrder,
  issueLoyaltyForPaidOrder,
  getCustomerLoyaltyBalance,
} = require("./loyaltyService");
const { sendSms } = require("./smsService");
const { generateAndStoreReceipt } = require("./receiptService");
const { requestInStoreMomoPrompt } = require("./receiveMoneyService");
const { canIssueRefund } = require("./orderPolicyService");
const { ensureStoreOpenForOrdering } = require("./storeStatusService");
const { notifyRiderDispatchUpdate } = require("./riderPushService");
const { getSlaConfig } = require("./slaService");
const { shouldSendCustomerSms } = require("./operationsPolicyService");
const { assignDeliveryOrdersByWorkload } = require("./riderAssignmentService");
const { listRiderRoster, listActiveAssignableRiders } = require("./riderPresenceService");
const { publishOrderEvent } = require("./realtimeEventService");

const ORDER_ACTION = {
  START_PROCESSING: "START_PROCESSING",
  MARK_READY_PICKUP: "MARK_READY_PICKUP",
  DISPATCH_ORDER: "DISPATCH_ORDER",
  COMPLETE_PICKUP: "COMPLETE_PICKUP",
  MARK_RETURNED: "MARK_RETURNED",
  ISSUE_REFUND: "ISSUE_REFUND",
  CANCEL_ORDER: "CANCEL_ORDER",
};

const PAYMENT_METHOD = {
  MOMO: "momo",
  CASH: "cash",
  CASH_ON_DELIVERY: "cash_on_delivery",
};

const PAYMENT_STATUS = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
};

const TRACKING_TOKEN_LENGTH = 24;
const DEFAULT_SLA_CONFIG = Object.freeze({
  pendingPaymentMinutes: 10,
  kitchenMinutes: 25,
  deliveryMinutes: 45,
});
const GUEST_COMMISSION_SETTING_KEY = "rider_guest_commission_percent";
const DEFAULT_GUEST_COMMISSION_RATE_PERCENT = 8;
const INSTORE_PENDING_RETRY_COOLDOWN_MS = 60000;
const INSTORE_PAID_OR_PROGRESS_STATUSES = new Set([
  ORDER_STATUS.PAID,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.RETURNED,
  ORDER_STATUS.REFUNDED,
]);
const STATUS_CHECK_PAID_TOKENS = new Set([
  "paid",
  "success",
  "successful",
  "completed",
  "fulfilled",
]);
const STATUS_CHECK_FAILED_TOKENS = new Set([
  "failed",
  "fail",
  "rejected",
  "declined",
  "canceled",
  "cancelled",
  "abandoned",
  "expired",
  "timeout",
  "timed_out",
]);
const STATUS_CHECK_PENDING_TOKENS = new Set([
  "pending",
  "processing",
  "in_progress",
  "unpaid",
  "awaiting_pin",
  "awaiting_payment",
]);
const STATUS_CHECK_FAILED_HINT_PATTERN = /(failed|declined|rejected|cancelled|canceled|expired|timeout|timed\s*out|abandoned)/i;
const PAYMENT_FAILURE_HINTS = [
  {
    pattern: /(insufficient|balance\s*limit|counter\s*limit|missing\s*permissions|low\s*balance)/i,
    message: "Customer wallet likely has insufficient balance or wallet limit restrictions.",
  },
  {
    pattern: /(not\s*registered|wallet\s*not\s*registered)/i,
    message: "Wallet number is not registered on the selected network.",
  },
  {
    pattern: /(invalid\s*pin|wrong\s*pin|pin\s*entry|pin\s*failed|pin\s*cancel)/i,
    message: "Customer PIN entry failed or was canceled.",
  },
  {
    pattern: /(timeout|timed\s*out|expired|abandoned)/i,
    message: "Prompt timed out before confirmation.",
  },
];

function normalizePaymentMethod(input, options = {}) {
  const source = String(options.source || "").trim().toLowerCase();
  const deliveryType = String(options.deliveryType || "").trim().toLowerCase();
  const token = String(input || "").trim().toLowerCase();

  if (token === PAYMENT_METHOD.CASH_ON_DELIVERY || token === "cod") {
    return PAYMENT_METHOD.CASH_ON_DELIVERY;
  }
  if (token === PAYMENT_METHOD.CASH) {
    if (source === "instore") return PAYMENT_METHOD.CASH;
    if (deliveryType === "delivery") return PAYMENT_METHOD.CASH_ON_DELIVERY;
    return PAYMENT_METHOD.CASH;
  }
  return PAYMENT_METHOD.MOMO;
}

function initialPaymentStatusForMethod(paymentMethod) {
  if (paymentMethod === PAYMENT_METHOD.MOMO) return PAYMENT_STATUS.PENDING;
  if (paymentMethod === PAYMENT_METHOD.CASH_ON_DELIVERY) return PAYMENT_STATUS.PENDING;
  return PAYMENT_STATUS.PAID;
}

function initialOrderStatusForMethod(paymentMethod) {
  if (paymentMethod === PAYMENT_METHOD.MOMO) {
    return ORDER_STATUS.PENDING_PAYMENT;
  }
  return ORDER_STATUS.PAID;
}

function isCapturedPaymentMethod(paymentMethod) {
  return paymentMethod === PAYMENT_METHOD.MOMO || paymentMethod === PAYMENT_METHOD.CASH;
}

function paymentStatusLabel(paymentStatus) {
  switch (String(paymentStatus || "").trim().toUpperCase()) {
    case PAYMENT_STATUS.PAID:
      return "Paid";
    case PAYMENT_STATUS.FAILED:
      return "Failed";
    default:
      return "Pending";
  }
}

function normalizePaymentStatusCode(paymentStatus) {
  const token = String(paymentStatus || "").trim().toUpperCase();
  if (token === PAYMENT_STATUS.PAID) return PAYMENT_STATUS.PAID;
  if (token === PAYMENT_STATUS.FAILED) return PAYMENT_STATUS.FAILED;
  return PAYMENT_STATUS.PENDING;
}

function toLineItems(requestedItems, menuItems) {
  const menuMap = new Map(menuItems.map((item) => [item.id, item]));

  return requestedItems.map((requested) => {
    const menuItem = menuMap.get(requested.itemId);
    if (!menuItem) {
      throw Object.assign(new Error(`Invalid itemId: ${requested.itemId}`), {
        statusCode: 400,
      });
    }
    const quantity = Number(requested.quantity);
    const unitPrice = Number(menuItem.price_cedis);
    return {
      itemId: menuItem.id,
      itemName: menuItem.name,
      unitPrice,
      quantity,
      lineTotal: Number((unitPrice * quantity).toFixed(2)),
    };
  });
}

function getReadableStage(status) {
  switch (status) {
    case ORDER_STATUS.PENDING_PAYMENT:
      return "Awaiting payment";
    case ORDER_STATUS.PAID:
      return "Incoming order";
    case ORDER_STATUS.PREPARING:
      return "Kitchen processing";
    case ORDER_STATUS.READY_FOR_PICKUP:
      return "Ready for pickup";
    case ORDER_STATUS.OUT_FOR_DELIVERY:
      return "Dispatched";
    case ORDER_STATUS.DELIVERED:
      return "Completed";
    case ORDER_STATUS.RETURNED:
      return "Exception - returned";
    case ORDER_STATUS.REFUNDED:
      return "Refunded";
    case ORDER_STATUS.PAYMENT_FAILED:
      return "Payment failed";
    case ORDER_STATUS.CANCELED:
      return "Canceled";
    default:
      return status;
  }
}

function toRealtimeOrderEnvelope(order, context = null) {
  if (!order) return null;
  return {
    orderId: order.id || null,
    orderNumber: order.order_number || order.orderNumber || null,
    status: order.status || null,
    deliveryType: order.delivery_type || order.deliveryType || null,
    assignedRiderId: order.assigned_rider_id || order.assignedRiderId || null,
    opsMonitoredAt: order.ops_monitored_at || order.opsMonitoredAt || null,
    updatedAt: order.updated_at || order.updatedAt || new Date().toISOString(),
    context,
  };
}

function publishOrderRealtimeEvent(eventName, order, context = null) {
  const payload = toRealtimeOrderEnvelope(order, context);
  if (!payload) return;
  publishOrderEvent(eventName, payload);
}

function normalizeStatusCheckToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function statusTokenHasWord(statusToken, word) {
  return (
    statusToken === word ||
    statusToken.startsWith(`${word}_`) ||
    statusToken.endsWith(`_${word}`) ||
    statusToken.includes(`_${word}_`)
  );
}

function matchesStatusTokenWordSet(statusToken, words) {
  if (!statusToken) return false;
  for (const word of words) {
    if (statusTokenHasWord(statusToken, word)) {
      return true;
    }
  }
  return false;
}

function classifyStatusCheckResult(resultData) {
  const responseCode = String(resultData?.responseCode || resultData?.ResponseCode || "").trim();
  const dataNode = resultData?.data || resultData?.Data || {};
  const providerStatusRaw = String(
    dataNode?.status ||
    dataNode?.Status ||
    dataNode?.transactionStatus ||
    dataNode?.TransactionStatus ||
    dataNode?.paymentStatus ||
    dataNode?.PaymentStatus ||
    dataNode?.state ||
    dataNode?.State ||
    "",
  ).trim();
  const providerMessageRaw = String(
    dataNode?.description ||
    dataNode?.Description ||
    dataNode?.message ||
    dataNode?.Message ||
    resultData?.message ||
    resultData?.Message ||
    "",
  ).trim();
  const statusToken = normalizeStatusCheckToken(providerStatusRaw);

  if (matchesStatusTokenWordSet(statusToken, STATUS_CHECK_PAID_TOKENS)) {
    return {
      outcome: "paid",
      responseCode,
      providerStatus: providerStatusRaw,
      statusToken,
    };
  }

  if (matchesStatusTokenWordSet(statusToken, STATUS_CHECK_FAILED_TOKENS)) {
    return {
      outcome: "failed",
      responseCode,
      providerStatus: providerStatusRaw,
      statusToken,
    };
  }
  if (matchesStatusTokenWordSet(statusToken, STATUS_CHECK_PENDING_TOKENS)) {
    return {
      outcome: "pending",
      responseCode,
      providerStatus: providerStatusRaw,
      statusToken,
    };
  }
  if (responseCode && responseCode !== "0000") {
    return {
      outcome: "failed",
      responseCode,
      providerStatus: providerStatusRaw,
      statusToken,
    };
  }
  if (!statusToken && STATUS_CHECK_FAILED_HINT_PATTERN.test(providerMessageRaw)) {
    return {
      outcome: "failed",
      responseCode,
      providerStatus: providerStatusRaw,
      statusToken,
    };
  }

  return {
    outcome: "pending",
    responseCode,
    providerStatus: providerStatusRaw,
    statusToken,
  };
}

function toStatusCheckCallbackPayload(resultData, clientReference, outcome) {
  const dataNode = resultData?.data || resultData?.Data || {};
  const providerCode = String(resultData?.responseCode || resultData?.ResponseCode || "").trim();
  const failureCode = providerCode && providerCode !== "0000" ? providerCode : "2001";

  return {
    ResponseCode: outcome === "paid" ? "0000" : failureCode,
    Meta: {
      source: "status_check",
    },
    Data: {
      ClientReference: dataNode?.clientReference || dataNode?.ClientReference || clientReference,
      TransactionId: dataNode?.transactionId || dataNode?.TransactionId || null,
      ExternalTransactionId: dataNode?.externalTransactionId || dataNode?.ExternalTransactionId || null,
      Amount: dataNode?.amount ?? dataNode?.Amount ?? null,
      Charges: dataNode?.charges ?? dataNode?.Charges ?? null,
      AmountAfterCharges: dataNode?.amountAfterCharges ?? dataNode?.AmountAfterCharges ?? null,
      AmountCharged: dataNode?.amountCharged ?? dataNode?.AmountCharged ?? dataNode?.amount ?? dataNode?.Amount ?? null,
    },
  };
}

function extractStatusCheckProviderMessage(resultData) {
  const dataNode = resultData?.data || resultData?.Data || {};
  return String(
    dataNode?.description ||
    dataNode?.Description ||
    dataNode?.message ||
    dataNode?.Message ||
    resultData?.message ||
    resultData?.Message ||
    "",
  ).trim();
}

function parsePaymentFailureHintFromText(input) {
  const text = String(input || "").trim();
  if (!text) return "";

  for (const entry of PAYMENT_FAILURE_HINTS) {
    if (entry.pattern.test(text)) {
      return entry.message;
    }
  }
  return "";
}

function parsePaymentFailureHintFromRawPayload(rawPayload) {
  if (!rawPayload) return "";
  try {
    const parsed = typeof rawPayload === "string"
      ? JSON.parse(rawPayload)
      : rawPayload;
    const dataNode = parsed?.Data || parsed?.data || {};
    const providerText = [
      dataNode?.Description,
      dataNode?.description,
      parsed?.Message,
      parsed?.message,
    ].find((value) => String(value || "").trim());

    return parsePaymentFailureHintFromText(providerText || "");
  } catch (_error) {
    return "";
  }
}

async function persistInStorePromptTransaction({ order, paymentPrompt, adminId }) {
  const clientReference = String(
    order?.client_reference || order?.clientReference || "",
  ).trim();
  if (!order?.id || !clientReference || !paymentPrompt) return;

  const transactionId = String(
    paymentPrompt.transactionId || paymentPrompt?.raw?.Data?.TransactionId || "",
  ).trim();
  const externalTransactionId = String(
    paymentPrompt.externalTransactionId || paymentPrompt?.raw?.Data?.ExternalTransactionId || "",
  ).trim();
  const responseCode = String(
    paymentPrompt.responseCode || paymentPrompt?.raw?.ResponseCode || "",
  ).trim();

  if (!transactionId && !externalTransactionId && !responseCode) {
    return;
  }

  try {
    const promptChannel = String(
      paymentPrompt.channel || paymentPrompt?.raw?.Data?.Channel || "",
    ).trim().toLowerCase();
    await setLatestPromptTransaction({
      orderId: order.id,
      clientReference,
      hubtelTransactionId: transactionId || null,
      externalTransactionId: externalTransactionId || null,
      responseCode: responseCode || null,
    });

    await insertPromptAttempt({
      orderId: order.id,
      clientReference,
      paymentChannel: promptChannel || null,
      hubtelTransactionId: transactionId || null,
      externalTransactionId: externalTransactionId || null,
      responseCode: responseCode || null,
      status: "PENDING",
      source: "prompt",
      rawPayload: paymentPrompt.raw || null,
    });
  } catch (error) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_PROMPT_TRACKING_FAILED",
      entityType: "order",
      entityId: order.id,
      details: {
        message: error?.message || "Prompt transaction tracking failed",
      },
    });
  }
}

function parseDbTimestamp(input) {
  if (!input) return null;
  return new Date(`${input}Z`);
}

function getAgeMinutes(order) {
  const createdAt = parseDbTimestamp(order.created_at);
  if (!createdAt) return 0;
  const diffMs = Date.now() - createdAt.getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function isOperationallyDelayed(order) {
  const finalStates = new Set([
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.RETURNED,
    ORDER_STATUS.REFUNDED,
    ORDER_STATUS.CANCELED,
    ORDER_STATUS.PAYMENT_FAILED,
  ]);
  if (finalStates.has(order.status)) return false;
  return getAgeMinutes(order) > 30;
}

function isDeliveryTypeTransitionAllowed(order, nextStatus) {
  if (order.delivery_type === "pickup" && nextStatus === ORDER_STATUS.OUT_FOR_DELIVERY) {
    return false;
  }
  return true;
}

function shouldNotifyRiderDispatch(order, nextStatus) {
  if (!order || order.delivery_type !== "delivery") return false;
  return nextStatus === ORDER_STATUS.OUT_FOR_DELIVERY;
}

async function emitRiderDispatchAlert(order, nextStatus) {
  if (!shouldNotifyRiderDispatch(order, nextStatus)) return;

  let assignedRiderId = String(order.assigned_rider_id || "").trim() || null;

  try {
    const assignment = await assignDeliveryOrdersByWorkload({
      targetOrderId: order.id,
    });
    if (assignment?.targetOrderAssignedRiderId) {
      assignedRiderId = assignment.targetOrderAssignedRiderId;
    }
  } catch (error) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "RIDER_ASSIGNMENT_RECONCILE_FAILED",
      entityType: "order",
      entityId: order.id,
      details: {
        status: nextStatus,
        message: error?.message || "Unknown assignment failure",
      },
    });
  }

  try {
    await notifyRiderDispatchUpdate({
      orderId: order.id,
      orderNumber: order.order_number,
      status: nextStatus,
      riderId: assignedRiderId,
    });
  } catch (error) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "RIDER_PUSH_DISPATCH_ALERT_FAILED",
      entityType: "order",
      entityId: order.id,
      details: {
        status: nextStatus,
        riderId: assignedRiderId,
        message: error?.message || "Unknown push failure",
      },
    });
  }
}

async function ensureDispatchHasAssignableRider(order) {
  if (!order || order.delivery_type !== "delivery") return;
  const activeRiders = await listActiveAssignableRiders();
  if (activeRiders.length) return;
  throw Object.assign(
    new Error("No rider is currently online. Ask a rider to go online before dispatch."),
    { statusCode: 409 },
  );
}

async function ensureDeliveryOtpPrepared(orderId, orderSnapshot) {
  if (!orderSnapshot || orderSnapshot.delivery_type !== "delivery") return;

  const { generateDeliveryCode } = require("./deliveryService");
  const code = await generateDeliveryCode(orderId);
  const allowOtpSms = await shouldSendCustomerSms("delivery_otp");
  if (!allowOtpSms) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "DELIVERY_CODE_SMS_SKIPPED_POLICY",
      entityType: "order",
      entityId: orderId,
      details: { policy: "sms_delivery_otp_enabled=false" },
    });
    return;
  }

  try {
    await sendSms({
      orderId,
      toPhone: orderSnapshot.phone,
      message: `Unilove: Delivery code for order ${orderSnapshot.order_number} is ${code}. Share only at handover.`,
    });
  } catch (error) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "DELIVERY_CODE_SMS_FAILED",
      entityType: "order",
      entityId: orderId,
      details: { message: error?.message || "Unknown SMS failure" },
    });
  }
}

function sanitizeOrderNumber(input) {
  return String(input || "")
    .trim()
    .toUpperCase();
}

function isValidOrderNumber(input) {
  return /^R[0-9]{5,12}$/.test(String(input || ""));
}

function sanitizeTrackingToken(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
}

function normalizePhoneDigits(input) {
  return String(input || "").replace(/\D/g, "");
}

function maskPhoneForRiderQueue(input) {
  const digits = normalizePhoneDigits(input);
  if (!digits) return "";
  if (digits.length <= 4) return `****${digits}`;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function safeTokenCompare(leftToken, rightToken) {
  const left = Buffer.from(String(leftToken || ""), "utf8");
  const right = Buffer.from(String(rightToken || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeSlaConfig(config = {}) {
  const pendingPaymentMinutes = Number(config.pendingPaymentMinutes);
  const kitchenMinutes = Number(config.kitchenMinutes);
  const deliveryMinutes = Number(config.deliveryMinutes);
  return {
    pendingPaymentMinutes: Number.isFinite(pendingPaymentMinutes)
      ? Math.max(1, Math.round(pendingPaymentMinutes))
      : DEFAULT_SLA_CONFIG.pendingPaymentMinutes,
    kitchenMinutes: Number.isFinite(kitchenMinutes)
      ? Math.max(1, Math.round(kitchenMinutes))
      : DEFAULT_SLA_CONFIG.kitchenMinutes,
    deliveryMinutes: Number.isFinite(deliveryMinutes)
      ? Math.max(1, Math.round(deliveryMinutes))
      : DEFAULT_SLA_CONFIG.deliveryMinutes,
  };
}

function etaMinutesFromSla(deliveryType, slaConfig, options = {}) {
  const normalizedSla = normalizeSlaConfig(slaConfig);
  const includePendingPayment = Boolean(options.includePendingPayment);
  const isDelivery = String(deliveryType || "").toLowerCase() === "delivery";

  let total = normalizedSla.kitchenMinutes;
  if (isDelivery) {
    total += normalizedSla.deliveryMinutes;
  }
  if (includePendingPayment) {
    total += normalizedSla.pendingPaymentMinutes;
  }

  return total;
}

function formatEtaDuration(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return "soon";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function buildTrackingToken(order) {
  if (!order?.id || !order?.order_number) return "";
  const normalizedPhone = normalizePhoneDigits(order.phone);
  return crypto
    .createHash("sha256")
    .update(
      `${order.id}:${order.order_number}:${normalizedPhone}:${env.jwtSecret}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, TRACKING_TOKEN_LENGTH);
}

function buildTrackingUrl(order) {
  const baseUrl = String(env.publicBaseUrl || "").trim().replace(/\/+$/, "");
  const orderNumber = sanitizeOrderNumber(order?.order_number);
  const token = buildTrackingToken(order);
  return `${baseUrl}/track?order=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(token)}`;
}

function buildCreatedSmsMessage(order, slaConfig) {
  const paymentMethod = normalizePaymentMethod(order.payment_method, {
    source: order.source,
    deliveryType: order.delivery_type,
  });
  const trackingUrl = buildTrackingUrl(order);
  const includePendingPayment = paymentMethod === PAYMENT_METHOD.MOMO;
  const etaMinutes = etaMinutesFromSla(order.delivery_type, slaConfig, { includePendingPayment });
  const etaPrefix = `${
    String(order.delivery_type || "").toLowerCase() === "delivery" ? "Delivery" : "Pickup"
  } ETA ${formatEtaDuration(etaMinutes)}`;
  const etaText = includePendingPayment ? `${etaPrefix} after payment` : etaPrefix;

  if (paymentMethod === PAYMENT_METHOD.CASH_ON_DELIVERY) {
    return `Unilove: Order ${order.order_number} confirmed. Pay cash on delivery at handover. ${etaText}. Track: ${trackingUrl}`;
  }

  if (String(order.source || "").toLowerCase() === "ussd" && paymentMethod === PAYMENT_METHOD.MOMO) {
    return `Unilove: Order ${order.order_number} received. Complete MoMo prompt with PIN. ${etaText}. Track: ${trackingUrl}`;
  }

  return `Unilove: Order ${order.order_number} received. ${etaText}. Track: ${trackingUrl}`;
}

function hasValidTrackingToken(order, trackingToken) {
  const providedToken = sanitizeTrackingToken(trackingToken);
  if (providedToken.length !== TRACKING_TOKEN_LENGTH) return false;
  const expectedToken = buildTrackingToken(order);
  if (!providedToken || !expectedToken) return false;
  return safeTokenCompare(providedToken, expectedToken);
}

function isPhoneMatchForTracking(orderPhone, providedPhone) {
  const left = normalizePhoneDigits(orderPhone);
  const right = normalizePhoneDigits(providedPhone);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function normalizeTrackingLookupInput(input) {
  if (typeof input === "string") {
    return {
      orderNumber: input,
      trackingToken: "",
      customerPhone: "",
      allowPhoneMatch: false,
    };
  }
  return {
    orderNumber: input?.orderNumber || "",
    trackingToken: input?.trackingToken || "",
    customerPhone: input?.customerPhone || "",
    allowPhoneMatch: Boolean(input?.allowPhoneMatch),
  };
}

function toCommissionRatePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_GUEST_COMMISSION_RATE_PERCENT;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(2))));
}

function toCommissionCedis(amount, commissionRatePercent) {
  const safeAmount = Number(amount);
  const safeRate = Number(commissionRatePercent);
  if (!Number.isFinite(safeAmount) || !Number.isFinite(safeRate)) return 0;
  return Number(((safeAmount * safeRate) / 100).toFixed(2));
}

async function getGuestCommissionRatePercent() {
  const row = await getSetting(GUEST_COMMISSION_SETTING_KEY);
  return toCommissionRatePercent(row?.setting_value);
}

async function generateNextOrderNumber(db) {
  const row = await db.get(
    `SELECT order_number
     FROM orders
     WHERE order_number LIKE 'R%'
     ORDER BY CAST(SUBSTR(order_number, 2) AS INTEGER) DESC
     LIMIT 1`,
  );

  const current = row?.order_number ? Number(row.order_number.slice(1)) : 0;
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `R${String(next).padStart(5, "0")}`;
}

async function createOrderFromRequest(payload) {
  if (payload.clientReference) {
    const existingByReference = await getOrderByClientReference(payload.clientReference);
    if (existingByReference) {
      const existingItems = await getOrderItems(existingByReference.id);
      return {
        id: existingByReference.id,
        orderNumber: existingByReference.order_number,
        clientReference: existingByReference.client_reference,
        phone: existingByReference.phone,
        fullName: existingByReference.full_name,
        deliveryType: existingByReference.delivery_type,
        address: existingByReference.address || null,
        status: existingByReference.status,
        paymentMethod: existingByReference.payment_method || PAYMENT_METHOD.MOMO,
        paymentStatus: existingByReference.payment_status || PAYMENT_STATUS.PENDING,
        subtotalCedis: Number(existingByReference.subtotal_cedis || 0),
        items: existingItems.map((item) => ({
          itemId: item.item_id,
          itemName: item.item_name_snapshot,
          unitPrice: Number(item.unit_price_cedis || 0),
          quantity: Number(item.quantity || 0),
          lineTotal: Number(item.line_total_cedis || 0),
        })),
      };
    }
  }

  await ensureStoreOpenForOrdering();

  const uniqueItemIds = [...new Set(payload.items.map((item) => item.itemId))];
  const menuItems = await findMenuItemsByIds(uniqueItemIds);

  if (menuItems.length !== uniqueItemIds.length) {
    throw Object.assign(new Error("One or more menu items are invalid"), {
      statusCode: 400,
    });
  }

  const lineItems = toLineItems(payload.items, menuItems);
  const subtotal = Number(
    lineItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
  );

  const customerId = await upsertCustomer(payload.phone, payload.fullName);
  const orderId = uuidv4();
  const clientReference =
    payload.clientReference || uuidv4().replace(/-/g, "").slice(0, 30);
  const source = payload.source || "online";
  const paymentMethod = normalizePaymentMethod(payload.paymentMethod, {
    source,
    deliveryType: payload.deliveryType,
  });
  const paymentStatus = initialPaymentStatusForMethod(paymentMethod);
  const initialOrderStatus = initialOrderStatusForMethod(paymentMethod);

  await runInWriteTransaction(async (db) => {
    const orderNumber = await generateNextOrderNumber(db);

    await createOrder({
      id: orderId,
      customerId,
      phone: payload.phone,
      fullName: payload.fullName,
      deliveryType: payload.deliveryType,
      address: payload.address,
      status: initialOrderStatus,
      subtotal,
      hubtelSessionId: payload.hubtelSessionId || null,
      clientReference,
      orderNumber,
      source,
      paymentMethod,
      paymentStatus,
    }, db);

    await createOrderItems(orderId, lineItems, db);
    if (paymentMethod === PAYMENT_METHOD.MOMO) {
      await insertPendingPayment({
        orderId,
        clientReference,
        amount: subtotal,
      }, db);
    }
  });

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "ORDER_CREATED",
    entityType: "order",
    entityId: orderId,
    details: {
      deliveryType: payload.deliveryType,
      subtotal,
      itemCount: lineItems.length,
      paymentMethod,
      paymentStatus,
    },
  });

  if (initialOrderStatus === ORDER_STATUS.PAID && isCapturedPaymentMethod(paymentMethod)) {
    await setPaymentStatus(orderId, PAYMENT_STATUS.PAID, { markConfirmedAt: true });
    await issueLoyaltyForPaidOrder(orderId);
  }

  const createdOrder = await getOrderById(orderId);
  publishOrderRealtimeEvent("order.created", createdOrder, {
    source,
  });

  let slaConfig = DEFAULT_SLA_CONFIG;
  try {
    slaConfig = normalizeSlaConfig(await getSlaConfig());
  } catch (_error) {
    slaConfig = DEFAULT_SLA_CONFIG;
  }

  const allowTrackingSms = await shouldSendCustomerSms("order_tracking");
  if (allowTrackingSms) {
    try {
      await sendSms({
        orderId,
        toPhone: payload.phone,
        message: buildCreatedSmsMessage(createdOrder, slaConfig),
      });
    } catch (error) {
      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "ORDER_CREATED_SMS_FAILED",
        entityType: "order",
        entityId: orderId,
        details: { message: error.message || "Unknown SMS failure" },
      });
    }
  } else {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "ORDER_CREATED_SMS_SKIPPED_POLICY",
      entityType: "order",
      entityId: orderId,
      details: { policy: "sms_order_tracking_enabled=false" },
    });
  }

  return {
    id: orderId,
    orderNumber: createdOrder.order_number,
    clientReference,
    phone: payload.phone,
    fullName: payload.fullName,
    deliveryType: payload.deliveryType,
    address: payload.address || null,
    status: createdOrder.status,
    paymentMethod: createdOrder.payment_method || paymentMethod,
    paymentStatus: createdOrder.payment_status || paymentStatus,
    subtotalCedis: subtotal,
    items: lineItems,
  };
}

async function ensureOrder(orderId) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }
  return order;
}

async function changeOrderStatus({ orderId, nextStatus, actorType, actorId, details, cancelReason }) {
  const order = await ensureOrder(orderId);

  if (order.status === nextStatus) {
    return order;
  }

  if (!canTransition(order.status, nextStatus)) {
    throw Object.assign(
      new Error(`Invalid status transition: ${order.status} -> ${nextStatus}`),
      { statusCode: 400 },
    );
  }

  if (!isDeliveryTypeTransitionAllowed(order, nextStatus)) {
    throw Object.assign(
      new Error(
        `Invalid status for ${order.delivery_type} order: ${order.status} -> ${nextStatus}`,
      ),
      { statusCode: 400 },
    );
  }

  if (nextStatus === ORDER_STATUS.OUT_FOR_DELIVERY) {
    await ensureDispatchHasAssignableRider(order);
  }

  await updateOrderStatus(orderId, nextStatus, cancelReason);
  const paymentMethod = normalizePaymentMethod(order.payment_method, {
    source: order.source,
    deliveryType: order.delivery_type,
  });

  if (nextStatus === ORDER_STATUS.PAID) {
    if (isCapturedPaymentMethod(paymentMethod)) {
      await setPaymentStatus(orderId, PAYMENT_STATUS.PAID, { markConfirmedAt: true });
      await issueLoyaltyForPaidOrder(orderId);
    } else {
      await setPaymentStatus(orderId, PAYMENT_STATUS.PENDING);
    }
  }

  if (nextStatus === ORDER_STATUS.PAYMENT_FAILED) {
    await setPaymentStatus(orderId, PAYMENT_STATUS.FAILED);
  }

  if (nextStatus === ORDER_STATUS.RETURNED || nextStatus === ORDER_STATUS.REFUNDED) {
    await revokeLoyaltyForOrder(orderId, nextStatus);
  }

  if (nextStatus === ORDER_STATUS.DELIVERED && paymentMethod === PAYMENT_METHOD.CASH_ON_DELIVERY) {
    await setPaymentStatus(orderId, PAYMENT_STATUS.PAID, { markConfirmedAt: true });
    await logSensitiveAction({
      actorType: actorType || "system",
      actorId: actorId || null,
      action: "COD_CASH_COLLECTION_CONFIRMED",
      entityType: "order",
      entityId: orderId,
      details: {
        orderNumber: order.order_number,
        amount: Number(order.subtotal_cedis || 0),
        assignedRiderId: order.assigned_rider_id || null,
        source: order.source || null,
      },
    });
    await issueLoyaltyForPaidOrder(orderId);
  }

  if (nextStatus === ORDER_STATUS.DELIVERED) {
    let completionReceipt = null;
    try {
      completionReceipt = await generateAndStoreReceipt(orderId);
    } catch (error) {
      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "RECEIPT_GENERATION_FAILED",
        entityType: "order",
        entityId: orderId,
        details: { message: error.message, stage: "order_completed_sms" },
      });
    }
    const allowCompletionSms = await shouldSendCustomerSms("order_completion");
    if (allowCompletionSms) {
      const customerName = String(order.full_name || "Customer").trim() || "Customer";
      const pointsEarned = Math.max(0, Number(order.loyalty_points_issued || 0));
      const pointsLabel = `${pointsEarned} point${pointsEarned === 1 ? "" : "s"}`;
      const receiptText = completionReceipt?.absoluteUrl
        ? completionReceipt.absoluteUrl
        : "unavailable right now";
      await sendSms({
        orderId,
        toPhone: order.phone,
        message: `Hello ${customerName}, your ${order.order_number} has been completed. You earned ${pointsLabel} on this order. Thank You! View your receipt: ${receiptText}`,
      });
    } else {
      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "ORDER_COMPLETION_SMS_SKIPPED_POLICY",
        entityType: "order",
        entityId: orderId,
        details: { policy: "sms_order_completion_enabled=false" },
      });
    }
  }

  if (nextStatus === ORDER_STATUS.OUT_FOR_DELIVERY) {
    if (paymentMethod === PAYMENT_METHOD.CASH_ON_DELIVERY) {
      await logSensitiveAction({
        actorType: actorType || "system",
        actorId: actorId || null,
        action: "COD_COLLECTION_PENDING_WITH_RIDER",
        entityType: "order",
        entityId: orderId,
        details: {
          orderNumber: order.order_number,
          amount: Number(order.subtotal_cedis || 0),
          assignedRiderId: order.assigned_rider_id || null,
          paymentStatus: order.payment_status || PAYMENT_STATUS.PENDING,
        },
      });
    }
    const dispatchSnapshot = await getOrderById(orderId);
    await ensureDeliveryOtpPrepared(orderId, dispatchSnapshot);
  }

  await logSensitiveAction({
    actorType: actorType || "system",
    actorId: actorId || null,
    action: "ORDER_STATUS_CHANGED",
    entityType: "order",
    entityId: orderId,
    details: {
      from: order.status,
      to: nextStatus,
      context: details || null,
    },
  });

  if (nextStatus === ORDER_STATUS.CANCELED) {
    await logSensitiveAction({
      actorType: actorType || "system",
      actorId: actorId || null,
      action: "ORDER_CANCELED",
      entityType: "order",
      entityId: orderId,
      details: {
        cancelReason: cancelReason || null,
        refundEligible: canIssueRefund({ ...order, status: nextStatus }),
      },
    });
  }

  let updatedOrder = await getOrderById(orderId);
  await emitRiderDispatchAlert(updatedOrder, nextStatus);
  updatedOrder = await getOrderById(orderId);
  publishOrderRealtimeEvent("order.updated", updatedOrder, {
    transition: {
      from: order.status,
      to: nextStatus,
    },
  });
  return updatedOrder;
}

async function markOrderAsPaid(orderId) {
  return changeOrderStatus({
    orderId,
    nextStatus: ORDER_STATUS.PAID,
    actorType: "system",
    actorId: null,
    details: { source: "payment_callback" },
  });
}

async function markOrderReturned({ orderId, actorId }) {
  await changeOrderStatus({
    orderId,
    nextStatus: ORDER_STATUS.RETURNED,
    actorType: "admin",
    actorId: actorId || null,
    details: { reason: "delivery_returned" },
  });

  return getOrderById(orderId);
}

async function markCashOnDeliveryCollected({
  orderId,
  riderId = null,
  collectionMethod = "cash",
  note = null,
}) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Cash collection is available for delivery orders only"), {
      statusCode: 400,
    });
  }

  if (order.status !== ORDER_STATUS.OUT_FOR_DELIVERY) {
    throw Object.assign(
      new Error("Order must be OUT_FOR_DELIVERY before confirming cash collection"),
      { statusCode: 400 },
    );
  }

  const paymentMethod = normalizePaymentMethod(order.payment_method, {
    source: order.source,
    deliveryType: order.delivery_type,
  });
  if (paymentMethod !== PAYMENT_METHOD.CASH_ON_DELIVERY) {
    throw Object.assign(new Error("Cash collection confirmation is only for cash-on-delivery orders"), {
      statusCode: 400,
    });
  }

  const paymentStatusCode = normalizePaymentStatusCode(order.payment_status);
  if (paymentStatusCode !== PAYMENT_STATUS.PAID) {
    await setPaymentStatus(order.id, PAYMENT_STATUS.PAID, { markConfirmedAt: true });
  }

  await logSensitiveAction({
    actorType: "rider",
    actorId: riderId || null,
    action: "COD_CASH_COLLECTION_CONFIRMED_BY_RIDER",
    entityType: "order",
    entityId: order.id,
    details: {
      orderNumber: order.order_number,
      amount: Number(order.subtotal_cedis || 0),
      collectionMethod: String(collectionMethod || "cash").trim().toLowerCase(),
      note: note ? String(note).trim() : null,
    },
  });

  const updated = await getOrderById(order.id);
  publishOrderRealtimeEvent("order.cod_collection_confirmed", updated, {
    actorType: "rider",
    actorId: riderId || null,
  });

  return {
    orderId: updated.id,
    orderNumber: updated.order_number,
    paymentMethod,
    paymentStatusCode: normalizePaymentStatusCode(updated.payment_status),
    paymentStatus: paymentStatusLabel(updated.payment_status),
    amountCollectedCedis: Number(updated.subtotal_cedis || 0),
    collectedAt: updated.payment_confirmed_at || null,
  };
}

function getAvailableActions(order) {
  const actions = [];

  if (order.status === ORDER_STATUS.PAID) {
    actions.push(ORDER_ACTION.START_PROCESSING);
  }

  if (order.status === ORDER_STATUS.PREPARING) {
    actions.push(ORDER_ACTION.MARK_READY_PICKUP);
  }

  if (order.status === ORDER_STATUS.READY_FOR_PICKUP) {
    if (order.delivery_type === "pickup") {
      actions.push(ORDER_ACTION.COMPLETE_PICKUP);
    } else if (order.delivery_type === "delivery") {
      actions.push(ORDER_ACTION.DISPATCH_ORDER);
    }
  }

  if (order.status === ORDER_STATUS.OUT_FOR_DELIVERY) {
    actions.push(ORDER_ACTION.MARK_RETURNED);
  }

  if (
    [
      ORDER_STATUS.PENDING_PAYMENT,
      ORDER_STATUS.PAID,
      ORDER_STATUS.PREPARING,
      ORDER_STATUS.READY_FOR_PICKUP,
      ORDER_STATUS.PAYMENT_FAILED,
    ].includes(order.status)
  ) {
    actions.push(ORDER_ACTION.CANCEL_ORDER);
  }

  if (canIssueRefund(order)) {
    actions.push(ORDER_ACTION.ISSUE_REFUND);
  }

  return actions;
}

async function getOrderDetails(orderId) {
  const order = await ensureOrder(orderId);
  const [items, loyaltyBalance] = await Promise.all([
    getOrderItems(orderId),
    getCustomerLoyaltyBalance(order.customer_id),
  ]);
  return {
    ...order,
    stageLabel: getReadableStage(order.status),
    ageMinutes: getAgeMinutes(order),
    isDelayed: isOperationallyDelayed(order),
    loyaltyBalance,
    availableActions: getAvailableActions(order),
    items,
  };
}

async function getOrderByReference(clientReference) {
  const order = await getOrderByClientReference(clientReference);
  if (!order) return null;
  return getOrderDetails(order.id);
}

async function getOrderByOrderNumberForTracking(input) {
  const {
    orderNumber,
    trackingToken,
    customerPhone,
    allowPhoneMatch,
  } = normalizeTrackingLookupInput(input);
  const normalizedOrderNumber = sanitizeOrderNumber(orderNumber);
  if (!isValidOrderNumber(normalizedOrderNumber)) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }
  if (!allowPhoneMatch && sanitizeTrackingToken(trackingToken).length !== TRACKING_TOKEN_LENGTH) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }
  const order = await getOrderByOrderNumber(normalizedOrderNumber);
  if (!order) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }
  const canAccessByToken = hasValidTrackingToken(order, trackingToken);
  const canAccessByPhone = allowPhoneMatch && isPhoneMatchForTracking(order.phone, customerPhone);
  if (!canAccessByToken && !canAccessByPhone) {
    throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  }
  const items = await getOrderItems(order.id);
  let slaConfig = DEFAULT_SLA_CONFIG;
  try {
    slaConfig = normalizeSlaConfig(await getSlaConfig());
  } catch (_error) {
    slaConfig = DEFAULT_SLA_CONFIG;
  }

  const normalizedItems = (items || []).map((item) => ({
    itemId: item.item_id,
    name: item.item_name_snapshot,
    unitPriceCedis: Number(item.unit_price_cedis || 0),
    quantity: Number(item.quantity || 0),
    lineTotalCedis: Number(item.line_total_cedis || 0),
  }));

  const itemCount = normalizedItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );

  const paymentMethod = normalizePaymentMethod(order.payment_method, {
    source: order.source,
    deliveryType: order.delivery_type,
  });
  const includePendingPayment = paymentMethod === PAYMENT_METHOD.MOMO
    && String(order.payment_status || "").toUpperCase() !== PAYMENT_STATUS.PAID;
  const etaMinutes = etaMinutesFromSla(order.delivery_type, slaConfig, { includePendingPayment });

  return {
    orderNumber: order.order_number,
    status: order.status,
    stage: getReadableStage(order.status),
    deliveryType: order.delivery_type,
    source: order.source,
    paymentMethod: paymentMethod,
    paymentStatus: paymentStatusLabel(order.payment_status),
    subtotalCedis: Number(order.subtotal_cedis || 0),
    customerName: order.full_name,
    customerPhone: order.phone,
    address: order.address || null,
    itemCount,
    items: normalizedItems,
    etaMinutes,
    etaLabel: formatEtaDuration(etaMinutes),
    createdAt: order.created_at,
    paymentConfirmedAt: order.payment_confirmed_at || null,
    updatedAt: order.updated_at,
  };
}

async function getOrdersForAdmin(options = {}) {
  const includeItems = options.includeItems === true;
  const limit = Math.max(20, Math.min(Number(options.limit || 120), 300));
  const orders = await listOrders(limit);
  const output = [];
  for (const order of orders) {
    output.push({
      ...order,
      stageLabel: getReadableStage(order.status),
      ageMinutes: getAgeMinutes(order),
      isDelayed: isOperationallyDelayed(order),
      availableActions: getAvailableActions(order),
      items: includeItems ? await getOrderItems(order.id) : [],
    });
  }
  return output;
}

async function markOrderMonitored({ orderId, adminId }) {
  await ensureOrder(orderId);
  await setOpsMonitoredAt(orderId);
  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId || null,
    action: "ORDER_MONITORED",
    entityType: "order",
    entityId: orderId,
    details: { source: "operations_board" },
  });
  const details = await getOrderDetails(orderId);
  publishOrderRealtimeEvent("order.monitored", details, {
    actorType: "admin",
    actorId: adminId || null,
  });
  return details;
}

async function getOrderHistoryForAdmin(filters = {}) {
  const result = await listOrderHistory(filters);
  return {
    ...result,
    rows: result.rows.map((order) => ({
      ...order,
      stageLabel: getReadableStage(order.status),
      isDelayed: Boolean(order.is_delayed),
      ageMinutes: Number(order.age_minutes || 0),
    })),
  };
}

async function getRiderQueue(limit = 80, options = {}) {
  const riderId = String(options.riderId || "").trim();
  const riderMode = String(options.riderMode || "staff").trim().toLowerCase();
  const includeSensitivePhone = options.includeSensitivePhone !== false && riderMode !== "guest";

  const [rows, commissionRatePercent] = await Promise.all([
    listOutForDeliveryOrders(limit),
    getGuestCommissionRatePercent(),
  ]);
  const queueRows = riderId
    ? rows.filter((row) => String(row.assigned_rider_id || "").trim() === riderId)
    : rows;

  return queueRows.map((row) => {
    const paymentMethod = normalizePaymentMethod(row.payment_method, {
      source: row.source,
      deliveryType: "delivery",
    });
    const paymentStatusCode = normalizePaymentStatusCode(row.payment_status);
    const requiresCollection = paymentMethod === PAYMENT_METHOD.CASH_ON_DELIVERY
      && paymentStatusCode !== PAYMENT_STATUS.PAID;
    return {
      id: row.id,
      orderNumber: row.order_number,
      customerName: row.full_name,
      customerPhoneMasked: maskPhoneForRiderQueue(row.phone),
      customerPhone: includeSensitivePhone ? (row.phone || "") : maskPhoneForRiderQueue(row.phone),
      address: row.address || "N/A",
      status: row.status,
      assignedRiderId: row.assigned_rider_id || null,
      subtotalCedis: Number(row.subtotal_cedis || 0),
      commissionRatePercent,
      commissionCedis: toCommissionCedis(row.subtotal_cedis, commissionRatePercent),
      paymentMethod,
      paymentStatusCode,
      paymentStatus: paymentStatusLabel(paymentStatusCode),
      requiresCollection,
      amountDueCedis: requiresCollection ? Number(row.subtotal_cedis || 0) : 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

async function assignOrderToRider({
  orderId,
  riderId,
  actorType = "admin",
  actorId = null,
  details = {},
}) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Rider assignment is only available for delivery orders"), {
      statusCode: 400,
    });
  }

  const normalizedRiderId = String(riderId || "").trim();
  let targetRider = null;

  if (normalizedRiderId) {
    const roster = await listRiderRoster();
    targetRider = roster.find((row) => String(row.id || "").trim() === normalizedRiderId) || null;
    if (!targetRider) {
      throw Object.assign(new Error("Rider not found"), { statusCode: 404 });
    }
    if (targetRider.status === "offline") {
      throw Object.assign(new Error("Selected rider is offline"), { statusCode: 400 });
    }
  }

  await setAssignedRider(order.id, normalizedRiderId || null);
  await logSensitiveAction({
    actorType,
    actorId,
    action: "ORDER_RIDER_ASSIGNED_MANUAL",
    entityType: "order",
    entityId: order.id,
    details: {
      orderNumber: order.order_number,
      assignedRiderId: normalizedRiderId || null,
      assignedRiderMode: targetRider?.mode || null,
      ...details,
    },
  });

  const updatedOrder = await getOrderById(order.id);
  publishOrderRealtimeEvent("order.assignment_updated", updatedOrder, {
    actorType,
    actorId,
  });
  return updatedOrder;
}

async function createInStoreOrder({
  clientReference,
  fullName,
  phone,
  items,
  deliveryType,
  address,
  paymentMethod,
  paymentChannel,
  adminId,
}) {
  if (deliveryType === "delivery" && (!address || String(address).trim().length < 4)) {
    throw Object.assign(new Error("Address is required for delivery in-store orders"), {
      statusCode: 400,
    });
  }

  const order = await createOrderFromRequest({
    clientReference,
    phone: String(phone).trim(),
    fullName: String(fullName).trim(),
    deliveryType,
    address,
    items,
    source: "instore",
    paymentMethod,
  });

  let paymentPrompt = null;
  if (paymentMethod === "cash") {
    await changeOrderStatus({
      orderId: order.id,
      nextStatus: ORDER_STATUS.PAID,
      actorType: "admin",
      actorId: adminId,
      details: { source: "instore_order", paymentMethod },
    });

    await changeOrderStatus({
      orderId: order.id,
      nextStatus: ORDER_STATUS.PREPARING,
      actorType: "admin",
      actorId: adminId,
      details: { source: "instore_order", paymentMethod },
    });
  } else if (paymentMethod === "momo") {
    try {
      paymentPrompt = await requestInStoreMomoPrompt({
        orderId: order.id,
        channel: paymentChannel,
        adminId,
      });
      await persistInStorePromptTransaction({
        order,
        paymentPrompt,
        adminId,
      });
    } catch (error) {
      await changeOrderStatus({
        orderId: order.id,
        nextStatus: ORDER_STATUS.PAYMENT_FAILED,
        actorType: "admin",
        actorId: adminId,
        details: {
          source: "instore_order",
          paymentMethod,
          reason: error.message,
        },
      });

      throw Object.assign(
        new Error(
          `MoMo prompt failed for ${order.orderNumber || order.id}. Order marked PAYMENT_FAILED. ${error.message}`,
        ),
        { statusCode: error.statusCode || 502 },
      );
    }
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "INSTORE_ORDER_CREATED",
    entityType: "order",
    entityId: order.id,
    details: { deliveryType, paymentMethod, paymentChannel: paymentChannel || null },
  });

  const orderDetails = await getOrderDetails(order.id);
  return {
    ...orderDetails,
    paymentPrompt,
  };
}

async function checkInStoreMomoPaymentStatus({ orderId, adminId }) {
  const order = await ensureOrder(orderId);
  if (order.source !== "instore" || order.payment_method !== "momo") {
    throw Object.assign(
      new Error("Only in-store MoMo orders support manual status checks"),
      { statusCode: 400 },
    );
  }
  if (!order.client_reference) {
    throw Object.assign(new Error("Missing order client reference for status check"), {
      statusCode: 400,
    });
  }

  const { checkTransactionStatus, processHubtelCallback } = require("./paymentService");
  const statusResult = await checkTransactionStatus(order.client_reference);
  if (statusResult?.skipped) {
    const currentOrder = await getOrderDetails(order.id);
    const paid = INSTORE_PAID_OR_PROGRESS_STATUSES.has(currentOrder.status);
    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_STATUS_CHECK_SKIPPED",
      entityType: "order",
      entityId: order.id,
      details: {
        reason: statusResult.reason || "status_check_skipped",
        paid,
        providerOutcome: "skipped",
      },
    });
    return {
      order: currentOrder,
      skipped: true,
      reason: statusResult.reason || "status_check_skipped",
      paid,
      responseCode: null,
      providerStatus: null,
      providerOutcome: "skipped",
      failureHint: "",
      clientReference: order.client_reference,
    };
  }

  const classification = classifyStatusCheckResult(statusResult.data);
  let providerOutcome = classification.outcome;
  let callbackResult = null;
  let failureHint = "";
  if (providerOutcome !== "pending") {
    const callbackPayload = toStatusCheckCallbackPayload(
      statusResult.data,
      order.client_reference,
      providerOutcome,
    );
    callbackResult = await processHubtelCallback(callbackPayload);
    if (
      providerOutcome === "failed" &&
      callbackResult?.ignored &&
      (
        callbackResult?.ignoreReason === "stale_failure_callback" ||
        callbackResult?.ignoreReason === "ambiguous_status_check_failure"
      )
    ) {
      providerOutcome = "pending";
      failureHint = callbackResult?.ignoreReason === "stale_failure_callback"
        ? "Ignored outdated failed status from an earlier prompt attempt."
        : "Ignored ambiguous failed status-check result without transaction reference.";
    }
  }
  if (providerOutcome === "failed") {
    const fromStatusPayload = parsePaymentFailureHintFromText(
      extractStatusCheckProviderMessage(statusResult.data),
    );
    if (fromStatusPayload) {
      failureHint = fromStatusPayload;
    } else {
      const latestPayment = await getPaymentByClientReference(order.client_reference);
      failureHint = parsePaymentFailureHintFromRawPayload(latestPayment?.raw_payload);
    }
  }

  let refreshedOrder = await getOrderDetails(order.id);
  let paid = INSTORE_PAID_OR_PROGRESS_STATUSES.has(refreshedOrder.status);
  const paidAttemptDetected = await hasPaidPromptAttempt(order.id);
  if (!paid && paidAttemptDetected) {
    try {
      let reconciledOrder = await markOrderAsPaid(order.id);
      if (reconciledOrder.source === "instore" && reconciledOrder.status === ORDER_STATUS.PAID) {
        reconciledOrder = await changeOrderStatus({
          orderId: order.id,
          nextStatus: ORDER_STATUS.PREPARING,
          actorType: "system",
          actorId: null,
          details: { source: "instore_paid_attempt_reconcile" },
        });
      }
      refreshedOrder = await getOrderDetails(order.id);
      paid = INSTORE_PAID_OR_PROGRESS_STATUSES.has(refreshedOrder.status);
      if (paid) {
        providerOutcome = "paid";
        failureHint = "";
      }
    } catch (error) {
      await logSensitiveAction({
        actorType: "admin",
        actorId: adminId || null,
        action: "INSTORE_MOMO_ATTEMPT_RECONCILE_FAILED",
        entityType: "order",
        entityId: order.id,
        details: {
          message: error?.message || "Failed to reconcile order from paid prompt attempt",
        },
      });
    }
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId || null,
    action: "INSTORE_MOMO_STATUS_CHECK_COMPLETED",
    entityType: "order",
    entityId: order.id,
    details: {
      paid,
      responseCode: classification.responseCode || null,
      providerStatus: classification.providerStatus || null,
      providerOutcome,
      ignored: Boolean(callbackResult?.ignored),
      ignoreReason: callbackResult?.ignoreReason || null,
      failureHint: failureHint || null,
    },
  });

  return {
    order: refreshedOrder,
    skipped: false,
    paid,
    responseCode: classification.responseCode || null,
    providerStatus: classification.providerStatus || null,
    providerOutcome,
    ignored: Boolean(callbackResult?.ignored),
    ignoreReason: callbackResult?.ignoreReason || null,
    failureHint,
    clientReference: order.client_reference,
  };
}

async function reconcileInStoreOrderBeforeRetry(order, adminId) {
  if (!order?.id) {
    return order;
  }

  if (!order?.client_reference) {
    return ensureOrder(order.id);
  }

  try {
    const { checkTransactionStatus, processHubtelCallback } = require("./paymentService");
    const statusResult = await checkTransactionStatus(order.client_reference);
    if (statusResult?.skipped || !statusResult?.data) {
      return ensureOrder(order.id);
    }

    const classification = classifyStatusCheckResult(statusResult.data);
    if (classification.outcome !== "pending") {
      const callbackPayload = toStatusCheckCallbackPayload(
        statusResult.data,
        order.client_reference,
        classification.outcome,
      );
      await processHubtelCallback(callbackPayload);
    }
  } catch (error) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_RETRY_RECONCILE_FAILED",
      entityType: "order",
      entityId: order.id,
      details: {
        message: error?.message || "Status reconciliation failed",
      },
    });
  }

  return ensureOrder(order.id);
}

async function retryInStoreMomoPrompt({
  orderId,
  paymentChannel,
  adminId,
}) {
  let order = await ensureOrder(orderId);

  if (order.source !== "instore" || order.payment_method !== "momo") {
    throw Object.assign(
      new Error("Only in-store MoMo orders can retry payment prompts"),
      { statusCode: 400 },
    );
  }

  if (!paymentChannel) {
    throw Object.assign(new Error("paymentChannel is required for MoMo prompt retry"), {
      statusCode: 400,
    });
  }

  order = await reconcileInStoreOrderBeforeRetry(order, adminId);

  if (INSTORE_PAID_OR_PROGRESS_STATUSES.has(order.status)) {
    throw Object.assign(
      new Error(`Order ${order.order_number} is already paid (${order.status}). Retry blocked.`),
      { statusCode: 409 },
    );
  }

  const retryableStatuses = new Set([
    ORDER_STATUS.PENDING_PAYMENT,
    ORDER_STATUS.PAYMENT_FAILED,
  ]);
  if (!retryableStatuses.has(order.status)) {
    throw Object.assign(
      new Error(`Cannot retry payment prompt when order status is ${order.status}`),
      { statusCode: 400 },
    );
  }

  if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
    const updatedAt = parseDbTimestamp(order.updated_at || order.created_at);
    if (updatedAt) {
      const elapsedMs = Date.now() - updatedAt.getTime();
      if (elapsedMs < INSTORE_PENDING_RETRY_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((INSTORE_PENDING_RETRY_COOLDOWN_MS - elapsedMs) / 1000);
        throw Object.assign(
          new Error(
            `Prompt is still active for ${order.order_number}. Retry allowed in ${waitSeconds}s.`,
          ),
          { statusCode: 429 },
        );
      }
    }
  }

  const paymentPrompt = await requestInStoreMomoPrompt({
    orderId: order.id,
    channel: paymentChannel,
    adminId,
  });
  await persistInStorePromptTransaction({
    order,
    paymentPrompt,
    adminId,
  });

  if (order.status === ORDER_STATUS.PAYMENT_FAILED) {
    await changeOrderStatus({
      orderId: order.id,
      nextStatus: ORDER_STATUS.PENDING_PAYMENT,
      actorType: "admin",
      actorId: adminId || null,
      details: {
        source: "instore_retry_prompt",
        paymentChannel,
      },
    });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId || null,
    action: "INSTORE_MOMO_PROMPT_RETRIED",
    entityType: "order",
    entityId: order.id,
    details: {
      paymentChannel,
      previousStatus: order.status,
      responseCode: paymentPrompt.responseCode || null,
      initiated: Boolean(paymentPrompt.initiated),
      simulated: Boolean(paymentPrompt.simulated),
    },
  });

  const orderDetails = await getOrderDetails(order.id);
  return {
    order: orderDetails,
    paymentPrompt,
  };
}

module.exports = {
  ORDER_ACTION,
  createOrderFromRequest,
  createInStoreOrder,
  checkInStoreMomoPaymentStatus,
  retryInStoreMomoPrompt,
  changeOrderStatus,
  markOrderAsPaid,
  markOrderReturned,
  getOrderDetails,
  getOrderByOrderNumberForTracking,
  getOrderByReference,
  getOrdersForAdmin,
  getOrderHistoryForAdmin,
  getRiderQueue,
  markCashOnDeliveryCollected,
  assignOrderToRider,
  markOrderMonitored,
  ensureOrder,
};
