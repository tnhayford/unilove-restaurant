let currentPage = 1;
const pageSize = 20;
let totalRows = 0;

function totalPages() {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function toDate(value) {
  if (!value) return "-";
  return new Date(`${value}Z`).toLocaleString();
}

function pointsLabel(points) {
  const value = Number(points || 0);
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function buildQuery() {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((currentPage - 1) * pageSize),
  });

  const startDate = document.getElementById("loyaltyStartDate").value;
  const endDate = document.getElementById("loyaltyEndDate").value;
  const source = document.getElementById("loyaltySource").value;
  const deliveryType = document.getElementById("loyaltyDeliveryType").value;
  const reason = document.getElementById("loyaltyReason").value;
  const searchText = document.getElementById("loyaltySearchText").value.trim();

  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (source) params.set("source", source);
  if (deliveryType) params.set("deliveryType", deliveryType);
  if (reason) params.set("reason", reason);
  if (searchText) params.set("searchText", searchText);

  return `?${params.toString()}`;
}

function renderSummary(summary = {}) {
  document.getElementById("issuedPointsValue").textContent = String(Number(summary.issuedPoints || 0));
  document.getElementById("reversedPointsValue").textContent = String(Number(summary.reversedPoints || 0));
  document.getElementById("netPointsValue").textContent = String(Number(summary.netPoints || 0));
  document.getElementById("reversalRateValue").textContent = `${Number(summary.reversalRate || 0).toFixed(2)}%`;
  document.getElementById("rewardedOrdersValue").textContent = String(Number(summary.rewardedOrders || 0));
  document.getElementById("reversedOrdersValue").textContent = String(Number(summary.reversedOrders || 0));
}

function renderLedger(rows = []) {
  const e = AdminCore.escapeHtml;
  const body = document.getElementById("loyaltyLedgerBody");
  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="order-meta">No loyalty ledger entries for this filter.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(toDate(row.created_at))}</td>
      <td>${e(row.order_number || "-")}</td>
      <td>${e(row.full_name || "-")}<br /><span class="order-meta">${e(row.phone || "-")}</span></td>
      <td>${e(row.source || "-")}</td>
      <td>${e(row.delivery_type || "-")}</td>
      <td>${e(row.reason || "-")}</td>
      <td>${e(pointsLabel(row.points))}</td>
    `;
    body.appendChild(tr);
  });
}

function renderPagination() {
  const pages = totalPages();
  document.getElementById("loyaltyPaginationMeta").textContent = `Page ${currentPage} of ${pages} | Total ${totalRows}`;
  document.getElementById("loyaltyPrevBtn").disabled = currentPage <= 1;
  document.getElementById("loyaltyNextBtn").disabled = currentPage >= pages;
  document.getElementById("loyaltyPageInput").value = String(currentPage);
  document.getElementById("loyaltyPageInput").max = String(pages);

  const holder = document.getElementById("loyaltyPageNumbers");
  holder.innerHTML = "";
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pages, currentPage + 2);

  for (let page = start; page <= end; page += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn ${page === currentPage ? "primary" : ""}`;
    btn.textContent = String(page);
    btn.addEventListener("click", async () => {
      currentPage = page;
      await refreshLoyalty(false);
    });
    holder.appendChild(btn);
  }
}

async function refreshLoyalty(showStatus = true) {
  const payload = await AdminCore.api(`/api/admin/loyalty${buildQuery()}`);
  const data = payload.data || {};
  renderSummary(data.summary || {});
  renderLedger(data.ledger || []);
  totalRows = Number(data.total || 0);
  renderPagination();
  if (showStatus) {
    AdminLayout.setStatus("Loyalty data refreshed.", "success");
  }
}

function resetFilters() {
  [
    "loyaltySearchText",
    "loyaltyReason",
    "loyaltySource",
    "loyaltyDeliveryType",
    "loyaltyStartDate",
    "loyaltyEndDate",
  ].forEach((id) => {
    const element = document.getElementById(id);
    element.value = "";
  });
  currentPage = 1;
}

(async function initLoyaltyPage() {
  await AdminLayout.initProtectedPage();

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

  document.getElementById("applyFiltersBtn").addEventListener("click", async () => {
    try {
      currentPage = 1;
      await refreshLoyalty(false);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("resetFiltersBtn").addEventListener("click", async () => {
    try {
      resetFilters();
      await refreshLoyalty(false);
      AdminLayout.setStatus("Loyalty filters reset.", "success");
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("refreshLoyaltyBtn").addEventListener("click", async () => {
    try {
      await refreshLoyalty(true);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  document.getElementById("loyaltyPrevBtn").addEventListener("click", async () => {
    currentPage = Math.max(1, currentPage - 1);
    await refreshLoyalty(false);
  });

  document.getElementById("loyaltyNextBtn").addEventListener("click", async () => {
    currentPage = Math.min(totalPages(), currentPage + 1);
    await refreshLoyalty(false);
  });

  document.getElementById("loyaltyPageJumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    currentPage = Math.max(
      1,
      Math.min(Number(document.getElementById("loyaltyPageInput").value || 1), totalPages()),
    );
    await refreshLoyalty(false);
  });

  document.getElementById("loyaltySearchText").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    currentPage = 1;
    await refreshLoyalty(false);
  });

  await refreshLoyalty(false);
})();
