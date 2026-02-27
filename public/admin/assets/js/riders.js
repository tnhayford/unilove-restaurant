let riderRows = [];
let referralRows = [];

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}`.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function badge(label, tone = "") {
  const safeLabel = AdminCore.escapeHtml(String(label || "-").trim() || "-");
  const safeTone = String(tone || "").trim();
  return `<span class="pill ${safeTone}">${safeLabel}</span>`;
}

function isManagedStaff(row) {
  return (row.mode || "staff") === "staff" && row.isManaged !== false;
}

function renderShiftBadge(row) {
  const shiftStatus = String(row.shiftStatus || "offline").trim().toLowerCase();
  if (shiftStatus === "online") return badge("online", "pickup");
  return badge("offline", "warning");
}

function renderStatusBadge(row) {
  const onboarding = String(row.onboardingStatus || "offboarded").trim().toLowerCase();
  if (onboarding === "onboarded" && row.isActive) {
    return badge("onboarded", "onboarded");
  }
  if ((row.mode || "staff") === "guest") {
    return badge("guest-session", "warning");
  }
  return badge("offboarded", "offboarded");
}

function renderModeBadge(row) {
  return (row.mode || "staff") === "guest"
    ? badge("guest", "warning")
    : badge("staff", "info");
}

function renderRiderRows() {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("riderBody");
  tbody.innerHTML = "";

  if (!riderRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="12" class="order-meta">No riders found. Onboard your first rider above.</td>';
    tbody.appendChild(tr);
    return;
  }

  riderRows.forEach((row) => {
    const managed = isManagedStaff(row);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${managed ? `<input class="input" data-role="name" value="${e(row.fullName || "")}" />` : e(row.fullName || "-")}</td>
      <td>${managed ? `<input class="input" data-role="phone" inputmode="tel" value="${e(row.phone || "")}" />` : e(row.phone || "-")}</td>
      <td>${renderModeBadge(row)}</td>
      <td>${renderStatusBadge(row)}</td>
      <td>${renderShiftBadge(row)}</td>
      <td>${e(row.assignedOrderCount || 0)}</td>
      <td>${e(row.deliveredCount || 0)}</td>
      <td>${e(formatMoney(row.codCollectedCedis || 0))}</td>
      <td>${e(formatDate(row.lastSeenAt))}</td>
      <td>${e(formatDate(row.lastLoginAt))}</td>
      <td>${managed ? `<input class="input" data-role="notes" value="${e(row.notes || "")}" />` : e(row.notes || "-")}</td>
      <td>
        ${managed ? `
          <div class="inline-actions">
            <button type="button" class="btn btn-sm primary" data-role="save">Save</button>
            <button type="button" class="btn btn-sm" data-role="toggle">${row.isActive ? "Offboard" : "Onboard"}</button>
            <button type="button" class="btn btn-sm danger" data-role="delete">Delete</button>
          </div>
        ` : '<span class="order-meta">Session rider</span>'}
      </td>
    `;

    if (!managed) {
      tbody.appendChild(tr);
      return;
    }

    tr.querySelector('[data-role="save"]').addEventListener("click", async () => {
      const fullName = tr.querySelector('[data-role="name"]').value.trim();
      const phone = normalizePhone(tr.querySelector('[data-role="phone"]').value);
      const notes = tr.querySelector('[data-role="notes"]').value.trim();
      if (!fullName) {
        AdminLayout.setStatus("Full name is required.", "error");
        return;
      }
      if (phone.length < 10 || phone.length > 15) {
        AdminLayout.setStatus("Phone must be 10-15 digits.", "error");
        return;
      }
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Save rider updates for ${row.fullName}?`,
          { title: "Confirm Rider Update", confirmLabel: "Apply" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ fullName, phone, notes }),
        });
        await loadRiders();
        AdminLayout.setStatus("Rider profile updated.", "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="toggle"]').addEventListener("click", async () => {
      const nextActive = !row.isActive;
      const nextOnboardingStatus = nextActive ? "onboarded" : "offboarded";
      try {
        const confirmed = await AdminLayout.confirmAction(
          `${nextActive ? "Onboard" : "Offboard"} rider ${row.fullName}?`,
          { title: "Confirm Rider Status", confirmLabel: "Apply" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            isActive: nextActive,
            onboardingStatus: nextOnboardingStatus,
          }),
        });
        await loadRiders();
        AdminLayout.setStatus(`Rider ${nextActive ? "onboarded" : "offboarded"}.`, "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="delete"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Delete rider ${row.fullName}? This cannot be undone.`,
          { title: "Confirm Rider Deletion", confirmLabel: "Delete" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "DELETE",
        });
        await loadRiders();
        AdminLayout.setStatus("Rider deleted.", "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tbody.appendChild(tr);
  });
}

