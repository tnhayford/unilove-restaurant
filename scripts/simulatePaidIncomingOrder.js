const { listActiveMenuItems } = require("../src/repositories/menuRepository");
const { createOrderFromRequest, getOrderByOrderNumberForTracking } = require("../src/services/orderService");
const { processHubtelCallback } = require("../src/services/paymentService");
const { getDb } = require("../src/db/connection");

async function run() {
  const menu = await listActiveMenuItems();
  if (!menu.length) {
    throw new Error("No active menu item found. Run: npm run seed:menu");
  }

  const firstItem = menu[0];
  const createdOrder = await createOrderFromRequest({
    phone: "233240001111",
    fullName: "Simulated Incoming Customer",
    deliveryType: "pickup",
    items: [{ itemId: firstItem.id, quantity: 1 }],
    source: "online",
    paymentMethod: "momo",
  });

  await processHubtelCallback({
    ResponseCode: "0000",
    Message: "success",
    Data: {
      ClientReference: createdOrder.clientReference,
      TransactionId: `txn-${Date.now()}`,
      ExternalTransactionId: `ext-${Date.now()}`,
      Amount: createdOrder.subtotalCedis,
      Charges: 0,
      AmountAfterCharges: createdOrder.subtotalCedis,
      AmountCharged: createdOrder.subtotalCedis,
    },
  });

  const tracking = await getOrderByOrderNumberForTracking(createdOrder.orderNumber);
  const db = await getDb();
  const row = await db.get(
    `SELECT order_number, status, source, ops_monitored_at
     FROM orders
     WHERE order_number = ?`,
    [createdOrder.orderNumber],
  );

  console.log("Simulated paid order:", createdOrder.orderNumber);
  console.log("Tracking status:", tracking.status);
  console.log("Source:", row?.source || "-");
  console.log("Monitored at:", row?.ops_monitored_at || "not monitored");
  console.log(
    "Open /admin/operations.html. Incoming alert should ring continuously until this order is monitored.",
  );
}

run().catch((error) => {
  console.error("Simulation failed:", error.message);
  process.exit(1);
});
