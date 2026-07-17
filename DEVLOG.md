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

## Session 3: Jul 14, 2026 (afternoon)

### Issue 11: Right stick Y (GPIO35) stuck at -1 — disconnected RX wire

**Symptom:** In the FPV sim, pitch was always negative and randomly triggering. Hardware
tester (https://hardwaretester.com/gamepad) showed axis 3 (RY) stuck at -1, drifting
between -1 and -0.5 even when not touching the stick.

**Initial hypothesis:** Floating ADC pin on GPIO35 (RY). The slow drift and snap-back
pattern is characteristic of parasitic capacitance on an unconnected trace.

**Investigation:**
- Resoldered GPIO35 — no improvement
- Checked continuity from ESP32 to joystick module — fine
- Measured resistance VCC to RY: 7.9k ohm (reasonable for 10k pot)
- Measured joystick VCC: 3.34V (correct)
- Measured RX voltage while moving stick: RX moved, RY voltage swung 0-3.3V
- This looked like crosstalk, but the real cause was simpler

**Root cause:** The RX wire (GPIO34) was never connected — either never soldered or broke off. The floating GPIO34 pin read ADC noise that happened to correlate with stick movement (mechanical vibration), creating the illusion of crosstalk from RX into RY. Once the wire was soldered, both axes read cleanly.

**Fix:** Soldered the RX wire to GPIO34. No firmware changes needed.

## Tooling
- `controller/src/diag.cpp` — diagnostic sketch that prints raw ADC values for all 4 pins over serial. Upload to confirm hardware readings without the BLE layer.

---

## Session 2: Jul 14, 2026

### Issue 9: Motor cuts out above ~40% throttle with prop mounted

**Symptom:** Mounted a tri-blade 5in prop and ran the motor. Above ~40% throttle it
went silent and stopped dead; web dashboard stayed reachable the whole time. Replugging
the battery into the ESC restored operation, but it cut out again at the same ~40% point.

**Root cause:** Power source, not firmware. The DIY 3x18650 pack (market cells, internal
BMS) cannot supply the current a prop load demands. The dashboard staying up rules out an
ESP32 brownout. The silent, latching cut (no beep) that clears on battery replug is the
signature of a **BMS over-current trip**, not an ESC LVC. A tri-blade 5in prop overprops
the A2212/6T 2200KV (a plane outrunner, not an FPV motor), pushing current past the pack's
~5-10A ceiling above 40% throttle.

**Fix:** Replace the DIY 18650 pack with a proper high-C 3S LiPo (~2200-3000mAh, 80C) so
the pack can deliver the current without tripping. Also plan to drop the tri-blade prop to
a 5030 two-blade to keep the motor/ESC within thermal/current limits.

---

### Issue 10: ESC beeps after being powered a while (low-voltage warning)

**Symptom:** With the DIY 18650 pack connected, the ESC starts beeping periodically after
being plugged in for a while (not at power-up).

**Root cause:** Low input voltage (LVC warning). A beep that starts at power-up is normal
(cell-count detection + arm tone). A beep that begins later, while idle, means the pack has
sagged toward the ~3.0-3.3V/cell cutoff (~9-10V for 3S). The small DIY pack drains even
while the ESC sits armed and idle.

**Confirm:** Measure pack voltage when beeping. ~11-12.6V = healthy; ~9-10V or below = LVC.

**Fix:** Same as Issue 9 - the 80C LiPo holds voltage under load and won't sag to LVC.
Also avoid leaving the ESC armed on the pack idle, which slowly drains it.

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

---

## Session 4: Jul 17, 2026 (evening — 4-motor build + calibration UI)

### Issue 12: CP2102 serial wedge persists after USB replug

**Symptom:** After physically replugging the USB cable at the Mac, the port re-appears (`/dev/cu.usbserial-0001`) but immediately outputs binary garbage on open. The `force_upload.py` tool and manual `serial.Serial()` open both fail. The wedge now occurs more aggressively than before — even a single open/close cycle can trigger it.

**Root cause:** Same AppleUSBSLCOM DriverKit driver issue as Issue 2, but now appears to be triggered by the DTR/RTS toggles used in the upload tool. The driver enters a state where it passes raw bytes at 115200 but cannot be reconfigured or properly opened with termios.

**Diagnosis:**
- `ls -la /dev/cu.usbserial-0001` shows the port exists
- `lsof` shows no process holding it
- `stty -f /dev/cu.usbserial-0001` (not tested) may confirm it's stuck at 9600
- Binary output pattern: repeating `\x00\x0c\x0cp` suggests data at wrong baud

**Fix found:** Use DTR reset first to reboot the ESP32 cleanly, then open serial only after 1-2s delay. The `ampy` tool (adafruit-ampy) uses raw REPL protocol which handles the DTR reset properly. Direct pyserial with DTR/RST sequence also works if you properly flush the buffer.

**Workflow that works:**
1. `python3 -c "import serial; s=serial.Serial('/dev/cu.usbserial-0001',115200,timeout=2); s.dtr=0; s.rts=1; time.sleep(0.1); s.dtr=1; s.rts=0; time.sleep(0.5); s.dtr=0; s.rts=0; time.sleep(8); s.close()"` → board reboots and starts fresh
2. `ampy --port /dev/cu.usbserial-0001 --baud 115200 put main.py /main.py` → reliable upload

### Issue 13: Safe calibration feature added (with visual step guide)

**What:** Added a `/calibrate` endpoint and `calibrate_sequence()` function that holds all 4 motors at 1860us for 2s then drops to 1060us for 3s. The ESP32 never exceeds 1860us in calibration mode (learned from Issue 4 — 1940us reverses the range).

**Dashboard overlay:** Full-screen color-coded step guide that updates via 300ms poll:
- Phase 1 (red): DISCONNECT LiPo — motors held at 1860us
- Phase 2 (green): RECONNECT LiPo — signal at 1060us arm level
- Phase 3 (blue): Calibration complete — auto-dismisses

**Why:** ESC4 (BL, GPIO16) has corrupted calibration — starts at ~51 throttle (1476us) instead of matching the other three at ~11 (1148us). Factory reset via clean calibration should restore [1060, 1860] endpoints.

**Not tested yet.** User deferred to next session.

### Issue 14: ESC3 (BR) pulses at low throttle

**Symptom:** At slider value 10 (1500us — only 40us above stop), ESC3 pulses/cogs instead of spinning smoothly.

**Root cause:** Normal SimonK behavior at the low end of the forward range. 1500us is barely above the 1460us stop point — the motor doesn't have enough torque to spin cleanly against magnetic cogging. Other ESCs may do the same if observed closely.

**Not a fixable issue.** Minimum usable throttle in flight will be ~20-25%. No action needed.
