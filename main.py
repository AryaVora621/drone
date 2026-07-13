import network, socket, time, gc
from machine import Pin, PWM

# ---------- CONFIG ----------
SSID = "Bhupendra Patel_8G"   # _8G = WPA2 2.4GHz SSID the ESP32 can join (plain name hung at WPA3 auth)
PASSWORD = "9833359932ni"
ESC_PIN = 13            # GPIO13 = D13, PWM-capable (confirmed in roboPet)
STATUS_LED_PIN = 2      # onboard blue LED
FREQ = 50
BIDIRECTIONAL = True    # True mapping: 0→1460us(stop), 100→1860us(full).
                       # Uses duty_u16 at 50Hz. The ESC must be power-cycled
                       # (disconnect LiPo, wait 5s, reconnect) for clean default range.

# Pulse map (microseconds). SimonK ESC default range is 1060-1860 us.
# Bidirectional (car/boat): -100=1060us, 0=1460us(stop), 100=1860us
# Air (forward-only):       0=1060us(off), 100=1860us; reverse clamped to 0
# Flip BIDIRECTIONAL after you confirm which ESC you actually have.

# WIRING (learned the hard way in roboPet: reverse polarity killed a DevKit):
#  - ESC gets its OWN battery power. NEVER feed it from the ESP32 5V pin.
#  - Connect ESC signal wire -> GPIO13, ESC GND -> ESP32 GND (shared reference).
#  - Double-check polarity before applying ESC power. Reverse VCC/GND = dead board.
#  - Don't feed the ESC's BEC 5V back into the ESP32 while it's on USB.

pwm = PWM(Pin(ESC_PIN), freq=FREQ)
status_led = Pin(STATUS_LED_PIN, Pin.OUT)
status_led.value(0)


