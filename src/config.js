// All tunable thresholds — never hardcode values in logic files.
//
// NOTE: CONFIG is intentionally NOT frozen. The adaptive Tuner (src/tuner.js)
// seeds it from the persisted "learned" baseline at load and nudges the three
// detection thresholds live while the demo runs (bounded; see tuner.js). The
// "never hardcode" rule still holds — logic reads CONFIG, never literals.
const _baseConfig = {

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
  poseMissFramesToLoosen: 30,     // frames Pose must show a raised-but-untracked hand before signalling the tuner to loosen (~1 s at 30 fps)
  poseRaisedMargin: 0.02,         // normalized y-margin for "wrist above elbow" = a raised arm (Pose-assisted spawn + sticky tracking)

  // ── Ambient luminance (lighting-aware tuning) ───────────────────
  luminanceSampleEveryFrames: 30, // sample mean frame brightness this often (~1 s at 30 fps) — a single 0–1 number, never a stored frame
  darkLumaThreshold: 0.25,        // below this mean luma → "dim room" → tuner loosens detection confidence rather than area

  // ── Gesture timing ──────────────────────────────────────────────
  gestureHoldMs: 2000,            // palm hold → PROMPTING; thumbs-up hold → CONFIRMED
  confirmationTimeoutMs: 8000,    // PROMPTING timeout → CANCELLED
  detectDropMaxFrames: 5,         // brief palm flicker tolerance in DETECTING (mirrors CONFIRMING)

  // ── Proximity & stability filters ───────────────────────────────
  minHandAreaFraction: 0.005,     // lowered for far-field hands at 1080p; warmup gate filters ghosts

  // ── Gesture shape classifiers (3D, rotation-/scale-invariant) ─
  // A finger is "extended" when its TIP reaches past its PIP joint relative to
  // the wrist: dist(tip,wrist)/dist(pip,wrist) > fingerExtendReach (3D, uses z).
  // Robust to both a PIP curl and a knuckle (MCP) fold. Measured separation:
  // extended ≈ 1.27–1.45, folded ≈ 0.55–1.00.
  fingerExtendReach: 1.15,        // tip/pip wrist-distance ratio above this → finger EXTENDED. Open palm needs ALL 4 extended; thumbs-up needs 0 (a fist, however the fingers fold). Lower if open palms miss far away; raise if folded fingers count as extended
  thumbExtendAngleDeg: 140,       // 3D thumb IP-joint angle above this → thumb extended (thumbs-up). Thumbs bend more than fingers, so a touch lower
  palmMaxTiltDeg: 40,             // open palm must point up within this angle of vertical (wiggle room; not rigidly vertical). Lower = stricter "hand up"

  // ── Multi-hand tracking ─────────────────────────────────────────
  trackMatchMaxDist: 0.18,        // normalized wrist distance to re-associate a track between frames
  trackMissingMaxFrames: 30,      // frames a track can survive without a match before being dropped (~1 s at 30 fps)
  trackWarmupFrames: 5,           // matched frames a track must accumulate before its state machine runs (kills ghosts)
  gestureStaleFrames: 6,          // unmatched frames before an active track's countdown resets to IDLE (~0.2 s) — stops a dropped-hand countdown from being inherited by another hand
  snapshotExpandFactor: 5.0,      // (legacy fallback only) hand bbox → user bbox: side multiplier

  // ── Warnings ────────────────────────────────────────────────────
  lowConfidenceThreshold: 0.60,
  lowConfidenceConsecutiveFrames: 30,

  // ── Animation & display ─────────────────────────────────────────
  taxiArrivalDurationMs: 3200,    // arrival sequence (slide-in → ground glow → message); doors stay CLOSED
  boardingDoorHoldMs: 3200,       // after the rider taps to board: doors slide open (~1.4 s) then hold, before handoff
  cancelledDisplayMs: 1800,       // how long "cancelled" shows before reset

};

// Apply the learned baseline if the Tuner is present (loaded before this file);
// otherwise fall back to the raw defaults. CONFIG stays mutable for live tuning.
const CONFIG = (typeof Tuner !== 'undefined') ? Tuner.initBaseline(_baseConfig) : _baseConfig;
