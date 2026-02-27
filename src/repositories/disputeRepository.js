const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

function withSearch(searchText, fields) {
  const value = String(searchText || "").trim();
  if (!value) return { clause: "", params: [] };
  const pattern = `%${value}%`;
  return {
    clause: `AND (${fields.map((field) => `${field} LIKE ?`).join(" OR ")})`,
    params: fields.map(() => pattern),
  };
}

function withPagination(limit, offset) {
  return {
    safeLimit: Math.max(10, Math.min(200, Number(limit || 20))),
    safeOffset: Math.max(0, Number(offset || 0)),
  };
}

async function listDisputes({ status, type, searchText, limit, offset }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = withPagination(limit, offset);
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push("d.status = ?");
    params.push(status);
  }
  if (type) {
    clauses.push("d.dispute_type = ?");
    params.push(type);
  }

  const search = withSearch(searchText, ["d.customer_phone", "d.notes", "o.order_number"]);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE 1=1";

  const rows = await db.all(
    `SELECT d.*, o.order_number, cb.email AS created_by_email, rb.email AS resolved_by_email
     FROM disputes d
     LEFT JOIN orders o ON o.id = d.order_id
     LEFT JOIN admin_users cb ON cb.id = d.created_by
     LEFT JOIN admin_users rb ON rb.id = d.resolved_by
     ${where}
     ${search.clause}
     ORDER BY datetime(d.updated_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, ...search.params, safeLimit, safeOffset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM disputes d
     LEFT JOIN orders o ON o.id = d.order_id
     ${where}
     ${search.clause}`,
    [...params, ...search.params],
  );

  return { rows, total: Number(totalRow?.total || 0) };
}

async function createDispute({
  orderId,
  customerPhone,
  disputeType,
  status,
  amountCedis,
  notes,
  createdBy,
}) {
  const db = await getDb();
  const id = uuidv4();
  await db.run(
    `INSERT INTO disputes (
      id, order_id, customer_phone, dispute_type, status,
      amount_cedis, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      orderId || null,
      customerPhone,
      disputeType,
      status || "open",
      amountCedis === undefined ? null : Number(amountCedis),
      notes,
      createdBy || null,
    ],
  );
  return getDisputeById(id);
}

async function getDisputeById(id) {
  const db = await getDb();
  return db.get(
    `SELECT d.*, o.order_number, cb.email AS created_by_email, rb.email AS resolved_by_email
     FROM disputes d
     LEFT JOIN orders o ON o.id = d.order_id
     LEFT JOIN admin_users cb ON cb.id = d.created_by
     LEFT JOIN admin_users rb ON rb.id = d.resolved_by
     WHERE d.id = ?`,
    [id],
  );
}

async function updateDispute(id, patch = {}, resolverUserId = null) {
  const db = await getDb();
  const current = await getDisputeById(id);
  if (!current) return null;

  const nextStatus = patch.status ?? current.status;
  const next = {
    order_id: patch.orderId ?? current.order_id,
    customer_phone: patch.customerPhone ?? current.customer_phone,
    dispute_type: patch.disputeType ?? current.dispute_type,
    status: nextStatus,
    amount_cedis: patch.amountCedis ?? current.amount_cedis,
    notes: patch.notes ?? current.notes,
    resolution: patch.resolution ?? current.resolution,
    resolved_by:
      ["resolved", "rejected"].includes(nextStatus)
        ? (resolverUserId || current.resolved_by)
        : null,
    resolved_at:
      ["resolved", "rejected"].includes(nextStatus)
        ? (current.resolved_at || new Date().toISOString().slice(0, 19).replace("T", " "))
        : null,
  };

  await db.run(
    `UPDATE disputes
     SET order_id = ?, customer_phone = ?, dispute_type = ?, status = ?,
         amount_cedis = ?, notes = ?, resolution = ?,
         resolved_by = ?, resolved_at = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      next.order_id,
      next.customer_phone,
      next.dispute_type,
      next.status,
      next.amount_cedis,
      next.notes,
      next.resolution,
      next.resolved_by,
      next.resolved_at,
      id,
    ],
  );

  return getDisputeById(id);
}

module.exports = {
  listDisputes,
  createDispute,
  getDisputeById,
  updateDispute,
};
