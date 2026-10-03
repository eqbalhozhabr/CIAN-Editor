/* importer.js : an image on its way into the library. Pure functions on RGBA bytes (they run in the browser and in node tests);
   only decode() needs a canvas.

   The pipeline (phase 5 of the plan, used by "add an image" and "replace with an image"):
     decode -> find the pixel grid and take it down to real pixels -> make the background transparent -> crop
     -> lock the colours to the game's palette (or keep them, flagged) -> size and colour report.
   Nothing off-style goes into the library silently: the report says what was changed and what is still wrong, and the page
   asks before it adds the image. */
(function (root) {
  const MAX_COLOURS = 61;          // what a sprite can hold (NUT_SPRITES: one character per pixel)
  const MAX_SIDE = 120;            // a room is 176 x 164 pixels: nothing bigger than this is an object
  const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  /* "redmean" colour distance: close to what the eye sees, cheap */
  const dist = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };

  /* the largest whole-number scale at which the picture is made of flat s x s blocks (a pixel-art image that was enlarged); 1 if none */
  function detectScale(rgba, w, h) {
    for (let s = 32; s >= 2; s--) {
      if (w % s || h % s) continue;
      let ok = true;
      for (let by = 0; by < h && ok; by += s) for (let bx = 0; bx < w && ok; bx += s) {
        const i0 = (by * w + bx) * 4;
        for (let y = 0; y < s && ok; y++) for (let x = 0; x < s; x++) { const i = ((by + y) * w + bx + x) * 4; if (rgba[i] !== rgba[i0] || rgba[i + 1] !== rgba[i0 + 1] || rgba[i + 2] !== rgba[i0 + 2] || rgba[i + 3] !== rgba[i0 + 3]) { ok = false; break; } }
      }
      if (ok) return s;
    }
    return 1;
  }
  function downscale(rgba, w, h, s) {
    if (s === 1) return { rgba: Uint8ClampedArray.from(rgba), w, h };
    const nw = w / s, nh = h / s, out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const i = (y * s * w + x * s) * 4, o = (y * nw + x) * 4; out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; out[o + 3] = rgba[i + 3]; }
    return { rgba: out, w: nw, h: nh };
  }
  /* an opaque picture whose four corners share one colour: that colour, connected to the edge, is background */
  function floodBackground(rgba, w, h) {
    const px = (x, y) => (y * w + x) * 4, c = (i) => rgba[i] + ',' + rgba[i + 1] + ',' + rgba[i + 2];
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    if (corners.some((i) => rgba[i + 3] < 128) || new Set(corners.map(c)).size !== 1) return 0;
    const key = c(corners[0]), seen = new Uint8Array(w * h), stack = [];
    for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
    for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
    let n = 0;
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
      seen[y * w + x] = 1;
      const i = px(x, y); if (c(i) !== key) continue;
      rgba[i + 3] = 0; n++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return n;
  }
  /* alpha becomes all or nothing; crop to the opaque part */
  function cropOpaque(rgba, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const nw = x1 - x0 + 1, nh = y1 - y0 + 1, out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const i = ((y + y0) * w + x + x0) * 4, o = (y * nw + x) * 4;
      if (rgba[i + 3] >= 128) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; out[o + 3] = 255; }
    }
    return { rgba: out, w: nw, h: nh, ox: x0, oy: y0 };
  }
  /* every opaque pixel moves to the nearest colour of the game's palette; then, if more than 61 colours are left, the rarest merge into their nearest neighbour */
  function snapPalette(rgba, palette, max) {
    max = max || MAX_COLOURS;
    const pal = palette.map(rgb), out = Uint8ClampedArray.from(rgba), cache = new Map();
    const near = (c) => { const k = c.join(','); let v = cache.get(k); if (!v) { let b = 0, bd = 1e9; pal.forEach((p, i) => { const d = dist(c, p); if (d < bd) { bd = d; b = i; } }); v = { p: pal[b], d: bd }; cache.set(k, v); } return v; };
    const stats = { colorsIn: new Set(), moved: 0, far: 0, worst: 0, opaque: 0 };
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] < 128) continue;
      stats.opaque++; stats.colorsIn.add(out[i] + ',' + out[i + 1] + ',' + out[i + 2]);
      const n = near([out[i], out[i + 1], out[i + 2]]);
      if (n.d > 0) stats.moved++;
      if (n.d > 60) stats.far++;
      if (n.d > stats.worst) stats.worst = n.d;
      out[i] = n.p[0]; out[i + 1] = n.p[1]; out[i + 2] = n.p[2];
    }
    stats.colorsIn = stats.colorsIn.size;
    return Object.assign(reduce(out, max), { stats });
  }
  function reduce(rgba, max) {
    const count = new Map();
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= 128) { const k = hex(rgba[i], rgba[i + 1], rgba[i + 2]); count.set(k, (count.get(k) || 0) + 1); }
    let merged = 0;
    while (count.size > max) {
      const [rare] = [...count.entries()].sort((a, b) => a[1] - b[1])[0];
      let best = null, bd = 1e9; for (const k of count.keys()) if (k !== rare) { const d = dist(rgb(rare), rgb(k)); if (d < bd) { bd = d; best = k; } }
      count.set(best, count.get(best) + count.get(rare)); count.delete(rare);
      const [r, g, b] = rgb(rare), [nr, ng, nb] = rgb(best);
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= 128 && rgba[i] === r && rgba[i + 1] === g && rgba[i + 2] === b) { rgba[i] = nr; rgba[i + 1] = ng; rgba[i + 2] = nb; }
      merged++;
    }
    return { rgba, colorsOut: count.size, merged };
  }
  const colourCount = (rgba) => { const s = new Set(); for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= 128) s.add(rgba[i] + ',' + rgba[i + 1] + ',' + rgba[i + 2]); return s.size; };
  /* a footprint guess from the picture's width (a tile is 20 pixels wide on screen), in quarter tiles; and the anchor a standing object has */
  function defaults(w, h) {
    const side = Math.max(0.5, Math.round((w / 20) * 4 / 2) / 4);
    return { fp: [side, side], ax: Math.round(w / 2), ay: Math.max(0, h - Math.round(side * 5)) };
  }

  /* the whole pipeline on RGBA bytes. opts: { palette: ['#rrggbb'...] | null (keep colours), flat: false (skip the grid detection) }
     returns { ok, rgba, w, h, notes: [{level: 'info'|'warn'|'error', text}], ... } */
  function process(rgba, w, h, opts) {
    opts = opts || {}; const notes = []; const say = (level, text) => notes.push({ level, text });
    let cur = { rgba: Uint8ClampedArray.from(rgba), w, h };
    const s = opts.flat === false ? 1 : detectScale(cur.rgba, w, h);
    if (s > 1) { cur = downscale(cur.rgba, w, h, s); say('info', `Enlarged pixel art found (${s}x): taken down to ${cur.w} x ${cur.h} real pixels.`); }
    else if (!opts.tile && (w > 64 || h > 64)) say('warn', 'No pixel grid found: this looks like a smooth image, not pixel art. Resizing it is not done for you; draw or scale it down to the game\'s pixel size first.');
    if (opts.tile) {   // a floor or wall tile repeats: no background to remove, nothing to crop, and no holes
      let holes = 0; for (let i = 3; i < cur.rgba.length; i += 4) { if (cur.rgba[i] < 128) holes++; else cur.rgba[i] = 255; }
      if (holes) say('error', `A tile must be solid: ${holes} of its pixels are transparent.`);
      if (cur.w > 64 || cur.h > 64) say('error', `A tile of ${cur.w} x ${cur.h} is too big: use 64 x 64 or less (it repeats across the room).`);
      else if (cur.w < 4 || cur.h < 4) say('warn', `A tile of ${cur.w} x ${cur.h} is very small.`);
    } else {
      const bg = floodBackground(cur.rgba, cur.w, cur.h);
      if (bg) say('info', `The background was one flat colour; ${bg} pixels were made transparent.`);
      const c = cropOpaque(cur.rgba, cur.w, cur.h);
      if (!c) return { ok: false, notes: [{ level: 'error', text: 'The picture has no visible pixels.' }] };
      if (c.w !== cur.w || c.h !== cur.h) say('info', `Cropped to the visible part: ${c.w} x ${c.h}.`);
      cur = c;
      if (cur.w > MAX_SIDE || cur.h > MAX_SIDE) say('error', `${cur.w} x ${cur.h} is bigger than ${MAX_SIDE} pixels: the whole room is 176 x 164. Make it smaller.`);
      else if (cur.w > 64 || cur.h > 80) say('warn', `${cur.w} x ${cur.h} is large for one object (the sofa is about 60 x 40).`);
    }
    let stats = null, snapped = null;
    if (opts.palette) {
      snapped = snapPalette(cur.rgba, opts.palette, MAX_COLOURS); stats = snapped.stats; cur = Object.assign({}, cur, { rgba: snapped.rgba });
      say(stats.far > stats.opaque * 0.25 ? 'warn' : 'info', `Colours locked to the game palette: ${stats.colorsIn} colours became ${snapped.colorsOut}; ${stats.moved} of ${stats.opaque} pixels changed${stats.far ? ', ' + stats.far + ' of them a lot (this picture does not use the game\'s colours)' : ''}.`);
      if (snapped.merged) say('info', `${snapped.merged} rare colours were merged to fit the 61-colour limit of a sprite.`);
    } else {
      const n = colourCount(cur.rgba);
      if (n > MAX_COLOURS) say('error', `${n} colours: a sprite holds at most ${MAX_COLOURS}. Lock to the game palette or reduce them.`);
      else say('warn', `Colours kept as they are (${n}). The image is not locked to the game palette and will look out of place next to it.`);
    }
    return { ok: !notes.some((n) => n.level === 'error'), rgba: cur.rgba, w: cur.w, h: cur.h, scale: s, stats, notes, defaults: opts.tile ? { fp: [1, 1], ax: 0, ay: 0 } : defaults(cur.w, cur.h) };
  }

  /* browser only: a File -> { rgba, w, h } */
  function decode(file) {
    return new Promise((ok, no) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height); URL.revokeObjectURL(url); ok({ rgba: d.data, w: c.width, h: c.height }); };
      img.onerror = () => no(new Error('This file is not an image the browser can read.'));
      img.src = url;
    });
  }
  const api = { detectScale, downscale, floodBackground, cropOpaque, snapPalette, reduce, process, decode, defaults, dist, hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NutImporter = api;
})(typeof window !== 'undefined' ? window : globalThis);
