// KORF container (.PCG .PCM .MTP .KMP …): chunk list + directory of named resources + PCM samples.
(function (root) {
  'use strict';
  const td = new TextDecoder('utf-8');
  const u16 = (b, p) => (b[p] << 8) | b[p + 1];
  const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
  const hex = (b, p, n) => Array.from(b.subarray(p, p + n), x => x.toString(16).padStart(2, '0')).join('');
  function isKorf(b) { return b.length > 32 && b[0] === 1 && b[1] === 0 && td.decode(b.subarray(23, 27)) === 'KORF'; }
  function chunks(b) { const out = []; let p = 8; while (p + 8 <= b.length) { const id = hex(b, p, 4), size = u32(b, p + 4); out.push({ id, off: p + 8, size }); if (size > b.length - p) break; p += 8 + size; } return out; }
  const TYPE = { 3: 'Pad', 4: 'Sound', 5: 'Multisample', 6: 'Sample', 0x19: 'Pad preset' };
  function directory(b, ch) {
    const out = []; let p = ch.off; const end = ch.off + ch.size;
    while (p + 4 <= end) {
      const len = u16(b, p); if (!len) break; const nf = u16(b, p + 2); let q = p + 4; const e = { fields: {} };
      for (let i = 0; i < nf && q + 4 <= p + 2 + len; i++) { const id = u16(b, q), l = u16(b, q + 2); e.fields[id] = b.subarray(q + 4, q + 4 + l); q += 4 + l; }
      const f = e.fields;
      e.name = f[2] ? td.decode(f[2]).replace(/\0.*$/s, '').trim() : '';
      if (f[0]) { e.typeCode = f[0][0]; e.type = TYPE[f[0][0]] || ('0x' + f[0][0].toString(16)); e.sub = f[0][1]; e.slot = f[0][2]; }
      if (f[1]) { e.ver = f[1][0]; e.rev = f[1][1]; }
      if (f[4]) e.hash = hex(f[4], 0, f[4].length);
      if (f[5] && f[5].length >= 6) { const d = f[5]; e.date = `${d[0] * 100 + d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')} ${String(d[4]).padStart(2, '0')}:${String(d[5]).padStart(2, '0')}`; }
      if (f[6]) { e.history = td.decode(f[6]).replace(/\0.*$/s, ''); e.createdWith = e.history.split('//').map(s => s.trim()).filter(Boolean).pop() || ''; }
      out.push(e); p += 2 + len;
    }
    return out;
  }
  function parseKorf(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!isKorf(b)) throw new Error('Не е KORF файл');
    const ch = chunks(b); const dirCh = ch.find(c => c.id === '05010018');
    const entries = dirCh ? directory(b, dirCh) : [];
    const samples = [];
    for (const c of ch.filter(c => c.id === '12020010')) {
      const o = c.off; if (c.size < 82) continue;
      const s = { hash: hex(b, o + 8, 8), channels: b[o + 16], fmt: b[o + 17], rate: u16(b, o + 20), frames: u32(b, o + 22),
        loopStart: u32(b, o + 58), loopEnd: u32(b, o + 62), loopFlag: b[o + 74], dataOff: o + 82, dataLen: u32(b, o + 78) };
      s.compressed = (s.fmt & 0x80) !== 0; s.bits = s.compressed ? 8 : 16;
      if (s.dataOff + s.dataLen > b.length) s.dataLen = Math.max(0, b.length - s.dataOff);
      s.duration = s.rate ? s.frames / s.rate : 0;
      const e = entries.find(x => x.hash === s.hash); if (e) { s.name = e.name; s.slot = e.slot; s.entry = e; }
      samples.push(s);
    }
    return { entries, samples, chunks: ch };
  }
  // Decode a sample to Float32Array per channel. 16-bit: exact LE PCM. Compressed: 8-bit deltas, integrated with a DC blocker (experimental).
  function decodeSample(bytes, s) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const C = Math.max(1, s.channels || 1); const out = [];
    for (let c = 0; c < C; c++) out.push(new Float32Array(s.frames));
    if (!s.compressed) {
      const dv = new DataView(b.buffer, b.byteOffset + s.dataOff, s.dataLen); const n = Math.min(s.frames, Math.floor(s.dataLen / (2 * C)));
      for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) out[c][i] = dv.getInt16((i * C + c) * 2, true) / 32768;
    } else {
      const n = Math.min(s.frames, Math.floor(s.dataLen / C)); const R = 1 - 30 / (s.rate || 44100); let peak = 1e-9;
      for (let c = 0; c < C; c++) { let acc = 0, prevAcc = 0, y = 0; const o = out[c];
        for (let i = 0; i < n; i++) { let d = b[s.dataOff + i * C + c]; if (d > 127) d -= 256; acc += d; y = acc - prevAcc + R * y; prevAcc = acc; o[i] = y; const a = Math.abs(y); if (a > peak) peak = a; } }
      const g = 0.9 / peak; for (const o of out) for (let i = 0; i < o.length; i++) o[i] *= g;
    }
    return out;
  }
  function wavBytes(chs, rate, loop) {
    const C = chs.length, n = chs[0].length; const dataLen = n * C * 2; const smpl = loop && loop.end > loop.start ? 60 + 8 : 0;
    const buf = new ArrayBuffer(44 + dataLen + smpl); const v = new DataView(buf); let p = 0;
    const str = (s) => { for (const ch of s) v.setUint8(p++, ch.charCodeAt(0)); }; const w32 = (x) => { v.setUint32(p, x, true); p += 4; }; const w16 = (x) => { v.setUint16(p, x, true); p += 2; };
    str('RIFF'); w32(36 + dataLen + smpl); str('WAVE'); str('fmt '); w32(16); w16(1); w16(C); w32(rate); w32(rate * C * 2); w16(C * 2); w16(16); str('data'); w32(dataLen);
    for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) { const x = Math.max(-1, Math.min(1, chs[c][i])); v.setInt16(p, x < 0 ? x * 32768 : x * 32767, true); p += 2; }
    if (smpl) { str('smpl'); w32(60); w32(0); w32(0); w32(Math.round(1e9 / rate)); w32(60); w32(0); w32(0); w32(0); w32(1); w32(0); w32(0); w32(0); w32(loop.start); w32(Math.max(loop.start, loop.end - 1)); w32(0); w32(0); }
    return new Uint8Array(buf);
  }
  const api = { isKorf, parseKorf, decodeSample, wavBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PAKorf = api;
})(typeof window !== 'undefined' ? window : globalThis);
