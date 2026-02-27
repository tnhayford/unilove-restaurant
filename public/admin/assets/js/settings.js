let previewCtx;
let currentAdmin = null;

function setForm(settings) {
  const toneSelect = document.getElementById("alertTone");
  const normalizedTone = settings.alertTone === "rider_arrival" ? "dispatch_pop" : settings.alertTone;
  const nextTone = String(normalizedTone || "ops_default").trim().toLowerCase();
  const hasToneOption = Array.from(toneSelect.options || []).some((option) => option.value === nextTone);
  toneSelect.value = hasToneOption ? nextTone : "ops_default";
  document.getElementById("alertVolume").value = String(settings.alertVolume);
  document.getElementById("alertEnabled").value = String(settings.alertEnabled);
  document.getElementById("alertIntervalMs").value = String(settings.alertIntervalMs);
  document.getElementById("autoRefreshMs").value = String(settings.autoRefreshMs);
  document.getElementById("alertVolumeValue").textContent = String(
    Math.round(Number(settings.alertVolume || 0) * 100),
  );
}

function getFormSettings() {
  const alertVolume = Number(document.getElementById("alertVolume").value || 0.75);
  return {
    alertTone: document.getElementById("alertTone").value,
    alertVolume: Math.max(0, Math.min(1, alertVolume)),
    alertEnabled: document.getElementById("alertEnabled").value === "true",
    alertIntervalMs: Math.max(700, Number(document.getElementById("alertIntervalMs").value || 1400)),
    autoRefreshMs: Math.max(3000, Number(document.getElementById("autoRefreshMs").value || 12000)),
  };
}

function playTone({ frequency, startAt, duration, volume, type = "sine" }) {
  if (!previewCtx) return;
  const osc = previewCtx.createOscillator();
  const gain = previewCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(previewCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.01);
}

