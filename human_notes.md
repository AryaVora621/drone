# Human Notes

## Frame / props
- https://www.thingiverse.com/thing:3044786/files (Peon230 frame source)
- Front-Left and Rear-Right motors spin clockwise. Front-Right and Rear-Left spin counter-clockwise.
- Need 2 different facing props (CW + CCW) on the diagonal layout.

## Power
- HW-138B buck tuned to 4.95V (target 5.0V). Feeds ESP32 5V pin. ESP32 3V3 reg powers MPU6050.
- All 4 ESC BEC red wires clipped — buck is sole ESP32 supply.

## Flight stack decision (pending)
- esp-fc (Betaflight-compatible, rtlopez) is the leading candidate. NOT official Betaflight —
  it mimics BF and uses the BF Configurator but is a separate firmware flashed over MicroPython.
- If esp-fc: remap motor pins to 13/12/14/15, I2C 21/22, INT 27.
- Alternative: custom PID firmware (full control, more work). Or other ESP32 FC firmware.

## Controller decision (pending)
- Current: BLE gamepad (works). Future: ESP-NOW link to drone.
- Options: BLE-only / ESP-NOW-only / dual-boot BLE+ESP-NOW.
