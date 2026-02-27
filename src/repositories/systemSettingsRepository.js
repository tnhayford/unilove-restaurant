const { getDb } = require("../db/connection");

async function getSetting(key) {
  const db = await getDb();
  return db.get(
    `SELECT setting_key, setting_value, updated_at
     FROM system_settings
     WHERE setting_key = ?`,
    [key],
  );
}

async function upsertSetting(key, value) {
  const db = await getDb();
  await db.run(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(setting_key) DO UPDATE
     SET setting_value = excluded.setting_value,
         updated_at = datetime('now')`,
    [key, String(value)],
  );
  return getSetting(key);
}

module.exports = {
  getSetting,
  upsertSetting,
};
