// Which gallery combos draw the SAME tile?
//
// John, 2026-09-11: "can you sort the gallery combos by congruence? So for m=4, we have two ways
// that a square with curved edges can tile. It's the same shape, though."
//
// Two keys, because "same shape" has two honest meanings here:
//
//   tileKey   the curved tile's STRUCTURE: corner angles, edge lengths, edge types (J/U/I/S) and
//             which edges share a curve -- up to rotation and reflection. Two combos with the same
//             tileKey draw the same tile, just tiling the plane in different ways. This is the
//             grouping the gallery uses.
//   shapeKey  the bare OUTLINE: corners and lengths only, with straight (180-degree) corners
//             dropped and their edges merged. Coarser on purpose.
//
// Why both: a straight outline alone is the wrong test for curved tiles. The same regular hexagon
// can carry JJJJJJ, SSSSSS or SJJSJJ edges, and once curved those are different tiles -- John
// caught exactly that when seven types were being lumped together as "one hexagon". So tiles are
// grouped by tileKey, and shapeKey only says "these different tiles share an outline".
//
// Reflection is included: interior angles are intrinsic, and J, U, I and S are each closed under
// mirroring, so a tile and its mirror image get the same key. Orbit labels are renamed by first
// appearance along the walk, so the key depends on the PATTERN of shared curves, not the numbering.
(function (root) {
  'use strict';

  function norm(A, L) {
    const mx = Math.max(...L) || 1;
    return { a: A.map(x => (((x % 360) + 360) % 360)), l: L.map(x => x / mx) };
  }
  const rnd = (x, res) => (Math.round(x / res) * res).toFixed(res < 0.01 ? 4 : 2);
  function relabel(seq) {
    const map = {}; let n = 0;
    return seq.map(o => (o in map) ? map[o] : (map[o] = String.fromCharCode(97 + n++)));
  }
  // least of the 2m walks: every starting corner, forwards and backwards
  function canon(n, token) {
    let best = null;
    for (let s = 0; s < n; s++) for (const dir of [1, -1]) {
      const k = token(s, dir);
      if (best === null || k < best) best = k;
    }
    return best;
  }

  /** A, L: corner angles and edge lengths (edge i runs from corner i to i+1);
   *  types: 'J'|'U'|'I'|'S' per edge; orbits: which-edge rep per edge. */
  function tileKey(A, L, types, orbits, opt) {
    const angRes = (opt && opt.angRes) || 0.1, lenRes = (opt && opt.lenRes) || 1e-3;
    const { a, l } = norm(A, L), m = a.length;
    return m + ':' + canon(m, (s, dir) => {
      const toks = [], orb = [];
      for (let j = 0; j < m; j++) {
        const i = ((s + dir * j) % m + m) % m;
        const e = dir > 0 ? i : (i - 1 + m) % m;       // the edge LEAVING corner i on this walk
        toks.push(rnd(a[i], angRes) + ',' + rnd(l[e], lenRes) + ',' + types[e]);
        orb.push(orbits[e]);
      }
      const lab = relabel(orb);
      return toks.map((t, j) => t + ',' + lab[j]).join('|');
    });
  }

  function shapeKey(A, L, opt) {
    const angRes = (opt && opt.angRes) || 0.1, lenRes = (opt && opt.lenRes) || 1e-3;
    const tol = (opt && opt.straightTol) || 0.05;
    const { a, l } = norm(A, L), m = a.length;
    const straight = i => Math.abs(a[i] - 180) < tol;
    let s0 = 0; while (s0 < m && straight(s0)) s0++;
    if (s0 === m) return 'degenerate';
    // walk from a real corner; a straight corner extends the previous edge instead of starting one
    const va = [], vl = [];
    for (let j = 0; j < m; j++) {
      const i = (s0 + j) % m;
      if (straight(i)) { vl[vl.length - 1] += l[i]; continue; }
      va.push(a[i]); vl.push(l[i]);
    }
    const n = va.length, mx = Math.max(...vl);
    return n + ':' + canon(n, (s, dir) => {
      const toks = [];
      for (let j = 0; j < n; j++) {
        const i = ((s + dir * j) % n + n) % n;
        const e = dir > 0 ? i : (i - 1 + n) % n;
        toks.push(rnd(va[i], angRes) + ',' + rnd(vl[e] / mx, lenRes));
      }
      return toks.join('|');
    });
  }

  const api = { tileKey, shapeKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Congruence = api;
})(typeof window !== 'undefined' ? window : this);
