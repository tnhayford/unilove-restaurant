# Restaurant Ops Platform - Current System Baseline

Last verified against code: 2026-02-12

This repository is a local-first restaurant operations platform with admin web UI, rider web UI scaffold, payment callbacks, loyalty issuance, and receipt generation.

This file is the canonical high-level baseline. If any other document conflicts with `docs/03_SECURITY_REQUIREMENTS.md`, the security document takes priority.

## Baseline Lock

Future prompts should extend and optimize this baseline. They should not re-architect or remove working flows unless explicitly requested.

## What Is Implemented

- Public ordering for `online` and `ussd` channels
- In-store order capture for `cash` and `momo`
- Short order numbers (`R00001`, `R00002`, ...)
- Order tracking by short order number
- Hubtel callback ingestion with signature verification
- Status-check reconciliation endpoint and optional background reconciliation job
- Durable job orchestration for scheduled background tasks (DB-backed queue + lease lock)
- Delivery verification with hashed 6-digit codes and attempt limit
- Loyalty issuance and revocation rules
- Receipt HTML generation and static hosting under `/receipts`
- Admin multi-page UI (login, operations, history, detail, menu, analytics, settings, in-store)
- Incoming-order sound alert loop until monitoring action is taken
- Rider queue API plus mobile-first rider web UI scaffold
- Server-Sent Events (SSE) streams for admin ops and customer tracking updates

## UI Surfaces

Admin pages:

- `/admin` (redirects to login)
- `/admin/login.html`
- `/admin/operations.html`
- `/admin/order-history.html`
- `/admin/order-detail.html?id=<orderId>`
- `/admin/menu.html`
- `/admin/analytics.html`
- `/admin/loyalty.html`
- `/admin/instore.html`
- `/admin/settings.html`

Rider page:

- `/rider/index.html`

Receipts:

- `/receipts/<order-number>.html`

## Order Lifecycle

Statuses:

- `PENDING_PAYMENT`
- `PAYMENT_FAILED`
- `PAID`
- `PREPARING`
- `OUT_FOR_DELIVERY`
- `READY_FOR_PICKUP`
- `DELIVERED`
- `RETURNED`
- `REFUNDED`
- `CANCELED`

Operations board lanes:

- `Exceptions` (`RETURNED`, `REFUNDED`, `PAYMENT_FAILED`, `CANCELED`, `PENDING_PAYMENT`)
- `Incoming Orders` (`PAID`)
- `Kitchen Queue` (`PREPARING`)
- `Ready / Dispatch` (`READY_FOR_PICKUP`, `OUT_FOR_DELIVERY`)
- `Completed` (`DELIVERED`)

## In-Store Payment Behavior

- `cash`: order goes to `PAID`, then immediately to `PREPARING`
- `momo`: prompt is initiated; order remains pending until callback confirms payment; confirmed payment for in-store automatically advances to `PREPARING`

## API Summary

Public API:

- `GET /api/health`
- `GET /api/menu`
- `POST /api/orders`
- `GET /api/orders/track/:orderNumber`
- `GET /api/orders/track/:orderNumber/stream`
- `POST /api/ussd/interaction`
- `POST /api/payments/hubtel/callback`
- `POST /api/delivery/verify`
- `GET /api/rider/queue`

Admin API:

