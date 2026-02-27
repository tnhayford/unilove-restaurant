const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function upsertCustomer(phone, fullName) {
  const db = await getDb();
  const existing = await db.get("SELECT id FROM customers WHERE phone = ?", [phone]);

  if (existing) {
    await db.run("UPDATE customers SET full_name = ? WHERE id = ?", [fullName, existing.id]);
    return existing.id;
  }

  const id = uuidv4();
  await db.run(
    "INSERT INTO customers (id, phone, full_name) VALUES (?, ?, ?)",
    [id, phone, fullName],
  );
  return id;
}

async function searchCustomersByPhonePrefix(phonePrefix, limit = 8) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 8), 20));
  const prefix = `${String(phonePrefix || "").trim()}%`;
  return db.all(
    `SELECT c.id, c.phone, c.full_name, MAX(o.created_at) AS last_order_at
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     WHERE c.phone LIKE ?
     GROUP BY c.id, c.phone, c.full_name
     ORDER BY datetime(last_order_at) DESC
     LIMIT ?`,
    [prefix, safeLimit],
  );
}

module.exports = { upsertCustomer, searchCustomersByPhonePrefix };
