let currentPage = 1;
const pageSize = 10;
let totalRows = 0;

function totalPages() {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function query() {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((currentPage - 1) * pageSize),
  });
  const searchText = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("statusFilter").value;
  const severity = document.getElementById("severityFilter").value;
  if (searchText) params.set("searchText", searchText);
  if (status) params.set("status", status);
  if (severity) params.set("severity", severity);
  return `?${params.toString()}`;
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("incidentBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="order-meta">No incidents.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(new Date(`${row.created_at}Z`).toLocaleString())}</td>
      <td>${e(row.severity)}</td>
      <td>${e(row.status)}</td>
      <td>${e(row.title)}<br /><span class="order-meta">${e(row.summary)}</span><br /><span class="order-meta">By: ${e(row.created_by_email || "-")}</span></td>
      <td>${e(row.category)}</td>
      <td>${e(row.order_number || "-")}</td>
      <td>${e(row.owner_email || "-")}</td>
      <td>
        <div style="display:flex; gap:6px; align-items:center;">
          <select data-id="${e(row.id)}" class="select incident-status-select" style="min-width:120px;">
            <option value="open" ${row.status === "open" ? "selected" : ""}>Open</option>
            <option value="investigating" ${row.status === "investigating" ? "selected" : ""}>Investigating</option>
            <option value="resolved" ${row.status === "resolved" ? "selected" : ""}>Resolved</option>
          </select>
          <button type="button" class="btn btn-sm primary incident-apply-btn" data-id="${row.id}">Apply</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll(".incident-apply-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const select = body.querySelector(`.incident-status-select[data-id="${btn.dataset.id}"]`);
      const nextStatus = select ? select.value : "";
      if (!nextStatus) return;
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Set incident status to "${nextStatus}"?`,
          { title: "Confirm Incident Update" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/incidents/${encodeURIComponent(btn.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
        await AdminLayout.notifyAction("Incident status updated.", {
          title: "Update Applied",
        });
        await refresh();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });
  });
}

function renderPagination() {
  const pages = totalPages();
  document.getElementById("paginationMeta").textContent = `Page ${currentPage} of ${pages} | Total ${totalRows}`;
  document.getElementById("prevBtn").disabled = currentPage <= 1;
  document.getElementById("nextBtn").disabled = currentPage >= pages;
  document.getElementById("pageInput").value = String(currentPage);
  document.getElementById("pageInput").max = String(pages);

  const holder = document.getElementById("pageNumbers");
  holder.innerHTML = "";
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pages, currentPage + 2);
  for (let p = start; p <= end; p += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${p === currentPage ? "primary" : ""}`;
    btn.textContent = String(p);
    btn.addEventListener("click", async () => {
      currentPage = p;
      await refresh();
    });
    holder.appendChild(btn);
  }
}

async function refresh() {
  const payload = await AdminCore.api(`/api/admin/incidents${query()}`);
  const data = payload.data || { rows: [], total: 0 };
  totalRows = Number(data.total || 0);
  renderRows(data.rows || []);
  renderPagination();
}

async function createIncident() {
  const title = document.getElementById("incidentTitle").value.trim();
  const severity = document.getElementById("incidentSeverity").value;
  const category = document.getElementById("incidentCategory").value.trim();
  const summary = document.getElementById("incidentSummary").value.trim();
  const orderId = document.getElementById("incidentOrderId").value.trim() || undefined;

  const confirmed = await AdminLayout.confirmAction(
    `Create ${severity} incident "${title}"?`,
    { title: "Confirm Incident Creation", confirmLabel: "Create" },
  );
  if (!confirmed) return;

  await AdminCore.api("/api/admin/incidents", {
    method: "POST",
    body: JSON.stringify({
      title,
      severity,
      category,
      summary,
      orderId,
    }),
  });

  document.getElementById("incidentTitle").value = "";
  document.getElementById("incidentCategory").value = "";
  document.getElementById("incidentSummary").value = "";
  document.getElementById("incidentOrderId").value = "";
  AdminLayout.setStatus("Incident created.", "success");
  await AdminLayout.notifyAction("Incident created successfully.", {
    title: "Update Applied",
  });
  currentPage = 1;
  await refresh();
}

(async function init() {
  await AdminLayout.initProtectedPage();

  document.getElementById("backBtn").addEventListener("click", () => {
    if (window.history.length > 1) return window.history.back();
    window.location.href = document.getElementById("backBtn").dataset.fallback;
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try {
      await refresh();
      AdminLayout.setStatus("Incidents refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("createIncidentBtn").addEventListener("click", async () => {
    try {
      await createIncident();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  ["searchInput", "statusFilter", "severityFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", async () => {
      currentPage = 1;
      await refresh();
    });
    document.getElementById(id).addEventListener("change", async () => {
      currentPage = 1;
      await refresh();
    });
  });

  document.getElementById("prevBtn").addEventListener("click", async () => {
    currentPage = Math.max(1, currentPage - 1);
    await refresh();
  });

  document.getElementById("nextBtn").addEventListener("click", async () => {
    currentPage = Math.min(totalPages(), currentPage + 1);
    await refresh();
  });

  document.getElementById("pageJumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    currentPage = Math.max(1, Math.min(Number(document.getElementById("pageInput").value || 1), totalPages()));
    await refresh();
  });

  await refresh();
})();
