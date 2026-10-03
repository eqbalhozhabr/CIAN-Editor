/* editor.js : the layout editor page (phase 1: a viewer). Draws a room with the engine, lays the debug overlay over it,
   lists what stands where and what the checks say. One case per page load: a case's script defines globals (CASE, ROOMS ...). */
(function () {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const ASSETS = '../assets/';
  const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.appendChild(s); });
  // the game publishes assets/editor-manifest.json (which cases exist, and the cache-busting hash of each script)
  fetch(ASSETS + 'editor-manifest.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('assets/editor-manifest.json: ' + r.status); return r.json(); }).then(async (man) => {
    const CASES = man.cases, entry = CASES.find((c) => c.slug === q.get('case')) || CASES[0], sel = $('case');
    for (const c of CASES) sel.add(new Option(c.title + '  (' + c.slug + ')', c.slug, false, c === entry));
    sel.onchange = () => { location.search = '?case=' + sel.value; };
    if (!entry) { $('stage').outerHTML = '<p id="empty">No cases in this build.</p>'; return; }
    await loadScript(ASSETS + man.engine.file + '?v=' + man.engine.v);
    await loadScript(ASSETS + entry.file + '?v=' + entry.v);
    start(entry);
  }).catch((e) => { $('checks').textContent = String(e.message || e); });

  function start(entry) {
    const ids = Object.keys(ROOMS), sceneId = CASE.sceneRoom || 'bedroom';
    const roomSel = $('room'), momSel = $('moment');
    for (const id of ids) roomSel.add(new Option(id, id));
    roomSel.value = ids.includes(q.get('room')) ? q.get('room') : (ids.includes(sceneId) ? sceneId : ids[0]);
    for (const m of CASE.moments || []) momSel.add(new Option(m.id + (m.time ? '  ' + m.time : ''), m.id));
    if (q.get('moment')) momSel.value = q.get('moment');
    let highlight = null, hover = 0, geo = null, scale = 5;
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const cRef = $('cRef'), cRoom = $('cRoom'), cOver = $('cOver'), tip = $('tip');
    let refImg = null;

    function resolved() {
      const base = ROOMS[roomSel.value], isScene = roomSel.value === sceneId;
      $('momentL').hidden = !isScene || !(CASE.moments || []).length;
      const m = isScene ? (CASE.moments || []).find((x) => x.id === momSel.value) : null;
      return { base, r: resolveRoom(base, m ? m.patches || [] : []) };
    }
    function sizeStage() {
      scale = Number($('scale').value);
      for (const c of [cRef, cRoom, cOver]) { c.width = W * scale; c.height = H * scale; }
      $('size').style.width = W * scale + 'px'; $('size').style.height = H * scale + 'px';
    }
    function drawRef() {
      const x = cRef.getContext('2d'); x.clearRect(0, 0, cRef.width, cRef.height);
      if (!refImg) return;
      const k = Number($('rSc').value) / 100 * scale / 2, w = refImg.width * k, h = refImg.height * k;
      x.drawImage(refImg, (cRef.width - w) / 2 + Number($('rX').value), (cRef.height - h) / 2 + Number($('rY').value), w, h);
    }
    function drawRoom(base, r) {
      compose(base.light({ lampT: $('lamp').checked ? 1 : 0 }, 0, r), hover, 0);
      off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.buffer.slice(0)), W, H), 0, 0);
      const x = cRoom.getContext('2d'); x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, cRoom.width, cRoom.height); x.drawImage(off, 0, 0, cRoom.width, cRoom.height);
      cRoom.style.opacity = Number($('rOp').value) / 100;
    }
    function drawOver(r, warns) {
      geo = NUT_LAYOUT.geometry(r, warns.flatMap((w) => w.ids));
      const ov = NUT_LAYOUT.rasterOverlay(geo, scale, { grid: $('oGrid').checked, foot: $('oFoot').checked, labels: $('oNum').checked, items: $('oItems').checked, highlight });
      cOver.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(ov.buf.buffer), ov.w, ov.h), 0, 0);
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function panels(r, warns) {
      const momW = roomSel.value === sceneId ? NUT_LAYOUT.validateMoments(ROOMS, CASE).filter((w) => !warns.some((b) => b.code === w.code && b.msg === w.msg)) : [];
      const all = warns.map((w) => ({ msg: w.msg })).concat(momW.filter((w) => w.moment !== (momSel.value || '')).map((w) => ({ msg: 'moment ' + w.moment + ': ' + w.msg })));
      $('checks').innerHTML = all.length ? '<ul>' + all.map((w) => '<li class="warn">' + esc(w.msg) + '</li>').join('') + '</ul>' : '<ul><li class="ok">no warnings in this room</li></ul>';
      const row = (o, extra) => '<tr class="row' + (o.id === highlight ? ' on' : '') + (o.bad ? ' bad' : '') + '" data-id="' + esc(o.id) + '">' + extra + '</tr>';
      $('objs').innerHTML = '<tr><th></th><th>id</th><th></th><th>cell</th><th>size</th></tr>' + geo.objs.map((o) => row(o,
        '<td class="num">' + (o.cls === 'flat' ? '' : o.idx) + '</td><td class="id">' + esc(o.id) + '</td><td><span class="badge ' + o.cls + '" title="' + esc(o.why.join(', ')) + '">' + o.cls + '</span></td><td>' + o.cell.map((v) => +v.toFixed(2)).join(', ') + '</td><td>' + o.footprint.map((v) => +v.toFixed(2)).join(' x ') + '</td>')).join('');
      $('items').innerHTML = geo.items.length ? '<tr><th>id</th><th>on</th><th></th></tr>' + geo.items.map((o) => row(o,
        '<td class="id">' + esc(o.id) + '</td><td>' + esc(o.host || '-') + '</td><td><span class="badge ' + o.cls + '" title="' + esc(o.why.join(', ')) + '">' + o.cls + '</span></td>')).join('') : '<tr><td class="note">none</td></tr>';
      for (const tr of document.querySelectorAll('tr.row')) tr.onclick = () => { highlight = highlight === tr.dataset.id ? null : tr.dataset.id; draw(); };
      const rep = NUT_LAYOUT.report, n = NUT_LAYOUT.state.rooms;
      $('status').textContent = n ? 'layout.json loaded: ' + n + ' rooms. Drift from rooms.js: ' + (rep.conflicts.length + rep.dropped.length + rep.unplaced.length) + ' (conflicts ' + rep.conflicts.length + ', dropped ' + rep.dropped.length + ', unplaced ' + rep.unplaced.length + ').' : 'This case has no layout.json: placement comes straight from rooms.js.';
    }
    function draw() {
      const { base, r } = resolved();
      renderRoom(r, { variant: 0, lampT: $('lamp').checked ? 1 : 0, flags: {} });
      const warns = NUT_LAYOUT.validate(r);
      drawRoom(base, r); drawOver(r, warns); drawRef(); panels(r, warns);
      const u = new URLSearchParams({ case: entry.slug, room: roomSel.value }); if (!$('momentL').hidden) u.set('moment', momSel.value);
      history.replaceState(null, '', '?' + u);
    }
    // pointing at the picture names the tappable thing under the pointer and outlines it, as the game does
    $('stage').onpointermove = (e) => {
      const b = cOver.getBoundingClientRect(), x = Math.floor((e.clientX - b.left) / scale), y = Math.floor((e.clientY - b.top) / scale);
      const h = x >= 0 && y >= 0 && x < W && y < H ? hotIdx[y * W + x] : 0;
      if (h !== hover) { hover = h; const { base, r } = resolved(); drawRoom(base, r); }
      tip.style.display = h ? 'block' : 'none';
      if (h) { tip.textContent = HOTS[h]; tip.style.left = e.clientX - b.left + 12 + 'px'; tip.style.top = e.clientY - b.top + 12 + 'px'; }
    };
    $('stage').onpointerleave = () => { tip.style.display = 'none'; if (hover) { hover = 0; const { base, r } = resolved(); drawRoom(base, r); } };
    for (const id of ['room', 'moment', 'lamp', 'oGrid', 'oFoot', 'oNum', 'oItems', 'rOp', 'rSc', 'rX', 'rY']) $(id).oninput = () => { if (id === 'room') highlight = null; if (id === 'rOp' || id === 'rSc' || id === 'rX' || id === 'rY') { drawRef(); cRoom.style.opacity = Number($('rOp').value) / 100; return; } draw(); };
    $('scale').onchange = () => { sizeStage(); draw(); };
    $('ref').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image(); img.onload = () => { refImg = img; if ($('rOp').value === '100') $('rOp').value = 60; draw(); };
      img.src = URL.createObjectURL(f);
    };
    $('rClear').onclick = () => { refImg = null; $('ref').value = ''; $('rOp').value = 100; draw(); };
    sizeStage(); draw();
  }
})();
