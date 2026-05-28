// Dispatches ArrowRight to advance Figma Slides; Space bar acts as manual fallback.
// If the URL hash is non-empty (e.g. `#presenter`), the demo tab closes itself
// after the animation so focus returns to the original Figma deck tab.
// Audience QR scans use the bare URL (no hash) so they never close — the demo
// just resets to IDLE for the next person.
class BridgeController {
  constructor() {
    this._fired = false;
  }

  trigger() {
    if (this._fired) return;
    this._fired = true;
    console.log('[Bridge] Firing ArrowRight to advance Figma Slides');
    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode: 39,
      which: 39,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    window.dispatchEvent(ev);
    this._maybeCloseTab();
  }

  // Presenter mode: any non-empty URL hash means "close after the animation"
  // so the original Figma tab regains focus. Bare URL (audience QR) → no close.
  _maybeCloseTab() {
    const hash = window.location.hash || '';
    if (!hash) return;
    console.log('[Bridge] presenter mode (hash present), closing tab');
    try { window.close(); } catch (_) {}
  }

  // Call once at startup; callback is invoked when Space is pressed.
  setupSpaceFallback(callback) {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        console.log('[Bridge] Space fallback triggered');
        callback();
      }
    });
  }

  reset() {
    this._fired = false;
  }
}
