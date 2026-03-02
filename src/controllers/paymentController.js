const { verifyHubtelSignature } = require("../utils/security");
const env = require("../config/env");
const {
  processHubtelCallback,
  checkTransactionStatus,
} = require("../services/paymentService");
const { verifyInStoreCustomerWallet } = require("../services/receiveMoneyService");
const { reconcilePendingPayments, runPaymentStatusCheck } = require("../jobs/paymentStatusCheckJob");
const { logSensitiveAction } = require("../services/auditService");
const { logHubtelEvent } = require("../services/hubtelLiveLogService");

function extractClientReferenceFromCallbackPayload(payload) {
  const value =
    payload?.Data?.ClientReference ||
    payload?.data?.clientReference ||
    payload?.ClientReference ||
    payload?.clientReference ||
    payload?.SessionId ||
    payload?.sessionId ||
    "";
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length > 96) return "";
  return normalized;
}

async function handleHubtelCallback(req, res) {
  const signature =
    req.get("x-hubtel-signature") ||
    req.get("x-signature") ||
    req.get("signature") ||
    req.get("x-callback-signature");

  logHubtelEvent("HUBTEL_CALLBACK_REQUEST_IN", {
    route: "/api/payments/hubtel/callback",
    hasSignature: Boolean(signature),
    signatureHeader:
      req.get("x-hubtel-signature")
        ? "x-hubtel-signature"
        : req.get("x-signature")
          ? "x-signature"
          : req.get("signature")
            ? "signature"
            : req.get("x-callback-signature")
              ? "x-callback-signature"
              : null,
    body: req.body || null,
  });

  const isValid = verifyHubtelSignature(req.rawBody || "", signature, env.callbackSecret);

  if (!isValid) {
    const clientReference = extractClientReferenceFromCallbackPayload(req.body);
    if (clientReference) {
      setImmediate(async () => {
        logHubtelEvent("HUBTEL_CALLBACK_UNSIGNED_FALLBACK_START", {
          route: "/api/payments/hubtel/callback",
          clientReference,
        });
        try {
          const fallback = await runPaymentStatusCheck(clientReference);
          logHubtelEvent("HUBTEL_CALLBACK_UNSIGNED_FALLBACK_DONE", {
            route: "/api/payments/hubtel/callback",
            clientReference,
            fallback,
          });
        } catch (error) {
          logHubtelEvent("HUBTEL_CALLBACK_UNSIGNED_FALLBACK_ERROR", {
            route: "/api/payments/hubtel/callback",
            clientReference,
            error: error?.message || "fallback_status_check_failed",
          });
        }
      });
    } else {
      logHubtelEvent("HUBTEL_CALLBACK_UNSIGNED_FALLBACK_SKIPPED", {
        route: "/api/payments/hubtel/callback",
        reason: "missing_client_reference",
      });
    }

    logHubtelEvent("HUBTEL_CALLBACK_REJECTED", {
      route: "/api/payments/hubtel/callback",
      reason: "invalid_signature",
      statusCode: 401,
      bodyKeys: Object.keys(req.body || {}),
    });

    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "HUBTEL_CALLBACK_SIGNATURE_INVALID",
      entityType: "payment_callback",
      entityId: null,
      details: {
        hasSignature: Boolean(signature),
        bodyKeys: Object.keys(req.body || {}),
      },
    });
    return res.status(401).json({ error: "Invalid callback signature" });
  }

  const result = await processHubtelCallback(req.body);
  logHubtelEvent("HUBTEL_CALLBACK_ACCEPTED", {
    route: "/api/payments/hubtel/callback",
    statusCode: 202,
    result,
  });
  return res.status(202).json({ data: result });
}

async function runStatusCheck(req, res) {
  const result = await checkTransactionStatus(req.params.clientReference);
  logHubtelEvent("HUBTEL_STATUS_CHECK_MANUAL", {
    route: "/api/admin/payments/status-check/:clientReference",
    clientReference: req.params.clientReference,
    adminId: req.admin?.sub || null,
    result,
  });
  return res.json({ data: result });
}

async function runPendingReconciliation(req, res) {
  const result = await reconcilePendingPayments();
  logHubtelEvent("HUBTEL_RECONCILE_MANUAL", {
    route: "/api/admin/payments/reconcile",
    adminId: req.admin?.sub || null,
    result,
  });
  return res.json({ data: result });
}

async function verifyInstoreMomoCustomer(req, res) {
  const result = await verifyInStoreCustomerWallet({
    fullName: req.validatedBody.fullName,
    phone: req.validatedBody.phone,
    channel: req.validatedBody.paymentChannel,
    adminId: req.admin.sub,
  });
  return res.json({ data: result });
}

module.exports = {
  handleHubtelCallback,
  runStatusCheck,
  runPendingReconciliation,
  verifyInstoreMomoCustomer,
};
