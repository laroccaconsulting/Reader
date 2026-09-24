/* Reading settings sheet ("Aa"). Changes apply live. */

import { settings, update, FONTS, THEMES } from '../settings.js'
import { $$, html } from './dom.js'

const THEME_LABELS = { auto: 'Auto', light: 'Light', sepia: 'Sepia', dark: 'Dark', black: 'Black' }

const radio = (name, value, label, extra = '') => html`
  <button class="option" role="radio" data-set="${name}" data-value="${value}" aria-checked="${String(settings[name]) === String(value)}">${extra}${label}</button>`

export function renderTypeSheet(root) {
  const themeDot = t => t === 'auto'
    ? html`<span class="theme-dot" style="background:linear-gradient(135deg,#FAFAF8 50%,#18181B 50%)"></span>`
    : html`<span class="theme-dot" style="background:${THEMES[t].bg}"></span>`
  root.innerHTML = String(html`
    <div class="type-section">
      <div class="type-label"><span id="lbl-size">Text size</span><output id="out-size">${settings.fontSize}%</output></div>
      <div class="stepper">
        <button data-step="fontSize" data-delta="-5" aria-label="Smaller text">A</button>
        <input type="range" min="70" max="200" step="5" value="${settings.fontSize}" data-range="fontSize" aria-labelledby="lbl-size">
        <button data-step="fontSize" data-delta="5" aria-label="Larger text">A</button>
      </div>
    </div>

    <div class="type-section">
      <div class="type-label"><span>Theme</span></div>
      <div class="options" role="radiogroup" aria-label="Theme">
        ${Object.keys(THEME_LABELS).map(t => radio('theme', t, THEME_LABELS[t], themeDot(t)))}
      </div>
    </div>

    <div class="type-section">
      <div class="type-label"><span>Typeface</span></div>
      <div class="options" role="radiogroup" aria-label="Typeface">
        ${Object.entries(FONTS).map(([k, f]) => html`
          <button class="option" role="radio" data-set="font" data-value="${k}" aria-checked="${settings.font === k}"
            style="${f.stack ? `font-family:${f.stack}` : ''}">${f.label}</button>`)}
      </div>
    </div>

    <div class="type-section">
      <div class="type-label"><span id="lbl-lh">Line spacing</span><output id="out-lh">${settings.lineHeight.toFixed(2)}</output></div>
      <input type="range" min="1.2" max="2.2" step="0.05" value="${settings.lineHeight}" data-range="lineHeight" aria-labelledby="lbl-lh">
    </div>

    <div class="type-section">
      <div class="type-label"><span>Margins</span></div>
      <div class="options" role="radiogroup" aria-label="Margins">
        ${radio('margin', 'narrow', 'Narrow')}${radio('margin', 'medium', 'Medium')}${radio('margin', 'wide', 'Wide')}
      </div>
    </div>

    <div class="type-section">
      <div class="type-label"><span>Layout</span></div>
      <div class="options" role="radiogroup" aria-label="Layout">
        ${radio('flow', 'paginated', 'Pages')}${radio('flow', 'scrolled', 'Scroll')}
        ${radio('columns', 'auto', 'Two pages on wide screens')}${radio('columns', '1', 'Always one page')}
      </div>
    </div>

    <div class="type-section">
      <div class="type-label"><span>Text</span></div>
      <div class="options">
        <button class="option" role="switch" data-toggle="justify" aria-checked="${settings.justify}">Justify</button>
        <button class="option" role="switch" data-toggle="hyphenate" aria-checked="${settings.hyphenate}">Hyphenate</button>
        <button class="option" role="switch" data-toggle="animated" aria-checked="${settings.animated}">Page animation</button>
      </div>
    </div>`)

  root.onclick = e => {
    const opt = e.target.closest('[data-set]')
    if (opt) {
      const value = opt.dataset.value
      update({ [opt.dataset.set]: value })
      $$(`[data-set="${opt.dataset.set}"]`, root).forEach(b => b.setAttribute('aria-checked', String(b === opt)))
      return
    }
    const tog = e.target.closest('[data-toggle]')
    if (tog) {
      const key = tog.dataset.toggle
      update({ [key]: !settings[key] })
      tog.setAttribute('aria-checked', String(settings[key]))
      return
    }
    const step = e.target.closest('[data-step]')
    if (step) {
      const v = Math.max(70, Math.min(200, settings.fontSize + Number(step.dataset.delta)))
      update({ fontSize: v })
      root.querySelector('[data-range="fontSize"]').value = v
      root.querySelector('#out-size').textContent = `${v}%`
    }
  }
  let t
  root.oninput = e => {
    const r = e.target.closest('[data-range]')
    if (!r) return
    const key = r.dataset.range
    const v = Number(r.value)
    root.querySelector(key === 'fontSize' ? '#out-size' : '#out-lh').textContent = key === 'fontSize' ? `${v}%` : v.toFixed(2)
    clearTimeout(t)
    t = setTimeout(() => update({ [key]: v }), 120)
  }
}
