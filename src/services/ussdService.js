const {
  getSession,
  getLatestSessionByPhone,
  upsertSession,
  deleteSession,
} = require("../repositories/ussdSessionRepository");
const { getMenuGroupedByCategory } = require("./menuService");
const {
  createOrderFromRequest,
  getOrderByOrderNumberForTracking,
} = require("./orderService");
const { getStoreStatus } = require("./storeStatusService");

const STATE = {
  MAIN: "MAIN",
  CATEGORY: "CATEGORY",
  COMBO_BASE: "COMBO_BASE",
  COMBO_PROTEIN: "COMBO_PROTEIN",
  ITEM: "ITEM",
  QUANTITY: "QUANTITY",
  CART: "CART",
  FULL_NAME: "FULL_NAME",
  DELIVERY_TYPE: "DELIVERY_TYPE",
  ADDRESS: "ADDRESS",
  REVIEW: "REVIEW",
  TRACK_ORDER: "TRACK_ORDER",
  RESUME_DECISION: "RESUME_DECISION",
};

const BRAND = "Unilove Foods";
const MAIN_WELCOME_TITLE = "Welcome to Unilove Foods - Ayeduase";
const MAX_MESSAGE_LENGTH = 150;
const CATEGORY_PAGE_SIZE = 4;
const ITEM_PAGE_SIZE = 4;
const CART_PAGE_SIZE = 2;
const RESUME_WINDOW_MS = 30 * 60 * 1000;

function ussdCategoryPriority(category) {
  const key = String(category || "").trim().toLowerCase();
  if (!key) return 99;
  if (key.includes("shawarma")) return 1;
  if (key.includes("jollof")) return 2;
  if (key.includes("fried rice")) return 3;
  if (key.includes("assorted")) return 4;
  return 99;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9 .,:;!?()'"/&+\-#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLines(lines) {
  const normalized = [];
  for (const line of lines || []) {
    const safeLine = cleanLine(line);
    if (!safeLine) {
      if (normalized.length && normalized[normalized.length - 1] !== "") {
        normalized.push("");
      }
      continue;
    }
    normalized.push(safeLine);
  }

  while (normalized[0] === "") normalized.shift();
  while (normalized[normalized.length - 1] === "") normalized.pop();
  return normalized;
}

function cleanText(text) {
  return normalizeLines(String(text || "").replace(/\r/g, "").split("\n")).join("\n").trim();
}

function normalizeMenuInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const compact = raw.replace(/\s+/g, "");
  if (compact === "#") {
    return "98";
  }
  if (/^#?\d+#?$/.test(compact)) {
    return compact.replace(/#/g, "");
  }
  return raw;
}

function toInt(input) {
  const value = Number(input);
  return Number.isInteger(value) ? value : null;
}

function truncate(text, length = 28) {
  const value = cleanText(text);
  if (value.length <= length) return value;
  return value.slice(0, Math.max(1, length)).trim();
}

function limitMessage(text) {
  const cleaned = cleanText(text);
  if (cleaned.length <= MAX_MESSAGE_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_MESSAGE_LENGTH).trim();
}

function sanitizeItemPayload(item) {
  if (!item || typeof item !== "object") return item;
  const sanitized = {};
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === "string") {
      sanitized[key] = cleanText(value);
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function buildMessage(lines) {
  const safeLines = normalizeLines(lines);
  if (!safeLines.length) return BRAND;

  let message = safeLines.join("\n");
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }

  const compact = normalizeLines(safeLines.map((line) => (line ? truncate(line, 24) : "")));
  message = compact.join("\n");
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }

  return message.slice(0, MAX_MESSAGE_LENGTH).trim();
}

function formatScreen({ title, notice = "", body = [], menu = [] }) {
  const lines = [title];
  if (notice) lines.push(notice);
  if (Array.isArray(body) && body.length) {
    lines.push("");
    lines.push(...body);
  }
  if (Array.isArray(menu) && menu.length) {
    lines.push("");
    lines.push(...menu);
  }
  return buildMessage(lines);
}

function responseBody({ sessionId, type = "response", message, clientState, item, label }) {
  return {
    SessionId: sessionId,
    Type: type,
    Message: limitMessage(message),
    Label: cleanText(label || BRAND),
    DataType: type === "AddToCart" ? "display" : "input",
    FieldType: "text",
    ...(clientState ? { ClientState: clientState } : {}),
    ...(item ? { Item: sanitizeItemPayload(item) } : {}),
  };
}

