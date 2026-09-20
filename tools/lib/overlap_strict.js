// Strict overlap test for a developed patch — EXACT triangle-clip intersection area.
//
// History: the original version shrank each tile 2% toward its centroid, then checked
// polygon-pair intersection.  That is correct for CONVEX tiles but wrong for CONCAVE ones —
// every multi-segment edge produces a concave tile, and the centroid can sit in a notch or
// outside the shape entirely, so shrinking toward it pushes the boundary across a shared
// edge into a neighbour and invents overlaps that are not there.  Confirmed 2026-07-21:
// #72872 (John: "the tiling seemed to work, I didn't see any overlaps or gaps") scored 24
// under the old test and 0 under this one — ground truth (exact intersection area of every
// flagged pair) sides with John, not the old test.
//
// This version:
//   1. Triangulates the BASE m-gon once via ear-clipping.  Every placed tile is an affine
//      image of that same base polygon (develop() records each tile's placement transform
//      `T`), so its triangles are just the base triangles mapped through T — triangulate
//      once, reuse for all 100+ copies.  (Never re-triangulate a deep/far-placed copy
//      directly: composed transforms accumulate float error over many hops, and measuring
//      flatness on a noisy copy is unreliable — see the ear-clipping notes below.)
//   2. Intersection area of two tiles = sum over (triangle in A) x (triangle in B) of the
//      convex-convex clipped area (Sutherland-Hodgman).  Convex-convex clipping has none of
//      the concave-concave failure modes: a shared vertex or edge clips to a lower-dimension
//      sliver contributing ~0 area, never spurious positive area.
//
// Ear-clipping notes (both found on real ledger types, not synthetic cases):
//   - Multi-segment edges are built from FLAT (180 deg) sub-vertices — three consecutive
//     points EXACTLY collinear by construction of the angle system, not a rare occurrence.
//     "Convex + no vertex strictly inside" does not see a vertex sitting EXACTLY ON a
//     candidate ear's edge (neither strictly inside nor blocking), so it can accept an ear
//     that in fact overlaps the polygon's own next tooth.  Fixed by collapsing straight-
//     through (180 deg, dot>0) vertices before triangulating — removing them never changes
//     the polygon's shape.  Do NOT collapse a 0-degree vertex the same way: that is a real
//     zero-width spike (what the boundary-touch rule in tiler_core.js targets), and
//     removing it WOULD change the shape.  Distinguished by the sign of the dot product.
//   - "No vertex strictly inside the ear triangle" is also not a COMPLETE test: a long
//     non-adjacent edge can pass straight through the ear with both its endpoints outside
//     the ear triangle, entering one side and leaving another, and the vertex-inside test
//     never sees it.  Confirmed on a real case: an ear passed "no vertex inside" yet cutting
//     it left a genuinely self-intersecting remainder (shoelace area exactly 0, a bowtie).
//     Fixed by also requiring the ear's diagonal not cross any other edge of the polygon.
//   - Auditing this surfaced a separate, more consequential bug: 86 of 91 L1 winning configs
//     had a self-intersecting BASE m-gon — solveTile's acceptance test never checked this.
//     That is fixed at the source in tiler_core.js (polySelfIntersects); this file keeps a
//     defensive check too; on a self-intersecting base (should not occur post-fix, but the
//     shape has no well-defined inside/outside if it does), every pair is reported as
//     overlapping rather than silently trusting a meaningless triangulation.
//
// Loaded both in node (certify.js, require) and in the browser (mono2iso.html, plain
// <script> tag) -- same UMD pattern as tiler_core.js/tiler_curves.js, exposed there as
// window.OverlapStrict.  Wired into the "full tiling (developed)" view 2026-07-23: that
// view used to only check the single tile's self-crossing and the developed vertex
// figure, NEITHER of which can see two separate tiles physically overlapping in area --
// confirmed on #1727311, where a hand-edited combo passed both existing checks with no
// warning while sharing 49% of a tile's area with a neighbour four steps away.
(function (root) {
'use strict';

function cross(o, a, b) { return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]); }
function polyArea(v) { let s = 0; for (let i = 0; i < v.length; i++) { const q = v[(i+1)%v.length]; s += v[i][0]*q[1] - q[0]*v[i][1]; } return s / 2; }
// Does p block a candidate ear a-b-c?  This is the CLOSED triangle: a vertex lying exactly
// ON an edge of the ear blocks it just as surely as one strictly inside, because cutting
// that ear would slice the polygon through that vertex.  Its only caller is the ear test in
// `triangulate`, where the ear's own three corners are excluded by INDEX before we get here.
//
// This was `d1 > tol && d2 > tol && d3 > tol` ("strictly interior") and that is round 2's
// bug all over again -- see NOTES.md "Round 4".  Round 2 already recorded that the textbook
// ear test misses a vertex sitting exactly on an ear edge, but fixed only the case where
// that vertex is a FLAT 180-degree sub-vertex (via collapseStraight).  #25531 has a genuine
// corner that merely lands exactly on the ear's diagonal: w4=(1.2071,-0.9783) sits on the
// c->a edge of the first candidate ear with d3 EXACTLY 0, so strict `> tol` waved it
// through and the resulting triangulation over-covered the tile by 20%.  `diagonalClear` is
// no backstop either -- it only sees PROPER transversal crossings, and this is a tangential
// touch at a shared endpoint.
function pointBlocksEar(p, a, b, c, tol) {
  const d1 = cross(a,b,p), d2 = cross(b,c,p), d3 = cross(c,a,p);
  return d1 >= -tol && d2 >= -tol && d3 >= -tol;       // CLOSED triangle: on an edge counts
}
// Does segment p1-p2 properly cross p3-p4 (a genuine transversal intersection, not just
// touching an endpoint)?  t,u are the intersection's position along each segment as a
// FRACTION (0..1), so `tol` here is a fraction, not a length -- correct at any polygon scale.
function segProperCross(p1, p2, p3, p4, tol) {
  const r=[p2[0]-p1[0],p2[1]-p1[1]], s=[p4[0]-p3[0],p4[1]-p3[1]];
  const den = r[0]*s[1]-r[1]*s[0];
  if (Math.abs(den) < 1e-14) return false;             // parallel/collinear: not a transversal crossing
  const qp=[p3[0]-p1[0],p3[1]-p1[1]];
  const t=(qp[0]*s[1]-qp[1]*s[0])/den, u=(qp[0]*r[1]-qp[1]*r[0])/den;
  return t>tol && t<1-tol && u>tol && u<1-tol;
}
function diagonalClear(v, i, tol) {
  const n = v.length, a = v[(i-1+n)%n], c = v[(i+1)%n];
  for (let k = 0; k < n; k++) {
    if (k === (i-1+n)%n || k === i) continue;          // edges touching vertex i share an endpoint, not a crossing
    if (segProperCross(a, c, v[k], v[(k+1)%n], tol)) return false;
  }
  return true;
}
function collapseStraight(poly, angTol) {
  let v = poly.slice();
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i-1+v.length)%v.length], b = v[i], c = v[(i+1)%v.length];
      const abx=b[0]-a[0], aby=b[1]-a[1], bcx=c[0]-b[0], bcy=c[1]-b[1];
      const la=Math.hypot(abx,aby), lb=Math.hypot(bcx,bcy);
      if (la<1e-15 || lb<1e-15) { v.splice(i,1); changed=true; break; }   // duplicate point
      const sinA=(abx*bcy-aby*bcx)/(la*lb), dot=abx*bcx+aby*bcy;
      if (Math.abs(sinA) < angTol && dot > 0) { v.splice(i,1); changed=true; break; }
    }
  }
  return v;
}
function triangulate(poly, tol) {
  let v = collapseStraight(poly, 1e-9);
  if (polyArea(v) < 0) v.reverse();                    // ear-clip needs CCW
  const tris = [];
  let guard = 0;
  while (v.length > 3 && guard++ < 4 * poly.length + 50) {
    let cut = -1;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i-1+v.length)%v.length], b = v[i], c = v[(i+1)%v.length];
      if (cross(a, b, c) <= tol) continue;              // reflex or flat: not an ear
      let clear = true;
      for (let j = 0; j < v.length; j++) {
        if (j===i || j===(i-1+v.length)%v.length || j===(i+1)%v.length) continue;
        if (pointBlocksEar(v[j], a, b, c, tol)) { clear = false; break; }
      }
      if (clear && !diagonalClear(v, i, 1e-9)) clear = false;   // catch an edge slicing through with no endpoint inside
      if (clear) { cut = i; break; }
    }
    if (cut < 0) break;                                 // shouldn't happen for a simple polygon
    const a = v[(cut-1+v.length)%v.length], b = v[cut], c = v[(cut+1)%v.length];
    tris.push([a, b, c]);
    v.splice(cut, 1);
  }
  if (v.length === 3) tris.push([v[0], v[1], v[2]]);
  return tris;
}
function clipConvex(subj, clip, tol) {
  let out = subj;
  for (let e = 0; e < clip.length && out.length; e++) {
    const a = clip[e], b = clip[(e+1)%clip.length];
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i-1+inp.length)%inp.length];
      const curIn = cross(a,b,cur) >= -tol, prevIn = cross(a,b,prev) >= -tol;
      if (curIn) { if (!prevIn) out.push(segIntersect(prev,cur,a,b)); out.push(cur); }
      else if (prevIn) out.push(segIntersect(prev,cur,a,b));
    }
  }
  return out;
}
function segIntersect(p1,p2,p3,p4) {
  const r=[p2[0]-p1[0],p2[1]-p1[1]], s=[p4[0]-p3[0],p4[1]-p3[1]];
  const den = r[0]*s[1]-r[1]*s[0];
  if (Math.abs(den) < 1e-15) return p1;                // near-parallel clip edge: degenerate, harmless
  const t = ((p3[0]-p1[0])*s[1]-(p3[1]-p1[1])*s[0]) / den;
  return [p1[0]+t*r[0], p1[1]+t*r[1]];
}
const ap = (T, p) => [T[0]*p[0]+T[1]*p[1]+T[4], T[2]*p[0]+T[3]*p[1]+T[5]];

