// PA5X Set Tool — sampler: plays the set's own user sounds from RAM.KMP + PCM samples (WebAudio).
// Layers that point to factory ROM multisamples are reported back so the player can sound them with the GM synth instead.
(function (root) {
  'use strict';
  const K = () => root.PAKorf;
  const ATTACK = 0.003, REL = 0.18, REL_ONESHOT = 0.6;

  class Sampler {
    constructor() { this.ctx = null; this.out = null; this.ch = []; this.reset(); this.enabled = true; }
    reset() {
      this.kmp = null; this.progs = new Map(); this.index = null; this.buffers = new Map(); this.loading = new Map();
      this.ctx = this.ctx || null; this.voices = new Map(); this.readRange = null; this.info = ''; this.bytes = 0; if (this.ch) for (const c of this.ch) if (c) c.prog = null;
    }
    // files: {kmp: Uint8Array, pcg: [{name, bytes}], index: [{h, rel, off, ch, fmt, rate, fr, ls, le, lf, dl}]}
    load(files, readRange) {
      this.reset(); const Kx = K(); this.readRange = readRange;
      if (!files.kmp || !files.index || !files.index.length) { this.info = 'няма семпли в сета'; return false; }
      this.kmp = Kx.parseKmp(files.kmp);
      this.index = new Map(); for (const e of files.index) this.index.set(e.h, e);
      let n = 0;
      for (const f of files.pcg) {
        const bank = root.PACore.pcgBankFromFile(f.name); if (!bank) continue;
        let ps = []; try { ps = Kx.pcgPrograms(f.bytes, this.kmp); } catch (e) { continue; }
        for (const p of ps) if (p.prog && p.slot != null) { this.progs.set(`${bank.msb}.${bank.lsb}.${p.slot}`, { name: p.name, ...p.prog }); n++; }
      }
      this.info = `${n} звука, ${this.kmp.samples.length} семпъла`;
      return true;
    }
    key(sound) { return sound && sound.pc != null ? `${sound.msb}.${sound.lsb}.${sound.pc}` : null; }
    program(sound) { const k = this.key(sound); return k ? this.progs.get(k) || null : null; }
    // what a sound will use: 'set' (only set samples), 'mixed' (set + factory layers), 'factory'
    status(sound) {
      const p = this.program(sound); if (!p) return 'factory';
      let ram = 0, rom = 0;
      const look = (r) => { if (!r) return; if (r.ram && !r.missing) ram++; else rom++; };
      if (p.kit) for (const L of p.keys) for (const l of L) look(l.ref); else for (const o of p.oscs) { look(o.hi); if (o.sw > 1) look(o.lo); }
      return ram && !rom ? 'set' : ram ? 'mixed' : 'factory';
    }
    // ---- sample loading ----
    sampleRefs(sound) { // all sample indices a sound may need
      const p = this.program(sound); const out = new Set(); if (!p) return out; const km = this.kmp;
      const addRef = (r) => { if (!r || !r.ram || r.missing) return;
        if (r.kind === 'ms') { const m = km.ms[r.i]; for (let z = m.zs; z < m.zs + m.nz; z++) { const s = km.zones[z].s; if (s < km.samples.length) out.add(s); } }
        else { for (const s of km.drums[r.i].refs) if (s < km.samples.length) out.add(s); } };
      if (p.kit) for (const L of p.keys) for (const l of L) addRef(l.ref); else for (const o of p.oscs) { addRef(o.hi); if (o.sw > 1) addRef(o.lo); }
      return out;
    }
    async prepare(ctx, sounds, onProgress) {
      if (!this.kmp || !this.enabled) return; this.ensureCtx(ctx);
      const need = new Set(); for (const s of sounds) for (const i of this.sampleRefs(s)) need.add(i);
      if (this.bytes > 400e6) { for (const [i, b] of this.buffers) if (!need.has(i)) { if (b && b.buf) this.bytes -= b.buf.length * b.buf.numberOfChannels * 4; this.buffers.delete(i); } }
      const list = [...need].filter(i => !this.buffers.has(i)); let done = 0;
      const byFile = new Map(); for (const i of list) { const e = this.index.get(this.kmp.samples[i].hash); if (!e) continue; if (!byFile.has(e.rel)) byFile.set(e.rel, []); byFile.get(e.rel).push([i, e]); }
      for (const [, items] of byFile) {
        await Promise.all(items.map(([i, e]) => this.loadSample(i, e)));
        done += items.length; if (onProgress) onProgress(done, list.length);
      }
    }
    async loadSample(i, e) {
      if (this.buffers.has(i)) return this.buffers.get(i); if (this.loading.has(i)) return this.loading.get(i);
      const pr = (async () => {
        const bytes = new Uint8Array(await this.readRange(e.rel, e.off, e.dl));
        const s = { channels: e.ch, compressed: (e.fmt & 0x80) !== 0, frames: e.fr, dataLen: e.dl, rate: e.rate, loopStart: e.ls, loopEnd: e.le, loopFlag: e.lf };
        const chs = K().decodeForPlay(bytes, s, 0); const n = chs[0].length; if (!n) return null;
        const buf = this.ctx.createBuffer(chs.length, n, e.rate || 44100); chs.forEach((c, k) => buf.copyToChannel(c, k));
        const r = { buf, loop: !!e.lf && e.le - e.ls > 16, ls: e.ls / (e.rate || 44100), le: Math.min(e.le, n) / (e.rate || 44100) };
        this.buffers.set(i, r); this.bytes += n * chs.length * 4; return r;
      })().catch(() => null).finally(() => this.loading.delete(i));
      this.loading.set(i, pr); return pr;
    }
    // ---- audio graph per MIDI channel ----
    ensureCtx(ctx, dest) {
      if (this.ctx === ctx && this.out) return; this.ctx = ctx; this.out = ctx.createGain(); this.out.connect(dest || ctx.destination); this.ch = [];
    }
    connect(dest) { if (this.out) { try { this.out.disconnect(); } catch (e) { } this.out.connect(dest); } }
    chan(c) {
      if (!this.ch[c]) { const g = this.ctx.createGain(), p = this.ctx.createStereoPanner(); g.connect(p); p.connect(this.out); this.ch[c] = { g, p, vol: 100, exp: 127, pan: 64, sustain: false, held: new Set(), prog: null }; this.applyGain(c, 0); }
      return this.ch[c];
    }
    applyGain(c, t) { const s = this.ch[c]; const v = (s.vol / 127) ** 2 * (s.exp / 127) ** 2; s.g.gain.setValueAtTime(v, Math.max(t || 0, this.ctx.currentTime)); s.p.pan.setValueAtTime((s.pan - 64) / 63, Math.max(t || 0, this.ctx.currentTime)); }
    setProgram(c, sound) { const p = this.enabled ? this.program(sound) : null; this.chan(c).prog = p && this.status(sound) !== 'factory' ? p : null; return !!this.chan(c).prog; }
    active(c) { return !!(this.ch[c] && this.ch[c].prog); }
    cc(c, num, val, t) {
      const s = this.chan(c);
      if (num === 7) { s.vol = val; this.applyGain(c, t); } else if (num === 11) { s.exp = val; this.applyGain(c, t); } else if (num === 10) { s.pan = val; this.applyGain(c, t); }
      else if (num === 64) { s.sustain = val >= 64; if (!s.sustain) { for (const k of s.held) this.noteOff(c, k, t, true); s.held.clear(); } }
      else if (num === 120 || num === 123) this.allOff(c, t, num === 120);
    }
    // returns {played, rom}: rom = true when a factory layer should sound for this note
    noteOn(c, key, vel, t) {
      const s = this.chan(c); const p = s.prog; if (!p) return { played: false, rom: true };
      const km = this.kmp; let played = 0, rom = false, missing = false; const vs = [];
      const start = (sIdx, root, tune, pan) => {
        const b = this.buffers.get(sIdx); if (!b || !b.buf) { missing = true; if (!this.buffers.has(sIdx)) { const e = this.index.get(km.samples[sIdx].hash); if (e) this.loadSample(sIdx, e); } return; }
        const src = this.ctx.createBufferSource(); src.buffer = b.buf;
        if (root != null) src.playbackRate.value = 2 ** ((key - root) / 12 + (tune || 0) / 1200);
        if (b.loop) { src.loop = true; src.loopStart = b.ls; src.loopEnd = b.le; }
        const g = this.ctx.createGain(); const amp = (vel / 127) ** 1.6 * 0.9;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + ATTACK);
        let node = g; if (pan) { const pn = this.ctx.createStereoPanner(); pn.pan.value = pan; g.connect(pn); node = pn; }
        src.connect(g); node.connect(s.g); src.start(t); vs.push({ src, g, loop: b.loop }); played++;
      };
      const msVoice = (r) => { const m = km.ms[r.i]; const zi = m.keymap[key]; if (zi === 255 || zi >= m.nz) return; const z = km.zones[m.zs + zi]; if (z.s >= km.samples.length) return; start(z.s, z.orig, z.tune); };
      const dsVoice = (r) => { const d = km.drums[r.i]; const st = d.refs.length > 1; d.refs.forEach((sI, k) => { if (sI < km.samples.length) start(sI, null, 0, st ? (k === 0 ? -1 : 1) : 0); }); };
      if (p.kit) {
        const L = p.keys[key] || []; const l = L.find(x => vel >= x.vb && vel <= x.vt) || L[L.length - 1];
        if (l && l.ref) { if (l.ref.ram && !l.ref.missing) (l.ref.kind === 'ds' ? dsVoice : msVoice)(l.ref); else rom = true; }
      } else {
        for (const o of p.oscs) {
          if (key < o.kb || key > o.kt || vel < o.vb || vel > o.vt) continue;
          const r = o.sw > 1 && vel < o.sw ? o.lo : o.hi; if (!r) continue;
          if (r.ram && !r.missing) (r.kind === 'ds' ? dsVoice : msVoice)(r); else rom = true;
        }
      }
      if (vs.length) { const k = c * 128 + key; const old = this.voices.get(k); if (old) this.release(old, t, 0.03); this.voices.set(k, { vs, kit: !!p.kit }); }
      return { played: played > 0, rom: rom || (missing && !played) };
    }
    release(v, t, rel) {
      for (const x of v.vs) { const r = rel != null ? rel : (x.loop ? REL : (v.kit ? REL_ONESHOT : REL)); try { x.g.gain.cancelScheduledValues(t); x.g.gain.setTargetAtTime(0, t, r / 4); x.src.stop(t + r * 2); } catch (e) { } }
    }
    noteOff(c, key, t, force) {
      const s = this.ch[c]; if (!s) return; if (s.sustain && !force) { s.held.add(key); return; }
      const k = c * 128 + key; const v = this.voices.get(k); if (!v) return; this.voices.delete(k);
      if (v.kit) { // drum hits ring out unless the sample loops
        if (v.vs.some(x => x.loop)) this.release(v, t); return; }
      this.release(v, t);
    }
    allOff(c, t, hard) {
      const tt = Math.max(t || 0, this.ctx ? this.ctx.currentTime : 0);
      for (const [k, v] of this.voices) if (c == null || Math.floor(k / 128) === c) { this.voices.delete(k); if (!hard && v.kit && !v.vs.some(x => x.loop)) continue; this.release(v, tt, hard ? 0.01 : 0.05); }
      if (c != null && this.ch[c]) { this.ch[c].held.clear(); this.ch[c].sustain = false; }
    }
  }
  root.PASampler = Sampler;
})(typeof window !== 'undefined' ? window : globalThis);
