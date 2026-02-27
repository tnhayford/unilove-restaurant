const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function createOrder(order, dbOverride = null) {
  const db = dbOverride || (await getDb());
  await db.run(
    `INSERT INTO orders (
      id, customer_id, phone, full_name, delivery_type, address,
      status, subtotal_cedis, hubtel_session_id, client_reference,
      order_number, source, payment_method, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      order.id,
      order.customerId,
      order.phone,
      order.fullName,
      order.deliveryType,
      order.address || null,
      order.status,
      order.subtotal,
      order.hubtelSessionId || null,
      order.clientReference,
      order.orderNumber,
      order.source || "online",
      order.paymentMethod || "momo",
      order.paymentStatus || "PENDING",
    ],
  );
}

async function createOrderItems(orderId, items, dbOverride = null) {
  const db = dbOverride || (await getDb());
  for (const item of items) {
    await db.run(
      `INSERT INTO order_items (
        id, order_id, item_id, item_name_snapshot, unit_price_cedis,
        quantity, line_total_cedis
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        orderId,
        item.itemId,
        item.itemName,
        item.unitPrice,
        item.quantity,
        item.lineTotal,
      ],
    );
  }
}

async function getOrderById(orderId) {
  const db = await getDb();
  return db.get("SELECT * FROM orders WHERE id = ?", [orderId]);
}

async function getOrderByClientReference(clientReference) {
  const db = await getDb();
  return db.get("SELECT * FROM orders WHERE client_reference = ?", [clientReference]);
}

async function getOrderByOrderNumber(orderNumber) {
  const db = await getDb();
  return db.get("SELECT * FROM orders WHERE order_number = ?", [orderNumber]);
}

async function getOrderByHubtelSessionId(sessionId) {
  const db = await getDb();
  return db.get("SELECT * FROM orders WHERE hubtel_session_id = ?", [sessionId]);
}

async function listOrders(limit = 200) {
  const db = await getDb();
  const safeLimit = Math.max(20, Math.min(Number(limit || 200), 300));
  return db.all(
    `SELECT * FROM orders ORDER BY datetime(created_at) DESC LIMIT ?`,
    [safeLimit],
  );
}

async function listOutForDeliveryOrders(limit = 80) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 80), 300));
  return db.all(
    `SELECT id, order_number, full_name, phone, address, status, subtotal_cedis, assigned_rider_id, created_at, updated_at
     FROM orders
     WHERE status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')
       AND delivery_type = 'delivery'
     ORDER BY datetime(created_at) ASC
     LIMIT ?`,
    [safeLimit],
  );
}

async function listOpenDeliveryOrdersForAssignment(limit = 300) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 300), 1000));
  return db.all(
    `SELECT id, status, assigned_rider_id, created_at, updated_at
     FROM orders
     WHERE delivery_type = 'delivery'
       AND status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')
     ORDER BY datetime(created_at) ASC
     LIMIT ?`,
    [safeLimit],
  );
}

function buildOrderHistoryFilters(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.startDate) {
    clauses.push("date(created_at) >= date(?)");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push("date(created_at) <= date(?)");
    params.push(filters.endDate);
  }
  if (filters.source) {
    clauses.push("source = ?");
    params.push(filters.source);
  }
  if (filters.deliveryType) {
    clauses.push("delivery_type = ?");
    params.push(filters.deliveryType);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.searchText) {
    clauses.push("(order_number LIKE ? OR full_name LIKE ? OR phone LIKE ?)");
    const likeValue = `%${filters.searchText}%`;
    params.push(likeValue, likeValue, likeValue);
  }
      if (filters.paymentIssueOnly) {
    clauses.push("status IN ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'REFUNDED')");
  }
  if (filters.delayedOnly) {
    clauses.push(
      `(
        (julianday(CASE
          WHEN status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
            THEN updated_at
          ELSE datetime('now')
        END) - julianday(created_at)) * 24 * 60
      ) > 30`,
    );
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereClause, params };
}

