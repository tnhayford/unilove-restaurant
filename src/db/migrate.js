const env = require("../config/env");
const { getDb } = require("./connection");
const bcrypt = require("bcryptjs");

async function getTableColumns(db, tableName) {
  return db.all(`PRAGMA table_info(${tableName});`);
}

async function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = await getTableColumns(db, tableName);
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    await db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`,
    );
  }
}

function parseOrderNumberSequence(orderNumber) {
  if (!orderNumber || typeof orderNumber !== "string") return 0;
  const parsed = Number(orderNumber.slice(1));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOrderNumber(sequence) {
  return `R${String(sequence).padStart(5, "0")}`;
}

async function backfillOrderNumbers(db) {
  const lastExisting = await db.get(
    `SELECT order_number
     FROM orders
     WHERE order_number LIKE 'R%'
     ORDER BY CAST(SUBSTR(order_number, 2) AS INTEGER) DESC
     LIMIT 1`,
  );

  let sequence = parseOrderNumberSequence(lastExisting?.order_number);
  const missing = await db.all(
    `SELECT id
     FROM orders
     WHERE order_number IS NULL OR TRIM(order_number) = ''
     ORDER BY datetime(created_at) ASC, id ASC`,
  );

  for (const row of missing) {
    sequence += 1;
    await db.run(
      `UPDATE orders
       SET order_number = ?
       WHERE id = ?`,
      [toOrderNumber(sequence), row.id],
    );
  }
}

async function runMigrations() {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      price_cedis REAL NOT NULL,
      ussd_short_name TEXT,
      ussd_price_cedis REAL,
      ussd_is_visible INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_categories (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      full_name TEXT NOT NULL,
      delivery_type TEXT NOT NULL CHECK(delivery_type IN ('pickup', 'delivery')),
      address TEXT,
      status TEXT NOT NULL,
      subtotal_cedis REAL NOT NULL,
      loyalty_points_issued INTEGER NOT NULL DEFAULT 0,
      hubtel_session_id TEXT,
      client_reference TEXT NOT NULL UNIQUE,
      order_number TEXT,
      source TEXT NOT NULL DEFAULT 'online',
      payment_method TEXT NOT NULL DEFAULT 'momo',
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      ops_monitored_at TEXT,
      payment_confirmed_at TEXT,
      assigned_rider_id TEXT,
      returned_rider_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_name_snapshot TEXT NOT NULL,
      unit_price_cedis REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total_cedis REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(item_id) REFERENCES menu_items(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      client_reference TEXT NOT NULL,
      hubtel_transaction_id TEXT,
      external_transaction_id TEXT,
      response_code TEXT,
      status TEXT NOT NULL,
      amount REAL,
      charges REAL,
      amount_after_charges REAL,
      amount_charged REAL,
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_prompt_attempts (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      client_reference TEXT NOT NULL,
      payment_channel TEXT,
      hubtel_transaction_id TEXT,
      external_transaction_id TEXT,
      response_code TEXT,
      attempt_status TEXT NOT NULL DEFAULT 'PENDING',
      source TEXT NOT NULL DEFAULT 'prompt',
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS delivery_verifications (
      order_id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loyalty_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      to_phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT,
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS error_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL DEFAULT 'ERROR',
      message TEXT NOT NULL,
      stack TEXT,
      route TEXT,
      method TEXT,
      status_code INTEGER,
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ussd_sessions (
      session_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      state TEXT NOT NULL,
      state_data TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      full_name TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL CHECK(status IN ('open', 'investigating', 'resolved')),
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      order_id TEXT,
      owner_user_id TEXT,
      started_at TEXT,
      resolved_at TEXT,
      details TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(owner_user_id) REFERENCES admin_users(id),
      FOREIGN KEY(created_by) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      customer_phone TEXT NOT NULL,
      dispute_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open', 'review', 'resolved', 'rejected')),
      amount_cedis REAL,
      notes TEXT NOT NULL,
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(resolved_by) REFERENCES admin_users(id),
      FOREIGN KEY(created_by) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, action_key),
      FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS report_jobs (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      report_format TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT,
      file_name TEXT,
      file_path TEXT,
      filters_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY(requested_by) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS report_schedules (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      report_format TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly')),
      day_of_week INTEGER,
      hour_utc INTEGER NOT NULL DEFAULT 2,
      minute_utc INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      filters_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES admin_users(id)
    );

    CREATE TABLE IF NOT EXISTS sla_alert_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      target_minutes INTEGER NOT NULL,
      first_alert_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_alert_at TEXT NOT NULL DEFAULT (datetime('now')),
      escalation_level INTEGER NOT NULL DEFAULT 1,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS riders (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      phone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      onboarding_status TEXT NOT NULL DEFAULT 'onboarded',
      notes TEXT,
      created_by_admin_id TEXT,
      offboarded_at TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rider_devices (
      id TEXT PRIMARY KEY,
      rider_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL UNIQUE,
      device_id TEXT,
      platform TEXT NOT NULL DEFAULT 'android',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(rider_id) REFERENCES riders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guest_rider_devices (
      id TEXT PRIMARY KEY,
      rider_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL UNIQUE,
      device_id TEXT,
      platform TEXT NOT NULL DEFAULT 'android',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rider_presence (
      rider_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('staff', 'guest')),
      display_name TEXT NOT NULL,
      shift_status TEXT NOT NULL DEFAULT 'online' CHECK(shift_status IN ('online', 'offline')),
      last_login_at TEXT,
      last_seen_at TEXT,
      last_shift_on_at TEXT,
      last_shift_off_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rider_referral_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      rider_id TEXT,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_by_admin_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rider_login_otps (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      rider_mode TEXT NOT NULL CHECK(rider_mode IN ('staff', 'guest')),
      rider_id TEXT,
      referral_code TEXT,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_schedules (
      task_name TEXT PRIMARY KEY,
      interval_ms INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT,
      next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      payload_json TEXT,
      result_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      queued_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS distributed_locks (
      lock_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lease_until TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_payments_client_reference ON payments(client_reference);
    CREATE INDEX IF NOT EXISTS idx_prompt_attempts_order ON payment_prompt_attempts(order_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_attempts_reference ON payment_prompt_attempts(client_reference);
    CREATE INDEX IF NOT EXISTS idx_prompt_attempts_hubtel_txn ON payment_prompt_attempts(hubtel_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_attempts_external_txn ON payment_prompt_attempts(external_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_attempts_status ON payment_prompt_attempts(attempt_status);
    CREATE INDEX IF NOT EXISTS idx_loyalty_created_at ON loyalty_ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_error_logs_level ON error_logs(level);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
    CREATE INDEX IF NOT EXISTS idx_disputes_phone ON disputes(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON report_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run ON report_schedules(next_run_at);
    CREATE INDEX IF NOT EXISTS idx_sla_alert_order ON sla_alert_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_rider_devices_rider ON rider_devices(rider_id);
    CREATE INDEX IF NOT EXISTS idx_rider_devices_active ON rider_devices(is_active);
    CREATE INDEX IF NOT EXISTS idx_guest_rider_devices_rider ON guest_rider_devices(rider_id);
    CREATE INDEX IF NOT EXISTS idx_guest_rider_devices_active ON guest_rider_devices(is_active);
    CREATE INDEX IF NOT EXISTS idx_rider_presence_mode_status ON rider_presence(mode, shift_status);
    CREATE INDEX IF NOT EXISTS idx_rider_presence_last_seen ON rider_presence(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_rider_referral_codes_active ON rider_referral_codes(is_active, code);
    CREATE INDEX IF NOT EXISTS idx_rider_login_otps_phone_mode ON rider_login_otps(phone, rider_mode, created_at);
    CREATE INDEX IF NOT EXISTS idx_rider_login_otps_expires ON rider_login_otps(expires_at);
    CREATE INDEX IF NOT EXISTS idx_rider_login_otps_consumed ON rider_login_otps(consumed_at);
    CREATE INDEX IF NOT EXISTS idx_job_schedules_due ON job_schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_job_runs_status_queued ON job_runs(status, queued_at);
    CREATE INDEX IF NOT EXISTS idx_job_runs_task_status ON job_runs(task_name, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_runs_task_pending_unique
      ON job_runs(task_name)
      WHERE status IN ('queued', 'running');
    CREATE INDEX IF NOT EXISTS idx_distributed_locks_lease ON distributed_locks(lease_until);
  `);

  await ensureColumn(db, "orders", "order_number", "TEXT");
  await ensureColumn(db, "orders", "source", "TEXT NOT NULL DEFAULT 'online'");
  await ensureColumn(db, "orders", "payment_method", "TEXT NOT NULL DEFAULT 'momo'");
  await ensureColumn(db, "orders", "payment_status", "TEXT NOT NULL DEFAULT 'PENDING'");
  await ensureColumn(db, "orders", "ops_monitored_at", "TEXT");
  await ensureColumn(db, "orders", "assigned_rider_id", "TEXT");
  await ensureColumn(db, "orders", "cancel_reason", "TEXT");
  await ensureColumn(db, "admin_users", "full_name", "TEXT");
  await ensureColumn(db, "admin_users", "role", "TEXT NOT NULL DEFAULT 'staff'");
  await ensureColumn(db, "riders", "phone", "TEXT");
  await ensureColumn(db, "riders", "onboarding_status", "TEXT NOT NULL DEFAULT 'onboarded'");
  await ensureColumn(db, "riders", "notes", "TEXT");
  await ensureColumn(db, "riders", "created_by_admin_id", "TEXT");
  await ensureColumn(db, "riders", "offboarded_at", "TEXT");
  await ensureColumn(db, "rider_referral_codes", "rider_id", "TEXT");
  await ensureColumn(db, "menu_items", "ussd_short_name", "TEXT");
  await ensureColumn(db, "menu_items", "ussd_price_cedis", "REAL");
  await ensureColumn(db, "menu_items", "ussd_is_visible", "INTEGER NOT NULL DEFAULT 1");
  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_orders_assigned_rider_status ON orders(assigned_rider_id, status);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_guest_rider_devices_rider ON guest_rider_devices(rider_id);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_guest_rider_devices_active ON guest_rider_devices(is_active);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_presence_mode_status ON rider_presence(mode, shift_status);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_presence_last_seen ON rider_presence(last_seen_at);",
  );
  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_riders_phone_unique ON riders(phone) WHERE phone IS NOT NULL AND TRIM(phone) <> '';",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_referral_codes_active ON rider_referral_codes(is_active, code);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_referral_codes_rider ON rider_referral_codes(rider_id);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_login_otps_phone_mode ON rider_login_otps(phone, rider_mode, created_at);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_login_otps_expires ON rider_login_otps(expires_at);",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rider_login_otps_consumed ON rider_login_otps(consumed_at);",
  );

  await db.run(
    `UPDATE orders
     SET source = 'online'
     WHERE source IS NULL OR TRIM(source) = ''`,
  );

  await db.run(
    `UPDATE orders
     SET payment_method = CASE
       WHEN source = 'instore' THEN 'cash'
       ELSE 'momo'
     END
     WHERE payment_method IS NULL OR TRIM(payment_method) = ''`,
  );

  await db.run(
    `UPDATE orders
     SET payment_status = CASE
       WHEN LOWER(TRIM(payment_method)) = 'cash_on_delivery' THEN
         CASE
           WHEN payment_confirmed_at IS NOT NULL THEN 'PAID'
           WHEN status IN ('DELIVERED', 'REFUNDED') THEN 'PAID'
           ELSE 'PENDING'
         END
       WHEN LOWER(TRIM(payment_method)) = 'cash' THEN 'PAID'
       WHEN status = 'PAYMENT_FAILED' THEN 'FAILED'
       WHEN payment_confirmed_at IS NOT NULL THEN 'PAID'
       WHEN LOWER(TRIM(payment_method)) = 'momo'
         AND status IN ('PAID', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'REFUNDED')
         THEN 'PAID'
       ELSE 'PENDING'
     END
     WHERE payment_status IS NULL
       OR TRIM(payment_status) = ''
       OR UPPER(TRIM(payment_status)) NOT IN ('PENDING', 'PAID', 'FAILED')`,
  );

  await db.run(
    `INSERT OR IGNORE INTO menu_categories (name)
     SELECT DISTINCT category
     FROM menu_items
     WHERE category IS NOT NULL AND TRIM(category) <> ''`,
  );

  await db.run(
    `UPDATE menu_items
     SET category = 'Assorted Rice'
     WHERE category = 'Rice'
       AND (name LIKE 'Assorted Jollof%' OR name LIKE 'Assorted Fried Rice%')`,
  );

  await db.run(
    `UPDATE menu_items
     SET category = 'Jollof Rice'
     WHERE category = 'Rice'
       AND name LIKE 'Jollof%'`,
  );

  await db.run(
    `UPDATE menu_items
     SET category = 'Fried Rice'
     WHERE category = 'Rice'
       AND name LIKE 'Fried Rice%'`,
  );

  await db.run(
    `UPDATE menu_items
     SET category = 'Plain Rice'
     WHERE category = 'Rice'
       AND name LIKE 'Plain Rice%'`,
  );

  await db.run(
    `INSERT OR IGNORE INTO menu_categories (name)
     SELECT DISTINCT category
     FROM menu_items
     WHERE category IS NOT NULL AND TRIM(category) <> ''`,
  );

  await db.run("DELETE FROM menu_categories WHERE name = 'Rice'");

  await db.run(
    `UPDATE admin_users
     SET role = 'admin'
     WHERE role IS NULL OR TRIM(role) = ''`,
  );

  await db.run(
    `UPDATE admin_users
     SET role = 'admin'
     WHERE email = ?`,
    [env.adminDefaultEmail.toLowerCase().trim()],
  );

  await db.run(
    `UPDATE admin_users
     SET full_name = CASE
       WHEN full_name IS NULL OR TRIM(full_name) = ''
         THEN UPPER(SUBSTR(email, 1, 1)) || SUBSTR(REPLACE(REPLACE(REPLACE(SUBSTR(email, 2, INSTR(email, '@') - 2), '.', ' '), '_', ' '), '-', ' '), 1)
       ELSE full_name
     END`,
  );

  await db.run(
    `UPDATE riders
     SET onboarding_status = CASE
       WHEN is_active = 1 THEN 'onboarded'
       ELSE 'offboarded'
     END
     WHERE onboarding_status IS NULL
       OR TRIM(onboarding_status) = ''`,
  );

  await backfillOrderNumbers(db);

  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('store_open', 'true')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('store_closure_message', 'Unilove Foods is currently closed for new orders. Please try again later.')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sla_pending_payment_min', '10')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sla_kitchen_min', '25')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sla_delivery_min', '45')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('rider_guest_commission_percent', '8')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('rider_guest_login_policy', ?)`,
    [
      String(process.env.RIDER_GUEST_LOGIN_POLICY || "invite_only")
        .trim()
        .toLowerCase() || "invite_only",
    ],
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('rider_guest_access_code', ?)`,
    [String(process.env.RIDER_GUEST_ACCESS_CODE || "").trim()],
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sms_order_tracking_enabled', 'true')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sms_order_completion_enabled', 'true')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('sms_delivery_otp_enabled', 'true')`,
  );
  await db.run(
    `INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
     VALUES ('report_retention_days', '30')`,
  );

  if (env.riderDefaultId && env.riderDefaultPin) {
    const existingRider = await db.get(
      "SELECT id FROM riders WHERE id = ?",
      [env.riderDefaultId],
    );
    if (!existingRider) {
      const pinHash = await bcrypt.hash(env.riderDefaultPin, 10);
      await db.run(
        `INSERT INTO riders (id, full_name, pin_hash, is_active)
         VALUES (?, ?, ?, 1)`,
        [env.riderDefaultId, env.riderDefaultName || env.riderDefaultId, pinHash],
      );
    }
  }

  await db.run(
    `INSERT INTO rider_presence (
      rider_id,
      mode,
      display_name,
      shift_status,
      last_login_at,
      last_seen_at,
      last_shift_on_at,
      created_at,
      updated_at
    )
    SELECT
      r.id,
      'staff',
      COALESCE(NULLIF(TRIM(r.full_name), ''), r.id),
      CASE
        WHEN r.last_login_at IS NOT NULL AND TRIM(r.last_login_at) <> '' THEN 'online'
        ELSE 'offline'
      END,
      r.last_login_at,
      r.last_login_at,
      r.last_login_at,
      r.created_at,
      r.updated_at
    FROM riders r
    WHERE NOT EXISTS (
      SELECT 1
      FROM rider_presence p
      WHERE p.rider_id = r.id
    )`,
  );
}

module.exports = { runMigrations };
