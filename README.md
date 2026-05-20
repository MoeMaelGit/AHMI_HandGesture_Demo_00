# CacOOn Cabin — Gesture Hailing Demo

A browser-based hand gesture hailing prototype for the **CacOOn Cabin** robotaxi interior UX/HMI project (Group 6, AHMI module).

Raise an open palm in front of your webcam, then a thumbs-up to confirm — a Zoox-style pearl pod taxi glides in, doors slide open, and an arrival message is presented through an OLED-glass HMI panel.

## Live demo

**https://moemaelgit.github.io/AHMI_HandGesture_Demo_00/**

Open in Chrome or Edge, allow camera access when prompted.

## How to use

1. Open the live demo URL above.
2. Allow camera access on first visit.
3. Raise an **open palm** in front of the webcam — a 2-second countdown ring fills.
4. Show a **thumbs-up** when prompted — a second 2-second hold confirms the request.
5. The taxi arrives with sliding doors, warm interior glow, and an ETA pill.

**Tips:**
- Press **F11** for fullscreen on demo day.
- Press **Space** as a manual fallback if gesture detection misses.

## Tech stack

- **MediaPipe Hands** (CDN) — hand landmark detection.
- **WebRTC getUserMedia** — laptop webcam capture.
- **Web Audio API** — chime + ambient hum synthesized in-browser (no audio files).
- **Vanilla HTML/CSS/JS** — no build step, no framework.
- **Google Fonts** — Inter + JetBrains Mono.

HTTPS is required because of `getUserMedia` — that's why the demo is hosted on GitHub Pages.

## Run locally

```bash
git clone https://github.com/MoeMaelGit/AHMI_HandGesture_Demo_00.git
cd AHMI_HandGesture_Demo_00
python -m http.server 8765
```

Then open `http://127.0.0.1:8765/` in Chrome or Edge. `127.0.0.1` (not `localhost`) is treated as a secure origin so the camera will work.

## File structure

```
.
├── index.html        # entire runnable demo (markup + styles + bootstrap)
├── src/
│   ├── config.js     # tunable thresholds
│   ├── audio.js      # Web Audio synthesis
│   ├── gesture.js    # MediaPipe + state machine
│   ├── ui.js         # overlay panels, rings, timers
│   ├── animation.js  # taxi arrival sequence
│   └── bridge.js     # keyboard fallback
└── assets/
    └── taxi.svg      # Zoox-style pearl pod
```

## Credits

Built for the AHMI Master's module — Group 6, *CacOOn Cabin*.