function parseStateData(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeName(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidName(name) {
  if (!name || name.length < 2 || name.length > 80) return false;
  return /^[a-zA-Z0-9 .,'-]+$/.test(name);
}

function menuItemName(item) {
  return item.ussdName || item.name;
}

function categoryDisplayLabel(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key === "others") return "Ampesi";
  return String(category || "");
}

function chipsProteinLabel(fullName) {
  const raw = String(fullName || "").toLowerCase();
  if (raw.includes("grilled chicken")) return "Grilled Chicken";
  if (raw.includes("fried chicken")) return "Fried Chicken";
  if (raw.includes("chicken wings")) return "Chicken Wings";
  return "";
}

function chipsBaseLabel(fullName) {
  const raw = String(fullName || "").toLowerCase();
  if (raw.includes("yam chips")) return "Yam";
  if (raw.includes("potato chips")) return "Pot";
  return "Chips";
}

function smartMenuItemName(item, category) {
  const categoryKey = String(category || "").trim().toLowerCase();
  if (!categoryKey.includes("chips")) {
    return menuItemName(item);
  }

  const fullName = cleanText(item?.name || "");
  const protein = chipsProteinLabel(fullName);
  const base = chipsBaseLabel(fullName);
  if (protein) {
    // Compact but explicit protein naming: Pot/Fried Chicken, Yam/Grilled Chicken, etc.
    return `${base}/${protein}`;
  }
  return fullName || menuItemName(item);
}

function comboCategoryKind(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key.includes("chips")) return "chips";
  if (["fried rice", "jollof rice", "plain rice", "rice"].includes(key)) return "rice";
  return null;
}

function normalizeOptionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function chipsBaseFullLabel(fullName) {
  const raw = String(fullName || "").toLowerCase();
  if (raw.includes("potato chips")) return "Potato Chips";
  if (raw.includes("yam chips")) return "Yam Chips";
  return "";
}

function comboProteinLabel(fullName) {
  const raw = String(fullName || "").toLowerCase();
  if (raw.includes("grilled chicken")) return "Grilled Chicken";
  if (raw.includes("fried chicken")) return "Fried Chicken";
  if (raw.includes("chicken wings")) return "Chicken Wings";
  if (raw.includes("beef sauce")) return "Beef Sauce";
  if (raw.includes("fish sauce")) return "Fish Sauce";
  if (raw.includes("egg stew")) return "Egg Stew";
  if (raw.includes("palava sauce")) return "Palava Sauce";
  if (raw.includes("red plantain") && raw.includes("chicken")) return "Chicken & Plantain";
  if (raw.includes("fish")) return "Fish";
  if (raw.includes("beef")) return "Beef";
  if (raw.includes("chicken")) return "Chicken";
  return "";
}

function riceBaseLabelFromCategory(category, fullName) {
  const key = String(category || "").trim().toLowerCase();
  if (key === "jollof rice") return "Jollof Rice";
  if (key === "fried rice") return "Fried Rice";
  if (key === "plain rice") return "Plain Rice";
  if (key === "rice") {
    const raw = String(fullName || "").toLowerCase();
    if (raw.includes("jollof")) return "Jollof Rice";
    if (raw.includes("fried rice")) return "Fried Rice";
    if (raw.includes("plain rice")) return "Plain Rice";
  }
  return "";
}

function buildGuidedComboModel(category, items) {
  const kind = comboCategoryKind(category);
  if (!kind) return null;

  const list = Array.isArray(items) ? items : [];
  const baseToProteins = new Map();
  const baseOrder = [];

  for (const item of list) {
    const fullName = cleanText(item?.name || menuItemName(item));
    if (!fullName) continue;

    const baseLabel = kind === "chips"
      ? chipsBaseFullLabel(fullName)
      : riceBaseLabelFromCategory(category, fullName);
    const protein = comboProteinLabel(fullName);
    if (!baseLabel || !protein) continue;

    const baseKey = normalizeOptionKey(baseLabel);
    const proteinKey = normalizeOptionKey(protein);
    if (!baseKey || !proteinKey) continue;

    if (!baseToProteins.has(baseKey)) {
      baseToProteins.set(baseKey, {
        key: baseKey,
        label: baseLabel,
        proteins: new Map(),
      });
      baseOrder.push(baseKey);
    }

    const bucket = baseToProteins.get(baseKey);
    const existing = bucket.proteins.get(proteinKey);
    const candidatePrice = menuItemPrice(item);
    if (existing && existing.price <= candidatePrice) continue;

    bucket.proteins.set(proteinKey, {
      key: proteinKey,
      label: protein,
      price: candidatePrice,
      itemId: item.id,
      selectionName: `${baseLabel} + ${protein}`,
      item,
    });
  }

  if (!baseToProteins.size) return null;

  const chipsBasePriority = {
    "potato-chips": 1,
    "yam-chips": 2,
  };

  const baseOptions = baseOrder
    .map((key) => baseToProteins.get(key))
    .filter(Boolean)
    .sort((a, b) => {
      if (kind === "chips") {
        const rankA = chipsBasePriority[a.key] || 99;
        const rankB = chipsBasePriority[b.key] || 99;
        if (rankA !== rankB) return rankA - rankB;
      }
      return a.label.localeCompare(b.label);
    })
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
    }));

  const proteinOptionsByBase = {};
  baseOptions.forEach((base) => {
    const bucket = baseToProteins.get(base.key);
    const proteins = Array.from(bucket?.proteins?.values?.() || []);
    proteins.sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return a.label.localeCompare(b.label);
    });
    proteinOptionsByBase[base.key] = proteins;
  });

  if (!baseOptions.length) return null;
  return {
    kind,
    baseOptions,
    proteinOptionsByBase,
  };
}

function comboBasePromptTitle(kind) {
  if (kind === "chips") return "Select chips type";
  if (kind === "rice") return "Select rice type";
  return "Select meal type";
}

function comboProteinPromptTitle(kind) {
  if (kind === "chips") return "Select protein";
  if (kind === "rice") return "Select side or protein";
  return "Select protein";
}

