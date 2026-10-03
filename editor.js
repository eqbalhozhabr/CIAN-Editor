/* editor.js : the layout editor page.
   One case per page load (a case's script defines globals: CASE, ROOMS ...). The page keeps a layout document for that case, shows the room the
   engine draws from it, and every edit is an operation on the document (NUT_LAYOUT.editor) followed by applying it again. Rules about what may
   change (locked objects only move and turn) live in the engine, not here. */
(function () {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  let ASSETS = '../assets/';   // next to the game (this page lives at <game>/editor/), or the editor folder's own ./assets/ when it is self-contained
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.appendChild(s); });
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const downloadPng = (name, rgba, w, h, scale) => {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    x.drawImage(t, 0, 0, c.width, c.height); c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  };
  const drawRGBA = (cv, rgba, w, h) => { cv.width = w; cv.height = h; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0); };
  let MAN = null;

  /* ---------- the list of cases (needs only the manifest, so every case is there before any engine loads) ---------- */
  function renderCases(cur) {
    $('cases').innerHTML = MAN.cases.map((c) => {
      const draft = NutStore.draft(c.slug), isCur = c.slug === cur;
      return `<div class="case${isCur ? ' cur open' : ''}" data-slug="${esc(c.slug)}"><div class="head"><span class="no">${esc(c.no || '')}</span><span class="t">${esc(c.title)}</span>${c.published ? '' : '<span class="badge new" title="Not in index.json yet: a case still being made">new</span>'}${draft ? '<span class="badge draft" title="This browser holds a draft layout">draft</span>' : ''}</div>
        <div class="rooms">${c.rooms.map((r) => `<a href="?case=${encodeURIComponent(c.slug)}&room=${encodeURIComponent(r)}" class="${isCur && r === (S && S.room) ? 'cur' : ''}"><span>${esc(r)}</span><span class="note">${r === c.scene ? 'scene' : ''}${r === c.start ? ' start' : ''}</span></a>`).join('')}
          <div class="acts"><button data-act="prev" ${c.published ? '' : 'disabled title="No game page yet: the case is not in index.json"'}>Preview</button><button data-act="pub">Publish</button>${isCur ? '' : '<span class="note">' + (c.layout ? 'has layout' : 'no layout yet') + '</span>'}</div></div></div>`;
    }).join('');
    for (const el of document.querySelectorAll('.case')) {
      const slug = el.dataset.slug;
      el.querySelector('.head').onclick = () => { if (slug === cur) el.classList.toggle('open'); else if (el.classList.contains('open')) el.classList.remove('open'); else el.classList.add('open'); };
      el.querySelector('[data-act=prev]').onclick = () => window.open(`../${slug}/?layout=draft`, '_blank');
      el.querySelector('[data-act=pub]').onclick = () => (slug === cur ? publish() : publishOther(slug));
    }
  }
  const S = { room: null, moment: '', time: '', sel: null, scale: 5, snap: 0.25, tab: 'insp', libKind: 'objects', libQ: '' };
  let publishOther = () => {}, publish = () => {};

  /* ---------- the server (phase 4): signed-in users, drafts and published layouts kept online ---------- */
  let API = null;   // from editor-config.json: { "api": "/case-in-a-nutshell/api/editor" }; without it the editor keeps everything in this browser
  const server = async (method, path, body, keepalive) => {
    const r = await fetch(API + '/' + path, { method, credentials: 'same-origin', keepalive: !!keepalive, headers: Object.assign({ 'x-editor': '1' }, body !== undefined ? { 'content-type': 'application/json' } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { alert('Your session has ended. The page will ask you to sign in again.'); location.reload(); throw new Error('signed out'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.status);
    return data;
  };

  const getManifest = async () => {
    for (const base of ['assets/', '../assets/']) {
      try { const r = await fetch(base + 'editor-manifest.json', { cache: 'no-cache' }); if (r.ok) { ASSETS = base; return await r.json(); } } catch (e) { /* try the next place */ }
    }
    throw new Error('editor-manifest.json not found (looked in ./assets/ and ../assets/): the game build writes it');
  };
  getManifest().then(async (man) => {
    MAN = man;
    const entry = man.cases.find((c) => c.slug === q.get('case')) || man.cases[0];
    renderCases(entry && entry.slug);
    if (!entry) { $('stage').outerHTML = '<p id="empty">No cases in this build.</p>'; return; }
    await loadScript(ASSETS + man.engine.file + '?v=' + man.engine.v);
    await loadScript(ASSETS + entry.file + '?v=' + entry.v);
    let shared = null; try { const r = await fetch('library/sprites.json', { cache: 'no-cache' }); if (r.ok) shared = await r.json(); } catch (e) { /* the shared library is optional */ }
    try { const r = await fetch('editor-config.json', { cache: 'no-cache' }); if (r.ok) { const c = await r.json(); API = c.api ? String(c.api).replace(/\/$/, '') : null; } } catch (e) { /* no server configured */ }
    let srv = null;
    if (API) { try { const [layout, library, me] = await Promise.all([server('GET', 'layout/' + entry.slug), server('GET', 'library'), server('GET', 'me')]); srv = { layout, library: library.sprites || {}, user: me.user }; } catch (e) { if (e.message !== 'signed out') srv = { down: String(e.message || e) }; } }
    start(entry, shared, srv);
  }).catch((e) => { const el = $('err'); el.hidden = false; el.textContent = String(e.message || e); });

  function start(entry, shared, srv) {
    const slug = entry.slug, ids = Object.keys(ROOMS), sceneId = CASE.sceneRoom || 'bedroom', cat = MAN.catalog;
    NUT_LIBRARY.setCatalog(cat);
    $('caseName').textContent = `${entry.no ? entry.no + '. ' : ''}${entry.title}`;
    /* the document: this browser's draft, else the layout the case shipped with, else an empty one (records are made from the generator as you edit) */
    const online = !!(srv && srv.layout);
    const lib = NutStore.library(); lib.sprites = Object.assign({}, shared && shared.sprites, lib.sprites, online ? srv.library : {});
    const libSync = (id, spec) => { if (online) server(spec ? 'PUT' : 'DELETE', 'library/' + id, spec ? { spec } : undefined).catch(() => { /* the picture stays in this browser */ }); };
    if (online) { for (const [id, spec] of Object.entries(NutStore.library().sprites)) if (!(id in srv.library)) libSync(id, spec); $('who').textContent = srv.user; $('bOut').hidden = false; $('bOut').onclick = () => server('POST', 'logout', {}).then(() => location.reload()).catch(() => location.reload()); }
    else if (srv && srv.down) { $('who').textContent = 'server unreachable: working in this browser'; }
    NUT_SPRITES.add(lib.sprites);
    const empty = { version: 1, case: slug, rooms: {} };
    const sv = online ? srv.layout : null, newest = sv && [sv.draft, sv.published].filter(Boolean).sort((a, b) => b.id - a.id)[0];
    let doc = (newest && clone(newest.doc)) || NutStore.draft(slug) || (NUT_LAYOUT.state.shipped ? clone(NUT_LAYOUT.state.shipped) : empty);
    const shippedKey = JSON.stringify((sv && sv.published && sv.published.doc) || NUT_LAYOUT.state.shipped || empty);   // "no changes" means: the same as what the players have
    let undo = [], redo = [], saveT = null, srvT = null, savedAt = online ? (newest ? (newest.status === 'draft' ? 'draft from the server' : 'as published') : '') : (NutStore.draft(slug) ? 'draft kept in this browser' : '');
    const ed = () => NUT_LAYOUT.editor(doc, ROOMS, CASE);
    const reapply = () => NUT_LAYOUT.apply(ROOMS, doc, CASE);
    reapply();
    for (const id of ids) $('room').add(new Option(id, id));
    S.room = ids.includes(q.get('room')) ? q.get('room') : (ids.includes(entry.start) ? entry.start : (ids.includes(sceneId) ? sceneId : ids[0]));
    $('room').value = S.room;
    for (const m of CASE.moments || []) $('moment').add(new Option(m.id + (m.time ? '  ' + m.time : ''), m.id));
    S.moment = q.get('moment') || ($('moment').options[0] ? $('moment').options[0].value : '');
    $('moment').value = S.moment;
    renderCases(slug);

    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const cRef = $('cRef'), cRoom = $('cRoom'), cOver = $('cOver'), tip = $('tip');
    let refImg = null, geo = null, hover = 0, cur = null, wallList = [], warns = [];

    /* ---------- the room the engine draws now ---------- */
    function resolved() {
      const base = ROOMS[S.room], isScene = S.room === sceneId, m = isScene ? (CASE.moments || []).find((x) => x.id === S.moment) : null;
      const r = resolveRoom(base, m ? m.patches || [] : []);
      if (S.time) r.env.time = S.time;
      return { base, r };
    }
    const wallsOf = (r) => { const w = r.walls({ variant: 0, lampT: 0, flags: {} }, r), out = []; for (const side of ['L', 'R']) { const seen = {}; for (const it of (w[side].items || [])) { const n = seen[it.name] = (seen[it.name] || 0) + 1; out.push({ key: side + ':' + it.name + (n > 1 ? '#' + n : ''), wall: side, name: it.name, u0: it.u0, u1: it.u1, z0: it.z0, z1: it.z1 }); } } return out; };
    const lampT = () => ($('lamp').checked ? 1 : 0);
    function sizeStage() {
      S.scale = Number($('scale').value);
      for (const c of [cRef, cRoom, cOver]) { c.width = W * S.scale; c.height = H * S.scale; }
      $('size').style.width = W * S.scale + 'px'; $('size').style.height = H * S.scale + 'px';
    }
    function drawRef() {
      const x = cRef.getContext('2d'); x.clearRect(0, 0, cRef.width, cRef.height);
      if (!refImg) return;
      const k = Number($('rSc').value) / 100 * S.scale / 2, w = refImg.width * k, h = refImg.height * k;
      x.drawImage(refImg, (cRef.width - w) / 2 + Number($('rX').value), (cRef.height - h) / 2 + Number($('rY').value), w, h);
    }
    function drawRoom() {
      const { base, r } = cur;
      compose(base.light({ lampT: lampT() }, 0, r), hover, 0);
      off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.buffer.slice(0)), W, H), 0, 0);
      const x = cRoom.getContext('2d'); x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, cRoom.width, cRoom.height); x.drawImage(off, 0, 0, cRoom.width, cRoom.height);
      cRoom.style.opacity = Number($('rOp').value) / 100;
    }
    const wallPoly = (w) => (w.wall === 'R' ? [P(w.u0, 0, w.z0), P(w.u1, 0, w.z0), P(w.u1, 0, w.z1), P(w.u0, 0, w.z1)] : [P(0, w.u0, w.z0), P(0, w.u1, w.z0), P(0, w.u1, w.z1), P(0, w.u0, w.z1)]);
    function drawOver() {
      const { r } = cur;
      geo = NUT_LAYOUT.geometry(r, warns.flatMap((w) => w.ids));
      const hi = S.sel && S.sel.kind !== 'wall' ? S.sel.id : null;
      const ov = NUT_LAYOUT.rasterOverlay(geo, S.scale, { grid: $('oGrid').checked, foot: $('oFoot').checked, labels: $('oNum').checked, items: $('oItems').checked, highlight: S.sel && S.sel.kind === 'obj' ? hi : null });
      const x = cOver.getContext('2d'); x.putImageData(new ImageData(new Uint8ClampedArray(ov.buf.buffer), ov.w, ov.h), 0, 0);
      x.lineWidth = Math.max(2, S.scale / 2); x.strokeStyle = '#ffe650';
      if (S.sel && S.sel.kind === 'item') { const it = geo.items.find((i) => i.id === S.sel.id); if (it) { x.beginPath(); x.arc(it.at[0] * S.scale, it.at[1] * S.scale, S.scale * 3, 0, 7); x.stroke(); } }
      if (S.sel && S.sel.kind === 'wall') { const w = wallList.find((i) => i.key === S.sel.id); if (w) { x.beginPath(); wallPoly(w).forEach((p, i) => (i ? x.lineTo(p[0] * S.scale, p[1] * S.scale) : x.moveTo(p[0] * S.scale, p[1] * S.scale))); x.closePath(); x.stroke(); } }
    }
    function checks(r) {
      warns = NUT_LAYOUT.validate(r);
      const mom = S.room === sceneId ? NUT_LAYOUT.validateMoments(ROOMS, CASE) : [];
      return { warns, mom };
    }
    function render(fullPanels) {
      cur = resolved();
      renderRoom(cur.r, { variant: 0, lampT: lampT(), flags: {} });
      wallList = wallsOf(cur.r);
      const c = checks(cur.r);
      drawRoom(); drawOver(); drawRef();
      if (fullPanels !== false) { renderInsp(); renderChecks(c); renderState(); }
      $('momentL').hidden = !(S.room === sceneId && (CASE.moments || []).length); $('onlyL').hidden = $('momentL').hidden; if ($('onlyL').hidden) S.only = false;
      const u = new URLSearchParams({ case: slug, room: S.room }); history.replaceState(null, '', '?' + u);
      if (fullPanels !== false) { renderCases(slug); if (S.tab === 'lib') fillLib(); if (S.tab === 'room') renderRoomTab(); }
    }
    $('cases').addEventListener('click', (e) => {   // a room of this case switches in place; a room of another case is a plain link (a new page load)
      const a = e.target.closest('.rooms a'), el = a && a.closest('.case');
      if (!a || !el || el.dataset.slug !== slug) return;
      e.preventDefault(); S.room = new URL(a.href).searchParams.get('room'); $('room').value = S.room; S.sel = null; render();
    });

    /* ---------- editing ---------- */
    const key = () => JSON.stringify(doc);
    // edits to objects go to the shared layout, or to the moment on screen when "only this moment" is ticked; walls, floors and size are the same at every time
    const momentMode = () => !!(S.only && S.room === sceneId && (CASE.moments || []).some((m) => m.id === S.moment));
    const scoped = (base) => (!base && momentMode() ? ed().at(S.moment) : ed());
    const baseObj = (id) => ROOMS[S.room].objects.find((o) => o.id === id), baseItem = (id) => (ROOMS[S.room].items || []).find((o) => o.id === id);
    function mutate(fn, base) {
      const before = key();
      const ok = fn(scoped(base));
      if (ok === false) return false;
      if (key() === before) return false;
      undo.push(before); if (undo.length > 200) undo.shift(); redo = [];
      afterChange(); return true;
    }
    function afterChange() { reapply(); render(); queueSave(); }
    const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(saveDraft, 400); renderState(true); };
    const usedSprites = () => NUT_LAYOUT.spritesUsed(doc);
    function fileDoc() {
      const d = clone(doc); d.sprites = {}; for (const id of usedSprites()) { const sp = NUT_SPRITES.get(id); if (sp) { const c = Object.assign({}, sp); delete c.id; d.sprites[id] = c; } }
      if (!Object.keys(d.sprites).length) delete d.sprites;
      return d;
    }
    function saveDraft(now) {
      clearTimeout(saveT); doc.sprites = fileDoc().sprites; if (!doc.sprites) delete doc.sprites;
      const ok = NutStore.saveDraft(slug, doc), nw = allChecks().length, warn = nw ? ` · ${nw} warning${nw === 1 ? '' : 's'}` : '';
      savedAt = ok ? 'draft saved ' + new Date().toLocaleTimeString() + warn : 'could not save: browser storage is blocked';
      if (online) { clearTimeout(srvT); if (now === true) pushDraft(warn); else srvT = setTimeout(() => pushDraft(warn), 1200); }
      renderState();
    }
    function pushDraft(warn, keepalive) {
      return server('PUT', 'layout/' + slug + '/draft', { doc: fileDoc() }, keepalive).then(() => { savedAt = 'saved to the server ' + new Date().toLocaleTimeString() + (warn || ''); renderState(); }).catch((e) => { if (e.message === 'signed out') return; savedAt = 'could not reach the server (kept in this browser): ' + e.message; renderState(); });
    }
    function renderState() {
      const same = key() === shippedKey, el = $('state');
      el.textContent = same && !NutStore.draft(slug) ? 'no changes' : (savedAt || 'unsaved changes');
      el.className = 'chip ' + (same ? '' : (/^(draft saved|saved to the server|published|draft from the server)/.test(savedAt) ? 'ok' : 'dirty'));
      $('bUndo').disabled = !undo.length; $('bRedo').disabled = !redo.length;
      const sel = S.sel && S.sel.kind === 'obj' ? cur && cur.r.objects.find((o) => o.id === S.sel.id) : null;
      $('bRot').disabled = !sel || !NUT_LIBRARY.rotInfo(origType(sel), [sel.w, sel.d]); $('bDel').disabled = !sel || ed().isLocked(S.room, sel.id, sel.hot);
    }
    function doUndo() { if (!undo.length) return; redo.push(key()); doc = JSON.parse(undo.pop()); afterChange(); }
    function doRedo() { if (!redo.length) return; undo.push(key()); doc = JSON.parse(redo.pop()); afterChange(); }
    const origType = (o) => o.was || o.t;
    const selObj = () => (S.sel && S.sel.kind === 'obj' && cur ? cur.r.objects.find((o) => o.id === S.sel.id) : null);

    /* ---------- picking and dragging on the picture ---------- */
    const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const heightOf = (o) => (o.h || (cat.types[origType(o)] && cat.types[origType(o)].h) || (NUT_LAYOUT.FLAT.has(o.t) ? 0 : 28));
    function hullHit(o, p) {
      const base = [P(o.x, o.y, 0), P(o.x + o.w, o.y, 0), P(o.x + o.w, o.y + o.d, 0), P(o.x, o.y + o.d, 0)], h = heightOf(o);
      if (inPoly(p, base)) return true;
      if (!h) return false;
      const up = base.map((b) => [b[0], b[1] - h]);
      if (inPoly(p, up)) return true;
      for (let i = 0; i < 4; i++) if (inPoly(p, [base[i], base[(i + 1) % 4], up[(i + 1) % 4], up[i]])) return true;
      return false;
    }
    function pick(px, py) {
      const p = [px, py];
      for (const it of geo.items) if (Math.hypot(it.at[0] - px, it.at[1] - py) < 3.2) return { kind: 'item', id: it.id };
      const order = sortObjs(cur.r.objects), rank = new Map(order.map((o, i) => [o.id, i]));
      const objs = cur.r.objects;
      const hot = px >= 0 && py >= 0 && px < W && py < H ? HOTS[hotIdx[Math.floor(py) * W + Math.floor(px)]] : null;
      const byHot = hot ? objs.filter((o) => o.hot === hot) : [];
      const hits = objs.filter((o) => hullHit(o, p)).sort((a, b) => rank.get(b.id) - rank.get(a.id));
      if (byHot.length === 1) return { kind: 'obj', id: byHot[0].id };
      const nonFlat = hits.filter((o) => !NUT_LAYOUT.FLAT.has(o.t));
      if (byHot.length > 1) { const h = hits.find((o) => byHot.includes(o)); if (h) return { kind: 'obj', id: h.id }; }
      if (nonFlat[0]) return { kind: 'obj', id: nonFlat[0].id };
      if (hits[0]) return { kind: 'obj', id: hits[0].id };
      for (const w of wallList) if (inPoly(p, wallPoly(w))) return { kind: 'wall', id: w.key };
      return null;
    }
    const toEngine = (e) => { const b = cOver.getBoundingClientRect(); return [(e.clientX - b.left) / S.scale, (e.clientY - b.top) / S.scale]; };
    const floorAt = (p) => { const tx = (p[0] - OX) / HW, ty = (p[1] - OY) / HH; return [(ty + tx) / 2, (ty - tx) / 2]; };
    let drag = null;
    $('stage').onpointerdown = (e) => {
      if (e.button !== 0) return;
      const p = toEngine(e), hit = pick(p[0], p[1]);
      S.sel = hit; hover = 0;
      if (hit) {
        const f = floorAt(p);
        if (hit.kind === 'obj') { const o = momentMode() ? selObj() : (baseObj(hit.id) || selObj()); drag = { kind: 'obj', f, cell: [o.x, o.y], moved: false, before: key() }; }
        else if (hit.kind === 'item') { const it = momentMode() ? cur.r.items.find((i) => i.id === hit.id) : (baseItem(hit.id) || cur.r.items.find((i) => i.id === hit.id)), host = momentMode() ? cur.r.objects.find((o) => o.id === it.on) : (baseObj(it.on) || cur.r.objects.find((o) => o.id === it.on)); drag = host ? { kind: 'item', f, off: [it.x - host.x, it.y - host.y], moved: false, before: key() } : null; }
        else { const w = wallList.find((i) => i.key === hit.id); drag = { kind: 'wall', u: wallU(w, p), span: [w.u0, w.u1], moved: false, before: key() }; }
        if (drag) { $('stage').setPointerCapture(e.pointerId); $('stage').classList.add('drag'); }
      }
      render();
    };
    const wallU = (w, p) => (w.wall === 'R' ? (p[0] - OX) / HW : (OX - p[0]) / HW);
    $('stage').onpointermove = (e) => {
      const p = toEngine(e);
      if (drag) {
        const sel = S.sel, snap = e.shiftKey ? 0.05 : S.snap; let did = false;
        const run = () => {
          const E = sel.kind !== 'wall' && momentMode() ? ed().at(S.moment) : ed();
          if (sel.kind === 'obj') { const f = floorAt(p); did = E.move(S.room, sel.id, [drag.cell[0] + f[0] - drag.f[0], drag.cell[1] + f[1] - drag.f[1]], snap); }
          else if (sel.kind === 'item') { const f = floorAt(p); did = E.moveItem(S.room, sel.id, [drag.off[0] + f[0] - drag.f[0], drag.off[1] + f[1] - drag.f[1]], 0.05); }
          else { const w = wallList.find((i) => i.key === sel.id), d = wallU(w, p) - drag.u; did = ed().moveWall(S.room, sel.id, [Math.round((drag.span[0] + d) * 4) / 4, Math.round((drag.span[1] + d) * 4) / 4]); }
        };
        run();
        if (did && key() !== drag.before) { if (!drag.moved) { undo.push(drag.before); redo = []; drag.moved = true; } reapply(); render(false); renderInsp(); queueSave(); }
        return;
      }
      const hn = p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H ? hotIdx[Math.floor(p[1]) * W + Math.floor(p[0])] : 0;
      if (hn !== hover) { hover = hn; drawRoom(); }
      const b = cOver.getBoundingClientRect();
      tip.style.display = hn ? 'block' : 'none';
      if (hn) { tip.textContent = HOTS[hn]; tip.style.left = e.clientX - b.left + 12 + 'px'; tip.style.top = e.clientY - b.top + 12 + 'px'; }
    };
    $('stage').onpointerup = () => { drag = null; $('stage').classList.remove('drag'); render(); };
    $('stage').onpointerleave = () => { tip.style.display = 'none'; if (hover && !drag) { hover = 0; drawRoom(); } };

    /* ---------- the Selected tab ---------- */
    const catOf = (o) => cat.types[origType(o)] || {};
    const lockWhy = (rid, id, hot) => NUT_LAYOUT.lockInfo(CASE)(rid, id, hot);
    function renderInsp() {
      const el = $('p-insp'), { r } = cur, rm = doc.rooms[S.room] || { objects: [] };
      let h = '';
      const sel = S.sel;
      if (!sel) h += '<p class="note">Nothing selected. Click an object, a small item or a wall item in the picture, or pick one from the lists below.</p>';
      if (sel && sel.kind === 'obj') {
        const o = momentMode() ? selObj() : (baseObj(sel.id) || selObj());
        if (o) {
          const why = lockWhy(S.room, o.id, o.hot), locked = why.length > 0, flat = NUT_LAYOUT.FLAT.has(o.t);
          const mm = S.room === sceneId && (CASE.moments || []).length ? ed().at(S.moment) : null, others = Object.keys(((doc.rooms[S.room] || {}).times) || {}).filter((k) => k !== S.moment && ed().at(k).has(S.room, o.id));
          const scope = !mm ? '' : momentMode() ? `<div class="note">Editing <b>only at ${esc(S.moment)}</b>: the change is kept for this moment, every other time keeps the shared layout.${mm.has(S.room, o.id) ? ` <b>&#9733; This moment has its own change for it.</b> <button data-a="takeback" data-id="${esc(o.id)}">Take it back</button>` : ''}</div>` : `<div class="note">Editing the shared layout (every time).${mm.has(S.room, o.id) ? ` At ${esc(S.moment)} it has a change of its own, so edits here will not show at that moment.` : ''}${others.length ? ` Moments with their own change for it: ${esc(others.join(', '))}.` : ''}</div>`;
          h += `<h3>Object</h3><div class="row"><b>${esc(o.id)}</b><span class="badge ${locked ? 'locked' : 'free'}">${locked ? 'locked' : 'free'}</span>${flat ? '<span class="badge flat">flat</span>' : ''}</div>
            <div class="note">type ${esc(origType(o))}${o.t === 'sprite' ? ' &rarr; drawn as sprite ' + esc(o.sprite) : (o.was ? ' &rarr; drawn as ' + esc(o.t) : '')}${o.hot ? ' &middot; tap name "' + esc(o.hot) + '"' : ' &middot; not tappable'}</div>
            ${scope}
            ${locked ? `<div class="note">Locked because: ${esc(why.map((w) => ({ puzzle: 'a puzzle or lock depends on it', zoom: 'it has a zoom view the game draws', patched: 'a moment of the case changes it' }[w] || w)).join('; '))}. Place and facing can change; what it is cannot.</div>` : ''}
            <div class="row"><label>cell x,y</label><input type="number" step="0.05" data-f="cx" value="${+o.x.toFixed(3)}"><input type="number" step="0.05" data-f="cy" value="${+o.y.toFixed(3)}"></div>
            <div class="row"><label>size</label><input type="number" step="0.05" min="0.1" data-f="fw" value="${+o.w.toFixed(3)}" ${locked ? 'disabled' : ''}><input type="number" step="0.05" min="0.1" data-f="fd" value="${+o.d.toFixed(3)}" ${locked ? 'disabled' : ''}></div>
            <div class="row"><button data-a="rot" ${NUT_LIBRARY.rotInfo(origType(o), [o.w, o.d]) ? '' : 'disabled title="This object only looks one way"'}>Rotate (R)</button><button data-a="del" ${locked ? 'disabled' : ''}>Delete</button></div>
            <h3>Look</h3>`;
          if (locked) h += '<div class="note">The look of a locked object is fixed: the game draws its zoom view and puzzle to match it.</div>';
          else {
            const lk = (rm.objects.find((x) => x.id === o.id) || {}).look;
            h += `<div class="note">Now: ${lk ? (lk.sprite ? 'sprite ' + esc(lk.sprite) : 'library object ' + esc(lk.type)) : 'the original, drawn by code'}</div>
              <div class="row"><button data-a="tolib">Pick from the library</button><button data-a="upload">Replace with my image&hellip;</button><button data-a="reset" ${lk ? '' : 'disabled'}>Back to original</button></div>
              <div class="row"><button data-a="png">Download this look as PNG</button></div>
              ${doc.rooms[S.room] && o.hasItems ? '' : ''}`;
            const hosts = r.items.filter((i) => i.on === o.id);
            if (hosts.length) h += `<div class="note">It holds ${hosts.length} small item${hosts.length > 1 ? 's' : ''} (${esc(hosts.map((i) => i.id).join(', '))}). A sprite gives them a surface height of ${(NUT_SPRITES.get(o.sprite) || {}).top || 0} px; set the sprite's surface height if they look sunk.</div>`;
          }
        }
      }
      if (sel && sel.kind === 'item') {
        const it = r.items.find((i) => i.id === sel.id), host = it && r.objects.find((o) => o.id === it.on);
        if (it) {
          const why = lockWhy(S.room, it.id, it.hot);
          h += `<h3>Small item</h3><div class="row"><b>${esc(it.id)}</b><span class="badge ${why.length ? 'locked' : 'free'}">${why.length ? 'locked' : 'free'}</span></div><div class="note">on ${esc(it.on || '-')} &middot; type ${esc(it.k)}</div>
            ${host ? `<div class="row"><label>offset x,y</label><input type="number" step="0.05" data-f="ix" value="${+(it.x - host.x).toFixed(3)}"><input type="number" step="0.05" data-f="iy" value="${+(it.y - host.y).toFixed(3)}"></div><div class="note">It moves with its host. Drag it on the picture, or type the offset from the host's corner.</div>` : ''}`;
        }
      }
      if (sel && sel.kind === 'wall') {
        const w = wallList.find((i) => i.key === sel.id);
        if (w) {
          const why = lockWhy(S.room, null, w.name);
          h += `<h3>Wall item</h3><div class="row"><b>${esc(w.name)}</b><span class="badge ${why.length ? 'locked' : 'free'}">${why.length ? 'locked' : 'free'}</span></div><div class="note">${w.wall === 'R' ? 'right' : 'left'} wall &middot; ${esc(w.key)}</div>
            <div class="row"><label>start</label><input type="number" step="0.25" data-f="wu" value="${+w.u0.toFixed(3)}"><label>length</label><span>${+(w.u1 - w.u0).toFixed(2)}</span></div>
            <h3>Look</h3>${why.length ? '<div class="note">Locked: a door or board the game uses.</div>' : `<div class="row"><button data-a="tolib">Pick from the library</button><button data-a="upload">Replace with my image&hellip;</button><button data-a="reset">Back to original</button></div><div class="note">A sprite is stretched to the item's size (1 pixel = 1/10 tile wide).</div>`}`;
        }
      }
      if (S.room === sceneId && (CASE.moments || []).length) {
        const t = (((doc.rooms[S.room] || {}).times) || {})[S.moment], ids2 = t ? (t.objects || []).map((p) => p.id + (p.deleted ? ' (taken out)' : '')).concat((t.items || []).map((p) => p.id), (t.added || []).map((p) => p.id + ' (new)')) : [];
        const raw = t ? (t.objects || []).map((p) => p.id).concat((t.items || []).map((p) => p.id), (t.added || []).map((p) => p.id)) : [];
        h += `<h3>At ${esc(S.moment)}</h3>` + (ids2.length ? ids2.map((label, i) => `<div class="row"><span>&#9733; ${esc(label)}</span><button data-a="takeback" data-id="${esc(raw[i])}">Take back</button></div>`).join('') + '<div class="row"><button data-a="resetmoment">Take back all</button></div>' : '<div class="note">This moment adds nothing to the shared layout, apart from what the case itself changes. Tick "only this moment" and edit to give it differences of its own.</div>');
      }
      const gone = (rm.objects || []).filter((x) => x.deleted);
      h += '<h3>Objects in this room</h3><table>' + cur.r.objects.map((o, i) => `<tr class="row2${S.sel && S.sel.kind === 'obj' && S.sel.id === o.id ? ' on' : ''}" data-k="obj" data-id="${esc(o.id)}"><td>${NUT_LAYOUT.FLAT.has(o.t) ? '' : i + 1}</td><td>${S.room === sceneId && (CASE.moments || []).length && ed().at(S.moment).has(S.room, o.id) ? '&#9733; ' : ''}${esc(o.id)}</td><td><span class="badge ${lockWhy(S.room, o.id, o.hot).length ? 'locked' : 'free'}">${lockWhy(S.room, o.id, o.hot).length ? 'locked' : 'free'}</span></td></tr>`).join('') + '</table>';
      if (r.items.length) h += '<h3>Small items</h3><table>' + r.items.map((o) => `<tr class="row2${S.sel && S.sel.kind === 'item' && S.sel.id === o.id ? ' on' : ''}" data-k="item" data-id="${esc(o.id)}"><td>${esc(o.id)}</td><td>${esc(o.on || '-')}</td></tr>`).join('') + '</table>';
      h += '<h3>Wall items</h3><table>' + wallList.map((w) => `<tr class="row2${S.sel && S.sel.kind === 'wall' && S.sel.id === w.key ? ' on' : ''}" data-k="wall" data-id="${esc(w.key)}"><td>${esc(w.name)}</td><td>${w.wall}</td></tr>`).join('') + '</table>';
      if (gone.length) h += '<h3>Removed from this room</h3>' + gone.map((g) => `<div class="row"><span>${esc(g.id)}</span><button data-a="restore" data-id="${esc(g.id)}">Put back</button></div>`).join('');
      el.innerHTML = h;
      for (const tr of el.querySelectorAll('tr.row2')) tr.onclick = () => { S.sel = { kind: tr.dataset.k, id: tr.dataset.id }; render(); };
      for (const b of el.querySelectorAll('[data-a]')) b.onclick = () => act(b.dataset.a, b.dataset);
      for (const i of el.querySelectorAll('input[data-f]')) i.onchange = () => field(i.dataset.f);
    }
    function field(f) {
      const v = (n) => Number(el$(n).value), el$ = (n) => $('p-insp').querySelector(`[data-f=${n}]`), sel = S.sel;
      mutate((E) => {
        if (f === 'cx' || f === 'cy') return E.move(S.room, sel.id, [v('cx'), v('cy')], 0.05);
        if (f === 'fw' || f === 'fd') return E.resize(S.room, sel.id, [v('fw'), v('fd')]);
        if (f === 'ix' || f === 'iy') return E.moveItem(S.room, sel.id, [v('ix'), v('iy')], 0.05);
        if (f === 'wu') { const w = wallList.find((i) => i.key === sel.id), d = v('wu') - w.u0; return E.moveWall(S.room, sel.id, [w.u0 + d, w.u1 + d]); }
      }, f === 'wu');
    }
    function act(a, data) {
      const sel = S.sel;
      if (a === 'rot') mutate((E) => E.rotate(S.room, sel.id));
      else if (a === 'del') { mutate((E) => E.remove(S.room, sel.id)); S.sel = null; render(); }
      else if (a === 'restore') mutate((E) => E.restore(S.room, data.id));
      else if (a === 'reset') mutate((E) => (sel.kind === 'wall' ? E.lookWall(S.room, sel.id, null) : E.look(S.room, sel.id, null)), sel.kind === 'wall');
      else if (a === 'takeback') mutate(() => ed().at(S.moment).clear(S.room, data.id), true);
      else if (a === 'resetmoment') { if (confirm('Take back everything this moment changes? The shared layout stays.')) mutate(() => ed().at(S.moment).clear(S.room), true); }
      else if (a === 'tolib') setTab('lib');
      else if (a === 'upload') pickFile((f) => importDialog(f, true));
      else if (a === 'png') { const o = selObj(); const t = NUT_LIBRARY.thumb(origType(o), { w: o.w, d: o.d, props: { face: o.face, dir: o.dir, back: o.back } }); if (t) downloadPng(`${origType(o)}-${o.w}x${o.d}-anchor${t.ax}_${t.ay}.png`, t.rgba, t.w, t.h, 8); }
    }

    /* ---------- the Room tab: floor, walls, colours ---------- */
    function setRoomLook(patch, spriteId) {
      if (spriteId) { doc.sprites = doc.sprites || {}; doc.sprites[spriteId] = lib.sprites[spriteId]; }
      mutate((E) => E.setRoom(S.room, patch), true);
    }
    const pv = (v) => (!v ? '' : typeof v === 'string' ? v : 'sprite:' + v.sprite), unpv = (v) => (!v ? null : v.startsWith('sprite:') ? { sprite: v.slice(7) } : v);
    function renderRoomTab() {
      const el = $('p-room'), room = ROOMS[S.room], gen = room.__gen || room, spec = NUT_LAYOUT.roomSpec(room), rs = (doc.rooms[S.room] && doc.rooms[S.room].room) || {};
      const tiles = Object.keys(lib.sprites).filter((id) => lib.sprites[id].tile);
      const sel = (name, kinds, cur, built) => `<select data-r="${name}"><option value="">as built (${esc(built || 'code of its own')})</option>${kinds.map((k) => `<option value="${k}"${pv(cur) === k ? ' selected' : ''}>${k}</option>`).join('')}${tiles.map((id) => `<option value="sprite:${esc(id)}"${pv(cur) === 'sprite:' + id ? ' selected' : ''}>tile: ${esc(lib.sprites[id].name || id)}</option>`).join('')}</select>`;
      const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : '#000000');
      el.innerHTML = `<h3>Floor and walls of ${esc(S.room)}</h3>
        ${spec.custom ? '<div class="note">This room was written by hand: its floor and walls are code of their own, and "as built" keeps them. You can still put another floor or wall over them.</div>' : ''}
        <div class="row"><label>floor</label>${sel('floor', NUT_LAYOUT.FLOORS, rs.floor, spec.floor)}</div>
        <div class="row"><label>left wall</label>${sel('wallL', NUT_LAYOUT.WALLS, rs.wallL, spec.wallL)}</div>
        <div class="row"><label>right wall</label>${sel('wallR', NUT_LAYOUT.WALLS, rs.wallR, spec.wallR)}</div>
        <div class="note">A floor change keeps the rug where it is (a case may hide something under it). Tiles come from the Library: add an image and choose "a floor or wall tile".</div>
        <h3>Colours</h3><div class="note">Every colour the room is made of. A changed one is marked; the arrow takes it back.</div>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))">${(spec.custom ? Object.keys(gen.pal) : NUT_LAYOUT.ROOM_COLOURS).map((k) => { const mine = rs.pal && rs.pal[k], cur = mine || gen.pal[k]; return `<div class="row" style="margin:2px 0"><input type="color" data-c="${k}" value="${hex(cur)}"><span title="${k}">${k}${mine ? ' *' : ''}</span>${mine ? `<button data-cr="${k}" title="back to the colour the kit chose">&larr;</button>` : ''}</div>`; }).join('')}</div>
        <div class="row"><button data-a="resetroom" ${doc.rooms[S.room] && doc.rooms[S.room].room ? '' : 'disabled'}>Back to the kit's floor, walls and colours</button></div>
        ${S.room === sceneId && (CASE.moments || []).length ? '<div class="note">Floor, walls, colours and size are the same at every moment.</div>' : ''}
        <h3>Size</h3>
        <div class="row"><label>right wall</label><input type="number" min="${NUT_LAYOUT.MIN_SIDE}" max="${NUT_LAYOUT.MAX_SIDE}" step="1" id="szX" value="${room.nx || 8}"><span>tiles</span><label>left wall</label><input type="number" min="${NUT_LAYOUT.MIN_SIDE}" max="${NUT_LAYOUT.MAX_SIDE}" step="1" id="szY" value="${room.ny || 8}"><span>tiles</span><button data-a="size">Resize</button></div>
        <div class="row"><label><input type="checkbox" id="szF" ${S.follow === false ? '' : 'checked'}> move what stands by the far walls along with them</label></div>
        <div class="note" id="szNote">As the kit built it: ${gen.nx || 8} x ${gen.ny || 8}. Each wall is ${NUT_LAYOUT.MIN_SIDE} to ${NUT_LAYOUT.MAX_SIDE} tiles and together at most ${NUT_LAYOUT.MAX_SUM}: the picture is 176 pixels wide, so a room can be reshaped or made smaller, and made bigger only by a tile or so. Doors, windows and objects in the far half move with the walls when the box is ticked; nothing is deleted, and what no longer fits shows up in Checks.</div>`;
      el.querySelector('[data-a=size]').onclick = () => {
        const x = Number($('szX').value), y = Number($('szY').value); S.follow = $('szF').checked;
        if (!NUT_LAYOUT.validSize(x, y)) { $('szNote').style.color = '#ff4a3c'; $('szNote').textContent = `${x} x ${y} does not fit: whole tiles, ${NUT_LAYOUT.MIN_SIDE} to ${NUT_LAYOUT.MAX_SIDE} a side and ${NUT_LAYOUT.MAX_SUM} or less in all.`; return; }
        mutate((E) => E.resizeRoom(S.room, [x, y], { follow: S.follow }), true);
      };
      for (const s2 of el.querySelectorAll('select[data-r]')) s2.onchange = () => { const v = unpv(s2.value); setRoomLook({ [s2.dataset.r]: v }, v && v.sprite); };
      for (const c of el.querySelectorAll('input[data-c]')) c.onchange = () => mutate((E) => E.setRoom(S.room, { pal: { [c.dataset.c]: c.value } }), true);
      for (const b of el.querySelectorAll('button[data-cr]')) b.onclick = () => mutate((E) => E.setRoom(S.room, { pal: { [b.dataset.cr]: null } }), true);
      el.querySelector('[data-a=resetroom]').onclick = () => mutate((E) => { const r = (doc.rooms[S.room] || {}).room || {}; return E.setRoom(S.room, { floor: null, wallL: null, wallR: null, pal: Object.fromEntries(Object.keys(r.pal || {}).map((k) => [k, null])) }); });   // (the size has its own button)
    }

    /* ---------- the Library tab ---------- */
    const thumbCache = {};
    function cardCanvas(key, make) { const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; try { const t = thumbCache[key] || (thumbCache[key] = make()); if (t) drawRGBA(cv, t.rgba, t.w, t.h); } catch (e) { /* a type that cannot draw alone: an empty card */ } return cv; }
    const spriteThumb = (id) => { const s = NUT_SPRITES.get(id); return s ? { rgba: NUT_SPRITES.toRGBA(s), w: s.w, h: s.h } : null; };
    function renderLib() {
      const el = $('p-lib'), k = S.libKind, qq = S.libQ.toLowerCase();
      const sp = NUT_SPRITES.all(), sprites = Object.keys(sp).filter((id) => lib.sprites[id]);
      let h = `<div class="row"><select id="libK"><option value="objects"${k === 'objects' ? ' selected' : ''}>Objects drawn by code (${Object.keys(cat.types).length})</option><option value="sprites"${k === 'sprites' ? ' selected' : ''}>Sprites (${sprites.length})</option><option value="paints"${k === 'paints' ? ' selected' : ''}>Wall painters (${cat.paints.length})</option></select><input type="search" id="libQ" placeholder="search" value="${esc(S.libQ)}"></div>
        <div class="row"><button id="libUp">Add an image&hellip;</button><button id="libDl">Download library.json</button></div><div class="note" id="libNote"></div><div class="grid" id="libGrid"></div>`;
      el.innerHTML = h;
      $('libK').onchange = (e) => { S.libKind = e.target.value; renderLib(); };
      $('libQ').oninput = (e) => { S.libQ = e.target.value; fillLib(); };
      $('libUp').onclick = () => pickFile((f) => importDialog(f, false));
      $('libDl').onclick = () => download('sprites.json', JSON.stringify({ sprites: lib.sprites }, null, 1));
      fillLib();
    }
    function fillLib() {
      const grid = $('libGrid'), k = S.libKind, qq = S.libQ.toLowerCase(); grid.innerHTML = '';
      const o = selObj(), w = S.sel && S.sel.kind === 'wall' ? S.sel.id : null;
      const canObj = o && !lockWhy(S.room, o.id, o.hot).length, canWall = w && !lockWhy(S.room, null, wallList.find((i) => i.key === w).name).length;
      $('libNote').textContent = k === 'paints' ? (canWall ? 'Click "Use" to repaint the selected wall item.' : 'Select a free wall item first (a window, a picture), then pick a painter.') : (canObj ? `Selected: ${o.id}. "Use" gives it that look; "Add" puts a new one in the room.` : 'Select a free object to give it another look, or add a new object to the room.');
      const card = (name, canvas, btns) => { const d = document.createElement('div'); d.className = 'card'; d.appendChild(canvas); const n = document.createElement('div'); n.className = 'n'; n.textContent = name; d.appendChild(n); const b = document.createElement('div'); b.className = 'b'; for (const [t, fn, dis, title] of btns) { const x = document.createElement('button'); x.textContent = t; x.disabled = !!dis; if (title) x.title = title; x.onclick = fn; b.appendChild(x); } d.appendChild(b); grid.appendChild(d); };
      if (k === 'objects') for (const t of Object.keys(cat.types)) {
        const c = cat.types[t]; if (qq && !(t + ' ' + c.category + ' ' + c.tags.join(' ')).toLowerCase().includes(qq)) continue;
        card(t, cardCanvas('o:' + t, () => NUT_LIBRARY.thumb(t, { w: c.footprint[0], d: c.footprint[1] })), [
          ['Add', () => addObject({ type: t, footprint: c.footprint, hot: c.hot, props: c.h ? { h: c.h } : {}, look: null })],
          ['Use', () => mutate((E) => E.look(S.room, o.id, { type: t })), !canObj, 'Give the selected object this look'],
          ['PNG', () => { const th = NUT_LIBRARY.thumb(t, { w: c.footprint[0], d: c.footprint[1] }); if (th) downloadPng(`${t}-${c.footprint.join('x')}-anchor${th.ax}_${th.ay}.png`, th.rgba, th.w, th.h, 8); }]]);
      }
      if (k === 'sprites') {
        const ids = Object.keys(lib.sprites).filter((id) => !qq || (id + ' ' + (lib.sprites[id].name || '')).toLowerCase().includes(qq));
        if (!ids.length) grid.innerHTML = '<p class="note">No sprites yet. "Add an image" runs a picture through the pixel-art check and puts it here.</p>';
        for (const id of ids) {
          const s = lib.sprites[id];
          if (s.tile) { card((s.name || id) + ' (tile)', cardCanvas('s:' + id + s.px.length, () => spriteThumb(id)), [
            ['Floor', () => setRoomLook({ floor: { sprite: id } }, id), false, 'Use as the floor of this room'], ['Wall L', () => setRoomLook({ wallL: { sprite: id } }, id)], ['Wall R', () => setRoomLook({ wallR: { sprite: id } }, id)],
            ['PNG', () => downloadPng(id + '.png', NUT_SPRITES.toRGBA(s), s.w, s.h, 8)],
            ['Delete', () => { if (confirm('Remove this tile from the library? Layouts that use it keep their own copy.')) { delete lib.sprites[id]; NutStore.saveLibrary(lib); libSync(id, null); renderLib(); } }]]); continue; }
          card(s.name || id, cardCanvas('s:' + id + s.px.length, () => spriteThumb(id)), [
            ['Add', () => addObject({ type: 'sprite', footprint: s.fp, hot: null, props: { sprite: id }, look: null, sprite: id })],
            ['Use', () => useSprite(id), !(canObj || canWall), 'Give the selected object or wall item this picture'],
            ['PNG', () => downloadPng(id + '.png', NUT_SPRITES.toRGBA(s), s.w, s.h, 8)],
            ['Delete', () => { if (confirm('Remove this sprite from the library? Layouts that use it keep their own copy.')) { delete lib.sprites[id]; NutStore.saveLibrary(lib); libSync(id, null); renderLib(); } }]]);
        }
      }
      if (k === 'paints') for (const p of cat.paints) {
        if (qq && !p.includes(qq)) continue;
        card(p, cardCanvas('p:' + p, () => { try { return NUT_LIBRARY.paintThumb(ITEM_PAINT[p](), 24, 40); } catch (e) { return null; } }), [['Use', () => mutate((E) => E.lookWall(S.room, S.sel.id, { paint: p }), true), !canWall, 'Repaint the selected wall item']]);
      }
    }
    function useSprite(id) {
      doc.sprites = doc.sprites || {}; doc.sprites[id] = lib.sprites[id];
      mutate((E) => (S.sel.kind === 'wall' ? E.lookWall(S.room, S.sel.id, { sprite: id }) : E.look(S.room, S.sel.id, { sprite: id })), S.sel.kind === 'wall');
    }
    function addObject(spec) {
      const { r } = cur, nx = r.nx || 8, ny = r.ny || 8, fp = spec.footprint;
      let newId = null;
      mutate((E) => {
        // the first free spot, looking outwards from the middle of the room
        const hit = (x, y) => r.objects.some((o) => !NUT_LAYOUT.FLAT.has(o.t) && x < o.x + o.w && x + fp[0] > o.x && y < o.y + o.d && y + fp[1] > o.y);
        let best = [Math.max(0, (nx - fp[0]) / 2), Math.max(0, (ny - fp[1]) / 2)];
        for (let rad = 0; rad < 8; rad += 0.5) { let found = false; for (let a = 0; a < 16 && !found; a++) { const x = best[0] + Math.cos(a / 16 * 6.283) * rad, y = best[1] + Math.sin(a / 16 * 6.283) * rad; if (x >= 0 && y >= 0 && x + fp[0] <= nx && y + fp[1] <= ny && !hit(x, y)) { best = [x, y]; found = true; } } if (found) break; }
        const sp = spec.sprite ? lib.sprites[spec.sprite] : null;
        if (sp) { doc.sprites = doc.sprites || {}; doc.sprites[spec.sprite] = sp; }
        newId = E.add(S.room, { type: spec.type, cell: best, footprint: fp, props: spec.props, hot: spec.hot, look: spec.look });
        return true;
      });
      if (newId) { S.sel = { kind: 'obj', id: newId }; setTab('insp'); render(); }
    }

    /* ---------- an image on its way into the library ---------- */
    function pickFile(then) { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => { if (i.files[0]) then(i.files[0]); }; i.click(); }
    async function importDialog(file, useAfter) {
      const dlg = $('dlg');
      let src;
      try { src = await NutImporter.decode(file); } catch (e) { alert(e.message); return; }
      const palette = Object.values(BASE_PAL).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase());
      const o = selObj(), w = S.sel && S.sel.kind === 'wall';
      let res = null, lock = true, kind = 'object';
      const nm = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24) || 'image';
      dlg.innerHTML = `<h2>Add an image to the library</h2><div class="pv"><div><div class="note">your picture, in the game's colours</div><canvas id="ivA"></canvas></div></div><ul class="w" id="ivN"></ul>
        <div class="row"><label>name</label><input type="text" id="ivName" value="${esc(nm)}"><label><input type="checkbox" id="ivLock" checked> lock colours to the game palette</label></div>
        <div class="row"><label>this is</label><label><input type="radio" name="ivKind" value="object" checked> an object</label><label><input type="radio" name="ivKind" value="tile"> a floor or wall tile (repeats)</label></div>
        <div class="row"><label>footprint</label><input type="number" step="0.25" min="0.25" id="ivW"><input type="number" step="0.25" min="0.25" id="ivD"><label>anchor</label><input type="number" id="ivAx"><input type="number" id="ivAy"><label><input type="checkbox" id="ivOut"> has its own outline</label></div>
        <div class="note" id="ivHelp"></div>
        <div class="row" id="ivAck" hidden><label><input type="checkbox" id="ivOk"> I have read the warnings: add it anyway</label></div>
        <div class="foot"><button id="ivCancel">Cancel</button><button id="ivAdd" class="primary">Add to library</button>${o || w ? '<button id="ivUse" class="primary">Add and use</button>' : ''}</div>`;
      const draw = () => {
        const cv = $('ivA'), k = Math.max(1, Math.floor(260 / Math.max(res.w, res.h))); cv.width = res.w * k; cv.height = res.h * k;
        const t = document.createElement('canvas'); t.width = res.w; t.height = res.h; t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.rgba), res.w, res.h), 0, 0);
        const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(t, 0, 0, cv.width, cv.height);
        if (kind === 'tile') {   // the tile repeated 3 x 3
          cv.width = res.w * 3 * k; cv.height = res.h * 3 * k; const x2 = cv.getContext('2d'); x2.imageSmoothingEnabled = false;
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) x2.drawImage(t, i * res.w * k, j * res.h * k, res.w * k, res.h * k);
        }
        const fw = Number($('ivW').value) || 1, fd = Number($('ivD').value) || 1, ax = Number($('ivAx').value), ay = Number($('ivAy').value);
        if (kind === 'tile') { $('ivN').innerHTML = res.notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join(''); const warnT = res.notes.some((n) => n.level === 'warn'); $('ivAck').hidden = !warnT; $('ivAdd').disabled = !res.ok || (warnT && !$('ivOk').checked); if ($('ivUse')) $('ivUse').hidden = true; return; }
        if ($('ivUse')) $('ivUse').hidden = false;
        x.strokeStyle = '#7bd88f'; x.lineWidth = 2; x.beginPath();   // the footprint's diamond around the anchor
        const hw = HW * k, hh = HH * k, c = [ax * k, ay * k], pts = [[c[0] + (fd - fw) / 2 * hw, c[1] - (fw + fd) / 2 * hh], [c[0] + (fw + fd) / 2 * hw, c[1] + (fw - fd) / 2 * hh], [c[0] + (fw - fd) / 2 * hw, c[1] + (fw + fd) / 2 * hh], [c[0] - (fw + fd) / 2 * hw, c[1] + (fd - fw) / 2 * hh]];
        pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.stroke(); x.beginPath(); x.arc(c[0], c[1], 3, 0, 7); x.stroke();
        $('ivN').innerHTML = res.notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join('');
        const warn = res.notes.some((n) => n.level === 'warn');
        $('ivAck').hidden = !warn; $('ivAdd').disabled = !res.ok || (warn && !$('ivOk').checked); if ($('ivUse')) $('ivUse').disabled = $('ivAdd').disabled;
      };
      const run = (keep) => {
        res = NutImporter.process(src.rgba, src.w, src.h, { palette: lock ? palette : null, tile: kind === 'tile' });
        $('ivHelp').textContent = kind === 'tile' ? 'A tile repeats across the floor (the footprint is how many tiles of floor one picture covers) or along a wall (1 picture pixel = 1 screen pixel). It must be solid, 64 x 64 or less.' : 'The anchor is the floor point under the middle of the footprint (the green mark). Move it until the object stands where its diamond is.';
        for (const i of ['ivAx', 'ivAy', 'ivOut']) $(i).disabled = kind === 'tile';
        if (!res.ok) { $('ivN').innerHTML = res.notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join(''); $('ivAdd').disabled = true; if ($('ivUse')) $('ivUse').disabled = true; $('ivA').width = 1; return; }
        if (!keep) { $('ivW').value = res.defaults.fp[0]; $('ivD').value = res.defaults.fp[1]; $('ivAx').value = res.defaults.ax; $('ivAy').value = res.defaults.ay; }
        draw();
      };
      dlg.showModal(); run(false);
      $('ivLock').onchange = () => { lock = $('ivLock').checked; run(true); };
      for (const r of dlg.querySelectorAll('input[name=ivKind]')) r.onchange = () => { kind = r.value; run(false); };
      for (const i of ['ivW', 'ivD', 'ivAx', 'ivAy', 'ivOk']) $(i).oninput = () => res && res.ok && draw();
      $('ivCancel').onclick = () => dlg.close();
      const add = (use) => {
        const name = $('ivName').value.trim() || nm; let id = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase(), n = 1; while (lib.sprites[id]) id = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '-' + (++n);
        let spec;
        try { spec = NUT_SPRITES.fromRGBA(res.rgba, res.w, res.h, kind === 'tile' ? { name, ax: 0, ay: 0, fp: [Number($('ivW').value) || 1, Number($('ivD').value) || 1], tile: true, outline: false, tags: ['uploaded', 'tile'], ...(lock ? {} : { offPalette: true }) } : { name, ax: Number($('ivAx').value), ay: Number($('ivAy').value), fp: [Number($('ivW').value) || 1, Number($('ivD').value) || 1], outline: !$('ivOut').checked, tags: ['uploaded'], ...(lock ? {} : { offPalette: true }) }); } catch (e) { alert(e.message); return; }
        lib.sprites[id] = spec; NUT_SPRITES.add({ [id]: spec }); NutStore.saveLibrary(lib); libSync(id, spec);
        dlg.close(); delete thumbCache['s:' + id + spec.px.length];
        if (use && kind !== 'tile') useSprite(id); else { S.libKind = 'sprites'; setTab('lib'); }
        renderLib();
      };
      $('ivAdd').onclick = () => add(false); if ($('ivUse')) $('ivUse').onclick = () => add(true);
    }

    /* ---------- checks, versions, publishing ---------- */
    function allChecks() {
      const list = [];
      for (const id of ids) { const r = resolveRoom(ROOMS[id], []); for (const w of NUT_LAYOUT.validate(r)) list.push(`${id}: ${w.msg}`); }
      for (const w of NUT_LAYOUT.validateMoments(ROOMS, CASE)) list.push(`moment ${w.moment}: ${w.msg}`);
      return list;
    }
    function renderChecks(c) {
      const el = $('p-chk'), rep = NUT_LAYOUT.report;
      const mom = c.mom.filter((w) => w.moment === S.moment || true);
      const items = c.warns.map((w) => w.msg).concat(mom.map((w) => `moment ${w.moment}: ${w.msg}`));
      let h = `<h3>This room</h3>${items.length ? '<ul class="w">' + items.map((m) => `<li class="warn">${esc(m)}</li>`).join('') + '</ul>' : '<ul class="w"><li class="ok">no warnings</li></ul>'}`;
      h += `<h3>Against rooms.js</h3><div class="note">${rep.conflicts.length + rep.dropped.length + rep.unplaced.length ? `Drift: conflicts ${rep.conflicts.length}${rep.conflicts.length ? ' (' + esc(rep.conflicts.join(', ')) + ')' : ''}, unplaced ${rep.unplaced.length}, dropped ${rep.dropped.length}. Run <code>node tools/layout-export.mjs ${esc(slug)} --rebase</code> in the game repo to bring the layout up to date.` : 'The layout and rooms.js agree.'}</div>`;
      h += '<h3>Not covered yet</h3><div class="note">Placement checks for a blocked path between rooms, an object hiding a clue, and per-time overrides arrive with the next step.</div>';
      el.innerHTML = h;
    }
    function renderHist() {
      const el = $('p-hist');
      if (online) {
        el.innerHTML = '<p class="note">Loading&hellip;</p>';
        server('GET', 'layout/' + slug).then((l) => {
          const rows = l.versions;
          el.innerHTML = (rows.length ? '<table>' + rows.map((x) => `<tr><td>${new Date(x.created_at).toLocaleString()}</td><td><span class="badge ${x.status === 'published' ? 'pub' : 'draft'}">${x.status}</span></td><td>${esc(x.author)}${x.label ? ' &middot; ' + esc(x.label) : ''}</td><td><button data-id="${x.id}">Restore</button></td></tr>`).join('') + '</table>' : '<p class="note">Nothing saved on the server yet.</p>') + '<p class="note">Every publish is kept; drafts keep the last 25. Restoring puts that version in the editor as a draft (Undo brings the current one back).</p>';
          for (const b of el.querySelectorAll('[data-id]')) b.onclick = () => server('GET', 'layout/' + slug + '/version/' + b.dataset.id).then((v) => { if (confirm('Replace the current layout with this version?')) { undo.push(key()); redo = []; doc = clone(v.doc); afterChange(); } }).catch((e) => alert('Could not load it: ' + e.message));
        }).catch((e) => { if (e.message !== 'signed out') el.innerHTML = `<p class="note">The server did not answer (${esc(e.message)}).</p>`; });
        return;
      }
      const v = NutStore.versions(slug);
      el.innerHTML = `<div class="row"><input type="text" id="vLabel" placeholder="label (optional)"><button id="vSave">Save a version</button></div>` + (v.length ? '<table>' + v.map((x, i) => `<tr><td>${new Date(x.t).toLocaleString()}</td><td>${esc(x.label || '')}</td><td><button data-r="${i}">Restore</button></td></tr>`).join('') + '</table>' : '<p class="note">No saved versions. Publishing saves one; so does the button above.</p>') + '<p class="note">Versions are kept in this browser (the last 20). Without a publishing server this is all there is.</p>';
      $('vSave').onclick = () => { NutStore.addVersion(slug, $('vLabel').value || 'saved by hand', fileDoc()); renderHist(); };
      for (const b of el.querySelectorAll('[data-r]')) b.onclick = () => { if (confirm('Replace the current layout with this version? (Undo brings the current one back.)')) { undo.push(key()); redo = []; doc = clone(v[Number(b.dataset.r)].doc); afterChange(); } };
    }
    const changeCount = () => { let n = 0; for (const R of Object.values(doc.rooms)) for (const t of Object.values(R.times || {})) n += (t.objects || []).length + (t.items || []).length + (t.added || []).length; for (const R of Object.values(doc.rooms)) for (const r of [].concat(R.objects || [], R.items || [], R.wall || [])) { if (r.base === undefined || r.deleted || r.look || NUT_LAYOUT.fp(NUT_LAYOUT.core(r)) !== r.base) n++; } return n; };
    publish = async function () {
      saveDraft();
      const list = allChecks(), n = changeCount(), dlg = $('dlg'), api = online;
      dlg.innerHTML = `<h2>Publish ${esc(entry.title)}</h2><p>${n} changed record${n === 1 ? '' : 's'} against rooms.js. ${api ? 'Players see this layout as soon as it is published (the page they already have open updates when they reload).' : 'The game shows the layout once it is published.'}</p>
        ${list.length ? `<p><b>${list.length} warning${list.length === 1 ? '' : 's'}</b> (they do not stop publishing):</p><ul class="w">${list.map((m) => `<li class="warn">${esc(m)}</li>`).join('')}</ul>` : '<p class="note">No warnings in any room.</p>'}
        ${api ? '<div class="row"><label>note</label><input type="text" id="pLabel" placeholder="what changed (optional)" style="flex:1"></div><p class="note">Every published version is kept, so an earlier one can be put back from the Versions tab.</p>' : `<p class="note">This build has no publishing server (or it did not answer). "Publish" saves a version here and downloads <code>layout.json</code>; put it at <code>src/cases/${esc(slug)}/layout.json</code> in the game repo and deploy.</p>`}
        <div class="foot"><button id="pCancel">Cancel</button><button id="pGo" class="primary">${api ? 'Publish' : 'Save version and download'}</button></div>`;
      dlg.showModal();
      $('pCancel').onclick = () => dlg.close();
      $('pGo').onclick = async () => {
        if (api) {
          try { clearTimeout(srvT); await server('POST', 'layout/' + slug + '/publish', { doc: fileDoc(), label: $('pLabel').value || null }); savedAt = 'published ' + new Date().toLocaleTimeString(); }
          catch (e) { if (e.message !== 'signed out') alert('Publishing failed (' + e.message + '). Nothing changed online.'); return; }
        } else { NutStore.addVersion(slug, 'exported for publishing', fileDoc()); download('layout.json', NUT_LAYOUT.format(fileDoc())); savedAt = 'exported ' + new Date().toLocaleTimeString(); }
        dlg.close(); renderState(); renderHist();
      };
    };
    publishOther = async (other) => {
      if (online) {
        try {
          const l = await server('GET', 'layout/' + other), d = l.draft;
          if (!d || (l.published && l.published.id > d.id)) { alert('This case has no unpublished draft on the server: open it and make a change first.'); return; }
          if (confirm('Publish the saved draft of this case as it is? (Open the case to see the checks first.)')) { await server('POST', 'layout/' + other + '/publish', { doc: d.doc, label: 'published from the case list' }); alert('Published.'); }
        } catch (e) { if (e.message !== 'signed out') alert('Failed: ' + e.message); }
        return;
      }
      const d = NutStore.draft(other);
      if (!d) { alert('This case has no draft in this browser: open it and make a change first.'); return; }
      if (confirm('Download the draft layout of this case? (Open the case to see the checks before publishing.)')) download(`layout-${other}.json`, JSON.stringify(d, null, 1));
    };

    /* ---------- the toolbar ---------- */
    function setTab(t) { S.tab = t; for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.t === t); for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.id === 'p-' + t); if (t === 'lib') renderLib(); if (t === 'hist') renderHist(); if (t === 'room') renderRoomTab(); }
    for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.t);
    $('bUndo').onclick = doUndo; $('bRedo').onclick = doRedo;
    $('bRot').onclick = () => { const o = selObj(); if (o) mutate((E) => E.rotate(S.room, o.id)); };
    $('bDel').onclick = () => { const o = selObj(); if (o) { mutate((E) => E.remove(S.room, o.id)); S.sel = null; render(); } };
    $('bSave').onclick = () => { saveDraft(true); };
    $('bExport').onclick = () => download('layout.json', NUT_LAYOUT.format(fileDoc()));
    $('bPub').onclick = () => publish();
    const game = (room) => { if (!entry.published) { alert('This case has no game page yet (it is not in index.json). Preview works once it is added.'); return; } saveDraft(); window.open(`../${slug}/?layout=draft${room ? '&room=' + encodeURIComponent(S.room) : ''}`, '_blank'); };
    $('bPrev').onclick = () => game(false); $('bPlay').onclick = () => game(true);
    $('room').onchange = () => { S.room = $('room').value; S.sel = null; render(); };
    $('moment').onchange = () => { S.moment = $('moment').value; render(); };
    $('onlyM').onchange = () => { S.only = $('onlyM').checked; render(); };
    $('time').onchange = () => { S.time = $('time').value; render(); };
    $('snap').onchange = () => { S.snap = Number($('snap').value); };
    for (const id of ['lamp', 'oGrid', 'oFoot', 'oNum', 'oItems']) $(id).onchange = () => render(false);
    $('scale').onchange = () => { sizeStage(); render(false); };
    for (const id of ['rOp', 'rSc', 'rX', 'rY']) $(id).oninput = () => { drawRef(); cRoom.style.opacity = Number($('rOp').value) / 100; };
    $('ref').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const img = new Image(); img.onload = () => { refImg = img; if ($('rOp').value === '100') $('rOp').value = 60; drawRef(); cRoom.style.opacity = Number($('rOp').value) / 100; }; img.src = URL.createObjectURL(f); };
    $('rClear').onclick = () => { refImg = null; $('ref').value = ''; $('rOp').value = 100; drawRef(); cRoom.style.opacity = 1; };
    window.addEventListener('keydown', (e) => {
      const ae = document.activeElement; if ((ae && /^(SELECT|TEXTAREA)$/.test(ae.tagName)) || (ae && ae.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(ae.type)) || $('dlg').open) return;   // typing in a box is not a shortcut; a ticked box is not typing
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(); }
      else if (e.key === 'Escape') { S.sel = null; render(); }
      else if (!S.sel) return;
      else if (e.key.toLowerCase() === 'r' && !mod) { const o = selObj(); if (o) mutate((E) => E.rotate(S.room, o.id)); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { const o = selObj(); if (o) { e.preventDefault(); mutate((E) => E.remove(S.room, o.id)); S.sel = null; render(); } }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const k = e.shiftKey ? 0.05 : 0.25, dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0, dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0, o = selObj();
        // the arrows move on the screen: right/down = +x/+y of the room's isometric axes
        if (o) { const c = momentMode() ? o : (baseObj(o.id) || o); mutate((E) => E.move(S.room, o.id, [c.x + (dx + dy) * k, c.y + (dy - dx) * k], 0.05)); }
      }
    });
    window.addEventListener('beforeunload', () => { if (saveT || srvT) { saveDraft(); if (online) { clearTimeout(srvT); pushDraft('', true); } } });
    sizeStage(); render(); renderLib();
    window.NUT_EDITOR_API = { get doc() { return doc; }, S, mutate, render, pick, get geo() { return geo; }, get cur() { return cur; }, importDialog, lib, ed };
  }
})();
