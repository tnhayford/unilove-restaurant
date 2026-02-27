const crypto = require("crypto");
const axios = require("axios");
const env = require("../config/env");
const {
  listActiveRiderDeviceTokens,
  deactivateRiderDeviceToken,
} = require("../repositories/riderDeviceRepository");
const { logSensitiveAction } = require("./auditService");

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

let accessTokenCache = {
  token: null,
  expiresAtMs: 0,
};

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isFcmConfigured() {
  return Boolean(env.fcmProjectId && env.fcmClientEmail && env.fcmPrivateKey);
}

function buildServiceJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: env.fcmClientEmail,
      sub: env.fcmClientEmail,
      aud: GOOGLE_TOKEN_AUDIENCE,
      scope: FCM_SCOPE,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(env.fcmPrivateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${unsigned}.${signature}`;
}

async function getGoogleAccessToken() {
  const now = Date.now();
  if (accessTokenCache.token && accessTokenCache.expiresAtMs - now > 60000) {
    return accessTokenCache.token;
  }

  const assertion = buildServiceJwt();
  const params = new URLSearchParams();
  params.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  params.set("assertion", assertion);

  const response = await axios.post(GOOGLE_TOKEN_AUDIENCE, params.toString(), {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    timeout: 10000,
  });

  const token = response.data?.access_token;
  const expiresIn = Number(response.data?.expires_in || 3600);
  if (!token) {
    throw new Error("Unable to acquire Google access token");
  }

  accessTokenCache = {
    token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
  return token;
}

function isTokenInvalidError(errorData) {
  const details = errorData?.error?.details;
  if (!Array.isArray(details)) return false;
  return details.some((entry) => {
    const code = entry?.errorCode || entry?.reason || "";
    return code === "UNREGISTERED" || code === "INVALID_ARGUMENT";
  });
}

async function sendPushToToken(token, payload) {
  const accessToken = await getGoogleAccessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${env.fcmProjectId}/messages:send`;
  await axios.post(
    url,
    {
      message: {
        token,
        data: {
          title: payload.title,
          body: payload.body,
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
          status: payload.status,
          sentAt: new Date().toISOString(),
        },
        android: {
          priority: "HIGH",
          ttl: "120s",
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 10000,
    },
  );
}

async function notifyRiderDispatchUpdate({ orderId, orderNumber, status, riderId = null }) {
  if (!isFcmConfigured()) return { skipped: true, reason: "fcm_not_configured" };

  const normalizedRiderId = String(riderId || "").trim();
  const tokens = await listActiveRiderDeviceTokens(
    normalizedRiderId ? { riderId: normalizedRiderId } : {},
  );
  if (!tokens.length) return { skipped: true, reason: "no_registered_devices" };

  const payload = {
    title: status === "READY_FOR_PICKUP" ? "Order Ready" : "New Delivery Dispatch",
    body:
      status === "READY_FOR_PICKUP"
        ? `Order ${orderNumber} is ready for rider action.`
        : `Order ${orderNumber} is out for delivery.`,
    orderId,
    orderNumber,
    status,
  };

  let delivered = 0;
  let failed = 0;

  for (const tokenRow of tokens) {
    try {
      await sendPushToToken(tokenRow.fcm_token, payload);
      delivered += 1;
    } catch (error) {
      failed += 1;
      if (isTokenInvalidError(error.response?.data)) {
        await deactivateRiderDeviceToken(tokenRow.fcm_token);
      }
    }
  }

  await logSensitiveAction({
    actorType: "system",
    actorId: null,
    action: "RIDER_PUSH_DISPATCH_ALERT",
    entityType: "order",
    entityId: orderId,
    details: { status, riderId: normalizedRiderId || null, delivered, failed },
  });

  return { delivered, failed };
}

module.exports = {
  isFcmConfigured,
  notifyRiderDispatchUpdate,
};