function renderReferralRows() {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("referralBody");
  tbody.innerHTML = "";

  if (!referralRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="8" class="order-meta">No referral codes yet.</td>';
    tbody.appendChild(tr);
    return;
  }

  referralRows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${e(row.code)}</code></td>
      <td><input class="input" data-role="label" value="${e(row.label || "")}" /></td>
      <td>${row.isActive ? badge("active", "pickup") : badge("inactive", "warning")}</td>
      <td>${e(row.useCount || 0)}</td>
      <td><input class="input" data-role="maxUses" type="number" min="1" value="${e(row.maxUses ?? "")}" placeholder="Unlimited" /></td>
      <td>${e(formatDate(row.lastUsedAt))}</td>
      <td>${e(formatDate(row.createdAt))}</td>
      <td>
        <div class="inline-actions">
          <button type="button" class="btn btn-sm primary" data-role="save">Save</button>
          <button type="button" class="btn btn-sm" data-role="toggle">${row.isActive ? "Disable" : "Enable"}</button>
          <button type="button" class="btn btn-sm danger" data-role="delete">Delete</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-role="save"]').addEventListener("click", async () => {
      const label = tr.querySelector('[data-role="label"]').value.trim();
      const maxRaw = tr.querySelector('[data-role="maxUses"]').value.trim();
      const maxUses = maxRaw ? Number(maxRaw) : null;
      try {
        await AdminCore.api(`/api/admin/riders/referrals/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            label: label || null,
            maxUses: Number.isFinite(maxUses) ? Math.floor(maxUses) : null,
          }),
        });
        await loadReferrals();
        AdminLayout.setStatus("Referral code updated.", "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="toggle"]').addEventListener("click", async () => {
      try {
        await AdminCore.api(`/api/admin/riders/referrals/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: !row.isActive }),
        });
        await loadReferrals();
        AdminLayout.setStatus(`Referral ${!row.isActive ? "enabled" : "disabled"}.`, "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="delete"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Delete referral code ${row.code}?`,
          { title: "Confirm Referral Deletion", confirmLabel: "Delete" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/referrals/${encodeURIComponent(row.id)}`, {
          method: "DELETE",
        });
        await loadReferrals();
        AdminLayout.setStatus("Referral deleted.", "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tbody.appendChild(tr);
  });
}

async function loadRiders() {
  const response = await AdminCore.api("/api/admin/riders/accounts");
  riderRows = response.data || [];
  renderRiderRows();
}

async function loadReferrals() {
  const response = await AdminCore.api("/api/admin/riders/referrals");
  referralRows = response.data || [];
  renderReferralRows();
}

(async function initRidersPage() {
  await AdminLayout.initProtectedPage();
  AdminLayout.setStatus("Manage rider onboarding, OTP access, and guest referral codes.", "helper");

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = backBtn.dataset.fallback;
    });
  }

  document.getElementById("createRiderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fullName = document.getElementById("riderFullName").value.trim();
    const phone = normalizePhone(document.getElementById("riderPhone").value.trim());
    const notes = document.getElementById("riderNotes").value.trim();
    const isActive = document.getElementById("riderStatus").value === "active";

    if (!fullName) {
      AdminLayout.setStatus("Rider full name is required.", "error");
      return;
    }
    if (phone.length < 10 || phone.length > 15) {
      AdminLayout.setStatus("Phone must be 10-15 digits.", "error");
      return;
    }

    try {
      const confirmed = await AdminLayout.confirmAction(
        `Create rider ${fullName}?`,
        { title: "Confirm Rider Creation", confirmLabel: "Create" },
      );
      if (!confirmed) return;
      await AdminCore.api("/api/admin/riders/accounts", {
        method: "POST",
        body: JSON.stringify({ fullName, phone, notes: notes || null, isActive }),
      });
      document.getElementById("createRiderForm").reset();
      document.getElementById("riderStatus").value = "active";
      await loadRiders();
      AdminLayout.setStatus("Rider created successfully.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("createReferralForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const label = document.getElementById("referralLabel").value.trim();
    const maxUsesRaw = document.getElementById("referralMaxUses").value.trim();
    const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;

    try {
      await AdminCore.api("/api/admin/riders/referrals", {
        method: "POST",
        body: JSON.stringify({
          label: label || null,
          maxUses: Number.isFinite(maxUses) ? Math.floor(maxUses) : null,
        }),
      });
      document.getElementById("createReferralForm").reset();
      await loadReferrals();
      AdminLayout.setStatus("Referral code generated.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("refreshRidersBtn").addEventListener("click", async () => {
    try {
      await Promise.all([loadRiders(), loadReferrals()]);
      AdminLayout.setStatus("Rider data refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("purgeRidersBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Delete ALL rider accounts now? This will remove staff riders and clear active assignments.",
        { title: "Danger: Purge Rider Accounts", confirmLabel: "Delete All" },
      );
      if (!confirmed) return;
      const response = await AdminCore.api("/api/admin/riders/accounts/purge", { method: "POST", body: "{}" });
      await Promise.all([loadRiders(), loadReferrals()]);
      AdminLayout.setStatus(`Deleted ${response.data?.deletedCount || 0} rider account(s).`, "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  await Promise.all([loadRiders(), loadReferrals()]);
})();
