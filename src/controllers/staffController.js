const bcrypt = require("bcryptjs");
const { uuidv4 } = require("../utils/uuid");
const {
  listStaffUsers,
  findAdminByEmail,
  findAdminById,
  createAdminUser,
  updateAdminUserProfile,
  updateAdminUserPassword,
  deleteAdminUser,
} = require("../repositories/adminRepository");
const { logSensitiveAction } = require("../services/auditService");
const {
  ACTIONS,
  getUserPermissions,
  setUserPermissions,
} = require("../services/permissionService");

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.full_name || "",
    email: user.email,
    role: user.role || "staff",
    createdAt: user.created_at,
  };
}

async function listStaff(req, res) {
  const rows = await listStaffUsers();
  return res.json({ data: rows.map(toPublicUser) });
}

async function createStaff(req, res) {
  const email = req.validatedBody.email.trim().toLowerCase();
  const existing = await findAdminByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "User with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(req.validatedBody.password, 12);
  const created = await createAdminUser({
    id: uuidv4(),
    fullName: req.validatedBody.fullName,
    email,
    passwordHash,
    role: req.validatedBody.role || "staff",
  });

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin.sub,
    action: "ADMIN_USER_CREATED",
    entityType: "admin_user",
    entityId: created.id,
    details: {
      email: created.email,
      fullName: created.full_name || null,
      role: created.role,
    },
  });

  return res.status(201).json({ data: toPublicUser(created) });
}

async function updateStaff(req, res) {
  const userId = req.params.userId;
  const existing = await findAdminById(userId);
  if (!existing) {
    return res.status(404).json({ error: "Staff user not found" });
  }

  const roleUpdated = Object.prototype.hasOwnProperty.call(req.validatedBody, "role");
  const fullNameUpdated = Object.prototype.hasOwnProperty.call(req.validatedBody, "fullName");
  const passwordUpdated = Object.prototype.hasOwnProperty.call(req.validatedBody, "password");

  if (!roleUpdated && !passwordUpdated && !fullNameUpdated) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  if (existing.id === req.admin.sub && req.validatedBody.role === "staff") {
    return res.status(400).json({ error: "You cannot demote your own account" });
  }

  let updated = existing;
  if (roleUpdated || fullNameUpdated) {
    updated = await updateAdminUserProfile({
      id: existing.id,
      fullName: fullNameUpdated ? req.validatedBody.fullName : existing.full_name,
      role: roleUpdated ? req.validatedBody.role : existing.role,
    });
  }

  if (passwordUpdated) {
    const passwordHash = await bcrypt.hash(req.validatedBody.password, 12);
    await updateAdminUserPassword({
      id: existing.id,
      passwordHash,
    });
    if (!roleUpdated) {
      updated = await findAdminById(existing.id);
    }
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin.sub,
    action: "ADMIN_USER_UPDATED",
    entityType: "admin_user",
    entityId: existing.id,
    details: {
      roleUpdated: roleUpdated ? updated.role : null,
      fullNameUpdated: fullNameUpdated ? updated.full_name || null : null,
      passwordUpdated,
    },
  });

  return res.json({ data: toPublicUser(updated) });
}

async function removeStaff(req, res) {
  const userId = req.params.userId;
  const existing = await findAdminById(userId);
  if (!existing) {
    return res.status(404).json({ error: "Staff user not found" });
  }

  if (existing.id === req.admin.sub) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  await deleteAdminUser(existing.id);

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin.sub,
    action: "ADMIN_USER_DELETED",
    entityType: "admin_user",
    entityId: existing.id,
    details: {
      email: existing.email,
      role: existing.role,
    },
  });

  return res.json({ data: { success: true } });
}

async function getStaffPermissions(req, res) {
  const userId = req.params.userId;
  const existing = await findAdminById(userId);
  if (!existing) {
    return res.status(404).json({ error: "Staff user not found" });
  }

  const permissions = await getUserPermissions(existing);
  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin.sub,
    action: "ADMIN_USER_PERMISSIONS_VIEWED",
    entityType: "admin_user",
    entityId: existing.id,
    details: {
      targetEmail: existing.email,
    },
  });
  return res.json({
    data: {
      user: toPublicUser(existing),
      actions: ACTIONS,
      permissions,
    },
  });
}

async function updateStaffPermissions(req, res) {
  const userId = req.params.userId;
  const existing = await findAdminById(userId);
  if (!existing) {
    return res.status(404).json({ error: "Staff user not found" });
  }
  if ((existing.role || "staff") === "admin") {
    return res.status(400).json({ error: "Admin users already have full permissions" });
  }

  try {
    const requested = req.validatedBody.permissions || {};
    const requestedAllowedCount = ACTIONS.filter((action) => Boolean(requested[action])).length;
    await logSensitiveAction({
      actorType: "admin",
      actorId: req.admin.sub,
      action: "ADMIN_USER_PERMISSIONS_UPDATE_REQUESTED",
      entityType: "admin_user",
      entityId: existing.id,
      details: {
        targetEmail: existing.email,
        requestedAllowedCount,
      },
    });
    const permissions = await setUserPermissions(userId, requested);
    const normalizedMismatch = ACTIONS.filter((action) => Boolean(requested[action]) !== Boolean(permissions[action]));

    if (normalizedMismatch.length) {
      await logSensitiveAction({
        actorType: "admin",
        actorId: req.admin.sub,
        action: "ADMIN_USER_PERMISSIONS_NORMALIZED",
        entityType: "admin_user",
        entityId: existing.id,
        details: {
          normalizedMismatch,
        },
      });
    }

    const allowedCount = ACTIONS.filter((action) => Boolean(permissions[action])).length;
    await logSensitiveAction({
      actorType: "admin",
      actorId: req.admin.sub,
      action: "ADMIN_USER_PERMISSIONS_UPDATED",
      entityType: "admin_user",
      entityId: existing.id,
      details: {
        targetEmail: existing.email,
        allowedCount,
        permissions,
      },
    });

    return res.json({ data: { permissions, allowedCount } });
  } catch (error) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: req.admin.sub,
      action: "ADMIN_USER_PERMISSIONS_UPDATE_FAILED",
      entityType: "admin_user",
      entityId: existing.id,
      details: {
        targetEmail: existing.email,
        message: error.message,
      },
    });
    throw error;
  }
}

module.exports = {
  listStaff,
  createStaff,
  updateStaff,
  removeStaff,
  getStaffPermissions,
  updateStaffPermissions,
};
