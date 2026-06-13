// GestureDetector — MediaPipe Hands integration + concurrent per-hand state machines.
//
// Each detected hand gets a persistent integer ID and its own independent state machine:
//   IDLE → DETECTING (open palm stable 2 s) → PROMPTING (thumbs-up window, 8 s) →
//   CONFIRMING (thumbs-up stable 2 s) → CONFIRMED (winner — locks the demo globally)
//
// First hand to reach CONFIRMED wins. The others' timers run in parallel until then —
// no special "shift focus" arbitration needed; the winner is whoever's hold completes first.
//
// Events (CustomEvent.detail):
//   handStateChange { id, state, prev, wrist }      — emitted on every per-hand transition
//   handProgress    { id, state, value, wrist, bbox } — emitted each frame during active states
//   handLost        { id }                          — emitted when a track is pruned
//   tracksChanged   { count }                       — emitted when number of live tracks changes
//   confirmed       { id, bbox, snapshot }          — winner reached CONFIRMED; snapshot is a Canvas
//   warning         { type }                        — camera_denied | camera_error | mediapipe_unavailable

class GestureDetector extends EventTarget {
  constructor() {
    super();
    this._hands = null;
    this._camera = null;
    this._canvas = null;
    this._ctx = null;
    this._video = null;

    // Multi-person Pose (Tasks Vision) — runs alongside Hands so each tracked
    // hand can be associated to the matching person's face for the snapshot crop.
    this._poseLandmarker = null;
    this._latestPose = null;     // last PoseLandmarker result; refreshed each frame

    // Track pool (multi-hand)
    this._tracks = new Map();    // id → TrackedHand
    this._nextId = 1;
    this._frameCount = 0;
    this._lastTrackCount = 0;

    // Global lock-on / lifecycle
    this._winnerId = null;
    this._locked = false;        // true while CONFIRMED animation plays
    this._cancelTimer = null;

    this._dbgFrame = 0;
  }

  // ─── Init & start ────────────────────────────────────────────────────────────

