const { getDb } = require("../db/connection");

async function getRiderById(riderId) {
  const db = await getDb();
  return db.get(
    `SELECT id, full_name, pin_hash, is_active, last_login_at, created_at, updated_at
     FROM riders
     WHERE id = ?`,
    [riderId],
  );
}

async function listRiders() {
  const db = await getDb();
  return db.all(
    `SELECT id, full_name, is_active, last_login_at, created_at, updated_at
     FROM riders
     ORDER BY LOWER(full_name) ASC`,
  );
}

async function createRider({ id, fullName, pinHash, isActive = true }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO riders (id, full_name, pin_hash, is_active)
     VALUES (?, ?, ?, ?)`,
    [id, fullName, pinHash, isActive ? 1 : 0],
  );
  return getRiderById(id);
}

async function updateRiderProfile({ id, fullName, isActive }) {
  const db = await getDb();
  await db.run(
    `UPDATE riders
     SET full_name = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [fullName, isActive ? 1 : 0, id],
  );
  return getRiderById(id);
}

async function updateRiderPin({ id, pinHash }) {
  const db = await getDb();
  await db.run(
    `UPDATE riders
     SET pin_hash = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [pinHash, id],
  );
  return getRiderById(id);
}

async function touchRiderLogin(riderId) {
  const db = await getDb();
  await db.run(
    `UPDATE riders
     SET last_login_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [riderId],
  );
}

module.exports = {
  getRiderById,
  listRiders,
  createRider,
  updateRiderProfile,
  updateRiderPin,
  touchRiderLogin,
};
