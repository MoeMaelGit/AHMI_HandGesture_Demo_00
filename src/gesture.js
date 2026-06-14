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
    this._missStreak = 0;        // consecutive frames Pose sees a raised hand the Hands model missed

    // Ambient luminance (lighting-aware tuning). A single mean 0–1 number,
    // sampled from a tiny downscale of the frame — never a stored image.
    this._luminance = null;      // null until first sample
    this._lumaCanvas = null;
    this._lumaCtx = null;

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
    this._resetStaleGestures();

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

    this._checkRaisedHandMiss();
    if (this._frameCount % CONFIG.luminanceSampleEveryFrames === 0) this._sampleLuminance();

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
      // Resume after a Hands dropout (sticky tracking kept this track alive while
      // Pose confirmed the arm was up): pause the gesture timer across the gap so
      // the re-acquired countdown continues smoothly instead of jumping — a long
      // freeze must never instantly complete a 2 s hold.
      if (t.lostAt) {
        const gap = Date.now() - t.lostAt;
        if (t.holdStart) t.holdStart += gap;
        if (t.promptStart) t.promptStart += gap;
        t.lostAt = null;
      }
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
      // Far-field assist: a sub-threshold (small/distant) hand is still admitted
      // when Pose vouches that a real raised arm is there — a poster/reflection
      // has no body, so noise is still rejected.
      if (c.area < CONFIG.minHandAreaFraction && !this._poseRaisedWristNear(c.wrist)) continue;
      const id = this._nextId++;
      const newTrack = {
        id,
        state: 'IDLE',
        holdStart: null,
        promptStart: null,
        confirmDropFrames: 0,
        detectDropFrames: 0,
        awaitingPalm: false,
        lostAt: null,           // Date.now() while unmatched mid-gesture (sticky timer pause)
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

  // When a hand leaves mid-gesture the track lingers (for ID stability) but its
  // countdown must NOT survive — otherwise the frozen overlay sits there and a
  // different hand sliding into that spot re-associates and inherits the
  // in-progress gesture. So if an active track goes unmatched for more than a
  // brief grace (gestureStaleFrames), reset it to IDLE: the overlay clears and
  // any hand that re-occupies the spot starts a fresh gesture. The track ID
  // survives until trackMissingMaxFrames for continuity; the winner during the
  // CONFIRMED animation lock is never reached here (locked path returns early).
  _resetStaleGestures() {
    for (const t of this._tracks.values()) {
      if (t.matchedThisFrame || t.state === 'IDLE' || t.id === this._winnerId) continue;
      // Stamp when the Hands dropout began, so the timer can be paused across it.
      if (!t.lostAt) t.lostAt = Date.now();
      if (this._frameCount - t.lastSeenFrame <= CONFIG.gestureStaleFrames) continue;   // brief flicker — wait it out
      // Sticky: Pose still shows a raised arm here → Hands just lost a small or
      // curled hand at distance, not a departure. Keep the gesture; it rides the
      // normal trackMissingMaxFrames prune window instead of resetting. The
      // phantom-hand-off fix is preserved: dropping your hand lowers the arm →
      // Pose no longer raised → the reset below fires → no inheritance.
      if (this._poseRaisedWristNear(t.wrist)) continue;
      t.holdStart = null;
      t.promptStart = null;
      t.detectDropFrames = 0;
      t.confirmDropFrames = 0;
      t.awaitingPalm = false;
      t.lostAt = null;
      this._setTrackState(t, 'IDLE');   // emits handStateChange → UI removes the overlay
    }
  }

  // Every Pose wrist currently raised above its elbow ({x,y} each). Pose sees the
  // whole person even at distances where the Hands model can't lock the small
  // hand, so these are ground-truth "a real hand is here, and up" anchors.
  _raisedPoseWrists() {
    const out = [];
    const pose = this._latestPose;
    if (!pose || !pose.landmarks) return out;
    for (const sk of pose.landmarks) {
      // (wrist, elbow) index pairs — 15/13 left, 16/14 right.
      for (const [wi, ei] of [[15, 13], [16, 14]]) {
        const wrist = sk[wi], elbow = sk[ei];
        if (!wrist || !elbow) continue;
        if (wrist.y < elbow.y - CONFIG.poseRaisedMargin) out.push(wrist);   // wrist above elbow → raised
      }
    }
    return out;
  }

  // True if a raised Pose wrist is within wristMatchMaxDist of `point` — i.e.
  // Pose vouches that a real, raised hand is at this spot even if Hands didn't
  // report one (far/small/curled). Used to admit far hands and to keep an
  // in-gesture track alive through brief Hands dropouts.
  _poseRaisedWristNear(point) {
    for (const w of this._raisedPoseWrists()) {
      if (Math.hypot(w.x - point.x, w.y - point.y) <= CONFIG.wristMatchMaxDist) return true;
    }
    return false;
  }

  // True when a raised Pose wrist has NO Hands track sitting near it — a genuine
  // "the hand model is missing a real hand" signal for the adaptive Tuner.
  _raisedHandMissed() {
    for (const w of this._raisedPoseWrists()) {
      let tracked = false;
      for (const t of this._tracks.values()) {
        if (Math.hypot(t.wrist.x - w.x, t.wrist.y - w.y) <= CONFIG.wristMatchMaxDist) { tracked = true; break; }
      }
      if (!tracked) return true;
    }
    return false;
  }

  // Far-field robustness signal for the adaptive Tuner. Unlike a bare "no track"
  // signal it stays silent during idle (no raised hand → nothing to miss), so it
  // only fires when a hand is genuinely present but undetected. Emits 'handMissed'
  // after the miss persists ~1 s so brief Pose jitter doesn't trigger a loosen.
  _checkRaisedHandMiss() {
    if (this._raisedHandMissed()) {
      this._missStreak++;
      if (this._missStreak >= CONFIG.poseMissFramesToLoosen) {
        this._missStreak = 0;     // re-arm; a sustained miss emits ~once per second
        this._emit('handMissed', {});
      }
    } else {
      this._missStreak = 0;
    }
  }

  // Mean ambient brightness (0–1) from a 16×16 downscale of the current frame.
  // Privacy-safe: only the average number is kept — no pixels/frames are stored.
  // The adaptive Tuner uses it to tell a dim room (loosen detection confidence)
  // from a far hand in good light (loosen the area threshold).
  _sampleLuminance() {
    const v = this._video;
    if (!v || !v.videoWidth) return;
    if (!this._lumaCanvas) {
      this._lumaCanvas = document.createElement('canvas');
      this._lumaCanvas.width = 16;
      this._lumaCanvas.height = 16;
      this._lumaCtx = this._lumaCanvas.getContext('2d', { willReadFrequently: true });
    }
    try {
      this._lumaCtx.drawImage(v, 0, 0, 16, 16);
      const d = this._lumaCtx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      this._luminance = sum / (d.length / 4) / 255;   // 0–1
    } catch (_) { /* keep last value (e.g. transient draw error) */ }
  }

  getLuminance() { return this._luminance; }

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
      // Don't draw a frozen skeleton for a hand that has left the frame: only
      // render tracks seen within the last couple frames (tolerates a 1-frame
      // detection gap). The winner is always drawn so its skeleton stays up
      // through the CONFIRMED animation lock.
      if (this._frameCount - t.lastSeenFrame > 2 && t.id !== this._winnerId) continue;
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
    // Black/gold theme: gold for active/winning states, muted grey when idle
    // (minimal jewel-accent). Gold #dbc07c (bright) / #c5a961 (soft).
    if (t.id === this._winnerId) {
      return { line: '#dbc07c', dot: '#dbc07c', dotFill: 'rgba(219,192,124,0.85)', lineWidth: 3.5, radius: 6 };
    }
    switch (t.state) {
      case 'PROMPTING':
      case 'CONFIRMING':
        return { line: '#dbc07c', dot: '#dbc07c', dotFill: 'rgba(219,192,124,0.55)', lineWidth: 2.5, radius: 5 };
      case 'DETECTING':
        return { line: '#c5a961', dot: '#dbc07c', dotFill: 'rgba(219,192,124,0.45)', lineWidth: 2.5, radius: 5 };
      default:
        return { line: '#9a9a9f', dot: '#c5a961', dotFill: 'rgba(197,169,97,0.40)', lineWidth: 2, radius: 4 };
    }
  }

  // ─── Snapshot capture (winner portrait, driven by Pose if available) ────────
  // Returns a 280×280 Canvas, or null if no usable crop could be produced
  // (UI shows a "?" placeholder in that case).

  _captureUserSnapshot(t) {
    const v = this._video;
    if (!v || !v.videoWidth || !v.videoHeight) return null;

    // Best case: Pose matched this track → tight, face-centred portrait crop.
    // Pose available but no face match (occluded torso, sitting user, edge of
    // frame) → fall back to a crop CENTRED ON THE HAND that was detected, rather
    // than a "?" placeholder — we honestly show what we captured.
    // Pose not loaded at all (init failure) → legacy face-biased hand-bbox crop.
    let crop = null;
    if (this._poseLandmarker) {
      crop = t.poseLandmarks ? this._poseCrop(t.poseLandmarks) : null;
      if (!crop) crop = this._handCenteredCrop(t.bbox);
    } else {
      crop = this._handBboxCrop(t.bbox);
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

  // Face-centred crop from the Pose skeleton. Estimates head width from the
  // actual face landmarks — ear-to-ear (lm7,lm8), else eye-outer span
  // (lm3,lm6), else a fraction of the shoulder span — and frames the head to
  // fill the portrait (head ≈ half the crop). Much tighter than the old
  // shoulder-span×2.8 crop, which zoomed out to torso. Returns null if it has
  // no usable landmarks.
  _poseCrop(pose) {
    if (!pose) return null;
    const nose = pose[0];
    if (!nose) return null;

    const earL = pose[7], earR = pose[8];
    const eyeL = pose[3], eyeR = pose[6];   // eye-outer corners
    let headW = 0;
    if (earL && earR) headW = Math.hypot(earL.x - earR.x, earL.y - earR.y);
    else if (eyeL && eyeR) headW = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y) * 2.0;
    if (headW < 0.02) {
      const ls = pose[11], rs = pose[12];
      if (!ls || !rs) return null;
      const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      if (shoulderSpan <= 0.01) return null;
      headW = shoulderSpan * 0.85;
    }

    const side = Math.min(Math.max(headW * 2.1, 0.14), 0.9);
    const cx = nose.x;
    const cy = nose.y - side * 0.06;   // shift up a touch so the whole head + forehead frames
    return this._clampSquareCrop(cx, cy, side);
  }

  // No-face fallback: a square crop CENTRED on the detected hand (not biased
  // upward to guess a face). Shows the hand region honestly when Pose couldn't
  // match a body to the winning hand.
  _handCenteredCrop(bbox) {
    if (!bbox) return null;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const side = Math.min(Math.max(Math.max(bbox.w, bbox.h) * 2.6, 0.12), 0.9);
    return this._clampSquareCrop(cx, cy, side);
  }

  // Legacy fallback (Pose not loaded at all): square crop expanded from the
  // hand bbox, biased upward so a face would fill the top ~75 %.
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

    // Orientation gate: the palm must be RAISED and pointing UP within an angle
    // tolerance — an intentional hail, not a hand at rest, hanging, or held near
    // horizontal (e.g. gripping a phone). The hand axis is wrist → middle
    // FINGERTIP (lm0 → lm12); its tilt from straight-up must be ≤ palmMaxTiltDeg.
    // Using the fingertip (not the knuckle) gives a long lever arm, so the angle
    // is far less sensitive to landmark noise — important at distance, where the
    // short wrist→knuckle vector was noisy enough to reject a genuine raised
    // palm. Fingers are already confirmed extended above, so lm12 is reliably
    // far from the wrist. "Up" is image-space (gravity-relative — legitimate for
    // orientation, unlike curl which stays rotation-free), and the angle is a
    // ratio of distances, so it's scale-independent.
    const axisX = lm[12].x - lm[0].x;
    const rise = lm[0].y - lm[12].y;           // >0 when the fingertip is above the wrist
    if (rise <= 0) return false;               // pointing sideways or down
    const tiltDeg = Math.atan2(Math.abs(axisX), rise) * 180 / Math.PI;
    return tiltDeg <= CONFIG.palmMaxTiltDeg;
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
