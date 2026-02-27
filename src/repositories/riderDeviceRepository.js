const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

function normalizeRiderMode(mode) {
  return String(mode || "").trim().toLowerCase() === "guest" ? "guest" : "staff";
}

function getDeviceTableForMode(mode) {
  return normalizeRiderMode(mode) === "guest" ? "guest_rider_devices" : "rider_devices";
}

async function upsertRiderDeviceToken({
  riderId,
  token,
  deviceId,
  platform = "android",
  riderMode = "staff",
}) {
  const db = await getDb();
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return;
  const tableName = getDeviceTableForMode(riderMode);
  const otherTable = tableName === "rider_devices" ? "guest_rider_devices" : "rider_devices";

  await db.run(
    `UPDATE ${otherTable}
     SET is_active = 0, updated_at = datetime('now')
     WHERE fcm_token = ?`,
    [normalizedToken],
  );

  const existing = await db.get(
    `SELECT id
     FROM ${tableName}
     WHERE fcm_token = ?`,
    [normalizedToken],
  );

  if (existing) {
    await db.run(
      `UPDATE ${tableName}
       SET rider_id = ?,
           device_id = ?,
           platform = ?,
           is_active = 1,
           last_seen_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
      [riderId, deviceId || null, platform || "android", existing.id],
    );
    return;
  }

  await db.run(
    `INSERT INTO ${tableName} (
      id, rider_id, fcm_token, device_id, platform, is_active, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
    [uuidv4(), riderId, normalizedToken, deviceId || null, platform || "android"],
  );
}

async function listActiveRiderDeviceTokens(options = {}) {
  const db = await getDb();
  const riderId = String(options.riderId || "").trim();
  const riderMode = normalizeRiderMode(options.riderMode || "");
  const includeModeFilter = String(options.riderMode || "").trim().length > 0;
  const params = [];

  const staffFilters = ["is_active = 1", "TRIM(fcm_token) <> ''"];
  const guestFilters = ["is_active = 1", "TRIM(fcm_token) <> ''"];
  if (riderId) {
    staffFilters.push("rider_id = ?");
    guestFilters.push("rider_id = ?");
    params.push(riderId, riderId);
  }

  let sql = `
    SELECT id, rider_id, fcm_token, 'staff' AS rider_mode
    FROM rider_devices
    WHERE ${staffFilters.join(" AND ")}
    UNION ALL
    SELECT id, rider_id, fcm_token, 'guest' AS rider_mode
    FROM guest_rider_devices
    WHERE ${guestFilters.join(" AND ")}
  `;

  if (includeModeFilter) {
    sql = `
      SELECT id, rider_id, fcm_token, rider_mode
      FROM (${sql}) merged
      WHERE rider_mode = ?
    `;
    params.push(riderMode);
  }

  return db.all(
    sql,
    params,
  );
}

async function deactivateRiderDeviceToken(token) {
  const db = await getDb();
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return;
  await db.run(
    `UPDATE rider_devices
     SET is_active = 0, updated_at = datetime('now')
     WHERE fcm_token = ?`,
    [normalizedToken],
  );
  await db.run(
    `UPDATE guest_rider_devices
     SET is_active = 0, updated_at = datetime('now')
     WHERE fcm_token = ?`,
    [normalizedToken],
  );
}

async function deactivateRiderDeviceTokensByRider(riderId) {
  const db = await getDb();
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) return;

  await db.run(
    `UPDATE rider_devices
     SET is_active = 0, updated_at = datetime('now')
     WHERE rider_id = ?`,
    [normalizedRiderId],
  );
  await db.run(
    `UPDATE guest_rider_devices
     SET is_active = 0, updated_at = datetime('now')
     WHERE rider_id = ?`,
    [normalizedRiderId],
  );
}

module.exports = {
  upsertRiderDeviceToken,
  listActiveRiderDeviceTokens,
  deactivateRiderDeviceToken,
  deactivateRiderDeviceTokensByRider,
};
