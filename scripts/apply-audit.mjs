// Apply grammar/decoy audit fixes (public/decks/audit/*.json) into the decks.
// Guards: known id, only example/exampleEn touched, new example not a near-duplicate of the term.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const isHazard = (term, ex) => {
  const tw = new Set(norm(term).split(' ')), ew = new Set(norm(ex).split(' '))
  if (!ex || !tw.size || !ew.size) return false
  let extra = 0
  for (const w of ew) if (!tw.has(w)) extra++
  return extra <= 2 && ew.size >= tw.size * 0.6
}

const decks = { es: JSON.parse(readFileSync('public/decks/es.json', 'utf8')), pt: JSON.parse(readFileSync('public/decks/pt.json', 'utf8')) }
const byId = {}
for (const lang of ['es', 'pt']) for (const u of decks[lang].units) for (const c of u.cards) byId[c.id] = c

let applied = 0, rejected = []
for (const f of readdirSync('public/decks/audit').filter((f) => f.endsWith('.json'))) {
  const fixes = JSON.parse(readFileSync(`public/decks/audit/${f}`, 'utf8'))
  for (const fx of fixes) {
    const card = byId[fx.id]
    if (!card) { rejected.push([fx.id, 'unknown id']); continue }
    if (!fx.example?.trim() || !fx.exampleEn?.trim()) { rejected.push([fx.id, 'empty field']); continue }
    if (isHazard(card.term, fx.example)) { rejected.push([fx.id, 'new example still a near-duplicate of the term']); continue }
    card.example = fx.example.trim()
    card.exampleEn = fx.exampleEn.trim()
    applied++
  }
}
for (const lang of ['es', 'pt']) writeFileSync(`public/decks/${lang}.json`, JSON.stringify(decks[lang], null, 1) + '\n')
console.log(`applied ${applied} fixes`)
if (rejected.length) { console.log('REJECTED:', rejected); process.exitCode = 1 }
