const {
  listDisputes,
  createDispute,
  getDisputeById,
  updateDispute,
} = require("../repositories/disputeRepository");
const { logSensitiveAction } = require("./auditService");

async function listDisputeCases(filters) {
  return listDisputes(filters);
}

async function createDisputeCase(payload) {
  const created = await createDispute(payload);
  await logSensitiveAction({
    actorType: "admin",
    actorId: payload.createdBy || null,
    action: "DISPUTE_CREATED",
    entityType: "dispute",
    entityId: created.id,
    details: {
      status: created.status,
      disputeType: created.dispute_type,
      orderId: created.order_id || null,
    },
  });
  return created;
}

async function updateDisputeCase({ disputeId, patch, actorId }) {
  const existing = await getDisputeById(disputeId);
  if (!existing) {
    throw Object.assign(new Error("Dispute not found"), { statusCode: 404 });
  }

  const updated = await updateDispute(disputeId, patch, actorId || null);
  await logSensitiveAction({
    actorType: "admin",
    actorId: actorId || null,
    action: "DISPUTE_UPDATED",
    entityType: "dispute",
    entityId: disputeId,
    details: {
      fromStatus: existing.status,
      toStatus: updated.status,
      disputeType: updated.dispute_type,
    },
  });
  return updated;
}

module.exports = {
  listDisputeCases,
  createDisputeCase,
  updateDisputeCase,
};
