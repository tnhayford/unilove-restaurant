const fs = require("fs");
const path = require("path");
const { uuidv4 } = require("../utils/uuid");
const {
  createReportJob,
  getReportJobById,
  listReportJobs,
  markReportJobRunning,
  markReportJobCompleted,
  markReportJobFailed,
} = require("../repositories/reportRepository");
const {
  createReportSchedule,
  getReportScheduleById,
  listReportSchedules,
  listDueReportSchedules,
  updateReportSchedule,
  removeReportSchedule,
} = require("../repositories/reportScheduleRepository");
const {
  listOrdersForReport,
  listCustomersForReport,
} = require("../repositories/reportDataRepository");
const { logSensitiveAction } = require("./auditService");

const REPORT_DIR = path.resolve(process.cwd(), "data/reports");
fs.mkdirSync(REPORT_DIR, { recursive: true });

function toIso(value) {
  return new Date(value).toISOString().replace("T", " ").replace("Z", "");
}

function toCsv(rows = []) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = String(value ?? "");
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  });
  return lines.join("\n");
}

function sanitizePdfText(text) {
  return String(text ?? "")
    .replace(/[()\\]/g, (m) => `\\${m}`)
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}

function clipText(value, max = 120) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function toPdfLinePayload(title, rows = []) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const lines = [];
  lines.push(title);
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Rows: ${rows.length}`);
  if (headers.length) {
    lines.push("");
    lines.push(`Columns: ${headers.join(", ")}`);
  }
  lines.push("");
  lines.push("Data:");

  if (!rows.length) {
    lines.push("No rows found for selected filters.");
    return lines;
  }

  rows.forEach((row, index) => {
    const parts = headers.map((header) => `${header}=${clipText(row[header], 90)}`);
    lines.push(`${index + 1}. ${parts.join(" | ")}`);
  });

  return lines;
}

function buildPdfContentObject(lines = []) {
  const startY = 770;
  const lineHeight = 12;
  const contentRows = [];
  contentRows.push("BT");
  contentRows.push("/F1 9 Tf");
  contentRows.push(`40 ${startY} Td`);
  lines.forEach((line, index) => {
    const safe = sanitizePdfText(line);
    if (index === 0) {
      contentRows.push(`(${safe}) Tj`);
    } else {
      contentRows.push(`0 -${lineHeight} Td`);
      contentRows.push(`(${safe}) Tj`);
    }
  });
  contentRows.push("ET");
  return contentRows.join("\n");
}

function toPdfBuffer(title, rows = []) {
  const allLines = toPdfLinePayload(title, rows);
  const pageLineLimit = 56;
  const pages = [];
  for (let i = 0; i < allLines.length; i += pageLineLimit) {
    pages.push(allLines.slice(i, i + pageLineLimit));
  }
  if (!pages.length) pages.push(["No data"]);

  const objects = [];
  const pageObjectNumbers = [];
  const fontObjectNumber = 3 + pages.length * 2;

  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Count 0 /Kids [] >> endobj");

  pages.forEach((pageLines, index) => {
    const pageObjNum = 3 + index * 2;
    const contentObjNum = pageObjNum + 1;
    const content = buildPdfContentObject(pageLines);
    pageObjectNumbers.push(pageObjNum);

    objects.push(
      `${pageObjNum} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> >> endobj`,
    );
    objects.push(
      `${contentObjNum} 0 obj << /Length ${Buffer.byteLength(content, "utf8")} >> stream\n${content}\nendstream endobj`,
    );
  });

  objects.push(`${fontObjectNumber} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  const kids = pageObjectNumbers.map((n) => `${n} 0 R`).join(" ");
  objects[1] = `2 0 obj << /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${kids}] >> endobj`;

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(output.length);
    output += `${obj}\n`;
  });

  const xrefStart = output.length;
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(output, "utf8");
}

async function getReportRows(type, filters) {
  if (type === "orders") return listOrdersForReport(filters);
  if (type === "customers") return listCustomersForReport(filters);
  throw Object.assign(new Error("Unsupported report type"), { statusCode: 400 });
}

function extensionFor(format) {
  if (format === "json") return "json";
  if (format === "excel") return "csv";
  return "pdf";
}

async function processReportJob(jobId) {
  const job = await getReportJobById(jobId);
  if (!job) return;

  try {
    await markReportJobRunning(jobId);
    const filters = job.filters_json ? JSON.parse(job.filters_json) : {};
    const rows = await getReportRows(job.report_type, filters);

    const ext = extensionFor(job.report_format);
    const safeType = job.report_type.replace(/[^a-z0-9_-]/gi, "");
    const fileName = `${safeType}-${job.id}.${ext}`;
    const filePath = path.join(REPORT_DIR, fileName);

    if (job.report_format === "json") {
      await fs.promises.writeFile(filePath, JSON.stringify(rows, null, 2), "utf8");
    } else if (job.report_format === "excel") {
      await fs.promises.writeFile(filePath, toCsv(rows), "utf8");
    } else {
      await fs.promises.writeFile(filePath, toPdfBuffer(`${job.report_type.toUpperCase()} REPORT`, rows));
    }

    await markReportJobCompleted(jobId, {
      fileName,
      filePath,
    });

    await logSensitiveAction({
      actorType: "admin",
      actorId: job.requested_by || null,
      action: "REPORT_GENERATED",
      entityType: "report_job",
      entityId: jobId,
      details: {
        type: job.report_type,
        format: job.report_format,
        rows: rows.length,
      },
    });
  } catch (error) {
    await markReportJobFailed(jobId, error.message);
  }
}

