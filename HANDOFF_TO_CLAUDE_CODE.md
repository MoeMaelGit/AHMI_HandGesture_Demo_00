# Handoff Note for Claude Code Session

Paste this into Claude Code to continue where we left off.

---

## What's done (from Claude.ai session)

- **Project understood:** CacOOn Cabin — robotaxi interior UX project, Group 6
- **Figma read:** Presentation at `figma.com/slides/4W5Wx2CsC9QYkdsNNu1m3y`
  - Design language: dark backgrounds, light-blue/white text, orange accents, gradient backgrounds
  - Relevant slides: "1.1 Intention Detection", Edge Cases (x3), Prototype section
- **Full spec defined:** Two-stage gesture flow (open palm → thumbs-up), 12 edge cases documented
- **CLAUDE.md written:** Concise, references `docs/` files
- **Supporting docs written:** `docs/gesture-spec.md`, `docs/edge-cases.md`, `docs/demo-script.md`

## What to build next (in Claude Code)

**Goal:** Single `index.html` with MediaPipe Hands — detects open palm → prompts thumbs-up → plays taxi arrival animation → fires ArrowRight keyboard event to advance Figma Slides.

**Start here:**
```
Task 1: Create src/config.js with all thresholds from CLAUDE.md
Task 2: Create src/gesture.js — MediaPipe Hands integration + 5-state machine
Task 3: Test detection logs in console before building UI
Task 4: src/ui.js — dark overlay UI matching CacOOn Cabin design language
Task 5: src/animation.js — taxi SVG glides in, doors open (~3s CSS animation)
Task 6: src/bridge.js — ArrowRight + Space fallback
Task 7: index.html — wire everything
Task 8: Tune thresholds on actual laptop camera
```

**Use Opus 4.7 for Tasks 2–3 (algorithm). Sonnet 4.6 for Tasks 4–7 (UI/wiring).**

## Key design decisions made
- Stack: Vanilla HTML/CSS/JS + MediaPipe CDN. Zero dependencies. Offline-capable.
- Paywall mechanic: gesture confirmed → `dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight'}))` → Figma Slides advances
- Demo uses laptop camera, indoor, ~1–1.5m distance
- All thresholds in `config.js`, never hardcoded

## Files to put in your project folder
- `CLAUDE.md` (root)
- `docs/gesture-spec.md`
- `docs/edge-cases.md`
- `docs/demo-script.md`

---
*Generated: May 2026 | Claude Sonnet 4.6*
