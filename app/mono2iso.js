// Diagnostic tool: same picker as the tiler, but with several "what to show" views
// so we can inspect the data behind a (possibly wrong) tiling.
//   netdata  - the ned / na / grow arrays from templates.js (+ derived J/I/U/S)
//   symbol   - the Delaney-Dress symbol and its three involutions
//   diagram  - two regular polygons (k-gon, n-gon) joined at an edge, barycentric
//              flags labelled with chamber #, each net edge numbered + J/I/U/S
//   tiles    - the solved tile for each orbit, with angle/length controls
const DATA = window.TEMPLATES, IDX = DATA.index;
// The index lists polygons smallest-first (paper convention); the engine net data
// (DATA.byId) may list them in the other order.  Develop always uses byId, so the
// drawn "orbit 0" follows byId -- align the displayed k_q n_r / name to byId so the
// label matches what's actually drawn (search stays order-insensitive, see below).
IDX.forEach(e => { const b = DATA.byId[e.id];
  if (b && e.k === b.n && e.n === b.k && e.k !== b.k) {
    [e.k, e.q, e.n, e.r] = [e.n, e.r, e.k, e.q];
    e.name = `${e.k}_${e.q} ${e.n}_${e.r}`;
  }
});
const idxById = {}; IDX.forEach(e => idxById[e.id] = e);
const $ = id => document.getElementById(id);
const MAX_SIDES = 64;              // largest m offered in the sides dropdown / searched by findBySizes
const SUM_LIST_MAX = 2000;         // most sum-types put into the dropdown at once (DOM guard)
let sumListNote = '';              // set by selectSize, surfaced by render()
const SHAPE_COL = { J: '#e0506b', I: '#3f7fff', U: '#1f9d57', S: '#d08010' };
let cur = null, curM = null, curCfg = null, sol = null, manual = null;
// editable edge curves, keyed by edge-ORBIT representative (m-gon edge index).  Each
// entry = {type, ys}: ys are the offset heights of a few control points in the curve's
// canonical frame; the full symmetric curve is rebuilt from them (see buildCanon).
// Reset whenever the config (which determines the orbits/symmetries) changes.
let curveEdits = {};
let curveSel = null, curveSelPt = -1;   // interactive curve-editor state
// Live hover result from nearestCurveHit (null off-curve), used purely for drawing feedback --
// curveSel/curveSelPt above are what the mouse handlers and drawCurveHandles actually act on.
let curveHover = null;
// Panel-0 tile transform + base m-gon from the LAST drawTilesCanvas call, read by
// wireTileCurveEdit's mouse handlers on #cv. Null whenever there's nothing editable on
// screen (curves off, or no orbit selected), which the handlers use as their no-op guard.
let tileEditGeom = null;
// Panel-0 pan/zoom, independent of curve editing (works even with curves off, on the plain
// skeleton). cx/cy null = centre on the tile's own bbox (drawTwoTiles' default). Reset
// whenever the config changes -- a pan/zoom from a different tile/shape is meaningless.
let tileZoom = { scale: 1, cx: null, cy: null };
// Panel-0's OWN transform from the last drawTilesCanvas call (regardless of curvesOn()),
// read by wireTileCurveEdit's wheel/dblclick handlers to convert a mouse position to the
// tile-local world point to zoom/recentre on.
let panelZeroGeom = null;
// Same idea as tileZoom/panelZeroGeom above, for the 'full' (developed tiling) view -- a
// separate state since the two views show different geometry and zooming one shouldn't
// move the other.
let fullZoom = { scale: 1, cx: null, cy: null };
let fullGeom = null;
// true-parameter mode: sliders that drive the closing-tile FAMILY (each move re-solves the
// dependent unknowns so the tile stays closed).  Null = normal raw angle/length sliders.
let familyState = null;
// Raw angle/length sliders have hard-coded ranges (5-355°, 0.2-3x) that don't reach every
// tile; widened per-index on demand when a drag or typed value reaches an end (see
// growBound below). Keyed by slider index, reset alongside everything else config-derived.
let angleBounds = {}, lengthBounds = {};
// ---- on-tile CORNER dragging (the tiles view) ----
// Panel-0 geometry for the corner handles: the framed m-gon, plus which verticesOf index each
// drawn corner is, plus each corner's reachability (rank 0/1/2 from TilerCore.vertexFields).
// Always set by drawTilesCanvas -- unlike tileEditGeom, which is null when curves are off.
let cornerGeom = null;
// TilerCore.verticesOf pins v0 at the origin and edge 0 along +x, a gauge that has nothing to
// do with what the tile looks like. A drag solves up to a similarity (see TilerCore.degauge),
// so the solved tile comes back in an arbitrary position/orientation/scale; `shapeFrame` is the
// similarity that puts it back where the eye last saw it. Applied ONLY in the tiles view --
// the full view develops from the raw verticesOf frame and must not see it.
let shapeFrame = null;
const frameOf = p => shapeFrame ? TilerCore.applySim(shapeFrame, p) : p;
// Live corner drag: which corner, the tile as it stood at mousedown (the reference the whole
// gesture is solved against), and the frozen panel-0 transform so the picture cannot re-fit
// out from under the cursor mid-drag.
let cornerDrag = null;
let cornerHover = -1, cornerNote = '';
let designNote = '';               // feedback from the "design curves"/"tidy shape" buttons; see renderTilesControls
// The same, for the developed tiling. Handles are shown on ONE copy at a time (the one under the
// cursor), because develop() maps the base polygon vertex-for-vertex onto every copy, so grabbing
// a corner of any tile names a base vertex and reshapes the whole patch.
let fullCornerGeom = null, fullHover = null;

// Everything below is derived from the CURRENT (type, m, sum, orient, offset).  Any change
// to any of those must clear all of it, or render() takes the `if(!manual)` early-out and
// silently keeps drawing the PREVIOUS type's tile — the shape survives a type switch while
// the labels update, so the picture is of a tile the selected type never had.  The config
// dropdowns already reset this; selectType/selectSize used not to.
function resetShapeState(){
  manual = null; sol = null; curCfg = null;
  curveEdits = {}; curveVariant = {}; familyState = null;
  curveSel = null; curveSelPt = -1; curveHover = null;     // indices into the OLD m-gon; meaningless once m changes
  angleBounds = {}; lengthBounds = {};  // indices meaningless once m/config changes too
  tileZoom = { scale: 1, cx: null, cy: null };
  fullZoom = { scale: 1, cx: null, cy: null };
  cornerGeom = null; cornerDrag = null; cornerHover = -1; cornerNote = ''; designNote = '';
  fullCornerGeom = null; fullHover = null;
  shapeFrame = null;                     // a frame fitted to the OLD tile means nothing here
}
// A drag or typed value that reaches (or passes) an end of [lo,hi] widens that end by half
// the current span, clamped to a hard floor/ceiling well short of a true degenerate value
// (0/360 for angles, 0 for lengths) -- so the slider never silently refuses to go further.
function growBound(lo, hi, val, floor, ceil){
  const span = Math.max(hi - lo, 1e-6);
  let nlo = lo, nhi = hi;
  if (val <= lo + 1e-9) nlo = Math.max(floor, lo - span / 2);
  if (val >= hi - 1e-9) nhi = Math.min(ceil, hi + span / 2);
  return [nlo, nhi];
}
// Keep a range input and its paired number box showing the same DISPLAY-unit value, widening
// the range's own min/max via growBound when the value reaches an end. Returns the (possibly
// widened) [lo,hi] so callers with their own persisted bounds (angleBounds/lengthBounds) keep
// them past this render.
function syncPair(range, num, val, floor, ceil, decimals){
  let lo = +range.min, hi = +range.max;
  const v = Math.min(Math.max(val, floor), ceil);
  [lo, hi] = growBound(lo, hi, v, floor, ceil);
  range.min = lo; range.max = hi; range.value = v; num.value = v.toFixed(decimals);
  return [lo, hi];
}

// ---------- engine plumbing ----------
function loadType(id){
  const T = DATA.byId[id];
  firstPolygonSize = T.k; secondPolygonSize = T.n;
  // specify() MUTATES netEdgeData, so it must get a fresh copy every time -- but a shallow
  // row-copy is far cheaper than the JSON round-trip this used to do, and ned is just an array
  // of numeric rows (same fix as test_harness.js; matters here because deep search calls
  // loadType once per (m,si,orient,off) combo, thousands of times per size).
  netEdgeData = T.ned.map(r=>r.slice());
  netAngles = T.na; netEdgeGrow = T.grow;
  netEdgesSum = T.k + T.n; maxCounter = T.grow.length; tileName = String(id);
  cur = { id, ...T };
}
// Sum-types for the current type at side count m.  Memoised per (type, m): findSumWays is
// cheap for small m but explodes with it — #1726796 (6_2 6_2 pgg) has 2.6M sums at m=64 —
// and selectSize/curConfig/findBySizes all ask for the same m repeatedly.
// NOTE: specify() reads the side count back out of the #tileLeng field (aniso.js), so that
// assignment must happen on a cache HIT too, not just when findSumWays runs.
// ---- which side counts can have sum-types at all (John's netEdgeGrow shortcut) ----
// A sum-type is a vector s of non-negative multiplicities over the netEdgeGrow rows, and
// the LAST TWO entries of each row are how much that row contributes to orbit A and to
// orbit B.  A sum-type at side count m must satisfy BOTH orbits at once:
//
//        m = SUM_i s_i * a_i   AND   m = SUM_i s_i * b_i          (s_i >= 0 integers)
//
// Verified against findSumWays on 2253 sum vectors across 5 types: every returned sum
// satisfies it exactly.  So the reachable m are a 2-D unbounded-knapsack reachability
// problem over (SUM a, SUM b) — O(maxM^2 * rows), a few thousand steps, versus enumerating
// millions of sum vectors.  #1726796 has 2.6M sum-types at m=64; this answers "are there
// any?" for every m at once without building one of them.
//
// Row 0 is NOT free: findSumWays fixes sum[0]=1 (aniso.js:153) and seeds the partial sums
// at (k, n), which are exactly row 0's own (a, b).  So reachability starts at (k, n) and
// only rows 1.. are generators.  Treating row 0 as free instead makes the test too
// permissive — that alone accounted for every false positive in the first version.
//
// With row 0 pinned this is EXACT: over 1097 (type, m) cells on 63 types, 0 false
// positives and 0 false negatives against runSums.
function liveSizeSet(T, maxM){
  const ab=T.grow.map(r=>[r[r.length-2], r[r.length-1]]);
  const gen=ab.slice(1).filter(g=>g[0]>0||g[1]>0);
  const N=maxM+1, reach=Array.from({length:N},()=>new Uint8Array(N));
  if(T.k>maxM || T.n>maxM) return new Set();
  reach[T.k][T.n]=1;                       // sum[0]=1 contributes (k, n) before anything else
  for(let A=0;A<=maxM;A++) for(let B=0;B<=maxM;B++){
    if(!reach[A][B]) continue;
    for(const g of gen){ const x=A+g[0], y=B+g[1]; if(x<=maxM&&y<=maxM) reach[x][y]=1; }
  }
  const out=new Set(); for(let m=1;m<=maxM;m++) if(reach[m][m]) out.add(m);
  return out;
}
let _liveSizes = null;             // per type, set in selectType
let _sumCache = {};
function runSums(m){
  $('tileLeng').value = m;
  const key = (cur ? cur.id : '?') + '|' + m;
  if (_sumCache[key]) return _sumCache[key];
  try{ findSumWays(); }catch(e){ mySums=[]; }
  return _sumCache[key] = mySums.slice();   // findSumWays guarantees integer sums; copy so the cache is stable
}
function runSpecify(sum, orient, off){
  $('sumType').value = JSON.stringify(sum); $('orient').checked = !!orient; $('offset').value = off;
  allPrint = 0;
  try{ specify(); }catch(e){ return 'impossible - engine error ('+e.message+')'; }
  return forTextFile;
}
const ints = s => (s.match(/-?\d+/g)||[]).map(Number);
function parseCfg(txt, m){
  const reducible = txt.includes('reducible');            // same tile shape exists with fewer sides
  const selfInt   = txt.includes('self intersection');    // engine sees the tile crossing itself
  const noAngles  = txt.includes('no angles');            // vertex equations can't be satisfied
  const hasData   = txt.includes('tileAngles');
  // block only the genuinely non-realizable ones; reducible AND self-intersecting are drawn
  // (with a note) so the user can see what those mean.
  // Report the ACTUAL blocker, not just the first "impossible -" line in the text. The engine
  // can emit several at once, and "impossible - reducible" is usually printed FIRST -- so a
  // config blocked for "no angles add to non zero" was being reported as though reducibility
  // had stopped it, which reads as a bug ("it says impossible-reducible and doesn't draw").
  // Reducible NEVER blocks here; it is only ever a note (see below).
  if (!hasData || noAngles) {
    const why = noAngles ? (txt.match(/impossible - no angles[^\r\n]*/) || ['impossible - no angles'])[0]
                         : 'impossible - engine emitted no tileAngles data';
    return { impossible: why + (reducible ? '   (also reducible, but that is not why it is blocked)' : '') };
  }
  // eqs used to come from splitting forTextFile on "tileAngles" and regex-parsing the
  // "."-joined number lines back out -- specify() already builds this as a plain 2D array.
  // `tileAnglesOut` is a module-level global specify() writes directly (aniso.js), holding the
  // exact rows it would have printed: replicate the same "tileLength+1 columns, skip all-zero
  // rows" filter it used when building forTextFile. Mirrors the same change in test_harness.js.
  const eqs = tileAnglesOut.filter(row => row.slice(0, m + 1).some(x => x !== 0)).map(row => row.slice(0, m + 1));
  // whichEdge/edgeSym/mapping used to come from regex-matching "Which Edge"/"Edge Sym"/
  // "Mapping" back out of forTextFile -- specify() already builds these as plain number
  // arrays, it just never exposed them before printing. `tileEdges` is now a module-level
  // global specify() writes to directly (aniso.js), so read it straight -- sliced to copy,
  // since the NEXT specify() call reuses and mutates the same array.
  const cfg = { eqs, whichEdge: tileEdges[1].slice(0, m), edgeSym: tileEdges[0].slice(0, m), mapping: tileEdges[2].slice(0, m) };
  // Booleans as well as the prose note: the deep search filters on reducibility, and matching
  // substrings of a human-readable note would be a brittle way to ask a structural question.
  cfg.reducible = reducible;
  cfg.selfInt = selfInt;
  const notes = [];
  if (reducible) notes.push('reducible — same tile shape exists with fewer polygon sides');
  if (selfInt)   notes.push('self-intersecting — the tile crosses itself');
  if (notes.length) cfg.note = notes.join('; ');
  return cfg;
}
function lenGroups(we, m){
  const par=[...Array(m).keys()], find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(let i=0;i<m;i++){const j=we[i]; if(j>=0&&j<m) par[find(i)]=find(j);}
  const c={}; for(let i=0;i<m;i++)(c[find(i)]=c[find(i)]||[]).push(i);
  return Object.values(c);
}

