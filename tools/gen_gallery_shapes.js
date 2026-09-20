// Gallery extras the gallery view reads next to gallery_manifest.js (John, 2026-09-14):
//
//   1. <combo>.tile.svg -- the tile on its own. The gallery shows ONE tile picture for a tile with
//      several ways of tiling, with the tilings listed (and, on the toggle, drawn) underneath. Cut
//      from the tiling picture: the first polygon TilerSVG.tilesToSVG writes is the base copy.
//      gen_gallery.js now writes these itself; this fills in pictures made before that.
//
//   2. gallery_shapes.js -- the unbalanced tiles grouped by SHAPE across edge counts. The manifest's
//      tileKey only groups within one edge count, but one polyomino is #69439 AND #69445 at m=26, 52
//      and 78. Two tile groups are one shape when their REAL corners (the structural mask, cfg.
//      vertexAngle -- never the solved angles; see project_25638_new_tiles) have the same turning
//      function to within 10 degrees RMS, a mirror image counting as the same tile.
//
// #25638 is kept apart on John's word: "it is not an unbalanced tile. It is an anisohedral tile that
// allows an unbalanced tiling. We can also tile it balanced." His drawing of both goes with it.
//
//     node gen_gallery_shapes.js          (py/ in program4, tools/ in program5 -- same file)
const fs = require('fs'), path = require('path'), vm = require('vm');
const P5 = fs.existsSync(path.join(__dirname, 'lib', 'test_harness.js'));
const ROOT = path.dirname(__dirname);
const COMBOS_DIR = P5 ? path.join(ROOT, 'data', 'combos') : path.join(ROOT, 'combos');
const OUT_DIR = P5 ? path.join(ROOT, 'app') : path.join(ROOT, 'engine');
const H = require(P5 ? path.join(__dirname, 'lib', 'test_harness.js') : path.join(ROOT, 'engine', 'test_harness.js'));

// curated, like the WEIRD_ prefix: a judgment, not a computed property
const BALANCED_TOO = {
  25638: { note: 'Not an unbalanced tile: an anisohedral tile that also allows an unbalanced tiling. It tiles balanced too.',
           picture: 'john_25638_unbalanced_and_balanced.svg',
           pictureNote: "John's drawing: most of it is the unbalanced tiling; the lower left shows it tiling balanced." },
};

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(OUT_DIR, 'gallery_manifest.js'), 'utf8') + ';this.G = GALLERY;', ctx);
const G = ctx.G;

// ---- 1. single-tile pictures ----
function tileSvgFrom(svg) {
  const mm = svg.match(/<polygon points="([^"]+)" fill="([^"]+)"/);
  if (!mm) return null;
  const P = mm[1].trim().split(/\s+/).map(s => s.split(',').map(Number));
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const pad = 0.4, W = maxx - minx + 2 * pad, Hh = maxy - miny + 2 * pad, sw = Math.max(W, Hh) / 600;
  const pts = P.map(p => (p[0] - minx + pad).toFixed(4) + ',' + (p[1] - miny + pad).toFixed(4)).join(' ');   // already y-flipped
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(4)} ${Hh.toFixed(4)}" width="1000" height="${Math.round(1000 * Hh / W)}">\n` +
    `  <rect x="0" y="0" width="${W.toFixed(4)}" height="${Hh.toFixed(4)}" fill="#fafafa"/>\n` +
    `  <polygon points="${pts}" fill="${mm[2]}" stroke="#333" stroke-width="${sw.toFixed(4)}" stroke-linejoin="round"/>\n</svg>\n`;
}
let nTile = 0, nTileSame = 0, nTileMissing = 0;
for (const e of G) {
  const src = path.join(COMBOS_DIR, e.svg), dst = path.join(COMBOS_DIR, e.svg.replace(/\.svg$/, '.tile.svg'));
  if (!fs.existsSync(src)) { nTileMissing++; continue; }
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) { nTileSame++; continue; }
  const out = tileSvgFrom(fs.readFileSync(src, 'utf8'));
  if (out) { fs.writeFileSync(dst, out); nTile++; }
}
console.log(`single-tile pictures: ${nTile} written, ${nTileSame} already current${nTileMissing ? `, ${nTileMissing} tiling pictures missing` : ''}`);

