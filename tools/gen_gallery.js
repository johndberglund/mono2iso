// data/combos/*.json -> data/combos/*.svg + app/gallery_manifest.js
//
// Renders one SVG picture per saved combo (reusing manual.A/L exactly as saved, no
// re-solve, matching what loadCombo() does in the browser) and writes a generated
// manifest the gallery view loads via <script>, same reason app/cells_map.js exists:
// fetch() of a local file is blocked under file://, which is how mono2iso.html is opened.
//
// Run by hand whenever data/combos/ changes:  node tools/gen_gallery.js
//
// program5-specific paths (this is a re-pathed copy of program4's py/gen_gallery.js): the engine
// modules this loads live in tools/lib/ here, not a sibling engine/ directory, and the manifest it
// writes belongs next to the app that loads it (app/), not next to this script.
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const COMBOS_DIR = path.join(ROOT, 'data', 'combos');
const CENSUS_DIR = path.join(ROOT, 'data', 'census');
const ENGINE_DIR = path.join(__dirname, 'lib');
const APP_DIR = path.join(ROOT, 'app');

const H = require(path.join(ENGINE_DIR, 'test_harness.js'));
const TC = H.TC;
const TilerCurves = require(path.join(ENGINE_DIR, 'tiler_curves.js'));
const IC = require(path.join(ENGINE_DIR, 'isohedral_criteria.js'));
// The FAST checker -- the one deep_one_type.js uses. The slow one spent 50% of a 226-second run in
// simplifySide on a single 34-gon (profiled 2026-09-11), while the curve work on that tile took ~0.3 s.
const ICF = require(path.join(ENGINE_DIR, 'isohedral_criteria_fast.js'));
const MR = require(path.join(ENGINE_DIR, 'merge_reduce.js'));
const CG = require(path.join(ENGINE_DIR, 'congruence.js'));
const TilerSVG = require(path.join(ENGINE_DIR, 'tiler_svg.js'));
const CO = require(path.join(ENGINE_DIR, 'curved_overlap.js'));
const CHK = require(path.join(ENGINE_DIR, 'tiling_checks.js'));
const CD = require(path.join(ENGINE_DIR, 'curve_designer.js'));
const TD = require(path.join(ENGINE_DIR, 'tile_designer.js'));
// A stored curve edit is John's drawing only if it is NOT just a generated motif (at one of the
// gallery's curve factors) that an earlier run saved back into the combo. Without this, every repair
// the gallery ever persisted was treated as hand-drawn and frozen -- never re-shrunk, never
// re-motifed. On 2026-09-11, 49 of the 89 combos with stored curves held such saved-back repairs,
// and all seven self-touching gallery tiles were among them; none carried a curve John drew.
const GALLERY_FACTORS = [1, -1, 0.85, -0.85, 1.15, -1.15, 0.7, -0.7, 0.55, -0.55, 0.4, -0.4, 0.3, -0.3, 0.2, 0.12];
function isGeneratedMotif(type, pts) {
  if (!Array.isArray(pts)) return false;
  const n = TilerCurves.motifCount(type) || 1;
  for (let v = 0; v < n; v++) {
    const base = TilerCurves.motifPts(type, v);
    if (!base || base.length !== pts.length) continue;
    for (const fac of GALLERY_FACTORS) {
      let ok = true;
      for (let i = 0; i < pts.length && ok; i++)
        if (Math.abs(pts[i][0] - base[i][0]) > 1e-6 || Math.abs(pts[i][1] - base[i][1] * fac) > 1e-6) ok = false;
      if (ok) return true;
    }
  }
  return false;
}
// the curve edits a person actually drew; saved-back auto repairs are dropped so they can be revisited
function stripAuto(edits) {
  const out = {};
  for (const k of Object.keys(edits || {})) {
    const e = edits[k];
    // Deliberately does NOT special-case `auto: true` here (tried 2026-09-12, reverted). This
    // function's job is "which edits is the FACTOR LOOP free to discard and regenerate from
    // default motifs", not "which edits are hand-drawn" -- and a curve tile_designer.js's
    // coordinate descent already optimised is BETTER than anything that loop's factor/shift search
    // can produce (it only ever scales or shifts a default motif), so stripping it out here made
    // the loop throw the improvement away and rebuild from scratch, silently reverting every
    // shape+curve joint-search result back near its original clearance. isGeneratedMotif already
    // returns false for a genuinely custom curve regardless of any `auto` flag, which is exactly
    // right: keep it here, untouched, exactly as a hand-drawn curve would be. See isHandOrDesigned
    // below for the SEPARATE question ("has a person actually drawn this, or is it free to
    // re-search") that the shape-search eligibility gate actually needs.
    if (e && Array.isArray(e.pts) && e.pts.length && !isGeneratedMotif(e.type, e.pts)) out[k] = e;
  }
  return out;
}
// Has a PERSON drawn this curve, or is it free for the shape+curve joint search to redo? Unlike
// stripAuto (which the factor loop uses to decide what it may regenerate FROM DEFAULTS), this
// needs to recognise tile_designer.js's own `auto: true` marker as "not a person" -- the joint
// search must be able to revisit and improve on its OWN earlier output, e.g. a shape it picked
// before this combo carried a curve at all. isGeneratedMotif alone cannot tell the difference
// between an old factor/shift repair and a genuinely hand-drawn curve that just happens not to
// match one; `auto` is the authoritative signal wherever it is present.
function isHandDrawn(edits) {
  return Object.values(edits || {}).some(e => e && Array.isArray(e.pts) && e.pts.length && !e.auto && !isGeneratedMotif(e.type, e.pts));
}

