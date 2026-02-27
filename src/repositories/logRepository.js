const { getDb } = require("../db/connection");

function buildPagination(limit, offset) {
  const safeLimit = Math.min(500, Math.max(10, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return { safeLimit, safeOffset };
}

function buildSearchClause(searchText, fields) {
  const text = String(searchText || "").trim();
  if (!text) {
    return { clause: "", params: [] };
  }
  const pattern = `%${text}%`;
  const clause = fields.map((field) => `${field} LIKE ?`).join(" OR ");
  return {
    clause: `AND (${clause})`,
    params: fields.map(() => pattern),
  };
}

async function listAuditLogs({ limit, offset, searchText, action }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = buildPagination(limit, offset);
  const search = buildSearchClause(searchText, [
    "l.action",
    "l.actor_type",
    "l.actor_id",
    "a.email",
    "l.entity_type",
    "l.entity_id",
    "l.details",
  ]);

  const actionClause = action ? "AND l.action = ?" : "";
  const actionParams = action ? [action] : [];

  const rows = await db.all(
    `SELECT l.id, l.actor_type, l.actor_id, a.email AS actor_email, l.action, l.entity_type, l.entity_id, l.details, l.created_at
     FROM audit_logs l
     LEFT JOIN admin_users a ON a.id = l.actor_id
     WHERE 1=1
       ${actionClause}
       ${search.clause}
     ORDER BY datetime(l.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...actionParams, ...search.params, safeLimit, safeOffset],
  );
  return rows;
}

async function countAuditLogs({ searchText, action }) {
  const db = await getDb();
  const search = buildSearchClause(searchText, [
    "l.action",
    "l.actor_type",
    "l.actor_id",
    "a.email",
    "l.entity_type",
    "l.entity_id",
    "l.details",
  ]);
  const actionClause = action ? "AND l.action = ?" : "";
  const actionParams = action ? [action] : [];

  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM audit_logs l
     LEFT JOIN admin_users a ON a.id = l.actor_id
     WHERE 1=1
       ${actionClause}
       ${search.clause}`,
    [...actionParams, ...search.params],
  );
  return Number(row?.total || 0);
}

async function listSmsLogs({ limit, offset, searchText, status }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = buildPagination(limit, offset);
  const search = buildSearchClause(searchText, ["to_phone", "message", "status", "order_id"]);
  const statusClause = status ? "AND status = ?" : "";
  const statusParams = status ? [status] : [];

  const rows = await db.all(
    `SELECT id, order_id, to_phone, message, status, provider_message_id, raw_payload, created_at
     FROM sms_logs
     WHERE 1=1
       ${statusClause}
       ${search.clause}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...statusParams, ...search.params, safeLimit, safeOffset],
  );
  return rows;
}

async function countSmsLogs({ searchText, status }) {
  const db = await getDb();
  const search = buildSearchClause(searchText, ["to_phone", "message", "status", "order_id"]);
  const statusClause = status ? "AND status = ?" : "";
  const statusParams = status ? [status] : [];
  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM sms_logs
     WHERE 1=1
       ${statusClause}
       ${search.clause}`,
    [...statusParams, ...search.params],
  );
  return Number(row?.total || 0);
}

async function listPaymentLogs({ limit, offset, searchText, status }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = buildPagination(limit, offset);
  const search = buildSearchClause(searchText, [
    "p.client_reference",
    "p.hubtel_transaction_id",
    "p.external_transaction_id",
    "p.status",
    "o.order_number",
    "o.phone",
    "o.full_name",
  ]);
  const statusClause = status ? "AND p.status = ?" : "";
  const statusParams = status ? [status] : [];

  const rows = await db.all(
    `SELECT
       p.id,
       p.order_id,
       o.order_number,
       o.phone,
       o.full_name,
       p.client_reference,
       p.hubtel_transaction_id,
       p.external_transaction_id,
       p.response_code,
       p.status,
       p.amount,
       p.charges,
       p.amount_after_charges,
       p.amount_charged,
       p.raw_payload,
       p.created_at
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE 1=1
       ${statusClause}
       ${search.clause}
     ORDER BY datetime(p.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...statusParams, ...search.params, safeLimit, safeOffset],
  );
  return rows;
}

async function countPaymentLogs({ searchText, status }) {
  const db = await getDb();
  const search = buildSearchClause(searchText, [
    "p.client_reference",
    "p.hubtel_transaction_id",
    "p.external_transaction_id",
    "p.status",
    "o.order_number",
    "o.phone",
    "o.full_name",
  ]);
  const statusClause = status ? "AND p.status = ?" : "";
  const statusParams = status ? [status] : [];

  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE 1=1
       ${statusClause}
       ${search.clause}`,
    [...statusParams, ...search.params],
  );
  return Number(row?.total || 0);
}

async function listErrorLogs({ limit, offset, searchText, level }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = buildPagination(limit, offset);
  const search = buildSearchClause(searchText, [
    "message",
    "stack",
    "route",
    "method",
    "request_id",
  ]);
  const levelClause = level ? "AND level = ?" : "";
  const levelParams = level ? [level] : [];

  const rows = await db.all(
    `SELECT id, level, message, stack, route, method, status_code, request_id, created_at
     FROM error_logs
     WHERE 1=1
       ${levelClause}
       ${search.clause}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...levelParams, ...search.params, safeLimit, safeOffset],
  );
  return rows;
}

async function countErrorLogs({ searchText, level }) {
  const db = await getDb();
  const search = buildSearchClause(searchText, [
    "message",
    "stack",
    "route",
    "method",
    "request_id",
  ]);
  const levelClause = level ? "AND level = ?" : "";
  const levelParams = level ? [level] : [];

  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM error_logs
     WHERE 1=1
       ${levelClause}
       ${search.clause}`,
    [...levelParams, ...search.params],
  );
  return Number(row?.total || 0);
}

module.exports = {
  listAuditLogs,
  countAuditLogs,
  listSmsLogs,
  countSmsLogs,
  listPaymentLogs,
  countPaymentLogs,
  listErrorLogs,
  countErrorLogs,
};
