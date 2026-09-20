# program4 — the official tree (read this first)

Consolidates `program/` (Python pipeline), `program2/` (newer engine) and `program3/`
(paper↔Tegula index). Those three stay where they are as history; **work happens here.**

```
program4/
  py/       offline pipeline, impossibility rules, the LEDGER
  engine/   browser engine + node harness (from program2 — the FIXED tiler_core)
  index/    paper figures, the 1270-type index, and the ledger viewer
    cells/       1270 paper figure crops
    witnesses/   146 hand-drawn tiling gifs (vendored from ../../webpage)
    sources/     inputs for a data.js rebuild (manifest.js, reviewed label list)
```

## Self-contained?

**Yes**, with one deliberate exception. Verified by copying the tree to a scratch
directory and running the whole pipeline plus the engine there: all scripts pass and
every viewer asset resolves (1270 cell images, 146 witness gifs, 0 missing).

The exception is `index/build_data.py`, which needs the Tegula SQLite database
(`references/Tegula/Tilings/euclidean-1-24.tdb`, **601 MB** — too large to vendor). It
finds it via `../references/...` from program4, or `TILINGS_TDB` if you move things, and
exits with a clear message otherwise. **You almost never need it**: it only rebuilds
`data.js` from scratch, and `data.js` + `cells_index.txt` are already built and included.
Nothing in the daily loop (certify → ledger → report → viewer) touches the tdb.

## The research question

Which of the 1270 Euclidean 2-isohedral types can be **monohedral** (one tile shape
serving both orbits)? `py/ledger.json` is the single source of truth, one row per
Tegula id, joining the paper figure, the Tegula symbol and all evidence.

| verdict | count |
|:--|--:|
| impossible | 187 |
| possible | 383 |
| unknown | 700 |

Open `index/ledger.html` in a browser to browse it (filter by verdict / evidence /
wallpaper group, click any type for the full record).

## Evidence ladder — levels are NOT interchangeable

**Impossible** (both are proofs)
- `perimeter` (172) — closed form from the D-symbol. Per edge orbit E with length
  `l_E>0`, monohedral needs `sum_E (cA(E)-cB(E)) l_E = 0`, which is infeasible exactly
  when the coefficient vector is nonzero and never changes sign. `py/perimeter_rule.py`
  derive, s it; the closed form is `k=q and r>=k`. **This obstruction is exhausted** —
  the sharp per-orbit test finds nothing the closed form misses.
- `diameter` (15) — hand arguments, all requiring a mirror-bounded cell
  (`*632/*442/*333/*2222`). See `py/manual_impossible.json`. **That family is fully
  swept**: all 16 types with the tractable structure have a verdict.

**Possible**
- `L3` (139) — **proof**, exact closure certificate. Outranks `hand`: a proof beats a
  correct-looking hand drawing. See "L3 certification" below for the method — **closure
  only so far**, not yet self-intersection/boundary-touch/coincident-vertex, and only
  reaches angle-rigid types (Case A); genuine free-angle families (Case B) still need
  interval Newton/Krawczyk and are not yet attempted. 14 of the 139 are a whole
  **length-ratio family** (e.g. any rectangle, any parallelogram — not just one shape).
- `hand` (53) — John drew the tiling (`webpage/*.gif`). Strongest evidence short of a
  proof. (One of the original 54 is now also `L3` — proven, not just drawn.)
- `L2` (191) — engine solved a closing non-degenerate tile that develops a 120-tile
  patch with **0 overlapping pairs** under `engine/overlap_strict.js`.

**Unknown**
- `L1` (10) — a closing tile exists but the patch still overlaps.
- `none` (493) — searched, nothing found. Not a disproof.
- `L0` (197) — angle system admits ≥3 corners but no tile closes. **Necessary only,
  never a witness**: #8931 satisfies it and is impossible by hand argument.

## The certify acceptance bug (found 2026-07-19, fixed)

`certify.js` used to accept a config as "a closing tile was found" by testing
`sol.A`. But `solveTile` **always** returns an `A`: on failure it returns `fallback`,
the smallest-gap non-closing candidate. The real verdict is `sol.ok`, set iff the tile
closed (`relGap < 0.008`) *and* is non-degenerate (`relArea > 0.02`). Consequences:

- **119 of the 145 L1s were failed Newton searches**, not closing tiles. #25183 at
  m=8/off=3 had `relGap = 2.83` — a gap 2.83× the longest edge.
- **67 of the 353 L2s were bogus**: 54 had a *degenerate* (≈zero-area) tile that
  closes, develops into slivers, and so trivially scores 0 overlaps — these had been
  promoted to `possible`; 13 never closed at all.
- **`L0` was unreachable dead code** — the old test always passed, so the L0 branch
  was never taken. The old run recorded 0 L0s; the fixed run records 116.
- Separately, `si` (sum-type index) was a **phantom dimension**: certify looped it but
  `solveAndDevelop` had no `si` parameter, so every iteration re-solved sum-type 0.
  Threading it through opened configs never previously searched.

Net effect after the fix: `possible` 407 → **391** (67 false L2s removed, 31 genuine
new ones found via `si`), `unknown` 676 → **692**. `impossible` is untouched — the
bug only ever affected the positive side. Certify now records `relGap`/`relArea` on
every L1/L2 row so this class of failure is visible in the ledger.

## The coincident-vertex rule (John's, added 2026-07-19)

**Two distinct tile vertices at the same point is a degeneracy no curve can repair.**
Curves are mapped onto an edge from its two ENDPOINTS (`tiler_curves.mapToEdge`), so
they never move a vertex. `solveTile` now rejects any candidate with
`relSep <= 1e-5`, alongside the existing `relGap`/`relArea` tests.

Where it comes from: at a vertex with interior angle 0 the heading reverses exactly,
so if the two flanking edges are forced to equal length, `v[j-1]` and `v[j+1]`
coincide for **every** parameter value. John's #25539 combo (m=6, sum=[1,2,0,1,0,0],
orient=1, off=4) is exactly this — `A0` and `A4` are both pinned to 0 by the angle
system and the length grouping `{0,2,3,4,5},{1}` forces the flanking edges equal, so
v3=v5 no matter what you drag.

**Equal lengths matter.** A 0 angle with UNEQUAL flanking edges is fine — the longer
edge curves around the shorter one. The straight-line boundary overlaps, but the tile
is realizable. Do not generalize this rule to "any zero angle".

**Likewise, do not normalize angles mod 360 when testing.** `verticesOf` advances by
`π - A`, so -90 and 270 give identical vertex positions, but they are different tiles
once edges curve (the edge must curl the other way). See `TODO.md` — that distinction
has nowhere to live in the current model.

`relArea` cannot substitute: a zero-width spike or fold contributes no area, and
tiles with `relArea` up to 2.6 turned up with coincident vertices. The threshold sits
in an empty band — the 30 coincident solves top out at 3.2e-7, the next value up is
1.5e-3, and the 54 hand tilings bottom out at 5.0e-2.

Effect: `possible` 391 → **375** (16 L2s demoted: 13 to L1, 3 to L0), `unknown`
692 → **708**. All 54 hand types still certify at L2.

## The boundary-touch rule (John's, added 2026-07-21)

**A tile corner sitting ON a non-adjacent edge makes the boundary non-simple — for any
parameters — when that edge's type cannot curve away.** The boundary would pass through
the same point twice, once as a vertex and once as an edge-interior point, so it is not a
simple polygon and cannot be a tile. Whether a curve can lift the corner clear depends on
the edge TYPE, which is why neither area nor vertex-separation sees it. `boundaryTouch`
in `tiler_core.js` (was `straightZeroVertex`); `edgeSym` reaches `solveTile` via `opts`.

Two unrepairable cases:

