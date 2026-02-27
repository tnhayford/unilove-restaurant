const { getDb, runInWriteTransaction } = require("../db/connection");

const ACTIONS = [
  "orders.view",
  "orders.monitor",
  "orders.update_status",
  "orders.cancel",
  "orders.refund",
  "instore.create",
  "menu.view",
  "menu.edit",
  "analytics.view",
  "logs.view",
  "staff.manage",
  "settings.store",
  "settings.sla",
  "incidents.manage",
  "disputes.manage",
  "reports.generate",
  "reports.download",
  "customers.export",
  "payments.reconcile",
];

const STAFF_DEFAULTS = {
  "orders.view": true,
  "orders.monitor": true,
  "orders.update_status": true,
  "orders.cancel": true,
  "orders.refund": false,
  "instore.create": true,
  "menu.view": true,
  "menu.edit": true,
  "analytics.view": false,
  "logs.view": false,
  "staff.manage": false,
  "settings.store": false,
  "settings.sla": false,
  "incidents.manage": false,
  "disputes.manage": false,
  "reports.generate": false,
  "reports.download": false,
  "customers.export": false,
  "payments.reconcile": false,
};

function applyPermissionDependencies(input = {}) {
  const normalized = { ...input };

  if (normalized["orders.monitor"] || normalized["orders.update_status"] || normalized["orders.cancel"] || normalized["orders.refund"]) {
    normalized["orders.view"] = true;
  }
  if (normalized["menu.edit"]) {
    normalized["menu.view"] = true;
  }
  if (normalized["settings.sla"]) {
    normalized["analytics.view"] = true;
  }
  if (normalized["reports.download"] || normalized["customers.export"]) {
    normalized["reports.generate"] = true;
  }
  if (normalized["payments.reconcile"]) {
    normalized["orders.view"] = true;
  }

  return normalized;
}

function normalizePermissions(input = {}) {
  const output = {};
  const resolved = applyPermissionDependencies(input);
  ACTIONS.forEach((action) => {
    output[action] = Boolean(resolved[action]);
  });
  return output;
}

async function getUserPermissionOverrides(userId) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT action_key, allowed
     FROM admin_permissions
     WHERE user_id = ?`,
    [userId],
  );
  const map = {};
  rows.forEach((row) => {
    map[row.action_key] = Boolean(row.allowed);
  });
  return map;
}

async function getUserPermissions(user) {
  if (!user) return {};
  if ((user.role || "staff") === "admin") {
    const full = {};
    ACTIONS.forEach((action) => {
      full[action] = true;
    });
    return full;
  }

  const overrides = await getUserPermissionOverrides(user.id);
  return {
    ...STAFF_DEFAULTS,
    ...overrides,
  };
}

async function setUserPermissions(userId, permissions = {}) {
  const normalized = normalizePermissions(permissions);
  await runInWriteTransaction(async (db) => {
    await db.run("DELETE FROM admin_permissions WHERE user_id = ?", [userId]);
    for (const action of ACTIONS) {
      await db.run(
        `INSERT INTO admin_permissions (id, user_id, action_key, allowed)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?)`,
        [userId, action, normalized[action] ? 1 : 0],
      );
    }
  });
  return getUserPermissions({ id: userId, role: "staff" });
}

module.exports = {
  ACTIONS,
  STAFF_DEFAULTS,
  getUserPermissions,
  setUserPermissions,
};
