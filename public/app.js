// Lingo Cards — vanilla SPA. Views: login / today / study / quiz / progress.
const S = {
  lang: localStorage.getItem('lang') || 'es',
  api: null,          // server state
  decks: {},          // lang -> deck json
  byId: {},           // lang -> card id -> card
  normMap: {},        // lang -> normalized term -> term (for cognate badge)
  deckTotal: {},
}
const $ = (s) => document.querySelector(s)
const app = $('#app')

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') n.className = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v)
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue
    n.append(kid.nodeType ? kid : document.createTextNode(kid))
  }
  return n
}

// ---------- api ----------

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 401 && path !== '/api/login') { S.api = null; renderLogin(); throw new Error('unauthorized') }
  return res.json()
}
async function refresh() { S.api = await api('/api/state') }

async function loadDeck(lang) {
  if (S.decks[lang]) return S.decks[lang]
  const d = await (await fetch(`/decks/${lang}.json`)).json()
  S.decks[lang] = d
  S.byId[lang] = {}
  S.normMap[lang] = {}
  S.deckTotal[lang] = 0
  for (const u of d.units) for (const c of u.cards) {
    S.byId[lang][c.id] = { ...c, unit: u.id }
    const k = normTerm(c.term)
    if (!S.normMap[lang][k]) S.normMap[lang][k] = c.term
    S.deckTotal[lang]++
  }
  return d
}

// ---------- text utils ----------

const normTerm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[¿?¡!.,;:»«”"'()]/g, '').replace(/\s+/g, ' ')
  .replace(/^(el|la|los|las|o|a|os|as|um|uma)\s+/, '').replace(/\b(se|me)\s+$/, '').trim()

function lev(a, b) {
  const m = [...Array(b.length + 1).keys()]
  for (let i = 1; i <= a.length; i++) {
    let p = m[0]; m[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = m[j]
      m[j] = Math.min(m[j] + 1, m[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1))
      p = t
    }
  }
  return m[b.length]
}
const typedOk = (input, term) => {
  const a = normTerm(input), b = normTerm(term)
  return a === b || (b.length >= 5 && lev(a, b) <= 1)
}

// cognate hint: same/very similar word in the other language
function cognateOf(card) {
  const other = S.lang === 'es' ? 'pt' : 'es'
  if (!S.normMap[other]) return null
  const k = normTerm(card.term)
  if (k.length < 4) return null
  const hit = Object.keys(S.normMap[other]).find((t) => t === k || (t.length >= 5 && k.length >= 5 && lev(t, k) <= 1))
  return hit ? S.normMap[other][hit] : null
}

// ---------- TTS ----------

let voices = []
if ('speechSynthesis' in window) {
  const load = () => { voices = speechSynthesis.getVoices() }
  load(); speechSynthesis.onvoiceschanged = load
}
function speak(text) {
  if (!('speechSynthesis' in window)) return
  const want = S.lang === 'es' ? 'es' : 'pt'
  const u = new SpeechSynthesisUtterance(text)
  u.lang = S.lang === 'es' ? 'es-419' : 'pt-BR'
  const v = voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(want))
  if (v) u.voice = v
  u.rate = 0.9
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}
const listenBtn = (text, label = '🔊 Listen') =>
  'speechSynthesis' in window ? el('button', { class: 'listen', onclick: () => speak(text) }, label) : null

// ---------- chrome ----------

