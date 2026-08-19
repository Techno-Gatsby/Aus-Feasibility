/* eslint-disable */
// @ts-nocheck
//
// AUSTRALIAN FEASIBILITY MODEL - extracted verbatim, not rewritten.
//
// Lifted from the MODEL_START .. MODEL_END span of the original single-file
// build. It contains zero DOM references, so it runs headless on the server
// and in tests exactly as it did in the browser.
//
// It is deliberately NOT hand-ported to TypeScript. This is 122 KB of working
// financial logic - deposit schedules, land interim payments, GST, stamp duty,
// FIRB, debt sizing, IRR solving. Retyping it by hand would introduce
// arithmetic bugs that no type annotation would catch, and the model is the
// one part of this app that must stay correct.
//
// Interface is at the bottom: run(inputs, overrides) -> analysis.

/*MODEL_START*/
/* INPUT_UI_SEQUENCE_2026_08_19: five logical buckets; land acquisition supports deposit + 0-5 interim payments + final settlement balance. */
const AUSTRALIA_MODEL_VERSION="2026-08-12-cashflow-format-export-aligned";
/* Australia engine: finished-lot contracting follows one continuous project-wide sales schedule. Construction phases allocate physical lots and construction cost only; they do not cap monthly project sales. For each construction phase, the baseline contract-plus-settlement-lag realisation curve is shifted forward as a whole when necessary so that phase realisation cannot begin before that phase's development is complete. The same unit ledger drives revenue recognition, GST, collections, COGS, debt, tax and equity cash flow. Vertical development retains its prior phase/build logic. */
function _num(v, fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
function _clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v))}
function _spendWeights(duration,mode){
  const n=Math.max(1,Math.round(duration)),w=new Array(n).fill(1);
  if(mode===1){for(let i=0;i<n;i++)w[i]=Math.sin(Math.PI*(i+.5)/n)}
  else if(mode===2){
    /* Milestone / back-ended: light mobilisation, stronger middle, largest completion tranche. */
    if(n===1)w[0]=1;
    else if(n===2){w[0]=.30;w[1]=.70}
    else{for(let i=0;i<n;i++){const q=(i+.5)/n;w[i]=q<.25?.35:q<.50?.75:q<.75?1.20:1.85}}
  }
  else if(mode===3){for(let i=0;i<n;i++)w[i]=n-i}
  else if(mode===4){for(let i=0;i<n;i++)w[i]=i+1}
  const z=w.reduce((a,b)=>a+b,0)||1;return w.map(x=>x/z)
}
function _landSpendWeights(duration,mode){
  const n=Math.max(1,Math.round(duration));
  if(mode===0){const w=new Array(n).fill(0);w[0]=1;return w}
  return _spendWeights(n,Math.max(0,Math.min(4,mode-1)))
}
function _phaseConfig(d,lots){
  const count=_clamp(Math.round(_num(d.nph,1)),1,6);
  const durations=Array.from({length:count},(_,i)=>{
    const entered=_num(d[`ph${i+1}dur`],0);
    return Math.max(1,Math.round(entered>0?entered:_num(d.phm,1)));
  });
  const unitRaw=Array.from({length:count},(_,i)=>Math.max(0,_num(d[`ph${i+1}share`],0)));
  const costRaw=Array.from({length:count},(_,i)=>Math.max(0,_num(d[`ph${i+1}cost`],0)));
  const anyUnit=unitRaw.some(v=>v>0), anyCost=costRaw.some(v=>v>0);
  const unitWeights=anyUnit?unitRaw.map(v=>v/100):Array.from({length:count},()=>1/count);
  const costWeights=anyCost?costRaw.map(v=>v/100):unitWeights.slice();
  const exact=unitWeights.map(w=>w*lots), counts=exact.map(Math.floor);
  let left=lots-counts.reduce((a,b)=>a+b,0);
  exact.map((v,i)=>({i,r:v-counts[i]})).sort((a,b)=>b.r-a.r).forEach(x=>{if(left>0){counts[x.i]++;left--}});
  const starts=[],ends=[],completions=[];let autoCursor=0;
  durations.forEach((dur,i)=>{
    const entered=Math.round(_num(d[`ph${i+1}start`],-1));
    const start=entered>=0?entered:autoCursor;
    starts.push(start);ends.push(start+dur-1);completions.push(start+dur);
    autoCursor=Math.max(autoCursor,start+dur);
  });
  const salesLags=Array.from({length:count},(_,i)=>Math.max(0,Math.round(_num(d[`ph${i+1}saleslag`],0))));
  const velocities=Array.from({length:count},(_,i)=>Math.max(0,_num(d[`ph${i+1}vel`],0)));
  return {count,durations,unitWeights,costWeights,counts,starts,ends,completions,salesLags,velocities,totalMonths:Math.max(...completions,0)};
}
function _computeDerived(raw){
  const o={...raw};
  GROUPS.forEach(g=>g.f.forEach(f=>{if(f[4]==="c")o[f[0]]=f[5](o)}));
  return o;
}
const MAX_PRODUCTS=12;
function productCount(d){return _clamp(Math.round(_num(d&&d.nprod,3)),1,MAX_PRODUCTS)}
function productIds(d){return Array.from({length:productCount(d)},(_,i)=>i+1)}
function sumProducts(d,fn){return productIds(d).reduce((a,p)=>a+fn(p),0)}
function productFieldKeys(){const a=[];for(let p=1;p<=MAX_PRODUCTS;p++)a.push(`n${p}`,`w${p}`,`d${p}`,`p${p}`,`bua${p}`,`hpsf${p}`,`hpsf${p}ovr`,`buildpsf${p}`,`buildpsf${p}ovr`,`vel${p}`,`buildmo${p}`,`buildmo${p}ovr`,`relfixed${p}`);return a}

function _normalizedForDerive(raw){
  const o={...raw};
  o.nprod=_clamp(Math.round(_num(o.nprod,3)),1,MAX_PRODUCTS);
  o.pmode=1;
  ["startMonth","fyEnd"].forEach(k=>o[k]=_clamp(Math.round(_num(o[k],1)),1,12));
  ["ddur","entdur","phm","buildmo","landdur"].forEach(k=>o[k]=Math.max(1,Math.round(_num(o[k],1))));
  ["ddend","close","landdepmonth","firbmonth","gstlag","dellag","pidlag","vlag","modelmo","taxlag","taxqlag"].forEach(k=>o[k]=Math.max(0,Math.round(_num(o[k],0))));
  o.landpaycount=_clamp(Math.round(_num(o.landpaycount,0)),0,MAX_LAND_INTERIM_PAYMENTS);
  for(let i=1;i<=MAX_LAND_INTERIM_PAYMENTS;i++){o[`landpay${i}`]=Math.max(0,_num(o[`landpay${i}`],0));o[`landpay${i}month`]=Math.max(0,Math.round(_num(o[`landpay${i}month`],0)));}
  o.landdeposit=Math.max(0,_num(o.landdeposit,0));
  o.facstart=Math.max(-1,Math.round(_num(o.facstart,-1)));
  o.nph=_clamp(Math.round(_num(o.nph,1)),1,6);
  for(let p=1;p<=MAX_PRODUCTS;p++){o[`n${p}`]=Math.max(0,Math.round(_num(o[`n${p}`],0)));o[`d${p}`]=1;}
  ["depo","ltc","equitypc","pidel","pidrt","landdepo","landgst","stamprt","foreignsurcharge","gst","inputgst"].forEach(k=>o[k]=_clamp(_num(o[k],0),0,100));
  ["vert","escrow","finland","findd","finhoriz","finvert","fincapex","fundi","pidrep","intresout","taxloss","capcarry","capfin","pidacct","presales","revolver","cashfungible","equityreimb","designbase","permitbase","staxdeduct","taxfreq","distlock",
   "stampmode","fundingmode","facmode","ph1escovr","ph2escovr","ph3escovr","ph4escovr","ph5escovr","ph6escovr"].forEach(k=>o[k]=_num(o[k],0)>=.5?1:0);
  for(let p=1;p<=MAX_PRODUCTS;p++)["hpsf","buildpsf","buildmo"].forEach(x=>o[`${x}${p}ovr`]=_num(o[`${x}${p}ovr`],0)>=.5?1:0);
  o.buildbua=Math.max(0,_num(o.buildbua,0));
  o.intconv=_clamp(Math.round(_num(o.intconv,1)),0,2);
  o.staxbase=_clamp(Math.round(_num(o.staxbase,1)),0,2);
  o.allocbasis=_clamp(Math.round(_num(o.allocbasis,1)),0,3);
  o.ovhmode=_clamp(Math.round(_num(o.ovhmode,0)),0,2);
  o.gstmode=_clamp(Math.round(_num(o.gstmode,0)),0,1);
  o.costgstbasis=_clamp(Math.round(_num(o.costgstbasis,1)),0,1);
  o.softmode=_clamp(Math.round(_num(o.softmode,0)),0,1);
  /* Land acquisition is intentionally a two-part transaction: deposit, then settlement balance.
     Keep legacy fields normalised for backward-compatible saved files, but do not use a land spend curve. */
  o.landcurve=0;o.landdur=1;
  o.infracurve=_clamp(Math.round(_num(o.infracurve,0)),0,4);
  o.buildcurve=_clamp(Math.round(_num(o.buildcurve,0)),0,4);
  o.relmode=_clamp(Math.round(_num(o.relmode,0)),0,2);
  o.hoastart=_clamp(Math.round(_num(o.hoastart,1)),0,2);
  o.modelphase=_clamp(Math.round(_num(o.modelphase,0)),0,6);
  o.taxcarrybackyrs=Math.max(0,Math.round(_num(o.taxcarrybackyrs,0)));
  o.taxlossexp=Math.max(0,Math.round(_num(o.taxlossexp,0)));
  o.taxlossutil=_clamp(_num(o.taxlossutil,100),0,100);
  for(let i=1;i<=6;i++){
    o[`ph${i}dur`]=Math.max(0,Math.round(_num(o[`ph${i}dur`],0)));
    o[`ph${i}start`]=Math.max(-1,Math.round(_num(o[`ph${i}start`],-1)));
    o[`ph${i}saleslag`]=Math.max(0,Math.round(_num(o[`ph${i}saleslag`],0)));
    o[`ph${i}vel`]=Math.max(0,_num(o[`ph${i}vel`],0));
    o[`ph${i}esc`]=_num(o[`ph${i}esc`],0);
    o[`ph${i}depo`]=_clamp(_num(o[`ph${i}depo`],-1),-1,100);
    o[`ph${i}dellag`]=Math.max(-1,Math.round(_num(o[`ph${i}dellag`],-1)));
    for(let p=1;p<=MAX_PRODUCTS;p++)o[`ph${i}p${p}`]=Math.max(0,Math.round(_num(o[`ph${i}p${p}`],0)));
  }
  for(let p=1;p<=MAX_PRODUCTS;p++){
    o[`hpsf${p}`]=Math.max(0,_num(o[`hpsf${p}`],0));
    o[`buildpsf${p}`]=Math.max(0,_num(o[`buildpsf${p}`],0));
    o[`buildmo${p}`]=Math.max(0,Math.round(_num(o[`buildmo${p}`],0)));
    o[`vel${p}`]=Math.max(0,_num(o[`vel${p}`],0));
  }
  enforceAccountingPolicy(o);
  return o;
}
function actualInfrastructureTotal(raw){
  const d=_normalizedForDerive(raw), lots=sumProducts(d,p=>d[`n${p}`]), ph=_phaseConfig(d,lots), entStart=d.ddend, ent=entStart+d.entdur, st=Math.max(ent,d.close);
  const base=Math.max(0,d.infl)*lots, esc=1+d.infesc/100;if(!(esc>0))return NaN;
  let total=0;
  ph.durations.forEach((dur,i)=>{const phaseBase=base*ph.costWeights[i],weights=_spendWeights(dur,d.infracurve);for(let k=0;k<dur;k++)total+=phaseBase*weights[k]*Math.pow(esc,(st+ph.starts[i]+k)/12)});
  return total;
}
function baseConstructionTotal(raw){
  const d=_normalizedForDerive(raw),lots=sumProducts(d,p=>d[`n${p}`]);
  return d.vert?Math.max(0,_num(d.buildbua))*Math.max(0,_num(d.buildpsf)):Math.max(0,_num(d.infl))*lots;
}
function actualContingencyTotal(d){return Math.max(0,_num(d.contpc))/100*baseConstructionTotal(d)+Math.max(0,_num(d.contfixed))}
function actualReimbursementTotal(raw){const d=_normalizedForDerive(raw);return (actualInfrastructureTotal(d)+actualContingencyTotal(d))*d.pidel/100*d.pidrt/100}

