# program4 — to-do

Feature ideas and known issues, roughest-cut first. See `NOTES.md` for the state of
the research question and the evidence ladder.

---

## 1. Import a tiling from Joseph Myers' polyform pages

**Goal.** Reproduce a tiling from Myers' polyform site (which sorts by 2-anisohedral
etc.) by entering it, rather than hunting for it in a list.

**The problem.** These are high-edge-count tiles — plausibly ~30 edges per tile. The
combo space (m, sum, orient, offset) at that size is far too large to browse: there
would be thousands of candidates.

**Proposed method.**

1. Enter the *orbit signature* — the side count of each orbit, the `4_2 5_2` style
   descriptor. That is a small, human-readable thing to read off a picture.
2. Match that signature against the 1270-type index to identify the Tegula number.
   `py/euclidean_2iso_1270.json` and `homeo_types_1270.json` already carry the homeo
   string, so this is a lookup, not a search.
3. Enter how many tile edges make up each *side* of the polygon (the subdivision).
   This is where the big numbers come in — a side may be many unit edges.
4. **Emit a short list of matching combos**, not the full enumeration. Filter by the
   entered edge counts, then rank. The user picks from a handful.

**Open question — ANSWERED (2026-07-19): step 3 alone pins it down.** Steps 3 and 4
are **built and working**: the `find combo by side sizes` view. Enter
`8,6,1,11,8 / 8,8,1,8,8,1`, get a clickable short list.

Worked example, John's #25546 tiling (34 sides):

- 1920 sum-types × 2 reflections × 34 offsets = **130,560 combos → 12 matches**, of
  which only **4** are `ok` (the other 8 self-intersect). A short list, as hoped.
- The matches are two mirror-image families: `si=1291 off=10/27` and `si=691
  off=5/22`, differing only in reading direction.
- Runs in **2.1s**. The naive scan is 143s; row4 depends only on `(sum, orient)` and
  *not* on offset, so probing each `(si, orient)` once at `off=0` cuts 130,560
  `specify()` calls to 3,976. Note row4 is readable even when that offset is not
  realizable — which matters, because at m=34 **100%** of `off=0` probes are
  non-realizable, so waiting for a realizable one would undo the entire saving.
- Matching is up to **rotation and reversal** per orbit, since where you start
  reading a cycle and which way round are both arbitrary.

**The tile that comes out is correct.** #25546 si=1291 off=10 solves to a genuine
18-cell polyomino: all edges unit length, all angles 90/180/270, every vertex on the
integer lattice, area 18, 7×6 bbox, no self-crossing. It is also **completely rigid**
— 0 free angles, 1 length group, so **0 true parameters**. Nothing to drag; the
combinatorics determine the tile outright. Combos saved as
`combo_25546_si*_off*.json`.

**Remaining blocker: `develop`, not the finder.** See the develop bug in section 6 —
the tiles view draws the polyomino correctly, the full-tiling view does not.

**Feasibility check (measured, 2026-07-19).** Step 2 alone does *not* identify the
type. The 1270 types carry only **152 distinct homeo signatures**, and the common
ones are badly degenerate: `3_2 4_2` → 53 types, `3_2 6_2` → 49, `4_2 4_2` → 46,
`4_2 5_2` → 39. Only 24 signatures are unique to one type. So the signature is a
*filter*, not a key, and the short-list in step 4 is doing the real work — it has to
cut ~50 candidate types (times their combos) down to something pickable.

Encouraging: **55 of the 152 signatures have a side count >= 8**, and the index goes
up to 24 sides, so the high-edge-count regime Myers lives in is much sparser than the
crowded low end. An import flow may be far less ambiguous in practice than the
average suggests. Worth measuring the ambiguity restricted to the signatures a real
Myers tiling actually produces before designing the picker.

**Adding the orbifold fixes most of the ambiguity (measured).** Both it and the
wallpaper group are readable off a picture, and either one collapses the problem:

| key | distinct keys | worst bucket | median bucket | keys hitting 1 type | mean candidates |
|:--|--:|--:|--:|--:|--:|
| homeo alone | 152 | 53 | 4 | 24 | 19.3 |
| homeo + orbifold | 722 | 11 | **1** | 439 | **2.8** |
| homeo + wallpaper group | 722 | 11 | 1 | 439 | 2.8 |
| homeo + orbifold + wallpaper | 722 | 11 | 1 | 439 | 2.8 |

A ~7x cut, and the median lookup becomes **unique**. Note orbifold and wallpaper
group are equivalent information here (a bijection), so asking for both gains
*nothing* over asking for either — pick whichever is easier to read off the picture
and don't make the user enter both. Worst case is still 11 types, so the step-4
short-list is still needed, but it is now short enough to show.

**Note.** The existing `m <= 8` sweep cap is nowhere near this regime; this path
needs its own entry point that goes straight to a specified m, not a sweep.

### 1a. Find-by-sizes should not care which orbit you type first — **DONE (2026-07-21)**

Typing `5 sides / 8 sides` when the type wants 8 then 5 currently just errors and tells
you to swap. It should read it either way:

- If the lists do not match `(k, n)` in the order given, **try them swapped** before
  failing. Only report an error when neither assignment fits.
- When **`k == n`** both assignments are legitimate, so search *both* and merge the hits,
  de-duplicating on `(si, orient, off)`. Otherwise a real combo is missed purely because
  of which orbit the user happened to read first.

Built as `orbitOrders()` + `findOneOrder()` in `engine/mono2iso.js`. The orbits were
already matched up to rotation and reversal *within* each list; this is the same idea one
level up, across the two lists. Verified: #25546 (k=5,n=6) gives the same 12 matches typed
either way, and #1727967 (k=n=6) gives the same 40 matches either way, `bothOrders` set.

### 1b. Pick a type by orbifold, then by picture — **DONE (2026-07-21)**

After entering `k_q n_r`, narrow with an **orbifold dropdown of what actually exists**
for that signature, then show the **paper figures** so the user picks the one they mean.
This is the interactive form of the measurement in section 1: homeo alone leaves up to 53
candidates, homeo + orbifold cuts the median to 1 and the worst case to 11 — few enough
to show as pictures.

**Both pieces of data already exist; this is wiring, not new work:**

- Orbifold is already in the UI's own index — `templates.js` entries carry
  `{id, k, q, n, r, wp, orb, vdeg, name}`, e.g. `orb: "*333"`, `wp: "p3m1"`. So the
  dropdown can be built by filtering `IDX` on the entered k/q/n/r and collecting distinct
  `orb`. No new data file.
