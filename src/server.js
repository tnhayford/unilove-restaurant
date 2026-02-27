const env = require("./config/env");
const { createApp } = require("./app");
const { runMigrations } = require("./db/migrate");
const { startDurableJobOrchestrator } = require("./services/jobOrchestratorService");

async function bootstrap() {
  await runMigrations();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });

  const orchestrator = startDurableJobOrchestrator();
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down gracefully...`);

    try {
      orchestrator.stop();
    } catch (error) {
      console.error("Failed to stop durable job orchestrator:", error.message);
    }

    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(1);
    }, 15000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
