const bcrypt = require("bcryptjs");
const { uuidv4 } = require("../utils/uuid");
const env = require("../config/env");
const { getDb } = require("./connection");

async function seedAdmin() {
  const db = await getDb();
  const email = env.adminDefaultEmail.toLowerCase().trim();
  const password = String(env.adminDefaultPassword || "");
  if (password.length < 12) {
    throw new Error(
      "ADMIN_DEFAULT_PASSWORD must be set and at least 12 characters before seeding admin user.",
    );
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.get("SELECT id FROM admin_users WHERE email = ?", [email]);

  if (existing) {
    await db.run(
      "UPDATE admin_users SET password_hash = ?, role = 'admin', full_name = COALESCE(NULLIF(full_name, ''), ?) WHERE email = ?",
      [passwordHash, "Iderwell Admin", email],
    );
    return;
  }

  await db.run(
    "INSERT INTO admin_users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
    [uuidv4(), "Iderwell Admin", email, passwordHash, "admin"],
  );
}

module.exports = { seedAdmin };
