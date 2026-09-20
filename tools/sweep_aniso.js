// program5 copy: generated from program4/engine/_dev_isohedral/sweep_aniso.js with paths re-pointed at
// tools/lib/ and data/ (2026-09-13). Edit the program4 original and regenerate, not this copy.
// Per-COMBO anisohedral hunt at one polygon size. Stage order is John's (2026-07-26):
//   1. cheap single-tile isohedral test on every closing combo  -- stops at the FIRST criterion
//   2. precision guard: re-solve the remaining candidates tightly and re-test
//   3. block proof on what still looks anisohedral: blocks of 2 .. q'+r' tiles through the
//      develop-free DD route. (The overlap test that used to run here is gone -- 2026-09-13,
//      covering theorem; the solver's round-off test now keeps fake closures out instead.)
// The overlap test moved to the end because a badly-converged solve both fails it AND fails
// every geometric fit, so running it first silently discarded real tilings -- 11 of the 27 m=5
// combos it had excluded turned out to be clean. John: "In real life, I don't think anything
// should fail the overlap test. It means that we have a bad procedure somewhere."
// Early exit ({any:true}) throughout: the sweep only asks "is this isohedral at all", so
// enumerating the remaining criteria is pure waste, and it lets the reversed pass be skipped
// whenever the forward pass already found one.
//     node sweep_aniso.js <m>
const fs = require('fs');
const H = require(__dirname + '/lib/test_harness.js');
const IC = require(__dirname + '/lib/isohedral_criteria.js');
const CHK = require(__dirname + '/lib/tiling_checks.js');
const TC = H.TC;
// The develop-free route (John, 2026-09-13: "The only time we need to develop the tiling is if we
// are drawing it."). Tiles, adjacency and block boundaries come from the DD data (dd_patch.js,
// tile_symmetry.js), and every angle relation in the criteria is decided by the angle equations
// (angle_algebra.js). No patch is developed and no overlap test is run: by the covering theorem a
// closing tile with a simple boundary tiles the plane.
const ENG = __dirname + '/lib/';
// The develop-free route's shared pieces -- the curve check (is it a tile at all), the DD vertex
// figure, the criteria dependencies -- live in dd_route.js, so this census and the deep-dive tools
// (certify.js, deep_single_type.js, search_unbalanced.js) judge a combo with the same code.
// curveVerdict runs on EVERY row that needs curves, not only anisohedral candidates (John: "yes,
// every row") -- #3197 m6 si8 was recorded as an isohedral TILE despite having exactly #3234
// si8's forced conflict.
const R = require(ENG + 'dd_route.js');
const { IB, DEPS, ctxOf, curveVerdict, ddFigure, figureMatches } = R;
const M = +process.argv[2];
// The 70 rows (m6/7/8) whose "not a tile" verdict relied on curve_sides.js's outside lemma were
// written out once for John to check. He reviewed every one and confirmed it, 2026-09-13 ("I agree
// these are impossible. Let's stop having me check them."), and the review folder was then removed.
// Kept only as a counter for the run's own summary line.
let _lemmaCount = 0;
function recordLemma() { _lemmaCount++; }
const HP = { fdEps: 1e-6, lam: 1e-7, ftol: 1e-14, maxIt: 800 };
const led = JSON.parse(fs.readFileSync(__dirname + '/../data/ledger.json', 'utf8'));
// Which types to sweep. The filter used to be purely combinatorial -- does this type's k and n
// fit in an m-gon -- so it swept the 362 types we have PROVEN impossible right along with the
// rest. At m=8 that is 170 of 1027 types carrying 13% of the sum-types, spent on types that
// cannot yield an anisohedral tile by construction (John, 2026-09-06: "Didn't we prove a bunch of
// types impossible?").
//   node sweep_aniso.js <m> [--with-impossible]
// The flag puts them back, as a CONSISTENCY CHECK: an impossible type producing aniso=YES would
// contradict its proof and is worth knowing about. Skipped ids are listed in the summary so the
// CSV is never quietly narrower than it looks.
const WITH_IMP = process.argv.includes('--with-impossible');
// --deep-budget=<seconds>: cap each DEEP isohedral check by running it in a child process and
// killing it past the budget. Default 0 = unlimited, i.e. exactly the behaviour this sweep has
// always had, so a plain run is unchanged.
//
// Why it exists: the deep check, not the solver, is what makes m=8 unfinishable. Solve+develop
// completes all 1020 candidates in about 3 minutes; the deep checks alongside them run 6.4s,
// 35.7s, and -- on #25543 si18 or0 off2 -- past 74 minutes still going. isohedral_criteria.js is
// the permanent oracle and must not be modified to accept a deadline, so a killable child is the
// only way to bound it.
//
// A timed-out row is NOT recorded as "not isohedral". It carries an explicit
// "deep check not completed" note and continues to stage 3, so nobody can mistake an unfinished
// test for a settled answer.
const DEEP_BUDGET = (() => { const a = process.argv.find(x => x.startsWith('--deep-budget='));
  return a ? Math.max(0, +a.split('=')[1] || 0) : 0; })();
