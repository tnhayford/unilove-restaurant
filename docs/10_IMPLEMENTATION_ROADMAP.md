# Implementation Roadmap (Current State + Forward Plan)

Last verified against code: 2026-02-12

This roadmap now reflects completed work first, then controlled next work. It is intentionally baseline-driven.

## Phase 0 - Foundation (Completed)

- Express app bootstrap with helmet, rate limits, cookie parsing, error handling
- SQLite database setup, migrations, seed scripts
- Environment-based configuration

## Phase 1 - Core Domain (Completed)

- Menu repository and menu seed source
- Customer upsert and order creation workflows
- Short order number generation (`Rxxxxx`)
- Order state machine with guarded transitions

## Phase 2 - Payments and Reliability (Completed)

- Hubtel callback signature verification
- Callback payload normalization across supported formats
- Payment callbacks persisted
- Pending payment reconciliation APIs
- Optional scheduled reconciliation job

## Phase 3 - Operations UX (Completed)

- Admin split-page UX:
  - login
  - operations
  - order detail
  - order history
  - menu management
  - analytics
  - settings
  - in-store order taking
- Operations lane structure and collapsible order cards
- Incoming-order alert loop until monitored
- Daily local reset for operations filters/search
- Back navigation button pattern on detail pages

## Phase 4 - In-Store + Delivery + Loyalty (Completed)

- In-store cart workflow from category menu cards
- Cash and momo payment paths
- Delivery code generation/verification governance
- Loyalty points issuance/revocation
- Receipt generation and receipt link support

## Phase 5 - Rider Surface (Completed as Web Scaffold)

- Rider queue API
- Rider mobile-web page for code verification workflow
- Optional rider app-key protection

## Phase 6 - Controlled Backlog (Next)

- Native Android wrapper/app for rider (current is web scaffold)
- Push notifications in addition to browser audio
- Richer analytics visualizations and export
- Role-based admin permissions
- Expanded automated integration tests (admin/rider/payment edge cases)

## Change Control Rule

Future tasks should continue from this baseline. Replacing major flows requires explicit user approval.
