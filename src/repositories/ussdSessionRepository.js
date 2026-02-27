const { getDb } = require("../db/connection");

async function getSession(sessionId) {
  const db = await getDb();
  return db.get("SELECT * FROM ussd_sessions WHERE session_id = ?", [sessionId]);
}

async function upsertSession({ sessionId, phone, state, stateData }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO ussd_sessions (session_id, phone, state, state_data, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id)
     DO UPDATE SET phone = excluded.phone,
                   state = excluded.state,
                   state_data = excluded.state_data,
                   updated_at = datetime('now')`,
    [sessionId, phone, state, JSON.stringify(stateData || {})],
  );
}

async function getLatestSessionByPhone(phone, excludeSessionId = "") {
  const db = await getDb();
  return db.get(
    `SELECT *
     FROM ussd_sessions
     WHERE phone = ?
       AND (? = '' OR session_id <> ?)
     ORDER BY datetime(updated_at) DESC
     LIMIT 1`,
    [phone, excludeSessionId || "", excludeSessionId || ""],
  );
}

async function deleteSession(sessionId) {
  const db = await getDb();
  await db.run("DELETE FROM ussd_sessions WHERE session_id = ?", [sessionId]);
}

module.exports = {
  getSession,
  upsertSession,
  getLatestSessionByPhone,
  deleteSession,
};
