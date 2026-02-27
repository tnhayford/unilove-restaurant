const {
  listIncidents,
  createIncident,
  getIncidentById,
  updateIncident,
} = require("../repositories/incidentRepository");
const { getOrderById } = require("../repositories/orderRepository");
const { logSensitiveAction } = require("./auditService");

async function listIncidentCases(filters) {
  return listIncidents(filters);
}

async function createIncidentCase(payload) {
  const created = await createIncident(payload);
  await logSensitiveAction({
    actorType: "admin",
    actorId: payload.createdBy || null,
    action: "INCIDENT_CREATED",
    entityType: "incident",
    entityId: created.id,
    details: {
      severity: created.severity,
      status: created.status,
      category: created.category,
      orderId: created.order_id || null,
    },
  });
  return created;
}

async function updateIncidentCase({ incidentId, patch, actorId }) {
  const existing = await getIncidentById(incidentId);
  if (!existing) {
    throw Object.assign(new Error("Incident not found"), { statusCode: 404 });
  }

  const updated = await updateIncident(incidentId, patch);
  await logSensitiveAction({
    actorType: "admin",
    actorId: actorId || null,
    action: "INCIDENT_UPDATED",
    entityType: "incident",
    entityId: incidentId,
    details: {
      fromStatus: existing.status,
      toStatus: updated.status,
      severity: updated.severity,
    },
  });
  return updated;
}

const RIDER_REASON_LABELS = {
  MOTOR_BREAKDOWN: "Motor breakdown",
  ACCIDENT: "Accident",
  BAD_WEATHER: "Bad weather",
  ROAD_BLOCK: "Road blockage",
  MEDICAL_EMERGENCY: "Medical emergency",
  SECURITY_THREAT: "Security threat",
  CUSTOMER_UNREACHABLE: "Customer unreachable",
  OTHER: "Other issue",
};

function riderReasonLabel(reason) {
  const key = String(reason || "").trim().toUpperCase();
  return RIDER_REASON_LABELS[key] || "Rider incident";
}

async function createRiderIncidentCase({
  riderId,
  riderName,
  orderId,
  reason,
  note,
  location,
  severity,
}) {
  const normalizedOrderId = String(orderId || "").trim() || null;
  if (normalizedOrderId) {
    const order = await getOrderById(normalizedOrderId);
    if (!order) {
      throw Object.assign(new Error("Order not found for incident"), { statusCode: 404 });
    }
  }

  const label = riderReasonLabel(reason);
  const summaryParts = [label, String(note || "").trim()].filter(Boolean);
  const summary = summaryParts.join(": ").slice(0, 1000);
  const detailsPayload = {
    source: "rider_app",
    riderId: riderId || null,
    riderName: riderName || null,
    reason: String(reason || "").trim().toUpperCase(),
    note: String(note || "").trim(),
    location: String(location || "").trim() || null,
  };

  const created = await createIncident({
    title: `Rider Incident - ${label}`.slice(0, 140),
    severity: severity || "medium",
    status: "open",
    category: "delivery",
    summary: summary || label,
    orderId: normalizedOrderId,
    ownerUserId: null,
    startedAt: null,
    details: JSON.stringify(detailsPayload),
    createdBy: null,
  });

  await logSensitiveAction({
    actorType: "rider",
    actorId: riderId || null,
    action: "RIDER_INCIDENT_REPORTED",
    entityType: "incident",
    entityId: created.id,
    details: {
      severity: created.severity,
      orderId: normalizedOrderId,
      reason: String(reason || "").trim().toUpperCase(),
    },
  });

  return created;
}

module.exports = {
  listIncidentCases,
  createIncidentCase,
  updateIncidentCase,
  createRiderIncidentCase,
};