async function listOrderHistory(filters = {}) {
  const db = await getDb();
  const limit = Math.max(1, Math.min(Number(filters.limit || 200), 500));
  const offset = Math.max(0, Number(filters.offset || 0));

  const { whereClause, params } = buildOrderHistoryFilters(filters);

  const rows = await db.all(
    `SELECT
       id,
       order_number,
       full_name,
       phone,
       source,
       delivery_type,
       payment_method,
       payment_status,
       status,
       cancel_reason,
       subtotal_cedis,
       loyalty_points_issued,
       payment_confirmed_at,
       ops_monitored_at,
       cancel_reason,
       created_at,
       updated_at,
       CAST(
         ROUND(
           (julianday(CASE
             WHEN status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
               THEN updated_at
             ELSE datetime('now')
           END) - julianday(created_at)) * 24 * 60
         ) AS INTEGER
       ) AS age_minutes,
       CASE
         WHEN
           ((julianday(CASE
             WHEN status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
               THEN updated_at
             ELSE datetime('now')
           END) - julianday(created_at)) * 24 * 60) > 30
         THEN 1
         ELSE 0
       END AS is_delayed
     FROM orders
     ${whereClause}
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM orders
     ${whereClause}`,
    params,
  );

  return {
    rows,
    total: totalRow?.total || 0,
  };
}

async function listPendingOrdersOlderThan(minutes) {
  const db = await getDb();
  return db.all(
    `SELECT *
     FROM orders
     WHERE status = 'PENDING_PAYMENT'
       AND payment_method = 'momo'
       AND COALESCE(payment_status, 'PENDING') = 'PENDING'
       AND datetime(created_at) <= datetime('now', ?)
     ORDER BY datetime(created_at) ASC
     LIMIT 200`,
    [`-${minutes} minutes`],
  );
}

async function getOrderItems(orderId) {
  const db = await getDb();
  return db.all(
    `SELECT item_id, item_name_snapshot, unit_price_cedis, quantity, line_total_cedis
     FROM order_items
     WHERE order_id = ?
     ORDER BY created_at ASC`,
    [orderId],
  );
}

async function updateOrderStatus(orderId, status, cancelReason = null) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET status = ?, cancel_reason = CASE WHEN ? = 'CANCELED' THEN ? ELSE cancel_reason END, updated_at = datetime('now')
     WHERE id = ?`,
    [status, status, cancelReason || null, orderId],
  );
}

async function setPaymentConfirmedAt(orderId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET payment_confirmed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [orderId],
  );
}

async function setPaymentStatus(orderId, paymentStatus, options = {}) {
  const db = await getDb();
  const normalized = String(paymentStatus || "").trim().toUpperCase();
  const allowed = new Set(["PENDING", "PAID", "FAILED"]);
  const nextStatus = allowed.has(normalized) ? normalized : "PENDING";
  const markConfirmedAt = options.markConfirmedAt === true ? 1 : 0;

  await db.run(
    `UPDATE orders
     SET payment_status = ?,
         payment_confirmed_at = CASE
           WHEN ? = 1 THEN COALESCE(payment_confirmed_at, datetime('now'))
           ELSE payment_confirmed_at
         END,
         updated_at = datetime('now')
     WHERE id = ?`,
    [nextStatus, markConfirmedAt, orderId],
  );
}

async function setReturnedRider(orderId, riderId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET returned_rider_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [riderId, orderId],
  );
}

async function setAssignedRider(orderId, riderId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET assigned_rider_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [riderId || null, orderId],
  );
}

async function setOpsMonitoredAt(orderId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET ops_monitored_at = COALESCE(ops_monitored_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?`,
    [orderId],
  );
}

async function updateLoyaltyPointsIssued(orderId, points) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET loyalty_points_issued = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [points, orderId],
  );
}

module.exports = {
  createOrder,
  createOrderItems,
  getOrderById,
  getOrderByClientReference,
  getOrderByOrderNumber,
  getOrderByHubtelSessionId,
  listOrders,
  listOutForDeliveryOrders,
  listOpenDeliveryOrdersForAssignment,
  listOrderHistory,
  listPendingOrdersOlderThan,
  getOrderItems,
  updateOrderStatus,
  setPaymentConfirmedAt,
  setPaymentStatus,
  setReturnedRider,
  setAssignedRider,
  setOpsMonitoredAt,
  updateLoyaltyPointsIssued,
};
