# Security Requirements (Priority Document)

Last verified against code: 2026-02-12

This is the highest-priority requirements document. In any conflict, this file wins.

## Mandatory Controls

- Secrets must come from environment variables; no hardcoded secrets.
- Hubtel callbacks must pass signature verification before processing.
- Helmet must remain enabled.
- Global rate limiting must remain enabled.
- Auth-specific rate limiting must remain enabled.
- Request validation is required on write endpoints.
- Admin authentication must use JWT in HttpOnly cookie.
- CSRF checks are required for mutating admin routes.
- Delivery verification codes must be hashed at rest.
- Sensitive actions must be audit logged.

## Implemented Controls (Current)

- `helmet()` middleware at app bootstrap.
- App-wide request limiter plus auth-route limiter.
- Zod payload validation for public/admin mutating routes.
- HMAC signature verification (`x-hubtel-signature`/`x-signature`) for callbacks.
- `admin_token` HttpOnly auth cookie.
- CSRF token issue endpoint and header+cookie comparison enforcement.
- bcrypt hashing for delivery verification codes.
- Audit events for status changes, menu availability changes, reconciliation failures, callback processing, and security-relevant actions.

## Rider Endpoint Access Rule

- `GET /api/rider/queue` accepts optional app-key protection.
- When `RIDER_APP_KEY` is set, request must include matching `x-rider-key` or receive `401`.

## Operational Security Rules

- Do not log raw secrets.
- Do not weaken cookie protections without explicit request.
- Do not skip callback verification even in local development.
- Security controls may be extended, not bypassed.
