// Exact version of John's #3234 argument (2026-09-13: "I would actually like to get rid of any
// hand notes, if we can. Can we automate what I did?"). His proof:
//   1. closure forces a 0-degree corner, so a vertex lands exactly at the midpoint of a long
//      edge that is not a straight (I) edge -- call it a CONTACT.
//   2. the curve on that edge has to bulge around the vertex.
//   3. the same physical edge (the same net-edge representative) also appears elsewhere on the
//      boundary, carrying the SAME curve under the tile's own edge mapping -- so its bulge
//      direction there is fixed by the mapping, not free.
//   4. if the two occurrences need opposite bulge directions, no curve works.
//
// This module makes that computable:
//   - findContacts / forcedContacts find every vertex-on-edge contact that survives across the
//     WHOLE closing family (not just at one solved point) -- same sampling pattern
//     tile_designer.diagnose() already uses for its zeroCorner `forced` flag.
//   - an S contact or an I contact is fatal outright: an S curve is 180-degree symmetric about
//     its own edge midpoint, so it always passes through exactly the point being avoided; I is
//     rigid. No sign, no lemma.
//   - a J or U contact needs the curve to bulge to whichever side the vertex's own neighbours are
//     NOT on ("the outside" -- John's step 4; taken as a LEMMA, not derived from first principles).
//     That fixes one required sign per (edge, contact); the tile's own code (tiler_curves.
//     applyMap: bit&2 negates the offset) carries it back to a required sign on the edge's
//     REPRESENTATIVE. Two contacts on the same representative that need opposite signs is
//     impossible; consistent signs are checked FOR REAL with a small deterministic bump curve
//     through curve_designer.separation (a fixed geometric evaluation, not a shape search).
//   - John reviewed every lemma-based verdict from the first full census run (all 70) and
//     confirmed each one, 2026-09-13: "I agree these are impossible. Let's stop having me check
//     them." The lemma is now trusted; `usedLemma` is kept on the result only as provenance (which
//     rule a verdict came from).
(function (root) {
  'use strict';
  const N = (typeof module !== 'undefined' && module.exports);
  const TCurvesDefault = N ? require('./tiler_curves.js') : root.TilerCurves;
  const CDDefault = N ? require('./curve_designer.js') : root.CurveDesigner;
  const TDDefault = N ? require('./tile_designer.js') : root.TileDesigner;

  // Deterministic, fixed-size bump per bowable type (no search over shape -- only the sign
  // varies). J's whole drawn half is a straight ramp out to the bump and back; U/S do the same
  // for their half (buildCanon then mirrors/rotates it for the other half). S's own last point is
  // pinned to [0.5,0] by buildCanon regardless of what we pass, which is exactly why an S contact
  // is fatal: there is no sign to choose.
  const BUMP = 0.12;
  function bumpPts(type, sign) {
    if (type === 'J') return [[0, 0], [0.5, BUMP * sign], [1, 0]];
    if (type === 'U') return [[0, 0], [0.25, BUMP * sign], [0.5, BUMP * sign]];
    if (type === 'S') return [[0, 0], [0.25, BUMP * sign], [0.5, 0]];
    return [[0, 0], [1, 0]];   // I: no freedom at all
  }

  // Every non-adjacent (vertex, edge) pair where the vertex sits within the OPEN span of the
  // edge's straight chord, to within `tol` of the edge's own length.
  function findContacts(V, m, tol) {
    tol = tol || 1e-6;
    const out = [];
    for (let k = 0; k < m; k++) for (let e = 0; e < m; e++) {
      if (e === k || (e + 1) % m === k) continue;
      const P = V[e], Q = V[(e + 1) % m];
      const dx = Q[0] - P[0], dy = Q[1] - P[1], L2 = dx * dx + dy * dy;
      if (!(L2 > 0)) continue;
      const t = ((V[k][0] - P[0]) * dx + (V[k][1] - P[1]) * dy) / L2;
      const distPerp = Math.abs((V[k][0] - P[0]) * dy - (V[k][1] - P[1]) * dx) / Math.sqrt(L2);
      if (t > tol && t < 1 - tol && distPerp < tol * Math.sqrt(L2)) out.push({ vertex: k, edge: e, t });
    }
    return out;
  }

  // Deterministic PRNG (same algorithm tiler_core.js's solver uses for its restarts) -- a
  // published census must be reproducible, not dependent on Math.random()'s draw.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Does a contact survive across the WHOLE closing family, or is it an accident of this one
  // solved point? Random single-step sampling alone is NOT enough: #3188 m6 si4 or1 off5 has a
  // genuine ~7% escape region (77/1081 valid trials broke the contact, on a real re-check), and
  // 150 unseeded random trials missed it entirely in one production census run, flagging a real
  // tile 'not a tile'. So this runs TWO passes: a systematic per-driver grid sweep (catches an
  // escape region tied to a single driver deterministically, however narrow) plus a large,
  // fixed-seed batch of joint random trials (catches escapes that need several drivers to move
  // together). Same pattern tile_designer.diagnose() uses for its own zeroCorner `forced` flag,
  // made robust and reproducible for a published verdict rather than an internal search hint.
  function forcedContacts(TC, ctx, A0, L0, contacts) {
    if (!contacts.length) return [];
    const { eqs, groups, m } = ctx;
    let drv = [];
    try {
      const F = TC.familyFns(eqs, groups, m);
      const u0 = F.toU(A0, L0);
      const pd = TC.pickDrivers(eqs, groups, m, u0);
      drv = (pd.drivers || []).map(d => d.u);
    } catch (e) { /* leave drv empty -- treated as fully rigid below */ }
    if (!drv.length) return contacts.map(c => ({ ...c, forced: true }));   // dim 0: nothing can move
    const F = TC.familyFns(eqs, groups, m);
    const u0 = F.toU(A0, L0);
    const stillThere = contacts.map(() => true);
    const tryPerturb = (uu) => {
      let r; try { r = TC.closeConstrained(eqs, groups, m, uu, drv); } catch (e) { return; }
      if (!r || !r.A || !r.ok) return;
      const V = TC.verticesOf(r.A, r.L, m).slice(0, m);
      const now = findContacts(V, m, 1e-4);
      contacts.forEach((c, idx) => { if (stillThere[idx] && !now.some(n => n.vertex === c.vertex && n.edge === c.edge)) stillThere[idx] = false; });
    };
    const STEPS = 40;
    for (const k of drv) {
      const range = k < F.free.length ? 90 : 1.5;
      for (let s = 1; s <= STEPS && stillThere.some(Boolean); s++) {
        const frac = s / STEPS;
        for (const sign of [1, -1]) { const uu = u0.slice(); uu[k] += sign * frac * range; tryPerturb(uu); }
      }
    }
    const rng = mulberry32(0xC3197);
    for (let t = 0; t < 600 && stillThere.some(Boolean); t++) {
      const uu = u0.slice();
      for (const k of drv) uu[k] += (rng() * 2 - 1) * (k < F.free.length ? 90 : 1.5);
      tryPerturb(uu);
    }
    return contacts.map((c, idx) => ({ ...c, forced: stillThere[idx] }));
  }

  // Which side of edge e's chord must a curve stay OFF, to clear vertex k without crossing the
  // boundary that already runs past k (its own two neighbours)? The LEMMA: whichever side of the
  // chord line the vertex's neighbours already occupy is where the rest of the polygon is, so the
  // curve must bulge the other way. Returns +1/-1, or 0 if the neighbours disagree (ambiguous --
  // caller must not claim an exact verdict from this contact).
  function requiredSign(V, m, contact) {
    const { vertex: k, edge: e } = contact;
    const P = V[e], Q = V[(e + 1) % m];
    const dx = Q[0] - P[0], dy = Q[1] - P[1];
    const side = p => Math.sign((p[0] - P[0]) * dy - (p[1] - P[1]) * dx);
    const s1 = side(V[(k - 1 + m) % m]), s2 = side(V[(k + 1) % m]);
    if (s1 && s1 === s2) return -s1;
    if (s1 && !s2) return -s1;
    if (s2 && !s1) return -s2;
    return 0;
  }

  // The full check. deps: { TC, TD, CD, TCurves } (TC required; the rest default to the sibling
  // files). ctx: { m, edgeSym, whichEdge, mapping, groups, eqs }.
  //   verdict 'impossible'  -- a forced contact that no curve choice clears; `usedLemma` says
  //                            whether the J/U outside lemma was needed (S/I contacts never
  //                            need it) -- ONLY usedLemma:true impossible verdicts need review.
  //   verdict 'no conflict' -- either no forced contact at all, or a consistent sign choice was
  //                            found and a concrete small bump actually clears (constructive --
  //                            existence, so no review needed even though the lemma picked the
  //                            sign; a wrong lemma could only make this MISS a real conflict, in
  //                            which case CD.separation would have caught it and this returns
  //                            'unknown' instead, never a false 'no conflict').
  //   verdict 'unknown'     -- ambiguous side, or the signs are forced but the constructed bump
  //                            still doesn't clear (some other crossing not captured by this
  //                            local rule). Defer to the general designCurves search.
  function checkExact(deps, ctx, A, L) {
    const TC = deps.TC, TD = deps.TD || TDDefault, CD = deps.CD || CDDefault, TCurves = deps.TCurves || TCurvesDefault;
    const { m, edgeSym, whichEdge, mapping } = ctx;
    const V = TC.verticesOf(A, L, m).slice(0, m);
    const raw = findContacts(V, m);
    if (!raw.length) return { verdict: 'no conflict', usedLemma: false, reason: 'no vertex-on-edge contact' };
    const forced = forcedContacts(TC, ctx, A, L, raw).filter(c => c.forced);
    if (!forced.length) return { verdict: 'no conflict', usedLemma: false, reason: 'contact(s) present but not forced across the family' };

    const { rc } = TD.repMapping(m, whichEdge, mapping, edgeSym);
    // I is rigid everywhere. S is rigid ONLY at its own fixed point (buildCanon pins the drawn
    // half's last point to exactly [0.5,0]) -- a contact anywhere else on an S edge has exactly
    // the same one-sign freedom as a J/U contact (verified: #72951 m6 si2 or1 off1 has a forced
    // S contact at t=1/3, nowhere near the centre, and a real curve clears it -- clearance 5.2e-2
    // -- so treating every S contact as automatically fatal is WRONG; only t=0.5 is rigid).
    // A contact past the curve's own halfway point (t>0.5) sits on the DERIVED second half, which
    // for S is the NEGATIVE of the drawn half (buildCanon: point-rotation) -- an extra sign flip
    // versus U, whose second half is a plain mirror (same sign, buildCanon keeps y unchanged).
    const need = new Map();          // rep -> { sign, why: [contact,...] }
    for (const c of forced) {
      const o = rc[c.edge];
      const ct = (o.code & 1) ? (1 - c.t) : c.t;     // undo the edge's own reversal bit -> the
                                                      // representative's OWN drawn-curve parameter
      if (o.type === 'I') return { verdict: 'impossible', usedLemma: false,
        reason: `v${c.vertex} is forced onto straight (I) edge ${c.edge} -- exact` };
      if (o.type === 'S' && Math.abs(ct - 0.5) < 1e-6) return { verdict: 'impossible', usedLemma: false,
        reason: `v${c.vertex} is forced onto the midpoint of S edge ${c.edge} (rep ${o.rep}) -- an S curve is 180-degree symmetric about that exact point, so no curve choice clears it -- exact` };
      const s = requiredSign(V, m, c);
      if (!s) return { verdict: 'unknown', usedLemma: false,
        reason: `contact v${c.vertex}/edge${c.edge}: the vertex's own neighbours don't agree on which side is outside -- deferring to search` };
      const half = (o.type === 'S' && ct > 0.5) ? -1 : 1;
      const repSign = s * ((o.code & 2) ? -1 : 1) * half;
      const cur = need.get(o.rep);
      if (cur && cur.sign !== repSign) {
        const c0 = cur.why[0];
        return { verdict: 'impossible', usedLemma: true,
          reason: `rep ${o.rep} (${o.type}) must bulge opposite ways: to clear v${c0.vertex} on edge ${c0.edge} (code ${rc[c0.edge].code}) `
                + `and to clear v${c.vertex} on edge ${c.edge} (code ${o.code}) -- exact via the outside lemma (validated by John, 2026-09-13)` };
      }
      if (cur) cur.why.push(c); else need.set(o.rep, { sign: repSign, why: [c] });
    }

    // Constructive check: build the tiny signed bump on every non-I orbit (sign fixed by `need`
    // where a contact demanded one, +1 arbitrarily elsewhere) and measure the real clearance.
    const edits = {};
    for (const o of rc) { if (o.type === 'I' || edits[o.rep]) continue;
      const sign = need.has(o.rep) ? need.get(o.rep).sign : 1;
      edits[o.rep] = { type: o.type, pts: bumpPts(o.type, sign) };
    }
    const curveOf = rc.map(o => TCurves.applyMap(TCurves.buildCanon(o.type, (edits[o.rep] || { pts: [[0, 0], [1, 0]] }).pts), o.code));
    const clearance = CD.separation(TCurves.curvedTile(V, curveOf)).rel;
    const signSummary = [...need].map(([r, v]) => `rep ${r}: ${v.sign > 0 ? '+' : '-'}`).join(', ');
    if (clearance > 0) return { verdict: 'no conflict', usedLemma: true, clearance, curveEdits: edits,
      reason: `a consistent bulge choice (${signSummary || 'no constraint'}) clears every forced contact (clearance ${clearance.toExponential(1)}) -- exact via the outside lemma` };
    return { verdict: 'unknown', usedLemma: true, clearance,
      reason: `signs are consistent (${signSummary}) but the bump still does not clear (clearance ${clearance.toExponential(1)}) -- deferring to search` };
  }

  // ---- John's two exact rules (2026-09-13), applied to the WHOLE family ------------------------
  // FIXED POINTS COLLIDE. Corners never move, an S curve always passes through its own edge
  // midpoint, and an I edge is rigid -- so the boundary touches itself, whatever the curves, if two
  // of those points coincide (two S midpoints: John's "two S curves that have to share the
  // midpoint"), a corner or S midpoint lies inside an I edge, or two I edges cross.
  // NO MIRROR. If a reflection takes edge e's curve onto edge f's curve and e's two ends lie on
  // opposite sides of the mirror line, e's curve crosses the line at a point the reflection fixes,
  // so f's curve passes through it too. U, S or J; the four corners need not be consecutive or
  // colinear. Neither rule depends on the curves chosen, so a member either fails outright or not.
  // Negative control: neither fires on any of the 7,015 census tile shapes.
  function fixedPointKill(V, m, rc, tol) {
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    let D = 0; for (const p of V) for (const q of V) D = Math.max(D, dist(p, q));
    const eps = tol * D, fixed = [];
    for (let k = 0; k < m; k++) fixed.push({ name: `corner v${k}`, p: V[k], own: [(k - 1 + m) % m, k] });
    for (let e = 0; e < m; e++) if (rc[e].type === 'S')
      fixed.push({ name: `the midpoint of S edge ${e}`, p: [(V[e][0] + V[(e + 1) % m][0]) / 2, (V[e][1] + V[(e + 1) % m][1]) / 2], own: [e], smid: true });
    for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++)
      if (dist(fixed[i].p, fixed[j].p) < eps) return `${fixed[j].name} and ${fixed[i].name} are at the same point`;
    const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let g = 0; g < m; g++) {
      if (rc[g].type !== 'I') continue;
      const P = V[g], Q = V[(g + 1) % m], dx = Q[0] - P[0], dy = Q[1] - P[1], L2 = dx * dx + dy * dy;
      if (!(L2 > 0)) continue;
      for (const f of fixed) {
        if (f.own.includes(g)) continue;                 // g's own corners (S midpoints are never on an I edge's own list)
        const t = ((f.p[0] - P[0]) * dx + (f.p[1] - P[1]) * dy) / L2;
        if (!(t > tol && t < 1 - tol)) continue;
        if (Math.abs((f.p[0] - P[0]) * dy - (f.p[1] - P[1]) * dx) / Math.sqrt(L2) < eps) return `${f.name} lies inside straight edge ${g}`;
      }
      for (let h = g + 1; h < m; h++) {
        if (rc[h].type !== 'I' || h === (g + 1) % m || g === (h + 1) % m) continue;
        const Rr = V[h], Ss = V[(h + 1) % m];
        if (orient(P, Q, Rr) * orient(P, Q, Ss) < 0 && orient(Rr, Ss, P) * orient(Rr, Ss, Q) < 0) return `straight edges ${g} and ${h} cross`;
      }
    }
    return null;
  }
  // the curve every edge carries for a GENERIC representative curve (placement as tiler_curves)
  function edgeCurvesGeneric(V, m, rc, seed, TCurves) {
    const rng = mulberry32(seed), canon = {};
    const y = () => (rng() * 2 - 1) * 0.3;
    const pts = type => type === 'I' ? [[0, 0], [1, 0]]
      : type === 'J' ? [[0, 0], [0.2, y()], [0.45, y()], [0.7, y()], [1, 0]]
      : [[0, 0], [0.17, y()], [0.33, y()], [0.5, type === 'U' ? y() : 0]];
    for (const o of rc) if (!canon[o.rep]) canon[o.rep] = TCurves.buildCanon(o.type, pts(o.type));
    return rc.map((o, e) => { const P0 = V[e], P1 = V[(e + 1) % m], Ex = P1[0] - P0[0], Ey = P1[1] - P0[1];
      return TCurves.applyMap(canon[o.rep], o.code).map(([x, yy]) => [P0[0] + x * Ex - yy * Ey, P0[1] + x * Ey + yy * Ex]); });
  }
  function mirrorKill(V, m, rc, tol, TCurves) {
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    let D = 0; for (const p of V) for (const q of V) D = Math.max(D, dist(p, q));
    const eps = tol * D, cmp = 1e-3 * D;
    const curves = [edgeCurvesGeneric(V, m, rc, 0xA11CE, TCurves), edgeCurvesGeneric(V, m, rc, 0xB0B5, TCurves)];
    const reflection = (A, A2, B, B2) => {            // the reflection taking A->A2 and B->B2, or null
      let c, n;
      if (dist(A, A2) > eps) { const d = dist(A, A2); n = [(A2[0] - A[0]) / d, (A2[1] - A[1]) / d]; c = [(A[0] + A2[0]) / 2, (A[1] + A2[1]) / 2]; }
      else if (dist(B, B2) > eps) { const d = dist(B, B2); n = [(B2[0] - B[0]) / d, (B2[1] - B[1]) / d]; c = [(B[0] + B2[0]) / 2, (B[1] + B2[1]) / 2]; }
      else return null;
      const side = p => (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1];
      const sig = p => { const s = side(p); return [p[0] - 2 * s * n[0], p[1] - 2 * s * n[1]]; };
      return dist(sig(A), A2) > eps || dist(sig(B), B2) > eps ? null : { sig, side };
    };
    for (let e = 0; e < m; e++) for (let f = 0; f < m; f++) {
      if (e === f || rc[e].rep !== rc[f].rep || rc[e].type === 'I') continue;
      const A = V[e], B = V[(e + 1) % m], A2 = V[f], B2 = V[(f + 1) % m];
      for (const rev of [false, true]) {
        const s = rev ? reflection(A, B2, B, A2) : reflection(A, A2, B, B2);
        if (!s) continue;
        if (!curves.every(cv => cv[e].length === cv[f].length
              && cv[e].every((p, i) => dist(s.sig(p), cv[f][rev ? cv[f].length - 1 - i : i]) < cmp))) continue;
        const dA = s.side(A), dB = s.side(B);
        if (dA * dB < 0 && Math.abs(dA) > eps && Math.abs(dB) > eps)
          return `edge ${e} (v${e}-v${(e + 1) % m}) reflects onto edge ${f} (v${f}-v${(f + 1) % m}) with v${e} and v${(e + 1) % m} on opposite sides of the mirror line`;
      }
    }
    return null;
  }
  // FOLDED S (John's reading of rule B, 2026-09-13: "if an S curve has 0 degree angles at its two
  // endpoints and the two edges adjacent on both sides are of equal length, then it is impossible").
  // Both end corners of S edge e fold flat, so edges e-1 and e+1 lie along e's own line; they are
  // straight (I) and equal, shorter than half of e, so their far corners sit at mirrored points t
  // and 1-t of e. The S cannot cross either I edge, so it is on one side over the first and -- being
  // point-symmetric -- on the OTHER side over the second. The outside lemma needs it on the side
  // away from each far corner's other neighbour; when those two neighbours are on the same side of
  // e's line, the two demands clash. Taken only in this strict form, and flagged as using the lemma.
  function foldedSKill(A, L, V, m, rc) {
    const deg = a => (((a % 360) + 360) % 360), fold = a => Math.min(deg(a), 360 - deg(a)) < 1e-3;
    for (let e = 0; e < m; e++) {
      if (rc[e].type !== 'S') continue;
      const p = (e - 1 + m) % m, q = (e + 1) % m;
      if (!fold(A[e]) || !fold(A[q])) continue;
      if (rc[p].type !== 'I' || rc[q].type !== 'I') continue;
      if (!(Math.abs(L[p] - L[q]) < 1e-6 * Math.max(L[p], L[q])) || !(L[p] < 0.5 * L[e])) continue;
      const P = V[e], Q = V[q], dx = Q[0] - P[0], dy = Q[1] - P[1], Ln = Math.hypot(dx, dy);
      const side = k => { const d = ((V[k][0] - P[0]) * dy - (V[k][1] - P[1]) * dx) / Ln; return Math.abs(d) < 1e-4 * Ln ? 0 : Math.sign(d); };
      const s1 = side((p - 1 + m) % m), s2 = side((q + 2) % m);
      if (s1 !== 0 && s1 === s2)
        return `S edge ${e} folds back at both ends onto equal straight edges ${p} and ${q}, and v${(p - 1 + m) % m}, v${(q + 2) % m} are on the same side of it: the S would have to pass both over and under (folded-S rule, via the outside lemma)`;
    }
    return null;
  }

  // Does EVERY member of the closing family, on every solution branch reached, fail one of the
  // rules above? Branches matter: #25552 m8 si2 or1 off3 fails on the branch its solve lands on and is a
  // real tile on another. Seeded sampling: the start member, 300 re-closes from random starts over
  // EVERY unknown, then a 20-step sweep of each driver from 25 of those. Stops at the first member
  // that escapes -- so a shape the census accepted as a tile can never be called impossible here.
  function familyExact(deps, ctx, A0, L0) {
    const TC = deps.TC, TD = deps.TD || TDDefault, TCurves = deps.TCurves || TCurvesDefault;
    const { m, eqs, groups, edgeSym, whichEdge, mapping } = ctx;
    const { rc } = TD.repMapping(m, whichEdge, mapping, edgeSym);
    let F, u0, drv;
    try { F = TC.familyFns(eqs, groups, m); u0 = F.toU(A0, L0);
      drv = ((TC.pickDrivers(eqs, groups, m, u0).drivers) || []).map(d => d.u); }
    catch (e) { return { verdict: 'escapes', members: 0 }; }
    // closeConstrained reports ok for NEAR-closures (gap ~1e-4) when the held drivers cannot close
    // exactly. #3189 m6 si0's "members" with v2 != v3 were such artifacts -- exact closure forces
    // v2 = v3 = 180, and there John's no-mirror rule applies (2026-09-13). So settle each sampled
    // member onto the exact family (every parameter free) and judge only members that truly close.
    const gapRel = (A, L) => { const W = TC.verticesOf(A, L, m); return Math.hypot(W[m][0] - W[0][0], W[m][1] - W[0][1]) / L.reduce((s, x) => s + x, 0); };
    const exact = r => {
      let best = r;
      for (let i = 0; i < 6 && gapRel(best.A, best.L) > 1e-9; i++) {
        let r2; try { r2 = TC.closeConstrained(eqs, groups, m, F.toU(best.A, best.L), []); } catch (e) { break; }
        if (!r2 || !r2.A) break; best = r2;
      }
      return gapRel(best.A, best.L) < 1e-7 ? best : null;
    };
    const close = uu => { try { const r = TC.closeConstrained(eqs, groups, m, uu, drv); return r && r.A ? exact(r) : null; } catch (e) { return null; } };
    let n = 0, first = null, lemma = false;
    const escapes = (A, L) => {
      if (!(Math.min(...L) / Math.max(...L) > 1e-3)) return false;
      const V = TC.verticesOf(A, L, m).slice(0, m); n++;
      let why = fixedPointKill(V, m, rc, 1e-4) || mirrorKill(V, m, rc, 1e-4, TCurves);
      if (!why) { why = foldedSKill(A, L, V, m, rc); if (why) lemma = true; }
      if (why) { if (!first) first = why; return false; }
      return true;
    };
    if (escapes(A0, L0)) return { verdict: 'escapes', members: n };
    const rng = mulberry32(0xB2A9 ^ m ^ (F.nU << 6)), seeds = [];
    for (let t = 0; t < 300; t++) {
      const r = close(u0.map((x, i) => i < F.free.length ? rng() * 360 : x * Math.exp((rng() * 2 - 1) * 2)));
      if (!r) continue;
      if (escapes(r.A, r.L)) return { verdict: 'escapes', members: n };
      if (seeds.length < 25 && t % 12 === 0) seeds.push(F.toU(r.A, r.L));
    }
    for (const us of seeds) for (const k of drv) for (let s = 1; s <= 20; s++) for (const sg of [1, -1]) {
      const uu = us.slice();
      if (k < F.free.length) uu[k] += sg * s / 20 * 90; else uu[k] = us[k] * Math.exp(sg * 4 * s / 20);
      const r = close(uu); if (r && escapes(r.A, r.L)) return { verdict: 'escapes', members: n };
    }
    if (n < 50) return { verdict: 'escapes', members: n };
    return { verdict: 'impossible', members: n, usedLemma: lemma,
      reason: `all ${n} sampled members of the family, on every solution branch reached, fail exactly -- e.g. ${first} (John's fixed-point / no-mirror rules${lemma ? ', some members by the folded-S rule' : ''}, 2026-09-13)` };
  }

  const api = { BUMP, bumpPts, findContacts, forcedContacts, requiredSign, checkExact, fixedPointKill, mirrorKill, foldedSKill, familyExact };
  if (N) module.exports = api; else root.CurveSides = api;
})(typeof window !== 'undefined' ? window : this);
