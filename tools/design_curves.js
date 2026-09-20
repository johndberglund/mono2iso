// Design curves for a combo, and check the designer against curves John drew by hand.
//
//   node _dev_isohedral/design_curves.js --validate        -- reproduce John's hand-drawn curves
//   node _dev_isohedral/design_curves.js <combo.json> [--apply]
//
// The validation is the point. John's hand-drawn curves are the ground truth: start the designer
// from the plain DEMO motif on a combo he has already solved, and see whether it reaches the
// separation his curve achieves. If it cannot match his work, it is not ready to be trusted on the
// combos he has not solved.
const fs = require('fs'), path = require('path');
const H = require(path.join(__dirname,'lib','test_harness.js'));
const TC = H.TC;
const OS = require(path.join(__dirname,'lib','overlap_strict.js'));
const CO = require(path.join(__dirname,'lib','curved_overlap.js'));
const CD = require(path.join(__dirname,'lib','curve_designer.js'));
const TCurves = require(path.join(__dirname,'lib','tiler_curves.js'));
const ROOT = path.join(__dirname,'..');

function setup(c) {
  const m = c.m;
  H.config(c.id, m, c.orient, c.off, 0); H.loadType(c.id);
  const si = H.runSums(m).findIndex(s => JSON.stringify(s) === c.sum);
  const cfg = H.config(c.id, m, c.orient, c.off, si);
  if (!cfg || !cfg.ned) return null;
  const es = cfg.edgeSym, we = cfg.whichEdge, mp = cfg.mapping;
  const repMap = i => { let cur = i, code = 0, g = 0;
    while (we[cur] != null && we[cur] !== cur && g++ < m) { code ^= (mp[cur] || 0); cur = we[cur]; }
    return { rep: cur, code }; };
  const rc = []; for (let i = 0; i < m; i++) { const r = repMap(i); r.type = TCurves.SYM[es[r.rep]] || 'J'; rc.push(r); }
  const seen = new Set(), byType = {};
  for (const o of rc) { if (o.type === 'I' || seen.has(o.rep)) continue; seen.add(o.rep);
    (byType[o.type] = byType[o.type] || []).push(o.rep); }
  const variant = {};
  for (const t in byType) byType[t].sort((a, b) => a - b).forEach((r, i) => variant[r] = i);
  const V = TC.verticesOf(c.manual.A, c.manual.L, m).slice(0, m);
  const ned = cfg.ned;
  // Search on 60 tiles because the overlap test runs inside every step of every restart, and
  // verify the winner on 120 -- the size the gallery actually judges at. Searching at 120 would
  // triple the cost of a search that already takes minutes; checking only at 60 would hand back
  // curves that fail downstream, which is the mismatch that let a clean thumbnail sit in front of
  // an overlapping tiling in the first place.
  const placed = TC.develop(V, cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], 60);
  const placedCheck = TC.develop(V, cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], 120);
  return { m, si, cfg, rc, variant, V, placed, placedCheck };
}
// build the tile's drawn boundary and the developed patch from a full set of curve edits
function drawWith(S, edits) {
  const curveOf = [];
  for (let i = 0; i < S.m; i++) { const { rep, code, type } = S.rc[i];
    let ed = edits[rep];
    if (!ed || ed.type !== type || !Array.isArray(ed.pts)) ed = { type, pts: TCurves.motifPts(type, S.variant[rep] || 0) };
    curveOf.push(TCurves.applyMap(TCurves.buildCanon(type, ed.pts), code)); }
  const boundary = TCurves.curvedTile(S.V, curveOf);
  const draw = TCurves.buildCurvedTiles(S.placed, S.V, curveOf);
  // hand back HOW bad, not just whether: the designer climbs out of an overlapping start
  let ok = true, pairs = 1, worstFrac = 0;
  try { const r = CO.overlapCurved(draw); pairs = r.pairs; worstFrac = r.worstFrac; ok = pairs === 0; }
  catch (e) { ok = false; }
  return { boundary, draw, ok, pairs, worstFrac };
}

// Coordinate descent from a single start settles into whatever local optimum is nearest, and on
// four of John's combos that was about half the separation he reached by hand -- consistently half,
// across different types, which is the signature of a local optimum rather than a missing degree of
// freedom (his curves use the same 3-4 points and peak at |y| 0.21 against a 0.45 ceiling, so the
// search is not hitting a bound). So try several starts and keep the best, which is also what the
// hand method does: pull a point, see where it leads, and if it leads nowhere try a different pull.
// Restarts keep paying, with diminishing returns: going 5 -> 24 on the three combos the designer
// could not match moved it from 69/65/62% of John's hand result to 77/81/64%. 12 is where the curve
// flattens for the cost. Override with CD_STARTS.
const STARTS = +(process.env.CD_STARTS || 12);
function optimise(S, editable, start) {
  const edits = JSON.parse(JSON.stringify(start));
  for (let pass = 0; pass < 3; pass++) {
    for (const rep of editable) {
      const type = edits[rep].type;
      const r = CD.designCurve(type, edits[rep].pts,
        pts => { const e = JSON.parse(JSON.stringify(edits)); e[rep] = { type, pts };
                 const d = drawWith(S, e);
                 return { boundary: d.boundary, ok: d.ok, pairs: d.pairs, worstFrac: d.worstFrac }; },
        { maxIt: 120 });
      if (r && r.pts) edits[rep] = { type, pts: r.pts };
    }
  }
  const out = drawWith(S, edits);
  return { edits, sep: CD.separation(out.boundary).rel, ok: out.ok };
}

