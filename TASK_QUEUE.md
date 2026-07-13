# Task Queue

## Open
- Test motor response with 0-100 slider on web dashboard
- Verify stop at slider 0 is reliable (no drift)
- Design ESP-NOW controller link (phase 2 hardware and protocol)
- Flash ESP32-GENERIC-OTA for WebREPL support (eliminate serial dependency)

## In Progress
- Document project setup: git init, CLAUDE.md, push to GitHub

## Done
- Flash MicroPython v1.28.0 to ESP32
- Implement 50Hz PWM via duty_u16
- Implement web server with dark-theme slider UI
- Connect to WPA2 WiFi (found working SSID)
- Identify SimonK default pulse range (1060-1860us)
- Verify motor spins and responds to throttle
- Document all issues in DEVLOG.md
- Remove boot calibration (was corrupting ESC)
- Change slider to 0-100 (no negative values)
- Create PROJECT_GOALS.md with full roadmap
- Create CLAUDE.md with project instructions
