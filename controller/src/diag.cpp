// Diagnostic sketch — prints raw ADC values for all 4 joystick pins.
// Upload this to confirm whether GPIO35 is actually floating or the issue
// is in the BLE/HID layer.
//
// Usage:
//   1. PlatformIO: change src_filter in platformio.ini to src/diag.cpp
//      (or temporarily rename main.cpp to main.cpp.bak and diag.cpp to main.cpp)
//   2. Upload, open Serial Monitor at 115200 baud
//   3. Watch the 4 values. RY (GPIO35) should change smoothly when you
//      move the right stick up/down. If it drifts or jumps, the pin is
//      floating — check VCC on the joystick module.

#include <Arduino.h>

static const uint8_t PINS[] = { 32, 33, 34, 35 };
static const char*   NAMES[] = { "LX", "LY", "RX", "RY" };
static const int     N = 4;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("\n\n--- Drone Controller ADC Diagnostic ---");
  Serial.println("Move each stick and watch the corresponding value change.");
  Serial.println("A drifting/jumpy pin = floating (no connection or no power).");
  Serial.println("A stuck-at-4095 pin = over-voltage (VCC too high for ADC).");
  Serial.println("A stuck-at-0 pin = shorted to GND or no VCC on the joystick.");
  Serial.println();
  Serial.println("  LX(GPIO32)  LY(GPIO33)  RX(GPIO34)  RY(GPIO35)  |  VCC check");
  Serial.println("  ----------  ----------  ----------  ----------  |  ---------");
}

void loop() {
  int v32 = analogRead(32);
  int v33 = analogRead(33);
  int v34 = analogRead(34);
  int v35 = analogRead(35);

  // VCC check: if all 4 pins read near 0, the joystick module isn't powered.
  // If any pin reads 4095, that axis is over-range (VCC > 3.3V).
  const char* vcc_warn = "";
  if (v32 < 10 && v33 < 10 && v34 < 10 && v35 < 10) vcc_warn = "  <-- ALL NEAR 0: joystick has no power!";
  else if (v35 > 4080) vcc_warn = "  <-- RY SATURATED: over-voltage or shorted to VCC";

  Serial.printf("  %4d       %4d       %4d       %4d%s\n",
                v32, v33, v34, v35, vcc_warn);
  delay(100);
}