function tokenizeWords(text) {
  return cleanText(text)
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function compactItemNameForCategory(name, category) {
  const fullName = cleanText(name);
  if (!fullName) return "Item";

  const itemWords = tokenizeWords(fullName);
  const categoryWords = tokenizeWords(category).map((word) => word.toLowerCase());
  if (!itemWords.length || !categoryWords.length) return fullName;

  let sharedPrefix = 0;
  while (
    sharedPrefix < itemWords.length &&
    sharedPrefix < categoryWords.length &&
    itemWords[sharedPrefix].toLowerCase() === categoryWords[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  if (sharedPrefix > 0 && sharedPrefix < itemWords.length) {
    return itemWords.slice(sharedPrefix).join(" ");
  }

  return fullName;
}

function itemDisplayNamesByCategory(category, items) {
  const list = Array.isArray(items) ? items : [];
  const smartNames = list.map((item) => smartMenuItemName(item, category));
  const compactNames = smartNames.map((name) => compactItemNameForCategory(name, category));
  const fullNames = smartNames.map((name) => cleanText(name) || "Item");
  const resolved = [...compactNames];

  const compactNameCount = new Map();
  compactNames.forEach((name) => {
    const key = name.toLowerCase();
    compactNameCount.set(key, (compactNameCount.get(key) || 0) + 1);
  });

  compactNames.forEach((name, index) => {
    const key = name.toLowerCase();
    if ((compactNameCount.get(key) || 0) > 1) {
      resolved[index] = fullNames[index];
    }
  });

  const resolvedCount = new Map();
  resolved.forEach((name) => {
    const key = name.toLowerCase();
    resolvedCount.set(key, (resolvedCount.get(key) || 0) + 1);
  });

  const sequence = new Map();
  return resolved.map((name) => {
    const key = name.toLowerCase();
    const total = resolvedCount.get(key) || 0;
    if (total <= 1) return name;
    const next = (sequence.get(key) || 0) + 1;
    sequence.set(key, next);
    return `${name} ${next}`;
  });
}

function menuItemPrice(item) {
  if (item.ussdPriceCedis != null) return Number(item.ussdPriceCedis || 0);
  return Number(item.priceCedis || 0);
}

function formatMoney(value, compact = false) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return compact ? "0" : "0.00";
  const fixed = amount.toFixed(2);
  if (!compact) return fixed;
  return fixed.endsWith(".00") ? String(Math.trunc(amount)) : fixed;
}

function deliveryLabel(value) {
  return value === "delivery" ? "Free Delivery" : "Pickup";
}

function calculateCartTotal(cart) {
  return Number(
    (cart || [])
      .reduce((sum, entry) => sum + Number(entry.unitPrice || 0) * Number(entry.quantity || 0), 0)
      .toFixed(2),
  );
}

function paginate(entries, page, pageSize) {
  const list = Array.isArray(entries) ? entries : [];
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const currentPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = currentPage * pageSize;
  return {
    entries: list.slice(start, start + pageSize),
    currentPage,
    totalPages,
    start,
  };
}

function baseState(closedPatch) {
  return {
    cart: [],
    categoryPage: 0,
    itemPage: 0,
    cartPage: 0,
    selectedCategory: null,
    comboBase: null,
    selectedItem: null,
    customerName: null,
    deliveryType: null,
    address: null,
    ...(closedPatch || {}),
  };
}

function parseSqliteTimestampToMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasRecentActivity(updatedAt) {
  const updatedAtMs = parseSqliteTimestampToMs(updatedAt);
  if (!updatedAtMs) return false;
  return Date.now() - updatedAtMs <= RESUME_WINDOW_MS;
}

function hasResumeProgress(state, stateData) {
  if (!state || state === STATE.RESUME_DECISION) return false;
  if (state === STATE.MAIN) return Array.isArray(stateData?.cart) && stateData.cart.length > 0;
  return [
    STATE.CATEGORY,
    STATE.COMBO_BASE,
    STATE.COMBO_PROTEIN,
    STATE.ITEM,
    STATE.QUANTITY,
    STATE.CART,
    STATE.FULL_NAME,
    STATE.DELIVERY_TYPE,
    STATE.ADDRESS,
    STATE.REVIEW,
    STATE.TRACK_ORDER,
  ].includes(state);
}

function canOfferResume(session, closedPatch) {
  if (!session || !hasRecentActivity(session.updated_at)) return false;
  const stateData = parseStateData(session.state_data);
  if (!hasResumeProgress(session.state, stateData)) return false;
  if (closedPatch?.closedMode && ![STATE.MAIN, STATE.TRACK_ORDER].includes(session.state)) {
    return false;
  }
  return true;
}

function withoutResumeState(stateData) {
  const next = { ...(stateData || {}) };
  delete next.resumeState;
  return next;
}

function resumeStageLabel(state) {
  switch (state) {
    case STATE.CATEGORY:
      return "Categories";
    case STATE.COMBO_BASE:
      return "Meal type";
    case STATE.COMBO_PROTEIN:
      return "Protein";
    case STATE.ITEM:
      return "Items";
    case STATE.QUANTITY:
      return "Quantity";
    case STATE.CART:
      return "Cart";
    case STATE.FULL_NAME:
      return "Checkout";
    case STATE.DELIVERY_TYPE:
      return "Delivery type";
    case STATE.ADDRESS:
      return "Address";
    case STATE.REVIEW:
      return "Review";
    case STATE.TRACK_ORDER:
      return "Track order";
    default:
      return "Home";
  }
}

async function saveSession(payload, state, stateData) {
  await upsertSession({
    sessionId: payload.SessionId,
    phone: payload.Mobile,
    state,
    stateData,
  });
}

function sortedCategories(menuByCategory) {
  return Object.keys(menuByCategory || {}).sort((a, b) => {
    const priorityDiff = ussdCategoryPriority(a) - ussdCategoryPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.localeCompare(b);
  });
}

function itemPromptTitleForCategory(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key.includes("shawarma")) return "Select type or size";
  if (key.includes("assorted")) return "Select assorted option";
  if (key.includes("rice")) return "Select side or protein";
  if (key.includes("chips")) return "Select chips combo";
  if (key.includes("others")) return "Select Ampesi option";
  if (key.includes("salad")) return "Select salad option";
  return "Select an item";
}

async function showMain(payload, stateData, prefix = "") {
  const merged = { ...baseState(), ...stateData };
  await saveSession(payload, STATE.MAIN, merged);

  if (merged.closedMode) {
    return responseBody({
      sessionId: payload.SessionId,
      message: formatScreen({
        title: MAIN_WELCOME_TITLE,
        body: [truncate(merged.closureMessage || "Restaurant closed for new orders", 46)],
        menu: ["4. Track order", "0. Exit"],
      }),
      clientState: STATE.MAIN,
    });
  }

  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: MAIN_WELCOME_TITLE,
      notice: prefix,
      body: [`Cart: ${(merged.cart || []).length} item(s)`],
      menu: ["1. Add to cart", "2. View cart", "3. Checkout", "4. Track order", "0. Exit"],
    }),
    clientState: STATE.MAIN,
  });
}

async function showCategoryPage(payload, stateData, menuByCategory, page = 0, prefix = "") {
  const categories = sortedCategories(menuByCategory);
  if (!categories.length) {
    return showMain(payload, stateData, "Menu unavailable now.");
  }

  const paged = paginate(categories, page, CATEGORY_PAGE_SIZE);
  const menu = [];
  if (paged.currentPage < paged.totalPages - 1) menu.push("98. Next");
  if (paged.currentPage > 0) menu.push("99. Prev");
  menu.push("9. Cart", "8. Checkout");
  menu.push("0. Back");

  await saveSession(payload, STATE.CATEGORY, {
    ...stateData,
    categoryPage: paged.currentPage,
  });

  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Select a meal category",
      notice: prefix,
      body: [
        ...(paged.totalPages > 1 ? [`Page ${paged.currentPage + 1}/${paged.totalPages}`] : []),
        ...paged.entries.map((category, index) => `${index + 1}. ${truncate(categoryDisplayLabel(category), 24)}`),
      ],
      menu,
    }),
    clientState: STATE.CATEGORY,
  });
}

