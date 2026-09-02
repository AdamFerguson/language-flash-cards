#!/usr/bin/env node
// Offline content QA for the decks. Sources, cheapest/hardest-first:
//   words  - every es/pt token must be a real word/form (kaikki.org Wiktionary extracts)
//   lt     - LanguageTool public API grammar sweep of all example sentences
//   mt     - TranslateGemma (local ollama) fidelity: gloss(term) ≈ en
//   all    - run words, lt, mt, then write qa/findings-<date>.json + digest
// Findings are a REVIEW QUEUE — nothing here edits the decks.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import zlib from 'node:zlib'
import { createInterface } from 'node:readline'

const KAIKKI = { es: '/tmp/kaikki/es-extract.jsonl.gz', pt: '/tmp/kaikki/pt-extract.jsonl.gz' }
const LT_LANG = { es: 'es', pt: 'pt-BR' }
const TARGET_NAME = { es: 'Spanish', pt: 'Portuguese' }
const TODAY = new Date().toISOString().slice(0, 10)
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const toks = (s) => new Set(norm(s).split(' ').filter(Boolean))
const coverage = (a, b) => { // fraction of a-tokens present in b
  const A = toks(a), B = toks(b)
  if (!A.size) return 1
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / A.size
}

const decks = {}
for (const lang of ['es', 'pt']) decks[lang] = JSON.parse(readFileSync(`public/decks/${lang}.json`, 'utf8'))
const cardsOf = (lang) => decks[lang].units.flatMap((u) => u.cards)

async function loadVocab(lang) {
  const cache = `qa/.vocab-${lang}.json`
  if (existsSync(cache)) return new Set(JSON.parse(readFileSync(cache, 'utf8')))
  const vocab = new Set()
  for (const src of Object.values(KAIKKI)) {
    if (!existsSync(src)) throw new Error(`missing ${src} — download kaikki extracts first`)
    await new Promise((res, rej) => {
      const rl = createInterface({ input: spawn('gunzip', ['-c', src]).stdout })
      rl.on('line', (l) => {
        try {
          const d = JSON.parse(l)
          if (d.lang_code === lang) {
            vocab.add(norm(d.word || '').replace(/ /g, '_'))
            for (const f of d.forms || []) if (f.form) vocab.add(norm(f.form).replace(/ /g, '_'))
          }
        } catch { /* partial lines at EOF */ }
      })
      rl.on('close', res)
      rl.on('error', rej)
    })
  }
  mkdirSync('qa', { recursive: true })
  writeFileSync(cache, JSON.stringify([...vocab]))
  return vocab
}

// ---------- words ----------
async function words() {
  const out = []
  for (const lang of ['es', 'pt']) {
    const vocab = await loadVocab(lang)
    const other = await loadVocab(lang === 'es' ? 'pt' : 'es')
    for (const c of cardsOf(lang)) {
      for (const [field, text] of [['term', c.term], ['example', c.example]]) {
        const wordsRaw = text.match(/\p{L}+/gu) || []
        for (let i = 0; i < wordsRaw.length; i++) {
          const w = wordsRaw[i]
          if (w.length < 3) continue
          const key = norm(w)
          if (vocab.has(key)) continue
          out.push({ card: c.id, field, word: w, otherLang: other.has(key) ? 1 : 0, properish: i > 0 && /^[\p{Lu}]/u.test(w) ? 1 : 0 })
        }
      }
    }
    console.log(`words[${lang}]: vocab ${vocab.size}`)
  }
  writeFileSync(`qa/findings-words.json`, JSON.stringify(out, null, 1))
  return out
}

