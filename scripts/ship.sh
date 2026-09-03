#!/bin/sh
# Deploy, then VERIFY the deployed Worker's APP_CODE binding still matches what
# the user will type. Cloudflare snapshot races between `secret put` and deploys
# have twice pinned a stale secret version (login "bad-code" with the right code).
# On mismatch it redeploys (a fresh deploy re-picks the latest secret version).
# Usage: printf '<app-code>' | npm run ship   (or run interactively)
set -eu
BASE=${BASE_URL:-https://language-flash-cards.adam-b-ferguson.workers.dev}
if [ -t 0 ]; then printf 'app code: ' >&2; fi
read -r CODE
i=1
while [ "$i" -le 3 ]; do
  npx wrangler deploy
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/verify-code" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}")
  if [ "$code" = "200" ]; then
    echo "✅ deployed and code binding verified"
    exit 0
  fi
  if [ "$code" = "410" ] || [ "$code" = "302" ] || [ "$code" = "403" ]; then
    # Access active: edge redirects browsers to login (302) and curl clients may get
    # 403; 410 = request reached the Worker with Access expected (bypass attempt).
    loc=$(curl -s -m 15 -o /dev/null -w '%{redirect_url}' "$BASE/")
    case "$loc" in
      *cloudflareaccess.com*) echo "✅ deployed; app behind Cloudflare Access (${loc%%/cdn-cgi*})"; exit 0;;
      *) if [ "$code" = "410" ]; then echo "✅ deployed; Worker confirms Access mode (edge redirect missing?!)"; exit 0; fi;;
    esac
  fi
  echo "⚠️  deployed worker rejected the code (attempt $i) — redeploying to re-pick latest secret version..." >&2
  if [ "$i" = "2" ]; then
    # observed failure mode: secret VALUE drifts (newline/append corruption via bundle rewrites)
    # -> re-put the exact bytes we were just given, then deploy picks it up cleanly
    echo "   re-putting APP_CODE with the exact bytes provided..." >&2
    printf '%s' "$CODE" | npx wrangler secret put APP_CODE >/dev/null 2>&1
  fi
  i=$((i+1)); sleep 8
done
echo "❌ still failing — the SECRET itself drifted, not the binding. Fix: printf '<code>' | npx wrangler secret put APP_CODE, then npm run ship" >&2
exit 1