// Reducible combos are SKIPPED, early, before the solver runs. specify() already identifies them
// -- a combo whose vertexAngle mask has a 0 is the same tiling padded out with redundant vertex
// positions, i.e. a duplicate of a smaller-m combo -- and John's original program skips them for
// exactly that reason. Testing a duplicate for anisohedrality is meaningless work AND pollutes the
// census: 301 of the 832 anisohedral rows in the first m=8 run (36%) were reducible, spanning 18
// types that have no irreducible anisohedral row at all.
//   --with-reducible   keep them (the "find combo by side sizes" use case, where you may be
//                      copying a tiling without realising it is reducible -- but that lives in
//                      tilerTest, not here; this flag is for diagnosis).
// John, 2026-09-08: "In the gallery, I don't want reducibles. In the criterion lists, I don't want
// reducible ... For criteria lists, skip reducibles early."
const WITH_RED = process.argv.includes('--with-reducible');
let _redSkipped = 0;
const { spawnSync } = require('child_process');
let _deepTimeouts = 0;
const allIds = Object.entries(H.DATA.byId).filter(([, t]) => t.k <= M && t.n <= M).map(([id]) => +id);
const impossibleIds = allIds.filter(id => led[id] && led[id].verdict === 'impossible');
const ids = WITH_IMP ? allIds : allIds.filter(id => !(led[id] && led[id].verdict === 'impossible'));
// ---- progress checkpointing -------------------------------------------------------------
// The CSV used to be written only at the very end, so a run that was interrupted left nothing at
// all: m=8 was killed after 14h46m (10.7 CPU-hours) having finished stage 1 in 364s and then spent
// the rest in stage 2, and NONE of that survived. John, 2026-09-06: "Next time we run m=8, let's
// have it save progress while we go."
// Two things land on disk as the run proceeds: the rows so far (a valid CSV at every moment, so it
// can be inspected mid-run), and a one-line status file saying which stage and item it is on --
// there was previously no way to tell a working sweep from a hung one.
// --out=<path.csv> writes somewhere other than the census file (e.g. to compare a changed sweep
// against the published criteria_m<M>.csv without overwriting it).
const OUTCSV = (() => { const a = process.argv.find(x => x.startsWith('--out=')); return a ? a.slice(6) : null; })()
  || `${__dirname}/../data/census/criteria_m${M}.csv`;
