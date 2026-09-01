import { review, reviewXp, levelFor, streakFor } from './srs.js'

const LANGS = ['es', 'pt']
const UNIT_RE = /^u\d{2}$/
const COOKIE = 'sid'
const DAY = 24 * 60 * 60 * 1000

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, url)
      } catch (e) {
        return json({ error: 'server', detail: String((e && e.message) || e) }, 500)
      }
    }
    return env.ASSETS.fetch(req)
  },
}

async function api(req, env, ctx, url) {
  if (url.pathname === '/api/health') return json({ ok: true })

  if (url.pathname === '/api/login') {
    if (req.method !== 'POST') return json({ error: 'method' }, 405)
    const body = await readJson(req)
    const ok = await codeMatches(body.code, env.APP_CODE)
    const name = cleanName(body.name)
    const geo = `${req.headers.get('cf-connecting-ip') || '?'} (${(req.cf && req.cf.country) || '?'})`
    if (ok) {
      const user = await resolveUser(env, name)
      ctx.waitUntil(logLogin(env, 1, req, user.label))
      ctx.waitUntil(notify(env, '🔑 Lingo Cards: NEW SUCCESSFUL LOGIN', `${user.label} signed in from ${geo} UA: ${(req.headers.get('user-agent') || '').slice(0, 120)}`, true))
      const token = await makeToken(env, user.id)
      const secure = url.protocol === 'https:' ? '; Secure' : ''
      return json(
        { ok: true, me: user },
        200,
        { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}` }
      )
    }
    ctx.waitUntil(logLogin(env, 0, req, name))
    // Alert only the first bad attempt of each hour so brute-force bursts page once, not 100x.
    const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM logins WHERE ok = 0 AND ts > datetime('now','-1 hour')").first()
    if (recent && recent.c === 1) {
      ctx.waitUntil(notify(env, '⚠️ Lingo Cards: failed sign-in attempts starting', `First wrong-code attempt (last hour) from ${geo}`, true))
    }
    return json({ error: 'bad-code' }, 401)
  }

  const uid = await authed(req, env)
  if (!uid) return json({ error: 'unauthorized' }, 401)

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` })
  }
  if (url.pathname === '/api/state' && req.method === 'GET') return getState(env, uid)
  if (url.pathname === '/api/logins' && req.method === 'GET') {
    const rows = await env.DB.prepare('SELECT ts, ok, who, ip, country, ua FROM logins ORDER BY ts DESC LIMIT 50').all()
    return json({ logins: rows.results })
  }
  if (url.pathname === '/api/study' && req.method === 'POST') return study(req, env, uid)
  if (url.pathname === '/api/quiz' && req.method === 'POST') return quiz(req, env, uid)
  if (url.pathname === '/api/review' && req.method === 'POST') return reviewRoute(req, env, uid)
  return json({ error: 'not-found' }, 404)
}

// ---------- login audit + notify ----------

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24)
  return n || 'Guest'
}

async function resolveUser(env, label) {
  // Names are case-insensitive identities; the first-entered spelling is kept for display.
  const existing = await env.DB.prepare('SELECT id, label FROM users WHERE lower(label) = lower(?)').bind(label).first()
  if (existing) return existing
  const res = await env.DB.prepare('INSERT INTO users (label) VALUES (?)').bind(label).run()
  return { id: res.meta.last_row_id, label }
}

function logLogin(env, ok, req, who) {
  return env.DB.prepare('INSERT INTO logins (ok, who, ip, country, ua) VALUES (?, ?, ?, ?, ?)')
    .bind(ok, who || '', req.headers.get('cf-connecting-ip') || '', (req.cf && req.cf.country) || '', (req.headers.get('user-agent') || '').slice(0, 200))
    .run()
}
// NOTIFY_URL secret: an ntfy.sh topic URL (plain-text body), or a Slack/Discord
// incoming webhook. Missing NOTIFY_URL = logging only, no push.
async function notify(env, title, text, urgent) {
  if (!env.NOTIFY_URL) return
  const url = env.NOTIFY_URL
  let body, headers = { 'content-type': 'text/plain; charset=utf-8' }
  if (url.includes('hooks.slack.com')) {
    body = JSON.stringify({ text: `*${title}*\n${text}` }); headers = { 'content-type': 'application/json' }
  } else if (url.includes('discord.com/webhooks') || url.includes('/webhooks/')) {
    body = JSON.stringify({ content: `${title}\n${text}` }); headers = { 'content-type': 'application/json' }
  } else {
    // ntfy: title/priority via headers
    headers = { 'X-Title': title, ...(urgent ? { 'X-Priority': '5', 'X-Tags': 'rotating_light' } : {}) }
    body = text
  }
  await fetch(url, { method: 'POST', body, headers }).catch(() => {})
}

