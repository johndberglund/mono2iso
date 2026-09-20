// Isohedral block-criteria checker (NOTES.md "L3 certification"): recognizes when a small
// block of adjacent developed tiles satisfies one of the 9 classical Heesch-Kienzle
// isohedral-tiling criteria (via Langerman & Winslow 2015 / Schattschneider & Escher 1990 /
// Church 2008, reproduced as Table 58 in program4/criteria.pdf, Tullenken's "Polyominoes").
// A criterion match is a complete, self-contained combinatorial/symmetry proof that the
// underlying tile shape tiles the plane -- it holds for a whole shape FAMILY at once (no
// interval arithmetic needed the way a genuine free-angle Case B family would).
//
// ---------------------------------------------------------------------------------------
// STRUCTURE (this is Table 58 verbatim, and it is simpler and MORE UNIFORM than earlier
// attempts in this file's history assumed -- see TODO.md for the wrong turns).
//
// EVERY criterion is stated on a hexagon with corners A,B,C,D,E,F and sides
//     a = A->B,  b = B->C,  c = C->D,  d = D->E,  e = E->F,  f = F->A
// (any side may collapse to zero length, which is how quadrilaterals/pentagons/triangles
// participate), and each criterion is just a small conjunction of FOUR primitive
// relations between named sides:
//
//   1 Conway : trans(a,d)  centro(b) centro(c) centro(e) centro(f)
//   2        : trans(a,d)  centro(b) centro(c)  glide(e,f)
//   3        : trans(a,d)  glide(b,c)  glide(e,f)
//   4 Transl.: trans(a,d)  trans(b,e)  trans(c,f)
//   5        : trans(a,d)  glide(b,f)  glide(c,e)   + the two glide axes PARALLEL
//   6        : glide(a,d)  glide(b,f)  centro(c) centro(e)  + the two glide axes PERPENDICULAR
//   7        : rot(c,d,120 about D)  rot(e,f,120 about F)  rot(a,b,120 about B)
//   8        : rot(c,d,120 about D)  centro(e)             rot(a,b,60  about B)
//   9        : rot(b,c,90  about C)  centro(a)             rot(d,e,90  about E)
//
// So there is ONE search -- over 6-tuples of corner positions on the block's boundary --
// and nine predicate sets over it. Criterion 6 needs no special two-center machinery in
// this formulation (its "centers" are just where the collapsed sides land), so all nine
// are implemented here.
//
// KEY CORRECTION vs. this file's earlier versions: the criteria constrain each side
// INDIVIDUALLY (e.g. criterion 1 wants b centrosymmetric AND c centrosymmetric, each
// about its OWN midpoint), NOT the merged arc b+c as a single symmetric arc. Those are
// genuinely different conditions -- verified with an explicit counterexample in
// _dev_isohedral/check_crit1_structure.js -- and conflating them made criteria 1/2/3/5
// both over- and under-fire.
//
// GEOMETRY IS NOT SUFFICIENT. A solved polygon can be ACCIDENTALLY symmetric (#1728474
// solves to a regular hexagon at several offsets) and satisfy a criterion's raw isometry
// test without that being a real match for that offset's construction. So every geometric
// relation is also gated on the tile's own combinatorial edge data
// (whichEdge/edgeSym/mapping, from John's "js tiling program notes.pdf") -- see edgeCompat.
// Passing no edgeData falls back to pure geometry, for unit-testing primitives on
// synthetic polygons that have no tile config behind them.
// ---------------------------------------------------------------------------------------
(function (root) {
  'use strict';
  const TilerCore = (typeof module !== 'undefined' && module.exports) ? require('./tiler_core.js') : root.TilerCore;
  const { applyT: ap, directIso, reflIso } = TilerCore;
  const EPS = 1e-5;   // world-unit tolerance -- these are floating solved tiles, not exact
  const ANG_EPS = 0.5;  // degrees

  function close(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS; }

  // ---------------- block boundary extraction ----------------
  // Merge a connected set of developed-tile indices into ONE outer polygon: walk every
  // tile's own sides, keep only the ones NOT shared with another tile in the same block
  // (per `nbr`, from TilerCore.developAdjacency), then stitch those boundary segments into
  // one ordered closed walk by matching endpoints. Returns null if the block's boundary
  // isn't a single simple closed curve (e.g. a disconnected or hole-containing block).
  function blockBoundary(placed, nbr, tileIdxs) {
    const inBlock = new Set(tileIdxs);
    const segs = [];
    for (const t of tileIdxs) {
      const verts = placed[t].verts, m = verts.length;
      // `flipped` = this tile was placed by an orientation-REVERSING transform. Two distinct
      // consequences, both required:
      //  (1) its vertex list winds the OPPOSITE way, so its sides must be emitted reversed
      //      (below) or the block's boundary walk can never close;
      //  (2) because of (1) we are traversing those edges BACKWARDS, which is exactly the
      //      Klein generator T_1 ("reflected", i.e. mirror across the perpendicular
      //      bisector), so their `mapping` codes must be composed with 1. checkBlock applies
      //      that. Confirmed on John's own explicit criterion-8 reading of #25578's 2-block:
      //      his 60-degree pair (orbit0 edges 0,3) and 120-degree pair (orbit1 edges 2,3)
      //      each give XOR 3 unaided, but his 180-degree side pairs orbit0 edge2 (direct)
      //      with orbit1 edge1 (flipped), which reaches XOR 3 only under ^1.
      const T = placed[t].T;
      const flipped = T ? (T[0] * T[3] - T[1] * T[2]) < 0 : false;
      for (let i = 0; i < m; i++) {
        if (inBlock.has(nbr[t][i])) continue;               // internal (shared) edge -- discard
        // A reflected tile's vertex list winds the OPPOSITE way round, so emitting its sides
        // as verts[i]->verts[i+1] makes them run against the rest of the block and the
        // endpoint-chaining below can never close the walk -- every block containing a
        // reflected neighbour silently came back "not a simple closed curve" and was skipped.
        // Emit those sides reversed so the whole block walks consistently.
        segs.push(flipped
          ? { a: verts[(i + 1) % m], b: verts[i], tileIdx: t, edgeIdx: i, flipped }
          : { a: verts[i], b: verts[(i + 1) % m], tileIdx: t, edgeIdx: i, flipped });
      }
    }
    if (!segs.length) return null;
    const key = p => Math.round(p[0] * 1e6) + ',' + Math.round(p[1] * 1e6);
    const byStart = new Map(segs.map(s => [key(s.a), s]));
    const ordered = [segs[0]];
    const used = new Set([segs[0]]);
    for (let guard = 0; guard < segs.length; guard++) {
      const next = byStart.get(key(ordered[ordered.length - 1].b));
      if (!next || used.has(next)) break;
      ordered.push(next); used.add(next);
    }
    if (ordered.length !== segs.length || !close(ordered[ordered.length - 1].b, ordered[0].a)) return null;
    return ordered;   // ordered[k] = {a,b,tileIdx,edgeIdx}; polygon vertices = ordered.map(s=>s.a)
  }

  // ---------------- isometry fitting ----------------
  // The direct (rotation+translation) or indirect (reflection+translation) isometry M with
  // M(Xs[k]) == Ys[k] for EVERY k, built from the two endpoints (tiler_core's directIso/
  // reflIso -- the same construction sideMotion uses to glue neighbouring tiles) then
  // verified against every intermediate point. Returns {M, kind:'direct'|'reflect'} or null.
  function fitIsometry(Xs, Ys, wantKind) {
    const n = Xs.length;
    if (n !== Ys.length || n === 0) return null;
    // A single point can't constrain an isometry; it trivially "matches" any other single
    // point by the translation between them. Callers that care (see collapsed-side notes)
    // must handle zero-length sides themselves rather than leaning on this.
    if (n === 1) return { M: [1, 0, 0, 1, Ys[0][0] - Xs[0][0], Ys[0][1] - Xs[0][1]], kind: 'direct' };
    for (const kind of (wantKind ? [wantKind] : ['direct', 'reflect'])) {
      const M = kind === 'direct' ? directIso(Xs[0], Xs[n - 1], Ys[0], Ys[n - 1])
                                  : reflIso(Xs[0], Xs[n - 1], Ys[0], Ys[n - 1]);
      if (!M.every(Number.isFinite)) continue;
      // directIso/reflIso fit a SIMILARITY through the two endpoints, not an isometry, and
      // the per-point loop below cannot catch the difference because a similarity maps every
      // point consistently. That is fine in their original use (sideMotion glues congruent
      // sides of congruent tiles, so the scale is 1 by construction) but NOT here, where we
      // compare arbitrary side pairs: without this check any two straight segments match
      // regardless of length, and more generally any two SIMILAR sides do.
      // Found by John asking why #3162 (a 30-60-90 triangle, sides 1 / 0.866 / 0.5, all I)
      // reported criteria 2, 6, 8 and 9 -- each of those pairs sides of different length.
      if (Math.abs(Math.hypot(M[0], M[2]) - 1) > 1e-6) continue;   // must be length-preserving

      let ok = true;
      for (let k = 0; k < n; k++) if (!close(ap(M, Xs[k]), Ys[k])) { ok = false; break; }
      if (ok) return { M, kind };
    }
    return null;
  }
  const isTranslation = M => Math.abs(M[0] - 1) < 1e-4 && Math.abs(M[1]) < 1e-4 &&
                              Math.abs(M[2]) < 1e-4 && Math.abs(M[3] - 1) < 1e-4;
  // Rotation angle of a direct isometry, in degrees (linear part [[m0,m1],[m2,m3]] =
  // [[cos,-sin],[sin,cos]]).
  const rotAngle = M => Math.atan2(M[2], M[0]) * 180 / Math.PI;
  // Mirror-axis direction of an indirect isometry, in degrees mod 180 (a reflection across
  // a line at angle t has linear part [[cos2t, sin2t],[sin2t, -cos2t]]).
  const axisAngle = M => { let a = Math.atan2(M[2], M[0]) * 90 / Math.PI; return ((a % 180) + 180) % 180; };
  const angClose = (x, y, mod) => { let d = Math.abs(((x - y) % mod + mod) % mod); return Math.min(d, mod - d) < ANG_EPS; };

  // ---------------- combinatorial edge-compatibility gate ----------------
  // Two unit edges may only be identified with each other if they are the same edge SHAPE
  // (`whichEdge`, the lowest-indexed congruent edge) and their `mapping` codes compose
  // correctly for the kind of isometry being claimed.
  //
  // The four mapping codes (js tiling program notes.pdf) are a Klein four-group: writing an
  // edge as running (0,0)->(1,0), 0 = as-is, 1 = "reflected" = mirror across the
  // perpendicular bisector x=1/2, 2 = "turned inside out" = mirror across the baseline y=0,
  // 3 = both = a 180-degree rotation about the midpoint. Composition is XOR on the codes,
  // and mapping edge i onto edge j applies T_(mapping[i] XOR mapping[j]). John's rule for a
  // J curve -- DIRECT (translate/rotate) iff the codes sum to 3, INDIRECT (glide/reflect)
  // iff they differ by 2 -- is exactly "XOR == 3" and "XOR == 2".
  //
  // For a symmetric edge type, whichever T is a no-op collapses the group, so an XOR value v
  // becomes indistinguishable from v XOR (that no-op):
  //   I (edgeSym 2, straight segment): both T_1 and T_2 are no-ops, so every code coincides
  //                                    -- compatible either way.
  //   U (edgeSym 1, LINE symmetric):   T_1 is the no-op, so v ~ v XOR 1; both of J's tests
  //                                    become v in {2,3}, i.e. U cannot distinguish direct
  //                                    from indirect.
  //   S (edgeSym 3, POINT symmetric):  the point symmetry IS T_3, so T_3 is the no-op and
  //                                    v ~ v XOR 3: DIRECT iff v in {0,3}, INDIRECT iff
  //                                    v in {1,2}.
  // The S row is confirmed by John (2026-07-25) against #54/#415: their S edges all sit at
  // mapping 0, so v = 0 -- direct-compatible (which is what criteria 1 and 8 use, and he
  // confirms those hold) but NOT glide-compatible, "since these S curves don't glide reflect
  // to each other", which correctly rules out criteria 2, 3 and 6 there. An earlier version
  // of this function used a parity test (0~2, 1~3) instead, which had it backwards and let
  // #54/#415 spuriously claim criteria 2 and 6. U remains unexercised by any test data.
  // `edgeData.relaxMapping` (sensitivity analysis only, never for a real verdict): keep the
  // whichEdge/edgeSym requirement but drop the mapping-code rule entirely. Used to ask "does
  // this NEGATIVE result depend on the mapping rule being right?" -- if a block still matches
  // nothing with the rule switched off, the finding is robust to that rule.
  function edgeCompat(edgeData, i, j, wantDirect) {
    if (!edgeData) return true;             // pure-geometry mode (unit tests)
    const { whichEdge, edgeSym, mapping } = edgeData;
    // Two I sides are compatible REGARDLESS of whichEdge. An I curve is a straight segment,
    // so it is determined entirely by its length -- two equal-length I sides are congruent no
    // matter what length-group the engine filed them under, and `fitIsometry` has already
    // verified the length geometrically (it cannot map one segment onto another of a
    // different length). John, on #25460: "we have I curves that don't have matching
    // whichEdge data, so we have to prove that they are the same length before we can apply
    // crit 9" -- the geometric fit IS that proof, so it must be allowed to override the
    // bookkeeping. #25460's own e0 and e3 are whichEdge 0 and 3 and genuinely different
    // lengths, yet a 0.46 sub-segment of e3 is congruent to e0 and the tile is criterion 9.
    if (edgeSym[i] === 2 && edgeSym[j] === 2) return true;
    if (whichEdge[i] !== whichEdge[j]) return false;
    if (edgeSym[i] !== edgeSym[j]) return false;
    if (edgeData.relaxMapping) return true;
    const v = mapping[i] ^ mapping[j];
    switch (edgeSym[i]) {
      case 2: return true;                                                  // I
      case 0: return wantDirect ? v === 3 : v === 2;                        // J
      case 3: return wantDirect ? (v === 0 || v === 3) : (v === 1 || v === 2); // S
      case 1: return v === 2 || v === 3;                                    // U (kind-blind)
      default: return false;
    }
  }
  // Positionwise gate over two equal-length edge-index lists (already put in corresponding
  // order by the caller -- reversed for direct/opposite pairings, same order for glides).
  function edgesCompat(edgeData, edgesX, edgesY, wantDirect) {
    if (edgesX.length !== edgesY.length) return false;
    for (let k = 0; k < edgesX.length; k++) if (!edgeCompat(edgeData, edgesX[k], edgesY[k], wantDirect)) return false;
    return true;
  }

  // ---------------- side extraction ----------------
  // A "side" is {pts, edges}: the boundary walk from corner offset o0 to o1 (measured
  // forward from anchor vertex A around a polygon of n vertices). edges[k] is the
  // prototile's own edge index for the segment pts[k]->pts[k+1], so edges.length =
  // pts.length - 1, and a COLLAPSED side (o0 === o1) is {pts:[one point], edges:[]}.
  // Offsets rather than raw indices so that o1 === n (all the way back to A) is expressible.
  function sideByOffset(poly, polyEdges, A, o0, o1) {
    const n = poly.length, pts = [], edges = [];
    for (let o = o0; o <= o1; o++) {
      const i = (A + o) % n;
      pts.push(poly[i]);
      if (o < o1) edges.push(polyEdges[i]);
    }
    return { pts, edges };
  }
  // Back-compat helper (index form) used by the older explicit-corner tests.
  function side(poly, polyEdges, i, j) {
    const n = poly.length;
    return sideByOffset(poly, polyEdges, i, 0, ((j - i) % n + n) % n);
  }

  // ---------------- the four primitive relations ----------------
  // In every one of these, a COLLAPSED side (zero edges) is accepted only against another
  // collapsed side -- that is what Table 58's "a side may collapse to zero" means, and it
  // keeps a zero-length side from silently satisfying a rule about a real one.

  // trans(X, Y): X and Y are translates. Opposite sides of a translation-symmetric polygon
  // are equal-and-REVERSED as directed boundary walks (a parallelogram's C->D read in
  // boundary order is the reverse of A->B), so reversed(X) must map onto Y by a pure
  // translation. Validated on #41 (rectangle) and a general parallelogram, rejected on a
  // trapezoid -- see _dev_isohedral/test_criterion4*.js.
  function trans(X, Y, edgeData) {
    X = simplifySide(X, edgeData); Y = simplifySide(Y, edgeData);
    if (X.edges.length !== Y.edges.length) return null;
    if (X.edges.length === 0) return { collapsed: true };
    const fit = fitIsometry(X.pts.slice().reverse(), Y.pts, 'direct');
    if (!fit || !isTranslation(fit.M)) return null;
    return edgesCompat(edgeData, X.edges.slice().reverse(), Y.edges, true) ? fit : null;
  }

  // centro(X): X is centrosymmetric -- the half-turn about X's OWN midpoint maps X onto
  // itself (equivalently onto its own reversal, swapping its endpoints). Combinatorially
  // this is isohedral.txt's "ab...cc...ba" palindrome: edge k pairs with edge (last-k) by a
  // direct map, and if X has an ODD number of edges the middle edge maps to ITSELF, which
  // requires it to be point-symmetric in its own right -- S or I, John's "we could replace
  // either of those pairs by an S or I curve".
  // Drop interior points that lie exactly on the straight line between their neighbours, when
  // the two edges meeting there are both I (straight). Such a point is bookkeeping, not shape:
  // the two pieces are collinear so the pair is geometrically one segment.
  //
  // This matters because every side comparison below fits POINT LISTS, and requires the two
  // sides to have the same number of edges. So a side that happens to be subdivided -- by
  // refinePolygon's cuts, or by a multi-segment net edge -- could never match an equal-length
  // side that is not subdivided, however congruent they actually are. That is exactly what
  // blocks John's criterion 8/9 readings: on #25460 the best corner assignment has
  // sideEdgeCounts [4,1,1,1,3] and fails rot(d,e,90) purely because d has 1 sub-edge and e
  // has 3, not because the geometry is wrong. Same cause as his fam 8 recipe not being found.
  function simplifySide(X, edgeData) {
    if (!edgeData || X.pts.length < 3) return X;
    const pts = [X.pts[0]], edges = [];
    for (let i = 1; i < X.pts.length - 1; i++) {
      const bothI = edgeData.edgeSym[X.edges[i - 1]] === 2 && edgeData.edgeSym[X.edges[i]] === 2;
      const p = pts[pts.length - 1], q = X.pts[i], r = X.pts[i + 1];
      const L = Math.hypot(r[0] - p[0], r[1] - p[1]);
      const flat = L > 1e-12 && Math.abs((r[0]-p[0])*(q[1]-p[1]) - (r[1]-p[1])*(q[0]-p[0])) / L < EPS;
      if (bothI && flat) continue;                      // redundant joint: skip it
      pts.push(q); edges.push(X.edges[i - 1]);
    }
    pts.push(X.pts[X.pts.length - 1]); edges.push(X.edges[X.edges.length - 1]);
    return { pts, edges };
  }

  // Is this side one STRAIGHT run -- every edge an I curve and every point collinear? Then it
  // is geometrically a single segment however many edges it is built from, and its interior
  // joints are bookkeeping, not corners.
  function straightRun(X, edgeData) {
    if (!edgeData || X.edges.length < 2) return false;
    if (!X.edges.every(e => edgeData.edgeSym[e] === 2)) return false;
    const a = X.pts[0], b = X.pts[X.pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) return false;
    return X.pts.every(p => Math.abs((b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])) / L < EPS);
  }

  function centro(X, edgeData) {
    const k = X.edges.length;
    if (k === 0) return { collapsed: true };
    // A straight run of I edges is centrosymmetric about the midpoint of the WHOLE run, and
    // that midpoint generally is not one of its joints -- so the point-by-point fit below
    // fails on it whenever the pieces are unequal (the joint has no partner). This is John's
    // #3182 reading: "two I curves with 180 degrees between them; this string of two edges is
    // a centro symmetric side, so the tile fits criterion 9." Accept it directly; the gate is
    // satisfied too, since I-vs-I is compatible on geometry alone.
    if (straightRun(X, edgeData)) {
      const a = X.pts[0], b = X.pts[X.pts.length - 1];
      return { M: [-1, 0, 0, -1, a[0] + b[0], a[1] + b[1]], kind: 'direct', straight: true };
    }
    const fit = fitIsometry(X.pts.slice().reverse(), X.pts, 'direct');
    if (!fit || !angClose(rotAngle(fit.M), 180, 360)) return null;
    if (edgeData) {
      // Gate the OUTER pairs only: edge i pairs with edge (k-1-i) by a direct map. The
      // middle edge of an odd-length side pairs with ITSELF, which no two-different-edges
      // rule can express (a J edge compared to itself trivially fails every one of them) --
      // that case is precisely "this edge must be point-symmetric on its own", i.e. S or I.
      for (let i = 0; i < Math.floor(k / 2); i++) {
        if (!edgeCompat(edgeData, X.edges[i], X.edges[k - 1 - i], true)) return null;
      }
      if (k % 2 === 1) {
        const mid = X.edges[(k - 1) / 2];
        if (edgeData.edgeSym[mid] !== 2 && edgeData.edgeSym[mid] !== 3) return null;  // need I or S
      }
    }
    return fit;
  }

  // glide(X, Y): X glide-reflects (or plain reflects) onto Y. Unlike the translate case
  // these are NOT reversed: for the adjacent pairs the criteria use (e.g. criterion 3's
  // b = B->C and c = C->D), the glide carries B->C and C->D, i.e. it maps the directed
  // walk X onto the directed walk Y in the SAME order -- isohedral.txt's "ab...cab...c
  // by indirect map", the sequence repeating rather than mirroring.
  // `edgeData.bothGlideOrientations` (sensitivity analysis only): also accept the REVERSED
  // pairing. The same-order convention below is derived from the ADJACENT pairs the criteria
  // use (criterion 3's b,c share corner C, so the glide carries B->C onto C->D), but
  // criteria 5 and 6 also glide NON-adjacent pairs (b,f and c,e) where that derivation does
  // not directly apply and the convention was never independently confirmed. Turning this on
  // tests whether a negative result depends on having guessed it right.
  function glide(X, Y, edgeData) {
    X = simplifySide(X, edgeData); Y = simplifySide(Y, edgeData);
    if (X.edges.length !== Y.edges.length) return null;
    // A collapsed pair is allowed (Table 58 lets sides collapse) but has no MIRROR AXIS, so
    // criteria 5 and 6 -- whose rule (4) constrains the two axes to be parallel /
    // perpendicular -- must reject it themselves rather than let that rule go unchecked.
    // Rule (4) is Church's (2008) addition, made precisely because counterexamples exist
    // without it, so silently skipping it demonstrably over-fires (an equilateral triangle
    // claimed criteria 5 and 6 that way). Criteria 2 and 3 have no axis rule and are fine.
    if (X.edges.length === 0) return { collapsed: true, axis: null };
    const fit = fitIsometry(X.pts, Y.pts, 'reflect');
    if (fit && edgesCompat(edgeData, X.edges, Y.edges, false))
      return { M: fit.M, kind: 'reflect', axis: axisAngle(fit.M) };
    if (edgeData && edgeData.bothGlideOrientations) {
      const rev = fitIsometry(X.pts.slice().reverse(), Y.pts, 'reflect');
      if (rev && edgesCompat(edgeData, X.edges.slice().reverse(), Y.edges, false))
        return { M: rev.M, kind: 'reflect', axis: axisAngle(rev.M), reversed: true };
    }
    return null;
  }

  // rot(X, Y, deg): X rotates by `deg` about the corner X and Y SHARE to become Y. X ends
  // where Y starts, and that shared corner is the rotation centre, so (as with trans) the
  // matching is reversed(X) -> Y: the centre is pinned by construction (reversed(X) starts
  // at it and so does Y), leaving only "is the rotation angle right". Note this forces the
  // polygon's interior angle at that corner to equal `deg`, which is John's cheap filter
  // for criteria 7/8/9 -- a rotation centre other than a 180 one always sits on a vertex,
  // and its angle is readable straight off.
  function rot(X, Y, deg, edgeData) {
    X = simplifySide(X, edgeData); Y = simplifySide(Y, edgeData);
    if (X.edges.length !== Y.edges.length) return null;
    // A rotation pair MAY collapse, and carries no angle requirement when it does -- John's
    // own criterion-8 reading of #54: "take edge 0 as a centro symmetric curve, this is for
    // the 180 degrees; rotate edge 1 to edge 2 by 60 degrees; the 120 degree rotation
    // collapses to 0". (So do NOT demand the interior angle at a collapsed rotation corner
    // equal the rotation angle -- #54's corners are all 60 degrees, never 120.) What keeps
    // this from degenerating is the pentagon rule enforced by criteria 8 and 9 themselves:
    // side f must be empty, because no rule constrains it. See CRITERIA below.
    if (X.edges.length === 0) return { collapsed: true };
    // REVERSED comparison (reversed(X) -> Y). Derivation: c runs C->D and d runs D->E, so a
    // rotation about the shared corner D fixes D and must send C to E -- which is exactly
    // reversed(c) -> d. CONFIRMED by John's #601142 m=8 si=1 or=0 off=4 = "iso 7", which this
    // convention finds at 1 tile and the same-order convention does not find at all.
    // NOTE (open): the same-order convention is what would make #25578's 2-tile block satisfy
    // criterion 8, which John states it does. Under THIS (confirmed) convention criterion 8
    // has no geometric match there at any corner assignment. The two cannot both be right, so
    // one of the two ground-truth readings is being modelled wrongly -- unresolved, see
    // NOTES.md "#25578 open discrepancy". Do not flip this without re-checking #601142.
    const fit = fitIsometry(X.pts.slice().reverse(), Y.pts, 'direct');
    if (!fit || !angClose(rotAngle(fit.M), deg, 360)) return null;
    return edgesCompat(edgeData, X.edges.slice().reverse(), Y.edges, true) ? fit : null;
  }

  // ---------------- the nine criteria, as predicates on one corner 6-tuple ----------------
  // s = {a,b,c,d,e,f}. Each returns a truthy detail object or a falsy value.
  // PENTAGON RULE (John, 2026-07-25: "Criteria 8 and 9 are stated on pentagons"). Read down
  // the table's rules and count which sides each criterion mentions: 1-7 constrain all six,
  // but criteria 8 and 9 name only a,b,c,d,e -- side f appears in NO rule. It is therefore
  // not merely allowed to collapse, it MUST be empty; a non-empty f would be a stretch of
  // boundary under no constraint whatsoever. This is what stops a collapsed rotation pair
  // from degenerating the criterion: with b,c,d,e all collapsed, criterion 9 would otherwise
  // reduce to "side a is centrosymmetric, side f arbitrary" and fire on #1728474's regular
  // hexagon, which has no 90-degree anything. Requiring f empty rejects exactly that while
  // still admitting John's #54 criterion-8 reading (a,b,e real; c,d and f collapsed).
  const empty = X => X.edges.length === 0;
  const CRITERIA = {
    1: (s, ed) => trans(s.a, s.d, ed) && centro(s.b, ed) && centro(s.c, ed) && centro(s.e, ed) && centro(s.f, ed),
    2: (s, ed) => trans(s.a, s.d, ed) && centro(s.b, ed) && centro(s.c, ed) && glide(s.e, s.f, ed),
    3: (s, ed) => trans(s.a, s.d, ed) && glide(s.b, s.c, ed) && glide(s.e, s.f, ed),
    4: (s, ed) => trans(s.a, s.d, ed) && trans(s.b, s.e, ed) && trans(s.c, s.f, ed),
    5: (s, ed) => {
      const t = trans(s.a, s.d, ed); if (!t) return null;
      const g1 = glide(s.b, s.f, ed); if (!g1) return null;
      const g2 = glide(s.c, s.e, ed); if (!g2) return null;
      // rule (4), Church's addition: the two glide reflections must be PARALLEL. A collapsed
      // pair pins no axis, so there is nothing to compare and the rule is vacuous -- sides
      // collapse in every criterion (John), so this cannot be grounds for rejection.
      if (g1.axis != null && g2.axis != null && !angClose(g1.axis, g2.axis, 180)) return null;
      return { t, g1, g2 };
    },
    6: (s, ed) => {
      const g1 = glide(s.a, s.d, ed); if (!g1) return null;
      const g2 = glide(s.b, s.f, ed); if (!g2) return null;
      if (!centro(s.c, ed) || !centro(s.e, ed)) return null;
      // rule (4), Church's addition: the two glide reflections must be PERPENDICULAR. As in
      // criterion 5, a collapsed pair pins no axis and the rule is then vacuous -- required,
      // since a 3-edge triangle cannot fill all six side slots without collapsing one, and
      // John confirms #4 (a triangle) does satisfy criterion 6.
      if (g1.axis != null && g2.axis != null && !angClose(Math.abs(g1.axis - g2.axis), 90, 180)) return null;
      return { g1, g2 };
    },
    7: (s, ed) => rot(s.c, s.d, 120, ed) && rot(s.e, s.f, 120, ed) && rot(s.a, s.b, 120, ed),
    8: (s, ed) => empty(s.f) && rot(s.c, s.d, 120, ed) && centro(s.e, ed) && rot(s.a, s.b, 60, ed),
    9: (s, ed) => empty(s.f) && rot(s.b, s.c, 90, ed) && centro(s.a, ed) && rot(s.d, s.e, 90, ed),
  };
  // Rotations are signed; a shape and its mirror image differ by the sign, so accept either
  // handedness by also trying the negated angles.
  const CRITERIA_MIRROR = {
    7: (s, ed) => rot(s.c, s.d, -120, ed) && rot(s.e, s.f, -120, ed) && rot(s.a, s.b, -120, ed),
    8: (s, ed) => empty(s.f) && rot(s.c, s.d, -120, ed) && centro(s.e, ed) && rot(s.a, s.b, -60, ed),
    9: (s, ed) => empty(s.f) && rot(s.b, s.c, -90, ed) && centro(s.a, ed) && rot(s.d, s.e, -90, ed),
  };

  // ---------------- the corner search ----------------
  // Enumerate every way of cutting the closed boundary into six consecutive sides: an
  // anchor vertex A, then five non-decreasing offsets 0 <= o1 <= ... <= o5 <= n giving
  // corners B..F (repeats = collapsed sides). All n anchors are tried because the criteria
  // are NOT invariant under cyclically relabelling A..F. That is O(n * C(n+4,5)) tuples --
  // a few hundred thousand at n=16, which these small blocks never exceed.
  function eachCornerTuple(n, visit) {
    for (let A = 0; A < n; A++)
      for (let o1 = 0; o1 <= n; o1++)
        for (let o2 = o1; o2 <= n; o2++)
          for (let o3 = o2; o3 <= n; o3++)
            for (let o4 = o3; o4 <= n; o4++)
              for (let o5 = o4; o5 <= n; o5++)
                if (visit(A, [0, o1, o2, o3, o4, o5])) return true;
    return false;
  }
  function sidesFor(poly, polyEdges, A, o) {
    const n = poly.length;
    return {
      a: sideByOffset(poly, polyEdges, A, o[0], o[1]), b: sideByOffset(poly, polyEdges, A, o[1], o[2]),
      c: sideByOffset(poly, polyEdges, A, o[2], o[3]), d: sideByOffset(poly, polyEdges, A, o[3], o[4]),
      e: sideByOffset(poly, polyEdges, A, o[4], o[5]), f: sideByOffset(poly, polyEdges, A, o[5], n),
    };
  }

  // ---------------- refinement: extra corner candidates inside I sides ----------------
  // A criterion corner need NOT be a polygon vertex. An I side is a straight segment, so it
  // can be cut anywhere and both pieces are still straight -- and the cut position is not a
  // free parameter, it is DETERMINED by the length the piece has to match. John's #25460 is
  // the clean example: e0 (I, len 0.4600) rotates 90 degrees about v0 onto the first 0.4600 of
  // e3 (I, len 1.2008), and e3's remaining 0.7408 is the centrosymmetric side -- criterion 9,
  // but only expressible if e3 may be cut at 0.4600 from its end. Verified numerically: the
  // rotated image lands on e3 to within 2e-12.
  //
  // So insert, on every I side, a vertex at distance d from each end for every d drawn from
  // the other sides' lengths, plus the midpoint (which is the d = Lambda/2 case and is what
  // a collinear I-run needs -- John's #3182 pattern). Finite and small: O(m) cuts per I side.
  // Each piece inherits the original's edge index, hence its edgeSym (still I) -- sound
  // because edgeCompat treats I-vs-I as compatible on geometry alone (see above).
  //
  // This is expensive (the corner search is ~O(n^5)), so it is OPT-IN: run the cheap pass
  // everywhere, then re-test only the combos that came out anisohedral. John: "I would do
  // this complex testing only on those that fall out as possible anisohedral tiles."
  function refinePolygon(poly, polyEdges, edgeData) {
    const n = poly.length;
    if (!edgeData) return { poly, polyEdges };
    const len = k => Math.hypot(poly[(k + 1) % n][0] - poly[k][0], poly[(k + 1) % n][1] - poly[k][1]);
    const lens = []; for (let k = 0; k < n; k++) lens.push(len(k));
    // MERGE maximal runs of collinear I edges into one logical segment before generating cuts.
    // John: "Why can't you consider 2&3 as joined into one larger segment?" -- exactly right,
    // and it is both more correct and much cheaper. On #25576 the wanted cut is 1.3645 along
    // the e2+e3 run (total 1.9486), which is simply another side's length; measured against e3
    // alone it is 0.2711 = e1 - e2, a DIFFERENCE that needed a combinatorial blow-up of
    // candidates to reach (n went 18 -> 44 and one combo took 73s). Merging first makes the
    // cut a plain target length again, and drops the redundant interior joints as a bonus.
    const isI = k => edgeData.edgeSym[polyEdges[k]] === 2;
    const collinear = k => {                         // is the joint at poly[k+1] straight-through?
      const kk = (k + 1) % n;
      if (!isI(k) || !isI(kk)) return false;
      const p = poly[k], q = poly[kk], r = poly[(kk + 1) % n];
      const L = Math.hypot(r[0] - p[0], r[1] - p[1]);
      return L > 1e-12 && Math.abs((r[0]-p[0])*(q[1]-p[1]) - (r[1]-p[1])*(q[0]-p[0])) / L < EPS;
    };
    // runStart[k] = true when edge k begins a new logical segment
    const startsRun = new Array(n);
    for (let k = 0; k < n; k++) startsRun[k] = !collinear((k - 1 + n) % n);
    const outPts = [], outEdges = [];
    for (let k = 0; k < n; k++) {
      if (!startsRun[k]) continue;                   // interior joint of a merged run: drop it
      // walk the whole run
      let last = k, span = lens[k];
      while (collinear(last)) { last = (last + 1) % n; span += lens[last]; }
      const a = poly[k], b = poly[(last + 1) % n], LAM = span;
      outPts.push(a); outEdges.push(polyEdges[k]);
      const sym = edgeData.edgeSym[polyEdges[k]];
      if (LAM < 1e-9) continue;
      // An S curve is point-symmetric about its own chord midpoint, so THAT ONE POINT is a
      // legitimate corner (John, on criterion 6: centres "will either be at vertices, or at
      // the midpoint of an S or I curve"). Unlike an I curve it may not be cut anywhere else:
      // half of an S curve is not itself a curve of any type we track.
      if (sym === 3) { outPts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); outEdges.push(polyEdges[k]); continue; }
      if (sym !== 2) continue;                                            // otherwise I sides only
      const cands = [];
      const add = d => { if (d > 1e-7 && d < LAM - 1e-7 && !cands.some(x => Math.abs(x - d) < 1e-7)) cands.push(d); };
      // Candidate cut distances. NOTE this is angle-agnostic on purpose: the rotation angle is
      // never referenced here, it is checked separately by rot(), which is told the required
      // degrees (60/90/120/180) by the criterion. What a cut has to satisfy is a LENGTH
      // condition -- rot(b,c,deg) needs |b| = |c| whatever deg is -- so covering the possible
      // matching lengths covers 60- and 120-degree centres exactly as it does 90.
      // Both a single side's length AND the total of a consecutive RUN of sides, since the
      // side this piece pairs with may itself span several edges. Measured from both ends.
      const targets = [];
      for (let s = 0; s < n; s++) {
        let acc = 0;
        for (let t = 0; t < n; t++) { acc += lens[(s + t) % n]; targets.push(acc); add(acc); add(LAM - acc); }
      }
      add(LAM / 2);                       // the run's own midpoint (John's #3182 pattern)
      cands.sort((x, y) => x - y);
      const ux = (b[0] - a[0]) / LAM, uy = (b[1] - a[1]) / LAM;
      for (const d of cands) { outPts.push([a[0] + ux * d, a[1] + uy * d]); outEdges.push(polyEdges[k]); }
    }
    return { poly: outPts, polyEdges: outEdges };
  }

  // Which criteria does this boundary satisfy? Returns {matches:[...], detail:{crit:{A,offsets}}}.
  // `only` optionally restricts which criteria to test (an array of numbers).
  // The criteria templates are NOT symmetric under reversing the boundary: criterion 8, for
  // instance, is [a b] at 60, then [c d] at 120, then [e]. A tile whose 120-pair comes first
  // fits the template only when walked the other way round, and the corner enumeration below
  // only ever walks FORWARD -- so those matches were invisible. Found on John's reading of
  // #209337: "edges 0 and 4 rotate by 120 degrees, edges 1 and 2 rotate by 60 degrees, edge 3
  // is centro symmetric, this is criterion 8" -- which the forward search misses entirely and
  // the reversed search finds immediately. Both confirmed-anisohedral controls (#3193, #25550)
  // stay empty in both directions, so this is a genuine miss being fixed, not added slack.
  // `anyOnly`: stop at the FIRST criterion found and return it alone. For the sweeps the
  // question is only "is this tile isohedral at all" -- John: "After we find one isohedral
  // criteria, let's stop for that combo" -- and enumerating the rest is pure waste. It also
  // lets the reversed pass be skipped entirely whenever the forward pass already found one.
  function checkPolygon(poly, polyEdges, edgeData, only, anyOnly) {
    const n = poly.length;
    const fwd = checkPolygonOneWay(poly, polyEdges, edgeData, only, anyOnly);
    if (anyOnly && fwd.matches.length) return fwd;
    const rp = [], re = [];
    for (let i = 0; i < n; i++) { rp.push(poly[(n - i) % n]); re.push(polyEdges[(n - 1 - i + n) % n]); }
    const rev = checkPolygonOneWay(rp, re, edgeData, only, anyOnly);
    const matches = [...new Set([...fwd.matches, ...rev.matches])].sort((a, b) => a - b);
    const detail = { ...rev.detail, ...fwd.detail };
    for (const k of Object.keys(rev.detail)) if (!fwd.detail[k]) detail[k] = { ...rev.detail[k], reversed: true };
    return { matches, detail };
  }
  function checkPolygonOneWay(poly, polyEdges, edgeData, only, anyOnly) {
    const n = poly.length;
    const want = (only || [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice();
    const matches = [], detail = {};
    const pending = new Set(want);
    eachCornerTuple(n, (A, o) => {
      if (!pending.size) return true;
      const s = sidesFor(poly, polyEdges, A, o);
      for (const k of Array.from(pending)) {
        let hit = CRITERIA[k](s, edgeData);
        if (!hit && CRITERIA_MIRROR[k]) hit = CRITERIA_MIRROR[k](s, edgeData);
        if (hit) {
          matches.push(k); detail[k] = { anchor: A, offsets: o.slice() };
          pending.delete(k);
          if (anyOnly) return true;                 // one is enough -- stop the whole search
        }
      }
      return false;
    });
    matches.sort((x, y) => x - y);
    return { matches, detail };
  }

  // ---------------- top level ----------------
  // Merge the block's boundary, then test it against all nine criteria. `edgeData` is
  // {whichEdge, edgeSym, mapping} for the prototile (cfg.* from test_harness.js's config()).
  // Omitting it falls back to pure geometry -- fine for unit tests, NOT for real verdicts.
  // Returns every criterion that matches, not just the first: a shape can legitimately
  // satisfy several via different corner choices (John, re #4: "iso 1, 2, 6 and 8").
  // `opts.deep` additionally allows corners INSIDE I sides (see refinePolygon) -- much more
  // expensive, so reserve it for combos the cheap pass called anisohedral.
  function checkBlock(placed, nbr, tileIdxs, edgeData, only, opts) {
    const boundary = blockBoundary(placed, nbr, tileIdxs);
    if (!boundary) return { boundary: null, matches: [], detail: {} };
    const poly = boundary.map(s => s.a);
    // Re-index the gate data by BOUNDARY POSITION so each segment carries its own placed
    // tile's effective mapping code (^1 when that tile was emitted reversed -- see the parity
    // note in blockBoundary). A single-tile block reduces to the original behaviour.
    let bEdgeData = edgeData, polyEdges = boundary.map(s => s.edgeIdx);
    if (edgeData) {
      bEdgeData = {
        ...edgeData,
        whichEdge: boundary.map(s => edgeData.whichEdge[s.edgeIdx]),
        edgeSym:   boundary.map(s => edgeData.edgeSym[s.edgeIdx]),
        mapping:   boundary.map(s => edgeData.mapping[s.edgeIdx] ^ (s.flipped ? 1 : 0)),
      };
      polyEdges = boundary.map((_, k) => k);
    }
    let usePoly = poly, useEdges = polyEdges;
    if (opts && opts.deep) {
      const ref = refinePolygon(poly, polyEdges, bEdgeData);
      usePoly = ref.poly; useEdges = ref.polyEdges;
    }
    const res = checkPolygon(usePoly, useEdges, bEdgeData, only, opts && opts.any);
    return { boundary, poly: usePoly, polyEdges: useEdges, matches: res.matches, detail: res.detail };
  }

  // ---------------- explicit-corner entry points (regression tests / hand checks) --------
  // corners = [A,B,C,D,E,F] as vertex INDICES into poly (repeats allowed for collapsed
  // sides). Kept so John's own by-hand corner choices can be checked directly.
  function checkCriterionAt(poly, polyEdges, corners, k, edgeData) {
    const n = poly.length, A = corners[0];
    const o = corners.map(c => ((c - A) % n + n) % n);
    for (let i = 1; i < 6; i++) if (o[i] < o[i - 1]) o[i] += n;    // keep the walk monotone
    const s = sidesFor(poly, polyEdges, A, o);
    let hit = CRITERIA[k](s, edgeData);
    if (!hit && CRITERIA_MIRROR[k]) hit = CRITERIA_MIRROR[k](s, edgeData);
    return !!hit;
  }
  const checkCriterion4 = (poly, polyEdges, corners, edgeData) => checkCriterionAt(poly, polyEdges, corners, 4, edgeData);
  const checkCriterion4Auto = (poly, polyEdges, edgeData) => {
    const r = checkPolygon(poly, polyEdges, edgeData, [4]);
    return r.matches.length ? { corners: r.detail[4] } : null;
  };

  const api = {
    blockBoundary, fitIsometry, edgeCompat, edgesCompat, side, sideByOffset,
    trans, centro, glide, rot,
    checkPolygon, checkBlock, refinePolygon, checkCriterionAt, checkCriterion4, checkCriterion4Auto,
    CRITERIA,
    // legacy aliases: the old per-criterion entry points, now table-faithful
    sidesTranslate: trans,
    sideCentrosymmetric: centro,
    sidesGlideReflect: glide,
    checkCriterion1: (p, pe, ed) => checkPolygon(p, pe, ed, [1]).detail[1] || null,
    checkCriterion2: (p, pe, ed) => checkPolygon(p, pe, ed, [2]).detail[2] || null,
    checkCriterion3: (p, pe, ed) => checkPolygon(p, pe, ed, [3]).detail[3] || null,
    checkCriterion5: (p, pe, ed) => checkPolygon(p, pe, ed, [5]).detail[5] || null,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IsohedralCriteria = api;
})(typeof window !== 'undefined' ? window : this);
