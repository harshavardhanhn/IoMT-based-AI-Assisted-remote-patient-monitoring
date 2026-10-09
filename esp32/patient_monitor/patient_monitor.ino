#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Set to 1 only when testing without the sensors connected.
#define USE_SIMULATION 0

#if !USE_SIMULATION
#include <Wire.h>
#include <MAX30105.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#endif

const char* ssid = "Galaxy A23 5G";
const char* password = "Idhx1744";
const char* serverUrl = "http://10.1.8.190:3000/vitals";
const char* ecgUrl = "http://10.1.8.190:3000/ecg";
const char* apiKey = "iomt-secret-key-2024";
const char* pid = "P001";
const char* deviceId = "ESP32-BED-01";

const int ecgPin = 34;
const int leadsOffPlusPin = 32;
const int leadsOffMinusPin = 33;
const int oneWirePin = 4;
const unsigned long vitalsInterval = 1000;
const unsigned long ecgInterval = 20;
const unsigned long sampleInterval = 1;

int ecgSamples[18];
int ecgIndex = 0;
unsigned long lastVitalsTime = 0;
unsigned long lastEcgTime = 0;
unsigned long lastSampleTime = 0;

#if !USE_SIMULATION
MAX30105 pulseSensor;
OneWire oneWire(oneWirePin);
DallasTemperature temperatureSensor(&oneWire);
float currentHeartRate = 0.0;
float currentSpO2 = 0.0;
long lastIr = 0;
unsigned long lastBeat = 0;
bool fingerOn = false;
bool leadsOff = false;
#endif

String isoTimestamp() {
  time_t now = time(nullptr);
  struct tm* utc = gmtime(&now);
  char result[25];
  if (utc && now > 100000) {
    strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%SZ", utc);
    return String(result);
  }
  return "1970-01-01T00:00:00Z";
}

unsigned long long timestampMillis() {
  time_t now = time(nullptr);
  return static_cast<unsigned long long>(now) * 1000ULL;
}

void connectWifi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("\nConnected: " + WiFi.localIP().toString());
}

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(ecgPin));

  pinMode(leadsOffPlusPin, INPUT);
  pinMode(leadsOffMinusPin, INPUT);

#if !USE_SIMULATION
  Wire.begin();
  temperatureSensor.begin();
  if (!pulseSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not detected");
  } else {
    pulseSensor.setup(60, 4, 2, 100, 411, 4096);
    pulseSensor.setPulseAmplitudeRed(0x0A);
    pulseSensor.setPulseAmplitudeGreen(0);
  }
#endif

  connectWifi();
}

int readEcgSample() {
#if USE_SIMULATION
  int value = 500 + random(-10, 11);
  if (ecgIndex == 20) value += 200;
  if (ecgIndex == 40) value -= 100;
  if (ecgIndex == 42) value += 600;
  if (ecgIndex == 45) value -= 200;
  if (ecgIndex == 65) value += 150;
  return value;
#else
  return analogRead(ecgPin);
#endif
}

void updatePulseSensor() {
#if !USE_SIMULATION
  long ir = pulseSensor.getIR();
  long red = pulseSensor.getRed();
  fingerOn = ir > 50000;
  if (!fingerOn) {
    currentHeartRate = 0;
    currentSpO2 = 0;
    return;
  }

  unsigned long now = millis();
  bool rising = ir > lastIr && ir > 50000;
  if (rising && lastIr <= 50000 && now - lastBeat > 300) {
    if (lastBeat > 0) currentHeartRate = 60000.0 / (now - lastBeat);
    lastBeat = now;
  }
  lastIr = ir;

  float ratio = (red > 0 && ir > 0) ? ((float)red / (float)ir) : 0.0;
  float estimatedSpO2 = 110.0 - 25.0 * ratio;
  if (estimatedSpO2 >= 80.0 && estimatedSpO2 <= 100.0) {
    currentSpO2 = currentSpO2 == 0 ? estimatedSpO2 : currentSpO2 * 0.75 + estimatedSpO2 * 0.25;
  }
#endif
}

void readVitals(float& temperature, float& heartRate, float& spo2, int& systolic, int& diastolic, bool& fingerDetected) {
#if USE_SIMULATION
  temperature = 37.0 + random(-5, 6) / 10.0;
  heartRate = 75 + random(-5, 6);
  spo2 = 97 + random(-2, 3);
  systolic = 120 + random(-5, 6);
  diastolic = 80 + random(-5, 6);
  fingerDetected = true;
#else
  temperatureSensor.requestTemperatures();
  temperature = temperatureSensor.getTempCByIndex(0);
  if (temperature == DEVICE_DISCONNECTED_C) temperature = 0;
  heartRate = currentHeartRate;
  spo2 = currentSpO2;
  systolic = 120;
  diastolic = 80;
  fingerDetected = fingerOn;
#endif
}

bool postJson(const char* url, String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", apiKey);
  int responseCode = http.POST(body);
  Serial.printf("POST %s -> %d\n", url, responseCode);
  http.end();
  return responseCode >= 200 && responseCode < 300;
}

void sendECGData() {
  StaticJsonDocument<4096> doc;
  doc["pid"] = pid;
  doc["dev"] = deviceId;
  doc["ts"] = timestampMillis();
  doc["lo"] = leadsOffPlusPin && (digitalRead(leadsOffPlusPin) || digitalRead(leadsOffMinusPin));
  JsonArray samples = doc.createNestedArray("ecg");
  for (int i = 0; i < 18; i++) samples.add(ecgSamples[i]);
  String body;
  serializeJson(doc, body);
  postJson(ecgUrl, body);
}

void sendVitalsData() {
  float temperature;
  float heartRate;
  float spo2;
  int systolic;
  int diastolic;
  bool fingerDetected;
  readVitals(temperature, heartRate, spo2, systolic, diastolic, fingerDetected);

  StaticJsonDocument<768> doc;
  doc["pid"] = pid;
  doc["dev"] = deviceId;
  doc["ts"] = timestampMillis();
  doc["temperature"] = temperature;
  doc["heart_rate"] = heartRate;
  doc["spo2"] = spo2;
  doc["systolic"] = systolic;
  doc["diastolic"] = diastolic;
  doc["finger_on"] = fingerDetected;
  String body;
  serializeJson(doc, body);
  Serial.println(body);
  postJson(serverUrl, body);
}

void loop() {
  unsigned long now = millis();

  updatePulseSensor();

  if (ecgIndex < 18 && now - lastSampleTime >= sampleInterval) {
    lastSampleTime = now;
    ecgSamples[ecgIndex++] = readEcgSample();
  }

  if (ecgIndex == 18 && now - lastEcgTime >= ecgInterval) {
    lastEcgTime = now;
    sendECGData();
    ecgIndex = 0;
  }

  if (now - lastVitalsTime >= vitalsInterval) {
    lastVitalsTime = now;
    sendVitalsData();
  }
}
