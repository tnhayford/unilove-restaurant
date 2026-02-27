const {
  getStoreStatus,
  updateStoreStatus,
} = require("../services/storeStatusService");

async function getPublicStoreStatus(req, res) {
  const status = await getStoreStatus();
  return res.json({
    data: {
      isOpen: status.isOpen,
      closureMessage: status.closureMessage,
    },
  });
}

async function getAdminStoreStatus(req, res) {
  const status = await getStoreStatus();
  return res.json({ data: status });
}

async function setAdminStoreStatus(req, res) {
  const status = await updateStoreStatus({
    isOpen: req.validatedBody.isOpen,
    closureMessage: req.validatedBody.closureMessage,
    actorId: req.admin.sub,
  });
  return res.json({ data: status });
}

module.exports = {
  getPublicStoreStatus,
  getAdminStoreStatus,
  setAdminStoreStatus,
};
