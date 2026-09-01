// SM-2 variant with 4 grades. Pure functions, no I/O.
// card: { ease, reps, interval (days), lapses }
// grade: 0 again | 1 hard | 2 good | 3 easy
// Returns updated card + due ISO datetime.

export const GRADES = ['again', 'hard', 'good', 'easy']
const Q = { 0: 2, 1: 3, 2: 4, 3: 5 }

export function review(card, grade, now = new Date()) {
  const q = Q[grade]
  if (q === undefined) throw new Error('bad grade: ' + grade)
  let { ease = 2.5, reps = 0, interval = 0, lapses = 0 } = card

  let due, nextInterval
  if (q < 3) {
    // lapse: back to relearn step
    ease = Math.max(1.3, ease - 0.2)
    reps = 0
    lapses += 1
    interval = 0
    nextInterval = 0
    due = new Date(now.getTime() + 10 * 60 * 1000) // 10 minutes
  } else {
    ease = Math.min(3.0, Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))))
    reps += 1
    if (reps === 1) nextInterval = 1
    else if (reps === 2) nextInterval = 6
    else if (grade === 1) nextInterval = interval * 1.2 // hard grows slowly
    else if (grade === 3) nextInterval = interval * ease * 1.3 // easy jumps
    else nextInterval = interval * ease
    interval = nextInterval
    due = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)
  }
  return { ease, reps, interval, lapses, due: due.toISOString(), stage: stageFor(interval) }
}

export function stageFor(intervalDays) {
  if (intervalDays >= 21) return 'mature'
  if (intervalDays >= 7) return 'young'
  return 'learning'
}

// XP for a graded review
export function reviewXp(grade) {
  return [3, 8, 10, 14][grade]
}

// Level curve: level n costs 60*(n-1)^2 total XP
export function levelFor(xp) {
  return Math.floor(Math.sqrt(xp / 60)) + 1
}
export function xpForLevel(level) {
  return 60 * (level - 1) * (level - 1)
}

// Streak from activity days (Set of 'YYYY-MM-DD'). Counts back from today;
// a not-yet-practiced today doesn't break yesterday's streak.
export function streakFor(days, today = new Date()) {
  const iso = (d) => d.toISOString().slice(0, 10)
  let streak = 0
  const cursor = new Date(today)
  if (!days.has(iso(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1)
  while (days.has(iso(cursor))) {
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}
