const {
  loginRider,
  registerRiderDeviceToken,
  setRiderShiftStatus,
  logoutRider,
} = require("../services/riderAuthService");

async function riderLogin(req, res) {
  const data = await loginRider(req.validatedBody);
  return res.json({ data });
}

async function registerDeviceToken(req, res) {
  const data = await registerRiderDeviceToken({
    riderId: req.rider.sub,
    riderMode: req.rider.mode,
    fcmToken: req.validatedBody.fcmToken,
    deviceId: req.validatedBody.deviceId,
    platform: req.validatedBody.platform,
  });
  return res.json({ data });
}

async function updateShiftStatus(req, res) {
  const data = await setRiderShiftStatus({
    riderId: req.rider?.sub,
    riderMode: req.rider?.mode,
    riderName: req.rider?.name,
    shiftStatus: req.validatedBody.shiftStatus,
    note: req.validatedBody.note,
  });
  return res.json({ data });
}

async function riderLogout(req, res) {
  const data = await logoutRider({
    riderId: req.rider?.sub,
    riderMode: req.rider?.mode,
    riderName: req.rider?.name,
  });
  return res.json({ data });
}

module.exports = {
  riderLogin,
  registerDeviceToken,
  updateShiftStatus,
  riderLogout,
};
