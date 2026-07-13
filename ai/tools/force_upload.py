#!/usr/bin/env python3
"""
Aggressively interrupts a running MicroPython loop and uploads files via raw REPL.
Workaround for `except Exception: pass` swallowing Ctrl+C in the web server loop.
Usage: python3 force_upload.py /dev/cu.SLAB_USBtoUART file1.py:dest1.py file2.py:dest2.py
"""
import serial, time, sys, os

PORT = sys.argv[1]
FILES = []
for arg in sys.argv[2:]:
    src, dst = arg.split(':')
    FILES.append((src, dst))

print(f"Connecting to {PORT}...")
s = serial.Serial(PORT, 115200, timeout=0.5)
time.sleep(0.2)

print("Hammering Ctrl+C to break out of running loop...")
for _ in range(30):
    s.write(b'\r\x03\x03')
    time.sleep(0.05)

time.sleep(0.3)
resp = s.read(512).decode('utf-8', errors='replace')
if '>>>' not in resp:
    # Try a soft reset to get to REPL
    s.write(b'\r\x04')
    time.sleep(2)
    resp = s.read(512).decode('utf-8', errors='replace')

if '>>>' not in resp:
    print("ERROR: Could not reach REPL. Response:", repr(resp))
    s.close()
    sys.exit(1)

print("Got REPL prompt.")

def raw_repl_exec(s, code):
    s.write(b'\x01')  # Enter raw REPL
    time.sleep(0.1)
    s.write(code.encode() + b'\x04')  # Send code + Ctrl+D to execute
    time.sleep(0.5)
    s.read(4096)  # Drain output
    s.write(b'\x02')  # Exit raw REPL

def upload_file(s, src_path, dst_name):
    with open(src_path, 'rb') as f:
        data = f.read()
    print(f"Uploading {src_path} -> {dst_name} ({len(data)} bytes)...")
    # Write in chunks via raw REPL
    chunk_size = 512
    raw_repl_exec(s, f"f = open('{dst_name}', 'wb')")
    for i in range(0, len(data), chunk_size):
        chunk = data[i:i+chunk_size]
        raw_repl_exec(s, f"f.write({repr(chunk)})")
    raw_repl_exec(s, "f.close()")
    print(f"  Done.")

for src, dst in FILES:
    upload_file(s, src, dst)

print("Resetting board...")
raw_repl_exec(s, "import machine; machine.reset()")
s.close()
print("All done. Board is resetting.")
