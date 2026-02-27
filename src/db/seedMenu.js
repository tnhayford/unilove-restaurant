const { getDb } = require("./connection");

const MENU_ITEMS = [
  { category: "Shawarma", name: "Shawarma (Chicken + Vegetables + Sausage Only)", price: 35 },
  { category: "Shawarma", name: "Shawarma (Chicken + Butter + Vegetables + Sausage)", price: 40 },
  { category: "Shawarma", name: "Shawarma (Chicken + Cheese + Vegetables + Sausage)", price: 45 },
  { category: "Shawarma", name: "Shawarma (Chicken + Cheese + Baked Beans + Vegetables + Sausage)", price: 50 },
  { category: "Shawarma", name: "Shawarma (Chicken + Extra Cheese + Vegetables + Sausage)", price: 55 },
  { category: "Shawarma", name: "Shawarma (Chicken + Extra Cheese + Baked Beans + Vegetables + Sausage)", price: 60 },
  { category: "Shawarma", name: "Shawarma (Chicken + Baked Beans + French Fries + Vegetables + Sausage)", price: 65 },
  { category: "Shawarma", name: "Shawarma (Chicken + Extra Cheese + French Fries + Vegetables + Sausage)", price: 70 },
  { category: "Shawarma", name: "The Boss Shawarma (Chicken + Baked Beans + Extra Cheese + Butter + French Fries + Vegetables + Sausage + 1 Litre Coca Cola)", price: 100 },

  { category: "Chips", name: "Potato Chips & Grilled Chicken", price: 50 },
  { category: "Chips", name: "Yam Chips & Grilled Chicken", price: 50 },
  { category: "Chips", name: "Potato Chips & Fried Chicken", price: 45 },
  { category: "Chips", name: "Yam Chips & Fried Chicken", price: 45 },
  { category: "Chips", name: "Potato Chips & Chicken Wings", price: 55 },
  { category: "Chips", name: "Yam Chips & Chicken Wings", price: 55 },

  { category: "Salads", name: "Chicken Salad", price: 40 },
  { category: "Salads", name: "Tuna Salads", price: 45 },

  { category: "Others", name: "Plantain + Palava Sauce & Fish", price: 55 },
  { category: "Others", name: "Yam + Palava Sauce & Fish", price: 55 },
  { category: "Others", name: "Yam + Egg Stew & Fish", price: 50 },
  { category: "Others", name: "Plantain + Egg Stew & Fish", price: 50 },

  { category: "Jollof Rice", name: "Jollof & Fried Chicken", price: 55 },
  { category: "Jollof Rice", name: "Jollof & Chicken & Red Plantain", price: 60 },
  { category: "Jollof Rice", name: "Jollof & Grilled Chicken", price: 60 },
  { category: "Jollof Rice", name: "Jollof & Fish", price: 65 },
  { category: "Jollof Rice", name: "Jollof & Fish Sauce", price: 70 },
  { category: "Assorted Rice", name: "Assorted Jollof", price: 75 },
  { category: "Fried Rice", name: "Fried Rice & Fried Chicken", price: 50 },
  { category: "Fried Rice", name: "Fried Rice & Chicken Wings", price: 55 },
  { category: "Fried Rice", name: "Fried Rice & Beef Sauce", price: 60 },
  { category: "Fried Rice", name: "Fried Rice & Fish", price: 60 },
  { category: "Fried Rice", name: "Fried Rice & Fish Sauce", price: 65 },
  { category: "Assorted Rice", name: "Assorted Fried Rice", price: 70 },
  { category: "Fried Rice", name: "Fried Rice & Grilled Chicken", price: 55 },
  { category: "Plain Rice", name: "Plain Rice & Fried Chicken", price: 50 },
  { category: "Plain Rice", name: "Plain Rice & Grilled chicken", price: 50 },
  { category: "Plain Rice", name: "Plain Rice & Chicken Wings", price: 55 },
  { category: "Plain Rice", name: "Plain Rice & Beef Sauce", price: 60 },
];

function makeId(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seedMenu() {
  const db = await getDb();
  await db.exec("BEGIN TRANSACTION;");
  try {
    const ids = [];
    for (const item of MENU_ITEMS) {
      const id = makeId(item.name);
      ids.push(id);
      await db.run(
        `INSERT OR IGNORE INTO menu_categories (name)
         VALUES (?)`,
        [item.category],
      );
      await db.run(
        `INSERT INTO menu_items (id, category, name, price_cedis, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(id)
         DO UPDATE SET category = excluded.category,
                       name = excluded.name,
                       price_cedis = excluded.price_cedis,
                       is_active = 1`,
        [id, item.category, item.name, item.price],
      );
    }

    const placeholders = ids.map(() => "?").join(",");
    await db.run(
      `UPDATE menu_items
       SET is_active = 0
       WHERE id NOT IN (${placeholders})`,
      ids,
    );

    await db.run(
      `DELETE FROM menu_categories
       WHERE name NOT IN (SELECT DISTINCT category FROM menu_items)`,
    );

    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

module.exports = { seedMenu, MENU_ITEMS };
