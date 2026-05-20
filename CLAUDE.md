# CLAUDE.md — CacOOn Cabin: Gesture Hailing Prototype

> Single source of truth for Claude Code. Read this before every session.
> Detailed specs live in `docs/`. Build files live in `src/`. Skills live in `skills/`.

---

## Project

**CacOOn Cabin** — a robotaxi interior UX/HMI design project (Group 6).
This module: a browser-based hand gesture hailing demo for a live presentation.

**Figma Presentation:** `figma.com/slides/4W5Wx2CsC9QYkdsNNu1m3y` — slide row 3 ("71:50") is the main scenario deck. Key slides: "1.1 Intention Detection & Confirm Your Request" (seq diagram), Edge Cases (x3), Prototype section. The **Cocoon Pod exterior concept** (node `13:5002`) is the visual reference for the `assets/taxi.svg` redesign — Zoox-derived white pearl pod with wraparound dark warm-tint greenhouse glass.

**Design language:** Dark backgrounds with cyan/violet ambient depth, Inter + JetBrains Mono typography, OLED-glass HMI panels with cyan/orange accents, warm amber interior light contrast. Match the Figma aesthetic in the demo UI.

---

## Current Status — as of Session 5

**The prototype is complete, visually polished to presentation-grade, and user-validated in the browser.**
Sessions 1–3 built and stabilised the gesture stack. Session 4 added the skills folder. **Session 5 was a full visual fidelity pass** — robotaxi SVG redesigned as a Zoox-style pearl pod matching the Cocoon Pod concept slide, HMI panels rebuilt with Inter + JetBrains Mono and OLED-glass treatment, arrival overlay upgraded with animated road grid + ambient orbs + ETA pill, audio synthesized in-browser via Web Audio API.

The focus is now demo-room lighting validation and presentation logistics (deployment + slide handoff).

### What is working
- Full gesture state machine: IDLE → DETECTING → PROMPTING → CONFIRMING → CONFIRMED
- Open palm detection triggers 2-second countdown ring
- Thumbs-up confirmation triggers taxi arrival animation
- **Pearl-white Zoox-style pod taxi** (`640×340` viewBox SVG) matching the Cocoon Pod concept slide
- **Sliding doors** (`translateX`, Zoox-style) — not the previous rotateY swing
- Warm amber interior reveal after doors slide open
- 3-layer ground glow (cyan base / warm amber catch / specular highlight)
- **Animated perspective road grid** pulling toward viewer, 3 drifting ambient orbs (cyan/violet/orange), horizon fog
- Branded arrival message + new **ETA pill** ("Arriving · 0 min" in JetBrains Mono with pulsing dot)
- **Radar-ping status dot** + top-right CacOOn brand badge (auto-hides during PROMPTING)
- **Web Audio synthesis** for chime + ambient hum — no MP3 files shipped
- Inter + JetBrains Mono typography, OLED-glass HMI panels (28px blur, inset highlight)
- ArrowRight dispatch on CONFIRMED (note: cross-tab inert — see Demo Safety Net section)
- Space bar fallback for demo safety
- Hand skeleton overlay on camera feed (blue connectors, orange landmarks)
- Cancelled state with auto-reset after 1.8s

### What still needs to be done
1. **Demo-room lighting validation** — Session 5 was tested in a dim room and had detection trouble. The actual demo room is expected to be better-lit. If detection still misses, see the lighting-specific tuning notes in the Threshold Tuning Guide.
2. **Deploy to GitHub Pages** — see [DEPLOY.md](DEPLOY.md) for the step-by-step. Groupmates open a URL; no ZIP/local-server gymnastics.
3. **Add a launcher slide to the Figma deck** — a single button in the Prototype section linking to the deployed URL. Presenter clicks → demo opens in new tab → presenter clicks back to Figma after the gesture confirms (manual handoff — see Demo Safety Net).
4. **End-to-end rehearsal** — 5 back-to-back runs of IDLE → CONFIRMED in the actual demo room, with the manual click-back to Figma timed in.
5. **Test the Space fallback** — confirm it still fires the full animation even with no camera permission.

---

## Gesture Flow (strict)

```
IDLE       → open palm raised (stable 2s)   → DETECTING
DETECTING  → prompt: "show thumbs-up"       → PROMPTING  (8s timeout → CANCELLED → IDLE)
PROMPTING  → thumbs-up detected             → CONFIRMING
CONFIRMING → thumbs-up held 2s             → CONFIRMED
CONFIRMED  → taxi arrival animation plays  → ArrowRight fires → reset to IDLE
ANY STATE  → hand dropped / leaves zone    → IDLE
```

