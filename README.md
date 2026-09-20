# 2-isohedral monohedral tiling explorer

A tool for finding and drawing **2-isohedral monohedral tilings** of the Euclidean plane: tilings
by a single tile shape where the tiles fall into exactly two orbits under the symmetry group.

There are 1270 such combinatorial types (the Tegula classification). This app lets you pick a type,
choose how many sides the tile has, solve for a tile shape that closes up, curve the edges, and see
the tiling developed across the plane.

## Running it

It is a static page — no build step and no server-side code.

    cd program5
    python -m http.server 8000

then open <http://127.0.0.1:8000/app/mono2iso.html>.

A plain `file://` open mostly works too, but the type-picture panel needs the images under
`index/cells/`, and some browsers block those over `file://`. Serving it avoids that.

## Start on a particular tiling — deep links

The app reads the URL, so a tiling can be handed to someone as a link instead of a file.

**By coordinates** — short, readable, and uses the same names as every CSV and filename here:

    app/mono2iso.html?id=25643&m=7&si=16&or=0&off=4&view=full&curves=0

| param | meaning |
|---|---|
| `id` | Tegula type number |
| `m` | number of sides on the tile |
| `si` | which sum-type, as an index into the type's sum-type list at that size |
| `sum` | alternative to `si`: the sum-type by value, e.g. `sum=[1,2,0,0,1]` |
| `or` | 0 or 1 — orientation (reflected or not) |
| `off` | offset, 0 .. m-1 |
| `view` | `full` (the tiling) or `tiles` (one tile per orbit) |
| `curves` | `1` to draw curved edges |

The shape is solved fresh on open, so this form says *which combo*, not *which exact shape*.

**By whole combo** — carries the shape and any hand-drawn curve points, so it reproduces an exact
picture:

    app/mono2iso.html#c=<base64url of a combo JSON>

Any combo file in `data/combos/` can be turned into one of these. It sits in the `#` fragment, so
it is never sent to a server.

The **`link`** button in the toolbar copies a link to whatever is on screen: plain click for the
short coordinate form, shift-click for the exact-shape form.

Shapes arriving from a link are projected back onto exact closure before being drawn. This matters:
a stored closure gap of only ~2.5e-4 develops into visible overlaps out in a large patch.

## How to use it

`docs/match Tiling.pdf` is the walkthrough: it starts from a picture of a real tiling and shows how
to identify its type, enter it, find the combo, and slide the parameters until the drawn tiling
matches. The short version:

1. Count the tiles' neighbours per orbit and read off the orbifold. Enter them as `k_q n_r` and
   filter by orbifold, in **pick a type by picture** mode.
2. Set the number of sides, then use **find combo by side sizes** with the edge counts per orbit.
3. Cycle the results. **true parameters** gives you the sliders that actually change the shape;
   **raw sliders** plus **re-auto-solve** is the fallback when the closing family cannot be
   parameterised.
4. **reduce**, when offered, redraws the same tiling with fewer edges and turns the corners into
   draggable curve control points.

## What is in here

| | |
|---|---|
| `app/` | the whole application — one HTML file and the 20 scripts it loads |
| `index/cells/` | one figure per type, for the picture picker (27 MB) |
| `data/combos/` | 852 worked tilings, with the curve designs, plus an SVG of each |
| `data/census/` | the m=3..8 anisohedral census, one CSV per size |
| `data/ledger.json` | the verdict for all 1270 types |
| `docs/` | the walkthrough, the isohedral criteria, working notes |
| `tools/` | node scripts for checking and regenerating the above |

`STATUS.md` says what the results currently mean and how far they have actually been taken.
`INVENTORY.md` lists what was brought over from the old working directory and what was left behind.
