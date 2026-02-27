# Delivery Governance (Current Implementation)

Last verified against code: 2026-02-12

## Delivery Code Policy

- Delivery code is a random 6-digit numeric value.
- Plain code is never persisted.
- Stored value is bcrypt hash.
- Code generation applies only to `delivery` orders.

## Generation Trigger

- Code is generated when admin moves a delivery order to `OUT_FOR_DELIVERY`.
- Customer is notified via SMS with the code when SMS credentials are configured.

## Verification Rules

- Endpoint: `POST /api/delivery/verify`
- Required fields: `orderId`, `code`, `riderId`
- Order must be in `OUT_FOR_DELIVERY`.
- Maximum attempts: `3`
- On successful verification, order transitions to `DELIVERED`.
- Exceeded attempts return rate-limit style failure and are audit logged.

## Returned Order Rules

- `RETURNED` transition requires `riderId`.
- Returned orders are treated as exceptions.
- Loyalty reversal occurs on returned/refunded path.

## Rider Surface

- Rider queue source: `GET /api/rider/queue`
- Rider interface: `/rider/index.html`
- Rider workflow: fetch queue, select order, submit delivery code verification

## Governance Rule

Delivery completion must remain proof-based (verification code), not blind manual completion for delivery orders.