Source: Figma slide "1.1 Intention Detection" — "hold your hands for 2 seconds" then "Follow me".

---

## Stack

```
MediaPipe Hands (CDN)  — gesture detection (@mediapipe/hands@0.4.1675469240)
WebRTC getUserMedia    — laptop webcam (via @mediapipe/camera_utils@0.3.1675466862)
HTML/CSS/JS            — static files, no build step
Google Fonts (CDN)     — Inter + JetBrains Mono
Web Audio API          — chime + ambient hum synthesized in-browser (no MP3s)
CSS animations         — taxi slide-in, sliding doors, ground glow, road grid, orbs
KeyboardEvent          — ArrowRight dispatched on CONFIRMED (in-tab only; see Demo flow)
```

Config: all thresholds in `src/config.js`. **Never hardcode values in logic files.**

Hosting: GitHub Pages (HTTPS — required by `getUserMedia`). See [DEPLOY.md](DEPLOY.md).

---

## File Structure

```
robotaxi-gesture-demo/
├── CLAUDE.md
├── DEPLOY.md           ← GitHub Pages deploy instructions + group-share URL
├── index.html          ← entry point (entire runnable demo)
├── src/
│   ├── config.js       ← all tunable thresholds
│   ├── audio.js        ← Web Audio API synthesis (chime + ambient hum)
│   ├── gesture.js      ← state machine + MediaPipe + classifiers
│   ├── ui.js           ← overlay panels, countdown rings, timer bar
│   ├── animation.js    ← taxi arrival sequence (doors, glow, message, audio hooks)
│   └── bridge.js       ← ArrowRight dispatch + Space fallback
├── assets/
│   └── taxi.svg        ← Zoox-style pearl pod SVG (640×340 viewBox)
└── docs/
    ├── gesture-spec.md
    ├── edge-cases.md
    └── demo-script.md
```

---

## Current Thresholds (config.js — actual live values)

| Parameter | Current value | What it controls | Tuning direction |
|-----------|--------------|-----------------|-----------------|
| `minDetectionConfidence` | 0.80 | MediaPipe hand detection threshold | Lower (→0.70) if misses in dim light |
| `minTrackingConfidence` | 0.60 | MediaPipe tracking stability | Lower (→0.50) if skeleton flickers |
| `maxNumHands` | 4 | Max hands detected simultaneously | Leave at 4 |
| `gestureHoldMs` | 2000 | Hold time for palm AND thumbs-up | Lower (→1500) if demo feels sluggish |
| `confirmationTimeoutMs` | 8000 | PROMPTING window before CANCELLED | Raise if presenter needs more time |
| `minHandAreaFraction` | 0.03 | Minimum hand size (proximity filter) | Raise (→0.05) to force closer approach |
| `maxCentroidDriftPx` | 120 | Extreme-movement guard only (not timer) | Leave — timer no longer resets on drift |
| `detectionZoneYMax` | 0.80 | Bottom edge of detection zone | Lower if accidental floor triggers |
| `taxiArrivalDurationMs` | 3200 | Total taxi animation duration | Leave |
| `cancelledDisplayMs` | 1800 | Time "cancelled" shows before reset | Leave |

---

## Gesture Classifier Details (gesture.js)

### `_isOpenPalm(lm)`
1. **Guard first:** if thumb is pointing up (`lm[4].y < lm[2].y && lm[4].y < lm[5].y`) AND ≥3 fingers are curled — it's a thumbs-up, return `false`. This prevents thumbs-up triggering palm detection.
2. **PIP check:** ≥3/4 finger tips above their PIP joints (+0.02 tolerance for angled hands).
3. **Thumb check:** thumb tip above CMC (+0.02 tolerance).

### `_isThumbsUp(lm)`
1. `thumbExtended`: tip above thumb MCP (`lm[4].y < lm[2].y`).
2. `aboveMCPs`: tip above ≥3/4 finger MCPs (index/middle/ring/pinky). Requires only 3/4 to tolerate hand tilt.
3. `curled`: ≥3/4 finger tips not far above their MCP (`> MCP.y - 0.08`). The 0.08 tolerance handles the palm→fist transition.

### CONFIRMING hysteresis
5 consecutive frames of missed thumbs-up are allowed before reverting to PROMPTING. This prevents brief MediaPipe tracking glitches from resetting the 2-second confirmation countdown.

### Debug output (browser console, every 20 frames)
```
[Thumbs-up] ext=true aboveMCPs=true curled=3/4 | tip.y=0.381  mcp2=0.520 mcp5=0.622 mcp9=0.641 mcp13=0.630 mcp17=0.615
```
- `ext=false` → thumb isn't pointing up at all — hand angle issue
- `aboveMCPs=false` → thumb is up but hand is tilted — slight hand straightening needed
- `curled=1/4` → fingers aren't curling — user needs to make a proper fist first

