const axios = require("axios");
const env = require("../config/env");
const {
  getPaymentByClientReference,
  getLatestPromptAttemptByOrder,
  markPromptAttemptOutcome,
  upsertCallbackPayment,
} = require("../repositories/paymentRepository");
const {
  getOrderByClientReference,
  getOrderByHubtelSessionId,
} = require("../repositories/orderRepository");
const {
  markOrderAsPaid,
} = require("./orderService");
const { ORDER_STATUS } = require("../utils/orderStatus");
const { logSensitiveAction } = require("./auditService");
const { logHubtelEvent } = require("./hubtelLiveLogService");

function normalizeCallbackPayload(payload) {
  const hintedSource = String(payload?.Meta?.source || payload?.meta?.source || "")
    .trim()
    .toLowerCase();

  // Direct Receive Money style callback
  if (payload && typeof payload === "object" && payload.ResponseCode) {
    return {
      source: hintedSource || "receive_money",
      success: payload.ResponseCode === "0000",
      responseCode: payload.ResponseCode,
      clientReference:
        payload.Data?.ClientReference || payload.clientReference || payload.SessionId || null,
      sessionId: payload.SessionId || null,
      hubtelTransactionId: payload.Data?.TransactionId || null,
      externalTransactionId: payload.Data?.ExternalTransactionId || null,
      amount: payload.Data?.Amount ?? null,
      charges: payload.Data?.Charges ?? null,
      amountAfterCharges: payload.Data?.AmountAfterCharges ?? null,
      amountCharged: payload.Data?.AmountCharged ?? null,
      rawPayload: payload,
    };
  }

  // Programmable Services fulfillment payload
  if (payload?.OrderInfo?.Payment) {
    return {
      source: hintedSource || "programmable_services",
      success: Boolean(payload.OrderInfo.Payment.IsSuccessful),
      responseCode: payload.OrderInfo.Status || null,
      clientReference: payload.SessionId || null,
      sessionId: payload.SessionId || null,
      hubtelTransactionId: payload.OrderId || null,
      externalTransactionId: null,
      amount: payload.OrderInfo?.Subtotal ?? null,
      charges: null,
      amountAfterCharges: payload.OrderInfo?.Payment?.AmountAfterCharges ?? null,
      amountCharged: payload.OrderInfo?.Payment?.AmountPaid ?? null,
      rawPayload: payload,
    };
  }

  // Fallback shape observed in some callback integrations.
  if (payload && typeof payload === "object" && (payload.clientReference || payload.ClientReference)) {
    const responseCode = String(payload.ResponseCode || payload.responseCode || "").trim();
    const statusText = String(payload.Status || payload.status || "").trim().toLowerCase();
    const success = responseCode === "0000" || ["paid", "success", "successful", "completed"].includes(statusText);
    return {
      source: hintedSource || "generic_callback",
      success,
      responseCode: responseCode || null,
      clientReference: payload.ClientReference || payload.clientReference || null,
      sessionId: payload.SessionId || payload.sessionId || null,
      hubtelTransactionId: payload.TransactionId || payload.transactionId || null,
      externalTransactionId: payload.ExternalTransactionId || payload.externalTransactionId || null,
      amount: payload.Amount ?? payload.amount ?? null,
      charges: payload.Charges ?? payload.charges ?? null,
      amountAfterCharges: payload.AmountAfterCharges ?? payload.amountAfterCharges ?? null,
      amountCharged: payload.AmountCharged ?? payload.amountCharged ?? payload.Amount ?? payload.amount ?? null,
      rawPayload: payload,
    };
  }

  return null;
}

async function resolveOrderByCallback(normalized) {
  if (normalized.clientReference) {
    const byReference = await getOrderByClientReference(normalized.clientReference);
    if (byReference) return byReference;
  }

  if (normalized.sessionId) {
    const bySession = await getOrderByHubtelSessionId(normalized.sessionId);
    if (bySession) return bySession;
  }

  return null;
}

function normalizeTransactionId(value) {
  return String(value || "").trim();
}

