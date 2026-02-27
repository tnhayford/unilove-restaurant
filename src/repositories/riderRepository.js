const { getDb } = require("../db/connection");
const { uuidv4 } = require("../utils/uuid");

function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "").trim();
}

async function getRiderById(riderId) {
  const db = await getDb();
  return db.get(
    `SELECT id, full_name, phone, pin_hash, is_active, onboarding_status, notes, created_by_admin_id,
            offboarded_at, last_login_at, created_at, updated_at
     FROM riders
     WHERE id = ?`,
    [riderId],
  );
}

async function getRiderByPhone(phone) {
  const db = await getDb();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  return db.get(
    `SELECT id, full_name, phone, pin_hash, is_active, onboarding_status, notes, created_by_admin_id,
            offboarded_at, last_login_at, created_at, updated_at
     FROM riders
     WHERE phone = ?`,
    [normalizedPhone],
  );
}

async function listRiders() {
  const db = await getDb();
  return db.all(
    `SELECT id, full_name, phone, is_active, onboarding_status, notes, created_by_admin_id,
            offboarded_at, last_login_at, created_at, updated_at
     FROM riders
     ORDER BY datetime(created_at) DESC`,
  );
}

async function createRider({
  id,
  fullName,
  phone,
  pinHash = "OTP_ONLY",
  isActive = true,
  onboardingStatus = "onboarded",
  notes = null,
  createdByAdminId = null,
}) {
  const db = await getDb();
  const normalizedPhone = normalizePhone(phone);
  const offboardedAt = isActive ? null : new Date().toISOString().replace("T", " ").slice(0, 19);
  await db.run(
    `INSERT INTO riders (
      id, full_name, phone, pin_hash, is_active, onboarding_status, notes, created_by_admin_id, offboarded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fullName,
      normalizedPhone || null,
      pinHash || "OTP_ONLY",
      isActive ? 1 : 0,
      onboardingStatus || (isActive ? "onboarded" : "offboarded"),
      notes ? String(notes).trim() : null,
      createdByAdminId || null,
      offboardedAt,
    ],
  );
  return getRiderById(id);
}

async function updateRiderProfile({
  id,
  fullName,
  phone,
  isActive,
  onboardingStatus,
  notes,
}) {
  const db = await getDb();
  const existing = await getRiderById(id);
  if (!existing) return null;

  const nextIsActive = typeof isActive === "boolean" ? isActive : Boolean(existing.is_active);
  const nextOnboardingStatus = String(
    onboardingStatus || existing.onboarding_status || (nextIsActive ? "onboarded" : "offboarded"),
  ).trim().toLowerCase();
  const nextPhone = Object.prototype.hasOwnProperty.call(arguments[0], "phone")
    ? normalizePhone(phone)
    : normalizePhone(existing.phone);
  const nextName = Object.prototype.hasOwnProperty.call(arguments[0], "fullName")
    ? String(fullName || "").trim()
    : String(existing.full_name || "").trim();
  const nextNotes = Object.prototype.hasOwnProperty.call(arguments[0], "notes")
    ? (String(notes || "").trim() || null)
    : (existing.notes || null);

  const nextOffboardedAt = nextIsActive
    ? null
    : (existing.offboarded_at || new Date().toISOString().replace("T", " ").slice(0, 19));

  await db.run(
    `UPDATE riders
     SET full_name = ?,
         phone = ?,
         is_active = ?,
         onboarding_status = ?,
         notes = ?,
         offboarded_at = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      nextName || existing.id,
      nextPhone || null,
      nextIsActive ? 1 : 0,
      nextOnboardingStatus || (nextIsActive ? "onboarded" : "offboarded"),
      nextNotes,
      nextOffboardedAt,
      id,
    ],
  );
  return getRiderById(id);
}

async function updateRiderPin({ id, pinHash }) {
  const db = await getDb();
  await db.run(
    `UPDATE riders
     SET pin_hash = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [pinHash, id],
  );
  return getRiderById(id);
}

async function deleteRiderById(riderId) {
  const db = await getDb();
  const existing = await getRiderById(riderId);
  if (!existing) return { deleted: false, existing: null };
  await db.run("DELETE FROM riders WHERE id = ?", [riderId]);
  await db.run("DELETE FROM rider_presence WHERE rider_id = ?", [riderId]);
  await db.run("DELETE FROM guest_rider_devices WHERE rider_id = ?", [riderId]);
  return { deleted: true, existing };
}

async function purgeAllRiders() {
  const db = await getDb();
  const total = await db.get("SELECT COUNT(1) as total FROM riders");
  await db.run("DELETE FROM rider_referral_codes");
  await db.run("DELETE FROM rider_devices");
  await db.run("DELETE FROM guest_rider_devices");
  await db.run("DELETE FROM rider_presence");
  await db.run("DELETE FROM rider_login_otps");
  await db.run("DELETE FROM riders");
  await db.run(
    `UPDATE orders
     SET assigned_rider_id = NULL,
         updated_at = datetime('now')
     WHERE status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')`,
  );
  return Number(total?.total || 0);
}

