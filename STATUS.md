# Where the results stand

Written 2026-09-10. Numbers here were recomputed from the files in this directory, not copied from
older notes.

## The two different things in `data/`

They answer different questions and it is easy to conflate them.

**`data/ledger.json` — does each type tile at all?** One row per Tegula type, 1270 rows.

| verdict | types |
|---|---|
| possible | 409 |
| impossible | 362 |
| unknown | 499 |

Five types moved from `unknown` to `possible` on 2026-09-10 — see "Five new tilings" below. On
2026-09-13 #25539 followed (an m=11 tile, si15 or1 off3, confirmed by John).

**`data/census/` — among types already known to tile, which have anisohedral solutions?**
Re-run 2026-09-13: 7,161 rows over 386 types, m=3..8. Of those, **1,127 rows are anisohedral,
across 112 types.** 117 rows close but are **not a tile** -- their outline can't be made a simple
closed curve (John: "It has to be a simple closed curve boundary"). Anisohedral rows store the
member of their family with the most clearance, clear of 60/90/180-degree angles and near-equal
lengths where that is possible.

| m | rows | anisohedral rows | types |
|---|---|---|---|
| 3 | 171 | 0 | 0 |
| 4 | 682 | 6 | 3 |
| 5 | 433 | 47 | 18 |
| 6 | 1,305 | 126 | 41 |
| 7 | 1,694 | 407 | 79 |
| 8 | 2,876 | 541 | 84 |

What the 2026-09-13 run changed, compared with the 2026-09-10 census (7,210 rows, 1,106 anisohedral):
- **Develop-free.** No patch is developed and no overlap test is run: a closing tile with a simple
  boundary tiles the plane (covering theorem). Criteria and blocks come from the Delaney-Dress data,
  with exact angle algebra. Blocks go up to q'+r' tiles.
- **The solver rejects round-off closures.** A closure must be exact against the SHORTEST edge. This
  dropped fake near-closures, and it found a handful of real closures the old solver had stalled
  next to.
- **The ratio walk.** A shape stuck on the 0.05 edge-ratio floor is walked along its family to a
  moderate ratio (short/long about 0.25 or more).
- **"Is it a tile at all" is checked on every row.** `curve_sides.js` is the exact form of John's
  #3234 argument: a forced vertex sits on an edge whose curve would have to bulge two ways at once.
  70 of the 117 not-a-tile rows use its "outside" lemma, which John checked row by row; 4 more are
  exact without it; 21 are settled by John's newer rules (below). 22 are still "search, not
  proof": no curve was found that clears the outline, on the shape or anywhere else in its
  family. #3197 m6 si8 had been recorded as an isohedral tile.
- **John's rules for the whole family (2026-09-13).** Checked on every member of a row's family,
  on every solution branch reached, and only on members that close exactly:
  - *Fixed points collide.* Corners never move, an S curve always passes through its edge
    midpoint, an I edge never bends -- so two S midpoints at one point, an S midpoint or corner
    inside a straight edge, or two corners at one point make the boundary touch itself.
  - *No mirror.* If a reflection takes one edge's curve onto another's and the first edge's ends
    lie on opposite sides of the mirror line, the curve crosses the line at a point its mirror
    image also passes through.
  - *Folded S.* An S edge folded back at both ends onto equal straight edges, with the corners
    beyond them on the same side, would have to pass both over and under (uses the outside lemma).

  Neither of the first two fires on any shape the census counts as a tile. They settle 21 rows,
  including 18 of the 20 former tiles John could not solve by hand; #25525 m7 si14 is still open.
