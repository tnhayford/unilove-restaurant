# Architecture Backlog Remediation

Last updated: 2026-02-27

This document closes three architectural backlog items:

1. Durable/distributed job orchestration
2. SQLite to PostgreSQL migration path
3. Real-time push architecture (SSE) for admin and customer tracking views

## 1) Durable Job Orchestration

Implemented components:

- `job_schedules`, `job_runs`, and `distributed_locks` tables
- `src/repositories/jobOrchestratorRepository.js`
- `src/services/jobOrchestratorService.js`
- `src/server.js` startup now uses durable orchestrator instead of in-process job intervals

Behavior:

- One dispatcher acquires a distributed lease lock before enqueuing due tasks.
- Workers claim queued jobs in a write transaction.
- Stale running jobs are recovered automatically.
- Completed/failed job history is purged periodically.

Configured through:

- `ENABLE_DURABLE_JOB_ORCHESTRATOR`
- `DURABLE_JOB_DISPATCH_INTERVAL_MS`
- `DURABLE_JOB_EXECUTE_INTERVAL_MS`
- `DURABLE_JOB_LEASE_TTL_SECONDS`

## 2) SQLite -> PostgreSQL Migration Path

Use:

- `npm run db:export:postgres`

This creates a migration bundle under:

- `data/postgres-migration/<timestamp>/`

Bundle contents:

- `schema.sql` (PostgreSQL table/index DDL generated from SQLite metadata)
- `data/*.csv` (per-table CSV exports)
- `import.sql` (psql script for schema + CSV import)
- `verify_counts.sql` (post-import row-count checks)
- `manifest.json` (audit summary: row counts, load order, paths)
- `README.md` (quick import steps)

Recommended cutover workflow:

1. Announce write freeze.
2. Run `npm run db:export:postgres`.
3. Import into empty PostgreSQL target: `psql "$DATABASE_URL" -f import.sql`.
4. Run `verify_counts.sql`.
5. Smoke test core flows before DNS/traffic switch.

## 3) Real-Time Push (SSE)

Server-side:

- `src/services/realtimeEventService.js`
- `src/controllers/realtimeController.js`

Endpoints:

- Customer tracking stream:
  - `GET /api/orders/track/:orderNumber/stream?token=...`
- Admin operations stream:
  - `GET /api/admin/events/ops-stream`

Client integrations:

- `public/customer/track.js`
  - uses EventSource when available
  - falls back to polling on stream failure
- `public/admin/assets/js/operations.js`
  - consumes ops stream events
  - switches polling to health-check interval while stream is connected

SSE configuration:

- `ENABLE_REALTIME_SSE`
- `REALTIME_SSE_HEARTBEAT_MS`
- `REALTIME_SSE_MAX_CLIENTS`

## Operational Notes

- SSE is currently in-process pub/sub. For multi-node scale, move event distribution to Redis/NATS and keep SSE gateways stateless.
- SQLite remains the runtime DB until full PostgreSQL runtime switch is planned and tested.