- `GET /api/admin/auth/csrf-token`
- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`
- `GET /api/admin/orders`
- `GET /api/admin/events/ops-stream`
- `GET /api/admin/orders/history`
- `GET /api/admin/orders/:orderId`
- `POST /api/admin/orders/:orderId/monitor`
- `PATCH /api/admin/orders/:orderId/status`
- `POST /api/admin/orders/instore`
- `GET /api/admin/menu`
- `PATCH /api/admin/menu/:itemId/availability`
- `GET /api/admin/analytics`
- `GET /api/admin/loyalty`
- `GET /api/admin/payments/status-check/:clientReference`
- `POST /api/admin/payments/reconcile`
- `GET /api/admin/reports`
- `POST /api/admin/reports`
- `GET /api/admin/reports/:reportId`
- `GET /api/admin/reports/:reportId/download`
- `GET /api/admin/reports/schedules`
- `POST /api/admin/reports/schedules`
- `PATCH /api/admin/reports/schedules/:scheduleId`
- `DELETE /api/admin/reports/schedules/:scheduleId`

## Security Baseline (Implemented)

- `helmet()` enabled
- Global rate limit + auth rate limit
- Zod request validation on write paths
- Hubtel callback signature verification
- Admin JWT auth via `HttpOnly` cookie
- CSRF token issuance and enforcement for mutating admin requests
- Delivery codes hashed with bcrypt
- Audit logging for sensitive actions

## Quick Start

1. Copy `.env.example` to `.env`
2. Install dependencies: `npm install --include=dev`
3. Run setup: `npm run setup`
4. Start app: `npm run dev`
5. Open `http://localhost:4000/admin`

## Useful Commands

- `npm run migrate`
- `npm run seed:menu`
- `npm run seed:admin`
- `npm run setup`
- `npm run backdate:sample`
- `npm run simulate:incoming`
- `npm run db:export:postgres`
- `npm run snapshot:state`
- `npm test`

## Key Environment Variables

Required:

- `JWT_SECRET`
- `HUBTEL_CALLBACK_SECRET`

Hubtel payment/status:

- `HUBTEL_BASIC_AUTH` (recommended single credential for Hubtel payment, verification, and status APIs)
- `HUBTEL_POS_SALES_ID`
- `HUBTEL_TXN_STATUS_BASE_URL`
- `HUBTEL_TXN_STATUS_BASIC_AUTH` (optional override)
- `HUBTEL_RECEIVE_MONEY_BASE_URL`
- `HUBTEL_RECEIVE_MONEY_BASIC_AUTH` (optional override)
- `HUBTEL_RECEIVE_MONEY_CALLBACK_URL` (optional override)
- `HUBTEL_VERIFICATION_BASE_URL`
- `HUBTEL_VERIFICATION_BASIC_AUTH` (optional override)
- `ENABLE_MOMO_NAME_VERIFICATION` (`true` by default)

SMS:

- `HUBTEL_SMS_BASE_URL`
- `HUBTEL_SMS_CLIENT_ID`
- `HUBTEL_SMS_CLIENT_SECRET`
- `HUBTEL_SMS_FROM`

Other:

- `RIDER_APP_KEY` (optional but strongly recommended; when set, rider endpoints require `x-rider-key`)
- `ENABLE_STATUS_CHECK_JOB`
- `STATUS_CHECK_INTERVAL_MS`
- `ENABLE_REPORT_SCHEDULE_JOB`
- `REPORT_SCHEDULE_INTERVAL_MS`
- `ENABLE_DURABLE_JOB_ORCHESTRATOR`
- `DURABLE_JOB_DISPATCH_INTERVAL_MS`
- `DURABLE_JOB_EXECUTE_INTERVAL_MS`
- `DURABLE_JOB_LEASE_TTL_SECONDS`
- `ENABLE_REALTIME_SSE`
- `REALTIME_SSE_HEARTBEAT_MS`
- `REALTIME_SSE_MAX_CLIENTS`

## Documentation Index

- `docs/01_MVP_SCOPE.md`
- `docs/02_ARCHITECTURE_RULES.md`
- `docs/03_SECURITY_REQUIREMENTS.md`
- `docs/04_LOYALTY_POLICY.md`
- `docs/05_DELIVERY_GOVERNANCE.md`
- `docs/06_ANALYTICS_REQUIREMENTS.md`
- `docs/07_MENU_SEED_DATA.md`
- `docs/08_API_CONTRACTS.md`
- `docs/09_HUBTEL_VERIFICATION_DOCUMENTATIONS.md`
- `docs/10_IMPLEMENTATION_ROADMAP.md`
- `docs/11_SYSTEM_FLOWCHART.md`
- `docs/12_HETZNER_DEPLOYMENT_GUIDE.md`
- `docs/17_ARCHITECTURE_BACKLOG_REMEDIATION.md`
- `docs/SESSION_STATE.md`
