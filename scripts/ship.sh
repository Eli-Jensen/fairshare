#!/usr/bin/env bash
# Ship the current dev work: (optional commit) → push dev → watch it reach prod.
#
# CI does the promoting now — a green dev run fast-forwards main by itself, so
# this script pushes and then reports. It no longer calls `make promote`; doing
# so would race the pipeline that is already doing it.
#
# To stop a commit from reaching prod, put [skip promote] in its message and
# promote by hand later with `make promote`.
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
echo "🚢 Shipping $short:  dev → (tests, Lighthouse) → prod"
echo "   commits ahead of prod:"
git log --oneline origin/main..HEAD | sed 's/^/     /'
echo

# 4. Push to dev (no-op if already pushed)
git push origin dev

# 5. Watch the dev run. Promotion happens inside that same run once tests,
#    the dev deploy and Lighthouse have all passed — so a failure here means
#    prod was never touched.
if ! bash scripts/watch-run.sh dev "$sha"; then
  echo
  echo "❌ Dev CI did not pass — prod was not touched."
  exit 1
fi

echo
echo "🎉 Shipped $short."
make versions
