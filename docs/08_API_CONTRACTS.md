# API Contracts (Current Baseline)

Last verified against code: 2026-02-12

All endpoints below reflect implemented behavior.

## Response Envelope

Most endpoints return one of:

- Success: `{ "data": ... }`
- Error: `{ "error": "message" }`

Special case:

- `GET /api/admin/auth/csrf-token` returns `{ "csrfToken": "..." }`
- `POST /api/ussd/interaction` returns Hubtel USSD response object (not wrapped in `data`)

## Public API

### `GET /api/health`

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-02-12T12:00:00.000Z"
}
```

### `GET /api/menu`

Returns active menu items.

### `POST /api/orders`

Body:

```json
{
  "phone": "233240000000",
  "fullName": "John Doe",
  "deliveryType": "pickup",
  "address": "Optional for pickup",
  "items": [
    { "itemId": "jollof-and-fried-chicken", "quantity": 1 }
  ]
}
```

Success (`201`):

```json
{
  "data": {
    "id": "uuid",
    "orderNumber": "R00044",
    "clientReference": "...",
    "status": "PENDING_PAYMENT",
    "subtotalCedis": 55,
    "items": []
  }
}
```

### `GET /api/orders/track/:orderNumber`

Returns tracking summary by short order number.

### `POST /api/ussd/interaction`

Request is validated Hubtel USSD payload. Response follows Hubtel programmable-services format with keys such as `SessionId`, `Type`, `Message`, and `ClientState`.

### `POST /api/payments/hubtel/callback`

Headers:

- `x-hubtel-signature` or `x-signature` (required)

Behavior:

- Verifies signature against raw body.
- Normalizes supported callback formats.
- Updates payment/order state.

Success (`202`):

```json
{
  "data": {
    "orderId": "uuid",
    "status": "PAID"
  }
}
```

### `POST /api/delivery/verify`

Body:

```json
{
  "orderId": "uuid",
  "code": "123456",
  "riderId": "rider-001"
}
```

Header:

- `x-rider-key` required.

Success response includes `success`, `attempts`, and `attemptsRemaining`.

### `GET /api/rider/queue`

Query:

- `limit` (optional, default `80`)

Header:

- `x-rider-key` required.

Returns out-for-delivery queue rows.

## Admin API

All admin mutating routes require:

- valid `admin_token` cookie
- valid CSRF header token

All admin read routes require auth cookie.

### Auth

- `GET /api/admin/auth/csrf-token`
- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`

### Orders

- `GET /api/admin/orders`
- `GET /api/admin/orders/history`
- `GET /api/admin/orders/:orderId`
- `POST /api/admin/orders/:orderId/monitor`
- `PATCH /api/admin/orders/:orderId/status`
- `POST /api/admin/orders/instore`

History query params:

- `startDate`, `endDate`
- `source`
- `deliveryType`
- `status`
- `delayedOnly` (`true|false`)
- `paymentIssueOnly` (`true|false`)
- `searchText`
- `limit`, `offset`

In-store create body:

```json
{
  "fullName": "Walk-In Customer",
  "phone": "233240000000",
  "deliveryType": "pickup",
  "address": "Required when deliveryType=delivery",
  "paymentMethod": "cash",
  "paymentChannel": "mtn-gh",
  "items": [
    { "itemId": "jollof-and-fried-chicken", "quantity": 1 }
  ]
}
```

Behavior notes:

- `cash` in-store orders move to kitchen immediately.
- `momo` in-store orders wait for callback confirmation.

### Menu

- `GET /api/admin/menu`
- `PATCH /api/admin/menu/:itemId/availability`

### Analytics

- `GET /api/admin/analytics`

Query params:

- `startDate`, `endDate`, `source`, `deliveryType`

### Loyalty Ops

- `GET /api/admin/loyalty`

Query params:

- `startDate`, `endDate`, `source`, `deliveryType`
- `reason` (`PAYMENT_CONFIRMED|RETURNED|REFUNDED`)
- `searchText`
- `limit`, `offset`

Success:

```json
{
  "data": {
    "summary": {
      "issuedPoints": 120,
      "reversedPoints": 15,
      "netPoints": 105,
      "rewardedOrders": 23,
      "reversedOrders": 2,
      "reversalRate": 12.5
    },
    "ledger": [],
    "total": 0
  }
}
```

### Payments

- `GET /api/admin/payments/status-check/:clientReference`
- `POST /api/admin/payments/reconcile`

### Reports

- `GET /api/admin/reports`
- `POST /api/admin/reports`
- `GET /api/admin/reports/:reportId`
- `GET /api/admin/reports/:reportId/download`

### Report Schedules

- `GET /api/admin/reports/schedules`
- `POST /api/admin/reports/schedules`
- `PATCH /api/admin/reports/schedules/:scheduleId`
- `DELETE /api/admin/reports/schedules/:scheduleId`

Schedule create payload:

```json
{
  "type": "orders",
  "format": "pdf",
  "frequency": "daily",
  "dayOfWeek": 1,
  "hourUtc": 2,
  "minuteUtc": 0,
  "startDate": "2026-02-01",
  "endDate": "2026-02-29"
}
```

Notes:
- `dayOfWeek` is required only when `frequency = weekly` (`0 = Sunday ... 6 = Saturday`).
- Schedule runner uses UTC time.

## Validation/Error Contract

- Invalid input returns `400` with `error` and optional `details` list.
- Unauthorized admin/rider access returns `401`.
- CSRF mismatch returns `403`.