// ---- 2. unbalanced tiles by shape ----
function outline(A, L) {
  const m = A.length, pts = []; let x = 0, y = 0, dir = 0;
  for (let i = 0; i < m; i++) { pts.push([x, y]); x += L[i] * Math.cos(dir * Math.PI / 180); y += L[i] * Math.sin(dir * Math.PI / 180); dir += 180 - A[(i + 1) % m]; }
  return pts;
}
function realCorners(e) {
  const c = e.combo;
  H.loadType(c.id); H.runSums(c.m);
  const cfg = H.config(c.id, c.m, c.orient || 0, c.off || 0, e.si);
  if (!cfg || cfg.impossible || !cfg.vertexAngle) return null;
  return outline(c.manual.A, c.manual.L).filter((_, i) => cfg.vertexAngle[i] === 1);
}
function turning(pts) {
  const n = pts.length, lens = [], hd = [];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; lens.push(Math.hypot(b[0] - a[0], b[1] - a[1])); hd.push(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI); }
  const per = lens.reduce((s, x) => s + x, 0); let s = 0; const st = [];
  for (let i = 0; i < n; i++) { s += lens[i] / per; st.push({ s: s % 1, turn: (((hd[i] - hd[(i - 1 + n) % n]) % 360) + 540) % 360 - 180 }); }
  return st.sort((a, b) => a.s - b.s);
}
function sample(st, N) {
  const out = new Float64Array(N); let acc = 0, k = 0;
  for (let i = 0; i < N; i++) { while (k < st.length && st[k].s <= i / N) acc += st[k++].turn; out[i] = acc; }
  return out;
}
// Starting b's turning function at another corner is a cyclic shift, and a cumulative angle picks up
// the whole turn (360) where it wraps -- without that, two numberings of one polygon read as 75-90
// degrees apart (the bug shape_compare.js had too: it only ever matched tiles numbered from the same corner).
function rmsBestShift(a, b, totB) {
  const N = a.length; let best = Infinity;
  const at = (i, sh) => b[(i + sh) % N] + (i + sh >= N ? totB : 0);
  for (let sh = 0; sh < N; sh++) {
    let sum = 0; for (let i = 0; i < N; i++) sum += a[i] - at(i, sh);
    const off = sum / N; let sq = 0;
    for (let i = 0; i < N; i++) { const d = a[i] - at(i, sh) - off; sq += d * d; }
    best = Math.min(best, Math.sqrt(sq / N));
  }
  return best;
}
const N = 720;
function shapeDist(p1, p2) {
  const t1 = sample(turning(p1), N);
  const vs = p => { const st = turning(p); return [sample(st, N), st.reduce((s, x) => s + x.turn, 0)]; };
  const mirror = p2.map(([x, y]) => [-x, y]).reverse();                  // the mirror image, same way round
  return Math.min(rmsBestShift(t1, ...vs(p2)), rmsBestShift(t1, ...vs(mirror)));
}

