// GestureDetector — MediaPipe Hands integration + 5-state machine.
// Extends EventTarget and emits: statechange | progress | promptProgress | confirmProgress | warning
//
// State transitions (strict per spec):
//   IDLE → DETECTING (open palm stable 2 s) → PROMPTING (thumbs-up, 8 s window)
//        → CONFIRMING (thumbs-up stable 2 s) → CONFIRMED
//   ANY  → IDLE on hand loss or timeout
//   ANY  → CANCELLED on prompt timeout → auto-reset to IDLE

class GestureDetector extends EventTarget {
  constructor() {
    super();
    this.state = 'IDLE';
    this._hands = null;
    this._camera = null;
    this._canvas = null;
    this._ctx = null;
    this._video = null;

    // Hold tracking
    this._refCentroid = null;   // anchor point (updated silently each frame — no longer resets timer)
    this._holdStart = null;     // timestamp when hold began (resets only on gesture loss)
    this._promptStart = null;   // timestamp when PROMPTING began

    this._cancelTimer = null;
    this._locked = false;       // true while CONFIRMED/CANCELLED animation plays
    this._confirmDropFrames = 0; // hysteresis: frames where thumbs-up was lost in CONFIRMING
    this._dbgFrame = 0;         // throttled debug logging counter
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
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
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

  // Called externally after CONFIRMED animation finishes or CANCELLED timeout.
  resetToIdle() {
    clearTimeout(this._cancelTimer);
    this._locked = false;
    this._refCentroid = null;
    this._holdStart = null;
    this._promptStart = null;
    this._confirmDropFrames = 0;
    this._setState('IDLE');
  }

  // ─── Frame processing ─────────────────────────────────────────────────────────

  _onResults(results) {
    this._drawFrame(results);
    if (this._locked) return;

    const now = Date.now();
    const allHands = results.multiHandLandmarks || [];
    const best = this._pickBestHand(allHands);

    switch (this.state) {

      case 'IDLE': {
        if (best && this._isOpenPalm(best) && this._inZone(best)) {
          this._refCentroid = this._wrist(best);
          this._holdStart = now;
          this._setState('DETECTING');
        }
        break;
      }

      case 'DETECTING': {
        if (!best || !this._isOpenPalm(best) || !this._inZone(best)) {
          // Palm lost — only then reset timer
          this._setState('IDLE');
          break;
        }
        // Update reference silently (track hand position without resetting the timer).
        // Normal walking-level movement no longer penalises the hold countdown.
        this._refCentroid = this._wrist(best);

        const progress = Math.min((now - this._holdStart) / CONFIG.gestureHoldMs, 1);
        this._emit('progress', { value: progress });
        if (now - this._holdStart >= CONFIG.gestureHoldMs) {
          this._promptStart = now;
          this._setState('PROMPTING');
        }
        break;
      }

      case 'PROMPTING': {
        // Hand gone → IDLE
        if (!best || !this._inZone(best)) {
          this._setState('IDLE');
          break;
        }
        const elapsed = now - this._promptStart;
        const timeProgress = Math.min(elapsed / CONFIG.confirmationTimeoutMs, 1);
        this._emit('promptProgress', { value: timeProgress });

        if (elapsed >= CONFIG.confirmationTimeoutMs) {
          this._locked = true;
          this._setState('CANCELLED');
          this._cancelTimer = setTimeout(() => this.resetToIdle(), CONFIG.cancelledDisplayMs);
          break;
        }
        if (this._isThumbsUp(best)) {
          this._refCentroid = this._wrist(best);
          this._holdStart = now;
          this._setState('CONFIRMING');
        }
        break;
      }

      case 'CONFIRMING': {
        if (!best || !this._inZone(best)) {
          this._confirmDropFrames = 0;
          this._setState('IDLE');
          break;
        }
        if (!this._isThumbsUp(best)) {
          // Allow up to 5 consecutive missed frames before reverting — prevents flicker.
          this._confirmDropFrames++;
          if (this._confirmDropFrames >= 5) {
            this._confirmDropFrames = 0;
            this._setState('PROMPTING');
          }
          break;
        }
        this._confirmDropFrames = 0;
        // Track without resetting the confirm timer
        this._refCentroid = this._wrist(best);
        const progress = Math.min((now - this._holdStart) / CONFIG.gestureHoldMs, 1);
        this._emit('confirmProgress', { value: progress });
        if (now - this._holdStart >= CONFIG.gestureHoldMs) {
          this._locked = true;
          this._setState('CONFIRMED');
        }
        break;
      }

      case 'CONFIRMED':
      case 'CANCELLED':
        break;
    }
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────────

  _drawFrame(results) {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Mirror the feed horizontally (selfie view)
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, 0, 0, w, h);

    // Overlay hand skeleton during all active states so user sees if hand is tracked
    const showSkeleton = this.state === 'DETECTING' || this.state === 'PROMPTING' || this.state === 'CONFIRMING';
    if (showSkeleton && results.multiHandLandmarks && typeof drawConnectors !== 'undefined') {
      for (const lm of results.multiHandLandmarks) {
        drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: '#4fc3f7', lineWidth: 2.5 });
        drawLandmarks(ctx, lm, {
          color: '#ff7e00',
          fillColor: 'rgba(255,126,0,0.55)',
          lineWidth: 1,
          radius: 5,
        });
      }
    }

