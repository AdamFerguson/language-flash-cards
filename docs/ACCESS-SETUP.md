# Cloudflare Access setup (one-time, ~10 min, dashboard)

Goal: Cloudflare owns login. Workers-side JWT verification is already in the code —
it activates the moment `ACCESS_TEAM` + `ACCESS_AUD` are set as vars in `wrangler.jsonc`
(or secrets, if you prefer). Until then the app stays in legacy mode (app code + email).

## 1. Zero Trust org (once per account)
1. dash.cloudflare.com → **Zero Trust** (tries `try.cloudflareaccess.com`) → choose the **Free** plan (50 users; it may ask for a card on file — the free plan does not charge).
2. Pick a team name — your login domain becomes `https://<TEAM>.cloudflareaccess.com`. **Note `<TEAM>`.**

## 2. Login methods
Zero Trust → **Settings → Authentication**:
- Turn on **One-time PIN** (codes to allowlisted emails — works for `pm.me`, gmail, anything), and/or
- Add **Google** as an identity provider if all users are Gmail users.

## 3. Access application for the Worker
Zero Trust → **Access → Applications → Add → Self-hosted**:
- Name: `lingo-cards`
- Public hostname: `language-flash-cards.adam-b-ferguson.workers.dev`
  - If you use the project/preview URL (`*-language-flash-cards.<team>.workers.dev`), add it as a second hostname too — an unprotected preview URL is a bypass.
- Session duration: set the **longest** available (up to 30 days) so she logs in via email code about once a month.

## 4. Policy (who gets in)
Within the application, create a policy:
- Action **Allow**, login methods as chosen above, duration = longest.
- **Include → Emails**: `adam.b.ferguson@pm.me`, your wife's email, anyone else you approve.
  (Users are created in the app automatically on first entry — no app-side signup.)

## 5. Give the Worker its two values
Tip: the team name is revealed by the login redirect itself —
`curl -s -o /dev/null -w '%{redirect_url}\n' https://<your-worker-url>/` → `https://<TEAM>.cloudflareaccess.com/...`.
On the application/policy page copy the **AUD tag** (a hex string identifying this Access app; rotating it revokes sessions). Then in `wrangler.jsonc`, inside `vars`:

```jsonc
"vars": { "ACCESS_TEAM": "<TEAM>", "ACCESS_AUD": "<AUD-TAG>" }
```

(or `wrangler secret put` them — they're not secrets, vars are fine.)
Commit the change if vars are in the repo, then `printf '<code>' | npm run ship`.

## 6. Verify cutover
```sh
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://language-flash-cards.adam-b-ferguson.workers.dev/
# expect: 302 https://<TEAM>.cloudflareaccess.com/lingo-cards/...
```
Then open it in a private browser window → email code → app loads, user auto-created
from the verified email. `/api/login` and `/api/verify-code` return 410 (retired).

## Rollback
Delete the two vars → the app reverts to legacy app-code mode on next deploy.
(Don't delete the Access application until you're sure — it's also the thing
protecting the workers.dev URL.)

## After everything works
The `APP_CODE` secret can be retired (`npm run` → `wrangler secret delete APP_CODE`),
and the login screen in `public/app.js` can be removed in a cleanup commit.