- **I edge** — straight by definition, its chord *is* the edge, so a corner on the chord
  is on the boundary. Subsumes the zero-angle case (a 0 angle whose longer flanking edge
  is I drops the short edge's endpoint onto it), and also catches folds via flat 180°
  angles: **#72871** lands v4 *exactly* 1/3 along a length-3√3 I edge — the "three
  30-60-90 triangles, final edge is three legs" John spotted by eye.
- **S edge** — point-symmetric about its chord midpoint, and `buildCanon` pins the curve
  through `(0.5,0)`, so the curve cannot avoid a corner sitting there. **#25539/#25515**:
  a 0 angle whose longer flanking edge is S with short/long = 1/2 lands the corner on the
  S centre. (The 1/2 is what makes it hit the *midpoint*; other ratios miss the curve.)

J and U can bow their whole span clear of an interior point, so they are not fatal — this
is the same "only the type that can't escape is fatal" asymmetry as the I-only precursor.

Verified: **0 of the 54 hand tilings trip it**; #72871/#25539/#25515/#8938 all rejected
with the right vertex+edge; and **#72872 is NOT rejected** — its tile is a clean simple
polygon, so its L1 must come from develop (see below), not from a tile-level fault.

**Caveat — this is a per-CONFIG proof, and the L1 overlaps it targets are suspect.**
All 93 L1s develop through the multi-segment path, which is the KNOWN-BUGGY one (see
TODO.md). So an L1 overlap may be a real non-tiling OR a develop artifact. #72871's tile
self-intersects independently of develop, so it is genuinely dead; but #72872's tile is
clean and John confirms it tiles, so its L1 is very likely a develop-bug false positive.
Fixing multi-segment develop is the gate on trusting the L1/L2 split at all.

**Ledger effect: `possible` 371 → 369, `unknown` 712 → 714.** (superseded below — see 2026-07-21) Only five types moved
(#4808, #208905, #209052 L1→L0; #25528 L2→L1; #72785 L2→L0) — far fewer than the cases
the rule *rejects*, because the rule is per-CONFIG and most types have an escape config.
#72871, #25539, #25515 each keep their L1: certify rejected the boundary-touch combo but
found a different combo that closes cleanly and still overlaps. Those escape combos are
all multi-segment, so their L1 rests on the buggy develop — another reason the develop
fix is the real gate. A type only moves when the rule leaves nothing better across ALL
its combos.

## Two systemic bugs found chasing "fix multi-segment develop" (2026-07-21)

John asked to fix the multi-segment `develop` bug next. It turned out `develop` was
never broken — every glued edge matches its neighbour exactly, verified pair by pair.
The 213 overlaps on #25546 (and the bulk of the 91 L1s) were coming from two bugs
upstream of `develop`, both now fixed.

### 1. `overlapStrict` false-positived on concave tiles

It shrank each tile 2% toward its centroid before testing pairwise intersection —
correct for convex tiles, wrong for concave ones. Every multi-segment edge produces a
concave tile, and the centroid can sit in a notch or outside the shape entirely, so
shrinking toward it pushes the boundary across a shared edge into a neighbour and
invents an overlap that isn't there.

Confirmed directly against John's own read: #72872 — *"the tiling seemed to work, I
didn't see any overlaps or gaps"* — scored **24** overlapping pairs under the old
test. Exact intersection area of all 24 flagged pairs is **0**. Ground truth sides
with John, not the test.

**Fix:** exact triangle-clip intersection area (`engine/overlap_strict.js`).
Triangulate the base m-gon once — every placed tile is an affine image of that same
polygon (`develop` records each tile's placement transform), so triangulate once and
map through each tile's transform; never re-triangulate a deep/far-placed copy
directly, since composed transforms accumulate float error over many hops and
measuring flatness on a noisy copy is unreliable. Intersection area of two tiles =
sum over (triangle in A) × (triangle in B) of the convex-convex clipped area
(Sutherland-Hodgman), which has none of the concave-concave failure modes: a shared
vertex or edge clips to a lower-dimension sliver contributing ~0 area, never spurious
positive area.

Getting a *correct* concave triangulation took two more rounds, each caught on a real
ledger type before being trusted:

- Multi-segment edges are built from FLAT (180°) sub-vertices — three consecutive
  points EXACTLY collinear by construction, not a rare occurrence. "Convex + no
  vertex strictly inside" (the textbook ear test) doesn't see a vertex sitting
  EXACTLY ON a candidate ear's edge, so it can accept an ear that overlaps the
  polygon's own next tooth (#4809: an "ear" only 133/196 sample points inside the
  true polygon). Fixed by collapsing straight-through (180°, `dot>0`) vertices before
  triangulating. **Do not** collapse a 0° vertex the same way — that's a real
  zero-width spike (what the boundary-touch rule targets), not a collinear
  continuation, and removing it would change the shape.
- "No vertex strictly inside" is not *complete*: a long non-adjacent edge can pass
  straight through the candidate ear with **both endpoints outside** the ear
  triangle — the vertex-inside test never sees it (#72814: an ear scored "clear" yet
  cutting it left a remainder with shoelace area exactly 0, the signature of a
  bowtie). Fixed by also requiring the ear's diagonal not cross any other edge.

Verified at every round: all 54 hand tilings unaffected, convex regression set still
0/0, and a 158-type L2 sample stayed at 0 false flags (positive control).

### 2. `solveTile` accepted self-intersecting closing polygons

Chasing bug 1's second round turned up something bigger: #72814's "ear" failure
traced back to a genuinely self-intersecting base tile — a real bowtie, not a
triangulation artifact. Scanning every L1/L2/hand winning config in the ledger:
**86 of the 91 L1 types had a self-intersecting base m-gon.** `solveTile`'s
acceptance test (`relGap`/`relArea`/`relSep`/boundary-touch) never checked this. A
self-intersecting polygon has no well-defined inside/outside — it fails before
"developed" even means anything — so its `develop()` overlaps were never a tiling
defect. They were this.

**Fix:** reject a candidate whose non-adjacent sides properly cross
(`polySelfIntersects` in `tiler_core.js`), same pattern as the coincident-vertex and
boundary-touch rules. `overlap_strict.js` keeps a defensive copy of the check too,
for any stale config that predates the fix — on a self-intersecting base it reports
every pair as overlapping rather than trusting a meaningless triangulation.

Verified: all 54 hand tilings still `ok=true`; #8954/#3103/#25539(old config)
self-intersecting cases now correctly `ok=false`; #72814 (genuinely fine) unaffected.

### Combined effect

```
                L2    L1    L0   none
before   369    91   130    493
after    383    10   197    493
```

**14 L1s were rescued to L2** — Newton, searching past the rejected bad candidate,
found a genuinely valid config that develops cleanly. **67 L1s dropped to L0** —
nothing valid found within `m<=8` once the invalid escape config was closed off.
Only **10 L1s remain**, and they are the genuine article: 8969, 25470, 25514, 25529,
25531, 25539, 208911, 209056, 209085, 209130. `impossible` is untouched (187) — both
bugs only ever affected the positive side. All 54 hand tilings still L2, no
impossible type claims a witness, regression set still 9/9 clean.

## Four tolerance/geometry bugs found by John reading the 11 L1 combos by eye (2026-07-25)

*(Summary: the L1 tier was partly an artifact. One triangulation bug — round 4 of the same
one — plus three tolerances set tighter than the precision of what they measured. Net so
far: #25531 promotes to `possible`; the rest of John's hand diagnoses are confirmed.)*

### Round 4 of the same triangulation bug — a vertex exactly ON an ear edge

**Yes, we have done this before — this is literally round 2's bug again**, in a form
round 2's fix cannot reach. Round 2 recorded it exactly: *"'Convex + no vertex strictly
inside' (the textbook ear test) doesn't see a vertex sitting EXACTLY ON a candidate ear's
edge."* Its fix was `collapseStraight`, which only removes on-edge vertices that are the
polygon's own **flat 180° sub-vertices**. Here the offending vertex is a genuine corner
that merely *happens* to land exactly on the candidate ear's diagonal, so nothing collapses
it and the same hole reopens.

**The mechanism**, `pointInTri` (`overlap_strict.js:59-62`):

```js
return d1 > tol && d2 > tol && d3 > tol;   // STRICTLY interior (not on an edge)
```

For #25531's first candidate ear (CCW order; ear at `w1`, so `a=w0(0.9142,-0.4052)`,
`b=w1(0.7071,-1.3836)`, `c=w2(1.6213,-1.7888)`), the polygon's own vertex
`w4=(1.2071,-0.9783)` gives `d1=0.4053`, `d2=0.5731`, **`d3=0.0000`** — it lies *exactly*
on the ear's `c→a` edge. Strict `> tol` reports "not inside", the ear is accepted, and
cutting it slices straight through the polygon at `w4`.

`diagonalClear` (the round-3 fix) is not a backstop for this: it only detects **proper**
transversal crossings (`segProperCross` requires the intersection strictly interior to both
segments), whereas here the two polygon edges meeting at `w4` touch the diagonal exactly at
their shared endpoint. A tangential touch, not a crossing.

**Correction to an earlier note in this session:** an ablation run (ear loop without
`diagonalClear`) produced a valid triangulation, and I initially attributed the bug to
`diagonalClear` over-rejecting. That was wrong — the replica also differed in using an
*inclusive* point-in-triangle test (`>= -tol`, "closed triangle"), and that inclusivity is
what actually rejected the bad ear. Ablating two things at once and crediting the wrong
one; the source read settled it.

**How it surfaced.** John reviewed the 11 exported L1 combos by hand and said of #25531:
*"this is a good tiling."* The engine disagreed — but the engine was wrong:

| measure | value |
|:--|--:|
| `overlapStrict` tile0∩tile1 | 0.259654 |
| independent 1200×1200 grid, same pair | **0.000000** |
| proper edge crossings tile0×tile1 | **0** |
| vertices of either tile strictly inside the other | **0** |

Zero crossings *and* no contained vertex *and* positive intersection area is
geometrically impossible for two simple polygons — so the measure, not the tiling, is at
fault. Root cause, on #25531's own base tile:

```
polygon area (shoelace)   1.180935
sum of its 5 triangles    1.418314      <-- over-covers by 20.1%
overlapping triangle PAIRS within that ONE tile:  3
```

Every placed tile is an affine image of that same base triangulation, so each tile
"overlaps" its neighbours by exactly however much its own triangles stick out of it.
**Fixed** by making the ear test use the CLOSED triangle (`pointBlocksEar`, replacing
`pointInTri`): a vertex lying *on* an ear edge now blocks that ear. #25531's base tile then
triangulates to 5 triangles summing to exactly 1.180935 with 0 self-overlapping pairs.

### …but the triangulation was only ~20% of it. Two tolerance bugs mattered more.

Fixing the triangulation took #25531 from 1135 overlapping pairs to 937 — better, not
fixed. The rest was two **tolerances that were tighter than the precision of the thing they
were measuring**, which turned out to be the dominant effect:

**(a) `develop` deduped placements with an ABSOLUTE 1e-6 centroid tolerance**
(`tiler_core.js`). Reaching the same cell by two different routes composes a different
chain of gluing transforms, and that float error accumulates across the walk — measured at
**1.8e-5** on #25531 at 260 tiles, ~18x the tolerance. So the same cell was placed *twice*:
**595 near-coincident pairs among 260 placements**, which `overlapStrict` then correctly
reported as 100%-of-tile-area overlaps. This is the same "composed transforms accumulate
error over many hops" hazard this file already flagged for triangulation, never applied to
the dedup. Fixed by making it scale-relative (`1e-3 * tile diameter`); the safe window is
enormous — duplicates drift ~1e-5 while genuinely distinct neighbours sit 0.559 apart on a
2.414-diameter tile, so the new tolerance is ~130x above the drift and ~230x below the
nearest real neighbour. 937 → 22 pairs.

**(b) `boundaryTouch` used a 1e-6 tolerance on a tile solved by float Newton**, which
converges to ~1e-6 — i.e. the rule was stricter than the solver's own accuracy, so an
EXACT geometric coincidence read as a near-miss. **#25539 is precisely this**, and John
called it by eye from the drawn tile: *"it seems like the tile intersects itself — like v5
lands on e2."* Measured: v5 sits on the midpoint of S-edge e2 at distance **4.37e-6**, 4.4x
outside the old tolerance, so a degenerate tile was being accepted as valid. Tolerance
re-chosen by measurement, not guess: across all 288 clean (hand/L3/L2) types the closest
*legitimate* vertex-to-edge approach is **1.9e-3** (#25538), giving a safe window of
(4.4e-6, 1.9e-3) — a factor of 436. Set to `1e-4 * scale`, essentially its geometric mean.

**(c) `overlapStrict`'s noise floor, same disease.** Its 1e-6 was justified by "a genuine
closing tiling closes to ~1e-9 or better" — true of the TILE's closing gap, but this
threshold is applied to PLACED copies whose positions carry the accumulated drift from (a).
Raised to 1e-3, again by measurement: across the 11 L1 types the worst pair is either ~1e-5
(#25531 2.3e-5, #25539 9.6e-5 — pure noise, no stacking) or ~1.0 (the other nine, where
develop legitimately stacks a *degenerate* tile on itself). **A four-decade gap**, so any
threshold inside it separates noise from defect. The 383 clean types report exactly 0 pairs
over 1e-6 already, so raising the floor cannot touch them.

### Result (all four fixes, verified over every ledger type carrying an engine_config)

All 139 L3, 191 L2 and 53 hand types are **bit-for-bit unaffected** — still 0 overlaps.
Exactly three configs change, every one matching John's own by-hand reading of the combos:

| type | before | after | John's call |
|:--|:--|:--|:--|
| #25531 | L1 (937 overlaps) | **L2, 0 overlaps** | *"this is a good tiling"* ✓ |
| #25539 | L1 | config rejected (boundary-touch) | *"v5 lands on e2"* ✓ |
| #208911 | L1 | config rejected (boundary-touch) | *"edges collapse to zero"* ✓ |

Re-certified those three across all their configs: **#25531 → L2** (0 overlaps on a
120-tile patch, 47 configs tried) — so `possible` 383 → **384**, `unknown` 700 → **699**,
`L1` 11 → **10**. #25539 and #208911 each found a *different* closing config that still
overlaps, so both stay L1/unknown — correctly, per the per-config rule below. (Both new
configs have a suspiciously small `relSep` — 1.2e-4 and 3.4e-4 — so the coincident-vertex
rule may have the same too-tight-tolerance problem; worth checking next.)

**Re-certifying all 11 L1 types (not just the three) is much bigger: 5 of 11 promote to
L2.** The three-type check above only re-ran each type's *recorded* config; letting
`certify.js` search all configs shows the boundary-touch fix doing what the
self-intersection fix once did — rejecting a bad candidate pushes Newton on to a valid one:

| now L2 (0 overlaps) | still L1 | ov |
|:--|:--|--:|
| 25470, 25514, 25529, 25531, 209056 | 208911 | 65 |
| | 209130 | 115 |
| | 25539 | 183 |
| | 8953 | 328 |
| | 8969 | 430 |
| | 209085 | 677 |

So `possible` 383 → **388**, `unknown` 700 → **695**, `L1` 11 → **6** (searched to `m<=8`,
the ledger's own cap). Combos for the 6 survivors are re-exported to `combos/` with their
new configs.

**A full `drive_certify.py` re-run is still owed** before the ledger files themselves are
regenerated — these numbers come from re-certifying the 11 known L1s, and (a)–(c) could in
principle promote types that were never in the L1 set at all.

### John's accuracy-scaling test — a threshold-free degeneracy criterion (2026-07-25)

John proposed the right instrument, and it works: *"if we compute to a certain level of
accuracy, we will get gaps of just above some threshold. If we change the accuracy, the
gaps move to a different threshold. This is not tiling behavior — but round off type
computer errors. Could we test for it by running at different levels of accuracy and see
how the relSep changes?"*

**A real geometric separation is precision-INVARIANT; a roundoff artifact tracks the
tolerance.** `solveTile` now takes optional `fdEps` / `lam` / `ftol` / `maxIt` (defaults
exactly the historical values, so nothing changes unless asked); precision overrides bypass
the solve cache in both directions. Re-solving one config at four accuracy levels:

| type | default | better | tight | tightest | reading |
|:--|--:|--:|--:|--:|:--|
| #209130 L1 | 1.93e-5 | 3.73e-9 | 6.39e-8 | **1.01e-15** | → 0, vertices really coincide |
| #208911 L1 | 3.42e-4 | 8.94e-14 | 3.33e-16 | **7.05e-16** | → 0, machine zero |
| #25539 L1 | 1.18e-4 | 1.85e-5 | 5.05e-12 | **3.67e-10** | → 0 |
| #209290 L3 | 5.00e-2 | 5.00e-2 | 5.00e-2 | **5.00e-2** | rock stable = REAL gap |

That is a clean, threshold-free separator: no `MIN_VERTEX_SEP` tuning needed, because a
genuine coincidence falls to machine epsilon while a real gap does not move at all.

**It also exposed that the DEFAULT precision is too loose to trust for near-degenerate
cases.** #25538 (the lowest-relSep "clean" type at 2.70e-3, and the one that set the narrow
margin below) jumps to a stable 3.33e-2 once precision improves — its 2.70e-3 was itself a
badly-converged solve, not a tight tiling. Same for #25512 and #209085.

**Re-solving all six surviving L1 configs at high precision rejects every one of them**, and
each rejection reproduces John's own by-hand diagnosis of the drawn combos:

| type | high-precision verdict | John's reading |
|:--|:--|:--|
| #8953 | v1 lands on straight (I) edge 6 | "tiling collapses to line" |
| #8969 | v0 lands on straight (I) edge 2 | "edges collapse to zero" |
| #25539 | coincident vertices (5e-12) | "v5 lands on e2" |
| #208911 | coincident vertices (3e-16) | "edges collapse to zero" |
| #209085 | closing m-gon self-intersects | "edges collapse to zero" |
| #209130 | coincident vertices (6e-8) | "tiling collapses to line" |

So **the whole L1 tier looks artifactual** — an L1 is a near-degenerate tile that the loose
default solve failed to recognize as degenerate, which then necessarily overlaps when
developed. **Crucially this rejects those CONFIGS, not those TYPES** (see the per-config
rule below): each type must be re-searched over all its configs at high precision before
anything can be said about it, and a type with no valid config anywhere is `L0`/`none`,
i.e. still `unknown`, never `impossible`.

**Cost of raising the default: none measurable.** A 64-type sample across hand/L3/L2
re-solved at `fdEps 1e-6 / lam 1e-7 / ftol 1e-14 / maxIt 800` ran in **1 second** and left
**64/64 still clean, 0 changed**.

**DECIDED (John, 2026-07-25): do NOT raise the default precision.** *"I'm not sure we need
to raise precision — since there will always be some other tiling that pushes that
precision. I was thinking we might compare several precision levels to see if the solution
moves. Two sweeps, if the first one is doubtful, could help clear up things."* Right call:
any fixed precision can be defeated by some tiling, so precision-INVARIANCE is the real
signal, not precision-height. So the intended use is a **diagnostic**: sweep at the default,
and re-sweep the doubtful cases at higher precision; a result that moves is roundoff, a
result that holds is geometry. The `fdEps`/`lam`/`ftol`/`maxIt` opts exist to support
exactly that, and the default path is untouched.

### The 0.05 length clamp masquerades as a "real gap" (found 2026-07-25 via #209290)

`solveTile`'s `unpack` clamps every group scale from below:
`scales.push(Math.max(0.05, u[free.length + i]))`. When Newton wants a shorter edge it gets
**clipped at 0.05**, and the resulting tile then reports `relSep` of exactly `5.00e-2` — a
value that is perfectly stable under the accuracy-scaling test above, because a clamp is
stable. **I initially read #209290's rock-steady 5.00e-2 as the positive control "real
gap"; it is nothing of the kind, it is the floor.** Scan of all 383 clean types: **4 sit
exactly on the clamp** — #209290 (L3), #209472 (hand), #600180 (L2), #600516 (L2).

This does not threaten their verdicts (they still develop cleanly), but it does mean the
stored representative is a poor one to look at — which is exactly how John found it: the
`renders_good` picture of #209290 *"looked like a rhombus, I didn't see the tiny edge."*

### Picking a nicer representative from the same family

John: *"if I switch to true parameters mode, I can slide the slider to make all edges big …
This makes it easier to see. So this 'real gap' in #209290 doesn't have to be so small. If
we have small edges, can we try something like this?"* Yes — and it can be automated. A type
with free parameters is a closing FAMILY; Newton lands wherever it lands, so sample the
family (via the exported `familyFns`) and keep the point maximising the smallest edge:

| type | stored min-edge ratio | best in family | patch |
|:--|--:|--:|:--|
| #209290 | 0.0500 | **0.3659** | ov=0 |
| #209472 | 0.0500 | **0.8228** | ov=0 |
| #600180 | 0.0500 | **0.4221** | ov=0 |
| #600516 | 0.0500 | **0.4221** | ov=0 |

All four still develop with **0 overlaps**, so this is purely a better-conditioned
representative of the same family, not a different result. For #209290 the automatic pick
(`L = 1, .3661, .3659, 1, .3661, .3661, 1`) essentially reproduces the tile John found by
hand-sliding (`min-edge 0.3035`), slightly improving on it. Exported as
`combos/combo_BESTREP_*.json`. Worth doing for any type whose stored tile has a
near-invisible edge, since a tile you cannot see is a tile you cannot check by eye.

## Quadrilateral sweep, and the #25578 discrepancy (2026-07-25)

**Reflected neighbours were being silently dropped from every block analysis.** A tile placed
by an orientation-reversing transform has its vertex list wound the OPPOSITE way, so emitting
its sides as `verts[i] -> verts[i+1]` made them run against the rest of the block and
`blockBoundary`'s endpoint-chaining could never close the walk — every such block returned
"not a simple closed curve" and was skipped. Fixed by emitting a flipped tile's sides
reversed. This is what unlocked #25578's 2-tile blocks, which are exactly the reflected ones.
(Note the `mapping` codes must NOT be adjusted for that parity: tested all four Klein
corrections and only the identity reproduces John's expected match — the mapping is intrinsic
data about the abstract edge shape, and the placement isometry is already handled by
`fitIsometry`, so adjusting it double-counts.)

**Orbit does NOT determine orientation** (John: *"even if we have reflection, if the symmetry
includes a glide reflection, we might have two orientations even of the same orbit"*).
Measured across all 383 clean patches: **265 of 383 (69%) have at least one orbit containing
BOTH orientations** — e.g. #21 (p6m) orbit0 13 direct/6 reflected. So mixed-orientation
blocks are the norm, not the exception, which is why the winding bug above was suppressing a
large majority of multi-tile block analysis rather than a rare corner case. Never infer a
tile's handedness from its orbit index.

**Sweep result: every closing quadrilateral is decided.** All types with `max(k,n) <= 4` at
`m=4`, criteria 1-9, blocks up to 4 tiles: 351 types scanned, 197 have no closing config at
m=4, and the remaining give **366 (type, curve-signature) combos — 366 of 366 decided
isohedral, 0 undecided.** Criterion usage: 1:328, 2:304, 3:326, 4:320, 5:331, 6:329, 7:57,
8:40, 9:126. Before the winding fix this sweep left #25578 undecided; nothing is left now.

### RESOLVED: #25578's 2-block is criterion 8, via the reflected-tile mapping correction

John supplied the exact reading (SVGs `tiling_25578_4sides_curved (2)/(3).svg` plus, more
usefully, the explicit edge list) for m=4, sum 0, offset 1:

> 60 degrees = orbit 0, edges 0&3. 120 degrees = orbit 1, edges 2&3. 180 degrees = orbit 0
> edge 2 & orbit 1 edge 1. Note that orbit 0 edge 1 joins to orbit 1 edge 0.

Two errors on my side, both found by that:

1. **Wrong block.** The internal (glued) edge is orbit0 **edge 1**, so the block is the
   neighbour across side 1 — not side 2, which is what I had been analysing.
2. **Wrong parity correction.** With his assignment the 60-degree pair (orbit0 edges 0,3 →
   mapping 0,3) and the 120-degree pair (orbit1 edges 2,3) each give XOR 3 and pass the
   strict rule unaided. But the 180-degree side pairs orbit0 edge2 (direct tile) with orbit1
   edge1 (**flipped** tile), and that mixed pair only reaches XOR 3 if the flipped tile's
   mapping is composed with **1**. That is exactly right and not a fudge: because a flipped
   tile's sides are emitted REVERSED (the winding fix), we traverse its edges backwards,
   which is the Klein generator T_1 = 1. So the winding fix and the `^1` mapping correction
   are two halves of the same fact.

I had earlier run a scan over all four Klein corrections and **misread my own table** — `^1`
was already showing criterion 8 on the right block; I read the `^0` row (which shows
criterion 2 on two blocks) and concluded no correction was needed.

With `^1` in place:

| #25578 config | 1 tile | 2-block across the glued side |
|:--|:--|:--|
| J curves (WITH reflection), off 1 and off 3 | **nothing** — anisohedral ✓ | **criterion 8** ✓ |
| S curves (no reflection), off 1 | criterion 1 | **1, 4, 8** — John: "also criterion 4 as well as criterion 8" ✓ |

and every confirmed case still passes: `isoTesting` 87/113 unchanged, all six 3-sided types
EXACT, #601142 "iso 7" at 1 tile, #601142 m=9 "iso 8", #601143 "iso 9". The spurious
criterion-2 report on that block is gone. Note this also vindicates the REVERSED `rot`
convention — the earlier apparent conflict (same-order needed for #25578, reversed for
#601142) was an artifact of analysing the wrong block, and both now agree on reversed.

And the single S-curve tile's criterion 1 is CORRECT — John, on reviewing it: *"Good catch.
You are right that with no reflection this is criterion 1."* So #25578 is the clean
illustration of the whole point: **one combo of a type can be isohedral while another is
anisohedral.** Same rhombus, no reflection = isohedral (criterion 1 on the tile); with
reflection = anisohedral (tile matches nothing, 2-block is criterion 8).

## Systematic anisohedral hunt: triangles and quadrilaterals (2026-07-26)

Definition used, per John: a COMBO (type, sum-type, orientation, offset) is **anisohedral**
when its single tile satisfies none of criteria 1-9 while the tiling is real (patch develops
with 0 overlaps). A block match then supplies the proof that the shape tiles at all — which
is the whole reason for checking blocks: *"the reason that you are checking to see if a
block of tiles will tile isohedrally, is so we have a proof that the shape tiles?"* Yes,
exactly — and unlike exact-closure certification it holds for the whole shape family at once.

**Triangles (`m=3`, all 63 `k=n=3` types): 172 closing combos, ALL patches clean, and all
172 are single-tile isohedral. Zero anisohedral.** Consistent with every triangle tiling
isohedrally.

**Quadrilaterals (`m=4`, all 351 types with `max(k,n)<=4`): 838 closing combos, all patches
clean, 823 single-tile isohedral, and 15 ANISOHEDRAL — across 10 distinct types.** Every one
is proved to tile by a **2-tile block**, matching John's rule of thumb that the block size
follows the q:r orbit ratio and is usually 2:

| type | si/or/off | curves | block proof | ledger | wp |
|---:|:--|:--|:--|:--|:--|
| 3182 | 2/0/2 | IIJJ | crit 6,9 @2 | possible/L2 | cmm |
| 3203 | 0/1/3 | JIIJ | crit 7 @2 | possible/L2 | p3 |
| 3204 | 0/1/3 | JIIJ | crit 2,6 @2 | possible/L2 | p4 |
| 3231 | 1/0/3 | JIIJ | crit 2,6 @2 | possible/L2 | pgg |
| 25460 | 0/0/2 | IJJI | crit 6,9 @2 | possible/L3 | cmm |
| 25576 | 0/1/2 | JIIJ | crit 7 @2 | possible/L2 | p3 |
| 25577 | 0/1/1 | JJJJ | crit 3 @2 | possible/L2 | p4 |
| 25577 | 0/1/2 | JIIJ | crit 6 @2 | possible/L2 | p4 |
| 25577 | 0/1/3 | JJJJ | crit 3 @2 | possible/L2 | p4 |
| 25578 | 0/1/1 | JJJJ | crit 8 @2 | possible/hand | p6 |
| 25578 | 0/1/3 | JJJJ | crit 8 @2 | possible/hand | p6 |
| 25593 | 0/0/0 | JJJJ | crit 9 @2 | possible/hand | pg |
| 25593 | 0/0/2 | JJJJ | crit 9 @2 | possible/hand | pg |
| 25639 | 0/0/3 | JIIJ | crit 6 @2 | possible/L2 | pgg |
| 25639 | 0/1/1 | IJJI | crit 6,9 @2 | possible/L2 | pgg |

Exported as `combos/combo_ANISO_<id>_si<>_or<>_off<>.json` (curves on, since the curve type
is what makes these anisohedral — the bare quadrilateral is always isohedral). Note #25593 and
#25578 are already hand-drawn in the ledger, which is a useful cross-check that these are real
tilings rather than artifacts. Reproduce with `_dev_isohedral/sweep_aniso.js <m>`.

### How many of the 15 are really isohedral but not expressible VERTEX-TO-VERTEX?

John spotted the failure mode on #3182: *"We have two I curves with 180 degrees between them.
This string of two edges is a centro symmetric side — so the tile fits criterion 9."* The
centre of that centrosymmetric side lies at the midpoint of the collinear run, which is **not
a polygon vertex**, and the corner search only places corners at vertices — so a genuine
criterion match is inexpressible. He asked how many of the 15 share it, and hoped a collinear
I-run is the only such mechanism.

The relevant fact bounding the problem: a centre may sit at an edge midpoint **only for an I
or S curve** (John, on criterion 6: centres *"will either be at vertices, or at the midpoint
of an S or I curve"*). So an all-J combo cannot hide a midpoint centre at all. That gives
three tiers:

**Tier A — 6 robustly anisohedral (all-J, no midpoint centre possible):**
#25577 (or1/off1), #25577 (or1/off3), #25578 (or1/off1), #25578 (or1/off3),
#25593 (or0/off0), #25593 (or0/off2). These are the strongest results — no vertex-to-vertex
limitation can be concealing anything, because there is no I or S edge to host a midpoint.

**Tier B — 5 with I/S edges but NO 180-degree vertex:** #25460 (or0/off2), #25576 (or1/off2),
#25577 (or1/off2), #25639 (or0/off3), #25639 (or1/off1). John's collinear-run mechanism is
ruled out (no flat vertex exists), but a centre at the midpoint of a *single* I edge is not
yet tested — that needs midpoint corners implemented, see below.

**Tier C — 4 matching #3182's pattern exactly** (a 180-degree vertex between two I/S edges):
#3182 (2/0/2, v1 = e0(I)+e1(I)), #3203 (0/1/3, v2 = e1(I)+e2(I)), #3204 (0/1/3, same),
#3231 (1/0/3, same). All four are `JIIJ`/`IIJJ` with the two I edges adjacent and collinear —
so all four are very likely isohedral in reality, mislabelled for exactly the reason John
gives. Note all four are also `reducible` in the engine's sense (a declared vertex that is not
a real corner), so the reducible/flat-vertex gap already flagged in TODO.md is the same
underlying issue.

### RESOLVED by John (2026-07-26): exactly TWO anisohedral criteria at size 4

He adjudicated every tier-B and tier-C combo:

- **All 5 of tier B are isohedral**: #25460 = crit 9, #25576 = crit 8, #25577 (or1/off2) =
  crit 9, #25639 both forms = crit 9. So a centre at the midpoint of a *single* I edge is a
  real mechanism, not just the collinear-run case — the vertex-to-vertex limitation fully
  explains tier B as well as tier C.
- **The 6 in tier A are genuinely anisohedral**, and they fall into exactly **two** classes,
  which the all-J prediction got right: nothing in tier A was hiding a midpoint centre.

**The two classes are distinguished by SHAPE, and both are the same edge structure — a unit
quadrilateral whose four edges are all the same asymmetric (J) curve** (`whichEdge=[0,0,0,0]`,
all lengths 1, homeo `4_2 4_2`):

| class | tile | combos | realising tilings |
|:--|:--|:--|:--|
| 1 | **unit square** (90/90/90/90) | #25577 or1/off1, #25577 or1/off3, #25593 or0/off0, #25593 or0/off2 | #25577 = p4 (442), #25593 = pg (1xx) |
| 2 | **unit 60/120 rhombus** | #25578 or1/off1, #25578 or1/off3 | #25578 = p6 (632) |

Worth recording the distinction this exposes: **John's "same anisohedral criterion" is a
property of the TILE, while the criterion my checker reports is a property of the BLOCK, and
they are not the same thing.** Class 1 contains #25577 (block criterion 3, via a *direct*
neighbour, p4) and #25593 (block criterion 9, via a *reflected* neighbour, pg) — the same
anisohedral square tile realised by two different wallpaper groups, so the block proof differs
while the tile does not. Any future "how many anisohedral types are there" count must group by
tile, not by block criterion.

**Net for m=4: 838 closing combos, 823 single-tile isohedral, 9 more isohedral but only via a
non-vertex-to-vertex centre (tiers B+C), and 6 genuinely anisohedral in exactly 2 tile
classes.**

### BUILT: the checker now reproduces that adjudication on its own (2026-07-26)

Two fixes, both from John's #25460 and #3182 readings, and the 15-case set became a sharp
pass/fail test (`_dev_isohedral/test_deep.js`, **15/15 pass**):

1. **Two I sides are compatible regardless of `whichEdge`.** An I curve is a straight segment,
   so it is determined entirely by its LENGTH — two equal-length I sides are congruent no
   matter which length-group the engine filed them under, and `fitIsometry` cannot map a
   segment onto one of a different length, so the geometric fit already *is* the proof. John,
   on #25460: *"we have I curves that don't have matching whichEdge data, so we have to prove
   that they are the same length before we can apply crit 9."* #25460's own e0/e3 are
   `whichEdge` 0 and 3 with genuinely different lengths (0.4600 vs 1.2008), yet a 0.4600
   sub-segment of e3 is congruent to e0. This one change fixed all 5 of tier B.
2. **A straight run of I edges is centrosymmetric as a whole** (`straightRun` + the new branch
   in `centro`). Its centre is the midpoint of the WHOLE run, which is generally not one of its
   joints, so the point-by-point fit failed whenever the pieces were unequal — the joint had no
   partner. John's #3182: *"two I curves with 180 degrees between them; this string of two
   edges is a centro symmetric side, so the tile fits criterion 9."* This fixed all 4 of tier C,
   and #3182 now reports criterion 9 exactly.

Also built and wired, but **not needed by any of the 15**: `refinePolygon` + `checkBlock`'s
`opts.deep`, which inserts extra corner candidates INSIDE I sides (at distance d from each end
for every d among the other sides' lengths, plus the midpoint — the cut position is determined
by the length it must match, not a free parameter, so the candidate set is finite and small).
Per John, that expensive pass is reserved for combos the cheap pass calls anisohedral: *"I
would do this complex testing only on those that fall out as possible anisohedral tiles."* It
may matter at higher m; at m=4 the two fixes above were sufficient, and every one of the 15
resolves at shallow depth.

**Effects, all in the right direction:**
- `isoTesting.txt` ground truth **87/113 → 89/113**, and #601142 m=8/si=1/or=1/off=2 now finds
  its criterion 7 (previously a miss).
- m=4 sweep re-run: 838 closing combos → **832 single-tile isohedral, 6 anisohedral** — the
  checker independently reproduces John's list and his two classes, with no hand input.
- All 8 unit tests and all six confirmed 3-sided types unchanged.

### `fitIsometry` was fitting a SIMILARITY, not an isometry (found 2026-07-26)

John asked why #3162 — a 30-60-90 triangle, sides 1 / 0.866 / 0.5, all I curves — was being
reported as criteria 1,2,6,8,9, saying *"at first glance I thought it was only crit 1 also."*
Tracing the corner assignments showed criteria 2, 6, 8 and 9 each pairing sides of **different
length** (glide e1=0.866 onto e2=0.5; rotate e2=0.5 onto e0=1.0; rotate e1=0.866 onto e2=0.5).
No isometry does that.

**Root cause**: `directIso`/`reflIso` (from `tiler_core`) fit a **similarity** through two
corresponding points, and `fitIsometry` never checked the scale. The per-point verification
loop cannot catch it either, because a similarity maps *every* point consistently — confirmed
on a 3-point test. It is sound in its original use (`sideMotion` glues congruent sides of
congruent tiles, so the scale is 1 by construction) but not for comparing arbitrary side pairs:
without the check **any two straight segments match regardless of length**, and more generally
any two SIMILAR sides do.

Fixed by requiring `hypot(M[0], M[2]) == 1` in `fitIsometry`. Ground truth is unchanged
(`isoTesting` still 89/113, all six 3-sided types exact, `test_deep` 15/15, all 8 unit tests),
so this removed only false positives.

**#3162 is criteria 1, 2 and 6 — exactly John's own deeper reading**, and 2 and 6 need the
`deep` pass, which is what finally earned its keep:

| criterion | side lengths a..f | mechanism |
|:--|:--|:--|
| 1 | ∅, ∅, 1.0, ∅, 0.866, 0.5 | the three whole sides, each centrosymmetric — classical triangle result, found shallow |
| 2 | ∅, 1.0, 0.866, ∅, **0.25**, **0.25** | e2 **split at its midpoint**; the two halves glide-reflect onto each other |
| 6 | ∅, **0.25**, 1.0, ∅, 0.866, **0.25** | same split of e2 as the glide pair, e0 and e1 as the centrosymmetric sides |

John: *"the last two involve some fancy splitting edges to make glide reflections, then using
the rest of that edge for a centro-symmetric side."* Exactly that.

**Consequence for the CSV**: `iso_criteria` (renamed from `tile_criteria` at John's request,
since anisohedral criteria are coming) is the SHALLOW, strictly vertex-to-vertex result, and is
therefore a LOWER BOUND on the criteria a tile satisfies — the deep pass only runs on combos
that come out anisohedral. That is deliberate and John's stated preference: *"I like the
shallow run first ... maybe even note which have no vertex to vertex isohedral tiling. I don't
really care which isohedral type there is. I don't care if we have a complete iso list."* So
an empty `iso_criteria` is the signal of interest, not the criterion numbers.

### PRECISION GUARD on anisohedral candidates (2026-07-26)

`#25521 si=1/or=0/off=4` was the one anisohedral candidate with no block proof at any size.
It was an artifact: its default solve had `relGap = 7.7e-4` and angles out by 0.08 degrees
(251.93 / 35.99 / 108.07 / 107.93 / 36.08), which fails every geometric fit against the 1e-5
tolerance and so LOOKS anisohedral. Re-solved tightly the angles snap to exactly
252 / 36 / 108 / 108 / 36 (`relGap 4.5e-15`) and criteria 2,6 appear on the tile, 1,2,3,6 on a
2-block. **A badly-converged solve is a false positive in the dangerous direction**, so
`sweep_aniso.js` now re-solves every candidate at high precision (John's own
precision-invariance test) and re-runs the shallow check before calling anything anisohedral.
Both versions exported as `combos/combo_25521_5sides_{default,hiprec}.json`.

### Pentagons (m=5), and per-size CSVs (2026-07-26)

`_dev_isohedral/sweep_aniso.js <m>` now writes one CSV per polygon size to
`program4/criteria_m<m>.csv` — a row per closing combo with angles, lengths,
whichEdge/mapping, single-tile criteria, deep-pass criteria, the aniso verdict, and the
smallest block that proves tiling, plus homeo/wp/orbifold/evidence from the ledger.

Final counts (after the isometry fix and the precision guard):

| m | combos | clean patch | vertex-to-vertex isohedral | **ANISOHEDRAL** | overlapping patch |
|--:|--:|--:|--:|--:|--:|
| 3 | 172 | 172 | 172 | **0** | 0 |
| 4 | 838 | 838 | 832 | **6** (3 types) | 0 |
| 5 | 1129 | 1102 | 1044 | **58** (22 types) | 27 |

(m=5 was 59 before the forward-only search bug below was fixed; the fix moved exactly one
combo — #209337 si0/or0/off2, John's fam 36 — from anisohedral to isohedral by criterion 8,
precisely the case that exposed the bug and nothing else.)

Pentagons are far richer: **59 anisohedral combos across 23 types** — #3193, #3235, #25460,
#25520, #25523, #25540, #25543, #25550, #25576, #25577, #25639, #72684, #72788, #72952,
#209100, #209105, #209209, #209210, #209215, #209220, #209222, #209337, #209403. Unlike m=4
(where every anisohedral combo was all-J) the curve signatures are varied and mostly S-heavy:
`SSSSS`, `SSISS`, `SJJJJ`, `JJIJJ`, `SUSUS`, `UUUUI`, … and **all 59 are proved to tile by a
2-tile block**, which keeps holding John's q:r rule of thumb. (#25521, the one combo that
previously had no block proof, was the precision artifact described above and is no longer
anisohedral.)

Note `deep` rescued nothing at any size — every anisohedral verdict is one where neither the
vertex-to-vertex search NOR cutting inside I sides finds a criterion.

### The U-curve rule is now VALIDATED (2026-07-26)

It had been the last unvalidated row of `edgeCompat` — derived from the J rule under U's own
identification (T_1 is the no-op, so `v ~ v XOR 1`, collapsing both tests to `XOR in {2,3}`,
i.e. **U cannot distinguish direct from indirect**) but exercised by no ground truth.

Found where it is load-bearing by re-running with U relabelled as J:

| type | curves, mapping | with U rule | if U behaved like J |
|:--|:--|:--|:--|
| **#41** | `UUUU` [0,2,0,2] | 3, 5, **9** | 3, 5 |
| #356 | `UIUI` [0,0,2,0] | **1**, **4**, 5, 6 | 5, 6 |
| #362 | `USUS` [0,0,2,1] | **1**, 5, 6 | 6 |

**John adjudicated #41 (m=4, si=0, or=0, off=1): criteria 3, 5 and 9** — exactly what the
checker reports, no more and no less. Criterion 9 there rests entirely on the U rule accepting
a pair the J rule rejects, so this validates the ACCEPT direction; and since he confirms the
list is exactly 3,5,9 with nothing extra, it is evidence against over-permissiveness too. His
reasoning: *"it looks like a square, which would be required for crit 9"* — confirmed, that
combo solves to a unit square (all angles 90.0000, all lengths 1.000000) with all four edges
the same U curve.

So all four rows of `edgeCompat` (J, I, S, U) now have ground-truth backing, and the ~122
U-curve isohedral verdicts across m=3/4/5 stand.

### m=5 families, and why "geometrically possible" proves nothing (2026-07-26)

Grouping the 59 anisohedral m=5 combos by tile (angles + lengths + curve type per edge + which
edges share a curve, canonicalised up to rotation, reversal AND winding — winding matters, see
the m=4 note) gives **38 families, which over-splits**: at m=4 every anisohedral tile was rigid
so numeric shape identified it, but **50 of the 59 at m=5 have free parameters**, so two combos
from one continuum land on different shapes and separate. John reviewed all 38 and merged 17 of
them away, leaving **15 anisohedral pentagon families** — but he flagged the whole reading as
*"all my placements are guesses, not positive."* Treat it as a strong prior, not ground truth.

Two of his merge questions were checkable and both come back NO — the tiles differ in edge
GROUPING, not just shape, and seeding either family at the other's shape does not converge
there: **fam 9 ⊄ fam 25** (#209215 `whichEdge=00000` equilateral vs #209100 `01111`, 15.7° apart)
and **fam 3 ⊄ fam 14** (#25540 `00000` all-length-1 vs #25523 `00004` with a 2.74 edge, 100.6°
apart).

**The important negative result**: he called 6 of the 38 isohedral where the checker says
anisohedral. Testing what is GEOMETRICALLY possible — handing the checker fake edge data
claiming every edge is an I curve in one group, so the gate always passes *and* every edge may
be split — gives an upper bound on what any correct rule could find:

| family | real | +deep | +relaxMapping | MAXIMAL (split all, no gate) |
|:--|:--|:--|:--|:--|
| fam 2, 4, 23, 24 | — | — | 2,6 | **1,2,6** |
| fam 8, 36 | — | — | — | **nothing** |
| fam 1 *(John: aniso)* | — | — | 2,3,5,6 | **2,3,5,6** |
| fam 19 *(John: aniso)* | — | — | — | **nothing** |

**fam 1 is the calibration**: John is confident it is anisohedral, yet it is fully
"geometrically possible" under maximal splitting. So geometric possibility does **not** imply
isohedral — the combinatorial gate is doing essential work, and loosening it would manufacture
false ISOHEDRAL verdicts. Consequently:

- **fam 8 and fam 36 are very likely genuinely anisohedral** (nothing exists even at the upper
  bound), so those two of John's six are probably mistaken — and the checker is on solid ground.
- **fam 2, 4, 23, 24 are undetermined.** They have the identical signature to fam 1: possible
  geometrically, blocked by the mapping rule. Nothing available distinguishes them from fam 1,
  so the mapping rule was NOT amended. (The specific block, in fam 23 #25576 `JIIIJ`: criterion
  2 wants sides `[e4]` and `[e0]` — the two J edges, same group, mappings 0 and 3, XOR 3 — to
  GLIDE, but John's rule gives glide only at XOR 2. They are adjacent, sharing v0, which may be
  the relevant difference from the opposite/translate pairs his rule was stated for.)

**What would actually settle it**: build the tiling a criterion match implies (corner assignment
+ its isometries generate a group; lay out the orbit) and check it is a valid tiling — no
overlaps, covers the plane. That verifies isohedrality independently of the gate entirely, and
would adjudicate fam 2/4/23/24 and validate the gate itself rather than assuming it.

### FIXED: the corner search only walked the boundary FORWARD (2026-07-26)

The criteria templates are not symmetric under reversing the boundary — criterion 8 is
`[a b]` at 60, then `[c d]` at 120, then `[e]` — so a tile whose 120-pair comes first fits the
template only when walked the other way, and `eachCornerTuple` only ever went forward. Those
matches were invisible.

Found from John's reading of **fam 36 / #209337** (`JJJSJ`): *"edges 0 and 4 rotate by 120
degrees, edges 1 and 2 rotate by 60 degrees, edge 3 is centro symmetric. This is criterion 8."*
His cycle order is 120-then-60, the template's is 60-then-120. Forward search: nothing.
Reversed: **criterion 8**, immediately. John confirmed the principle: *"For criterion 8, the
order of the cycles for 60,120,180 can be reversed."*

`checkPolygon` now searches both directions and unions the results (reversed hits flagged
`reversed:true`). Not blanket permissiveness — both confirmed-anisohedral controls (#3193 fam 1,
#25550 fam 19) stay empty in both directions, and every regression is unchanged: 8 unit tests,
`test_deep` 15/15, `isoTesting` 89/113, m=3 still 0 anisohedral, m=4 still exactly John's 6.

**Still open after this fix**, with John's readings recorded for whoever picks it up:
- **fam 2, 4, 23, 24** — his: the edges ROTATE to each other, not glide; criteria 8 or 9; the I
  curves must be split to match. Geometrically possible (MAXIMAL gives 1,2,6) but nothing found
  with the real gate even reversed. Note the criteria he names (8/9, rotation) are NOT the ones
  the relaxed run finds (2/6, glide) — so the mapping rule blocking 2/6 may well be CORRECT and
  the real miss is that 8/9 are never found at all.
- **fam 8 / #209209** (`SSISI`) — his: *"edges 2 and 4 will translate to each other. If one is
  shorter, cut off the same amount on the other one near edges 0 or 1. edges 0 and 1 are centro
  symmetric. Edge 3 and any leftovers from edge 2 or 4 are centro symmetric. This is criterion
  1."* The geometry checks out — e2 (0.9334, I) and e4 (0.9054, I) are exactly ANTI-parallel,
  which is `trans()`'s convention, and the needed 0.9054 cut is already in refinePolygon's
  candidate set — yet nothing is found even at MAXIMAL permissiveness. So this is a structural
  gap in how pieces are assembled into sides, not a gate or splitting-candidate issue.

### John's PINNED-RATIO test for a combo we doubt (`_dev_isohedral/doubt_check.js`, 2026-07-27)

A tile can be accepted by `solveTile` and still not be a tile: `relGap` is normalised by the
LONGEST edge, so a big max/min spread hides a real failure to close. Measuring the gap against
the SHORTEST edge separates cleanly -- across all 5325 accepted tiles at m=3..6 the median is
1.1e-15 and the 99th percentile 1.5e-13, then nothing until three outliers at 7.5e-2, 1.0, 1.0.

But John supplied a better test than any threshold. His #209209 proof was *"when I grow edge 2
I can see the gap between v0 and the endpoint of edge 5 grow by the same amount ... this is a
true link"*, and he generalised it: **walk the true-parameter family and watch whether
gap/shortest-edge stays CONSTANT while the shape varies.** If it is pinned, the gap is
structurally tied to the edge and the tile can never close, whatever the parameters. And
crucially the constant need NOT be 1 -- *"we might have several edges that are forced to be the
same length that are the smallest length, then the gap might be related to this smallest length
by a ratio other than 1"* (sqrt(2), sqrt(3), sqrt(3)/2 ...). So the test must not care what the
constant IS, only whether the ratio can be driven to zero.

Implemented and run (500 sampled family members each):

| combo | gap/shortest min..max | edge spread ranged | verdict |
|:--|:--|:--|:--|
| #209209 m=6 si6/or1/off2 | 1.000 .. 1.000 | 77 .. 1003 | **PINNED -> cannot close** (John's own proof, reproduced) |
| #209100 m=6 si5/or1/off1 | 1.000 .. 1.000 | 75 .. 553 | **PINNED -> cannot close** (newly identified; was counted isohedral by crit 1) |
| #72675 m=5 si0/or1/off4 | 2.999e-2 (constant) | 50.0 .. 50.0 (did NOT vary) | never reaches 0, but the sampler never left one shape -- inconclusive by this test, though John proved it impossible by hand |
| #25578 m=4 si0/or1/off1 *(control)* | 2.3e-16 | 1.0 | genuinely closes -- correct |

The first two are textbook: the ratio is pinned to 12 significant figures while the shape spans
a 13x range of edge spreads. #72675 is the honest caveat -- its family sampling stayed stuck at
one shape (spread exactly 50.0, i.e. pinned by the 0.05 length clamp), so the test could not
exercise it; an earlier wider sample did show the ratio moving 7.5e-2 -> 3.0e-2 without ever
reaching zero.

Per John this is a TARGETED tool, not a sweep gate: *"I wouldn't check all combos with it, but
only ones we doubt."* Usage: `node doubt_check.js <id> <m> <si> <orient> <off>`.

**Still to decide**: whether #209100 (and the other two) should be removed from the ledger /
CSVs. #72675 is currently counted isohedral by criterion 6 and #209100 by criterion 1, so both
are live false positives in the published counts.

### ROOT CAUSE of all three: the 0.05 clamp games a DIAMETER-relative gap (2026-07-27)

The three doubted combos are not three separate mysteries -- they are one bug, and it has a
one-line discriminator. `unpack()` floors every group scale at 0.05
(`tiler_core.js:229`, `Math.max(0.05, ...)`). When the true solution wants a group scale of
**zero**, Newton drives it down, hits the floor, and stops -- reporting a shape that does not
close. `solveTile`'s `ok` test does not catch this because `relGap` divides the closing gap by
the shape's **diameter**, and a clamped shape is precisely one with a huge diameter-to-shortest
ratio, so the gap looks tiny:

```
                       clamped  raw gap   relGap    relGapMin   L
  #209209 6 si6/1/2    true     5.00e-2   1.76e-3   1.000       [1 1 0.05 28.43 28.43 1]
  #209100 6 si5/1/1    true     5.00e-2   7.93e-3   1.000       [1 1 1 0.05 6.31 6.31]
  #72675  5 si0/1/4    true     3.74e-3   3.74e-3   7.48e-2     [1 0.05 1 0.05 0.05]
  #25578  4 si0/1/1    false    8.62e-15  8.62e-15  8.62e-15    [1 1 1 1]     <- genuine
```

Every false positive has an edge sitting *exactly* on 0.05, and for the two hexagons the gap
**equals the entire shortest edge** (`relGapMin` = 1.000). Against a real closure at 8.6e-15,
that is not a threshold judgement call -- it is fifteen orders of magnitude.

So `relGapMin` (gap normalised by the SHORTEST edge, not the diameter) is the honest test, and
`clamped` flags exactly the shapes where it matters. This also explains why `doubt_check.js`
could not exercise #72675: the sampler was stuck at edge spread exactly 50.0 = 1/0.05, i.e. the
clamp pinning the family, not a limitation of the pinned-ratio idea.

**Proposed gate** (not yet applied -- see HANDOFF.md): treat `clamped && relGapMin > 1e-6` as
NOT `ok`. That should drop #72675 and #209100 from the isohedral counts automatically and needs
no case-by-case adjudication. Blast radius is unmeasured: `criteria_m3..6.csv` do not carry
`clamped`/`relGapMin` columns, so add them to `sweep_aniso.js` and re-run m=3..6 (~6 min total)
before deciding. Reproduce the table above with `node _dev_isohedral/clamp_verify.js`.

### Two side-comparison fixes, and hexagons (2026-07-26/27)

John adjudicated six m=5 families as isohedral that the checker called anisohedral. Both
causes turned out to be in how SIDES ARE COMPARED, not in the gate (which the quiz below
proves correct), and both were found from his own worked readings.

**1. `simplifySide` — equal-edge-count was too strict.** Every side comparison fits point
lists and required the two sides to have the same number of edges, so a side subdivided into
collinear I pieces could never match an equal-length side that was not subdivided. On #25460
the best corner assignment had side edge-counts `[4,1,1,1,3]` and failed `rot(d,e,90)` purely
because d had 1 sub-edge and e had 3. `simplifySide` now drops interior joints lying exactly
on the line between their neighbours when both flanking edges are I. This alone solved **fam 8
= criterion 1** (John's exact reading) and lifted `isoTesting.txt` ground truth **89 -> 99 of
113** — the same defect had been suppressing ten #1728474 cells.

**2. Merge collinear I runs BEFORE generating cut candidates — John's idea.** For #25576 his
recipe needs a cut 0.2711 into e3, which is `e1 - e2` — a DIFFERENCE of lengths, not any single
length or run-sum, so `refinePolygon` never offered it (it gave only the midpoint 0.4276). My
first fix was to generate difference-candidates; it worked but blew the refined boundary from
n=18 to **n=44** and took **73 seconds for one combo**. John: *"Why can't you consider 2&3 as
joined into one larger segment?"* Exactly right and much better: e2+e3 are collinear I edges,
so treat them as ONE segment of length 1.9486, and the wanted cut is simply 1.3645 along it —
a plain target length again. **n=20, 0.5 seconds (146x faster)**, and the difference-candidate
code is gone.

**All six of his disputed families now confirmed**, with both anisohedral controls (#3193
fam 1, #25550 fam 19) still empty:

| family | checker finds | John said |
|:--|:--|:--|
| fam 2, fam 4 (#25460) | **9** | "criteria 8 or 9" |
| fam 23, fam 24 (#25576) | **8** | "criteria 8 or 9" |
| fam 8 (#209209) | **1** (and 2) | "isohedral of criterion 1" |
| fam 36 (#209337) | **8** | "criterion 8" |

### Sweep results through m=6 (hexagons)

| m | combos | isohedral | degenerate | patch overlaps | **ANISOHEDRAL** | types | time |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 3 | 172 | 172 | 0 | 0 | **0** | 0 | 1.3s |
| 4 | 838 | 832 | 0 | 0 | **6** | 3 | 10.6s |
| 5 | 1129 | 1078 | 4 | 0 | **47** | 18 | 61.8s |
| 6 | 3264 | 3093 | 20 | 1 | **150** | 47 | 272s |

**Every single one of the 150 hexagon results is proved by a 2-TILE block** — no exceptions at
any size so far, which keeps holding John's q:r rule of thumb. Block criteria used: 5 (43x),
1 (36x), 4 (32x), 3 (16x), 6 (15x), 2 (6x), 7 (2x) — criteria 8 and 9 never appear as the block
proof at m=6. Commonest anisohedral curve signatures: `JJJJJJ` (57), `SSSSSS` (21), `SJJJJS`
(8), `UUUUUU` (5).

The 20 m=6 degenerates are almost all coincident-vertex (16), plus 3 boundary-touch and 1
self-intersecting — i.e. the precision guard is rejecting them for stated geometric reasons,
not for "patch overlaps". Exactly ONE combo at m=6 still fails the overlap test (#209209
si6/or1/off2, `IIISSI`, ov=68), against 27 before the reorder; worth a look, since John's
expectation is that a correct procedure should never fail it.

### THE EDGE-MATCHING TABLE IS FULLY VALIDATED (2026-07-26)

John asked for *"a multiplication table or something to check finding edges that are rotations,
translations, glide reflections or reflections for different curve types and different
mappings"*, or failing that a visual quiz. Built `program4/edge_quiz.html`: 30 questions, each
drawing the SAME underlying curve under two `mapping` codes (blue = A, red = B, arrows showing
traversal), asking which rigid motions carry A onto B. **He answered all 30, and the model
reproduces every single one exactly** (`_dev_isohedral/quiz_diff.js` does the comparison):

| type | John's answers | model |
|:--|:--|:--|
| J (no symmetry) | direct at XOR 3, indirect at XOR 2, else nothing | identical |
| U (line symmetric) | direct at XOR {2,3}, indirect at XOR {2,3} | identical |
| S (point symmetric) | direct at XOR {0,3}, indirect at XOR {1,2} | identical |

So `edgeCompat` is now backed end-to-end rather than resting on a single confirmed cell per
row, and **"U cannot distinguish a direct motion from an indirect one" is confirmed rather than
inferred** — his U answers give all four motions at XOR 2 and 3 alike.

Two bugs in the quiz itself, both caught by John: the "S" curves were **not point-symmetric**
(the apex sat at (0.5, 0.22), but point symmetry sends (x,y) → (1−x, −y) so the curve must pass
through (0.5, 0) — they were being drawn as J curves), and the equal-code cases for U had been
filtered out as "trivial" when U 0→0 is in fact the least-backed cell in the table. Both fixed;
symmetry of the generated curves is now asserted programmatically.

**This settles the fam 2/4/23/24 question in the gate's favour.** The pair being blocked there
is two J edges at XOR 3 that criteria 2/6 need to GLIDE — and John's own answers confirm J at
XOR 3 is direct-only, never a glide. So the mapping rule was RIGHT to block those, the
`relaxMapping` matches at criteria 2/6 were spurious, and the genuine gap is exactly what John
said it was: criteria **8/9** (rotation-based, with the I curves split to match) are never
found. No rule change is needed — the search is what is incomplete.

(Notation note for the record: `^` in this file and in the code means bitwise XOR, not
exponentiation. "mapping XOR 1" flips the low bit, 0<->1 and 2<->3.)

### Sweep reordered and made ~60x faster (2026-07-26)

John's ordering: **isohedral test -> precision guard -> overlap test LAST**, plus *"after we
find one isohedral criteria, let's stop for that combo."* Both implemented:

- `checkPolygon`/`checkBlock` take `{any:true}`: stop at the FIRST criterion. The sweep only
  asks "isohedral at all", so enumerating the rest was pure waste — and it lets the reversed
  pass be skipped entirely whenever the forward pass already hit.
- Block-proof search is smallest-first and stops at the first block that proves it, instead of
  enumerating every block up to 4 tiles to find the minimum (that alone was 10.8s of m=4's
  18.2s, for six combos).
- Overlap moved last, after the precision guard, so a badly-converged solve is fixed before it
  can be mistaken for an overlapping patch.

| size | total | solve | isohedral | precision | overlap | block proof |
|--:|--:|--:|--:|--:|--:|--:|
| m=3 | **1.1s** | 1.0s | 0.0s | 0.0s | 0.0s | 0.0s |
| m=4 | **7.6s** | 7.4s | 0.1s | 0.1s | 0.0s | 0.0s |
| m=5 | **40.8s** | 35.7s | 0.3s | 4.1s | 0.0s | 0.7s |

(m=4 was ~1124s before these changes.) **`solve` is now ~88% of the cost** — the criteria
machinery is essentially free. Going to m=6+ means speeding up `solveTile` (28 Newton restarts
per combo), not the checker.

**John's expectation confirmed: with the reorder, ZERO combos fail the overlap test at any
size.** He predicted it — *"In real life, I don't think anything should fail the overlap test.
It means that we have a bad procedure somewhere"* — and he was right: all 27 previous failures
were procedure artifacts, 11 clean tilings wrongly excluded and 16 degenerate tiles that the
precision guard now rejects properly (and reports *why*: boundary-touch, coincident vertices).

### AUDITED: the 27 m=5 combos with overlapping patches (2026-07-26)

Re-solved each at high precision and re-developed. **11 of 27 become completely clean (ov=0)**
— their "overlap" was the same badly-converged-solve artifact as #25521. The other 16 are
correctly excluded, but for a better-stated reason than "patch overlaps": at high precision the
tile itself is rejected as degenerate (boundary-touch or coincident vertices).

Of the 11 rescued, ten are isohedral (criteria 1 / 2,6 / 1,2,6 / 1,2,8) — but **#25520
si=3/or=0/off=3 comes back clean with NO criterion at all, i.e. a NEW anisohedral candidate**
that the sweep had been silently dropping. One case, #72675 si=0/or=1/off=4, still overlaps
(ov=31) and has `relGap 3.7e-3`, so it is poorly converged and should not be trusted either way.

Exported as `combos/combo_OVLP5_<id>_si<>_or<>_off<>.json` (high-precision solves).
**Consequence: `sweep_aniso.js` should re-solve at high precision BEFORE the overlap test, not
only for anisohedral candidates** — otherwise clean tilings keep getting excluded up front. The
m=5 anisohedral count of 58 is therefore a slight undercount (at least 59 with #25520).

### CORRECTION: fam 3 IS contained in fam 14 (my earlier "no" was wrong)

John: *"I moved 25523 until it was close to having the same edge length, using the true
parameters button... I'm pretty sure that any shape we could get from 25540, we can get in
25523."* He is right, and my earlier test was broken: it seeded the host family at the guest's
shape **without trying cyclic rotations**, so it only ever tested the identity alignment.
#25523 (si=2/or0/off3, `whichEdge=[0,0,0,0,4]` — edge 4 in its own length group and therefore
free) reaches #25540's shape (`whichEdge=[0,0,0,0,0]`, all lengths forced equal) **exactly at
rotation 2: max angle difference 0.000 deg, all five lengths 1.0000**. So 25540's family is
contained in 25523's, and fam 3 / fam 14 merge.

Re-checked fam 9 vs fam 25 the same way (all rotations AND reversals): still **not** contained
(best 15.7 deg / 41.2 deg), so that answer stands. Any future family-merge test must sweep
rotations and reversals — comparing default solve points is meaningless.

**The 27 overlapping-patch combos, now audited (see above)** — originally excluded
as `n/a` rather than judged. m=3 and m=4 had none, so this is new at m=5 — and given how much
of the L1 tier turned out to be measurement artifact, some of these 27 may be real tilings
being wrongly excluded. Next thing to audit.

### m=4 anisohedral answer, machine-derived rather than adjudicated:

| class | tile | combos | block proof |
|:--|:--|:--|:--|
| 1 | unit square, all four edges the same J curve | #25577 or1/off1, #25577 or1/off3 | crit 3 @2 tiles |
| 1 | (same tile, different tiling) | #25593 or0/off0, #25593 or0/off2 | crit 9 @2 tiles |
| 2 | unit 60/120 rhombus, all four edges the same J curve | #25578 or1/off1, #25578 or1/off3 | crit 8 @2 tiles |

### (superseded) earlier framing of the #25578 discrepancy

#25578 is a 60-120-60-120 rhombus (`4_2 4_2`, p6, hand-drawn). Its four m=4 configs split by
curve type, and the two J-curve ones (orient=1) are John's *"2 types of anisohedral shapes"*:

- **single tile: matches NOTHING** — confirms they are anisohedral as tiles ✓
- **2-tile block across a REFLECTED neighbour: matches criterion 2** ✓ isohedral, confirming
  John's *"you will find that a 2 block tiles isohedrally"*

But John says that 2-block is **criterion 8**, not 2 — *"The block of these two tiles is
isohedral from criterion 8. The direct version is also criterion 8 for a block of two
tiles."* Under the current `rot` convention, criterion 8 has **no geometric match** on that
block at any of the corner assignments, gate or no gate.

The conflict is precisely the `rot` orientation convention, and the two ground truths
disagree about it:

| convention | #601142 m=8 si=1 or=0 off=4 (John: "iso 7") | #25578 2-block criterion 8 |
|:--|:--|:--|
| reversed(X)->Y *(current)* | found at 1 tile ✓ | 0 geometric matches ✗ |
| X->Y same order | not found at all ✗ | found, canonical pentagon form ✓ |

Reversed is also what the derivation gives (a rotation about the shared corner D fixes D and
sends C to E, which is `reversed(c) -> d`), so it is kept — flipping it trades one confirmed
case for another. **Unresolved**: one of the two readings is being modelled wrongly. Likely
candidates: the corner-to-side labelling for criteria 7/8/9 may be off by one relative to
Table 58, or criterion 2 and criterion 8 both genuinely hold on this block and John's "not
crit 2" is about which is the *natural* description rather than which is satisfiable. Worth
resolving with John directly on one small explicit example (which vertices are A..F).

Related, also unresolved: John asks *"do you see how the S curve ones are not any of the
isohedral?"* — but the checker finds criterion 1 on the single S-curve tile, and 1,4,8 on its
2-block. He separately confirms **4 and 8** for that 2-block, so 4 and 8 agree; the open part
is criterion 1 (and whether the single S tile should match anything at all).

### Bug in the combo exporter (fixed, and why it matters)

The first `combo_LOWSEP_*` export wrote a foreign sum-type into every file — John hit it
immediately: *"saved sum-type [1,0,0,0,0,1,0] is not a sum-type of #209290 at 7 sides"*
(that sum is #209203's). Cause: the export loop called `H.runSums(m)` **without**
`H.loadType(id)` first, and `runSums` works off whichever type is currently loaded — the
collection loop had left some other type in place. Fixed, and the exporter now validates
each written sum against `runSums` for that type before reporting success. All other combo
files re-checked: the 33 in `combos/old stuff/` are fine (that script reloaded the type per
iteration). **Any script that touches the engine's global type state must reload before
every query** — this is the same class as the `#tileLeng` staleness noted in TODO.md §6.

### Follow-on: `MIN_VERTEX_SEP` looks like the same disease, but the margin is thinner
### (probably MOOT if the default precision is raised — see the accuracy-scaling test above)

4 of the 6 surviving L1 configs have a tiny `relSep` (near-coincident vertices, i.e. an edge
collapsed to zero — exactly John's hand diagnosis for #208911 and #209085): #209130 1.93e-5,
#25539 1.18e-4, #208911 3.42e-4, #209085 4.94e-4, against `MIN_VERTEX_SEP = 1e-5`. #209130
clears the gate by only 1.9x. Measured window: the smallest relSep among all 383 clean
(hand/L3/L2) types is **2.70e-3** (#25538, which is also the closest legitimate
boundary-touch approach — it is simply a very tight tiling). So the safe window is
(4.94e-4, 2.70e-3) — a factor of only **5.5**, versus 436 for boundary-touch. Raising to
1e-3 would catch all four and still leave #25538 clear by 2.7x, but that is a much thinner
margin than the other fixes had, so **left unchanged pending John's call** rather than
adjusted unilaterally.

### All triangles are decided (2026-07-25)

Answering John's "are all triangles decided? / can you recognize all isohedral?" for the
`k=3, n=3` family at `m=3` (where every tile is a literal triangle), using the
table-faithful criteria 1-9 on blocks of up to 4 tiles:

- 63 types; **18** have no closing config at m=3; 45 close, giving **90** distinct
  (type, curve-signature) combos — signature matters because the same type can be S-curve
  at one orientation and I-curve at another (see the `edgeCompat` notes in TODO.md).
- **90 of 90 are recognized isohedral. Zero undecided.** John's prediction ("I'm betting
  they will all be isohedral") holds exactly.

For comparison, the pre-rewrite checker left 22 types with nothing matching at all — the
difference is criteria 6-9 existing plus the corrected per-side rule structure. Recognition
is NOT complete in general, though: the `isoTesting.txt` sweep on #1728474 still sits at
87/113 (98/113 once John's "iso 6 not 5" re-reading is counted), the remaining gap being
mostly reducible/flat-vertex configs — see TODO.md.

**Why the existing verification battery could never have caught any of this.** Every round
so far was validated with *positive controls only* — "all 54 hand tilings unaffected,
convex regression set still 0/0, 158-type L2 sample still 0 false flags." Those all check
that **clean things stay clean**. A bug that invents a *spurious* overlap on a type already
classified `L1` changes nothing observable: it was overlapping before and it overlaps
after. The whole L1 tier is a blind spot for that battery by construction — which is
exactly why John reading the 11 exported L1 combos by eye found in one pass what four
rounds of automated regression testing could not. **Add the self-checks that need no known
answer**: after triangulating, assert (a) `Σ|triangle area| == |polygon area|` and (b) no
two triangles of one polygon overlap; after developing, assert no two placed tiles have
near-identical centroids. All are intrinsic invariants that would have caught rounds 2–4
immediately, on any polygon, without a labelled example.

## An L1/degeneracy verdict is PER-CONFIG and never by itself proves a type impossible

John, 2026-07-25, on the other 9 L1 combos he diagnosed by hand (#8953/#209130 "tiling
collapses to line"; #8969/#25470/#25514/#25529/#208911/#209056/#209085 "edges collapse to
zero"): ***"we don't want to mark impossible unless we can prove that all forms are
impossible. Just because we find one impossible example doesn't prove it."***

So a hand-diagnosed degeneracy on the ledger's *chosen* config is evidence about that
config, not about the type. Encoding these degeneracies as `solveTile` rejection rules (the
way the coincident-vertex and boundary-touch rules already work) is still worth doing — but
its effect is to make the *search* honest, pushing Newton past a bad candidate toward a
valid one, exactly as the self-intersection fix did (14 types were *rescued* to L2 that way,
not condemned). A type only earns `impossible` when the rule leaves nothing across **all**
its combos, which is the same caveat already recorded under the boundary-touch rule above.
The 9 stay `unknown`.

## The reducible-config bug in the offline search (found + fixed 2026-07-24)

`engine/test_harness.js`'s `parseCfg` (used by `certify.js`/`drive_certify.py`) did a blunt
`txt.includes('impossible')` check — which fires just as hard on `"impossible - reducible"`
as on a genuine defect. But `engine/tilerTest.js`'s `parseCfg` (the interactive UI) already
gets this right: only `"no angles"`/missing data blocks; `reducible` (`aniso.js`'s
`imposs[0]`, set when a declared m-gon vertex isn't a genuine corner — the same physical
shape has an equivalent description with fewer sides) is surfaced as a note, not a blocker,
same as `"self intersection"`. John: *"I would prefer if we note that it is reducible ...
but still allow the tiling to be shown"* — that's already true in the UI; the offline
certify search was the one silently discarding these configs, for no geometric reason.

Fixed by mirroring the UI's logic into `test_harness.js`. Re-ran the full pipeline
(`drive_certify.py` → `case_a_dump.js` → `certify_case_a.py` → `build_ledger.py`) fresh
(not resumed — every config needed re-checking under the fixed `parseCfg`, so the old
`certify_results.json` was moved aside rather than resumed from). Effect: **no `possible`
verdict changed** (`L3`/`L2`/`hand` split identical: 139/191/53) — every type that could
reach `L2` via a reducible config could already reach it some other way. But the `unknown`
tier's breakdown is now materially more accurate: 78 types moved `none → L0` and 1 moved
`none → L1`, since previously-invisible reducible configs are now actually searched, even
though (this run) none of them turned out to close cleanly. Net: `L0` 197→275, `none`
493→414, `L1` 10→11. A real, worth-having correctness fix, just not a verdict-mover this
time — the search is honestly more complete now, which is what "L0"/"none" are supposed to
mean.

## Two calibration results worth keeping

1. **All 54 hand-drawn tilings are independently rediscovered by the engine at L2**,
   and no witness of any kind lands on a proven-impossible type. The positive and
   negative sides agree everywhere they meet. Re-verified after the certify fix —
   still 54/54, and each one now checked to have a genuinely closing (`sol.ok`)
   non-degenerate tile, not just a returned `A`. This is what bounded the damage:
   the calibration set was never affected, which is why the bug hid for so long.
   Still 54/54 after the coincident-vertex rule too — none of the 54 comes close to
   tripping it, which is the main evidence the rule is sound rather than merely
   convenient.
2. **The old grid overlap test over-claimed.** `test_harness.overlap()` samples a fixed
   44×44 grid over the patch bbox, so it is resolution-dependent and misses real
   overlaps — it called 5 of a 37-type sample clean where exact pair testing finds
   hundreds of overlapping pairs in the *same* 40-tile patch. Replacing it with
   `overlap_strict.js` (exact polygon-pair intersection on tiles shrunk 2%) demoted
   **50 types** from L2 while keeping all 54 hand witnesses — good specificity *and*
   sensitivity. `test_harness.js` still uses the grid test for its own regression
   output; certification does not.

## What L2 is not

Float arithmetic over a finite patch. It is strong evidence, not a proof: a tiling that
closes numerically may rely on an algebraic coincidence floats happily fake, and a
120-tile patch cannot see a collision that first happens further out.

## L3 certification (started 2026-07-24, Case A / closure-only)

`engine/case_a_dump.js` scans every `L2`/`hand` row's winning config and keeps the ones
where `TilerCore.angleStructure` shows **every angle is already pinned** by the
integer-coefficient closing equations (`free.length === 0`) — no Newton search needed for
the angles at all, since the 2D crystallographic restriction (rotation orders only
1/2/3/4/6) forces every angle that appears into a small set of rational-degree values.
139 of the 383 qualify. `py/certify_case_a.py` (needs `sympy`) then, per candidate:

1. Re-solves the SAME linear angle system over exact rationals (not trusting the engine's
   float `rref` — the float layer never enters the proof's trust chain).
2. Builds the two vertex-closure expressions (`sum L_i cos h_i`, `sum L_i sin h_i`,
   `h_i` accumulated exactly as `verticesOf` does) using `sympy`'s exact algebraic-number
   arithmetic for `cos`/`sin` of the now-known rational-degree angles.
3. If more than one length group exists, this system is **linear** in the length-ratio
   unknowns (angles are fixed, so `cos`/`sin` are just algebraic constants) — solved
   exactly via `sympy.linsolve`, not a numeric search.
4. Checks the closure expressions equal exactly `0`: a fast high-precision numeric gate
   first (`sympy.N(..., 50)` — anything not `< 1e-45` is reported, not silently dropped,
   since that would mean an L2's closure is a float coincidence, a real finding), then a
   full symbolic collapse to literal `0`.

**Result: 139 of 139 candidates certified** — 125 `symbolic_zero` (a single exact shape;
e.g. #108: 45°/45°/90°, length ratio exactly `sqrt(2)/2`, the familiar right-isoceles-
triangle ratio, recovered symbolically) and **14 `symbolic_zero_family`** (a whole
continuous range of length ratios closes, not one shape — e.g. #41: four 90° angles,
any rectangle closes for any aspect ratio; #9037: a parallelogram, any ratio).

**The family cases needed a real fix, caught by John.** The first pass treated a linear
system reporting free symbols in its solution (`sympy.linsolve` returning e.g. `r1` itself
as "the solution" instead of a fixed number) as *not certified* — backwards. A linear
system doing that means those symbols are genuinely unconstrained by closure: the
equations are an identity, true for **every** value, not a search that failed to pin one
down. John: *"For #41 ... these are actual rectangles ... Why does this not count as
solved?"* — it should have. Fixed by recognizing the family as a stronger result than a
single point, then separately checking POSITIVITY holds across the claimed range (that
part is not automatic — #209290 turned up a genuine bounded case, `r1 =
sqrt(3)/3*(1-r2)`, only positive for `r2` in `(0,1)`, matching John's own hand
derivation of the same bound from an equilateral-triangle vertex-matching argument).
Every family certificate records its exact `valid_range`, not just "some positive value."

**Scope still open, in order:**
1. Self-intersection / boundary-touch / coincident-vertex, exactly, for the 139 already
   closure-certified (closure alone doesn't rule these out).
2. **Case B** — the 244 L2/hand rows with a genuine free *angle*. Needs interval Newton /
   the Krawczyk method: substitute `c=cosθ, s=sinθ` with `c²+s²=1` to turn the closure
   system polynomial, then certify a unique root in a small box around Newton's estimate.
   Existence of the found witness is all that's needed (not global uniqueness), and the
   same certified box would extend to the checks in (1) and to `overlap_strict.js`'s
   already-exact triangle-clip test, for free.
3. A general argument (once, per wallpaper group) that checking one fundamental domain
   plus its immediate symmetry-neighbors is *provably* enough to rule out a collision
   anywhere in the infinite periodic tiling — turns the finite patch check into an actual
   proof of global non-overlap, not just "120 tiles looked clean."

## Pipeline

```bash
cd py
python perimeter_rule.py        # sharp perimeter test over all 1270
python gen_impossible_list.py   # -> monohedral_status.json + monohedral_impossible.md
python parse_witnesses.py       # webpage/*.gif -> witnesses_hand.json (146 gifs, 54 types)
python drive_certify.py 8 20    # engine sweep -> certify_results.json (~70s, resumable)
node ../engine/case_a_dump.js   # -> case_a_candidates.json (angle-rigid L2/hand rows)
python certify_case_a.py        # -> certify_case_a_results.json (exact closure, Case A)
python build_ledger.py          # -> ledger.json  (runs consistency gates)
python report.py                # -> LEDGER.md
python sync_from_ledger.py      # rewrite derived lists from the ledger
```

`build_ledger.py` fails loudly if a witness ever lands on a proven-impossible type —
that gate is the main guard against a bad rule slipping in.

## Hygiene note

Three divergent exclusion rules used to live in the tree (`dsym_extract.py` `n>k=q=r`
→144, `sweep.py` `n>k=q` →248, `gen_impossible_list.py`), which left **43 proven-impossible
types still in the candidate list**. `sync_from_ledger.py` now regenerates
`monohedral_candidates.json` from the ledger (1083 rows). `engine/templates.js` still
carries those 43 as a harmless superset — the engine only reads `byId` on request — so it
is not rebuilt.

## Next steps

0. **If `HANDOFF.md` exists at the program4 root, read it first** — it holds whatever was in
   flight when the last session ended (currently: the #25524 deep-dive profile, not yet run,
   and the 0.05-clamp gate, root-caused but not applied). It is scratch; delete it when done.
1. **L3 certification** — 139 of 383 done, all of Case A (closure-only), 14 of them a
   whole length-ratio family rather than one shape. Next: self-intersection/boundary-
   touch/coincident-vertex for these 139, then Case B (interval Newton) for the other
   244. See "L3 certification" above.
2. **The 10 L1s** are the most interesting unknowns: a tile closes but the patch
   collides. Either the config search is missing the right (m, sum, orient, offset), or
   these are genuinely impossible and want a new invariant. These are now trustworthy —
   every one has `relGap ≤ 0.0066`, `relArea ≥ 0.020` and `relSep ≥ 0.0044` in the ledger.
3. **Automate the "longest side" diameter argument** — it settled 6 of the 8 most recent
   hand cases and looks mechanical given the cell and the cutting chord.
4. **The 493 `none`** at m≤8 (m≤12 / m≤24 for the big ones) may just need a larger m.
5. **Re-sweep with the `si` dimension live.** A large share of the L2s and L1s
   come from `si > 0` — configs unreachable before the fix. The `none` and `L0` sets
   were never searched over sum-types either, so some of them may still fall.

---

# The 0.05 clamp gate — APPLIED, and the #25524 deep dive (2026-07-27)

## The clamp gate is in

John confirmed all three doubted combos impossible, by hand and independently:

> *"The three combos saved in combos folder are impossible. 209100,209209 impossible. gap
> matches shortest length. 72675 impossible. edges would have to be zero for the tile to
> really close."*

Both halves of that are literally the diagnostic. `relGapMin = gap / min(L)` reads **exactly
1.000** for #209100 and #209209 — "gap matches shortest length" — and #72675 has three groups
sitting on the floor, i.e. "edges would have to be zero". So the gate proposed in the previous
session is now applied in `tiler_core.js` as `clampFake`:

```
clamped && relGapMin > 1e-6   =>   not ok
```

It did **not** cost accuracy. Ground truth on `isoTesting.txt` went **99/113 -> 101/113**: two
combos that previously disagreed with John now agree. All three suspects flip to `ok=false`;
the #25578 control still closes at 8.6e-15. `clamp_verify.js` reproduces this.

Note the `criteria_m3..6.csv` on disk **predate** this gate and still contain the phantom
closures. The blast-radius re-sweep has NOT been run.

### Two different floors, and the 50.0 mystery solved

There are two clamps, not one, and they are different numbers:

| function | file | floor | 1/floor |
|---|---|---|---|
| `solveTile`'s `unpack` | `tiler_core.js:229` | **0.05** | 20.0 |
| `familyFns.unpack` | `tiler_core.js:338` | **0.02** | 50.0 |

This explains the standing puzzle of `doubt_check.js` reporting "edge spread exactly 50.0" and
"shape genuinely varied: no". That is not a property of the tile — it is the *sampler* parked on
its own 0.02 floor. Any doubt-check run whose spread pins at 50.0 has explored nothing, and its
verdict should not be read as evidence about the family.

## #25524 deep dive: `deep` is the bottleneck, not `solve`

`node deep_one_type.js 25524 12 300`, budget 300s/size:

```
 m  combos  close |  solve   iso   prec   deep   ovl   blk |  total  | iso aniso degen | max n
 4      8      4  |    0.1   0.0    0.0    0.0   0.0   0.0 |    0.1s |   4    0     0  |   0
 5     20      6  |    0.3   0.0    0.0    0.0   0.0   0.0 |    0.3s |   6    0     0  |   0
 6     72     11  |    1.0   0.0    0.0    0.0   0.0   0.0 |    1.0s |  11    0     0  |   0
 7    140     24  |    2.3   0.2    0.5   19.5   0.0   1.6 |   24.0s |  13   10     1  |  20
 8    304     24  |    4.8   0.2    0.4   99.2   0.0   2.9 |  107.6s |  17    7     0  |  26
 9    330*    23  |    6.4   0.5    0.5  304.5   0.0   6.9 |  318.8s |  17    6     0  |  36
                                                       (* budget stopped it at 330 of 504)
```

Overall: **deep 93.7%**, solve 3.3%, blk 2.5%, prec 0.3%, iso 0.2%, ovl 0.0%.

**This reverses the previous reading.** `solve` looked like ~88% of cost in the m=3..6 all-types
sweep only because at m<=6 nothing survives to the deep stage — there were no candidates to be
expensive. The moment real candidates appear (m=7), `deep` takes over completely, and by m=9 it
is 96% of the size's time. **`solve` is not worth optimising. The corner search is the whole
problem.**

The measured growth confirms the stated complexity is real, not pessimistic:

| step | boundary n | deep time | measured | (n_new/n_old)^6 |
|---|---|---|---|---|
| m=7 -> 8 | 20 -> 26 | 19.5 -> 99.2s | 5.1x | 4.8x |
| m=8 -> 9 | 26 -> 36 | 99.2 -> 304.5s | 3.1x | 5.6x (budget truncated the size) |

So `eachCornerTuple`'s O(n * C(n+4,5)) ~ n^6 is exactly what is being paid, and the
"a few hundred thousand at n=16, which these small blocks never exceed" comment at
`isohedral_criteria.js:450` is **already false** — m=7 reaches n=20 and m=9 reaches n=36.

### Where the n actually comes from

n is not the side count. It is the side count *after* `refinePolygon` inserts candidate corners,
and that insertion is itself quadratic: `isohedral_criteria.js:537-540` walks every start `s` and
every run length `t`, pushing a cut candidate per consecutive run, from both ends. So m=9 turns
into n=36, and n=36 costs 36 * C(40,5) = 2.4e7 tuples per combo.

**This is the thing to replace, and the replacement is already specified.** `isohedral.txt` is
John's anchor-and-extend method: instead of enumerating all six-way cuts and testing each, it
*derives* the corners — take a vertex pair (i,j), let the translation Tij define the matching,
walk outward while edges keep matching, and read the cycles off directly. That is O(n^2) anchors
times an O(n) walk, i.e. **n^3 against the current n^6**. At n=36 that is a ~10,000x reduction.
Keep the present brute-force search as the oracle to test it against — it is validated at
101/113 and should stay the reference, just not the production path.

## Results for #25524

**23 tile-level anisohedral combos**, all with a 2-tile block proof (i.e. the shape genuinely
tiles): 10 at m=7, 7 at m=8, 6 at m=9-so-far. Block criterion is 6 for 17 of them, 2 for 5,
1 for one. Every one is exported to `combos/combo_ANISO_25524_m<M>_si<si>_or<or>_off<off>.json`.
No `NOBLK` cases — nothing was left without a tiling proof.

Four of the 23 came out with an edge group on the 0.05 floor (ratio exactly 20.0). These are
**not** the #209100 disease — they close to 1e-13 relative to the shortest edge. `floor_probe.js`
pins the short group at 0.02 .. 1.0 and re-closes the angles around it: all four still close
across that whole range, so they are real 1-parameter families and 0.05 was just where Newton
stopped. `rebalance_combos.js` re-exports them at short = 0.4-0.5 (ratio 20.0 -> 2.0-2.5), and
re-checks at the new parameter — all four are **still** anisohedral with overlap 0 there. Those
are much easier to look at than the slivers.

Worth remembering as a general habit: the exported representative of a family is whatever point
the solver stopped at, which is systematically the least readable member. Rebalancing before
export is cheap.

## Next steps from here

- **Rewrite the corner search along `isohedral.txt`**, oracle-tested against the current one.
  This is the single change that raises the size ceiling; everything else is noise at 3%.
- **Blast-radius re-sweep** for the clamp gate: add `clamped`/`relGapMin` columns to
  `sweep_aniso.js`, re-run m=3..6, regenerate `criteria_m3..6.csv`. Until then those CSVs
  overcount. #72675 (counted iso 6) and #209100 (counted iso 1) come out of the published
  counts automatically.
- **#25524 above m=9** needs the rewrite first; m=9 already blew a 300s budget at 65% of its
  combos, and m=10 would be ~15 min by the n^6 law.

---

# Crossing-tile false rejection — FIXED (2026-07-27)

John: dropped `combo_25524_9sides.json` (m=9, si=6, or=1, off=8) with S/U curveEdits on edges
0/1 — "if we make some edges cross - it bans the full tiling - even if the curved line version
doesn't have crossings." Also: "I can download the SVG of the full tiling, even though I can't
see it on the screen."

Reproduced exactly. The tile's 9 edges are all S/U (`SUSSSUSSS`, edgeSym) — none are the rigid
I type — so nothing forces the boundary onto its straight chords. The straight m-gon crosses
itself at sides `1×5, 1×8, 2×5`; the curved boundary built from the same `curveEdits` (verified
using the real `TilerCurves.buildCanon`/`applyMap`/`curvedTile`, with each edge's orbit rep and
Klein-4 code read off `whichEdge`/`mapping` exactly as `tilerTest.js`'s own `curveSet()` does)
has **zero** self-intersections.

Root cause was two copies of the same bug in `engine/tilerTest.js`:

1. **`drawFullCanvas` (the hard gate, ~line 604):** tested `polyCross(straightVerts)`
   unconditionally and returned early ("full tiling not drawn") whenever it fired, before ever
   checking whether curves were even on. The curved-boundary check on the next line was gated
   behind `!crossMsg`, so it never ran once the straight check had already failed. This is
   exactly why the SVG export (a separate code path with no such gate) came out clean while the
   canvas showed nothing.
2. **`setShapeStatus` (the status pill, ~line 700):** same pattern — `tileSelfCross()` (straight)
   was computed unconditionally and always took priority over `curveBad` (curved) in the
   displayed message. After fixing (1) alone, the tiling drew correctly but the status line
   still screamed "✗ sides cross: 1×5, 1×8, 2×5" and, since more of the patch was now actually
   being checked, "✗ 33670 overlapping tile pairs" — both computed on the straight skeleton,
   both misleading once curves resolve the crossing.

Fix: both now branch on `curvesOn()` — the curved boundary is authoritative when curves are on
(matches what's actually drawn), the straight one only when curves are off (then straight IS
what's drawn). The overlap **count** (`OverlapStrict`, always straight-skeleton — curves are
outside its model entirely) keeps reporting its number but now carries an explicit caveat
`(straight-edge check; curved boundary not verified)` and no longer alone forces the status pill
red when curves are on.

Verified in the actual running app (Playwright, headless Chromium, `engine/tilerTest.html`,
driven via the page's own `loadCombo`/`render` globals — no dev server needed, static file):
- **#25524 m=9 si=6, curves ON:** now draws 260 tiles, no false crossing message, overlap count
  carries the caveat. Screenshot shows a coherent interlocking patch, no visible garbling.
- **Same combo, curves OFF (regression check):** still correctly blocks — "tile self-intersects
  (straight sides 1×5, 1×8, 2×5) — full tiling not drawn," since with curves off the straight
  edges genuinely are what's drawn and they really do cross.
- **#25460 (ordinary combo, curves ON, no crossing):** unaffected — "✓ closes · 260 tiles · ✓ 0
  overlaps," no caveat text since ov=0 doesn't trigger it.

Residual, not fixed: `overlap_strict.js` has no curved-boundary version, so a genuine curved
tile-vs-tile overlap (not just self-crossing) still can't be detected today — only reported with
a caveat when curves are on. Building actual curved-polygon intersection area is future work if
it ever matters in practice.

---

# The rewrite is done: engine/isohedral_criteria_fast.js (2026-07-27)

Built the vertex-only fast isohedral checker per the plan above, validated against every piece
of ground truth in the repo, then re-ran the #25524 deep dive. Full results below.

## Design rulings that shaped it (John, this session)

1. **No cuts, ever, for now.** Work only with the boundary's actual vertices. Accepts a known
   regression: #25460's own criterion-9 reading (rotating one edge onto a 0.46 sub-length of an
   unrelated 1.2008 edge) needs a cut and is out of scope. Notably, **no concrete ground-truth
   case actually exercises this loss** — `oracle_diff.js` checked all of tier A/B/C, all 23
   #25524 combos, and the full `isoTesting.txt`/#601142/#601143/CONF suites, and found zero
   real cut-dependent losses anywhere. The concession is real in principle but hasn't cost
   anything in practice yet.
2. **A deferred idea, not built:** reclassify a strict-engine "anisohedral" verdict, using the
   OLD (cut-based) engine as a secondary pass, into "genuinely anisohedral" vs "anisohedral but
   becomes isohedral if a vertex is added." The seam for this is left obvious in
   `deep_one_type.js` (see its comments) but nothing implements it yet.
3. **Centro-symmetry needs no cut and no geometry — but needs MORE than edge-type matching
   alone.** First cut of this rule (abccba edge pairing only) produced a genuine false positive
   on #4's equilateral triangle: three identical same-group edges "pair" combinatorially under
   any assignment, so the whole boundary registered as one degenerate centro side with corners
   B..F all collapsed onto the anchor. John's fix: **the vertex angles between matching edges
   must also sum to 360°** ("one bulges out while the other must bulge in"), order reversed for
   centro (abccba, same as rotations/translations) vs same-order for glides (abcabc). This
   closes the gap exactly — verified: the triangle's flanking angles are 60+60=120, not 360,
   correctly rejected; #3182's genuine 180° joint is 180+180=360, correctly accepted.
4. **A second, independently-found gap: collinear I-runs.** The offset-equation algebra assumes
   "length" = raw offset difference, which is simply false wherever a "reducible" boundary has
   a straight (180°) run of I edges the tile's own construction never collapsed. Fix: merge
   maximal collinear I-runs into one logical edge before running the offset generators — but
   run the search on BOTH the raw boundary (a redundant-but-real vertex is still a legal corner
   in its own right, confirmed necessary by #601142 m=8/si=1/or=1/off=2, where criteria 2-5 use
   exactly such a vertex) AND the merged one (gets criterion 4's real match on #1728474
   m=8/off=5, raw side lengths 3,1,1,1,1,1, correct only once the 3-edge run collapses to 1),
   and union the results. Known incompleteness: a long run where a genuine match needs SOME of
   its redundant vertices as corners and others absorbed isn't covered — no concrete case found
   yet, same "deal with it if we meet one" posture as point 1.

## Validation

- `test_centro_combinatorial.js`: 7/7 standalone unit tests, including a named regression guard
  reproducing the #4 false positive exactly.
- `validate_all_fast.js`: **101/113** on `isoTesting.txt`, identical to the old engine's own
  current score (verified by re-running the unmodified old engine fresh — the 12 disagreements
  are pre-existing and pixel-identical between engines, not new). Sections B (6 confirmed
  3-sided types) and C (8 direct #601142/#601143 quotes) are **exact matches**, including
  matching the old engine's own block-size-per-criterion breakdown (`1@1t,2@1t,...` etc.), not
  just the final match set.
- `oracle_diff.js`: tier A (3 genuinely-anisohedral controls), tier B (5 combos), tier C (4
  combos) from the 2026-07-25 size-4 adjudication, plus all 23 #25524 anisohedral combos from
  this session's earlier deep dive — **zero unexpected divergences anywhere**.

## Performance: #25524, m=4..14 (`node deep_one_type.js 25524 14 300`)

| m | combos | old total | new total | speedup | iso/aniso/degen (both engines agree) |
|---|---|---|---|---|---|
| 7 | 140 | 24.0s | **2.4s** | 10x | 13/10/1 |
| 8 | 304 | 107.6s | **5.8s** | 18x | 17/7/0 |
| 9 | 504 | 304.8s (incomplete, 122/504) | **11.3s (complete)** | old never finished | 24/12/1 |
| 10 | 880 | never reached | **17.1s** | — | 42/10/1 |
| 11 | 1320 | never reached | **30.3s** | — | 39/20/1 |
| 12 | 2040 | never reached | **44.3s** | — | 57/13/0 |
| 13 | 2860 | never reached | **73.4s** | — | 57/48/5 |
| 14 | 4088 | never reached | **98.6s** | — | 72/35/2 |

Overall time breakdown across m=4..14: **solve 96.0%, everything else 4.0%** (prec 2.7%, blk
0.9%, iso 0.3%, ovl 0.1%) — the exact reversal of the pre-rewrite profile (deep 93.7%, solve
3.3%). The corner search is no longer the bottleneck; the Newton solver is, and it was never
touched. m=4..8's iso/aniso/degen counts match the pre-rewrite baseline exactly at every size
checked; m=9-14 are new territory the old engine never reached within its 300s/size budget.

## What's next

- **Solve is now the bottleneck** (96%). If #25524 (or any type) needs to go past m=14, that's
  where the next profiling pass should look — not the criteria checker.
- The deferred augmentation-detector (point 2 above) and the long-collinear-run gap (point 4)
  are both real but currently theoretical; revisit if a concrete case ever surfaces.
- `engine/isohedral_criteria.js` is untouched and remains the oracle. Every other caller
  (`sweep_aniso.js`, the ~35 other `_dev_isohedral` scripts) still uses it — only
  `deep_one_type.js` was switched over. Swapping the rest is a separate, later decision.

---

# References folder: what's in it, and the maximality result (2026-07-28)

John added `references/` with three outside sources and asked what's worth testing.

## What each source actually is

- **`snakes in the planes.pdf`** — Paul Church's MMath thesis (85pp). §2.1.4 isohedral tiling
  criteria; §3.1 boundary words; **§3.2 boundary-based tiling criteria**; §4 Redelmeier
  enumeration; **§5.1 isohedral test, §5.2 anisohedral/non-tiling search**; §6 result tables.
- **`tactile-js`** — Craig Kaplan's library: all 81 usable isohedral tiling types (of 93), with
  parameters, and **the same J/U/S/I edge taxonomy John uses**. It is a working ES module
  (`lib/package.json` has `"type":"module"`); the "can't get it to work" is almost certainly ES
  modules over `file://`, which needs a local http server — fixable, not broken.
- **`Polyform tiling.html`** — Joseph Myers's page: exhaustive k-anisohedral counts for
  polyominoes/hexes/iamonds/kites by order.

**John's scoping (both correct and load-bearing):** not interested in polyforms as a validation
programme — *"I want the angles to be able to be free"*, polyform examples only as curated test
cases. And: *"Church's thesis uses restricted angles"* — confirmed in §3.1, his alphabet is
`0..N-1` lattice **directions** with **unit-length steps** (N=4 polyominoes, 6 hexes/iamonds;
polysnakes generalise to N=8,10,... but stay finite-alphabet and unit-step). Negation, rotation
and reflection are arithmetic mod N. So **none of Church's string machinery transfers verbatim**
to free angles, grouped variable edge lengths, and curved edges.

## The one idea that IS angle-independent: maximality

Church §3.2 (p.38-39): segments in a criterion decomposition are always **maximal** —
centrosymmetric and rotational segments maximal *with respect to a fixed centre*, translational
and glide pairs maximal *with respect to a fixed pair of aligned locations* — and

> "the fact that the 9 isohedral criteria each define a legal way of surrounding a tile with
> copies of itself actually ensures that no decompositions with non-maximal segments will ever
> be found."

His justification is **geometric** (the criteria describe legal ways of surrounding a tile), not
lattice-based, so it plausibly survives free angles — but he only ever tested restricted angles.

### Tested it: `_dev_isohedral/maximality_probe.js`

For every criterion match the oracle engine finds across 137 probed configs (68 solved, 54 with
at least one match — section C ground truth, the 2026-07-25 tier A/B/C combos, and #1728474 at
m=6..16 across every offset), grow each side and re-test its relation.

**Result: 0 non-maximal segments.** Consistent with Church's claim holding for free angles.

**A methodology warning worth keeping.** The first version of this probe reported **8
counterexamples — and every one was wrong**, because it grew a centro side at *one end only*.
A centro side's centre is its own chord midpoint, so a one-ended extension **moves the centre**
and therefore tests a different segment entirely; Church's notion is explicitly "maximal with
respect to a fixed centre". Growing both ends at once (and, for `rot`, growing the pair outward
from their shared corner) is the correct test, and under it every apparent counterexample
vanished. The `trans`/`glide` pairs are still only probed in a weaker one-ended form — a
rigorous paired-extension test has to slide the anchor when side `a` is involved and was not
attempted — so the claim is verified rigorously for centro/rot and only weakly for trans/glide.

**Why this matters:** if only maximal runs can ever appear, a corner search needs only the
maximal run at each anchor, never a prefix. That is strictly stronger than the anchor-and-extend
sharing derived on 2026-07-27, and it retires that note's open problem about criteria 4/5 not
benefiting (the `D = A + n/2` linkage stops mattering if prefixes are never needed).

## Still to do from these sources

- **Stage C surround/DFS** (Church §5.2, optimizations credited to Myers): 2-patch library with
  dedup, surround DFS covering the base tile clockwise, successor/predecessor pruning to
  fixpoint, then a one-surround-found pass to kill dead ends. Church notes floor(k/2) surrounds
  suffice to reach all patches of size k, and that non-tiling is far likelier than a high
  isohedral number, so build 2-3 surrounds before testing bigger patches. Would replace
  `deep_one_type.js`'s brute-force `blocksUpTo(nbr, 4)`.
- **`tactile-js` as an independent isohedral oracle** — generate prototiles across all 81 types
  and feed them to our checker; every one must come back isohedral. Main work is translating
  Kaplan's `id`/`shape`/`rev` into our `whichEdge`/`edgeSym`/`mapping` (his `rev` is one bit,
  our mapping is a Klein-4 code, so the transform's orientation supplies the other bit).

## CAUTION recorded (John: "Very true... I would like to explore more later")

Both Church (§5.2.1) and Myers state the **isohedral number is not the same as the size of the
minimal isohedral repeating unit** for "unbalanced" tiles. Church reports the repeating-unit size
*instead of* the true isohedral number and says plainly that "a few unbalanced shapes will be
reported incorrectly"; his figures 2.10-2.14 are concrete unbalanced 2-anisohedral examples (an
8-hex, an 18-omino, two 20-ominoes, a 22-omino). Myers puts it as: the two numbers "are the same
for asymmetric tiles, but may differ for some symmetric tiles, in particular where the induced
symmetries of tiles in different orbits differ." This bears directly on the q:r block-ratio rule.

---

# The 3:1 ratio: why nothing has ever been found (2026-07-28)

John: *"Looking at unbalanced tiles, can we do a deep dive on #1132? No one has ever found a
ratio of 3:1."* Then, on the ledger's six "possible" 3:1 entries: *"Those are isohedral tilings.
3:1 anisohedral."*

## 1. The six "possible" 3:1 entries are all REGULAR polygons — John's claim stands

`_dev_isohedral/probe_1132.js` solves each and dumps the shape:

| type | homeo | m | shape found |
|---|---|---|---|
| #30, #413, #415 | `3_3 3_1` | 3 | equilateral triangle (60/60/60, all sides 1) |
| #37, #342, #422, #383, #25589 | `6_6 6_2` / `6_2 6_6` | 6 | regular hexagon (120x6, all sides 1) |

Every one is equiangular *and* equilateral, and both shapes tile isohedrally on their own. So
none is a 3:1 **anisohedral** example — the ledger's `possible/L3` is correct as far as it goes
but answers a different question. **No genuinely anisohedral 3:1 tile is known.**

## 2. #1132's search space is far smaller than "searched to m=8" suggests

Only `m` divisible by 3 has any sum-types at all (a consequence of q=3 / p6 / 632):

```
m      = 4  5   6  7  8   9  10 11  12  13 14  15 ... 30
sums   = 0  0   1  0  0   2   0  0   3   0  0   4 ...  ?
combos = 0  0  12  0  0  36   0  0  72   0  0 120 ... 540
```

So the ledger's `searched_to_m: 8` covered **only m=6 — twelve combos, ever.** With the rewritten
engine the whole range m=6..30 (**1988 combos**) now runs in **0.8 seconds**, and gives
**zero closing tiles**. Same for **#3158** (`3_3 5_1`, p3): 1988 combos, m=6..30, zero closures.

## 3. The blocker is a forced-angle contradiction, not a failed search

Every rejection is `impossible - no angles`, with ~0 solver time — the configs never reach Newton.
`_dev_isohedral/angle_system_1132.js` pulls the raw vertex-angle equations out of the engine's own
text and re-derives them with **exact integer elimination**:

- **#1132 m=6:** the system *fully determines* all six angles as **90,60,90,60,90,60 = 450**,
  but a simple hexagon needs (m-2)·180 = **720**.
- **#3158 m=6:** determines **90,120,90,120,90,120 = 630**, again vs **720**.

Control on a working type (#25524 m=6) gives ordinary equations (`A2 + A5 = 360`, `A0+A3-A5 = 0`,
...) with no such rows, confirming the format is being read correctly.

`_dev_isohedral/sweep_31_ratio.js` extends this to **all 35 open 3:1 / 1:3 types**:

> **35/35 have every combo inconsistent at their smallest m, and 35/35 have a combo where the
> angle system fully determines every interior angle.** In 34 of the 35 the forced angles sum to
> something other than (m-2)·180 — deficits of 60, 90, 180, 210, 240, 270, 360, 480, 540.

That mismatch is an **independent** geometric contradiction: it does not rely on the engine's own
impossibility flag, only on the ordinary `Ai = c` rows plus the fact that a simple m-gon's
interior angles sum to (m-2)·180. So the 3:1 family is blocked structurally, and no amount of
extra search at larger m for these particular sum-types will help.

## 4. THE ONE EXCEPTION worth looking at: #225

`#225` (`5_2 6_6`, q:r = 2:6 = 1:3, p6m) is the only type whose forced angles are **geometrically
fine**: all six forced to **120°, summing to exactly 720** — an equiangular hexagon, precisely
what a hexagon needs.

Its rejection therefore rests **entirely on two `0 = 1` rows the engine emits**, and **I could not
determine what constraint those rows encode.** For #1132/#3158 the independent angle-sum check
corroborates the engine; for #225 there is no such corroboration — the natural geometric check
*passes*. Note the same `0 = 1` rows appear in every rejected 3:1 type and never in the #25524
control, so they are meaningful rather than noise, but their derivation is unverified.

**#225 is the place to look for a 3:1 anisohedral tile**, and it is also the place where the
engine is most likely to be wrong. Next step would be to trace where `aniso.js` emits those rows
(near the `imposs[1]` assignment around `aniso.js:827`) and establish what they mean.

---

# #69445 caught a real false positive in the new engine (2026-07-28)

John: *"Try type #69445. I know that this one has an aniso at size 26. Let's see if we find any
earlier. This is ratio 2:1. The combo is stored in 'old user combos'."*

The stored combo (`old user combos/combo_69445_26sides.json`) is a **26-sided polyomino** — every
angle 90/180/270, every edge length 1, `edgeSym` all I, `whichEdge` all group 0. The ledger has
#69445 as `verdict: unknown, searched_to_m: 8`, so the engine had never been pointed at it.

## The bug

Run against that ground truth, `isohedral_criteria_fast.js` reported **criterion 1 on the single
tile** — i.e. isohedral — while the old engine (with and without cuts) correctly reported nothing.
The tile is known-anisohedral, so this was a **false positive introduced by the rewrite**.

Root cause, isolated with `_dev_isohedral/diag_69445_fp.js`:

`edgeCompatStrict` (the strict variant written for the combinatorial `centro`) leans on the
implication **"same `whichEdge` group ⟹ same length"**. That holds on the raw boundary — it is
exactly why replacing the old `edgeCompat`'s unconditional I-vs-I bypass with a same-group test
was sound. But it is **false after `mergeCollinearRuns`**: a merged run keeps its *first* raw
edge's index, hence its group, while its length becomes the **sum** of the run. On this tile the
merged boundary (n=26 → 16) carries group-0 edges of length **1, 2 and 5** simultaneously.

The offending side was `(1,0)-(1,1)-(2,1)-(2,0)-(4,0)-(4,1)`: edge lengths **1,1,1,2,1**, angle
pairs 90+270 and 90+270 both summing to 360, all edges I in group 0. So edge-type compatibility
passed, John's angle-sum rule passed, and the side was accepted as centrosymmetric — while the
true test (rotate 180 degrees about the chord midpoint) misses by a full **1.0** unit. The old
engine never had this hole because its geometric `fitIsometry` rejects unequal lengths on its own.

## The fix

`centro()` and `buildCentroTable()` now additionally require **paired edges to have equal
length**. Cheap (one hypot per pair), and it restores the congruence guarantee that
`edgeCompatStrict` alone can no longer provide once runs are merged.

After the fix: **#69445's single tile matches nothing (correct)**, a block proof appears at 3
tiles (criteria 4,5,6), overlap is 0, and the whole regression suite is unchanged — 101/113 on
`isoTesting.txt`, every `oracle_diff` case OK, 21/21 on the #25524 corpus, 7/7 centro unit tests,
11/11 smoke.

## Why the earlier validation missed it

Every prior test case had either no collinear I run at all, or a merge in which the runs happened
to be equal-length. #69445 is the first case in the corpus with a *substantial, unequal* merge —
which is exactly what a polyomino produces. **Lesson: the regression corpus was blind to merged
boundaries with unequal run lengths.** `verify_69445.js` is now the guard for that class.

---

# The five unbalanced tiles: searched exhaustively (2026-07-28)

John: *"I have all five unbalanced tiles in 'old user combos' folder. Can you search those types."*
Checking every stored combo's `q:r`, the five unbalanced **tiles** live in only **three types**,
all ratio **1:2**:

| type | homeo | stored tiles | ledger before |
|---|---|---|---|
| #25546 | `5_3 6_6` | m=34, 38, 42 | possible |
| #69439 | `5_3 8_6` | m=30 | unknown, searched_to_m 8 |
| #69445 | `5_3 8_6` | m=26 | unknown, searched_to_m 8 |

## #69445 — m=8..40 exhaustively, ~152k combos, ~4 min

**m=26 is the ONLY anisohedral size in the whole range.**

```
m      10 12 14 16 18 20 22 24  26  28 30 32 34 36 38 40
closed  4  4  4 12 16  4 12 16  12  24 24 16 20 32 12 36
aniso   0  0  0  0  0  0  0  0   4   0  0  0  0  0  0  0
```

The four m=26 hits are 2 sum-types x 2 orientations of **one tile**, and it is exactly John's
stored combo (si=109, or=0, off=25). Block proof: criteria 4,5,6 on a 3-tile block.

## #69439 — m=8..30, ~1.08M combos

Two *distinct* anisohedral tiles, and one of them is **new**:

- **m=26: 4 hits = one tile — and it is byte-identical (as a corner polygon) to #69445's m=26
  tile.** So the same anisohedral polyomino realises **two different `5_3 8_6` Delaney types**.
  This is **four sizes earlier than the stored #69439 tile**, and the ledger had #69439 at
  `searched_to_m: 8`, so it had never been seen here.
- **m=30: 4 hits = one tile, matching John's stored combo exactly.** A *different* shape from the
  m=26 one — 30 corners with turns 60/300 and unit edges, i.e. a **polyiamond**, where the m=26
  tile is a **polyomino** (turns 90/270). Confirmed distinct by canonical corner-polygon
  comparison (`corners()` drops flat 180-degree vertices before comparing, so this is not an
  artifact of differing side counts).

Everything from m=8 to m=24, and m=28, is isohedral-only.

## Method note

Shape identity is compared on the **corner polygon** — flat (180-degree) vertices dropped, then
canonicalised over all rotations and both reflections of the (edge length, turn angle) sequence.
Without dropping flat vertices, the same physical tile described with different `m` looks
different; without canonicalising, the same tile at a different starting offset looks different.
Both traps are live here: #69445's m=26 tile has 26 sides but only **16 corners**.

---

# Profiling the real bottleneck: it was never Newton (2026-07-28)

After the corner-search rewrite, `deep_one_type.js` attributed **87-99.6%** of every run to its
`solve` bucket, and the obvious read was "the Newton solver is now the bottleneck". That read was
wrong twice over, and only profiling showed it.

**Trap 1: the `solve` timer is not the solver.** It wraps `H.solveAndDevelop()`, which is
`config()` + `solveTile()` + `develop()`. A first V8 CPU profile (1156 real #69445 m=26 configs)
split roughly **65% config building / 35% Newton** — the config text-report path (`adjacentSetUp`
building `forTextFile` by concatenation, then `parseCfg` regex-parsing it back) dwarfed the
numerics. (`forTextFile` *is* reset per `specify()` call — checked, no quadratic blowup.)

**Trap 2: even that profile was measuring the wrong thing,** because the driver pre-built configs
and timed `solveTile` alone, so it never included `develop()` — or what turned out to matter most.
Profiling the *actual* `solveAndDevelop` path gave a completely different top entry:

```
  42.6%  overlap        @ test_harness.js:89     <-- and the search never reads it
  27.7%  adjacentSetUp  @ aniso.js:274
   4.2%  specify
   2.8%  solveTile        ... all of Newton together was under 8%
```

## Three fixes

1. **`ov` is now lazy** (`test_harness.js`). `solveAndDevelop` eagerly called `overlap(placed)`,
   which rasterises a 44x44 grid and point-in-polygons every tile at every grid point — 42.6% of
   the run — while `deep_one_type.js` **never reads `r.ov`** (it uses `OverlapStrict`, and only on
   combos reaching the anisohedral stage). Seven dev scripts *do* read `.ov`, so it can't be
   dropped; a memoized getter keeps them identical and makes it free for everyone else.
2. **Sum-types cached per `(id, m)`** (`test_harness.js` `config()`). They depend only on
   `(id, m)`, but a search loops thousands of `(si, orient, off)` per size and re-ran
   `findSumWays` for every one (~12%). `runSums()` itself is untouched — 36 dev scripts call it
   directly — only `config()`'s internal path is memoized. A cache hit must still set the
   `tileLeng` input, since `specify()` reads it.
3. **`anglesFrom` compiled** (`tiler_core.js`). It was 43% of Newton: called `(nU+1)` times per
   iteration, 28 restarts x up to 140 iterations, each call paying two `for...in` object walks
   plus a `forEach` closure. `compileDep()` flattens `dep` into index/coefficient arrays once per
   solve; `anglesFromC()` is then a flat numeric loop. Returns a plain Array on purpose — callers
   `.map()`/`.slice()` and JSON-serialise it, and a Float64Array would serialise as an object.
   Also added `endpointOf()`: `resid()` only needs the closing endpoint, but `verticesOf` was
   allocating m+1 point arrays every call.

## Result

`#69445` to m=26, verdicts **bit-identical** (m=26 still 12 closed / 8 isohedral / 4 anisohedral):

| | before | after |
|---|---|---|
| `solve` bucket, total | 16.6s | **6.3s** (2.6x) |
| m=26 `solve` | 6.5s | **3.3s** |
| isolated Newton (1156 configs) | 1.30s | **0.54s** (2.4x) |
| real path (2000 combos) | 1.75s | **0.90s** |

Regression clean throughout: 101/113 on `isoTesting.txt`, all 12 `oracle_diff` cases OK, 21/21 on
#25524, 7/7 centro unit tests, #69445 ground truth still reproduced, and the harness's own
overlap regression set still all-zero (so the lazy `ov` returns the same values).

**The bottleneck has now moved to `blk`** — the block search is **82.4%** of a #69445 m=26 run
(31.6s of 35.3s). That is Church's section 5.2 territory (2-patch library, surround DFS, Myers's
successor/predecessor pruning), and it is now the correct next optimisation target — this time
measured, not assumed.

---

# aniso.js: the strings are a red herring; the real cost was a restart-scan (2026-07-28)

John: *"I wrote aniso.js, I don't know how efficient it is... (Like why flip to strings and back
again?)"* and *"How much of this depends on the size?"*

## The size question, answered first because it reframes everything

`_dev_isohedral/scaling_by_m.js` times each stage per combo, separately from the combo count:

| stage | per-combo @ m=10 | @ m=40 | growth |
|---|---|---|---|
| config | 271 us | **707 us** | ~m^2 (clean monotone rise from m=16 up: 105 -> 707) |
| solve | 166 us | 144 us | flat |
| develop | 120 us | 18 us | *decreasing* |
| **combo count** | 60 | **35,520** | **~m^4.6** |

**Almost none of the growth is tile size. It is the number of (sum-type, orient, offset) combos,
which explodes as ~m^4.6.** Total work ~ m^6.7. Two consequences worth keeping:

1. Micro-optimisation buys a **constant factor only**. Reaching materially larger m needs
   **fewer combos** -- pruning before the expensive work, not faster expensive work.
2. Within a combo, **config is now the dominant term** (81% of per-combo cost at m=40) and the
   steepest-growing one, so it was the right place to look.

## Why flipping to strings costs almost nothing

`specify()` emits **503 chars at m=10 and only 3,758 at m=40**, via 56 append sites. Building ~4 KB
of string is sub-microsecond against a 707 us budget, and `parseCfg` measured at 1.2% of a run. So
the text round-trip is architecturally ugly but **performance-irrelevant** -- worth remembering
before anyone spends time replacing it. `adjacentSetUp`'s 27.7% is genuine computation: it is 995
lines with only 56 string lines.

## What the cost actually was

Function-level profiling just says "adjacentSetUp 27.7%", useless for a 995-line function, so
`_dev_isohedral/read_lines.js` breaks a `.cpuprofile` down by **line ticks**. The two hottest lines
in the entire config path were `aniso.js:650` and `:654` -- together with their loop headers,
**28% of adjacentSetUp**:

```js
for ( i = netAngles.length; i<angleCounter; i++)
  for ( j = 0; j<tileLength; j++)
    if ((tileAngles[i][j] != 0) && (vertexAngle[j] === 1))
      for ( k = 0; k<tileLength; k++)
        if ((tileAngles[i][k] != 0) && (vertexAngle[k] === 0)) {
          i = netAngles.length; j = 0;        // <-- restart the whole scan
          vertexAngle[k] = 1;
        }
```

It is a **fixed-point closure** ("within a row, if any nonzero column is a vertex then all its
nonzero columns are"), computed by restarting the entire double scan on every discovery:
O(vertices x rows x tileLength). Because the rule is monotone (flags only go 0->1) the fixed point
is order-independent, so a **worklist** reaches the identical answer in O(nonzeros), each row
firing at most once.

## Parallel versions, as requested

- `engine/aniso_fast.js` -- copy of `aniso.js` with only that block replaced.
- `engine/test_harness_fast.js` -- copy of the harness loading it.
- `_dev_isohedral/dump_configs.js std|fast <id> <m>` -- dumps every parsed config as JSON.

They cannot share a process (`aniso.js` evals into globals, so a second load clobbers the first),
so comparison is cross-process: dump with each, `cmp` the JSON.

**Output byte-identical on all six sweeps tested**, and the speedup scales with m exactly as the
size analysis predicts -- it only matters where we need it:

| case | std | fast | gain |
|---|---|---|---|
| #69445 m=40 | 0.740 ms | **0.534 ms** | **28%** |
| #25546 m=20 | 0.178 ms | 0.148 ms | 17% |
| #69445 m=26 | 0.275 ms | 0.246 ms | 11% |
| #69439 m=18 | 0.137 ms | 0.129 ms | 6% |
| #25524 m=10 | 0.095 ms | 0.093 ms | ~0 |

Nothing in the main path uses `aniso_fast.js` yet -- it is parallel-only, for comparison, exactly
as John asked. Remaining config cost after this is the Gaussian elimination (lines ~708-810) and
the `tileEdges` mapping loops (~559-571).

---

# WS3 redirected: the block search is slow per block, not per-block-count (2026-07-28)

The plan assumed the block search needed Church's section 5.2 machinery (2-patch library, surround
DFS, Myers's successor/predecessor pruning) because `blk` was 82% of a #69445 m=26 run. Measuring
first (`_dev_isohedral/profile_blk.js`) showed that assumption was wrong:

```
combo             blocks  by size              boundary n     total    first match
si97/or0/off12       360  {2:8, 3:50, 4:302}   42/54/66      7435 ms   4,5,6@3t after 21 blocks
```

**Only 21 blocks are ever examined** -- the early exit already works, and enumeration is not the
problem. The cost is **~350 ms per `checkBlock`** at boundary n=42-66. So Church 5.2 (which makes
*enumeration* cheaper) would fix almost nothing here; the criteria engine at large n is the issue.
That is WS2's territory, not WS3's -- the two workstreams have effectively swapped priority.

## Where the time inside checkBlock goes

Per-criterion (`profile_crit.js`, n=58): criteria 1-6 cost 40-100 ms **each**, criteria 7-9 are
nearly free (0.6-9 ms -- the angle census is doing its job). Notably the cost is NOT dominated by
criterion 1's theoretical O(n^5); criteria 3/4/5 are O(n^3) yet cost the same as 1. So **constant
factors per candidate dominate, not asymptotics** at these n.

V8 profile of criterion 4 alone at n=58:

```
39.2%  simplifySide      <- called inside trans/glide/rot on BOTH args, every call
25.7%  sidesFor          <- rebuilding the same side objects
 8.6%  tryCandidate
 7.4%  (garbage collector)
 1.6%  fitIsometry       <- the actual geometry
```

**~73% was allocating and re-simplifying side objects; real geometry was 1.6%.** At n=58 there are
only ~3,364 distinct (anchor,start,end) ranges against ~290,000 `sideByOffset` calls.

## What was done, and its honest limit

`isohedral_criteria_fast.js` now memoizes (a) side objects by (anchor, o0, o1) and (b) the
predicate *results* (`trans`/`glide`/`rot`/`centro`) keyed on side-object identity. Memoizing the
predicate result rather than reimplementing was deliberate: `simplifySide`, `isTranslation` and
`axisAngle` are all unexported, so the alternative was ~40 lines of duplication and divergence
risk. All caches are per-boundary-walk and reset in `checkPolygonOneWay` (they key on offsets and
object identity that mean nothing across boundaries). **The cache key must include the anchor** --
`sideByOffset` walks from `(A+o)%n`, so the same (o0,o1) under a different A is a different side;
that was a real bug caught before testing.

**Result: only ~20%** (7.4s -> 6.1s per combo; n=58 checkBlock 374 -> 368 ms). Correctness intact:
101/113, 12/12 oracle_diff, 21/21 #25524, 7/7 unit, 11/11 smoke, #69445 ground truth reproduced.

**Why it is capped there, and what would actually fix it.** Memoization only helps predicates that
depend on fewer offsets than the generator loops over. In criterion 4, `trans(a,d)` depends on
`o1` alone (big reuse) but `trans(b,e)` -- b=(o1,o2), e=(o3+o1,o3+o2) -- depends on **both** o1 and
o2, so it is genuinely distinct for every tuple and no cache can help. The remaining cost is
therefore *the number of tuples*, and the way to cut that is the **maximality result already
verified this session** (Church section 3.2, 0 counterexamples on free angles): only MAXIMAL runs
can appear in a criterion decomposition, so each anchor needs one candidate length, not `n`. That
is the real WS2 build and it is not yet done.

## WS2: run-tables cut the criteria engine ~4.6x (2026-07-28)

Memoization capped at 20% because some predicates are genuinely distinct per tuple. The fix that
worked is an **O(1) integer reject before any geometry**, from two precomputed run tables.

**`transRun(B,D)`** -- how far a translation match extends, using the growth rule verified
earlier: with B where side X ends and D where side Y begins, the match runs while
`edge(B-1-t)` is **antiparallel and congruent** to `edge(D+t)`. A side of edge-count L can satisfy
trans only if `transRun(B,D) >= L`. Deliberately `>=`, not `=== L`: the stronger form is what
Church's maximality would license, but that was only rigorously verified for centro/rot, not
trans/glide, and `>=` is sound regardless (no false negatives). It rejects nearly everything
anyway, since most position pairs have run 0.

**`glideRun(SX,SY)`** -- same idea for the SAME-ORDER glide convention. **First attempt failed and
made things slower** (criterion 6: 97.8 -> 117.7 ms): length + `edgeCompat` alone is no filter at
all on a polyomino, where every edge is I in one group, so it was pure overhead. What makes it
work is the directional invariant: a glide about an axis at angle theta sends direction d to
`2*theta - d`, so **`dir(X+t) + dir(Y+t)` is the same constant for every paired edge**. Pin that
constant from the first pair and require it of the rest.

Plus one loop fix: in `gen6`, the `b~f` glide depends only on `(o1,o2)` but sat inside the `o3`
loop, recomputing n times. Hoisted.

Per-criterion at boundary n=58, through the three stages:

| crit | original | +memo +trans | +glide +hoist |
|---|---|---|---|
| 1 | 53.0 | 22.1 | 22.1 |
| 2 | 40.1 | 21.2 | 19.6 |
| 3 | 58.1 | 15.8 | **1.7** |
| 4 | 54.4 | 1.3 | **0.9** |
| 5 | 57.5 | 14.3 | **1.3** |
| 6 | 100.1 | 97.8 | **19.8** |
| 7/8/9 | 10.4 | 11.6 | 15.1 |
| **total** | **373.6** | 184.2 | **80.5** |

Block search per anisohedral combo: **7.4s -> 1.3s**. Full #69445 m=8..26 run: **40.9s -> 9.1s**,
and the profile is now balanced (solve 51%, blk 48%) rather than 82% in one place.

Correctness unchanged at every step: 101/113, 12/12 oracle_diff, 21/21 #25524, 7/7 centro unit,
11/11 smoke, #69445 ground truth still anisohedral with its 3-tile block proof.

**Still open:** criteria 1 and 2 (22 and 20 ms) are now the largest, and neither has a filter for
its dominant term -- criterion 1 constrains only `trans(a,d)` with four independent centro sides,
criterion 2 similarly. A centro-span *run* table (analogous to the two above) is the obvious next
step. Church's stronger `=== L` maximality form is also still unexploited, and would need the
rigorous trans/glide maximality probe that was deferred.

## aniso_fast adopted; maximality validated but performance-neutral (2026-07-28)

**aniso_fast is now the default.** `test_harness.js` loads `aniso_fast.js`; the old path is kept
reachable as `test_harness_std.js` (loads `aniso.js`) purely for comparison, and
`dump_configs.js std|fast` still diffs them cross-process. Output byte-identical on every sweep
tested; config cost 0.751 -> 0.554 ms at m=40 (26%), 0.322 -> 0.240 at m=26 (25%). End to end on
#69445 m<=26 that is ~13% off the `solve` bucket and ~7% off the whole run -- the win grows with m
because config is the term that scales (~m^2) while solve and develop are flat.

**Maximality is now ON, and it holds.** John endorsed Church section 3.2 in his own terms: *"A
side is the boundary between two adjacent tiles. If we have more edges that touch each other,
they have to be in the same side."* So `transOK`/`glideOK` now require the matched side to be
EXACTLY the maximal run (`=== len`), not merely to fit inside it (`>= len`).

A prerequisite had to be fixed first: the run tables did not include John's junction angle
condition, so they **overestimated** the run. That is harmless under `>=` but would have caused
false negatives under `===`. Both `transRun` and `glideRun` now check that the angles at the two
corresponding junction vertices sum to 360 before extending.

Switching `>=` to `===` changed **no verdict anywhere** -- 101/113, 12/12 oracle_diff, 21/21
#25524, 7/7 centro unit, 11/11 smoke, #69445 ground truth intact. That is a genuine
**confirmation of maximality on the whole corpus**, and it covers trans/glide, which the earlier
`maximality_probe.js` could only test weakly.

**But it bought no measurable speed:** n=58 checkBlock 80.5 -> 82.1 ms, block search 1.30 -> 1.26 s
-- noise either way. The `>=` filter had already rejected nearly everything; `===` only additionally
rejects sides strictly shorter than their maximal run, which is rare among survivors. Keeping it
on (it is mathematically right, John endorsed it, and it may bite on other tile families), but
noting plainly that it is **not** what made the engine fast, and it is the first thing to flip back
if a false negative ever appears.

Remaining hot spots at n=58 are criteria 1 (23.9 ms), 2 (19.2) and 6 (18.0). Their cost is now raw
loop iteration -- gen1 is O(n^5) in structure -- not predicate calls, so the next lever is
restructuring those loops to iterate only over valid centro spans rather than filtering inside
them.

---

# 3:1 hunt: 317,604 combos, no anisohedral tile — but one new "possible" (2026-07-28)

John: *"I'd like to test our new methods on looking for any anisohedral tilings with a tile ratio
of 3:1. Our 5 other unbalanced tiles (the only ones we know about) are all 2:1."*

`_dev_isohedral/search_31.js`, 45-minute budget, all **35 open 3:1 / 1:3 types**, climbing m to 39
with an adaptive per-type share. **Every type finished its full m range inside budget** -- none was
cut short. This is what the session's speedups bought: the same sweep before them was not
attempted at all, and the ledger had these types at `searched_to_m: 8`.

```
TOTAL: 317,604 combos, 120 closed, 0 anisohedral
```

**No 3:1 anisohedral tile exists in this space up to m=39.** Combined with the forced-angle
result, the earlier finding is now much stronger: it is not only that the angle system is
inconsistent at each type's SMALLEST m -- for 34 of the 35 types **not one closing tile appears at
ANY m up to 39**. #225, the one type whose forced angles were geometrically valid (all 120,
summing to 720), is now exhausted over m=6..36 with zero closures, so the unexplained `0 = 1` rows
were not concealing a viable tile.

## The one exception, and it is a NEW LEDGER RESULT

**#3215** (`4_2 6_6`, q:r = 2:6 = 1:3, p6) was the only type to close anything: **120 tiles, and
all 120 have non-overlapping patches.** Every one is isohedral (criteria 1 and 8), so it is not
the anisohedral example being hunted -- but a closing tile with a clean patch is a **monohedral
witness**, and the ledger currently records #3215 as `unknown/none`.

Closures appear only at m divisible by 3 (m = 9, 15, 18, 21, 27, 30, 33, 36, 39). The smallest:

```
#3215 m=9 si=0 or=1 off=0, curves=IIIIIIIII, criteria [1,8]
angles  [60, 120, 240, 60, 120, 240, 60, 120, 240]
lengths [1, 1, 1, 1, 1, 1, 1, 1, 1]
```

A unit-edge 9-gon with a 3-fold repeating 60/120/240 angle pattern -- consistent with p6/632.
**#3215 should be `possible` (engine level L2), not `unknown`.** Worth re-running the certifier on
it, and worth asking why the original sweep missed it: its first witness is at m=9, and the
ledger's `searched_to_m` for this type was 8.

That last point generalises -- **several 3:1 types have their first sum-types only at m divisible
by 3**, so a search stopping at m=8 sees literally nothing. Same trap as #1132, whose
`searched_to_m: 8` had in truth covered only m=6.

---

# Never-searched types, and four ledger corrections (2026-07-28)

#3215 turned out to be recorded `unknown` with `searched_to_m: 8` while its first sum-types only
exist at m=9 -- so the recorded search had tried **nothing**. `_dev_isohedral/never_searched.js`
generalises that check: for every non-`possible` type, find the smallest m that has any sum-types
and compare against `searched_to_m`.

**128 types where the recorded search covered ZERO usable sizes**, 110 of them unbalanced:

| ratio | count | | ratio | count |
|---|---|---|---|---|
| 1:2 | 34 | | 1:12 | 5 |
| 1:6 | 26 | | 3:2 | 4 |
| 1:4 | 19 | | 3:1 | 3 |
| 1:1 | 18 | | 1:8 | 2 |
| 1:3 | 10 | | **2:1** | **7** |

Most have k or n of 12/16/18/24, so their first sum-types sit at m=12..24 while the search stopped
at 8. **`searched_to_m: 8` frequently means "nothing was ever actually tried."**

## Ledger corrections found (types with a clean-patch witness but recorded `unknown`)

`_dev_isohedral/search_unbalanced.js` runs each type from its ACTUAL first m, and requires
`overlapStrict === 0` before calling anything a witness (so "closes but the patch collides" is not
miscounted):

| type | homeo | ratio | first clean m | note |
|---|---|---|---|---|
| **#3215** | `4_2 6_6` | 1:3 | **9** | 120 closures, all clean, all isohedral (crit 1,8) |
| **#617** | `5_3 8_6` | 1:2 | **12** | 8 closures, all clean. Same homeotype as John's two known 2:1 anisohedral tiles |
| **#4810** | `4_2 10_8` | 1:4 | **10** | 12 closures, all clean |
| **#69445** | `5_3 8_6` | 1:2 | **10** | John's own type -- isohedral witness at m=10, anisohedral tile at m=26 |

All four should be `possible`, not `unknown`.

## End-to-end validation of the search itself

Running blind over 110 types, the sweep **independently rediscovered #69445's known anisohedral
tile** -- all four variants (si=97/or=0/off=12, si=97/or=1/off=19, si=109/or=0/off=25,
si=109/or=1/off=6) at m=26, each with block proof `criteria 4,5,6 on 3 tiles`, exactly matching
the dedicated run. That is the strongest confirmation so far that the whole pipeline
(config -> solve -> criteria -> overlap -> block proof) works on a type it was not aimed at.

## No NEW anisohedral tile

Across the 3:1 sweep (317,604 combos) and this unbalanced sweep, the only anisohedral tiles found
are the ones already known. The five unbalanced tiles John has are still the only ones, and they
are still all 2:1.

## Unbalanced sweep: final numbers (corrects the "four corrections" above to SIX)

`search_unbalanced.js` finished the never-searched unbalanced set:

```
TOTAL: 4,267,867 combos, 1,532 closed, 4 anisohedral (all the already-known #69445 tile)
```

**Six ledger corrections in total** -- five from this run plus #3215 from the 3:1 run. Every one
was recorded `unknown`, every one has clean-patch witnesses, every one should be `possible`:

| type | homeo | ratio | first clean m | closures (all clean) | criteria at the witness |
|---|---|---|---|---|---|
| #3215 | `4_2 6_6` | 1:3 | 9 | 120 | 1,8 |
| #617 | `5_3 8_6` | 1:2 | 12 | 8 | 1,2,3,4,5,6,9 |
| #4810 | `4_2 10_8` | 1:4 | 10 | 12 | 1,2,3,4,5,6 |
| #69445 | `5_3 8_6` | 1:2 | 10 | 152 | 1,2,3,4,5,6 |
| #72954 | `5_3 8_6` | 1:2 | 10 | 312 | 1,2,3,4,5,6 |
| #72974 | `4_4 7_2` | **2:1** | 10 | 1048 | 1,2,3,4,5,6 |

Two patterns worth noting. **Every first witness is at m=9..12** -- i.e. just past the recorded
`searched_to_m: 8`, which is exactly the bookkeeping artifact `never_searched.js` was built to
find. And **three of the six are homeotype `5_3 8_6`**, the same homeotype as both of John's known
2:1 anisohedral tiles (#69439, #69445) -- that homeotype keeps producing.

**No new anisohedral tile.** The only anisohedral finds were the four variants of #69445's known
m=26 tile, which the sweep rediscovered blind (same si/or/off, same `4,5,6@3t` block proof) --
a strong end-to-end validation, but not a new result. **John's five unbalanced tiles remain the
only ones known, and they are still all 2:1.**

Not yet swept: the ~424 unbalanced unknowns *outside* the never-searched set (they had at least
one usable size covered, so they are lower-yield, but they are not exhausted either).

---

# TWO NEW ANISOHEDRAL TILES from #25638 (2026-07-29)

Sweeping the remaining 355 unbalanced unknowns (14,588,030 combos) produced **14 more ledger
corrections and — the first new mathematical result of these sweeps — anisohedral tiles from
#25638** (`5_3 6_6`, ratio 1:2, previously recorded `unknown`).

## Verification (`_dev_isohedral/verify_25638.js`)

All four finds pass every check independently of the new engine:

- the **OLD** engine agrees the single tile matches no criterion;
- the old engine **also finds nothing with its cut-based deep pass**, so this is not merely
  "anisohedral under our vertex-only ruling";
- `overlapStrict = 0` on the developed patch;
- block proof **criterion 5 on 3 tiles** — and 3 tiles is exactly `1 + 2`, matching the type's
  q:r = 1:2, which is John's block-ratio rule behaving as predicted;
- compared as canonical corner polygons, **neither is congruent to any of John's five known
  unbalanced tiles**.

The four finds are two distinct shapes (m=12 x2 offsets, m=24 x2 offsets).

## The two are NOT equally strong -- `_dev_isohedral/curve_dependence_25638.js`

| | m=12 | m=24 |
|---|---|---|
| corner polygon | 8 corners, edges 2,1,1,2,2,1,1,2 (an S/Z-shaped 7-cell polyomino outline) | 20 corners, angles incl. **190.5 / 169.5** (free angles, not lattice) |
| actual edgeSym | all **U** | all **J** |
| as-is | anisohedral | anisohedral |
| edges relabelled **I** (straight) | **ISOHEDRAL (criteria 1,4)** | **still anisohedral** |
| edges relabelled J | anisohedral | anisohedral |

**m=12: the anisohedrality is carried by the U curve, not the polygon.** Straightened, it is an
isohedral heptomino — which is the *correct* answer and a good external check, since Myers's
tables give **zero anisohedral heptominoes**. It is still a legitimate anisohedral tile, but it is
a *curved* one; the outline alone is not.

**m=24: anisohedral regardless of edge type** — straight, U, or J. That makes it the stronger
result: a genuinely anisohedral **polygon** with free (non-lattice) angles, at ratio 1:2, and
substantially smaller than #25546's m=34/38/42 tiles in the same homeotype.

Both exported: `combos/combo_UNBAL_25638_m12_si5_or0_off{4,10}.json` and
`combos/combo_UNBAL_25638_m24_si30_or0_off{8,20}.json`. **These want John's eye in
tilerTest.html before being called results.**

## Ledger corrections from this sweep (14 more, 20 in total)

`#69439` and `#72126` (`5_3 8_6`); `#360`, `#25338`, `#25347`, `#25638` (`5_3 6_6`); `#8329`,
`#8330` (`4_2 6_4`); `#8873` (`5_2 8_8`); `#8884`, `#8885` (`4_4 5_2`); `#13531` (`5_4 5_2`);
`#25182`, `#25183` (`4_4 6_2`) -- every one recorded `unknown`, every one with a clean-patch
witness at m=9..16.

**#69439 is John's own type** and was still recorded `unknown` despite his known m=30 tile.

The productive-homeotype ordering paid off: `5_3 8_6` and `5_3 6_6` were searched first and
produced 6 of the 14, including #25638. Both are the homeotypes of John's existing tiles.

---

# Overnight deep sweep of the q>r family: nothing new (2026-07-29, 04:48-06:33)

John, before going back to bed: *"can you explore more places there might be extra unbalanced
tilings? Maybe some of the 2:1 that you cut short for time?"*

Re-swept **all 106 q>r unbalanced unknown types** (85 at 2:1, 16 at 4:1, 5 at 3:2 -- 3:1 already
exhausted to m=39) with **~59 s per type against the ~7.6 s of the 45-minute sweep, about 8x
deeper**. Deliberately re-covered types both sweeps had already touched, since the *budget*, not
the search space, had been the binding constraint.

```
TOTAL: 20,561,100 combos, 1,204 closed, 0 ANISOHEDRAL
```

**Six clean witnesses, every one a re-discovery** (#72974, #8884, #8885, #13531, #25182, #25183 --
all already in the 20 corrections). **No new type, no new tile.** Many 2:1 types were covered to
m=32 with 162,176 combos each and produced not one closure.

So the extra depth **confirmed** the earlier findings rather than extending them, which is a real
if unexciting result: the q>r family looks genuinely worked out at these sizes, and the thin
budget of the earlier sweeps was not hiding anything there.

## Where the remaining risk actually is

The **densest 1:2 types** are still the least-covered part of the space -- several run 100k-250k
combos *per size* and got only a few seconds each in the `rest` sweep. That is now the obvious
next target, and it is also where #25638 came from (`5_3 6_6`, ratio 1:2).

## Standing result of the night

Unchanged and still the headline: **#25638's two new anisohedral 1:2 tiles**, with the **m=24**
one anisohedral as a *polygon* (survives relabelling its edges straight), the m=12 one anisohedral
only via its U curve. Both await John's eye in `tilerTest.html`.

---

# CORRECTION: the #25638 "two new tiles" claim was wrong (2026-07-29)

John checked it: **"#25638 m=24 is the same as #25638 m=12. It is also possible to tile that
shape as a balanced anisohedral tile."**

So there are not two new unbalanced tiles. There is one shape, and it is not exclusively
unbalanced. **Retract the claim.**

## Why my comparison was fooled -- TWO independent bugs in `canon()`/`corners()`

`_dev_isohedral/why_25638_same.js`:

1. **Exact flatness test.** `corners()` dropped a vertex only when the cross product was
   < 1e-9. The m=24 solve landed on angles of **190.5 / 169.5 degrees** -- 10.5 degrees off
   straight, |sin(turn)| = 0.18 -- so **16 of its 24 vertices survived** as "corners". The
   canonical form saw a 20-corner polygon where the underlying shape has 8. An exact-equality
   flatness test is simply the wrong tool for SOLVED tiles, which float and can deform within a
   family.
2. **No scale normalisation.** m=12 has area 7.0 in a 3x3 box; m=24 has area 27.8 in a 6.5x6.1 box
   -- a ~2x scaling, area ratio 3.97. Two descriptions of the same shape at different sizes would
   have compared as different even with the flatness test fixed.

Both bugs push the same way: **toward false "this is new" claims**, which is the worst direction
for this to fail in.

**Fix before any future novelty claim:** compare tiles (a) after normalising scale -- e.g. divide
by sqrt(area) or by perimeter -- and (b) with a TOLERANT flatness test, or better, not by
vertex-list canonicalisation at all but by a shape metric robust to redescription (normalised
turning function, or area/perimeter plus a registered point-set distance). The earlier #69439 vs
#69445 comparison happened to be safe because those tiles are lattice shapes with exactly-180
flats and equal scale -- it was luck, not method.

**What survives:** the 20 ledger corrections are unaffected (they rest on closure + clean patch,
not on shape novelty). The 3:1 result is unaffected. **No new anisohedral tile has been found.**
John's five unbalanced tiles remain the only ones.

---

# Second overnight q>r sweep, much deeper (2026-08-04 23:30 onward)

John, going to bed: *"We looked for new unbalanced tilings. You said that some of the searches you
cut short. (These were some of the 2:1 ratio ones.) Can you find where we were and search those
more fully?"* -- this is the 07-29 sweep above. Current ledger still has exactly the same 106 q>r
unknown types as that sweep (85 at 2:1, 16 at 4:1, 5 at 3:2), so nothing has touched this family
since. That sweep gave each type only ~59s and a **hard cap of 26 sizes** -- the cap, not just the
clock, was limiting depth for the denser types.

Wrote `_dev_isohedral/search_qgtr_overnight.js`: same search as `search_unbalanced.js qgtr` but
with the size cap raised to 80 (`LO..LO+80` instead of `LO..LO+26`), a much larger time budget, and
**incremental checkpointing to `search_qgtr_overnight_results.json` after every single type** (the
old script only wrote its summary at the very end, so a killed run lost everything -- see
[[project-corner-search-bottleneck]]'s note on `deep_one_type.js` having the same flaw).

Launched in the background at 2026-08-04 23:30 local with an 8-hour budget (480 min), ordered
productive-homeotype-first then 2:1 before 3:2/4:1 within each homeotype, same reasoning as the
07-29 script: if the budget runs out, it runs out on the least promising types. Any anisohedral
find writes a per-tile combo to `combos/combo_UNBAL2_*.json` immediately, same as always.

**To pick this up if the session was interrupted:** read
`_dev_isohedral/search_qgtr_overnight_results.json` for `typesDone`/`perType` (progress so far,
updated after every type) and `newPossible`/`anisoFinds` (any hits). The raw log is
`_dev_isohedral/search_qgtr_overnight.log`. If the process is still running, `perType` will lag the
log slightly; if it finished, the log's final TOTAL line and this file will agree.

## Result: finished clean, still nothing new (2026-08-05, 04:30-12:27 UTC, ~7h57m)

```
TOTAL: 62,116,872 combos, 3,456 closed, 106/106 types done -- ran to completion, deadline never hit
```

**Same 6 reconfirmations as the 07-29 sweep (#72974, #8884, #8885, #13531, #25182, #25183), 0
ANISOHEDRAL finds, 0 genuinely new witnesses.** ~3x the combos of the 07-29 sweep (62.1M vs
20.5M), and this time it finished with time to spare rather than hitting a deadline.

**But the depth was still uneven** -- only 7/106 types reached the full LO+80 span; the other 99
were cut off by their *per-type* time slice, not the overall deadline. The bottleneck is real
combinatorial density, not clock budget:

- `3_2 5_1` and `3_2 4_1` homeotypes (the `k,n` = 3,2/4,1-ish small-corner-count types) are the
  worst: >1.5M combos each by m=24-32, ~220-307s spent and still cut mid-size.
- `4_4 6_2` and `4_4 5_1` (4:1) are similar -- 1-1.3M combos by m=32-44.
- These four homeotypes account for most of the 99 truncated types and are structurally the
  deepest rabbit holes in the q>r family; pushing them further needs either a much bigger
  per-type allocation (hours each, not minutes) or a smarter prune, not just more wall-clock
  spread evenly across all 106.

**Conclusion: the q>r (2:1/4:1/3:2) family looks genuinely exhausted at every depth practical to
reach with the current search -- this is now the SECOND independent deep sweep (07-29 and
08-05) to come back empty.** John's five unbalanced tiles remain the only known ones. If there is
something still hiding, it is in the four dense homeotypes above and would need a
dedicated multi-hour-per-type run, not another broad sweep.

## Loop closed: the 6 reconfirmed witnesses are now actually IN the ledger (2026-08-05)

Traced why the "20 ledger corrections" NOTES claimed on 07-29 never actually stuck: `_dev_isohedral`
scripts find witnesses but only ever write standalone `combos/*.json` files -- `build_ledger.py`'s
real source of truth is `py/certify_results.json` (built by `certify.js`), and nothing had fed
these 6 back into it. Every fresh sweep was re-"discovering" the same 6 as if new (it happened
again in the 08-05 overnight sweep above).

Fixed for these 6: `node certify.js` on `[25182, 25183, 72974, 8884, 8885, 13531]` up to m=16
reproduced every witness at L2 (closed, 0 overlap, non-degenerate -- `relGap` 1e-9 to 1e-15,
`relArea` 1.5-6.06, well clear of the [[the-0.05-clamp-fakes-closures|clamp floor]]), merged into
`py/certify_results.json` (backed up first), then `python build_ledger.py` rebuilt `ledger.json`.
All 6 now read `verdict: possible, evidence: L2` with the matching config. Ledger totals after
rebuild: 187 impossible / 389 possible / 694 unknown.

**Update, same session:** closed the remaining 14 too (9 unique ids: #69439, #72126, #360,
#25338, #25347, #25638, #8329, #8330, #8873 -- the other 5 of the "14" were duplicate homeotype
entries for ids already covered). All 9 certified L2 at m<=16, same merge-and-rebuild treatment.
**All 20 of the 07-29 corrections are now genuinely reflected in `ledger.json`.** Ledger totals
after both batches: 187 impossible / **398 possible** / 685 unknown (was 389 possible before
either fix). Confirmed the gap was real, not hypothetical: the q<r broad sweep below
re-"discovered" #617 and #69439 as if new within its first three types, exactly the failure mode
this was meant to close.

---

# #25199 deep dive: fully written up, no impossibility argument found (2026-08-05)

John: *"I'm looking at #25199. I don't see any way to prove impossible. Make sure that you have
written up how far you explored."*

**Type:** `4_4 6_2`, ratio 2:1, `k=4,q=4,n=6,r=2`, wallpaper `pmg`, orbifold `22*`, paper 1008
("4_4 6_2 - 2e N pmg"). Ledger before this dive: `unknown / L0`, `searched_to_m: 8`,
reason "angle system admits >=3 corners only (NOT a witness)" -- i.e. nothing had actually been
tried past the angle-system check.

**What was run:** `_dev_isohedral/deep_single_type.js 25199 240` -- single-type search, no size
cap, 4-hour wall-clock budget, checkpointing every completed size to
`deep_single_25199_results.json` (raw log: `deep_single_25199.log`).

**Coverage achieved:** every size from **m=8 through m=44 exhaustively** (all sum-types x both
orientations x every offset), plus a partial, incomplete pass into **m=46** before the deadline
cut it off mid-size. **9,690,912 combos total. Zero closures at any size** -- not zero
anisohedral, zero closures of *any* kind, isohedral or otherwise. No clean witness, no L1, no L2.

**Why it stopped at m=44, not higher:** cost is emphatically not linear in m. Per-size combo
count and wall time both grow multiplicatively roughly every 2 sizes:

| m | combos (this size) | cumulative secs |
|---|---|---|
| 30 | 305,760 | 213.6 |
| 34 | 609,280 | 573.2 |
| 38 | 1,116,288 | 1,619.5 |
| 42 | 1,915,200 | 5,306.7 |
| 44 | 2,457,840 | 9,580.5 |

The step from m=42 to m=44 alone cost ~71 minutes; the incomplete step into m=46 burned another
~80 minutes without finishing. Extrapolating the growth curve, m=46 complete would plausibly cost
2-3x the m=44 step, m=48 another 2-3x on top of that -- this is not a "run it overnight and it'll
get there" problem, it is genuinely combinatorially exploding.

**No impossibility argument was attempted here** -- this was pure brute-force closure search, the
same kind of search that already came up empty for the whole q>r family above. It gives NO
evidence toward impossibility (absence of a witness at m<=44 proves nothing about m>44), only that
brute force has hit a wall. **If #25199 is provably impossible, that proof has to come from
somewhere else** -- the angle-system / rigidity / diameter-argument route
([[project-rigid-vs-diameter-args]]) or the deformation-cone search
([[project-deformation-cone]]) that already produced hand-style impossibility proofs for other
types, not from searching further sizes here.

**Standing status: #25199 is `unknown`, unresolved, brute force exhausted to m=44 (partial 46).**

---

# q<r broad sweep launched + standing plan for daily deep dives (2026-08-05)

John: *"I think that I will try to do several of these each day. Right now, let's do a broad
sweep of q<r types. After that, let's do the next single type deep dive on one of the types that
are possible. They may have other solutions later."*

**Ratio census (current, post-ledger-rebuild), unknown-verdict unbalanced types only:**

| q>r | count | already swept | | q<r | count | swept? |
|---|---|---|---|---|---|---|
| 2:1 | 85 | yes, twice (07-29, 08-05) | | 1:2 | ~244 | starting now |
| 4:1 | 16 | yes, twice | | 1:3 | ~18 | starting now |
| 3:2 | 5 | yes, twice | | 1:4 | 53 | starting now |
| | | | | 1:6 | 36 | starting now |
| | | | | 1:8 | 5 | starting now |
| | | | | 1:12 | 5 | starting now |
| | | | | 2:3 | 1 | starting now |

q<r total ~365 (updated slightly from the pre-rebuild 487/106 split since the ledger fix above
promoted 20 more types out of "unknown"). This side has never had the deep-sweep treatment the
q>r side got twice -- it's the obvious next broad target, and it's also where the two homeotypes
with actual known tiles live (`5_3 8_6`, `5_3 6_6`, both ratio 1:2).

Wrote `_dev_isohedral/search_qltr_broad.js` -- same design as `search_qgtr_overnight.js` (adaptive
per-type time slice, size-cap safety net at LO+60, checkpoint after every type to
`search_qltr_broad_results.json`), homeotype order flipped to put `5_3 8_6`/`5_3 6_6` first, then
1:2 before the thinner ratios. Launched in the background with a 4-hour budget (240 min). Smoke
test alone re-surfaced #617 and #69439 as "new" witnesses in its first 3 types -- live confirmation
that the certify.js gap above was real, and a reminder to re-run the certify/rebuild step on
whatever this sweep turns up (both reconfirmations of the already-fixed types AND anything
actually new).

**Standing plan, per John's request:** after this sweep completes, next task is a **single-type
deep dive on one of the now-`possible` types** (any of the 20 above, or similar), specifically
looking for OTHER solutions at different m -- since a type being isohedral at one m says nothing
about whether the same combinatorial type also supports an anisohedral tile at a different m (this
is exactly the #69439/#69445 pattern: same homeotype, isohedral witness at one m, anisohedral tile
at another). This is the third planned action in today's sequence; do it once the q<r sweep's
background job reports done, without waiting for further instruction, per John's "after that"
framing. Pick the candidate the same way #25199 was picked -- prefer whichever known-possible type
has the densest/least-explored size range, or ask John if there's a specific favorite.

**If this session gets interrupted before that:** check
`_dev_isohedral/search_qltr_broad_results.json` for progress/results, then move straight to the
single-type deep dive per the plan above -- no need to re-ask, John already specified the
sequence.

## Built a real shape comparator -- the #25638 retraction's actual fix (2026-08-05)

John: *"We might even have multiple anisohedral types at one m."* True, and the search scripts
already handle it structurally -- `anisoFinds.push(...)` runs unconditionally on every clean
aniso hit, no early exit, so multiple genuine finds per (id, m) or across m were never going to be
silently dropped. The real gap was on the OTHER side: telling whether two finds are actually
different shapes, which is exactly the mistake behind the #25638 "two new tiles" retraction above.
That incident's writeup diagnosed two bugs in `canon()`/`corners()` (exact-flatness vertex
dropping, no scale normalization) but never actually rebuilt a fixed comparator -- the diagnosis
sat there unapplied.

Wrote `_dev_isohedral/shape_compare.js`: compares the CUMULATIVE TURNING FUNCTION (heading vs.
perimeter-normalized arc length) instead of a corner list, searched over every cyclic shift and
both reflections, RMS distance after removing the best-fit constant heading offset. This never
has to decide which vertices "count" -- every vertex contributes its true turn at its true
arc-length position, side-stepping the exact-flatness bug entirely, and perimeter normalization
fixes the scale bug. Caveat carried over from [[project-straight-edge-proxy]]: this still compares
the straight-edge polygon proxy, not the true curve outline, so treat verdicts as strong evidence,
not proof, when curves are involved (`curves=true` is exactly this situation for #25638).

**Calibrated against three known points:**

| pair | RMS (deg) | ground truth |
|---|---|---|
| #25638 m12 off4 vs off10 (trivial offset symmetry) | 0.000 | same tile, sanity check |
| #25638 m12 vs m24 | 5.238 | **John confirmed same** (the retracted claim) |
| #25638 vs #69445 (different homeotype entirely) | 69.219 | different |

Wide, clean gap between the "same" and "different" anchors.

**Applied immediately to a live case:** the q<r broad sweep (below) turned up a THIRD #25638 size,
m=36, that neither of us has looked at yet. RMS from m=36 to m=12 is 12.314 deg, to m=24 is
10.535 deg -- roughly 2x the known-same anchor (5.238) but nowhere near the known-different one
(69.219). **Read: m=36 is very likely another redescription of the same shape/family, not a
genuine third tile, but it's a materially worse match than the m12/m24 pair and hasn't had a human
look at it. Needs tilerTest.html confirmation before any claim either way, same as always.**
Combo files: `combos/combo_UNBALQLT_25638_m{12,24,36}_si*_off*.json`.

**Going forward: use `shape_compare.js` on any group of aniso finds sharing an id before claiming
"multiple new tiles"** -- it's the reusable fix the #25638 incident should have produced the first
time.

## q<r broad sweep: finished, 25 total ledger corrections now applied (2026-08-05)

```
TOTAL: 26,709,000 combos, 948 closed, 365/365 types done -- ran to completion
```

**10 anisohedral finds, all already known** (4x #69445 m=26, 6x #25638 across m=12/24/36 -- see
the shape-comparator section above). No genuinely new anisohedral tile.

**14 types with a clean isohedral witness the ledger still called `unknown`.** 9 of the 14 were
already fixed earlier this session (the "other 9" from the 07-29 corrections). The remaining
**5 were newly found and newly fixed**: #617, #69445, #72954 (`5_3 8_6`), #3215 (`4_2 6_6`), #4810
(`4_2 10_8`) -- certified L2 at m<=16, merged, `build_ledger.py` rerun. **Ledger totals now: 187
impossible / 403 possible / 680 unknown.** Between the two ledger-fix passes today, 25 types moved
from `unknown` to `possible`.

## Next single-type deep dive, per John's standing plan: #69439

Picked using the same "least-explored" logic as #25199, but with an extra reason: #69439 (`5_3
8_6`, ratio 1:2) is now `possible` (isohedral witness at m=10, fixed above) and **already has a
known anisohedral tile at m=30** ([[project-unbalanced-tiles]] -- John's own stored combo, a
polyiamond). The broad sweep only reached **m=20** for this id before its time slice ran out --
it never even got to m=30 in this pass, let alone past it. So this is exactly the "possible type,
may have other solutions later" case John asked for, with a concrete, independently-verified
answer already sitting past the sweep's reach: if the deep dive reaches m=30 it should re-find
John's known tile (a live regression check on the whole pipeline), and anything beyond that is
genuinely unexplored territory for this type.

Other `5_3 8_6` candidates and where the broad sweep left them, for reference: #72126 mHi=22,
#72954 mHi=32, #617 mHi=42 (already the deepest of this family). `5_3 6_6` family (#360, #25338,
#25347) all reached mHi 24-56 already, comparatively better covered.

Launched `deep_single_type.js 69439 180` (3-hour budget) in the background.

## shape_compare.js v1 was wrong; reworked around STRUCTURAL reducibility (2026-08-05)

John, after being asked to visually check the #25638 m=36 find: he deliberately hand-edited the
saved combo (moving interior vertices of what he could see were reducible 3-edge groups) and
reported that v1 called it DIFFERENT from m=12 (32.4 deg) when it plainly is not. His diagnosis:
*"when we combine edges to form an edge in a reduced form, the vertices may move -- it's just
like decorating a curve. We don't care where the user moves the curved points. The base edge
stays the same... When the three edges combine, we don't care where the middle two vertices go.
Just look at the end to end vertices."*

v1 compared the turning function over EVERY vertex, so it was exactly as fragile as the ORIGINAL
`canon()`/`corners()` bug it was meant to replace -- just with a numeric-tolerance flatness test
instead of an exact one. Still wrong in kind: reducibility isn't about how close a vertex's
solved angle happens to land to 180, it's a STRUCTURAL property of (id, m, orient, off, si) --
whether the angle-equation system ties any equation to that vertex at all. aniso_fast.js/aniso.js
already compute exactly this (the `vertexAngle` array behind the "impossible - reducible" flag)
and just never exposed it.

**Fix, three files:**
- `engine/aniso_fast.js` and `engine/aniso.js`: added a module-scope `reducibleVertex` global
  (mirrors the existing `tileEdges` pattern), set to `vertexAngle.slice()` right after specify()'s
  fixed-point reducibility computation. 1 = genuine combinatorial vertex, 0 = redundant/decorative.
- `engine/test_harness.js`: `config()` now also returns `cfg.vertexAngle = reducibleVertex.slice(0,
  m)`.
- `engine/_dev_isohedral/shape_compare.js`: rewritten to fetch this mask, filter the tile's own
  outline down to real corners ONLY, and run the turning-function comparison on that reduced
  point list (chord lengths + turn angles between real corners, ignoring interior positions
  entirely).

**Recalibrated on reduced corners:** #25638 m=12/m=24/m=36-raw/m=36-hand-edited-to-fool-v1 all
reduce to exactly **12 real corners** (confirms structurally what was previously only guessed at
from angle proximity) and score **3.3-8.9 deg RMS from each other** -- including the deliberately
adversarial hand-edited file, which v1 scored 32.4 deg (DIFFERENT) and v2 scores 3.4 deg (SAME).
#25638 vs #69445 (genuinely different homeotype) stays firmly at ~64 deg. New thresholds: <10 deg
same, 10-30 ambiguous, >30 different.

**Standing conclusion: #25638's m=12, m=24, and m=36 finds are one shape, not three** -- the m=36
"new" find from the q<r sweep is not a new tile. Use `shape_compare.js` (v2) for any future
"is this new?" question; v1's approach is retired.

## eqs is now a direct read too -- the last text-round-trip in config() is gone (2026-08-05)

John: *"Can you just let aniso.js & the fast version return the netEdgeData[] array? or
whichever other arrays or variables we need? I know that traditionally it prints, cause that's
what I can read. But we can update it to talk to other programs."* `netEdgeData` was already
exposed (`cfg.ned`, since before this session). `whichEdge`/`edgeSym`/`mapping` were fixed
earlier today via the `tileEdges` global. The one still going through a text-print-then-regex-
parse round trip was `eqs` (the angle-equation system) -- `parseCfg` split `forTextFile` on
"tileAngles" and regex'd the "."-joined number lines back into arrays.

Found the exact print loop generating those lines (aniso_fast.js ~1273-1283, identical in
aniso.js): after specify()'s row-sorting passes finish, it walks `tileAngles` (each row
`tileLength+1` numbers: m angle coefficients + a constant) and prints any row whose absolute
values don't all sum to zero. Exposed `tileAngles` itself as a new module-level global,
`tileAnglesOut`, set right at that same point in both `aniso.js` and `aniso_fast.js` (mirrors the
existing `tileEdges`/`reducibleVertex` pattern exactly). `test_harness.js` and
`test_harness_std.js`'s `parseCfg` now build `eqs` by replicating that same filter directly on
`tileAnglesOut` instead of parsing text.

**Verified byte-identical, not just "should be equivalent":** wrote a throwaway script comparing
old-text-parse vs new-direct-read `eqs` across 12,324 (id, m, si, orient, off) combos spanning 17
types -- 0 mismatches. Cross-checked `aniso_fast.js` vs `aniso.js` agree on `eqs`/`whichEdge`/
`edgeSym`/`mapping` for #25638 m=36 (they must run in SEPARATE node processes -- loading both
harnesses in one process makes their `eval`'d globals clobber each other, a pre-existing
limitation, not a new bug). `test_harness.js`'s own regression suite (0-overlap set) still passes.

**What's left print-only, if this gets picked up again:** haven't audited beyond `ned`/
`tileEdges`/`vertexAngle`/`tileAngles` for other locally-scoped state worth exposing (e.g.
`netAngles` mutation state, if any) -- these four covered every current consumer of `forTextFile`
in `test_harness.js`/`test_harness_std.js`.

## Deep dives now always finish a full m size (2026-08-05)

John: *"When we're doing deep dives on individual types, let's always stop at the end of some m
size."* The #69439 dive above got cut off mid-m=48 by its 3-hour deadline -- a size that's only
partially tried (some (si,or,off) combos checked, most not) can't be read as "m=48 has no
anisohedral tile," only "m=48 wasn't finished."

`deep_single_type.js` changed: the deadline is now checked ONLY between sizes, never inside the
inner loop -- once a size starts, it runs to completion however long that takes. Added `maxM`
(3rd CLI arg) to deliberately stop after a specific size finishes rather than running to a time
budget, and RESUME support: if a results file already exists for the id, it loads
`mLastComplete` and continues from there instead of redoing finished sizes (`cumSecs` stays
continuous across the resume via a carried-forward base).

Used it immediately: `node deep_single_type.js 69439 300 48` resumed from the interrupted run
(mLastComplete=46) and will run m=48 to completion, however long that takes, then stop (maxM
disables the deadline entirely -- completeness now outranks the time budget by design). Prior
partial-m=48 finds are preserved (536 clean witnesses, 8 anisohedral -- both known tiles at
m=26/m=30, nothing new) since the checkpoint file was never touched, only appended to.

**m=48 finished (2026-08-06):** 4,930,464 combos, 80 closures, all isohedral. `#69439` is now
exhaustively searched m=8 through m=48 -- **21,110,320 combos total, 588 clean witnesses, 8
anisohedral (still just the two known tiles at m=26 and m=30). No new find at any size past m=30.**

---

# Deep search moved into tilerTest.html (2026-08-06)

John: *"Is there a way that we could put this in tilerTest.html? So a user could choose which
types to explore and how deep to explore? I don't think that I will explore everything as deeply
as some may want to go."*

Ported `_dev_isohedral/deep_single_type.js`'s recipe (solveTile -> verticesOf -> develop ->
overlapStrict -> checkBlock) into a new "deep search" view in `tilerTest.html`/`tilerTest.js`,
chunked across `setTimeout` ticks (25ms budget each) so the tab stays responsive and Stop
actually works, instead of one blocking call.

**Changes:**
- `tilerTest.html`: added `<script>` tags for `isohedral_criteria.js` and
  `isohedral_criteria_fast.js` (both already browser-safe via the same UMD pattern
  `tiler_curves.js`/`overlap_strict.js` use -- just never linked in), plus a "deep search (find
  tilings)" option in the view dropdown.
- `tilerTest.js`: new `viewDeepSearch`/`deepSearchTick`/`renderDeepSearchLive` (~150 lines).
  Same Stop-only-at-a-size-boundary policy as `deep_single_type.js`
  ([[feedback-finish-full-size]]). Also fixed `tilerTest.js`'s `parseCfg` to read `eqs` off
  `tileAnglesOut` directly (it still had the old text-parse `eqs` even though `whichEdge`/
  `edgeSym`/`mapping` were already fixed earlier in the session), and sped up its `loadType`
  from a `JSON.parse(JSON.stringify(...))` round-trip to a shallow row-copy (matches
  `test_harness.js`'s existing optimization) -- both matter far more here than before, since deep
  search calls them thousands of times per size instead of once per manual UI click.
- **State-corruption guard:** deep search shares the same global engine state (`netEdgeData`,
  `tileAngles`, `cur`, ...) as every other view. Navigating away (switching views, loading a
  result, picking a different type) pauses the search immediately -- resumable, not a real stop
  -- rather than letting its next tick's `loadType` silently fight whatever the user just did.

**Verified in a real browser (Playwright, local static server), not just by reasoning:**
1. Loaded `tilerTest.html`, ran deep search on #69439 up to m=12 -- reproduced the EXACT known
   witness (`m=10 si=2 or=0 off=9`, matching the certify.js config precisely) among 28 clean
   closures, 0 false positives.
2. Caught and fixed a real bug this way: `deepSearchReset` reassigned the module-level state
   object, but `viewDeepSearch` had already captured the old reference -- the target-m input
   rendered "null" on first load. Fixed to mutate in place (`Object.assign`).
3. "load" button correctly switches to the tile view and shows "checks closes" / the true-
   parameter family for the loaded result.
4. Pause-on-navigate-away confirmed: switched to "tiles" view (via Load) and back to
   "deepsearch" -- all 20 prior results and progress were intact, "resume" (not "start") offered.
5. "stop after this size" confirmed to wait for a boundary, not cut off mid-size: clicked while
   mid-search, it kept running through m=14/16/18 (all cheap, fast) before actually halting.
6. Directly exercised the ANISOHEDRAL branch (never hit during the live #69439 sweep since its
   real anisohedral sizes are m=26/30, too slow to reach live in this test session) via
   `browser_evaluate` on the known #25638 m=12/si=5/or=0/off=4 witness: `ov=0`, zero single-tile
   matches, block search returns `5@3t` -- byte-for-byte the same as the Node script's result.

**Not yet done:** a live run reaching an actual anisohedral find end-to-end through the UI itself
(rather than via direct evaluate) -- every real anisohedral example known is too deep (m>=12 with
thousands of combos, or m=26+) to reach quickly in an interactive test session. The underlying
code path is proven correct (#5 above); a full live UI confirmation is just a matter of someone
running it long enough on a type known to have one.

**Update, same session:** John pointed at the gallery's low-m anisohedral examples (m=4/5/6,
`combos/combo_25577_*` etc. -- built by the m=3/4/5/6 census, [[project-low-edge-anisohedral]])
for a fast live test instead of waiting on a slow deep type. Ran deep search on #25577
(`4_2 4_2`, balanced) up to m=6 in the real browser: **`m=4 si=0 or=1 off=1 -> ANISOHEDRAL
block=3@2t`**, exactly matching the gallery's recorded entry for #25577 (block_criteria "3",
off=1, orient=1). Full end-to-end live confirmation, both branches now proven in a real browser,
not just via `browser_evaluate`.

---

# Two more overnight unbalanced deep dives: #69445 and #25638 (2026-08-05, ~21:33 local)

John: *"Can you set up to do a deep dive on two more unbalanced types overnight? (Ones that
already had one example.)"* Plus a robustness ask: *"I hope this will still work if we lose
internet connection for a while."*

**Picked #69445 and #25638** -- the only two unbalanced types with a confirmed real anisohedral
tile that haven't had `deep_single_type.js`'s uncapped treatment yet (only the broad q<r sweep's
thin per-type slice: #69445 reached mHi=30, #25638 reached mHi=40 -- both barely past their own
known witness). #69439 already got this treatment earlier today (finished m=48, nothing past the
known m=26/30). These two are the natural next pair.

**Robustness against a network drop:** background tasks launched through the normal tool
(`run_in_background`) are tracked by this session -- if the connection to this client drops, it's
genuinely unclear whether that tracking survives, even though the actual computation is 100%
local and needs no internet. To make the computation itself independent of the session, launched
both via a detached OS process instead: a tiny `.cmd` wrapper per type
(`run_deep_69445.cmd`/`run_deep_25638.cmd` in `_dev_isohedral/`, just `cd` + `node
deep_single_type.js <id> 540 > log 2>&1`), started with PowerShell's `Start-Process -WindowStyle
Hidden` (no `-Wait`) -- this breaks the parent-console attachment, so the node process is a fully
independent Windows process, not a child of this session's shell. Confirmed via
`Get-CimInstance Win32_Process` that both are running with the correct command line. **If this
session or the connection drops, the two processes keep running and keep checkpointing to
`deep_single_69445_results.json`/`deep_single_25638_results.json` regardless** -- read those
files directly (or just re-open `deep_single_69445.log`/`deep_single_25638.log`) to see where
they got to, from a fresh session if needed. 9-hour budget each (540 min), same finish-a-full-
size-before-stopping policy as always.

**Early result already in, worth flagging now:** within the first few minutes, #25638 reached
m=48 and found 2 more "aniso" hits there. Checked immediately with `shape_compare.js` (v2,
reducibility-aware) against the known m=12 tile: **RMS=8.866 deg -> SAME shape** (both reduce to
exactly 12 real corners). Expected, not a new find -- this type's combinatorics apparently let
the same physical tile redescribe at any multiple of 12 (12, 24, 36, 48 all confirmed same so
far), so it will likely keep "rediscovering" itself every 12 sides as the search goes deeper.
**When reviewing results in the morning: anything at m = a multiple of 12 with the same block
criterion (5@3t) is presumptively the same known tile -- run it through `shape_compare.js` before
getting excited, and the genuinely interesting question is whether anything turns up at a
NON-multiple-of-12 size, or with a different block criterion.**

## Both overnight dives finished cleanly at their boundary (2026-08-06 morning)

John asked to stop them "after the current number they are on" -- needed no action: both had
already blown past their 540-min deadline hours earlier (mid an expensive size), and
`deep_single_type.js`'s deadline check only fires BETWEEN sizes, so they were always going to
self-stop the moment their in-progress size finished. They did:

- **#69445: finished at m=94.** 13,722,720 combos, 1,576 closures, 12 anisohedral -- three
  reconfirmations of the known m=26 tile, now also at m=52 and **m=78** (checked with
  `shape_compare.js`: RMS=0.000 deg, same shape). No new tile past m=30.
- **#25638: finished at m=144.** 6,713,280 combos, 48 closures, 24 anisohedral -- the same tile
  redescribed at every multiple of 12 from m=12 to m=144 (12 sizes x 2). No new tile.

Both processes have exited (confirmed no leftover node.exe for either). Two solid, thorough
negative results -- #69445 and #25638 both look exhausted at every size reachable in ~9-10 hours
of overnight compute. Real news would be a different block criterion or a non-multiple-of-the-
known-period size; neither showed up.

## Extending the low-edge gallery to m=7 (2026-08-06)

John: *"Can you add to the gallery the size m=7 across all types?"* -- the gallery only covered
m=3/4/5/6 ([[project-low-edge-anisohedral]]). Pipeline is `sweep_aniso.js <m>` (generic, no
m=6-specific hardcoding) -> `criteria_m<m>.csv` -> a reducibility filter (m=6's version,
`reducibility_check_m6.js`, is hardcoded to a pasted-in target list -- needs generalizing to read
straight from the csv's `aniso=YES` rows) -> export `combos/combo_<id>_m7_si<si>_or<or>_off<off>.json`
per surviving hit -> `node py/gen_gallery.js` regenerates `gallery_manifest.js` from every combo
file present (additive -- doesn't disturb existing m=3/4/5/6 entries).

`sweep_aniso.js 7` launched (background): **stage 1 done -- 4,679 closing combos across 934
types, 604 raw candidates** (m=6 had far fewer types since fewer homeotypes have k,n<=6; m=7 is
noticeably bigger). Stage 2 (precision guard) + stage 3 (overlap + block proof) still running as
of this writing -- check `sweep_aniso_m7.log` / whether `criteria_m7.csv` exists yet before
continuing to the reducibility-filter step.

**Still to do once the sweep finishes:** generalize `reducibility_check_m6.js` to take its
`targets` from `criteria_m7.csv`'s `aniso=YES` rows instead of a hardcoded list (the actual
filter logic -- aniso.js's structural reducibility flag AND I/I-flanked check -- is already
generic, only the target list at the top is m=6-specific), export combos for the survivors, then
run `gen_gallery.js`.

## Curve-variant assignment was sharing ONE counter across J/U/S (2026-08-06)

John: *"we need different shapes for different curves. If there are 4 different S curves, we
need 4 different shapes."* Confirmed the bug: `assignCurveVariants` (in both `tilerTest.js` and
its hand-synced port in `py/gen_gallery.js`) numbered every non-`I` curved orbit with ONE shared
counter regardless of type (J/U/S all pulled from the same 0,1,2,... sequence), then
`motifPts(type, variant)` picks from only **5** `HALF_MOTIFS` via `variant % 5`. A type with, say,
2 J orbits + 4 S orbits numbers them 0-5 combined -- variant 5 wraps to `HALF_MOTIFS[0]`, the same
motif as whichever orbit got variant 0, regardless of type. Two S orbits (or an S and a J) could
end up visually identical purely from this collision, nothing to do with how many motifs exist.

**Fix:** number each curve TYPE's orbits separately -- J starts its own 0,1,2,..., U its own, S
its own. Verified with a synthetic test (2 J + 4 S orbits, interleaved rep numbers): old shared
counter would give the 4 S orbits variants 2,3,4,5 -> variant 5 wraps to the same motif as J's
rep-0 orbit; new per-type counter gives them 0,1,2,3 -- four distinct motifs, guaranteed up to 5
orbits of any one type. Applied to both `tilerTest.js` and `py/gen_gallery.js` (kept in sync by
hand, per the existing comment there). Did not find a natural example with 4 distinct S orbits to
screenshot (only found up to 2 in a quick scan of ~400 types) -- fix verified by direct logic
test instead, plus a live-browser reload of the earlier J-curve example showed no regression (55
errors, all pre-existing thumbnail 404s, 0 warnings).

## J curve default shape, checked live in a browser (2026-08-06)

Earlier fix (previous session entry) changed the default J motif from a squeezed centred window
to full-size-in-the-first-half-then-flat. Loaded #25577 (`4_2 4_2`, all-J edges) in a real browser
via Playwright and screenshotted both the full tiling and a single zoomed tile: each edge shows a
clear asymmetric notch/point (not a smooth symmetric bump), distinguishable from U's mirror-pair
and S's point-symmetric-pair by eye. Screenshots were scratch verification only, not saved.

## Verified the S-curve-variant fix on a real example, and hit a real Playwright caching trap

John pointed at the actual real case: **`#1727337` m=6 si=0 orient=0 off=2** has curves
`SSJSSJ`, `whichEdge` `0,1,2,3,4,2` -- 4 distinct S orbits (reps 0,1,3,4) plus 1 J orbit (rep 2,
used twice). Loading it live in the browser to check the fix.

**First attempt gave the OLD (buggy) result** even after editing the file and confirming via
`node --check` and re-reading the source -- `assignCurveVariants.toString()` in the page came back
as the pre-fix version. Traced it to Playwright's browser context caching `tilerTest.js` at the
HTTP layer, and **the cache survived closing the page and reopening the same URL** -- only
switching the local test server to a brand-new port (fresh origin, so a fresh cache partition)
actually picked up the edit. `curl`ing the server directly the whole time confirmed the disk file
and server were correct throughout; this was purely a browser-cache artifact of reusing one
long-lived Playwright session across many edit/reload cycles today. **Lesson for next time:** if
a browser-verified fix doesn't show up after a reload, don't trust "the file must be wrong" --
check `curl` vs. the live page's own `.toString()` of the changed function first, and if they
disagree, suspect the browser cache before the code.

**Confirmed on the real example, correct port:** S orbits (reps 0,1,3,4) got tooth-up/tooth-down/
tab/double -- four distinct motifs, verified both by reading `curveEdits` directly (`pts` arrays
byte-compared against `HALF_MOTIFS`) and by screenshot. J's own orbit (rep 2) independently got
its own variant-0 (tooth-up, J-style asymmetric render), unaffected by the S pool, confirming the
per-type separation works as designed. Bonus: the self-crossing warning present under the OLD
(colliding) motif assignment is GONE under the fix -- different motifs at that tight corner
happened to avoid the crossing the collision caused.

## m=7 gallery pipeline completed (2026-08-06)

`sweep_aniso.js 7` finished: **4,679 closing combos across 934 types, 473 raw anisohedral hits**
(vs m=6's 148 -- more types have k,n<=7 than <=6). Wrote `criteria_m7.csv`.

Generalized `reducibility_check_m6.js` into `reducibility_check.js <m>` -- reads targets from
`criteria_m<m>.csv`'s `aniso=YES` rows instead of a hardcoded list; the actual filter logic
(aniso.js's structural flag AND I/I-flanked check) was already generic. **Sanity-checked against
m=6 first: reproduced 148/7/141/9/132 exactly**, matching the documented numbers -- confirmed
correct before trusting it on m=7. Result at m=7: **473 raw, 44 bad (solve-fail/clamp, correctly
excluded per [[project-clamp-false-closure]]), 12 genuinely reducible, 417 kept.**

Wrote `export_reps.js <m>` -- exports `combos/combo_<id>_m<m>_si<si>_or<or>_off<off>.json` for the
keep list, angles/lengths taken straight from `criteria_m<m>.csv` (already solved by
`sweep_aniso.js`, no re-solve needed). Added the same dedup m=6 needed: different `off` values
for the same (id, si, orient) are the same physical tile at a different starting point --
verified this by checking m=6's own numbers first (132 kept rows -> exactly 84 groups, matching
the documented count), then applied the same collapse to m=7: **417 kept rows -> 315 distinct
combos exported.** Ran `py/gen_gallery.js`: **467 combos rendered total, gallery_manifest.js
regenerated.**

**Flag for John, not decided unilaterally:** `gen_gallery.js`'s group tagging is `WEIRD_` prefix
-> 'weird' group, everything else -> 'aniso' group. That "everything else" now includes all the
`combo_DEEP_*`/`combo_UNBALQLT_*` files from the unbalanced-type deep dives (m=12 through m=144,
~50 combos) -- they were never WEIRD_-tagged and this is the first `gen_gallery.js` run since
those files existed, so they're now mixed into the low-edge "aniso" catalog group, sorted after
m=7 by the existing m-ascending sort. Confirmed counts: aniso group m=4(3)/m=5(18)/m=6(72, down
from 84 after John's later visual-review exclusions)/m=7(315), then ~50 more spread across
m=12..144. **Same pattern as m=6: automated filter is a first pass, not a final answer** --
m=6's needed John's visual review to catch 11 more reducible ones the automated check missed.
Expect m=7's 315 to need the same kind of look before treating the count as final.

**One anomaly worth a look, not blocking:** 4 of the 429 solved-ok m=7 candidates have aniso.js's
structural reducibility flag set but ZERO vertices numerically near 180 deg (#25550 x2, #209222
x2) -- m=6 had zero such cases. They're correctly Kept either way (the exclusion rule requires
BOTH signals to agree, and it doesn't fire without a numeric flat vertex), so this doesn't cause a
wrong exclusion, just an unexplained disagreement between the two signals worth understanding
before it comes up again at a larger m.

## Unbalanced deep-dive combos split into their own gallery group (2026-08-06)

John: *"Tag the unbalanced into their own group."* `py/gen_gallery.js`'s group tagging was
`WEIRD_` prefix -> 'weird', everything else -> 'aniso' -- added a third case:
`combo_DEEP_*`/`combo_UNBALQLT_*` (the unbalanced-type deep-dive byproducts) -> new 'unbalanced'
group. Updated the sort comparator too (it was only ever binary "weird last, everything else
first," which would have left aniso/unbalanced order undefined against each other) to an explicit
`GROUP_ORDER` map: aniso, then unbalanced, then weird. Added the matching `<option>` in
`tilerTest.js`'s `viewGallery()` selector, and reworded "weird"'s label from "(unbalanced, etc.)"
to "(John's hand-picked unbalanced tiles)" since that phrase was about to become actively
misleading now that a separate automated 'unbalanced' group exists.

Reran `gen_gallery.js`: **aniso group is now clean -- 408 (3+18+72+315, exactly m=4/5/6/7, no
stray large-m entries), unbalanced group 54, weird 5, 467 total.** Verified live in a browser
(fresh port again, per [[feedback-playwright-cache-trap]]): all three `<option>`s present with
correct labels, `aniso` shows 408, `unbalanced` shows 54, matching the manifest exactly.

## J curve: overhang, not just an off-centre bump (2026-08-06)

John hand-dragged #25577's default J curve peak from (0.4, 0.15) to (0.51, 0.20) -- PAST the
fixed x=0.5 return-to-baseline point -- saved it as `J_Curve.json`, and said it's what actually
lets him read edge direction ("this helps me see how the edge is oriented"). The distinction from
yesterday's fix: a bump confined to one half is asymmetric in POSITION, but its silhouette is
still a plain symmetric bump -- nothing about the bump's own shape says which way is "forward".
An OVERHANG (the tip poking past the point the curve already commits to returning to baseline at)
reads as directional regardless of position.

Generalized (not hardcoded to his exact numbers) in `tiler_curves.js`'s `motifPts`: for J, find
the half-motif's single highest-|y| point (its "tip") and push its x out by a fixed `HOOK = 0.11`
past wherever it already sits, before placing the motif and running flat to (1,0) as before.
Variant 0 (tooth-up, the default) now produces `[[0,0],[0.3,0],[0.51,0.15],[0.5,0],[1,0]]` --
matches John's hand-edit almost exactly (0.51 vs. his 0.5096; height left at the motif's own 0.15
rather than his 0.199, since the ask was about direction, not size). Variants with two equal-
height peaks (tab, double) only hook the first one found -- a minor known imperfection, not
pursued further since the default (variant 0, tooth-up) is the common case and matches cleanly.

Verified live (fresh port, #25577, m=4): all 4 edges show a clear directional hook, `closes`,
zero self-crossing warnings, `node test_harness.js` regression suite unaffected (0 overlaps).

## Curve motif library replaced wholesale: 5 -> 12, traced from John's JSU.svg (2026-08-06)

John: *"I just saved a svg file JSU.svg in program4 folder. These are examples of what you might
use for J, S and U curves. I don't care if it's an exact match."*

`JSU.svg` (Inkscape) has 12 example paths, all right-angle steps with occasional diagonal
returns -- a different STYLE from v3's smooth diagonal teeth, and structurally the same
flat-notch-flat shape our half-motif convention already uses (start at baseline, some notch,
return to baseline at the far end).

**Ported, not hand-copied:** wrote a small SVG path parser (handles M/m/H/h/V/v/L/l and
C/c -- the few cubic-bezier commands in the file all have control points collinear with their
endpoint, i.e. are actually straight lines, so just take the endpoint), normalized each of the
12 into x in [0, 0.5] (uniform scale so width matches our half-motif domain) with y-amplitude
bumped from the traced ~0.05 to ~0.13 to match the rest of the UI's visual scale -- not an exact
coordinate match by design, per John's own instruction.

**Replaced `HALF_MOTIFS` entirely** (`tiler_curves.js`): 12 new entries (step-notch, shelf-left,
staircase, twin-spike, lightning, square-wave, diagonal-drop, hook-complex, bump, plateau,
plateau-hook, split-spike) replacing the old 5 (tooth-up/down, tab, double, overhang). Everything
downstream is unchanged and just works with a bigger pool: `motifCount()`/`motifName()` already
read `HALF_MOTIFS.length` generically, the per-type variant numbering fix from earlier today
scales the same way (now up to 12 distinct shapes per curve type instead of 5), and J's overhang-
hook fix (also earlier today) reapplies automatically to each new motif's own tip.

**Note:** the old comment about variant 1 being a deliberate up/down mirror pair (the
#209471/#209472 self-crossing escape hatch) no longer applies -- the new set isn't arranged that
way. Doesn't affect those two saved combos (their `curveEdits` are frozen at save time,
independent of `HALF_MOTIFS`); the general fallback for a future self-crossing case is still the
documented per-orbit sign-flip technique ([[project-low-edge-anisohedral]]), not tied to which
motif is chosen.

**Verified:** `node --check` + `node test_harness.js` regression suite (0 overlaps, unaffected --
this only touches default curve cosmetics). Live in browser (fresh port): `#1727337` m=6 si=0
off=2 (the 4-S-orbit case) now shows 4 distinct NEW motifs (step-notch/shelf-left/staircase/
twin-spike) in the new rectilinear style, closes cleanly, 0 crossing warnings. Reran
`py/gen_gallery.js`: all 467 combos re-rendered with the new default look (only affects combos
that never had explicit hand-edited `curveEdits` saved, which is most of the low-edge catalog --
anything with its own saved `curveEdits`, e.g. `J_Curve.json`-style hand edits, is untouched).

## Do we ever need more than 4 same-type curve orbits? Investigated, John's instinct confirmed

John: *"I don't know when we would ever need more than 4 edge shapes. If you have examples, I'd
be interested. I suspect that some would have to combine to close or something."* Also: *"You
could still do mirror variants of any of the J curves. (Or U curves)."*

**Scanned every type** (~70,000 configs: every id, m in {LO, LO+2, LO+4, LO+6, LO+8}, si<4, off<5),
counting distinct same-curve-type orbits (J/U/S separately) per closing config.

**First pass (closure only, no reducibility filter) found J reaching 9** (#209385, m=18) and S
reaching 4 (#25520, m=8, and independently #25525 -- same count, different type). But #209385's
9-J-orbit config is flagged `"note": "reducible"` -- checked `vertexAngle`: mostly zeros, meaning
most of those "9 orbits" are redundant vertices from a smaller underlying shape (its `whichEdge`
pattern is a near-palindrome, `[0,0,2,3,4,5,6,7,8,9,9,8,7,6,5,4,3,2]` -- literally a reflected
double of a ~9-sided core), not 9 independently-choosable curve decisions.

**Re-ran filtering out anything with `cfg.note` containing "reducible"** (12,122 of 69,845
configs were reducible -- ~17%): **max drops to J=2, U=1, S=4.** #25520 (S=4) is the ONLY case
found across the whole scan that's both genuinely non-reducible AND needs more than 2 distinct
shapes of one curve type -- same scale as the #1727337 case that started this thread. **John's
instinct was exactly right**: the high counts (J up to 9) were real, but only because "some would
have to combine to close" -- once you exclude descriptions that are secretly redundant, 4 (for S)
is the practical ceiling found, and J/U need even fewer. The 12-motif library has generous
headroom for what real cases actually need.

**Added mirror variants**, per John's suggestion, as a general-purpose extension rather than
a one-off: `tiler_curves.js`'s variant space is now double `HALF_MOTIFS.length` (24, not 12) --
indices `[0,12)` are the motifs as drawn, `[12,24)` are the same 12 with y negated (mirrored
across the baseline). `motifCount()`/`motifName()`/`motifPts()` updated via a new internal
`motifBase(variant)` helper; nothing else changed. This restores, generally, the escape hatch v3's
motif set had baked into one specific pair (flip to the other side of the baseline to clear a
tight self-crossing corner, e.g. #209471/#209472) -- now available for ANY motif via variant+12,
not just one designated pair. Verified: `node --check`, regression suite (0 overlaps), full
`gen_gallery.js` rerun (467/467, no errors -- no real type has enough same-type orbits to ever
reach the mirrored half in practice, so no visual change expected or observed).

## #1727337 m=12->10: reduction is real, but no matching m=10 combo found anywhere (2026-08-08)

John loaded `combo_1727337_m12_si535_or1_off8.json` and said it should reduce to 10 sides
(edges 0/1 join, edges 9/10 join), but couldn't get it working himself. Confirmed the specific
claim exactly: `cfg.vertexAngle` for this exact config is `[1,0,1,1,1,1,1,1,1,1,0,1]` -- positions
1 and 10 are BOTH structurally flagged non-vertices, matching his description precisely. Built
the reduced 10-corner shape by dropping those two positions from the m=12 outline: it's a valid
simple closed polygon (total turning 360, closes exactly, positive area) -- the reduction itself
is real.

**But no m=10 combo reproduces it.** Searched exhaustively:
- **Same id (#1727337), all m=10 combos:** 1,056 closing configs checked, best match RMS=43 deg
  (real mismatch -- our "same shape" threshold is <10 deg, calibrated in
  [[project-25638-new-tiles]]).
- **Every OTHER type with k,n<=10** (`_dev_isohedral/find_shape_m10.js`): 819 of 1,067 eligible
  types checked before a 20-min budget ran out (17,188 combos), best RMS=39 deg
  (#25523) -- no improvement trend across the last several hundred types checked, so finishing
  the remaining ~250 seems unlikely to change the answer, but isn't proven.

**Likely explanation, found by checking the raw numbers:** `A[1]` and `A[10]` in the saved combo
are bit-exact `180` (`===180` in floating point) while the OTHER near-flat angles (`A[2]=
180.5001018904516`, `A[11]=180.999801235207`) have realistic solver noise. Real Newton solves
essentially never land on an exact integer -- this strongly suggests A[1]/A[10] were hand-set
(via the true-parameter sliders or direct entry) to force exact flatness, not organically solved.
The shape still closes perfectly with these hand-set values (verified: closure error 0 to 8
decimal places), meaning this type's free-parameter family has enough slack to absorb 2 extra
exact constraints -- but that doesn't mean the resulting point in the family lands on any of the
FINITELY MANY discrete sum-type-parameterized shapes at m=10, for this id or any other. It's a
valid geometric operation on this specific hand-built instance, not necessarily a combinatorially
guaranteed reduction reachable through the type catalog.

**Not resolved -- next steps, if John wants to keep going:** (a) let `find_shape_m10.js` finish
the remaining ~250 types (`node find_shape_m10.js target10.json 10 <minutes>`, target already
saved at `_dev_isohedral/target10.json`), or (b) check the net-edge structure directly (which net
edges do positions 1 and 10 come from, via `cfg.ned`) to see whether ANY m=10 sum-type of
#1727337 even has the right STRUCTURAL pattern (matching whichEdge/edgeSym), independent of
whether a specific numeric solve happens to realize the same geometry -- a stronger, more
definitive check than the numeric shape search already done.

## #1727337 m=12->10: SOLVED, and automated as a general tool (2026-08-08)

John found the actual answer by hand (`64642b5.json`: id=1727337, m=10, sum=[1,0,0,0,4,0,0,0,0],
orient=1, off=7) and pointed out the real gap: *"our method of creating sum types is missing
something... Can you see what's missing?"*

**What was missing, in my own reasoning, not in `findSumWays` itself:** each physical boundary
position is covered by TWO net edges, not one -- one from each polygon's independent edge-walk
around the SAME boundary (orient 0 = k-gon side, orient 1 = n-gon side). My first attempt only
shrank the orient-0 net edges under the two dropped vertices (edges 0 and 4); the correct
reduction also has to shrink the orient-1 net edges that independently cover those SAME
positions (edges 8 and 10) or the two walks disagree about the boundary length. Once corrected,
the target sum `[1,0,0,0,4,0,0,0,0]` (all four net edges 0/4/8/10 dropped from size 2 to 1, matching what the
correct reduction should look like) turned out to already exist in the enumeration --
**si=34 at m=10**, exactly matching John's own answer. The sum-type generator wasn't missing
anything; my manual reduction was incomplete.

**Automated the whole thing**, per John's request ("it would be nice if there was some way to
automatically find the reduced version... replace each vertex with a point on the curve and
combine the two curves that get joined... find the combo"): `_dev_isohedral/reduce_combo.js
<comboFile>`.

Algorithm:
1. Find every reducible vertex (`cfg.vertexAngle[i]===0`), group into maximal runs.
2. For each dropped position, tally EVERY net edge that covers it (both orientations) and
   decrement each by 1 -- this is the fix above, now automatic.
3. Search every si at the smaller m for the one whose net-edge size vector matches exactly
   (sizes depend only on (id,m,si), not orient/off -- verified empirically, so this search is
   cheap and doesn't need orient/off at all).
4. Construct the merged shape directly: kept vertices keep their original angle; each merged
   edge's length is the sum of the edges it absorbed.
5. **Search over (orient,off) at the matched si for whichever gives near-zero residual** against
   the constructed shape's own angle equations -- net-edge SIZES don't depend on orient/off, but
   the congruence STRUCTURE (which positions land in the same orbit) does, so the right
   orient/off has to be found separately. (Fixed a bug here mid-session: first version hardcoded
   orient=0/off=0 and got a 179.5 deg residual on a shape that's actually perfect at orient=1/
   off=7 -- searching properly instead of assuming was the fix.)
6. Report each merged edge's needed curve type from the ORIGINAL config's mapping code between
   the two edges being merged: code 3 ("both" = reflect + inside-out) is a genuine 180-deg point
   rotation -> **S**, matching John's own insight from earlier in this thread.
7. If the direct merge doesn't already satisfy the matched config's equations exactly, re-solve
   from it as a Newton seed (didn't end up needed here -- residual was exactly 0.000000 already).

**Result: fully automatic, exact match to John's hand-found answer.** orient=1, off=7 (found by
the search, not assumed), residual 0.000000 deg, both merged edges correctly flagged S. Verified
the output develops into a real tiling: 60 tiles, 0 overlaps.

**Known limitation, stated in the script itself:** curve-type inference (step 6) only handles a
2-edge merge (a single dropped vertex between two edges); a run of 2+ consecutive dropped
vertices (3+ edges merging into one) isn't attempted yet -- didn't come up in this case (both
runs were single vertices) and would need a bit more thought about what curve type a 3-or-more-
way merge should get.

## The general merge rule: how S and U curves are built from combinations (2026-08-08)

John: *"We could do it recursively, joining two at a time. Or we could do it all at once. We
would need to identify how S and U curves can be made of different combinations. Can you explore
that? I'd like this to be able to handle any case that comes up."*

**Setup.** A merged edge made of k consecutive sub-edges: sub-edge i occupies [i/k,(i+1)/k] of the
merged parameter and carries its orbit representative's curve transformed by absolute Klein-4 map
code c_i (bit0 = reverse parameter, bit1 = negate offset -- `applyMap`'s convention). The merged
edge's own symmetry maps sub-edge i onto sub-edge (k-1-i), reversed; working out what that
demands of the two transforms collapses to pure XOR:

```
merged is U (mirror at x=0.5)       iff   c_i XOR c_{k-1-i} == 1  for every i
merged is S (180-deg point rotation) iff   c_i XOR c_{k-1-i} == 3  for every i
otherwise                                  J (no forced symmetry)
```

**Odd k adds one clause:** the middle sub-edge maps to ITSELF, so it must already carry that
symmetry internally -- middle must be U or I for a merged U, S or I for a merged S (I is
straight, so it satisfies both). Even k has no self-paired sub-edge and no extra clause. A run
whose sub-edges span more than one orbit has no forced relationship at all -> J.

**Verified numerically, not just derived:** built the assembled curve for every code assignment
and tested its actual symmetry directly against the rule's prediction -- all 4^k assignments for
k=2..5 (1,360 cases), plus 4,352 odd-k cases varying the middle sub-edge's own type. **0
mismatches.** The k=2 cases the earlier version hardcoded (code 1 -> U, code 3 -> S) fall out as
c_0 XOR c_1, so nothing regressed.

**On John's "recursively, two at a time" option:** it doesn't compose cleanly. After one pairwise
merge the result is an assembled curve, not a Klein-4 transform of a single representative, so
there's no code left to XOR at the next step. The all-at-once rule sidesteps that entirely, which
is why it's the one implemented.

**Implemented in `reduce_combo.js`** (replacing the 2-edge-only special case), plus a new
automatic cross-check: the curve type DERIVED for each merged edge (from the ORIGINAL config's
map codes) is compared against the type the NEW config independently declares in its own
`edgeSym`. Those come from completely separate code paths, so agreement is real mutual
confirmation -- and a disagreement now prints `*** DISAGREE ***` rather than passing silently.

**Tested:**
- Original #1727337 m=12->10: unchanged, still exact -- si=34, orient=1/off=7, residual
  0.000000, both merged edges derived **S**, and the cross-check confirms the new config's own
  edgeSym independently says S at both positions.
- A genuine 3-edge-merge case (#5 m=12, `vertexAngle=[1,0,0,1,0,0,1,0,0,1,0,0]` -- four runs of
  two consecutive drops): reduces correctly to m=4, sum `[1,0,0]`, a 3x3 square, residual
  0.000000, cross-check passes. **Caveat: that example is all-I (straight) edges, so it exercises
  the structural 3-edge path but NOT the S/U inference for odd runs** -- that clause rests on the
  brute-force verification above, which is broader evidence than any single example.
- `node test_harness.js` regression suite: 0 overlaps, unaffected.

## Round-trip testing: expand then reduce, with real curved examples (2026-08-08)

John: *"Can you work backwards? Take a small m tiling that has the type of curve (S, U, J, I),
then break that edge (and any copies of it) into multiple copies. (Test both odd and even
sub-edges.)... Please also test if there are multiple copies of that edge."*

Built `expand_combo.js` -- the inverse of `reduce_combo.js`, using the SAME net-edge machinery
(increment instead of decrement): finds every copy of a target edge orbit, grows both the
orient-0 and orient-1 net edges covering each copy by (k-1), searches the bigger m's sum-types
by net-edge size, constructs the expanded shape directly (k-1 new flat vertices per copy, length
split evenly), and searches (orient,off) for zero residual same as `reduce_combo.js` does.

**Found real multi-copy examples for the round trip:** J with 8 copies (#48 m=8), S with 2 copies
(#123 m=6), U with **10 copies** (#1727264 m=12), I with 6 copies (#4 m=6). Ran k=2 (even) and
k=3 (odd) on each -- **all 8 expansions succeeded perfectly**: residual 0.000000, exact closure,
0 overlaps on the developed tiling.

**Core round-trip result: #1727264 (U, 10 copies, verified genuinely irreducible at the start --
`vertexAngle` all 1s) recovers EXACTLY m=12 si=2 -- the precise original -- for BOTH k=2 and
k=3.** All 10 merged edges correctly derived U and cross-confirmed against the new config's own
`edgeSym` for k=2 (single-orbit case, matching the proven rule exactly).

**A real gap found, and correctly caught by the cross-check rather than silently passing:** for
k=3 (odd span, 3 sub-edges per merge), the derivation rule's fallback -- "sub-edges span more
than one orbit -> no forced symmetry, so J" -- is WRONG in this case. #1727264's own k=3
expansion put the merge's 3 sub-edges into 2 DIFFERENT orbits (not the single shared orbit the
theory assumed), and the classifier fell back to J -- but the ACTUAL new config's edgeSym says U,
confirmed correct by the (unrelated) residual=0.000000 match and the exact si=2 recovery. **The
theory proven earlier this session (all 4^k + 4,352 test cases) covers single-orbit merges
completely and correctly; it does not yet cover merges whose sub-edges span multiple orbits**,
which turns out to be the NORMAL case when oddly subdividing an edge that was already paired
with a mirror/point partner (the two things that map to each other under the whole-edge
symmetry, i.e. the two OUTER pieces of an odd split, end up as their own 2-element orbit,
separate from the self-paired middle piece -- exactly matching the theory's own odd-k structure,
just not captured by the current same-orbit-only check). **This limitation is isolated to the
explanatory/cross-check layer -- the core reduction (finding the right combo) is unaffected and
worked perfectly regardless**, since it never depends on the classifier, only reports it.

**Incidental finding from the test methodology itself:** #48 (J, 8 copies) and #4 (I, 6 copies)
turned out to NOT be irreducible at their chosen starting m -- `vertexAngle` already had zeros
before any expansion. Good catch by the round-trip design: reducing back after expansion
correctly found the TRUE minimal m (m=4 and m=3 respectively) rather than the m I started from,
and #123 (S, 2 copies) partially so (positions unrelated to the deliberately-expanded S edges
were already reducible) -- but its two S-specific merged edges (the ones actually under test)
came back clean AGREE for k=2. Both k=2 and k=3 expansions of #123 independently converged to the
IDENTICAL true-minimal m=3, si=0 -- strong cross-validation via a different route than a clean
baseline would have given.

**Test files kept** in `_dev_isohedral/` as `start_*.json` / `start_*_expanded_*.json` /
`start_*_reduced_*.json` for future regression use.

## Fixing the multi-orbit gap (2026-08-09)

John's hypothesis for the multi-orbit case: *"I would think that J curves would have as many
orbits as there are edges. I would think that S and U curves would have half the number of
orbits as the number of edges (if even). If odd, the middle edge must match S or U and the
others can all be J curves."*

Diagnosed the exact bug behind the gap above: `mergedCurveType()` required ALL sub-edges in a
merge to share ONE global orbit (`reps.size > 1 -> return J`) before checking anything. That's
the wrong granularity -- for #1727264's k=3 case, positions 0 and 2 (the pair that actually needs
to match) DO share orbit rep 0, but position 1 (the middle, self-paired) is legitimately its OWN
separate orbit (it maps to itself, not to any other position). Lumping the middle's orbit into
the same global set as the pair's broke the check for every odd-span multi-orbit merge.

**Fix:** check orbit-sharing PER PAIR (`info[i].rep === info[span-1-i].rep`, only for flanking
pairs), independent of whatever orbit the self-paired middle position belongs to. Added
`orbitsUsed` / `predictedOrbits` fields (`predictedOrbits = type==='J' ? span : ceil(span/2)`,
implementing John's hypothesis literally) so every run reports whether it matches.

**Verified: both previously-DISAGREEing cases now AGREE.** `start_U10copies_expanded_m32_x3`
(k=3, U) and `start_S2copies_expanded_m10_x3` (k=3, S) both now derive the correct type and match
the new config's own `edgeSym`, with 2 orbits used (predicted 2 = ceil(3/2)), matching John's odd
formula exactly: the flanking pair shares one orbit, the middle is its own second orbit.

**Full regression, all 8 expand/reduce round-trips (J/U/S/I x k=2,3): 0 DISAGREE, 0 MISMATCH.**
Original #1727337 case also re-verified unaffected (still exact, S/S, residual 0).

**One refinement to John's hypothesis, found by the regression run itself:** the "J -> orbits ==
span" clause isn't quite right. In the I x2/x3 and S2copies-edge0 cases, sub-edges pair up into
SHARED orbits via an *identical* map code (XOR=0, not the complementary XOR=1/3 that forces U/S)
-- so the merge is still J (no forced symmetry), but `orbitsUsed` comes out `ceil(span/2)`, not
`span`. E.g. `start_I6copies_expanded_m12_x2`: span=4, pos0/pos3 share an orbit (code XOR=0),
pos1/pos2 share a different orbit (code XOR=0) -- 2 orbits, not 4, yet type is J because neither
pair's XOR is 1 or 3. **Orbit-count depends on whether sub-edges happen to be congruent copies of
each other at all (a fact about the tiling's symmetry group), not on the resulting curve type.**
J can arise from 1 orbit (generic, no relationship at all) all the way up to `ceil(span/2)`
shared orbits (paired but with the "wrong" relative code) -- `span` orbits is just the maximum,
not the rule. The type-vs-orbit-count fields are still useful diagnostics; just don't expect
J to always mean "no orbit sharing."

## Multi-edge expansion: different edges of the same tile at once (2026-08-09)

John: *"...after this is good, let's test if we add extra edges to more than one edge of the
starting tile."*

Generalized `expand_combo.js`'s CLI from a single `<edgePosition> <k>` pair to any number of
`<pos>:<k>` specs (`node expand_combo.js <combo> 0:2 2:3 ...`) -- resolves each spec to its full
orbit (as before), errors if two specs' orbits overlap (they must name genuinely different
orbits), then sums the net-edge increments across all of them (safe since disjoint copy-sets add
independently) and builds one combined bigger-m shape in a single pass. Re-verified the rewrite
against the old single-spec behavior first (`start_U10copies.json 0:2` reproduces the earlier
m=22 result exactly, residual 0, 0 overlaps) before trusting it on anything new.

**Used #1727264 (m=12, si=2) as the test bed** -- it has exactly two orbits total: the U orbit
(rep=0, 10 copies) and the S orbit (rep=2, 2 copies), both confirmed genuinely irreducible
(`vertexAngle=1` at both reps). Two combined tests, deliberately swapping which orbit got the
odd split:

- U x2 (even) + S x3 (odd) -> m=26. Direct expansion satisfied the new structure exactly
  (residual 0.000000), 60 tiles / 0 overlap. Reduced straight back to **exactly** m=12 si=2 --
  identical A/L to the original start file, all 12 merged edges cross-check AGREE (10 U + 2 S).
- U x3 (odd) + S x2 (even) -> m=34. Same result: residual 0.000000, 0 overlap, reduces back to
  the identical original m=12 si=2, all AGREE.

**Multi-orbit expansion works exactly like single-orbit expansion, composed independently per
orbit** -- no interaction effects, no additional gap. The net-edge accounting only cares about
which boundary positions belong to which orbit; two disjoint orbits expanding by different (even
or odd) amounts at the same time is not fundamentally different from doing them one at a time.
This closes out the full test matrix John asked for: single edge / multiple copies of one edge /
multiple different edges, each in both even and odd variants.

**John's edge-count-parity claim, verified (2026-08-09):** *"both J and U curves must have even
numbers of the edges -- one bumping out for every one bumping in."* Clarified this means the
TOTAL count of J-typed (and, separately, U-typed) edges around a tile's whole boundary, not the
sub-edge span of any one merge. Scanned every config across 17 ids x m=3..14 (11,915 total
configs): **0 violations** -- `count(J)` and `count(U)` are always even; only S and I are free to
be odd. Makes sense as the edge-orbit analogue of the vertex-run parity already relied on
elsewhere: J/U edges need a genuinely separate partner elsewhere on the boundary (can't be
self-paired), so they can only ever be removed/added in matched pairs.

## Reduce button in tilerTest.html (2026-08-09)

John: *"Can we add this 'reduce' functionality to tilerTest.html with a button or something?"*

Ported `reduce_combo.js`'s algorithm directly into `tilerTest.js` (new `reduceCurrentCombo()` +
helpers `configFor`/`repMapAt`/`mergedCurveTypeAt`/`residualForA`) instead of shelling out to
Node -- same recipe (find reducible vertices -> group into runs -> decrement both orientations'
net edges -> search smaller-m sum-types by size match -> construct the merge -> search
(orient,off) for min residual -> Newton fallback from seed if needed), built on tilerTest's own
`runSums`/`runSpecify`/`parseCfg`/`loadType` instead of `test_harness.js`'s copies. Added a
`reduce` button next to save/load combo; on success it calls `loadCombo()` with the result,
exactly like loading any saved combo file. `curConfig()`/`configFor()` now also expose
`cfg.vertexAngle` (from the `reducibleVertex` global), matching what `test_harness.js` already
did for the Node tools.

**No live browser-automation tool was available this session**, so this was verified by loading
the REAL `tilerTest.js` (unmodified, same script load order as `tilerTest.html`) into a
Node-side DOM stub (Proxy-based auto-vivifying elements, same pattern `test_harness.js` already
uses for `aniso.js`) and driving it exactly as the button would: `loadCombo(startCombo)` then
`reduceCurrentCombo()`. Confirmed three ways: (1) reducing `combo_1727337_m12_si535_or1_off8`
lands on the identical (m=10, sum, orient=1, off=7) as both `reduce_combo.js` and John's
hand-found `64642b5.json` -- and the produced A/L is BYTE-IDENTICAL to a fresh `reduce_combo.js`
run on the same file (the numeric difference from `64642b5.json` itself is expected: that file
is John's own hand-built parametrization -- different scale/vertex-labeling gauge, same shape --
never something `reduce_combo.js` produced); (2) the result closes exactly (gap/scale
0.00000000) and develops into 60 tiles with 0 overlap; (3) clicking reduce on a genuinely
irreducible combo (`start_U10copies.json`, #1727264) alerts cleanly ("already irreducible") and
leaves the current view untouched, no crash. **Still worth a real click in an actual browser
when one's next open** -- this verifies the algorithm and DOM wiring faithfully, not things a
stub can't see (actual rendering, mouse click dispatch).

## Reduce button: real geometric bug found and fixed on first real-world use (2026-08-09)

John clicked the new reduce button on `combo_1727337_m10_si0_or0_off5.json` and got a result
that "doesn't look the same" -- he then hand-fixed it via the true-parameter sliders to a shape
he liked (`combo_1727337_m6_si0_or0_off5 (1).json`). This surfaced a real bug that every prior
test case had accidentally masked.

**Root cause:** "reducible" (`cfg.vertexAngle[i]===0`) is a purely COMBINATORIAL fact -- a
smaller-m description exists SOMEWHERE in this type's family -- it does NOT mean the dropped
vertex's CURRENT numeric angle is 180. Every previous test case (I6/J8/S2/U10copies via
`expand_combo.js`, and the original #1727337 m12->10 discovery) had the dropped vertices
deliberately placed exactly flat, by construction. This real, arbitrary combo did not: the
dropped positions [6,7,8,9] sat at 219.8, 290.7, 69.3, 140.2 degrees -- nowhere near 180. The old
"keep the original angle, sum the absorbed lengths" merge therefore built a shape that does NOT
close (`closure error of the naive merge: 1.82, 1.07`) -- but the acceptance check only verified
the ANGLE EQUATIONS, which are satisfied trivially (the angles are literally unchanged, so of
course they still satisfy their own defining relations) regardless of whether the shape closes.
Worse, the Newton fallback, seeded from that non-closing shape, converged onto a **clamp-floor
false closure** -- an edge length pinned at exactly unpack()'s 0.05 lower bound (an exact 20:1
ratio) -- the precise artifact `reference_two_clamp_floors` memory warns about, mistaken for a
real answer because its OWN gap was tiny (not flagged `clampFake` by the milder built-in
heuristic, but still a `clamped` result and therefore untrustworthy per the stronger rule "an
edge ratio of exactly 20 or 50 is a solver artifact, never geometry").

**John's fix, exactly right:** *"feed the old coordinates of the vertices you will use into the
Newton solver -- it should already be a solution... the other angles are between what will now
be parts of the curve on the new edge."* The kept vertices already sit at fixed positions
satisfying the ORIGINAL tile's own closure. Connecting them by straight CHORDS (skipping the
dropped ones) is trivially STILL a closed polygon -- same points, same cyclic order -- and
whatever bend the dropped vertices had becomes curve detail on the new edge, not part of the new
polygon at all. This is exactly "replace each vertex with a point on the curve" from this tool's
original design request, generalized to the case where the dropped vertex isn't flat.

Rewrote the shape construction in both `reduce_combo.js` and `tilerTest.js`'s
`reduceCurrentCombo()`: `Vall = verticesOf(A,L,m)`, `Vk = kept.map(i=>Vall[i])`, chord length =
`dist(Vk[k],Vk[k+1])`, chord angle recovered from the heading change between consecutive chords
(same `dir += 180 - A[next]` convention `verticesOf` itself uses). Also added: (1) a real
closure check gating the Newton-fallback trigger, not just the angle-equation residual; (2)
clamp detection (`sp.clamped`) on the Newton result, falling back to the type's own DEFAULT
(unseeded) solve -- an honest, if generic, point in the family -- rather than trusting a clamped
seeded result; (3) a genuinely separate bug found while re-testing: two different (orient,off) at
the SAME si can BOTH hit residual 0 (found for real: #1727337 m10->6 si=0 has both o=0/f=2 and
o=0/f=5 exact), and they are not interchangeable -- each declares a different edgeSym for the
merged edge, and the old code kept whichever was found FIRST in loop order regardless of whether
it agreed with the merge-rule's own derived type. Fixed by using cross-check agreement as a
tie-breaker among residual<1e-3 candidates.

**Result on the reported case:** chord-seeded Newton now converges cleanly (no clamp, ratio
1.4487, not the 20/50 artifact pattern), picks the AGREE-ing (orient,off), and lands on
A=[125.8,121.0,113.3,...], L=[1,0.69,1.00,...] -- close to John's own hand-found
[124.8,121.3,113.8,...], [1,0.64,1.04,...]: same shape family, sensible proportions, 0 overlap.
Full regression re-run clean: all 10 stored expand/reduce round-trip cases still AGREE with 0
closure error, `test_harness.js`'s overlap regression set unaffected, and the ORIGINAL #1727337
m12->10 case (dropped vertices genuinely flat) still reduces to the identical answer as before
(chord construction degenerates to the old sum-of-lengths construction exactly when the dropped
vertex truly is flat, so this is a strict generalization, not a behavior change for that case).

**Still true in general, and now communicated instead of silently wrong:** if a tile has genuine
shape freedom at the smaller m and the original wasn't at that family's special flat-vertex
point, there is no single "correct" reduced shape to match it to -- reducing gives SOME valid
point in the (now much better, chord-seeded) family, and an alert tells the user when the tool
had to fall back to the type's generic default point instead.

## Offset can't land on a removed vertex -- checked, structurally impossible (2026-08-09)

John: *"The offset will probably be different in the reduced combo. We might have offsets that
are higher numbers than possible... It would get really weird if the 0 vertex was one of the
vertices that got removed."*

The (orient,off) search already brute-forces every valid pair at the matched si (`for f in
[0,newM)`), rather than trying to analytically derive the new offset from the old one -- so it
never needs the "count the reduced edges as one edge" bookkeeping John was worried might get
complex; whichever (orient,off) actually satisfies the equations (or best-agrees with the
derived curve types, per the tie-break fix above) just gets found directly.

The specific worry -- vertex 0 itself being one of the dropped vertices -- checked in `aniso.js`:
net edge 0 of the FIRST polygon always begins at physical position 0 (`netEdgeData[5]`'s loop
starts at index 1, leaving position 0's begin untouched; `offset` only ever shifts the SECOND
polygon's begin position, `orientation` only touches the second polygon too -- see aniso.js
around line 267, "the zero vertex is the base to measure from"). A net-edge boundary is by
definition never reducible (reducibility means NOT needed as a boundary by the base equations).
So vertex 0 can never be dropped, for ANY (orient, off) -- confirmed empirically too (0
counterexamples across ~thousands of configs, 17 ids, m=6..16, before finding the structural
reason). This scenario cannot arise in this codebase's convention.

## Porting curve detail through a reduction (2026-08-09)

John: *"where I added an S curve to match where the old reduced vertices were -- that's very
nice to have. It helps us humans see that this is the same shape. If the user had curves turned
on, they would expect those curves to appear in the reduced version. We'd have to take the curve
points of one subedge, then add the vertex we reduce, then add the curve points of the next
subedge etc."*

Implemented exactly that in `reduceCurrentCombo()`. For each merged edge: walk its sub-edges in
order, and for each one either use its existing `curveEdits` (symmetrized via `buildCanon`,
transported to that specific sub-edge via `applyMap`, then placed in world space via
`mapToEdge`) or, if it has none, just its two straight endpoints -- concatenate all of these
(dropping the duplicate point at each junction) into one long world-space polyline running the
whole original, un-reduced path. Project that back into the NEW edge's own canonical [0,1] frame
via `TilerCurves.unmapFromEdge(V0,V1,W)` (already existed, exact for a similarity transform --
no least-squares needed). That gives the merged edge's full symmetrized curve; a new
`extractStorablePts()` reduces it to what `curveEdits` actually stores (J: everything; U/S: only
x<=0.5 plus a fold forced to exactly x=0.5, interpolated if no raw point sits there, with S also
forcing the fold's y to 0). Also ports **unmerged** kept edges' pre-existing `curveEdits` 1:1 (a
straightforward orbit re-mapping, same machinery). Turns `curves:true` on the loaded result
whenever any curve data was actually generated. Skips entirely when the edge's declared type is
`I` (its curve system already hardcodes `buildCanon` to ignore stored points for `I`, so there's
nothing useful to store) or when the reduction had to fall back to a generic default-family point
(`usedDefaultFamily` -- the chord world-positions wouldn't correspond to that unrelated shape).

**Verified on the exact reported case** (`combo_1727337_m10_si0_or0_off5`, no pre-existing curves
at all): the merged edge's synthesized curve is `[[0,0],[0.208,0.363],[0.498,-0.473],[0.5,0]]` --
independently cross-checked by projecting the original vertices 5,6,7,8,9,0 through
`unmapFromEdge` by hand: `(0,0),(0.208,0.363),(0.502,0.473),(0.498,-0.473),(0.792,-0.363),(1,0)`.
The dropped pair (vertices 7,8) land almost exactly antipodal through (0.5,0) -- real
confirmation of the type's own point symmetry, not just curve-fitting. **Ran clean across all 12
stored test files** (no crashes, curves correctly enabled only where a mergeable edge's declared
type could actually store one, e.g. the all-`I` I6copies cases correctly stay `curves:false`).

**One known, accepted approximation:** the raw path isn't always monotonic in x near the centre
(as in the case above, where vertex 7 sits at x=0.5024, just past the 0.5 cutoff) -- the stored
"half" always ends with an explicit fold forced to exactly x=0.5, so the rendered curve visits
the centre point exactly even where the true zigzag jumped slightly past it without doing so.
Given John's own stated priority for curve shapes ("I don't care if it's an exact match") this
was left as-is rather than chasing exact fidelity -- the overall silhouette is preserved.

# Two more overnight unbalanced deep dives: #3215 (1:3) and #1512 (1:4) (2026-08-11, ~22:17 local)

John: *"Let's pick two of the possible types and deep dive them overnight... pick one of the 1:3
or 3:1 types and one of the 1:4 types. See if you find any that tile that aren't isohedral."*
Resuming the standing plan from [[project-daily-search-cadence]] (dormant since 2026-08-06) --
pick an already-`possible` unbalanced type and search for an ANISOHEDRAL solution at a different m
(the #69439/#69445 precedent).

**Candidate selection.** Checked `py/ledger.json` directly: of the 6 `possible` 3:1/1:3 types, 5
are the trivial regular-polygon ones (#30/#413/#415 equilateral triangles, #37/#342/#422/#383/
#25589 regular hexagons -- see [[project-ratio-31-blocked]]), no real combinatorial content.
**#3215** (`4_2 6_6`, ratio 1:3, p6) is the one genuine type -- found via the 3:1 sweep, witness at
m=9, and never given the uncapped single-type treatment (only a thin slice, mHi=66, in the q<r
broad sweep). For 1:4, checked `search_qltr_broad_results.json`: of the 4 `possible` 1:4 types,
**#1512** and **#1516** (`4_1 6_4`... homeo, k=6/n=4) never appear in that sweep at all -- they
were already `possible` before the sweep ran (certified at their smallest m only) and so got
skipped entirely, making them the least-explored 1:4 candidates by a wide margin (vs. #4810/#8873
which at least reached mHi 32-34). Picked **#1512** (pmm, `*2222`) over #1516 (cmm) arbitrarily
between the two untouched ones.

**Launched exactly per the established robustness pattern**
([[reference-detached-overnight-runs]]): `run_deep_3215.cmd` / `run_deep_1512.cmd` in
`engine/_dev_isohedral/` (each `node deep_single_type.js <id> 540 > log 2>&1`), started via
PowerShell `Start-Process -WindowStyle Hidden` (no `-Wait`) so both are independent Windows
processes, not children of this session -- confirmed via `Get-CimInstance Win32_Process`. 540-min
(9h) budget each, same finish-a-full-size-before-stopping policy, checkpointing to
`deep_single_3215_results.json` / `deep_single_1512_results.json` after every size. If the session
or connection drops, read those files (or the `.log`s) directly from a fresh session.

**Density check before launching:** #3215 is very sparse (only closes at m divisible by 3, ~a few
hundred combos per size even out past m=60) so it should reach very large m in 9 hours. #1512 grows
faster (~46k combos already by m=24) so expect it to reach a more modest m before the budget (or a
single expensive size) runs out -- consistent with the deadline-between-sizes design, not a bug if
it overruns 540 min mid-size.

**Smoke test, both clean within the first ~30s:** #3215 already re-surfaced its known m=9 witness
(isohedral, as recorded) and was past m=69 with more isohedral witnesses, 0 anisohedral yet. #1512
re-surfaced its own m=6 witness plus new isohedral witnesses at m=12/24, 0 anisohedral yet, 0
crashes. Real question is what either does past their already-known isohedral witnesses -- per the
standing rule, treat any `ANISOHEDRAL` line as the interesting event, and cross-check anything that
turns up in the morning with `shape_compare.js` (v2) before calling it new, same as always.
