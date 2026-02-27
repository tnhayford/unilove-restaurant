const bcrypt = require("bcryptjs");
const {
  getRiderById,
  createRider,
  updateRiderProfile,
  updateRiderPin,
} = require("../repositories/riderRepository");
const { listOutForDeliveryOrders } = require("../repositories/orderRepository");
const { logSensitiveAction } = require("../services/auditService");
const { listRiderRoster } = require("../services/riderPresenceService");

function toPublicRider(row) {
  if (!row) return null;
  const id = String(row.id || row.rider_id || "").trim();
  const mode = String(row.mode || "staff").trim().toLowerCase() === "guest" ? "guest" : "staff";
  const fullName = String(
    row.full_name || row.fullName || row.display_name || row.displayName || id,
  ).trim();
  const isManaged = mode === "staff" && row.source !== "presence_only";
  const status = String(row.status || "offline").trim().toLowerCase();

  return {
    id,
    fullName,
    mode,
    source: row.source || (mode === "guest" ? "guest_session" : "staff_account"),
    status,
    shiftStatus: row.shiftStatus || row.shift_status || (status === "offline" ? "offline" : "online"),
    assignedOrderCount: Number(row.assignedOrderCount || 0),
    isActive: Boolean(
      Object.prototype.hasOwnProperty.call(row, "isActive")
        ? row.isActive
        : row.is_active,
    ),
    isManaged,
    lastLoginAt: row.lastLoginAt || row.last_login_at || null,
    lastSeenAt: row.lastSeenAt || row.last_seen_at || null,
    lastShiftOnAt: row.lastShiftOnAt || row.last_shift_on_at || null,
    lastShiftOffAt: row.lastShiftOffAt || row.last_shift_off_at || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

async function listRiderAccounts(req, res) {
  const [rows, deliveryQueue] = await Promise.all([
    listRiderRoster(),
    listOutForDeliveryOrders(200),
  ]);

  const workloadByRider = new Map();
  for (const item of deliveryQueue) {
    const riderId = String(item.assigned_rider_id || "").trim();
    if (!riderId) continue;
    workloadByRider.set(riderId, (workloadByRider.get(riderId) || 0) + 1);
  }

  const normalized = rows.map((row) => {
    const assignedOrderCount = workloadByRider.get(String(row.id || "").trim()) || 0;
    const online = String(row.status || "").toLowerCase() !== "offline";
    return toPublicRider({
      ...row,
      status: online ? (assignedOrderCount > 0 ? "busy" : "available") : "offline",
      assignedOrderCount,
    });
  });

  return res.json({ data: normalized });
}

async function createRiderAccount(req, res) {
  const riderId = req.validatedBody.riderId.trim();
  const fullName = req.validatedBody.fullName.trim();
  const pin = req.validatedBody.pin.trim();
  const isActive = req.validatedBody.isActive !== false;

  const existing = await getRiderById(riderId);
  if (existing) {
    return res.status(409).json({ error: "Rider ID already exists" });
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const created = await createRider({
    id: riderId,
    fullName,
    pinHash,
    isActive,
  });

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNT_CREATED",
    entityType: "rider",
    entityId: riderId,
    details: {
      fullName,
      isActive,
    },
  });

  return res.status(201).json({ data: toPublicRider(created) });
}

async function updateRiderAccount(req, res) {
  const riderId = req.params.riderId;
  const existing = await getRiderById(riderId);
  if (!existing) {
    return res.status(404).json({ error: "Rider not found" });
  }

  let current = existing;

  if (
    Object.prototype.hasOwnProperty.call(req.validatedBody, "fullName") ||
    Object.prototype.hasOwnProperty.call(req.validatedBody, "isActive")
  ) {
    const nextFullName = Object.prototype.hasOwnProperty.call(req.validatedBody, "fullName")
      ? req.validatedBody.fullName.trim()
      : existing.full_name;
    const nextIsActive = Object.prototype.hasOwnProperty.call(req.validatedBody, "isActive")
      ? Boolean(req.validatedBody.isActive)
      : Boolean(existing.is_active);

    current = await updateRiderProfile({
      id: riderId,
      fullName: nextFullName,
      isActive: nextIsActive,
    });
  }

  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "pin")) {
    const pinHash = await bcrypt.hash(req.validatedBody.pin.trim(), 10);
    current = await updateRiderPin({
      id: riderId,
      pinHash,
    });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNT_UPDATED",
    entityType: "rider",
    entityId: riderId,
    details: {
      fullNameUpdated: Object.prototype.hasOwnProperty.call(req.validatedBody, "fullName"),
      isActiveUpdated: Object.prototype.hasOwnProperty.call(req.validatedBody, "isActive"),
      pinReset: Object.prototype.hasOwnProperty.call(req.validatedBody, "pin"),
    },
  });

  return res.json({ data: toPublicRider(current) });
}

module.exports = {
  listRiderAccounts,
  createRiderAccount,
  updateRiderAccount,
};
