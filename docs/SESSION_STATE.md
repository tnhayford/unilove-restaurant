# Session State

Last updated: 2026-02-27

## Mission

Secure and reliable restaurant operations from order to delivery.

## Current Focus

- Keep architecture and performance work incremental and test-backed.

## Open Items

- Monitor live performance after recent backend/frontend optimizations.
- Continue SQLite -> PostgreSQL runtime migration planning.

## Decisions Log

- Keep durable job orchestration enabled for background tasks.
- Use SSE push with polling fallback for reliability.

## How to Resume Safely

1. Read this file.
2. Read the latest snapshot path from `data/session-snapshots/LATEST`.
3. Run `git status` and `git log --oneline -n 10`.
4. Run tests before new edits.

## Snapshot Commands

- Manual snapshot: `scripts/snapshot_state.sh`
- Manual snapshot + working tree diff snippets: `scripts/snapshot_state.sh --with-diff`

Post-commit hook also writes a snapshot automatically to `data/session-snapshots/`.
