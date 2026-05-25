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
    return true;
  }

  async start() {
    if (!this._hands) return false;

    try {
      this._camera = new Camera(this._video, {
        onFrame: async () => {
          if (this._video.readyState >= 2) {
            await this._hands.send({ image: this._video });
          }
        },
        width: 1280,
        height: 720,
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

    // Build the current frame's hand candidates (filtered by min area).
    const currentHands = (results.multiHandLandmarks || [])
      .map(lm => ({
        lm,
        wrist: { x: lm[0].x, y: lm[0].y },
        bbox: this._bbox(lm),
        area: this._boundingArea(lm),
      }))
      .filter(c => c.area >= CONFIG.minHandAreaFraction);

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
    }

    for (let ci = 0; ci < currentHands.length; ci++) {
      if (usedCurrent.has(ci)) continue;
      const c = currentHands[ci];
      const id = this._nextId++;
      this._tracks.set(id, {
        id,
        state: 'IDLE',
        holdStart: null,
        promptStart: null,
        confirmDropFrames: 0,
        detectDropFrames: 0,
        matchedFrameCount: 1,
        lastSeenFrame: this._frameCount,
        landmarks: c.lm,
        wrist: c.wrist,
        bbox: c.bbox,
        matchedThisFrame: true,
      });
    }
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
          this._setTrackState(t, 'DETECTING');
        }
        break;
      }

      case 'DETECTING': {
        // Direct shortcut: user curled into a clean thumbs-up while we were
        // still counting the palm hold. Honour the intent — jump straight to
        // CONFIRMING with a fresh hold timer. This prevents the multi-hand
        // footgun where switching one of several palms to a thumbs-up while
        // mid-DETECTING dropped the hand back to IDLE.
        if (this._isThumbsUp(lm)) {
          t.holdStart = now;
          t.confirmDropFrames = 0;
          t.detectDropFrames = 0;
          this._setTrackState(t, 'CONFIRMING');
          break;
        }
        if (!this._isOpenPalm(lm)) {
          // Hysteresis: tolerate brief shape flickers (palm→fist transition,
          // tracking jitter) the same way CONFIRMING does. Only reset to IDLE
          // after the palm has been continuously absent for N frames.
          t.detectDropFrames++;
          if (t.detectDropFrames >= CONFIG.detectDropMaxFrames) {
            t.detectDropFrames = 0;
            this._setTrackState(t, 'IDLE');
          }
          break;
        }
        t.detectDropFrames = 0;
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
          const snapshot = this._captureUserSnapshot(t.bbox);
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

  // ─── Snapshot capture (winner crop, expanded to capture face + torso) ────────

  _captureUserSnapshot(bbox) {
    const v = this._video;
    if (!v || !v.videoWidth || !v.videoHeight) return null;

    const cx = bbox.x + bbox.w / 2;
    const cyHand = bbox.y + bbox.h / 2;
    const side = Math.max(bbox.w, bbox.h) * CONFIG.snapshotExpandFactor;
    // Bias the crop upward so the hand sits at ~75% from the top — face +
    // shoulders fill the upper 75%, hand anchors the bottom. Makes "who
    // ordered the taxi" readable in the corner card.
    const cy = cyHand - side * 0.25;
    let sx = cx - side / 2;
    let sy = cy - side / 2;
    let sw = side;
    let sh = side;
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > 1) sw = 1 - sx;
    if (sy + sh > 1) sh = 1 - sy;
    if (sw <= 0 || sh <= 0) return null;

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
      sx * v.videoWidth, sy * v.videoHeight, sw * v.videoWidth, sh * v.videoHeight,
      0, 0, out.width, out.height,
    );
    octx.restore();
    return out;
  }

  // ─── Gesture classifiers ──────────────────────────────────────────────────────

  _isOpenPalm(lm) {
    // Guard: curled fingers + upward thumb = thumbs-up, NOT an open palm.
    const thumbUp    = lm[4].y < lm[2].y && lm[4].y < lm[5].y;
    const fistCurled = [
      lm[8].y  > lm[5].y  - 0.06,
      lm[12].y > lm[9].y  - 0.06,
      lm[16].y > lm[13].y - 0.06,
      lm[20].y > lm[17].y - 0.06,
    ].filter(Boolean).length >= 3;
    if (thumbUp && fistCurled) return false;

    const extended = [
      lm[8].y  < lm[6].y  + 0.02,
      lm[12].y < lm[10].y + 0.02,
      lm[16].y < lm[14].y + 0.02,
      lm[20].y < lm[18].y + 0.02,
    ].filter(Boolean).length;

    const thumbOpen = lm[4].y < lm[1].y + 0.02;
    return extended >= 3 && thumbOpen;
  }

  _isThumbsUp(lm) {
    const thumbExtended = lm[4].y < lm[2].y;
    const aboveMCPs = [
      lm[4].y < lm[5].y,
      lm[4].y < lm[9].y,
      lm[4].y < lm[13].y,
      lm[4].y < lm[17].y,
    ].filter(Boolean).length >= 3;
    const curled = [
      lm[8].y  > lm[5].y  - 0.08,
      lm[12].y > lm[9].y  - 0.08,
      lm[16].y > lm[13].y - 0.08,
      lm[20].y > lm[17].y - 0.08,
    ].filter(Boolean).length;
    return thumbExtended && aboveMCPs && curled >= 3;
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
