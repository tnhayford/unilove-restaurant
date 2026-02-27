const path = require("path");
const fs = require("fs");
const { z } = require("zod");
const {
  queueReport,
  getReportJobById,
  listReportJobs,
  createScheduledReport,
  listScheduledReports,
  updateScheduledReport,
  deleteScheduledReport,
} = require("../services/reportService");

const listQuerySchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

const createSchema = z.object({
  type: z.enum(["orders", "customers"]),
  format: z.enum(["json", "excel", "pdf"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const scheduleCreateSchema = z
  .object({
    type: z.enum(["orders", "customers"]),
    format: z.enum(["json", "excel", "pdf"]),
    frequency: z.enum(["daily", "weekly"]),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    hourUtc: z.number().int().min(0).max(23).default(2),
    minuteUtc: z.number().int().min(0).max(59).default(0),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === "weekly" && value.dayOfWeek === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "dayOfWeek is required for weekly schedules",
      });
    }
  });

const scheduleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly"]).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  hourUtc: z.number().int().min(0).max(23).optional(),
  minuteUtc: z.number().int().min(0).max(59).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const scheduleListQuerySchema = z.object({
  enabled: z.enum(["true", "false"]).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

async function createReport(req, res) {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const body = parsed.data;
  if (body.type === "customers" && !(req.permissions || {})["customers.export"]) {
    return res.status(403).json({ error: "Forbidden: missing permission customers.export" });
  }
  const job = await queueReport({
    type: body.type,
    format: body.format,
    requestedBy: req.admin.sub,
    filters: {
      startDate: body.startDate,
      endDate: body.endDate,
    },
  });

  return res.status(202).json({ data: job });
}

async function listReports(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const q = parsed.data;
  const data = await listReportJobs({
    status: q.status,
    limit: q.limit ? Number(q.limit) : 20,
    offset: q.offset ? Number(q.offset) : 0,
  });
  return res.json({ data });
}

async function getReport(req, res) {
  const job = await getReportJobById(req.params.reportId);
  if (!job) {
    return res.status(404).json({ error: "Report not found" });
  }
  return res.json({ data: job });
}

async function downloadReport(req, res) {
  const job = await getReportJobById(req.params.reportId);
  if (!job) {
    return res.status(404).json({ error: "Report not found" });
  }
  if (job.status !== "completed" || !job.file_path) {
    return res.status(409).json({ error: "Report not ready" });
  }

  const filePath = path.resolve(job.file_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Report file not found" });
  }

  return res.download(filePath, job.file_name || path.basename(filePath));
}

async function createReportSchedule(req, res) {
  const parsed = scheduleCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const body = parsed.data;
  if (body.type === "customers" && !(req.permissions || {})["customers.export"]) {
    return res.status(403).json({ error: "Forbidden: missing permission customers.export" });
  }

  const data = await createScheduledReport({
    reportType: body.type,
    reportFormat: body.format,
    frequency: body.frequency,
    dayOfWeek: body.dayOfWeek,
    hourUtc: body.hourUtc,
    minuteUtc: body.minuteUtc,
    actorId: req.admin.sub,
    filters: {
      startDate: body.startDate,
      endDate: body.endDate,
    },
  });

  return res.status(201).json({ data });
}

async function listReportSchedules(req, res) {
  const parsed = scheduleListQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const q = parsed.data;
  const data = await listScheduledReports({
    enabled: q.enabled === undefined ? undefined : q.enabled === "true",
    limit: q.limit ? Number(q.limit) : 50,
    offset: q.offset ? Number(q.offset) : 0,
  });
  return res.json({ data });
}

async function patchReportSchedule(req, res) {
  const parsed = scheduleUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const body = parsed.data;
  const payload = {
    scheduleId: req.params.scheduleId,
    enabled: body.enabled,
    frequency: body.frequency,
    dayOfWeek: body.dayOfWeek,
    hourUtc: body.hourUtc,
    minuteUtc: body.minuteUtc,
  };

  if (
    Object.prototype.hasOwnProperty.call(body, "startDate") ||
    Object.prototype.hasOwnProperty.call(body, "endDate")
  ) {
    payload.filters = {
      startDate: body.startDate,
      endDate: body.endDate,
    };
  }

  const data = await updateScheduledReport(payload);

  return res.json({ data });
}

async function removeReportSchedule(req, res) {
  const data = await deleteScheduledReport(req.params.scheduleId);
  return res.json({ data });
}

module.exports = {
  createReport,
  listReports,
  getReport,
  downloadReport,
  createReportSchedule,
  listReportSchedules,
  patchReportSchedule,
  removeReportSchedule,
};
