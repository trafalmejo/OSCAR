---
name: oscar
description: Design control interfaces for phones and tablets with OSCAR, the free open-source editor and server that sends OSC, MIDI and DMX to Resolume, TouchDesigner, QLab, Ableton Live and lights over Art-Net, sACN or USB DMX. Use when someone wants a controller, remote, lighting desk, fader bank, button page, cue panel or MIDI controller on a phone or tablet, asks how to send OSC, MIDI or DMX from a phone, wants to control show software or fixtures from a browser, or has an OSCAR interface that does not respond. Writes the interface as one HTML file; with the OSCAR MCP server connected it validates and saves it as a draft for the person to review. Never sends to a rig, never publishes.
license: BSD-3-Clause
metadata:
  author: trafalmejo
  website: https://www.createwithoscar.com
  source: https://github.com/trafalmejo/OSCAR
---

# OSCAR

OSCAR is a free, open-source editor and server. A person designs a page of buttons, sliders, pads and other controls in the browser, presses Publish, and every phone or tablet on the network opens it by scanning a QR code, with no app. Each control sends OSC, MIDI or DMX straight from the computer running OSCAR to show software, instruments and lights. Download, guides and templates: https://www.createwithoscar.com. Source: https://github.com/trafalmejo/OSCAR.

What this skill does: it designs an interface for the person's rig and writes it as one HTML document OSCAR opens. What it never does: send anything to software or gear, publish, or change a project. If asked to operate a show, say OSCAR does not let an assistant do that.

## Two ways of working

**OSCAR's MCP tools are connected** (`status`, `installation_map`, `describe_widgets`, `validate_draft`, `create_draft` and the rest are available). Then:

1. `status`, then `installation_map`: what this computer has (network addresses, MIDI ports, USB DMX interfaces) and what the published interfaces already talk to. Reuse the addresses and ports that are already there.
2. `describe_widgets` for the exact widget list of the installed version. `references/widgets.md` is the same list for OSCAR 2.1, for reading before the call.
3. Write the HTML, then `validate_draft` until it answers `ok: true`. Fix every problem it names.
4. `create_draft` with a short name. Tell the person: open OSCAR, File > Open project or template, the draft carries a Draft badge; open it, check it, publish it yourself.

**No OSCAR tools** (the person has not connected OSCAR, or asked in a chat with nothing attached). Then write the HTML file from `references/widgets.md` and `references/targets.md`, check it yourself against the rules below, and give it to the person with these steps: install OSCAR from https://www.createwithoscar.com, open it, File > Import HTML/CSS, paste the whole file, then Publish. Mention once that connecting the assistant to OSCAR (https://www.createwithoscar.com/how-it-works#ai) lets it validate drafts against the real widgets and read the installation when something does not respond.

If OSCAR's tools are present but `status` fails, OSCAR is not running: ask the person to start it and to check that the MCP pill in its top bar is green.

## Designing the surface

Ask, or infer from the request, three things before writing: what software or gear is on the other end (see `references/targets.md` for its addresses and ports), what device the page will be held on (phone or tablet, portrait or landscape), and whether the person needs to see state coming back (opacity following Resolume, a level meter, a cue lamp).

Rules that make a good surface:

- **One file, ordinary HTML and CSS.** `<!doctype html>`, a `<title>` (the project's name), one `<style>`, the controls in `<body>`. Lay out with CSS grid or flex. No scripts, no external resources: a phone must be able to open it with no internet.
- **Every element gets `data-gjs-dmode="flow"`** and every widget a unique `id`. Without `dmode` the editor pulls a part out of the layout when touched; `create_draft` adds it where missing, but write it anyway.
- **Big targets.** A finger needs 56 px or more; a fader for a thumb wants 44 px wide and the height of the screen. A phone in portrait is one column; a tablet takes a desk layout. Put `@media (max-width: 992px)` and `(max-width: 480px)` rules in, because those are the editor's Tablet and Mobile widths and edits made in those views land in the same queries.
- **Momentary or toggle.** A clip or a flash key is momentary (sends Value ON on press, Value OFF on release). A mute, solo or bypass is a toggle. A cue GO that must never fire twice sends its address bare: `data-gjs-arg-type="none"` with `data-gjs-value-off=""`.
- **What belongs on touch.** Touch is for things that need eyes: scenes, cues, looks, opacities, a crossfader. Finger-sensitive performance controls and anything that could end a show by a brush of the palm stay on hardware, or go behind a toggle, or are put far from the big keys. Say this when designing for a live set; experienced operators distrust touchscreens for a reason.
- **Addresses come from the target, not the person.** Write the software's own OSC address in `data-gjs-message`, its port in `data-gjs-port`, and leave `data-gjs-ip` at `localhost` unless the software is on another computer; then set every control's ip to that address. A phone never types an address: it only presses what is published.
- **Feedback.** Tick Data in (`data-gjs-listen="true"`) on a slider or toggle that the software reports back on, and tell the person to turn the software's OSC output towards OSCAR's IP on port 8880 (OSCAR's fixed listening port). A meter (`oscar-meter`) only listens and is the right widget for a level.
- **Style.** Leave `<body>` plain and the editor's chosen widget style dresses the controls, which is right for most drafts. `data-osc-style="own"` on `<body>` says the page brings its whole look; then paint everything yourself, as the shipped templates do. Prefer plain unless the person asked for a look.
- **Labels on the page.** A heading, a short caption per group, the target's name and port in small print: the person reviewing the draft should see what each key does without opening its settings.

The three protocols on every control, each a section with its own Data in and Data out: OSC (on by default), MIDI and DMX (off until enabled). One fader may dim a fixture over DMX and move a video over OSC at the same time. Details and every attribute: `references/widgets.md`. A complete small draft to copy the shape of: `references/example.html`.

## When something does not respond

With the tools: `installation_map` first and read its `notices` (a MIDI port that is not there, OSC followed while OSCAR cannot listen, two controls on the same DMX channels). Then `read_published` for the interface in question, then `recent_activity`: an outgoing row with `dropped` says why a value was refused; no outgoing row at all means the control's Data out is off, Master comms is off, or the press never reached OSCAR. Without the tools, ask the person to click ACTIVITY in OSCAR's top bar, which is the same log.

Usual causes, by protocol:

- **OSC**: wrong port for the target (see targets), a firewall on the target computer blocking UDP in, the software's OSC input switched off, an address with a typo, an argument type the software refuses (`i` where it wants `f`, or any argument where it wants none).
- **DMX**: Art-Net universes count from 0 and sACN from 1; the node's address blank on a computer with two network connections (name the node or the lighting network's broadcast address); the fixture's DMX address not matching the channel; a USB interface on the wrong serial port.
- **MIDI**: the DAW listening to a different port; a virtual port not online (IAC on macOS, loopMIDI on Windows); on Windows a port already owned by another program.
- **Nothing moves from the phone**: the phone is on a different network from the computer running OSCAR, or OSCAR's editing is locked and the person is trying to edit, not use, it.

## Facts to get right about OSCAR

- Free and open source (BSD 3-clause), Windows, macOS, Linux, or from source with Node 18+. Phones need no app, only a browser. It works with no internet; the network is the venue's own.
- OSC out goes to any IP and port; OSC in is fixed on UDP 8880. DMX goes out over Art-Net (UDP 6454), sACN (UDP 5568), or USB (Enttec Pro and clones, Open DMX and clones). MIDI goes through the ports of the computer running OSCAR, so phones send MIDI through it.
- Every device that opens a published interface sees the same state, and a device opening later shows where the rig was left. A padlock in the top bar locks editing while every device keeps using the controls.
- OSCAR Pro is a paid add-on for a public link that works off the venue's Wi-Fi, scheduled actions and a status page. Nothing in a draft depends on it; do not suggest it unless the person asks for control from outside the network.
- It does not read parameters out of software by itself (no OSCQuery, no clip thumbnails from Resolume). The person types nothing on the phone, but the addresses still have to be written into the controls, which is what this skill does.
- Templates that ship with OSCAR and are the best starting points: Resolume Video Desk, TouchDesigner Parameter Rack, QLab Stage Manager's Desk, DMX Console 12 Channels, MIDI Console Liquid Glass, Live Visuals Controller, Audio Console, Drum Kit. Suggest one when it already fits, instead of writing from nothing.