// ---------- picker ----------
// Types matching the k/q/n/r boxes, before the orbifold filter.  The homeo signature alone
// is a weak key -- 1270 types share only 152 signatures, and `3_2 4_2` covers 53 of them --
// so this list is usually too long to pick from by name.  The orbifold cuts the median
// down to a single candidate and the worst case to 11.
function kqnrMatches(){
  const k=$('bk').value.trim(),q=$('bq').value.trim(),n=$('bn').value.trim(),r=$('br').value.trim();
  // match either polygon order so a paper-order (smallest-first) query still finds it
  const mk=(v,f)=>!f||''+v===f;
  return IDX.filter(e=>
    (mk(e.k,k)&&mk(e.q,q)&&mk(e.n,n)&&mk(e.r,r)) ||
    (mk(e.k,n)&&mk(e.q,r)&&mk(e.n,k)&&mk(e.r,q)));
}
// Rebuild the orbifold dropdown from what ACTUALLY exists for the current k/q/n/r, so it
// never offers a choice that matches nothing.  Wallpaper group is deliberately not a second
// filter: it is in bijection with the orbifold across all 1270 types, so asking for both
// narrows nothing.  The group is still shown on each option as a cross-check.
function refreshOrbs(){
  const m=kqnrMatches(), sel=$('orbSel'), keep=sel.value;
  const seen=new Map();
  m.forEach(e=>{ if(!seen.has(e.orb)) seen.set(e.orb,{wp:e.wp,n:0}); seen.get(e.orb).n++; });
  sel.innerHTML='';
  const all=document.createElement('option');
  all.value=''; all.textContent=`all (${m.length})`; sel.appendChild(all);
  [...seen.keys()].sort().forEach(orb=>{ const o=document.createElement('option');
    o.value=orb; o.textContent=`${orb}  ${seen.get(orb).wp} (${seen.get(orb).n})`; sel.appendChild(o); });
  if([...sel.options].some(o=>o.value===keep)) sel.value=keep;   // survive a re-filter
}
function refreshMatches(){
  const orb=$('orbSel').value;
  const m=kqnrMatches().filter(e=>!orb||e.orb===orb);
  const sel=$('matches'); sel.innerHTML='';
  // Mark the settled ones right in the picker, so a proven-impossible type is visible BEFORE
  // it is selected: ✗ impossible, ✓ possible, nothing for still-unknown (the ones worth work).
  const mark=id=>{ const r=verdictOf(id); return r? (r.v==='X'?'✗ ':r.v==='P'?'✓ ':'') : ''; };
  m.slice(0,400).forEach(e=>{const o=document.createElement('option');o.value=e.id;
    o.textContent=`${mark(e.id)}${e.name}  ${e.wp} ·${e.orb} #${e.id}`; sel.appendChild(o);});
  if(m.length) selectType(m[0].id); else { $('size').innerHTML=''; $('sumType2').innerHTML=''; render(); }
}
// Gallery of the paper figures for the current k/q/n/r (+ orbifold), so a type can be
// picked by SIGHT rather than by decoding its name.  CELL_IMG (cells_map.js, generated from
// index/cells_index.txt) maps tegula id -> figure filename under index/cells/.
function viewPick(){
  const orb=$('orbSel').value;
  const m=kqnrMatches().filter(e=>!orb||e.orb===orb);
  let h=`<div class="muted">${m.length} type${m.length===1?'':'s'} match`
       +`${orb?` <b>${orb}</b>`:''}. Click a figure to load it.</div>`;
  if(!m.length){ $('panel').innerHTML=h+'<div class="muted" style="margin-top:8px">nothing matches those k/q/n/r</div>'; return; }
  if(typeof CELL_IMG==='undefined'){ $('panel').innerHTML=h+'<div style="color:var(--bad);margin-top:8px">cells_map.js not loaded — run py/gen_cells_map.py</div>'; return; }
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
  m.slice(0,120).forEach(e=>{
    const img=CELL_IMG[e.id], on=cur&&cur.id===e.id;
    h+=`<div class="pickcell" data-id="${e.id}" title="${e.name} ${e.wp} ·${e.orb} #${e.id}"`
      +` style="cursor:pointer;width:104px;border:2px solid ${on?'var(--accent)':'transparent'};border-radius:6px;padding:2px">`
      +(img?`<img src="../index/cells/${img}" style="width:100%;display:block;background:#fff;border-radius:4px">`
           :`<div style="height:80px;display:flex;align-items:center;justify-content:center" class="muted">no figure</div>`)
      +`<div style="font:11px ui-monospace,monospace;text-align:center;color:#9aa0ad">${e.orb} `
      +(()=>{ const r=verdictOf(e.id);                       // same ✗/✓ key as the type dropdown
              return r&&r.v==='X'?'<span style="color:#ff6b6b">✗</span>'
                   : r&&r.v==='P'?'<span style="color:#36c275">✓</span>' : ''; })()
      +`#${e.id}</div></div>`;
  });
  h+='</div>';
  if(m.length>120) h+=`<div class="muted" style="margin-top:6px">showing 120 of ${m.length} — narrow with the orbifold</div>`;
  $('panel').innerHTML=h;
  $('panel').querySelectorAll('.pickcell').forEach(c=>c.onclick=()=>{
    const id=+c.dataset.id; $('bid').value=id; $('matches').value=id; selectType(id);
  });
}
// ---------- gallery ----------
// The saved combos (GALLERY, gallery_manifest.js, generated by tools/gen_gallery.js from
// data/combos/*.json + criteria_m<m>.csv). Click a picture to load that combo with the
// true-parameter sliders (activateFamily) already active.
//
// Layout, John 2026-09-14: one collapsible section per edge count (the anisohedral catalogue), one
// for the unbalanced tiles sorted by SHAPE, and "weird tiles" -- combos from Checking/ that took
// special curves to tile (both lists in gallery_shapes.js, from tools/gen_gallery_shapes.js). #25638
// is not shown: it is not an unbalanced tile, and John dropped its own section. The group, size and
// rigid/flexible menus are gone (so the two isohedral combos saved by mistake, #1512 and #3215, no
// longer show). A tile with several ways of tiling shows the TILE once with its ways listed
// underneath; "show all tiling ways" opens every way's tiling picture. One way: its tiling, as before.
let galSearch = '';               // free text over id, label, orbifold, wallpaper group, homeotype
let galShowWays = false;          // the toggle: each way's tiling picture under its tile
const galOpen = new Set();        // expanded sections: 'm4'..'m8', 'unbal', 'weird'
function viewGallery(){
  if(typeof GALLERY==='undefined'){
    $('panel').innerHTML='<div style="color:var(--bad)">gallery_manifest.js not loaded — run tools/gen_gallery.js</div>';
    return;
  }
  const all=GALLERY.map((e,i)=>({...e,i}));
  const q=galSearch.trim().toLowerCase();
  const hit=e=>{ if(!q) return true; const m=e.meta||{};
    return [e.combo.id, e.label, m.homeo, m.wp, m.orbifold, m.block_criteria&&('criterion '+m.block_criteria)]
      .filter(Boolean).join(' ').toLowerCase().includes(q); };
  // GROUP BY TILE. John, 2026-09-11: "can you sort the gallery combos by congruence? So for m=4, we
  // have two ways that a square with curved edges can tile. It's the same shape, though." Combos
  // with the same tileKey (engine/congruence.js, computed in gen_gallery.js) draw the same curved tile.
  const tileOf=e=>e.tileKey ? e.combo.m+'|'+e.tileKey : 'file:'+e.file;
  const sections=[];
  const aniso=all.filter(e=>(e.group||'aniso')==='aniso');
  for(const m of [...new Set(aniso.map(e=>e.combo.m))].sort((a,b)=>a-b)){
    const by=new Map();
    for(const e of aniso) if(e.combo.m===m){ const k=tileOf(e); if(!by.has(k)) by.set(k,{members:[]}); by.get(k).members.push(e); }
    sections.push({key:'m'+m, title:`${m} sides`, unit:'tile', tiles:[...by.values()]});
  }
  // UNBALANCED, by shape across edge counts -- one polyomino is #69439 AND #69445, at m=26, 52 and 78.
  // The hand-picked "weird" copies of John's five are the same tiles, so they join their shape.
  const SH=(typeof GALLERY_SHAPES!=='undefined' && GALLERY_SHAPES.shapes) || [];
  const shapeIx=new Map(); SH.forEach((s,ix)=>s.tileGroups.forEach(k=>shapeIx.set(k,ix)));
  const byShape=new Map();
  for(const e of all.filter(e=>e.group==='unbalanced'||e.group==='weird')){
    const k=tileOf(e), ix=shapeIx.has(k)?shapeIx.get(k):null;
    const sk=ix!=null?'s'+ix:'t'+k;                  // a tile the shapes file has not seen yet stands alone
    if(!byShape.has(sk)) byShape.set(sk,{members:[], shape:ix!=null?SH[ix]:null, order:ix!=null?ix:SH.length});
    byShape.get(sk).members.push(e);
  }
  // one combo saved twice (a deep-dive file and John's hand-picked copy) is listed once -- his copy,
  // which may carry his own curves
  const pref=f=>/^combo_WEIRD_/.test(f)?0:/^combo_ANISO_/.test(f)?1:/^combo_UNBALQLT_/.test(f)?2:3;
  const byM=(a,b)=>a.combo.m-b.combo.m||a.combo.id-b.combo.id||a.si-b.si||a.combo.orient-b.combo.orient||a.combo.off-b.combo.off;
  for(const t of byShape.values()){
    const one=new Map();
    for(const e of t.members.slice().sort((a,b)=>pref(a.file)-pref(b.file))){
      const k=[e.combo.id,e.combo.m,e.si,e.combo.orient,e.combo.off].join('|'); if(!one.has(k)) one.set(k,e); }
    t.members=[...one.values()].sort(byM);
    t.rep=t.members.slice().sort((a,b)=>pref(a.file)-pref(b.file)||byM(a,b))[0];
  }
  const shapes=[...byShape.values()].sort((a,b)=>a.order-b.order);
  // #25638 (balancedToo) is not an unbalanced tile, and John dropped its own section (2026-09-14)
  sections.push({key:'unbal', title:'unbalanced tiles', unit:'shape', tiles:shapes.filter(t=>!(t.shape&&t.shape.balancedToo))});
  // WEIRD TILES (John, 2026-09-14): combos from Checking/ that took special curves to tile -- no
  // straight-edge version, 0-degree or tiny corners, a boundary that only just clears. The curated
  // list, where each came from, and what made it hard all come from gallery_shapes.js. The designed
  // ones are anisohedral and also appear under 8 sides.
  const WD=(typeof GALLERY_SHAPES!=='undefined' && GALLERY_SHAPES.weird) || [];
  const wBy=new Map();
  for(const w of WD){
    const e=all.find(x=>x.file===w.file); if(!e) continue;
    const k=tileOf(e);
    if(!wBy.has(k)) wBy.set(k,{members:[], shape:{label:'', note:
      `<div style="margin-top:2px">${w.source}</div><div style="margin-top:2px;color:#9aa0ad">${w.why.join(' · ')}</div>`}});
    wBy.get(k).members.push(e);
  }
  for(const t of wBy.values()){ const c=t.members[0].combo; t.shape.label=`${t.members[0].label||'#'+c.id} · m${c.m}`; }
  sections.push({key:'weird', title:'weird tiles', unit:'tile', tiles:[...wBy.values()]});

  const img=src=>`<img src="../data/combos/${src}" style="width:100%;display:block;background:#fff;border-radius:4px">`;
  const describe=x=>{ const c=x.combo; return `${x.label||('#'+c.id)}  sum=${c.sum} ${c.orient?'refl':'direct'} off=${c.off}`; };
  // dof: how many true-parameter sliders once loaded -- 0 = rigid
  const dofOf=e=>e.dof==null ? 'dof ?' : e.dof===0 ? 'rigid' : `dof ${e.dof}`;
  // different tiles that share a bare outline (same corners, different edge types) -- worth saying,
  // never worth merging: once curved they are different tiles
  const outline=new Map();
  for(const s of sections) if(s.key[0]==='m') for(const t of s.tiles){ const k=t.members[0].shapeKey; if(k) outline.set(k,(outline.get(k)||0)+1); }
  const card=t=>{
    const ms=t.shown, rep=t.rep&&ms.includes(t.rep) ? t.rep : ms[0], m=rep.meta, c=rep.combo;
    const ol = rep.group==='aniso' && rep.shapeKey && outline.get(rep.shapeKey)>1
      ? ` · same outline as ${outline.get(rep.shapeKey)-1} other tile${outline.get(rep.shapeKey)===2?'':'s'}` : '';
    // a pinch point: the drawn tile touches itself at a corner, and no curve size or motif opened it
    const pinch = ms.some(x=>x.pinched) ? ' · <span style="color:#d97706">pinch point — needs hand-drawn curves</span>' : '';
    if(ms.length===1 && !(t.shape&&t.shape.picture)){        // one way: the tiling itself
      // an isohedral tile (the census says "no (tile)" -- the weird-tiles section has some) has no block criterion
      const how = m && m.aniso==='YES' ? `criterion ${m.block_criteria||'?'} on ${m.min_block||'?'}-tile block` : 'tiles isohedrally';
      const head = m ? `${describe(rep)}<br>m${c.m} ${dofOf(rep)} ${m.homeo||''} ${m.wp||''} ·${m.orbifold||''} — ${how}${ol}${pinch}`
                     : `${describe(rep)}<br>m${c.m} ${dofOf(rep)}${ol}${pinch}`;
      const note1 = t.shape && t.shape.note ? `<div style="margin-top:3px;color:#cfd3dc;font-family:system-ui">${t.shape.note}</div>` : '';
      return `<div class="pickcell" data-i="${rep.i}" style="cursor:pointer;border-radius:6px;padding:4px">${img(rep.svg)}`
        +`<div style="font:11px ui-monospace,monospace;text-align:center;color:#9aa0ad;margin-top:2px">${head}${note1}</div></div>`;
    }
    // several ways: the tile once, its ways underneath
    const mset=[...new Set(ms.map(x=>x.combo.m))];
    const head = t.shape ? `${t.shape.label} — <b>${ms.length} ways</b>${pinch}`
      : `${[...new Set(ms.map(x=>'#'+x.combo.id))].join(' ')} — m${mset.join('/')} ${dofOf(rep)} — <b>${ms.length} ways</b>${ol}${pinch}`;
    const note = t.shape && t.shape.note ? `<div style="margin-top:3px;color:#cfd3dc;font-family:system-ui">${t.shape.note}</div>` : '';
    const pic = t.shape && t.shape.picture
      ? `<div style="margin-top:6px">${img(t.shape.picture)}<div class="muted" style="font-size:11px;margin-top:2px;text-align:center">${t.shape.pictureNote||''}</div></div>` : '';
    const ways = ms.map(x=>{ const mm=x.meta||{};
      const lbl=`› ${mset.length>1?'m'+x.combo.m+' ':''}${describe(x)}${mm.wp?' · '+mm.wp:''}${mm.block_criteria?' · criterion '+mm.block_criteria:''}`;
      return `<div class="pickway" data-i="${x.i}" title="click to load this way" style="cursor:pointer;padding:1px 4px;border-radius:3px">${lbl}`
        +(galShowWays ? `<div style="margin:3px 0 8px">${img(x.svg)}</div>` : '')+'</div>'; }).join('');
    return `<div style="border-radius:6px;padding:4px">`
      +`<div class="pickcell" data-i="${rep.i}" title="click to load ${rep.label||'#'+c.id}" style="cursor:pointer;display:flex;justify-content:center">`
      +`<img src="../data/combos/${rep.svg.replace(/\.svg$/,'.tile.svg')}" onerror="this.onerror=null;this.src='../data/combos/${rep.svg}'" `
      +`style="max-width:100%;max-height:200px;display:block;background:#fff;border-radius:4px"></div>`
      +`<div style="font:11px ui-monospace,monospace;text-align:center;color:#9aa0ad;margin-top:2px">${head}${note}</div>${pic}`
      +`<div style="margin-top:3px;text-align:left;font:11px ui-monospace,monospace;color:#9aa0ad">${ways}</div></div>`;
  };
  // One column, sized to fill the panel (it is only 360px wide); gen_gallery.js caps each tiling
  // picture at ~16 tiles so there is something to see at this size.
  let h=`<input id="galQ" placeholder="search: type number, orbifold, wallpaper group…" value="${galSearch.replace(/"/g,'&quot;')}" style="width:100%">`
    +`<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">`
    +`<button id="galWays" title="under each tile with several ways of tiling, show every way's tiling picture">${galShowWays?'hide':'show'} all tiling ways</button>`
    +`<span class="muted">click a heading to open it; a picture or a way to load it</span></div>`
    +'<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">';
  for(const s of sections){
    const tiles=s.tiles.map(t=>({...t, shown:t.members.filter(hit)})).filter(t=>t.shown.length);
    if(!tiles.length) continue;
    const nWays=tiles.reduce((a,t)=>a+t.shown.length,0), open=!!q||galOpen.has(s.key);
    h+=`<h3 class="galSec" data-k="${s.key}" style="margin-top:6px;cursor:pointer;user-select:none">${open?'▾':'▸'} ${s.title} `
      +`<span class="muted" style="font-weight:normal">(${tiles.length} ${s.unit}${tiles.length===1?'':'s'}, ${nWays} tiling${nWays===1?'':'s'})</span></h3>`;
    if(open) for(const t of tiles) h+=card(t);
  }
  h+='</div>';
  $('panel').innerHTML=h;
  const box=$('galQ');
  box.oninput=e=>{ galSearch=e.target.value;
    clearTimeout(box._t); box._t=setTimeout(()=>{ viewGallery();
      const b=$('galQ'); if(b){ b.focus(); b.setSelectionRange(b.value.length,b.value.length); } },250); };
  $('galWays').onclick=()=>{ galShowWays=!galShowWays; viewGallery(); };
  $('panel').querySelectorAll('.galSec').forEach(hd=>hd.onclick=()=>{
    const k=hd.dataset.k;
    if(galOpen.has(k)) galOpen.delete(k); else galOpen.add(k);
    viewGallery();
  });
  // a single way of tiling, inside a tile's group -- load that combo, not the group's first
  $('panel').querySelectorAll('.pickway').forEach(w=>w.onclick=ev=>{
    ev.stopPropagation();
    loadCombo(GALLERY[+w.dataset.i].combo);
  });
  $('panel').querySelectorAll('.pickcell').forEach(c=>c.onclick=()=>{
    loadCombo(GALLERY[+c.dataset.i].combo);           // loadCombo itself calls activateFamily()
  });
}
// ---------- verdict banner ----------
// What the LEDGER says about the whole type, as opposed to the #status pill, which reports the
// one combo currently on screen. The distinction is the point of this banner: an impossible type
// still has combos whose tile closes and whose patch develops -- closing is necessary, not
// sufficient -- so "✓ closes" next to a proven-impossible type is not a contradiction, and
// without saying so the picture reads as a counterexample to the proof.
// Data: engine/verdicts.js, generated by py/gen_verdicts.js from py/ledger.json plus the
// impossibles manifest. Everything impossibles_viewer.html shows for a type is here.
let proofOpen = false;
const verdictOf = id => (window.VERDICTS && window.VERDICTS.types && window.VERDICTS.types[String(id)]) || null;
function renderVerdict(){
  const box=$('verdict'); if(!box) return;
  const V=window.VERDICTS, rec=cur?verdictOf(cur.id):null;
  if(!V||!rec){ box.hidden=true; box.innerHTML=''; return; }
  box.hidden=false;
  const e=idxById[cur.id]||{};
  const meta=`<span class="meta">${e.name||''} · ${e.wp||''} · ${e.orb||''}`
    +(rec.pl?` · paper ${rec.pl}${rec.pn!=null?` (#${rec.pn})`:''}`:'')+`</span>`;
  if(rec.v==='X'){
    box.className='imp';
    const why=(rec.r>=0&&V.reasons[rec.r])||'';
    box.innerHTML=`<div class="vhead"><span class="chip">proven impossible</span>`
      +`<b>#${cur.id} admits no tiling at all</b>`
      +`<span class="grp">${rec.g||''}</span>${meta}`
      +(rec.f?`<button id="proofBtn">${proofOpen?'hide':'show'} proof picture</button>`:'')
      +`</div>`
      +`<div class="why">No combination of sides, sum-type, reflection or offset can work — the
          proof is about the type itself. Anything drawn below is a shape the engine can build,
          not a counterexample.${why?' <b>Why:</b> '+why:''}</div>`
      +(proofOpen&&rec.f?(()=>{ const u=encodeURI(V.proofDir+rec.f);
          return `<div class="proof"><a href="${u}" target="_blank" rel="noopener">`
            +`<img src="${u}" alt="proof for #${cur.id}" title="click for the full-size picture"></a>`
            +`<a href="${u}" target="_blank" rel="noopener">open full size ↗ &nbsp;·&nbsp; ${rec.f}</a></div>`; })():'');
    const pb=$('proofBtn'); if(pb) pb.onclick=()=>{ proofOpen=!proofOpen; renderVerdict(); };
  } else if(rec.v==='P'){
    box.className='pos';
    box.innerHTML=`<div class="vhead"><span class="chip">possible</span>`
      +`<b>#${cur.id} is known to tile</b>${meta}</div>`+searchLine(rec);
  } else {
    box.className='unk';
    box.innerHTML=`<div class="vhead"><span class="chip">unknown</span>`
      +`<b>#${cur.id} is undecided</b>${meta}</div>`+searchLine(rec);
  }
}
// How far this type has been searched (rec.s / rec.m, from the ledger's aniso_search and
// searched_to_m via py/gen_verdicts.js).
function searchLine(rec){
  const s=rec.s, where=[];
  if(s&&s.c) where.push('the m ≤ 8 census');
  if(s&&s.d) where.push(`a deep dive over m = ${s.d[0]}–${s.d[1]}`);
  let t='';
  if(rec.v==='U') t=rec.m!=null?`Searched for any tile up to m = ${rec.m}; none found. `:'No search on record. ';
  if(where.length) t+=`Searched for anisohedral tilings by ${where.join(' and ')}: `
    +(s.a&&s.a.length?`found at m = ${s.a.join(', ')}.`:'none found.');
  return t?`<div class="why">${t}</div>`:'';
}
function selectType(id){
  proofOpen=false;                         // a new type starts with its proof picture collapsed
  resetShapeState();                       // before loadType: the old tile must not survive
  _sumCache={};                            // sums are per type, and can be millions of rows
  loadType(id);
  // Side-count range.  Myers-style polyform tilings run to ~30+ sides per tile, so the old
  // mn+26 cap (32 for a 5_3 6_6) put real targets out of reach entirely.
  // Offer only the sizes that CAN have sum-types, decided by liveSizeSet from netEdgeGrow.
  // Probing with runSums(m) instead is unaffordable — for #1726796 (6_2 6_2 pgg) that is
  // 2.6M sums at m=64 and ~65s of blocking allocation, which froze the page — while listing
  // every size unfiltered leaves the user picking dead ones and being told "no sum-types".
  // The knapsack answers it for all m at once in a few thousand steps.
  const mn=Math.max(cur.k,cur.n), sizeSel=$('size'); sizeSel.innerHTML='';
  _liveSizes=liveSizeSet(cur, MAX_SIDES);
  for(let m=mn;m<=MAX_SIDES;m++){ if(!_liveSizes.has(m)) continue;
    const o=document.createElement('option');o.value=m;o.textContent=m;sizeSel.appendChild(o); }
  if(sizeSel.options.length) selectSize(+sizeSel.options[0].value); else render();
}
function selectSize(m){
  curM=m; $('size').value=m; resetShapeState();
  const ms=runSums(m), sel=$('sumType2'); sel.innerHTML='';
  // Cap what goes into the DOM.  Sum counts run to millions at large m on some types, and
  // building that many <option>s freezes the page just as surely as computing them did.
  // Past the cap the dropdown is useless anyway — use "find combo by side sizes" instead.
  const shown=Math.min(ms.length, SUM_LIST_MAX);
  for(let i=0;i<shown;i++){ const o=document.createElement('option');
    o.value=JSON.stringify(ms[i]); o.textContent='#'+i+' '+JSON.stringify(ms[i]); sel.appendChild(o); }
  sumListNote = !ms.length ? `no sum-types at ${m} sides — try another size`
              : ms.length>shown ? `showing ${shown} of ${ms.length} sum-types at ${m} sides — use “find combo by side sizes” to search them all`
              : '';
  $('offset2').max=m-1; $('offset2').value=0; $('orient2').checked=false;
  render();
}
// Make sure a sum-type can actually be SELECTED in the dropdown.  The list is capped at
// SUM_LIST_MAX options, but the find results and saved combos both address a sum by value
// rather than by position — and a <select> silently ignores a value that is not among its
// options, leaving it blank with nothing to render.  So append the wanted sum if the cap
// left it out.  Returns false if it is not a sum-type of the current size at all.
function ensureSumOption(sumStr){
  const sel=$('sumType2');
  for(const o of sel.options) if(o.value===sumStr) return true;
  const si=runSums(curM).findIndex(s=>JSON.stringify(s)===sumStr);
  if(si<0) return false;
  const o=document.createElement('option');
  o.value=sumStr; o.textContent='#'+si+' '+sumStr;
  sel.appendChild(o);
  sumListNote='';                 // we just reached past the cap, so the warning is now wrong
  return true;
}
function curConfig(){
  if(!curM) return null;
  const sum=JSON.parse($('sumType2').value||'null'); if(!sum) return null;
  const orient=$('orient2').checked?1:0, off=+$('offset2').value||0;
  const txt=runSpecify(sum,orient,off);
  const cfg=parseCfg(txt,curM); cfg.ned=netEdgeData.map(r=>r.slice());
  if(!cfg.impossible) cfg.vertexAngle=reducibleVertex.slice(0,curM);
  return cfg;
}

// ---------- views ----------
function render(){
  const cv=$('cv'), g=cv.getContext('2d'); g.clearRect(0,0,cv.width,cv.height);
  // Deep search shares the same global engine state (netEdgeData, tileAngles, ...) as every
  // other view -- loading a result, picking a different type, or switching views mid-search
  // would otherwise silently corrupt whichever view runs next. So: leaving the deepsearch view
  // always pauses it first (resumable -- Start just continues from where it left off, it does
  // NOT restart). Switching type while STAYING on the deepsearch view is caught separately,
  // inside viewDeepSearch itself, since view doesn't change there.
  if(deepSearchState.active && $('view').value!=='deepsearch') deepSearchState.active=false;
  $('panel').innerHTML=''; const st=$('status'); st.className='status'; st.textContent='';
  renderVerdict();               // a property of the TYPE, so it survives every view/combo change
  if(!cur){ $('panel').innerHTML='<div class="muted">pick a type</div>'; return; }
  if(sumListNote){ st.className='status no'; st.textContent=sumListNote; }
  const v=$('view').value;
  if(v==='pick') viewPick();
  else if(v==='gallery') viewGallery();
  else if(v==='find') viewFind();
  else if(v==='tiles') viewTiles(g,cv);
  else if(v==='full') viewFull(g,cv);
  else if(v==='deepsearch') viewDeepSearch();
}

function viewFull(g,cv){ if(!ensureSolve()) return; drawFullCanvas(g,cv); renderTilesControls(); }

// ---------- deep search: browser port of _dev_isohedral/deep_single_type.js ----------
// Loops every (m, si, orient, off) for one type looking for clean closures, classifying each
// as isohedral (a single-tile criterion matches) or a candidate anisohedral tile (none does,
// but a multi-tile BLOCK criterion does): solveTile -> IsohedralBlock.findSmallestBlock on the
// develop-free DD route, blocks up to q'+r' tiles -- no patch, no overlap test. Chunked across
// setTimeout ticks so the tab stays responsive and a Stop button actually works.
//
// Deadline policy mirrors deep_single_type.js (John, 2026-08-05: "always stop at the end of
// some m size"): Stop only takes effect at a size BOUNDARY -- once a size starts, every
// (si,orient,off) in it gets tried before the search halts. Navigating away is different (an
// emergency pause to protect shared engine state, not a deliberate stop) and takes effect
// immediately, mid-size, but is always resumable from exactly where it paused.
// skipIso / skipRed are FILTERS ON WHAT IS LISTED AND DONE, not on what is counted. Both keep a
// running tally so the progress line can say what was passed over -- a search that quietly drops
// results is worse than one that lists too many, because you cannot tell afterwards whether a size
// was empty or merely filtered. skipRed is checked BEFORE solving (reducibility is structural and
// known from the config), so it also saves the work; skipIso can only be applied after the
// single-tile criterion test, since that test is what identifies an isohedral combo.
let deepSearchState = { active:false, id:null, startM:null, targetM:null, m:null, sums:null, si:0, or:0, off:0,
  skipIso:false, skipRed:false,
  combosThisSize:0, closedThisSize:0, cleanThisSize:0, anisoThisSize:0, redThisSize:0, isoSkipThisSize:0, notTileThisSize:0,
  grandCombos:0, grandClosed:0, grandRedSkipped:0, grandIsoSkipped:0, grandNotTile:0,
  results:[], perSize:[], stopAtBoundary:false };

// The develop-free route's dependencies, all loaded as page globals by mono2iso.html.
const dsDeps=()=>({ TC:TilerCore, IC:IsohedralCriteriaFast, CHK:TilingChecks, AA:AngleAlgebra, DD:DDPatch, TS:TileSymmetry });
// Is a closing shape a TILE at all? The same check the census runs (engine/dd_route.js's
// curveVerdict): tile_designer's fold/coincident/spike gate, then curve_sides.js's exact
// bulge-sign check (S midpoint / I contacts outright; J/U through the outside lemma, validated by
// John 2026-09-13), then the curve designer's search as the fallback -- the only path whose "no" is
// a search, not a proof. A "yes" always needs a curve that actually clears -- on this shape, or on
// another member of its family (then {shape} says which member to judge from here on).
// Returns {bad:false} / {bad:false, shape:{A,L}} / {bad:true, reason}. Without this the deep search
// listed self-touching shapes as tiles.
const DS_CURVE_CLEAR_MIN=1e-4;
function dsCurveVerdict(cfg, m, A, L){
  const dctx={TC:TilerCore, m, edgeSym:cfg.edgeSym, whichEdge:cfg.whichEdge, mapping:cfg.mapping, groups:lenGroups(cfg.whichEdge,m), eqs:cfg.eqs};
  let dg; try{ dg=TileDesigner.diagnose({}, dctx, A, L); }catch(e){ return {bad:false}; }
  if(dg.verdict==='not a tile') return {bad:true, reason:dg.reason};
  if(dg.verdict!=='curves required') return {bad:false};
  let ex=null; try{ ex=CurveSides.checkExact({TC:TilerCore, TD:TileDesigner, CD:CurveDesigner, TCurves:TilerCurves}, dctx, A, L); }catch(e){ ex=null; }
  if(ex && ex.verdict==='impossible') return {bad:true, reason:ex.reason};
  if(ex && ex.verdict==='no conflict' && ex.clearance > DS_CURVE_CLEAR_MIN) return {bad:false};
  let dc=null; try{ dc=TileDesigner.designCurves({}, dctx, A, L, {}, dg, {starts:24}); }catch(e){ dc=null; }
  if(dc && dc.clearance > DS_CURVE_CLEAR_MIN) return {bad:false};
  // John's two exact rules (fixed points collide; no mirror) on every member of the family, every
  // branch -- same step as dd_route.curveVerdict
  let fam=null; try{ fam=CurveSides.familyExact({TC:TilerCore, TD:TileDesigner, CD:CurveDesigner, TCurves:TilerCurves}, dctx, A, L); }catch(e){ fam=null; }
  if(fam && fam.verdict==='impossible') return {bad:true, reason:fam.reason};
  let w=null; try{ w=TileDesigner.designShapeAndCurves({}, dctx, A, L, {}, {starts:24}); }catch(e){ w=null; }
  if(w && w.clearance > DS_CURVE_CLEAR_MIN) return {bad:false, shape:{A:w.A.slice(), L:w.L.slice()}};
  // second attempt, wider over the family's solution branches -- same as dd_route.curveVerdict
  let w2=null; try{ w2=TileDesigner.designShapeAndCurves({}, dctx, A, L, {}, {starts:24, branchStarts2:160}); }catch(e){ w2=null; }
  if(w2 && w2.clearance > DS_CURVE_CLEAR_MIN) return {bad:false, shape:{A:w2.A.slice(), L:w2.L.slice()}};
  const best=Math.max(dc?dc.clearance:-1, w?w.clearance:-1);
  return {bad:true, reason:'no curve choice found that clears '+dg.problems.map(p=>p.kind+(p.vertex!=null?'@v'+p.vertex:'')).join(' ')
    +', on this shape or elsewhere in its family; best clearance '+best.toExponential(1)+' -- search, not proof'};
}
// The census's precision guard: a candidate is re-solved at high precision and tested again.
const DS_HP={fdEps:1e-6, lam:1e-7, ftol:1e-14, maxIt:800};
// Largest block ever needed: q'+r' from the type's orbit ratio q:r (the index's own q/r fields,
// else parsed off its homeotype label "k_q n_r").
function dsBlockBound(id){
  const e=idxById[id]||{}, qr=(e.q && e.r) ? {q:e.q, r:e.r} : IsohedralBlock.qrFromHomeo(e.homeo||e.name);
  return qr ? IsohedralBlock.maxBlockFor(qr.q, qr.r) : null;
}

function deepSearchReset(id){
  // mutate the SAME object in place, not reassign -- viewDeepSearch/deepSearchTick/
  // renderDeepSearchLive all capture `const st=deepSearchState` at their own top, and a
  // reassignment here would leave any `st` captured just before this call pointing at the
  // stale object (this WAS a real bug: the target-m input rendered as "null" the first time
  // because viewDeepSearch captured `st` one line before calling this).
  const lo=Math.max(idxById[id].k,idxById[id].n);
  // startM is remembered across a reset the same way targetM is, so "clear / restart" re-runs the
  // range you asked for rather than silently dropping back to the smallest possible size.
  const startM=Math.max(lo, deepSearchState.startM||lo);
  Object.assign(deepSearchState, { active:false, id, startM, targetM:Math.max(startM, deepSearchState.targetM||lo+40),
    m:startM, sums:null, si:0, or:0, off:0,
    skipIso:deepSearchState.skipIso, skipRed:deepSearchState.skipRed,   // filters survive a restart
    combosThisSize:0, closedThisSize:0, cleanThisSize:0, anisoThisSize:0, redThisSize:0, isoSkipThisSize:0, notTileThisSize:0,
    grandCombos:0, grandClosed:0, grandRedSkipped:0, grandIsoSkipped:0, grandNotTile:0,
    results:[], perSize:[], stopAtBoundary:false });
}

// process one bounded chunk of work (time-boxed, not count-boxed, so a size with cheap or
// expensive combos still yields to the browser at a consistent cadence), then either
// reschedule itself or stop.
function deepSearchTick(){
  const st=deepSearchState;
  if(!st.active) return;
  if(!cur || cur.id!==st.id){ st.active=false; if($('view').value==='deepsearch') viewDeepSearch(); return; }
  const t0=performance.now();
  while(performance.now()-t0 < 25){
    if(st.sums===null){
      loadType(st.id);
      let s; try{ s=runSums(st.m); }catch(e){ s=[]; }
      st.sums=s; st.si=0; st.or=0; st.off=0;
      st.combosThisSize=0; st.closedThisSize=0; st.cleanThisSize=0; st.anisoThisSize=0;
      st.redThisSize=0; st.isoSkipThisSize=0; st.notTileThisSize=0;
      if(!s.length){                                  // no sum-types at all at this m: skip it
        st.perSize.push({m:st.m, combos:0, closed:0, clean:0, aniso:0, note:'no sum-types'});
        st.m++; st.sums=null;
        if(st.m>st.targetM || st.stopAtBoundary){ st.active=false; renderDeepSearchLive(); return; }
        continue;
      }
    }
    if(st.si>=st.sums.length){                         // size finished -- boundary check happens HERE
      st.grandCombos+=st.combosThisSize; st.grandClosed+=st.closedThisSize;
      st.grandRedSkipped+=st.redThisSize; st.grandIsoSkipped+=st.isoSkipThisSize; st.grandNotTile+=st.notTileThisSize;
      st.perSize.push({m:st.m, combos:st.combosThisSize, closed:st.closedThisSize, clean:st.cleanThisSize,
                       aniso:st.anisoThisSize, notTile:st.notTileThisSize, redSkipped:st.redThisSize, isoSkipped:st.isoSkipThisSize});
      // Zero the per-size counters HERE, not only when the next size starts. The display shows
      // grand + thisSize, and on the LAST size there is no next size to do the reset -- so a
      // finished search reported its final size twice (a 92-combo run over m=6..8 read "combos
      // tried: 172"). Pre-existing for combos/closed; the same trap for the new skip tallies.
      st.combosThisSize=0; st.closedThisSize=0; st.cleanThisSize=0; st.anisoThisSize=0;
      st.redThisSize=0; st.isoSkipThisSize=0; st.notTileThisSize=0;
      const doneM=st.m;
      st.m++; st.sums=null;
      if(doneM>=st.targetM || st.stopAtBoundary){ st.active=false; renderDeepSearchLive(); return; }
      continue;
    }
    loadType(st.id);
    const m=st.m, sum=st.sums[st.si], orient=st.or, off=st.off;
    st.combosThisSize++;
    // parseCfg alone doesn't attach ned/k/n -- every existing caller (curConfig, viewTiles,
    // viewFull) adds cfg.ned itself and reads k/n off `cur`, not off cfg. Match that.
    let cfg=null; try{ const txt=runSpecify(sum,orient,off); cfg=parseCfg(txt,m); if(cfg && !cfg.impossible) cfg.ned=netEdgeData.map(r=>r.slice()); }catch(e){ cfg=null; }
    // Reducibility is structural -- specify() decides it from the combinatorics alone -- so this
    // is settled before the solver runs and skipping costs nothing to check.
    if(st.skipRed && cfg && cfg.reducible){
      st.redThisSize++;
      st.off++; if(st.off>=m){ st.off=0; st.or++; if(st.or>1){ st.or=0; st.si++; } }
      continue;
    }
    let sol=null;
    if(cfg && !cfg.impossible && cfg.eqs && cfg.eqs.length){
      try{ sol=TilerCore.solveTile(cfg.eqs, lenGroups(cfg.whichEdge,m), m, {edgeSym:cfg.edgeSym}); }catch(e){ sol=null; }
    }
    if(sol && sol.ok){
      st.closedThisSize++;
      // No patch, no overlap test: a closing tile with a simple boundary tiles the plane (covering
      // theorem), and the solver's round-off test keeps fake closures out. The stages are the
      // census's (engine/dd_route.js evalCombo): is it a tile at all, single-tile criteria, the
      // precision guard, then blocks of 2 .. q'+r' tiles.
      const ctx={k:cur.k, n:cur.n, ned:cfg.ned, eqs:cfg.eqs, edgeSym:cfg.edgeSym, whichEdge:cfg.whichEdge, mapping:cfg.mapping};
      const cv1=dsCurveVerdict(cfg, m, sol.A, sol.L);
      let notTile=cv1.bad?cv1.reason:null, crit=null;
      let shape=cv1.shape?{...sol, A:cv1.shape.A, L:cv1.shape.L}:sol;   // the curvable family member
      if(!notTile){
        let s1=null; try{ s1=IsohedralBlock.findSmallestBlock(dsDeps(), ctx, shape.A, shape.L, {maxTiles:1}); }catch(e){}
        if(s1 && s1.invalid) notTile=s1.reason||'not a tile';
        else if(s1 && s1.found) crit=s1.criteria;
      }
      if(!notTile && !crit){
        // precision guard: a loosely converged shape can miss a criterion it really satisfies
        let sp=null; try{ sp=TilerCore.solveTile(cfg.eqs, lenGroups(cfg.whichEdge,m), m, {edgeSym:cfg.edgeSym, ...DS_HP}); }catch(e){ sp=null; }
        if(!sp || !sp.ok) notTile='degenerate at high precision';
        else {
          const cv2=dsCurveVerdict(cfg, m, sp.A, sp.L);
          shape=cv2.shape?{...sp, A:cv2.shape.A, L:cv2.shape.L}:sp; notTile=cv2.bad?cv2.reason:null;
          if(!notTile){
            let s2=null; try{ s2=IsohedralBlock.findSmallestBlock(dsDeps(), ctx, shape.A, shape.L, {maxTiles:1}); }catch(e){}
            if(s2 && s2.invalid) notTile=s2.reason||'not a tile';
            else if(s2 && s2.found) crit=s2.criteria;
          }
        }
      }
      if(notTile){
        st.notTileThisSize++;
      } else {
        st.cleanThisSize++;
        const base={m, si:st.si, sumStr:JSON.stringify(sum), or:orient, off, A:shape.A.slice(), L:shape.L.slice()};
        if(crit){
          if(st.skipIso) st.isoSkipThisSize++;
          else st.results.push({...base, kind:'isohedral', crit:crit.join(',')});
        } else {
          st.anisoThisSize++;
          // Blocks of 2 .. q'+r' tiles (the type's reduced orbit ratio) -- never a fixed number.
          const bound=dsBlockBound(st.id);
          let blk = bound==null ? 'none (no q:r for this type)' : `none up to ${bound} tiles`;
          if(bound!=null){
            try{
              const r=IsohedralBlock.findSmallestBlock(dsDeps(), ctx, shape.A, shape.L, {minTiles:2, maxTiles:bound});
              if(r && r.found) blk=`${r.criteria.join(',')}@${r.size}t`;
            }catch(e){}
          }
          // list the PRESENTABLE member of the family -- most clearance, clear of 60/90/180 and of
          // near-equal lengths where possible (John, 2026-09-13) -- so "load" opens a good shape
          let shown=null;
          try{ shown=TileDesigner.presentableShape({}, {TC:TilerCore, m, edgeSym:cfg.edgeSym, whichEdge:cfg.whichEdge, mapping:cfg.mapping, groups:lenGroups(cfg.whichEdge,m), eqs:cfg.eqs}, shape.A, shape.L); }catch(e){ shown=null; }
          st.results.push({...base, ...(shown && shown.A ? {A:shown.A.slice(), L:shown.L.slice()} : {}), kind:'anisohedral', blk});
        }
      }
    }
    st.off++;
    if(st.off>=m){ st.off=0; st.or++; if(st.or>1){ st.or=0; st.si++; } }
  }
  renderDeepSearchLive();
  if(st.active) setTimeout(deepSearchTick,0);
}

// updates only the live progress line + results list, without tearing down the whole panel
// (a full render() would rebuild the Start/Stop buttons and lose scroll position every ~25ms)
function renderDeepSearchLive(){
  const st=deepSearchState;
  const prog=$('dsProgress'); if(!prog) return;               // panel isn't showing this view right now
  const doneCombos=st.grandCombos+st.combosThisSize;
  const doneClosed=st.grandClosed+st.closedThisSize;
  const skipped = [];
  const redTot = st.grandRedSkipped + st.redThisSize, isoTot = st.grandIsoSkipped + st.isoSkipThisSize;
  const notTileTot = st.grandNotTile + st.notTileThisSize;
  if(notTileTot) skipped.push(`${notTileTot.toLocaleString()} closed but not a tile`);
  if(redTot) skipped.push(`${redTot.toLocaleString()} reducible skipped`);
  if(isoTot) skipped.push(`${isoTot.toLocaleString()} isohedral not listed`);
  const filt = skipped.length ? ` &middot; <span style="color:var(--warn,#d0a24c)">${skipped.join(' &middot; ')}</span>` : '';
  prog.innerHTML = st.active
    ? `searching m=${st.m} (up to m=${st.targetM})${st.stopAtBoundary?' -- stopping once this size finishes':''}<br>combos tried: ${doneCombos.toLocaleString()} &middot; closed: ${doneClosed.toLocaleString()} &middot; this size so far: ${st.combosThisSize} combos, ${st.cleanThisSize} valid tiles, ${st.anisoThisSize} candidate-anisohedral${filt}`
    : `stopped. sizes completed: ${st.perSize.length ? st.perSize[st.perSize.length-1].m : '(none yet)'} &middot; combos tried: ${doneCombos.toLocaleString()} &middot; closed: ${doneClosed.toLocaleString()}${filt}`;
  $('dsStart').textContent = st.active ? 'running…' : (st.perSize.length ? 'resume' : 'start');
  $('dsStart').disabled = st.active;
  $('dsStop').disabled = !st.active;
  const rl=$('dsResults'); if(!rl) return;
  // The list belongs to st.id. When another type is on screen, say so rather than showing rows
  // whose load button would build a combo for the wrong type.
  if(cur && st.id && st.id!==cur.id){
    rl.innerHTML = st.results.length
      ? `<div class="muted">${st.results.length} results held for <b>#${st.id}</b>. Switch back to that`
        + ` type to use them, or save the list. Starting a search here replaces them.</div>`
      : '<div class="muted">nothing yet</div>';
    return;
  }
  rl.innerHTML = st.results.length ? '' : '<div class="muted">nothing yet</div>';
  st.results.slice().reverse().forEach((r,ri)=>{
    const i=st.results.length-1-ri;
    const tag = r.kind==='anisohedral' ? `<b style="color:var(--bad)">ANISOHEDRAL</b> block=${r.blk}` : `isohedral (crit ${r.crit})`;
    const row=document.createElement('div');
    row.style='margin:4px 0;padding:4px 6px;border:1px solid var(--line);border-radius:5px;';
    row.innerHTML = `m=${r.m} si=${r.si} or=${r.or} off=${r.off} -- ${tag} `+
      `<button data-i="${i}" class="dsLoad" style="margin-left:6px">load</button>`+
      `<button data-i="${i}" class="dsSave">save</button>`;
    rl.appendChild(row);
  });
  // A result restored from a saved list carries no A/L -- the list is deliberately bare bones.
  // loadCombo already falls back to solveTile when `manual` is null, and the solve is deterministic
  // for a given combo, so the shape comes back identical without storing it.
  const dsShape = r => (r.A && r.L) ? {A:r.A.slice(),L:r.L.slice()} : null;
  rl.querySelectorAll('.dsLoad').forEach(b=>b.onclick=()=>{
    const r=st.results[+b.dataset.i];
    loadCombo({ id:st.id, m:r.m, sum:r.sumStr, orient:r.or, off:r.off, view:'tiles', curves:false,
      manual:dsShape(r), curveEdits:{} });
  });
  rl.querySelectorAll('.dsSave').forEach(b=>b.onclick=()=>{
    const r=st.results[+b.dataset.i];
    const c={ id:st.id, m:r.m, sum:r.sumStr, orient:r.or, off:r.off, view:'tiles', curves:false,
      manual:(r.A && r.L) ? TilerCore.roundShape(r.A, r.L) : null, curveEdits:{} };   // saved ROUNDED
    const a=document.createElement('a');
    a.download=`combo_${st.id}_m${r.m}_si${r.si}_or${r.or}_off${r.off}${r.kind==='anisohedral'?'_ANISO':''}.json`;
    a.href=URL.createObjectURL(new Blob([JSON.stringify(c,null,1)],{type:'application/json'}));
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
}

function viewDeepSearch(){
  const st=deepSearchState;
  // switched to a different type while staying on this view -- pause rather than let the
  // next tick's loadType(st.id) silently fight the freshly-picked type's state.
  if(st.active && st.id!==cur.id) st.active=false;
  // Do NOT reset here. Rendering must never destroy results. This used to call
  // deepSearchReset(cur.id) whenever st.id !== cur.id, and loading a result from the list wiped
  // that list every time -- John, 2026-09-06: "(loading one of them seems to delete the list)".
  // The chain is pickById -> refreshMatches -> selectType(SOME OTHER type) -> selectSize ->
  // render -> viewDeepSearch, so cur.id is briefly a different type in the middle of a load that
  // ends on the SAME type. Re-typing the id you are already on hit it too. Results now survive
  // any amount of that churn; they are cleared only where the user asks for it (clear / restart)
  // or by starting a genuinely new search on a different type, which asks first.
  const lo=Math.max(cur.k,cur.n);
  // A deep dive on a settled type is hours of work for an answer that is already known, so say
  // so before the Start button rather than in the results.
  const rec=verdictOf(cur.id);
  const settled = rec && rec.v==='X'
    ? `<div class="muted" style="color:#ff6b6b;margin-bottom:6px"><b>#${cur.id} is already proven
        impossible</b> (${rec.g||''}) — a search here cannot find a tiling. See the banner above.</div>`
    : rec && rec.v==='P'
    ? `<div class="muted" style="color:#36c275;margin-bottom:6px">#${cur.id} is already known to
        tile — a search here can still turn up new combos, but not a new verdict.</div>` : '';
  $('panel').innerHTML = settled + `
    <div class="muted">type <b>${idxById[cur.id].name}</b> -- searches EVERY sum-type, reflection,
    and offset at each size, from ${lo} sides up to the target. Stop only takes effect once the
    current size finishes -- a size that's only partly tried can't be trusted as a real result.</div>
    <div class="row"><label style="width:auto">search m =</label>
      <input type="number" id="dsStartM" value="${st.startM||lo}" min="${lo}" style="width:60px">
      <label style="width:auto">to</label>
      <input type="number" id="dsTargetM" value="${st.targetM}" min="${lo}" style="width:60px">
      <button id="dsStart" class="primary">${st.active?'running…':(st.perSize.length?'resume':'start')}</button>
      <button id="dsStop" ${st.active?'':'disabled'}>stop after this size</button>
      <button id="dsClear">clear / restart</button>
    </div>
    <div class="row"><label style="width:auto"><input type="checkbox" id="dsSkipIso"${st.skipIso?' checked':''}>
        skip isohedral</label>
      <label style="width:auto"><input type="checkbox" id="dsSkipRed"${st.skipRed?' checked':''}>
        skip reducible</label>
      <span class="muted">both are still counted, and the counts are shown below</span></div>
    <div class="row"><button id="dsSaveList">save results list</button>
      <button id="dsLoadList">load results list</button>
      <span id="dsListNote" class="muted"></span></div>
    <div id="dsProgress" class="muted" style="margin:6px 0"></div>
    <h3>results</h3>
    <div id="dsResults"></div>`;
  $('dsStart').onclick=()=>{
    if(st.id!==cur.id){
      if(st.results.length && !confirm(`The results list holds ${st.results.length} hits for #${st.id}.`
        + ` Starting a search on #${cur.id} discards it. Save the list first if you want to keep it.`)) return;
      deepSearchReset(cur.id);
    }
    const wantStart=Math.max(lo, +$('dsStartM').value||lo);
    st.targetM=Math.max(wantStart, +$('dsTargetM').value||st.targetM);
    // Start m only takes effect on a FRESH run. Once sizes are done, the button is a resume and
    // must continue from where it stopped -- silently jumping back would re-search finished sizes
    // and double every count in perSize.
    if(!st.perSize.length && !st.results.length){ st.startM=wantStart; st.m=wantStart; st.sums=null; }
    else if(wantStart!==st.startM){
      $('dsListNote').textContent='resuming from m='+st.m+'; use clear / restart to change the start size';
    }
    st.stopAtBoundary=false; st.active=true; renderDeepSearchLive(); deepSearchTick();
  };
  $('dsStop').onclick=()=>{ st.stopAtBoundary=true; renderDeepSearchLive(); };
  // Live, not read-once-at-start: ticking a box mid-run applies from the next combo onward. The
  // counts make that legible after the fact, and nothing already listed is retro-removed.
  $('dsSkipIso').onchange=e=>{ st.skipIso=e.target.checked; renderDeepSearchLive(); };
  $('dsSkipRed').onchange=e=>{ st.skipRed=e.target.checked; renderDeepSearchLive(); };
  $('dsClear').onclick=()=>{ if(st.active){ alert('stop the search first'); return; }
    st.startM=Math.max(lo, +$('dsStartM').value||lo);
    st.targetM=Math.max(st.startM, +$('dsTargetM').value||st.targetM);
    deepSearchReset(cur.id); viewDeepSearch(); };

  // Save the whole results list in one go. John, 2026-09-06: "after we do a deep search, it would
  // be nice to be able to save that list ... I hate to save them all manually." Bare bones only --
  // (type, m, si, orient, off) plus the verdict -- because the shape is a deterministic function
  // of the combo, so dsLoad can re-solve it on demand. sumStr rides along since it makes loading
  // robust against runSums ordering and costs almost nothing.
  $('dsSaveList').onclick=()=>{
    if(!st.results.length){ $('dsListNote').textContent='nothing to save yet'; return; }
    const payload={ kind:'mono2iso deep search results', id:st.id, name:idxById[st.id].name,
      savedAt:new Date().toISOString(), startM:st.startM, targetM:st.targetM,
      // A filtered list is not the same object as a complete one. Record what was excluded so a
      // file cannot later be mistaken for the full picture.
      skipIsohedral:st.skipIso, skipReducible:st.skipRed,
      reducibleSkipped:st.grandRedSkipped+st.redThisSize,
      isohedralNotListed:st.grandIsoSkipped+st.isoSkipThisSize,
      sizesCompleted:st.perSize.slice(), combosTried:st.grandCombos+st.combosThisSize,
      results: st.results.map(r=>({ id:st.id, m:r.m, si:r.si, sum:r.sumStr, or:r.or, off:r.off,
        kind:r.kind, crit:r.crit||'', blk:r.blk||'' })) };
    const a=document.createElement('a');
    a.download=`deepsearch_${st.id}_m${st.startM}-${st.perSize.length?st.perSize[st.perSize.length-1].m:st.m}.json`;
    a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}));
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    $('dsListNote').textContent=`saved ${st.results.length} results`;
  };
  $('dsLoadList').onclick=()=>{ if(st.active){ alert('stop the search first'); return; } $('loadDsListFile').click(); };
  renderDeepSearchLive();
}

// redraw only the canvas (used by the sliders so dragging doesn't rebuild controls)
function redrawShape(){
  const cv=$('cv'), g=cv.getContext('2d'); g.clearRect(0,0,cv.width,cv.height);
  if(!manual||!curCfg) return;
  const v=$('view').value;
  if(v==='tiles') drawTilesCanvas(g,cv); else if(v==='full') drawFullCanvas(g,cv);
}
const curvesOn=()=>$('curves').checked;
// full m-gon base + per-edge demo curve using the engine's edgeSym (0J 1U 2I 3S).
// A curve lives per edge-ORBIT: build it once on the orbit representative, then
// transport it onto each congruent edge via the engine's `mapping` code (follow
// `whichEdge` to the representative, XOR the maps along the way).  This is what
// makes congruent edges related by a tile reflection render as mirror images
// (e.g. the two S edges of #974) instead of identical copies.
// ----- editable curves -----
// A curve is stored per edge ORBIT as its editable drawn points; the symmetry (J free /
// U mirror / S point-sym / I straight) is applied by TilerCurves.buildCanon at build time,
// so U/S store the editable half (ending at the fold) and J stores the full span.
// The drawn polyline is FREEFORM — parametrised by point order, so it may loop back,
// overhang or self-touch.  It is NOT a function of x, and nothing may sort it by x.
const buildCanon = (type, pts) => TilerCurves.buildCanon(type, pts);
// Which demo motif each edge orbit gets.  Orbits are numbered in ascending rep order so
// the assignment is stable across renders, and each orbit draws a DIFFERENT motif — the
// whole point of the demo curves is to see, in the developed tiling, which edge matches
// which.  Wraps if there are more orbits than motifs.
// Straight (I) orbits draw nothing, so they must NOT consume a motif slot -- otherwise a
// tile with several I edges pushes its curved orbits onto duplicate motifs.
let curveVariant = {};
// Number each curve TYPE's orbits separately (J, U, S each start their own 0,1,2,... pool)
// instead of one shared counter across all of them. A shared counter (the original design)
// meant orbits of the SAME type could land more than 5 apart in the combined numbering and
// wrap onto the same motif -- confirmed on a real type with 4 distinct S orbits, two of which
// came out visually identical (John, 2026-08-06: "if there are 4 different S curves, we need
// 4 different shapes"). Per-type numbering guarantees up to TilerCurves.motifCount(type)
// distinct motifs PER TYPE (4 hand-drawn shapes x as-drawn/flipped = 8), regardless of how many
// other curved orbits of other types exist; beyond that it wraps and repeats a shape.
function assignCurveVariants(orbits){
  const seen=new Set(), byType={};
  for(const o of orbits){ if(o.type==='I'||seen.has(o.rep)) continue; seen.add(o.rep);
    (byType[o.type]=byType[o.type]||[]).push(o.rep); }
  curveVariant={};
  for(const type in byType) byType[type].sort((a,b)=>a-b).forEach((r,i)=>curveVariant[r]=i);
}
// editable drawn points per orbit; default = the demo curve (its first half for U/S)
function ensureCurveEdit(rep, type){
  let e=curveEdits[rep];
  // Take the motif as editor points directly.  The old code took testCurve's finished
  // (already symmetrised) curve and filtered it back to x<=0.5 to recover the half — a
  // lossy round-trip that silently drops points of any motif that is not monotone in x.
  // Also rebuild on a missing/malformed `pts` (e.g. a combo file saved under the OLDER
  // {type, ys:[...]} shape, before curves were stored as editor points) -- matching only
  // on `type` let a stale, pts-less entry slide through untouched, which crashed the
  // on-tile handle renderer (mapToEdge indexing .length on undefined) the moment such a
  // file was loaded, though buildCanon's own `!pts` guard hid the same issue elsewhere.
  if(!e || e.type!==type || !Array.isArray(e.pts)) e=curveEdits[rep]={ type, pts: TilerCurves.motifPts(type, curveVariant[rep]||0) };
  return e;
}
// ---- interactive curve editor (canonical [0,1] frame; symmetry auto-enforced) ----
// XLO/XHI/YMAX bound how far a curve point can be dragged from the edge, in canonical
// edge-length units. These used to be tight (X: -0.05..1.05, Y: +-0.42) to fit the old
// fixed-size side-panel canvas; now that editing happens directly on the tile there's no
// canvas to fit, so they're just a generous sanity bound -- widened 2026-07-23 after John
// found the old ones felt like an inexplicable "square" the curve couldn't be dragged past.
const CURVED = { W:300, H:256, pad:14, XLO:-1, XHI:2, YMAX:3 };
// UNIFORM scale: the same pixels-per-unit on both axes, so a curve in the editor is
// mathematically similar to how it renders on the edge (x:0->1 fills the width; y range
// ±YMAX fills the height, chosen so it fits at that same scale).
function curveEdGeom(){ const {W,H,pad}=CURVED, s=W-2*pad, cy=H/2;
  return { px:x=>pad+x*s, py:y=>cy-y*s, ux:p=>(p-pad)/s, uy:p=>(cy-p)/s, s, W,H,pad, YMAX:CURVED.YMAX }; }
const _clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
// fully-fixed points: (0,0) start always; (1,0) end for J; the (0.5,0) fold for S.
// (U's fold — the last point — slides vertically on x=0.5, so it's NOT fully fixed.)
function ptFixed(type,i,n){ return i===0 || (type==='J'&&i===n-1) || (type==='S'&&i===n-1); }
// freeform 2D drag: interior points move anywhere; the U fold stays on x=0.5.
function constrainDrag(ed,i,x,y){ const {type,pts}=ed, n=pts.length;
  x=_clamp(x,CURVED.XLO,CURVED.XHI); y=_clamp(y,-CURVED.YMAX,CURVED.YMAX);
  if(ptFixed(type,i,n)) return;
  if(type==='U'&&i===n-1){ pts[i]=[0.5,y]; return; }                 // U fold: x locked at 0.5
  pts[i]=[x,y]; }
// distance from point p to segment ab (all in canvas px)
function segDist(p,a,b){ const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy||1;
  let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L; t=_clamp(t,0,1);
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy)); }
// insert a point on the nearest polyline segment (never after the fold for U/S); returns its index
function insertCurvePt(ed,x,y){ const G=curveEdGeom(), pts=ed.pts, P=[G.px(x),G.py(y)];
  let bi=0,bd=1e9; for(let i=0;i<pts.length-1;i++){ const d=segDist(P,[G.px(pts[i][0]),G.py(pts[i][1])],[G.px(pts[i+1][0]),G.py(pts[i+1][1])]); if(d<bd){bd=d;bi=i;} }
  pts.splice(bi+1,0,[_clamp(x,CURVED.XLO,CURVED.XHI),_clamp(y,-CURVED.YMAX,CURVED.YMAX)]); return bi+1; }
