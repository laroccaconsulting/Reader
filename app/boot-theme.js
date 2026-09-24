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
