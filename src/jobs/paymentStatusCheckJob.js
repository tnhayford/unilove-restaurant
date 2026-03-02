const { getOrderByReference } = require("../services/orderService");
const { checkTransactionStatus, processHubtelCallback } = require("../services/paymentService");
const { listPendingOrdersOlderThan } = require("../repositories/orderRepository");
const { listActivePromptAttemptOrders } = require("../repositories/paymentRepository");
const { logSensitiveAction } = require("../services/auditService");
const { logHubtelEvent } = require("../services/hubtelLiveLogService");

const PAID_TOKENS = new Set(["paid", "success", "successful", "completed", "fulfilled"]);
const FAILED_TOKENS = new Set([
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
const PENDING_TOKENS = new Set([
  "pending",
  "processing",
  "in_progress",
  "unpaid",
  "awaiting_pin",
  "awaiting_payment",
]);
const FAILED_HINT_PATTERN = /(failed|declined|rejected|cancelled|canceled|expired|timeout|timed\s*out|abandoned)/i;

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function tokenHasWord(token, word) {
  return (
    token === word ||
    token.startsWith(`${word}_`) ||
    token.endsWith(`_${word}`) ||
    token.includes(`_${word}_`)
  );
}

function matchesTokenSet(token, words) {
  if (!token) return false;
  for (const word of words) {
    if (tokenHasWord(token, word)) {
      return true;
    }
  }
  return false;
}

function classifyStatusResult(resultData) {
  const responseCode = String(resultData?.responseCode || resultData?.ResponseCode || "").trim();
  const dataNode = resultData?.data || resultData?.Data || {};
  const statusRaw = String(
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
  const providerMessage = String(
    dataNode?.description ||
    dataNode?.Description ||
    dataNode?.message ||
    dataNode?.Message ||
    resultData?.message ||
    resultData?.Message ||
    "",
  ).trim();
  const token = normalizeToken(statusRaw);
  if (matchesTokenSet(token, PAID_TOKENS)) return "paid";
  if (matchesTokenSet(token, FAILED_TOKENS)) return "failed";
  if (matchesTokenSet(token, PENDING_TOKENS)) return "pending";
  if (responseCode && responseCode !== "0000") return "failed";
  if (!token && FAILED_HINT_PATTERN.test(providerMessage)) return "failed";
  return "pending";
}

function toCallbackPayload(resultData, clientReference, outcome) {
  const dataNode = resultData?.data || resultData?.Data || {};
  const responseCode = String(resultData?.responseCode || resultData?.ResponseCode || "").trim();
  const failureCode = responseCode && responseCode !== "0000" ? responseCode : "2001";
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

async function runPaymentStatusCheck(clientReference) {
  const order = await getOrderByReference(clientReference);
  if (!order) {
    logHubtelEvent("RECONCILE_STATUS_CHECK_SINGLE_ERROR", {
      clientReference,
      reason: "order_not_found",
    });
    throw new Error("Order not found for client reference");
  }

  const result = await checkTransactionStatus(clientReference);
  if (result.skipped) {
    logHubtelEvent("RECONCILE_STATUS_CHECK_SINGLE_SKIPPED", {
      clientReference,
      reason: result.reason || "status_check_skipped",
    });
    return result;
  }

  const outcome = classifyStatusResult(result.data);
  if (outcome !== "pending") {
    const normalizedPayload = toCallbackPayload(result.data, clientReference, outcome);
    await processHubtelCallback(normalizedPayload);
  }

  logHubtelEvent("RECONCILE_STATUS_CHECK_SINGLE_DONE", {
    clientReference,
    outcome,
    reconciled: outcome !== "pending",
  });

  return {
    skipped: false,
    reconciled: outcome !== "pending",
    outcome,
    source: "status_check",
  };
}

async function reconcilePendingPayments(options = {}) {
  const minAgeMinutes = Math.max(1, Number(options.minAgeMinutes || 5));
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
  const verbose = options.verbose === true;
  const staleOrders = await listPendingOrdersOlderThan(minAgeMinutes, limit);
  let processed = 0;
  let paid = 0;
  let failed = 0;
  let ignored = 0;
  let errors = 0;

  for (const order of staleOrders) {
    try {
      const statusResult = await checkTransactionStatus(order.client_reference);
      if (statusResult.skipped || !statusResult.data) {
        if (verbose) {
          logHubtelEvent("RECONCILE_PENDING_ORDER_SKIPPED", {
            orderId: order.id,
            orderNumber: order.order_number || null,
            clientReference: order.client_reference,
            reason: statusResult.reason || "status_check_skipped",
          });
        }
        continue;
      }

      const outcome = classifyStatusResult(statusResult.data);
      if (outcome === "pending") {
        if (verbose) {
          logHubtelEvent("RECONCILE_PENDING_ORDER_PENDING", {
            orderId: order.id,
            orderNumber: order.order_number || null,
            clientReference: order.client_reference,
          });
        }
        continue;
      }

      const normalizedPayload = toCallbackPayload(
        statusResult.data,
        order.client_reference,
        outcome,
      );

      const callbackResult = await processHubtelCallback(normalizedPayload);
      if (callbackResult?.ignored) {
        ignored += 1;
        if (verbose) {
          logHubtelEvent("RECONCILE_PENDING_ORDER_IGNORED", {
            orderId: order.id,
            orderNumber: order.order_number || null,
            clientReference: order.client_reference,
            outcome,
            ignoreReason: callbackResult?.ignoreReason || null,
          });
        }
        continue;
      }

      processed += 1;
      if (outcome === "paid") paid += 1;
      if (outcome === "failed") failed += 1;
      logHubtelEvent("RECONCILE_PENDING_ORDER_APPLIED", {
        orderId: order.id,
        orderNumber: order.order_number || null,
        clientReference: order.client_reference,
        outcome,
      });
    } catch (error) {
      errors += 1;
      logHubtelEvent("RECONCILE_PENDING_ORDER_ERROR", {
        orderId: order.id,
        orderNumber: order.order_number || null,
        clientReference: order.client_reference,
        error: error.message,
      });
      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "PAYMENT_STATUS_RECONCILIATION_FAILED",
        entityType: "order",
        entityId: order.id,
        details: { message: error.message },
      });
    }
  }

  const summary = {
    minAgeMinutes,
    limit,
    checked: staleOrders.length,
    processed,
    paid,
    failed,
    ignored,
    errors,
  };
  if (processed > 0 || ignored > 0 || errors > 0 || (verbose && staleOrders.length > 0)) {
    logHubtelEvent("RECONCILE_PENDING_SUMMARY", summary);
  }
  return summary;
}

async function reconcileActivePromptAttempts(options = {}) {
  const maxAgeMinutes = Number(options.maxAgeMinutes || 120);
  const limit = Number(options.limit || 120);
  const verbose = options.verbose === true;
  const targets = await listActivePromptAttemptOrders({ maxAgeMinutes, limit });

  let checked = 0;
  let paid = 0;
  let failed = 0;
  let reconciled = 0;
  let ignored = 0;
  let errors = 0;

  for (const target of targets) {
    const clientReference = String(target.client_reference || "").trim();
    if (!clientReference) continue;

    checked += 1;
    try {
      const statusResult = await checkTransactionStatus(clientReference);
      if (statusResult.skipped || !statusResult.data) {
        if (verbose) {
          logHubtelEvent("RECONCILE_PROMPT_TARGET_SKIPPED", {
            orderId: target.order_id || null,
            clientReference,
            reason: statusResult.reason || "status_check_skipped",
          });
        }
        continue;
      }

      const outcome = classifyStatusResult(statusResult.data);
      if (outcome === "pending") {
        if (verbose) {
          logHubtelEvent("RECONCILE_PROMPT_TARGET_PENDING", {
            orderId: target.order_id || null,
            clientReference,
          });
        }
        continue;
      }

      const normalizedPayload = toCallbackPayload(
        statusResult.data,
        clientReference,
        outcome,
      );
      const callbackResult = await processHubtelCallback(normalizedPayload);
      if (callbackResult?.ignored) {
        ignored += 1;
        if (verbose) {
          logHubtelEvent("RECONCILE_PROMPT_TARGET_IGNORED", {
            orderId: target.order_id || null,
            clientReference,
            outcome,
            ignoreReason: callbackResult?.ignoreReason || null,
          });
        }
        continue;
      }

      reconciled += 1;
      if (outcome === "paid") {
        paid += 1;
      } else if (outcome === "failed") {
        failed += 1;
      }
      logHubtelEvent("RECONCILE_PROMPT_TARGET_APPLIED", {
        orderId: target.order_id || null,
        clientReference,
        outcome,
      });
    } catch (error) {
      errors += 1;
      logHubtelEvent("RECONCILE_PROMPT_TARGET_ERROR", {
        orderId: target.order_id || null,
        clientReference,
        error: error.message,
      });
      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "PAYMENT_PROMPT_RECONCILIATION_FAILED",
        entityType: "order",
        entityId: target.order_id || null,
        details: {
          clientReference,
          message: error.message,
        },
      });
    }
  }

  const summary = {
    maxAgeMinutes,
    limit,
    checked,
    reconciled,
    paid,
    failed,
    ignored,
    errors,
  };
  if (reconciled > 0 || ignored > 0 || errors > 0 || (verbose && checked > 0)) {
    logHubtelEvent("RECONCILE_PROMPT_SUMMARY", summary);
  }
  return summary;
}

module.exports = {
  runPaymentStatusCheck,
  reconcilePendingPayments,
  reconcileActivePromptAttempts,
};