const MAX_LAND_INTERIM_PAYMENTS=5;
function landDepositAmount(d){
  const landBase=Math.max(0,_num(d.acresGross))*Math.max(0,_num(d.pr)),land=landBase*(1+Math.max(0,_num(d.landgst))/100),manual=Math.max(0,_num(d.landdeposit,0));
  return Math.min(land,manual>0?manual:landBase*Math.max(0,_num(d.landdepo))/100);
}
function landInterimTotal(d){
  const n=_clamp(Math.round(_num(d.landpaycount,0)),0,MAX_LAND_INTERIM_PAYMENTS);let total=0;for(let i=1;i<=n;i++)total+=Math.max(0,_num(d[`landpay${i}`],0));return total;
}
function landPaymentMonths(d){
  const n=_clamp(Math.round(_num(d.landpaycount,0)),0,MAX_LAND_INTERIM_PAYMENTS),a=[];if(landDepositAmount(d)>0)a.push(Math.max(0,Math.round(_num(d.landdepmonth,0))));for(let i=1;i<=n;i++)a.push(Math.max(0,Math.round(_num(d[`landpay${i}month`],0))));a.push(Math.max(0,Math.round(_num(d.close,0))));return new Set(a);
}
const GROUPS=[
 {g:"Site and yield",f:[
  ["acresGross","Gross site area","sqm",4497,"n"],
  ["_acresNet","Developable site area","sqm",4497,"n"],
  ["buildbua","Total building BUA / GFA","sqm",0,"n"],
  ["pr","Land price excluding GST","A$/sqm",52000000/4497,"n"],
  ["_land","Land consideration excluding GST","A$",null,"c",d=>d.acresGross*d.pr],
  ["_densG","Density on gross site area","units/ha",null,"c",d=>d.acresGross>0?sumProducts(d,p=>d[`n${p}`])/(d.acresGross/10000):0],
  ["_dens","Density on developable site area","units/ha",null,"c",d=>d._acresNet>0?sumProducts(d,p=>d[`n${p}`])/(d._acresNet/10000):0]]},
 {g:"Lot / unit mix and pricing",f:[
  ["pmode","Sales price basis (fixed internally to area x A$/sqm)","flag",1,"n"],
  ["nprod","Number of product types","no.",2,"n"],
  ["n1","Product 1 — lots / units","no.",564,"n"],
  ["w1","Product 1 — saleable area per lot / unit","sqm",56066/564,"n"],
  ["d1","Product 1 — internal area factor","factor",1,"n"],
  ["p1","Product 1 — selling price including GST","A$/sqm",20850,"n"],
  ["n2","Product 2 — lots / units","no.",1,"n"],
  ["w2","Product 2 — saleable area per lot / unit","sqm",3977,"n"],
  ["d2","Product 2 — internal area factor","factor",1,"n"],
  ["p2","Product 2 — selling price including GST","A$/sqm",20850,"n"],
  ["n3","Product 3 — lots / units","no.",0,"n"],
  ["w3","Product 3 — saleable area per lot / unit","sqm",0,"n"],
  ["d3","Product 3 — internal area factor","factor",1,"n"],
  ["p3","Product 3 — selling price including GST","A$/sqm",0,"n"],
  ["pidx","Price index on all products","% current price",100,"p"],
  ["_lots","Total lots / units","no.",null,"c",d=>sumProducts(d,p=>d[`n${p}`])],
  ["_frontft","Total saleable area","sqm",null,"c",d=>sumProducts(d,p=>d[`n${p}`]*d[`w${p}`])],
  ["_lotsqft","Total saleable area","sqm",null,"c",d=>sumProducts(d,p=>d[`n${p}`]*d[`w${p}`])],
  ["_rev0","Gross sales value including GST at today's pricing","A$",null,"c",d=>sumProducts(d,p=>d[`n${p}`]*d[`w${p}`]*d[`p${p}`])*d.pidx/100],
  ["_avgp","Average gross sale value","A$/unit",null,"c",d=>d._lots>0?d._rev0/d._lots:0]]},
 {g:"Programme",f:[
  ["startMonth","Model start month","1-12",7,"n"],
  ["startYear","Model start year","yyyy",2024,"n"],
  ["fyEnd","Financial year end month","1-12",6,"n"],
  ["ddur","Due diligence spend period","mth",12,"n"],
  ["ddend","Due diligence completes","mth",12,"n"],
  ["landdepmonth","Land deposit payment","mth",0,"n"],
  ["close","Land settlement / balance payment","mth",30,"n"],
  ["firbmonth","FIRB fee payment","mth",12,"n"],
  ["entdur","Planning and approval duration after DD","mth",20,"n"],
  ["_ent","Planning / approval complete","mth",null,"c",d=>d.ddend+d.entdur],
  ["nph","Construction phases","no.",2,"n"],
  ["phm","Default phase duration","mth",53,"n"],
  ["ph1dur","Phase 1 duration","mth",45,"n"],
  ["ph2dur","Phase 2 duration","mth",53,"n"],
  ["ph3dur","Phase 3 duration","mth",12,"n"],
  ["ph4dur","Phase 4 duration","mth",12,"n"],
  ["ph5dur","Phase 5 duration","mth",12,"n"],
  ["ph6dur","Phase 6 duration","mth",12,"n"],
  ["_cstart","Construction starts","mth",null,"c",d=>Math.max(d.ddend+d.entdur,d.close)]]},
 {g:"Land acquisition cost",f:[
  ["landgst","GST on land","% land ex GST",10,"p"],
  ["landdepo","Land deposit percentage (used when manual amount is 0)","% land ex GST",10,"p"],
  ["landdeposit","Manual land deposit amount (0 = use deposit %)","A$",0,"n"],
  ["_landdepositamt","Effective land deposit amount","A$",null,"c",d=>landDepositAmount(d)],
  ["landpaycount","Number of interim land payments","no.",0,"n"],
  ["landpay1","Interim payment 1 amount","A$",0,"n"],
  ["landpay1month","Interim payment 1 month","mth",0,"n"],
  ["landpay2","Interim payment 2 amount","A$",0,"n"],
  ["landpay2month","Interim payment 2 month","mth",0,"n"],
  ["landpay3","Interim payment 3 amount","A$",0,"n"],
  ["landpay3month","Interim payment 3 month","mth",0,"n"],
  ["landpay4","Interim payment 4 amount","A$",0,"n"],
  ["landpay4month","Interim payment 4 month","mth",0,"n"],
  ["landpay5","Interim payment 5 amount","A$",0,"n"],
  ["landpay5month","Interim payment 5 month","mth",0,"n"],
  ["_landpresettlementamt","Total paid before settlement","A$",null,"c",d=>landDepositAmount(d)+landInterimTotal(d)],
  ["_landbalanceamt","Final settlement balance","A$",null,"c",d=>Math.max(0,d.acresGross*d.pr*(1+d.landgst/100)-landDepositAmount(d)-landInterimTotal(d))],
  ["stampmode","Stamp duty basis","flag",1,"n"],
  ["stampfixed","Stamp / transfer duty — fixed input","A$",3267578,"n"],
  ["stamprt","Stamp / transfer duty rate","% selected land-duty base",0,"p"],
  ["foreignsurcharge","Foreign purchaser duty surcharge","% selected land-duty base",8,"p"],
  ["firbfee","FIRB application fee","A$",1205200,"n"],
  ["acquisitionfee","Acquisition fee","A$",0,"n"],
  ["otheracq","Other miscellaneous acquisition costs","A$",0,"n"],
  ["ddpc","Due diligence and studies","% land ex GST",0,"p"],
  ["_ddamt","Due diligence amount","A$",null,"c",d=>d.ddpc/100*d.acresGross*d.pr],
  ["landcurve","Land payment profile","profile",0,"n"],
  ["landdur","Land payment duration","mth",1,"n"],
  ["closingpc","Legacy closing-cost percentage","% land ex GST",0,"p"],
  ["rollback","Legacy rollback / acquisition cost","A$",0,"n"],
  ["otherdirect","Other direct / project-processing cost","A$",0,"n"],
  ["allocbasis","Shared-cost allocation basis","flag",1,"n"]]},
 {g:"Construction cost",f:[
  ["buildpsf","Construction cost per BUA","A$/sqm BUA",6314,"n"],
  ["infl","Construction cost per lot / unit","A$/lot",695082064/565,"n"],
  ["_infra","Construction cost total","A$",null,"c",d=>baseConstructionTotal(d)],
  ["contpc","Project contingency","% COC",0,"p"],
  ["contfixed","Additional fixed contingency","A$",0,"n"],
  ["_cont","Project contingency amount","A$",null,"c",d=>actualContingencyTotal(d)],
  ["infesc","Construction cost escalation","% p.a. COC",0,"p"],
  ["infracurve","Horizontal construction spend profile","profile",1,"n"],
  ["buildcurve","Vertical construction spend profile","profile",1,"n"]]},
 {g:"Soft cost",f:[
  ["softmode","Soft cost input method","basis",0,"n"],
  ["sfpc","Professional fees — combined","% COC",4,"p"],
  ["dmpc","Development management fees — combined","% COC",3,"p"],
  ["sfengpc","Engineering","% COC",2,"p"],
  ["sfarchpc","Architecture / design","% COC",1,"p"],
  ["sfplanpc","Planning / approvals","% COC",0.5,"p"],
  ["sfcostpc","Cost consultant / QS","% COC",0.5,"p"],
  ["sflegalpc","Legal / commercial consultants","% COC",0,"p"],
  ["sfdmpc","Development management","% COC",3,"p"],
  ["sfotherpc","Other soft cost","% COC",0,"p"],
  ["_profpc","Professional soft-cost rate","% COC",null,"c",d=>d.softmode===1?d.sfengpc+d.sfarchpc+d.sfplanpc+d.sfcostpc+d.sflegalpc+d.sfotherpc:d.sfpc],
  ["_dmpc","Development-management rate","% COC",null,"c",d=>d.softmode===1?d.sfdmpc:d.dmpc],
  ["_softpc","Total soft-cost rate","% COC",null,"c",d=>d._profpc+d._dmpc],
  ["_prof","Professional fees amount","A$",null,"c",d=>d._profpc/100*baseConstructionTotal(d)],
  ["_dm","Development management fee amount","A$",null,"c",d=>d._dmpc/100*baseConstructionTotal(d)],
  ["_soft","Total soft cost","A$",null,"c",d=>d._softpc/100*baseConstructionTotal(d)]]},
 {g:"Statutory costs",f:[
  ["infrastructurecharge","Council infrastructure charges","A$",16206558,"n"],
  ["dafees","Development application fees","A$",285571,"n"],
  ["certifierfees","Building approval / certifier fees","A$",164429,"n"],
  ["referralfees","Council referral / assessment fees","A$",50000,"n"],
  ["qleave","QLeave levy","A$",4085606,"n"],
  ["munic","Total statutory costs","A$",null,"c",d=>d.infrastructurecharge+d.dafees+d.certifierfees+d.referralfees+d.qleave],
  ["impact","Legacy impact fee","A$/unit",0,"n"]]},
 {g:"Phase programme and mix",f:[
  ["ph1share","Phase 1 lot / unit allocation","% total units",60,"p"],["ph1cost","Phase 1 construction cost share","% total COC",60,"p"],["ph1start","Phase 1 start offset (-1 = automatic)","mth",0,"n"],["ph1saleslag","Phase 1 sales launch after start / completion","mth",0,"n"],["ph1vel","Phase 1 sales velocity (0 = global)","units/m",0,"n"],["ph1esc","Phase 1 price escalation","% p.a. sale price",0,"p"],["ph1escovr","Phase 1 price escalation override enabled","flag",0,"n"],["ph1depo","Phase 1 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph1dellag","Phase 1 settlement lag (-1 = global)","mth",-1,"n"],
  ["ph2share","Phase 2 lot / unit allocation","% total units",40,"p"],["ph2cost","Phase 2 construction cost share","% total COC",40,"p"],["ph2start","Phase 2 start offset (-1 = automatic)","mth",0,"n"],["ph2saleslag","Phase 2 sales launch after start / completion","mth",0,"n"],["ph2vel","Phase 2 sales velocity (0 = global)","units/m",0,"n"],["ph2esc","Phase 2 price escalation","% p.a. sale price",0,"p"],["ph2escovr","Phase 2 price escalation override enabled","flag",0,"n"],["ph2depo","Phase 2 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph2dellag","Phase 2 settlement lag (-1 = global)","mth",-1,"n"],
  ["ph3share","Phase 3 lot / unit allocation","% total units",0,"p"],["ph3cost","Phase 3 construction cost share","% total COC",0,"p"],["ph3start","Phase 3 start offset (-1 = automatic)","mth",-1,"n"],["ph3saleslag","Phase 3 sales launch after start / completion","mth",0,"n"],["ph3vel","Phase 3 sales velocity (0 = global)","units/m",0,"n"],["ph3esc","Phase 3 price escalation","% p.a. sale price",0,"p"],["ph3escovr","Phase 3 price escalation override enabled","flag",0,"n"],["ph3depo","Phase 3 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph3dellag","Phase 3 settlement lag (-1 = global)","mth",-1,"n"],
  ["ph4share","Phase 4 lot / unit allocation","% total units",0,"p"],["ph4cost","Phase 4 construction cost share","% total COC",0,"p"],["ph4start","Phase 4 start offset (-1 = automatic)","mth",-1,"n"],["ph4saleslag","Phase 4 sales launch after start / completion","mth",0,"n"],["ph4vel","Phase 4 sales velocity (0 = global)","units/m",0,"n"],["ph4esc","Phase 4 price escalation","% p.a. sale price",0,"p"],["ph4escovr","Phase 4 price escalation override enabled","flag",0,"n"],["ph4depo","Phase 4 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph4dellag","Phase 4 settlement lag (-1 = global)","mth",-1,"n"],
  ["ph5share","Phase 5 lot / unit allocation","% total units",0,"p"],["ph5cost","Phase 5 construction cost share","% total COC",0,"p"],["ph5start","Phase 5 start offset (-1 = automatic)","mth",-1,"n"],["ph5saleslag","Phase 5 sales launch after start / completion","mth",0,"n"],["ph5vel","Phase 5 sales velocity (0 = global)","units/m",0,"n"],["ph5esc","Phase 5 price escalation","% p.a. sale price",0,"p"],["ph5escovr","Phase 5 price escalation override enabled","flag",0,"n"],["ph5depo","Phase 5 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph5dellag","Phase 5 settlement lag (-1 = global)","mth",-1,"n"],
  ["ph6share","Phase 6 lot / unit allocation","% total units",0,"p"],["ph6cost","Phase 6 construction cost share","% total COC",0,"p"],["ph6start","Phase 6 start offset (-1 = automatic)","mth",-1,"n"],["ph6saleslag","Phase 6 sales launch after start / completion","mth",0,"n"],["ph6vel","Phase 6 sales velocity (0 = global)","units/m",0,"n"],["ph6esc","Phase 6 price escalation","% p.a. sale price",0,"p"],["ph6escovr","Phase 6 price escalation override enabled","flag",0,"n"],["ph6depo","Phase 6 purchaser deposit (-1 = global)","% sale price",-1,"n"],["ph6dellag","Phase 6 settlement lag (-1 = global)","mth",-1,"n"]]},
 {g:"Phase-by-product unit matrix (optional)",f:[
  ["ph1p1","Phase 1 — Product 1 units","no.",339,"n"],["ph1p2","Phase 1 — Product 2 units","no.",0,"n"],["ph1p3","Phase 1 — Product 3 units","no.",0,"n"],
  ["ph2p1","Phase 2 — Product 1 units","no.",225,"n"],["ph2p2","Phase 2 — Product 2 units","no.",1,"n"],["ph2p3","Phase 2 — Product 3 units","no.",0,"n"],
  ["ph3p1","Phase 3 — Product 1 units","no.",0,"n"],["ph3p2","Phase 3 — Product 2 units","no.",0,"n"],["ph3p3","Phase 3 — Product 3 units","no.",0,"n"],
  ["ph4p1","Phase 4 — Product 1 units","no.",0,"n"],["ph4p2","Phase 4 — Product 2 units","no.",0,"n"],["ph4p3","Phase 4 — Product 3 units","no.",0,"n"],
  ["ph5p1","Phase 5 — Product 1 units","no.",0,"n"],["ph5p2","Phase 5 — Product 2 units","no.",0,"n"],["ph5p3","Phase 5 — Product 3 units","no.",0,"n"],
  ["ph6p1","Phase 6 — Product 1 units","no.",0,"n"],["ph6p2","Phase 6 — Product 2 units","no.",0,"n"],["ph6p3","Phase 6 — Product 3 units","no.",0,"n"]]},
 {g:"Land holding costs",f:[
  ["landtax","Land tax","A$/year",792500,"n"],
  ["foreignlandtax","Foreign-owner land-tax surcharge","A$/year",949500,"n"],
  ["councilrates","Council rates and holding charges","A$/year",477800,"n"],
  ["holdingfixed","Reference total land holding cost (0 = calculate from annual inputs)","A$",0,"n"],
  ["ptax","Legacy property-tax rate","% p.a. assessed value",0,"p"],
  ["passess","Legacy assessed-value basis","% land value",100,"p"],
  ["assess","Legacy district assessment","A$/unit pa",0,"n"],
  ["hoa","Legacy HOA subsidy","A$ pa",0,"n"],
  ["hoastart","Legacy HOA start","flag",1,"n"],
  ["insur","Construction / builder-risk insurance","% p.a. construction WIP",0,"p"]]},
 {g:"P&L cost and overhead inputs",f:[
  ["comm","Brokerage and incentive","% gross sales",1.5,"p"],
  ["sellingpc","Selling / settlement expenses","% gross sales",1.5,"p"],
  ["commbookpc","Brokerage and selling cost paid at booking","% total selling cost",100,"p"],
  ["gnapc","General & administrative expenses","% net revenue",0,"p"],
  ["gnasharedpc","Shared-service G&A allocation","% net revenue",0,"p"],
  ["staffpc","Staff / manpower expenses","% net revenue",0,"p"],
  ["staffsharedpc","Shared-service staff / manpower allocation","% net revenue",0,"p"],
  ["corp","Corporate overhead allocation","% net revenue",0,"p"],
  ["gnafixed","General & administrative expenses — fixed monthly","A$/mth",0,"n"],
  ["gnasharedfixed","Shared-service G&A — fixed monthly","A$/mth",0,"n"],
  ["stafffixed","Staff / manpower — fixed monthly","A$/mth",0,"n"],
  ["staffsharedfixed","Shared-service manpower — fixed monthly","A$/mth",0,"n"],
  ["corpfixed","Corporate overhead — fixed monthly","A$/mth",0,"n"],
  ["marketingpc","Marketing and advertising","% net revenue",0.5,"p"],
  ["dacapex","Depreciable fixed-asset capex","A$",0,"n"],
  ["dalife","D&A useful life","years",10,"n"],
  ["dastart","D&A asset in-service month","mth",0,"n"],
  ["otherincpc","Development fees / other income linked to revenue","% net revenue",0,"p"],
  ["otherinc","Other income — fixed amount","A$",0,"n"],
  ["otherincmonth","Fixed other-income recognition month","mth",32,"n"],
  ["_ovhpc","Total percentage overhead cost","% net revenue",null,"c",d=>d.gnapc+d.gnasharedpc+d.staffpc+d.staffsharedpc+d.corp]]},
 {g:"GST",f:[
  ["gstmode","Output GST treatment","flag",0,"n"],
  ["costgstbasis","Development / selling cost GST basis","flag",1,"n"],
  ["gst","Output GST rate","% taxable sales / margin",10,"p"],
  ["gstmarginbase","Margin-scheme acquisition basis (0 = land consideration paid)","A$",0,"n"],
  ["outputgstfixed","Reference total output GST (0 = calculate from treatment)","A$",0,"n"],
  ["inputgst","Recoverable input GST rate","% eligible GST-bearing costs",10,"p"],
  ["gstcreditfixed","Reference total input GST credit (0 = calculate from eligible costs)","A$",0,"n"],
  ["gstlag","GST refund lag","mth",1,"n"]]},
 {g:"Council / infrastructure reimbursement (optional)",f:[
  ["pidel","Eligible share of construction cost","% COC",0,"p"],
  ["pidrt","Reimbursement / credit rate","% eligible COC",0,"p"],
  ["pidcost","Reimbursement formation / processing cost","A$",0,"n"],
  ["pidlag","Receipt lag after phase completion","mth",0,"n"],
  ["_pid","Total council / infrastructure reimbursement","A$",null,"c",d=>actualReimbursementTotal(d)]]},
 {g:"Sales and receipts",f:[
  ["absn","Sales velocity","units/m",12,"n"],
  ["_sellmo","Months to contract all lots / units","mth",null,"c",d=>{const v=d.vert?d.vel:d.absn;return v>0?Math.ceil(sumProducts(d,p=>d[`n${p}`])/v):0}],
  ["esc","Price escalation","% p.a. sale price",0,"p"],
  ["depo","Deposit on contract","% sale price",10,"p"],
  ["escrow","Deposit held until settlement","flag",1,"n"],
  ["presales","Allow pre-sales before phase completion","flag",1,"n"],
  ["_bal","Balance on settlement","% sale price",null,"c",d=>100-d.depo],
  ["dellag","Contract to settlement","mth",0,"n"]]},
 {g:"Vertical development",f:[
  ["vert","Vertical development enabled","flag",0,"n"],
  ["bua1","Product 1 — unit saleable area","sqm",100,"n"],
  ["bua2","Product 2 — unit saleable area","sqm",120,"n"],
  ["bua3","Product 3 — unit saleable area","sqm",150,"n"],
  ["_buaTot","Total unit saleable area","sqm",null,"c",d=>sumProducts(d,p=>d[`n${p}`]*d[`bua${p}`])],
  ["_far","Saleable-area ratio on site","x",null,"c",d=>d.acresGross>0?sumProducts(d,p=>d[`n${p}`]*d[`bua${p}`])/d.acresGross:0],
  ["buildpsf_legacy","Legacy vertical construction rate (unused)","A$/sqm",0,"n"],
  ["buildpsf1","Product 1 — construction cost","A$/sqm",0,"n"],["buildpsf1ovr","Product 1 — use cost override","flag",0,"n"],
  ["buildpsf2","Product 2 — construction cost","A$/sqm",0,"n"],["buildpsf2ovr","Product 2 — use cost override","flag",0,"n"],
  ["buildpsf3","Product 3 — construction cost","A$/sqm",0,"n"],["buildpsf3ovr","Product 3 — use cost override","flag",0,"n"],
  ["buildesc","Vertical construction cost escalation","% p.a. COC",0,"p"],
  ["_buildTot","Vertical construction cost total","A$",null,"c",d=>baseConstructionTotal(d)],
  ["dsgnpc","Legacy vertical professional-fee rate (unused)","% COC",0,"p"],
  ["designbase","Professional-fee base","flag",1,"n"],
  ["permpc","Vertical permits / statutory costs","% COC",0,"p"],
  ["permitbase","Permit-fee base","flag",1,"n"],
  ["hpsf","Default vertical sale price including GST","A$/sqm",20850,"n"],
  ["hpsf1","Product 1 — vertical sale price","A$/sqm",0,"n"],["hpsf1ovr","Product 1 — use sale-price override","flag",0,"n"],
  ["hpsf2","Product 2 — vertical sale price","A$/sqm",0,"n"],["hpsf2ovr","Product 2 — use sale-price override","flag",0,"n"],
  ["hpsf3","Product 3 — vertical sale price","A$/sqm",0,"n"],["hpsf3ovr","Product 3 — use sale-price override","flag",0,"n"],
  ["_homeRev","Current-price vertical GDV including GST","A$",null,"c",d=>sumProducts(d,p=>d[`n${p}`]*d[`bua${p}`]*(d[`hpsf${p}ovr`]?d[`hpsf${p}`]:d.hpsf))],
  ["vlag","Vertical sales / unit programme starts after phase completion","mth",0,"n"],
  ["modelmo","Display / sales-centre period","mth",0,"n"],
  ["modelcost","Display / sales-centre cost","A$",0,"n"],
  ["modelphase","Display / sales-centre phase","flag",0,"n"],
  ["vel","Global vertical unit sales velocity","units/m",5,"n"],
  ["vel1","Product 1 sales velocity","units/m",0,"n"],
  ["vel2","Product 2 sales velocity","units/m",0,"n"],
  ["vel3","Product 3 sales velocity","units/m",0,"n"],
  ["buildmo","Default vertical unit build / settlement duration","mth",6,"n"],
  ["buildmo1","Product 1 — build duration","mth",0,"n"],["buildmo1ovr","Product 1 — use build-duration override","flag",0,"n"],
  ["buildmo2","Product 2 — build duration","mth",0,"n"],["buildmo2ovr","Product 2 — use build-duration override","flag",0,"n"],
  ["buildmo3","Product 3 — build duration","mth",0,"n"],["buildmo3ovr","Product 3 — use build-duration override","flag",0,"n"],
  ["_vmonths","Vertical programme","mth",null,"c",d=>{const ph=_phaseConfig(d,sumProducts(d,p=>d[`n${p}`])),mx=Math.max(...ph.counts.map((c,i)=>Math.ceil(c/Math.max(ph.velocities[i]||d.vel,.01)))),bd=Math.max(d.buildmo,...productIds(d).map(p=>d[`buildmo${p}ovr`]?d[`buildmo${p}`]:0));return d.modelmo+mx+bd}]]},
 {g:"Debt",f:[
  ["ltc","Facility limit","% eligible dev cost",64,"p"],
  ["facmode","Facility sizing basis","flag",1,"n"],
  ["facilityfixed","Fixed operating facility amount","A$",566162365,"n"],
  ["fundingmode","Funding sequence","flag",1,"n"],
  ["equitypc","Equity-first contribution","% eligible development cost",20,"p"],
  ["equityfixed","Fixed equity-first amount (0 = use percentage)","A$",180508845,"n"],
  ["finland","Land financed by the facility","flag",1,"n"],
  ["findd","Due diligence and professional fees financed","flag",1,"n"],
  ["fincapex","Depreciable capex financed","flag",0,"n"],
  ["finhoriz","Construction and statutory costs financed","flag",1,"n"],
  ["finvert","Vertical construction financed","flag",1,"n"],
  ["rate","All-in interest rate","% p.a. debt balance",5.5,"p"],
  ["facstart","Facility commitment month (-1 = automatic)","mth",43,"n"],
  ["procf","Processing / establishment fee","% operating facility commitment",1.25,"p"],
  ["linef","Unused line fee","% p.a. undrawn limit",1.5,"p"],
  ["financefixed","Reference finance-cost budget (does not override dynamic model)","A$",0,"n"],
  ["relpc","Lot / unit release price","x pro-rata",1.10,"n"],
  ["relmode","Debt release basis","flag",1,"n"],
  ["relsalespc","Release share of sale proceeds","% sale proceeds",100,"p"],
  ["relfixed1","Product 1 fixed release","A$/unit",0,"n"],
  ["relfixed2","Product 2 fixed release","A$/unit",0,"n"],
  ["relfixed3","Product 3 fixed release","A$/unit",0,"n"],
  ["revolver","Facility redraw permitted","flag",1,"n"],
  ["cashfungible","Debt may fund from cumulative eligible base","flag",0,"n"],
  ["equityreimb","Allow debt to reimburse prior equity","flag",0,"n"],
  ["fundi","Debt funds interest and facility fees","flag",1,"n"],
  ["pidrep","Reimbursement repays loan","flag",0,"n"],
  ["mincash","Minimum unrestricted project cash","A$",0,"n"],
  ["intres","Finance-cost reserve (0 = auto-size)","A$",0,"n"],
  ["intresout","Interest reserve outside LTC cap","flag",1,"n"],
  ["intconv","Interest basis","flag",1,"n"],
  ["distlock","Lender cash trap until debt is repaid","flag",0,"n"]]},
 {g:"Tax and return",f:[
  ["ftax","Corporate income tax","% profit",0,"p"],
  ["stax","State / franchise tax","% selected tax base",0,"p"],
  ["staxbase","Additional-tax base","flag",1,"n"],
  ["taxloss","Tax-loss treatment","flag",0,"n"],
  ["taxcarrybackyrs","Tax-loss carryback period","years",0,"n"],
  ["taxlossexp","Tax-loss expiry (0 = unlimited)","years",0,"n"],
  ["taxlossutil","Maximum annual loss utilisation","% taxable profit",100,"p"],
  ["staxdeduct","Additional tax deductible for corporate tax","flag",1,"n"],
  ["taxfreq","Tax payments","flag",0,"n"],
  ["taxqlag","Quarterly estimated-tax payment lag","mth",1,"n"],
  ["capcarry","Qualifying holding-cost capitalisation","flag",1,"n"],
  ["capfin","Finance-cost capitalisation","flag",1,"n"],
  ["pidacct","Reimbursement accounting treatment","flag",1,"n"],
  ["ovhmode","Overhead timing","flag",2,"n"],
  ["taxlag","Annual tax true-up lag after financial year end","mth",3,"n"],
  ["r","Cost of capital","% p.a. project cash flow",10,"p"],
  ["hurdle","Target equity IRR","% p.a. equity cash flow",20,"p"],
  ["tmoic","Target equity multiple","x",2.0,"n"]]}];

