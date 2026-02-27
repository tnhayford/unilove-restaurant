const { getOrderByOrderNumberForTracking } = require("../services/orderService");
const { openRealtimeStream } = require("../services/realtimeEventService");

async function streamOrderTrackingEvents(req, res) {
  const tracking = await getOrderByOrderNumberForTracking({
    orderNumber: req.params.orderNumber,
    trackingToken: req.query.token,
  });

  const orderNumber = String(tracking.orderNumber || "").trim().toUpperCase();
  const stream = openRealtimeStream({
    req,
    res,
    channel: `track:${orderNumber}`,
  });

  stream.send("tracking.snapshot", {
    orderNumber,
    status: tracking.status,
    updatedAt: tracking.updatedAt || null,
  });
}

function streamAdminOpsEvents(req, res) {
  const stream = openRealtimeStream({
    req,
    res,
    channel: "ops",
  });

  stream.send("ops.snapshot", {
    connectedAt: new Date().toISOString(),
    adminId: req.admin?.sub || null,
  });
}

module.exports = {
  streamOrderTrackingEvents,
  streamAdminOpsEvents,
};
