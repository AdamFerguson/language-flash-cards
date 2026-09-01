// Merge public/decks/parts/{lang}-lane{1..4}.json into public/decks/{lang}.json
// Assigns card ids "<lang>-<unit>-NNN", dedupes terms per language, validates shape.
import { readFileSync, writeFileSync } from 'node:fs'

const UNIT_TITLES = {
  u01: 'Greetings & Introductions', u02: 'Please, Thanks & Politeness', u03: 'Numbers & Counting',
  u04: 'Days, Months & Calendar', u05: 'Time, Frequency & Speed', u06: 'Family & People',
  u07: 'Food: Meals & Staples', u08: 'Fruits, Vegetables & Kitchen', u09: 'Drinks & Café',
  u10: 'At the Restaurant', u11: 'House & Rooms', u12: 'Objects & Furniture',
  u13: 'City & Places', u14: 'Directions & Transport', u15: 'Travel: Airport & Hotel',
  u16: 'Shopping & Money', u17: 'Work & School', u18: 'Body & Health',
  u19: 'Weather & Nature', u20: 'Animals', u21: 'Colors, Sizes & Opposites',
  u22: 'Feelings & Personality', u23: 'Everyday Verbs', u24: 'Communication & Question Words',
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/^(el|la|los|las|o|a|os|as|um|uma)\s+/, '').replace(/\s+se$/, '').trim()

for (const lang of ['es', 'pt']) {
  const units = new Map()
  for (let k = 1; k <= 4; k++) {
    const part = JSON.parse(readFileSync(`public/decks/parts/${lang}-lane${k}.json`, 'utf8'))
    if (part.lang !== lang) throw new Error(`${lang} lane${k} has wrong lang`)
    for (const u of part.units) {
      if (!UNIT_TITLES[u.id]) throw new Error(`unknown unit ${u.id}`)
      if (!units.has(u.id)) units.set(u.id, [])
      units.get(u.id).push(...u.cards)
    }
  }

  const seen = new Set()
  const out = []
  for (const id of Object.keys(UNIT_TITLES)) {
    const cards = units.get(id)
    if (!cards) throw new Error(`${lang} missing ${id}`)
    const final = []
    for (const c of cards) {
      for (const f of ['term', 'en', 'example', 'exampleEn']) {
        if (typeof c[f] !== 'string' || !c[f].trim()) throw new Error(`${lang} ${id} bad card field ${f}: ${JSON.stringify(c)}`)
      }
      const key = norm(c.term) + '|' + norm(c.en)
      if (seen.has(key)) continue
      seen.add(key)
      final.push(c)
    }
    final.forEach((c, i) => { c.id = `${lang}-${id}-${String(i + 1).padStart(3, '0')}` })
    out.push({ id, title: UNIT_TITLES[id], cards: final })
  }
  writeFileSync(`public/decks/${lang}.json`, JSON.stringify({ lang, units: out }, null, 1))
  const total = out.reduce((s, u) => s + u.cards.length, 0)
  console.log(`${lang}: ${out.length} units, ${total} cards (dupes dropped: ${out.reduce((s, u) => s + (units.get(u.id).length - u.cards.length), 0)})`)
}
