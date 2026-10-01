"use strict";

/**
 * The installation as OSCAR knows it: what this computer has, and everything
 * the published interfaces talk to. For an assistant asked why something
 * does not respond, or asked to build an interface for the gear that is
 * actually here.
 *
 * It is worked out from what OSCAR already holds -- the controls' settings,
 * the ports the computer lists -- and sends nothing onto the network: no
 * probe, no poll, no scan. Looking for nodes on the lighting network is a
 * different act, and would be a different tool.
 *
 * Pure, so the test holds it without a server: installationMap(facts).
 */

const { byName } = require("../widgets");
const { ALL_INPUTS } = require("../midi/spec");

/** FTDI's USB vendor id: the chip inside nearly every USB DMX interface. */
const FTDI = "0403";

const USB_PROTOCOLS = ["usbpro", "opendmx"];
const PROTOCOL_NAMES = { artnet: "Art-Net", sacn: "sACN", usbpro: "USB (Enttec Pro, DMXKing)", opendmx: "USB (Open DMX)" };

const whole = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** Who a row is about, said the same way everywhere. */
function who(surface, widget) {
  return { interface: surface.id, name: surface.name || surface.id, control: widget.id, widget: widget.widget };
}

/** One group per key, in the order first met, each holding the controls that share it. */
function grouper() {
  const groups = new Map();
  return {
    add(key, head, control) {
      if (!groups.has(key)) groups.set(key, Object.assign({}, head, { controls: [] }));
      groups.get(key).controls.push(control);
    },
    list: () => [...groups.values()],
  };
}

/**
 * @param {object} facts
 *   surfaces     [{ id, name, access, widgets: [{ id, widget, config }] }]  the published interfaces
 *   addresses    [{ name, address }]  this computer's network addresses
 *   ports        { http, socket }
 *   oscIn        { port, listening, why }
 *   midi         { supported, outputs, inputs, reason }
 *   serialPorts  [{ path, manufacturer, vendorId, productId }]
 */
