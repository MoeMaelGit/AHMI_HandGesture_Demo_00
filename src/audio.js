// Web Audio API synthesis — no asset files needed.
// Two cues: arrival chime (2-tone bell on slide-in) and ambient hum (sub-bass bed).
//
// AudioContext is created lazily on first user gesture (Space/keypress) to satisfy
// browser autoplay policies. Gesture-driven plays may be silent on first load —
// acceptable per plan; the chime will fire on subsequent runs.

class CabinAudio {
  constructor() {
    this._ctx = null;
    this._ambientNodes = null;
    this._master = null;
    this._enabled = true;
  }

  _ensureCtx() {
    if (this._ctx) return this._ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._enabled = false; return null; }
      this._ctx = new AC();
      this._master = this._ctx.createGain();
      this._master.gain.value = 1.0;
      this._master.connect(this._ctx.destination);
    } catch (_) {
      this._enabled = false;
      return null;
    }
    return this._ctx;
  }

  // Unlock the audio context from a user gesture handler.
  // Call this from any keydown/click listener at startup so subsequent plays work.
  unlock() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  // ── Arrival chime ──────────────────────────────────────────────────────
  // Two stacked sine partials with a soft attack and 1.2s decay.
  // Reads as a clean, futuristic "ding" without being intrusive.
  playChime() {
    if (!this._enabled) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t0 = ctx.currentTime;
    const peakGain = 0.28;

    const partials = [
      { freq: 880,  detune: 0,  weight: 1.0  },  // fundamental
      { freq: 1320, detune: 0,  weight: 0.55 },  // 3:2 (perfect fifth above)
      { freq: 1760, detune: 4,  weight: 0.25 },  // octave shimmer
    ];

    partials.forEach(({ freq, detune, weight }) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;

      // Quick attack, exponential decay
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peakGain * weight, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);

      osc.connect(g);
      g.connect(this._master);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    });

    // Soft pluck noise at the very start — texture, not melody
    const noiseBuf = this._noiseBuffer(0.06);
    if (noiseBuf) {
      const src = ctx.createBufferSource();
      const ng  = ctx.createGain();
      const lp  = ctx.createBiquadFilter();
      src.buffer = noiseBuf;
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      ng.gain.setValueAtTime(0.12, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      src.connect(lp); lp.connect(ng); ng.connect(this._master);
      src.start(t0);
    }
  }

  // ── Ambient EV hum ─────────────────────────────────────────────────────
  // Low triangle wave + a fifth above + slow LFO on the master gain.
  // Plays during arrival, stopped on hide().
  startAmbient() {
    if (!this._enabled) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (this._ambientNodes) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.10, t0 + 0.8); // gentle fade-in
    out.connect(this._master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;
    lp.connect(out);

    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = 64;
    osc1.connect(lp);
    osc1.start(t0);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 96;
    const osc2g = ctx.createGain();
    osc2g.gain.value = 0.55;
    osc2.connect(osc2g); osc2g.connect(lp);
    osc2.start(t0);

    // Slow LFO on output gain — adds a breathing quality
    const lfo  = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 0.18;
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG); lfoG.connect(out.gain);
    lfo.start(t0);

    this._ambientNodes = { out, osc1, osc2, lfo };
  }

  stopAmbient() {
    const nodes = this._ambientNodes;
    if (!nodes || !this._ctx) return;
    const t1 = this._ctx.currentTime;
    try {
      nodes.out.gain.cancelScheduledValues(t1);
      nodes.out.gain.setValueAtTime(nodes.out.gain.value, t1);
      nodes.out.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.5);
      nodes.osc1.stop(t1 + 0.6);
      nodes.osc2.stop(t1 + 0.6);
      nodes.lfo.stop(t1 + 0.6);
    } catch (_) {}
    this._ambientNodes = null;
  }

  // Small white-noise buffer for the chime's transient
  _noiseBuffer(durationSec) {
    const ctx = this._ctx;
    if (!ctx) return null;
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    return buf;
  }
}
