# Task Queue

## Open
- Debug serial upload instability — ampy raw REPL works but paste mode and force_upload wedge repeatedly even after USB replug
- Run safe calibration on all 4 ESCs to fix BL (starts at ~51/1476us instead of spec ~11/1148us)
- Confirm all 4 motors spin same speed at low throttle after calibration
- Verify spin direction per corner (swap 2 bullet connectors if wrong)
- Build HW-138B inline switch/jumper for USB-vs-buck isolation
- Pair "Drone Controller" from PC/phone and verify 4 axes track
- (later) Port espnow-rclink TX with ADC input
- (later) Flash ESP-FC on drone ESP32-U, set built-in SPI Rx
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