// ---- minimal quoted-CSV reader, matches the esc() writer in sweep_aniso.js ----
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function loadCriteriaCsv(m) {
  const p = path.join(CENSUS_DIR, `criteria_m${m}.csv`);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.length);
  const hdr = parseCsvLine(lines[0]);
  return lines.slice(1).map(l => { const v = parseCsvLine(l), row = {}; hdr.forEach((h, i) => row[h] = v[i]); return row; });
}
const csvCache = {};
function metaFor(id, m, si, orient, off) {
  if (!csvCache[m]) csvCache[m] = loadCriteriaCsv(m);
  const row = csvCache[m].find(r => +r.id === id && +r.si === si && +r.orient === orient && +r.off === off);
  if (!row) return null;
  return { homeo: row.homeo, wp: row.wp, orbifold: row.orbifold, aniso: row.aniso, min_block: row.min_block, block_criteria: row.block_criteria };
}

// ---- port of mono2iso.js's curveSet()/assignCurveVariants()/ensureCurveEdit(), Node-side ----
// Kept in sync by hand with mono2iso.js:521-539 (curveSet), 353-357 (assignCurveVariants),
// 359-371 (ensureCurveEdit) -- update here if that logic changes.
// Per-type numbering (J/U/S each get their own 0,1,2,... pool) -- see mono2iso.js's matching
// comment. Keep in sync by hand.
function assignCurveVariants(orbits) {
  const seen = new Set(), byType = {};
  for (const o of orbits) { if (o.type === 'I' || seen.has(o.rep)) continue; seen.add(o.rep);
    (byType[o.type] = byType[o.type] || []).push(o.rep); }
  const variant = {};
  for (const type in byType) byType[type].sort((a, b) => a - b).forEach((r, i) => variant[r] = i);
  return variant;
}
function ensureCurveEdit(curveEdits, variant, rep, type) {
  let e = curveEdits[rep];
  if (!e || e.type !== type || !Array.isArray(e.pts)) e = curveEdits[rep] = { type, pts: TilerCurves.motifPts(type, variant[rep] || 0) };
  return e;
}
// `shrink` scales every curve PERPENDICULAR to the chord between its endpoints -- in the canonical
// [0,1] frame that is simply y *= shrink, since x runs along the chord. John, 2026-09-07: "some of
// the gallery pictures had overlapping curves ... can you shrink the curve perpendicular to the
// segment between the endpoints?"
//
// Scaling y is symmetry-safe and so cannot break the tiling: J is unconstrained, U mirrors to
// (1-x, y) and S to (1-x, -y), and both relations survive a uniform y scale. Matching edges share
// an orbit and therefore the same scaled curve, so neighbours still meet exactly.
// `variantShift` rotates which demo motif each edge orbit gets, keeping the orbits DISTINCT from
// each other (that distinction is the point of the demo curves) while offering a genuinely
// different curve shape rather than a rescaling of the same one. On #25643 m7 si16 no scale or
// flip of the default motif draws cleanly, but shift 2 does at 0.85 -- a full-strength curve
// instead of a flattened 0.2.
function curveSet(manual, curCfg, m, curveEdits, shrink, variantShift) {
  // Snapshot which orbits were hand-drawn BEFORE anything runs: ensureCurveEdit writes generated
  // motifs into the same object, so testing it later would call every orbit hand-drawn and the
  // repair would never scale anything.
  const HAND = new Set(Object.keys(curveEdits || {}).filter(k =>
    curveEdits[k] && Array.isArray(curveEdits[k].pts) && curveEdits[k].pts.length));
  const baseMgon = TC.verticesOf(manual.A, manual.L, m).slice(0, m);
  const es = curCfg.edgeSym || [], we = curCfg.whichEdge || [], mp = curCfg.mapping || [];
  const repMap = i => { let cur = i, code = 0, guard = 0;
    while (we[cur] != null && we[cur] !== cur && guard++ < m) { code ^= (mp[cur] || 0); cur = we[cur]; }
    return { rep: cur, code }; };
  const rc = []; for (let i = 0; i < m; i++) { const r = repMap(i); r.type = TilerCurves.SYM[es[r.rep]] || 'J'; rc.push(r); }
  const variant = assignCurveVariants(rc);
  const curveOf = [];
  if (variantShift) { for (const k in variant) {
    // a hand-drawn orbit keeps its own curve: ensureCurveEdit returns the stored edit and never
    // consults `variant`, but skip it anyway so the intent is visible
    if (HAND.has(String(k))) continue;
    const t = (rc.find(o => o.rep === +k) || {}).type;
    const n = TilerCurves.motifCount(t) || 1;
    variant[k] = (variant[k] + variantShift) % n; } }
  for (let i = 0; i < m; i++) { const { rep, code, type } = rc[i];
    const ed = ensureCurveEdit(curveEdits, variant, rep, type);
    let canon = TilerCurves.applyMap(TilerCurves.buildCanon(type, ed.pts), code);
    // NEVER rescale a curve the user drew. The repair below exists to rescue AUTO-GENERATED demo
    // motifs; a stored curveEdit is a deliberate hand-drawn shape, and scaling it is destroying the
    // work, not fixing it. John's #25528 m7 si2 was reworked by hand and the generator shrank his
    // curves to 0.12 and then reported the picture as still bad. John, 2026-09-09: "Can you use my
    // exact curves for the gallery?" -- yes, and this is what stopped it.
    if (!HAND.has(String(rep)) && shrink != null && shrink !== 1) canon = canon.map(pt => [pt[0], pt[1] * shrink]);
    curveOf.push(canon); }
  // The resolved curve in STORED form, so the repair can be written back into the combo. Scaling
  // the stored half-curve's y is equivalent to scaling the built canon's y: buildCanon's mirrors
  // are (1-x, y) for U and (1-x, -y) for S, both linear in y, so the scale commutes with them.
  const edits = {};
  for (const { rep, type } of rc) {
    if (edits[rep]) continue;
    if (HAND.has(String(rep))) { edits[rep] = curveEdits[rep]; continue; }
    const pts = TilerCurves.motifPts(type, variant[rep] || 0);
    const sc = (shrink == null || shrink === 1) ? 1 : shrink;
    edits[rep] = { type, pts: pts.map(pt => [pt[0], pt[1] * sc]) };
  }
  return { baseMgon, curveOf, edits };
}

