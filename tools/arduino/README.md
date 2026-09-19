# OSCAR and Arduino

Two sketches, no libraries to install for either. Each parses OSC in about
forty lines you can read, and answers the widgets OSCAR creates out of the
box: a Button (`/push1`) switches the built-in LED and a Slider (`/slider1`)
dims a PWM pin.

| Your board | Sketch | What OSCAR needs |
| --- | --- | --- |
| ESP32, ESP8266, Uno R4 WiFi, Nano 33 IoT, MKR WiFi, anything with an Ethernet shield | `oscar_wifi` | **Nothing.** |
| Uno, Nano, Mega, Leonardo, Pico, anything on a USB cable | `oscar_serial` | The Serial panel |

## Wi-Fi or Ethernet: nothing to set up

**This works with every OSCAR that has ever shipped, with no setting
anywhere.** OSCAR sends OSC over UDP to whatever IP and port a widget names.
A board on your network is one more thing with an IP and a port, exactly
like Resolume or TouchDesigner.

1. Put your network name and password at the top of `oscar_wifi.ino` and
   upload it.
2. Open the Arduino IDE's Serial Monitor at 115200. The board prints
   `In OSCAR, set the widget's Ip to 192.168.1.57 and its Port to 8000`.
3. Type those into the widget's **Ip** and **Port**. Done.

To send a sensor back, fill in `OSCAR_IP` in the sketch with the address of
the computer running OSCAR (OSCAR prints it at startup as "On your
network"). The board then sends `/meter1` to OSCAR's OSC-in port, 9000, and a
Meter widget shows it with no settings changed.

If nothing arrives: the board and the computer must be on the same network
(a guest Wi-Fi usually keeps devices from seeing each other), and the
board's address can change when the router restarts - reserve it in the
router if the installation is permanent.

## USB cable: the Serial panel

1. Upload `oscar_serial.ino`.
2. **Close the Serial Monitor** (see below).
3. In OSCAR's editor, open the **Serial** panel - the USB icon in the
   toolbar. Pick the board's port, leave the rate at 115200 (it must match
   `BAUD` in the sketch) and press **Connect**.
4. Set a widget's **Ip** to the word `serial`. Its **Port** is not used.

The port is opened by the computer running OSCAR, so tablets showing the
surface drive the board too. OSCAR remembers the port, reopens it at
startup, and keeps retrying every two seconds if the cable is pulled or the
board resets. With `SEND_SENSOR` switched on, the sketch reports a
potentiometer on A0 as `/meter1` for a Meter widget with **Listen** on.

Messages travel as OSC framed with SLIP (RFC 1055), which is what
`osc.SerialPort` in osc.js, CNMAT's `SLIPEncodedSerial` and most other OSC
software speak over a serial line - so your own sketch can use a library
instead of our parser if you prefer.

### Only one program can hold a serial port

This is behind most "it does nothing" reports.

- **The Serial Monitor or Serial Plotter is open.** OSCAR's panel stays on
  "Waiting for COM3 ... Access denied" (Windows) or "Resource busy" /
  "Cannot lock port" (macOS, Linux). Close the monitor; OSCAR connects by
  itself within two seconds.
- **Uploading a sketch while OSCAR is connected** fails in the Arduino IDE
  with "port busy" or "access denied". Press **Disconnect** in the Serial
  panel, upload, then **Connect** again.
- **Do not `Serial.print()` in the serial sketch.** The line carries OSC;
  text on it is noise. OSCAR ignores it (and notes it in its log at most
  once every five seconds), but it costs bandwidth and a stray byte can
  corrupt the message next to it. Blink an LED to debug instead.

Most boards reset when the port is opened, so the first second or two after
**Connect** goes to the bootloader. Messages sent in that moment are lost,
not queued - move the slider again.

### The port is not in the list

- **Clone boards with a CH340 or CH341 chip** (most inexpensive Nanos and
  Unos; the chip next to the USB socket says CH340G or similar). Windows 10
  and 11 usually fetch the driver by themselves; if the board shows up in
  Device Manager as "USB2.0-Serial" with a warning sign, install the CH341SER
  driver from the chip's maker, WCH (wch-ic.com). macOS 10.14 and later has
  the driver built in - do not install an old one over it. Linux has had it
  in the kernel for years; if the port appears and vanishes on Ubuntu, remove
  the `brltty` package, which claims the chip for a braille display.
- **Boards with CP2102 / CP2104** (many ESP32 dev boards) need Silicon Labs'
  "CP210x VCP" driver on Windows and older macOS.
- **A charge-only USB cable** has no data wires. If no port appears on any
  computer, try another cable before anything else.
- Press **Refresh list** after plugging in; the list is read when asked for,
  not watched.

### Linux: permission denied

Serial ports belong to a group your user is not in by default. OSCAR's panel
shows "Permission denied, cannot open /dev/ttyACM0". Add yourself, then log
out and back in (the change does not reach programs that are already
running):

    sudo usermod -a -G dialout $USER     # Debian, Ubuntu, Raspberry Pi OS, Fedora
    sudo usermod -a -G uucp $USER        # Arch, Manjaro

Boards appear as `/dev/ttyACM0` (genuine Uno, Leonardo, Pico) or
`/dev/ttyUSB0` (CH340, CP2102, FTDI). On macOS pick the `/dev/cu.*` name,
not `/dev/tty.*`.

### "No serial support in this build"

OSCAR for Windows on ARM ships without the serial driver, because the
`serialport` release it depends on has no binary for that platform.
Everything else works. Use a board with Wi-Fi, or run OSCAR on an x64
machine. Running from source, the same message means `serialport`'s optional
native module did not install; `npm install` again and read its output.

### Why not Web Serial?

Browsers have a serial API (`navigator.serial`), and OSCAR deliberately does
not use it. It opens a port on the device showing the page - the tablet in
someone's hand, not the computer the board is plugged into - it asks for
permission again in every new session, and Safari and Firefox do not have it
at all. The server opening the port once, for every device, is the design
that fits an installation.

## Writing your own sketch

Keep `parseOsc()` and change `onOsc()`. The things that matter:

- **Check `isNumber` before using a number.** A widget set to send text must
  not be read as 0. On a lighting rig 0 means off.
- A Slider sends Min..Max as set in its settings (0..100 by default), as a
  float unless you change **Argument type**. A Button sends its On and Off
  values, 1 and 0 as ints by default. An XY pad sends two floats in one
  message, or `/pad/x` and `/pad/y` separately, depending on its send mode.
- On an Uno, keep `packet[]` small: it has 2 KB of RAM in total.
