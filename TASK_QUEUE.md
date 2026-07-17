# Task Queue

## Open
### ESP-FC Integration (see ESPFC_PLAN.md for full detail)
- [ ] Phase 0: persist plan to project files (ESPFC_PLAN.md, this file, CHECKPOINT_LAST.md)
- [x] Phase A COMPLETE: cloned + flashed esp-fc on drone board, remapped pins (outputs 12/14/17/16, I2C 21/22), enabled ESP-NOW receiver (feature_rx_spi=1). No separate gyro INT pin exists in esp-fc (polls I2C directly) — GPIO35 note in old plan doesn't apply. Freed pins 17/16 from UART2 (serial_2) which would have conflicted with BR/BL motor outputs. User confirmed via Betaflight Configurator v10.10 (had to install this exact version — betaflight.com web app rejects esp-fc's older API) Setup tab: 3D model tracks tilt correctly on all axes. Minor 1-2deg/min gyro drift observed — normal uncalibrated MEMS bias, not a defect; recalibrate before each flight session.
- [x] Phase B COMPLETE: `esp32u_espnow` flashed to WROOM-32U, serial smoke test passed (clean boot, sane calibration ADC readings on all 4 axes). Channel mapping confirmed from esp-fc source (AETR: ch0=roll,1=pitch,2=throttle,3=yaw) — not guessed. Fixed unrelated diag.cpp corruption bug.
- [x] Phase C pre-prop checks ALL PASSED: ESP-NOW link live/stable, Receiver tab axis-swap fixed+confirmed, Motors tab pin/corner mapping bug fixed+confirmed (esp-fc mixer expects rotational output order, not FL/FR/BR/BL declaration order — see CHECKPOINT_LAST.md), motor protocol set to PWM with SimonK-safe throttle range, failsafe check passed (drone correctly cuts throttle, does NOT hold last command). Found operational lesson: link reconnection after a drop may need both boards power-cycled (transmitter first). Physical pin-to-motor wiring (FL=12 etc) unchanged — only esp-fc's output-index-to-pin assignment was corrected.
- [ ] Phase C remaining: motor direction fix (2 of 4 motors need reversed wiring for CW/CCW alternation, hardware fix) → THEN install props (correct CW/CCW per corner) → final low-throttle check with props on + controller connected.

### Other open items
- Build HW-138B inline switch/jumper for USB-vs-buck isolation
- Pair "Drone Controller" BLE gamepad from PC/phone and verify 4 axes track (superseded by ESP-NOW controller once Phase B/C land, but keep BLE working for the sim)
- (later) Buy remaining drone parts

## In Progress
- (none — debugging session paused)

## Done
- Flash MicroPython v1.28.0 to ESP32
- Implement 50Hz PWM via duty_u16 (1060-1860us SimonK)
- Web dashboard slider 0-100
- Identify SimonK range + remove boot calibration
- Document issues in DEVLOG.md (Issue 1-10)
- Diagnose 40% cutoff (BMS trip) + LVC beep
- globalPartsList.txt created/refined
- Controller link research (ESP-FC / espnow-rclink / ESP32-U)
- CONTROLLER_PLAN.md written
- Build + flash `controller/` BLE gamepad (PlatformIO)
- Build 3D FPV sim (`sim/fpv.html` + `sim/fpv.js` + local `three.min.js`)
- Debugged controller hardware: RX wire (GPIO34) was disconnected
- Soldered all 4 ESC signal wires: FL=14, FR=12, BR=17, BL=16
- Soldered MPU6050 (GY-521): VCC→3V3, SDA→21, SCL→22, INT→35 — detected at 0x68 ✅
- Added safe calibration feature (1860us max, step-by-step visual guide on dashboard)
- 4-motor web tester dashboard with per-motor sliders + auto ramp/hold/cutoff
- Fixed calibration sequence logic: reconnect window was on the wrong phase (told user to reconnect during 1060us hold instead of 1860us hold); added Step 0 pre-confirm, extended hold windows to 6s/4s
- Fixed calibration overlay z-index bug (Continue button was unclickable, hidden behind the dark blur)
- Fixed FL/FR motor swap (dashboard label vs. physical motor) — ESC_PINS reordered from [14,12,17,16] to [12,14,17,16]
- Bench testing confirmed complete (all 4 motors calibrated + correct corners, MPU6050 detected) — cleared to start esp-fc integration
