const axios = require("axios");
const env = require("../config/env");
const { getOrderById } = require("../repositories/orderRepository");
const { logSensitiveAction } = require("./auditService");
const { logHubtelEvent } = require("./hubtelLiveLogService");

const ALLOWED_CHANNELS = new Set(["mtn-gh", "vodafone-gh", "tigo-gh"]);
const CHANNEL_LABEL = {
  "mtn-gh": "MTN MoMo",
  "vodafone-gh": "Telecel Cash",
  "tigo-gh": "AirtelTigo Money",
};

function buildAuthHeader(value) {
  if (!value) return "";
  return value.startsWith("Basic ") ? value : `Basic ${value}`;
}

function normalizeMsisdn(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

function inferMomoChannelFromPhone(phone) {
  const normalized = normalizeMsisdn(phone);
  const local = normalized.startsWith("233") ? `0${normalized.slice(3)}` : normalized;
  const prefix = local.slice(0, 3);

  const mtnPrefixes = new Set(["024", "025", "053", "054", "055", "059"]);
  const telecelPrefixes = new Set(["020", "050"]);
  const tigoPrefixes = new Set(["026", "027", "056", "057"]);

  if (mtnPrefixes.has(prefix)) return "mtn-gh";
  if (telecelPrefixes.has(prefix)) return "vodafone-gh";
  if (tigoPrefixes.has(prefix)) return "tigo-gh";
  return null;
}

function channelLabel(channel) {
  return CHANNEL_LABEL[channel] || channel || "selected network";
}

function extractProviderMessage(error) {
  const payload = error?.response?.data || {};
  const nested = payload?.Data || payload?.data || {};
  return String(
    nested?.Description ||
    nested?.description ||
    payload?.Message ||
    payload?.message ||
    error?.message ||
    "",
  ).trim();
}

function toFriendlyPromptFailure(message, channel) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!lower) {
    return {
      statusCode: 502,
      message: "Unable to initiate MoMo prompt at the moment.",
    };
  }
  if (
    lower.includes("insufficient") ||
    lower.includes("balance limit") ||
    lower.includes("counter limit") ||
    lower.includes("missing permissions")
  ) {
    return {
      statusCode: 400,
      message:
        `Customer wallet on ${channelLabel(channel)} appears to have insufficient balance or wallet limit restrictions.`,
    };
  }
  if (lower.includes("not registered")) {
    return {
      statusCode: 400,
      message: `Customer number is not registered on ${channelLabel(channel)}.`,
    };
  }
  if (lower.includes("pin")) {
    return {
      statusCode: 400,
      message: `Customer PIN entry failed or was canceled on ${channelLabel(channel)}.`,
    };
  }
  return {
    statusCode: 502,
    message: text,
  };
}

function canUseLiveReceiveMoney() {
  return Boolean(
    env.hubtelReceiveMoneyBasicAuth &&
      env.hubtelPosSalesId &&
      env.hubtelReceiveMoneyBaseUrl,
  );
}

function canUseLiveVerification() {
  const verificationAuth =
    env.hubtelVerificationBasicAuth || env.hubtelReceiveMoneyBasicAuth;
  return Boolean(verificationAuth && env.hubtelPosSalesId && env.hubtelVerificationBaseUrl);
}

function getPrimaryCallbackUrl() {
  if (env.hubtelReceiveMoneyCallbackUrl) {
    return env.hubtelReceiveMoneyCallbackUrl;
  }
  return `${String(env.publicBaseUrl).replace(/\/$/, "")}/api/payments/hubtel/callback`;
}