// freeform freehand: keep the drawn stroke's ORDER (a general polyline), thin by pixel distance
function commitFreehand(ed,stroke){ const type=ed.type, G=curveEdGeom();
  const out=[]; for(const p of stroke){ const q=[_clamp(p[0],CURVED.XLO,CURVED.XHI),_clamp(p[1],-CURVED.YMAX,CURVED.YMAX)];
    if(!out.length || Math.hypot(G.px(q[0])-G.px(out[out.length-1][0]), G.py(q[1])-G.py(out[out.length-1][1]))>8) out.push(q); }
  if(out.length<2) return;
  out[0]=[0,0];
  if(type==='J') out[out.length-1]=[1,0];
  else if(type==='U') out[out.length-1]=[0.5, out[out.length-1][1]];   // fold on x=0.5
  else out[out.length-1]=[0.5,0];                                       // S fold at centre
  ed.pts=out; }
// Screen-space hit-test across EVERY editable (non-I) curve orbit at once -- points win over
// segments, whichever orbit is actually nearest. Returns {rep,kind:'point',idx} or
// {rep,kind:'segment'} or null. This is what lets hovering auto-select which curve is "live"
// (TODO.md #2's "select a curve on the tile"), replacing manual orbit-select buttons.
const POINT_HOVER_R = 12, SEG_HOVER_R = 10;   // screen px
// Place the FULL symmetrized curve (buildCanon's output -- both halves, so U/S mirror
// points are hit-testable and draggable too, not just the drawn raw half) on a specific
// member edge ei of their orbit, via the same Klein-4 code transform curveOf/applyMap use.
// `code&1` also reverses point ORDER (matching applyMap), so the returned array's index k
// corresponds to full-curve index `(code&1) ? L-1-k : k`, which TilerCurves.fullIdxToRaw
// then maps back to the underlying editable raw index (+ whether it's a mirror copy).
function mapFullPtsForEdge(ed, code){ return TilerCurves.applyMap(TilerCurves.buildCanon(ed.type, ed.pts), code||0); }
function fullIdxFor(L, code, k){ return (code&1) ? L-1-k : k; }
function nearestCurveHit(tg, sx, sy){
  const editable = edgeOrbitReps().filter(o=>o.type!=='I');
  let bestPt=null, bestPtD=1e9, bestSeg=null, bestSegD=1e9;
  for(const o of editable){
    const ed=curveEdits[o.rep]; if(!ed || !Array.isArray(ed.pts)) continue;
    const n=ed.pts.length;
    // Check EVERY member edge of this orbit, not just the rep -- a curve appears on all of
    // them on the same tile picture, and John wants any copy to be grabbable, not just one.
    for(const ei of o.edges){
      const code = tg.codeOf ? tg.codeOf[ei] : 0;
      const mapped = mapFullPtsForEdge(ed, code), L = mapped.length;
      const scr = TilerCurves.mapToEdge(mapped, tg.baseMgon[ei], tg.baseMgon[(ei+1)%tg.m], false).map(tg.TR);
      scr.forEach((q,k)=>{ const d=Math.hypot(q[0]-sx,q[1]-sy);
        if(d<bestPtD){ const rm=TilerCurves.fullIdxToRaw(ed.type,n,fullIdxFor(L,code,k));
          bestPtD=d; bestPt={rep:o.rep, idx:rm.r, mirror:rm.mirror, ei, code}; } });
      for(let k=0;k<scr.length-1;k++){ const d=segDist([sx,sy],scr[k],scr[k+1]);
        if(d<bestSegD){ const mA=TilerCurves.fullIdxToRaw(ed.type,n,fullIdxFor(L,code,k)).mirror;
          const mB=TilerCurves.fullIdxToRaw(ed.type,n,fullIdxFor(L,code,k+1)).mirror;
          bestSegD=d; bestSeg={rep:o.rep, ei, code, mirror:mA||mB}; } }
    }
  }
  if(bestPt && bestPtD<POINT_HOVER_R) return {rep:bestPt.rep, kind:'point', idx:bestPt.idx, mirror:bestPt.mirror, ei:bestPt.ei, code:bestPt.code};
  if(bestSeg && bestSegD<SEG_HOVER_R) return {rep:bestSeg.rep, kind:'segment', ei:bestSeg.ei, code:bestSeg.code, mirror:bestSeg.mirror};
  return null;
}
// On-tile curve editing, directly on the rendered tile (TODO.md #2's "select a curve on the
// tile and edit it in place") -- no mode/orbit buttons: hover a point and drag to move it,
// hover empty curve and drag to insert+move a new point there, right-click a point to delete
// it. Freehand and a redesigned reset flow are explicitly out of scope for now (John,
// 2026-07-23) -- the old "reset this" button stays, now just tied to whatever curveSel hover
// last landed on. Coordinates go screen -> tg.invTR -> world (tile-local) ->
// TilerCurves.unmapFromEdge -> canonical (x,y), the inverse of the mapToEdge placement
// drawCurveHandles uses to put the handles on screen in the first place.
// Also wires wheel-zoom/dblclick-reset for panel 0 (independent of curves being on).
function wireTileCurveEdit(cv){ let dragging=false, dragEi=null, dragCode=0, dragMirror=false;
  const pos=e=>{ const r=cv.getBoundingClientRect();
    return [(e.clientX-r.left)*cv.width/r.width, (e.clientY-r.top)*cv.height/r.height]; };
  // screen -> world (via the SPECIFIC edge instance ei's own placement) -> "as displayed on
  // ei" canonical -> undo ei's code transform (self-inverse) to recover the RAW canonical in
  // the rep's own frame, i.e. ed.pts' own coordinates -- lets any congruent copy of a curve
  // be dragged/added-to, not just the orbit rep's own edge.
  const toCanonFor=(tg,ei,code,sx,sy)=>{
    const d=TilerCurves.unmapFromEdge(tg.baseMgon[ei], tg.baseMgon[(ei+1)%tg.m], tg.invTR([sx,sy]));
    return [ (code&1) ? 1-d[0] : d[0], (code&2) ? -d[1] : d[1] ];
  };
  const inPanelZero=sx=>sx < cv.width/2;    // panel 0 is the left half now that orbit 1 is gone

  cv.onwheel=e=>{
    const view=$('view').value;
    if(view==='tiles'){
      if(!panelZeroGeom) return;
      const [sx,sy]=pos(e); if(!inPanelZero(sx)) return;
      e.preventDefault();
      const world=panelZeroGeom.invTR([sx,sy]);
      tileZoom.cx=world[0]; tileZoom.cy=world[1];             // recentre on the cursor, then scale --
      tileZoom.scale=Math.min(20,Math.max(1, tileZoom.scale*(e.deltaY<0?1.15:1/1.15)));  // simple "zoom toward pointer" feel
      redrawShape();
    } else if(view==='full'){
      if(!fullGeom) return;
      e.preventDefault();                                    // also stops ctrl+scroll from zooming the whole page
      const [sx,sy]=pos(e), world=fullGeom.invTR([sx,sy]);
      fullZoom.cx=world[0]; fullZoom.cy=world[1];
      fullZoom.scale=Math.min(50,Math.max(1, fullZoom.scale*(e.deltaY<0?1.15:1/1.15)));
      redrawShape();
    }
  };
  cv.ondblclick=e=>{ const view=$('view').value;
    if(view==='tiles'){ if(!panelZeroGeom) return; const [sx,sy]=pos(e); if(!inPanelZero(sx)) return;
      tileZoom={scale:1,cx:null,cy:null}; redrawShape(); }
    else if(view==='full'){ if(!fullGeom) return;
      fullZoom={scale:1,cx:null,cy:null}; redrawShape(); } };

  // tileEditGeom is only refreshed by drawTilesCanvas (the "tiles" view) with curves on;
  // guard on the view dropdown too -- otherwise a click on the full-tiling canvas could
  // silently apply a curve edit computed against the wrong picture.
  cv.onmousedown=e=>{
    if($('view').value==='full'){ const [fx,fy]=pos(e); if(beginFullCornerDrag(fx,fy)) e.preventDefault(); return; }
    if($('view').value!=='tiles')return;
    const [sx,sy]=pos(e);
    const tg=tileEditGeom;
    // A curve control point wins over a corner when both are under the cursor: the curve
    // handles are the smaller, more precise target, and a corner is always reachable by
    // grabbing a little further round the outline.
    const hit=tg?nearestCurveHit(tg,sx,sy):null;
    if(!hit){ if(beginCornerDrag(sx,sy)) e.preventDefault(); return; }
    if(!tg)return;
    e.preventDefault(); curveSel=hit.rep; const ed=curveEdits[curveSel]; if(!ed)return;
    // A drag makes this orbit's curve John's, whatever it was before (a default motif, or an old
    // auto-repair the gallery saved back). Drop the auto flag now, at the start of the gesture, so
    // tile_designer.js never overwrites a curve he is actively touching.
    delete ed.auto;
    dragEi=hit.ei; dragCode=hit.code||0;               // remember WHICH copy was grabbed, for the drag's duration
    dragMirror=!!hit.mirror;    // grabbed/inserted point is on the U/S mirror half -- keep un-mirroring every move
    if(hit.kind==='point') curveSelPt=hit.idx;
    else { let [x,y]=toCanonFor(tg,dragEi,dragCode,sx,sy); if(dragMirror) [x,y]=TilerCurves.mirrorPt(ed.type,[x,y]);
      curveSelPt=insertCurvePt(ed,x,y); }  // add-then-drag in one motion
    dragging=true; redrawShape(); };
  cv.onmousemove=e=>{
    if($('view').value==='full'){
      const [fx,fy]=pos(e);
      if(cornerDrag&&cornerDrag.full){ moveFullCornerDrag(fx,fy); return; }
      const hit=nearestFullCorner(fullCornerGeom,fx,fy);
      // keep the handles on the tile the cursor is over, even between its corners, so they don't
      // flicker away the moment you move off a handle towards the one next to it
      const tileIdx = hit ? hit.tileIdx : (fullHover&&tileUnder(fullCornerGeom,fx,fy));
      const next = tileIdx==null||tileIdx<0 ? null : {tileIdx, vi:hit?hit.vi:-1};
      const changed = JSON.stringify(next)!==JSON.stringify(fullHover);
      fullHover=next;
      if(hit){ const r=fullCornerGeom.ranks&&fullCornerGeom.ranks[hit.vi];
        cv.style.cursor=(r&&r.rank)?'grab':'not-allowed'; }
      else cv.style.cursor='default';
      if(changed) redrawShape();
      return;
    }
    if($('view').value!=='tiles')return;
    const [sx,sy]=pos(e);
    if(cornerDrag){ moveCornerDrag(sx,sy); return; }
    const tg=tileEditGeom;
    if(dragging){ if(!tg)return; const ed=curveEdits[curveSel]; if(!ed||curveSelPt<0)return;
      let [x,y]=toCanonFor(tg,dragEi,dragCode,sx,sy); if(dragMirror) [x,y]=TilerCurves.mirrorPt(ed.type,[x,y]);
      constrainDrag(ed,curveSelPt,x,y); redrawShape(); return; }
    // not dragging: live hover feedback drives which curve/point highlights and the cursor
    const hit=tg?nearestCurveHit(tg,sx,sy):null;
    curveHover=hit?{...hit,sx,sy}:null;   // sx/sy let drawCurveHandles show the add-point preview
    if(hit) curveSel=hit.rep;                    // active orbit follows the mouse (TODO.md #2)
    curveSelPt = (hit && hit.kind==='point') ? hit.idx : -1;
    const corner = hit ? -1 : nearestCorner(cornerGeom,sx,sy);
    const changed = corner!==cornerHover; cornerHover=corner;
    if(corner>=0){ const r=cornerGeom.ranks&&cornerGeom.ranks[cornerGeom.idx[corner]];
      cv.style.cursor = (r&&r.rank) ? 'grab' : 'not-allowed'; }
    else cv.style.cursor = hit ? (hit.kind==='point'?'grab':'copy') : 'default';
    if(hit||changed||curveHover) redrawShape(); };
  const endDrag=()=>{ dragging=false; if(cornerDrag) endCornerDrag(); };
  cv.onmouseup=endDrag;
  cv.onmouseleave=()=>{ endDrag(); curveHover=null; cornerHover=-1; fullHover=null; cv.style.cursor='default'; };
  cv.oncontextmenu=e=>{ if($('view').value!=='tiles')return; const tg=tileEditGeom; if(!tg)return;
    const [sx,sy]=pos(e), hit=nearestCurveHit(tg,sx,sy);
    if(!hit || hit.kind!=='point') return;       // let the browser's normal menu show elsewhere
    e.preventDefault();
    const ed=curveEdits[hit.rep];
    if(ed && !ptFixed(ed.type,hit.idx,ed.pts.length) && ed.pts.length>2){
      delete ed.auto;                    // deleting a point is a hand edit too
      ed.pts.splice(hit.idx,1); curveSelPt=-1; curveHover=null; redrawShape();
    } }; }