// ---------- auth ----------

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return hex(buf)
}
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function hmacKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.APP_CODE))
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}
async function makeToken(env, uid) {
  const exp = Date.now() + 365 * DAY
  const key = await hmacKey(env)
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}.${exp}`)))
  return `${uid}.${exp}.${sig}`
}
// Returns the signed-in user's id, or null.
async function authed(req, env) {
  if (!env.APP_CODE) return null
  const raw = (req.headers.get('cookie') || '').match(/(?:^|;\s*)sid=([^;]+)/)
  if (!raw) return null
  const [uidStr, expStr, sig] = raw[1].split('.')
  const uid = Number(uidStr)
  const exp = Number(expStr)
  if (!Number.isInteger(uid) || uid < 1 || !Number.isFinite(exp) || exp < Date.now() || !/^[0-9a-f]{64}$/.test(sig)) return null
  const key = await hmacKey(env)
  const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}.${exp}`)))
  return want === sig ? uid : null
}
// Compare via SHA-256 digests so length/content of the code isn't leaked by timing.
async function codeMatches(code, expected) {
  if (typeof code !== 'string' || typeof expected !== 'string' || !expected) return false
  const [a, b] = await Promise.all([sha256hex(code), sha256hex(expected)])
  return a === b
}

// ---------- handlers ----------

async function getState(env, uid) {
  const nowIso = new Date().toISOString()
  const [me, prog, studied, quizzes, activity] = await env.DB.batch([
    env.DB.prepare('SELECT id, label FROM users WHERE id = ?').bind(uid),
    env.DB.prepare('SELECT lang, card_id, stage, ease, reps, lapses, interval, due, last_seen FROM progress WHERE user_id = ?').bind(uid),
    env.DB.prepare('SELECT lang, unit_id, studied_at FROM studied WHERE user_id = ?').bind(uid),
    env.DB.prepare('SELECT lang, unit_id, score, passed, taken_at FROM quizzes WHERE user_id = ? ORDER BY taken_at').bind(uid),
    env.DB.prepare("SELECT day, xp, reviews FROM activity WHERE user_id = ? AND day >= date('now', '-400 days') ORDER BY day").bind(uid),
  ])

  const rows = prog.results
  const due = {}
  const stageCounts = {}
  for (const lang of LANGS) {
    due[lang] = rows
      .filter((r) => r.lang === lang && r.due <= nowIso)
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .slice(0, 60)
      .map((r) => ({ card: r.card_id, due: r.due }))
    stageCounts[lang] = { learning: 0, young: 0, mature: 0, total: 0 }
  }
  for (const r of rows) {
    if (stageCounts[r.lang]) {
      stageCounts[r.lang][r.stage] = (stageCounts[r.lang][r.stage] || 0) + 1
      stageCounts[r.lang].total += 1
    }
  }

  const xp = activity.results.reduce((s, a) => s + a.xp, 0)
  const days = new Set(activity.results.filter((a) => a.xp > 0 || a.reviews > 0).map((a) => a.day))
  const bestQuiz = {}
  for (const q of quizzes.results) {
    const k = q.lang + q.unit_id
    if (q.passed) bestQuiz[k] = 1
    else if (!(k in bestQuiz)) bestQuiz[k] = 0
  }

  return json({
    now: nowIso,
    me: me.results[0] || { id: uid, label: 'Guest' },
    progress: rows.map((r) => ({ ...r, id: r.card_id, card_id: undefined })),
    studied: studied.results,
    quizzes: quizzes.results,
    bestQuiz,
    due,
    stageCounts,
    activity: activity.results,
    xp,
    level: levelFor(xp),
    streak: streakFor(days),
  })
}

