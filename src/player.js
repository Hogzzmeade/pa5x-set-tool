// PA5X Set Tool — player: arranger-style playback of styles, pads and keyboard sets.
// Output: built-in SoundFont synth (SpessaSynth, GM approximation) or Web MIDI to the real keyboard.
(function (root) {
  'use strict';
  const LOOK = 0.12, TICK_MS = 20;
  const isVar = (id) => /^Var\d$/.test(id);
  const isOneShot = (id) => /^(Intro|CountIn|Fill|Break|End)/.test(id);

  class Player {
    constructor() {
      this.ctx = null; this.synth = null; this.ready = null; this.out = 'synth'; this.midiOut = null; this.midiAccess = null;
      this.style = null; this.playing = false; this.channels = null; this.mutes = new Set(); this.solos = new Set();
      this.transpose = 0; this.tempo = 120; this.volume = 1; this.onState = null; this.timer = null;
      this.drumCh = new Set(); this.held = new Map(); // ch -> Set(notes)
      this.trackVol = {}; this.activity = {}; this.loop = true;
    }
    async init(loadBank) {
      if (this.ready) return this.ready;
      this.ready = (async () => {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        await this.ctx.audioWorklet.addModule('spessasynth_processor.min.js');
        this.synth = new root.SpessaLib.WorkletSynthesizer(this.ctx);
        this.gain = this.ctx.createGain(); this.synth.connect(this.gain); this.gain.connect(this.ctx.destination);
        await this.synth.soundBankManager.addSoundBank(await loadBank(), 'main');
        await this.synth.isReady;
      })();
      return this.ready;
    }
    async midiOutputs() {
      try { if (!this.midiAccess) this.midiAccess = await navigator.requestMIDIAccess({ sysex: false }); return [...this.midiAccess.outputs.values()].map(o => ({ id: o.id, name: o.name })); }
      catch (e) { return []; }
    }
    setOutput(id) { this.allNotesOff(); if (id === 'synth') { this.out = 'synth'; this.midiOut = null; } else { this.midiOut = this.midiAccess && this.midiAccess.outputs.get(id); this.out = this.midiOut ? 'midi' : 'synth'; } this.programCache = new Map(); }
    setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; }
    now() { return this.ctx.currentTime; }

    // ---- low level send (time in AudioContext seconds) ----
    send(bytes, time) {
      if (this.out === 'midi' && this.midiOut) {
        const ts = performance.now() + Math.max(0, (time - this.ctx.currentTime) * 1000);
        try { this.midiOut.send(bytes, ts); } catch (e) { }
        return;
      }
      const s = this.synth; const st = bytes[0] & 0xf0, ch = bytes[0] & 15; const o = { time: Math.max(time, this.ctx.currentTime) };
      if (st === 0x90 && bytes[2] > 0) s.noteOn(ch, bytes[1], bytes[2], o);
      else if (st === 0x80 || st === 0x90) s.noteOff(ch, bytes[1], o);
      else s.sendMessage(bytes, 0, o);
    }
    // apply a clip's sound setup to a channel (GM approximation for the synth, raw for MIDI out)
    setupChannel(ch, sound, setupEvents, time, trackName) {
      const ov = trackName != null ? this.trackVol[trackName] : undefined;
      if (this.out === 'midi') {
        for (const e of setupEvents) if (e.kind === 'ch') { if (ov != null && (e.status & 0xf0) === 0xb0 && e.data[0] === 7) continue; this.send([(e.status & 0xf0) | ch, ...e.data], time); }
        if (ov != null) this.send([0xb0 | ch, 7, ov], time);
        return;
      }
      const drum = sound && sound.msb === 120;
      if (this.synth.midiChannels[ch]) this.synth.midiChannels[ch].setDrums(!!drum);
      if (drum) this.drumCh.add(ch); else this.drumCh.delete(ch);
      this.send([0xc0 | ch, sound && sound.pc !== null ? sound.pc : 0], time);
      for (const e of setupEvents) {
        if (e.kind !== 'ch' || (e.status & 0xf0) !== 0xb0) continue; const c = e.data[0];
        if (c === 7 && ov != null) continue;
        if ([7, 10, 11, 91, 93, 64, 1].includes(c)) this.send([0xb0 | ch, c, e.data[1]], time);
      }
      if (ov != null) this.send([0xb0 | ch, 7, ov], time);
    }
    setTrackVolume(name, v) { this.trackVol[name] = v; if (this.ctx && this.channels && this.channels[name]) this.send([0xb0 | ((this.channels[name] - 1) & 15), 7, v], this.ctx.currentTime); }
    trackSetupVolume(el, name) { const tr = el && el.tracks.find(t => t.name === name); if (!tr) return null; for (const e of tr.info.setup) if (e.kind === 'ch' && (e.status & 0xf0) === 0xb0 && e.data[0] === 7) return e.data[1]; return 100; }
    noteMsg(e, ch, transpose) {
      const hi = e.status & 0xf0;
      if (hi === 0x90 || hi === 0x80) { const n = e.data[0] + (this.drumCh.has(ch) || this.out === 'midi' && transpose === null ? 0 : (transpose || 0)); if (n < 0 || n > 127) return null; return [hi | ch, n, e.data[1]]; }
      if (hi === 0xb0) { const c = e.data[0]; if (this.out === 'synth' && [0, 32, 98, 99, 100, 101, 6, 38].includes(c)) return null; return [0xb0 | ch, c, e.data[1]]; }
      if (hi === 0xc0) return this.out === 'midi' ? [0xc0 | ch, e.data[0]] : null;
      return [hi | ch, ...e.data];
    }
    track(ch, msg, time) { // remember held notes for clean stops
      const hi = msg[0] & 0xf0; if (!this.held.has(ch)) this.held.set(ch, new Set()); const h = this.held.get(ch);
      if (hi === 0x90 && msg[2] > 0) h.add(msg[1]); else if (hi === 0x80 || hi === 0x90) h.delete(msg[1]);
    }
    allNotesOff(time) {
      if (!this.ctx) return; const t = time || this.ctx.currentTime;
      for (const [ch, set] of this.held) { for (const n of set) this.send([0x80 | ch, n, 0], t); set.clear(); }
      for (let ch = 0; ch < 16; ch++) { this.send([0xb0 | ch, 123, 0], t); this.send([0xb0 | ch, 64, 0], t); }
    }

    // ---- style playback ----
    loadStyle(style, channels) {
      this.stop(); this.style = style; this.channels = channels; this.tempo = style.tempo; this.lastVar = 'Var1';
      this.programCache = new Map();
    }
    element(id) { return this.style && this.style.elements.find(e => e.id === id && e.length > 0); }
    secPerTick(div) { return 60 / this.tempo / div; }
    audible(t) { return this.solos.size ? this.solos.has(t) : !this.mutes.has(t); }
    buildEvents(el) { // flatten clips into [{tick, track, e}] relative to element start
      const out = [];
      for (const tr of el.tracks) { if (tr.name === 'Chords') continue; const scale = el.division / tr.division;
        for (const e of tr.info.music) { const tk = Math.round((e.t - tr.info.setupEnd) * scale); if (tk >= 0 && e.kind === 'ch') out.push({ tk, tr: tr.name, e }); } }
      out.sort((a, b) => a.tk - b.tk || (((a.e.status & 0xf0) === 0x80 || a.e.data[1] === 0) ? -1 : 1)); return out;
    }
    async start(id) {
      if (!this.style) return; await this.ctx.resume();
      const el = this.element(id) || this.element(this.lastVar) || this.style.elements.find(e => e.length);
      if (!el) return; if (this.playing) { this.queue(el.id); return; }
      this.pending = null;
      this.playing = true; this.begin(el, this.ctx.currentTime + 0.08);
      this.timer = setInterval(() => this.pump(), TICK_MS); this.emit();
    }
    begin(el, time) {
      this.cur = el; this.events = this.buildEvents(el); this.idx = 0; this.t0 = time; this.tick0 = 0;
      if (isVar(el.id)) this.lastVar = el.id;
      for (const tr of el.tracks) { if (tr.name === 'Chords') continue; const ch = (this.channels[tr.name] || 1) - 1; this.setupChannel(ch, tr.sound, tr.info.setup, time, tr.name); }
      this.barTicks = el.division * 4 * el.ts.num / (2 ** el.ts.den); this.emit();
    }
    tickToTime(tk) { return this.t0 + (tk - this.tick0) * this.secPerTick(this.cur.division); }
    setTempo(bpm) { // re-anchor so position is continuous
      if (this.playing && this.cur) { const now = this.ctx.currentTime; const tk = this.tick0 + (now - this.t0) / this.secPerTick(this.cur.division); this.tempo = bpm; this.t0 = now; this.tick0 = tk; }
      else this.tempo = bpm;
    }
    curTick() { return Math.max(0, this.tick0 + (this.ctx.currentTime - this.t0) / this.secPerTick(this.cur.division)); }
    queue(id) { // Korg-like: Var during Intro/Fill/Break only sets the target; otherwise switch at next bar
      const el = this.element(id); if (!el || !this.playing) return;
      if (isVar(id) && isOneShot(this.cur.id) && !/^End/.test(this.cur.id)) { this.lastVar = id; this.emit(); return; }
      const tk = this.curTick() + 1; this.pending = el; this.pendingTk = Math.min(this.cur.length, Math.ceil(tk / this.barTicks) * this.barTicks);
      if (isVar(id)) this.lastVar = id; this.emit();
    }
    pump() {
      if (!this.playing) return; const horizon = this.ctx.currentTime + LOOK;
      for (let guard = 0; guard < 100000; guard++) {
        const el = this.cur; const limit = this.pending ? this.pendingTk : el.length;
        if (this.idx < this.events.length && this.events[this.idx].tk < limit) {
          const ev = this.events[this.idx]; const t = this.tickToTime(ev.tk); if (t > horizon) return;
          this.idx++; if (!this.audible(ev.tr)) continue;
          const ch = (this.channels[ev.tr] || 1) - 1; const tp = (ev.tr === 'Drum' || ev.tr === 'Perc') ? 0 : this.transpose;
          const msg = this.noteMsg(ev.e, ch, tp);
          if (msg && (msg[0] & 0xf0) === 0xb0 && msg[1] === 7 && this.trackVol[ev.tr] != null) continue;
          if (msg) { this.send(msg, t); this.track(ch, msg); if ((msg[0] & 0xf0) === 0x90 && msg[2] > 0) this.activity[ev.tr] = t; }
          continue;
        }
        const tB = this.tickToTime(limit); if (tB > horizon) return;
        this.allNotesOff(tB);
        if (this.pending) { const p = this.pending; this.pending = null; this.begin(p, tB); continue; }
        let next = null;
        if (isVar(el.id)) { if (!this.loop) { this.playing = false; clearInterval(this.timer); this.emit(); return; } next = el; }
        else if (/^End/.test(el.id)) { this.playing = false; clearInterval(this.timer); this.emit(); return; }
        else next = this.element(this.lastVar) || this.style.elements.find(x => isVar(x.id) && x.length) || null;
        if (!next || !next.length) { this.playing = false; clearInterval(this.timer); this.emit(); return; }
        this.begin(next, tB);
      }
    }
    stop() {
      clearInterval(this.timer); this.timer = null; const was = this.playing; this.playing = false; this.pending = null;
      if (this.ctx) this.allNotesOff(); if (was) this.emit();
    }
    position() {
      if (!this.playing || !this.cur) return null;
      const tk = this.curTick();
      return { tick: Math.floor(tk % (this.cur.division * 4 / (2 ** this.cur.ts.den))), id: this.cur.id, bar: Math.floor(tk / this.barTicks) + 1, bars: Math.round(this.cur.length / this.barTicks), beat: Math.floor((tk % this.barTicks) / (this.cur.division * 4 / (2 ** this.cur.ts.den))) + 1, pending: this.pending && this.pending.id };
    }
    emit() { if (this.onState) this.onState(); }

    // ---- one-shot clip (pads) ----
    async playClip(smf, sound, ch) {
      await this.ctx.resume(); const t0 = this.ctx.currentTime + 0.05; const div = smf.division; const sp = 60 / this.tempo / div;
      const setup = smf.tracks[0] || []; const setupEnd = setup.length ? setup[setup.length - 1].t : 0;
      this.setupChannel(ch, sound, setup, t0);
      const evs = []; for (let i = 1; i < smf.tracks.length; i++) for (const e of smf.tracks[i]) if (e.kind === 'ch') evs.push(e);
      evs.sort((a, b) => a.t - b.t);
      for (const e of evs) { const tk = e.t - setupEnd; if (tk < 0) continue; const m = this.noteMsg(e, ch, 0); if (m) { this.send(m, t0 + tk * sp); this.track(ch, m); } }
    }

    // ---- single note preview (editor) ----
    async audition(sound, setupEvents, ch, key, vel) {
      await this.ctx.resume(); const t = this.ctx.currentTime + 0.01; this.setupChannel(ch, sound, setupEvents || [], t);
      this.send([0x90 | ch, key, vel], t); this.send([0x80 | ch, key, 0], t + 0.35);
    }
    // ---- live keyboard (keyboard sets) ----
    async setKeyboardSet(ks) {
      await this.ctx.resume(); this.ks = ks; const t = this.ctx.currentTime;
      ks.tracks.forEach((tr, i) => { const ch = 10 + i; this.setupChannel(ch, tr.sound, tr.sound ? [{ kind: 'ch', status: 0xb0, data: [7, tr.sound.vol ?? 100] }, ...(tr.sound.pan != null ? [{ kind: 'ch', status: 0xb0, data: [10, tr.sound.pan] }] : [])] : [], t);
        if (this.out === 'midi' && tr.sound) { if (tr.sound.msb != null) this.send([0xb0 | ch, 0, tr.sound.msb], t); if (tr.sound.lsb != null) this.send([0xb0 | ch, 32, tr.sound.lsb], t); if (tr.sound.pc != null) this.send([0xc0 | ch, tr.sound.pc], t); } });
    }
    kbNote(note, vel) {
      if (!this.ks || !this.ctx) return; const t = this.ctx.currentTime; const split = this.ks.splitPoint ?? 60;
      this.ks.tracks.forEach((tr, i) => {
        if (tr.mute) return; const lower = /lower/i.test(tr.name); if (lower !== (note < split)) return;
        const ch = 10 + i; const msg = vel > 0 ? [0x90 | ch, note, vel] : [0x80 | ch, note, 0]; this.send(msg, t); this.track(ch, msg);
      });
    }
  }
  root.PAPlayer = Player;
})(typeof window !== 'undefined' ? window : globalThis);
