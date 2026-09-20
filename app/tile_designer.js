// Automate what John draws by hand: (1) SEE whether a combo's straight skeleton is already a
// simple closed (Jordan) boundary or needs curves to become one, (2) if the shape is still free,
// nudge it so unforced angles don't read as 60/90/180 and unforced edge lengths read as visibly
// different, (3) design the curves themselves.
//
// John, 2026-09-11: "It seems that we are doing a lot of hand tweaking, and then redoing... I
// think it would be nice to see that we require curved lines to make a valid tile... [and] it
// should not have any angles too close to 180, 90 or 60 degrees unless they are set to that...
// If edges can have different lengths, they should differ enough that we can tell."
//
// Why no overlap test is needed here (John's covering theorem, 2026-09-11): the angle equations
// force every developed vertex to sum to 360 degrees, and every shared edge is glued on opposite
// sides of its two tiles, so the development is a local homeomorphism and therefore a covering
// map of the plane -- one sheet, no overlap -- PROVIDED the drawn boundary is a simple closed
// curve. So the only thing that can go wrong is the boundary crossing or touching itself, which
// is exactly curve_designer.js's separation() measurement. No 60- or 120-tile overlap test runs
// inside any loop here; it appears once, at the end, as a self-check (a failure is a program bug,
// not a rejection).
//
// This module takes its tiler-core / tiling-checks / curve-designer / tiler-curves functions as
// arguments (`deps`) rather than requiring a specific file, because node's test_harness.js loads
// tiler_core.js while tilerTest.html loads the tiler_core_revpivot.js fork -- both export the same
// familyFns/pickDrivers/closeConstrained/angleStructure/boundaryTouch surface this needs.
(function (root) {
  'use strict';
  const N = (typeof module !== 'undefined' && module.exports);
  // Same algorithm tiler_core.js's solver restarts use -- a fixed seed, not Math.random(), so a
  // caller whose result feeds a published verdict (sweep_aniso.js's curve check) gets the same
  // answer every run.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const TCurvesDefault = N ? require('./tiler_curves.js') : root.TilerCurves;
  const CDDefault = N ? require('./curve_designer.js') : root.CurveDesigner;
  const CHKDefault = N ? require('./tiling_checks.js') : root.TilingChecks;

  // A stored curve edit is John's drawing only if it is not just a generated motif (at one of the
  // gallery's curve factors) that an earlier run saved back into the combo -- same test as
  // py/gen_gallery.js's isGeneratedMotif, ported here so this module can tell frozen (hand) edits
  // from ones it is free to redesign without requiring gen_gallery.js. Without this, all three
  // combos whose stored curves are old auto-repairs that never actually opened the pinch (still
  // clearance ~0, per gallery_manifest.js) were wrongly frozen as "hand-drawn".
  const GALLERY_FACTORS = [1, -1, 0.85, -0.85, 1.15, -1.15, 0.7, -0.7, 0.55, -0.55, 0.4, -0.4, 0.3, -0.3, 0.2, 0.12];
  function isGeneratedMotif(TCurves, type, pts) {
    if (!Array.isArray(pts)) return false;
    const n = TCurves.motifCount(type) || 1;
    for (let v = 0; v < n; v++) {
      const base = TCurves.motifPts(type, v);
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

  const NEAR_TARGETS = [0, 60, 90, 180, 270, 300, 360];   // 60/90/180 and their reflex look-alikes
  const ANG_MARGIN = 8;         // degrees: how far from a target counts as "clearly not that"
  const LEN_MARGIN = Math.log(1.15);   // ln-ratio: 15% apart counts as "visibly different"
  const SEP_OK = 0.03;          // separation() considered "comfortably open" for curve design

  // Detecting a PROPER crossing (a bowtie) between two straight edges, as opposed to merely
  // touching (a vertex landing on another edge, or a 0-degree corner), uses CD.segDist directly
  // (see diagnose() below) rather than TC.polySelfIntersects: that function's bare Math.sign on
  // the orientation test has no tolerance, so an exact touch is rounding noise away from being
  // read as a crossing -- it misfired on three pinch-point tiles that have a vertex-on-edge touch
  // rather than a 0-degree corner (#209403 si5, #601144 si2, #1727363 si2), calling them "not a
  // tile". CD.segDist already carries the fix needed for exactly this (curve_designer.js's
  // collinear guard): a strict sign change on BOTH segments, scale-aware.

  function nearestTargetDist(deg) {
    const x = ((deg % 360) + 360) % 360;
    let best = Infinity;
    for (const t of NEAR_TARGETS) best = Math.min(best, Math.abs(x - t), Math.abs(x - t - 360), Math.abs(x - t + 360));
    return best;
  }

  // ---- orbit bookkeeping shared by diagnose/chooseShape/designCurves ------------------------
  // Same representative-mapping pattern as verify_gallery.js / design_curves.js's setup(): fold
  // each physical edge back to its orbit representative and the map (mirror/flip) code that gets
  // you there, so curves can be edited once per orbit and mapped out to every occurrence.
  function repMapping(m, whichEdge, mapping, edgeSym) {
    const SYM = TCurvesDefault.SYM;
    const repMap = i => { let cur = i, code = 0, k = 0;
      while (whichEdge[cur] != null && whichEdge[cur] !== cur && k++ < m) { code ^= (mapping[cur] || 0); cur = whichEdge[cur]; }
      return { rep: cur, code }; };
    const rc = [];
    for (let i = 0; i < m; i++) { const o = repMap(i); o.type = SYM[edgeSym[o.rep]] || 'J'; rc.push(o); }
    const seen = new Set(), byType = {};
    for (const o of rc) { if (o.type === 'I' || seen.has(o.rep)) continue; seen.add(o.rep); (byType[o.type] = byType[o.type] || []).push(o.rep); }
    const variant = {};
    for (const t in byType) byType[t].sort((a, b) => a - b).forEach((rep, i) => variant[rep] = i);
    return { rc, variant };
  }

  // ---- stage 1: does the straight skeleton need curves? -------------------------------------
  //
  // Three independent verdicts:
  //   'not a tile'       -- a fold (0deg between EQUAL edges), coincident vertices, a spike between
  //                          two I edges, or a self-crossing between two I edges. No curve or shape
  //                          choice repairs any of these; the combo itself is unusable.
  //   'curves required'  -- the straight polygon is not simple: a corner sits at 0 degrees, or two
  //                          edges touch or properly cross -- but at least one edge involved CAN
  //                          bow (per John's fold rule: J/U/S edges bow clear, only I cannot).
  //   'straight ok'      -- already a simple closed boundary; curves are optional decoration.
  //
  // A straight self-crossing is NOT automatically fatal. tiler_core.js's own comment on
  // polySelfIntersects claims "no curve fixes it", but three live gallery tiles disprove that:
  // #25528 si2, #209471 si4 and #209472 si7 all have a straight m-gon that properly crosses
  // itself (crossing depth up to 0.18 of the tile diameter, not rounding noise), yet each already
  // carries hand/saved curves whose bow routes cleanly around the crossing and passes the gallery's
  // gate. So a crossing is treated exactly like a touch: fatal only when EVERY edge at every
  // crossing is straight (I), because only then is there no curve able to move.
  //
  // `forced` on each problem: does it survive across the whole closing family, or could stage 2
  // (chooseShape) remove it by itself? Sampled the same way angleIsForced() does in
  // _dev_isohedral/walk_degenerate_rows.js -- perturb the drivers, re-close, see if the defect
  // ever goes away. (Not yet computed for 'touch'/'crossing' problems -- reported as null, i.e.
  // "unknown", rather than guessed.)
  function diagnose(deps, ctx, A, L) {
    const { TC, m, edgeSym, whichEdge, mapping, groups, eqs } = ctx;
    const CHK = deps.CHK || CHKDefault, CD = deps.CD || CDDefault;
    const q = CHK.quality(A, L, null, m, edgeSym);
    if (q.foldFatal) return { verdict: 'not a tile', reason: 'fold at ' + q.foldAt.join(',') };
    if (q.coincident) return { verdict: 'not a tile', reason: 'coincident vertices ' + q.vertexGapAt };
    if (q.spikeFatal) return { verdict: 'not a tile', reason: 'zero-width spike between two straight edges' };
    const V = TC.verticesOf(A, L, m).slice(0, m);
    const { rc } = repMapping(m, whichEdge, mapping, edgeSym);
    const bowableRep = r => (rc.find(o => o.rep === r) || {}).type !== 'I';
    const problems = [];

    // proper crossings between non-adjacent edges
    for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      if (!(CD.segDist(V[i], V[(i + 1) % m], V[j], V[(j + 1) % m]) < 0)) continue;
      const orbits = [rc[i].rep, rc[j].rep].filter((r, idx, arr) => arr.indexOf(r) === idx);
      const bowable = orbits.filter(bowableRep);
      problems.push({ kind: 'crossing', edges: [i, j], orbits: bowable, forced: null });
    }
    // zero-degree corners: allowed by John's fold rule (unequal edges), but need a curve to open
    for (let i = 0; i < m; i++) {
      const a = ((A[i] % 360) + 360) % 360;
      if (!(a < 1 || a > 359)) continue;
      const eBefore = rc[(i - 1 + m) % m], eAfter = rc[i % m];
      const orbits = [eBefore.rep, eAfter.rep].filter((r, idx, arr) => arr.indexOf(r) === idx);
      const bowable = orbits.filter(bowableRep);
      problems.push({ kind: 'zeroCorner', vertex: i, orbits: bowable, forced: null });
    }
    // a corner touching a non-adjacent edge (no crossing, but no clearance either)
    const sep = CD.separation(V);
    if (sep.rel < 1e-6 && !problems.some(p => p.kind === 'zeroCorner' || p.kind === 'crossing'))
      problems.push({ kind: 'touch', vertex: sep.at || null, orbits: rc.map(o => o.rep).filter((r, i, a) => a.indexOf(r) === i)
        .filter(bowableRep), forced: null });

    if (!problems.length) return { verdict: 'straight ok', problems: [] };
    // if EVERY problem has NO bowable edge at all, no curve can fix any of them -- not a tile
    if (problems.every(p => !p.orbits.length))
      return { verdict: 'not a tile', reason: 'a zero-degree corner, touch, or crossing is flanked only by straight (I) edges' };
    // drop problems that individually have no bowable edge but are not the only issue -- they are
    // reported as unfixable-in-place rather than failing the whole tile, since the rest of the
    // boundary can still be a simple closed curve; surface them so the caller can see the residual risk
    for (const p of problems) if (!p.orbits.length) p.unfixable = true;

    // is each problem forced across the family, or could a shape change alone remove it?
    try {
      const F = TC.familyFns(eqs, groups, m);
      const u0 = F.toU(A, L);
      const pd = TC.pickDrivers(eqs, groups, m, u0);
      const drv = (pd.drivers || []).map(d => d.u);
      if (drv.length) {
        const worstZero = uu => { const { A: AA } = F.unpack(uu);
          let w = 0; for (const p of problems) if (p.kind === 'zeroCorner') w = Math.max(w, 1 - Math.min(((AA[p.vertex] % 360) + 360) % 360, 360 - (((AA[p.vertex] % 360) + 360) % 360)) / 1); return w; };
        let stillZero = problems.map(() => true);
        for (let t = 0; t < 150; t++) {
          const uu = u0.slice();
          for (const k of drv) uu[k] += (Math.random() * 2 - 1) * (k < F.free.length ? 90 : 1.5);
          let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { continue; }
          if (!r || !r.A || !r.ok) continue;
          problems.forEach((p, idx) => { if (p.kind !== 'zeroCorner') return;
            const a = ((r.A[p.vertex] % 360) + 360) % 360;
            if (!(a < 1 || a > 359)) stillZero[idx] = false; });
        }
        problems.forEach((p, idx) => { if (p.kind === 'zeroCorner') p.forced = stillZero[idx]; });
      } else {
        problems.forEach(p => { p.forced = true; });     // dim 0: nothing can move
      }
    } catch (e) {}
    return { verdict: 'curves required', problems };
  }

  // ---- stage 2: pick a shape whose FREE angles/lengths don't look accidentally special ------
  //
  // Reuses the walk pattern from _dev_isohedral/walk_degenerate_rows.js: drivers from
  // pickDrivers, hill-climb, re-close with closeConstrained after every step, additive objective
  // (a product has zero gradient exactly where this starts), guard steps only -- never the start.
  function chooseShape(deps, ctx, A, L, opts) {
    opts = opts || {};
    const { TC, m, edgeSym, groups, eqs } = ctx;
    const CHK = deps.CHK || CHKDefault;
    const F = TC.familyFns(eqs, groups, m);
    let u0, pd;
    try { u0 = F.toU(A, L); pd = TC.pickDrivers(eqs, groups, m, u0); } catch (e) { return { A, L, report: { note: 'family unavailable' } }; }
    const drv = (pd.drivers || []).map(d => d.u);
    if (!drv.length) return { A, L, report: { note: 'rigid: no free parameters to choose' } };

    // which angle indices / length groups are actually FREE across the family (sample first)
    const nSamp = opts.samples || 200;
    const angleSpan = new Array(m).fill(null).map(() => ({ lo: Infinity, hi: -Infinity }));
    const lenSpan = groups.map(() => ({ lo: Infinity, hi: -Infinity }));
    const startQ0 = CHK.quality(A, L, null, m, edgeSym);
    for (let t = 0; t < nSamp; t++) {
      const uu = u0.slice();
      for (const k of drv) uu[k] += (Math.random() * 2 - 1) * (k < F.free.length ? 90 : 1.5);
      let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { continue; }
      if (!r || !r.A || !r.ok) continue;
      const qq = CHK.quality(r.A, r.L, null, m, edgeSym);
      if (qq.degenerate) continue;
      for (let i = 0; i < m; i++) { const a = ((r.A[i] % 360) + 360) % 360;
        angleSpan[i].lo = Math.min(angleSpan[i].lo, a); angleSpan[i].hi = Math.max(angleSpan[i].hi, a); }
      const mx = Math.max(...r.L);
      groups.forEach((g, gi) => { const v = r.L[g[0]] / mx;
        lenSpan[gi].lo = Math.min(lenSpan[gi].lo, v); lenSpan[gi].hi = Math.max(lenSpan[gi].hi, v); });
    }
    const angleFree = angleSpan.map(s => s.hi - s.lo > 0.5);
    const lenFree = lenSpan.map(s => s.hi - s.lo > 1e-3);

    const additive = q => Math.min(q.minAngle / 45, 1) + Math.min(q.edgeRatio / 0.5, 1)
                        + Math.min((q.pinch == null ? 1 : q.pinch) / 0.15, 1);
    const aestheticTerm = (AA, LL) => {
      let s = 0;
      for (let i = 0; i < m; i++) { if (!angleFree[i]) continue;
        s += Math.min(nearestTargetDist(AA[i]) / ANG_MARGIN, 1); }
      const mx = Math.max(...LL);
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        if (!lenFree[i] || !lenFree[j]) continue;
        const r = Math.abs(Math.log((LL[groups[i][0]] || 1e-9) / (LL[groups[j][0]] || 1e-9)));
        const w = (allI(groups[i], edgeSym) && allI(groups[j], edgeSym)) ? 1 : 0.3;
        s += w * Math.min(r / LEN_MARGIN, 1);
      }
      return s;
    };
    function allI(g, edgeSym) { return g.every(i => edgeSym[i] === 2); }

    const evalU = uu => { let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { return null; }
      if (!r || !r.A || !r.ok) return null;
      const qq = CHK.quality(r.A, r.L, null, m, edgeSym);
      if (qq.degenerate) return null;
      return { A: r.A, L: r.L, u: r.u, q: qq, s: additive(qq) + 0.5 * aestheticTerm(r.A, r.L) }; };

    let cur = evalU(u0.slice());
    if (!cur) return { A, L, report: { note: 'start does not re-close cleanly; left unchanged' } };
    const start = cur;
    for (let step = 0.35, it = 0; step > 5e-4 && it < 900; it++) {
      let cand = cur, moved = false;
      for (const k of drv) for (const dir of [1, -1]) {
        const uu = cur.u.slice();
        uu[k] += dir * step * (k < F.free.length ? 25 : Math.max(0.08, Math.abs(uu[k])));
        const c = evalU(uu);
        if (c && c.s > cand.s + 1e-12) { cand = c; moved = true; }
      }
      if (moved) cur = cand; else step /= 2;
    }
    const worstMargin = (AA) => { let w = Infinity; for (let i = 0; i < m; i++) if (angleFree[i]) w = Math.min(w, nearestTargetDist(AA[i])); return w; };
    const forcedList = [];
    for (let i = 0; i < m; i++) if (!angleFree[i]) forcedList.push('A' + i + ' = ' + (((cur.A[i] % 360) + 360) % 360).toFixed(1) + '° (forced)');
    return {
      A: cur.A, L: cur.L,
      report: {
        beforeMargin: angleFree.some(Boolean) ? worstMargin(start.A) : null,
        afterMargin: angleFree.some(Boolean) ? worstMargin(cur.A) : null,
        forced: forcedList,
        improved: cur.s > start.s + 1e-9,
      },
    };
  }

  // ---- stage 3: design the curves themselves -------------------------------------------------
  //
  // No overlap test in the loop -- the covering theorem makes clearance the only thing that
  // matters. Once clean (separation >= SEP_OK) a small secondary term nudges corner TANGENT
  // angles (TilerCurves.curveCornerAngles) away from the same 60/90/180 look-alikes, without ever
  // trading clearance below SEP_OK for it.
  function designCurves(deps, ctx, A, L, existingEdits, diag, opts) {
    opts = opts || {};
    const { TC, m, edgeSym, whichEdge, mapping } = ctx;
    const CD = deps.CD || CDDefault, TCurves = deps.TCurves || TCurvesDefault, CHK = deps.CHK || CHKDefault;
    const { rc, variant } = repMapping(m, whichEdge, mapping, edgeSym);
    const V = TC.verticesOf(A, L, m).slice(0, m);

    const problemOrbits = new Set();
    for (const p of (diag && diag.problems || [])) for (const r of p.orbits || []) problemOrbits.add(r);
    // freeze any orbit that already carries a HAND edit (not auto-generated); only default/auto
    // orbits are ever moved by the search.
    const editable = [];
    const edits = {};
    for (const o of rc) { if (o.type === 'I' || edits[o.rep]) continue;
      const ex = existingEdits && existingEdits[o.rep];
      const isHand = ex && Array.isArray(ex.pts) && ex.pts.length && ex.type === o.type && !ex.auto
        && !isGeneratedMotif(TCurves, o.type, ex.pts);
      if (isHand) { edits[o.rep] = { type: o.type, pts: ex.pts.map(p => p.slice()) }; continue; }
      edits[o.rep] = { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
      editable.push(o.rep);
    }
    if (!editable.length) {
      // `edits` only ever gets an entry for a non-I orbit (the loop above skips type 'I'
      // entirely), so a tile with any straight edge needs the same "no edit yet -> default motif"
      // fallback buildAll uses below -- reading edits[o.rep].pts unconditionally crashed here on
      // any all-hand-or-straight tile that also has an I edge (e.g. #72758 si20's diag came back
      // 'straight ok', so designShapeAndCurves still called this as a baseline measurement).
      const curveOf0 = rc.map(o => { const ed = edits[o.rep] || { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
        return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
      return { curveEdits: stripAuto(edits), clearance: CD.separation(TCurves.curvedTile(V, curveOf0)).rel, cornerAngles: TCurves.curveCornerAngles(V, curveOf0), note: 'nothing editable (all hand-drawn or all straight)' };
    }
    function stripAuto(e) { const out = {}; for (const k in e) out[k] = e[k]; return out; }

    const buildAll = e => { const curveOf = rc.map(o => { let ed = e[o.rep];
      if (!ed) ed = { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
      return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
      return TCurves.curvedTile(V, curveOf); };

    // The angle term needs edgeSym-aware exemptions: a corner that is SET by the equations, or
    // flanked by two straight (I) edges, has an angle equal to the chord and should not be judged.
    const exemptCorner = new Array(m).fill(false);
    for (let i = 0; i < m; i++) {
      const before = edgeSym[(i - 1 + m) % m], after = edgeSym[i];
      if (before === 2 && after === 2) exemptCorner[i] = true;
    }
    const setAngle = new Array(m).fill(false);
    try { const { flat } = TC.angleStructure(ctx.eqs, m); for (const c of flat) setAngle[c] = true; } catch (e) {}

    // Objective, evaluated per full edit-set (needs curveOf for the corner-angle term): while the
    // boundary still touches or crosses itself, climb raw separation; once comfortably open
    // (>= SEP_OK), add a small secondary term pulling drawn corner angles away from 60/90/180 --
    // never enough to trade clearance back down (0.1 vs 1.0 slope on separation itself).
    const objectiveFull = e => {
      const curveOf = rc.map(o => { let ed = e[o.rep];
        if (!ed) ed = { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
        return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
      const boundary = TCurves.curvedTile(V, curveOf);
      const sep = CD.separation(boundary).rel;
      if (sep < SEP_OK) return { boundary, score: sep };
      let angTerm = 0;
      try {
        const ca = TCurves.curveCornerAngles(V, curveOf);
        for (let i = 0; i < m; i++) { if (exemptCorner[i] || setAngle[i]) continue;
          angTerm += Math.min(nearestTargetDist(ca[i]) / ANG_MARGIN, 1); }
        angTerm /= m;
      } catch (e) {}
      return { boundary, score: SEP_OK + 0.1 * (sep - SEP_OK) + 0.02 * angTerm };
    };

    const STARTS = +(opts.starts || (N && typeof process !== 'undefined' && process.env && process.env.CD_STARTS) || 12);
    let best = null;
    // Fixed-seed RNG, not Math.random(): sweep_aniso.js now runs this on every curves-required
    // row (John, 2026-09-13), and its "search, not proof" clearance feeds the published aniso
    // column directly -- #25551 m8 si34 or0 off3 flipped 'not a tile' <-> 'no (tile)' between two
    // otherwise-identical census runs because an unseeded restart occasionally found a curve a
    // different run's draw missed. A published verdict must not depend on which draw ran.
    const rng = mulberry32(0x0DE516 ^ editable.length ^ (rc.length << 8));
    for (let attempt = 0; attempt < STARTS; attempt++) {
      const trial = JSON.parse(JSON.stringify(edits));
      for (const rep of editable) {
        const type = trial[rep].type;
        if (attempt === 0) continue;                             // attempt 0: plain demo motif start
        const needsBow = problemOrbits.has(rep);
        if (needsBow) {
          const sign = (attempt % 2 === 0) ? 1 : -1;
          // three amplitudes, both signs: small rises (the old seed) up to ~0.4 of an edge-length
          trial[rep] = { type, pts: CD.angledSeed(type, sign, 1 + ((attempt >> 1) % 3)) };
        } else if (attempt > 1) {
          const pts = TCurves.motifPts(type, variant[rep] || 0).map(p => p.slice());
          for (const f of CD.freeIndices(type, pts)) {
            if (f.x) pts[f.i][0] = Math.max(0.08, Math.min(type === 'J' ? 0.92 : 0.48, pts[f.i][0] + (rng() * 2 - 1) * 0.12));
            pts[f.i][1] = Math.max(-0.65, Math.min(0.65, pts[f.i][1] + (rng() * 2 - 1) * 0.45));
          }
          pts.sort((a, b) => a[0] - b[0]);
          trial[rep] = { type, pts };
        }
      }
      let cur = trial;
      for (let pass = 0; pass < 3; pass++) {
        for (const rep of editable) {
          const type = cur[rep].type;
          const r = CD.designCurve(type, cur[rep].pts, pts => {
            const e2 = JSON.parse(JSON.stringify(cur)); e2[rep] = { type, pts };
            return objectiveFull(e2);
          }, { maxIt: 120 });
          if (r && r.pts) cur[rep] = { type, pts: r.pts };
        }
      }
      const fin = objectiveFull(cur);
      const sepFinal = CD.separation(fin.boundary).rel;
      if (!best || sepFinal > best.sep + 1e-9 || (Math.abs(sepFinal - best.sep) < 1e-9 && fin.score > best.score)) {
        best = { edits: cur, sep: sepFinal, score: fin.score, boundary: fin.boundary };
      }
    }

    const curveOfFinal = rc.map(o => { const ed = best.edits[o.rep] || { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
      return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
    const outEdits = {};
    for (const rep of Object.keys(best.edits)) {
      const wasHand = existingEdits && existingEdits[rep] && Array.isArray(existingEdits[rep].pts)
        && existingEdits[rep].pts.length && !existingEdits[rep].auto && !editable.includes(+rep)
        && !isGeneratedMotif(TCurves, existingEdits[rep].type, existingEdits[rep].pts);
      outEdits[rep] = wasHand ? best.edits[rep] : { ...best.edits[rep], auto: true };
    }
    return { curveEdits: outEdits, clearance: best.sep, cornerAngles: TCurves.curveCornerAngles(V, curveOfFinal), editable };
  }

  // How far can ONE driver move (holding every other driver at u0's value) before the tile
  // degenerates or a solver bound is hit? Bracket outward in both directions, following where
  // closeConstrained's own Newton step actually lands (r.u[k], not the requested value) so the
  // range reflects the real family, not the linear guess. Geometric step growth means a handful of
  // iterations covers a wide range while a first small step still finds a nearby degenerate edge
  // precisely. Used to seed a GRID (see designShapeAndCurves) rather than random perturbation.
  function bracketDriverRange(TC, CHK, eqs, groups, m, edgeSym, u0, drv, k, isLen) {
    // An angle-kind unknown sits well inside (0.5, 359.5); a length-ratio kind is bounded below by
    // the solver's own clamp (see reference_two_clamp_floors) and has no natural ceiling. Callers
    // that know the kind pass isLen (familyFns: angles first, indices < F.free.length, then length
    // ratios). It matters: stepped like an angle -- a first step of 3 on a ratio near 0.9, against a
    // floor of 0.5 -- a length ratio never moved DOWN at all, so the walk never saw the smaller-ratio
    // members. That is how #25524 m8 si14 (a saved tile at ratio 0.65; the walk started at 0.94) and
    // #25644 m8 si23 (clean at 0.27; the high-precision re-solve landed at 0.52) were rejected as
    // "no curve clears" (2026-09-13). Without isLen the old shared step is kept.
    const bound = isLen ? [0.02, 1000] : [0.5, 5000];
    const baseStep = isLen ? Math.max(Math.abs(u0[k]) * 0.05, 0.005) : Math.max(1, Math.abs(u0[k]) * 0.05, 3);
    let lo = u0[k], hi = u0[k];
    for (const dir of [1, -1]) {
      let cur = u0[k], step = baseStep;
      for (let it = 0; it < 40; it++) {
        const next = cur + dir * step;
        if (next < bound[0] || next > bound[1]) break;
        const uu = u0.slice(); uu[k] = next;
        let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { break; }
        if (!r || !r.A || !r.ok) break;
        const qq = CHK.quality(r.A, r.L, null, m, edgeSym);
        // A degenerate member does NOT end the range -- it is filtered out later, when members are
        // scored. Stopping here collapsed the range to the start itself whenever the start was the
        // bad one (#9017 m8 si5 and #209220 m7 si6 sat on the 0.05 floor: range 0.050..0.050, so
        // John's clean members at 0.20 and 0.36 were never looked at). "Guard steps, never the start."
        void qq;
        cur = r.u[k];
        if (dir > 0) hi = Math.max(hi, cur); else lo = Math.min(lo, cur);
        step *= 1.2;
      }
    }
    return [lo, hi];
  }

  // ---- stage 2.5: search the FAMILY for a member that draws better, not just a legal one -------
  //
  // John, 2026-09-12, comparing his own hand fixes against several gallery tiles he called ugly
  // and narrow: in 6 of 7 cases the CURVE was untouched -- identical control points -- and the only
  // difference was which member of the closing family the combo was drawn at (e.g. #209078 si1:
  // clearance 0.012 -> 0.045 from sliding the true-parameter driver alone, same exact S curve).
  // designCurves alone cannot find this: it only ever bends the curve on the ONE shape it is given.
  // gen_gallery's own factor/motif-shift loop cannot either -- it never touches the family, and it
  // takes the FIRST factor that merely clears the 1e-6 gate rather than the best one, so a family
  // member that is geometrically tight looks "fixed" the moment any curve avoids literally touching.
  //
  // This does what dragging the true-parameter slider by hand does, automated: sample family
  // members and score each CHEAPLY (one separation() call, no coordinate descent) using whatever
  // curve is already the best one found so far -- a curve's canonical [0,1]-per-edge points are
  // meaningful at ANY member of the family (mapToEdge just places them on that edge's actual
  // endpoints), so the score is a fair comparison across members even before any curve redesign.
  // Only the few most promising candidates get the expensive full designCurves() treatment.
  function designShapeAndCurves(deps, ctx, A, L, existingEdits, opts) {
    opts = opts || {};
    const { TC, m, edgeSym, whichEdge, mapping, groups, eqs } = ctx;
    const CD = deps.CD || CDDefault, TCurves = deps.TCurves || TCurvesDefault, CHK = deps.CHK || CHKDefault;

    const diag0 = diagnose(deps, ctx, A, L);
    if (diag0.verdict === 'not a tile') return { A, L, curveEdits: existingEdits || {}, clearance: 0, diag: diag0 };
    const curves0 = designCurves(deps, ctx, A, L, existingEdits, diag0, opts);
    let best = { A, L, curveEdits: curves0.curveEdits, clearance: curves0.clearance };

    let F, u0, pd;
    try { F = TC.familyFns(eqs, groups, m); u0 = F.toU(A, L); pd = TC.pickDrivers(eqs, groups, m, u0); }
    catch (e) { return best; }
    const drv = (pd.drivers || []).map(d => d.u);
    if (!drv.length) return best;                    // rigid: this IS the only shape

    const cheapScore = (AA, LL, edits) => {
      const { rc, variant } = repMapping(m, whichEdge, mapping, edgeSym);
      const V = TC.verticesOf(AA, LL, m).slice(0, m);
      const curveOf = rc.map(o => { const ed = edits[o.rep] || { type: o.type, pts: TCurves.motifPts(o.type, variant[o.rep] || 0) };
        return TCurves.applyMap(TCurves.buildCanon(o.type, ed.pts), o.code); });
      return CD.separation(TCurves.curvedTile(V, curveOf)).rel;
    };
    // A member whose STRAIGHT outline is already simple is a tile with every edge drawn flat -- a
    // flat curve satisfies every J/U/S symmetry. Scoring members only by the current curve missed
    // those: #25524 m8 si14's family is straight-clean from ratio 0.65 to 0.90 (clearance up to
    // 0.055, where John's saved tiling sits) while every curve designed on the start shape failed.
    const straightSep = (AA, LL) => CD.separation(TC.verticesOf(AA, LL, m).slice(0, m)).rel;
    const flatEdits = () => { const { rc } = repMapping(m, whichEdge, mapping, edgeSym), out = {};
      for (const o of rc) if (o.type !== 'I' && !out[o.rep]) out[o.rep] = { type: o.type, pts: o.type === 'J' ? [[0, 0], [1, 0]] : [[0, 0], [0.5, 0]], auto: true };
      return out; };

    // Sample the family. John, 2026-09-12: "we might put a rough grid over the volume we have
    // possible and test those as starting points... I think you may randomly pick points and do
    // Newton. This could ensure more coverage." Right on both counts: pure random perturbation
    // (Math.random(), unseeded) is what this used to do, and it measurably under-covers -- two runs
    // of the SAME combo through gen_gallery.js found different clearances (0.06 one run, unimproved
    // the next) purely from which random draws happened to land near the good region. A GRID over
    // each driver's own feasible extent, found by bracketing outward from the current point until
    // the tile degenerates or a solver bound is hit, sees the same candidates every time and cannot
    // miss a region wider than the grid step. Used for dim 1-2 (all but a handful of combos in the
    // gallery); dim >= 3 falls back to random since a grid's point count is exponential in dim and
    // a dense-enough grid there would cost far more than the search is worth.
    const candidates = [];
    const tryPoint = uu => {
      let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { return; }
      if (!r || !r.A || !r.ok) return;
      const qq = CHK.quality(r.A, r.L, null, m, edgeSym);
      if (qq.degenerate) return;
      const st = straightSep(r.A, r.L);
      candidates.push({ A: r.A, L: r.L, straight: st, clr: Math.max(st, cheapScore(r.A, r.L, best.curveEdits)) });
    };
    if (drv.length <= 2) {
      // 48 / 12x12 points, and a LENGTH ratio is spaced geometrically: its range can run from 0.6
      // to 14, and 24 even steps of ~0.58 jumped clean over #25524 m8 si14's whole good window.
      const GRID_N = opts.gridN || (drv.length === 1 ? 48 : 12);
      const ranges = drv.map(k => bracketDriverRange(TC, CHK, eqs, groups, m, edgeSym, u0, drv, k, k >= F.free.length));
      const axes = drv.map((k, i) => { const [lo, hi] = ranges[i], geo = k >= F.free.length && lo > 0 && hi > lo;
        const pts = []; for (let j = 0; j < GRID_N; j++) { const t = j / (GRID_N - 1 || 1); pts.push(geo ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t); }
        return pts; });
      if (drv.length === 1) { for (const v of axes[0]) { const uu = u0.slice(); uu[drv[0]] = v; tryPoint(uu); } }
      else { for (const v0 of axes[0]) for (const v1 of axes[1]) { const uu = u0.slice(); uu[drv[0]] = v0; uu[drv[1]] = v1; tryPoint(uu); } }
    } else {
      const nSamp = opts.familySamples || 60;
      // fixed seed: dd_route.curveVerdict feeds this walk's result into published verdicts
      const rngW = mulberry32(0x5EED ^ m ^ (drv.length << 4));
      for (let t = 0; t < nSamp; t++) {
        const uu = u0.slice();
        for (const k of drv) uu[k] += (rngW() * 2 - 1) * (k < F.free.length ? 90 : 1.5);
        tryPoint(uu);
      }
    }
    // Other BRANCHES of the family: re-close from well-spread random starts (every unknown, not just
    // the drivers), so Newton can land on solution branches no slide along one parameter reaches --
    // John's tile for #209195 m8 si5 sits on a branch whose angles differ by ~160 deg from ours.
    const rngB = mulberry32(0xB2A9 ^ m ^ (F.nU << 6));
    for (let t = 0; t < (opts.branchStarts || 40); t++)
      tryPoint(u0.map((x, i) => i < F.free.length ? 20 + rngB() * 320 : Math.exp((rngB() * 2 - 1) * Math.log(10))));
    // ...and, when asked (opts.branchStarts2), a wider spread scaled to this member's own lengths:
    // #25552 m8 si2 or1 off3's tile sits on a branch the 40 starts above never reach. Off by
    // default: on for every walk it re-ranks the pool and loses #25552 m8 si2 or1 off5's tile, so
    // dd_route.curveVerdict runs it only as a second attempt when the plain walk fails (2026-09-13).
    const rngB2 = mulberry32(0xB2AA ^ m ^ (F.nU << 6));
    for (let t = 0; t < (opts.branchStarts2 || 0); t++)
      tryPoint(u0.map((x, i) => i < F.free.length ? rngB2() * 360 : x * Math.exp((rngB2() * 2 - 1) * 2)));
    const pool = candidates.slice();                 // parameter-space order, before ranking
    candidates.sort((a, b) => b.clr - a.clr);
    const top = candidates.filter(c => c.clr > best.clearance).slice(0, opts.topK || 4);
    // When the current curve fails everywhere, its cheap score says nothing about where a curve
    // WOULD work -- so also hand the full curve designer a spread of members across the family.
    // John's solutions for #209081 m7 si1, #209389 m7 si0/si1 and #25525 m5 si0 off3 sat at members
    // the old ranking never picked, and the designer clears every one of them.
    if (best.clearance <= 1e-4 && pool.length) {
      const stepP = Math.max(1, Math.floor(pool.length / (opts.spreadK || 8)));
      for (let i = 0; i < pool.length; i += stepP) if (!top.includes(pool[i])) top.push(pool[i]);
    }
    for (const cand of top) {
      if (cand.straight > best.clearance) best = { A: cand.A, L: cand.L, curveEdits: flatEdits(), clearance: cand.straight };
      const diagC = diagnose(deps, ctx, cand.A, cand.L);
      if (diagC.verdict === 'not a tile') continue;
      const curvesC = designCurves(deps, ctx, cand.A, cand.L, existingEdits, diagC, opts);
      if (curvesC.clearance > best.clearance) best = { A: cand.A, L: cand.L, curveEdits: curvesC.curveEdits, clearance: curvesC.clearance };
    }
    return best;
  }

  // ---- the member to KEEP: most clearance, clear of 60/90/180, lengths visibly different -------
  //
  // John, 2026-09-13: "default to the walk with the most clearance. (Although, I do still want to
  // not have angles too near 180, 90 or 60 degrees, and not have lengths too close to equal. If
  // possible.)" -- after he redrew #25539 m11 si19 at ratio 0.78 and the automatic clearance walk
  // landed at 0.93, both on the same clearance plateau, where the stored shape had sat at 0.27.
  //
  // Walks the closing family (same bracketed, geometric-for-lengths grid as designShapeAndCurves)
  // over members whose STRAIGHT outline is simple, scoring each by its outline clearance. A member is
  // "nice" when every angle that varies across the family sits >= ANG_MARGIN from 60/90/180 and their
  // look-alikes, and every pair of length groups whose ratio varies differs by >= LEN_MARGIN. Forced
  // angles and lengths never count. The nice member with the most clearance wins if it keeps at
  // least `keep` (default 0.85) of the best clearance anywhere; otherwise the clearance maximum wins.
  // Then a local climb from the chosen point, which never gives up "nice" once it had it. Families
  // whose start needs curves go to designShapeAndCurves (most clearance with designed curves).
  // Only picks WHICH member to keep -- never changes whether it is a tile.
  function presentableShape(deps, ctx, A, L, opts) {
    opts = opts || {};
    const { TC, m, edgeSym, groups, eqs } = ctx;
    const CD = deps.CD || CDDefault, CHK = deps.CHK || CHKDefault;
    const keep = opts.keep != null ? opts.keep : 0.85;
    const sepOf = (AA, LL) => CD.separation(TC.verticesOf(AA, LL, m).slice(0, m)).rel;
    const diag0 = diagnose(deps, ctx, A, L);
    if (diag0.verdict === 'not a tile') return { A, L, clearance: 0, note: 'not a tile' };
    if (diag0.verdict === 'curves required') {
      const w = designShapeAndCurves(deps, ctx, A, L, opts.existingEdits || {}, opts);
      return { A: w.A, L: w.L, curveEdits: w.curveEdits, clearance: w.clearance, note: 'curves required: most clearance with designed curves' };
    }
    let F, u0, drv;
    try { F = TC.familyFns(eqs, groups, m); u0 = F.toU(A, L); drv = (TC.pickDrivers(eqs, groups, m, u0).drivers || []).map(d => d.u); }
    catch (e) { return { A, L, clearance: sepOf(A, L), note: 'family unavailable' }; }
    if (!drv.length) return { A, L, clearance: sepOf(A, L), note: 'rigid: the only shape' };
    const cands = [];
    const tryU = uu => { let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { return null; }
      if (!r || !r.A || !r.ok || !r.u) return null;
      if (CHK.quality(r.A, r.L, null, m, edgeSym).degenerate) return null;
      if (diagnose(deps, ctx, r.A, r.L).verdict !== 'straight ok') return null;
      const c = { A: r.A, L: r.L, u: r.u, clr: sepOf(r.A, r.L) }; cands.push(c); return c; };
    tryU(u0.slice());
    if (drv.length <= 2) {
      const GRID_N = opts.gridN || (drv.length === 1 ? 48 : 12);
      const ranges = drv.map(k => bracketDriverRange(TC, CHK, eqs, groups, m, edgeSym, u0, drv, k, k >= F.free.length));
      const axes = drv.map((k, i) => { const [lo, hi] = ranges[i], geo = k >= F.free.length && lo > 0 && hi > lo;
        const pts = []; for (let j = 0; j < GRID_N; j++) { const t = j / (GRID_N - 1 || 1); pts.push(geo ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t); }
        return pts; });
      if (drv.length === 1) { for (const v of axes[0]) { const uu = u0.slice(); uu[drv[0]] = v; tryU(uu); } }
      else { for (const v0 of axes[0]) for (const v1 of axes[1]) { const uu = u0.slice(); uu[drv[0]] = v0; uu[drv[1]] = v1; tryU(uu); } }
    } else {
      const rngP = mulberry32(0xC1EA ^ m ^ (drv.length << 4));
      for (let t = 0; t < (opts.familySamples || 80); t++) {
        const uu = u0.slice();
        for (const k of drv) uu[k] = k >= F.free.length ? Math.max(0.02, uu[k] * Math.exp((rngP() * 2 - 1) * 1.5)) : uu[k] + (rngP() * 2 - 1) * 90;
        tryU(uu);
      }
    }
    // other solution branches too (see designShapeAndCurves) -- a better member may sit on one
    const rngB = mulberry32(0xB2A9 ^ m ^ (F.nU << 6));
    for (let t = 0; t < (opts.branchStarts || 40); t++)
      tryU(u0.map((x, i) => i < F.free.length ? 20 + rngB() * 320 : Math.exp((rngB() * 2 - 1) * Math.log(10))));
    const rngB2 = mulberry32(0xB2AA ^ m ^ (F.nU << 6));
    for (let t = 0; t < (opts.branchStarts2 || 0); t++)
      tryU(u0.map((x, i) => i < F.free.length ? rngB2() * 360 : x * Math.exp((rngB2() * 2 - 1) * 2)));
    if (!cands.length) return { A, L, clearance: sepOf(A, L), note: 'no clean member found' };
    // which angles / length ratios actually vary across the family -- forced ones never count
    const angFree = [];
    for (let i = 0; i < m; i++) { const vs = cands.map(c => ((c.A[i] % 360) + 360) % 360); angFree.push(Math.max(...vs) - Math.min(...vs) > 0.5); }
    const pairs = [];
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const vs = cands.map(c => Math.log((c.L[groups[i][0]] || 1e-9) / (c.L[groups[j][0]] || 1e-9)));
      if (Math.max(...vs) - Math.min(...vs) > 1e-3) pairs.push([i, j]);
    }
    const nice = c => {
      for (let i = 0; i < m; i++) if (angFree[i] && nearestTargetDist(c.A[i]) < ANG_MARGIN) return false;
      for (const [i, j] of pairs) if (Math.abs(Math.log((c.L[groups[i][0]] || 1e-9) / (c.L[groups[j][0]] || 1e-9))) < LEN_MARGIN) return false;
      return true; };
    const best = cands.reduce((a, b) => b.clr > a.clr ? b : a);
    const niceOnes = cands.filter(c => nice(c) && c.clr >= keep * best.clr);
    let cur = niceOnes.length ? niceOnes.reduce((a, b) => b.clr > a.clr ? b : a) : best;
    const wantNice = nice(cur);
    for (let step = 0.25, it = 0; step > 1e-3 && it < 200; it++) {
      let moved = false;
      for (const k of drv) for (const dir of [1, -1]) {
        const uu = cur.u.slice();
        uu[k] = k >= F.free.length ? uu[k] * Math.exp(dir * step) : uu[k] + dir * step * 20;
        const c = tryU(uu);
        if (c && c.clr > cur.clr + 1e-9 && (!wantNice || nice(c))) { cur = c; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return { A: cur.A, L: cur.L, clearance: cur.clr, nice: nice(cur),
             note: wantNice ? 'most clearance among members clear of 60/90/180 and of equal lengths'
                            : 'most clearance (no member avoids 60/90/180 and equal lengths without giving up too much clearance)' };
  }

  // ---- orchestration --------------------------------------------------------------------------
  function design(deps, ctx, A, L, existingEdits, opts) {
    opts = opts || {};
    const diag = diagnose(deps, ctx, A, L);
    if (diag.verdict === 'not a tile') return { diag };
    let shape = { A, L, report: null };
    if (opts.chooseShape) shape = chooseShape(deps, ctx, A, L, opts);
    const needCurves = diag.verdict === 'curves required' || opts.alwaysCurves;
    let curves = null;
    if (needCurves) {
      const diag2 = shape.report ? diagnose(deps, ctx, shape.A, shape.L) : diag;
      curves = designCurves(deps, ctx, shape.A, shape.L, existingEdits, diag2, opts);
    }
    return { diag, shape, curves };
  }

  const api = { diagnose, chooseShape, designCurves, designShapeAndCurves, presentableShape, design, repMapping, nearestTargetDist, NEAR_TARGETS, ANG_MARGIN, LEN_MARGIN, SEP_OK, isGeneratedMotif, bracketDriverRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TileDesigner = api;
})(typeof window !== 'undefined' ? window : this);
