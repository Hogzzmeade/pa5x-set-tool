  // ===================== NOTE EDITOR (piano roll) =====================
  const GM_DRUMS = { 35: 'Ac. Bass Drum', 36: 'Bass Drum', 37: 'Side Stick', 38: 'Snare', 39: 'Hand Clap', 40: 'El. Snare', 41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat', 47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash 1', 50: 'High Tom', 51: 'Ride 1', 52: 'Chinese Cym.', 53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale', 67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block', 78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle' };
  const BLACK = [1, 3, 6, 8, 10];
  async function openNoteEditor(x, bi, elId, track) {
    const ed0 = state.edits.get(x); const tree = ed0 ? ed0.tree : await getTree(x); const leaf = C.clipLeaf(tree, elId, track);
    if (!leaf) return toast('Тази писта няма клип в този елемент');
    const s = await getStyle(x); const el = s.elements.find(e => e.id === elId); const tr = el.tracks.find(t => t.name === track);
    const cn = C.clipNotes(leaf.data); const div = cn.division; const ts = el.ts; const beat = div * 4 / (2 ** ts.den); const bar = beat * ts.num;
    const isDrum = (tr.sound && tr.sound.msb === 120) || track === 'Drum' || track === 'Perc';
    const ch0 = cn.notes[0] ? cn.notes[0].ch : 0;
    let notes = cn.notes.map((n, i) => ({ ...n, id: i })); let nid = notes.length; const undo = [], redo = []; let sel = new Set(); let clip = [];
    const E = { pxPerTick: 0.06, rowH: 13, snap: div / 4, mode: 'select', lo: 0, hi: 127, playhead: 0 };
    const keysUsed = notes.map(n => n.key); const kmin = keysUsed.length ? Math.min(...keysUsed) : 48, kmax = keysUsed.length ? Math.max(...keysUsed) : 72;
    E.lo = Math.max(0, Math.min(kmin - 6, isDrum ? 35 : 36)); E.hi = Math.min(127, Math.max(kmax + 6, isDrum ? 81 : 84));
    const snapshot = () => JSON.stringify(notes); const pushUndo = () => { undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo.length = 0; };
    const restore = (j) => { notes = JSON.parse(j); nid = notes.reduce((m, n) => Math.max(m, n.id + 1), 0); sel = new Set([...sel].filter(id => notes.some(n => n.id === id))); draw(); };
    const nn = (k) => isDrum && GM_DRUMS[k] ? `${k} ${GM_DRUMS[k]}` : ROOTS[k % 12] + (Math.floor(k / 12) - 1);
    const m = document.createElement('div'); m.className = 'nemodal';
    m.innerHTML = `<div class="nebox">
      <div class="nebar"><b>${esc(C.ELEMENT_LABEL[elId] || elId)} · ${esc(track)}</b><span class="hint">${esc(s.name)} · ${esc(C.soundLabel(tr.sound))} · ${el.bars} т. · ${ts.label}</span><span class="sep"></span>
        <div class="seg"><button data-mode="select" class="on" title="Избор / местене (S)">↖ Избор</button><button data-mode="pencil" title="Молив: клик добавя нота (P)">✎ Молив</button></div>
        <label>Мрежа<select id="neSnap"><option value="1">1/4</option><option value="2">1/8</option><option value="4" selected>1/16</option><option value="8">1/32</option><option value="3">1/8 трип.</option><option value="6">1/16 трип.</option><option value="0">без</option></select></label>
        <button class="btn" id="neQ" title="Квантизирай избраните (Q)">Квантизирай</button>
        <button class="btn" id="neTd" title="−1 полутон (↓)">−1</button><button class="btn" id="neTu" title="+1 полутон (↑)">+1</button><button class="btn" id="neOd" title="−октава">−12</button><button class="btn" id="neOu" title="+октава">+12</button>
        <label>Сила<input type="number" id="neVel" min="1" max="127" style="width:56px"></label>
        <button class="btn" id="neZo">−</button><button class="btn" id="neZi">+</button>
        <button class="btn" id="neUndo" title="Ctrl+Z">↶</button><button class="btn" id="neRedo" title="Ctrl+Y">↷</button>
        <button class="btn" id="nePlay">▶ Прослушай</button>
        <button class="btn primary" id="neOk">Приложи</button><button class="btn" id="neCancel">Затвори</button></div>
      <div class="nemain"><div class="nekeys" id="neKeys"></div><div class="nescroll" id="neScroll"><canvas id="neC"></canvas></div></div>
      <div class="nevel"><div class="nekeys velh">Сила</div><div class="nescroll" id="neVScroll"><canvas id="neV"></canvas></div></div>
      <div class="nestat" id="neStat"></div></div>`;
    document.body.appendChild(m);
    const cv = m.querySelector('#neC'), vc = m.querySelector('#neV'), sc = m.querySelector('#neScroll'), vs = m.querySelector('#neVScroll'), kc = m.querySelector('#neKeys');
    const rows = () => E.hi - E.lo + 1; const yOf = (k) => (E.hi - k) * E.rowH; const kOf = (y) => E.hi - Math.floor(y / E.rowH);
    const W = () => Math.max(400, Math.ceil(cn.end * E.pxPerTick) + 40); const snapT = (t) => E.snap ? Math.round(t / E.snap) * E.snap : Math.round(t);
    function sizeAll() { const dpr = devicePixelRatio || 1; cv.width = W() * dpr; cv.height = rows() * E.rowH * dpr; cv.style.width = W() + 'px'; cv.style.height = rows() * E.rowH + 'px'; vc.width = W() * dpr; vc.height = 90 * dpr; vc.style.width = W() + 'px'; vc.style.height = '90px';
      kc.innerHTML = Array.from({ length: rows() }, (_, i) => { const k = E.hi - i; return `<div class="nek${BLACK.includes(k % 12) ? ' b' : ''}${k % 12 === 0 ? ' c' : ''}" data-k="${k}" style="height:${E.rowH}px">${(k % 12 === 0 || isDrum) ? esc(nn(k)) : ''}</div>`; }).join(''); }
    function draw() {
      const dpr = devicePixelRatio || 1; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); const w = W(), h = rows() * E.rowH;
      g.fillStyle = '#16191e'; g.fillRect(0, 0, w, h);
      for (let k = E.lo; k <= E.hi; k++) { if (BLACK.includes(k % 12)) { g.fillStyle = '#12151a'; g.fillRect(0, yOf(k), w, E.rowH); } if (k % 12 === 0) { g.fillStyle = '#2a2f38'; g.fillRect(0, yOf(k) + E.rowH - 1, w, 1); } }
      const step = E.snap || div / 4; for (let t = 0; t <= cn.end; t += step) { const x = t * E.pxPerTick; g.fillStyle = t % bar === 0 ? '#4a5260' : t % beat === 0 ? '#2f353f' : '#21252c'; g.fillRect(Math.round(x), 0, 1, h); if (t % bar === 0) { g.fillStyle = '#7c8594'; g.font = '10px Segoe UI'; g.fillText(String(t / bar + 1), x + 3, 10); } }
      g.fillStyle = 'rgba(240,160,60,.08)'; g.fillRect(cn.end * E.pxPerTick, 0, w, h);
      for (const n of notes) { const x = n.t * E.pxPerTick, y = yOf(n.key), ww = Math.max(3, n.dur * E.pxPerTick); const on = sel.has(n.id); const a = 0.45 + 0.55 * n.vel / 127;
        g.fillStyle = on ? `rgba(240,160,60,${a})` : `rgba(92,194,138,${a})`; g.fillRect(x, y + 1, ww, E.rowH - 2); g.strokeStyle = on ? '#ffd9a3' : '#2c6b48'; g.strokeRect(x + .5, y + 1.5, ww - 1, E.rowH - 3); }
      g.fillStyle = '#4fb3d9'; g.fillRect(E.playhead * E.pxPerTick, 0, 1, h);
      const v = vc.getContext('2d'); v.setTransform(dpr, 0, 0, dpr, 0, 0); v.fillStyle = '#121418'; v.fillRect(0, 0, w, 90);
      for (const n of notes) { const x = n.t * E.pxPerTick; const hh = n.vel / 127 * 84; v.fillStyle = sel.has(n.id) ? '#f0a03c' : '#5cc28a'; v.fillRect(x, 90 - hh, 3, hh); v.beginPath(); v.arc(x + 1.5, 90 - hh, 2.5, 0, 7); v.fill(); }
      const sn = notes.filter(n => sel.has(n.id)); const vi = m.querySelector('#neVel'); if (document.activeElement !== vi) vi.value = sn.length ? Math.round(sn.reduce((a, n) => a + n.vel, 0) / sn.length) : '';
      m.querySelector('#neStat').textContent = `${notes.length} ноти · избрани ${sn.length}${sn.length === 1 ? ` · ${nn(sn[0].key)} · такт ${Math.floor(sn[0].t / bar) + 1}.${Math.floor((sn[0].t % bar) / beat) + 1} · дължина ${sn[0].dur} · сила ${sn[0].vel}` : ''} · двоен клик: добави/изтрий · Del: изтрий · Ctrl+C/V: копирай/постави · Shift: добавяне към избора`;
    }
    const at = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const hit = (p) => { for (let i = notes.length - 1; i >= 0; i--) { const n = notes[i]; const x = n.t * E.pxPerTick, ww = Math.max(3, n.dur * E.pxPerTick); if (p.x >= x && p.x <= x + ww && kOf(p.y) === n.key) return { n, edge: p.x > x + ww - 6 }; } return null; };
    const audition = (k, vel) => { if (!playerReady) return; P.audition(tr.sound, tr.info.setup, isDrum ? 9 : 15, k, vel || 100); };
    let drag = null;
    cv.addEventListener('pointerdown', (ev) => {
      const p = at(ev); const h = hit(p); cv.setPointerCapture(ev.pointerId); E.playhead = Math.max(0, snapT(p.x / E.pxPerTick));
      if (h) { if (!sel.has(h.n.id)) { if (!ev.shiftKey) sel.clear(); sel.add(h.n.id); } else if (ev.shiftKey) { sel.delete(h.n.id); draw(); return; }
        pushUndo(); drag = { kind: h.edge ? 'resize' : 'move', x0: p.x, k0: kOf(p.y), orig: notes.filter(n => sel.has(n.id)).map(n => ({ id: n.id, t: n.t, key: n.key, dur: n.dur })), moved: false }; audition(h.n.key, h.n.vel); }
      else if (E.mode === 'pencil') { pushUndo(); const n = { id: nid++, t: Math.max(0, snapT(p.x / E.pxPerTick - (E.snap || 0) / 2)), dur: E.snap || div / 4, key: kOf(p.y), vel: 100, ch: ch0 }; if (n.t < cn.end) { notes.push(n); sel = new Set([n.id]); audition(n.key, 100); drag = { kind: 'resize', x0: p.x, orig: [{ id: n.id, t: n.t, key: n.key, dur: n.dur }], moved: false }; } }
      else { if (!ev.shiftKey) sel.clear(); drag = { kind: 'box', x0: p.x, y0: p.y, base: new Set(sel) }; }
      draw();
    });
    cv.addEventListener('pointermove', (ev) => {
      const p = at(ev); if (!drag) { const h = hit(p); cv.style.cursor = h ? (h.edge ? 'ew-resize' : 'move') : (E.mode === 'pencil' ? 'crosshair' : 'default'); return; }
      const dt = (p.x - drag.x0) / E.pxPerTick;
      if (drag.kind === 'move') { const dk = kOf(p.y) - drag.k0; const q = E.snap ? Math.round(dt / E.snap) * E.snap : Math.round(dt);
        for (const o of drag.orig) { const n = notes.find(z => z.id === o.id); n.t = Math.max(0, Math.min(cn.end - 1, o.t + q)); n.key = Math.max(0, Math.min(127, o.key + dk)); }
        if (dk !== drag.lastDk && drag.orig.length) { drag.lastDk = dk; audition(drag.orig[0].key + dk, 100); } }
      else if (drag.kind === 'resize') for (const o of drag.orig) { const n = notes.find(z => z.id === o.id); const q = E.snap ? Math.round((o.t + o.dur + dt) / E.snap) * E.snap - o.t : o.dur + dt; n.dur = Math.max(E.snap ? E.snap / 2 : 10, Math.round(q)); }
      else if (drag.kind === 'box') { const x1 = Math.min(drag.x0, p.x), x2 = Math.max(drag.x0, p.x), k1 = kOf(Math.max(drag.y0, p.y)), k2 = kOf(Math.min(drag.y0, p.y)); sel = new Set(drag.base);
        for (const n of notes) { const x = n.t * E.pxPerTick, xe = x + n.dur * E.pxPerTick; if (xe >= x1 && x <= x2 && n.key >= k1 && n.key <= k2) sel.add(n.id); }
        draw(); const g = cv.getContext('2d'); g.strokeStyle = '#f0a03c'; g.setLineDash([4, 3]); g.strokeRect(x1, Math.min(drag.y0, p.y), x2 - x1, Math.abs(p.y - drag.y0)); g.setLineDash([]); return; }
      drag.moved = true; draw();
    });
    cv.addEventListener('pointerup', () => { if (drag && (drag.kind === 'move' || drag.kind === 'resize') && !drag.moved && E.mode !== 'pencil') undo.pop(); drag = null; draw(); });
    cv.addEventListener('dblclick', (ev) => { const p = at(ev); const h = hit(p); pushUndo();
      if (h) { notes = notes.filter(n => n.id !== h.n.id); sel.delete(h.n.id); }
      else { const n = { id: nid++, t: Math.max(0, E.snap ? Math.floor(p.x / E.pxPerTick / E.snap) * E.snap : Math.round(p.x / E.pxPerTick)), dur: E.snap || div / 4, key: kOf(p.y), vel: 100, ch: ch0 }; if (n.t < cn.end) { notes.push(n); sel = new Set([n.id]); audition(n.key, 100); } }
      draw(); });
    // velocity lane
    let vdrag = false; const setVel = (ev) => { const r = vc.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top; const v = Math.max(1, Math.min(127, Math.round((90 - y) / 84 * 127)));
      const tgt = sel.size ? notes.filter(n => sel.has(n.id) && Math.abs(n.t * E.pxPerTick - x) < 6) : []; const near = notes.filter(n => Math.abs(n.t * E.pxPerTick - x) < 4);
      for (const n of (tgt.length ? notes.filter(z => sel.has(z.id)) : near)) n.vel = v; draw(); };
    vc.addEventListener('pointerdown', (ev) => { pushUndo(); vdrag = true; vc.setPointerCapture(ev.pointerId); setVel(ev); }); vc.addEventListener('pointermove', (ev) => { if (vdrag) setVel(ev); }); vc.addEventListener('pointerup', () => { vdrag = false; });
    kc.addEventListener('pointerdown', (ev) => { const k = +ev.target.closest('[data-k]')?.dataset.k; if (!isNaN(k)) audition(k, 100); });
    sc.addEventListener('scroll', () => { vs.scrollLeft = sc.scrollLeft; kc.scrollTop = sc.scrollTop; }); vs.addEventListener('scroll', () => { sc.scrollLeft = vs.scrollLeft; });
    // toolbar
    m.querySelectorAll('.seg button').forEach(b => b.onclick = () => { E.mode = b.dataset.mode; m.querySelectorAll('.seg button').forEach(z => z.classList.toggle('on', z === b)); });
    const snapSel = m.querySelector('#neSnap'); snapSel.onchange = () => { const v = +snapSel.value; E.snap = v === 0 ? 0 : v === 3 ? div / 3 : v === 6 ? div / 6 : div / v; draw(); };
    const xf = (fn) => { const sn = notes.filter(n => sel.has(n.id)); if (!sn.length) return toast('Първо избери ноти (клик, Shift+клик или рамка)'); pushUndo(); sn.forEach(fn); draw(); };
    m.querySelector('#neQ').onclick = () => xf(n => { const q = E.snap || div / 4; n.t = Math.min(cn.end - 1, Math.round(n.t / q) * q); });
    m.querySelector('#neTd').onclick = () => xf(n => n.key = Math.max(0, n.key - 1)); m.querySelector('#neTu').onclick = () => xf(n => n.key = Math.min(127, n.key + 1));
    m.querySelector('#neOd').onclick = () => xf(n => n.key = Math.max(0, n.key - 12)); m.querySelector('#neOu').onclick = () => xf(n => n.key = Math.min(127, n.key + 12));
    m.querySelector('#neVel').onchange = (e) => { const v = Math.max(1, Math.min(127, +e.target.value || 100)); xf(n => n.vel = v); };
    m.querySelector('#neZi').onclick = () => { E.pxPerTick *= 1.4; sizeAll(); draw(); }; m.querySelector('#neZo').onclick = () => { E.pxPerTick = Math.max(0.01, E.pxPerTick / 1.4); sizeAll(); draw(); };
    m.querySelector('#neUndo').onclick = () => { if (undo.length) { redo.push(snapshot()); restore(undo.pop()); } };
    m.querySelector('#neRedo').onclick = () => { if (redo.length) { undo.push(snapshot()); restore(redo.pop()); } };
    const bytesNow = () => C.buildClipMidi(cn, notes);
    m.querySelector('#nePlay').onclick = async () => { if (!(await ensurePlayer())) return; if (P.playing) { P.stop(); m.querySelector('#nePlay').textContent = '▶ Прослушай'; return; }
      const t2 = C.cloneNode(tree); C.setClipMidi(t2, elId, track, bytesNow()); const s2 = C.parseStyle(C.serializeTree(t2), x.name); P.loadStyle(s2, opts.channels); curStyleItem = null; P.start(elId); m.querySelector('#nePlay').textContent = '■ Спри'; };
    const close = () => { P.stop(); document.removeEventListener('keydown', onKey, true); m.remove(); };
    m.querySelector('#neCancel').onclick = () => { if (undo.length && !confirm('Има неприложени промени в нотите. Да се затвори ли без тях?')) return; close(); };
    m.querySelector('#neOk').onclick = () => {
      if (!undo.length) { close(); return; }
      let ed = state.edits.get(x); const before = C.serializeTree(tree);
      C.setClipMidi(tree, elId, track, bytesNow()); C.parseStyle(C.serializeTree(tree), x.name);
      if (!ed) { ed = { tree, history: [], log: [] }; state.edits.set(x, ed); }
      ed.history.push(before); ed.parsed = null; ed.log.push(`Редакция на нотите: ${C.ELEMENT_LABEL[elId] || elId} / ${track} (${notes.length} ноти)`);
      close(); toast('Промените в нотите са приложени. Запиши стила, когато си готов.'); refreshStyle(x, bi);
    };
    function onKey(e) {
      if (e.target.matches('input,select')) return; const k = e.key.toLowerCase(); let used = true;
      if ((e.ctrlKey || e.metaKey) && k === 'z') m.querySelector('#neUndo').click();
      else if ((e.ctrlKey || e.metaKey) && k === 'y') m.querySelector('#neRedo').click();
      else if ((e.ctrlKey || e.metaKey) && k === 'a') { sel = new Set(notes.map(n => n.id)); draw(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'c') { const sn = notes.filter(n => sel.has(n.id)); const t0 = Math.min(...sn.map(n => n.t)); clip = sn.map(n => ({ ...n, t: n.t - t0 })); toast(`Копирани ${clip.length} ноти`); }
      else if ((e.ctrlKey || e.metaKey) && k === 'v') { if (!clip.length) return; pushUndo(); const add = clip.map(n => ({ ...n, id: nid++, t: E.playhead + n.t })).filter(n => n.t < cn.end); notes.push(...add); sel = new Set(add.map(n => n.id)); draw(); }
      else if (k === 'delete' || k === 'backspace') { if (!sel.size) return; pushUndo(); notes = notes.filter(n => !sel.has(n.id)); sel.clear(); draw(); }
      else if (k === 'arrowup' || k === 'arrowdown') { const d = (k === 'arrowup' ? 1 : -1) * (e.shiftKey ? 12 : 1); xf(n => n.key = Math.max(0, Math.min(127, n.key + d))); }
      else if (k === 'arrowleft' || k === 'arrowright') { const d = (k === 'arrowright' ? 1 : -1) * (E.snap || div / 4); xf(n => n.t = Math.max(0, Math.min(cn.end - 1, n.t + d))); }
      else if (k === 'q') m.querySelector('#neQ').click();
      else if (k === 'p') m.querySelector('[data-mode=pencil]').click(); else if (k === 's' && !e.ctrlKey) m.querySelector('[data-mode=select]').click();
      else if (k === 'escape') m.querySelector('#neCancel').click();
      else if (k === ' ') m.querySelector('#nePlay').click();
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    }
    document.addEventListener('keydown', onKey, true);
    E.pxPerTick = Math.max(0.02, Math.min(0.6, ((sc.clientWidth || 900) - 50) / Math.max(1, cn.end)));
    sizeAll(); draw();
    const first = notes.length ? Math.min(...notes.map(n => n.key)) : 60; requestAnimationFrame(() => { sc.scrollTop = Math.max(0, yOf(Math.max(...notes.map(n => n.key), first + 12)) - 40); });
    ensurePlayer();
  }
