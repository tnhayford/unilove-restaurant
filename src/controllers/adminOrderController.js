const {
  getOrdersForAdmin,
  getOrderHistoryForAdmin,
  getOrderDetails,
  changeOrderStatus,
  markOrderReturned,
  markOrderMonitored,
  createInStoreOrder,
  checkInStoreMomoPaymentStatus,
  retryInStoreMomoPrompt,
  assignOrderToRider,
} = require("../services/orderService");
const {
  generateDeliveryCode,
  resetDeliveryAttemptsForAdmin,
  regenerateDeliveryCodeForAdmin,
} = require("../services/deliveryService");
const { sendSms } = require("../services/smsService");
const { shouldSendCustomerSms } = require("../services/operationsPolicyService");
const { z } = require("zod");
const { ORDER_STATUS } = require("../utils/orderStatus");
const { getOrderPolicyPayload } = require("../services/orderPolicyService");

const orderHistoryQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    source: z.enum(["online", "ussd", "instore"]).optional(),
    deliveryType: z.enum(["pickup", "delivery"]).optional(),
    status: z
      .enum([
        ORDER_STATUS.PENDING_PAYMENT,
        ORDER_STATUS.PAYMENT_FAILED,
        ORDER_STATUS.PAID,
        ORDER_STATUS.PREPARING,
        ORDER_STATUS.READY_FOR_PICKUP,
        ORDER_STATUS.OUT_FOR_DELIVERY,
        ORDER_STATUS.DELIVERED,
        ORDER_STATUS.RETURNED,
        ORDER_STATUS.REFUNDED,
        ORDER_STATUS.CANCELED,
      ])
      .optional(),
    delayedOnly: z.enum(["true", "false"]).optional(),
    paymentIssueOnly: z.enum(["true", "false"]).optional(),
    searchText: z.string().trim().max(120).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    offset: z.string().regex(/^\d+$/).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate cannot be after endDate",
        path: ["startDate"],
      });
    }
  });

async function listOrders(req, res) {
  const includeItems = String(req.query.includeItems || "").trim().toLowerCase() === "true";
  const orders = await getOrdersForAdmin({ includeItems });
  return res.json({ data: orders });
}

async function getOrder(req, res) {
  const order = await getOrderDetails(req.params.orderId);
  return res.json({ data: order });
}

async function listOrderHistory(req, res) {
  const parsed = orderHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const query = parsed.data;
  const data = await getOrderHistoryForAdmin({
    startDate: query.startDate,
    endDate: query.endDate,
    source: query.source,
    deliveryType: query.deliveryType,
    status: query.status,
    delayedOnly: query.delayedOnly === "true",
    paymentIssueOnly: query.paymentIssueOnly === "true",
    searchText: query.searchText || "",
    limit: query.limit ? Number(query.limit) : 200,
    offset: query.offset ? Number(query.offset) : 0,
  });

  return res.json({ data });
}

async function monitorOrder(req, res) {
  const order = await markOrderMonitored({
    orderId: req.params.orderId,
    adminId: req.admin.sub,
  });
  return res.json({ data: order });
}

async function updateOrderStatus(req, res) {
  const { status, cancelReason } = req.validatedBody;
  const orderId = req.params.orderId;
  const permissions = req.permissions || {};

  if (status === ORDER_STATUS.CANCELED && !permissions["orders.cancel"]) {
    return res.status(403).json({ error: "Forbidden: missing permission orders.cancel" });
  }
  if (status === ORDER_STATUS.REFUNDED && !permissions["orders.refund"]) {
    return res.status(403).json({ error: "Forbidden: missing permission orders.refund" });
  }

  let updatedOrder;

  if (status === "RETURNED") {
    updatedOrder = await markOrderReturned({
      orderId,
      actorId: req.admin.sub,
    });
    return res.json({ data: updatedOrder });
  }

  updatedOrder = await changeOrderStatus({
    orderId,
    nextStatus: status,
    actorType: "admin",
    actorId: req.admin.sub,
    details: { source: "admin_dashboard", cancelReason: cancelReason || null },
    cancelReason,
  });

  if (status === "OUT_FOR_DELIVERY" && updatedOrder.delivery_type === "delivery") {
    const allowOtpSms = await shouldSendCustomerSms("delivery_otp");
    if (allowOtpSms) {
      const code = await generateDeliveryCode(orderId);
      await sendSms({
        orderId,
        toPhone: updatedOrder.phone,
        message: `Unilove: Delivery code for order ${updatedOrder.order_number} is ${code}. Share only at handover.`,
      });
    }
  }

  return res.json({ data: updatedOrder });
}

async function assignRider(req, res) {
  const data = await assignOrderToRider({
    orderId: req.params.orderId,
    riderId: req.validatedBody.riderId || null,
    actorType: "admin",
    actorId: req.admin.sub,
    details: { source: "operations_board" },
  });
  return res.json({ data });
}

async function createInstoreOrder(req, res) {
  const order = await createInStoreOrder({
    ...req.validatedBody,
    adminId: req.admin.sub,
  });
  return res.status(201).json({ data: order });
}

async function retryInstoreMomoPrompt(req, res) {
  const data = await retryInStoreMomoPrompt({
    orderId: req.params.orderId,
    paymentChannel: req.validatedBody.paymentChannel,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function statusCheckInstoreMomoPayment(req, res) {
  const data = await checkInStoreMomoPaymentStatus({
    orderId: req.params.orderId,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function getOrderPolicy(req, res) {
  return res.json({
    data: getOrderPolicyPayload(),
  });
}

async function resetDeliveryAttempts(req, res) {
  const data = await resetDeliveryAttemptsForAdmin({
    orderId: req.params.orderId,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

async function regenerateDeliveryCode(req, res) {
  const data = await regenerateDeliveryCodeForAdmin({
    orderId: req.params.orderId,
    adminId: req.admin.sub,
  });
  return res.json({ data });
}

module.exports = {
  listOrders,
  listOrderHistory,
  getOrder,
  monitorOrder,
  updateOrderStatus,
  assignRider,
  createInstoreOrder,
  statusCheckInstoreMomoPayment,
  retryInstoreMomoPrompt,
  getOrderPolicy,
  resetDeliveryAttempts,
  regenerateDeliveryCode,
};
