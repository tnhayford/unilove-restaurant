const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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
  process.env.HUBTEL_CALLBACK_SIGNATURE_OPTIONAL = "true";
  process.env.RIDER_GUEST_LOGIN_POLICY = "invite_only";
  process.env.RIDER_GUEST_ACCESS_CODE = "guest-access-2026";
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

async function seedReferralCode(code = "UNIREF10", maxUses = null) {
  const db = await getDbHandle();
  const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.run(
    `INSERT INTO rider_referral_codes (id, code, label, is_active, max_uses, use_count)
     VALUES (?, ?, ?, 1, ?, 0)`,
    [id, code, "Test Referral", maxUses],
  );
  return { id, code };
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

  it("accepts signed form callbacks and marks order as paid", async () => {
    if (!canRunHttpTests) return;

    const itemId = await seedMenuItem();
    const createRes = await request.post("/api/orders").send({
      phone: "0240001888",
      fullName: "Form Callback Customer",
      deliveryType: "delivery",
      address: "Ridge, Accra",
      items: [{ itemId, quantity: 1 }],
    });
    expect(createRes.status).toBe(201);

    const orderId = createRes.body?.data?.id;
    const clientReference = createRes.body?.data?.clientReference;
    expect(orderId).toBeTruthy();
    expect(clientReference).toBeTruthy();

    const encoded = `clientReference=${encodeURIComponent(clientReference)}&ResponseCode=0000&Status=paid&TransactionId=txn-form-001`;
    const signature = crypto
      .createHmac("sha256", process.env.HUBTEL_CALLBACK_SECRET)
      .update(encoded)
      .digest("hex");

    const callbackRes = await request
      .post("/api/payments/hubtel/callback")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("x-hubtel-signature", signature)
      .send(encoded);

    expect(callbackRes.status).toBe(202);

    const db = await getDbHandle();
    const row = await db.get(
      `SELECT status, payment_confirmed_at
       FROM orders
       WHERE id = ?`,
      [orderId],
    );
    expect(row?.status).toBe("PAID");
    expect(row?.payment_confirmed_at).toBeTruthy();
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

  it("rejects guest OTP request without referral code", async () => {
    if (!canRunHttpTests) return;

    const response = await request.post("/api/rider/auth/request-otp").send({
      mode: "guest",
      riderName: "Guest Ama",
      phone: "0240009001",
    });
    expect(response.status).toBe(400);
    expect(response.body?.error).toMatch(/validation/i);
  });

  it("allows guest rider OTP login with valid referral code", async () => {
    if (!canRunHttpTests) return;
    const seeded = await seedReferralCode("UNIREF42", 100);

    const requestOtpRes = await request.post("/api/rider/auth/request-otp").send({
      mode: "guest",
      phone: "0240009002",
      riderName: "Guest Ama",
      referralCode: seeded.code,
    });
    expect(requestOtpRes.status).toBe(200);
    const requestId = requestOtpRes.body?.data?.requestId;
    const debugOtpCode = requestOtpRes.body?.data?.debugOtpCode;
    expect(requestId).toBeTruthy();
    expect(debugOtpCode).toMatch(/^\d{6}$/);

    const loginRes = await request.post("/api/rider/auth/login").send({
      mode: "guest",
      phone: "0240009002",
      otpCode: debugOtpCode,
      requestId,
      riderName: "Guest Ama",
      referralCode: seeded.code,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body?.data?.token).toBeTruthy();
    expect(loginRes.body?.data?.rider?.mode).toBe("guest");
  });

  it("blocks COD OTP verification until rider confirms collection", async () => {
    if (!canRunHttpTests) return;

    const referral = await seedReferralCode("UNIREF99", 500);
    const requestOtpRes = await request.post("/api/rider/auth/request-otp").send({
      mode: "guest",
      phone: "0240009111",
      riderName: "Rider Kojo",
      referralCode: referral.code,
    });
    expect(requestOtpRes.status).toBe(200);

    const loginRes = await request.post("/api/rider/auth/login").send({
      mode: "guest",
      phone: "0240009111",
      otpCode: requestOtpRes.body?.data?.debugOtpCode,
      requestId: requestOtpRes.body?.data?.requestId,
      riderName: "Rider Kojo",
      referralCode: referral.code,
    });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body?.data?.token;
    expect(token).toBeTruthy();

    const itemId = await seedMenuItem();
    const createRes = await request.post("/api/orders").send({
      phone: "0240007111",
      fullName: "COD Customer",
      deliveryType: "delivery",
      address: "Spintex, Accra",
      paymentMethod: "cash_on_delivery",
      items: [{ itemId, quantity: 1 }],
    });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body?.data?.id;
    expect(orderId).toBeTruthy();

    const db = await getDbHandle();
    await db.run(
      `UPDATE orders
       SET status = 'OUT_FOR_DELIVERY',
           payment_method = 'cash_on_delivery',
           payment_status = 'PENDING',
           assigned_rider_id = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [loginRes.body?.data?.rider?.id, orderId],
    );
    const codeHash = await bcrypt.hash("123456", 10);
    await db.run(
      `INSERT INTO delivery_verifications (order_id, code_hash, attempts)
       VALUES (?, ?, 0)
       ON CONFLICT(order_id) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, verified_at = NULL, updated_at = datetime('now')`,
      [orderId, codeHash],
    );

    const blockedVerify = await request
      .post("/api/delivery/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, code: "123456" });
    expect(blockedVerify.status).toBe(409);
    expect(blockedVerify.body?.error).toMatch(/collect/i);

    const collectRes = await request
      .post("/api/rider/orders/collection")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, collectionMethod: "cash" });
    expect(collectRes.status).toBe(200);
    expect(collectRes.body?.data?.paymentStatusCode).toBe("PAID");

    const verifyRes = await request
      .post("/api/delivery/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId, code: "123456" });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body?.data?.success).toBe(true);
  });
});
