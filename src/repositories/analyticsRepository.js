const { getDb } = require("../db/connection");

function addOrderFilters({
  filters = {},
  clauses = [],
  params = [],
  alias = "",
  dateField = "created_at",
}) {
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
    clauses.push(`date(${prefix}${dateField}) >= date(?)`);
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    clauses.push(`date(${prefix}${dateField}) <= date(?)`);
    params.push(filters.endDate);
  }

  return { clauses, params };
}

function toWhere(clauses) {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

async function getDailyRevenue(filters = {}) {
  const db = await getDb();
  const clauses = [
    "payment_confirmed_at IS NOT NULL",
    "status NOT IN ('REFUNDED')",
  ];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "payment_confirmed_at",
  });

  return db.all(
    `SELECT date(payment_confirmed_at) AS day,
            ROUND(COALESCE(SUM(subtotal_cedis), 0), 2) AS revenue
     FROM orders
     ${toWhere(clauses)}
     GROUP BY date(payment_confirmed_at)
     ORDER BY day DESC
     LIMIT 31`,
    params,
  );
}

async function getMonthlyRevenue(filters = {}) {
  const db = await getDb();
  const clauses = [
    "payment_confirmed_at IS NOT NULL",
    "status NOT IN ('REFUNDED')",
  ];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "payment_confirmed_at",
  });

  return db.all(
    `SELECT strftime('%Y-%m', payment_confirmed_at) AS month,
            ROUND(COALESCE(SUM(subtotal_cedis), 0), 2) AS revenue
     FROM orders
     ${toWhere(clauses)}
     GROUP BY strftime('%Y-%m', payment_confirmed_at)
     ORDER BY month DESC
     LIMIT 12`,
    params,
  );
}

async function getTopTenItems(filters = {}) {
  const db = await getDb();
  const clauses = [
    "o.payment_confirmed_at IS NOT NULL",
    "o.status NOT IN ('REFUNDED', 'RETURNED')",
  ];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    alias: "o",
    dateField: "payment_confirmed_at",
  });

  return db.all(
    `SELECT oi.item_name_snapshot AS item,
            SUM(oi.quantity) AS quantity,
            ROUND(SUM(oi.line_total_cedis), 2) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     ${toWhere(clauses)}
     GROUP BY oi.item_name_snapshot
     ORDER BY quantity DESC, revenue DESC
     LIMIT 10`,
    params,
  );
}

async function getAverageOrderValue(filters = {}) {
  const db = await getDb();
  const clauses = [
    "payment_confirmed_at IS NOT NULL",
    "status NOT IN ('REFUNDED')",
  ];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "payment_confirmed_at",
  });

  return db.get(
    `SELECT ROUND(
        COALESCE(SUM(subtotal_cedis), 0) /
        NULLIF(COUNT(*), 0),
      2) AS average_order_value
     FROM orders
     ${toWhere(clauses)}`,
    params,
  );
}

async function getDeliverySuccessRate(filters = {}) {
  const db = await getDb();
  const clauses = ["delivery_type = 'delivery'"];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.get(
    `SELECT ROUND(
        (COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) * 100.0) /
        NULLIF(COALESCE(SUM(CASE WHEN status IN ('DELIVERED', 'RETURNED') THEN 1 ELSE 0 END), 0), 0),
      2) AS delivery_success_rate
     FROM orders
     ${toWhere(clauses)}`,
    params,
  );
}

async function getLoyaltyIssuedPerDay(filters = {}) {
  const db = await getDb();
  const clauses = ["ll.points > 0"];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    alias: "o",
    dateField: "created_at",
  });

  if (filters.startDate) {
    clauses.push("date(ll.created_at) >= date(?)");
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    clauses.push("date(ll.created_at) <= date(?)");
    params.push(filters.endDate);
  }

  return db.all(
    `SELECT date(ll.created_at) AS day,
            COALESCE(SUM(ll.points), 0) AS loyalty_points_issued
     FROM loyalty_ledger ll
     JOIN orders o ON o.id = ll.order_id
     ${toWhere(clauses)}
     GROUP BY date(ll.created_at)
     ORDER BY day DESC
     LIMIT 31`,
    params,
  );
}

async function getStatusBreakdown(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.all(
    `SELECT status, COUNT(*) AS count
     FROM orders
     ${toWhere(clauses)}
     GROUP BY status
     ORDER BY count DESC`,
    params,
  );
}

