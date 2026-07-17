# Drone Wiring Guide

Custom quadcopter: ESP32-DevKitC V4 + 4× A2212 2200KV + 4× SimonK 30A ESC + MPU6050 + HW-138B buck, off a custom PDB on a 3S LiPo. (The WROOM-32U is reserved for the later ranged ESP-NOW link phase.)

> **NO PROPELLERS during bench testing.** Motor torque at full throttle is dangerous. Always clamp/secure the motor.

---

## 0. Power rules (read first)

- **HW-138B output MUST be set to exactly 5.0V** (measured on a multimeter, no load) before connecting the ESP32. The ESP32's AMS1117-3.3 reg needs ~1V headroom (so ~4.3V min) but 5.0V is the sweet spot. 5.7V+ just makes the reg dump heat and risks cooking it if the trimmer drifts.
- **Never power the ESP32 from the buck AND USB at the same time.**
- **Clip/leave disconnected ALL FOUR ESC red BEC wires** for now. The HW-138B is the only ESP32 supply, so the BECs must not back-feed the 5V rail and fight the buck. (If you later want BEC redundancy, keep exactly ONE redconnected, never more than one.)
- Every signal needs a shared GND. All four ESC black wires + MPU6050 GND + ESP32 GND tie to the PDB ground bus.

---

## 1. Power architecture

```
3S LiPo (12.6V full, ~9V under load)
        |
     [custom PDB]
        |
        |-- unregulated rail --> 4× SimonK ESC power input (battery leads / XT60)
        |
        \-- HW-138B (trimmed to 5.0V) --> ESP32 5V pin (pin 1 / VIN)
```

---

## 2. ESP32-DevKitC V4 pin map

Solder to the DevKitC V4 header pins (not the bare module). The `5V`/VIN pin is the HW-138B feed.

| Pin | Function | Goes to |
|---|---|---|
| 5V / VIN | Power in | HW-138B 5.0V out |
| GND | Ground | PDB ground bus |
| GPIO14 | ESC1 signal (PWM) | ESC1 white (FL) |
| GPIO12 | ESC2 signal (PWM) | ESC2 white (FR) ⚠️ strapping: must be LOW at boot (signal line is hi-Z, fine) |
| GPIO17 | ESC3 signal (PWM) | ESC3 white (BR) |
| GPIO16 | ESC4 signal (PWM) | ESC4 white (BL) |
| GPIO21 | I2C SDA | MPU6050 SDA |
| GPIO22 | I2C SCL | MPU6050 SCL |
| GPIO27 | (optional) MPU6050 INT | MPU6050 INT |
| 3V3 | MPU6050 VCC | MPU6050 VCC |

---

## 3. ESC signal wiring (the "drivers")

Each SimonK ESC has a 3-wire JST/servo lead: **red = BEC 5V, white = signal, black = GND.**

| ESC | Motor position | White signal → GPIO | Black GND → | Red BEC |
|---|---|---|---|---|
| ESC1 | Front-Left (CW) | GPIO14 | GND bus | ✂ clipped |
| ESC2 | Front-Right (CCW) | GPIO12 | GND bus | ✂ clipped |
| ESC3 | Back-Right (CW) | GPIO17 | GND bus | ✂ clipped |
| ESC4 | Back-Left (CCW) | GPIO16 | GND bus | ✂ clipped |

> FINAL LAYOUT (2026-07-17): FL=14, FR=12, BR=17, BL=16. Both 16/17 are safe,
> non-strapping, non-LED GPIOs (UART2 defaults but UART2 unused). GPIO2 rejected
> (strapping + onboard LED). Direction (CW/CCW) fixed later by swapping 2 motor bullets.

- All four black GND wires tie together and solder to the ESP32 GND (common reference).
- All four white signal wires go to their GPIO above.
- All four red BEC wires **left disconnected / clipped** (HW-138B powers the ESP32).

---

## 4. MPU6050 (GY-521, 8-pin)

| MPU6050 pin | → ESP32-DevKitC V4 |
|---|---|
| VCC | 3V3 |
| GND | GND bus |
| SDA | GPIO21 |
| SCL | GPIO22 |
| INT | GPIO35 |
| XDA / XCL / AD0 | leave unconnected (AD0 low = address 0x68) |

- **Soft-mount the MPU6050** with thick double-sided foam tape. A2212 motors vibrate hard; stiff wires transmit that straight into the gyro and wreck PID readings.
- Use short (<5cm), flexible silicone wire to the sensor.

---

## 5. Pulse mapping (firmware)

SimonK default range is **1060-1860 us**, NOT 1000-2000. Use `duty_u16()`, never `duty_ns()`.

```
us_to_duty(us) = int(us * 65535 // 20000)   # 50Hz period = 20000us

ESC1 (GPIO13): pulse_us = 1060 + value * 8     # 0→1060 (off), 100→1860 (full)
ESC2 (GPIO12): same
ESC3 (GPIO14): same
ESC4 (GPIO15): same
```

- **Arming:** hold 1060us for 3s on every ESC at boot. No calibration sequence (calibration corrupts ESC endpoints — the "motor shot across room" incident).
- If an ESC ever gets a bad range: disconnect LiPo, wait 10s, reconnect → factory defaults.

---

## 6. Bench test plan (no props)

1. HW-138B confirmed 5.0V on meter (no load). ESP32 boots.
2. Continuity check: all GNDs common; no red BEC on the 5V bus; signal wires isolated from GND/12V.
3. Plug LiPo; each ESC beeps (arm tone). ESP32 holds 1060us 3s.
4. Spin ONE motor at a time, 0→30%, holding the motor. Repeat for ESC1-4.
5. I2C scan for MPU6050 at `0x68` before any flight code.
6. Confirm slider 0 = silent stop on all four.

---

## 7. Known traps (from DEVLOG)

- WPA3 SSID hangs the ESP32 → use `Bhupendra Patel_8G` (WPA2).
- `duty_ns()` unreliable at 50Hz → use `duty_u16()`.
- Boot calibration corrupts ESC range → arming-only, never calibrate.
- Serial wedge (AppleUSBSLCOM) → physical USB replug.
- Web loop swallows Ctrl+C → hardware reset + Ctrl+C burst in arming window.
- 40% cutoff on DIY 18650 pack was a BMS trip, not firmware → use the real 3S LiPo.