function playPreview() {
  const settings = getFormSettings();
  previewCtx = previewCtx || new window.AudioContext();
  const base = previewCtx.currentTime;
  const volume = settings.alertVolume;

  if (settings.alertTone === "driver_ping") {
    playTone({ frequency: 1700, startAt: base, duration: 0.1, volume, type: "triangle" });
    playTone({ frequency: 1900, startAt: base + 0.14, duration: 0.1, volume: volume * 0.9, type: "triangle" });
    return;
  }

  if (settings.alertTone === "digital_bell") {
    playTone({ frequency: 2100, startAt: base, duration: 0.12, volume, type: "square" });
    playTone({ frequency: 1600, startAt: base + 0.16, duration: 0.12, volume: volume * 0.9, type: "square" });
    playTone({ frequency: 1800, startAt: base + 0.32, duration: 0.12, volume: volume * 0.8, type: "square" });
    return;
  }

  if (settings.alertTone === "kitchen_bell") {
    playTone({ frequency: 920, startAt: base, duration: 0.16, volume, type: "triangle" });
    playTone({ frequency: 760, startAt: base + 0.2, duration: 0.16, volume: volume * 0.9, type: "triangle" });
    return;
  }

  if (settings.alertTone === "siren_soft") {
    playTone({ frequency: 620, startAt: base, duration: 0.22, volume, type: "sawtooth" });
    playTone({ frequency: 780, startAt: base + 0.24, duration: 0.22, volume: volume * 0.95, type: "sawtooth" });
    return;
  }

  if (settings.alertTone === "cashier_ping") {
    playTone({ frequency: 1450, startAt: base, duration: 0.09, volume, type: "sine" });
    playTone({ frequency: 980, startAt: base + 0.12, duration: 0.09, volume: volume * 0.85, type: "sine" });
    return;
  }

  if (settings.alertTone === "triple_beep") {
    playTone({ frequency: 1700, startAt: base, duration: 0.07, volume, type: "square" });
    playTone({ frequency: 1700, startAt: base + 0.1, duration: 0.07, volume: volume * 0.95, type: "square" });
    playTone({ frequency: 1700, startAt: base + 0.2, duration: 0.07, volume: volume * 0.9, type: "square" });
    return;
  }

  if (settings.alertTone === "gong_short") {
    playTone({ frequency: 520, startAt: base, duration: 0.24, volume, type: "triangle" });
    playTone({ frequency: 780, startAt: base + 0.03, duration: 0.2, volume: volume * 0.7, type: "sine" });
    return;
  }

  if (settings.alertTone === "uber_ping_classic") {
    playTone({ frequency: 1230, startAt: base, duration: 0.08, volume, type: "sine" });
    playTone({ frequency: 1470, startAt: base + 0.1, duration: 0.09, volume: volume * 0.95, type: "sine" });
    return;
  }

  if (settings.alertTone === "uber_ping_double") {
    playTone({ frequency: 1180, startAt: base, duration: 0.07, volume, type: "triangle" });
    playTone({ frequency: 1360, startAt: base + 0.09, duration: 0.07, volume: volume * 0.95, type: "triangle" });
    playTone({ frequency: 1180, startAt: base + 0.22, duration: 0.07, volume: volume * 0.9, type: "triangle" });
    playTone({ frequency: 1360, startAt: base + 0.31, duration: 0.07, volume: volume * 0.85, type: "triangle" });
    return;
  }

  if (settings.alertTone === "uber_ping_triple") {
    playTone({ frequency: 1260, startAt: base, duration: 0.06, volume, type: "sine" });
    playTone({ frequency: 1480, startAt: base + 0.08, duration: 0.06, volume: volume * 0.95, type: "sine" });
    playTone({ frequency: 1260, startAt: base + 0.18, duration: 0.06, volume: volume * 0.9, type: "sine" });
    playTone({ frequency: 1480, startAt: base + 0.26, duration: 0.06, volume: volume * 0.85, type: "sine" });
    playTone({ frequency: 1260, startAt: base + 0.36, duration: 0.06, volume: volume * 0.8, type: "sine" });
    playTone({ frequency: 1480, startAt: base + 0.44, duration: 0.06, volume: volume * 0.75, type: "sine" });
    return;
  }

  if (settings.alertTone === "dispatch_pop") {
    playTone({ frequency: 980, startAt: base, duration: 0.05, volume, type: "square" });
    playTone({ frequency: 820, startAt: base + 0.07, duration: 0.06, volume: volume * 0.9, type: "square" });
    playTone({ frequency: 1180, startAt: base + 0.14, duration: 0.05, volume: volume * 0.85, type: "square" });
    return;
  }

  if (settings.alertTone === "priority_nudge") {
    playTone({ frequency: 1620, startAt: base, duration: 0.06, volume, type: "square" });
    playTone({ frequency: 1620, startAt: base + 0.09, duration: 0.06, volume: volume * 0.95, type: "square" });
    playTone({ frequency: 1850, startAt: base + 0.2, duration: 0.08, volume: volume * 0.9, type: "square" });
    return;
  }

  if (settings.alertTone === "neon_tick") {
    playTone({ frequency: 2080, startAt: base, duration: 0.04, volume, type: "sine" });
    playTone({ frequency: 1980, startAt: base + 0.08, duration: 0.04, volume: volume * 0.9, type: "sine" });
    playTone({ frequency: 1880, startAt: base + 0.16, duration: 0.04, volume: volume * 0.8, type: "sine" });
    return;
  }

  if (settings.alertTone === "metro_ping") {
    playTone({ frequency: 1100, startAt: base, duration: 0.07, volume, type: "sawtooth" });
    playTone({ frequency: 1320, startAt: base + 0.1, duration: 0.07, volume: volume * 0.95, type: "sawtooth" });
    playTone({ frequency: 1100, startAt: base + 0.22, duration: 0.07, volume: volume * 0.9, type: "sawtooth" });
    return;
  }

  if (settings.alertTone === "sonar_blip") {
    playTone({ frequency: 760, startAt: base, duration: 0.09, volume, type: "sine" });
    playTone({ frequency: 880, startAt: base + 0.14, duration: 0.09, volume: volume * 0.9, type: "sine" });
    playTone({ frequency: 980, startAt: base + 0.28, duration: 0.09, volume: volume * 0.8, type: "sine" });
    return;
  }

  if (settings.alertTone === "prison_siren") {
    playTone({ frequency: 520, startAt: base, duration: 0.24, volume, type: "sawtooth" });
    playTone({ frequency: 760, startAt: base + 0.26, duration: 0.24, volume: volume * 0.95, type: "sawtooth" });
    playTone({ frequency: 540, startAt: base + 0.52, duration: 0.24, volume: volume * 0.9, type: "sawtooth" });
    return;
  }

  if (settings.alertTone === "door_lock") {
    playTone({ frequency: 210, startAt: base, duration: 0.08, volume, type: "square" });
    playTone({ frequency: 160, startAt: base + 0.1, duration: 0.07, volume: volume * 0.85, type: "square" });
    return;
  }

  if (settings.alertTone === "prison_breach") {
    playTone({ frequency: 620, startAt: base, duration: 0.08, volume, type: "square" });
    playTone({ frequency: 820, startAt: base + 0.1, duration: 0.08, volume: volume * 0.95, type: "square" });
    playTone({ frequency: 620, startAt: base + 0.2, duration: 0.08, volume: volume * 0.9, type: "square" });
    playTone({ frequency: 820, startAt: base + 0.3, duration: 0.08, volume: volume * 0.85, type: "square" });
    playTone({ frequency: 980, startAt: base + 0.42, duration: 0.14, volume: volume * 0.8, type: "sawtooth" });
    return;
  }

  if (settings.alertTone === "large_chapel_bell") {
    playTone({ frequency: 330, startAt: base, duration: 0.34, volume, type: "triangle" });
    playTone({ frequency: 495, startAt: base + 0.04, duration: 0.28, volume: volume * 0.6, type: "sine" });
    return;
  }

  if (settings.alertTone === "pantry_bell") {
    playTone({ frequency: 1400, startAt: base, duration: 0.1, volume, type: "triangle" });
    playTone({ frequency: 1250, startAt: base + 0.12, duration: 0.09, volume: volume * 0.85, type: "triangle" });
    return;
  }

  playTone({ frequency: 1850, startAt: base, duration: 0.08, volume, type: "sine" });
  playTone({ frequency: 2100, startAt: base + 0.11, duration: 0.08, volume, type: "sine" });
  playTone({ frequency: 1900, startAt: base + 0.22, duration: 0.08, volume, type: "sine" });
  playTone({ frequency: 2150, startAt: base + 0.33, duration: 0.08, volume: volume * 0.95, type: "sine" });
}

