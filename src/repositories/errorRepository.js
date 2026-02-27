const { uuidv4 } = require("../utils/uuid");
const { getDb } = require("../db/connection");

async function insertErrorLog({
  level = "ERROR",
  message,
  stack,
  route,
  method,
  statusCode,
  requestId,
}) {
  const db = await getDb();
  await db.run(
    `INSERT INTO error_logs (id, level, message, stack, route, method, status_code, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      String(level || "ERROR").slice(0, 24),
      String(message || "").slice(0, 1000),
      stack ? String(stack).slice(0, 12000) : null,
      route ? String(route).slice(0, 300) : null,
      method ? String(method).slice(0, 16) : null,
      Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
      requestId ? String(requestId).slice(0, 120) : null,
    ],
  );
}

module.exports = { insertErrorLog };
