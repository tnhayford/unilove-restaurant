const { z } = require("zod");
const { ORDER_STATUS } = require("../utils/orderStatus");
const { isValidCancelReason } = require("../services/orderPolicyService");

const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .regex(/^[0-9+]+$/, "phone must contain digits and optional +");

const orderCreateSchema = z
  .object({
    phone: phoneSchema,
    fullName: z.string().trim().min(2).max(120),
    deliveryType: z.enum(["pickup", "delivery"]),
    address: z.string().trim().min(4).max(300).optional(),
    paymentMethod: z.enum(["momo", "cash_on_delivery"]).optional().default("momo"),
    items: z
      .array(
        z.object({
          itemId: z.string().trim().min(1),
          quantity: z.number().int().min(1).max(20),
        }),
      )
      .min(1),
  })
  .superRefine((value, ctx) => {
    if (value.deliveryType === "delivery" && !value.address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "address is required for delivery orders",
        path: ["address"],
      });
    }
    if (value.paymentMethod === "cash_on_delivery" && value.deliveryType !== "delivery") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cash_on_delivery is only available for delivery orders",
        path: ["paymentMethod"],
      });
    }
  });

const ussdRequestSchema = z.object({
  Type: z.enum(["Initiation", "Response", "Timeout"]),
  Message: z.string().optional().default(""),
  ServiceCode: z.string().optional().default(""),
  Operator: z.string().optional().default(""),
  ClientState: z.string().optional().default(""),
  Mobile: phoneSchema,
  SessionId: z.string().trim().min(1),
  Sequence: z.number().int().optional().nullable(),
  Platform: z.string().optional().default("USSD"),
});

const deliveryVerifySchema = z.object({
  orderId: z.string().trim().min(1),
  code: z.string().trim().regex(/^\d{6}$/),
});

const riderLoginSchema = z
  .object({
    mode: z.enum(["staff", "guest"]).optional().default("staff"),
    riderId: z.string().trim().max(80).optional(),
    riderName: z.string().trim().min(2).max(120).optional(),
    pin: z.string().trim().max(32).optional(),
    guestAccessCode: z.string().trim().max(64).optional(),
    fcmToken: z.string().trim().min(20).optional(),
    deviceId: z.string().trim().max(120).optional(),
    platform: z.string().trim().max(30).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "guest") {
      if (!value.riderName && !value.riderId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "riderName or riderId is required for guest rider login",
          path: ["riderName"],
        });
      }
      return;
    }

    if (!value.riderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "riderId is required",
        path: ["riderId"],
      });
    }
    if (!value.pin || value.pin.length < 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pin must be at least 4 digits",
        path: ["pin"],
      });
    }
  });

const riderDeviceTokenSchema = z.object({
  fcmToken: z.string().trim().min(20),
  deviceId: z.string().trim().max(120).optional(),
  platform: z.string().trim().max(30).optional(),
});

const riderShiftUpdateSchema = z.object({
  shiftStatus: z.enum(["online", "offline"]),
  note: z.string().trim().max(200).optional(),
});

const riderIncidentCreateSchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  reason: z.enum([
    "MOTOR_BREAKDOWN",
    "ACCIDENT",
    "BAD_WEATHER",
    "ROAD_BLOCK",
    "MEDICAL_EMERGENCY",
    "SECURITY_THREAT",
    "CUSTOMER_UNREACHABLE",
    "OTHER",
  ]),
  note: z.string().trim().min(6).max(500),
  location: z.string().trim().max(180).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

const adminOrderStatusUpdateSchema = z
  .object({
    status: z.enum([
      ORDER_STATUS.PAID,
      ORDER_STATUS.PREPARING,
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.READY_FOR_PICKUP,
      ORDER_STATUS.DELIVERED,
      ORDER_STATUS.RETURNED,
      ORDER_STATUS.REFUNDED,
      ORDER_STATUS.CANCELED,
      ORDER_STATUS.PAYMENT_FAILED,
    ]),
    cancelReason: z.string().trim().min(3).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === ORDER_STATUS.CANCELED && !value.cancelReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cancelReason is required when status is CANCELED",
        path: ["cancelReason"],
      });
    }
    if (value.status === ORDER_STATUS.CANCELED && value.cancelReason && !isValidCancelReason(value.cancelReason)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cancelReason must be one of the approved cancellation reasons",
        path: ["cancelReason"],
      });
    }
  });

