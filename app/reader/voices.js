/* Choosing a read-aloud voice. Pure functions: unit-tested under node.
 * Apple devices list "(Enhanced)"/"(Premium)" versions of voices the user has
 * downloaded, plus joke voices (Bubbles, Zarvox…) that no one wants for a book. */

const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical|Pipe Organ)\b/i
const ROBOTIC = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Fred|Ralph|Kathy|Junior)\b/i

export function voiceQuality(v) {
  const name = v.name ?? ''
  if (/premium/i.test(name)) return 'premium'
  if (/enhanced|neural|natural|wavenet/i.test(name)) return 'enhanced'
  return 'standard'
}

const score = v => {
  const q = voiceQuality(v)
  return (q === 'premium' ? 400 : q === 'enhanced' ? 300 : 0)
    + (ROBOTIC.test(v.name) ? -200 : 0)
    + (v.localService ? 20 : 0)
    + (v.default ? 10 : 0)
}

/** Voices for a language (e.g. 'en'), best first, joke voices removed. */
export function rankVoices(voices, lang = 'en') {
  const l = lang.toLowerCase().slice(0, 2)
  return voices
    .filter(v => v.lang?.toLowerCase().replace('_', '-').startsWith(l) && !NOVELTY.test(v.name ?? ''))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
}

/** "Ava (Premium)" · "English (United States)" */
export function voiceLabel(v, locale = 'en') {
  let region = v.lang
  try {
    region = new Intl.DisplayNames([locale], { type: 'language' }).of(v.lang.replace('_', '-')) ?? v.lang
  } catch { /* old browsers */ }
  return { name: v.name.replace(/\s*\((Enhanced|Premium)\)\s*/i, '').trim(), region, quality: voiceQuality(v) }
}
