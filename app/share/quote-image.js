/* Renders a quote card as a PNG, entirely on the device (canvas).
 * Formats suit posts (square), stories (tall) and link previews (wide). */

export const FORMATS = {
  square: { w: 1080, h: 1080, label: 'Square' },
  story: { w: 1080, h: 1920, label: 'Story' },
  wide: { w: 1200, h: 630, label: 'Wide' },
}

export const STYLES = {
  paper: { label: 'Paper', bg: '#F7F3EA', text: '#2A241C', muted: '#7A6F60', accent: '#8C5A2B', rule: 'rgba(42,36,28,.18)' },
  ink: { label: 'Ink', bg: '#16151A', text: '#EFEBE3', muted: '#9A958C', accent: '#B4A8E0', rule: 'rgba(239,235,227,.2)' },
  cover: { label: 'Cover', bg: null, text: '#FFFFFF', muted: 'rgba(255,255,255,.78)', accent: 'rgba(255,255,255,.9)', rule: 'rgba(255,255,255,.35)' },
}

const SERIF = `'Literata', Georgia, serif`
const SANS = `'Atkinson Hyperlegible', system-ui, sans-serif`

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`400 40px ${SERIF}`), document.fonts.load(`italic 400 40px ${SERIF}`),
      document.fonts.load(`600 40px ${SERIF}`), document.fonts.load(`400 20px ${SANS}`), document.fonts.load(`700 20px ${SANS}`),
    ])
  } catch { /* fall back to system fonts */ }
}

function wrap(ctx, text, maxWidth) {
  const lines = []
  for (const para of text.split(/\n+/)) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word }
      else line = test
    }
    if (line) lines.push(line)
  }
  return lines
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * (1 + amount)))))
  return `rgb(${c.join(',')})`
}

/** Draw the card; returns the canvas. */
export async function drawQuote({ text, title, author, sourceLabel = '', coverColor = '#5E51A0' }, { format = 'square', style = 'paper' } = {}) {
  await fontsReady()
  const { w, h } = FORMATS[format]
  const s = STYLES[style]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  // Background
  if (style === 'cover') {
    const color = /^#[0-9a-f]{6}$/i.test(coverColor) ? coverColor : '#5E51A0'
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, shade(color, 0.12))
    g.addColorStop(1, shade(color, -0.22))
    ctx.fillStyle = g
  } else ctx.fillStyle = s.bg
  ctx.fillRect(0, 0, w, h)
  if (style === 'cover') {
    ctx.fillStyle = 'rgba(0,0,0,.16)'
    ctx.fillRect(0, 0, Math.round(w * 0.025), h) // book spine
  }

  const pad = Math.round(Math.min(w, h) * (format === 'wide' ? 0.08 : 0.1))
  const footerH = format === 'wide' ? 96 : format === 'story' ? 260 : 190
  const top = format === 'story' ? Math.round(h * 0.16) : pad
  const maxW = w - pad * 2
  const maxH = h - top - pad - footerH

  // Fit the quote: largest size whose wrapped lines fit
  const markSize = format === 'wide' ? 90 : 150
  const markGap = markSize * 0.62
  let size = format === 'wide' ? 44 : format === 'story' ? 64 : 58
  let lines, lh
  for (; size >= 22; size -= 2) {
    ctx.font = `400 ${size}px ${SERIF}`
    lines = wrap(ctx, text, maxW)
    lh = size * 1.38
    if (lines.length * lh <= maxH - markGap) break
  }
  const blockH = lines.length * lh
  // Stories centre the quote block vertically; other shapes keep it at the top.
  const offset = format === 'story' ? Math.max(0, (maxH - markGap - blockH) / 2.4) : 0
  const markTop = top + offset

  ctx.fillStyle = s.accent
  ctx.font = `600 ${markSize}px ${SERIF}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('“', pad - markSize * 0.06, markTop + markSize * 0.72)

  ctx.fillStyle = s.text
  ctx.font = `400 ${size}px ${SERIF}`
  let y = markTop + markGap + size
  for (const line of lines) { ctx.fillText(line, pad, y); y += lh }

  // Footer: rule, title, author, provenance
  const fy = h - pad - footerH
  ctx.fillStyle = s.rule
  ctx.fillRect(pad, fy + 8, Math.min(160, maxW), 3)
  const titleSize = format === 'wide' ? 28 : 38
  ctx.fillStyle = s.text
  ctx.font = `600 ${titleSize}px ${SERIF}`
  ctx.fillText(truncate(ctx, title, maxW), pad, fy + 8 + titleSize * 1.5)
  if (format !== 'wide') {
    ctx.fillStyle = s.muted
    ctx.font = `400 ${Math.round(titleSize * 0.78)}px ${SANS}`
    ctx.fillText(truncate(ctx, author, maxW), pad, fy + 8 + titleSize * 2.7)
  } else if (author) {
    const tw = ctx.measureText(truncate(ctx, title, maxW)).width
    ctx.fillStyle = s.muted
    ctx.font = `400 ${Math.round(titleSize * 0.8)}px ${SANS}`
    ctx.fillText(truncate(ctx, ` · ${author}`, maxW - tw), pad + tw, fy + 8 + titleSize * 1.5)
  }
  ctx.fillStyle = s.muted
  ctx.font = `700 ${format === 'wide' ? 18 : 22}px ${SANS}`
  const brand = `READ IT FREE IN READER${sourceLabel ? `  ·  ${sourceLabel.toUpperCase()}` : ''}`
  ctx.fillText(truncate(ctx, brand, maxW), pad, h - pad + (format === 'wide' ? 8 : 0))
  return canvas
}

function truncate(ctx, text, max) {
  if (!text || ctx.measureText(text).width <= max) return text ?? ''
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

export const toBlob = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
