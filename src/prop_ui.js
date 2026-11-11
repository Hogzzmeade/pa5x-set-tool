  // ===================== STYLE PROPERTIES (element / track editor) =====================
  const PR_GROUPS = [['INTRO', [['Intro1', 'Intro 1'], ['Intro2', 'Intro 2'], ['CountIn', 'Count In']]], ['VARIATION', [['Var1', 'Var 1'], ['Var2', 'Var 2'], ['Var3', 'Var 3'], ['Var4', 'Var 4']]], ['FILL', [['Fill1', 'Fill 1'], ['Fill2', 'Fill 2'], ['Fill3', 'Fill 3'], ['Fill4', 'Fill 4'], ['Break', 'Break']]], ['END', [['End1', 'End 1'], ['End2', 'End 2'], ['End3', 'End 3']]]];
  const CHORD_NAMES = { Maj: 'Major', Min: 'minor', Maj6: '6', Maj7: 'Maj7', Min6: 'min6', Min7: 'min7', Dom7: '7', Sus4: 'sus4', Sus2: 'sus2', Dim: 'dim', Aug: 'aug', Min7b5: 'm7b5', Dim7: 'dim7', Minmaj7: 'mMaj7' };
  const CHORD_TYPES = ['Maj', 'Min', 'Maj6', 'Maj7', 'Min6', 'Min7', 'Dom7', 'Sus4', 'Sus2', 'Dim', 'Aug', 'Min7b5', 'Dim7', 'Minmaj7'];
  const keyOpts = (sel) => Array.from({ length: 128 }, (_, k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${noteName(k)}</option>`).join('');
  function knob(value, cls) { const v = value ?? 0; return `<div class="knob ${cls || ''}" data-v="${v}" style="--p:${v / 127 * 100}%"><span>${value == null ? '—' : v}</span></div>`; }
  function soundSrc(s) { if (!s || s.pc == null) return ['—', '']; const i = C.soundInfo(s); const src = s.lsb >= 64 && (s.msb === 121 || s.msb === 120) ? (s.msb === 120 ? 'USDK' : 'User') : 'Factory'; return [i && i.name ? i.name : C.fmtSound(s), src]; }
  async function openStyleProps(z) {
    const x = z.x; const ed0 = state.edits.get(x); const origTree = ed0 ? C.cloneNode(ed0.tree) : await getTree(x);
    let work = C.cloneNode(origTree); let dirty = false; let elId = null; let applyAll = false; let ab = false;
    let s = C.parseStyle(C.serializeTree(work), x.name);
    elId = (s.elements.find(e => e.id === 'Var1' && e.length) || s.elements.find(e => e.length) || s.elements[0]).id;
    const m = document.createElement('div'); m.className = 'modal prmodal'; document.body.appendChild(m);
    const reparse = () => { s = C.parseStyle(C.serializeTree(work), x.name); };
    function render() {
      const el = s.elements.find(e => e.id === elId); const props = Object.fromEntries(SP_TRACKS.map(([t]) => [t, C.getTrackProps(work, elId, t)]));
      const anyP = Object.values(props).find(Boolean); const cvs = anyP ? anyP.cvs : [1];
      m.innerHTML = `<div class="prbox"><div class="prmain">
        <div class="prtabs">${PR_GROUPS.map(([g, list]) => `<div class="prgrp"><div class="prgl">${g}</div><div class="prgb">${list.map(([id, l]) => { const e = s.elements.find(q => q.id === id && q.length); return `<button data-el="${id}" class="${id === elId ? 'on' : ''}" ${e ? '' : 'disabled'}>${l}</button>`; }).join('')}</div></div>`).join('')}</div>
        <div class="prcv">${[1, 2, 3, 4, 5, 6].map(n => `<button class="${n === 1 ? 'on' : ''}" ${cvs.includes(n) ? '' : 'disabled'}>CV ${n}</button>`).join('')}<button class="prct" id="prCT">CHORD TABLE</button></div>
        <table class="prt"><tr><th>PLAY</th><th>VOL</th><th>SOUND</th><th>REMAP</th><th>EXP</th><th>LOW KEY</th><th>HIGH KEY</th><th>TYPE</th><th>KEY</th></tr>
        ${SP_TRACKS.map(([t, l]) => { const p = props[t]; if (!p) return `<tr class="off"><td></td><td></td><td><div class="prsnd off"><b>${l}</b><span>—</span></div></td><td colspan="6" class="hint">няма писта в този елемент</td></tr>`;
          const [nm, src] = soundSrc(p.sound); const drum = /drum/i.test(p.type); const o = p.orig[0];
          return `<tr data-t="${t}"><td><button class="spk${P.mutes.has(t) ? ' muted' : ''}" title="Заглуши / включи при прослушване">${P.mutes.has(t) ? '🔇' : '🔊'}</button></td><td>${knob(p.vol, 'kv')}</td>
            <td><div class="prsnd ${src === 'Factory' ? 'fac' : 'usr'}"><b>${l}</b><div class="pn"><span class="nm">${esc(nm)}</span><span class="sr">${src}</span><span class="nu">${p.sound.msb ?? '-'},${p.sound.lsb ?? '-'},${p.sound.pc ?? '-'}</span></div><button class="dots" title="Избери звук">···</button></div></td>
            <td><button class="remap" ${drum ? 'disabled' : ''}>ReMap</button></td><td>${knob(p.exp, 'ke')}</td>
            <td><select class="kl" ${p.hasKeyRange ? '' : 'disabled'}>${keyOpts(p.keyLow)}</select></td><td><select class="kh" ${p.hasKeyRange ? '' : 'disabled'}>${keyOpts(p.keyHigh)}</select></td>
            <td class="ty">${esc(p.type === 'Accompaniment' ? 'Acc' : p.type)}</td><td class="ky">${drum || !o ? '-' : esc(o.root + ' ' + (CHORD_NAMES[o.chord] || o.chord))}</td></tr>`; }).join('')}
        </table>
        <div class="prbot"><label class="tog"><input type="checkbox" id="prAB" ${ab ? 'checked' : ''}><span></span> Прослушай оригиналните звуци (A/B)</label><label class="tog"><input type="checkbox" id="prAll" ${applyAll ? 'checked' : ''}><span></span> Приложи тези звуци и във всички други елементи</label></div>
        </div><div class="prside"><button class="btn primary" id="prUpd" ${dirty ? '' : 'disabled'}>Update Style</button><button class="btn" id="prRep">Generate Report</button><button class="btn" id="prPlay">${P.playing ? '■ Stop' : '▶ Play'}</button><span class="sep"></span><button class="btn" id="prReset" ${dirty ? '' : 'disabled'}>Reset Style</button><button class="btn danger" id="prClose">Close</button></div>
        <div class="prfoot"><span>Style: <b>${esc(s.name)}</b></span><span>Tact: <b>${el.ts.label}</b></span><span>Length: <b>${el.bars}</b></span><span>Tempo: <input type="number" id="prTempo" min="30" max="300" value="${s.tempo}"></span><span class="r">Bank: ${esc(state.styles[z.bi].bank)} / Pos: ${z.i + 1}${dirty ? ' · <b class="mod">● промени</b>' : ''}</span></div></div>`;
      bind(props);
    }
    const change = (fn, live) => { fn(); dirty = true; reparse(); if (P.playing && !ab && !live) restartPreview(); render(); };
    function targets() { return applyAll ? s.elements.filter(e => e.length).map(e => e.id) : [elId]; }
    function restartPreview() { const src = ab ? origTree : work; const s2 = C.parseStyle(C.serializeTree(src), x.name); P.stop(); P.loadStyle(s2, opts.channels); curStyleItem = null; P.start(elId); }
    function bind(props) {
      m.querySelectorAll('.prgb button').forEach(b => b.onclick = () => { elId = b.dataset.el; if (P.playing) restartPreview(); render(); });
      m.querySelector('#prCT').onclick = () => { const p = Object.values(props).find(q => q && q.table.length); if (!p) return; const box = document.createElement('div'); box.className = 'modal'; box.innerHTML = `<div class="mbox"><h3>Chord Table</h3><div class="ctgrid">${p.table.map(([c, n]) => `<span>${esc(c)}</span><b>CV ${n}</b>`).join('')}</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn">Затвори</button></div></div>`; document.body.appendChild(box); box.querySelector('button').onclick = () => box.remove(); };
      m.querySelectorAll('tr[data-t]').forEach(r => { const t = r.dataset.t;
        r.querySelector('.spk').onclick = () => { P.mutes.has(t) ? P.mutes.delete(t) : P.mutes.add(t); render(); };
        bindKnob(r.querySelector('.kv'), (v) => { targets().forEach(e => C.setTrackProps(work, e, t, { vol: v })); dirty = true; if (P.playing) P.setTrackVolume(t, v); }, () => { reparse(); render(); });
        bindKnob(r.querySelector('.ke'), (v) => { targets().forEach(e => C.setTrackProps(work, e, t, { exp: v })); dirty = true; if (P.playing && P.channels) P.send([0xb0 | ((P.channels[t] || 1) - 1), 11, v], P.ctx.currentTime); }, () => { reparse(); render(); });
        r.querySelector('.kl').onchange = (e) => change(() => targets().forEach(id => C.setTrackProps(work, id, t, { keyLow: +e.target.value })), true);
        r.querySelector('.kh').onchange = (e) => change(() => targets().forEach(id => C.setTrackProps(work, id, t, { keyHigh: +e.target.value })), true);
        r.querySelector('.dots').onclick = () => pickSound(props[t].sound, /drum/i.test(props[t].type), (snd) => change(() => targets().forEach(id => C.setTrackProps(work, id, t, { msb: snd.msb, lsb: snd.lsb, pc: snd.pc }))));
        const rm = r.querySelector('.remap'); if (rm) rm.onclick = () => remapDlg(t, props[t]);
      });
      m.querySelector('#prAB').onchange = (e) => { ab = e.target.checked; if (P.playing) restartPreview(); };
      m.querySelector('#prAll').onchange = (e) => { applyAll = e.target.checked; };
      m.querySelector('#prTempo').onchange = (e) => change(() => C.setStyleTempo(work, Math.max(30, Math.min(300, +e.target.value || s.tempo))));
      m.querySelector('#prPlay').onclick = async () => { if (!(await ensurePlayer())) return; if (P.playing) P.stop(); else restartPreview(); render(); };
      m.querySelector('#prReset').onclick = () => { if (!confirm('Да се откажат ли всички промени в това меню?')) return; work = C.cloneNode(origTree); dirty = false; reparse(); if (P.playing) restartPreview(); render(); };
      m.querySelector('#prClose').onclick = () => { if (dirty && !confirm('Има неприложени промени. Да се затвори ли без тях? (натисни Update Style, за да ги запазиш)')) return; P.stop(); m.remove(); };
      m.querySelector('#prRep').onclick = () => styleReport(work, x);
      m.querySelector('#prUpd').onclick = () => {
        let ed = state.edits.get(x); const before = C.serializeTree(ed ? ed.tree : origTree);
        if (!ed) { ed = { tree: work, history: [], log: [] }; state.edits.set(x, ed); } else ed.tree = work;
        ed.history.push(before); ed.parsed = null; ed.log.push('Properties: звуци / сила / експресия / обхват / темпо');
        P.stop(); m.remove(); toast('Промените са приложени към стила. Запиши го от раздел „Сет“ (Запиши като нов / Презапиши).');
        if (state.mode === 'sp') renderStylePlay(); else refreshStyle(x, z.bi);
      };
    }
    function remapDlg(t, p) {
      const o = p.orig[0] || { root: 'C', chord: 'Maj' }; const b = document.createElement('div'); b.className = 'modal';
      b.innerHTML = `<div class="mbox"><h3>ReMap · ${t}</h3><p class="hint">Оригиналният акорд казва на аранжора в какъв акорд е записана пистата.</p>
        <div class="row"><label>Тоника <select id="rmR">${ROOTS.map(r => `<option ${r === o.root ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label>Вид <select id="rmC">${CHORD_TYPES.map(c => `<option value="${c}" ${c === o.chord ? 'selected' : ''}>${CHORD_NAMES[c] || c}</option>`).join('')}</select></label></div>
        <label class="opt" style="margin-top:10px"><input type="checkbox" id="rmT"> Транспонирай и нотите към новата тоника</label>
        <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="rmNo">Отказ</button><button class="btn primary" id="rmOk">Приложи</button></div></div>`;
      document.body.appendChild(b); b.querySelector('#rmNo').onclick = () => b.remove();
      b.querySelector('#rmOk').onclick = () => { const r = b.querySelector('#rmR').value, c = b.querySelector('#rmC').value, tr = b.querySelector('#rmT').checked; b.remove();
        change(() => targets().forEach(id => { if (tr) { let d = (ROOTS.indexOf(r) - rootIdx(o.root) + 12) % 12; if (d > 6) d -= 12; const leaf = C.clipLeaf(work, id, t); if (leaf && d) { const cn = C.clipNotes(leaf.data); cn.notes.forEach(n => n.key = Math.max(0, Math.min(127, n.key + d))); leaf.data = C.buildClipMidi(cn, cn.notes); } } C.setTrackProps(work, id, t, { origRoot: r, origChord: c }); })); };
    }
    render(); ensurePlayer();
  }
  function bindKnob(el, onChange, onEnd) {
    if (!el) return; let v = +el.dataset.v; const show = () => { el.style.setProperty('--p', v / 127 * 100 + '%'); el.querySelector('span').textContent = v; };
    el.onpointerdown = (e) => { el.setPointerCapture(e.pointerId); const y0 = e.clientY, v0 = v; el.onpointermove = (ev) => { const nv = Math.max(0, Math.min(127, Math.round(v0 + (y0 - ev.clientY) / 1.5))); if (nv !== v) { v = nv; show(); onChange(v); } }; el.onpointerup = () => { el.onpointermove = null; onEnd(); }; };
    el.onwheel = (e) => { e.preventDefault(); v = Math.max(0, Math.min(127, v + (e.deltaY < 0 ? 1 : -1))); show(); onChange(v); clearTimeout(el._t); el._t = setTimeout(onEnd, 400); };
    el.ondblclick = async () => { const r = await askText('Стойност (0–127)', String(v), ''); if (r == null) return; v = Math.max(0, Math.min(127, parseInt(r, 10) || 0)); show(); onChange(v); onEnd(); };
  }
  function pickSound(cur, drum, cb) {
    const fac = Object.entries(window.PAFactory || {}).map(([k, n]) => { const [a, b, c] = k.split('.').map(Number); return { msb: a, lsb: b, pc: c, name: n, src: 'Factory' }; });
    const usr = []; for (const bnk of state.userSounds) { const bk = C.pcgBankFromFile(bnk.file); if (bk) for (const e of bnk.entries) usr.push({ msb: bk.msb, lsb: bk.lsb, pc: e.slot, name: e.name, src: bk.bank }); }
    const all = [...usr, ...fac].filter(s => drum ? s.msb === 120 : s.msb !== 120 || !drum);
    const b = document.createElement('div'); b.className = 'modal';
    b.innerHTML = `<div class="mbox" style="width:620px"><h3>Избор на звук ${drum ? '(Drum Kit)' : ''}</h3><div class="row"><input id="psQ" placeholder="Търсене по име…" style="flex:1;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:7px"><select id="psS"><option value="">Всички</option><option value="u">User (от сета)</option><option value="f">Factory</option></select></div>
      <div class="pslist" id="psL"></div><div class="row" style="margin-top:8px;gap:6px"><span class="hint">или ръчно:</span>MSB <input id="psM" type="number" min="0" max="127" value="${cur.msb ?? 121}" style="width:60px">LSB <input id="psB" type="number" min="0" max="127" value="${cur.lsb ?? 0}" style="width:60px">PC <input id="psP" type="number" min="1" max="128" value="${(cur.pc ?? 0) + 1}" style="width:60px"><span class="sep" style="flex:1"></span><button class="btn" id="psNo">Отказ</button><button class="btn primary" id="psOk">Избери</button></div></div>`;
    document.body.appendChild(b);
    const list = () => { const q = b.querySelector('#psQ').value.toLowerCase(), f = b.querySelector('#psS').value; const r = all.filter(s => (!q || s.name.toLowerCase().includes(q)) && (!f || (f === 'u') === (s.src !== 'Factory'))).slice(0, 400);
      b.querySelector('#psL').innerHTML = r.map((s, i) => `<div class="psi" data-i="${all.indexOf(s)}"><span>${esc(s.name)}</span><span class="hint">${esc(s.src)} · ${s.msb},${s.lsb},${s.pc}</span></div>`).join('') || '<div class="hint" style="padding:10px">Няма резултати</div>';
      b.querySelectorAll('.psi').forEach(d => { d.onclick = () => { const s = all[+d.dataset.i]; b.querySelector('#psM').value = s.msb; b.querySelector('#psB').value = s.lsb; b.querySelector('#psP').value = s.pc + 1; b.querySelectorAll('.psi').forEach(z => z.classList.toggle('sel', z === d)); if (playerReady) P.audition(s, [], 15, drum ? 38 : 60, 100); }; d.ondblclick = () => b.querySelector('#psOk').click(); }); };
    b.querySelector('#psQ').oninput = list; b.querySelector('#psS').onchange = list; list(); b.querySelector('#psQ').focus();
    b.querySelector('#psNo').onclick = () => b.remove();
    b.querySelector('#psOk').onclick = () => { const snd = { msb: +b.querySelector('#psM').value & 127, lsb: +b.querySelector('#psB').value & 127, pc: (+b.querySelector('#psP').value - 1) & 127 }; b.remove(); cb(snd); };
  }
  function styleReport(tree, x) {
    const s = C.parseStyle(C.serializeTree(tree), x.name); const L = [`Style: ${s.name}`, `Файл: ${x.name}`, `Темпо: ${s.tempo} BPM`, ''];
    for (const el of s.elements.filter(e => e.length)) { L.push(`=== ${el.label} · ${el.bars} т. · ${el.ts.label} ===`);
      for (const [t, l] of SP_TRACKS) { const p = C.getTrackProps(tree, el.id, t); if (!p) continue; const [nm, src] = soundSrc(p.sound); const o = p.orig[0];
        L.push(`  ${l.padEnd(5)} ${nm} [${src} ${p.sound.msb},${p.sound.lsb},${p.sound.pc}] · VOL ${p.vol ?? '-'} · EXP ${p.exp ?? '-'} · ${p.hasKeyRange ? noteName(p.keyLow) + '–' + noteName(p.keyHigh) : '—'} · ${p.type}${o && !/drum/i.test(p.type) ? ' · ' + o.root + ' ' + (CHORD_NAMES[o.chord] || o.chord) : ''}`); } L.push(''); }
    download(`Style ${safe(s.name)}.txt`, new TextEncoder().encode('﻿' + L.join('\r\n')), 'text/plain');
  }
