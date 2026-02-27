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
  const type = document.getElementById("typeFilter").value.trim();
  if (searchText) params.set("searchText", searchText);
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  return `?${params.toString()}`;
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("disputeBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="order-meta">No disputes.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(new Date(`${row.created_at}Z`).toLocaleString())}</td>
      <td>${e(row.status)}</td>
      <td>${e(row.dispute_type)}</td>
      <td>${e(row.order_number || "-")}</td>
      <td>${e(row.customer_phone)}</td>
      <td>${row.amount_cedis === null || row.amount_cedis === undefined ? "-" : `GHS ${AdminCore.money(row.amount_cedis)}`}</td>
      <td>${e(row.notes)}<br /><span class="order-meta">By: ${e(row.created_by_email || "-")}${row.resolved_by_email ? ` | Resolved by: ${e(row.resolved_by_email)}` : ""}</span></td>
      <td>
        <div style="display:flex; gap:6px; align-items:center;">
          <select data-id="${e(row.id)}" class="select dispute-status-select" style="min-width:120px;">
            <option value="open" ${row.status === "open" ? "selected" : ""}>Open</option>
            <option value="review" ${row.status === "review" ? "selected" : ""}>Review</option>
            <option value="resolved" ${row.status === "resolved" ? "selected" : ""}>Resolved</option>
            <option value="rejected" ${row.status === "rejected" ? "selected" : ""}>Rejected</option>
          </select>
          <button type="button" class="btn btn-sm primary dispute-apply-btn" data-id="${row.id}">Apply</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll(".dispute-apply-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const select = body.querySelector(`.dispute-status-select[data-id="${btn.dataset.id}"]`);
      const nextStatus = select ? select.value : "";
      if (!nextStatus) return;
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Set dispute status to "${nextStatus}"?`,
          { title: "Confirm Dispute Update" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/disputes/${encodeURIComponent(btn.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
        await AdminLayout.notifyAction("Dispute status updated.", {
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
  const payload = await AdminCore.api(`/api/admin/disputes${query()}`);
  const data = payload.data || { rows: [], total: 0 };
  totalRows = Number(data.total || 0);
  renderRows(data.rows || []);
  renderPagination();
}

async function createDispute() {
  const customerPhone = document.getElementById("customerPhone").value.trim();
  const orderId = document.getElementById("orderId").value.trim() || undefined;
  const disputeType = document.getElementById("disputeType").value.trim();
  const amountCedis = document.getElementById("amountCedis").value
    ? Number(document.getElementById("amountCedis").value)
    : undefined;
  const notes = document.getElementById("notes").value.trim();

  const confirmed = await AdminLayout.confirmAction(
    `Create dispute for ${customerPhone}?`,
    { title: "Confirm Dispute Creation", confirmLabel: "Create" },
  );
  if (!confirmed) return;

  await AdminCore.api("/api/admin/disputes", {
    method: "POST",
    body: JSON.stringify({
      customerPhone,
      orderId,
      disputeType,
      amountCedis,
      notes,
    }),
  });

  ["customerPhone", "orderId", "disputeType", "amountCedis", "notes"].forEach((id) => {
    document.getElementById(id).value = "";
  });

  AdminLayout.setStatus("Dispute created.", "success");
  await AdminLayout.notifyAction("Dispute created successfully.", {
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
      AdminLayout.setStatus("Disputes refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("createDisputeBtn").addEventListener("click", async () => {
    try {
      await createDispute();
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  ["searchInput", "statusFilter", "typeFilter"].forEach((id) => {
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
