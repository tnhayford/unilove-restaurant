const { getDb, runInWriteTransaction } = require("../db/connection");
const { uuidv4 } = require("../utils/uuid");

function toSqlDate(value) {
  return new Date(value).toISOString().replace("T", " ").replace("Z", "");
}

async function upsertJobSchedule({
  taskName,
  intervalMs,
  enabled = true,
  payload = null,
}) {
  const db = await getDb();
  const safeIntervalMs = Math.max(1000, Number(intervalMs || 1000));
  await db.run(
    `INSERT INTO job_schedules (task_name, interval_ms, enabled, payload_json, next_run_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(task_name) DO UPDATE SET
       interval_ms = excluded.interval_ms,
       enabled = excluded.enabled,
       payload_json = excluded.payload_json,
       updated_at = datetime('now')`,
    [
      taskName,
      safeIntervalMs,
      enabled ? 1 : 0,
      payload ? JSON.stringify(payload) : null,
    ],
  );
}

async function listDueJobSchedules(limit = 20) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 20), 200));
  return db.all(
    `SELECT task_name, interval_ms, enabled, payload_json, next_run_at
     FROM job_schedules
     WHERE enabled = 1
       AND datetime(next_run_at) <= datetime('now')
     ORDER BY datetime(next_run_at) ASC
     LIMIT ?`,
    [safeLimit],
  );
}

async function setJobScheduleNextRun(taskName, nextRunAt) {
  const db = await getDb();
  await db.run(
    `UPDATE job_schedules
     SET next_run_at = ?, updated_at = datetime('now')
     WHERE task_name = ?`,
    [toSqlDate(nextRunAt), taskName],
  );
}

async function enqueueJobRun(taskName, payload = null) {
  const db = await getDb();
  const id = uuidv4();
  await db.run(
    `INSERT OR IGNORE INTO job_runs (id, task_name, status, payload_json, queued_at)
     VALUES (?, ?, 'queued', ?, datetime('now'))`,
    [id, taskName, payload ? JSON.stringify(payload) : null],
  );
}

async function acquireDistributedLock({ lockKey, ownerId, ttlSeconds = 20 }) {
  const db = await getDb();
  const leaseExpr = `+${Math.max(1, Number(ttlSeconds || 20))} seconds`;
  await db.run(
    `INSERT INTO distributed_locks (lock_key, owner_id, lease_until, updated_at)
     VALUES (?, ?, datetime('now', ?), datetime('now'))
     ON CONFLICT(lock_key) DO UPDATE SET
       owner_id = excluded.owner_id,
       lease_until = excluded.lease_until,
       updated_at = datetime('now')
     WHERE datetime(distributed_locks.lease_until) <= datetime('now')
       OR distributed_locks.owner_id = excluded.owner_id`,
    [lockKey, ownerId, leaseExpr],
  );

  const row = await db.get(
    `SELECT owner_id
     FROM distributed_locks
     WHERE lock_key = ?`,
    [lockKey],
  );
  return String(row?.owner_id || "") === String(ownerId || "");
}

async function claimQueuedJobRun(workerId) {
  return runInWriteTransaction(async (db) => {
    const nextRun = await db.get(
      `SELECT id
       FROM job_runs
       WHERE status = 'queued'
       ORDER BY datetime(queued_at) ASC
       LIMIT 1`,
    );
    if (!nextRun?.id) return null;

    const update = await db.run(
      `UPDATE job_runs
       SET status = 'running',
           attempts = attempts + 1,
           worker_id = ?,
           started_at = datetime('now')
       WHERE id = ?
         AND status = 'queued'`,
      [workerId, nextRun.id],
    );
    if (!update?.changes) return null;

    return db.get(
      `SELECT id, task_name, payload_json, attempts, worker_id, queued_at
       FROM job_runs
       WHERE id = ?`,
      [nextRun.id],
    );
  });
}

async function completeJobRun(runId, result = null) {
  const db = await getDb();
  await db.run(
    `UPDATE job_runs
     SET status = 'completed',
         result_json = ?,
         finished_at = datetime('now')
     WHERE id = ?`,
    [result ? JSON.stringify(result) : null, runId],
  );
}

async function failJobRun(runId, errorMessage = "Unknown error") {
  const db = await getDb();
  await db.run(
    `UPDATE job_runs
     SET status = 'failed',
         last_error = ?,
         finished_at = datetime('now')
     WHERE id = ?`,
    [String(errorMessage || "Unknown error").slice(0, 1000), runId],
  );
}

async function recoverStaleRunningRuns(maxAgeSeconds = 300) {
  const db = await getDb();
  const safeAgeSeconds = Math.max(30, Number(maxAgeSeconds || 300));
  const thresholdExpr = `-${safeAgeSeconds} seconds`;
  const result = await db.run(
    `UPDATE job_runs
     SET status = 'queued',
         worker_id = NULL,
         started_at = NULL,
         finished_at = NULL,
         last_error = 'Recovered stale running job'
     WHERE status = 'running'
       AND datetime(COALESCE(started_at, queued_at)) <= datetime('now', ?)`,
    [thresholdExpr],
  );
  return Number(result?.changes || 0);
}

async function purgeFinishedRuns(retentionHours = 72) {
  const db = await getDb();
  const safeHours = Math.max(1, Number(retentionHours || 72));
  const thresholdExpr = `-${safeHours} hours`;
  const result = await db.run(
    `DELETE FROM job_runs
     WHERE status IN ('completed', 'failed')
       AND datetime(COALESCE(finished_at, queued_at)) <= datetime('now', ?)`,
    [thresholdExpr],
  );
  return Number(result?.changes || 0);
}

module.exports = {
  upsertJobSchedule,
  listDueJobSchedules,
  setJobScheduleNextRun,
  enqueueJobRun,
  acquireDistributedLock,
  claimQueuedJobRun,
  completeJobRun,
  failJobRun,
  recoverStaleRunningRuns,
  purgeFinishedRuns,
};
