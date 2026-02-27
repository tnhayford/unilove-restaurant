const { getDb } = require("../db/connection");

function withDateFilter(filters = {}, alias = "o") {
  const clauses = [];
  const params = [];
  if (filters.startDate) {
    clauses.push(`date(${alias}.created_at) >= date(?)`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push(`date(${alias}.created_at) <= date(?)`);
    params.push(filters.endDate);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

async function listOrdersForReport(filters = {}) {
  const db = await getDb();
  const { where, params } = withDateFilter(filters, "o");
  return db.all(
    `SELECT
      o.id,
      o.order_number,
      o.full_name,
      o.phone,
      o.delivery_type,
      o.source,
      o.status,
      o.cancel_reason,
      o.subtotal_cedis,
      GROUP_CONCAT(oi.item_name_snapshot || ' x' || oi.quantity, '; ') AS items,
      o.created_at,
      o.updated_at
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     ${where}
     GROUP BY
      o.id, o.order_number, o.full_name, o.phone, o.delivery_type, o.source,
      o.status, o.cancel_reason, o.subtotal_cedis, o.created_at, o.updated_at
     ORDER BY datetime(o.created_at) DESC`,
    params,
  );
}

async function listCustomersForReport(filters = {}) {
  const db = await getDb();
  const { where, params } = withDateFilter(filters, "o");
  return db.all(
    `SELECT
      c.id AS customer_id,
      c.full_name,
      c.phone,
      COUNT(DISTINCT o.id) AS orders_count,
      ROUND(COALESCE(SUM(o.subtotal_cedis), 0), 2) AS total_spent,
      MAX(o.created_at) AS last_order_at,
      GROUP_CONCAT(DISTINCT oi.item_name_snapshot) AS items_ordered
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     ${where}
     GROUP BY c.id, c.full_name, c.phone
     ORDER BY datetime(last_order_at) DESC`,
    params,
  );
}

module.exports = {
  listOrdersForReport,
  listCustomersForReport,
};