async function study(req, env, uid) {
  const body = await readJson(req)
  if (!LANGS.includes(body.lang) || !UNIT_RE.test(body.unit || '')) return json({ error: 'bad-input' }, 400)
  const res = await env.DB.prepare('INSERT OR IGNORE INTO studied (user_id, lang, unit_id) VALUES (?, ?, ?)')
    .bind(uid, body.lang, body.unit)
    .run()
  const first = res.meta.changes > 0
  if (first) await activityStmt(env, uid, 10, 0).run()
  return json({ ok: true, first, xp: first ? 10 : 0 })
}

async function quiz(req, env, uid) {
  const body = await readJson(req)
  const { lang, unit } = body
  const score = Number(body.score)
  if (!LANGS.includes(lang) || !UNIT_RE.test(unit || '') || !Number.isFinite(score) || score < 0 || score > 1) {
    return json({ error: 'bad-input' }, 400)
  }
  const passed = score >= 0.8 ? 1 : 0
  const cardIds = Array.isArray(body.cardIds) ? body.cardIds : []
  const idRe = new RegExp(`^${lang}-${unit}-\\d{3}$`)
  if (passed && (cardIds.length === 0 || cardIds.length > 40 || !cardIds.every((c) => idRe.test(c)))) {
    return json({ error: 'bad-cards' }, 400)
  }

  const prior = await env.DB.prepare('SELECT 1 AS x FROM quizzes WHERE user_id = ? AND lang = ? AND unit_id = ? AND passed = 1 LIMIT 1')
    .bind(uid, lang, unit)
    .first()

  const stmts = [
    env.DB.prepare('INSERT INTO quizzes (user_id, lang, unit_id, score, passed) VALUES (?, ?, ?, ?, ?)').bind(uid, lang, unit, score, passed),
  ]
  if (passed) {
    // Seed cards into the SRS rotation (due in 10 min), skipping existing rows.
    for (const card of cardIds) {
      stmts.push(
        env.DB.prepare('INSERT OR IGNORE INTO progress (user_id, lang, card_id, stage, ease, reps, lapses, interval, due) VALUES (?, ?, ?, ?, 2.5, 0, 0, 0, ?)')
          .bind(uid, lang, card, 'learning', new Date(Date.now() + 10 * 60 * 1000).toISOString())
      )
    }
  }
  const xp = passed ? (prior ? 10 : 50) : 5
  if (xp) stmts.push(activityStmt(env, uid, xp, 0))
  await env.DB.batch(stmts)
  return json({ ok: true, passed: !!passed, firstPass: passed && !prior, xp })
}

async function reviewRoute(req, env, uid) {
  const body = await readJson(req)
  const grade = body.grade
  if (!LANGS.includes(body.lang) || typeof body.card !== 'string' || !new RegExp(`^${body.lang}-u\\d{2}-\\d{3}$`).test(body.card)) {
    return json({ error: 'bad-input' }, 400)
  }
  if (!Number.isInteger(grade) || grade < 0 || grade > 3) return json({ error: 'bad-grade' }, 400)

  const row = await env.DB.prepare('SELECT ease, reps, interval, lapses FROM progress WHERE user_id = ? AND lang = ? AND card_id = ?')
    .bind(uid, body.lang, body.card)
    .first()
  if (!row) return json({ error: 'unknown-card' }, 404)

  const next = review(row, grade)
  const xp = reviewXp(grade)
  await env.DB.batch([
    env.DB.prepare('UPDATE progress SET stage = ?, ease = ?, reps = ?, lapses = ?, interval = ?, due = ?, last_seen = ? WHERE user_id = ? AND lang = ? AND card_id = ?')
      .bind(next.stage, next.ease, next.reps, next.lapses, next.interval, next.due, new Date().toISOString(), uid, body.lang, body.card),
    activityStmt(env, uid, xp, 1),
  ])
  return json({ ok: true, stage: next.stage, due: next.due, xp })
}

// ---------- helpers ----------

function activityStmt(env, uid, xp, reviews) {
  return env.DB.prepare(
    'INSERT INTO activity (user_id, day, xp, reviews) VALUES (?, date("now"), ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET xp = xp + ?, reviews = reviews + ?'
  ).bind(uid, xp, reviews, xp, reviews)
}

async function readJson(req) {
  try {
    return (await req.json()) || {}
  } catch {
    return {}
  }
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