function chrome(active) {
  const dueN = S.api.due[S.lang].length
  return [
    el('header', {},
      el('span', { class: 'logo' }, 'Lingo Cards'),
      el('button', { class: 'chip', title: 'switch user', onclick: async () => {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
        S.api = null; renderLogin()
      } }, '👤 ', el('b', {}, S.api.me.label.split('@')[0])),
      el('span', { class: 'chip' }, 'Lvl ', el('b', {}, String(S.api.level))),
      el('span', { class: 'chip' }, '🔥', el('b', {}, String(S.api.streak))),
      el('div', { class: 'lang-toggle' },
        el('button', { class: S.lang === 'es' ? 'on' : '', onclick: () => setLang('es') }, 'ES'),
        el('button', { class: S.lang === 'pt' ? 'on' : '', onclick: () => setLang('pt') }, 'PT'))),
    el('nav', {},
      el('a', { href: '#/today', class: active === 'today' ? 'on' : '' }, 'Today', dueN ? el('span', { class: 'badge' }, String(dueN)) : null),
      el('a', { href: '#/study', class: active === 'study' ? 'on' : '' }, 'Study'),
      el('a', { href: '#/progress', class: active === 'progress' ? 'on' : '' }, 'Progress')),
  ]
}
async function setLang(lang) {
  if (S.lang === lang) return
  S.lang = lang
  localStorage.setItem('lang', lang)
  await loadDeck(lang)
  route()
}
function mount(active, ...views) { app.replaceChildren(...chrome(active), ...views.flat(Infinity).filter((v) => v != null && v !== false)) }

// ---------- login ----------

function renderLogin(msg = '') {
  const emailIn = el('input', { type: 'email', placeholder: 'your email', maxlength: 254, value: localStorage.getItem('email') || '', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false' })
  const input = el('input', { type: 'password', placeholder: 'app code', autocomplete: 'off' })
  const err = el('p', { class: 'err' }, msg)
  const go = async () => {
    const email = emailIn.value.trim()
    if (!email) { err.textContent = 'Enter your email.'; emailIn.focus(); return }
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.value, email }), credentials: 'same-origin',
    })
    if (r.ok) { localStorage.setItem('email', email); await boot() }
    else { const j = await r.json().catch(() => ({})); err.textContent = j.error === 'bad-code' || r.status === 401 ? 'Wrong code — try again.' : (j.error || 'Login failed.') }
  }
  emailIn.addEventListener('keydown', (e) => e.key === 'Enter' && input.focus())
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go())
  app.replaceChildren(el('div', { class: 'login' },
    el('img', { src: '/icon.svg', alt: '' }),
    el('h2', {}, 'Lingo Cards'),
    err, emailIn, input,
    el('button', { class: 'cta wide', onclick: go }, 'Enter')))
  ;(emailIn.value ? input : emailIn).focus()
}

// ---------- today / review ----------

let session = null

function viewToday() {
  const due = S.api.due[S.lang]
  const now = Date.now()
  const prog = S.api.progress.filter((p) => p.lang === S.lang)
  const upcoming = prog.filter((p) => { const t = Date.parse(p.due); return t > now && t < now + 2 * 86400e3 }).length
  const fresh = !prog.length && !S.api.studied.some((s) => s.lang === S.lang)

  const panels = []
  if (fresh) {
    panels.push(el('div', { class: 'panel center' },
      el('h2', {}, `¡Empieza! / Vamos começar!`),
      el('p', { class: 'muted' }, `Learn your first ${S.lang === 'es' ? 'Spanish' : 'Portuguese'} words: open `,
        el('a', { href: '#/study', style: 'color:var(--accent2);font-weight:700' }, 'Study'), ' and browse a unit, then take its quiz. Words you pass join your daily reviews here.')))
  }
  panels.push(el('div', { class: 'panel center' },
    el('div', { class: 'muted' }, 'cards due today'),
    el('div', { class: 'big-num' }, String(due.length)),
    due.length
      ? el('button', { class: 'cta wide', style: 'margin-top:10px', onclick: startSession }, 'Start reviewing')
      : el('p', { class: 'muted' }, upcoming ? `Nice — nothing due. ~${upcoming} more within 2 days.` : 'Nothing due. Check back tomorrow, or learn something new!')),
    el('p', { class: 'muted center' }, `Level ${S.api.level} · ${S.api.xp} XP · ${S.api.streak}-day streak`))
  if (!due.length) {
    panels.push(el('div', { class: 'row' },
      el('a', { href: '#/study' }, el('button', { class: 'cta wide' }, '📖 Learn something new')),
      el('a', { href: '#/progress' }, el('button', { class: 'wide' }, 'See progress'))))
  }
  if (S.lang === 'es' && S.api.stageCounts.pt.total) {
    panels.push(el('div', { class: 'panel' }, el('span', { class: 'muted' },
      `You also have ${S.api.stageCounts.pt.total} Portuguese words — tap PT above to switch.`)))
  }
  mount('today', panels)
}

