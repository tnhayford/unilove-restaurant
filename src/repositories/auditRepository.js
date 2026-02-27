const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function insertAuditLog({ actorType, actorId, action, entityType, entityId, details }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      actorType,
      actorId || null,
      action,
      entityType,
      entityId || null,
      details ? JSON.stringify(details) : null,
    ],
  );
}

module.exports = { insertAuditLog };
