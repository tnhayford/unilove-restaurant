#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "live-demo");
const APP_LOG_PATH = path.join(OUTPUT_DIR, "ussd-app.log");
const TEST_LOG_PATH = path.join(OUTPUT_DIR, "ussd-test.log");

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function writeFile(filePath, contents) {
  fs.writeFileSync(filePath, contents, "utf8");
}

function appendBlock(lines, line) {
  lines.push(line);
}

function formatTimestamp() {
  return new Date().toISOString();
}

function buildRequest({
  type,
  mobile,
  sessionId,
  serviceCode,
  message,
  operator,
  sequence,
  clientState,
  platform,
}) {
  return {
    Type: type,
    Mobile: mobile,
    SessionId: sessionId,
    ServiceCode: serviceCode,
    Message: message,
    Operator: operator,
    Sequence: sequence,
    ClientState: clientState,
    Platform: platform,
  };
}

async function bootstrap() {
  const dbPath = `/tmp/unilove-ussd-log-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = dbPath;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "demo-jwt-secret";
  process.env.HUBTEL_CALLBACK_SECRET = process.env.HUBTEL_CALLBACK_SECRET || "demo-callback-secret";
  process.env.COOKIE_SECURE = "false";

  const { runMigrations } = require(path.join(ROOT, "src/db/migrate.js"));
  const { createMenuItem } = require(path.join(ROOT, "src/repositories/menuRepository.js"));
  const { handleUssdRequest } = require(path.join(ROOT, "src/services/ussdService.js"));

  await runMigrations();

  await createMenuItem({
    id: "demo-rice-1",
    category: "Rice",
    name: "Special Fried Rice",
    priceCedis: 28,
    ussdShortName: "Fried Rice",
    ussdPriceCedis: 25,
    ussdVisible: true,
    isActive: true,
  });

  await createMenuItem({
    id: "demo-rice-2",
    category: "Rice",
    name: "Special Jollof Rice",
    priceCedis: 30,
    ussdShortName: "Jollof Rice",
    ussdPriceCedis: 27,
    ussdVisible: true,
    isActive: true,
  });

  return { handleUssdRequest };
}

async function main() {
  ensureOutputDir();
  const { handleUssdRequest } = await bootstrap();

  const mobile = "233200000000";
  const sessionId = crypto.randomUUID();
  const serviceCode = "*713*8575#";
  const operator = "mtn";
  const platform = "USSD";

  const appLogLines = [];
  const testLogLines = [];
  appendBlock(testLogLines, `==== Starting USSD Test: ${new Date().toUTCString()} ====`);

  let sequence = 1;
  let clientState = "";

  const steps = [
    {
      name: "Session Initiated",
      type: "Initiation",
      message: serviceCode,
    },
    {
      name: "Opened Categories",
      type: "Response",
      message: "1",
    },
    {
      name: "Viewed Rice Options",
      type: "Response",
      message: "1",
    },
    {
      name: "Selected Item",
      type: "Response",
      message: "1",
    },
    {
      name: "Added Quantity",
      type: "Response",
      message: "2",
    },
    {
      name: "Started Checkout",
      type: "Response",
      message: "8",
    },
    {
      name: "Entered Name",
      type: "Response",
      message: "Jane Doe",
    },
    {
      name: "Selected Pickup",
      type: "Response",
      message: "1",
    },
    {
      name: "Payment Handover",
      type: "Response",
      message: "1",
    },
  ];

  for (const step of steps) {
    const requestPayload = buildRequest({
      type: step.type,
      mobile,
      sessionId,
      serviceCode,
      message: step.message,
      operator,
      sequence,
      clientState,
      platform,
    });

    appendBlock(
      appLogLines,
      `[${formatTimestamp()}] [USSD_REQUEST] ${JSON.stringify(requestPayload, null, 2)}`,
    );

    const responsePayload = await handleUssdRequest(requestPayload);
    appendBlock(
      appLogLines,
      `[${formatTimestamp()}] [USSD_RESPONSE] ${JSON.stringify(responsePayload, null, 2)}`,
    );

    appendBlock(testLogLines, JSON.stringify(responsePayload));
    appendBlock(testLogLines, `==== ${step.name} ====`);

    clientState = responsePayload?.ClientState || "";
    sequence += 1;
  }

  writeFile(APP_LOG_PATH, `${appLogLines.join("\n")}\n`);
  writeFile(TEST_LOG_PATH, `${testLogLines.join("\n")}\n`);

  process.stdout.write(`Generated:\n- ${APP_LOG_PATH}\n- ${TEST_LOG_PATH}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
