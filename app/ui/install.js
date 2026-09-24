/* Helping people add Read Free to their home screen.
 *   Chrome, Edge, Samsung Internet, Android: the browser's own install prompt.
 *   iPhone/iPad: Safari has no prompt, so a short guide shows where to tap.
 *   In-app browsers (Instagram, Facebook, Gmail…): they can't install; say "open in Safari". */

import * as db from '../db.js'
import { $, toast } from './dom.js'

let deferred = null
let guideSheet = null
export const setGuideSheet = s => { guideSheet = s }
const listeners = new Set()
const changed = () => listeners.forEach(fn => fn())

globalThis.addEventListener?.('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed() })
globalThis.addEventListener?.('appinstalled', () => { deferred = null; toast('Read Free is on your home screen'); changed() })

export const onInstallChange = fn => listeners.add(fn)

export function platform(ua = navigator.userAgent, nav = navigator) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  return {
    ios,
    // iOS in-app web views leave "Safari" out of the user agent
    inApp: ios ? !/Safari\//.test(ua) : /FBAN|FBAV|Instagram|Line\/|; wv\)/.test(ua),
  }
}

export function isInstalled() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone)
}

/** 'prompt' (browser can install), 'ios' (show the guide), 'in-app', or null. */
export function installMode() {
  if (isInstalled()) return null
  const p = platform()
  if (p.inApp) return 'in-app'
  if (deferred) return 'prompt'
  if (p.ios) return 'ios'
  return null
}

export async function install(sheet = guideSheet) {
  const mode = installMode()
  if (mode === 'prompt') {
    deferred.prompt()
    const { outcome } = await deferred.userChoice.catch(() => ({}))
    if (outcome === 'accepted') deferred = null
    changed()
    return
  }
  renderGuide(mode)
  sheet.open()
}

function renderGuide(mode) {
  const share = '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9"/></svg>'
  const add = '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'
  $('#install-body').innerHTML = mode === 'in-app'
    ? `<p class="install-lead">This app's built-in browser can't add Read Free to your home screen.</p>
       <ol class="install-steps">
         <li>Tap the <strong>•••</strong> or share menu in this app.</li>
         <li>Choose <strong>Open in Safari</strong> (or <strong>Open in browser</strong>).</li>
         <li>Come back to this page there and tap <strong>Install</strong>.</li>
       </ol>`
    : `<p class="install-lead">It opens full-screen like any app, works with no connection, and keeps your library safe from the browser clearing it.</p>
       <ol class="install-steps">
         <li>Tap <strong>Share</strong> ${share} in Safari. <span class="install-hint">On newer iPhones it's inside the <strong>•••</strong> menu.</span></li>
         <li>Scroll down and tap <strong>Add to Home Screen</strong> ${add}</li>
         <li>Tap <strong>Add</strong>. Read Free is now on your home screen.</li>
       </ol>`
}

const SNOOZE_MS = 21 * 24 * 3600 * 1000

/** Show the library banner once someone has actually read something here. */
export async function shouldNudge(hasRead) {
  if (!installMode() || !hasRead) return false
  const snoozed = await db.kvGet('install-snoozed', 0)
  return Date.now() - snoozed > SNOOZE_MS
}

export const snooze = () => db.kvSet('install-snoozed', Date.now())