    ctx.restore();
  }

  // ─── Gesture classifiers ──────────────────────────────────────────────────────

  _isOpenPalm(lm) {
    // Guard: curled fingers + upward thumb = thumbs-up, NOT an open palm.
    // This prevents a fist-with-thumb-up from slipping through the PIP tolerance below.
    const thumbUp    = lm[4].y < lm[2].y && lm[4].y < lm[5].y;
    const fistCurled = [
      lm[8].y  > lm[5].y  - 0.06,
      lm[12].y > lm[9].y  - 0.06,
      lm[16].y > lm[13].y - 0.06,
      lm[20].y > lm[17].y - 0.06,
    ].filter(Boolean).length >= 3;
    if (thumbUp && fistCurled) return false;

    // Tip above PIP with a small tolerance so angled hands still register.
    const extended = [
      lm[8].y  < lm[6].y  + 0.02,   // index
      lm[12].y < lm[10].y + 0.02,   // middle
      lm[16].y < lm[14].y + 0.02,   // ring
      lm[20].y < lm[18].y + 0.02,   // pinky
    ].filter(Boolean).length;

    const thumbOpen = lm[4].y < lm[1].y + 0.02;   // thumb tip above CMC
    return extended >= 3 && thumbOpen;
  }

  _isThumbsUp(lm) {
    // Thumb tip must be above its own MCP (genuinely pointing up).
    const thumbExtended = lm[4].y < lm[2].y;

    // Thumb tip above at least 3 of the 4 finger knuckles — robust to hand tilt.
    // A tilted hand may drop one knuckle to the same level as the thumb tip,
    // so >=3/4 is more reliable than requiring all four.
    const aboveMCPs = [
      lm[4].y < lm[5].y,    // index MCP
      lm[4].y < lm[9].y,    // middle MCP
      lm[4].y < lm[13].y,   // ring MCP
      lm[4].y < lm[17].y,   // pinky MCP
    ].filter(Boolean).length >= 3;

    // Other fingers not far above their MCP. 0.08 tolerance covers the palm→fist
    // transition where fingers are only halfway curled.
    const curled = [
      lm[8].y  > lm[5].y  - 0.08,
      lm[12].y > lm[9].y  - 0.08,
      lm[16].y > lm[13].y - 0.08,
      lm[20].y > lm[17].y - 0.08,
    ].filter(Boolean).length;

    if (this._dbgFrame % 20 === 0) {
      console.debug(
        `[Thumbs-up] ext=${thumbExtended} aboveMCPs=${aboveMCPs} curled=${curled}/4 | ` +
        `tip.y=${lm[4].y.toFixed(3)}  mcp2=${lm[2].y.toFixed(3)} ` +
        `mcp5=${lm[5].y.toFixed(3)} mcp9=${lm[9].y.toFixed(3)} ` +
        `mcp13=${lm[13].y.toFixed(3)} mcp17=${lm[17].y.toFixed(3)}`
      );
    }
    this._dbgFrame++;

    return thumbExtended && aboveMCPs && curled >= 3;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  _pickBestHand(allHands) {
    let best = null;
    let bestArea = -1;
    for (const lm of allHands) {
      const area = this._boundingArea(lm);
      if (area >= CONFIG.minHandAreaFraction && area > bestArea) {
        bestArea = area;
        best = lm;
      }
    }
    return best;
  }

  _boundingArea(lm) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return (maxX - minX) * (maxY - minY);
  }

  _wrist(lm) {
    return { x: lm[0].x, y: lm[0].y };
  }

  _driftPx(a, b) {
    const cw = this._canvas.width  || 1280;
    const ch = this._canvas.height || 720;
    const dx = (a.x - b.x) * cw;
    const dy = (a.y - b.y) * ch;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _inZone(lm) {
    const p = this._wrist(lm);
    return p.x >= CONFIG.detectionZoneXMin && p.x <= CONFIG.detectionZoneXMax &&
           p.y >= CONFIG.detectionZoneYMin && p.y <= CONFIG.detectionZoneYMax;
  }

  _setState(s) {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    console.log(`[Gesture] ${prev} → ${s}`);
    this._emit('statechange', { state: s, prev });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
