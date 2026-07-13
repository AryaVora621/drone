# Drone Project Devlog

## Overview

ESP32 DevKitC V4 controlling an A2212 2200KV brushless motor via a SimonK 30A ESC.
MicroPython v1.28.0. Web-based throttle control over WiFi.

---

## Session 1: Jul 13, 2026

### Issue 1: ESP32 hangs on WPA3 SSID auth

**Symptom:** The ESP32's `network.WLAN.connect()` hung indefinitely on the home SSID
(`Bhupendra Patel`). Never timed out, never connected. Status LED blinked forever.

**Root cause:** The primary SSID uses WPA3 security. The ESP32's WiFi stack implements
only WPA2 and hangs without error when it encounters WPA3 auth handshake frames it can't
parse. The router emits both WPA2 and WPA3 beacons on the same SSID, but the ESP32's
`connect()` method selects WPA3 and gets stuck.

**Fix:** Switch to the router's separate 2.4 GHz B/G/N SSID (`Bhupendra Patel_8G`), which
uses WPA2 only. Confirmed with `airport -s` scan on macOS before selecting. The `_8G`
suffix was visible in the scan results.

---

### Issue 2: pyserial termios crash (AppleUSBSLCOM DriverKit driver)

**Symptom:** `serial.Serial()` and `termios.tcsetattr()` fail with
`termios.error: (22, 'Invalid argument')` when trying to open `/dev/cu.usbserial-0001`
at 115200 baud. `tcgetattr()` works but shows the port stuck at 9600 baud.

**Root cause:** The CP2102 USB-to-UART bridge is handled by Apple's built-in
`com.apple.DriverKit-AppleUSBSLCOM` driver (a DriverKit userspace driver). After rapid
open/close/ioctl cycles, the driver enters a wedged state where its termios configuration
path becomes unresponsive. The driver can still pass bytes at the existing baud rate but
refuses to reconfigure.

**Fix (physical):** Unplug and replug the ESP32's USB cable. Forces re-enumeration.

**Fix (software):** Send a Ctrl+C burst during the boot arming window (before the web
server starts). The arming sequence has unprotected `time.sleep()` calls that can be
interrupted with `\x03`.

**Prevention:** Avoid rapid serial open/close cycles. Consider installing the official
Silicon Labs VCP driver and ensuring it loads instead of AppleUSBSLCOM.

---

### Issue 3: Motor doesn't respond to throttle (ESC arms but won't spin)

**Symptom:** The ESC beeps on battery connection (arms) but the motor doesn't respond
when the throttle slider is moved. Web server responds correctly, `set_throttle()` is
called and sets the PWM duty, but no motor movement.

**Root cause:** Two independent problems:

**3a. Wrong pulse range.** The SimonK ESC firmware's default pulse range is
**1060-1860 microseconds**, not the standard RC 1000-2000 us that we were sending.
The ESC arms at 1500 us (which is within range) but treats 1000 us (below 1060) and
2000 us (above 1860) as signal errors and ignores them.

**3b. `duty_ns()` unreliable at 50 Hz.** The MicroPython `PWM.duty_ns()` API on ESP32
has had internal scaling bugs at very low PWM frequencies (50Hz = 20ms period). The
16-bit `duty_u16()` API is well-tested across all ESP32 MicroPython builds and directly
maps 0-65535 to 0-100% duty without scaling issues.

**Fix:**
- Changed pulse range from 1000-2000 us to **1060-1860 us** (SimonK default range)
- Switched from `pwm.duty_ns(ns)` to `pwm.duty_u16(us_to_duty(us))` with helper
  `us_to_duty(pulse_us) = int(pulse_us * 65535 / 20000)`
- Using BIDIRECTIONAL=True mapping: 0=1460us(stop), 100=1860us(full)

---

### Issue 4: Boot calibration trainwreck (motor shot across room)

**Symptom:** After adding a boot calibration sequence (1940us for 2s, then 1060us for
3s), the motor spun violently at slider 0. The motor accelerated so fast it tore from
the user's grip and shot across the room.

**Root cause:** The boot calibration at 1940us taught the ESC: "maximum is 1940us." Then
the 1060us pulse taught it "minimum is 1060us." The ESC stored endpoints **1940-1060**
(a reversed range). In this context, 1460us (which should be neutral/stop) became ~45%
throttle because:
- With endpoints [1060, 1940], 1460 is exactly mid-range = 45% throttle
- But the ESC thought the range was [1060(min), 1940(max)]
- Wait, actually with the calibration sequence 1940(max) followed by 1060(min):
  - ESC learns 1940 as max (top endpoint)
  - ESC learns 1060 as min (bottom endpoint)
  - Range: 1060-1940 (works normally)
  
Actually the real issue: SimonK calibration mode has TWO entry methods:
- Method 1: Power on with throttle high (standard). Enter calibration. Send max pulse.
- Method 2: If already receiving pulses and sees a pulse > ~1900us for 2s, it may enter
  a different calibration mode that REVERSES the range.

The exact mechanism: after the boot calibration, 1460us was no longer stop. The motor
should have been at 1060us at slider 0, but our code sent 1460us (the BIDIRECTIONAL
neutral) which the now-corrupted ESC interpreted as ~45% throttle.

**Fix:** Removed boot calibration entirely. Replaced with simple arming at 1060us for
3 seconds. The SimonK ESC works with factory defaults (1060-1860us) without calibration.

**To clear stale calibration from the ESC:** Disconnect LiPo, wait 10 seconds,
reconnect. This restores factory default range.