function polySelfIntersects(v) {
  const m = v.length;
  const o = (a, b, c) => Math.sign((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]));
  for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
    if (i === 0 && j === m - 1) continue;
    const p1=v[i], p2=v[(i+1)%m], p3=v[j], p4=v[(j+1)%m];
    const d1=o(p3,p4,p1), d2=o(p3,p4,p2), d3=o(p1,p2,p3), d4=o(p1,p2,p4);
    if (d1!==d2 && d3!==d4 && d1 && d2 && d3 && d4) return true;
  }
  return false;
}
// Prepare the base shape ONCE: its triangulation (as CCW triangles) + its own area.
function prepShape(basePoly) {
  if (polySelfIntersects(basePoly)) return { invalid: true, area: Math.abs(polyArea(basePoly)) };
  const area = Math.abs(polyArea(basePoly));
  const tol = 1e-9 * Math.max(area, 1e-9);
  const tris = triangulate(basePoly, tol).map(t => polyArea(t) < 0 ? [t[0], t[2], t[1]] : t);
  return { tris, area, tol };
}
function pairOverlapArea(shape, T1, T2) {
  const t1 = shape.tris.map(t => t.map(p => ap(T1, p)));
  const t2 = shape.tris.map(t => t.map(p => ap(T2, p)));
  let s = 0;
  for (const a of t1) for (const b of t2) {
    const c = clipConvex(a, b, shape.tol);
    if (c.length >= 3) s += Math.abs(polyArea(c));
  }
  return s;
}
function bbox(v) { let a=1/0,b=-1/0,c=1/0,d=-1/0; for (const p of v) { if(p[0]<a)a=p[0]; if(p[0]>b)b=p[0]; if(p[1]<c)c=p[1]; if(p[1]>d)d=p[1]; } return [a,b,c,d]; }

