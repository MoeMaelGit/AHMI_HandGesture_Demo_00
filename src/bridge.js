// Dispatches ArrowRight to advance Figma Slides; Space bar acts as manual fallback.
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
