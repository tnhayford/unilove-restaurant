const express = require("express");
const rateLimit = require("express-rate-limit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { validate } = require("../middleware/validate");
const { requireRiderAuth, requireRiderKey } = require("../middleware/auth");
const env = require("../config/env");
const {
  orderCreateSchema,
  ussdRequestSchema,
  deliveryVerifySchema,
  riderLoginSchema,
  riderDeviceTokenSchema,
  riderShiftUpdateSchema,
  riderIncidentCreateSchema,
  riderCashCollectionSchema,
} = require("./schemas");
const { listMenu } = require("../controllers/menuController");
const { createOrder, trackOrder } = require("../controllers/orderController");
const { streamOrderTrackingEvents } = require("../controllers/realtimeController");
const { processUssd } = require("../controllers/ussdController");
const { handleHubtelCallback } = require("../controllers/paymentController");
const { verifyDelivery } = require("../controllers/deliveryController");
const {
  listRiderQueue,
  reportRiderIncident,
  confirmRiderCashCollection,
} = require("../controllers/riderController");
const {
  riderLogin,
  registerDeviceToken,
  updateShiftStatus,
  riderLogout,
} = require("../controllers/riderAuthController");
const { getPublicStoreStatus } = require("../controllers/storeStatusController");

const router = express.Router();
const trackingLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: Math.max(30, Math.floor(env.rateLimitMaxRequests / 4)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tracking attempts. Please retry shortly." },
});

router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.get("/menu", asyncHandler(listMenu));
router.get("/store/status", asyncHandler(getPublicStoreStatus));

router.post("/orders", validate(orderCreateSchema), asyncHandler(createOrder));
router.get("/orders/track/:orderNumber", trackingLimiter, asyncHandler(trackOrder));
router.get(
  "/orders/track/:orderNumber/stream",
  trackingLimiter,
  asyncHandler(streamOrderTrackingEvents),
);

router.post("/ussd/interaction", validate(ussdRequestSchema), asyncHandler(processUssd));
router.post("/payments/hubtel/callback", asyncHandler(handleHubtelCallback));
router.post("/rider/auth/login", requireRiderKey, validate(riderLoginSchema), asyncHandler(riderLogin));
router.post("/rider/auth/logout", requireRiderKey, requireRiderAuth, asyncHandler(riderLogout));
router.patch(
  "/rider/shift",
  requireRiderKey,
  requireRiderAuth,
  validate(riderShiftUpdateSchema),
  asyncHandler(updateShiftStatus),
);
router.post(
  "/rider/devices/token",
  requireRiderKey,
  requireRiderAuth,
  validate(riderDeviceTokenSchema),
  asyncHandler(registerDeviceToken),
);
router.post(
  "/delivery/verify",
  requireRiderKey,
  requireRiderAuth,
  validate(deliveryVerifySchema),
  asyncHandler(verifyDelivery),
);
router.get("/rider/queue", requireRiderKey, requireRiderAuth, asyncHandler(listRiderQueue));
router.post(
  "/rider/orders/collection",
  requireRiderKey,
  requireRiderAuth,
  validate(riderCashCollectionSchema),
  asyncHandler(confirmRiderCashCollection),
);
router.post(
  "/rider/incidents",
  requireRiderKey,
  requireRiderAuth,
  validate(riderIncidentCreateSchema),
  asyncHandler(reportRiderIncident),
);

module.exports = { publicRoutes: router };
