let staffRows = [];
let currentAdminId = "";
let permissionActions = [];
let loadedPermissionUserId = "";

function displayNameFromEmail(email) {
  const local = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();
  if (!local) return "Unknown";
  return local
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}Z`);
  return date.toLocaleString();
}

function roleBadge(role) {
  const safeRole = AdminCore.escapeHtml(role);
  return `<span class="pill ${role === "admin" ? "pickup" : "delivery"}">${safeRole}</span>`;
}

function renderRows() {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("staffBody");
  body.innerHTML = "";

  if (!staffRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="5" class="order-meta">No staff accounts found.</td>';
    body.appendChild(tr);
    return;
  }

  staffRows.forEach((row) => {
    const tr = document.createElement("tr");
    const isSelf = row.id === currentAdminId;
    tr.innerHTML = `
      <td>${e(row.fullName || displayNameFromEmail(row.email))}</td>
      <td>${e(row.email)}</td>
      <td>${roleBadge(row.role)}</td>
      <td>${e(formatDate(row.createdAt))}</td>
      <td>
        <div class="staff-actions">
          <select class="select staff-role-select" data-role="role">
            <option value="staff" ${row.role === "staff" ? "selected" : ""}>staff</option>
            <option value="admin" ${row.role === "admin" ? "selected" : ""}>admin</option>
          </select>
          <button type="button" class="btn btn-sm" data-role="save-role">Save Role</button>
          <button type="button" class="btn danger btn-sm" data-role="remove" ${isSelf ? "disabled" : ""}>Remove</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-role="save-role"]').addEventListener("click", async () => {
      const nextRole = tr.querySelector('[data-role="role"]').value;
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Apply role "${nextRole}" for ${row.email}?`,
          { title: "Confirm Staff Role Update" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/staff/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ role: nextRole }),
        });
        await loadStaff();
        AdminLayout.setStatus(`Updated role for ${row.email}.`, "success");
        await AdminLayout.notifyAction(`Updated role for ${row.email}.`, {
          title: "Staff Updated",
        });
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    tr.querySelector('[data-role="remove"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Remove staff account ${row.email}?`,
          { title: "Confirm Staff Removal", confirmLabel: "Remove" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/staff/${row.id}`, { method: "DELETE", body: JSON.stringify({}) });
        await loadStaff();
        AdminLayout.setStatus(`${row.email} removed.`, "success");
        await AdminLayout.notifyAction(`${row.email} removed.`, {
          title: "Staff Updated",
        });
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    body.appendChild(tr);
  });
}

function renderPermissionUserSelect() {
  const select = document.getElementById("permissionUserSelect");
  if (!select) return;
  const previous = select.value;
  const staffOnly = staffRows.filter((row) => row.role === "staff");
  select.innerHTML = "";
  staffOnly.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = `${row.fullName || displayNameFromEmail(row.email)} (${row.email})`;
    select.appendChild(option);
  });
  if (previous && staffOnly.some((row) => row.id === previous)) {
    select.value = previous;
  }
  if (!staffOnly.length) {
    loadedPermissionUserId = "";
  }
}

function renderPermissionGrid(actions, permissions) {
  const grid = document.getElementById("permissionGrid");
  grid.innerHTML = "";
  if (!actions.length) {
    grid.innerHTML = '<div class="order-meta">No actions available.</div>';
    return;
  }

  actions.forEach((action) => {
    const card = document.createElement("article");
    card.className = "menu-card color-sky";
    const checked = Boolean(permissions[action]);
    card.innerHTML = `
      <div class="title">${action}</div>
      <label class="checkbox-label">
        <input type="checkbox" data-action="${action}" ${checked ? "checked" : ""} />
        Allowed
      </label>
    `;
    grid.appendChild(card);
  });
}

function collectPermissionPayload() {
  const payload = {};
  document.querySelectorAll('#permissionGrid input[type=\"checkbox\"][data-action]').forEach((el) => {
    payload[el.dataset.action] = Boolean(el.checked);
  });
  if (payload["orders.monitor"] || payload["orders.update_status"] || payload["orders.cancel"] || payload["orders.refund"]) {
    payload["orders.view"] = true;
  }
  if (payload["menu.edit"]) {
    payload["menu.view"] = true;
  }
  if (payload["settings.sla"]) {
    payload["analytics.view"] = true;
  }
  if (payload["reports.download"] || payload["customers.export"]) {
    payload["reports.generate"] = true;
  }
  if (payload["payments.reconcile"]) {
    payload["orders.view"] = true;
  }
  return payload;
}

async function loadPermissionsForSelectedUser() {
  const userId = document.getElementById("permissionUserSelect").value;
  if (!userId) {
    renderPermissionGrid([], {});
    loadedPermissionUserId = "";
    return;
  }
  const response = await AdminCore.api(`/api/admin/staff/${encodeURIComponent(userId)}/permissions`);
  const data = response.data || {};
  permissionActions = data.actions || [];
  loadedPermissionUserId = userId;
  renderPermissionGrid(permissionActions, data.permissions || {});
}

async function loadStaff() {
  const response = await AdminCore.api("/api/admin/staff");
  staffRows = response.data || [];
  renderRows();
  renderPermissionUserSelect();
}

(async function initStaffPage() {
  const admin = await AdminLayout.initProtectedPage();
  currentAdminId = admin?.id || "";

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

  document.getElementById("createStaffForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fullName = document.getElementById("staffFullName").value.trim();
    const email = document.getElementById("staffEmail").value.trim();
    const password = document.getElementById("staffPassword").value;
    const role = document.getElementById("staffRole").value;

    try {
      const confirmed = await AdminLayout.confirmAction(
        `Create ${role} account for ${email}?`,
        { title: "Confirm Staff Creation", confirmLabel: "Create" },
      );
      if (!confirmed) return;
      await AdminCore.api("/api/admin/staff", {
        method: "POST",
        body: JSON.stringify({ fullName, email, password, role }),
      });
      document.getElementById("createStaffForm").reset();
      document.getElementById("staffRole").value = "staff";
      await loadStaff();
      AdminLayout.setStatus("Staff account created.", "success");
      await AdminLayout.notifyAction("Staff account created.", { title: "Staff Updated" });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("loadPermissionsBtn").addEventListener("click", async () => {
    try {
      await loadPermissionsForSelectedUser();
      AdminLayout.setStatus("Permissions loaded.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("permissionUserSelect").addEventListener("change", async () => {
    try {
      await loadPermissionsForSelectedUser();
      AdminLayout.setStatus("Switched staff permission view.", "helper");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("savePermissionsBtn").addEventListener("click", async () => {
    const saveButton = document.getElementById("savePermissionsBtn");
    if (saveButton.disabled) return;
    const initialLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = "Applying...";
    try {
      const targetUserId = document.getElementById("permissionUserSelect").value;
      if (!targetUserId) {
        throw new Error("Load staff permissions first.");
      }
      const confirmed = await AdminLayout.confirmAction(
        "Apply selected action permissions for this staff account?",
        { title: "Confirm Permissions Update", confirmLabel: "Apply", cancelLabel: "Cancel" },
      );
      if (!confirmed) {
        AdminLayout.setStatus("Permission update canceled.", "helper");
        return;
      }
      AdminLayout.setStatus("Applying permissions...", "helper");
      const permissions = collectPermissionPayload();
      const patchResponse = await AdminCore.api(`/api/admin/staff/${encodeURIComponent(targetUserId)}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      });
      const verifyResponse = await AdminCore.api(`/api/admin/staff/${encodeURIComponent(targetUserId)}/permissions`);
      const verified = verifyResponse.data?.permissions || {};
      const mismatches = (verifyResponse.data?.actions || []).filter(
        (action) => Boolean(permissions[action]) !== Boolean(verified[action]),
      );
      if (mismatches.length) {
        throw new Error(`Permission save mismatch detected: ${mismatches.join(", ")}`);
      }
      loadedPermissionUserId = targetUserId;
      renderPermissionGrid(verifyResponse.data?.actions || [], verified);
      await loadStaff();
      AdminLayout.setStatus(
        `Permissions saved. Allowed actions: ${patchResponse.data?.allowedCount ?? "updated"}.`,
        "success",
      );
      await AdminLayout.notifyAction("Staff action permissions updated.", {
        title: "Permissions Applied",
      });
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
      await AdminLayout.notifyAction(`Permission update failed: ${error.message}`, {
        title: "Permissions Update Failed",
      });
    } finally {
      saveButton.textContent = initialLabel;
      saveButton.disabled = false;
    }
  });

  await loadStaff();
  await loadPermissionsForSelectedUser();
})();
