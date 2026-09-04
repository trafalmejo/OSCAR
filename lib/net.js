"use strict";

const os = require("os");

// Adapter names that are almost never the address a phone/tablet on the
// same Wi-Fi should be pointed at.
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|virtualbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|utun/i;

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
      candidates.push({ name, address: net.address });
    }
  }

  const physical = candidates.find((c) => !VIRTUAL_ADAPTER.test(c.name));
  return (physical || candidates[0] || {}).address || "127.0.0.1";
}

function isIPv4(value) {
  return /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(
    String(value)
  );
}

module.exports = { lanAddress, isIPv4 };