function startSession() {
  const queue = S.api.due[S.lang].map((d) => S.byId[S.lang][d.card]).filter(Boolean)
  if (!queue.length) return route()
  session = { queue, i: 0, done: 0, xp: 0, revealed: false }
  renderReview()
}

function renderReview() {
  const { queue, i, revealed } = session
  if (i >= queue.length) return endSession()
  const card = queue[i]
  const face = el('div', { class: 'flash' },
    el('div', { class: 'term' }, card.term),
    listenBtn(card.term),
    revealed
      ? [el('div', { class: 'en' }, card.en),
         el('div', { class: 'example' }, '“', card.example, '”'),
         el('div', { class: 'muted' }, card.exampleEn),
         listenBtn(card.example, '🔊 Example')]
      : el('div', { class: 'flip-hint' }, 'tap to reveal'))
  face.addEventListener('click', (e) => { if (!revealed && !e.target.closest('button')) reveal() })

  async function reveal() { session.revealed = true; renderReview() }
  async function grade(g) {
    const r = await api('/api/review', { lang: S.lang, card: card.id, grade: g })
    if (r.ok) {
      session.done++; session.xp += r.xp
      const sc = S.api.stageCounts[S.lang]
      const pr = S.api.progress.find((p) => p.id === card.id)
      if (pr && r.stage !== pr.stage) { sc[pr.stage]--; sc[r.stage]++; pr.stage = r.stage }
    }
    session.i++; session.revealed = false
    renderReview()
  }

  mount('today',
    el('div', { class: 'progressbar' }, el('div', { style: `width:${(i / queue.length) * 100}%` })),
    el('p', { class: 'muted center' }, `${i + 1} / ${queue.length}`),
    face,
    revealed
      ? el('div', { class: 'grades' },
          el('button', { class: 'g-again', onclick: () => grade(0) }, 'Again'),
          el('button', { class: 'g-hard', onclick: () => grade(1) }, 'Hard'),
          el('button', { class: 'g-good', onclick: () => grade(2) }, 'Good'),
          el('button', { class: 'g-easy', onclick: () => grade(3) }, 'Easy'))
      : el('button', { class: 'wide', style: 'margin-top:12px', onclick: reveal }, 'Show answer'),
    el('p', { class: 'muted center' }, el('a', { href: '#/today' }, '✕ end session')))
  if (!revealed && 'speechSynthesis' in window) speak(card.term)
}

async function endSession() {
  const { done, xp } = session
  session = null
  await refresh()
  mount('today', el('div', { class: 'panel center' },
    el('div', { class: 'big-num' }, done >= 0 ? '🎉' : ''),
    el('h2', {}, `Reviewed ${done} card${done === 1 ? '' : 's'} · +${xp} XP`),
    el('p', { class: 'muted' }, S.api.due[S.lang].length ? 'More became due while you worked.' : 'All caught up — see you tomorrow!'),
    el('button', { class: 'cta wide', onclick: () => { location.hash = '#/today' } }, 'Done')))
}

// ---------- study ----------

function unitState(lang, unit) {
  if (S.api.bestQuiz[lang + unit]) return 'passed'
  if (S.api.studied.some((s) => s.lang === lang && s.unit_id === unit)) return 'studied'
  return 'new'
}

async function viewStudy() {
  const deck = await loadDeck(S.lang)
  const tiles = deck.units.map((u, i) => {
    const st = unitState(S.lang, u.id)
    return el('a', { href: `#/study/${u.id}`, class: `unit-tile ${st}` },
      el('div', { class: 'n' }, `unit ${u.id.slice(1)}`),
      el('div', { class: 't' }, u.title),
      el('div', { class: 's' }, st === 'passed' ? '✅ passed' : st === 'studied' ? '📖 studied' : '⚪ new'))
  })
  mount('study',
    el('div', { class: 'panel' },
      el('h2', {}, `Units — ${S.lang === 'es' ? 'Español' : 'Português'}`),
      el('p', { class: 'muted' }, 'Read a unit out loud with the 🔊 buttons, then quiz yourself. Passed units enter your spaced-repetition deck.')),
    el('div', { class: 'unit-grid' }, tiles))
}

