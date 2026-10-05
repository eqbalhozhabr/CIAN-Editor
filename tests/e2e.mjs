// node tests/e2e.mjs  ->  the editor in a real browser (assembles the game and this page first).
// Every case opens without errors; then, on one case: pick, drag, undo, rotate, delete, the library, a new image through the pixel-art check,
// a sprite in place of a code-drawn look, the draft, play from here in the game, publish. Screenshots go to out/shots/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const load = () => {
  for (const p of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright']) { if (!p) continue; try { return require(p); } catch (e) { /* next */ } }
  throw new Error('playwright not found: npm i -D playwright, or set PLAYWRIGHT_PATH');
};
const { chromium } = load();
fs.mkdirSync('out/shots', { recursive: true });
if (!process.env.NO_ASSEMBLE && !process.env.SITE_ROOT) execSync('node scripts/assemble.mjs', { stdio: 'inherit', env: { ...process.env, WITH_ARCHIVE: process.env.WITH_ARCHIVE ?? '1' } });   // the tests open monday-nine and others: the game's archived cases are built too (it ships only its current case)
const BASE = '/case-in-a-nutshell/', ROOT = path.resolve(process.env.SITE_ROOT || 'out/site');   // SITE_ROOT: a folder laid out like the site's public/case-in-a-nutshell/ (with editor/ in it)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {   // the assembled folder, mounted under /case-in-a-nutshell/ like the studio site does
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, p.slice(BASE.length));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const URL0 = `http://127.0.0.1:${server.address().port}${BASE}`;
const png = (w, h, fn) => {   // a PNG from a pixel function
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
// a pixel-art tree, 12 x 16 real pixels, drawn 4 times larger on a flat white background (an "enlarged" image the pipeline must take apart)
fs.writeFileSync('out/shots/tree.png', png(48, 64, (x, y) => { const px = x >> 2, py = y >> 2, dx = px - 6, dy = py - 5; if (dx * dx + dy * dy <= 20) return (px + py) % 3 ? [0x4f, 0x9a, 0x5b, 255] : [0x7c, 0xc0, 0x7a, 255]; if (px >= 5 && px <= 6 && py >= 9 && py <= 14) return [0x6b, 0x4a, 0x3a, 255]; return [255, 255, 255, 255]; }));
// a picture in colours the game does not use, on a transparent background
fs.writeFileSync('out/shots/tile.png', png(16, 16, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [0x8b, 0x5a, 0x3b, 255] : [0xb9, 0x80, 0x4d, 255]));
fs.writeFileSync('out/shots/off.png', png(30, 30, (x, y) => ((x - 15) ** 2 + (y - 15) ** 2 < 100 ? [255, 0, 255, 255] : [0, 0, 0, 0])));

const browser = await chromium.launch();
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { failed++; console.log('  FAIL', msg); } };
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, fs.existsSync(path.join(ROOT, 'editor/assets/editor-manifest.json')) ? 'editor/assets/editor-manifest.json' : 'assets/editor-manifest.json'), 'utf8'));
const open = async (ctx, url) => {
  const pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|ERR_NAME|ERR_CONNECTION|ERR_TUNNEL|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  pg.on('dialog', (d) => d.accept());
  await pg.goto(url); pg.errors = errors; return pg;
};
const painted = (pg, id) => pg.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) n++; return n; }, id);

console.log('every case opens');
for (const c of manifest.cases) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), pg = await open(ctx, `${URL0}editor/?case=${c.slug}`);
  await pg.waitForSelector('#p-insp table tr');
  ok((await painted(pg, 'cRoom')) > 5000 && (await painted(pg, 'cOver')) > 500, `${c.slug}: room and overlay are drawn (${c.rooms.length} rooms)`);
  ok((await pg.$$('#cases .case')).length === manifest.cases.length, `${c.slug}: the list shows all ${manifest.cases.length} cases`);
  for (const r of c.rooms) { await pg.selectOption('#room', r); await pg.waitForTimeout(30); }
  if (c.moments.length > 1) for (const m of c.moments) { await pg.selectOption('#room', c.scene); await pg.selectOption('#moment', m.id); }
  ok(!pg.errors.length, `${c.slug}: no page errors ${pg.errors.join(' | ')}`);
  await ctx.close();
}