async function showComboBasePage(payload, stateData, category, items, page = 0, prefix = "") {
  const model = buildGuidedComboModel(category, items);
  if (!model) {
    return showItemPage(payload, stateData, category, items, page, prefix);
  }

  if (model.baseOptions.length <= 1) {
    const onlyBase = model.baseOptions[0];
    return showComboProteinPage(payload, {
      ...stateData,
      selectedCategory: category,
      comboBase: onlyBase?.key || null,
    }, category, items, onlyBase?.key || null, 0, prefix);
  }

  const paged = paginate(model.baseOptions, page, ITEM_PAGE_SIZE);
  const menu = [];
  if (paged.currentPage < paged.totalPages - 1) menu.push("98. Next");
  if (paged.currentPage > 0) menu.push("99. Prev");
  menu.push("9. Cart", "8. Checkout", "0. Back");

  await saveSession(payload, STATE.COMBO_BASE, {
    ...stateData,
    selectedCategory: category,
    comboBase: null,
    itemPage: paged.currentPage,
  });

  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: truncate(comboBasePromptTitle(model.kind), 24),
      notice: prefix,
      body: [
        ...(paged.totalPages > 1 ? [`P${paged.currentPage + 1}/${paged.totalPages}`] : []),
        ...paged.entries.map((option, index) => `${index + 1}. ${truncate(option.label, 24)}`),
      ],
      menu,
    }),
    clientState: STATE.COMBO_BASE,
  });
}

async function showComboProteinPage(payload, stateData, category, items, baseKey = null, page = 0, prefix = "") {
  const model = buildGuidedComboModel(category, items);
  if (!model) {
    return showItemPage(payload, stateData, category, items, page, prefix);
  }

  const selectedBase = model.baseOptions.find((option) => option.key === baseKey) || model.baseOptions[0];
  if (!selectedBase) {
    return showItemPage(payload, stateData, category, items, page, prefix);
  }

  const proteinOptions = model.proteinOptionsByBase[selectedBase.key] || [];
  if (!proteinOptions.length) {
    return showComboBasePage(payload, stateData, category, items, 0, "No options available.");
  }

  const paged = paginate(proteinOptions, page, ITEM_PAGE_SIZE);
  const menu = [];
  if (paged.currentPage < paged.totalPages - 1) menu.push("98. Next");
  if (paged.currentPage > 0) menu.push("99. Prev");
  menu.push("9. Cart", "8. Checkout", "0. Back");

  await saveSession(payload, STATE.COMBO_PROTEIN, {
    ...stateData,
    selectedCategory: category,
    comboBase: selectedBase.key,
    itemPage: paged.currentPage,
  });

  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: truncate(comboProteinPromptTitle(model.kind), 24),
      notice: prefix,
      body: [
        ...(paged.totalPages > 1 ? [`P${paged.currentPage + 1}/${paged.totalPages}`] : []),
        ...paged.entries.map((option, index) => `${index + 1}. ${truncate(option.label, 16)} - ${formatMoney(option.price, true)}`),
      ],
      menu,
    }),
    clientState: STATE.COMBO_PROTEIN,
  });
}

async function showItemPage(payload, stateData, category, items, page = 0, prefix = "") {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return showCategoryPage(payload, stateData, await getMenuGroupedByCategory(), stateData.categoryPage || 0, "No items here.");
  }

  const displayNames = itemDisplayNamesByCategory(category, list);

  const itemScreenVariants = [
    { nameLength: 15, includePageLabel: true, includeCheckout: true },
    { nameLength: 14, includePageLabel: true, includeCheckout: true },
    { nameLength: 13, includePageLabel: true, includeCheckout: true },
    { nameLength: 12, includePageLabel: true, includeCheckout: true },
    { nameLength: 11, includePageLabel: true, includeCheckout: true },
    { nameLength: 10, includePageLabel: true, includeCheckout: true },
    { nameLength: 10, includePageLabel: false, includeCheckout: true },
    { nameLength: 9, includePageLabel: false, includeCheckout: true },
    { nameLength: 9, includePageLabel: false, includeCheckout: false },
  ];

  let chosen = null;
  for (const variant of itemScreenVariants) {
    const entries = list.map((item, index) => `${truncate(displayNames[index], variant.nameLength)} - ${formatMoney(menuItemPrice(item), true)}`);
    const paged = paginate(entries, page, ITEM_PAGE_SIZE);
    const menu = [];
    if (paged.currentPage < paged.totalPages - 1) menu.push("98. Next");
    if (paged.currentPage > 0) menu.push("99. Prev");
    menu.push("9. Cart");
    if (variant.includeCheckout) menu.push("8. Checkout");
    menu.push("0. Back");

    const message = formatScreen({
      title: truncate(itemPromptTitleForCategory(category), 24),
      notice: prefix,
      body: [
        ...(variant.includePageLabel && paged.totalPages > 1 ? [`P${paged.currentPage + 1}/${paged.totalPages}`] : []),
        ...paged.entries.map((entry, index) => `${index + 1}. ${entry}`),
      ],
      menu,
    });

    chosen = {
      paged,
      message,
    };

    if (message.length <= MAX_MESSAGE_LENGTH && message.endsWith("0. Back")) {
      break;
    }
  }

  const paged = chosen?.paged || paginate(list, page, ITEM_PAGE_SIZE);
  const message = chosen?.message || formatScreen({
    title: truncate(itemPromptTitleForCategory(category), 24),
    notice: prefix,
    body: [],
    menu: ["0. Back"],
  });

  await saveSession(payload, STATE.ITEM, {
    ...stateData,
    selectedCategory: category,
    comboBase: null,
    itemPage: paged.currentPage,
  });

  return responseBody({
    sessionId: payload.SessionId,
    message,
    clientState: STATE.ITEM,
  });
}

function cartEntryLine(entry) {
  const lineTotal = Number((Number(entry.unitPrice || 0) * Number(entry.quantity || 0)).toFixed(2));
  return `${truncate(entry.name, 12)} x${entry.quantity} - ${formatMoney(lineTotal)}`;
}