async function viewStudyUnit(unitId) {
  const deck = await loadDeck(S.lang)
  const unit = deck.units.find((u) => u.id === unitId)
  if (!unit) return location.hash = '#/study'
  let i = 0, flipped = false, seenTo = 0, studySent = S.api.studied.some((s) => s.lang === S.lang && s.unit_id === unitId)

  function render() {
    const card = unit.cards[i]
    const cog = cognateOf(card)
    const finished = i === unit.cards.length - 1
    mount('study',
      el('p', { class: 'muted' }, el('a', { href: '#/study' }, '← units'), ` · ${unit.title} · ${i + 1}/${unit.cards.length}`),
      el('div', { class: 'flash', onclick: (e) => { if (!e.target.closest('button')) { flipped = !flipped; render() } } },
        el('div', { class: 'term' }, card.term),
        listenBtn(card.term),
        cog ? el('div', { class: 'cognate' }, `≈ ${S.lang === 'es' ? 'Portuguese' : 'Spanish'} “${cog}”`) : null,
        flipped
          ? [el('div', { class: 'en' }, card.en), el('div', { class: 'example' }, '“', card.example, '”'),
             el('div', { class: 'muted' }, card.exampleEn), listenBtn(card.example, '🔊 Example')]
          : el('div', { class: 'flip-hint' }, 'tap card to flip')),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { onclick: () => { if (i > 0) { i--; flipped = false; render() } }, disabled: i === 0 ? '' : null }, '← Back'),
        el('button', { class: 'cta', onclick: () => { if (finished) finish(); else { i++; seenTo = Math.max(seenTo, i); flipped = false; render() } } }, finished ? 'Finish ✓' : 'Next →')),
      studySent ? el('p', { class: 'center', style: 'margin-top:14px' },
        el('a', { href: `#/quiz/${unit.id}` }, el('button', { class: 'cta wide' }, 'Take the quiz →'))) : null)
    if ('speechSynthesis' in window) speak(card.term)
  }

  async function finish() {
    if (!studySent) {
      studySent = true
      const r = await api('/api/study', { lang: S.lang, unit: unitId })
      if (r.ok && r.first) { S.api.studied.push({ lang: S.lang, unit_id: unitId }); S.api.xp += 10 }
    }
    render()
  }
  render()
}

// ---------- quiz ----------

const shuffle = (a) => { for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1));[a[j], a[k]] = [a[k], a[j]] } return a }
const pickN = (arr, n) => shuffle([...arr]).slice(0, n)

