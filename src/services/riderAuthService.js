const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { getRiderById } = require("../repositories/riderRepository");
const {
  upsertRiderDeviceToken,
  deactivateRiderDeviceTokensByRider,
} = require("../repositories/riderDeviceRepository");
const { logSensitiveAction } = require("./auditService");
const { markRiderPresence, listRiderRoster } = require("./riderPresenceService");
const {
  RIDER_GUEST_POLICIES,
  getGuestRiderAuthSettings,
} = require("./operationsPolicyService");

const RIDER_MODE = {
  STAFF: "staff",
  GUEST: "guest",
};

const SHIFT_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
};

function normalizeRiderMode(mode) {
  return String(mode || RIDER_MODE.STAFF).trim().toLowerCase() === RIDER_MODE.GUEST
    ? RIDER_MODE.GUEST
    : RIDER_MODE.STAFF;
}

function normalizeShiftStatus(status, fallback = SHIFT_STATUS.OFFLINE) {
  const value = String(status || "").trim().toLowerCase();
  if (value === SHIFT_STATUS.ONLINE || value === SHIFT_STATUS.OFFLINE) {
    return value;
  }
  return fallback;
}

function normalizeGuestPolicy(input) {
  const value = String(input || RIDER_GUEST_POLICIES.OPEN).trim().toLowerCase();
  if (value === "disabled") return RIDER_GUEST_POLICIES.DISABLED;
  if (value === "invite_only" || value === "invite-only" || value === "code") {
    return RIDER_GUEST_POLICIES.INVITE_ONLY;
  }
  return RIDER_GUEST_POLICIES.OPEN;
}

async function enforceGuestPolicy({ guestAccessCode }) {
  const persisted = await getGuestRiderAuthSettings();
  const policy = normalizeGuestPolicy(
    persisted.loginPolicy || env.riderGuestLoginPolicy || process.env.RIDER_GUEST_LOGIN_POLICY,
  );

  if (policy === RIDER_GUEST_POLICIES.DISABLED) {
    throw Object.assign(new Error("Guest rider access is disabled"), { statusCode: 403 });
  }

  if (policy === RIDER_GUEST_POLICIES.INVITE_ONLY) {
    const configuredCode = String(
      persisted.accessCode || env.riderGuestAccessCode || process.env.RIDER_GUEST_ACCESS_CODE || "",
    ).trim();
    const providedCode = String(guestAccessCode || "").trim();
    if (!configuredCode || !providedCode || providedCode !== configuredCode) {
      throw Object.assign(new Error("Guest rider access code is invalid"), { statusCode: 403 });
    }
  }
}

function buildRiderTokenPayload(rider, riderMode) {
  return {
    sub: rider.id,
    role: "rider",
    type: "rider",
    name: rider.full_name,
    mode: riderMode || RIDER_MODE.STAFF,
  };
}

function buildGuestRiderProfile({ riderId, riderName }) {
  const alias = String(riderId || "").trim().replace(/\s+/g, " ");
  const displayName = String(riderName || "").trim() || (alias ? `Guest ${alias}` : "Guest Rider");
  const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  const id = cleanAlias ? `guest-${cleanAlias}-${suffix}` : `guest-${suffix}`;
  return {
    id,
    full_name: displayName.slice(0, 120),
  };
}

function resolveTokenTtlHours(riderMode) {
  const defaultHours = Math.max(1, Number(env.riderJwtTtlHours) || 1);
  if (riderMode !== RIDER_MODE.GUEST) return defaultHours;

  const guestOverride = Number(env.riderGuestJwtTtlHours || process.env.RIDER_GUEST_JWT_TTL_HOURS);
  if (Number.isFinite(guestOverride) && guestOverride > 0) {
    return Math.max(1, Math.round(guestOverride));
  }

  return Math.min(defaultHours, 4);
}

