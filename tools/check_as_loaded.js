// Every gallery combo, drawn EXACTLY the way mono2iso draws it when John clicks the image:
// the curveEdits as saved in the file, no repair factor and no motif shift.
//
// This is the check the gallery generator does NOT do. The generator repairs the PICTURE and, until
// 2026-09-09, kept the repair to itself -- so a combo could have a clean thumbnail and an
// overlapping tiling behind the link. John, on #25643 si16: "This is what the gallery gives when I
// click the image. It is overlapping."
const path=require('path'),fs=require('fs');
const H=require(path.join(__dirname,'lib','test_harness.js')), TC=H.TC;
const CO=require(path.join(__dirname,'lib','curved_overlap.js'));
const TCu=require(path.join(__dirname,'lib','tiler_curves.js'));
const ROOT=path.join(__dirname,'..');
const TILES=+(process.argv.find(a=>a.startsWith('--tiles='))||'').split('=')[1]||120;
const files=fs.readdirSync(path.join(ROOT,'data','combos')).filter(f=>f.endsWith('.json')).sort();
let bad=[],skipped=0,ok=0,notReclosed=[];
for(const f of files){
  let c; try{c=JSON.parse(fs.readFileSync(path.join(ROOT,'data','combos',f),'utf8'));}catch(e){skipped++;continue;}
  if(!c.manual||!c.manual.A){skipped++;continue;}
  try{
    const m=c.m;
    H.config(c.id,m,c.orient,c.off,0);H.loadType(c.id);
    const si=H.runSums(m).findIndex(s=>JSON.stringify(s)===c.sum);
    const cfg=H.config(c.id,m,c.orient,c.off,si); if(!cfg||!cfg.ned){skipped++;continue;}
    // saved shapes are rounded: reclose to full precision first, exactly as the app does on load
    const rs=TC.recloseSaved(cfg.eqs,H.lenGroups(cfg.whichEdge,m),m,c.manual.A,c.manual.L);
    if(rs.ok) c.manual={A:rs.A,L:rs.L}; else if(rs.gapBefore>1e-10) notReclosed.push([f,rs.reason]);
    const ned=cfg.ned, es=cfg.edgeSym,we=cfg.whichEdge,mp=cfg.mapping;
    const repMap=i=>{let cur=i,code=0,g=0;while(we[cur]!=null&&we[cur]!==cur&&g++<m){code^=(mp[cur]||0);cur=we[cur];}return{rep:cur,code};};
    const rc=[];for(let i=0;i<m;i++){const r=repMap(i);r.type=TCu.SYM[es[r.rep]]||'J';rc.push(r);}
    const seen=new Set(),byType={};
    for(const o of rc){if(o.type==='I'||seen.has(o.rep))continue;seen.add(o.rep);(byType[o.type]=byType[o.type]||[]).push(o.rep);}
    const variant={};for(const t in byType)byType[t].sort((a,b)=>a-b).forEach((r,i)=>variant[r]=i);
    const V=TC.verticesOf(c.manual.A,c.manual.L,m).slice(0,m);
    const P=TC.develop(V,cfg.k,cfg.n,ned[5].slice(),ned[4].map(Math.abs),ned[2],ned[3],ned[6],TILES);
    let r;
    if(c.curves){
      const ce=JSON.parse(JSON.stringify(c.curveEdits||{}));
      const curveOf=[];for(let i=0;i<m;i++){const{rep,code,type}=rc[i];let ed=ce[rep];
        if(!ed||ed.type!==type||!Array.isArray(ed.pts))ed={type,pts:TCu.motifPts(type,variant[rep]||0)};
        curveOf.push(TCu.applyMap(TCu.buildCanon(type,ed.pts),code));}
      r=CO.overlapCurved(TCu.buildCurvedTiles(P,V,curveOf));
    } else {
      r=CO.overlapCurved(P.map(t=>({orbit:t.orbit,pts:t.verts})));
    }
    if(r.pairs)bad.push([f,r.pairs,r.worstFrac]); else ok++;
  }catch(e){skipped++;}
}
bad.sort((a,b)=>b[2]-a[2]);
console.log(`clicked-through at ${TILES} tiles: ${ok} clean, ${bad.length} overlapping, ${skipped} skipped\n`);
for(const [f,p,w] of bad)
  console.log(`  ${(w*100).toFixed(2).padStart(6)}%  ${String(p).padStart(3)} pairs  ${f.replace('combo_','').replace('.json','')}`);
if(notReclosed.length){ console.log(`\n${notReclosed.length} saved shape(s) do not reclose near themselves -- drawn as saved:`);
  for(const [f,why] of notReclosed) console.log(`  ${f.replace('combo_','').replace('.json','')}: ${why}`); }