// Does the tile's own curved boundary cross itself?
//
// The orientation test MUST have a tolerance. A bare Math.sign() of the cross product treats
// COLLINEAR points as a crossing whenever rounding gives the two zeros opposite signs, and a tile
// with a straight run has plenty of collinear segment pairs. That false positive fired on 100 of
// 472 combos here and, being independent of the curve height, never cleared however far the curve
// was shrunk -- which is exactly what "72 still overlapping at 0.12" was.
function curveSelfCross(pts) {
  const n = pts.length;
  let scale = 0;
  for (const p of pts) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  const EPS = 1e-9 * Math.max(1, scale) * Math.max(1, scale);   // cross products are an area
  const o = (p, q, r) => { const v = (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]);
                           return Math.abs(v) < EPS ? 0 : Math.sign(v); };
  for (let i = 0; i < n - 1; i++) for (let j = i + 2; j < n - 1; j++) {
    if (i === 0 && j === n - 2) continue;                 // wrap-adjacent
    const a = pts[i], b = pts[i+1], c = pts[j], d = pts[j+1];
    const o1 = o(a,b,c), o2 = o(a,b,d), o3 = o(c,d,a), o4 = o(c,d,b);
    // A zero means touching/collinear, not a transversal crossing -- require strict opposite signs.
    if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) return true;
  }
  return false;
}
// NOT tested: whether two different curved tiles overlap. Neighbours share their common edge
// curve EXACTLY, so the two boundaries are coincident polylines; sampled independently they cross
// each other at microscopic angles and any segment-intersection test drowns in that noise (a first
// attempt flagged 336 of 472). Distinguishing a real bulge collision from shared-boundary noise
// needs a proper area-based clipper, not a threshold picked to make the number look right. The
// tile's OWN boundary crossing itself is the defect that actually shows in these pictures, and
// that is what curveSelfCross above tests.

// ---- main ----
// GALLERY_ONLY=<regex> processes just the matching combos -- for testing without a full 25-minute run.
const ONLY = process.env.GALLERY_ONLY ? new RegExp(process.env.GALLERY_ONLY) : null;
const files = fs.readdirSync(COMBOS_DIR).filter(f => f.endsWith('.json') && fs.statSync(path.join(COMBOS_DIR, f)).isFile()
                                                  && (!ONLY || ONLY.test(f)));
const gallery = [];
let ok = 0, skipped = [];

