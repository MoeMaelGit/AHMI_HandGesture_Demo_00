# CacOOn Cabin — Gesture Hailing Demo: Project Summary

A self-contained overview of what this repo is, what's been built, and where to look next. Read this once when picking the project back up cold.

## What this is

CacOOn Cabin is a Master's UX/HMI project (Group 6, AHMI module) — a concept robotaxi interior. This repository is the **gesture hailing demo** module: a browser-based prototype that lets someone raise an open palm and then a thumbs-up to "hail" a Zoox-style pearl-pod taxi that glides in with sliding doors, warm interior light, and an ETA pill. It's the live, on-stage portion of the Figma slide presentation.

The demo doubles as both presenter prop and audience interactive — see "Two modes" below.

## Live demo

**https://moemaelgit.github.io/AHMI_HandGesture_Demo_00/**

Gesture sequence (timings are tunable in [src/config.js](src/config.js)):

1. Raise an open palm — a 2-second countdown ring fills (DETECTING).
2. When prompted, show a thumbs-up — a second 2-second hold confirms (CONFIRMING → CONFIRMED).
3. The Zoox pearl pod slides in, doors slide open, an arrival message and "Arriving · 0 min" ETA pill fade in.
4. Animation completes (~3.2 s total). What happens next depends on which mode you opened the demo in.

## Two modes

The same deployed URL serves two audiences. They differ only by URL hash:

### Presenter mode — `…/#next=<figma-next-slide-url>`

Used by the Figma launcher button on the main deck. After the animation ends, `bridge.js` reads the `#next=` fragment and calls `window.location.replace(...)` so the demo tab navigates to that Figma slide in present mode. If the navigation is blocked for any reason, a 400 ms `window.close()` fallback fires so focus returns to the original Figma tab.

Space-bar fires the full animation manually — the redirect still happens after.

### Audience mode — `…/` (no hash)

Used by `assets/qr-audience.png`. The QR encodes the bare deployed URL. After the animation ends, the demo resets to IDLE for another try. Never redirects anyone — phone audiences can't end up in the presenter's Figma deck by accident.

## Architecture

```
Webcam ─▶ MediaPipe Hands ─▶ gesture.js (state machine + classifiers)
                                  │
                                  ▼
                            ui.js (panels + rings + timer)
                                  │
                                  ▼
                       animation.js (taxi + doors + glow)
                                  │
                                  ▼
                          audio.js (Web Audio synthesis)
                                  │
                                  ▼
                         bridge.js (ArrowRight + #next= redirect)
```

Static HTML/CSS/JS, no build step. MediaPipe loaded from a CDN. Hosting is GitHub Pages (HTTPS required for `getUserMedia`).

## File-by-file

| File | Responsibility |
|------|----------------|
| [index.html](index.html) | Entry point. Markup, all CSS, init bootstrap, warning overlays. Camera-denied pre-flight check lives here. |
| [src/config.js](src/config.js) | Every tunable threshold. No magic numbers in logic files. |
| [src/gesture.js](src/gesture.js) | MediaPipe wrapper, state machine, `_isOpenPalm` / `_isThumbsUp` classifiers with mutual exclusion + 5-frame CONFIRMING hysteresis. |
| [src/ui.js](src/ui.js) | DOM state-panel switcher, progress rings, prompt timer bar, warning overlay activator. |
| [src/animation.js](src/animation.js) | Taxi-arrival sequence — slide-in, door-slide, interior glow, message, ETA pill. Hooks audio start/stop. |
| [src/audio.js](src/audio.js) | Web Audio API synthesis — chime and ambient hum. No MP3 files. |
| [src/bridge.js](src/bridge.js) | ArrowRight synthetic dispatch + `#next=` hash redirect + Space fallback + `window.close()` belt-and-braces. |
| [assets/taxi.svg](assets/taxi.svg) | Zoox-style pearl pod, 640×340 viewBox. |
| [assets/qr-audience.png](assets/qr-audience.png) | 600×600 QR pointing at the bare deployed URL. Drop into slides. |

## Sessions timeline

1. **Foundation** — gesture state machine + MediaPipe wiring + state panels.
2. **Stabilisation** — classifier guards (palm vs thumbs-up mutual exclusion), CONFIRMING hysteresis, dim-light threshold tuning, Space fallback.
3. **Polish** — UI rings, prompt timer bar, status dot, brand badge.
4. **Skills + structure** — `skills/` folder, repo trimmed to runtime essentials, README added.
5. **Visual fidelity** — Zoox pearl-pod redesign, sliding doors (not swinging), animated road grid + ambient orbs, ETA pill, Web Audio synthesis replacing sampled chime.
6. **(this branch — `feature/figma-handoff-and-qr`)** Figma return-link via `#next=` hash + `window.close()` fallback, audience QR generated, camera-denied / MediaPipe-unavailable overlays wired into the init failure paths, GitHub Pages repointed at this feature branch (master stays as rollback), CLAUDE.md slimmed from 271 → 189 lines with `docs/animation.md` + `docs/tuning.md` extractions.

## Where to read next

- [CLAUDE.md](CLAUDE.md) — Claude Code's always-loaded project context. Read on every session start.
- [DEPLOY.md](DEPLOY.md) — GitHub Pages deploy recipe + Figma launcher-button URL recipe.
- [docs/animation.md](docs/animation.md) — Taxi-arrival timing table, door layout maths, audio-synthesis details.
- [docs/tuning.md](docs/tuning.md) — Threshold tuning decision tree for the demo room + live config table.
- [docs/gesture-spec.md](docs/gesture-spec.md), [docs/edge-cases.md](docs/edge-cases.md), [docs/demo-script.md](docs/demo-script.md) — Original specs.
- [improvements.md](improvements.md) — Backlog: edge cases (gloves, low light, etc.), UX polish, the auto-tuning-agent idea.

Note: `CLAUDE.md`, `DEPLOY.md`, and the entire `docs/` folder are `.gitignore`'d. They live alongside the project on your machine but never get pushed to GitHub.

## Quick start for further work

```bash
git clone https://github.com/MoeMaelGit/AHMI_HandGesture_Demo_00.git
cd AHMI_HandGesture_Demo_00
git checkout feature/figma-handoff-and-qr
python -m http.server 8765
```

Then open `http://127.0.0.1:8765/`. **Use `127.0.0.1` not `localhost`** — `127.0.0.1` is a secure origin in Chrome/Edge so `getUserMedia` will hand over the camera. Plain `localhost` works too in modern browsers but `127.0.0.1` is the safer bet.

Most useful first edits:

- [src/config.js](src/config.js) — tweak thresholds for your room.
- [src/gesture.js](src/gesture.js) — adjust classifier predicates or state transitions.
- [src/animation.js](src/animation.js) and [index.html](index.html) `:root` — visual style.

If you push changes to this branch, GitHub Pages rebuilds in ~30 seconds and the live URL updates. If you'd rather work on `master`, change the Pages source via `gh api repos/MoeMaelGit/AHMI_HandGesture_Demo_00/pages -X PUT -f source[branch]=master -f source[path]=/`.
