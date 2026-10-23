# What the other end expects

The addresses, ports and setup for the software OSCAR is most often pointed at. Each matches a guide at https://www.createwithoscar.com/getting-started/ and a shipped template; both are the place to check anything not written here. An address not listed goes into a control's `data-gjs-message` exactly as that software's manual gives it.

General rules: OSC goes out over UDP to the port in `data-gjs-port` at the address in `data-gjs-ip` (`localhost` when the software is on the OSCAR computer). Feedback into OSCAR arrives on UDP 8880, fixed, so the software's OSC output is pointed at OSCAR's IP and 8880. Argument types: `i` int, `f` float, `s` string, `none` for a bare address.

## Resolume Arena and Avenue

Port 7000 (OSC input, Arena > Preferences > OSC, switch Input on). For faders that follow Resolume, switch OSC Output on with OSCAR's IP and port 8880. Template: Resolume Video Desk. Guide: /getting-started/resolume.

| Control | Address | Value |
| --- | --- | --- |
| Clip in layer L, column C | `/composition/layers/L/clips/C/connect` | `1` while held (momentary button, int) |
| Column C | `/composition/columns/C/connect` | `1` while held: every clip in the column starts |
| Layer opacity | `/composition/layers/L/video/opacity` | `0` to `1`, float; follows Resolume with Data in on |
| Layer solo, bypass, clear | `/composition/layers/L/solo`, `/composition/layers/L/bypassed`, `/composition/layers/L/clear` | toggle 1/0 for solo and bypass, momentary for clear |
| Crossfader | `/composition/crossfader/phase` | `0` to `1`, float |
| Master | `/composition/master` | `0` to `1`, float |
| Tempo tap, BPM, resync | `/composition/tempocontroller/tempotap`, `/composition/tempocontroller/tempo`, `/composition/tempocontroller/resync` | tap and resync momentary; tempo a float |
| Disconnect all | `/composition/disconnectall` | momentary |

Columns and layers go by position: renaming a clip in Resolume does not rename the key. Resolume 7.26 and later also ship MCP servers of their own; the same chat can set up the composition through them and the phone controller through OSCAR.

## TouchDesigner

Port 10000, the default of an OSC In CHOP. Each address arrives as a channel named after it (`/td/speed` becomes `td/speed`), two floats make two channels (`td/position/x`, `td/position/y`). To send back, an OSC Out CHOP with Network Address = OSCAR's IP and Port = 8880. Template: TouchDesigner Parameter Rack, whose `.py` builds the whole demo network. Guide: /getting-started/touchdesigner.

Good shapes: a fader per parameter with `data-gjs-min`/`data-gjs-max` set to the parameter's real range (floats), an XY pad for a position with min/max of -1 to 1, a colour picker with `data-gjs-format="rgb"` and `data-gjs-scale="unit"` for three floats 0 to 1, a text input for a caption (`s`), momentary scene buttons sending `1`, and meters listening on their own addresses for levels sent back.

## QLab 4 and 5

Port 53000, listening out of the box, nothing to switch on. If the workspace has an OSC passcode, QLab wants `/connect <passcode>` before anything else; for a remote, leave the passcode off. A firewall on the Mac must let UDP 53000 in when OSCAR is on another computer. Template: QLab Stage Manager's Desk. Guide: /getting-started/qlab.

Every transport key sends its address bare and once: `data-gjs-arg-type="none"`, `data-gjs-value-on="1"`, `data-gjs-value-off=""`, momentary. `/go` with a number would be read as a cue number and `/go` twice would go twice.

| Key | Address |
| --- | --- |
| GO | `/go` |
| STOP | `/stop` |
| PAUSE, RESUME | `/pause`, `/resume` |
| PREV, NEXT | `/playhead/previous`, `/playhead/next` |
| RESET | `/reset` |
| PANIC | `/panic` |
| Start cue N | `/cue/N/start` (N is the cue number) |

Any other address from QLab's OSC dictionary (load, a fade, a scene) goes into a key the same way. Suggest Lock editing for a desk that stays on the stage manager's table.

## Ableton Live, Bitwig, Logic, Reaper and other DAWs (MIDI)

These take MIDI, not OSC, so every control has OSC off and MIDI on: `data-gjs-osc-enabled="false"`, `data-gjs-midi-enabled="true"`, `data-gjs-midi-channel="1"`, `data-gjs-midi-type` of `cc`, `note`, `program` or `pitch`, `data-gjs-midi-number` 0 to 127. The DAW then learns each control with MIDI Learn. The ports belong to the computer running OSCAR; software on that same computer needs a virtual port (macOS: IAC Driver in Audio MIDI Setup; Windows: loopMIDI; Linux: snd-virmidi or a JACK/ALSA bridge). Template: MIDI Console, Liquid Glass. Guide: /getting-started/midi.

The numbers hardware controllers use, which MIDI Learn picks up at the first touch: faders CC 21 to 28, pans CC 31 to 38, mutes CC 41 to 48 (toggle, 127/0), pads notes 36 to 43 (momentary, note on at full velocity), XY pad CC 16 and 17, a dropdown as program change. A slider sends 0 to 127 across its own range whatever its Min and Max.

## Lights: Art-Net, sACN and USB DMX

No software in between: the control drives the fixture. `data-gjs-dmx-enabled="true"`, `data-gjs-dmx-protocol` of `artnet`, `sacn`, `usbpro` or `opendmx`, `data-gjs-dmx-host` (the node's address, or blank to broadcast on Art-Net and multicast on sACN; for USB the serial port or blank for the first interface), `data-gjs-dmx-universe` (0 to 32767 on Art-Net, 1 to 63999 on sACN, 1 on USB), `data-gjs-dmx-channel` (1 to 512) and `data-gjs-dmx-count`. Usually `data-gjs-osc-enabled="false"` as well, unless the same fader should also drive software. Template: DMX Console, 12 Channels. Guide: /getting-started/lighting.

What a control sends: a slider its level 0 to 255 across its own range (set min 0, max 255, `data-gjs-arg-type="i"` to make the label honest); a button full while held and zero on release, a FLASH key; a colour picker red, green and blue on three channels; an XY pad pan and tilt on two. A block of channels wider than the control's values repeats the last one, so a slider with count 3 dims an RGB fixture as a whole. Several controls on one universe are merged highest-takes-precedence. OSCAR keeps a driven universe on the air until the control is deleted or OSCAR quits, so a phone going to sleep darkens nothing.

A computer with two network connections needs the node's address or the lighting network's broadcast address (`2.255.255.255` or `10.255.255.255` on the ranges Art-Net nodes ship on) in `data-gjs-dmx-host`, or the packets leave by the wrong connection.

## Anything else that speaks OSC

Max/MSP (udpreceive on the port you choose), MadMapper, Processing (oscP5), SuperCollider, Open Stage Control, Unity and Unreal plugins, grandMA and ETC Eos consoles (their OSC input on the port set in the console, addresses from the console's manual), and Arduino boards over USB serial. Write the port the receiving side listens on and its own address scheme. Ask for the manual's address list rather than guessing addresses; a wrong address is silent, not an error.
