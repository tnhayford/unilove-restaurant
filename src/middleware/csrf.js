const crypto = require("crypto");
const env = require("../config/env");
const { randomToken } = require("../utils/security");

const COOKIE_NAME = "csrf_token";

function constantTimeEqual(a, b) {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function issueCsrfToken(req, res) {
  const token = randomToken(24);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "strict",
    secure: env.cookieSecure,
    path: "/",
  });
  res.json({ csrfToken: token });
}

function requireCsrf(req, res, next) {
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (!isMutating) {
    return next();
  }

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerToken = req.get("x-csrf-token") || req.get("x-xsrf-token");

  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ error: "CSRF token validation failed" });
  }

  return next();
}

module.exports = {
  issueCsrfToken,
  requireCsrf,
};
