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
if (!process.env.NO_ASSEMBLE && !process.env.SITE_ROOT) execSync('node scripts/assemble.mjs', { stdio: 'inherit' });
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

await pg.click('#bSave');
const draft = await pg.evaluate(() => JSON.parse(localStorage.getItem('nutshell.draft.monday-nine')));
ok(draft && draft.sprites && draft.sprites['my-tree'] && draft.rooms.living.objects.some((r) => r.look && r.look.sprite === 'my-tree'), 'Save draft keeps the layout and the sprite it uses in this browser');
if (!process.env.NO_PLAY) {   // (the game that is already live does not know ?layout=draft yet)
  const popup = ctx.waitForEvent('page'); await pg.click('#bPlay'); const game = await popup;
  await game.waitForLoadState('load'); await game.waitForTimeout(800);
  const gs = await game.evaluate(() => ({ room: NUT.S.room, plant: ROOMS.living.objects.find((o) => o.id === 'plant5').t }));
  ok(gs.plant === 'sprite' && gs.room === 'living', 'Play from here opens the game in this room, drawing the draft');
  await game.close();
}
const dl = pg.waitForEvent('download'); await pg.click('#bPub'); await pg.waitForSelector('#dlg[open]'); await pg.click('#pGo');
let text = ''; for await (const ch of await (await dl).createReadStream()) text += ch;
let parsed = null; try { parsed = JSON.parse(text); } catch (e) { /* reported below */ }
ok(parsed && parsed.rooms && parsed.sprites && parsed.sprites['my-tree'], 'Publish writes a layout.json with the sprite inside it (no server is configured here)');
ok((await pg.innerText('#state')).includes('exported'), 'and the page says it was exported, not published');
await pg.click('.tabs button[data-t=hist]'); ok((await pg.$$('#p-hist table tr')).length >= 1, 'a version was saved');
ok(!pg.errors.length, `no page errors ${pg.errors.join(' | ')}`);
await browser.close(); server.close();
console.log(failed ? `\n${failed} failure(s)` : '\neditor ok');
process.exit(failed ? 1 : 0);
