// Each orbit's tile symmetry (its stabilizer in the tiling), as relabellings of the m-gon, taken
// from the Delaney-Dress data: netEdgeData rows 0-1 say which net edge of a polygon is the image of
// which other edge of the SAME polygon under the tile's own symmetry (py/gen_full.py). specify()
// walks those pairs sub-side by sub-side (aniso_fast.js "edge tile sym"); the same walk here gives,
// for each orbit, "side b1 is the image of side b2". Each pair suggests a rotation or a reflection
// of the tile's numbering; the angle equations decide exactly which ones really are symmetries.
//
// Needed because a tile with a symmetry of its own (every unbalanced type, and #3196) has 2 or 3
// valid numberings, so sideTables glues two different sides onto one partner side and an exact
// patch builder must identify copies up to this group (dd_patch.js).
//
// A relabelling sigma: vertex j of the copy base*sigma sits at vertex sv(j) of the base tile.
//   rotation   {kind:'rot',  t}: sv(j) = j + t      side s -> side s + t        (same direction)
//   reflection {kind:'refl', c}: sv(j) = c - j      side s -> side c - 1 - s    (walked backwards)
// Its frame (angle_algebra): edge j of base*sigma points along phi + r*d_j.
(function (root) {
  'use strict';
  const AA = (typeof module !== 'undefined' && module.exports) ? require('./angle_algebra.js') : root.AngleAlgebra;
  const mod = (x, m) => ((x % m) + m) % m;
  const KLEIN = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]];   // aniso.js `mapping`

  const key = s => (s.kind === 'rot' ? 'r' + s.t : 'f' + s.c);
  const vertexOf = (s, j, m) => (s.kind === 'rot' ? mod(j + s.t, m) : mod(s.c - j, m));
  const sideOf = (s, j, m) => (s.kind === 'rot' ? mod(j + s.t, m) : mod(s.c - 1 - j, m));
  // s1 after s2: vertex j -> s1(s2(j))
  function compose(s1, s2, m) {
    if (s1.kind === 'rot' && s2.kind === 'rot') return { kind: 'rot', t: mod(s1.t + s2.t, m) };
    if (s1.kind === 'refl' && s2.kind === 'rot') return { kind: 'refl', c: mod(s1.c - s2.t, m) };
    if (s1.kind === 'rot' && s2.kind === 'refl') return { kind: 'refl', c: mod(s2.c + s1.t, m) };
    return { kind: 'rot', t: mod(s1.c - s2.c, m) };
  }
  function frameOf(ctx, s, m) {
    if (s.kind === 'rot') return { phi: ctx.d[mod(s.t, m)], r: 1 };
    return { phi: AA.addK(ctx.sys, ctx.d[mod(s.c - 1, m)], 180), r: -1 };
  }
  /** Is sigma an exact symmetry of the tile for the whole family? Edge j of base*sigma must be the
   *  base edge sideOf(j) (walked backwards for a reflection), with the same length group and type. */
  function proves(ctx, s, m, edge) {
    const f = frameOf(ctx, s, m);
    for (let j = 0; j < m; j++) {
      const e = sideOf(s, j, m);
      if (edge && (edge.whichEdge[e] !== edge.whichEdge[j] || edge.edgeSym[e] !== edge.edgeSym[j])) return 'types';
      const want = s.kind === 'rot' ? ctx.d[e] : AA.addK(ctx.sys, ctx.d[e], 180);
      const got = AA.add(f.phi, AA.scale(ctx.d[j], f.r));
      const v = AA.test(ctx.sys, AA.sub(got, want), 0);
      if (v !== 'proved') return v;
    }
    return 'proved';
  }

  /** Side pairs (b1 image of b2) per orbit, exactly as specify() walks them. ned = the FILLED
   *  cfg.ned (rows 4-7 depend on the combo's sum/offset). */
  function sidePairs(ned, k, n, m) {
    const pairs = [[], []];
    for (let i = 0; i < k + n; i++) {
      const orb = i < k ? 0 : 1;
      const e2 = ned[0][i], map2 = ned[1][i];
      const size = Math.abs(ned[4][i]);
      let b1 = ned[5][i], b2 = ned[5][e2], s1 = ned[7][i], s2 = ned[7][e2];
      if (size > 1 && (map2 === 1 || map2 === 3)) { b2 = mod(b2 + (size - 1) * s2, m); s2 = -s2; }
      const newMap = KLEIN[KLEIN[ned[6][i]][ned[6][e2]]][map2];
      for (let q = 0; q < Math.max(size, 1); q++) {
        pairs[orb].push({ b1: mod(b1, m), b2: mod(b2, m), map: newMap, self: i === e2, refl: map2 === 1 });
        b1 = mod(b1 + s1, m); b2 = mod(b2 + s2, m);
      }
    }
    return pairs;
  }

  /** groups[orbit] = [{kind, t|c, fr}] including the identity; plus diagnostics. */
  function groupsFor(ctx, cfg, m) {
    const edge = { whichEdge: cfg.whichEdge, edgeSym: cfg.edgeSym };
    const pairs = sidePairs(cfg.ned, cfg.k, cfg.n, m);
    const out = { groups: [], candidates: [0, 0], rejected: [0, 0] };
    for (const o of [0, 1]) {
      const cands = new Map();
      // Row 1 says which kind: 0 = the tile symmetry is a rotation, 1 = a reflection. An edge that
      // is its own representative only counts when row 1 marks it mirror-fixed (a U edge on the
      // mirror). Taking both kinds for every pair instead finds symmetries of the tile's SHAPE that
      // are not symmetries of the TILING (e.g. the mirror of #69445's second orbit).
      for (const p of pairs[o]) {
        if (p.self && !p.refl) continue;
        const s = p.refl ? { kind: 'refl', c: mod(p.b1 + p.b2 + 1, m) } : { kind: 'rot', t: mod(p.b1 - p.b2, m) };
        cands.set(key(s), s);
      }
      cands.delete('r0');
      out.candidates[o] = cands.size;
      const gens = [];
      for (const s of cands.values()) { if (proves(ctx, s, m, edge) === 'proved') gens.push(s); else out.rejected[o]++; }
      // close under composition (the group is tiny: order <= 2m, in practice <= 6)
      const G = new Map([['r0', { kind: 'rot', t: 0 }]]);
      const queue = [...gens];
      for (const g of gens) G.set(key(g), g);
      while (queue.length) {
        const a = queue.pop();
        for (const b of [...G.values()]) for (const c of [compose(a, b, m), compose(b, a, m)]) {
          if (G.has(key(c))) continue;
          G.set(key(c), c); queue.push(c);
        }
      }
      out.groups.push([...G.values()].map(s => ({ ...s, fr: frameOf(ctx, s, m), proved: proves(ctx, s, m, edge) === 'proved' })));
    }
    return out;
  }

  const api = { groupsFor, sidePairs, compose, frameOf, proves, vertexOf, sideOf, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TileSymmetry = api;
})(typeof window !== 'undefined' ? window : this);
