// Reusable test harness for the tiler.  Run from anywhere:  node test_harness.js
// Loads the engine + core with a DOM stub, then reproduces the OPEN develop bug
// (multi-segment reversed edges, e.g. #1728474 m=7 refl off=2) and a regression set.
// To validate a fix to tiler_core.js `develop`, just edit that file and re-run:
// the bug case should drop to 0 overlaps and the regression set must STAY at 0.
//
// Helpers exported for ad-hoc use (require this file):  loadType, config, solveAndDevelop,
// overlap, dumpNet.
const fs = require('fs'), path = require('path');
const DIR = __dirname;

// ---- DOM stub so aniso.js (browser code) runs in node ----
const els = {};
const el = id => els[id] || (els[id] = { value:'', checked:false, max:0, firstChild:null, removeChild(){}, appendChild(){} });
global.document = { getElementById: el, createElement: () => ({ click(){}, setAttribute(){}, style:{}, appendChild(){} }), body:{appendChild(){},removeChild(){}} };
global.window = global; global.alert = ()=>{}; global.Blob = function(){}; global.URL = { createObjectURL:()=>'', revokeObjectURL(){} };

const loadInto = f => (0, eval)(fs.readFileSync(path.join(DIR, f), 'utf8'));
loadInto('templates.js');                       // window.TEMPLATES
// engine globals aniso.js touches at load time
global.maxCounter=0; global.firstPolygonSize=0; global.secondPolygonSize=0;
global.netEdgeData=[]; global.netAngles=[]; global.netEdgeGrow=[]; global.netEdgesSum=0; global.tileName='';
loadInto('aniso_fast.js');                           // findSumWays, specify, ...
const TC = require(path.join(DIR, 'tiler_core.js'));
const DATA = window.TEMPLATES;

// ---- engine plumbing (mirrors mono2iso.js) ----
function loadType(id){ const T = DATA.byId[id];
  // specify() MUTATES netEdgeData, so it must get a fresh copy every time -- but the old
  // JSON.parse(JSON.stringify(...)) round-trip is far more expensive than a shallow row copy,
  // and ned is just an array of numeric rows.
  firstPolygonSize=T.k; secondPolygonSize=T.n; netEdgeData=T.ned.map(r=>r.slice());
  netAngles=T.na; netEdgeGrow=T.grow; netEdgesSum=T.k+T.n; maxCounter=T.grow.length; tileName=String(id);
  return T; }
const ints = s => (s.match(/-?\d+/g)||[]).map(Number);
// Mirrors mono2iso.js's parseCfg: "impossible" is not one flag, it's three (aniso.js
// imposs[0..2] - reducible / no-angles / self-intersecting), collapsed into one substring
// check by the engine's text output. Only no-angles (the vertex-angle system truly can't be
// satisfied) and missing data are genuine blockers. "reducible" (this m-gon has a redundant
// vertex -- the same physical shape has an equivalent description with fewer sides) is not a
// geometric defect at all; blocking it here silently dropped valid, drawable configs from the
// WHOLE certify search, unlike the UI (mono2iso.js), which already only notes it. Leaving
// "self intersection" blocking as-is -- a different, structural check from solveTile's own
// numeric polySelfIntersects, and not what was asked to change.
function parseCfg(txt, m){
  const noAngles = txt.includes('no angles');
  const hasData  = txt.includes('tileAngles');
  if (!hasData || noAngles) return { impossible: 1 };
  // eqs used to come from splitting forTextFile on "tileAngles" and regex-parsing the
  // "."-joined number lines back out -- specify() already builds this as a plain 2D array
  // (John, 2026-08-05: "let aniso.js talk to other programs" instead of only printing for a
  // human to read). `tileAnglesOut` is a module-level global specify() writes directly (see
  // aniso.js/aniso_fast.js), holding the exact rows it would have printed: replicate the same
  // "tileLength+1 columns, skip all-zero rows" filter it used when building forTextFile.
  const eqs = tileAnglesOut.filter(row => row.slice(0, m + 1).some(x => x !== 0)).map(row => row.slice(0, m + 1));
  // whichEdge/edgeSym/mapping used to come from regex-matching "Which Edge"/"Edge Sym"/
  // "Mapping" back out of forTextFile -- specify() already builds these as plain number
  // arrays (John, 2026-08-05: "can't we just read off ... from netEdgeData?"), it just never
  // exposed them before printing. `tileEdges` is now a module-level global specify() writes
  // to directly (see aniso.js/aniso_fast.js), so read it straight -- sliced to copy, since
  // the NEXT specify() call reuses and mutates the same array.
  const cfg = { eqs, whichEdge: tileEdges[1].slice(0, m), edgeSym: tileEdges[0].slice(0, m), mapping: tileEdges[2].slice(0, m) };
  const notes = [];
  if (txt.includes('reducible')) notes.push('reducible');
  if (txt.includes('self intersection')) notes.push('self-intersecting');
  if (notes.length) cfg.note = notes.join('; ');
  return cfg; }