async function getSourceBreakdown(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.all(
    `SELECT source, COUNT(*) AS count
     FROM orders
     ${toWhere(clauses)}
     GROUP BY source
     ORDER BY count DESC`,
    params,
  );
}

async function getOperationalCounts(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END), 0) AS pending_payment_count,
       COALESCE(SUM(CASE WHEN status = 'PREPARING' THEN 1 ELSE 0 END), 0) AS preparing_count,
       COALESCE(SUM(CASE WHEN status IN ('PAYMENT_FAILED', 'REFUNDED', 'RETURNED') THEN 1 ELSE 0 END), 0) AS payment_issue_count,
       COALESCE(SUM(CASE WHEN status = 'DELIVERED' AND date(updated_at) = date('now') THEN 1 ELSE 0 END), 0) AS completed_today_count,
       COALESCE(SUM(CASE
         WHEN status NOT IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
           AND ((julianday(datetime('now')) - julianday(created_at)) * 24 * 60) > 30
         THEN 1
         ELSE 0
       END), 0) AS delayed_count
     FROM orders
     ${toWhere(clauses)}`,
    params,
  );
}

async function getPaymentLocationSummary(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.get(
    `SELECT
       ROUND(COALESCE(SUM(CASE
         WHEN payment_status = 'PAID'
           AND status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS collected_total,
       ROUND(COALESCE(SUM(CASE
         WHEN payment_status <> 'PAID'
           AND status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS outstanding_total,
       ROUND(COALESCE(SUM(CASE
         WHEN status = 'REFUNDED' THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS refunded_total,
       ROUND(COALESCE(SUM(CASE
         WHEN status = 'CANCELED' THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS canceled_total
     FROM orders
     ${toWhere(clauses)}`,
    params,
  );
}

async function getRevenueByPaymentChannel(filters = {}) {
  const db = await getDb();
  const clauses = [];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    dateField: "created_at",
  });

  return db.all(
    `SELECT
       source,
       delivery_type,
       payment_method,
       payment_status,
       COUNT(*) AS orders_count,
       ROUND(COALESCE(SUM(subtotal_cedis), 0), 2) AS gross_amount,
       ROUND(COALESCE(SUM(CASE
         WHEN payment_status = 'PAID'
           AND status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS collected_amount,
       ROUND(COALESCE(SUM(CASE
         WHEN payment_status <> 'PAID'
           AND status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN subtotal_cedis
         ELSE 0
       END), 0), 2) AS outstanding_amount
     FROM orders
     ${toWhere(clauses)}
     GROUP BY source, delivery_type, payment_method, payment_status
     ORDER BY source ASC, delivery_type ASC, payment_method ASC, payment_status ASC`,
    params,
  );
}

async function getCodCollectionByRider(filters = {}) {
  const db = await getDb();
  const clauses = ["o.payment_method = 'cash_on_delivery'"];
  const params = [];
  addOrderFilters({
    filters,
    clauses,
    params,
    alias: "o",
    dateField: "created_at",
  });

  return db.all(
    `SELECT
       COALESCE(o.assigned_rider_id, 'unassigned') AS rider_id,
       COALESCE(r.full_name, o.assigned_rider_id, 'Unassigned') AS rider_name,
       COUNT(*) AS cod_orders,
       ROUND(COALESCE(SUM(o.subtotal_cedis), 0), 2) AS cod_total,
       ROUND(COALESCE(SUM(CASE
         WHEN o.payment_status = 'PAID'
           AND o.status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN o.subtotal_cedis
         ELSE 0
       END), 0), 2) AS cod_collected,
       ROUND(COALESCE(SUM(CASE
         WHEN o.payment_status <> 'PAID'
           AND o.status NOT IN ('REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
         THEN o.subtotal_cedis
         ELSE 0
       END), 0), 2) AS cod_outstanding
     FROM orders o
     LEFT JOIN riders r ON r.id = o.assigned_rider_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY rider_id, rider_name
     ORDER BY cod_outstanding DESC, cod_total DESC`,
    params,
  );
}

module.exports = {
  getDailyRevenue,
  getMonthlyRevenue,
  getTopTenItems,
  getAverageOrderValue,
  getDeliverySuccessRate,
  getLoyaltyIssuedPerDay,
  getStatusBreakdown,
  getSourceBreakdown,
  getOperationalCounts,
  getPaymentLocationSummary,
  getRevenueByPaymentChannel,
  getCodCollectionByRider,
};