async function showCartPage(payload, stateData, page = 0, prefix = "") {
  const cart = stateData.cart || [];
  if (!cart.length) {
    await saveSession(payload, STATE.CART, {
      ...stateData,
      cartPage: 0,
    });

    return responseBody({
      sessionId: payload.SessionId,
      message: formatScreen({
        title: "Your cart",
        notice: prefix,
        body: ["No items yet"],
        menu: ["1. Add to cart", "8. Checkout", "0. Back"],
      }),
      clientState: STATE.CART,
    });
  }

  const paged = paginate(cart.map(cartEntryLine), page, CART_PAGE_SIZE);
  const menu = [];
  if (paged.currentPage < paged.totalPages - 1) menu.push("98. Next");
  if (paged.currentPage > 0) menu.push("99. Prev");
  menu.push("1. Add to cart", "8. Checkout", "3. Clear cart", "0. Back");

  await saveSession(payload, STATE.CART, {
    ...stateData,
    cartPage: paged.currentPage,
  });

  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Your cart",
      notice: prefix,
      body: [
        ...(paged.totalPages > 1 ? [`Page ${paged.currentPage + 1}/${paged.totalPages}`] : []),
        ...paged.entries.map((entry, index) => `${index + 1}. ${entry}`),
        `Total GHS ${formatMoney(calculateCartTotal(cart))}`,
      ],
      menu,
    }),
    clientState: STATE.CART,
  });
}

async function showNamePrompt(payload, stateData, prefix = "") {
  await saveSession(payload, STATE.FULL_NAME, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Checkout",
      notice: prefix,
      body: ["Enter full name:"],
      menu: ["0. Back"],
    }),
    clientState: STATE.FULL_NAME,
  });
}

async function showDeliveryTypePrompt(payload, stateData, prefix = "") {
  await saveSession(payload, STATE.DELIVERY_TYPE, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Checkout",
      notice: prefix,
      menu: ["1. Pickup", "2. Free Delivery", "0. Back"],
    }),
    clientState: STATE.DELIVERY_TYPE,
  });
}

async function showAddressPrompt(payload, stateData, prefix = "") {
  await saveSession(payload, STATE.ADDRESS, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Delivery address",
      notice: prefix,
      body: ["Enter location/address:"],
      menu: ["0. Back"],
    }),
    clientState: STATE.ADDRESS,
  });
}

async function showReviewPage(payload, stateData, prefix = "") {
  const cart = stateData.cart || [];
  if (!cart.length) {
    return showCartPage(payload, stateData, stateData.cartPage || 0, "Cart is empty.");
  }

  const body = [
    `Items: ${cart.length}`,
    `Total: GHS ${formatMoney(calculateCartTotal(cart))}`,
    `Type: ${deliveryLabel(stateData.deliveryType)}`,
  ];
  if (stateData.deliveryType === "delivery") {
    body.push(`Address: ${truncate(stateData.address || "Unknown", 28)}`);
  }

  await saveSession(payload, STATE.REVIEW, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Review order",
      notice: prefix,
      body,
      menu: ["1. Confirm & Pay", "2. Edit cart", "0. Cancel"],
    }),
    clientState: STATE.REVIEW,
  });
}

async function showTrackPrompt(payload, stateData, prefix = "") {
  await saveSession(payload, STATE.TRACK_ORDER, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: "Track order",
      notice: prefix,
      body: ["Enter order number:", "Example: R00025"],
      menu: ["0. Back"],
    }),
    clientState: STATE.TRACK_ORDER,
  });
}

async function showQuantityPrompt(payload, stateData, menuByCategory, prefix = "") {
  const selected = stateData.selectedItem;
  if (!selected) {
    const category = stateData.selectedCategory;
    const items = category ? (menuByCategory[category] || []) : [];
    const comboModel = buildGuidedComboModel(category, items);
    if (comboModel) {
      return showComboBasePage(
        payload,
        stateData,
        category,
        items,
        stateData.itemPage || 0,
      );
    }
    return showItemPage(
      payload,
      stateData,
      category,
      items,
      stateData.itemPage || 0,
    );
  }

  await saveSession(payload, STATE.QUANTITY, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: truncate(selected.name, 24),
      notice: prefix,
      body: [`GHS ${formatMoney(selected.unitPrice, true)}`, "Enter quantity (1-20):"],
      menu: ["0. Back"],
    }),
    clientState: STATE.QUANTITY,
  });
}

async function showResumePrompt(payload, stateData, prefix = "") {
  await saveSession(payload, STATE.RESUME_DECISION, { ...stateData });
  return responseBody({
    sessionId: payload.SessionId,
    message: formatScreen({
      title: BRAND,
      notice: prefix,
      body: [
        "Continue last session?",
        `Stage: ${resumeStageLabel(stateData.resumeState)}`,
        `Cart: ${(stateData.cart || []).length} item(s)`,
      ],
      menu: ["1. Continue", "2. Start over", "0. Exit"],
    }),
    clientState: STATE.RESUME_DECISION,
  });
}

async function finalizeOrder(payload, stateData) {
  const cart = stateData.cart || [];
  if (!cart.length) {
    return showCartPage(payload, stateData, 0, "Cart is empty.");
  }

  const fullName = normalizeName(stateData.customerName) || `USSD Customer ${String(payload.Mobile).slice(-4)}`;

  const order = await createOrderFromRequest({
    phone: payload.Mobile,
    fullName,
    deliveryType: stateData.deliveryType,
    address: stateData.deliveryType === "delivery" ? stateData.address : null,
    items: cart.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
    })),
    hubtelSessionId: payload.SessionId,
    clientReference: payload.SessionId,
    source: "ussd",
  });

  await deleteSession(payload.SessionId);

  return responseBody({
    sessionId: payload.SessionId,
    type: "AddToCart",
    message: `Order ${order.orderNumber} created. Please wait for payment prompt, then enter your MoMo PIN.`,
    label: "Approve payment",
    item: {
      ItemName: `Unilove Order ${order.orderNumber}`,
      Qty: 1,
      Price: Number(order.subtotalCedis || 0),
    },
  });
}

async function handleMainSelection(payload, stateData, input, menuByCategory) {
  if (stateData.closedMode) {
    if (input === "4") return showTrackPrompt(payload, stateData);
    if (input === "0") {
      await deleteSession(payload.SessionId);
      return responseBody({
        sessionId: payload.SessionId,
        type: "release",
        message: "Session ended.",
      });
    }
    return showMain(payload, stateData);
  }

  if (input === "1") return showCategoryPage(payload, stateData, menuByCategory, 0);
  if (input === "2") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "3") {
    if (!(stateData.cart || []).length) return showMain(payload, stateData, "Cart is empty.");
    return showNamePrompt(payload, stateData);
  }
  if (input === "4") return showTrackPrompt(payload, stateData);
  if (input === "0") {
    await deleteSession(payload.SessionId);
    return responseBody({
      sessionId: payload.SessionId,
      type: "release",
      message: "Session ended.",
    });
  }

  return showMain(payload, stateData, "Invalid option.");
}