function setStoreForm(status) {
  document.getElementById("storeOpenStatus").value = String(Boolean(status.isOpen));
  document.getElementById("storeClosureMessage").value = status.closureMessage || "";
}

function setOperationsPolicyForm(policy = {}) {
  document.getElementById("smsOrderTrackingEnabled").value = String(Boolean(policy.smsOrderTrackingEnabled));
  document.getElementById("smsOrderCompletionEnabled").value = String(Boolean(policy.smsOrderCompletionEnabled));
  document.getElementById("smsDeliveryOtpEnabled").value = String(Boolean(policy.smsDeliveryOtpEnabled));
  document.getElementById("riderGuestLoginPolicy").value = policy.riderGuestLoginPolicy || "open";
  document.getElementById("riderGuestAccessCode").value = policy.riderGuestAccessCode || "";
  document.getElementById("riderGuestCommissionPercent").value = String(
    Number(policy.riderGuestCommissionPercent ?? 8),
  );
}

function getOperationsPolicyForm() {
  return {
    smsOrderTrackingEnabled: document.getElementById("smsOrderTrackingEnabled").value === "true",
    smsOrderCompletionEnabled: document.getElementById("smsOrderCompletionEnabled").value === "true",
    smsDeliveryOtpEnabled: document.getElementById("smsDeliveryOtpEnabled").value === "true",
    riderGuestLoginPolicy: document.getElementById("riderGuestLoginPolicy").value,
    riderGuestAccessCode: document.getElementById("riderGuestAccessCode").value.trim(),
    riderGuestCommissionPercent: Number(
      document.getElementById("riderGuestCommissionPercent").value || 8,
    ),
  };
}

async function loadStoreStatus() {
  try {
    const payload = await AdminCore.api("/api/admin/store/status");
    setStoreForm(payload.data || { isOpen: true, closureMessage: "" });
  } catch (error) {
    AdminLayout.setStatus(error.message, "error");
  }
}

async function loadOperationsPolicy() {
  const payload = await AdminCore.api("/api/admin/settings/operations");
  setOperationsPolicyForm(payload.data || {});
}

async function saveStoreStatus() {
  const isOpen = document.getElementById("storeOpenStatus").value === "true";
  const closureMessage = document.getElementById("storeClosureMessage").value.trim();
  const payload = await AdminCore.api("/api/admin/store/status", {
    method: "PATCH",
    body: JSON.stringify({ isOpen, closureMessage }),
  });
  setStoreForm(payload.data || { isOpen, closureMessage });
  AdminLayout.setStatus(
    isOpen ? "Store opened for new orders." : "Store closed for new orders.",
    "success",
  );
  await AdminLayout.notifyAction(
    isOpen ? "Store is now OPEN for new orders." : "Store is now CLOSED for new orders.",
    { title: "Store Status Updated" },
  );
}