/** -> number of overlapping tile PAIRS (0 means the patch is clean).
 * frac is a NOISE FLOOR, not a slack allowance.
 *
 * It was 1e-6, justified as "a genuine closing tiling closes to ~1e-9 or better". That
 * reasoning is about the TILE's own closing gap, but this threshold is applied to PLACED
 * copies, whose positions come from composing a chain of gluing transforms out across the
 * patch -- and that error accumulates with distance from the origin, reaching ~1e-4 of a
 * tile's area at 260 tiles. So 1e-6 sat below the noise it was meant to reject and flagged
 * float slivers between genuinely adjacent tiles as overlaps.
 *
 * 1e-3 is chosen by measurement over all 11 L1 types: their worst pair is either ~1e-5
 * (#25531: 2.3e-5, #25539: 9.6e-5 -- pure noise, no stacking) or ~1.0 (the other nine,
 * where develop legitimately stacks a degenerate tile on itself). A four-decade gap, so any
 * threshold inside it separates noise from defect; 1e-3 is central. The 383 clean
 * (hand/L3/L2) types are unaffected -- they report exactly 0 pairs over 1e-6 already, so
 * raising the floor cannot change them. */
function overlapStrict(placed, frac = 1e-3) {
  if (!placed.length) return 0;
  const shape = prepShape(placed[0].verts);
  if (shape.invalid) return placed.length * (placed.length - 1) / 2;   // self-intersecting base: not a tile at all
  const boxes = placed.map(t => bbox(t.verts));
  const thresh = frac * shape.area;
  let bad = 0;
  for (let i = 0; i < placed.length; i++) for (let j = i+1; j < placed.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
    if (pairOverlapArea(shape, placed[i].T, placed[j].T) > thresh) bad++;
  }
  return bad;
}

const api = { overlapStrict, pairOverlapArea, prepShape, triangulate, clipConvex, polyArea, polySelfIntersects };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.OverlapStrict = api;
})(typeof window !== 'undefined' ? window : this);