function shouldIgnoreStaleFailedCallback(normalized, paymentRecord, latestAttempt) {
  if (normalized.success) return false;

  const expectedIds = [
    normalizeTransactionId(paymentRecord?.hubtel_transaction_id),
    normalizeTransactionId(paymentRecord?.external_transaction_id),
    normalizeTransactionId(latestAttempt?.hubtel_transaction_id),
    normalizeTransactionId(latestAttempt?.external_transaction_id),
  ].filter(Boolean);
  const callbackIds = [
    normalizeTransactionId(normalized.hubtelTransactionId),
    normalizeTransactionId(normalized.externalTransactionId),
  ].filter(Boolean);

  if (!expectedIds.length || !callbackIds.length) return false;
  const expectedSet = new Set(expectedIds);
  const hasAnyMatch = callbackIds.some((id) => expectedSet.has(id));
  return !hasAnyMatch;
}

async function applySuccessfulPayment(order, normalized) {
  const finalizedStates = [
    ORDER_STATUS.PAID,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.READY_FOR_PICKUP,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.RETURNED,
    ORDER_STATUS.REFUNDED,
  ];

  let currentOrder = order;
  if (!finalizedStates.includes(order.status)) {
    currentOrder = await markOrderAsPaid(order.id);
  }
}

async function applyFailedPayment(order, normalized) {
  if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
    await changeOrderStatus({
      orderId: order.id,
      nextStatus: ORDER_STATUS.PAYMENT_FAILED,
      actorType: "system",
      actorId: null,
      details: {
        source: normalized.source,
        responseCode: normalized.responseCode,
      },
    });
  }
}

async function processHubtelCallback(payload) {
  logHubtelEvent("HUBTEL_CALLBACK_PROCESS_START", {
    body: payload || null,
  });

  const normalized = normalizeCallbackPayload(payload);
  if (!normalized) {
    logHubtelEvent("HUBTEL_CALLBACK_PROCESS_ERROR", {
      reason: "unsupported_payload_shape",
      bodyKeys: Object.keys(payload || {}),
    });

    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "HUBTEL_CALLBACK_UNSUPPORTED_PAYLOAD",
      entityType: "payment_callback",
      entityId: null,
      details: {
        payloadKeys: Object.keys(payload || {}),
      },
    });
    throw Object.assign(new Error("Unsupported Hubtel callback payload"), {
      statusCode: 400,
    });
  }

  const order = await resolveOrderByCallback(normalized);
  if (!order) {
    logHubtelEvent("HUBTEL_CALLBACK_PROCESS_ERROR", {
      reason: "order_not_found",
      clientReference: normalized.clientReference || null,
      sessionId: normalized.sessionId || null,
      source: normalized.source || null,
    });
    throw Object.assign(new Error("No order matches callback reference"), {
      statusCode: 404,
    });
  }

  if (
    !normalized.success &&
    normalized.source === "status_check" &&
    !normalized.hubtelTransactionId &&
    !normalized.externalTransactionId
  ) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "HUBTEL_CALLBACK_IGNORED_AMBIGUOUS_STATUS_CHECK_FAILURE",
      entityType: "order",
      entityId: order.id,
      details: {
        source: normalized.source,
        responseCode: normalized.responseCode,
      },
    });
    logHubtelEvent("HUBTEL_CALLBACK_PROCESS_IGNORED", {
      orderId: order.id,
      orderNumber: order.order_number || null,
      clientReference: order.client_reference || null,
      reason: "ambiguous_status_check_failure",
      responseCode: normalized.responseCode || null,
      source: normalized.source || null,
    });
    return {
      orderId: order.id,
      status: order.status || "PENDING_PAYMENT",
      ignored: true,
      ignoreReason: "ambiguous_status_check_failure",
    };
  }

  const shouldPersistAttemptOutcome =
    Boolean(normalized.success) ||
    Boolean(normalized.hubtelTransactionId) ||
    Boolean(normalized.externalTransactionId) ||
    normalized.source !== "status_check";
  if (shouldPersistAttemptOutcome) {
    await markPromptAttemptOutcome({
      orderId: order.id,
      clientReference: order.client_reference,
      hubtelTransactionId: normalized.hubtelTransactionId || null,
      externalTransactionId: normalized.externalTransactionId || null,
      responseCode: normalized.responseCode || null,
      status: normalized.success ? "PAID" : "FAILED",
      source: normalized.source || "callback",
      rawPayload: normalized.rawPayload || null,
    });
  }

  const latestPayment = await getPaymentByClientReference(order.client_reference);
  const latestAttempt = await getLatestPromptAttemptByOrder(order.id);
  if (shouldIgnoreStaleFailedCallback(normalized, latestPayment, latestAttempt)) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "HUBTEL_CALLBACK_IGNORED_STALE_FAILURE",
      entityType: "order",
      entityId: order.id,
      details: {
        source: normalized.source,
        responseCode: normalized.responseCode,
        callbackHubtelTransactionId: normalized.hubtelTransactionId || null,
        callbackExternalTransactionId: normalized.externalTransactionId || null,
        expectedHubtelTransactionId: latestPayment?.hubtel_transaction_id || null,
        expectedExternalTransactionId: latestPayment?.external_transaction_id || null,
      },
    });

    logHubtelEvent("HUBTEL_CALLBACK_PROCESS_IGNORED", {
      orderId: order.id,
      orderNumber: order.order_number || null,
      clientReference: order.client_reference || null,
      reason: "stale_failure_callback",
      responseCode: normalized.responseCode || null,
      source: normalized.source || null,
    });

    return {
      orderId: order.id,
      status: latestPayment?.status || order.status || "PENDING",
      ignored: true,
      ignoreReason: "stale_failure_callback",
    };
  }

  await upsertCallbackPayment({
    orderId: order.id,
    clientReference: order.client_reference,
    hubtelTransactionId: normalized.hubtelTransactionId,
    externalTransactionId: normalized.externalTransactionId,
    responseCode: normalized.responseCode,
    status: normalized.success ? "PAID" : "FAILED",
    amount: normalized.amount,
    charges: normalized.charges,
    amountAfterCharges: normalized.amountAfterCharges,
    amountCharged: normalized.amountCharged,
    rawPayload: normalized.rawPayload,
  });

  if (normalized.success) {
    await applySuccessfulPayment(order, normalized);
  } else {
    await applyFailedPayment(order, normalized);
  }

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "HUBTEL_CALLBACK_PROCESSED",
    entityType: "order",
    entityId: order.id,
    details: {
      success: normalized.success,
      source: normalized.source,
      responseCode: normalized.responseCode,
    },
  });

  logHubtelEvent("HUBTEL_CALLBACK_PROCESS_DONE", {
    orderId: order.id,
    orderNumber: order.order_number || null,
    clientReference: order.client_reference || null,
    success: normalized.success,
    responseCode: normalized.responseCode || null,
    source: normalized.source || null,
    nextStatus: normalized.success ? "PAID" : "FAILED",
  });

  return {
    orderId: order.id,
    status: normalized.success ? "PAID" : "FAILED",
    ignored: false,
    ignoreReason: null,
  };
}

