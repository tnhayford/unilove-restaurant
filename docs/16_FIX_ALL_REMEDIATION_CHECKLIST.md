# Fix-All Remediation Checklist (Live)

Last updated: 2026-02-13
Project: `unilove-restaurant`

Status legend:
- `TODO`: Not started
- `IN_PROGRESS`: Currently being worked on
- `BLOCKED`: Waiting for a decision/input
- `DONE`: Implemented and verified

## Execution TODO (Live)

- [x] ~~R9: Encrypt in-store offline queue payloads at rest~~
- [x] ~~R10: Upgrade report generation quality (full dataset PDF pagination)~~
- [x] ~~R11: Add report scheduling (DB + API + job + admin UI)~~
- [x] ~~R13: Add integration tests for hardened routes/flows~~
- [x] ~~R14: Build Loyalty Ops dashboard (API + admin page + filters + pagination)~~
- [x] ~~R15: Full button UX hierarchy audit and corrective styling pass~~
- [x] ~~R16: Stabilize sidebar UX (canonical nav grouping + sticky panel + dark sidebar in light mode)~~
- [x] ~~R17: Fix staff permission-to-page mapping and report-ready popup spam~~
- [x] ~~R18: Add SPA-style admin sidebar navigation shell (persistent left pane)~~
- [x] ~~R19: Harden SPA navigation against hangs + fix false offline queueing for non-network MoMo failures~~
- [x] ~~R20: Make staff permission updates verifiable, durable, and fully auditable~~
- [x] ~~R21: Reliability mode fallback (disable SPA nav interception) + direct permission apply flow~~
- [x] ~~R22: Add explicit permission update requested logs + restore apply confirmation UX~~
- [x] ~~R23: Replace fragile modal confirmation on permission apply with native confirm + hard error alert~~
- [x] ~~R1: Final DOM XSS sweep and close remaining render gaps~~
- [x] ~~R12: Final documentation sync and checklist reconciliation~~

## Decision Log (Required Before Some Fixes)

| ID | Decision | Status | Notes |
|---|---|---|---|
| D1 | Store model = single store, internet exposed for USSD/payment flows | DONE | Confirmed by owner (2026-02-13). |
| D2 | Rider app access model (public page vs access-controlled page) | DONE | Owner selected private access-controlled model (2026-02-13). |
| D3 | Receipt links public shareability | DONE | Keep publicly shareable (2026-02-13). |

## Master Remediation Board

