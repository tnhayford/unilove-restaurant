const { logSensitiveAction } = require("../services/auditService");

async function createUiEvent(req, res) {
  const body = req.validatedBody || {};
  await logSensitiveAction({
    actorType: "admin",
    actorId: req.admin?.sub || null,
    action: "ADMIN_UI_BUTTON_CLICK",
    entityType: "ui_event",
    entityId: body.targetId || null,
    details: {
      eventType: body.eventType || "button_click",
      targetText: body.targetText || "",
      targetClass: body.targetClass || "",
      pagePath: body.pagePath || "",
    },
  });
  return res.status(201).json({ data: { success: true } });
}

module.exports = {
  createUiEvent,
};