async function resumeSessionFlow(payload, stateData, menuByCategory) {
  const restored = withoutResumeState(stateData);

  switch (stateData.resumeState) {
    case STATE.CATEGORY:
      return showCategoryPage(payload, restored, menuByCategory, restored.categoryPage || 0, "Session resumed.");
    case STATE.COMBO_BASE: {
      const category = restored.selectedCategory;
      const items = category ? (menuByCategory[category] || []) : [];
      if (!category || !items.length) {
        return showCategoryPage(payload, restored, menuByCategory, restored.categoryPage || 0, "Menu changed. Pick category.");
      }
      return showComboBasePage(payload, restored, category, items, restored.itemPage || 0, "Session resumed.");
    }
    case STATE.COMBO_PROTEIN: {
      const category = restored.selectedCategory;
      const items = category ? (menuByCategory[category] || []) : [];
      if (!category || !items.length) {
        return showCategoryPage(payload, restored, menuByCategory, restored.categoryPage || 0, "Menu changed. Pick category.");
      }
      return showComboProteinPage(
        payload,
        restored,
        category,
        items,
        restored.comboBase || null,
        restored.itemPage || 0,
        "Session resumed.",
      );
    }
    case STATE.ITEM: {
      const category = restored.selectedCategory;
      const items = category ? (menuByCategory[category] || []) : [];
      if (!category || !items.length) {
        return showCategoryPage(payload, restored, menuByCategory, restored.categoryPage || 0, "Menu changed. Pick category.");
      }
      return showItemPage(payload, restored, category, items, restored.itemPage || 0, "Session resumed.");
    }
    case STATE.QUANTITY:
      return showQuantityPrompt(payload, restored, menuByCategory, "Session resumed.");
    case STATE.CART:
      return showCartPage(payload, restored, restored.cartPage || 0, "Session resumed.");
    case STATE.FULL_NAME:
      return showNamePrompt(payload, restored, "Session resumed.");
    case STATE.DELIVERY_TYPE:
      return showDeliveryTypePrompt(payload, restored, "Session resumed.");
    case STATE.ADDRESS:
      return showAddressPrompt(payload, restored, "Session resumed.");
    case STATE.REVIEW:
      return showReviewPage(payload, restored, "Session resumed.");
    case STATE.TRACK_ORDER:
      return showTrackPrompt(payload, restored, "Session resumed.");
    case STATE.MAIN:
    default:
      return showMain(payload, restored, "Session resumed.");
  }
}

async function handleResumeSelection(payload, stateData, input, menuByCategory) {
  if (input === "1") {
    return resumeSessionFlow(payload, stateData, menuByCategory);
  }

  if (input === "2") {
    return showMain(payload, baseState({
      closedMode: !!stateData.closedMode,
      closureMessage: stateData.closureMessage || null,
    }));
  }

  if (input === "0") {
    await deleteSession(payload.SessionId);
    return responseBody({
      sessionId: payload.SessionId,
      type: "release",
      message: "Session ended.",
    });
  }

  return showResumePrompt(payload, stateData, "Invalid option.");
}

async function handleCategorySelection(payload, stateData, input, menuByCategory) {
  const categories = sortedCategories(menuByCategory);
  const paged = paginate(categories, stateData.categoryPage || 0, CATEGORY_PAGE_SIZE);

  if (input === "9") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "8") {
    if (!(stateData.cart || []).length) {
      return showCategoryPage(payload, stateData, menuByCategory, paged.currentPage, "Cart is empty.");
    }
    return showNamePrompt(payload, stateData);
  }
  if (input === "0") return showMain(payload, stateData);
  if (input === "98" && paged.currentPage < paged.totalPages - 1) {
    return showCategoryPage(payload, stateData, menuByCategory, paged.currentPage + 1);
  }
  if (input === "99" && paged.currentPage > 0) {
    return showCategoryPage(payload, stateData, menuByCategory, paged.currentPage - 1);
  }

  const choice = toInt(input);
  if (!choice || choice < 1 || choice > paged.entries.length) {
    return showCategoryPage(payload, stateData, menuByCategory, paged.currentPage, "Invalid category.");
  }

  const selectedCategory = categories[paged.start + choice - 1];
  const items = menuByCategory[selectedCategory] || [];
  const comboModel = buildGuidedComboModel(selectedCategory, items);
  if (comboModel) {
    return showComboBasePage(
      payload,
      {
        ...stateData,
        selectedCategory,
        comboBase: null,
        itemPage: 0,
      },
      selectedCategory,
      items,
      0,
    );
  }

  return showItemPage(payload, { ...stateData, selectedCategory, comboBase: null }, selectedCategory, items, 0);
}

async function handleComboBaseSelection(payload, stateData, input, menuByCategory) {
  const category = stateData.selectedCategory;
  const items = category ? (menuByCategory[category] || []) : [];
  const model = buildGuidedComboModel(category, items);
  if (!model) {
    return showItemPage(payload, stateData, category, items, stateData.itemPage || 0, "Choose item.");
  }

  const paged = paginate(model.baseOptions, stateData.itemPage || 0, ITEM_PAGE_SIZE);

  if (input === "9") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "8") {
    if (!(stateData.cart || []).length) {
      return showComboBasePage(payload, stateData, category, items, paged.currentPage, "Cart is empty.");
    }
    return showNamePrompt(payload, stateData);
  }
  if (input === "0") return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0);
  if (input === "98" && paged.currentPage < paged.totalPages - 1) {
    return showComboBasePage(payload, stateData, category, items, paged.currentPage + 1);
  }
  if (input === "99" && paged.currentPage > 0) {
    return showComboBasePage(payload, stateData, category, items, paged.currentPage - 1);
  }

  const choice = toInt(input);
  if (!choice || choice < 1 || choice > paged.entries.length) {
    return showComboBasePage(payload, stateData, category, items, paged.currentPage, "Invalid option.");
  }

  const selectedBase = model.baseOptions[paged.start + choice - 1];
  return showComboProteinPage(
    payload,
    {
      ...stateData,
      comboBase: selectedBase?.key || null,
      itemPage: 0,
    },
    category,
    items,
    selectedBase?.key || null,
    0,
  );
}

