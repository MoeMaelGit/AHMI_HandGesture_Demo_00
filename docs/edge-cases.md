# Edge Cases — Gesture Hailing

From Figma presentation (slides 263:481 + adjacent) and design reasoning.

## Gesture Detection Edge Cases

| # | Case | Handling |
|---|------|----------|
| 1 | Random raised hand (not hailing) | Two-stage flow (palm → thumbs-up) filters most false triggers |
| 2 | Hand up but moving (e.g. waving goodbye) | Require 2s spatial stability (centroid drift < 30px) |
| 3 | Multiple people with open palms | Lock to highest-confidence + largest bounding box hand |
| 4 | Multiple people doing thumbs-up | First confirmed wins; lock prevents race |
| 5 | Hand partially occluded | Min confidence 0.85; below = not detected |
| 6 | Person too far away | Bounding box must be > 5% of frame area |
| 7 | Wrong gesture (peace sign, pointing) | Only OPEN_PALM and THUMBS_UP trigger state changes |
| 8 | Second person starts gesture during confirmation | Show "one request at a time" — ignore until resolved |
| 9 | Thumbs-up timeout (8s) | Return to IDLE with "Request cancelled" message |
| 10 | Low light / poor visibility | Show warning if confidence < 0.6 consistently |
| 11 | Indoor demo (laptop cam, no outdoor context) | Detection zone = center 80% of frame; no horizon filter needed |
| 12 | Accidental confirmation | 2s hold provides undo window; cancel visible during countdown |

## System-Level Edge Cases (from Figma)

From "Edge Cases" slides in presentation:
- **Mid-severity issue:** taxi calls assistance, secondary taxi booked free, error code displayed
- **Passenger reported:** camera activated, police notified if needed
- **Note:** these are interior/in-ride edge cases — out of scope for the hailing prototype but part of the broader project

## Demo-Specific
- If MediaPipe fails to load (no internet): show "Demo mode" with Space bar trigger
- If camera permission denied: show clear "Enable camera" instructions
