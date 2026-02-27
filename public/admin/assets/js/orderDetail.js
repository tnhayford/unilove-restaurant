const ACTION_TO_STATUS = {
  START_PROCESSING: { status: "PREPARING", label: "Start Processing" },
  MARK_READY_PICKUP: { status: "READY_FOR_PICKUP", label: "Mark Ready for Pickup" },
  DISPATCH_ORDER: { status: "OUT_FOR_DELIVERY", label: "Dispatch Order" },
  COMPLETE_PICKUP: { status: "DELIVERED", label: "Complete Pickup" },
  MARK_RETURNED: { status: "RETURNED", label: "Mark Returned" },
  ISSUE_REFUND: { status: "REFUNDED", label: "Issue Refund" },
  CANCEL_ORDER: { status: "CANCELED", label: "Cancel Order" },
};

let ORDER_POLICY = {
  cancelReasons: [],
  refundPolicy: [],
};

function getOrderId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(`${timestamp}Z`).toLocaleString();
}

function renderItems(items) {
  const e = AdminCore.escapeHtml;
  const tbody = document.getElementById("itemRows");
  tbody.innerHTML = "";

  if (!items || !items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="order-meta">No items found.</td>';
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e(item.item_name_snapshot || item.itemName)}</td>
      <td>${item.quantity}</td>
      <td>GHS ${AdminCore.money(item.unit_price_cedis || item.unitPrice)}</td>
      <td>GHS ${AdminCore.money(item.line_total_cedis || item.lineTotal)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSummary(order) {
  const e = AdminCore.escapeHtml;
  document.getElementById("orderHeading").textContent =
    `${order.order_number || AdminCore.shortId(order.id)} - ${order.stageLabel || order.status}`;
  document.getElementById("orderMeta").textContent =
    `${order.full_name} | ${order.delivery_type} | ${order.source || "online"}`;

  const summaryBody = document.getElementById("orderSummary");
  summaryBody.innerHTML = "";

  const rows = [
    ["Order Number", order.order_number || AdminCore.shortId(order.id)],
    ["Customer", order.full_name],
    ["Phone", order.phone],
    ["Status", order.status],
    ["Stage", order.stageLabel || order.status],
    ["Delivery Type", order.delivery_type],
    ["Source", order.source || "online"],
    ["Address", order.address || "N/A"],
    ["Cancel Reason", order.cancel_reason || "N/A"],
    ["Subtotal", `GHS ${AdminCore.money(order.subtotal_cedis)}`],
    ["Age", `${order.ageMinutes || 0} minutes`],
    ["Created", formatDate(order.created_at)],
    ["Updated", formatDate(order.updated_at)],
  ];

  rows.forEach(([label, value]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${e(label)}</th><td>${e(value)}</td>`;
    summaryBody.appendChild(tr);
  });

  const earned = Number(order.loyalty_points_issued || 0);
  const total = Number(order.loyaltyBalance?.totalPoints || 0);
  document.getElementById("loyaltySummary").innerHTML =
    `<strong>Loyalty:</strong> Earned on this order: <strong>${earned}</strong> points, ` +
    `Customer total: <strong>${total}</strong> points.`;

  const policyHint = document.getElementById("policyHint");
  if (policyHint) {
    const isPaidCanceled = order.status === "CANCELED" && Boolean(order.payment_confirmed_at);
    policyHint.textContent = isPaidCanceled
      ? "This canceled order is paid. Refund can be issued from this page."
      : "";
  }
}

function renderActions(order, refreshFn) {
  const e = AdminCore.escapeHtml;
  const container = document.getElementById("actions");
  container.innerHTML = "";

  const actions = order.availableActions || [];
  if (!actions.length) {
    container.innerHTML = '<div class="helper">No standard actions available for this stage.</div>';
  }

  actions.forEach((action) => {
    const config = ACTION_TO_STATUS[action];
    if (!config) return;
    const cancelReasonRequired = action === "CANCEL_ORDER";

    const row = document.createElement("div");
    row.className = "action-row";
    row.innerHTML = `
      <div class="action-label">${config.label}</div>
      <div class="action-controls">
        ${
          cancelReasonRequired
            ? `<select class="select" data-role="cancel-reason">
                <option value="">Select reason</option>
                ${(ORDER_POLICY.cancelReasons || [])
                  .map((reason) => `<option value="${e(reason)}">${e(reason)}</option>`)
                  .join("")}
              </select>`
            : ""
        }
        <button class="btn primary btn-sm" data-role="apply">Apply</button>
      </div>
    `;

    row.querySelector('[data-role="apply"]').addEventListener("click", async () => {
      try {
        const payload = { status: config.status };
        if (cancelReasonRequired) {
          const cancelReason = row.querySelector('[data-role="cancel-reason"]').value.trim();
          if (!cancelReason) {
            AdminLayout.setStatus("Cancel reason is required.", "error");
            return;
          }
          payload.cancelReason = cancelReason;
        }

        const confirmed = await AdminLayout.confirmAction(
          `Apply "${config.label}" to order ${order.order_number || order.id}?`,
          { title: "Confirm Order Update" },
        );
        if (!confirmed) return;

        await AdminCore.api(`/api/admin/orders/${order.id}/status`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });

        AdminLayout.setStatus(`${config.label} applied.`, "success");
        await AdminLayout.notifyAction(`${config.label} applied successfully.`, {
          title: "Order Updated",
        });
        await refreshFn();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    container.appendChild(row);
  });

  const showDeliveryRecovery =
    order.delivery_type === "delivery" &&
    ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(order.status);

  if (showDeliveryRecovery) {
    const recoveryTitle = document.createElement("div");
    recoveryTitle.className = "action-label";
    recoveryTitle.style.marginTop = "12px";
    recoveryTitle.textContent = "Delivery Recovery (Admin)";
    container.appendChild(recoveryTitle);

    const recoveryRow = document.createElement("div");
    recoveryRow.className = "action-row";
    recoveryRow.innerHTML = `
      <div class="action-controls">
        <button class="btn btn-sm" data-role="reset-attempts">Reset OTP Attempts</button>
        <button class="btn btn-sm" data-role="regen-otp">Regenerate OTP</button>
        <button class="btn danger btn-sm" data-role="force-complete">Force Complete</button>
      </div>
    `;

    recoveryRow.querySelector('[data-role="reset-attempts"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Reset OTP attempts for ${order.order_number || order.id}?`,
          { title: "Reset OTP Attempts" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/orders/${order.id}/delivery/reset-attempts`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        AdminLayout.setStatus("OTP attempts reset.", "success");
        await refreshFn();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    recoveryRow.querySelector('[data-role="regen-otp"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Regenerate delivery OTP for ${order.order_number || order.id}?`,
          { title: "Regenerate OTP" },
        );
        if (!confirmed) return;
        const response = await AdminCore.api(`/api/admin/orders/${order.id}/delivery/regenerate-code`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        if (response?.data?.sent === false) {
          AdminLayout.setStatus(
            "OTP regeneration skipped because OTP SMS is disabled in operations policy.",
            "helper",
          );
        } else {
          AdminLayout.setStatus("New OTP generated and sent.", "success");
        }
        await refreshFn();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    recoveryRow.querySelector('[data-role="force-complete"]').addEventListener("click", async () => {
      try {
        const confirmed = await AdminLayout.confirmAction(
          `Force complete ${order.order_number || order.id} as DELIVERED?`,
          { title: "Force Complete Order" },
        );
        if (!confirmed) return;
        await AdminCore.api(`/api/admin/orders/${order.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "DELIVERED" }),
        });
        AdminLayout.setStatus("Order manually completed.", "success");
        await refreshFn();
      } catch (error) {
        AdminLayout.setStatus(error.message, "error");
      }
    });

    container.appendChild(recoveryRow);
  }
}

async function markAsMonitored(orderId) {
  try {
    await AdminCore.api(`/api/admin/orders/${orderId}/monitor`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (_) {
    // Non-blocking.
  }
}

(async function initOrderDetailPage() {
  await AdminLayout.initProtectedPage();

  const orderId = getOrderId();
  if (!orderId) {
    AdminLayout.setStatus("Missing order id in URL.", "error");
    return;
  }

  async function loadOrder() {
    const payload = await AdminCore.api(`/api/admin/orders/${orderId}`);
    const order = payload.data;
    renderSummary(order);
    renderItems(order.items || []);
    renderActions(order, loadOrder);
  }

  async function loadPolicy() {
    try {
      const payload = await AdminCore.api("/api/admin/orders/policy");
      ORDER_POLICY = payload.data || ORDER_POLICY;
    } catch (_) {
      ORDER_POLICY = {
        cancelReasons: ["Other operational reason"],
        refundPolicy: [],
      };
    }
  }

  document.getElementById("backBtn").addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = document.getElementById("backBtn").dataset.fallback;
  });

  await loadPolicy();
  await markAsMonitored(orderId);
  await loadOrder();
})();
