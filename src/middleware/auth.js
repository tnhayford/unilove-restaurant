const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAdminAuth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.admin = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid auth token" });
  }
}

function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return function roleGuard(req, res, next) {
    if (!req.admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

function requireRiderKey(req, res, next) {
  if (!env.riderAppKey) {
    return next();
  }

  const incoming = req.get("x-rider-key") || "";
  if (incoming !== env.riderAppKey) {
    return res.status(401).json({ error: "Unauthorized rider access" });
  }

  return next();
}

function requireRiderAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "Missing rider token" });
  }

  try {
    const payload = jwt.verify(match[1], env.jwtSecret);
    if (payload?.type !== "rider" || !payload?.sub) {
      return res.status(401).json({ error: "Invalid rider token" });
    }
    req.rider = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid rider token" });
  }
}

module.exports = { requireAdminAuth, requireRole, requireRiderKey, requireRiderAuth };
