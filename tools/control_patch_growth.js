// Control: do KNOWN-GOOD curved tilings stay clean as the patch grows?
// If they degrade with patch size, the gallery's new 120-tile check is measuring develop() drift.
const path = require('path'), fs = require('fs');
const H = require(path.join(__dirname,'lib','test_harness.js'));
const TC = H.TC;
const CO = require(path.join(__dirname,'lib','curved_overlap.js'));
const TCu = require(path.join(__dirname,'lib','tiler_curves.js'));
const ROOT = path.join(__dirname,'..');

function curveOfFor(c, cfg, m, useHand) {
  const es = cfg.edgeSym, we = cfg.whichEdge, mp = cfg.mapping;
  const repMap = i => { let cur = i, code = 0, g = 0;
    while (we[cur] != null && we[cur] !== cur && g++ < m) { code ^= (mp[cur] || 0); cur = we[cur]; }
    return { rep: cur, code }; };
  const rc = []; for (let i = 0; i < m; i++) { const r = repMap(i); r.type = TCu.SYM[es[r.rep]] || 'J'; rc.push(r); }
  const seen = new Set(), byType = {};
  for (const o of rc) { if (o.type === 'I' || seen.has(o.rep)) continue; seen.add(o.rep);
    (byType[o.type] = byType[o.type] || []).push(o.rep); }
  const variant = {};
  for (const t in byType) byType[t].sort((a, b) => a - b).forEach((r, i) => variant[r] = i);
  const ce = useHand && c.curveEdits ? JSON.parse(JSON.stringify(c.curveEdits)) : {};
  const curveOf = [];
  for (let i = 0; i < m; i++) { const { rep, code, type } = rc[i];
    let ed = ce[rep];
    if (!ed || ed.type !== type || !Array.isArray(ed.pts)) ed = { type, pts: TCu.motifPts(type, variant[rep] || 0) };
    curveOf.push(TCu.applyMap(TCu.buildCanon(type, ed.pts), code)); }
  return curveOf;
}

// John's hand-drawn combos: he built these to work, so they are the ground truth
const backup = path.join(ROOT, 'combos_backup_pre_redo');
const hand = [];
for (const f of fs.readdirSync(path.join(ROOT,'data','combos')).filter(x => x.endsWith('.json'))) {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT,'data','combos', f), 'utf8'));
  if (!c.curves || !c.curveEdits) continue;
  if (!Object.values(c.curveEdits).some(e => e && Array.isArray(e.pts) && e.pts.length)) continue;
  if (fs.existsSync(path.join(backup, f)) &&
      fs.readFileSync(path.join(ROOT,'data','combos', f), 'utf8') === fs.readFileSync(path.join(backup, f), 'utf8')) continue;
  hand.push([f, c]);
}
console.log(`control: ${hand.length} combos John drew by hand; overlapping pairs by patch size\n`);
console.log('combo                              16    60   120   verdict');
let bad = 0, n = 0;
for (const [f, c] of hand.slice(0, 12)) {
  const m = c.m;
  H.config(c.id, m, c.orient, c.off, 0); H.loadType(c.id);
  const si = H.runSums(m).findIndex(s => JSON.stringify(s) === c.sum);
  const cfg = H.config(c.id, m, c.orient, c.off, si);
  if (!cfg || !cfg.ned) continue;
  const ned = cfg.ned;
  const V = TC.verticesOf(c.manual.A, c.manual.L, m).slice(0, m);
  const curveOf = curveOfFor(c, cfg, m, true);
  const r = [16, 60, 120].map(t => {
    const P = TC.develop(V, cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], t);
    try { return CO.overlapCurved(TCu.buildCurvedTiles(P, V, curveOf)).pairs; } catch (e) { return -1; }
  });
  n++;
  const grew = r[2] > 0 && r[0] === 0;
  if (r[2] > 0) bad++;
  console.log(`${f.replace('combo_','').replace('.json','').padEnd(34)}`
    + `${String(r[0]).padStart(3)}  ${String(r[1]).padStart(4)}  ${String(r[2]).padStart(4)}`
    + (grew ? '   clean at 16, DIRTY at 120' : r[2] > 0 ? '   dirty throughout' : '   clean'));
}
console.log(`\n${n - bad} of ${n} of your hand-drawn combos are clean at 120 tiles`);
console.log(bad ? 'If your own verified curves fail at 120, the 120-tile gate is too strict.' : 'The 120-tile gate does not reject your work.');