// ---------- LanguageTool ----------
async function lt() {
  const out = []
  for (const lang of ['es', 'pt']) {
    const cards = cardsOf(lang)
    let text = ''
    const idx = []
    const flush = async () => {
      if (!text) return
      const body = new URLSearchParams({ language: LT_LANG[lang], text, level: 'default' })
      const res = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST', body, headers: { 'User-Agent': 'lingo-cards-content-qa one-off audit contact: adam.b.ferguson@pm.me', 'content-type': 'application/x-www-form-urlencoded' },
      })
      if (!res.ok) { console.log(`lt[${lang}] HTTP ${res.status} — skipping chunk`); text = ''; idx.length = 0; return }
      const j = await res.json()
      for (const m of j.matches) {
        const pos = idx.find((x) => m.offset >= x.start && m.offset < x.end)
        out.push({ card: pos ? pos.id : '?', rule: (m.rule && m.rule.issue || m.message || '').slice(0, 160), ruleId: m.rule && m.rule.id, sentence: cards[pos.i].example })
      }
      console.log(`lt[${lang}]: ${j.matches.length} matches in ${text.length} chars, next in 65s`)
      text = ''; idx.length = 0
    }
    for (let i = 0; i < cards.length; i++) {
      const s = cards[i].example + '\n'
      if (text.length + s.length > 14000) { await flush(); await new Promise((r) => setTimeout(r, 65000)) }
      idx.push({ id: cards[i].id, i, start: text.length, end: text.length + s.length })
      text += s
    }
    await flush()
    if (lang === 'es') await new Promise((r) => setTimeout(r, 65000))
  }
  writeFileSync('qa/findings-lt.json', JSON.stringify(out, null, 1))
  return out
}

// ---------- TranslateGemma fidelity (local ollama) ----------
async function mtGloss(text, from, to) {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'translategemma:4b', stream: false, keep_alive: '30m', options: { temperature: 0 },
      messages: [{ role: 'user', content: `Translate the following text to ${to}. Output ONLY the translation, nothing else:\n\n${text}` }],
    }),
  })
  const j = await res.json()
  const out = String((j.message && j.message.content) || '')
  return out.split('\n').map((l) => l.trim()).find((l) => l && !/^[*-]/.test(l)) || out
}

async function mt() {
  const out = []
  let done = 0
  const queue = []
  for (const lang of ['es', 'pt']) for (const c of cardsOf(lang)) queue.push({ lang, c })
  const worker = async () => {
    for (;;) {
      const item = queue.pop()
      if (!item) return
      const { lang, c } = item
      try {
        const gloss = (await mtGloss(c.term, TARGET_NAME[lang], 'English')).trim()
        const ok = coverage(c.en, gloss) >= 0.85 || coverage(gloss, c.en) >= 0.85
        if (!ok) out.push({ card: c.id, kind: 'fwd', term: c.term, en: c.en, gloss })
        done++
        if (done % 100 === 0) console.log(`mt: ${done}/${queue.length + done} checked`)
      } catch (e) { out.push({ card: c.id, kind: 'error', err: String(e.message || e) }) }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  writeFileSync('qa/findings-mt.json', JSON.stringify(out, null, 1))
  return out
}

// ---------- main ----------
const mode = process.argv[2] || 'all'
const results = {}
if (mode === 'words' || mode === 'all') results.words = await words()
if (mode === 'lt' || mode === 'all') results.lt = await lt()
if (mode === 'mt' || mode === 'all') results.mt = await mt()

const flaggedCards = new Set()
for (const f of results.words || []) flaggedCards.add(f.card)
for (const f of results.lt || []) flaggedCards.add(f.card)
for (const f of results.mt || []) flaggedCards.add(f.card)
const summary = { date: TODAY, words: (results.words || []).length, lt: (results.lt || []).length, mt: (results.mt || []).length, distinctCards: flaggedCards.size }
writeFileSync(`qa/findings-${TODAY}.json`, JSON.stringify({ summary, words: results.words, lt: results.lt, mt: results.mt }, null, 1))
console.log('\n=== DIGEST ===')
console.log(JSON.stringify(summary))
for (const f of (results.mt || []).slice(0, 8)) console.log(' mt  ', f.card, '|', f.term, '| en:', f.en, '| gloss:', f.gloss)
for (const f of (results.lt || []).slice(0, 8)) console.log(' lt  ', f.card, '|', f.rule.slice(0, 80))
for (const f of (results.words || []).slice(0, 8)) console.log(' word', f.card, '|', f.field, '| token:', f.word, f.otherLang ? '(other-lang word)' : '', f.properish ? '(capitalized?)' : '')
