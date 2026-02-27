# MVP Scope (Current Baseline)

Last verified against code: 2026-02-12

This document defines what is in scope right now. It is not a future wish-list.

If any scope item conflicts with `docs/03_SECURITY_REQUIREMENTS.md`, security requirements override scope.

## In Scope and Implemented

- Public order creation (`online`)
- USSD conversational ordering and tracking
- In-store admin order taking (cash and momo)
- Hubtel callback processing for payment state updates
- Order lifecycle management from admin operations and order detail views
- Order history page with filters and reconciliation action
- Menu availability management by category and item
- Analytics dashboard with filterable SQL metrics
- Loyalty issuance and reversal rules
- Delivery code generation and verification flow
- Receipt generation and static receipt hosting
- Admin settings for alert tone/volume/interval and auto-refresh
- Rider queue API and rider mobile-web scaffold

## In Scope but Environment-Dependent

- Live Hubtel Receive Money prompt dispatch
- Live Hubtel SMS delivery
- Live Hubtel transaction status checks
- Scheduled reconciliation job

## Explicitly Out of Scope (Current Baseline)

- Loyalty redemption/voucher conversion
- Promotions/coupon engine
- Inventory stock management
- Multi-branch tenancy
- GPS live map tracking
- Native mobile apps (admin/rider)
- WhatsApp bot and social channels

## Scope Lock Rule

Future prompts should treat this as baseline reality and build on top of it. Scope replacement requires explicit user instruction.
