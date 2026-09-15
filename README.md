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

These builds aren't code signed, so your system warns you the first time. On
Windows, click *More info* then *Run anyway*. On macOS, right-click the app and
choose *Open*.

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

OSCAR also listens for OSC on UDP port `9000`, so controls can follow the
software they drive. If that port is already taken, OSCAR says so and keeps
running — sending still works.

Make sure your firewall allows communication between devices on the network.

To run two copies of OSCAR on one machine, give the second one its own ports:

```bash
OSCAR_HTTP_PORT=8090 OSCAR_SOCKET_PORT=8091 OSCAR_LAN_PORT=5003 OSCAR_LOCAL_PORT=5004 OSCAR_OSC_IN_PORT=9001 npm run serve
```

### Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Build the browser bundles, then run the server |
| `npm run serve` | Run the server without rebuilding |
| `npm run dev` | Rebuild on change and restart on change |
| `npm test` | Run the test suite |

### Building a desktop app

OSCAR ships as an Electron app. `npm run electron` runs it from source, and
the `dist` scripts produce installers under `release-builds/`:

| Command | Output |
| --- | --- |
| `npm run electron` | Run the desktop app from source |
| `npm run dist:win` | Windows installer (NSIS) |
| `npm run dist:mac` | macOS disk image |
| `npm run dist:linux` | Linux AppImage and .deb |

Each platform's installer has to be built on that platform. Windows and macOS
are built for both Intel (`x64`) and ARM (`arm64`); Electron no longer ships a
32-bit Windows build. Icons are generated from `build/icon.png`.

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
| `OSCAR_OSC_IN_PORT` | `9000` | Port OSCAR listens on for OSC coming back |
| `OSCAR_DMX_PORT` | any free port | Source port for Art-Net and sACN; set to `6454` for a node that insists |
| `OSCAR_DMX_HOLD_ON_EXIT` | unset | Set to `1` to leave fixtures on their last look when OSCAR quits |
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
| **Button** | `max` when pressed, `0` on release. As a toggle, it alternates |
| **Slider** | its value as it moves, with optional inverted range |
| **XY Pad** | both values at once — `/pad 30 70` — or as `/pad/x` and `/pad/y` |

On the XY pad, Y increases upward, and either axis can be inverted. Dragging
sends at most one message per frame, and always sends the exact value where
you let go.

## Following the software back

Every widget has a **Listen** setting. Turn it on and the widget watches its own
Message address for OSC arriving on port `9000`, so a fader moves when the
software moves it, and a button lights up when whatever it drives comes on.

Point your software at OSCAR's LAN address on port `9000` — in Resolume,
TouchDesigner or Ableton this is usually the same "send OSC to" box you already
use for feedback.

| Widget | What an incoming message does |
| --- | --- |
| **Button** | Lights up or clears. It recognises its own Value ON and Value OFF, and otherwise reads `0`, `F`, `off` and an empty string as off |
| **Slider** | Moves the thumb, clamped to Min and Max |
| **XY Pad** | Moves the handle — two values in one message, or `/pad/x` and `/pad/y` if that is how it is set to send |

Listen is off by default, so nothing starts moving on its own, and a surface
built before this existed behaves exactly as it did.

**A widget never answers an incoming message with an outgoing one.** A value
that arrived from outside moves the control and stops there. Plenty of software
echoes back what it was just sent, and a control that replied to the echo would
put the two of them in a loop that only ends when someone pulls a cable.

OSCAR matches OSC address patterns, so software that addresses `/layer*/opacity`
or `/ch[1-3]` reaches the widgets it means to. A widget's own Message setting is
always taken literally.

## Several tablets, one surface

Open `/preview` on as many devices as you like: they now agree with each other.
Toggle a button on one tablet and it lights up on the others, move a fader and
they all follow, and a device that joins halfway through a show is handed the
current state of every control rather than a surface full of defaults.

This needs no setting, and it costs no extra OSC: the device that was touched
is the one that sends, and the others only update what they draw. Pushing a new
layout to the tablets clears the shared state, since the old controls may not
exist in it.
## Driving lights directly (Art-Net and sACN)

Every widget has an **Output** setting: *OSC*, *DMX*, or *OSC and DMX*. Choose
one of the DMX options and the rest of the DMX settings appear underneath.

| Setting | Meaning |
| --- | --- |
| **DMX protocol** | Art-Net (UDP 6454) or sACN / ANSI E1.31 (UDP 5568) |
| **DMX node** | The interface's address. Leave it blank to broadcast (Art-Net) or to use the universe's multicast group (sACN) |
| **DMX universe** | Art-Net counts from 0, sACN from 1 |
| **DMX channel** | The first channel this widget owns, 1–512 |
| **DMX channels** | How many channels it owns from there |

A widget's full travel is the channel's full travel: wherever Min and Max are
set, the bottom of a slider is 0 and the top is 255. A button is a bump — full
while it is on, out when it is off. An XY pad puts X on its first channel and Y
on the next, which is pan and tilt on a moving head. A widget covering several
channels drives them all to the same level, so one fader can dim an RGB fixture
as a whole.

