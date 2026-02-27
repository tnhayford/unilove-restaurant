const {
  getOperationsPolicy,
  updateOperationsPolicy,
} = require("../services/operationsPolicyService");

async function getAdminOperationsPolicy(req, res) {
  const data = await getOperationsPolicy();
  return res.json({ data });
}

async function setAdminOperationsPolicy(req, res) {
  const data = await updateOperationsPolicy(req.validatedBody, {
    actorId: req.admin?.sub || null,
  });
  return res.json({ data });
}

module.exports = {
  getAdminOperationsPolicy,
  setAdminOperationsPolicy,
};
