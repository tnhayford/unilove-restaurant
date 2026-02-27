const { runMigrations } = require("../src/db/migrate");
const { seedMenu } = require("../src/db/seedMenu");

runMigrations()
  .then(seedMenu)
  .then(() => {
    console.log("Menu seed completed successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Menu seed failed:", error);
    process.exit(1);
  });
