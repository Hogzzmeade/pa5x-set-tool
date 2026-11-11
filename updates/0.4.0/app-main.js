const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path'); const fs = require('fs');
let win; let rootDir = null;
const APP_DIR = __dirname; const BUNDLED = global.__PA_BUNDLED || __dirname;
const appFile = (name) => { const p = path.join(APP_DIR, name); return fs.existsSync(p) ? p : path.join(BUNDLED, name); };
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const UPDATE_URL = process.env.PA5X_UPDATE_URL || 'https://raw.githubusercontent.com/Hogzzmeade/pa5x-set-tool/main/updates/manifest.json';
const UPD_ROOT = () => path.join(app.getPath('userData'), 'update');
const cfgFile = () => path.join(app.getPath('userData'), 'settings.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } };
const saveCfg = (c) => { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch (e) { } };

function walk(dir, base, out, depth) {
  if (depth > 6 || out.length > 20000) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out, depth + 1);
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}
function insideRoot(rel) { const p = path.resolve(rootDir, rel); if (!rootDir || !p.startsWith(path.resolve(rootDir) + path.sep)) throw new Error('bad path'); return p; }

ipcMain.handle('open-folder', async () => {
  const cfg = loadCfg();
  const r = await dialog.showOpenDialog(win, { title: 'Избери папката на PA5X сета (SET / KST)', defaultPath: cfg.lastDir, properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return listFolder(r.filePaths[0]);
});
function listFolder(dir) {
  rootDir = dir; const cfg = loadCfg(); cfg.lastDir = dir; saveCfg(cfg);
  const base = path.dirname(dir); const top = path.basename(dir);
  return { name: top, path: dir, files: walk(dir, base, [], 0) };
}
ipcMain.handle('open-path', async (_e, dir) => { try { if (fs.statSync(dir).isDirectory()) return listFolder(dir); } catch (e) { } return null; });
ipcMain.handle('read-file', async (_e, rel) => { const p = insideRoot(rel.split('/').slice(1).join('/')); const b = await fs.promises.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
ipcMain.handle('save-file', async (_e, name, data) => {
  const cfg = loadCfg(); const ext = path.extname(name).slice(1) || '*';
  const r = await dialog.showSaveDialog(win, { title: 'Запиши', defaultPath: path.join(cfg.saveDir || app.getPath('documents'), name), filters: [{ name: ext === 'zip' ? 'ZIP архив' : ext === 'mid' ? 'MIDI файл' : 'Файл', extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data)); cfg.saveDir = path.dirname(r.filePath); saveCfg(cfg); return r.filePath;
});

ipcMain.handle('read-app-file', async (_e, name) => { if (!/^[\w.-]+$/.test(name)) throw new Error('bad'); const b = await fs.promises.readFile(appFile(name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function backupFile(src) {
  const relIn = path.relative(rootDir, src); const bdir = path.join(path.dirname(rootDir), path.basename(rootDir) + '_backup', path.dirname(relIn));
  fs.mkdirSync(bdir, { recursive: true }); const ext = path.extname(src); const dst = path.join(bdir, path.basename(src, ext) + ' (' + stamp() + ')' + ext);
  fs.copyFileSync(src, dst); return dst;
}
function metadirAdd(dir, fileName) {
  const md = path.join(dir, 'metadir.json'); if (!fs.existsSync(md)) return false;
  let j; try { j = JSON.parse(fs.readFileSync(md, 'utf8')); } catch (e) { return false; }
  if (!Array.isArray(j.files) || j.files.some(f => f.file === fileName)) return false;
  backupFile(md); j.files.push({ file: fileName });
  const txt = '{\n  "files":\n  [\n' + j.files.map(f => '    { "file":' + JSON.stringify(f.file) + ' }').join(',\n') + '\n  ]\n}\n';
  fs.writeFileSync(md, txt, 'utf8'); return true;
}
ipcMain.handle('write-style', async (_e, req) => {
  try {
    const src = insideRoot(String(req.rel).split('/').slice(1).join('/')); const dir = path.dirname(src); const data = Buffer.from(req.data);
    if (req.overwrite) { const bak = backupFile(src); fs.writeFileSync(src, data); return { ok: true, path: src, backup: bak, rel: req.rel }; }
    const name = String(req.newName || '').replace(/[\\/:*?"<>|]+/g, '_'); if (!/\.stg$/i.test(name) || name.length < 5) return { ok: false, error: 'Невалидно име' };
    const dst = path.join(dir, name); if (fs.existsSync(dst)) return { ok: false, error: 'Вече има стил с това име в банката' };
    fs.writeFileSync(dst, data); const md = metadirAdd(dir, name);
    const rel = path.basename(rootDir) + '/' + path.relative(rootDir, dst).split(path.sep).join('/');
    return { ok: true, path: dst, rel, metadir: md };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('show-in-folder', (_e, p) => { if (p) shell.showItemInFolder(p); });
ipcMain.handle('last-dir', () => loadCfg().lastDir || null);


// ---------------- self-update ----------------
const { net } = require('electron'); const crypto = require('crypto');
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
let latest = null;
function markGood() { try { const f = path.join(UPD_ROOT(), 'pending.json'); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { } }
async function fetchBuf(url) { const r = await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
async function checkUpdate(manual) {
  try {
    const man = JSON.parse((await fetchBuf(UPDATE_URL)).toString('utf8'));
    if (!man.version || !Array.isArray(man.files)) throw new Error('bad manifest');
    if (cmpVer(man.version, VERSION) > 0) {
      if (man.minShell && cmpVer(man.minShell, global.__PA_SHELL || VERSION) > 0) { latest = { ...man, fullDownload: true }; }
      else latest = man;
      win && win.webContents.send('update-available', { version: man.version, notes: man.notes || '', fullDownload: !!latest.fullDownload, page: man.page || '' });
      return { available: true, version: man.version };
    }
    if (manual) win && win.webContents.send('update-none', { version: VERSION });
    return { available: false };
  } catch (e) { if (manual) win && win.webContents.send('update-error', { message: e.message }); return { error: e.message }; }
}
ipcMain.handle('check-update', () => checkUpdate(true));
ipcMain.handle('app-version', () => VERSION);
ipcMain.handle('install-update', async () => {
  if (!latest || latest.fullDownload) return { ok: false, error: 'Няма обновление за инсталиране' };
  const root = UPD_ROOT(); const tmp = path.join(root, latest.version + '.tmp'); const dst = path.join(root, latest.version);
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const base = UPDATE_URL.replace(/manifest\.json$/, '');
    let done = 0;
    for (const f of latest.files) {
      if (!/^[\w.-]+$/.test(f.name)) throw new Error('bad file name');
      const buf = await fetchBuf(f.url || (base + latest.version + '/' + f.name));
      const h = crypto.createHash('sha256').update(buf).digest('hex'); if (h !== f.sha256) throw new Error('Контролната сума не съвпада: ' + f.name);
      fs.writeFileSync(path.join(tmp, f.name), buf); done++; win && win.webContents.send('update-progress', { done, total: latest.files.length });
    }
    // copy everything else from the current app dir (except the big sound bank, which is read from the bundled copy)
    for (const n of fs.readdirSync(APP_DIR)) { const s = path.join(APP_DIR, n); if (n === 'gm.sf3' || fs.existsSync(path.join(tmp, n))) continue; fs.cpSync(s, path.join(tmp, n), { recursive: true }); }
    if (!fs.existsSync(path.join(tmp, 'app-main.js')) || !fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('непълно обновление');
    fs.rmSync(dst, { recursive: true, force: true }); fs.renameSync(tmp, dst);
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version: latest.version, dir: latest.version }));
    fs.writeFileSync(path.join(root, 'pending.json'), JSON.stringify({ version: latest.version, tries: 0 }));
    setTimeout(() => { app.relaunch(); app.exit(0); }, 400); return { ok: true };
  } catch (e) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { } return { ok: false, error: e.message }; }
});
ipcMain.handle('open-url', (_e, u) => { if (/^https:\/\/github\.com\//.test(u)) shell.openExternal(u); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'midi' || perm === 'midiSysex'));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'midi' || perm === 'midiSysex');
  win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1000, minHeight: 600, title: 'PA5X Set Tool', backgroundColor: '#14161a', icon: appFile('icon.png'),
    webPreferences: { preload: appFile('preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(appFile('index.html'));
  win.webContents.once('did-finish-load', () => { markGood(); setTimeout(() => checkUpdate(false), 4000); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
});
app.on('window-all-closed', () => app.quit());
