const { verifyDeliveryCode } = require("../services/deliveryService");

async function verifyDelivery(req, res) {
  const result = await verifyDeliveryCode({
    ...req.validatedBody,
    riderId: req.rider?.sub,
  });
  return res.json({ data: result });
}

module.exports = { verifyDelivery };
