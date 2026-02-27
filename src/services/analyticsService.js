const {
  getDailyRevenue,
  getMonthlyRevenue,
  getTopTenItems,
  getAverageOrderValue,
  getDeliverySuccessRate,
  getLoyaltyIssuedPerDay,
  getStatusBreakdown,
  getSourceBreakdown,
  getOperationalCounts,
  getPaymentLocationSummary,
  getRevenueByPaymentChannel,
  getCodCollectionByRider,
} = require("../repositories/analyticsRepository");

const MONEY_BUCKET_DEFINITIONS = [
  {
    key: "cash_on_delivery",
    label: "Cash on Delivery",
    match: (row) => String(row.payment_method || "").toLowerCase() === "cash_on_delivery",
  },
  {
    key: "delivery_momo",
    label: "Delivery MoMo (Hubtel)",
    match: (row) =>
      String(row.delivery_type || "").toLowerCase() === "delivery" &&
      String(row.payment_method || "").toLowerCase() === "momo",
  },
  {
    key: "instore_cash",
    label: "In-Store Cash",
    match: (row) =>
      String(row.source || "").toLowerCase() === "instore" &&
      String(row.payment_method || "").toLowerCase() === "cash",
  },
  {
    key: "instore_momo",
    label: "In-Store MoMo (Hubtel)",
    match: (row) =>
      String(row.source || "").toLowerCase() === "instore" &&
      String(row.payment_method || "").toLowerCase() === "momo",
  },
  {
    key: "ussd_momo",
    label: "USSD MoMo (Hubtel)",
    match: (row) =>
      String(row.source || "").toLowerCase() === "ussd" &&
      String(row.payment_method || "").toLowerCase() === "momo",
  },
  {
    key: "online_momo",
    label: "Online MoMo (Hubtel)",
    match: (row) =>
      String(row.source || "").toLowerCase() === "online" &&
      String(row.payment_method || "").toLowerCase() === "momo",
  },
];

function toAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function buildMoneyBuckets(channelRows = []) {
  return MONEY_BUCKET_DEFINITIONS.map((bucket) => {
    const matched = channelRows.filter((row) => bucket.match(row));
    return {
      key: bucket.key,
      label: bucket.label,
      ordersCount: matched.reduce((sum, row) => sum + Number(row.orders_count || 0), 0),
      grossAmount: Number(matched.reduce((sum, row) => sum + toAmount(row.gross_amount), 0).toFixed(2)),
      collectedAmount: Number(matched.reduce((sum, row) => sum + toAmount(row.collected_amount), 0).toFixed(2)),
      outstandingAmount: Number(matched.reduce((sum, row) => sum + toAmount(row.outstanding_amount), 0).toFixed(2)),
    };
  });
}

async function getAnalyticsSnapshot(filters = {}) {
  const [
    dailyRevenue,
    monthlyRevenue,
    topItems,
    averageOrderValueRow,
    deliverySuccessRateRow,
    loyaltyIssuedPerDay,
    statusBreakdown,
    sourceBreakdown,
    operationalCounts,
    paymentLocationSummary,
    paymentChannelBreakdown,
    codCollectionByRider,
  ] = await Promise.all([
    getDailyRevenue(filters),
    getMonthlyRevenue(filters),
    getTopTenItems(filters),
    getAverageOrderValue(filters),
    getDeliverySuccessRate(filters),
    getLoyaltyIssuedPerDay(filters),
    getStatusBreakdown(filters),
    getSourceBreakdown(filters),
    getOperationalCounts(filters),
    getPaymentLocationSummary(filters),
    getRevenueByPaymentChannel(filters),
    getCodCollectionByRider(filters),
  ]);

  const moneyBuckets = buildMoneyBuckets(paymentChannelBreakdown);

  return {
    dailyRevenue,
    monthlyRevenue,
    topItems,
    averageOrderValue: averageOrderValueRow?.average_order_value || 0,
    deliverySuccessRate: deliverySuccessRateRow?.delivery_success_rate || 0,
    loyaltyIssuedPerDay,
    statusBreakdown,
    sourceBreakdown,
    operationalCounts: operationalCounts || {
      pending_payment_count: 0,
      preparing_count: 0,
      payment_issue_count: 0,
      completed_today_count: 0,
      delayed_count: 0,
    },
    moneyLocationSummary: {
      collectedTotal: Number(paymentLocationSummary?.collected_total || 0),
      outstandingTotal: Number(paymentLocationSummary?.outstanding_total || 0),
      refundedTotal: Number(paymentLocationSummary?.refunded_total || 0),
      canceledTotal: Number(paymentLocationSummary?.canceled_total || 0),
    },
    moneyBuckets,
    paymentChannelBreakdown: paymentChannelBreakdown || [],
    codCollectionByRider: codCollectionByRider || [],
  };
}

module.exports = { getAnalyticsSnapshot };
