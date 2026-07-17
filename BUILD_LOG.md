# Build Log — What Works / What Doesn't

Living tracker for the drone build. Updated every session so we don't re-learn old scars.
Format: ✅ works · ❌ broken/avoid · ⚠️ caution · ❓ open question.

---

## ✅ Confirmed working
- ESP32-DevKitC V4 runs MicroPython v1.28.0; WiFi dashboard at `http://192.168.0.184` (SSID `Bhupendra Patel_8G`, WPA2).
- Single-motor bench spin: 50Hz PWM via `duty_u16()`, SimonK range 1060-1860us, stop=1460us. Motor responds smoothly.
- Controller: BLE gamepad firmware builds (PlatformIO), advertises "Drone Controller", all 4 axes clean after RX-wire resolder.
- FPV sim (`sim/fpv.html`) reads BLE gamepad, Mode-2, visible quad + chase cam.

## ❌ Avoid / known failures
- **Boot calibration sequence** → corrupts ESC endpoints (motor shot across room). Use arming-only (1060us 3s). If corrupted: LiPo power-cycle 10s.
- **`duty_ns()` at 50Hz** → unreliable scaling. Use `duty_u16()`.
- **WPA3 SSID `Bhupendra Patel`** → hangs ESP32. Use `_8G`.
- **DIY 18650 pack** → BMS trips ~40% throttle + idle LVC beep. Use real 3S LiPo (80C).
- **WebREPL** → not in ESP32_GENERIC build. Serial upload (256-byte chunks) only.
- **All 4 ESC BEC reds connected** → BECs fight each other / the buck. Clip all reds (HW-138B is sole supply).
- **HW-138B at 5.7V** → too hot for ESP32 reg, drift risk. Set to 5.0V (measured 4.95V, good).

## ⚠️ Cautions
- Serial wedge (AppleUSBSLCOM) after rapid open/close → physical USB replug.
- Web loop swallows Ctrl+C → hardware reset + Ctrl+C burst in arming window.
- Motor phase wires: any order is safe; swap 2 of 3 to reverse direction per corner.
- MPU6050 MUST be soft-mounted (A2212 vibration wrecks PID).
- Strapping pins: GPIO12 must be LOW at boot, GPIO15 HIGH at boot (signal lines hi-Z, fine).

## ❓ Open questions
- GY-521 VCC: confirmed 3.3V (ESP32 3V3 pin) — Arya chose 3V3, not 5V. ✅ resolved 2026-07-16.
- Flight stack: ✅ esp-fc decided (see DECISIONS).
- Controller: ✅ ESP-NOW TX only decided (see DECISIONS).
- HW-138B measured 4.95V (no load) — acceptable.

---

## DECISIONS (2026-07-16)
- **MPU6050 INT pin → GPIO35** (input-only pin, perfect for interrupt input). Wired even though optional; esp-fc uses EXTI data-ready for clean gyro sampling. Better safe.
- **MPU6050 VCC → ESP32 3V3** (not 5V). Arya confirmed 3.3V version / chose 3V3 rail.
- **HW-138B → 4.95V** (tuned down from 5.7V). ESP32 5V pin powered by buck; ESP32's own 3V3 reg feeds MPU.
- **All 4 ESC BEC reds clipped.** HW-138B sole ESP32 supply.
- **USB power foldback:** When LiPo is disconnected and HW-138B has no input, its output stage loads the DevKitC 5V rail to ~0.5V over USB. Fix: in-line switch/jumper on HW-138B output to isolate during USB debug. Never have both USB + buck connected at once.
- **FINAL ESC PIN LAYOUT (2026-07-17): FL=GPIO14, FR=GPIO12, BR=GPIO17, BL=GPIO16.** All blacks → GND bus, all reds clipped.
- **esp-fc pin remap (when we flash):** motor outputs → GPIO14/12/17/16 (ESC1-4 FL/FR/BR/BL), I2C SDA→21, SCL→22, INT→35. Default esp-fc pins do NOT match; must remap in CLI.
- **FLIGHT STACK DECIDED: esp-fc** (rtlopez, Betaflight-compatible). Replaces MicroPython. ~2kHz loop on I2C MPU6050 (fine for trainer quad). Uses Betaflight Configurator.
- **CURRENT FIRMWARE: MicroPython `main.py` = BENCH TESTER ONLY.** 4-motor web control + auto ramp/hold/cutoff. Will be replaced when esp-fc is flashed. Save Python work for now; esp-fc later.
- **CONTROLLER DECIDED: ESP-NOW TX only** (flash WROOM-32U as dedicated TX). No BLE dual-boot. Current BLE gamepad stays for sim use.

## WIRING (locked)
See `wiring.md`. Summary:
- ESC pins (ACTUAL, 2026-07-17): FL=GPIO14, FR=GPIO12, BR=GPIO16, BL=GPIO17. (Original plan 13/15 changed to 16/17 for cleaner wiring; GPIO2 rejected as strapping/LED pin.)
- MPU6050: VCC→3V3, GND→bus, SDA→21, SCL→22, INT→27.
- All 4 ESC blacks → GND bus; all 4 whites → GPIOs; all 4 reds clipped.
- HW-138B 5V → ESP32 5V pin.
