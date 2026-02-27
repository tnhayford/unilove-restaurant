const { getDb } = require("../db/connection");
const { getSlaBreaches } = require("./slaService");
const { sendSms } = require("./smsService");
const { logSensitiveAction } = require("./auditService");
const env = require("../config/env");

const ESCALATION_STEPS = [
  { level: 1, overrunMinutes: 0 },
  { level: 2, overrunMinutes: 15 },
  { level: 3, overrunMinutes: 30 },
];

function parsePhones(raw) {
  return String(raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function getEvent(orderId) {
  const db = await getDb();
  return db.get("SELECT * FROM sla_alert_events WHERE order_id = ?", [orderId]);
}

async function upsertEvent({ orderId, status, targetMinutes, level }) {
  const db = await getDb();
  const nowSql = "datetime('now')";
  await db.run(
    `INSERT INTO sla_alert_events (
      id, order_id, status, target_minutes, first_alert_at, last_alert_at, escalation_level
    ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ${nowSql}, ${nowSql}, ?)
    ON CONFLICT(order_id) DO UPDATE
    SET status = excluded.status,
        target_minutes = excluded.target_minutes,
        last_alert_at = ${nowSql},
        escalation_level = CASE
          WHEN excluded.escalation_level > escalation_level THEN excluded.escalation_level
          ELSE escalation_level
        END,
        resolved_at = NULL`,
    [orderId, status, targetMinutes, level],
  );
}

async function markResolvedForNonBreached(activeOrderIds) {
  const db = await getDb();
  if (!activeOrderIds.length) {
    await db.run(
      `UPDATE sla_alert_events
       SET resolved_at = datetime('now')
       WHERE resolved_at IS NULL`,
    );
    return;
  }

  const placeholders = activeOrderIds.map(() => "?").join(",");
  await db.run(
    `UPDATE sla_alert_events
     SET resolved_at = datetime('now')
     WHERE resolved_at IS NULL
       AND order_id NOT IN (${placeholders})`,
    activeOrderIds,
  );
}

function computeEscalationLevel(overrunMinutes) {
  let level = 1;
  ESCALATION_STEPS.forEach((step) => {
    if (overrunMinutes >= step.overrunMinutes) {
      level = step.level;
    }
  });
  return level;
}

async function runSlaAlertSweep() {
  const phones = parsePhones(env.slaAlertPhones || "");
  if (!phones.length) return { checked: 0, alerted: 0 };

  const result = await getSlaBreaches({ searchText: "", limit: 200, offset: 0 });
  const rows = result.rows || [];

  let alerted = 0;
  for (const row of rows) {
    const target = Number(row.sla_target_minutes || 0);
    const age = Number(row.age_minutes || 0);
    const overrun = Math.max(0, age - target);
    const nextLevel = computeEscalationLevel(overrun);
    const existing = await getEvent(row.id);

    if (!existing || nextLevel > Number(existing.escalation_level || 0)) {
      const message = `SLA Alert L${nextLevel}: ${row.order_number} ${row.status} overrun ${overrun}m (target ${target}m).`;
      for (const phone of phones) {
        await sendSms({ orderId: row.id, toPhone: phone, message });
      }
      await upsertEvent({
        orderId: row.id,
        status: row.status,
        targetMinutes: target,
        level: nextLevel,
      });
      alerted += 1;

      await logSensitiveAction({
        actorType: "system",
        actorId: null,
        action: "SLA_BREACH_ALERT_SENT",
        entityType: "order",
        entityId: row.id,
        details: {
          orderNumber: row.order_number,
          status: row.status,
          overrun,
          escalationLevel: nextLevel,
        },
      });
    }
  }

  await markResolvedForNonBreached(rows.map((row) => row.id));
  return { checked: rows.length, alerted };
}

module.exports = {
  runSlaAlertSweep,
};