for (const file of files) {
  const c = JSON.parse(fs.readFileSync(path.join(COMBOS_DIR, file), 'utf8'));
  H.loadType(c.id);
  const sums = H.runSums(c.m);
  const si = sums.findIndex(s => JSON.stringify(s) === c.sum);
  if (si < 0) { skipped.push([file, 'sum-type not found']); continue; }
  const cfg = H.config(c.id, c.m, c.orient, c.off, si);
  if (!cfg || cfg.impossible || !cfg.whichEdge) { skipped.push([file, 'config impossible']); continue; }
  // Saved shapes are ROUNDED (John, 2026-09-14): draw from the full-precision reclose when it rounds
  // back to the saved numbers; anything written back below is rounded again, so files stay rounded.
  {
    const rs = TC.recloseSaved(cfg.eqs, H.lenGroups(cfg.whichEdge, c.m), c.m, c.manual.A, c.manual.L);
    if (rs.ok) c.manual = { A: rs.A, L: rs.L };
    else if (rs.gapBefore > 1e-10) console.log(`  ${file}: the saved shape does not reclose near itself (${rs.reason}) -- drawn as saved`);
  }
  // A reducible combo is the same tiling padded out with redundant vertex positions -- a duplicate
  // of a smaller-m combo, which specify()'s vertexAngle mask already identifies. John, 2026-09-08:
  // "In the gallery, I don't want reducibles." (The "find combo by side sizes" search in mono2iso
  // deliberately keeps them, since you may be copying a tiling without realising it is reducible.)
  // CURATED ENTRIES ARE NEVER DROPPED FOR REDUCIBILITY.
  //
  // Dropping a reducible combo assumes its reduced form is in the gallery somewhere else. That is
  // true of the by-edge-count anisohedral catalogue, because the census enumerates every size --
  // and it is that catalogue John meant by "In the gallery, I don't want reducibles."
  //
  // It is NOT true of the hand-picked and deep-dive groups. There is no #25546 combo at m=32, 36 or
  // 40, so excluding its m=34/38/42 entries did not show the tiling more simply, it removed the
  // example: John's five hand-picked unbalanced tiles silently became two. Those groups are
  // annotated with their reducibility instead, so the fact is still visible.
  // ANISO_/NOBLK_ are deep_one_type.js finds (the #25546 dive, the 24-hour unbalanced search) --
  // deep-search output exactly like DEEP_, so the same reasoning applies.
  const curated = /^combo_(WEIRD|DEEP|UNBALQLT|ANISO|NOBLK)_/.test(file);
  if (!curated && cfg.vertexAngle && cfg.vertexAngle.some(v => v === 0)) { skipped.push([file, 'reducible (redundant vertex)']); continue; }
  // NOT A TILE, whatever the curves: a fold (a zero angle between two equal edges), two corners in
  // the same place, a zero-degree spike between straight edges, or a fatal self-touch -- judged on
  // the saved shape by tiling_checks.quality(). The conventions it also reports (an edge parked on
  // the solver clamp, a small edge ratio) are NOT grounds to exclude. On 2026-09-11 this caught
  // exactly one gallery entry, #209210 m8 si8, whose fold is forced across its whole closing family.
  {
    const qq = CHK.quality(c.manual.A, c.manual.L, null, c.m, cfg.edgeSym);
    const structural = (qq.degenerateWhy || []).filter(w => ['fold', 'coincidentVertices', 'spike', 'touch'].includes(w));
    if (structural.length && !curated) { skipped.push([file, 'not a tile (' + structural.join(', ') + ')']); continue; }
  }
  // A SECOND kind of reducible, and the gallery had no screen for it: a run of three consecutive
  // edges that the TYPE forces to be a single edge. John spotted one by eye on #25521 m8 si1 --
  // "the U curves with an S curve between them look like they could become a replacement S curve"
  // -- and asked for these excluded too. The test is combinatorial: same edge orbit either side,
  // the middle edge supplying the symmetry, and the angle equations forcing the two interior
  // angles complementary (for an S) or equal (for a U). No geometry, so it speaks about the type
  // rather than about one drawn member. See engine/merge_reduce.js.
  // WITHDRAWN 2026-09-11. This screened out ~400 combos on a rule that is only half the story.
  //
  // John: "Not all SSS or USU or JSJ etc can be replaced. Only when each orbit has them in the
  // same side." His own reduce_combo.js says the same thing: every physical boundary position is
  // covered by TWO net edges, one per orientation, and a reduction has to shrink BOTH -- otherwise
  // the two edge-walks disagree about the boundary's length. It also has to land on a sum-type that
  // actually EXISTS at the smaller m.
  //
  // mergeRuns/vertexMerges test one orbit's walk and neither of those, so they over-prune. The
  // conditions they DO check are necessary, not sufficient. Kept in engine/merge_reduce.js and
  // recorded here as a note, but no longer used to exclude anything.
  const runs = MR.mergeRuns(cfg, c.m);
  // And the 2-edge half of the same idea: a vertex the equations force straight, with the same edge
  // orbit either side. cfg.vertexAngle does not catch these. Checking a vertex and a 3-run together
  // is complete -- a longer reducible run always contains one or the other at its centre, which is
  // John's argument and which _dev_isohedral/merge_completeness.js confirms for 5-runs.
  const vm = MR.vertexMerges(cfg, c.m);
  // Recorded as a NOTE, not a verdict: these conditions are necessary for a reduction but not
  // sufficient, so "may reduce" is the strongest honest wording until the two-orbit test is built.
  const reducibleNote =
      (cfg.vertexAngle && cfg.vertexAngle.some(v => v === 0)) ? 'redundant vertex'
    : runs.length ? `may reduce: ${runs[0].types} run at ${runs[0].run.join(',')} could be one ${runs[0].becomes}`
    : vm.length ? `may reduce: vertex ${vm[0].vertex} forced straight`
    : null;

  // ---- family+curve joint search: pick a BETTER-DRAWING member of the closing family -----------
  // John, 2026-09-12, comparing his own fixes against gallery tiles he called ugly and narrow: in
  // 6 of 7 cases the CURVE was untouched -- identical control points -- and the only difference was
  // which member of the closing family the combo was drawn at (e.g. #209078 si1: clearance
  // 0.012 -> 0.045 from sliding the true-parameter driver alone, same exact S curve). The factor/
  // motif-shift loop below never touches the family, and it stops at the FIRST factor that merely
  // clears the pinch gate rather than the best one -- so a geometrically tight family member reads
  // as "fixed" the moment anything avoids literally touching. tile_designer.js's
  // designShapeAndCurves does what dragging the true-parameter slider does, automated: sample
  // family members, score each cheaply with the curve already in hand, redesign curves on only the
  // few best. Verified 2026-09-12 against all 7 of John's own fixes: matched or beat his hand
  // result on every one (often 2-4x his own clearance), in well under 2 seconds each.
  //
  // Only for a combo with NO genuine hand-drawn curve, and not curated: a hand edit often means the
  // SHAPE was chosen deliberately alongside it (John moves both together in one sitting), and a
  // curated combo's shape may be the exact witness a verdict rests on (see
  // project_witness_quality_pipeline). Moving either without asking would repeat the mistake
  // overwriting a hand-drawn curve would be -- so this can only ever replace a shape and curve that
  // were already just whatever solveTile happened to converge to.
  // The joint search costs roughly a second per combo (12-start coordinate descent on a handful of
  // family candidates) -- fine for the ~60-70 tiles that actually read as narrow, ruinous run over
  // all ~700 eligible combos on every regeneration (which took ~20s total before this). So gate it
  // on the CURRENT clearance, cheap to measure (one separation() call, no search): a tile already
  // comfortably open has nothing to gain here. NARROW_THRESHOLD sits just above the gallery's own
  // "1e-3..1e-2" bucket (61 of 808 combos measured there 2026-09-11), so it catches exactly that
  // population plus the even worse one, and leaves the 741 already-fine combos untouched.
  const NARROW_THRESHOLD = 0.015;
  let shapeSearched = false;
  const notHandCurved = !(c.curves && isHandDrawn(c.curveEdits));
  if (!curated && notHandCurved) {
    const curClr = (() => { try {
      const { rc, variant } = TD.repMapping(c.m, cfg.whichEdge, cfg.mapping, cfg.edgeSym);
      const V0 = TC.verticesOf(c.manual.A, c.manual.L, c.m).slice(0, c.m);
      const curveOf0 = rc.map(o => { let ed = (c.curveEdits || {})[o.rep];
        if (!ed || ed.type !== o.type || !Array.isArray(ed.pts) || !ed.pts.length) ed = { type: o.type, pts: TilerCurves.motifPts(o.type, variant[o.rep] || 0) };
        return TilerCurves.applyMap(TilerCurves.buildCanon(o.type, ed.pts), o.code); });
      return CD.separation(TilerCurves.curvedTile(V0, curveOf0)).rel;
    } catch (e) { return -1; } })();
    if (curClr < NARROW_THRESHOLD) {
      try {
        const groups0 = H.lenGroups(cfg.whichEdge, c.m);
        const ctx0 = { TC, m: c.m, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping, groups: groups0, eqs: cfg.eqs };
        const dDeps = { CHK, CD, TCurves: TilerCurves };
        const res0 = TD.designShapeAndCurves(dDeps, ctx0, c.manual.A, c.manual.L, stripAuto(c.curveEdits || {}), {});
        // Only accept a genuine improvement that is also a simple boundary -- a regression here
        // would be worse than leaving the combo alone.
        if (res0.clearance > curClr + 1e-4 && res0.clearance > 1e-6) {
          c.manual = { A: res0.A, L: res0.L };
          c.curves = true; c.curveEdits = res0.curveEdits;
          shapeSearched = true;
          console.log(`  ${file}: family search improved the drawing (clearance ${curClr.toPrecision(3)} -> ${res0.clearance.toPrecision(3)})`);
        }
      } catch (e) {}
    }
  }

  const verts = TC.verticesOf(c.manual.A, c.manual.L, c.m).slice(0, c.m);
  const ned = cfg.ned;
  // CONGRUENCE, for grouping the gallery by tile. From the EXACTLY re-closed shape, so a stored
  // closure gap cannot split two copies of one tile; a coarse tolerance because flexible combos are
  // saved wherever someone stopped the slider (#601101 m7 si2 and si5 are mirror images 0.04 degrees
  // apart -- the same tile). See engine/congruence.js.
  let tileKey = null, shapeKey = null;
  try {
    let KA = c.manual.A.slice(), KL = c.manual.L.slice();
    try { const kg = H.lenGroups(cfg.whichEdge, c.m), KF = TC.familyFns(cfg.eqs, kg, c.m);
          const rr = TC.closeConstrained(cfg.eqs, kg, c.m, KF.toU(KA, KL), []);
          if (rr && rr.A && rr.ok) { KA = rr.A; KL = rr.L; } } catch (e) {}
    const types = cfg.edgeSym.map(s => TilerCurves.SYM[s] || 'J');
    tileKey = CG.tileKey(KA, KL, types, cfg.whichEdge, { angRes: 0.5, lenRes: 5e-3 });
    shapeKey = CG.shapeKey(KA, KL, { angRes: 0.5, lenRes: 5e-3 });
  } catch (e) {}
  // A small patch (not the 260-tile default the app's own SVG-export button uses) -- at
  // gallery-thumbnail size 260 tiles are an unreadable smear. ~16 is enough to show the
  // curve pattern and how the tile packs against its neighbours.
  const GALLERY_TILES = 16;
  const placed = TC.develop(verts, cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], GALLERY_TILES);
  // NO LONGER JUDGED ON A 120-TILE PATCH. John, 2026-09-11: "if our program is correct, we only
  // need the shape to close and we should have a tiling."
  //
  // The angle equations force every vertex of the development to sum to exactly 360 degrees, and
  // every edge is shared by two tiles on opposite sides, so the development is a local homeomorphism
  // onto the plane. A local homeomorphism from a complete flat surface is a covering map, and the
  // plane is simply connected, so the covering is one-sheeted: a closing tile whose boundary is a
  // simple closed curve tiles with no overlaps anywhere. Curves included -- a shared curve's tangent
  // deviation from its chord is added on one side and subtracted on the other, so tangent angles
  // still sum to 360. The big patch was only ever a program self-check, and developing 120 curved
  // 34-gons inside a 128-try loop is what hung this script on the new #25546 tiles.
  //
  // Tested before switching (_dev_isohedral/test_simple_implies_clean.js): on the four combos the
  // gallery had previously needed to repair, 160 tries, the tile was simple 44 times and the 120-tile
  // patch was clean all 44. Every past repair was a self-crossing tile, which this gate still catches.
  // #209232's old "99.4% collision at 120 tiles" was develop() placing a duplicate tile -- a program
  // bug, since fixed, and exactly the kind of thing the self-check below exists to surface.
  // Full-size curve first; shrink perpendicular to the chord only if the curved tile crosses itself.
  let curveShrink = null, curveVariantShift = 0, drawBad = false, drawWorst = 0, fixedEdits = null, selfCheckFailed = 0, pinched = false, clearance = null, designed = false;
  const handCurves = c.curves && Object.keys(stripAuto(c.curveEdits)).length > 0;
  // does the file hold a saved-back auto repair? then it is revisited below, and whatever the loop
  // settles on must be written back -- even full size with no shift -- or the file and the picture
  // disagree (the #25643 si16 bug: the gallery showed one curve, clicking through loaded another)
  const hadAuto = Object.values(c.curveEdits || {})
    .some(e => e && Array.isArray(e.pts) && e.pts.length && isGeneratedMotif(e.type, e.pts));
  const draw = c.curves
    ? (() => {
        // Shrinking alone is not enough, and on some tiles it is the WRONG direction. Where the
        // tile's own boundary already touches itself -- a corner meeting an edge, which is legal
        // when that edge is J/U/S because the curve can bow clear -- flattening the curve presses
        // it INTO the touch instead of opening it. #25643's five all-S entries are exactly this:
        // RIGID combos, so no other shape exists, whose curves self-intersect and got worse at
        // 0.12 rather than better. Negative factors flip the curve to the other side of its chord,
        // the same escape hatch mono2iso offers as "flip this curve".
        // John, 2026-09-09: "25643 j and k don't [look good]."
        const FACTORS = [1, -1, 0.85, -0.85, 1.15, -1.15, 0.7, -0.7, 0.55, -0.55, 0.4, -0.4, 0.3, -0.3, 0.2, 0.12];
        // Prefer a BIG curve: walk factors outermost so the default motif at full size wins, and
        // only reach for another motif shift when nothing at that size works. A picture with a
        // visible curve says more than a flattened one that merely passes the tests.
        const TRIES = [];
        for (const f of FACTORS) for (const vs of [0, 1, 2, 3, 4, 5, 6, 7]) TRIES.push([f, vs]);
        // What to draw if no option passes: the curves AS SAVED, so the picture and the file agree.
        // (The loop below works from stripped edits, so its first try is NOT the as-saved curve.)
        const csSaved = curveSet(c.manual, cfg, c.m, c.curveEdits ? JSON.parse(JSON.stringify(c.curveEdits)) : {}, 1, 0);
        const last = TilerCurves.buildCurvedTiles(placed, csSaved.baseMgon, csSaved.curveOf);
        for (const [f, vs] of TRIES) {
          const cs = curveSet(c.manual, cfg, c.m,
            stripAuto(c.curveEdits ? JSON.parse(JSON.stringify(c.curveEdits)) : {}), f, vs);
          // THE GATE: is the single curved tile a simple closed curve? By the covering argument in
          // the note above the draw, that is all it takes for the tiling to be overlap-free.
          const selfBad = (() => { try { return curveSelfCross(TilerCurves.curvedTile(cs.baseMgon, cs.curveOf)); }
                                   catch (e) { return false; } })();
          if (selfBad) continue;
          // ...and it must not TOUCH itself either. curveSelfCross catches crossings, but a touch has no
          // crossing and no area, so neither it nor the overlap self-check can see one -- yet a boundary
          // that meets itself is a pinch point, not a simple closed curve, and the covering argument
          // needs the latter. At a zero-degree corner the default motifs, which all start flat along
          // the chord, lie right on top of each other: 7 of 805 gallery tiles did that (2026-09-11).
          const clr = (() => { try { return CD.separation(TilerCurves.curvedTile(cs.baseMgon, cs.curveOf)).rel; }
                               catch (e) { return 1; } })();
          if (clearance === null || clr > clearance) clearance = clr;
          if (clr < 1e-6) continue;
          clearance = clr;
          curveShrink = f; curveVariantShift = vs; fixedEdits = cs.edits;
          const d = TilerCurves.buildCurvedTiles(placed, cs.baseMgon, cs.curveOf);
          // PROGRAM SELF-CHECK, on the 16 tiles drawn anyway. A simple tile cannot overlap its
          // neighbours, so an overlap here is a bug in the PROGRAM, not a bad picture. It is reported
          // loudly and deliberately NOT "repaired" by shrinking curves, which would hide the bug.
          try { const ov = CO.overlapCurved(d); if (ov.pairs) { selfCheckFailed = ov.pairs; drawWorst = ov.worstFrac; } }
          catch (e) {}
          return d;
        }
        // No curve size or motif shift gives a simple tile. Every one of the FACTORS tries above
        // uses the DEFAULT motifs, which all start flat along the chord -- so none of them can ever
        // open a 0-degree corner or a touch, whatever factor or shift is tried. Before drawing the
        // tile broken, try the automated designer (tile_designer.js): its seeds leave the corner AT
        // AN ANGLE (John's own fix, generalised -- see curve_designer.js's angledSeed), which is
        // exactly the one thing this loop cannot do. It never touches an orbit with a genuine hand
        // edit (same stripAuto/isGeneratedMotif rule as above), so this can only ever rescue an
        // orbit that was already default or a stale auto-repair. Verified 2026-09-11: opened all 6
        // gallery tiles that were pinch points before this fallback existed.
        try {
          const groups = H.lenGroups(cfg.whichEdge, c.m);
          const ctx = { TC, m: c.m, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping, groups, eqs: cfg.eqs };
          const dDeps = { CHK, CD, TCurves: TilerCurves };
          const diag = TD.diagnose(dDeps, ctx, c.manual.A, c.manual.L);
          if (diag.verdict === 'curves required') {
            const desRes = TD.designCurves(dDeps, ctx, c.manual.A, c.manual.L,
              stripAuto(c.curveEdits ? JSON.parse(JSON.stringify(c.curveEdits)) : {}), diag, {});
            if (desRes.clearance > 1e-6) {
              const { rc: rc2 } = TD.repMapping(c.m, cfg.whichEdge, cfg.mapping, cfg.edgeSym);
              const baseMgon2 = TC.verticesOf(c.manual.A, c.manual.L, c.m).slice(0, c.m);
              const curveOf2 = rc2.map(o => { const ed = desRes.curveEdits[o.rep] || { type: o.type, pts: TilerCurves.motifPts(o.type, 0) };
                return TilerCurves.applyMap(TilerCurves.buildCanon(o.type, ed.pts), o.code); });
              const selfBad2 = (() => { try { return curveSelfCross(TilerCurves.curvedTile(baseMgon2, curveOf2)); }
                                        catch (e) { return true; } })();
              if (!selfBad2) {
                clearance = desRes.clearance;
                curveShrink = 1; curveVariantShift = 0; fixedEdits = desRes.curveEdits; designed = true;
                const d2 = TilerCurves.buildCurvedTiles(placed, baseMgon2, curveOf2);
                try { const ov = CO.overlapCurved(d2); if (ov.pairs) { selfCheckFailed = ov.pairs; drawWorst = ov.worstFrac; } }
                catch (e) {}
                return d2;
              }
            }
          }
        } catch (e) {}
        // No curve size, motif shift, or automated design gives a simple tile. Draw the curves as
        // saved rather than the most flattened attempt: flattening to 0.12 makes a worse picture
        // and fixes nothing, since by here 0.12 failed too.
        drawBad = true;
        // a simple try existed but every one touched itself: a pinch point rather than a crossing
        pinched = clearance !== null;
        curveShrink = 1;
        return last;
      })()
    : placed.map(t => ({ orbit: t.orbit, pts: t.verts }));
  if (selfCheckFailed) {
    console.log(`  ${file}: SELF-CHECK FAILED -- the curved tile is simple, yet ${selfCheckFailed} pair(s) `
      + `of the 16 drawn tiles overlap (worst ${(drawWorst * 100).toFixed(2)}% of a tile). By the covering `
      + `argument that cannot happen if the program is right -- LOOK AT THIS ONE`);
  } else if (designed) {
    console.log(`  ${file}: no default motif opened this (a pinch point) -- the automated designer `
      + `did, clearance ${clearance.toPrecision(3)}`);
  } else if (drawBad) {
    console.log(`  ${file}: ` + (pinched
      ? 'the curved tile TOUCHES itself (a pinch point) at every curve size and motif tried -- '
        + 'needs curves that leave the corner at an angle; drawn as saved'
      : 'the curved tile crosses itself at every curve size and motif tried; drawn with the curves as saved'));
  } else if (c.curves && handCurves && (curveShrink !== 1 || curveVariantShift)) {
    console.log(`  ${file}: hand-drawn curves kept as-is; only the auto motifs were adjusted`);
  } else if (c.curves && (curveShrink !== 1 || curveVariantShift)) {
    console.log(`  ${file}: curve factor ${curveShrink}${curveVariantShift ? ', motif shift ' + curveVariantShift : ''}`);
  }

  // Save the repair into the COMBO, not just the picture. John, 2026-09-09, on #25643 si16: "This
  // is what the gallery gives when I click the image. It is overlapping." He was right -- the
  // gallery found factor 0.85 / motif shift 2 to make that picture clean, but the combo file had no
  // curveEdits at all, so clicking through loaded the unrepaired default motif and drew the overlap
  // the picture had just been fixed to avoid. Hand-drawn orbits are passed through untouched by
  // curveSet, so this only ever persists a generated motif.
  if (fixedEdits && (curveShrink !== 1 || curveVariantShift || hadAuto || designed || shapeSearched)) {
    c.curves = true; c.curveEdits = fixedEdits;
    fs.writeFileSync(path.join(COMBOS_DIR, file), JSON.stringify({ ...c, manual: TC.roundShape(c.manual.A, c.manual.L) }, null, 1), 'utf8');
  }

  const svgName = file.replace(/\.json$/, '.svg');
  fs.writeFileSync(path.join(COMBOS_DIR, svgName), TilerSVG.tilesToSVG(draw));
  // the tile on its own (draw[0] is the base copy): the gallery shows ONE tile picture for a tile with
  // several ways of tiling, and the tilings under it (John, 2026-09-14)
  fs.writeFileSync(path.join(COMBOS_DIR, svgName.replace(/\.svg$/, '.tile.svg')), TilerSVG.tilesToSVG([draw[0]]));

  // Degrees of freedom (true-parameter count) at this combo's own saved shape -- a single
  // Jacobian-rank check (pickDrivers) at the point already known to close, NOT the full
  // 500-restart shapeFamily sampling activateFamily() falls back to for an unclosed shape.
  // 0 = rigid (nothing to drag); this is exactly what the "true parameters" panel would show
  // if you loaded this combo and turned sliders on.
  let dof = null;
  try {
    const groups = H.lenGroups(cfg.whichEdge, c.m);
    const F = TC.familyFns(cfg.eqs, groups, c.m);
    const u = F.toU(c.manual.A, c.manual.L);
    dof = TC.pickDrivers(cfg.eqs, groups, c.m, u).dim;
  } catch (e) { /* leave null if the Jacobian can't be formed */ }

  // "weird" = the hand-picked oddities (currently: John's five unbalanced 1:2 tiles) that
  // don't belong in the by-edge-count anisohedral catalog -- tagged by filename convention
  // (combo_WEIRD_<id>_...) rather than anything computed, since "weird" is a curated judgment
  // call, not a derivable property.
  // "unbalanced" = byproducts of the unbalanced-type deep dives (combo_DEEP_/combo_UNBALQLT_
  // prefixes) -- these are single-type search output (any m the search happened to reach), not
  // part of the by-edge-count low-edge census, and were getting swept into 'aniso' by default
  // until John asked for them split out (2026-08-06).
  // The anisohedral group must be EARNED, not fallen into.
  //
  // This used to be decided by filename prefix alone, with everything unprefixed defaulting to
  // 'aniso' -- so any combo saved into combos/ for any other reason was presented as an
  // anisohedral find. John caught it: "How did #1512 m=6 sneak in to anisohedral in the gallery?
  // It is isohedral." The census had it right all along (aniso = "no (tile)", iso_criteria 1); the
  // verdict was fetched as `meta` two lines below and simply never consulted. Same shape of mistake
  // as searched_to_m defaulting to 8 -- a default wearing the clothes of a finding.
  const meta = metaFor(c.id, c.m, si, c.orient, c.off);
  // When the census has no row -- anything outside the m=3..8 sweep -- do not shrug and call it
  // "uncensused": run the isohedral block criteria here and get an answer. John spotted both cases
  // this covers by eye ("#1512 m=6 ... It is isohedral", "#3215 m=9 ... It looks isohedral"), and
  // both do match criterion 1. A missing census row is a reason to check, not a reason to guess.
  // A file whose prefix already settles its group needs no isohedral re-test. An ANISO_ combo is
  // deep_one_type.js output, block-checked the moment it was found; re-testing it is what made one
  // #25546 34-gon cost 226 seconds.
  const prefixGroup = /^combo_(WEIRD|DEEP|UNBALQLT|ANISO|NOBLK)_/.test(file);
  let isoHit = null;
  if (!meta && !prefixGroup) {
    try {
      isoHit = ICF.checkBlock(placed, [new Array(c.m).fill(-1)], [0],
                             { whichEdge: cfg.whichEdge, edgeSym: cfg.edgeSym, mapping: cfg.mapping },
                             null, { any: true }).matches;
    } catch (e) { isoHit = null; }
  }
  const group = /^combo_WEIRD_/.test(file) ? 'weird'
    : /^combo_(DEEP|UNBALQLT|ANISO|NOBLK)_/.test(file) ? 'unbalanced'
    : meta ? (meta.aniso === 'YES' ? 'aniso' : 'isohedral')
    : (isoHit && isoHit.length) ? 'isohedral'           // no census row, but it satisfies a criterion
    : 'uncensused';                                     // no row and no criterion matched: unjudged
  gallery.push({ file, svg: svgName, combo: { ...c, manual: TC.roundShape(c.manual.A, c.manual.L) }, si, dof, meta, group,
                 tileKey, shapeKey, selfCheckFailed: selfCheckFailed || undefined,
                 clearance: clearance == null ? undefined : +clearance.toPrecision(3), pinched: pinched || undefined,
                 designed: designed || undefined, shapeSearched: shapeSearched || undefined,
                 reducible: reducibleNote || undefined,
                 isoCriteria: (isoHit && isoHit.length) ? isoHit.join(',') : undefined,
                 curveShrink, curveVariantShift: curveVariantShift || undefined, curveOverlap: drawBad || undefined });
  ok++;
  console.log(`wrote ${svgName}`);
}

