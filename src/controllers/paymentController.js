const { verifyHubtelSignature } = require("../utils/security");
const env = require("../config/env");
const {
  processHubtelCallback,
  checkTransactionStatus,
} = require("../services/paymentService");
const { verifyInStoreCustomerWallet } = require("../services/receiveMoneyService");
const { reconcilePendingPayments } = require("../jobs/paymentStatusCheckJob");
const { logSensitiveAction } = require("../services/auditService");

async function handleHubtelCallback(req, res) {
  const signature =
    req.get("x-hubtel-signature") ||
    req.get("x-signature") ||
    req.get("signature") ||
    req.get("x-callback-signature");
  const isValid = verifyHubtelSignature(req.rawBody || "", signature, env.callbackSecret);

  if (!isValid && !env.hubtelCallbackSignatureOptional) {
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

  if (!isValid && env.hubtelCallbackSignatureOptional) {
    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "HUBTEL_CALLBACK_SIGNATURE_BYPASSED",
      entityType: "payment_callback",
      entityId: null,
      details: {
        mode: "test_shortcode",
      },
    });
  }

  const result = await processHubtelCallback(req.body);
  return res.status(202).json({ data: result });
}

async function runStatusCheck(req, res) {
  const result = await checkTransactionStatus(req.params.clientReference);
  return res.json({ data: result });
}

async function runPendingReconciliation(req, res) {
  const result = await reconcilePendingPayments();
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
