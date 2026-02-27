const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");
const { getOrderById, getOrderItems } = require("../repositories/orderRepository");
const { getTotalLoyaltyBalance } = require("../repositories/loyaltyRepository");

const RECEIPT_DIR = path.resolve(process.cwd(), "data/receipts");
const RESTAURANT_PROFILE = {
  name: "Unilove Foods",
  address: "AK-569-4223, near Splendor Hostel, Ayeduase, Kumasi, Ghana",
  telephone: "0249933585",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}Z`);
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maskName(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "Customer";
  if (parts.length === 1) return `${parts[0].slice(0, 1)}***`;
  return `${parts[0]} ${parts[1].slice(0, 1)}***`;
}

function receiptTokenForOrder(order) {
  return crypto
    .createHash("sha256")
    .update(`${order.id}:${order.order_number}:${env.jwtSecret}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function buildReceiptHtml({ order, items, loyaltyEarned, loyaltyTotal }) {
  const transactionType = order.status === "REFUNDED" ? "Refund" : "Sale";
  const transactionClass = order.status === "REFUNDED" ? "refund" : "sale";
  const loyaltyRedeemed = Number(order.loyalty_points_redeemed || 0);
  const itemRows = (items || [])
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.item_name_snapshot || item.itemName)}</td>
        <td class="qty">${Number(item.quantity || 0)}</td>
        <td class="price">GHS ${formatMoney(item.unit_price_cedis || item.unitPrice)}</td>
        <td class="total">GHS ${formatMoney(item.line_total_cedis || item.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Receipt ${escapeHtml(order.order_number)}</title>
    <style>
      body {
        font-family:
          "Google Sans Text",
          "SF Pro Text",
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          Roboto,
          Arial,
          sans-serif;
        background: linear-gradient(180deg, #f4f6f9 0%, #eef2f7 100%);
        margin: 0;
        padding: 20px 14px;
        color: #111827;
      }
      .actions {
        max-width: 420px;
        margin: 0 auto 12px;
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      .btn {
        appearance: none;
        border: 1px solid #d8dde6;
        background: #fff;
        color: #111827;
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
      }
      .btn.primary {
        background: #0f62fe;
        color: #fff;
        border-color: #0f62fe;
      }
      .receipt {
        max-width: 420px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e6ebf2;
        border-radius: 22px;
        padding: 22px 20px 18px;
        box-shadow:
          0 20px 35px rgba(17, 24, 39, 0.08),
          0 4px 10px rgba(17, 24, 39, 0.04);
      }
      .center {
        text-align: center;
      }
      h1 {
        font-family:
          "Google Sans",
          "SF Pro Display",
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0;
      }
      .meta {
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
      }
      .brand-block {
        margin-top: 8px;
        padding: 0;
      }
      .address-line {
        margin-top: 4px;
        font-size: 14px;
        color: #475467;
        line-height: 1.45;
      }
      .phone-line {
        margin-top: 6px;
        font-size: 14px;
        color: #334155;
        font-weight: 600;
      }
      hr {
        border: none;
        border-top: 1px dashed #e2e8f0;
        margin: 15px 0;
      }
      .transaction-box {
        padding: 0;
      }
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .sale {
        background: #0f9d58;
        color: #fff;
      }
      .refund {
        background: #d93025;
        color: #fff;
      }
      .line {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 14px;
        margin-top: 6px;
        gap: 8px;
      }
      .line span {
        color: #667085;
      }
      .line strong {
        color: #111827;
        font-weight: 600;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th {
        text-align: left;
        color: #667085;
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.02em;
        padding-bottom: 7px;
      }
      td {
        padding: 9px 0;
        vertical-align: top;
        border-top: 1px solid #eef2f7;
      }
      .qty {
        text-align: center;
        width: 40px;
      }
      .price,
      .total {
        text-align: right;
        white-space: nowrap;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        font-size: 18px;
        font-weight: 650;
        margin-top: 13px;
        border-top: 1px solid #e9edf4;
        padding-top: 12px;
      }
      .loyalty {
        background: transparent;
        border: none;
        border-top: 1px dashed #e2e8f0;
        padding: 12px 0 0;
        margin-top: 14px;
        text-align: left;
      }
      .loyalty h3 {
        margin: 0;
        color: #2452a3;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
        text-transform: none;
      }
      .loyalty .points {
        font-size: 20px;
        font-weight: 600;
        margin: 8px 0 4px;
        color: #204594;
        letter-spacing: 0;
      }
      .loyalty .meta {
        color: #5470a6;
        font-size: 13px;
      }
      .loyalty .mini {
        margin-top: 4px;
        color: #34548e;
        font-size: 12px;
      }
      .thank-you {
        margin-top: 14px;
        text-align: center;
        font-size: 14px;
        color: #4b5563;
      }
      .footer {
        text-align: center;
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.45;
        color: #9aa3b2;
      }
      @media (max-width: 560px) {
        .receipt {
          padding: 20px 16px 16px;
          border-radius: 18px;
        }
        h1 {
          font-size: 23px;
        }
        .btn {
          width: 100%;
        }
      }
      @media print {
        body {
          padding: 0;
          background: #fff;
        }
        .actions {
          display: none !important;
        }
        .receipt {
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button class="btn primary" type="button" onclick="window.print()">Download PDF</button>
    </div>
    <div class="receipt">
      <div class="center">
        <h1>${escapeHtml(RESTAURANT_PROFILE.name)}</h1>
        <div class="brand-block">
          <div class="address-line">${escapeHtml(RESTAURANT_PROFILE.address)}</div>
          <div class="phone-line">Tel: ${escapeHtml(RESTAURANT_PROFILE.telephone)}</div>
        </div>
      </div>

      <hr />

      <div class="transaction-box">
        <span class="badge ${transactionClass}">${transactionType}</span>
        <div class="line"><span>Receipt:</span><strong>${escapeHtml(order.order_number)}</strong></div>
        <div class="line"><span>Date:</span><strong>${formatDate(order.payment_confirmed_at || order.created_at)}</strong></div>
        <div class="line"><span>Customer:</span><strong>${escapeHtml(maskName(order.full_name))}</strong></div>
        <div class="line"><span>Phone:</span><strong>${escapeHtml(order.phone)}</strong></div>
      </div>

      <hr />

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="qty">Qty</th>
            <th class="price">Unit</th>
            <th class="total">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="total-row">
        <span>Total</span>
        <span>GHS ${formatMoney(order.subtotal_cedis)}</span>
      </div>

      <div class="loyalty">
        <h3>Loyalty Points</h3>
        <div class="meta">Total points from all purchases</div>
        <div class="points">${Number(loyaltyTotal || 0)} pts</div>
        <div class="mini">
          Earned: ${Number(loyaltyEarned || 0)} pts · Redeemed: ${loyaltyRedeemed} pts
        </div>
      </div>

      <div class="thank-you">
        Thank you for ordering with <strong>${escapeHtml(RESTAURANT_PROFILE.name)}</strong>.
      </div>
      <div class="footer">
        <span style="opacity:0.85;">Powered by <strong>Iderwell</strong></span>
      </div>
    </div>
  </body>
</html>`;
}

async function generateAndStoreReceipt(orderId) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found for receipt generation"), {
      statusCode: 404,
    });
  }

  const [items, loyaltyTotal] = await Promise.all([
    getOrderItems(orderId),
    getTotalLoyaltyBalance(order.customer_id),
  ]);

  const loyaltyEarned = Number(order.loyalty_points_issued || 0);
  const token = receiptTokenForOrder(order);
  const fileName = `${order.order_number || order.id}-${token}.html`;
  const filePath = path.join(RECEIPT_DIR, fileName);

  await fs.mkdir(RECEIPT_DIR, { recursive: true });
  await fs.writeFile(
    filePath,
    buildReceiptHtml({ order, items, loyaltyEarned, loyaltyTotal }),
    "utf8",
  );

  const relativeUrl = `/receipts/${encodeURIComponent(fileName)}`;
  const absoluteUrl = `${String(env.publicBaseUrl).replace(/\/$/, "")}${relativeUrl}`;

  return {
    relativeUrl,
    absoluteUrl,
    loyaltyEarned,
    loyaltyTotal,
    filePath,
  };
}

module.exports = {
  generateAndStoreReceipt,
};
