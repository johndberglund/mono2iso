# To do / to clean up

Ordered by how much it matters, not by effort. Items marked **[decide]** need your call rather than
work.

## Before sharing this with anyone

1. ~~**[decide] The page is called "tiler test — diagnostics".**~~ **DONE 2026-09-13.** Renamed
   to **mono2iso** (John): `app/mono2iso.html` + `app/mono2iso.js`, title "mono2iso — 2-isohedral
   monohedral tilings". The developer views "net data", "edge sizes", "Delaney–Dress symbol" and
   "net diagram" are gone from this copy (engine/tilerTest.html keeps them). Still open: the
   on-screen "CONFIG / angle eqs" block shows the raw constraint matrix.
2. **[decide] Do `netshape.html` and `tiler.html` come too?** They are a separate tool with their
   own `dsym_*` dependency set, and they produced much of the impossibility work. See
   `INVENTORY.md`. Right now they are not in this directory.
3. **Tools re-pathed.** The tools read `tools/lib/` and `data/`. `sweep_aniso.js` and its helpers
   (`deep_check_child.js`, `compare_census.js`, `verify_curve_sides.js`) were regenerated from
   program4 on 2026-09-13 with their paths re-pointed; edit the program4 originals and regenerate.
4. **Wire `curved_overlap.js` into the app.** The browser and the gallery generator currently judge
   tile overlap by different methods. The area-based one is the tested one.

## Correctness

5. **253 of the 472 combos store a closure gap above 1e-6**, the largest `8.6e-4`. All 472 drew
   clean at 120 tiles when measured. On 2026-09-14 this gap did show: 5 of the 852 now saved
   overlapped at 120 tiles. John had them re-closed (angles like 18.43 were rounded atan(1/3));
   all 852 are clean again. Re-closing the rest is the same one-line projection
   that fixed #209100 and #209087, and moves each shape by less than its own gap. Not done because
   it rewrites 253 of your files. Back them up first.
6. ~~**`searched_to_m` defaults to 8.**~~ **DONE 2026-09-10.** `certify.js` now records
   `searched: {from_m, to_m, sizes, covered}`; `build_ledger.py` emits null rather than 8; every
   row carries `first_m` (smallest realisable size, from `gen_first_m.js`) and a `never_searched`
   flag that separates "proven too shallow" from "nothing on record". 67 of the 505 unknowns have
   a recorded depth, 438 do not. No verdict or evidence level moved. See `STATUS.md`.
7. **Finish making the checkers curve-aware.** Self-intersection, tile overlap and vertex figure are
   converted. Anything else working from `TC.verticesOf(...)` is not. This mistake has now been made
   three separate times in three separate checks.
8. **`engine/translation_block.js` does not work** — lattice extraction fails its own control. The
   idea is sound and would replace 120-tile patch checks with an exact one: find the block of tiles
   that repeats by pure translation, which should never need more than ~24-48 tiles. Suggested
   route is to derive the lattice from the Delaney-Dress symbol rather than from the developed
   patch.

## Research

9. **Unknowns — four smallest sizes DONE (2026-09-10), and it found five tilings.**
   `--sizes=2` then `--sizes=4` over all 908 non-impossible types (48 s and 4.4 min respectively).
   All 505 unknowns now carry a real recorded depth spanning m=6..36, 248 of them to m>=12, and
   **five types moved `unknown` -> `possible`** (#25531, #72917, #209056, #209082, #209085 — see
   `STATUS.md`). 500 unknowns remain.

   **All five new tilings are BALANCED (q = r). The unbalanced set yielded nothing** — its 298
   unknowns are still 298, now each searched at its four smallest sizes.

   Next: `--sizes=6`, or a targeted deeper run on one ratio. The machinery takes any N and is
   resumable, so this is cheap to extend — but watch the per-type budget, cost climbs steeply
   with m. The `2:4` pocket still holds 99 unknowns; each has had its own four smallest sizes,
   which lands at a different m per type (4 stopped at m=8, 27 at m=12, 7 at m=24).
10. **Point the curve designer at the unsolved combos.** It beats the hand-drawn curve on 11 of 14
    of yours and reaches ~70% on the three hardest, so it is worth running but not worth letting it
    overwrite anything you drew. Candidates noted earlier: `209232_m7_si0_or1_off2`, `25643 si18`.
11. **#1727308's slider count.** You saw it drop from two sliders to one after re-solving through
    raw sliders; sampling 60 points on its family finds 2 everywhere. Either the app picks drivers
    differently from `TilerCore.pickDrivers` or your re-solve reached somewhere the sampling did
    not. Worth knowing before trusting the per-combo slider counts precisely.

## Cleanup in `program4` itself

12. **Two live forks.** `tiler_core.js` / `tiler_core_revpivot.js`, and
    `isohedral_criteria.js` / `isohedral_criteria_fast.js` (plus `aniso.js` / `aniso_fast.js`).
    Consolidating is the biggest available cleanup and the riskiest, since results were computed
    against particular sides of these forks.
13. **Superseded census files** sitting beside the current ones: `criteria_m7.presl.csv`,
    `criteria_m8.presl.csv`, `criteria_m8.uncorrected.csv`, `criteria_m8.unbudgeted.partial.csv`.
