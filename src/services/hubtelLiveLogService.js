const fs = require("fs");
const path = require("path");
const env = require("../config/env");

function shouldMaskKey(key) {
  const token = String(key || "").trim().toLowerCase();
  if (!token) return false;
  if (token.includes("authorization")) return true;
  if (token.includes("secret")) return true;
  if (token.includes("password")) return true;
  if (token === "token" || token.endsWith("_token") || token.startsWith("token_")) return true;
  if (
    token.includes("signature") &&
    token !== "hassignature" &&
    token !== "signatureheader" &&
    token !== "signature_header"
  ) {
    return true;
  }
  return false;
}

function maskValue(value) {
  const text = String(value || "");
  if (!text) return "***";
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskPhone(value) {
  const text = String(value || "");
  if (!text) return text;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return text;
  const prefix = digits.slice(0, 3);
  const suffix = digits.slice(-3);
  return `${prefix}***${suffix}`;
}

function sanitize(input) {
  if (input == null) return input;
  if (Array.isArray(input)) {
    return input.map(sanitize);
  }
  if (typeof input !== "object") {
    return input;
  }

  const next = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (shouldMaskKey(key)) {
      next[key] = maskValue(rawValue);
      continue;
    }

    if (env.hubtelLiveLogMaskPhone && /(phone|msisdn|mobile)/i.test(key)) {
      next[key] = maskPhone(rawValue);
      continue;
    }

    next[key] = sanitize(rawValue);
  }
  return next;
}

function getLogFilePath() {
  const configured = String(env.hubtelLiveLogFile || "").trim();
  if (!configured) {
    return path.resolve(process.cwd(), "live-demo/hubtel-live.log");
  }
  return path.resolve(process.cwd(), configured);
}

function logHubtelEvent(tag, payload = {}) {
  if (!env.hubtelLiveLogEnabled) return;

  const safeTag = String(tag || "HUBTEL_EVENT").trim().toUpperCase();
  const filePath = getLogFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const body = env.hubtelLiveLogRedactSensitive ? sanitize(payload) : payload;
  const entry = `[${new Date().toISOString()}] [${safeTag}] ${JSON.stringify(body, null, 2)}\n`;
  fs.appendFileSync(filePath, entry, "utf8");
}

module.exports = {
  logHubtelEvent,
};
