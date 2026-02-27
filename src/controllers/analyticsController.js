const { getAnalyticsSnapshot } = require("../services/analyticsService");
const { z } = require("zod");

const analyticsQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    source: z.enum(["online", "ussd", "instore"]).optional(),
    deliveryType: z.enum(["pickup", "delivery"]).optional(),
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

async function getAnalytics(req, res) {
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const data = await getAnalyticsSnapshot(parsed.data);
  return res.json({ data });
}

module.exports = { getAnalytics };
