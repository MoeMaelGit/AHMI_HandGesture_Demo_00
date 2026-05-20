# Gesture Specification

## Source
Figma slide "1.1 Intention Detection & Confirm Your Request" (node 179:59)
Sequence: Girl holds hand → Image recognition → Taxi asks for confirmation → Display "hold your hands for 2 seconds" → Detects confirmation → Finds pickup stop → Gets to pickup stop → Display "Follow me"

## States

### IDLE
- Camera scans continuously
- UI: subtle "Raise your hand to hail" hint
- No countdown, no prompts

### DETECTING (open palm raised, stable)
- Trigger: open palm detected with confidence ≥ 0.85, hand in upper 60% of frame, bounding box ≥ 5% of frame
- UI: pulsing hand outline, 2s countdown ring fills
- Lock on: largest/highest-confidence hand

### PROMPTING (thumbs-up request)
- Trigger: palm held stable for 2s
- UI: "Now show thumbs-up ↑", 8s timer bar
- Reason: eliminates false positives (people just waving, reaching)

### CONFIRMING (thumbs-up held)
- Trigger: thumbs-up detected with same proximity/confidence criteria
- UI: thumbs-up locked indicator, 2s countdown fills

### CONFIRMED
- Trigger: thumbs-up held 2s
- UI: full-screen taxi arrival animation (taxi glides in, doors open, ~3s)
- Action: dispatch ArrowRight KeyboardEvent to advance Figma Slides
- Message: "On its way — follow the taxi to the stop"

### CANCELLED
- Trigger: timeout or hand drops in any state
- UI: "Request cancelled. Try again." → fade to IDLE

## MediaPipe Landmark Logic
- Open palm: all 5 fingers extended (tip y < pip y for each finger)
- Thumbs-up: thumb extended upward, other 4 fingers curled
- Stability: wrist landmark centroid moves < 30px across 10 consecutive frames
