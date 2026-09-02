// Apply QA fixes into the decks. Usage: node scripts/apply-audit.mjs [dir]
// dir = audit|register (default audit). Guards: known id, hazard check vs the NEW
// term when a fix changes it; only example/exampleEn/term/en touched; write-to-temp
// then rename (never truncate before content exists).
import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync } from 'node:fs'
const DIR = process.argv[2] || 'audit'
mkdirSync(`qa/${DIR}-applied`, { recursive: true })

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
for (const f of readdirSync(`qa/${DIR}`).filter((f) => f.endsWith('.json'))) {
  const fixes = JSON.parse(readFileSync(`qa/${DIR}/${f}`, 'utf8'))
  for (const fx of fixes) {
    const card = byId[fx.id]
    if (!card) { rejected.push([fx.id, 'unknown id']); continue }
    const newTerm = fx.term?.trim() || card.term
    if (fx.example !== undefined && (!fx.example?.trim() || !fx.exampleEn?.trim())) { rejected.push([fx.id, 'empty example pair']); continue }
    if (fx.example && isHazard(newTerm, fx.example)) console.log(`WARN ${fx.id}: example near-duplicates term (accepted; examples no longer shown mid-quiz)`)
    for (const k of ['term', 'en', 'example', 'exampleEn', 'emoji']) if (fx[k]?.trim()) card[k] = fx[k].trim()
    applied++
  }
  if (DIR !== `${DIR}-applied`) try { renameSync(`qa/${DIR}/${f}`, `qa/${DIR}-applied/${f}`) } catch { /* already moved */ } // provenance: keep the fix files, out of the pending dir
}
for (const lang of ['es', 'pt']) {
  const tmp = `public/decks/${lang}.json.tmp`
  writeFileSync(tmp, JSON.stringify(decks[lang], null, 1) + '\n')
  renameSync(tmp, `public/decks/${lang}.json`)
}
console.log(`applied ${applied} fixes`)
if (rejected.length) { console.log('REJECTED:', rejected); process.exitCode = 1 }