async function queueReport({ type, format, filters, requestedBy }) {
  const id = uuidv4();
  await createReportJob({
    id,
    type,
    format,
    filters,
    requestedBy,
  });

  Promise.resolve().then(() => {
    processReportJob(id).catch(() => {
      // already handled internally
    });
  });

  return getReportJobById(id);
}

function normalizeScheduleRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    day_of_week: row.day_of_week === null || row.day_of_week === undefined ? null : Number(row.day_of_week),
    hour_utc: Number(row.hour_utc || 0),
    minute_utc: Number(row.minute_utc || 0),
    filters_json: row.filters_json || null,
  };
}

function parseFiltersJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function computeNextRunAt({
  frequency,
  dayOfWeek,
  hourUtc,
  minuteUtc,
  fromDate = new Date(),
}) {
  const base = new Date(Date.UTC(
    fromDate.getUTCFullYear(),
    fromDate.getUTCMonth(),
    fromDate.getUTCDate(),
    hourUtc,
    minuteUtc,
    0,
    0,
  ));

  if (frequency === "daily") {
    if (base <= fromDate) {
      base.setUTCDate(base.getUTCDate() + 1);
    }
    return toIso(base);
  }

  const targetDay = Number(dayOfWeek);
  if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) {
    throw Object.assign(new Error("dayOfWeek must be 0-6 for weekly schedules"), {
      statusCode: 400,
    });
  }

  const currentDay = base.getUTCDay();
  let daysAhead = (targetDay - currentDay + 7) % 7;
  if (daysAhead === 0 && base <= fromDate) {
    daysAhead = 7;
  }
  base.setUTCDate(base.getUTCDate() + daysAhead);
  return toIso(base);
}

async function createScheduledReport({
  reportType,
  reportFormat,
  frequency,
  dayOfWeek,
  hourUtc,
  minuteUtc,
  filters,
  actorId,
}) {
  const id = uuidv4();
  const nextRunAt = computeNextRunAt({
    frequency,
    dayOfWeek,
    hourUtc,
    minuteUtc,
    fromDate: new Date(),
  });

  await createReportSchedule({
    id,
    reportType,
    reportFormat,
    frequency,
    dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
    hourUtc,
    minuteUtc,
    timezone: "UTC",
    filters,
    nextRunAt,
    createdBy: actorId || null,
  });

  return normalizeScheduleRow(await getReportScheduleById(id));
}

async function listScheduledReports({ enabled, limit, offset }) {
  const result = await listReportSchedules({ enabled, limit, offset });
  return {
    ...result,
    rows: (result.rows || []).map(normalizeScheduleRow),
  };
}

async function updateScheduledReport(input) {
  const source = input || {};
  const {
    scheduleId,
    enabled,
    frequency,
    dayOfWeek,
    hourUtc,
    minuteUtc,
    filters,
  } = source;
  const existing = normalizeScheduleRow(await getReportScheduleById(scheduleId));
  if (!existing) {
    throw Object.assign(new Error("Report schedule not found"), { statusCode: 404 });
  }

  const nextFrequency = frequency || existing.frequency;
  const nextDayOfWeek =
    Object.prototype.hasOwnProperty.call(source, "dayOfWeek")
      ? dayOfWeek
      : existing.day_of_week;
  const nextHour =
    Object.prototype.hasOwnProperty.call(source, "hourUtc")
      ? hourUtc
      : existing.hour_utc;
  const nextMinute =
    Object.prototype.hasOwnProperty.call(source, "minuteUtc")
      ? minuteUtc
      : existing.minute_utc;

  const nextRunAt = computeNextRunAt({
    frequency: nextFrequency,
    dayOfWeek: nextDayOfWeek,
    hourUtc: nextHour,
    minuteUtc: nextMinute,
    fromDate: new Date(),
  });

  await updateReportSchedule(scheduleId, {
    enabled:
      Object.prototype.hasOwnProperty.call(source, "enabled")
        ? enabled
        : existing.enabled,
    frequency: nextFrequency,
    dayOfWeek: nextFrequency === "weekly" ? nextDayOfWeek : null,
    hourUtc: nextHour,
    minuteUtc: nextMinute,
    filters:
      Object.prototype.hasOwnProperty.call(source, "filters")
        ? filters
        : parseFiltersJson(existing.filters_json),
    nextRunAt,
  });

  return normalizeScheduleRow(await getReportScheduleById(scheduleId));
}

async function deleteScheduledReport(scheduleId) {
  const existing = await getReportScheduleById(scheduleId);
  if (!existing) {
    throw Object.assign(new Error("Report schedule not found"), { statusCode: 404 });
  }
  await removeReportSchedule(scheduleId);
  return { success: true };
}

async function runDueReportSchedules(now = new Date()) {
  const nowIso = toIso(now);
  const due = await listDueReportSchedules(nowIso);
  let queued = 0;

  for (const schedule of due) {
    const normalized = normalizeScheduleRow(schedule);
    const parsedFilters = parseFiltersJson(normalized.filters_json) || {};

    await queueReport({
      type: normalized.report_type,
      format: normalized.report_format,
      filters: parsedFilters,
      requestedBy: normalized.created_by || null,
    });

    const nextRunAt = computeNextRunAt({
      frequency: normalized.frequency,
      dayOfWeek: normalized.day_of_week,
      hourUtc: normalized.hour_utc,
      minuteUtc: normalized.minute_utc,
      fromDate: now,
    });

    await updateReportSchedule(normalized.id, {
      lastRunAt: nowIso,
      nextRunAt,
    });
    queued += 1;
  }

  return { checked: due.length, queued };
}

module.exports = {
  queueReport,
  processReportJob,
  getReportJobById,
  listReportJobs,
  createScheduledReport,
  listScheduledReports,
  updateScheduledReport,
  deleteScheduledReport,
  runDueReportSchedules,
};
