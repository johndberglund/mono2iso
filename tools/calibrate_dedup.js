// Calibrate develop()'s dedup tolerance: how close do LEGITIMATE neighbouring tiles ever get,
// and how far does a duplicate drift? The tolerance has to sit in the gap between the two.
const path=require('path'),fs=require('fs');
const H=require(path.join(__dirname,'lib','test_harness.js')), TC=H.TC;
const ROOT=path.join(__dirname,'..');
const files=fs.readdirSync(path.join(ROOT,'data','combos')).filter(f=>f.endsWith('.json'));
let legit=[], dupd=[];
for(const f of files){
  let c; try{c=JSON.parse(fs.readFileSync(path.join(ROOT,'data','combos',f),'utf8'));}catch(e){continue;}
  if(!c.manual||!c.manual.A)continue;
  const m=c.m;
  try{
    H.config(c.id,m,c.orient,c.off,0);H.loadType(c.id);
    const si=H.runSums(m).findIndex(s=>JSON.stringify(s)===c.sum);
    const cfg=H.config(c.id,m,c.orient,c.off,si); if(!cfg||!cfg.ned)continue;
    const ned=cfg.ned;
    const V=TC.verticesOf(c.manual.A,c.manual.L,m).slice(0,m);
    let diam=0;for(let i=0;i<m;i++)for(let j=i+1;j<m;j++)diam=Math.max(diam,Math.hypot(V[i][0]-V[j][0],V[i][1]-V[j][1]));
    if(!(diam>0))continue;
    const P=TC.develop(V,cfg.k,cfg.n,ned[5].slice(),ned[4].map(Math.abs),ned[2],ned[3],ned[6],120);
    const C=P.map(p=>{let x=0,y=0;for(const q of p.verts){x+=q[0];y+=q[1];}return[x/m,y/m];});
    const ds=[];
    for(let i=0;i<C.length;i++)for(let j=i+1;j<C.length;j++)
      ds.push(Math.hypot(C[i][0]-C[j][0],C[i][1]-C[j][1])/diam);
    ds.sort((a,b)=>a-b);
    // anything under 1e-2 of a diameter is a stacked duplicate, not a neighbour
    const dup=ds.filter(d=>d<1e-2), leg=ds.filter(d=>d>=1e-2);
    if(dup.length){dupd.push([f,dup[dup.length-1]]);}
    if(leg.length)legit.push([f,leg[0]]);
  }catch(e){}
}
legit.sort((a,b)=>a[0]-b[0]);
legit.sort((a,b)=>a[1]-b[1]);
dupd.sort((a,b)=>b[1]-a[1]);
console.log(`scanned ${files.length} combos at 120 tiles\n`);
console.log('CLOSEST LEGITIMATE neighbours (these must never be merged):');
for(const [f,d] of legit.slice(0,6))console.log(`   ${d.toExponential(2)}·diam  ${f.replace('combo_','').replace('.json','')}`);
console.log(`\nDUPLICATES that escaped the 1e-3 tolerance (${dupd.length} combos affected):`);
for(const [f,d] of dupd.slice(0,10))console.log(`   ${d.toExponential(2)}·diam  ${f.replace('combo_','').replace('.json','')}`);
if(dupd.length&&legit.length)
  console.log(`\nworst duplicate ${dupd[0][1].toExponential(2)}  <-- gap -->  closest real neighbour ${legit[0][1].toExponential(2)}`);
