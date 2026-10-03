// node tests/e2e.mjs  ->  opens /editor/ in a real browser for every case (assembles the game and this page first): no errors, the room and the overlay are drawn,
// rooms and moments switch, pointing at the picture names the thing under the pointer, the reference image loads. Screenshots go to out/shots/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const load = () => {
  for (const p of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright']) { if (!p) continue; try { return require(p); } catch (e) { /* next */ } }
  throw new Error('playwright not found: npm i -D playwright, or set PLAYWRIGHT_PATH');
};
const { chromium } = load();
fs.mkdirSync('out/shots', { recursive: true });
execSync('node scripts/assemble.mjs', { stdio: 'inherit' });
const BASE = '/case-in-a-nutshell/', ROOT = path.resolve('out/site');
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
const srv = { url: `http://127.0.0.1:${server.address().port}${BASE}`, close: () => server.close() };
const png = (w, h, rgba) => {   // a flat-colour PNG, for the reference-image check
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (w * 4 + 1) + 1 + x * 4);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const browser = await chromium.launch();
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { failed++; console.log('  FAIL', msg); } };

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/editor-manifest.json'), 'utf8')).cases.map((c) => c.slug);
for (const slug of cases) {
  const pg = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|ERR_NAME|ERR_CONNECTION|ERR_TUNNEL|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await pg.goto(srv.url + 'editor/?case=' + slug);
  await pg.waitForSelector('#objs tr.row');
  const rooms = await pg.$$eval('#room option', (o) => o.map((x) => x.value));
  const painted = (id) => pg.evaluate((i) => { const c = document.getElementById(i), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k]) n++; return n; }, id);
  ok((await painted('cRoom')) > 5000 && (await painted('cOver')) > 500, `${slug}: room and overlay are drawn (${rooms.length} rooms)`);
  const status = await pg.innerText('#status');
  ok(/layout\.json loaded/.test(status) && /Drift from rooms\.js: 0/.test(status), `${slug}: layout.json is loaded and in sync`);
  for (const r of rooms) { await pg.selectOption('#room', r); await pg.waitForTimeout(40); if ((await pg.$$('#objs tr.row')).length === 0 && r !== rooms[0]) ok(false, `${slug}/${r}: empty object list`); }
  await pg.selectOption('#room', rooms[0]);
  if (await pg.isVisible('#momentL')) { const ms = await pg.$$eval('#moment option', (o) => o.map((x) => x.value)); for (const m of ms) { await pg.selectOption('#moment', m); await pg.waitForTimeout(40); } ok(true, `${slug}: ${ms.length} moments switch`); }
  // pointing at an object names it
  const hit = await pg.evaluate(() => { const c = document.getElementById('cOver'), b = c.getBoundingClientRect(), s = c.width / W; for (let i = 1; i < HOTS.length; i++) { const h = HOTLIST.find((q) => q.idx === i); if (h) return { name: HOTS[i], x: b.left + (h.x + 0.5) * s, y: b.top + (h.y + 0.5) * s }; } return null; });
  if (hit) { await pg.mouse.move(hit.x, hit.y); await pg.waitForTimeout(80); ok((await pg.innerText('#tip')) === hit.name, `${slug}: pointing names "${hit.name}"`); }
  // a click on an object row highlights it
  await pg.click('#objs tr.row >> nth=0'); ok(await pg.$eval('#objs tr.row', (e) => e.classList.contains('on')), `${slug}: a row highlights`);
  if (slug === cases[0]) {
    fs.writeFileSync('out/shots/ref.png', png(200, 200, [48, 112, 192, 255]));
    await pg.setInputFiles('#ref', 'out/shots/ref.png');
    await pg.waitForTimeout(200); ok((await painted('cRef')) > 100 && await pg.$eval('#rOp', (e) => e.value) === '60', `${slug}: a reference image loads under a semi-transparent render`);
  }
  await pg.screenshot({ path: `out/shots/${slug}.png` });
  ok(!errors.length, `${slug}: no page errors ${errors.join(' | ')}`);
  await pg.context().close();
}
await browser.close(); srv.close();
console.log(failed ? `\n${failed} failure(s)` : '\neditor ok');
process.exit(failed ? 1 : 0);
