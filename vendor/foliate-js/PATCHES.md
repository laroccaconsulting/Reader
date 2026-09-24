# Local patches to foliate-js

Upstream commit: see `VERSION`. Re-apply these after updating.

1. `paginator.js`: add `scrollByPixels(delta)` (unclamped scroll of the container),
   used by Reader's Autopilot in scrolled mode. Marked `[Reader patch]`.