function installationMap(facts) {
  const surfaces = facts.surfaces || [];
  const serialPorts = facts.serialPorts || [];
  const midi = facts.midi || { supported: false, outputs: [], inputs: [] };
  const oscIn = facts.oscIn || { port: null, listening: false };

  // This computer by any of its names: the show software often runs beside OSCAR.
  const own = new Set((facts.addresses || []).map((a) => a.address));
  const isHere = (host) => /^(localhost|127\.0\.0\.1|::1)$/i.test(host) || own.has(host);

  const oscOut = grouper();
  const oscFollowed = grouper();
  const midiOut = grouper();
  const midiFollowed = grouper();
  const dmx = grouper();
  const notices = [];
  // Every block of DMX channels a control drives, to find the ones that overlap.
  const blocks = [];

  for (const surface of surfaces) {
    for (const widget of surface.widgets || []) {
      const definition = byName[widget.widget] || {};
      const config = widget.config || {};
      const row = who(surface, widget);
      const called = JSON.stringify(row.control) + " on " + JSON.stringify(row.name);

      // ---- OSC ----
      const address = typeof config.message === "string" ? config.message.trim() : "";
      if (definition.sends && config.oscEnabled !== false && address) {
        if ((config.oscVia || "network") === "serial") {
          oscOut.add("serial", { to: "USB board (serial cable)" }, Object.assign({ address }, row));
        } else {
          const host = String(config.ip || "localhost").trim() || "localhost";
          const to = host + ":" + whole(config.port, 0);
          oscOut.add(to, { to, host, port: whole(config.port, 0), thisComputer: isHere(host) }, Object.assign({ address }, row));
        }
      }
      if (definition.receives && config.listen && address) {
        oscFollowed.add(address, { address }, Object.assign({ from: config.oscListenFrom || "any" }, row));
        if (!oscIn.listening) {
          notices.push(called + " follows OSC at " + address + ", but OSCAR is not listening for OSC" + (oscIn.why ? " (port " + oscIn.port + " " + oscIn.why + ")" : "") + ".");
        }
      }

      // ---- MIDI ----
      const mapping = { channel: whole(config.midiChannel, 1), type: config.midiType || "cc", number: whole(config.midiNumber, 0) };
      if (definition.sends && config.midiEnabled) {
        const port = String(config.midiPort || "");
        midiOut.add(port, { port: port || "(first port)" }, Object.assign({}, mapping, row));
        if (port && midi.supported && !(midi.outputs || []).includes(port)) {
          notices.push(called + " sends MIDI to " + JSON.stringify(port) + ", which this computer does not have right now.");
        }
      }
      if (definition.receives && config.midiListen) {
        const port = String(config.midiInPort || "");
        midiFollowed.add(port, { port: port || "(first port)" }, Object.assign({}, mapping, row));
        // "All MIDI inputs" is a choice, not a port's name.
        if (port && midi.supported && port !== ALL_INPUTS && !(midi.inputs || []).includes(port)) {
          notices.push(called + " follows MIDI from " + JSON.stringify(port) + ", which this computer does not have right now.");
        }
      }

      // ---- DMX ----
      if (definition.dmx && config.dmxEnabled) {
        const protocol = config.dmxProtocol || "artnet";
        const usb = USB_PROTOCOLS.includes(protocol);
        const host = String(config.dmxHost || "").trim();
        const universe = whole(config.dmxUniverse, 1);
        const first = whole(config.dmxChannel, 1);
        const last = first + Math.max(1, whole(config.dmxCount, 1)) - 1;
        // A USB interface carries one universe, whatever the setting says.
        const key = usb ? protocol + "|" + host.toLowerCase() : protocol + "|" + host + "|" + universe;
        const head = usb
          ? { protocol, via: PROTOCOL_NAMES[protocol] || protocol, interface: host || "(first USB DMX interface)" }
          : { protocol, via: PROTOCOL_NAMES[protocol] || protocol, node: host || "(broadcast: every node)", universe };
        dmx.add(key, head, Object.assign({ channels: first === last ? String(first) : first + "-" + last }, row));
        blocks.push({ key, first, last, called, head });

        if (usb && !serialPorts.length) {
          notices.push(called + " sends DMX over USB, but no USB interface is plugged in.");
        } else if (usb && host && !serialPorts.some((p) => String(p.path || "").toLowerCase() === host.toLowerCase())) {
          notices.push(called + " sends DMX to the USB interface " + JSON.stringify(host) + ", which is not plugged in.");
        }
      }
    }
  }

  // Two controls on the same channels of the same output: the last to move
  // wins, which is sometimes meant (two interfaces for one fixture) and
  // sometimes the fault being looked for. Said, not judged.
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.key !== b.key || a.last < b.first || b.last < a.first) continue;
      const from = Math.max(a.first, b.first);
      const to = Math.min(a.last, b.last);
      const where = a.head.universe !== undefined ? a.head.via + " universe " + a.head.universe : a.head.via;
      notices.push(a.called + " and " + b.called + " both drive " + where + ", channel" + (from === to ? " " + from : "s " + from + "-" + to) + ": whichever moved last decides the level.");
    }
  }

  return {
    computer: {
      addresses: facts.addresses || [],
      ports: facts.ports || {},
      oscIn: oscIn.listening
        ? { port: oscIn.port, listening: true }
        : { port: oscIn.port, listening: false, why: oscIn.why || "not open" },
      midi: { supported: !!midi.supported, outputs: midi.outputs || [], inputs: midi.inputs || [], reason: midi.reason || null },
      usb: serialPorts.map((p) => ({
        port: p.path,
        maker: p.manufacturer || null,
        // An FTDI chip is what a USB DMX interface almost always is; anything else is probably a board or a modem.
        likelyDmx: String(p.vendorId || "").toLowerCase() === FTDI,
      })),
    },
    interfaces: surfaces.map((s) => ({ id: s.id, name: s.name || s.id, access: s.access || "network", controls: (s.widgets || []).length })),
    talksTo: {
      osc: oscOut.list(),
      midi: midiOut.list(),
      dmx: dmx.list(),
    },
    listensFor: {
      osc: oscFollowed.list(),
      midi: midiFollowed.list(),
    },
    notices,
    note:
      "Worked out from the published interfaces' settings and this computer's own ports. Nothing was sent onto the network to make it, so it says where OSCAR sends, not whether anything is there to hear it: recent_activity shows what was actually sent and received.",
  };
}

module.exports = { installationMap, FTDI };