14. **`index/ledger.js` is stale** (2026-08-17 vs `py/ledger.json` 2026-09-06) and hand-maintained.
    Either regenerate it from `ledger.json` or delete it.
15. **222 one-off scripts and 110 result JSONs** in `engine/_dev_isohedral/`, six `py/_backup_*`
    directories, ~24 `.bak_YYYYMMDD` files. Nothing depends on them.

## Settled — no longer open

- The vertex-figure flag on **#25543 m7 si5**: it matches. That was the last `vdeg NO` among the
  1,106 anisohedral census rows.
- **#209516 m8 si7** and **#209194 m8 si1**: both verified, both match their declared figure.
- The gallery: **852 of 852** clean at 120 tiles when opened the way a reader opens them
  (2026-09-14, after re-closing the 5 that had begun to overlap).

---

## Translation-block check — built 2026-09-10, working

Your plan, implemented in `engine/translation_block.js` with `_dev_isohedral/tb_control.js` as the
two-sided control and `_dev_isohedral/check_translation_block.js` as the sweep.

**Result on the 472 combos: 404 pass, 4 fail, 64 no-lattice, 0 error.**
Block sizes: 2 tiles (36 combos), 4 (220), 6 (3), 8 (144), 12 (1) — your "usually two tiles, but for
unbalanced it can be more", and never more than 12.

**Control: 6 of 6 known-good tilings pass; 0 of 4 known-broken tilings pass.** The broken cases are
real ones — tiles that close, do not self-intersect, and whose tilings genuinely collide — not an
angle bent by hand, which turned out to prove nothing because it opens the tile without making the
tiling collide.

How it ended up working:

- The lattice is read off the developed patch rather than from the criterion table, so it does not
  depend on getting a table right and behaves the same for the unbalanced types where the block is
  bigger.
- "No gaps and no overlaps" is one equation: tiles of a cell must not overlap, and their areas must
  sum to the cell's area. That identity is also curve-independent — every bulge out of one tile is
  the matching bite out of its neighbour — so only the overlap half needs the curved test.
- A lattice cell must contain a whole number of tiles. That self-check is what catches a wrong
  basis, and it fires rather than reporting a verdict.

Four mistakes were needed to get there, all found by measurement, and all worth remembering:

1. **Negative zero split the identity.** develop() emits both `0` and `-0`, so `"0.000000"` and
   `"-0.000000"` were different keys and one orientation counted as three. #209087 reported a
   19-tile block where the lattice says 8.
2. **A vector between two tiles is not a symmetry.** Collecting every `v` with "base tile + v is a
   tile" gives a set that is not a group; on #25521 it produced a lattice with half the true cell.
   Each candidate now has to map EVERY tile onto a tile of the same orientation — your "the boundary
   matches up by translation", made into a test.
3. **Tiles were matched by the wrong point.** The transform's translation component is where the
   origin lands, i.e. the tile's vertex 0 — and every tile around a shared vertex has the same one,
   so the lookup returned an arbitrary neighbour. Matching by CENTROID fixed it. Until then every
   candidate on #1727308 looked half-contradicted, including the genuine symmetries.
4. **Stored drift manufactures a fake lattice vector.** A 2.6e-4 closure gap makes develop() emit
   the same translation twice at slightly different lengths, and their difference becomes a tiny
   spurious basis vector that collapses the cell. Shapes are re-closed before the check.

### What the 68 non-passing actually are

**59 of the 68 are deep-dive combos** — `DEEP_*`, `UNBAL_*`, `WEIRD_*` — which are the reducible
entries already excluded from the gallery. Only **9 ordinary combos** do not pass:

| combo | outcome |
|---|---|
| `1512` at m=6, 12, 24, 60 | no translation subgroup visible — the whole type, at every size |
| `3215_m9_si0_or1_off0` | no translation subgroup visible |
| `208907 si0/si2`, `208908 si0/si2` | found 4 (or 6) distinct tiles but the cell holds 2 |

- **The 4 FAILs** have the over-count signature of bug 2, so there is probably one more index-2 case
  the symmetry filter is not catching. All four draw clean under every other check.
- **`1512` and `3215`** fail at every size, which points at the type rather than the shape. `1512`
  is also in the rigid-shape list, so there may be something structural worth looking at.
- **Patch size is NOT the explanation for the deep combos.** `DEEP_25638_m12_si5` has a perfect
  5.9e-16 closure gap and still reports "translations all parallel" at 200, 400, 800 and 1600
  tiles. In a 74x77 patch all 14 of its verified symmetry vectors are integer multiples of (3,3) —
  genuinely rank 1. Either its second period is carried by a glide or rotation rather than a pure
  translation, or the straight skeleton of that combo does not tile and only the curved version
  does (which is what the note on #25638 says: "m=12 only via its U curve"). Worth resolving,
  because it decides whether "no lattice" can be read as "does not tile".
- **Wire it in.** It should replace the 120-tile check in `check_as_loaded.js` and the gallery
  generator once the two items above are settled. It is exact and needs ~2-12 tiles instead of 120.
- **Then it answers the isohedral question too.** A block that tiles by translation, together with
  the criterion match, is what "this shape tiles the plane" means — so this can become the
  certificate rather than just a check.
