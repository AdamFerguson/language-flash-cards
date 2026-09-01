import test from 'node:test'
import assert from 'node:assert/strict'
import { review, stageFor, levelFor, streakFor } from '../src/srs.js'

const T = (s) => new Date(s)
const DAY = 24 * 60 * 60 * 1000

test('new card: good gives 1d, 6d, then ease-scaled intervals', () => {
  let c = { ease: 2.5, reps: 0, interval: 0, lapses: 0 }
  const t0 = T('2026-09-01T12:00:00Z')
  c = review(c, 2, t0)
  assert.equal(c.reps, 1)
  assert.equal(c.interval, 1)
  assert.equal(c.due, new Date(t0.getTime() + DAY).toISOString())
  c = review(c, 2, t0)
  assert.equal(c.interval, 6)
  c = review(c, 2, t0)
  assert.equal(c.interval, 15) // SM-2: 'good' keeps ease at 2.5 → 6*2.5
  assert.equal(c.stage, 'young') // 15d
  c = review(c, 2, t0)
  assert.equal(c.stage, 'mature') // ~40d
})

test('again lapses: 10-minute relearn, reps reset, lapses++', () => {
  const c0 = { ease: 2.5, reps: 5, interval: 30, lapses: 1 }
  const t0 = T('2026-09-01T12:00:00Z')
  const c = review(c0, 0, t0)
  assert.equal(c.due, new Date(t0.getTime() + 10 * 60 * 1000).toISOString())
  assert.equal(c.reps, 0)
  assert.equal(c.interval, 0)
  assert.equal(c.lapses, 2)
  assert.equal(c.stage, 'learning')
  assert.ok(c.ease < 2.5)
})

test('ease floor 1.3, hard slower than good, easy faster', () => {
  const base = { ease: 1.35, reps: 3, interval: 10, lapses: 0 }
  const t0 = T('2026-09-01T12:00:00Z')
  assert.ok(review(base, 1, t0).interval < review(base, 2, t0).interval)
  assert.ok(review(base, 2, t0).interval < review(base, 3, t0).interval)
  let c = { ease: 1.3, reps: 3, interval: 10, lapses: 0 }
  for (let i = 0; i < 5; i++) c = review(c, 0, t0) // repeated lapses
  assert.equal(c.ease, 1.3)
})

test('stage thresholds', () => {
  assert.equal(stageFor(0), 'learning')
  assert.equal(stageFor(6.9), 'learning')
  assert.equal(stageFor(7), 'young')
  assert.equal(stageFor(20.9), 'young')
  assert.equal(stageFor(21), 'mature')
})

test('level curve', () => {
  assert.equal(levelFor(0), 1)
  assert.equal(levelFor(59), 1)
  assert.equal(levelFor(60), 2)
  assert.equal(levelFor(240), 3)
})

test('streak: today continues, missing today keeps yesterday', () => {
  const days = new Set(['2026-08-30', '2026-08-31', '2026-09-01'])
  assert.equal(streakFor(days, T('2026-09-01T09:00:00Z')), 3)
  assert.equal(streakFor(new Set(['2026-08-31']), T('2026-09-01T09:00:00Z')), 1)
  assert.equal(streakFor(new Set(['2026-08-30']), T('2026-09-01T09:00:00Z')), 0)
})
