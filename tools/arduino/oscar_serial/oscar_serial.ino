/*
 * OSCAR over a USB cable.
 *
 * For any Arduino, including the ones with no network of their own (Uno,
 * Nano, Mega, Leonardo, Pico). A board that HAS Wi-Fi or Ethernet does not
 * need this: see ../oscar_wifi, which works with no setup in OSCAR at all.
 *
 * In OSCAR: open the Serial panel (the USB icon in the toolbar), connect this
 * board's port, then set a widget's Ip to the word  serial . Its Port is not
 * used -- a cable has none.
 *
 * Straight out of the box this sketch answers the widgets OSCAR creates:
 *   a Button  (/push1,   int 1 / 0)      -> the built-in LED
 *   a Slider  (/slider1, float 0..100)   -> PWM brightness on pin 9
 * and, with SEND_SENSOR switched on below, reports a potentiometer on A0 as
 * /meter1 (0..100), which a Meter widget shows with no settings changed.
 *
 * No libraries. OSC packets arrive framed with SLIP (RFC 1055), the standard
 * way OSC travels over a serial line; the un-framing and the OSC parser are
 * written out below because they are short, and because they are what you
 * will want to read when your own address does not arrive.
 *
 * Do NOT Serial.print() for debugging: this line carries OSC, and text on it
 * is noise to OSCAR. Blink an LED instead.
 */

const long BAUD = 115200;  // must match the rate chosen in OSCAR's Serial panel
const int LED_PIN = LED_BUILTIN;
const int DIMMER_PIN = 9;  // any PWM pin
const int SENSOR_PIN = A0;
const bool SEND_SENSOR = false;  // true once something is wired to A0: a floating pin reads noise

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

/* ---- SLIP: bytes in, packets out ---------------------------------------- */

const uint8_t END = 0xC0, ESC = 0xDB, ESC_END = 0xDC, ESC_ESC = 0xDD;

uint8_t packet[128];  // OSCAR's messages are tens of bytes
size_t packetLength = 0;
bool escaped = false;
bool tooLong = false;

void feed(uint8_t b) {
  if (b == END) {
    OscMessage m;
    // A packet too long to hold is dropped whole. Its first half would parse
    // as a valid message carrying the wrong value.
    if (packetLength > 0 && !tooLong && parseOsc(packet, packetLength, m)) onOsc(m);
    packetLength = 0;
    escaped = tooLong = false;
    return;
  }
  if (escaped) {
    escaped = false;
    if (b == ESC_END) b = END;
    else if (b == ESC_ESC) b = ESC;
  } else if (b == ESC) {
    escaped = true;
    return;
  }
  if (packetLength >= sizeof(packet)) tooLong = true;
  else packet[packetLength++] = b;
}

/* ---- talking back: one float to OSCAR ----------------------------------- */

void slipWrite(uint8_t b) {
  if (b == END) { Serial.write(ESC); Serial.write(ESC_END); }
  else if (b == ESC) { Serial.write(ESC); Serial.write(ESC_ESC); }
  else Serial.write(b);
}

void sendFloat(const char *address, float value) {
  Serial.write(END);  // a leading END flushes any line noise out of the receiver
  size_t n = strlen(address);
  for (size_t i = 0; i < n; i++) slipWrite((uint8_t)address[i]);
  for (size_t i = n; i < ((n + 4) & ~(size_t)3); i++) slipWrite(0);
  const uint8_t tags[4] = { ',', 'f', 0, 0 };
  for (uint8_t i = 0; i < 4; i++) slipWrite(tags[i]);
  uint32_t bits;
  memcpy(&bits, &value, 4);
  for (int8_t shift = 24; shift >= 0; shift -= 8) slipWrite((uint8_t)(bits >> shift));
  Serial.write(END);
}

/* ------------------------------------------------------------------------- */

void setup() {
  Serial.begin(BAUD);
  pinMode(LED_PIN, OUTPUT);
  pinMode(DIMMER_PIN, OUTPUT);
}

int lastSent = -1;
unsigned long lastSentAt = 0;

void loop() {
  while (Serial.available() > 0) feed((uint8_t)Serial.read());

  // Only when it has moved, and at most 25 times a second: the cable is
  // shared with everything OSCAR is sending the other way.
  if (SEND_SENSOR && millis() - lastSentAt >= 40) {
    int level = (int)(analogRead(SENSOR_PIN) * 100L / 1023);
    if (level != lastSent) {
      sendFloat("/meter1", (float)level);
      lastSent = level;
      lastSentAt = millis();
    }
  }
}
