// Exact angle algebra for one combo, straight from its angle equations (cfg.eqs -- the vertex
// cycles of the Delaney-Dress symbol, via netAngles/netEdgeData in aniso.js's specify()).
//
// John, 2026-09-13: "The angle equations can be solved to show that angle 3 + angle 3 + angle 6 =
// 360 degrees ... Thus the angles that are supposed to match do, and we are done." The criteria
// checker used to MEASURE such relations on developed coordinates against tight tolerances, so a
// witness stored to 2 decimals (#209105) failed relations the family satisfies exactly. Here a
// relation is decided by linear algebra instead:
//   'proved'  -- it is a consequence of the equations: true for every member of the family
//   'refuted' -- it contradicts them: false for every member
//   'depends' -- it holds only on part of the family; only then does a caller measure.
//
// A "form" is an integer combination of the corner angles A_i plus a constant (degrees). Every
// form is stored already reduced to the family's free angles, scaled by a common denominator D so
// the arithmetic stays exact in plain integers: [k, f_0, f_1, ...] means (k + sum f_j A_free_j)/D.
//
// Why mod 360 is sound: the eqs hold EXACTLY for the solver's angles, while angles measured off a
// drawing agree with those only mod 360. A form with integer coefficients therefore changes by a
// multiple of 360 between the two, so a proved/refuted verdict mod 360 transfers to the drawing.
// Every form built here is an integer combination of the A_i by construction.
(function (root) {
  'use strict';

  const babs = x => (x < 0n ? -x : x);
  function bgcd(a, b) { a = babs(a); b = babs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  const blcm = (a, b) => (a / bgcd(a, b)) * b;
  const R = (n, d) => { if (d === undefined) d = 1n; if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; return [n / g, d / g]; };
  const rsub = (a, b) => R(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
  const rmul = (a, b) => R(a[0] * b[0], a[1] * b[1]);
  const rdiv = (a, b) => R(a[0] * b[1], a[1] * b[0]);
  const isZ = a => a[0] === 0n;

  /** Reduce eqs (rows of m integer coefficients + integer rhs) to express every A_i in the free
   *  angles. Returns { m, D, free, expr, inconsistent }. */
  function compile(eqs, m) {
    const M = eqs.map(r => r.slice(0, m + 1).map(x => {
      if (!Number.isInteger(x)) throw new Error('angle_algebra: non-integer equation entry ' + x);
      return R(BigInt(x));
    }));
    const piv = [];
    let row = 0;
    for (let c = 0; c < m && row < M.length; c++) {
      let p = -1;
      for (let r = row; r < M.length; r++) if (!isZ(M[r][c])) { p = r; break; }
      if (p < 0) continue;
      const tmp = M[row]; M[row] = M[p]; M[p] = tmp;
      const inv = M[row][c];
      for (let j = 0; j <= m; j++) M[row][j] = rdiv(M[row][j], inv);
      for (let r = 0; r < M.length; r++) {
        if (r === row || isZ(M[r][c])) continue;
        const f = M[r][c];
        for (let j = 0; j <= m; j++) M[r][j] = rsub(M[r][j], rmul(f, M[row][j]));
      }
      piv.push([c, row]); row++;
    }
    let inconsistent = false;
    for (let r = row; r < M.length; r++) if (!isZ(M[r][m])) inconsistent = true;
    const pivCol = new Map(piv);
    const free = [];
    for (let c = 0; c < m; c++) if (!pivCol.has(c)) free.push(c);
    let D = 1n;
    for (const [, r] of piv) {
      D = blcm(D, M[r][m][1]);
      for (const f of free) D = blcm(D, M[r][f][1]);
    }
    const scaled = q => q[0] * (D / q[1]);
    const toNum = b => {
      const x = Number(b);
      if (!Number.isSafeInteger(x) || Math.abs(x) > 2 ** 40) throw new Error('angle_algebra: coefficient too large for exact integer arithmetic');
      return x;
    };
    const nf = free.length, expr = new Array(m);
    free.forEach((c, j) => { const e = new Array(nf + 1).fill(0); e[j + 1] = toNum(D); expr[c] = e; });
    for (const [c, r] of piv) {
      const e = new Array(nf + 1).fill(0);
      e[0] = toNum(scaled(M[r][m]));                                  // A_c = rhs - sum M[r][f] A_f
      free.forEach((f, j) => { e[j + 1] = toNum(-scaled(M[r][f])); });
      expr[c] = e;
    }
    return { m, D: toNum(D), free, expr, inconsistent };
  }

  // ---- forms ----
  // A form carries TWO views of the same quantity:
  //   r: reduced to the free angles, scaled by D -- what test() decides with, exactly.
  //   o: the original integer coefficients of A_0..A_{m-1}, then the constant -- what evaluate()
  //      uses. The reduced view cannot be evaluated on stored angles: those are the solver's
  //      angles reduced mod 360, and a dependent angle can be a FRACTION of a free one (#209105:
  //      A1 = A7/2, stored A7 = 156.09 is really 516.10), so the reduction is off by 180 there.
  //      Integer coefficients are immune: they only ever shift a value by a multiple of 360.
  const unit = (len, i, v) => { const a = new Array(len).fill(0); a[i] = v; return a; };
  const A = (sys, i) => { const j = ((i % sys.m) + sys.m) % sys.m; return { r: sys.expr[j].slice(), o: unit(sys.m + 1, j, 1) }; };
  const K = (sys, deg) => ({ r: unit(sys.free.length + 1, 0, deg * sys.D), o: unit(sys.m + 1, sys.m, deg) });
  const vadd = (a, b) => a.map((x, i) => x + b[i]);
  const add = (a, b) => ({ r: vadd(a.r, b.r), o: vadd(a.o, b.o) });
  const sub = (a, b) => ({ r: a.r.map((x, i) => x - b.r[i]), o: a.o.map((x, i) => x - b.o[i]) });
  const neg = a => ({ r: a.r.map(x => -x), o: a.o.map(x => -x) });
  const scale = (a, s) => ({ r: a.r.map(x => x * s), o: a.o.map(x => x * s) });
  const addK = (sys, a, deg) => { const f = { r: a.r.slice(), o: a.o.slice() }; f.r[0] += deg * sys.D; f.o[sys.m] += deg; return f; };

  /** Is form == targetDeg (mod 360) for the whole family? targetDeg must be an integer. */
  function test(sys, form, targetDeg) {
    const r = form.r;
    for (let i = 1; i < r.length; i++) if (r[i] !== 0) return 'depends';
    const mod = 360 * sys.D;
    const d = (((r[0] - targetDeg * sys.D) % mod) + mod) % mod;
    return d === 0 ? 'proved' : 'refuted';
  }
  /** Numeric value in degrees for an actual angle array, correct mod 360 (see the note above). */
  function evaluate(sys, form, Avals) {
    let v = form.o[sys.m];
    for (let i = 0; i < sys.m; i++) if (form.o[i]) v += form.o[i] * Avals[i];
    return v;
  }

  // ---- edge directions of one tile, and of every tile in a block ----
  // Base tile (tiler_core.verticesOf): edge 0 points along +x and the heading turns by
  // 180 - A_{j} after each edge, so edge j's direction is  sum_{i=1..j} (180 - A_i).
  function baseDirs(sys) {
    const d = [K(sys, 0)];
    for (let j = 1; j < sys.m; j++) d.push(sub(addK(sys, d[j - 1], 180), A(sys, j)));
    return d;
  }
  // A placed copy is described by {phi, r, orbit}: its edge j points along phi + r * d_j, with
  // r = +1 for a direct copy and -1 for a mirrored one. Crossing side i follows tiler_core's
  // sideMotion exactly: the neighbour's side `to` is laid onto this side i (end-swapped when the
  // Klein code is 1 or 3), by a reflection when the code is 1 or 2.
  function glue(ctx, fr, i) {
    const { sys, tbl, d } = ctx;
    const to = tbl[fr.orbit].to[i], nm = tbl[fr.orbit].map[i];
    const swap = nm === 1 || nm === 3, reflect = nm === 1 || nm === 2;
    const target = swap ? addK(sys, d[i], 180) : d[i];
    if (!reflect) return { phi: add(fr.phi, scale(sub(target, d[to]), fr.r)), r: fr.r, orbit: tbl[fr.orbit].nb[i] };
    return { phi: add(fr.phi, scale(add(target, d[to]), fr.r)), r: -fr.r, orbit: tbl[fr.orbit].nb[i] };
  }
  /** ctx = { sys, tbl, d } for one combo. tbl is tiler_core.sideTables(...) -- pure DD data. */
  function makeContext(eqs, m, tbl) {
    const sys = compile(eqs, m);
    return { sys, tbl, d: baseDirs(sys) };
  }
  /** Frames of every tile reachable from tile 0 through `nbr` (topology only, no coordinates). */
  function frames(ctx, nbr, want) {
    const fr = new Map([[0, { phi: K(ctx.sys, 0), r: 1, orbit: 0 }]]);
    const q = [0];
    while (q.length && (!want || want.some(t => !fr.has(t)))) {
      const t = q.shift();
      (nbr[t] || []).forEach((u, i) => {
        if (u < 0 || fr.has(u)) return;
        fr.set(u, glue(ctx, fr.get(t), i)); q.push(u);
      });
    }
    return fr;
  }
  /** Direction form of each boundary segment {tileIdx, edgeIdx, flipped} of a block, or null if
   *  some tile could not be reached or its handedness disagrees with the layout. */
  function boundaryDirs(ctx, nbr, boundary) {
    const tiles = [...new Set(boundary.map(s => s.tileIdx))];
    const fr = frames(ctx, nbr, tiles);
    const out = [];
    for (const s of boundary) {
      const f = fr.get(s.tileIdx);
      if (!f || (f.r === -1) !== !!s.flipped) return null;
      const dir = add(f.phi, scale(ctx.d[s.edgeIdx], f.r));
      out.push(s.flipped ? addK(ctx.sys, dir, 180) : dir);   // a mirrored tile's side is walked backwards
    }
    return out;
  }

  const api = { compile, A, K, add, sub, neg, scale, addK, test, evaluate, baseDirs, glue, makeContext, frames, boundaryDirs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AngleAlgebra = api;
})(typeof window !== 'undefined' ? window : this);
