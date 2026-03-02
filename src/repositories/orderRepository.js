const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

const ORDER_SELECT_WITH_STAFF = `
  o.*,
  cashier.email AS cashier_admin_email,
  cashier.full_name AS cashier_admin_name,
  kitchen_accept.email AS kitchen_accepted_admin_email,
  kitchen_accept.full_name AS kitchen_accepted_admin_name,
  kitchen_ready.email AS kitchen_ready_admin_email,
  kitchen_ready.full_name AS kitchen_ready_admin_name,
  completed_admin.email AS completed_by_admin_email,
  completed_admin.full_name AS completed_by_admin_name
`;

const ORDER_STAFF_JOINS = `
  LEFT JOIN admin_users cashier ON cashier.id = o.cashier_admin_id
  LEFT JOIN admin_users kitchen_accept ON kitchen_accept.id = o.kitchen_accepted_by_admin_id
  LEFT JOIN admin_users kitchen_ready ON kitchen_ready.id = o.kitchen_ready_by_admin_id
  LEFT JOIN admin_users completed_admin ON completed_admin.id = o.completed_by_admin_id
`;

async function createOrder(order, dbOverride = null) {
  const db = dbOverride || (await getDb());
  await db.run(
    `INSERT INTO orders (
      id, customer_id, phone, full_name, delivery_type, address,
      status, subtotal_cedis, hubtel_session_id, client_reference,
      order_number, source, payment_method, payment_status,
      cashier_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
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
      order.cashierAdminId || null,
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
  return db.get(
    `SELECT ${ORDER_SELECT_WITH_STAFF}
     FROM orders o
     ${ORDER_STAFF_JOINS}
     WHERE o.id = ?`,
    [orderId],
  );
}

async function getOrderByClientReference(clientReference) {
  const db = await getDb();
  return db.get(
    `SELECT ${ORDER_SELECT_WITH_STAFF}
     FROM orders o
     ${ORDER_STAFF_JOINS}
     WHERE o.client_reference = ?`,
    [clientReference],
  );
}

async function getOrderByOrderNumber(orderNumber) {
  const db = await getDb();
  return db.get(
    `SELECT ${ORDER_SELECT_WITH_STAFF}
     FROM orders o
     ${ORDER_STAFF_JOINS}
     WHERE o.order_number = ?`,
    [orderNumber],
  );
}

async function getOrderByHubtelSessionId(sessionId) {
  const db = await getDb();
  return db.get(
    `SELECT ${ORDER_SELECT_WITH_STAFF}
     FROM orders o
     ${ORDER_STAFF_JOINS}
     WHERE o.hubtel_session_id = ?`,
    [sessionId],
  );
}

async function listOrders(limit = 200) {
  const db = await getDb();
  const safeLimit = Math.max(20, Math.min(Number(limit || 200), 300));
  return db.all(
    `SELECT ${ORDER_SELECT_WITH_STAFF}
     FROM orders o
     ${ORDER_STAFF_JOINS}
     ORDER BY datetime(o.created_at) DESC
     LIMIT ?`,
    [safeLimit],
  );
}

async function listOutForDeliveryOrders(limit = 80) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 80), 300));
  return db.all(
    `SELECT id, order_number, full_name, phone, address, status, subtotal_cedis, assigned_rider_id, payment_method, payment_status, source, created_at, updated_at
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
    clauses.push("date(o.created_at) >= date(?)");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push("date(o.created_at) <= date(?)");
    params.push(filters.endDate);
  }
  if (filters.source) {
    clauses.push("o.source = ?");
    params.push(filters.source);
  }
  if (filters.deliveryType) {
    clauses.push("o.delivery_type = ?");
    params.push(filters.deliveryType);
  }
  if (filters.status) {
    clauses.push("o.status = ?");
    params.push(filters.status);
  }
  if (filters.searchText) {
    clauses.push("(o.order_number LIKE ? OR o.full_name LIKE ? OR o.phone LIKE ?)");
    const likeValue = `%${filters.searchText}%`;
    params.push(likeValue, likeValue, likeValue);
  }
  if (filters.paymentIssueOnly) {
    clauses.push("o.status IN ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'REFUNDED')");
  }
  if (filters.delayedOnly) {
    clauses.push(
      `(
        (julianday(CASE
          WHEN o.status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
            THEN o.updated_at
          ELSE datetime('now')
        END) - julianday(o.created_at)) * 24 * 60
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
       o.id,
       o.order_number,
       o.full_name,
       o.phone,
       o.source,
       o.delivery_type,
       o.payment_method,
       o.payment_status,
       o.status,
       o.cancel_reason,
       o.subtotal_cedis,
       o.loyalty_points_issued,
       o.payment_confirmed_at,
       o.ops_monitored_at,
       o.cancel_reason,
       o.created_at,
       o.updated_at,
       o.cashier_admin_id,
       o.kitchen_accepted_by_admin_id,
       o.kitchen_accepted_at,
       o.kitchen_ready_by_admin_id,
       o.kitchen_ready_at,
       o.completed_by_admin_id,
       o.completed_by_rider_id,
       cashier.email AS cashier_admin_email,
       cashier.full_name AS cashier_admin_name,
       kitchen_accept.email AS kitchen_accepted_admin_email,
       kitchen_accept.full_name AS kitchen_accepted_admin_name,
       kitchen_ready.email AS kitchen_ready_admin_email,
       kitchen_ready.full_name AS kitchen_ready_admin_name,
       completed_admin.email AS completed_by_admin_email,
       completed_admin.full_name AS completed_by_admin_name,
       CAST(
         ROUND(
           (julianday(CASE
             WHEN o.status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
               THEN o.updated_at
             ELSE datetime('now')
           END) - julianday(o.created_at)) * 24 * 60
         ) AS INTEGER
       ) AS age_minutes,
       CASE
         WHEN
           ((julianday(CASE
             WHEN o.status IN ('DELIVERED', 'RETURNED', 'REFUNDED', 'CANCELED', 'PAYMENT_FAILED')
               THEN o.updated_at
             ELSE datetime('now')
           END) - julianday(o.created_at)) * 24 * 60) > 30
         THEN 1
         ELSE 0
       END AS is_delayed
     FROM orders o
     LEFT JOIN admin_users cashier ON cashier.id = o.cashier_admin_id
     LEFT JOIN admin_users kitchen_accept ON kitchen_accept.id = o.kitchen_accepted_by_admin_id
     LEFT JOIN admin_users kitchen_ready ON kitchen_ready.id = o.kitchen_ready_by_admin_id
     LEFT JOIN admin_users completed_admin ON completed_admin.id = o.completed_by_admin_id
     ${whereClause}
     ORDER BY datetime(o.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM orders o
     ${whereClause}`,
    params,
  );

  return {
    rows,
    total: totalRow?.total || 0,
  };
}

async function listPendingOrdersOlderThan(minutes, limit = 200) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 500));
  return db.all(
    `SELECT *
     FROM orders
     WHERE status = 'PENDING_PAYMENT'
       AND payment_method = 'momo'
       AND COALESCE(payment_status, 'PENDING') = 'PENDING'
       AND datetime(created_at) <= datetime('now', ?)
     ORDER BY datetime(created_at) ASC
     LIMIT ?`,
    [`-${minutes} minutes`, safeLimit],
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

async function setCashierAdmin(orderId, adminId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET cashier_admin_id = COALESCE(cashier_admin_id, ?),
         updated_at = datetime('now')
     WHERE id = ?`,
    [adminId || null, orderId],
  );
}

async function setKitchenAccepted(orderId, adminId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET kitchen_accepted_by_admin_id = COALESCE(kitchen_accepted_by_admin_id, ?),
         kitchen_accepted_at = COALESCE(kitchen_accepted_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?`,
    [adminId || null, orderId],
  );
}

async function setKitchenReady(orderId, adminId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET kitchen_ready_by_admin_id = COALESCE(kitchen_ready_by_admin_id, ?),
         kitchen_ready_at = COALESCE(kitchen_ready_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?`,
    [adminId || null, orderId],
  );
}

async function setCompletedByAdmin(orderId, adminId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET completed_by_admin_id = COALESCE(completed_by_admin_id, ?),
         updated_at = datetime('now')
     WHERE id = ?`,
    [adminId || null, orderId],
  );
}

async function setCompletedByRider(orderId, riderId) {
  const db = await getDb();
  await db.run(
    `UPDATE orders
     SET completed_by_rider_id = COALESCE(completed_by_rider_id, ?),
         updated_at = datetime('now')
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
  setCashierAdmin,
  setKitchenAccepted,
  setKitchenReady,
  setCompletedByAdmin,
  setCompletedByRider,
  setOpsMonitoredAt,
  updateLoyaltyPointsIssued,
};
