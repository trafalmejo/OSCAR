"use strict";

const path = require("path");
const { fork } = require("child_process");
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");

const START_TIMEOUT_MS = 30000;

let mainWindow = null;
let serverProcess = null;
let serverExited = false;

// Two OSCAR windows would fight over port 8080, so hand focus to the running
// instance instead of starting a second server.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(start);
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(path.join(__dirname, "server.js"), [], {
      env: Object.assign({}, process.env, {
        // A packaged app lives in a read-only folder, so projects belong in
        // the per-user data directory instead of next to the executable.
        OSCAR_PROJECTS_DIR: path.join(app.getPath("userData"), "projects"),
        // Electron provides the window; don't also open the system browser.
        OSCAR_NO_OPEN: "1",
      }),
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    const timer = setTimeout(
      () => reject(new Error("OSCAR's server did not start within 30 seconds.")),
      START_TIMEOUT_MS
    );

    serverProcess.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timer);
        resolve(msg);
      }
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      serverExited = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            "OSCAR's server stopped unexpectedly (exit code " +
              code +
              ").\n\nIs another copy of OSCAR already running?"
          )
        );
      }
    });
  });
}

function createWindow(ready) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#444444",
    title: "OSCAR",
    show: false,
    webPreferences: {
      // The renderer only ever loads OSCAR's own pages, and they are plain
      // browser code -- it needs no access to Node.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.maximize();
  mainWindow.loadURL("http://localhost:" + ready.port);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // A window-scoped devtools shortcut, rather than registering a global one
  // that would also fire while other applications are focused.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const modifier = process.platform === "darwin" ? input.meta : input.control;
    if (modifier && input.shift && input.key.toLowerCase() === "i") {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Links to tutorials, the website and so on belong in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

async function start() {
  try {
    const ready = await startServer();
    createWindow(ready);
  } catch (err) {
    dialog.showErrorBox("OSCAR could not start", err.message);
    app.quit();
  }
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !serverExited) start();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", stopServer);
app.on("will-quit", stopServer);

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}
