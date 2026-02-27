const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

function toSqliteDate(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function isPaidLikeStatus(status) {
  return [
    "PAID",
    "PREPARING",
    "READY_FOR_PICKUP",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURNED",
    "REFUNDED",
  ].includes(status);
}

async function backdateOrders() {
  const count = Number(process.argv[2] || 6);
  const dbPath = path.resolve(process.cwd(), process.env.DATABASE_PATH || "./data/app.db");

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  const orders = await db.all(
    `SELECT id, status
     FROM orders
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [count],
  );

  if (!orders.length) {
    console.log("No orders found to backdate.");
    await db.close();
    return;
  }

  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const dayOffset = Math.floor(index / 2);
    const hour = index % 2 === 0 ? 11 : 16;

    const createdAt = new Date();
    createdAt.setUTCDate(createdAt.getUTCDate() - dayOffset);
    createdAt.setUTCHours(hour, 20, 0, 0);

    const updatedAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const paymentConfirmedAt = new Date(createdAt.getTime() + 5 * 60 * 1000);

    if (isPaidLikeStatus(order.status)) {
      await db.run(
        `UPDATE orders
         SET created_at = ?, updated_at = ?, payment_confirmed_at = ?
         WHERE id = ?`,
        [
          toSqliteDate(createdAt),
          toSqliteDate(updatedAt),
          toSqliteDate(paymentConfirmedAt),
          order.id,
        ],
      );
    } else {
      await db.run(
        `UPDATE orders
         SET created_at = ?, updated_at = ?
         WHERE id = ?`,
        [toSqliteDate(createdAt), toSqliteDate(updatedAt), order.id],
      );
    }
  }

  await db.close();
  console.log(`Backdated ${orders.length} most recent orders over ~${Math.ceil(orders.length / 2)} days.`);
}

backdateOrders().catch((error) => {
  console.error("Failed to backdate orders:", error);
  process.exit(1);
});
