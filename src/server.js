const env = require("./config/env");
const { createApp } = require("./app");
const { runMigrations } = require("./db/migrate");
const {
  reconcilePendingPayments,
  reconcileActivePromptAttempts,
} = require("./jobs/paymentStatusCheckJob");
const { runReportScheduleTick } = require("./jobs/reportScheduleJob");
const { runSlaAlertSweep } = require("./services/slaAlertService");

async function bootstrap() {
  await runMigrations();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });

  if (env.enableStatusCheckJob) {
    setInterval(async () => {
      try {
        const result = await reconcilePendingPayments();
        if (result.checked > 0) {
          console.log("Payment reconciliation result:", result);
        }
      } catch (error) {
        console.error("Payment reconciliation job failed:", error.message);
      }
    }, env.statusCheckIntervalMs);
  }

  if (env.enableFastPromptReconcileJob) {
    setInterval(async () => {
      try {
        const result = await reconcileActivePromptAttempts({
          maxAgeMinutes: env.fastPromptReconcileMaxAgeMinutes,
          limit: env.fastPromptReconcileLimit,
        });
        if (result.reconciled > 0 || result.ignored > 0) {
          console.log("Fast prompt reconciliation:", result);
        }
      } catch (error) {
        console.error("Fast prompt reconciliation failed:", error.message);
      }
    }, env.fastPromptReconcileIntervalMs);
  }

  if (env.enableReportScheduleJob) {
    setInterval(async () => {
      try {
        const result = await runReportScheduleTick();
        if (!result.skipped && result.queued > 0) {
          console.log("Report schedule tick:", result);
        }
      } catch (error) {
        console.error("Report schedule tick failed:", error.message);
      }
    }, env.reportScheduleIntervalMs);
  }

  if (env.enableSlaAlertJob) {
    setInterval(async () => {
      try {
        const result = await runSlaAlertSweep();
        if (result.alerted > 0) {
          console.log("SLA alert sweep:", result);
        }
      } catch (error) {
        console.error("SLA alert sweep failed:", error.message);
      }
    }, env.slaAlertIntervalMs);
  }
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
