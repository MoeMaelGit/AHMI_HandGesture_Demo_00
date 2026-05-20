// UIController — manages all HMI overlay panels, countdown rings, and warning screens.
// Receives state/progress data from GestureDetector events and updates the DOM.

class UIController {
  constructor() {
    // State panels
    this._panels = {
      IDLE:       document.getElementById('panel-idle'),
      DETECTING:  document.getElementById('panel-detecting'),
      PROMPTING:  document.getElementById('panel-prompting'),
      CONFIRMING: document.getElementById('panel-confirming'),
      CANCELLED:  document.getElementById('panel-cancelled'),
    };

    // Progress elements
    this._detectRing   = document.getElementById('detect-ring-fill');
    this._confirmRing  = document.getElementById('confirm-ring-fill');
    this._promptBar    = document.getElementById('prompt-bar-fill');
    this._promptSecs   = document.getElementById('prompt-secs');

    this._RING_CIRCUM = 2 * Math.PI * 45;  // r=45 → ~283

    this._current = 'IDLE';
    this._showPanel('IDLE');
  }

  // Called on every statechange event from GestureDetector.
  setState(newState) {
    this._current = newState;
    this._showPanel(newState);
  }

  // Called on 'progress' events (DETECTING — 0→1 as ring fills).
  setDetectProgress(value) {
    if (!this._detectRing) return;
    this._detectRing.style.strokeDashoffset = this._RING_CIRCUM * (1 - value);
  }

  // Called on 'promptProgress' events (PROMPTING — 0→1 as bar depletes).
  setPromptProgress(value) {
    if (!this._promptBar) return;
    this._promptBar.style.transform = `scaleX(${1 - value})`;
    if (this._promptSecs) {
      const remaining = Math.ceil(CONFIG.confirmationTimeoutMs * (1 - value) / 1000);
      this._promptSecs.textContent = `${remaining}s`;
    }
  }

  // Called on 'confirmProgress' events (CONFIRMING — 0→1 as ring fills).
  setConfirmProgress(value) {
    if (!this._confirmRing) return;
    this._confirmRing.style.strokeDashoffset = this._RING_CIRCUM * (1 - value);
  }

  showWarning(type) {
    const warnMap = {
      camera_denied:       'warn-camera',
      camera_error:        'warn-camera',
      mediapipe_unavailable: 'warn-mediapipe',
    };
    const id = warnMap[type];
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  _showPanel(state) {
    Object.values(this._panels).forEach(p => p && p.classList.remove('active'));
    const target = this._panels[state];
    if (target) {
      target.classList.add('active');
      // Reset ring on entry
      if (state === 'DETECTING' && this._detectRing) {
        this._detectRing.style.strokeDashoffset = this._RING_CIRCUM;
      }
      if (state === 'CONFIRMING' && this._confirmRing) {
        this._confirmRing.style.strokeDashoffset = this._RING_CIRCUM;
      }
      if (state === 'PROMPTING' && this._promptBar) {
        this._promptBar.style.transform = 'scaleX(1)';
      }
    }
  }
}
