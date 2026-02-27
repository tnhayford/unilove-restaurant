let riderRows = [];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function badge(label, tone = "") {
  const safeLabel = AdminCore.escapeHtml(String(label || "-").trim() || "-");
  const safeTone = String(tone || "").trim();
  return `<span class="pill ${safeTone}">${safeLabel}</span>`;
}

function renderAccountBadge(row) {
  if ((row.mode || "staff") === "guest") {
    return badge("session", "warning");
  }
  return row.isActive ? badge("active", "pickup") : badge("inactive", "warning");
}

function renderAvailabilityBadge(row) {
  const status = String(row.status || "offline").trim().toLowerCase();
  if (status === "busy") {
    const count = Number(row.assignedOrderCount || 0);
    return badge(count > 0 ? `busy (${count})` : "busy", "warning");
  }
  if (status === "available") return badge("available", "pickup");
  return badge("offline", "danger");
}

function renderShiftBadge(row) {
  const shiftStatus = String(row.shiftStatus || "offline").trim().toLowerCase();
  if (shiftStatus === "online") return badge("online", "pickup");
  return badge("offline", "warning");
}

function isManagedStaff(row) {
  return (row.mode || "staff") === "staff" && row.isManaged !== false;
}

function renderRows() {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("riderBody");
  tbody.innerHTML = "";

  if (!riderRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="10" class="order-meta">No rider accounts or sessions found.</td>';
    tbody.appendChild(tr);
    return;
  }

  riderRows.forEach((row) => {
    const managedStaff = isManagedStaff(row);
    const tr = document.createElement("tr");

    const nameCell = managedStaff
      ? `<input class="input rider-name-input" data-role="name" value="${e(row.fullName || "")}" />`
      : `<span>${e(row.fullName || "-")}</span>`;

    const actionsCell = managedStaff
      ? `
        <div class="staff-actions">
          <button type="button" class="btn btn-sm primary" data-role="save">Save</button>
          <button type="button" class="btn btn-sm" data-role="toggle">${row.isActive ? "Deactivate" : "Activate"}</button>
          <input class="input rider-pin-input" data-role="pin" type="password" inputmode="numeric" placeholder="New PIN" />
          <button type="button" class="btn btn-sm" data-role="reset-pin">Reset PIN</button>
        </div>
      `
      : `<span class="order-meta">Guest/session riders are read-only.</span>`;

    tr.innerHTML = `
      <td>${e(row.id)}</td>
      <td>${nameCell}</td>
      <td>${e((row.mode || "staff").toUpperCase())}</td>
      <td>${renderShiftBadge(row)}</td>
      <td>${renderAccountBadge(row)}</td>
      <td>${renderAvailabilityBadge(row)}</td>
      <td>${e(formatDate(row.lastSeenAt))}</td>
      <td>${e(formatDate(row.lastLoginAt))}</td>
      <td>${e(formatDate(row.createdAt))}</td>
      <td>${actionsCell}</td>
    `;

    if (!managedStaff) {
      tbody.appendChild(tr);
      return;
    }

    tr.querySelector('[data-role="save"]').addEventListener("click", async () => {
      const fullName = tr.querySelector('[data-role="name"]').value.trim();
      if (!fullName) {
        AdminLayout.setStatus("Rider full name is required.", "error");
        return;
      }
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Update rider profile for ${row.id}?`,
          { title: "Confirm Rider Update", confirmLabel: "Apply" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ fullName }),
        });
        await loadRiders();
        AdminLayout.setStatus(`Updated rider ${row.id}.`, "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="toggle"]').addEventListener("click", async () => {
      const nextIsActive = !row.isActive;
      try {
        const confirmed = await AdminLayout.confirmAction(
          `${nextIsActive ? "Activate" : "Deactivate"} rider ${row.id}?`,
          { title: "Confirm Rider Status Update", confirmLabel: "Apply" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: nextIsActive }),
        });
        await loadRiders();
        AdminLayout.setStatus(`Rider ${row.id} ${nextIsActive ? "activated" : "deactivated"}.`, "success");
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="reset-pin"]').addEventListener("click", async () => {
      const pin = tr.querySelector('[data-role="pin"]').value.trim();
      if (!/^\d{4,32}$/.test(pin)) {
        AdminLayout.setStatus("PIN must be numeric and at least 4 digits.", "error");
        return;
      }
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Reset PIN for rider ${row.id}?`,
          { title: "Confirm Rider PIN Reset", confirmLabel: "Reset" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/riders/accounts/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ pin }),
        });
        tr.querySelector('[data-role="pin"]').value = "";
        AdminLayout.setStatus(`PIN reset for rider ${row.id}.`, "success");
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
  renderRows();
}

(async function initRidersPage() {
  await AdminLayout.initProtectedPage();
  AdminLayout.setStatus("Manage staff rider onboarding and monitor guest rider sessions.", "helper");

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
    const riderId = document.getElementById("riderId").value.trim();
    const fullName = document.getElementById("riderFullName").value.trim();
    const pin = document.getElementById("riderPin").value.trim();
    const isActive = document.getElementById("riderStatus").value === "active";

    if (!/^[a-zA-Z0-9_-]{2,60}$/.test(riderId)) {
      AdminLayout.setStatus("Rider ID must be 2-60 chars: letters, numbers, _ or - only.", "error");
      return;
    }
    if (!/^\d{4,32}$/.test(pin)) {
      AdminLayout.setStatus("PIN must be numeric and at least 4 digits.", "error");
      return;
    }

    try {
      const confirmed = await AdminLayout.confirmAction(
        `Create rider account ${riderId}?`,
        { title: "Confirm Rider Creation", confirmLabel: "Create" },
      );
      if (!confirmed) return;
      await AdminCore.api("/api/admin/riders/accounts", {
        method: "POST",
        body: JSON.stringify({ riderId, fullName, pin, isActive }),
      });
      document.getElementById("createRiderForm").reset();
      document.getElementById("riderStatus").value = "active";
      await loadRiders();
      AdminLayout.setStatus(`Rider ${riderId} created.`, "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  await loadRiders();
})();
