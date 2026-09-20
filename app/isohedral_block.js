// Find the SMALLEST block of tiles that satisfies one of the 9 classical isohedral criteria
// (isohedral_criteria_fast.js) -- a complete, exact proof that a tile shape tiles the plane,
// replacing both the big-patch develop+overlap check and translation_block.js's pure-translation
// lattice search.
//
// John, 2026-09-12/13: independently verified by hand (pink-dot pictures on #25521, #25578,
// #208907, #208908) that translation_block.js's "FAIL" cases were never broken tilings -- they were
// cases where the type's wallpaper group needs a rotation, glide, or mirror (not a pure translation)
// to close the smallest repeat, so the PURE-TRANSLATION cell is naturally a multiple of the true
// isohedral block. "Don't we have a method of finding a block that tiles isohedrally? ... Let's find
// the smallest block that tiles isohedrally" -- yes: isohedral_criteria_fast.js's checkBlock, the
// same machinery that already produces every `min_block`/`block_criteria` in the census. This module
// is that search, factored out of sweep_aniso.js's proven per-row loop (blocksUpTo + checkBlock,
// smallest-first) so any single combo can be checked on demand, not only during a full m-sweep.
//
// ONE GENERALIZATION vs. the census: sweep_aniso.js caps the search at 4 tiles
// (`blocksUpTo(nbr, 4)`) because enumerating blocks dominated the cost of sweeping thousands of
// rows at once. Checking one combo at a time can afford to look much deeper -- MAX_TILES here
// defaults to 16, which is comfortably past every block size seen in this project so far (up to 12).
// A type whose true minimum sits above that would need MAX_TILES raised, not a different tool.
(function (root) {
  'use strict';
  const N = (typeof module !== 'undefined' && module.exports);

  // All connected tile-index subsets reachable from tile 0, grown one neighbour at a time, up to
  // maxT tiles -- identical to sweep_aniso.js's blocksUpTo, kept in sync rather than re-derived.
  function blocksUpTo(nbr, maxT) {
    const out = [[0]], seen = new Set(['0']);
    const grow = cur => {
      if (cur.length >= maxT) return;
      for (const t of cur) for (const nb of nbr[t] || []) {
        if (nb < 0 || cur.includes(nb)) continue;
        const nx = [...cur, nb].sort((a, b) => a - b), k = nx.join(',');
        if (seen.has(k)) continue;
        seen.add(k); out.push(nx); grow(nx);
      }
    };
    grow([0]); return out;
  }

  /** Find the smallest tile block that satisfies any isohedral criterion. Starts at size 1 --
   *  John, 2026-09-13: "#1512 and #3215 are single tile isohedral" -- a combo that translation_
   *  block.js flagged "no lattice" can simply be plain isohedral (one tile IS the fundamental
   *  domain), not anisohedral-with-a-bigger-block. Assuming every miss needs >1 tile was wrong.
   *  deps: { TC, IC, CHK } -- tiler core, isohedral_criteria_fast (or the plain isohedral_criteria),
   *        and tiling_checks (for the validity gate below).
   *  ctx: { k, n, ned, edgeSym, whichEdge, mapping } -- from H.config(...).ned/cfg, as everywhere
   *       else in this codebase.
   *  Returns { found, size, criteria, tiles, patchTiles } on a match; { found:false, invalid:true,
   *  reason } if the shape itself is not a legitimate tile; or { found:false, patchTiles } if it IS
   *  a valid tile but nothing matched within opts.maxTiles. */
  function findSmallestBlock(deps, ctx, A, L, opts) {
    opts = opts || {};
    const { TC, IC, CHK } = deps;
    const MAX_TILES = opts.maxTiles || 16;
    const PATCH = opts.patch || 60;
    const m = A.length;
    // GATE FIRST. checkBlock/checkPolygon test edge-pairing relationships -- necessary for an
    // isohedral tiling, but NOT sufficient: they say nothing about whether the polygon itself is a
    // legitimate simple shape. A criterion match on a folded or self-intersecting polygon is not a
    // proof of anything. Caught concretely 2026-09-13: #209210 m8 si8 (a corner forced to fold
    // between two EQUAL-length edges, confirmed by extended Newton and a 300-seed search to have no
    // nearby escape -- see project notes) still reported "2 tiles, criterion 6" from the checker
    // alone, because the fold happens to leave the edge-pairing pattern intact. Same rule
    // gen_gallery.js's "not a tile" screen already uses.
    if (CHK) {
      const q = CHK.quality(A, L, null, m, ctx.edgeSym);
      if (q.foldFatal || q.coincident || q.spikeFatal) {
        return { found: false, invalid: true, reason: (q.degenerateWhy || []).filter(w => ['fold', 'coincidentVertices', 'spike'].includes(w)).join(', ') || 'degenerate' };
      }
    }
    // Default: no develop() at all -- tiles, adjacency and boundaries from the DD data (dd_patch.js).
    if (!opts.useDevelop && deps.DD && deps.AA && TC.sideTables && ctx.eqs) {
      const r = findSmallestBlockDD(deps, ctx, A, L, opts, MAX_TILES);
      if (r) return r;
    }
    const V = TC.verticesOf(A, L, m).slice(0, m);
    const ned = ctx.ned;
    const placed = TC.develop(V, ctx.k, ctx.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], PATCH);
    const nbr = TC.developAdjacency(placed, V, ctx.k, ctx.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6]);
    const ed = { whichEdge: ctx.whichEdge, edgeSym: ctx.edgeSym, mapping: ctx.mapping };
    // Exact angle algebra from the DD data (sideTables + eqs) -- see angle_algebra.js. Off only
    // when asked (opts.symbolic === false), for comparing against the measured-only checker.
    let sym = null;
    if (deps.AA && TC.sideTables && ctx.eqs && opts.symbolic !== false) {
      try {
        const tbl = TC.sideTables(ctx.k, ctx.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], m);
        sym = { ctx: deps.AA.makeContext(ctx.eqs, m, tbl), A };
      } catch (e) { sym = null; }
    }
    // Grow the search ONE size at a time and stop enumerating the moment a size matches --
    // blocksUpTo(nbr, N) itself is what costs time (the number of connected N-tile subsets grows
    // fast with N), so building all the way to MAX_TILES before checking anything -- the first
    // version of this -- made a combo whose true answer is 2 tiles pay for a 16-tile enumeration
    // it never needed. Every size's blocks are a superset of the smaller sizes' (same growth
    // process), so nothing already tried is lost by re-deriving them; what's saved is never
    // reaching N+1 once N has an answer.
    for (let size = opts.minTiles || 1; size <= MAX_TILES; size++) {
      const blocks = blocksUpTo(nbr, size).filter(t => t.length === size);
      for (const tiles of blocks) {
        let cb; try { cb = IC.checkBlock(placed, nbr, tiles, ed, null, { any: !opts.all, sym }); } catch (e) { continue; }
        if (cb.boundary && cb.matches.length) return { found: true, size, criteria: cb.matches, tiles, placed, nbr, ed, symbolic: !!cb.sym };
      }
    }
    return { found: false, patchTiles: placed.length };
  }

  // The same smallest-first search with no coordinates in the loop: the patch of tiles around the
  // root, and who is glued to whom, comes from sideTables + the angle equations (dd_patch.js);
  // each block's boundary is walked combinatorially and carries its exact direction forms. The
  // witness A/L only DRAWS the boundary, for the few relations the algebra leaves to measurement.
  // Returns null if the DD route cannot be used for this combo (caller falls back to develop()).
  function findSmallestBlockDD(deps, ctx, A, L, opts, MAX_TILES) {
    const { TC, IC, AA, DD } = deps, m = A.length, ned = ctx.ned;
    // A tile with a symmetry of its own in the tiling (every unbalanced type, and #3196) has
    // several valid side numberings; dd_patch identifies copies up to that symmetry, read from
    // netEdgeData rows 0-1 (the D-symbol's record of which edges of a tile match).
    const TS = deps.TS || (typeof module !== 'undefined' && module.exports ? require('./tile_symmetry.js') : root.TileSymmetry);
    let actx, groups;
    try {
      const tbl = TC.sideTables(ctx.k, ctx.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], m);
      actx = AA.makeContext(ctx.eqs, m, tbl);
      if (actx.sys.inconsistent) return null;
      groups = TS.groupsFor(actx, { ned, k: ctx.k, n: ctx.n, whichEdge: ctx.whichEdge, edgeSym: ctx.edgeSym }, m).groups;
    } catch (e) { return null; }
    const ed = { whichEdge: ctx.whichEdge, edgeSym: ctx.edgeSym, mapping: ctx.mapping };
    const symbolic = opts.symbolic !== false;
    const P = DD.create(actx, m, groups);
    const stats = () => ({ dd: true, patchTiles: P.tiles.filter(t => t.rep < 0).length, merges: P.merges, conflicts: P.conflicts, failedStars: P.failedStars });
    for (let size = opts.minTiles || 1; size <= MAX_TILES; size++) {
      if (size > 1) DD.grow(P, size);
      const blocks = size === 1 ? [[0]] : blocksUpTo(DD.nbr(P), size).filter(t => t.length === size);
      for (const tiles of blocks) {
        const segs = DD.boundary(P, tiles);
        if (!segs) continue;
        const dirForms = DD.dirs(P, segs);
        const o = { any: !opts.all };
        if (symbolic) { o.symDirs = dirForms; o.sys = actx.sys; }
        let cb; try { cb = IC.checkBoundary(DD.coords(P, segs, dirForms, A, L), ed, null, o); } catch (e) { continue; }
        if (cb.boundary && cb.matches.length) return { found: true, size, criteria: cb.matches, tiles, symbolic: !!cb.sym, ...stats() };
      }
    }
    return { found: false, ...stats() };
  }

  // The largest block that can be needed (John, 2026-09-13): reduce the type's orbit ratio q:r to
  // q':r'; a block of q'+r' tiles -- q' of one orbit, r' of the other -- is the biggest repeat an
  // isohedral block tiling can require. Balanced types give 2, 1:2 gives 3, 1:4 gives 5. Never
  // hard-wire a number: a higher-order unbalanced type at large m needs a bigger block.
  function maxBlockFor(q, r) {
    q = +q; r = +r;
    if (!(q > 0 && r > 0)) return null;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(q, r);
    return q / g + r / g;
  }
  // q and r from a homeotype label such as "5_3 6_6" (k_q n_r) -- the same label the ledger and
  // the app's type index both carry.
  function qrFromHomeo(homeo) {
    const mt = /(\d+)_(\d+)\s+(\d+)_(\d+)/.exec(String(homeo || ''));
    return mt ? { q: +mt[2], r: +mt[4] } : null;
  }

  const api = { blocksUpTo, findSmallestBlock, findSmallestBlockDD, maxBlockFor, qrFromHomeo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IsohedralBlock = api;
})(typeof window !== 'undefined' ? window : this);
