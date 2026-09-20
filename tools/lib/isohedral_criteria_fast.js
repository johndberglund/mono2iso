// Vertex-only fast isohedral criteria checker — parallel to isohedral_criteria.js, which is
// NOT modified and stays the permanent oracle (validated 101/113 on isoTesting.txt) and, later,
// the augmentation-detector for combos that only become isohedral once a vertex is added.
//
// Three design rulings (John, 2026-07-27) drive every difference from the old file:
//
//  1. NO CUTS, EVER, for now. Search only the boundary's actual vertices -- never synthesize a
//     candidate corner inside an edge. Philosophical ("vertex to vertex"), not just a
//     performance choice. This makes #25460's criterion-9 match (which needs a 0.46 cut out of
//     an unrelated 1.2008 edge) come out anisohedral here -- a known, accepted regression; see
//     NOTES.md and isohedral_criteria.js lines ~190-195 for the case being given up.
//  2. A centro-symmetric side needs NO cut and NO geometry -- it's pure combinatorics on the
//     edge sequence: even run "abccba" under an edge-compat rule, odd run needs an S or I curve
//     in the middle with even flanks. See centro() below.
//  3. The corner search itself is no longer a blind O(n * C(n+4,5)) enumeration. Each criterion
//     is actually a small system of LINEAR EQUATIONS on the six corner offsets (trans/glide/rot
//     all reject unless the two matched sides have equal edge-count), so the free offsets can be
//     enumerated directly and everything else derived algebraically. See the GEN[1..9]
//     functions and the equation table in the design plan.
//
// Geometry that's still needed (trans/glide/rot's actual isometry fit + edge-compat gate) is
// REUSED VERBATIM from the old file, not reimplemented -- require()'d below.
(function (root) {
  'use strict';
  const OLD = (typeof module !== 'undefined' && module.exports)
    ? require('./isohedral_criteria.js') : root.IsohedralCriteria;
  const { blockBoundary, fitIsometry, edgeCompat, edgesCompat, sideByOffset, trans, glide, rot } = OLD;

  // ---------------- exact angle algebra (angle_algebra.js) ----------------
  // John, 2026-09-13: the angle equations themselves show when matching angles sum to 360 -- no
  // measuring needed. When checkBlock is given opts.sym, edgeData.sym = { sys, dir, rev } holds
  // each boundary edge's direction as a form in the corner angles, and every angle / direction
  // relation below is decided from the equations first. Only a relation that DEPENDS on the free
  // angles (true for some members of the family, not all) falls back to measuring the drawing.
  const AA = (typeof module !== 'undefined' && module.exports) ? require('./angle_algebra.js') : root.AngleAlgebra;
  const symOn = ed => !!(ed && ed.sym && AA);
  const symDir = (ed, id) => (ed.sym.rev ? AA.addK(ed.sym.sys, ed.sym.dir[id], 180) : ed.sym.dir[id]);
  // Interior angle at the vertex from boundary edge ea into edge eb, on the side vertexAngle()
  // measures: dir(eb) - (dir(ea) + 180).
  const symAngle = (ed, ea, eb) => AA.addK(ed.sym.sys, AA.sub(symDir(ed, eb), symDir(ed, ea)), -180);
  const symTest = (ed, form, deg) => AA.test(ed.sym.sys, form, deg);
  const decide = (verdict, numeric) => (verdict === 'proved' ? true : verdict === 'refuted' ? false : numeric());

  // Duplicated from isohedral_criteria.js (not exported there, and this file must not modify
  // that one) -- keep in sync if the tolerance ever changes.
  const ANG_EPS = 0.5; // degrees
  const angClose = (x, y, mod) => { let d = Math.abs(((x - y) % mod + mod) % mod); return Math.min(d, mod - d) < ANG_EPS; };

  // ---------------- combinatorial centro (ruling 2) ----------------
  // A span of k boundary edges is centrosymmetric about its own midpoint iff: even k, edge t
  // matches edge (k-1-t) for every t < k/2 ("abccba"); odd k, the middle edge is I or S
  // (self-symmetric about its own midpoint) and the flanks satisfy the even rule against each
  // other ("abcScba"). No geometry, no fitIsometry, no cut.
  //
  // IMPORTANT: this does NOT reuse the old file's edgeCompat() for the I-vs-I pair test.
  // edgeCompat() treats any two I edges as compatible REGARDLESS of whichEdge grouping --
  // documented (isohedral_criteria.js ~190-195) as safe ONLY because every caller that uses it
  // (trans/glide/rot) also runs a geometric fitIsometry afterward, which independently rejects
  // unequal lengths. centro() here has no such backstop, so reusing that bypass verbatim would
  // be a genuine soundness bug: two I edges of DIFFERENT actual length would combinatorially
  // "pass" as a centro pair. edgeCompatStrict requires same-whichEdge-group for I too, same as
  // every other edge type -- conservative (a coincidentally-equal-length pair from different
  // groups is missed, same flavor of accepted gap as ruling 1), never unsound.
  function edgeCompatStrict(edgeData, i, j, wantDirect) {
    const { whichEdge, edgeSym, mapping } = edgeData;
    if (whichEdge[i] !== whichEdge[j]) return false;
    if (edgeSym[i] !== edgeSym[j]) return false;
    if (edgeData.relaxMapping) return true;
    const v = mapping[i] ^ mapping[j];
    switch (edgeSym[i]) {
      case 2: return true;                                                    // I (same group => same length)
      case 0: return wantDirect ? v === 3 : v === 2;                          // J
      case 3: return wantDirect ? (v === 0 || v === 3) : (v === 1 || v === 2); // S
      case 1: return v === 2 || v === 3;                                      // U (kind-blind)
      default: return false;
    }
  }
  // Interior angle at pts[i], using its own immediate neighbours (SAME formula buildAngleCensus
  // uses on the full boundary -- pts[i]'s neighbours within a side are identical points to its
  // neighbours in the full polygon, since a side is just a contiguous slice of it).
  function vertexAngle(pts, i) {
    const p = pts[i - 1], c = pts[i], q = pts[i + 1];
    const v1x = p[0] - c[0], v1y = p[1] - c[1], v2x = q[0] - c[0], v2y = q[1] - c[1];
    const cr = v1x * v2y - v1y * v2x, dt = v1x * v2x + v1y * v2y;
    return ((Math.atan2(cr, dt) * 180 / Math.PI) % 360 + 360) % 360;
  }
  // John (2026-07-27): edge-type matching (abccba) is NECESSARY but not SUFFICIENT for centro-
  // symmetry -- it can be satisfied by accident whenever several edges share a whichEdge group
  // (caught empirically: #4's equilateral triangle "matched" criterion 9 by treating its WHOLE
  // boundary as one degenerate centro side, since all 3 edges are one group). The missing
  // condition, his own words: "the angles between matching edges must sum to 360 degrees...
  // one bulges out while the other must bulge in." For a k-edge span, pairing edges outside-in
  // (t vs k-1-t, same order as the edge-type pairing), the vertex JUST INSIDE edge t and the
  // vertex JUST INSIDE edge (k-1-t) must sum to 360. This is self-consistent at the middle:
  // when k is even the last iteration compares a vertex to ITSELF (t+1 == k-1-t), degenerating
  // to angle+angle=360 i.e. angle=180 exactly -- exactly the "c to c is 180" case he gave for
  // abccba, with no separate special-case needed. Verified against #4: the degenerate whole-
  // triangle span's two flanking angles are 60+60=120, not 360 -- correctly rejected.
  const angleSumOK = (a, b) => angClose(a + b, 360, 360);
  const segLen = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  // THIRD condition, and it is NOT redundant: paired edges must have the same LENGTH.
  // edgeCompatStrict leans on "same whichEdge group => same length", which holds on the raw
  // boundary but is FALSE after mergeCollinearRuns, because a merged run's length is the sum of
  // its parts while it keeps its first raw edge's index (hence its group). Caught on John's
  // known-anisohedral #69445 m=26 polyomino, where the merged boundary has group-0 edges of
  // length 1, 2 and 5: side (1,0)-(1,1)-(2,1)-(2,0)-(4,0)-(4,1) has edge lengths 1,1,1,2,1 and
  // angle pairs summing to 360, so type+angle alone wrongly passed it as centro -- the engine
  // then reported criterion 1 on a tile that is genuinely anisohedral. The old engine never had
  // this hole because its geometric fitIsometry rejects unequal lengths independently.
  // `edgeData.trustGroupLength` (set only on the RAW, unmerged pass -- see checkOneBoundary)
  // skips the measurement entirely: edgeCompatStrict already required the same whichEdge group,
  // which on raw boundary positions (never true after mergeCollinearRuns, see above) means the
  // family's own closing equations force exactly equal length. This is what let a lightly-
  // rounded witness (#209105, stored angles to 2 decimals, one edge measuring 0.999923 against
  // its exact-by-construction group-mate) pass a real criterion-2 match instead of failing on
  // 7.7e-5 of accumulated rounding the 1e-7 tolerance was never meant to police.
  const lenPairOK = (X, t, u, edgeData) =>
    (edgeData && edgeData.trustGroupLength && edgeData.whichEdge[X.edges[t]] === edgeData.whichEdge[X.edges[u]])
      || Math.abs(segLen(X.pts[t], X.pts[t + 1]) - segLen(X.pts[u], X.pts[u + 1])) < 1e-7;
  // X: {pts, edges} side object from sideByOffset (same shape trans/glide/rot consume).
  function centro(X, edgeData) {
    const k = X.edges.length;
    if (k === 0) return { collapsed: true };
    if (!edgeData) return null;   // no meaningful behavior without combinatorial data
    for (let t = 0; t < (k >> 1); t++) {
      if (!edgeCompatStrict(edgeData, X.edges[t], X.edges[k - 1 - t], true)) return null;
      if (!lenPairOK(X, t, k - 1 - t, edgeData)) return null;
      const angOK = () => angleSumOK(vertexAngle(X.pts, t + 1), vertexAngle(X.pts, k - 1 - t));
      if (!(symOn(edgeData)
        ? decide(symTest(edgeData, AA.add(symAngle(edgeData, X.edges[t], X.edges[t + 1]),
                                          symAngle(edgeData, X.edges[k - 2 - t], X.edges[k - 1 - t])), 0), angOK)
        : angOK())) return null;
    }
    if (k % 2 === 1) {
      const mid = X.edges[(k - 1) / 2];
      if (edgeData.edgeSym[mid] !== 2 && edgeData.edgeSym[mid] !== 3) return null;  // need I or S
    }
    return { combinatorial: true };
  }

  // ---------------- precomputed centro-span table ----------------
  // isCentroSpan(i, k): is the k-edge span starting at boundary position i (mod n) centro-
  // symmetric? Recursion peels one matched pair off each end (edge-type AND vertex-angle-sum,
  // same rule as centro() above); memoized so repeated queries (criteria 1/2/6/8/9 all probe
  // overlapping spans) cost O(1) after the first O(n^2) build. `poly`/`edges` are the walk's own
  // arrays (correct for either the forward or reversed pass -- see checkPolygon); vertex angles
  // are computed straight from `poly` so they are numerically identical to what centro() would
  // get from the corresponding X.pts slice.
  function buildCentroTable(poly, edges, edgeData, n) {
    const symE = symOn(edgeData);
    const posAng = j => { const jj = ((j % n) + n) % n; return symAngle(edgeData, edges[(jj - 1 + n) % n], edges[jj]); };
    const angPair = (u, v) => (symE
      ? decide(symTest(edgeData, AA.add(posAng(u), posAng(v)), 0), () => angleSumOK(angAt(u), angAt(v)))
      : angleSumOK(angAt(u), angAt(v)));
    const angleMemo = new Map();
    const angAt = j => {
      const jj = ((j % n) + n) % n;
      if (angleMemo.has(jj)) return angleMemo.get(jj);
      const a = vertexAngle([poly[(jj - 1 + n) % n], poly[jj], poly[(jj + 1) % n]], 1);
      angleMemo.set(jj, a);
      return a;
    };
    const memo = new Map();
    function isCentroSpan(i, k) {
      const key = ((i % n) + n) % n * (n + 1) + k;
      if (memo.has(key)) return memo.get(key);
      let ok;
      if (k === 0) ok = true;
      else if (k === 1) {
        const e0 = edges[((i % n) + n) % n];
        ok = edgeData.edgeSym[e0] === 2 || edgeData.edgeSym[e0] === 3;
      } else {
        const j0 = ((i % n) + n) % n, j1 = ((i + k - 1) % n + n) % n;
        const e0 = edges[j0], e1 = edges[j1];
        const lenOK = (edgeData.trustGroupLength && edgeData.whichEdge[e0] === edgeData.whichEdge[e1])
          || Math.abs(segLen(poly[j0], poly[(j0 + 1) % n]) - segLen(poly[j1], poly[(j1 + 1) % n])) < 1e-7;
        ok = edgeCompatStrict(edgeData, e0, e1, true)
          && lenOK                                     // see lenPairOK -- merged runs break same-group=>same-length
          && angPair(i + 1, i + k - 1)
          && isCentroSpan(i + 1, k - 2);
      }
      memo.set(key, ok);
      return ok;
    }
    return { isCentroSpan };
  }

  // ---------------- interior-angle census (rotation criteria 7/8/9 prefilter) ----------------
  // A rotation centre other than 180 degrees always sits on a real vertex carrying that exact
  // interior angle (isohedral_criteria.js ~363-369, "John's cheap filter") -- read it once
  // per boundary instead of discovering it lazily per candidate via a full geometric fit.
  function buildAngleCensus(poly, n) {
    const theta = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = poly[(i - 1 + n) % n], c = poly[i], q = poly[(i + 1) % n];
      const v1x = p[0] - c[0], v1y = p[1] - c[1], v2x = q[0] - c[0], v2y = q[1] - c[1];
      const cr = v1x * v2y - v1y * v2x, dt = v1x * v2x + v1y * v2y;
      theta[i] = ((Math.atan2(cr, dt) * 180 / Math.PI) % 360 + 360) % 360;
    }
    return theta;
  }
  // Accept either sign: the census is a PREFILTER only, and getting rot()'s sign convention
  // wrong would silently turn it into a false-negative filter rather than merely a slower one.
  // The real, authoritative check is always the actual rot() call downstream.
  // With symbolic data the prefilter is exact too, but it must stay conservative: reject only
  // when BOTH handednesses are refuted.
  const qualifies = (theta, i, deg) => {
    const num = () => angClose(theta[i], deg, 360) || angClose(theta[i], 360 - deg, 360);
    if (!theta.sym) return num();
    const r1 = symTest(theta.ed, theta.sym[i], deg), r2 = symTest(theta.ed, theta.sym[i], -deg);
    if (r1 === 'proved' || r2 === 'proved') return true;
    if (r1 === 'refuted' && r2 === 'refuted') return false;
    return num();
  };

  // ---------------- the nine criteria (copied structure, new centro) ----------------
  const empty = X => X.edges.length === 0;
  const CRITERIA = {
    1: (s, ed) => transM(s.a, s.d, ed) && centroM(s.b, ed) && centroM(s.c, ed) && centroM(s.e, ed) && centroM(s.f, ed),
    2: (s, ed) => transM(s.a, s.d, ed) && centroM(s.b, ed) && centroM(s.c, ed) && glideM(s.e, s.f, ed),
    3: (s, ed) => transM(s.a, s.d, ed) && glideM(s.b, s.c, ed) && glideM(s.e, s.f, ed),
    4: (s, ed) => transM(s.a, s.d, ed) && transM(s.b, s.e, ed) && transM(s.c, s.f, ed),
    5: (s, ed) => {
      const t = transM(s.a, s.d, ed); if (!t) return null;
      const g1 = glideM(s.b, s.f, ed); if (!g1) return null;
      const g2 = glideM(s.c, s.e, ed); if (!g2) return null;
      if (g1.axis != null && g2.axis != null && !axesRelated(g1, g2, 0, ed)) return null;
      return { t, g1, g2 };
    },
    6: (s, ed) => {
      const g1 = glideM(s.a, s.d, ed); if (!g1) return null;
      const g2 = glideM(s.b, s.f, ed); if (!g2) return null;
      if (!centroM(s.c, ed) || !centroM(s.e, ed)) return null;
      if (g1.axis != null && g2.axis != null && !axesRelated(g1, g2, 90, ed)) return null;
      return { g1, g2 };
    },
    7: (s, ed) => rotM(s.c, s.d, 120, ed) && rotM(s.e, s.f, 120, ed) && rotM(s.a, s.b, 120, ed),
    8: (s, ed) => empty(s.f) && rotM(s.c, s.d, 120, ed) && centroM(s.e, ed) && rotM(s.a, s.b, 60, ed),
    9: (s, ed) => empty(s.f) && rotM(s.b, s.c, 90, ed) && centroM(s.a, ed) && rotM(s.d, s.e, 90, ed),
  };
  const CRITERIA_MIRROR = {
    7: (s, ed) => rotM(s.c, s.d, -120, ed) && rotM(s.e, s.f, -120, ed) && rotM(s.a, s.b, -120, ed),
    8: (s, ed) => empty(s.f) && rotM(s.c, s.d, -120, ed) && centroM(s.e, ed) && rotM(s.a, s.b, -60, ed),
    9: (s, ed) => empty(s.f) && rotM(s.b, s.c, -90, ed) && centroM(s.a, ed) && rotM(s.d, s.e, -90, ed),
  };

  // ---------------- side + simplification memoization ----------------
  // Measured (V8 profile, criterion 4 on a 3-tile #69445 block, boundary n=58): 39.2% of the time
  // was `simplifySide` and 25.7% was `sidesFor`, with real geometry (`fitIsometry`) at 1.6% and
  // the GC at 7.4%. The generators try tens of thousands of corner tuples but there are only
  // O(n^2) distinct (start,end) ranges -- ~3,364 at n=58 against ~290,000 sideByOffset calls, so
  // every side was being rebuilt ~86 times and re-simplified every time it was used.
  //
  // Both caches are per-boundary-walk (created in checkPolygonOneWay) and the cached objects are
  // read-only, so sharing them is safe. Because sides now have stable identity, the simplify
  // cache can key on the object itself.
  let _sideCache = null, _simpCache = null;
  // The key MUST include the anchor: sideByOffset walks from (A+o)%n, so the same (o0,o1) with a
  // different A is a different side.
  function getSide(poly, polyEdges, A, o0, o1) {
    const key = (A * 4096 + o0) * 4096 + o1;
    let s = _sideCache.get(key);
    if (s === undefined) { s = sideByOffset(poly, polyEdges, A, o0, o1); _sideCache.set(key, s); }
    return s;
  }
  // simplifySide (39.2% of the profile) is NOT exported, and it runs inside trans/glide/rot on
  // both arguments on every call. Rather than duplicate it plus trans/glide/rot plus their
  // unexported helpers (isTranslation, axisAngle) -- ~40 lines of divergence risk -- memoize the
  // PREDICATE RESULT itself, keyed on side object identity. The sides are memoized above so
  // identity is stable, and the predicates are pure, so this caches the simplification AND the
  // geometry with no reimplementation at all.
  //
  // The collapse is large because a predicate usually depends on far fewer offsets than the
  // generator loops over: criterion 4's trans(a,d) has a=(0,o1) and d=(o3,o3+o1) with o3 fixed at
  // n/2, so it is a function of o1 ALONE -- ~n distinct calls instead of one per (o1,o2) tuple.
  function memo2(fn) {
    return (X, Y, ed) => {
      let inner = _simpCache.get(X);
      if (inner === undefined) { inner = new Map(); _simpCache.set(X, inner); }
      let r = inner.get(Y);
      if (r === undefined) { r = fn(X, Y, ed); inner.set(Y, r); }
      return r;
    };
  }
  // ---- exact trans / glide / rot ----
  // Two edge chains are congruent by a translation, glide or rotation exactly when their edges
  // pair up with equal lengths, compatible edge types, and directions related the same way all
  // along. So each relation is a list of direction identities decided by the angle equations.
  // Returns `undefined` when some identity depends on the free angles -- the caller then measures
  // with OLD's fitIsometry versions, exactly as before.
  function symSimplify(X, ed) {                 // merge I-I joints whose angle is (provably) 180
    const k = X.edges.length;
    if (k < 2) return { pts: X.pts, edges: X.edges, merged: X.edges.map(() => false) };
    const pts = [X.pts[0]], edges = [X.edges[0]], merged = [false];
    for (let i = 1; i < k; i++) {
      const a = edges[edges.length - 1], b = X.edges[i];
      const flat = ed.edgeSym[a] === 2 && ed.edgeSym[b] === 2 &&
        decide(symTest(ed, AA.sub(symDir(ed, b), symDir(ed, a)), 0), () => {
          const p = pts[pts.length - 1], q = X.pts[i], r = X.pts[i + 1];
          const L = Math.hypot(r[0] - p[0], r[1] - p[1]);
          return L > 1e-12 && Math.abs((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / L < 1e-9;
        });
      if (flat) { merged[merged.length - 1] = true; continue; }
      pts.push(X.pts[i]); edges.push(b); merged.push(false);
    }
    pts.push(X.pts[k]);
    return { pts, edges, merged };
  }
  function symLenEq(ed, Xs, i, Ys, j) {         // same group on the raw pass => same length exactly
    if (ed.trustGroupLength && !Xs.merged[i] && !Ys.merged[j] && ed.whichEdge[Xs.edges[i]] === ed.whichEdge[Ys.edges[j]]) return true;
    return Math.abs(segLen(Xs.pts[i], Xs.pts[i + 1]) - segLen(Ys.pts[j], Ys.pts[j + 1])) < 1e-7;
  }
  // pairs(t) -> [x, y, directDir, form, deg]: edge x of Xs against edge y of Ys, `form` == deg.
  function symRelation(X, Y, ed, direct, pairOf) {
    const Xs = symSimplify(X, ed), Ys = symSimplify(Y, ed), k = Xs.edges.length;
    if (k !== Ys.edges.length) return { no: true };
    if (k === 0) return { collapsed: true, Xs, Ys };
    let undecided = false;
    for (let t = 0; t < k; t++) {
      const [x, y, form, deg] = pairOf(Xs, Ys, t, k);
      if (!edgeCompat(ed, Xs.edges[x], Ys.edges[y], direct)) return { no: true };
      if (!symLenEq(ed, Xs, x, Ys, y)) return { no: true };
      if (!form) continue;
      const v = symTest(ed, form, deg);
      if (v === 'refuted') return { no: true };
      if (v === 'depends') undecided = true;
    }
    return undecided ? { undecided: true } : { yes: true, Xs, Ys };
  }
  // trans: reversed(X) is a translate of Y -- dir(X_{k-1-t}) + 180 == dir(Y_t)
  function symTrans(X, Y, ed) {
    const r = symRelation(X, Y, ed, true, (Xs, Ys, t, k) =>
      [k - 1 - t, t, AA.sub(AA.addK(ed.sym.sys, symDir(ed, Xs.edges[k - 1 - t]), 180), symDir(ed, Ys.edges[t])), 0]);
    if (r.undecided) return undefined;
    if (r.no) return null;
    return r.collapsed ? { collapsed: true } : { sym: true };
  }
  // glide: same order, and dir(X_t) + dir(Y_t) is one constant (twice the mirror axis)
  function symGlide(X, Y, ed) {
    let s0 = null;
    const r = symRelation(X, Y, ed, false, (Xs, Ys, t) => {
      const s = AA.add(symDir(ed, Xs.edges[t]), symDir(ed, Ys.edges[t]));
      if (t === 0) { s0 = s; return [0, 0, null, 0]; }
      return [t, t, AA.sub(s, s0), 0];
    });
    if (r.undecided) return undefined;
    if (r.no) return null;
    if (r.collapsed) return { collapsed: true, axis: null };
    const ang = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
    const sum = ang(r.Xs.pts[0], r.Xs.pts[1]) + ang(r.Ys.pts[0], r.Ys.pts[1]);
    return { sym: true, axisSum: s0, axis: ((sum / 2) % 180 + 180) % 180 };
  }
  // rot: reversed(X) turned by deg about the shared corner is Y -- dir(Y_t) - dir(X_{k-1-t}) == 180 + deg
  function symRot(X, Y, deg, ed) {
    const r = symRelation(X, Y, ed, true, (Xs, Ys, t, k) =>
      [k - 1 - t, t, AA.sub(symDir(ed, Ys.edges[t]), symDir(ed, Xs.edges[k - 1 - t])), 180 + deg]);
    if (r.undecided) return undefined;
    if (r.no) return null;
    return r.collapsed ? { collapsed: true } : { sym: true };
  }
  const withSym = (symFn, numFn) => (X, Y, ed) => {
    if (symOn(ed) && !ed.bothGlideOrientations) { const r = symFn(X, Y, ed); if (r !== undefined) return r; }
    return numFn(X, Y, ed);
  };
  function rotAny(X, Y, deg, ed) {
    if (symOn(ed)) { const r = symRot(X, Y, deg, ed); if (r !== undefined) return r; }
    return rot(X, Y, deg, ed);
  }
  // Church's rule (4): the two glide axes parallel (rel 0) or perpendicular (rel 90). An axis is
  // half the direction sum mod 180, so the axes differ by rel exactly when the sums differ by 2*rel.
  function axesRelated(g1, g2, rel, ed) {
    const num = () => (rel ? angClose(Math.abs(g1.axis - g2.axis), 90, 180) : angClose(g1.axis, g2.axis, 180));
    if (g1.axisSum && g2.axisSum && symOn(ed)) return decide(symTest(ed, AA.sub(g1.axisSum, g2.axisSum), 2 * rel), num);
    return num();
  }
  const transM = memo2(withSym(symTrans, trans));
  const glideM = memo2(withSym(symGlide, glide));
  // rot additionally varies with the angle, so key the inner map on (Y, deg).
  let _rotCache = new Map();
  function rotM(X, Y, deg, ed) {
    let inner = _rotCache.get(X);
    if (inner === undefined) { inner = new Map(); _rotCache.set(X, inner); }
    const k = deg;
    let byDeg = inner.get(Y);
    if (byDeg === undefined) { byDeg = new Map(); inner.set(Y, byDeg); }
    let r = byDeg.get(k);
    if (r === undefined) { r = rotAny(X, Y, deg, ed); byDeg.set(k, r); }
    return r;
  }
  // centro is ours and already cheap, but it is called on the same spans repeatedly too.
  let _centroCache = new Map();
  function centroM(X, ed) {
    let r = _centroCache.get(X);
    if (r === undefined) { r = centro(X, ed); _centroCache.set(X, r); }
    return r;
  }
  function sidesFor(poly, polyEdges, A, o) {
    const n = poly.length;
    return {
      a: getSide(poly, polyEdges, A, o[0], o[1]), b: getSide(poly, polyEdges, A, o[1], o[2]),
      c: getSide(poly, polyEdges, A, o[2], o[3]), d: getSide(poly, polyEdges, A, o[3], o[4]),
      e: getSide(poly, polyEdges, A, o[4], o[5]), f: getSide(poly, polyEdges, A, o[5], n),
    };
  }
  function tryCandidate(poly, polyEdges, edgeData, k, A, o) {
    const s = sidesFor(poly, polyEdges, A, o);
    let hit = CRITERIA[k](s, edgeData);
    if (!hit && CRITERIA_MIRROR[k]) hit = CRITERIA_MIRROR[k](s, edgeData);
    return hit ? { anchor: A, offsets: o.slice() } : null;
  }

  // ---------------- per-criterion offset generators ----------------
  // Each derives its free offsets from the criterion's own length equations (see the design
  // plan's equation table) instead of blindly enumerating all 6-tuples. All operate on the raw
  // (never-inflated) boundary -- n is always the real vertex count.

  function gen4(poly, polyEdges, edgeData) {                    // trans(a,d,b,e,c,f); o3=n/2
    const n = poly.length; if (n % 2 !== 0) return null;
    const o3 = n / 2;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= o3; o1++)
        for (let o2 = o1; o2 <= o3; o2++) {
          const o4 = o3 + o1, o5 = o3 + o2;
          // O(1) integer rejects before any geometry (see transOK / the run table)
          if (!transOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;
          if (!transOK(A + o1, o2 - o1, A + o4, edgeData, polyEdges)) continue;
          if (!transOK(A + o2, o3 - o2, A + o5, edgeData, polyEdges)) continue;
          const hit = tryCandidate(poly, polyEdges, edgeData, 4, A, [0, o1, o2, o3, o4, o5]);
          if (hit) return hit;
        }
    return null;
  }
  function gen5(poly, polyEdges, edgeData) {                    // trans(a,d), glide(b,f,c,e); o3=n/2
    const n = poly.length; if (n % 2 !== 0) return null;
    const o3 = n / 2;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= o3; o1++)
        for (let o2 = o1; o2 <= o3; o2++) {
          const o4 = o3 + o1, o5 = n + o1 - o2;
          if (!transOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;
          if (!glideOK(A + o1, o2 - o1, A + o5, edgeData, polyEdges)) continue;        // b~f
          if (!glideOK(A + o2, o3 - o2, A + o4, edgeData, polyEdges)) continue;        // c~e
          const hit = tryCandidate(poly, polyEdges, edgeData, 5, A, [0, o1, o2, o3, o4, o5]);
          if (hit) return hit;
        }
    return null;
  }
  function gen3(poly, polyEdges, edgeData) {                    // trans(a,d), glide(b,c), glide(e,f)
    const n = poly.length; if (n % 2 !== 0) return null;
    for (let A = 0; A < n; A++)
      for (let o2 = 0; o2 <= n / 2; o2++)
        for (let o1 = 0; o1 <= o2; o1++) {
          const o3 = 2 * o2 - o1, o4 = 2 * o2, o5 = o2 + n / 2;
          if (o3 > n || o4 > n || o5 > n) continue;
          if (!transOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;
          if (!glideOK(A + o1, o2 - o1, A + o2, edgeData, polyEdges)) continue;        // b~c
          if (!glideOK(A + o4, o5 - o4, A + o5, edgeData, polyEdges)) continue;        // e~f
          const hit = tryCandidate(poly, polyEdges, edgeData, 3, A, [0, o1, o2, o3, o4, o5]);
          if (hit) return hit;
        }
    return null;
  }
  function gen1(poly, polyEdges, edgeData, centroTable) {       // trans(a,d), centro(b,c,e,f)
    const n = poly.length;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++)
        for (let o2 = o1; o2 <= n; o2++) {
          if (o2 > o1 && !centroTable.isCentroSpan(A + o1, o2 - o1)) continue;         // b
          for (let o3 = o2; o3 <= n; o3++) {
            if (o3 > o2 && !centroTable.isCentroSpan(A + o2, o3 - o2)) continue;       // c
            const o4 = o3 + o1; if (o4 < o3 || o4 > n) continue;
            if (!transOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;
            for (let o5 = o4; o5 <= n; o5++) {
              if (o5 > o4 && !centroTable.isCentroSpan(A + o4, o5 - o4)) continue;     // e
              if (n > o5 && !centroTable.isCentroSpan(A + o5, n - o5)) continue;       // f
              const hit = tryCandidate(poly, polyEdges, edgeData, 1, A, [0, o1, o2, o3, o4, o5]);
              if (hit) return hit;
            }
          }
        }
    return null;
  }
  function gen2(poly, polyEdges, edgeData, centroTable) {       // trans(a,d), centro(b,c), glide(e,f)
    const n = poly.length;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++)
        for (let o2 = o1; o2 <= n; o2++) {
          if (o2 > o1 && !centroTable.isCentroSpan(A + o1, o2 - o1)) continue;         // b
          for (let o3 = o2; o3 <= n; o3++) {
            if (o3 > o2 && !centroTable.isCentroSpan(A + o2, o3 - o2)) continue;       // c
            const o4 = o3 + o1; if (o4 < o3 || o4 > n) continue;
            if (!transOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;
            if ((o4 + n) % 2 !== 0) continue;
            const o5 = (o4 + n) / 2; if (o5 < o4 || o5 > n) continue;
            if (!glideOK(A + o4, o5 - o4, A + o5, edgeData, polyEdges)) continue;      // e~f
            const hit = tryCandidate(poly, polyEdges, edgeData, 2, A, [0, o1, o2, o3, o4, o5]);
            if (hit) return hit;
          }
        }
    return null;
  }
  function gen6(poly, polyEdges, edgeData, centroTable) {       // glide(a,d,b,f), centro(c,e)
    const n = poly.length;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++)
        for (let o2 = o1; o2 <= n; o2++) {
          // o5 and the b~f glide depend only on (o1,o2), so hoist both out of the o3 loop
          // instead of recomputing them n times.
          const o5 = n - o2 + o1; if (o5 > n) continue;
          if (!glideOK(A + o1, o2 - o1, A + o5, edgeData, polyEdges)) continue;        // b~f
          for (let o3 = o2; o3 <= n; o3++) {
            if (o3 > o2 && !centroTable.isCentroSpan(A + o2, o3 - o2)) continue;       // c
            const o4 = o3 + o1; if (o4 < o3 || o4 > n) continue;
            if (o5 < o4) continue;
            if (!glideOK(A + 0, o1, A + o3, edgeData, polyEdges)) continue;            // a~d
            if (o5 > o4 && !centroTable.isCentroSpan(A + o4, o5 - o4)) continue;       // e
            const hit = tryCandidate(poly, polyEdges, edgeData, 6, A, [0, o1, o2, o3, o4, o5]);
            if (hit) return hit;
          }
        }
    return null;
  }
  // Criteria 7/8/9: each rotation pair collapses together (both sides empty at once) under a
  // single derivable condition, so the angle-census skip below is exact, not approximate --
  // verified by hand against each criterion's own offset formulas.
  function gen7(poly, polyEdges, edgeData, _ct, angleCensus) {  // rot(a,b,120) rot(c,d,120) rot(e,f,120)
    const n = poly.length; if (n % 2 !== 0) return null;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++) {
        const o2 = 2 * o1; if (o2 > n) continue;
        if (o1 > 0 && !qualifies(angleCensus, (A + o1) % n, 120)) continue;
        for (let o3 = o2; o3 <= n; o3++) {
          const o4 = 2 * o3 - o2; if (o4 < o3 || o4 > n) continue;
          if (o3 !== o2 && !qualifies(angleCensus, (A + o3) % n, 120)) continue;
          if ((o4 + n) % 2 !== 0) continue;
          const o5 = (o4 + n) / 2; if (o5 < o4 || o5 > n) continue;
          if (o5 !== o4 && o5 !== n && !qualifies(angleCensus, (A + o5) % n, 120)) continue;
          const hit = tryCandidate(poly, polyEdges, edgeData, 7, A, [0, o1, o2, o3, o4, o5]);
          if (hit) return hit;
        }
      }
    return null;
  }
  function gen8(poly, polyEdges, edgeData, ct, angleCensus) {   // empty(f) rot(a,b,60) rot(c,d,120) centro(e)
    const n = poly.length;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++) {
        const o2 = 2 * o1; if (o2 > n) continue;
        if (o1 > 0 && !qualifies(angleCensus, (A + o1) % n, 60)) continue;
        for (let o3 = o2; o3 <= n; o3++) {
          const o4 = 2 * o3 - o2; if (o4 < o3 || o4 > n) continue;
          if (o3 !== o2 && !qualifies(angleCensus, (A + o3) % n, 120)) continue;
          if (n > o4 && !ct.isCentroSpan(A + o4, n - o4)) continue;                    // e
          const hit = tryCandidate(poly, polyEdges, edgeData, 8, A, [0, o1, o2, o3, o4, n]);
          if (hit) return hit;
        }
      }
    return null;
  }
  function gen9(poly, polyEdges, edgeData, ct, angleCensus) {   // empty(f) centro(a) rot(b,c,90) rot(d,e,90)
    const n = poly.length;
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++) {
        if (o1 > 0 && !ct.isCentroSpan(A, o1)) continue;                              // a
        for (let o2 = o1; o2 <= n; o2++) {
          const o3 = 2 * o2 - o1; if (o3 < o2 || o3 > n) continue;
          if (o2 !== o1 && !qualifies(angleCensus, (A + o2) % n, 90)) continue;
          if ((o3 + n) % 2 !== 0) continue;
          const o4 = (o3 + n) / 2; if (o4 < o3 || o4 > n) continue;
          if (o3 !== n && !qualifies(angleCensus, (A + o4) % n, 90)) continue;
          const hit = tryCandidate(poly, polyEdges, edgeData, 9, A, [0, o1, o2, o3, o4, n]);
          if (hit) return hit;
        }
      }
    return null;
  }

  // ---------------- translation-run table (WS2: the maximal-run idea, as a cheap filter) -------
  // The generators' remaining cost is the sheer number of tuples: memoizing predicate RESULTS
  // capped out at ~20% because e.g. criterion 4's trans(b,e) depends on both o1 and o2, so it is
  // genuinely distinct per tuple. The fix is to reject tuples with an O(1) INTEGER test before
  // any geometry runs.
  //
  // Growth rule, empirically verified earlier (see the anchor-and-extend note): for
  // trans(X,Y) under the engine's reversed(X)->Y convention, with B the boundary position where
  // X ENDS and D where Y BEGINS, the match extends while
  //        edge(B-1-t)  is antiparallel and congruent to  edge(D+t)
  // Two other plausible pairings were tried and refuted against a real criterion-5 match.
  //
  // transRun(B,D) = how far that extends. A side of edge-count L can only satisfy trans if
  // transRun(B,D) >= L. That is a SOUND necessary condition (no false negatives), independent of
  // Church's maximality claim -- deliberately NOT using the stronger `=== L` here, which is what
  // maximality would license but which my probe only verified rigorously for centro/rot, not for
  // trans/glide. `>=` already rejects nearly everything, since most position pairs have run 0.
  let _dirs = null, _lens = null, _angs = null, _runCache = null, _runN = 0;
  let _symDir = null, _symAng = null, _symEd = null;    // exact counterparts, when the pass has sym data
  function buildRunTables(poly, polyEdges, edgeData, n) {
    _runN = n; _dirs = new Float64Array(n); _lens = new Float64Array(n); _angs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n];
      _dirs[i] = Math.atan2(q[1] - p[1], q[0] - p[0]);
      _lens[i] = Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    // interior angle at each boundary VERTEX (vertex i sits between edge i-1 and edge i)
    for (let i = 0; i < n; i++) _angs[i] = vertexAngle([poly[(i - 1 + n) % n], poly[i], poly[(i + 1) % n]], 1);
    _runCache = new Map(); _glideCache = new Map();
    _symEd = symOn(edgeData) ? edgeData : null;
    _symDir = _symAng = null;
    if (_symEd) {
      _symDir = new Array(n); _symAng = new Array(n);
      for (let i = 0; i < n; i++) _symDir[i] = symDir(edgeData, polyEdges[i]);
      for (let i = 0; i < n; i++) _symAng[i] = AA.addK(edgeData.sym.sys, AA.sub(_symDir[i], _symDir[(i - 1 + n) % n]), -180);
    }
  }
  // John's rule, applied at the junction between two consecutive matched edge pairs: the angles
  // at the two corresponding vertices must sum to 360 ("one bulges out while the other must
  // bulge in"). Needed to make the run tables give the TRUE maximal run -- without it the run is
  // OVERESTIMATED, which is harmless under a `>=` filter but would cause false negatives the
  // moment maximality (`=== L`) is switched on.
  const angPairOK = (u, v) => {
    const n = _runN, uu = ((u % n) + n) % n, vv = ((v % n) + n) % n;
    const num = () => angClose(_angs[uu] + _angs[vv], 360, 360);
    return _symAng ? decide(AA.test(_symEd.sym.sys, AA.add(_symAng[uu], _symAng[vv]), 0), num) : num();
  };
  const PI = Math.PI;
  function antiparallel(i, j) {
    const num = () => {
      let d = Math.abs(_dirs[i] - _dirs[j]) % (2 * PI);
      if (d > PI) d = 2 * PI - d;
      return Math.abs(d - PI) < 1e-6;
    };
    return _symDir ? decide(AA.test(_symEd.sym.sys, AA.sub(_symDir[i], _symDir[j]), 180), num) : num();
  }
  function transRun(B, D, edgeData, polyEdges) {
    const n = _runN;
    const key = ((B % n + n) % n) * 4096 + ((D % n + n) % n);
    let r = _runCache.get(key);
    if (r !== undefined) return r;
    let s = 0;
    while (s < n) {
      const i = (((B - 1 - s) % n) + n) % n, j = (((D + s) % n) + n) % n;
      // Same fix as lenPairOK/isCentroSpan: trust the whichEdge group on the raw pass instead of
      // measuring, so a lightly-rounded witness's few-1e-5 drift can't break a run early.
      const sameLen = Math.abs(_lens[i] - _lens[j]) <= 1e-7
        || (edgeData && edgeData.trustGroupLength && edgeData.whichEdge[polyEdges[i]] === edgeData.whichEdge[polyEdges[j]]);
      if (!sameLen) break;
      if (!antiparallel(i, j)) break;
      if (edgeData && !edgeCompat(edgeData, polyEdges[i], polyEdges[j], true)) break;
      // junction between the previous pair and this one (see angPairOK)
      if (s > 0 && !angPairOK(B - s, D + s)) break;
      s++;
    }
    _runCache.set(key, s);
    return s;
  }
  // trans(a,d)-style feasibility: side starting at absolute `start` with `len` edges, matched to
  // the side starting at absolute `dstart`. Returns false only when the match provably cannot hold.
  // MAXIMALITY is now ON (John, 2026-07-28, endorsing Church section 3.2 with his own argument:
  // "A side is the boundary between two adjacent tiles. If we have more edges that touch each
  // other, they have to be in the same side."). So a matched side must be EXACTLY the maximal
  // run, not merely fit inside it -- `=== len`, not `>= len`. This is only sound because the run
  // tables now include the junction angle-sum condition; without it the run is overestimated and
  // `===` would reject valid matches.
  // A collapsed (zero-edge) side is still always allowed -- Table 58 explicitly permits it, and
  // "maximal" says nothing about a side with no edges.
  function transOK(start, len, dstart, edgeData, polyEdges) {
    if (len === 0) return true;
    return transRun(start + len, dstart, edgeData, polyEdges) === len;
  }
  // Same idea for glide, which after the trans filter became the dominant remaining cost
  // (criterion 6 alone was 53% of a n=58 checkBlock). glide uses the SAME-ORDER convention --
  // isohedral.txt's "ab...cab...c", i.e. edge t of X pairs with edge t of Y, not reversed
  // (isohedral_criteria.js:331-335). A glide is an INDIRECT isometry, so paired edges are
  // congruent but NOT antiparallel and their axis is unknown up front; the sound, cheap
  // necessary conditions available without knowing the axis are equal length and
  // edgeCompat(..., wantDirect=false) -- exactly the gate `glide` itself applies via edgesCompat.
  // Conservative by construction: it can only reject pairs `glide` would also reject.
  let _glideCache = null;
  function glideRun(SX, SY, edgeData, polyEdges) {
    const n = _runN;
    const key = ((SX % n + n) % n) * 4096 + ((SY % n + n) % n);
    let r = _glideCache.get(key);
    if (r !== undefined) return r;
    // Length + edgeCompat ALONE is far too weak: on a polyomino every edge is I in one group, so
    // edgeCompat always passes and lengths usually match -- measured, that version was pure
    // overhead and made criterion 6 *slower* (97.8 -> 117.7 ms). What makes it selective is the
    // directional invariant: a glide reflection about an axis at angle theta maps a direction d
    // to 2*theta - d, so for EVERY paired edge dir(X+t) + dir(Y+t) is the same constant 2*theta.
    // Pin that constant from the first pair, then require it of the rest.
    let s = 0, sum0 = 0, symSum0 = null;
    while (s < n) {
      const i = (((SX + s) % n) + n) % n, j = (((SY + s) % n) + n) % n;
      const sameLen = Math.abs(_lens[i] - _lens[j]) <= 1e-7
        || (edgeData && edgeData.trustGroupLength && edgeData.whichEdge[polyEdges[i]] === edgeData.whichEdge[polyEdges[j]]);
      if (!sameLen) break;
      if (edgeData && !edgeCompat(edgeData, polyEdges[i], polyEdges[j], false)) break;
      const sum = _dirs[i] + _dirs[j];
      const symSum = _symDir ? AA.add(_symDir[i], _symDir[j]) : null;
      if (s === 0) { sum0 = sum; symSum0 = symSum; }
      else {
        const numDir = () => { let d = Math.abs(sum - sum0) % (2 * PI); if (d > PI) d = 2 * PI - d; return d <= 1e-6; };
        const dirOK = _symDir ? decide(AA.test(_symEd.sym.sys, AA.sub(symSum, symSum0), 0), numDir) : numDir();
        if (!dirOK) break;
        if (!angPairOK(SX + s, SY + s)) break;
      }
      s++;
    }
    _glideCache.set(key, s);
    return s;
  }
  function glideOK(sx, len, sy, edgeData, polyEdges) {
    if (len === 0) return true;                       // a collapsed glide pair is allowed
    return glideRun(sx, sy, edgeData, polyEdges) === len;
  }

  const GEN = { 1: gen1, 2: gen2, 3: gen3, 4: gen4, 5: gen5, 6: gen6, 7: gen7, 8: gen8, 9: gen9 };
  const NEEDS_CENTRO_TABLE = new Set([1, 2, 6, 8, 9]);
  const NEEDS_ANGLE_CENSUS = new Set([7, 8, 9]);

  // ---------------- top level: same shape as the old file's checkPolygon/checkBlock ----------
  function checkPolygonOneWay(poly, polyEdges, edgeData, only) {
    const n = poly.length;
    const want = (only || [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice();
    // Reset every memo: they are keyed on side-object identity / offsets that are only
    // meaningful within ONE boundary walk. Leaking them across boundaries would return another
    // polygon's answers.
    _sideCache = new Map(); _simpCache = new Map();
    _rotCache = new Map(); _centroCache = new Map();
    buildRunTables(poly, polyEdges, edgeData, n);
    const centroTable = want.some(k => NEEDS_CENTRO_TABLE.has(k)) ? buildCentroTable(poly, polyEdges, edgeData, n) : null;
    const angleCensus = want.some(k => NEEDS_ANGLE_CENSUS.has(k)) ? buildAngleCensus(poly, n) : null;
    if (angleCensus && _symAng) { angleCensus.sym = _symAng; angleCensus.ed = edgeData; }
    const matches = [], detail = {};
    for (const k of want) {
      const hit = GEN[k](poly, polyEdges, edgeData, centroTable, angleCensus);
      if (hit) { matches.push(k); detail[k] = hit; }
    }
    matches.sort((a, b) => a - b);
    return { matches, detail };
  }
  // Merge maximal runs of collinear I edges into ONE logical edge. This REMOVES redundant
  // vertices -- the opposite of a cut, and not excluded by ruling 1 ("no cuts"): a straight run
  // of I edges is already geometrically one segment with a redundant vertex partway along it, so
  // treating it as several separate edges makes the offset-equation algebra wrong wherever a
  // "length" should have been the merged run's total, not one raw edge (found empirically:
  // #1728474 m=8/off=5, a reducible boundary, where criterion 4's real match has raw side
  // lengths 3,1,1,1,1,1 -- only correct once the 3-edge run collapses to length 1). Mirrors
  // isohedral_criteria.js's refinePolygon's own merge step (same `collinear()` test, same EPS)
  // WITHOUT its cut-candidate insertion, which ruling 1 excludes; that function isn't exported
  // standalone so this is kept in sync by hand. A merged run's edge identity is its FIRST raw
  // edge's index (same choice refinePolygon makes).
  //
  // IMPORTANT, found on #601142 m=8 si=1/or=1/off=2: merging is NOT always the right move. That
  // boundary has a genuine 180-degree vertex (edge0/edge1 collinear), and the old engine's own
  // match for criteria 2/3/4/5 uses that vertex ITSELF as a hexagon corner (side a = edge0
  // alone) -- a real, original vertex is always a legal corner regardless of its angle, and
  // merging removes it from the candidate pool entirely, which is a DIFFERENT, over-eager thing
  // from what ruling 1 asked for. So: run the offset generators on BOTH the raw boundary (every
  // real vertex stays choosable) and the fully-merged one (gets the effective-length algebra
  // right for a chosen side that spans a whole collinear run), and take the union. This is not
  // theoretically complete for a long run where a genuine match needs a corner PARTWAY through
  // it (some of a run's redundant vertices used as corners, others absorbed) -- known, narrower
  // gap than the O(n^6) blind search's full generality, accepted for now; no concrete case found
  // yet (same spirit as ruling 2's deferred #25460 case).
  function mergeCollinearRuns(poly, polyEdges, edgeData) {
    const n = poly.length;
    if (!edgeData || n < 3) return { poly, polyEdges };
    const isI = k => edgeData.edgeSym[polyEdges[k]] === 2;
    const collinear = k => {
      const kk = (k + 1) % n;
      if (!isI(k) || !isI(kk)) return false;
      const p = poly[k], q = poly[kk], r = poly[(kk + 1) % n];
      const L = Math.hypot(r[0] - p[0], r[1] - p[1]);
      return L > 1e-12 && Math.abs((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / L < 1e-5;
    };
    const startsRun = new Array(n);
    for (let k = 0; k < n; k++) startsRun[k] = !collinear((k - 1 + n) % n);
    if (startsRun.every(x => x)) return { poly, polyEdges };   // nothing collinear -- no-op
    const outPts = [], outEdges = [];
    for (let k = 0; k < n; k++) {
      if (!startsRun[k]) continue;
      outPts.push(poly[k]); outEdges.push(polyEdges[k]);
    }
    return { poly: outPts, polyEdges: outEdges };
  }
  // Forward+reversed double-pass on ONE boundary, duplicated verbatim from
  // isohedral_criteria.js (~563-574) -- NOT part of the O(n^6) problem, needed because a
  // criterion can match only one walking direction (regression: #209337, criterion 8 walked
  // backwards only). `anyOnly` skips the reversed pass once the forward pass found anything.
  function checkOneBoundary(poly, polyEdges, edgeData, only, anyOnly, isRaw) {
    const n = poly.length;
    // trustGroupLength is sound ONLY here: on the raw, unmerged boundary every position is one
    // atomic edge, so same whichEdge group means same length by construction (see lenPairOK).
    const ed = isRaw ? { ...edgeData, trustGroupLength: true } : edgeData;
    const fwd = checkPolygonOneWay(poly, polyEdges, ed, only);
    if (anyOnly && fwd.matches.length) return fwd;
    const rp = [], re = [];
    for (let i = 0; i < n; i++) { rp.push(poly[(n - i) % n]); re.push(polyEdges[(n - 1 - i + n) % n]); }
    // the reversed walk traverses every edge backwards: +180 on each direction form
    const edRev = ed && ed.sym ? { ...ed, sym: { ...ed.sym, rev: true } } : ed;
    const rev = checkPolygonOneWay(rp, re, edRev, only);
    const matches = [...new Set([...fwd.matches, ...rev.matches])].sort((a, b) => a - b);
    const detail = { ...rev.detail, ...fwd.detail };
    for (const k of Object.keys(rev.detail)) if (!fwd.detail[k]) detail[k] = { ...rev.detail[k], reversed: true };
    return { matches, detail };
  }
  // Raw pass first (every real vertex stays choosable, catches #601142-style corners on a
  // redundant-but-real vertex); if merging would change anything, ALSO run the merged pass (gets
  // #1728474-style effective-length algebra right) and union the two. Most boundaries aren't
  // reducible, so the second pass costs nothing in the common case, and the union deliberately
  // does NOT truncate to one match per criterion (John, re #4: "iso 1, 2, 6 and 8" all at once;
  // deep_one_type.js reports the full joined list even under {any:true}).
  function checkPolygon(rawPoly, rawPolyEdges, edgeData, only, anyOnly) {
    const raw = checkOneBoundary(rawPoly, rawPolyEdges, edgeData, only, anyOnly, true);
    if (anyOnly && raw.matches.length) return raw;
    const { poly: mPoly, polyEdges: mPolyEdges } = mergeCollinearRuns(rawPoly, rawPolyEdges, edgeData);
    if (mPoly.length === rawPoly.length) return raw;   // nothing collinear -- raw pass is complete
    const merged = checkOneBoundary(mPoly, mPolyEdges, edgeData, only, anyOnly, false);
    const matches = [...new Set([...raw.matches, ...merged.matches])].sort((a, b) => a - b);
    const detail = { ...merged.detail, ...raw.detail };
    return { matches, detail };
  }
  // Re-indexing snippet duplicated from isohedral_criteria.js's checkBlock (~610-622) -- kept
  // manually in sync; `opts.deep` no longer exists (there is exactly one honest search now), a
  // caller passing it is silently ignored.
  // A boundary that was walked combinatorially (dd_patch.js) instead of read off a developed patch:
  // segments {a, b, tileIdx, edgeIdx, flipped} in walk order, with opts.symDirs = their exact
  // direction forms (and opts.sys). No placed tiles, no neighbour table.
  function checkBoundary(boundary, edgeData, only, opts) {
    if (!boundary || !boundary.length) return { boundary: null, matches: [], detail: {} };
    return checkWalked(boundary, null, edgeData, only, opts);
  }
  function checkBlock(placed, nbr, tileIdxs, edgeData, only, opts) {
    const boundary = blockBoundary(placed, nbr, tileIdxs);
    if (!boundary) return { boundary: null, matches: [], detail: {} };
    return checkWalked(boundary, nbr, edgeData, only, opts);
  }
  function checkWalked(boundary, nbr, edgeData, only, opts) {
    const poly = boundary.map(s => s.a);
    let bEdgeData = edgeData, polyEdges = boundary.map(s => s.edgeIdx);
    if (edgeData) {
      bEdgeData = {
        ...edgeData,
        whichEdge: boundary.map(s => edgeData.whichEdge[s.edgeIdx]),
        edgeSym: boundary.map(s => edgeData.edgeSym[s.edgeIdx]),
        mapping: boundary.map(s => edgeData.mapping[s.edgeIdx] ^ (s.flipped ? 1 : 0)),
      };
      polyEdges = boundary.map((_, k) => k);
    }
    // opts.sym = { ctx: AngleAlgebra.makeContext(eqs, m, sideTables), A }: attach each boundary
    // edge's exact direction form. Self-checked against the drawing: a convention error shows up
    // as tens of degrees, while drift in a lightly-rounded witness stays far under a degree.
    let symUsed = false;
    if (edgeData && opts && opts.symDirs && opts.sys && AA) {
      bEdgeData.sym = { sys: opts.sys, dir: opts.symDirs, rev: false }; symUsed = true;
    } else if (edgeData && opts && opts.sym && AA && nbr && !opts.sym.ctx.sys.inconsistent) {
      const dir = AA.boundaryDirs(opts.sym.ctx, nbr, boundary);
      let ok = !!dir;
      if (ok && opts.sym.A) for (let k = 0; k < boundary.length && ok; k++) {
        const s = boundary[k], num = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180 / Math.PI;
        const d = (((AA.evaluate(opts.sym.ctx.sys, dir[k], opts.sym.A) - num) % 360) + 360) % 360;
        if (Math.min(d, 360 - d) > 0.5) ok = false;
      }
      if (ok) { bEdgeData.sym = { sys: opts.sym.ctx.sys, dir, rev: false }; symUsed = true; }
    }
    const res = checkPolygon(poly, polyEdges, bEdgeData, only, opts && opts.any);
    return { boundary, poly, polyEdges, matches: res.matches, detail: res.detail, sym: symUsed };
  }

  const api = { checkBlock, checkBoundary, checkPolygon, CRITERIA, centro, buildCentroTable, buildAngleCensus, qualifies, mergeCollinearRuns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IsohedralCriteriaFast = api;
})(typeof window !== 'undefined' ? window : this);
