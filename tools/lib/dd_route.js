// The develop-free route, in one place, for every tool that has to judge a combo in Node: the
// census (sweep_aniso.js) and the deep-dive / certify tools (certify.js, deep_single_type.js,
// search_unbalanced.js). John, 2026-09-13: "The only time we need to develop the tiling is if we
// are drawing it." No patch is developed and no overlap test is run -- by the covering theorem a
// closing tile with a simple boundary tiles the plane -- and every criterion goes through the DD
// route (dd_patch.js + tile_symmetry.js + angle_algebra.js via isohedral_block.js).
//
// evalCombo(id, M, orient, off, si) walks one combo through the same stages as the census:
//   1. solve (the solver's round-off test keeps fake closures out)
//   2. is it a TILE at all -- curveVerdict: tile_designer.diagnose's fold/coincident/spike gate,
//      then curve_sides.js's exact bulge-sign check, then designCurves' search as the fallback
//   3. single-tile criteria on the DD route           -> isohedral
//   4. precision guard: re-solve at high precision, single tile again
//   5. blocks of 2 .. q'+r' tiles (the type's reduced orbit ratio -- never a fixed number)
// and returns what it found at each, so a tool can count and record the way it always did.
const ENG = __dirname + '/';
const H = require(ENG + 'test_harness.js');
const TC = H.TC;
const IB = require(ENG + 'isohedral_block.js');
const CHK = require(ENG + 'tiling_checks.js');
const TD = require(ENG + 'tile_designer.js');
const CD = require(ENG + 'curve_designer.js');
const TCurves = require(ENG + 'tiler_curves.js');
const CS = require(ENG + 'curve_sides.js');
const DEPS = { TC, IC: require(ENG + 'isohedral_criteria_fast.js'), CHK, AA: require(ENG + 'angle_algebra.js'),
               DD: require(ENG + 'dd_patch.js'), TS: require(ENG + 'tile_symmetry.js') };
const HP = { fdEps: 1e-6, lam: 1e-7, ftol: 1e-14, maxIt: 800 };
// Best curve clearance (fraction of the tile diameter) a curves-required tile must reach when
// curve_sides.js cannot decide. Real 0-degree tiles reach 0.03-0.06 (#25525, #3189 m5).
const CURVE_CLEAR_MIN = 1e-4;

const ctxOf = cfg => ({ k: cfg.k, n: cfg.n, ned: cfg.ned, eqs: cfg.eqs, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping });
const curveCtx = (cfg, M) => ({ TC, m: M, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping,
                                groups: H.lenGroups(cfg.whichEdge, M), eqs: cfg.eqs });

// The vertex figure from the closed vertex stars of a DD patch (both orbits present by R=2) --
// what a developed patch used to be needed for.
function ddFigure(cfg, m) {
  try {
    const ned = cfg.ned;
    const tbl = TC.sideTables(cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], m);
    const ctx = DEPS.AA.makeContext(cfg.eqs, m, tbl);
    return DEPS.DD.figure(DEPS.DD.grow(DEPS.DD.create(ctx, m, DEPS.TS.groupsFor(ctx, cfg, m).groups), 2));
  } catch (e) { return []; }
}
// true / false against the type's declared vertex degrees, or null when the type declares none.
const figureMatches = (fig, vdeg) => { const want = CHK.wantedDegrees(vdeg); return want.length ? fig.join(',') === want.join(',') : null; };

