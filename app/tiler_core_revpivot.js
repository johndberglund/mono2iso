// Pure geometry/development core for the tiler drawing app.  No DOM; usable in
// Node (module.exports) and the browser (window.TilerCore).
// Given a chosen config's angle equations + length groups, solve a representative
// closing tile, then develop the tiling by gluing copies along the net edges.
//
// EXPERIMENTAL FORK of tiler_core.js: rref() below tries column 0 first (so A0
// -- which verticesOf() never uses to place an edge; see the note in rref() --
// always gets pivoted out into a dependent angle instead of landing on a slider),
// then walks the rest of the columns m-1 down to 1, so among the angles that CAN
// usefully be dragged, pivots preferentially land on the HIGH-numbered ones and
// the "free angles" sliders default to LOW-numbered ones. Everything else is
// untouched. Swap the tiler_core.js <script src> in tilerTest.html to this file
// to try it; swap back to revert.
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  // ---- reduced row echelon of the angle equations (cols 0..m-1 = angles, col m = deg)
  // Column try-order is [0, m-1, m-2, ..., 1]: A0's turn (see verticesOf) is
  // computed after the last edge is placed and never used to place another one,
  // so dragging it as a free slider doesn't move any edge directly -- it only
  // reshapes the tile indirectly through whichever dependent angles' formulas
  // happen to reference it, which is confusing (the loose/open end at vertex 0
  // swings around without an intuitive tie to the number you're dragging).
  // Trying column 0 first guarantees it gets pivoted into a dependent angle
  // whenever any equation touches it, before the greedy high-to-low pass fills
  // the remaining pivot slots and leaves the low end free.
  function rref(eqs, m) {
    const M = eqs.map(r => r.slice()); const rows = M.length, cols = m + 1;
    const order = [0]; for (let c = m - 1; c >= 1; c--) order.push(c);
    let pr = 0; const piv = [];
    for (let oi = 0; oi < order.length && pr < rows; oi++) {
      const c = order[oi];
      let mx = pr;
      for (let r = pr + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[mx][c])) mx = r;
      if (Math.abs(M[mx][c]) < 1e-9) continue;
      [M[pr], M[mx]] = [M[mx], M[pr]];
      const d = M[pr][c]; for (let j = 0; j < cols; j++) M[pr][j] /= d;
      for (let r = 0; r < rows; r++) if (r !== pr && Math.abs(M[r][c]) > 1e-9) {
        const f = M[r][c]; for (let j = 0; j < cols; j++) M[r][j] -= f * M[pr][j];
      }
      piv.push([c, pr]); pr++;
    }
    return { M, piv };
  }

  // structure: which angles are free, how dependent ones follow, which are flat(=180)
  function angleStructure(eqs, m) {
    const { M, piv } = rref(eqs, m);
    const pivCols = piv.map(p => p[0]);
    const free = []; for (let c = 0; c < m; c++) if (!pivCols.includes(c)) free.push(c);
    const dep = {};
    for (const [c, r] of piv) {
      const co = {}; for (const f of free) if (Math.abs(M[r][f]) > 1e-9) co[f] = M[r][f];
      dep[c] = { rhs: M[r][m], co };               // A_c = rhs - sum co[f]*A_f
    }
    const flat = new Set();
    for (const c in dep) if (Object.keys(dep[c].co).length === 0 && Math.abs(dep[c].rhs - 180) < 1e-6) flat.add(+c);
    return { free, dep, flat };
  }

  function anglesFrom(free, freeVals, dep, m) {
    const A = new Array(m).fill(0);
    free.forEach((c, i) => A[c] = freeVals[i]);
    for (const c in dep) { let v = dep[c].rhs; for (const f in dep[c].co) v -= dep[c].co[f] * A[f]; A[+c] = v; }
    return A;
  }
  // Hot-path form of the above. anglesFrom was measured at 43% of all Newton time (V8 CPU
  // profile over 1156 real #69445 m=26 configs): it is called (nU+1) times per Newton iteration,
  // 28 restarts x up to 140 iterations per combo, and each call pays for two `for...in` object
  // walks (slow in V8) plus a `forEach` closure allocation. compileDep() flattens `dep` into
  // plain index/coefficient arrays ONCE per solve; anglesFromC() is then a straight numeric loop.
  // Deliberately returns a plain Array, not a Float64Array: callers `.map()`/`.slice()` the
  // result and JSON-serialise it, and a typed array would silently serialise as an object.
  // Key subtlety: dependent angles can reference other dependents, so Object.keys order (the
  // same order the original `for...in` used) must be preserved.
  function compileDep(free, dep, m) {
    const keys = Object.keys(dep);
    const depIdx = keys.map(Number);
    const depRhs = keys.map(k => dep[k].rhs);
    const coIdx = [], coVal = [];
    for (const k of keys) {
      const fs = Object.keys(dep[k].co);
      coIdx.push(fs.map(Number));
      coVal.push(fs.map(f => dep[k].co[f]));
    }
    return { free: free.slice(), nFree: free.length, depIdx, depRhs, coIdx, coVal, nDep: keys.length, m };
  }
  function anglesFromC(C, freeVals) {
    const m = C.m, A = new Array(m);
    for (let i = 0; i < m; i++) A[i] = 0;
    const fr = C.free;
    for (let i = 0; i < C.nFree; i++) A[fr[i]] = freeVals[i];
    for (let j = 0; j < C.nDep; j++) {
      let v = C.depRhs[j];
      const ci = C.coIdx[j], cv = C.coVal[j];
      for (let t = 0; t < ci.length; t++) v -= cv[t] * A[ci[t]];
      A[C.depIdx[j]] = v;
    }
    return A;
  }
  // resid() only ever needs the CLOSING ENDPOINT, but verticesOf builds the whole m+1 point
  // array (m+1 two-element array allocations) every call -- and resid is the innermost thing in
  // the Newton loop. This accumulates the endpoint with no allocation at all. Identical walk and
  // identical arithmetic order to verticesOf, so it returns bit-identical coordinates.
  function endpointOf(A, L, m) {
    let x = 0, y = 0, h = 0;
    for (let i = 0; i < m; i++) {
      x += L[i] * Math.cos(h); y += L[i] * Math.sin(h);
      h += Math.PI - A[(i + 1) % m] * D2R;
    }
    return [x, y];
  }

  // walk the polygon: vertex 0 at origin, side i along heading h_i, turn (180-A_{i+1})
  function verticesOf(A, L, m) {
    const v = [[0, 0]]; let h = 0;
    for (let i = 0; i < m; i++) {
      const p = v[i];
      v.push([p[0] + L[i] * Math.cos(h), p[1] + L[i] * Math.sin(h)]);
      h += Math.PI - A[(i + 1) % m] * D2R;
    }
    return v;                                       // v[m] should equal v[0] when closed
  }
  function gapOf(A, L, m) { const v = verticesOf(A, L, m); return Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]); }
  function areaOf(v, m) { let s = 0; for (let i = 0; i < m; i++) { const a = v[i], b = v[(i + 1) % m]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  // every corner on one line: a flat collapse, not a polygon. Within 1e-5 of the shape's width, not
  // exactly -- round-off (John, 2026-09-14), and closers themselves are accepted at a 1e-6 gap.
  function allColinear(V) {
    let P = null, Q = null, D = 0;
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const d = Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1]); if (d > D) { D = d; P = V[i]; Q = V[j]; } }
    if (!(D > 0)) return true;
    return V.every(p => Math.abs((Q[0] - P[0]) * (p[1] - P[1]) - (Q[1] - P[1]) * (p[0] - P[0])) / D < 1e-5 * D);
  }
  // Closest pair of DISTINCT tile vertices.  Two vertices landing on the same point is a
  // degeneracy no curve can repair -- curves are mapped from edge ENDPOINTS
  // (tiler_curves.mapToEdge), so they never move a vertex.  Contrast a 0 angle with
  // UNEQUAL flanking edges, which is fine: the longer edge just curves around the shorter.
  // Not caught by relArea -- a zero-width spike or fold contributes no area, so tiles with
  // relArea up to 2.6 have shown up with coincident vertices.
  // Threshold sits in an empty band in the data: over the 474 certified configs, the
  // 30 coincident-vertex solves top out at 3.2e-7 and the next value up is 1.5e-3.
  // The 54 hand-drawn (known-real) tilings bottom out at 5.0e-2, so this clears them
  // by ~5000x.
  const MIN_VERTEX_SEP = 1e-5;
  const EDGE_I = 2, EDGE_S = 3;   // edgeSym: 0 J, 1 U, 2 I, 3 S
  // A tile corner sitting ON a non-adjacent edge means the boundary passes through the same
  // point twice (once as a vertex, once as an edge-interior point) -- a non-simple boundary,
  // which cannot be a tile, for ANY parameter values.  Whether a curve can lift the corner
  // off the edge depends on the edge TYPE, which is why area / vertex-separation cannot see
  // it.  Two cases are unrepairable:
  //
  //   I edge: straight by definition -- its chord IS the edge, so a corner on the chord is
  //           on the boundary.  Subsumes the zero-angle case (a 0 angle whose longer flanking
  //           edge is I drops the short edge's endpoint onto it), and also catches folds made
  //           by flat 180 angles: #72871 lands v4 exactly 1/3 along a length-3*sqrt3 I edge.
  //   S edge: point-symmetric about its chord MIDPOINT, and buildCanon pins the curve through
  //           (0.5,0), so the curve cannot avoid a corner sitting exactly at the midpoint.
  //           #25539/#25515: a 0 angle whose longer flanking edge is S, with short/long = 1/2,
  //           lands the corner on the S centre.
  //
  // J and U can bow their whole span clear of an interior point, so they are not fatal.
  // Needs edgeSym, passed to solveTile via opts.  Returns {vertex, edge, kind} or null.
  function boundaryTouch(A, L, m, edgeSym) {
    if (!edgeSym) return null;
    const V = verticesOf(A, L, m);
    // The tile comes out of float Newton, which converges to ~1e-6, so an EXACT geometric
    // coincidence lands a few times 1e-6 away -- the old 1e-6*scale tolerance was tighter
    // than the solver's own accuracy and so missed real touches. #25539 is exactly this:
    // v5 sits on the midpoint of S-edge e2 (John spotted it by eye: "v5 lands on e2") at
    // distance 4.37e-6, i.e. 4.4x outside the old tolerance, so the config was wrongly
    // accepted and then showed up downstream as an unexplained L1.
    // Tolerance chosen by measurement, not guess: across all 288 clean (hand/L3/L2) types
    // the CLOSEST legitimate vertex-to-edge approach is 1.9e-3 (#25538), so the safe window
    // is (4.4e-6, 1.9e-3) -- a factor of 436. 1e-4 is ~23x above the degeneracy and ~19x
    // below the nearest legitimate case, i.e. essentially the geometric mean.
    const scale = Math.max(...L), tol = 1e-4 * scale;
    for (let vi = 0; vi < m; vi++) {
      const p = V[vi];
      for (let e = 0; e < m; e++) {
        if (e === vi || (e + 1) % m === vi) continue;      // vi is an endpoint of edge e
        const a = V[e], b = V[(e + 1) % m], es = edgeSym[e];
        if (es === EDGE_I) {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-12) continue;
          const dist = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
          if (dist > tol) continue;                        // not on the line
          const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
          if (t > 1e-4 && t < 1 - 1e-4) return { vertex: vi, edge: e, kind: 'I' };  // strictly interior
        } else if (es === EDGE_S) {
          if (Math.hypot(p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2) < tol)
            return { vertex: vi, edge: e, kind: 'S' };
        }
      }
    }
    return null;
  }
  function minVertexSep(v, m) {
    let d = Infinity;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++)
      d = Math.min(d, Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1]));
    return d;
  }
  // Does the closing m-gon cross itself?  boundaryTouch above catches a VERTEX landing
  // exactly on a non-adjacent edge (a zero-measure touch); this catches the broader case of
  // two non-adjacent SIDES properly crossing (a transversal intersection, the tile forming a
  // bowtie).  A self-intersecting polygon is not simple, so it is not a tile at all -- no
  // curve, no parameter choice fixes it, since it fails before the boundary even needs to be
  // "developed": there is no consistent inside/outside to glue copies of.
  //
  // Found 2026-07-21 auditing why the L1 category (closes, patch overlaps) was so large:
  // 86 of 91 L1 winning configs have a self-intersecting base m-gon.  solveTile's `ok` test
  // (relGap/relArea/relSep/boundaryTouch) never checked this, so a self-intersecting
  // candidate could satisfy every other gate and be accepted as a genuine closing tile --
  // its later "overlap" in develop() was never a tiling defect, it was this.
  function polySelfIntersects(v, m) {
    const o = (a, b, c) => Math.sign((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]));
    for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;               // adjacent through the wrap
      const p1=v[i], p2=v[(i+1)%m], p3=v[j], p4=v[(j+1)%m];
      const d1=o(p3,p4,p1), d2=o(p3,p4,p2), d3=o(p1,p2,p3), d4=o(p1,p2,p4);
      if (d1!==d2 && d3!==d4 && d1 && d2 && d3 && d4) return true;
    }
    return false;
  }

  // length groups -> per-side length from group scales
  function expandLengths(groups, scales, m) {
    const L = new Array(m).fill(1);
    groups.forEach((g, gi) => g.forEach(i => L[i] = scales[gi]));
    return L;
  }

  // ---- solve a representative closing tile: unknowns = free angles + group scales(1..G-1)
  // solveTile is a pure function of the REDUCED angle system (free/dep/flat) + the length
  // groups, so memoize on exactly that.  Many (sum,orient,offset) configs of a type reduce
  // to the same system (offset only relabels / adds redundant vertex equations), so this
  // skips re-running the Newton search for them — ~half the solves on the explore sample.
  const _solveCache = new Map();
  function solveKey(free, dep, flat, groups, m, opts) {
    const d = Object.keys(dep).sort((a, b) => a - b).map(c => {
      const x = dep[c], co = Object.keys(x.co).sort((a, b) => a - b).map(f => f + ':' + x.co[f].toFixed(6)).join(',');
      return c + '=' + x.rhs.toFixed(6) + '|' + co;
    }).join(';');
    const g = groups.map(gr => gr.slice().sort((a, b) => a - b).join('.')).sort().join('|');
    return m + '#F' + free.slice().sort((a, b) => a - b).join(',') + '#D' + d +
           '#L' + [...flat].sort((a, b) => a - b).join(',') + '#G' + g + '#' + JSON.stringify(opts || {});
  }
  function solveTile(eqs, groups, m, opts) {
    opts = opts || {};
    const { free, dep, flat } = angleStructure(eqs, m);
    const G = groups.length;
    const realCorners = m - flat.size;
    // `status` is three-valued and must never conflate "we didn't find one" with
    // "impossible".  'impossible' is reserved for a PROOF; here the angle equations
    // pin >= m-2 vertices flat regardless of lengths, so < 3 corners is genuinely
    // impossible (a polygon needs >= 3 corners).  Newton non-convergence below is
    // 'unknown', NOT 'impossible'.
    if (realCorners < 3) return { ok: false, status: 'impossible', reason: 'degenerate (<3 corners)', realCorners, free, dep, flat };

    const nU = free.length + (G - 1);               // group 0 scale fixed = 1
    // initial guess: interior angle of a regular realCorners-gon for free angles
    const a0 = (realCorners - 2) * 180 / realCorners;

    // optional seed: re-auto-solve from the CURRENT (hand-edited) config.  Build the
    // unknown vector from the seed's free angles + group scales, start Newton there
    // (restart 0), and prefer the closing tile NEAREST the seed (not the biggest-area
    // one) so the result stays close to what the user dialed in.  Seeded solves bypass
    // the cache (the seed is a continuum, and the user wants a fresh local solve).
    // The unknowns hold group 0's scale FIXED at 1, so the other groups are RATIOS to it.
    // The seed must be normalised the same way (this is what familyFns.toU does), or a tile
    // whose group-0 edge is not already 1 gets its seed misread — Newton then starts far from
    // the user's shape and "nearest the seed" is measured against a distorted target.
    // seedScale is put back on the way out, so re-solving keeps the tile's SIZE and only
    // changes its shape; without it every re-solve snapped edge 0 to length 1.
    let seedU = null, seedScale = 1;
    if (opts.seed && opts.seed.A && opts.seed.L) {
      seedU = [];
      for (const c of free) seedU.push(opts.seed.A[c]);
      seedScale = opts.seed.L[groups[0][0]] || 1;
      for (let i = 1; i < G; i++) seedU.push(opts.seed.L[groups[i][0]] / seedScale);
    }
    // distance of an unknown vector to the seed (angles in deg, a 1.0 scale change ~ 90 deg)
    const seedDist = u => { if (!seedU) return 0; let s = 0;
      for (let i = 0; i < free.length; i++) { const d = u[i] - seedU[i]; s += d * d; }
      for (let i = free.length; i < nU; i++) { const d = 90 * (u[i] - seedU[i]); s += d * d; }
      return s; };

    // A precision override makes this a DIFFERENT numerical question about the same config,
    // so it must bypass the cache in both directions -- otherwise the first (default-
    // precision) answer would be served to a high-precision request, silently defeating the
    // whole point of the accuracy-scaling test.
    const accOverride = opts.fdEps !== undefined || opts.lam !== undefined ||
                        opts.ftol !== undefined || opts.maxIt !== undefined;
    let key = null;
    if (!seedU && !accOverride) {
      key = solveKey(free, dep, flat, groups, m, opts);
      const hit = _solveCache.get(key);
      if (hit) return { ...hit, A: hit.A.slice(), L: hit.L.slice() };  // fresh A/L: callers edit them
    }

    const depC = compileDep(free, dep, m);            // flatten `dep` once, not per resid() call
    function unpack(u) {
      const scales = [1]; for (let i = 0; i < G - 1; i++) scales.push(Math.max(0.05, u[free.length + i]));
      const A = anglesFromC(depC, u);                 // u's first free.length entries ARE fv
      const L = expandLengths(groups, scales, m);
      return { A, L };
    }
    // v[0] is the origin by construction, so the residual is just the endpoint.
    function resid(u) { const { A, L } = unpack(u); return endpointOf(A, L, m); }

    let best = null;            // best closer (nearest seed if seeded, else biggest area)
    let fallback = null;        // smallest-gap seen, in case nothing closes
    const rng = mulberry32(12345);
    for (let restart = 0; restart < 28; restart++) {
      let u = [];
      // restart 0 = seed (if given) else regular-polygon guess; rest = random
      for (let i = 0; i < free.length; i++) u.push(restart === 0 ? (seedU ? seedU[i] : a0) : 20 + rng() * 150);
      for (let i = 0; i < G - 1; i++) u.push(restart === 0 ? (seedU ? seedU[free.length + i] : 1) : 0.4 + rng() * 1.6);
      // Solver precision is overridable so the SAME config can be re-solved at several
      // accuracy levels and the result compared -- John's test for telling a real geometric
      // gap from a converged-to-tolerance artifact: "if we compute to a certain level of
      // accuracy, we will get gaps just above some threshold. If we change the accuracy, the
      // gaps move to a different threshold. This is not tiling behavior - but round off."
      // A genuine separation is precision-INVARIANT; a fake one tracks the tolerance.
      // Defaults are exactly the historical values, so unset opts change nothing.
      newton(u, opts.maxIt || 140, opts.ftol || 1e-9, opts.fdEps || 1e-4, opts.lam !== undefined ? opts.lam : 1e-3);
      let cand = measure(u);
      // ROUND-OFF TEST -- see tiler_core.js solveTile for the full note (#72758). A solve that
      // passes the loose (longest-edge) test but is not at true closure against the SHORTEST
      // edge is polished at high precision and counts only if the polish gets it there.
      // Keep whichever of the unpolished/polished shapes is a valid tile; between two equally
      // (in)valid ones, the tighter closure (#25524 m6 vs #3189 m5 -- see tiler_core.js).
      if (!opts.legacyAccept && cand.relGap < 0.008 && cand.relGapMin > 1e-9) {
        const u2 = u.slice();
        newton(u2, 800, 1e-14, 1e-6, 1e-7);
        const c2 = measure(u2), v1 = validTile(cand), v2 = validTile(c2);
        if ((v2 && !v1) || (v2 === v1 && c2.relGapMin < cand.relGapMin)) { u = u2; cand = c2; }
      }
      const { A, L, g, relGap, relArea, relSep, touch, selfX, clamped, ratio, relGapMin, clampFake } = cand;
      const roundFake = !opts.legacyAccept && relGapMin > 1e-6;
      const full = { A, L, gap: g, relGap, relArea, relSep, touch, selfX, clamped, ratio,
                     relGapMin, clampFake, roundFake, dist: seedDist(u), free, dep, flat, realCorners };
      if (!fallback || relGap < fallback.relGap) fallback = full;
      if (relGap < 0.008 && relArea > 0.02 && relSep > MIN_VERTEX_SEP && !touch && !selfX && !clampFake && !roundFake) {
        if (!best || (seedU ? full.dist < best.dist : relArea > best.relArea)) best = full;
      }
    }
    function newton(u, maxIt, ftol, eps, lam) {
      for (let it = 0; it < maxIt; it++) {
        const r = resid(u); const f = Math.hypot(r[0], r[1]);
        if (f < ftol) break;
        const J = [[], []];
        for (let k = 0; k < nU; k++) {
          const uu = u.slice(); uu[k] += eps; const r2 = resid(uu);
          J[0].push((r2[0] - r[0]) / eps); J[1].push((r2[1] - r[1]) / eps);
        }
        const A2 = new Array(nU).fill(0).map(() => new Array(nU).fill(0));
        const b2 = new Array(nU).fill(0);
        for (let a = 0; a < nU; a++) {
          for (let bb = 0; bb < nU; bb++) A2[a][bb] = J[0][a] * J[0][bb] + J[1][a] * J[1][bb] + (a === bb ? lam : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]);
        }
        const d = solveLin(A2, b2); if (!d) break;
        for (let k = 0; k < nU; k++) u[k] += d[k];
      }
    }
    function measure(u) { const { A, L } = unpack(u); return measureAL(A, L); }
    function validTile(c) {
      return c.relGap < 0.008 && c.relArea > 0.02 && c.relSep > MIN_VERTEX_SEP && !c.touch && !c.selfX
        && !c.clampFake && c.relGapMin <= 1e-6;
    }
    function measureAL(A, L) {
      const v = verticesOf(A, L, m);
      const g = Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]);
      const scale = Math.max(...L); const relGap = g / scale;
      const relArea = areaOf(v.slice(0, m), m) / (scale * scale);
      const relSep = minVertexSep(v, m) / scale;
      const touch = boundaryTouch(A, L, m, opts.edgeSym);
      const selfX = polySelfIntersects(v, m);
      // Two red flags on the SHAPE of the solution:
      //  clamped  - some group scale is sitting exactly on unpack()'s 0.05 lower clamp, i.e.
      //             Newton wanted to go shorter and got clipped. Such a tile is a solver
      //             artifact at the edge of the feasible region, not a chosen shape; it is
      //             what produced the phantom "stable 5.00e-2 gaps" (4 of the 383 clean types)
      //             and #72675's fake closure.
      //  ratio    - max/min edge ratio. John: "if we make the edge ratio greater and greater,
      //             we can make any threshold level fail ... but I think that every tiling
      //             also allows much smaller ratios." relGap is normalised by the LONGEST
      //             edge, so a huge ratio shrinks it artificially: #72675 reads relGap 3.7e-3
      //             against max, but 7.5e-2 against min, and it does not actually close.
      // As a RATIO (John, 2026-09-13), so a group growing to 20x+ counts, not only one shrinking
      // onto the 0.05 floor -- see tiler_core.js.
      const clamped = Math.min(...L) / Math.max(...L) <= 0.05 + 1e-12;
      const ratio = Math.max(...L) / Math.min(...L);
      const relGapMin = g / Math.min(...L);
      // A clamped solution only counts as closed if the gap is at true-closure scale RELATIVE TO
      // THE SHORTEST EDGE. On the clamp floor, relGap (over max L) flatters the fit by the edge
      // ratio; relGapMin does not. John checked all three suspects by hand: #209100 and #209209
      // have gap == shortest edge exactly (relGapMin 1.0), and #72675 needs edges of length 0 to
      // close at all. Genuine closures land at ~1e-15, so 1e-6 separates them by nine orders.
      const clampFake = clamped && relGapMin > 1e-6;
      return { A, L, g, relGap, relArea, relSep, touch, selfX, clamped, ratio, relGapMin, clampFake };
    }
    const out = best || fallback;
    out.ok = !!best;
    // WALK TO A MODERATE RATIO -- see tiler_core.js solveTile for the full note. An unseeded solve
    // that lands on the 0.05 floor is walked along its family (extreme length group stepped 15%
    // toward the others, re-closed with it held fixed) while every step stays an exact, valid
    // closure; it stops at shortest/longest >= 0.25 or the first failing step.
    if (out.ok && !seedU && out.clamped && !opts.noRatioWalk) {
      const w = walkRatio(out);
      if (w) Object.assign(out, { A: w.A, L: w.L, gap: w.g, relGap: w.relGap, relArea: w.relArea, relSep: w.relSep,
                                  clamped: w.clamped, ratio: w.ratio, relGapMin: w.relGapMin, walked: true });
    }
    function walkRatio(sol) {
      const s0 = sol.L[groups[0][0]] || 1;
      let cur = free.map(c => sol.A[c]);
      for (let i = 1; i < G; i++) cur.push(sol.L[groups[i][0]] / s0);
      const rat = L => Math.min(...L) / Math.max(...L);
      let good = null, best = rat(sol.L), f = 1.15;
      for (let step = 0; step < 200 && f > 1.001; step++) {
        // re-pick the extreme groups every step; group 0 is pinned, so "raise it" = lower the largest
        const sc = [1, ...cur.slice(free.length)];
        let iMin = 0, iMax = 0;
        sc.forEach((s, i) => { if (s < sc[iMin]) iMin = i; if (s > sc[iMax]) iMax = i; });
        // move every group tied at the extreme together
        const tied = v => sc.map((s, i) => i).filter(i => i && Math.abs(sc[i] - v) <= 1e-9 * v);
        const moves = [];
        if (iMin !== 0) moves.push([tied(sc[iMin]), f]);
        if (iMax !== 0) moves.push([tied(sc[iMax]), 1 / f]);
        let pick = null;
        for (const [gs, mul] of moves) {
          const nu = cur.slice(), ks = gs.map(i => free.length + i - 1);
          ks.forEach(k => { nu[k] *= mul; });
          closeFixed(nu, ks);
          const { A, L } = unpack(nu), c = measureAL(A, L), r = rat(L);
          if (r > best * (1 + 1e-9) && walkValid(c, A, L) && (!pick || r > pick.r)) pick = { nu, c, r };
        }
        if (!pick) { f = Math.sqrt(f); continue; }
        cur = pick.nu; good = pick.c; best = pick.r; f = Math.min(1.15, f * f);
        if (best >= 0.25) break;
      }
      return good;
    }
    function closeFixed(u, ks) {
      const idx = []; for (let j = 0; j < nU; j++) if (!ks.includes(j)) idx.push(j);
      for (let it = 0; it < 400 && idx.length; it++) {
        const r = resid(u); if (Math.hypot(r[0], r[1]) < 1e-14) break;
        const J = [[], []], e = 1e-7, n = idx.length;
        for (const j of idx) { const uu = u.slice(); uu[j] += e; const r2 = resid(uu); J[0].push((r2[0] - r[0]) / e); J[1].push((r2[1] - r[1]) / e); }
        const A2 = new Array(n).fill(0).map(() => new Array(n).fill(0)), b2 = new Array(n).fill(0);
        for (let a = 0; a < n; a++) { for (let b = 0; b < n; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? 1e-9 : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
        const d = solveLin(A2, b2); if (!d) break;
        idx.forEach((j, t) => { u[j] += d[t]; });
      }
    }
    // Straight crossings are allowed where a curve can route around them (not both sides I).
    function walkValid(c, A, L) {
      if (!(c.relGapMin <= 1e-6 && c.relArea > 0.02 && c.relSep > MIN_VERTEX_SEP && !c.touch)) return false;
      if (!c.selfX) return true;
      const es = opts.edgeSym; if (!es) return false;
      const v = verticesOf(A, L, m), o = (a, b, q) => Math.sign((b[0]-a[0])*(q[1]-a[1]) - (b[1]-a[1])*(q[0]-a[0]));
      for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue;
        const p1 = v[i], p2 = v[(i+1)%m], p3 = v[j], p4 = v[(j+1)%m];
        const d1 = o(p3,p4,p1), d2 = o(p3,p4,p2), d3 = o(p1,p2,p3), d4 = o(p1,p2,p4);
        if (d1 !== d2 && d3 !== d4 && d1 && d2 && d3 && d4 && es[i] === 2 && es[j] === 2) return false;
      }
      return true;
    }
    // A found tile is a sound witness => 'possible'.  Failure here is only a failed
    // numerical search (28 restarts), NOT a proof => 'unknown', never 'impossible'.
    out.status = out.ok ? 'possible' : 'unknown';
    if (!out.ok) out.reason = (out.relGap >= 0.008 ? 'no closure found'
                            : out.relSep <= MIN_VERTEX_SEP ? 'only coincident-vertex tiles found'
                            : out.touch ? `v${out.touch.vertex} lands on ${out.touch.kind === 'I' ? 'straight (I)' : 'the centre of S'} edge ${out.touch.edge} — boundary not simple`
                            : out.selfX ? 'closing m-gon self-intersects (not a simple polygon)'
                            : out.clampFake ? `only clamp-floor solutions found (gap ${out.relGapMin.toExponential(1)}x the shortest edge) — the tile wants edges shorter than 0.05, i.e. it does not close`
                            : out.roundFake ? `only round-off solutions found (gap stays ${out.relGapMin.toExponential(1)}x the shortest edge at high precision, edge ratio ${out.ratio.toFixed(1)}) — it does not close`
                            : 'only degenerate found')
                            + ' — not proven impossible';
    if (!seedU && !accOverride) _solveCache.set(key, out);   // don't cache seeded (per-config)
                                             // solves (so the seedScale below never reaches
                                             // the cache), nor precision-override probes
    // Restore the seed's overall scale: all lengths multiplied by the same factor, so the
    // shape found is unchanged and only the size is put back.  relGap/relArea/relSep are
    // ratios against max(L), hence invariant under this — no need to recompute them.
    return { ...out, A: out.A.slice(),
             L: seedScale === 1 ? out.L.slice() : out.L.map(x => x * seedScale) };
  }

  // ---- CLOSING-TILE FAMILY (true parameters) ----------------------------------------
  // The "free angles" from the linear reduction + the length-group scales are the RAW
  // unknowns u; the two closure equations (polygon must join up) then cut the true family
  // down to dimension nU - rank(closure Jacobian).  These helpers expose that manifold so
  // the UI can drive the tile along it (sliders that keep the tile closed).
  function familyFns(eqs, groups, m) {
    const { free, dep, flat } = angleStructure(eqs, m);
    const G = groups.length, nU = free.length + (G - 1);
    const anglesFromU = fv => { const A = new Array(m).fill(0); free.forEach((c, i) => A[c] = fv[i]);
      for (const c in dep) { let v = dep[c].rhs; for (const f in dep[c].co) v -= dep[c].co[f] * A[f]; A[+c] = v; } return A; };
    const expand = sc => { const L = new Array(m).fill(1); groups.forEach((g, gi) => g.forEach(i => L[i] = sc[gi])); return L; };
    const unpack = u => { const fv = free.map((_, i) => u[i]); const sc = [1];
      for (let i = 0; i < G - 1; i++) sc.push(Math.max(0.02, u[free.length + i])); return { A: anglesFromU(fv), L: expand(sc) }; };
    const resid = u => { const { A, L } = unpack(u); const v = verticesOf(A, L, m); return [v[m][0] - v[0][0], v[m][1] - v[0][1]]; };
    // label an unknown index: free-angle "A<i>" or group scale "L<edge> (/L<edge0>)"
    const label = k => k < free.length ? { kind: 'A', idx: free[k], txt: 'A' + free[k] }
      : (() => { const gi = k - free.length + 1; return { kind: 'L', idx: groups[gi][0], txt: 'L' + groups[gi][0] + '/L' + groups[0][0] }; })();
    // convert an (A,L) tile to a raw u (group 0 = overall scale, normalized away)
    const toU = (A, L) => { const u = free.map(c => A[c]); const s0 = L[groups[0][0]] || 1;
      for (let gi = 1; gi < G; gi++) u.push(L[groups[gi][0]] / s0); return u; };
    return { free, dep, flat, G, nU, unpack, resid, label, toU };
  }
  function jacobian(resid, u, nU) {                 // 2 x nU finite-difference Jacobian of the gap
    const r0 = resid(u), e = 1e-6, J = [[], []];
    for (let k = 0; k < nU; k++) { const uu = u.slice(); uu[k] += e; const r2 = resid(uu);
      J[0].push((r2[0] - r0[0]) / e); J[1].push((r2[1] - r0[1]) / e); }
    return J;
  }
  function jacRank(J, nU) {                          // rank (0/1/2) of the 2 x nU gap Jacobian
    let g00 = 0, g01 = 0, g11 = 0; for (let k = 0; k < nU; k++) { g00 += J[0][k] ** 2; g01 += J[0][k] * J[1][k]; g11 += J[1][k] ** 2; }
    const tr = g00 + g11, dt = g00 * g11 - g01 * g01, s = Math.sqrt(Math.max(0, tr * tr / 4 - dt));
    const l1 = tr / 2 + s, l2 = tr / 2 - s, sc = Math.max(l1, 1e-12);
    return (l1 > 1e-6 * sc ? 1 : 0) + (l2 > 1e-6 * sc ? 1 : 0);
  }

  // Pick which unknowns to DRIVE (sliders) vs SOLVE (auto-adjust to stay closed), evaluated
  // at a given closing tile u.  Prefers keeping length-ratios as drivers (angles get solved),
  // matching the intuition "pick edge ratios, let angles close".
  function pickDrivers(eqs, groups, m, u) {
    const F = familyFns(eqs, groups, m); const nU = F.nU;
    const J = jacobian(F.resid, u, nU), r = jacRank(J, nU);
    const isLen = k => k >= F.free.length;
    let dep = [];
    if (r === 2) { let best = null;
      for (let i = 0; i < nU; i++) for (let j = i + 1; j < nU; j++) {
        const det = J[0][i] * J[1][j] - J[0][j] * J[1][i]; if (Math.abs(det) < 1e-7) continue;
        const score = ((isLen(i) ? 1 : 0) + (isLen(j) ? 1 : 0)) * 1e6 - Math.abs(det);
        if (!best || score < best.score) best = { dep: [i, j], score }; }
      dep = best ? best.dep : []; }
    else if (r === 1) { let best = null;
      for (let i = 0; i < nU; i++) { const mag = Math.hypot(J[0][i], J[1][i]); if (mag < 1e-7) continue;
        const score = (isLen(i) ? 1 : 0) * 1e6 - mag; if (!best || score < best.score) best = { dep: [i], score }; }
      dep = best ? best.dep : []; }
    const drivers = []; for (let k = 0; k < nU; k++) if (!dep.includes(k)) drivers.push(k);
    return { rank: r, dim: nU - r, nU, drivers: drivers.map(k => ({ u: k, ...F.label(k) })), dependent: dep };
  }

  // Hold the driver unknowns fixed (they carry the slider values already baked into u0) and
  // Newton-solve the remaining unknowns to re-close the tile.  Returns the closed {A,L,u}.
  function closeConstrained(eqs, groups, m, u0, driverIdx) {
    const F = familyFns(eqs, groups, m); const nU = F.nU;
    const fixed = new Set(driverIdx); const varIdx = []; for (let k = 0; k < nU; k++) if (!fixed.has(k)) varIdx.push(k);
    let u = u0.slice();
    for (let it = 0; it < 200 && varIdx.length; it++) {
      const r = F.resid(u); if (Math.hypot(r[0], r[1]) < 1e-12) break;
      const nv = varIdx.length, e = 1e-6, J = [[], []];
      for (const k of varIdx) { const uu = u.slice(); uu[k] += e; const r2 = F.resid(uu); J[0].push((r2[0] - r[0]) / e); J[1].push((r2[1] - r[1]) / e); }
      const A2 = new Array(nv).fill(0).map(() => new Array(nv).fill(0)), b2 = new Array(nv).fill(0), lam = 1e-4;
      for (let a = 0; a < nv; a++) { for (let b = 0; b < nv; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? lam : 0);
        b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
      const d = solveLin(A2, b2); if (!d) break; varIdx.forEach((k, ii) => u[k] += d[ii]);
    }
    const { A, L } = F.unpack(u); const v = verticesOf(A, L, m);
    const gap = Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]) / Math.max(...L);
    return { ok: gap < 1e-4, u, A, L, gap };
  }

  // Sample the closing family (random restarts), report intrinsic dimension + per-quantity
  // free/locked ranges + hidden exact relations closure forces.  baseU = a representative
  // closer, drivers = the true-parameter set at baseU.
  function shapeFamily(eqs, groups, m, opts) {
    opts = opts || {};
    const F = familyFns(eqs, groups, m); const nU = F.nU;
    if (nU === 0) return { dim: 0, rank: 0, nU: 0, closers: 0, angleRanges: [], lengthRanges: [], relations: ['fully rigid — no free unknowns'], drivers: [], baseU: [] };
    const rng = mulberry32(4321), closers = [], nSamp = opts.samples || 500;
    // Closers: EXACT closures with real area. Corners of exactly 0 or 360 degrees and outlines that
    // cross themselves are allowed -- this measures the closing family, not whether a member is a
    // tile. Requiring every angle strictly inside (0.5, 359.5) and area > 0.02 left 60 of the 152
    // Checking-folder combos with "too few closing tiles found to analyze" and no sliders at all,
    // although each loaded shape closes exactly (John, 2026-09-14: "What I really want is the
    // parameters").
    // A flat collapse (every corner on one line -- John, 2026-09-14) is not a polygon. Area is the
    // wrong test for that: a figure-eight outline's lobes cancel to ~0 signed area yet it is real.
    const accept = u => { const { A, L } = F.unpack(u); const v = verticesOf(A, L, m);
      const gap = Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]) / Math.max(...L);
      if (gap < 1e-6 && !allColinear(v.slice(0, m)) && Math.min(...L) / Math.max(...L) > 1e-3) closers.push({ A, L: L.map(x => x / L[0]), u: u.slice() }); };
    // the shape being looked at, when it closes, is the first closer -- the sliders start there
    // ...polished onto exact closure first when it only nearly closes: a saved file rounded to a few
    // decimals closes to ~1e-5 (#209195 m8 si5: 7.3e-6), above the 1e-6 acceptance, and was skipped
    if (opts.seed && opts.seed.A && opts.seed.L) { try {
      const us = F.toU(opts.seed.A, opts.seed.L);
      for (let it = 0; it < 120; it++) { const r = F.resid(us); if (Math.hypot(r[0], r[1]) < 1e-11) break;
        const J = jacobian(F.resid, us, nU), A2 = new Array(nU).fill(0).map(() => new Array(nU).fill(0)), b2 = new Array(nU).fill(0);
        for (let a = 0; a < nU; a++) { for (let b = 0; b < nU; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? 1e-9 : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
        const d = solveLin(A2, b2); if (!d) break; for (let k = 0; k < nU; k++) us[k] += d[k]; }
      accept(us); } catch (e) {} }
    for (let restart = 0; restart < nSamp && closers.length < 300; restart++) {
      let u = [];
      // first half as before; if that finds too little, spread over every angle and a wide length range
      const wide = restart >= nSamp / 2 && closers.length < 3;
      for (let i = 0; i < F.free.length; i++) u.push(wide ? rng() * 360 : 20 + rng() * 150);
      for (let i = 0; i < F.G - 1; i++) u.push(wide ? Math.exp((rng() * 2 - 1) * 3) : 0.4 + rng() * 2.4);
      for (let it = 0; it < 120; it++) { const r = F.resid(u); if (Math.hypot(r[0], r[1]) < 1e-11) break;
        const J = jacobian(F.resid, u, nU), A2 = new Array(nU).fill(0).map(() => new Array(nU).fill(0)), b2 = new Array(nU).fill(0);
        for (let a = 0; a < nU; a++) { for (let b = 0; b < nU; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? 1e-3 : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
        const d = solveLin(A2, b2); if (!d) break; for (let k = 0; k < nU; k++) u[k] += d[k]; }
      accept(u);
    }
    if (closers.length < 3) return { dim: null, rank: null, nU, closers: closers.length, angleRanges: [], lengthRanges: [], relations: ['too few closing tiles found to analyze'], drivers: [], baseU: [] };
    const rank = Math.max(...closers.slice(0, 25).map(c => jacRank(jacobian(F.resid, c.u, nU), nU)));
    const span = arr => [Math.min(...arr), Math.max(...arr)];
    const angleRanges = []; for (let i = 0; i < m; i++) { const [lo, hi] = span(closers.map(c => c.A[i])); angleRanges.push({ i, lo, hi, locked: hi - lo < 0.5 }); }
    const lengthRanges = []; for (let i = 0; i < m; i++) { const [lo, hi] = span(closers.map(c => c.L[i])); lengthRanges.push({ i, lo, hi, free: hi - lo > 1e-3 }); }
    const relations = [];
    angleRanges.forEach(r => { if (r.locked) relations.push('A' + r.i + ' = ' + ((r.lo + r.hi) / 2).toFixed(1) + '°'); });
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      if (!angleRanges[i].locked && closers.every(c => Math.abs(c.A[i] - c.A[j]) < 0.5)) relations.push('A' + i + ' = A' + j);
      const s0 = closers[0].A[i] + closers[0].A[j];
      if (!angleRanges[i].locked && closers.some(c => Math.abs(c.A[i] - closers[0].A[i]) > 0.5) && closers.every(c => Math.abs(c.A[i] + c.A[j] - s0) < 0.5)) relations.push('A' + i + ' + A' + j + ' = ' + s0.toFixed(1) + '°');
    }
    // Take the drivers at a REGULAR member (full closure rank). The shape on screen can sit at a
    // special point of its family where the rank drops -- #3189 m6 si0's saved member has v2 = v3 =
    // 180, the mirror-symmetric point -- and drivers picked there count one parameter too many.
    const regular = closers.slice(0, 25).find(c => jacRank(jacobian(F.resid, c.u, nU), nU) === rank) || closers[0];
    const baseU = regular.u.slice();
    const drivers = pickDrivers(eqs, groups, m, baseU).drivers.map(d => {
      const rr = d.kind === 'A' ? angleRanges[d.idx] : lengthRanges[d.idx];
      return { ...d, lo: rr.lo, hi: rr.hi, val: baseU[d.u] };
    });
    return { dim: nU - rank, rank, nU, closers: closers.length, angleRanges, lengthRanges, relations, drivers, baseU };
  }

  // ---- saved shapes: SAVE ROUNDED, RECLOSE ON LOAD (John, 2026-09-14) -------------------------
  // "We've gotten bitten a few times from loading saved rounded off solutions that then isn't so
  // precise. Let's make it a general rule to save rounded, but when we load - do a reclose to full
  // precision, then double check that it rounds to very near the saved version."
  const SAVE_DIGITS = { A: 4, L: 6 };
  function roundShape(A, L) {
    const r = (x, d) => +(+x).toFixed(d);
    return { A: A.map(a => r(a, SAVE_DIGITS.A)), L: L.map(x => r(x, SAVE_DIGITS.L)) };   // TRUE angles, never mod 360
  }
  // Reclose a loaded shape to full precision -- Newton on every unknown, lightly damped so it moves
  // no further than the rounding needs -- then check it lands back on the saved numbers: every angle
  // within 0.01 deg and every length within 0.02% of the saved value. Further than that, the file is
  // NOT a rounded member of its family (#209195 m8 si5's old census shape: the nearest exact member
  // is 0.62 of a tile away): keep what was saved and say why.
  // ---- TRUE ANGLES (John, 2026-09-14: "Maybe we need to lose the mod-360 gate") --------------
  // The angle equations are REAL equations (constants 0, +-360, -720) and the solver's angles satisfy
  // them exactly, summing to 180(m-2). A mod-360 copy is the same polygon but no longer satisfies them,
  // and the chart then rebuilds the dependents from it a half-turn off (A1 = A7/2) -- a DIFFERENT
  // polygon (#209195 m8 si5 came back the other way round). liftAngles adds whole turns to the saved
  // values until the equations hold: -1/0/+1 turns on each FREE angle (the rest follow), keeping a
  // lift only if every angle matches its saved value mod 360, snapped to the saved digits + whole
  // turns. Of those, the one with fewest turns away from 0..360. Angles left outside 0..360 are the
  // "inside-out" corners (#3189 m6 si0: A0 = -78.88, not 281.12).
  function liftAngles(eqs, groups, m, A, L, opts) {
    const tol = (opts && opts.tol) || 0.05;
    const turnsOf = X => X.reduce((s, a) => s + Math.abs(Math.floor(a / 360)), 0);
    // A file already saved as TRUE angles satisfies the equations to its rounding (a wrong lift misses
    // by whole turns): keep it exactly. Re-deriving it from the mod-360 values could pick another lift
    // with the same count outside 0..360 -- this core's chart turned #209105 si0, #25593 si8 and 17
    // others 360-720 away while the other core kept them.
    const eqRes = Math.max(0, ...eqs.map(e => { let s = 0; for (let i = 0; i < m; i++) s += (e[i] || 0) * A[i]; return Math.abs(s - (e[m] || 0)); }));
    if (eqRes < ((opts && opts.eqTol) || 1)) return { ok: true, A: A.slice(), turns: turnsOf(A) };
    let F; try { F = familyFns(eqs, groups, m); } catch (e) { return { ok: false, A: A.slice() }; }
    const nf = F.free.length;
    const A360 = A.map(a => ((a % 360) + 360) % 360);
    const wrapD = x => ((x + 180) % 360 + 360) % 360 - 180;
    let best = null;
    const tryK = ks => {
      const Af = A360.slice(); F.free.forEach((c, i) => { Af[c] = A360[c] + 360 * ks[i]; });
      let U; try { U = F.unpack(F.toU(Af, L)).A; } catch (e) { return; }
      if (!U.every((a, i) => Math.abs(wrapD(a - A360[i])) < tol)) return;
      // saved number + whole turns: built from the ORIGINAL value so its digits survive (A360 carries
      // float noise -- 78.88 -> 78.88000000000002 -- which read as a 14-decimal number)
      const lifted = U.map((a, i) => A[i] + 360 * Math.round((a - A[i]) / 360));
      const turns = turnsOf(lifted), dist = lifted.reduce((s, a, i) => s + Math.abs(a - A[i]), 0);
      if (!best || turns < best.turns || (turns === best.turns && dist < best.dist - 1e-9)) best = { A: lifted, turns, dist };
    };
    const ks = new Array(nf).fill(0);
    if (nf <= 8) (function rec(i) { if (i === nf) { tryK(ks); return; } for (const v of [0, -1, 1]) { ks[i] = v; rec(i + 1); } })(0);
    else { tryK(ks); for (let i = 0; i < nf; i++) for (const v of [-1, 1]) { const k2 = ks.slice(); k2[i] = v; tryK(k2); } }
    return best ? { ok: true, A: best.A, turns: best.turns } : { ok: false, A: A.slice() };
  }
  function recloseSaved(eqs, groups, m, A, L, opts) {
    opts = opts || {};
    // "Rounds to very near the saved version": each number is judged at the precision it was SAVED
    // with -- within 1.5 units of its last saved digit (18.43 -> 0.015 deg, a 4-decimal length ->
    // 1.5e-4) -- with a small floor so full-precision files that closed only to solver tolerance pass.
    const decs = x => { const s = String(x); if (/e/i.test(s)) return 12; const k = s.indexOf('.'); return k < 0 ? 0 : Math.min(12, s.length - k - 1); };
    // 5 units, not 1.5: a DEPENDENT angle (e.g. 360 - A1 - A2 - A3) carries the rounding of several
    // saved numbers at once -- 2-decimal files legitimately move 0.016-0.033 deg on reclose
    const tolA = a => Math.max(5 * Math.pow(10, -decs(a)), opts.floorA == null ? 1e-4 : opts.floorA);
    const tolL = x => Math.max(5 * Math.pow(10, -decs(x)), (opts.floorL == null ? 1e-6 : opts.floorL) * Math.abs(x));
    const gapRel = (A2, L2) => { const v = verticesOf(A2, L2, m); return Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]) / L2.reduce((s, x) => s + x, 0); };
    // true angles first: a mod-360 file is lifted by whole turns until the equations hold; a file
    // already stored as true angles lifts with zero turns
    const Ain = A.slice();                                // precision is judged on the numbers AS SAVED
    const lf = liftAngles(eqs, groups, m, A, L);
    if (lf.ok) A = lf.A;
    const out = { A: A.slice(), L: L.slice(), ok: false, gapBefore: gapRel(A, L), gapAfter: null, dA: 0, dL: 0, lifted: lf.ok, turns: lf.turns };
    // already exact: use it as saved. (Going through the unknowns and back is not always the identity
    // -- the angle equations are mod 360 and can hand back an angle 180 off, the same shape trap as
    // reference_angle_eqs_mod360 -- so an exact file must never be "reclosed" into another member.)
    if (out.gapBefore < 1e-12) { out.ok = true; out.gapAfter = out.gapBefore; return out; }
    let F; try { F = familyFns(eqs, groups, m); } catch (e) { out.reason = 'no closing family'; return out; }
    const nU = F.nU, u = F.toU(A, L), U0 = F.unpack(u.slice());
    // Work in INCREMENTS from the saved shape: A(u) = A_saved + (unpack(u).A - unpack(u0).A). The
    // chart's own absolute angles can differ from the saved ones by a multiple of 360/k (the angle
    // equations are mod 360 and allow A1 = A7/2), so closing the chart's shape can close a DIFFERENT
    // member -- the 60-180 degree jumps on #209087 m7 si4, #209222 m8 si30 and others. Increments are
    // the same in every chart, and in both cores.
    const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
    // Lifted to true angles, the chart reproduces the saved shape (to its rounding) AND satisfies the
    // angle equations exactly -- so take its angles as they are. Saved value + increment kept the
    // saved rounding in the equations: every vertex off 360 by ~0.01-0.02 deg on 2-decimal files,
    // which rotated neighbouring copies in the translation-block drawing (#209105, #1727308).
    // Increments stay only for a file that could not be lifted. The chart's angles agree with the lift
    // only mod 360 (this core's chart put #209105 si0, #25593 si8 ... 720 away), so each keeps its
    // whole-turn offset from the saved angle -- whole turns leave the equations exact.
    const shapeAt = uu => { const U = F.unpack(uu); return { A: lf.ok ? U.A.map((a, i) => a + 360 * Math.round((A[i] - U0.A[i]) / 360)) : A.map((a, i) => a + wrap(U.A[i] - U0.A[i])), L: L.map((x, i) => x * U.L[i] / U0.L[i]) }; };
    const resid = uu => { const sh = shapeAt(uu), v = verticesOf(sh.A, sh.L, m); return [v[m][0] - v[0][0], v[m][1] - v[0][1]]; };
    // Weight each unknown by the precision it was SAVED at, so the correction lands where the
    // rounding was (smallest sum of (du_k / w_k)^2). Unweighted, the step dumped the whole fix on the
    // length ratios -- the cheapest unknowns in these units -- and moved 4-decimal lengths by 2e-4
    // to undo the rounding of 2-decimal angles. u = [free angles..., length ratios of groups 1..].
    const gl = L[groups[0][0]] || 1;
    const w = u.map((x, k) => k < F.free.length ? 1.5 * Math.pow(10, -decs(Ain[F.free[k]]))
                                                  : 1.5 * Math.pow(10, -decs(L[groups[k - F.free.length + 1][0]])) / Math.abs(gl));
    // relative weights only (largest = 1): with absolute ones a full-precision file (weights ~1e-13)
    // had its whole step swamped by the damping term and never moved
    const wMax = Math.max(...w, 1e-300); for (let k = 0; k < nU; k++) w[k] /= wMax;
    for (let it = 0; it < 200 && nU; it++) {
      const r = resid(u); if (Math.hypot(r[0], r[1]) < 1e-14) break;
      const J = jacobian(resid, u, nU);
      let d = null;
      for (const lam of [1e-12, 1e-9, 1e-6]) {           // more damping only where J is singular
        const A2 = new Array(nU).fill(0).map(() => new Array(nU).fill(0)), b2 = new Array(nU).fill(0);
        for (let a = 0; a < nU; a++) { for (let b = 0; b < nU; b++) A2[a][b] = (J[0][a] * J[0][b] + J[1][a] * J[1][b]) * w[a] * w[b] + (a === b ? lam : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]) * w[a]; }
        d = solveLin(A2, b2); if (d) break;
      }
      if (!d) break;
      for (let k = 0; k < nU; k++) u[k] += w[k] * d[k];
    }
    // near a singular point the weighted step can stall (~1e-7): finish unweighted
    for (let it = 0; it < 200 && nU && Math.hypot(...resid(u)) > 1e-14; it++) {
      const r = resid(u), J = jacobian(resid, u, nU);
      let d = null;
      for (const lam of [1e-12, 1e-9, 1e-6]) {
        const A2 = new Array(nU).fill(0).map(() => new Array(nU).fill(0)), b2 = new Array(nU).fill(0);
        for (let a = 0; a < nU; a++) { for (let b = 0; b < nU; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? lam : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
        d = solveLin(A2, b2); if (d) break;
      }
      if (!d) break;
      for (let k = 0; k < nU; k++) u[k] += d[k];
    }
    const U = F.unpack(u), g0 = groups[0][0], s = L[g0] / U.L[g0];            // back to the file's scale
    const SH = shapeAt(u), A1 = SH.A.slice(), L1 = SH.L;   // TRUE angles: the (lifted) saved shape + increments
    out.gapAfter = gapRel(A1, L1);
    const angD = A1.map((a, i) => Math.abs(wrap(a - A[i])));
    const lenD = L1.map((x, i) => Math.abs(x - L[i]));
    out.dA = Math.max(0, ...angD); out.dL = Math.max(0, ...L1.map((x, i) => Math.abs(x / L[i] - 1)));
    if (!(out.gapAfter < 1e-10)) { out.reason = `it does not reclose (gap ${out.gapAfter.toExponential(1)})`; return out; }
    const offA = angD.findIndex((d, i) => d > tolA(Ain[i])), offL = lenD.findIndex((d, i) => d > tolL(L[i]));
    if (offA >= 0 || offL >= 0) {
      out.reason = offA >= 0 ? `reclosing moves angle ${offA} by ${angD[offA].toFixed(4)} deg, more than its saved precision allows -- not a rounded member of its family`
                             : `reclosing moves length ${offL} by ${lenD[offL].toExponential(1)}, more than its saved precision allows -- not a rounded member of its family`;
      return out;
    }
    out.A = A1; out.L = L1; out.ok = true;
    return out;
  }
  // Close a shape IN ITS OWN LIFT with some unknowns held -- a slider drag. The chart's absolute
  // angles can be a different lift of the same mod-360 values (#209195 m8 si5: one angle 180 off),
  // and that lift is a DIFFERENT polygon that also closes -- the other way round. So the shape is
  // always A0 + (unpack(u).A - unpack(u0).A), lengths L0 * (unpack(u).L / unpack(u0).L): the one
  // being looked at. uHeld carries the held values; the other unknowns are solved.
  function closeHeld(eqs, groups, m, A0, L0, u0, uHeld, held) {
    const F = familyFns(eqs, groups, m), nU = F.nU, U0 = F.unpack(u0.slice());
    const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
    const shapeAt = uu => { const U = F.unpack(uu); return { A: A0.map((a, i) => a + wrap(U.A[i] - U0.A[i])), L: L0.map((x, i) => x * U.L[i] / U0.L[i]) }; };
    const resid = uu => { const sh = shapeAt(uu), v = verticesOf(sh.A, sh.L, m); return [v[m][0] - v[0][0], v[m][1] - v[0][1]]; };
    const u = uHeld.slice(), idx = [];
    for (let k = 0; k < nU; k++) if (!held.includes(k)) idx.push(k);
    const n = idx.length;
    for (let it = 0; it < 200 && n; it++) {
      const r = resid(u); if (Math.hypot(r[0], r[1]) < 1e-14) break;
      const Jf = jacobian(resid, u, nU), J = [idx.map(k => Jf[0][k]), idx.map(k => Jf[1][k])];
      let d = null;
      for (const lam of [1e-12, 1e-9, 1e-6]) {
        const A2 = new Array(n).fill(0).map(() => new Array(n).fill(0)), b2 = new Array(n).fill(0);
        for (let a = 0; a < n; a++) { for (let b = 0; b < n; b++) A2[a][b] = J[0][a] * J[0][b] + J[1][a] * J[1][b] + (a === b ? lam : 0);
          b2[a] = -(J[0][a] * r[0] + J[1][a] * r[1]); }
        d = solveLin(A2, b2); if (d) break;
      }
      if (!d) break;
      idx.forEach((k, t) => { u[k] += d[t]; });
    }
    const sh = shapeAt(u), v = verticesOf(sh.A, sh.L, m);
    const gap = Math.hypot(v[m][0] - v[0][0], v[m][1] - v[0][1]) / sh.L.reduce((s, x) => s + x, 0);
    return { A: sh.A.slice(), L: sh.L, u, gap, ok: gap < 1e-9 };   // TRUE angles
  }

  function solveLin(A, b) {                          // Gaussian elimination
    const n = b.length; const M = A.map((r, i) => r.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let mx = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[mx][c])) mx = r;
      if (Math.abs(M[mx][c]) < 1e-12) return null;
      [M[c], M[mx]] = [M[mx], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---- develop the tiling by gluing copies of the tile.  Each orbit's tile is the
  // CORNER polygon (m-gon vertices at the net-edge starts beginAt[j]).  Glue net-edge
  // g of a placed tile to net-edge row2[g] of the neighbour; row3[g] in {1,3} => mirror.
  const ap = (T, p) => [T[0] * p[0] + T[1] * p[1] + T[4], T[2] * p[0] + T[3] * p[1] + T[5]];
  // compose affine 2x3 transforms (A after B)
  const mulT = (A, B) => [A[0]*B[0]+A[1]*B[2], A[0]*B[1]+A[1]*B[3], A[2]*B[0]+A[3]*B[2], A[2]*B[1]+A[3]*B[3], A[0]*B[4]+A[1]*B[5]+A[4], A[2]*B[4]+A[3]*B[5]+A[5]];
  const cmul = (a, b) => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]];
  const csub = (a, b) => [a[0]-b[0], a[1]-b[1]];
  const cdiv = (a, b) => { const d = b[0]*b[0]+b[1]*b[1]; return [(a[0]*b[0]+a[1]*b[1])/d, (a[1]*b[0]-a[0]*b[1])/d]; };
  // isometry mapping F0->T0, F1->T1 (orientation preserving / reversing)
  function directIso(F0,F1,T0,T1){ const s=cdiv(csub(T1,T0),csub(F1,F0)); const o=csub(T0,cmul(s,F0)); return [s[0],-s[1],s[1],s[0],o[0],o[1]]; }
  function reflIso(F0,F1,T0,T1){ const s=cdiv(csub(T1,T0),[F1[0]-F0[0],-(F1[1]-F0[1])]); const o=[T0[0]-(s[0]*F0[0]+s[1]*F0[1]),T0[1]-(s[1]*F0[0]-s[0]*F0[1])]; return [s[0],s[1],s[1],-s[0],o[0],o[1]]; }
  const cent = pl => { let x=0,y=0; for(const p of pl){x+=p[0];y+=p[1];} return [x/pl.length,y/pl.length]; };

  const _mod = (x, m) => ((x % m) + m) % m;

  // Per-SIDE adjacency tables, replicating the engine's `tileEdges` adj-sym loops
  // (aniso.js `specify`): a net edge of |size|>1 spans several m-gon SIDES, so it must
  // be glued side-by-side, not as one chord (the old code's chord across beginAt+|size|
  // is a DIAGONAL for reversed multi-segment edges -> the partner length mismatches and
  // the glue becomes a scaling similarity).  Here, for each orbit role o, side i of the
  // tile glues to side tbl[o].to[i] of a neighbour (orbit tbl[o].nb[i]) with map
  // tbl[o].map[i].  The neighbour walk mirrors the engine: when map2 is 1 or 3 the
  // partner edge is traversed from its far end (begin2 += (size-1)*step2; step2 = -step2)
  // so sub-sides pair up correctly.
  function sideTables(k, n, beginAt, size, row2, row3, row6, m) {
    const mk = () => ({ to: new Array(m), map: new Array(m), nb: new Array(m) });
    const tbl = [mk(), mk()];
    const fill = (lo, hi, orb) => {
      for (let i = lo; i < hi; i++) {
        const edge2 = row2[i], map2 = row3[i];
        const newMap = row6[i] ^ row6[edge2] ^ map2;     // Klein-4 (XOR) orientation fold
        const sz = Math.abs(size[i]), nb = edge2 < k ? 0 : 1;
        let b1 = beginAt[i], b2 = beginAt[edge2];
        let s1 = 1 - 2 * row6[i], s2 = 1 - 2 * row6[edge2];
        if (sz > 1 && (map2 === 1 || map2 === 3)) { b2 = _mod(b2 + (sz - 1) * s2, m); s2 = -s2; }
        for (let q = 0; q < sz; q++) {
          tbl[orb].to[b1] = b2; tbl[orb].map[b1] = newMap; tbl[orb].nb[b1] = nb;
          b1 = _mod(b1 + s1, m); b2 = _mod(b2 + s2, m);
        }
      }
    };
    fill(0, k, 0); fill(k, k + n, 1);
    return tbl;
  }

  // Local gluing motion M for side i of a tile in orbit `o`, in the base (untransformed)
  // frame.  Develop by composing the current tile's transform with M — this propagates
  // orientation correctly (alternating CW/CCW tiles in glide groups).  newMap fixes the
  // glue (no guessing), uniformly for every side including self-glue (to===i, so F=T):
  //   newMap 0 = keep-end + direct  (identity-like; only self-glues, deduped away)
  //   newMap 1 = swap-end + reflect (mirror across the edge's perpendicular bisector)
  //   newMap 2 = keep-end + reflect (mirror across the edge line)
  //   newMap 3 = swap-end + direct  (rotation; self-glue => 180 about the midpoint)
  function sideMotion(verts, m, tbl, o, i) {
    const to = tbl[o].to[i], nm = tbl[o].map[i];
    const T0 = verts[i], T1 = verts[(i + 1) % m];        // this tile's side i (directed)
    const F0 = verts[to], F1 = verts[(to + 1) % m];      // neighbour's side `to` (directed)
    const swap = (nm === 1 || nm === 3);                 // swap which endpoint maps to which
    const reflect = (nm === 1 || nm === 2);              // orientation-reversing?
    const Ta = swap ? T1 : T0, Tb = swap ? T0 : T1;
    return reflect ? reflIso(F0, F1, Ta, Tb) : directIso(F0, F1, Ta, Tb);
  }

  function develop(verts, k, n, beginAt, size, row2, row3, row6, maxTiles) {
    const m = verts.length;
    const tbl = sideTables(k, n, beginAt, size, row2, row3, row6, m);
    const poly = verts.slice(0, m);                      // both orbits are this same m-gon
    const Mg = [0, 1].map(o => { const a = []; for (let i = 0; i < m; i++) a.push(sideMotion(verts, m, tbl, o, i)); return a; });
    const ID = [1,0,0,1,0,0];
    // "Have we already placed a tile here?" is decided by centroid proximity, and the
    // tolerance MUST be relative to the tile's own size, not an absolute constant. Reaching
    // the same cell by two different routes composes a different chain of `Mg` transforms,
    // and that float error accumulates over the walk -- measured at ~1.8e-5 on #25531 at 260
    // tiles, i.e. ~18x the old hard-coded 1e-6. So the same cell was placed TWICE (595
    // near-coincident pairs out of 260 placements there), and `overlapStrict` then correctly
    // reported those stacked duplicates as 100%-of-tile-area overlaps -- which is what had
    // #25531 stuck at L1 despite John reading the drawn tiling as good.
    // The safe window is wide: duplicates drift by ~1e-5 while genuinely distinct neighbours
    // sit ~0.23 tile-diameters apart (0.559 vs a 2.414 diameter on #25531). 1e-3 of the
    // diameter is ~130x above the observed drift and ~230x below the nearest distinct
    // centroid, so it cannot merge real neighbours.
    let diam = 0;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const dx = poly[i][0]-poly[j][0], dy = poly[i][1]-poly[j][1];
      const d2 = dx*dx + dy*dy; if (d2 > diam) diam = d2;
    }
    // 2026-09-09: raised 1e-3 -> 2e-2 after 80 of the 472 gallery combos placed stacked
    // duplicates at 120 tiles. The drift compounds along the BFS walk, so a longer walk drifts
    // further: #209087 si1 sat at 1.2e-3 of a diameter at 120 tiles, just past the old window,
    // and the curved overlap test then correctly reported the stacked pair as a 99.3% collision.
    // Re-measured across all 472 combos at 120 tiles: the worst surviving duplicate is 5.3e-3 of
    // a diameter and the closest LEGITIMATE neighbouring centroid is 7.8e-2 (#25523 si0). 2e-2 is
    // the geometric middle of that gap -- 3.7x above the worst drift, 3.9x below the nearest real
    // neighbour -- so it merges every duplicate without ever merging two distinct tiles.
    const dedupTol = 2e-2 * Math.sqrt(diam);
    const placed = [{ orbit: 0, T: ID }]; const seen = [cent(poly)]; const fr = [0];
    while (fr.length && placed.length < maxTiles) {
      const idx = fr.shift(); const { orbit, T } = placed[idx];
      for (let i = 0; i < m; i++) {                       // one neighbour per m-gon side
        const Tn = mulT(T, Mg[orbit][i]); const oh = tbl[orbit].nb[i];
        const npoly = poly.map(v => ap(Tn, v)); const c = cent(npoly);
        if (seen.some(s => Math.abs(s[0]-c[0]) < dedupTol && Math.abs(s[1]-c[1]) < dedupTol)) continue;
        seen.push(c); placed.push({ orbit: oh, T: Tn }); fr.push(placed.length - 1);
        if (placed.length >= maxTiles) break;
      }
    }
    return placed.map(t => ({ orbit: t.orbit, T: t.T, verts: poly.map(v => ap(t.T, v)) }));
  }

  // Per-tile neighbour lookup for an ALREADY-DEVELOPED patch: nbr[t][i] = index into `placed`
  // of the tile glued across side i of placed[t], or -1 if that neighbour fell outside the
  // patch (maxTiles cutoff). Doesn't touch `develop` or its many existing callers -- takes
  // its own output and the same raw net params, and just re-derives `tbl`/`Mg` (cheap) to
  // look up where each tile's own sides land. Used by the isohedral-block-criteria checker
  // (isohedral_criteria.js) to pick out a small connected block of tiles and know which of
  // their sides are shared (internal, discarded) vs. boundary (kept) when merging them into
  // one outer polygon.
  function developAdjacency(placed, verts, k, n, beginAt, size, row2, row3, row6) {
    const m = verts.length;
    const tbl = sideTables(k, n, beginAt, size, row2, row3, row6, m);
    const poly = verts.slice(0, m);
    const Mg = [0, 1].map(o => { const a = []; for (let i = 0; i < m; i++) a.push(sideMotion(verts, m, tbl, o, i)); return a; });
    const key = c => Math.round(c[0] * 1e6) + ',' + Math.round(c[1] * 1e6);
    const idxOf = new Map(placed.map((t, i) => [key(cent(poly.map(v => ap(t.T, v)))), i]));
    return placed.map(t => {
      const nb = new Array(m).fill(-1);
      for (let i = 0; i < m; i++) {
        const Tn = mulT(t.T, Mg[t.orbit][i]);
        const j = idxOf.get(key(cent(poly.map(v => ap(Tn, v)))));
        if (j !== undefined) nb[i] = j;
      }
      return nb;
    });
  }

  // ================= direct manipulation: drag a tile CORNER ==========================
  // The sliders drive the abstract unknowns u; this drives the picture instead -- grab a
  // corner of the m-gon, the closing family re-solves, the tile stays closed.  Same recipe
  // netshape.html's fundamental-domain editor uses (dsym_edit.js reachable/dragConstrained),
  // reworked for this file's (free angles, length-group ratios) parameterisation.

  // Basis of the null space of `rows` (each of length N).  Verbatim port of
  // dsym_edit.js:nullSpace -- if either copy is ever fixed, fix both.
  function nullSpace(rows, N) {
    const A = rows.map(r => Array.from(r)), piv = [];
    let rk = 0;
    for (let c = 0; c < N && rk < A.length; c++) {
      let b = -1, best = 1e-9;
      for (let r = rk; r < A.length; r++) if (Math.abs(A[r][c]) > best) { best = Math.abs(A[r][c]); b = r; }
      if (b < 0) continue;
      const t = A[rk]; A[rk] = A[b]; A[b] = t;
      const d = A[rk][c];
      for (let k = 0; k < N; k++) A[rk][k] /= d;
      for (let r = 0; r < A.length; r++) {
        if (r === rk) continue;
        const f = A[r][c]; if (!f) continue;
        for (let k = 0; k < N; k++) A[r][k] -= f * A[rk][k];
      }
      piv.push(c); rk++;
    }
    const out = [];
    for (let c = 0; c < N; c++) {
      if (piv.indexOf(c) >= 0) continue;
      const v = new Float64Array(N); v[c] = 1;
      for (let r = 0; r < piv.length; r++) v[piv[r]] = -A[r][c];
      out.push(v);
    }
    return out;
  }

  // Best similarity (translation + rotation + uniform scale) carrying src onto dst, in the
  // least-squares sense.  The complex-multiplier identity z = sum(conj(p)*q)/sum|p|^2 on
  // centred coordinates IS the 2-D similarity Procrustes solution.
  function simFit(src, dst) {
    const n = Math.min(src.length, dst.length);
    let cx = 0, cy = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { cx += src[i][0]; cy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
    cx /= n; cy /= n; dx /= n; dy /= n;
    let zr = 0, zi = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const ax = src[i][0] - cx, ay = src[i][1] - cy, bx = dst[i][0] - dx, by = dst[i][1] - dy;
      zr += ax * bx + ay * by; zi += ax * by - ay * bx; den += ax * ax + ay * ay;
    }
    if (!(den > 1e-15)) return { z: [1, 0], c: [cx, cy], d: [dx, dy] };
    return { z: [zr / den, zi / den], c: [cx, cy], d: [dx, dy] };
  }
  // Same fit with the scale factor normalised away: rotation + translation only.
  //
  // This, NOT simFit, is the gauge the corner drag works in, and the difference is not cosmetic.
  // A drag holds the view fixed, so a tile that grows is plainly visible and must be paid for by
  // the "keep the rest of the drawing still" term.  Fitting out the scale as well hid exactly
  // that: an unreachable pointer target made the solver stretch the tile without bound while the
  // fit quietly shrank it back, so nothing ever objected.  Measured in the browser on #38 m8 --
  // one 90px drag took the edge lengths from 1,1,1,1 to 1,2278,11115,2278.
  function rigidFit(src, dst) {
    const T = simFit(src, dst), n = Math.hypot(T.z[0], T.z[1]);
    return n > 1e-15 ? { z: [T.z[0] / n, T.z[1] / n], c: T.c, d: T.d } : T;
  }
  const applySim = (T, p) => { const ax = p[0] - T.c[0], ay = p[1] - T.c[1];
    return [T.z[0] * ax - T.z[1] * ay + T.d[0], T.z[1] * ax + T.z[0] * ay + T.d[1]]; };
  // A similarity inverts in closed form -- no numerics needed.
  const invSim = T => { const n = T.z[0] * T.z[0] + T.z[1] * T.z[1];
    if (!(n > 1e-30)) return { z: [1, 0], c: T.d.slice(), d: T.c.slice() };
    return { z: [T.z[0] / n, -T.z[1] / n], c: T.d.slice(), d: T.c.slice() }; };

  // Remove the infinitesimal RIGID component (translation + rotation) from a per-vertex velocity
  // field.  verticesOf pins v0 at the origin and edge 0 along +x, a gauge that has nothing to do
  // with what the tile looks like: left in, it makes a drag swing the whole polygon about v0, and
  // makes v0 itself undraggable and v1 able to slide only along x -- artefacts of the
  // parameterisation, not of the tiling.
  // Uniform scale is deliberately NOT removed; see rigidFit for what that cost.
  // Centre the base points first: that makes the three gauge fields mutually orthogonal, so the
  // projection is three independent dot products rather than a 3x3 solve.
  function degauge(f, pts, m) {
    let cx = 0, cy = 0; for (let i = 0; i < m; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= m; cy /= m;
    let q2 = 0; for (let i = 0; i < m; i++) { const ax = pts[i][0] - cx, ay = pts[i][1] - cy; q2 += ax * ax + ay * ay; }
    let t0 = 0, t1 = 0, rot = 0;
    for (let i = 0; i < m; i++) {
      const ax = pts[i][0] - cx, ay = pts[i][1] - cy;
      t0 += f[i][0]; t1 += f[i][1];
      rot += -ay * f[i][0] + ax * f[i][1];
    }
    t0 /= m; t1 /= m;
    rot = q2 > 1e-15 ? rot / q2 : 0;
    const out = [];
    for (let i = 0; i < m; i++) {
      const ax = pts[i][0] - cx, ay = pts[i][1] - cy;
      out.push([f[i][0] - (t0 - rot * ay), f[i][1] - (t1 + rot * ax)]);
    }
    return out;
  }

  // How each closure-preserving direction in u moves every corner of the m-gon.
  // ranks[i].rank is 2 (corner free in the plane), 1 (confined to the single line
  // ranks[i].dirs[0]) or 0 (frozen) -- the same question dsym_edit.js:reachable answers, and
  // for the same reason: asking a rank-1 corner to chase a 2-D pointer is what produces jitter.
  function vertexFields(eqs, groups, m, u) {
    const F = familyFns(eqs, groups, m), nU = F.nU;
    const at = uu => { const r = F.unpack(uu); return verticesOf(r.A, r.L, m).slice(0, m); };
    const verts = at(u);
    const none = { F, nU, verts, basis: [], fields: [], ranks: [] };
    for (let i = 0; i < m; i++) none.ranks.push({ rank: 0, dirs: [] });
    if (!nU) return none;
    const J = jacobian(F.resid, u, nU);
    // The closure Jacobian can be numerically ZERO: some tiles close for EVERY value of their
    // unknowns, so closure constrains nothing.  #48 m8 is one -- a square walked with flat
    // vertices, whose four-fold repetition closes automatically -- and its Jacobian row holds
    // nothing but finite-difference noise around 1e-9.  nullSpace's pivot threshold is an
    // absolute 1e-9, so that noise decided rigidity by coin flip: the tile read as
    // 1-parameter at one point and rigid two steps later, and the drag died on its second
    // frame.  Drop rows that are zero at the scale of the drawing, and normalise the ones that
    // survive so the pivot test is relative.
    let posScale = 0;
    for (let i = 0; i < m; i++) posScale = Math.max(posScale, Math.hypot(verts[i][0], verts[i][1]));
    const jFloor = 1e-7 * Math.max(1, posScale), rows = [];
    for (const row of J) {
      let mx = 0; for (let k = 0; k < nU; k++) mx = Math.max(mx, Math.abs(row[k]));
      if (mx < jFloor) continue;                      // this closure component is not a constraint here
      rows.push(row.map(x => x / mx));
    }
    const basis = nullSpace(rows, nU);
    if (!basis.length) return none;
    const eps = 1e-6;
    const rawF = basis.map(b => {
      const uu = u.slice(); for (let k = 0; k < nU; k++) uu[k] += eps * b[k];
      const v2 = at(uu), f = [];
      for (let i = 0; i < m; i++) f.push([(v2[i][0] - verts[i][0]) / eps, (v2[i][1] - verts[i][1]) / eps]);
      return degauge(f, verts, m);
    });
    // Re-express the null space in a basis that is ORTHONORMAL in drawing motion, dropping any
    // combination that moves the picture not at all.  Two reasons, both load-bearing:
    //   * a null direction that is pure gauge degauges to the zero field, so it is not a shape
    //     parameter -- left in, it makes the least-squares Gram matrix singular and the ridge
    //     term then returns noise for its coefficient;
    //   * with the basis orthonormal, the "keep the rest of the drawing still" penalty is
    //     well conditioned, so repeated drags cannot wander off along a barely-visible
    //     direction.  Measured on #973 (m9, raw dim 4): 10 absolute-target round trips left the
    //     shape 0.17 (relative) away from where it started before this, 3e-4 after.
    // The reported dimension is therefore the VISIBLE shape freedom, which is what the UI wants.
    const dot = (a, b) => { let s = 0; for (let i = 0; i < m; i++) s += a[i][0] * b[i][0] + a[i][1] * b[i][1]; return s; };
    let fmax = 0; for (const f of rawF) fmax = Math.max(fmax, Math.sqrt(dot(f, f)));
    const fields = [], obasis = [], keepTol = Math.max(1e-12, 1e-7 * fmax);
    for (let a = 0; a < rawF.length; a++) {
      let f = rawF[a].map(p => p.slice()), c = Array.from(basis[a]);
      for (let b = 0; b < fields.length; b++) {
        const p = dot(f, fields[b]);
        for (let i = 0; i < m; i++) { f[i][0] -= p * fields[b][i][0]; f[i][1] -= p * fields[b][i][1]; }
        for (let k = 0; k < nU; k++) c[k] -= p * obasis[b][k];
      }
      const nrm = Math.sqrt(dot(f, f));
      if (!(nrm > keepTol)) continue;
      for (let i = 0; i < m; i++) { f[i][0] /= nrm; f[i][1] /= nrm; }
      for (let k = 0; k < nU; k++) c[k] /= nrm;
      fields.push(f); obasis.push(c);
    }
    if (!fields.length) return none;
    // The rank tolerance must be RELATIVE: the fields carry mixed units (position per degree
    // and position per length ratio), so a fixed epsilon would call a real direction frozen on
    // one tile and call noise significant on another.
    let fscale = 0;
    for (const f of fields) for (let i = 0; i < m; i++) fscale = Math.max(fscale, Math.hypot(f[i][0], f[i][1]));
    const tol = Math.max(1e-12, 1e-6 * fscale);
    // "Not exactly zero" is not the same as "you can drag it there", and the honest measure of
    // the difference is CHEAPNESS, not size.  The fields above are orthonormal in whole-drawing
    // motion, so a corner direction's singular value sigma is literally (this corner's motion) /
    // (the motion of the whole drawing); scaling by sqrt(m) turns that into a per-corner RMS and
    // makes it independent of how many sides the tile has.  sigma' = 0.1 therefore means "moving
    // this corner one unit that way drags the average corner ten units" -- the drag's own
    // penalty term will refuse to pay that, so the handle would be lying if it drew as free.
    //
    // Measured on #385 m8, where this bit: corners 2/3/5/6 come out at sigma' 0.39-0.53 and
    // really do move in two directions; corner 1 at 0.078 moved about a pixel for a 15px
    // sideways pull; corners 0 and 4 at 3.8e-4 and 1.8e-5 did not move at all. All three of the
    // latter had drawn as free discs.
    const SIG_MIN = 0.1 / Math.sqrt(m);
    const ranks = [];
    for (let i = 0; i < m; i++) {
      const cand = fields.map(f => [f[i][0], f[i][1]]);
      const dirs = [];
      // greedy: take the LARGEST remaining response each pass, so dirs[0] is the dominant
      // direction -- the line a rank-1 handle draws, and the one a rank-1 drag projects onto
      for (let pass = 0; pass < 2; pass++) {
        const resid = cand.map(cc => {
          let w = [cc[0], cc[1]];
          for (const d of dirs) { const p = w[0] * d[0] + w[1] * d[1]; w = [w[0] - p * d[0], w[1] - p * d[1]]; }
          return w;
        });
        let best = -1, bestL = 0;
        resid.forEach((w, a) => { const L = Math.hypot(w[0], w[1]); if (L > bestL) { bestL = L; best = a; } });
        if (best < 0 || !(bestL > tol) || !(bestL > SIG_MIN)) break;
        dirs.push([resid[best][0] / bestL, resid[best][1] / bestL]);
      }
      ranks.push({ rank: dirs.length, dirs });
    }
    return { F, nU, verts, basis: obasis, fields, ranks };
  }

  // Move corner `j` by `delta` (in verticesOf coordinates) while keeping the tile closed.
  // Returns the new closing tile, plus how far the corner actually got -- measured UP TO a
  // similarity, since that is what the eye sees on a refitted picture.
  //
  // `opts.ref` is the whole gesture's reference corner list (typically the tile as it stood when
  // the pointer went down).  Given it, every other corner is asked to go BACK to its reference
  // position rather than merely to move as little as possible, which makes the gesture absolute
  // instead of path-dependent: differential IK integrated over a long drag otherwise ratchets,
  // and a pointer round trip does not come home.  Measured over 10 round trips on the dim>=2
  // types in _dev_isohedral/test_drag_vertex.js: 0.05-0.79 of a tile without a ref, ~1e-10 with.
  function dragVertex(eqs, groups, m, u0, j, delta, opts) {
    opts = opts || {};
    const steps = Math.max(1, opts.steps || 4), W = opts.weight || 1e6;
    const F0 = familyFns(eqs, groups, m);
    const r0 = F0.unpack(u0), v0 = verticesOf(r0.A, r0.L, m).slice(0, m);
    const ref = opts.ref && opts.ref.length === m ? opts.ref : v0;
    // where the pointer wants corner j, expressed in the reference frame
    const goal = (() => { const p = applySim(rigidFit(v0, ref), v0[j]); return [p[0] + delta[0], p[1] + delta[1]]; })();
    // Cap on how far one call may ask the corner to travel, as a fraction of the mean edge --
    // netshape caps the same way (dsym_edit.js maxFrac).  Without it, a pointer target the tile
    // cannot reach makes the W=1e6 term chase it at any cost to the rest of the shape, and a
    // long gesture walks the tile into a near-degenerate state (#385 m8: the corner had moved
    // 0.08 while the rest of the drawing had moved 0.92).
    let meanL = 0; for (const x of r0.L) meanL += x; meanL /= m;
    const maxStep = (opts.maxFrac == null ? 0.34 : opts.maxFrac) * meanL;
    // The teleport guard below is measured against the tile's overall SIZE, not its mean edge.
    // A spiky tile -- #385 m8 has edges of 1 and 0.09 next to angles of 11 and 349 degrees --
    // swings its far corners a long way for a small parameter change, so a mean-edge bound
    // rejected legitimate steps and the drag stopped dead a third of the way along with
    // "step would lurch" and no geometric wall in sight.
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const p of v0) { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
                          if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; }
    const diag = Math.max(Math.hypot(bx1 - bx0, by1 - by0), meanL);
    // Where the drag must stop.  These are the family's usable boundary, kept well clear of the
    // solver's own floors: unpack() clamps a length ratio at 0.02, and a tile parked exactly on
    // that clamp goes numerically rigid (the finite-difference response through the clamp is
    // zero), so the drag would stop responding for good instead of stopping at a wall.  An edge
    // ratio sitting at exactly the clamp is a solver artefact, never geometry.
    let aLo0 = Infinity, aHi0 = -Infinity;
    for (const a of r0.A) { if (a < aLo0) aLo0 = a; if (a > aHi0) aHi0 = a; }
    // The length test is ABSOLUTE, against the clamp -- not a min/max ratio.  u normalises the
    // first length group to 1, so "no group within 1.5x of the 0.02 clamp" is exactly the
    // artefact guard, whereas a min/max ratio floor also forbids honestly long-and-thin tiles
    // and stopped several types' drags almost immediately.
    const lMin0 = Math.min.apply(null, r0.L);
    // Whatever the starting tile already is, it stays legal -- some solved tiles arrive with a
    // dependent angle or a thin edge already past these bounds, and a hard test would then
    // reject every drag from the very first frame.
    const angLo = Math.min(2, aLo0), angHi = Math.max(358, aHi0), lenMin = Math.min(0.03, lMin0);
    let u = u0.slice(), best = null, rank0 = 0, reason = 'no free direction';
    for (let it = 0; it < steps; it++) {
      const vf = vertexFields(eqs, groups, m, u);
      const d = vf.basis.length, rk = vf.ranks[j].rank;
      if (it === 0) rank0 = rk;
      if (!d) { reason = 'rigid'; break; }
      if (!rk) { reason = 'corner frozen'; break; }
      const cur = best ? best.verts : v0;
      const T = rigidFit(cur, ref), now = cur.map(p => applySim(T, p));
      let req = [goal[0] - now[j][0], goal[1] - now[j][1]];
      // rank 1: only the reachable component exists -- project onto it rather than let the
      // solve hunt for a target that is not on the manifold.
      if (rk === 1) { const e = vf.ranks[j].dirs[0], p = req[0] * e[0] + req[1] * e[1]; req = [p * e[0], p * e[1]]; }
      req = [req[0] / (steps - it), req[1] / (steps - it)];
      const rl = Math.hypot(req[0], req[1]);
      if (rl > maxStep) { req = [req[0] * maxStep / rl, req[1] * maxStep / rl]; }
      // Normal equations over the null-space coefficients c:
      //   W |sum_a c_a f_a[j] - req|^2  +  sum_{i != j} |sum_a c_a f_a[i] - (ref_i - now_i)|^2
      // The second term is what keeps the rest of the drawing still.  dsym_edit.js weights the
      // same way and records why: weighting by PARAMETER change instead moved the grabbed point
      // 0.028 while swinging its neighbours 0.275.
      const A2 = [], b2 = [];
      for (let a = 0; a < d; a++) {
        const row = [];
        for (let b = 0; b < d; b++) {
          let s = W * (vf.fields[a][j][0] * vf.fields[b][j][0] + vf.fields[a][j][1] * vf.fields[b][j][1]);
          for (let i = 0; i < m; i++) if (i !== j) s += vf.fields[a][i][0] * vf.fields[b][i][0] + vf.fields[a][i][1] * vf.fields[b][i][1];
          row.push(s + (a === b ? 1e-9 : 0));
        }
        A2.push(row);
        let t = W * (vf.fields[a][j][0] * req[0] + vf.fields[a][j][1] * req[1]);
        for (let i = 0; i < m; i++) if (i !== j)
          t += vf.fields[a][i][0] * (ref[i][0] - now[i][0]) + vf.fields[a][i][1] * (ref[i][1] - now[i][1]);
        b2.push(t);
      }
      const c = solveLin(A2, b2);
      if (!c || c.some(x => !isFinite(x))) { reason = 'singular step'; break; }
      // Backtracking line search.  A full step can overshoot into a non-closing or degenerate
      // tile, or move the drawing far more than the pointer asked; halving until it behaves is
      // what turns "the drag just stops responding" into "the drag slows down near a wall".
      let accepted = null;
      for (let bt = 0, damp = 1; bt < 6 && !accepted; bt++, damp /= 2) {
        const un = u.slice();
        for (let a = 0; a < d; a++) for (let k = 0; k < vf.nU; k++) un[k] += damp * c[a] * vf.basis[a][k];
        for (let k = 0; k < vf.F.free.length; k++) un[k] = Math.min(359.5, Math.max(0.5, un[k]));
        for (let k = vf.F.free.length; k < vf.nU; k++) un[k] = Math.max(0.02, un[k]);
        const r = closeConstrained(eqs, groups, m, un, []);
        if (!r || !r.A) { reason = 'no re-close'; continue; }
        if (!(r.gap < 1e-4)) { reason = 'tile would not close'; continue; }
        if (!r.A.every(a => a >= angLo - 1e-9 && a <= angHi + 1e-9)) { reason = 'angle at its limit'; continue; }
        const vN = verticesOf(r.A, r.L, m).slice(0, m);
        const mx = Math.max.apply(null, r.L);
        if (!(Math.min.apply(null, r.L) >= lenMin - 1e-12)) { reason = 'edge at its limit'; continue; }
        if (!(areaOf(vN, m) / (mx * mx) > 1e-4)) { reason = 'tile would collapse'; continue; }
        // Teleport guard: no single step may throw a corner across the tile.  Bound it by the
        // tile's own size, NOT by a multiple of what was asked -- the constraints genuinely
        // couple corners, so a small move of the grabbed corner can legitimately force a much
        // larger one elsewhere, and bounding against the request froze 34 of 40 pointer moves
        // on #206 m8.
        const Tc = rigidFit(vN, cur);
        let mv = 0;
        for (let i = 0; i < m; i++) { const q = applySim(Tc, vN[i]); mv = Math.max(mv, Math.hypot(q[0] - cur[i][0], q[1] - cur[i][1])); }
        if (mv > 0.5 * diag) { reason = 'step would lurch'; continue; }
        accepted = { u: r.u.slice(), A: r.A, L: r.L, gap: r.gap, verts: vN };
      }
      if (!accepted) break;
      u = accepted.u; best = accepted;
    }
    if (!best) return { ok: false, rank: rank0, reason, u: u0.slice(), moved: [0, 0] };
    const got = applySim(rigidFit(best.verts, v0), best.verts[j]);
    return { ok: true, rank: rank0, u: best.u, A: best.A, L: best.L, gap: best.gap,
             verts: best.verts, moved: [got[0] - v0[j][0], got[1] - v0[j][1]] };
  }

  const api = { solveTile, develop, developAdjacency, sideTables, verticesOf, angleStructure, gapOf,
                expandLengths, applyT: ap, mulT, directIso, reflIso, centroid: cent,
                shapeFamily, pickDrivers, closeConstrained, familyFns, recloseSaved, roundShape, SAVE_DIGITS, closeHeld, liftAngles,
                nullSpace, simFit, rigidFit, applySim, invSim, vertexFields, dragVertex,
                // Exported 2026-09-06. The edge-type-aware self-touch rule (I edge anywhere in its
                // interior, S edge at its midpoint) lived only inside solveTile, so callers outside
                // reinvented it -- tiling_checks.js grew a pinch() that was edge-type blind and used
                // a relative floor 10x coarser than the measured 1.9e-3 legitimate minimum, and so
                // condemned tiles whose J/U edges can simply bow clear. John, 2026-09-06: "We only
                // reject self intersection when it is an I curve or the midpoint of an S curve."
                boundaryTouch,
                // Exported 2026-09-11 for tile_designer.js's diagnose(): a self-crossing straight
                // m-gon is "not a tile" regardless of edge type, no curve can fix a bowtie.
                polySelfIntersects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TilerCore = api;
})(typeof window !== 'undefined' ? window : this);