async function handleComboProteinSelection(payload, stateData, input, menuByCategory) {
  const category = stateData.selectedCategory;
  const items = category ? (menuByCategory[category] || []) : [];
  const model = buildGuidedComboModel(category, items);
  if (!model) {
    return showItemPage(payload, stateData, category, items, stateData.itemPage || 0, "Choose item.");
  }

  const base = model.baseOptions.find((option) => option.key === stateData.comboBase) || model.baseOptions[0];
  if (!base) {
    return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0, "Category changed.");
  }

  const proteins = model.proteinOptionsByBase[base.key] || [];
  const paged = paginate(proteins, stateData.itemPage || 0, ITEM_PAGE_SIZE);

  if (input === "9") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "8") {
    if (!(stateData.cart || []).length) {
      return showComboProteinPage(payload, stateData, category, items, base.key, paged.currentPage, "Cart is empty.");
    }
    return showNamePrompt(payload, stateData);
  }
  if (input === "0") {
    if (model.baseOptions.length > 1) {
      return showComboBasePage(payload, stateData, category, items, 0);
    }
    return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0);
  }
  if (input === "98" && paged.currentPage < paged.totalPages - 1) {
    return showComboProteinPage(payload, stateData, category, items, base.key, paged.currentPage + 1);
  }
  if (input === "99" && paged.currentPage > 0) {
    return showComboProteinPage(payload, stateData, category, items, base.key, paged.currentPage - 1);
  }

  const choice = toInt(input);
  if (!choice || choice < 1 || choice > paged.entries.length) {
    return showComboProteinPage(payload, stateData, category, items, base.key, paged.currentPage, "Invalid option.");
  }

  const selected = proteins[paged.start + choice - 1];
  if (!selected?.item?.id) {
    return showComboProteinPage(payload, stateData, category, items, base.key, paged.currentPage, "Item unavailable.");
  }

  return showQuantityPrompt(
    payload,
    {
      ...stateData,
      selectedCategory: category,
      comboBase: base.key,
      selectedItem: {
        id: selected.item.id,
        name: selected.selectionName || selected.item.name || selected.label,
        unitPrice: Number(selected.price || menuItemPrice(selected.item)),
        source: "combo",
        comboBase: base.key,
      },
    },
    menuByCategory,
  );
}

async function handleItemSelection(payload, stateData, input, menuByCategory) {
  const category = stateData.selectedCategory;
  const items = category ? (menuByCategory[category] || []) : [];

  if (!items.length) {
    return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0, "Category empty.");
  }

  const paged = paginate(items, stateData.itemPage || 0, ITEM_PAGE_SIZE);
  const displayNames = itemDisplayNamesByCategory(category, items);

  if (input === "9") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "8") {
    if (!(stateData.cart || []).length) {
      return showItemPage(payload, stateData, category, items, paged.currentPage, "Cart is empty.");
    }
    return showNamePrompt(payload, stateData);
  }
  if (input === "0") {
    return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0);
  }
  if (input === "98" && paged.currentPage < paged.totalPages - 1) {
    return showItemPage(payload, stateData, category, items, paged.currentPage + 1);
  }
  if (input === "99" && paged.currentPage > 0) {
    return showItemPage(payload, stateData, category, items, paged.currentPage - 1);
  }

  const choice = toInt(input);
  if (!choice || choice < 1 || choice > paged.entries.length) {
    return showItemPage(payload, stateData, category, items, paged.currentPage, "Invalid item.");
  }

  const selected = items[paged.start + choice - 1];
  const selectedDisplayName = displayNames[paged.start + choice - 1] || menuItemName(selected);
  const quantityState = {
    ...stateData,
    selectedCategory: category,
    selectedItem: {
      id: selected.id,
      name: selectedDisplayName,
      unitPrice: menuItemPrice(selected),
      source: "item",
    },
  };
  return showQuantityPrompt(payload, quantityState, menuByCategory);
}

async function handleQuantityInput(payload, stateData, input, menuByCategory) {
  const selected = stateData.selectedItem;
  if (!selected) {
    const category = stateData.selectedCategory;
    const items = category ? (menuByCategory[category] || []) : [];
    const comboModel = buildGuidedComboModel(category, items);
    if (comboModel) {
      return showComboBasePage(
        payload,
        stateData,
        category,
        items,
        stateData.itemPage || 0,
      );
    }
    return showItemPage(
      payload,
      stateData,
      category,
      items,
      stateData.itemPage || 0,
    );
  }

  if (input === "0") {
    if (selected.source === "combo") {
      const category = stateData.selectedCategory;
      const items = category ? (menuByCategory[category] || []) : [];
      return showComboProteinPage(
        payload,
        stateData,
        category,
        items,
        stateData.comboBase || selected.comboBase || null,
        stateData.itemPage || 0,
      );
    }
    return showItemPage(
      payload,
      stateData,
      stateData.selectedCategory,
      menuByCategory[stateData.selectedCategory] || [],
      stateData.itemPage || 0,
    );
  }

  const quantity = toInt(input);
  if (!quantity || quantity < 1 || quantity > 20) {
    return responseBody({
      sessionId: payload.SessionId,
      message: formatScreen({
        title: truncate(selected.name, 24),
        body: ["Enter quantity: 1-20"],
        menu: ["0. Back"],
      }),
      clientState: STATE.QUANTITY,
    });
  }

  const cart = [...(stateData.cart || [])];
  const existingIndex = cart.findIndex((entry) => entry.itemId === selected.id);

  if (existingIndex >= 0) {
    cart[existingIndex].quantity += quantity;
  } else {
    cart.push({
      itemId: selected.id,
      name: selected.name,
      quantity,
      unitPrice: selected.unitPrice,
    });
  }

  return showCartPage(
    payload,
    {
      ...stateData,
      cart,
      selectedItem: null,
      comboBase: null,
      cartPage: 0,
    },
    0,
    `${truncate(selected.name, 14)} added x${quantity}.`,
  );
}

