# 2-isohedral monohedral tiling explorer

A tool for finding and drawing **2-isohedral monohedral tilings** of the Euclidean plane: tilings
by a single tile shape where the tiles fall into exactly two orbits under the symmetry group.

There are 1270 such combinatorial types (the Tegula classification). This app lets you pick a type,
choose how many sides the tile has, solve for a tile shape that closes up, curve the edges, and see
the tiling developed across the plane.

"mono2iso.pdf" is the walkthrough: it different ways to use the app.

The **`link`** button in the toolbar copies a link to whatever is on screen: plain click for the
short coordinate form, shift-click for the exact-shape form.

Shapes arriving from a link are projected back onto exact closure before being drawn. This matters:
a stored closure gap of only ~2.5e-4 develops into visible overlaps out in a large patch.

**************

A big thank you to Olaf Delgado, Daniel Huson & Elizaveta Zamorzaeva for “The classification of 2-
isohedral tilings of the plane.” This article lists the 1270 types and started me exploring this area. I also
stole the pictures from this article to illustrate the app.

This app started with the algorithm I gave at https://johndberglund.github.io/anisohedral/algorithm.html
I worked with Claude AI to expand this to a workable program. It's still a work in progress.

Another big thank you to Daniel Huson, Rüdiger Zeller, and Klaus Westphal for program Tegula. I
stole the Delauney-Dress symbols from their database. I also use their Tegula numbering system as a
shortcut in my app. Here's a link:
https://uni-tuebingen.de/en/fakultaeten/mathematisch-naturwissenschaftlichefakultaet/
fachbereiche/informatik/lehrstuehle/algorithms-in-bioinformatics/software/tegula/
This let's you explore many more types of symmetry patterns beyond the 2-isohedral ones.



