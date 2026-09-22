![](assets/css/headerColor.png)

# OSCAR - Visit [our website](https://www.createwithoscar.com/)

OSCAR is a tool to create beautiful graphical user interaces (GUIs) to send OSC messages and control interactive installations ([Modul8](https://www.garagecube.com/modul8/), [MapMapper](https://madmapper.com/), [Resolume arena](https://resolume.com/), [TouchDesigner](https://derivative.ca/), [Ableton Live](https://www.ableton.com/), [Processing](https://processing.org/), [Pure Data](https://puredata.info/), [Unity](https://unity.com/), [Unreal Engine](https://www.unrealengine.com/en-US/), etc).
Let's create beautiful, responsive and touchable interfaces.

Build a layout in the browser, drop in buttons and sliders, point each one at an IP, port and OSC address, then open the same page from a phone or tablet on the same network and use it as a control surface.

<a href="https://www.youtube.com/watch?v=JO6r7gUNlgo&list=PLScMjUz4HRHxxDL2OYcNCMCsD-srohkIW" target="_blank"><img src="http://img.youtube.com/vi/ZcW8zBWRLf0/0.jpg" alt="OSCAR tool to create GUIs to control interactive installations" width="1200" height="600" border="10"/></a>

## Download

Get the installer for your machine from the
[latest release](https://github.com/trafalmejo/OSCAR/releases/latest):

| Your machine | File |
| --- | --- |
| **Windows** (most PCs) | `OSCAR-*-win-x64.exe` |
| **Windows on ARM** (Snapdragon laptops) | `OSCAR-*-win-arm64.exe` |
| **Mac** with Apple Silicon (M1 and later) | `OSCAR-*-mac-arm64.dmg` |
| **Mac** with an Intel processor | `OSCAR-*-mac-x64.dmg` |
| **Linux** (most distributions) | `OSCAR-*-linux-x86_64.AppImage` |
| **Linux** (Debian, Ubuntu) | `OSCAR-*-linux-amd64.deb` |
| **Raspberry Pi** and other ARM Linux (64-bit OS) | `OSCAR-*-linux-arm64.AppImage` or `OSCAR-*-linux-arm64.deb` |

These builds aren't code signed, so your system warns you the first time. On
Windows, click *More info* then *Run anyway*. On macOS, right-click the app and
choose *Open*.

The first time OSCAR is opened in a browser, the canvas shows the **Showcase** template, where every widget works, so there is something to try straight away. After that the canvas is whatever you left on it, including empty. It is a template like any other: open **Load** to get it back, or to start from another.

## Keep in touch

[**Sign up to the OSCAR mailing list**](https://forms.gle/1pGiDJDh3jur8Tq68) to
hear about new releases, features and tutorials.

OSCAR is a free and open source project, and it is better for every bit of
feedback it gets. If you build something with it, we would love to know.

## Running from source

Requires [Node.js 18 or newer](https://nodejs.org/en/).

```bash
git clone https://github.com/trafalmejo/OSCAR
cd OSCAR
npm install     # also installs the browser libraries under public/
npm start       # builds the bundle and starts the server
```

OSCAR opens your browser at `http://localhost:8080` and also prints a LAN
address such as `http://192.168.1.20:8080`. Open that second address on a phone
or tablet on the same Wi-Fi to use the interface as a control surface.

Make sure your firewall allows communication between devices on the network.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Build the browser bundle, then run the server |
| `npm run serve` | Run the server without rebuilding |
| `npm run serve:at -- 18100` | Run the server on explicit ports (see below) |
| `npm run dev` | Rebuild on change and restart on change |
| `npm test` | Run the test suite |

### Running on explicit ports

To run a second copy of OSCAR on one machine -- while developing next to a
running show, say -- every port has to move, including the two source ports
OSC is sent from. `serve:at` takes the HTTP port and derives the rest from it,
so one number keeps a copy out of everyone else's way:

```bash
npm run serve:at -- 18100                 # http 18100, socket 18101, OSC in 18102, sources 18103/18104
npm run serve:at -- 18100 18101 18102     # the same, with socket and OSC-in ports given explicitly
```

It works the same in PowerShell, cmd and a Unix shell, and does not open a
browser. A port given on the command line always wins, even over an
`OSCAR_HTTP_PORT` left in your shell profile (you are told when that
happens). A port you did not give is derived from the HTTP port unless the
matching `OSCAR_*_PORT` variable is already set, in which case the variable
wins. Two ports landing on the same number, or a value that is not a port,
stop the start with both named. To set ports by hand instead, use the
variables under [Configuration](#configuration):

```bash
OSCAR_HTTP_PORT=8090 OSCAR_SOCKET_PORT=8091 OSCAR_LAN_PORT=5003 OSCAR_LOCAL_PORT=5004 npm run serve
```

A variable set to something that is not a port stops the server with a
message naming it, rather than falling back to the default and colliding with
whatever you were trying to avoid.

### Building a desktop app

OSCAR ships as an Electron app. `npm run electron` runs it from source, and
the `dist` scripts produce installers under `release-builds/`:

| Command | Output |
| --- | --- |
| `npm run electron` | Run the desktop app from source |
| `npm run dist:win` | Windows installer (NSIS) |
| `npm run dist:mac` | macOS disk image |
| `npm run dist:linux` | Linux AppImage and .deb, for x64 and arm64 |

Each platform's installer has to be built on that platform. All three are
built for both Intel (`x64`) and ARM (`arm64`); on Linux the ARM build is what
runs on a Raspberry Pi with a 64-bit OS. Electron no longer ships a 32-bit
Windows build. Icons are generated from `build/icon.png`.

### Cutting a release

Releases are built by GitHub Actions. Pushing a `v*` tag builds OSCAR on
Windows, macOS and Linux in parallel and attaches all the installers to a
**draft** GitHub release, which you then write notes for and publish:

```bash
npm version 2.1.0        # bumps package.json and creates the tag
git push --follow-tags   # builds all three platforms, draft release appears
```

To re-cut the current version in package.json, tag it directly:

```bash
git tag v2.0.0 && git push origin v2.0.0
```

Running the workflow by hand from the Actions tab builds the installers and
leaves them as downloadable run artifacts without creating a release — useful
for checking a build before tagging.

Builds are **not code signed**, so Windows SmartScreen and macOS Gatekeeper
will warn on first run. On macOS, right-click the app and choose Open.

When run as a desktop app, projects are stored in the per-user data folder
(`%APPDATA%/OSCAR/projects` on Windows, `~/Library/Application Support/OSCAR/projects`
on macOS) rather than next to the executable.

### Configuration

All optional, set as environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OSCAR_HTTP_PORT` | `8080` | Web interface |
| `OSCAR_SOCKET_PORT` | `8081` | Browser-to-server OSC bridge (browsers are told the port) |
| `OSCAR_LAN_PORT` | `5001` | Source port for OSC sent to the network |
| `OSCAR_LOCAL_PORT` | `5002` | Source port for OSC sent to this machine |
| `OSCAR_OSC_IN_PORT` | `9000` | Where OSC coming back from the rig is received |
| `OSCAR_DMX_PORT` | `0` (any free port) | Source port Art-Net and sACN are sent from; `6454` for a node that insists on it |
| `OSCAR_DMX_HOLD_ON_EXIT` | unset | Set to `1` to leave DMX fixtures on their last look when OSCAR quits, instead of releasing them |
| `OSCAR_PROJECTS_DIR` | `./projects` | Where saved projects are written |
| `OSCAR_NO_OPEN` | unset | Set to `1` to not open a browser on start |
| `OSCAR_NO_UPDATE_CHECK` | unset | Set to `1` to never check for new versions |

### Update checks

Once a day at most, OSCAR asks GitHub whether a newer version has been
released, and shows a dismissible notice in the editor if so. Nothing is
downloaded or installed automatically, and you can skip a version or turn the
check off entirely with `OSCAR_NO_UPDATE_CHECK=1`.

This is the only request OSCAR makes to the internet. It sends nothing about
you or your projects, times out quickly, and failing silently is the expected
case on a venue network with no internet access.

## Widgets

Drag these in from the **OSC** category, then set each one's IP, port and
message in the settings panel (the gear icon).

| Widget | Sends |
| --- | --- |
| **Button** | its Value ON when pressed, its Value OFF on release. As a toggle, it alternates. Leave Value OFF blank and it says nothing on release: software whose `/go` takes no argument must not hear it twice |
| **Slider** | its value as it moves, with optional inverted range |
| **XY Pad** | both values at once — `/pad 30 70` — or as `/pad/x` and `/pad/y` |

On the XY pad, Y increases upward, and either axis can be inverted. Dragging
sends at most one message per frame, and always sends the exact value where
you let go.

A slider can be **Vertical** from its Orientation setting. A size you have
given a slider with the resize handles is kept when it turns: a wide, short
box makes a squashed vertical control, so switch the orientation first and
resize afterwards, or clear the width and height in the Style Manager.

### Following the rig (OSC in)

OSCAR also receives. It listens for OSC on UDP port `9000`
(`OSCAR_OSC_IN_PORT`), the port TouchOSC and Lemur offer first; point your
software's OSC output at OSCAR's IP and that port. OSC runs both ways, so a
widget's **OSC** section opens with a checkbox per direction: **Data in** and
**Data out**. Tick **Data in** on a widget and it follows whatever arrives at
its own Message address: a slider's
thumb moves, an XY pad's handle jumps (`/pad 30 70`, or `/pad/x` and `/pad/y`
in two-message mode), and a toggle button lights up and adopts the state, so
the next press sends the opposite edge. A momentary button only lights up,
because its state is your finger's.

On a published surface OSCAR reads the message once and tells every device the
result, the same way it tells them about a finger on a button. So every tablet
shows the same thing, one that opens the surface later shows where the rig left
it, and it works with no device looking at all. The media browser is the one
exception: each page reads the message for itself.

You do not have to type the address. Click **Learn** on the title of the
widget's OSC section, then send a message from your software (move the thing you
want the widget to follow). The widget takes the address of the first message
that arrives and turns **Data in** on. Learn gives up after fifteen seconds, and a
second click calls it off.

Data in is off by default, so nothing starts moving on its own. Untick **Data
out** and a widget keeps following the rig while sending nothing. **Master
comms**, at the top of every widget, is over all of it: a widget with it off
is deaf as well as silent on every protocol, so you can lay a surface out
while the rig is live. A hand on a control outranks the network: while you
are dragging a slider or a pad, or holding a button, what arrives is ignored
until you let go. A widget never sends in answer to what it hears, so software
that echoes its own state cannot start a loop with OSCAR. A value that cannot
be read as a number is ignored, never treated as `0`. A button that sends no
argument has nothing to follow: a bare address says nothing about its state.

Incoming addresses may be OSC 1.0 patterns -- `/layer*/clip`, `/ch[1-3]`,
`/{play,stop}` -- and reach every widget they match; a widget's own Message is
always taken literally, and always reached by its own exact text, even one
like `/layer[1]/opacity`. Software that answers to the port a message came
from (OSCAR's source ports, `5001` and `5002`) is heard as well, so replies
need no configuration. If the OSC-in port is busy or cannot be opened when
OSCAR starts, it says so and carries on: sending is unaffected.

### Driving lights directly (DMX over Art-Net and sACN)

A button, slider or XY pad can drive lighting fixtures directly, with no
lighting software in between. A widget's settings are grouped in collapsible
sections, one per protocol. DMX only runs one way, from the desk to the
fixture, so its section has the one direction: open **DMX** and tick **Data
out**. Leave OSC's **Data out** ticked to keep driving software at the same
time, or untick it to drive the fixture alone. Each section's title carries a
small light per direction, **IN** and **OUT**, green while that direction is
live, so a collapsed section still says what it is doing. The DMX section
holds:

| Setting | Meaning |
| --- | --- |
| **Protocol** | Art-Net (UDP 6454) or sACN / E1.31 (UDP 5568) |
| **Node** | The node's address. Blank broadcasts on Art-Net and multicasts on sACN, which every node on that network hears |
| **Universe** | `0`-`32767` on Art-Net (the 15-bit Port-Address), `1`-`63999` on sACN |
| **Channel** | The first channel of the widget's block, `1`-`512` |
| **Channels** | How many channels from there |

A slider sends its level (`0`-`255` across its own Min-Max range, so a slider
labelled 20-2000 still means full at the top; Invert mirrors it). A button
sends full while on and out while off, whatever its Value ON and OFF say for
OSC. An XY pad puts X on the first channel and Y on the next: pan and tilt on
a moving head. Values fill the block in order and the last one repeats, so a
slider over three channels dims an RGB fixture as a whole. A block that would
run past channel 512, or is too narrow for the widget's values, is refused in
the panel and never sent. OSC's Data out is on and DMX's is off on every widget
until you change them, so a project made before this existed behaves exactly
as it did, and one saved while this was a single **Output** list opens with
the matching boxes ticked.

DMX is a stream, not a message: fixtures expect the frame to be repeated, and
an sACN receiver drops a source that goes quiet for 2.5 seconds. So OSCAR
keeps every universe it drives on the air until the widget driving it is
deleted or switched back to OSC, or OSCAR quits, and then hands the channels
back by sending them at zero (on sACN, with the stream-terminated packets the
standard asks for). Several widgets on one universe are merged
highest-takes-precedence where their blocks overlap, as a lighting desk
would. A tablet disconnecting or a phone locking its screen releases nothing:
whatever it last set stays up until something changes it. Quitting OSCAR
releases everything unless `OSCAR_DMX_HOLD_ON_EXIT=1`, for a permanent
installation that should hold its look through a restart. As with OSC, a
value that cannot be read is dropped rather than sent as `0`: a dropped value
must never black a rig out.

Packets leave from any free port (`OSCAR_DMX_PORT`), so OSCAR can run next to
lighting software that itself receives Art-Net on 6454. If the port you pin
cannot be opened, OSCAR says so at startup and everything else still works.

On a computer with more than one network connection -- Wi-Fi for the internet
and a cable to the lighting switch, say, or a virtual machine's adapter -- a
blank node is not enough: the operating system puts a broadcast on one
connection only, usually the one with internet on it, and the node on the
other never hears it. Name the node's address, or the lighting network's own
broadcast address (`2.255.255.255` or `10.255.255.255` for the ranges Art-Net
nodes ship on), and the packets go the right way.

## Running a show

The editor lives at `/`. The control surface lives at `/preview` — the same
layout with every editing tool stripped out, which is what you open on a phone
or tablet.

Press **Push to preview** (the eye icon) to send the current layout to it.
Every device showing `/preview` picks the new layout up straight away; there is
no need to walk over and reload them.


### Sending MIDI

Every widget that can drive DMX can send MIDI: open the **MIDI** section of its
settings and tick **Data out**. It is a third protocol beside OSC and DMX, and
any of the three can be on at once.

| Setting | |
| --- | --- |
| **Data in**, **Data out** | A checkbox per direction, as for OSC. Both off on a new widget. |
| **In port** | The MIDI port to listen on, from a list of the ports the computer running OSCAR has. Ticking Data in picks the first one, and Learn the one you touch. **First port** is whichever is first at the time. **All MIDI inputs** listens on every port, which on Windows takes them all from other programs. |
| **Out port** | The MIDI port to send to, from the same kind of list. **First port** is whichever is first at the time. |
| **Channel** | 1 to 16. Shared by both directions, as Type and Number are. |
| **Type** | Control change, Note, Program change or Pitch bend. |
| **Number** | The controller or note number, 0 to 127. |

What a widget sends is its value scaled to MIDI's 0 to 127, the way DMX scales
it to 0 to 255: a slider at the top of its range sends 127 whatever its Min and
Max. A button sends note on at full velocity and note off, or 127 and 0 as a
controller. A widget with several values uses the numbers that follow: a pad set
to controller 20 sends X on 20 and Y on 21, a colour sends red, green and blue
on three in a row. Program change sends a dropdown's value as it is when that is
a whole number from 0 to 127, so options valued 0, 1, 2 pick programs 0, 1, 2.
Pitch bend uses all 14 bits.

The ports belong to the computer running OSCAR. A tablet or a phone showing a
published surface sends MIDI through it, exactly as it sends OSC and DMX.

To reach software on the same computer (Ableton Live, Resolume, a DAW) you need
a virtual MIDI port. macOS has one built in: enable the **IAC Driver** in Audio
MIDI Setup. On Windows install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
and create a port; OSCAR then lists it. On Linux, `snd-virmidi` or a JACK/ALSA
bridge does the same.

OSCAR opens a port the first time a widget sends to it and keeps it open. If the
instrument is unplugged, it is looked for again every two seconds and picked up
when it returns. Only notes, controllers, programs and bends are sent; system
exclusive and clock are refused.

#### MIDI in: a widget that follows a controller

Tick **Data in** in the MIDI section and a knob, fader or pad on a MIDI
controller moves the widget, on every page that shows it, the editor's canvas
included. It is OSC's Data in over another wire, and keeps the same rule: **what
comes in is never sent out**. The widget follows and says nothing, not in OSC,
not in DMX, not in MIDI, so nothing can loop. A hand on the same widget sends as
it always did.

Click **Learn** on the title of the MIDI section and touch the control: the
widget takes its port, channel, type and number. While Learn is waiting, what
you play moves no other widget.

- A fader, a number box: the level, across the widget's own Min to Max.
- A button: held while a note is held; with a controller, on from halfway up. A
  button set to Toggle changes over on each press and ignores the release.
- A dropdown: a program change picks the option with that value, or failing
  that the option at that position. Any other message picks along the list.
- A pad: the Number is X and the next one up is Y. A colour: red, green and blue
  on three in a row. What is not touched stays where it was.

OSCAR only opens the input ports that the widgets on an open page listen on, or
every port if one of them asks for **All MIDI inputs**, and lets go of them when
the last such page closes. On Windows a MIDI input belongs to whichever program opened it
first, so a controller OSCAR is listening to is not available to other
software, and the other way round; the console says when a port is in use.

There is a second way for MIDI in to work, built and switched off:
`MIDI_BRIDGE` in `lib/features.js`. With it on, a knob works a widget **as a hand
would**: the widget also sends its OSC and DMX, which makes OSCAR a MIDI to OSC
and DMX bridge (it still never answers in MIDI). The server then does the
sending, once, for the widgets of published surfaces, since pages answering the
knob themselves would make the rig hear every move once per open page.

`MIDI` in `lib/features.js` hides the section if it has to be taken out of a
release. About (Report a problem) says how many ports OSCAR can see, which is
the first thing to check when nothing arrives or nothing is heard.

### Locking an installation

By default anyone on the network can open the editor at `/` and change things.
For an installation or a show, press the padlock in the toolbar.

While OSCAR is locked:

- Other devices can still open `/preview` and use the controls
- Visiting `/` from another device sends them to `/preview` instead
- Saving, loading and deleting projects are refused
- Only the computer running OSCAR can edit, or unlock it again

Physical access to that computer is what grants editing, so there is no
password to leak over a venue's network or forget before doors open. The
setting is remembered, so a machine that reboots overnight comes back locked.
`OSCAR_LOCKED=1` starts it locked.

This stops editing, not sending: the OSC bridge stays open, because that is how
the tablets work at all. Anyone who can reach OSCAR can still send OSC to your
rig. If that matters, the answer is a separate network for the control devices,
not a setting in OSCAR.

## Saving your work

The canvas autosaves into your browser as you work.

**Save** and **Load** keep a library of named projects, stored as plain JSON
files in the `projects/` folder next to OSCAR. They are ordinary files, so you
can copy, back up and share them however you like.

> **Note for OSCAR 1.x users:** the old online accounts at
> `account.createwithoscar.com` no longer exist. OSCAR now stores everything on
> your own machine, and no longer asks you to log in.

### Templates and widget styles

**Load** also lists the templates OSCAR ships with: whole surfaces to start
from, every control on them live. Some are built for one piece of software
and carry a card listing its addresses: the **Resolume Video Desk** (a clip
grid, layer strips, crossfader, master, tempo; Resolume's own addresses, port
7000) and the **QLab Stage Manager's Desk** (GO, STOP, PANIC, playhead and a
cue sheet; QLab's own addresses, port 53000, every key a bare address sent
once) and the **TouchDesigner Parameter Rack** (parameters out, an audio level and a sensor back in, with the two-CHOP recipe on its card; an OSC In CHOP listens on port 10000; next to it in `public/templates/` is `touchdesigner-parameter-rack.py`, a script that builds the whole demo network inside TouchDesigner in one go, so the picture moves and the two meters read something; it wears the Sci-fi HUD style rather than a look of its own). **Big Thumb** puts one control on each screen of a phone, the size of a
hand. The rest are objects to play with: a boombox, a walkie-talkie, an arcade
cabinet, a cassette player, a CD player, a click-wheel player, a turntable and
a TV remote. A template that is built for one program has been written from
that program's documentation; if you have it, try it and tell us what moved.

The **widget style** picker in the top bar dresses every control at once:
Default, Amber Minimal, Cyberpunk, Supabase, Tangerine, **Neon** (every
control a lit tube, with the flicker of one striking) and **Sci-fi HUD**
(corner brackets, a segmented meter, a crosshair on the pad), each light or
dark. A template that brings its own look is listed as *Page's own*; pick a
style and it is redrawn in that style's colours.

## How it works

```
Browser (grapesjs editor + OSCAR widgets)
   |  socket.io  :8081
   v
OSCAR server (Node/Express)
   |  UDP
   v
Your lighting / video / sound software
```

Widgets carry their own OSC settings (IP, port, address, value). When you press
a button or move a slider the browser sends that over socket.io to the OSCAR
server, which emits the actual OSC packet over UDP.

## Tutorials

1. Youtube Channel [OSCAR](https://www.youtube.com/channel/UCyIxOoajn_4Nj8Mjz2k-3qA)

## Contributing

Bug reports and pull requests are welcome on the
[issue tracker](https://github.com/trafalmejo/OSCAR/issues), and you can
[sign up for OSCAR news](https://forms.gle/1pGiDJDh3jur8Tq68) to follow along
with what is coming next.

## License

BSD 3-clause

## Meter (level display)

A **Meter** shows a level instead of sending one: an audio level, a fixture's
intensity, a playhead, whatever the rig reports at the address in its Message
setting. It sends nothing, so it has no IP or port, and Data in is on from the
start. Min and Max are the scale, the bar is horizontal or vertical from its
Orientation setting, and Value is where it sits until the first reading
arrives, so you can see the layout before anything is feeding it.

A level can also come from a MIDI controller: the meter's **MIDI** section has
Data in, the port, channel, type and number, and **Learn**, and no Data out.
The controller's 0 to 127 is laid across Min to Max.

**Peak hold** keeps a marker at the highest recent reading for that many
seconds (`0` turns it off). A reading at or above the marker moves it up at
once; when the hold has passed the marker falls back onto the bar on its own,
whether or not anything new has arrived, so it works with software that only
sends a value when it changes. It falls to the last reading, never to zero: a
meter fed nothing keeps showing its last reading.

A meter never drops to zero on its own. A value that cannot be read as a
number holds the last reading, because an empty bar reports silence on a
channel that may be at full, and a meter with **Master comms** off freezes where
it is rather than emptying.

## Colour picker

The **Colour** widget is the tablet's own colour picker: tap the swatch and
the operating system's picker opens. Dragging inside it sends at most one
message per frame, and closing it sends the exact colour chosen. **Send as**
chooses the shape on the wire and **Range** the scale, because software
disagrees on both:

| Send as | On the wire |
| --- | --- |
| **3 values (r, g, b)** | `/colour 1.0 0.533 0.0` |
| **4 values (r, g, b, a)** | the same with the **Alpha** setting appended |
| **hex string (#rrggbb)** | `/colour "#ff8800"` |

**Range** is `0 to 1` for software that reads a colour parameter as floats
(Resolume) or `0 to 255` for software that reads pixel values (TouchDesigner
and most pixel-minded tools). Alpha is a setting rather than part of the
picker, because no native picker has an alpha channel; it is always typed as
`0`-`1`, whatever Range says, and a blank or unreadable Alpha stops the
message rather than going out as `0`, which is fully transparent. The
**Colour** setting is the swatch's value as a hex code, so a colour can be
typed as well as picked; `#f80` and `f80` both mean `#ff8800`.

With DMX's **Data out** ticked, red, green and blue land on three consecutive
channels, whatever Send as and Range say, so the block is three channels
wide by default and drives an RGB fixture as it stands; over a wider block
the blue repeats, and a narrower one is refused. Alpha never reaches the
fixture. With **Data in** on, a colour arriving at Message fills the swatch
in either shape OSCAR sends -- the hex string, or three channels on the
configured Range, with a fourth ignored. Channels may arrive as numbers or
as numbers spelled as text; three readable numbers are always channels, even
when the first (`"255"`, `"000"`) would also pass for a short hex code. A
colour that cannot be read leaves the swatch as it was: the native control
turns anything it does not understand into black, and a rig sending nonsense
must not black a colour out.

While a colour is being dragged inside the picker the rig is not heard, so
the swatch is not snatched from under the hand. That holds on pickers that
report the colour as it moves (macOS, iOS). A picker that reports only when
it is closed (the Windows dialog, Android) gives the page no sign that it is
open, so a colour arriving meanwhile repaints the swatch behind it; pressing
OK still sends the colour that was picked.

**Argument type** int needs **Range** `0 to 255`. Whole numbers on `0 to 1`
would round every channel to 0 or 1 -- eight colours in all, and a middling
Alpha going out as 0 -- so the panel refuses the combination.

## Typing a value (text, number and dropdown widgets)

Three widgets take a value directly instead of from a gesture, for the cues
you already know: a clip name, cue 12, exactly 127.

| Widget | Sends |
| --- | --- |
| **Text Input** | whatever you type, as a string by default, or as any other argument type |
| **Number Input** | the number you type, as a float or an int, with optional **Min**, **Max** and **Step** |
| **Dropdown** | the value of the option you pick |

The text and number boxes send when you press **Enter** or leave the box,
never while you type: `12.5` would otherwise go out as `1`, then `12`, then
`12.5`, and the first two are real cues a rig will act on. Enter sends even
when the value has not changed, because re-sending a cue on purpose is a
normal thing to do. A click on the number box's stepper arrows is one
finished value and goes out at once. An empty or half-typed box sends
nothing, and neither does a number outside Min-Max or off the Step: the box
keeps what you typed and shows a red edge, rather than the rig going to a
value nobody typed.

A dropdown's options are typed on one line in its **Options** setting, as
`Label=value` pairs separated by commas or semicolons -- `Red=1, Green=2,
Blue=3` -- or bare values, `1, 2, 3`, which are their own labels. The list is
built from that setting every time the widget is drawn and is never stored
in the markup, so it cannot drift from what the panel says.

The panel refuses a value the chosen **Argument type** cannot carry -- `abc`
as a float -- and checks the other way round too: switching a box that holds
`GO` to float, or a dropdown whose options say `Red, Green` to int, is
refused rather than leaving a widget that looks live and sends nothing.

The number box and the dropdown can drive DMX like the slider (tick **Data out** in its **DMX** section).
The number is the level: `0`-`255` as typed, or, when Min and Max are both
set, scaled within them, so a box that takes `0`-`100` puts `50` at half. A
dropdown of `Off=0, Half=128, Full=255` is a three-step dimmer. All three
follow the rig with **Data in** on: a value arriving at Message fills the box
or selects the option that sends it, and goes no further. A box you are in
the middle of typing into is left alone until you commit or leave it, and a
value no option sends leaves the dropdown where it was.

A typed DMX level is refused, not pinned, when it is out of range: without
both Min and Max the box's limits are `0`-`255`, so a slipped `-1` is not a
blackout and `300` is not full. While DMX's **Data out** is ticked the panel
likewise refuses a dropdown option that is not a number from `0` to `255`.
The settings are checked against each other: a Min, Max, Step, DMX Data out or
Argument type that the current Value could not be sent under is refused until
the Value is changed, and a value arriving from the rig is brought inside the
limits and onto the Step, so Enter on what the box shows always sends.

An empty text box sends nothing under any argument type, and the Enter that
confirms an IME composition is not a send. Two dropdown options may not send
the same value -- the value is all that is stored, so the second could never
be shown again -- and a label may contain `=`: the value is what follows the
last one. Walking a dropdown with the arrow keys sends only the row you stop
on, when you press Enter or leave the list; a click or a tap sends at once.

## Several devices on one surface

Every device showing the same layout shows the same state. Toggle a button
on one tablet and it lights up on the others, so the next press anywhere
sends the opposite edge rather than the one that has already gone out; move a
slider or an XY pad and the thumb or handle moves on every other device. A
tablet that connects mid-show is caught up the moment it loads the surface,
and a widget following the rig with **Data in** on passes what it hears along
too, so a device joining later starts where the rig left things. Nothing
needs switching on: two tablets agreeing is not a setting.

Only what a widget shows travels -- on or off, a value, a position -- keyed
by the widget's id in the project, over the same socket the OSC bridge uses.
The device that acted is the only one that sends OSC or DMX: the others
redraw and stay silent, and a device is never told what it just said itself,
nor anything that did not actually change, so two tablets cannot trade the
same value back and forth. A hand outranks the network here as it does with
OSC in: while you are dragging a slider or a pad, or holding a button, what
the other devices report is ignored until you let go. Pushing a new layout
to the preview forgets every state, because the widgets in the old one may
not exist in the new.

The devices are the pages showing the surface (`/preview`). The editor is
not one of them: it neither follows the tablets nor moves them, so a show
running on the tablets never rewrites the values saved in the project you
have open, and a different project open in the editor cannot reach them.
What the rig sends is recorded for whoever joins later but not passed
between the tablets, since each of them heard it already. A slider catches
up when you lift your finger with whatever another device did while you were
resting on it; a momentary button held on a tablet that drops off the
network is let go on the others; and if the server restarts, the tablets
tell it again what they show when they reconnect.

## Media browser (pick a clip by its picture)

A grid of thumbnails for choosing what plays: one tap on a tile sends that
tile's value to **Message**, which is how Resolume, Millumin, QLab and most
clip launchers select a clip -- by index or by name.

The tiles are typed on one line in the **Items** setting, separated by
semicolons, each as `label`, `label|value` or `label|value|image`:

```
Forest; Waves; Stars                         sends 1, 2, 3 -- the tile's position
Forest|7; Waves|12                           sends 7, 12
Forest|forest_loop|thumbs/forest.jpg         sends "forest_loop" (Argument type: string)
```

A tile with no value sends its position, counted from 1. **Argument type**
is int, float or string. The image is a path next to OSCAR's pages (anything
under `public/`, for example `assets/thumbs/forest.jpg`), an `http(s)://`
address, or a `data:image/...` URL; anything else -- `javascript:`,
`data:text/html` -- is refused by the panel and never reaches the page. A
picture that fails to load is replaced by the tile's label. **Columns** sets
how many tiles go in a row, and **Show labels** can be switched off for a wall
of pictures (a tile with no picture always keeps its label). Give the widget
a height and the grid scrolls inside it.

A tile is picked when the tap ends on it, not when the finger lands, so
scrolling the grid never launches the clip you happened to touch. Tapping the
tile that is already selected sends again, because relaunching a clip is a
real instruction. With **Data in** on, a value arriving at Message moves the
highlight to the tile that sends it and nothing goes back out; a value no
tile sends, or one OSCAR cannot read, changes nothing. Several tablets on one
surface agree on the highlight without Data in. The highlight is never saved
in the project: what is playing is the software's to say.

The labels and URLs you type are put on the page as text, never as markup,
and the tiles are rebuilt from Items every time the widget is drawn; they are
not stored in the project and cannot be dragged out of the widget in the
editor.

This is a chooser, not a media library. It does not upload files, there is
no asset picker (you type the path or URL), and it shows still images only --
no video or animated previews, and it does not fetch thumbnails from
Resolume or any other software.

## Arduino and other boards

**A board with Wi-Fi or Ethernet already works, and always has.** OSCAR
sends OSC over UDP to whatever IP and port a widget names, and an ESP32 on
your network is one more thing with an IP and a port, exactly like Resolume.
There is nothing to switch on: flash `tools/arduino/oscar_wifi`, read the
address it prints, and type it into the widget's **Ip** and **Port**.

**A board on a USB cable** (Uno, Nano, Mega, Leonardo, Pico) has no address,
so OSCAR opens the serial port for you.

> The Serial panel is switched off in this version while it is tested on
> real boards (`SERIAL` in `lib/features.js`). The steps below describe it
> as it works once that is on. A board with Wi-Fi or Ethernet, above, is not
> affected.

1. Flash `tools/arduino/oscar_serial`.
2. In the editor, open the **Serial** panel (the USB icon in the toolbar),
   pick the board's port and the baud rate in your sketch's `Serial.begin()`
   (115200 in ours), and press **Connect**.
3. Set a widget's **Ip** to the word `serial`. Its **Port** is not used and
   may be left empty.

Every widget that sends can be pointed at the cable, and the message is the
same OSC message it would have sent to the network, framed with SLIP -- the
standard way OSC travels over a serial line. `serial` goes in **Ip** rather
than being a section of its own because it changes where the message goes, not what it
is: a slider can send OSC to the board and DMX to a dimmer at once. A board
that talks back is heard like any other OSC in, so a meter with **Data in** on
can show a potentiometer.

The port is opened by the computer running OSCAR, not by the tablet showing
the surface, and it is remembered in `oscar-settings.json`: an installation
that reboots overnight reconnects on its own. So does a cable pulled out and
pushed back in, or a board that vanishes for a few seconds while a sketch
uploads -- OSCAR retries every two seconds until told to disconnect. Nothing
is queued while the cable is out: a level arriving seconds after the gesture
is a light changing with nobody touching it. Choosing the port is editing,
so a locked OSCAR refuses it from other devices; their widgets still reach
the board.

Both sketches parse OSC in about forty lines with no libraries, and
`tools/arduino/README.md` covers what usually goes wrong: the Arduino IDE's
Serial Monitor holding the port, CH340 drivers for clone boards, and the
`dialout` group on Linux.

Two limits. The Windows on ARM build has no serial driver (the `serialport`
release OSCAR uses ships no binary for it): the panel says "No serial support
in this build", and everything else, Wi-Fi boards included, works as usual.
And OSCAR does not use the browser's Web Serial: that opens a port on the
device showing the page -- the tablet, which has no board plugged into it --
and Safari and Firefox do not have it at all.

## Multiple pages

A surface can hold more than one page: a page per fixture group, per scene,
or per operator. In the editor, the **Pages** button in the top bar lists
them. Click a name to open that page, **Rename** or **Delete** it from its
row, and add one with the box underneath (leave the name empty and it is
called "Page N"). Two pages cannot share a name, since their tabs could not
be told apart. The last page cannot be deleted. Deleting a page releases
the DMX channels of every widget on it.

On the tablet (`/preview`) the pages appear as a row of finger-sized tabs
along the bottom edge. The surface is made shorter by the height of the bar
rather than covered by it, so nothing on the bottom row of a page sits under
a tab. A surface with a single page has no bar and keeps the whole screen.
The editor's own preview shows the same tabs, so a surface can be tried out
before it is pushed.

Pushing a new layout while a show is running leaves each tablet on the page
it was showing, as long as that page still exists. Every page is locked the
same way: nothing can be dragged, selected or edited from a tablet, whichever
page it is on.

Turning the page lets go of whatever is being held. A momentary button held
with one finger while another taps a tab sends its Value OFF before the page
changes, exactly as if the finger had come up, so nothing is left on because
its button went out of sight. A push does the same.

A widget with Data in on keeps following the rig while its page is not
showing, on a single tablet as much as on several, so a fader opens where
the rig left it rather than where it was last seen, and the next touch does
not jump. What the other tablets do to a widget on a hidden page is
remembered in the same way.

A project with more than one page is saved as project format 3. An older
OSCAR has no way to switch pages and would show only the first, so it
refuses such a file and asks to be updated instead of opening part of a
show. A project with a single page is still saved as format 2, which older
versions open as before.

## Publishing a working interface

The download button in the top bar (**Publish your interface**) turns the
canvas into **one self-contained page**, separate from the editor.

**Publish on this OSCAR** keeps the page inside OSCAR and serves it at an
address such as `http://192.168.1.20:8080/show/main-stage`, shown with a QR
code to scan. It asks for a name and nothing else. This is the way onto a
**phone or tablet**, and the way to use unless you have a reason not to.
Publishing under the same name again replaces the page and keeps its address,
the dialog lists what is published and unpublishes it, and a published page
stays reachable while OSCAR is locked. It finds OSCAR by the address it was
opened at, so it keeps working if the computer's IP address changes. Unlike
`/preview`, which always shows the last push from the editor, a published
page stays as it was until you publish it again.

**Advanced: download the page as a file**, folded away at the bottom of the
dialog, saves the same page as an `.html` file to host on a web server or
open on another **computer**. A file cannot ask where OSCAR is, so this is
where you say: the address and bridge port are filled in with what OSCAR
reports for itself. It does not work opened from a phone's own storage:
Android and iOS sandbox a downloaded page and it never reaches OSCAR.

Either way there is nothing to unzip and nothing else to copy. The widgets' settings, OSCAR's runtime, the
socket.io client, the widget styles and your images are all inside it. A file
over about 2MB (a video, usually) stays a link instead, and the dialog names
it so you know it has to travel next to the page.

This is not **See code**, the button beside it. That one shows the markup and
nothing more: a page pasted together from it looks right and sends nothing.

**OSCAR has to be running somewhere the page can reach.** A browser cannot
send OSC or DMX -- it has no UDP -- so the exported page hands everything to
OSCAR's bridge, exactly as the editor and `/preview` do, and OSCAR puts it on
the network. The exported page is a remote for OSCAR, not a replacement for
it. The page says so itself: while it cannot reach OSCAR a banner across the
top says where it is trying and that the controls send nothing, and the same
is written in a comment at the top of the file for whoever opens it in a
text editor. The banner never takes a press meant for the control under it,
and it fades once the bridge answers.

Where OSCAR is gets written into the file when you export. The dialog fills
in the address and **bridge port** this OSCAR reports for itself (the bridge
port is the socket port, 8081 unless you moved it -- not the 8080 the editor
opens on), and you can change both before downloading: use the address other
devices see, not `localhost`, unless the page will only be opened on the same
computer. If OSCAR moves later you do not need to export again. Add the new
address to the page's own:

```
my-interface.html?oscar-host=192.168.0.20&oscar-port=8081
```

Things worth knowing:

- **Moves made while disconnected are dropped**, not queued. A tablet that
  walked out of Wi-Fi range would otherwise replay every fader position it
  passed through, in one burst, the moment it came back.
  - The control still moves on screen, so after an outage **the page can show
    a position the rig never got** -- a fader at 30 over a light still at 42,
    a toggle showing on over a rig that is off. Nothing can reconcile the two
    afterwards without being that late burst, so when the connection returns
    the page says how many moves were not sent. Move the control again to
    send where it now stands.
  - "Disconnected" means the page has noticed. A Wi-Fi link that goes quiet
    without closing -- a tablet roaming between access points -- looks
    connected for some tens of seconds, and a move made in that window can
    still arrive late if the link comes back first. `/preview` behaves the
    same way; a browser cannot tell sooner.
- **A control whose settings cannot be read stays switched off.** If the file
  was edited by hand and a widget's `data-oscar-config` no longer parses, is
  missing a setting, or holds a value the editor's settings panel would have
  refused -- `"enabled": "false"` in quotes, a Min of `null`, a port of
  70000 -- that widget is dimmed and does nothing, and its tooltip says which
  setting. It never falls back to default settings, because the defaults are
  a live control aimed at somebody's port 7000.
- Widgets with **Data in** on follow the rig on an exported page, DMX output
  works, and several copies of the page -- and `/preview` -- agree on what each
  control shows, all through the same bridge.
- **Only the first page is exported** if the project has several; the dialog
  says so when that applies.
- A page served over `https://` cannot reach the bridge, which is plain
  `http`: browsers block the mix. Open the file directly or serve it over
  `http`.
- A locked OSCAR exports only on the computer it runs on, like every other
  editing action.
- Running from source, the export needs `npm run build` to have produced
  `public/src/runtime.bundle.js`; OSCAR refuses to export without it rather
  than hand you a page that cannot send.

The settings are written into the markup only in the exported file. The
project you save never carries a second copy of them.
