# OSCAR widgets, as an interface writes them

Generated from OSCAR's own widget registry by `scripts/build-skill-widgets.js`. Do not edit by hand. With OSCAR running, the `describe_widgets` tool gives the same list for the version actually installed; this file is for when it is not.

## The document

An interface is one HTML document: <!doctype html>, a <title> (its name in File > Open project or template), styles in <style>, and the widgets in <body>. A widget is its tag with class and attributes as listed here, a unique id, and settings as data-gjs-* attributes: setting minX is written data-gjs-min-x="0". Anything not set uses the default. Widgets are positioned and sized with ordinary CSS. Give every element data-gjs-dmode="flow" -- the editor drags in absolute mode, and a part without it is pulled out of the layout when touched (create_draft adds it where missing). Validate with validate_draft until ok, then create_draft saves it as a draft; a person reviews it in the editor and decides whether it ever goes near the rig.

Rules the validator holds you to:

- A setting is written as a `data-gjs-*` attribute in kebab case: setting `valueOn` is `data-gjs-value-on`. Booleans are the strings `"true"` and `"false"`.
- Every widget needs a unique `id`. Every element gets `data-gjs-dmode="flow"`.
- A widget is recognised by its tag and the attributes in its row below: any `<button>` is a button, any `<input type="range">` a slider. Keep those attributes exactly.
- `<body data-osc-style="own">` says the page brings its own look. Without it the editor's current widget style dresses the controls.
- `data-gjs-enabled` (Master comms, default `true`) is on every widget: `"false"` makes it deaf and silent on every protocol, for laying out while the rig is live.
- A widget's own `data-gjs-*` settings are the ones in its table. The OSC, DMX and MIDI sections below apply to every widget whose row says it sends, receives or does DMX.

## Widgets

| Widget | Tag and attributes | Sends | Receives | DMX |
| --- | --- | --- | --- | --- |
| oscar-button | `<button>` | yes | yes | yes |
| oscar-slider | `<input type="range" step="0.01">` | yes | yes | yes |
| oscar-xypad | `<div class="oscar-xypad">` | yes | yes | yes |
| oscar-meter | `<div class="oscar-meter">` | no | yes | no |
| oscar-colour | `<input type="color">` | yes | yes | yes |
| oscar-text-input | `<input type="text" class="oscar-text-input" autocomplete="off" enterkeyhint="send">` | yes | yes | no |
| oscar-number-input | `<input type="number" class="oscar-number-input" enterkeyhint="send">` | yes | yes | yes |
| oscar-dropdown | `<select class="oscar-dropdown">` | yes | yes | yes |
| oscar-media-browser | `<div class="oscar-media-browser">` | yes | yes | no |
| oscar-feedback | `<div class="oscar-feedback">` | no | yes | no |

### oscar-button

Tag: `<button id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/push1"`, `data-gjs-arg-type="i"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-label` | Label | text | `Insert here your text` | |
| `data-gjs-mode` | Mode | select | `momentary` | Options: `momentary`, `toggle`. |
| `data-gjs-value-on` | Value ON | text | `1` | |
| `data-gjs-value-off` | Value OFF | text | `0` | Leave it blank and the button says nothing when it is let go: for software whose /go takes no argument and must not hear it twice. |

### oscar-slider

Tag: `<input type="range" step="0.01" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/slider1"`, `data-gjs-arg-type="f"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-min` | Min | number | `0` | |
| `data-gjs-max` | Max | number | `100` | |
| `data-gjs-value` | Initial value | number | `0` | Where the control starts when a page opens. Nothing is sent until a hand, a message or the bridge moves it. |
| `data-gjs-orientation` | Orientation | select | `horizontal` | Options: `horizontal`, `vertical`. |
| `data-gjs-invert` | Invert | checkbox | `false` | |

### oscar-xypad

Tag: `<div class="oscar-xypad" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/pad"`, `data-gjs-arg-type="f"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-send-mode` | Send | select | `one` | Options: `one`, `two`. |
| `data-gjs-min-x` | Min X | number | `0` | |
| `data-gjs-max-x` | Max X | number | `100` | |
| `data-gjs-min-y` | Min Y | number | `0` | |
| `data-gjs-max-y` | Max Y | number | `100` | |
| `data-gjs-invert-x` | Invert X | checkbox | `false` | |
| `data-gjs-invert-y` | Invert Y | checkbox | `false` | |

### oscar-meter