// ---------- on-tile corner dragging ----------
// Grab a corner of the m-gon and pull it; TilerCore.dragVertex re-solves the closing family so
// the tile stays closed, and everything downstream (curves, develop, the sliders) reads the new
// manual.A/manual.L exactly as if a slider had moved. The whole gesture is solved against ONE
// reference shape, snapshotted here -- that is what makes the drag reversible rather than
// ratcheting, so the reference must NOT be refreshed per frame.
function beginCornerDrag(sx,sy){
  if(!cornerGeom||!manual||!curCfg||!curCfg.eqs||!panelZeroGeom) return false;
  const c=nearestCorner(cornerGeom,sx,sy); if(c<0) return false;
  const vi=cornerGeom.idx[c], r=cornerGeom.ranks&&cornerGeom.ranks[vi];
  if(!r||!r.rank){ cornerNote='corner v'+vi+' is fixed by the type — nothing to drag there'; redrawShape(); return true; }
  const groups=lenGroups(curCfg.whichEdge,curM);
  const F=TilerCore.familyFns(curCfg.eqs,groups,curM);
  // The overall scale sits OUTSIDE u (unpack normalises the first length group to 1), so carry
  // it by hand and put it back on every result -- the same bookkeeping activateFamily does with
  // famScale, and for the same reason: without it the tile silently resizes on the first frame.
  const scale=manual.L[groups[0][0]]||1;
  const u=F.toU(manual.A,manual.L), un=F.unpack(u);
  cornerDrag={ corner:c, vi, groups, F, scale, u,
    ref: TilerCore.verticesOf(un.A,un.L,curM).slice(0,curM),   // reference for the gesture, in u's own frame
    startVerts: TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM).map(frameOf),  // where the eye last saw it
    hold: panelZeroGeom };                                     // freeze the fit for the gesture
  cornerNote=''; redrawShape(); return true;
}
function moveCornerDrag(sx,sy){
  const D=cornerDrag; if(!D) return;
  // screen -> the frame the tile is DRAWN in -> the frame verticesOf works in
  const wf=D.hold.invTR([sx,sy]);
  const w=shapeFrame?TilerCore.applySim(TilerCore.invSim(shapeFrame),wf):wf;
  const v=TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM);
  // dragVertex lives in u's normalised-length frame, which is this one divided by D.scale
  const delta=[(w[0]-v[D.vi][0])/D.scale, (w[1]-v[D.vi][1])/D.scale];
  const r=TilerCore.dragVertex(curCfg.eqs,D.groups,curM,D.u,D.vi,delta,{ref:D.ref});
  if(r.ok){
    D.u=r.u; manual={A:r.A.slice(), L:r.L.map(x=>x*D.scale)};
    if(familyState){                                  // keep the true-parameter sliders honest
      familyState.u=r.u.slice(); familyState.scale=D.scale;
      familyState.drivers.forEach(d=>{ d.val=r.u[d.u]; });
    }
    cornerNote='';
  } else cornerNote='as far as this shape goes: '+(r.reason||'no free direction');
  // Re-fit the drawing onto where the gesture started. dragVertex solves up to a similarity, so
  // without this the tile arrives rotated/scaled and the corner leaves the cursor.
  shapeFrame=TilerCore.rigidFit(TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM), D.startVerts);
  redrawShape();
}
function endCornerDrag(){
  cornerDrag=null;
  renderTilesControls();     // the sliders now read the dragged shape
  redrawShape();
}
/* Scripting hooks. The shape state lives in `let` bindings at script scope, which are NOT
   properties of window, so a test driving this page from Playwright cannot see any of it --
   same reason netshape.html exposes window.__edit / window.__latHandles. Read-only views. */
window.__tile = () => ({ id: cur && cur.id, m: curM, A: manual && manual.A.slice(), L: manual && manual.L.slice(),
  gap: manual ? TilerCore.gapOf(manual.A, manual.L, curM) / Math.max(...manual.L) : null,
  ranks: cornerGeom && cornerGeom.ranks && cornerGeom.ranks.map(r => r.rank),
  verts: manual ? TilerCore.verticesOf(manual.A, manual.L, curM).slice(0, curM).map(frameOf) : null,
  dragging: !!cornerDrag, note: cornerNote, framed: !!shapeFrame });
// page coordinates of every draggable corner, for a scripted drag
window.__cornerHandles = () => {
  if (!cornerGeom) return [];
  const cv = $('cv'), b = cv.getBoundingClientRect();
  const toPage = q => [b.left + q[0] * b.width / cv.width, b.top + q[1] * b.height / cv.height];
  return cornerGeom.idx.map((vi, c) => {
    const R = (cornerGeom.ranks && cornerGeom.ranks[vi]) || { rank: 0, dirs: [] };
    const q = cornerGeom.TR(cornerGeom.verts[vi]), p = toPage(q);
    // for a rank-1 corner, the one line it may travel along, as a unit vector in PAGE
    // coordinates -- a scripted drag has to push along it to test tracking at all
    let dirPage = null;
    if (R.rank === 1) {
      const w = toPage(cornerGeom.TR([cornerGeom.verts[vi][0] + R.dirs[0][0], cornerGeom.verts[vi][1] + R.dirs[0][1]]));
      const ax = w[0] - p[0], ay = w[1] - p[1], L = Math.hypot(ax, ay) || 1;
      dirPage = [ax / L, ay / L];
    }
    return { c, vi, rank: R.rank, canvas: q, page: p, dirPage };
  });
};
// Load a combo object (the same shape `save combo` writes) straight in, for scripted checks --
// the file input needs a real user gesture, which a test cannot supply.
window.__loadCombo = c => { loadCombo(c); return true; };
// what the live drag is actually holding, and the base-frame displacement it last computed
window.__dragState = () => cornerDrag && { full: !!cornerDrag.full, tileIdx: cornerDrag.tileIdx,
  vi: cornerDrag.vi, corner: cornerDrag.corner, scale: cornerDrag.scale, lastDelta: cornerDrag.lastDelta };
// the same for the developed tiling: every copy's corners, so a scripted drag can grab one
window.__fullCornerHandles = (tileIdx) => {
  const fg = fullCornerGeom; if (!fg || !fg.ranks) return [];
  const cv = $('cv'), b = cv.getBoundingClientRect(), out = [];
  const tiles = tileIdx == null ? fg.placed.map((_, i) => i) : [tileIdx];
  const toPage = q => [b.left + q[0] * b.width / cv.width, b.top + q[1] * b.height / cv.height];
  for (const t of tiles) { const pv = fullPoly(fg, t); for (let i = 0; i < fg.m; i++) {
    const R = fg.ranks[i] || { rank: 0, dirs: [] };
    const q = fg.TR(pv[i]), p = toPage(q);
    let dirPage = null;
    if (R.rank === 1) {
      const w = toPage(fg.TR(fullPt(fg, t, [fg.rawVerts[i][0] + R.dirs[0][0], fg.rawVerts[i][1] + R.dirs[0][1]])));
      const ax = w[0] - p[0], ay = w[1] - p[1], L = Math.hypot(ax, ay) || 1;
      dirPage = [ax / L, ay / L];
    }
    out.push({ tileIdx: t, vi: i, rank: R.rank, canvas: q, page: p, dirPage });
  } }
  return out;
};
// context for engine/tile_designer.js: the same eqs/whichEdge/mapping/groups every other family
// helper here uses (see activateFamily, curveSet). Deps are the window globals tile_designer.js
// otherwise defaults to on its own; passed explicitly so a future second core (tiler_core.js vs
// the _revpivot fork this page loads) is never a silent mismatch.
function designerCtx(){
  if(!curCfg || !curCfg.whichEdge) return null;
  return { TC: TilerCore, m: curM, edgeSym: curCfg.edgeSym, whichEdge: curCfg.whichEdge, mapping: curCfg.mapping,
           groups: lenGroups(curCfg.whichEdge, curM), eqs: curCfg.eqs };
}
function designerDeps(){ return { CHK: TilingChecks, CD: CurveDesigner, TCurves: TilerCurves }; }
// Run the curve designer automatically on a FRESHLY loaded/solved combo, so a new type or a saved
// witness never opens showing a demo motif that crosses or pinches -- John, 2026-09-11: "could we
// use this method when we load a new combo that we are testing?" Called exactly where curveEdits
// is known to be empty or freshly loaded (ensureSolve's first solve, loadCombo), never on every
// render -- an expensive search on every redraw would make sliders sluggish for no reason, since
// nothing about the diagnosis changes between a click on "design curves" and a slider drag that
// doesn't touch the corner in question. designCurves() itself freezes any orbit that already
// carries a genuine hand edit (see tile_designer.js's isGeneratedMotif), so this is always safe to
// call even when curveEdits is partially populated from a saved file -- it can only ever move an
// orbit nothing has drawn yet.
function autoDesignIfNeeded(){
  if(!manual || !curCfg || !curCfg.whichEdge || typeof TileDesigner==='undefined') return;
  const ctx=designerCtx();
  let diag; try{ diag=TileDesigner.diagnose(designerDeps(), ctx, manual.A, manual.L); }catch(e){ return; }
  if(diag.verdict!=='curves required') return;
  let res; try{ res=TileDesigner.designCurves(designerDeps(), ctx, manual.A, manual.L, curveEdits, diag, {}); }
  catch(e){ return; }
  if(!(res.clearance>1e-6)) return;      // could not open it automatically; leave curveEdits as-is,
                                          // the "shape check" line will say so and offer the button
  Object.keys(res.curveEdits).forEach(rep=>{ curveEdits[rep]=res.curveEdits[rep]; });
  designNote='curves auto-designed on load: clearance '+res.clearance.toExponential(2)+' of the tile diameter (drag any point to make it yours)';
}
// distinct edge orbits of the current config: {rep, type, edges:[m-gon edge ids]}
function edgeOrbitReps(){
  const m=curM, we=curCfg.whichEdge||[], es=curCfg.edgeSym||[];
  const repOf=i=>{ let c=i, guard=0; while(we[c]!=null && we[c]!==c && guard++<m) c=we[c]; return c; };
  const reps={};
  for(let i=0;i<m;i++){ const r=repOf(i);
    (reps[r]=reps[r]||{rep:r, type:TilerCurves.SYM[es[r]]||'J', edges:[]}).edges.push(i); }
  return Object.values(reps);
}
function curveSet(){
  const m=curM;
  const baseMgon=TilerCore.verticesOf(manual.A,manual.L,m).slice(0,m);
  const es=curCfg.edgeSym||[], we=curCfg.whichEdge||[], mp=curCfg.mapping||[];
  const repMap=i=>{ let cur=i, code=0, guard=0;
    while(we[cur]!=null && we[cur]!==cur && guard++<m){ code^=(mp[cur]||0); cur=we[cur]; }
    return {rep:cur, code}; };
  const rc=[]; for(let i=0;i<m;i++){ const r=repMap(i); r.type=TilerCurves.SYM[es[r.rep]]||'J'; rc.push(r); }
  assignCurveVariants(rc);                          // stable motif per orbit, before any default is built
  const curveOf=[];
  for(let i=0;i<m;i++){ const {rep,code,type}=rc[i];
    const ed=ensureCurveEdit(rep, type);            // edited (or default) canonical curve
    curveOf.push(TilerCurves.applyMap(buildCanon(type, ed.pts), code)); }
  // codeOf[i]: the Klein-4 code (0J 1 rev 2 negate 3 both) that places edge i's curve relative
  // to its orbit's rep -- i.e. i===rep always has code 0. Exposed so on-tile editing (which
  // only has the RAW editable points, not the symmetrized curveOf) can place/read the same
  // points on every congruent edge, not just the rep's own.
  return {baseMgon,curveOf,codeOf:rc.map(r=>r.code)};
}
function drawTilesCanvas(g,cv){
  const m=curM,ned=curCfg.ned,k=cur.k;
  // Everything drawn here goes through frameOf: the tile is solved in verticesOf's pinned
  // gauge, and shapeFrame is what holds it still on screen across a corner drag. It is a
  // similarity, so it commutes with every placement below (curves included -- mapToEdge builds
  // its local frame from the two endpoints it is given).
  const walk=TilerCore.verticesOf(manual.A,manual.L,m).map(frameOf);   // m+1 pts: v[m] = where it lands
  const verts=walk.slice(0,m);
  // Build orbit 0's tile as the FULL m-gon by walking its net edges (a |size|>1 edge spans
  // several m-gon sides, so collect every traversed vertex — not just beginAt, which drops
  // the intermediate corners of multi-segment edges and renders the orbit too small).
  // Orbit 1 is congruent to orbit 0 by construction (this is a MONOHEDRAL solve -- one tile
  // shape serving both orbits, the whole research question) and used to be drawn a second
  // time purely to confirm that visually; John: "we only need one copy of it" -- dropped
  // 2026-07-23, which also frees up the panel width for editing.
  // ...also record which verticesOf index each drawn corner is, so a corner handle can be
  // handed straight to TilerCore.dragVertex. Every m-gon side belongs to exactly one orbit-0
  // net edge, so this visits all m of them, permuted.
  const polyIdx=[];
  const orbitPoly=(lo,hi)=>{const out=[];for(let j=lo;j<hi;j++){const step=1-2*ned[6][j],sz=Math.abs(ned[4][j]);let v=ned[5][j];
    for(let s=0;s<sz;s++){const vi=((v%m)+m)%m; out.push(verts[vi]); if(lo===0)polyIdx.push(vi); v+=step;}}return out;};
  const poly0=orbitPoly(0,k);
  // Only claim the corners if handles will actually be drawn on them -- if the reachability
  // solve failed there are no handles, and suppressing the plain dots too would leave the
  // corners unmarked altogether.
  const ranks=cornerRanks();
  let t0={verts:poly0,col:'#bcd9ff',lbl:'orbit 0 ('+m+'-gon)',cross:polyCross(poly0),zoom:tileZoom,hold:cornerDrag&&cornerDrag.hold,handles:!!ranks};   // flag crossing sides
  let cs=null, bm=null;
  if(curvesOn()){ cs=curveSet(); bm=cs.baseMgon.map(frameOf); const pts=TilerCurves.curvedTile(bm,cs.curveOf);
    t0={verts:pts,col:'#bcd9ff',lbl:'orbit 0 (curved m-gon)',curve:true,zoom:tileZoom,hold:cornerDrag&&cornerDrag.hold}; }
  const geoms=drawTwoTiles(g,cv,[t0,{verts:walk,col:'#e8e8ea',lbl:'edge walk + gap',open:true}]);
  // panelZeroGeom backs pan/zoom (wireTileCurveEdit's wheel/dblclick handlers) regardless of
  // curvesOn() -- zoom works on the plain skeleton too, not just while editing curves.
  panelZeroGeom = geoms[0];
  // On-tile curve editing: draggable handles drawn on panel 0 (the one tile shown).
  // tileEditGeom is read by wireTileCurveEdit's mouse handlers (wired once on
  // #cv), which need this render's fresh transform/baseMgon every time the tile changes.
  tileEditGeom = (cs && curveSel!=null) ? {TR:geoms[0].TR, invTR:geoms[0].invTR, baseMgon:bm, m, codeOf:cs.codeOf} : null;
  if(tileEditGeom) drawCurveHandles(g, tileEditGeom, cs);
  // Corner handles last, so they sit on top of the curve handles they may share a pixel with.
  cornerGeom = {TR:geoms[0].TR, invTR:geoms[0].invTR, verts, idx:polyIdx, m, ranks};
  drawCornerHandles(g, cornerGeom);
  setShapeStatus();
}
// Reachability of every corner, cached per (config, shape) so hover doesn't re-derive the null
// space on each mouse move. TilerCore.vertexFields is a handful of finite-difference solves --
// cheap next to a redraw, but not free, and mousemove fires constantly.
let _rankCache = null;
function cornerRanks(){
  if(!manual||!curCfg||!curCfg.eqs) return null;
  const key=manual.A.join(',')+'|'+manual.L.join(',');
  if(_rankCache && _rankCache.key===key) return _rankCache.ranks;
  let ranks=null;
  try{
    const groups=lenGroups(curCfg.whichEdge,curM);
    const F=TilerCore.familyFns(curCfg.eqs,groups,curM);
    ranks=TilerCore.vertexFields(curCfg.eqs,groups,curM,F.toU(manual.A,manual.L)).ranks;
  }catch(e){ ranks=null; }
  _rankCache={key,ranks};
  return ranks;
}
const CORNER_HOVER_R = 13;
// Which drawn corner is under the cursor (index into cornerGeom.idx), or -1.
function nearestCorner(cg,sx,sy){
  if(!cg) return -1;
  let best=-1,bd=CORNER_HOVER_R;
  cg.idx.forEach((vi,c)=>{ const q=cg.TR(cg.verts[vi]), d=Math.hypot(q[0]-sx,q[1]-sy); if(d<bd){bd=d;best=c;} });
  return best;
}
// Corner handles, styled by how much freedom the closing family actually leaves each one:
// a filled disc moves anywhere, a bar slides along its one reachable line, a hollow ring is
// frozen. Same distinction netshape's editor draws, and for the same reason -- a rank-1 handle
// asked to chase a 2-D pointer is what produces jitter.
//
// These have to read as CONTROLS, not as part of the drawing. The first version drew 5px discs
// with no outline, straight on top of the plain black vertex dots and their grey v0..vn labels,
// and John's reaction on #1727337 was "I don't see how to drag the tile's corners" -- the drag
// worked, the handles just looked like decoration. Hence the white halo (which separates them
// from both the tile fill and the outline at any zoom), the longer bar with end caps, and
// drawOneTile skipping its own dot wherever a handle lands.
function drawCornerHandles(g,cg){
  if(!cg||!cg.ranks) return;
  const many=cg.m>24, R=many?4:6, BAR=many?9:14;      // stay legible on a 64-gon
  cg.idx.forEach((vi,c)=>{
    const r=cg.ranks[vi]||{rank:0,dirs:[]}, q=cg.TR(cg.verts[vi]);
    const live=(cornerDrag&&cornerDrag.corner===c), hot=live||cornerHover===c;
    const col=hot?'#e74c3c':'#2f7fe8';
    if(r.rank===1){                                   // show WHICH line it may travel along
      const d=r.dirs[0], w=cg.TR([cg.verts[vi][0]+d[0],cg.verts[vi][1]+d[1]]);
      let ax=w[0]-q[0], ay=w[1]-q[1]; const L=Math.hypot(ax,ay)||1; ax/=L; ay/=L;
      const b=hot?BAR+3:BAR;
      g.lineCap='round';
      g.strokeStyle='#fff'; g.lineWidth=hot?7:6;      // halo first, so the bar reads over the tile
      g.beginPath(); g.moveTo(q[0]-ax*b,q[1]-ay*b); g.lineTo(q[0]+ax*b,q[1]+ay*b); g.stroke();
      g.strokeStyle=col; g.lineWidth=hot?4:3;
      g.beginPath(); g.moveTo(q[0]-ax*b,q[1]-ay*b); g.lineTo(q[0]+ax*b,q[1]+ay*b); g.stroke();
      g.lineCap='butt';
    }
    if(r.rank===0){                                   // frozen: hollow, greyed, no halo needed
      g.strokeStyle='#fff'; g.lineWidth=4; g.beginPath(); g.arc(q[0],q[1],R-1,0,7); g.stroke();
      g.strokeStyle='#9aa0ad'; g.lineWidth=2; g.beginPath(); g.arc(q[0],q[1],R-1,0,7); g.stroke();
      return;
    }
    const rr=hot?R+2:R;
    g.fillStyle='#fff'; g.beginPath(); g.arc(q[0],q[1],rr+2,0,7); g.fill();
    g.fillStyle=col;    g.beginPath(); g.arc(q[0],q[1],rr,0,7); g.fill();
    // a rank-2 handle gets a white pip, so "free in the plane" is distinguishable from the
    // bar's own dot at a glance rather than only by shape
    if(r.rank===2){ g.fillStyle='#fff'; g.beginPath(); g.arc(q[0],q[1],rr*0.34,0,7); g.fill(); }
  });
}
// ---------- corner handles in the FULL tiling view ----------
// Where raw base vertex `p` of placed tile `t` lands on screen-world: that copy's own transform,
// then the view frame that pins the grabbed copy.
const fullPt=(fg,t,p)=>{ const q=TilerCore.applyT(fg.placed[t].T, p);
  return fg.frame ? TilerCore.applySim(fg.frame, q) : q; };
