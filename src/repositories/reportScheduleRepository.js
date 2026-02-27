const { getDb } = require("../db/connection");

async function createReportSchedule({
  id,
  reportType,
  reportFormat,
  frequency,
  dayOfWeek,
  hourUtc,
  minuteUtc,
  timezone,
  filters,
  nextRunAt,
  createdBy,
}) {
  const db = await getDb();
  await db.run(
    `INSERT INTO report_schedules (
      id, report_type, report_format, frequency, day_of_week,
      hour_utc, minute_utc, timezone, filters_json, enabled, next_run_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      reportType,
      reportFormat,
      frequency,
      dayOfWeek ?? null,
      hourUtc,
      minuteUtc,
      timezone || "UTC",
      filters ? JSON.stringify(filters) : null,
      nextRunAt,
      createdBy || null,
    ],
  );
}

async function getReportScheduleById(id) {
  const db = await getDb();
  return db.get(
    `SELECT s.*, a.email AS created_by_email
     FROM report_schedules s
     LEFT JOIN admin_users a ON a.id = s.created_by
     WHERE s.id = ?`,
    [id],
  );
}

async function listReportSchedules({ enabled, limit = 50, offset = 0 }) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 50), 200));
  const safeOffset = Math.max(0, Number(offset || 0));

  const clauses = [];
  const params = [];
  if (enabled === true || enabled === false) {
    clauses.push("s.enabled = ?");
    params.push(enabled ? 1 : 0);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = await db.all(
    `SELECT s.*, a.email AS created_by_email
     FROM report_schedules s
     LEFT JOIN admin_users a ON a.id = s.created_by
     ${where}
     ORDER BY datetime(s.next_run_at) ASC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total
     FROM report_schedules s
     ${where}`,
    params,
  );

  return {
    rows,
    total: Number(totalRow?.total || 0),
  };
}

async function listDueReportSchedules(nowIso) {
  const db = await getDb();
  return db.all(
    `SELECT *
     FROM report_schedules
     WHERE enabled = 1
       AND datetime(next_run_at) <= datetime(?)
     ORDER BY datetime(next_run_at) ASC
     LIMIT 100`,
    [nowIso],
  );
}

async function updateReportSchedule(id, fields = {}) {
  const db = await getDb();
  const updates = [];
  const params = [];

  if (fields.frequency) {
    updates.push("frequency = ?");
    params.push(fields.frequency);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "dayOfWeek")) {
    updates.push("day_of_week = ?");
    params.push(fields.dayOfWeek ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "hourUtc")) {
    updates.push("hour_utc = ?");
    params.push(fields.hourUtc);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "minuteUtc")) {
    updates.push("minute_utc = ?");
    params.push(fields.minuteUtc);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "enabled")) {
    updates.push("enabled = ?");
    params.push(fields.enabled ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "nextRunAt")) {
    updates.push("next_run_at = ?");
    params.push(fields.nextRunAt);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "filters")) {
    updates.push("filters_json = ?");
    params.push(fields.filters ? JSON.stringify(fields.filters) : null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "lastRunAt")) {
    updates.push("last_run_at = ?");
    params.push(fields.lastRunAt);
  }

  if (!updates.length) return;
  updates.push("updated_at = datetime('now')");

  await db.run(
    `UPDATE report_schedules
     SET ${updates.join(", ")}
     WHERE id = ?`,
    [...params, id],
  );
}

async function removeReportSchedule(id) {
  const db = await getDb();
  await db.run("DELETE FROM report_schedules WHERE id = ?", [id]);
}

module.exports = {
  createReportSchedule,
  getReportScheduleById,
  listReportSchedules,
  listDueReportSchedules,
  updateReportSchedule,
  removeReportSchedule,
};
