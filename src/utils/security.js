const crypto = require("crypto");

function stripShaPrefix(signature) {
  if (!signature) return "";
  return signature.startsWith("sha256=") ? signature.slice(7) : signature;
}

function safeCompare(a, b) {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function verifyHubtelSignature(rawBody, incomingSignature, secret) {
  if (!incomingSignature || !rawBody || !secret) return false;
  const signature = stripShaPrefix(incomingSignature.trim());
  const hmacHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const hmacBase64 = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  return safeCompare(signature, hmacHex) || safeCompare(signature, hmacBase64);
}

function randomDigits(length) {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  return String(crypto.randomInt(min, max));
}

function randomToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

module.exports = {
  verifyHubtelSignature,
  randomDigits,
  randomToken,
};
