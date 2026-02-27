const env = require("../config/env");
const { loginAdmin } = require("../services/adminAuthService");
const { logSensitiveAction } = require("../services/auditService");
const { findAdminById } = require("../repositories/adminRepository");
const { getUserPermissions } = require("../services/permissionService");

async function login(req, res) {
  const result = await loginAdmin(req.validatedBody);
  if (!result) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.cookie("admin_token", result.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.cookieSecure,
    path: "/",
  });

  return res.json({ data: result.admin });
}

async function logout(req, res) {
  const actorId = req.admin?.sub || null;
  if (actorId) {
    await logSensitiveAction({
      actorType: "admin",
      actorId,
      action: "ADMIN_LOGOUT",
      entityType: "admin_user",
      entityId: actorId,
      details: null,
    });
  }

  res.clearCookie("admin_token", {
    httpOnly: true,
    sameSite: "strict",
    secure: env.cookieSecure,
    path: "/",
  });

  return res.json({ data: { success: true } });
}

async function me(req, res) {
  const user = await findAdminById(req.admin.sub);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const permissions = await getUserPermissions(user);
  return res.json({
    data: {
      id: user.id,
      fullName: user.full_name || "",
      email: user.email,
      role: user.role || "staff",
      permissions,
    },
  });
}

module.exports = {
  login,
  logout,
  me,
};