Tag: `<div class="oscar-meter" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-message="/meter1"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-min` | Min | number | `0` | |
| `data-gjs-max` | Max | number | `100` | |
| `data-gjs-value` | Initial value | number | `0` | Where the needle starts until the first reading arrives. |
| `data-gjs-orientation` | Orientation | select | `horizontal` | Options: `horizontal`, `vertical`. |
| `data-gjs-peak-hold` | Peak hold (s) | number | `0` | |

### oscar-colour

Tag: `<input type="color" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/colour"`, `data-gjs-arg-type="f"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-value` | Initial colour | text | `#ff0000` | The swatch a fresh page opens with. Nothing is sent until a hand, a message or the bridge changes it. |
| `data-gjs-format` | Send as | select | `rgb` | Options: `rgb`, `rgba`, `hex`. |
| `data-gjs-scale` | Range | select | `unit` | Options: `unit`, `byte`. |
| `data-gjs-alpha` | Alpha | number | `1` | |

### oscar-text-input

Tag: `<input type="text" class="oscar-text-input" autocomplete="off" enterkeyhint="send" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/text1"`, `data-gjs-arg-type="s"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-value` | Initial value | text | `""` | Where the control starts when a page opens. Nothing is sent until a hand, a message or the bridge moves it. |
| `data-gjs-placeholder` | Placeholder | text | `Type, then press Enter` | |

### oscar-number-input

Tag: `<input type="number" class="oscar-number-input" enterkeyhint="send" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/number1"`, `data-gjs-arg-type="f"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-value` | Initial value | number | `0` | Where the control starts when a page opens. Nothing is sent until a hand, a message or the bridge moves it. |
| `data-gjs-min` | Min | number | `""` | |
| `data-gjs-max` | Max | number | `""` | |
| `data-gjs-step` | Step | number | `""` | |

### oscar-dropdown

Tag: `<select class="oscar-dropdown" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/dropdown1"`, `data-gjs-arg-type="i"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-options` | Options | text | `Red=1, Green=2, Blue=3` | |
| `data-gjs-value` | Initially selected | text | `1` | The option a fresh page opens on. Nothing is sent until a hand, a message or the bridge picks one. |

### oscar-media-browser

Tag: `<div class="oscar-media-browser" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-port="7000"`, `data-gjs-message="/clip"`, `data-gjs-arg-type="i"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-items` | Items | text | `Clip 1; Clip 2; Clip 3; Clip 4; Clip 5; Clip 6` | |
| `data-gjs-columns` | Columns | number | `3` | |
| `data-gjs-show-labels` | Show labels | checkbox | `true` | |

### oscar-feedback

Tag: `<div class="oscar-feedback" id="..." data-gjs-dmode="flow" ...>`

Defaults on the wire: `data-gjs-message="/cue"`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-label` | Label | text | `Cue` | |
| `data-gjs-flash` | Light | checkbox | `true` | The light on the page lights up for a moment. Works everywhere, the editor included. |
| `data-gjs-flash-colour` | Light colour | text | `#ff3663` | |
| `data-gjs-flash-ms` | Lit for (ms) | number | `300` | |
| `data-gjs-vibrate` | Vibrate (Android only) | checkbox | `true` | The phone buzzes. In a browser only Android phones vibrate, an iPhone's Safari cannot; the OSCAR app vibrates on both. |
| `data-gjs-vibrate-ms` | Vibration (ms) | number | `200` | |

## OSC section

