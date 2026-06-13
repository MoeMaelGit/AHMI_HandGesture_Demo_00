// Tuner — pure-client adaptive auto-tuning for the detection thresholds.
//
// Goal: "learn the room" with no backend. It adapts in two timescales:
//   • Real-time  — a ~4 s feedback loop loosens thresholds within seconds when
//                  detection is clearly struggling (no hands tracked, or the user
//                  fell back to the Space bar), and cautiously tightens when it
//                  sees the phantom-trigger pattern.
//   • Across-visit — the values that worked get blended into a persisted
//                  "learned" baseline, so the next visit starts pre-adapted.
//
// Always-on by default (in and out of the demo room). Escape hatches:
//   ?notune        pin the hand-tuned defaults — no adaptation, no persistence.
//   ?reset-tuning  clear the learned baseline + telemetry buffer.
//   ?show-tuning   live debug panel of the aggregate + current overrides.
//
// Hard bounds per key mean it can never silently misconfigure the demo. Only the
// three detection thresholds are tuned — gestureHoldMs (the mandatory "2 seconds")
// is intentionally never touched.

const Tuner = (() => {
  'use strict';

  const LEARNED_KEY = 'cacoon.tune.learned';
  const SESSIONS_KEY = 'cacoon.tele.sessions';   // owned by telemetry.js; we only clear it

  // [min, max] and the discrete step used for a single tick's nudge.
  const BOUNDS = {
    minDetectionConfidence: { min: 0.50, max: 0.80, step: 0.05 },
    minTrackingConfidence:  { min: 0.50, max: 0.75, step: 0.05 },
    minHandAreaFraction:    { min: 0.003, max: 0.02 },   // multiplicative, no fixed step
  };
  const KEYS = Object.keys(BOUNDS);

  const TICK_MS = 4000;
  const STRUGGLE_AFTER_MS = 6000;   // camera up this long with no hand → loosen
  const EMA_ALPHA = 0.3;            // blend weight of this session into the learned baseline
  const AREA_LOOSEN = 0.7;
  const AREA_TIGHTEN = 1.5;

  let _defaults = null;     // captured snapshot of the hand-tuned defaults
  let _params = null;       // URLSearchParams
  let _lastDet = null;      // last (det, track) pushed to MediaPipe, to avoid redundant setOptions
  let _panel = null;        // ?show-tuning DOM node
  let _lastSummary = null;

  const clamp = (key, v) => Math.min(BOUNDS[key].max, Math.max(BOUNDS[key].min, v));
  const round = (key, v) => key === 'minHandAreaFraction' ? +v.toFixed(4) : +v.toFixed(3);

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* best-effort */ }
  }

  // ─── Load-time: seed CONFIG from the learned baseline ──────────────────────
  // Mutates and returns `base` (which becomes the live global CONFIG).
  function initBaseline(base) {
    _params = new URLSearchParams(location.search);
    _defaults = {};
    for (const k of KEYS) _defaults[k] = base[k];

    if (_params.has('reset-tuning')) {
      try { localStorage.removeItem(LEARNED_KEY); localStorage.removeItem(SESSIONS_KEY); } catch (_) {}
    }

    if (!_params.has('notune') && !_params.has('reset-tuning')) {
      const learned = readJSON(LEARNED_KEY, null);
      if (learned) {
        for (const k of KEYS) {
          if (typeof learned[k] === 'number') base[k] = round(k, clamp(k, learned[k]));
        }
      }
    }

    if (_params.has('show-tuning')) _ensurePanel();
    return base;
  }

  // ─── Run-time: the adaptive feedback loop ──────────────────────────────────
  function startAdaptiveLoop(telemetry, detector) {
    // Push the (possibly learned) starting detection params to MediaPipe once.
    _applyDetectionParams(detector, /*force*/ true);

    if (_params && (_params.has('notune') || _params.has('reset-tuning'))) {
      // Pinned to defaults: no adaptation, no learning. Still show the panel.
      if (_params.has('show-tuning')) _renderPanel(telemetry, 'pinned (?notune)');
      return;
    }

    const persist = () => _persistLearned();
    window.addEventListener('pagehide', persist);
    detector.addEventListener('confirmed', persist);

    setInterval(() => {
      const sig = telemetry.getLiveSignals();
      const action = _decide(sig);
      if (action !== 'hold') _nudge(action, detector);
      if (_params.has('show-tuning')) _renderPanel(telemetry, action);
    }, TICK_MS);
  }

  // Decide a single bounded action from the live signals.
  function _decide(sig) {
    const struggling =
      (sig.msSinceStart > STRUGGLE_AFTER_MS && !sig.handsEverDetected) ||
      sig.spaceSinceLastPoll;
    if (struggling) return 'loosen';

    // Phantom-trigger proxy (the only client-side false-positive signal we have):
    // tracks appear almost instantly but get abandoned without confirming.
    const phantom = sig.lastTtfd !== null && sig.lastTtfd < 800 && sig.recentAbandons >= 2;
    if (phantom) return 'tighten';

    return 'hold';
  }

  // Apply one bounded step in the chosen direction, then push to MediaPipe.
  function _nudge(action, detector) {
    const dir = action === 'loosen' ? -1 : +1;   // loosen = lower confidence thresholds
    for (const k of KEYS) {
      if (k === 'minHandAreaFraction') {
        const factor = action === 'loosen' ? AREA_LOOSEN : AREA_TIGHTEN;
        CONFIG[k] = round(k, clamp(k, CONFIG[k] * factor));
      } else {
        CONFIG[k] = round(k, clamp(k, CONFIG[k] + dir * BOUNDS[k].step));
      }
    }
    _applyDetectionParams(detector, /*force*/ false);
  }

  // MediaPipe's detection/tracking confidence are set via setOptions; only call
  // it when a value actually changed (a reconfigure has cost).
  function _applyDetectionParams(detector, force) {
    const det = CONFIG.minDetectionConfidence;
    const track = CONFIG.minTrackingConfidence;
    if (!force && _lastDet && _lastDet.det === det && _lastDet.track === track) return;
    _lastDet = { det, track };
    if (typeof detector.setDetectionParams === 'function') detector.setDetectionParams(det, track);
  }

  // Blend the current effective values into the persisted learned baseline.
  function _persistLearned() {
    const prev = readJSON(LEARNED_KEY, null) || _defaults;
    const next = {};
    for (const k of KEYS) {
      const blended = (1 - EMA_ALPHA) * prev[k] + EMA_ALPHA * CONFIG[k];
      next[k] = round(k, clamp(k, blended));
    }
    writeJSON(LEARNED_KEY, next);
  }

  // ─── ?show-tuning debug panel ──────────────────────────────────────────────
  function _ensurePanel() {
    const build = () => {
      if (_panel) return;
      _panel = document.createElement('pre');
      _panel.id = 'tuning-panel';
      _panel.style.cssText =
        'position:fixed;right:8px;bottom:8px;z-index:9999;margin:0;padding:10px 12px;' +
        'max-width:340px;font:11px/1.5 "JetBrains Mono",Consolas,monospace;color:#cfe;' +
        'background:rgba(6,14,30,0.86);border:1px solid rgba(120,170,210,0.35);border-radius:8px;' +
        'backdrop-filter:blur(8px);white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(_panel);
    };
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  }

  // Does NOT poll telemetry — getLiveSignals() consumes edge flags, and the
  // adaptive loop already consumed them this tick. Renders CONFIG state only.
  function _renderPanel(_telemetry, lastAction) {
    const sessions = readJSON(SESSIONS_KEY, []);
    const learned = readJSON(LEARNED_KEY, null);
    const overrides = {};
    for (const k of KEYS) {
      if (_defaults && CONFIG[k] !== _defaults[k]) overrides[k] = `${_defaults[k]} → ${CONFIG[k]}`;
    }
    _lastSummary = {
      sessions: sessions.length,
      lastAction,
      effective: KEYS.reduce((o, k) => (o[k] = CONFIG[k], o), {}),
      overrides,
      learned,
    };
    window.__cacoonTuning = _lastSummary;
    if (_panel) {
      _panel.textContent =
        'CacOOn tuner  ·  ' + (lastAction || '—') + '\n' +
        'sessions: ' + sessions.length + '\n' +
        'minDet   : ' + CONFIG.minDetectionConfidence + '\n' +
        'minTrack : ' + CONFIG.minTrackingConfidence + '\n' +
        'minArea  : ' + CONFIG.minHandAreaFraction + '\n' +
        'overrides: ' + (Object.keys(overrides).length ? JSON.stringify(overrides, null, 1) : 'none');
    }
  }

  return { initBaseline, startAdaptiveLoop };
})();
