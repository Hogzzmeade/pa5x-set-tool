  // ===================== STYLE PLAY =====================
  const SP = { bank: 0, page: 0, sel: null, q: '', per: 12, cur: null, curItem: null };
  const SP_TRACKS = [['Drum', 'DRUM'], ['Perc', 'PERC'], ['Bass', 'BASS'], ['Acc1', 'ACC1'], ['Acc2', 'ACC2'], ['Acc3', 'ACC3'], ['Acc4', 'ACC4'], ['Acc5', 'ACC5']];
  const SP_ELS = [['Intro1', 'INTRO 1'], ['Intro2', 'INTRO 2'], ['CountIn', 'INTRO 3'], ['Var1', 'VAR 1'], ['Var2', 'VAR 2'], ['Var3', 'VAR 3'], ['Var4', 'VAR 4'], ['Fill1', 'FILL 1'], ['Fill2', 'FILL 2'], ['Fill3', 'FILL 3'], ['Fill4', 'FILL 4'], ['Break', 'BREAK'], ['End1', 'END 1'], ['End2', 'END 2']];
  function spItems() {
    if (SP.q) { const q = SP.q.toLowerCase(); return state.styles.flatMap((b, bi) => b.items.map((x, i) => ({ x, bi, i }))).filter(z => z.x.name.toLowerCase().includes(q)); }
    const b = state.styles[SP.bank]; return b ? b.items.map((x, i) => ({ x, bi: SP.bank, i })) : [];
  }
  function renderStylePlay() {
    const root = $('#sp'); if (!root) return;
    if (!state.styles.length) { root.innerHTML = `<div class="empty"><div class="drop"><div class="big">Style Play</div><p>Отвори SET или KST папка (бутона горе вдясно), за да прослушаш стиловете.</p></div></div>`; return; }
    const items = spItems(); const pages = Math.max(1, Math.ceil(items.length / SP.per)); SP.page = Math.min(SP.page, pages - 1);
    const shown = items.slice(SP.page * SP.per, SP.page * SP.per + SP.per);
    const half = Math.ceil(state.styles.length / 2);
    const bankBtn = (b, bi) => `<button class="spbank${bi === SP.bank && !SP.q ? ' on' : ''}" data-b="${bi}" title="${esc(b.bank)}"><span>Bank ${bi + 1}</span><small>${esc(b.bank)}</small></button>`;
    root.innerHTML = `<div class="sphead"><span>STYLE SELECT: <b id="spSelName">${esc(SP.sel ? SP.sel.x.name.replace(/\.stg$/i, '') : '—')}</b></span><span class="spset">${esc(state.root)}</span><input id="spQ" placeholder="Търсене…" value="${esc(SP.q)}"></div>
      <div class="spbody"><div class="spbanks">${state.styles.slice(0, half).map((b, i) => bankBtn(b, i)).join('')}</div>
      <div class="spgrid">${shown.map(z => { const pos = z.i + 1; const mod = state.edits && state.edits.has(z.x); return `<div class="sptile${SP.sel && SP.sel.x === z.x ? ' sel' : ''}${SP.curItem === z.x && P.playing ? ' playing' : ''}" data-bi="${z.bi}" data-i="${z.i}"><div class="spn">${mod ? '● ' : ''}${esc(z.x.name.replace(/\.stg$/i, '').replace(/^\d+\s+/, ''))}</div><div class="spm"><span>${esc(SP.q ? state.styles[z.bi].bank : '')}</span><span>${pos}</span></div></div>`; }).join('') || '<div class="hint" style="padding:20px">Няма стилове</div>'}</div>
      <div class="spbanks">${state.styles.slice(half).map((b, i) => bankBtn(b, i + half)).join('')}</div></div>
      <div class="sppages"><span class="hint">${SP.q ? 'Резултати: ' + items.length : `Bank ${SP.bank + 1} · ${items.length} стила`}</span>${Array.from({ length: pages }, (_, p) => `<button class="sppg${p === SP.page ? ' on' : ''}" data-p="${p}">P${p + 1}</button>`).join('')}</div>
      <div class="sphint hint">Клик: избор · двоен клик или десен бутон → Play</div>`;
    root.querySelectorAll('.spbank').forEach(b => b.onclick = () => { SP.bank = +b.dataset.b; SP.page = 0; SP.q = ''; renderStylePlay(); });
    root.querySelectorAll('.sppg').forEach(b => b.onclick = () => { SP.page = +b.dataset.p; renderStylePlay(); });
    const q = $('#spQ'); q.oninput = () => { SP.q = q.value; SP.page = 0; renderStylePlay(); const n = $('#spQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    root.querySelectorAll('.sptile').forEach(t => {
      const z = { x: state.styles[+t.dataset.bi].items[+t.dataset.i], bi: +t.dataset.bi, i: +t.dataset.i };
      t.onclick = () => { SP.sel = z; root.querySelectorAll('.sptile').forEach(o => o.classList.toggle('sel', o === t)); $('#spSelName').textContent = z.x.name.replace(/\.stg$/i, ''); };
      t.ondblclick = () => spPlay(z);
      t.oncontextmenu = (e) => { e.preventDefault(); t.onclick(); spMenu(e.clientX, e.clientY, z); };
    });
  }
  function spMenu(x, y, z) {
    document.querySelectorAll('.ctxmenu').forEach(m => m.remove());
    const m = document.createElement('div'); m.className = 'ctxmenu';
    m.innerHTML = `<button data-a="play"><span class="ic">▶</span>Play</button><button data-a="stop"${P.playing ? '' : ' disabled'}><span class="ic">■</span>Stop</button><hr><button data-a="open"><span class="ic">✎</span>Отвори в Сет (редакция)</button><button data-a="props"><span class="ic">⚙</span>Properties</button>`;
    document.body.appendChild(m); const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    const close = () => { m.remove(); document.removeEventListener('pointerdown', out, true); }; const out = (e) => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', out, true));
    m.querySelectorAll('button').forEach(b => b.onclick = async () => { close(); const a = b.dataset.a;
      if (a === 'play') spPlay(z); else if (a === 'stop') P.stop();
      else if (a === 'open') { setMode('set'); state.tab = 'styles'; document.querySelectorAll('#tabs button').forEach(t => t.classList.toggle('on', t.dataset.tab === 'styles')); state.sel = z.x; renderList(); showStyle(z.x, z.bi); }
      else if (a === 'props') spProps(z); });
  }
  async function spProps(z) {
    let s; try { s = await getStyle(z.x); } catch (e) { return toast('Не може да се прочете: ' + e.message); }
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="mbox" style="width:520px"><h3>${esc(s.name)}</h3><table>
      <tr><td class="hint">Банка</td><td>${esc(state.styles[z.bi].bank)} · позиция ${z.i + 1}</td></tr><tr><td class="hint">Файл</td><td>${esc(z.x.name)}</td></tr>
      <tr><td class="hint">Темпо</td><td>${s.tempo} BPM</td></tr><tr><td class="hint">Такт</td><td>${[...new Set(s.elements.map(e => e.ts.label))].join(', ')}</td></tr>
      <tr><td class="hint">Елементи</td><td>${s.elements.filter(e => e.length).map(e => `${esc(e.label)} (${e.bars})`).join(', ')}</td></tr>
      <tr><td class="hint">Keyboard Sets</td><td>${s.keyboardSets.map(k => esc(k.name || '—')).join(', ') || '—'}</td></tr>
      <tr><td class="hint">Pads</td><td>${s.pads.map(p => esc(p.name)).join(', ') || '—'}</td></tr>
      ${SP_TRACKS.map(([t, l]) => { const el = s.elements.find(e => e.tracks.some(x => x.name === t)); const tr = el && el.tracks.find(x => x.name === t); return tr ? `<tr><td class="hint">${l}</td><td>${esc(C.soundLabel(tr.sound))}</td></tr>` : ''; }).join('')}
      </table><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="ppPlay">▶ Play</button><button class="btn" id="ppClose">Затвори</button></div></div>`;
    document.body.appendChild(m); m.querySelector('#ppClose').onclick = () => m.remove(); m.querySelector('#ppPlay').onclick = () => { m.remove(); spPlay(z); };
  }
  // ---- MINI Player ----
  async function spPlay(z) {
    if (!(await ensurePlayer())) return;
    let s; try { s = await getStyle(z.x); } catch (e) { return toast('Не може да се прочете: ' + e.message); }
    P.stop(); P.mutes.clear(); P.solos.clear(); P.trackVol = {}; SP.cur = s; SP.curItem = z.x; SP.sel = z;
    await loadIntoPlayer(z.x, s); const start = s.elements.find(e => e.id === 'Var1' && e.length) ? 'Var1' : (s.elements.find(e => /^Var/.test(e.id) && e.length) || s.elements.find(e => e.length) || {}).id;
    const first = s.elements.find(e => e.id === start);
    for (const [t] of SP_TRACKS) { const v = P.trackSetupVolume(first, t); if (v != null) P.trackVol[t] = v; }
    spMini(s); P.start(start); renderStylePlay();
  }
  function spMini(s) {
    let m = $('#spMini'); if (!m) { m = document.createElement('div'); m.id = 'spMini'; m.className = 'spmini'; document.body.appendChild(m); }
    const has = (t) => s.elements.some(e => e.tracks.some(x => x.name === t && x.info.notes));
    const mv = Math.round((P.volume ?? 1) / 1.5 * 127);
    m.innerHTML = `<div class="mphead" id="mpDrag"><button class="mploop${P.loop ? ' on' : ''}" id="mpLoop">Loop</button><span class="mptitle">MINI Player - ${esc(s.name)} | <b id="mpEl">—</b></span><button class="mpx" id="mpClose">✕</button></div>
      <div class="mptrans"><button class="mpplay" id="mpPlay">■ Stop</button><div class="mppos"><div class="mpbar" id="mpBar"></div><span id="mpPos">001.01.000</span></div></div>
      <div class="mpels">${SP_ELS.map(([id, l]) => { const e = s.elements.find(z => z.id === id && z.length); return `<button class="mpel ${/^Var/.test(id) ? 'v' : /^Fill|^Break/.test(id) ? 'f' : 'i'}" data-el="${id}" ${e ? '' : 'disabled'}>${l}</button>`; }).join('')}</div>
      <div class="mpmix">
        <div class="mpch master"><div class="mpval" id="mvVal">${mv}</div><input type="range" class="fader" orient="vertical" min="0" max="127" value="${mv}" id="mvF"><div class="mpname">MASTER<br>VOLUME</div></div>
        ${SP_TRACKS.map(([t, l]) => { const on = has(t); const v = P.trackVol[t] ?? 0; return `<div class="mpch${on ? '' : ' off'}" data-t="${t}"><div class="mpval">${on ? v : 0}</div><input type="range" class="fader" orient="vertical" min="0" max="127" value="${on ? v : 0}" ${on ? '' : 'disabled'}><div class="mpname">${l}</div><div class="mpled"></div><div class="mpms"><button class="ms m${P.mutes.has(t) ? ' on' : ''}" ${on ? '' : 'disabled'}>M</button><button class="ms s${P.solos.has(t) ? ' on' : ''}" ${on ? '' : 'disabled'}>S</button></div></div>`; }).join('')}
      </div>
      <div class="mpfoot"><span>Tact: <b id="mpTs">—</b></span><span>L: <b id="mpL">—</b></span><span>Key: <select id="mpKey">${ROOTS.map((r, i) => `<option value="${i}">${r}${/m$/.test(origChordLabel) ? 'm' : ''}</option>`).join('')}</select></span><span>Tempo: <input type="number" id="mpTempo" min="30" max="300" value="${Math.round(P.tempo)}"></span></div>`;
    $('#mpClose').onclick = () => { P.stop(); m.remove(); renderStylePlay(); };
    $('#mpLoop').onclick = (e) => { P.loop = !P.loop; e.target.classList.toggle('on', P.loop); };
    $('#mpPlay').onclick = () => { if (P.playing) P.stop(); else P.start(P.lastVar || 'Var1'); spTick(); };
    m.querySelectorAll('.mpel').forEach(b => b.onclick = () => { const id = b.dataset.el; if (P.playing) P.queue(id); else P.start(id); });
    const mvF = $('#mvF'); mvF.oninput = () => { P.setVolume(mvF.value / 127 * 1.5); $('#mvVal').textContent = mvF.value; const tv = $('#tpVol'); if (tv) tv.value = P.volume; };
    m.querySelectorAll('.mpch[data-t]').forEach(c => { const t = c.dataset.t; const f = c.querySelector('.fader');
      f.oninput = () => { P.setTrackVolume(t, +f.value); c.querySelector('.mpval').textContent = f.value; };
      c.querySelector('.ms.m').onclick = (e) => { P.mutes.has(t) ? P.mutes.delete(t) : P.mutes.add(t); e.target.classList.toggle('on', P.mutes.has(t)); };
      c.querySelector('.ms.s').onclick = (e) => { P.solos.has(t) ? P.solos.delete(t) : P.solos.add(t); e.target.classList.toggle('on', P.solos.has(t)); }; });
    $('#mpKey').value = (origRoot + P.transpose + 12) % 12; $('#mpKey').onchange = (e) => { let d = (+e.target.value - origRoot + 12) % 12; if (d > 6) d -= 12; P.transpose = d; };
    const tin = $('#mpTempo'); tin.onchange = () => { P.setTempo(Math.max(30, Math.min(300, +tin.value || s.tempo))); }; tin.onkeydown = (e) => { if (e.key === 'Enter') tin.blur(); };
    // drag window
    const hd = $('#mpDrag'); hd.onpointerdown = (e) => { if (e.target.closest('button')) return; const r = m.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top; hd.setPointerCapture(e.pointerId);
      hd.onpointermove = (ev) => { m.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - ox)) + 'px'; m.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px'; m.style.right = 'auto'; m.style.bottom = 'auto'; };
      hd.onpointerup = () => { hd.onpointermove = null; }; };
    spTick();
  }
  function spTick() {
    const m = $('#spMini'); if (!m || !SP.cur) return; const pos = P.playing ? P.position() : null;
    const el = pos ? SP.cur.elements.find(e => e.id === pos.id) : null;
    $('#mpEl').textContent = pos ? (C.ELEMENT_LABEL[pos.id] || pos.id).replace('Variation', 'VAR') : 'STOP';
    $('#mpPlay').textContent = P.playing ? '■ Stop' : '▶ Play'; $('#mpPlay').classList.toggle('on', P.playing);
    $('#mpPos').textContent = pos ? `${String(pos.bar).padStart(3, '0')}.${String(pos.beat).padStart(2, '0')}.${String(pos.tick).padStart(3, '0')}` : '000.00.000';
    $('#mpBar').style.width = pos && el ? Math.min(100, ((pos.bar - 1) + (pos.beat - 1) / el.ts.num) / Math.max(1, pos.bars) * 100) + '%' : '0%';
    if (el) { $('#mpTs').textContent = el.ts.label; $('#mpL').textContent = `${pos.bar}/${pos.bars}`; }
    if (document.activeElement !== $('#mpTempo')) $('#mpTempo').value = Math.round(P.tempo);
    m.querySelectorAll('.mpel').forEach(b => { b.classList.toggle('cur', !!pos && b.dataset.el === pos.id); b.classList.toggle('next', !!pos && (b.dataset.el === pos.pending || (!pos.pending && b.dataset.el === P.lastVar && b.dataset.el !== pos.id))); });
    const now = P.ctx ? P.ctx.currentTime : 0;
    m.querySelectorAll('.mpch[data-t]').forEach(c => { const a = P.activity[c.dataset.t]; c.querySelector('.mpled').classList.toggle('on', P.playing && a != null && now - a < 0.12 && now >= a - 0.02); });
  }
  setInterval(() => { if ($('#spMini')) spTick(); }, 60);
