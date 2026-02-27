#!/usr/bin/env bash
set -euo pipefail

enabled="$(git config --bool hooks.autopush || echo false)"
if [[ "$enabled" != "true" ]]; then
  exit 0
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  exit 0
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  exit 0
fi

if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  if ! git push; then
    echo "[git-autopush][warn] Auto-push failed. Commit is saved locally." >&2
  fi
else
  if ! git push -u origin "$branch"; then
    echo "[git-autopush][warn] Auto-push failed (no upstream). Commit is saved locally." >&2
  fi
fi
