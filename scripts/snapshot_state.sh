#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[snapshot-state] Not inside a git repository."
  exit 1
fi

cd "$repo_root"

with_diff="false"
if [[ "${1:-}" == "--with-diff" ]]; then
  with_diff="true"
fi

snapshot_dir="$repo_root/data/session-snapshots"
mkdir -p "$snapshot_dir"

stamp="$(date -u +%Y%m%d-%H%M%SZ)"
snapshot_file="$snapshot_dir/$stamp.md"

branch="$(git branch --show-current || echo detached)"
head_commit="$(git rev-parse HEAD 2>/dev/null || echo none)"
head_subject="$(git log -1 --pretty=%s 2>/dev/null || echo none)"
status_short="$(git status --short || true)"
staged_stat="$(git diff --cached --stat || true)"
unstaged_stat="$(git diff --stat || true)"
recent_log="$(git log --oneline -n 8 || true)"

{
  echo "# Session Snapshot"
  echo
  echo "Generated (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Repository: $(basename "$repo_root")"
  echo "Branch: $branch"
  echo "HEAD: $head_commit"
  echo "HEAD Subject: $head_subject"
  echo
  echo "## Git Status (Short)"
  echo
  if [[ -n "$status_short" ]]; then
    printf '```\n%s\n```\n' "$status_short"
  else
    echo '```'
    echo "clean"
    echo '```'
  fi
  echo
  echo "## Staged Diff Stat"
  echo
  if [[ -n "$staged_stat" ]]; then
    printf '```\n%s\n```\n' "$staged_stat"
  else
    echo '```'
    echo "none"
    echo '```'
  fi
  echo
  echo "## Unstaged Diff Stat"
  echo
  if [[ -n "$unstaged_stat" ]]; then
    printf '```\n%s\n```\n' "$unstaged_stat"
  else
    echo '```'
    echo "none"
    echo '```'
  fi
  echo
  echo "## Recent Commits"
  echo
  printf '```\n%s\n```\n' "$recent_log"
} > "$snapshot_file"

if [[ "$with_diff" == "true" ]]; then
  {
    echo
    echo "## Unstaged Diff (Top 300 lines)"
    echo
    echo '```diff'
    git diff | sed -n '1,300p'
    echo '```'
    echo
    echo "## Staged Diff (Top 300 lines)"
    echo
    echo '```diff'
    git diff --cached | sed -n '1,300p'
    echo '```'
  } >> "$snapshot_file"
fi

latest_pointer="$snapshot_dir/LATEST"
printf '%s\n' "$snapshot_file" > "$latest_pointer"

echo "[snapshot-state] Wrote $snapshot_file"
echo "[snapshot-state] Updated $latest_pointer"
