const {
  insertLoyaltyEntry,
  getTotalLoyaltyBalance,
} = require("../repositories/loyaltyRepository");
const {
  updateLoyaltyPointsIssued,
  getOrderById,
} = require("../repositories/orderRepository");
const { logSensitiveAction } = require("./auditService");
const { calculateLoyaltyPoints } = require("../utils/loyalty");

async function issueLoyaltyForPaidOrder(orderId) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Order not found for loyalty issuance");

  if (order.status === "REFUNDED" || order.status === "RETURNED") {
    return { issued: false, points: 0, reason: "ineligible_status" };
  }

  if (order.loyalty_points_issued > 0) {
    return { issued: false, points: order.loyalty_points_issued, reason: "already_issued" };
  }

  const points = calculateLoyaltyPoints(order.subtotal_cedis);
  if (points <= 0) {
    return { issued: false, points: 0, reason: "below_threshold" };
  }

  await insertLoyaltyEntry({
    customerId: order.customer_id,
    orderId: order.id,
    points,
    reason: "PAYMENT_CONFIRMED",
  });

  await updateLoyaltyPointsIssued(order.id, points);

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "LOYALTY_ISSUED",
    entityType: "order",
    entityId: order.id,
    details: { points },
  });

  return { issued: true, points };
}

async function revokeLoyaltyForOrder(orderId, reason) {
  const order = await getOrderById(orderId);
  if (!order || order.loyalty_points_issued <= 0) {
    return { revoked: false, points: 0 };
  }

  await insertLoyaltyEntry({
    customerId: order.customer_id,
    orderId: order.id,
    points: -Math.abs(order.loyalty_points_issued),
    reason,
  });

  await updateLoyaltyPointsIssued(order.id, 0);

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "LOYALTY_REVOKED",
    entityType: "order",
    entityId: order.id,
    details: { reason },
  });

  return { revoked: true, points: order.loyalty_points_issued };
}

async function getCustomerLoyaltyBalance(customerId) {
  const totalPoints = await getTotalLoyaltyBalance(customerId);
  return { totalPoints };
}

module.exports = {
  calculateLoyaltyPoints,
  issueLoyaltyForPaidOrder,
  revokeLoyaltyForOrder,
  getCustomerLoyaltyBalance,
};