async function verifyInStoreCustomerWallet({
  fullName,
  phone,
  channel,
  adminId,
  entityType = "customer",
  entityId = null,
}) {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw Object.assign(new Error("Unsupported MoMo channel"), { statusCode: 400 });
  }

  const normalizedPhone = normalizeMsisdn(phone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw Object.assign(new Error("A valid customer phone is required for MoMo verification"), {
      statusCode: 400,
    });
  }

  const inferredChannel = inferMomoChannelFromPhone(normalizedPhone);
  if (inferredChannel && inferredChannel !== channel) {
    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_VERIFICATION_FAILED",
      entityType,
      entityId,
      details: {
        reason: "network_mismatch",
        selectedChannel: channel,
        inferredChannel,
      },
    });

    throw Object.assign(
      new Error(
        `Selected network is ${channelLabel(channel)}, but the phone prefix matches ${channelLabel(inferredChannel)}. Please switch network and verify again.`,
      ),
      { statusCode: 400 },
    );
  }

  if (!env.enableMomoNameVerification) {
    return {
      checked: false,
      reason: "verification_disabled",
      phone: normalizedPhone,
    };
  }

  if (!canUseLiveVerification()) {
    throw Object.assign(
      new Error(
        "MoMo verification is enabled, but Hubtel verification credentials are missing.",
      ),
      { statusCode: 503 },
    );
  }

  const verificationAuth =
    env.hubtelVerificationBasicAuth || env.hubtelReceiveMoneyBasicAuth;
  const url =
    `${String(env.hubtelVerificationBaseUrl).replace(/\/$/, "")}` +
    `/merchantaccount/merchants/${env.hubtelPosSalesId}/mobilemoney/verify`;

  try {
    logHubtelEvent("HUBTEL_VERIFY_MOMO_REQUEST_OUT", {
      method: "GET",
      url,
      query: { channel, customerMsisdn: normalizedPhone },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(verificationAuth),
      },
      context: {
        entityType,
        entityId: entityId || null,
        adminId: adminId || null,
      },
    });

    const response = await axios.get(url, {
      params: { channel, customerMsisdn: normalizedPhone },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(verificationAuth),
      },
      timeout: 10000,
    });

    logHubtelEvent("HUBTEL_VERIFY_MOMO_RESPONSE_OK", {
      method: "GET",
      url,
      query: { channel, customerMsisdn: normalizedPhone },
      statusCode: response.status,
      body: response.data || null,
      context: {
        entityType,
        entityId: entityId || null,
        adminId: adminId || null,
      },
    });

    const verificationData = response.data?.data || null;
    const isRegistered = Boolean(verificationData?.isRegistered);
    const verifiedName = String(verificationData?.name || "").trim();
    const providedName = String(fullName || "").trim();

    if (!isRegistered) {
      await logSensitiveAction({
        actorType: "admin",
        actorId: adminId || null,
        action: "INSTORE_MOMO_VERIFICATION_FAILED",
        entityType,
        entityId,
        details: {
          reason: "wallet_not_registered",
          channel,
          responseCode: response.data?.responseCode || null,
        },
      });

      throw Object.assign(
        new Error(`Number is not registered on ${channelLabel(channel)}.`),
        { statusCode: 400 },
      );
    }

    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_VERIFICATION_PASSED",
      entityType,
      entityId,
      details: {
        channel,
        responseCode: response.data?.responseCode || null,
        providedName: providedName || null,
        verifiedName: verifiedName || null,
      },
    });

    return {
      checked: true,
      verifiedName,
      providedName,
      responseCode: response.data?.responseCode || null,
      isRegistered,
      phone: normalizedPhone,
    };
  } catch (error) {
    logHubtelEvent("HUBTEL_VERIFY_MOMO_RESPONSE_ERR", {
      method: "GET",
      url,
      query: { channel, customerMsisdn: normalizedPhone },
      statusCode: error.response?.status || null,
      error: error.message,
      body: error.response?.data || null,
      context: {
        entityType,
        entityId: entityId || null,
        adminId: adminId || null,
      },
    });

    if (error.statusCode) {
      throw error;
    }

    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_VERIFICATION_ERROR",
      entityType,
      entityId,
      details: {
        channel,
        message: error.message,
        status: error.response?.status || null,
        response: error.response?.data || null,
      },
    });

    if (error.response?.status === 403) {
      throw Object.assign(
        new Error(
          "Hubtel verification rejected this server (403). Confirm your server public IP is whitelisted for the verification service.",
        ),
        { statusCode: 502 },
      );
    }

    const providerMessage = extractProviderMessage(error);
    const lower = providerMessage.toLowerCase();
    if (lower.includes("not registered")) {
      throw Object.assign(
        new Error(`Number is not registered on ${channelLabel(channel)}.`),
        { statusCode: 400 },
      );
    }
    throw Object.assign(
      new Error(providerMessage || "Unable to verify customer wallet details at the moment."),
      { statusCode: 502 },
    );
  }
}