// GALLERY_MERGE=1 with GALLERY_ONLY: render just the matching combos and MERGE them into the real
// manifest, replacing any old entries for those files -- how to add a few combos without a full run,
// which revisits (and may rewrite the repaired curves of) every combo in the gallery.
const MERGE = !!(ONLY && process.env.GALLERY_MERGE);
if (MERGE) {
  const MANIFEST = path.join(APP_DIR, 'gallery_manifest.js');
  const vctx = {}; require('vm').createContext(vctx);
  require('vm').runInContext(fs.readFileSync(MANIFEST, 'utf8') + ';this.G = GALLERY;', vctx);
  const kept = vctx.G.filter(e => !ONLY.test(e.file));
  console.log(`\nGALLERY_MERGE: ${gallery.length} rendered, merged into ${kept.length} kept entries`);
  gallery.unshift(...kept);
}

// Sort so the gallery view can just render in array order: anisohedral catalog first,
// ascending by edge count then id (John: "start with the 4s, then the 5s"), then the unbalanced
// deep-dive byproducts, weird ones last. Within a fixed (id, m) the sort is by si/orient/off,
// which is also what fixes the letter order assigned next.
const GROUP_ORDER = { aniso: 0, unbalanced: 1, weird: 2 };
gallery.sort((a, b) => (GROUP_ORDER[a.group] - GROUP_ORDER[b.group])
  || (a.combo.m - b.combo.m) || (a.combo.id - b.combo.id)
  || (a.si - b.si) || (a.combo.orient - b.combo.orient) || (a.combo.off - b.combo.off));

