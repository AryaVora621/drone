#include <Arduino.h>
#include <Preferences.h>
#include <math.h>
#include "EspNowRcLink/Transmitter.h"

// ---------------------------------------------------------------------------
// Drone Controller - ESP-NOW TX build
//
// Reads the same two joysticks as the BLE gamepad build (main.cpp) and
// transmits 4 RC channels over ESP-NOW using espnow-rclink, the protocol
// esp-fc's InputEspNow driver expects natively. This is a separate firmware
// image (env:esp32u_espnow) -- only one build runs on the controller at a
// time; main.cpp (BLE) is untouched and still used for the sim.
//
// Channel order matches esp-fc/Betaflight's default AETR raw channel map:
//   ch0 = Roll (Aileron), ch1 = Pitch (Elevator), ch2 = Throttle, ch3 = Yaw (Rudder)
// esp-fc's InputEspNow::begin() initializes ch2 (throttle) to the failsafe-
// safe minimum -- confirms index 2 is throttle, not a guess.
//
// Mode 2 stick layout, in terms of PHYSICAL stick motion: left stick
// up/down=throttle, left stick left/right=yaw, right stick up/down=pitch,
// right stick left/right=roll.
//
// Both joystick modules are physically mounted rotated 90 degrees from
// what their X/Y pot wiring assumes (confirmed via Configurator's Receiver
// tab: left stick physical up drove yaw instead of throttle, right stick
// physical up drove roll instead of pitch). The X<->Y swap below in loop()
// corrects for this in software -- the PIN_* labels below describe which
// GPIO each pot is wired to, NOT which physical stick direction it reads.
//
// Pin assignments (all ADC1; GPIO34/35 are input-only), same wiring as main.cpp:
//   Left stick:  X = GPIO32, Y = GPIO33
//   Right stick: X = GPIO34, Y = GPIO35
//
// HARDWARE RULE: joystick VCC must be 3.3V. The ADC max is 3.3V; 5V on
// these pins damages them.
// ---------------------------------------------------------------------------

static const uint8_t PIN_LX = 32;
static const uint8_t PIN_LY = 33;
static const uint8_t PIN_RX = 34;
static const uint8_t PIN_RY = 35;
static const uint8_t PIN_LED = 2;  // onboard LED

static const int ADC_MAX = 4095;  // 12-bit
static const float DEADZONE = 0.05f;  // 5% around center
static const unsigned long SEND_MS = 20;  // ~50 Hz, matches espnow-rclink example rate

// RC pulse range sent over the link. esp-fc's default input config
// (input_0..3) scales 1000/1500/2000 to its internal range, so send that
// standard range rather than the protocol's full 880-2120 headroom.
static const int RC_MIN = 1000;
static const int RC_MID = 1500;
static const int RC_MAX = 2000;

// espnow-rclink raw channel indices (AETR order, see file header).
static const size_t CH_ROLL = 0;
static const size_t CH_PITCH = 1;
static const size_t CH_THROTTLE = 2;
static const size_t CH_YAW = 3;

struct Cal {
  int lx, ly, rx, ry;
};
static Cal center = { ADC_MAX / 2, ADC_MAX / 2, ADC_MAX / 2, ADC_MAX / 2 };

EspNowRcLink::Transmitter tx;

static int readAxis(uint8_t pin) {
  return analogRead(pin);
}

// Map a raw ADC reading to an RC pulse (RC_MIN..RC_MAX) around the stored
// center, with a deadzone so stick jitter at rest reports exactly RC_MID.
static int toRcPulse(int raw, int ctr) {
  float v = (float)(raw - ctr) / (float)(ADC_MAX / 2);  // -1.0 .. 1.0
  if (fabsf(v) < DEADZONE) {
    v = 0.0f;
  } else {
    float sign = (v > 0.0f) ? 1.0f : -1.0f;
    v = sign * (fabsf(v) - DEADZONE) / (1.0f - DEADZONE);
  }
  v = constrain(v, -1.0f, 1.0f);
  return RC_MID + (int)(v * (float)(RC_MAX - RC_MID));
}

static void loadCalibration() {
  Preferences prefs;
  prefs.begin("ctrlcal", true);  // read-only, same NVS namespace as main.cpp
  if (prefs.isKey("lx")) {
    center.lx = prefs.getInt("lx", ADC_MAX / 2);
    center.ly = prefs.getInt("ly", ADC_MAX / 2);
    center.rx = prefs.getInt("rx", ADC_MAX / 2);
    center.ry = prefs.getInt("ry", ADC_MAX / 2);
    Serial.println("Calibration loaded from NVS");
  } else {
    Serial.println("No calibration in NVS; using midpoints (send 'c' to calibrate)");
  }
  prefs.end();
}

static void captureCalibration() {
  Preferences prefs;
  prefs.begin("ctrlcal", false);
  center.lx = readAxis(PIN_LX);
  center.ly = readAxis(PIN_LY);
  center.rx = readAxis(PIN_RX);
  center.ry = readAxis(PIN_RY);
  prefs.putInt("lx", center.lx);
  prefs.putInt("ly", center.ly);
  prefs.putInt("rx", center.rx);
  prefs.putInt("ry", center.ry);
  prefs.end();
  Serial.printf("Calibration captured: LX=%d LY=%d RX=%d RY=%d\n",
                center.lx, center.ly, center.rx, center.ry);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);  // 0..3.3V -> 0..4095

  loadCalibration();

  tx.begin(true);  // init hidden WiFi AP for ESP-NOW

  Serial.println("Drone Controller (ESP-NOW TX) started");
  Serial.println("  send 'c' over serial to recapture stick centers");
}

void loop() {
  unsigned long now = millis();

  // Runtime recalibration: hold sticks at rest, send 'c' in the serial monitor.
  if (Serial.available() && Serial.read() == 'c') {
    captureCalibration();
  }

  static unsigned long last = 0;
  if (now - last >= SEND_MS) {
    last = now;

    // Both joystick modules are physically mounted rotated 90 degrees
    // (confirmed via Configurator Receiver tab: left stick up drove yaw
    // instead of throttle, right stick up drove roll instead of pitch).
    // Swap X/Y per stick here rather than fighting esp-fc's rxmap.
    int roll = toRcPulse(readAxis(PIN_RY), center.ry);
    int pitch = toRcPulse(readAxis(PIN_RX), center.rx);
    int throttle = toRcPulse(readAxis(PIN_LX), center.lx);
    int yaw = toRcPulse(readAxis(PIN_LY), center.ly);

    tx.setChannel(CH_ROLL, roll);
    tx.setChannel(CH_PITCH, pitch);
    tx.setChannel(CH_THROTTLE, throttle);
    tx.setChannel(CH_YAW, yaw);
    // Remaining channels (4-7) unused; leave at library default.
    tx.commit();
  }

  tx.update();

  // LED: solid once the transmitter has paired with the receiver.
  // Transmitter has no public isPaired()/isConnected() accessor exposed by
  // the library, so just blink to show the firmware is alive.
  digitalWrite(PIN_LED, (now % 1000) < 200 ? HIGH : LOW);
}
