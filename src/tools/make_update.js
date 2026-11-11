// usage: node make_update.js <appDir> <outRepoDir> "<notes>" [minShell]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [appDir, outDir, notes, minShell] = process.argv.slice(2);
const ver = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const SKIP = new Set(['gm.sf3', 'main.js', 'licenses']);
const files = fs.readdirSync(appDir).filter(n => !SKIP.has(n) && fs.statSync(path.join(appDir, n)).isFile());
const vdir = path.join(outDir, 'updates', ver); fs.mkdirSync(vdir, { recursive: true });
const list = files.map(n => { const b = fs.readFileSync(path.join(appDir, n)); fs.writeFileSync(path.join(vdir, n), b); return { name: n, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; });
const man = { version: ver, notes: notes || '', date: new Date().toISOString().slice(0, 10), files: list, page: 'https://github.com/Hogzzmeade/pa5x-set-tool/releases' };
if (minShell) man.minShell = minShell;
fs.writeFileSync(path.join(outDir, 'updates', 'manifest.json'), JSON.stringify(man, null, 2));
console.log('update', ver, list.map(f => f.name + ' ' + f.size).join(', '));