async function viewQuiz(unitId) {
  const deck = await loadDeck(S.lang)
  const unit = deck.units.find((u) => u.id === unitId)
  if (!unit) return location.hash = '#/study'
  const qs = unit.cards.map((c, idx) => ({ card: c, type: idx % 3 }))
  shuffle(qs)
  let qi = 0, correct = 0, answered = false

  function renderQ() {
    if (qi >= qs.length) return finish()
    const { card, type } = qs[qi]
    answered = false
    const body = []
    const check = (ok, chosenEl, rightEl, g) => {
      if (answered) return
      answered = true
      if (ok) { correct++; }
      chosenEl && chosenEl.classList.add(ok ? 'right' : 'wrong')
      if (!ok && rightEl) rightEl.classList.add('right')
      fb.className = 'feedback ' + (ok ? 'ok' : 'no')
      fb.replaceChildren(document.createTextNode(ok ? '✓ correct' : `✗ ${card.term} — ${card.en}`))
      if (ok && g && g.gloss) fb.append(el('div', { class: 'muted', style: 'margin-top:4px' }, `accepted → “${g.gloss}”`))
      if (!ok && g && g.gloss) fb.append(el('div', { class: 'muted', style: 'margin-top:4px' }, `“${g.gloss}” ≠ “${card.en}”`))
      if (!ok && g && g.english) fb.append(el('div', { class: 'muted', style: 'margin-top:4px' }, `that’s English — type it in ${S.lang === 'es' ? 'Spanish' : 'Portuguese'} 🙂`))
      if (type === 2) fb.append(el('div', { class: 'muted', style: 'margin-top:6px' }, `“${card.example}” — ${card.exampleEn}`))
      setTimeout(() => { qi++; renderQ() }, ok ? 600 : 1600)
    }
    const fb = el('div', { class: 'feedback' })

    if (type === 2) {
      const input = el('input', { placeholder: 'type the translation (accents optional)', autocomplete: 'off', autocapitalize: 'off', spellcheck: false })
      const btn = el('button', { class: 'cta wide' }, 'Check')
      const submit = async () => {
      const val = input.value.trim()
      if (!val || answered) return
      if (typedOk(val, card.term)) return check(true, input, null)
      answered = true
      btn.disabled = true; btn.textContent = 'Checking…'
      let g = null
      try { const r = await fetch('/api/grade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: S.lang, cardId: card.id, answer: val }), credentials: 'same-origin' }); g = await r.json() } catch (e) {}
      answered = false
      check(!!(g && g.correct), input, null, g || undefined)
    }
      btn.onclick = submit
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit())
      const langName = S.lang === 'es' ? 'Spanish' : 'Portuguese'
      input.placeholder = `type it in ${langName.toLowerCase()} (accents optional)`
      body.push(el('p', { class: 'muted', style: 'text-transform:uppercase;letter-spacing:.08em;font-size:12px;margin:0 0 4px' }, `Type in ${langName}:`),
        el('div', { class: 'quiz-q' }, `“${card.en}”`), input, btn)
    } else {
      const askTerm = type === 0 // EN -> target
      const pool = unit.cards.filter((c) => c.id !== card.id)
      const opts = shuffle([card, ...pickN(pool, 3)])
      const btns = opts.map((o) => {
        const b = el('button', {}, askTerm ? o.term : o.en)
        b.onclick = () => check(o.id === card.id, b, btns.find((x) => x.textContent === (askTerm ? card.term : card.en)))
        return b
      })
      body.push(el('div', { class: 'quiz-q' }, askTerm ? card.en : card.term),
        askTerm ? null : listenBtn(card.term),
        el('div', { class: 'opts' }, btns))
    }
    mount('quiz',
      el('p', { class: 'muted' }, el('a', { href: `#/study/${unit.id}` }, `← ${unit.title}`), ` · question ${qi + 1}/${qs.length}`),
      el('div', { class: 'progressbar' }, el('div', { style: `width:${(qi / qs.length) * 100}%` })),
      el('div', { class: 'panel' }, body), fb)
  }

  async function finish() {
    const score = Math.round((correct / qs.length) * 100) / 100
    const passed = score >= 0.8
    const r = await api('/api/quiz', {
      lang: S.lang, unit: unitId, score,
      cardIds: passed ? unit.cards.map((c) => c.id) : [],
    })
    await refresh()
    mount('quiz', el('div', { class: 'panel center' },
      el('div', { class: 'big-num' }, `${Math.round(score * 100)}%`),
      el('h2', {}, passed ? (r.firstPass ? '🎉 First pass! New words unlocked' : '🎉 Passed again') : 'Almost there'),
      el('p', { class: 'muted' }, passed
        ? `+${r.xp} XP — these ${unit.cards.length} words now appear in your daily reviews.`
        : `You need 80% to unlock. Flip back through the unit and try again — you've got this.`),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('a', { href: `#/study/${unit.id}` }, el('button', { class: 'wide' }, 'Re-study')),
        passed
          ? el('a', { href: '#/today' }, el('button', { class: 'cta wide' }, 'Review now'))
          : el('button', { class: 'cta wide', onclick: () => viewQuiz(unitId) }, 'Retry'))))
  }
  renderQ()
}

// ---------- progress ----------

