// Dispatches ArrowRight to advance Figma Slides; Space bar acts as manual fallback.
// If the URL hash carries a `#next=<https-url>` fragment, also navigates the tab there
// after the animation — that's how the Figma launcher button hands control back to the deck.
// Audience QR scans use the bare URL (no #next=) so they're never redirected.
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
    this._maybeNavigateToNext();
  }

  // Returns the URL after `#next=` if present and looks like http(s); otherwise null.
  _getReturnUrl() {
    const hash = window.location.hash || '';
    const prefix = '#next=';
    if (!hash.startsWith(prefix)) return null;
    const url = hash.slice(prefix.length);
    if (!/^https?:\/\//i.test(url)) return null;
    return url;
  }

  _maybeNavigateToNext() {
    const next = this._getReturnUrl();
    if (!next) return;
    console.log('[Bridge] #next= present, navigating to', next);
    // Primary: same-tab navigation. Lands directly on the next slide if the
    // URL is in present mode.
    try { window.location.replace(next); } catch (_) { /* fall through to close */ }
    // Fallback: if the navigation was blocked or never completed, close the demo
    // tab so focus returns to the original Figma tab (still in present mode).
    // If the navigation succeeded, the page is already gone before this fires.
    setTimeout(() => { try { window.close(); } catch (_) {} }, 400);
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