Several widgets can share a universe. Each owns its own block of channels, and
where two blocks overlap the higher value wins, the way a lighting desk merges
two faders.

**DMX is a stream, not a message.** Fixtures go dark when a source stops talking
to them — sACN receivers give up after 2.5 seconds — so OSCAR keeps sending
every universe in use several times a second, whether or not anyone is touching
anything. It only does this for universes a widget is actually driving, and it
stops as soon as the last one lets go.

Deleting a widget hands its channels back. Quitting OSCAR releases every channel
it was driving, so you are never left with a lit rig and nothing to control it
with; set `OSCAR_DMX_HOLD_ON_EXIT=1` if an installation should instead hold its
last look across a restart. Simply turning a widget's **Enabled** off leaves its
channels where they are — a control going quiet mid-show should not black out
what it was driving.

## Running a show

The editor lives at `/`. The control surface lives at `/preview` — the same
layout with every editing tool stripped out, which is what you open on a phone
or tablet.

Press **Push to preview** (the eye icon) to send the current layout to it.
Every device showing `/preview` picks the new layout up straight away; there is
no need to walk over and reload them.

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
rig, move a control on everyone else's tablet, or send OSC to port `9000` and
be believed by any widget listening for it. If that matters, the answer is a
separate network for the control devices, not a setting in OSCAR.

## Saving your work

The canvas autosaves into your browser as you work.

**Save** and **Load** keep a library of named projects, stored as plain JSON
files in the `projects/` folder next to OSCAR. They are ordinary files, so you
can copy, back up and share them however you like.

> **Note for OSCAR 1.x users:** the old online accounts at
> `account.createwithoscar.com` no longer exist. OSCAR now stores everything on
> your own machine, and no longer asks you to log in.

## Exporting an interface

**Export** (the download icon in the toolbar) saves your surface as a single
`.html` file. Everything is inside it — the controls, their OSC settings, the
styling and the code that makes them work — so there is nothing to unzip and no
folder to keep together. Open it by double-clicking it, or put it on any web
server you like.

The dialog asks where OSCAR can be reached, prefilled with the address other
devices on your network see. That address is written into the file.

**OSCAR still has to be running.** A browser cannot open a UDP socket, so an
exported page does not send OSC itself — it hands each message to OSCAR, which
puts it on the network. For the controls to do anything, OSCAR must be running
on the address you exported with, and the device showing the page must be able
to reach it. The page says so on screen when it cannot.

Moving OSCAR to another machine does not mean exporting again: open the page
with `?oscar-host=ADDRESS&oscar-port=PORT` on the end of its address.

Each control carries its own target in a `data-oscar-config` attribute, so an
exported file can be re-aimed in a text editor.

This is different from **See code**, next to it, which only shows you the
markup GrapesJS produced.

## How it works

```
Browser (grapesjs editor + OSCAR widgets)
   |  socket.io  :8081                 ^
   v                                   |  osc:in / shared widget state
OSCAR server (Node/Express)            |
   |  UDP out                          |  UDP in  :9000
   v                                   |
Your lighting / video / sound software
Browser (grapesjs editor, /preview, or an exported .html)
   |  socket.io  :8081
   v
OSCAR server (Node/Express)
   |  UDP                      |  UDP
   v                           v
Your lighting / video /        Art-Net or sACN nodes,
sound software (OSC)           and the fixtures behind them
```

Widgets carry their own output settings. When you press a button or move a
slider the browser sends that over socket.io to the OSCAR server, which emits
the actual packet over UDP — browsers cannot send UDP themselves, which is why
the server exists at all.

The two outputs behave differently on purpose. OSC is fire-and-forget: one
message, sent once. DMX is a stream the server keeps running, because that is
what the protocols and the fixtures expect.

Neither path ever invents a value. If a value cannot be read — a blank field, a
range that makes no sense, something that arrived as `null` — the update is
dropped and whatever it was driving stays where it is. Coercing it to a number
would send 0, and on a lighting rig 0 is a blackout.

A browser can neither open nor listen on a UDP socket, so the server does both
on its behalf. OSC arriving on port `9000` is relayed to every connected
browser, and each widget picks out the addresses it was told to listen for. The
same socket carries widget state between devices, so several tablets showing one
surface stay in step.

A widget is defined once, in `lib/widgets/`, in plain DOM and with no idea what
is hosting it. An adapter supplies the little it needs from its surroundings:
`public/src/adapters/grapesjs.js` inside the editor, and
`public/src/adapters/standalone.js` on an exported page. That is why an export
runs the same button, slider and pad as the editor rather than a second
implementation of them.

## Tutorials

1. Youtube Channel [OSCAR](https://www.youtube.com/channel/UCyIxOoajn_4Nj8Mjz2k-3qA)

## Contributing

Bug reports and pull requests are welcome on the
[issue tracker](https://github.com/trafalmejo/OSCAR/issues), and you can
[sign up for OSCAR news](https://forms.gle/1pGiDJDh3jur8Tq68) to follow along
with what is coming next.

## License

BSD 3-clause
