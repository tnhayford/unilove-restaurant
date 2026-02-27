const { insertAuditLog } = require("../repositories/auditRepository");

async function logSensitiveAction({ actorType, actorId, action, entityType, entityId, details }) {
  await insertAuditLog({
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    details,
  });
}

module.exports = {
  logSensitiveAction,
};
