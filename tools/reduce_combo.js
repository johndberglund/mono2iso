// Automatically find the reduced (fewer-sided) version of a combo that has reducible vertices.
// John, 2026-08-08: "It would be nice if there was some way to automatically find the reduced
// version. Like it would replace each vertex with a point on the curve and combine the two
// curves that get joined. (And especially find the combo that is the reduced version.)"
//
// The key insight (also John's, same session): each physical boundary position is covered by
// TWO net edges, not one -- one from each polygon's independent edge-walk around the SAME
// boundary (orient 0 = the k-gon side, orient 1 = the n-gon side). Dropping a vertex must
// shrink BOTH covering net edges by one position, or the two walks disagree about the
// boundary's length. My first manual attempt at this reduction only shrank one side and
// produced a sum-type that doesn't exist; correcting for both sides found the real one (si=34
// for #1727337 m=12->10).
//
// Algorithm:
//   1. Find every reducible vertex (cfg.vertexAngle[i]===0) and group them into maximal runs
//      of consecutive dropped positions (a run of k means k+1 consecutive edges merge into 1).
//   2. For each dropped position, find its covering net edge in EACH orientation (0 and 1) and
//      decrement both by 1 -- this is the size-vector for the target smaller m.
//   3. Search every si at the smaller m for one whose net-edge size vector matches exactly
//      (sizes depend only on (id,m,si), not orient/off -- verified empirically).
//   4. Construct the merged shape directly: kept vertices keep their original angle, each run's
//      several edges collapse into one edge whose length is the sum of the merged lengths.
//   5. Report the new curve type each merged edge should get, from the ORIGINAL config's
//      mapping code between the merged edges (code 3 = "both" = a genuine 180-deg point
//      rotation between them = S; code 1 = reflection = U; anything else = keep as J/whatever
//      the surrounding edges already are, since no forced symmetry applies).
//   6. Check whether the directly-constructed A/L actually satisfies the NEW config's own
//      angle equations (a necessary check -- the smaller m's own structure can impose
//      DIFFERENT pairings that a naive merge doesn't automatically satisfy).
//
//     node reduce_combo.js <comboFile.json>
const fs = require('fs');
const H = require('c:/Users/johnd/Documents/math/tilings/me/aniso/program4/engine/test_harness.js');

const comboPath = process.argv[2];
const c = JSON.parse(fs.readFileSync(comboPath, 'utf8'));
const { id, m, orient, off } = c;
H.loadType(id);
const sums = H.runSums(m);
const si = sums.findIndex(s => JSON.stringify(s) === c.sum);
if (si < 0) { console.error('sum-type not found for this combo'); process.exit(1); }
const cfg = H.config(id, m, orient, off, si);
if (!cfg || cfg.impossible) { console.error('config is impossible'); process.exit(1); }

const va = cfg.vertexAngle;
const dropped = []; for (let i = 0; i < m; i++) if (va[i] === 0) dropped.push(i);
console.log(`m=${m}, reducible positions: [${dropped.join(',')}]`);
if (!dropped.length) { console.log('nothing to reduce.'); process.exit(0); }

// group into maximal cyclic runs of consecutive dropped positions
const droppedSet = new Set(dropped);
const runs = []; const seen = new Set();
for (const d of dropped) {
  if (seen.has(d)) continue;
  let lo = d; while (droppedSet.has((lo - 1 + m) % m) && !seen.has((lo - 1 + m) % m)) lo = (lo - 1 + m) % m;
  const run = []; let p = lo;
  while (droppedSet.has(p) && !seen.has(p)) { run.push(p); seen.add(p); p = (p + 1) % m; }
  runs.push(run);
}
console.log(`${runs.length} run(s) of dropped vertices:`, JSON.stringify(runs));

// Each polygon position is covered by exactly one orient-0 net edge and one orient-1 net edge
// (the k-gon's and n-gon's independent walks over the SAME boundary) -- tally every net edge
// that covers a dropped position; decrementing all of them keeps both walks' totals consistent.
const ned = cfg.ned;
const origSizes = ned[4].map(Math.abs);
const decrement = new Array(origSizes.length).fill(0);
for (const p of dropped) {
  for (let g = 0; g < origSizes.length; g++) {
    const size = Math.abs(ned[4][g]), begin = ned[5][g], sign = ned[4][g] < 0 ? -1 : 1;
    for (let k = 0; k < size; k++) { if ((((begin + sign * k) % m) + m) % m === p) decrement[g]++; }
  }
}
const targetSizes = origSizes.map((s, g) => s - decrement[g]);
console.log('orig sizes:  ', origSizes.join(','));
console.log('decrement:   ', decrement.join(','));
console.log('target sizes:', targetSizes.join(','));
if (targetSizes.some(s => s < 1)) { console.error('a net edge would shrink below size 1 -- not reducible this way'); process.exit(1); }

