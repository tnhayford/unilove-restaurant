const { z } = require("zod");
const {
  listDisputeCases,
  createDisputeCase,
  updateDisputeCase,
} = require("../services/disputeService");

const querySchema = z.object({
  status: z.enum(["open", "review", "resolved", "rejected"]).optional(),
  type: z.string().trim().max(80).optional(),
  searchText: z.string().trim().max(160).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

async function listDisputes(req, res) {
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

  const query = parsed.data;
  const data = await listDisputeCases({
    status: query.status,
    type: query.type,
    searchText: query.searchText || "",
    limit: query.limit ? Number(query.limit) : 10,
    offset: query.offset ? Number(query.offset) : 0,
  });

  return res.json({ data });
}

async function createDispute(req, res) {
  const created = await createDisputeCase({
    orderId: req.validatedBody.orderId,
    customerPhone: req.validatedBody.customerPhone,
    disputeType: req.validatedBody.disputeType,
    status: req.validatedBody.status || "open",
    amountCedis: req.validatedBody.amountCedis,
    notes: req.validatedBody.notes,
    createdBy: req.admin.sub,
  });
  return res.status(201).json({ data: created });
}

async function updateDispute(req, res) {
  const updated = await updateDisputeCase({
    disputeId: req.params.disputeId,
    patch: {
      orderId: req.validatedBody.orderId,
      customerPhone: req.validatedBody.customerPhone,
      disputeType: req.validatedBody.disputeType,
      status: req.validatedBody.status,
      amountCedis: req.validatedBody.amountCedis,
      notes: req.validatedBody.notes,
      resolution: req.validatedBody.resolution,
    },
    actorId: req.admin.sub,
  });
  return res.json({ data: updated });
}

module.exports = {
  listDisputes,
  createDispute,
  updateDispute,
};
