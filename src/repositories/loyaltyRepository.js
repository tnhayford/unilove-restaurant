const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function insertLoyaltyEntry({ customerId, orderId, points, reason }) {
  const db = await getDb();
  const id = uuidv4();
  await db.run(
    `INSERT INTO loyalty_ledger (id, customer_id, order_id, points, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [id, customerId, orderId, points, reason],
  );
  return id;
}

async function getTotalLoyaltyBalance(customerId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT COALESCE(SUM(points), 0) AS total_points
     FROM loyalty_ledger
     WHERE customer_id = ?`,
    [customerId],
  );
  return row?.total_points || 0;
}

function addOrderFilters({ filters = {}, clauses = [], params = [], alias = "o" }) {
  const prefix = alias ? `${alias}.` : "";
  if (filters.source) {
    clauses.push(`${prefix}source = ?`);
    params.push(filters.source);
  }
  if (filters.deliveryType) {
    clauses.push(`${prefix}delivery_type = ?`);
    params.push(filters.deliveryType);
  }
  if (filters.startDate) {
    clauses.push(`date(ll.created_at) >= date(?)`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push(`date(ll.created_at) <= date(?)`);
    params.push(filters.endDate);
  }
  return { clauses, params };
}

function toWhere(clauses) {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

async function getLoyaltySummary(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({ filters, clauses, params, alias: "o" });

  const row = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN ll.points > 0 THEN ll.points ELSE 0 END), 0) AS issued_points,
       COALESCE(SUM(CASE WHEN ll.points < 0 THEN ABS(ll.points) ELSE 0 END), 0) AS reversed_points,
       COALESCE(SUM(ll.points), 0) AS net_points,
       COALESCE(COUNT(DISTINCT CASE WHEN ll.points > 0 THEN ll.order_id END), 0) AS rewarded_orders,
       COALESCE(COUNT(DISTINCT CASE WHEN ll.points < 0 THEN ll.order_id END), 0) AS reversed_orders
     FROM loyalty_ledger ll
     JOIN orders o ON o.id = ll.order_id
     ${toWhere(clauses)}`,
    params,
  );

  return {
    issuedPoints: Number(row?.issued_points || 0),
    reversedPoints: Number(row?.reversed_points || 0),
    netPoints: Number(row?.net_points || 0),
    rewardedOrders: Number(row?.rewarded_orders || 0),
    reversedOrders: Number(row?.reversed_orders || 0),
  };
}

async function listLoyaltyLedger(filters = {}) {
  const db = await getDb();
  const limit = Math.max(1, Math.min(Number(filters.limit || 25), 200));
  const offset = Math.max(0, Number(filters.offset || 0));

  const clauses = [];
  const params = [];
  addOrderFilters({ filters, clauses, params, alias: "o" });

  if (filters.reason) {
    clauses.push("ll.reason = ?");
    params.push(filters.reason);
  }

  if (filters.searchText) {
    clauses.push(
      "(o.order_number LIKE ? OR o.phone LIKE ? OR o.full_name LIKE ? OR c.full_name LIKE ?)",
    );
    const pattern = `%${filters.searchText}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = await db.all(
    `SELECT
       ll.id,
       ll.order_id,
       o.order_number,
       o.phone,
       o.full_name,
       o.source,
       o.delivery_type,
       ll.points,
       ll.reason,
       ll.created_at
     FROM loyalty_ledger ll
     JOIN orders o ON o.id = ll.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     ${toWhere(clauses)}
     ORDER BY datetime(ll.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM loyalty_ledger ll
     JOIN orders o ON o.id = ll.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     ${toWhere(clauses)}`,
    params,
  );

  return {
    rows,
    total: Number(totalRow?.total || 0),
  };
}

module.exports = {
  insertLoyaltyEntry,
  getTotalLoyaltyBalance,
  getLoyaltySummary,
  listLoyaltyLedger,
};
