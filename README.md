# Lingo Cards

Personal Spanish/Portuguese flashcard app (English → es/pt) with a study →
quiz → spaced-repetition loop, XP levels, streaks, and cloud-persisted
progress. **Multi-user**: one shared app code, each person signs in with
their name and gets fully isolated progress; mobile-first PWA.

Stack: Cloudflare Worker + Static Assets + D1. No framework, no build step.

## The learning loop

1. **Study** — browse a themed unit (24 units, ~16 words each, example
   sentences, browser TTS audio). No grading.
2. **Quiz** — 16 mixed questions over the unit (multiple choice both ways +
   typing, accent-insensitive). ≥80% seeds the words into the review deck.
3. **Review** — daily due queue graded Again/Hard/Good/Easy, scheduled by an
   SM-2 variant (`src/srs.js`). Mature = remembered for 3+ weeks.
4. **Progress** — level/XP, streak, 28-day activity heatmap, per-language
   card-maturity bars and unit maps. A word that exists similarly in the
   *other* language gets a "≈ cognate" hint.

## Dev

```sh
npm install
echo 'APP_CODE=whatever' > .dev.vars     # local login code
npx wrangler d1 execute language-flash-cards --local --file=schema.sql
npm run dev                              # http://localhost:8787
npm test                                 # SRS unit tests (node:test)
```

## Deploy (once)

```sh
npx wrangler login
npx wrangler d1 create language-flash-cards   # paste database_id into wrangler.jsonc
npx wrangler d1 execute language-flash-cards --remote --file=schema.sql
npx wrangler secret put APP_CODE              # the code everyone types to log in
npx wrangler deploy
```

Later, to change the login code: `npm run rotate-code` (prompts for the new code; everyone re-logs in with it).

Optional custom route (e.g. `cards.adam-ferguson.com`): add to wrangler.jsonc

```jsonc
"routes": [{ "pattern": "cards.adam-ferguson.com", "custom_domain": true }]
```

## Content

Decks are static JSON: `public/decks/{es,pt}.json`, generated from
`public/decks/parts/*.json` via `node scripts/merge-decks.mjs`
(spec in `deck-spec.md`). Card ids are `<lang>-<unit>-<nnn>` and are
**permanent** — never reorder or renumber; only append cards/units, or
existing progress rows will point at the wrong word.

## Notes

- Auth = shared app code (`APP_CODE` secret) + name (case-insensitive
  identity, first spelling kept) → 1-year HMAC cookie scoped to that user;
  👤 chip in the header logs out/switches user. Every sign-in attempt is
  logged (time/who/ip/country) under Progress → “Recent sign-ins”.
  (Optional: set the `NOTIFY_URL` secret to also push login alerts to an
  ntfy/Slack/Discord webhook — unset by default, feature dormant.)
- Server owns all scheduling/XP (D1 is the source of truth); the client is a
  thin renderer over `/api/state`.
- She can add to home screen (manifest included); TTS uses on-device
  es-419/pt-BR voices.