async function checkTransactionStatus(clientReference) {
  if (!env.hubtelTxnStatusBasicAuth || !env.hubtelPosSalesId) {
    logHubtelEvent("HUBTEL_STATUS_CHECK_SKIPPED", {
      clientReference,
      reason: "missing_status_check_configuration",
    });
    return {
      skipped: true,
      reason: "missing_status_check_configuration",
    };
  }

  const authHeader = env.hubtelTxnStatusBasicAuth.startsWith("Basic ")
    ? env.hubtelTxnStatusBasicAuth
    : `Basic ${env.hubtelTxnStatusBasicAuth}`;

  const url = `${env.hubtelTxnStatusBaseUrl}/transactions/${env.hubtelPosSalesId}/status`;
  logHubtelEvent("HUBTEL_STATUS_CHECK_REQUEST_OUT", {
    method: "GET",
    url,
    query: { clientReference },
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  let response;
  try {
    response = await axios.get(url, {
      params: { clientReference },
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      timeout: 10000,
    });
  } catch (error) {
    logHubtelEvent("HUBTEL_STATUS_CHECK_RESPONSE_ERR", {
      method: "GET",
      url,
      query: { clientReference },
      statusCode: error?.response?.status || null,
      error: error?.message || "status_check_failed",
      body: error?.response?.data || null,
    });
    throw error;
  }

  logHubtelEvent("HUBTEL_STATUS_CHECK_RESPONSE_OK", {
    method: "GET",
    url,
    query: { clientReference },
    statusCode: response.status,
    body: response.data || null,
  });

  return {
    skipped: false,
    data: response.data,
  };
}

module.exports = {
  normalizeCallbackPayload,
  processHubtelCallback,
  checkTransactionStatus,
};
