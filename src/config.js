// All tunable thresholds — never hardcode values in logic files.
const CONFIG = Object.freeze({

  // ── MediaPipe Hands ─────────────────────────────────────────────
  minDetectionConfidence: 0.80,   // drop to 0.70 in bad light
  minTrackingConfidence: 0.60,
  maxNumHands: 4,

  // ── Gesture timing ──────────────────────────────────────────────
  gestureHoldMs: 2000,            // palm hold → PROMPTING; thumbs-up hold → CONFIRMED
  confirmationTimeoutMs: 8000,    // PROMPTING timeout → CANCELLED

  // ── Proximity & stability filters ───────────────────────────────
  minHandAreaFraction: 0.03,      // bounding box area as fraction of frame (0–1)
  maxCentroidDriftPx: 120,        // extreme movement guard (timer no longer resets on normal drift)

  // ── Detection zone (normalized 0–1 coordinates) ─────────────────
  detectionZoneXMin: 0.08,
  detectionZoneXMax: 0.92,
  detectionZoneYMin: 0.00,
  detectionZoneYMax: 0.80,        // generous vertical zone for laptop-cam angle

  // ── Warnings ────────────────────────────────────────────────────
  lowConfidenceThreshold: 0.60,
  lowConfidenceConsecutiveFrames: 30,

  // ── Animation & display ─────────────────────────────────────────
  taxiArrivalDurationMs: 3200,    // total taxi sequence duration
  cancelledDisplayMs: 1800,       // how long "cancelled" shows before reset

});