async function logRiderAuthAction({
  riderId,
  riderMode,
  action,
  details = {},
}) {
  await logSensitiveAction({
    actorType: "rider",
    actorId: riderId || null,
    action,
    entityType: "rider",
    entityId: riderId || null,
    details: {
      mode: normalizeRiderMode(riderMode),
      ...(details || {}),
    },
  });
}

async function loginRider({
  mode,
  riderId,
  riderName,
  pin,
  guestAccessCode,
  fcmToken,
  deviceId,
  platform,
}) {
  const riderMode = normalizeRiderMode(mode);
  const normalizedRiderId = String(riderId || "").trim();
  const normalizedPin = String(pin || "").trim();
  const ttlHours = resolveTokenTtlHours(riderMode);
  const expiresIn = `${ttlHours}h`;

  if (riderMode === RIDER_MODE.GUEST) {
    await enforceGuestPolicy({ guestAccessCode });

    const guestRider = buildGuestRiderProfile({
      riderId: normalizedRiderId,
      riderName,
    });
    const token = jwt.sign(buildRiderTokenPayload(guestRider, riderMode), env.jwtSecret, { expiresIn });

    await markRiderPresence({
      riderId: guestRider.id,
      mode: riderMode,
      displayName: guestRider.full_name,
      shiftStatus: SHIFT_STATUS.ONLINE,
      markLogin: true,
      markSeen: true,
    });

    if (fcmToken) {
      await upsertRiderDeviceToken({
        riderId: guestRider.id,
        riderMode,
        token: fcmToken,
        deviceId,
        platform: platform || "android",
      });
    }

    await logRiderAuthAction({
      riderId: guestRider.id,
      riderMode,
      action: "RIDER_LOGIN_SUCCESS",
      details: {
        shiftStatus: SHIFT_STATUS.ONLINE,
        hasDeviceToken: Boolean(fcmToken),
      },
    });

    return {
      token,
      expiresInSeconds: ttlHours * 60 * 60,
      rider: {
        id: guestRider.id,
        fullName: guestRider.full_name,
        mode: riderMode,
        shiftStatus: SHIFT_STATUS.ONLINE,
      },
    };
  }

  if (!normalizedRiderId || !normalizedPin) {
    throw Object.assign(new Error("riderId and pin are required"), { statusCode: 400 });
  }

  const rider = await getRiderById(normalizedRiderId);
  if (!rider || !rider.is_active) {
    throw Object.assign(new Error("Invalid rider credentials"), { statusCode: 401 });
  }

  const isPinValid = await bcrypt.compare(normalizedPin, rider.pin_hash);
  if (!isPinValid) {
    throw Object.assign(new Error("Invalid rider credentials"), { statusCode: 401 });
  }

  const token = jwt.sign(buildRiderTokenPayload(rider, riderMode), env.jwtSecret, { expiresIn });

  await markRiderPresence({
    riderId: rider.id,
    mode: riderMode,
    displayName: rider.full_name,
    shiftStatus: SHIFT_STATUS.ONLINE,
    markLogin: true,
    markSeen: true,
  });

  if (fcmToken) {
    await upsertRiderDeviceToken({
      riderId: rider.id,
      riderMode,
      token: fcmToken,
      deviceId,
      platform: platform || "android",
    });
  }

  await logRiderAuthAction({
    riderId: rider.id,
    riderMode,
    action: "RIDER_LOGIN_SUCCESS",
    details: {
      shiftStatus: SHIFT_STATUS.ONLINE,
      hasDeviceToken: Boolean(fcmToken),
    },
  });

  return {
    token,
    expiresInSeconds: ttlHours * 60 * 60,
    rider: {
      id: rider.id,
      fullName: rider.full_name,
      mode: riderMode,
      shiftStatus: SHIFT_STATUS.ONLINE,
    },
  };
}