  async init(videoEl, canvasEl) {
    this._video = videoEl;
    this._canvas = canvasEl;
    this._ctx = canvasEl.getContext('2d');

    if (typeof Hands === 'undefined') {
      console.warn('[Gesture] MediaPipe Hands not loaded — demo mode only');
      this._emit('warning', { type: 'mediapipe_unavailable' });
      return false;
    }

    this._hands = new Hands({
      locateFile: (file) => `vendor/mediapipe/hands/${file}`,
    });

    this._hands.setOptions({
      maxNumHands: CONFIG.maxNumHands,
      modelComplexity: 1,
      minDetectionConfidence: CONFIG.minDetectionConfidence,
      minTrackingConfidence: CONFIG.minTrackingConfidence,
    });

    this._hands.onResults((r) => this._onResults(r));

    // Pose Landmarker (Tasks Vision, multi-person). Dynamic-import the ES module
    // bundle so we don't have to convert the rest of the app to ES modules.
    // Failure here is non-fatal — Hands keeps working, snapshot falls back to
    // the legacy bbox-expand crop.
    try {
      // Dynamic import inside a classic script resolves relative to the
      // script's own URL (Chrome) — gesture.js is at src/, so we step up one
      // level to reach vendor/.
      const mod = await import('../vendor/mediapipe/tasks-vision/vision_bundle.mjs');
      const vision = await mod.FilesetResolver.forVisionTasks(
        'vendor/mediapipe/tasks-vision/wasm',
      );
      this._poseLandmarker = await mod.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'vendor/mediapipe/tasks-vision/pose_landmarker_full.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: CONFIG.poseNumPoses,
        minPoseDetectionConfidence: CONFIG.poseMinDetection,
        minPosePresenceConfidence:  CONFIG.poseMinPresence,
        minTrackingConfidence:      CONFIG.poseMinTracking,
      });
      console.log('[Gesture] PoseLandmarker ready (multi-person, numPoses=' + CONFIG.poseNumPoses + ')');
    } catch (err) {
      console.warn('[Gesture] PoseLandmarker failed to load — snapshot will use legacy bbox crop:', err);
      this._poseLandmarker = null;
    }

    return true;
  }

  async start() {
    if (!this._hands) return false;

    try {
      this._camera = new Camera(this._video, {
        onFrame: async () => {
          if (this._video.readyState < 2) return;
          // Run Pose synchronously first; result is cached on this._latestPose
          // and consumed by _matchTracks below to update each track's
          // associated pose. Wrapped because detectForVideo can throw if
          // timestamps drift; we just skip the frame on error.
          if (this._poseLandmarker) {
            try {
              this._latestPose = this._poseLandmarker.detectForVideo(
                this._video, performance.now(),
              );
            } catch (_) { /* skip this frame */ }
          }
          await this._hands.send({ image: this._video });
        },
        width: CONFIG.cameraWidth,
        height: CONFIG.cameraHeight,
      });
      await this._camera.start();
      console.log('[Gesture] Camera started');
      return true;
    } catch (err) {
      const type = err.name === 'NotAllowedError' ? 'camera_denied' : 'camera_error';
      console.error('[Gesture] Camera error:', err);
      this._emit('warning', { type });
      return false;
    }
  }

  stop() {
    if (this._camera) this._camera.stop();
  }

  // Live-reconfigure MediaPipe Hands detection/tracking confidence. Called by
  // the adaptive Tuner; only invoked when a value actually changed (setOptions
  // triggers a graph reconfigure, so we avoid calling it per-frame).
  setDetectionParams(det, track) {
    if (!this._hands) return;
    try {
      this._hands.setOptions({ minDetectionConfidence: det, minTrackingConfidence: track });
    } catch (e) {
      console.warn('[Gesture] setDetectionParams failed', e);
    }
  }

  // Called externally after CONFIRMED animation finishes.
  resetToIdle() {
    clearTimeout(this._cancelTimer);
    this._locked = false;
    this._winnerId = null;
    for (const id of this._tracks.keys()) {
      this._emit('handLost', { id });
    }
    this._tracks.clear();
    this._frameCount = 0;
    if (this._lastTrackCount !== 0) {
      this._lastTrackCount = 0;
      this._emit('tracksChanged', { count: 0 });
    }
  }

  // ─── Frame processing ─────────────────────────────────────────────────────────

  _onResults(results) {
    this._frameCount++;
    this._drawCameraImage(results);

    if (this._locked) {
      // Keep drawing tracked skeletons during the global animation lock, but
      // don't advance any timers and don't process new gestures.
      this._drawTracks();
      return;
    }

    const now = Date.now();

    // Build the current frame's hand candidates. NB: no min-area filter here.
    // The area gate is applied only when SPAWNING a new track (see _matchTracks);
    // an already-tracked hand keeps matching even as its bbox shrinks — e.g.
    // curling an open palm into a thumbs-up, or the user moving farther away.
    // Pre-filtering here used to drop the curled hand mid-gesture at distance.
    const currentHands = (results.multiHandLandmarks || [])
      .map(lm => ({
        lm,
        wrist: { x: lm[0].x, y: lm[0].y },
        bbox: this._bbox(lm),
        area: this._boundingArea(lm),
      }));

    this._matchTracks(currentHands);
    this._pruneTracks();

    // Step the per-hand state machine only for tracks matched this frame and
    // past the warmup gate. Tracks that vanish before clearing warmup never
    // emit a handStateChange — no phantom overlays from MediaPipe's brief
    // re-detection bounces.
    for (const t of this._tracks.values()) {
      if (t.matchedThisFrame && t.matchedFrameCount >= CONFIG.trackWarmupFrames) {
        this._stepTrack(t, now);
      }
    }

    const count = this._tracks.size;
    if (count !== this._lastTrackCount) {
      this._lastTrackCount = count;
      this._emit('tracksChanged', { count });
    }

    this._drawTracks();
  }

  // ─── Tracking: greedy nearest-neighbour by wrist position ───────────────────

  _matchTracks(currentHands) {
    for (const t of this._tracks.values()) t.matchedThisFrame = false;

    const trackArr = [...this._tracks.values()];
    const pairs = [];
    for (let ti = 0; ti < trackArr.length; ti++) {
      for (let ci = 0; ci < currentHands.length; ci++) {
        const d = Math.hypot(
          trackArr[ti].wrist.x - currentHands[ci].wrist.x,
          trackArr[ti].wrist.y - currentHands[ci].wrist.y,
        );
        if (d <= CONFIG.trackMatchMaxDist) pairs.push({ ti, ci, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedTracks = new Set();
    const usedCurrent = new Set();
    for (const p of pairs) {
      if (usedTracks.has(p.ti) || usedCurrent.has(p.ci)) continue;
      usedTracks.add(p.ti);
      usedCurrent.add(p.ci);
      const t = trackArr[p.ti];
      const c = currentHands[p.ci];
      t.matchedThisFrame = true;
      t.matchedFrameCount++;
      t.lastSeenFrame = this._frameCount;
      t.landmarks = c.lm;
      t.wrist = c.wrist;
      t.bbox = c.bbox;
      this._associateTrackToPose(t);
    }

    for (let ci = 0; ci < currentHands.length; ci++) {
      if (usedCurrent.has(ci)) continue;
      const c = currentHands[ci];
      // Min-area gate applies only to NEW tracks — rejects tiny background
      // hand-like detections from spawning phantom tracks. Existing tracks
      // already matched above bypass this, so curling/distance can't drop them.
      if (c.area < CONFIG.minHandAreaFraction) continue;
      const id = this._nextId++;
      const newTrack = {
        id,
        state: 'IDLE',
        holdStart: null,
        promptStart: null,
        confirmDropFrames: 0,
        detectDropFrames: 0,
        awaitingPalm: false,
        matchedFrameCount: 1,
        lastSeenFrame: this._frameCount,
        landmarks: c.lm,
        wrist: c.wrist,
        bbox: c.bbox,
        matchedThisFrame: true,
        poseLandmarks: null,    // refreshed each frame by _associateTrackToPose
      };
      this._associateTrackToPose(newTrack);
      this._tracks.set(id, newTrack);
    }
  }

  // For a track that has a fresh wrist this frame, find the multi-person Pose
  // skeleton whose left- or right-wrist landmark is nearest. Caches the matched
  // skeleton on the track so the snapshot crop has access to nose + shoulders.
  // Sets t.poseLandmarks = null if no pose is within wristMatchMaxDist.
  _associateTrackToPose(t) {
    t.poseLandmarks = null;
    const pose = this._latestPose;
    if (!pose || !pose.landmarks || pose.landmarks.length === 0) return;

    let bestD = CONFIG.wristMatchMaxDist;
    let bestPose = null;
    for (const skeleton of pose.landmarks) {
      // Pose landmark indices: 15 = left wrist, 16 = right wrist.
      const lw = skeleton[15];
      const rw = skeleton[16];
      const dl = lw ? Math.hypot(lw.x - t.wrist.x, lw.y - t.wrist.y) : Infinity;
      const dr = rw ? Math.hypot(rw.x - t.wrist.x, rw.y - t.wrist.y) : Infinity;
      const d = Math.min(dl, dr);
      if (d < bestD) { bestD = d; bestPose = skeleton; }
    }
    t.poseLandmarks = bestPose;
  }

  _pruneTracks() {
    for (const [id, t] of this._tracks) {
      if (this._frameCount - t.lastSeenFrame > CONFIG.trackMissingMaxFrames) {
        this._tracks.delete(id);
        this._emit('handLost', { id });
      }
    }
  }

  // ─── Per-hand state machine ──────────────────────────────────────────────────

  _stepTrack(t, now) {
    const lm = t.landmarks;
    switch (t.state) {

      case 'IDLE': {
        if (this._isOpenPalm(lm)) {
          t.holdStart = now;
          t.awaitingPalm = false;
          this._setTrackState(t, 'DETECTING');
        }
        break;
      }

      case 'DETECTING': {
        // The 2 s open-palm hold is mandatory — there is no shortcut to
        // CONFIRMING from here. The only exit toward confirmation is completing
        // the full hold → PROMPTING → thumbs-up. (The session-7 thumbs-up
        // shortcut was removed: the spec requires the palm be held the full 2 s,
        // and a thumbs-up mid-hold must NOT bypass it.)
        if (!this._isOpenPalm(lm)) {
          // Hysteresis: tolerate brief shape flickers (tracking jitter) before
          // reacting. Past that, treat it as the user breaking the palm early:
          // restart the count and prompt them to hold the palm up, rather than
          // silently advancing or dropping to IDLE. A hand that is actually
          // lowered is pruned → handLost → IDLE by the normal track lifecycle.
          t.detectDropFrames++;
          if (t.detectDropFrames >= CONFIG.detectDropMaxFrames) {
            t.holdStart = now;          // count restarts from zero
            t.awaitingPalm = true;
            this._emit('handProgress', {
              id: t.id, state: 'DETECTING', value: 0, wrist: t.wrist,
              bbox: t.bbox, hint: 'repalm',
            });
          }
          break;
        }
        // Clean palm seen this frame.
        t.detectDropFrames = 0;
        if (t.awaitingPalm) {
          // Palm just returned after an early break — the timer was already
          // reset to `now` on the break, so the 2 s starts fresh here.
          t.awaitingPalm = false;
          t.holdStart = now;
        }
        const value = Math.min((now - t.holdStart) / CONFIG.gestureHoldMs, 1);
        this._emit('handProgress', {
          id: t.id, state: 'DETECTING', value, wrist: t.wrist, bbox: t.bbox,
        });
        if (now - t.holdStart >= CONFIG.gestureHoldMs) {
          t.promptStart = now;
          this._setTrackState(t, 'PROMPTING');
        }
        break;
      }

      case 'PROMPTING': {
        const elapsed = now - t.promptStart;
        const value = Math.min(elapsed / CONFIG.confirmationTimeoutMs, 1);
        this._emit('handProgress', {
          id: t.id, state: 'PROMPTING', value, wrist: t.wrist, bbox: t.bbox,
        });
        if (elapsed >= CONFIG.confirmationTimeoutMs) {
          // Per-track timeout — silently reset this hand only. Other hands keep
          // running; one user giving up doesn't block the crowd.
          this._setTrackState(t, 'IDLE');
          break;
        }
        if (this._isThumbsUp(lm)) {
          t.holdStart = now;
          this._setTrackState(t, 'CONFIRMING');
        }
        break;
      }

      case 'CONFIRMING': {
        if (!this._isThumbsUp(lm)) {
          t.confirmDropFrames++;
          if (t.confirmDropFrames >= 5) {
            t.confirmDropFrames = 0;
            this._setTrackState(t, 'PROMPTING');
          }
          break;
        }
        t.confirmDropFrames = 0;
        const value = Math.min((now - t.holdStart) / CONFIG.gestureHoldMs, 1);
        this._emit('handProgress', {
          id: t.id, state: 'CONFIRMING', value, wrist: t.wrist, bbox: t.bbox,
        });
        if (now - t.holdStart >= CONFIG.gestureHoldMs) {
          this._winnerId = t.id;
          this._locked = true;
          const snapshot = this._captureUserSnapshot(t);
          this._setTrackState(t, 'CONFIRMED');
          this._emit('confirmed', { id: t.id, bbox: t.bbox, snapshot });
        }
        break;
      }

      case 'CONFIRMED':
        break;
    }
  }

  _setTrackState(t, s) {
    const prev = t.state;
    if (prev === s) return;
    t.state = s;
    console.log(`[Gesture] track#${t.id} ${prev} → ${s}`);
    this._emit('handStateChange', { id: t.id, state: s, prev, wrist: t.wrist });
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────────

  _drawCameraImage(results) {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, 0, 0, w, h);
    ctx.restore();
  }

  _drawTracks() {
    if (typeof drawConnectors === 'undefined') return;
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    for (const t of this._tracks.values()) {
      const c = this._trackColors(t);
      drawConnectors(ctx, t.landmarks, HAND_CONNECTIONS, { color: c.line, lineWidth: c.lineWidth });
      drawLandmarks(ctx, t.landmarks, {
        color: c.dot,
        fillColor: c.dotFill,
        lineWidth: 1,
        radius: c.radius,
      });
    }
    ctx.restore();
  }

  _trackColors(t) {
    if (t.id === this._winnerId) {
      return { line: '#ff7e00', dot: '#ff7e00', dotFill: 'rgba(255,126,0,0.85)', lineWidth: 3.5, radius: 6 };
    }
    switch (t.state) {
      case 'PROMPTING':
      case 'CONFIRMING':
        return { line: '#ff7e00', dot: '#ff7e00', dotFill: 'rgba(255,126,0,0.55)', lineWidth: 2.5, radius: 5 };
      case 'DETECTING':
        return { line: '#ffb066', dot: '#ff7e00', dotFill: 'rgba(255,126,0,0.45)', lineWidth: 2.5, radius: 5 };
      default:
        return { line: '#4fc3f7', dot: '#4fc3f7', dotFill: 'rgba(79,195,247,0.45)', lineWidth: 2, radius: 4 };
    }
  }

  // ─── Snapshot capture (winner portrait, driven by Pose if available) ────────
  // Returns a 280×280 Canvas, or null if no usable crop could be produced
  // (UI shows a "?" placeholder in that case).

  _captureUserSnapshot(t) {
    const v = this._video;
    if (!v || !v.videoWidth || !v.videoHeight) return null;

    // Pose available + matched this track → portrait crop (best case).
    // Pose available but no match for this track (occluded torso, edge of
    // frame, sitting user) → return null so UI shows the "?" placeholder.
    // Pose not loaded at all (init failure) → graceful degradation to the
    // legacy hand-bbox crop so the demo still produces something.
    let crop = null;
    if (this._poseLandmarker) {
      crop = this._poseCrop(t.poseLandmarks);   // null on no-match
    } else {
      crop = this._handBboxCrop(t.bbox);        // legacy path
    }
    if (!crop) return null;

    const out = document.createElement('canvas');
    out.width = 280;
    out.height = 280;
    const octx = out.getContext('2d');
    // Mirror so the snapshot matches the selfie view the user has been watching.
    octx.save();
    octx.translate(out.width, 0);
    octx.scale(-1, 1);
    octx.drawImage(
      v,
      crop.sx * v.videoWidth, crop.sy * v.videoHeight,
      crop.sw * v.videoWidth, crop.sh * v.videoHeight,
      0, 0, out.width, out.height,
    );
    octx.restore();
    return out;
  }

  // Crop from the Pose skeleton: square centred on nose, side = ~2.8 ×
  // shoulder span (face + a bit of torso). Returns null if the skeleton is
  // missing the required landmarks.
  _poseCrop(pose) {
    if (!pose) return null;
    const nose = pose[0];
    const ls = pose[11];
    const rs = pose[12];
    if (!nose || !ls || !rs) return null;

    const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    if (shoulderSpan <= 0.01) return null;     // skeleton is degenerate

    const side = Math.min(Math.max(shoulderSpan * 2.8, 0.18), 0.9);
    const cx = nose.x;
    // Shift centre slightly below the nose so face fills the upper portion
    // with a thin slice of shoulders below — same composition as the legacy
    // hand-bbox crop, just driven by the pose.
    const cy = nose.y + side * 0.18;
    return this._clampSquareCrop(cx, cy, side);
  }

  // Legacy fallback: square crop expanded from the hand bbox, biased upward
  // so the face fills the top ~75 %. Used when Pose has no match for this
  // hand (occluded torso, sitting user, edge of frame).
  _handBboxCrop(bbox) {
    if (!bbox) return null;
    const cx = bbox.x + bbox.w / 2;
    const side = Math.max(bbox.w, bbox.h) * CONFIG.snapshotExpandFactor;
    const cy = (bbox.y + bbox.h / 2) - side * 0.25;
    return this._clampSquareCrop(cx, cy, side);
  }

  _clampSquareCrop(cx, cy, side) {
    let sx = cx - side / 2;
    let sy = cy - side / 2;
    let sw = side;
    let sh = side;
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > 1) sw = 1 - sx;
    if (sy + sh > 1) sh = 1 - sy;
    if (sw <= 0 || sh <= 0) return null;
    return { sx, sy, sw, sh };
  }

  // ─── Gesture classifiers ──────────────────────────────────────────────────────

  // Per-finger extension ratio: tip-to-MCP distance over PIP-to-MCP distance.
  // A straight finger spans ~2.5–3× its first segment; a folded finger curls
  // the tip back toward the knuckle so the ratio collapses below ~1.2. Computed
  // from 2D distances, so it is invariant to hand rotation — unlike the old
  // image-y comparisons that read a sideways open hand as a fist.
  _fingerRatio(lm, mcp, pip, tip) {
    const dTipMcp = Math.hypot(lm[tip].x - lm[mcp].x, lm[tip].y - lm[mcp].y);
    const dPipMcp = Math.hypot(lm[pip].x - lm[mcp].x, lm[pip].y - lm[mcp].y);
    return dTipMcp / (dPipMcp + 1e-6);
  }

  // [mcp, pip, tip] landmark indices for the four non-thumb fingers.
  static get _FINGERS() {
    return [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  }

  _isOpenPalm(lm) {
    // Reject the thumbs-up shape first so a fist+thumb can't double-trigger.
    if (this._isThumbsUp(lm)) return false;

    // ≥3 of 4 fingers genuinely extended (ratio-based, rotation-independent).
    const extended = GestureDetector._FINGERS
      .filter(([m, p, t]) => this._fingerRatio(lm, m, p, t) > CONFIG.fingerExtendRatioMin)
      .length;
    if (extended < 3) return false;

    // Orientation gate: the palm must be RAISED and pointing UP — an intentional
    // hail, not a hand resting on a lap/desk or hanging at the side. Here "up"
    // is image-space (smaller y), which is legitimately gravity/camera-relative
    // (unlike curl, which must stay rotation-free). Require ≥3 fingertips above
    // their own MCP and the hand upright (knuckles above the wrist). Strict
    // inequalities keep it scale-independent, so a small far-field hand still
    // qualifies as long as it's actually pointing up.
    const fingersUp = GestureDetector._FINGERS
      .filter(([m, p, t]) => lm[t].y < lm[m].y)
      .length;
    const handUpright = lm[9].y < lm[0].y;   // middle-finger MCP above the wrist

    return fingersUp >= 3 && handUpright;
  }

  _isThumbsUp(lm) {
    // "Up" is genuinely orientation-dependent, so keep an image-y check: the
    // thumb tip must sit above its own MCP and above the four finger knuckles.
    const thumbUp = lm[4].y < lm[2].y &&
      lm[4].y < lm[5].y && lm[4].y < lm[9].y &&
      lm[4].y < lm[13].y && lm[4].y < lm[17].y;
    if (!thumbUp) return false;

    // Thumb genuinely extended (not a curled fist with the thumb merely highest).
    const thumbExtended = this._fingerRatio(lm, 2, 3, 4) > CONFIG.fingerExtendRatioMin * 0.7;

    // The fix: require ≥3 fingers actually folded, measured by curl ratio —
    // a rotated open hand has high ratios and fails this, so it can no longer
    // be mistaken for a thumbs-up.
    const curled = GestureDetector._FINGERS
      .filter(([m, p, t]) => this._fingerRatio(lm, m, p, t) < CONFIG.fingerCurlRatioMax)
      .length;

    return thumbExtended && curled >= 3;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  _bbox(lm) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  _boundingArea(lm) {
    const b = this._bbox(lm);
    return b.w * b.h;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