- The figures are already vendored: `index/cells/` holds all **1270** crops. The id ->
  filename map now comes from `index/cells_index.txt` via `py/gen_cells_map.py`, which
  emits `engine/cells_map.js` (23 KB, all 1270 types, 0 disagreements with
  `ledger.json`'s own `image` field). A generated side map rather than a `templates.js`
  change: `fetch()` of a .txt is blocked under `file://`, which is how these pages open.

Offer orbifold *or* wallpaper group, not both — they are in bijection across the 1270, so
asking for both gains nothing (measured in section 1). Pick whichever is easier to read
off a picture.

---

## 2. Draw curves directly on the tile

**Now.** Curves are edited in a side panel, one curve at a time, decoupled from the
picture. The "tile(s) per orbit" view draws one skeleton (edges + vertices) plus two
identical shaded polygons.

**Want.** Select a curve *on the tile* and edit it in place.

**Also.** In "full tiling (developed)" mode, show an inset box containing the
skeleton and one shaded polygon, and edit the curves there — so you can watch the
whole tiling respond while you draw.

Relevant: `engine/tiler_curves.js` (`mapToEdge`, `buildCurvedTiles`, `curvedTile`),
`engine/mono2iso.js` rendering.

### 2a. Make each curve unique and recognizable — **DONE (2026-07-20)**

**Want.** Every edge orbit should get a *visually distinct* motif, not the same generic
bulge repeated. The point is to be able to look at a developed tiling and immediately
read which edge is which, and **which way round each one is traversed** — edges get
reversed (`edgeSym` J/U/I/S), and a symmetric bump cannot show that, so a mismatched
or flipped edge is currently invisible in the picture.

**Built.** `demo curves` now defaults to the `curve_examples.svg` motifs.
`TilerCurves.MOTIFS` holds them in canonical unit-edge coordinates;
`testCurve(type, variant)` takes a motif index, and `assignCurveVariants()` in
`mono2iso.js` numbers the edge orbits in ascending rep order so **each orbit draws a
different motif**, stably across renders.

Each motif lives in the first half of the edge (`x <= 0.5`), which is what makes
John's "one example on both sides of the edge" fall out for free — `enforceSym`
already mirrors the half for **U** and 180-rotates it for **S**:

```
tooth, J: (0,0) (.208,.132) (.208,0) (1,0)
tooth, U: (0,0) (.208,.132) (.208,0) (.5,0) (.792,0) (.792,.132) (1,0)     <- mirrored
tooth, S: (0,0) (.208,.132) (.208,0) (.5,0) (.792,0) (.792,-.132) (1,0)    <- 180-rotated
```

Straight (`I`) orbits are skipped when numbering, so they do not consume motif slots —
otherwise a tile with several `I` edges pushes its curved orbits onto duplicate motifs.

Verified on #3174, #974, #8982, #432: distinct motif per curved orbit, and every curved
boundary segment still shared by **exactly 2** tiles (none by more), so the curves
continue to glue correctly across the developed tiling.

**All five motifs, including path5's back-leaning overhang.** The model was never
function-of-x — `mono2iso.js`'s own `buildCanon` parametrises by *point order* and the
editor has always let you drag a point into an overhang. The only thing that could not
represent it was the duplicate `enforceSym` in `tiler_curves.js`, which sorted by x and
so reordered a non-monotone motif's points:

```
in : (0,0) (.208,.132) (.372,.132) (.208,0) (1,0)
out: (0,0) (.208,.132) (.208,0) (.372,.132) (1,0)     <- overhang destroyed
```

Fixed by deleting the sort and making **`TilerCurves.buildCanon` the single source of
truth** — `mono2iso.js` now delegates to it, so the editor, the demo motifs and the
developed tiling cannot drift apart again. `enforceSym` remains only as a
legacy-argument-order alias. `applyMap` had always warned against sorting for exactly
this reason; the two halves of the module simply disagreed.

Also removed a lossy round-trip in `ensureCurveEdit`: it used to take `testCurve`'s
finished (already symmetrised) curve and filter it back to `x <= 0.5` to recover the
drawn half, which silently drops points of any motif not monotone in x. Motifs are now
handed to the editor directly as points via `TilerCurves.motifPts(type, variant)`, so a
demo curve *is* a drawn curve and stays draggable.

Verified: an arbitrary looping J polyline survives `buildCanon` byte-identical; the
drawn half is preserved verbatim in U and S, and the completed curves are genuinely
mirror-symmetric and 180-symmetric respectively.

**Reference: `curve_examples.svg` in the program4 folder.** Five hand-drawn motifs,
all decorating the same baseline length (~29.67 units, tooth heights ~3.4–4.0):

| path | motif | why it reads well |
|:--|:--|:--|
| path1 | one asymmetric tooth — diagonal ramp up, vertical drop | chirality is obvious, so reversal is visible |
| path2 | square tab — flat, step up, flat, step down, flat | crisp and lattice-like; good for polyform tilings |
| path3 | two diagonal teeth | count distinguishes it at a glance |
| path4 | three diagonal teeth | ditto, scales the same idea |
| path5 | overhang — up-diagonal, flat top, then back down-**left** | undercuts the baseline; unmistakable, and strongly directional |

Note these are **polylines, not smooth curves** — straight segments only. Worth
deciding whether the motif library should be piecewise-linear (matches these examples
and polyform tilings, and keeps `overlap_strict` exact) or spline-based.

Design notes: the asymmetric ones (1, 5) are the valuable ones, since a motif that is
symmetric under reversal cannot show orientation. A tooth-count family (1/3/4) gives a
cheap way to generate many distinguishable motifs from one shape. Keep the motif tied
to the edge **orbit** so both copies of an identified edge always carry the same mark —
that is what makes a wrong pairing visible.

---

## 3. Drag vertices to edit a solved tile

Once a monohedral tiling is found and the true parameters are known, drag vertices
directly on the tile to change length ratios and angles, with the tile staying
closed.

The machinery for this already exists and is unused by the UI in this form:
`pickDrivers` (chooses which unknowns are sliders vs solved) and `closeConstrained`
(holds the drivers fixed and Newton-solves the rest back to closure), both in
`engine/tiler_core.js`. A vertex drag maps to driving one or two unknowns; the
existing "true parameters" sliders are the same thing with a worse interface.

**How hard is it really?** The forward direction is done — `closeConstrained` already
takes driver values and re-closes the tile, and the sliders prove it works interactively.
What is missing is the *inverse*: a vertex drag is a 2-D mouse delta that has to be turned
into driver deltas. That is exactly the Jacobian `pickDrivers` already builds, so the drag
is `du = J_pinv * dxy` (least-squares when the drag has no exact solution), then
`closeConstrained` as now. So this is a small linear-algebra step on top of existing
parts, not new machinery.

Two honest caveats:
- **A rigid tile cannot be dragged at all.** When `dim = 0` there are no true parameters
  and the combinatorics fix the tile outright — John's #25546 polyomino is exactly this.
  The UI must say "rigid, nothing to drag" rather than appear broken. The sliders already
  do (`rigid — no free parameter`); the vertex UI needs the same.
- **Not every vertex moves independently.** With `dim` typically 1–2, most vertices are
  dependent, so dragging one moves several. That is correct behaviour, but it will feel
  wrong unless the UI shows which vertices are being driven.

### 3a. Sliders cannot always reach far enough

**Want.** Sometimes the needed value is outside the slider's range.

The raw sliders are hard-coded in `renderTilesControls`:

| slider | min | max | step |
|:--|--:|--:|--:|
| angle `A<i>` | 5 | 355 | 0.5 |
| length `e<group>` | 0.2 | 3 | 0.02 |

The true-parameter sliders instead take `lo`/`hi` from `shapeFamily`'s sampled ranges,
widened to include the current value — so those adapt, but only to what sampling found.

Options, cheapest first: a type-in number box beside each slider (removes the ceiling
entirely and is the smallest change); auto-extend the range when a value reaches an end;
a log scale for lengths, which suits ratios better than a linear one.

**Note this got worse with the 2026-07-20 scale fix.** Re-solving used to normalise edge 0
to 1, so lengths always sat mid-range. Now that the tile's real scale is preserved, a tile
dialled up to 3x has `e0 = 3.0` sitting exactly on the length slider's maximum. Making the
length sliders show *ratios to group 0* (as the true-parameter sliders already do with
`L1/L0`) would fix the mismatch and make the fixed range meaningful again.

### 3b. Dragging curve points beyond the panel — **probably skip**

Sometimes a curve control point needs to go well outside the panel to make a very large
curve; zooming out would allow it. John's own call is to skip this, because the goal is to
edit **on the tile** rather than in a side panel (section 2) — at which point the panel's
bounds stop mattering. Recorded so the idea is not lost if on-tile editing stalls.

---

### 3c. Show which vertices are draggable, and what a drag means

**Want.** Mark the movable vertices — say a green dot — so it is obvious what can be
grabbed. With vertices 0 and 1 held fixed as the frame, dragging vertex 2 would change
the angle at v1 *and* the ratio e0:e1.

The good part of this framing: when only **one** of those is free, the other stays fixed
and the drag degenerates to a 1-D motion with a clear geometric meaning —

| free | fixed | vertex 2 moves along |
|:--|:--|:--|
| angle at v1 | ratio e0:e1 | an **arc of a circle** centred on v1 |
| ratio e0:e1 | angle at v1 | a **fixed ray** out of v1 |

That is a good way to *show* the constraint as well as apply it: draw the arc or ray the
vertex is allowed to travel while dragging, so the tile's remaining freedom is visible
rather than inferred. It also gives a natural degenerate case — a vertex with no freedom
gets no dot and no track.

Pinning v0 and v1 as the frame matches `verticesOf`, which already starts v0 at the
origin and lays the first edge along the heading, so no extra convention is needed.

---

## 4. Save working combos with data *and* image

When a combo works, save both the JSON (as the current `combo_*.json` export does)
and a rendered image, together. Enough to build a browsable gallery of confirmed
tilings later.

---

## 5. John's shortcut for which sum-types are possible — **DONE (2026-07-20)**

**The rule.** The last two entries of each `netEdgeGrow` row are what that row
contributes to orbit A and to orbit B. A sum-type is a vector `s` of non-negative
multiplicities over those rows, and it must satisfy both orbits at once:

```
m = SUM_i s_i * a_i   AND   m = SUM_i s_i * b_i        (s_i >= 0 integers)
```

with **`s[0]` pinned to 1** — `findSumWays` fixes it (aniso.js:153) and seeds the
partial sums at `(k, n)`, which are row 0's own `(a, b)`.

So "which side counts can have any sum-type" is 2-D unbounded-knapsack reachability
over `(SUM a, SUM b)` starting from `(k, n)`: a few thousand steps answering every m at
once, versus enumerating millions of sum vectors. `liveSizeSet()` in `mono2iso.js`.

**Exact, not just necessary:** over 1097 (type, m) cells on 63 types, **0 false
positives and 0 false negatives** against `runSums`. The first version left row 0 free
and got 6 false positives; pinning it removed all of them.

**Effect** — dead sizes in the dropdown drop from ~50% to none:

| type | sizes offered before | after |
|:--|--:|--:|
| #25546, #2994 | 59 | **30** |
| #432 | 61 | **31** |
| #1726796, #3174, #974 | unchanged | unchanged |

Cost 0.04–0.2ms, so `selectType` stays at 0–5ms. Also used as a pre-check in
`findBySizes`, which now rejects an impossible side count outright instead of scanning
to find nothing. John's observed "7, 9, 11, …" pattern is this rule's signature: live
sizes come out as an arithmetic progression from `max(k,n)` with step 1 or 2, and the
knapsack derives which without needing to know why.

### Why findSumWays returns fractions

It does not enumerate the last multiplicity — it **solves** for it (aniso.js:170-186):

```js
sum[counter] = (tileLength - first[counter-1]) / netEdgeGrow[counter][netEdgesSum];
```

a plain division with **no integrality check**. When it does not divide exactly the
result is fractional, and because the code then verifies only that both partial sums
land on `tileLength`, a fractional multiplicity that happens to satisfy both equations
is pushed into `mySums`. #188 at m=4: row 0 contributes `(k,n) = (4,3)`, leaving `(0,1)`
to find; the last row is `(0,2)`, so it solves `1/2 = 0.5` and both totals hit 4 exactly.
No integer solution exists there at all.

These are valid solutions over the rationals but meaningless combinatorially — `s_i`
counts how many of a netEdgeGrow row, and there is no half a net edge. `runSums` drops
them with `s.every(Number.isInteger)`, which is why they never reach the UI.

**Worth fixing at source:** adding an integrality guard where the division happens would
stop them being generated, rather than filtered downstream. Low priority — the filter is
correct — but the current arrangement means `mySums` contains entries that are never
usable, and any new caller that forgets the filter inherits the bug.

**Background — why it matters.** Sum-type counts explode with side count and `k+n`:

| type | m=20 | m=30 | m=34 | m=40 | m=64 |
|:--|--:|--:|--:|--:|--:|
| #25546 (5_3 6_6) | 324 | 1,274 | 1,920 | 3,249 | 14,415 |
| #1727967 (6_2 6_2 pg) | 876 | 5,551 | 9,640 | 19,551 | — |
| **#1726796 (6_2 6_2 pgg)** | 4,488 | 45,045 | 89,776 | 217,227 | **2,641,727** |

This is what froze the UI (section 6), forced the 2000-option dropdown cap, and sets
the cost of `findBySizes` — 2.1s for #25546 at m=34, but ~195s for #1726796 at the
same m, because the probe loop is `2 x nsum` calls to `specify()`.

**How much a sum-type filter is worth — measured, and it is less than it looks.**
For #25546 at m=34, **992 of 1920 sum-types (52%)** have at least one config that
produces angles. So a *perfect* filter at the sum-type level is only about a **2x**
cut, not orders of magnitude.

The sparsity is downstream of the sum-type, not in it:

| level | count | of |
|:--|--:|--:|
| sum-types with any live config | 992 | 1,920 |
| (sum, orient) pairs live | 1,486 | 3,840 |
| (sum, orient, offset) producing angles | 3,952 | 130,560 |
| ...not flagged impossible | ~72 | 130,560 |

Sampling the first 400 sum-types: of 856 combos that produce angles, **814 are
self-intersecting** and 70 reducible, leaving 20 unflagged. So most of what survives
to `tileAngles` is self-intersecting — which `viewFind` deliberately shows, labelled.

**So the question for the shortcut is which level it predicts at:**

1. *"This sum-type can never yield anything"* — worth ~2x on #25546. Still valuable on
   #1726796 where nsum is 90k+, and much more so if it can be applied **before**
   enumeration rather than as a filter after, since building 2.6M sum arrays is itself
   the cost there.
2. *"This (sum, orient, offset) is not realizable"* — worth ~33x, since only 3% produce
   angles at all.
3. *"...and is not self-intersecting"* — worth ~1800x, but note this discards the
   self-intersecting configs the find view intentionally lists.

**Where it would plug in:** `runSums` in `mono2iso.js` (which currently only drops
fractional sums via `s.every(Number.isInteger)`), `findSumWays` in `aniso.js` if the
rule can prune during enumeration, and the probe loop in `findBySizes`.

---

## 6. Known issues

- ~~**Stale representation on type switch.**~~ **FIXED 2026-07-19.** `selectType` and
  `selectSize` never cleared `manual`/`sol`/`curCfg`, while the sum/orient/offset
  handlers did. `ensureSolve()` refreshes `curCfg` from the new config but then takes
  the `if(!manual)` early-out, so the labels updated while the *shape* stayed —
  the previous type's tile drawn under the new type's name. Worse, the old angle
  array kept its old length: switching type 4 (m=3) to type 974 (m=5) left a 5-gon
  holding 3 angles, which renders as a degenerate shape. That is what produced the
  false "type 4/5 look degenerate at off=0" report; the certified path gives the unit
  equilateral triangle and unit square at every offset.

  Fix: one `resetShapeState()` helper (clears `manual`, `sol`, `curCfg`,
  `curveEdits`, `familyState`, `curveSel`, `curveSelPt`), called from `selectType`,
  `selectSize`, the offset chips, the sum/orient/offset handlers, `go`, and
  `loadCombo`. The five ad-hoc reset sites that each cleared a different subset are
  now one call, which is what let the gap exist.

- ~~**Picking a type froze the page.**~~ **FIXED 2026-07-20.** Raising the side-count cap
  to `MAX_SIDES=64` was safe in itself, but `selectType` called `runSums(m)` for *every*
  m in range purely to hide sizes with no sum-types. Sum counts explode with m and with
  `k+n`: #1726796 (6_2 6_2, pgg) has **2.6M** sum-types at m=64, so selecting it from the
  matches dropdown meant ~65s of blocking allocation. The original `mn+26` cap had hidden
  this; I had sized the new cap against #25546 (k=5,n=6, only 14k at m=64) and generalised
  from one type — the k=6,n=6 case is ~180x worse.

  Fix (John's suggestion, and the right one): **don't probe at all up front.** Offer every
  size immediately and compute sums in `selectSize`, for the one size actually chosen.
  `selectType` is now 0ms. Two supporting guards:
  - `runSums` is memoised per (type, m). Note `specify()` reads the side count back out of
    the `#tileLeng` field, so the cache must still set it on a *hit* — otherwise a cached
    call leaves a stale side count and `specify()` silently works on the wrong m.
  - The sum dropdown is capped at `SUM_LIST_MAX=2000` options; building 2.6M `<option>`
    elements freezes the page just as surely as computing them. Past the cap the view says
    so and points at the find-by-sizes search, which scans all of them regardless.

  Sizes with no sum-types are now listed but report "no sum-types at N sides" when picked,
  rather than being silently absent.

  **Follow-on bug from that cap, also fixed:** a `<select>` silently ignores a value that
  is not among its options. Find results and saved combos both address a sum-type **by
  value, not by position**, so any sum past index 2000 could not be selected at all —
  clicking a find result switched to the tiles view with a blank sum dropdown and drew
  nothing, leaving the stale "showing 2000 of N" warning on screen. `loadCombo` had the
  identical flaw. Both now call `ensureSumOption()`, which appends the wanted sum if the
  cap left it out, and clears the now-wrong truncation note. Any cap on a list addressed
  by value needs this; worth remembering if `SUM_LIST_MAX` is ever applied elsewhere.

- ~~**Re-solving snapped edge 0 to length 1.**~~ **FIXED 2026-07-20.** `solveTile` holds
  group 0's scale fixed at 1, so its unknowns are *ratios* to group 0. The seed built by
  "auto re-solve" pushed the raw lengths instead (`seedU.push(opts.seed.L[groups[i][0]])`),
  which had two effects: the returned tile always came back with edge 0 = 1, and — worse —
  when the user's edge 0 was not already 1 the seed was **misread**, so Newton started far
  from their shape and "nearest the seed" was measured against a distorted target. Fixed by
  normalising the seed by `seedScale = seed.L[groups[0][0]]` and multiplying it back on the
  way out. `relGap`/`relArea`/`relSep` are ratios against `max(L)`, so they are invariant
  under a uniform rescale and need no recomputation; seeded solves bypass the cache, so the
  restored scale never reaches it.

  The same normalisation loss was one function over: `closeConstrained` (the true-parameter
  sliders) also returns group 0 = 1, so turning the sliders on and every drag after resized
  the tile. `familyState` now carries the scale and reapplies it in both places.

  Unseeded solves are unaffected (`seedScale` is 1), which is the whole certification path
  — verified: regression set still 0 overlaps, and re-certifying a 6-type sample is
  identical to the ledger.

- ~~**`develop` is wrong for multi-segment edges.**~~ **NOT A DEVELOP BUG — RESOLVED
  2026-07-21.** #25546's 213 overlaps looked like bad placement transforms, but every
  side of every developed tile glues to its neighbour EXACTLY (verified pair by pair).
  `develop` was never broken. The overlaps were coming from two upstream bugs, both
  now fixed — see the two entries below. **#25546 still needs a fresh certify run**
  to see whether either fix rescues it (it was never re-checked after; it's a
  reasonable type to spot-check once the ledger is rebuilt).

- ~~**`overlapStrict` gave false positives on concave tiles.**~~ **FIXED
  2026-07-21.** It shrank each tile 2% toward its centroid before testing pairwise
  intersection — correct for convex tiles, wrong for concave ones (every
  multi-segment edge produces a concave tile): the centroid can sit in a notch or
  outside the shape, so shrinking toward it pushes the boundary across a shared edge
  into a neighbour and invents an overlap. Confirmed on #72872 — John: *"the tiling
  seemed to work, I didn't see any overlaps or gaps"* — which scored **24** under the
  old test; exact intersection area of all 24 flagged pairs is **0**. Ground truth
  sides with John, not the test.

  Replaced with exact triangle-clip intersection area (`engine/overlap_strict.js`):
  triangulate the base m-gon once (all placed copies are affine images of it, so
  triangulate once and map through each tile's placement transform `T` — never
  re-triangulate a deep/far copy directly, see below), then sum convex-convex clipped
  area (Sutherland-Hodgman) over every triangle pair. Convex-convex clipping has none
  of the concave-concave failure modes — a shared vertex or edge clips to a
  lower-dimension sliver contributing ~0 area, never spurious positive area.

  Getting a *correct* concave triangulation took three rounds, each a real bug found
  on a real ledger type, not a synthetic case:
  1. Multi-segment edges are built from FLAT (180°) sub-vertices — three consecutive
     points EXACTLY collinear by construction, not a rare occurrence. "Convex + no
     vertex strictly inside" (the textbook ear test) doesn't see a vertex sitting
     EXACTLY ON a candidate ear's edge, so it can accept an ear that overlaps the
     polygon's own next tooth (#4809: an "ear" only 133/196 sample points inside the
     true polygon). Fixed by collapsing straight-through (180°, `dot>0`) vertices
     before triangulating. **Do not** collapse a 0° vertex the same way — that's a
     real zero-width spike (what the boundary-touch rule targets), not a collinear
     continuation, and removing it would change the shape; distinguished by the sign
     of the dot product.
  2. "No vertex strictly inside" is not *complete*: a long non-adjacent edge can pass
     straight through the candidate ear with **both endpoints outside** the ear
     triangle, entering one side and leaving another — the vertex-inside test never
     sees it (#72814: an ear scored "clear" yet cutting it left a remainder with
     shoelace area exactly 0, the signature of a bowtie). Fixed by also requiring the
     ear's diagonal not cross any other edge of the polygon.
  3. Auditing case 2 surfaced something bigger, below.

  Verified: all 54 hand tilings unaffected, convex regression set still 0/0, and a
  158-type L2 sample stayed at 0 false flags (positive control) after every round.

- **`solveTile` accepted self-intersecting closing polygons.** Found while chasing
  bug 2 above: #72814's base tile (case 2's example) turned out to genuinely
  self-intersect — not a triangulation bug, a real bowtie. Scanning every L1/L2/hand
  winning config: **86 of the 91 L1 types have a self-intersecting base m-gon.**
  `solveTile`'s acceptance test (`relGap`/`relArea`/`relSep`/boundary-touch) never
  checked this. A self-intersecting polygon has no well-defined inside/outside — it
  fails before "developed" even means anything — so its `develop()` overlaps were
  never a tiling defect, they were this.

  Fixed at the source (`tiler_core.js` `polySelfIntersects`, alongside the existing
  gates): reject a candidate whose non-adjacent sides properly cross, same pattern as
  the coincident-vertex and boundary-touch rules. `overlap_strict.js` keeps a
  defensive check too (`polySelfIntersects`) for any stale config that predates the
  fix — on a self-intersecting base it reports every pair as overlapping rather than
  trusting a meaningless triangulation.

  Verified: all 54 hand tilings still `ok=true`; #8954/#3103/#25539 (self-intersecting)
  now correctly `ok=false`; #72814 (genuinely fine) still `ok=true`.

  **Confirmed: this was the real explanation for most of the L1 category.**
  Re-certified after both fixes landed:

  ```
                  L2    L1    L0   none
  before   369    91   130    493
  after    383    10   197    493
  ```

  14 of the 86 self-intersecting-escapee types were rescued to L2 (Newton found a
  genuinely valid config once the bad one was rejected); 67 dropped to L0 (nothing
  valid within `m<=8`). The 10 that remain L1 are the genuine article: 8969, 25470,
  25514, 25529, 25531, 25539, 208911, 209056, 209085, 209130. All 54 hand tilings
  still L2, regression set still 9/9 clean, no impossible type claims a witness.

  So the whole multi-segment regime is untested. All 34 edges here are `edgeSym=3`
  (S) and `row6` is all zeros. **Next step:** develop a 2-tile patch and check by
  hand which neighbour transform is wrong, rather than reasoning from the 120-tile
  result. Add a multi-segment case to the regression set once fixed.

- **The UI hides engine `impossible`.** `engine/mono2iso.js` `parseCfg` deliberately
  draws `reducible` and `self intersection` combos with an ⓘ note (see the comment at
  line 56), while `engine/test_harness.js` `parseCfg` rejects anything containing
  `impossible`. So the UI can show "✓ closes" with a trailing ⓘ on a combo that
  certification has already ruled out — e.g. #25539 m=6 sum=[1,2,0,1,0,0] orient=1
  off=4, where `specify()` returns `impossible - self intersection`. Make the hard
  engine verdict visually distinct from the soft geometric warnings.

- **Negative angles are not representable as distinct from their +360 counterpart.**
  `verticesOf` advances headings by `π − A`, which is invariant mod 360, so −90 and
  270 give identical vertex positions; and the curve layer takes its geometry from
  edge endpoints only (`mapToEdge`), never reading the angle. The intended
  distinction — the edge curls one way for −90 and the other for 270 — has nowhere
  to live in the current model. Needs a design decision before it can be a feature.

- **Cold-start irreproducibility.** `solveAndDevelop(id, m, orient, off)` returns
  `null` as the first engine call in a fresh process but succeeds once the `m` loop
  has warmed up. Certification always walks `m` from `lo` so it is unaffected, but a
  single recorded config cannot be replayed standalone. Root cause not yet found.

- **`si` was a phantom dimension until 2026-07-19** and the `none`/`L0` sets were
  never searched over sum-types. A re-sweep with `si` live may still move some of
  them. See `NOTES.md`.

---

## 7. Isohedral block-criteria checker (in progress, started 2026-07-24)

**Goal.** A second, independent path to L3 (exact proof), complementary to the exact-
closure work in `py/certify_case_a.py` (see `NOTES.md` "L3 certification"). Recognize
when a small BLOCK of 2-3 adjacent developed tiles satisfies one of the 9 classical
Heesch-Kienzle isohedral-tiling criteria (edge-matching via translation/glide-reflection/
rotation between designated side-pairs of a possibly-collapsed hexagon) — a match is a
complete, self-contained proof that the tile shape tiles the plane, and it holds for a
whole shape FAMILY at once (no interval arithmetic needed, unlike a genuine free-angle
Case B family). Motivated by the 14 Case A "length-family" types (e.g. #41: any
rectangle; #9037: any parallelogram) — John can already prove several of these tile by
hand via specific criteria (#9037 = criterion 5 on a 3-tile block; #209290 = criterion 8
on a 2-tile block), and wants that recognition automated.

**Reference material (John's own, in the program4/ root):**
- `criteria.pdf` — Table 58, the 9 criteria's exact rules (Heesch & Kienzle / Langerman &
  Winslow 2015 / Schattschneider & Escher 1990 / Church 2008, via Tullenken's
  "Polyominoes"). Criterion 6 needs a two-center search and is **explicitly deferred**
  (John: "the hard one") — only 1,2,3,4,5,7,8,9 are in scope.
- `isohedral.txt` — John's own algorithm sketch for detecting each criterion via
  translation-anchored/rotation-anchored edge-cycle matching.
- `isoTesting.txt` — hand-checked ground truth: type #1728474, sizes 6-16, sum-type of
  the form `[1,X,0,...,0]` (X grows with size; the ONE such sum-type at each size, found
  by `s[0]===1 && s[1]>0 && s.slice(2).every(x=>x===0)`), always with reflection
  (`orient=1`), walking every offset. Each cell is `iso N` / `aniso` (closes, not
  isohedral by these criteria) / `X` (can't tile at all).

**Full technical plan already written** — read
`C:\Users\johnd\.claude\plans\lazy-tickling-goose.md` before redoing this analysis; it
has the file/line references, the primitive designs, and the validation strategy in
detail (note: this plan file gets overwritten by whatever gets planned next, so if it's
gone, this TODO section plus the code comments in the two files below are the fallback).

**Built and validated so far:**
- `engine/tiler_core.js` exports a new `developAdjacency(placed, verts, k, n, beginAt,
  size, row2, row3, row6)` → `nbr[tileIdx][side] = neighbourTileIdx or -1`, given an
  already-`develop()`ed patch. Verified: perfect reciprocity on #974 (0 failures across
  72 checked adjacencies).
- `engine/isohedral_criteria.js` (new file): `blockBoundary(placed, nbr, tileIdxs)` merges
  a connected tile block into one outer polygon (stitches the non-shared sides into an
  ordered closed walk). `fitIsometry(Xs, Ys)` finds the direct/indirect isometry mapping
  one point sequence onto another (reuses `tiler_core.js`'s `directIso`/`reflIso` — the
  same construction `sideMotion` uses to glue tiles), handling degenerate single-point
  sides (needed for a hexagon with sides collapsed to zero, e.g. a plain quadrilateral).
  `sidesTranslate(sideX, sideY)` — opposite-side translation check (reversed(X) must
  translate onto Y, since opposite sides of a translation-symmetric polygon are
  equal-AND-REVERSED as directed boundary edges, not equal — derived from first
  principles for a parallelogram, not from John's prose, and worth re-deriving rather
  than trusting blindly if it's ever in doubt). `checkCriterion4(poly, corners)` — the
  Translation Criterion (a,d / b,e / c,f each translate), for an EXPLICIT corner choice
  only (no automatic search yet — see below).
- Validated: `checkCriterion4` correctly matches #41 (rectangle, single-tile block) and a
  general non-axis-aligned parallelogram, and correctly REJECTS a trapezoid (negative
  control) — see `engine/_dev_isohedral/test_criterion4.js` and
  `test_criterion4_negative.js` (kept in the repo specifically so this doesn't need
  re-deriving; `test_adjacency.js` similarly validates `developAdjacency`).
- **Solved: John's offset-walk convention vs. the engine's raw `off` parameter is a clean
  negation**, `johns_offset = (m - engine_off) mod m`. Confirmed EXACT (every single
  offset, including which one is "reducible") on #1728474 at m=7, 8, and 10 against
  `isoTesting.txt`. m=9 has ONE discrepancy (I found 5 closing/non-self-intersecting
  offsets where John's table only has 4 valid entries) — not yet resolved; likely one of
  my "clean" configs actually has a boundary-touch or coincident-vertex defect (see
  `NOTES.md`'s rules of the same names) that a plain closure+self-intersection check
  doesn't catch. `engine/_dev_isohedral/survey_1728474_full.js` reproduces the full
  closure/self-intersection/reducible table for sizes 6-16 (re-run this first when
  resuming — it's the fastest way to re-orient).

**Not yet built — pick up here:**
1. **Automatic corner search.** Everything above takes the hexagon's 6 corners as a given
   explicit input; there's no code yet to find WHERE they are on an arbitrary boundary.
   `isohedral.txt` describes an anchor-and-extend search (pick a vertex pair, hypothesize
   a translation, extend the match as far as it holds) — I got tangled trying to
   translate this literally from prose (see the plan file for where); it's probably
   better derived fresh from the geometry (candidate seed = two boundary EDGES that are
   exact negatives of each other, then extend one vertex at a time in both directions
   while the match keeps holding) than from another close reading of the text.
2. **Criteria 1, 2, 3** need a "side is individually centrosymmetric" primitive (reversed
   side maps onto itself via a pure 180° rotation about its own midpoint — NOT the same
   as two sides matching each other) in addition to `sidesTranslate`/glide-reflect.
3. **Criterion 5** needs `sidesGlideReflect` (not yet written — same shape as
   `sidesTranslate` but expects `fitIsometry`'s `'reflect'` kind, and I was NOT able to
   confirm from first principles whether the two sides should be compared reversed or
   not — check both ways, like `sidesTranslate`'s reversal was confirmed by testing, not
   assumed) plus the "glide reflections parallel" condition (rule 4).
4. **Criteria 7, 8, 9** need a `sidesRotate(sideX, sideY, angleDeg)` primitive anchored at
   a shared vertex (the two sides meeting at the rotation center), plus finding that
   shared vertex and trying both which-side-is-reversed combinations empirically.
5. Once the above exist, run the full sweep against `isoTesting.txt` (all of m=6..16,
   every offset, via the confirmed negation transform) and don't trust any of it until
   that matches — this dataset is the ground truth, more trustworthy than re-deriving
   from `criteria.pdf`'s prose alone.
6. **Spot-check #9037 (criterion 5, 3-tile block) and #209290 (criterion 8, 2-tile
   block)** against John's own by-hand derivations once the criteria above exist. For
   #209290 specifically, his description ("vertices v1 and v6 of the quadrilateral plus
   vertex v5 of the hexagon must be an equilateral triangle... e0 to e6 rotates 120
   degrees") uses the type's k=4/n=6 net-edge orbit vertex labeling (`orbitPoly(0,k)` /
   `orbitPoly(k,k+n)` in `mono2iso.js`) — worth asking him to confirm which actual m-gon
   vertex indices "v1"/"v5"/"v6" refer to before assuming a mapping, rather than guessing.

**Update 2026-07-24/25, corner search rebuilt and validated further:**

- **Pure geometry is not enough — criterion matching must be gated on the tile's own
  combinatorial edge data**, not just raw solved coordinates. A solved polygon can be
  ACCIDENTALLY symmetric (e.g. #1728474 solves to a regular hexagon at several offsets)
  without that being a genuine criterion match for that specific offset's construction —
  confirmed directly: `whichEdge`/`edgeSym`/`mapping` differ substantially across offsets
  of #1728474 m=6 even though the raw angles/lengths are IDENTICAL every time. Fix (from
  John's "js tiling program notes.pdf" + worked examples, not from `isohedral.txt`'s prose):
  two edges may only be identified with each other if `whichEdge` agrees, and then, for a
  J-curve edge (`edgeSym` 0), their `mapping` codes (0-3: which of {rotated, reflected,
  turned-inside-out, both} each takes to reach the group's canonical lowest edge) must
  satisfy: codes summing to 3 for a DIRECT match (translate/rotate), codes differing by 2
  for an INDIRECT match (glide/reflect). An I-curve edge (`edgeSym` 2, straight segment)
  is compatible either way regardless of mapping. U/S (`edgeSym` 1,3) have their own
  partial symmetry and the rule for those is NOT yet established (John wasn't sure either)
  — none of the validated data below happens to use them. Implemented as `edgeCompat` in
  `engine/isohedral_criteria.js`.
- **REWRITTEN 2026-07-25 to be faithful to `criteria.pdf` Table 58 — read the table itself
  before touching this code again.** Earlier passes built the search from `isohedral.txt`'s
  prose (a "connector" pair of translate-matched sides, then two leftover *cycles* each
  required to self-map as a whole arc, plus an ad-hoc pile of degenerate/collapse special
  cases). That reading is **wrong**, and the table is far simpler and more uniform:

  Every criterion is stated on a hexagon with corners A..F and sides `a=A→B, b=B→C, c=C→D,
  d=D→E, e=E→F, f=F→A` (any side may collapse to zero), and each is just a short
  conjunction of four primitive relations between NAMED sides:

  | # | rules |
  |:--|:--|
  | 1 (Conway) | `trans(a,d)` `centro(b)` `centro(c)` `centro(e)` `centro(f)` |
  | 2 | `trans(a,d)` `centro(b)` `centro(c)` `glide(e,f)` |
  | 3 | `trans(a,d)` `glide(b,c)` `glide(e,f)` |
  | 4 (Translation) | `trans(a,d)` `trans(b,e)` `trans(c,f)` |
  | 5 | `trans(a,d)` `glide(b,f)` `glide(c,e)` + the two glide axes **parallel** |
  | 6 | `glide(a,d)` `glide(b,f)` `centro(c)` `centro(e)` + the two axes **perpendicular** |
  | 7 | `rot(c,d,120° about D)` `rot(e,f,120° about F)` `rot(a,b,120° about B)` |
  | 8 | `rot(c,d,120° about D)` `centro(e)` `rot(a,b,60° about B)` |
  | 9 | `rot(b,c,90° about C)` `centro(a)` `rot(d,e,90° about E)` |

  So there is ONE search — over 6-tuples of corner positions along the block boundary —
  and nine predicate sets over it. **The key error being corrected: the criteria constrain
  each side INDIVIDUALLY** (criterion 1 wants side b centrosymmetric about *its own*
  midpoint AND side c centrosymmetric about *its own* midpoint), not the merged arc `b+c`
  as one symmetric arc. Those are genuinely different conditions — explicit counterexample
  in `_dev_isohedral/check_crit1_structure.js` (two individually-centrosymmetric sides
  whose union is not centrosymmetric) — and conflating them made criteria 1/2/3/5 both
  over- and under-fire. Reconciliation with `isohedral.txt`: John's palindrome
  `ab...cc...bade...ff...ed` is not one arc, it is TWO centrosymmetric sides concatenated
  (`ab...cc...ba` = side b, `de...ff...ed` = side c) — "Two Centro symmetrical curves", as
  he wrote. Criterion 6 needs no special two-center machinery in this formulation, so all
  nine criteria are now implemented (previously 5).
- **Collapsed sides are allowed EVERYWHERE — including rotation and glide pairs (John,
  2026-07-25: "crit 8 & 9 will allow sides to collapse just like the others").** Two
  intermediate versions got this wrong by forbidding collapse in `rot`/`glide` to stop
  false positives; the real guard is the pentagon rule below, not a collapse ban.
  - A collapsed **rotation** pair carries NO angle requirement. John's criterion-8 reading
    of #54: *"take edge 0 as a centro symmetric curve — this is for the 180 degrees. We can
    rotate edge 1 to edge 2 by 60 degrees. The 120 degree rotation collapses to 0."* So do
    **not** demand the interior angle at a collapsed rotation corner equal the rotation
    angle — #54's corners are all 60°, never the 120° that rule (1) names.
  - A collapsed **glide** pair pins no mirror axis, so criteria 5/6's rule (4) (the
    parallel/perpendicular condition Church 2008 added because counterexamples exist
    without it) is simply vacuous there rather than grounds for rejection. Required: a
    3-edge triangle cannot fill all six side slots without collapsing a pair, and John
    confirms #4 — a triangle — satisfies criterion 6.
- **THE PENTAGON RULE — this is what keeps collapse from degenerating a criterion.** John:
  *"Criteria 8 and 9 are stated on pentagons."* Count which sides each criterion's rules
  actually mention: 1–7 name all six, but **8 and 9 name only a,b,c,d,e — side `f` appears
  in no rule at all.** So `f` is not merely allowed to collapse, it MUST be empty; a
  non-empty `f` would be a stretch of boundary under no constraint whatsoever. That single
  condition rejects the exact false positive that motivated the (wrong) collapse ban: with
  `b,c,d,e` collapsed, criterion 9 would otherwise read "side a centrosymmetric, side f
  arbitrary" and fire on #1728474's regular hexagon, which has no 90° anything. With `f`
  required empty it is rejected, while John's #54 criterion-8 decomposition (a,b,e real;
  c,d and f collapsed) still passes. Implemented as `empty(s.f) && …` on criteria 8 and 9.
- **`centro`'s combinatorial gate is a palindrome with a special middle.** Edge `k` pairs
  with edge `(last−k)` under the half-turn, each pair direct-compatible; if the side has an
  ODD number of edges the middle edge maps to **itself**, which no two-different-edges rule
  can express (a J edge compared with itself trivially fails every one of them). That case
  is exactly "this edge must be point-symmetric on its own" → must be **S or I**. This is
  John's "we could replace either of those pairs by an S or I curve", and it cleanly
  replaces the earlier ad-hoc `n≤2` collapse special-casing. Tested in
  `_dev_isohedral/test_side_glide_self.js` (repurposed — the `sideGlideSelfSymmetric`
  primitive it used to test does not exist in Table 58 and is gone).
- **`edgeCompat` extended to S and U** by applying J's rule under each type's own
  identification: S (point-symmetric) makes "turned inside out" a no-op so `0~2, 1~3`, and
  J's rule collapses to a **parity** test (direct iff parities differ, indirect iff they
  agree); U (line-symmetric) makes "reflected" a no-op so `0~1, 2~3`, and both of J's tests
  collapse to "the codes straddle 2", i.e. U **cannot distinguish direct from indirect**.
  S is exercised by #54/#415; U is exercised by nothing yet, so treat a U-heavy verdict as
  unvalidated.
- **Direction conventions (settled):** `trans` and `rot` match **reversed** (opposite sides
  of a translation-symmetric polygon are equal-and-reversed as directed boundary walks; a
  rotation about a shared corner pins that corner and swaps the far endpoints). `glide`
  matches in the **same order** — `isohedral.txt`'s "`ab...cab...c` by indirect map", the
  sequence repeating rather than mirroring. Rotations are signed, so each of criteria 7/8/9
  is also tried with all its angles negated, to accept both handednesses.
- **John re-evaluated the `isoTesting.txt` ground truth itself** ("My ground truth is what
  I found, but I can make mistakes too") after looking at exported `combo_*.json` files —
  some `iso 5` cells at #1728474 m=7 are actually `iso 6, not 5` (matches the file's own
  caveat that some iso-5 examples are also iso-6), and a couple of `iso 4`/`iso 3
  (reducible)` cells are genuinely ambiguous between 4 and 5. So part of the remaining
  sweep mismatch is stale ground truth, not checker bugs. Exporting solved combos to
  `program4/combos/` (minimal `{id,m,sum,orient,off,manual:{A,L}}` JSON, loadable in the
  interactive tiler) for John to eyeball and correct is now the standing way to
  cross-check checker output — he can only review "a dozen or so at a time," so curate,
  don't dump.
- **Reducible (flat, 180°-vertex) polygons are not collapsed before searching, and need to
  be.** #601142 m=7/off=3 (confirmed `iso 1` by John) has 180° angles at v0 and v1 — edges
  6/0/1 are collinear, i.e. really ONE physical edge, not three — so the corner search is
  operating on the wrong edge set and misses it. NOTES.md already has prior art on
  reducible/flat-vertex handling (the boundary-touch and reducible-config work) worth
  reusing rather than rebuilding. Not yet fixed — next thing to pick up on this track.
- **Offset convention is NOT universally `johns_offset = (m - engine_off) mod m`.** That
  negation was specific to how John hand-walked the #1728474 dataset. For #601142/#601143
  (given directly as "type, size, sum, refl, offset" — read straight off the UI, not a
  hand walk) the DIRECT reading (engine off = the stated offset) is what makes every case
  close consistently. Confirm which convention applies per dataset rather than assuming.
- **Block size matters and isn't obvious in advance.** #4 (equilateral triangle) needs a
  2-tile block to show criteria 1/4 (matches the classical fact that any triangle tiles by
  180°-rotating a copy about an edge midpoint — invisible on the triangle's own boundary)
  and a 3-tile block to additionally show criterion 2 — confirmed by John directly
  (`checkBlock` found exactly what he expected once given a big enough block; no bug). The
  3-sided sweep below only tried single- and 2-tile blocks, so its `aniso` verdicts are a
  lower bound, not a proof of non-isohedral, until larger blocks are tried too.

**Fresh sweep of all `k_q n_r` = `3_q 3_r` types (2026-07-25), John's idea — start small
before going back to #1728474 or up to 4-sided tiles.** 63 types in `templates.js` have
k=3,n=3 (`{id,k,q,n,r,wp,orb,vdeg,name}` entries, filtered directly — this is the same
`3_q 3_r` notation as the orbit-signature work in §1, q/r vary, k/n fixed at 3). Each has
exactly one sum-type at m=3 (the minimal/only realizable triangle size), so 63×2 orient×3
off = 378 combos total: 126 genuinely impossible (`cfg.impossible`, i.e. `specify()` finds
no angle solution at all — confirmed NOT the cold-start reproducibility bug from §6 by
re-testing), 80 self-intersect/don't close, 172 close.

**Result after the Table-58 rewrite (blocks up to 3 tiles): every one of the 45 types that
closes finds at least one criterion — ZERO types where all closing configs come out
`aniso`.** That is John's own prediction ("I'm betting they will all be isohedral")
confirmed for the whole `3_q 3_r` family. Before the rewrite the same sweep left 22 types
matching nothing, so that entire deficit was checker bugs, not mathematics. (18 types never
close at all and are untouched by this.) Full per-combo detail lives in
`program4/criteria_results.csv`, regenerated by `_dev_isohedral/export_csv.js`.

John spot-checked the exported combos and (2026-07-25) found:
- **#4 (equilateral triangle, I-curve edges): also matches criteria 2, 6, 8** — all three
  now reproduce (2 and 6 on the single tile, 8 on a 3-tile block). Expected for a
  maximally-symmetric shape to satisfy several criteria via different corner choices.
- **#31: impossible for a NEW reason — a diameter/reachability argument, not a numeric
  solve failure.** John: "The one tile has points on the vertices of an equilateral
  triangle which the other orbit can never reach." I.e. one net-edge orbit's own
  edge-length/angle structure bounds the maximum distance between two of its points below
  what the OTHER orbit's vertices would need to reach — a genuine impossibility proof, not
  a "no solution found." `specify()`'s own diagnostic is just the generic "impossible - no
  angles add to non zero", giving no hint of this — John found it by inspecting the failed
  angle system by hand. **This is new territory (John: "this is a new one for me")** —
  worth its own investigation: pin down the general form of the argument precisely (which
  net-edge orbit, which two vertices, what bounds the reachable distance), confirm on #31,
  then figure out how to search the rest of the 1270 types for the same failure signature
  (a reachability/diameter mismatch between the two orbits) rather than relying on
  `specify()`'s generic "no angles" message to notice it by accident.

---

### Validation state after the Table-58 rewrite (2026-07-25)

Run `node engine/_dev_isohedral/validate_all.js` — one script, every piece of ground truth
John has given. Current standing:

**A. `isoTesting.txt` (#1728474, m=6..16, single-tile blocks): 87/113 agree** (was 82/113
under the old structure, 71/113 before the combinatorial gate existed).

**B. The six 3-sided types John confirmed by hand — ALL SIX now reproduce EXACTLY**, on the
single tile, no missing and no extra criteria:

| type | curves | John (tile) | single tile finds |
|:--|:--|:--|:--|
| #4 equilateral | III | 1,2,6,8 | 1,2,6,8 ✓ |
| #30 equilateral | III | 1,2,6,8 | 1,2,6,8 ✓ |
| #108 half square | III | 1,2,6,9 | 1,2,6,9 ✓ |
| #582 ⅓ equilateral | III | 1,2,6,8 | 1,2,6,8 ✓ |
| #54 equilateral | SSS | 1,8 | 1,8 ✓ |
| #415 equilateral | SSS | 1,8 | 1,8 ✓ |

Two things had to be right for this, both worth remembering:

- **Compare per CURVE-TYPE config, never union across configs.** Different `(orient, off)`
  configs of the same type can carry different `edgeSym`: #54 is S-curve at `orient=0` but
  **I-curve at `orient=1`**, and the I-curve config legitimately matches 1,2,6,8 exactly like
  #4. Unioning them manufactured phantom "extra" criteria against John's S-curve description.
  `validate_all.js` now groups by the `edgeSym` signature.
- **The S row of `edgeCompat` was wrong** and John caught it: *"they can't be 2 or 6 — since
  these S curves don't glide reflect to each other."* Re-deriving: the four mapping codes form
  a Klein group (1 = mirror across the perpendicular bisector, 2 = turn inside out across the
  baseline, 3 = both = half-turn about the midpoint), composition is XOR, and John's J rule
  ("sum 3" direct, "differ by 2" indirect) is exactly `XOR==3` / `XOR==2`. For an S curve the
  point symmetry **is** `T_3`, so `T_3` is the no-op and `v ~ v XOR 3`: **direct iff
  `XOR ∈ {0,3}`, indirect iff `XOR ∈ {1,2}`**. The earlier code used a parity test
  (`0~2, 1~3`), which is the *U*-style identification, not S's — and it wrongly made two S
  edges at mapping 0 glide-compatible. With the fix, #54/#415's all-zero mappings give
  `XOR=0`: direct-compatible (criteria 1 and 8, which John confirms) and never
  glide-compatible (correctly killing 2, 3 and 6). U (`T_1` is the no-op, `v ~ v XOR 1`, so
  both tests become `XOR ∈ {2,3}` and U cannot distinguish direct from indirect) remains
  unexercised by any test data.

**C. John's directly-quoted #601142/#601143 cases: 6/8 agree** (m=8/si=2/or=0/off=1's
`aniso` vs. `iso 8` is NOT a disagreement — see item 2 below) — and these are the first
confirmations of the newly-built criteria: #601142 m=8/si=1/or=0/off=4 → **criterion 7** ✓,
m=8/si=2/or=1/off=5 → **criterion 6** ✓, m=8/si=2/or=0/off=1 → **criterion 8 on a 2-tile
block** ✓ (tile itself correctly anisohedral), #601143 m=7/off=6 → **criterion 9** ✓, plus
both `iso 1` cases ✓.

**The 26 section-A disagreements, categorised** (John confirmed the first group, so the
effective standing is 98/113):

| n | pattern | status |
|--:|:--|:--|
| 11 | `gt=iso 5` → `pred=iso 6` (m=8,9,11,12,13,15,16 at offsets 3–4) | **RESOLVED — John confirms the checker is right**: "Applying iso 5 requires adding extra vertices to midpoints. We won't do this." `isoTesting.txt` is stale on these cells, exactly as it already was on the m=7 ones he re-labelled. |
| 9 | `gt=iso 4 (reducible)` → `pred=aniso` (off=5, every size ≥8) | reducible/flat-vertex gap — see below |
| 3 | `gt=iso 4 or 5` → `pred=aniso` (m6/off1, m6/off5, m7/off5) | John's own re-rankings; m7/off5 also reducible |
| 2 | `gt=X` → `pred=aniso` (m9/off7, m12/off8) | checker thinks these close; same closure-vs-defect question as the m=9 discrepancy noted earlier in §7 |
| 1 | `gt=aniso` → `pred=iso 5` (m14/off3) | suspected false positive |

**Open, in priority order:**

1. **The reducible/flat-vertex gap is now the single highest-value fix** — 10 of the 15
   genuinely-open disagreements (all nine `iso 4 (reducible)` cells plus m7/off5). A 180°
   vertex means consecutive collinear unit edges are really ONE physical edge, and nothing
   collapses them before the corner search runs, so the search works on the wrong edge set.
   Same root cause as the #601142 m=7/off=3 miss noted above. `NOTES.md` has prior art on
   reducible-config handling worth reusing.
2. **One suspected false positive remains: m14/off3** (`gt=aniso`, `pred=iso 5`, single
   tile). #601142 m=8/si=2/or=0/off=1 is NOT a false positive — John confirmed (2026-07-25):
   *"the individual tile is anisohedral [and criterion 8 on the 2-tile block is correct].
   All these 2-isohedral tilings will have some block that tiles isohedrally. Often it is a
   2 block. It depends on the ratio of the tiling orbits (which are given by the q:r ratio
   in `k_q n_r`)."* This is the expected, central shape of the whole research question —
   not just this one case: a 2-anisohedral type's TILE is individually anisohedral (that is
   what "2-anisohedral" means) while some BLOCK (often 2 tiles, sometimes more depending on
   the q:r ratio) tiles isohedrally via one of the 9 criteria. So `gt=aniso` (tile-level)
   and `pred=iso N @ block` coexisting is not a contradiction, it is the finding. Always
   report tile-level and block-level matches separately (as `validate_all.js` now does) —
   never treat a block-only match as disagreeing with a tile-level `aniso`. **Follow-up
   worth its own investigation**: check whether the q:r ratio actually predicts the needed
   block size across the dataset already gathered (`criteria_results.csv`'s `max_block`
   column, cross-referenced against each type's `q`,`r` from `templates.js`).
3. **#601142 m=8/si=1/or=1/off=2** (`gt=iso 7`, checker finds 1,2,4,6 but not 7) and
   **m=9/si=3/or=1/off=2** (`gt=iso 8`, checker finds nothing) — John flagged the latter's
   proof as "tough". Genuine misses to investigate.

### Performance: the 6-tuple search does not scale, and John's structure is the fix

John (2026-07-25): *"when we get large numbers of sides, the number of cases to consider will
jump up a lot. This is why I structured my search the way that I did. For small numbers of
sides (maybe 8 or under?) the 6-tuple method is probably faster."* Measured
(`_dev_isohedral/scaling.js`, all nine criteria, worst case = no match):

| n | 6-tuples | time |
|--:|--:|--:|
| 8 | 10,296 | 12 ms |
| 12 | 74,256 | 45 ms |
| 16 | 325,584 | 142 ms |
| 20 | 1,062,600 | 488 ms |
| 24 | 2,850,120 | 1.4 s |
| 30 | 9,738,960 | 5.2 s |

That is `n·C(n+5,5)` ≈ **n⁶/120**. Fine for the triangle sweep and for `isoTesting.txt`
(n ≤ 16), already slow by n=30, and hopeless for the regime section §1 cares about —
#25546 at m=34 is ~12 s for a single tile, and a 3-tile block of it (~90 boundary edges)
would be ~10¹⁰ tuples. So the curr{
  "type": "#8826",
  "symbol": "<8826.0:14:2 5 6 10 9 12 14,1 4 3 8 9 11 13 14,3 5 7 10 11 12 14:16 3,4 3 3>",
  "orbifold": "2*22",
  "k": 16,
  "n": 3,
  "verdict": "unknown",
  "configurations": [
    {
      "id": 1,
      "label": "Config 1",
      "tileOrbit": 7,
      "points": [
        {
          "i": 1,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            2.914213562373096,
            0.4999999999999982
          ],
          "addr": {
            "h": 15,
            "f": 1,
            "ty": 0
          }
        },
        {
          "i": 2,
          "kind": "tileCentre",
          "orbit": 7,
          "xy": [
            1.2071067811865481,
            0.499999999999998
          ],
          "addr": {
            "h": 0,
            "f": 1,
            "ty": 2
          }
        },
        {
          "i": 3,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            1.2071067811865472,
            -1.207106781186549
          ],
          "addr": {
            "h": 3,
            "f": 1,
            "ty": 0
          }
        },
        {
          "i": 4,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            -0.4999999999999999,
            0.5
          ],
          "addr": {
            "h": 0,
            "f": 1,
            "ty": 0
          }
        },
        {
          "i": 5,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            1.2071067811865512,
            2.207106781186545
          ],
          "addr": {
            "h": 6,
            "f": 1,
            "ty": 0
          }
        }
      ],
      "pairwiseDistances": [
        {
          "pair": "1-2",
          "d": 1.707107
        },
        {
          "pair": "1-3",
          "d": 2.414214
        },
        {
          "pair": "1-4",
          "d": 3.414214
        },
        {
          "pair": "1-5",
          "d": 2.414214
        },
        {
          "pair": "2-3",
          "d": 1.707107
        },
        {
          "pair": "2-4",
          "d": 1.707107
        },
        {
          "pair": "2-5",
          "d": 1.707107
        },
        {
          "pair": "3-4",
          "d": 2.414214
        },
        {
          "pair": "3-5",
          "d": 3.414214
        },
        {
          "pair": "4-5",
          "d": 2.414214
        }
      ]
    }
  ],
  "regions": [
    {
      "id": 2,
      "label": "Region 1",
      "tileOrbit": 8,
      "points": [
        {
          "i": 1,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            -2.207106781186549,
            -1.2071067811865475
          ],
          "allowed": false,
          "addr": {
            "h": 5,
            "f": 1,
            "ty": 0
          }
        },
        {
          "i": 2,
          "kind": "tileCentre",
          "orbit": 7,
          "xy": [
            -3.9142135623730963,
            -1.2071067811865455
          ],
          "allowed": false,
          "addr": {
            "h": 10,
            "f": 1,
            "ty": 2
          }
        },
        {
          "i": 3,
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            -3.914213562373096,
            0.5000000000000013
          ],
          "allowed": false,
          "addr": {
            "h": 20,
            "f": 1,
            "ty": 0
          }
        },
        {
          "i": 4,
          "kind": "tileCentre",
          "orbit": 7,
          "xy": [
            -2.207106781186548,
            0.49999999999999956
          ],
          "allowed": false,
          "addr": {
            "h": 1,
            "f": 1,
            "ty": 2
          }
        }
      ],
      "allowedPoints": [],
      "forbiddenPoints": [
        {
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            -2.207106781186549,
            -1.2071067811865475
          ]
        },
        {
          "kind": "tileCentre",
          "orbit": 7,
          "xy": [
            -3.9142135623730963,
            -1.2071067811865455
          ]
        },
        {
          "kind": "vertex",
          "orbit": 0,
          "xy": [
            -3.914213562373096,
            0.5000000000000013
          ]
        },
        {
          "kind": "tileCentre",
          "orbit": 7,
          "xy": [
            -2.207106781186548,
            0.49999999999999956
          ]
        }
      ]
    }
  ],
  "lastTest": {
    "cfgId": 1,
    "cfgLabel": "Config 1",
    "regId": 2,
    "regLabel": "Region 1",
    "kind": "raster",
    "fits": false
  },
  "note": "Each configuration is a set of points forced to lie in one tile -- OR, for a derived n-gon (see its label), points with no addr constructed by rotating a segment n-fold about a chosen centre, per the \"radius\" argument (reference_radius_argument.md). Each region traces a restricted tile's boundary in click order: allowed points bound a closed edge (the tile may touch them), forbidden ones an open edge (it may not). Any configuration can be tested against any region in the Test section -- they need not be the pair originally picked together. If no isometric copy of a configuration fits inside a region, the two tiles cannot be congruent."
}aect reference, not the
production search**. Two ways forward, cheapest first:
- **Memoise + prune** without changing the search space: precompute `trans`/`glide`/`centro`/
  `rot` verdicts for all O(n²) sides and O(n⁴) side-pairs once, then enumerate only
  combinations already known to satisfy the criterion's first rule. Since equal edge-count
  is required for every pair relation, the compatible-pair lists are tiny in practice.
