// program5 copy: generated from program4/engine/_dev_isohedral/deep_check_child.js with paths re-pointed at
// tools/lib/ and data/ (2026-09-13). Edit the program4 original and regenerate, not this copy.
// One deep isohedral check, in its own process, so the caller can put a wall-clock budget on it.
//
//   node deep_check_child.js <id> <m> <si> <orient> <off>
//
// Prints one line: the matching criteria, or the empty string. Exists because a single deep check
// can run for over an hour on an m=8 patch (#25543 si18 or0 off2 passed 74 minutes and was still
// going), and isohedral_criteria.js is the permanent oracle -- its own header says so -- and must
// not be modified to accept a deadline. Killing a child is the only way to bound it without
// touching it.
const path = require('path');
const H = require(path.join(__dirname, 'lib', 'test_harness.js'));
const IC = require(path.join(__dirname, 'lib', 'isohedral_criteria.js'));
const TC = H.TC;
const [id, m, si, orient, off] = process.argv.slice(2).map(Number);
const HP = { fdEps: 1e-6, lam: 1e-7, ftol: 1e-14, maxIt: 800 };
try {
  H.loadType(id); H.runSums(m);
  const cfg = H.config(id, m, orient, off, si);
  const sp = TC.solveTile(cfg.eqs, H.lenGroups(cfg.whichEdge, m), m, { edgeSym: cfg.edgeSym, ...HP });
  // A single-tile check only ever reads tile 0, which is the tile itself -- no develop() needed.
  const V = TC.verticesOf(sp.A, sp.L, m).slice(0, m);
  const placed = [{ orbit: 0, T: [1, 0, 0, 1, 0, 0], verts: V }];
  const ed = { whichEdge: cfg.whichEdge, edgeSym: cfg.edgeSym, mapping: cfg.mapping };
  const dp = IC.checkBlock(placed, [new Array(m).fill(-1)], [0], ed, null, { deep: true, any: true }).matches;
  process.stdout.write(dp.join(','));
} catch (e) { process.stdout.write(''); }
