const { getDb } = require("../db/connection");

async function createReportJob({ id, type, format, requestedBy, filters }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO report_jobs (
      id, report_type, report_format, status, requested_by, filters_json
    ) VALUES (?, ?, ?, 'queued', ?, ?)`,
    [id, type, format, requestedBy || null, filters ? JSON.stringify(filters) : null],
  );
}

async function getReportJobById(id) {
  const db = await getDb();
  return db.get(
    `SELECT r.*, a.email AS requested_by_email
     FROM report_jobs r
     LEFT JOIN admin_users a ON a.id = r.requested_by
     WHERE r.id = ?`,
    [id],
  );
}

async function listReportJobs({ status, limit, offset }) {
  const db = await getDb();
  const safeLimit = Math.max(10, Math.min(200, Number(limit || 20)));
  const safeOffset = Math.max(0, Number(offset || 0));
  const params = [];
  let where = "";
  if (status) {
    where = "WHERE r.status = ?";
    params.push(status);
  }

  const rows = await db.all(
    `SELECT r.*, a.email AS requested_by_email
     FROM report_jobs r
     LEFT JOIN admin_users a ON a.id = r.requested_by
     ${where}
     ORDER BY datetime(r.created_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );

  const totalRow = await db.get(
    `SELECT COUNT(*) AS total FROM report_jobs r ${where}`,
    params,
  );

  return { rows, total: Number(totalRow?.total || 0) };
}

async function markReportJobRunning(id) {
  const db = await getDb();
  await db.run(
    `UPDATE report_jobs
     SET status = 'running', updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
}

async function markReportJobCompleted(id, { fileName, filePath }) {
  const db = await getDb();
  await db.run(
    `UPDATE report_jobs
     SET status = 'completed', file_name = ?, file_path = ?, completed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [fileName, filePath, id],
  );
}

async function markReportJobFailed(id, errorMessage) {
  const db = await getDb();
  await db.run(
    `UPDATE report_jobs
     SET status = 'failed', error_message = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [String(errorMessage || "Unknown report error").slice(0, 500), id],
  );
}

module.exports = {
  createReportJob,
  getReportJobById,
  listReportJobs,
  markReportJobRunning,
  markReportJobCompleted,
  markReportJobFailed,
};
