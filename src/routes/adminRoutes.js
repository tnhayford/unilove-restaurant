const express = require("express");
const rateLimit = require("express-rate-limit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { validate } = require("../middleware/validate");
const { requireAdminAuth, requireRole } = require("../middleware/auth");
const { requirePermission, requireAnyPermission } = require("../middleware/permissions");
const { issueCsrfToken, requireCsrf } = require("../middleware/csrf");
const {
  adminLoginSchema,
  adminOrderStatusUpdateSchema,
  adminOrderAssignRiderSchema,
  adminMenuAvailabilityUpdateSchema,
  adminInstoreOrderSchema,
  adminInstoreMomoRetrySchema,
  adminMomoVerificationSchema,
  adminStaffCreateSchema,
  adminStaffUpdateSchema,
  adminStaffPermissionsUpdateSchema,
  adminOperationsPolicyUpdateSchema,
  adminRiderCreateSchema,
  adminRiderUpdateSchema,
  adminMenuItemCreateSchema,
  adminMenuItemUpdateSchema,
  adminMenuCategoryCreateSchema,
  adminMenuCategoryRenameSchema,
  adminMenuCategoryDeleteSchema,
  adminStoreStatusUpdateSchema,
  adminIncidentCreateSchema,
  adminIncidentUpdateSchema,
  adminDisputeCreateSchema,
  adminDisputeUpdateSchema,
  adminSlaConfigUpdateSchema,
  adminUiEventSchema,
} = require("./schemas");
const {
  login,
  logout,
  me,
} = require("../controllers/adminAuthController");
const {
  listOrders,
  listOrderHistory,
  getOrder,
  monitorOrder,
  updateOrderStatus,
  assignRider,
  createInstoreOrder,
  statusCheckInstoreMomoPayment,
  retryInstoreMomoPrompt,
  getOrderPolicy,
  resetDeliveryAttempts,
  regenerateDeliveryCode,
} = require("../controllers/adminOrderController");
const {
  listMenuForAdmin,
  setMenuAvailability,
  listMenuCategories,
  createMenuItem,
  updateMenuItem,
  removeMenuItem,
  createMenuCategory,
  renameMenuCategory,
  removeMenuCategory,
  optimizeMenuUssdNames,
} = require("../controllers/adminMenuController");
const { getAnalytics } = require("../controllers/analyticsController");
const { getLoyaltyOps } = require("../controllers/loyaltyController");
const { listLogs } = require("../controllers/adminLogController");
const { createUiEvent } = require("../controllers/uiEventController");
const {
  listStaff,
  createStaff,
  updateStaff,
  removeStaff,
  getStaffPermissions,
  updateStaffPermissions,
} = require("../controllers/staffController");
const {
  listRiderAccounts,
  createRiderAccount,
  updateRiderAccount,
} = require("../controllers/adminRiderManagementController");
const {
  runStatusCheck,
  runPendingReconciliation,
  verifyInstoreMomoCustomer,
} = require("../controllers/paymentController");
const { searchCustomers } = require("../controllers/adminCustomerController");
const {
  getAdminStoreStatus,
  setAdminStoreStatus,
} = require("../controllers/storeStatusController");
const {
  getAdminOperationsPolicy,
  setAdminOperationsPolicy,
} = require("../controllers/adminOperationsSettingsController");
const {
  listIncidents,
  createIncident,
  updateIncident,
} = require("../controllers/incidentController");
const {
  listDisputes,
  createDispute,
  updateDispute,
} = require("../controllers/disputeController");
const {
  getSla,
  getSlaSettings,
  updateSlaSettings,
} = require("../controllers/slaController");
const { listAdminRiders } = require("../controllers/adminRiderController");
const {
  createReport,
  listReports,
  getReport,
  downloadReport,
  createReportSchedule,
  listReportSchedules,
  patchReportSchedule,
  removeReportSchedule,
} = require("../controllers/reportController");
const { streamAdminOpsEvents } = require("../controllers/realtimeController");
const env = require("../config/env");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts" },
});

router.get("/auth/csrf-token", issueCsrfToken);
router.post(
  "/auth/login",
  authLimiter,
  requireCsrf,
  validate(adminLoginSchema),
  asyncHandler(login),
);
router.get("/auth/me", requireAdminAuth, asyncHandler(me));
router.post("/auth/logout", requireAdminAuth, requireCsrf, asyncHandler(logout));

