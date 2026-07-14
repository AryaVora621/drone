# Drone Project — CLAUDE.md

## Project
Custom drone: ESP32 DevKitC V4 + A2212 2200KV motor + SimonK 30A ESC. MicroPython v1.28.0. Web-based throttle control over WiFi. Future: ESP-NOW controller link.

## Hardware
- ESP32-DevKitC V4 on USB (port `/dev/cu.usbserial-0001`)
- A2212 2200KV brushless motor on 3S LiPo
- SimonK 30A ESC (forward-only aircraft firmware, 1060-1860us native range)
- Wiring: ESP32 GPIO13 (PWM) → ESC signal, GND → GND. ESC BEC red wire disconnected.
- NO PROPELLER on bench. Motor must be held or secured during tests.

## Critical known issues (read before any work)

**PWM:** Use `duty_u16()`, NOT `duty_ns()` at 50Hz. Helper: `us_to_duty(pulse_us) = int(pulse_us * 65535 // 20000)`.

**Pulse range:** SimonK default is 1060-1860us. NOT 1000-2000us. Mapping: 0=1460us(stop), 100=1860us(full). Formula: `pulse_us = 1460 + value * 4`.

**NO boot calibration.** The boot calibration (1940us→1060us) teaches the ESC endpoints 1940-1060 (reversed range) and makes 1460us = ~45% throttle instead of stop. This caused the "motor shot across room" incident. Arming at 1060us for 3s (no calibration) is all that's needed.

**Serial wedges.** macOS AppleUSBSLCOM CP2102 driver wedges after rapid open/close/ioctl cycles. `termios.tcsetattr()` refuses to change baud rate from 9600. Fix: physical USB replug.

**Ctrl+C swallowed.** MicroPython `KeyboardInterrupt` is subclass of `Exception`, so the web server's `except Exception: pass` catches it. Use hardware reset + Ctrl+C burst during boot arming window (before web server starts).

**Controller axis stuck at -1?** Check ALL wires, not just the symptomatic pin. The RX wire (GPIO34) was disconnected, making the floating pin read ADC noise that looked like crosstalk on RY. Always check continuity on every joystick wire before assuming a hardware defect or adding firmware workarounds.

## Controller
- ESP32 BLE gamepad (PlatformIO project in `controller/`)
- Pins: LX=GPIO32, LY=GPIO33, RX=GPIO34, RY=GPIO35 (all ADC1, 3.3V max)
- Device name: "Drone Controller". Pair in Bluetooth, then use in sim or hardwaretester.com
- Calibration: send 'c' over serial with sticks at rest (stored in NVS)
- Upload port: `/dev/cu.SLAB_USBtoUART` (NOT the drone's `/dev/cu.usbserial-0001`)

## Key files
- `main.py`: firmware — PWM, WiFi, web server, arming
- `controller/src/main.cpp`: BLE gamepad firmware (PlatformIO)
- `controller/src/diag.cpp`: ADC diagnostic sketch (upload to check raw pin readings)
- `DEVLOG.md`: full issue history with root causes and fixes
- `PROJECT_GOALS.md`: roadmap from bench test to ESP-NOW to full drone
- `CHECKPOINT_LAST.md`: current session state and next actions
- `TASK_QUEUE.md`: active task tracking

## Commands
- `python3 ai/tools/force_upload.py` — upload main.py with hardware reset + Ctrl+C burst (when serial works)
- `python3 ai/tools/read_serial.py` — read serial with DTR/RTS reset
- `python3` with pyserial + repr-chunk upload — manual upload via REPL

## WiFi
- SSID: `Bhupendra Patel_8G` (WPA2 2.4GHz). The plain `Bhupendra Patel` SSID uses WPA3 and hangs the ESP32.
- Static IP: `192.168.0.184`
- Web dashboard: `http://192.168.0.184`

## Git workflow
- Commit convention: `drone: <present-tense verb> <what changed>`
- Push to `origin main` on GitHub: https://github.com/AryaVora621/drone.git

## No propeller on bench
Never run with a propeller attached during bench testing. The motor at full throttle produces dangerous torque. Always hold the motor or clamp it securely.