| ID | Area | Task | Priority | Status | Evidence/Files |
|---|---|---|---|---|---|
| R1 | Frontend security | Eliminate DOM XSS in admin/rider pages by replacing unsafe `innerHTML` patterns with safe rendering/escaping helpers | Critical | DONE | Completed final sweep and escaped all user-influenced render paths. |
| R2 | Rider security | Enforce auth on rider queue endpoint regardless of env defaults | Critical | DONE | `src/middleware/auth.js`, `src/routes/publicRoutes.js`, `src/controllers/riderController.js` |
| R3 | Delivery security | Protect `/api/delivery/verify` with rider auth/session model (depends on D2) | Critical | DONE | `src/routes/publicRoutes.js` |
| R4 | Data exposure | Restrict/replace `GET /api/orders/:orderId` public endpoint to prevent order PII leakage | Critical | DONE | `src/routes/publicRoutes.js` |
| R5 | Receipt safety | Keep public shareability but reduce receipt PII and add non-guessable access token strategy | Critical | DONE | `src/services/receiptService.js` |
| R6 | Concurrency | Hard-fix order number generation race under concurrent creates | High | DONE | `src/db/connection.js`, `src/services/orderService.js`, `src/repositories/orderRepository.js` |
| R7 | Transaction model | Remove request-level transaction contention risks on shared SQLite connection | High | DONE | `src/db/connection.js`, `src/services/orderService.js` |
| R8 | Secrets posture | Remove insecure default admin password fallback behavior in runtime config/seed flow | High | DONE | `src/config/env.js`, `src/db/seedAdmin.js` |
| R9 | Offline queue privacy | Encrypt or minimize PII stored in browser offline queue | Medium | DONE | `public/admin/assets/js/instore.js` |
| R10 | Report quality | Replace minimal PDF writer with production-ready report output and complete dataset rendering | Medium | DONE | `src/services/reportService.js` |
| R11 | Report ops | Add scheduled report generation and delivery workflow | Medium | DONE | `src/services/reportService.js`, `src/repositories/reportScheduleRepository.js`, `src/jobs/reportScheduleJob.js`, admin reports UI/API |
| R12 | Documentation hygiene | Sync real-life checklist statuses with actual implementation state | Medium | DONE | `docs/08_API_CONTRACTS.md`, `docs/15_REAL_LIFE_ISSUES_CHECKLIST.md`, `README.md`, `.env.example` |
| R13 | Test coverage | Add API/integration tests for auth, payment callback, rider flows, and status transitions | Medium | DONE | `tests/securityHardening.integration.test.js` |
| R14 | Loyalty operations | Add loyalty admin monitoring API/page (summary + ledger + filters + paging) | Medium | DONE | `src/controllers/loyaltyController.js`, `src/services/loyaltyOpsService.js`, `src/repositories/loyaltyRepository.js`, `src/routes/adminRoutes.js`, `public/admin/loyalty.html`, `public/admin/assets/js/loyalty.js` |
| R15 | UX consistency | Audit buttons across admin/rider pages and fix action emphasis inconsistencies | Low | DONE | `public/admin/reports.html`, `public/admin/menu.html`, `public/rider/index.html` |
| R16 | Admin UX | Stabilize sidebar rendering and apply dark-sidebar visual language in light mode | Medium | DONE | `public/admin/assets/js/layout.js`, `public/admin/assets/css/admin.css` |
| R17 | Access + notifications | Align page access with effective permissions and persist report-ready acknowledgements | Medium | DONE | `src/middleware/permissions.js`, `src/routes/adminRoutes.js`, `src/services/permissionService.js`, `public/admin/assets/js/staff.js`, `public/admin/assets/js/settings.js`, `public/admin/assets/js/reports.js` |
| R18 | Navigation architecture | Add SPA-style sidebar navigation with content swap and history support to keep left pane persistent | Medium | DONE | `public/admin/assets/js/layout.js` |
| R19 | Stability + in-store reliability | Add shell navigation timeout/cleanup and queue offline only for true network failures | Medium | DONE | `public/admin/assets/js/layout.js`, `public/admin/assets/js/instore.js` |
| R20 | Access governance | Ensure staff permission save survives reload/login, auto-load selected user permissions, and log save/normalization/failure actions | Medium | DONE | `src/services/permissionService.js`, `src/controllers/staffController.js`, `public/admin/assets/js/staff.js`, `public/admin/logs.html`, `public/admin/assets/js/logs.js` |
| R21 | UX reliability | Disable shell SPA interception until stable and remove modal friction on permission apply clicks | Medium | DONE | `public/admin/assets/js/layout.js`, `public/admin/assets/js/staff.js` |
| R22 | Permission observability | Log permission update requests and restore visible apply confirmation/status feedback | Medium | DONE | `src/controllers/staffController.js`, `public/admin/assets/js/staff.js`, `public/admin/logs.html` |
| R23 | Permission UX resilience | Use native confirm/alert for permission apply path to avoid custom modal deadlocks | Medium | DONE | `public/admin/assets/js/staff.js` |

## Page-Level Hardening Checklist

- [ ] `public/admin/login.html`: MFA-ready flow hooks, stronger auth error telemetry
- [ ] `public/admin/operations.html`: secure rendering + ownership/assignment workflow
- [ ] `public/admin/order-detail.html`: secure rendering + stronger refund guardrails
- [ ] `public/admin/order-history.html`: secure rendering for all row fields
- [ ] `public/admin/instore.html`: secure rendering + privacy-safe offline queue
- [ ] `public/admin/menu.html`: secure rendering for category/item names
- [ ] `public/admin/staff.html`: secure rendering for names/emails and permission labels
- [ ] `public/admin/analytics.html`: secure rendering for all metrics labels/data
- [x] ~~`public/admin/loyalty.html`: secure rendering for loyalty summary and ledger rows~~
- [ ] `public/admin/sla.html`: secure rendering for SLA row content
- [ ] `public/admin/incidents.html`: secure rendering for title/summary/category
- [ ] `public/admin/disputes.html`: secure rendering for notes/type/status rows
- [ ] `public/admin/reports.html`: secure rendering and stable download UX
- [ ] `public/admin/logs.html`: secure rendering and controlled stack/details display
- [ ] `public/admin/settings.html`: preserve secure control mutations
- [ ] `public/rider/index.html`: secure rendering + auth/session enforcement (depends on D2)

