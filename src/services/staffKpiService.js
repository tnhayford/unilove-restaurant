const { getDb } = require("../db/connection");

function toNumber(value, decimals = 2) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(decimals));
}

function toPercent(part, total) {
  const a = Number(part || 0);
  const b = Number(total || 0);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Number(((a / b) * 100).toFixed(2));
}

async function getMyStaffKpi(adminId) {
  const db = await getDb();
  const normalizedAdminId = String(adminId || "").trim();
  if (!normalizedAdminId) {
    throw Object.assign(new Error("adminId is required"), { statusCode: 400 });
  }

  const [cashierRow, kitchenRow, completionRow] = await Promise.all([
    db.get(
      `SELECT
         COUNT(*) AS initiated_count,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END), 0) AS paid_count,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN subtotal_cedis ELSE 0 END), 0) AS paid_sales,
         AVG(CASE
           WHEN payment_confirmed_at IS NOT NULL
             THEN (julianday(payment_confirmed_at) - julianday(created_at)) * 24 * 60
           ELSE NULL
         END) AS avg_payment_minutes
       FROM orders
       WHERE cashier_admin_id = ?
         AND date(created_at) = date('now')`,
      [normalizedAdminId],
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE
           WHEN kitchen_accepted_by_admin_id = ?
             AND kitchen_accepted_at IS NOT NULL
             AND date(kitchen_accepted_at) = date('now')
             THEN 1 ELSE 0
         END), 0) AS accepted_count,
         COALESCE(SUM(CASE
           WHEN kitchen_ready_by_admin_id = ?
             AND kitchen_ready_at IS NOT NULL
             AND date(kitchen_ready_at) = date('now')
             THEN 1 ELSE 0
         END), 0) AS ready_count,
         AVG(CASE
           WHEN kitchen_accepted_by_admin_id = ?
             AND kitchen_ready_by_admin_id = ?
             AND kitchen_accepted_at IS NOT NULL
             AND kitchen_ready_at IS NOT NULL
             THEN (julianday(kitchen_ready_at) - julianday(kitchen_accepted_at)) * 24 * 60
           ELSE NULL
         END) AS avg_prep_minutes,
         COALESCE(SUM(CASE
           WHEN status = 'PREPARING' AND kitchen_accepted_by_admin_id = ?
             THEN 1 ELSE 0
         END), 0) AS active_preparing_count
       FROM orders`,
      [
        normalizedAdminId,
        normalizedAdminId,
        normalizedAdminId,
        normalizedAdminId,
        normalizedAdminId,
      ],
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE
           WHEN completed_by_admin_id = ?
             AND date(updated_at) = date('now')
             THEN 1 ELSE 0
         END), 0) AS completed_by_admin_count,
         COALESCE(SUM(CASE
           WHEN completed_by_rider_id = ?
             AND date(updated_at) = date('now')
             THEN 1 ELSE 0
         END), 0) AS completed_by_rider_count
       FROM orders`,
      [normalizedAdminId, normalizedAdminId],
    ),
  ]);

  const initiatedCount = Number(cashierRow?.initiated_count || 0);
  const paidCount = Number(cashierRow?.paid_count || 0);

  return {
    date: new Date().toISOString().slice(0, 10),
    cashier: {
      initiatedCount,
      paidCount,
      paymentConversionRate: toPercent(paidCount, initiatedCount),
      paidSalesCedis: toNumber(cashierRow?.paid_sales),
      avgPaymentMinutes: toNumber(cashierRow?.avg_payment_minutes),
    },
    kitchen: {
      acceptedCount: Number(kitchenRow?.accepted_count || 0),
      readyCount: Number(kitchenRow?.ready_count || 0),
      activePreparingCount: Number(kitchenRow?.active_preparing_count || 0),
      avgPrepMinutes: toNumber(kitchenRow?.avg_prep_minutes),
    },
    completion: {
      completedByAdminCount: Number(completionRow?.completed_by_admin_count || 0),
      completedByRiderCount: Number(completionRow?.completed_by_rider_count || 0),
    },
  };
}

module.exports = {
  getMyStaffKpi,
};
