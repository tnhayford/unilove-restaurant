const { getDb } = require("../db/connection");

function normalizeMode(mode) {
  return String(mode || "").trim().toLowerCase() === "guest" ? "guest" : "staff";
}

function normalizeShiftStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "online" || value === "offline") return value;
  return null;
}

async function getRiderPresenceById(riderId) {
  const db = await getDb();
  return db.get(
    `SELECT rider_id, mode, display_name, shift_status, last_login_at, last_seen_at,
            last_shift_on_at, last_shift_off_at, created_at, updated_at
     FROM rider_presence
     WHERE rider_id = ?`,
    [riderId],
  );
}

async function listRiderPresence(limit = 500) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 500), 2000));
  return db.all(
    `SELECT rider_id, mode, display_name, shift_status, last_login_at, last_seen_at,
            last_shift_on_at, last_shift_off_at, created_at, updated_at
     FROM rider_presence
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`,
    [safeLimit],
  );
}

async function upsertRiderPresence({
  riderId,
  mode = "staff",
  displayName = "",
  shiftStatus = null,
  markSeen = true,
  markLogin = false,
}) {
  const db = await getDb();
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) return null;

  const normalizedMode = normalizeMode(mode);
  const normalizedName = String(displayName || "").trim();
  const normalizedShift = normalizeShiftStatus(shiftStatus);
  const insertShift = normalizedShift || "online";

  await db.run(
    `INSERT INTO rider_presence (
      rider_id, mode, display_name, shift_status,
      last_login_at, last_seen_at, last_shift_on_at, last_shift_off_at
    )
    VALUES (
      ?, ?, ?, ?,
      CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      CASE WHEN ? = 'online' THEN datetime('now') ELSE NULL END,
      CASE WHEN ? = 'offline' THEN datetime('now') ELSE NULL END
    )
    ON CONFLICT(rider_id) DO UPDATE SET
      mode = excluded.mode,
      display_name = CASE
        WHEN TRIM(?) <> '' THEN ?
        ELSE rider_presence.display_name
      END,
      shift_status = CASE
        WHEN ? IN ('online', 'offline') THEN ?
        ELSE rider_presence.shift_status
      END,
      last_login_at = CASE
        WHEN ? = 1 THEN datetime('now')
        ELSE rider_presence.last_login_at
      END,
      last_seen_at = CASE
        WHEN ? = 1 THEN datetime('now')
        ELSE rider_presence.last_seen_at
      END,
      last_shift_on_at = CASE
        WHEN ? = 'online' THEN datetime('now')
        ELSE rider_presence.last_shift_on_at
      END,
      last_shift_off_at = CASE
        WHEN ? = 'offline' THEN datetime('now')
        ELSE rider_presence.last_shift_off_at
      END,
      updated_at = datetime('now')`,
    [
      normalizedRiderId,
      normalizedMode,
      normalizedName || normalizedRiderId,
      insertShift,
      markLogin ? 1 : 0,
      markSeen ? 1 : 0,
      insertShift,
      insertShift,
      normalizedName,
      normalizedName,
      normalizedShift,
      normalizedShift,
      markLogin ? 1 : 0,
      markSeen ? 1 : 0,
      normalizedShift,
      normalizedShift,
    ],
  );

  return getRiderPresenceById(normalizedRiderId);
}

module.exports = {
  getRiderPresenceById,
  listRiderPresence,
  upsertRiderPresence,
};