console.log('editing (monday-nine)');
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }), pg = await open(ctx, `${URL0}editor/?case=monday-nine&room=living`);
await pg.waitForSelector('#p-insp table tr');
const API = (fn, ...a) => pg.evaluate(([f, args]) => new Function('A', 'args', 'return (' + f + ')(A, args)')(window.NUT_EDITOR_API, args), [fn.toString(), a]);
const screenOf = (id) => API((A, [id]) => { const o = A.geo.objs.find((q) => q.id === id), b = document.getElementById('cOver').getBoundingClientRect(), s = A.S.scale; return { x: b.left + o.center[0] * s, y: b.top + (o.center[1] - 6) * s }; }, id);
const screenHot = (name) => API((A, [n]) => { const h = HOTLIST.find((q) => q.name === n), b = document.getElementById('cOver').getBoundingClientRect(), s = A.S.scale; return { x: b.left + (h.x + 0.5) * s, y: b.top + (h.y + 0.5) * s }; }, name);
const cellOf = (id) => API((A, [id]) => { const o = A.cur.r.objects.find((q) => q.id === id); return [o.x, o.y]; }, id);
const count = () => API((A) => A.cur.r.objects.length);

let t = await screenHot('table');
await pg.mouse.click(t.x, t.y);
ok((await pg.innerText('#p-insp')).includes('table'), 'clicking an object selects it and the Selected tab names it');
const c0 = await cellOf('table');
await pg.mouse.move(t.x, t.y); await pg.mouse.down(); await pg.mouse.move(t.x + 60, t.y + 12, { steps: 6 }); await pg.mouse.up();
const c1 = await cellOf('table');
ok(c1[0] !== c0[0] || c1[1] !== c0[1], `dragging moves it (${c0} -> ${c1})`);
ok(c1.every((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-6), 'and it snaps to quarter tiles');
const cupAfter = await API((A) => { const i = A.cur.r.items.find((q) => q.id === 'cup'), h = A.cur.r.objects.find((q) => q.id === 'table'); return [i.x - h.x, i.y - h.y]; });
ok(Math.abs(cupAfter[0] - 0.3) < 0.011 && Math.abs(cupAfter[1] - 0.65) < 0.011, 'the cup on the table moved with it');
await pg.keyboard.press('Control+z');
const c2 = await cellOf('table');
ok(c2[0] === c0[0] && c2[1] === c0[1], 'Ctrl+Z puts it back');
await pg.keyboard.press('Control+y');
const c3 = await cellOf('table'); ok(c3[0] === c1[0] && c3[1] === c1[1], 'Ctrl+Y does it again');
await pg.keyboard.press('Control+z');

const tvId = await API((A) => A.cur.r.objects.find((o) => o.hot === 'tvunit').id);
t = await screenHot('tvunit'); await pg.mouse.click(t.x, t.y);
ok((await pg.innerText('#p-insp')).includes('locked') && await pg.isDisabled('#bDel'), 'a locked object: Delete is disabled');
const nTv = await count(); ok(!(await API((A, [id]) => A.ed().remove('living', id), tvId)) && (await count()) === nTv, 'and the engine refuses it too');

const sofa = await screenHot('sofa'); await pg.mouse.click(sofa.x, sofa.y);
const fp0 = await API((A) => { const o = A.cur.r.objects.find((q) => q.id === 'sofa2'); return [o.w, o.d]; });
await pg.keyboard.press('r');
const fp1 = await API((A) => { const o = A.cur.r.objects.find((q) => q.id === 'sofa2'); return [o.w, o.d, o.face]; });
ok(fp1[0] === fp0[1] && fp1[1] === fp0[0] && fp1[2] === 'x', 'R turns it (footprint swaps, facing changes)');
await pg.keyboard.press('Control+z');
const n0 = await count(); const pl = await screenOf('plant10'); await pg.mouse.click(pl.x, pl.y + 6 * 5); await pg.keyboard.press('Delete');
ok((await count()) === n0 - 1, 'Delete takes a free object out'); await pg.keyboard.press('Control+z'); ok((await count()) === n0, 'and Undo brings it back');
await pg.screenshot({ path: 'out/shots/editor-living.png' });

await pg.click('.tabs button[data-t=lib]');
ok((await pg.$$('#libGrid .card')).length === Object.keys(manifest.catalog.types).length, `the library lists all ${Object.keys(manifest.catalog.types).length} objects the code draws`);
await pg.fill('#libQ', 'bookshelf'); await pg.click('#libGrid .card >> text=Add'); await pg.click('.tabs button[data-t=lib]');
ok((await count()) === n0 + 1, 'Add puts a new object in the room');
await pg.keyboard.press('Control+z'); ok((await count()) === n0, 'and it can be undone');
await pg.click('.tabs button[data-t=lib]'); const p5 = await screenOf('plant5'); await pg.mouse.click(p5.x, p5.y); await pg.fill('#libQ', 'tree');
await pg.click('#libGrid .card:has-text("tree") >> text=Use');
ok(await API((A) => A.cur.r.objects.find((o) => o.id === 'plant5').t === 'tree'), 'a free object takes another library look');

await pg.selectOption('#libK', 'sprites');
const chooser = pg.waitForEvent('filechooser'); await pg.click('#libUp'); await (await chooser).setFiles('out/shots/tree.png');
await pg.waitForSelector('#dlg[open]');
const notes = await pg.innerText('#ivN');
ok(/Enlarged pixel art found \(4x\)/.test(notes) && /12 x 16/.test(notes) && /background was one flat colour/.test(notes), 'the pipeline finds the 4x pixel grid and the flat background');
ok(/Colours locked to the game palette/.test(notes), 'and locks the colours to the game palette');
await pg.fill('#ivName', 'my tree'); await pg.click('#ivAdd');
ok((await pg.$$('#libGrid .card')).length === 1, 'the image is in the library as a sprite');
ok(await API((A) => Object.keys(A.lib.sprites).length === 1), 'and stored (this browser)');
await pg.mouse.click(p5.x, p5.y); await pg.click('#libGrid .card >> text=Use');
const sp = await API((A) => { const o = A.cur.r.objects.find((q) => q.id === 'plant5'); return { t: o.t, hot: o.hot, sprite: o.sprite }; });
ok(sp.t === 'sprite' && sp.hot === 'plant' && sp.sprite === 'my-tree', 'the object is drawn from the sprite and stays tappable under its name');
await pg.screenshot({ path: 'out/shots/editor-sprite.png' });
const chooser2 = pg.waitForEvent('filechooser'); await pg.click('#libUp'); await (await chooser2).setFiles('out/shots/off.png');
await pg.waitForSelector('#dlg[open]'); await pg.uncheck('#ivLock');
ok(/not locked to the game palette/.test(await pg.innerText('#ivN')) && await pg.isDisabled('#ivAdd') && await pg.isVisible('#ivAck'), 'an image kept off the game palette needs an explicit OK');
await pg.click('#ivCancel');

// a window dragged across the corner to the other wall
const winPt = (side, u, z) => API((A, [side, u, z]) => { const p = side === 'R' ? P(u, 0, z) : P(0, u, z), b = document.getElementById('cOver').getBoundingClientRect(), s = A.S.scale; return { x: b.left + p[0] * s, y: b.top + p[1] * s }; }, side, u, z);
const wall0 = await API((A) => { const w = A.cur.r.walls({ variant: 0, lampT: 0, flags: {} }, A.cur.r); const it = w.L.items.find((i) => i.name === 'window'); return { u0: it.u0, u1: it.u1, z: (it.z0 + it.z1) / 2, nL: w.L.items.length, nR: w.R.items.length }; });
const docBefore = await API((A) => JSON.stringify(A.doc));
const from = await winPt('L', (wall0.u0 + wall0.u1) / 2, wall0.z), to = await winPt('R', 5, wall0.z);
await pg.mouse.move(from.x, from.y); await pg.mouse.down(); await pg.mouse.move((from.x + to.x) / 2, from.y, { steps: 5 }); await pg.mouse.move(to.x, to.y, { steps: 8 }); await pg.mouse.up();
const wall1 = await API((A) => { const w = A.cur.r.walls({ variant: 0, lampT: 0, flags: {} }, A.cur.r), rec = (A.doc.rooms.living.wall || []).find((r) => r.to); return { nL: w.L.items.length, nR: w.R.items.length, rec: rec && { key: rec.key, to: rec.to, span: rec.span } }; });
ok(wall1.nL === wall0.nL - 1 && wall1.nR === wall0.nR + 1 && wall1.rec && wall1.rec.to === 'R', `dragging a window across the corner puts it on the other wall (${wall1.rec && wall1.rec.span})`);
await pg.click('.tabs button[data-t=insp]');
ok(await API((A) => A.S.sel && A.S.sel.kind === 'wall') && /right/.test(await pg.innerText('#p-insp')) && /moved from the left wall/.test(await pg.innerText('#p-insp')), 'the inspector shows it on the right wall, moved from the left');
await pg.selectOption('#p-insp select[data-f=wside]', 'L');
ok(await API((A) => !(A.doc.rooms.living.wall || []).some((r) => r.to)), 'the wall chooser puts it back, and the file keeps no trace');
for (let i = 0; i < 5 && await API((A, [d]) => JSON.stringify(A.doc) !== d, docBefore); i++) await pg.keyboard.press('Control+z');   // back to exactly where the window started
ok(await API((A) => { const w = A.cur.r.walls({ variant: 0, lampT: 0, flags: {} }, A.cur.r); return w.L.items.length; }) === wall0.nL, 'Undo takes the moves back');
// the layout at one moment of the case
await pg.click('.tabs button[data-t=insp]');
await pg.selectOption('#moment', 'noor'); await pg.check('#onlyM');
const chair0 = await API((A) => { const o = ROOMS.living.objects.find((q) => q.id === 'chair1'); return [o.x, o.y]; });
await API((A) => { A.S.sel = { kind: 'obj', id: 'chair1' }; A.render(); });
await pg.keyboard.press('ArrowDown');
const chairNoor = await cellOf('chair1'), chairBase = await API((A) => { const o = ROOMS.living.objects.find((q) => q.id === 'chair1'); return [o.x, o.y]; });
ok(chairNoor[0] !== chair0[0] && chairBase.join() === chair0.join(), 'with "only this moment" a move changes that moment and leaves the shared layout alone');
ok(await API((A) => A.doc.rooms.living.times.noor.objects[0].id === 'chair1'), 'and is stored under the moment');
await pg.selectOption('#moment', 'scene'); ok((await cellOf('chair1')).join() === chair0.join(), 'at another moment the chair is where it was');
await pg.click('.tabs button[data-t=chk]'); ok(/what changed/.test(await pg.innerText('#p-chk')), 'the checks notice that the "what changed" puzzle now has another difference');
await pg.selectOption('#moment', 'noor'); await pg.click('.tabs button[data-t=insp]');
ok(/This moment has its own change/.test(await pg.innerText('#p-insp')), 'the inspector says this moment has its own change for it');
await pg.click('#p-insp button[data-a=takeback]'); ok(await API((A) => !A.doc.rooms.living.times), 'Take it back leaves no trace in the layout');
await pg.keyboard.press('ArrowDown'); await pg.uncheck('#onlyM'); await pg.keyboard.press('Control+z'); await pg.check('#onlyM'); await pg.keyboard.press('Control+z');
await pg.uncheck('#onlyM'); await pg.selectOption('#moment', 'sofia');
// the room itself: floor, walls, colours, and a tile picture of your own
await pg.click('.tabs button[data-t=room]');
const room0 = await API((A) => Array.from(out).filter((v, i) => i % 7 === 0).join(','));
await pg.selectOption('#p-room select[data-r=floor]', 'tiles');
ok(await API((A) => A.doc.rooms.living.room.floor === 'tiles') && (await API((A) => Array.from(out).filter((v, i) => i % 7 === 0).join(','))) !== room0, 'another floor: the room changes and the choice is in the layout');
await pg.selectOption('#p-room select[data-r=wallL]', 'brick');
ok(await API((A) => A.doc.rooms.living.room.wallL === 'brick'), 'another wall style');
await pg.$eval('#p-room input[data-c=floorA]', (e) => { e.value = '#00ff88'; e.dispatchEvent(new Event('change', { bubbles: true })); });
ok(await API((A) => A.doc.rooms.living.room.pal.floorA === '#00ff88') && (await pg.isVisible('#p-room button[data-cr=floorA]')), 'a colour changes and is marked');
await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z');
ok(await API((A) => !(A.doc.rooms.living && A.doc.rooms.living.room && A.doc.rooms.living.room.floor)), 'Undo takes the floor choice back');
// the size of the room
const nx0 = await API((A) => [A.cur.r.nx, A.cur.r.ny]), door0 = await API((A) => A.cur.r.walls({ variant: 0, lampT: 0, flags: {} }, A.cur.r).L.items.find((i) => i.name === 'door:lobby').u0);
await pg.fill('#szY', '6'); await pg.click('#p-room [data-a=size]');
const nx1 = await API((A) => [A.cur.r.nx, A.cur.r.ny]), door1 = await API((A) => A.cur.r.walls({ variant: 0, lampT: 0, flags: {} }, A.cur.r).L.items.find((i) => i.name === 'door:lobby').u0);
ok(nx0.join() === '8,8' && nx1.join() === '8,6' && Math.abs(door0 - door1 - 2) < 1e-9, 'Resize makes the room 8 x 6 and the door at the far end moves in with the wall');
ok(await API((A) => A.doc.rooms.living.room.size.join() === '8,6') && (await pg.innerText('#p-chk')) !== undefined, 'the size is in the layout');
await pg.fill('#szX', '14'); await pg.click('#p-room [data-a=size]');
ok((await pg.innerText('#szNote')).includes('does not fit') && (await API((A) => A.cur.r.nx)) === 8, 'a size that cannot fit the picture is refused with the reason');
await pg.keyboard.press('Control+z');
ok((await API((A) => [A.cur.r.nx, A.cur.r.ny])).join() === '8,8', 'Undo gives the room its size back');
await pg.click('.tabs button[data-t=lib]'); await pg.selectOption('#libK', 'sprites');
const chT = pg.waitForEvent('filechooser'); await pg.click('#libUp'); await (await chT).setFiles('out/shots/tile.png');
await pg.waitForSelector('#dlg[open]'); await pg.check('input[name=ivKind][value=tile]');
ok(/Colours locked/.test(await pg.innerText('#ivN')) && !(await pg.isDisabled('#ivAdd')), 'a floor tile goes through the same pixel-art check (no crop, no background)');
await pg.fill('#ivName', 'my floor'); await pg.click('#ivAdd');
await pg.fill('#libQ', ''); await pg.click('#libGrid .card:has-text("my floor") button:text-is("Floor")');
ok(await API((A) => A.doc.rooms.living.room.floor.sprite === 'my-floor' && !!A.doc.sprites['my-floor']), 'the tile becomes the floor of the room, and the layout carries the picture');
await pg.screenshot({ path: 'out/shots/editor-room.png' });
await pg.click('.tabs button[data-t=room]'); await pg.click('#p-room [data-a=resetroom]');
ok(await API((A) => !(A.doc.rooms.living.room)), 'one click takes the room back to what the kit built');
await pg.click('.tabs button[data-t=lib]'); await pg.fill('#libQ', ''); await pg.click('#libGrid .card:has-text("my floor") button:text-is("Floor")');
await pg.click('#bSave');
const draft = await pg.evaluate(() => JSON.parse(localStorage.getItem('nutshell.draft.monday-nine')));
ok(draft && draft.sprites && draft.sprites['my-tree'] && draft.sprites['my-floor'] && draft.rooms.living.objects.some((r) => r.look && r.look.sprite === 'my-tree') && draft.rooms.living.room.floor.sprite === 'my-floor', 'Save draft keeps the layout and the pictures it uses in this browser');
if (!process.env.NO_PLAY) {   // (the game that is already live does not know ?layout=draft yet)
  const popup = ctx.waitForEvent('page'); await pg.click('#bPlay'); const game = await popup;
  await game.waitForLoadState('load'); await game.waitForTimeout(800);
  const gs = await game.evaluate(() => ({ room: NUT.S.room, plant: ROOMS.living.objects.find((o) => o.id === 'plant5').t, floor: (NUT_LAYOUT.state.shipped, JSON.parse(localStorage.getItem('nutshell.draft.monday-nine')).rooms.living.room.floor.sprite) }));
  ok(gs.plant === 'sprite' && gs.room === 'living' && gs.floor === 'my-floor', 'Play from here opens the game in this room, drawing the draft (objects and the floor)');
  await game.close();
}
const dl = pg.waitForEvent('download'); await pg.click('#bPub'); await pg.waitForSelector('#dlg[open]'); await pg.click('#pGo');
let text = ''; for await (const ch of await (await dl).createReadStream()) text += ch;
let parsed = null; try { parsed = JSON.parse(text); } catch (e) { /* reported below */ }
ok(parsed && parsed.rooms && parsed.sprites && parsed.sprites['my-tree'], 'Publish writes a layout.json with the sprite inside it (no server is configured here)');
ok((await pg.innerText('#state')).includes('exported'), 'and the page says it was exported, not published');
await pg.click('.tabs button[data-t=hist]'); ok((await pg.$$('#p-hist table tr')).length >= 1, 'a version was saved');
ok(!pg.errors.length, `no page errors ${pg.errors.join(' | ')}`);

// the cast: one record per person, three views
if (manifest.cases.some((c) => c.slug === 'three-days-after')) {
  console.log('the cast (three-days-after)');
  const cctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), cp = await open(cctx, `${URL0}editor/?case=three-days-after&room=yard`);
  await cp.waitForSelector('#p-insp');
  const CA = (fn, ...a2) => cp.evaluate(([f, args]) => new Function('A', 'args', 'return (' + f + ')(A, args)')(window.NUT_EDITOR_API, args), [fn.toString(), a2]);
  await cp.click('.tabs button[data-t=cast]');
  const names = await cp.$$eval('#p-cast .pbtn', (b) => b.map((x) => x.dataset.cid));
  ok(['victim', 'emil', 'brenner', 'lukas', 'margit', 'constable', 'keeper'].every((n) => names.includes(n)), 'the Cast tab lists the suspects, the victim, the other people and the figures with no portrait of their own');
  await cp.click('[data-cid=brenner]');
  ok((await painted(cp, 'cpS')) > 0 && (await painted(cp, 'cpB')) > 0, 'the small and the big portrait are drawn');
  await cp.selectOption('#cLink', 'constable');
  ok(await CA((A) => A.doc.cast.brenner.npc === 'constable') && !(await cp.$$eval('#p-cast .pbtn', (b) => b.some((x) => x.dataset.cid === 'constable'))), 'Brenner is linked to the constable standing in the yard (no second person)');
  ok((await painted(cp, 'cpR')) > 0, 'and his figure in the rooms is drawn');
  const coat0 = await CA((A) => ROOMS.yard.objects.find((o) => o.hot === 'constable').look.coat);
  await cp.$eval('input[data-f=top]', (e) => { e.value = '#aa2222'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const got = await CA((A) => ({ coat: ROOMS.yard.objects.find((o) => o.hot === 'constable').look.coat, small: CASE.people.brenner.portrait.shirt, big: (CASE.people.brenner.portrait.__big || CASE.people.brenner.portrait).shirt, rec: A.doc.cast.brenner.fields.top }));
  ok(got.coat === '#aa2222' && got.small === '#aa2222' && got.big === '#aa2222' && got.rec === '#aa2222' && coat0 !== '#aa2222', 'one colour change reaches the figure in the room, the small portrait and the big one');
  await cp.click('[data-cv=room]');
  ok(await cp.$eval('input[data-f=skin]', (e) => e.disabled), 'a single view is read-only until Override is switched on');
  await cp.check('#cOv');
  ok(!(await cp.$eval('input[data-f=skin]', (e) => e.disabled)), 'Override unlocks it');
  await cp.check('[data-o=hat]');
  const ov = await CA((A) => ({ rec: A.doc.cast.brenner.views && A.doc.cast.brenner.views.room && A.doc.cast.brenner.views.room.hat, roomHat: ROOMS.yard.objects.find((o) => o.hot === 'constable').look.hat, smallHat: CASE.people.brenner.portrait.hat, bigHat: (CASE.people.brenner.portrait.__big || CASE.people.brenner.portrait).hat }));
  ok(ov.rec && ov.roomHat === ov.rec && !ov.smallHat && !ov.bigHat, 'an override changes the one view and the other two do not get it');
  ok(await cp.isVisible('[data-share=hat]'), 'and offers to share it with all views');
  await cp.click('[data-share=hat]');
  const sh = await CA((A) => ({ field: A.doc.cast.brenner.fields.hat, none: !(A.doc.cast.brenner.views && A.doc.cast.brenner.views.room && 'hat' in A.doc.cast.brenner.views.room), smallHat: CASE.people.brenner.portrait.hat }));
  ok(sh.field && sh.none && sh.smallHat === sh.field, 'sharing it gives the hat to every view');
  await cp.click('[data-cv=big]'); await cp.check('#cOv'); await cp.selectOption('#cpM', 'shaken');
  ok((await painted(cp, 'cpB')) > 0, 'a mood can be tried on the big portrait');
  await cp.click('[data-cv=all]');
  await cp.screenshot({ path: 'out/shots/editor-cast.png' });
  ok(/"cast": \{\n    "brenner": /.test(await CA((A) => NUT_LAYOUT.format(A.doc))), 'the layout file keeps the cast');
  await cp.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 12 && await CA((A) => !!A.doc.cast); i++) await cp.keyboard.press('Control+z');
  ok(await CA((A, a) => !A.doc.cast && ROOMS.yard.objects.find((o) => o.hot === 'constable').look.coat === a[0], coat0), 'Undo takes every change back, the figure included');
  // the pencil and the eraser
  console.log('drawing (the pencil and the eraser)');
  await cp.click('.tabs button[data-t=cast]'); await cp.click('[data-cid=emil]'); await cp.click('[data-cv=small]');
  ok(!(await cp.$('#pcv')), 'the drawing window needs Override first');
  await cp.check('#cOv');
  ok(await cp.isVisible('#pcv'), 'with Override on the person can be drawn on');
  const Z = 10, canvasPx = (sel, x, y) => cp.$eval(sel, (c, [x, y]) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
  const where = async (x, y) => { const b = await cp.locator('#pcv').boundingBox(); return [b.x + (x + 0.5) * Z, b.y + (y + 0.5) * Z]; };
  const sw = cp.locator('.swatches').nth(1).locator('[data-sw]').nth(3), colour = await sw.getAttribute('data-sw'), rgb = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  await sw.click();
  let a = await where(2, 2), b2 = await where(6, 2);
  await cp.mouse.move(...a); await cp.mouse.down(); await cp.mouse.move(...b2, { steps: 4 }); await cp.mouse.up();
  const sm = await CA((A) => A.doc.cast.emil.paint.small);
  ok(sm && sm.w === 24 && sm.h === 28 && sm.pal[0] === colour && [2, 3, 4, 5, 6].every((x) => sm.px[2 * 24 + x] === '0') && sm.px[2 * 24 + 7] === '.', 'one stroke of the pencil paints a line of pixels and nothing else');
  ok((await canvasPx('#pcv', 4, 2)).slice(0, 3).join() === rgb.join() && (await canvasPx('#cpS', 4, 2)).slice(0, 3).join() === rgb.join(), 'the drawing window and the small preview both show it');
  await cp.click('[data-pt=eraser]');
  a = await where(12, 18); await cp.mouse.click(...a);
  ok(await CA((A) => A.doc.cast.emil.paint.small.px[18 * 24 + 12] === '-') && (await canvasPx('#cpS', 12, 18)).slice(0, 3).join() === '58,53,82', 'the eraser takes a pixel of the portrait away (the background shows)');
  await cp.click('[data-pt=pencil]'); await cp.check('#pMir');
  a = await where(3, 10); await cp.mouse.click(...a);
  ok(await CA((A) => { const p = A.doc.cast.emil.paint.small.px; return p[10 * 24 + 3] !== '.' && p[10 * 24 + 20] !== '.'; }), 'mirror draws the pixel on both sides');
  await cp.uncheck('#pMir');
  await cp.evaluate(() => document.activeElement && document.activeElement.blur()); await cp.keyboard.press('Control+z');
  ok(await CA((A) => { const p = A.doc.cast.emil.paint.small.px; return p[10 * 24 + 3] === '.' && p[10 * 24 + 20] === '.' && p[2 * 24 + 4] === '0' && p[18 * 24 + 12] === '-'; }), 'Undo takes the last stroke back and keeps the ones before it');
  ok(await cp.$eval('#pCol', (e) => e.disabled), 'the free colour picker is off while the palette is locked');
  await cp.uncheck('#pLock'); await cp.$eval('#pCol', (e) => { e.value = '#123456'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  ok((await cp.$eval('#pCol', (e) => e.value)) === '#123456', 'with the lock off any colour can be picked');
  await cp.check('#pLock');
  ok((await cp.$eval('#pCol', (e) => e.value)) !== '#123456', 'and switching the lock on again moves it to the nearest colour of the game');
  await cp.check('#pCmp');
  const before = await CA((A) => JSON.stringify(A.doc.cast.emil.paint));
  a = await where(8, 8); await cp.mouse.click(...a);
  ok((await CA((A) => JSON.stringify(A.doc.cast.emil.paint))) === before, '"show it without my drawing" is a look, not a tool');
  await cp.uncheck('#pCmp');
  // the figure in the rooms and the big portrait
  await cp.click('[data-cv=room]'); await cp.check('#cOv');
  ok((await cp.$eval('#pcv', (c) => [c.width, c.height])).join() === '32,64', 'the figure in the rooms has a box of its own around the feet');
  await cp.click('[data-pt=pencil]');
  { const bx = await cp.locator('#pcv').boundingBox(); await cp.mouse.click(bx.x + (10 + 0.5) * 8, bx.y + (30 + 0.5) * 8); }
  ok(await CA((A) => { const p = A.doc.cast.emil.paint.room; return p && p.ox === -16 && p.oy === -56 && p.px[30 * 32 + 10] !== '.'; }), 'a pixel on the figure is saved relative to its feet');
  ok(await CA((A) => { for (const rid of Object.keys(ROOMS)) { const o = ROOMS[rid].objects.find((q) => q.t === 'npc' && q.hot === 'emil'); if (o) return !!o.look.__paint; } return false; }), 'and the engine draws it on the figure wherever the person stands');
  await cp.click('[data-cv=big]'); await cp.check('#cOv');
  await cp.selectOption('#cpM', 'shaken'); await cp.selectOption('#pOn', '1');
  { const bx = await cp.locator('#pcv').boundingBox(); await cp.mouse.click(bx.x + (20 + 0.5) * 6, bx.y + (20 + 0.5) * 6); }
  ok(await CA((A) => Object.keys(A.doc.cast.emil.paint).sort().join() === 'big:shaken,room,small'), 'a drawing on the big portrait can belong to one mood only');
  await cp.click('#pClear');
  ok(await CA((A) => Object.keys(A.doc.cast.emil.paint).sort().join() === 'room,small'), 'Clear takes the drawing off that view');
  await cp.click('[data-a=creset]');
  ok(await CA((A) => !A.doc.cast), 'and "Back to what the case has" takes every drawing and edit of the person away');
  await CA((A) => { A.S.sel = { kind: 'obj', id: 'constable' }; A.render(); });
  await cp.click('.tabs button[data-t=insp]');
  ok(await cp.isVisible('#p-insp [data-a=tocast]'), 'a person selected in the room offers to be edited in Cast');
  await cp.click('#p-insp [data-a=tocast]');
  ok(/^constable/i.test(await cp.innerText('#p-cast h3 >> nth=1')), 'and that opens the Cast tab on them');
  ok(!cp.errors.length, `no page errors ${cp.errors.join(' | ')}`);
  await cctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} failure(s)` : '\neditor ok');
process.exit(failed ? 1 : 0);
