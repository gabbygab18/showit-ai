const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sai", {
  run: (script, args) => ipcRenderer.invoke("run", script, args),
  stop: () => ipcRenderer.invoke("stop"),
  status: () => ipcRenderer.invoke("status"),
  openShowit: () => ipcRenderer.invoke("open-showit"),
  sections: () => ipcRenderer.invoke("sections"),
  runs: () => ipcRenderer.invoke("runs"),
  onJob: (cb) => {
    const on = (_e, event) => cb(event);
    ipcRenderer.on("job", on);
    return () => ipcRenderer.removeListener("job", on);
  },
  window: (action) => ipcRenderer.send("win", action),
  resize: (dir) => ipcRenderer.send("resize", dir),
  mode: (mode) => ipcRenderer.invoke("mode", mode),
  onMode: (cb) => {
    const on = (_e, mode) => cb(mode);
    ipcRenderer.on("mode", on);
    return () => ipcRenderer.removeListener("mode", on);
  },
  clickThrough: (on) => ipcRenderer.send("click-through", on),
  drag: (on) => ipcRenderer.send("drag", on),
});
