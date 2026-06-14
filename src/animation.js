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
    this._onArrived  = null;
    this._timers = [];
  }

  // Arrival only — taxi glides in, ground glow, message. The doors stay CLOSED:
  // they open later, when the rider taps to board (see openDoors). `onArrived`
  // fires once the taxi has settled, so the caller can arm the boarding tap.
  play(onArrived) {
    this._onArrived = onArrived;
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

    // Phase 2 — arrival message (doors still closed, awaiting the boarding tap)
    this._after(CONFIG.taxiArrivalDurationMs * 0.55, () => {
      this.msgEl.classList.add('visible');
    });

    // Phase 3 — arrived → ready for the rider to "place their card" and board
    this._after(CONFIG.taxiArrivalDurationMs, () => {
      if (this._onArrived) this._onArrived();
    });
  }

  // Triggered when the rider taps to board: both doors slide open + the interior
  // lights up, then the scene holds a few seconds before `onSettled` runs the
  // handoff. CSS owns the door slide (staggered 0.2 s / 0.45 s delays, ~0.95 s
  // each), so by boardingDoorHoldMs they're fully open and have lingered.
  openDoors(onSettled) {
    if (this.interior)  this.interior.classList.add('lit');
    if (this.doorLeft)  this.doorLeft.classList.add('open');
    if (this.doorRight) this.doorRight.classList.add('open');
    try { this.audio.playBoard(); } catch (_) {}
    this._after(CONFIG.boardingDoorHoldMs, () => {
      if (onSettled) onSettled();
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
