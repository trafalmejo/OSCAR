/*
 * OSCAR over Wi-Fi.
 *
 * THIS NEEDS NOTHING FROM OSCAR. OSCAR sends OSC over UDP to whatever IP and
 * port a widget names, and a board on the network is one more thing with an
 * IP and a port -- exactly like Resolume or TouchDesigner. No Serial panel,
 * no cable, no setting: put the address this sketch prints into the widget's
 * Ip and Port fields and it works, with every OSCAR that has ever shipped.
 *
 * For ESP32 and ESP8266. Other networked boards differ only in the include:
 *   Uno R4 WiFi                 #include <WiFiS3.h>
 *   Nano 33 IoT, MKR WiFi 1010  #include <WiFiNINA.h>   (one library to install)
 *   Ethernet shield             #include <Ethernet.h> and <EthernetUdp.h>
 *
 * Straight out of the box it answers the widgets OSCAR creates:
 *   a Button  (/push1,   int 1 / 0)      -> the built-in LED
 *   a Slider  (/slider1, float 0..100)   -> PWM brightness on DIMMER_PIN
 *
 * No OSC library. A UDP datagram is one whole OSC packet, so all that is
 * needed is the parser, written out below because it is short and because it
 * is what you will want to read when your own address does not arrive.
 */

#if defined(ESP8266)
#include <ESP8266WiFi.h>
#else
#include <WiFi.h>
#endif
#include <WiFiUdp.h>

const char *WIFI_NAME = "your-network";
const char *WIFI_PASSWORD = "your-password";
const uint16_t LISTEN_PORT = 8000;  // goes in the widget's Port field

#ifndef LED_BUILTIN
#define LED_BUILTIN 2  // most ESP32 dev boards
#endif
const int LED_PIN = LED_BUILTIN;
const int DIMMER_PIN = 4;  // any PWM-capable pin (analogWrite needs ESP32 core 2.0 or newer)

/* To send a sensor back, so a Meter widget can show it: the computer running
   OSCAR, and its OSC-in port (9000 unless OSCAR_OSC_IN_PORT moved it). Left
   empty, nothing is sent. */
const char *OSCAR_IP = "";  // e.g. "192.168.1.20"
const uint16_t OSCAR_PORT = 9000;
#if defined(ESP8266)
const int SENSOR_PIN = A0;  // the only ADC pin; reads 0..1023
const long SENSOR_MAX = 1023;
#else
const int SENSOR_PIN = 34;  // an ADC pin; ESP32 reads 0..4095
const long SENSOR_MAX = 4095;
#endif

WiFiUDP udp;

/* ---- OSC, in about forty lines ------------------------------------------ */

const uint8_t MAX_ARGS = 4;

struct OscArg {
  char type;         // 'i' 'f' 's' 'T' 'F'
  bool isNumber;     // false for a string, and for a float that is not a number
  float number;      // i, f, T (1) and F (0). Ints above 16 million lose their last digits.
  const char *text;  // s
};

struct OscMessage {
  const char *address;
  OscArg args[MAX_ARGS];
  uint8_t count;
};

/* Where the field after the string at `at` starts, or 0 if it never ends.
   OSC pads every string with 1-4 zero bytes to a multiple of four. */
static size_t afterString(const uint8_t *p, size_t at, size_t len) {
  while (at < len && p[at] != 0) at++;
  return at >= len ? 0 : (at + 4) & ~(size_t)3;
}

