# ESP-FC + ESP-NOW Controller Integration

Resume reference for the esp-fc / ESP-NOW integration phase. If context gets cleared, start here.

## Context

Bench testing is confirmed complete: all 4 motors calibrated and spinning the correct physical corner, MPU6050 detected at 0x68. Moving from the MicroPython bench-tester (`main.py`) to a real flight stack (`esp-fc`, a Betaflight-compatible firmware for ESP32) with a wireless ESP-NOW link from the DIY controller, per `CONTROLLER_PLAN.md`'s deferred-phase plan and `TODO_july17.md`'s flash-prep checklist. The controller is currently BLE-only (`controller/src/main.cpp`) — the ESP-NOW TX side does not exist yet and is built from scratch here using the `espnow-rclink` protocol esp-fc expects natively.

**Two stale-doc conflicts, resolved:**
- **Motor output pins:** `TODO_july17.md`/`human_notes.md` say remap to 13/12/14/15 — that's wrong. Actual live wiring (confirmed in `main.py` `ESC_PINS` and `wiring.md`) is **FL=12, FR=14, BR=17, BL=16**. Use these.
- **MPU6050 INT pin:** conflicting between `wiring.md` (GPIO35) and `TODO_july17.md`/`human_notes.md` (GPIO27). Confirmed: **GPIO35**.

**Hard safety gate** (carried over from the "motor shot across room" incident in DEVLOG.md): no propellers go on until the new esp-fc + ESP-NOW control path is verified spinning the correct motor at the correct corner via Betaflight Configurator's Motors tab, with props still off.

## Current hardware state
- **Drone board is plugged into USB** (`/dev/cu.usbserial-0001`) — ready for Phase A.
- **Controller (WROOM-32U) is NOT plugged in yet.** Needed starting Phase B step 5 (flashing) — will be called out explicitly as a plug-in checkpoint when reached.

## Phase A — Drone: flash esp-fc, remap pins
1. `git clone https://github.com/rtlopez/esp-fc` into the project.
2. Read esp-fc's docs/CLI reference to confirm exact `set` param names for: motor output pins, I2C SDA/SCL, gyro INT pin, ESP-NOW receiver provider — confirm from source, don't guess.
3. Build for `esp32dev` (DevKitC V4) via PlatformIO, flash over `/dev/cu.usbserial-0001` — this **replaces MicroPython**.
4. Connect over serial CLI, apply:
   - Motor outputs: pin 0→12 (FL), pin 1→14 (FR), pin 2→17 (BR), pin 3→16 (BL)
   - I2C: SDA→21, SCL→22
   - Gyro INT→35
   - Receiver provider → ESP-NOW (not SPI Rx)
   - `save`
5. Sanity check over Betaflight Configurator: gyro/accel move sanely in the 3D view.

## Phase B — Controller: build ESP-NOW TX firmware
1. New PlatformIO env in `controller/platformio.ini` (e.g. `[env:esp32u_espnow]`) targeting the WROOM-32U + external antenna board, separate from the BLE gamepad env. `upload_port` filled in once plugged in (`ls /dev/cu.*` before/after).
2. Add `espnow-rclink` as a lib dependency — do not hand-roll the packet format, esp-fc expects this library's envelope.
3. New source `controller/src/main_espnow.cpp`: reuse ADC-read/deadzone/NVS-calibration pattern from `controller/src/main.cpp` (`readAxis`, `toAxis`, `loadCalibration`/`captureCalibration`), pack 4 axes into espnow-rclink's channel envelope (880-2120us, 8ch), transmit via the library's TX API. Default mapping: left stick Y=throttle, left stick X=yaw, right stick Y=pitch, right stick X=roll (Mode 2) — adjustable later in Configurator if backwards.
4. ESP-NOW LR mode: defer unless basic link doesn't work first (`WifiEspNow` may need a one-line patch per `CONTROLLER_PLAN.md`).
5. **Build + flash the WROOM-32U board — STOP AND PLUG IT IN when this step is reached.**

## Phase C — Controller-drone link + BF Configurator testing (props still OFF)
1. Flash + smoke-test the controller board standalone: confirm sane ADC readings and ESP-NOW packets sending without errors over its own serial monitor.
2. Bind controller TX MAC to the drone's esp-fc ESP-NOW receiver.
3. Connect Betaflight Configurator to the drone board:
   - Setup tab: gyro/accel sane with link live.
   - **Receiver tab:** move each physical stick, confirm right channel/direction/range/center. This is the real controller-drone connection proof.
   - Fix axis map/inversion in Configurator, not firmware, if backwards.
4. Motors tab (props OFF): spin each motor individually at low %, confirm FL/FR/BR/BL correct corner, controller link live.
5. Failsafe check: power off / range-out the controller briefly, confirm drone cuts/holds throttle low, doesn't hold last command.
6. Only after 3-5 pass: install props, correct CW/CCW per corner (FL/BR CW, FR/BL CCW), final low-throttle spin check with props on + controller connected.

## Verification checklist
- [ ] Controller serial log: sane ADC + ESP-NOW sends without errors
- [ ] Configurator connects, live gyro/accel data
- [ ] Receiver tab: all 4 axes track real stick movement correctly
- [ ] Motors tab (no props): correct pin→corner mapping, link live
- [ ] Failsafe behavior confirmed sane
- [ ] Props on: correct spin direction per corner, no unexpected vibration at idle

## Files touched
- New: `esp-fc/` (cloned build tree), `controller/src/main_espnow.cpp`
- Edited: `controller/platformio.ini` (new env), `CHECKPOINT_LAST.md`, `TASK_QUEUE.md`
- Replaced on-device (not deleted from repo): drone's MicroPython `main.py` superseded by esp-fc