def us_to_duty(pulse_us):
    """Convert pulse width in microseconds to ESP32 duty_u16 value at 50Hz.
    Period = 20,000 us, so duty = pulse_us / 20000 * 65535."""
    return int(pulse_us * 65535 // 20000)

PULSE_MIN_US = 1060   # SimonK default minimum (off / full reverse)
PULSE_MAX_US = 1860   # SimonK default maximum (full forward)
PULSE_MID_US = 1460   # midpoint of SimonK range (neutral/stop)

def set_throttle(value):
    value = int(value)
    if BIDIRECTIONAL:
        value = max(-100, min(100, value))
        pulse_us = PULSE_MID_US + value * 4   # -100→1060, 0→1460, 100→1860
    else:
        value = max(0, min(100, value))
        pulse_us = PULSE_MIN_US + value * 8   # 0→1060, 100→1860
    pwm.duty_u16(us_to_duty(pulse_us))
    return value


def run_calibration():
    """Teach the ESC endpoints: send a pulse above max to enter calibration
    mode, then drop to minimum. The ESC saves the range.
    Only needed if the ESC has stale calibration from other hardware.
    The motor may briefly twitch — no prop, hold steady."""
    CAL_MAX_US = 1940
    print("Calibration:", CAL_MAX_US, "us for 2 s...")
    pwm.duty_u16(us_to_duty(CAL_MAX_US))
    time.sleep(2)
    print("Calibration:", PULSE_MIN_US, "us for 3 s...")
    pwm.duty_u16(us_to_duty(PULSE_MIN_US))
    time.sleep(3)
    set_throttle(0)
    print("Calibration done.")


# ---------- ARMING ----------
# Set minimum throttle (1060us) and wait for ESC to arm.
# SimonK default range (1060-1860us) works out of the box — no calibration needed.
# Power the ESC anytime during or after this window.

pwm.duty_u16(us_to_duty(PULSE_MIN_US))
print("ARMING:", PULSE_MIN_US, "us — waiting 3 s for ESC to arm")
print(">>> Power the ESC now if not already powered <<<")
time.sleep(3)
print("ESC armed. Starting WiFi and server.")
set_throttle(0)


# ---------- WIFI ----------
def wifi_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    print("Connecting to Wi-Fi...")
    while not wlan.isconnected():
        status_led.value(not status_led.value())   # blink while connecting
        time.sleep(0.2)
    status_led.value(1)                            # solid once connected
    print("Connected. IP:", wlan.ifconfig()[0])


wifi_connect()

# ---------- WEBREPL (serial-free future uploads) ----------
try:
    import webrepl
    import hashlib
    try:
        open('webrepl_cfg.py')
    except OSError:
        with open('webrepl_cfg.py', 'w') as f:
            pw = hashlib.sha256(b'drone').digest()
            f.write('PASS = ' + repr(pw) + '\n')
    webrepl.start()
    print("WebREPL ready — connect via webrepl_cli.py or browser at ws://" +
          network.WLAN(network.STA_IF).ifconfig()[0] + ":8266")
except Exception as e:
    print("WebREPL not available:", e)


# ---------- WEB SERVER ----------
HTML = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESC Control</title><style>
body{background:#121212;color:#e0e0e0;font-family:sans-serif;text-align:center;margin-top:8vh}
input[type=range]{width:80%;height:60px}
#val{font-size:3em;font-weight:bold;color:#4caf50}
button{margin-top:20px;padding:12px 30px;font-size:1.2em;background:#b71c1c;color:#fff;border:0;border-radius:8px}
.dir{color:#90a4ae}</style></head><body>
<h2>Brushless ESC Throttle</h2>
<div id="val">0</div><div class="dir" id="dir">Stop</div>
<input type="range" min="0" max="100" value="0" id="slider">
<br><button onclick="stop()">STOP (Neutral)</button>
<button onclick="calibrate()" id="cal_btn" style="background:#1565c0">Calibrate Motor</button>
<span id="cal_status" style="margin-left:12px;color:#90caf9"></span>
<script>
const s=document.getElementById('slider'),v=document.getElementById('val'),d=document.getElementById('dir');
const st=document.getElementById('cal_status'),cb=document.getElementById('cal_btn');
const label=x=>x>0?'Forward':'Stop';
const send=x=>fetch('/set?value='+x).catch(()=>{});
s.oninput=()=>{v.textContent=s.value;d.textContent=label(+s.value);send(s.value);};
function stop(){s.value=0;v.textContent='0';d.textContent='Stop';send(0);}
async function calibrate(){
  cb.disabled=true;st.textContent='Calibrating... wait 5s';
  await fetch('/calibrate').catch(()=>{st.textContent='Calibration failed — retry';cb.disabled=false;return;});
  st.textContent='Done! Test with slider.';
  setTimeout(()=>{st.textContent='';cb.disabled=false;},4000);
}
</script></body></html>"""


def parse_value(request_line):
    # The request target is the MIDDLE token, not the first "GET" token.
    # "GET /set?value=50 HTTP/1.1" -> split(' ')[1] = "/set?value=50"
    parts = request_line.split(' ')
    target = parts[1] if len(parts) >= 2 else '/'
    i = target.find('value=')
    if i < 0:
        return 0
    raw = target[i + 6:].split(' ')[0].split('&')[0]
    try:
        return int(raw)
    except Exception:
        return 0


addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(5)
print("Server listening on http://" + network.WLAN(network.STA_IF).ifconfig()[0])

current = 0
while True:
    try:
        cl, _ = s.accept()
        cl.settimeout(2.0)
        req = cl.recv(1024).decode('utf-8')
        request_line = req.split('\r\n')[0]
        if '/calibrate' in request_line:
            run_calibration()
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK: calibration done")
        elif '/set' in request_line:
            current = set_throttle(parse_value(request_line))
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK: " + str(current))
        else:
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n" + HTML)
        cl.close()
        gc.collect()
    except Exception as e:
        print("server error:", e)
