// Cabin audio — sourced CC0/CC-BY samples with a Web Audio synth FALLBACK.
//
// Discrete cues are short sample files (assets/audio/*.wav, see docs/audio-credits.md):
//   playChime() → arrival cue (taxi slides in)
//   playBoard() → boarding cue (rider taps → doors open)
// The ambient bed (startAmbient/stopAmbient) stays SYNTHESIZED — it loops
// seamlessly with no asset seams. If a sample hasn't loaded / can't decode
// (e.g. iOS Safari quirk, offline), the cue falls back to the synth chime, so
// audio never breaks.
//
// AudioContext is created lazily on first user gesture (Space/keypress) to satisfy
// browser autoplay policies. Gesture-driven plays may be silent on first load —
// acceptable per plan; the cue will fire on subsequent runs.

class CabinAudio {
  constructor() {
    this._ctx = null;
    this._ambientNodes = null;
    this._master = null;
    this._enabled = true;
    this._buffers = {};         // key → decoded AudioBuffer
    this._loadStarted = false;
    // ?v= keeps reloads fresh if a clip is ever swapped (matches the index.html scheme)
    this._samples = {
      arrival: 'assets/audio/arrival.wav?v=step4',
      board:   'assets/audio/board.wav?v=step4',
      ambient: 'assets/audio/ambient.wav?v=step4',
    };
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
    this._loadSamples();
    return this._ctx;
  }

  // Fetch + decode the cue samples once the context exists. Best-effort: any
  // failure just leaves the buffer absent and the cue falls back to synth.
  _loadSamples() {
    if (this._loadStarted || !this._ctx) return;
    this._loadStarted = true;
    for (const [key, url] of Object.entries(this._samples)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => this._ctx.decodeAudioData(ab))
        .then((buf) => { this._buffers[key] = buf; })
        .catch(() => {});
    }
  }

  // Play a decoded sample. Returns false if it isn't available (→ caller falls back).
  _playBuffer(key, gain) {
    const ctx = this._ctx;
    const buf = this._buffers[key];
    if (!ctx || !buf) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(g);
    g.connect(this._master);
    src.start(ctx.currentTime);
    return true;
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

  // ── Arrival cue ────────────────────────────────────────────────────────
  // Sourced soft welcoming tone (CC0/CC-BY). Falls back to the synth chime.
  playChime() {
    if (!this._enabled) return;
    if (!this._ensureCtx()) return;
    if (this._playBuffer('arrival', 0.85)) return;
    this._synthChime();
  }

  // ── Boarding cue ───────────────────────────────────────────────────────
  // Sourced warm resolved confirmation, played when the doors open on tap.
  playBoard() {
    if (!this._enabled) return;
    if (!this._ensureCtx()) return;
    if (this._playBuffer('board', 0.95)) return;
    this._synthChime();
  }

  // Synth fallback — two stacked sine partials with a soft attack and ~1.4s decay.
  _synthChime() {
    const ctx = this._ctx;
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

    // Prefer the sourced ambient loop; fall back to the synth bed if it hasn't
    // loaded / can't decode.
    if (this._buffers.ambient) { this._startSampleAmbient(ctx); return; }
    this._startSynthAmbient(ctx);
  }

  // Sourced ambient bed — seamless crossfade loop, gentle fade-in.
  _startSampleAmbient(ctx) {
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.30, t0 + 1.2);   // audible-but-low hum bed
    out.connect(this._master);

    const src = ctx.createBufferSource();
    src.buffer = this._buffers.ambient;
    src.loop = true;
    src.connect(out);
    src.start(t0);

    this._ambientNodes = { out, sample: src };
  }

  // Synth fallback ambient — low triangle hum + a fifth above + slow LFO breathe.
  _startSynthAmbient(ctx) {
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
      if (nodes.sample) nodes.sample.stop(t1 + 0.6);   // sourced loop
      if (nodes.osc1)   nodes.osc1.stop(t1 + 0.6);     // synth fallback
      if (nodes.osc2)   nodes.osc2.stop(t1 + 0.6);
      if (nodes.lfo)    nodes.lfo.stop(t1 + 0.6);
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
