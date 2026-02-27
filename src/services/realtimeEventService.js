const crypto = require("crypto");
const env = require("../config/env");

const channelClients = new Map();
let clientSeq = 0;

function normalizeOrderNumber(input) {
  return String(input || "").trim().toUpperCase();
}

function createClientId() {
  clientSeq += 1;
  const randomPart = crypto.randomBytes(4).toString("hex");
  return `sse-${Date.now()}-${clientSeq}-${randomPart}`;
}

function activeClientCount() {
  let total = 0;
  for (const clients of channelClients.values()) {
    total += clients.size;
  }
  return total;
}

function serializeData(value) {
  if (value === undefined) return "{}";
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify({ error: "serialization_failed" });
  }
}

function writeEvent(res, eventName, payload) {
  const body = serializeData(payload);
  res.write(`event: ${eventName}\n`);
  body.split("\n").forEach((line) => {
    res.write(`data: ${line}\n`);
  });
  res.write("\n");
}

function removeClient(channel, clientId) {
  const clients = channelClients.get(channel);
  if (!clients) return;
  const client = clients.get(clientId);
  if (!client) return;

  clearInterval(client.heartbeatTimer);
  clients.delete(clientId);
  if (!clients.size) {
    channelClients.delete(channel);
  }
}

function openRealtimeStream({ req, res, channel }) {
  if (!env.enableRealtimeSse) {
    throw Object.assign(new Error("Realtime stream is disabled"), { statusCode: 503 });
  }

  const maxClients = Math.max(10, Number(env.realtimeSseMaxClients || 500));
  if (activeClientCount() >= maxClients) {
    throw Object.assign(new Error("Realtime stream capacity reached"), { statusCode: 503 });
  }

  const normalizedChannel = String(channel || "").trim();
  if (!normalizedChannel) {
    throw Object.assign(new Error("Realtime channel is required"), { statusCode: 500 });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const clientId = createClientId();
  const clients = channelClients.get(normalizedChannel) || new Map();
  channelClients.set(normalizedChannel, clients);

  const heartbeatMs = Math.max(5000, Number(env.realtimeSseHeartbeatMs || 25000));
  const heartbeatTimer = setInterval(() => {
    try {
      writeEvent(res, "ping", { ts: new Date().toISOString() });
    } catch (_error) {
      removeClient(normalizedChannel, clientId);
    }
  }, heartbeatMs);

  clients.set(clientId, {
    id: clientId,
    res,
    heartbeatTimer,
  });

  writeEvent(res, "connected", {
    channel: normalizedChannel,
    clientId,
    connectedAt: new Date().toISOString(),
  });

  const close = () => {
    removeClient(normalizedChannel, clientId);
  };

  req.on("close", close);
  req.on("aborted", close);

  return {
    clientId,
    close,
    send: (eventName, payload) => {
      writeEvent(res, eventName, payload);
    },
  };
}

function publishChannelEvent(channel, eventName, payload) {
  const normalizedChannel = String(channel || "").trim();
  if (!normalizedChannel) return;
  const clients = channelClients.get(normalizedChannel);
  if (!clients?.size) return;

  for (const [clientId, client] of clients.entries()) {
    try {
      writeEvent(client.res, eventName, payload);
    } catch (_error) {
      removeClient(normalizedChannel, clientId);
    }
  }
}

function publishOpsEvent(eventName, payload) {
  publishChannelEvent("ops", eventName, payload);
}

function publishOrderEvent(eventName, orderPayload = {}) {
  const payload = {
    orderId: String(orderPayload.orderId || "").trim() || null,
    orderNumber: normalizeOrderNumber(orderPayload.orderNumber),
    status: String(orderPayload.status || "").trim().toUpperCase() || null,
    deliveryType: String(orderPayload.deliveryType || "").trim().toLowerCase() || null,
    assignedRiderId: String(orderPayload.assignedRiderId || "").trim() || null,
    opsMonitoredAt: orderPayload.opsMonitoredAt || null,
    updatedAt: orderPayload.updatedAt || new Date().toISOString(),
    context: orderPayload.context || null,
  };

  publishOpsEvent(eventName, payload);
  if (payload.orderNumber) {
    publishChannelEvent(`track:${payload.orderNumber}`, "tracking.update", payload);
  }
}

module.exports = {
  openRealtimeStream,
  publishChannelEvent,
  publishOpsEvent,
  publishOrderEvent,
};
