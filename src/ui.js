// UIController — per-hand AR overlays anchored to wrist coordinates, plus the
// pickup-card that shows the cropped winner alongside the taxi-arrival animation.
//
// Wrist coordinates from the detector are in the unmirrored source-video frame
// (normalized 0..1). The camera canvas is drawn mirrored (selfie view), so we
// flip X here: screenX = (1 - wrist.x) * window.innerWidth.

class UIController {
  constructor() {
    this._panels = {
      IDLE:      document.getElementById('panel-idle'),
      CANCELLED: document.getElementById('panel-cancelled'),
    };

    this._overlayRoot   = document.getElementById('hand-overlays');
    this._template      = document.getElementById('hand-overlay-template');
    this._pickupCard    = document.getElementById('pickup-card');
    this._pickupCanvas  = document.getElementById('pickup-snapshot');
    this._pickupId      = document.getElementById('pickup-id');

    this._overlays = new Map();   // id → { root, ringFill, pct, idTag }
    this._RING_CIRCUM = 2 * Math.PI * 45;

    if (this._panels.IDLE) this._panels.IDLE.classList.add('active');
  }

  // Toggle the IDLE "raise your hand" hint based on how many hands are tracked.
  setTrackCount(count) {
    if (this._panels.IDLE) this._panels.IDLE.classList.toggle('active', count === 0);
  }

  // Create / update / remove a single hand overlay based on its current state.
  // `hint` is an optional per-frame cue from the detector — currently 'repalm',
  // emitted when a DETECTING hand broke the palm early and the count restarted.
  upsertHand(id, state, value, wrist, hint) {
    const isActive = state === 'DETECTING' || state === 'PROMPTING' || state === 'CONFIRMING';
    if (!isActive) {
      this.removeHand(id);
      return;
    }

    let entry = this._overlays.get(id);
    if (!entry) {
      entry = this._createOverlay(id);
      this._overlays.set(id, entry);
    }

    if (wrist) this._positionOverlay(entry, wrist);

    entry.root.classList.remove('is-detecting', 'is-prompting', 'is-confirming');
    entry.root.classList.add(`is-${state.toLowerCase()}`);

    // Early palm-break in DETECTING → swap the prompt to "hold palm up" and zero
    // the ring, so the user knows the 2 s count restarted.
    const needsPalm = hint === 'repalm';
    entry.root.classList.toggle('needs-palm', needsPalm);
    if (needsPalm) value = 0;

    // PROMPTING progress is 0→1 as the window depletes — render as a shrinking ring.
    const ringVal = state === 'PROMPTING' ? 1 - value : value;
    if (entry.ringFill) {
      entry.ringFill.style.strokeDashoffset = this._RING_CIRCUM * (1 - ringVal);
    }
    if (entry.pct) {
      entry.pct.textContent = `${Math.round(ringVal * 100)}%`;
    }
  }

  removeHand(id) {
    const entry = this._overlays.get(id);
    if (!entry) return;
    this._overlays.delete(id);
    entry.root.classList.add('fade-out');
    setTimeout(() => entry.root.remove(), 260);
  }

  clearHands() {
    for (const id of [...this._overlays.keys()]) this.removeHand(id);
  }

  // Show the pickup card with the cropped snapshot of the winning user.
  // If snapshotCanvas is null (pose found no face match for the winning hand),
  // render a "?" placeholder so the UI is honest about uncertainty rather than
  // showing a stale or wrong crop.
  showPickup(idHex, snapshotCanvas) {
    if (!this._pickupCard) return;
    if (this._pickupCanvas) {
      const ctx = this._pickupCanvas.getContext('2d');
      const w = this._pickupCanvas.width;
      const h = this._pickupCanvas.height;
      ctx.clearRect(0, 0, w, h);
      if (snapshotCanvas) {
        ctx.drawImage(snapshotCanvas, 0, 0, w, h);
      } else {
        this._drawPickupPlaceholder(ctx, w, h);
      }
    }
    if (this._pickupId) this._pickupId.textContent = `ID ${idHex}`;
    this._pickupCard.classList.add('visible');
  }

  _drawPickupPlaceholder(ctx, w, h) {
    ctx.fillStyle = '#15161a';   // matte grey-black to match the theme
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(197, 169, 97, 0.55)';   // soft gold
    ctx.font = '700 ' + Math.round(h * 0.55) + 'px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2);
    ctx.font = '500 ' + Math.round(h * 0.07) + 'px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(154, 154, 159, 0.85)';   // dim grey
    ctx.fillText('FACE NOT MATCHED', w / 2, h * 0.88);
  }

  hidePickup() {
    if (this._pickupCard) this._pickupCard.classList.remove('visible');
  }

  showWarning(type) {
    const warnMap = {
      camera_denied:         'warn-camera',
      camera_error:          'warn-camera',
      mediapipe_unavailable: 'warn-mediapipe',
    };
    const id = warnMap[type];
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  _createOverlay(id) {
    const node = this._template.content.firstElementChild.cloneNode(true);
    this._overlayRoot.appendChild(node);
    const idHex = id.toString(16).padStart(4, '0').toUpperCase();
    const idTag = node.querySelector('.hand-id-tag');
    if (idTag) idTag.textContent = `ID ${idHex}`;
    return {
      root:     node,
      ringFill: node.querySelector('.hand-ring-fill'),
      pct:      node.querySelector('.hand-pct'),
      idTag,
    };
  }

  _positionOverlay(entry, wrist) {
    const x = (1 - wrist.x) * window.innerWidth;
    const y = wrist.y * window.innerHeight;
    entry.root.style.left = `${x}px`;
    entry.root.style.top  = `${y}px`;
  }
}
