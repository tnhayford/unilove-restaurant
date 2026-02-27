const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const {
  normalizePhone,
  getRiderById,
  getRiderByPhone,
  touchRiderLogin,
  getReferralCodeByCode,
  incrementReferralCodeUsage,
  createRiderLoginOtp,
  findLatestOpenRiderLoginOtp,
  incrementRiderLoginOtpAttempts,
  consumeRiderLoginOtp,
} = require("../repositories/riderRepository");
const {
  upsertRiderDeviceToken,
  deactivateRiderDeviceTokensByRider,
} = require("../repositories/riderDeviceRepository");
const { randomDigits } = require("../utils/security");
const { sendSms } = require("./smsService");
const { logSensitiveAction } = require("./auditService");
const { markRiderPresence, listRiderRoster } = require("./riderPresenceService");
const {
  RIDER_GUEST_POLICIES,
  getGuestRiderAuthSettings,
} = require("./operationsPolicyService");
const { publishOpsEvent } = require("./realtimeEventService");

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

function maskPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 4) return "****";
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}

function buildRiderTokenPayload(rider, riderMode) {
  return {
    sub: rider.id,
    role: "rider",
    type: "rider",
    name: rider.full_name,
    mode: riderMode || RIDER_MODE.STAFF,
    phone: normalizePhone(rider.phone || ""),
  };
}

