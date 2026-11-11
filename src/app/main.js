// Bootstrap: runs the newest verified update from userData if there is one, otherwise the bundled app.
const { app } = require('electron'); const path = require('path'); const fs = require('fs');
global.__PA_BUNDLED = __dirname;
const bundledVer = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; global.__PA_SHELL = bundledVer;
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
let target = path.join(__dirname, 'app-main.js');
try {
  const root = path.join(app.getPath('userData'), 'update'); const cur = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
  const dir = path.join(root, String(cur.dir).replace(/[^\w.-]/g, '')); const pend = path.join(root, 'pending.json');
  let ok = cmp(cur.version, bundledVer) > 0 && fs.existsSync(path.join(dir, 'app-main.js'));
  if (ok && fs.existsSync(pend)) { // the update has not started successfully yet: allow 2 tries, then roll back
    const p = JSON.parse(fs.readFileSync(pend, 'utf8')); p.tries = (p.tries || 0) + 1;
    if (p.tries > 2) { ok = false; fs.unlinkSync(pend); fs.unlinkSync(path.join(root, 'current.json')); } else fs.writeFileSync(pend, JSON.stringify(p));
  }
  if (ok) target = path.join(dir, 'app-main.js');
} catch (e) { }
try { require(target); }
catch (e) { // broken update: forget it and start the bundled app
  if (target !== path.join(__dirname, 'app-main.js')) { try { const root = path.join(app.getPath('userData'), 'update'); fs.unlinkSync(path.join(root, 'current.json')); } catch (_) { } require(path.join(__dirname, 'app-main.js')); } else throw e;
}
