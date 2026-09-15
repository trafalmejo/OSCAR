/*
 * OSCAR straight to an Arduino over Wi-Fi -- no bridge, no extra software.
 *
 * If your board has networking (Uno R4 WiFi, Nano 33 IoT, MKR WiFi, ESP32,
 * ESP8266, or anything with an Ethernet shield) it can receive OSCAR's OSC
 * messages directly. Put the board on the same network as OSCAR, set each
 * widget's IP to the address this sketch prints and its port to OSC_PORT.
 *
 * The OSC parsing below is deliberately written out rather than pulled from a
 * library: it is about forty lines, it is the whole of the protocol OSCAR
 * sends, and it means this sketch compiles on a fresh Arduino IDE with nothing
 * installed.
 */

#if defined(ARDUINO_UNOR4_WIFI)
#include <WiFiS3.h>
#elif defined(ARDUINO_SAMD_NANO_33_IOT) || defined(ARDUINO_SAMD_MKRWIFI1010)
#include <WiFiNINA.h>
#else
#include <WiFi.h>  // ESP32 / ESP8266
#endif

#include <WiFiUdp.h>

const char *WIFI_SSID = "your-network";
const char *WIFI_PASSWORD = "your-password";

// Match this in every OSCAR widget's Port field.
const uint16_t OSC_PORT = 8000;

const int LED_PIN = LED_BUILTIN;
const int DIMMER_PIN = 9;  // any PWM-capable pin

// One UDP datagram. OSCAR's messages are tens of bytes; anything much larger
// than this is not something this sketch was going to understand anyway.
const size_t MAX_PACKET = 256;
const uint8_t MAX_ARGS = 4;

WiFiUDP udp;
uint8_t packet[MAX_PACKET];

/* An OSC value, kept in whichever form it arrived in. */
struct OscArg {
  char type;  // 'i', 'f', 's', 'T', 'F'
  int32_t i;
  float f;
  const char *s;
};

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(DIMMER_PIN, OUTPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  udp.begin(OSC_PORT);

  Serial.println();
  Serial.print("Point OSCAR's widgets at ");
  Serial.print(WiFi.localIP());
  Serial.print(":");
  Serial.println(OSC_PORT);
}

void loop() {
  int size = udp.parsePacket();
  if (size <= 0) return;
  if ((size_t)size > MAX_PACKET) {
    udp.flush();
    return;
  }

  int read = udp.read(packet, MAX_PACKET);
  if (read > 0) handlePacket(packet, (size_t)read);
}

/* ---- the OSC bit ---------------------------------------------------------
 *
 * An OSC message is an address, then a type tag beginning with ',', then the
 * values -- each padded out to a multiple of four bytes.
 */

/* Where the next field starts, given where this one ended. */
static inline size_t padded(size_t length) {
  return (length + 4) & ~((size_t)3);
}

static int32_t readInt32(const uint8_t *at) {
  return ((int32_t)at[0] << 24) | ((int32_t)at[1] << 16) | ((int32_t)at[2] << 8) | (int32_t)at[3];
}

static float readFloat32(const uint8_t *at) {
  int32_t bits = readInt32(at);
  float value;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

void handlePacket(uint8_t *buffer, size_t length) {
  // A bundle would need unpacking first; OSCAR sends plain messages.
  if (length < 8 || buffer[0] != '/') return;

  const char *address = (const char *)buffer;
  size_t offset = padded(strnlen(address, length));
  if (offset >= length || buffer[offset] != ',') return;

  const char *tags = (const char *)(buffer + offset);
  size_t tagLength = strnlen(tags, length - offset);
  offset += padded(tagLength);

  OscArg args[MAX_ARGS];
  uint8_t argCount = 0;

  for (size_t t = 1; t < tagLength && argCount < MAX_ARGS; t++) {
    OscArg arg;
    arg.type = tags[t];

    switch (tags[t]) {
      case 'i':
        if (offset + 4 > length) return;
        arg.i = readInt32(buffer + offset);
        arg.f = (float)arg.i;
        offset += 4;
        break;

      case 'f':
        if (offset + 4 > length) return;
        arg.f = readFloat32(buffer + offset);
        arg.i = (int32_t)arg.f;
        offset += 4;
        break;

      case 's': {
        if (offset >= length) return;
        arg.s = (const char *)(buffer + offset);
        offset += padded(strnlen(arg.s, length - offset));
        break;
      }

      // T and F carry no payload: the type tag is the whole value.
      case 'T':
        arg.i = 1;
        arg.f = 1.0f;
        break;
      case 'F':
        arg.i = 0;
        arg.f = 0.0f;
        break;

      default:
        return;  // a type this sketch cannot skip safely
    }

    args[argCount++] = arg;
  }

  dispatch(address, args, argCount);
}

/* ---- your show goes here -------------------------------------------------
 *
 * Match on the OSC address you typed into the widget's settings in OSCAR.
 */
void dispatch(const char *address, OscArg *args, uint8_t argCount) {
  if (strcmp(address, "/strobe") == 0 && argCount >= 1) {
    digitalWrite(LED_PIN, args[0].i != 0 ? HIGH : LOW);
    return;
  }

  if (strcmp(address, "/master/level") == 0 && argCount >= 1) {
    // Clamp before scaling: a slider given a range wider than 0..1 would
    // otherwise wrap round to darkness at the top.
    float level = args[0].f;
    if (level < 0.0f) level = 0.0f;
    if (level > 1.0f) level = 1.0f;
    analogWrite(DIMMER_PIN, (int)(level * 255.0f));
    return;
  }

  if (strcmp(address, "/pad") == 0 && argCount >= 2) {
    // An XY pad sends both values in one message by default.
    float x = args[0].f;
    float y = args[1].f;
    (void)x;
    (void)y;
    return;
  }
}