async function touchRiderLogin(riderId) {
  const db = await getDb();
  await db.run(
    `UPDATE riders
     SET last_login_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [riderId],
  );
}

async function countOpenAssignmentsForRider(riderId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(1) AS total
     FROM orders
     WHERE assigned_rider_id = ?
       AND status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')`,
    [riderId],
  );
  return Number(row?.total || 0);
}

async function getRiderPerformanceStats(riderIds = []) {
  const db = await getDb();
  const normalized = Array.from(
    new Set(
      riderIds
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!normalized.length) return new Map();

  const placeholders = normalized.map(() => "?").join(", ");
  const rows = await db.all(
    `SELECT
       assigned_rider_id AS rider_id,
       SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_count,
       SUM(CASE WHEN status IN ('READY_FOR_PICKUP', 'OUT_FOR_DELIVERY') THEN 1 ELSE 0 END) AS active_assignment_count,
       SUM(
         CASE
           WHEN status = 'DELIVERED'
             AND LOWER(COALESCE(payment_method, '')) = 'cash_on_delivery'
             AND UPPER(COALESCE(payment_status, 'PENDING')) = 'PAID'
           THEN COALESCE(subtotal_cedis, 0)
           ELSE 0
         END
       ) AS cod_collected_cedis
     FROM orders
     WHERE assigned_rider_id IN (${placeholders})
     GROUP BY assigned_rider_id`,
    normalized,
  );

  return new Map(
    rows.map((row) => [
      String(row.rider_id || "").trim(),
      {
        deliveredCount: Number(row.delivered_count || 0),
        activeAssignmentCount: Number(row.active_assignment_count || 0),
        codCollectedCedis: Number(row.cod_collected_cedis || 0),
      },
    ]),
  );
}

async function createReferralCode({
  code,
  riderId,
  label = null,
  maxUses = null,
  isActive = true,
  createdByAdminId = null,
}) {
  const db = await getDb();
  const id = uuidv4();
  await db.run(
    `INSERT INTO rider_referral_codes (
      id, code, rider_id, label, is_active, max_uses, use_count, created_by_admin_id
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      String(code || "").trim().toUpperCase(),
      String(riderId || "").trim() || null,
      label ? String(label).trim() : null,
      isActive ? 1 : 0,
      Number.isFinite(maxUses) ? Math.max(1, Math.floor(maxUses)) : null,
      createdByAdminId || null,
    ],
  );
  return getReferralCodeById(id);
}

async function listReferralCodes(limit = 200) {
  const db = await getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 500));
  return db.all(
    `SELECT rrc.id, rrc.code, rrc.rider_id, rrc.label, rrc.is_active, rrc.max_uses, rrc.use_count,
            rrc.last_used_at, rrc.created_by_admin_id, rrc.created_at, rrc.updated_at,
            r.full_name AS rider_full_name, r.phone AS rider_phone,
            r.is_active AS rider_is_active, r.onboarding_status AS rider_onboarding_status
     FROM rider_referral_codes rrc
     LEFT JOIN riders r ON r.id = rrc.rider_id
     ORDER BY datetime(rrc.created_at) DESC
     LIMIT ?`,
    [safeLimit],
  );
}

async function getReferralCodeByCode(code) {
  const db = await getDb();
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  return db.get(
    `SELECT rrc.id, rrc.code, rrc.rider_id, rrc.label, rrc.is_active, rrc.max_uses, rrc.use_count,
            rrc.last_used_at, rrc.created_by_admin_id, rrc.created_at, rrc.updated_at,
            r.full_name AS rider_full_name, r.phone AS rider_phone,
            r.is_active AS rider_is_active, r.onboarding_status AS rider_onboarding_status
     FROM rider_referral_codes rrc
     LEFT JOIN riders r ON r.id = rrc.rider_id
     WHERE rrc.code = ?`,
    [normalized],
  );
}

async function getReferralCodeById(id) {
  const db = await getDb();
  return db.get(
    `SELECT rrc.id, rrc.code, rrc.rider_id, rrc.label, rrc.is_active, rrc.max_uses, rrc.use_count,
            rrc.last_used_at, rrc.created_by_admin_id, rrc.created_at, rrc.updated_at,
            r.full_name AS rider_full_name, r.phone AS rider_phone,
            r.is_active AS rider_is_active, r.onboarding_status AS rider_onboarding_status
     FROM rider_referral_codes rrc
     LEFT JOIN riders r ON r.id = rrc.rider_id
     WHERE rrc.id = ?`,
    [id],
  );
}

async function updateReferralCode({ id, riderId, label, maxUses, isActive }) {
  const db = await getDb();
  const existing = await getReferralCodeById(id);
  if (!existing) return null;
  await db.run(
    `UPDATE rider_referral_codes
     SET rider_id = ?,
         label = ?,
         max_uses = ?,
         is_active = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      Object.prototype.hasOwnProperty.call(arguments[0], "riderId")
        ? (String(riderId || "").trim() || null)
        : existing.rider_id,
      Object.prototype.hasOwnProperty.call(arguments[0], "label")
        ? (String(label || "").trim() || null)
        : existing.label,
      Object.prototype.hasOwnProperty.call(arguments[0], "maxUses")
        ? (Number.isFinite(maxUses) ? Math.max(1, Math.floor(maxUses)) : null)
        : existing.max_uses,
      Object.prototype.hasOwnProperty.call(arguments[0], "isActive")
        ? (isActive ? 1 : 0)
        : existing.is_active,
      id,
    ],
  );
  return getReferralCodeById(id);
}