const PROGF = `${__dirname}/../data/census/criteria_m${M}.progress.json`;
let _lastCk = 0, _stageT0 = Date.now(), _stageName = '';
function checkpoint(rows, hdr, esc, stage, done, total, force) {
  const now = Date.now();
  if (stage !== _stageName) { _stageName = stage; _stageT0 = now; }
  if (!force && now - _lastCk < 30000) return;         // at most every 30s; the write is not free
  _lastCk = now;
  try {
    fs.writeFileSync(OUTCSV + '.partial',
      [hdr.join(',')].concat(rows.map(r => hdr.map(h => esc(r[h])).join(','))).join('\n') + '\n');
    // A rate and an ETA for THIS stage, so a run that is going to take 30 hours says so within
    // the first few minutes instead of at hour 15. Stage 2 was the killer last time -- 1021
    // candidates, 14h46m, no output and no way to tell working from hung.
    const secs = (now - _stageT0) / 1000;
    const rate = done > 0 ? secs / done : null;                  // seconds per item
    fs.writeFileSync(PROGF, JSON.stringify({ m: M, stage, done, total,
      rows: rows.length, pct: total ? +(100 * done / total).toFixed(1) : null,
      secPerItem: rate ? +rate.toFixed(2) : null,
      stageEtaMin: rate && total ? +((rate * (total - done)) / 60).toFixed(1) : null,
      elapsedS: +((now - t0all) / 1000).toFixed(1), updated: new Date(now).toISOString() }, null, 1));
  } catch (e) {}
}
const T = { solve: 0, curve: 0, iso: 0, prec: 0, ovl: 0, blk: 0 };
const tick = () => process.hrtime.bigint();
const add = (k, t0) => { T[k] += Number(tick() - t0) / 1e6; };

const rows = [];
const t0all = Date.now();
console.log(`m=${M}: ${ids.length} types to sweep`
  + (WITH_IMP ? ` (including ${impossibleIds.length} proven impossible, --with-impossible)`
              : ` (${impossibleIds.length} proven-impossible types skipped)`));

// The CSV shape is declared up here rather than at the end, because the checkpoint writer needs
// it while the stages are still running.
const hdr = ['id', 'm', 'si', 'orient', 'off', 'curves', 'patch_ov', 'angles', 'lengths', 'whichEdge', 'mapping', 'iso_criteria', 'deep_criteria', 'aniso', 'min_block', 'block_criteria', 'block_bound', 'min_angle', 'spike_fatal', 'edge_ratio', 'on_clamp', 'vertex_figure', 'vdeg_match', 'homeo', 'wp', 'orbifold', 'evidence'];
const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