// the drawn polygon of copy t, frame included
const fullPoly=(fg,t)=>fg.frame ? fg.placed[t].verts.map(p=>TilerCore.applySim(fg.frame,p)) : fg.placed[t].verts;
// invert an affine 2x3 [a,b,c,d,e,f] with ap(T,p)=[a*x+b*y+e, c*x+d*y+f]
function invAffine(T){
  const det=T[0]*T[3]-T[1]*T[2]; if(!det) return null;
  const a= T[3]/det, b=-T[1]/det, c=-T[2]/det, d= T[0]/det;
  return [a,b,c,d, -(a*T[4]+b*T[5]), -(c*T[4]+d*T[5])];
}
// nearest corner across the whole patch: {tileIdx, vi} or null
function nearestFullCorner(fg,sx,sy){
  if(!fg||!fg.ranks) return null;
  let best=null,bd=CORNER_HOVER_R;
  for(let t=0;t<fg.placed.length;t++){
    const pv=fullPoly(fg,t);
    for(let i=0;i<fg.m;i++){
      const q=fg.TR(pv[i]), d=Math.hypot(q[0]-sx,q[1]-sy);
      if(d<bd){ bd=d; best={tileIdx:t, vi:i}; }
    }
  }
  return best;
}
// index of the developed tile containing a screen point, or -1
function tileUnder(fg,sx,sy){
  if(!fg) return -1;
  for(let t=0;t<fg.placed.length;t++){
    const pv=fullPoly(fg,t); let inside=false;
    for(let i=0,j=fg.m-1;i<fg.m;j=i++){
      const a=fg.TR(pv[i]), b=fg.TR(pv[j]);
      if(((a[1]>sy)!==(b[1]>sy)) && (sx<(b[0]-a[0])*(sy-a[1])/(b[1]-a[1])+a[0])) inside=!inside;
    }
    if(inside) return t;
  }
  return -1;
}
function drawFullCornerHandles(g,fg,t){
  if(!fg.ranks) return;
  const pv=fullPoly(fg,t);
  // outline the live tile, so it is clear WHICH copy the handles belong to
  g.strokeStyle='#2f7fe8'; g.lineWidth=2.5;
  g.beginPath(); pv.forEach((p,i)=>{const q=fg.TR(p); i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);}); g.closePath(); g.stroke();
  for(let i=0;i<fg.m;i++){
    const r=fg.ranks[i]||{rank:0,dirs:[]}, q=fg.TR(pv[i]);
    const hot=(cornerDrag&&cornerDrag.full&&cornerDrag.vi===i)||(fullHover&&fullHover.tileIdx===t&&fullHover.vi===i);
    const col=hot?'#e74c3c':'#2f7fe8';
    if(r.rank===1){
      // the reachable line lives in BASE coordinates -- push it through the same frame and copy
      // transform as the corner itself to get its direction on screen
      const w=fg.TR(fullPt(fg,t,[fg.rawVerts[i][0]+r.dirs[0][0], fg.rawVerts[i][1]+r.dirs[0][1]]));
      let ax=w[0]-q[0], ay=w[1]-q[1]; const L=Math.hypot(ax,ay)||1; ax/=L; ay/=L;
      const b=hot?13:10;
      g.lineCap='round';
      g.strokeStyle='#fff'; g.lineWidth=hot?7:6;
      g.beginPath(); g.moveTo(q[0]-ax*b,q[1]-ay*b); g.lineTo(q[0]+ax*b,q[1]+ay*b); g.stroke();
      g.strokeStyle=col; g.lineWidth=hot?4:3;
      g.beginPath(); g.moveTo(q[0]-ax*b,q[1]-ay*b); g.lineTo(q[0]+ax*b,q[1]+ay*b); g.stroke();
      g.lineCap='butt';
    }
    if(r.rank===0){
      g.strokeStyle='#fff'; g.lineWidth=4; g.beginPath(); g.arc(q[0],q[1],4,0,7); g.stroke();
      g.strokeStyle='#9aa0ad'; g.lineWidth=2; g.beginPath(); g.arc(q[0],q[1],4,0,7); g.stroke();
      continue;
    }
    const rr=hot?7:5;
    g.fillStyle='#fff'; g.beginPath(); g.arc(q[0],q[1],rr+2,0,7); g.fill();
    g.fillStyle=col;    g.beginPath(); g.arc(q[0],q[1],rr,0,7); g.fill();
    if(r.rank===2){ g.fillStyle='#fff'; g.beginPath(); g.arc(q[0],q[1],rr*0.34,0,7); g.fill(); }
  }
}
function beginFullCornerDrag(sx,sy){
  if(!fullCornerGeom||!manual||!curCfg||!curCfg.eqs||!fullGeom) return false;
  const hit=nearestFullCorner(fullCornerGeom,sx,sy); if(!hit) return false;
  const r=fullCornerGeom.ranks[hit.vi];
  if(!r||!r.rank){ cornerNote='corner v'+hit.vi+' is fixed by the type — nothing to drag there'; redrawShape(); return true; }
  const groups=lenGroups(curCfg.whichEdge,curM);
  const F=TilerCore.familyFns(curCfg.eqs,groups,curM);
  const scale=manual.L[groups[0][0]]||1;
  const u=F.toU(manual.A,manual.L), un=F.unpack(u);
  cornerDrag={ full:true, tileIdx:hit.tileIdx, vi:hit.vi, groups, F, scale, u,
    ref: TilerCore.verticesOf(un.A,un.L,curM).slice(0,curM),
    // the grabbed COPY as it stands right now -- every later frame is fitted back onto this, so
    // the tile you are holding stays put and only the rest of the patch flexes around it
    startTileVerts: fullPoly(fullCornerGeom,hit.tileIdx),
    win: fullCornerGeom.placed && fullCornerGeom.placed.win,   // lattice drawing window, frozen so tileIdx keeps naming this copy
    hold: fullGeom };
  cornerNote=''; redrawShape(); return true;
}
function moveFullCornerDrag(sx,sy){
  const D=cornerDrag; if(!D||!fullCornerGeom) return;
  const T=fullCornerGeom.placed[D.tileIdx] && fullCornerGeom.placed[D.tileIdx].T;
  const Ti=T&&invAffine(T); if(!Ti) return;
  // pointer -> screen world -> undo the view frame -> this copy's own transform = raw base
  const fr=fullCornerGeom.frame;
  const pw=D.hold.invTR([sx,sy]);
  const w=TilerCore.applyT(Ti, fr?TilerCore.applySim(TilerCore.invSim(fr),pw):pw);
  const v=TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM);
  D.lastDelta=[w[0]-v[D.vi][0], w[1]-v[D.vi][1]];
  const delta=[(w[0]-v[D.vi][0])/D.scale, (w[1]-v[D.vi][1])/D.scale];
  const r=TilerCore.dragVertex(curCfg.eqs,D.groups,curM,D.u,D.vi,delta,{ref:D.ref});
  if(r.ok){
    D.u=r.u; manual={A:r.A.slice(), L:r.L.map(x=>x*D.scale)};
    if(familyState){ familyState.u=r.u.slice(); familyState.scale=D.scale;
      familyState.drivers.forEach(d=>{ d.val=r.u[d.u]; }); }
    cornerNote='';
  } else cornerNote='as far as this shape goes: '+(r.reason||'no free direction');
  // no shapeFrame here: the full view fits its own frame in drawFullCanvas, against the grabbed
  // copy rather than the base tile
  redrawShape();
}
// Draggable control-point handles for the selected curve orbit, drawn directly on the tile
// (replaces the old disconnected side-panel curve editor -- TODO.md #2).
function drawCurveHandles(g, tg, cs){
  const ed=curveEdits[curveSel]; if(!ed || !Array.isArray(ed.pts)) return;   // defense in depth: ensureCurveEdit is the real fix
  const {baseMgon,m,TR}=tg, n=ed.pts.length;
  const activeOrbit = edgeOrbitReps().find(o=>o.rep===curveSel);
  if(!activeOrbit) return;
  // Every member edge of the ACTIVE orbit gets its OWN highlighted outline and its OWN set of
  // draggable handles -- John: it should be possible to grab any copy of a curve, not just the
  // orbit rep's own edge, since a multi-edge orbit (e.g. an S-symmetric pair) draws on more
  // than one edge of this same tile.
  activeOrbit.edges.forEach(ei=>{
    const code = tg.codeOf ? tg.codeOf[ei] : 0;
    if(cs){ g.strokeStyle='#4f9cff'; g.lineWidth=4;
      const seg=TilerCurves.mapToEdge(cs.curveOf[ei], baseMgon[ei], baseMgon[(ei+1)%m], false).map(TR);
      g.beginPath(); seg.forEach((q,i)=>i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1])); g.stroke(); }
    // handles for the FULL curve (both halves) -- U/S mirror points are draggable too, so
    // their handle must be on-screen even though they're not independently stored.
    const mapped=mapFullPtsForEdge(ed,code), L=mapped.length;
    const world=TilerCurves.mapToEdge(mapped, baseMgon[ei], baseMgon[(ei+1)%m], false);
    mapped.forEach((p,k)=>{ const q=TR(world[k]), rm=TilerCurves.fullIdxToRaw(ed.type,n,fullIdxFor(L,code,k)), fx=ptFixed(ed.type,rm.r,n);
      g.fillStyle=(rm.r===curveSelPt)?'#e74c3c':(SHAPE_COL[ed.type]||'#333');
      g.globalAlpha=fx?0.45:(rm.mirror?0.75:1); g.beginPath(); g.arc(q[0],q[1],fx?4:6,0,7); g.fill(); g.globalAlpha=1; });
  });
  // segment-hover preview: a ring at the cursor showing where a click would insert a point
  if(curveHover && curveHover.kind==='segment' && curveHover.rep===curveSel && curveHover.sx!=null){
    g.strokeStyle='#4f9cff'; g.lineWidth=2; g.beginPath(); g.arc(curveHover.sx,curveHover.sy,7,0,7); g.stroke();
  }
}
function drawFullCanvas(g,cv){
  const m=curM,ned=curCfg.ned;
  // don't develop a tile that doesn't close yet (would be garbage) — guide to the tiles view
  const gap=TilerCore.gapOf(manual.A,manual.L,m), scale=Math.max(...manual.L);
  if(gap/scale>=0.02){ setShapeStatus(); g.font='15px system-ui'; g.textAlign='left'; g.fillStyle='#c0392b';
    g.fillText(`tile doesn't close (gap ${(gap/scale).toFixed(3)}) — adjust angles/lengths in the tiles view first`, 12, 24); return; }
  // only develop a tile whose ACTUAL drawn boundary doesn't self-intersect. When curves are on,
  // that boundary is the curved one — the straight m-gon is only a placement scaffold, and it
  // may legitimately cross itself while the curved boundary (S/U/J edges bulging off the chord)
  // does not. Testing the straight proxy there was a false rejection (John, #25524 m=9 si=6
  // off=8: "if we make some edges cross - it bans the full tiling - even if the curved line
  // version doesn't have crossings" — confirmed: the straight 9-gon crosses at sides 1×5, 1×8,
  // 2×5, all on S/U edges, while the curved boundary built from the same curveEdits is simple).
  // Only fall back to the straight test when curves are off, since then straight IS what's drawn.
  const straightVerts=TilerCore.verticesOf(manual.A,manual.L,m).slice(0,m);
  let crossMsg = '';
  if(curvesOn()){
    try{ const cs=curveSet(); if(curveSelfCross(TilerCurves.curvedTile(cs.baseMgon,cs.curveOf))) crossMsg='the curved edges'; }catch(e){}
  } else if(polyCross(straightVerts).length){
    crossMsg = 'straight sides '+polyCross(straightVerts).map(p=>p[0]+'×'+p[1]).join(', ');
  }
  if(crossMsg){ setShapeStatus(); g.font='15px system-ui'; g.textAlign='left'; g.fillStyle='#c0392b';
    g.fillText(`tile self-intersects (${crossMsg}) — full tiling not drawn.`, 12, 24);
    g.fillStyle='#7a8090'; g.font='13px system-ui'; g.fillText('See the crossing in the "tile(s) per orbit" view.', 12, 46); return; }
  const verts=straightVerts;
  const placed=placedTiles(verts,260);                 // translation block when readable, else develop()
  // The full view needs its OWN frame, and it must pin the copy under the cursor -- not the base
  // tile. develop() anchors tile 0 at the origin, so a change in the tile's shape is amplified
  // along every gluing between there and wherever you grabbed: pinning tile 0 (as the tiles view
  // does) let the patch slide out from under the pointer by tens of pixels on a distant copy.
  // develop(F v) is exactly F(develop(v)) for a similarity F, so the frame can be applied to the
  // developed points afterwards rather than to the tile beforehand.
  const D=cornerDrag&&cornerDrag.full?cornerDrag:null;
  const fullFrame = (D && D.startTileVerts && placed[D.tileIdx])
    ? TilerCore.rigidFit(placed[D.tileIdx].verts, D.startTileVerts) : null;
  const ff = p => fullFrame ? TilerCore.applySim(fullFrame, p) : p;
  // REAL overlap check (exact triangle-clip intersection area, same code certify.js uses to
  // decide L1 vs L2) -- added 2026-07-23.  Before this, the only checks here were "does the
  // single tile self-cross" and "does the developed vertex figure match the expected degree
  // pattern" -- NEITHER can see two separate tiles physically overlapping in area, so a
  // tiling could share half a tile's area between two nearby copies and still show no
  // warning at all (confirmed on a hand-edited #1727311 combo).  Checked on the STRAIGHT
  // skeleton, same as certify -- curves are not accounted for by this check.
  const ov=OverlapStrict.overlapStrict(placed);
  let draw;
  if(curvesOn()){ const cs=curveSet(); draw=TilerCurves.buildCurvedTiles(placed,cs.baseMgon,cs.curveOf); }
  else draw=placed.map(t=>({orbit:t.orbit,pts:t.verts}));
  if(fullFrame) draw=draw.map(t=>({orbit:t.orbit,pts:t.pts.map(ff)}));   // ride the frame
  const xs=draw.flatMap(t=>t.pts.map(p=>p[0])),ys=draw.flatMap(t=>t.pts.map(p=>p[1]));
  const bboxMinx=Math.min(...xs),bboxMaxx=Math.max(...xs),bboxMiny=Math.min(...ys),bboxMaxy=Math.max(...ys);
  const pad=.4;
  // Zoom (fullZoom): shrink the fitted window around a chosen centre instead of the whole
  // patch's own bbox centre -- same construction as drawTwoTiles' per-tile zoom, see the
  // comment there. At scale=1/cx=cy=null this reduces to exactly the unzoomed fit-all below.
  const z=fullZoom, zscale=z?z.scale:1;
  const cx=z&&z.cx!=null?z.cx:(bboxMinx+bboxMaxx)/2, cy=z&&z.cy!=null?z.cy:(bboxMiny+bboxMaxy)/2;
  const halfW=(bboxMaxx-bboxMinx)/2/zscale+pad, halfH=(bboxMaxy-bboxMiny)/2/zscale+pad;
  const minx=cx-halfW,maxx=cx+halfW,miny=cy-halfH,maxy=cy+halfH;
  const w=maxx-minx,hh=maxy-miny,sc=Math.min(cv.width/w,cv.height/hh)*.96;
  const ox=(cv.width-w*sc)/2,oy=(cv.height-hh*sc)/2;
  // A drag freezes the fit, exactly as the tiles view does: the patch's bbox changes as the tile
  // reshapes, and re-fitting mid-gesture slides the grabbed corner out from under the cursor.
  const held=cornerDrag&&cornerDrag.full&&cornerDrag.hold;
  const TR=held?held.TR:p=>[ox+(p[0]-minx)*sc, cv.height-(oy+(p[1]-miny)*sc)];
  const invTR=held?held.invTR:q=>[(q[0]-ox)/sc+minx, (cv.height-q[1]-oy)/sc+miny];
  fullGeom=held||{TR,invTR,ox,oy,sc,minx,miny};
  const cols=['#bcd9ff','#ffd9a8'];
  draw.forEach(t=>{g.beginPath();t.pts.forEach((p,i)=>{const q=TR(p);i?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);});g.closePath();
    g.fillStyle=cols[t.orbit];g.fill();g.strokeStyle='#333';g.lineWidth=1;g.stroke();});
  // Corner handles here too, but only on ONE tile at a time -- the one under the cursor, or the
  // one being dragged. 260 tiles x m corners of handles would bury the tiling they are meant to
  // let you shape. develop() maps the base polygon vertex-for-vertex (placed[t].verts[i] is base
  // vertex i under that tile's transform), so a corner grabbed on any copy names a base vertex
  // directly, and the whole patch re-solves from it.
  fullCornerGeom={TR,invTR,placed,frame:fullFrame,rawVerts:straightVerts,m,ranks:cornerRanks()};
  const liveTile = cornerDrag&&cornerDrag.full ? cornerDrag.tileIdx
                 : (fullHover&&fullHover.tileIdx!=null ? fullHover.tileIdx : -1);
  if(liveTile>=0 && liveTile<placed.length) drawFullCornerHandles(g,fullCornerGeom,liveTile);
  setShapeStatus(placed.length,ov);
  // vertex figure of the developed tiling vs the type's vertex_deg.  Compare the SET
  // of distinct vertex degrees (the type's "4 4" lists two orbits, both degree 4).
  const vf=vertexFigure(placed), want=(idxById[cur.id].vdeg||'').trim();
  const gotSet=[...new Set(vf)].sort((a,b)=>a-b).join(' ');
  const wantSet=[...new Set(want.split(/\s+/).filter(x=>x).map(Number))].sort((a,b)=>a-b).join(' ');
  const match = wantSet && gotSet===wantSet;
  g.font='15px system-ui'; g.textAlign='left';
  g.fillStyle = match ? '#1f9d57' : '#c0392b';
  g.fillText(`vertex degrees: {${gotSet}}   type wants: ${want}   ${match?'✓ matches':'✗ different tiling'}`, 12, 24);
}
// Which vertex degrees the developed patch actually realises, and how close the tile is to
// degenerate. Both now live in engine/tiling_checks.js so the page, the sweeps and the audits
// cannot drift apart -- they had, and a sign error in ONE copy of the vertex figure (see that
// file) mislabelled good tilings on screen for months.
const vertexFigure = placed => TilingChecks.vertexFigure(placed);
function degenWarn(){
  if(!manual||!sol) return '';
  const flat=sol.flat||new Set();
  let minA=999; manual.A.forEach((a,i)=>{ if(!flat.has(i)) minA=Math.min(minA, ((a%360)+360)%360, 360-((a%360)+360)%360); });
  const lr=Math.min(...manual.L)/Math.max(...manual.L);
  if(minA<3) return '⚠ near-zero angle (stem) — likely degenerate';
  if(lr<0.04) return '⚠ near-zero edge — likely degenerate';
  return '';
}
// do segments p0->p1 and q0->q1 properly cross (interior point, not just touch)?
function segCross(p0,p1,q0,q1){
  const o=(a,b,c)=>Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
  const a=o(p0,p1,q0),b=o(p0,p1,q1),c=o(q0,q1,p0),d=o(q0,q1,p1);
  return a!==b && c!==d && a!==0 && b!==0 && c!==0 && d!==0;
}
// non-adjacent SIDES of a polygon that cross.  Returns [[i,j],...].
function polyCross(V){
  const m=V.length, out=[];
  for(let i=0;i<m;i++) for(let j=i+2;j<m;j++){
    if(i===0 && j===m-1) continue;                 // sides 0 and m-1 share vertex 0
    if(segCross(V[i],V[(i+1)%m],V[j],V[(j+1)%m])) out.push([i,j]);
  }
  return out;
}
// SIDES of the tile that cross — a closed-but-self-intersecting polygon is not a real
// tile (its vertex walk returns to the start yet the boundary loops over itself), which
// is what makes the developed tiling overlap.
function tileSelfCross(){ return polyCross(TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM)); }
// self-intersections of a curved boundary polyline (when curves are on, deep curves can
// cross even if the straight sides don't).  Returns true if any non-adjacent segments cross.
function curveSelfCross(pts){
  const n=pts.length;
  for(let i=0;i<n-1;i++) for(let j=i+2;j<n-1;j++){
    if(i===0 && j===n-2) continue;                 // wrap-adjacent
    if(segCross(pts[i],pts[i+1],pts[j],pts[j+1])) return true;
  }
  return false;
}
function setShapeStatus(nTiles,ov){
  const gap=TilerCore.gapOf(manual.A,manual.L,curM), scale=Math.max(...manual.L), st=$('status');
  const closed=gap/scale<0.02, warn=degenWarn();
  const withCurves=closed && curvesOn();
  let curveBad=false;
  if(withCurves){ try{ const cs=curveSet(); curveBad=curveSelfCross(TilerCurves.curvedTile(cs.baseMgon,cs.curveOf)); }catch(e){} }
  // When curves are on, the CURVED boundary is what's actually drawn, so it -- not the straight
  // scaffold -- is the authority on self-intersection (same false-rejection fix as
  // drawFullCanvas's gate: #25524 m=9 si=6 off=8 crosses at straight sides 1×5,1×8,2×5 on S/U
  // edges, curved boundary is simple). Only fall back to the straight test with curves off.
  const cross = closed && !withCurves ? tileSelfCross() : [];
  const crossMsg = withCurves ? (curveBad ? '✗ curved edges cross' : '')
                 : (cross.length ? '✗ sides cross: '+cross.map(p=>p[0]+'×'+p[1]).join(', ') : '');
  // ov is only passed from the full-tiling view, where a developed patch actually exists to
  // check; the single-tile ("tiles" per-orbit) view has no patch, so ov stays undefined there
  // and this is skipped entirely. It is ALWAYS computed on the straight skeleton (overlap_strict
  // has no curved-boundary version) -- with curves on and non-I edges present, a nonzero count
  // can be this same straight-vs-curved artifact rather than a real collision, so report the
  // number honestly but don't let it alone flip the status to "bad".
  const ovMsg = typeof ov!=='number' ? '' : ov>0
    ? `✗ ${ov} overlapping tile pair${ov===1?'':'s'}${withCurves?' (straight-edge check; curved boundary not verified)':''}`
    : `✓ 0 overlaps (${nTiles} tiles checked)`;
  const note = curCfg && curCfg.note ? '  ⓘ '+curCfg.note : '';   // reducible / (isohedral, later)
  const ovBad = ov>0 && !withCurves;
  st.className='status '+(closed&&!warn&&!crossMsg&&!ovBad?'ok':'no');
  st.textContent=(closed?('✓ closes'+(nTiles?' · '+nTiles+' tiles':'')):`gap ${(gap/scale).toFixed(3)}`)
                 +(warn?'  '+warn:'')+(crossMsg?'  '+crossMsg:'')+(ovMsg?'  '+ovMsg:'')+note;
}

// ---------- find a combo by its per-orbit side sizes ----------
// Coming from a picture (Myers-style polyform tilings), what you can read off is how many
// m-gon sides each net edge spans, per orbit: e.g. #25546 as "8,6,1,11,8 / 8,8,1,8,8,1".
// That fixes m (each orbit's sizes sum to it) and usually pins the combo to a handful.
// Both blocks are CYCLIC (where you start reading is arbitrary) and may be read either way
// round, so match up to rotation + optional reversal, independently per orbit.  Sign encodes
// edge direction, so compare |size|.
function sizeVariants(a){
  const rot=x=>x.map((_,i)=>x.slice(i).concat(x.slice(0,i)));
  return new Set(rot(a).concat(rot(a.slice().reverse())).map(x=>x.join(',')));
}
// ANCHORED reading. John, 2026-09-14: "start from a vertex, V, of orbit one tile -- and then find
// what mapping maps the orbit one tile to the orbit two tile -- then use that mapping to map V to
// some vertex, V', in orbit two. That is the vertex in orbit two tile that we must start at. Then
// see if the mapping changes orientation or not. If it changes orientation, then we go around the
// tiles in opposite directions, otherwise, we go the same direction."
// Both orbits are copies of ONE m-gon and the map between two copies carries m-gon vertex i to
// vertex i, so V' is the same m-gon vertex as V -- and going round "in opposite directions when the
// map reverses orientation" is going round the m-gon's own numbering the SAME way. So each list is
// the gaps between that orbit's net-edge corners, read from ONE common m-gon vertex, ONE common way
// round (which way is free: nobody knows the absolute direction from a picture).
// This replaces an anchor at a TILING vertex where corners of both orbits meet -- a different
// point of each tile, which is not what John meant (#601142 m24 found nothing that way).
// Net edge j's corner is m-gon vertex row5[j] + row6[j]: where specify() puts its angle (aniso.js
// nowAngle; row6 is 1 on a reversed edge, whose walk starts at the far end of its first side).
function netCorners(m, lo, hi){
  const s=new Set(); for(let j=lo;j<hi;j++) s.add(((netEdgeData[5][j]+netEdgeData[6][j])%m+m)%m); return s; }
// the sides between consecutive corners, from corner v going up (d=1) or down (d=-1) the numbering
function sizesFrom(C, v, d, m){
  const L=[]; let p=v;
  do{ let q=p, s=0; do{ q=((q+d)%m+m)%m; s++; }while(!C.has(q)); L.push(s); p=q; }while(p!==v && L.length<=m);
  return L;
}
// For the combo specify() ran last: the common start {v, d} that reads both lists, or null.
function anchoredStart(listA, listB, m){
  const CA=netCorners(m,0,cur.k), CB=netCorners(m,cur.k,cur.k+cur.n), a=listA.join(','), b=listB.join(',');
  for(const v of CA) if(CB.has(v)) for(const d of [1,-1])
    if(sizesFrom(CA,v,d,m).join(',')===a && sizesFrom(CB,v,d,m).join(',')===b) return {v,d};
  return null;
}
// Searches are slow enough (~2s at m=34) that re-running one just to look at the next
// candidate is annoying, so results are cached by (type, exact input text) and persisted
// to localStorage — the whole point is picking through the matches one at a time, which
// means leaving the find view and coming back repeatedly, and surviving a reload.
const FIND_KEY='tilerFindCache';
// Bump when the search itself changes: the cache is keyed only by (type, text, anchor) and lives in
// localStorage across reloads, so without this a result saved by OLDER code keeps coming back for
// the same input -- John, 2026-09-14: "The anchor checkbox ... doesn't always work."
const FIND_VERSION='2026-09-14b';     // b: anchor = same TILE vertex (John's meaning), not a shared tiling vertex
let findCache=null, findLoaded=-1;          // findLoaded = index of the hit last clicked
function findCacheKey(id, raw, anchor){ return FIND_VERSION+'|'+id+'|'+raw.replace(/\s+/g,'')+'|'+(anchor?'a':'f'); }
function findCacheGet(key){
  if(findCache && findCache.key===key) return findCache;
  try{ const o=JSON.parse(localStorage.getItem(FIND_KEY)||'null');
       if(o && o.key===key){ findCache=o; return o; } }catch(e){}
  return null;
}
function findCachePut(key, res){
  findCache={key, ...res};
  try{ localStorage.setItem(FIND_KEY, JSON.stringify(findCache)); }catch(e){}   // quota: cache is best-effort
}

// Which way round do the two typed lists sit against (k, n)?  Reading a tiling off a
// picture gives no canonical "first" orbit, so accept either order rather than making the
// user swap them.  When k == n BOTH assignments are legitimate and generally give
// DIFFERENT combos, so return both and let the caller search each — otherwise a real match
// is missed purely because of which orbit happened to be read first.
function orbitOrders(listA, listB){
  const out=[];
  if(listA.length===cur.k && listB.length===cur.n) out.push([listA,listB,false]);
  if(listB.length===cur.k && listA.length===cur.n) out.push([listB,listA,true]);
  // When k != n at most one of those fits.  When k == n both do, and they are two
  // genuinely different searches -- unless the two lists are identical, in which case
  // they are the same search and one of them is dropped.
  if(out.length===2 && JSON.stringify(listA)===JSON.stringify(listB)) out.pop();
  return out;
}
function findBySizes(listA, listB, anchor){
  const mA=listA.reduce((x,y)=>x+y,0), mB=listB.reduce((x,y)=>x+y,0);
  if(mA!==mB) return {err:`the two orbits must span the same number of sides — got ${mA} and ${mB}`};
  const orders=orbitOrders(listA, listB);
  if(!orders.length)
    return {err:`type #${cur.id} needs ${cur.k} and ${cur.n} sides per orbit — got ${listA.length} and ${listB.length} (tried both orders)`};
  if(orders.length>1){                                    // k == n: search both assignments, merge
    const seen=new Set(); const all=[]; let probed=0, scanned=0, base=null;
    for(const [A,B] of orders){
      const r=findOneOrder(A,B,mA,anchor); if(r.err) return r;
      base=base||r; probed+=r.probed; scanned+=r.scanned;
      for(const h of r.hits){ const k=h.si+'|'+h.orient+'|'+h.off;
        if(!seen.has(k)){ seen.add(k); all.push(h); } }
    }
    all.sort((a,b)=>a.si-b.si||a.orient-b.orient||a.off-b.off);
    return {...base, hits:all, probed, scanned, bothOrders:true};
  }
  const [A,B,swapped]=orders[0];
  const r=findOneOrder(A,B,mA,anchor);
  if(!r.err && swapped) r.swapped=true;
  return r;
}
function findOneOrder(listA, listB, m0, anchor){
  const m=m0;
  if(m>MAX_SIDES) return {err:`${m} sides is past the MAX_SIDES cap of ${MAX_SIDES}`};
  // Cheap structural check before the (slow) scan: netEdgeGrow may rule this size out
  // outright, in which case no combo of this type can have those sizes at all.
  const live=_liveSizes||liveSizeSet(cur, MAX_SIDES);
  if(!live.has(m)) return {err:`#${cur.id} has no sum-types at ${m} sides at all — netEdgeGrow rules that side count out, so these sizes cannot belong to this type`};
  // The free test (each list up to rotation and reversal) is necessary for the anchored one too, so
  // it filters (sum, orient) cheaply; the anchor itself depends on the OFFSET -- it moves orbit 2's
  // corners round the m-gon -- so it is checked per offset below (anchoredStart).
  const AV = sizeVariants(listA);
  const BV = sizeVariants(listB);
  const sums=runSums(m), hits=[]; let probed=0, scanned=0;
  // row4 depends only on (sum, orient), NOT on offset -- verified over every realizable offset
  // of a sample of sums.  So probe each (si, orient)
  // ONCE to read the sizes, and only walk the m offsets for the few that match.  That is the
  // difference between 1920*2 = 3840 specify() calls and 1920*2*34 = 130560 (~4s vs ~143s).
  for(let si=0;si<sums.length;si++) for(const orient of [0,1]){
    // Probe at off=0 ONLY.  row4 is populated whenever specify() does not hard-error, even
    // when that offset is not realizable -- which matters because at m=34 essentially every
    // off=0 is non-realizable, so waiting for a realizable offset would cost the full m calls
    // per (si, orient) and undo the whole saving.
    const probe=runSpecify(sums[si],orient,0); probed++;
    if(probe.includes('engine error')) continue;
    const sz=netEdgeData[4].map(Math.abs);
    if(sz.length!==cur.k+cur.n) continue;
    const az=sz.slice(0,cur.k), bz=sz.slice(cur.k);
    if(!(AV.has(az.join(','))&&BV.has(bz.join(',')))) continue;
    for(let off=0;off<m;off++){                              // now enumerate the valid offsets
      const txt=runSpecify(sums[si],orient,off); probed++;
      if(!txt.includes('tileAngles')||txt.includes('no angles')) continue;
      scanned++;
      const at = anchor ? anchoredStart(listA, listB, m) : null;
      if(anchor && !at) continue;
      hits.push({si,orient,off,sum:sums[si],sizes:sz,anchorAt:at||undefined,
                 kind: txt.includes('self intersection')?'self-intersecting':txt.includes('reducible')?'reducible':'ok'});
    }
  }
  return {m, hits, probed, scanned, nsum:sums.length};
}

