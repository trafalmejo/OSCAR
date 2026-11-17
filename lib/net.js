"use strict";

const os = require("os");

// Adapter names that are almost never the address a phone/tablet on the
// same Wi-Fi should be pointed at.
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|virtualbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|utun/i;

// The same, told by the hardware address. Windows names a VirtualBox
// host-only adapter "Ethernet 3", which says nothing: on 2026-11-16 OSCAR
// took one for the network, printed its address, put it in the QR code and
// announced itself into it, so no phone on the Wi-Fi found it. The first
// three bytes are the maker's: VirtualBox, VMware, Hyper-V, Parallels,
// Xen, QEMU/KVM, Docker.
const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d|00:1c:42|00:16:3e|52:54:00|02:42:)/i;

/** An adapter no phone is on: a hypervisor's, a tunnel's, or one with no address from a router. */
function isVirtual(name, net) {
  return VIRTUAL_ADAPTER.test(name) || VIRTUAL_MAC.test(String((net && net.mac) || "")) || /^169.254./.test(String((net && net.address) || ""));
}

/**
 * Best-guess LAN IPv4 address for this machine.
 *
 * OSCAR prints this so people can open the GUI from another device on the
 * same network, so a virtual adapter (VirtualBox, WSL, Docker) is a much
 * worse answer than a real one -- prefer physical adapters.
 */
function lanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      // Node >=18 reports family as the string "IPv4"; older builds used 4.
      const family = typeof net.family === "string" ? net.family : "IPv" + net.family;
      if (family !== "IPv4" || net.internal) continue;
      candidates.push({ name, address: net.address, virtual: isVirtual(name, net) });
    }
  }

  const physical = candidates.find((c) => !c.virtual);
  return (physical || candidates[0] || {}).address || "127.0.0.1";
}

/**
 * Every IPv4 address this machine has on a network, with its adapter's name:
 * a computer on the show network and the office Wi-Fi at once has two, and
 * which one a device should be pointed at depends on where the device is.
 */
function lanAddresses() {
  const interfaces = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      const family = typeof net.family === "string" ? net.family : "IPv" + net.family;
      if (family !== "IPv4" || net.internal) continue;
      found.push({ name, address: net.address, virtual: isVirtual(name, net) });
    }
  }
  return found;
}

/**
 * Did this request come from the machine running OSCAR?
 *
 * Used to decide who may edit while OSCAR is locked. A source address cannot
 * be forged over TCP -- the connection only exists after a handshake -- so a
 * device elsewhere on the network cannot claim to be local.
 */
function isLoopbackAddress(address) {
  const addr = String(address == null ? "" : address);
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("127.")
  );
}

function isIPv4(value) {
  return /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(
    String(value)
  );
}

module.exports = { lanAddress, lanAddresses, isVirtual, isIPv4, isLoopbackAddress };