// Does this shape's straight outline need curves, and if so does ANY curve choice work?
//   { bad: false }                         -- a tile (straight, or curves exist that clear it)
//   { bad: false, shape: {A, L} }          -- THIS member can't be curved clean but another member
//                                             of its family can: judge that one from here on
//   { bad: true, reason, usedLemma }       -- not a tile
// curve_sides.js decides "no" exactly where it can (S midpoint / I contacts outright; J/U through
// the outside lemma, validated by John 2026-09-13). A "yes" always needs a curve that actually
// clears: curve_sides' own bump, the curve designer on this shape, or the designer on another
// member of the family (designShapeAndCurves walks it). curve_sides' other "no conflict" answers
// -- "no vertex-on-edge contact", "contact not forced across the family" -- are NOT a yes: they say
// a different member might avoid the contact, not that this shape can be curved clean. Taking
// them as tiles is how #25514, #25539 and #209130 were reported as new witnesses, and how 7 m5/m6
// census rows were counted as tiles with no working curve (2026-09-13).
function curveVerdict(dctx, A, L) {
  const dg = TD.diagnose({}, dctx, A, L);
  if (dg.verdict === 'not a tile') return { bad: true, usedLemma: false, reason: dg.reason };
  if (dg.verdict !== 'curves required') return { bad: false };
  const ex = CS.checkExact({ TC, TD, CD, TCurves }, dctx, A, L);
  if (ex.verdict === 'impossible') return { bad: true, usedLemma: ex.usedLemma, reason: ex.reason + ' [curve_sides]' };
  if (ex.verdict === 'no conflict' && ex.clearance > CURVE_CLEAR_MIN) return { bad: false };
  const dc = TD.designCurves({}, dctx, A, L, {}, dg, { starts: 24 });
  if (dc.clearance > CURVE_CLEAR_MIN) return { bad: false };
  // John's two exact rules (fixed points collide; no mirror) on every member of the family, every
  // branch -- cheap, and it settles rows the walk below could only fail to solve
  const fam = CS.familyExact({ TC, TD, CD, TCurves }, dctx, A, L);
  if (fam.verdict === 'impossible') return { bad: true, usedLemma: !!fam.usedLemma, reason: fam.reason + ' [curve_sides]' };
  const w = TD.designShapeAndCurves({}, dctx, A, L, {}, { starts: 24 });
  if (w.clearance > CURVE_CLEAR_MIN) return { bad: false, shape: { A: w.A.slice(), L: w.L.slice() } };
  // second attempt, wider over the family's solution branches (#25552 m8 si2 or1 off3's tile)
  const w2 = TD.designShapeAndCurves({}, dctx, A, L, {}, { starts: 24, branchStarts2: 160 });
  if (w2.clearance > CURVE_CLEAR_MIN) return { bad: false, shape: { A: w2.A.slice(), L: w2.L.slice() } };
  return { bad: true, usedLemma: false, reason: `no curve choice found that clears `
    + `${dg.problems.map(p => p.kind + (p.vertex != null ? '@v' + p.vertex : '')).join(' ')}, `
    + `on this shape or elsewhere in its family; best clearance ${Math.max(dc.clearance, w.clearance, w2.clearance).toExponential(1)} -- search, not proof` };
}

// The block bound q'+r' from the type's orbit ratio: ledger q/r, else its homeotype label.
// Found in program4 at engine/../py/ledger.json, and in program5 at tools/lib/../../data/ledger.json
// -- both are tried, so this file is byte-identical in the two places.
let _led = null;
function ledger() {
  if (!_led) {
    const fs = require('fs');
    for (const p of [ENG + '../py/ledger.json', ENG + '../../data/ledger.json']) {
      try { _led = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) {}
    }
    if (!_led) _led = {};
  }
  return _led;
}
function blockBound(id) {
  const e = ledger()[String(id)] || {};
  const qr = (e.q && e.r) ? { q: e.q, r: e.r } : IB.qrFromHomeo(e.homeo);
  return qr ? IB.maxBlockFor(qr.q, qr.r) : null;
}

