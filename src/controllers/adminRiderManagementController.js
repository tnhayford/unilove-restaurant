const {
  getRiderById,
  getRiderByPhone,
  createRider,
  updateRiderProfile,
  deleteRiderById,
  purgeAllRiders,
  countOpenAssignmentsForRider,
  getRiderPerformanceStats,
  listReferralCodes,
  createReferralCode,
  updateReferralCode,
  deleteReferralCodeById,
} = require("../repositories/riderRepository");
const { listOutForDeliveryOrders } = require("../repositories/orderRepository");
const { logSensitiveAction } = require("../services/auditService");
const { listRiderRoster, markRiderPresence } = require("../services/riderPresenceService");
const { uuidv4 } = require("../utils/uuid");

function normalizeRiderIdFromPhone(phone) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  const suffix = digits.slice(-8) || Math.random().toString(36).slice(2, 10);
  return `rdr-${suffix}-${Math.random().toString(36).slice(2, 5)}`;
}

function toPublicRider(row, stats = {}) {
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
    phone: String(row.phone || "").trim() || null,
    mode,
    source: row.source || (mode === "guest" ? "guest_session" : "staff_account"),
    status,
    shiftStatus: row.shiftStatus || row.shift_status || (status === "offline" ? "offline" : "online"),
    assignedOrderCount: Number(row.assignedOrderCount || 0),
    deliveredCount: Number(stats.deliveredCount || 0),
    codCollectedCedis: Number(stats.codCollectedCedis || 0),
    isActive: Boolean(
      Object.prototype.hasOwnProperty.call(row, "isActive")
        ? row.isActive
        : row.is_active,
    ),
    onboardingStatus: String(
      row.onboardingStatus || row.onboarding_status || (Boolean(row.is_active) ? "onboarded" : "offboarded"),
    ).trim().toLowerCase(),
    notes: row.notes || null,
    isManaged,
    lastLoginAt: row.lastLoginAt || row.last_login_at || null,
    lastSeenAt: row.lastSeenAt || row.last_seen_at || null,
    lastShiftOnAt: row.lastShiftOnAt || row.last_shift_on_at || null,
    lastShiftOffAt: row.lastShiftOffAt || row.last_shift_off_at || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    offboardedAt: row.offboardedAt || row.offboarded_at || null,
  };
}

function generateReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "UNI";
  while (output.length < 9) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

async function listRiderAccounts(req, res) {
  const [rows, deliveryQueue] = await Promise.all([
    listRiderRoster(),
    listOutForDeliveryOrders(400),
  ]);

  const workloadByRider = new Map();
  for (const item of deliveryQueue) {
    const riderId = String(item.assigned_rider_id || "").trim();
    if (!riderId) continue;
    workloadByRider.set(riderId, (workloadByRider.get(riderId) || 0) + 1);
  }

  const perfStats = await getRiderPerformanceStats(rows.map((row) => row.id));
  const normalized = rows.map((row) => {
    const assignedOrderCount = workloadByRider.get(String(row.id || "").trim()) || 0;
    const online = String(row.status || "").toLowerCase() !== "offline";
    return toPublicRider({
      ...row,
      status: online ? (assignedOrderCount > 0 ? "busy" : "available") : "offline",
      assignedOrderCount,
    }, perfStats.get(String(row.id || "").trim()) || {});
  });

  return res.json({ data: normalized });
}

async function createRiderAccount(req, res) {
  const fullName = req.validatedBody.fullName.trim();
  const phone = req.validatedBody.phone.trim();
  const notes = req.validatedBody.notes?.trim() || null;
  const isActive = req.validatedBody.isActive !== false;

  const existingByPhone = await getRiderByPhone(phone);
  if (existingByPhone) {
    return res.status(409).json({ error: "Rider phone already exists" });
  }

  const riderId = normalizeRiderIdFromPhone(phone);
  const created = await createRider({
    id: riderId,
    fullName,
    phone,
    isActive,
    onboardingStatus: isActive ? "onboarded" : "offboarded",
    notes,
    createdByAdminId: req.admin?.sub || null,
  });

  if (!isActive) {
    await markRiderPresence({
      riderId: created.id,
      mode: "staff",
      displayName: created.full_name,
      shiftStatus: "offline",
      markSeen: false,
      markLogin: false,
    });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNT_CREATED",
    entityType: "rider",
    entityId: created.id,
    details: {
      fullName,
      phone,
      isActive,
      onboardingStatus: isActive ? "onboarded" : "offboarded",
    },
  });

  return res.status(201).json({ data: toPublicRider(created) });
}

async function updateRiderAccount(req, res) {
  const riderId = req.params.riderId;
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "fullName")) {
    updates.fullName = req.validatedBody.fullName.trim();
  }
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "phone")) {
    const existingByPhone = await getRiderByPhone(req.validatedBody.phone.trim());
    if (existingByPhone && String(existingByPhone.id) !== String(riderId)) {
      return res.status(409).json({ error: "Phone is already used by another rider" });
    }
    updates.phone = req.validatedBody.phone.trim();
  }
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "notes")) {
    updates.notes = req.validatedBody.notes?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "isActive")) {
    updates.isActive = Boolean(req.validatedBody.isActive);
  }
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "onboardingStatus")) {
    updates.onboardingStatus = req.validatedBody.onboardingStatus;
  }

  if (updates.onboardingStatus === "offboarded") {
    updates.isActive = false;
  }
  if (updates.isActive === false && !updates.onboardingStatus) {
    updates.onboardingStatus = "offboarded";
  }
  if (updates.isActive === true && !updates.onboardingStatus) {
    updates.onboardingStatus = "onboarded";
  }

  const updated = await updateRiderProfile({
    id: riderId,
    ...updates,
  });
  if (!updated) {
    return res.status(404).json({ error: "Rider not found" });
  }

  if (updates.isActive === false || updates.onboardingStatus === "offboarded") {
    await markRiderPresence({
      riderId,
      mode: "staff",
      displayName: updated.full_name || riderId,
      shiftStatus: "offline",
      markSeen: true,
      markLogin: false,
    });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNT_UPDATED",
    entityType: "rider",
    entityId: riderId,
    details: {
      changes: Object.keys(updates),
    },
  });

  return res.json({ data: toPublicRider(updated) });
}

