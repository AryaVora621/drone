# Task Queue

## Open
- User: pair "Drone Controller" from PC/phone and verify 4 axes track
- User: send 'c' over serial with sticks at rest to calibrate
- User: open sim/ in browser, pair Drone Controller, fly (keyboard fallback works without gamepad)
- (later) Port espnow-rclink TX with ADC input (replace PPM reader)
- (later) Build rx_test interim receiver to validate ESP-NOW link
- (later) Flash ESP-FC on drone ESP32-U, set built-in SPI Rx
- Buy remaining drone parts (see globalPartsList.txt)

## In Progress
- (none)

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
- Build + flash `controller/` BLE gamepad (PlatformIO); confirmed advertising "Drone Controller"
- Build 3D FPV sim (`sim/fpv.html` + `sim/fpv.js` + local `three.min.js`): reads BLE gamepad (Mode-2), visible quad + chase cam (C = onboard FPV); node syntax-checked
- Debugged controller hardware: RX wire (GPIO34) was disconnected, causing floating pin noise on RY. Resoldered, all 4 axes working.