async function handleCartSelection(payload, stateData, input, menuByCategory) {
  const cart = stateData.cart || [];
  const paged = paginate(cart, stateData.cartPage || 0, CART_PAGE_SIZE);

  if (input === "98" && paged.currentPage < paged.totalPages - 1) {
    return showCartPage(payload, stateData, paged.currentPage + 1);
  }
  if (input === "99" && paged.currentPage > 0) {
    return showCartPage(payload, stateData, paged.currentPage - 1);
  }
  if (input === "0") return showMain(payload, stateData);
  if (input === "1") return showCategoryPage(payload, stateData, menuByCategory, stateData.categoryPage || 0);
  if (input === "2" || input === "8") {
    if (!cart.length) return showCartPage(payload, stateData, paged.currentPage, "Cart is empty.");
    return showNamePrompt(payload, stateData);
  }
  if (input === "3") {
    return showCartPage(payload, {
      ...stateData,
      cart: [],
      cartPage: 0,
    }, 0, "Cart cleared.");
  }

  return showCartPage(payload, stateData, paged.currentPage, "Invalid option.");
}

async function handleFullNameInput(payload, stateData, input) {
  if (input === "0") {
    return showCartPage(payload, stateData, stateData.cartPage || 0);
  }

  const fullName = normalizeName(input);
  if (!isValidName(fullName)) {
    return showNamePrompt(payload, stateData, "Enter valid name (2-80).");
  }

  return showDeliveryTypePrompt(payload, {
    ...stateData,
    customerName: fullName,
  });
}

async function handleDeliveryTypeSelection(payload, stateData, input) {
  if (input === "0") return showNamePrompt(payload, stateData);

  if (input === "1") {
    return showReviewPage(payload, {
      ...stateData,
      deliveryType: "pickup",
      address: null,
    });
  }

  if (input === "2") {
    return showAddressPrompt(payload, {
      ...stateData,
      deliveryType: "delivery",
    });
  }

  return showDeliveryTypePrompt(payload, stateData, "Invalid option.");
}

async function handleAddressInput(payload, stateData, input) {
  if (input === "0") return showDeliveryTypePrompt(payload, stateData);

  const address = String(input || "").trim();
  if (address.length < 4) {
    return showAddressPrompt(payload, stateData, "Address too short.");
  }

  return showReviewPage(payload, {
    ...stateData,
    deliveryType: "delivery",
    address,
  });
}

async function handleReviewSelection(payload, stateData, input) {
  if (input === "0") return showMain(payload, stateData);
  if (input === "2") return showCartPage(payload, stateData, stateData.cartPage || 0);
  if (input === "1") {
    try {
      return await finalizeOrder(payload, stateData);
    } catch (_error) {
      return showReviewPage(payload, stateData, "Order failed. Retry.");
    }
  }

  return showReviewPage(payload, stateData, "Invalid option.");
}

async function handleTrackInput(payload, stateData, input) {
  if (input === "0") return showMain(payload, stateData);

  if (!input || input.length < 2) {
    return showTrackPrompt(payload, stateData, "Enter valid order number.");
  }

  try {
    const tracking = await getOrderByOrderNumberForTracking({
      orderNumber: input,
      customerPhone: payload.Mobile,
      allowPhoneMatch: true,
    });
    await deleteSession(payload.SessionId);
    return responseBody({
      sessionId: payload.SessionId,
      type: "release",
      message: `Order ${tracking.orderNumber}: ${tracking.stage}`,
    });
  } catch (_error) {
    return showTrackPrompt(payload, stateData, "Order not found.");
  }
}

async function handleUssdRequest(payload) {
  if (payload.Type === "Timeout") {
    return responseBody({
      sessionId: payload.SessionId,
      type: "release",
      message: "Session timed out. Dial again to continue.",
    });
  }

  const storeStatus = await getStoreStatus();
  const closedPatch = storeStatus.isOpen
    ? { closedMode: false, closureMessage: null }
    : { closedMode: true, closureMessage: storeStatus.closureMessage };

  if (payload.Type === "Initiation") {
    await deleteSession(payload.SessionId);
    const latestSession = await getLatestSessionByPhone(payload.Mobile, payload.SessionId);
    if (canOfferResume(latestSession, closedPatch)) {
      const resumedStateData = {
        ...baseState(closedPatch),
        ...parseStateData(latestSession.state_data),
        ...closedPatch,
        resumeState: latestSession.state,
      };
      if (latestSession.session_id && latestSession.session_id !== payload.SessionId) {
        await deleteSession(latestSession.session_id);
      }
      return showResumePrompt(payload, resumedStateData);
    }
    return showMain(payload, baseState(closedPatch));
  }

  const session = await getSession(payload.SessionId);
  if (!session) {
    return showMain(payload, baseState(closedPatch), "Session restarted.");
  }

  const stateData = {
    ...baseState(closedPatch),
    ...parseStateData(session.state_data),
    ...closedPatch,
  };
  const input = normalizeMenuInput(payload.Message);

  if (stateData.closedMode && ![STATE.MAIN, STATE.TRACK_ORDER, STATE.RESUME_DECISION].includes(session.state)) {
    return showMain(payload, stateData);
  }

  const menuByCategory = await getMenuGroupedByCategory();

  switch (session.state) {
    case STATE.MAIN:
      return handleMainSelection(payload, stateData, input, menuByCategory);
    case STATE.RESUME_DECISION:
      return handleResumeSelection(payload, stateData, input, menuByCategory);
    case STATE.CATEGORY:
      return handleCategorySelection(payload, stateData, input, menuByCategory);
    case STATE.COMBO_BASE:
      return handleComboBaseSelection(payload, stateData, input, menuByCategory);
    case STATE.COMBO_PROTEIN:
      return handleComboProteinSelection(payload, stateData, input, menuByCategory);
    case STATE.ITEM:
      return handleItemSelection(payload, stateData, input, menuByCategory);
    case STATE.QUANTITY:
      return handleQuantityInput(payload, stateData, input, menuByCategory);
    case STATE.CART:
      return handleCartSelection(payload, stateData, input, menuByCategory);
    case STATE.FULL_NAME:
      return handleFullNameInput(payload, stateData, input);
    case STATE.DELIVERY_TYPE:
      return handleDeliveryTypeSelection(payload, stateData, input);
    case STATE.ADDRESS:
      return handleAddressInput(payload, stateData, input);
    case STATE.REVIEW:
      return handleReviewSelection(payload, stateData, input);
    case STATE.TRACK_ORDER:
      return handleTrackInput(payload, stateData, input);
    default:
      return showMain(payload, baseState(closedPatch));
  }
}

module.exports = {
  handleUssdRequest,
};
