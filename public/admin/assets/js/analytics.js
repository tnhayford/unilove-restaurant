function renderBars(containerId, rows, labelKey, valueKey, suffix = "") {
  const e = AdminCore.escapeHtml;
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!rows || !rows.length) {
    container.innerHTML = '<div class="order-meta">No data available.</div>';
    return;
  }

  const maxValue = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  for (const row of rows) {
    const value = Number(row[valueKey] || 0);
    const width = Math.max(3, (value / maxValue) * 100);

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.innerHTML = `
      <div>${e(row[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      <div>${value.toFixed(2)}${suffix}</div>
    `;
    container.appendChild(bar);
  }
}

function renderTopItems(rows) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("topItemsBody");
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="3" class="order-meta">No item sales yet.</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${e(row.item)}</td><td>${row.quantity}</td><td>GHS ${AdminCore.money(row.revenue)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderBreakdownRows(containerId, rows, firstKey, secondKey) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById(containerId);
  tbody.innerHTML = "";
  if (!rows || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="2" class="order-meta">No data.</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${e(row[firstKey])}</td><td>${e(row[secondKey])}</td>`;
    tbody.appendChild(tr);
  });
}

function renderMoneyBuckets(rows) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("moneyBucketsBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="order-meta">No money channel data.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(row.label || row.key || "-")}</td>
      <td>${Number(row.ordersCount || 0)}</td>
      <td>GHS ${AdminCore.money(row.collectedAmount)}</td>
      <td>GHS ${AdminCore.money(row.outstandingAmount)}</td>
      <td>GHS ${AdminCore.money(row.grossAmount)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCodByRider(rows) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("codRiderBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="order-meta">No COD rider data.</td></tr>';
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(row.rider_name || row.rider_id || "Unassigned")}</td>
      <td>${Number(row.cod_orders || 0)}</td>
      <td>GHS ${AdminCore.money(row.cod_collected)}</td>
      <td>GHS ${AdminCore.money(row.cod_outstanding)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildAnalyticsQuery() {
  const params = new URLSearchParams();
  const startDate = document.getElementById("analyticsStartDate").value;
  const endDate = document.getElementById("analyticsEndDate").value;
  const source = document.getElementById("analyticsSource").value;
  const deliveryType = document.getElementById("analyticsDeliveryType").value;

  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (source) params.set("source", source);
  if (deliveryType) params.set("deliveryType", deliveryType);

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function refreshAnalytics() {
  const payload = await AdminCore.api(`/api/admin/analytics${buildAnalyticsQuery()}`);
  const data = payload.data || {};
  const statusRows = data.statusBreakdown || [];
  const totalOrders = statusRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const completedOrders = statusRows
    .filter((row) => row.status === "DELIVERED")
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
  const canceledOrders = statusRows
    .filter((row) => row.status === "CANCELED")
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
  const refundedOrders = statusRows
    .filter((row) => row.status === "REFUNDED")
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
  const paidLifecycleOrders = statusRows
    .filter((row) =>
      ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "REFUNDED"].includes(
        row.status,
      ),
    )
    .reduce((sum, row) => sum + Number(row.count || 0), 0);

  document.getElementById("aovValue").textContent = `GHS ${AdminCore.money(data.averageOrderValue)}`;
  document.getElementById("deliveryRateValue").textContent = `${Number(data.deliverySuccessRate || 0).toFixed(2)}%`;
  document.getElementById("totalOrdersValue").textContent = `${totalOrders}`;
  document.getElementById("completedOrdersValue").textContent = `${completedOrders}`;

  const dailyTotal = (data.dailyRevenue || []).reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  document.getElementById("dailyTotalValue").textContent = `GHS ${AdminCore.money(dailyTotal)}`;

  const loyaltyTotal = (data.loyaltyIssuedPerDay || []).reduce(
    (sum, row) => sum + Number(row.loyalty_points_issued || 0),
    0,
  );
  document.getElementById("loyaltyTotalValue").textContent = `${loyaltyTotal}`;

  const counts = data.operationalCounts || {};
  document.getElementById("delayedCountValue").textContent = `${counts.delayed_count || 0}`;
  document.getElementById("paymentIssueValue").textContent = `${counts.payment_issue_count || 0}`;
  const exceptionRate =
    totalOrders > 0 ? ((Number(counts.payment_issue_count || 0) / totalOrders) * 100).toFixed(2) : "0.00";
  document.getElementById("exceptionRateValue").textContent = `${exceptionRate}%`;
  const loyaltyPerOrder =
    totalOrders > 0 ? (loyaltyTotal / totalOrders).toFixed(2) : "0.00";
  document.getElementById("loyaltyPerOrderValue").textContent = loyaltyPerOrder;
  const cancelRate = totalOrders > 0 ? ((canceledOrders / totalOrders) * 100).toFixed(2) : "0.00";
  document.getElementById("cancelRateValue").textContent = `${cancelRate}%`;
  const refundRate = totalOrders > 0 ? ((refundedOrders / totalOrders) * 100).toFixed(2) : "0.00";
  document.getElementById("refundRateValue").textContent = `${refundRate}%`;
  const paymentConversion =
    totalOrders > 0 ? ((paidLifecycleOrders / totalOrders) * 100).toFixed(2) : "0.00";
  document.getElementById("paymentConversionValue").textContent = `${paymentConversion}%`;

  const moneySummary = data.moneyLocationSummary || {};
  const moneyBuckets = data.moneyBuckets || [];
  const codByRider = data.codCollectionByRider || [];
  const codOutstandingTotal = codByRider.reduce((sum, row) => sum + Number(row.cod_outstanding || 0), 0);
  document.getElementById("collectedMoneyValue").textContent = `GHS ${AdminCore.money(moneySummary.collectedTotal)}`;
  document.getElementById("outstandingMoneyValue").textContent = `GHS ${AdminCore.money(moneySummary.outstandingTotal)}`;
  document.getElementById("refundedMoneyValue").textContent = `GHS ${AdminCore.money(moneySummary.refundedTotal)}`;
  document.getElementById("codOutstandingValue").textContent = `GHS ${AdminCore.money(codOutstandingTotal)}`;

  renderBars("dailyRevenueChart", data.dailyRevenue || [], "day", "revenue");
  renderBars("monthlyRevenueChart", data.monthlyRevenue || [], "month", "revenue");
  renderBars("loyaltyChart", data.loyaltyIssuedPerDay || [], "day", "loyalty_points_issued");
  renderTopItems(data.topItems || []);
  renderMoneyBuckets(moneyBuckets);
  renderCodByRider(codByRider);

  renderBreakdownRows("statusBreakdownBody", statusRows, "status", "count");
  renderBreakdownRows("sourceBreakdownBody", data.sourceBreakdown || [], "source", "count");
}

(async function initAnalyticsPage() {
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

  const refresh = async (showToast = false) => {
    try {
      await refreshAnalytics();
      if (showToast) {
        AdminLayout.setStatus("Analytics refreshed.", "success");
      }
    } catch (error) {
      AdminLayout.setStatus(error.message, "error");
    }
  };

  document.getElementById("refreshAnalyticsBtn").addEventListener("click", async () => {
    await refresh(true);
  });

  ["analyticsStartDate", "analyticsEndDate", "analyticsSource", "analyticsDeliveryType"].forEach(
    (id) => {
      document.getElementById(id).addEventListener("change", () => refresh(false));
    },
  );

  await refresh(false);
})();
