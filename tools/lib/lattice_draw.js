// Draw a tiling from its TRANSLATION BLOCK -- exact at any size, no tile-by-tile gluing.
//
// John, 2026-09-14: "Let's build the translation block for the app ... if we do it right, we have
// the transform figured out and if we use sliders to change things, we can find the whole block
// without researching."
//
// develop() places copies one gluing at a time, so any error in the shape is multiplied along the
// chain -- rounded saved shapes grew into visible overlaps at 120 tiles (2026-09-14). Here:
//
//   ONCE PER COMBO (buildRecipe -- no coordinates): grow the DD patch (dd_patch.js: tiles, frames and
//   who is glued to whom, from the D-symbol and the angle equations), record a placement tree, and
//   sort the tiles into FRAME CLASSES. Two tiles are in one class when their frames are PROVED equal
//   (same orbit, same handedness, same rotation up to the tile's own symmetry -- DDPatch.relate), so
//   they are translates of each other for EVERY shape in the family. One tile per class is the
//   translation block.
//
//   PER SHAPE (layout -- cheap, no search; this is what a slider move re-runs): evaluate each frame's
//   rotation at the current angles, place the tree (each tile fitted onto the side it shares with its
//   parent), and read the lattice off the class-mates: every class-to-class translation, reduced to a
//   short basis t1, t2, and checked to be an integer combination of it.
//
//   DRAW (tiles): the block's tiles at i*t1 + j*t2. Output is develop()'s format ({orbit, T, verts},
//   T the affine map of the base m-gon), so buildCurvedTiles and every drawing path take it unchanged.
(function (root) {
  'use strict';
  const N = typeof module !== 'undefined' && module.exports;
  const AA = N ? require('./angle_algebra.js') : root.AngleAlgebra;
  const DD = N ? require('./dd_patch.js') : root.DDPatch;
  const TS = N ? require('./tile_symmetry.js') : root.TileSymmetry;

  const cr = (a, b) => a[0] * b[1] - a[1] * b[0];
  const len = v => Math.hypot(v[0], v[1]);
  const cen = V => { let x = 0, y = 0; for (const p of V) { x += p[0]; y += p[1]; } return [x / V.length, y / V.length]; };

  // BFS placement tree over the patch's live tiles: par.get(y) = { x, s, t } -- y is placed from x
  // across x's side s, which is y's side t.
  function tree(P) {
    const par = new Map([[0, null]]), order = [0];
    for (let h = 0; h < order.length; h++) {
      const x = order[h], T = P.tiles[x];
      for (let s = 0; s < P.m; s++) {
        const y0 = T.nb[s]; if (y0 < 0) continue;
        const y = DD.find(P, y0); if (par.has(y)) continue;
        par.set(y, { x, s, t: T.nbSide[s] }); order.push(y);
      }
    }
    return { order, par };
  }

  /** ctx: { k, n, ned, eqs, edgeSym, whichEdge } (H.config's cfg); TC: tiler core (sideTables).
   *  Returns the shape-independent recipe, or null when the DD route cannot be used. */
  function buildRecipe(TC, ctx, m, opts) {
    opts = opts || {};
    const ned = ctx.ned;
    let actx, groups;
    try {
      const tbl = TC.sideTables(ctx.k, ctx.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], m);
      actx = AA.makeContext(ctx.eqs, m, tbl);
      if (actx.sys.inconsistent) return null;
      groups = TS.groupsFor(actx, { ned, k: ctx.k, n: ctx.n, whichEdge: ctx.whichEdge, edgeSym: ctx.edgeSym }, m).groups;
    } catch (e) { return null; }
    const P = DD.create(actx, m, groups);
    let prevClasses = -1, rec = null;
    for (let R = 2; R <= (opts.maxR || 12); R++) {
      try { DD.grow(P, R); } catch (e) { return null; }
      const { order, par } = tree(P);
      const reps = [], classOf = new Map();
      for (const y of order) {
        const f = P.tiles[y].fr;
        let c = null;
        for (const r of reps) if (DD.relate(P, f, P.tiles[r].fr)) { c = r; break; }
        if (c === null) { reps.push(y); c = y; }
        classOf.set(y, c);
      }
      const mates = order.filter(y => classOf.get(y) !== y).length;
      rec = { P, actx, m, order, par, reps, classOf, R };
      // With a witness shape: grow until the lattice actually reads (two independent translations,
      // every one a whole combination). Without: until a ring adds no class and translations exist.
      if (opts.witness) { if (layout(TC, rec, opts.witness.A, opts.witness.L).ok) break; }
      else if (reps.length === prevClasses && mates >= 2 * reps.length + 2) break;
      prevClasses = reps.length;
    }
    return rec;
  }

  /** Place the recipe for one shape. A: true angles (satisfying the angle equations), L: lengths.
   *  prev (optional): the last layout's { t1, t2 }, continued so tile numbering holds across moves.
   *  Returns { ok, reps:[{orbit,T,verts}], t1, t2, worst, reason }. */
  function layout(TC, rec, A, L, prev) {
    const m = rec.m, sys = rec.actx.sys;
    const B = TC.verticesOf(A, L, m).slice(0, m);           // the base m-gon (edge 0 along +x)
    const rot = fr => { const ph = AA.evaluate(sys, fr.phi, A) * Math.PI / 180, c = Math.cos(ph), s = Math.sin(ph), r = fr.r;
                        return [c, -r * s, s, r * c]; };      // reflect across x first when r = -1
    const place = new Map();
    for (const y of rec.order) {
      const fr = rec.P.tiles[y].fr, M = rot(fr);
      const rel = B.map(p => [M[0] * p[0] + M[1] * p[1], M[2] * p[0] + M[3] * p[1]]);
      let O = [0, 0];
      const pr = rec.par.get(y);
      if (pr) {
        const X = place.get(pr.x), Pp = X.verts[pr.s], Q = X.verts[(pr.s + 1) % m];
        const p = rel[pr.t], q = rel[(pr.t + 1) % m];
        // the shared side, either way round -- keep the fit where the other end lands too
        const o1 = [Q[0] - p[0], Q[1] - p[1]], o2 = [Pp[0] - p[0], Pp[1] - p[1]];
        const e1 = Math.hypot(q[0] + o1[0] - Pp[0], q[1] + o1[1] - Pp[1]);
        const e2 = Math.hypot(q[0] + o2[0] - Q[0], q[1] + o2[1] - Q[1]);
        O = e1 <= e2 ? o1 : o2;
      }
      place.set(y, { orbit: fr.orbit, T: [M[0], M[1], M[2], M[3], O[0], O[1]], verts: rel.map(p => [p[0] + O[0], p[1] + O[1]]) });
    }
    const scale = L.reduce((s, x) => s + Math.abs(x), 0) || 1;
    const tol = 1e-7 * scale;
    const sameSet = (u, w) => u.every(p => w.some(q => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol));
    const shifted = (y, t) => place.get(y).verts.map(p => [p[0] + t[0], p[1] + t[1]]);
    // TRANSLATION CLASSES, verified on the TILING, not just on the tile. Two copies whose frames agree
    // up to the tile's own symmetry (DDPatch.relate) coincide as sets after a shift, but when the tile
    // is itself symmetric (half-turn-symmetric tiles, the unbalanced types) that shift need not be a
    // symmetry of the tiling -- the copy can sit there by a half-turn of the tiling, with its
    // neighbours arranged differently. Those impostors put "translations" exactly half a lattice step
    // off (#1727308, #209210 ...). So a shift counts only if it carries one copy's whole ring of
    // neighbours onto the other's ring, checked on copies deep enough that their rings are complete.
    // Copies matching no class start a new one: the block is then as big as the tiling needs.
    const depth = new Map([[0, 0]]);
    for (const y of rec.order) { const pr = rec.par.get(y); if (pr) depth.set(y, depth.get(pr.x) + 1); }
    const inner = rec.order.filter(y => depth.get(y) <= rec.R - 2);
    const ring = y => {
      const T = rec.P.tiles[y], out = [];
      for (let s = 0; s < m; s++) { const z0 = T.nb[s]; if (z0 < 0) return null; const z = DD.find(rec.P, z0); if (!place.has(z)) return null; out.push(z); }
      return out;
    };
    const ringsMatch = (a, b, t) => {
      const ra = ring(a), rb = ring(b); if (!ra || !rb) return false;
      return ra.every(z => rb.some(w => place.get(w).orbit === place.get(z).orbit && sameSet(shifted(z, t), place.get(w).verts)));
    };
    const tReps = [], vecs = [];
    for (const y of inner) {
      const fy = rec.P.tiles[y].fr, cy = cen(place.get(y).verts);
      let hit = false;
      for (const r of tReps) {
        const fr2 = rec.P.tiles[r].fr;
        if (fr2.orbit !== fy.orbit || fr2.r !== fy.r) continue;
        const c0 = cen(place.get(r).verts), t = [cy[0] - c0[0], cy[1] - c0[1]];
        if (!sameSet(shifted(r, t), place.get(y).verts) || !ringsMatch(r, y, t)) continue;
        vecs.push(t); hit = true; break;
      }
      if (!hit) tReps.push(y);
    }
    // DISTINCT translations: vecs holds one per matched copy, so a short step along a glide axis
    // repeats thousands of times, and "the shortest few dozen" were all copies of it -- parallel,
    // though the patch had hundreds of verified steps across (#1726796 m7, #209078 m7, both 22x)
    const seen = new Set(), nz = [];
    for (const v of vecs.filter(v => len(v) > 1e-9 * scale).sort((a, b) => len(a) - len(b))) {
      const k = Math.round(v[0] / scale * 1e6) + ',' + Math.round(v[1] / scale * 1e6), k2 = Math.round(-v[0] / scale * 1e6) + ',' + Math.round(-v[1] / scale * 1e6);
      if (seen.has(k) || seen.has(k2)) continue; seen.add(k); nz.push(v);
    }
    if (!nz.length) return { ok: false, reason: 'no translation in the patch' };
    // the pair (a short one against every distinct one) spanning the smallest positive area is a basis
    const few = nz.slice(0, 48);
    let best = null;
    for (let i = 0; i < few.length; i++) for (let j = i + 1; j < nz.length; j++) {
      const ar = Math.abs(cr(few[i], nz[j]));
      if (ar > 1e-7 * len(few[i]) * len(nz[j]) && (!best || ar < best.ar - 1e-12 * scale * scale)) best = { ar, a: few[i], b: nz[j] };
    }
    if (!best) return { ok: false, reason: 'the translations in the patch are all parallel' };
    let t1 = best.a, t2 = best.b;
    const gauss = () => {                                     // Gauss reduction: short, near-orthogonal
      for (let it = 0; it < 64; it++) {
        if (len(t2) < len(t1)) { const t = t1; t1 = t2; t2 = t; }
        const k = Math.round((t1[0] * t2[0] + t1[1] * t2[1]) / (t1[0] * t1[0] + t1[1] * t1[1]));
        if (!k) break;
        t2 = [t2[0] - k * t1[0], t2[1] - k * t1[1]];
      }
    };
    gauss();
    // A translation with FRACTIONAL coordinates means the cell is a multiple of the true one (a
    // half-step was seen, #1726796 m7 ...): fold it in -- its remainder inside the cell spans a
    // smaller area with t1 or t2 -- and repeat. The area only shrinks, so this ends.
    const coords = v => { const d = cr(t1, t2); return [cr(v, t2) / d, cr(t1, v) / d]; };
    for (let pass = 0; pass < 32; pass++) {
      let fixed = false;
      for (const v of nz) {
        const [a, b] = coords(v);
        if (Math.abs(a - Math.round(a)) < 1e-6 && Math.abs(b - Math.round(b)) < 1e-6) continue;
        const w = [v[0] - Math.floor(a) * t1[0] - Math.floor(b) * t2[0], v[1] - Math.floor(a) * t1[1] - Math.floor(b) * t2[1]];
        const d = Math.abs(cr(t1, t2)), a1 = Math.abs(cr(t1, w)), a2 = Math.abs(cr(w, t2));
        if (a1 > 1e-9 * scale * scale && a1 < d * (1 - 1e-9)) t2 = w;
        else if (a2 > 1e-9 * scale * scale && a2 < d * (1 - 1e-9)) t1 = w;
        else continue;
        gauss(); fixed = true; break;
      }
      if (!fixed) break;
    }
    // CONTINUE the previous basis when given one (a slider or corner drag re-runs this every frame):
    // Gauss reduction may pick a different pair as the shape moves, which would renumber every drawn
    // tile and make the one being dragged jump. The old t1, t2 carried to the nearest lattice vectors
    // are still a basis when they are a unimodular combination of the new one.
    if (prev && prev.t1 && prev.t2) {
      const c1 = coords(prev.t1).map(Math.round), c2 = coords(prev.t2).map(Math.round);
      if (Math.abs(c1[0] * c2[1] - c1[1] * c2[0]) === 1) {
        const n1 = [c1[0] * t1[0] + c1[1] * t2[0], c1[0] * t1[1] + c1[1] * t2[1]];
        const n2 = [c2[0] * t1[0] + c2[1] * t2[0], c2[0] * t1[1] + c2[1] * t2[1]];
        t1 = n1; t2 = n2;
      }
    }
    const det = cr(t1, t2);
    let worst = 0;
    for (const v of vecs) {
      const a = cr(v, t2) / det, b = cr(t1, v) / det;
      worst = Math.max(worst, Math.abs(a - Math.round(a)), Math.abs(b - Math.round(b)));
    }
    const reps = tReps.map(r => place.get(r));
    // COMPLETENESS: every placed tile must be some block tile shifted by a whole lattice vector --
    // otherwise a class the tiling needs is missing from the block (grow the patch further)
    let missing = 0;
    for (const y of rec.order) {
      const Y = place.get(y), cy = cen(Y.verts);
      const found = tReps.some(r => {
        const R0 = place.get(r); if (R0.orbit !== Y.orbit) return false;
        const c0 = cen(R0.verts), t = [cy[0] - c0[0], cy[1] - c0[1]];
        const a = cr(t, t2) / det, b = cr(t1, t) / det;
        if (Math.abs(a - Math.round(a)) > 1e-6 || Math.abs(b - Math.round(b)) > 1e-6) return false;
        return sameSet(shifted(r, t), Y.verts);
      });
      if (!found) missing++;
    }
    const ok = worst < 1e-6 && missing === 0;
    return { ok, worst, missing, t1, t2, reps,
             reason: ok ? null : worst >= 1e-6 ? `a translation is not a whole combination of the lattice (off by ${worst.toExponential(1)})`
                                                 : `${missing} patch tile(s) are not a block tile plus a lattice vector` };
  }

  /** The block's tiles at i*t1 + j*t2 for |i| <= n1, |j| <= n2 -- a window covering a round region
   *  of about `want` tiles (a square in i, j was a thin sliver on a skewed lattice: #209080 m7 si11,
   *  |t2| = 7|t1|). The ORDER depends only on (i, j, class) and the window, never on the shape, so
   *  pass the returned `.win` back while something holds a tile by index (the full view's corner
   *  drag) and that tile keeps its index. Tile 0 is the root. */
  function tiles(lay, want, win) {
    const nb = lay.reps.length;
    if (!win) {
      // the cells within a disc holding about want/nb of them (its extent in i is rho*|t2|/det, in j
      // rho*|t1|/det); a bare rectangle, rounded up, drew 2-3x the tiles asked for
      const det = Math.abs(cr(lay.t1, lay.t2)), rho = Math.sqrt((want || 260) / nb * det / Math.PI);
      const n1 = Math.max(1, Math.ceil(rho * len(lay.t2) / det)), n2 = Math.max(1, Math.ceil(rho * len(lay.t1) / det)), cl = [];
      for (let i = -n1; i <= n1; i++) for (let j = -n2; j <= n2; j++)
        if (len([i * lay.t1[0] + j * lay.t2[0], i * lay.t1[1] + j * lay.t2[1]]) <= rho || (!i && !j)) cl.push([i, j]);
      cl.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[0] - b[0] || a[1] - b[1]);
      win = { cells: cl };
    }
    const cells = win.cells;
    const out = [];
    for (const [i, j] of cells) {
      const v = [i * lay.t1[0] + j * lay.t2[0], i * lay.t1[1] + j * lay.t2[1]];
      for (const r of lay.reps)
        out.push({ orbit: r.orbit, T: [r.T[0], r.T[1], r.T[2], r.T[3], r.T[4] + v[0], r.T[5] + v[1]], verts: r.verts.map(p => [p[0] + v[0], p[1] + v[1]]) });
    }
    out.win = win;
    return out;
  }

  const api = { buildRecipe, layout, tiles };
  if (N) module.exports = api; else root.LatticeDraw = api;
})(typeof window !== 'undefined' ? window : this);
