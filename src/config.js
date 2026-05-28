// All tunable thresholds — never hardcode values in logic files.
const CONFIG = Object.freeze({

  // ── Camera capture (far-field reach) ────────────────────────────
  cameraWidth: 1920,              // request 1080p; browser may downgrade if unsupported
  cameraHeight: 1080,

  // ── MediaPipe Hands ─────────────────────────────────────────────
  minDetectionConfidence: 0.65,   // lowered for far-field; warmup gate filters resulting ghosts
  minTrackingConfidence: 0.60,
  maxNumHands: 6,                 // crowd-mode: up to six concurrent users

  // ── MediaPipe Pose (Tasks Vision, multi-person) ─────────────────
  poseNumPoses: 6,                // match maxNumHands
  poseMinDetection: 0.50,
  poseMinPresence: 0.50,
  poseMinTracking: 0.50,
  wristMatchMaxDist: 0.12,        // normalized distance to associate a Hands wrist to a Pose wrist

  // ── Gesture timing ──────────────────────────────────────────────
  gestureHoldMs: 2000,            // palm hold → PROMPTING; thumbs-up hold → CONFIRMED
  confirmationTimeoutMs: 8000,    // PROMPTING timeout → CANCELLED
  detectDropMaxFrames: 5,         // brief palm flicker tolerance in DETECTING (mirrors CONFIRMING)

  // ── Proximity & stability filters ───────────────────────────────
  minHandAreaFraction: 0.005,     // lowered for far-field hands at 1080p; warmup gate filters ghosts

  // ── Multi-hand tracking ─────────────────────────────────────────
  trackMatchMaxDist: 0.18,        // normalized wrist distance to re-associate a track between frames
  trackMissingMaxFrames: 30,      // frames a track can survive without a match before being dropped (~1 s at 30 fps)
  trackWarmupFrames: 5,           // matched frames a track must accumulate before its state machine runs (kills ghosts)
  snapshotExpandFactor: 5.0,      // (legacy fallback only) hand bbox → user bbox: side multiplier

  // ── Warnings ────────────────────────────────────────────────────
  lowConfidenceThreshold: 0.60,
  lowConfidenceConsecutiveFrames: 30,

  // ── Animation & display ─────────────────────────────────────────
  taxiArrivalDurationMs: 3200,    // total taxi sequence duration
  cancelledDisplayMs: 1800,       // how long "cancelled" shows before reset

});
