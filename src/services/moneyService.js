const { getDb } = require("../db/connection");

function toAmount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

async function getTodayMoneySummary() {
  const db = await getDb();

  const [
    totalsRow,
    channelRows,
    codOutstandingRow,
    momoPendingRow,
    cashierRows,
  ] = await Promise.all([
    db.get(
      `SELECT
         COALESCE(SUM(subtotal_cedis), 0) AS gross_sales,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN subtotal_cedis ELSE 0 END), 0) AS collected_sales,
         COALESCE(SUM(CASE
           WHEN payment_status <> 'PAID'
            AND status NOT IN ('CANCELED', 'REFUNDED', 'PAYMENT_FAILED')
             THEN subtotal_cedis ELSE 0
         END), 0) AS outstanding_sales,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END), 0) AS paid_orders,
         COUNT(*) AS total_orders
       FROM orders
       WHERE date(created_at) = date('now')`,
    ),
    db.all(
      `SELECT
         source,
         payment_method,
         COUNT(*) AS orders_count,
         COALESCE(SUM(subtotal_cedis), 0) AS gross_amount,
         COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN subtotal_cedis ELSE 0 END), 0) AS collected_amount,
         COALESCE(SUM(CASE
           WHEN payment_status <> 'PAID'
            AND status NOT IN ('CANCELED', 'REFUNDED', 'PAYMENT_FAILED')
             THEN subtotal_cedis ELSE 0
         END), 0) AS outstanding_amount
       FROM orders
       WHERE date(created_at) = date('now')
       GROUP BY source, payment_method
       ORDER BY source ASC, payment_method ASC`,
    ),
    db.get(
      `SELECT
         COALESCE(SUM(subtotal_cedis), 0) AS cod_outstanding
       FROM orders
       WHERE payment_method = 'cash_on_delivery'
         AND payment_status <> 'PAID'
         AND status IN ('PAID', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')`,
    ),
    db.get(
      `SELECT
         COALESCE(SUM(subtotal_cedis), 0) AS momo_pending
       FROM orders
       WHERE payment_method = 'momo'
         AND payment_status <> 'PAID'
         AND status IN ('PENDING_PAYMENT', 'PAYMENT_FAILED')`,
    ),
    db.all(
      `SELECT
         COALESCE(au.full_name, au.email, o.cashier_admin_id, 'Unassigned') AS cashier,
         COUNT(*) AS orders_count,
         COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.subtotal_cedis ELSE 0 END), 0) AS collected_amount,
         COALESCE(SUM(CASE WHEN o.payment_status <> 'PAID' THEN o.subtotal_cedis ELSE 0 END), 0) AS outstanding_amount
       FROM orders o
       LEFT JOIN admin_users au ON au.id = o.cashier_admin_id
       WHERE date(o.created_at) = date('now')
       GROUP BY o.cashier_admin_id, au.full_name, au.email
       ORDER BY collected_amount DESC, orders_count DESC
       LIMIT 20`,
    ),
  ]);

  return {
    date: new Date().toISOString().slice(0, 10),
    totals: {
      totalOrders: Number(totalsRow?.total_orders || 0),
      paidOrders: Number(totalsRow?.paid_orders || 0),
      grossSalesCedis: toAmount(totalsRow?.gross_sales),
      collectedSalesCedis: toAmount(totalsRow?.collected_sales),
      outstandingSalesCedis: toAmount(totalsRow?.outstanding_sales),
      codOutstandingCedis: toAmount(codOutstandingRow?.cod_outstanding),
      momoPendingCedis: toAmount(momoPendingRow?.momo_pending),
    },
    channels: (channelRows || []).map((row) => ({
      source: String(row.source || "online").trim().toLowerCase(),
      paymentMethod: String(row.payment_method || "momo").trim().toLowerCase(),
      ordersCount: Number(row.orders_count || 0),
      grossAmountCedis: toAmount(row.gross_amount),
      collectedAmountCedis: toAmount(row.collected_amount),
      outstandingAmountCedis: toAmount(row.outstanding_amount),
    })),
    cashierBreakdown: (cashierRows || []).map((row) => ({
      cashier: row.cashier || "Unassigned",
      ordersCount: Number(row.orders_count || 0),
      collectedAmountCedis: toAmount(row.collected_amount),
      outstandingAmountCedis: toAmount(row.outstanding_amount),
    })),
  };
}

module.exports = {
  getTodayMoneySummary,
};
