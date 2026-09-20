// Does every gallery combo have true-parameter sliders, or are some shapes rigid?
//
// A "true parameter" slider is a DRIVER of the closing family: TC.pickDrivers returns the
// coordinates that can be moved freely while closeConstrained re-solves the rest. Zero drivers
// means the closing conditions pin the shape completely -- there is nothing to slide, and the
// tiling in the gallery is the only shape that combo can have.
const fs=require('fs'), path=require('path');
const H=require(path.join(__dirname,'lib','test_harness.js')), TC=H.TC;
const ROOT=path.join(__dirname,'..');
const files=fs.readdirSync(path.join(ROOT,'data','combos')).filter(f=>f.endsWith('.json')).sort();
const byCount={}, rigid=[], failed=[];
for(const f of files){
  let c; try{c=JSON.parse(fs.readFileSync(path.join(ROOT,'data','combos',f),'utf8'));}catch(e){failed.push([f,'unreadable']);continue;}
  if(!c.manual||!c.manual.A){failed.push([f,'no shape']);continue;}
  try{
    const m=c.m;
    H.config(c.id,m,c.orient,c.off,0);H.loadType(c.id);
    const si=H.runSums(m).findIndex(s=>JSON.stringify(s)===c.sum);
    const cfg=H.config(c.id,m,c.orient,c.off,si);
    if(!cfg||!cfg.ned){failed.push([f,'no config']);continue;}
    const groups=H.lenGroups(cfg.whichEdge,m);
    const F=TC.familyFns(cfg.eqs,groups,m);
    const u0=F.toU(c.manual.A,c.manual.L);
    const drv=TC.pickDrivers(cfg.eqs,groups,m,u0).drivers;
    const n=drv.length;
    byCount[n]=(byCount[n]||0)+1;
    if(n===0)rigid.push(f);
  }catch(e){failed.push([f,e.message]);}
}
const tot=files.length;
console.log(`${tot} gallery combos\n`);
console.log('true-parameter sliders   combos');
for(const k of Object.keys(byCount).map(Number).sort((a,b)=>a-b))
  console.log(`   ${String(k).padStart(2)} slider${k===1?' ':'s'}            ${String(byCount[k]).padStart(4)}`);
if(failed.length)console.log(`   (could not measure ${failed.length})`);
console.log(`\n${rigid.length} combos are RIGID -- no slider at all:`);
for(const f of rigid.slice(0,40))console.log('   '+f.replace('combo_','').replace('.json',''));
if(rigid.length>40)console.log(`   ...and ${rigid.length-40} more`);
if(failed.length){console.log('\ncould not measure:');
  for(const [f,e] of failed.slice(0,10))console.log('   '+f.replace('combo_','').replace('.json','')+'  '+e);}
