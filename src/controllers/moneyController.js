const { getTodayMoneySummary } = require("../services/moneyService");

async function getTodayMoney(req, res) {
  const data = await getTodayMoneySummary();
  return res.json({ data });
}

module.exports = {
  getTodayMoney,
};
