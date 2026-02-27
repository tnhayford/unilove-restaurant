const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const requiredEnv = ["JWT_SECRET", "HUBTEL_CALLBACK_SECRET"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const databasePath = process.env.DATABASE_PATH || "./data/app.db";
const absoluteDatabasePath = path.resolve(process.cwd(), databasePath);
fs.mkdirSync(path.dirname(absoluteDatabasePath), { recursive: true });

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  databasePath: absoluteDatabasePath,
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ||
    `http://localhost:${Number(process.env.PORT || 4000)}`,
  jwtSecret: process.env.JWT_SECRET,
  callbackSecret: process.env.HUBTEL_CALLBACK_SECRET,
  hubtelSmsBaseUrl:
    process.env.HUBTEL_SMS_BASE_URL || "https://sms.hubtel.com/v1/messages/send",
  hubtelSmsClientId: process.env.HUBTEL_SMS_CLIENT_ID || "",
  hubtelSmsClientSecret: process.env.HUBTEL_SMS_CLIENT_SECRET || "",
  hubtelSmsFrom: process.env.HUBTEL_SMS_FROM || "Restaurant",
  hubtelTxnStatusBaseUrl:
    process.env.HUBTEL_TXN_STATUS_BASE_URL ||
    "https://api-txnstatus.hubtel.com",
  hubtelBasicAuth: process.env.HUBTEL_BASIC_AUTH || "",
  hubtelPosSalesId: process.env.HUBTEL_POS_SALES_ID || "",
  hubtelTxnStatusBasicAuth:
    process.env.HUBTEL_TXN_STATUS_BASIC_AUTH || process.env.HUBTEL_BASIC_AUTH || "",
  hubtelReceiveMoneyBaseUrl:
    process.env.HUBTEL_RECEIVE_MONEY_BASE_URL || "https://rmp.hubtel.com",
  hubtelReceiveMoneyBasicAuth:
    process.env.HUBTEL_RECEIVE_MONEY_BASIC_AUTH || process.env.HUBTEL_BASIC_AUTH || "",
  hubtelReceiveMoneyCallbackUrl:
    process.env.HUBTEL_RECEIVE_MONEY_CALLBACK_URL || "",
  hubtelVerificationBaseUrl:
    process.env.HUBTEL_VERIFICATION_BASE_URL || "https://rnv.hubtel.com/v2",
  hubtelVerificationBasicAuth:
    process.env.HUBTEL_VERIFICATION_BASIC_AUTH || process.env.HUBTEL_BASIC_AUTH || "",
  enableMomoNameVerification:
    process.env.ENABLE_MOMO_NAME_VERIFICATION !== "false",
  riderAppKey: process.env.RIDER_APP_KEY || "",
  riderJwtTtlHours: Number(process.env.RIDER_JWT_TTL_HOURS || 12),
  riderDefaultId: (process.env.RIDER_DEFAULT_ID || "").trim(),
  riderDefaultName: (process.env.RIDER_DEFAULT_NAME || "Default Rider").trim(),
  riderDefaultPin: (process.env.RIDER_DEFAULT_PIN || "").trim(),
  riderGuestLoginPolicy: (process.env.RIDER_GUEST_LOGIN_POLICY || "invite_only").trim(),
  riderGuestAccessCode: (process.env.RIDER_GUEST_ACCESS_CODE || "").trim(),
  riderGuestJwtTtlHours: Number(process.env.RIDER_GUEST_JWT_TTL_HOURS || 4),
  fcmProjectId: (process.env.FCM_PROJECT_ID || "").trim(),
  fcmClientEmail: (process.env.FCM_CLIENT_EMAIL || "").trim(),
  fcmPrivateKey: (process.env.FCM_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
  enableStatusCheckJob: process.env.ENABLE_STATUS_CHECK_JOB === "true",
  statusCheckIntervalMs: Number(process.env.STATUS_CHECK_INTERVAL_MS || 300000),
  enableFastPromptReconcileJob:
    process.env.ENABLE_FAST_PROMPT_RECONCILE_JOB !== "false",
  fastPromptReconcileIntervalMs: Number(
    process.env.FAST_PROMPT_RECONCILE_INTERVAL_MS || 15000,
  ),
  fastPromptReconcileMaxAgeMinutes: Number(
    process.env.FAST_PROMPT_RECONCILE_MAX_AGE_MINUTES || 120,
  ),
  fastPromptReconcileLimit: Number(
    process.env.FAST_PROMPT_RECONCILE_LIMIT || 120,
  ),
  enableReportScheduleJob: process.env.ENABLE_REPORT_SCHEDULE_JOB !== "false",
  reportScheduleIntervalMs: Number(process.env.REPORT_SCHEDULE_INTERVAL_MS || 60000),
  enableSlaAlertJob: process.env.ENABLE_SLA_ALERT_JOB !== "false",
  slaAlertIntervalMs: Number(process.env.SLA_ALERT_INTERVAL_MS || 60000),
  slaAlertPhones: process.env.SLA_ALERT_PHONES || "",
  adminDefaultEmail: process.env.ADMIN_DEFAULT_EMAIL || "admin@restaurant.local",
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
  adminApiRateLimitMaxRequests: Number(
    process.env.ADMIN_API_RATE_LIMIT_MAX_REQUESTS || 3000,
  ),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  cookieSecure: process.env.COOKIE_SECURE === "true",
};