// Indices of hits that are actual, drawable tiles -- i.e. not self-intersecting. Reducible
// hits count as "possible": the shape is real, it just also exists at a smaller m.
function possibleIdx(hits){ return hits.map((x,i)=>i).filter(i=>hits[i].kind!=='self-intersecting'); }
// Next/prev possible hit relative to findLoaded, wrapping around. dir is +1 or -1.
function stepPossible(hits, dir){
  const poss=possibleIdx(hits);
  if(!poss.length) return -1;
  const pos=poss.indexOf(findLoaded);
  if(pos<0){                                  // nothing loaded, or it's not itself "possible"
    if(dir>0){ const nxt=poss.find(i=>i>findLoaded); return nxt!==undefined?nxt:poss[0]; }
    const prevs=poss.filter(i=>i<findLoaded);
    return prevs.length?prevs[prevs.length-1]:poss[poss.length-1];
  }
  return poss[(pos+dir+poss.length)%poss.length];
}
// Load hit i from result r (sum-type / reflection / offset) into the current combo controls.
// Shared by the find-view row clicks, the find-view prev/next buttons, and the tiles-view
// nav (so paging through candidates doesn't require going back to the find list each time).
function loadFindHit(r, i, switchToTiles){
  if(i<0 || i>=r.hits.length) return false;
  const x=r.hits[i]; findLoaded=i;
  if(+$('size').value!==r.m || curM!==r.m){ $('size').value=r.m; selectSize(r.m); }  // repopulates the sum list
  const sumStr=JSON.stringify(x.sum);
  if(!ensureSumOption(sumStr)){ alert('that sum-type is no longer available at '+r.m+' sides'); return false; }
  $('sumType2').value=sumStr;
  $('orient2').checked=!!x.orient; $('offset2').value=x.off;
  resetShapeState();
  if(switchToTiles) $('view').value='tiles';
  render();
  return true;
}
// Small prev/next strip shown at the top of the tiles-view panel whenever the current sizesIn
// text has a cached find result for this type -- lets you page through candidates while
// looking at the drawn tile, instead of bouncing back to the find view for every click.
function findNavHtml(){
  const raw=($('sizesIn').value||'').trim();
  if(!raw || !cur) return '';
  const r=findCacheGet(findCacheKey(cur.id, raw, $('anchorSizes').checked));
  if(!r || r.err || !r.hits.length || !possibleIdx(r.hits).length) return '';
  const label=findLoaded>=0&&findLoaded<r.hits.length?`${findLoaded+1}/${r.hits.length}`:`—/${r.hits.length}`;
  return `<div class="row" style="margin-bottom:8px">`
    +`<button id="tilesFindPrev" title="previous possible match from 'find combo by side sizes' (skips self-intersecting)">◀ prev</button>`
    +`<span class="muted" style="margin:0 6px">find: ${label}</span>`
    +`<button id="tilesFindNext" title="next possible match from 'find combo by side sizes' (skips self-intersecting)">next ▶</button></div>`;
}
function wireFindNav(){
  const raw=($('sizesIn').value||'').trim();
  if(!raw || !cur) return;
  const r=findCacheGet(findCacheKey(cur.id, raw, $('anchorSizes').checked));
  if(!r || r.err) return;
  const pv=$('tilesFindPrev'), nx=$('tilesFindNext');
  if(pv) pv.onclick=()=>loadFindHit(r, stepPossible(r.hits,-1), false);
  if(nx) nx.onclick=()=>loadFindHit(r, stepPossible(r.hits,1), false);
}
function viewFind(){
  const raw=($('sizesIn').value||'').trim();
  const anchor=$('anchorSizes').checked;
  let h=`<div class="muted">Enter the side sizes per orbit, separated by <b>/</b> — e.g.
    <code>8,6,1,11,8 / 8,8,1,8,8,1</code> for #25546.
    Each orbit's sizes must sum to the same total; that total is the side count <b>m</b>.</div>`;
  if(!raw){ $('panel').innerHTML=h+'<div class="muted" style="margin-top:8px">(nothing entered yet)</div>'; return; }
  const parts=raw.split('/');
  if(parts.length!==2){ $('panel').innerHTML=h+`<div style="color:var(--bad);margin-top:8px">need exactly two lists separated by "/"</div>`; return; }
  const nums=s=>s.split(/[,\s]+/).filter(Boolean).map(Number);
  const A=nums(parts[0]), B=nums(parts[1]);
  if(A.some(isNaN)||B.some(isNaN)||!A.length||!B.length){
    $('panel').innerHTML=h+'<div style="color:var(--bad);margin-top:8px">could not parse those as numbers</div>'; return; }
  const key=findCacheKey(cur.id, raw, anchor);
  let r=findCacheGet(key), cached=!!r, ms=0;
  if(!r){ const t0=Date.now(); r=findBySizes(A,B,anchor); ms=Date.now()-t0;
          if(!r.err){ findCachePut(key,r); findLoaded=-1; } }
  if(r.err){ $('panel').innerHTML=h+`<div style="color:var(--bad);margin-top:8px">${r.err}</div>`; return; }
  const poss=possibleIdx(r.hits);
  h+=`<div style="margin-top:8px">type <b>${idxById[cur.id].name}</b> · <b>${r.m}</b> sides ·
      ${r.nsum} sums × 2 × ${r.m} offsets = ${r.nsum*2*r.m} combos, ${r.scanned} realizable ·
      <b style="color:${r.hits.length?'var(--good)':'var(--bad)'}">${r.hits.length} match${r.hits.length===1?'':'es'}</b>
      (<b style="color:var(--good)">${poss.length}</b> possible, ${r.hits.length-poss.length} self-intersecting)
      <span class="muted">· ${anchor?'anchored: both lists start at the same tile vertex':'free rotation'} · ${cached?'from cache':'searched in '+(ms/1000).toFixed(1)+'s'}</span>
      <button id="findAgain" style="margin-left:6px" title="discard the cached result and search again">re-run</button>
      <button id="findPrev" style="margin-left:6px" ${poss.length?'':'disabled'} title="jump to the previous possible (non-self-intersecting) match and load it">◀ prev possible</button>
      <button id="findNext" ${poss.length?'':'disabled'} title="jump to the next possible (non-self-intersecting) match and load it">next possible ▶</button></div>`;
  if(!r.hits.length){ h+='<div class="muted" style="margin-top:8px">No combo of this type has those side sizes. Check the numbers, or the type.</div>';
    $('panel').innerHTML=h; return; }
  h+='<div class="hint muted" style="margin-top:6px">Click one to load it into the tiles view.'
    +' Come back here to pick another — the search is cached, so it will not re-run.'
    +' <b>&#9654;</b> marks the one currently loaded. Once loaded, the tiles view keeps its own'
    +' prev/next so you don\'t have to come back here for every candidate.</div>';
  h+='<table style="margin-top:6px"><tr><th></th><th>#</th><th>sum</th><th>refl</th><th>off</th><th>row4</th><th>kind</th></tr>';
  r.hits.forEach((x,i)=>{
    const col=x.kind==='self-intersecting'?'rgba(230,126,34,.28)':x.kind==='reducible'?'rgba(224,168,32,.28)':'rgba(54,194,117,.22)';
    const on=i===findLoaded;
    h+=`<tr class="findhit" data-i="${i}" style="cursor:pointer${on?';background:rgba(79,156,255,.18)':''}">`
      +`<td style="color:var(--accent)">${on?'&#9654;':''}</td><td>${x.si}</td>`
      +`<td style="text-align:left">${JSON.stringify(x.sum)}</td><td>${x.orient}</td><td>${x.off}</td>`
      +`<td style="text-align:left">${x.sizes.slice(0,cur.k).join(' ')} <span class="muted">/</span> ${x.sizes.slice(cur.k).join(' ')}</td>`
      +`<td style="background:${col}">${x.kind}</td></tr>`;
  });
  h+='</table>';
  $('panel').innerHTML=h;
  const again=$('findAgain');
  if(again) again.onclick=()=>{ findCache=null; findLoaded=-1;
    try{ localStorage.removeItem(FIND_KEY); }catch(e){} render(); };
  const prevBtn=$('findPrev'), nextBtn=$('findNext');
  if(prevBtn) prevBtn.onclick=()=>loadFindHit(r, stepPossible(r.hits,-1), true);
  if(nextBtn) nextBtn.onclick=()=>loadFindHit(r, stepPossible(r.hits,1), true);
  $('panel').querySelectorAll('.findhit').forEach(tr=>tr.onclick=()=>loadFindHit(r, +tr.dataset.i, true));
}

// The ledger's recorded witness for THIS exact combo, if this is that combo.
// A combo fixes the combinatorics but not the shape: where the closing family has a free
// parameter, solveTile's Newton keeps whichever member it reaches first, and for a dozen types
// that is a degenerate one -- a 0.00 degree spike on #25525, an edge parked on the 0.05 clamp on
// #72675. The ledger now stores the shape it actually means, so seed from it and show the tile
// that was judged rather than re-deriving a different one.
function witnessSeed(){
  const rec = cur && verdictOf(cur.id);
  if(!rec || !rec.w || !rec.c || !rec.w.a) return null;
  const c = rec.c;
  if(c.m !== curM) return null;
  if(c.si !== $('sumType2').selectedIndex) return null;
  if(!!c.orient !== $('orient2').checked) return null;
  if((c.off|0) !== (+$('offset2').value||0)) return null;
  const A = rec.w.a.slice(), L = rec.w.l.slice();
  // the ledger's witness angles are stored mod 360: lift them to TRUE angles first, or the seeded
  // solve can rebuild a different polygon from them (a half-turn off where A1 = A7/2)
  try { const lf = TilerCore.liftAngles(curCfg.eqs, lenGroups(curCfg.whichEdge, curM), curM, A, L); if (lf.ok) return { A: lf.A, L }; } catch (e) {}
  return { A, L };
}
let seededFromLedger = false;
function ensureSolve(){            // returns false if no drawable tile
  const cfg=curConfig();
  if(!cfg){ $('panel').innerHTML='<div class="muted">pick a sum-type</div>'; return false; }
  if(cfg.impossible){ const st=$('status'); st.className='status no'; st.textContent=cfg.impossible;
    $('panel').innerHTML='<div class="muted">engine reports this config impossible</div>'; return false; }
  curCfg=cfg;
  if(!manual){ const wseed=witnessSeed(); seededFromLedger=!!wseed;
    sol=TilerCore.solveTile(cfg.eqs, lenGroups(cfg.whichEdge,curM), curM,
      wseed ? {edgeSym:cfg.edgeSym, seed:wseed} : {edgeSym:cfg.edgeSym});
    // Editable whenever a shape exists (even if it didn't close): 'unknown' just means the
    // numerical search didn't find a closing tile -> let the user play with angles/lengths.
    // Only the proven-impossible (<3 corners) case has no A/L and blocks editing.
    manual = sol.A ? {A:sol.A.slice(),L:sol.L.slice()} : null;
    if(manual) autoDesignIfNeeded(); }        // a brand-new (type,m,sum,orient,off): curveEdits is empty here
  if(!manual){ const st=$('status'); st.className='status no';
    st.textContent='impossible: '+(sol.reason||'degenerate'); renderTilesControls(); return false; }
  return true;
}
function viewTiles(g,cv){ if(!ensureSolve()) return; drawTilesCanvas(g,cv); renderTilesControls(); }
function drawTwoTiles(g,cv,tiles){
  const slot=cv.width/tiles.length, geoms=[];
  tiles.forEach((t,i)=>{
    // t.hold: reuse a previously returned geom instead of re-fitting. A corner drag freezes
    // panel 0 this way -- the fit is computed from the tile's own bbox, so without it the
    // picture rescales on every frame and the corner slides out from under the cursor.
    if(t.hold){ geoms.push(t.hold); drawOneTile(g,cv,t,t.hold,i,slot); return; }
    const xs=t.verts.map(p=>p[0]),ys=t.verts.map(p=>p[1]);
    const bboxMinx=Math.min(...xs),bboxMaxx=Math.max(...xs),bboxMiny=Math.min(...ys),bboxMaxy=Math.max(...ys);
    const pad=.4;
    // Optional zoom {scale,cx,cy}: shrink the fitted window around a chosen centre instead of
    // the tile's own bbox centre. At scale=1 with cx/cy left null (defaulting to the bbox
    // centre) this reduces to exactly the unzoomed formula below -- verified numerically.
    const z=t.zoom, scale=z?z.scale:1;
    const cx=z&&z.cx!=null?z.cx:(bboxMinx+bboxMaxx)/2, cy=z&&z.cy!=null?z.cy:(bboxMiny+bboxMaxy)/2;
    const halfW=(bboxMaxx-bboxMinx)/2/scale+pad, halfH=(bboxMaxy-bboxMiny)/2/scale+pad;
    const minx=cx-halfW,maxx=cx+halfW,miny=cy-halfH,maxy=cy+halfH;
    const w=maxx-minx,hh=maxy-miny,sc=Math.min(slot/w,cv.height/hh)*.7;
    const ox=i*slot+(slot-w*sc)/2, oy=(cv.height-hh*sc)/2;
    // minx/miny already include the pad margin (folded into halfW/halfH above), so TR/invTR
    // don't add it again here.
    const TR=p=>[ox+(p[0]-minx)*sc, cv.height-(oy+(p[1]-miny)*sc)];
    // algebraic inverse of TR, so on-tile curve editing (drawTilesCanvas) can turn a mouse
    // position back into tile-local world coordinates -- this is a uniform-scale similarity
    // (no shear/rotation between world and screen here), so the inverse is just undoing each
    // step of TR in reverse order.
    const invTR=q=>[(q[0]-ox)/sc+minx, (cv.height-q[1]-oy)/sc+miny];
    const geom={TR,invTR,ox,oy,sc,minx,miny,pad,slot};
    geoms.push(geom);
    drawOneTile(g,cv,t,geom,i,slot);
  });
  return geoms;
}
// The painting half of drawTwoTiles, split out so a held (frozen) transform can reuse it --
// a corner drag must not re-fit panel 0, or the corner slides out from under the cursor.
function drawOneTile(g,cv,t,geom,i,slot){
  const TR=geom.TR;
  const npts=t.open?t.verts.length-1:t.verts.length;   // open walk: last pt is the landing of edge m
  g.beginPath(); for(let j=0;j<t.verts.length;j++){const q=TR(t.verts[j]); j?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);}
  if(!t.open){ g.closePath(); g.fillStyle=t.col; g.fill(); }
  g.strokeStyle='#333'; g.lineWidth=2; g.stroke();
  if(t.open){                                          // show the closure gap
    const start=TR(t.verts[0]), land=TR(t.verts[t.verts.length-1]);
    g.strokeStyle='#ff6b6b'; g.lineWidth=2; g.setLineDash([6,5]);
    g.beginPath(); g.moveTo(land[0],land[1]); g.lineTo(start[0],start[1]); g.stroke(); g.setLineDash([]);
    g.fillStyle='#36c275'; g.beginPath(); g.arc(start[0],start[1],5,0,7); g.fill();   // start
    g.fillStyle='#ff6b6b'; g.beginPath(); g.arc(land[0],land[1],5,0,7); g.fill();     // landing of last edge
  }
  // t.handles: draggable corner handles are about to be drawn on these same points, so skip the
  // plain dot -- two marks on one corner is what made the handles read as decoration. The v-label
  // stays either way; it is the only thing naming the corner.
  if(!t.curve) for(let j=0;j<npts;j++){const q=TR(t.verts[j]);
    if(!t.handles){ g.fillStyle='#333'; g.beginPath();g.arc(q[0],q[1],3,0,7);g.fill(); }
    g.fillStyle='#777';g.font='12px monospace';g.fillText('v'+j,q[0]+8,q[1]-8);}
  // highlight any crossing sides in red so the self-intersection is visible
  if(t.cross && t.cross.length){ g.strokeStyle='#ff3b3b'; g.lineWidth=3;
    t.cross.forEach(([p,q])=>{ const P=t.verts.length;
      [[p,(p+1)%P],[q,(q+1)%P]].forEach(([s,e])=>{ const a=TR(t.verts[s]),b=TR(t.verts[e]);
        g.beginPath(); g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); g.stroke(); }); });
    g.fillStyle='#ff3b3b'; g.font='12px system-ui';
    g.fillText('sides cross: '+t.cross.map(c=>c[0]+'×'+c[1]).join(', '), i*slot+slot/2, cv.height-10); }
  g.fillStyle='#555'; g.font='13px system-ui'; g.textAlign='center'; g.fillText(t.lbl, i*slot+slot/2, 22);
}
function rebuildAngles(freeVals){
  const stt=TilerCore.angleStructure(curCfg.eqs,curM), A=new Array(curM).fill(0);
  stt.free.forEach((c,i)=>A[c]=freeVals[i]);
  for(const c in stt.dep){let v=stt.dep[c].rhs;for(const f in stt.dep[c].co)v-=stt.dep[c].co[f]*A[f];A[+c]=v;}
  return A;
}
// Turn on true-parameter mode: analyze the closing family, pick the driver unknowns, and
// (if the current tile closes) start the sliders right at the current shape.
// Slider moves close the shape IN ITS OWN LIFT (TilerCore.closeHeld), never the chart's absolute
// angles: unpack() can hand an angle back 180 off (the angle equations are mod 360), and closing that
// closes a DIFFERENT polygon -- #209195 m8 si5 came back the other way round (John, 2026-09-14).
function activateFamily(opts){
  opts=opts||{};
  if(!curCfg||!curCfg.eqs||!manual) return;
  const groups=lenGroups(curCfg.whichEdge,curM);
  // seed the family with the shape on screen: when it closes, the parameters are taken right here
  const fam=TilerCore.shapeFamily(curCfg.eqs, groups, curM, {seed:{A:manual.A, L:manual.L}});
  // closeConstrained works in normalised lengths (group 0 pinned to 1), so remember the
  // tile's current overall scale and put it back on every result — otherwise turning the
  // sliders on, and each drag after, silently resizes the tile so edge 0 becomes length 1.
  const famScale = manual.L[groups[0][0]] || 1;
  familyState={ dim:fam.dim, rank:fam.rank, nU:fam.nU, relations:fam.relations, drivers:[], u:null, groups, scale:famScale };
  if(fam.dim && fam.dim>0){
    const F=TilerCore.familyFns(curCfg.eqs, groups, curM);
    const gapNow=TilerCore.gapOf(manual.A, manual.L, curM)/Math.max(...manual.L);
    let base, drivers;
    if(gapNow<0.02){                                 // start at the current shape
      const u=F.toU(manual.A, manual.L), pd=TilerCore.pickDrivers(curCfg.eqs,groups,curM,u);
      // At a special point of the family (e.g. a mirror-symmetric member) the closure rank drops and
      // pickDrivers here counts one parameter too many; then use the family's own drivers (picked at
      // a regular member) with this shape's values.
      const src=(pd.drivers.length===fam.dim)?pd.drivers:fam.drivers;
      drivers=src.map(d=>{ const rr=d.kind==='A'?fam.angleRanges[d.idx]:fam.lengthRanges[d.idx];
        return {...d, lo:Math.min(rr.lo,u[d.u]), hi:Math.max(rr.hi,u[d.u]), val:u[d.u]}; });
      base=u;
    } else { drivers=fam.drivers.map(d=>({...d})); base=fam.baseU.slice(); }
    familyState.drivers=drivers; familyState.u=base;
    // the shape the sliders start from, in its own lift, for closeHeld
    familyState.u0=base.slice();
    { const U=F.unpack(base.slice());
      familyState.A0=(gapNow<0.02)?manual.A.slice():U.A.slice();
      familyState.L0=(gapNow<0.02)?manual.L.slice():U.L.map(x=>x*famScale); }
    // opts.exact: set up the true-parameter sliders WITHOUT ever touching `manual` -- used when
    // loading anything that is supposed to show up exactly as saved (loadCombo, so every gallery
    // click, saved-combo load, and deep-search "load" too). John, 2026-09-12: "treat each gallery
    // image as a saved combo... that way we are sure we match the picture." The reject-and-revert
    // guard below (large jump -> keep loaded shape) already covers the WORST case of this same
    // Newton instability, but it still let a small "refinement" through -- and there is no reason
    // to refine a shape at all the moment it is loaded rather than hand-edited: it is either already
    // exact (gallery, saved combos) or was already someone's deliberate witness. Refinement remains
    // for the OTHER caller of this function, the "true parameters" button on raw sliders someone has
    // been dragging by hand, where a small accumulated gap is real and worth snapping closed.
    if(!opts.exact){
      const r0=TilerCore.closeHeld(curCfg.eqs, groups, curM, familyState.A0, familyState.L0, base, base, drivers.map(d=>d.u));
      const r=r0.ok?{A:r0.A, L:r0.L.map(x=>x/famScale)}:{};   // own lift; the code below re-applies famScale
      // Newton starting AT a root is not guaranteed to stay there: close to a FOLD (turning point)
      // of the family, the Jacobian pickDrivers used to split free/dependent unknowns is near-
      // singular, and a converging step can jump to a distant, unrelated branch that also happens
      // to close. When gapNow<0.02 the loaded shape ALREADY closes almost exactly, so this call
      // exists only to refine it -- a refinement should move the tile by about as much as the gap
      // itself, never by a real fraction of its own size. John, 2026-09-12, on #209105 si17 and
      // #209209 si60: "clicking doesn't pull up the image, but some other tiling" -- both closed to
      // ~1e-5 yet came back from here with every vertex in a different place. Verified: tiler_core.js
      // (the non-experimental fork) does not reproduce this on the same combo, so the bug is inside
      // tiler_core_revpivot.js's parametrisation specifically -- but the check belongs here regardless
      // of which core is active, the same "reject and revert" discipline netshape.html uses for its
      // own last-good state.
      if(r.A && gapNow<0.02){
        const newL=r.L.map(x=>x*famScale);
        const Vold=TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM);
        const Vnew=TilerCore.verticesOf(r.A,newL,curM).slice(0,curM);
        let diam=0; for(let i=0;i<curM;i++)for(let j=i+1;j<curM;j++) diam=Math.max(diam,Math.hypot(Vold[i][0]-Vold[j][0],Vold[i][1]-Vold[j][1]));
        let worst=0; for(let i=0;i<curM;i++) worst=Math.max(worst,Math.hypot(Vnew[i][0]-Vold[i][0],Vnew[i][1]-Vold[i][1]));
        if(!(diam>0) || worst/diam>0.02){
          cornerNote='the true-parameter solver tried to "refine" this shape and jumped to a different tiling instead -- kept the loaded shape as-is';
        } else manual={A:r.A.slice(), L:newL};
      } else if(r.A){ manual={A:r.A.slice(), L:r.L.map(x=>x*famScale)}; }
    }
  }
  renderTilesControls(); redrawShape();
}
// A solved tile's angles A[i] feed verticesOf as `heading += 180 - A[next]`, which only
// equals the angle a VIEWER reads off the picture (protractor-at-the-vertex, interior on
// the left) when the polygon traces CCW.  Newton has no preference between the CCW and CW
// branches of a closing family -- both close equally well -- and about 1% of solves
// (measured across the ledger) land on the CW one, where the raw A[i] is 360 minus what you
// see.  Confirmed on #1727311 (John): his by-eye angles [70,250,20,...] summed to the
// correct 900 = (7-2)*180 and matched 360-A[i] at all 7 vertices to the precision of a
// visual estimate, while the raw A[i] summed to 1620 = 900 + 2*360 (the CW signature).  This
// is also why dragging felt like it "turned inside out": increasing a raw slider on a CW
// tile DECREASES the angle you actually see, the opposite of what the slider suggests.
// `flip` is a display-only correction (self-inverse, so the same function converts a raw
// value to what's shown and a shown value back to raw) -- it never touches manual.A itself,
// so solveTile/boundaryTouch/every rule keeps working in the one internal convention.
function currentIsCW(){
  const V=TilerCore.verticesOf(manual.A,manual.L,curM).slice(0,curM);
  let a=0; for(let i=0;i<curM;i++){ const q=V[(i+1)%curM]; a+=V[i][0]*q[1]-q[0]*V[i][1]; }
  return a<0;
}
function renderTilesControls(){
  let h=findNavHtml();
  // `flip` must be visible to the oninput wiring below, which runs after this function's
  // `if(manual&&sol)` block closes -- a block-scoped const here would throw ReferenceError
  // the first time a user actually drags a slider (only the initial render, which happens
  // to run inside the block, would work).
  // TRUE angles are shown as they are (John, 2026-09-14): -78.9 is not 281.1 -- it says which side the
  // inside is. The old clockwise "360 minus" display is gone; flip is kept as the identity so the
  // slider wiring below is unchanged.
  const cw=false, flip=a=>a;
  if(manual && sol){
    const groups=lenGroups(curCfg.whichEdge,curM);
    // on-tile corner dragging: say what the handles mean, and how much freedom there is
    const rk=cornerRanks();
    if(rk){
      const n2=rk.filter(r=>r.rank===2).length, n1=rk.filter(r=>r.rank===1).length, n0=rk.filter(r=>r.rank===0).length;
      h+='<h3>tile corners</h3>';
      const full = $('view').value==='full';
      const where = full
        ? 'Hover a tile in the tiling and its corners get handles'
        : 'The blue marks on the tile are handles';
      // In the full view the whole patch is on screen, so a pixel is a large slice of a tile --
      // a 30px pull can ask for two edge-lengths at once and simply run the family out. Scroll
      // to zoom first and the same drag becomes fine-grained.
      const zoomTip = full
        ? ' <b>Scroll to zoom in first</b> — zoomed out, a few pixels is most of an edge.' : '';
      h+= (n2+n1)
        ? `<div class="muted" style="margin-bottom:4px">${where} — drag one and the
             rest re-solves so the tile stays closed. <b>${n2}</b> ● free in the plane,
             <b>${n1}</b> ▬ slide along the drawn line only, <b>${n0}</b> ○ fixed by the type.
             Sliders still work; they are the same shape from the other end.${zoomTip}</div>`
        : '<div class="muted" style="margin-bottom:4px">This tile is rigid — the type leaves no shape freedom, so no corner can move.</div>';
      if(cornerNote) h+=`<div class="muted" style="color:#e0a020;margin-bottom:4px">${cornerNote}</div>`;
      if(seededFromLedger) h+=`<div class="muted" style="color:#36c275;margin-bottom:4px">This is the
        ledger's recorded witness for #${cur.id} — the exact shape the verdict rests on, not a fresh solve.</div>`;
    }
    // Automated diagnosis: does the straight skeleton already close as a simple curve, or does it
    // need curves? See engine/tile_designer.js. Read-only -- this never edits anything by itself.
    if(typeof TileDesigner!=='undefined'){
      let diag=null; try{ diag=TileDesigner.diagnose(designerDeps(), designerCtx(), manual.A, manual.L); }catch(e){}
      if(diag){
        h+='<h3>shape check</h3>';
        if(diag.verdict==='not a tile') h+=`<div class="muted" style="color:#e05050;margin-bottom:4px">not a tile: ${diag.reason}</div>`;
        else if(diag.verdict==='straight ok') h+='<div class="muted" style="margin-bottom:4px">straight edges are enough — curves are optional here.</div>';
        else {
          const parts=diag.problems.map(p=>{
            if(p.kind==='zeroCorner') return `corner ${p.vertex} is 0°`+(p.forced===true?' (forced)':p.forced===false?' (removable by a shape change)':'')+(p.unfixable?' — flanked only by straight edges, cannot open':'');
            if(p.kind==='crossing') return `edges ${p.edges.join(' & ')} cross`+(p.unfixable?' — both straight, cannot open':'');
            return 'a corner touches another edge'+(p.unfixable?' — flanked only by straight edges, cannot open':'');
          });
          h+=`<div class="muted" style="color:#e0a020;margin-bottom:4px">needs curves: ${parts.join('; ')}. <button id="designCurves" title="automatically design curves that open this into a simple closed boundary, without touching any curve you already drew by hand">design curves</button></div>`;
        }
        if(designNote) h+=`<div class="muted" style="color:#36c275;margin-bottom:4px">${designNote}</div>`;
      }
    }
    if(familyState){
      // TRUE-parameter sliders: walk the closing family, tile stays closed
      h+='<h3>true parameters</h3>';
      h+=`<div class="muted" style="margin-bottom:4px">${familyState.dim==null?'?':familyState.dim}-parameter closing family (${familyState.nU} unknowns − ${familyState.rank} closure). Drag: the tile stays closed; the rest auto-solve.</div>`;
      if(familyState.relations&&familyState.relations.length) h+=`<div class="hint muted">forced: ${familyState.relations.join('; ')}</div>`;
      if(!familyState.drivers.length) h+='<div class="muted">rigid — no free parameter (nothing to drag)</div>';
      else if(typeof TileDesigner!=='undefined') h+=`<div class="row"><button id="tidyShape" title="slide the free parameters so unforced angles avoid looking like 180/90/60° and unforced edge lengths read as visibly different, without changing which quantities the combo forces">tidy shape</button></div>`;
      familyState.drivers.forEach((d,di)=>{ const step=Math.max((d.hi-d.lo)/100,1e-4);
        // flip is decreasing ONLY when cw (360-x); when the tile is CCW, flip is the identity
        // (still increasing), so swapping hi/lo unconditionally inverted min>max for the
        // common CCW case -- froze the slider, since a native range input with min>max has
        // no valid span to drag across.
        const swap=d.kind==='A'&&cw;
        const dlo=swap?flip(d.hi):d.lo, dhi=swap?flip(d.lo):d.hi, dv=d.kind==='A'?flip(d.val):d.val;
        h+=`<div class="row"><label title="${d.kind==='A'?'angle':'length ratio'}">${d.txt}</label><input type="range" min="${dlo}" max="${dhi}" step="${step}" value="${dv}" data-fam="${di}"><input type="number" class="val" id="fv${di}" step="${d.kind==='A'?0.1:0.001}" value="${dv.toFixed(d.kind==='A'?1:3)}" data-fam-n="${di}"></div>`; });
      h+='<div class="row"><button id="famoff">raw sliders</button></div>';
    } else {
      h+='<h3>free angles (°)</h3>';
      sol.free.forEach(i=>{ const dv=flip(manual.A[i]), b=angleBounds[i]||(angleBounds[i]={lo:Math.min(5,Math.floor(dv)-30),hi:Math.max(355,Math.ceil(dv)+30)});   // true angles can leave 0..360
        h+=`<div class="row"><label>A${i}</label><input type="range" min="${b.lo}" max="${b.hi}" step="0.5" value="${dv}" data-a="${i}"><input type="number" class="val" id="av${i}" step="0.1" value="${dv.toFixed(1)}" data-a-n="${i}"></div>`; });
      if(!sol.free.length) h+='<div class="muted">all angles fixed by the type</div>';
      h+='<h3>edge lengths</h3>';
      groups.forEach((grp,gi)=>{ const v=manual.L[grp[0]], b=lengthBounds[gi]||(lengthBounds[gi]={lo:0.2,hi:3});
        h+=`<div class="row"><label>e${grp.join('=')}</label><input type="range" min="${b.lo}" max="${b.hi}" step="0.02" value="${v}" data-g="${gi}"><input type="number" class="val" id="lv${gi}" step="0.01" value="${v.toFixed(2)}" data-g-n="${gi}"></div>`; });
      h+='<div class="row"><button id="reauto">re-auto-solve</button> <button id="famon" title="sliders for the TRUE degrees of freedom (tile stays closed)">true parameters</button></div>';
    }
  }
  // interactive curve editor: pick an edge orbit, then drag points / add / freehand.  The
  // curve is shared by all congruent edges of the orbit and its symmetry (J/I/U/S) is
  // auto-enforced.  Straight (I) edges have nothing to draw.
  if(curvesOn() && manual){
    const reps=edgeOrbitReps(), editable=reps.filter(o=>o.type!=='I'), straight=reps.filter(o=>o.type==='I');
    assignCurveVariants(reps);                      // same numbering curveSet uses, so panel and picture agree
    editable.forEach(o=>ensureCurveEdit(o.rep,o.type));
    if((curveSel==null || !editable.some(o=>o.rep===curveSel)) && editable.length) curveSel=editable[0].rep;
    h+='<h3>edge curves</h3>';
    if(editable.length){
      h+='<div class="muted" style="margin-bottom:4px">hover a curved edge on the tile — drag a point to move it, drag the curve itself to add one, right-click a point to delete it. Scroll to zoom, double-click to reset.</div>';
      h+='<div class="row"><button id="curvereset">reset this curve</button> <button id="curveflip" title="flip the selected curve to the other side of the baseline (out<->in) -- can clear a self-intersection at a tight corner that shifting the curve toward the edge centre alone can\'t fix">flip this curve</button></div>';
    }
    if(straight.length) h+=`<div class="muted">straight (I), not editable: edges ${straight.map(o=>o.edges.join(',')).join(' · ')}</div>`;
  }
  h+=`<h3>config</h3><pre>angle eqs:\n${(curCfg.eqs||[]).map(e=>e.join(' ')).join('\n')}\nwhichEdge: ${curCfg.whichEdge}\nedgeSym:   ${curCfg.edgeSym} (0J 1U 2I 3S)\nmapping:   ${curCfg.mapping} (0 rot, 1 refl, 2 inside-out, 3 both)</pre>`;
  $('panel').innerHTML=h;
  wireFindNav();
  const groups=curCfg.whichEdge?lenGroups(curCfg.whichEdge,curM):[];
  $('panel').querySelectorAll('input[data-a]').forEach(s=>{ const i=+s.dataset.a, num=$('av'+i);
    const onval=dispVal=>{
      const b=angleBounds[i]||(angleBounds[i]={lo:5,hi:355});
      [b.lo,b.hi]=syncPair(s,num,dispVal,-719.5,1079.5,1);   // true angles: not clamped to 0..360
      const raw=flip(dispVal);                       // slider shows the human-visible angle; flip back to raw for the solver
      const fv=sol.free.map(c=>c===i?raw:manual.A[c]); manual.A=rebuildAngles(fv);
      redrawShape();
    };
    s.oninput=e=>onval(+e.target.value); num.oninput=e=>onval(+e.target.value);
  });
  $('panel').querySelectorAll('input[data-g]').forEach(s=>{ const gi=+s.dataset.g, num=$('lv'+gi);
    const onval=v=>{
      const b=lengthBounds[gi]||(lengthBounds[gi]={lo:0.2,hi:3});
      [b.lo,b.hi]=syncPair(s,num,v,0.02,1e4,2);
      groups[gi].forEach(i=>manual.L[i]=v);
      redrawShape();
    };
    s.oninput=e=>onval(+e.target.value); num.oninput=e=>onval(+e.target.value);
  });
  // re-auto-solve: start from the CURRENT (hand-edited) config and find the closing
  // tile nearest it, rather than discarding it and solving from scratch.
  const ra=$('reauto'); if(ra) ra.onclick=()=>{
    familyState=null;
    if(manual && curCfg){
      const groups=lenGroups(curCfg.whichEdge,curM);
      let out=null;
      // Where the closing family has free parameters, a SEEDED solveTile is still a free Newton
      // over every unknown, so it slides along the family and lands wherever it converges -- which
      // is why this button used to jump somewhere else entirely. John, 2026-09-08 on #209516:
      // "re-auto-solve moves away from what is there."  Hold the TRUE PARAMETERS at their current
      // values and solve only the dependent unknowns: that is the closing shape NEAREST the one on
      // screen, which is what "re-auto-solve" should mean. closeConstrained works in normalised
      // lengths (group 0 pinned to 1), so put the tile's own scale back afterwards, exactly as
      // activateFamily does.
      try{
        const F=TilerCore.familyFns(curCfg.eqs, groups, curM);
        const u=F.toU(manual.A, manual.L);
        const drv=TilerCore.pickDrivers(curCfg.eqs, groups, curM, u).drivers.map(d=>d.u);
        if(drv.length){
          const scale=manual.L[groups[0][0]] || 1;
          // close the shape in ITS OWN lift with the drivers held (the chart's lift can be another polygon)
          const r=TilerCore.closeHeld(curCfg.eqs, groups, curM, manual.A, manual.L, u, u, drv);
          if(r && r.ok) out={A:r.A, L:r.L};
        }
      }catch(e){}
      // rigid family, or the constrained projection did not close: fall back to the seeded solve
      if(!out){
        const s=TilerCore.solveTile(curCfg.eqs, groups, curM, {seed:{A:manual.A.slice(),L:manual.L.slice()}, edgeSym:curCfg.edgeSym});
        if(s.A){ sol=s; out={A:s.A.slice(),L:s.L.slice()}; }
      }
      if(out) manual=out;
    } else manual=null;
    render();
  };
  // Curve editing itself is entirely on #cv (wireTileCurveEdit, wired once at load time) --
  // hover auto-selects which orbit is "live", so reset/flip act on whichever orbit hover last
  // landed curveSel on.
  const cr=$('curvereset'); if(cr) cr.onclick=()=>{ if(curveSel!=null) delete curveEdits[curveSel]; curveSelPt=-1; render(); };
  // Negate y on the CURRENT drawn points (not just a fresh default motif) -- flips the whole
  // curve to the other side of the baseline, whatever shape it's in right now. Kept as an
  // explicit escape hatch for tight-angle self-intersections: shifting a curve's bump toward
  // the edge's centre shrinks the corner angle it has to clear, but at a small enough angle
  // that's not always enough, and flipping out<->in can succeed where that alone doesn't
  // (John, 2026-08-10: "we could flip a curve from out to in and it might solve the
  // intersection problem"). See TilerCurves.motifCount/motifName/motifPts for the equivalent
  // baked into the demo-motif variant space.
  const cf=$('curveflip'); if(cf) cf.onclick=()=>{ const ed=curveSel!=null?curveEdits[curveSel]:null;
    if(ed){ delete ed.auto; ed.pts=ed.pts.map(([x,y])=>[x,-y]); } render(); };
  // Automated designer buttons. Both are no-ops on failure (alert + leave state untouched) rather
  // than half-applying a broken result. designCurves() itself never touches an orbit whose stored
  // edit is hand-drawn (or an old auto-repair that never actually opened the tile) -- see
  // tile_designer.js's isGeneratedMotif -- so running it repeatedly, or after hand edits on OTHER
  // orbits, only ever moves the orbits it is free to move.
  const dc=$('designCurves'); if(dc) dc.onclick=()=>{
    const ctx=designerCtx(); if(!ctx || !manual) return;
    let diag; try{ diag=TileDesigner.diagnose(designerDeps(), ctx, manual.A, manual.L); }
    catch(e){ alert('diagnose failed: '+e.message); return; }
    if(diag.verdict==='not a tile'){ alert('This combo is not a tile: '+diag.reason); return; }
    let res; try{ res=TileDesigner.designCurves(designerDeps(), ctx, manual.A, manual.L, curveEdits, diag, {}); }
    catch(e){ alert('curve design failed: '+e.message); return; }
    if(!(res.clearance>1e-6)){ alert('the search could not open this into a simple boundary (clearance '+res.clearance.toExponential(2)+')'); return; }
    Object.keys(res.curveEdits).forEach(rep=>{ curveEdits[rep]=res.curveEdits[rep]; });
    // The straight-skeleton diagnosis above is unchanged by this (it never looks at curves), so
    // the amber "needs curves" line still shows -- that is correct, not stale. Report the actual
    // result achieved so a click has visible feedback beyond the redraw.
    designNote='curves designed: clearance '+res.clearance.toExponential(2)+' of the tile diameter (auto -- drag any point to make it yours)';
    render();
  };
  const ts=$('tidyShape'); if(ts) ts.onclick=()=>{
    const ctx=designerCtx(); if(!ctx || !manual) return;
    let res; try{ res=TileDesigner.chooseShape(designerDeps(), ctx, manual.A, manual.L, {}); }
    catch(e){ alert('shape tidy failed: '+e.message); return; }
    manual={A:res.A, L:res.L};
    familyState=null;                    // rebuild fresh: re-picking drivers after the move is cheap and honest
    const rep=res.report||{};
    designNote = rep.note ? rep.note
      : (rep.beforeMargin==null ? 'shape tidied' : `shape tidied: worst free-angle margin ${rep.beforeMargin.toFixed(1)}° -> ${rep.afterMargin.toFixed(1)}° from 60/90/180`)
        + (rep.forced && rep.forced.length ? ('; ' + rep.forced.join('; ')) : '');
    render();
  };
  // true-parameter sliders: hold all drivers at their slider values, re-solve the rest to close
  $('panel').querySelectorAll('input[data-fam]').forEach(s=>{ const di=+s.dataset.fam, num=$('fv'+di);
    const onval=dispVal=>{
      const d=familyState.drivers[di];
      d.val = d.kind==='A' ? flip(dispVal) : dispVal;   // slider shows the human-visible angle for kind 'A'
      // widen in RAW space (d.lo/d.hi are raw units); flip swaps which end is which when shown
      const floor=d.kind==='A'?0.5:1e-3, ceil=d.kind==='A'?359.5:1e4;
      [d.lo,d.hi]=growBound(d.lo,d.hi,d.val,floor,ceil);
      const swap=d.kind==='A'&&cw;                      // same cw-only swap as the initial render, see there
      s.min=swap?flip(d.hi):d.lo; s.max=swap?flip(d.lo):d.hi;
      s.value=dispVal; num.value=dispVal.toFixed(d.kind==='A'?1:3);
      const u=familyState.u.slice(); familyState.drivers.forEach(dd=>u[dd.u]=dd.val);
      const r=TilerCore.closeHeld(curCfg.eqs, familyState.groups, curM, familyState.A0, familyState.L0, familyState.u0, u, familyState.drivers.map(dd=>dd.u));
      // the shape in its own lift; a drag the solver cannot close leaves the tile where it was
      if(r.ok){ familyState.u=r.u.slice(); manual={A:r.A, L:r.L}; }
      redrawShape();
    };
    s.oninput=e=>onval(+e.target.value); num.oninput=e=>onval(+e.target.value);
  });
  const fon=$('famon'); if(fon) fon.onclick=activateFamily;
  const foff=$('famoff'); if(foff) foff.onclick=()=>{ familyState=null; renderTilesControls(); redrawShape(); };
}

