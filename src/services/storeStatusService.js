const {
  getSetting,
  upsertSetting,
} = require("../repositories/systemSettingsRepository");
const { logSensitiveAction } = require("./auditService");

const STORE_OPEN_KEY = "store_open";
const STORE_CLOSURE_MESSAGE_KEY = "store_closure_message";
const DEFAULT_CLOSURE_MESSAGE =
  "Unilove Foods is currently closed for new orders. Please try again later.";

function parseBoolean(value, fallback = true) {
  if (value === null || value === undefined) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeMessage(input) {
  const value = String(input || "").trim();
  return value || DEFAULT_CLOSURE_MESSAGE;
}

async function getStoreStatus() {
  const [openRow, messageRow] = await Promise.all([
    getSetting(STORE_OPEN_KEY),
    getSetting(STORE_CLOSURE_MESSAGE_KEY),
  ]);

  return {
    isOpen: parseBoolean(openRow?.setting_value, true),
    closureMessage: normalizeMessage(messageRow?.setting_value),
    updatedAt: openRow?.updated_at || messageRow?.updated_at || null,
  };
}

async function updateStoreStatus({ isOpen, closureMessage, actorId }) {
  const nextOpen = Boolean(isOpen);
  const nextMessage = normalizeMessage(closureMessage);

  await Promise.all([
    upsertSetting(STORE_OPEN_KEY, nextOpen ? "true" : "false"),
    upsertSetting(STORE_CLOSURE_MESSAGE_KEY, nextMessage),
  ]);

  await logSensitiveAction({
    actorType: "admin",
    actorId: actorId || null,
    action: "STORE_STATUS_UPDATED",
    entityType: "system_setting",
    entityId: STORE_OPEN_KEY,
    details: {
      isOpen: nextOpen,
      closureMessage: nextMessage,
    },
  });

  return getStoreStatus();
}

async function ensureStoreOpenForOrdering() {
  const status = await getStoreStatus();
  if (!status.isOpen) {
    throw Object.assign(new Error(status.closureMessage), { statusCode: 503 });
  }
}

module.exports = {
  DEFAULT_CLOSURE_MESSAGE,
  getStoreStatus,
  updateStoreStatus,
  ensureStoreOpenForOrdering,
};
