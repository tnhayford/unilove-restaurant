const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function insertSmsLog({ orderId, toPhone, message, status, providerMessageId, rawPayload }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO sms_logs (id, order_id, to_phone, message, status, provider_message_id, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      orderId || null,
      toPhone,
      message,
      status,
      providerMessageId || null,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ],
  );
}

module.exports = { insertSmsLog };