async function loadSlaSettings() {
  const payload = await AdminCore.api("/api/admin/sla/settings");
  const data = payload.data || {};
  document.getElementById("slaPendingMinutes").value = String(data.pendingPaymentMinutes || 10);
  document.getElementById("slaKitchenMinutes").value = String(data.kitchenMinutes || 25);
  document.getElementById("slaDeliveryMinutes").value = String(data.deliveryMinutes || 45);
}

async function saveSlaSettings() {
  const body = {
    pendingPaymentMinutes: Number(document.getElementById("slaPendingMinutes").value || 10),
    kitchenMinutes: Number(document.getElementById("slaKitchenMinutes").value || 25),
    deliveryMinutes: Number(document.getElementById("slaDeliveryMinutes").value || 45),
  };
  await AdminCore.api("/api/admin/sla/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  AdminLayout.setStatus("SLA thresholds saved.", "success");
  await AdminLayout.notifyAction("SLA thresholds updated.", {
    title: "SLA Updated",
  });
}

async function saveOperationsPolicy() {
  const body = getOperationsPolicyForm();
  const payload = await AdminCore.api("/api/admin/settings/operations", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  setOperationsPolicyForm(payload.data || body);
  AdminLayout.setStatus("Operations policy saved.", "success");
  await AdminLayout.notifyAction("SMS and guest rider policy updated.", {
    title: "Operations Policy Updated",
  });
}

(async function initSettingsPage() {
  currentAdmin = await AdminLayout.initProtectedPage();
  const permissions = currentAdmin?.permissions || {};
  const canManageStoreStatus = Boolean(permissions["settings.store"]);
  const canManageSla = Boolean(permissions["settings.sla"]);

  const backBtn = document.getElementById("backBtn");
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = backBtn.dataset.fallback;
  });

  const settings = AdminCore.getSettings();
  setForm(settings);

  if (canManageStoreStatus) {
    await loadStoreStatus();
  } else {
    const saveStoreBtn = document.getElementById("saveStoreStatusBtn");
    saveStoreBtn.disabled = true;
    saveStoreBtn.title = "Missing permission: settings.store";
    document.getElementById("storeOpenStatus").disabled = true;
    document.getElementById("storeClosureMessage").disabled = true;
  }

  if (canManageSla) {
    await loadSlaSettings();
    await loadOperationsPolicy();
  } else {
    document.getElementById("saveSlaSettingsBtn").disabled = true;
    document.getElementById("saveSlaSettingsBtn").title = "Missing permission: settings.sla";
    document.getElementById("slaPendingMinutes").disabled = true;
    document.getElementById("slaKitchenMinutes").disabled = true;
    document.getElementById("slaDeliveryMinutes").disabled = true;
    document.getElementById("saveOpsPolicyBtn").disabled = true;
    document.getElementById("saveOpsPolicyBtn").title = "Missing permission: settings.sla";
    document.getElementById("smsOrderTrackingEnabled").disabled = true;
    document.getElementById("smsOrderCompletionEnabled").disabled = true;
    document.getElementById("smsDeliveryOtpEnabled").disabled = true;
    document.getElementById("riderGuestLoginPolicy").disabled = true;
    document.getElementById("riderGuestAccessCode").disabled = true;
    document.getElementById("riderGuestCommissionPercent").disabled = true;
  }

  document.getElementById("alertVolume").addEventListener("input", () => {
    document.getElementById("alertVolumeValue").textContent = String(
      Math.round(Number(document.getElementById("alertVolume").value || 0) * 100),
    );
  });

  document.getElementById("playPreviewBtn").addEventListener("click", () => {
    playPreview();
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const nextSettings = getFormSettings();
    AdminCore.saveSettings(nextSettings);
    AdminLayout.setStatus("Settings saved.", "success");
  });

  document.getElementById("saveRefreshBtn").addEventListener("click", () => {
    const nextSettings = getFormSettings();
    AdminCore.saveSettings({
      ...AdminCore.getSettings(),
      autoRefreshMs: nextSettings.autoRefreshMs,
    });
    AdminLayout.setStatus(`Operations refresh set to ${nextSettings.autoRefreshMs}ms.`, "success");
  });

  document.getElementById("saveStoreStatusBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Apply store status update?",
        { title: "Confirm Store Status" },
      );
      if (!confirmed) return;
      await saveStoreStatus();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("saveSlaSettingsBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Apply SLA threshold update?",
        { title: "Confirm SLA Update" },
      );
      if (!confirmed) return;
      await saveSlaSettings();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("saveOpsPolicyBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Apply operations policy update?",
        { title: "Confirm Operations Policy" },
      );
      if (!confirmed) return;
      await saveOperationsPolicy();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });
})();
