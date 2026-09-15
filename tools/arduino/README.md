# Driving an Arduino from OSCAR

OSCAR sends OSC. An Arduino can receive it two ways, and which one you want
depends only on whether the board has a network of its own.

| Your board | Route | Sketch |
| --- | --- | --- |
| ESP32, ESP8266, Uno R4 WiFi, Nano 33 IoT, MKR WiFi, anything with an Ethernet shield | OSC straight over the network | [`oscar_wifi/`](oscar_wifi) |
| Uno, Nano, Mega, Leonardo, Pico — anything on a USB cable | OSC down the cable, SLIP-framed | [`oscar_serial/`](oscar_serial) |

Both sketches compile on a stock Arduino IDE with no libraries installed. The
OSC parsing is about forty lines and it is written out in full, because it is
also the part you will want to read when your own addresses do not arrive.

## Over the network

Nothing to configure in OSCAR. Put the board on the same Wi-Fi as the computer
running OSCAR, open `oscar_wifi/oscar_wifi.ino`, fill in your network name and
password, and upload it. The sketch prints the address to point at:

```
Point OSCAR's widgets at 192.168.1.42:8000
```

Put that address in each widget's **Ip** field and that port in **Port**.

## Over the USB cable

1. Upload `oscar_serial/oscar_serial.ino` to the board.
2. In OSCAR, open the **Serial** panel (the USB icon in the toolbar), choose the
   board's port, and press Connect. The baud rate must match the
   `Serial.begin(...)` in the sketch — 115200 in both by default.
3. Set each widget's **Ip** to `serial`. Its **Port** is ignored; a cable has
   none.

OSCAR remembers the port, so an installation that reboots comes back talking to
its hardware without anyone opening the editor. If the cable is pulled, OSCAR
keeps trying to reopen it every few seconds.

### If no ports are listed

- **Linux:** serial devices belong to the `dialout` group. Add yourself once and
  log out and back in: `sudo usermod -a -G dialout $USER`.
- **Windows:** some boards need their USB-serial driver (CH340, FTDI) installed
  before they appear at all.
- **Anywhere:** close the Arduino IDE's Serial Monitor. Only one program can
  hold a serial port at a time.
- If the panel says serial is unavailable in this build, the native serial
  driver did not install for your platform. Everything else in OSCAR still
  works; the network route above does not need it.

## What is actually on the wire

Plain OSC 1.0 messages, exactly as OSCAR sends them over UDP:

```
/master/level ,f  0.42
/strobe       ,T
/pad          ,ff 0.21 0.88
```

Over the cable those packets are wrapped in SLIP framing (RFC 1055), which is
the standard way OSC travels over a serial line — so a board running the CNMAT
`OSC` library with `SLIPEncodedSerial`, or `ArduinoOSC`, will read them too if
you would rather use a library than the sketch here.