- **Adopt John's anchor-and-extend search** (`isohedral.txt`) for large n — start from a
  matching edge pair and extend while the match holds, rather than enumerating cut points.
  That is what his own program does and why he wrote it that way. Now that the table-faithful
  version exists and is validated, it can serve as the oracle to test a faster search
  against — which is the right order to build them in.
                                                                                                                                                                                                                                                                    q182
---

## Session 2026-09-09 — gallery, curve-aware checks, curve designer

**Everything is saved and consistent. Gallery is 472/472 clean.** No background jobs left running,
all 472 combo JSONs parse, `py/gen_gallery.js` now reports zero problem rows.

### Three bugs found, all measurement or storage rather than geometry

1. **`develop()` was double-placing tiles.** Its "already filled this cell" test used a window of
   `1e-3` of a tile diameter, but the placement transforms compound along the BFS walk, so a longer
   walk drifts further and the same cell got filled twice — which the curved overlap test correctly
   reported as a ~99% collision. 80 of 472 combos did this at 120 tiles. Window is now `2e-2`,
   calibrated across all 472: worst surviving duplicate `5.3e-3` of a diameter, closest LEGITIMATE
   neighbouring centroid `7.8e-2` (#25523 si0), so 2e-2 is the geometric middle of a 15x gap.
   Changed in BOTH `tiler_core.js` and `tiler_core_revpivot.js`.
   Re-run the calibration with `engine/_dev_isohedral/calibrate_dedup.js` if it is ever touched.

2. **The gallery repaired the PICTURE and not the FILE.** John, on #25643 si16: "This is what the
   gallery gives when I click the image. It is overlapping." The generator found factor 0.85 /
   motif shift 2 to draw a clean SVG, then wrote nothing back, so clicking through loaded the
   unrepaired default motif. `gen_gallery.js` now persists the resolved curve into the combo; the
   HAND snapshot still passes hand-drawn orbits through untouched, so only generated motifs are
   ever written. New check `engine/_dev_isohedral/check_as_loaded.js` draws every combo the way
   mono2iso does when you click a gallery image — this is the check that would have caught it, and
   it is the one to run after any gallery change.

3. **Stored closure gaps amplify into overlaps.** The last two overlapping combos (#209100 si0,
   #209087 si1) each had a stored gap around `2.5e-4`. `develop` composes one transform per tile,
   so that compounds along the walk and shows up ONLY in the outer ring of a big patch — invisible
   at 16 and 60 tiles, 1.3-1.4% of a tile at 120. Projecting both back onto exact closure via
   `closeConstrained(..., [])` took the gaps to ~5e-13 and the overlaps to zero. Curves untouched.
   Suspect this first whenever a combo is clean at 16/60 and dirty at 120.

### Vertex figure is now curve-aware — and #25543 si5 is CLOSED

`tiling_checks.vertexFigure` summed the angles between CHORDS. A corner the family forces flat is a
chord cusp but a real open corner once curves are drawn, so vertices where such cusps met never
reached 360 and were silently dropped. `TilerCurves.curveCornerAngles(verts, curveOf)` returns the
tangent-based interior angles; `vertexFigure` takes them via `opts.cornerAngles` (opt-in — every
existing caller is unchanged). John diagnosed the cause himself: "Probably cause we have a 0 angle.
So the straight line looks different than with curves."

- #25543 m7 si5 declares "3 5". Chords read {4} on BOTH his shape and the sweep's, at 200 and 400
  tiles. His shape read curve-aware gives {3,5} = MATCH. **This was the only row in the 1,106-row
  anisohedral census marked `vdeg NO`, so the census now has no open vertex-figure flag.**
- #209516 m8 si7 declares "3 3 4" = {3,4}; {3} by chords, {3,4} as drawn = MATCH.
- The clamp is a SEPARATE problem: on the sweep's L=0.05 shape even the curve-aware reading fails
  ({}), because a curve on a 0.05-length edge leaves at 301 degrees instead of 37.

**Trap, and John caught me in it:** `criteria_m*.csv`'s `vertex_figure` column is what the sweep
MEASURED on its own solved shape, NOT the type's requirement. The requirement is
`H.DATA.index.find(e => e.id === id).vdeg`, and `wantedDegrees` reduces it to a SET, so "3 3 4"
means {3,4}. I quoted the measured column back to him as the declaration and drew a wrong
conclusion from it. Also note that row's recorded `3 4 5` does not reproduce from the angles and
lengths the row itself prints (they are rounded to 2 and 4 decimals and re-closed on read), so that
cell should not be trusted as a record of anything.

### Curve designer — validated, usable, NOT ready to overwrite John's work

`engine/curve_designer.js` + `engine/_dev_isohedral/design_curves.js --validate`.
Against the 14 combos John drew by hand: **11 match or beat his curve, 3 reach ~70%.** The three it
cannot match are his three BEST curves (0.063, 0.070, 0.054) — it never lands in between, which
suggests those are qualitatively different solutions rather than a nearby local optimum.

Two fixes that produced most of the gain, both the same class of mistake as the family-walk bug:
- A self-crossing scored a flat 0, so every small pull of a control point also scored 0 and there
  was nothing to climb. `segDist` now returns SIGNED penetration depth, continuous through zero.
  This alone rescued #209080 si4, #209087 si4 and #209099 si4, which had been frozen at exactly the
  demo curve.
- It refused an infeasible start, which threw away exactly the cases the tool exists for. It now
  scores badness while overlapping and switches to the separation objective once clean.
- Multi-start (default 12, `CD_STARTS` to override). 5 -> 24 starts moved the three failures from
  69/65/62% to 77/81/64%, so returns are real but slow.

**It now gates on a 120-tile patch before writing** — it searches at 60 for speed and verifies at
120, the size the gallery judges at. This matters: an earlier run applied a curve to #209100 that
was clean at 60 and gave 2 overlapping pairs at 120 (worse than the 1 it started with). That was
reverted, and #209100 was then fixed properly by re-closing rather than by curves.

### Still open

- **#25543 m7 si5, #209516 m8 si7** — both verified good and left in `Checking/` as John asked
  ("The other two are good as they are"). Their `open_*` names are now misleading.
- Candidates worth pointing the designer at: `209232_m7_si0_or1_off2`, `25643 si18`.
- `engine/translation_block.js` — lattice extraction still fails its control. Deriving the lattice
  from the Delaney-Dress symbol / netEdgeData is the suggested route.
- Batch task from `/batch`, partially done: make every checker curve-aware. Self-intersection,
  tile overlap and vertex figure are done; anything else operating on `TC.verticesOf(...)` is not.

### Ready next step, deliberately NOT done unsupervised

**253 of the 472 combos still store a closure gap above 1e-6**, the largest at `8.6e-4`
(#1727384 si6/si7, #1728357 si3) — bigger than the `2.5e-4` that produced the two overlaps fixed
today. All 472 are clean at 120 tiles right now, so this is latent rather than active: the gap only
surfaces once the patch is large enough for it to compound. Re-closing them all is a one-liner with
the same `closeConstrained(cfg.eqs, groups, m, u0, [])` projection used on #209100 and #209087, and
it moves each shape by less than the gap itself. Left undone because it rewrites 253 of John's
files and should be his call, and because the right check afterwards is his eye on the gallery, not
just `check_as_loaded.js`. Do a backup copy first.
