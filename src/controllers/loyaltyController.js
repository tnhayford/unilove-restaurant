const { z } = require("zod");
const { getLoyaltyOpsSnapshot } = require("../services/loyaltyOpsService");

const loyaltyQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    source: z.enum(["online", "ussd", "instore"]).optional(),
    deliveryType: z.enum(["pickup", "delivery"]).optional(),
    reason: z
      .enum(["PAYMENT_CONFIRMED", "RETURNED", "REFUNDED"])
      .optional(),
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

async function getLoyaltyOps(req, res) {
  const parsed = loyaltyQuerySchema.safeParse(req.query);
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
  const data = await getLoyaltyOpsSnapshot({
    startDate: query.startDate,
    endDate: query.endDate,
    source: query.source,
    deliveryType: query.deliveryType,
    reason: query.reason,
    searchText: query.searchText || "",
    limit: query.limit ? Number(query.limit) : 25,
    offset: query.offset ? Number(query.offset) : 0,
  });

  return res.json({ data });
}

module.exports = {
  getLoyaltyOps,
};
