#!/usr/bin/env bash
# Ship the current dev work all the way to prod in one shot:
#   (optional commit) → push dev → wait for dev CI → if green, promote to prod.
#
# The dev-green gate is the safety net: if tests, build, or the dev deploy
# fail, this stops and never touches prod. It DOES skip the manual dev-site
# smoke test — use it for low-risk changes; use the normal flow otherwise.
#
# Usage:
#   make ship                       # ship already-committed dev commits
#   make ship MSG="Fix copy typo"   # commit pending changes first, then ship
set -euo pipefail

DEV_URL="https://dev-fairshare-split.web.app"
PROD_URL="https://fairshare-split.web.app"

# Poll a run to completion. Returns 0 on success, 1 otherwise.
wait_run() {
  local id="$1" status conclusion dots=0
  while :; do
    status=$(gh run view "$id" --json status -q .status 2>/dev/null || echo unknown)
    [ "$status" = "completed" ] && break
    dots=$(( (dots % 3) + 1 ))
    printf '\r   running%s   ' "$(printf '.%.0s' $(seq 1 $dots))"
    sleep 6
  done
  conclusion=$(gh run view "$id" --json conclusion -q .conclusion 2>/dev/null || echo unknown)
  printf '\r   %s            \n' "$conclusion"
  [ "$conclusion" = "success" ]
}

# Find the push-triggered run id for a given commit sha (polls for it to appear).
find_run() {
  local sha="$1" branch="$2" id=""
  for _ in $(seq 1 30); do
    id=$(gh run list --branch "$branch" --json databaseId,headSha,event \
      -q "[.[] | select(.headSha==\"$sha\" and .event==\"push\")][0].databaseId" 2>/dev/null || true)
    [ -n "$id" ] && [ "$id" != "null" ] && { echo "$id"; return 0; }
    sleep 4
  done
  return 1
}

# 1. Must be on dev
branch=$(git branch --show-current)
if [ "$branch" != "dev" ]; then
  echo "✋ 'make ship' runs from the dev branch (you're on '$branch')."
  exit 1
fi

# 2. Commit pending changes if a message was given
if [ -n "$(git status --porcelain)" ]; then
  if [ -z "${MSG:-}" ]; then
    echo "✋ You have uncommitted changes. Pass MSG=\"your message\" to commit them, or commit first."
    exit 1
  fi
  echo "→ committing: $MSG"
  git add -A
  git commit -q -m "$MSG"
fi

# 3. Must have something prod doesn't
git fetch -q origin
if [ -z "$(git log --oneline origin/main..HEAD)" ]; then
  echo "✋ Nothing to ship — dev is not ahead of main."
  exit 1
fi

sha=$(git rev-parse HEAD)
short=$(git rev-parse --short HEAD)
echo "🚢 Shipping $short:  dev → (if CI passes) → prod"
echo "   commits ahead of prod:"
git log --oneline origin/main..HEAD | sed 's/^/     /'
echo

# 4. Push to dev (no-op if already pushed)
git push origin dev

# 5. Wait for the dev run for THIS commit
echo "⏳ Waiting for dev CI ($short)…"
if ! dev_run=$(find_run "$sha" dev); then
  echo "✋ Couldn't find a dev CI run for $short. Check 'gh run list'."
  exit 1
fi
if ! wait_run "$dev_run"; then
  echo
  echo "❌ Dev CI did not pass — NOT promoting to prod."
  echo "   Inspect: gh run view $dev_run --log-failed"
  exit 1
fi
echo "✅ Dev is green and deployed: $DEV_URL"
echo

# 6. Promote to prod (merges dev → main, deploys prod rules)
echo "🚀 Promoting to prod…"
make promote

# 7. Watch the prod hosting deploy
echo
echo "⏳ Waiting for the prod deploy…"
git fetch -q origin
main_sha=$(git rev-parse origin/main)
if prod_run=$(find_run "$main_sha" main); then
  if ! wait_run "$prod_run"; then
    echo "⚠️  Prod hosting deploy failed (prod rules were already deployed by 'make promote')."
    echo "   Inspect: gh run view $prod_run --log-failed"
    exit 1
  fi
fi

echo
echo "🎉 Shipped $short to prod: $PROD_URL"
echo
make versions
