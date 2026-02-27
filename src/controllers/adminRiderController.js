const { listOutForDeliveryOrders } = require("../repositories/orderRepository");
const { assignDeliveryOrdersByWorkload } = require("../services/riderAssignmentService");
const { listRiderRoster } = require("../services/riderPresenceService");

async function listAdminRiders(req, res) {
  const reconcile =
    String(req.query.reconcile || "").trim().toLowerCase() === "true";
  if (reconcile) {
    await assignDeliveryOrdersByWorkload();
  }

  const [riderRows, deliveryQueue] = await Promise.all([
    listRiderRoster(),
    listOutForDeliveryOrders(120),
  ]);

  const workloadByRider = new Map();
  for (const row of deliveryQueue) {
    const assignedRiderId = String(row.assigned_rider_id || "").trim();
    if (!assignedRiderId) continue;
    workloadByRider.set(
      assignedRiderId,
      (workloadByRider.get(assignedRiderId) || 0) + 1,
    );
  }

  const normalized = riderRows.map((row) => {
    const assignedOrderCount = workloadByRider.get(row.id) || 0;
    const online = row.status !== "offline";
    return {
      id: row.id,
      fullName: row.fullName,
      mode: row.mode || "staff",
      source: row.source || null,
      status: online ? (assignedOrderCount > 0 ? "busy" : "available") : "offline",
      assignedOrderCount,
      shiftStatus: row.shiftStatus || (online ? "online" : "offline"),
      isActive: Boolean(row.isActive),
      isManaged: Boolean(row.isManaged),
      lastLoginAt: row.lastLoginAt || null,
      lastSeenAt: row.lastSeenAt || null,
      lastShiftOnAt: row.lastShiftOnAt || null,
      lastShiftOffAt: row.lastShiftOffAt || null,
    };
  });

  const statusRank = {
    busy: 0,
    available: 1,
    offline: 2,
  };

  normalized.sort((left, right) => {
    const statusDiff = (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9);
    if (statusDiff) return statusDiff;
    return String(left.fullName || "").localeCompare(String(right.fullName || ""));
  });

  return res.json({ data: normalized });
}

module.exports = {
  listAdminRiders,
};
