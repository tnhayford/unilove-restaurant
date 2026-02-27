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
} = require("../repositories/analyticsRepository");

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
  ]);

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
  };
}

module.exports = { getAnalyticsSnapshot };
