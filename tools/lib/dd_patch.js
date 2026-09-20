// Combinatorial development: the tiles around a root tile, and who is glued to whom, built from
// the DD data alone -- sideTables(netEdgeData), the tile symmetries (netEdgeData rows 0-1, via
// tile_symmetry.js) and the angle equations -- with no coordinates.
//
// John, 2026-09-13: "The only time we need to develop the tiling is if we are drawing it. We
// should be able to find it in DD or netEdgeData[]." develop() places copies numerically and
// decides "have I placed this tile already?" by centroid proximity. Here two copies are the SAME
// tile only when they are proved to sit at the same corner of the same vertex with the same
// orientation, up to the tile's own symmetry: a tile with a symmetry in the tiling (every
// unbalanced type, and #3196) has several valid side numberings, and sideTables then glues two
// different sides onto one partner side. Each tile keeps ONE stored numbering; every link records
// the partner's side in the partner's stored numbering, so walks never re-read the side table.
//
// Tile frames: {phi, r, orbit} -- edge j of the copy points along phi + r*d_j (angle_algebra).
// A relabelling sigma (tile_symmetry.js): copy F*sigma has its vertex j at F's vertex sv(j).
(function (root) {
  'use strict';
  const N = typeof module !== 'undefined' && module.exports;
  const AA = N ? require('./angle_algebra.js') : root.AngleAlgebra;
  const TS = N ? require('./tile_symmetry.js') : root.TileSymmetry;
  const mod = (x, m) => ((x % m) + m) % m;
  const ID = { kind: 'rot', t: 0 };

  const composeFrame = (F, s) => ({ phi: AA.add(F.phi, AA.scale(s.fr.phi, F.r)), r: F.r * s.fr.r, orbit: F.orbit });
  // The sigma in the orbit's group with W = S*sigma, or null.
  function relate(P, W, S) {
    if (W.orbit !== S.orbit) return null;
    for (const s of P.groups[S.orbit]) {
      if (W.r !== S.r * s.fr.r) continue;
      const C = composeFrame(S, s);
      if (AA.test(P.ctx.sys, AA.sub(W.phi, C.phi), 0) === 'proved') return s;
    }
    return null;
  }
  // Walking the side table from a frame: crossing `side` at `corner` (one end of it).
  function crossAt(ctx, m, fr, side, corner) {
    const tb = ctx.tbl[fr.orbit];
    const to = tb.to[side], nm = tb.map[side], swap = nm === 1 || nm === 3;
    return { to, corner: mod((side === corner) !== swap ? to : to + 1, m) };
  }
  const otherSide = (m, side, corner) => (side === corner ? mod(corner - 1, m) : corner);
  const sideOf = (s, j, m) => TS.sideOf(s, j, m);
  const vertexOf = (s, j, m) => TS.vertexOf(s, j, m);

  /** One full turn around the vertex at corner c of a copy with frame fr: steps[k] = {fr, corner,
   *  out, back}, in the WALK's own numbering. Closes when a copy is proved to be the start tile
   *  up to its symmetry, with the matching corner at the vertex. */
  function starOf(P, fr, c) {
    const { ctx, m } = P, steps = [];
    let cur = fr, corner = c, out = c;
    for (let guard = 0; guard < 1000; guard++) {
      const x = crossAt(ctx, m, cur, out, corner);
      const nfr = AA.glue(ctx, cur, out);
      steps.push({ fr: cur, corner, out, back: x.to });
      const s = relate(P, nfr, fr);
      if (s && vertexOf(s, x.corner, m) === c) return steps;
      cur = nfr; corner = x.corner; out = otherSide(m, x.to, x.corner);
    }
    return null;
  }

  function addTile(P, fr, dist) {
    const m = P.m;
    P.tiles.push({ fr, nb: new Array(m).fill(-1), nbSide: new Array(m).fill(-1), nbSwap: new Array(m).fill(false),
                   vid: new Array(m).fill(-1), dist, rep: -1 });
    return P.tiles.length - 1;
  }
  const find = (P, x) => { while (P.tiles[x].rep >= 0) x = P.tiles[x].rep; return x; };
  // Whether a shared edge's ends are swapped: side sa of a and side sb of b point opposite ways.
  function swapOf(P, a, sa, b, sb) {
    const A = P.tiles[a].fr, B = P.tiles[b].fr;
    const da = AA.add(A.phi, AA.scale(P.ctx.d[sa], A.r)), db = AA.add(B.phi, AA.scale(P.ctx.d[sb], B.r));
    const v = AA.test(P.ctx.sys, AA.sub(da, db), 180);
    if (v === 'proved') return true;
    if (AA.test(P.ctx.sys, AA.sub(da, db), 0) !== 'proved') P.conflicts++;
    return false;
  }
  function setLink(P, a, sa, b, sb) {
    const T = P.tiles[a];
    T.nb[sa] = b; T.nbSide[sa] = sb; T.nbSwap[sa] = swapOf(P, a, sa, b, sb);
  }
  // Two ids are one tile (proved by a vertex star). Fold b into a, translating b's numbering.
  function merge(P, a, b) {
    const work = [[a, b]];
    while (work.length) {
      let [x, y] = work.pop(); x = find(P, x); y = find(P, y);
      if (x === y) continue;
      if (y < x) { const t = x; x = y; y = t; }
      const X = P.tiles[x], Y = P.tiles[y];
      const s = relate(P, Y.fr, X.fr);           // Y = X*s: Y's side j is X's side sideOf(s, j)
      if (!s) { P.conflicts++; continue; }
      Y.rep = x; P.merges++;
      X.dist = Math.min(X.dist, Y.dist);
      for (let j = 0; j < P.m; j++) {
        const xs = sideOf(s, j, P.m), xv = vertexOf(s, j, P.m);
        if (X.vid[xv] < 0) X.vid[xv] = Y.vid[j];
        if (Y.nb[j] < 0) continue;
        if (X.nb[xs] < 0) setLink(P, x, xs, Y.nb[j], Y.nbSide[j]);
        else if (find(P, X.nb[xs]) !== find(P, Y.nb[j])) work.push([X.nb[xs], Y.nb[j]]);
      }
      // links INTO y now point into x, with the side translated into x's numbering
      P.tiles.forEach((T, id) => {
        if (T.rep >= 0) return;
        for (let j = 0; j < P.m; j++) if (T.nb[j] === y) setLink(P, id, j, x, sideOf(s, T.nbSide[j], P.m));
      });
    }
  }
  function link(P, a, sa, b, sb) {
    a = find(P, a); b = find(P, b);
    const cur = P.tiles[a].nb[sa];
    if (cur >= 0 && find(P, cur) !== b) merge(P, cur, b);
    a = find(P, a); b = find(P, b);
    setLink(P, a, sa, b, sb);
  }

  /** Close the vertex star at corner c of tile x: identify the copies already known around it
   *  (walking both ways through known links), create the missing ones, and link them all -- every
   *  index translated from the walk's numbering into each tile's stored numbering. */
  function closeStar(P, x, c) {
    const m = P.m;
    x = find(P, x);
    if (P.tiles[x].vid[c] >= 0) return true;
    const steps = starOf(P, P.tiles[x].fr, c);
    if (!steps) { P.failedStars++; return false; }
    const d = steps.length, pos = new Array(d).fill(-1);
    pos[0] = x;
    // The walk comes back to the start tile possibly under its OTHER numbering: copy d is
    // start*sigma_close, not start itself. So copy d gets its own frame, and every reference to
    // "the copy after the last one" relates THAT frame to the stored tile.
    const frD = AA.glue(P.ctx, steps[d - 1].fr, steps[d - 1].out);
    const frameAt = k => (k < d ? steps[k].fr : frD);
    const idAt = k => find(P, pos[k % d]);
    // A merge can fold a tile into another with a different stored numbering, so the walk-to-
    // stored relabelling is re-derived from the frames at every use, never cached.
    const sigAt = k => (pos[k % d] < 0 ? null : relate(P, frameAt(k), P.tiles[idAt(k)].fr));
    const place = (k, id) => {                       // walk copy k is stored tile id
      pos[k] = find(P, id);
      if (sigAt(k)) return true;
      P.conflicts++; pos[k] = -1; return false;
    };
    for (let k = 0; k + 1 < d; k++) {                // forward through known links
      const T = P.tiles[idAt(k)], so = sideOf(sigAt(k), steps[k].out, m);
      if (T.nb[so] < 0 || !place(k + 1, T.nb[so])) break;
    }
    for (let k = d - 1; k > 0; k--) {                // backward: copy k lies behind copy k+1's side `back`
      const s = sigAt(k + 1);
      if (!s) break;
      const nx = P.tiles[idAt(k + 1)].nb[sideOf(s, steps[k].back, m)];
      if (nx < 0) break;
      if (pos[k] >= 0 && find(P, pos[k]) !== find(P, nx)) merge(P, pos[k], nx);
      if (!place(k, nx)) break;
    }
    const base = P.tiles[x].dist;
    for (let k = 1; k < d; k++) if (pos[k] < 0) pos[k] = addTile(P, steps[k].fr, base + 1);
    const vid = P.nVertices++;
    P.starSize[vid] = d;                              // tiles (corners) meeting at this vertex
    for (let k = 0; k < d; k++) {
      let s0 = sigAt(k), s1 = sigAt(k + 1);
      if (!s0 || !s1) { P.conflicts++; continue; }
      link(P, idAt(k), sideOf(s0, steps[k].out, m), idAt(k + 1), sideOf(s1, steps[k].back, m));
      s0 = sigAt(k); s1 = sigAt(k + 1);
      if (!s0 || !s1) { P.conflicts++; continue; }
      link(P, idAt(k + 1), sideOf(s1, steps[k].back, m), idAt(k), sideOf(s0, steps[k].out, m));
      s0 = sigAt(k);
      if (!s0) { P.conflicts++; continue; }
      const t = P.tiles[find(P, pos[k])], cv = vertexOf(s0, steps[k].corner, m);
      if (t.vid[cv] < 0) t.vid[cv] = vid;
    }
    return true;
  }

  /** ctx from AngleAlgebra.makeContext(eqs, m, sideTables(...)); groups[orbit] from
   *  TileSymmetry.groupsFor(ctx, cfg, m).groups (identity-only when omitted). */
  function create(ctx, m, groups) {
    const idG = [{ ...ID, fr: TS.frameOf(ctx, ID, m) }];
    const P = { ctx, m, groups: groups || [idG, idG], tiles: [], nVertices: 0, starSize: [], merges: 0, conflicts: 0, failedStars: 0, grownTo: 0 };
    addTile(P, { phi: AA.K(ctx.sys, 0), r: 1, orbit: 0 }, 0);
    return P;
  }
  function bfsDist(P) {
    const d = new Array(P.tiles.length).fill(Infinity);
    d[0] = 0;
    const q = [0];
    for (let h = 0; h < q.length; h++) {
      const x = q[h];
      for (const y0 of P.tiles[x].nb) {
        if (y0 < 0) continue;
        const y = find(P, y0);
        if (d[y] > d[x] + 1) { d[y] = d[x] + 1; q.push(y); }
      }
    }
    return d;
  }
  /** Close every vertex star of every tile closer than R steps to the root (re-measuring the
   *  distances each pass). Afterwards every tile within R-1 steps has all its links and vertices. */
  function grow(P, R) {
    for (let pass = 0; pass < 64; pass++) {
      const dist = bfsDist(P);
      let did = false;
      for (let x = 0; x < P.tiles.length; x++) {
        if (P.tiles[x].rep >= 0 || !(dist[x] < R)) continue;
        for (let c = 0; c < P.m; c++) if (P.tiles[x].vid[c] < 0) { closeStar(P, x, c); did = true; }
      }
      if (!did) break;
    }
    P.grownTo = Math.max(P.grownTo, R);
    return P;
  }
  function nbr(P) {
    return P.tiles.map(t => (t.rep >= 0 ? [] : t.nb.map(y => (y < 0 ? -1 : find(P, y)))));
  }

  /** Walk the outer boundary of a block (tile ids) along the stored links. Segments
   *  [{tileIdx, edgeIdx, flipped}] in walk order, or null if the block is not a disk (a hole, or
   *  two parts touching only at a vertex). A mirrored copy's side is walked end-to-start. */
  function boundary(P, block) {
    const m = P.m, inB = new Set(block.map(x => find(P, x)));
    const outside = (x, s) => { const y = P.tiles[x].nb[s]; return y < 0 || !inB.has(find(P, y)); };
    let total = 0, start = null;
    for (const x of inB) for (let s = 0; s < m; s++) if (outside(x, s)) { total++; if (!start) start = [x, s]; }
    if (!start) return null;
    const out = [], seenV = new Set();
    let [x, s] = start;
    for (let guard = 0; guard <= total; guard++) {
      const flipped = P.tiles[x].fr.r === -1;
      out.push({ tileIdx: x, edgeIdx: s, flipped });
      let cx = x, corner = flipped ? s : mod(s + 1, m), side = otherSide(m, s, corner);
      for (let g = 0; g < 4 * m && !outside(cx, side); g++) {   // turn through the block's own tiles
        const T = P.tiles[cx], y = find(P, T.nb[side]), t = T.nbSide[side], sw = T.nbSwap[side];
        const yc = (side === corner) !== sw ? t : mod(t + 1, m);
        cx = y; corner = yc; side = otherSide(m, t, yc);
      }
      if (inB.size > 1) {
        const v = P.tiles[cx].vid[corner];
        if (v >= 0) { if (seenV.has(v)) return null; seenV.add(v); }
      }
      x = cx; s = side;
      if (x === start[0] && s === start[1]) break;
    }
    return out.length === total ? out : null;
  }

  /** Exact direction form of each boundary segment. */
  function dirs(P, segs) {
    return segs.map(g => {
      const f = P.tiles[g.tileIdx].fr;
      const d = AA.add(f.phi, AA.scale(P.ctx.d[g.edgeIdx], f.r));
      return g.flipped ? AA.addK(P.ctx.sys, d, 180) : d;
    });
  }
  /** Draw the boundary from the witness (only for measured fallbacks and self-checks). */
  function coords(P, segs, dirForms, A, L) {
    let p = [0, 0];
    return segs.map((g, k) => {
      const th = AA.evaluate(P.ctx.sys, dirForms[k], A) * Math.PI / 180;
      const q = [p[0] + L[g.edgeIdx] * Math.cos(th), p[1] + L[g.edgeIdx] * Math.sin(th)];
      const seg = { ...g, a: p, b: q }; p = q; return seg;
    });
  }

  /** The vertex figure -- the set of vertex degrees where 3 or more tiles meet -- read off the
   *  closed vertex stars (grow to R >= 2 first so both orbits' vertices are present). Replaces
   *  tiling_checks.vertexFigure on a developed patch, which needed 60 to 400 tiles to see every
   *  vertex close. */
  function figure(P) {
    return [...new Set(P.starSize.filter(d => d >= 3))].sort((a, b) => a - b);
  }

  const api = { create, grow, nbr, boundary, dirs, coords, closeStar, starOf, find, relate, figure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DDPatch = api;
})(typeof window !== 'undefined' ? window : this);