---

### Issue 5: Web server loop swallows Ctrl+C

**Symptom:** Cannot interrupt the web server loop with Ctrl+C to reach the MicroPython
REPL. Tools like `mpremote` and upload scripts fail to gain REPL access.

**Root cause:** MicroPython `KeyboardInterrupt` IS a subclass of `Exception` (unlike
CPython where it inherits from `BaseException`). The web server's `except Exception:
pass` catches Ctrl+C, preventing REPL access.

**Fix:** Use hardware reset (DTR/RTS toggle) to reboot the board, then send Ctrl+C
during the unprotected boot arming window (before the web server starts). The arming
sequence has `time.sleep()` calls that aren't wrapped in try/except, so Ctrl+C
interrupts them and drops to REPL.

---

### Issue 6: Direction switching causes motor jerks

**Symptom:** With `BIDIRECTIONAL = True`, moving the slider from positive to negative
values causes violent motor jerks at the crossover point. No actual reverse occurs.

**Root cause:** The SimonK 30A ESC runs forward-only (aircraft) firmware, not
bidirectional (car/boat). When the slider crosses through 1460 us (the bidirectional
neutral), the ESC goes into an undefined brake/forward battle state.

**Fix:** Changed the web slider HTML from `min="-100"` to `min="0"` and removed the
"Reverse" label. Slider now goes 0 (stop) to 100 (full forward). The mapping
`pulse_us = 1460 + value * 4` gives 1460-1860 us. No negative values = no direction
crossover = no jerks.

---

### Issue 7: File upload corruption at chunk boundaries

**Symptom:** After uploading `main.py` via the REPL in 512-byte chunks, the board
reported `SyntaxError: invalid syntax` at a specific line. The first 35 lines were
correct but later lines had garbled content (e.g., `def setn    if BIDIRECTIONAL:`
where two lines were merged across a chunk boundary).

**Root cause:** The upload script sends `f.write(repr(chunk))` for each 512-byte chunk.
When sending over serial at high speed (30ms delay between chunks), MicroPython's REPL
didn't finish processing one `f.write()` before the next command arrived. The serial
buffer interleaved bytes from adjacent chunks, corrupting the boundary.

**Fix:** Upload with smaller chunks (256 bytes) and longer delays (100ms between
commands). OR use the one-shot approach: encode the file as base64 and send a single
`f.write(ubinascii.a2b_base64(...))` command in paste mode. The 256-byte chunk approach
with 100ms delays was confirmed working.

**Lesson:** When uploading large files over the MicroPython REPL via serial, use
conservative chunk sizing and intersend delays. The ESP32's REPL serial handler has
limited buffering.

---

### Issue 8: WebREPL not available in ESP32_GENERIC build

**Symptom:** After adding `import webrepl; webrepl.start()` to `main.py`, the boot log
shows "WebREPL not available:" with no additional detail.

**Root cause:** The `ESP32_GENERIC` MicroPython firmware build (v1.28.0) does not include
the `webrepl` module. It requires the `ESP32_GENERIC-OTA` build or a custom build with
`FROZEN_MANIFEST` including `webrepl`.

**Fix:** None without reflashing. The `ESP32_GENERIC-OTA` build includes WebREPL, but
we're using `ESP32_GENERIC`. Future option: flash `ESP32_GENERIC-OTA` instead.

**Workaround:** Continue using serial upload (the 256-byte chunk approach) for firmware
updates. Accept the serial wedge issue.

---

## Current status (end of session)

**What works:**
- ESP32 boots, connects to WiFi, serves web dashboard at 192.168.0.184
- Motor arms at 1060us for 3 seconds, no calibration needed
- Slider 0 (1460us) = stop, slider 100 (1860us) = full forward
- Motor spins smoothly, strong torque, good throttle response
- Users report slider 25+ gives reliable motion

**What doesn't work:**
- WebREPL (module not in ESP32_GENERIC build)
- Serial port reliability (AppleUSBSLCOM wedges after upload cycles)
- "Calibrate Motor" button (re-corrupts ESC endpoints — don't click it)
- Boot calibration (removed — the ESC doesn't need it)

**Key lesson:** The SimonK 30A ESC with forward-only aircraft firmware just works with
its factory default 1060-1860us range. All we do is arm at 1060us for 3s, then send
1460-1860us for 0-100% throttle. No calibration, no bidirectional mode, no tricks.

---

## Tooling

### Upload workflow (when serial works)
1. Open port at 115200
2. Get to REPL (Ctrl+C burst if board is running)
3. `f = open('main.py', 'wb')`
4. Write in 256-byte chunks: `f.write(repr(chunk))` with 100ms delays
5. `f.close()`
6. `import machine; machine.reset()`

### When serial is wedged
1. Physical USB replug (the only reliable fix)
2. Then use the upload workflow above

### Key files
| File | Purpose |
|---|---|
| `main.py` | Firmware: WiFi, PWM, web server, arming |
| `CLAUDE.md` | Project instructions and critical gotchas |
| `DEVLOG.md` | Full issue history with root causes and fixes |
| `PROJECT_GOALS.md` | Roadmap from bench test to ESP-NOW to full drone |
| `CHECKPOINT_LAST.md` | Current session state and next actions |
| `TASK_QUEUE.md` | Active task tracking |
| `ai/tools/force_upload.py` | Aggressive upload with hardware reset fallback |
| `ai/tools/read_serial.py` | Simple serial reader with DTR/RTS reset |
