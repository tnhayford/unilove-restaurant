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
  if (searchText) params.set("searchText", searchText);
  return `?${params.toString()}`;
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("slaBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="order-meta">No SLA breaches right now.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const target = Number(row.sla_target_minutes || 0);
    const age = Number(row.age_minutes || 0);
    const overrun = Math.max(0, age - target);
    const tr = document.createElement("tr");
    tr.className = "history-row-delayed";
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${e(row.order_number)}</td>
      <td>${e(row.full_name)}<br /><span class="order-meta">${e(row.phone)}</span></td>
      <td>${e(row.status)}</td>
      <td>${age}m</td>
      <td>${target}m</td>
      <td>${overrun}m</td>
      <td>${e(row.source)} / ${e(row.delivery_type)}</td>
      <td>GHS ${AdminCore.money(row.subtotal_cedis)}</td>
    `;
    tr.addEventListener("click", () => {
      window.location.href = `/admin/order-detail.html?id=${encodeURIComponent(row.id)}`;
    });
    body.appendChild(tr);
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

function renderConfig(config, total) {
  document.getElementById("pendingSla").textContent = `${config.pendingPaymentMinutes || 0}m`;
  document.getElementById("kitchenSla").textContent = `${config.kitchenMinutes || 0}m`;
  document.getElementById("deliverySla").textContent = `${config.deliveryMinutes || 0}m`;
  document.getElementById("breachCount").textContent = String(total || 0);
}

async function refresh() {
  const payload = await AdminCore.api(`/api/admin/sla${query()}`);
  const data = payload.data || { rows: [], total: 0, config: {} };
  totalRows = Number(data.total || 0);
  renderConfig(data.config || {}, totalRows);
  renderRows(data.rows || []);
  renderPagination();
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
      AdminLayout.setStatus("SLA dashboard refreshed.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("searchInput").addEventListener("input", async () => {
    currentPage = 1;
    await refresh();
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
