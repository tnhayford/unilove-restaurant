const { insertSmsLog } = require("../repositories/smsRepository");
const env = require("../config/env");
const axios = require("axios");

function canSendViaHubtel() {
  return Boolean(env.hubtelSmsClientId && env.hubtelSmsClientSecret && env.hubtelSmsFrom);
}

function buildBasicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

async function sendSms({ toPhone, message, orderId }) {
  const normalizedPhone = normalizePhone(toPhone);
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    await insertSmsLog({
      orderId,
      toPhone: String(toPhone || ""),
      message,
      status: "SKIPPED_INVALID_PHONE",
      providerMessageId: null,
      rawPayload: null,
    });
    return { sent: false, reason: "invalid_phone" };
  }

  if (!canSendViaHubtel()) {
    await insertSmsLog({
      orderId,
      toPhone: normalizedPhone,
      message,
      status: "SKIPPED_NO_CREDENTIALS",
      providerMessageId: null,
      rawPayload: null,
    });
    return { sent: false, reason: "missing_credentials" };
  }

  try {
    const response = await axios.post(
      env.hubtelSmsBaseUrl,
      {
        From: env.hubtelSmsFrom,
        To: normalizedPhone,
        Content: message,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${buildBasicAuth(
            env.hubtelSmsClientId,
            env.hubtelSmsClientSecret,
          )}`,
        },
        timeout: 10000,
      },
    );

    await insertSmsLog({
      orderId,
      toPhone: normalizedPhone,
      message,
      status: "SENT",
      providerMessageId: response.data?.messageId || null,
      rawPayload: response.data,
    });

    return { sent: true, data: response.data };
  } catch (error) {
    await insertSmsLog({
      orderId,
      toPhone: normalizedPhone,
      message,
      status: "FAILED",
      providerMessageId: null,
      rawPayload: {
        message: error.message,
        response: error.response?.data || null,
      },
    });

    return { sent: false, reason: "provider_error" };
  }
}

module.exports = { sendSms };
