#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/mission_guard.sh [--staged|--last-commit]

Modes:
  --staged       Analyze staged changes (recommended for pre-commit hook)
  --last-commit  Analyze the most recent commit (recommended for post-commit hook)
  (default)      Analyze current unstaged working-tree changes

Behavior:
  - Detect changed files
  - Classify risk/impact areas
  - Warn about possible scope drift
  - Recommend the most relevant validation commands
EOF
}

MODE="working"
case "${1:-}" in
  --staged)
    MODE="staged"
    ;;
  --last-commit)
    MODE="last_commit"
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    echo "[mission-guard] Unknown option: $1" >&2
    usage >&2
    exit 1
    ;;
esac

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[mission-guard] Not inside a Git repository."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
REPO_NAME="$(basename "$REPO_ROOT")"

MISSION="Secure and reliable restaurant operations from order to delivery."
if [[ "$REPO_NAME" == "unilove-rider-android" ]]; then
  MISSION="Secure and reliable rider operations: login, dispatch, OTP, incidents, sync."
fi

get_changed_files() {
  case "$MODE" in
    staged)
      git diff --name-only --cached --diff-filter=ACMR
      ;;
    last_commit)
      if git rev-parse --verify HEAD >/dev/null 2>&1; then
        git diff-tree --no-commit-id --name-only -r HEAD --diff-filter=ACMR
      fi
      ;;
    *)
      git diff --name-only --diff-filter=ACMR
      ;;
  esac
}

mapfile -t CHANGED_FILES < <(get_changed_files | sed '/^$/d')

if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
  echo "[mission-guard] No changed files to evaluate."
  exit 0
fi

security_count=0
backend_count=0
frontend_count=0
mobile_count=0
db_count=0
devops_count=0
docs_count=0

for file in "${CHANGED_FILES[@]}"; do
  case "$file" in
    src/middleware/*|src/controllers/payment*|src/services/payment*|src/services/receiveMoney*|src/services/adminAuth*|src/config/env.js|src/routes/*auth*|src/routes/publicRoutes.js|src/routes/adminRoutes.js|app/src/main/java/*/data/api/NetworkModule.kt|app/src/main/AndroidManifest.xml)
      security_count=$((security_count + 1))
      ;;
  esac

  case "$file" in
    src/*|package.json|package-lock.json)
      backend_count=$((backend_count + 1))
      ;;
  esac

  case "$file" in
    public/*|src/views/*|*.html|*.css)
      frontend_count=$((frontend_count + 1))
      ;;
  esac

  case "$file" in
    app/src/main/*|app/src/test/*|app/src/androidTest/*|app/build.gradle.kts|build.gradle.kts|settings.gradle.kts)
      mobile_count=$((mobile_count + 1))
      ;;
  esac

  case "$file" in
    src/db/*|data/*.db*|app/src/main/java/*/data/local/*)
      db_count=$((db_count + 1))
      ;;
  esac

  case "$file" in
    Dockerfile|docker-compose.yml|gradle/*|gradlew|gradlew.bat|.github/workflows/*)
      devops_count=$((devops_count + 1))
      ;;
  esac

  case "$file" in
    docs/*|README.md|*.md)
      docs_count=$((docs_count + 1))
      ;;
  esac
done

category_count=0
for c in "$security_count" "$backend_count" "$frontend_count" "$mobile_count" "$db_count" "$devops_count" "$docs_count"; do
  if [[ "$c" -gt 0 ]]; then
    category_count=$((category_count + 1))
  fi
done

echo "[mission-guard] Repository: $REPO_NAME"
echo "[mission-guard] Mission: $MISSION"
echo "[mission-guard] Mode: $MODE"
echo "[mission-guard] Changed files: ${#CHANGED_FILES[@]}"

echo
echo "[mission-guard] Change summary"
printf "  - Security/Auth: %d\n" "$security_count"
printf "  - Backend/API:   %d\n" "$backend_count"
printf "  - Frontend/UI:   %d\n" "$frontend_count"
printf "  - Mobile/App:    %d\n" "$mobile_count"
printf "  - Database/Data: %d\n" "$db_count"
printf "  - DevOps/Infra:  %d\n" "$devops_count"
printf "  - Docs:          %d\n" "$docs_count"

echo
echo "[mission-guard] Likely impact"
if [[ "$security_count" -gt 0 ]]; then
  echo "  - Security-sensitive paths changed. Re-check auth, callback verification, and access control."
fi
if [[ "$backend_count" -gt 0 ]]; then
  echo "  - API/business behavior may change. Re-test key user flows end to end."
fi
if [[ "$frontend_count" -gt 0 ]]; then
  echo "  - UI/UX behavior may change. Re-test page states, forms, and error handling."
fi
if [[ "$mobile_count" -gt 0 ]]; then
  echo "  - Rider app behavior may change. Re-test login, queue refresh, and OTP flow."
fi
if [[ "$db_count" -gt 0 ]]; then
  echo "  - Data/migration behavior may change. Re-check schema assumptions and backward compatibility."
fi
if [[ "$devops_count" -gt 0 ]]; then
  echo "  - Deployment/runtime behavior may change. Validate startup and environment wiring."
fi
if [[ "$docs_count" -gt 0 && "$category_count" -eq 1 ]]; then
  echo "  - Documentation-only update detected."
fi

echo
if [[ "$category_count" -ge 4 || ${#CHANGED_FILES[@]} -ge 25 ]]; then
  echo "[mission-guard][warning] Possible scope drift detected."
  echo "  - Too many domains changed in one batch."
  echo "  - Consider splitting into smaller focused commits/PRs."
else
  echo "[mission-guard] Scope focus looks reasonable."
fi

declare -a suggested_commands=()
if [[ "$backend_count" -gt 0 || "$security_count" -gt 0 || "$frontend_count" -gt 0 || "$db_count" -gt 0 ]]; then
  if [[ -f package.json ]]; then
    suggested_commands+=("npm test")
  fi
fi
if [[ "$mobile_count" -gt 0 ]]; then
  if [[ -x ./gradlew ]]; then
    suggested_commands+=("./gradlew :app:testStagingDebugUnitTest")
  fi
fi
if [[ "$devops_count" -gt 0 && -f docker-compose.yml ]]; then
  suggested_commands+=("docker compose config")
fi

if [[ ${#suggested_commands[@]} -gt 0 ]]; then
  echo
  echo "[mission-guard] Recommended checks"
  declare -A seen=()
  for cmd in "${suggested_commands[@]}"; do
    if [[ -z "${seen[$cmd]:-}" ]]; then
      seen[$cmd]=1
      echo "  - $cmd"
    fi
  done
fi

if [[ "${MISSION_GUARD_STRICT:-0}" == "1" && ( "$category_count" -ge 5 || ( "$security_count" -gt 0 && "$devops_count" -gt 0 ) ) ]]; then
  echo
  echo "[mission-guard][blocked] Strict mode is enabled and risk threshold was exceeded."
  echo "Set MISSION_GUARD_STRICT=0 to disable strict blocking."
  exit 1
fi

exit 0