// ---------- wire ----------
['bk','bq','bn','br'].forEach(id=>$(id).addEventListener('input',()=>{$('bid').value='';refreshOrbs();refreshMatches();
  if($('view').value==='pick') render();}));
$('orbSel').addEventListener('change',()=>{refreshMatches(); if($('view').value==='pick') render();});
// jump straight to a Tegula type number: fill k/q/n/r from it so the dropdown shows
// its siblings, then select that exact id.
function pickById(){
  const id=+$('bid').value; const e=idxById[id]; if(!e) return;
  $('bk').value=e.k;$('bq').value=e.q;$('bn').value=e.n;$('br').value=e.r;
  refreshOrbs(); $('orbSel').value=e.orb; refreshMatches(); $('matches').value=id; selectType(id);
}
$('bid').addEventListener('change',pickById);
$('bid').addEventListener('keydown',ev=>{if(ev.key==='Enter')pickById();});
$('matches').onchange=e=>selectType(+e.target.value);
$('size').onchange=e=>selectSize(+e.target.value);
// changing the config resets the solved tile AND the per-orbit curve edits (the orbits
// themselves change); switching VIEWS keeps everything.
['sumType2','orient2','offset2'].forEach(id=>$(id).addEventListener('change',()=>{resetShapeState();render();}));
$('view').addEventListener('change',render);
$('curves').addEventListener('change',render);   // rebuild controls so the curve editor shows/hides
// #cv's curve-drag handlers are wired ONCE here (the canvas element itself persists across
// renders, unlike the panel which is rebuilt via innerHTML) -- they no-op via tileEditGeom
// whenever there's nothing editable on screen (curves off, wrong view, no orbit selected).
wireTileCurveEdit($('cv'));
$('go').onclick=()=>{resetShapeState();render();};
// Enter in the side-sizes box runs the search directly, without touching the view dropdown
$('sizesIn').addEventListener('keydown',e=>{ if(e.key==='Enter'){ $('view').value='find'; resetShapeState(); render(); } });

// ---------- save / load combos (persisted in the browser) ----------
// A "combo" = everything needed to reproduce a picture: type, size, sum, refl, offset,
// view, curves on/off, the hand-edited angles/lengths (manual) and the curve edits.
const COMBO_KEY='tilerCombos';
function loadCombos(){ try{ return JSON.parse(localStorage.getItem(COMBO_KEY))||{}; }catch(e){ return {}; } }
function saveCombos(o){ try{ localStorage.setItem(COMBO_KEY, JSON.stringify(o)); }catch(e){ alert('could not save (storage full or blocked)'); } }
function refreshComboList(sel){ const o=loadCombos(), s=$('comboList'); s.innerHTML='<option value="">—saved—</option>';
  Object.keys(o).sort().forEach(name=>{ const opt=document.createElement('option'); opt.value=name; opt.textContent=name; s.appendChild(opt); });
  if(sel) s.value=sel; }
function currentCombo(){
  return { id:cur.id, m:curM, sum:$('sumType2').value, orient:$('orient2').checked?1:0, off:+$('offset2').value||0,
    view:$('view').value, curves:$('curves').checked,
    manual: manual?TilerCore.roundShape(manual.A, manual.L):null,     // saved ROUNDED; loadCombo recloses
    curveEdits: JSON.parse(JSON.stringify(curveEdits||{})) }; }
function comboName(){ const o=$('orient2').checked?'r':'d'; return `#${cur.id} ${curM}s ${$('sumType2').value} ${o}${+$('offset2').value||0}`; }
function loadCombo(c){
  resetShapeState();                                 // clear first so intermediate renders solve fresh
  // tolerate both combo formats: sum as string (list format) or array (older file format);
  // shape as nested manual:{A,L} or top-level A/L.
  const sumStr = Array.isArray(c.sum) ? JSON.stringify(c.sum) : c.sum;
  const savedShape = c.manual || (c.A && c.L ? {A:c.A, L:c.L} : null);
  $('bid').value=c.id; pickById();                 // load type + populate size options
  $('size').value=c.m; selectSize(c.m);            // set size + populate sum options
  if(!ensureSumOption(sumStr)) alert('saved sum-type '+sumStr+' is not a sum-type of #'+c.id+' at '+c.m+' sides');
  $('sumType2').value=sumStr;
  $('orient2').checked=!!c.orient; $('offset2').value=c.off;
  // a combo saved while a since-removed view was showing opens in the full tiling instead
  $('view').value=c.view||'full'; if(!$('view').value) $('view').value='full';
  $('curves').checked=!!c.curves;
  const cfg=curConfig();                           // establish cfg + a solve so restored angles have structure
  if(cfg && !cfg.impossible && cfg.eqs){ curCfg=cfg;
    sol=TilerCore.solveTile(cfg.eqs, lenGroups(cfg.whichEdge,curM), curM, {edgeSym:cfg.edgeSym});
    manual = savedShape ? {A:savedShape.A.slice(),L:savedShape.L.slice()} : (sol.A?{A:sol.A.slice(),L:sol.L.slice()}:null);
    // Saved shapes are ROUNDED (John, 2026-09-14): reclose to full precision, and use it only if it
    // rounds back to the saved numbers -- otherwise the file is not what it seems; show it as saved.
    if(savedShape && manual){
      const rs=TilerCore.recloseSaved(cfg.eqs, lenGroups(cfg.whichEdge,curM), curM, manual.A, manual.L);
      if(rs.ok) manual={A:rs.A, L:rs.L};
      else if(rs.gapBefore>1e-10) cornerNote='the saved shape does not reclose near itself ('+(rs.reason||'')+') -- shown exactly as saved';
    } }
  if(c.curveEdits) curveEdits=JSON.parse(JSON.stringify(c.curveEdits));
  // Deliberately NOT autoDesignIfNeeded() here. That call belongs to ensureSolve()'s fresh-solve
  // path -- "a brand-new combo we are testing" (John, 2026-09-11) -- where there is no saved
  // picture to match yet. A combo reaching loadCombo (gallery click, saved-combo list, a deep-
  // search "load") already has whatever curve it was saved with, and autoDesignIfNeeded can
  // redesign an OLD-style factor-loop repair (no `auto` flag, but recognised as non-hand) into a
  // DIFFERENT curve than the one the picture was drawn with -- the opposite of "treat each gallery
  // image as a saved combo... so we are sure we match the picture" (John, 2026-09-12). If a loaded
  // combo still needs curves, the "shape check" line and its button say so explicitly instead.
  render();
  activateFamily({exact:true});     // true-parameter sliders active on load, shape untouched --
                                     // self-guards (no-op if unsolved or rigid)
}
$('comboSave').onclick=()=>{ if(!cur){ alert('pick a type first'); return; }
  const name=prompt('Save combo as:', comboName()); if(!name) return;
  const all=loadCombos(); all[name]=currentCombo(); saveCombos(all); refreshComboList(name); };
$('comboLoad').onclick=()=>{ const name=$('comboList').value; if(!name) return;
  const all=loadCombos(); if(all[name]) loadCombo(all[name]); };
$('comboList').onchange=e=>{ if(e.target.value) $('comboLoad').click(); };   // pick from list = load it
$('comboDel').onclick=()=>{ const name=$('comboList').value; if(!name) return;
  if(!confirm('Delete saved combo "'+name+'"?')) return;
  const all=loadCombos(); delete all[name]; saveCombos(all); refreshComboList(); };

// +/- zoom buttons overlaid on the canvas corner -- same tileZoom/fullZoom state the
// wheel-zoom in wireTileCurveEdit drives, so scroll-to-zoom and the buttons stay in sync.
// Scrolling with ctrl held used to fall through to the browser's own page zoom in the full
// view because nothing there called preventDefault(); these buttons are the reliable path
// regardless of that, and the wheel handler above now preventDefaults in 'full' too.
function zoomState(){ const v=$('view').value; return v==='full'?fullZoom:(v==='tiles'?tileZoom:null); }
$('zoomIn').onclick=()=>{ const z=zoomState(); if(!z) return; z.scale=Math.min(z===fullZoom?50:20, z.scale*1.3); redrawShape(); };
$('zoomOut').onclick=()=>{ const z=zoomState(); if(!z) return; z.scale=Math.max(1, z.scale/1.3); redrawShape(); };
$('zoomReset').onclick=()=>{ const v=$('view').value;
  if(v==='full') fullZoom={scale:1,cx:null,cy:null};
  else if(v==='tiles') tileZoom={scale:1,cx:null,cy:null};
  redrawShape(); };

// download the current canvas as a PNG (on an opaque background so it isn't transparent)
$('savePng').onclick=()=>{ const cv=$('cv'), t=document.createElement('canvas'); t.width=cv.width; t.height=cv.height;
  const tg=t.getContext('2d'); tg.fillStyle='#fafafa'; tg.fillRect(0,0,t.width,t.height); tg.drawImage(cv,0,0);
  const a=document.createElement('a'); a.download=`tiling_${cur?cur.id:'x'}_${curM||'?'}sides_${$('view').value}.png`;
  a.href=t.toDataURL('image/png'); a.click(); };

// Tiles for the full view and the SVG: from the TRANSLATION BLOCK when its lattice can be read --
// exact at any size, nothing accumulating along a chain of gluings -- else develop(). The recipe is
// combinatorial (engine/lattice_draw.js): built once per combo and reused on every slider move, where
// only layout() runs (John, 2026-09-14: "if we use sliders to change things, we can find the whole
// block without researching"). A read that fails -- a lattice not yet seen in the patch, or a shape
// that does not close exactly -- falls back to develop(); it never draws a wrong tiling.
// The last basis is handed back to layout() so it is CONTINUED as the shape moves (tile numbers
// hold), and while a full-view corner drag holds a tile by index the drawing window is frozen too.
let _latRec = { key: null, rec: null, basis: null }, lastDrawSource = '';
function placedTiles(verts, want){
  const m=curM, ned=curCfg.ned;
  if(typeof LatticeDraw!=='undefined' && manual){
    const key=[cur.id, curM, $('sumType2').value, $('orient2').checked?1:0, +$('offset2').value||0].join('|');
    // curCfg carries no k/n (they live on cur) -- without them sideTables failed and every combo
    // silently fell back to develop()
    const ctx=Object.assign({}, curCfg, {k:cur.k, n:cur.n});
    const build=()=>{ let rec=null; try{ rec=LatticeDraw.buildRecipe(TilerCore, ctx, m, {witness:{A:manual.A, L:manual.L}}); }catch(e){ rec=null; }
                      _latRec={key, rec, basis: _latRec.key===key ? _latRec.basis : null}; };
    if(_latRec.key!==key) build();
    const lay=()=>{ try{ return _latRec.rec ? LatticeDraw.layout(TilerCore, _latRec.rec, manual.A, manual.L, _latRec.basis) : null; }catch(e){ return null; } };
    let L1=lay();
    if(_latRec.rec && !(L1 && L1.ok)){ build(); L1=lay(); }     // a slider move may need a bigger patch: rebuild once
    if(L1 && L1.ok){
      _latRec.basis={t1:L1.t1, t2:L1.t2};
      lastDrawSource='translation block of '+L1.reps.length+' tile'+(L1.reps.length>1?'s':'');
      const win=cornerDrag&&cornerDrag.full&&cornerDrag.win ? cornerDrag.win : null;
      return LatticeDraw.tiles(L1, want, win);
    }
  }
  lastDrawSource='developed patch';
  return TilerCore.develop(verts,cur.k,cur.n,ned[5].slice(),ned[4].map(Math.abs),ned[2],ned[3],ned[6],want);
}
// developed-tile-patch polygons for the currently loaded/solved shape, curved or not --
// shared by the SVG export button and the paired-picture save below. Returns null if
// there's nothing solved to draw (caller decides how to report that).
function currentDrawTiles(){
  if(!manual||!curCfg||!cur) return null;
  const m=curM, ned=curCfg.ned;
  const gap=TilerCore.gapOf(manual.A,manual.L,m), scale=Math.max(...manual.L);
  if(gap/scale>=0.02) return null;                  // doesn't close
  const verts=TilerCore.verticesOf(manual.A,manual.L,m).slice(0,m);
  const placed=placedTiles(verts,260);                 // translation block when readable, else develop()
  return curvesOn() ? (()=>{ const cs=curveSet(); return TilerCurves.buildCurvedTiles(placed,cs.baseMgon,cs.curveOf); })()
                     : placed.map(t=>({orbit:t.orbit,pts:t.verts}));
}
// download the full developed tiling as a scalable SVG (each tile = one filled polygon;
// curved edges are the same polylines the canvas draws).  Independent of the current view.
$('saveSvg').onclick=()=>{
  if(!manual||!curCfg||!cur){ alert('pick and solve a tiling first'); return; }
  const gap=TilerCore.gapOf(manual.A,manual.L,curM), scale=Math.max(...manual.L);
  if(gap/scale>=0.02){ alert("tile doesn't close (gap "+(gap/scale).toFixed(3)+") — adjust angles/lengths first"); return; }
  const draw=currentDrawTiles();
  const svg=TilerSVG.tilesToSVG(draw);
  const a=document.createElement('a'); a.download=`tiling_${cur.id}_${curM}sides${curvesOn()?'_curved':''}.svg`;
  a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})); a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

