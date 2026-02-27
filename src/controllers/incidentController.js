const { z } = require("zod");
const {
  listIncidentCases,
  createIncidentCase,
  updateIncidentCase,
} = require("../services/incidentService");

const querySchema = z.object({
  status: z.enum(["open", "investigating", "resolved"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  searchText: z.string().trim().max(160).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

async function listIncidents(req, res) {
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
  const data = await listIncidentCases({
    status: query.status,
    severity: query.severity,
    searchText: query.searchText || "",
    limit: query.limit ? Number(query.limit) : 10,
    offset: query.offset ? Number(query.offset) : 0,
  });

  return res.json({ data });
}

async function createIncident(req, res) {
  const created = await createIncidentCase({
    title: req.validatedBody.title,
    severity: req.validatedBody.severity,
    status: req.validatedBody.status || "open",
    category: req.validatedBody.category,
    summary: req.validatedBody.summary,
    orderId: req.validatedBody.orderId,
    ownerUserId: req.validatedBody.ownerUserId,
    startedAt: req.validatedBody.startedAt,
    details: req.validatedBody.details,
    createdBy: req.admin.sub,
  });
  return res.status(201).json({ data: created });
}

async function updateIncident(req, res) {
  const updated = await updateIncidentCase({
    incidentId: req.params.incidentId,
    patch: {
      title: req.validatedBody.title,
      severity: req.validatedBody.severity,
      status: req.validatedBody.status,
      category: req.validatedBody.category,
      summary: req.validatedBody.summary,
      orderId: req.validatedBody.orderId,
      ownerUserId: req.validatedBody.ownerUserId,
      startedAt: req.validatedBody.startedAt,
      details: req.validatedBody.details,
    },
    actorId: req.admin.sub,
  });
  return res.json({ data: updated });
}

module.exports = {
  listIncidents,
  createIncident,
  updateIncident,
};
