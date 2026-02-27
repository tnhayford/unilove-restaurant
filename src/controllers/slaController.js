const { z } = require("zod");
const {
  getSlaConfig,
  updateSlaConfig,
  getSlaBreaches,
} = require("../services/slaService");

const querySchema = z.object({
  searchText: z.string().trim().max(160).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

async function getSla(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const data = await getSlaBreaches({
    searchText: parsed.data.searchText || "",
    limit: parsed.data.limit ? Number(parsed.data.limit) : 10,
    offset: parsed.data.offset ? Number(parsed.data.offset) : 0,
  });
  return res.json({ data });
}

async function getSlaSettings(req, res) {
  const data = await getSlaConfig();
  return res.json({ data });
}

async function updateSlaSettings(req, res) {
  const data = await updateSlaConfig({
    pendingPaymentMinutes: req.validatedBody.pendingPaymentMinutes,
    kitchenMinutes: req.validatedBody.kitchenMinutes,
    deliveryMinutes: req.validatedBody.deliveryMinutes,
    actorId: req.admin.sub,
  });
  return res.json({ data });
}

module.exports = {
  getSla,
  getSlaSettings,
  updateSlaSettings,
};
