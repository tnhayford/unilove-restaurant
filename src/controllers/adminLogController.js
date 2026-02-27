const { z } = require("zod");
const {
  listAuditLogs,
  countAuditLogs,
  listSmsLogs,
  countSmsLogs,
  listPaymentLogs,
  countPaymentLogs,
  listErrorLogs,
  countErrorLogs,
} = require("../repositories/logRepository");

const querySchema = z.object({
  type: z.enum(["all", "security", "sms", "money", "errors"]).default("all"),
  action: z.string().trim().max(100).optional(),
  searchText: z.string().trim().max(160).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

function normalizeDetails(rows) {
  return (rows || []).map((row) => {
    if (!row || typeof row !== "object") return row;
    const next = { ...row };
    if (typeof next.details === "string") {
      try {
        next.details = JSON.parse(next.details);
      } catch {
        // keep as string when not valid JSON
      }
    }
    if (typeof next.raw_payload === "string") {
      try {
        next.raw_payload = JSON.parse(next.raw_payload);
      } catch {
        // keep as string when not valid JSON
      }
    }
    return next;
  });
}

async function listLogs(req, res) {
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
  const limit = query.limit ? Number(query.limit) : 120;
  const offset = query.offset ? Number(query.offset) : 0;
  const searchText = query.searchText || "";
  const action = query.action || "";

  const payload = {
    type: query.type,
    action,
    limit,
    offset,
    searchText,
  };

  if (query.type === "security") {
    const [rows, total] = await Promise.all([
      listAuditLogs({ limit, offset, searchText, action }),
      countAuditLogs({ searchText, action }),
    ]);
    return res.json({
      data: {
        ...payload,
        total,
        rows: normalizeDetails(rows),
      },
    });
  }

  if (query.type === "sms") {
    const [rows, total] = await Promise.all([
      listSmsLogs({ limit, offset, searchText }),
      countSmsLogs({ searchText }),
    ]);
    return res.json({
      data: {
        ...payload,
        total,
        rows: normalizeDetails(rows),
      },
    });
  }

  if (query.type === "money") {
    const [rows, total] = await Promise.all([
      listPaymentLogs({ limit, offset, searchText }),
      countPaymentLogs({ searchText }),
    ]);
    return res.json({
      data: {
        ...payload,
        total,
        rows: normalizeDetails(rows),
      },
    });
  }

  if (query.type === "errors") {
    const [rows, total] = await Promise.all([
      listErrorLogs({ limit, offset, searchText }),
      countErrorLogs({ searchText }),
    ]);
    return res.json({
      data: {
        ...payload,
        total,
        rows: normalizeDetails(rows),
      },
    });
  }

  const blendedFetchLimit = limit + offset;
  const [securityRows, smsRows, moneyRows, errorRows, securityTotal, smsTotal, moneyTotal, errorTotal] = await Promise.all([
    listAuditLogs({ limit: blendedFetchLimit, offset: 0, searchText, action }),
    listSmsLogs({ limit: blendedFetchLimit, offset: 0, searchText }),
    listPaymentLogs({ limit: blendedFetchLimit, offset: 0, searchText }),
    listErrorLogs({ limit: blendedFetchLimit, offset: 0, searchText }),
    countAuditLogs({ searchText, action }),
    countSmsLogs({ searchText }),
    countPaymentLogs({ searchText }),
    countErrorLogs({ searchText }),
  ]);

  const tagged = [
    ...normalizeDetails(securityRows).map((row) => ({ ...row, log_type: "security" })),
    ...normalizeDetails(smsRows).map((row) => ({ ...row, log_type: "sms" })),
    ...normalizeDetails(moneyRows).map((row) => ({ ...row, log_type: "money" })),
    ...normalizeDetails(errorRows).map((row) => ({ ...row, log_type: "errors" })),
  ]
    .sort((a, b) => new Date(`${b.created_at || ""}Z`) - new Date(`${a.created_at || ""}Z`))
    .slice(offset, offset + limit);

  return res.json({
    data: {
      ...payload,
      total: securityTotal + smsTotal + moneyTotal + errorTotal,
      rows: tagged,
    },
  });
}

module.exports = { listLogs };
