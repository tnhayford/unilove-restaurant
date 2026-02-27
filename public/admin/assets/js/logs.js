let currentOffset = 0;
const pageSize = 10;
let lastTotal = 0;

function getTotalPages() {
  return Math.max(1, Math.ceil(lastTotal / pageSize));
}

function getCurrentPage() {
  return Math.floor(currentOffset / pageSize) + 1;
}

function safeJson(value) {
  if (!value) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(`${value}Z`);
  return date.toLocaleString();
}

function getSummary(row) {
  if (row.log_type === "security" || row.action) {
    const actor = row.actor_email || row.actor_id || "-";
    const entity = `${row.entity_type || "-"}:${row.entity_id || "-"}`;
    return `${row.action || "-"} | ${row.actor_type || "-"}:${actor} | ${entity}`;
  }
  if (row.log_type === "sms" || row.to_phone) {
    return `${row.status || "-"} | ${row.to_phone || "-"}`;
  }
  if (row.log_type === "money" || row.client_reference) {
    return `${row.status || "-"} | ${row.order_number || row.order_id || "-"}`;
  }
  if (row.log_type === "errors" || row.level) {
    return `${row.level || "ERROR"} | ${row.method || "-"} ${row.route || "-"}`;
  }
  return "-";
}

function getType(row) {
  if (row.log_type) return row.log_type.toUpperCase();
  if (row.action) return "SECURITY";
  if (row.to_phone) return "SMS";
  if (row.client_reference) return "MONEY";
  if (row.level) return "ERROR";
  return "LOG";
}

function getDetails(row) {
  if (row.log_type === "security" || row.details) return safeJson(row.details);
  if (row.log_type === "sms" || row.message) return `${row.message || ""} ${safeJson(row.raw_payload)}`;
  if (row.log_type === "money" || row.response_code) {
    return `Ref:${row.client_reference || "-"} RC:${row.response_code || "-"} Amount:${row.amount || "-"}`;
  }
  if (row.log_type === "errors" || row.stack) return `${row.message || "-"} ${row.stack || ""}`.trim();
  return safeJson(row);
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("logsBody");
  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="order-meta">No logs found.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(formatTimestamp(row.created_at))}</td>
      <td>${e(getType(row))}</td>
      <td>${e(getSummary(row))}</td>
      <td><span class="order-meta">${e(getDetails(row))}</span></td>
    `;
    body.appendChild(tr);
  });
}

function updatePaginationUi() {
  const currentPage = getCurrentPage();
  const totalPages = getTotalPages();
  const start = lastTotal === 0 ? 0 : currentOffset + 1;
  const end = Math.min(currentOffset + pageSize, lastTotal);

  document.getElementById("paginationMeta").textContent =
    `Page ${currentPage} of ${totalPages} | Showing ${start}-${end} of ${lastTotal}`;
  const pageInput = document.getElementById("pageJumpInput");
  if (pageInput) {
    pageInput.value = String(currentPage);
    pageInput.max = String(totalPages);
  }
  document.getElementById("prevPageBtn").disabled = currentOffset <= 0;
  document.getElementById("nextPageBtn").disabled = currentOffset + pageSize >= lastTotal;
  renderPageButtons();
}

function renderPageButtons() {
  const container = document.getElementById("pageNumbers");
  if (!container) return;

  const currentPage = getCurrentPage();
  const totalPages = getTotalPages();
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  container.innerHTML = "";
  for (let page = start; page <= end; page += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${page === currentPage ? "primary" : ""}`;
    button.textContent = String(page);
    button.addEventListener("click", () => {
      goToPage(page).catch((error) => AdminLayout.setStatus(error.message, "error"));
    });
    container.appendChild(button);
  }
}

function toggleSecurityActionFilter() {
  const type = document.getElementById("logTypeFilter").value;
  const wrap = document.getElementById("securityActionFilter").closest("div");
  wrap.style.display = type === "security" || type === "all" ? "" : "none";
}

async function fetchLogs() {
  const type = document.getElementById("logTypeFilter").value;
  const action = document.getElementById("securityActionFilter").value;
  const searchText = document.getElementById("searchInput").value.trim();

  const params = new URLSearchParams({
    type,
    limit: String(pageSize),
    offset: String(currentOffset),
  });
  if (searchText) params.set("searchText", searchText);
  if (action) params.set("action", action);

  const response = await AdminCore.api(`/api/admin/logs?${params.toString()}`);
  const rows = response.data?.rows || [];
  lastTotal = Number(response.data?.total || 0);
  renderRows(rows);
  updatePaginationUi();
  AdminLayout.setStatus(`Loaded ${rows.length} logs for current page.`, "helper");
}

async function goToPageOffset(offset) {
  currentOffset = Math.max(0, offset);
  await fetchLogs();
}

async function goToPage(pageNumber) {
  const page = Math.max(1, Math.min(Number(pageNumber) || 1, getTotalPages()));
  await goToPageOffset((page - 1) * pageSize);
}

(async function initLogsPage() {
  await AdminLayout.initProtectedPage();
  toggleSecurityActionFilter();

  const backBtn = document.getElementById("backBtn");
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = backBtn.dataset.fallback;
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    try {
      await goToPageOffset(0);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("prevPageBtn").addEventListener("click", async () => {
    try {
      await goToPageOffset(currentOffset - pageSize);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("nextPageBtn").addEventListener("click", async () => {
    try {
      await goToPageOffset(currentOffset + pageSize);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("pageJumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = document.getElementById("pageJumpInput").value;
    try {
      await goToPage(value);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("logTypeFilter").addEventListener("change", async () => {
    toggleSecurityActionFilter();
    try {
      await goToPageOffset(0);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("securityActionFilter").addEventListener("change", async () => {
    try {
      await goToPageOffset(0);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("searchInput").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    try {
      await goToPageOffset(0);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  await fetchLogs();

  setInterval(async () => {
    try {
      await fetchLogs();
    } catch (_) {
      // best-effort live logs refresh
    }
  }, 15000);
})();