// ---- stage 1: cheap isohedral test on everything ----
let _c1 = 0;
for (const id of ids) {
  checkpoint(rows, hdr, esc, 'stage 1 solve + isohedral', _c1++, ids.length);
  H.loadType(id);
  let sums; try { sums = H.runSums(M); } catch (e) { continue; }
  for (let si = 0; si < sums.length; si++) for (const or of [0, 1]) for (let off = 0; off < M; off++) {
    let t = tick(); let r = null;
    // Inlined solveAndDevelop so the reducibility test can happen BETWEEN config and solve --
    // calling H.config separately first and then solveAndDevelop would build the config twice,
    // and config is ~27% of this bucket (see reference_profiling_traps).
    try {
      const cfg = H.config(id, M, or, off, si);
      if (!cfg || cfg.impossible || !cfg.whichEdge) { add('solve', t); continue; }
      if (!WITH_RED && cfg.vertexAngle && cfg.vertexAngle.some(v => v === 0)) {
        _redSkipped++; add('solve', t); continue;
      }
      const sol = TC.solveTile(cfg.eqs, H.lenGroups(cfg.whichEdge, M), M, { edgeSym: cfg.edgeSym });
      if (!sol || !sol.A) { add('solve', t); continue; }
      r = { sol, cfg };
    } catch (e) { add('solve', t); continue; }
    add('solve', t);
    if (!r || !r.sol || !r.sol.ok) continue;
    t = tick();
    const dctx = { TC, m: M, edgeSym: r.cfg.edgeSym, whichEdge: r.cfg.whichEdge, mapping: r.cfg.mapping,
                   groups: H.lenGroups(r.cfg.whichEdge, M), eqs: r.cfg.eqs };
    const cv = curveVerdict(dctx, r.sol.A, r.sol.L);
    add('curve', t);
    // another member of the family is the one that can be curved clean -- judge and record that one
    if (!cv.bad && cv.shape) r.sol = { ...r.sol, A: cv.shape.A, L: cv.shape.L };
    const L = led[id] || {};
    if (cv.bad) {
      if (cv.usedLemma) recordLemma();
      const q1 = CHK.quality(r.sol.A, r.sol.L, r.sol.flat, M, r.cfg.edgeSym);
      rows.push({
        min_angle: q1.minAngle.toFixed(2), spike_fatal: q1.spikeFatal ? 'YES' : '',
        edge_ratio: q1.edgeRatio.toFixed(4), on_clamp: q1.onClamp ? 'YES' : '',
        vertex_figure: '', vdeg_match: '',
        id, m: M, si, orient: or, off, curves: r.cfg.edgeSym.map(s => 'JUIS'[s]).join(''),
        angles: r.sol.A.map(a => a.toFixed(2)).join(' '),
        lengths: r.sol.L.map(x => x.toFixed(4)).join(' '),
        whichEdge: r.cfg.whichEdge.join(' '), mapping: r.cfg.mapping.join(' '),
        iso_criteria: '(not a tile)', deep_criteria: '', patch_ov: '',
        aniso: `n/a (not a tile: ${cv.reason})`, min_block: '', block_criteria: '',
        homeo: L.homeo || '', wp: L.wallpaper_group || '', orbifold: L.orbifold || '', evidence: L.evidence || ''
      });
      continue;
    }
    t = tick();
    let iso = [];
    try { const s1 = IB.findSmallestBlock(DEPS, ctxOf(r.cfg), r.sol.A, r.sol.L, { maxTiles: 1 }); if (s1.found) iso = s1.criteria; } catch (e) {}
    add('iso', t);
    // Additive diagnostics (2026-09-06). They do NOT feed any decision here -- the aniso verdict
    // is produced by exactly the stages it always was -- they record what the new checks see, so
    // a bad-looking row can be spotted without re-running the sweep. `vdeg_match` is the check
    // certify.js never had; `on_clamp` marks a length parked on a solver bound, which is an
    // artefact rather than a shape.
    const q1 = CHK.quality(r.sol.A, r.sol.L, r.sol.flat, M, r.cfg.edgeSym);
    const vf1 = ddFigure(r.cfg, M);
    const vdeg = (H.DATA.index.find(e => e.id === id) || {}).vdeg;
    const vm1 = figureMatches(vf1, vdeg);
    rows.push({
      min_angle: q1.minAngle.toFixed(2), spike_fatal: q1.spikeFatal ? 'YES' : '',
      edge_ratio: q1.edgeRatio.toFixed(4),
      on_clamp: q1.onClamp ? 'YES' : '', vertex_figure: vf1.join(' '),
      vdeg_match: vm1 == null ? '' : (vm1 ? 'yes' : 'NO'),
      id, m: M, si, orient: or, off, curves: r.cfg.edgeSym.map(s => 'JUIS'[s]).join(''),
      angles: r.sol.A.map(a => a.toFixed(2)).join(' '),
      lengths: r.sol.L.map(x => x.toFixed(4)).join(' '),
      whichEdge: r.cfg.whichEdge.join(' '), mapping: r.cfg.mapping.join(' '),
      iso_criteria: iso.join(','), deep_criteria: '', patch_ov: '', aniso: '',
      min_block: '', block_criteria: '',
      homeo: L.homeo || '', wp: L.wallpaper_group || '', orbifold: L.orbifold || '', evidence: L.evidence || ''
    });
  }
}
console.log(`m=${M}: ${rows.length} closing combos across ${ids.length} types`
  + (WITH_RED ? '  (reducible combos INCLUDED, --with-reducible)'
              : `  (${_redSkipped} reducible combos skipped -- duplicates of smaller m)`));
