// program5 copy: generated from program4/engine/_dev_isohedral/compare_census.js with paths re-pointed at
// tools/lib/ and data/ (2026-09-13). Edit the program4 original and regenerate, not this copy.
// Compare two census CSVs (criteria_m<M>.csv) row by row, keyed on (id, m, si, orient, off):
// every change in single-tile criteria, anisohedral verdict, and block size/criteria, plus rows
// only in one of the two.     node compare_census.js <old.csv> <new.csv> [--verbose]
const fs = require('fs');
const [oldF, newF] = process.argv.slice(2, 4);
const VERBOSE = process.argv.includes('--verbose');
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
function load(file) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8')), hdr = rows[0], out = new Map();
  for (const r of rows.slice(1)) {
    if (r.length < hdr.length) continue;
    const o = {}; hdr.forEach((h, i) => { o[h] = r[i]; });
    out.set([o.id, o.m, o.si, o.orient, o.off].join('|'), o);
  }
  return out;
}
const A = load(oldF), B = load(newF);
const kind = o => o.aniso === 'YES' ? 'ANISO' : (o.aniso || '').startsWith('no') ? 'iso' : (o.aniso || '').startsWith('n/a') ? 'n/a' : (o.aniso || '?');
const t = { same: 0, onlyOld: [], onlyNew: [], verdict: [], iso: [], block: [] };
for (const [k, a] of A) {
  const b = B.get(k);
  if (!b) { t.onlyOld.push(k); continue; }
  let diff = false;
  if (kind(a) !== kind(b)) { t.verdict.push(`${k}  ${a.aniso} -> ${b.aniso}`); diff = true; }
  if ((a.iso_criteria || '') !== (b.iso_criteria || '')) { t.iso.push(`${k}  iso [${a.iso_criteria}] -> [${b.iso_criteria}]`); diff = true; }
  if (kind(a) === 'ANISO' && kind(b) === 'ANISO' && ((a.min_block || '') !== (b.min_block || '') || (a.block_criteria || '') !== (b.block_criteria || ''))) {
    t.block.push(`${k}  block ${a.min_block || '-'} [${a.block_criteria}] -> ${b.min_block || '-'} [${b.block_criteria}] (bound ${b.block_bound})`); diff = true;
  }
  if (!diff) t.same++;
}
for (const k of B.keys()) if (!A.has(k)) t.onlyNew.push(k);
console.log(`${oldF}  vs  ${newF}`);
console.log(`  rows: old ${A.size}, new ${B.size};  unchanged ${t.same}`);
console.log(`  verdict changed ${t.verdict.length};  single-tile criteria changed ${t.iso.length};  block changed ${t.block.length};  only in old ${t.onlyOld.length};  only in new ${t.onlyNew.length}`);
const show = (name, list) => { if (!list.length) return; console.log(`\n  ${name}:`); for (const l of list.slice(0, VERBOSE ? 5000 : 25)) console.log('    ' + l); if (list.length > 25 && !VERBOSE) console.log(`    ...and ${list.length - 25} more`); };
show('verdict changed', t.verdict); show('single-tile criteria changed', t.iso); show('block changed', t.block);
show('only in old', t.onlyOld); show('only in new', t.onlyNew);
