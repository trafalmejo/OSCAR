/*
 * OSCAR over a USB cable.
 *
 * Works with any Arduino, including the ones with no network of their own.
 * In OSCAR: open the Serial panel, connect this board's port, then set each
 * widget's Ip to `serial`. Its Port is ignored -- a cable has none.
 *
 * OSCAR sends ordinary OSC packets framed with SLIP (RFC 1055), which is the
 * standard way OSC travels over a serial line and what every Arduino OSC
 * library expects. The de-framing and parsing below is written out rather than
 * pulled from a library: it is the whole of what OSCAR sends, so this sketch
 * compiles on a fresh Arduino IDE with nothing installed.
 */

// SLIP framing bytes.
const uint8_t SLIP_END = 0xC0;
const uint8_t SLIP_ESC = 0xDB;
const uint8_t SLIP_ESC_END = 0xDC;
const uint8_t SLIP_ESC_ESC = 0xDD;

// One OSC message. OSCAR's are tens of bytes; a packet larger than this is not
// something this sketch was going to understand anyway.
const size_t MAX_PACKET = 128;
const uint8_t MAX_ARGS = 4;

const int LED_PIN = LED_BUILTIN;
const int DIMMER_PIN = 9;  // any PWM-capable pin

uint8_t packet[MAX_PACKET];
size_t packetLength = 0;
bool escaped = false;
bool overflowed = false;

/* An OSC value, kept in whichever form it arrived in. */
struct OscArg {
  char type;  // 'i', 'f', 's', 'T', 'F'
  int32_t i;
  float f;
  const char *s;
};

void setup() {
  // Match this to the baud rate set in OSCAR's Serial panel.
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  pinMode(DIMMER_PIN, OUTPUT);
}

void loop() {
  while (Serial.available() > 0) {
    feed((uint8_t)Serial.read());
  }
}

/* ---- SLIP ----------------------------------------------------------------
 *
 * Bytes arrive one at a time; END closes a packet, ESC quotes the two bytes
 * that would otherwise be mistaken for framing.
 */
void feed(uint8_t b) {
  if (b == SLIP_END) {
    if (packetLength > 0 && !overflowed) handlePacket(packet, packetLength);
    packetLength = 0;
    escaped = false;
    overflowed = false;
    return;
  }

  if (escaped) {
    escaped = false;
    if (b == SLIP_ESC_END) b = SLIP_END;
    else if (b == SLIP_ESC_ESC) b = SLIP_ESC;
    // Anything else is a protocol error; take the byte as it came.
  } else if (b == SLIP_ESC) {
    escaped = true;
    return;
  }

  // A packet too long to hold is dropped whole at the next END. Keeping the
  // first half would look like a valid message carrying the wrong value.
  if (packetLength >= MAX_PACKET) {
    overflowed = true;
    return;
  }

  packet[packetLength++] = b;
}

/* ---- the OSC bit ---------------------------------------------------------
 *
 * An OSC message is an address, then a type tag beginning with ',', then the
 * values -- each padded out to a multiple of four bytes.
 */

/* Where the next field starts, given the length of this one. */
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

      case 's':
        if (offset >= length) return;
        arg.s = (const char *)(buffer + offset);
        offset += padded(strnlen(arg.s, length - offset));
        break;

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