function lenGroups(we, m){ const par=[...Array(m).keys()], find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(let i=0;i<m;i++){const j=we[i]; if(j>=0&&j<m) par[find(i)]=find(j);}
  const c={}; for(let i=0;i<m;i++)(c[find(i)]=c[find(i)]||[]).push(i); return Object.values(c); }
function runSums(m){ el('tileLeng').value=m; try{ findSumWays(); }catch(e){ mySums=[]; }
  return mySums.slice(); }                      // findSumWays only emits integer sums
function runSpecify(sum, orient, off){ el('sumType').value=JSON.stringify(sum); el('orient').checked=!!orient; el('offset').value=off;
  allPrint=0; try{ specify(); }catch(e){ return 'impossible'; } return forTextFile; }

// get the parsed config + raw ned for (type, m, orient, off), using sum index si
//
// The sum-types depend ONLY on (id, m), but a search loops thousands of (si, orient, off) combos
// per size and this used to re-run findSumWays for every one of them -- measured at ~12% of a
// whole deep-dive run in the V8 profile. Cache them per (id, m). runSums() itself is left
// untouched (36 dev scripts call it directly); only this internal path is memoized.
// NOTE runSums also has the side effect of setting the tileLeng input, which specify() reads, so
// a cache hit must still set it.
let _sumCache = { key: null, sums: null };
function config(id, m, orient, off, si=0){ loadType(id);
  const key = id + ':' + m;
  let sums;
  if (_sumCache.key === key) { el('tileLeng').value = m; sums = _sumCache.sums; }
  else { sums = runSums(m); _sumCache = { key, sums }; }
  if(!sums.length) return null;
  const txt=runSpecify(sums[si], orient, off); const cfg=parseCfg(txt, m);
  if(cfg.impossible) return { impossible:1 }; cfg.ned=netEdgeData.map(r=>r.slice()); cfg.k=firstPolygonSize; cfg.n=secondPolygonSize;
  // structural reducibility mask (see aniso_fast.js's reducibleVertex): 1 = genuine
  // combinatorial vertex, 0 = redundant position, independent of the solved numeric angle
  cfg.vertexAngle = reducibleVertex.slice(0, m);
  return cfg; }

