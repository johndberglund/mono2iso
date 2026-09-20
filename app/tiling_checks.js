// Shared quality checks for a solved tile and its developed patch.  No DOM; usable in Node
// (module.exports) and the browser (window.TilingChecks).
//
// These all existed as copy-pasted inlines in tilerTest.js and half a dozen dev scripts, and the
// copies had drifted -- which is how a bug in ONE of them (the vertex figure, see below) went
// unnoticed for months while the on-screen readout quietly mislabelled good tilings.  One copy.
(function (root) {
  'use strict';

  // ---- interior angle, taken WITH the polygon's own orientation ----------------------
  // The obvious `Math.abs(Math.atan2(cross, dot))` is capped at 180, so it reads every REFLEX
  // corner as its 360-complement.  Reflex corners are common -- #209087's angles include 417.3
  // and -28.7 -- and with the capped version no vertex of such a tiling ever sums to 360, so the
  // patch reads as "not a tiling".  That single sign error accounted for 18 of the 19 witnesses a
  // 2026-09-06 audit flagged as realising the wrong vertex figure.
  function orientation(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; s += poly[i][0] * q[1] - q[0] * poly[i][1]; }
    return s >= 0 ? 1 : -1;
  }
  function interiorAngle(prev, at, next, sgn) {
    const v1 = [prev[0] - at[0], prev[1] - at[1]], v2 = [next[0] - at[0], next[1] - at[1]];
    const t = Math.atan2(sgn * (v2[0] * v1[1] - v2[1] * v1[0]), v2[0] * v1[0] + v2[1] * v1[1]) * 180 / Math.PI;
    return t < 0 ? t + 360 : t;
  }

  // ---- vertex figure of a developed patch -------------------------------------------
  // A point counts as a vertex when the angles meeting there sum to 360 and at least 3 tiles
  // meet.  The 360 test is what excludes the patch's own ragged boundary, where vertices are
  // genuinely under-filled -- a radius-based "interior" filter does not work and reports degrees
  // {1,2,3,...}.  Vertices are bucketed on a key scaled by the tile size, so it is a relative
  // snap rather than an absolute grid; a patch spanning many units otherwise splits coincident
  // vertices across buckets.
  function vertexFigure(placed, opts) {
    opts = opts || {};
    const tol = opts.angleTol == null ? 2 : opts.angleTol;
    const b = {};
    let S = 0;
    if (placed.length) { const P = placed[0].verts;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++)
        S = Math.max(S, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])); }
    S = S || 1;
    for (const t of placed) {
      const P = t.verts, n = P.length, sg = orientation(P);
      for (let j = 0; j < n; j++) {
        const q = P[j], k = (q[0] / S).toFixed(4) + ',' + (q[1] / S).toFixed(4);
        (b[k] = b[k] || { d: 0, s: 0 }).d++;
        // opts.cornerAngles: the interior angles as DRAWN, from TilerCurves.curveCornerAngles.
        // Interior angle is a similarity invariant, so one array serves every congruent copy in
        // the patch, reflections included. Without it this sums chord angles, and a tile with a
        // corner the family forces flat then never reaches 360 at the vertices where those cusps
        // meet -- so those vertices are dropped and the figure reads short. That is what made
        // John's #25543 m7 si5 report {4} against a wanted {3,4,5} and #209516 si7 report {3}
        // against {3,4}: both are drawn with curves that open the flat corner.
        b[k].s += opts.cornerAngles ? opts.cornerAngles[j] : interiorAngle(P[(j-1+n)%n], q, P[(j+1)%n], sg);
      }
    }
    const degs = {};
    for (const k in b) if (Math.abs(b[k].s - 360) < tol && b[k].d >= 3) degs[b[k].d] = 1;
    return Object.keys(degs).map(Number).sort((a, b) => a - b);
  }
  // the type's declared vertex degrees, as a comparable set
  function wantedDegrees(vdeg) {
    return [...new Set(String(vdeg || '').split(/\s+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
  }
  // does the patch realise the vertex figure the type calls for?  `null` when the type declares
  // none, so callers can tell "no opinion" from "disagrees".
  function figureMatches(placed, vdeg, opts) {
    const want = wantedDegrees(vdeg);
    if (!want.length) return null;
    return vertexFigure(placed, opts).join(',') === want.join(',');
  }

  // ---- is the patch EDGE-TO-EDGE? -----------------------------------------------------
  // Counts T-junctions: a tile's corner lying strictly inside another tile's edge. Such a patch
  // still has zero overlap area and can still realise the type's set of vertex degrees, so
  // neither overlapStrict nor vertexFigure sees it -- but it is a visibly different tiling, and
  // usually a degenerate corner of the closing family rather than the shape you want.
  //
  // John caught this by eye on #601097 (2026-09-06): "The other combo seemed like it intersected
  // an edge." Two members of the same one-parameter family, both overlap-free and both matching
  // the vertex figure -- his interlocks edge to edge, the one the score picked splits into
  // triangles whose corners land halfway along the long grid lines.
  function tJunctions(placed, opts) {
    opts = opts || {};
    let S = 0;
    if (placed.length) { const P = placed[0].verts;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++)
        S = Math.max(S, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])); }
    S = S || 1;
    const tol = (opts.tol == null ? 1e-6 : opts.tol) * S;
    // every distinct corner in the patch, deduplicated
    const pts = [], grid = new Map(), cell = Math.max(tol * 4, 1e-12);
    const key = (i, j) => i + ':' + j;
    for (const t of placed) for (const p of t.verts) {
      const gi = Math.floor(p[0] / cell), gj = Math.floor(p[1] / cell);
      let hit = false;
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) {
        const b = grid.get(key(gi + di, gj + dj)); if (!b) continue;
        for (const q of b) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < tol) { hit = true; break; }
      }
      if (hit) continue;
      const q = [p[0], p[1]]; pts.push(q);
      const k = key(gi, gj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q);
    }
    // A corner strictly interior to some edge, and not that edge's own endpoint.
    //
    // "Not an endpoint" MUST be tested as a DISTANCE, not on the normalised parameter u. u is
    // position/edge-length, so on a short edge a corner sitting a rounding error away from an
    // endpoint still gets u well above any small cutoff -- and is then counted as a T-junction.
    // With the u-based test this reported T-junctions on 163 of 403 ledger witnesses (40%);
    // with the distance test it reports essentially none, which is what John's experience said
    // all along ("I don't see the T-junctions often that you mention"). Every one of those 163
    // was a corner meeting an edge AT its endpoint, i.e. an ordinary shared vertex.
    let bad = 0;
    for (const t of placed) {
      const P = t.verts, n = P.length;
      for (let e = 0; e < n; e++) {
        const a = P[e], b = P[(e + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], len2 = ex * ex + ey * ey;
        if (len2 < tol * tol) continue;
        for (const p of pts) {
          if (Math.hypot(p[0] - a[0], p[1] - a[1]) < tol) continue;    // it IS this edge's start
          if (Math.hypot(p[0] - b[0], p[1] - b[1]) < tol) continue;    // ...or its end
          const u = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2;
          if (u <= 0 || u >= 1) continue;
          const dx = a[0] + u * ex - p[0], dy = a[1] + u * ey - p[1];
          if (Math.hypot(dx, dy) < tol) bad++;
        }
      }
    }
    return bad;
  }
  const isEdgeToEdge = (placed, opts) => tJunctions(placed, opts) === 0;

  // ---- does the boundary touch itself FATALLY? --------------------------------------
  // The rule is John's, 2026-09-06: "We only reject self intersection when it is an I curve or
  // the midpoint of an S curve." Everything else can be drawn around -- J and U edges bow their
  // whole span clear of an interior point, and an S edge is free everywhere EXCEPT its midpoint,
  // which buildCanon pins through (0.5, 0).
  //
  // This is not reimplemented here. TilerCore.boundaryTouch has done it all along, with a
  // tolerance measured rather than guessed (across 288 clean types the closest legitimate
  // vertex-to-edge approach is 1.9e-3, so 1e-4*scale sits ~19x below it). An earlier version of
  // this module ignored all of that and rejected any corner within 0.02 of the tile diameter of
  // any non-adjacent edge, whatever its type. That is wrong three ways over -- blind to edge type,
  // blind to WHERE on an S edge the corner lands, and an order of magnitude too coarse -- and it
  // rejected both shapes John built by hand and confirmed fit (#25512 m6 si0 off5, #72809 m8 si2
  // off1); on #72809 the discarded shape develops with zero overlap and the right vertex figure.
  function core() {
    if (typeof module !== 'undefined' && module.exports) { try { return require('./tiler_core.js'); } catch (e) { return null; } }
    return root.TilerCore || null;
  }
  function fatalTouch(A, L, m, edgeSym) {
    if (!edgeSym) return null;                        // cannot tell without the edge types
    const TC = core();
    if (!TC || !TC.boundaryTouch) return null;
    try { return TC.boundaryTouch(A, L, m || A.length, edgeSym); } catch (e) { return null; }
  }

  // ---- how close does the boundary come to itself? ------------------------------------
  // Smallest distance from any corner to any edge it is not an endpoint of, as a fraction of the
  // tile's diameter. INFORMATIONAL ONLY -- a small value is not a defect, because whether it can
  // be drawn around depends on the edge type, which this does not look at. Use fatalTouch to
  // decide anything. Kept because it is a useful thing to see and to rank on.
  function pinch(V) {
    const n = V.length;
    let S = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      S = Math.max(S, Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1]));
    if (!(S > 0)) return { rel: 0, at: null };
    let best = Infinity, at = null;
    for (let i = 0; i < n; i++) {
      const p = V[i];
      for (let e = 0; e < n; e++) {
        if (e === i || (e + 1) % n === i) continue;          // edges this corner is an endpoint of
        const a = V[e], b = V[(e + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
        if (l2 < 1e-18) continue;
        let u = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(a[0] + u * ex - p[0], a[1] + u * ey - p[1]);
        if (d < best) { best = d; at = 'v' + i + ' to edge ' + e; }
      }
    }
    return { rel: best / S, at };
  }

  // ---- how far a solved tile is from degenerate ---------------------------------------
  // CLAMP_FLOORS are solveTile's own length bounds. A length ratio sitting exactly on one is the
  // solver pinned against its bound, never geometry -- so it is reported separately from a merely
  // thin tile.
  //
  // Pass `edgeSym` whenever you have it. Without it the self-touch question CANNOT be answered,
  // and this reports `touchKnown: false` and does NOT reject on closeness -- refusing to guess is
  // the only honest option, and guessing is exactly what produced a run of false rejections.
  const CLAMP_FLOORS = [0.05, 0.02];
  function quality(A, L, flat, m, edgeSym) {
    let minA = 999;
    for (let i = 0; i < A.length; i++) {
      if (flat && (flat.has ? flat.has(i) : flat[i])) continue;
      const x = ((A[i] % 360) + 360) % 360;
      minA = Math.min(minA, x, 360 - x);
    }
    const mn = Math.min.apply(null, L), mx = Math.max.apply(null, L);
    const ratio = mx ? mn / mx : 0;
    // As an edge-length RATIO (John, 2026-09-13), not an absolute length: group 0 is pinned at 1,
    // so a length sitting on a floor only catches the short group shrinking. The same shape with
    // the sides switched -- the long group growing, #72758 at 791x -- never touches a floor.
    const onClamp = ratio <= Math.max(...CLAMP_FLOORS) + 1e-9;
    // ---- a zero angle between two EQUAL edges is a fold, and a fold is fatal ----------------
    //
    // John, 2026-09-10: "permanent zero angles are ok, but not when the edges are the same length."
    //
    // A zero angle folds the boundary back along itself. With edges of DIFFERENT length the longer
    // runs past the end of the shorter, so real boundary remains and a curve can open the sliver --
    // which is why a forced-flat angle is normally not fatal. With EQUAL edges the fold is exact:
    // the two edges coincide along their whole length and the vertices beyond them land on top of
    // each other. There is no sliver to open, and a curve cannot help, because matching edges share
    // an orbit and so carry the same curve -- it would have to occupy the same space twice.
    //
    // Verified against the four cases whose answer is known: #25514 and #25529 fold at three
    // corners each with both edges at exactly 0.122101 (John reads them as impossible), while
    // #209516 si7 (0.38 against 1.00) and #25543 si5 (0.30 against 1.00) have different lengths and
    // are confirmed good.
    const foldAt = [];
    {
      const n = m || A.length, sc = mx || 1;
      for (let i = 0; i < n; i++) {
        const a = ((A[i] % 360) + 360) % 360;
        if (!(a < 1 || a > 359)) continue;
        const before = L[(i - 1 + n) % n], after = L[i % n];
        if (Math.abs(before - after) / sc < 1e-6) foldAt.push(i);
      }
    }
    const foldFatal = foldAt.length > 0;
    // ---- two vertices in the same place -----------------------------------------------------
    //
    // solveTile tests this (relSep > MIN_VERTEX_SEP) but quality() did not, so every path that
    // builds a shape some other way -- closeConstrained, a stored witness, family sampling -- was
    // blind to it. That is how #208911 was offered as a candidate: its vertices 1 and 4 coincide
    // at EVERY point of its closing family, and quality() called it non-degenerate.
    //
    // John, 2026-09-10: "when I slide 208911, the vertices look like they coincide." They do.
    // Solved at a 1e-8 finite-difference step the gap between them is ~1e-16 of the tile, and at
    // one slider position exactly 0 -- refining the solve drives it to zero rather than settling
    // on a positive number, which is the signature of a real coincidence rather than solver noise.
    let vgap = Infinity, vgapAt = null;
    try {
      const n = m || A.length;
      const D2R = Math.PI / 180, vv = [[0, 0]];
      let hh = 0;
      for (let i = 0; i < n; i++) { const p = vv[i];
        vv.push([p[0] + L[i] * Math.cos(hh), p[1] + L[i] * Math.sin(hh)]);
        hh += Math.PI - A[(i + 1) % n] * D2R; }
      const sc = mx || 1;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(vv[i][0] - vv[j][0], vv[i][1] - vv[j][1]) / sc;
        if (d < vgap) { vgap = d; vgapAt = [i, j]; }
      }
    } catch (e) { vgap = Infinity; }
    const MIN_VERTEX_SEP = 1e-5;                 // same threshold solveTile uses
    const coincident = vgap < MIN_VERTEX_SEP;
    // the closest-approach number needs the actual polygon, so build it when m was not passed
    let pin = { rel: Infinity, at: null };
    try {
      const n = m || A.length;
      const D2R = Math.PI / 180, v = [[0, 0]];
      let h = 0;
      for (let i = 0; i < n; i++) { const p = v[i];
        v.push([p[0] + L[i] * Math.cos(h), p[1] + L[i] * Math.sin(h)]);
        h += Math.PI - A[(i + 1) % n] * D2R; }
      pin = pinch(v.slice(0, n));
    } catch (e) {}
    const touch = fatalTouch(A, L, m, edgeSym);

    // A small angle is FATAL only where the two edges meeting at it cannot bow apart. J, U and S
    // edges carry curves and can open a zero corner into a real one; an I edge is straight by
    // definition and cannot. John, 2026-09-08, comparing two combos that both force a zero angle
    // between U edges: "here the curves let us find a solution. I don't think that worked in
    // 3234." So #209516 m8 si7 (zero angle at v7, U on both sides) has a genuine curved solution
    // while #3234 m6 si8 does not -- and the difference is the rest of the configuration, not the
    // angle. Flagging every sub-3-degree corner blind to edge type is the same mistake the pinch
    // test made before the I/S rule replaced it.
    //
    // Without edgeSym the question cannot be answered, so the old blind rule is kept -- refusing
    // to guess is right, but so is saying which rule was used, hence spikeKnown.
    const I_EDGE = 2;
    let spikeFatal = minA < 3;
    if (minA < 3 && edgeSym) {
      const n = m || A.length;
      let fatal = false;
      for (let i = 0; i < n && !fatal; i++) {
        const x = ((A[i] % 360) + 360) % 360;
        if (Math.min(x, 360 - x) >= 3) continue;               // this corner is fine
        // vertex i is flanked by edge i-1 and edge i
        if (edgeSym[(i - 1 + n) % n] === I_EDGE && edgeSym[i] === I_EDGE) fatal = true;
      }
      spikeFatal = fatal;
    }
    return { minAngle: minA, edgeRatio: ratio, onClamp, foldFatal, foldAt,
             vertexGap: vgap, vertexGapAt: vgapAt, coincident,
             pinch: pin.rel, pinchAt: pin.at,
             touch, touchKnown: !!edgeSym, thin: ratio < 0.06,
             spike: minA < 3,                                   // the raw measurement, unchanged
             spikeFatal, spikeKnown: !!edgeSym,                 // the verdict, and whether it is informed
             pinched: !!touch,
             // WHY a shape was rejected, not just that it was. A rejection for "below my cutoff" and
             // one for "geometrically impossible" used to be recorded identically, which is the same
             // conflation that let searched_to_m default to 8. Keep the reason so a threshold can be
             // revisited later without re-running everything.
             degenerateWhy: [spikeFatal && 'spike', foldFatal && 'fold', coincident && 'coincidentVertices',
                             ratio < 0.06 && 'edgeRatio', onClamp && 'clamp', !!touch && 'touch'].filter(Boolean),
             degenerate: spikeFatal || foldFatal || coincident || ratio < 0.06 || onClamp || !!touch };
  }
  // Saturating desirability, used to rank family members: once a tile is comfortable in one
  // respect more of it buys nothing and the other term drives the choice.
  // Pinch is a factor, not a veto, so ranking prefers an open tile over a nearly-folded one even
  // when both clear the floor.
  // The pinch term saturates at 0.02, not 0.15. It expresses a mild preference for an open tile
  // over a nearly-folded one; it is NOT a rejection, and it must not be able to dominate. The old
  // 0.15 saturation made closeness worth as much as the angle and the edge ratio put together,
  // which is how shapes that are perfectly legal under the I/S rule got ranked out of contention.
  function score(q) {
    return Math.min(q.minAngle / 45, 1) * Math.min(q.edgeRatio / 0.5, 1)
         * Math.min((q.pinch == null ? 1 : q.pinch) / 0.02, 1);
  }

  const api = { orientation, interiorAngle, vertexFigure, wantedDegrees, figureMatches,
                tJunctions, isEdgeToEdge, pinch, fatalTouch,
                quality, score, CLAMP_FLOORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TilingChecks = api;
})(typeof window !== 'undefined' ? window : this);
