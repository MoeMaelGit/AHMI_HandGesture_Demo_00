// Manages the taxi arrival sequence: slide-in → door highlight → message → complete.
// Audio cues are synthesized in src/audio.js (no MP3 files).
class TaxiAnimation {
  constructor(overlayEl) {
    this.overlay     = overlayEl;
    this.taxiWrap    = overlayEl.querySelector('#taxi-wrap');
    this.doorLeft    = overlayEl.querySelector('#door-left');
    this.doorRight   = overlayEl.querySelector('#door-right');
    this.interior    = overlayEl.querySelector('#car-interior');
    this.groundGlow  = overlayEl.querySelector('#ground-glow');
    this.msgEl       = overlayEl.querySelector('#taxi-msg');
    this.audio       = new CabinAudio();
    this._onComplete = null;
    this._timers = [];
  }

  play(onComplete) {
    this._onComplete = onComplete;
    this._reset();

    this.overlay.classList.remove('hidden');

    // Phase 1 — taxi glides in from the right
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.taxiWrap.classList.add('slide-in');
      });
    });

    // Audio — chime at slide-in start, ambient hum underneath
    // Wrapped in try/catch since first-load gesture path may not have unlocked audio
    try { this.audio.playChime(); }     catch (_) {}
    try { this.audio.startAmbient(); }  catch (_) {}

    // Phase 1b — taxi has stopped: ground glow fades in
    this._after(CONFIG.taxiArrivalDurationMs * 0.34, () => {
      if (this.groundGlow) this.groundGlow.classList.add('active');
    });

    // Phase 2 — left door swings open (0.2 s delay built into CSS transition)
    this._after(CONFIG.taxiArrivalDurationMs * 0.38, () => {
      if (this.doorLeft) this.doorLeft.classList.add('open');
    });

    // Phase 3 — right door swings open (staggered, 0.45 s delay in CSS)
    this._after(CONFIG.taxiArrivalDurationMs * 0.42, () => {
      if (this.doorRight) this.doorRight.classList.add('open');
    });

    // Phase 4 — interior glow + message (after doors are mostly open)
    this._after(CONFIG.taxiArrivalDurationMs * 0.58, () => {
      if (this.interior) this.interior.classList.add('lit');
      this.msgEl.classList.add('visible');
    });

    // Phase 5 — complete callback
    this._after(CONFIG.taxiArrivalDurationMs, () => {
      if (this._onComplete) this._onComplete();
    });
  }

  _after(ms, fn) {
    this._timers.push(setTimeout(fn, ms));
  }

  _reset() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    this.taxiWrap.classList.remove('slide-in');
    if (this.doorLeft)   this.doorLeft.classList.remove('open');
    if (this.doorRight)  this.doorRight.classList.remove('open');
    if (this.interior)   this.interior.classList.remove('lit');
    if (this.groundGlow) this.groundGlow.classList.remove('active');
    this.msgEl.classList.remove('visible');
  }

  hide() {
    this._reset();
    this.overlay.classList.add('hidden');
    try { this.audio.stopAmbient(); } catch (_) {}
  }
}
