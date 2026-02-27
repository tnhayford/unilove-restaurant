const { getSetting, upsertSetting } = require("../repositories/systemSettingsRepository");
const { logSensitiveAction } = require("./auditService");

const SETTING_KEYS = Object.freeze({
  smsOrderTrackingEnabled: "sms_order_tracking_enabled",
  smsOrderCompletionEnabled: "sms_order_completion_enabled",
  smsDeliveryOtpEnabled: "sms_delivery_otp_enabled",
  riderGuestLoginPolicy: "rider_guest_login_policy",
  riderGuestAccessCode: "rider_guest_access_code",
  riderGuestCommissionPercent: "rider_guest_commission_percent",
});

const RIDER_GUEST_POLICIES = Object.freeze({
  OPEN: "open",
  INVITE_ONLY: "invite_only",
  DISABLED: "disabled",
});

const DEFAULT_POLICY = Object.freeze({
  smsOrderTrackingEnabled: true,
  smsOrderCompletionEnabled: true,
  smsDeliveryOtpEnabled: true,
  riderGuestLoginPolicy: RIDER_GUEST_POLICIES.INVITE_ONLY,
  riderGuestAccessCode: "",
  riderGuestCommissionPercent: 8,
});

function parseBoolean(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeGuestPolicy(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === RIDER_GUEST_POLICIES.DISABLED) return RIDER_GUEST_POLICIES.DISABLED;
  if (raw === RIDER_GUEST_POLICIES.INVITE_ONLY || raw === "invite-only" || raw === "code") {
    return RIDER_GUEST_POLICIES.INVITE_ONLY;
  }
  return RIDER_GUEST_POLICIES.OPEN;
}

function normalizeCommissionPercent(value, fallback = DEFAULT_POLICY.riderGuestCommissionPercent) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(2))));
}

function normalizeAccessCode(value) {
  return String(value || "").trim().slice(0, 64);
}

async function getOperationsPolicy() {
  const [
    smsOrderTrackingRow,
    smsOrderCompletionRow,
    smsDeliveryOtpRow,
    riderGuestPolicyRow,
    riderGuestAccessCodeRow,
    riderGuestCommissionRow,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.smsOrderTrackingEnabled),
    getSetting(SETTING_KEYS.smsOrderCompletionEnabled),
    getSetting(SETTING_KEYS.smsDeliveryOtpEnabled),
    getSetting(SETTING_KEYS.riderGuestLoginPolicy),
    getSetting(SETTING_KEYS.riderGuestAccessCode),
    getSetting(SETTING_KEYS.riderGuestCommissionPercent),
  ]);

  return {
    smsOrderTrackingEnabled: parseBoolean(
      smsOrderTrackingRow?.setting_value,
      DEFAULT_POLICY.smsOrderTrackingEnabled,
    ),
    smsOrderCompletionEnabled: parseBoolean(
      smsOrderCompletionRow?.setting_value,
      DEFAULT_POLICY.smsOrderCompletionEnabled,
    ),
    smsDeliveryOtpEnabled: parseBoolean(
      smsDeliveryOtpRow?.setting_value,
      DEFAULT_POLICY.smsDeliveryOtpEnabled,
    ),
    riderGuestLoginPolicy: normalizeGuestPolicy(
      riderGuestPolicyRow?.setting_value || DEFAULT_POLICY.riderGuestLoginPolicy,
    ),
    riderGuestAccessCode: normalizeAccessCode(
      riderGuestAccessCodeRow?.setting_value || DEFAULT_POLICY.riderGuestAccessCode,
    ),
    riderGuestCommissionPercent: normalizeCommissionPercent(
      riderGuestCommissionRow?.setting_value,
      DEFAULT_POLICY.riderGuestCommissionPercent,
    ),
  };
}

async function updateOperationsPolicy(input = {}, { actorId } = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const updates = [];
  const detail = {};

  if (has("smsOrderTrackingEnabled")) {
    const value = Boolean(input.smsOrderTrackingEnabled);
    updates.push(upsertSetting(SETTING_KEYS.smsOrderTrackingEnabled, value ? "true" : "false"));
    detail.smsOrderTrackingEnabled = value;
  }

  if (has("smsOrderCompletionEnabled")) {
    const value = Boolean(input.smsOrderCompletionEnabled);
    updates.push(upsertSetting(SETTING_KEYS.smsOrderCompletionEnabled, value ? "true" : "false"));
    detail.smsOrderCompletionEnabled = value;
  }

  if (has("smsDeliveryOtpEnabled")) {
    const value = Boolean(input.smsDeliveryOtpEnabled);
    updates.push(upsertSetting(SETTING_KEYS.smsDeliveryOtpEnabled, value ? "true" : "false"));
    detail.smsDeliveryOtpEnabled = value;
  }

  if (has("riderGuestLoginPolicy")) {
    const value = normalizeGuestPolicy(input.riderGuestLoginPolicy);
    updates.push(upsertSetting(SETTING_KEYS.riderGuestLoginPolicy, value));
    detail.riderGuestLoginPolicy = value;
  }

  if (has("riderGuestAccessCode")) {
    const value = normalizeAccessCode(input.riderGuestAccessCode);
    updates.push(upsertSetting(SETTING_KEYS.riderGuestAccessCode, value));
    detail.riderGuestAccessCodeSet = Boolean(value);
  }

  if (has("riderGuestCommissionPercent")) {
    const value = normalizeCommissionPercent(input.riderGuestCommissionPercent);
    updates.push(upsertSetting(SETTING_KEYS.riderGuestCommissionPercent, String(value)));
    detail.riderGuestCommissionPercent = value;
  }

  if (!updates.length) {
    return getOperationsPolicy();
  }

  await Promise.all(updates);

  await logSensitiveAction({
    actorType: "admin",
    actorId: actorId || null,
    action: "OPERATIONS_POLICY_UPDATED",
    entityType: "system_setting",
    entityId: "operations_policy",
    details: detail,
  });

  return getOperationsPolicy();
}

async function shouldSendCustomerSms(eventType) {
  const keyByType = {
    order_tracking: SETTING_KEYS.smsOrderTrackingEnabled,
    order_completion: SETTING_KEYS.smsOrderCompletionEnabled,
    delivery_otp: SETTING_KEYS.smsDeliveryOtpEnabled,
  };

  const defaultsByType = {
    order_tracking: DEFAULT_POLICY.smsOrderTrackingEnabled,
    order_completion: DEFAULT_POLICY.smsOrderCompletionEnabled,
    delivery_otp: DEFAULT_POLICY.smsDeliveryOtpEnabled,
  };

  const key = keyByType[eventType];
  if (!key) return true;
  const row = await getSetting(key);
  return parseBoolean(row?.setting_value, defaultsByType[eventType]);
}

async function getGuestRiderAuthSettings() {
  const [policyRow, accessCodeRow] = await Promise.all([
    getSetting(SETTING_KEYS.riderGuestLoginPolicy),
    getSetting(SETTING_KEYS.riderGuestAccessCode),
  ]);

  return {
    loginPolicy: normalizeGuestPolicy(policyRow?.setting_value || DEFAULT_POLICY.riderGuestLoginPolicy),
    accessCode: normalizeAccessCode(accessCodeRow?.setting_value || DEFAULT_POLICY.riderGuestAccessCode),
  };
}

module.exports = {
  RIDER_GUEST_POLICIES,
  SETTING_KEYS,
  DEFAULT_POLICY,
  getOperationsPolicy,
  updateOperationsPolicy,
  shouldSendCustomerSms,
  getGuestRiderAuthSettings,
};
