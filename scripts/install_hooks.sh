#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[install-hooks] Run this inside a Git repository."
  exit 1
fi

git config core.hooksPath .githooks
chmod +x \
  .githooks/pre-commit \
  .githooks/post-commit \
  scripts/mission_guard.sh \
  scripts/git_autopush.sh

echo "[install-hooks] Hooks installed."
echo "[install-hooks] pre-commit: mission drift + impact analysis"
echo "[install-hooks] post-commit: last commit impact analysis + optional auto-push"
echo "[install-hooks] Enable auto-push: git config hooks.autopush true"
