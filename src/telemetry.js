// TelemetryCollector — privacy-safe, client-side signal for the adaptive Tuner.
//
// Records ONLY timings, counters, and coarse device buckets. No camera frames,
// no landmarks, no biometrics ever leave the browser (nothing leaves the browser
// at all — this is localStorage only). Two consumers:
//   • getLiveSignals()  → in-session state the Tuner reads each ~4 s tick to
//                          decide whether detection is struggling right now.
//   • persisted sessions → a rolling buffer (last 50) the Tuner could mine across
//                          visits; written on confirm / page-hide.
//
// Always collects regardless of ?notune — collection is harmless; only the
// *application* of tuning is gated. See tuner.js.

class TelemetryCollector {
  constructor() {
    this._SESSIONS_KEY = 'cacoon.tele.sessions';
    this._MAX_SESSIONS = 50;

    this._sessionStart = Date.now();
    this._detector = null;   // set in attach(); used to sample luminance at persist

    // Per-session accumulators.
    this._firstDetectAt = null;   // ms timestamp of first DETECTING
    this._handsEverDetected = false;
    this._liveTrackCount = 0;
    this._abandons = 0;           // total active→IDLE this session
    this._confirmed = false;
    this._d2c = null;             // first-DETECTING → CONFIRMED (ms)
    this._space = false;

    // "Since last poll" flags the Tuner consumes and resets each tick.
    this._spaceSinceLastPoll = false;
    this._abandonsSinceLastPoll = 0;
    this._poseMissSinceLastPoll = false;   // Pose saw a raised hand the Hands model missed

    this._flushed = false;

    // Flush a partial record if the user leaves without confirming.
    const flush = () => this._persistSession();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  attach(detector) {
    this._detector = detector;   // for sampling ambient luminance at persist time
    detector.addEventListener('handStateChange', ({ detail: { state, prev } }) => {
      if (state === 'DETECTING' && this._firstDetectAt === null) {
        this._firstDetectAt = Date.now();
      }
      // Abandonment: an active state falling back to IDLE (gave up the hold or
      // the prompt window). prev is the state we left.
      if (state === 'IDLE' && (prev === 'DETECTING' || prev === 'PROMPTING' || prev === 'CONFIRMING')) {
        this._abandons++;
        this._abandonsSinceLastPoll++;
      }
    });

    detector.addEventListener('tracksChanged', ({ detail: { count } }) => {
      this._liveTrackCount = count;
      if (count > 0) this._handsEverDetected = true;
    });

    detector.addEventListener('confirmed', () => {
      this._confirmed = true;
      if (this._firstDetectAt !== null) this._d2c = Date.now() - this._firstDetectAt;
      this._persistSession();   // a completed run is the strongest signal
    });

    // Pose sees a raised hand the Hands model can't lock (far-field / low
    // confidence). Strong "loosen detection" cue for the Tuner.
    detector.addEventListener('handMissed', () => {
      this._poseMissSinceLastPoll = true;
    });
  }

  // Called from the Space-bar fallback — the user bypassed gesture detection,
  // i.e. detection failed them. Strong "loosen" signal for the Tuner.
  recordSpace() {
    this._space = true;
    this._spaceSinceLastPoll = true;
  }

  // Snapshot for the adaptive loop. The "*SinceLastPoll" fields are edge signals,
  // reset on read so a single Space press / abandon nudges exactly once.
  getLiveSignals() {
    const sig = {
      msSinceStart: Date.now() - this._sessionStart,
      handsEverDetected: this._handsEverDetected,
      liveTrackCount: this._liveTrackCount,
      lastTtfd: this._firstDetectAt === null ? null : this._firstDetectAt - this._sessionStart,
      spaceSinceLastPoll: this._spaceSinceLastPoll,
      recentAbandons: this._abandonsSinceLastPoll,
      poseMissSinceLastPoll: this._poseMissSinceLastPoll,
    };
    this._spaceSinceLastPoll = false;
    this._abandonsSinceLastPoll = 0;
    this._poseMissSinceLastPoll = false;
    return sig;
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  _persistSession() {
    // Only flush once, and only if the session carried any usable signal.
    if (this._flushed) return;
    const hadSignal = this._firstDetectAt !== null || this._abandons > 0 || this._space || this._confirmed;
    if (!hadSignal) return;
    this._flushed = true;

    const ua = navigator.userAgent;
    const record = {
      ts: Date.now(),
      ttfd: this._firstDetectAt === null ? null : this._firstDetectAt - this._sessionStart,
      d2c: this._d2c,
      confirmed: this._confirmed,
      abandons: this._abandons,
      space: this._space,
      browser: this._coarseBrowser(ua),
      os: this._coarseOS(ua),
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      // Ambient brightness at session end (0–1, or null). Device class is
      // reconstructable from browser/os/vw above — no separate key needed.
      luminance: (this._detector && typeof this._detector.getLuminance === 'function')
        ? this._detector.getLuminance() : null,
    };

    try {
      const arr = JSON.parse(localStorage.getItem(this._SESSIONS_KEY) || '[]');
      arr.push(record);
      while (arr.length > this._MAX_SESSIONS) arr.shift();
      localStorage.setItem(this._SESSIONS_KEY, JSON.stringify(arr));
    } catch (_) { /* private mode / quota — telemetry is best-effort */ }
  }

  _coarseBrowser(ua) {
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  _coarseOS(ua) {
    if (/Windows/.test(ua)) return 'windows';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Mac OS X/.test(ua)) return 'macos';
    if (/Linux/.test(ua)) return 'linux';
    return 'other';
  }
}
