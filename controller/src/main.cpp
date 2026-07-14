#include <Arduino.h>
#include <BleGamepad.h>
#include <Preferences.h>
#include <math.h>

// ---------------------------------------------------------------------------
// Drone Controller - v1 BLE gamepad
//
// ESP32 reads two joysticks (4 analog axes) and presents as a standard
// Bluetooth LE gamepad (HID). No drone link yet (ESP-NOW is a later phase).
//
// Pin assignments (all ADC1; GPIO34/35 are input-only):
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

static const int     ADC_MAX    = 4095;          // 12-bit
static const int16_t AXIS_MIN   = 0;             // BleGamepad default range (v5+)
static const int16_t AXIS_MAX   = 32767;
static const int16_t AXIS_MID   = (AXIS_MIN + AXIS_MAX) / 2;
static const float   DEADZONE   = 0.05f;        // 5% around center
static const unsigned long REPORT_MS = 20;        // ~50 Hz

// First-boot center calibration, persisted in NVS. Sticks are read relative
// to these centers so physical offset does not bias the output.
struct Cal {
  int lx, ly, rx, ry;
};
static Cal center = { ADC_MAX / 2, ADC_MAX / 2, ADC_MAX / 2, ADC_MAX / 2 };

// Presents as "Drone Controller" over BLE.
BleGamepad bleGamepad("Drone Controller", "Arya", 100);

static int readAxis(uint8_t pin) {
  return analogRead(pin);
}

// Map a raw ADC reading to the axis range around the stored center, with a
// deadzone so stick jitter at rest reports exactly mid-scale.
static int16_t toAxis(int raw, int ctr) {
  float v = (float)(raw - ctr) / (float)(ADC_MAX / 2);  // -1.0 .. 1.0
  if (fabsf(v) < DEADZONE) {
    v = 0.0f;
  } else {
    float sign = (v > 0.0f) ? 1.0f : -1.0f;
    v = sign * (fabsf(v) - DEADZONE) / (1.0f - DEADZONE);
  }
  v = constrain(v, -1.0f, 1.0f);
  return (int16_t)(AXIS_MID + v * (float)AXIS_MID);
}

static void loadCalibration() {
  Preferences prefs;
  prefs.begin("ctrlcal", true);  // read-only
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

  // Full 6 axes (X,Y,Z,Rx,Ry,Rz) — matches the HID descriptor macOS cached
  // on the first pairing, so the right stick (Rx=a[4], Ry=a[5]) reaches the
  // browser unshifted.  If you change the axis count, remove & re-pair
  // "Drone Controller" in Bluetooth settings or the right stick goes dead.
  BleGamepadConfiguration* config = new BleGamepadConfiguration();
  config->setButtonCount(0);
  config->setHatSwitchCount(0);
  config->setWhichSpecialButtons(false, false, false, false, false, false, false, false);
  config->setWhichAxes(true, true, true, true, true, true, false, false);
  config->setAxesMin(AXIS_MIN);
  config->setAxesMax(AXIS_MAX);
  config->setAutoReport(false);  // we send at a fixed ~50 Hz
  bleGamepad.begin(config);

  loadCalibration();
  Serial.println("Drone Controller started; advertising as 'Drone Controller'");
  Serial.println("  send 'c' over serial to recapture stick centers");
}

void loop() {
  unsigned long now = millis();

  // LED: blink while advertising, solid when a host is connected.
  if (bleGamepad.isConnected()) {
    digitalWrite(PIN_LED, HIGH);
  } else {
    digitalWrite(PIN_LED, (now % 1000) < 200 ? HIGH : LOW);
  }

  // Runtime recalibration: hold sticks at rest, send 'c' in the serial monitor.
  if (Serial.available() && Serial.read() == 'c') {
    captureCalibration();
  }

  static unsigned long last = 0;
  if (bleGamepad.isConnected() && (now - last >= REPORT_MS)) {
    last = now;
    int16_t lx = toAxis(readAxis(PIN_LX), center.lx);
    int16_t ly = toAxis(readAxis(PIN_LY), center.ly);
    int16_t rx = toAxis(readAxis(PIN_RX), center.rx);
    int16_t ry = toAxis(readAxis(PIN_RY), center.ry);
    // Windows mapping: left stick = x,y ; right stick = z,rz
    bleGamepad.setLeftThumb(lx, ly);
    bleGamepad.setRightThumb(rx, ry);
    bleGamepad.sendReport();
  }

  delay(1);
}
