// Can a run of consecutive edges be replaced by ONE edge? Answered COMBINATORIALLY.
//
// John, 2026-09-10: "Why are you using experimental stuff? The angle equations tell us the angles
// add to 360 degrees, so they are complementary. The two edges' mappings say they match by 180
// degree rotation. I think we could get all this from delauney dress, too."
//
// He is right, and the first version of this test was the wrong instrument. It sampled points along
// the drawn boundary and measured a symmetry error, which meant (a) a tolerance, (b) a wrong answer
// whenever the stored shape had a loose closure -- #25521's arc came out at 1.4e-4 and read as "no
// symmetry" purely because the file sits 9.8e-5 from closing -- and (c) an answer about ONE MEMBER
// of the family rather than about the type.
//
// The combinatorial facts settle it exactly, with no tolerance and no shape at all:
//
//   1. SAME ORBIT.  whichEdge[i] === whichEdge[i+2] -- the outer edges carry the same curve, so one
//      merged edge can represent both. This is what blocks merging three independent J curves into
//      an S, which John ruled out earlier: "this isn't real reducing."
//   2. THE RELATIVE MAPPING.  mapping[i] XOR mapping[i+2] is the Klein-4 code relating the two
//      copies. Per tiler_curves.applyMap, bit 1 mirrors x and reverses the traversal, bit 2 flips y.
//      Code 3 is both: point symmetry. Code 1 alone is the mirror.
//   3. THE ANGLE EQUATIONS.  The two interior vertices of the run must be complementary,
//      A[i+1] + A[i+2] = 360. That is not something to measure -- it is either implied by cfg.eqs
//      or it is not, and if it is, it holds for every member of the closing family.
//   4. THE MIDDLE EDGE TYPE supplies the symmetry the merged edge needs: S is point-symmetric about
//      its own midpoint, U is mirror-symmetric about its chord's perpendicular bisector.
//
// Implication in (3) is checked by exact integer elimination over cfg.eqs, so "the type forces
// this" is a proof, not a measurement.
//
// CALIBRATED, not guessed. The first version invented conditions on the mapping code and was wrong
// -- it found John's U-S-U merge but missed an S-U-S one. merge_calibrate.js tabulates the
// combinatorial signature of every 3-run against a geometric symmetry test (on exactly re-closed
// shapes) across 150 combos. What the data says:
//
//     middle S or I, angles forced complementary -> ALWAYS point-symmetric   (65 runs, 0 exceptions)
//     middle U,      angles forced equal         -> ALWAYS mirror-symmetric  (2 runs,  0 exceptions)
//     no angle relation forced by the type       -> MIXED: symmetric in some shapes, not others
//
// The relative mapping code turned out NOT to matter for the S case (codes 0, 2 and 3 all appear
// among the confirmed merges); the angle equation is what decides it, exactly as John said. And the
// MIXED rows are the important ones: a run can look symmetric in one drawn member without the type
// forcing it -- that is the three-J-curves case John ruled out, and why this test asks the angle
// equations rather than measuring a picture.
// Promoted out of _dev_isohedral 2026-09-10: John asked for these to be excluded from the
// gallery alongside the vertexAngle reducibles, so it is production logic now.
(function (root) {
  'use strict';
  const SYM = ['J', 'U', 'I', 'S'];

// ---- is `target` a linear consequence of the rows of `eqs`? ---------------------------------
  // Rows are [c0..c_{m-1}, rhs]. Everything here is integers or simple rationals, so plain doubles
  // carry it exactly; the elimination is over the rationals, not a least-squares fit.
  function impliedBy(eqs, target, m) {
    const R = eqs.map(r => r.slice(0, m + 1).map(Number));
    const t = target.slice();
    const piv = [];
    let row = 0;
    for (let col = 0; col < m && row < R.length; col++) {
      let p = -1;
      for (let r = row; r < R.length; r++) if (Math.abs(R[r][col]) > 1e-12) { p = r; break; }
      if (p < 0) continue;
      [R[row], R[p]] = [R[p], R[row]];
      const lead = R[row][col];
      for (let cc = 0; cc <= m; cc++) R[row][cc] /= lead;
      for (let r = 0; r < R.length; r++) {
        if (r === row || Math.abs(R[r][col]) < 1e-12) continue;
        const f = R[r][col];
        for (let cc = 0; cc <= m; cc++) R[r][cc] -= f * R[row][cc];
      }
      piv.push(col); row++;
    }
    // reduce the target against the echelon rows; if the coefficients vanish, it is in the row space
    for (let i = 0; i < piv.length; i++) {
      const col = piv[i], f = t[col];
      if (Math.abs(f) < 1e-12) continue;
      for (let cc = 0; cc <= m; cc++) t[cc] -= f * R[i][cc];
    }
    return t.every(x => Math.abs(x) < 1e-9);
  }
  
  /** Runs of three consecutive edges that the TYPE forces to be a single edge.
   *  Takes a config (cfg.eqs / edgeSym / whichEdge / mapping) and the edge count -- no shape, no
   *  geometry, no tolerance. Returns [] when nothing merges. */
  function mergeRuns(cfg, m) {
    if (!cfg || !cfg.eqs || !cfg.edgeSym) return [];
    const es = cfg.edgeSym, we = cfg.whichEdge, mp = cfg.mapping;
    const out = [];
    for (let i = 0; i < m; i++) {
      const a = i, b = (i + 1) % m, cc = (i + 2) % m;      // the three edges of the run
      if (we[a] !== we[cc]) continue;                      // (1) outer edges must share an orbit
      const rel = (mp[a] ^ mp[cc]) & 3;                    // (2) how the two copies are related
      const mid = SYM[es[b]];                              // (4) what the middle edge contributes
      // (3) what relation do the angle equations FORCE at the two interior vertices?
      //     complementary (sum 360) goes with the 180-degree turn; equal goes with the mirror.
      const sum360 = new Array(m + 1).fill(0); sum360[b] = 1; sum360[cc] = 1; sum360[m] = 360;
      const eqAng = new Array(m + 1).fill(0); eqAng[b] = 1; eqAng[cc] = -1;
      const complementary = impliedBy(cfg.eqs, sum360, m);
      const equalAngles = !complementary && impliedBy(cfg.eqs, eqAng, m);
      if (!complementary && !equalAngles) continue;
      // (5) THE RUN MUST CARRY THE NEW EDGE'S FREEDOM.
      //
      // A merged edge of type T has to be able to be ANY curve of type T -- otherwise the "reduced"
      // tile is a different, more constrained object. An I edge is required straight, so a run
      // containing one can only ever produce a polyline: III with complementary angles really is a
      // point-symmetric Z, but a Z is not an arbitrary S. Calling it one would be exactly the mistake
      // John rejected for three J curves: "it's true that if we just used non-curves that we could
      // match, but this isn't real reducing."
      //
      // Without this the sweep reported 333 of 836 gallery combos as reducible, 472 of those merge
      // instances being III or ISI.
      const runTypes = [a, b, cc].map(k => SYM[es[k]]);
      if (runTypes.includes('I')) continue;
      let becomes = null;
      if (mid === 'S' && complementary) becomes = 'S';
      else if (mid === 'U' && equalAngles) becomes = 'U';
      if (!becomes) continue;
      out.push({ run: [a, b, cc], types: [a, b, cc].map(k => SYM[es[k]]).join(''), becomes,
                 orbit: we[a], rel, angleEq: complementary ? `A${b}+A${cc}=360` : `A${b}=A${cc}` });
    }
    return out;
  }
  
  
  /** The 2-EDGE case: a vertex the equations force to 180 degrees, with the same edge orbit either
   *  side. The two edges are then collinear and carry the same curve, so they are one edge of the
   *  reduced tile -- an S, whose midpoint is that vertex.
   *
   *  John, 2026-09-10: "if we check a vertex (2 edges) and 3 edges, we get all possibilities."
   *  He is right, and this is the vertex half. `cfg.vertexAngle` does NOT cover it: on #1726795
   *  m8 si12 the equations force A0, A2, A5 and A6 all to 180 and vertexAngle flags none of them,
   *  which is why 167 four-edge runs were turning up in combos that had passed every screen -- each
   *  was a centre vertex of exactly this kind.
   *
   *  Calibrated the same way as mergeRuns, against a geometric oracle over 200 combos: with the
   *  angle forced, the merge is point-symmetric in all 77 cases and across every relative mapping
   *  code (0, 2 and 3 all appear), so the angle equation decides and the mapping does not. Without
   *  the angle forced the result is mixed -- symmetric in some drawn members and not others, which
   *  is accidental and not a reduction. */
  function vertexMerges(cfg, m) {
    if (!cfg || !cfg.eqs || !cfg.edgeSym) return [];
    const es = cfg.edgeSym, we = cfg.whichEdge;
    const out = [];
    for (let v = 0; v < m; v++) {
      const e1 = (v - 1 + m) % m, e2 = v;
      if (we[e1] !== we[e2]) continue;                       // must carry the same curve
      if (SYM[es[e1]] === 'I' || SYM[es[e2]] === 'I') continue;  // a straight edge carries no free curve
      const t = new Array(m + 1).fill(0); t[v] = 1; t[m] = 180;
      if (!impliedBy(cfg.eqs, t, m)) continue;               // the type must FORCE the 180
      out.push({ vertex: v, edges: [e1, e2], becomes: 'S', orbit: we[e1],
                 angleEq: `A${v}=180` });
    }
    return out;
  }

  const api = { mergeRuns, vertexMerges, impliedBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MergeReduce = api;
})(typeof window !== 'undefined' ? window : this);
