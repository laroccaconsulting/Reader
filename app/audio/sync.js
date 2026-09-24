/* Where is the narrator? A track's time maps onto its stretch of the book
 * (`from`–`to`, as book fractions) through a few fixed points: the end of the
 * spoken introduction ("This is a LibriVox recording…"), any spots the reader
 * has marked by tapping the word they heard, and the start of the sign-off.
 * Between points, narration is assumed to move through the text evenly.
 * Pure functions: unit-tested under node. */

export const DEFAULT_LEAD = 18 // seconds of LibriVox introduction before the text starts
export const DEFAULT_TAIL = 8  // "End of chapter… read by…"

/** Time→fraction points for one track, sorted by time. */
export function syncPoints({ from, to, duration, lead = DEFAULT_LEAD, tail = DEFAULT_TAIL, anchors = [] }) {
  const D = duration > 0 ? duration : 0
  const l = Math.min(lead, D * 0.3), tl = Math.min(tail, D * 0.1)
  const marks = anchors
    .filter(a => a.t >= 0 && a.t <= D && a.f >= from && a.f <= to)
    .sort((a, b) => a.t - b.t)
    // keep time and text moving forward together
    .filter((a, i, arr) => arr.slice(0, i).every(b => b.f < a.f))
  const first = marks[0], last = marks[marks.length - 1]
  const points = []
  if (!first || first.t > l) points.push({ t: first ? Math.min(l, first.t * (0.999)) : l, f: from })
  points.push(...marks)
  if (!last || last.t < D - tl) points.push({ t: Math.max(D - tl, last?.t ?? 0), f: to })
  return points
}

export function timeToFraction(points, t) {
  if (!points.length) return null
  if (t <= points[0].t) return points[0].f
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (t <= b.t) return b.t === a.t ? b.f : a.f + (t - a.t) / (b.t - a.t) * (b.f - a.f)
  }
  return points[points.length - 1].f
}

export function fractionToTime(points, f) {
  if (!points.length) return 0
  if (f <= points[0].f) return points[0].t
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (f <= b.f) return b.f === a.f ? b.t : a.t + (f - a.f) / (b.f - a.f) * (b.t - a.t)
  }
  return points[points.length - 1].t
}

/**
 * A mark near the start of a chapter tells us how long this narrator's
 * introduction is; that carries over to the recording's other tracks.
 * Returns null when the mark is too far in to say.
 */
export function leadFromAnchor({ from, to, duration, tail = DEFAULT_TAIL }, { t, f }) {
  const p = (f - from) / (to - from)
  if (!(p >= 0 && p < 0.12) || !(duration > 0)) return null
  const lead = (t - p * (duration - tail)) / (1 - p)
  return lead >= 0 && lead <= 90 ? lead : null
}
