import serial, time, sys

def upload(port, local_path, pico_path):
    with open(local_path, 'r') as f:
        content = f.read()
    
    s = serial.Serial(port, 115200, timeout=2)
    time.sleep(0.5)
    s.reset_input_buffer()
    
    # Break out of running program
    for _ in range(10):
        s.write(b'\x03')
        time.sleep(0.05)
    time.sleep(0.3)
    s.reset_input_buffer()
    
    # Enter raw REPL
    s.write(b'\x01')
    time.sleep(0.2)
    s.read(4096)
    
    # Send write command + content
    payload = f"f=open('{pico_path}','w');f.write({repr(content)});f.close()"
    s.write(payload.encode())
    s.write(b'\x04')
    time.sleep(2)
    
    resp = s.read(8192)
    print(resp.decode('utf-8', 'replace'))
    
    # Exit raw REPL
    s.write(b'\x02')
    time.sleep(0.2)
    s.close()
    print(f"Uploaded {local_path} -> {pico_path}")

if __name__ == '__main__':
    upload(sys.argv[1], sys.argv[2], sys.argv[3])
