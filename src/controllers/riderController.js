const { getRiderQueue } = require("../services/orderService");
const { createRiderIncidentCase } = require("../services/incidentService");
const {
  markRiderPresence,
  getRiderPresenceSnapshot,
} = require("../services/riderPresenceService");

const PRESENCE_WRITE_COOLDOWN_MS = 60 * 1000;

function parseDbTimestamp(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const date = new Date(`${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function listRiderQueue(req, res) {
  const limit = Number(req.query.limit || 80);
  const riderId = String(req.rider?.sub || "").trim();
  const riderMode = String(req.rider?.mode || "staff").trim().toLowerCase();
  const riderName = String(req.rider?.name || "").trim();

  if (riderId) {
    const snapshot = await getRiderPresenceSnapshot(riderId);
    const lastSeenAt = parseDbTimestamp(snapshot?.last_seen_at);
    const recentlySeen =
      lastSeenAt && Date.now() - lastSeenAt.getTime() < PRESENCE_WRITE_COOLDOWN_MS;

    if (!recentlySeen) {
      await markRiderPresence({
        riderId,
        mode: riderMode,
        displayName: riderName || riderId,
        shiftStatus: "online",
        markSeen: true,
        markLogin: false,
      });
    }
  }

  const data = await getRiderQueue(limit, { riderId, riderMode });
  return res.json({ data });
}

function inferSeverity(reason) {
  const normalized = String(reason || "").trim().toUpperCase();
  if (["MOTOR_BREAKDOWN", "ACCIDENT", "MEDICAL_EMERGENCY", "SECURITY_THREAT"].includes(normalized)) {
    return "high";
  }
  if (["BAD_WEATHER", "ROAD_BLOCK", "CUSTOMER_UNREACHABLE"].includes(normalized)) {
    return "medium";
  }
  return "low";
}

async function reportRiderIncident(req, res) {
  const rider = req.rider || {};
  const created = await createRiderIncidentCase({
    riderId: rider.sub,
    riderName: rider.name || "",
    orderId: req.validatedBody.orderId,
    reason: req.validatedBody.reason,
    note: req.validatedBody.note,
    location: req.validatedBody.location,
    severity: req.validatedBody.severity || inferSeverity(req.validatedBody.reason),
  });

  return res.status(201).json({
    data: {
      incidentId: created.id,
      status: created.status,
      severity: created.severity,
    },
  });
}

module.exports = {
  listRiderQueue,
  reportRiderIncident,
};
