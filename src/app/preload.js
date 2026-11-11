const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('native', {
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  readFile: (rel) => ipcRenderer.invoke('read-file', rel),
  saveFile: (name, data) => ipcRenderer.invoke('save-file', name, data),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  readAppFile: (n) => ipcRenderer.invoke('read-app-file', n),
  writeStyle: (req) => ipcRenderer.invoke('write-style', req),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  openUrl: (u) => ipcRenderer.invoke('open-url', u),
  onUpdate: (cb) => { for (const ev of ['update-available', 'update-none', 'update-error', 'update-progress']) ipcRenderer.on(ev, (_e, d) => cb(ev, d)); },
  lastDir: () => ipcRenderer.invoke('last-dir'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return null; } },
});