async function requestInStoreMomoPrompt({
  orderId,
  channel,
  adminId,
  skipNameVerification = false,
}) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found for payment prompt"), { statusCode: 404 });
  }

  if (!ALLOWED_CHANNELS.has(channel)) {
    throw Object.assign(new Error("Unsupported MoMo channel"), { statusCode: 400 });
  }

  const phone = normalizeMsisdn(order.phone);
  if (!phone || phone.length < 10) {
    throw Object.assign(new Error("A valid customer phone is required for MoMo payment"), {
      statusCode: 400,
    });
  }

  let verificationResult = { checked: false };
  if (canUseLiveReceiveMoney() && !skipNameVerification) {
    verificationResult = await verifyInStoreCustomerWallet({
      fullName: order.full_name,
      phone,
      channel,
      adminId,
      entityType: "order",
      entityId: order.id,
    });
  }

  const payload = {
    CustomerName: verificationResult.verifiedName || order.full_name,
    CustomerMsisdn: phone,
    Channel: channel,
    Amount: Number(Number(order.subtotal_cedis).toFixed(2)),
    PrimaryCallbackUrl: getPrimaryCallbackUrl(),
    Description: `In-store order ${order.order_number}`,
    ClientReference: order.client_reference,
  };

  if (!canUseLiveReceiveMoney()) {
    logHubtelEvent("HUBTEL_RECEIVE_MONEY_SKIPPED", {
      reason: "missing_receive_money_configuration",
      channel,
      orderId: order.id,
      orderNumber: order.order_number,
      clientReference: order.client_reference,
      payload,
    });

    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_PROMPT_SIMULATED",
      entityType: "order",
      entityId: order.id,
      details: { channel },
    });

    return {
      initiated: false,
      simulated: true,
      channel,
      responseCode: "SIMULATED",
      message:
        "Live Hubtel Receive Money credentials are not configured. Prompt simulated only.",
      clientReference: order.client_reference,
      orderNumber: order.order_number,
    };
  }

  try {
    const url = `${String(env.hubtelReceiveMoneyBaseUrl).replace(/\/$/, "")}/merchantaccount/merchants/${env.hubtelPosSalesId}/receive/mobilemoney`;
    logHubtelEvent("HUBTEL_RECEIVE_MONEY_REQUEST_OUT", {
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: buildAuthHeader(env.hubtelReceiveMoneyBasicAuth),
      },
      body: payload,
      context: {
        channel,
        orderId: order.id,
        orderNumber: order.order_number,
        clientReference: order.client_reference,
        adminId: adminId || null,
      },
    });

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: buildAuthHeader(env.hubtelReceiveMoneyBasicAuth),
      },
      timeout: 10000,
    });

    logHubtelEvent("HUBTEL_RECEIVE_MONEY_RESPONSE_OK", {
      method: "POST",
      url,
      statusCode: response.status,
      body: response.data || null,
      context: {
        channel,
        orderId: order.id,
        orderNumber: order.order_number,
        clientReference: order.client_reference,
        adminId: adminId || null,
      },
    });

    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_PROMPT_INITIATED",
      entityType: "order",
      entityId: order.id,
      details: {
        channel,
        responseCode: response.data?.ResponseCode || null,
      },
    });

    return {
      initiated: true,
      simulated: false,
      channel,
      responseCode: response.data?.ResponseCode || null,
      message:
        response.data?.Message ||
        "Payment prompt sent. Customer should enter MoMo PIN to complete payment.",
      transactionId: response.data?.Data?.TransactionId || null,
      externalTransactionId: response.data?.Data?.ExternalTransactionId || null,
      clientReference: response.data?.Data?.ClientReference || order.client_reference,
      verification: verificationResult.checked
        ? {
            checked: true,
            verifiedName: verificationResult.verifiedName || null,
            responseCode: verificationResult.responseCode || null,
            isRegistered: verificationResult.isRegistered,
          }
        : {
            checked: false,
          },
      raw: response.data || null,
    };
  } catch (error) {
    const providerMessage = extractProviderMessage(error);
    const mapped = toFriendlyPromptFailure(providerMessage, channel);

    logHubtelEvent("HUBTEL_RECEIVE_MONEY_RESPONSE_ERR", {
      method: "POST",
      url: `${String(env.hubtelReceiveMoneyBaseUrl).replace(/\/$/, "")}/merchantaccount/merchants/${env.hubtelPosSalesId}/receive/mobilemoney`,
      statusCode: error.response?.status || null,
      error: error.message,
      providerMessage: providerMessage || null,
      body: error.response?.data || null,
      mappedStatusCode: mapped.statusCode,
      mappedMessage: mapped.message,
      context: {
        channel,
        orderId: order.id,
        orderNumber: order.order_number,
        clientReference: order.client_reference,
        adminId: adminId || null,
      },
    });

    await logSensitiveAction({
      actorType: "admin",
      actorId: adminId || null,
      action: "INSTORE_MOMO_PROMPT_FAILED",
      entityType: "order",
      entityId: order.id,
      details: {
        channel,
        message: error.message,
        providerMessage: providerMessage || null,
        response: error.response?.data || null,
      },
    });

    throw Object.assign(new Error(mapped.message), {
      statusCode: mapped.statusCode,
    });
  }
}

