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

# 5. Wait for the dev run — it reports status, versions, and gates here:
#    a non-success exit means we do NOT touch prod.
if ! bash scripts/watch-run.sh dev "$sha"; then
  echo
  echo "❌ Dev CI did not pass — NOT promoting to prod."
  exit 1
fi

# 6. Promote to prod. `make promote` fast-forwards main, deploys prod rules,
#    and watches the prod deploy (status + versions) on its own.
echo
echo "🚀 Promoting to prod…"
make promote
echo
echo "🎉 Shipped $short."