async function deleteReferralCodeById(id) {
  const db = await getDb();
  const existing = await getReferralCodeById(id);
  if (!existing) return { deleted: false, existing: null };
  await db.run("DELETE FROM rider_referral_codes WHERE id = ?", [id]);
  return { deleted: true, existing };
}

async function incrementReferralCodeUsage(id) {
  const db = await getDb();
  await db.run(
    `UPDATE rider_referral_codes
     SET use_count = use_count + 1,
         last_used_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
  return getReferralCodeById(id);
}

async function createRiderLoginOtp({
  phone,
  riderMode,
  riderId = null,
  referralCode = null,
  codeHash,
  expiresAt,
  maxAttempts = 5,
}) {
  const db = await getDb();
  const id = uuidv4();
  const normalizedPhone = normalizePhone(phone);
  await db.run(
    `INSERT INTO rider_login_otps (
      id, phone, rider_mode, rider_id, referral_code, code_hash, expires_at, max_attempts, attempts, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    [
      id,
      normalizedPhone,
      String(riderMode || "staff").trim().toLowerCase() === "guest" ? "guest" : "staff",
      riderId || null,
      referralCode ? String(referralCode).trim().toUpperCase() : null,
      codeHash,
      expiresAt,
      Math.max(1, Math.floor(Number(maxAttempts || 5))),
    ],
  );
  return getRiderLoginOtpById(id);
}

async function getRiderLoginOtpById(id) {
  const db = await getDb();
  return db.get(
    `SELECT id, phone, rider_mode, rider_id, referral_code, code_hash, expires_at, max_attempts, attempts, consumed_at,
            created_at, updated_at
     FROM rider_login_otps
     WHERE id = ?`,
    [id],
  );
}

async function findLatestOpenRiderLoginOtp({ phone, riderMode, requestId = null }) {
  const db = await getDb();
  const normalizedPhone = normalizePhone(phone);
  const normalizedMode = String(riderMode || "staff").trim().toLowerCase() === "guest" ? "guest" : "staff";
  if (!normalizedPhone) return null;

  if (requestId) {
    return db.get(
      `SELECT id, phone, rider_mode, rider_id, referral_code, code_hash, expires_at, max_attempts, attempts, consumed_at,
              created_at, updated_at
       FROM rider_login_otps
       WHERE id = ?
         AND phone = ?
         AND rider_mode = ?
         AND consumed_at IS NULL`,
      [requestId, normalizedPhone, normalizedMode],
    );
  }

  return db.get(
    `SELECT id, phone, rider_mode, rider_id, referral_code, code_hash, expires_at, max_attempts, attempts, consumed_at,
            created_at, updated_at
     FROM rider_login_otps
     WHERE phone = ?
       AND rider_mode = ?
       AND consumed_at IS NULL
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [normalizedPhone, normalizedMode],
  );
}

async function incrementRiderLoginOtpAttempts(id) {
  const db = await getDb();
  await db.run(
    `UPDATE rider_login_otps
     SET attempts = attempts + 1,
         updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
  return getRiderLoginOtpById(id);
}

async function consumeRiderLoginOtp(id) {
  const db = await getDb();
  await db.run(
    `UPDATE rider_login_otps
     SET consumed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
  return getRiderLoginOtpById(id);
}

module.exports = {
  normalizePhone,
  getRiderById,
  getRiderByPhone,
  listRiders,
  createRider,
  updateRiderProfile,
  updateRiderPin,
  deleteRiderById,
  purgeAllRiders,
  touchRiderLogin,
  countOpenAssignmentsForRider,
  getRiderPerformanceStats,
  createReferralCode,
  listReferralCodes,
  getReferralCodeByCode,
  getReferralCodeById,
  updateReferralCode,
  deleteReferralCodeById,
  incrementReferralCodeUsage,
  createRiderLoginOtp,
  getRiderLoginOtpById,
  findLatestOpenRiderLoginOtp,
  incrementRiderLoginOtpAttempts,
  consumeRiderLoginOtp,
};
