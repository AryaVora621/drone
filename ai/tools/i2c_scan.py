# i2c_scan.py — run on the drone DevKitC V4 to confirm MPU6050 is wired correctly.
# Upload this ALONE (before main.py) so you isolate "is the MPU alive" from motors.
# Expected: MPU6050 shows up at 0x68 (or 0x69 if AD0 is pulled high).
from machine import Pin, I2C
import time

# MPU6050: SDA=21, SCL=22 (matches wiring.md)
i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=400000)

print("Scanning I2C bus...")
devices = i2c.scan()
if devices:
    for d in devices:
        print("Found device at 0x%02X" % d)
    if 0x68 in devices:
        print("MPU6050 detected at 0x68 — wiring OK ✅")
    elif 0x69 in devices:
        print("Device at 0x69 — MPU6050 with AD0 high. Wiring OK, address differs.")
    else:
        print("Device(s) found but not the MPU6050. Check SDA/SCL.")
else:
    print("NO devices found. Check VCC(3V3)/GND/SDA(21)/SCL(22) and that MPU is powered.")
