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

async function listIncidents({ status, severity, searchText, limit, offset }) {
  const db = await getDb();
  const { safeLimit, safeOffset } = withPagination(limit, offset);
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push("i.status = ?");
    params.push(status);
  }
  if (severity) {
    clauses.push("i.severity = ?");
    params.push(severity);
  }

  const search = withSearch(searchText, ["i.title", "i.category", "i.summary", "i.order_id"]);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "WHERE 1=1";

  const rows = await db.all(
    `SELECT i.*, o.order_number, au.email AS owner_email, cu.email AS created_by_email
     FROM incidents i
     LEFT JOIN orders o ON o.id = i.order_id
     LEFT JOIN admin_users au ON au.id = i.owner_user_id
     LEFT JOIN admin_users cu ON cu.id = i.created_by
     ${where}
     ${search.clause}
     ORDER BY
      CASE i.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      datetime(i.updated_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, ...search.params, safeLimit, safeOffset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM incidents i
     ${where}
     ${search.clause}`,
    [...params, ...search.params],
  );

  return { rows, total: Number(totalRow?.total || 0) };
}

async function createIncident({
  title,
  severity,
  status,
  category,
  summary,
  orderId,
  ownerUserId,
  startedAt,
  details,
  createdBy,
}) {
  const db = await getDb();
  const id = uuidv4();
  await db.run(
    `INSERT INTO incidents (
      id, title, severity, status, category, summary,
      order_id, owner_user_id, started_at, details, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      severity,
      status || "open",
      category,
      summary,
      orderId || null,
      ownerUserId || null,
      startedAt || null,
      details || null,
      createdBy || null,
    ],
  );
  return getIncidentById(id);
}

async function getIncidentById(id) {
  const db = await getDb();
  return db.get(
    `SELECT i.*, o.order_number, au.email AS owner_email, cu.email AS created_by_email
     FROM incidents i
     LEFT JOIN orders o ON o.id = i.order_id
     LEFT JOIN admin_users au ON au.id = i.owner_user_id
     LEFT JOIN admin_users cu ON cu.id = i.created_by
     WHERE i.id = ?`,
    [id],
  );
}

async function updateIncident(id, patch = {}) {
  const db = await getDb();
  const current = await getIncidentById(id);
  if (!current) return null;

  const next = {
    title: patch.title ?? current.title,
    severity: patch.severity ?? current.severity,
    status: patch.status ?? current.status,
    category: patch.category ?? current.category,
    summary: patch.summary ?? current.summary,
    order_id: patch.orderId ?? current.order_id,
    owner_user_id: patch.ownerUserId ?? current.owner_user_id,
    started_at: patch.startedAt ?? current.started_at,
    details: patch.details ?? current.details,
    resolved_at:
      patch.status === "resolved"
        ? current.resolved_at || new Date().toISOString().slice(0, 19).replace("T", " ")
        : patch.status && patch.status !== "resolved"
          ? null
          : current.resolved_at,
  };

  await db.run(
    `UPDATE incidents
     SET title = ?, severity = ?, status = ?, category = ?, summary = ?,
         order_id = ?, owner_user_id = ?, started_at = ?, resolved_at = ?, details = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      next.title,
      next.severity,
      next.status,
      next.category,
      next.summary,
      next.order_id,
      next.owner_user_id,
      next.started_at,
      next.resolved_at,
      next.details,
      id,
    ],
  );

  return getIncidentById(id);
}

module.exports = {
  listIncidents,
  createIncident,
  getIncidentById,
  updateIncident,
};
