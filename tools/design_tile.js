// Automated tile designer -- diagnosis + optional shape tidy-up + curve design -- built on
// lib/tile_designer.js. See that file's header, and John's request 2026-09-11.
//
// program5-specific paths (re-pathed copy of engine/_dev_isohedral/design_tile.js): outputs go to
// tools/designed/ (there is no Checking/ folder here), and there is no combos_backup_pre_redo/ to
// diff against in --validate, so every combo with real curve points is treated as a hand-drawn
// candidate for that comparison -- harmless, just slightly broader than the original filter.
//
//   node tools/design_tile.js --validate [--only=<substr>]
//       Read-only. Reproduces hand-drawn curves for combos with real curve points, and reports
//       "yours / demo / designed" clearance side by side. NEVER writes to data/combos/.
//
//   node tools/design_tile.js --diagnose-all
//       Verdict counts over the whole gallery, as a sanity table. Read-only.
//
//   node tools/design_tile.js --pinched
//       Runs the designer on every gallery_manifest.js entry flagged pinched:true. Writes results
//       to tools/designed/, never to data/combos/.
//
//   node tools/design_tile.js <combo.json> [--shape] [--apply]
//       Diagnose one combo file, optionally tidy the shape, then design curves. Writes to
//       tools/designed/<file>. --apply only writes to data/combos/ when the combo has NO hand-drawn
//       curve edits already (never overwrites a hand-drawn curve).
const fs = require('fs'), path = require('path');
const H = require(path.join(__dirname, 'lib', 'test_harness.js'));
const TC = H.TC;
const CHK = require(path.join(__dirname, 'lib', 'tiling_checks.js'));
const CD = require(path.join(__dirname, 'lib', 'curve_designer.js'));
const TCurves = require(path.join(__dirname, 'lib', 'tiler_curves.js'));
const TD = require(path.join(__dirname, 'lib', 'tile_designer.js'));
const ROOT = path.dirname(__dirname);
const DEPS = { CHK, CD, TCurves };

function setup(c) {
  const m = c.m;
  H.config(c.id, m, c.orient, c.off, 0); H.loadType(c.id);
  const si = H.runSums(m).findIndex(s => JSON.stringify(s) === c.sum);
  const cfg = H.config(c.id, m, c.orient, c.off, si);
  if (!cfg || !cfg.whichEdge) return null;
  const groups = H.lenGroups(cfg.whichEdge, m);
  return { m, cfg, ctx: { TC, m, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping, groups, eqs: cfg.eqs } };
}

// re-close the stored shape first -- a stored closure gap amplifies through everything downstream
function reclose(ctx, A, L) {
  try {
    const F = TC.familyFns(ctx.eqs, ctx.groups, ctx.m);
    const r = TC.closeConstrained(ctx.eqs, ctx.groups, ctx.m, F.toU(A, L), []);
    if (r && r.A && r.ok) return { A: r.A, L: r.L };
  } catch (e) {}
  return { A, L };
}

function diagLine(diag) {
  if (diag.verdict === 'not a tile') return 'NOT A TILE (' + diag.reason + ')';
  if (diag.verdict === 'straight ok') return 'straight edges are enough';
  const parts = diag.problems.map(p => {
    if (p.kind === 'zeroCorner') return 'corner ' + p.vertex + ' is 0°' + (p.forced === true ? ' (forced)' : p.forced === false ? ' (removable by shape choice)' : '') + (p.unfixable ? ' [flanked only by I edges]' : '');
    if (p.kind === 'crossing') return 'edges ' + p.edges.join(' & ') + ' cross' + (p.unfixable ? ' [both I edges -- unfixable]' : '');
    return 'touch at ' + JSON.stringify(p.vertex) + (p.unfixable ? ' [flanked only by I edges]' : '');
  });
  return 'needs curves: ' + parts.join('; ');
}

