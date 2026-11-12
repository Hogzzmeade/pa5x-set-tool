// PA5X Set Tool — core: KORG PA5X STG/KSC tree parser, SMF reader/writer, style→MIDI export.
// Independent implementation written from analysis of the user's own set files.
(function (root) {
  'use strict';
  const td = new TextDecoder('utf-8');

  // ---------- container tree (Root / Branch / Leaf) ----------
  function readCStr(b, p) { let e = p; while (e < b.length && b[e] !== 0) e++; return [td.decode(b.subarray(p, e)), e + 1]; }
  function u32(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }

  function parseTree(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    function walk(p, end, out) {
      while (p < end) {
        let kind; [kind, p] = readCStr(b, p);
        if (kind === 'Root') {
          const ver = b.slice(p, p + 2); p += 2; const size = u32(b, p); p += 4;
          const node = { kind: 'Root', name: '', ver, children: [] };
          walk(p, Math.min(p + size, b.length), node.children); out.push(node); p += size;
        } else if (kind === 'Branch' || kind === 'Leaf') {
          let name; [name, p] = readCStr(b, p); const size = u32(b, p); p += 4;
          const node = { kind, name, offset: p, size };
          if (kind === 'Branch') { node.children = []; walk(p, Math.min(p + size, end), node.children); }
          else node.data = b.subarray(p, p + size);
          out.push(node); p += size;
        } else throw new Error('Unknown node "' + kind.slice(0, 16) + '" at ' + p);
      }
      return out;
    }
    const nodes = walk(0, b.length, []);
    if (!nodes.length || nodes[0].kind !== 'Root') throw new Error('Not a PA5X tree file');
    return nodes[0];
  }
  // serialize a tree back to bytes (exact inverse of parseTree)
  function serializeTree(rootNode) {
    const enc = new TextEncoder(); const chunks = [];
    const p32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    function body(n) { // returns array of Uint8Array for node payload
      if (n.kind === 'Leaf') return [n.data];
      const out = []; for (const c of n.children) out.push(...node(c)); return out;
    }
    const len = (arr) => arr.reduce((s, x) => s + x.length, 0);
    function node(n) {
      const b = body(n); const size = len(b);
      if (n.kind === 'Root') return [enc.encode('Root\0'), n.ver || new Uint8Array([1, 0]), p32(size), ...b];
      return [enc.encode(n.kind + '\0' + n.name + '\0'), p32(size), ...b];
    }
    const parts = node(rootNode); const out = new Uint8Array(len(parts)); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out;
  }
  const child = (n, name) => n && n.children && n.children.find(c => c.name === name);
  const childrenEnding = (n, ext) => (n && n.children ? n.children.filter(c => c.name.toLowerCase().endsWith(ext)) : []);
  const leafText = (n) => (n && n.data ? td.decode(n.data) : '');
  function xmlAttr(xml, tag, attr) {
    const m = new RegExp('<' + tag + '\\b[^>]*\\b' + attr + '="([^"]*)"').exec(xml); return m ? m[1] : null;
  }
  function xmlAll(xml, tag) {
    const out = []; const re = new RegExp('<' + tag + '\\b([^>]*)/?>', 'g'); let m;
    while ((m = re.exec(xml))) { const o = {}; m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { o[k] = v; }); out.push(o); }
    return out;
  }

  // ---------- Standard MIDI File ----------
  function readVLQ(b, p) { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return [v, p]; }
  function parseSMF(b) {
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('Not SMF');
    const hl = u32(b, 4); const format = (b[8] << 8) | b[9]; const ntr = (b[10] << 8) | b[11]; const division = (b[12] << 8) | b[13];
    let p = 8 + hl; const tracks = [];
    for (let i = 0; i < ntr && p + 8 <= b.length; i++) {
      const len = u32(b, p + 4); let q = p + 8; const end = Math.min(q + len, b.length); let t = 0, rs = 0; const ev = [];
      while (q < end) {
        let d; [d, q] = readVLQ(b, q); t += d; const s = b[q];
        if (s === 0xff) { const type = b[q + 1]; let l; [l, q] = readVLQ(b, q + 2); ev.push({ t, kind: 'meta', type, data: b.slice(q, q + l) }); q += l; }
        else if (s === 0xf0 || s === 0xf7) { let l; [l, q] = readVLQ(b, q + 1); ev.push({ t, kind: 'sysex', status: s, data: b.slice(q, q + l) }); q += l; }
        else {
          if (s & 0x80) { rs = s; q++; }
          const hi = rs & 0xf0; const n = (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
          ev.push({ t, kind: 'ch', status: rs, data: b.slice(q, q + n) }); q += n;
        }
      }
      tracks.push(ev); p = end;
    }
    return { format, division, tracks };
  }
  function vlq(v) { const a = [v & 0x7f]; while ((v >>= 7)) a.unshift((v & 0x7f) | 0x80); return a; }
  function writeSMF(division, tracks) { // tracks: arrays of {t, kind, ...} absolute ticks
    const out = [];
    const push32 = (a, v) => a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    out.push(0x4d, 0x54, 0x68, 0x64); push32(out, 6); out.push(0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (division >> 8) & 255, division & 255);
    for (const tr of tracks) {
      const ev = tr.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || (a[0].prio || 0) - (b[0].prio || 0) || a[1] - b[1]).map(x => x[0]);
      const body = []; let last = 0, end = 0;
      for (const e of ev) {
        if (e.kind === 'meta' && e.type === 0x2f) { end = Math.max(end, e.t); continue; }
        body.push(...vlq(e.t - last)); last = e.t;
        if (e.kind === 'meta') { body.push(0xff, e.type, ...vlq(e.data.length), ...e.data); }
        else if (e.kind === 'sysex') { body.push(e.status, ...vlq(e.data.length), ...e.data); }
        else body.push(e.status, ...e.data);
      }
      body.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
      out.push(0x4d, 0x54, 0x72, 0x6b); push32(out, body.length); for (const x of body) out.push(x);
    }
    return new Uint8Array(out);
  }
  const textMeta = (t, type, s, prio) => ({ t, kind: 'meta', type, data: new TextEncoder().encode(s), prio: prio || 0 });

  // ---------- domain ----------
  const ELEMENT_ORDER = ['Intro1', 'Intro2', 'Intro3', 'CountIn', 'Var1', 'Var2', 'Var3', 'Var4', 'Fill1', 'Fill2', 'Fill3', 'Fill4', 'Break', 'End1', 'End2', 'End3'];
  const ELEMENT_LABEL = { Intro1: 'Intro 1', Intro2: 'Intro 2', Intro3: 'Intro 3', CountIn: 'Intro 3 / Count In', Var1: 'Variation 1', Var2: 'Variation 2', Var3: 'Variation 3', Var4: 'Variation 4', Fill1: 'Fill 1', Fill2: 'Fill 2', Fill3: 'Fill 3', Fill4: 'Fill 4', Break: 'Break', End1: 'Ending 1', End2: 'Ending 2', End3: 'Ending 3' };
  const TRACK_ORDER = ['Bass', 'Drum', 'Perc', 'Acc1', 'Acc2', 'Acc3', 'Acc4', 'Acc5', 'Chords'];
  const DEFAULT_CHANNELS = { Bass: 1, Drum: 10, Perc: 9, Acc1: 2, Acc2: 3, Acc3: 4, Acc4: 5, Acc5: 6, Chords: 16 };

  function soundOf(smf) { // first bank select / program change found in setup track
    const s = { msb: null, lsb: null, pc: null, vol: null, pan: null };
    for (const tr of smf.tracks) for (const e of tr) {
      if (e.kind !== 'ch') continue; const hi = e.status & 0xf0;
      if (hi === 0xb0) { const [c, v] = e.data; if (c === 0 && s.msb === null) s.msb = v; else if (c === 32 && s.lsb === null) s.lsb = v; else if (c === 7 && s.vol === null) s.vol = v; else if (c === 10 && s.pan === null) s.pan = v; }
      else if (hi === 0xc0 && s.pc === null) s.pc = e.data[0];
    }
    return s;
  }
  const fmtSound = (s) => (s && s.pc !== null ? `${s.msb ?? '-'}.${s.lsb ?? '-'}.${s.pc + 1}` : '—');

  // split a clip SMF into setup part (track 0) and music part (track 1+), measured from end of setup bar
  function clipInfo(smf) {
    const setup = smf.tracks[0] || [];
    const setupEnd = setup.length ? setup[setup.length - 1].t : 0;
    const music = []; let end = setupEnd;
    for (let i = 1; i < smf.tracks.length; i++) for (const e of smf.tracks[i]) {
      if (e.kind === 'meta' && e.type === 0x2f) { end = Math.max(end, e.t); continue; }
      music.push(e);
    }
    if (smf.tracks.length === 1) end = setupEnd;
    let notes = 0; for (const e of music) if (e.kind === 'ch' && (e.status & 0xf0) === 0x90 && e.data[1] > 0) notes++;
    return { setup, setupEnd, music, length: Math.max(0, end - setupEnd), notes };
  }

  function parseTimeSig(sceneXml) {
    const n = +(xmlAttr(sceneXml, 'TimeSignature', 'numerator') || 4); const d = +(xmlAttr(sceneXml, 'TimeSignature', 'denominator') || 2);
    return { num: n, den: d, label: `${n}/${2 ** d}` };
  }

  function parseKeyboardSetNode(name, ksc) { // ksc branch (or Root of a .ksc file)
    const tracks = [];
    const rt = child(child(ksc, 'Main.ssn'), 'RTTracks.scn');
    if (rt) for (const plc of childrenEnding(rt, '.plc')) {
      const mid = child(plc, 'Main.mid');
      let snd = null; try { snd = soundOf(parseSMF(mid.data)); } catch (e) { }
      tracks.push({ name: plc.name.replace(/\.plc$/i, ''), sound: snd, octave: xmlAttr(leafText(child(plc, 'ClipDescription.xml')), 'Pitch', 'transposition') });
    } else for (const nm of ['Lower', 'Upper1', 'Upper2', 'Upper3']) { // compact layout inside .ksa
      const mid = child(ksc, nm + '.mid'); if (!mid) continue;
      let snd = null; try { snd = soundOf(parseSMF(mid.data)); } catch (e) { }
      tracks.push({ name: nm, sound: snd });
    }
    const xml = leafText(child(ksc, 'ClipDescription.xml'));
    const kp = {}; (xmlAll(xml, 'KeyboardProcessing')[0] && Object.assign(kp, xmlAll(xml, 'KeyboardProcessing')[0]));
    const tp = xmlAll(xml, 'Track\\dParams');
    tracks.forEach((t, i) => { const p = tp[i]; if (p) { t.mute = p.mute === '1'; t.keyLow = +p.keyrangelow; t.keyHigh = +p.keyrangehigh; } });
    return { name: name.replace(/\.ksc$/i, ''), tracks, splitPoint: kp.splitpoint ? +kp.splitpoint : null, keyboardMode: kp.keyboardmode, chordScanning: kp.chordscanning };
  }

  function findStc(rootNode) { // walk to the .stc branch
    let found = null; (function rec(n) { if (found || !n.children) return; for (const c of n.children) { if (c.kind === 'Branch' && /\.stc$/i.test(c.name)) { found = c; return; } rec(c); } })(rootNode); return found;
  }

  function parseStyle(bytes, fileName) {
    const rootNode = parseTree(bytes);
    const stc = findStc(rootNode); if (!stc) throw new Error('No style (.stc) inside');
    const ssn = child(stc, 'Main.ssn');
    const sessionXml = leafText(child(ssn, 'SessionDescription.xml'));
    const stageXml = leafText(child(rootNode, 'StageDescription.xml'));
    const tempoUs = +(xmlAttr(stageXml, 'Tempo', 'value') || 500000);
    const elements = [];
    for (const scn of childrenEnding(ssn, '.scn')) {
      const id = scn.name.replace(/\.scn$/i, '');
      const sceneXml = leafText(child(scn, 'SceneDescription.xml'));
      const ts = parseTimeSig(sceneXml);
      const tracks = [];
      for (const clip of scn.children.filter(c => c.kind === 'Branch')) {
        const tname = clip.name.replace(/\.(pdc|csc)$/i, '');
        const mid = child(clip, 'Main.mid'); if (!mid) continue;
        let smf, info; try { smf = parseSMF(mid.data); info = clipInfo(smf); } catch (e) { continue; }
        const cx = leafText(child(clip, 'ClipDescription.xml'));
        tracks.push({ name: tname, division: smf.division, smf, info, sound: soundOf(smf), origChord: { root: xmlAttr(cx, 'CV1', 'root'), chord: xmlAttr(cx, 'CV1', 'chord') } });
      }
      const division = tracks[0] ? tracks[0].division : 384;
      const length = Math.max(0, ...tracks.map(t => t.info.length));
      const barTicks = division * 4 * ts.num / (2 ** ts.den);
      elements.push({ id, label: ELEMENT_LABEL[id] || id, ts, tracks: tracks.sort((a, b) => TRACK_ORDER.indexOf(a.name) - TRACK_ORDER.indexOf(b.name)), division, length, bars: barTicks ? Math.round(length / barTicks * 100) / 100 : 0 });
    }
    elements.sort((a, b) => (ELEMENT_ORDER.indexOf(a.id) + 1 || 99) - (ELEMENT_ORDER.indexOf(b.id) + 1 || 99));
    // keyboard sets (two layouts) and pads
    const keyboardSets = []; const pads = [];
    (function rec(n) {
      if (!n.children) return;
      for (const c of n.children) {
        if (c.kind !== 'Branch') continue;
        if (/^KbdSet\d+\.scn$/i.test(c.name) || /^ks\d+$/i.test(c.name)) { const k = c.children.find(x => /\.ksc$/i.test(x.name)); if (k) keyboardSets.push(parseKeyboardSetNode(k.name, k)); continue; }
        if (/^PadSet\d+\.scn$/i.test(c.name)) { for (const p of c.children.filter(x => /\.pdc$/i.test(x.name))) { let snd = null, smf = null; try { smf = parseSMF(child(p, 'Main.mid').data); snd = soundOf(smf); } catch (e) { } pads.push({ name: p.name.replace(/\.pdc$/i, '').replace(/\(\d+\)$/, ''), sound: snd, smf }); } continue; }
        if (c === stc) continue;
        rec(c);
      }
    })(rootNode);
    return { name: stc.name.replace(/\.stc$/i, ''), fileName, tempo: Math.round(60000000 / tempoUs * 10) / 10, tempoUs, elements, keyboardSets, pads, sessionXml };
  }

  function parseKeyboardSetFile(bytes, fileName) {
    const r = parseTree(bytes); return parseKeyboardSetNode(fileName.replace(/^.*[\\/]/, ''), r);
  }

  // KORF chunk files (.MTP / .PCG): extract record names
  function korfNames(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const out = [];
    for (let i = 0; i + 34 < b.length; i++) {
      if (b[i] === 0 && b[i + 1] === 5 && b[i + 2] === 0 && b[i + 3] === 2 && b[i + 4] === 0 && b[i + 5] === 0x1c) {
        let e = i + 6; while (e < i + 34 && b[e]) e++; const s = td.decode(b.subarray(i + 6, e)); if (s) out.push(s); i += 33;
      }
    }
    return out;
  }



  // ---------- sound names (user banks from the set's SOUND/*.PCG; factory names from an optional table) ----------
  let curSoundIndex = null; let factoryNames = null;
  function pcgBankFromFile(name) { // USER02.PCG -> {msb:121, lsb:65}; USERDK01.PCG -> {msb:120, lsb:64}
    const m = /^USER(DK)?(\d+)\.PCG$/i.exec(name); if (!m) return null; return { msb: m[1] ? 120 : 121, lsb: 63 + parseInt(m[2], 10), bank: (m[1] ? 'USER DK ' : 'USER ') + parseInt(m[2], 10) };
  }
  function buildSoundIndex(pcgFiles) { // [{name:'USER01.PCG', entries:[{slot,name}]}]
    const idx = new Map(); idx.banks = new Set();
    for (const f of pcgFiles) { const b = pcgBankFromFile(f.name); if (!b) continue; idx.banks.add(b.msb + '.' + b.lsb);
      for (const e of f.entries) if (e.slot != null && e.name) idx.set(`${b.msb}.${b.lsb}.${e.slot}`, { name: e.name, bank: b.bank, slot: e.slot }); }
    return idx;
  }
  function setSoundIndex(idx) { curSoundIndex = idx; }
  function setFactoryNames(map) { factoryNames = map; }
  function soundInfo(s, idx) {
    idx = idx === undefined ? curSoundIndex : idx; if (!s || s.pc === null || s.pc === undefined) return null;
    const key = `${s.msb}.${s.lsb}.${s.pc}`; const num = `${s.msb ?? '-'}.${s.lsb ?? '-'}.${s.pc + 1}`;
    const u = idx && idx.get(key); if (u) return { name: u.name, num, src: `${u.bank}, слот ${u.slot + 1}` };
    if (s.lsb >= 64 && (s.msb === 121 || s.msb === 120)) { const bank = (s.msb === 120 ? 'USER DK ' : 'USER ') + (s.lsb - 63); return { name: null, num, src: idx && idx.banks && idx.banks.has(s.msb + '.' + s.lsb) ? `${bank}, празен слот ${s.pc + 1}` : `${bank} (липсва в сета)` }; }
    const f = factoryNames && factoryNames.get(key); if (f) return { name: f, num, src: 'фабричен' };
    return { name: null, num, src: 'фабричен' };
  }
  function soundLabel(s, idx) { const i = soundInfo(s, idx); if (!i) return '—'; return i.name || i.num; }
  function soundTitle(s, idx) { const i = soundInfo(s, idx); if (!i) return ''; return `${i.src} · MSB.LSB.Prog ${i.num}`; }

  // ---------- GM substitute for a Korg sound (used when the set has no samples for it) ----------
  // Factory sounds follow Korg's GM-compatible numbering (PC = GM instrument, LSB = variation).
  // User sounds have arbitrary slots, so their GM instrument is guessed from the sound name.
  const GM_RULES = [
    [/slap/i, 36], [/fretles/i, 35], [/syn.*bas|bas.*syn|moog|acid/i, 38], [/pick.*bas/i, 34], [/bas|\bb\s*\d|\bbs\b/i, 33],
    [/nylon|span|flamen|classic/i, 24], [/steel|folk g|acoust/i, 25], [/jazz/i, 26], [/mute|mut\b/i, 28], [/dist|power|over|rock|lead g|boss/i, 30], [/gtr|guit|gitar|gitara|wah|rthm/i, 27],
    [/sitar/i, 104], [/kombus|combus|cumbus|saz|baglam|ba[gğ]lama|tambur|cura|divan|bouzou|buzuk|mandol|tar\b/i, 106], [/oud|\bud\b|ud\s/i, 105], [/banjo/i, 105],
    [/kanun|kanoun|qanun|santur|cimbal|tsimb|cymbal|dulcim|tsimbal/i, 15], [/harp/i, 46],
    [/viola/i, 41], [/cello/i, 42], [/violin|violina|keman|kemen|gadul|gudul|cig|fiddle/i, 40], [/pizz/i, 45], [/str|string|ensem/i, 48],
    [/clar|klar/i, 71], [/sop.*sax/i, 64], [/ten.*sax/i, 66], [/bari/i, 67], [/sax/i, 65], [/trombon/i, 57], [/trump|trp|trumpet|trombe|truba|tromb/i, 56], [/tuba/i, 58], [/horn/i, 60], [/brass|brs/i, 61],
    [/zurna|zurla|zurn|shanai|shenai|mizmar|duduk|mey\b/i, 111], [/gaida|gajda|gayda|bagpipe|tulum/i, 109], [/kaval|ney|nay|shakuh|frula|flojer/i, 77], [/pan\s?fl|pan\b/i, 75], [/flute|flaut|fl\b/i, 73], [/oboe/i, 68], [/ocarin/i, 79],
    [/harmonica/i, 22], [/accord|acord|akord|harmonika|garmon|\bharm/i, 21], [/org/i, 16],
    [/el\.?\s?pian|e\.?\s?p(ia)?no|rhodes|wurli|\bep\b/i, 4], [/clav/i, 7], [/piano|pno|grand/i, 0],
    [/choir|vocal|voice|aah|ooh|vox|xor|\bhor\b|cantor/i, 52], [/hit|fabrika|stab/i, 55],
    [/vibra|vibes/i, 11], [/marimb/i, 12], [/xylo/i, 13], [/bell|tubular/i, 14], [/glock/i, 9], [/celest/i, 8],
    [/pad|warm|sweep/i, 89], [/square|sq\b/i, 80], [/syn|synt|sinth|sinty|lead|saw|kronos|keyb|moss/i, 81],
  ];
  function gmProgram(s, trackName) {
    if (!s || s.pc == null) return 0;
    if (s.msb === 120) return s.lsb >= 64 ? 0 : s.pc; // drum kits: user kits → standard GM kit
    if (!(s.msb === 121 && s.lsb >= 64)) return s.pc & 127;
    const i = soundInfo(s); const name = (i && i.name) || '';
    for (const [re, p] of GM_RULES) if (re.test(name)) return p;
    return trackName === 'Bass' ? 33 : 0;
  }

  // ---------- editing (copy elements / tracks between styles) ----------
  const SCENE_INFO = { Intro1: [1, 4], Intro2: [2, 5], CountIn: [3, 11], Var1: [4, 0], Var2: [5, 1], Var3: [6, 2], Var4: [7, 3], Fill1: [8, 6], Fill2: [9, 7], Fill3: [10, 13], Fill4: [11, 14], Break: [12, 10], End1: [13, 8], End2: [14, 9] };
  const TRACK_NUM = { Bass: 1, Drum: 2, Perc: 3, Acc1: 4, Acc2: 5, Acc3: 6, Acc4: 7, Acc5: 8, Chords: 10 };
  const TRACK_GROUP = { Bass: 'bass', Drum: 'drum', Perc: 'drum', Acc1: 'acc', Acc2: 'acc', Acc3: 'acc', Acc4: 'acc', Acc5: 'acc', Chords: 'chords' };
  const compatibleTracks = (t) => Object.keys(TRACK_GROUP).filter(x => TRACK_GROUP[x] === TRACK_GROUP[t]);
  const enc8 = (s) => new TextEncoder().encode(s);
  function cloneNode(n) { const o = { kind: n.kind, name: n.name }; if (n.ver) o.ver = n.ver.slice(); if (n.children) o.children = n.children.map(cloneNode); if (n.data) o.data = n.data.slice(); return o; }
  function stcOf(root) { const s = findStc(root); if (!s) throw new Error('Няма стил във файла'); return s; }
  const ssnOf = (root) => child(stcOf(root), 'Main.ssn');
  const sceneOf = (root, id) => child(ssnOf(root), id + '.scn');
  const clipName = (t) => t + (t === 'Chords' ? '.csc' : '.pdc');
  function setLeafText(parent, name, text) { const l = child(parent, name); l.data = enc8(text); }
  function sceneTs(scn) { const x = leafText(child(scn, 'SceneDescription.xml')); return parseTimeSig(x).label; }
  function clipLen(clip) { try { return clipInfo(parseSMF(child(clip, 'Main.mid').data)).length; } catch (e) { return 0; } }
  function sortScene(scn) {
    const clips = scn.children.filter(c => c.kind === 'Branch').sort((a, b) => (TRACK_NUM[a.name.replace(/\.\w+$/, '')] || 99) - (TRACK_NUM[b.name.replace(/\.\w+$/, '')] || 99));
    const rest = scn.children.filter(c => c.kind !== 'Branch'); scn.children = [...clips, ...rest];
    // rebuild RESOURCE list in SceneDescription.xml
    const sd = child(scn, 'SceneDescription.xml'); if (!sd) return;
    let x = leafText(sd); x = x.replace(/\s*<RESOURCE\b[^>]*\/>/g, '');
    const res = clips.map(c => { const t = c.name.replace(/\.\w+$/, ''); return `  <RESOURCE name="${c.name}" type="${t === 'Chords' ? 'ChordClip' : 'PadClip'}" track="${TRACK_NUM[t] || 1}"/>`; }).join('\n');
    x = x.replace(/<SCENE>\s*/, '<SCENE>\n' + (res ? res + '\n' : '') + '  ');
    sd.data = enc8(x);
  }
  function ensureScene(dstRoot, id, templateScn) {
    const ssn = ssnOf(dstRoot); let scn = child(ssn, id + '.scn'); if (scn) return scn;
    if (!SCENE_INFO[id]) throw new Error('Неизвестен елемент: ' + id);
    const sdT = templateScn ? leafText(child(templateScn, 'SceneDescription.xml')) : '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<SCENE>\n  <PARAMS>\n    <TimeSignature numerator="4" denominator="2" beatsubdivisions="1"/>\n  </PARAMS>\n</SCENE>\n';
    scn = { kind: 'Branch', name: id + '.scn', children: [{ kind: 'Leaf', name: 'SceneDescription.xml', data: enc8(sdT) }] };
    // insert in scene-number order, before non-scene leaves
    const num = SCENE_INFO[id][0]; const idx = ssn.children.findIndex(c => (c.kind !== 'Branch') || ((SCENE_INFO[c.name.replace(/\.scn$/, '')] || [99])[0] > num));
    ssn.children.splice(idx < 0 ? ssn.children.length : idx, 0, scn);
    const sess = child(ssn, 'SessionDescription.xml'); let x = leafText(sess);
    const lines = [...x.matchAll(/\s*<RESOURCE\b[^>]*\/>/g)].map(m => m[0].trim()); lines.push(`<RESOURCE scenenum="${num}" role="${SCENE_INFO[id][1]}" name="${id}.scn"/>`);
    lines.sort((a, b) => +/scenenum="(\d+)"/.exec(a)[1] - +/scenenum="(\d+)"/.exec(b)[1]);
    x = x.replace(/\s*<RESOURCE\b[^>]*\/>/g, ''); x = x.replace(/(<SESSION\b[^>]*>)\s*/, '$1\n' + lines.map(l => '  ' + l).join('\n') + '\n  ');
    sess.data = enc8(x); return scn;
  }
  function copyElement(srcRoot, srcId, dstRoot, dstId) {
    const src = sceneOf(srcRoot, srcId); if (!src) throw new Error('Елементът ' + srcId + ' липсва в изходния стил');
    const dst = ensureScene(dstRoot, dstId, src);
    dst.children = src.children.map(cloneNode); return { warnings: [] };
  }
  function copyTrack(srcRoot, srcId, track, dstRoot, dstId, dstTrack) {
    dstTrack = dstTrack || track;
    if (TRACK_GROUP[track] !== TRACK_GROUP[dstTrack]) throw new Error(`${track} не може да се копира в ${dstTrack} (различен тип писта)`);
    const src = sceneOf(srcRoot, srcId); const clip = src && child(src, clipName(track)); if (!clip) throw new Error(`Пистата ${track} липсва в ${srcId}`);
    const dstExisted = !!sceneOf(dstRoot, dstId); const dst = ensureScene(dstRoot, dstId, src); const warnings = [];
    if (dstExisted && sceneTs(dst) !== sceneTs(src)) throw new Error(`Различен такт: ${sceneTs(src)} → ${sceneTs(dst)}`);
    const nc = cloneNode(clip); nc.name = clipName(dstTrack);
    if (dstTrack !== track) { const cd = child(nc, 'ClipDescription.xml'); /* same Pattern type inside group, nothing else to rename */ }
    const others = dst.children.filter(c => c.kind === 'Branch' && c.name !== nc.name);
    if (others.length) { const L = Math.max(...others.map(clipLen)); const l = clipLen(nc); if (L && l && L !== l) warnings.push(`Дължината се различава (${(l / L).toFixed(2)}× спрямо останалите писти)`); }
    dst.children = dst.children.filter(c => c.name !== nc.name); dst.children.unshift(nc); sortScene(dst);
    return { warnings };
  }
  function deleteTrack(root, id, track) { const scn = sceneOf(root, id); if (!scn) return; scn.children = scn.children.filter(c => c.name !== clipName(track)); sortScene(scn); }
  function renameStyle(root, newName) { const s = stcOf(root); s.name = newName.replace(/\.stg$/i, '') + '.stc'; }



  // ---------- track properties (style element editor) ----------
  function clipNode(root, elId, track) { const scn = sceneOf(root, elId); return scn && child(scn, clipName(track)); }
  function getTrackProps(root, elId, track) {
    const cl = clipNode(root, elId, track); if (!cl) return null;
    const smf = parseSMF(child(cl, 'Main.mid').data); const x = leafText(child(cl, 'ClipDescription.xml'));
    const cc = (n) => { for (const e of smf.tracks[0] || []) if (e.kind === 'ch' && (e.status & 0xf0) === 0xb0 && e.data[0] === n) return e.data[1]; return null; };
    let pc = null; for (const e of smf.tracks[0] || []) if (e.kind === 'ch' && (e.status & 0xf0) === 0xc0) { pc = e.data[0]; break; }
    const cvs = new Set(); x.replace(/<\w+ cv="(\d+)"\/>/g, (_, n) => { cvs.add(+n); return ''; });
    const table = []; x.replace(/<CHORD_TABLE>([\s\S]*?)<\/CHORD_TABLE>/, (_, t) => { t.replace(/<(\w+) cv="(\d+)"\/>/g, (__, ch, n) => { table.push([ch, +n]); return ''; }); return ''; });
    const orig = []; x.replace(/<ORIGINAL_CHORD>([\s\S]*?)<\/ORIGINAL_CHORD>/, (_, t) => { t.replace(/<CV(\d+) root="([^"]*)" chord="([^"]*)"\/>/g, (__, n, r, ch) => { orig.push({ cv: +n, root: r, chord: ch }); return ''; }); return ''; });
    return { sound: { msb: cc(0), lsb: cc(32), pc, vol: cc(7) }, vol: cc(7), exp: cc(11), reverb: cc(91), chorus: cc(93), type: xmlAttr(x, 'Pattern', 'type') || '', keyLow: +(xmlAttr(x, 'KeyLow', 'value') ?? 0), keyHigh: +(xmlAttr(x, 'KeyHigh', 'value') ?? 127), hasKeyRange: /<KeyLow /.test(x), orig, table, cvs: [...cvs].sort() };
  }
  function setTrackProps(root, elId, track, p) { // p: {msb,lsb,pc,vol,exp,keyLow,keyHigh,origRoot,origChord}
    const cl = clipNode(root, elId, track); if (!cl) return false; const leaf = child(cl, 'Main.mid'); const smf = parseSMF(leaf.data); const t0 = smf.tracks[0];
    const firstCh = t0.find(e => e.kind === 'ch'); const tIns = firstCh ? firstCh.t : 0; const ch = firstCh ? firstCh.status & 15 : 0;
    const setCC = (n, v) => { if (v == null) return; const e = t0.find(e => e.kind === 'ch' && (e.status & 0xf0) === 0xb0 && e.data[0] === n); if (e) e.data = new Uint8Array([n, v & 127]); else { const i = t0.indexOf(firstCh); t0.splice(i < 0 ? t0.length : i, 0, { t: tIns, kind: 'ch', status: 0xb0 | ch, data: new Uint8Array([n, v & 127]) }); } };
    if (p.pc != null) { setCC(0, p.msb); setCC(32, p.lsb); const e = t0.find(e => e.kind === 'ch' && (e.status & 0xf0) === 0xc0); if (e) e.data = new Uint8Array([p.pc & 127]); else { const i = t0.findIndex(e => e.kind === 'ch' && (e.status & 0xf0) === 0xb0 && e.data[0] === 32); t0.splice(i < 0 ? t0.length : i + 1, 0, { t: tIns, kind: 'ch', status: 0xc0 | ch, data: new Uint8Array([p.pc & 127]) }); } }
    setCC(7, p.vol); setCC(11, p.exp);
    if (p.pc != null || p.vol != null || p.exp != null) leaf.data = writeSMF(smf.division, smf.tracks.map(tr => tr.map((e, i) => ({ ...e, prio: 0 }))));
    const xl = child(cl, 'ClipDescription.xml'); let x = leafText(xl);
    if (p.keyLow != null && /<KeyLow /.test(x)) x = x.replace(/<KeyLow value="\d+"\/>/, `<KeyLow value="${p.keyLow}"/>`);
    if (p.keyHigh != null && /<KeyHigh /.test(x)) x = x.replace(/<KeyHigh value="\d+"\/>/, `<KeyHigh value="${p.keyHigh}"/>`);
    if (p.origRoot) x = x.replace(/<CV1 root="[^"]*" chord="[^"]*"\/>/, `<CV1 root="${p.origRoot}" chord="${p.origChord || 'Maj'}"/>`);
    xl.data = enc8(x); return true;
  }
  function setStyleTempo(root, bpm) { const sd = child(root, 'StageDescription.xml'); if (!sd) return; const us = Math.round(60000000 / bpm); sd.data = enc8(leafText(sd).replace(/(<Tempo\b[^>]*\bvalue=")\d+(")/, `$1${us}$2`)); }

  // ---------- note editing ----------
  function clipNotes(midBytes) { // -> { division, setupEnd, end, notes:[{t,dur,key,vel,ch}], others:[events of music tracks], smf }
    const smf = parseSMF(midBytes); const setup = smf.tracks[0] || []; const setupEnd = setup.length ? setup[setup.length - 1].t : 0;
    const notes = [], others = []; let end = setupEnd; const open = new Map();
    for (let ti = 1; ti < smf.tracks.length; ti++) for (const e of smf.tracks[ti]) {
      if (e.kind === 'meta' && e.type === 0x2f) { end = Math.max(end, e.t); continue; }
      if (e.kind === 'ch') { const hi = e.status & 0xf0, ch = e.status & 15;
        if (hi === 0x90 && e.data[1] > 0) { const k = ch * 128 + e.data[0]; if (!open.has(k)) open.set(k, []); const n = { t: e.t - setupEnd, dur: 0, key: e.data[0], vel: e.data[1], ch }; open.get(k).push(n); notes.push(n); continue; }
        if (hi === 0x80 || hi === 0x90) { const k = ch * 128 + e.data[0]; const q = open.get(k); if (q && q.length) { const n = q.shift(); n.dur = Math.max(1, e.t - setupEnd - n.t); } continue; } }
      others.push({ ...e, t: e.t - setupEnd, track: ti });
    }
    for (const q of open.values()) for (const n of q) if (!n.dur) n.dur = Math.max(1, end - setupEnd - n.t);
    notes.sort((a, b) => a.t - b.t || a.key - b.key);
    return { division: smf.division, setupEnd, end: end - setupEnd, notes, others, smf };
  }
  function buildClipMidi(cn, notes, newEnd) {
    const end = (newEnd ?? cn.end) + cn.setupEnd; const tracks = [cn.smf.tracks[0].map(e => ({ ...e }))];
    const nt = Math.max(1, cn.smf.tracks.length - 1); for (let i = 1; i <= nt; i++) tracks.push([]);
    for (const e of cn.others) { const t = Math.min(end, e.t + cn.setupEnd); tracks[Math.min(e.track || 1, nt)].push({ ...e, t, prio: 1 }); }
    for (const n of notes) { if (n.t < 0 || n.t >= end - cn.setupEnd) continue; const on = n.t + cn.setupEnd, off = Math.min(end, on + Math.max(1, Math.round(n.dur))); const ch = n.ch & 15;
      tracks[1].push({ t: on, kind: 'ch', status: 0x90 | ch, data: new Uint8Array([n.key & 127, Math.max(1, Math.min(127, Math.round(n.vel)))]), prio: 2 });
      tracks[1].push({ t: off, kind: 'ch', status: 0x80 | ch, data: new Uint8Array([n.key & 127, 64]), prio: 0 }); }
    for (let i = 1; i <= nt; i++) tracks[i].push({ t: end, kind: 'meta', type: 0x2f, data: new Uint8Array(0) });
    tracks[0] = tracks[0].filter(e => !(e.kind === 'meta' && e.type === 0x2f)); tracks[0].push({ t: cn.setupEnd, kind: 'meta', type: 0x2f, data: new Uint8Array(0) });
    return writeSMF(cn.division, tracks);
  }
  function clipLeaf(root, elId, track) { const scn = sceneOf(root, elId); const clip = scn && child(scn, clipName(track)); return clip && child(clip, 'Main.mid'); }
  function setClipMidi(root, elId, track, bytes) { const l = clipLeaf(root, elId, track); if (!l) throw new Error('Няма такава писта'); l.data = bytes; }

  // ---------- export ----------
  const KORG_SYSEX = (e) => e.kind === 'sysex' && e.data[0] === 0x42;
  function exportStyleMidi(style, opts) {
    opts = Object.assign({ elements: null, channels: DEFAULT_CHANNELS, includeChords: false, keepKorgSysex: false, setupPerElement: true, markers: true }, opts || {});
    const els = style.elements.filter(e => !opts.elements || opts.elements.includes(e.id));
    const division = (els[0] && els[0].division) || 384;
    const cond = [textMeta(0, 0x03, style.name), { t: 0, kind: 'meta', type: 0x51, data: new Uint8Array([(style.tempoUs >> 16) & 255, (style.tempoUs >> 8) & 255, style.tempoUs & 255]) }];
    const trackEvents = {}; const names = TRACK_ORDER.filter(n => n !== 'Chords' || opts.includeChords);
    for (const n of names) trackEvents[n] = [textMeta(0, 0x03, n)];
    let T = 0, lastTs = null;
    for (const el of els) {
      if (!lastTs || lastTs.label !== el.ts.label) { cond.push({ t: T, kind: 'meta', type: 0x58, data: new Uint8Array([el.ts.num, el.ts.den, 24, 8]) }); lastTs = el.ts; }
      if (opts.markers) cond.push(textMeta(T, 0x06, el.label));
      for (const tr of el.tracks) {
        if (!trackEvents[tr.name]) continue;
        const ch = ((opts.channels[tr.name] || 1) - 1) & 15; const out = trackEvents[tr.name];
        const scale = division / tr.division;
        const remap = (e, t) => {
          if (e.kind === 'ch') { const d = new Uint8Array(e.data); out.push({ t, kind: 'ch', status: (e.status & 0xf0) | ch, data: d, prio: (e.status & 0xf0) === 0x80 || ((e.status & 0xf0) === 0x90 && e.data[1] === 0) ? -1 : 0 }); }
          else if (e.kind === 'sysex' && (opts.keepKorgSysex || !KORG_SYSEX(e))) out.push({ t, kind: 'sysex', status: e.status, data: e.data });
        };
        if (opts.setupPerElement || T === 0) for (const e of tr.info.setup) remap(e, T);
        const elEnd = Math.round(el.length * scale); const held = new Map();
        for (const e of tr.info.music) {
          const rel = Math.round((e.t - tr.info.setupEnd) * scale); if (rel < 0) continue;
          const isOff = e.kind === 'ch' && ((e.status & 0xf0) === 0x80 || ((e.status & 0xf0) === 0x90 && e.data[1] === 0));
          const isOn = e.kind === 'ch' && (e.status & 0xf0) === 0x90 && e.data[1] > 0;
          if (rel >= elEnd && !isOff) continue;
          if (isOff && !held.get(e.data[0])) continue; // orphan note-off
          if (isOn) held.set(e.data[0], (held.get(e.data[0]) || 0) + 1);
          if (isOff) held.set(e.data[0], held.get(e.data[0]) - 1);
          remap(e, T + Math.min(rel, elEnd));
        }
        for (const [k, n] of held) for (let i = 0; i < n; i++) out.push({ t: T + elEnd, kind: 'ch', status: 0x80 | ch, data: new Uint8Array([k, 0]), prio: -1 });
      }
      T += Math.round(el.length * division / el.division);
    }
    const tracks = [cond.concat([{ t: T, kind: 'meta', type: 0x2f, data: new Uint8Array(0) }])];
    for (const n of names) { const ev = trackEvents[n]; ev.push({ t: T, kind: 'meta', type: 0x2f, data: new Uint8Array(0) }); tracks.push(ev); }
    return writeSMF(division, tracks);
  }

  // ---------- tiny ZIP (store) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) { // [{name, data}]
    const enc = new TextEncoder(); const parts = []; const cd = []; let off = 0;
    const now = new Date(); const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1); const dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const le = (n, w) => { const a = []; for (let i = 0; i < w; i++) a.push((n >>> (8 * i)) & 255); return a; };
    for (const f of files) {
      const nm = enc.encode(f.name); const crc = crc32(f.data);
      const h = [0x50, 0x4b, 3, 4, ...le(20, 2), ...le(0x0800, 2), 0, 0, ...le(dosT, 2), ...le(dosD, 2), ...le(crc, 4), ...le(f.data.length, 4), ...le(f.data.length, 4), ...le(nm.length, 2), 0, 0];
      parts.push(new Uint8Array(h), nm, f.data);
      cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...le(20, 2), ...le(20, 2), ...le(0x0800, 2), 0, 0, ...le(dosT, 2), ...le(dosD, 2), ...le(crc, 4), ...le(f.data.length, 4), ...le(f.data.length, 4), ...le(nm.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(off, 4)]), nm);
      off += h.length + nm.length + f.data.length;
    }
    const cdSize = cd.reduce((s, x) => s + x.length, 0);
    const endRec = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...le(files.length, 2), ...le(files.length, 2), ...le(cdSize, 4), ...le(off, 4), 0, 0]);
    const all = [...parts, ...cd, endRec]; const total = all.reduce((s, x) => s + x.length, 0); const out = new Uint8Array(total); let p = 0; for (const x of all) { out.set(x, p); p += x.length; } return out;
  }

  const api = { gmProgram, getTrackProps, setTrackProps, setStyleTempo, clipNode, clipNotes, buildClipMidi, clipLeaf, setClipMidi, pcgBankFromFile, buildSoundIndex, setSoundIndex, setFactoryNames, soundInfo, soundLabel, soundTitle, copyElement, copyTrack, deleteTrack, renameStyle, cloneNode, compatibleTracks, SCENE_INFO, TRACK_GROUP, serializeTree, parseTree, parseSMF, writeSMF, parseStyle, parseKeyboardSetFile, korfNames, exportStyleMidi, makeZip, fmtSound, ELEMENT_LABEL, TRACK_ORDER, DEFAULT_CHANNELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PACore = api;
})(typeof window !== 'undefined' ? window : globalThis);