async function viewProgress() {
  const xpNow = S.api.xp
  const lvl = S.api.level
  const cur = 60 * (lvl - 1) ** 2, next = 60 * lvl ** 2
  const pct = Math.min(100, Math.round(((xpNow - cur) / (next - cur)) * 100))

  const langPanels = ['es', 'pt'].map((lang) => {
    const sc = S.api.stageCounts[lang]
    const total = S.deckTotal[lang] || 1
    const known = sc.total || 1
    const seg = (cls, n) => el('div', { class: cls, style: `width:${(n / known) * 100}%` })
    const unitDivs = []
    for (let i = 1; i <= 24; i++) {
      const id = 'u' + String(i).padStart(2, '0')
      const st = unitState(lang, id)
      unitDivs.push(el('i', { class: st === 'new' ? '' : st }, String(i)))
    }
    return el('div', { class: 'panel' },
      el('h2', {}, `${lang === 'es' ? '🇪🇸 Español' : '🇧🇷 Português'} — ${sc.total}/${total} words started`),
      el('div', { class: 'stagebar' }, seg('seg-learning', sc.learning), seg('seg-young', sc.young), seg('seg-mature', sc.mature)),
      el('div', { class: 'legend' },
        el('span', {}, el('i', { class: 'dot', style: 'background:var(--amber)' }), `learning ${sc.learning}`),
        el('span', {}, el('i', { class: 'dot', style: 'background:var(--teal)' }), `young ${sc.young}`),
        el('span', {}, el('i', { class: 'dot', style: 'background:var(--green)' }), `mature ${sc.mature}`),
        el('span', { class: 'muted' }, 'mature = remembered 3+ weeks')),
      el('p', { class: 'muted', style: 'margin:12px 0 6px' }, 'units'),
      el('div', { class: 'mini-units' }, unitDivs))
  })

  const days = S.api.activity
  const heat = []
  const today = new Date()
  for (let d = 27; d >= 0; d--) {
    const dt = new Date(today.getTime() - d * 86400e3)
    const iso = dt.toISOString().slice(0, 10)
    const a = days.find((x) => x.day === iso)
    const lvlCls = !a || !a.xp ? '' : a.xp < 30 ? 'l1' : a.xp < 80 ? 'l2' : 'l3'
    heat.push(el('i', { class: lvlCls, title: `${iso}: ${a ? a.xp + ' xp' : 'rest day'}` }))
  }
  const totalReviews = days.reduce((s, a) => s + a.reviews, 0)

  let loginRows = []
  try { loginRows = (await api('/api/logins')).logins.slice(0, 5) } catch {}
  const loginPanel = loginRows.length ? el('div', { class: 'panel' },
    el('h2', {}, 'Recent sign-ins'),
    el('p', { class: 'muted', style: 'margin:0' }, loginRows.map((l) =>
      el('div', {}, `${l.ts} UTC · ${l.ok ? '✅' : '✗'} ${l.who || '?'} · ${l.country} (${l.ip})`)))) : null

  mount('progress',
    el('div', { class: 'panel center' },
      el('div', { class: 'muted' }, `level ${lvl} · ${xpNow} XP`),
      el('div', { class: 'big-num' }, `Lvl ${lvl}`),
      el('div', { class: 'progressbar', style: 'margin:10px 0 4px' }, el('div', { style: `width:${pct}%` })),
      el('p', { class: 'muted' }, `${next - xpNow} XP to level ${lvl + 1} · 🔥 ${S.api.streak} day streak · ${totalReviews} reviews`)),
    langPanels,
    el('div', { class: 'panel' },
      el('h2', {}, 'Last 28 days'),
      el('div', { class: 'heat' }, heat)),
    loginPanel)
}

// ---------- router ----------

function route() {
  if (!S.api) return
  const h = location.hash || '#/today'
  const m = h.match(/^#\/(today|study|quiz|progress)(\/(u\d{2}))?/)
  if (!m || m[1] === 'today') return viewToday()
  if (m[1] === 'progress') return viewProgress()
  if (m[1] === 'quiz' && m[3]) return viewQuiz(m[3])
  if (m[1] === 'study' && m[3]) return viewStudyUnit(m[3])
  return viewStudy()
}

async function boot() {
  await Promise.all([loadDeck('es'), loadDeck('pt')])
  await refresh()
  window.addEventListener('hashchange', route)
  route()
}

api('/api/state').then(async (st) => {
  if (st.error === 'unauthorized') return renderLogin()
  S.api = st
  await boot()
}).catch(() => renderLogin())
