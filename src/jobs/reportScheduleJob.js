const { runDueReportSchedules } = require("../services/reportService");

let running = false;

async function runReportScheduleTick() {
  if (running) {
    return { skipped: true, reason: "already_running" };
  }

  running = true;
  try {
    const result = await runDueReportSchedules(new Date());
    return { skipped: false, ...result };
  } finally {
    running = false;
  }
}

module.exports = {
  runReportScheduleTick,
};
