// node scripts/assemble.mjs [gameDir] [outDir]
// Builds the game (npm run build in gameDir), then copies its dist/ and this editor into outDir, so that
//   outDir/                       = the game, as it goes under /case-in-a-nutshell/
//   outDir/editor/index.html      = this page (served at /case-in-a-nutshell/editor/)
// The editor has no build step of its own: it reads the engine and the cases from ../assets/ at run time.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = path.resolve(process.argv[2] || process.env.GAME_DIR || path.join(here, '..', 'Case-in-a-Nutshell'));
const out = path.resolve(process.argv[3] || path.join(here, 'out', 'site'));
if (!fs.existsSync(path.join(game, 'tools', 'build.mjs'))) { console.error('game repo not found at ' + game + ' (pass its path, or set GAME_DIR)'); process.exit(1); }
if (!process.env.NO_BUILD) execSync('npm run build', { cwd: game, stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(game, 'dist'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'editor'), { recursive: true });
for (const f of ['index.html', 'editor.js', 'store.js', 'importer.js']) fs.copyFileSync(path.join(here, f), path.join(out, 'editor', f));
for (const f of ['library', 'editor-config.json']) if (fs.existsSync(path.join(here, f))) fs.cpSync(path.join(here, f), path.join(out, 'editor', f), { recursive: true });   // shared sprites, and the publishing server's address when there is one
// and the editor on its own: a folder that carries the few game files it needs, so it can be dropped into the site without touching the game's own files
const solo = path.join(path.dirname(out), 'editor');
fs.rmSync(solo, { recursive: true, force: true }); fs.mkdirSync(path.join(solo, 'assets'), { recursive: true });
for (const f of ['index.html', 'editor.js', 'store.js', 'importer.js']) fs.copyFileSync(path.join(here, f), path.join(solo, f));
for (const f of ['library', 'editor-config.json']) if (fs.existsSync(path.join(here, f))) fs.cpSync(path.join(here, f), path.join(solo, f), { recursive: true });
for (const f of fs.readdirSync(path.join(game, 'dist', 'assets'))) if (f === 'engine.js' || f === 'editor-manifest.json' || /^case-.*\.js$/.test(f)) fs.copyFileSync(path.join(game, 'dist', 'assets', f), path.join(solo, 'assets', f));
console.log('self-contained editor folder:', path.relative(process.cwd(), solo));
console.log('assembled', path.relative(process.cwd(), out) || '.');