const adminOrderAssignRiderSchema = z.object({
  riderId: z
    .string()
    .trim()
    .max(120)
    .optional()
    .nullable()
    .transform((value) => {
      const normalized = String(value || "").trim();
      return normalized || null;
    }),
});

const adminMenuAvailabilityUpdateSchema = z.object({
  isActive: z.boolean(),
});

const adminInstoreOrderSchema = z.object({
  clientReference: z.string().trim().min(6).max(80).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  deliveryType: z.enum(["pickup", "delivery"]),
  address: z.string().trim().min(4).max(300).optional(),
  paymentMethod: z.enum(["cash", "momo", "cash_on_delivery"]),
  paymentChannel: z.enum(["mtn-gh", "vodafone-gh", "tigo-gh"]).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1),
}).superRefine((value, ctx) => {
  if (value.deliveryType === "delivery" && !value.address) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "address is required for delivery orders",
      path: ["address"],
    });
  }

  if (value.paymentMethod === "momo") {
    if (!value.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "phone is required for MoMo in-store orders",
        path: ["phone"],
      });
    }
    if (!value.paymentChannel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paymentChannel is required for MoMo in-store orders",
        path: ["paymentChannel"],
      });
    }
  }

  if (value.paymentMethod === "cash_on_delivery" && value.deliveryType !== "delivery") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cash_on_delivery is only available for delivery orders",
      path: ["paymentMethod"],
    });
  }
});

const adminMomoVerificationSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema,
  paymentChannel: z.enum(["mtn-gh", "vodafone-gh", "tigo-gh"]),
});

const adminInstoreMomoRetrySchema = z.object({
  paymentChannel: z.enum(["mtn-gh", "vodafone-gh", "tigo-gh"]),
});

const adminStaffCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(256),
  role: z.enum(["admin", "manager", "cashier", "kitchen", "staff"]).default("staff"),
});

const adminStaffUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["admin", "manager", "cashier", "kitchen", "staff"]).optional(),
  password: z.string().min(8).max(256).optional(),
});

const adminStaffPermissionsUpdateSchema = z.object({
  permissions: z.record(z.string(), z.boolean()),
});

const adminOperationsPolicyUpdateSchema = z
  .object({
    smsOrderTrackingEnabled: z.boolean().optional(),
    smsOrderCompletionEnabled: z.boolean().optional(),
    smsDeliveryOtpEnabled: z.boolean().optional(),
    riderGuestLoginPolicy: z.enum(["open", "invite_only", "disabled"]).optional(),
    riderGuestAccessCode: z.string().trim().max(64).optional(),
    riderGuestCommissionPercent: z.number().min(0).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !Object.prototype.hasOwnProperty.call(value, "smsOrderTrackingEnabled") &&
      !Object.prototype.hasOwnProperty.call(value, "smsOrderCompletionEnabled") &&
      !Object.prototype.hasOwnProperty.call(value, "smsDeliveryOtpEnabled") &&
      !Object.prototype.hasOwnProperty.call(value, "riderGuestLoginPolicy") &&
      !Object.prototype.hasOwnProperty.call(value, "riderGuestAccessCode") &&
      !Object.prototype.hasOwnProperty.call(value, "riderGuestCommissionPercent")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one operations policy field must be provided",
        path: ["smsOrderTrackingEnabled"],
      });
    }
  });

const adminRiderCreateSchema = z.object({
  riderId: z.string().trim().min(2).max(60).regex(/^[a-zA-Z0-9_-]+$/),
  fullName: z.string().trim().min(2).max(120),
  pin: z.string().trim().min(4).max(32).regex(/^\d+$/, "pin must be numeric"),
  isActive: z.boolean().optional(),
});

const adminRiderUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    pin: z.string().trim().min(4).max(32).regex(/^\d+$/, "pin must be numeric").optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !Object.prototype.hasOwnProperty.call(value, "fullName") &&
      !Object.prototype.hasOwnProperty.call(value, "pin") &&
      !Object.prototype.hasOwnProperty.call(value, "isActive")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one rider field must be provided",
        path: ["fullName"],
      });
    }
  });