console.log(`  stage 1  solve ${(T.solve / 1000).toFixed(1)}s + isohedral ${(T.iso / 1000).toFixed(1)}s  ->  ${rows.filter(x => x.iso_criteria).length} isohedral, ${rows.filter(x => !x.iso_criteria).length} candidates`);

checkpoint(rows, hdr, esc, 'stage 1 complete', ids.length, ids.length, true);

// ---- stage 2: precision guard ----
const cands = rows.filter(x => !x.iso_criteria && !x.aniso);
let _c2 = 0;
for (const c of cands) {
  checkpoint(rows, hdr, esc, 'stage 2 precision guard', _c2++, cands.length);
  const t = tick();
  H.loadType(c.id); H.runSums(M);
  const cfg = H.config(c.id, M, c.orient, c.off, c.si);
  const sp = (cfg && !cfg.impossible && cfg.whichEdge)
    ? TC.solveTile(cfg.eqs, H.lenGroups(cfg.whichEdge, M), M, { edgeSym: cfg.edgeSym, ...HP }) : null;
  if (!sp || !sp.ok) {
    c.aniso = 'n/a (tile degenerate at high precision)';
    c.deep_criteria = (sp && sp.reason || '').slice(0, 60);
    add('prec', t); continue;
  }
  const V = TC.verticesOf(sp.A, sp.L, M).slice(0, M);
  const placed = [{ orbit: 0, T: [1, 0, 0, 1, 0, 0], verts: V }];   // the deep check reads tile 0 only
  c.angles = sp.A.map(a => a.toFixed(2)).join(' ');
  c.lengths = sp.L.map(x => x.toFixed(4)).join(' ');
  { const q2 = CHK.quality(sp.A, sp.L, sp.flat, M, cfg.edgeSym);
    c.min_angle = q2.minAngle.toFixed(2); c.spike_fatal = q2.spikeFatal ? 'YES' : '';
    c.edge_ratio = q2.edgeRatio.toFixed(4);
    c.on_clamp = q2.onClamp ? 'YES' : '';
    // The vertex figure is PATCH-SIZE DEPENDENT: a vertex only counts once its angles sum to 360,
    // so a high-degree vertex needs enough tiles around it to close. At 60 tiles #72989 reports
    // {3,4} and looks like a mismatch; at 120+ it reports {3,4,6} and matches the type. John spotted
    // it on screen (2026-09-08) -- tilerTest draws a bigger patch, so it showed the checkmark while
    // this CSV said NO. Only re-develop when the small patch disagrees, which is rare, so the cost
    // is negligible.
    const vdegWanted = (H.DATA.index.find(e => e.id === c.id) || {}).vdeg;
    // From the DD vertex stars, which see every vertex close at once -- the developed-patch
    // version needed a 400-tile re-develop whenever 60 tiles missed a high-degree vertex.
    const vf2 = ddFigure(cfg, M), vm2 = figureMatches(vf2, vdegWanted);
    c.vertex_figure = vf2.join(' '); c.vdeg_match = vm2 == null ? '' : (vm2 ? 'yes' : 'NO'); }
  const ed = { whichEdge: cfg.whichEdge, edgeSym: cfg.edgeSym, mapping: cfg.mapping };
  let re = [];
  try { const s2 = IB.findSmallestBlock(DEPS, ctxOf(cfg), sp.A, sp.L, { maxTiles: 1 }); if (s2.found) re = s2.criteria; } catch (e) {}
  add('prec', t);
  if (re.length) { c.iso_criteria = re.join(','); c.aniso = 'no (after re-solve)'; continue; }
  const t2 = tick();
  let dp = [], deepTimedOut = false;
  if (DEEP_BUDGET > 0) {
    const r = spawnSync(process.execPath,
      [require('path').join(__dirname, 'deep_check_child.js'), c.id, M, c.si, c.orient, c.off],
      { timeout: DEEP_BUDGET * 1000, encoding: 'utf8' });
    if (r.error || r.signal) { deepTimedOut = true; _deepTimeouts++; }
    else dp = String(r.stdout || '').trim() ? String(r.stdout).trim().split(',') : [];
  } else {
    try { dp = IC.checkBlock(placed, [new Array(M).fill(-1)], [0], ed, null, { deep: true, any: true }).matches; } catch (e) {}
  }
  add('prec', t2);
  if (deepTimedOut) {
    // Unknown, not negative. Say so in the row and carry on to stage 3.
    c.deep_criteria = `deep check not completed (over ${DEEP_BUDGET}s)`;
    c._sp = sp; c._cfg = cfg; c._ed = ed;
    continue;
  }
  c.deep_criteria = dp.join(',');
  if (dp.length) { c.aniso = 'no (deep)'; continue; }
  c._sp = sp; c._cfg = cfg; c._ed = ed;
}
if (_deepTimeouts) console.log(`  stage 2  WARNING: ${_deepTimeouts} deep checks hit the ${DEEP_BUDGET}s budget and did NOT complete`
  + ` -- those rows say so in deep_criteria and must not be read as "not isohedral"`);