async function registerRiderDeviceToken({ riderId, riderMode, fcmToken, deviceId, platform }) {
  if (!fcmToken || String(fcmToken).trim().length < 20) {
    throw Object.assign(new Error("Valid fcmToken is required"), { statusCode: 400 });
  }

  await upsertRiderDeviceToken({
    riderId,
    riderMode,
    token: fcmToken,
    deviceId,
    platform: platform || "android",
  });

  await markRiderPresence({
    riderId,
    mode: riderMode,
    displayName: "",
    shiftStatus: SHIFT_STATUS.ONLINE,
    markSeen: true,
    markLogin: false,
  });

  await logRiderAuthAction({
    riderId,
    riderMode,
    action: "RIDER_DEVICE_TOKEN_REGISTERED",
    details: {
      hasDeviceId: Boolean(deviceId),
      platform: platform || "android",
    },
  });

  return { ok: true };
}

async function ensureRiderCanShiftOnline({ riderId, riderMode }) {
  if (normalizeRiderMode(riderMode) !== RIDER_MODE.STAFF) return;
  const rider = await getRiderById(riderId);
  if (!rider || !rider.is_active) {
    throw Object.assign(new Error("Staff rider account is not active"), { statusCode: 403 });
  }
}

async function setRiderShiftStatus({
  riderId,
  riderMode,
  riderName,
  shiftStatus,
  note,
}) {
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) {
    throw Object.assign(new Error("riderId is required"), { statusCode: 400 });
  }

  const normalizedMode = normalizeRiderMode(riderMode);
  const normalizedShiftStatus = normalizeShiftStatus(shiftStatus, SHIFT_STATUS.ONLINE);
  if (![SHIFT_STATUS.ONLINE, SHIFT_STATUS.OFFLINE].includes(normalizedShiftStatus)) {
    throw Object.assign(new Error("shiftStatus must be online or offline"), { statusCode: 400 });
  }

  if (normalizedShiftStatus === SHIFT_STATUS.ONLINE) {
    await ensureRiderCanShiftOnline({
      riderId: normalizedRiderId,
      riderMode: normalizedMode,
    });
  }

  const profile = await markRiderPresence({
    riderId: normalizedRiderId,
    mode: normalizedMode,
    displayName: riderName || normalizedRiderId,
    shiftStatus: normalizedShiftStatus,
    markSeen: true,
    markLogin: normalizedShiftStatus === SHIFT_STATUS.ONLINE,
  });

  await logRiderAuthAction({
    riderId: normalizedRiderId,
    riderMode: normalizedMode,
    action: normalizedShiftStatus === SHIFT_STATUS.ONLINE ? "RIDER_SHIFT_ONLINE" : "RIDER_SHIFT_OFFLINE",
    details: {
      note: String(note || "").trim() || null,
    },
  });

  return {
    riderId: normalizedRiderId,
    mode: normalizedMode,
    shiftStatus: normalizedShiftStatus,
    updatedAt: profile?.updated_at || null,
  };
}

async function logoutRider({ riderId, riderMode, riderName }) {
  const normalizedRiderId = String(riderId || "").trim();
  if (!normalizedRiderId) {
    throw Object.assign(new Error("riderId is required"), { statusCode: 400 });
  }

  await markRiderPresence({
    riderId: normalizedRiderId,
    mode: riderMode,
    displayName: riderName || normalizedRiderId,
    shiftStatus: SHIFT_STATUS.OFFLINE,
    markSeen: true,
    markLogin: false,
  });

  await deactivateRiderDeviceTokensByRider(normalizedRiderId);

  await logRiderAuthAction({
    riderId: normalizedRiderId,
    riderMode,
    action: "RIDER_LOGOUT",
  });

  return { ok: true };
}

async function getRiderRosterSnapshot() {
  return listRiderRoster();
}

module.exports = {
  loginRider,
  registerRiderDeviceToken,
  setRiderShiftStatus,
  logoutRider,
  getRiderRosterSnapshot,
};
