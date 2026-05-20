# Improvements and Additions — Backlog

Future work for the CacOOn Cabin gesture demo, grouped by category. Each item names the file or system it would touch so the work is grounded. Nothing here is required for the demo as it stands today — these are directions, not debt.

---

## Robustness / edge cases

These are the failure modes most likely to bite during a real demo or when audience phones scan the QR.

- **Low ambient light** — Already partially mitigated via the threshold tuning notes in [docs/tuning.md](docs/tuning.md), but still the single most likely failure on demo day. Best long-term answer is the auto-tuning agent (see below). Short-term: a "low-light" preset that lowers `minDetectionConfidence` and `minTrackingConfidence` in one click via a `?preset=lowlight` query param.

- **Bright back-lighting / silhouetted hands** — Opposite failure mode. MediaPipe under-detects when the hand is darker than its background (window behind presenter, harsh ceiling lights). Worth probing camera-frame mean luminance once on startup and warning the user if the scene is high-contrast.

- **Gloves** — Latex, cotton, woollen. MediaPipe is trained on bare hands; gloved hands break the landmark predictions. A dedicated demo-room outfit shouldn't include gloves, but for industrial or cold settings consider a fallback gesture tracking a coloured marker the camera can pick out (e.g., a bright dot on a finger).

- **Long sleeves covering the wrist** — The wrist is one of MediaPipe's 21 landmarks. Tolerable degradation but easy to flag in user-facing instructions ("roll your sleeve back before raising your hand").

- **Skin-tone diversity** — MediaPipe is reasonably balanced but worth re-validating across group members and any audience volunteers before the talk. Document any tuning needed.

- **Hand-like objects in frame** — Toy hands, anatomy posters, photos on walls. Solve by raising [src/config.js](src/config.js)`#minHandAreaFraction` so detection only fires when the hand fills enough of the frame. A more thorough fix would use the depth dimension (hand size ≈ proxy for distance) to filter background false positives.

- **Left vs right hand** — Currently the classifiers in [src/gesture.js](src/gesture.js) are handedness-agnostic. Confirm by testing both during rehearsal.

- **Phone front-camera variance** (audience QR scans) — Wide range of fields-of-view and resolutions across iPhones, Pixels, Samsung devices. Worth a 5-minute test on 2-3 representative phones before the talk.

- **Battery-saver throttling on mobile** — Safari and Chrome on iOS aggressively throttle JavaScript when battery is low. The taxi animation may stutter. A perf-degrade mode could drop the road-grid and ambient orbs on low-power devices (`window.matchMedia('(prefers-reduced-motion)')` or a battery check).

- **Safari iOS quirks** — `getUserMedia` and `AudioContext` autoplay policies are flakier than Chrome's. The Web Audio bed may be silent on first iOS visit until a user tap satisfies the autoplay policy.

- **MediaPipe CDN blocked on corporate Wi-Fi** — The demo crashes silently if `cdn.jsdelivr.net` is firewalled. The `#warn-mediapipe` overlay (added in session 6) now surfaces this with the Space-bar fallback. A more robust fix: self-host the MediaPipe bundle in `vendor/` to remove the CDN dependency entirely.

---

## UX / presentation polish

- **"Returning to slides…" overlay** during the brief gap between animation end and `window.location.replace`. Currently the tab content just flips; a 400 ms text fade would feel intentional.

- **Audio level slider** for demo rooms with over-amplified PA systems. Mute toggle at a minimum.

- **"Last gesture: X" diagnostic** on the audience-QR view so phone users can see why a gesture didn't register (no hand detected, hand too small, wrong shape).

- **Multi-language strings** — The UI is currently English-only. Audience laptops and phones may be in other locales; consider an `?lang=` query param with a tiny string-table.

- **Recording mode** — A `?record=true` query that swaps the live camera for a pre-recorded gesture clip, useful for capturing a clean demo video without a presenter on hand.

- **Embedded iframe path** — The cross-tab handoff in [src/bridge.js](src/bridge.js) exists because the demo opens in a new tab. If Figma ever supports custom embeds with camera permission, a same-origin iframe inside a Figma slide would let the synthetic ArrowRight in `bridge.js` actually advance the deck (no `#next=` workaround needed). Keep the in-tab dispatch in `bridge.js` for this future.