const tileOf = e => e.tileKey ? e.combo.m + '|' + e.tileKey : 'file:' + e.file;
const pref = f => /^combo_WEIRD_/.test(f) ? 0 : /^combo_ANISO_/.test(f) ? 1 : /^combo_UNBALQLT_/.test(f) ? 2 : 3;
const tiles = new Map();
for (const e of G.filter(e => e.group === 'unbalanced' || e.group === 'weird')) {
  const k = tileOf(e); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(e);
}
const T = [...tiles.entries()].map(([k, es]) => {
  const rep = es.slice().sort((a, b) => pref(a.file) - pref(b.file))[0];
  let pts = null; try { pts = realCorners(rep); } catch (e) {}
  return { k, es, rep, pts, ids: [...new Set(es.map(e => e.combo.id))], m: rep.combo.m };
});
const par = T.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
  const a = T[i], b = T[j];
  if (!a.pts || !b.pts || a.pts.length !== b.pts.length || find(i) === find(j)) continue;
  const d = shapeDist(a.pts, b.pts);
  if (d < 10) { par[find(j)] = find(i); console.log(`  same shape: ${a.rep.file}  ~  ${b.rep.file}  (${d.toFixed(1)} deg)`); }
}
const clusters = new Map();
T.forEach((t, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(t); });
const shapes = [...clusters.values()].map(ts => {
  const ids = [...new Set(ts.flatMap(t => t.ids))].sort((a, b) => a - b), ms = [...new Set(ts.map(t => t.m))].sort((a, b) => a - b);
  const bt = ids.map(id => BALANCED_TOO[id]).find(Boolean);
  const s = { label: ids.map(id => '#' + id).join(' ') + ' · m' + ms.join(', m'), tileGroups: ts.map(t => t.k), ids, ms,
              realCorners: ts[0].pts ? ts[0].pts.length : null };
  if (bt) { s.balancedToo = true; s.note = bt.note;
            if (fs.existsSync(path.join(COMBOS_DIR, bt.picture))) { s.picture = bt.picture; s.pictureNote = bt.pictureNote; } }
  return s;
}).sort((a, b) => (!!a.balancedToo - !!b.balancedToo) || a.ms[0] - b.ms[0] || a.ids[0] - b.ids[0]);
// ---- 3. weird tiles ----
// John, 2026-09-14: "a 'weird tiles' section that has the combos we were looking at in the checking
// folder that needed special curves to tile ... ones that were a challenge to find since they don't
// work with straight edges, or have tiny angles or some other reason." The list is curated (where
// each came from is a fact about our history, not about the shape); what made each one hard is
// MEASURED here from the saved shape.
const DESIGNED = 'curves designed by John (Checking/designed, 2026-09-11)';
const SEARCHED = 'a former tile nobody could solve by hand; the strengthened search found curves that clear it (Checking/tile_to_not_tile/found_by_search, 2026-09-13)';
const WEIRD_TILES = [
  ...['combo_1726810_m8_si0_or0_off4.json', 'combo_1726810_m8_si16_or0_off2.json', 'combo_209105_m8_si8_or1_off0.json',
      'combo_1727363_m8_si2_or0_off6.json', 'combo_209403_m8_si5_or1_off7.json', 'combo_601144_m8_si2_or0_off1.json']
    .map(file => ({ file, source: DESIGNED })),
  ...['combo_25552_m8_si2_or1_off5.json', 'combo_25552_m8_si2_or1_off3.json', 'combo_72951_m8_si10_or1_off2.json',
      'combo_209162_m8_si0_or0_off2.json']
    .map(file => ({ file, source: SEARCHED })),
];
// smallest gap between two non-adjacent STRAIGHT edges, as a fraction of the tile's diameter (0 = they
// touch or cross: the straight-edged tile is not a tile at all, only the curves make it one)
function straightGap(A, L) {
  const P = outline(A, L), m = P.length;
  let D = 0; for (const p of P) for (const q of P) D = Math.max(D, Math.hypot(p[0] - q[0], p[1] - q[1]));
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const ptSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  let g = Infinity;
  for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
    if (i === 0 && j === m - 1) continue;                                // adjacent across the wrap
    const a = P[i], b = P[(i + 1) % m], c = P[j], d = P[(j + 1) % m];
    const cross = Math.sign(cr(a, b, c)) * Math.sign(cr(a, b, d)) < 0 && Math.sign(cr(c, d, a)) * Math.sign(cr(c, d, b)) < 0;
    g = Math.min(g, cross ? 0 : Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b)));
  }
  return g / D;
}
const weird = [];
for (const w of WEIRD_TILES) {
  const e = G.find(x => x.file === w.file);
  if (!e) { console.log(`  weird tile ${w.file}: not in gallery_manifest.js -- render it with gen_gallery.js first`); continue; }
  const A = e.combo.manual.A.map(a => ((a % 360) + 360) % 360), L = e.combo.manual.L;
  const why = [];
  const zero = A.filter(a => Math.min(a, 360 - a) < 1e-3).length;
  const real = A.filter(a => Math.min(a, 360 - a) >= 1e-3 && Math.abs(a - 180) > 1e-3).map(a => Math.min(a, 360 - a));
  if (zero) why.push(`${zero} corner${zero > 1 ? 's' : ''} of 0°`);
  else if (real.length && Math.min(...real) < 30) why.push(`smallest corner ${Math.min(...real).toFixed(1)}°`);
  const ratio = Math.min(...L) / Math.max(...L);
  if (ratio < 0.25) why.push(`short/long edge ${ratio.toFixed(3)}`);
  const sg = straightGap(e.combo.manual.A, L);
  why.push(sg < 1e-6 ? 'with straight edges it touches or crosses itself: only the curves make it a tile'
         : sg < 0.02 ? `with straight edges it nearly touches itself (gap ${sg.toFixed(3)} of its size)`
         : 'the straight-edged outline is already simple');
  if (e.clearance != null) why.push(`the curved boundary clears itself by ${e.clearance} of its size`);
  weird.push({ file: w.file, source: w.source, why });
  console.log(`  weird: ${w.file}  ${why.join(' | ')}`);
}

fs.writeFileSync(path.join(OUT_DIR, 'gallery_shapes.js'),
  '// GENERATED by gen_gallery_shapes.js from gallery_manifest.js -- do not edit. Unbalanced tiles grouped by\n' +
  '// shape, and the curated "weird tiles" with what made each hard.\n' +
  'var GALLERY_SHAPES = ' + JSON.stringify({ shapes, weird }, null, 1) + ';\n');
console.log(`\nunbalanced/weird tile groups: ${T.length} -> ${shapes.length} shapes`);
shapes.forEach(s => console.log(`  ${s.balancedToo ? '(balanced too) ' : ''}${s.label}  -- ${s.tileGroups.length} tile group(s)`));
