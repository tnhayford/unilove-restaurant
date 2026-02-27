const bcrypt = require("bcryptjs");
const {
  upsertDeliveryCode,
  getDeliveryVerification,
  incrementDeliveryAttempts,
  markDeliveryVerified,
  resetDeliveryAttempts,
} = require("../repositories/deliveryRepository");
const { ensureOrder, changeOrderStatus } = require("./orderService");
const { randomDigits } = require("../utils/security");
const { ORDER_STATUS } = require("../utils/orderStatus");
const { logSensitiveAction } = require("./auditService");
const { sendSms } = require("./smsService");
const { shouldSendCustomerSms } = require("./operationsPolicyService");

const MAX_ATTEMPTS = 3;

async function generateDeliveryCode(orderId) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Delivery code applies to delivery orders only"), {
      statusCode: 400,
    });
  }

  const code = randomDigits(6);
  const hash = await bcrypt.hash(code, 10);
  await upsertDeliveryCode(orderId, hash);

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "DELIVERY_CODE_GENERATED",
    entityType: "order",
    entityId: orderId,
    details: null,
  });

  return code;
}

async function verifyDeliveryCode({ orderId, code, riderId }) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Order is not a delivery order"), { statusCode: 400 });
  }

  if (order.status !== ORDER_STATUS.OUT_FOR_DELIVERY) {
    throw Object.assign(
      new Error("Order must be OUT_FOR_DELIVERY before completion"),
      { statusCode: 400 },
    );
  }

  const record = await getDeliveryVerification(orderId);
  if (!record) {
    throw Object.assign(new Error("Delivery code not generated for this order"), {
      statusCode: 404,
    });
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await logSensitiveAction({
      actorType: "rider",
      actorId: riderId || null,
      action: "DELIVERY_CODE_LOCKED",
      entityType: "order",
      entityId: orderId,
      details: { attempts: record.attempts },
    });

    throw Object.assign(new Error("Maximum verification attempts exceeded"), {
      statusCode: 429,
    });
  }

  const valid = await bcrypt.compare(code, record.code_hash);
  if (!valid) {
    await incrementDeliveryAttempts(orderId);

    await logSensitiveAction({
      actorType: "rider",
      actorId: riderId || null,
      action: "DELIVERY_CODE_FAILED",
      entityType: "order",
      entityId: orderId,
      details: { attempt: record.attempts + 1 },
    });

    const updated = await getDeliveryVerification(orderId);
    return {
      success: false,
      attempts: updated.attempts,
      attemptsRemaining: Math.max(MAX_ATTEMPTS - updated.attempts, 0),
    };
  }

  await markDeliveryVerified(orderId);
  await changeOrderStatus({
    orderId,
    nextStatus: ORDER_STATUS.DELIVERED,
    actorType: "rider",
    actorId: riderId || null,
    details: { deliveryCodeVerified: true },
  });

  await logSensitiveAction({
    actorType: "rider",
    actorId: riderId || null,
    action: "DELIVERY_CODE_VERIFIED",
    entityType: "order",
    entityId: orderId,
    details: null,
  });

  return {
    success: true,
    attempts: record.attempts,
    attemptsRemaining: Math.max(MAX_ATTEMPTS - record.attempts, 0),
  };
}

async function resetDeliveryAttemptsForAdmin({ orderId, adminId }) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Delivery code reset applies to delivery orders only"), {
      statusCode: 400,
    });
  }
  if (
    order.status !== ORDER_STATUS.OUT_FOR_DELIVERY &&
    order.status !== ORDER_STATUS.READY_FOR_PICKUP
  ) {
    throw Object.assign(
      new Error("Order must be READY_FOR_PICKUP or OUT_FOR_DELIVERY to reset OTP attempts"),
      { statusCode: 400 },
    );
  }

  const record = await getDeliveryVerification(orderId);
  if (!record) {
    throw Object.assign(new Error("Delivery code not generated for this order"), {
      statusCode: 404,
    });
  }

  await resetDeliveryAttempts(orderId);
  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId || null,
    action: "DELIVERY_ATTEMPTS_RESET",
    entityType: "order",
    entityId: orderId,
    details: { previousAttempts: record.attempts },
  });

  return {
    orderId,
    orderNumber: order.order_number,
    attempts: 0,
    attemptsRemaining: MAX_ATTEMPTS,
  };
}

async function regenerateDeliveryCodeForAdmin({ orderId, adminId }) {
  const order = await ensureOrder(orderId);
  if (order.delivery_type !== "delivery") {
    throw Object.assign(new Error("Delivery code applies to delivery orders only"), {
      statusCode: 400,
    });
  }
  if (
    order.status !== ORDER_STATUS.OUT_FOR_DELIVERY &&
    order.status !== ORDER_STATUS.READY_FOR_PICKUP
  ) {
    throw Object.assign(
      new Error("Order must be READY_FOR_PICKUP or OUT_FOR_DELIVERY to regenerate OTP"),
      { statusCode: 400 },
    );
  }

  const allowOtpSms = await shouldSendCustomerSms("delivery_otp");
  if (!allowOtpSms) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "DELIVERY_CODE_REGEN_SKIPPED_POLICY",
      entityType: "order",
      entityId: orderId,
      details: { policy: "sms_delivery_otp_enabled=false" },
    });
    return {
      orderId,
      orderNumber: order.order_number,
      sent: false,
      reason: "sms_policy_disabled",
    };
  }

  const code = await generateDeliveryCode(orderId);
  await sendSms({
    orderId,
    toPhone: order.phone,
    message: `Unilove: Delivery code for order ${order.order_number} is ${code}. Share only at handover.`,
  });

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId || null,
    action: "DELIVERY_CODE_REGENERATED",
    entityType: "order",
    entityId: orderId,
    details: null,
  });

  return {
    orderId,
    orderNumber: order.order_number,
    sent: true,
    reason: null,
  };
}

module.exports = {
  MAX_ATTEMPTS,
  generateDeliveryCode,
  verifyDeliveryCode,
  resetDeliveryAttemptsForAdmin,
  regenerateDeliveryCodeForAdmin,
};
