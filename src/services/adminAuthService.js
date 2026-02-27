const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { findAdminByEmail } = require("../repositories/adminRepository");
const { logSensitiveAction } = require("./auditService");
const { getUserPermissions } = require("./permissionService");

async function loginAdmin({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();
  const admin = await findAdminByEmail(normalizedEmail);
  if (!admin) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: null,
      action: "ADMIN_LOGIN_FAILED",
      entityType: "admin_user",
      entityId: null,
      details: { email: normalizedEmail, reason: "not_found" },
    });
    return null;
  }

  const passwordMatch = await bcrypt.compare(password, admin.password_hash);
  if (!passwordMatch) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: admin.id,
      action: "ADMIN_LOGIN_FAILED",
      entityType: "admin_user",
      entityId: admin.id,
      details: { reason: "invalid_password" },
    });
    return null;
  }

  const token = jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      fullName: admin.full_name || "",
      role: admin.role || "staff",
    },
    env.jwtSecret,
    { expiresIn: "12h" },
  );

  await logSensitiveAction({
    actorType: "admin",
    actorId: admin.id,
    action: "ADMIN_LOGIN_SUCCESS",
    entityType: "admin_user",
    entityId: admin.id,
    details: null,
  });

  const permissions = await getUserPermissions(admin);

  return {
    token,
    admin: {
      id: admin.id,
      fullName: admin.full_name || "",
      email: admin.email,
      role: admin.role || "staff",
      permissions,
    },
  };
}

module.exports = { loginAdmin };
