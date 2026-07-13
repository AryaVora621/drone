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

## Current state (Jul 13, 2026)

ESP32 DevKitC V4 running MicroPython v1.28.0, connected via WiFi to a local hotspot.
A web dashboard with a throttle slider is the current control interface. The motor spins
forward, throttle responds smoothly. Bench testing is active.

### Hardware

| Part | Notes |
|---|---|
| ESP32-DevKitC V4 | ESP32-D0WD-V3, MicroPython v1.28.0 |
| A2212 2200KV brushless motor | 3S LiPo (11-13V), no prop for bench testing |
| SimonK 30A ESC | Forward-only aircraft ESC. Default range 1060-1860us |
| 3S LiPo battery | Powers the ESC/motor. ESP32 on USB (separate) |

### Wiring

- ESP32 GPIO13 (PWM) to ESC signal
- ESP32 GND to ESC GND
- ESC power wires to LiPo battery (3S, 11-13V)
- ESC BEC red wire disconnected (ESP32 on USB power)

## Phase 1 — Bench test (current)

- [x] Flash MicroPython to ESP32
- [x] Generate 50Hz PWM on GPIO13 with controllable pulse width
- [x] Serve control UI over WiFi (dark-theme web dashboard)
- [x] Get motor spinning under web slider control
- [x] Identify SimonK pulse range (1060-1860us) and correct mapping
- [x] Remove boot calibration (was corrupting ESC endpoints)
- [ ] Verify STOP at slider 0 is always reliable
- [ ] ESC-NOW POC: establish a two-ESP32 ESP-NOW link on the bench

### Current known issues

- Do NOT click the "Calibrate Motor" button — it re-corrupts the ESC's stored
  endpoints. The ESC works with factory defaults.
- If the ESC ever gets corrupted, LiPo power-cycle (disconnect battery, wait 10s,
  reconnect) restores factory defaults.
- WebREPL isn't available in this MicroPython build (ESP32_GENERIC). Serial upload
  with 256-byte chunks is the update path. Future: reflash ESP32_GENERIC-OTA.

## Phase 2 — ESP-NOW controller link

- [ ] Create a separate `controller/` project for a second ESP32 with a joystick/pot
- [ ] Implement ESP-NOW send on the controller ESP32
- [ ] Implement ESP-NOW receive on the drone ESP32
- [ ] Map controller analog input to throttle value (0-100)
- [ ] Add failsafe: if no ESP-NOW packet received for 500ms, cut throttle to 0
- [ ] Remove WiFi hotspot dependency entirely

The ESP-NOW link replaces the web dashboard for flight. The web dashboard stays as a
bench-test fallback (accessible over USB-serial REPL or WiFi when in bench mode).

### ESP-NOW packet format (proposed)

```
struct.pack("<BH", drone_id, throttle_value)
```

- 3 bytes per packet (1 byte drone ID + 2 byte throttle)
- Drone ID 0 = broadcast, 1-255 = addressed
- Throttle 0-1000 (scaled from 0 to 65535 duty)
- Sender MAC is implicit authentication

## Phase 3 — Full drone frame

- [ ] Mount ESC and motor on a drone frame
- [ ] Add propellers (after ALL bench testing is conclusive)
- [ ] Balance props
- [ ] Maiden flight test
- [ ] Iterate on PID tuning, responsiveness, range

## Phase 4 — Expansion (future ideas)

- Multi-motor support (quadcopter: 4x ESP-NOW addressed channels)
- RSSI-based return-to-home if signal drops
- Onboard sensor logging (MPU6050 via I2C)
- Battery voltage telemetry back over ESP-NOW