router.get("/orders", requireAdminAuth, requirePermission("orders.view"), asyncHandler(listOrders));
router.get(
  "/events/ops-stream",
  requireAdminAuth,
  requirePermission("orders.view"),
  asyncHandler(streamAdminOpsEvents),
);
router.get("/riders", requireAdminAuth, requirePermission("orders.view"), asyncHandler(listAdminRiders));
router.get(
  "/riders/accounts",
  requireAdminAuth,
  requireRole("admin"),
  requirePermission("staff.manage"),
  asyncHandler(listRiderAccounts),
);
router.post(
  "/riders/accounts",
  requireAdminAuth,
  requireRole("admin"),
  requirePermission("staff.manage"),
  requireCsrf,
  validate(adminRiderCreateSchema),
  asyncHandler(createRiderAccount),
);
router.patch(
  "/riders/accounts/:riderId",
  requireAdminAuth,
  requireRole("admin"),
  requirePermission("staff.manage"),
  requireCsrf,
  validate(adminRiderUpdateSchema),
  asyncHandler(updateRiderAccount),
);
router.get("/orders/policy", requireAdminAuth, asyncHandler(getOrderPolicy));
router.get("/customers/search", requireAdminAuth, requirePermission("orders.view"), asyncHandler(searchCustomers));
router.get(
  "/store/status",
  requireAdminAuth,
  requirePermission("settings.store"),
  asyncHandler(getAdminStoreStatus),
);
router.patch(
  "/store/status",
  requireAdminAuth,
  requirePermission("settings.store"),
  requireCsrf,
  validate(adminStoreStatusUpdateSchema),
  asyncHandler(setAdminStoreStatus),
);
router.get(
  "/settings/operations",
  requireAdminAuth,
  requirePermission("settings.sla"),
  asyncHandler(getAdminOperationsPolicy),
);
router.patch(
  "/settings/operations",
  requireAdminAuth,
  requirePermission("settings.sla"),
  requireCsrf,
  validate(adminOperationsPolicyUpdateSchema),
  asyncHandler(setAdminOperationsPolicy),
);
router.get("/orders/history", requireAdminAuth, requirePermission("orders.view"), asyncHandler(listOrderHistory));
router.get("/orders/:orderId", requireAdminAuth, requirePermission("orders.view"), asyncHandler(getOrder));
router.post(
  "/orders/:orderId/monitor",
  requireAdminAuth,
  requirePermission("orders.monitor"),
  requireCsrf,
  asyncHandler(monitorOrder),
);
router.patch(
  "/orders/:orderId/status",
  requireAdminAuth,
  requirePermission("orders.update_status"),
  requireCsrf,
  validate(adminOrderStatusUpdateSchema),
  asyncHandler(updateOrderStatus),
);
router.patch(
  "/orders/:orderId/assign-rider",
  requireAdminAuth,
  requirePermission("orders.update_status"),
  requireCsrf,
  validate(adminOrderAssignRiderSchema),
  asyncHandler(assignRider),
);
router.post(
  "/orders/:orderId/delivery/reset-attempts",
  requireAdminAuth,
  requirePermission("orders.update_status"),
  requireCsrf,
  asyncHandler(resetDeliveryAttempts),
);
router.post(
  "/orders/:orderId/delivery/regenerate-code",
  requireAdminAuth,
  requirePermission("orders.update_status"),
  requireCsrf,
  asyncHandler(regenerateDeliveryCode),
);
router.post(
  "/orders/instore",
  requireAdminAuth,
  requirePermission("instore.create"),
  requireCsrf,
  validate(adminInstoreOrderSchema),
  asyncHandler(createInstoreOrder),
);
router.post(
  "/orders/:orderId/payments/momo/status-check",
  requireAdminAuth,
  requirePermission("instore.create"),
  requireCsrf,
  asyncHandler(statusCheckInstoreMomoPayment),
);
router.post(
  "/orders/:orderId/payments/momo/retry",
  requireAdminAuth,
  requirePermission("instore.create"),
  requireCsrf,
  validate(adminInstoreMomoRetrySchema),
  asyncHandler(retryInstoreMomoPrompt),
);

router.get("/menu", requireAdminAuth, requirePermission("menu.view"), asyncHandler(listMenuForAdmin));
router.get("/menu/categories", requireAdminAuth, requirePermission("menu.view"), asyncHandler(listMenuCategories));
router.post(
  "/menu",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuItemCreateSchema),
  asyncHandler(createMenuItem),
);
router.post(
  "/menu/ussd/optimize",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  asyncHandler(optimizeMenuUssdNames),
);
router.post(
  "/menu/categories",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuCategoryCreateSchema),
  asyncHandler(createMenuCategory),
);
router.patch(
  "/menu/categories/rename",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuCategoryRenameSchema),
  asyncHandler(renameMenuCategory),
);
router.delete(
  "/menu/categories/remove",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuCategoryDeleteSchema),
  asyncHandler(removeMenuCategory),
);
router.patch(
  "/menu/:itemId",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuItemUpdateSchema),
  asyncHandler(updateMenuItem),
);
router.delete(
  "/menu/:itemId",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  asyncHandler(removeMenuItem),
);
router.patch(
  "/menu/:itemId/availability",
  requireAdminAuth,
  requirePermission("menu.edit"),
  requireCsrf,
  validate(adminMenuAvailabilityUpdateSchema),
  asyncHandler(setMenuAvailability),
);