const adminMenuItemCreateSchema = z.object({
  category: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(180),
  priceCedis: z.number().positive().max(100000),
  ussdShortName: z.string().trim().min(2).max(80).optional(),
  ussdPriceCedis: z.number().positive().max(100000).nullable().optional(),
  ussdVisible: z.boolean().optional(),
  isActive: z.boolean().optional().default(true),
});

const adminMenuItemUpdateSchema = z.object({
  category: z.string().trim().min(2).max(80).optional(),
  name: z.string().trim().min(2).max(180).optional(),
  priceCedis: z.number().positive().max(100000).optional(),
  ussdShortName: z.string().trim().min(2).max(80).nullable().optional(),
  ussdPriceCedis: z.number().positive().max(100000).nullable().optional(),
  ussdVisible: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const adminMenuCategoryCreateSchema = z.object({
  category: z.string().trim().min(2).max(80),
});

const adminMenuCategoryRenameSchema = z.object({
  fromCategory: z.string().trim().min(2).max(80),
  toCategory: z.string().trim().min(2).max(80),
});

const adminMenuCategoryDeleteSchema = z.object({
  category: z.string().trim().min(2).max(80),
});

const adminStoreStatusUpdateSchema = z.object({
  isOpen: z.boolean(),
  closureMessage: z.string().trim().min(6).max(240).optional(),
});

const adminIncidentCreateSchema = z.object({
  title: z.string().trim().min(4).max(140),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "investigating", "resolved"]).optional(),
  category: z.string().trim().min(3).max(80),
  summary: z.string().trim().min(8).max(1000),
  orderId: z.string().trim().min(1).optional(),
  ownerUserId: z.string().trim().min(1).optional(),
  startedAt: z.string().trim().max(40).optional(),
  details: z.string().trim().max(4000).optional(),
});

const adminIncidentUpdateSchema = adminIncidentCreateSchema.partial();

const adminDisputeCreateSchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  customerPhone: phoneSchema,
  disputeType: z.string().trim().min(3).max(80),
  status: z.enum(["open", "review", "resolved", "rejected"]).optional(),
  amountCedis: z.number().min(0).max(1000000).optional(),
  notes: z.string().trim().min(6).max(2000),
});

const adminDisputeUpdateSchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  customerPhone: phoneSchema.optional(),
  disputeType: z.string().trim().min(3).max(80).optional(),
  status: z.enum(["open", "review", "resolved", "rejected"]).optional(),
  amountCedis: z.number().min(0).max(1000000).optional(),
  notes: z.string().trim().min(6).max(2000).optional(),
  resolution: z.string().trim().max(4000).optional(),
});

const adminSlaConfigUpdateSchema = z.object({
  pendingPaymentMinutes: z.number().int().min(1).max(240),
  kitchenMinutes: z.number().int().min(1).max(240),
  deliveryMinutes: z.number().int().min(1).max(240),
});

const adminUiEventSchema = z.object({
  eventType: z.enum(["button_click"]),
  targetId: z.string().trim().max(120).optional(),
  targetText: z.string().trim().max(180).optional(),
  targetClass: z.string().trim().max(200).optional(),
  pagePath: z.string().trim().max(240).optional(),
});

module.exports = {
  orderCreateSchema,
  ussdRequestSchema,
  deliveryVerifySchema,
  riderLoginSchema,
  riderDeviceTokenSchema,
  riderShiftUpdateSchema,
  riderIncidentCreateSchema,
  adminLoginSchema,
  adminOrderStatusUpdateSchema,
  adminOrderAssignRiderSchema,
  adminMenuAvailabilityUpdateSchema,
  adminInstoreOrderSchema,
  adminInstoreMomoRetrySchema,
  adminMomoVerificationSchema,
  adminStaffCreateSchema,
  adminStaffUpdateSchema,
  adminStaffPermissionsUpdateSchema,
  adminOperationsPolicyUpdateSchema,
  adminRiderCreateSchema,
  adminRiderUpdateSchema,
  adminMenuItemCreateSchema,
  adminMenuItemUpdateSchema,
  adminMenuCategoryCreateSchema,
  adminMenuCategoryRenameSchema,
  adminMenuCategoryDeleteSchema,
  adminStoreStatusUpdateSchema,
  adminIncidentCreateSchema,
  adminIncidentUpdateSchema,
  adminDisputeCreateSchema,
  adminDisputeUpdateSchema,
  adminSlaConfigUpdateSchema,
  adminUiEventSchema,
};
