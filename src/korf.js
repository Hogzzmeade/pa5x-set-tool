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
  // Decode for playback: fixed level (no per-sample normalisation). Compressed samples are 8-bit deltas:
  // integrate, remove slow drift with a gentle high-pass and spread the remaining loop seam over the loop so it loops cleanly.
  const COMP_GAIN = 8 / 32768;
  function decodeForPlay(b, s, off) {
    const C = Math.max(1, s.channels || 1); const n = Math.min(s.frames, Math.floor(s.dataLen / (s.compressed ? C : 2 * C))); const out = [];
    for (let c = 0; c < C; c++) out.push(new Float32Array(n));
    if (!s.compressed) { const dv = new DataView(b.buffer, b.byteOffset + off, n * 2 * C); for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) out[c][i] = dv.getInt16((i * C + c) * 2, true) / 32768; return out; }
    const rate = s.rate || 44100, ls = s.loopStart, le = Math.min(s.loopEnd, n);
    // 4th-order Butterworth high-pass at 20 Hz (two biquads) removes the slow drift of the integrated deltas
    const bq = (Q) => { const w = 2 * Math.PI * 20 / rate, cs = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al; return [(1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0]; };
    const F = [bq(0.5412), bq(1.3066)];
    for (let c = 0; c < C; c++) { const o = out[c]; let acc = 0;
      for (let i = 0; i < n; i++) { let d = b[off + i * C + c]; if (d > 127) d -= 256; acc += d; o[i] = acc * COMP_GAIN; }
      for (const [b0, b1, b2, a1, a2] of F) { let x1 = o[0], x2 = o[0], y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const x = o[i]; const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; o[i] = y; } }
      if (s.loopFlag && le - ls > 16 && ls > 0) { const D = o[le - 1] - o[ls - 1]; const L = le - ls; for (let i = ls; i < le; i++) o[i] -= D * (i - ls) / L; for (let i = le; i < n; i++) o[i] -= D; } }
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

  // KORG "OC31" block compression: LZO1Z-like (literal runs t+2 / 18+ext with 255-continuation, offsets (b0<<6)+(b1>>2)+1).
  // KORG extension: t==0x21 is a long match whose length is a u16 BE, followed by the usual 2 offset bytes. All 479 blocks of the test set decode exactly.
  function oc31(block) {
    const B = block; let k = -1; for (let i = 0; i + 3 < B.length; i++) if (B[i] === 0x4f && B[i + 1] === 0x43 && B[i + 2] === 0x33 && B[i + 3] === 0x31) { k = i; break; }
    if (k < 0) return null; const N = (B[k + 4] | (B[k + 5] << 8) | (B[k + 6] << 16) | (B[k + 7] << 24)) >>> 0; const s = B.subarray(k + 8);
    const out = new Uint8Array(N); let o = 0, ip = 0, state = 0;
    const cp = (d, n) => { for (let i = 0; i < n && o < N; i++) { out[o] = d <= o ? out[o - d] : 0; o++; } };
    const lit = (n) => { for (let i = 0; i < n && o < N && ip < s.length; i++) out[o++] = s[ip++]; };
    const ext = (base) => { let e = 0; while (s[ip] === 255) { e += 255; ip++; } return e + base + s[ip++]; };
    while (ip < s.length && o < N) {
      const t = s[ip++];
      if (t < 16) { if (state === 0) { lit(t === 0 ? ext(18) : t + 2); state = 4; continue; } const b1 = s[ip++]; cp(1 + 0x800 + (t >> 2) + (b1 << 2), 3); }
      else if (t >= 64) { const d = ((t & 31) << 6) + (s[ip++] >> 2) + 1; cp(d, (t >> 5) + 1); }
      else if (t >= 32) { let n; if (t === 0x21) { n = (s[ip] << 8) | s[ip + 1]; ip += 2; } else { n = t & 31; if (n === 0) n = ext(32); n += 2; } const d = 1 + (s[ip] << 6) + (s[ip + 1] >> 2); ip += 2; cp(d, n); }
      else { let n = t & 7; if (n === 0) n = ext(7); const d = ((t & 8) << 11) + (s[ip] << 6) + (s[ip + 1] >> 2); ip += 2; if (d === 0) break; cp(d + 0x4000, n + 2); }
      const nl = s[ip - 1] & 3; lit(nl); state = nl;
    }
    return o === N ? out : out.subarray(0, o);
  }
  // Pad presets (MATRIXPRESET/Pads.MTP): each preset holds 16 pad file paths.
  function padPresets(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const k = parseKorf(b); const res = [];
    const data = k.chunks.filter(c => c.id === '1d000030');
    data.forEach((c, i) => {
      const raw = oc31(b.subarray(c.off, c.off + c.size)); if (!raw) return;
      const paths = []; let s = 0;
      for (let j = 0; j <= raw.length; j++) if (j === raw.length || raw[j] === 0) { if (j - s > 3) { const str = td.decode(raw.subarray(s, j)); const m = str.indexOf(':\\'); if (m >= 0) paths.push(str.slice(m - 1)); } s = j + 1; }
      const e = k.entries[i] || {};
      res.push({ name: e.name || 'Preset ' + (i + 1), slot: e.slot, date: e.date, pads: paths.map(p => { const parts = p.split('\\'); const file = parts.pop(); return { path: p, name: file.replace(/\.pdc$/i, ''), category: parts.pop() || '', source: /\\FACTORY\\/i.test(p) ? 'Factory' : /\\USER\\/i.test(p) ? 'User' : (parts[3] || '') }; }) });
    });
    return res.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  }
  // ---- MULTISMP/RAM.KMP (chunk 11080018): samples, drum samples, zones, multisamples ----
  function parseKmp(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const k = parseKorf(b); const c = k.chunks.find(x => x.id === '11080018'); if (!c) throw new Error('Няма мултисемпли в KMP');
    const D = b.subarray(c.off, c.off + c.size); const U32 = (p) => u32(D, p); const str = (p, n) => td.decode(D.subarray(p, p + n)).replace(/\0.*$/s, '').trim();
    const nS = U32(2), nD = U32(6), nZ = U32(10), nM = U32(14); let p = 18;
    const samples = []; for (let i = 0; i < nS; i++, p += 122) samples.push({ name: str(p + 75, 24), hash: hex(D, p + 107, 8), rate: u16(D, p + 119), key: D[p + 121] });
    const drums = []; for (let i = 0; i < nD; i++, p += 126) { const r = { name: str(p, 24), hash: hex(D, p + 118, 8), refs: [] }; for (let q = p + 32; q < p + 48; q += 4) { const f = u16(D, q), v = u16(D, q + 2); if (f === 0xffff || v === 0xffff) break; r.refs.push(v); } drums.push(r); }
    const zones = []; for (let i = 0; i < nZ; i++, p += 16) zones.push({ s: U32(p), tune: (u16(D, p + 4) << 16) >> 16, top: D[p + 10], orig: D[p + 11] });
    const ms = []; for (let i = 0; i < nM; i++, p += 176) ms.push({ name: str(p, 24), zs: U32(p + 32), keymap: D.slice(p + 36, p + 164), nz: D[p + 166], hash: hex(D, p + 168, 8) });
    const byHash = new Map(); ms.forEach((m, i) => byHash.set(m.hash, { kind: 'ms', i })); drums.forEach((d, i) => byHash.set(d.hash, { kind: 'ds', i }));
    return { samples, drums, zones, ms, byHash };
  }
  // ---- PCG program: oscillators (layout A: 200 bytes, B: 202 bytes) at the end of the decoded block ----
  function parseProgram(o, kmp) {
    let step, n;
    if ((o.length - 313) % 200 === 0 && o.length > 313) { step = 200; n = (o.length - 313) / 200; }
    else { step = 202; n = Math.round((o.length - 450) / 202); if (n < 1 || Math.abs(o.length - 450 - 202 * n) > 4) return null; }
    const base = o.length - step * n - 1, d = step === 202 ? 1 : 0; const oscs = [];
    const ref = (q) => { const h = hex(o, q, 8); const idx = (o[q + 8] << 8) | o[q + 9]; const ram = o[q + 10];
      if (ram === 1) { const m = kmp && kmp.byHash.get(h); return m ? { ram: true, ...m } : { ram: true, missing: true }; }
      if (/^0+$/.test(h) && idx === 0) return null; return { ram: false, rom: idx }; };
    for (let q = 0; q < n; q++) { const B = base + step * q; if (B + 40 > o.length) break;
      oscs.push({ hi: ref(B + 1), lo: ref(B + 16 + d), sw: o[B + 32 + 2 * d], vb: o[B + 33 + 2 * d], vt: o[B + 34 + 2 * d], kb: o[B + 35 + 2 * d], kt: o[B + 36 + 2 * d] }); }
    return { oscs };
  }
  // ---- drum kit program: key table (128 entries) followed by velocity-layer records (33 bytes) ----
  function parseKit(o, kmp) {
    for (const stride of [29, 30, 31, 28]) for (let p0 = 300; p0 < 1600; p0++) {
      let ok = true, layers = 0; for (let i = 0; i < 128; i++) { const p = p0 + stride * i; if (p + 13 > o.length || o[p + 2] !== 0x7f || o[p + 4] < 1 || o[p + 4] > 8) { ok = false; break; } layers += o[p + 4]; }
      if (!ok) continue; const r0 = p0 + stride * 127 + 23; if (r0 + layers * 33 > o.length) continue;
      const keys = []; let r = r0;
      for (let i = 0; i < 128; i++) { const p = p0 + stride * i; const n = o[p + 4]; const lay = []; let bottom = 1;
        for (let j = 0; j < n; j++, r += 33) { const top = j === n - 1 ? 127 : Math.max(bottom, o[p + 13 + j]); const h = hex(o, r, 8); const ram = o[r + 8] === 1; const m = ram && kmp ? kmp.byHash.get(h) : null;
          lay.push({ vb: bottom, vt: top, ref: ram ? (m ? { ram: true, ...m } : { ram: true, missing: true }) : (/^0+$/.test(h) && !((o[r + 10] << 8) | o[r + 11]) ? null : { ram: false, rom: (o[r + 10] << 8) | o[r + 11] }) }); bottom = top + 1; }
        keys.push(lay); }
      return { kit: true, keys };
    }
    return null;
  }
  // all programs of a PCG file: [{slot, name, prog}]
  function pcgPrograms(bytes, kmp) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const k = parseKorf(b); const out = [];
    const cs = k.chunks.filter(c => /^10..0038$/.test(c.id)); let i = 0;
    for (const c of cs) { const raw = oc31(b.subarray(c.off, c.off + c.size)); const e = k.entries[i++] || {}; if (!raw) continue;
      out.push({ slot: e.slot, name: e.name, raw, prog: parseProgram(raw, kmp) || parseKit(raw, kmp) }); }
    return out;
  }
  const api = { decodeForPlay, parseKmp, parseProgram, parseKit, pcgPrograms, oc31, padPresets, isKorf, parseKorf, decodeSample, wavBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PAKorf = api;
})(typeof window !== 'undefined' ? window : globalThis);
