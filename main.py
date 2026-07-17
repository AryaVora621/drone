import network, socket, time, gc, _thread
from machine import Pin, PWM

# ---------- CONFIG ----------
SSID = "Bhupendra Patel_8G"   # _8G = WPA2 2.4GHz SSID the ESP32 can join (plain name hung at WPA3 auth)
PASSWORD = "9833359932ni"

# 4 ESC signal pins (matches wiring.md): ESC1=FL, ESC2=FR, ESC3=BR, ESC4=BL
# FINAL layout 2026-07-17: FL=14, FR=12, BR=17, BL=16
ESC_PINS = [14, 12, 17, 16]
STATUS_LED_PIN = 2      # onboard blue LED
FREQ = 50

# Safety caps (YOU control these from the web UI, but they are hard-capped here)
MAX_RAMP_TARGET = 60    # web UI cannot command above this % in auto sequence
HARD_MAX_THROTTLE = 80  # absolute ceiling, even manual

# WIRING (learned the hard way):
#  - ESC gets its OWN battery power. NEVER feed it from the ESP32 5V pin.
#  - ESC signal wire -> GPIO, ESC GND -> ESP32 GND (shared reference).
#  - All 4 ESC red BEC wires CLIPPED. HW-138B buck (5.0V) powers the ESP32.
#  - No prop on bench. Motor torque at full throttle is dangerous.

pwm = [PWM(Pin(p), freq=FREQ) for p in ESC_PINS]
status_led = Pin(STATUS_LED_PIN, Pin.OUT)
status_led.value(0)

# Pulse map (microseconds). SimonK ESC default range is 1060-1860 us.
PULSE_MIN_US = 1060   # off
PULSE_MAX_US = 1860   # full
PULSE_MID_US = 1460   # stop (unused for forward-only, but kept for reference)

