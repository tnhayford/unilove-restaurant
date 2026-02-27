const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

function timestampToken() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const args = [...argv];
  const outputFlagIndex = args.findIndex((item) => item === "--out");
  if (outputFlagIndex >= 0 && args[outputFlagIndex + 1]) {
    return {
      outDir: args[outputFlagIndex + 1],
    };
  }
  return {
    outDir: "",
  };
}

function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

function mapSqliteTypeToPostgres(typeName) {
  const normalized = String(typeName || "").trim().toUpperCase();
  if (!normalized) return "TEXT";
  if (normalized.includes("INT")) return "BIGINT";
  if (normalized.includes("REAL") || normalized.includes("FLOA") || normalized.includes("DOUB")) {
    return "DOUBLE PRECISION";
  }
  if (normalized.includes("BLOB")) return "BYTEA";
  if (normalized.includes("NUMERIC") || normalized.includes("DECIMAL")) return "NUMERIC";
  if (normalized.includes("BOOL")) return "BOOLEAN";
  if (normalized.includes("DATE") || normalized.includes("TIME")) return "TIMESTAMPTZ";
  return "TEXT";
}

function mapDefaultValue(rawDefault) {
  if (rawDefault === null || rawDefault === undefined) return "";
  const value = String(rawDefault).trim();
  if (!value) return "";
  if (/^datetime\('now'\)$/i.test(value) || /^CURRENT_TIMESTAMP$/i.test(value)) {
    return " DEFAULT CURRENT_TIMESTAMP";
  }
  if (/^NULL$/i.test(value)) {
    return " DEFAULT NULL";
  }
  return ` DEFAULT ${value}`;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  const raw = String(value);
  if (!/[",\n\r]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function toCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map((header) => escapeCsvCell(header)).join(","));
  for (const row of rows) {
    const line = headers.map((header) => escapeCsvCell(row[header])).join(",");
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

function dependencyOrder(tableMetaByName) {
  const remaining = new Set(Object.keys(tableMetaByName));
  const sorted = [];

  while (remaining.size) {
    const ready = [...remaining]
      .filter((tableName) => {
        const deps = new Set(
          (tableMetaByName[tableName]?.foreignKeys || [])
            .map((row) => String(row.table || "").trim())
            .filter(Boolean),
        );
        for (const dep of deps) {
          if (remaining.has(dep)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.localeCompare(b));

    if (!ready.length) {
      sorted.push(...[...remaining].sort((a, b) => a.localeCompare(b)));
      break;
    }

    for (const item of ready) {
      sorted.push(item);
      remaining.delete(item);
    }
  }

  return sorted;
}

function buildTableSql(tableName, tableMeta) {
  const columnLines = [];
  const orderedPk = (tableMeta.columns || [])
    .filter((column) => Number(column.pk || 0) > 0)
    .sort((left, right) => Number(left.pk || 0) - Number(right.pk || 0));
  const isSinglePk = orderedPk.length === 1;

  for (const column of tableMeta.columns || []) {
    const parts = [
      quoteIdentifier(column.name),
      mapSqliteTypeToPostgres(column.type),
    ];
    if (Number(column.notnull || 0) === 1) {
      parts.push("NOT NULL");
    }
    if (isSinglePk && Number(column.pk || 0) === 1) {
      parts.push("PRIMARY KEY");
    }
    const defaultClause = mapDefaultValue(column.dflt_value);
    if (defaultClause) {
      parts.push(defaultClause.trim());
    }
    columnLines.push(`  ${parts.join(" ")}`);
  }

  if (orderedPk.length > 1) {
    const pkCols = orderedPk.map((column) => quoteIdentifier(column.name)).join(", ");
    columnLines.push(`  PRIMARY KEY (${pkCols})`);
  }

  const foreignKeyGroups = new Map();
  for (const foreignKey of tableMeta.foreignKeys || []) {
    const groupId = Number(foreignKey.id || 0);
    if (!foreignKeyGroups.has(groupId)) {
      foreignKeyGroups.set(groupId, []);
    }
    foreignKeyGroups.get(groupId).push(foreignKey);
  }

  for (const group of foreignKeyGroups.values()) {
    const ordered = [...group].sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
    const fromCols = ordered.map((row) => quoteIdentifier(row.from)).join(", ");
    const toCols = ordered.map((row) => quoteIdentifier(row.to)).join(", ");
    const refTable = quoteIdentifier(ordered[0].table);
    const updateRule = String(ordered[0].on_update || "NO ACTION").toUpperCase();
    const deleteRule = String(ordered[0].on_delete || "NO ACTION").toUpperCase();
    columnLines.push(
      `  FOREIGN KEY (${fromCols}) REFERENCES ${refTable} (${toCols}) ON UPDATE ${updateRule} ON DELETE ${deleteRule}`,
    );
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (\n${columnLines.join(",\n")}\n);`;
}

function buildIndexSql(tableName, tableMeta) {
  const statements = [];
  const seenNames = new Set();

  for (const index of tableMeta.indexes || []) {
    const indexName = String(index.name || "").trim();
    if (!indexName || indexName.startsWith("sqlite_autoindex_")) continue;
    if (seenNames.has(indexName)) continue;
    seenNames.add(indexName);

    const infoCols = (index.columns || []).map((row) => quoteIdentifier(row.name)).join(", ");
    if (!infoCols) continue;

    const uniqueClause = Number(index.unique || 0) === 1 ? "UNIQUE " : "";
    let whereClause = "";
    if (index.partialSql) {
      const match = String(index.partialSql).match(/\bWHERE\b([\s\S]*)$/i);
      if (match && match[1]) {
        whereClause = ` WHERE ${match[1].trim().replace(/;$/, "")}`;
      }
    }

    statements.push(
      `CREATE ${uniqueClause}INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${infoCols})${whereClause};`,
    );
  }

  return statements;
}

async function readTableMeta(db, tableName) {
  const columns = await db.all(`PRAGMA table_info(${quoteIdentifier(tableName)});`);
  const foreignKeys = await db.all(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)});`);
  const indexList = await db.all(`PRAGMA index_list(${quoteIdentifier(tableName)});`);

  const indexes = [];
  for (const indexRow of indexList) {
    const indexName = String(indexRow.name || "").trim();
    if (!indexName) continue;
    const indexColumns = await db.all(`PRAGMA index_info(${quoteIdentifier(indexName)});`);
    const indexSqlRow = await db.get(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
      [indexName],
    );
    indexes.push({
      ...indexRow,
      columns: indexColumns || [],
      partialSql: indexSqlRow?.sql || "",
    });
  }

  return {
    columns: columns || [],
    foreignKeys: foreignKeys || [],
    indexes,
  };
}

async function exportTableData(db, tableName, targetPath) {
  const rows = await db.all(`SELECT * FROM ${quoteIdentifier(tableName)};`);
  const headers = rows.length
    ? Object.keys(rows[0])
    : (await db.all(`PRAGMA table_info(${quoteIdentifier(tableName)});`)).map((col) => col.name);

  const csv = toCsv(headers, rows);
  fs.writeFileSync(targetPath, csv, "utf8");
  return {
    rowCount: rows.length,
    headers,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH || "./data/app.db");
  const defaultOut = path.resolve(
    process.cwd(),
    "data",
    "postgres-migration",
    timestampToken(),
  );
  const bundleRoot = path.resolve(args.outDir || defaultOut);
  const dataDir = path.join(bundleRoot, "data");

  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const db = await open({
    filename: databasePath,
    driver: sqlite3.Database,
  });

  const tableRows = await db.all(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name ASC`,
  );

  const tableNames = tableRows.map((row) => row.name);
  if (!tableNames.length) {
    throw new Error("No application tables found in SQLite database");
  }

  const tableMetaByName = {};
  for (const tableName of tableNames) {
    tableMetaByName[tableName] = await readTableMeta(db, tableName);
  }

  const loadOrder = dependencyOrder(tableMetaByName);
  const exportSummary = [];

  for (const tableName of loadOrder) {
    const csvPath = path.join(dataDir, `${tableName}.csv`);
    const result = await exportTableData(db, tableName, csvPath);
    exportSummary.push({
      table: tableName,
      rowCount: result.rowCount,
      columns: result.headers,
      csvPath,
    });
  }

  const schemaLines = [];
  schemaLines.push("-- PostgreSQL schema generated from SQLite metadata");
  schemaLines.push(`-- Source database: ${databasePath}`);
  schemaLines.push(`-- Generated at: ${new Date().toISOString()}`);
  schemaLines.push("");

  for (const tableName of loadOrder) {
    schemaLines.push(buildTableSql(tableName, tableMetaByName[tableName]));
    schemaLines.push("");
  }

  schemaLines.push("-- Secondary indexes");
  for (const tableName of loadOrder) {
    const indexStatements = buildIndexSql(tableName, tableMetaByName[tableName]);
    if (indexStatements.length) {
      schemaLines.push(...indexStatements);
    }
  }
  schemaLines.push("");

  const schemaPath = path.join(bundleRoot, "schema.sql");
  fs.writeFileSync(schemaPath, `${schemaLines.join("\n")}\n`, "utf8");

  const importLines = [];
  importLines.push("-- Run with: psql \"$DATABASE_URL\" -f import.sql");
  importLines.push("\\set ON_ERROR_STOP on");
  importLines.push("");
  importLines.push("\\i schema.sql");
  importLines.push("");
  for (const tableInfo of exportSummary) {
    const colSql = tableInfo.columns.map((column) => quoteIdentifier(column)).join(", ");
    const escapedPath = tableInfo.csvPath.replace(/'/g, "''");
    importLines.push(
      `\\copy ${quoteIdentifier(tableInfo.table)} (${colSql}) FROM '${escapedPath}' WITH (FORMAT csv, HEADER true, NULL '');`,
    );
  }
  importLines.push("");

  const importPath = path.join(bundleRoot, "import.sql");
  fs.writeFileSync(importPath, `${importLines.join("\n")}\n`, "utf8");

  const verifyLines = [];
  verifyLines.push("-- Row-count validation after import");
  for (const tableInfo of exportSummary) {
    verifyLines.push(
      `SELECT '${tableInfo.table}' AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(tableInfo.table)};`,
    );
  }
  verifyLines.push("");
  fs.writeFileSync(path.join(bundleRoot, "verify_counts.sql"), `${verifyLines.join("\n")}\n`, "utf8");

  const readmeLines = [];
  readmeLines.push("# SQLite to PostgreSQL Migration Bundle");
  readmeLines.push("");
  readmeLines.push("1. Create an empty PostgreSQL database.");
  readmeLines.push("2. Run schema + data import from this directory:");
  readmeLines.push("   `psql \"$DATABASE_URL\" -f import.sql`");
  readmeLines.push("3. Validate row counts:");
  readmeLines.push("   `psql \"$DATABASE_URL\" -f verify_counts.sql`");
  readmeLines.push("");
  readmeLines.push("Notes:");
  readmeLines.push("- This bundle preserves table/column names and indexes from SQLite metadata.");
  readmeLines.push("- Review `schema.sql` before production cutover.");
  readmeLines.push("- Use a write freeze window to avoid source/target drift.");
  readmeLines.push("");
  fs.writeFileSync(path.join(bundleRoot, "README.md"), `${readmeLines.join("\n")}\n`, "utf8");

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDatabasePath: databasePath,
    bundleRoot,
    tableCount: exportSummary.length,
    tableLoadOrder: loadOrder,
    tables: exportSummary.map((row) => ({
      table: row.table,
      rowCount: row.rowCount,
      columnCount: row.columns.length,
      csvPath: row.csvPath,
    })),
  };
  fs.writeFileSync(path.join(bundleRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await db.close();
  console.log(`[pg-bundle] Created: ${bundleRoot}`);
  console.log(`[pg-bundle] Tables exported: ${exportSummary.length}`);
}

main().catch((error) => {
  console.error("[pg-bundle] Failed:", error.message);
  process.exit(1);
});
