const { getDb } = require("../db/connection");

async function listActiveMenuItems() {
  const db = await getDb();
  return db.all(
    `SELECT id, category, name, price_cedis
     FROM menu_items
     WHERE is_active = 1
     ORDER BY category, name`,
  );
}

async function findMenuItemsByIds(ids) {
  if (!ids.length) return [];
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  return db.all(
    `SELECT id, category, name, price_cedis
     FROM menu_items
     WHERE is_active = 1 AND id IN (${placeholders})`,
    ids,
  );
}

async function listMenuByCategory() {
  const db = await getDb();
  return db.all(
    `SELECT category, id, name, price_cedis, ussd_short_name, ussd_price_cedis, ussd_is_visible
     FROM menu_items
     WHERE is_active = 1
       AND COALESCE(ussd_is_visible, 1) = 1
     ORDER BY category, name`,
  );
}

async function listAllMenuItemsForAdmin() {
  const db = await getDb();
  return db.all(
    `SELECT id, category, name, price_cedis, ussd_short_name, ussd_price_cedis, ussd_is_visible, is_active
     FROM menu_items
     ORDER BY category, name`,
  );
}

async function setMenuItemAvailability(itemId, isActive) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE menu_items
     SET is_active = ?
     WHERE id = ?`,
    [isActive ? 1 : 0, itemId],
  );
  return result.changes > 0;
}

async function findMenuItemById(itemId) {
  const db = await getDb();
  return db.get(
    `SELECT id, category, name, price_cedis, ussd_short_name, ussd_price_cedis, ussd_is_visible, is_active
     FROM menu_items
     WHERE id = ?`,
    [itemId],
  );
}

async function createMenuItem({
  id,
  category,
  name,
  priceCedis,
  ussdShortName = null,
  ussdPriceCedis = null,
  ussdVisible = true,
  isActive = true,
}) {
  const db = await getDb();
  await db.run("INSERT OR IGNORE INTO menu_categories (name) VALUES (?)", [category]);
  await db.run(
    `INSERT INTO menu_items (id, category, name, price_cedis, ussd_short_name, ussd_price_cedis, ussd_is_visible, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, category, name, priceCedis, ussdShortName, ussdPriceCedis, ussdVisible ? 1 : 0, isActive ? 1 : 0],
  );
  return findMenuItemById(id);
}

async function updateMenuItem({
  itemId,
  category,
  name,
  priceCedis,
  ussdShortName,
  ussdPriceCedis,
  ussdVisible,
}) {
  const db = await getDb();
  const existing = await findMenuItemById(itemId);
  if (!existing) return null;

  const nextCategory = category ?? existing.category;
  const nextName = name ?? existing.name;
  const nextPrice = priceCedis ?? existing.price_cedis;
  const nextUssdShortName = ussdShortName === undefined ? existing.ussd_short_name : ussdShortName;
  const nextUssdPrice = ussdPriceCedis === undefined ? existing.ussd_price_cedis : ussdPriceCedis;
  const nextUssdVisible = ussdVisible === undefined ? existing.ussd_is_visible : (ussdVisible ? 1 : 0);
  await db.run("INSERT OR IGNORE INTO menu_categories (name) VALUES (?)", [nextCategory]);

  await db.run(
    `UPDATE menu_items
     SET category = ?, name = ?, price_cedis = ?, ussd_short_name = ?, ussd_price_cedis = ?, ussd_is_visible = ?
     WHERE id = ?`,
    [nextCategory, nextName, nextPrice, nextUssdShortName, nextUssdPrice, nextUssdVisible, itemId],
  );
  return findMenuItemById(itemId);
}

async function deleteMenuItem(itemId) {
  const db = await getDb();
  const existing = await findMenuItemById(itemId);
  if (!existing) return null;
  await db.run("DELETE FROM menu_items WHERE id = ?", [itemId]);
  return existing;
}

async function listMenuCategories() {
  const db = await getDb();
  const rows = await db.all(
    `SELECT c.name AS category, COALESCE(i.item_count, 0) AS item_count
     FROM menu_categories c
     LEFT JOIN (
       SELECT category, COUNT(*) AS item_count
       FROM menu_items
       GROUP BY category
     ) i ON i.category = c.name
     ORDER BY c.name`,
  );
  return rows;
}

async function createMenuCategory(category) {
  const db = await getDb();
  const result = await db.run("INSERT OR IGNORE INTO menu_categories (name) VALUES (?)", [category]);
  return result.changes > 0;
}

async function renameMenuCategory({ fromCategory, toCategory }) {
  const db = await getDb();
  await db.run("INSERT OR IGNORE INTO menu_categories (name) VALUES (?)", [toCategory]);
  const result = await db.run(
    `UPDATE menu_items
     SET category = ?
     WHERE category = ?`,
    [toCategory, fromCategory],
  );
  await db.run("DELETE FROM menu_categories WHERE name = ?", [fromCategory]);
  return result.changes || 0;
}

async function deleteMenuCategory(category) {
  const db = await getDb();
  const result = await db.run("DELETE FROM menu_items WHERE category = ?", [category]);
  await db.run("DELETE FROM menu_categories WHERE name = ?", [category]);
  return result.changes || 0;
}

module.exports = {
  listActiveMenuItems,
  findMenuItemsByIds,
  listMenuByCategory,
  listAllMenuItemsForAdmin,
  setMenuItemAvailability,
  findMenuItemById,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  listMenuCategories,
  createMenuCategory,
  renameMenuCategory,
  deleteMenuCategory,
};