console.log(`  stage 2  precision guard ${(T.prec / 1000).toFixed(1)}s  ->  ${cands.filter(x => x.aniso && x.aniso.startsWith('no')).length} rescued isohedral, ${cands.filter(x => x.aniso && x.aniso.startsWith('n/a')).length} degenerate, ${cands.filter(x => x._sp).length} still candidates`);

checkpoint(rows, hdr, esc, 'stage 2 complete', cands.length, cands.length, true);

// ---- stage 3: overlap test LAST, then block proof ----
const stage3 = cands.filter(x => x._sp);
let _c3 = 0;
for (const c of stage3) {
  checkpoint(rows, hdr, esc, 'stage 3 block proof', _c3++, stage3.length);
  // No overlap test (John, 2026-09-13): by the covering theorem a closing tile with a simple
  // boundary tiles the plane, so the developed-patch overlap check only ever tested develop()
  // itself. "Is this a real tile?" is answered by the solver's round-off test (a stage-2 solve
  // not at true closure against its shortest edge never reaches here) plus the fold/coincident/
  // spike gate inside findSmallestBlock.
  c.patch_ov = 'not needed (covering theorem)';
  const t = tick();
  // Curves must be able to open every 0-degree corner, touch and crossing of the straight
  // outline -- curveVerdict tries the exact check first (curve_sides.js), falling back to
  // designCurves' search only when the exact check can't decide (see its definition above).
  {
    const dctx = { TC, m: M, edgeSym: c._cfg.edgeSym, whichEdge: c._cfg.whichEdge, mapping: c._cfg.mapping,
                   groups: H.lenGroups(c._cfg.whichEdge, M), eqs: c._cfg.eqs };
    const cv = curveVerdict(dctx, c._sp.A, c._sp.L);
    if (!cv.bad && cv.shape) {                     // judge and record the curvable family member
      c._sp = { ...c._sp, A: cv.shape.A, L: cv.shape.L };
      c.angles = c._sp.A.map(a => a.toFixed(2)).join(' ');
      c.lengths = c._sp.L.map(x => x.toFixed(4)).join(' ');
    }
    if (cv.bad) {
      add('blk', t);
      if (cv.usedLemma) recordLemma();
      c.aniso = `n/a (not a tile: ${cv.reason})`;
      continue;
    }
  }
  // Block sizes 2 .. q'+r' (the reduced orbit ratio), smallest first, stop at the first proof.
  // The bound comes from the type, never a fixed number: a higher-order unbalanced type needs
  // bigger blocks (John, 2026-09-13).
  const Lr = led[c.id] || {};
  const qr = (Lr.q && Lr.r) ? { q: Lr.q, r: Lr.r } : IB.qrFromHomeo(Lr.homeo);
  const bound = qr ? IB.maxBlockFor(qr.q, qr.r) : null;
  c.block_bound = bound == null ? 'unknown (no q:r)' : bound;
  let res = null;
  if (bound != null) {
    try { res = IB.findSmallestBlock(DEPS, ctxOf(c._cfg), c._sp.A, c._sp.L, { minTiles: 2, maxTiles: bound }); } catch (e) { res = null; }
  }
  add('blk', t);
  if (res && res.invalid) { c.aniso = `n/a (not a tile: ${res.reason})`; continue; }
  c.aniso = 'YES';
  if (res && res.found) { c.min_block = res.size; c.block_criteria = res.criteria.join(','); }
  // Record the presentable member of the family for every anisohedral row -- most clearance, clear
  // of 60/90/180 and of near-equal lengths where possible (John, 2026-09-13). Criteria and block
  // were judged above on the judged shape; this only picks which member the row stores.
  { const sh = R.presentable(c._cfg, M, c._sp.A, c._sp.L);
    if (sh && sh.A) {
      c.angles = sh.A.map(a => a.toFixed(2)).join(' ');
      c.lengths = sh.L.map(x => x.toFixed(4)).join(' ');
      const q3 = CHK.quality(sh.A, sh.L, null, M, c._cfg.edgeSym);
      c.min_angle = q3.minAngle.toFixed(2); c.spike_fatal = q3.spikeFatal ? 'YES' : '';
      c.edge_ratio = q3.edgeRatio.toFixed(4); c.on_clamp = q3.onClamp ? 'YES' : '';
    } }
}
for (const x of rows) {
  if (!x.aniso) x.aniso = 'no (tile)';
  if (x.patch_ov === '') x.patch_ov = 'not tested';
  delete x._sp; delete x._cfg; delete x._ed;
}
const anis = rows.filter(x => x.aniso === 'YES');
if (WITH_IMP) {
  const contra = anis.filter(a => led[a.id] && led[a.id].verdict === 'impossible');
  if (contra.length) console.log(`  !! ${contra.length} anisohedral rows on PROVEN IMPOSSIBLE types -- `
    + `contradiction, investigate: ${[...new Set(contra.map(c => '#' + c.id))].join(', ')}`);
}
console.log(`  stage 3  block proof ${(T.blk / 1000).toFixed(1)}s  (blocks up to q'+r' tiles per type; no overlap test)`);
console.log(`  -->  isohedral ${rows.filter(x => x.aniso.startsWith('no')).length} | degenerate ${rows.filter(x => x.aniso.startsWith('n/a (tile')).length} | not a tile ${rows.filter(x => x.aniso.startsWith('n/a (not a tile')).length} | ANISOHEDRAL ${anis.length}`);
anis.forEach(a => console.log(`     #${a.id} si=${a.si} or=${a.orient} off=${a.off} ${a.curves}  -> criterion ${a.block_criteria || '?'} on a ${a.min_block || '?'}-tile block`));
console.log(`  diagnostics: ${rows.filter(x => x.on_clamp === 'YES').length} rows with a length on a clamp floor, `
  + `${rows.filter(x => +x.min_angle < 3).length} with an angle under 3 deg, `
  + `${rows.filter(x => x.vdeg_match === 'NO').length} whose vertex figure differs from the type`);
// How many of THIS run's verdicts used the outside lemma (validated by John, 2026-09-13).
console.log(`  outside lemma: ${_lemmaCount} row(s) this run relied on it (validated by John, 2026-09-13)`);
try { fs.unlinkSync(OUTCSV + '.partial'); } catch (e) {}
try { fs.unlinkSync(PROGF); } catch (e) {}
fs.writeFileSync(OUTCSV,
  [hdr.join(',')].concat(rows.map(r => hdr.map(h => esc(r[h])).join(','))).join('\n') + '\n');
console.log(`  TOTAL ${((Date.now() - t0all) / 1000).toFixed(1)}s  ->  criteria_m${M}.csv (${rows.length} rows)`);
