# Session Checkpoint — Jul 17, 2026 (evening — calibration UI + serial instability)

## Completed
- Added safe calibration feature: button triggers `calibrate_sequence()` which holds 1860us for 2s then drops to 1060us for 3s. Phase tracking (1=DISCONNECT, 2=RECONNECT, 3=done) exposed via /seqstate endpoint.
- Built step-by-step visual calibration guide on the dashboard: full-screen overlay with color-coded phases (red phase 1: DISCONNECT, green phase 2: RECONNECT, blue phase 3: complete) and timing text. Phase updates via 300ms poll.
- Sliders lock immediately when calibrate is clicked (not waiting for next poll cycle).
- upload via ampy raw REPL (`ampy put main.py /main.py`) works — confirmed file content on-board.

## Current state
- **Firmware:** `main.py` with 4-motor tester + calibration + visual guide. Live at `http://192.168.0.184`.
- **Upload method:** ampy put via raw REPL reliably works after DTR reset. However, **serial wedge** (AppleUSBSLCOM) still severe — multiple USB replugs needed per upload. Paste mode and force_upload both unreliable.
- **Testing:** ESC1/2/3 start at ~11% (1148us, factory default SimonK). ESC4 (BL) starts at ~51 (1476us) — corrupted calibration confirmed. ESC3 (BR) pulses at slider value 10 (normal SimonK low-end cogging).
- **Calibration:** Not yet tested. Button and UI ready, user deferred to debug later.
- **HW-138B switch/jumper** not yet installed. Currently on USB power only.

## What's not working / needs debug
1. **Serial upload is flaky.** The CP2102 DriverKit driver wedges repeatedly. ampy raw REPL works when it connects but paste mode and force_upload both fail with binary garbage. Multiple physical replugs needed per upload session.
2. **ESC4 calibration still corrupted.** Safe calibration was built to fix this but hasn't been run yet.
3. **No clean way to interrupt the web loop.** Ctrl+C swallowed by `except Exception: pass`. Hardware DTR reset + ampy is the only reliable upload path.

## Next action (when resumed)
1. Run safe calibration via dashboard: click CALIBRATE → disconnect LiPo → wait → reconnect → verify BL starts at ~11%
2. If calibration fails, debug: did the /calibrate endpoint respond? Did the phase overlay update? Check serial for calibration log output.
3. Direction verification per corner after motors all spin cleanly.

## Files updated this session
- `main.py` — calibration feature, phase tracking, visual step overlay, immediate slider lock
- `TASK_QUEUE.md` — current open/in-progress/done
- `CHECKPOINT_LAST.md` — this file