// ---------------------------------------------------------------------------------------------
if (process.argv.includes('--diagnose-all')) {
  const manPath = path.join(ROOT, 'app', 'gallery_manifest.js');
  const txt = fs.readFileSync(manPath, 'utf8').replace(/^\/\/.*$/m, '');
  const GAL = new Function(txt + '; return GALLERY;')();
  const counts = {};
  let errs = 0;
  for (const g of GAL) {
    let c; try { c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combos', g.file), 'utf8')); } catch (e) { continue; }
    const S = setup(c); if (!S) { errs++; continue; }
    let A = c.manual.A, L = c.manual.L;
    ({ A, L } = reclose(S.ctx, A, L));
    let diag; try { diag = TD.diagnose(DEPS, S.ctx, A, L); } catch (e) { errs++; continue; }
    counts[diag.verdict] = (counts[diag.verdict] || 0) + 1;
    if (diag.verdict !== (g.pinched ? 'curves required' : diag.verdict) && g.pinched && diag.verdict !== 'curves required')
      console.log('  MISMATCH vs manifest pinch flag: ' + g.file + ' -> ' + diag.verdict);
  }
  console.log('Diagnosis over the gallery:');
  for (const k in counts) console.log('   ' + k.padEnd(20) + counts[k]);
  console.log('   (setup errors: ' + errs + ')');
  process.exit(0);
}

if (process.argv.includes('--validate')) {
  const backup = path.join(ROOT, 'tools', 'combos_backup_pre_redo');
  const files = fs.readdirSync(path.join(ROOT, 'data', 'combos')).filter(f => f.endsWith('.json'));
  const hand = [];
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combos', f), 'utf8'));
    if (!c.curves || !c.curveEdits) continue;
    if (!Object.values(c.curveEdits).some(e => e && Array.isArray(e.pts) && e.pts.length && !e.auto
      && !TD.isGeneratedMotif(TCurves, e.type, e.pts))) continue;
    if (fs.existsSync(path.join(backup, f)) &&
        fs.readFileSync(path.join(ROOT, 'data', 'combos', f), 'utf8') === fs.readFileSync(path.join(backup, f), 'utf8')) continue;
    hand.push([f, c]);
  }
  const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
  const list = only ? hand.filter(h => h[0].includes(only)) : hand;
  console.log(`VALIDATION (read-only) -- ${list.length} combos you drew curves for by hand\n`);
  console.log('combo                              yours    demo   designed   verdict');
  let win = 0, lose = 0;
  for (const [f, c] of list) {
    const S = setup(c); if (!S) { console.log(f + ': config unavailable'); continue; }
    let A = c.manual.A, L = c.manual.L;
    ({ A, L } = reclose(S.ctx, A, L));

    // "yours": your stored curve, drawn on the re-closed shape
    const { rc, variant } = TD.repMapping(S.m, S.ctx.whichEdge, S.ctx.mapping, S.ctx.edgeSym);
    const V = TC.verticesOf(A, L, S.m).slice(0, S.m);
    const curveOfYours = rc.map(o => { let ed = c.curveEdits[o.rep];
      if (!ed || ed.type !== o.type || !Array.isArray(ed.pts) || !ed.pts.length) ed = { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
      return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
    const sepY = CD.separation(TCurves.curvedTile(V, curveOfYours)).rel;

    // "demo": plain default motifs, no edits at all
    const curveOfDemo = rc.map(o => TCurves.applyMap(TCurves.buildCanon(o.type, TCurves.motifPts(o.type, variant[o.rep] || 0)), o.code));
    const sepDemo = CD.separation(TCurves.curvedTile(V, curveOfDemo)).rel;

    // "designed": the new method, starting from scratch (existingEdits = {} so nothing is frozen)
    let diag; try { diag = TD.diagnose(DEPS, S.ctx, A, L); } catch (e) { diag = null; }
    let sepN = null, ok = false;
    try {
      const r = TD.designCurves(DEPS, S.ctx, A, L, {}, diag, {});
      sepN = r.clearance;
      ok = sepN > 1e-6;
    } catch (e) { console.log(f + ': designCurves threw: ' + e.message); }

    const good = ok && sepN >= sepY * 0.9;
    const verdict = good ? 'matches' : !ok ? 'still bad' : 'WORSE than yours';
    if (good) win++; else lose++;
    console.log(`${f.replace('combo_', '').replace('.json', '').padEnd(34)}`
      + `${sepY.toFixed(4)}  ${sepDemo.toFixed(4)}  ${(sepN == null ? 0 : sepN).toFixed(4)}   ${verdict}`);
  }
  console.log(`\n${win} matched or beat your curve, ${lose} did not. Nothing was written.`);
  process.exit(0);
}

if (process.argv.includes('--pinched')) {
  const manPath = path.join(ROOT, 'app', 'gallery_manifest.js');
  const txt = fs.readFileSync(manPath, 'utf8').replace(/^\/\/.*$/m, '');
  const GAL = new Function(txt + '; return GALLERY;')();
  const pinched = GAL.filter(g => g.pinched);
  console.log(`${pinched.length} pinched gallery entries\n`);
  const outDir = path.join(ROOT, 'tools', 'designed');
  fs.mkdirSync(outDir, { recursive: true });
  for (const g of pinched) {
    const file = path.join(ROOT, 'data', 'combos', g.file);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const S = setup(c); if (!S) { console.log(g.file + ': config unavailable'); continue; }
    let A = c.manual.A, L = c.manual.L;
    ({ A, L } = reclose(S.ctx, A, L));
    let diag; try { diag = TD.diagnose(DEPS, S.ctx, A, L); } catch (e) { console.log(g.file + ': diagnose threw ' + e.message); continue; }
    console.log(g.file + ': ' + diagLine(diag));
    if (diag.verdict !== 'curves required') continue;
    let r; try { r = TD.designCurves(DEPS, S.ctx, A, L, c.curveEdits || {}, diag, {}); }
    catch (e) { console.log('   designCurves threw: ' + e.message); continue; }
    console.log('   clearance -> ' + r.clearance.toExponential(2) + (r.clearance > 1e-6 ? '  OPENED' : '  still pinched'));
    const out = { ...c, manual: { A, L }, curves: true, curveEdits: r.curveEdits };
    fs.writeFileSync(path.join(outDir, g.file), JSON.stringify(out, null, 1), 'utf8');
  }
  console.log('\nResults written to Checking/designed/. combos/ was not touched.');
  process.exit(0);
}

const target = process.argv[2];
if (!target || target.startsWith('--')) { console.log('usage: design_tile.js --validate | --diagnose-all | --pinched | <combo.json> [--shape] [--apply]'); process.exit(1); }
const file = path.isAbsolute(target) ? target : path.join(ROOT, target);
const c = JSON.parse(fs.readFileSync(file, 'utf8'));
const S = setup(c);
if (!S) { console.log('config unavailable'); process.exit(1); }
let A = c.manual.A, L = c.manual.L;
({ A, L } = reclose(S.ctx, A, L));
let diag = TD.diagnose(DEPS, S.ctx, A, L);
console.log(path.basename(file) + ': ' + diagLine(diag));
if (diag.verdict === 'not a tile') process.exit(0);

let shapeA = A, shapeL = L;
if (process.argv.includes('--shape')) {
  const s = TD.chooseShape(DEPS, S.ctx, A, L, {});
  shapeA = s.A; shapeL = s.L;
  console.log('shape: ' + JSON.stringify(s.report));
  diag = TD.diagnose(DEPS, S.ctx, shapeA, shapeL);
  console.log('  re-diagnosed: ' + diagLine(diag));
}

const hasHand = c.curves && c.curveEdits && Object.values(c.curveEdits).some(e => e && Array.isArray(e.pts) && e.pts.length && !e.auto
  && !TD.isGeneratedMotif(TCurves, e.type, e.pts));
const r = TD.designCurves(DEPS, S.ctx, shapeA, shapeL, c.curveEdits || {}, diag, {});
console.log('clearance: ' + r.clearance.toExponential(3) + (hasHand ? '  (hand-drawn edits were frozen, not replaced)' : ''));

const outDir = path.join(ROOT, 'tools', 'designed');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, path.basename(file));
const out = { ...c, manual: { A: shapeA, L: shapeL }, curves: true, curveEdits: r.curveEdits };
fs.writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8');
console.log('written: ' + path.relative(ROOT, outFile));

if (process.argv.includes('--apply')) {
  if (hasHand) console.log('NOT applied to combos/: this combo already has hand-drawn curves.');
  else if (r.clearance <= 1e-6) console.log('NOT applied to combos/: still not clean.');
  else { fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8'); console.log('applied to ' + path.relative(ROOT, file)); }
}
