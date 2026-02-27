const { getDb } = require("../db/connection");

async function listSlaBreaches({ pendingMinutes, kitchenMinutes, deliveryMinutes, searchText, limit, offset }) {
  const db = await getDb();
  const safeLimit = Math.max(10, Math.min(200, Number(limit || 20)));
  const safeOffset = Math.max(0, Number(offset || 0));

  const query = String(searchText || "").trim();
  const searchParams = [];
  let searchClause = "";
  if (query) {
    const pattern = `%${query}%`;
    searchClause = "AND (o.order_number LIKE ? OR o.full_name LIKE ? OR o.phone LIKE ?)";
    searchParams.push(pattern, pattern, pattern);
  }

  const rows = await db.all(
    `SELECT
      o.id,
      o.order_number,
      o.full_name,
      o.phone,
      o.delivery_type,
      o.source,
      o.status,
      o.subtotal_cedis,
      o.created_at,
      o.updated_at,
      CAST(ROUND((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) AS INTEGER) AS age_minutes,
      CASE
        WHEN o.status = 'PENDING_PAYMENT' THEN ?
        WHEN o.status IN ('PAID', 'PREPARING') THEN ?
        WHEN o.status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY') THEN ?
        ELSE NULL
      END AS sla_target_minutes
     FROM orders o
     WHERE o.status IN ('PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')
       AND (
        (o.status = 'PENDING_PAYMENT' AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
        OR (o.status IN ('PAID', 'PREPARING') AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
        OR (o.status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY') AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
       )
       ${searchClause}
     ORDER BY datetime(o.created_at) ASC
     LIMIT ? OFFSET ?`,
    [
      pendingMinutes,
      kitchenMinutes,
      deliveryMinutes,
      pendingMinutes,
      kitchenMinutes,
      deliveryMinutes,
      ...searchParams,
      safeLimit,
      safeOffset,
    ],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM orders o
     WHERE o.status IN ('PENDING_PAYMENT', 'PAID', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')
       AND (
        (o.status = 'PENDING_PAYMENT' AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
        OR (o.status IN ('PAID', 'PREPARING') AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
        OR (o.status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY') AND ((julianday(datetime('now')) - julianday(o.created_at)) * 24 * 60) > ?)
       )
       ${searchClause}`,
    [pendingMinutes, kitchenMinutes, deliveryMinutes, ...searchParams],
  );

  return { rows, total: Number(totalRow?.total || 0) };
}

module.exports = {
  listSlaBreaches,
};
