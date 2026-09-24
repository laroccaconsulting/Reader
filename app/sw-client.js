/* Service worker registration and the "new version available" prompt. */

import { $ } from './ui/dom.js'

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  // Only an *update* should reload the page; the very first install must not.
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const prompt = worker => {
      $('#update-banner').hidden = false
      $('#update-reload').onclick = () => worker.postMessage('skip-waiting')
    }
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) prompt(worker)
      })
    })
    // Check for updates when the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}) })
  }).catch(e => console.warn('Service worker registration failed', e))

  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return
    reloading = true
    location.reload()
  })
}
