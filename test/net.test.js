"use strict";

/**
 * Which of the computer's addresses OSCAR takes for "the network": the one
 * it prints, puts in the QR code and announces itself on.
 */

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const { lanAddress, lanAddresses, isVirtual } = require("../lib/net");

function withInterfaces(nets, run) {
  const real = os.networkInterfaces;
  os.networkInterfaces = () => nets;
  try {
    return run();
  } finally {
    os.networkInterfaces = real;
  }
}

const v4 = (address, mac) => ({ address, family: "IPv4", internal: false, mac });

test("a VirtualBox host-only adapter named like a real one is not the network", () => {
  // As Windows listed them on 2026-11-16: the hypervisor's adapter first.
  const nets = { "Ethernet 3": [v4("192.168.56.1", "0a:00:27:00:00:0d")], "Wi-Fi": [v4("192.168.2.11", "a0:80:69:d6:8c:60")] };
  withInterfaces(nets, () => {
    assert.strictEqual(lanAddress(), "192.168.2.11");
    assert.deepStrictEqual(lanAddresses().map((a) => a.virtual), [true, false]);
  });
});

test("an adapter with no address from a router comes last", () => {
  const nets = { "Local Area Connection": [v4("169.254.125.171", "00:ff:aa:bb:cc:dd")], Ethernet: [v4("10.0.0.5", "a0:80:69:00:00:01")] };
  withInterfaces(nets, () => assert.strictEqual(lanAddress(), "10.0.0.5"));
});

test("a virtual adapter is still an answer when it is the only one", () => {
  withInterfaces({ "Ethernet 3": [v4("192.168.56.1", "0a:00:27:00:00:0d")] }, () => assert.strictEqual(lanAddress(), "192.168.56.1"));
  withInterfaces({}, () => assert.strictEqual(lanAddress(), "127.0.0.1"));
});

test("told by name or by hardware address", () => {
  assert.strictEqual(isVirtual("vEthernet (WSL)", v4("172.20.0.1", "a0:00:00:00:00:01")), true);
  assert.strictEqual(isVirtual("Ethernet 2", v4("192.168.136.1", "00:50:56:c0:00:08")), true);
  assert.strictEqual(isVirtual("Wi-Fi", v4("192.168.2.11", "a0:80:69:d6:8c:60")), false);
});
