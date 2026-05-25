// All tunable thresholds — never hardcode values in logic files.
const CONFIG = Object.freeze({

  // ── MediaPipe Hands ─────────────────────────────────────────────
  minDetectionConfidence: 0.80,   // drop to 0.70 in bad light
  minTrackingConfidence: 0.60,
  maxNumHands: 6,                 // crowd-mode: up to six concurrent users

  // ── Gesture timing ──────────────────────────────────────────────
  gestureHoldMs: 2000,            // palm hold → PROMPTING; thumbs-up hold → CONFIRMED
  confirmationTimeoutMs: 8000,    // PROMPTING timeout → CANCELLED
  detectDropMaxFrames: 5,         // brief palm flicker tolerance in DETECTING (mirrors CONFIRMING)

  // ── Proximity & stability filters ───────────────────────────────
  minHandAreaFraction: 0.02,      // bounding box area as fraction of frame (0–1); thumbs-up bbox is much smaller than palm

  // ── Multi-hand tracking ─────────────────────────────────────────
  trackMatchMaxDist: 0.18,        // normalized wrist distance to re-associate a track between frames
  trackMissingMaxFrames: 30,      // frames a track can survive without a match before being dropped (~1 s at 30 fps)
  trackWarmupFrames: 5,           // matched frames a track must accumulate before its state machine runs (kills ghosts)
  snapshotExpandFactor: 5.0,      // hand bbox → user bbox: side multiplier (≈400% expansion, face + torso)

  // ── Warnings ────────────────────────────────────────────────────
  lowConfidenceThreshold: 0.60,
  lowConfidenceConsecutiveFrames: 30,

  // ── Animation & display ─────────────────────────────────────────
  taxiArrivalDurationMs: 3200,    // total taxi sequence duration
  cancelledDisplayMs: 1800,       // how long "cancelled" shows before reset

});
