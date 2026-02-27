const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const env = require("../config/env");

let dbPromise;
let writeQueue = Promise.resolve();

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: env.databasePath,
      driver: sqlite3.Database,
    });
  }
  const db = await dbPromise;
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

async function runInWriteTransaction(work) {
  const previous = writeQueue;
  let release;
  writeQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  const db = await getDb();
  await db.exec("BEGIN IMMEDIATE;");
  try {
    const result = await work(db);
    await db.exec("COMMIT;");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  } finally {
    release();
  }
}

module.exports = { getDb, runInWriteTransaction };