// John: "size 6 of #25520 has many options... give the sum type, reflect or not, and offset.
// Or #25520 and a letter, so we can know which ones we're talking about." Do both: a short
// letter suffix (only when a given (id, m) has more than one saved combo, so it doesn't add
// noise to the common single-combo case) for talking about "#25520a" in conversation, plus the
// exact sum/reflect/offset for precision.
const byIdM = {};
gallery.forEach(e => { const k = e.combo.id + ':' + e.combo.m; (byIdM[k] = byIdM[k] || []).push(e); });
const letterFor = i => i < 26 ? String.fromCharCode(97 + i) : 'a' + (i - 25);  // a..z, then a1, a2, ...
for (const k of Object.keys(byIdM)) {
  const grp = byIdM[k];
  grp.forEach((e, i) => { e.label = '#' + e.combo.id + (grp.length > 1 ? letterFor(i) : ''); });
}

const manifest = '// GENERATED by tools/gen_gallery.js from data/combos/*.json + data/census/criteria_m<m>.csv -- do not edit.\n' +
  'var GALLERY = ' + JSON.stringify(gallery, null, 1) + ';\n';
// With GALLERY_ONLY set the manifest would hold just the test combos, replacing the whole gallery.
if (ONLY && !MERGE) {
  // write the test entries to a SIDE file so they can be inspected; the real manifest is untouched
  const out = path.join(APP_DIR, `gallery_manifest.${process.env.GALLERY_OUT || 'only'}.js`);
  fs.writeFileSync(out, manifest);
  console.log(`\nGALLERY_ONLY set -- ${gallery.length} entries written to ${path.basename(out)}; real manifest untouched`);
} else fs.writeFileSync(path.join(APP_DIR, 'gallery_manifest.js'), manifest);

if (!ONLY) console.log(`\n${ok}/${files.length} combos rendered -> app/gallery_manifest.js`);
if (skipped.length) { console.log('skipped:'); skipped.forEach(([f, why]) => console.log(`  ${f}: ${why}`)); }
