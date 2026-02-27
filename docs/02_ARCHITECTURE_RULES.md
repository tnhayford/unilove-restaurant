# Architecture Rules (Current Baseline)

Last verified against code: 2026-02-12

If any architecture choice conflicts with security controls, follow `docs/03_SECURITY_REQUIREMENTS.md`.

## Layering Rules

- Controllers orchestrate request/response only.
- Services own business behavior, status transitions, and side effects.
- Repositories own SQL/DB access only.
- Controllers must not execute direct SQL.

## Domain Authority Rules

- Order status transitions must go through service-level transition checks.
- Delivery-type guardrails are service enforced (`pickup` cannot go dispatch, `delivery` cannot go ready-for-pickup).
- Loyalty issuance/reversal is triggered from order-service status transitions.
- Receipt generation and payment-confirmation SMS are triggered during payment confirmation flow.

## Integration Boundaries

- Hubtel callback normalization and processing lives in `paymentService`.
- Callback signature validation occurs before callback processing.
- Receive-money request handling is isolated in `receiveMoneyService`.
- SMS integration is isolated in `smsService`.

## Frontend Structure Rules

- Admin UI is split into separate pages by function.
- Login flow remains separate from operations pages.
- Rider UI remains isolated under `/rider`.
- Cross-page concerns (theme, auth checks, CSRF, API helper) stay in shared admin core/layout scripts.

## Data and Schema Rules

- Database changes are migration-driven.
- Delivery codes are hashed only.
- Sensitive events require audit logging.
- Menu seed data remains source-controlled and reproducible.

## Change Rule

When implementing new work, extend these layers and boundaries instead of bypassing them.
