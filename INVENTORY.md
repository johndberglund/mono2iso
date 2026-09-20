# What came across, and what did not

`program4` holds 5,194 files. Most of it is working residue: one-off analysis scripts, superseded
result files, timestamped backups, and 3.9 GB of third-party source. This directory is the part
worth handing to someone else.

## Brought over (29 MB)

| | what | why |
|---|---|---|
| `app/` | `mono2iso.html` + the 20 scripts it loads | the whole application; verified to run standalone from this directory |
| `index/cells/` | 1,270 type figures, 27 MB | the picture picker needs them; without them that mode silently shows nothing |
| `data/combos/` | 852 combos + SVGs | worked tilings including hand-drawn curves. `tools/check_as_loaded.js` (2026-09-14): all 852 draw clean at 120 tiles. Five (#72788 m8 si42 off5 and si38 off7, #25543 m5 si0, #25635 m8 si4, #601097 m8 si8) were re-closed exactly that day at John's request -- they had been saved from rounded angles; originals in `program4/archive/combos_before_reclose_2026-09-14/` |
| `data/census/` | `criteria_m3..m8.csv` | the anisohedral census, 7,161 rows -- re-run 2026-09-13 on the develop-free route |
| `data/ledger.json` | 1,270 type verdicts | the canonical verdict file |
| `docs/` | walkthrough, criteria, notes | `match Tiling.pdf` is the one to read first |
| `tools/` | 12 node scripts | checking and regeneration, listed below |

### The app's file list

`mono2iso.html` loads exactly these, in order: `verdicts.js`, `tiling_checks.js`, `cells_map.js`,
`gallery_manifest.js`, `allTypes.js`, `aniso.js`, `templates.js`, `tiler_core_revpivot.js`,
`tiler_curves.js`, `curve_designer.js`, `tile_designer.js`, `curve_sides.js`, `tiler_svg.js`,
`overlap_strict.js`, `isohedral_criteria.js`, `angle_algebra.js`, `isohedral_criteria_fast.js`,
`tile_symmetry.js`, `dd_patch.js`, `isohedral_block.js`, `mono2iso.js`.

`overlap_strict.js` is loaded only for the full view's drawing self-check; no verdict depends on it
any more. Removed 2026-09-13 as unused: `app/curved_overlap.js`, `app/translation_block.js`,
`app/tiler_core.js` (the page runs the `tiler_core_revpivot.js` fork), `tools/lib/tiler_core_revpivot.js`,
`data/combo_impossible_notes.json` (the census now proves that row itself), and the translation-block
check (`check_translation_block.js`, `tb_control.js`, `lib/translation_block.js` -- it never passed
its own control, and the DD block search does that job).

Two of these are data blobs rather than code: `templates.js` (864 KB on one line) and
`gallery_manifest.js` (296 KB).

### Keeping this directory current

Everything here that has a program4 source is refreshed by **`node sync.js`** in program4 (add
`--dry-run` to see what would change without writing anything). It rebuilds the ledger and the
files generated from it, then copies into this directory: `data/ledger.json`, `app/verdicts.js`,
the census, the saved combos, the generated tools (`sweep_aniso.js` and its helpers), and the
modules carried verbatim. Files adapted for this directory (re-pathed tools, `test_harness.js`,
`gen_gallery.js`, a few comment edits) are never overwritten -- the sync reports it if their code
drifts from program4's. Edit the program4 sources, not the copies here.

### The tools

| script | what it does |
|---|---|
| `check_as_loaded.js` | draws every combo the way the app does when you click a gallery image — the end-to-end check |
| `gen_gallery.js` | regenerates the gallery SVGs and repairs curves |
| `calibrate_dedup.js` | recalibrates `develop()`'s duplicate-placement window; run it if that constant is ever touched |
| `control_patch_growth.js` | the control: do known-good tilings stay clean as the patch grows |
| `gallery_sliders.js` | counts true-parameter sliders per combo |
| `design_curves.js` | automatic curve designer, and `--validate` against hand-drawn curves |
| `sweep_aniso.js` | the census sweep, on the develop-free route (`lib/dd_route.js`): writes `data/census/` |
| `deep_check_child.js` | one deep single-tile check in its own process, for `sweep_aniso.js --deep-budget` |
| `compare_census.js` | row-by-row diff of two census CSVs (verdicts, criteria, blocks) |
| `verify_curve_sides.js` | re-checks every exact "not a tile" census row against the curve designer's search |
| `reduce_combo.js` | finds how to redraw a tiling with fewer edges |
| `lib/` | the node-side engine modules the tools load |

The tools are re-pathed for this directory and run here as-is:

    cd program5/tools && node check_as_loaded.js

`test_harness.js` and the engine modules the tools need live in `tools/lib/`. Note that the tools
load `tiler_core.js` while the *app* loads `tiler_core_revpivot.js` — see the fork note below.

## Deliberately left behind

**Third-party sources, 3.9 GB.** `references/Tegula` alone is 3.9 GB, plus `tactile-js`, `orbiGit`,
Myers' and Church's papers. All are external and separately obtainable. If any of it is needed
again it should be re-fetched, not carried.

**222 one-off scripts** in `engine/_dev_isohedral/` plus 110 JSON result files and 22 logs. These are
the record of individual investigations — degenerate-row walks, timeout triage, witness audits,
containment sweeps. They were correct for their moment and are not maintained. The nine that stayed
are the ones with ongoing use.

**Backups and superseded records** -- all moved into `program4/archive/` on 2026-09-13, with
a README there listing each: six `py/_backup_*` directories, `combos_backup_pre_redo/`, every
`.bak_*` file, the superseded census passes (`criteria_m7.presl.csv`, `criteria_m8.presl.csv`,
`criteria_m8.uncorrected.csv`, `criteria_m8.unbudgeted.partial.csv`, the pre-develop-free census),
and the older certify runs already merged into `certify_results.json`.

**The other two applications.** `engine/netshape.html` (containment and impossibility proofs) and
`engine/tiler.html` are separate tools with their own dependency set — `dsym_edit.js`,
`dsym_geom.js`, `dsym_disk.js`, `dsym_deform.js`, `dsym_types.js`, `tiler_core.js`. They produced
much of the `impossible` verdict work and the proof pictures in `netshape pix proofs/` (560 files,
55 MB). Left out because the request was to prepare *the app* for sharing, and bringing them means
bringing a second, differently-shaped codebase. **This is a decision to confirm, not a conclusion.**

**Picture archives:** `renders_good/` (383 files), `netshape pix/` (75), `netshape pix proofs/`
(560), and the loose `netshape-*.svg` at the top level.

## Two forks to be aware of

These are real duplications in the codebase, not backups, and both are live:

- **`tiler_core.js` vs `tiler_core_revpivot.js`** — the app loads `revpivot`; `netshape.html` and
  most node tools load the other. They have diverged. Today's `develop()` dedup fix was applied to
  **both** deliberately.
- **`isohedral_criteria.js` vs `isohedral_criteria_fast.js`** — both are loaded by the app.
  Likewise `aniso.js` / `aniso_fast.js`, of which the app loads only `aniso.js`.

Consolidating these is the single largest cleanup available, and the riskiest, because the forks
are what several results were computed with.

## Known stale

- `index/ledger.js` (dated 2026-08-17) drifted from `py/ledger.json` (2026-09-06). **`ledger.json`
  is canonical**; `index/ledger.js` was not brought over.
- `ledger.json`'s `searched_to_m` defaults to 8 when no certificate exists, so it does not
  distinguish "searched and found nothing" from "never looked". See `STATUS.md`.
