const { runMigrations } = require("../src/db/migrate");
const { seedAdmin } = require("../src/db/seedAdmin");

runMigrations()
  .then(seedAdmin)
  .then(() => {
    console.log("Admin seed completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Admin seed failed:", error);
    process.exit(1);
  });
