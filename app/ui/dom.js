/* Tiny DOM helpers shared by the UI modules. */

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Tagged template that escapes interpolations unless they are SafeHTML (raw() or nested html``). */
export class SafeHTML {
  constructor(s) { this.s = s }
  toString() { return this.s }
}
export const raw = s => new SafeHTML(String(s))
const piece = v => v instanceof SafeHTML ? v.s : (v === false || v == null ? '' : esc(v))
export function html(strings, ...values) {
  let out = strings[0]
  values.forEach((v, i) => {
    out += (Array.isArray(v) ? v.map(piece).join('') : piece(v)) + strings[i + 1]
  })
  return new SafeHTML(out)
}

let toastTimer
export function toast(message, { action, onAction, duration = 2600 } = {}) {
  const el = $('#toast')
  el.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = message
  el.append(span)
  if (action) {
    const btn = document.createElement('button')
    btn.textContent = action
    btn.addEventListener('click', () => { el.classList.remove('show'); onAction?.() })
    el.append(btn)
  }
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? duration * 2 : duration)
}

export function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(minutes) {
  if (!isFinite(minutes) || minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

export function formatYear(y) {
  if (y == null || y === '') return ''
  return y < 0 ? `${-y} BC` : String(y)
}

/** Modal bottom sheet with focus management. */
export class Sheet {
  static stack = []
  constructor(el) {
    if (el.__sheet) return el.__sheet
    el.__sheet = this
    this.el = el
    this.el.addEventListener('keydown', e => this.#trap(e))
    $('.sheet-close', el)?.addEventListener('click', () => this.close())
  }
  get isOpen() { return this.el.classList.contains('open') }
  open() {
    if (this.isOpen) return
    this.returnFocus = document.activeElement
    Sheet.stack.push(this)
    this.el.classList.add('open')
    this.el.setAttribute('aria-hidden', 'false')
    $('#sheet-backdrop').classList.add('visible')
    requestAnimationFrame(() => (this.el.querySelector('[autofocus]') ?? this.el.querySelector('.sheet-body') ?? this.el).focus({ preventScroll: true }))
  }
  close() {
    if (!this.isOpen) return
    this.el.classList.remove('open')
    this.el.setAttribute('aria-hidden', 'true')
    Sheet.stack = Sheet.stack.filter(s => s !== this)
    if (!Sheet.stack.length) $('#sheet-backdrop').classList.remove('visible')
    this.onClose?.()
    this.returnFocus?.focus?.({ preventScroll: true })
  }
  static closeTop() {
    const top = Sheet.stack[Sheet.stack.length - 1]
    if (top) { top.close(); return true }
    return false
  }
  #trap(e) {
    if (e.key !== 'Tab') return
    const focusable = $$('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', this.el)
      .filter(x => x.offsetParent !== null)
    if (!focusable.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault() }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault() }
  }
}