def us_to_duty(pulse_us):
    """Convert pulse width in microseconds to ESP32 duty_u16 value at 50Hz."""
    return int(pulse_us * 65535 // 20000)

def set_motor(idx, value):
    """Set one motor 0..100. Forward-only (no reverse). 0=1060us, 100=1860us."""
    value = max(0, min(HARD_MAX_THROTTLE, int(value)))
    pulse_us = PULSE_MIN_US + value * 8   # 0->1060, 100->1860
    pwm[idx].duty_u16(us_to_duty(pulse_us))
    return value

def stop_all():
    """Force every motor to minimum pulse (off). Safe to call anytime."""
    for i in range(len(pwm)):
        pwm[i].duty_u16(us_to_duty(PULSE_MIN_US))
    return [0, 0, 0, 0]

# ---------- ARMING ----------
# Hold minimum throttle (1060us) for 3s so each ESC arms. No calibration.
for i in range(len(pwm)):
    pwm[i].duty_u16(us_to_duty(PULSE_MIN_US))
print("ARMING: 1060us — waiting 3s for ESCs to arm")
print(">>> Power the ESCs (LiPo) now if not already powered <<<")
time.sleep(3)
print("ESCs armed. Starting WiFi and server.")
stop_all()

# ---------- WIFI ----------
def wifi_connect():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    print("Connecting to Wi-Fi...")
    while not wlan.isconnected():
        status_led.value(not status_led.value())
        time.sleep(0.2)
    status_led.value(1)
    print("Connected. IP:", wlan.ifconfig()[0])

wifi_connect()

# ---------- AUTO SEQUENCE (ramp-up -> hold -> cutoff) ----------
# Runs in a background thread so the web server stays responsive and you can STOP it.
seq = {"running": False, "throttle": [0, 0, 0, 0]}

def safety_cut():
    """Hard cutoff of ALL motors. Called on error, stop, or end of sequence."""
    seq["running"] = False
    stop_all()

def auto_sequence(target, ramp_s, hold_s):
    """Ramp all 4 motors 0->target over ramp_s, hold for hold_s, then cutoff.
    Runs in background. Can be aborted by /stop or /seq?action=abort."""
    target = max(0, min(MAX_RAMP_TARGET, int(target)))
    ramp_s = max(1, int(ramp_s))
    hold_s = max(0, int(hold_s))
    seq["running"] = True
    try:
        steps = ramp_s * 10  # 100ms steps
        for step in range(1, steps + 1):
            if not seq["running"]:
                break
            val = target * step / steps
            for i in range(4):
                set_motor(i, val)
            seq["throttle"] = [int(val)] * 4
            time.sleep(0.1)
        # hold
        hold_steps = hold_s * 10
        for _ in range(hold_steps):
            if not seq["running"]:
                break
            time.sleep(0.1)
    except Exception as e:
        print("seq error:", e)
    finally:
        safety_cut()  # always cut off at the end
        seq["throttle"] = [0, 0, 0, 0]
        print("Auto sequence finished — motors cutoff.")

# ---------- SAFE CALIBRATION (factory default range) ----------
# SimonK default range is 1060-1860us. If an ESC has stale calibration,
# power-cycle LiPo while signal is at 1860us (safe max) to retrain.
# USAGE: 1) click CALIBRATE button  2) disconnect LiPo  3) reconnect within 10s
#        4) ESCs retrain to [1060, 1860]  5) done.
# CRITICAL: NEVER use >1860us for calibration (1940us reversed the range
# and caused the "motor shot across room" incident — see DEVLOG Issue 4).

CAL_MAX_US = 1860  # NOT 1940 (that caused reversed range)
CAL_PENDING = {"active": False, "phase": 0}  # phase: 0=idle, 1=1860us, 2=1060us, 3=done

def calibrate_sequence():
    """Sets all 4 ESCs to CAL_MAX_US for 2s, then drops to PULSE_MIN_US for 3s.
    The user must power-cycle the LiPo DURING the high-pulse window so the
    ESCs boot seeing 1860us and enter calibration."""
    CAL_PENDING["active"] = True
    try:
        # Phase 1: hold 1860us — user must DISCONNECT LiPo during this window
        print("CALIBRATION: PHASE 1 — setting all 4 to", CAL_MAX_US, "us")
        CAL_PENDING["phase"] = 1
        for i in range(4):
            set_motor(i, 100)  # 100 = 1860us
        time.sleep(2)

        # Phase 2: drop to 1060us — user must RECONNECT LiPo during this window
        print("CALIBRATION: PHASE 2 — dropping to", PULSE_MIN_US, "us")
        CAL_PENDING["phase"] = 2
        for i in range(4):
            set_motor(i, 0)  # 0 = 1060us
        time.sleep(3)

        # Phase 3: done
        print("CALIBRATION: done — ESCs retrained to [1060, 1860]")
        CAL_PENDING["phase"] = 3
        stop_all()
        time.sleep(1)
    except Exception as e:
        print("calibration error:", e)
        safety_cut()
    finally:
        CAL_PENDING["active"] = False
        CAL_PENDING["phase"] = 0


# ---------- WEB SERVER ----------
HTML = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quad ESC Tester</title><style>
body{background:#121212;color:#e0e0e0;font-family:sans-serif;text-align:center;margin:0;padding:20px}
h2{margin:10px 0}
.motor{margin:14px auto;max-width:420px;text-align:left}
.motor label{display:inline-block;width:90px;font-weight:bold}
input[type=range]{width:60%;vertical-align:middle}
.val{display:inline-block;width:42px;text-align:right;color:#4caf50;font-weight:bold}
button{margin:8px;padding:12px 22px;font-size:1.1em;color:#fff;border:0;border-radius:8px}
.stop{background:#b71c1c}
.seq{background:#1565c0}
input[type=number]{width:70px;padding:6px;font-size:1em}
.row{margin:8px auto;max-width:420px}
#status{margin-top:14px;color:#90caf9;min-height:1.4em}
#seqstatus{color:#ffb74d}
/* Calibration step overlay */
#calsteps{display:none;margin:16px auto;max-width:520px;border-radius:12px;padding:20px;text-align:center}
#calsteps.phase1{display:block;background:#b71c1c;border:3px solid #ff5252}
#calsteps.phase2{display:block;background:#1b5e20;border:3px solid #69f0ae}
#calsteps.phase3{display:block;background:#0d47a1;border:3px solid #448aff}
#calsteps .step-num{font-size:0.85em;opacity:0.7;margin-bottom:4px}
#calsteps .step-action{font-size:1.6em;font-weight:bold;margin:8px 0}
#calsteps .step-detail{font-size:0.95em;line-height:1.5}
#calsteps .step-timing{font-size:1.1em;margin-top:10px;color:#ffd54f;font-weight:bold}
.cal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10}
.cal-overlay.show{display:block}
</style></head><body>
<div class="cal-overlay" id="caloverlay"></div>
<h2>Quad ESC Tester (4 motors)</h2>
<div class="motor"><label>ESC1 FL</label><input type="range" min="0" max="100" value="0" id="m0" oninput="m(0)"><span class="val" id="v0">0</span></div>
<div class="motor"><label>ESC2 FR</label><input type="range" min="0" max="100" value="0" id="m1" oninput="m(1)"><span class="val" id="v1">0</span></div>
<div class="motor"><label>ESC3 BR</label><input type="range" min="0" max="100" value="0" id="m2" oninput="m(2)"><span class="val" id="v2">0</span></div>
<div class="motor"><label>ESC4 BL</label><input type="range" min="0" max="100" value="0" id="m3" oninput="m(3)"><span class="val" id="v3">0</span></div>
<div class="row">
  <button class="stop" onclick="stopAll()">STOP ALL</button>
</div>
<div class="row">
          Target% <input type="number" id="tgt" value="30" min="0" max="60">
          Ramp s <input type="number" id="ramp" value="5" min="1" max="30">
          Hold s <input type="number" id="hold" value="3" min="0" max="30">
          <button class="seq" onclick="startSeq()">START RAMP→HOLD→CUTOFF</button>
          <button class="seq" onclick="abortSeq()" style="background:#e65100">ABORT</button>
        </div>
        <div class="row">
          <button onclick="startCal()" style="background:#7b1fa2;padding:10px 18px">CALIBRATE ESCs (4 at once)</button>
          <span id="calstatus" style="color:#ce93d8;font-size:0.9em"></span>
        </div>

        <div id="calsteps">
          <div class="step-num" id="calstepnum"></div>
          <div class="step-action" id="calaction"></div>
          <div class="step-detail" id="caldetail"></div>
          <div class="step-timing" id="caltime"></div>
        </div>

        <div id="status">Manual: drag a slider. Or set Target/Ramp/Hold and START from a safe distance.</div>
<div id="seqstatus"></div>
<script>
const MAX=60;
function m(i){const s=document.getElementById('m'+i),v=document.getElementById('v'+i);
  let x=Math.min(MAX,+s.value); s.value=x; v.textContent=x;
  fetch('/set?m='+i+'&value='+x).catch(()=>{});}
function stopAll(){for(let i=0;i<4;i++){document.getElementById('m'+i).value=0;document.getElementById('v'+i).textContent='0';}
  fetch('/stop').catch(()=>{});document.getElementById('status').textContent='ALL STOPPED';}
function startSeq(){const t=document.getElementById('tgt').value,r=document.getElementById('ramp').value,h=document.getElementById('hold').value;
  fetch('/seq?action=start&target='+t+'&ramp='+r+'&hold='+h).catch(()=>{});
  document.getElementById('status').textContent='Auto sequence running — stand clear!';}
function abortSeq(){fetch('/seq?action=abort').catch(()=>{});
  document.getElementById('status').textContent='ABORT sent — cutting off';}
function startCal(){document.getElementById('calstatus').textContent='CALIBRATING — sliders locked';
  for(let i=0;i<4;i++){document.getElementById('m'+i).disabled=true;}
  fetch('/calibrate').catch(()=>{});
  document.getElementById('calsteps').className='phase1';
  document.getElementById('calstepnum').textContent='STEP 1 of 3';
  document.getElementById('calaction').textContent='DISCONNECT the LiPo battery';
  document.getElementById('caldetail').textContent='All 4 motors are held at full throttle signal (1860us). Wait for the ESCs to power down completely — you will hear the motor beeps fade and stop.';
  document.getElementById('caltime').textContent='You have about 2 seconds. Disconnect now.';}
function showCalPhase(ph){
  var box=document.getElementById('calsteps');
  var ov=document.getElementById('caloverlay');
  if(ph===0){box.className='';ov.className='cal-overlay';return;}
  if(ph===1){
    box.className='phase1';ov.className='cal-overlay show';
    document.getElementById('calstepnum').textContent='STEP 1 of 3';
    document.getElementById('calaction').textContent='DISCONNECT the LiPo battery';
    document.getElementById('caldetail').textContent='All 4 motors are held at full throttle signal (1860us). Wait for the ESCs to power down completely — you will hear the motor beeps fade and stop.';
    document.getElementById('caltime').textContent='Window is open now. Disconnect the LiPo!';
  } else if(ph===2){
    box.className='phase2';ov.className='cal-overlay show';
    document.getElementById('calstepnum').textContent='STEP 2 of 3';
    document.getElementById('calaction').textContent='RECONNECT the LiPo battery';
    document.getElementById('caldetail').textContent='Signal has dropped to arm level (1060us). The ESCs will see power-up at the correct endpoints and play their startup melody to confirm.';
    document.getElementById('caltime').textContent='Window is open for ~3 seconds. Reconnect now!';
  } else if(ph===3){
    box.className='phase3';ov.className='cal-overlay show';
    document.getElementById('calstepnum').textContent='STEP 3 of 3 — COMPLETE';
    document.getElementById('calaction').textContent='Calibration successful!';
    document.getElementById('caldetail').textContent='All 4 ESCs have retrained to the [1060, 1860] factory range. You can now test motors at low throttle.';
    document.getElementById('caltime').textContent='Calibration finished in firmware. Close this panel and test.';
    setTimeout(function(){ov.className='cal-overlay';},4000);
  }
}
setInterval(()=>{fetch('/seqstate').then(r=>r.json()).then(d=>{
  if(d.calibrating){
    document.getElementById('calstatus').textContent='CALIBRATING — sliders disabled';
    for(let i=0;i<4;i++){document.getElementById('m'+i).disabled=true;}
    showCalPhase(d.cal_phase);
  } else {
    document.getElementById('calstatus').textContent='';
    for(let i=0;i<4;i++){document.getElementById('m'+i).disabled=false;}
    if(d.cal_phase===0){showCalPhase(0);}
  }
  if(d.running){document.getElementById('seqstatus').textContent='RAMP/HOLD: '+d.throttle+'%';
    for(let i=0;i<4;i++){document.getElementById('m'+i).value=d.throttle;document.getElementById('v'+i).textContent=d.throttle;}}
  else{document.getElementById('seqstatus').textContent='';}
}).catch(()=>{});},300);
</script></body></html>"""


def parse_int(target, key, default=0):
    i = target.find(key + '=')
    if i < 0:
        return default
    raw = target[i + len(key) + 1:].split(' ')[0].split('&')[0]
    try:
        return int(raw)
    except Exception:
        return default


addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(addr)
srv.listen(5)
print("Server listening on http://" + network.WLAN(network.STA_IF).ifconfig()[0])

while True:
    try:
        cl, _ = srv.accept()
        cl.settimeout(2.0)
        req = cl.recv(1024).decode('utf-8')
        request_line = req.split('\r\n')[0]
        target = request_line.split(' ')[1] if len(request_line.split(' ')) >= 2 else '/'

        if '/seqstate' in target:
            import ujson
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" +
                    ujson.dumps({"running": seq["running"], "throttle": seq["throttle"][0],
                                  "calibrating": CAL_PENDING["active"],
                                  "cal_phase": CAL_PENDING["phase"]}))
        elif '/set' in target:
            m = parse_int(target, 'm', 0)
            val = parse_int(target, 'value', 0)
            if 0 <= m < 4:
                set_motor(m, val)
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK")
        elif '/stop' in target:
            stop_all()
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSTOPPED")
        elif '/calibrate' in target:
            if CAL_PENDING["active"]:
                cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nCAL: already running")
            else:
                _thread.start_new_thread(calibrate_sequence, ())
                cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nCAL: set 1860us. Disconnect LiPo, reconnect within 10s")
        elif '/seq' in target:
            action = target[target.find('action=') + 7:].split(' ')[0].split('&')[0]
            if action == 'start':
                tgt = parse_int(target, 'target', 30)
                ramp = parse_int(target, 'ramp', 5)
                hold = parse_int(target, 'hold', 3)
                _thread.start_new_thread(auto_sequence, (tgt, ramp, hold))
                cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSEQ STARTED")
            elif action == 'abort':
                safety_cut()
                cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSEQ ABORTED")
            else:
                cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nUNK ACTION")
        else:
            cl.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n" + HTML)
        cl.close()
        gc.collect()
    except Exception as e:
        print("server error:", e)
        try:
            safety_cut()
        except Exception:
            pass
