# TODO — July 17, 2026 (drone wiring finish + bench test)

## Soldering (power side already done: motor bullets, ESC power, ESP32 5V from HW-138B@4.95V)

- [ ] **ESC signal wires:** cut the 4 ESC JST plugs, strip white + black only (reds already clipped).
  - ESC1 white → GPIO13 (FL CW)
  - ESC2 white → GPIO12 (FR CCW) ⚠️ strapping: LOW at boot (signal hi-Z, fine)
  - ESC3 white → GPIO14 (BR CW)
  - ESC4 white → GPIO15 (BL CCW) ⚠️ strapping: HIGH at boot (signal hi-Z, fine)
  - All 4 black → common GND bus → ESP32 GND pin
- [ ] **MPU6050 (GY-521, 8-pin):**
  - VCC → ESP32 3V3
  - GND → GND bus
  - SDA → GPIO21
  - SCL → GPIO22
  - INT → GPIO27
  - Soft-mount with foam tape (A2212 vibration wrecks PID)
- [ ] **Motor phase bullets:** plug ESC 3-blue → motor red/yellow/black (any order). Swap any 2 of 3 later to fix spin direction per corner.

## Pre-power checks
- [ ] Continuity: all GNDs common; NO red BEC on 5V bus; signal wires isolated from GND/12V.
- [ ] HW-138B confirmed 4.95V (already measured). ESP32 NOT on USB while buck powered.
- [ ] Label each ESC wire before cutting (ESC1-4, signal vs gnd).

## Bench test (NO PROPS)
- [ ] Plug LiPo. ESP32 holds 1060us for 3s (arming, NO calibration).
- [ ] Spin ONE motor at a time, 0→30%, holding the motor. Repeat ESC1-4.
- [ ] Check spin direction per corner (FL CW, FR CCW, BR CW, BL CCW). Swap 2 bullets if wrong.
- [ ] I2C scan for MPU6050 at 0x68.
- [ ] Confirm slider 0 = silent stop on all four.

## Notes / reminders
- SimonK range 1060-1860us, stop=1460us. Use `duty_u16()`, never `duty_ns()`.
- If ESC misbehaves: LiPo power-cycle 10s → factory defaults.
- SSID `Bhupendra Patel_8G` (WPA2). Plain name hangs ESP32.
- Serial wedge → physical USB replug. Ctrl+C swallowed → hardware reset + burst in arming window.

## Firmware flash prep (esp-fc — later, after bench spin confirmed)
- [ ] **Confirm hardware first.** Only flash esp-fc AFTER the MicroPython bench spin (above) proves motors + MPU respond. Don't flash blind.
- [ ] **Get the firmware:** clone `rtlopez/esp-fc`. Open in PlatformIO (VS Code).
- [ ] **Target:** `esp32` board (DevKitC V4). Flash replaces MicroPython v1.28.0 — that's expected.
- [ ] **Remap pins in CLI / config** to match our wiring (default esp-fc pins do NOT match):
  - `set pin_output_0 13`  (ESC1 FL)
  - `set pin_output_1 12`  (ESC2 FR)
  - `set pin_output_2 14`  (ESC3 BR)
  - `set pin_output_3 15`  (ESC4 BL)
  - `set pin_i2c_sda 21`
  - `set pin_i2c_scl 22`
  - (gyro INT pin → 27; exact CLI name TBD — confirm from esp-fc docs when flashing)
  - `save`
- [ ] **ESP-NOW receiver:** esp-fc has built-in ESP-NOW RX. Set provider to ESP-NOW (not SPI Rx) for the drone link.
- [ ] **Connect Betaflight Configurator** (v10.10) over the board's serial/USB. Verify gyro + accel move in the 3D view.
- [ ] **Caution:** esp-fc on I2C MPU6050 runs ~2kHz loop (not 4kHz — that needs SPI gyro). Fine for trainer quad.
- [ ] **Serial wedge reminder:** if upload hangs, physical USB replug (AppleUSBSLCOM driver).

## Controller flash (ESP-NOW TX only — separate WROOM-32U, later)
- [ ] Flash WROOM-32U with esp-fc's ESP-NOW TX (or espnow-rclink TX) firmware.
- [ ] Bind TX MAC to drone's esp-fc ESP-NOW RX.
- [ ] Keep BLE gamepad DevKitC for the sim only.

## Testing checklist (bench, NO PROPS — throughout)
- [ ] Motor direction per corner correct after bullet swap (FL CW, FR CCW, BR CW, BL CCW).
- [ ] STOP at 0 throttle reliable on all four.
- [ ] MPU6050 detected at 0x68; raw gyro/accel values sane (not frozen, not saturated).
- [ ] No ESC cutoff / LVC beep on real 3S LiPo during low-throttle bench run.
- [ ] After esp-fc flash: Configurator shows stable attitude, no gyro overflow errors.
- [ ] Failsafe behavior noted (what happens if TX link drops — set later).

## Later (not today)
- Flash esp-fc (replaces MicroPython). Remap pins: motor 13/12/14/15, I2C 21/22, INT 27.
- Controller: flash ESP-NOW TX only (WROOM-32U) for the drone link.
- See BUILD_LOG.md + wiring.md for full context.