// Extend the flat storage schema to the selected product count while keeping legacy parcel files compatible.
{
  const lot=GROUPS.find(x=>x.g==="Lot / unit mix and pricing"), vertical=GROUPS.find(x=>x.g==="Vertical development"), matrix=GROUPS.find(x=>x.g==="Phase-by-product unit matrix (optional)"), debt=GROUPS.find(x=>x.g==="Debt");
  for(let p=4;p<=MAX_PRODUCTS;p++){
    const at=lot.f.findIndex(x=>x[0]==="pidx");lot.f.splice(at,0,[`n${p}`,`Product ${p} — lots / units`,"no.",0,"n"],[`w${p}`,`Product ${p} — saleable area per lot / unit`,"sqm",0,"n"],[`d${p}`,`Product ${p} — internal area factor`,"factor",1,"n"],[`p${p}`,`Product ${p} — selling price including GST`,"A$/sqm",0,"n"]);
    const vat=vertical.f.findIndex(x=>x[0]==="_buaTot");vertical.f.splice(vat,0,[`bua${p}`,`Product ${p} — unit saleable area`,"sqm",0,"n"]);
    const bat=vertical.f.findIndex(x=>x[0]==="buildesc");vertical.f.splice(bat,0,[`buildpsf${p}`,`Product ${p} — construction cost`,"A$/sqm",0,"n"],[`buildpsf${p}ovr`,`Product ${p} — use cost override`,"flag",0,"n"]);
    const hat=vertical.f.findIndex(x=>x[0]==="_homeRev");vertical.f.splice(hat,0,[`hpsf${p}`,`Product ${p} — vertical sale price`,"A$/sqm",0,"n"],[`hpsf${p}ovr`,`Product ${p} — use sale-price override`,"flag",0,"n"]);
    const vat2=vertical.f.findIndex(x=>x[0]==="buildmo");vertical.f.splice(vat2,0,[`vel${p}`,`Product ${p} sales velocity`,"units/m",0,"n"]);
    const end=vertical.f.findIndex(x=>x[0]==="_vmonths");vertical.f.splice(end,0,[`buildmo${p}`,`Product ${p} — vertical build / settlement duration`,"mth",0,"n"],[`buildmo${p}ovr`,`Product ${p} — use build-duration override`,"flag",0,"n"]);
    for(let ph=1;ph<=6;ph++)matrix.f.push([`ph${ph}p${p}`,`Phase ${ph} — Product ${p} units`,"no.",0,"n"]);
    const dat=debt.f.findIndex(x=>x[0]==="revolver");debt.f.splice(dat,0,[`relfixed${p}`,`Product ${p} fixed release`,"A$/unit",0,"n"]);
  }
}
/* CLEAN_NO_PROJECT_DEFAULTS: generic project assumptions are neutralised here.
   Only structural values required for a valid model shape remain non-zero; each
   live project must explicitly provide its commercial, cost and funding inputs. */
function neutralDefaultFor(k){
  if(/^d\d+$/.test(k))return 1;
  if(k==="pmode")return 1;
  if(k==="nprod")return 1;
  if(k==="startMonth")return 1;
  if(k==="startYear")return 2026;
  if(k==="fyEnd")return 12;
  if(["ddur","entdur","landdur","phm","buildmo","dalife"].includes(k))return 1;
  if(k==="nph")return 1;
  if(k==="ph1dur")return 1;
  if(/^ph[2-6]dur$/.test(k))return 0;
  if(k==="ph1share"||k==="ph1cost")return 100;
  if(/^ph[2-6](?:share|cost)$/.test(k))return 0;
  if(k==="ph1start")return 0;
  if(/^ph[2-6]start$/.test(k))return -1;
  if(/^ph[1-6](?:depo|dellag)$/.test(k))return -1;
  if(k==="facstart")return -1;
  if(k==="relsalespc"||k==="taxlossutil")return 100;
  return 0;
}
GROUPS.forEach(g=>g.f.forEach(f=>{if(f[4]!=="c")f[3]=neutralDefaultFor(f[0])}));
const DEF={};GROUPS.forEach(g=>g.f.forEach(([k,,,v,t])=>{if(t!=="c")DEF[k]=v}));
/* Hidden Business Plan timing profile. These fields are model inputs so the same
   source-aligned timing works in the main thread and the calculation workers,
   but they are intentionally omitted from the visible input groups. */
DEF._bpTiming=0;
for(let i=1;i<=12;i++){DEF[`_bpYear${i}`]=0;DEF[`_bpWeight${i}`]=0}
const DEF_KEYS=Object.keys(DEF);
function modelInputSignature(source){
  source=source||{};
  return DEF_KEYS.map(k=>Object.prototype.hasOwnProperty.call(source,k)?String(source[k]):"~").join("\u001f");
}
function overrideSignature(overrides){
  if(!overrides)return "";
  const keys=Object.keys(overrides).sort();
  return keys.map(k=>k+":"+String(overrides[k])).join("\u001e");
}
function cacheGetLRU(map,key){
  if(!map.has(key))return undefined;
  const value=map.get(key);map.delete(key);map.set(key,value);return value;
}
function cacheSetLRU(map,key,value,limit){
  if(map.has(key))map.delete(key);map.set(key,value);
  while(map.size>limit)map.delete(map.keys().next().value);
  return value;
}
const _deriveCache=new Map();
function derive(source){
  const key=modelInputSignature(source),hit=cacheGetLRU(_deriveCache,key);
  if(hit!==undefined)return hit;
  return cacheSetLRU(_deriveCache,key,_computeDerived(_normalizedForDerive(source)),64);
}
const ACCOUNTING_POLICY=Object.freeze({capfin:1,capcarry:1,pidacct:1,staxdeduct:1});
const MANDATORY_ACCOUNTING_FIELDS=new Set(Object.keys(ACCOUNTING_POLICY));
function enforceAccountingPolicy(target){Object.assign(target,ACCOUNTING_POLICY);return target}
function cleanStoredInputs(source){
  const out={};source=source||{};
  Object.keys(DEF).forEach(k=>{if(Object.prototype.hasOwnProperty.call(source,k))out[k]=source[k]});
  if(!Object.prototype.hasOwnProperty.call(source,"_acresNet")){
    const gross=_num(source.acresGross,DEF.acresGross),ded=_num(source.acresDed,0);
    out._acresNet=Math.max(0,gross-ded);
  }
  return enforceAccountingPolicy(out)
}
/* Fields that never feed the appraisal, and fields that only bite once something else is set.
   Established by perturbing every input and watching sixteen outputs. */
const REFONLY={startYear:"Shifts the calendar labels and financial year numbering. The economics are unchanged.",
  hurdle:"Sets the pass mark for the verdict, the gauge bands and the scenario chips. Not a cost.",
  tmoic:"Displayed as a target beside the achieved multiple. Not a cost.",
  tprofit:"Used as a preset in the optimiser. Not a cost.",
  financefixed:"Reference / benchmarking field only. The appraisal always calculates finance costs dynamically from the debt schedule."};
const CONDITIONAL={passess:["ptax","no effect while the property tax rate is nil"],
  d1:["pmode","depth drives revenue only when the price basis is per square foot"],
  d2:["pmode","depth drives revenue only when the price basis is per square foot"],
  d3:["pmode","depth drives revenue only when the price basis is per square foot"]};
/* Which input groups and levers each business actually uses. Anything the chosen
   business cannot touch is hidden rather than left on screen doing nothing. */
const LOT_ONLY_GROUPS=[];
const VERT_ONLY_GROUPS=["Vertical development"];
/* lot sale pricing drives nothing once units are being sold, and the reverse */
const LOT_ONLY_FIELDS=["pmode"];
const LOT_ONLY_LEVERS=["absn","dellag","vff","vpsf"];
const VERT_ONLY_LEVERS=["hpsf","buildpsf","vel","buildmo","modelmo","permpc","vlag"];
const VERT_ONLY_FIELDS=["vert","bua1","bua2","bua3","_buaTot","_far","_buildTot",
  "permpc","hpsf","hpsf1","hpsf2","hpsf3","_homeRev","vlag","modelmo","modelcost","vel","buildmo","buildmo1","buildmo2","buildmo3","_vmonths"];
function groupShown(g,vert){
  if(VERT_ONLY_GROUPS.includes(g))return true;
  return true}
const SIMPLE_DEBT_FIELDS=new Set(["ltc","facmode","facilityfixed","fundingmode","equitypc","equityfixed","finland","rate","facstart","procf","linef","relpc","fundi","pidrep"]);
const SIMPLE_TAX_FIELDS=new Set(["ftax","stax","r","hurdle","tmoic"]);
const SIMPLE_SALES_FIELDS=new Set(["absn","vel","_sellmo","esc","depo","escrow","_bal","dellag"]);
const DEBT_ALL_FIELDS=new Set((GROUPS.find(g=>g.g==="Debt")||{f:[]}).f.map(f=>f[0]));
const TAX_ALL_FIELDS=new Set((GROUPS.find(g=>g.g==="Tax and return")||{f:[]}).f.map(f=>f[0]));
const SALES_ALL_FIELDS=new Set((GROUPS.find(g=>g.g==="Sales and receipts")||{f:[]}).f.map(f=>f[0]));
function fieldShown(k,vert){
  const hidden=new Set(["pmode","closingpc","rollback","impact","ptax","passess","assess","hoa","hoastart","buildpsf_legacy","dsgnpc","designbase","buildesc","_buildTot"]);
  if(hidden.has(k))return false;
  if(DEBT_ALL_FIELDS.has(k)&&!SIMPLE_DEBT_FIELDS.has(k))return false;
  if(TAX_ALL_FIELDS.has(k)&&!SIMPLE_TAX_FIELDS.has(k))return false;
  if(SALES_ALL_FIELDS.has(k)&&!SIMPLE_SALES_FIELDS.has(k))return false;
  if(vert&&k==="dellag")return false;
  /* Development mode is controlled once, at the top of the rail. */
  if(k==="vert")return false;
  if(k==="landcurve"||k==="landdur")return false;
  const landPayMatch=String(k).match(/^landpay([1-5])(?:month)?$/);if(landPayMatch&&Number(landPayMatch[1])>_clamp(Math.round(_num(D.landpaycount,0)),0,MAX_LAND_INTERIM_PAYMENTS))return false;
  if(k==="facilityfixed"&&Math.round(_num(D.facmode,0))!==1)return false;
  if(k==="gstmarginbase"&&Math.round(_num(D.gstmode,0))!==1)return false;
  /* Deposit and settlement controls are always the land payment structure. */
  if((k==="sfpc"||k==="dmpc")&&Math.round(_num(D.softmode,0))===1)return false;
  if(["sfengpc","sfarchpc","sfplanpc","sfcostpc","sflegalpc","sfdmpc","sfotherpc"].includes(k)&&Math.round(_num(D.softmode,0))!==1)return false;
  if(k==="infracurve"&&vert)return false;
  if(k==="buildcurve"&&!vert)return false;
  if(k==="phm"||k==="fixedovh")return false;
  if(/^nprod$/.test(k))return true;
  const prodMatch=String(k).match(/^(?:n|w|d|p|bua|hpsf|buildpsf|vel|buildmo|relfixed)(\d+)(?:ovr)?$/);if(prodMatch&&Number(prodMatch[1])>productCount(D))return false;
  const matrixMatch=String(k).match(/^ph[1-6]p(\d+)$/);if(matrixMatch&&Number(matrixMatch[1])>productCount(D))return false;
  const pm=String(k).match(/^ph([1-6])/);if(pm&&Number(pm[1])>Math.max(1,Math.round(_num(D.nph,1))))return false;
  if(vert&&/^p\d+$|^w\d+$/.test(k))return false;
  if(vert&&k==="infl")return false;
  if(!vert&&(k==="buildbua"||k==="buildpsf"))return false;
  if(vert&&k==="absn")return false;
  if(/^buildpsf\d+(?:ovr)?$/.test(k))return false;
  if(k==="gst"&&_num(D.outputgstfixed)>0)return false;
  if(k==="outputgstfixed"&&!(_num(D.outputgstfixed)>0))return false;
  if(k==="inputgst"&&_num(D.gstcreditfixed)>0)return false;
  if(k==="gstcreditfixed"&&!(_num(D.gstcreditfixed)>0))return false;
  if(!vert&&VERT_ONLY_FIELDS.includes(k)&&k!=="vert")return false;
  return true

}
function fyOf(m,d){const i=(d.startMonth-1)+m,y=d.startYear+Math.floor(i/12),c=i%12+1;
  return y+(c>d.fyEnd?1:0)}
function irrInfo(values, periodsPerYear = 12) {
  const cashflows = values.map(Number);

  if (!cashflows.some(v => v < 0) || !cashflows.some(v => v > 0)) {
    return { value: null, roots: [] };
  }

  const npvAtLogRate = logRate =>
    cashflows.reduce(
      (total, cashflow, period) =>
        total + cashflow * Math.exp(-logRate * period / periodsPerYear),
      0
    );

  const minimumLogRate = Math.log(0.0001);
  const maximumLogRate = Math.log(1001);
  const scanSteps = 600;
  const roots = [];

  let previousX = minimumLogRate;
  let previousValue = npvAtLogRate(previousX);

  for (let i = 1; i <= scanSteps; i++) {
    const currentX =
      minimumLogRate +
      (maximumLogRate - minimumLogRate) * i / scanSteps;

    const currentValue = npvAtLogRate(currentX);

    if (
      Number.isFinite(previousValue) &&
      Number.isFinite(currentValue) &&
      previousValue * currentValue <= 0
    ) {
      let low = previousX;
      let high = currentX;
      let lowValue = previousValue;

      for (let iteration = 0; iteration < 80; iteration++) {
        const middle = (low + high) / 2;
        const middleValue = npvAtLogRate(middle);

        if (lowValue * middleValue <= 0) {
          high = middle;
        } else {
          low = middle;
          lowValue = middleValue;
        }
      }

      const annualRate = Math.exp((low + high) / 2) - 1;

      if (!roots.some(root => Math.abs(root - annualRate) < 1e-7)) {
        roots.push(annualRate);
      }
    }

    previousX = currentX;
    previousValue = currentValue;
  }

  return {
    value: roots.length === 1 ? roots[0] : null,
    roots
  };
}

function irr(values, periodsPerYear = 12) {
  return irrInfo(values, periodsPerYear).value;
}

