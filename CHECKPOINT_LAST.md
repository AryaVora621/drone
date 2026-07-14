# Session Checkpoint — Jul 14, 2026 (afternoon)

## Completed this session
- Debugged controller hardware: axis 3 (GPIO35 / RY) stuck at -1, drifting -1 to -0.5
- Diagnosed root cause: RX wire (GPIO34) was disconnected — floating pin injected noise into RY
- Resoldered RX wire, confirmed all 4 axes working on hardwaretester.com
- Wrote `controller/src/diag.cpp` diagnostic sketch (kept for future use)
- Added crosstalk compensation to `main.cpp` (then reverted — not needed, was just a loose wire)

## Current state
- Controller firmware back to original: `controller/src/main.cpp` (147 lines, no crosstalk hack)
- All 4 axes working: LX(GPIO32), LY(GPIO33), RX(GPIO34), RY(GPIO35)
- Joystick module getting 3.34V, all pots reading cleanly
- `controller/src/diag.cpp` available for future ADC diagnostics

## Next action
1. Upload firmware, pair "Drone Controller" in Bluetooth, open sim and fly
2. Send 'c' over serial with sticks at rest to calibrate centers
3. (Later) ESP-NOW phase

## Human decisions needed
- None pending.