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

Make sure your firewall allows communication between devices on the network.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Build the browser bundle, then run the server |
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
| `OSCAR_SOCKET_PORT` | `8081` | Browser-to-server OSC bridge |
| `OSCAR_LAN_PORT` | `5001` | Source port for OSC sent to the network |
| `OSCAR_LOCAL_PORT` | `5002` | Source port for OSC sent to this machine |
| `OSCAR_PROJECTS_DIR` | `./projects` | Where saved projects are written |
| `OSCAR_NO_OPEN` | unset | Set to `1` to not open a browser on start |

## Saving your work

The canvas autosaves into your browser as you work.

**Save** and **Load** keep a library of named projects, stored as plain JSON
files in the `projects/` folder next to OSCAR. They are ordinary files, so you
can copy, back up and share them however you like.

> **Note for OSCAR 1.x users:** the old online accounts at
> `account.createwithoscar.com` no longer exist. OSCAR now stores everything on
> your own machine, and no longer asks you to log in.

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
