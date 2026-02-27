const { getDb } = require("../db/connection");

async function upsertDeliveryCode(orderId, codeHash) {
  const db = await getDb();
  const existing = await db.get(
    "SELECT order_id FROM delivery_verifications WHERE order_id = ?",
    [orderId],
  );

  if (existing) {
    await db.run(
      `UPDATE delivery_verifications
       SET code_hash = ?, attempts = 0, verified_at = NULL, updated_at = datetime('now')
       WHERE order_id = ?`,
      [codeHash, orderId],
    );
    return;
  }

  await db.run(
    `INSERT INTO delivery_verifications (order_id, code_hash, attempts)
     VALUES (?, ?, 0)`,
    [orderId, codeHash],
  );
}

async function getDeliveryVerification(orderId) {
  const db = await getDb();
  return db.get("SELECT * FROM delivery_verifications WHERE order_id = ?", [orderId]);
}

async function incrementDeliveryAttempts(orderId) {
  const db = await getDb();
  await db.run(
    `UPDATE delivery_verifications
     SET attempts = attempts + 1, updated_at = datetime('now')
     WHERE order_id = ?`,
    [orderId],
  );
}

async function markDeliveryVerified(orderId) {
  const db = await getDb();
  await db.run(
    `UPDATE delivery_verifications
     SET verified_at = datetime('now'), updated_at = datetime('now')
     WHERE order_id = ?`,
    [orderId],
  );
}

async function resetDeliveryAttempts(orderId) {
  const db = await getDb();
  await db.run(
    `UPDATE delivery_verifications
     SET attempts = 0, updated_at = datetime('now')
     WHERE order_id = ?`,
    [orderId],
  );
}

module.exports = {
  upsertDeliveryCode,
  getDeliveryVerification,
  incrementDeliveryAttempts,
  markDeliveryVerified,
  resetDeliveryAttempts,
};
