const {
  getLoyaltySummary,
  listLoyaltyLedger,
} = require("../repositories/loyaltyRepository");

async function getLoyaltyOpsSnapshot(filters = {}) {
  const [summary, ledger] = await Promise.all([
    getLoyaltySummary(filters),
    listLoyaltyLedger(filters),
  ]);

  const reversalRate = summary.issuedPoints > 0
    ? Number(((summary.reversedPoints / summary.issuedPoints) * 100).toFixed(2))
    : 0;

  return {
    summary: {
      ...summary,
      reversalRate,
    },
    ledger: ledger.rows || [],
    total: Number(ledger.total || 0),
  };
}

module.exports = {
  getLoyaltyOpsSnapshot,
};
