# Session Checkpoint — Jul 13, 2026

## Completed
- Flashed MicroPython v1.28.0 to ESP32-DevKitC V4
- Deployed `main.py`: 50Hz PWM via duty_u16, 1060-1860us SimonK range, web server with slider
- Wi-Fi connects to `Bhupendra Patel_8G` (WPA2); plain SSID is WPA3 and hangs ESP32
- Web dashboard: dark theme, slider 0-100, STOP button, Calibrate button (don't use)
- **Motor confirmed spinning** on forward throttle; user reports response is strong
- Documented all 8 issues in DEVLOG.md with root causes and fixes

## Issues resolved
- **Serial wedge (AppleUSBSLCOM driver):** pyserial termios stuck at 9600 after rapid open/close cycles. Fix: physical USB replug, or catch boot window with Ctrl+C burst
- **Pulse range wrong:** SimonK default is 1060-1860us, not 1000-2000us. Changed mapping + switched duty_ns to duty_u16
- **Boot calibration disaster:** 1940us calibration taught ESC reversed range, 1460us became 45% throttle, motor shot across room. Fix: removed calibration, just arm at 1060us for 3s
- **Direction jerks:** BIDIRECTIONAL=True crossed through neutral when slider went negative. Fix: slider min=0 instead of -100
- **Ctrl+C swallowed:** MicroPython KeyboardInterrupt is subclass of Exception, caught by web server handler. Fix: hardware reset + Ctrl+C in boot arming window
- **Upload corruption:** 512-byte chunks merged at boundaries. Fix: 256-byte chunks with 100ms delays

## Current state
- Board running at 192.168.0.184, web server active
- Slider 0-100, forward-only mapping: pulse_us = 1460 + value * 4
- Code boots clean: arm at 1060us (3s), WiFi connect, server start
- WebREPL not available (module not in ESP32_GENERIC build)
- **Do not click "Calibrate Motor"** — will corrupt ESC endpoints again
- No propeller mounted — bench testing only

## Next actions
1. User test motor response with slider at http://192.168.0.184
2. Verify stop at slider 0 works consistently
3. After bench testing complete: design ESP-NOW controller link (phase 2)
4. Future: flash ESP32_GENERIC-OTA firmware for WebREPL support
5. Future: mount on drone frame and add propeller (only after confident testing)