const newM = m - dropped.length;
H.loadType(id);
const newSums = H.runSums(newM);
let matchSi = -1;
for (let s = 0; s < newSums.length; s++) {
  const c2 = H.config(id, newM, 0, 0, s);
  if (!c2 || c2.impossible) continue;
  const sizes2 = c2.ned[4].map(Math.abs);
  if (sizes2.length === targetSizes.length && sizes2.every((v, i) => v === targetSizes[i])) { matchSi = s; break; }
}
console.log(`\nnew m=${newM}: ${newSums.length} sum-types, matching si = ${matchSi}`);
if (matchSi < 0) { console.log('no sum-type at the smaller m has this net-edge structure -- the type genuinely cannot represent this reduction.'); process.exit(0); }
console.log('MATCHING SUM:', JSON.stringify(newSums[matchSi]));

// ---- construct the merged shape from the ACTUAL VERTEX COORDINATES of the original tile ----
// John, 2026-08-09 (after this exact shortcut produced a non-closing shape on a real case):
// "feed the old coordinates of the vertices you will use into the Newton solver -- it should
// already be a solution... the other angles are between what will now be parts of the curve on
// the new edge." "Reducible" (cfg.vertexAngle[i]===0) is a purely COMBINATORIAL fact -- it does
// NOT mean the dropped vertex's CURRENT angle is literally 180. The original approach here (keep
// the kept vertices' original angles, sum the absorbed edges' lengths) only gives a genuinely
// closing polygon when the dropped vertices happen to already be flat -- true for every
// hand-built/expand_combo.js test case so far (by construction), false in general. The fix:
// connect the KEPT vertices by straight CHORDS through their ACTUAL positions in the original,
// already-closing m-gon -- trivially still closed (same points, same cyclic order), and whatever
// bend the dropped vertices had becomes curve detail on the new edge, not part of the new
// polygon at all. This is exactly "replace each vertex with a point on the curve" from this
// tool's very first design request, generalized to the non-flat case.
const A = c.manual.A, L = c.manual.L;
const kept = []; for (let i = 0; i < m; i++) if (va[i] === 1) kept.push(i);
const Vall = H.TC.verticesOf(A, L, m);
const Vk = kept.map(i => Vall[i]);
const K = kept.length;
const newL = Vk.map((p, k) => { const q = Vk[(k + 1) % K]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
const newA = Vk.map((cur, k) => {
  const prev = Vk[(k - 1 + K) % K], next = Vk[(k + 1) % K];
  const dIn = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) * 180 / Math.PI;
  const dOut = Math.atan2(next[1] - cur[1], next[0] - cur[0]) * 180 / Math.PI;
  return ((180 - (dOut - dIn)) % 360 + 360) % 360;
});
console.log('\nnew A:', JSON.stringify(newA.map(x => +x.toFixed(4))));
console.log('new L:', JSON.stringify(newL.map(x => +x.toFixed(4))));

// ---- what curve type does each merged edge need? GENERAL rule, any run length ----
//
// Derived and brute-force verified (2026-08-08, John: "identify how S and U curves can be made
// of different combinations... handle any case that comes up"). Setup: a merged edge made of k
// consecutive sub-edges, sub-edge i occupying [i/k,(i+1)/k] of the merged parameter and
// carrying its orbit representative's curve transformed by absolute map code c_i (Klein-4:
// bit0 = reverse parameter, bit1 = negate offset -- same convention as applyMap).
//
// The merged edge's own symmetry maps sub-edge i onto sub-edge (k-1-i), reversed. Working
// through what that demands of the two transforms gives a rule that is pure XOR on the codes:
//
//     merged is U (mirror at x=0.5)      iff  c_i XOR c_{k-1-i} == 1  for every i
//     merged is S (180-deg point rotate) iff  c_i XOR c_{k-1-i} == 3  for every i
//     otherwise                               J (no forced symmetry)
//
// ODD k has an extra clause: the middle sub-edge maps to ITSELF, so it must already carry that
// symmetry internally -- middle must be U or I for a merged U, S or I for a merged S (I is
// straight, hence both). Even k has no self-paired sub-edge and no such clause.
//
// Verified numerically against direct symmetry testing of the assembled curve: all 4^k code
// assignments for k=2..5 (1,360 cases) plus 4,352 odd-k cases varying the middle sub-edge's own
// type -- 0 mismatches. The k=2 special cases the earlier version hardcoded (code 1 -> U,
// code 3 -> S) fall out of this as c_0 XOR c_1, so nothing regressed.
//
// NOTE on John's "recursively, joining two at a time" alternative: merging pairwise doesn't
// compose cleanly, because after one merge the result is no longer a Klein-4 transform of a
// single representative (it's an assembled curve), so there's no code to XOR at the next step.
// The all-at-once rule above sidesteps that and is what's implemented.
const SYM = { 0: 'J', 1: 'U', 2: 'I', 3: 'S' };
// absolute map code of edge i relative to its orbit representative (mirrors mono2iso.js's
// repMap: follow whichEdge to the rep, XOR the mapping codes along the way)
function repMap(i) {
  let cur = i, code = 0, guard = 0;
  while (cfg.whichEdge[cur] != null && cfg.whichEdge[cur] !== cur && guard++ < m) { code ^= (cfg.mapping[cur] || 0); cur = cfg.whichEdge[cur]; }
  return { rep: cur, code };
}
// FIXED 2026-08-08 (John: "I would think J would have as many orbits as edges; S/U would have
// half as many (even), or the middle matches S/U and the rest can be J (odd)"). The original
// version required ALL sub-edges to share ONE global orbit before checking anything -- wrong
// granularity. The middle sub-edge of an odd span is legitimately its OWN separate orbit (it
// maps to itself, not to any other sub-edge), so it must never be grouped with the paired
// sub-edges' orbit requirement. Confirmed on the real counter-example this found (#1727264
// k=3): sub-edges [0,1,2], positions 0 and 2 share orbit rep 0 (the pair that actually needs to
// match), position 1 (middle) is its own separate rep 1 and is independently U-type -- exactly
// John's odd-case description, once checked per-pair instead of globally.
function mergedCurveType(origStart, span) {
  const subs = []; for (let j = 0; j < span; j++) subs.push((origStart + j) % m);
  const info = subs.map(e => ({ e, ...repMap(e), type: SYM[cfg.edgeSym[e]] }));
  let isU = true, isS = true;
  const pairs = [];
  const orbitsUsed = new Set();
  for (let i = 0; i < Math.floor(span / 2); i++) {
    const a = info[i], b = info[span - 1 - i];
    orbitsUsed.add(a.rep); orbitsUsed.add(b.rep);
    if (a.rep !== b.rep) { isU = false; isS = false; pairs.push(`pos${a.e}/pos${b.e}: different orbits (${a.rep} vs ${b.rep}) -- no forced relationship`); continue; }
    const x = a.code ^ b.code;
    pairs.push(`pos${a.e}/pos${b.e}: same orbit, c${i}^c${span - 1 - i}=${x}`);
    if (x !== 1) isU = false;
    if (x !== 3) isS = false;
  }
  let midNote = '';
  if (span % 2 === 1) {
    const mid = info[(span - 1) / 2];
    orbitsUsed.add(mid.rep);
    midNote = `, middle pos${mid.e} (own orbit ${mid.rep}) is ${mid.type}`;
    if (!(mid.type === 'U' || mid.type === 'I')) isU = false;
    if (!(mid.type === 'S' || mid.type === 'I')) isS = false;
  }
  const type = isU ? 'U' : isS ? 'S' : 'J';
  // John's orbit-count predictions, reported for cross-checking: J -> span orbits (generically
  // none shared); S/U, even span -> span/2 orbits (every pair shares one); S/U, odd span ->
  // (span+1)/2 orbits (the pairs share, plus the middle's own).
  const predictedOrbits = type === 'J' ? span : Math.ceil(span / 2);
  return { type, orbitsUsed: orbitsUsed.size, predictedOrbits, why: `${pairs.join('; ')}${midNote}` };
}

const mergedNewEdges = [];
kept.forEach((v, k) => {
  const vNext = kept[(k + 1) % kept.length];
  const span = ((vNext - v + m) % m) || m;
  if (span > 1) mergedNewEdges.push({ newIdx: k, span, origStart: v });
});
console.log('\nmerged edges (span = how many original edges combined):', JSON.stringify(mergedNewEdges));
for (const me of mergedNewEdges) {
  const subs = []; for (let j = 0; j < me.span; j++) subs.push((me.origStart + j) % m);
  const r = mergedCurveType(me.origStart, me.span);
  const orbitNote = r.orbitsUsed === r.predictedOrbits ? 'matches prediction' : `*** expected ${r.predictedOrbits} ***`;
  console.log(`  new edge ${me.newIdx} (orig edges ${subs.join('+')}): needs curve type ${r.type}   orbits used: ${r.orbitsUsed} (predicted ${r.predictedOrbits}, ${orbitNote})   [${r.why}]`);
}

// ---- verify the constructed shape against the NEW config -- but WHICH config? net-edge
// SIZES don't depend on orient/off (verified empirically), but the congruence STRUCTURE
// (whichEdge/edgeSym -- which positions land in the same orbit) does, since orient/off change
// where the boundary walk starts and which direction it runs. So: try every (orient,off) at
// the matched si and keep whichever gives the smallest residual, rather than assuming any one.
function residualFor(eqs, A) {
  let maxR = 0;
  for (const eq of eqs) {
    let sum = 0; for (let i = 0; i < A.length; i++) sum += eq[i] * A[i];
    const r = Math.abs(((sum - eq[A.length] + 180) % 360 + 360) % 360 - 180);
    if (r > maxR) maxR = r;
  }
  return maxR;
}
// Ties happen: two different (orient,off) at the same si can both hit residual 0 (found on a
// real case -- #1727337 m10->6, si=0 has o=0/f=2 AND o=0/f=5 both exact). They are NOT
// interchangeable: each declares a different edgeSym/whichEdge for the merged edge, and only one
// of them typically agrees with what the merge rule independently derives. Prefer, among
// candidates good enough to use (residual<1e-3), the one with the most merged edges agreeing
// with their derived type -- tie-broken by lowest residual -- rather than just the first-found
// minimum.
function countAgree(c2) {
  let n = 0;
  for (const me of mergedNewEdges) { const derived = mergedCurveType(me.origStart, me.span).type; const declared = SYM[c2.edgeSym[me.newIdx]]; if (derived === declared || declared === 'I') n++; }
  return n;
}
let bestFit = null;
for (const o of [0, 1]) for (let f = 0; f < newM; f++) {
  const c2 = H.config(id, newM, o, f, matchSi);
  if (!c2 || c2.impossible) continue;
  const r = residualFor(c2.eqs, newA);
  const agree = countAgree(c2);
  if (!bestFit) { bestFit = { o, f, r, c2, agree }; continue; }
  const curGood = r < 1e-3, bestGood = bestFit.r < 1e-3;
  if (curGood && bestGood) { if (agree > bestFit.agree || (agree === bestFit.agree && r < bestFit.r)) bestFit = { o, f, r, c2, agree }; }
  else if (r < bestFit.r) bestFit = { o, f, r, c2, agree };
}
console.log(`\nbest (orient,off) fit for the directly-merged shape: orient=${bestFit.o} off=${bestFit.f}, residual=${bestFit.r.toFixed(6)} deg`,
  bestFit.r < 1e-3 ? '-- SATISFIES the new structure directly!' : '-- does not satisfy it exactly (this si is right, but this EXACT point in its family is not the answer -- re-solving from here as a seed)');
console.log('that config edgeSym:', bestFit.c2.edgeSym, '(0J1U2I3S)  whichEdge:', bestFit.c2.whichEdge);

// Independent cross-check of the merge rule: the curve type we DERIVED for each merged edge
// (from the ORIGINAL config's map codes) should equal the type the NEW config independently
// declares in its own edgeSym at that position. These are computed by completely separate
// paths -- our XOR rule vs. the engine's own edge-symmetry assignment -- so agreement is real
// mutual confirmation, and disagreement means the merge rule (or the si match) is wrong.
if (mergedNewEdges.length) {
  console.log('\ncross-check (derived merged type vs. the new config\'s own edgeSym):');
  let allAgree = true;
  for (const me of mergedNewEdges) {
    const derived = mergedCurveType(me.origStart, me.span).type;
    const declared = SYM[bestFit.c2.edgeSym[me.newIdx]];
    const ok = derived === declared || declared === 'I';   // I (straight) trivially satisfies any symmetry
    if (!ok) allAgree = false;
    console.log(`  new edge ${me.newIdx}: derived ${derived} vs. config's ${declared}  ${ok ? 'AGREE' : '*** DISAGREE ***'}`);
  }
  console.log(allAgree ? '  -> all merged edges agree.' : '  -> MISMATCH: the merge rule and the matched config disagree; investigate before trusting this reduction.');
}

// closure check of the chord merge (should be near-zero by construction -- it connects points
// that already form a closed loop; mostly a sanity check now, kept because the angle-equation
// residual above is satisfied trivially even by non-closing angles, so it alone never proved
// this shape was usable -- real closure is what actually matters)
let x = 0, y = 0, dir = 0;
for (let i = 0; i < newM; i++) { x += newL[i] * Math.cos(dir * Math.PI / 180); y += newL[i] * Math.sin(dir * Math.PI / 180); dir += 180 - newA[(i + 1) % newM]; }
console.log('closure error of the chord merge (as a standalone polygon):', x.toFixed(6), y.toFixed(6));

// If the chord merge doesn't already satisfy the matched si's own equations (its orbit
// constraints, e.g. two edges forced equal that the raw chords don't quite make equal),
// re-solve FROM it as a seed: Newton should snap to the nearest point in that si's family that
// actually does. Guard against a CLAMP-FLOOR false closure (some length pinned at unpack()'s
// 0.05 lower bound, i.e. an exact 20:1 ratio -- a solver artifact, not geometry, see
// reference_two_clamp_floors memory) by falling back to the type's own default (unseeded) solve
// instead, which lands on an honest, if generic, point in the family.
const TC = H.TC;
const groups2 = H.lenGroups(bestFit.c2.whichEdge, newM);
const gapXY = Math.hypot(x, y), scale0 = Math.max(...newL);
let finalA = newA, finalL = newL, solvedNote = 'chord merge (already satisfied the new structure)';
if (bestFit.r >= 1e-3 || gapXY / scale0 >= 1e-3) {
  let sp; try { sp = TC.solveTile(bestFit.c2.eqs, groups2, newM, { seed: { A: newA, L: newL }, edgeSym: bestFit.c2.edgeSym, fdEps: 1e-6, lam: 1e-7, ftol: 1e-14, maxIt: 800 }); } catch (e) { sp = null; }
  if (sp && sp.ok && !sp.clamped) { finalA = sp.A; finalL = sp.L; solvedNote = 're-solved from the chord merge as a seed'; console.log('re-solve from seed: OK, gap', sp.gap); }
  else {
    console.log(sp && sp.clamped ? 're-solve from seed: hit the 0.05 clamp floor (suspect false closure) -- trying the default unseeded solve instead' : 're-solve from seed: FAILED to converge -- ' + (sp && sp.reason) + ' -- trying the default unseeded solve instead');
    let sp2; try { sp2 = TC.solveTile(bestFit.c2.eqs, groups2, newM, { edgeSym: bestFit.c2.edgeSym }); } catch (e) { sp2 = null; }
    if (sp2 && sp2.ok && !sp2.clamped) { finalA = sp2.A; finalL = sp2.L; solvedNote = 'DEFAULT point in the family (generic, not matched to the original shape -- see note)'; console.log('default solve: OK, gap', sp2.gap); }
    else if (sp && sp.ok) { finalA = sp.A; finalL = sp.L; solvedNote = 're-solved from seed, but STILL CLAMPED -- treat with suspicion'; }
    else console.log('default solve ALSO failed:', sp2 && sp2.reason);
  }
}
console.log(`\nfinal A (${solvedNote}):`, JSON.stringify(finalA.map(v => +v.toFixed(4))));
console.log('final L:', JSON.stringify(finalL.map(v => +v.toFixed(4))));

const outPath = comboPath.replace(/\.json$/, `_reduced_m${newM}.json`);
fs.writeFileSync(outPath, JSON.stringify({
  id, m: newM, sum: JSON.stringify(newSums[matchSi]), orient: bestFit.o, off: bestFit.f, view: 'tiles', curves: false,
  manual: { A: finalA, L: finalL }, curveEdits: {},
}, null, 1));
console.log('\nwrote', outPath);