---

## Animation Sequence (animation.js)

| Phase | Timing | What happens |
|-------|--------|-------------|
| 1 | 0 ms | Taxi glides in from right (1.1s CSS transition); `audio.playChime()` + `audio.startAmbient()` fire |
| 1b | 1088 ms (34%) | 3-layer ground glow (cyan / warm / specular) fades in beneath taxi |
| 2 | 1216 ms (38%) | Left door **slides left** (`translateX(-92%) rotateY(-10deg)`, 0.20s delay) |
| 3 | 1344 ms (42%) | Right door **slides right** (`translateX(92%) rotateY(10deg)`, 0.45s delay) |
| 4 | 1856 ms (58%) | Warm amber interior glow + branded message + ETA pill appear |
| 5 | 3200 ms (100%) | `onComplete` fires → ArrowRight dispatched (cross-tab inert) |
| on `hide()` | — | `audio.stopAmbient()` fades the bed out over 0.5s |

Door panels are HTML divs absolutely positioned over the SVG (`640×340` viewBox):
- `#door-left`: `left: 25%`, `width: 25%`, `top: 19%`, `height: 65%`, hinged right, slides to `translateX(-92%)`
- `#door-right`: `left: 50%`, `width: 25%`, `top: 19%`, `height: 65%`, hinged left, slides to `translateX(+92%)`
- `#car-interior`: `left: 25%`, `width: 50%`, `top: 19%`, `height: 65%` — layered amber gradient (overhead light + spot light), revealed when doors slide outward
- Door panel background is itself a layered gradient: dark warm-tint glass on top half, pearl body white on bottom half — matches the SVG it covers
- Small cyan door-status LED (`.door-led`) on `#door-left`, visible while closed

### Audio (`src/audio.js` — `CabinAudio` class)

Pure Web Audio API synthesis — no asset files. Lazy AudioContext, unlocks on first user gesture (keydown/click/pointerdown) via a one-shot handler in the init script.

- `playChime()` — 3 sine partials (880 Hz fundamental + 1320 Hz fifth + 1760 Hz octave shimmer) with a quick 25ms attack and 1.4s exponential decay, plus a 60ms low-passed noise transient for texture.
- `startAmbient()` — low triangle at 64 Hz + sine at 96 Hz, run through a lowpass at 380 Hz, with a 0.18 Hz LFO breathing the output gain. Sub-bass EV-presence bed.
- `stopAmbient()` — fades out over 0.5s; called from `TaxiAnimation.hide()`.

First-load gesture path may be silent (no user interaction yet). The Space-bar path always satisfies the autoplay policy. Subsequent runs always play.

---

## Design tokens & typography

Defined in `:root` in `index.html`:

```
--font-sans:   'Inter', 'Segoe UI', system-ui, sans-serif
--font-mono:   'JetBrains Mono', 'Consolas', monospace
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1)
--panel-bg:    rgba(8, 16, 36, 0.58)      ← OLED glass
--panel-edge:  rgba(255, 255, 255, 0.06)   ← inner highlight
--border:      rgba(79, 195, 247, 0.24)
--accent:      #4fc3f7  /* cyan */
--accent-soft: rgba(79, 195, 247, 0.55)
--orange:      #ff7e00
--orange-soft: rgba(255, 126, 0, 0.55)
--text:        #f0f5ff
--dim:         #7aadcc
```

**Mono is used for:** status dot label, prompt-timer seconds badge, ring percentages, ETA pill text. Everything else is Inter. The presence of mono in those specific spots is what reads as "real product HMI" vs "generic web demo".

---

## Threshold Tuning Guide (for demo room)

Open the browser console. Watch the `[Thumbs-up]` debug lines and `[Gesture]` state transitions.

**If palm detection is too sensitive (triggers while doing thumbs-up):**
→ Already fixed with the exclusion guard. Should not happen. If it does, raise `minDetectionConfidence` to 0.85.

**If palm detection is missing (hand clearly raised but DETECTING never fires):**
→ Lower `minDetectionConfidence` to 0.70. Check `minHandAreaFraction` — if the hand looks small on camera, lower it to 0.02.

**If thumbs-up isn't registering:**
→ Check console: if `aboveMCPs=false`, the hand is tilted — presenter should point thumb more directly upward. If `curled=0/4`, tell the presenter to close their fist more tightly before raising the thumb.

**If the flow feels too slow for a live demo:**
→ Lower `gestureHoldMs` from 2000 to 1500. Both palm hold and thumbs-up hold will be faster.

