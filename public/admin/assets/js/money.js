function e(value) {
  return AdminCore.escapeHtml(value ?? "");
}

function renderChannelRows(rows) {
  const tbody = document.getElementById("moneyChannelsBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="order-meta">No channel data for today.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(row.source || "-")}</td>
      <td>${e(row.paymentMethod || "-")}</td>
      <td>${Number(row.ordersCount || 0)}</td>
      <td>GHS ${AdminCore.money(row.collectedAmountCedis)}</td>
      <td>GHS ${AdminCore.money(row.outstandingAmountCedis)}</td>
      <td>GHS ${AdminCore.money(row.grossAmountCedis)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCashierRows(rows) {
  const tbody = document.getElementById("moneyCashierBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="order-meta">No cashier data for today.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(row.cashier || "Unassigned")}</td>
      <td>${Number(row.ordersCount || 0)}</td>
      <td>GHS ${AdminCore.money(row.collectedAmountCedis)}</td>
      <td>GHS ${AdminCore.money(row.outstandingAmountCedis)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function refreshMoney(showToast = false) {
  const payload = await AdminCore.api("/api/admin/money/summary");
  const data = payload?.data || {};
  const totals = data.totals || {};

  document.getElementById("moneyDate").textContent = `Date: ${data.date || "--"}`;
  document.getElementById("moneyCollectedValue").textContent = `GHS ${AdminCore.money(totals.collectedSalesCedis)}`;
  document.getElementById("moneyGrossValue").textContent = `GHS ${AdminCore.money(totals.grossSalesCedis)}`;
  document.getElementById("moneyOutstandingValue").textContent = `GHS ${AdminCore.money(totals.outstandingSalesCedis)}`;
  document.getElementById("moneyCodOutstandingValue").textContent = `GHS ${AdminCore.money(totals.codOutstandingCedis)}`;
  document.getElementById("moneyMomoPendingValue").textContent = `GHS ${AdminCore.money(totals.momoPendingCedis)}`;
  document.getElementById("moneyPaidOrdersValue").textContent = `${Number(totals.paidOrders || 0)} / ${Number(totals.totalOrders || 0)}`;

  renderChannelRows(data.channels || []);
  renderCashierRows(data.cashierBreakdown || []);

  const statusEl = document.getElementById("moneyStatusText");
  if (statusEl) {
    statusEl.textContent = `Loaded ${Number(totals.totalOrders || 0)} orders for today.`;
  }

  if (showToast) {
    AdminLayout.setStatus("Money dashboard refreshed.", "success");
  }
}

(async function initMoneyPage() {
  await AdminLayout.initProtectedPage();

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = backBtn.dataset.fallback || "/admin/operations.html";
    });
  }

  document.getElementById("moneyRefreshBtn")?.addEventListener("click", async () => {
    try {
      await refreshMoney(true);
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  });

  await refreshMoney(false);
})();
