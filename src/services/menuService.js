const {
  listActiveMenuItems,
  listMenuByCategory,
  listAllMenuItemsForAdmin,
  setMenuItemAvailability,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  listMenuCategories,
  createMenuCategory,
  renameMenuCategory,
  deleteMenuCategory,
} = require("../repositories/menuRepository");
const { logSensitiveAction } = require("./auditService");

const USSD_SHORT_TARGET_LENGTH = 18;

function makeMenuId(name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "item"}-${suffix}`;
}

function deriveUssdShortName(name) {
  const raw = String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Menu item";
  return raw.length <= 38 ? raw : `${raw.slice(0, 35).trim()}...`;
}

function normalizeMenuLabel(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMenuLabel(value) {
  return normalizeMenuLabel(value)
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function removeCategoryPrefix(name, category) {
  const itemWords = tokenizeMenuLabel(name);
  const categoryWords = tokenizeMenuLabel(category).map((word) => word.toLowerCase());
  if (!itemWords.length || !categoryWords.length) {
    return normalizeMenuLabel(name);
  }

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

  return normalizeMenuLabel(name);
}

function truncateShortName(value, maxLength = USSD_SHORT_TARGET_LENGTH) {
  const cleaned = normalizeMenuLabel(value);
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim();
}

function buildOptimizedUssdShortName({ name, category }) {
  const compact = removeCategoryPrefix(name, category);
  const truncatedCompact = truncateShortName(compact);
  if (truncatedCompact.length >= 2) return truncatedCompact;

  const fallback = truncateShortName(name);
  if (fallback.length >= 2) return fallback;

  return "Item";
}

function isCustomCompactName({ currentShortName, fullName }) {
  const short = normalizeMenuLabel(currentShortName);
  if (!short) return false;
  const normalizedFullName = normalizeMenuLabel(fullName);
  return short.length <= USSD_SHORT_TARGET_LENGTH && short.toLowerCase() !== normalizedFullName.toLowerCase();
}

function applyCollisionSuffix(baseName, index, maxLength = USSD_SHORT_TARGET_LENGTH) {
  if (index <= 1) return baseName;
  const suffix = ` ${index}`;
  const base = truncateShortName(baseName, Math.max(2, maxLength - suffix.length));
  return `${base}${suffix}`;
}

async function getMenu() {
  return listActiveMenuItems();
}

async function getMenuGroupedByCategory() {
  const rows = await listMenuByCategory();
  const grouped = {};

  const effectiveUssdPrice = (item) => {
    const ussdPrice = Number(item.ussdPriceCedis);
    if (Number.isFinite(ussdPrice) && ussdPrice > 0) return ussdPrice;
    const basePrice = Number(item.priceCedis);
    if (Number.isFinite(basePrice) && basePrice > 0) return basePrice;
    return 0;
  };

  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push({
      id: row.id,
      name: row.name,
      priceCedis: row.price_cedis,
      ussdName: row.ussd_short_name || deriveUssdShortName(row.name),
      ussdPriceCedis: row.ussd_price_cedis == null ? null : Number(row.ussd_price_cedis),
    });
  }

  for (const category of Object.keys(grouped)) {
    grouped[category].sort((a, b) => {
      const priceDiff = effectiveUssdPrice(a) - effectiveUssdPrice(b);
      if (priceDiff !== 0) return priceDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  return grouped;
}

async function getMenuForAdmin() {
  const rows = await listAllMenuItemsForAdmin();
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    name: row.name,
    priceCedis: row.price_cedis,
    ussdShortName: row.ussd_short_name || "",
    ussdPriceCedis: row.ussd_price_cedis == null ? null : Number(row.ussd_price_cedis),
    ussdVisible: Boolean(row.ussd_is_visible),
    isActive: Boolean(row.is_active),
  }));
}

async function updateMenuAvailability({ itemId, isActive, adminId }) {
  const updated = await setMenuItemAvailability(itemId, isActive);
  if (!updated) {
    throw Object.assign(new Error("Menu item not found"), { statusCode: 404 });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_ITEM_AVAILABILITY_CHANGED",
    entityType: "menu_item",
    entityId: itemId,
    details: { isActive },
  });

  return { itemId, isActive };
}

async function getMenuCategoriesForAdmin() {
  const rows = await listMenuCategories();
  return rows.map((row) => ({
    category: row.category,
    itemCount: Number(row.item_count || 0),
  }));
}

async function createMenuItemForAdmin({
  category,
  name,
  priceCedis,
  ussdShortName,
  ussdPriceCedis,
  ussdVisible,
  isActive,
  adminId,
}) {
  const created = await createMenuItem({
    id: makeMenuId(name),
    category: category.trim(),
    name: name.trim(),
    priceCedis: Number(priceCedis),
    ussdShortName: ussdShortName?.trim() || null,
    ussdPriceCedis: ussdPriceCedis == null ? null : Number(ussdPriceCedis),
    ussdVisible: ussdVisible === undefined ? true : Boolean(ussdVisible),
    isActive: Boolean(isActive),
  });

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_ITEM_CREATED",
    entityType: "menu_item",
    entityId: created.id,
    details: {
      category: created.category,
      name: created.name,
      priceCedis: created.price_cedis,
      ussdShortName: created.ussd_short_name || null,
      ussdPriceCedis: created.ussd_price_cedis == null ? null : Number(created.ussd_price_cedis),
      ussdVisible: Boolean(created.ussd_is_visible),
    },
  });

  return {
    id: created.id,
    category: created.category,
    name: created.name,
    priceCedis: created.price_cedis,
    ussdShortName: created.ussd_short_name || "",
    ussdPriceCedis: created.ussd_price_cedis == null ? null : Number(created.ussd_price_cedis),
    ussdVisible: Boolean(created.ussd_is_visible),
    isActive: Boolean(created.is_active),
  };
}

async function editMenuItemForAdmin({
  itemId,
  category,
  name,
  priceCedis,
  ussdShortName,
  ussdPriceCedis,
  ussdVisible,
  adminId,
}) {
  const updated = await updateMenuItem({
    itemId,
    category: category?.trim(),
    name: name?.trim(),
    priceCedis: priceCedis === undefined ? undefined : Number(priceCedis),
    ussdShortName: ussdShortName === undefined ? undefined : (ussdShortName?.trim() || null),
    ussdPriceCedis: ussdPriceCedis === undefined
      ? undefined
      : (ussdPriceCedis == null || ussdPriceCedis === "" ? null : Number(ussdPriceCedis)),
    ussdVisible,
  });
  if (!updated) {
    throw Object.assign(new Error("Menu item not found"), { statusCode: 404 });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_ITEM_UPDATED",
    entityType: "menu_item",
    entityId: itemId,
    details: {
      category: updated.category,
      name: updated.name,
      priceCedis: updated.price_cedis,
      ussdShortName: updated.ussd_short_name || null,
      ussdPriceCedis: updated.ussd_price_cedis == null ? null : Number(updated.ussd_price_cedis),
      ussdVisible: Boolean(updated.ussd_is_visible),
    },
  });

  return {
    id: updated.id,
    category: updated.category,
    name: updated.name,
    priceCedis: updated.price_cedis,
    ussdShortName: updated.ussd_short_name || "",
    ussdPriceCedis: updated.ussd_price_cedis == null ? null : Number(updated.ussd_price_cedis),
    ussdVisible: Boolean(updated.ussd_is_visible),
    isActive: Boolean(updated.is_active),
  };
}

async function removeMenuItemForAdmin({ itemId, adminId }) {
  const removed = await deleteMenuItem(itemId);
  if (!removed) {
    throw Object.assign(new Error("Menu item not found"), { statusCode: 404 });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_ITEM_DELETED",
    entityType: "menu_item",
    entityId: itemId,
    details: {
      category: removed.category,
      name: removed.name,
      priceCedis: removed.price_cedis,
    },
  });

  return {
    id: removed.id,
    category: removed.category,
    name: removed.name,
  };
}

async function createMenuCategoryForAdmin({ category, adminId }) {
  const nextCategory = category.trim();
  const rows = await listMenuCategories();
  const exists = rows.some((row) => row.category.toLowerCase() === nextCategory.toLowerCase());
  if (exists) {
    throw Object.assign(new Error("Category already exists"), { statusCode: 409 });
  }
  await createMenuCategory(nextCategory);

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_CATEGORY_CREATED",
    entityType: "menu_category",
    entityId: nextCategory,
    details: null,
  });

  return { category: nextCategory };
}

async function renameMenuCategoryForAdmin({ fromCategory, toCategory, adminId }) {
  if (fromCategory.trim().toLowerCase() === toCategory.trim().toLowerCase()) {
    throw Object.assign(new Error("Source and target category must be different"), { statusCode: 400 });
  }
  const rows = await listMenuCategories();
  const hasFrom = rows.some((row) => row.category === fromCategory.trim());
  if (!hasFrom) {
    throw Object.assign(new Error("Category not found"), { statusCode: 404 });
  }

  const changed = await renameMenuCategory({
    fromCategory: fromCategory.trim(),
    toCategory: toCategory.trim(),
  });

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_CATEGORY_RENAMED",
    entityType: "menu_category",
    entityId: fromCategory,
    details: { fromCategory, toCategory, changed },
  });

  return { fromCategory, toCategory, changed };
}

async function removeMenuCategoryForAdmin({ category, adminId }) {
  const rows = await listMenuCategories();
  const current = rows.find((row) => row.category === category.trim());
  if (!current) {
    throw Object.assign(new Error("Category not found"), { statusCode: 404 });
  }
  const removed = await deleteMenuCategory(category.trim());

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_CATEGORY_DELETED",
    entityType: "menu_category",
    entityId: category,
    details: { removedItems: removed },
  });

  return { category, removedItems: removed };
}

async function optimizeMenuUssdNamesForAdmin({ adminId }) {
  const rows = await listAllMenuItemsForAdmin();

  let skippedCustomCount = 0;
  let skippedShortCount = 0;
  const candidates = [];

  for (const row of rows) {
    const name = normalizeMenuLabel(row.name);
    const currentShortName = normalizeMenuLabel(row.ussd_short_name || "");
    const isLong = name.length > USSD_SHORT_TARGET_LENGTH || currentShortName.length > USSD_SHORT_TARGET_LENGTH;

    if (!isLong) {
      skippedShortCount += 1;
      continue;
    }

    if (isCustomCompactName({ currentShortName, fullName: name })) {
      skippedCustomCount += 1;
      continue;
    }

    const proposed = buildOptimizedUssdShortName({
      name,
      category: row.category,
    });

    if (!proposed || proposed.toLowerCase() === currentShortName.toLowerCase()) {
      skippedShortCount += 1;
      continue;
    }

    candidates.push({
      id: row.id,
      category: row.category,
      name,
      from: currentShortName,
      to: proposed,
    });
  }

  const categoryNameCounts = new Map();
  const finalizedUpdates = candidates.map((candidate) => {
    const categoryKey = String(candidate.category || "").toLowerCase();
    const baseKey = `${categoryKey}::${candidate.to.toLowerCase()}`;
    const nextIndex = (categoryNameCounts.get(baseKey) || 0) + 1;
    categoryNameCounts.set(baseKey, nextIndex);
    const finalName = applyCollisionSuffix(candidate.to, nextIndex);
    return {
      ...candidate,
      to: finalName,
    };
  });

  const changed = [];
  for (const update of finalizedUpdates) {
    if (!update.to || update.to.toLowerCase() === update.from.toLowerCase()) continue;
    await updateMenuItem({
      itemId: update.id,
      ussdShortName: update.to,
    });
    changed.push({
      itemId: update.id,
      category: update.category,
      name: update.name,
      from: update.from || null,
      to: update.to,
    });
  }

  await logSensitiveAction({
    actorType: "admin",
    actorId: adminId,
    action: "MENU_USSD_BULK_OPTIMIZED",
    entityType: "menu_item",
    entityId: "bulk",
    details: {
      scannedCount: rows.length,
      updatedCount: changed.length,
      skippedCustomCount,
      skippedShortCount,
      threshold: USSD_SHORT_TARGET_LENGTH,
      sample: changed.slice(0, 20),
    },
  });

  return {
    scannedCount: rows.length,
    updatedCount: changed.length,
    skippedCustomCount,
    skippedShortCount,
    threshold: USSD_SHORT_TARGET_LENGTH,
    updates: changed.slice(0, 30),
  };
}

module.exports = {
  getMenu,
  getMenuGroupedByCategory,
  getMenuForAdmin,
  updateMenuAvailability,
  getMenuCategoriesForAdmin,
  createMenuItemForAdmin,
  editMenuItemForAdmin,
  removeMenuItemForAdmin,
  createMenuCategoryForAdmin,
  renameMenuCategoryForAdmin,
  removeMenuCategoryForAdmin,
  optimizeMenuUssdNamesForAdmin,
};
