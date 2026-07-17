# Drone Controller (v1 — BLE gamepad)

ESP32 reading two joysticks (4 analog axes) and presenting as a standard
Bluetooth LE gamepad. Built with PlatformIO. See `../CONTROLLER_PLAN.md`
for the full design and the deferred ESP-NOW phase.

## Hardware

| Signal | ESP32 pin | Notes |
|---|---|---|
| Left stick X  | GPIO32 | ADC1 |
| Left stick Y  | GPIO33 | ADC1 |
| Right stick X | GPIO34 | ADC1, input-only |
| Right stick Y | GPIO35 | ADC1, input-only |
| LED           | GPIO2  | onboard |

**Joystick VCC must be 3.3V.** The ADC maximum is 3.3V; 5V on these pins
damages them.

## Build & flash

```
cd controller
pio run -t upload          # builds + flashes to upload_port in platformio.ini
pio device monitor          # 115200 baud serial for debug
```

`upload_port` in `platformio.ini` is set to `/dev/cu.SLAB_USBtoUART`,
the board that is NOT the drone (the drone is `/dev/cu.usbserial-0001`,
which runs `main.py` — do not flash it). If your controller enumerates on a
different port, change `upload_port` before uploading.

## Calibration

On first boot the sticks are mapped relative to their resting centers. To
recalibrate, hold both sticks at rest and send `c` in the serial monitor
(115200 baud). The centers are then saved to NVS and persist across reboots.

## How to connect (pairing)

1. Power the controller. It advertises BLE as **"Drone Controller"**.
2. **Windows:** Settings -> Bluetooth -> Add device -> pick it. Verify in
   `joy.cpl` or a browser tester (gamepad-tester.com); move sticks, watch axes.
3. **Android:** pair in Bluetooth; works (trigger axes map differently).
4. **macOS / Linux:** limited/flaky — use Windows or Android to test.
5. **iOS:** not supported by this library.

## Status LED

- Blinking: advertising, no host connected.
- Solid: connected to a host.