- **A stronger family search (later the same day).** John solved 8 search-only rows by hand; the
  search now finds all 8 itself, plus 3 he had not solved (#209162 m8 si0, #25552 m8 si2 or1 off5,
  #72951 m8 si10). Those 11 rows are tiles again; nothing else changed. A second, wider pass over
  the family's solution branches (run only when the first walk fails) then found #25552 m8 si2
  or1 off3 too, on a branch the first walk never reaches.
- **The ledger records how far each type has been searched for anisohedral tilings**
  (`aniso_search`: the census plus the per-type deep dives, and the sizes where anisohedral
  tilings turned up). The app's verdict box shows it.
- The rows whose verdict changed are listed by `tools/compare_census.js` against the old files.

The census swept 386 types. **385 of them are already `possible`; only 1 is unknown.** So the
census was never an attempt to resolve unknowns — it looked for anisohedral examples among tiles
already known to work. This matters for the unbalanced question below.

## Are the old results still valid?

Mostly yes, with one class of exception. Three bugs were found on 2026-09-09, and it is worth being
precise about what each one could and could not have corrupted.

**1. `develop()` placed some tiles twice.** Its "have I already filled this cell" test compared
centroids within `1e-3` of a tile diameter, but the placement transforms compound along the walk,
so a long walk drifted past that window and the same cell got filled twice. 80 of the 472 saved
tilings did this at 120 tiles.
*Affects:* anything that judged a large patch — overlap counts, and any "this tiling is bad"
verdict resting on one. *Does not affect:* closure, the isohedral criteria, or the anisohedral
verdicts, which are combinatorial and never look at a big patch.
*Fixed:* window is now `2e-2`, sitting in a measured gap between the worst drift (`5.3e-3` of a
diameter) and the closest genuine neighbour (`7.8e-2`).

**2. Checks ran on the straight-chord polygon when the tile is drawn with curves.** This one has now
bitten three separate checks — self-intersection, tile-vs-tile overlap, and most recently the vertex
figure. A corner the closing family forces flat is a cusp on the straight skeleton and a real open
corner once the curves are drawn, because a curve leaves its endpoint at an angle to its chord.
*Affects:* any pass/fail on a curved tile measured against the skeleton. *Does not affect:* results
about types whose edges are all type I (rigidly straight).
*Fixed:* `curved_overlap.js` for overlap; `TilerCurves.curveCornerAngles` + `vertexFigure`'s
`opts.cornerAngles` for the vertex figure.

**3. Stored shapes carry closure gaps that amplify.** A saved shape with a gap of only ~2.5e-4
develops into visible overlaps in the outer ring of a large patch, because `develop` composes one
transform per tile. *Affects:* pictures and overlap counts, not verdicts.
*Fixed for the two combos where it showed. **253 of the 472 saved combos still store a gap above
1e-6**, the largest at `8.6e-4`. When measured, all 472 then saved drew clean at 120 tiles (on 2026-09-14,
5 of the 852 now saved had begun to overlap; re-closed exactly, all 852 are clean), so this is latent, not
active — but it is the first thing to suspect if a tiling looks fine small and bad large.

**The one result that actually changed:** #25543 m7 si5 was the single row in the whole 1,106-row
anisohedral census flagged as having the wrong vertex figure. It was wrong for two compounding
reasons — the shape recorded for it sits on the 0.05 solver clamp, and the figure was read from
chord angles on a tile with a 0-degree corner. Measured correctly it reads {3,5}, which is exactly
what the type declares. **There is now no open vertex-figure flag in the census.**

(In the 2026-09-10 census, 100 of the 7,210 rows carried `vdeg_match = NO`, and only that one was an
anisohedral row. The 2026-09-13 re-run reads the vertex figure from the Delaney-Dress data instead of
a developed patch, and none of its 7,161 rows do.)

### One trap worth stating plainly

`criteria_m*.csv`'s `vertex_figure` column is what the sweep **measured**, on its own solved shape.
It is **not** the type's requirement. The requirement is the `vdeg` field on the type index, and
`vdeg_match` is the comparison of the two. Reading the measured column as the declaration produces
confident nonsense.

~~Also: `searched_to_m` in `ledger.json` is written as `cert.get('maxm', 8)`~~ — **fixed
2026-09-10**, see "Search coverage" below. The field is now null when nothing was recorded.

## Have the exploration methods changed?

Yes, in one substantial way: **checks became curve-aware.** For most of this project's life the
straight-chord polygon was used as a stand-in for the tile, and that is only valid when every edge
is type I. Three checks have now been converted. Anything else still working from
`TC.verticesOf(...)` should be treated as unconverted.

Two smaller shifts: overlap between drawn tiles is measured by **area** rather than by segment
crossings (neighbouring curved tiles share their common edge exactly, which drowns a crossing test
but contributes no area); and shapes are **re-projected onto exact closure** on load rather than
trusted as stored.

Nothing changed about how the anisohedral verdict itself is produced.

## Unbalanced tilings — unexplored until 2026-09-10, now searched at their four smallest sizes

"Unbalanced" here means the two orbits have different neighbour counts, q != r.

**586 of the 1270 types are unbalanced, and 298 of those are `unknown` — 51%.** They had never been
systematically searched. As of 2026-09-10 all 298 have been, at their four smallest realisable
sizes, and **not one of them yielded a tile: all 298 are still unknown.** Every one of the five
tilings found that day was balanced (four at 2:2, one at 3:3).

| \|q-r\| | types | still unknown |
|---|---|---|
| 1 | 139 | 70 |
| 2 | 244 | 152 |
| 3 | 109 | 41 |
| 4-6 | 69 | 27 |
| 7+ | 25 | 8 |

What the record looked like once the fake default was removed, and after the two search passes:

| | before 2026-09-10 | after |
|---|---|---|
| have a recorded search depth | 64 | **298** |
| no search on record at all | 234 | 0 |
| deepest size reached | — | m=6 to m=36 |

- **None of them appeared anywhere in the m=3..8 census.** That census covered 391 types, of which
  383 were already `possible` — it was looking for anisohedral examples among tiles known to tile,
  not resolving unknowns. This is why the unbalanced set had been missed.

That was the position before 2026-09-10. All 298 have since been searched at their four smallest
realisable sizes (see below) with no result. The largest single pockets:

| q:r | types | possible | unknown |
|---|---|---|---|
| 2:4 | 148 | 30 | 99 |
| 1:2 | 80 | 7 | 40 |
| 4:2 | 72 | 25 | 39 |
| 3:6 | 59 | 15 | 16 |
| 2:1 | 53 | 21 | 27 |

`2:4` alone holds 99 unknowns and was searched first. Each of the 99 got its own four smallest
sizes, which is a different depth per type because their smallest possible tile differs: 4 types
stopped at m=8, 15 at m=10, 27 at m=12, 19 at m=14, 7 at m=24, and so on. None yielded a tile. It
remains the obvious target for a deeper pass.

## Search coverage — fixed 2026-09-10

`searched_to_m` used to come from `build_ledger.py`'s `cert.get('maxm', 8)`, and nothing wrote
`maxm` until 2026-09-05. So every unknown claimed a search to m=8 whether or not one had run, and
"searched and found nothing" was indistinguishable from "never looked".

What changed:

- **`engine/certify.js` records what it covered** — `searched: {from_m, to_m, sizes, covered}` — and
  only reports a `maxm` when the loop actually executed. When a type's smallest tile has more sides
  than the run reached, the loop body never runs, and that is now visible instead of being papered
  over with an 8.
- **`py/build_ledger.py` no longer invents a number.** `searched_to_m` is null when nothing was
  recorded, with `search_recorded: false` alongside it.
- **`first_m` is now in every row** — the smallest m at which the type has any sum-types, generated
  by `engine/_dev_isohedral/gen_first_m.js`. Without it a depth cannot be interpreted: **113 types
  have their smallest possible tile above m=8**, so a search to 8 could not have touched them.
- **`never_searched`** distinguishes two things that were being conflated: `true` means a real
  search ran and stopped below the type's smallest tile (provable); `null` means nothing is on
  record either way. Only the first is a claim about the search.

### And then the gap was filled

With the field made honest, the missing coverage was easy to supply. `certify.js --sizes=2` searches
the two smallest sizes that ACTUALLY HAVE sum-types (a global `maxm` cannot express that: a type
whose smallest tile has 24 sides would drag every other type through m=3..24). Run over all 908
non-impossible types on 2026-09-10 — **48 seconds**.

**Every one of the 505 unknowns now has a real, measured search depth, up from 67.** For the
unbalanced unknowns specifically: 298 of 298, up from 64. No verdict and no evidence level moved,
verified row by row.

Depths are now spread across m=4..36 instead of a uniform fake 8. Note that 131 unknowns do sit at
m=8 — but that is now a measurement rather than a default.

Of the 908 types, 348 stopped after one size because they found a non-degenerate witness whose
vertex figure matches, which settles the type; the other 559 got both sizes. Nothing hit the
per-type budget.

**Four L2 witnesses were found and none adopted.** All four are non-tiles: #25470 and #25515 have
a 0.00-degree spike and a vertex figure that does not match the type, #1726809 a 0.03-degree spike
on a 0.12 edge ratio, #1727264 a 2.91-degree spike. They are recorded as `degenerate_l2` notes for
a person to judge. Adopting an L2 means adopting verdict `possible`, so this needs a human eye
every time — an earlier adoption pass hit the same trap with a collapsed 15-gon on #1726781.

Read it as: the 505 unknowns have now all actually been looked at, at least at their two smallest
realisable sizes, and none of them yielded a genuine tile.

## The patch-size problem is solved

Every check above that judged a tiling on a big developed patch was fighting the same thing:
`develop()` composes one transform per tile, so error grows with the patch, and the test is
O(n^2) polygon clips.

`translation_block.js` replaces it. It reads the tiling's translation lattice off the developed
patch, takes the handful of tiles in one lattice cell, and checks two things: no two of them
overlap, and their areas sum to the cell's area. That single identity forbids both gaps and
overlaps, and it is checked on **2 to 12 tiles** rather than 120 or 800.

Measured block sizes across the 472 combos: 2 tiles (36), 4 (220), 6 (3), 8 (144), 12 (1).

Current state: **404 pass, 4 fail, 64 no-lattice.** 59 of the 68 non-passing are deep-dive combos
already excluded from the gallery; only 9 ordinary combos do not pass. The control is two-sided —
6 of 6 known-good tilings pass and 0 of 4 known-broken tilings pass. See `TODO.md` for what is left.

The area identity is curve-independent (a bulge out of one tile is the bite out of its neighbour),
so only the overlap half needs the curved test.

## Five new tilings — 2026-09-10

The `--sizes=4` pass (four smallest realisable sizes, all 908 non-impossible types, 4.4 minutes)
found 11 clean-patch witnesses on types recorded `unknown`. Six were degenerate — 0.00 or 0.03
degree spikes, or a vertex figure that does not match the type. **Five were real, and John
confirmed all five by eye:**

All five are BALANCED types (q = r). The unbalanced set produced nothing.

| type | q:r | combo | min angle | translation block |
|---|---|---|---|---|
| #25531 | 2:2 | m7 si0 or0 off0 | 23.91 deg | 8 tiles |
| #72917 | 2:2 | m9 si7 or1 off7 | 8.13 deg | 8 tiles |
| #209056 | 3:3 | m8 si9 or0 off1 | 17.07 deg | 4 tiles |
| #209082 | 2:2 | m9 si9 or0 off5 | 56.02 deg | 4 tiles |
| #209085 | 2:2 | m9 si9 or0 off8 | 43.20 deg | 4 tiles |

Each was re-derived independently from its stored shape rather than trusted from the search's own
report, and had to pass all of: exact closure, a non-degenerate tile (no sub-3-degree spike, no
edge on the 0.05/0.02 solver clamp), the type's own vertex figure on a 200-tile patch, zero overlap
at 60/200/400 tiles, and **a block of tiles that tiles by pure translation** — the exact test
rather than an overlap count. Shapes are in `data/witnesses_2026-09-10/`.

John reworked two: #209085's proportions (minimum angle 17.8 -> 43.2 degrees, minimum edge ratio
0.13 -> 0.25) and #209056's J curves. Those are the shapes stored.

**#25531 had been stuck at L1 while John read its drawn tiling as good.** The cause was `develop()`
placing duplicate tiles — its dedup window was narrower than the drift that compounds along the
placement walk, so stacked duplicates were counted as overlaps. Fixed 2026-09-09; this type is what
that fix was blocking.

### How a verdict is allowed to move

Only `py/adopt_new_witnesses.js` moves one, and it is a deliberate separate step. Every coverage
merge refuses to raise an evidence level, because `build_ledger.py` turns any L2 into verdict
`possible` and a degenerate tile that happens to develop a clean patch would otherwise flip a
verdict silently — the same run produced eight such non-tiles, and they stayed `unknown`.

Two habits worth keeping, both learned the hard way here:

- **Re-close a witness before judging it.** `solveTile` stops at relGap < 0.008. #25531 arrived at
  2.8e-6, enough to make its translation block over-count 75 tiles against a cell holding 8;
  re-closed to 8.4e-13 it passed everything. A good witness can look broken purely from stored
  precision.
- **A degeneracy screen is not optional.** Six of the eleven finds were non-tiles.