/* address, then ",types", then the values; everything big-endian. */
bool parseOsc(const uint8_t *p, size_t len, OscMessage &m) {
  if (len < 8 || p[0] != '/') return false;
  size_t tags = afterString(p, 0, len);
  if (!tags || tags >= len || p[tags] != ',') return false;
  size_t at = afterString(p, tags, len);
  if (!at) return false;

  m.address = (const char *)p;
  m.count = 0;
  for (const uint8_t *t = p + tags + 1; *t && m.count < MAX_ARGS; t++) {
    OscArg &a = m.args[m.count];
    a.type = (char)*t;
    a.isNumber = true;
    a.number = 0;
    a.text = NULL;
    if (*t == 'i' || *t == 'f') {
      if (at + 4 > len) return false;
      uint32_t bits = ((uint32_t)p[at] << 24) | ((uint32_t)p[at + 1] << 16) | ((uint32_t)p[at + 2] << 8) | p[at + 3];
      if (*t == 'i') a.number = (float)(int32_t)bits;
      else memcpy(&a.number, &bits, 4);
      if (a.number != a.number) a.isNumber = false;  // NaN
      at += 4;
    } else if (*t == 's') {
      a.isNumber = false;
      a.text = (const char *)(p + at);
      at = afterString(p, at, len);
      if (!at) return false;
    } else if (*t == 'T') {
      a.number = 1;
    } else if (*t != 'F') {
      return false;  // a type whose size is unknown: nothing after it can be trusted
    }
    m.count++;
  }
  return true;
}

/* ---- your show goes here ------------------------------------------------ */

/* Match the address typed into the widget's Message field.
 *
 * Check isNumber before using a number. A widget set to send text ("go")
 * must not be read as 0: on a lighting rig 0 means off, and a light going out
 * because of a typo looks exactly like someone switching it off.
 */
void onOsc(const OscMessage &m) {
  if (m.count < 1 || !m.args[0].isNumber) return;
  float value = m.args[0].number;

  if (strcmp(m.address, "/push1") == 0) {
    digitalWrite(LED_PIN, value != 0 ? HIGH : LOW);
  } else if (strcmp(m.address, "/slider1") == 0) {
    // OSCAR's slider runs Min..Max as set in its panel; 0..100 by default.
    // Clamp before scaling, or a wider range wraps round to dark at the top.
    if (value < 0) value = 0;
    if (value > 100) value = 100;
    analogWrite(DIMMER_PIN, (int)(value * 2.55f));
  }
  // An XY pad sends two numbers in one message: m.args[0] and m.args[1].
}

/* ---- talking back: one float to OSCAR ----------------------------------- */

void sendFloat(const char *address, float value) {
  uint8_t out[64];
  size_t n = strlen(address);
  size_t padded = (n + 4) & ~(size_t)3;
  if (padded + 8 > sizeof(out)) return;
  memset(out, 0, sizeof(out));
  memcpy(out, address, n);
  out[padded] = ',';
  out[padded + 1] = 'f';
  uint32_t bits;
  memcpy(&bits, &value, 4);
  for (uint8_t i = 0; i < 4; i++) out[padded + 4 + i] = (uint8_t)(bits >> (24 - 8 * i));
  udp.beginPacket(OSCAR_IP, OSCAR_PORT);
  udp.write(out, padded + 8);
  udp.endPacket();
}

/* ------------------------------------------------------------------------- */

void setup() {
  Serial.begin(115200);  // only for the address below; OSC travels by Wi-Fi
  pinMode(LED_PIN, OUTPUT);
  pinMode(DIMMER_PIN, OUTPUT);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  Serial.print("Joining ");
  Serial.print(WIFI_NAME);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  udp.begin(LISTEN_PORT);

  Serial.println();
  Serial.print("In OSCAR, set the widget's Ip to ");
  Serial.print(WiFi.localIP());
  Serial.print(" and its Port to ");
  Serial.println(LISTEN_PORT);
}

uint8_t packet[256];
int lastSent = -1;
unsigned long lastSentAt = 0;

void loop() {
  int size = udp.parsePacket();
  if (size > 0) {
    // A datagram too long to hold is dropped whole. Its first half would
    // parse as a valid message carrying the wrong value.
    int got = size <= (int)sizeof(packet) ? udp.read(packet, sizeof(packet)) : 0;
    OscMessage m;
    if (got > 0 && parseOsc(packet, (size_t)got, m)) onOsc(m);
  }

  // Only when it has moved, and at most 25 times a second.
  if (OSCAR_IP[0] != 0 && millis() - lastSentAt >= 40) {
    int level = (int)(analogRead(SENSOR_PIN) * 100L / SENSOR_MAX);
    if (level != lastSent) {
      sendFloat("/meter1", (float)level);
      lastSent = level;
      lastSentAt = millis();
    }
  }
}