// ---- overlap test: shrink tiles to 0.8 about centroid, grid-count cells in >1 tile ----
const cent = pl => { let x=0,y=0; for(const p of pl){x+=p[0];y+=p[1];} return [x/pl.length,y/pl.length]; };
function pip(poly,x,y){ let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
  if(((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside; } return inside; }
function overlap(placed){ const shr=placed.map(t=>{const c=cent(t.verts); return t.verts.map(p=>[c[0]+0.8*(p[0]-c[0]),c[1]+0.8*(p[1]-c[1])]);});
  const xs=placed.flatMap(t=>t.verts.map(p=>p[0])), ys=placed.flatMap(t=>t.verts.map(p=>p[1]));
  const a=Math.min(...xs),b=Math.max(...xs),c=Math.min(...ys),d=Math.max(...ys); let N=44,bad=0;
  for(let i=1;i<N;i++)for(let j=1;j<N;j++){const x=a+(b-a)*i/N,y=c+(d-c)*j/N; let cnt=0; for(const s of shr){if(pip(s,x,y)){cnt++; if(cnt>1)break;}} if(cnt>1)bad++;}
  return bad; }

// solve the prototile and develop with the SHIPPED tiler_core.develop
function solveAndDevelop(id, m, orient, off, maxTiles=40, si=0){
  const cfg=config(id,m,orient,off,si); if(!cfg||cfg.impossible||!cfg.whichEdge) return null;
  const sol=TC.solveTile(cfg.eqs, lenGroups(cfg.whichEdge,m), m, {edgeSym:cfg.edgeSym}); if(!sol.A) return { sol };
  const V=TC.verticesOf(sol.A, sol.L, m).slice(0,m); const ned=cfg.ned;
  const placed=TC.develop(V, cfg.k, cfg.n, ned[5].slice(), ned[4].map(Math.abs), ned[2], ned[3], ned[6], maxTiles);
  // `ov` is LAZY. overlap() rasterises a 44x44 grid and point-in-polygons every tile at every
  // grid point, and it measured at 42.6% of a whole search run -- while the search
  // (deep_one_type.js) never reads it at all; it uses OverlapStrict later, and only on the few
  // combos that reach the anisohedral stage. Several dev scripts DO read r.ov, so it can't just
  // be dropped: memoized getter keeps them working and gives the identical value, while callers
  // that never touch it pay nothing.
  let _ov;
  return { sol, V, placed, ned, cfg,
           get ov(){ return _ov !== undefined ? _ov : (_ov = overlap(placed)); } }; }

// dump the net data useful for the develop re-derivation
function dumpNet(id, m, orient, off){ const r=solveAndDevelop(id,m,orient,off); if(!r){console.log('(no config)');return;}
  const {cfg,sol}=r, ned=cfg.ned, k=cfg.k, n=cfg.n, M=m;
  const nextB=g=>{const o0=g<k,lo=o0?0:k,hi=o0?k:k+n,ng=(g+1<hi)?g+1:lo;return ned[5][ng];};
  console.log(`#${id} m=${m} o=${orient} off=${off}  k=${k} n=${n}  overlap=${r.ov}`);
  console.log('  edgeSym :', cfg.edgeSym, '(0J1U2I3S)');
  console.log('  angles  :', sol.A.map((a,i)=>i+':'+a.toFixed(0)+(sol.flat.has(i)?'(flat)':'*')).join(' '));
  console.log('  beginAt :', ned[5]); console.log('  size    :', ned[4]); console.log('  row6    :', ned[6]); console.log('  row2 adj:', ned[2]); console.log('  row3 map:', ned[3]);
  for(let g=0;g<k+n;g++){const b=ned[5][g],sz=Math.abs(ned[4][g]),st=1-2*ned[6][g];
    console.log(`   e${g}: begin=${b} eEnd_now(+abs)=${(b+sz)%M} CORRECT(nextBegin=signed)=${nextB(g)}`);}
}

module.exports = { TC, DATA, loadType, config, lenGroups, runSums, runSpecify, solveAndDevelop, overlap, dumpNet };

if (require.main === module){
  console.log('### OPEN BUG: #1728474 m=7 refl off=2 (multi-segment reversed edge) ###');
  const bug = solveAndDevelop(1728474,7,1,2);
  console.log('  overlap =', bug ? bug.ov : '(no config)', ' (want 0 after fix)');
  console.log('  net detail:'); dumpNet(1728474,7,1,2);
  console.log('\n### REGRESSION SET (must stay 0 overlaps) ###');
  const REG=[[3174,3,0,0],[3174,3,1,2],[8982,4,0,1],[974,5,0,0],[25630,4,0,0],[432,4,0,0],[356,4,0,0],[1728474,6,1,1],[1728474,6,1,2]];
  for(const [id,m,o,off] of REG){ const r=solveAndDevelop(id,m,o,off); console.log(`  #${id} m=${m} o=${o} off=${off}: overlap=${r?r.ov:'(skip)'}`); }
}
