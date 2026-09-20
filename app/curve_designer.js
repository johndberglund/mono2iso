// Design a curve for a tile whose straight boundary is too tight to draw well.
//
// This is John's hand method, made mechanical. John, 2026-09-09: "I pull a control point to make
// sure that the edge curves around the vertex that is in the way. I look where this makes other
// edges cross or get close to each other. I try to make sure that no part of the tile gets pinched
// too narrow."
//
// Those three checks are one measurement in three places: the SEPARATION of the curved boundary
// from itself. A corner sitting on an edge, two edges drifting together, and a neck getting thin
// are all "two non-adjacent parts of the boundary are close". So the objective is simply to push
// that minimum separation up, subject to two hard constraints: the boundary must not cross itself,
// and the developed tiling must not overlap.
//
// The optimisation runs on the STORED half-curve, not the drawn one. buildCanon mirrors it -- U to
// (1-x, y), S to (1-x, -y) -- so whatever the search does, the symmetry the edge type requires is
// reconstructed rather than assumed. Matching edges share an orbit and therefore the same curve, so
// the tiling cannot be broken by editing control points; only the drawing can get better or worse.
(function (root) {
  'use strict';
  const N = (typeof module !== 'undefined' && module.exports);
  const TCurves = N ? require('./tiler_curves.js') : root.TilerCurves;
  const OS = N ? require('./overlap_strict.js') : root.OverlapStrict;

  // ---- separation of a closed polyline from itself -----------------------------------------
  // Minimum distance between two segments that are not neighbours in the walk, as a fraction of
  // the boundary's diameter. Zero means they touch or cross.
  function segDist(p, q, r, s) {
    const d = (a, b, c) => {                       // point c to segment a-b
      const ex = b[0]-a[0], ey = b[1]-a[1], l2 = ex*ex + ey*ey;
      let t = l2 > 0 ? ((c[0]-a[0])*ex + (c[1]-a[1])*ey) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(a[0] + t*ex - c[0], a[1] + t*ey - c[1]);
    };
    const o = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    const o1 = o(p,q,r), o2 = o(p,q,s), o3 = o(r,s,p), o4 = o(r,s,q);
    const near = Math.min(d(p,q,r), d(p,q,s), d(r,s,p), d(r,s,q));
    // SIGNED, and that matters. Returning a flat 0 for every crossing gave the search no gradient
    // to descend: a curve whose boundary crosses itself scored 0 and so did every small pull of a
    // control point, so it sat there reporting 0.0000 -- which is what stalled #209080 si4, #209087
    // si4 and #209099 si4 at exactly the demo curve. This is the same trap as climbing a product
    // score that is zero at the start. Past the crossing, -near measures how deeply the two
    // segments have gone through each other, and it passes continuously through 0 as they separate.
    // COLLINEAR GUARD. With p,q,r,s on one line every orientation is ~0 and its SIGN is rounding
    // noise, so a bare > 0 test called parallel, far-apart segments a deep crossing: on #25523 m8
    // si81 two straight edges on one line 0.72 apart scored -0.72, and 17 gallery tiles looked
    // self-crossing that are not. Same bug curveSelfCross in gen_gallery.js had and fixed. Signs
    // inside a scale-aware tolerance count as zero; a proper crossing needs a STRICT sign change on
    // both segments. An endpoint lying on the other segment is then a touch (near = 0), as it should be.
    const S = Math.max(Math.abs(q[0]-p[0]), Math.abs(q[1]-p[1]), Math.abs(s[0]-r[0]), Math.abs(s[1]-r[1]),
                       Math.abs(r[0]-p[0]), Math.abs(r[1]-p[1])) || 1;
    const eps = 1e-9 * S * S;
    const sg = x => (x > eps ? 1 : x < -eps ? -1 : 0);
    if (sg(o1) * sg(o2) < 0 && sg(o3) * sg(o4) < 0) return -near;   // a proper crossing
    return near;
  }
  function separation(ring) {
    // curvedTile returns a CLOSED ring with the first point repeated at the end. Left in place,
    // that duplicate adds a zero-length final segment and shifts the adjacency test, so the first
    // segment and the one ending at the duplicate read as non-adjacent at distance zero -- which
    // scored EVERY tile at 0.0000, including curves John drew and verified by hand. Normalise to
    // distinct points and treat the list as cyclic.
    const pts = (pts0 => {
      if (pts0.length > 1) {
        const a = pts0[0], b = pts0[pts0.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-12) return pts0.slice(0, -1);
      }
      return pts0;
    })(ring);
    const n = pts.length;
    let diam = 0;
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++)
      diam = Math.max(diam, Math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1]));
    if (!(diam > 0)) return { rel: 0, diam: 0 };
    let best = Infinity;
    // skip immediate neighbours: consecutive segments always meet, that is not a defect
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i+1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = pts[j], d2 = pts[(j+1) % n];
        const s = segDist(a, b, c, d2);
        if (s < best) best = s;
      }
    }
    return { rel: best / diam, diam };
  }

  // ---- the editable parameters ---------------------------------------------------------------
  // Stored form (see extractStorablePts in tilerTest.js): J keeps the whole curve and pins both
  // ends; U and S keep only x<=0.5 plus a fold point AT x=0.5, and S additionally forces that
  // fold's y to 0 because an S edge is point-symmetric about its midpoint. So the free numbers are
  // the interior points, plus the fold's y for U.
  function freeIndices(type, pts) {
    const idx = [];
    for (let i = 1; i < pts.length - 1; i++) idx.push({ i, x: true, y: true });
    const last = pts.length - 1;
    if (type === 'U') idx.push({ i: last, x: false, y: true });   // fold height is free for U
    return idx;                                                    // S fold y stays 0; J ends pinned
  }

  /** Optimise one orbit's curve.
   *  build(pts) -> { boundary: [[x,y]...], ok: bool }   caller supplies how to draw and validate.
   *  OR build(pts) -> { score: number }  when the caller wants to supply its own objective
   *  directly (tile_designer.js's stage 3 does this: separation once clean, then a secondary
   *  term for corner angles -- there is no overlap test to gate on any more, so `ok`/`boundary`
   *  don't apply). A `score` result is used as-is; higher is always better in both forms.
   *  Returns { pts, sep, tries } or null if nothing beat the start. */
  function designCurve(type, startPts, build, opts) {
    opts = opts || {};
    const XLO = opts.xlo == null ? 0.06 : opts.xlo;
    const XHI = opts.xhi == null ? 0.94 : opts.xhi;
    // 0.45 was too tight: John's clearing U curve on #25521 m8 si17 folds at y = -0.495 (2026-09-13)
    const YMAX = opts.ymax == null ? 0.7 : opts.ymax;
    // One score for both phases. Rejecting an infeasible start outright was wrong: the combos that
    // most need a designed curve are exactly the ones whose DEMO motif already overlaps, and John's
    // method starts there -- pull a point, see if the crossing opens, pull again. So while the
    // tiling still overlaps, score the badness (negative, improving toward 0) and climb out of it;
    // the moment it is clean, switch to the separation objective. The +1 offset keeps every clean
    // curve above every broken one, so the search can never trade feasibility for separation.
    const evalPts = pts => {
      const r = build(pts);
      if (!r) return null;
      if (typeof r.score === 'number') return r.score;
      if (!r.boundary) return null;
      if (r.ok) return 1 + separation(r.boundary).rel;
      const bad = (r.pairs == null ? 1 : r.pairs) + (r.worstFrac || 0);
      return -bad;
    };
    let cur = startPts.map(p => p.slice());
    let best = evalPts(cur);
    if (best == null) return null;                 // cannot even be drawn
    const free = freeIndices(type, cur);
    if (!free.length) return { pts: cur, sep: best > 0 ? best - 1 : 0, ok: best > 0, tries: 0 };
    let tries = 0;
    for (let step = 0.12, it = 0; step > 2e-3 && it < (opts.maxIt || 300); it++) {
      let moved = false;
      for (const f of free) {
        for (const axis of (f.x ? ['x', 'y'] : ['y'])) {
          for (const dir of [1, -1]) {
            const cand = cur.map(p => p.slice());
            const k = axis === 'x' ? 0 : 1;
            cand[f.i][k] += dir * step;
            if (axis === 'x') {
              const lim = type === 'J' ? XHI : 0.5 - 1e-3;
              cand[f.i][0] = Math.max(XLO, Math.min(lim, cand[f.i][0]));
              // keep the control points in order along the edge
              if (cand[f.i][0] <= cand[f.i-1][0] + 1e-4) continue;
              if (f.i + 1 < cand.length && cand[f.i][0] >= cand[f.i+1][0] - 1e-4) continue;
            } else {
              cand[f.i][1] = Math.max(-YMAX, Math.min(YMAX, cand[f.i][1]));
            }
            tries++;
            const s = evalPts(cand);
            if (s != null && s > best + 1e-9) { best = s; cur = cand; moved = true; }
          }
        }
      }
      if (!moved) step /= 2;
    }
    return { pts: cur, sep: best > 0 ? best - 1 : 0, ok: best > 0, tries };
  }

  // A start that leaves the corner AT AN ANGLE, not flat along the chord. Every default motif
  // (MOTIF_BANK in tiler_curves.js) starts flat -- [0,0] then a point with y=0 -- which is fine
  // for a healthy corner but means coordinate descent can never open a 0-degree corner: the first
  // step off y=0 is not downhill on separation when the whole curve still sits on the collapsed
  // chord, plane, so it never moves. Modelled on John's own fix for exactly this, his U curve on
  // #209194: [[0,0],[0.147,0.138],[0.5,0.140]] -- a small immediate rise, then coasting roughly
  // level. `sign` chooses which side of the baseline to bow toward (canonical +y or -y); the
  // caller tries both because which side is "away from the pinch" depends on the corner, not the
  // type, and is cheap to search rather than derive.
  // `amp` scales the whole seed (default 1): a small rise is not always enough -- John's #25521 m8
  // si17 curve swings to half an edge-length off its chord.
  function angledSeed(type, sign, amp) {
    const s = (sign < 0 ? -1 : 1) * (amp || 1);
    if (type === 'J') return [[0, 0], [0.15, 0.14 * s], [0.5, 0.18 * s], [0.85, 0.14 * s], [1, 0]];
    if (type === 'U') return [[0, 0], [0.15, 0.14 * s], [0.5, 0.14 * s]];
    if (type === 'S') return [[0, 0], [0.15, 0.14 * s], [0.35, 0.12 * s], [0.5, 0]];
    return [[0, 0], [1, 0]];                        // I: no curve possible
  }

  // Add a control point where the boundary is tightest, so the search has something to pull.
  // A two-point curve (a straight edge) has no interior point at all and cannot bend.
  function seedPoints(type, pts, count) {
    count = count || 3;
    let out = pts.map(p => p.slice());
    const end = out.length - 1;
    while (out.length - 2 < count) {
      let wi = 0, wd = -1;
      for (let i = 0; i < out.length - 1; i++) {
        const d = out[i+1][0] - out[i][0];
        if (d > wd) { wd = d; wi = i; }
      }
      out.splice(wi + 1, 0, [(out[wi][0] + out[wi+1][0]) / 2, (out[wi][1] + out[wi+1][1]) / 2]);
    }
    return out;
  }

  const api = { designCurve, separation, segDist, freeIndices, seedPoints, angledSeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CurveDesigner = api;
})(typeof window !== 'undefined' ? window : this);