function buildGuestRiderProfile({ phone, riderName }) {
  const normalizedPhone = normalizePhone(phone);
  const suffix = normalizedPhone.slice(-4) || "0000";
  const rawName = String(riderName || "").trim();
  return {
    id: `guest-${normalizedPhone}`,
    full_name: rawName || `Guest Rider ${suffix}`,
    phone: normalizedPhone,
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

function resolveOtpTtlMinutes() {
  const value = Number(process.env.RIDER_OTP_TTL_MINUTES || 5);
  return Math.max(2, Math.min(15, Math.floor(value)));
}

function resolveOtpMaxAttempts() {
  const value = Number(process.env.RIDER_OTP_MAX_ATTEMPTS || 5);
  return Math.max(3, Math.min(8, Math.floor(value)));
}

function addMinutesIso(minutes) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  return date.toISOString();
}

function isExpiredIso(iso) {
  if (!iso) return true;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
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

function emitRiderRealtimeEvent(eventName, payload = {}) {
  publishOpsEvent(eventName, {
    riderId: String(payload.riderId || "").trim() || null,
    mode: normalizeRiderMode(payload.mode),
    shiftStatus: normalizeShiftStatus(payload.shiftStatus, SHIFT_STATUS.OFFLINE),
    hasDeviceToken: Boolean(payload.hasDeviceToken),
    updatedAt: payload.updatedAt || new Date().toISOString(),
  });
}

async function enforceGuestAccessPolicy() {
  const persisted = await getGuestRiderAuthSettings();
  const policy = normalizeGuestPolicy(
    persisted.loginPolicy || env.riderGuestLoginPolicy || process.env.RIDER_GUEST_LOGIN_POLICY,
  );
  if (policy === RIDER_GUEST_POLICIES.DISABLED) {
    throw Object.assign(new Error("Guest rider access is currently disabled"), { statusCode: 403 });
  }
}

async function validateGuestReferralCode(inputCode) {
  await enforceGuestAccessPolicy();
  const normalized = String(inputCode || "").trim().toUpperCase();
  if (!normalized) {
    throw Object.assign(new Error("Referral code is required for guest riders"), { statusCode: 400 });
  }

  const code = await getReferralCodeByCode(normalized);
  if (!code || !code.is_active) {
    throw Object.assign(new Error("Referral code is invalid or inactive"), { statusCode: 403 });
  }
  const referralRiderId = String(code.rider_id || "").trim();
  if (!referralRiderId) {
    throw Object.assign(new Error("Referral code is not linked to a rider"), { statusCode: 403 });
  }
  const referralRiderActive = Boolean(code.rider_is_active);
  const referralRiderOnboarding = String(code.rider_onboarding_status || "").trim().toLowerCase();
  if (!referralRiderActive || referralRiderOnboarding === "offboarded") {
    throw Object.assign(new Error("Referral rider is inactive or offboarded"), { statusCode: 403 });
  }
  if (Number.isFinite(code.max_uses) && Number(code.max_uses) > 0 && Number(code.use_count) >= Number(code.max_uses)) {
    throw Object.assign(new Error("Referral code has reached its usage limit"), { statusCode: 403 });
  }
  return code;
}

function ensureValidPhoneForOtp(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10 || normalized.length > 15) {
    throw Object.assign(new Error("Phone must be 10-15 digits"), { statusCode: 400 });
  }
  return normalized;
}

async function requestRiderLoginOtp({
  mode,
  phone,
  riderName,
  referralCode,
}) {
  const riderMode = normalizeRiderMode(mode);
  const normalizedPhone = ensureValidPhoneForOtp(phone);
  const otpCode = randomDigits(6);
  const otpTtlMinutes = resolveOtpTtlMinutes();
  const maxAttempts = resolveOtpMaxAttempts();

  let targetRider = null;
  let validatedReferral = null;
  if (riderMode === RIDER_MODE.STAFF) {
    targetRider = await getRiderByPhone(normalizedPhone);
    if (!targetRider || !targetRider.is_active) {
      throw Object.assign(new Error("Staff rider account is not active for this phone"), { statusCode: 401 });
    }
    if (String(targetRider.onboarding_status || "onboarded").toLowerCase() === "offboarded") {
      throw Object.assign(new Error("Rider account is offboarded"), { statusCode: 403 });
    }
  } else {
    validatedReferral = await validateGuestReferralCode(referralCode);
  }

  const codeHash = await bcrypt.hash(otpCode, 10);
  const otpRow = await createRiderLoginOtp({
    phone: normalizedPhone,
    riderMode,
    riderId: targetRider?.id || null,
    referralCode: validatedReferral?.code || null,
    codeHash,
    expiresAt: addMinutesIso(otpTtlMinutes),
    maxAttempts,
  });

  const msgTarget = targetRider?.full_name
    ? `Hello ${targetRider.full_name}, `
    : (riderName ? `Hello ${String(riderName).trim()}, ` : "");
  const smsMessage = `${msgTarget}your Unilove rider OTP is ${otpCode}. It expires in ${otpTtlMinutes} minutes.`;
  const smsResult = await sendSms({
    toPhone: normalizedPhone,
    message: smsMessage,
    orderId: null,
  });

  if (!smsResult.sent && env.nodeEnv !== "test") {
    throw Object.assign(new Error("Unable to send OTP SMS right now. Please retry."), {
      statusCode: 502,
    });
  }

  await logRiderAuthAction({
    riderId: targetRider?.id || null,
    riderMode,
    action: "RIDER_LOGIN_OTP_REQUESTED",
    details: {
      phoneMasked: maskPhone(normalizedPhone),
      requestId: otpRow.id,
      referralCode: validatedReferral?.code || null,
      smsStatus: smsResult.sent ? "sent" : "simulated",
    },
  });

  return {
    requestId: otpRow.id,
    mode: riderMode,
    phoneMasked: maskPhone(normalizedPhone),
    expiresInSeconds: otpTtlMinutes * 60,
    ...(env.nodeEnv === "test" ? { debugOtpCode: otpCode } : {}),
  };
}

async function loginRider({
  mode,
  phone,
  otpCode,
  requestId,
  riderName,
  referralCode,
  fcmToken,
  deviceId,
  platform,
}) {
  const riderMode = normalizeRiderMode(mode);
  const normalizedPhone = ensureValidPhoneForOtp(phone);
  const normalizedOtp = String(otpCode || "").trim();
  if (!/^\d{6}$/.test(normalizedOtp)) {
    throw Object.assign(new Error("otpCode must be a 6-digit code"), { statusCode: 400 });
  }

  const otpRow = await findLatestOpenRiderLoginOtp({
    phone: normalizedPhone,
    riderMode,
    requestId: String(requestId || "").trim() || null,
  });
  if (!otpRow) {
    throw Object.assign(new Error("OTP request not found. Request a new OTP."), { statusCode: 404 });
  }
  if (isExpiredIso(otpRow.expires_at)) {
    throw Object.assign(new Error("OTP has expired. Request a new OTP."), { statusCode: 410 });
  }
  if (Number(otpRow.attempts || 0) >= Number(otpRow.max_attempts || resolveOtpMaxAttempts())) {
    throw Object.assign(new Error("OTP attempt limit reached. Request a new OTP."), { statusCode: 429 });
  }

  const validCode = await bcrypt.compare(normalizedOtp, otpRow.code_hash);
  if (!validCode) {
    const updated = await incrementRiderLoginOtpAttempts(otpRow.id);
    const attemptsLeft = Math.max(
      Number(updated.max_attempts || resolveOtpMaxAttempts()) - Number(updated.attempts || 0),
      0,
    );
    throw Object.assign(new Error(`Invalid OTP. Attempts left: ${attemptsLeft}`), { statusCode: 401 });
  }

  await consumeRiderLoginOtp(otpRow.id);
  const ttlHours = resolveTokenTtlHours(riderMode);
  const expiresIn = `${ttlHours}h`;

  let riderProfile = null;
  let validatedReferral = null;
  if (riderMode === RIDER_MODE.STAFF) {
    riderProfile = await getRiderByPhone(normalizedPhone);
    if (!riderProfile || !riderProfile.is_active) {
      throw Object.assign(new Error("Staff rider account is not active for this phone"), { statusCode: 401 });
    }
    if (String(riderProfile.onboarding_status || "onboarded").toLowerCase() === "offboarded") {
      throw Object.assign(new Error("Rider account is offboarded"), { statusCode: 403 });
    }
    await touchRiderLogin(riderProfile.id);
  } else {
    validatedReferral = await validateGuestReferralCode(referralCode || otpRow.referral_code);
    await incrementReferralCodeUsage(validatedReferral.id);
    riderProfile = buildGuestRiderProfile({
      phone: normalizedPhone,
      riderName,
    });
  }

  const token = jwt.sign(buildRiderTokenPayload(riderProfile, riderMode), env.jwtSecret, { expiresIn });
  const presence = await markRiderPresence({
    riderId: riderProfile.id,
    mode: riderMode,
    displayName: riderProfile.full_name,
    shiftStatus: SHIFT_STATUS.ONLINE,
    markLogin: true,
    markSeen: true,
  });

  if (fcmToken) {
    await upsertRiderDeviceToken({
      riderId: riderProfile.id,
      riderMode,
      token: fcmToken,
      deviceId,
      platform: platform || "android",
    });
  }

  await logRiderAuthAction({
    riderId: riderProfile.id,
    riderMode,
    action: "RIDER_LOGIN_SUCCESS",
    details: {
      shiftStatus: SHIFT_STATUS.ONLINE,
      phoneMasked: maskPhone(normalizedPhone),
      referralCode: validatedReferral?.code || null,
      hasDeviceToken: Boolean(fcmToken),
    },
  });
  emitRiderRealtimeEvent("rider.presence", {
    riderId: riderProfile.id,
    mode: riderMode,
    shiftStatus: SHIFT_STATUS.ONLINE,
    hasDeviceToken: Boolean(fcmToken),
    updatedAt: presence?.updated_at || null,
  });

  return {
    token,
    expiresInSeconds: ttlHours * 60 * 60,
    rider: {
      id: riderProfile.id,
      fullName: riderProfile.full_name,
      phone: normalizedPhone,
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

  const presence = await markRiderPresence({
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
  emitRiderRealtimeEvent("rider.device", {
    riderId,
    mode: riderMode,
    shiftStatus: SHIFT_STATUS.ONLINE,
    hasDeviceToken: true,
    updatedAt: presence?.updated_at || null,
  });

  return { ok: true };
}

async function ensureRiderCanShiftOnline({ riderId, riderMode }) {
  if (normalizeRiderMode(riderMode) !== RIDER_MODE.STAFF) return;
  const rider = await getRiderById(riderId);
  if (!rider || !rider.is_active) {
    throw Object.assign(new Error("Staff rider account is not active"), { statusCode: 403 });
  }
  if (String(rider.onboarding_status || "onboarded").toLowerCase() === "offboarded") {
    throw Object.assign(new Error("Staff rider account is offboarded"), { statusCode: 403 });
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
  emitRiderRealtimeEvent("rider.presence", {
    riderId: normalizedRiderId,
    mode: normalizedMode,
    shiftStatus: normalizedShiftStatus,
    updatedAt: profile?.updated_at || null,
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

  const presence = await markRiderPresence({
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
  emitRiderRealtimeEvent("rider.presence", {
    riderId: normalizedRiderId,
    mode: riderMode,
    shiftStatus: SHIFT_STATUS.OFFLINE,
    updatedAt: presence?.updated_at || null,
  });

  return { ok: true };
}

async function getRiderRosterSnapshot() {
  return listRiderRoster();
}

module.exports = {
  requestRiderLoginOtp,
  loginRider,
  registerRiderDeviceToken,
  setRiderShiftStatus,
  logoutRider,
  getRiderRosterSnapshot,
};
