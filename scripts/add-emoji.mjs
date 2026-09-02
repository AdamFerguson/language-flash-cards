#!/usr/bin/env node
// Attach an `emoji` field to every card that lacks one (re-runnable: --all re-does all).
// Backend (preferred): local ollama — zero cloud quota (that free tier is reserved
// for the running app's grading). --cloud opts back into Workers AI explicitly.
// Run: node scripts/add-emoji.mjs [--all] [--cloud] [ollama-model]
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

import { execSync } from 'node:child_process'
const CFG = `${process.env.HOME}/.config/.wrangler/config/default.toml`
const readToken = () => readFileSync(CFG, 'utf8').match(/^oauth_token = "([^"]+)"/m)[1]
let TOKEN = readToken()
const USE_CLOUD = process.argv.includes('--cloud')
const OLLAMA_MODEL = process.argv.find((a) => !a.startsWith('--') && !a.includes('node') && !a.includes('add-emoji')) || 'translategemma:4b'
const ACCT = 'c33a3a469a14e5f53752900e9f02734e'
const MODEL = '@cf/google/gemma-4-26b-a4b-it'
const EMOJI_ONLY = /^(\p{Extended_Pictographic}(?:\uFE0F?\p{Extended_Pictographic})*|[\u{1F3FB}-\u{1F3FF}\u200D\uFE0F])+$/u
const LANG_NAME = { es: 'Spanish', pt: 'Brazilian Portuguese' }
const NEURON_BUDGET = 8000
let neuronsUsed = 0

async function ask(prompt, maxTokens = 2500) {
  if (!USE_CLOUD) { // local ollama — no cloud quota, no token rotation games
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, keep_alive: '30m', options: { temperature: 0 }, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 120)}`)
    const j = await res.json()
    return String(j.message?.content ?? '')
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${MODEL}`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, enable_thinking: false }),
    })
    if (res.status === 401) { // oauth tokens rotate on any wrangler command — refresh and retry once
      execSync('npx wrangler whoami >/dev/null 2>&1'); TOKEN = readToken(); continue
    }
    if (!res.ok) throw new Error(`ai ${res.status}: ${(await res.text()).slice(0, 120)}`)
    const j = await res.json()
    neuronsUsed += j.result?.usage?.neurons || 0
    return String(j.result?.response ?? j.result?.choices?.[0]?.message?.content ?? '')
  }
  throw new Error('ai: 401 persists after token refresh')
}

const wantAll = process.argv.includes('--all')
for (const lang of ['es', 'pt']) {
  const path = `public/decks/${lang}.json`
  const deck = JSON.parse(readFileSync(path, 'utf8'))
  const cards = deck.units.flatMap((u) => u.cards).filter((c) => wantAll || !c.emoji)
  console.log(`${lang}: ${cards.length} cards to emoji`)
  const byId = {}
  for (let i = 0; i < cards.length; i += 10) {
    if (neuronsUsed > NEURON_BUDGET) { console.log('neuron budget reached — rerun later to finish'); break }
    const batch = cards.slice(i, i + 10)
    const lines = batch.map((c) => `${c.id}: ${c.term} = ${c.en}`).join('\n')
    const prompt = `Pick ONE emoji that visually depicts each item for a language learner (concrete objects/actions/places/people/numbers: literal emoji; feelings/abstract phrases: the closest symbolic emoji). Reply ONLY with a JSON array like [{"id":"x","emoji":"🐶"}], one entry per id, no text around it.\n\n${lines}`
    let parsed = []
    for (let attempt = 0; attempt < 2 && !parsed.length; attempt++) {
      try {
        const out = await ask(attempt ? `Reply ONLY with the JSON array, nothing else. Example shape [{"id":"a1","emoji":"🐶"}]. No markdown.\n\n${lines}` : prompt)
        const m = out.match(/\[[\s\S]*\]/)
        if (m) parsed = JSON.parse(m[0])
      } catch (e) { console.error(`\n  batch@${i}: ${e.message}`) }
    }
    await new Promise((r) => setTimeout(r, 250))
    for (const p of parsed) {
      if (!batch.some((c) => c.id === p.id) || !p.emoji) continue
      const e = String(p.emoji).trim()
      if (EMOJI_ONLY.test(e)) byId[p.id] = e
    }
    process.stdout.write('.')
  }
  console.log()
  let set = 0
  for (const c of cards) if (byId[c.id]) { c.emoji = byId[c.id]; set++ }
  writeFileSync(path + '.tmp', JSON.stringify(deck, null, 1) + '\n')
  renameSync(path + '.tmp', path)
  console.log(`${lang}: emoji set on ${set}/${cards.length} (neurons so far: ${Math.round(neuronsUsed)})`)
}
