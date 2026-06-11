#!/usr/bin/env bash
# Wait for a CI run to finish, report what it deployed, then show live
# versions. Exits non-zero if the run did not succeed (so callers can gate).
# Usage:
#   watch-run.sh                # latest run, any branch
#   watch-run.sh <branch>       # latest run on <branch>
#   watch-run.sh <branch> <sha> # the push run for that commit (polls for it)
set -uo pipefail

PROD_URL="https://fairshare-split.web.app"
DEV_URL="https://dev-fairshare-split.web.app"
branch="${1:-}"; sha="${2:-}"

id=""
if [ -n "$sha" ]; then
  printf "⏳ Waiting for CI on %s (%s)" "$branch" "${sha:0:7}"
  for _ in $(seq 1 30); do
    id=$(gh run list --branch "$branch" --json databaseId,headSha,event \
      -q "[.[] | select(.headSha==\"$sha\" and .event==\"push\")][0].databaseId" 2>/dev/null || true)
    [ -n "$id" ] && [ "$id" != "null" ] && break
    id=""; printf "."; sleep 4
  done
  echo
elif [ -n "$branch" ]; then
  id=$(gh run list --branch "$branch" -L1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
else
  id=$(gh run list -L1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
fi
if [ -z "$id" ] || [ "$id" = "null" ]; then
  echo "✋ No CI run found to watch."
  exit 1
fi

printf "⏳ Running"
while :; do
  st=$(gh run view "$id" --json status -q .status 2>/dev/null || echo unknown)
  [ "$st" = "completed" ] && break
  printf "."; sleep 6
done
echo

gh run view "$id" --json headBranch,headSha,event,conclusion,jobs -q \
  '"\(.headBranch) @ \(.headSha[0:7]) (\(.event)) — \(.conclusion)\n" + ([.jobs[] | "  \(.name): \(.conclusion)"] | join("\n"))'

info=$(gh run view "$id" --json headBranch,event,conclusion -q '.event+" "+.conclusion+" "+.headBranch')
case "$info" in
  "push success main") echo "→ deployed PROD: $PROD_URL" ;;
  "push success dev")  echo "→ deployed DEV:  $DEV_URL" ;;
  *) echo "→ nothing deployed (PR/test-only run, or the deploy didn't succeed)" ;;
esac
echo
make -s versions

[ "${info%% *}" = "push" ] && [ "$(echo "$info" | cut -d' ' -f2)" = "success" ]