function run(c, label) {
  const S = setup(c);
  if (!S) { console.log(`${label}: config unavailable`); return null; }
  const editable = [...new Set(S.rc.filter(o => o.type !== 'I').map(o => o.rep))];
  const start = {};
  for (const rep of editable) {
    const type = (S.rc.find(o => o.rep === rep) || {}).type;
    start[rep] = { type, pts: CD.seedPoints(type, TCurves.motifPts(type, S.variant[rep] || 0), 4) };
  }
  const base = drawWith(S, start);
  const sep0 = CD.separation(base.boundary).rel;

  let best = null;
  for (let t = 0; t < STARTS; t++) {
    // start 0 is the demo motif itself, so the search can never do worse than starting from it
    const st = JSON.parse(JSON.stringify(start));
    if (t) for (const rep of editable) {
      const pts = st[rep].pts, type = st[rep].type;
      for (const f of CD.freeIndices(type, pts)) {
        if (f.x) pts[f.i][0] = Math.max(0.08, Math.min(type === 'J' ? 0.92 : 0.48,
                                pts[f.i][0] + (Math.random() * 2 - 1) * 0.12));
        pts[f.i][1] = Math.max(-0.4, Math.min(0.4, pts[f.i][1] + (Math.random() * 2 - 1) * 0.3));
      }
      pts.sort((a, b) => a[0] - b[0]);      // control points must stay in order along the edge
    }
    const r = optimise(S, editable, st);
    // a clean curve always beats an overlapping one, however well separated it looks
    const key = x => (x.ok ? 1 : 0) * 1e3 + x.sep;
    if (!best || key(r) > key(best)) best = r;
  }
  // final gate at the size the gallery judges at
  let ok120 = best.ok;
  if (best.ok) {
    const curveOf = [];
    for (let i = 0; i < S.m; i++) { const { rep, code, type } = S.rc[i];
      let ed = best.edits[rep];
      if (!ed || ed.type !== type || !Array.isArray(ed.pts)) ed = { type, pts: TCurves.motifPts(type, S.variant[rep] || 0) };
      curveOf.push(TCurves.applyMap(TCurves.buildCanon(type, ed.pts), code)); }
    try { ok120 = CO.overlapCurved(TCurves.buildCurvedTiles(S.placedCheck, S.V, curveOf)).pairs === 0; }
    catch (e) { ok120 = false; }
  }
  return { S, edits: best.edits, sep0, sepN: best.sep, ok: best.ok, ok120, editable };
}

if (process.argv.includes('--validate')) {
  // combos John reworked by hand AND gave explicit curve points
  const backup = path.join(ROOT, 'combos_backup_pre_redo');
  const files = fs.readdirSync(path.join(ROOT,'data','combos')).filter(f => f.endsWith('.json'));
  const hand = [];
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT,'data','combos', f), 'utf8'));
    if (!c.curves || !c.curveEdits) continue;
    if (!Object.values(c.curveEdits).some(e => e && Array.isArray(e.pts) && e.pts.length)) continue;
    if (fs.existsSync(path.join(backup, f)) &&
        fs.readFileSync(path.join(ROOT,'data','combos', f), 'utf8') === fs.readFileSync(path.join(backup, f), 'utf8')) continue;
    hand.push([f, c]);
  }
  console.log(`VALIDATION -- ${hand.length} combos you drew curves for by hand\n`);
  console.log('combo                              yours    demo   designed   verdict');
  let win = 0, lose = 0;
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
  for (const [f, c] of (only ? hand.filter(h => h[0].includes(only)) : hand.slice(0, 14))) {
    const S = setup(c); if (!S) continue;
    const yours = drawWith(S, JSON.parse(JSON.stringify(c.curveEdits)));
    const sepY = CD.separation(yours.boundary).rel;
    const r = run(c, f);
    if (!r) continue;
    const good = r.ok && r.sepN >= sepY * 0.9;
    const verdict = good ? 'matches' : !r.ok ? 'still overlaps' : 'WORSE than yours';
    if (good) win++; else lose++;
    console.log(`${f.replace('combo_', '').replace('.json', '').padEnd(34)}`
      + `${sepY.toFixed(4)}  ${r.sep0.toFixed(4)}  ${r.sepN.toFixed(4)}   ${verdict}`);
  }
  console.log(`\n${win} matched or beat your curve, ${lose} did not`);
  process.exit(0);
}

const target = process.argv[2];
if (!target) { console.log('usage: design_curves.js --validate | <combo.json> [--apply]'); process.exit(1); }
const file = path.isAbsolute(target) ? target : path.join(ROOT, target);
const c = JSON.parse(fs.readFileSync(file, 'utf8'));
const r = run(c, path.basename(file));
if (r) {
  console.log(`${path.basename(file)}`);
  console.log(`   separation: demo ${r.sep0.toFixed(5)}  ->  designed ${r.sepN.toFixed(5)}`
    + `   60 tiles ${r.ok ? 'clean' : 'OVERLAPS'}   120 tiles ${r.ok120 ? 'clean' : 'OVERLAPS'}`);
  if (process.argv.includes('--apply') && r.ok && r.ok120 && r.sepN > r.sep0) {
    c.curves = true; c.curveEdits = r.edits;
    fs.writeFileSync(file, JSON.stringify(c, null, 1), 'utf8');
    console.log('   written');
  } else if (process.argv.includes('--apply')) {
    console.log('   NOT written (no improvement, or the tiling still overlaps at 60 or 120 tiles)');
  }
}