// One combo, every stage. `stage` is where it stopped:
//   'noconfig'  no usable config            'reducible'  skipped (opts.skipReducible)
//   'open'      the solver found no closure  'notile'     closes, but not a tile (notTile says why)
//   'iso'       isohedral (iso = criteria)   'aniso'      no single-tile criterion; block = {size, criteria} or null
//   'tile'      a tile, and opts.tileOnly asked to stop there (certify.js)
// `tile` is true for every combo that is a valid tile (iso, aniso and 'tile').
// opts: skipReducible, tileOnly, bound (override the q'+r' block bound).
// The member of a tile's family to KEEP -- store, export, show. John, 2026-09-13: "default to the
// walk with the most clearance", clear of 60/90/180 and of near-equal lengths where that costs
// little (tile_designer.presentableShape). Never changes a verdict: criteria are judged first.
function presentable(cfg, M, A, L) {
  try { return TD.presentableShape({}, curveCtx(cfg, M), A, L); } catch (e) { return { A, L, note: 'presentable walk failed: ' + e.message }; }
}
function present(r) {
  if (!r.shown && r.tile && r.cfg) { const s = r.sp || r.sol; r.shown = presentable(r.cfg, r.M, s.A, s.L); }
  return r.shown;
}
// opts.present: also compute r.shown for every tile (shapeOf then returns it).
function evalCombo(id, M, orient, off, si, opts) {
  const r = evalComboCore(id, M, orient, off, si, opts);
  if (opts && opts.present && r.tile) present(r);
  return r;
}
function evalComboCore(id, M, orient, off, si, opts) {
  opts = opts || {};
  const out = { id, M, si, or: orient, off, stage: null, closed: false, tile: false };
  let cfg = null;
  try { H.loadType(id); cfg = H.config(id, M, orient, off, si); } catch (e) { cfg = null; }
  if (!cfg || cfg.impossible || !cfg.whichEdge || !cfg.eqs) { out.stage = 'noconfig'; return out; }
  out.cfg = cfg;
  out.reducible = !!(cfg.vertexAngle && cfg.vertexAngle.some(v => v === 0));
  if (opts.skipReducible && out.reducible) { out.stage = 'reducible'; return out; }
  const groups = H.lenGroups(cfg.whichEdge, M);
  let sol = null;
  try { sol = TC.solveTile(cfg.eqs, groups, M, { edgeSym: cfg.edgeSym }); } catch (e) { sol = null; }
  out.sol = sol;
  if (!sol || !sol.ok) { out.stage = 'open'; return out; }
  out.closed = true;

  const cv = curveVerdict(curveCtx(cfg, M), sol.A, sol.L);
  if (cv.bad) { out.stage = 'notile'; out.notTile = cv.reason; out.usedLemma = !!cv.usedLemma; return out; }
  // another member of the family is the one that can be curved clean -- judge that one
  if (cv.shape) { sol = { ...sol, A: cv.shape.A, L: cv.shape.L }; out.sol = sol; out.walked = true; }
  const ctx = ctxOf(cfg);
  let s1 = null;
  try { s1 = IB.findSmallestBlock(DEPS, ctx, sol.A, sol.L, { maxTiles: 1 }); } catch (e) { s1 = null; }
  if (s1 && s1.invalid) { out.stage = 'notile'; out.notTile = s1.reason; return out; }
  out.tile = true;
  if (s1 && s1.found) { out.stage = 'iso'; out.iso = s1.criteria; return out; }
  if (opts.tileOnly) { out.stage = 'tile'; return out; }

  // Precision guard: a candidate is re-solved at high precision and tested again, the same as
  // the census's stage 2 -- a loosely converged shape can miss a criterion it really satisfies.
  let sp = null;
  try { sp = TC.solveTile(cfg.eqs, groups, M, { edgeSym: cfg.edgeSym, ...HP }); } catch (e) { sp = null; }
  if (!sp || !sp.ok) { out.tile = false; out.stage = 'notile'; out.notTile = 'degenerate at high precision'; return out; }
  out.sp = sp;
  const cv2 = curveVerdict(curveCtx(cfg, M), sp.A, sp.L);
  if (cv2.bad) { out.tile = false; out.stage = 'notile'; out.notTile = cv2.reason; out.usedLemma = !!cv2.usedLemma; return out; }
  if (cv2.shape) { sp = { ...sp, A: cv2.shape.A, L: cv2.shape.L }; out.sp = sp; out.walked = true; }
  let s2 = null;
  try { s2 = IB.findSmallestBlock(DEPS, ctx, sp.A, sp.L, { maxTiles: 1 }); } catch (e) { s2 = null; }
  if (s2 && s2.invalid) { out.tile = false; out.stage = 'notile'; out.notTile = s2.reason; return out; }
  if (s2 && s2.found) { out.stage = 'iso'; out.iso = s2.criteria; out.rescued = true; return out; }

  out.stage = 'aniso';
  const bound = opts.bound !== undefined ? opts.bound : blockBound(id);
  out.bound = bound;
  out.block = null;
  if (bound != null) {
    try {
      const r = IB.findSmallestBlock(DEPS, ctx, sp.A, sp.L, { minTiles: 2, maxTiles: bound });
      if (r && r.found) out.block = { size: r.size, criteria: r.criteria };
    } catch (e) {}
  }
  return out;
}
// The block as the old tools recorded it: "crit@Nt", or why there is none.
const blkString = r => r.block ? `${r.block.criteria.join(',')}@${r.block.size}t`
                                : (r.bound == null ? 'none (no q:r on record)' : `none up to ${r.bound}t`);
// The shape a combo file should carry: the high-precision one when the combo got that far.
// The shape a combo file should carry: the presentable member when one was computed (present()),
// else the high-precision shape when the combo got that far, else the first solve.
// TRUE angles (2026-09-14): the solver's angles satisfy the real angle equations; a mod-360 copy does not
const shapeOf = r => { const s = r.shown || r.sp || r.sol; return { A: s.A.slice(), L: s.L.slice() }; };

module.exports = { H, TC, IB, CHK, TD, CD, TCurves, CS, DEPS, HP, CURVE_CLEAR_MIN,
                   ctxOf, curveCtx, ddFigure, figureMatches, curveVerdict, ledger, blockBound,
                   evalCombo, presentable, present, blkString, shapeOf };