## Operational Checklist (What Must Work End-to-End)

- [ ] Public menu browsing works while store open/closed states are correctly enforced
- [ ] Online order create flow remains idempotent and race-safe
- [ ] USSD flow still works over internet with secure callback handling
- [ ] Hubtel callback signature validation remains enforced
- [ ] Status reconciliation works without exposing sensitive data
- [ ] Admin auth + CSRF + permissions still work after hardening
- [ ] Rider queue/verification works under chosen D2 model
- [ ] Public shareable receipts remain accessible, but with safer data exposure
- [ ] Logs and audits remain complete for incident review
- [ ] New and updated tests pass locally and in CI

## Live Progress Log

| Date | Item | Update |
|---|---|---|
| 2026-02-13 | Checklist created | Baseline remediation plan created from full-system critique. |
| 2026-02-13 | D1 | Confirmed single-store internet-exposed model. |
| 2026-02-13 | D3 | Confirmed receipt links must remain publicly shareable. |
| 2026-02-13 | D2 | Owner selected private rider-access model. |
| 2026-02-13 | R2/R3/R4 | Rider and delivery endpoints locked with mandatory rider key. Public order-by-id route removed. |
| 2026-02-13 | R5 | Receipt links now include non-guessable token suffix; customer name/phone are masked. |
| 2026-02-13 | R6/R7 | Order creation wrapped in serialized write transaction queue with `BEGIN IMMEDIATE`. |
| 2026-02-13 | R8 | Removed insecure admin password fallback and enforced password requirement in seed flow. |
| 2026-02-13 | R1 | High-risk admin/rider rendering paths patched with HTML escaping helpers; full sweep completed. |
| 2026-02-13 | R9 | In-store offline queue now uses encrypted storage-at-rest with compatibility handling. |
| 2026-02-13 | R10 | Report PDF generator upgraded to full-dataset paginated output with metadata header. |
| 2026-02-13 | R11 | Added scheduled reports (DB model, API, background runner, and admin UI controls). |
| 2026-02-13 | R13 | Added integration tests for rider key enforcement, removed public order-id route, and callback signature rejection. |
| 2026-02-13 | R14 | Added loyalty operations dashboard with API filters, KPI summary, ledger table, and pagination. |
| 2026-02-13 | R15 | Completed button hierarchy pass and fixed key CTA emphasis issues in reports/menu/rider UI. |
| 2026-02-13 | R15 validation | Static audit confirmed no missing `getElementById` button targets except layout-injected modal controls. |
| 2026-02-13 | R16 | Sidebar now uses canonical grouped nav rendering with sticky panel and dark visual palette in light mode. |
| 2026-02-13 | R17 | Added permission dependency normalization and fixed persistent report-ready popup spam for old completed jobs. |
| 2026-02-13 | R18 | Sidebar links now navigate via shell content swap with history support and interval cleanup between pages. |
| 2026-02-13 | R19 | Added 12s SPA navigation timeout + timeout cleanup, and stopped offline queueing on non-network API errors (e.g., Hubtel 403). |
| 2026-02-13 | R20 | Permission writes now use serialized transaction helper, save action verifies persisted values, and permission audit failures are logged. |
| 2026-02-13 | R21 | Temporarily disabled SPA nav interception for stability and removed confirm modal from permission apply action. |
| 2026-02-13 | R22 | Restored permission apply confirmation popup and added explicit `...UPDATE_REQUESTED` security logs before write attempts. |
| 2026-02-13 | R23 | Switched permission apply confirmation to native browser confirm and failure alert for deterministic operator feedback. |