router.get("/analytics", requireAdminAuth, requirePermission("analytics.view"), asyncHandler(getAnalytics));
router.get("/loyalty", requireAdminAuth, requirePermission("analytics.view"), asyncHandler(getLoyaltyOps));
router.get(
  "/sla",
  requireAdminAuth,
  requireAnyPermission(["analytics.view", "settings.sla"]),
  asyncHandler(getSla),
);
router.get("/sla/settings", requireAdminAuth, requirePermission("settings.sla"), asyncHandler(getSlaSettings));
router.patch(
  "/sla/settings",
  requireAdminAuth,
  requirePermission("settings.sla"),
  requireCsrf,
  validate(adminSlaConfigUpdateSchema),
  asyncHandler(updateSlaSettings),
);
router.get("/logs", requireAdminAuth, requirePermission("logs.view"), asyncHandler(listLogs));
router.post(
  "/ui-events",
  requireAdminAuth,
  requireCsrf,
  validate(adminUiEventSchema),
  asyncHandler(createUiEvent),
);
router.get("/incidents", requireAdminAuth, requirePermission("incidents.manage"), asyncHandler(listIncidents));
router.post(
  "/incidents",
  requireAdminAuth,
  requirePermission("incidents.manage"),
  requireCsrf,
  validate(adminIncidentCreateSchema),
  asyncHandler(createIncident),
);
router.patch(
  "/incidents/:incidentId",
  requireAdminAuth,
  requirePermission("incidents.manage"),
  requireCsrf,
  validate(adminIncidentUpdateSchema),
  asyncHandler(updateIncident),
);
router.get("/disputes", requireAdminAuth, requirePermission("disputes.manage"), asyncHandler(listDisputes));
router.post(
  "/disputes",
  requireAdminAuth,
  requirePermission("disputes.manage"),
  requireCsrf,
  validate(adminDisputeCreateSchema),
  asyncHandler(createDispute),
);
router.patch(
  "/disputes/:disputeId",
  requireAdminAuth,
  requirePermission("disputes.manage"),
  requireCsrf,
  validate(adminDisputeUpdateSchema),
  asyncHandler(updateDispute),
);
router.get("/staff", requireAdminAuth, requirePermission("staff.manage"), asyncHandler(listStaff));
router.post(
  "/staff",
  requireAdminAuth,
  requirePermission("staff.manage"),
  requireCsrf,
  validate(adminStaffCreateSchema),
  asyncHandler(createStaff),
);
router.patch(
  "/staff/:userId",
  requireAdminAuth,
  requirePermission("staff.manage"),
  requireCsrf,
  validate(adminStaffUpdateSchema),
  asyncHandler(updateStaff),
);
router.get(
  "/staff/:userId/permissions",
  requireAdminAuth,
  requirePermission("staff.manage"),
  asyncHandler(getStaffPermissions),
);
router.patch(
  "/staff/:userId/permissions",
  requireAdminAuth,
  requirePermission("staff.manage"),
  requireCsrf,
  validate(adminStaffPermissionsUpdateSchema),
  asyncHandler(updateStaffPermissions),
);
router.delete(
  "/staff/:userId",
  requireAdminAuth,
  requirePermission("staff.manage"),
  requireCsrf,
  asyncHandler(removeStaff),
);
router.get(
  "/payments/status-check/:clientReference",
  requireAdminAuth,
  requirePermission("payments.reconcile"),
  asyncHandler(runStatusCheck),
);
router.post(
  "/payments/verify-customer",
  requireAdminAuth,
  requirePermission("instore.create"),
  requireCsrf,
  validate(adminMomoVerificationSchema),
  asyncHandler(verifyInstoreMomoCustomer),
);
router.post(
  "/payments/reconcile",
  requireAdminAuth,
  requirePermission("payments.reconcile"),
  requireCsrf,
  asyncHandler(runPendingReconciliation),
);
router.get(
  "/reports",
  requireAdminAuth,
  requireAnyPermission(["reports.generate", "reports.download"]),
  asyncHandler(listReports),
);
router.get(
  "/reports/schedules",
  requireAdminAuth,
  requirePermission("reports.generate"),
  asyncHandler(listReportSchedules),
);
router.post(
  "/reports",
  requireAdminAuth,
  requirePermission("reports.generate"),
  requireCsrf,
  asyncHandler(createReport),
);
router.post(
  "/reports/schedules",
  requireAdminAuth,
  requirePermission("reports.generate"),
  requireCsrf,
  asyncHandler(createReportSchedule),
);
router.patch(
  "/reports/schedules/:scheduleId",
  requireAdminAuth,
  requirePermission("reports.generate"),
  requireCsrf,
  asyncHandler(patchReportSchedule),
);
router.delete(
  "/reports/schedules/:scheduleId",
  requireAdminAuth,
  requirePermission("reports.generate"),
  requireCsrf,
  asyncHandler(removeReportSchedule),
);
router.get(
  "/reports/:reportId",
  requireAdminAuth,
  requireAnyPermission(["reports.generate", "reports.download"]),
  asyncHandler(getReport),
);
router.get(
  "/reports/:reportId/download",
  requireAdminAuth,
  requirePermission("reports.download"),
  asyncHandler(downloadReport),
);

module.exports = { adminRoutes: router };
