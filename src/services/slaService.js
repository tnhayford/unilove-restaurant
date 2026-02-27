const { listSlaBreaches } = require("../repositories/slaRepository");
const { getSetting, upsertSetting } = require("../repositories/systemSettingsRepository");
const { logSensitiveAction } = require("./auditService");

const KEY_PENDING = "sla_pending_payment_min";
const KEY_KITCHEN = "sla_kitchen_min";
const KEY_DELIVERY = "sla_delivery_min";

function toMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(240, Math.round(parsed)));
}

async function getSlaConfig() {
  const [pendingRow, kitchenRow, deliveryRow] = await Promise.all([
    getSetting(KEY_PENDING),
    getSetting(KEY_KITCHEN),
    getSetting(KEY_DELIVERY),
  ]);

  return {
    pendingPaymentMinutes: toMinutes(pendingRow?.setting_value, 10),
    kitchenMinutes: toMinutes(kitchenRow?.setting_value, 25),
    deliveryMinutes: toMinutes(deliveryRow?.setting_value, 45),
  };
}

async function updateSlaConfig({ pendingPaymentMinutes, kitchenMinutes, deliveryMinutes, actorId }) {
  const next = {
    pendingPaymentMinutes: toMinutes(pendingPaymentMinutes, 10),
    kitchenMinutes: toMinutes(kitchenMinutes, 25),
    deliveryMinutes: toMinutes(deliveryMinutes, 45),
  };

  await Promise.all([
    upsertSetting(KEY_PENDING, String(next.pendingPaymentMinutes)),
    upsertSetting(KEY_KITCHEN, String(next.kitchenMinutes)),
    upsertSetting(KEY_DELIVERY, String(next.deliveryMinutes)),
  ]);

  await logSensitiveAction({
    actorType: "admin",
    actorId: actorId || null,
    action: "SLA_CONFIG_UPDATED",
    entityType: "system_setting",
    entityId: "sla_config",
    details: next,
  });

  return next;
}

async function getSlaBreaches({ searchText, limit, offset }) {
  const config = await getSlaConfig();
  const result = await listSlaBreaches({
    pendingMinutes: config.pendingPaymentMinutes,
    kitchenMinutes: config.kitchenMinutes,
    deliveryMinutes: config.deliveryMinutes,
    searchText,
    limit,
    offset,
  });

  return {
    ...result,
    config,
  };
}

module.exports = {
  getSlaConfig,
  updateSlaConfig,
  getSlaBreaches,
};