async function deleteRiderAccount(req, res) {
  const riderId = req.params.riderId;
  const activeAssignments = await countOpenAssignmentsForRider(riderId);
  if (activeAssignments > 0) {
    return res.status(409).json({
      error: `Rider has ${activeAssignments} active assignment(s). Reassign or complete orders first.`,
    });
  }

  const removed = await deleteRiderById(riderId);
  if (!removed.deleted) {
    return res.status(404).json({ error: "Rider not found" });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNT_DELETED",
    entityType: "rider",
    entityId: riderId,
    details: {
      fullName: removed.existing?.full_name || null,
      phone: removed.existing?.phone || null,
    },
  });

  return res.json({ data: { deleted: true, riderId } });
}

async function purgeRiderAccounts(req, res) {
  const deletedCount = await purgeAllRiders();
  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_ACCOUNTS_PURGED",
    entityType: "rider",
    entityId: null,
    details: {
      deletedCount,
      requestId: uuidv4(),
    },
  });
  return res.json({ data: { deletedCount } });
}

function toPublicReferral(row) {
  return {
    id: row.id,
    code: row.code,
    riderId: row.rider_id || null,
    riderName: row.rider_full_name || null,
    riderPhone: row.rider_phone || null,
    riderActive: Boolean(row.rider_is_active),
    riderOnboardingStatus: row.rider_onboarding_status || null,
    label: row.label || null,
    isActive: Boolean(row.is_active),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    useCount: Number(row.use_count || 0),
    lastUsedAt: row.last_used_at || null,
    createdByAdminId: row.created_by_admin_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function listRiderReferrals(req, res) {
  const rows = await listReferralCodes(300);
  return res.json({ data: rows.map(toPublicReferral) });
}

async function createRiderReferral(req, res) {
  const referralRider = await getRiderById(req.validatedBody.riderId);
  if (!referralRider) {
    return res.status(400).json({ error: "Referral rider does not exist" });
  }
  if (!referralRider.is_active || String(referralRider.onboarding_status || "").toLowerCase() === "offboarded") {
    return res.status(400).json({ error: "Referral rider must be active and onboarded" });
  }

  let created = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateReferralCode();
    try {
      created = await createReferralCode({
        code,
        riderId: referralRider.id,
        label: req.validatedBody.label || null,
        maxUses: req.validatedBody.maxUses ?? null,
        isActive: true,
        createdByAdminId: req.admin?.sub || null,
      });
      break;
    } catch (error) {
      if (!/unique/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }
  if (!created) {
    throw Object.assign(new Error("Unable to generate unique referral code"), { statusCode: 500 });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_REFERRAL_CREATED",
    entityType: "rider_referral",
    entityId: created.id,
    details: {
      code: created.code,
      riderId: created.rider_id || null,
      maxUses: created.max_uses,
      label: created.label || null,
    },
  });
  return res.status(201).json({ data: toPublicReferral(created) });
}

async function updateRiderReferral(req, res) {
  let nextRiderId;
  if (Object.prototype.hasOwnProperty.call(req.validatedBody, "riderId")) {
    const referralRider = await getRiderById(req.validatedBody.riderId);
    if (!referralRider) {
      return res.status(400).json({ error: "Referral rider does not exist" });
    }
    if (!referralRider.is_active || String(referralRider.onboarding_status || "").toLowerCase() === "offboarded") {
      return res.status(400).json({ error: "Referral rider must be active and onboarded" });
    }
    nextRiderId = referralRider.id;
  }

  const updated = await updateReferralCode({
    id: req.params.referralId,
    riderId: nextRiderId,
    label: req.validatedBody.label,
    maxUses: req.validatedBody.maxUses,
    isActive: req.validatedBody.isActive,
  });
  if (!updated) {
    return res.status(404).json({ error: "Referral code not found" });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_REFERRAL_UPDATED",
    entityType: "rider_referral",
    entityId: updated.id,
    details: {
      code: updated.code,
      riderId: updated.rider_id || null,
      changedFields: Object.keys(req.validatedBody || {}),
    },
  });
  return res.json({ data: toPublicReferral(updated) });
}

async function deleteRiderReferral(req, res) {
  const removed = await deleteReferralCodeById(req.params.referralId);
  if (!removed.deleted) {
    return res.status(404).json({ error: "Referral code not found" });
  }
  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "RIDER_REFERRAL_DELETED",
    entityType: "rider_referral",
    entityId: removed.existing.id,
    details: {
      code: removed.existing.code,
    },
  });
  return res.json({ data: { deleted: true, id: removed.existing.id } });
}

module.exports = {
  listRiderAccounts,
  createRiderAccount,
  updateRiderAccount,
  deleteRiderAccount,
  purgeRiderAccounts,
  listRiderReferrals,
  createRiderReferral,
  updateRiderReferral,
  deleteRiderReferral,
};
