// Electron shell for Showit AI: a frameless panel that runs the tool scripts (audit/fix/rebuild/restore)
// with Electron's own Node, streams their output to the window, and watches the Showit Chrome window.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

app.setName("Showit AI"); // data lives in %APPDATA%\Showit AI (default would use the package name)
const DEV = process.argv.includes("--dev");
// Tool scripts run as plain files, so in the installed app they live unpacked next to app.asar.
const TOOL = path.join(__dirname, "..").replace(/app\.asar$/, "app.asar.unpacked");
// Writable data (change log, Showit login profile, stop flag). Dev keeps using the project folder.
const DATA = DEV ? TOOL : app.getPath("userData");
process.env.SHOWIT_AI_DATA = DATA;
const SCRIPTS = new Set(["audit.js", "fix.js", "rebuild.js", "restore.js"]);
const ICON = path.join(__dirname, "..", "build", "icon.png");

let win;
let job = null; // the one running tool process

const send = (channel, data) => win?.webContents.send(channel, data);

/** Runs a tool script with Electron-as-Node. Returns its child process. */
function node(script, args, onLine) {
  const child = spawn(process.execPath, [path.join(TOOL, script), ...args], {
    cwd: TOOL,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SHOWIT_AI_DATA: DATA, FORCE_COLOR: "0" },
    windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop();
      lines.forEach((l) => onLine?.(l));
    });
    stream.on("end", () => rest && onLine?.(rest));
  }
  return child;
}

ipcMain.handle("run", (_e, script, args = []) => {
  if (job) throw new Error("Something is already running.");
  if (!SCRIPTS.has(script) || !Array.isArray(args) || !args.every((a) => typeof a === "string")) throw new Error("Not allowed.");
  fs.rmSync(path.join(DATA, "stop"), { force: true });
  job = node(script, args, (text) => send("job", { type: "line", text }));
  job.on("close", (code) => {
    job = null;
    fs.rmSync(path.join(DATA, "stop"), { force: true });
    send("job", { type: "end", code });
  });
  return true;
});

// Stop at the next safe point (before the next edit), so nothing is left half-typed.
ipcMain.handle("stop", () => {
  if (job) fs.writeFileSync(path.join(DATA, "stop"), "");
  return !!job;
});

ipcMain.handle("sections", () =>
  new Promise((resolve, reject) => {
    let out = "";
    node("rebuild.js", ["--sections"], (l) => (out += l + "\n")).on("close", (code) => {
      const json = out.split("\n").find((l) => l.startsWith("{"));
      if (json) resolve(JSON.parse(json));
      else reject(new Error(out.trim() || `exit ${code}`));
    });
  }),
);

ipcMain.handle("runs", () => {
  delete require.cache[require.resolve(path.join(TOOL, "restore.js"))];
  return require(path.join(TOOL, "restore.js")).runs().reverse();
});

ipcMain.handle("open-showit", () =>
  new Promise((resolve) => node("connect.js", [], (l) => send("job", { type: "line", text: l })).on("close", (code) => resolve(code === 0))),
);

// Is the tool's Chrome window open, and is the Showit editor in it?
function chromeStatus() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:9222/json/list", { timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          const tab = JSON.parse(body).find((t) => t.type === "page" && t.url.includes("app.showit.com"));
          resolve({ chrome: true, showit: !!tab, title: tab?.title ?? "" });
        } catch {
          resolve({ chrome: true, showit: false, title: "" });
        }
      });
    });
    req.on("error", () => resolve({ chrome: false, showit: false, title: "" }));
    req.on("timeout", () => req.destroy());
  });
}
ipcMain.handle("status", chromeStatus);

// ---- window (same approach as Orbit): "panel" is the full app, "island" the pill at the top ------

const MIN = { width: 360, height: 600 };
const ISLAND = { width: 460, height: 250 }; // room for the expanded island; the rest is click-through
const prefsFile = () => path.join(app.getPath("userData"), "window.json");
let prefs = { mode: "panel", panel: null, island: null };