const SIMPLE_BACKUP_POLICY={
  findd:1, fincapex:0, finhoriz:1, finvert:1,
  relmode:0, relsalespc:100, revolver:1,
  cashfungible:0, equityreimb:0, mincash:0, intres:0, intresout:1,
  intconv:1, distlock:0,
  staxbase:1, taxloss:0, taxcarrybackyrs:0, taxlossexp:0, taxlossutil:100,
  staxdeduct:1, taxfreq:0, taxqlag:1, capcarry:1, capfin:1, pidacct:1,
  taxlag:3, presales:1
};
function _runUncached(din,ov){
  const raw=enforceAccountingPolicy({...DEF,...cleanStoredInputs(din),...(ov||{})});
  Object.assign(raw,SIMPLE_BACKUP_POLICY);
  // The accounting-policy fields are fixed centrally and cannot be overridden by scenarios or saved files.
  enforceAccountingPolicy(raw);
  Object.keys(DEF).forEach(k=>{if(!Number.isFinite(Number(raw[k])))throw new Error(`${k} must be a finite number.`)});
  const requireInteger=(k,min,max)=>{const v=Number(raw[k]);if(!Number.isInteger(v)||v<min||(max!=null&&v>max))throw new Error(`${k} must be a whole number between ${min} and ${max==null?"the permitted maximum":max}.`)};
  requireInteger("startMonth",1,12);requireInteger("startYear",1900,9999);requireInteger("fyEnd",1,12);requireInteger("nprod",1,MAX_PRODUCTS);
  [["ddur",1,null],["ddend",0,null],["landdepmonth",0,null],["firbmonth",0,null],["gstlag",0,null],["close",0,null],["landpaycount",0,5],["landpay1month",0,null],["landpay2month",0,null],["landpay3month",0,null],["landpay4month",0,null],["landpay5month",0,null],["entdur",1,null],["landdur",1,null],["nph",1,6],["phm",1,null],["dellag",0,null],["pidlag",0,null],["vlag",0,null],["modelmo",0,null],["buildmo",1,null],["taxlag",0,null],["taxqlag",0,null],["otherincmonth",0,null],["taxcarrybackyrs",0,20],["taxlossexp",0,null],["modelphase",0,6]].forEach(x=>requireInteger(...x));
  const binaryFlags=["vert","escrow","stampmode","fundingmode","facmode","finland","findd","finhoriz","finvert","fincapex","fundi","pidrep","intresout","taxloss","capcarry","capfin","pidacct","presales","revolver","cashfungible","equityreimb","designbase","permitbase","staxdeduct","taxfreq","distlock","ph1escovr","ph2escovr","ph3escovr","ph4escovr","ph5escovr","ph6escovr"];
  for(let p=1;p<=MAX_PRODUCTS;p++)binaryFlags.push(`hpsf${p}ovr`,`buildpsf${p}ovr`,`buildmo${p}ovr`);
  binaryFlags.forEach(k=>{if(Number(raw[k])!==0&&Number(raw[k])!==1)throw new Error(`${k} must be entered as 0 or 1.`)});
  [["pmode",0,1],["intconv",0,2],["staxbase",0,2],["allocbasis",0,3],["ovhmode",0,2],["gstmode",0,1],["costgstbasis",0,1],["softmode",0,1],["landcurve",0,5],["infracurve",0,4],["buildcurve",0,4],["relmode",0,2],["hoastart",0,2]].forEach(x=>requireInteger(...x));
  if(!Number.isInteger(Number(raw.facstart))||Number(raw.facstart)<-1)throw new Error("Facility commitment month must be -1 or a non-negative whole month.");
  const nonNegative=["acresGross","_acresNet","pr","pidx","ddpc","landdeposit","landpay1","landpay2","landpay3","landpay4","landpay5","sfpc","dmpc","sfengpc","sfarchpc","sfplanpc","sfcostpc","sflegalpc","sfdmpc","sfotherpc","closingpc","rollback","otherdirect","landgst","landdepo","stampfixed","stamprt","foreignsurcharge","firbfee","acquisitionfee","otheracq","buildbua","infl","contpc","contfixed","infrastructurecharge","dafees","certifierfees","referralfees","qleave","impact","landtax","foreignlandtax","councilrates","holdingfixed","insur","comm","sellingpc","commbookpc","gst","inputgst","gnapc","gnasharedpc","staffpc","staffsharedpc","corp","outputgstfixed","gstcreditfixed","gstmarginbase","gnafixed","gnasharedfixed","stafffixed","staffsharedfixed","corpfixed","marketingpc","dacapex","dalife","dastart","otherincpc","otherinc","otherincmonth","pidel","pidrt","pidcost","absn","depo","buildpsf","dsgnpc","permpc","hpsf","modelcost","vel","ltc","equitypc","equityfixed","facilityfixed","rate","procf","linef","financefixed","relpc","mincash","intres","relsalespc","taxcarrybackyrs","taxlossexp","taxlossutil","ftax","stax","r","hurdle","tmoic"];
  for(let p=1;p<=MAX_PRODUCTS;p++)nonNegative.push(`n${p}`,`w${p}`,`d${p}`,`p${p}`,`bua${p}`,`hpsf${p}`,`buildpsf${p}`,`vel${p}`,`buildmo${p}`,`relfixed${p}`);
  nonNegative.forEach(k=>{if(_num(raw[k])<0)throw new Error(`${k} cannot be negative.`)});
  for(let p=1;p<=productCount(raw);p++)if(!Number.isInteger(_num(raw[`n${p}`])))throw new Error(`Product ${p} unit count must be a whole number.`);
  const boundedPct=["ddpc","sfpc","dmpc","sfengpc","sfarchpc","sfplanpc","sfcostpc","sflegalpc","sfdmpc","sfotherpc","closingpc","contpc","landgst","landdepo","stamprt","foreignsurcharge","insur","comm","sellingpc","commbookpc","gst","inputgst","gnapc","gnasharedpc","staffpc","staffsharedpc","corp","marketingpc","otherincpc","pidel","pidrt","depo","dsgnpc","permpc","ltc","equitypc","procf","linef","relsalespc","taxlossutil","ftax","stax"];
  boundedPct.forEach(k=>{if(_num(raw[k])>100)throw new Error(`${k} cannot exceed 100%.`)});
  ["infesc","esc","buildesc"].forEach(k=>{if(_num(raw[k])<=-100)throw new Error(`${k} must be greater than -100%.`)});
  const requestedVertical=_num(raw.vert,0)>=.5;
  if(!requestedVertical&&!(_num(raw.absn)>0))throw new Error("Sales velocity must be greater than zero in finished-lot mode.");
  if(requestedVertical&&!(_num(raw.vel)>0))throw new Error("Vertical sales velocity must be greater than zero in vertical-development mode.");
  if(_num(raw.facstart,-1)<-1)throw new Error("Facility commitment month cannot be below -1.");
  for(let i=1;i<=6;i++){
    if(_num(raw[`ph${i}start`],-1)<-1)throw new Error(`Phase ${i} start offset cannot be below -1.`);
    if(_num(raw[`ph${i}dur`],0)<0)throw new Error(`Phase ${i} duration cannot be negative.`);
    if(_num(raw[`ph${i}vel`],0)<0)throw new Error(`Phase ${i} sales velocity cannot be negative.`);
    if(_num(raw[`ph${i}share`],0)<0||_num(raw[`ph${i}share`],0)>100)throw new Error(`Phase ${i} lot allocation must be between 0% and 100%.`);
    if(_num(raw[`ph${i}cost`],0)<0||_num(raw[`ph${i}cost`],0)>100)throw new Error(`Phase ${i} construction-cost share must be between 0% and 100%.`);
    if(_num(raw[`ph${i}esc`],0)<=-100)throw new Error(`Phase ${i} price escalation must be greater than -100%.`);
    if(_num(raw[`ph${i}depo`],-1)<-1||_num(raw[`ph${i}depo`],-1)>100)throw new Error(`Phase ${i} deposit must be -1 or between 0% and 100%.`);
    if(_num(raw[`ph${i}dellag`],-1)<-1)throw new Error(`Phase ${i} delivery lag cannot be below -1.`);
    requireInteger(`ph${i}dur`,i<=Number(raw.nph)?1:0,null);
    if(_num(raw[`ph${i}start`],-1)!==-1)requireInteger(`ph${i}start`,0,null);
    requireInteger(`ph${i}saleslag`,0,null);
    if(_num(raw[`ph${i}dellag`],-1)!==-1)requireInteger(`ph${i}dellag`,0,null);
    for(let p=1;p<=productCount(raw);p++)if(!Number.isInteger(_num(raw[`ph${i}p${p}`],0))||_num(raw[`ph${i}p${p}`],0)<0)throw new Error(`Phase ${i} product counts must be non-negative whole numbers.`);
  }
  const d=derive(raw);
  if(d.close<d.ddend)throw new Error("Land settlement cannot occur before due diligence is complete.");
  if(d.landdepmonth>d.close)throw new Error("Land deposit month cannot be after land settlement.");
  const totalLandCash=d.acresGross*d.pr*(1+d.landgst/100),preSettlementLand=landDepositAmount(d)+landInterimTotal(d);
  if(preSettlementLand>totalLandCash+1e-6)throw new Error("Deposit plus interim land payments cannot exceed total GST-inclusive land consideration.");
  let priorLandMonth=d.landdepmonth;
  for(let i=1;i<=d.landpaycount;i++){const amt=d[`landpay${i}`],m=d[`landpay${i}month`];if(!(amt>0))throw new Error(`Interim land payment ${i} amount must be greater than zero.`);if(m<=priorLandMonth)throw new Error(`Interim land payment ${i} month must be after the previous land payment month.`);if(m>=d.close)throw new Error(`Interim land payment ${i} month must be before final settlement.`);priorLandMonth=m;}
  if(d.facstart>=0&&d.facstart<d.close)throw new Error("Facility commitment cannot occur before the land payment month.");
  if(d.otherinc>0&&d.otherincmonth<d.close)throw new Error("Fixed other income cannot be recognised or collected before the land payment month.");
  if(d.dacapex>0){if(!Number.isInteger(Number(raw.dastart))||d.dastart<d.close)throw new Error("Depreciable capex must be placed in service on or after land payment using a whole model month.");if(!Number.isInteger(Number(raw.dalife))||d.dalife<1)throw new Error("D&A useful life must be a positive whole number of years.");}
  if(d.vert)for(let p=1;p<=productCount(d);p++){if(d[`buildmo${p}ovr`]&&d[`buildmo${p}`]<1)throw new Error(`Product ${p} build duration must be at least one month when its override is enabled.`);if(d[`buildmo${p}ovr`]&&!Number.isInteger(Number(raw[`buildmo${p}`])))throw new Error(`Product ${p} build duration must be a whole number.`)}
  if(!(d.acresGross>0))throw new Error("Gross site area must be greater than zero.");
  if(d.acresDed>d.acresGross)throw new Error("Land deductions cannot exceed gross site area.");
  if(!(d._acresNet>0))throw new Error("Developable site area must be greater than zero.");
  if(d._acresNet>d.acresGross)throw new Error("Developable site area cannot exceed gross site area.");
  if(d.ddur>d.ddend+1)throw new Error("Due diligence spend period cannot extend beyond the due diligence completion month.");
  for(let p=1;p<=productCount(d);p++){
    const count=d[`n${p}`];if(!(count>0))throw new Error(`Product ${p} must contain at least one unit. Reduce the number of product types if this product is not required.`);
    if(!(d[`w${p}`]>0))throw new Error(`Product ${p} saleable area must be greater than zero.`);
    if(d.vert){
      const salePsf=d[`hpsf${p}ovr`]?d[`hpsf${p}`]:d.hpsf,buildPsf=d[`buildpsf${p}ovr`]?d[`buildpsf${p}`]:d.buildpsf,buildMonths=d[`buildmo${p}ovr`]?d[`buildmo${p}`]:d.buildmo;
      if(!(d[`bua${p}`]>0))throw new Error(`Product ${p} vertical unit area must be greater than zero in vertical-development mode.`);
      if(!(salePsf>0))throw new Error(`Product ${p} vertical unit sale price must be greater than zero.`);
      if(!(buildPsf>0))throw new Error(`Product ${p} build cost must be greater than zero.`);
      if(!(buildMonths>=1))throw new Error(`Product ${p} build duration must be at least one month.`);
    }else if(!(d[`p${p}`]>0))throw new Error(`Product ${p} lot sale price must be greater than zero.`);
  }
  if(!d.vert&&!(d.pidx>0))throw new Error("Price index must be greater than zero.");
  const L=d._lots;if(!(L>0))throw new Error("Total lots must be greater than zero.");
  const V=!!d.vert,close=d.close,entStart=d.ddend,ent=entStart+d.entdur,st=Math.max(ent,close);
  if(landDepositAmount(d)>0&&close>0&&d.landdepmonth>=close)throw new Error("Land deposit month must be before the land settlement month.");
  if(close>0&&d.firbmonth>=close)throw new Error("Stamp duty, foreign purchaser surcharge and FIRB payment month must be before land settlement.");
  const shareVals=Array.from({length:d.nph},(_,i)=>_num(raw[`ph${i+1}share`],0)),costVals=Array.from({length:d.nph},(_,i)=>_num(raw[`ph${i+1}cost`],0));
  if(shareVals.some(v=>v>0)&&Math.abs(shareVals.reduce((a,b)=>a+b,0)-100)>.001)throw new Error("Entered phase lot allocations must total exactly 100%.");
  if(costVals.some(v=>v>0)&&Math.abs(costVals.reduce((a,b)=>a+b,0)-100)>.001)throw new Error("Entered phase construction-cost shares must total exactly 100%.");
  const ph=_phaseConfig(d,L);
  if(d.modelphase>0&&(d.modelphase>ph.count||ph.counts[d.modelphase-1]<=0))throw new Error("Selected display / sales-centre phase must be an active phase containing units.");
  if(L<ph.count)throw new Error("Total lots must be at least the number of active phases.");
  if(ph.counts.some((c,i)=>c<=0))throw new Error(`Every active phase must contain at least one unit; check Phase ${ph.counts.findIndex(c=>c<=0)+1}.`);
  const phaseStart=ph.starts.map(x=>st+x),phaseEnd=ph.ends.map(x=>st+x),phaseComplete=ph.completions.map(x=>st+x);
  const landBase=d.acresGross*d.pr,land=landBase*(1+d.landgst/100),
    stamp=d.stampmode?d.stampfixed:d.stamprt/100*land,
    surcharge=d.foreignsurcharge/100*land,
    firb=d.firbfee,acquisition=d.acquisitionfee+d.otheracq,
    closing=stamp+surcharge+acquisition+d.closingpc/100*landBase,rollback=d.rollback,otherDirect=d.otherdirect,
    dd=d.ddpc/100*landBase,infBase=d.infl*L,verticalBaseBuild=V?d.buildbua*d.buildpsf:0,constructionBaseForFees=V?verticalBaseBuild:infBase,
    professionalRate=d.softmode===1?d.sfengpc+d.sfarchpc+d.sfplanpc+d.sfcostpc+d.sflegalpc+d.sfotherpc:d.sfpc,
    developmentManagementRate=d.softmode===1?d.sfdmpc:d.dmpc,
    professional=professionalRate/100*constructionBaseForFees,developmentManagement=developmentManagementRate/100*constructionBaseForFees,soft=professional+developmentManagement,munic=d.munic,impactTotal=d.impact*L,
    minimumCash=d.mincash;
  const products=productIds(d).map(i=>({
    count:d[`n${i}`],width:d[`w${i}`],depth:d[`d${i}`],price:d[`p${i}`],bua:d[`bua${i}`],
    salePsf:d[`hpsf${i}ovr`]?d[`hpsf${i}`]:d.hpsf,
    buildMonths:d[`buildmo${i}ovr`]?d[`buildmo${i}`]:d.buildmo
  }));
  const balancedSequence=counts=>{const used=counts.map(()=>0),out=[];for(let n=0;n<counts.reduce((a,b)=>a+b,0);n++){let best=-1,bv=Infinity;counts.forEach((c,i)=>{if(used[i]>=c)return;const v=(used[i]+.5)/Math.max(c,1);if(v<bv){bv=v;best=i}});if(best<0)break;used[best]++;out.push(best)}return out};
  const PCOUNT=products.length,matrix=Array.from({length:ph.count},()=>new Array(PCOUNT).fill(0));
  const matrixEntered=Array.from({length:ph.count},(_,i)=>productIds(d).some(p=>d[`ph${i+1}p${p}`]>0)).some(Boolean);
  if(matrixEntered){
    for(let i=0;i<ph.count;i++)for(let p=0;p<PCOUNT;p++)matrix[i][p]=d[`ph${i+1}p${p+1}`];
    for(let i=0;i<ph.count;i++)if(matrix[i].reduce((a,b)=>a+b,0)!==ph.counts[i])throw new Error(`Phase ${i+1} product matrix row must equal its allocated unit count (${ph.counts[i]}).`);
    for(let p=0;p<PCOUNT;p++)if(matrix.reduce((a,row)=>a+row[p],0)!==products[p].count)throw new Error(`Product ${p+1} phase-matrix column must equal total product units (${products[p].count}).`);
  }else{
    const seq=balancedSequence(products.map(p=>p.count));let q=0;
    for(let i=0;i<ph.count;i++)for(let j=0;j<ph.counts[i];j++)matrix[i][seq[q++]]++;
  }
  const activePhases=ph.counts.map((c,i)=>c>0?i:-1).filter(i=>i>=0);
  const earliestActive=activePhases.reduce((best,i)=>phaseComplete[i]<phaseComplete[best]?i:best,activePhases[0]);
let modelPhaseIndex=(d.modelphase>0 && d.modelphase-1<ph.count && ph.counts[d.modelphase-1]>0)
  ? d.modelphase-1
  : earliestActive;
  const modelAnchor=d.presales?phaseStart[modelPhaseIndex]:phaseComplete[modelPhaseIndex];
  const globalOpen=V?modelAnchor+d.vlag+d.modelmo:st;
  const phaseQueues=matrix.map(row=>balancedSequence(row)),phaseSold=new Array(ph.count).fill(0);
  const projectRate=V?d.vel:d.absn;
  /* Sales are project-wide for both finished lots and vertical units. Construction
     phase allocations identify the physical inventory and cost / product mix only;
     they never open, stop or throttle the global monthly sales programme. Settlement
     remains phase-dependent. The baseline settlement / build cadence is preserved and
     shifted forward as one curve for each construction phase so that no unit can
     realise before the relevant phase development is complete. */
  const phaseSalesStart=ph.counts.map(()=>globalOpen),planned=[],constructionQueue=[];
  for(let i=0;i<ph.count;i++){
    const q=phaseQueues[i];
    for(let z=0;z<q.length;z++)constructionQueue.push({phase:i,product:q[z]});
  }
  if(constructionQueue.length!==L)throw new Error("Construction-phase unit allocation does not reconcile to total units.");
  let soldCount=0,globalCredit=0,month=globalOpen,guard=0;
  while(soldCount<L){
    if(++guard>20000)throw new Error("Sales schedule could not be completed; check global sales velocity.");
    globalCredit+=projectRate;
    while(globalCredit>=1-1e-9&&soldCount<L){
      const item=constructionQueue[soldCount],i=item.phase,product=item.product,p=products[product];
      const phaseEsc=V?(d[`ph${i+1}escovr`]?d[`ph${i+1}esc`]:d.esc):d.esc;
      const depositPct=V?(d[`ph${i+1}depo`]>=0?d[`ph${i+1}depo`]:d.depo):d.depo;
      const saleBase=V?p.salePsf*p.bua:p.width*p.price*d.pidx/100;
      const salePrice=saleBase*Math.pow(1+phaseEsc/100,month/12);
      if(V){
        const deliveryLag=Math.max(0,Math.round(d.dellag)),baselineBuildStart=month,baselineDelivery=month+deliveryLag;
        planned.push({product,phase:i,salesPhase:null,contractMonth:month,baselineBuildStart,buildStart:baselineBuildStart,baselineDelivery,delivery:baselineDelivery,saleBase,phaseEsc,salePrice,depositPct,buildCost:0,permitCost:0,baseBuild:0});
      }else{
        const lotSettlementLag=Math.max(0,Math.round(d.dellag)),baselineDelivery=month+lotSettlementLag;
        planned.push({product,phase:i,salesPhase:null,contractMonth:month,buildStart:0,baselineDelivery,delivery:baselineDelivery,saleBase,phaseEsc,salePrice,depositPct,buildCost:0,permitCost:0,baseBuild:0});
      }
      phaseSold[i]++;soldCount++;globalCredit-=1;
    }
    month++;
  }
  /* Business Plan vertical projects carry an annual realisation profile from the
     published source schedule.  In that mode, construction is progressed through
     each phase rather than waiting for the whole phase to finish before any unit can
     settle.  Units may realise once their own build slot is complete, and annual
     settlement value is then fitted to the published Business Plan profile. */
  const bpTimingProfile=[];
  if(V&&_num(d._bpTiming,0)>=.5){
    for(let q=1;q<=12;q++){
      const y=Math.round(_num(d[`_bpYear${q}`],0)),w=Math.max(0,_num(d[`_bpWeight${q}`],0));
      if(y>0&&w>0)bpTimingProfile.push({year:y,weight:w});
    }
    bpTimingProfile.sort((a,b)=>a.year-b.year);
  }
  const bpWeightTotal=bpTimingProfile.reduce((a,b)=>a+b.weight,0);
  if(bpTimingProfile.length&&bpWeightTotal>0){
    /* Put each vertical unit into a progressive construction slot inside its physical
       phase. This removes the former all-or-nothing phase-completion settlement gate. */
    for(let i=0;i<ph.count;i++){
      const phaseUnits=planned.filter(u=>u.phase===i);
      const dur=Math.max(1,ph.durations[i]);
      phaseUnits.forEach((u,j)=>{
        const p=products[u.product],slot=Math.min(dur-1,Math.floor((j+.5)*dur/Math.max(1,phaseUnits.length)));
        u.buildStart=phaseStart[i]+slot;u.baselineBuildStart=u.buildStart;
        u.contractMonth=Math.max(close,Math.min(u.contractMonth,u.buildStart));
        u.salePrice=u.saleBase*Math.pow(1+u.phaseEsc/100,u.contractMonth/12);
        u.baselineDelivery=u.buildStart+Math.max(0,p.buildMonths-1);u.delivery=u.baselineDelivery;
      });
    }
    const monthIndex=(year,month)=>(year-d.startYear)*12+(month-d.startMonth),
      ordered=planned.slice().sort((a,b)=>a.baselineDelivery-b.baselineDelivery||a.contractMonth-b.contractMonth||a.phase-b.phase||a.product-b.product),
      totalValue=ordered.reduce((a,u)=>a+u.salePrice,0);
    let cursor=0,assignedValue=0,cumWeight=0;
    bpTimingProfile.forEach((slot,si)=>{
      cumWeight+=slot.weight/bpWeightTotal;
      const targetCum=si===bpTimingProfile.length-1?totalValue:totalValue*cumWeight,
        yearStart=monthIndex(slot.year,1),yearEnd=monthIndex(slot.year,12),selected=[];
      while(cursor<ordered.length&&assignedValue<targetCum-.5){
        const u=ordered[cursor];
        if(u.baselineDelivery>yearEnd)break;
        selected.push(u);assignedValue+=u.salePrice;cursor++;
      }
      selected.forEach((u,j)=>{
        const ideal=yearStart+Math.floor((j+.5)*12/Math.max(1,selected.length));
        u.delivery=Math.max(u.baselineDelivery,Math.min(yearEnd,ideal));
        u.contractMonth=Math.min(u.contractMonth,u.buildStart,u.delivery);
        u.salePrice=u.saleBase*Math.pow(1+u.phaseEsc/100,u.contractMonth/12);
        u.settlementShift=u.delivery-u.baselineDelivery;
      });
    });
    /* If physical readiness prevents the source profile being met in an earlier year,
       carry only the unavailable units forward instead of forcing settlement before
       their own construction slot has completed. */
    for(;cursor<ordered.length;cursor++){
      const u=ordered[cursor];u.delivery=u.baselineDelivery;u.contractMonth=Math.min(u.contractMonth,u.buildStart,u.delivery);
      u.salePrice=u.saleBase*Math.pow(1+u.phaseEsc/100,u.contractMonth/12);u.settlementShift=0;
    }
  }else{
    /* Standard dynamic mode: preserve each phase's settlement cadence instead of
       bunching pre-sales at completion. */
    for(let i=0;i<ph.count;i++){
      const phaseUnits=planned.filter(u=>u.phase===i);
      if(!phaseUnits.length)continue;
      if(V){
        const phaseLag=d[`ph${i+1}dellag`]>=0?Math.max(0,Math.round(d[`ph${i+1}dellag`])):0;
        const firstBaselineDelivery=Math.min(...phaseUnits.map(u=>u.baselineDelivery));
        const targetFirstDelivery=phaseComplete[i]+phaseLag;
        const phaseShift=Math.max(0,targetFirstDelivery-firstBaselineDelivery);
        phaseUnits.forEach(u=>{u.settlementShift=phaseShift;u.delivery=u.baselineDelivery+phaseShift});
      }else{
        const firstBaseline=Math.min(...phaseUnits.map(u=>u.baselineDelivery));
        const phaseShift=Math.max(0,phaseComplete[i]-firstBaseline);
        phaseUnits.forEach(u=>{u.settlementShift=phaseShift;u.delivery=u.baselineDelivery+phaseShift});
      }
    }
  }
  planned.sort((a,b)=>a.contractMonth-b.contractMonth||a.phase-b.phase||a.product-b.product);
  const finalContractMonth=Math.max(...planned.map(u=>u.contractMonth)),lastPlannedDelivery=Math.max(...planned.map(u=>u.delivery));
  const finalReimb=(d.pidel>0&&d.pidrt>0)?Math.max(...phaseComplete.map(x=>x+d.pidlag)):0;
  const daEnd=d.dacapex>0?d.dastart+d.dalife*12:0;
  const landSpendEnd=close;
  const NM=Math.max(1,lastPlannedDelivery,finalReimb,landSpendEnd,close,ent,Math.max(0,Math.round(d.otherincmonth)),Math.max(0,Math.round(d.dastart)),daEnd)+Math.max(d.taxlag,d.taxqlag)+24;
  const K=["build","design","permit","vert1","land","closing","firb","dd","soft","supervision","professionalfee","dmfee","pidprocess","otherdirect","munic","impact","infra","cont","devc","fdev","sval","recog","dep","escr","escbal","balr","lsr","pid","sell","sellcash","brokeragecash","sellingexpensecash","outputgst","gstrefund","landgstrefund","devgstrefund","inputgstpaid","gstcogs","capex","ovh","fixovh","gna","gnashared","staff","staffshared","corpovh","marketing","da","otherincome","carry","retax","hoaexp","insurance","retaxcapadd","retaxcaprel","retaxexp","hoacapadd","hoacaprel","hoaexppl","insurancecapadd","insurancecaprel","insuranceexp","pf","pfamort","lf","lop","dr1","dr2","cumd","intr","icash","rep","lcl","net","taxm","eqcf","eqin","eqout","eqreimbcap","cash","price","cinf","model","landcogs","concogs","vertcogs","othcogs","landbasecogs","infracogs","designcogs","authoritycogs","constructioncogs","otherdirectcogs","finexp","fincapadd","fincaprel","relbase","relreq","pidcogs","bradd","brcomplete"];
  const R={};K.forEach(k=>R[k]=new Array(NM+1).fill(0));const ctr=new Array(NM+1).fill(0),dlv=new Array(NM+1).fill(0),unitRecords=planned;
  const unitsByPhase=Array.from({length:ph.count},()=>[]),productCtr=Array.from({length:PCOUNT},()=>new Array(NM+1).fill(0));
  unitRecords.forEach(u=>{unitsByPhase[u.phase].push(u);ctr[u.contractMonth]++;productCtr[u.product][u.contractMonth]++;dlv[u.delivery]++;R.sval[u.contractMonth]+=u.salePrice;R.dep[u.contractMonth]+=u.depositPct/100*u.salePrice;R.recog[u.delivery]+=u.salePrice;R.balr[u.delivery]+=(1-u.depositPct/100)*u.salePrice;R.escr[u.delivery]+=u.depositPct/100*u.salePrice});
  for(let m=0;m<=NM;m++){R.price[m]=ctr[m]?R.sval[m]/ctr[m]:0;R.lsr[m]=(d.escrow?0:R.dep[m])+R.balr[m]+(d.escrow?R.escr[m]:0)}
  let escrowBalance=0;for(let m=0;m<=NM;m++){escrowBalance+=d.escrow?R.dep[m]-R.escr[m]:0;R.escbal[m]=escrowBalance}
  const phaseActual=ph.counts.map(()=>0),phaseEligible=ph.counts.map(()=>0),phaseReimb=ph.counts.map(()=>0);
  ph.durations.forEach((dur,i)=>{const phaseBase=infBase*ph.costWeights[i],phaseMunic=munic*ph.costWeights[i],weights=_spendWeights(dur,d.infracurve);for(let k=0;k<dur;k++){const m=phaseStart[i]+k,infraSpend=phaseBase*weights[k]*Math.pow(1+d.infesc/100,m/12),municSpend=phaseMunic*weights[k],contSpend=infraSpend*d.contpc/100+d.contfixed*ph.costWeights[i]*weights[k];R.cinf[m]+=infraSpend;R.munic[m]+=municSpend;R.cont[m]+=contSpend;phaseEligible[i]+=infraSpend+contSpend;phaseActual[i]+=infraSpend+contSpend+municSpend}const rm=phaseComplete[i]+d.pidlag;phaseReimb[i]=phaseEligible[i]*d.pidel/100*d.pidrt/100;if(rm<=NM)R.pid[rm]+=phaseReimb[i]});
  const infTot=R.cinf.reduce((a,b)=>a+b,0),contTot=R.cont.reduce((a,b)=>a+b,0),pid=R.pid.reduce((a,b)=>a+b,0);
  const buaTot=products.reduce((a,p)=>a+p.count*p.bua,0),baseBuildTot=V?verticalBaseBuild:0,modelCost=V?d.modelcost:0,vst=modelAnchor+d.vlag,vopen=vst+d.modelmo;
  if(V&&baseBuildTot>0){
    const saleableDen=Math.max(1,buaTot);
    unitRecords.forEach(u=>{const p=products[u.product];u.baseBuild=baseBuildTot*Math.max(0,p.bua)/saleableDen});
  }
  if(V&&modelCost>0){if(d.modelmo>0)for(let m=vst;m<vopen&&m<=NM;m++)R.model[m]+=modelCost/d.modelmo;else R.model[vst]+=modelCost}
  unitRecords.forEach(u=>{const p=products[u.product];if(V){const buildWeights=_spendWeights(p.buildMonths,d.buildcurve);for(let k=0;k<p.buildMonths;k++){const m=u.buildStart+k,c=u.baseBuild*buildWeights[k]*Math.pow(1+d.infesc/100,m/12);R.build[m]+=c;R.cont[m]+=c*d.contpc/100;u.buildCost+=c}u.permitCost=d.permpc/100*(d.permitbase?u.buildCost:u.baseBuild*Math.pow(1+d.infesc/100,u.contractMonth/12));R.permit[u.contractMonth]+=u.permitCost}});
  const actualBuild=R.build.reduce((a,b)=>a+b,0),designTot=0;
  const actualPermit=R.permit.reduce((a,b)=>a+b,0),phaseNetCost=phaseActual.slice();
  const allocMetric=u=>{const p=products[u.product];if(d.allocbasis===0)return 1;if(d.allocbasis===1)return Math.max(1,p.width*p.depth);if(d.allocbasis===2)return Math.max(1,u.salePrice);return Math.max(1,V?p.bua:p.width)};
  const totalAlloc=unitRecords.reduce((a,u)=>a+allocMetric(u),0),phaseAlloc=ph.counts.map((_,i)=>unitRecords.filter(u=>u.phase===i).reduce((a,u)=>a+allocMetric(u),0));
  unitRecords.forEach(u=>{
    const w=allocMetric(u)/totalAlloc,pw=allocMetric(u)/Math.max(1,phaseAlloc[u.phase]);
    const landBaseC=land*w,acquisitionOtherC=(closing+rollback+firb+dd+otherDirect)*w;
    const horizontalDesignC=soft*w,districtAuthorityC=d.pidcost*w;
    const infraC=phaseEligible[u.phase]*pw;
    const horizontalAuthorityC=Math.max(0,phaseActual[u.phase]-phaseEligible[u.phase])*pw+d.impact;
    const verticalDesignC=0;
    const modelC=V?modelCost*(u.baseBuild/Math.max(1,baseBuildTot)):0;
    const constructionC=V?u.buildCost+modelC:0,permitAuthorityC=V?u.permitCost:0;
    const landC=landBaseC+(closing+rollback+firb)*w;
    const otherC=(dd+soft+d.pidcost+otherDirect)*w;
    const conC=phaseNetCost[u.phase]*pw+d.impact;
    const vertC=V?(u.buildCost+u.permitCost+verticalDesignC+modelC):0;
    const hardRiskC=phaseEligible[u.phase]*pw+(V?u.buildCost+modelC:0),pidReduction=phaseReimb[u.phase]*pw;
    u.inventoryCost=landC+otherC+conC+vertC;u.pidReduction=pidReduction;
    R.landcogs[u.delivery]+=landC;R.othcogs[u.delivery]+=otherC;R.concogs[u.delivery]+=conC;R.vertcogs[u.delivery]+=vertC;
    /* Named P&L buckets: acquisition closing/rollback stay with land; DD and soft cost stay with design/supervision; only the explicit manual input feeds Other Direct Cost. */
    R.landbasecogs[u.delivery]+=landC;
    R.infracogs[u.delivery]+=infraC;
    R.designcogs[u.delivery]+=dd*w+horizontalDesignC+verticalDesignC;
    R.authoritycogs[u.delivery]+=districtAuthorityC+horizontalAuthorityC+permitAuthorityC;
    R.constructioncogs[u.delivery]+=constructionC;
    R.otherdirectcogs[u.delivery]+=otherDirect*w;
    R.brcomplete[V?u.delivery:phaseComplete[u.phase]]+=hardRiskC;
    if(d.pidacct)R.pidcogs[Math.max(u.delivery,phaseComplete[u.phase]+d.pidlag)]-=pidReduction;
    const brokerageTotal=d.comm/100*u.salePrice,sellingExpenseTotal=d.sellingpc/100*u.salePrice,totalCommission=brokerageTotal+sellingExpenseTotal,payAtBooking=d.commbookpc/100;
    const brokerageBooking=brokerageTotal*payAtBooking,sellingBooking=sellingExpenseTotal*payAtBooking;
    R.brokeragecash[u.contractMonth]+=brokerageBooking;R.brokeragecash[u.delivery]+=brokerageTotal-brokerageBooking;
    R.sellingexpensecash[u.contractMonth]+=sellingBooking;R.sellingexpensecash[u.delivery]+=sellingExpenseTotal-sellingBooking;
    R.sellcash[u.contractMonth]+=brokerageBooking+sellingBooking;R.sellcash[u.delivery]+=totalCommission-brokerageBooking-sellingBooking;
    R.sell[u.delivery]+=totalCommission;
    u.eligibleCost=(d.finland?landC:0)+(d.findd?otherC:0)+(d.finhoriz?(phaseActual[u.phase]*pw+d.impact):0)+(d.finvert?vertC:0);
    R.relbase[u.delivery]+=u.eligibleCost;
    const release=d.relmode===1?d.relsalespc/100*u.salePrice:d.relmode===2?d[`relfixed${u.product+1}`]:d.relpc*d.ltc/100*u.eligibleCost;
    if(release>u.salePrice+1)throw new Error(`Product ${u.product+1} required debt release exceeds its unit sale proceeds; reduce the release setting or increase price.`);
    if(d.relmode===1){const depositRelease=d.escrow?0:d.relsalespc/100*u.depositPct/100*u.salePrice;R.relreq[u.contractMonth]+=depositRelease;R.relreq[u.delivery]+=Math.max(0,release-depositRelease)}
    else R.relreq[u.delivery]+=Math.max(0,release)
  });
  /* Land follows the exact acquisition schedule: deposit, optional interim payments, then final settlement balance. */
  const landDeposit=Math.min(land,landDepositAmount(d));
  if(landDeposit>0)R.land[d.landdepmonth]+=landDeposit;
  let interimPaid=0;for(let i=1;i<=d.landpaycount;i++){const amt=Math.max(0,d[`landpay${i}`]);interimPaid+=amt;R.land[d[`landpay${i}month`]]+=amt;}
  R.land[close]+=Math.max(0,land-landDeposit-interimPaid);
  /* Transaction taxes/regulatory charges are pre-purchase cash costs. Acquisition fees and legacy closing items remain at settlement. */
  R.closing[d.firbmonth]+=stamp+surcharge;
  R.firb[d.firbmonth]+=firb;
  R.closing[close]+=acquisition+d.closingpc/100*landBase+rollback;
  if(d.ddur>0){for(let m=0;m<d.ddur;m++)R.dd[m]+=dd/d.ddur}else R.dd[Math.min(NM,Math.max(0,d.ddend))]+=dd;
  /* Australia fee timing follows the Brunswick basis instead of paying all fees before construction:
     20% of professional fees during concept/schematic design, 40% during the first construction year,
     the remaining 40% over the balance of construction, and development-management fees with construction spend. */
  const constructionCurve=V?R.build:R.cinf,firstConstructionMonth=Math.max(0,constructionCurve.findIndex(v=>v>1e-9)),
    profConcept=professional*.20,profFirstYear=professional*.40,profBalance=professional-profConcept-profFirstYear;
  const conceptStart=Math.max(0,firstConstructionMonth-12),conceptMonths=Math.max(1,firstConstructionMonth-conceptStart);
  for(let m=conceptStart;m<firstConstructionMonth&&m<=NM;m++)R.professionalfee[m]+=profConcept/conceptMonths;
  const firstYearEnd=Math.min(NM+1,firstConstructionMonth+12),firstYearMonths=Math.max(1,firstYearEnd-firstConstructionMonth);
  for(let m=firstConstructionMonth;m<firstYearEnd;m++)R.professionalfee[m]+=profFirstYear/firstYearMonths;
  const constructionMonths=[];for(let m=firstConstructionMonth+12;m<=NM;m++)if(constructionCurve[m]>1e-9)constructionMonths.push(m);
  if(constructionMonths.length){
    const constructionWeight=constructionMonths.reduce((a,m)=>a+constructionCurve[m],0)||constructionMonths.length;
    constructionMonths.forEach(m=>R.professionalfee[m]+=profBalance*(constructionWeight===constructionMonths.length?1/constructionMonths.length:constructionCurve[m]/constructionWeight));
  }else R.professionalfee[Math.min(NM,firstConstructionMonth)]+=profBalance;
  const constructionTotalForDM=constructionCurve.reduce((a,b)=>a+b,0)||1;
  for(let m=0;m<=NM;m++)if(constructionCurve[m]>0)R.dmfee[m]+=developmentManagement*constructionCurve[m]/constructionTotalForDM;
  for(let m=0;m<=NM;m++)R.supervision[m]=R.professionalfee[m]+R.dmfee[m];
  if(d.entdur>0){
    for(let m=entStart;m<ent;m++){
      R.pidprocess[m]+=d.pidcost/d.entdur;
      R.otherdirect[m]+=otherDirect/d.entdur;
    }
  }else{
    const m=Math.min(NM,Math.max(0,entStart));R.pidprocess[m]+=d.pidcost;R.otherdirect[m]+=otherDirect
  }
  if(d.dacapex>0)R.capex[d.dastart]+=d.dacapex;
  for(let m=0;m<=NM;m++){R.soft[m]=R.supervision[m]+R.pidprocess[m];R.infra[m]=R.cinf[m];R.impact[m]=d.impact*dlv[m];R.vert1[m]=R.build[m]+R.design[m]+R.permit[m]+R.model[m];R.bradd[m]=R.cinf[m]+R.cont[m]+R.build[m]+R.model[m];R.devc[m]=R.land[m]+R.closing[m]+R.firb[m]+R.dd[m]+R.soft[m]+R.otherdirect[m]+R.munic[m]+R.impact[m]+R.infra[m]+R.cont[m]+R.vert1[m];R.fdev[m]=(d.finland?R.land[m]+R.closing[m]+R.firb[m]:0)+(d.findd?R.dd[m]+R.soft[m]+R.otherdirect[m]:0)+(d.fincapex?R.capex[m]:0)+(d.finhoriz?R.munic[m]+R.impact[m]+R.infra[m]+R.cont[m]:0)+(d.finvert?R.vert1[m]:0)}
  const lastDlv=Math.max(...unitRecords.map(u=>u.delivery)),grossRecognisedTotal=R.recog.reduce((a,b)=>a+b,0);
  /* Output GST is determined before overheads because all "% net revenue" inputs
     must be applied to revenue after output GST. Margin-scheme mode uses an explicit
     acquisition basis allocated pro-rata across recognised sales. */
  const marginSchemeBasis=d.gstmode===1?Math.max(0,d.gstmarginbase>0?d.gstmarginbase:land):0;
  for(let m=0;m<=NM;m++){
    if(d.gstmode===1){
      const allocatedBasis=grossRecognisedTotal>0?marginSchemeBasis*R.recog[m]/grossRecognisedTotal:0;
      R.outputgst[m]=Math.max(0,R.recog[m]-allocatedBasis)*d.gst/(100+d.gst);
    }else R.outputgst[m]=R.recog[m]*d.gst/(100+d.gst);
  }
  if(d.outputgstfixed>0){const z=R.outputgst.reduce((a,b)=>a+b,0);if(z>0){const scale=d.outputgstfixed/z;for(let m=0;m<=NM;m++)R.outputgst[m]*=scale}}
  const netRevenueBase=R.recog.map((v,m)=>v-R.outputgst[m]),netRevenueTotal=netRevenueBase.reduce((a,b)=>a+b,0);
  const overheadRates={gna:d.gnapc/100,gnashared:d.gnasharedpc/100,staff:d.staffpc/100,staffshared:d.staffsharedpc/100,corpovh:d.corp/100};
  const overheadFixed={gna:d.gnafixed,gnashared:d.gnasharedfixed,staff:d.stafffixed,staffshared:d.staffsharedfixed,corpovh:d.corpfixed};
  /* Project overhead starts with DD at model month 0. Percentage budgets are based
     on net revenue, while fixed-monthly mode remains independent of sales. */
  const overheadStart=0,overheadMonths=Math.max(1,lastDlv-overheadStart+1);
  if(d.ovhmode===1){
    for(let m=overheadStart;m<=lastDlv;m++)Object.keys(overheadFixed).forEach(k=>R[k][m]=overheadFixed[k]);
  }else if(d.ovhmode===2){
    const projectRateKeys=["gna","gnashared","staff","staffshared"];
    for(let m=overheadStart;m<=lastDlv;m++)projectRateKeys.forEach(k=>R[k][m]=overheadRates[k]*netRevenueTotal/overheadMonths);
    for(let m=0;m<=NM;m++)R.corpovh[m]=overheadRates.corpovh*netRevenueBase[m];
  }else{
    for(let m=0;m<=NM;m++)Object.keys(overheadRates).forEach(k=>R[k][m]=overheadRates[k]*netRevenueBase[m]);
  }
  const daMonths=d.dacapex>0?d.dalife*12:0,monthlyDA=daMonths?d.dacapex/daMonths:0;
  for(let m=0;m<=NM;m++){
    R.ovh[m]=R.gna[m]+R.gnashared[m]+R.staff[m]+R.staffshared[m]+R.corpovh[m];
    R.fixovh[m]=R.ovh[m];
    R.marketing[m]=d.marketingpc/100*netRevenueBase[m];
    R.da[m]=(d.dacapex>0&&m>=d.dastart&&m<d.dastart+daMonths)?monthlyDA:0;
    R.otherincome[m]=d.otherincpc/100*netRevenueBase[m];
  }
  R.otherincome[Math.min(NM,Math.max(0,Math.round(d.otherincmonth)))]+=d.otherinc;
  const firstPhaseComplete=Math.min(...activePhases.map(i=>phaseComplete[i])),hoaStart=d.hoastart===0?close:d.hoastart===2?Math.min(...unitRecords.map(u=>u.delivery)):firstPhaseComplete;
  const holdingMonths=Math.max(1,lastDlv-close+1);
  let sold=0,devCum=0,devCogsCum=0,pidInventoryReduction=0,riskAddsCum=0,riskCompleteCum=0;
  for(let m=0;m<=NM;m++){
    sold+=dlv[m];devCum+=R.devc[m];devCogsCum+=R.landcogs[m]+R.concogs[m]+R.vertcogs[m]+R.othcogs[m];
    pidInventoryReduction+=R.pid[m];riskAddsCum+=R.bradd[m];riskCompleteCum+=R.brcomplete[m];
    const owns=m>=close&&m<=lastDlv?1:0;
    const pt=owns*(d.holdingfixed>0?d.holdingfixed/holdingMonths:(d.landtax+d.foreignlandtax+d.councilrates)/12),hoa=0;
    const wip=Math.max(0,riskAddsCum-riskCompleteCum),insurance=d.insur/100/12*wip;
    R.retax[m]=pt;R.hoaexp[m]=hoa;R.insurance[m]=insurance;R.carry[m]=R.retax[m]+R.hoaexp[m]+R.insurance[m]
  }
  for(let m=0;m<=NM;m++){
    /* Land consideration is entered ex GST and R.land is the actual GST-inclusive
       acquisition cash payment. Development / selling costs can be entered either
       GST-inclusive or GST-exclusive. Ex-GST mode explicitly bridges the GST cash
       paid until the refund arrives; inclusive mode preserves the entered gross cash. */
    const landCredit=d.gstmode===1?0:R.land[m]*d.landgst/(100+d.landgst);
    const otherEligible=R.dd[m]+R.infra[m]+R.cont[m]+R.supervision[m]+R.pidprocess[m]+R.otherdirect[m]+R.build[m]+R.design[m]+R.permit[m]+R.model[m]+R.capex[m]+R.sellcash[m]+R.marketing[m];
    const devCredit=d.costgstbasis===0?otherEligible*d.inputgst/100:otherEligible*d.inputgst/(100+d.inputgst);
    if(d.costgstbasis===0)R.inputgstpaid[m]=devCredit;
    const to=m+d.gstlag;if(to<=NM){R.landgstrefund[to]+=landCredit;R.devgstrefund[to]+=devCredit;R.gstrefund[to]+=landCredit+devCredit}
  }
  if(d.gstcreditfixed>0){
    const z=R.gstrefund.reduce((a,b)=>a+b,0);
    if(z>0){const scale=d.gstcreditfixed/z;for(let m=0;m<=NM;m++){R.gstrefund[m]*=scale;R.landgstrefund[m]*=scale;R.devgstrefund[m]*=scale}}
    else{R.gstrefund[Math.min(NM,Math.max(close,d.gstlag))]=d.gstcreditfixed;R.devgstrefund[Math.min(NM,Math.max(close,d.gstlag))]=d.gstcreditfixed}
  }
  const totalLandCredit=R.landgstrefund.reduce((a,b)=>a+b,0),totalDevCredit=R.devgstrefund.reduce((a,b)=>a+b,0),totalDevGstPaid=R.inputgstpaid.reduce((a,b)=>a+b,0),totalRecognised=R.recog.reduce((a,b)=>a+b,0)||1;
  /* P&L costs must be net only of GST actually recoverable. Land inventory is carried
     gross in the engine, so recovered land GST is removed. In ex-GST development-cost
     mode the base costs are already net; only unrecovered GST becomes an extra cost. */
  const pnlGstAdjustment=-totalLandCredit+(d.costgstbasis===1?-totalDevCredit:Math.max(0,totalDevGstPaid-totalDevCredit));
  for(let m=0;m<=NM;m++)R.gstcogs[m]=pnlGstAdjustment*R.recog[m]/totalRecognised;
  for(let m=0;m<=NM;m++)R.net[m]=R.lsr[m]+R.pid[m]+R.otherincome[m]+R.gstrefund[m]-R.outputgst[m]-R.devc[m]-R.capex[m]-R.sellcash[m]-R.ovh[m]-R.marketing[m]-R.carry[m]-R.inputgstpaid[m];
  const finBase=(d.finland?land+closing+rollback+firb:0)+(d.findd?dd+soft+d.pidcost+otherDirect:0)+(d.fincapex?d.dacapex:0)+(d.finhoriz?infTot+contTot+munic+impactTotal:0)+(d.finvert?actualBuild+actualPermit+modelCost:0),ltcCommit=d.facmode&&d.facilityfixed>0?d.facilityfixed:d.ltc/100*finBase;
  const futureEligible=new Array(NM+2).fill(0);for(let m=NM;m>=0;m--)futureEligible[m]=futureEligible[m+1]+Math.max(0,R.fdev[m]);
  const firstEligibleSpend=R.fdev.findIndex(v=>v>1e-6),facilityStart=d.facstart>=0?d.facstart:Math.max(close,firstEligibleSpend>=0?firstEligibleSpend:close);
  if(facilityStart>NM)throw new Error("Facility commitment month falls beyond the model horizon.");
  /* Capital-stack logic: the facility may be fixed or LTC-derived. Funding may
     be pro-rata to eligible spend or equity-first up to the entered threshold. */
  const simulateDebt=reserveRequested=>{
    const out={};["lop","dr1","dr2","intr","icash","rep","lcl","pf","lf","cumd","eqreimbcap","opopen","intopen","oprep","intrep","opcl","intcl","opavg","opunused"].forEach(k=>out[k]=new Array(NM+1).fill(0));
    const reserveOutside=!!d.intresout,reserveCap=reserveOutside?Math.max(0,reserveRequested):Math.min(Math.max(0,reserveRequested),ltcCommit),operatingCommit=reserveOutside?ltcCommit:Math.max(0,ltcCommit-reserveCap),totalLimit=operatingCommit+reserveCap,equityFirstTarget=d.equityfixed>0?d.equityfixed:d.equitypc/100*finBase;
    let opDebt=0,intDebt=0,cumEligible=0,cumFinanceDraw=0,cumDraw=0,operatingDrawn=0,availableCash=0,unreimbursedEquity=0;
    for(let m=0;m<=NM;m++){
      const openingOp=opDebt,openingInt=intDebt,opening=openingOp+openingInt;out.opopen[m]=openingOp;out.intopen[m]=openingInt;out.lop[m]=opening;cumEligible+=Math.max(0,R.fdev[m]);
      const facilityAvailable=m>=facilityStart,proRataBase=d.ltc/100*cumEligible,equityFirstBase=Math.max(0,cumEligible-equityFirstTarget),opBase=facilityAvailable?Math.min(operatingCommit,d.fundingmode?equityFirstBase:proRataBase):0,cashBefore=availableCash+R.net[m],deficit=Math.max(0,-cashBefore),baseHeadroom=facilityAvailable?(d.revolver?Math.max(0,opBase-opDebt):Math.max(0,Math.min(opBase,operatingCommit-operatingDrawn))):0,monthlyEligible=facilityAvailable?(d.fundingmode||d.cashfungible?Infinity:d.ltc/100*Math.max(0,R.fdev[m])):0;
      const normalDraw=Math.min(deficit,baseHeadroom,monthlyEligible),remainingDeficit=Math.max(0,deficit-normalDraw);
      unreimbursedEquity+=remainingDeficit;
      const reimbursementCapacity=Math.max(0,Math.min(baseHeadroom-normalDraw,monthlyEligible-normalDraw));
      const reimbursementDraw=(d.cashfungible&&d.equityreimb)?Math.min(reimbursementCapacity,unreimbursedEquity):0;
      out.dr1[m]=normalDraw+reimbursementDraw;out.eqreimbcap[m]=reimbursementDraw;unreimbursedEquity=Math.max(0,unreimbursedEquity-reimbursementDraw);opDebt+=out.dr1[m];operatingDrawn+=out.dr1[m];
      const deliveryRelease=R.relreq[m],reimbRelease=d.pidrep?R.pid[m]:0,required=deliveryRelease+reimbRelease;
      const provisionalOpRep=Math.min(opDebt,required),remainingProvisional=Math.max(0,required-provisionalOpRep),provisionalIntRep=Math.min(intDebt,remainingProvisional),closingOpPre=Math.max(0,opDebt-provisionalOpRep),closingIntPre=Math.max(0,intDebt-provisionalIntRep),closingPre=closingOpPre+closingIntPre,basis=d.intconv===0?opening:d.intconv===2?closingPre:(opening+closingPre)/2;
      out.intr[m]=d.rate/100/12*Math.max(0,basis);
      if(m===facilityStart&&operatingCommit>0)out.pf[m]=d.procf/100*operatingCommit;
      const noFuture=futureEligible[m+1]<=1e-6,active=operatingCommit>0&&m>=facilityStart&&(closingOpPre>1e-6||!noFuture),avgOp=(openingOp+closingOpPre)/2;out.opavg[m]=avgOp;out.opunused[m]=active?Math.max(0,operatingCommit-avgOp):0;out.lf[m]=d.linef/100/12*out.opunused[m];
      const financeCost=out.intr[m]+out.pf[m]+out.lf[m],financeHeadroom=Math.max(0,totalLimit-opDebt-intDebt);
      out.dr2[m]=d.fundi?Math.min(financeCost,Math.max(0,reserveCap-cumFinanceDraw),financeHeadroom):0;intDebt+=out.dr2[m];cumFinanceDraw+=out.dr2[m];out.icash[m]=financeCost-out.dr2[m];
      let repay=Math.min(opDebt+intDebt,required),opRep=Math.min(opDebt,repay);opDebt-=opRep;repay-=opRep;const intRep=Math.min(intDebt,repay);intDebt-=intRep;out.oprep[m]=opRep;out.intrep[m]=intRep;out.rep[m]=opRep+intRep;
      if(noFuture&&m>=lastDlv&&(!d.pidrep||pid<=0||m>=finalReimb)){out.oprep[m]+=opDebt;out.intrep[m]+=intDebt;out.rep[m]+=opDebt+intDebt;opDebt=0;intDebt=0}
      out.opcl[m]=opDebt;out.intcl[m]=intDebt;const closingDebt=opDebt+intDebt;out.lcl[m]=closingDebt;
      availableCash=Math.max(0,cashBefore+out.dr1[m]+out.dr2[m]-out.intr[m]-out.pf[m]-out.lf[m]-out.rep[m]);cumDraw+=out.dr1[m]+out.dr2[m];out.cumd[m]=cumDraw;
    }
    const totalInterest=out.intr.reduce((a,b)=>a+b,0),totalFees=out.pf.reduce((a,b)=>a+b,0)+out.lf.reduce((a,b)=>a+b,0);
    return {out,totalLimit,operatingCommit,reserveCap,equityFirstTarget,totalInterest,totalFees,totalFinanceCost:totalInterest+totalFees,financeDraw:out.dr2.reduce((a,b)=>a+b,0)}
  };
  let reserve=d.fundi?(d.intres>0?d.intres:Math.max(0,ltcCommit*.05)):0,debtResult;for(let i=0;i<24;i++){debtResult=simulateDebt(reserve);if(!d.fundi||d.intres>0)break;const wanted=debtResult.totalFinanceCost;if(Math.abs(wanted-reserve)<1)break;reserve=.5*reserve+.5*wanted}debtResult=simulateDebt(reserve);reserve=debtResult.reserveCap;["lop","dr1","dr2","intr","icash","rep","lcl","pf","lf","cumd","eqreimbcap","opopen","intopen","oprep","intrep","opcl","intcl","opavg","opunused"].forEach(k=>R[k]=debtResult.out[k]);const lim=debtResult.totalLimit;
  /* Capitalisation ceases when the relevant inventory is physically ready for
     sale, not when it eventually settles. For partially completed projects only the
     borrowing / holding cost attributable to still-qualifying inventory is capitalised. */
  const physicalReadyExclusive=u=>{
    if(!V)return phaseComplete[u.phase];
    const buildReady=u.buildStart+Math.max(1,products[u.product].buildMonths);
    return bpTimingProfile.length?buildReady:Math.max(phaseComplete[u.phase],buildReady);
  };
  const qualifyingEnd=u=>Math.min(u.delivery+1,physicalReadyExclusive(u));
  const allocateQualifyingCost=(cost,capitalisedAdd,capitalisedRelease,periodExpense)=>{
    for(let m=0;m<=NM;m++){
      const amount=cost[m];if(Math.abs(amount)<=1e-12)continue;
      const outstanding=unitRecords.filter(u=>m<=u.delivery),totalWeight=outstanding.reduce((a,u)=>a+Math.max(1,u.inventoryCost),0);
      const qualifying=outstanding.filter(u=>m<qualifyingEnd(u)),qualifyingWeight=qualifying.reduce((a,u)=>a+Math.max(1,u.inventoryCost),0);
      if(totalWeight<=0||qualifyingWeight<=0){periodExpense[m]+=amount;continue}
      const capAmount=amount*_clamp(qualifyingWeight/totalWeight,0,1),expenseAmount=amount-capAmount;
      capitalisedAdd[m]+=capAmount;periodExpense[m]+=expenseAmount;
      qualifying.forEach(u=>{capitalisedRelease[u.delivery]+=capAmount*Math.max(1,u.inventoryCost)/qualifyingWeight});
    }
  };
  allocateQualifyingCost(R.retax,R.retaxcapadd,R.retaxcaprel,R.retaxexp);
  allocateQualifyingCost(R.hoaexp,R.hoacapadd,R.hoacaprel,R.hoaexppl);
  allocateQualifyingCost(R.insurance,R.insurancecapadd,R.insurancecaprel,R.insuranceexp);
  /* Establishment fees are financing costs. Cash is paid on commitment; for P&L
     they are amortised over the expected facility life and subjected to the same
     qualifying-asset capitalisation test as interest and unused-line fees. */
  const processingFeeTotal=R.pf.reduce((a,b)=>a+b,0);let facilityEnd=facilityStart;
  for(let m=facilityStart;m<=NM;m++)if(R.lcl[m]>1e-6||R.dr1[m]>1e-6||R.dr2[m]>1e-6||R.rep[m]>1e-6||R.intr[m]>1e-6||R.lf[m]>1e-6)facilityEnd=m;
  const feeMonths=processingFeeTotal>0?Math.max(1,facilityEnd-facilityStart+1):0;
  if(feeMonths)for(let m=facilityStart;m<=facilityEnd;m++)R.pfamort[m]=processingFeeTotal/feeMonths;
  const financeAccrual=R.intr.map((v,m)=>v+R.lf[m]+R.pfamort[m]);
  allocateQualifyingCost(financeAccrual,R.fincapadd,R.fincaprel,R.finexp);
  const financePL=R.finexp.slice();
  const fys=[...new Set(Array.from({length:NM+1},(_,m)=>fyOf(m,d)))].sort(),by=row=>{const o={};fys.forEach(y=>o[y]=0);for(let m=0;m<=NM;m++)o[fyOf(m,d)]+=row[m];return o},B={};Object.keys(R).forEach(k=>B[k]=by(R[k]));B.dlv=by(dlv);B.ctr=by(ctr);
  const infraNet=R.infracogs.map((v,m)=>v+R.pidcogs[m]);
  /* No bundled Other Cost: every capitalised/expensed item is classified once in its named line. */
  const constructionPL=R.constructioncogs.map((v,m)=>v+R.insurancecaprel[m]+R.insuranceexp[m]);
  const capitalisedFinancePL=R.fincaprel.slice();
  const otherDirectPL=R.otherdirectcogs.slice();
  const gnaPL=R.gna.map((v,m)=>v+R.hoaexppl[m]+R.hoacaprel[m]);
  const realEstateTaxPL=R.retaxexp.map((v,m)=>v+R.retaxcaprel[m]);
  const netRevenueMonthly=R.recog.map((v,m)=>v-R.outputgst[m]);
  const rows={
    grossRev:by(R.recog),outputGst:by(R.outputgst),rec:by(netRevenueMonthly),gstCredit:by(R.gstcogs),pid:by(R.pid),otherIncomeManual:by(R.otherincome),
    land:by(R.landbasecogs),infra:by(infraNet),design:by(R.designcogs),authority:by(R.authoritycogs),construction:by(constructionPL),capitalisedFinance:by(capitalisedFinancePL),otherDirect:by(otherDirectPL),sell:by(R.sell),
    gna:by(gnaPL),gnaShared:by(R.gnashared),staff:by(R.staff),staffShared:by(R.staffshared),corp:by(R.corpovh),
    fin:by(financePL),da:by(R.da),marketing:by(R.marketing),realEstateTax:by(realEstateTaxPL),
    retaxCapitalised:by(R.retaxcaprel),hoaCapitalised:by(R.hoacaprel)
  },PL={},taxCorporate={},taxState={};let taxPaidVintages=[],lossVintages=[];
  const consumeLoss=(amount)=>{let left=amount;for(const v of lossVintages){const use=Math.min(v.amount,left);v.amount-=use;left-=use;if(left<=1e-9)break}lossVintages=lossVintages.filter(v=>v.amount>1e-9);return amount-left};
  fys.forEach(y=>{
    if(d.taxlossexp>0)lossVintages=lossVintages.filter(v=>y-v.year<=d.taxlossexp);
    const pidIncome=0,otherIncome=pidIncome+rows.otherIncomeManual[y];
    const acquisitionTotal=Math.max(1,land+closing+rollback+firb),landAllocated=rows.land[y];
    const landCost=landAllocated*land/acquisitionTotal,stampDuty=landAllocated*stamp/acquisitionTotal,foreignPurchaserSurcharge=landAllocated*surcharge/acquisitionTotal,firbCost=landAllocated*firb/acquisitionTotal,acquisitionCost=landAllocated*(acquisition+rollback+d.closingpc/100*landBase)/acquisitionTotal;
    const professionalTotal=dd+professional,dmTotal=developmentManagement,designTotal=Math.max(1,professionalTotal+dmTotal);
    const professionalFees=rows.design[y]*professionalTotal/designTotal,developmentManagementFees=rows.design[y]*dmTotal/designTotal;
    const constructionAndCont=Math.max(1,infTot+contTot),constructionCost=rows.infra[y]*infTot/constructionAndCont+rows.construction[y],contingencyCost=rows.infra[y]*contTot/constructionAndCont;
    const statutoryCost=rows.authority[y],capitalisedFinanceCost=rows.capitalisedFinance[y],otherDirectCost=rows.otherDirect[y];
    const sellingTotalRate=Math.max(1e-9,d.comm+d.sellingpc),brokerage=rows.sell[y]*d.comm/sellingTotalRate,sellingCost=rows.sell[y]*d.sellingpc/sellingTotalRate;
    const marketing=rows.marketing[y],holdingCost=rows.realEstateTax[y],inputGstCredit=rows.gstCredit[y];
    const dc=landCost+stampDuty+foreignPurchaserSurcharge+firbCost+acquisitionCost+constructionCost+professionalFees+developmentManagementFees+statutoryCost+contingencyCost+holdingCost+capitalisedFinanceCost+otherDirectCost+brokerage+sellingCost+marketing+inputGstCredit;
    const gp=rows.rec[y]-dc;
    const gna=rows.gna[y],gnaShared=rows.gnaShared[y],staff=rows.staff[y],staffShared=rows.staffShared[y],corpOverhead=rows.corp[y];
    const oh=gna+gnaShared+staff+staffShared+corpOverhead,fin=rows.fin[y],da=rows.da[y],realEstateTax=holdingCost;
    const npbt=gp-oh-fin-da+otherIncome;
    const taxGrossProfit=gp;
    const stateBase=d.staxbase===0?rows.rec[y]:d.staxbase===2?Math.max(0,npbt):Math.max(0,taxGrossProfit);
    const franchise=d.stax/100*stateBase;
    const corpBase=npbt-(d.staxdeduct?franchise:0);let corpTax=0;
    if(corpBase<0){
      let loss=-corpBase,recoveredTax=0;
      if(d.taxloss&&d.taxcarrybackyrs>0&&d.ftax>0){
        const rate=d.ftax/100,eligible=taxPaidVintages.filter(v=>y-v.year<=d.taxcarrybackyrs&&v.tax>1e-9).sort((a,b)=>b.year-a.year);
        for(const vintage of eligible){if(loss<=1e-9)break;const use=Math.min(loss,vintage.tax/rate),refund=use*rate;vintage.tax-=refund;loss-=use;recoveredTax+=refund}
        corpTax=-recoveredTax;
      }
      if(loss>1e-9)lossVintages.push({year:y,amount:loss})
    }else{
      const available=lossVintages.reduce((a,v)=>a+v.amount,0),maxUse=corpBase*d.taxlossutil/100,used=consumeLoss(Math.min(available,maxUse)),taxable=Math.max(0,corpBase-used);
      corpTax=d.ftax/100*taxable;if(corpTax>1e-9)taxPaidVintages.push({year:y,tax:corpTax})
    }
    const totalOverhead=oh+fin+da,totalTax=corpTax+franchise;
    taxCorporate[y]=corpTax;taxState[y]=franchise;
    PL[y]={grossRev:rows.grossRev[y],outputGst:rows.outputGst[y],rev:rows.rec[y],inputGstCredit,pidIncome,otherIncomeManual:rows.otherIncomeManual[y],otherIncome,
      landCost,stampDuty,foreignPurchaserSurcharge,firbCost,acquisitionCost,constructionCost,professionalFees,developmentManagementFees,statutoryCost,contingencyCost,holdingCost,capitalisedFinanceCost,otherDirectCost,brokerage,sellingCost,marketing,dc,gp,
      gna,gnaShared,staff,staffShared,corpOverhead,oh,fin,da,realEstateTax,franchise,totalOverhead,
      npbt,corporateTax:corpTax,tax:totalTax,cashTax:totalTax,npat:npbt-totalTax,ratio:L?B.dlv[y]/L:0}
  });
  fys.forEach(y=>{
    const months=[];for(let m=0;m<=NM;m++)if(fyOf(m,d)===y)months.push(m);if(!months.length)return;
    const yearEnd=months[months.length-1];
    if(!d.taxfreq){if(Math.abs(PL[y].cashTax)<=1e-9)return;const pay=yearEnd+d.taxlag;if(pay>NM)throw new Error("Annual tax payment falls beyond the model horizon.");R.taxm[pay]+=PL[y].cashTax;return}
    const proxy=months.map(m=>{
      const pidIncome=0,otherIncome=pidIncome+R.otherincome[m];
      const dc=R.landbasecogs[m]+R.infracogs[m]+R.pidcogs[m]+R.designcogs[m]+R.authoritycogs[m]+constructionPL[m]+capitalisedFinancePL[m]+otherDirectPL[m]+R.sell[m]+R.marketing[m]+realEstateTaxPL[m]+R.gstcogs[m];
      const gp=(R.recog[m]-R.outputgst[m])-dc;
      const oh=gnaPL[m]+R.gnashared[m]+R.staff[m]+R.staffshared[m]+R.corpovh[m];
      const npbt=gp-oh-financePL[m]-R.da[m]+otherIncome;
      const taxGrossProfit=gp;
      const stateBase=d.staxbase===0?R.recog[m]:d.staxbase===2?Math.max(0,npbt):Math.max(0,taxGrossProfit);
      const franchise=d.stax/100*stateBase;
      const corpBase=npbt-(d.staxdeduct?franchise:0);
      return Math.max(0,franchise+d.ftax/100*Math.max(0,corpBase))
    }),totalProxy=proxy.reduce((a,b)=>a+b,0);let cumulativeProxy=0,paid=0;
    const quarterEnds=[...new Set([2,5,8].map(i=>months[Math.min(i,months.length-1)]))].filter(m=>m<yearEnd);
    months.forEach((m,i)=>{cumulativeProxy+=proxy[i];if(!quarterEnds.includes(m))return;const target=PL[y].cashTax>0&&totalProxy>0?PL[y].cashTax*cumulativeProxy/totalProxy:0,payment=target-paid;if(Math.abs(payment)>1e-9){const pay=m+d.taxqlag;if(pay>NM)throw new Error("Quarterly tax payment falls beyond the model horizon.");R.taxm[pay]+=payment};paid+=payment});
    const trueUp=PL[y].cashTax-paid;if(Math.abs(trueUp)>1e-9){const pay=yearEnd+d.taxlag;if(pay>NM)throw new Error("Tax true-up falls beyond the model horizon.");R.taxm[pay]+=trueUp}
  });B.taxm=by(R.taxm);
  const baseCF=R.net.map((v,m)=>v-R.taxm[m]+R.dr1[m]+R.dr2[m]-R.rep[m]-R.intr[m]-R.pf[m]-R.lf[m]);let finalObligation=0;baseCF.forEach((v,i)=>{if(Math.abs(v)>1e-6||R.lcl[i]>1e-6)finalObligation=i});const reserveReq=new Array(NM+1).fill(0);for(let m=NM-1;m>=0;m--){const min=m<finalObligation?minimumCash:0;reserveReq[m]=Math.max(min,reserveReq[m+1]-baseCF[m+1])}let cash=0,equityOutstanding=0,reimbCapacity=0,peakEquity=0,peakEquityMonth=0;for(let m=0;m<=NM;m++){let before=cash+baseCF[m],minimum=m<finalObligation?minimumCash:0;if(before<minimum){R.eqin[m]=minimum-before;before=minimum}equityOutstanding+=R.eqin[m];reimbCapacity+=R.eqreimbcap[m];const free=Math.max(0,before-reserveReq[m]);const debtCleared=R.lcl[m]<=1e-6;let allowed=!d.distlock||debtCleared?free:Math.min(free,reimbCapacity,equityOutstanding);R.eqout[m]=Math.max(0,allowed);if(!debtCleared&&d.distlock)reimbCapacity=Math.max(0,reimbCapacity-R.eqout[m]);cash=before-R.eqout[m];R.cash[m]=cash;R.eqcf[m]=R.eqout[m]-R.eqin[m];equityOutstanding=Math.max(0,equityOutstanding-R.eqout[m]);if(equityOutstanding>peakEquity){peakEquity=equityOutstanding;peakEquityMonth=m}}B.eqcf=by(R.eqcf);B.eqin=by(R.eqin);B.eqout=by(R.eqout);B.cash=by(R.cash);
  const buildEquitySeries=base=>{const req=new Array(NM+1).fill(0);let last=0;base.forEach((v,i)=>{if(Math.abs(v)>1e-6||R.lcl[i]>1e-6)last=i});for(let m=NM-1;m>=0;m--){const min=m<last?minimumCash:0;req[m]=Math.max(min,req[m+1]-base[m+1])}const cf=new Array(NM+1).fill(0),ein=new Array(NM+1).fill(0),eout=new Array(NM+1).fill(0);let cash=0,outstanding=0,reimb=0,peak=0;for(let m=0;m<=NM;m++){let before=cash+base[m],minimum=m<last?minimumCash:0;if(before<minimum){ein[m]=minimum-before;before=minimum}outstanding+=ein[m];reimb+=R.eqreimbcap[m];const free=Math.max(0,before-req[m]),debtCleared=R.lcl[m]<=1e-6;let allowed=!d.distlock||debtCleared?free:Math.min(free,reimb,outstanding);eout[m]=Math.max(0,allowed);if(!debtCleared&&d.distlock)reimb=Math.max(0,reimb-eout[m]);cash=before-eout[m];cf[m]=eout[m]-ein[m];outstanding=Math.max(0,outstanding-eout[m]);peak=Math.max(peak,outstanding)}return {cf,ein,eout,peak,inj:ein.reduce((a,b)=>a+b,0),ret:eout.reduce((a,b)=>a+b,0)}};
  const preTaxBaseCF=R.net.map((v,m)=>v+R.dr1[m]+R.dr2[m]-R.rep[m]-R.intr[m]-R.pf[m]-R.lf[m]),preTaxEquity=buildEquitySeries(preTaxBaseCF);
  const cfKeys=["salescash","escin","cashtotal","cfgstrefund","cfoutputgst","cfland","cfinfra","cfpiddebt","cfcapex","cfconstruction","cfdesign","cfauthority","cfbrokerage","cfretax","cfohpaid","cftaxpaid","cffinance","cfdebtrepaid","cfdebtraised","cfequity","cfotherincome","cfequitydist","cfinputgstpaid",
    "cfrefresrev","cfrefgst","cfrefland","cfrefstamp","cfrefholding","cfreffirb","cfrefforeignstamp","cfrefconstruction","cfrefprofessional","cfrefdm","cfrefstatutory","cfrefcontingency","cfrefbrokerage","cfrefselling","cfrefmarketing","cfrefnetcash","cfrefdebt","cfrefdebtfinance","cfrefrepayment","cfrefprocessing","cfrefinterest","cfreflifetime","cfreffundingneed","cfrefequity","cfrefsurplus","cfrefprofit"];
  cfKeys.forEach(k=>R[k]=new Array(NM+1).fill(0));
  for(let m=0;m<=NM;m++){
    R.salescash[m]=d.escrow?R.balr[m]:R.dep[m]+R.balr[m];
    R.escin[m]=d.escrow?R.dep[m]:0;
    R.cashtotal[m]=R.cash[m]+R.escbal[m];
    R.cfgstrefund[m]=R.gstrefund[m];R.cfoutputgst[m]=R.outputgst[m];R.cfland[m]=R.land[m]+R.closing[m]+R.firb[m];
    R.cfinfra[m]=R.infra[m]+R.cont[m];
    R.cfpiddebt[m]=R.dd[m]+R.otherdirect[m]+R.pidprocess[m];
    R.cfcapex[m]=R.capex[m];
    R.cfconstruction[m]=R.build[m]+R.model[m]+R.insurance[m];
    R.cfdesign[m]=R.supervision[m]+R.design[m];
    R.cfauthority[m]=R.munic[m]+R.impact[m]+R.permit[m];
    R.cfbrokerage[m]=R.sellcash[m];
    R.cfretax[m]=R.retax[m];
    R.cfohpaid[m]=R.ovh[m]+R.marketing[m]+R.hoaexp[m];
    R.cftaxpaid[m]=R.taxm[m];
    R.cffinance[m]=R.intr[m]+R.pf[m]+R.lf[m];
    R.cfdebtrepaid[m]=R.rep[m];
    R.cfdebtraised[m]=R.dr1[m]+R.dr2[m];
    R.cfequity[m]=R.eqin[m]-R.eqout[m];
    R.cfotherincome[m]=R.otherincome[m];
    R.cfequitydist[m]=R.eqout[m];R.cfinputgstpaid[m]=R.inputgstpaid[m];

    /* Reference cashflow format supplied by the user. Costs are shown as positive
       requirements; debt draws are negative because they reduce the equity funding
       requirement. Every operating cash item is mapped exactly once. */
    const gstGrossFactor=d.costgstbasis===0?1+d.inputgst/100:1;
    const acquisitionOther=m===close?(acquisition+d.closingpc/100*landBase+rollback):0;
    R.cfrefresrev[m]=R.lsr[m]+R.otherincome[m];
    R.cfrefgst[m]=R.outputgst[m];
    R.cfrefland[m]=R.land[m]+acquisitionOther;
    R.cfrefstamp[m]=m===d.firbmonth?stamp:0;
    R.cfrefholding[m]=R.retax[m]+R.hoaexp[m];
    R.cfreffirb[m]=R.firb[m];
    R.cfrefforeignstamp[m]=m===d.firbmonth?surcharge:0;
    /* Statement presentation: Construction Cost is construction only. Model/display cost,
       capex, insurance and other development-cost classifications remain in their own engine buckets. */
    R.cfrefconstruction[m]=(d.vert?R.build[m]:R.infra[m])*gstGrossFactor-(d.vert?0:R.pid[m]);
    R.cfrefprofessional[m]=(R.dd[m]+R.professionalfee[m]+R.design[m])*gstGrossFactor;
    R.cfrefdm[m]=R.dmfee[m]*gstGrossFactor+R.ovh[m];
    R.cfrefstatutory[m]=R.munic[m]+R.impact[m]+(R.permit[m]+R.pidprocess[m]+R.otherdirect[m])*gstGrossFactor;
    R.cfrefcontingency[m]=R.cont[m]*gstGrossFactor;
    R.cfrefbrokerage[m]=R.brokeragecash[m]*gstGrossFactor;
    R.cfrefselling[m]=R.sellingexpensecash[m]*gstGrossFactor;
    R.cfrefmarketing[m]=R.marketing[m]*gstGrossFactor;
    const netRevenue=R.cfrefresrev[m]-R.cfrefgst[m],landCosts=R.cfrefland[m]+R.cfrefstamp[m]+R.cfrefholding[m]+R.cfreffirb[m]+R.cfrefforeignstamp[m],developmentCosts=R.cfrefconstruction[m]+R.cfrefprofessional[m]+R.cfrefdm[m]+R.cfrefstatutory[m]+R.cfrefcontingency[m],sellingCosts=R.cfrefbrokerage[m]+R.cfrefselling[m]+R.cfrefmarketing[m];
    /* Positive Net Cash Flow in this template means a funding requirement. Income
       tax has no separate row in the supplied layout, so actual cash tax is included
       in line 6 to keep Equity Needed / Net Surplus fully after-tax and reconciling. */
    R.cfrefnetcash[m]=landCosts+developmentCosts+sellingCosts-netRevenue-R.cfgstrefund[m]+R.cftaxpaid[m];
    R.cfrefdebt[m]=-R.dr1[m];R.cfrefdebtfinance[m]=-R.dr2[m];R.cfrefrepayment[m]=R.rep[m];
    R.cfrefprocessing[m]=R.pf[m];R.cfrefinterest[m]=R.intr[m];R.cfreflifetime[m]=R.lf[m];
    R.cfreffundingneed[m]=R.cfrefnetcash[m]+R.cfrefdebt[m]+R.cfrefdebtfinance[m]+R.cfrefrepayment[m]+R.cfrefprocessing[m]+R.cfrefinterest[m]+R.cfreflifetime[m];
    R.cfrefequity[m]=R.eqin[m];R.cfrefsurplus[m]=R.eqout[m];R.cfrefprofit[m]=R.eqout[m]-R.eqin[m];
  }
  cfKeys.forEach(k=>B[k]=by(R[k]));
  const S=k=>fys.reduce((a,y)=>a+PL[y][k],0),sum=k=>R[k].reduce((a,b)=>a+b,0),inj=sum("eqin"),ret=sum("eqout"),rm=Math.pow(1+d.r/100,1/12)-1,npv=R.net.reduce((a,v,m)=>a+v/Math.pow(1+rm,m),0),finTot=sum("intr")+sum("pf")+sum("lf");
  const cashflowStatementCheck=R.cashtotal.every((v,m)=>{
    const opening=m?R.cashtotal[m-1]:0;
    const inflow=R.cfequity[m]+R.cfdebtraised[m]+R.salescash[m]+R.escin[m]+R.pid[m]+R.cfotherincome[m]+R.cfgstrefund[m];
    const outflow=R.cfland[m]+R.cfinfra[m]+R.cfpiddebt[m]+R.cfcapex[m]+R.cfconstruction[m]+R.cfdesign[m]+R.cfauthority[m]+R.cfbrokerage[m]+R.cfretax[m]+R.cfohpaid[m]+R.cftaxpaid[m]+R.cffinance[m]+R.cfdebtrepaid[m]+R.cfoutputgst[m]+R.cfinputgstpaid[m];
    return Math.abs(v-(opening+inflow-outflow))<1;
  });
  const noActivityBefore=(row,month)=>row.slice(0,Math.max(0,month)).every(v=>Math.abs(v)<=1e-6);
  const firstTaxableActivity=R.recog.findIndex((v,m)=>Math.abs(v)+Math.abs(R.otherincome[m])+Math.abs(0)>1e-6);
  const modelChecks={
    noSalesBeforeLand:[R.sval,R.dep,R.recog,R.balr,R.lsr,R.salescash,R.escin].every(row=>noActivityBefore(row,close)),
    noDevelopmentBeforeLand:[R.cinf,R.cont,R.munic,R.impact,R.build,R.design,R.permit,R.model].every(row=>noActivityBefore(row,close)),
    entitlementSpendStartsAtDD:noActivityBefore(R.supervision,conceptStart)&&[R.pidprocess,R.otherdirect].every(row=>noActivityBefore(row,entStart)),
    noCarryBeforeLand:[R.retax,R.hoaexp,R.insurance].every(row=>noActivityBefore(row,close)),
    noOtherIncomeBeforeLand:noActivityBefore(R.otherincome,close),
    noDebtBeforeFacility:[R.dr1,R.dr2,R.pf,R.lf].every(row=>noActivityBefore(row,facilityStart)),
    noTaxBeforeTaxableActivity:firstTaxableActivity<0||noActivityBefore(R.taxm,firstTaxableActivity),
    noEquityDistributionBeforeLand:noActivityBefore(R.eqout,close),
    landCashAtClosing:R.land.every((v,m)=>landPaymentMonths(d).has(m)||Math.abs(v)<=1e-6)&&R.closing.every((v,m)=>m===close||m===d.firbmonth||Math.abs(v)<=1e-6)&&R.firb.every((v,m)=>m===d.firbmonth||Math.abs(v)<=1e-6),
    unitChronology:unitRecords.every(u=>u.contractMonth>=close&&u.delivery>=u.contractMonth&&(bpTimingProfile.length?u.delivery>=u.buildStart+Math.max(0,products[u.product].buildMonths-1):u.delivery>=phaseComplete[u.phase])&&(!V||u.buildStart>=u.contractMonth)),
    infrastructureAfterEntitlement:[R.cinf,R.cont,R.munic].every(row=>noActivityBefore(row,st)),
    unitsContracted:Math.abs(ctr.reduce((a,b)=>a+b,0)-L)<1e-6,unitsDelivered:Math.abs(dlv.reduce((a,b)=>a+b,0)-L)<1e-6,revenueRecognised:Math.abs(sum("recog")-sum("sval"))<1,collectionsEqualRevenue:Math.abs(sum("lsr")-sum("recog"))<1,operatingDebtRollForward:R.opcl.every((v,m)=>Math.abs(v-((m?R.opcl[m-1]:0)+R.dr1[m]-R.oprep[m]))<1),interestReserveDebtRollForward:R.intcl.every((v,m)=>Math.abs(v-((m?R.intcl[m-1]:0)+R.dr2[m]-R.intrep[m]))<1),debtComponents:R.lcl.every((v,m)=>Math.abs(v-R.opcl[m]-R.intcl[m])<1)&&R.rep.every((v,m)=>Math.abs(v-R.oprep[m]-R.intrep[m])<1),debtRollForward:R.lcl.every((v,m)=>Math.abs(v-((m?R.lcl[m-1]:0)+R.dr1[m]+R.dr2[m]-R.rep[m]))<1),interestReserveLimit:sum("dr2")<=reserve+1&&Math.max(...R.intcl)<=reserve+1,processingFeeBase:Math.abs(sum("pf")-(debtResult.operatingCommit>0?d.procf/100*debtResult.operatingCommit:0))<1,unusedLineFeeBase:R.lf.every((v,m)=>Math.abs(v-d.linef/100/12*R.opunused[m])<1),cashRollForward:R.cash.every((v,m)=>Math.abs(v-((m?R.cash[m-1]:0)+baseCF[m]+R.eqin[m]-R.eqout[m]))<1),profitToEquity:Math.abs((ret-inj)-(S("npat")+S("da")-sum("capex")))<1,developmentCostRecognition:Math.abs(sum("landcogs")+sum("concogs")+sum("pidcogs")+sum("vertcogs")+sum("othcogs")-(sum("devc")-pid))<1,financeRecognition:Math.abs(sum("fincaprel")+sum("finexp")-(sum("intr")+sum("pf")+sum("lf")))<1,financeCapitalisationMandatory:d.capfin===1,financeCapitalisationIncurred:Math.abs(sum("fincapadd")+sum("finexp")-(sum("intr")+sum("pf")+sum("lf")))<1,financeCapitalisationReleased:Math.abs(sum("fincaprel")-sum("fincapadd"))<1,financeCapitalisationCutoff:R.fincapadd.every((v,m)=>Math.abs(v)<=1e-6||unitRecords.some(u=>m<qualifyingEnd(u))),carryCapitalisationMandatory:d.capcarry===1,carryCostIncurred:Math.abs(sum("retaxcapadd")+sum("retaxexp")-sum("retax"))<1&&Math.abs(sum("hoacapadd")+sum("hoaexppl")-sum("hoaexp"))<1&&Math.abs(sum("insurancecapadd")+sum("insuranceexp")-sum("insurance"))<1,carryCostReleased:Math.abs(sum("retaxcaprel")-sum("retaxcapadd"))<1&&Math.abs(sum("hoacaprel")-sum("hoacapadd"))<1&&Math.abs(sum("insurancecaprel")-sum("insurancecapadd"))<1,carryCapitalisationCutoff:["retaxcapadd","hoacapadd","insurancecapadd"].every(k=>R[k].every((v,m)=>Math.abs(v)<=1e-6||unitRecords.some(u=>m<qualifyingEnd(u)))),eligibleBasisRecognition:Math.abs(sum("relbase")-finBase)<1,phaseUnitAllocation:ph.counts.reduce((a,b)=>a+b,0)===L,phaseCostAllocation:Math.abs(phaseActual.reduce((a,b)=>a+b,0)-(infTot+contTot+munic))<1,validNumbers:Object.values(R).every(row=>row.every(Number.isFinite)),facilityLimit:Math.max(...R.lcl)<=lim+1,phaseSalesReleased:unitRecords.every(u=>u.contractMonth>=globalOpen),phaseSettlementAfterCompletion:bpTimingProfile.length?unitRecords.every(u=>u.delivery>=u.buildStart+Math.max(0,products[u.product].buildMonths-1)):unitRecords.every(u=>u.delivery>=phaseComplete[u.phase]),phaseSettlementCadencePreserved:bpTimingProfile.length?true:activePhases.every(i=>{const us=unitsByPhase[i];if(!us.length)return true;if(V){const lag=Math.max(0,Math.round(d.dellag)),phaseLag=d[`ph${i+1}dellag`]>=0?Math.max(0,Math.round(d[`ph${i+1}dellag`])):0,firstBase=Math.min(...us.map(u=>u.contractMonth+lag)),target=phaseComplete[i]+phaseLag,shift=Math.max(0,target-firstBase);return us.every(u=>u.buildStart===u.contractMonth&&u.delivery===u.contractMonth+lag+shift)}const lag=Math.max(0,Math.round(d.dellag)),firstBase=Math.min(...us.map(u=>u.contractMonth+lag)),shift=Math.max(0,phaseComplete[i]-firstBase);return us.every(u=>u.delivery===u.contractMonth+lag+shift)}),globalSalesVelocity:bpTimingProfile.length?true:ctr.every(v=>v<=Math.ceil(projectRate)+1e-6),projectWideSalesContinuity:bpTimingProfile.length?true:ctr.every((v,m)=>{if(m<globalOpen)return v===0;const prior=Math.min(L,Math.floor(Math.max(0,m-globalOpen)*projectRate+1e-9)),through=Math.min(L,Math.floor(Math.max(0,m-globalOpen+1)*projectRate+1e-9));return v===through-prior}),productSalesVelocity:true,distributionLock:!d.distlock||R.eqout.every((v,m)=>v<=1e-6||R.lcl[m]<=1e-6||R.eqreimbcap.slice(0,m+1).reduce((a,b)=>a+b,0)+1>=R.eqout.slice(0,m+1).reduce((a,b)=>a+b,0)),pidInventoryMatching:Math.abs(sum("pidcogs")+pid)<1,
    cashflowStatement:cashflowStatementCheck,
    referenceCashflowMapping:R.cfrefnetcash.every((v,m)=>Math.abs(v-(-R.net[m]+R.taxm[m]))<1),
    referenceFundingMapping:R.cfreffundingneed.every((v,m)=>Math.abs(v-(-(R.net[m]-R.taxm[m]+R.dr1[m]+R.dr2[m]-R.rep[m]-R.intr[m]-R.pf[m]-R.lf[m])))<1),
    referenceEquityMapping:R.cfrefequity.every((v,m)=>Math.abs(v-R.eqin[m])<1)&&R.cfrefsurplus.every((v,m)=>Math.abs(v-R.eqout[m])<1)&&R.cfrefprofit.every((v,m)=>Math.abs(v-R.eqcf[m])<1),
    sellingCashSplit:R.sellcash.every((v,m)=>Math.abs(v-R.brokeragecash[m]-R.sellingexpensecash[m])<1),
    softCashSplit:R.supervision.every((v,m)=>Math.abs(v-R.professionalfee[m]-R.dmfee[m])<1),
    equityCashflow:R.eqcf.every((v,m)=>Math.abs(v-(R.eqout[m]-R.eqin[m]))<1),
    escrowRollForward:!d.escrow||R.escbal.every((v,m)=>Math.abs(v-((m?R.escbal[m-1]:0)+R.dep[m]-R.escr[m]))<1),
    externalSalesCash:Math.abs(sum("salescash")+sum("escin")-sum("recog"))<1,
    debtCashMapping:Math.abs(sum("cfdebtraised")-sum("dr1")-sum("dr2"))<1&&Math.abs(sum("cfdebtrepaid")-sum("rep"))<1,
    financeCostSingleCount:Math.abs(sum("cffinance")-sum("intr")-sum("pf")-sum("lf"))<1&&Math.abs(S("fin")+S("capitalisedFinanceCost")-sum("cffinance"))<1&&Math.abs(S("otherDirectCost")-sum("otherdirectcogs"))<1,
    taxCashRecognition:Math.abs(sum("taxm")-S("cashTax"))<1,
    grossProfitIdentity:Math.abs(S("gp")-(S("rev")-S("dc")))<1,
    overheadClassification:Math.abs(S("totalOverhead")-(S("oh")+S("fin")+S("da")))<1,
    pnlClassification:Math.abs(S("npat")-(S("rev")-S("dc")-S("totalOverhead")+S("otherIncome")-S("tax")))<1,
    directCostClassification:Math.abs(S("dc")-(sum("landbasecogs")+sum("infracogs")+sum("pidcogs")+sum("designcogs")+sum("authoritycogs")+sum("constructioncogs")+sum("insurancecaprel")+sum("insuranceexp")+sum("fincaprel")+sum("otherdirectcogs")+sum("sell")+sum("marketing")+sum("retaxcaprel")+sum("retaxexp")+sum("gstcogs")))<1,
    brokeragePLMatching:Math.abs(sum("sell")-(d.comm+d.sellingpc)/100*sum("recog"))<1,
    brokerageCashMatching:Math.abs(sum("sellcash")-sum("sell"))<1,
    capexCashMapping:Math.abs(sum("cfcapex")-sum("capex"))<1,
    depreciationWithinAsset:sum("da")<=sum("capex")+1&&Math.abs(sum("da")-sum("capex"))<1,
    noCapexBeforeLand:noActivityBefore(R.capex,close),
    overheadEndsWithProject:[R.gna,R.gnashared,R.staff,R.staffshared,R.corpovh].every(row=>row.every((v,m)=>m<=lastDlv||Math.abs(v)<=1e-6)),
    mandatoryAccountingPolicy:d.capfin===1&&d.capcarry===1&&d.pidacct===1&&d.staxdeduct===1,
    builderRiskStopsAtCompletion:R.insurance.every((v,m)=>Math.abs(v)<=1e-6||R.bradd.slice(0,m+1).reduce((a,b)=>a+b,0)-R.brcomplete.slice(0,m+1).reduce((a,b)=>a+b,0)>1e-6),
    physicalProductDimensions:products.every(p=>p.count<=0&&true||p.width>0)};
  const failed=Object.entries(modelChecks).filter(([,v])=>!v).map(([k])=>k);if(failed.length)throw new Error("Model reconciliation failed: "+failed.join(", "));
  const debtMaturityMonth=R.lcl.reduce((a,v,i)=>v>1e-6?i:a,0),lastMonth=Math.max(lastDlv,finalObligation),fixTot=sum("fixovh"),phaseSchedule=ph.counts.map((count,i)=>{const units=unitsByPhase[i],deliveries=units.map(u=>u.delivery);return {phase:i+1,start:phaseStart[i],end:phaseEnd[i],complete:phaseComplete[i],duration:ph.durations[i],lots:count,costShare:ph.costWeights[i],salesStart:null,salesEnd:null,realisationStart:deliveries.length?Math.min(...deliveries):null,realisationEnd:deliveries.length?Math.max(...deliveries):null,realisation:deliveries.length?Math.max(...deliveries):null,realisedLots:units.length,velocity:0,configuredVelocity:projectRate,sharedVelocity:true,products:matrix[i]}});
  const projectSales={start:Math.min(...unitRecords.map(u=>u.contractMonth)),end:finalContractMonth,rate:projectRate,total:L,monthly:ctr.slice()};
  return {d,fys,PL,R,B,NM,lim,land,infTot,contTot,pid,close,entStart,st,lastDlv,debtMaturityMonth,checks:modelChecks,vert:V,vst,vopen,vmonths:finalContractMonth-Math.min(...unitRecords.map(u=>u.contractMonth))+1,buaTot,buildBua:V?d.buildbua:0,buildTot:baseBuildTot,professionalTotal:professional,developmentManagementTotal:developmentManagement,designTot:0,permitTot:sum("permit"),vertTot:sum("vert1"),lag:V?Math.max(...products.map(p=>p.buildMonths)):d.dellag,revenue:sum("recog"),grossRevenue:sum("recog"),netRevenue:S("rev"),outputGst:sum("outputgst"),inputGstCredit:sum("gstrefund"),stampDuty:stamp,foreignPurchaserSurcharge:surcharge,firbCost:firb,acquisitionCost:acquisition,direct:S("dc"),gross:S("gp"),overhead:S("oh"),operatingOverhead:S("oh"),totalOperatingCost:S("totalOverhead"),finance:finTot,financeExpense:S("fin"),depreciation:S("da"),marketing:S("marketing"),realEstateTax:S("realEstateTax"),franchiseTax:S("franchise"),otherIncome:S("otherIncome"),npbt:S("npbt"),tax:S("tax"),cashTax:S("cashTax"),npat:S("npat"),margin:S("rev")?S("npat")/S("rev"):0,npv,irr:irr(R.net,12),eirr:irr(R.eqcf,12),eirrPreTax:irr(preTaxEquity.cf,12),eirrAfterTax:irr(R.eqcf,12),einjPreTax:preTaxEquity.inj,eretPreTax:preTaxEquity.ret,epeakPreTax:preTaxEquity.peak,pvl:land/Math.pow(1+rm,close),einj:inj,eret:ret,egain:ret-inj,epeak:peakEquity,epeakM:peakEquityMonth,liquidityPeak:peakEquity,cashEquityInjected:inj,cashEquityReturned:ret,moic:inj?ret/inj:0,peakdebt:Math.max(...R.lcl),loanEnd:R.lcl[NM],lots:L,fixovh:fixTot,escpeak:Math.max(...R.escbal),lastMonth,finBase,carry:sum("carry"),collections:sum("lsr"),finTot,ereqShare:finBase>0?peakEquity/finBase:0,finIncurred:finTot,interestReserve:reserve,operatingCommitment:debtResult.operatingCommit,facilityStart,financeCapitalised:sum("fincaprel"),financeCapitalisedIncurred:sum("fincapadd"),carryCapitalised:sum("retaxcaprel")+sum("hoacaprel")+sum("insurancecaprel"),actualBuild:sum("build"),actualDesign:sum("design"),actualPermit:sum("permit"),actualModel:sum("model"),landCogs:sum("landcogs"),conCogs:sum("concogs"),vertCogs:sum("vertcogs"),othCogs:sum("othcogs"),brokerCost:sum("sell"),brokerCash:sum("sellcash"),depreciableCapex:sum("capex"),
    pnlLandCost:S("landCost"),pnlInfraCost:S("infraCost"),pnlDesignCost:S("designCost"),pnlAuthorityCost:S("authorityCost"),pnlConstructionCost:S("constructionCost"),pnlCapitalisedFinanceCost:S("capitalisedFinanceCost"),pnlOtherDirectCost:S("otherDirectCost"),corporateTax:S("corporateTax"),
    pnlGna:S("gna"),pnlGnaShared:S("gnaShared"),pnlStaff:S("staff"),pnlStaffShared:S("staffShared"),pnlCorpOverhead:S("corpOverhead"),phaseSchedule,phaseMatrix:matrix,projectSales,contractCounts:ctr,settlementCounts:dlv,unitRecords};
}


