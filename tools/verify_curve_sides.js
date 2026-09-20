// program5 copy: generated from program4/engine/_dev_isohedral/verify_curve_sides.js with paths re-pointed at
// tools/lib/ and data/ (2026-09-13). Edit the program4 original and regenerate, not this copy.
// Soundness cross-check for curve_sides.js's exact check (John's #3234 argument, automated,
// 2026-09-13): re-solve every "not a tile" row in the given criteria_m<M>.csv whose reason came
// from curve_sides (tagged "[curve_sides]"), and confirm the general designCurves SEARCH agrees
// -- finds no clearance either (clearance <= 1e-4). A contradiction (search finds a real curve
// where the exact check claims impossible) is a bug, not a difference of opinion: stop and report
// it, per the plan's verification section.
//     node verify_curve_sides.js <criteria_m*.csv> [more.csv ...]
const fs = require('fs');
const H = require(__dirname + '/lib/test_harness.js');
const TC = H.TC;
const TD = require(__dirname + '/lib/tile_designer.js');

function parseCSV(txt) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

let checked = 0, contradictions = [];
for (const file of process.argv.slice(2)) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8')), hdr = rows[0];
  for (const r of rows.slice(1)) {
    if (r.length < hdr.length) continue;
    const o = {}; hdr.forEach((h, i) => { o[h] = r[i]; });
    if (!(o.aniso || '').includes('[curve_sides]')) continue;
    checked++;
    H.loadType(+o.id);
    const sumStr = null;
    let cfg; try { cfg = H.config(+o.id, +o.m, +o.orient, +o.off, +o.si); } catch (e) { cfg = null; }
    if (!cfg || !cfg.whichEdge) { contradictions.push(`${file}: #${o.id} m${o.m} si${o.si} -- config unavailable for re-check`); continue; }
    const groups = H.lenGroups(cfg.whichEdge, +o.m);
    const sol = TC.solveTile(cfg.eqs, groups, +o.m, { edgeSym: cfg.edgeSym });
    if (!sol || !sol.ok) { contradictions.push(`${file}: #${o.id} m${o.m} si${o.si} -- solve failed on re-check`); continue; }
    const ctx = { TC, m: +o.m, edgeSym: cfg.edgeSym, whichEdge: cfg.whichEdge, mapping: cfg.mapping, groups, eqs: cfg.eqs };
    const dg = TD.diagnose({}, ctx, sol.A, sol.L);
    if (dg.verdict !== 'curves required') { contradictions.push(`${file}: #${o.id} m${o.m} si${o.si} -- diagnose no longer says curves required (${dg.verdict})`); continue; }
    const dc = TD.designCurves({}, ctx, sol.A, sol.L, {}, dg, { starts: 24 });
    if (dc.clearance > 1e-4) {
      contradictions.push(`${file}: #${o.id} m${o.m} si${o.si} or${o.orient} off${o.off} -- SEARCH FOUND clearance ${dc.clearance.toExponential(2)}, contradicts exact verdict`);
    }
  }
}
console.log(`checked ${checked} curve_sides "not a tile" rows across ${process.argv.length - 2} file(s)`);
if (contradictions.length) {
  console.log(`\n${contradictions.length} CONTRADICTION(S):`);
  contradictions.forEach(c => console.log('  ' + c));
  process.exitCode = 1;
} else {
  console.log('0 contradictions -- every exact "not a tile" verdict agrees with the general search.');
}
