// node tests/e2e-server.mjs  ->  the editor as it runs on the site: behind the sign-in, drafts and published layouts kept on the server,
// the game picking up a published layout. Uses the site's Worker (eqbalhozhabr/luckylion-website, in ../luckylion-website or SITE_REPO)
// running locally with an in-memory database, and the game + the self-contained editor folder that `npm run assemble` makes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const load = () => { for (const p of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright']) { if (!p) continue; try { return require(p); } catch (e) { /* next */ } } throw new Error('playwright not found'); };
const { chromium } = load();
const SITE = path.resolve(process.env.SITE_REPO || '../luckylion-website');
const { startLocal } = await import(pathToFileURL(path.join(SITE, 'worker/tests/local-server.mjs')).href);
if (!process.env.NO_ASSEMBLE) execSync('node scripts/assemble.mjs', { stdio: 'inherit' });

// the site as Cloudflare would have it: public/case-in-a-nutshell/ = the game + editor/ (with the config that points at the server)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
fs.cpSync('out/site', path.join(root, 'case-in-a-nutshell'), { recursive: true });
fs.rmSync(path.join(root, 'case-in-a-nutshell/editor'), { recursive: true, force: true });
fs.cpSync('out/editor', path.join(root, 'case-in-a-nutshell/editor'), { recursive: true });
fs.writeFileSync(path.join(root, 'case-in-a-nutshell/editor/editor-config.json'), JSON.stringify({ api: '/case-in-a-nutshell/api/editor' }));
const S = await startLocal({ root });
const browser = await chromium.launch();
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ok  ', m); else { failed++; console.log('  FAIL', m); } };
const ED = S.url + '/case-in-a-nutshell/editor/';
const errorsOf = (pg) => { const e = []; pg.on('pageerror', (x) => e.push(x.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g|ERR_/.test(m.text())) e.push(m.text()); }); pg.errors = e; return pg; };
const api = (pg, method, p, body) => pg.evaluate(async ([m, p, b]) => { const r = await fetch('/case-in-a-nutshell/api/editor/' + p, { method: m, headers: { 'x-editor': '1', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }, [method, p, body]);

console.log('without signing in');
const anon = await browser.newContext(), a = errorsOf(await anon.newPage());
await a.goto(ED);
ok(await a.isVisible('#f') && !(await a.$('#cases')), 'the editor address shows only a sign-in form');
ok((await a.evaluate(async () => (await fetch('/case-in-a-nutshell/editor/assets/engine.js')).status)) === 401 && (await a.evaluate(async () => (await fetch('/case-in-a-nutshell/editor/editor.js')).status)) === 401, 'the editor\'s files are not served to anyone who is not signed in');
ok((await api(a, 'PUT', 'layout/monday-nine/draft', { doc: { version: 1, rooms: {} } })).status === 401 && (await api(a, 'POST', 'layout/monday-nine/publish', { doc: { version: 1, rooms: {} } })).status === 401, 'and nobody can save or publish');
await a.fill('#u', S.user); await a.fill('#p', 'not the password at all'); await a.click('#f button');
await a.waitForSelector('#e:has-text("Wrong")'); ok(true, 'a wrong password is refused with a plain message');

console.log('signed in');
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), pg = errorsOf(await ctx.newPage());
await pg.goto(ED + '?case=monday-nine&room=living'); await pg.fill('#u', S.user); await pg.fill('#p', S.password); await pg.click('#f button');
await pg.waitForSelector('#p-insp table tr');
ok((await pg.innerText('#who')) === S.user && await pg.isVisible('#bOut'), 'the editor opens and shows who is signed in');
const API = (fn, ...a2) => pg.evaluate(([f, args]) => new Function('A', 'args', 'return (' + f + ')(A, args)')(window.NUT_EDITOR_API, args), [fn.toString(), a2]);
// delete a free object: it is saved on the server by itself
await API((A) => { A.S.sel = { kind: 'obj', id: 'plant10' }; A.render(); });
const n0 = await API((A) => A.cur.r.objects.length); await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.keyboard.press('Delete');
ok((await API((A) => A.cur.r.objects.length)) === n0 - 1, 'an edit works as before');
await pg.waitForFunction(() => /saved to the server/.test(document.getElementById('state').textContent), null, { timeout: 8000 });
const g1 = await api(pg, 'GET', 'layout/monday-nine'); ok(g1.status === 200 && g1.data.draft && g1.data.draft.doc.rooms.living.objects.some((r) => r.id === 'plant10' && r.deleted) && g1.data.published === null, 'the draft is on the server, and nothing is published');
const pubBefore = await (await fetch(S.url + '/case-in-a-nutshell/api/layout/monday-nine.js')).text(); ok(/no published layout/.test(pubBefore), 'players still get no layout from the server');
// a new browser (nothing in its storage) gets the draft from the server
const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); await ctx2.addCookies(await ctx.cookies());
const pg2 = errorsOf(await ctx2.newPage()); await pg2.goto(ED + '?case=monday-nine&room=living'); await pg2.waitForSelector('#p-insp table tr');
ok(await pg2.evaluate(() => !window.NUT_EDITOR_API.cur.r.objects.some((o) => o.id === 'plant10')), 'another browser opens the same draft');
await ctx2.close();
// publish
await pg.click('#bPub'); await pg.waitForSelector('#dlg[open]'); await pg.fill('#pLabel', 'plant removed'); await pg.click('#pGo');
await pg.waitForFunction(() => /published/.test(document.getElementById('state').textContent), null, { timeout: 8000 });
const g2 = await api(pg, 'GET', 'layout/monday-nine'); ok(g2.data.published && g2.data.published.label === 'plant removed' && g2.data.published.author === S.user, 'Publish stores a published version with its note and author');
const pubAfter = await (await fetch(S.url + '/case-in-a-nutshell/api/layout/monday-nine.js')).text(); ok(/NUT_PUBLISHED/.test(pubAfter) && /"deleted":true/.test(pubAfter), 'the public endpoint now serves it, without any sign-in');
// the game picks it up
const pl = errorsOf(await (await browser.newContext()).newPage()); await pl.goto(S.url + '/case-in-a-nutshell/monday-nine/'); await pl.waitForTimeout(800);
const gs = await pl.evaluate(() => ({ source: NUT_LAYOUT.state.source, plant: ROOMS.living.objects.some((o) => o.id === 'plant10') }));
ok(gs.source === 'published' && !gs.plant, 'a player\'s game uses the published layout (the plant is gone)');
ok(!pl.errors.length, 'and runs without errors ' + pl.errors.join(' | '));
// a case with nothing published is untouched
const pl2 = errorsOf(await (await browser.newContext()).newPage()); await pl2.goto(S.url + '/case-in-a-nutshell/night-train/'); await pl2.waitForTimeout(600);
ok(await pl2.evaluate(() => NUT_LAYOUT.state.source === 'embedded') && !pl2.errors.length, 'a case with nothing published keeps the layout built into it');
// versions and restore
await pg.click('.tabs button[data-t=hist]'); await pg.waitForSelector('#p-hist table tr');
ok((await pg.$$('#p-hist table tr')).length >= 2 && /published/.test(await pg.innerText('#p-hist')), 'the Versions tab lists what is on the server');
await pg.keyboard.press('Control+z'); // (nothing selected: harmless)
await API((A) => { A.S.sel = { kind: 'obj', id: 'chair1' }; A.render(); });
// signing out
await pg.click('#bOut'); await pg.waitForSelector('#f'); ok(true, 'Sign out brings the sign-in form back');
ok((await api(pg, 'GET', 'me')).status === 401, 'and the session is over');
ok(!pg.errors.length, 'no page errors ' + pg.errors.join(' | '));
await browser.close(); S.close(); fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failure(s)` : '\nserver ok');
process.exit(failed ? 1 : 0);