---

## Auto-tuning agent — the big one

The user's headline ask. Build a small system that "learns the room" over time and over visitors, tuning the thresholds in [src/config.js](src/config.js) without a human in the loop. Every visit and every gesture attempt becomes signal; after N sessions, the demo is more reliable in *this specific deployment context* than any hand-tuned version could be.

### What it would observe (purely client-side telemetry — no biometrics or frames)

- Time from page-load to first DETECTING.
- Time from DETECTING → CONFIRMED.
- Number of CANCELLED states per session.
- Whether the user pressed Space (signal that gesture detection failed).
- Browser, OS, viewport, device-pixel-ratio.
- Ambient brightness estimate from a single early camera frame (mean luminance) — a privacy-safe summary number, never the frame itself.

### What it would adjust (with hard bounds, never silently misconfiguring)

- `minDetectionConfidence` — drop if first-DETECTING time is consistently high; raise if false positives are detected.
- `minTrackingConfidence` — similar logic.
- `gestureHoldMs` — shorten if visitors are abandoning at the hold phase.
- `minHandAreaFraction` — raise if accidental triggers from background motion are frequent.

### Architecture options (sketched, not built)

| Approach | Storage | Tuning logic | Privacy | Cost |
|---|---|---|---|---|
| **Pure client** | localStorage per device | Simple rules ("if avg detect-time > X, lower threshold by 0.05") | Trivial — nothing leaves the browser | Free, no backend |
| **Hybrid** | Anonymous event POSTs to a tiny FaaS endpoint; computed `baseline-config.json` served to all clients | Periodic batch job on the backend | Aggregate stats only; document in a privacy notice | Free-tier serverless |
| **ML** | Anonymous events to backend, periodic retrain of a small model that maps device-class → optimal config | Train pipeline + model artefact | Same as Hybrid | Real money + maintenance |

**Recommendation:** start with **Pure client**. Two days of work, no backend, no privacy review, and proves the concept. If pure-client tuning visibly improves reliability, graduate to Hybrid.

### Build path

1. Add a `src/telemetry.js` collector that logs gesture-event timings to localStorage with timestamps. Rolling buffer of the last 50 sessions.
2. Add a `src/tuner.js` that reads the buffer at startup and computes per-threshold overrides within hard bounds.
3. Have [src/config.js](src/config.js) consult `tuner.js` before exporting its values.
4. Add a `?reset-tuning` query for debugging — clears the buffer and reverts to defaults.
5. Add a `?show-tuning` query that dumps the current overrides to the page so you can see what the agent has done.

### Skills needed to build it (for future sessions)

- `skill-creator` — the user pasted the skill contents during the wrap-up session. Install when this becomes active work. Lets a future agent write more skills along the way.
- `agent-builder` — not yet sourced. The user offered to grant browse permission to fetch one when the time comes.

These are reach-for-when-needed tools, not blockers. The pure-client first cut can be built without either — it's just JS in `src/`.

---

## Code cleanup deferred from earlier sessions

- Remove the synthetic `ArrowRight` `KeyboardEvent` dispatch in [src/bridge.js](src/bridge.js)`#trigger()` — genuinely vestigial unless the iframe-embed path is taken. ~10 lines. Defer until the iframe path is explicitly ruled out.
- The `_fired` re-trigger guard in `bridge.js` — useful for audience-QR replay (so a phone visitor can run the gesture multiple times without page reload). Keep.
- Consider extracting CSS from [index.html](index.html) into `src/styles.css`. The inline `<style>` block is now ~700 lines; an external file would improve editability and let the file be cached separately. Not urgent.

---

## Nice-to-have visual polish

- Idle "scan" animation hint pulsing in the lower third — currently the only IDLE cue is the hand-pulse icon.
- Per-state ambient colour shift on the page background (cyan-tinted in IDLE, warm-tinted post-arrival).
- Subtle parallax on the ambient orbs tied to head/hand position (when a hand is detected).
- "Tap to start" splash on mobile to ensure `AudioContext` unlocks cleanly on iOS.
