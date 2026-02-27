const { findAdminById } = require("../repositories/adminRepository");
const { getUserPermissions } = require("../services/permissionService");

function requirePermission(action) {
  return async function permissionGuard(req, res, next) {
    try {
      if (!req.admin?.sub) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await findAdminById(req.admin.sub);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const permissions = await getUserPermissions(user);
      req.permissions = permissions;
      if (!permissions[action]) {
        return res.status(403).json({ error: `Forbidden: missing permission ${action}` });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireAnyPermission(actions = []) {
  const required = Array.isArray(actions) ? actions.filter(Boolean) : [];
  return async function permissionAnyGuard(req, res, next) {
    try {
      if (!req.admin?.sub) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await findAdminById(req.admin.sub);
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const permissions = await getUserPermissions(user);
      req.permissions = permissions;
      const allowed = required.some((action) => permissions[action]);
      if (!allowed) {
        return res.status(403).json({
          error: `Forbidden: requires one of ${required.join(", ")}`,
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requirePermission,
  requireAnyPermission,
};
