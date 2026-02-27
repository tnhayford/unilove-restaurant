const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let dbPath = "";
let handleUssdRequest;

function clearModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
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

async function bootstrapUssdTestDb() {
  dbPath = `/tmp/unilove-ussd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = dbPath;
  process.env.JWT_SECRET = "test-jwt-secret-123";
  process.env.HUBTEL_CALLBACK_SECRET = "test-callback-secret-123";
  process.env.COOKIE_SECURE = "false";

  [
    path.join(ROOT, "src/config/env.js"),
    path.join(ROOT, "src/db/connection.js"),
    path.join(ROOT, "src/db/migrate.js"),
    path.join(ROOT, "src/repositories/menuRepository.js"),
    path.join(ROOT, "src/services/menuService.js"),
    path.join(ROOT, "src/services/storeStatusService.js"),
    path.join(ROOT, "src/services/orderService.js"),
    path.join(ROOT, "src/services/ussdService.js"),
  ].forEach((entry) => clearModule(entry));

  const { runMigrations } = require(path.join(ROOT, "src/db/migrate.js"));
  const { createMenuItem } = require(path.join(ROOT, "src/repositories/menuRepository.js"));

  await runMigrations();

  await createMenuItem({
    id: "item-rice-1",
    category: "Rice",
    name: "Special Fried Rice",
    priceCedis: 28,
    ussdShortName: "Fried Rice",
    ussdPriceCedis: 25,
    ussdVisible: true,
    isActive: true,
  });

  await createMenuItem({
    id: "item-assorted-1",
    category: "Assorted Rice",
    name: "Assorted Fried Rice",
    priceCedis: 33,
    ussdVisible: true,
    isActive: true,
  });

  await createMenuItem({
    id: "item-assorted-2",
    category: "Assorted Rice",
    name: "Assorted Jollof Rice",
    priceCedis: 34,
    ussdVisible: true,
    isActive: true,
  });

  const shawarmaItems = [
    "Chicken and Beans and Fries Shawarma",
    "Chicken and Butter and Veggies Shawarma",
    "Chicken and Cheese and Beans Shawarma",
    "Chicken and Cheese and Veggies Shawarma",
    "Chicken and Sausage and Fries Shawarma",
    "Chicken and Sausage and Veggies Shawarma",
    "Chicken and Tuna and Fries Shawarma",
    "Chicken and Tuna and Veggies Shawarma",
    "Double Chicken and Cheese Shawarma",
  ];

  for (let index = 0; index < shawarmaItems.length; index += 1) {
    await createMenuItem({
      id: `item-shawarma-${index + 1}`,
      category: "Shawarma",
      name: shawarmaItems[index],
      priceCedis: 40 + index,
      ussdVisible: true,
      isActive: true,
    });
  }

  ({ handleUssdRequest } = require(path.join(ROOT, "src/services/ussdService.js")));
}

async function getDbHandle() {
  const { getDb } = require(path.join(ROOT, "src/db/connection.js"));
  return getDb();
}

function payload({
  type = "Response",
  message = "",
  sessionId = "sess-1",
  mobile = "233240000111",
}) {
  return {
    Type: type,
    Message: message,
    SessionId: sessionId,
    Mobile: mobile,
  };
}

function pickMenuOptionByLabel(message, label) {
  const target = String(label || "").trim().toLowerCase();
  const lines = String(message || "").split("\n");
  const candidates = [];
  for (const line of lines) {
    const match = line.match(/^#?(\d+)\.\s+(.+)$/);
    if (!match) continue;
    const option = match[1];
    if (["0", "8", "9", "98", "99"].includes(option)) continue;
    const optionLabel = String(match[2] || "").trim().toLowerCase();
    candidates.push({ option, optionLabel });
  }

  const exact = candidates.find((entry) => entry.optionLabel === target);
  if (exact) return exact.option;

  const partial = candidates.find((entry) => entry.optionLabel.includes(target));
  if (partial) return partial.option;

  for (const entry of candidates) {
    if (target.includes(entry.optionLabel)) return entry.option;
  }
  throw new Error(`Could not find menu option "${label}" in: ${message}`);
}

async function initiateFreshSession(sessionId, mobile = "233240000111") {
  const initial = await handleUssdRequest(payload({ type: "Initiation", sessionId, mobile }));
  if (initial.ClientState !== "RESUME_DECISION") return initial;
  return handleUssdRequest(payload({ sessionId, mobile, message: "2" }));
}

describe("USSD customer ordering flow", () => {
  beforeAll(async () => {
    await bootstrapUssdTestDb();
  });

  afterAll(() => {
    cleanupDbFiles(dbPath);
  });

  it("shows main menu on initiation", async () => {
    const response = await handleUssdRequest(payload({ type: "Initiation", sessionId: "sess-main" }));

    expect(response.Type).toBe("response");
    expect(response.ClientState).toBe("MAIN");
    expect(response.Message).toContain("1. Add to cart");
    expect(response.Message).toContain("2. View cart");
    expect(response.Message).toContain("Welcome to Unilove Foods - Ayeduase");
    expect(response.Message).toContain("item(s)\n\n1. Add to cart");
    expect(response.Message.length).toBeLessThanOrEqual(150);
  });

  it("uses menu-management data in item list", async () => {
    const sessionId = "sess-menu";
    await handleUssdRequest(payload({ type: "Initiation", sessionId }));
    const categoryScreen = await handleUssdRequest(payload({ sessionId, message: "1" }));
    const riceOption = pickMenuOptionByLabel(categoryScreen.Message, "Rice");
    const itemScreen = await handleUssdRequest(payload({ sessionId, message: riceOption }));

    expect(categoryScreen.ClientState).toBe("CATEGORY");
    expect(categoryScreen.Message).toMatch(/1\.\s+/);
    expect(itemScreen.ClientState).toBe("ITEM");
    expect(itemScreen.Message).toMatch(/1\.\s+/);
    expect(itemScreen.Message).toContain("Fried Rice");
    expect(itemScreen.Message).toContain("25");
  });

  it("removes repeated category prefix in USSD item labels", async () => {
    const sessionId = "sess-assorted";
    await initiateFreshSession(sessionId);
    const categoryScreen = await handleUssdRequest(payload({ sessionId, message: "1" }));
    const assortedOption = pickMenuOptionByLabel(categoryScreen.Message, "Assorted Rice");
    const itemScreen = await handleUssdRequest(payload({ sessionId, message: assortedOption }));

    expect(itemScreen.ClientState).toBe("ITEM");
    expect(itemScreen.Message).toContain("Fried Rice");
    expect(itemScreen.Message).toContain("Jollof Rice");
    expect(itemScreen.Message).not.toContain("Assorted Fried Rice");
    expect(itemScreen.Message).not.toContain("Assorted Jollof Rice");
  });

  it("sorts category items by cheapest price first and accepts # navigation", async () => {
    const sessionId = "sess-hash-cheapest";
    await initiateFreshSession(sessionId);
    const categoryScreen = await handleUssdRequest(payload({ sessionId, message: "#1" }));
    const shawarmaOption = pickMenuOptionByLabel(categoryScreen.Message, "Shawarma");
    const itemScreen = await handleUssdRequest(payload({ sessionId, message: `#${shawarmaOption}` }));
    const pageTwoViaHash = await handleUssdRequest(payload({ sessionId, message: "#" }));

    expect(categoryScreen.ClientState).toBe("CATEGORY");
    expect(itemScreen.ClientState).toBe("ITEM");
    expect(pageTwoViaHash.ClientState).toBe("ITEM");
    expect(pageTwoViaHash.Message).toContain("P2/3");

    const prices = itemScreen.Message
      .split("\n")
      .map((line) => {
        const match = line.match(/-\s*(\d+(?:\.\d+)?)/);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value));

    expect(prices.length).toBeGreaterThan(0);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const cartViaHash = await handleUssdRequest(payload({ sessionId, message: "#9" }));
    expect(cartViaHash.ClientState).toBe("CART");
  });

  it("uses smarter USSD wording for Assorted, Ampesi, and chips proteins", async () => {
    const { createMenuItem } = require(path.join(ROOT, "src/repositories/menuRepository.js"));
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await createMenuItem({
      id: `item-chips-fried-${suffix}`,
      category: "Chips",
      name: "Potato Chips & Fried Chicken",
      priceCedis: 45,
      ussdShortName: "PotChips+Fried",
      ussdPriceCedis: 45,
      ussdVisible: true,
      isActive: true,
    });
    await createMenuItem({
      id: `item-chips-grilled-${suffix}`,
      category: "Chips",
      name: "Potato Chips & Grilled Chicken",
      priceCedis: 50,
      ussdShortName: "PotChips+Grill",
      ussdPriceCedis: 50,
      ussdVisible: true,
      isActive: true,
    });
    await createMenuItem({
      id: `item-chips-yam-fried-${suffix}`,
      category: "Chips",
      name: "Yam Chips & Fried Chicken",
      priceCedis: 45,
      ussdShortName: "YamChips+Fried",
      ussdPriceCedis: 45,
      ussdVisible: true,
      isActive: true,
    });
    await createMenuItem({
      id: `item-ampesi-${suffix}`,
      category: "Others",
      name: "Yam + Palava Sauce & Fish",
      priceCedis: 55,
      ussdShortName: "Yam+Palava",
      ussdPriceCedis: 55,
      ussdVisible: true,
      isActive: true,
    });

    const sessionId = `sess-smart-${suffix}`;
    await initiateFreshSession(sessionId);

    const categoryScreen = await handleUssdRequest(payload({ sessionId, message: "1" }));
    expect(categoryScreen.Message).toContain("Select a meal category");
    expect(categoryScreen.Message).toContain("Ampesi");

    const assortedOption = pickMenuOptionByLabel(categoryScreen.Message, "Assorted Rice");
    const assortedScreen = await handleUssdRequest(payload({ sessionId, message: assortedOption }));
    expect(assortedScreen.Message).toContain("Select assorted option");

    const categoryBack = await handleUssdRequest(payload({ sessionId, message: "0" }));
    const chipsOption = pickMenuOptionByLabel(categoryBack.Message, "Chips");
    const chipsTypeScreen = await handleUssdRequest(payload({ sessionId, message: chipsOption }));
    expect(chipsTypeScreen.Message).toContain("Select chips type");
    const potatoTypeOption = pickMenuOptionByLabel(chipsTypeScreen.Message, "Potato Chips");
    const chipsProteinScreen = await handleUssdRequest(payload({ sessionId, message: potatoTypeOption }));
    expect(chipsProteinScreen.Message).toContain("Select protein");
    expect(chipsProteinScreen.Message).toMatch(/Fried/);
    expect(chipsProteinScreen.Message).toMatch(/Grilled/);
  });

  it("guides fried rice selection with side/protein choices", async () => {
    const { createMenuItem } = require(path.join(ROOT, "src/repositories/menuRepository.js"));
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await createMenuItem({
      id: `item-fried-rice-fish-${suffix}`,
      category: "Fried Rice",
      name: "Fried Rice & Fish",
      priceCedis: 30,
      ussdVisible: true,
      isActive: true,
    });
    await createMenuItem({
      id: `item-fried-rice-grill-${suffix}`,
      category: "Fried Rice",
      name: "Fried Rice & Grilled Chicken",
      priceCedis: 33,
      ussdVisible: true,
      isActive: true,
    });

    const sessionId = `sess-fried-rice-${suffix}`;
    await initiateFreshSession(sessionId);
    const categoryScreen = await handleUssdRequest(payload({ sessionId, message: "1" }));
    const friedRiceOption = pickMenuOptionByLabel(categoryScreen.Message, "Fried Rice");
    const proteinScreen = await handleUssdRequest(payload({ sessionId, message: friedRiceOption }));

    expect(proteinScreen.ClientState).toBe("COMBO_PROTEIN");
    expect(proteinScreen.Message).toContain("Select side or protein");
    expect(proteinScreen.Message).toMatch(/Fish/);
    expect(proteinScreen.Message).toMatch(/Grilled Chicken/);
  });

  it("completes checkout with AddToCart and momo-pin prompt text", async () => {
    const sessionId = "sess-checkout";

    await handleUssdRequest(payload({ type: "Initiation", sessionId }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "2" }));
    await handleUssdRequest(payload({ sessionId, message: "2" }));
    await handleUssdRequest(payload({ sessionId, message: "Jane Doe" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));

    const paymentScreen = await handleUssdRequest(payload({ sessionId, message: "1" }));

    expect(paymentScreen.Type).toBe("AddToCart");
    expect(paymentScreen.DataType).toBe("display");
    expect(paymentScreen.Label).toBe("Approve payment");
    expect(paymentScreen.Message).toContain("wait for payment prompt");
    expect(paymentScreen.Message).toContain("MoMo PIN");
    expect(paymentScreen.Message.length).toBeLessThanOrEqual(150);
    expect(paymentScreen.Message).toMatch(/^[A-Za-z0-9 .,:;!?()'"/&+-]+$/);
    expect(paymentScreen.Item).toEqual(
      expect.objectContaining({
        ItemName: expect.stringMatching(/^Unilove Order R\d+$/),
        Qty: 1,
      }),
    );
    expect(Number(paymentScreen.Item.Price || 0)).toBeGreaterThan(0);
  });

  it("supports delivery cash-on-delivery checkout without momo prompt", async () => {
    const sessionId = "sess-cod-delivery";

    await handleUssdRequest(payload({ type: "Initiation", sessionId }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "2" }));
    await handleUssdRequest(payload({ sessionId, message: "John Cash" }));
    await handleUssdRequest(payload({ sessionId, message: "2" }));
    await handleUssdRequest(payload({ sessionId, message: "KNUST Main Gate" }));

    const codConfirm = await handleUssdRequest(payload({ sessionId, message: "2" }));

    expect(codConfirm.Type).toBe("release");
    expect(codConfirm.Message).toContain("cash on delivery");
    expect(codConfirm.Message).toContain("Order R");

    const db = await getDbHandle();
    const order = await db.get(
      `SELECT status, payment_method, payment_status
       FROM orders
       WHERE hubtel_session_id = ?`,
      [sessionId],
    );
    expect(order?.status).toBe("PAID");
    expect(order?.payment_method).toBe("cash_on_delivery");
    expect(order?.payment_status).toBe("PENDING");
  });

  it("offers resume on new session after timeout", async () => {
    const oldSessionId = "sess-timeout-old";
    const newSessionId = "sess-timeout-new";
    const mobile = "233240000999";

    await handleUssdRequest(payload({ type: "Initiation", sessionId: oldSessionId, mobile }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "1" }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "1" }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "1" }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "1" }));

    const timeoutResponse = await handleUssdRequest(payload({
      type: "Timeout",
      sessionId: oldSessionId,
      mobile,
    }));

    expect(timeoutResponse.Type).toBe("release");
    expect(timeoutResponse.Message).toContain("Dial again to continue");

    const resumedPrompt = await handleUssdRequest(payload({
      type: "Initiation",
      sessionId: newSessionId,
      mobile,
    }));

    expect(resumedPrompt.ClientState).toBe("RESUME_DECISION");
    expect(resumedPrompt.Message).toContain("Continue last session?");
    expect(resumedPrompt.Message).toContain("1. Continue");

    const continued = await handleUssdRequest(payload({
      sessionId: newSessionId,
      mobile,
      message: "1",
    }));

    expect(continued.ClientState).toBe("CART");
    expect(continued.Message).toContain("Session resumed.");
  });

  it("supports fast shortcuts from category/item/cart", async () => {
    const sessionId = "sess-shortcuts";
    await handleUssdRequest(payload({ type: "Initiation", sessionId }));

    const category = await handleUssdRequest(payload({ sessionId, message: "1" }));
    expect(category.ClientState).toBe("CATEGORY");
    expect(category.Message).toContain("9. Cart");
    expect(category.Message).toContain("8. Checkout");

    const checkoutBlocked = await handleUssdRequest(payload({ sessionId, message: "8" }));
    expect(checkoutBlocked.ClientState).toBe("CATEGORY");
    expect(checkoutBlocked.Message).toContain("Cart is empty.");

    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));
    await handleUssdRequest(payload({ sessionId, message: "1" }));

    const backToCategory = await handleUssdRequest(payload({ sessionId, message: "1" }));
    expect(backToCategory.ClientState).toBe("CATEGORY");

    const jumpToCart = await handleUssdRequest(payload({ sessionId, message: "9" }));
    expect(jumpToCart.ClientState).toBe("CART");
    expect(jumpToCart.Message).toContain("8. Checkout");
    expect(jumpToCart.Message).not.toContain("2. Checkout");
    expect(jumpToCart.Message).toMatch(/- \d/);

    const cartCheckout = await handleUssdRequest(payload({ sessionId, message: "8" }));
    expect(cartCheckout.ClientState).toBe("FULL_NAME");
  });

  it("keeps full back option on long multi-page item categories", async () => {
    const sessionId = "sess-long-shawarma";
    const mobile = "233240000877";
    await handleUssdRequest(payload({ type: "Initiation", sessionId, mobile }));
    const categoryScreen = await handleUssdRequest(payload({ sessionId, mobile, message: "1" }));
    const shawarmaOption = pickMenuOptionByLabel(categoryScreen.Message, "Shawarma");
    const itemScreen = await handleUssdRequest(payload({ sessionId, mobile, message: shawarmaOption }));
    const pageTwoScreen = await handleUssdRequest(payload({ sessionId, mobile, message: "98" }));

    expect(itemScreen.ClientState).toBe("ITEM");
    expect(itemScreen.Message).toContain("P1/3");
    expect(itemScreen.Message).toContain("8. Checkout");
    expect(itemScreen.Message).toContain("0. Back");
    expect(itemScreen.Message.endsWith("0. Back")).toBe(true);
    expect(itemScreen.Message.length).toBeLessThanOrEqual(150);

    expect(pageTwoScreen.ClientState).toBe("ITEM");
    expect(pageTwoScreen.Message).toContain("P2/3");
    expect(pageTwoScreen.Message).toContain("99. Prev");
    expect(pageTwoScreen.Message).toContain("8. Checkout");
    expect(pageTwoScreen.Message.endsWith("0. Back")).toBe(true);
    expect(pageTwoScreen.Message.length).toBeLessThanOrEqual(150);
  });

  it("keeps full item menu when resuming an items stage", async () => {
    const oldSessionId = "sess-resume-items-old";
    const newSessionId = "sess-resume-items-new";
    const mobile = "233240000878";

    await handleUssdRequest(payload({ type: "Initiation", sessionId: oldSessionId, mobile }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "1" }));
    await handleUssdRequest(payload({ sessionId: oldSessionId, mobile, message: "3" }));

    await handleUssdRequest(payload({
      type: "Timeout",
      sessionId: oldSessionId,
      mobile,
    }));

    await handleUssdRequest(payload({
      type: "Initiation",
      sessionId: newSessionId,
      mobile,
    }));

    const resumedItem = await handleUssdRequest(payload({
      sessionId: newSessionId,
      mobile,
      message: "1",
    }));

    expect(resumedItem.ClientState).toBe("ITEM");
    expect(resumedItem.Message).toContain("Session resumed.");
    expect(resumedItem.Message).toContain("8. Checkout");
    expect(resumedItem.Message.endsWith("0. Back")).toBe(true);
    expect(resumedItem.Message.length).toBeLessThanOrEqual(150);
  });
});
