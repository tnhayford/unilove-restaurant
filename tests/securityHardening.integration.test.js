const fs = require("fs");
const net = require("net");
const path = require("path");
const supertest = require("supertest");

const ROOT = path.resolve(__dirname, "..");
let dbPath = "";
let request;
let canRunHttpTests = true;

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function bootstrapTestApp() {
  dbPath = `/tmp/unilove-security-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = dbPath;
  process.env.JWT_SECRET = "test-jwt-secret-123";
  process.env.HUBTEL_CALLBACK_SECRET = "test-callback-secret-123";
  process.env.HUBTEL_CALLBACK_SIGNATURE_OPTIONAL = "false";
  process.env.COOKIE_SECURE = "false";

  [
    path.join(ROOT, "src/config/env.js"),
    path.join(ROOT, "src/db/connection.js"),
    path.join(ROOT, "src/db/migrate.js"),
    path.join(ROOT, "src/app.js"),
  ].forEach((entry) => {
    clearModule(entry);
  });

  const { runMigrations } = require(path.join(ROOT, "src/db/migrate.js"));
  const { createApp } = require(path.join(ROOT, "src/app.js"));
  await runMigrations();
  request = supertest(createApp());
}

async function getDbHandle() {
  const { getDb } = require(path.join(ROOT, "src/db/connection.js"));
  return getDb();
}

async function seedMenuItem() {
  const db = await getDbHandle();
  const menuId = `menu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.run(
    `INSERT INTO menu_items (
      id, category, name, price_cedis, is_active
    ) VALUES (?, ?, ?, ?, 1)`,
    [menuId, "Test", "Test Rice", 12.5],
  );
  await db.run(
    `INSERT OR IGNORE INTO menu_categories (name)
     VALUES (?)`,
    ["Test"],
  );
  return menuId;
}

function extractTrackingTokenFromSms(message) {
  const text = String(message || "");
  const tokenMatch = text.match(/[?&]token=([a-f0-9]+)/i);
  return tokenMatch?.[1] || "";
}

function cleanupDbFiles(file) {
  [file, `${file}-wal`, `${file}-shm`].forEach((target) => {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (_) {
      // best-effort cleanup
    }
  });
}

async function canBindLoopbackPort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

describe("Security hardening integration", () => {
  beforeAll(async () => {
    canRunHttpTests = await canBindLoopbackPort();
    if (!canRunHttpTests) return;
    await bootstrapTestApp();
  });

  afterAll(() => {
    cleanupDbFiles(dbPath);
  });

  it("blocks rider queue access without rider token", async () => {
    if (!canRunHttpTests) return;
    const response = await request.get("/api/rider/queue");
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/missing rider token/i);
  });

  it("blocks delivery verification without rider token", async () => {
    if (!canRunHttpTests) return;
    const response = await request.post("/api/delivery/verify").send({
      orderId: "any-order-id",
      code: "123456",
      riderId: "rider-001",
    });
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/missing rider token/i);
  });

  it("removes public order-by-id endpoint", async () => {
    if (!canRunHttpTests) return;
    const response = await request.get("/api/orders/any-order-id");
    expect(response.status).toBe(404);
  });

  it("rejects payment callback without valid signature", async () => {
    if (!canRunHttpTests) return;
    const response = await request
      .post("/api/payments/hubtel/callback")
      .set("x-hubtel-signature", "invalid-signature")
      .send({
        ResponseCode: "0000",
        Data: { ClientReference: "demo-ref" },
      });
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/Invalid callback signature/i);
  });

  it("requires secure tracking token for public order tracking", async () => {
    if (!canRunHttpTests) return;

    const itemId = await seedMenuItem();
    const createRes = await request.post("/api/orders").send({
      phone: "0240001000",
      fullName: "Token Test",
      deliveryType: "delivery",
      address: "KNUST Main Gate",
      items: [{ itemId, quantity: 1 }],
    });
    expect(createRes.status).toBe(201);
    const orderNumber = createRes.body?.data?.orderNumber;
    expect(orderNumber).toBeTruthy();

    const db = await getDbHandle();
    const smsRow = await db.get(
      `SELECT message
       FROM sms_logs
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
    );
    const token = extractTrackingTokenFromSms(smsRow?.message);
    expect(token).toMatch(/^[a-f0-9]{16,}$/i);

    const noTokenRes = await request.get(`/api/orders/track/${orderNumber}`);
    expect(noTokenRes.status).toBe(404);

    const badTokenRes = await request
      .get(`/api/orders/track/${orderNumber}`)
      .query({ token: "deadbeef" });
    expect(badTokenRes.status).toBe(404);

    const okRes = await request
      .get(`/api/orders/track/${orderNumber}`)
      .query({ token });
    expect(okRes.status).toBe(200);
    expect(okRes.body?.data?.orderNumber).toBe(orderNumber);
  });

  it("rejects tracking token reuse across different orders", async () => {
    if (!canRunHttpTests) return;

    const itemId = await seedMenuItem();

    const firstOrderRes = await request.post("/api/orders").send({
      phone: "0240002001",
      fullName: "First Token Owner",
      deliveryType: "delivery",
      address: "Airport Residential",
      items: [{ itemId, quantity: 1 }],
    });
    expect(firstOrderRes.status).toBe(201);

    const secondOrderRes = await request.post("/api/orders").send({
      phone: "0240002002",
      fullName: "Second Token Owner",
      deliveryType: "delivery",
      address: "East Legon",
      items: [{ itemId, quantity: 1 }],
    });
    expect(secondOrderRes.status).toBe(201);

    const firstOrderId = firstOrderRes.body?.data?.id;
    const secondOrderNumber = secondOrderRes.body?.data?.orderNumber;
    expect(firstOrderId).toBeTruthy();
    expect(secondOrderNumber).toBeTruthy();

    const db = await getDbHandle();
    const firstSms = await db.get(
      `SELECT message
       FROM sms_logs
       WHERE order_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [firstOrderId],
    );
    const firstToken = extractTrackingTokenFromSms(firstSms?.message);
    expect(firstToken).toMatch(/^[a-f0-9]{16,}$/i);

    const mismatchedTokenRes = await request
      .get(`/api/orders/track/${secondOrderNumber}`)
      .query({ token: firstToken });
    expect(mismatchedTokenRes.status).toBe(404);
  });

  it("allows guest rider login without PIN", async () => {
    if (!canRunHttpTests) return;

    const response = await request.post("/api/rider/auth/login").send({
      mode: "guest",
      riderName: "Guest Ama",
      riderId: "ama",
    });
    expect(response.status).toBe(200);
    expect(response.body?.data?.token).toBeTruthy();
    expect(response.body?.data?.rider?.mode).toBe("guest");
  });
});
