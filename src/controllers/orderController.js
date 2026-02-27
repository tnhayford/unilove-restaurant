const {
  createOrderFromRequest,
  getOrderDetails,
  getOrderByOrderNumberForTracking,
} = require("../services/orderService");

async function createOrder(req, res) {
  const order = await createOrderFromRequest(req.validatedBody);
  return res.status(201).json({ data: order });
}

async function getOrder(req, res) {
  const order = await getOrderDetails(req.params.orderId);
  return res.json({ data: order });
}

async function trackOrder(req, res) {
  const tracking = await getOrderByOrderNumberForTracking({
    orderNumber: req.params.orderNumber,
    trackingToken: req.query.token,
  });
  return res.json({ data: tracking });
}

module.exports = {
  createOrder,
  getOrder,
  trackOrder,
};
