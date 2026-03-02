const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

function normalizeStatus(value) {
  const token = String(value || "").trim().toUpperCase();
  if (token === "PAID") return "PAID";
  if (token === "FAILED") return "FAILED";
  return "PENDING";
}

async function insertPendingPayment({ orderId, clientReference, amount }, dbOverride = null) {
  const db = dbOverride || (await getDb());
  await db.run(
    `INSERT INTO payments (
      id, order_id, client_reference, status, amount
    ) VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), orderId, clientReference, "PENDING", amount],
  );
}

async function getPaymentByClientReference(clientReference) {
  const db = await getDb();
  return db.get(
    `SELECT *
     FROM payments
     WHERE client_reference = ?
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [clientReference],
  );
}

async function upsertCallbackPayment(data) {
  const db = await getDb();
  const existing = await getPaymentByClientReference(data.clientReference);

  if (existing) {
    const nextStatus =
      existing.status === "PAID" && data.status !== "PAID"
        ? "PAID"
        : data.status;

    await db.run(
      `UPDATE payments
       SET hubtel_transaction_id = ?,
           external_transaction_id = ?,
           response_code = ?,
           status = ?,
           amount = ?,
           charges = ?,
           amount_after_charges = ?,
           amount_charged = ?,
           raw_payload = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        data.hubtelTransactionId || null,
        data.externalTransactionId || null,
        data.responseCode || null,
        nextStatus,
        data.amount ?? null,
        data.charges ?? null,
        data.amountAfterCharges ?? null,
        data.amountCharged ?? null,
        JSON.stringify(data.rawPayload || {}),
        existing.id,
      ],
    );
    return existing.id;
  }

  if (!data.orderId) {
    throw new Error("orderId is required when creating prompt payment tracking row");
  }

  const id = uuidv4();
  await db.run(
    `INSERT INTO payments (
      id, order_id, client_reference, hubtel_transaction_id, external_transaction_id,
      response_code, status, amount, charges, amount_after_charges, amount_charged,
      raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.orderId,
      data.clientReference,
      data.hubtelTransactionId || null,
      data.externalTransactionId || null,
      data.responseCode || null,
      data.status,
      data.amount ?? null,
      data.charges ?? null,
      data.amountAfterCharges ?? null,
      data.amountCharged ?? null,
      JSON.stringify(data.rawPayload || {}),
    ],
  );

  return id;
}

async function insertPromptAttempt({
  orderId,
  clientReference,
  paymentChannel = null,
  hubtelTransactionId = null,
  externalTransactionId = null,
  responseCode = null,
  status = "PENDING",
  source = "prompt",
  rawPayload = null,
}) {
  const db = await getDb();
  if (!orderId) {
    throw new Error("orderId is required for payment prompt attempt");
  }
  const normalizedReference = String(clientReference || "").trim();
  if (!normalizedReference) {
    throw new Error("clientReference is required for payment prompt attempt");
  }

  const id = uuidv4();
  await db.run(
    `INSERT INTO payment_prompt_attempts (
      id, order_id, client_reference, payment_channel,
      hubtel_transaction_id, external_transaction_id,
      response_code, attempt_status, source, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      orderId,
      normalizedReference,
      paymentChannel || null,
      hubtelTransactionId || null,
      externalTransactionId || null,
      responseCode || null,
      normalizeStatus(status),
      String(source || "prompt").trim().toLowerCase() || "prompt",
      JSON.stringify(rawPayload || {}),
    ],
  );

  return id;
}

async function getLatestPromptAttemptByOrder(orderId) {
  const db = await getDb();
  return db.get(
    `SELECT *
     FROM payment_prompt_attempts
     WHERE order_id = ?
     ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
     LIMIT 1`,
    [orderId],
  );
}

async function getLatestPromptAttemptByClientReference(clientReference) {
  const db = await getDb();
  return db.get(
    `SELECT *
     FROM payment_prompt_attempts
     WHERE client_reference = ?
     ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
     LIMIT 1`,
    [clientReference],
  );
}

async function listPromptAttemptsByOrder(orderId, limit = 25) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 25), 200));
  return db.all(
    `SELECT *
     FROM payment_prompt_attempts
     WHERE order_id = ?
     ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
     LIMIT ?`,
    [orderId, safeLimit],
  );
}

async function listActivePromptAttemptOrders({
  maxAgeMinutes = 120,
  limit = 120,
} = {}) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 120), 400));
  const safeMaxAge = Math.max(1, Math.min(Number(maxAgeMinutes || 120), 24 * 60));
  return db.all(
    `SELECT
       o.id AS order_id,
       o.client_reference,
       o.status AS order_status,
       MAX(a.created_at) AS last_attempt_at
     FROM payment_prompt_attempts a
     JOIN orders o ON o.id = a.order_id
     WHERE a.attempt_status = 'PENDING'
       AND datetime(a.created_at) >= datetime('now', ?)
       AND o.source IN ('instore', 'ussd')
       AND o.payment_method = 'momo'
       AND o.status IN ('PENDING_PAYMENT', 'PAYMENT_FAILED')
     GROUP BY o.id, o.client_reference, o.status
     ORDER BY datetime(last_attempt_at) DESC
     LIMIT ?`,
    [`-${safeMaxAge} minutes`, safeLimit],
  );
}

async function hasPaidPromptAttempt(orderId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id
     FROM payment_prompt_attempts
     WHERE order_id = ?
       AND attempt_status = 'PAID'
     ORDER BY datetime(updated_at) DESC
     LIMIT 1`,
    [orderId],
  );
  return Boolean(row?.id);
}

async function findPromptAttemptForOutcome({
  orderId,
  clientReference,
  hubtelTransactionId,
  externalTransactionId,
}) {
  const db = await getDb();
  const normalizedOrderId = String(orderId || "").trim();
  const normalizedReference = String(clientReference || "").trim();
  const txnId = String(hubtelTransactionId || "").trim();
  const extId = String(externalTransactionId || "").trim();

  if (normalizedOrderId && txnId) {
    const byOrderTxn = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE order_id = ? AND hubtel_transaction_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedOrderId, txnId],
    );
    if (byOrderTxn) return byOrderTxn;
  }
  if (normalizedReference && txnId) {
    const byRefTxn = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE client_reference = ? AND hubtel_transaction_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedReference, txnId],
    );
    if (byRefTxn) return byRefTxn;
  }

  if (normalizedOrderId && extId) {
    const byOrderExternal = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE order_id = ? AND external_transaction_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedOrderId, extId],
    );
    if (byOrderExternal) return byOrderExternal;
  }
  if (normalizedReference && extId) {
    const byRefExternal = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE client_reference = ? AND external_transaction_id = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedReference, extId],
    );
    if (byRefExternal) return byRefExternal;
  }

  if (normalizedOrderId) {
    const latestByOrder = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE order_id = ?
       ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedOrderId],
    );
    if (latestByOrder) return latestByOrder;
  }
  if (normalizedReference) {
    const latestByRef = await db.get(
      `SELECT *
       FROM payment_prompt_attempts
       WHERE client_reference = ?
       ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC
       LIMIT 1`,
      [normalizedReference],
    );
    if (latestByRef) return latestByRef;
  }

  return null;
}

