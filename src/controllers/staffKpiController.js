const { getMyStaffKpi } = require("../services/staffKpiService");

async function getMyKpi(req, res) {
  const data = await getMyStaffKpi(req.admin?.sub || "");
  return res.json({ data });
}

module.exports = {
  getMyKpi,
};
