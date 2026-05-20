# DEPLOY.md — Ship the demo to GitHub Pages

> Deploy once, share the URL with your group, never think about it again. Total time: ~5 minutes.

The demo is a static site (HTML + CSS + JS, no build step), so any static host works. GitHub Pages is the recommended path because it's free, HTTPS by default (required for the webcam), and Git-native if you ever want to update later.

---

## What you need

- A GitHub account.
- Either the `gh` CLI installed (`winget install --id GitHub.cli`) **or** comfort with the GitHub web UI.
- The terminal open at `c:\Masters\AHMI\robotaxi-gesture-demo`.

---

## Option A — `gh` CLI (recommended, 2 commands)

```powershell
cd c:\Masters\AHMI\robotaxi-gesture-demo

# Initialize git, commit everything as the starting point.
git init
git add .
git commit -m "CacOOn Cabin gesture demo - session 5"

# Create a public GitHub repo, push, and open it in the browser.
# Replace <repo-name> with whatever you want, e.g. cacoon-gesture-demo
gh repo create <repo-name> --public --source=. --push
```

Then enable Pages:

```powershell
# Turn on Pages, serving from main branch root.
gh api repos/{owner}/<repo-name>/pages -X POST -f source[branch]=main -f source[path]=/
```

After ~30 seconds, your URL is:
```
https://<your-github-username>.github.io/<repo-name>/
```

Open it in a browser to confirm. Camera permission prompt fires on first visit.

---

## Option B — GitHub web UI (no CLI)

1. Go to https://github.com/new and create a new public repo named `cacoon-gesture-demo` (or whatever — pick something short).
2. Don't initialize with a README/license — leave it empty so the upload goes cleanly.
3. In a terminal at `c:\Masters\AHMI\robotaxi-gesture-demo`:
   ```powershell
   git init
   git add .
   git commit -m "CacOOn Cabin gesture demo - session 5"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
4. On GitHub: open the repo → **Settings** → **Pages** (left sidebar) → under **Source**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, **Save**.
5. Wait ~30 seconds. The same Settings → Pages screen will show your URL once it's live.

---

## After deploy — share with the group

You now have a URL like `https://yourname.github.io/cacoon-gesture-demo/`. Send it to your group with this one-liner:

> *Open this in Chrome or Edge, allow camera access when prompted, raise your hand in front of the webcam, then thumbs-up to confirm. Press F11 for fullscreen. Space bar is a hidden fallback if gesture detection misses.*

That's it. Any laptop with a webcam can run it.

---

## Add the launcher slide to the Figma deck

In your Figma Slides presentation, in the Prototype section:

1. Add a new slide titled something like "**Live Gesture Demo**".
2. Place a single large button shape on it ("Open Live Demo →" or similar) — match the deck's button styling.
3. Select the button → **Right panel → Prototype tab → Action: Open link** → paste the GitHub Pages URL.
4. The button now opens the demo in a new browser tab during presentation mode.

On demo day:
- Presenter clicks the button → demo opens.
- Presenter runs the gesture (or presses Space if it misses).
- Presenter clicks back to the Figma tab and presses Right arrow to advance the deck.

That handoff is intentional — see CLAUDE.md "Demo flow on presentation day" for why the demo doesn't auto-advance Figma.

---

## Updating after deploy

If you change anything in the demo and want the deployed version updated:

```powershell
git add .
git commit -m "describe the change"
git push
```

Pages rebuilds in ~30 seconds. The URL stays the same.
