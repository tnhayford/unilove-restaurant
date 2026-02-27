let currentPage = 1;
const pageSize = 10;
let totalRows = 0;

function toLocalDateTime(value) {
  if (!value) return "-";
  return new Date(`${value}Z`).toLocaleString();
}

function paymentMethodLabel(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "cash_on_delivery") return "Cash on delivery";
  if (token === "momo") return "MoMo";
  if (token === "cash") return "Cash";
  return token || "Unknown";
}

function paymentStatusLabel(value, paymentMethod) {
  const token = String(value || "").trim().toUpperCase();
  if (token === "PAID") return "Paid";
  if (token === "FAILED") return "Failed";
  if (String(paymentMethod || "").trim().toLowerCase() === "cash_on_delivery") {
    return "Collect on delivery";
  }
  return "Pending";
}

function getTotalPages() {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function buildQuery() {
  const params = new URLSearchParams();
  const fields = {
    searchText: document.getElementById("historySearch").value.trim(),
    startDate: document.getElementById("historyStartDate").value,
    endDate: document.getElementById("historyEndDate").value,
    source: document.getElementById("historySource").value,
    deliveryType: document.getElementById("historyDeliveryType").value,
    status: document.getElementById("historyStatus").value,
  };

  Object.entries(fields).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  if (document.getElementById("historyDelayedOnly").checked) {
    params.set("delayedOnly", "true");
  }
  if (document.getElementById("historyPaymentIssuesOnly").checked) {
    params.set("paymentIssueOnly", "true");
  }

  params.set("limit", String(pageSize));
  params.set("offset", String((currentPage - 1) * pageSize));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function renderRows(rows) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="9" class="order-meta">No orders match the current filter.</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((order) => {
    const tr = document.createElement("tr");
    if (order.isDelayed) {
      tr.classList.add("history-row-delayed");
    }
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${e(order.order_number)}</td>
      <td>${e(order.full_name)}<br /><span class="order-meta">${e(order.phone)}</span></td>
      <td>${e(order.source)}</td>
      <td>${e(order.delivery_type)}</td>
      <td>${e(order.status)}${order.cancel_reason ? `<br /><span class="order-meta">${e(order.cancel_reason)}</span>` : ""}</td>
      <td>${e(paymentMethodLabel(order.payment_method))}<br /><span class="order-meta">${e(paymentStatusLabel(order.payment_status, order.payment_method))}</span></td>
      <td>${order.ageMinutes || 0}m</td>
      <td>GHS ${AdminCore.money(order.subtotal_cedis)}</td>
      <td>${e(toLocalDateTime(order.created_at))}</td>
    `;

    tr.addEventListener("click", () => {
      window.location.href = `/admin/order-detail.html?id=${encodeURIComponent(order.id)}`;
    });
    tbody.appendChild(tr);
  });
}

function renderPageButtons() {
  const container = document.getElementById("historyPageNumbers");
  container.innerHTML = "";

  const totalPages = getTotalPages();
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

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

function updatePaginationUi() {
  const totalPages = getTotalPages();
  const start = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalRows);

  document.getElementById("historyPaginationMeta").textContent =
    `Page ${currentPage} of ${totalPages} | Showing ${start}-${end} of ${totalRows}`;
  document.getElementById("historyPrevBtn").disabled = currentPage <= 1;
  document.getElementById("historyNextBtn").disabled = currentPage >= totalPages;
  const pageInput = document.getElementById("historyPageInput");
  pageInput.value = String(currentPage);
  pageInput.max = String(totalPages);
  renderPageButtons();
}

async function refreshHistory() {
  const payload = await AdminCore.api(`/api/admin/orders/history${buildQuery()}`);
  const data = payload.data || {};
  totalRows = Number(data.total || 0);
  document.getElementById("historyTotal").textContent = String(totalRows);
  renderRows(data.rows || []);
  updatePaginationUi();
}

async function goToPage(page) {
  const safePage = Math.max(1, Math.min(Number(page) || 1, getTotalPages()));
  currentPage = safePage;
  await refreshHistory();
}

(async function initOrderHistoryPage() {
  await AdminLayout.initProtectedPage();
  AdminLayout.setStatus("Use filters to isolate delayed orders, failures, and channel-specific trends.", "helper");

  const refresh = async (showMessage = false) => {
    try {
      await refreshHistory();
      if (showMessage) {
        AdminLayout.setStatus("Order history refreshed.", "success");
      }
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  };

  document.getElementById("backBtn").addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = document.getElementById("backBtn").dataset.fallback;
  });

  document.getElementById("historyRefreshBtn").addEventListener("click", async () => {
    await refresh(true);
  });

  document.getElementById("reconcileBtn").addEventListener("click", async () => {
    try {
      const confirmed = await AdminLayout.confirmAction(
        "Run pending payment reconciliation now?",
        { title: "Confirm Reconciliation", confirmLabel: "Apply" },
      );
      if (!confirmed) return;
      const result = await AdminCore.api("/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = result.data;
      AdminLayout.setStatus(
        `Reconciled pending payments: checked ${data.checked}, processed ${data.processed}, paid ${data.paid}.`,
        "success",
      );
      await AdminLayout.notifyAction(
        `Reconciliation complete. Checked ${data.checked}, processed ${data.processed}, paid ${data.paid}.`,
        { title: "Update Applied" },
      );
      await refresh(false);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  ["historyStartDate", "historyEndDate", "historySource", "historyDeliveryType", "historyStatus", "historyDelayedOnly", "historyPaymentIssuesOnly"].forEach(
    (id) => {
      document.getElementById(id).addEventListener("change", () => {
        currentPage = 1;
        refresh(false);
      });
    },
  );

  let searchTimer;
  document.getElementById("historySearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      refresh(false);
    }, 250);
  });

  document.getElementById("historyPrevBtn").addEventListener("click", async () => {
    await goToPage(currentPage - 1);
  });

  document.getElementById("historyNextBtn").addEventListener("click", async () => {
    await goToPage(currentPage + 1);
  });

  document.getElementById("historyPageJumpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await goToPage(document.getElementById("historyPageInput").value);
  });

  await refresh(false);
})();
