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
  if curl -sf -m 15 -o /dev/null -X POST "$BASE/api/verify-code" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}"; then
    echo "✅ deployed and code binding verified"
    exit 0
  fi
  echo "⚠️  deployed worker rejected the code (attempt $i) — redeploying to re-pick latest secret version..." >&2
  i=$((i+1)); sleep 8
done
echo "❌ still failing — the SECRET itself drifted, not the binding. Fix: printf '<code>' | npx wrangler secret put APP_CODE, then npm run ship" >&2
exit 1