async function requestUssdMomoPrompt({ orderId, phone }) {
  const channel = inferMomoChannelFromPhone(phone);
  logHubtelEvent("USSD_MOMO_PROMPT_REQUESTED", {
    orderId,
    phone,
    inferredChannel: channel || null,
  });

  if (!channel) {
    throw Object.assign(
      new Error("Unable to detect MoMo network from phone number."),
      { statusCode: 400 },
    );
  }

  try {
    const result = await requestInStoreMomoPrompt({
      orderId,
      channel,
      adminId: null,
      skipNameVerification: true,
    });

    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "USSD_MOMO_PROMPT_REQUESTED",
      entityType: "order",
      entityId: orderId,
      details: {
        channel,
        initiated: result.initiated,
        simulated: result.simulated,
        responseCode: result.responseCode || null,
      },
    });

    logHubtelEvent("USSD_MOMO_PROMPT_RESULT", {
      orderId,
      channel,
      initiated: Boolean(result.initiated),
      simulated: Boolean(result.simulated),
      responseCode: result.responseCode || null,
      message: result.message || null,
    });

    return { ...result, channel };
  } catch (error) {
    logHubtelEvent("USSD_MOMO_PROMPT_ERROR", {
      orderId,
      channel,
      error: error.message,
      statusCode: error.statusCode || null,
    });

    await logSensitiveAction({
      actorType: "system",
      actorId: null,
      action: "USSD_MOMO_PROMPT_FAILED",
      entityType: "order",
      entityId: orderId,
      details: {
        channel,
        message: error.message,
        statusCode: error.statusCode || null,
      },
    });
    throw error;
  }
}

module.exports = {
  requestInStoreMomoPrompt,
  requestUssdMomoPrompt,
  verifyInStoreCustomerWallet,
  inferMomoChannelFromPhone,
};
