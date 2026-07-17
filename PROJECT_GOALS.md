# Drone Project — Goals & Roadmap

## The big picture

A custom drone built around an ESP32, driven by a brushless motor via a SimonK 30A ESC.
The control link uses **ESP-NOW** for low-latency, connectionless communication between
a controller (joystick/transmitter ESP32) and the drone itself.

ESP-NOW is the right choice here over WiFi because:

- **Latency:** ESP-NOW packets go direct, no TCP/IP stack, no handshakes. For throttle
  response mid-flight, every millisecond matters.
- **One-to-many:** A single controller ESP32 can broadcast to multiple drone ESP32s
  simultaneously (for multirotor).
- **Reliability:** Acknowledged delivery with configurable retry, without the overhead
  of TCP.
- **Range:** ESP-NOW can reach 200m+ with external antennas, comparable to 2.4GHz RC
  links.

## Current state (Jul 14, 2026)

ESP32 DevKitC V4 running MicroPython v1.28.0, connected via WiFi to a local hotspot.
A web dashboard with a throttle slider is the current control interface. The motor spins
forward, throttle responds smoothly. Bench testing is active (no prop). The controller
design is locked (see `CONTROLLER_PLAN.md`): v1 = BLE gamepad, ESP-NOW deferred.

### Hardware

| Part | Notes |
|---|---|
| ESP32-DevKitC V4 | ESP32-D0WD-V3, MicroPython v1.28.0 (bench) |
| 2x ESP32-WROOM-32U | Owned. U.FL external-antenna variant for ranged ESP-NOW phase |
| Laptop WiFi antenna (U.FL) | Owned. 2.4GHz/50 Ohm, plugs straight into -U |
| A2212 2200KV brushless motor | 3S LiPo (11-13V), no prop for bench testing |
| SimonK 30A ESC | Forward-only aircraft ESC. Default range 1060-1860us |
| 3S LiPo battery | Buy: ~2200-3000mAh 80C, XT60 + JST-XH (replaces DIY 18650 pack) |

### Wiring
- ESP32 GPIO13 (PWM) to ESC signal
- ESP32 GND to ESC GND
- ESC power wires to LiPo battery (3S, 11-13V)
- ESC BEC red wire disconnected (ESP32 on USB power)

## Phase1 — Bench test (done)
- [x] Flash MicroPython to ESP32
- [x] Generate 50Hz PWM on GPIO13 with controllable pulse width
- [x] Serve control UI over WiFi (dark-theme web dashboard)
- [x] Get motor spinning under web slider control
- [x] Identify SimonK pulse range (1060-1860us) and correct mapping
- [x] Remove boot calibration (was corrupting ESC endpoints)
- [x] Diagnose 40% cutoff (DIY 18650 BMS over-current trip) + idle beep (LVC)
- [ ] Verify STOP at slider 0 is always reliable

### Current known issues
- Do NOT click the "Calibrate Motor" button — it re-corrupts the ESC's stored
  endpoints. The ESC works with factory defaults.
- If the ESC ever gets corrupted, LiPo power-cycle (disconnect battery, wait 10s,
  reconnect) restores factory defaults.
- WebREPL isn't available in this MicroPython build (ESP32_GENERIC). Serial upload
  with 256-byte chunks is the update path. Future: reflash ESP32_GENERIC-OTA.

## Controller — design & phases

The controller is a second ESP32 reading two joysticks (4 analog axes) and
talking to the drone. Delivery is split into two phases (see `CONTROLLER_PLAN.md`
for the full session arc and pairing steps).

### v1 — BLE gamepad (current)
- Build: PlatformIO. Library: `lemmingDev/ESP32-BLE-Gamepad` + `h2zero/NimBLE-Arduino`.
- Presents as a standard Bluetooth LE gamepad (HID). Pair from PC/phone; no drone link yet.
- Pins: LX=GPIO32, LY=GPIO33, RX=GPIO34, RY=GPIO35 (all ADC1). Joystick VCC = 3.3V only.
- First-boot center calibration stored in NVS; ~5% deadzone. Axes: x=LX, y=LY, z=RX, rz=RY (range 0..32767).
- No buttons (config disables them). Device name "Drone Controller".
- Hardware: existing DevKitC V4 is fine for v1 (BLE range is adequate).

### v2 — ESP-NOW link (deferred)
- Port `rtlopez/espnow-rclink` TX with the 4-ADC reader (replace its PPM reader on GPIO13).
- Interim `rx_test` receiver (library `rx.cpp`) validates the link + RSSI before ESP-FC exists.
- Final drone end: flash ESP-FC on an ESP32-WROOM-32U, set Receiver = built-in SPI Rx; controller TX unchanged.
- Hardware: ESP32-WROOM-32U + U.FL laptop antenna on both ends; enable ESP-NOW LR mode (~400m).
- Packet format is defined by espnow-rclink (8 ch, 880-2120us) — do NOT hand-roll.

### Pairing / connect (v1)
Power controller -> it advertises "Drone Controller". Windows: Settings -> Bluetooth -> Add device; verify in `joy.cpl` or gamepad-tester.com. Android works; macOS/Linux limited; iOS unsupported.

## Phase3 — Full drone frame
- [ ] Mount ESC and motor on a drone frame
- [ ] Add propellers (after ALL bench testing is conclusive)
- [ ] Balance props
- [ ] Maiden flight test
- [ ] Iterate on PID tuning, responsiveness, range

## Phase4 — Expansion (future ideas)
- Multi-motor support (quadcopter: 4x ESP-NOW addressed channels)
- RSSI-based return-to-home if signal drops
- Onboard sensor logging (MPU6050 via I2C)
- Battery voltage telemetry back over ESP-NOW
