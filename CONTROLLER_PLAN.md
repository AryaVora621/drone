# Controller Design & Session Log

This document captures the work session that designed the drone's wireless
controller, and locks the v1 implementation plan. It is the single source of
truth for controller decisions; motor/bench issues live in `DEVLOG.md`.

## Session arc (what we did and decided)

1. **Motor cutout at >40% throttle with a prop mounted.** Symptom: motor spun
   fine on the bench (no prop), but above ~40% with a 5in tri-blade prop it cut
   out. Dashboard stayed up, motor went silent (no beep). Diagnosed as the
   **DIY 3x18650 pack's BMS over-current trip** under prop load — not firmware,
   not an ESP32 reset (dashboard was still live), not LVC (silent, no beep).
   Replugging the battery resets the BMS latch. Recorded as `DEVLOG.md` Issue 9.
   The idle beeping after replug is **LVC** (low cell voltage) — Issue 10.

2. **Parts list.** Created and refined `~/Desktop/globalPartsList.txt` as a
   cross-project *buy-only* list. Drone buys: 3S ~2200-3000mAh 80C LiPo
   (XT60 + JST-XH balance), balance charger, 5030 two-blade props (the 5in
   tri-blade overprops the A2212 2200KV), PDB/XT60 harness for 4 ESCs, and a
   >=2A boost for the Pi Zero 2W (also covers the ESP32). Owned items removed.
   Safety note kept: 10S FTC packs (~37V) are incompatible and would destroy the
   3S ESC/motor — never connect.

3. **Controller IO.** Two joysticks = 4 analog axes. Pins chosen on **ADC1**
   only (ADC2 breaks under radio): LX=GPIO32, LY=GPIO33, RX=GPIO34, RY=GPIO35.
   GPIO34/35 are input-only. **Joystick VCC must be 3.3V** (ADC max is 3.3V;
   5V destroys the pin). No buttons requested.

4. **ESP-FC + ranged-link research.** ESP-FC (rtlopez/esp-fc) has a **native
   ESP-NOW receiver**; the author ships `espnow-rclink` (8-ch ESP-NOW library
   with auto-pairing, 880-2120us envelope) and `espnow-rclink-tx` (a reference
   TX that reads **PPM on GPIO13** and transmits 8 channels). Our controller has
   no PPM source, so "port espnow-rclink-tx" means keeping the library's
   protocol/pairing but replacing the PPM reader with our 4-ADC reader. For
   ESP-FC, select *"SPI Rx (e.g. built-in Rx)"* as receiver mode; it auto-binds.

5. **ESP32-WROOM-32U + laptop antenna.** The -U has a U.FL/IPEX connector
   (50 Ohm). A laptop WiFi antenna is 2.4GHz/50 Ohm and **U.FL here, so it plugs
   straight in** (no adapter). External antenna gives a large RSSI gain
   (-95 -> -75 dBm reported) and, with ESP-NOW LR mode, ~400m open-field range
   between two externally-antenna'd ESP32s. Our existing DevKitC V4 has only a
   PCB antenna (can't take external). Both -U boards are owned.

6. **v1 scope decision.** User chose: **v1 = BLE gamepad only, no ESP-NOW yet.**
   The controller presents as a standard Bluetooth LE gamepad you pair from a
   PC/phone; the ESP-NOW drone link is deferred to a later phase. Build tool =
   **PlatformIO** (espnow-rclink is PlatformIO-native; BLE library also ships a
   PlatformIO CI badge).

## v1 Design — BLE Gamepad Controller

- **Build tool:** PlatformIO.
- **Library:** `lemmingDev/ESP32-BLE-Gamepad@^0.7.3` + `h2zero/NimBLE-Arduino@~2.2.1`.
- **Pins:** LX=GPIO32, LY=GPIO33, RX=GPIO34, RY=GPIO35 (all ADC1). VCC = 3.3V.
- **Calibration:** on first boot, capture each stick's center into NVS
  (`Preferences`) as neutral; apply ~5% deadzone around it.
- **Axis mapping (Windows-friendly):** `x`=LX(32), `y`=LY(33), `z`=RX(34),
  `rz`=RY(35). Library default range since v5 is 0..32767 (mid 16383).
- **No buttons** — `BleGamepadConfiguration` disables buttons/hat/special so it
  presents as a pure 4-axis pad.
- **Device name:** "Drone Controller".
- **Status LED (GPIO2):** blink while advertising, solid when connected
  (`bleGamepad.isConnected()`).
- **Report rate:** ~50 Hz (driven by a timer / `delay(20)`), not every loop.
- **Hardware for v1:** the existing DevKitC V4 is fine (BLE range is adequate
  indoors/bench). The ESP32-U + laptop antenna stay reserved for the ESP-NOW phase.

### How to connect (pairing) — v1
1. Flash + power the controller. It advertises BLE as **"Drone Controller"**.
2. **Windows:** Settings -> Bluetooth -> Add device -> pick it. Verify in
   `joy.cpl` or a browser tester (gamepad-tester.com); move sticks, watch axes.
3. **Android:** pair in Bluetooth; works (trigger axes map differently).
4. **macOS / Linux:** limited/flaky support — do not rely on for testing.
5. **iOS:** not supported by this library (no MFi).

## Deferred phases

- **ESP-NOW TX (was "Phase2"):** port `espnow-rclink` TX with the 4-ADC
  reader (replace its PPM input). Build an interim `rx_test` receiver (library's
  `rx.cpp`) on the second ESP32-U to validate the link + RSSI before ESP-FC
  exists. Flash ESP-FC on the drone ESP32-U with built-in SPI Rx; controller TX
  unchanged. Enable ESP-NOW LR mode on both ends.
  - **Gotcha:** `espnow-rclink` uses `yoursunny/WifiEspNow`, which may not
    expose LR mode by default — may need a one-line `esp_wifi_set_protocol()`
    patch after init. Defer until the basic link works.
  - **Do NOT hand-roll** the packet format; ESP-FC expects espnow-rclink's.

## Risks / gotchas
- Joystick VCC must be 3.3V (5V kills the ADC pin).
- macOS BLE HID gamepad recognition is flaky; use Windows or Android to test.
- ESP-NOW LR mode may need a WifiEspNow patch.
- Set a fixed WiFi channel on both ends for ESP-NOW (matching channel required).
