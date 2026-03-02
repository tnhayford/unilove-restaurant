const os = require("os");
const env = require("../config/env");
const { reconcilePendingPayments, reconcileActivePromptAttempts } = require("../jobs/paymentStatusCheckJob");
const { runReportScheduleTick } = require("../jobs/reportScheduleJob");
const { runSlaAlertSweep } = require("./slaAlertService");
const { assignDeliveryOrdersByWorkload } = require("./riderAssignmentService");
const {
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
} = require("../repositories/jobOrchestratorRepository");

const DISPATCH_LOCK_KEY = "job_orchestrator_dispatch";
const STALE_RUN_AGE_SECONDS = 5 * 60;
const FINISHED_RETENTION_HOURS = 24 * 7;

function getSchedulerDefinitions() {
  return [
    {
      taskName: "payment_reconcile",
      enabled: env.enableStatusCheckJob,
      intervalMs: env.statusCheckIntervalMs,
      payload: null,
    },
    {
      taskName: "fast_prompt_reconcile",
      enabled: env.enableFastPromptReconcileJob,
      intervalMs: env.fastPromptReconcileIntervalMs,
      payload: {
        maxAgeMinutes: env.fastPromptReconcileMaxAgeMinutes,
        limit: env.fastPromptReconcileLimit,
      },
    },
    {
      taskName: "report_schedule_tick",
      enabled: env.enableReportScheduleJob,
      intervalMs: env.reportScheduleIntervalMs,
      payload: null,
    },
    {
      taskName: "sla_alert_sweep",
      enabled: env.enableSlaAlertJob,
      intervalMs: env.slaAlertIntervalMs,
      payload: null,
    },
    {
      taskName: "rider_assignment_reconcile",
      enabled: env.enableRiderAssignmentReconcileJob,
      intervalMs: env.riderAssignmentReconcileIntervalMs,
      payload: null,
    },
  ];
}

async function runTask(taskName, payload = null) {
  if (taskName === "payment_reconcile") {
    return reconcilePendingPayments({
      minAgeMinutes: 5,
      limit: 200,
    });
  }
  if (taskName === "fast_prompt_reconcile") {
    const prompt = await reconcileActivePromptAttempts({
      maxAgeMinutes: Number(payload?.maxAgeMinutes || env.fastPromptReconcileMaxAgeMinutes),
      limit: Number(payload?.limit || env.fastPromptReconcileLimit),
    });
    return { prompt };
  }
  if (taskName === "report_schedule_tick") {
    return runReportScheduleTick();
  }
  if (taskName === "sla_alert_sweep") {
    return runSlaAlertSweep();
  }
  if (taskName === "rider_assignment_reconcile") {
    return assignDeliveryOrdersByWorkload();
  }
  throw new Error(`Unknown orchestrator task: ${taskName}`);
}

function parseJsonSafely(input, fallback = null) {
  if (!input) return fallback;
  try {
    return JSON.parse(input);
  } catch (_) {
    return fallback;
  }
}

async function seedSchedules() {
  const definitions = getSchedulerDefinitions();
  for (const definition of definitions) {
    await upsertJobSchedule(definition);
  }
}

async function dispatchDueSchedules(ownerId) {
  const acquired = await acquireDistributedLock({
    lockKey: DISPATCH_LOCK_KEY,
    ownerId,
    ttlSeconds: env.durableJobLeaseTtlSeconds,
  });
  if (!acquired) {
    return { dispatched: 0, skipped: true, reason: "lock_not_acquired" };
  }

  const dueSchedules = await listDueJobSchedules(30);
  let dispatched = 0;

  for (const schedule of dueSchedules) {
    const payload = parseJsonSafely(schedule.payload_json, null);
    await enqueueJobRun(schedule.task_name, payload);
    const nextRun = new Date(Date.now() + Math.max(1000, Number(schedule.interval_ms || 1000)));
    await setJobScheduleNextRun(schedule.task_name, nextRun);
    dispatched += 1;
  }

  return { dispatched, skipped: false };
}

async function executeQueuedRun(workerId) {
  const jobRun = await claimQueuedJobRun(workerId);
  if (!jobRun) return { executed: false };

  const payload = parseJsonSafely(jobRun.payload_json, null);
  try {
    const result = await runTask(jobRun.task_name, payload);
    await completeJobRun(jobRun.id, result);
    return { executed: true, taskName: jobRun.task_name, status: "completed" };
  } catch (error) {
    await failJobRun(jobRun.id, error.message || "Unknown orchestrator failure");
    return { executed: true, taskName: jobRun.task_name, status: "failed", error };
  }
}

function startDurableJobOrchestrator() {
  if (!env.enableDurableJobOrchestrator) {
    return { stop: () => {} };
  }

  const ownerId = `${os.hostname()}:${process.pid}:dispatcher`;
  const workerId = `${os.hostname()}:${process.pid}:worker`;
  let stopped = false;
  let dispatchRunning = false;
  let executeRunning = false;
  let dispatchTimer = null;
  let executeTimer = null;
  let lastMaintenanceAt = 0;

  const dispatchTick = async () => {
    if (stopped) return;
    if (dispatchRunning) return;
    dispatchRunning = true;
    try {
      await dispatchDueSchedules(ownerId);
    } catch (error) {
      console.error("Durable job dispatcher tick failed:", error.message);
    } finally {
      dispatchRunning = false;
    }
  };

  const executeTick = async () => {
    if (stopped) return;
    if (executeRunning) return;
    executeRunning = true;
    try {
      const now = Date.now();
      if (now - lastMaintenanceAt >= 60000) {
        lastMaintenanceAt = now;
        await recoverStaleRunningRuns(STALE_RUN_AGE_SECONDS);
        await purgeFinishedRuns(FINISHED_RETENTION_HOURS);
      }

      const result = await executeQueuedRun(workerId);
      if (result.executed && result.status === "failed" && result.error) {
        console.error(`Durable job failed for ${result.taskName}:`, result.error.message);
      }
    } catch (error) {
      console.error("Durable job execution tick failed:", error.message);
    } finally {
      executeRunning = false;
    }
  };

  const scheduleLoops = () => {
    dispatchTimer = setInterval(dispatchTick, Math.max(1000, env.durableJobDispatchIntervalMs));
    executeTimer = setInterval(executeTick, Math.max(500, env.durableJobExecuteIntervalMs));
  };

  const bootstrap = async () => {
    await seedSchedules();
    await dispatchTick();
    await executeTick();
    scheduleLoops();
  };

  bootstrap().catch((error) => {
    console.error("Durable job orchestrator bootstrap failed:", error.message);
  });

  return {
    stop: () => {
      stopped = true;
      if (dispatchTimer) clearInterval(dispatchTimer);
      if (executeTimer) clearInterval(executeTimer);
    },
  };
}

module.exports = {
  startDurableJobOrchestrator,
};
