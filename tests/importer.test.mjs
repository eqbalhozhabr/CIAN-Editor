// node tests/importer.test.mjs  ->  the pixel-art pipeline on plain pixel arrays (no browser)
await import('../importer.js');
const I = globalThis.NutImporter;
let bad = 0;
const ok = (c, m) => { if (c) console.log('  ok  ', m); else { bad++; console.log('  FAIL', m); } };
const img = (w, h, fn) => { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(fn(x, y), (y * w + x) * 4); return a; };
const enlarge = (a, w, h, s) => img(w * s, h * s, (x, y) => a.slice((((y / s) | 0) * w + ((x / s) | 0)) * 4, (((y / s) | 0) * w + ((x / s) | 0)) * 4 + 4));
const small = img(6, 5, (x, y) => (x === 0 || y === 4 ? [255, 255, 255, 255] : (x + y) % 2 ? [200, 30, 30, 255] : [30, 30, 200, 255]));

ok(I.detectScale(enlarge(small, 6, 5, 4), 24, 20) === 4, 'finds a 4x enlargement');
ok(I.detectScale(small, 6, 5) === 1 || I.detectScale(small, 6, 5) > 1 === false, 'a picture that is not enlarged keeps scale 1');
const noisy = img(24, 20, (x, y) => [(x * 37 + y * 11) % 256, (x * 13) % 256, (y * 29) % 256, 255]);
ok(I.detectScale(noisy, 24, 20) === 1, 'a smooth or noisy picture is not mistaken for pixel art');
const d = I.downscale(enlarge(small, 6, 5, 4), 24, 20, 4);
ok(d.w === 6 && d.h === 5 && d.rgba.every((v, i) => v === small[i]), 'taking it down gives back the original pixels');

const bg = img(8, 8, (x, y) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? [10, 200, 10, 255] : [255, 255, 255, 255]));
ok(I.floodBackground(bg, 8, 8) === 48 && bg[3] === 0 && bg[(3 * 8 + 3) * 4 + 3] === 255, 'a flat background is made transparent, the object stays');
const inner = img(8, 8, (x, y) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? ((x === 3 && y === 3) ? [255, 255, 255, 255] : [10, 200, 10, 255]) : [255, 255, 255, 255]));
I.floodBackground(inner, 8, 8); ok(inner[(3 * 8 + 3) * 4 + 3] === 255, 'white inside the object is not background');
const c = I.cropOpaque(bg, 8, 8); ok(c.w === 4 && c.h === 4 && c.ox === 2, 'crops to the visible part');
ok(I.cropOpaque(img(3, 3, () => [0, 0, 0, 0]), 3, 3) === null, 'an empty picture is refused');

const pal = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];
const near = img(4, 1, (x) => [[250, 10, 10, 255], [10, 240, 5, 255], [5, 5, 250, 255], [0, 0, 0, 0]][x]);
const sn = I.snapPalette(near, pal);
ok(sn.rgba[0] === 255 && sn.rgba[1] === 0 && sn.rgba[5] === 255 && sn.rgba[10] === 255 && sn.rgba[15] === 0, 'colours move to the nearest palette colour; transparent stays');
ok(sn.stats.opaque === 3 && sn.stats.moved === 3, 'and the report counts what moved');
const many = img(70, 1, (x) => [x * 3, 255 - x * 3, (x * 7) % 256, 255]);
const manyPal = Array.from({ length: 70 }, (_, i) => '#' + [i * 3, 255 - i * 3, (i * 7) % 256].map((v) => v.toString(16).padStart(2, '0')).join(''));
const r = I.snapPalette(many, manyPal, 61); ok(r.colorsOut <= 61 && r.merged >= 9, 'more than 61 colours are merged down to 61');

const tree = img(48, 64, (x, y) => { const px = x >> 2, py = y >> 2; return (px - 6) ** 2 + (py - 5) ** 2 <= 20 ? [0x4f, 0x9a, 0x5b, 255] : [255, 255, 255, 255]; });
const p = I.process(tree, 48, 64, { palette: ['#4f9a5b', '#ffffff', '#6b4a3a'] });
ok(p.ok && p.scale === 4 && p.w <= 12 && p.notes.some((n) => /background/.test(n.text)) && p.notes.some((n) => /palette/.test(n.text)), 'the whole pipeline: grid, background, crop, palette, notes');
ok(p.defaults.fp[0] >= 0.5 && p.defaults.ay < p.h, 'it suggests a footprint and an anchor');
const big = I.process(img(200, 200, (x, y) => ((x - 100) ** 2 + (y - 100) ** 2 < 8000 ? [200, 50, 50, 255] : [0, 0, 0, 0])), 200, 200, { palette: null });
ok(!big.ok && big.notes.some((n) => n.level === 'error' && /bigger than 120/.test(n.text)), 'a picture bigger than the room is refused');
const keep = I.process(img(10, 10, (x, y) => ((x - 5) ** 2 + (y - 5) ** 2 < 12 ? [255, 0, 255, 255] : [0, 0, 0, 0])), 10, 10, { palette: null });
ok(keep.notes.some((n) => n.level === 'warn' && /not locked/.test(n.text)), 'keeping the original colours is flagged');
const tile = I.process(img(8, 8, (x, y) => ((x + y) % 2 ? [0x4f, 0x9a, 0x5b, 255] : [0x7c, 0xc0, 0x7a, 255])), 8, 8, { palette: ['#4f9a5b', '#7cc07a'], tile: true });
ok(tile.ok && tile.w === 8 && tile.h === 8 && !tile.notes.some((n) => /background|Cropped/.test(n.text)), 'a tile keeps its whole square: no background removal, no crop');
const holes = I.process(img(8, 8, (x) => (x === 0 ? [0, 0, 0, 0] : [10, 10, 10, 255])), 8, 8, { palette: null, tile: true });
ok(!holes.ok && holes.notes.some((n) => /must be solid/.test(n.text)), 'a tile with transparent pixels is refused');
console.log(bad ? `\n${bad} failure(s)` : '\nimporter ok');
process.exit(bad ? 1 : 0);
