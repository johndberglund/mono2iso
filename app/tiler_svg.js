// Standalone SVG rendering of a developed tile patch. Pure computation, no DOM — runs
// identically in the browser (mono2iso.js's save-as-SVG button) and under Node (gallery
// picture generation), same reason tiler_core.js/tiler_curves.js are UMD.
(function (root) {
  'use strict';

  // draw = [{orbit, pts:[[x,y],...]}, ...] — one filled polygon per developed tile, as
  // produced by placed.map(t=>({orbit:t.orbit,pts:t.verts})) or TilerCurves.buildCurvedTiles.
  function tilesToSVG(draw) {
    const xs = draw.flatMap(t => t.pts.map(p => p[0])), ys = draw.flatMap(t => t.pts.map(p => p[1]));
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const pad = 0.4, W = maxx - minx + 2 * pad, H = maxy - miny + 2 * pad, sw = Math.max(W, H) / 600, cols = ['#bcd9ff', '#ffd9a8'];
    const X = x => (x - minx + pad).toFixed(4), Y = y => (maxy - y + pad).toFixed(4);          // flip y to match the canvas
    let body = '';
    draw.forEach(t => { const pts = t.pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ');
      body += `  <polygon points="${pts}" fill="${cols[t.orbit]}" stroke="#333" stroke-width="${sw.toFixed(4)}" stroke-linejoin="round"/>\n`; });
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}" width="1000" height="${Math.round(1000 * H / W)}">\n` +
      `  <rect x="0" y="0" width="${W.toFixed(4)}" height="${H.toFixed(4)}" fill="#fafafa"/>\n` + body + `</svg>\n`;
  }

  const api = { tilesToSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TilerSVG = api;
})(typeof window !== 'undefined' ? window : this);
