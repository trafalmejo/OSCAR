/**
 * The editor's Serial panel: which USB port the board is on.
 *
 * The port is opened by the OSCAR server, on the computer the board is
 * plugged into, and this panel only asks it to (GET and POST /serial). It is
 * deliberately not Web Serial: navigator.serial opens a port on the machine
 * showing the page -- the tablet in someone's hand, which has no board on it
 * -- and Safari and Firefox do not have it at all.
 *
 * A plain script rather than part of the bundle, like oscar_socket.js, so
 * the editor hands it what it needs: `deps` is
 *   { panels, openModal(), alert(text) }.
 */
function oscar_serial(deps) {
  var panel = document.getElementById("serial-panel");
  if (!panel) return;

  var statusEl = document.getElementById("serial-status");
  var portEl = document.getElementById("serial-port");
  var rateEl = document.getElementById("serial-bitrate");
  var refreshEl = document.getElementById("serial-refresh");
  var connectEl = document.getElementById("serial-connect");
  var disconnectEl = document.getElementById("serial-disconnect");

  // A select rather than a free number: a mistyped rate opens the port
  // perfectly well and delivers noise, which looks like a broken board.
  var RATES = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];
  var DEFAULT_RATE = 115200;

  var ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="' +
    "M15,7V11H16V13H13V5H15L12,1L9,5H11V13H8V10.93C8.7,10.56 9.2,9.85 9.2,9C9.2,7.78 8.21,6.8 7,6.8" +
    "C5.78,6.8 4.8,7.78 4.8,9C4.8,9.85 5.3,10.56 6,10.93V13A2,2 0 0,0 8,15H11V18.05C10.29,18.41 9.8,19.15 9.8,20" +
    "A2.2,2.2 0 0,0 12,22.2A2.2,2.2 0 0,0 14.2,20C14.2,19.15 13.71,18.41 13,18.05V15H16A2,2 0 0,0 18,13V11H19V7H15Z" +
    '"/></svg>';

  function option(value, text) {
    var el = document.createElement("option");
    el.value = String(value);
    // textContent, never markup: a port's label comes from the USB device.
    el.textContent = text;
    return el;
  }

  function fill(select, entries, chosen) {
    while (select.firstChild) select.removeChild(select.firstChild);
    entries.forEach(function (entry) {
      select.appendChild(option(entry.value, entry.text));
    });
    select.value = String(chosen);
  }

  // The server's note about a message it could not send goes to a console the
  // packaged app does not have, so this is the only place a person finds out
  // that their fader has been talking to a cable that is not there.
  function unsent(report) {
    var n = report.dropped;
    if (typeof n !== "number" || n < 1) return "";
    return " " + n + (n === 1 ? " message" : " messages") + " aimed at serial could not be sent.";
  }

  // An error from the system rarely ends in a full stop, and something follows it.
  function sentence(text) {
    if (!text) return "";
    return /[.!?]$/.test(text) ? text : text + ".";
  }

  function describe(report) {
    if (!report.supported) return { state: "unsupported", text: report.reason || "No serial support in this build of OSCAR." };
    var where = report.path + " at " + report.bitrate + " baud";
    if (report.state === "open") {
      return { state: "open", text: "Connected to " + where + ". Sent " + report.sent + ", dropped " + report.dropped + "." };
    }
    if (report.state === "opening") return { state: "opening", text: "Opening " + where + "..." };
    if (report.state === "waiting") {
      return {
        state: "waiting",
        text: "Waiting for " + where + ", and trying again every few seconds. " + sentence(report.error) + unsent(report),
      };
    }
    if (report.error) return { state: "error", text: report.error };
    return { state: "idle", text: "Not connected." + unsent(report) };
  }

  // Whether someone is part-way through choosing; a poll must not snatch the
  // select back to the connected port under their finger.
  var choosing = false;

  function paint(report) {
    var said = describe(report);
    statusEl.textContent = said.text;
    statusEl.setAttribute("data-state", said.state);

    var busy = report.state === "open" || report.state === "opening" || report.state === "waiting";
    var usable = !!report.supported;

    if (!choosing) {
      var ports = (report.ports || []).map(function (port) {
        return { value: port.path, text: port.label || port.path };
      });
      var listed = ports.some(function (port) {
        return port.value === report.path;
      });
      // The chosen port stays in the list while unplugged; it is still chosen.
      if (report.path && !listed) ports.unshift({ value: report.path, text: report.path + " (not found)" });
      if (!ports.length) ports.push({ value: "", text: usable ? "No serial ports found" : "Not available" });
      fill(portEl, ports, report.path || ports[0].value);

      var rates = RATES.slice();
      var rate = report.path ? report.bitrate : DEFAULT_RATE;
      if (rates.indexOf(rate) === -1) rates.push(rate);
      fill(
        rateEl,
        rates.map(function (r) {
          return { value: r, text: r + " baud" };
        }),
        rate
      );
    }

    portEl.disabled = rateEl.disabled = refreshEl.disabled = !usable;
    connectEl.disabled = !usable || !portEl.value;
    disconnectEl.disabled = !usable || !busy;
    connectEl.textContent = busy ? "Reconnect" : "Connect";

    var button = document.querySelector(".gjs-pn-options .oscar-serial-btn");
    if (button) {
      button.classList.toggle("oscar-serial-open", report.state === "open");
      button.classList.toggle("oscar-serial-waiting", report.state === "waiting" || report.state === "opening");
      button.setAttribute("data-tooltip", "Serial (Arduino): " + (said.state === "unsupported" ? "not available" : said.text));
    }
  }

  function read(res) {
    return res.json().then(function (body) {
      return { ok: res.ok, body: body || {} };
    });
  }

  function refresh() {
    return fetch("/serial")
      .then(read)
      .then(function (answer) {
        // A locked OSCAR answers 403 with a reason and no status.
        if (!answer.ok && answer.body.supported === undefined) {
          statusEl.textContent = answer.body.error || "The serial port cannot be changed from here.";
          statusEl.setAttribute("data-state", "error");
          [portEl, rateEl, refreshEl, connectEl, disconnectEl].forEach(function (el) {
            el.disabled = true;
          });
          return;
        }
        paint(answer.body);
      })
      .catch(function () {
        statusEl.textContent = "Could not reach the OSCAR server.";
        statusEl.setAttribute("data-state", "error");
      });
  }

  function change(body) {
    choosing = false;
    fetch("/serial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(read)
      .then(function (answer) {
        if (answer.body.supported !== undefined) paint(answer.body);
        if (!answer.ok) deps.alert(answer.body.error || "The serial port could not be changed");
      })
      .catch(function () {
        deps.alert("Could not reach the OSCAR server");
      });
  }

  portEl.onchange = rateEl.onchange = function () {
    choosing = true;
    connectEl.disabled = !portEl.value;
  };
  refreshEl.onclick = function () {
    choosing = false;
    refresh();
  };
  connectEl.onclick = function () {
    change({ action: "connect", path: portEl.value, bitrate: Number(rateEl.value) });
  };
  disconnectEl.onclick = function () {
    change({ action: "disconnect" });
  };

  // The cable is pulled and pushed back in while this is open, so the panel
  // follows it. Only while it is on screen: a closed modal's content stays in
  // the document, hidden, and has no business polling through a show.
  setInterval(function () {
    if (panel.offsetParent !== null) refresh();
  }, 2000);

  deps.panels.addButton("options", {
    id: "open-serial",
    className: "oscar-serial-btn",
    label: ICON,
    command: function () {
      choosing = false;
      refresh();
      deps.openModal();
    },
    attributes: { title: "Serial (Arduino)", "data-tooltip-pos": "bottom" },
  });

  // Once at start, so the toolbar button shows a live cable straight away.
  refresh();
}