On every widget that sends or receives. `data-gjs-osc-enabled` is Data out (on by default), `data-gjs-listen` is Data in (off by default). `data-gjs-ip`, `data-gjs-port` and `data-gjs-message` are the destination; the same message address is what Data in follows.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-listen` | Data in | checkbox | `false` | Follow the rig: an OSC message arriving at this widget's Message address moves it. What comes in is not sent back out unless a Send when below says so. |
| `data-gjs-osc-listen-from` | From | select | `any` | Options: `any`, `network`, `serial`. Where Data in is believed from. OSCAR hears the network (Port in) and a USB board alike; narrow this widget to one door if the other should never move it -- a sensor's widget set to the board alone cannot be moved by anything on the network. |
| `data-gjs-osc-enabled` | Data out | checkbox | `true` | Send this widget's value over this protocol when it is used. |
| `data-gjs-osc-send-when` | Send when | select | `user` | Options: `user`, `data`. When this sends. 'Changed by the user': a hand on this surface, on any device. 'or by data in': what arrives over Data in (OSC or MIDI) is also sent on -- the bridge. Bridged sends happen once, from the OSCAR that serves the surface: published surfaces and downloaded files; the editor's canvas only follows. |
| `data-gjs-osc-loop-guard` | Loop guard | checkbox | `true` | Bridge only a change that changed the value, so software that echoes what it receives cannot start a loop. Untick for triggers where a repeat is the event -- and never point such a widget back at its own source. |
| `data-gjs-osc-via` | Via | select | `network` | Options: `network`, `serial`. Where Data out goes: the network, at the Ip and Port below, or down the USB cable to a board -- an Arduino and its relatives, picked in the Board row this reveals. One cable for the whole of OSCAR, so it has no address here. |
| `data-gjs-ip` | Ip | text | `localhost` | |
| `data-gjs-port` | Port out | number | `7000` | |
| `data-gjs-message` | Message | text | `/push1` | |
| `data-gjs-arg-type` | Argument type | select | `i` | Options: `i`, `f`, `s`, `bool`, `none`. |

## DMX section

On every widget whose row says DMX. Off until `data-gjs-dmx-enabled="true"`. A slider sends 0-255 across its own range, a button full and out, a pad X then Y, a colour red, green, blue; `data-gjs-dmx-count` is how many channels from `data-gjs-dmx-channel`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-dmx-enabled` | Data out | checkbox | `false` | Send this widget's value over this protocol when it is used. |
| `data-gjs-dmx-send-when` | Send when | select | `user` | Options: `user`, `data`. When this sends. 'Changed by the user': a hand on this surface, on any device. 'or by data in': what arrives over Data in (OSC or MIDI) is also sent on -- the bridge. Bridged sends happen once, from the OSCAR that serves the surface: published surfaces and downloaded files; the editor's canvas only follows. |
| `data-gjs-dmx-protocol` | Protocol | select | `artnet` | Options: `artnet`, `sacn`, `usbpro`, `opendmx`. |
| `data-gjs-dmx-host` | Node / Interface | text | `""` | On Art-Net and sACN: the address of the node, or blank to reach every node. On USB: which serial port the interface is on; ports come and go with the cable, and a saved one that is unplugged stays chosen, marked so. |
| `data-gjs-dmx-universe` | Universe | number | `1` | |
| `data-gjs-dmx-channel` | Channel | number | `1` | |
| `data-gjs-dmx-count` | Channels | number | `1` | |

## MIDI section

On every widget that sends or receives. Off until `data-gjs-midi-enabled="true"` (out) or `data-gjs-midi-listen="true"` (in). A slider sends 0-127 across its range; a widget with several values uses the numbers that follow `data-gjs-midi-number`.

| Attribute | Panel label | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `data-gjs-midi-listen` | Data in | checkbox | `false` | Follow a MIDI controller: a knob, fader or pad moves this widget. What comes in is not sent back out unless a Send when says so. Learn fills in the settings below from the next control you touch. |
| `data-gjs-midi-in-port` | In port | select | `""` | Options: `All MIDI inputs`. The MIDI port to listen on. Ticking Data in picks the first port there is, and Learn the one you touch. "All MIDI inputs" listens on every port, which on Windows takes them all from other programs. |
| `data-gjs-midi-enabled` | Data out | checkbox | `false` | Send this widget's value as MIDI when it is used. |
| `data-gjs-midi-send-when` | Send when | select | `user` | Options: `user`, `data`. When this sends. 'Changed by the user': a hand on this surface, on any device. 'or by data in': what arrives over Data in (OSC or MIDI) is also sent on -- the bridge. Bridged sends happen once, from the OSCAR that serves the surface: published surfaces and downloaded files; the editor's canvas only follows. |
| `data-gjs-midi-loop-guard` | Loop guard | checkbox | `true` | Bridge only a change that changed the value, so software that echoes what it receives cannot start a loop. Untick for triggers where a repeat is the event -- and never point such a widget back at its own source. |
| `data-gjs-midi-port` | Out port | select | `""` | Options: a port by name, from the ones this computer has; blank for the first. The MIDI port to send to, out of the ones this computer has. |
| `data-gjs-midi-channel` | Channel | number | `1` | |
| `data-gjs-midi-type` | Type | select | `note` | Options: `cc`, `note`, `program`, `pitch`. |
| `data-gjs-midi-number` | Number | number | `60` | The controller or note number, 0 to 127. A widget with several values uses the numbers that follow: a pad set to 20 sends X on 20 and Y on 21. Program change and pitch bend do not use it. |
