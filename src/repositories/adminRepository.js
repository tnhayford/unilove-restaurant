const { getDb } = require("../db/connection");

async function findAdminByEmail(email) {
  const db = await getDb();
  return db.get("SELECT * FROM admin_users WHERE email = ?", [email]);
}

async function listStaffUsers() {
  const db = await getDb();
  return db.all(
    `SELECT id, full_name, email, role, created_at
     FROM admin_users
     ORDER BY role DESC, datetime(created_at) DESC`,
  );
}

async function findAdminById(id) {
  const db = await getDb();
  return db.get("SELECT * FROM admin_users WHERE id = ?", [id]);
}

async function createAdminUser({ id, fullName, email, passwordHash, role }) {
  const db = await getDb();
  await db.run(
    `INSERT INTO admin_users (id, full_name, email, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`,
    [id, fullName || null, email, passwordHash, role],
  );
  return findAdminById(id);
}

async function updateAdminUserProfile({ id, fullName, role }) {
  const db = await getDb();
  await db.run(
    `UPDATE admin_users
     SET full_name = ?, role = ?
     WHERE id = ?`,
    [fullName || null, role, id],
  );
  return findAdminById(id);
}

async function updateAdminUserRole({ id, role }) {
  const db = await getDb();
  await db.run("UPDATE admin_users SET role = ? WHERE id = ?", [role, id]);
  return findAdminById(id);
}

async function updateAdminUserPassword({ id, passwordHash }) {
  const db = await getDb();
  await db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
}

async function deleteAdminUser(id) {
  const db = await getDb();
  return db.run("DELETE FROM admin_users WHERE id = ?", [id]);
}

module.exports = {
  findAdminByEmail,
  listStaffUsers,
  findAdminById,
  createAdminUser,
  updateAdminUserProfile,
  updateAdminUserRole,
  updateAdminUserPassword,
  deleteAdminUser,
};
