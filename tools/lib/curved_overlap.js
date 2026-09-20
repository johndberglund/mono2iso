// Overlap test for CURVED tiles -- the boundary as drawn, not the straight skeleton.
//
// Needed because the skeleton is only a proxy. A tile whose curves open a corner the family forces
// to zero degrees looks self-touching as a polygon: prepShape calls it invalid and overlapStrict
// returns "not a tile at all", about a tiling it never looked at. That happened to John's #209516
// and #209194, both of which are perfectly good once the U and S curves are drawn. The same proxy
// error bit the reduce check and the gallery overlap test earlier the same day, so this is the
// third time -- worth a module rather than another workaround.
//
// AREA-based, deliberately. Neighbouring tiles share their common edge curve EXACTLY, so their
// boundaries are coincident polylines; a segment-crossing test drowns in that (an earlier attempt
// flagged 336 of 472 gallery combos). Shared boundaries contribute no AREA, so an area test is
// immune to it, and only a real bulge collision registers.
(function (root) {
  'use strict';
  const OS = (typeof module !== 'undefined' && module.exports)
    ? require('./overlap_strict.js') : root.OverlapStrict;

  const bbox = v => { let a = 1/0, b = -1/0, c = 1/0, d = -1/0;
    for (const p of v) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0];
                         if (p[1] < c) c = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };

  // Triangulate once per tile; the curved outlines differ from tile to tile (each is a transformed
  // copy but we are handed coordinates, not transforms), so there is no single shared shape to reuse.
  function prep(pts) {
    const area = Math.abs(OS.polyArea(pts));
    const tol = 1e-9 * Math.max(area, 1e-9);
    const tris = OS.triangulate(pts, tol).map(t => OS.polyArea(t) < 0 ? [t[0], t[2], t[1]] : t);
    return { tris, area, tol, box: bbox(pts) };
  }
  function pairArea(A, B) {
    let s = 0;
    for (const a of A.tris) for (const b of B.tris) {
      const c = OS.clipConvex(a, b, A.tol);
      if (c.length >= 3) s += Math.abs(OS.polyArea(c));
    }
    return s;
  }

  /** draw = [{orbit, pts}] straight from TilerCurves.buildCurvedTiles.
   *  -> { pairs, worstFrac, tiles, selfIntersecting }  pairs === 0 means the drawn tiling is clean. */
  // Threshold is 1% of a tile, not the 1e-3 the STRAIGHT test uses. Neighbouring curved tiles share
  // their common edge curve exactly, but each tile's boundary is sampled into a polyline
  // independently, so on a convex stretch one tile's chord cuts inside where the other's cuts
  // outside, leaving a sliver of genuine polyline overlap that no amount of correctness removes.
  // Measured separation on real data: John's hand-drawn #25528 m7 si2, which he built to work and
  // which has ZERO self-intersecting tiles, sits at 0.21% at every patch size; the two #25643
  // entries that are genuinely broken sit at 2.6% and 4.3%. An order of magnitude clear on both
  // sides, so 1% sits in the gap. Judging hand-drawn curves at 0.1% rejected work that was correct.
  function overlapCurved(draw, frac) {
    frac = frac == null ? 1e-2 : frac;
    if (!draw || draw.length < 2) return { pairs: 0, worstFrac: 0, tiles: draw ? draw.length : 0 };
    const P = draw.map(t => prep(t.pts));
    // A curved tile that crosses ITSELF is a separate defect; report it rather than folding it in.
    let selfX = 0;
    for (const t of draw) if (OS.polySelfIntersects(t.pts)) selfX++;
    const meanArea = P.reduce((s, p) => s + p.area, 0) / P.length;
    const thresh = frac * meanArea;
    let pairs = 0, worst = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i].box, b = P[j].box;
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;   // bbox cull
      const ov = pairArea(P[i], P[j]);
      if (ov > thresh) { pairs++; worst = Math.max(worst, ov / meanArea); }
    }
    return { pairs, worstFrac: worst, tiles: draw.length, selfIntersecting: selfX, meanArea };
  }

  const api = { overlapCurved, prep, pairArea };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CurvedOverlap = api;
})(typeof window !== 'undefined' ? window : this);
