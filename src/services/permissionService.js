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
  "finance.view",
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
  "finance.view": false,
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

const CASHIER_DEFAULTS = {
  ...STAFF_DEFAULTS,
  "menu.edit": false,
  "incidents.manage": false,
  "disputes.manage": false,
  "analytics.view": false,
  "finance.view": true,
  "logs.view": false,
  "reports.generate": false,
  "reports.download": false,
  "customers.export": false,
  "settings.store": false,
  "settings.sla": false,
  "payments.reconcile": false,
};

const KITCHEN_DEFAULTS = {
  "orders.view": true,
  "orders.monitor": true,
  "orders.update_status": true,
  "orders.cancel": false,
  "orders.refund": false,
  "instore.create": false,
  "menu.view": false,
  "menu.edit": false,
  "analytics.view": false,
  "finance.view": false,
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

const MANAGER_DEFAULTS = {
  "orders.view": true,
  "orders.monitor": true,
  "orders.update_status": true,
  "orders.cancel": true,
  "orders.refund": true,
  "instore.create": true,
  "menu.view": true,
  "menu.edit": true,
  "analytics.view": true,
  "finance.view": true,
  "logs.view": true,
  "staff.manage": false,
  "settings.store": true,
  "settings.sla": true,
  "incidents.manage": true,
  "disputes.manage": true,
  "reports.generate": true,
  "reports.download": true,
  "customers.export": true,
  "payments.reconcile": true,
};

const ROLE_DEFAULTS = {
  staff: STAFF_DEFAULTS,
  cashier: CASHIER_DEFAULTS,
  kitchen: KITCHEN_DEFAULTS,
  manager: MANAGER_DEFAULTS,
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
  if (normalized["finance.view"]) {
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
  const role = String(user.role || "staff").trim().toLowerCase();
  if (role === "admin") {
    const full = {};
    ACTIONS.forEach((action) => {
      full[action] = true;
    });
    return full;
  }

  const defaults = ROLE_DEFAULTS[role] || STAFF_DEFAULTS;
  const overrides = await getUserPermissionOverrides(user.id);
  return {
    ...defaults,
    ...overrides,
  };
}

async function setUserPermissions(userId, permissions = {}, role = "staff") {
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
  return getUserPermissions({ id: userId, role });
}

async function clearUserPermissionOverrides(userId) {
  const db = await getDb();
  await db.run("DELETE FROM admin_permissions WHERE user_id = ?", [userId]);
}

module.exports = {
  ACTIONS,
  STAFF_DEFAULTS,
  getUserPermissions,
  setUserPermissions,
  clearUserPermissionOverrides,
};
