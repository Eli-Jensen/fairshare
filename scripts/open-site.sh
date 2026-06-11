#!/usr/bin/env bash
# Open a URL in one or more browsers (macOS).
# Usage: open-site.sh URL [firefox|chrome|safari|all ...]
# With no browser, uses the system default. Set DRY=1 to print without opening.
URL="$1"; shift || true
choices="$*"
[ -z "$choices" ] && choices="default"
[ "$choices" = "all" ] && choices="firefox chrome safari"

open_one() {
  local label="$1"; shift
  echo "Opening $URL in $label"
  if [ "${DRY:-}" = "1" ]; then echo "  DRY: $*"; return 0; fi
  "$@"
}

status=0
for b in $choices; do
  case "$b" in
    firefox) open_one Firefox open -a "Firefox" "$URL" || status=1 ;;
    chrome)  open_one Chrome  open -a "Google Chrome" "$URL" || status=1 ;;
    safari)  open_one Safari  open -a "Safari" "$URL" || status=1 ;;
    default) open_one "the default browser" open "$URL" || status=1 ;;
    *) echo "Unknown browser '$b' (use firefox|chrome|safari|all)"; status=1 ;;
  esac
done
exit $status
