const { ORDER_STATUS } = require("../utils/orderStatus");

const CANCEL_REASONS = [
  "Wrong order selection",
  "Customer changed mind",
  "Waiting time too long",
  "Failed payment",
  "Duplicate order",
  "Item unavailable",
  "Kitchen unable to fulfill",
  "Store closed",
  "Address/phone issue",
  "Delivery area not covered",
  "Fraud suspicion",
  "Customer unreachable",
  "Price dispute",
  "System timeout/session expired",
  "Other operational reason",
];

function getCancelReasons() {
  return [...CANCEL_REASONS];
}

function isValidCancelReason(reason) {
  const normalized = String(reason || "").trim();
  return normalized.length > 0 && CANCEL_REASONS.includes(normalized);
}

function canIssueRefund(order) {
  if (!order) return false;
  if (order.status === ORDER_STATUS.RETURNED) return true;
  if (order.status === ORDER_STATUS.CANCELED && order.payment_confirmed_at) return true;
  return false;
}

function getRefundPolicySummary() {
  return [
    "Refund is allowed after RETURNED orders.",
    "Refund is also allowed for CANCELED orders only if payment was already confirmed.",
    "Refund is blocked for unpaid cancellations and delivered orders.",
  ];
}

function getOrderPolicyPayload() {
  return {
    cancelReasons: getCancelReasons(),
    refundPolicy: getRefundPolicySummary(),
  };
}

module.exports = {
  getCancelReasons,
  isValidCancelReason,
  canIssueRefund,
  getRefundPolicySummary,
  getOrderPolicyPayload,
};
