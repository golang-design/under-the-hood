#!/usr/bin/env bash
# Regression test for share-link unfurl metadata (Slack/Twitter/WeChat/Substack).
# Builds the site to a throwaway dir (so a running `hugo server` cannot taint
# it with localhost URLs) and asserts the og:/twitter: invariants that make a
# preview card render. Run from anywhere; exits non-zero on any failure.
set -euo pipefail

cd "$(dirname "$0")/.."   # website/
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

go run make-cn.go >/dev/null 2>&1 || true   # regenerate content/ if needed
# No --minify: keep attribute quotes so literal grep assertions are stable.
# URL/scheme semantics are identical to the production (minified) build.
hugo --destination "$out" >/dev/null

fail=0
check() { # <description> <test-expr-already-evaluated:0/1>
  if [ "$2" -eq 1 ]; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n' "$1"; fail=1; fi
}

for page in "$out/index.html" "$out/zh-cn/preface/index.html"; do
  [ -f "$page" ] || { echo "missing built page: $page"; exit 1; }
  echo "== $page =="
  html="$(cat "$page")"

  # exactly one og:image (no double-emit from a leftover internal template)
  n=$(grep -oc 'property="og:image"' "$page" || true)
  check "exactly one og:image (got $n)" "$([ "$n" -eq 1 ] && echo 1 || echo 0)"

  # every canonical URL + share-image URL is absolute https
  bad=$(grep -oE '(property="og:url"|property="og:image"|property="og:image:secure_url"|name="twitter:image"|rel="canonical")[^>]*(content|href)="[^"]*"' "$page" \
        | grep -oE '(content|href)="[^"]*"' | grep -vE '="https://' || true)
  check "all og/twitter urls are https" "$([ -z "$bad" ] && echo 1 || echo 0)"
  [ -n "$bad" ] && echo "    offending: $bad"

  # required tags present
  for tag in 'property="og:title"' 'property="og:description"' 'property="og:image:width"' \
             'name="twitter:card" content="summary_large_image"' 'rel="canonical"'; do
    grep -q "$tag" "$page" && check "has $tag" 1 || check "has $tag" 0
  done

  # description is non-empty and not raw HTML (plainified)
  desc=$(grep -oE 'name="description" content="[^"]*"' "$page" | head -1)
  check "description present" "$([ -n "$desc" ] && echo 1 || echo 0)"
  check "description has no html tags" "$(echo "$desc" | grep -q '<[a-zA-Z]' && echo 0 || echo 1)"

  # og:image target actually exists in the build
  img=$(grep -oE 'property="og:image" content="[^"]*"' "$page" | grep -oE '[^/"]*\.png' | head -1)
  check "share image $img exists in build" "$([ -f "$out/$img" ] && echo 1 || echo 0)"
done

# the card is exactly 1200x630
read -r w h < <(hugo_=1; sips -g pixelWidth -g pixelHeight "$out/og-cover.png" 2>/dev/null \
  | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}')
check "card is 1200x630 (got ${w}x${h})" "$([ "${w:-0}" = 1200 ] && [ "${h:-0}" = 630 ] && echo 1 || echo 0)"

[ "$fail" -eq 0 ] && echo "PASS: social meta OK" || { echo "FAIL: social meta has issues"; exit 1; }