**If detection triggers from audience movement:**
→ Raise `minHandAreaFraction` from 0.03 to 0.06 (forces presenter to hold hand closer to camera).

**If the room is dim (low ambient light — projector-only, blinds drawn, etc.):**
→ Lower `minDetectionConfidence` to 0.70 and `minTrackingConfidence` to 0.50. This was the case during the session 5 dark-room test — palm detection became reliable again after both drops. The actual demo room is expected to be brighter; only apply this if you confirm the same issue on-site.

---

## Demo flow on presentation day

**The demo and Figma Slides are independent browser tabs / windows. They are not wired together.** The ArrowRight dispatch in `bridge.js` fires inside the demo's own tab and does not cross over to Figma. This is by design — see Key Design Decisions.

Live demo flow:
1. Presenter is on the launcher slide in the Figma deck (the slide with the "Open live demo →" button linking to the GitHub Pages URL).
2. Presenter clicks the button → the demo opens in a new browser tab and the camera permission prompt fires (allow it once, then it sticks).
3. Presenter walks through the gesture in front of the laptop's webcam → palm hold → thumbs-up → CONFIRMED → taxi arrival animation plays.
4. Presenter clicks back to the Figma tab and presses the Right arrow themselves to advance the slide. Total handoff latency: ~1 second.
5. If gesture detection misses, press **`Space`** in the demo tab as a manual trigger — fires the full taxi animation identically.

Always test in the actual demo room lighting before the presentation. See the Threshold Tuning Guide for what to adjust if detection is unreliable.

## Sharing with groupmates

Deploy once to GitHub Pages (see [DEPLOY.md](DEPLOY.md)) and share the URL. Groupmates open the URL in any modern browser, allow camera access, and the demo runs identically to your laptop. No ZIP, no local server, no install.

---

## Skills

These skills are registered in the Claude desktop app and available across projects. Their full instructions live in `skills/`. Reference them when the task matches.

| Skill | File | When to use |
|-------|------|-------------|
| `canvas-design` | [skills/canvas-design.md](skills/canvas-design.md) | Creating posters, visual art, .png/.pdf design artifacts |
| `theme-factory` | [skills/theme-factory.md](skills/theme-factory.md) | Applying a color/font theme to slides, docs, HTML pages |
| `web-artifacts-builder` | [skills/web-artifacts-builder.md](skills/web-artifacts-builder.md) | Building complex React/Tailwind/shadcn claude.ai HTML artifacts |

---

## Key Design Decisions (do not change without good reason)

- **Timer resets only on gesture loss, not hand movement** — natural walking-level motion no longer penalises the hold countdown. `maxCentroidDriftPx` exists only as an extreme-movement emergency guard and is effectively unused.
- **Mutual exclusion between palm and thumbs-up** — `_isOpenPalm` explicitly rejects the thumbs-up shape before running its own checks. This prevents the fist+thumb from double-triggering during transition.
- **CONFIRMING hysteresis** — 5-frame drop tolerance means brief tracking glitches don't stutter the confirmation ring. The `_holdStart` timestamp is preserved so the 2s countdown continues correctly through brief gaps.
- **Door panels are HTML divs, not SVG elements** — the taxi is rendered via `<img src="assets/taxi.svg">`, which makes internal SVG paths inaccessible to CSS. Div panels are absolutely positioned over the SVG at percentages derived from the `640×340` viewBox.
- **Doors slide, they don't swing** (session 5) — `translateX(±92%) rotateY(±10deg)` matches the Zoox-style sliding doors of the Cocoon Pod concept. The earlier `rotateY(±82deg)` swing was a sedan convention that no longer fits the pod silhouette.
- **Taxi body is pearl-white, not navy** (session 5) — the Cocoon Pod concept slide (`13:5002`) shows a white-pearl autonomous pod, not a dark-bodied vehicle. The SVG gradients (`#fdfefe → #c9ced5` body, dark warm-tint glass) reflect this. Earlier sessions used navy — don't revert.
- **Audio is synthesized, not sampled** (session 5) — `src/audio.js` uses Web Audio API oscillators + filters. No MP3 files to ship, no licensing concerns, no first-paint latency from asset loading. Tuneable in code if the sound needs to change.
- **ArrowRight dispatch is cross-tab inert** — `bridge.js` fires a synthetic `keydown` on `document`/`window`, but synthetic keyboard events do not propagate to other browser tabs. The dispatch is retained because it's harmless and supports a future iframe-embed path; on presentation day the presenter manually focuses Figma and presses Right arrow themselves (see Demo flow on presentation day).
