// Runs before first paint (classic script) so the saved theme applies without a flash.
(function () {
  var theme = 'auto'
  try { theme = (JSON.parse(localStorage.getItem('reader:settings:v2') || '{}').theme) || 'auto' } catch (e) {}
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  var colors = { light: '#FAFAF8', sepia: '#F6F0E4', dark: '#18181B', black: '#000000' }
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = colors[theme] || colors.light
})()

// Startup watchdog: if the app doesn't start (a failed download, or a broken
// offline copy), offer a one-tap repair instead of a blank screen. Repair clears
// the cached app files only; books, notes and settings are kept.
;(function () {
  var shown = false
  function show() {
    if (shown || window.__readFreeStarted) return
    shown = true
    var box = document.createElement('div')
    box.id = 'boot-rescue'
    box.setAttribute('role', 'alert')
    box.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font:16px/1.5 system-ui,sans-serif;background:var(--bg,#FAFAF8);color:var(--text,#2C2820)'
    var title = document.createElement('strong')
    title.textContent = 'Read Free didn’t start'
    title.style.fontSize = '20px'
    var text = document.createElement('p')
    text.textContent = 'Usually a new version didn’t finish downloading. Repair fetches the app again. Your books, notes and settings stay on this device.'
    text.style.maxWidth = '26em'
    var repair = document.createElement('button')
    repair.textContent = 'Repair'
    repair.style.cssText = 'padding:10px 22px;border-radius:999px;border:0;background:#5E51A0;color:#fff;font:inherit;font-weight:600'
    repair.onclick = function () {
      repair.disabled = true
      repair.textContent = 'Repairing…'
      var jobs = []
      if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister() })) }))
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('reader-shell') === 0 }).map(function (k) { return caches.delete(k) })) }))
      Promise.all(jobs).catch(function () {}).then(function () { location.reload() })
    }
    box.appendChild(title); box.appendChild(text); box.appendChild(repair)
    document.body.appendChild(box)
  }
  window.__readFreeRescue = show
  // Before the app has started: a script that fails to download, or code that fails to run
  window.addEventListener('error', function (e) {
    var script = e.target && e.target.tagName === 'SCRIPT'
    if (!window.__readFreeStarted && (script || e instanceof ErrorEvent)) setTimeout(show, 1500)
  }, true)
  setTimeout(function () { if (document.body) show() }, 15000)
})()
