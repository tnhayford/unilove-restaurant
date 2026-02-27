const { getRiderById, listRiders, touchRiderLogin } = require("../repositories/riderRepository");
const {
  getRiderPresenceById,
  listRiderPresence,
  upsertRiderPresence,
} = require("../repositories/riderPresenceRepository");

const RIDER_ACTIVE_WINDOW_MINUTES = 20;

function normalizeMode(mode) {
  return String(mode || "").trim().toLowerCase() === "guest" ? "guest" : "staff";
}

function normalizeShiftStatus(status, fallback = "offline") {
  const value = String(status || "").trim().toLowerCase();
  if (value === "online" || value === "offline") return value;
  return fallback;
}

function parseDbTimestamp(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const date = new Date(`${raw}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function minutesSince(timestamp) {
  const date = parseDbTimestamp(timestamp);
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function isRecentlySeen(timestamp) {
  return minutesSince(timestamp) <= RIDER_ACTIVE_WINDOW_MINUTES;
}

function sortRoster(left, right) {
  const statusRank = {
    busy: 0,
    available: 1,
    offline: 2,
  };
  const modeRank = {
    staff: 0,
    guest: 1,
  };

  const statusDiff = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
  if (statusDiff) return statusDiff;

  const modeDiff = (modeRank[left.mode] ?? 9) - (modeRank[right.mode] ?? 9);
  if (modeDiff) return modeDiff;

  const nameDiff = String(left.fullName || "").localeCompare(String(right.fullName || ""));
  if (nameDiff) return nameDiff;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

async function markRiderPresence({
  riderId,
  mode = "staff",
  displayName = "",
  shiftStatus = "online",
  markLogin = false,
  markSeen = true,
}) {
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) return null;

  const normalizedMode = normalizeMode(mode);
  const normalizedShiftStatus = normalizeShiftStatus(shiftStatus, "online");
  const normalizedDisplayName = String(displayName || "").trim();

  if (normalizedMode === "staff" && normalizedShiftStatus === "online" && markLogin) {
    const rider = await getRiderById(normalizedRiderId);
    if (rider && rider.is_active) {
      await touchRiderLogin(normalizedRiderId);
    }
  }

  return upsertRiderPresence({
    riderId: normalizedRiderId,
    mode: normalizedMode,
    displayName: normalizedDisplayName || normalizedRiderId,
    shiftStatus: normalizedShiftStatus,
    markSeen,
    markLogin,
  });
}

async function listRiderRoster() {
  const [staffRows, presenceRows] = await Promise.all([
    listRiders(),
    listRiderPresence(1000),
  ]);

  const presenceById = new Map(
    (presenceRows || []).map((row) => [String(row.rider_id || "").trim(), row]),
  );

  const roster = [];

  for (const row of staffRows || []) {
    const riderId = String(row.id || "").trim();
    if (!riderId) continue;

    const presence = presenceById.get(riderId) || null;
    if (presenceById.has(riderId)) {
      presenceById.delete(riderId);
    }

    const accountIsActive = Boolean(row.is_active);
    const derivedShift = presence
      ? normalizeShiftStatus(presence.shift_status, "offline")
      : (isRecentlySeen(row.last_login_at) ? "online" : "offline");
    const lastSeenAt = presence?.last_seen_at || row.last_login_at || null;
    const online = accountIsActive && derivedShift === "online" && isRecentlySeen(lastSeenAt);
    const status = online ? "available" : "offline";

    roster.push({
      id: riderId,
      fullName: String(presence?.display_name || row.full_name || riderId).trim(),
      mode: "staff",
      source: "staff_account",
      status,
      shiftStatus: derivedShift,
      isActive: accountIsActive,
      isManaged: true,
      lastLoginAt: presence?.last_login_at || row.last_login_at || null,
      lastSeenAt,
      lastShiftOnAt: presence?.last_shift_on_at || null,
      lastShiftOffAt: presence?.last_shift_off_at || null,
      createdAt: row.created_at || presence?.created_at || null,
      updatedAt: presence?.updated_at || row.updated_at || null,
    });
  }

  for (const [riderId, presence] of presenceById.entries()) {
    if (!riderId || !presence) continue;
    const mode = normalizeMode(presence.mode);
    const shiftStatus = normalizeShiftStatus(presence.shift_status, "offline");
    const lastSeenAt = presence.last_seen_at || presence.last_login_at || null;
    const online = shiftStatus === "online" && isRecentlySeen(lastSeenAt);
    const status = online ? "available" : "offline";

    roster.push({
      id: riderId,
      fullName: String(presence.display_name || riderId).trim(),
      mode,
      source: mode === "guest" ? "guest_session" : "presence_only",
      status,
      shiftStatus,
      isActive: mode === "guest",
      isManaged: false,
      lastLoginAt: presence.last_login_at || null,
      lastSeenAt,
      lastShiftOnAt: presence.last_shift_on_at || null,
      lastShiftOffAt: presence.last_shift_off_at || null,
      createdAt: presence.created_at || null,
      updatedAt: presence.updated_at || null,
    });
  }

  return roster.sort(sortRoster);
}

async function listActiveAssignableRiders() {
  const roster = await listRiderRoster();
  return roster.filter((row) => row.status !== "offline");
}

async function getRiderPresenceSnapshot(riderId) {
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) return null;
  return getRiderPresenceById(normalizedRiderId);
}

module.exports = {
  RIDER_ACTIVE_WINDOW_MINUTES,
  listRiderRoster,
  listActiveAssignableRiders,
  markRiderPresence,
  getRiderPresenceSnapshot,
};
