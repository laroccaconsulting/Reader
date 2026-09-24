/* On-device reading statistics: time read per day and per book, streaks.
 * Never leaves the device. Time only counts while the reader is visible and
 * the user has turned a page in the last two minutes. */

import * as db from './db.js'

const IDLE_MS = 2 * 60 * 1000
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

let current = null   // { bookId, lastActive }
let timer = null
let pending = 0      // ms not yet flushed
let pendingBook = null

async function flush() {
  if (!pending || !pendingBook) return
  const seconds = Math.round(pending / 1000)
  pending = 0
  if (!seconds) return
  const stats = await db.kvGet('stats', { days: {}, books: {} })
  const day = dayKey()
  stats.days[day] = (stats.days[day] ?? 0) + seconds
  stats.books[pendingBook] = (stats.books[pendingBook] ?? 0) + seconds
  await db.kvSet('stats', stats)
}

function tick() {
  if (!current || document.hidden) return
  const now = Date.now()
  if (now - current.lastActive < IDLE_MS) {
    pending += 5000
    pendingBook = current.bookId
    if (pending >= 30000) flush()
  }
}

export function startSession(bookId) {
  current = { bookId, lastActive: Date.now() }
  clearInterval(timer)
  timer = setInterval(tick, 5000)
}

export function activity() {
  if (current) current.lastActive = Date.now()
}

export async function endSession() {
  clearInterval(timer)
  current = null
  await flush()
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })

export async function summary() {
  await flush()
  const stats = await db.kvGet('stats', { days: {}, books: {} })
  const today = stats.days[dayKey()] ?? 0
  let streak = 0
  const d = new Date()
  if (!stats.days[dayKey(d)]) d.setDate(d.getDate() - 1) // today not started yet doesn't break the streak
  while (stats.days[dayKey(d)] >= 60) { streak++; d.setDate(d.getDate() - 1) }
  const week = Array.from({ length: 7 }, (_, i) => {
    const x = new Date(); x.setDate(x.getDate() - (6 - i))
    return { day: x, seconds: stats.days[dayKey(x)] ?? 0 }
  })
  const total = Object.values(stats.days).reduce((a, b) => a + b, 0)
  return { today, streak, week, total, books: stats.books }
}