const onScreen = (b, min = MIN) => {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < min.width || b.height < min.height) return false;
  const { workArea: a } = screen.getDisplayMatching(b);
  return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
};
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    const island = p.island && { ...ISLAND, x: p.island.x, y: p.island.y };
    prefs = {
      mode: p.mode === "island" ? "island" : "panel",
      panel: onScreen(p.panel) ? p.panel : onScreen(p) ? { x: p.x, y: p.y, width: p.width, height: p.height } : null, // older single-bounds file
      island: onScreen(island, ISLAND) ? { x: island.x, y: island.y } : null,
    };
  } catch {}
}
function savePrefs() {
  if (prefs.mode === "panel" && win) prefs.panel = win.getBounds();
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs));
  } catch {}
}
function boundsFor(mode) {
  const { workArea: a } = screen.getPrimaryDisplay();
  if (mode === "island") return { ...ISLAND, ...(prefs.island ?? { x: a.x + Math.round((a.width - ISLAND.width) / 2), y: a.y + 6 }) };
  const [width, height] = [400, 780];
  return prefs.panel ?? { width, height, x: a.x + a.width - width - 16, y: a.y + a.height - height - 16 };
}
function applyMode(mode) {
  if (prefs.mode === "panel") prefs.panel = win.getBounds();
  prefs.mode = mode;
  win.setBounds(boundsFor(mode));
  // In island mode clicks fall through to the apps behind, except over the pill (see "click-through").
  win.setIgnoreMouseEvents(mode === "island", { forward: true });
  send("mode", mode);
  savePrefs();
}

let tray;
function createTray() {
  const show = (mode) => {
    if (!win) return;
    if (mode && mode !== prefs.mode) applyMode(mode);
    win.show();
  };
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.setToolTip("Showit AI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show panel", click: () => show("panel") },
      { label: "Island mode", click: () => show("island") },
      { type: "separator" },
      { label: "Quit Showit AI", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => show());
}

async function createWindow() {
  loadPrefs();
  win = new BrowserWindow({
    ...boundsFor(prefs.mode),
    frame: false,
    transparent: true,
    resizable: false, // custom edges, see "resize" (native ones misbehave on transparent windows)
    alwaysOnTop: true,
    hasShadow: false,
    title: "Showit AI",
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  if (prefs.mode === "island") win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "floating");
  win.on("close", savePrefs);
  if (DEV) {
    const { createServer } = await import("vite");
    const vite = await createServer({ root: path.join(__dirname, "..") });
    await vite.listen();
    win.loadURL(vite.resolvedUrls.local[0]);
    app.on("before-quit", () => vite.close());
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("mode", (_e, mode) => {
  if ((mode === "island" || mode === "panel") && mode !== prefs.mode && win) applyMode(mode);
  return prefs.mode;
});
ipcMain.on("click-through", (_e, on) => {
  if (prefs.mode === "island") win?.setIgnoreMouseEvents(!!on, { forward: true });
});
// Dragging the island: the renderer says when the drag starts and ends; the cursor is followed here.
let dragTimer;
ipcMain.on("drag", (_e, on) => {
  clearInterval(dragTimer);
  if (!win || prefs.mode !== "island") return;
  if (!on) {
    const { x, y } = win.getBounds();
    prefs.island = { x, y };
    return savePrefs();
  }
  const from = win.getBounds();
  const p0 = screen.getCursorScreenPoint();
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    win.setBounds({ ...ISLAND, x: from.x + p.x - p0.x, y: from.y + p.y - p0.y }); // size pinned (scaled displays round up)
  }, 16);
});

let resizeTimer;
ipcMain.on("resize", (_e, dir) => {
  clearInterval(resizeTimer);
  if (typeof dir !== "string" || !/^[nswe]{1,2}$/.test(dir) || !win) return;
  const from = win.getBounds();
  const p0 = screen.getCursorScreenPoint();
  resizeTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    const dx = p.x - p0.x;
    const dy = p.y - p0.y;
    const width = Math.max(MIN.width, from.width + (dir.includes("e") ? dx : dir.includes("w") ? -dx : 0));
    const height = Math.max(MIN.height, from.height + (dir.includes("s") ? dy : dir.includes("n") ? -dy : 0));
    const x = dir.includes("w") ? from.x + from.width - width : from.x;
    const y = dir.includes("n") ? from.y + from.height - height : from.y;
    win.setBounds({ x, y, width, height });
  }, 16);
});
ipcMain.on("win", (_e, action) => {
  if (action === "close") applyMode("island"); // the panel's X folds it into the island; Quit is in the tray menu
  if (action === "minimize") win?.minimize();
  if (action === "pin") win?.setAlwaysOnTop(!win.isAlwaysOnTop(), "floating");
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => win?.show());
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
  app.on("before-quit", () => job?.kill());
  app.on("window-all-closed", () => app.quit());
}