// ---------- file-based combo save/load ----------
// Same combo format as the in-browser list above: reuse currentCombo() and loadCombo() so
// a combo saved to a file and one kept in localStorage are interchangeable.
$('saveCombo').onclick=()=>{ if(!cur||!curM){ alert('pick a config first'); return; }
  const c=currentCombo();
  // disambiguate on si/orient/off -- the plain `${id}_${m}sides` name collides across every
  // combo of the same type at the same size, which is why last session's saves used this
  // scheme by hand.
  const si=runSums(curM).findIndex(s=>JSON.stringify(s)===c.sum);
  const base=`combo_${c.id}_m${c.m}_si${si}_or${c.orient}_off${c.off}`;
  // JSON only -- a paired SVG download used to fire here too, but two downloads per click
  // means the browser's "this site wants to download multiple files" prompt every time, and
  // the dedicated "save SVG" button already covers it when a picture is actually wanted.
  // py/gen_gallery.js renders the picture anyway when this combo is added to combos/.
  const a=document.createElement('a'); a.download=`${base}.json`;
  a.href=URL.createObjectURL(new Blob([JSON.stringify(c,null,1)],{type:'application/json'})); a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('loadComboBtn').onclick=()=>$('loadComboFile').click();
$('loadComboFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=()=>{ try{ const c=JSON.parse(r.result);
    if(c && c.id!=null) loadCombo(c); else alert('not a valid combo file'); }
    catch(err){ alert('bad combo file: '+err.message); } };
  r.readAsText(f); e.target.value=''; };

// Restore a saved deep-search results list. Only the list comes back -- not the search cursor --
// so the panel shows every hit with its load/save buttons, and Start begins a fresh run rather
// than pretending to resume something this session never ran.
$('loadDsListFile').onchange=ev=>{
  const f=ev.target.files&&ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    let p; try{ p=JSON.parse(rd.result); }catch(e){ alert('not valid JSON'); return; }
    const rows=Array.isArray(p)?p:(p.results||[]);
    if(!rows.length){ alert('no results in that file'); return; }
    const id=+(p.id||rows[0].id);
    if(!idxById[id]){ alert('type #'+id+' is not in this index'); return; }
    if(!cur || cur.id!==id){ $('bid').value=id; pickById(); }
    const st=deepSearchState;
    deepSearchReset(id);
    st.results = rows.map(r=>({ m:+r.m, si:+r.si, sumStr:r.sum||r.sumStr, or:+r.or, off:+r.off,
                                kind:r.kind, crit:r.crit||'', blk:r.blk||'' }));
    st.perSize = (p.sizesCompleted||[]).slice();
    st.startM = p.startM||st.startM; st.targetM = p.targetM||st.targetM;
    st.grandCombos = p.combosTried||0;
    if(p.skipIsohedral!=null) st.skipIso = !!p.skipIsohedral;
    if(p.skipReducible!=null) st.skipRed = !!p.skipReducible;
    st.grandRedSkipped = p.reducibleSkipped||0;
    st.grandIsoSkipped = p.isohedralNotListed||0;
    $('view').value='deepsearch'; render();
    const n=$('dsListNote'); if(n) n.textContent=`loaded ${st.results.length} results from ${f.name}`;
  };
  rd.readAsText(f);
  ev.target.value='';                                  // so re-picking the same file fires again
};

// ---------- reduce: find the fewer-sided version of the current tile, in-browser ----------
// Port of _dev_isohedral/reduce_combo.js (John, 2026-08-08: "it would be nice if there was some
// way to automatically find the reduced version... find the combo that is the reduced version").
// Same algorithm as the Node tool -- see reduce_combo.js's own header comment for the derivation
// -- just built on mono2iso's own runSums/runSpecify/parseCfg instead of test_harness.js, and
// loading the result straight into the view via loadCombo() instead of writing a file.
function configFor(id,m,orient,off,si){
  loadType(id);
  let sums; try{ sums=runSums(m); }catch(e){ sums=[]; }
  const sum=sums[si]; if(!sum) return null;
  let txt; try{ txt=runSpecify(sum,orient,off); }catch(e){ return null; }
  const cfg=parseCfg(txt,m);
  if(cfg && !cfg.impossible){ cfg.ned=netEdgeData.map(r=>r.slice()); cfg.vertexAngle=reducibleVertex.slice(0,m); }
  return cfg;
}
function repMapAt(cfg,m,i){
  let p=i, code=0, guard=0;
  while(cfg.whichEdge[p]!=null && cfg.whichEdge[p]!==p && guard++<m){ code^=(cfg.mapping[p]||0); p=cfg.whichEdge[p]; }
  return {rep:p, code};
}
const SYM4={0:'J',1:'U',2:'I',3:'S'};
// general merge-symmetry rule (derived + brute-force verified this session): merged edge of
// `span` sub-edges is U iff c_i^c_{span-1-i}==1 for every flanking pair (same orbit required per
// pair, not globally), S iff ==3; odd span's self-paired middle must independently be U/I or S/I.
function mergedCurveTypeAt(cfg,m,origStart,span){
  const subs=[]; for(let j=0;j<span;j++) subs.push((origStart+j)%m);
  const info=subs.map(e=>({e, ...repMapAt(cfg,m,e), type:SYM4[cfg.edgeSym[e]]}));
  let isU=true, isS=true;
  for(let i=0;i<Math.floor(span/2);i++){
    const a=info[i], b=info[span-1-i];
    if(a.rep!==b.rep){ isU=false; isS=false; continue; }
    const x=a.code^b.code;
    if(x!==1) isU=false;
    if(x!==3) isS=false;
  }
  if(span%2===1){
    const mid=info[(span-1)/2];
    if(!(mid.type==='U'||mid.type==='I')) isU=false;
    if(!(mid.type==='S'||mid.type==='I')) isS=false;
  }
  return isU?'U':isS?'S':'J';
}
function residualForA(eqs,A){
  let maxR=0;
  for(const eq of eqs){ let sum=0; for(let i=0;i<A.length;i++) sum+=eq[i]*A[i];
    const r=Math.abs(((sum-eq[A.length]+180)%360+360)%360-180); if(r>maxR) maxR=r; }
  return maxR;
}
function reduceCurrentCombo(){
  if(!cur||!curM||!manual){ alert('pick and solve a tiling first'); return; }
  const id=cur.id, m=curM;
  let cfg = (curCfg && curCfg.vertexAngle) ? curCfg : curConfig();
  if(!cfg || cfg.impossible || !cfg.vertexAngle){ alert('no reducibility data for this config'); return; }
  // IDENTIFY is John's, unchanged: specify()'s vertexAngle mask marks the redundant positions
  // ("check if the tile is duplicated with fewer edges by checking if the angles all map to
  // vertices"). Nothing is added to it. An earlier version bolted on a rule of my own -- a
  // forced-flat angle between two I edges -- and separately searched other (orient,off) labellings
  // for one that offered a drop set. Both were wrong: edgeSym is labelling-dependent, so the
  // search found relabellings in which the CURVES read differently and then merged curves that
  // cannot merge. John, 2026-09-06: "we can't combine 3 J curves into an S curve... this isn't
  // real reducing." Reduce the tile as it is labelled on screen, using his test only.
  const va=cfg.vertexAngle;
  const dropped=[]; for(let i=0;i<m;i++) if(va[i]===0) dropped.push(i);
  if(!dropped.length){ alert('this tile is irreducible -- specify() marks every position as a genuine vertex.'); return; }
  const newM=m-dropped.length;
  if(newM<3){ alert('reduction would collapse to fewer than 3 sides'); return; }
  const useA=manual.A, useL=manual.L;
  // construct the merged shape from the ACTUAL VERTEX COORDINATES of the currently-shown
  // manual A/L, not from its angles/lengths directly. John: "feed the old coordinates of the
  // vertices you will use into the Newton solver -- it should already be a solution... the
  // other angles are between what will now be parts of the curve on the new edge." The kept
  // vertices already sit at fixed positions satisfying THIS tile's own closure; connecting them
  // by straight CHORDS (skipping the dropped ones) is trivially still a closed polygon --
  // whatever bend the dropped vertices had becomes curve detail on the new edge, exactly the
  // "replace each vertex with a point on the curve" idea this tool started from. This replaces
  // the old "keep the original angle, sum the lengths" guess, which has no correct meaning when
  // the dropped vertex's actual angle isn't 180 (the general case -- see the closure-check
  // comment below, which is what caught this).
  const A=useA, L=useL;
  const droppedSet0=new Set(dropped);
  const kept=[]; for(let i=0;i<m;i++) if(!droppedSet0.has(i)) kept.push(i);
  if(kept.length<3){ alert('too many flat vertices -- reduction would collapse to fewer than 3 sides'); return; }
  const Vall=TilerCore.verticesOf(A,L,m);
  const Vk=kept.map(i=>Vall[i]);
  const K=kept.length;
  const newL=Vk.map((p,k)=>{ const q=Vk[(k+1)%K]; return Math.hypot(q[0]-p[0], q[1]-p[1]); });
  const newA=Vk.map((cur,k)=>{
    const prev=Vk[(k-1+K)%K], next=Vk[(k+1)%K];
    const dIn=Math.atan2(cur[1]-prev[1], cur[0]-prev[0])*180/Math.PI;
    const dOut=Math.atan2(next[1]-cur[1], next[0]-cur[0])*180/Math.PI;
    return ((180-(dOut-dIn))%360+360)%360;
  });

  const mergedNewEdges=[];
  kept.forEach((v,k)=>{
    const vNext=kept[(k+1)%kept.length];
    const span=((vNext-v+m)%m)||m;
    if(span>1) mergedNewEdges.push({newIdx:k, span, origStart:v});
  });
  // net-edge sizes don't depend on (orient,off), but which positions share an orbit does --
  // FIND THE TARGET. Search every (si, orient, off) at the smaller size and keep the ones whose
  // angle equations the reduced polygon actually satisfies -- geometry, not net-edge bookkeeping.
  // The old code matched net-edge SIZES instead and then hunted (orient,off) within one si; that
  // refused real reductions ("a net edge would vanish") and, worse, could land on a combo that is
  // itself reducible.
  //
  // The target must be IRREDUCIBLE by John's own test. That is the whole point of his program
  // skipping reducible combos: such a combo is a padded duplicate, so reducing into one has not
  // finished the job. On #600159 m10 si18 or1 off6 the old code landed on m8 si2 or0 off6, which
  // specify() flags reducible (vertexAngle 11110011), and a further "reduction" from there merged
  // three J curves into an S. Requiring an irreducible target picks si2 or1 off4 instead -- the
  // combo John found by eye.
  let newSums2; try{ newSums2=runSums(newM); }catch(e){ newSums2=[]; }
  const usable=[], padded=[];
  for(let s2=0; s2<newSums2.length; s2++) for(const o of [0,1]) for(let f=0; f<newM; f++){
    const c2=configFor(id,newM,o,f,s2);
    if(!c2||c2.impossible||!c2.eqs||!c2.vertexAngle) continue;
    const r=residualForA(c2.eqs,newA);
    if(r>1e-6) continue;
    const rec={si:s2,o,f,r,c2};
    (c2.vertexAngle.some(v=>v===0) ? padded : usable).push(rec);
  }
  if(!usable.length){
    alert(padded.length
      ? `reducible (dropping ${dropped.join(',')}), but all ${padded.length} combos at ${newM} sides that `
        + `carry the reduced shape are THEMSELVES reducible -- they are padded duplicates too, so this is `
        + `not the real reduction.`
      : `reducible (dropping ${dropped.join(',')}), but no combo at ${newM} sides carries the reduced shape.`);
    return;
  }
  usable.sort((a,b)=>a.r-b.r);
  const bestFit={o:usable[0].o, f:usable[0].f, r:usable[0].r, c2:usable[0].c2, agree:0};
  const matchSi=usable[0].si;
  if(padded.length) console.log(`reduce: ${usable.length} irreducible target(s) at ${newM} sides; `
    + `rejected ${padded.length} that specify() also calls reducible.`);

  // The chord construction above always closes as a standalone polygon (up to floating point --
  // it connects points that already form a closed loop), so this is now mostly a sanity check.
  // What it still catches: the angle-equation residual above is satisfied trivially whenever
  // it's checked against angles that don't come from a real closing shape, so it alone was never
  // sufficient proof (that was the actual bug); real closure is the thing that matters.
  const naiveGapXY = (()=>{ let x=0,y=0,dir=0; for(let i=0;i<newM;i++){ x+=newL[i]*Math.cos(dir*Math.PI/180); y+=newL[i]*Math.sin(dir*Math.PI/180); dir+=180-newA[(i+1)%newM]; } return Math.hypot(x,y); })();
  const naiveScale = Math.max(...newL);
  let finalA=newA, finalL=newL, usedDefaultFamily=false;
  if(bestFit.r>=1e-3 || naiveGapXY/naiveScale>=1e-3){
    const groups2=lenGroups(bestFit.c2.whichEdge,newM);
    let sp; try{ sp=TilerCore.solveTile(bestFit.c2.eqs, groups2, newM, {seed:{A:newA,L:newL}, edgeSym:bestFit.c2.edgeSym, fdEps:1e-6, lam:1e-7, ftol:1e-14, maxIt:800}); }catch(e){ sp=null; }
    // A solve seeded near the ORIGINAL (mismatched) angles can converge onto a clamp-floor
    // false closure -- an edge length pinned at unpack()'s 0.05 lower bound, i.e. an exact 20:1
    // length ratio -- which is a solver artifact, not geometry (see reference_two_clamp_floors
    // memory). Don't trust that seeded result; fall back to the type's own DEFAULT (unseeded)
    // solve instead, which lands on an honest (if generic) point in the family.
    if(sp && sp.ok && !sp.clamped){ finalA=sp.A; finalL=sp.L; }
    else{
      let sp2; try{ sp2=TilerCore.solveTile(bestFit.c2.eqs, groups2, newM, {edgeSym:bestFit.c2.edgeSym}); }catch(e){ sp2=null; }
      if(sp2 && sp2.ok && !sp2.clamped){ finalA=sp2.A; finalL=sp2.L; usedDefaultFamily=true; }
      else if(sp && sp.ok){ finalA=sp.A; finalL=sp.L; usedDefaultFamily=true; }  // both clamped -- use the seeded one, still flag it
      else { alert('found the right size ('+newM+' sides) but could not solve it at all (residual '+bestFit.r.toFixed(3)+'°). Try nudging the current shape closer to its ideal angles first, then reduce again.'); return; }
    }
  }

  // cross-check: derived merge type (from the ORIGINAL config) vs. the matched config's own
  // edgeSym -- independent paths, so a disagreement is worth a confirm before loading it anyway.
  // (mergedNewEdges was already computed above, before the (orient,off) search, so it could be
  // used as that search's tie-breaker too.)
  const mismatch = mergedNewEdges.some(me=>{
    const derived=mergedCurveTypeAt(cfg,m,me.origStart,me.span);
    const declared=SYM4[bestFit.c2.edgeSym[me.newIdx]];
    return derived!==declared && declared!=='I';
  });
  if(mismatch && !confirm('The derived curve type for at least one merged edge disagrees with the matched config\'s own edge type (residual '+bestFit.r.toFixed(6)+'°). Load it anyway?')) return;

  if(usedDefaultFamily) alert('This type has genuine shape freedom at '+newM+' sides, and the original tile was not at the special (flat-vertex) point of its own family, so there is no single "correct" reduced shape to match it to. Loaded a generic default point in the family instead -- drag the true-parameter sliders (already active) to reshape it.');

  // Port curve detail through the reduction. John: "where I added an S curve to match where the
  // old reduced vertices were -- that's very nice to have. It helps us humans see that this is
  // the same shape... take the curve points of one subedge, then add the vertex we reduce, then
  // add the curve points of the next subedge etc." Only meaningful when finalA/finalL is the
  // chord-seeded shape (skip if we fell back to a generic default point in the family -- the
  // chord world-positions used below would not correspond to that unrelated shape at all).
  // Reduce what is ON SCREEN. `curveEdits` survives unticking "demo curves" -- the box gates
  // seeding and drawing, not the stored object -- so reading it unconditionally reduced a curved
  // tile the user was not looking at. John, 2026-09-07: "I had the demo curves switched off and hit
  // reduce. It acted like I had first switched on demo curves, then reduced it. So we had extra
  // curves added to each edge."
  //
  // With curves off the tile IS the straight m-gon, so untouched edges carry nothing. A MERGED edge
  // is different: the dropped vertices are real corners of that straight polygon, and the merged
  // edge has to follow the old polyline or the reduced tile is a different shape. So a merge can
  // still need a curve even with curves off -- but only when the polyline actually bends, which is
  // checked below rather than assumed.
  const useCurves = curvesOn();
  const newCurveEdits={};
  if(useCurves) if(!usedDefaultFamily) for(const [dst,pOrig] of [
      ...kept.map((v,k)=>[k,v]).filter(([k])=>!mergedNewEdges.some(me=>me.newIdx===k)),  // untouched kept edges: port 1:1
    ]){
    const rm=repMapAt(cfg,m,pOrig), oldEd=curveEdits[rm.rep];
    if(!oldEd || !Array.isArray(oldEd.pts)) continue;
    const declaredType=SYM4[bestFit.c2.edgeSym[dst]];
    if(declaredType==='I') continue;                       // buildCanon ignores pts for I -- nothing to store
    const fullAtPos=TilerCurves.applyMap(TilerCurves.buildCanon(oldEd.type,oldEd.pts), rm.code);
    const rmNew=repMapAt(bestFit.c2,newM,dst);
    const repPts=TilerCurves.applyMap(fullAtPos, rmNew.code);   // applyMap is an involution -- inverts back to the new rep's frame
    newCurveEdits[rmNew.rep]={ type:oldEd.type, pts:extractStorablePts(oldEd.type, repPts) };
  }
  if(!usedDefaultFamily) for(const me of mergedNewEdges){
    const declaredType=SYM4[bestFit.c2.edgeSym[me.newIdx]];
    if(declaredType==='I') continue;                       // buildCanon ignores pts for I -- nothing to store
    const worldPts=[];
    for(let j=0;j<me.span;j++){
      const pOrig=(me.origStart+j)%m;
      const rm=repMapAt(cfg,m,pOrig), ed=useCurves ? curveEdits[rm.rep] : null;
      const P0=Vall[pOrig], P1=Vall[(pOrig+1)%m];
      const segPts = (ed && Array.isArray(ed.pts))
        ? TilerCurves.mapToEdge(TilerCurves.applyMap(TilerCurves.buildCanon(ed.type,ed.pts), rm.code), P0, P1, false)
        : [P0, P1];
      if(worldPts.length) segPts.shift();                  // drop the duplicate junction point
      worldPts.push(...segPts);
    }
    const V0=Vk[me.newIdx], V1=Vk[(me.newIdx+1)%K];
    const canonPts=worldPts.map(W=>TilerCurves.unmapFromEdge(V0,V1,W));
    // Straight merges need no curve at all -- storing one would switch curves on for a tile that
    // does not need them. In canonical [0,1] frame a straight edge has every y at 0.
    const bends = canonPts.some(pt=>Math.abs(pt[1])>1e-9);
    if(!bends && !useCurves) continue;
    newCurveEdits[me.newIdx]={ type:declaredType, pts:extractStorablePts(declaredType, canonPts) };
  }

  // If curves were OFF but a merge bends, the reduced tile cannot be drawn without curves, so
  // they get switched on -- and ensureCurveEdit would then seed a DEMO motif onto every other
  // editable orbit, which is exactly the "extra curves added to each edge" complaint coming back
  // by another route. Pin those edges FLAT instead: a stored, explicitly straight curve is left
  // alone by the seeder, so only the merged edges bend.
  if(!useCurves && Object.keys(newCurveEdits).length){
    for(let k=0;k<K;k++){
      if(newCurveEdits[k]) continue;                     // a merged edge; keep its real curve
      const t2=SYM4[bestFit.c2.edgeSym[k]];
      if(t2==='I') continue;                             // I ignores pts entirely
      const rmK=repMapAt(bestFit.c2,newM,k);
      if(newCurveEdits[rmK.rep]) continue;
      newCurveEdits[rmK.rep]={ type:t2, pts:extractStorablePts(t2, [[0,0],[1,0]]) };
    }
  }

  loadCombo({ id, m:newM, sum:JSON.stringify(newSums2[matchSi]), orient:bestFit.o, off:bestFit.f,
    // Curves come back on only if the user had them on, or if a merge genuinely bends and the
    // reduced tile cannot be drawn correctly without one.
    view:'tiles', curves:useCurves || Object.keys(newCurveEdits).length>0,
    manual:{A:finalA,L:finalL}, curveEdits:newCurveEdits });
}
// Reduce the canonical [0,1] curve points (sorted by x, endpoints exactly (0,0)/(1,0) by
// construction) to what curveEdits actually stores: J keeps everything; U/S keep only the
// first half (x<=0.5) plus a fold point forced to exactly x=0.5 (interpolated if no point
// already sits there), with S additionally forcing the fold's y to 0 (point symmetry).
function extractStorablePts(type, full){
  if(type==='I'||!full.length) return [[0,0],[1,0]];
  if(type==='J') return full;
  const half=full.filter(p=>p[0]<=0.5+1e-9).map(p=>p.slice());
  let foldY;
  const exact=full.find(p=>Math.abs(p[0]-0.5)<1e-9);
  if(exact) foldY=exact[1];
  else{
    let lo=null,hi=null;
    for(let i=0;i<full.length-1;i++){ if(full[i][0]<=0.5&&full[i+1][0]>=0.5){ lo=full[i]; hi=full[i+1]; break; } }
    foldY = lo&&hi ? lo[1]+(0.5-lo[0])/((hi[0]-lo[0])||1)*(hi[1]-lo[1]) : (half.length?half[half.length-1][1]:0);
  }
  if(type==='S') foldY=0;
  if(half.length && Math.abs(half[half.length-1][0]-0.5)<1e-9) half[half.length-1]=[0.5,foldY];
  else half.push([0.5,foldY]);
  if(half.length) half[0]=[0,0]; else half.push([0,0],[0.5,foldY]);
  return half;
}
$('reduceBtn').onclick=reduceCurrentCombo;

// Opening type. refreshMatches auto-selects the FIRST match, so this really picks a type, not
// just a filter -- and 3_2 4_2 selected #193, which is PROVEN IMPOSSIBLE, so the page opened on
// the red impossibility banner and a tile that cannot exist. 5_2 6_2 leads to #1344 (John,
// 2026-09-06), which is `possible` on L3 evidence -- an exact certificate, the strongest we have
// -- so the first thing shown is a tiling that actually works. All five 5_2 6_2 types are
// possible, so the neighbouring entries in the dropdown are sound too.
$('bk').value='5';$('bq').value='2';$('bn').value='6';$('br').value='2';
refreshOrbs();                 // must precede refreshMatches: that reads the orbifold filter
refreshMatches();
refreshComboList();

// ---- deep links: open the app on a particular tiling from a URL -----------------------------
//
// So a tiling can be handed to someone as a link rather than as a file they have to import, and
// so a page of results can link straight into the app. Two forms:
//
//   mono2iso.html?id=601142&m=24&si=3&or=0&off=5          combo COORDINATES, shape solved fresh
//   mono2iso.html#c=<base64url of a combo JSON>           a whole combo, shape and curves included
//
// The coordinate form is the one to write by hand or generate from a census row: it is short,
// readable, and uses exactly the names every CSV, filename and note in this project already uses
// (id / m / si / or / off). `si` is the INDEX into runSums(m), which is what the CSVs store; pass
// `sum=[...]` instead to give the sum-type by value. Optional: view=full|tiles, curves=1|0.
//
// The base64 form carries the shape, so it reproduces an exact picture including hand-drawn curve
// points. Use it for "here is the tiling I mean", the coordinate form for "here is which combo".
//
// PRECISION. A shape that arrives through a URL has been through text, and a stored closure gap of
// only ~2.5e-4 is enough to develop into visible overlaps out in a large patch -- that is what was
// wrong with #209100 and #209087. So any shape arriving from a link is projected back onto exact
// closure before it is drawn. That costs nothing when the link was already precise.
function deepLinkParams(){
  const p = new URLSearchParams(location.search);
  // accept the same params after '#' too, so a link survives being pasted somewhere that eats the
  // query string, and so the big base64 form can sit in the fragment where it is not sent to a server
  const h = location.hash.replace(/^#/, '');
  if (h) for (const [k, v] of new URLSearchParams(h)) if (!p.has(k)) p.set(k, v);
  return p;
}
function b64urlDecode(s){
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(Array.prototype.map.call(atob(s),
    c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}
function b64urlEncode(s){
  const b = btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (m, x) => String.fromCharCode(parseInt(x, 16))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Project the loaded shape back onto exact closure. Min-change Newton with no drivers, so it moves
// the shape as little as the constraints allow -- it repairs rounding, it does not redesign.
function reclosLoaded(){
  if (!manual || !curCfg || !curCfg.eqs || !curM) return;
  let gap; try { gap = TilerCore.gapOf(manual.A, manual.L, curM); } catch (e) { return; }
  const scale = Math.max(...manual.L) || 1;
  if (!(gap / scale > 1e-9)) return;                     // already exact
  try {
    // the general rule (2026-09-14): reclose to full precision, keep it only if it rounds back
    const groups = lenGroups(curCfg.whichEdge, curM);
    const rs = TilerCore.recloseSaved(curCfg.eqs, groups, curM, manual.A, manual.L);
    if (rs.ok) manual = { A: rs.A, L: rs.L };
  } catch (e) { /* leave the shape as it arrived rather than breaking the load */ }
}
function applyDeepLink(){
  const p = deepLinkParams();
  if (!p.has('id') && !p.has('c')) return false;
  try {
    let combo = null;
    if (p.has('c')) {
      combo = JSON.parse(b64urlDecode(p.get('c')));
    } else {
      const id = +p.get('id'), m = +p.get('m');
      if (!id || !m) { alert('link needs both id and m, e.g. ?id=601142&m=24&si=3'); return false; }
      // the type must be selected before runSums(m) can answer for it
      $('bid').value = id; pickById();
      $('size').value = m; selectSize(m);
      let sumStr = p.get('sum');
      if (!sumStr) {
        const si = +(p.get('si') || 0), all = runSums(m);
        if (!all.length) { alert('#' + id + ' has no sum-types at ' + m + ' sides'); return false; }
        if (si < 0 || si >= all.length) {
          alert('si=' + si + ' is out of range: #' + id + ' has ' + all.length + ' sum-types at ' + m + ' sides');
          return false; }
        sumStr = JSON.stringify(all[si]);
      }
      combo = { id, m, sum: sumStr,
        orient: +(p.get('or') || p.get('orient') || 0) ? 1 : 0,
        off: +(p.get('off') || 0),
        view: p.get('view') || 'full',
        curves: p.get('curves') === '0' ? false : (p.has('curves') ? true : false) };
    }
    loadCombo(combo);
    reclosLoaded();
    render();
    return true;
  } catch (e) {
    alert('could not read that link: ' + e.message);
    return false;
  }
}
// Build a link to whatever is on screen now. `full` includes the shape and curves (long link,
// exact picture); otherwise just the coordinates (short link, shape solved fresh on open).
function shareLink(full){
  if (!cur) return null;
  const base = location.href.split('#')[0].split('?')[0];
  if (full) return base + '#c=' + b64urlEncode(JSON.stringify(currentCombo()));
  const si = runSums(curM).findIndex(s => JSON.stringify(s) === $('sumType2').value);
  const q = ['id=' + cur.id, 'm=' + curM, si >= 0 ? 'si=' + si : 'sum=' + encodeURIComponent($('sumType2').value),
             'or=' + ($('orient2').checked ? 1 : 0), 'off=' + (+$('offset2').value || 0),
             'view=' + $('view').value];
  if ($('curves').checked) q.push('curves=1');
  return base + '?' + q.join('&');
}
if ($('comboLink')) $('comboLink').onclick = () => {
  if (!cur) { alert('pick a type first'); return; }
  // shift-click for the exact-picture link, plain click for the short one
  const url = shareLink(!!window.event && window.event.shiftKey);
  if (!url) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => { const b = $('comboLink'), t = b.textContent; b.textContent = 'copied'; setTimeout(() => b.textContent = t, 1200); },
      () => prompt('copy this link:', url));
  } else prompt('copy this link:', url);
};
applyDeepLink();
