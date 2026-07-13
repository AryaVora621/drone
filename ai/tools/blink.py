"""
ESP32 DevKitC_V4 onboard-LED blink sanity test (GPIO2 = the blue LED).
Confirms the board boots MicroPython and the GPIO layer works end to end.
Run it with: python3 ai/tools/upload_usb.py /dev/cu.usbserial-0001 blink.py :blink.py
then soft-reset, or just `import blink` from the REPL.
"""
from machine import Pin
import time

led = Pin(2, Pin.OUT)

while True:
    led.toggle()
    time.sleep(0.5)
