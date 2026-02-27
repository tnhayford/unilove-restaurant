const {
  listOpenDeliveryOrdersForAssignment,
  setAssignedRider,
  getOrderById,
} = require("../repositories/orderRepository");
const {
  listActiveAssignableRiders,
} = require("./riderPresenceService");
const { publishOrderEvent } = require("./realtimeEventService");

const READY_FOR_PICKUP_STATUS = "READY_FOR_PICKUP";
const OUT_FOR_DELIVERY_STATUS = "OUT_FOR_DELIVERY";

function parseDbTimestamp(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const date = new Date(`${raw}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeAssignedRiderId(input) {
  return String(input || "").trim();
}

function compareByCreatedAt(left, right) {
  const leftDate = parseDbTimestamp(left.created_at || left.updated_at);
  const rightDate = parseDbTimestamp(right.created_at || right.updated_at);
  if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) {
    return leftDate.getTime() - rightDate.getTime();
  }
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function pickLeastLoadedRider(activeRiders, workloadByRider) {
  if (!activeRiders.length) return null;

  let selected = activeRiders[0];
  let selectedLoad = workloadByRider.get(selected.id) || 0;

  for (let index = 1; index < activeRiders.length; index += 1) {
    const candidate = activeRiders[index];
    const candidateLoad = workloadByRider.get(candidate.id) || 0;
    if (candidateLoad < selectedLoad) {
      selected = candidate;
      selectedLoad = candidateLoad;
    }
  }

  return selected;
}

function toWorkloadMapObject(workloadByRider) {
  const output = {};
  for (const [riderId, load] of workloadByRider.entries()) {
    output[riderId] = Number(load || 0);
  }
  return output;
}

async function publishAssignmentUpdate(orderId) {
  const order = await getOrderById(orderId);
  if (!order) return;
  publishOrderEvent("order.assignment_updated", {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    deliveryType: order.delivery_type,
    assignedRiderId: order.assigned_rider_id,
    updatedAt: order.updated_at || null,
    context: { source: "auto_workload_balancer" },
  });
}

async function assignDeliveryOrdersByWorkload({ targetOrderId = null } = {}) {
  const activeRiders = await listActiveAssignableRiders();
  const activeRiderIds = activeRiders.map((row) => row.id);
  const activeRiderIdSet = new Set(activeRiderIds);
  const workloadByRider = new Map(activeRiderIds.map((id) => [id, 0]));
  const rows = await listOpenDeliveryOrdersForAssignment(400);

  let updated = 0;
  let targetOrderAssignedRiderId = null;

  if (!rows.length || !activeRiders.length) {
    return {
      activeRiderIds,
      workloadByRider: toWorkloadMapObject(workloadByRider),
      updated,
      targetOrderAssignedRiderId,
    };
  }

  if (activeRiders.length === 1) {
    const soleRiderId = activeRiderIds[0];
    for (const row of rows) {
      const assigned = normalizeAssignedRiderId(row.assigned_rider_id);
      if (assigned !== soleRiderId) {
        await setAssignedRider(row.id, soleRiderId);
        await publishAssignmentUpdate(row.id);
        updated += 1;
      }
      workloadByRider.set(soleRiderId, (workloadByRider.get(soleRiderId) || 0) + 1);
      if (targetOrderId && String(row.id) === String(targetOrderId)) {
        targetOrderAssignedRiderId = soleRiderId;
      }
    }
    return {
      activeRiderIds,
      workloadByRider: toWorkloadMapObject(workloadByRider),
      updated,
      targetOrderAssignedRiderId,
    };
  }

  const outForDeliveryRows = rows
    .filter((row) => row.status === OUT_FOR_DELIVERY_STATUS)
    .sort(compareByCreatedAt);
  const readyForPickupRows = rows
    .filter((row) => row.status === READY_FOR_PICKUP_STATUS)
    .sort(compareByCreatedAt);

  for (const row of outForDeliveryRows) {
    const assigned = normalizeAssignedRiderId(row.assigned_rider_id);
    let nextAssigned = assigned;
    if (!activeRiderIdSet.has(assigned)) {
      const candidate = pickLeastLoadedRider(activeRiders, workloadByRider);
      if (!candidate) continue;
      nextAssigned = candidate.id;
      if (assigned !== nextAssigned) {
        await setAssignedRider(row.id, nextAssigned);
        await publishAssignmentUpdate(row.id);
        updated += 1;
      }
    }

    workloadByRider.set(nextAssigned, (workloadByRider.get(nextAssigned) || 0) + 1);
    if (targetOrderId && String(row.id) === String(targetOrderId)) {
      targetOrderAssignedRiderId = nextAssigned;
    }
  }

  for (const row of readyForPickupRows) {
    const assigned = normalizeAssignedRiderId(row.assigned_rider_id);
    let nextAssigned = assigned;

    if (!activeRiderIdSet.has(assigned)) {
      const candidate = pickLeastLoadedRider(activeRiders, workloadByRider);
      if (!candidate) continue;
      nextAssigned = candidate.id;
      if (assigned !== nextAssigned) {
        await setAssignedRider(row.id, nextAssigned);
        await publishAssignmentUpdate(row.id);
        updated += 1;
      }
    }

    workloadByRider.set(nextAssigned, (workloadByRider.get(nextAssigned) || 0) + 1);
    if (targetOrderId && String(row.id) === String(targetOrderId)) {
      targetOrderAssignedRiderId = nextAssigned;
    }
  }

  return {
    activeRiderIds,
    workloadByRider: toWorkloadMapObject(workloadByRider),
    updated,
    targetOrderAssignedRiderId,
  };
}

module.exports = {
  listActiveAssignableRiders,
  assignDeliveryOrdersByWorkload,
};