async function markPromptAttemptOutcome({
  orderId,
  clientReference,
  hubtelTransactionId = null,
  externalTransactionId = null,
  responseCode = null,
  status = "PENDING",
  source = "callback",
  rawPayload = null,
}) {
  const db = await getDb();
  const normalizedStatus = normalizeStatus(status);

  const existing = await findPromptAttemptForOutcome({
    orderId,
    clientReference,
    hubtelTransactionId,
    externalTransactionId,
  });

  if (existing) {
    const nextHubtelId = hubtelTransactionId || existing.hubtel_transaction_id || null;
    const nextExternalId = externalTransactionId || existing.external_transaction_id || null;
    const nextResponseCode = responseCode || existing.response_code || null;
    const nextSource = String(source || existing.source || "callback").trim().toLowerCase() || "callback";
    const nextRawPayload = rawPayload
      ? JSON.stringify(rawPayload)
      : (existing.raw_payload || JSON.stringify({}));
    await db.run(
      `UPDATE payment_prompt_attempts
       SET hubtel_transaction_id = ?,
           external_transaction_id = ?,
           response_code = ?,
           attempt_status = ?,
           source = ?,
           raw_payload = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        nextHubtelId,
        nextExternalId,
        nextResponseCode,
        normalizedStatus,
        nextSource,
        nextRawPayload,
        existing.id,
      ],
    );
    return existing.id;
  }

  return insertPromptAttempt({
    orderId,
    clientReference,
    paymentChannel: null,
    hubtelTransactionId,
    externalTransactionId,
    responseCode,
    status: normalizedStatus,
    source,
    rawPayload,
  });
}

async function setLatestPromptTransaction({
  orderId,
  clientReference,
  hubtelTransactionId,
  externalTransactionId,
  responseCode,
}) {
  const db = await getDb();
  const normalizedReference = String(clientReference || "").trim();
  if (!normalizedReference) {
    throw new Error("clientReference is required to track prompt transaction");
  }

  const existing = await getPaymentByClientReference(normalizedReference);
  if (existing) {
    const nextHubtelId = hubtelTransactionId || existing.hubtel_transaction_id || null;
    const nextExternalId = externalTransactionId || existing.external_transaction_id || null;
    const nextResponseCode = responseCode || existing.response_code || null;
    const nextStatus = existing.status === "PAID" ? "PAID" : "PENDING";

    await db.run(
      `UPDATE payments
       SET hubtel_transaction_id = ?,
           external_transaction_id = ?,
           response_code = ?,
           status = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [nextHubtelId, nextExternalId, nextResponseCode, nextStatus, existing.id],
    );
    return existing.id;
  }

  const id = uuidv4();
  await db.run(
    `INSERT INTO payments (
      id, order_id, client_reference, hubtel_transaction_id, external_transaction_id,
      response_code, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      orderId,
      normalizedReference,
      hubtelTransactionId || null,
      externalTransactionId || null,
      responseCode || null,
      "PENDING",
    ],
  );
  return id;
}

module.exports = {
  insertPendingPayment,
  getPaymentByClientReference,
  getLatestPromptAttemptByOrder,
  getLatestPromptAttemptByClientReference,
  listActivePromptAttemptOrders,
  listPromptAttemptsByOrder,
  hasPaidPromptAttempt,
  insertPromptAttempt,
  markPromptAttemptOutcome,
  setLatestPromptTransaction,
  upsertCallbackPayment,
};