/* Identical appraisals are reused across panes, parcel tabs and portfolio views.
   Base cases are retained separately from temporary scenario / solver variants so
   large sensitivity searches cannot evict the projects the user is actively using. */
const _baseRunCache=new Map(),_variantRunCache=new Map();
function run(din,ov){
  const baseKey=modelInputSignature(din),hasOv=!!(ov&&Object.keys(ov).length);
  const key=hasOv?baseKey+"\u001d"+overrideSignature(ov):baseKey;
  const cache=hasOv?_variantRunCache:_baseRunCache,hit=cacheGetLRU(cache,key);
  if(hit!==undefined)return hit;
  const value=_runUncached(din,ov);
  return cacheSetLRU(cache,key,value,hasOv?16:32);
}

/* ── solvers ─────────────────────────────────────────────────────────── */
const _cache=new Map();
function clearCache(){
  while(_cache.size>320)_cache.delete(_cache.keys().next().value);
  while(_variantRunCache.size>16)_variantRunCache.delete(_variantRunCache.keys().next().value);
  while(_baseRunCache.size>32)_baseRunCache.delete(_baseRunCache.keys().next().value);
  while(_deriveCache.size>64)_deriveCache.delete(_deriveCache.keys().next().value);
}
function parcelCacheKey(d,metric,target,overrides){const merged={...d,...(overrides||{})};return modelInputSignature(merged)+`|${metric}|${target}`}
function _crossings(evaluate,target,lo,hi,steps=96){const pts=[];let px=lo,pv=evaluate(lo);for(let i=1;i<=steps;i++){const x=lo+(hi-lo)*i/steps,v=evaluate(x);if(pv!=null&&v!=null){const a=pv-target,b=v-target;if(a===0)pts.push(px);if(a*b<0||b===0){let l=px,h=x,lv=a;for(let j=0;j<42;j++){const m=(l+h)/2,mv=evaluate(m);if(mv==null){h=m;continue}const z=mv-target;if(lv*z<=0)h=m;else{l=m;lv=z}}pts.push((l+h)/2)}}px=x;pv=v}return [...new Set(pts.map(v=>Math.round(v*1e8)/1e8))]}
function solveLand(d,metric,target,overrides){
  overrides=overrides||{};
  const key=parcelCacheKey(d,metric,target,overrides);if(_cache.has(key))return _cache.get(key);
  const evaluate=x=>{try{const v=run(d,{...overrides,pr:x})[metric];return Number.isFinite(v)?v:null}catch{return null}};
  const f0=evaluate(0);if(f0==null||f0<target){cacheSetLRU(_cache,key,null,320);return null}
  const current=Math.max(0,_num(overrides.pr!=null?overrides.pr:d.pr));
  let lo=0,flo=f0,hi=null,fhi=null;
  /* Start beside the current underwriting price instead of scanning a fixed
     A$1.2m/sqm range. This keeps the root bracket inside the valid model domain. */
  if(current>0){const fc=evaluate(current);if(fc!=null){if(fc>=target){lo=current;flo=fc}else{hi=current;fhi=fc}}}
  if(hi==null){
    hi=Math.max(lo+100,lo*1.6,1000);fhi=evaluate(hi);let guard=0;
    while(fhi!=null&&fhi>=target&&hi<1e8&&guard++<12){lo=hi;flo=fhi;hi=Math.max(hi+100,hi*1.6);fhi=evaluate(hi)}
  }
  /* If the model becomes invalid above the feasible price range, walk back to
     the last valid point instead of treating that invalid extreme as no solution. */
  if(fhi==null){let a=lo,fa=flo,b=hi,found=false;for(let i=0;i<12;i++){const m=(a+b)/2,fm=evaluate(m);if(fm==null){b=m;continue}if(fm<target){lo=a;flo=fa;hi=m;fhi=fm;found=true;break}a=m;fa=fm}if(!found){cacheSetLRU(_cache,key,null,320);return null}}
  if(fhi>=target){cacheSetLRU(_cache,key,hi,320);return hi}
  /* Safeguarded interpolation converges quickly once the valid bracket is known. */
  for(let i=0;i<16;i++){let x=lo+(target-flo)*(hi-lo)/(fhi-flo),pad=(hi-lo)*.04;if(!Number.isFinite(x)||x<=lo+pad||x>=hi-pad)x=(lo+hi)/2;const fx=evaluate(x);if(fx==null){hi=x;continue}if(fx>=target){lo=x;flo=fx}else{hi=x;fhi=fx}}
  const answer=(lo+hi)/2;cacheSetLRU(_cache,key,answer,320);return answer
}
function solveDriver(d,key,low,high,ignored,metric="npv",target=0){const evaluate=x=>{try{const v=run(d,{[key]:x})[metric];return Number.isFinite(v)?v:null}catch{return null}};const roots=_crossings(evaluate,target,low,high);if(!roots.length)return null;const cur=_num(d[key],(low+high)/2);return roots.sort((a,b)=>Math.abs(a-cur)-Math.abs(b-cur))[0]}
function solveLever(d,key,metric,target,lo,hi){return solveDriver(d,key,lo,hi,null,metric,target)}
const LINEAR={pidx:1};



/* ---- module interface ---- */
export {
  run, derive, solveDriver, solveLand, solveLever, irr, irrInfo, clearCache,
  GROUPS, DEF, DEF_KEYS, MAX_PRODUCTS, AUSTRALIA_MODEL_VERSION,
};
export default run;
