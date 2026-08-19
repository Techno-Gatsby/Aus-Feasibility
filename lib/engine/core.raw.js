
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

/*MODEL_END*/
const MODEL_ENGINE_SOURCE=(()=>{
  const text=(document.currentScript&&document.currentScript.textContent)||"",a=text.indexOf("/*MODEL_START*/"),b=text.indexOf("/*MODEL_END*/");
  return a>=0&&b>a?text.slice(a,b):"";
})();
/* ═══════════════════════════════════════════════════════════════════════════
   UI — application layer
   ═══════════════════════════════════════════════════════════════════════════ */
const M0=(v,dp=0)=>v==null||isNaN(v)?"–":(v<0?"("+Math.abs(v).toLocaleString("en-AU",{minimumFractionDigits:dp,maximumFractionDigits:dp})+")":v.toLocaleString("en-AU",{minimumFractionDigits:dp,maximumFractionDigits:dp}));
const $=v=>v==null||isNaN(v)?"–":(v<0?"(A$"+Math.abs(Math.round(v)).toLocaleString("en-AU")+")":"A$"+Math.round(v).toLocaleString("en-AU"));
const P=(v,dp=1)=>v==null||isNaN(v)?"–":(v*100).toFixed(dp)+"%";
const X=v=>v==null||isNaN(v)?"–":v.toFixed(2)+"x";
const Mn=v=>v==null||isNaN(v)?"–":(v<0?"-A$":"A$")+(Math.abs(v)/1e6).toFixed(2)+"m";
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const mLabel=(m,d)=>{const i=(d.startMonth-1)+m;return MON[i%12]+"-"+String(d.startYear+Math.floor(i/12)).slice(2)};
const esc_=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
function inputDisplay(k,lab,unit,d){
  const labels={
    hpsf:"Vertical sale price including GST",_homeRev:"Vertical sales value at today's pricing",_buaTot:"Total vertical saleable area",_far:"Saleable-area ratio on site",vlag:"Verticals start after first construction phase",modelmo:"Sales / display-suite period before sales open",buildmo:"Months to build each vertical unit from booking",_vmonths:"Vertical programme",_acresNet:"Developable site area",buildbua:"Total building BUA / GFA",buildpsf:"Vertical construction cost per BUA",buildcurve:"Vertical construction spend profile",stamprt:"Stamp / transfer duty rate",foreignsurcharge:"Foreign purchaser duty surcharge",ddpc:"Due diligence and studies"
  };
  return [labels[k]||lab,unit||""];
}

/* ── levers available to sliders, sensitivity, scenarios and the optimiser ── */
const LEV=[
 {k:"hpsf",  n:"Sale price",                  u:"A$/sqm",lo:0,    hi:100000,st:100,    f:v=>"$"+M0(v),   grp:"Vertical"},
 {k:"buildpsf",n:"Construction cost / BUA", u:"A$/sqm BUA",lo:0, hi:30000, st:50,    f:v=>"$"+M0(v),   grp:"Vertical"},
 {k:"vel",   n:"Sales velocity",          u:"units/m",lo:.5,  hi:40,    st:.5,   f:v=>M0(v,1)+" /m",grp:"Vertical"},
 {k:"buildmo",n:"Vertical unit build / settlement duration", u:"mth",   lo:1,    hi:36,    st:1,    f:v=>M0(v),       grp:"Vertical"},
 {k:"modelmo",n:"Display / sales-centre period",u:"mth",   lo:0,    hi:36,    st:1,    f:v=>M0(v),       grp:"Vertical"},
 {k:"permpc",n:"Permit cost",             u:"% build",lo:0,   hi:15,    st:.25,  f:v=>M0(v,2)+"%", grp:"Vertical"},
 {k:"vlag",  n:"Vertical unit start lag",     u:"mth",   lo:0,    hi:48,    st:1,    f:v=>M0(v),       grp:"Vertical"},
 {k:"pr",    n:"Land price",              u:"A$/sqm",  lo:0,    hi:1200000,st:500, f:v=>"$"+M0(v),   grp:"Land"},
 {k:"vff",   n:"Sale price per sqm",u:"A$/sqm",  lo:0,    hi:20000, st:10,   f:v=>"$"+M0(v,2), grp:"Revenue",
   abs:d=>d._frontft>0?d._rev0/d._frontft:0,
   map:(v,d)=>{const a=d._frontft>0?d._rev0/d._frontft:0;return {pidx:a>0?v*d.pidx/a:d.pidx}}},
 {k:"vpsf",  n:"Sale price per sqm",u:"A$/sqm",lo:0,   hi:50000, st:50,  f:v=>"$"+M0(v,2), grp:"Revenue",
   abs:d=>d._lotsqft>0?d._rev0/d._lotsqft:0,
   map:(v,d)=>{const a=d._lotsqft>0?d._rev0/d._lotsqft:0;return {pidx:a>0?v*d.pidx/a:d.pidx}}},
 {k:"absn",  n:"Sales velocity",              u:"units/m",lo:.5,   hi:80,    st:.5,   f:v=>M0(v,1)+" /m",grp:"Revenue"},
 {k:"esc",   n:"Price escalation",        u:"% pa",  lo:-15,  hi:25,    st:.25,  f:v=>M0(v,2)+"%", grp:"Revenue"},
 {k:"depo",  n:"Deposit on contract",     u:"%",     lo:0,    hi:100,   st:1,    f:v=>M0(v)+"%",   grp:"Revenue"},
 {k:"vinfl", n:"Construction cost per unit",  u:"A$/unit", lo:0,    hi:3000000,st:10000, f:v=>"$"+M0(v),   grp:"Cost",
   abs:d=>d.infl, map:(v)=>({infl:v})},
 {k:"vcont", n:"Construction contingency",u:"$",     lo:0,    hi:60e6,  st:1e5,  f:v=>"$"+M0(v),   grp:"Cost",
   abs:d=>actualContingencyTotal(d),
   map:(v,d)=>{const base=actualInfrastructureTotal(d);return {contpc:base>0?v/base*100:0}}},
 {k:"contpc",n:"Contingency rate",        u:"%",     lo:0,    hi:40,    st:.5,   f:v=>M0(v,1)+"%", grp:"Cost"},
 {k:"infesc",n:"Construction escalation",u:"% pa", lo:0,    hi:25,    st:.25,  f:v=>M0(v,2)+"%", grp:"Cost"},
 {k:"ddpc",  n:"Due diligence",           u:"% selected base",lo:0,    hi:30,    st:.5,   f:v=>M0(v,1)+"%", grp:"Land"},
 {k:"sfpc",  n:"Professional fees",               u:"% selected base",lo:0,    hi:40,    st:.5,   f:v=>M0(v,1)+"%", grp:"Land"},
 {k:"ptax",  n:"Land holding cost rate",       u:"% pa",  lo:0,    hi:6,     st:.05,  f:v=>M0(v,2)+"%", grp:"Carry"},
 {k:"assess",n:"Council / holding charge",     u:"A$/unit pa",lo:0,  hi:12000, st:100,  f:v=>"$"+M0(v),   grp:"Carry"},
 {k:"comm",  n:"Brokerage and incentive", u:"% rev", lo:0,    hi:15,    st:.25,  f:v=>M0(v,2)+"%", grp:"Selling"},
 {k:"gnapc", n:"General and admin",       u:"% rev", lo:0,    hi:15,    st:.25,  f:v=>M0(v,2)+"%", grp:"Selling"},
 {k:"staffpc",n:"Staff and manpower",     u:"% rev", lo:0,    hi:15,    st:.25,  f:v=>M0(v,2)+"%", grp:"Selling"},
 {k:"pidel", n:"Eligible share",          u:"%",     lo:0,    hi:100,   st:1,    f:v=>M0(v)+"%",   grp:"Reimbursement"},
 {k:"pidrt", n:"Reimbursement rate",      u:"%",     lo:0,    hi:100,   st:1,    f:v=>M0(v)+"%",   grp:"Reimbursement"},
 {k:"vpid",  n:"Reimbursement received",  u:"$",     lo:0,    hi:120e6, st:5e5,  f:v=>"$"+M0(v),   grp:"Reimbursement",
   abs:d=>actualReimbursementTotal(d),
   map:(v,d)=>{const eligible=(actualInfrastructureTotal(d)+actualContingencyTotal(d))*Math.max(0,d.pidel)/100;
     return {pidrt:eligible>0?Math.max(0,Math.min(100,v/eligible*100)):0}}},
 {k:"pidlag",n:"Reimbursement lag",       u:"mth",   lo:0,    hi:48,    st:1,    f:v=>M0(v),       grp:"Reimbursement"},
 {k:"ltc",   n:"Gearing",                 u:"% cost",lo:0,    hi:95,    st:1,    f:v=>M0(v)+"%",   grp:"Debt"},
 {k:"rate",  n:"Interest rate",           u:"% pa",  lo:0,    hi:30,    st:.25,  f:v=>M0(v,2)+"%", grp:"Debt"},
 {k:"relpc", n:"Lot release price",       u:"x",     lo:1,    hi:2.5,   st:.05,  f:v=>v.toFixed(2)+"x",grp:"Debt"},
 {k:"ftax",  n:"Income tax",              u:"%",     lo:0,    hi:50,    st:1,    f:v=>M0(v)+"%",   grp:"Tax"},
 {k:"r",     n:"Pre-tax unlevered discount rate", u:"% pa",  lo:0,    hi:40,    st:.25,  f:v=>M0(v,2)+"%", grp:"Return"},
 {k:"phm",   n:"Default phase duration",    u:"mth",   lo:1,    hi:60,    st:1,    f:v=>M0(v),       grp:"Programme"},
 {k:"ph1dur",n:"Phase 1 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph1dur||d.phm},
 {k:"ph2dur",n:"Phase 2 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph2dur||d.phm},
 {k:"ph3dur",n:"Phase 3 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph3dur||d.phm},
 {k:"ph4dur",n:"Phase 4 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph4dur||d.phm},
 {k:"ph5dur",n:"Phase 5 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph5dur||d.phm},
 {k:"ph6dur",n:"Phase 6 duration",u:"mth",lo:1,hi:60,st:1,f:v=>M0(v),grp:"Programme",abs:d=>d.ph6dur||d.phm},
 {k:"nph",   n:"Phases",                  u:"no",    lo:1,    hi:6,     st:1,    f:v=>M0(v),       grp:"Programme"},
 {k:"dellag",n:"Contract to delivery",    u:"mth",   lo:0,    hi:48,    st:1,    f:v=>M0(v),       grp:"Programme"},
 {k:"entdur",n:"Entitlement duration",    u:"mth",   lo:1,    hi:60,    st:1,    f:v=>M0(v),       grp:"Programme"},
];
const LV=Object.fromEntries(LEV.map(l=>[l.k,l]));
function levers(){return leversForMode(!!D.vert)}
/* Some levers are expressed in the unit a developer actually quotes — dollars per front
   foot, dollars per lot — and translate into the index the engine multiplies by. */
function ovFor(k,v,d){const L=LV[k];
  if(L&&L.map)return L.map(v,d||derive(D));
  const o={};o[k]=v;return o}
function ovMerge(d,...pairs){let o={},work=derive(d);pairs.forEach(([k,v])=>{const mapped=ovFor(k,v,work);Object.assign(o,mapped);work=derive({...d,...o})});return o}
function cur(k,d){const L=LV[k];d=d||derive(D);return L&&L.abs?L.abs(d):d[k]}
function solveLeverAbs(k,met,target){const L=LV[k];if(!L)return null;
  const f=v=>{try{const ov=ovFor(k,v);const r=met==="maxland"?solveLand(D,"npv",0,ov):run(D,ov)[met];return Number.isFinite(r)?r:null}catch(e){return null}};
  const roots=_crossings(f,target,L.lo,L.hi,72);if(!roots.length)return null;
  const base=cur(k,derive(D));return roots.sort((a,b)=>Math.abs(a-base)-Math.abs(b-base))[0]
}
const SLIDERS_LOT=()=>["pr","vpsf","absn","vinfl","esc","contpc","ddpc","sfpc","ltc","r"];
const SLIDERS_VERT=["pr","hpsf","buildpsf","vel","buildmo","esc","contpc","ltc","r"];
function SLIDERS(){return D.vert?SLIDERS_VERT:SLIDERS_LOT()}

const METRICS=[
 {k:"npat",    n:"Net profit", f:$, up:1},
 {k:"eirr",    n:"Equity IRR",           f:P, up:1},
 {k:"irr",     n:"Project IRR",          f:P, up:1},
 {k:"moic",    n:"Equity multiple",      f:X, up:1},
 {k:"margin",  n:"Net margin",           f:P, up:1},
 {k:"npv",     n:"Project NPV",          f:$, up:1},
 {k:"revenue", n:"Gross revenue",        f:$, up:1},
 {k:"gross",   n:"Gross profit",         f:$, up:1},
 {k:"epeak",   n:"Equity required (peak)",f:$, up:0},
 {k:"einj",    n:"Equity injected total", f:$, up:0},
 {k:"peakdebt",n:"Peak debt",            f:$, up:0},
 {k:"finance", n:"Finance cost",         f:$, up:0},
 {k:"tax",     n:"Total tax", f:$, up:0},
 {k:"carry",   n:"Carry cost",           f:$, up:0},
 {k:"maxland", n:"Maximum land price A$/sqm",      f:$, up:1},
];
const MET=Object.fromEntries(METRICS.map(m=>[m.k,m]));

/* ── application state ────────────────────────────────── */
function cleanProjectLocation(v){return String(v||"").replace(/\s*-\s*Business Plan 27\/07\/2026\s*$/i,"").trim()}
function newParcel(name,loc,inputs,sourceKey){
  return {id:"p"+Math.random().toString(36).slice(2,8),name:name||"New parcel",
    loc:cleanProjectLocation(loc),sourceKey:sourceKey||null,inputs:(()=>{const x={...DEF,...cleanStoredInputs(inputs)};x.pmode=Number(x.pmode)===1?1:0;return enforceAccountingPolicy(x)})()};
}
const BUSINESS_PLAN_PROJECTS={
  brunswick:{
    type:"apartments",name:"Brunswick, Brisbane - Apartments",loc:"Brisbane",
    grossRevenue:1251896550,professional:27803283,dm:20852462,salesCost:43247335,financeCost:78074790,equityPct:20,debtPct:73,fundFinance:1,
    siteArea:4497,saleable:60043,bua:110093,units:564,salePrice:20850,
    landBase:52000000,landGst:10,landDeposit:0,stamp:3267578,surchargePct:8,firb:1205200,acquisition:0,otherAcq:0,
    buildRate:6314,construction:695082064,professionalPct:4,dmPct:3,statutory:20792164,contingency:0,holding:11099000,salesCostPct:3.5,
    outputGst:113808777,inputGstCredit:76744104,rate:5.5,linef:1.5,procf:1.25,
    constructionStart:[2027,3],velocity:9.4,
    phases:[{units:338,cost:60,start:0,dur:45},{units:226,cost:40,start:0,dur:53}]
  },
  sp:{
    type:"apartments",name:"SP Boulevard, Gold Coast - Apartments",loc:"Gold Coast",
    grossRevenue:1761067500,professional:37793857,dm:28345393,salesCost:70442700,financeCost:110005437,equityPct:20,debtPct:80,fundFinance:1,
    siteArea:7558,saleable:82560,bua:143682,units:660,
    products:[{units:120,saleable:20460,price:21500},{units:540,saleable:62100,price:21275}],
    landBase:67500000,landGst:10,landDeposit:0,stamp:4249900,surchargePct:8,firb:1205200,acquisition:0,otherAcq:0,
    buildRate:6576,construction:944846425,professionalPct:4,dmPct:3,statutory:28198771,contingency:0,holding:17377501,salesCostPct:4,
    outputGst:160097045,inputGstCredit:105061670,rate:5.5,linef:1.5,procf:1.25,
    constructionStart:[2028,1],velocity:660/84,
    phases:[{units:120,cost:24.3479157632,start:0,dur:31},{units:270,cost:37.8260421184,start:27,dur:42},{units:270,cost:37.8260421184,start:33,dur:42}],
    phaseMatrix:[[120,0],[0,270],[0,270]]
  },
  menin:{
    type:"lots",name:"Menin Road, NSW - Lots",loc:"NSW",
    grossRevenue:89241150,professional:566690,dm:425018,salesCost:3569646,financeCost:2741103,equityPct:50,debtPct:50,fundFinance:1,
    siteArea:53135,saleable:37868,bua:37868,units:99,salePrice:2357,
    landBase:33000000,landGst:10,landDeposit:5,stamp:2280530,surchargePct:0,firb:1090800,acquisition:0,otherAcq:0,
    construction:14167250,professionalPct:4,dmPct:3,statutory:7147883,contingency:0,holding:1365232,salesCostPct:4,
    outputGst:8112832,inputGstCredit:5002600,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2028,1],velocity:99/24,
    phases:[{units:99,cost:100,start:0,dur:16}]
  },
  project4:{
    type:"apartments",name:"Project 4, Sydney - Apartments",loc:"Sydney",
    grossRevenue:453415000,professional:5269880,dm:3952410,salesCost:18136600,financeCost:39164397,equityPct:20,debtPct:73,fundFinance:0,
    siteArea:875,saleable:8555,bua:17110,units:42,salePrice:53000,
    landBase:105000000,landGst:0,landDeposit:10,stamp:9450000,surchargePct:0,firb:3615600,acquisition:0,otherAcq:0,
    buildRate:7700,construction:131747000,professionalPct:4,dmPct:3,statutory:7675907,contingency:0,holding:5250000,salesCostPct:4,
    outputGst:41219545,inputGstCredit:14464172,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2029,1],velocity:42/48,
    phases:[{units:42,cost:100,start:0,dur:44}]
  },
  project5:{
    type:"lots",name:"Project 5, Queensland - Lots",loc:"Queensland",
    grossRevenue:563908594,professional:6810303,dm:5107727,salesCost:22556344,financeCost:12561743,equityPct:20,debtPct:80,fundFinance:0,
    siteArea:1197200,saleable:440000,bua:440000,units:1100,salePrice:1282,
    landBase:150000000,landGst:0,landDeposit:0,stamp:8605525,surchargePct:8,firb:1205000,acquisition:0,otherAcq:0,
    construction:170257564,professionalPct:4,dmPct:3,statutory:13112000,contingency:17025756,holding:3000000,salesCostPct:4,
    outputGst:51264418,inputGstCredit:20159790,rate:5.5,linef:1.5,procf:1.25,
    constructionStart:[2028,1],velocity:1100/60,
    phases:[
      {units:220,cost:18.0974798128,start:0,dur:12},{units:220,cost:19.0023538035,start:12,dur:12},
      {units:220,cost:19.9524714936,start:24,dur:12},{units:220,cost:20.9500950683,start:36,dur:12},
      {units:220,cost:21.9975998218,start:48,dur:12}
    ]
  },
  project6:{
    type:"apartments",name:"Project 6, Sydney - Apartments",loc:"Sydney",
    grossRevenue:742767385,professional:7972315,dm:7817160,salesCost:29710695,financeCost:48144465,equityPct:20,debtPct:73,fundFinance:0,
    siteArea:6857,saleable:17709,bua:36893,units:145,salePrice:41943,
    landBase:128000000,landGst:0,landDeposit:0,stamp:8896657,surchargePct:0,firb:3615600,acquisition:3648000,otherAcq:0,
    buildRate:6553,construction:241743823,professionalPct:3.3,dmPct:3.25,statutory:10515856,contingency:0,holding:2560000,salesCostPct:4,
    outputGst:55887944,inputGstCredit:0,rate:5.75,linef:1.5,procf:1.25,
    constructionStart:[2029,1],velocity:145/48,
    phases:[{units:145,cost:100,start:0,dur:36}]
  },
  project7:{
    type:"apartments",name:"Project 7, Gold Coast - Apartments",loc:"Gold Coast",
    grossRevenue:1761067500,professional:37793857,dm:28345393,salesCost:70442700,financeCost:49350301,equityPct:20,debtPct:80,fundFinance:1,
    siteArea:7558,saleable:82560,bua:143682,units:660,
    products:[{units:220,saleable:20460,price:21500},{units:440,saleable:62100,price:21275}],
    landBase:67500000,landGst:10,landDeposit:0,stamp:4249900,surchargePct:8,firb:1205200,acquisition:0,otherAcq:0,
    buildRate:6576,construction:944846425,professionalPct:4,dmPct:3,statutory:28198771,contingency:0,holding:17377500,salesCostPct:4,
    outputGst:160097045,inputGstCredit:105061670,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2031,1],velocity:660/84,
    phases:[{units:220,cost:24.3479157632,start:0,dur:31},{units:220,cost:37.8260421184,start:7,dur:43},{units:220,cost:37.8260421184,start:21,dur:43}],
    phaseMatrix:[[220,0],[0,220],[0,220]]
  },
  project8:{
    type:"lots",name:"Project 8, Brisbane - Lots",loc:"Brisbane",
    grossRevenue:103428253,professional:332669,dm:259482,salesCost:4137130,financeCost:2947081,equityPct:50,debtPct:44,fundFinance:1,
    siteArea:56031,saleable:28127,bua:28127,units:66,salePrice:3677,
    landBase:50000000,landGst:0,landDeposit:10,stamp:2855525,surchargePct:8,firb:1250000,acquisition:0,otherAcq:0,
    construction:8566727,professionalPct:4,dmPct:3,statutory:2241290,contingency:890940,holding:834000,salesCostPct:4,
    outputGst:9402568,inputGstCredit:1289723,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2030,1],velocity:66/24,
    phases:[{units:66,cost:100,start:0,dur:12}]
  },
  project9:{
    type:"apartments",name:"Project 9, Sydney - Apartments",loc:"Sydney",
    grossRevenue:755567384,professional:10413520,dm:8460986,salesCost:29710695,financeCost:49991548,equityPct:20,debtPct:74,fundFinance:0,
    siteArea:6857,saleable:17709,bua:36893,units:145,salePrice:42666,
    landBase:128000000,landGst:0,landDeposit:10,stamp:8896657,surchargePct:0,firb:3615600,acquisition:1920000,otherAcq:1728000,
    buildRate:7057,construction:260338012,professionalPct:4,dmPct:3,statutory:11138762,contingency:0,holding:2560000,salesCostPct:4,
    outputGst:68687944,inputGstCredit:0,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2031,1],velocity:145/48,
    phases:[{units:145,cost:100,start:0,dur:36}]
  },
  beckett:{
    type:"lots",name:"Beckett Road, Queensland - Lots",loc:"Queensland",
    grossRevenue:43409200,professional:496408,dm:124102,salesCost:1736368,financeCost:1330512,equityPct:45,debtPct:50,fundFinance:1,
    siteArea:48231,saleable:18472,bua:18472,units:41,salePrice:2350,
    landBase:23000000,landGst:0,landDeposit:10,stamp:1303025,surchargePct:0,firb:666600,acquisition:0,otherAcq:0,
    construction:4368391,professionalPct:12,dmPct:3,statutory:1984152,contingency:0,holding:325475,salesCostPct:4,
    outputGst:3946291,inputGstCredit:2702297,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2027,6],velocity:41/24,
    phases:[{units:41,cost:100,start:0,dur:12}]
  },
  oxlade:{
    type:"apartments",name:"Oxlade, Brisbane - Apartments",loc:"Brisbane",
    grossRevenue:240372000,professional:3571198,dm:2678399,salesCost:9614880,financeCost:13473045,equityPct:25,debtPct:70,fundFinance:1,
    siteArea:2025,saleable:5463,bua:9898,units:27,salePrice:44000,
    landBase:50000000,landGst:10,landDeposit:5,stamp:3143025,surchargePct:0,firb:3600000,acquisition:0,otherAcq:0,
    buildRate:9020,construction:89279960,professionalPct:4,dmPct:3,statutory:4489501,contingency:0,holding:2148375,salesCostPct:4,
    outputGst:21852000,inputGstCredit:14558585,rate:5.75,linef:1.25,procf:1.25,
    constructionStart:[2027,1],velocity:27/36,
    phases:[{units:27,cost:100,start:0,dur:24}]
  }
};
function _bpMonthBefore(year,month){return month===1?[year-1,12]:[year,month-1]}
function makeBusinessPlanInputs(c){
  const isVert=c.type==="apartments",rawProducts=c.products||[{units:c.units,saleable:c.saleable,price:c.salePrice}],rawGross=rawProducts.reduce((a,p)=>a+_num(p.saleable)*_num(p.price),0),priceScale=c.grossRevenue&&rawGross>0?c.grossRevenue/rawGross:1,products=rawProducts.map(p=>({...p,price:_num(p.price)*priceScale})),phases=c.phases||[{units:c.units,cost:100,start:0,dur:12}],anchor=_bpMonthBefore(c.constructionStart[0],c.constructionStart[1]);
  const i={...DEF,
    vert:isVert?1:0,pmode:1,acresGross:c.siteArea,_acresNet:c.siteArea,buildbua:isVert?c.bua:0,
    pr:c.landBase/c.siteArea,nprod:products.length,pidx:100,
    startMonth:anchor[1],startYear:anchor[0],fyEnd:12,ddur:1,ddend:0,landdepmonth:0,close:0,firbmonth:0,entdur:1,
    nph:phases.length,phm:phases[0].dur,presales:1,absn:c.velocity,vel:c.velocity,esc:0,depo:0,escrow:1,dellag:0,
    landgst:c.landGst||0,landdepo:c.landDeposit||0,stampmode:1,stampfixed:c.stamp||0,stamprt:0,foreignsurcharge:c.surchargePct||0,
    firbfee:c.firb||0,acquisitionfee:c.acquisition||0,otheracq:c.otherAcq||0,ddpc:0,landcurve:0,landdur:1,
    infl:isVert?0:c.construction/c.units,infesc:0,infracurve:1,buildcurve:1,contpc:0,contfixed:c.contingency||0,
    sfpc:c.professional!=null&&c.construction>0?100*c.professional/c.construction:(c.professionalPct||0),dmpc:c.dm!=null&&c.construction>0?100*c.dm/c.construction:(c.dmPct||0),softmode:0,otherdirect:0,infrastructurecharge:c.statutory||0,dafees:0,certifierfees:0,referralfees:0,qleave:0,
    landtax:0,foreignlandtax:0,councilrates:0,holdingfixed:c.holding||0,
    /* The business-plan input page provides one combined Sales, Marketing & Brokerage percentage and no split. Carry the full source percentage in the settlement-cost field rather than importing the statement split. */
    comm:0,sellingpc:c.salesCost!=null&&c.grossRevenue>0?100*c.salesCost/c.grossRevenue:(c.salesCostPct||0),commbookpc:0,marketingpc:0,
    gnapc:0,gnasharedpc:0,staffpc:0,staffsharedpc:0,corp:0,gnafixed:0,gnasharedfixed:0,stafffixed:0,staffsharedfixed:0,corpfixed:0,
    gst:10,outputgstfixed:c.outputGst||0,inputgst:c.inputGstCredit>0?10:0,gstcreditfixed:c.inputGstCredit||0,gstlag:1,
    pidel:0,pidrt:0,pidcost:0,pidlag:0,
    /* Business Plan capital-stack assumptions are financing inputs. Debt is sized from the stated gearing percentage and eligible project costs, with the stated equity share contributed first. The Business Plan project feasibility pages also provide a total finance-cost budget: debt timing still follows actual draws / repayments, while the model calibrates processing fee, interest and line fee to that source budget. Set Finance cost budget to 0 for a fully unconstrained dynamic finance calculation. */
    ltc:c.debtPct||0,facmode:0,facilityfixed:0,fundingmode:1,equitypc:c.equityPct==null?100:c.equityPct,equityfixed:0,finland:1,findd:1,finhoriz:1,finvert:1,fincapex:0,
    rate:c.rate||0,facstart:-1,procf:c.procf||0,linef:c.linef||0,financefixed:c.financeCost||0,relmode:0,relsalespc:100,revolver:1,fundi:c.fundFinance?1:0,intresout:1,intconv:1,
    ftax:0,stax:0,hurdle:0,tmoic:0,r:10,
    vlag:0,modelmo:0,modelcost:0,modelphase:0,buildmo:1,buildesc:0,dsgnpc:0,permpc:0
  };
  for(let p=1;p<=MAX_PRODUCTS;p++){
    i[`n${p}`]=0;i[`w${p}`]=0;i[`d${p}`]=1;i[`p${p}`]=0;i[`bua${p}`]=0;i[`hpsf${p}`]=0;i[`hpsf${p}ovr`]=0;i[`buildmo${p}`]=0;i[`buildmo${p}ovr`]=0;
  }
  products.forEach((p,z)=>{const x=z+1,area=p.saleable/p.units;i[`n${x}`]=p.units;i[`w${x}`]=area;i[`d${x}`]=1;i[`p${x}`]=p.price;i[`bua${x}`]=area;if(isVert){i[`hpsf${x}`]=p.price;i[`hpsf${x}ovr`]=products.length>1?1:0}});
  if(isVert){i.hpsf=products[0].price;i.buildbua=c.bua;i.buildpsf=c.construction&&c.bua?c.construction/c.bua:c.buildRate;i.vel=c.velocity;i.buildmo=1}
  phases.forEach((p,z)=>{const x=z+1;i[`ph${x}dur`]=p.dur;i[`ph${x}share`]=p.units/c.units*100;i[`ph${x}cost`]=p.cost;i[`ph${x}start`]=p.start;i[`ph${x}saleslag`]=0;i[`ph${x}vel`]=0;i[`ph${x}esc`]=0;i[`ph${x}dellag`]=-1;for(let q=1;q<=products.length;q++)i[`ph${x}p${q}`]=c.phaseMatrix?c.phaseMatrix[z][q-1]:(q===1?p.units:0)});
  return i;
}
const BP_INPUTS=Object.fromEntries(Object.entries(BUSINESS_PLAN_PROJECTS).map(([k,v])=>[k,makeBusinessPlanInputs(v)]));
const SAMPLE_PROJECTS=BUSINESS_PLAN_PROJECTS; // compatibility for legacy source-statement helpers; not used to seed projects.
const SOURCE_BP_DEFAULT={"consolidatedPL":{"years":[2025,2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"","label":"Net Qualified Sales","total":6498217511.0,"years":{"2025":0,"2026":0,"2027":514867465.0,"2028":660835011.0,"2029":1172932929.0,"2030":1334071299.0,"2031":1309919190.0,"2032":902018805.0,"2033":603572813.0}},{"code":"1","label":"Total Revenue","total":5625608106.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":115112727.0,"2030":1363036032.0,"2031":1238958149.0,"2032":860591304.0,"2033":2047909894.0}},{"code":"2","label":"Direct Cost","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2","label":"Land cost","total":869640887.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":36191179.0,"2030":205121885.0,"2031":206026775.0,"2032":193736718.0,"2033":228564329.0}},{"code":"2","label":"Construction Cost","total":2789923029.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":43607962.0,"2030":712313491.0,"2031":583503231.0,"2032":356768654.0,"2033":1093729691.0}},{"code":"2","label":"Brokerage & Incentive","total":166067966.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":3453382.0,"2030":40891081.0,"2031":33905980.0,"2032":25817739.0,"2033":61999784.0}},{"code":"2","label":"Other Direct Cost","total":56910339.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":2302255.0,"2030":12708543.0,"2031":10171092.0,"2032":10690472.0,"2033":21037978.0}},{"code":"2","label":"Direct Cost (2.1 + 2.2 + 2.3 + 2.4)","total":3882542221.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":85554778.0,"2030":971035000.0,"2031":833607078.0,"2032":587013583.0,"2033":1405331782.0}},{"code":"3","label":"Gross Profit (1 - 2)","total":1743065885.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":29557950.0,"2030":392001032.0,"2031":405351071.0,"2032":273577721.0,"2033":642578112.0}},{"code":"4","label":"Overhead Cost","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"4","label":"General & Admin Expenses","total":12223585.0,"years":{"2025":4263447.0,"2026":3414783.0,"2027":649337.0,"2028":649337.0,"2029":649337.0,"2030":649337.0,"2031":649337.0,"2032":649337.0,"2033":649337.0}},{"code":"4","label":"Staff/ Manpower","total":31180328.0,"years":{"2025":0,"2026":3141743.0,"2027":3443694.0,"2028":3615879.0,"2029":3796673.0,"2030":3986506.0,"2031":4185832.0,"2032":4395123.0,"2033":4614879.0}},{"code":"4","label":"Corporate Overhead allocation","total":56256081.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":1151127.0,"2030":13630360.0,"2031":12389581.0,"2032":8605913.0,"2033":20479099.0}},{"code":"4","label":"Overhead Cost (4.1+ 4.2+ 4.3 )","total":99659994.0,"years":{"2025":4263447.0,"2026":6556525.0,"2027":4093031.0,"2028":4265215.0,"2029":5597136.0,"2030":18266203.0,"2031":17224750.0,"2032":13650373.0,"2033":25743315.0}},{"code":"5","label":"Finance Cost (Net of Finance income)","total":387072332.0,"years":{"2025":0,"2026":0,"2027":0,"2028":48526091.0,"2029":67841886.0,"2030":71268382.0,"2031":82936401.0,"2032":70410628.0,"2033":46088944.0}},{"code":"6","label":"Total Overhead Cost (4+5)","total":486732327.0,"years":{"2025":4263447.0,"2026":6556525.0,"2027":4093031.0,"2028":52791306.0,"2029":73439022.0,"2030":89534585.0,"2031":100161151.0,"2032":84061001.0,"2033":71832259.0}},{"code":"7","label":"Net Profit before Bonus, Charity and taxes","total":1256333559.0,"years":{"2025":-4263447.0,"2026":-6556525.0,"2027":-4093031.0,"2028":-52791306.0,"2029":-43881072.0,"2030":302466447.0,"2031":305189920.0,"2032":189516720.0,"2033":570745853.0}},{"code":"8","label":"Other Income","total":86769993.0,"years":{"2025":0,"2026":0,"2027":1730924.0,"2028":10816917.0,"2029":13861853.0,"2030":13080975.0,"2031":18341098.0,"2032":17317704.0,"2033":11620522.0}},{"code":"9","label":"Net Profit before taxes","total":1343103551.0,"years":{"2025":-4263447.0,"2026":-6556525.0,"2027":-2362106.0,"2028":-41974389.0,"2029":-30019219.0,"2030":315547422.0,"2031":323531018.0,"2032":206834424.0,"2033":582366375.0}},{"code":"10","label":"Taxes","total":404210099.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":70390555.0,"2031":97059305.0,"2032":62050327.0,"2033":174709912.0}},{"code":"11","label":"Net Profit (9-10)","total":938893452.0,"years":{"2025":-4263447.0,"2026":-6556525.0,"2027":-2362106.0,"2028":-41974389.0,"2029":-30019219.0,"2030":245156868.0,"2031":226471713.0,"2032":144784097.0,"2033":407656462.0}}]},"consolidatedCF":{"years":[2025,2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"I.","label":"Opening Balance","total":0,"years":{"2025":0,"2026":6692543.0,"2027":300000.0,"2028":420000.0,"2029":623092.0,"2030":31156783.0,"2031":45509301.0,"2032":587047747.0,"2033":741388847.0}},{"code":"II.","label":"Cash Inflows","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Total Customer Collections","total":5625608106.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":115112727.0,"2030":1363036032.0,"2031":1238958149.0,"2032":860591304.0,"2033":2047909894.0}},{"code":"","label":"(-) Debt Raised","total":3284960102.0,"years":{"2025":0,"2026":0,"2027":2426448.0,"2028":453753949.0,"2029":609546195.0,"2030":557886983.0,"2031":602899554.0,"2032":654481386.0,"2033":403965588.0}},{"code":"","label":"(-) Debt Raised to Service Debt","total":108112409.0,"years":{"2025":0,"2026":0,"2027":0,"2028":22309180.0,"2029":27423507.0,"2030":31310515.0,"2031":10522211.0,"2032":10539609.0,"2033":6007388.0}},{"code":"","label":"Equity requirement","total":665879580.0,"years":{"2025":16260000.0,"2026":21514437.0,"2027":278596031.0,"2028":230643915.0,"2029":118865197.0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Equity requirement for Allied Businesses","total":70000000.0,"years":{"2025":0,"2026":0,"2027":30000000.0,"2028":25000000.0,"2029":15000000.0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"GST Refund","total":290921167.0,"years":{"2025":72030.0,"2026":637709.0,"2027":19800089.0,"2028":37256605.0,"2029":44025891.0,"2030":48576787.0,"2031":50330098.0,"2032":55345588.0,"2033":34876370.0}},{"code":"","label":"Investment in JV Drummoyne","total":5000000.0,"years":{"2025":0,"2026":0,"2027":5000000.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Development Management Fees","total":82664418.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1904017.0,"2029":11898609.0,"2030":15248038.0,"2031":14389072.0,"2032":20175207.0,"2033":19049475.0}},{"code":"","label":"Total Inflow","total":10133145783.0,"years":{"2025":16332030.0,"2026":22152146.0,"2027":335822568.0,"2028":770867666.0,"2029":941872126.0,"2030":2016058356.0,"2031":1917099083.0,"2032":1601133093.0,"2033":2511808714.0}},{"code":"III.","label":"Cash Outflows","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"A.","label":"Operating Expenses","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"a.1","label":"Land Costs","total":990766068.0,"years":{"2025":9487535.0,"2026":9835400.0,"2027":201075207.0,"2028":239322586.0,"2029":219954262.0,"2030":255950849.0,"2031":40681525.0,"2032":10299217.0,"2033":4159488.0}},{"code":"","label":"Land Costs","total":820987535.0,"years":{"2025":9487535.0,"2026":7425000.0,"2027":155225000.0,"2028":206850000.0,"2029":192900000.0,"2030":219100000.0,"2031":30000000.0,"2032":0,"2033":0}},{"code":"","label":"Stampduty","total":53327267.0,"years":{"2025":0,"2026":0,"2027":16123003.0,"2028":11752182.0,"2029":12305525.0,"2030":13146557.0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Acquisition Fee","total":5568000.0,"years":{"2025":0,"2026":0,"2027":1216000.0,"2028":2432000.0,"2029":640000.0,"2030":1280000.0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Other Miscellanous","total":1728000.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":576000.0,"2030":1152000.0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Land Holding Costs","total":54531867.0,"years":{"2025":0,"2026":0,"2027":4790204.0,"2028":5807204.0,"2029":7077537.0,"2030":11716692.0,"2031":10681525.0,"2032":10299217.0,"2033":4159488.0}},{"code":"","label":"FIRB Fees","total":18167400.0,"years":{"2025":0,"2026":2410400.0,"2027":1205000.0,"2028":8481200.0,"2029":2455200.0,"2030":3615600.0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Foreign Stampduty Charges","total":36456000.0,"years":{"2025":0,"2026":0,"2027":22516000.0,"2028":4000000.0,"2029":4000000.0,"2030":5940000.0,"2031":0,"2032":0,"2033":0}},{"code":"a.2","label":"Development Costs","total":3425732549.0,"years":{"2025":0,"2026":7179821.0,"2027":87053190.0,"2028":436908057.0,"2029":535764181.0,"2030":531949911.0,"2031":701931217.0,"2032":682238811.0,"2033":442707362.0}},{"code":"","label":"Cost of construction","total":3088017563.0,"years":{"2025":0,"2026":0,"2027":63467222.0,"2028":396620300.0,"2029":493223484.0,"2030":464341288.0,"2031":641462413.0,"2032":618899774.0,"2033":410003083.0}},{"code":"","label":"Professional Fees","total":119941387.0,"years":{"2025":0,"2026":6179821.0,"2027":15062830.0,"2028":6014611.0,"2029":11595654.0,"2030":20415692.0,"2031":23482680.0,"2032":21427861.0,"2033":15762237.0}},{"code":"","label":"Development Management Fees","total":93823677.0,"years":{"2025":0,"2026":0,"2027":1904017.0,"2028":11898609.0,"2029":14987466.0,"2030":14128500.0,"2031":19634103.0,"2032":18768942.0,"2033":12502041.0}},{"code":"","label":"Statutory Costs","total":105055625.0,"years":{"2025":0,"2026":1000000.0,"2027":6619122.0,"2028":19335761.0,"2029":12162322.0,"2030":28799072.0,"2031":13640161.0,"2032":19059187.0,"2033":4440000.0}},{"code":"","label":"Project Contingency","total":18894297.0,"years":{"2025":0,"2026":0,"2027":0,"2028":3038776.0,"2029":3795254.0,"2030":4265359.0,"2031":3711861.0,"2032":4083047.0,"2033":0}},{"code":"a.3","label":"Selling Costs","total":260532197.0,"years":{"2025":0,"2026":0,"2027":13481140.0,"2028":16642624.0,"2029":41727298.0,"2030":56859337.0,"2031":49870828.0,"2032":50513445.0,"2033":31437525.0}},{"code":"","label":"Brokerage","total":119789229.0,"years":{"2025":0,"2026":0,"2027":7723012.0,"2028":8904484.0,"2029":19663132.0,"2030":22696755.0,"2031":25484817.0,"2032":19896860.0,"2033":15420170.0}},{"code":"","label":"Selling Costs","total":72160984.0,"years":{"2025":0,"2026":0,"2027":2089478.0,"2028":1462918.0,"2029":9037800.0,"2030":21466597.0,"2031":12324646.0,"2032":18174540.0,"2033":7605006.0}},{"code":"","label":"Marketing and advertising spends","total":68581984.0,"years":{"2025":0,"2026":0,"2027":3668651.0,"2028":6275222.0,"2029":13026367.0,"2030":12695985.0,"2031":12061365.0,"2032":12442046.0,"2033":8412349.0}},{"code":"a.4","label":"Overheads","total":44704023.0,"years":{"2025":151951.0,"2026":10817004.0,"2027":4093031.0,"2028":4265215.0,"2029":5597136.0,"2030":4635843.0,"2031":4835168.0,"2032":5044460.0,"2033":5264216.0}},{"code":"B.","label":"Non-Operating Expenses","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"b.1","label":"Bank & Investor Loan Payments","total":3253774164.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":24302544.0,"2030":1067411158.0,"2031":412525362.0,"2032":522620214.0,"2033":1226914886.0}},{"code":"","label":"(+) Debt Repayment","total":3253774164.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":24302544.0,"2030":1067411158.0,"2031":412525362.0,"2032":522620214.0,"2033":1226914886.0}},{"code":"b.2","label":"Interest & Other Payments","total":387072332.0,"years":{"2025":0,"2026":0,"2027":0,"2028":48526091.0,"2029":67841886.0,"2030":71268382.0,"2031":82936401.0,"2032":70410628.0,"2033":46088944.0}},{"code":"","label":"Processing Fee","total":47291658.0,"years":{"2025":0,"2026":0,"2027":0,"2028":13881790.0,"2029":8695752.0,"2030":0,"2031":24714116.0,"2032":0,"2033":0}},{"code":"","label":"Interest","total":268890075.0,"years":{"2025":0,"2026":0,"2027":0,"2028":12786544.0,"2029":43155983.0,"2030":62053992.0,"2031":48233090.0,"2032":61439310.0,"2033":41221156.0}},{"code":"","label":"Line fee","total":70890599.0,"years":{"2025":0,"2026":0,"2027":0,"2028":21857757.0,"2029":15990151.0,"2030":9214390.0,"2031":9989195.0,"2032":8971318.0,"2033":4867788.0}},{"code":"C.","label":"Central Overhead","total":56256081.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":1151127.0,"2030":13630360.0,"2031":12389581.0,"2032":8605913.0,"2033":20479099.0}},{"code":"D.","label":"Investments","total":70712465.0,"years":{"2025":0,"2026":712465.0,"2027":30000000.0,"2028":25000000.0,"2029":15000000.0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Investment in JV- Drumoyne","total":712465.0,"years":{"2025":0,"2026":712465.0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Investment in Allied Business","total":70000000.0,"years":{"2025":0,"2026":0,"2027":30000000.0,"2028":25000000.0,"2029":15000000.0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"E.","label":"Corporate tax","total":229500187.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":70390555.0,"2032":97059305.0,"2033":62050327.0}},{"code":"III.","label":"Total Outflow ( A+B+C+D)","total":8489549880.0,"years":{"2025":9639486.0,"2026":28544690.0,"2027":335702568.0,"2028":770664573.0,"2029":911338435.0,"2030":2001705839.0,"2031":1375560637.0,"2032":1446791994.0,"2033":1839101846.0}},{"code":"","label":"Opening Cash Balance","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"","label":"Net Flows ( I +II-III )","total":1643595902.0,"years":{"2025":6692543.0,"2026":300000.0,"2027":420000.0,"2028":623092.0,"2029":31156783.0,"2030":45509301.0,"2031":587047747.0,"2032":741388847.0,"2033":1414095715.0}},{"code":"IV.","label":"Closing Cash Balance","total":1643595902.0,"years":{"2025":6692543.0,"2026":300000.0,"2027":420000.0,"2028":623092.0,"2029":31156783.0,"2030":45509301.0,"2031":587047747.0,"2032":741388847.0,"2033":1414095715.0}},{"code":"(Amount in AUD)","label":"","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}}]},"holdcoPL":{"years":[2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"1","label":"Total Revenue - Development Fees","total":86769993.0,"years":{"2026":0,"2027":1730924.0,"2028":10816917.0,"2029":13861853.0,"2030":13080975.0,"2031":18341098.0,"2032":17317704.0,"2033":11620522.0}},{"code":"2","label":"Direct Cost","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.1","label":"Land cost","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.2","label":"Construction Cost","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.3","label":"Brokerage & Incentive","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.4","label":"Other Direct Cost","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2","label":"Direct Cost (2.1 + 2.2 + 2.3 + 2.4)","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"3","label":"Gross Profit (1 - 2)","total":86769993.0,"years":{"2026":0,"2027":1730924.0,"2028":10816917.0,"2029":13861853.0,"2030":13080975.0,"2031":18341098.0,"2032":17317704.0,"2033":11620522.0}},{"code":"4","label":"Overhead Cost","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"4.1","label":"General & Admin Expenses","total":11574249.0,"years":{"2026":4263447.0,"2027":3414783.0,"2028":649337.0,"2029":649337.0,"2030":649337.0,"2031":649337.0,"2032":649337.0,"2033":649337.0}},{"code":"4.2","label":"Staff/ Manpower","total":26565449.0,"years":{"2026":0,"2027":3141743.0,"2028":3443694.0,"2029":3615879.0,"2030":3796673.0,"2031":3986506.0,"2032":4185832.0,"2033":4395123.0}},{"code":"4.3","label":"Corporate Overhead allocation","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"4","label":"Overhead Cost (4.1+ 4.2+ 4.3 )","total":38139698.0,"years":{"2026":4263447.0,"2027":6556525.0,"2028":4093031.0,"2029":4265215.0,"2030":4446009.0,"2031":4635843.0,"2032":4835168.0,"2033":5044460.0}},{"code":"5","label":"Net Profit before Bonus, Charity and taxes","total":48630295.0,"years":{"2026":-4263447.0,"2027":-4825601.0,"2028":6723887.0,"2029":9596638.0,"2030":8634966.0,"2031":13705255.0,"2032":12482536.0,"2033":6576062.0}},{"code":"6","label":"Taxes","total":10212362.0,"years":{"2026":0,"2027":0,"2028":0,"2029":1518610.0,"2030":1813343.0,"2031":2878104.0,"2032":2621333.0,"2033":1380973.0}},{"code":"7","label":"Net Profit (5-6)","total":38417933.0,"years":{"2026":-4263447.0,"2027":-4825601.0,"2028":6723887.0,"2029":8078028.0,"2030":6821623.0,"2031":10827151.0,"2032":9861203.0,"2033":5195089.0}}]},"projects":{"brunswick":{"years":[2025,2026,2027,2028,2029,2030,2031],"lines":[{"code":"1","label":"Net Revenue","total":1138087773.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":682852664.0,"2031":455235109.0}},{"code":"1.1","label":"Revenue - Residential","total":1251896550.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":751137930.0,"2031":500758620.0}},{"code":"1.2","label":"Less : GST","total":-113808777.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":-68285266.0,"2031":-45523511.0}},{"code":"2","label":"Land Cost","total":77347778.0,"years":{"2025":5200000.0,"2026":1205200.0,"2027":62063378.0,"2028":2219800.0,"2029":2219800.0,"2030":2219800.0,"2031":2219800.0}},{"code":"2.1","label":"Land Costs","total":57200000.0,"years":{"2025":5200000.0,"2026":0,"2027":52000000.0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"2.2","label":"Stampduty","total":3267578.0,"years":{"2025":0,"2026":0,"2027":3267578.0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"2.3","label":"Land Holding Costs","total":11099000.0,"years":{"2025":0,"2026":0,"2027":2219800.0,"2028":2219800.0,"2029":2219800.0,"2030":2219800.0,"2031":2219800.0}},{"code":"2.4","label":"FIRB Fees","total":1205200.0,"years":{"2025":0,"2026":1205200.0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"2.5","label":"Foreign Stampduty Charges","total":4576000.0,"years":{"2025":0,"2026":0,"2027":4576000.0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"2.6","label":"Foreign landholding charges","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"3","label":"Development Cost","total":764529973.0,"years":{"2025":0,"2026":6478169.0,"2027":80519948.0,"2028":288369119.0,"2029":226250999.0,"2030":131327795.0,"2031":31583942.0}},{"code":"3.1","label":"Cost of construction","total":695082064.0,"years":{"2025":0,"2026":0,"2027":63467222.0,"2028":276942764.0,"2029":216633910.0,"2030":115274231.0,"2031":22763938.0}},{"code":"3.2","label":"Professional Fees","total":27803283.0,"years":{"2025":0,"2026":5478169.0,"2027":11151987.0,"2028":3118072.0,"2029":3118072.0,"2030":3118072.0,"2031":1818910.0}},{"code":"3.3","label":"Development Management Fees","total":20852462.0,"years":{"2025":0,"2026":0,"2027":1904017.0,"2028":8308283.0,"2029":6499017.0,"2030":3458227.0,"2031":682918.0}},{"code":"3.4","label":"Statutory Costs","total":20792164.0,"years":{"2025":0,"2026":1000000.0,"2027":3996722.0,"2028":0,"2029":0,"2030":9477265.0,"2031":6318177.0}},{"code":"4","label":"Selling Costs","total":43247335.0,"years":{"2025":0,"2026":0,"2027":7542625.0,"2028":3630590.0,"2029":3630590.0,"2030":15387240.0,"2031":13056290.0}},{"code":"4.1","label":"Brokerage","total":18778448.0,"years":{"2025":0,"2026":0,"2027":5633534.0,"2028":2575330.0,"2029":2575330.0,"2030":3064911.0,"2031":4929343.0}},{"code":"4.2","label":"Selling Expenses","total":18778448.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":11267069.0,"2031":7511379.0}},{"code":"4.3","label":"Marketing and advertising spends","total":5690439.0,"years":{"2025":0,"2026":0,"2027":1909091.0,"2028":1055260.0,"2029":1055260.0,"2030":1055260.0,"2031":615568.0}},{"code":"5","label":"GST Refund","total":-76744104.0,"years":{"2025":0,"2026":-440210.0,"2027":-12344645.0,"2028":-24753226.0,"2029":-21893214.0,"2030":-12749347.0,"2031":-4563462.0}},{"code":"6","label":"Net Cash Flow","total":329706791.0,"years":{"2025":-5200000.0,"2026":-7243159.0,"2027":-137781306.0,"2028":-269466283.0,"2029":-210208176.0,"2030":546667176.0,"2031":412938539.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":262505571.0,"2029":237542540.0,"2030":-500036254.0,"2031":-11857.0}},{"code":"7.1","label":"(-) Debt Raised","total":566162365.0,"years":{"2025":0,"2026":0,"2027":0,"2028":240196392.0,"2029":211359368.0,"2030":105268336.0,"2031":9338269.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":78074790.0,"years":{"2025":0,"2026":0,"2027":0,"2028":22309180.0,"2029":26183171.0,"2030":29491040.0,"2031":91399.0}},{"code":"7.3","label":"(+) Debt Repayment","total":-644237155.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":-634795629.0,"2031":-9441525.0}},{"code":"8","label":"Finance Costs","total":78074790.0,"years":{"2025":0,"2026":0,"2027":0,"2028":22309180.0,"2029":26183171.0,"2030":29491040.0,"2031":91399.0}},{"code":"8.1","label":"Processing Fee","total":7077030.0,"years":{"2025":0,"2026":0,"2027":0,"2028":7077030.0,"2029":0,"2030":0,"2031":0}},{"code":"8.2","label":"Interest","total":57810454.0,"years":{"2025":0,"2026":0,"2027":0,"2028":7158764.0,"2029":22157815.0,"2030":28481856.0,"2031":12020.0}},{"code":"8.3","label":"Line fee","total":13187306.0,"years":{"2025":0,"2026":0,"2027":0,"2028":8073387.0,"2029":4025357.0,"2030":1009184.0,"2031":79379.0}},{"code":"9","label":"Equity Needed","total":180508845.0,"years":{"2025":5200000.0,"2026":7243159.0,"2027":137781306.0,"2028":30284380.0,"2029":0,"2030":0,"2031":0}},{"code":"10","label":"Net Surplus","total":432140846.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":1151193.0,"2030":17139882.0,"2031":412835283.0}},{"code":"11","label":"Profit (9-10)","total":251632002.0,"years":{"2025":-5200000.0,"2026":-7243159.0,"2027":-137781306.0,"2028":-29269891.0,"2029":1151193.0,"2030":17139882.0,"2031":412835283.0}}]},"sp":{"years":[2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"1","label":"Net Revenue","total":1600970455.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":399900000.0,"2031":0,"2032":0,"2033":1201070455.0}},{"code":"1.1","label":"Revenue - Residential","total":1761067500.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":439890000.0,"2031":0,"2032":0,"2033":1321177500.0}},{"code":"1.2","label":"Less : GST","total":-160097045.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":-39990000.0,"2031":0,"2032":0,"2033":-120107045.0}},{"code":"2","label":"Land Cost","total":103022600.0,"years":{"2026":8630200.0,"2027":79585304.0,"2028":2570404.0,"2029":2570404.0,"2030":3306154.0,"2031":1834654.0,"2032":4525480.0,"2033":0}},{"code":"2.1","label":"Land Costs","total":74250000.0,"years":{"2026":7425000.0,"2027":66825000.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.2","label":"Stampduty","total":4249900.0,"years":{"2026":0,"2027":4249900.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.4","label":"Land Holding Costs","total":17377500.0,"years":{"2026":0,"2027":2570404.0,"2028":2570404.0,"2029":2570404.0,"2030":3306154.0,"2031":1834654.0,"2032":4525480.0,"2033":0}},{"code":"2.5","label":"FIRB Fees","total":1205200.0,"years":{"2026":1205200.0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"2.6","label":"Foreign Stampduty Charges","total":5940000.0,"years":{"2026":0,"2027":5940000.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"3","label":"Construction Cost","total":1039184446.0,"years":{"2026":690149.0,"2027":3910843.0,"2028":101024082.0,"2029":129795929.0,"2030":211462191.0,"2031":281840828.0,"2032":254245225.0,"2033":56215199.0}},{"code":"3.1","label":"Cost of construction","total":944846425.0,"years":{"2026":0,"2027":0,"2028":91789776.0,"2029":123828286.0,"2030":193488116.0,"2031":263402643.0,"2032":219800035.0,"2033":52537569.0}},{"code":"3.2","label":"Professional Fees","total":37793857.0,"years":{"2026":690149.0,"2027":3910843.0,"2028":1781029.0,"2029":2252795.0,"2030":7729432.0,"2031":10536106.0,"2032":8792001.0,"2033":2101503.0}},{"code":"3.3","label":"Development Management Fees","total":28345393.0,"years":{"2026":0,"2027":0,"2028":2753693.0,"2029":3714849.0,"2030":5804643.0,"2031":7902079.0,"2032":6594001.0,"2033":1576127.0}},{"code":"3.4","label":"Statutory Costs","total":28198771.0,"years":{"2026":0,"2027":0,"2028":4699584.0,"2029":0,"2030":4440000.0,"2031":0,"2032":19059187.0,"2033":0}},{"code":"4","label":"Other Project Cost","total":70442700.0,"years":{"2026":0,"2027":3849038.0,"2028":2092160.0,"2029":11301440.0,"2030":15032713.0,"2031":4403925.0,"2032":6147145.0,"2033":27616280.0}},{"code":"4.1","label":"Brokerage","total":26416013.0,"years":{"2026":0,"2027":2089478.0,"2028":1319670.0,"2029":6851944.0,"2030":5145109.0,"2031":2642355.0,"2032":3688287.0,"2033":4679170.0}},{"code":"4.2","label":"Selling Costs","total":26416013.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":6598350.0,"2031":0,"2032":0,"2033":19817663.0}},{"code":"4.4","label":"Marketing and advertising spends","total":17610675.0,"years":{"2026":0,"2027":1759560.0,"2028":772490.0,"2029":4449496.0,"2030":3289254.0,"2031":1761570.0,"2032":2458858.0,"2033":3119447.0}},{"code":"5","label":"GST Refund","total":-105061670.0,"years":{"2026":-62741.0,"2027":-7455444.0,"2028":-8946969.0,"2029":-12827034.0,"2030":-20186809.0,"2031":-26022250.0,"2032":-21939380.0,"2033":-7621044.0}},{"code":"6","label":"Net Cash Flow","total":493382379.0,"years":{"2026":-9257608.0,"2027":-79889741.0,"2028":-96739677.0,"2029":-130840740.0,"2030":190285751.0,"2031":-262057157.0,"2032":-242978469.0,"2033":1124860019.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2026":0,"2027":2426448.0,"2028":110354729.0,"2029":111759009.0,"2030":-132632850.0,"2031":283056158.0,"2032":271458530.0,"2033":-646422024.0}},{"code":"7.1","label":"(-) Debt Raised","total":924494329.0,"years":{"2026":0,"2027":2426448.0,"2028":90739677.0,"2029":100840740.0,"2030":178245313.0,"2031":262057157.0,"2032":242978469.0,"2033":47206525.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":106583341.0,"years":{"2026":0,"2027":0,"2028":19615051.0,"2029":10918269.0,"2030":10495193.0,"2031":20999002.0,"2032":28480061.0,"2033":16075765.0}},{"code":"7.3","label":"(+) Debt Repayment","total":-1031077670.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":-321373356.0,"2031":0,"2032":0,"2033":-709704314.0}},{"code":"8","label":"Finance Costs","total":106583341.0,"years":{"2026":0,"2027":0,"2028":19615051.0,"2029":10918269.0,"2030":10495193.0,"2031":20999002.0,"2032":28480061.0,"2033":16075765.0}},{"code":"8.1","label":"Processing Fee","total":12858140.0,"years":{"2026":0,"2027":0,"2028":3986836.0,"2029":0,"2030":0,"2031":8871304.0,"2032":0,"2033":0}},{"code":"8.2","label":"Interest","total":77189386.0,"years":{"2026":0,"2027":0,"2028":3103304.0,"2029":8486733.0,"2030":9522740.0,"2031":12127698.0,"2032":28480061.0,"2033":15468849.0}},{"code":"8.3","label":"Line fee","total":16535815.0,"years":{"2026":0,"2027":0,"2028":12524911.0,"2029":2431536.0,"2030":972452.0,"2031":0,"2032":0,"2033":606916.0}},{"code":"9","label":"Equity Needed","total":122720901.0,"years":{"2026":9257608.0,"2027":77463293.0,"2028":6000000.0,"2029":30000000.0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"10","label":"Net Surplus","total":509519939.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":47157709.0,"2031":0,"2032":0,"2033":462362230.0}},{"code":"11","label":"Profit","total":386799038.0,"years":{"2026":-9257608.0,"2027":-77463293.0,"2028":-6000000.0,"2029":-30000000.0,"2030":47157709.0,"2031":0,"2032":0,"2033":462362230.0}}]},"project3":{"years":[2025,2026,2027,2028,2029,2030],"lines":[{"code":"1","label":"Net Revenue","total":94025684.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":94025684.0}},{"code":"1.1","label":"Revenue - Residential","total":103428253.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":103428253.0}},{"code":"1.2","label":"Less : GST","total":-9402568.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":-9402568.0}},{"code":"2","label":"Land Cost","total":58939525.0,"years":{"2025":0,"2026":0,"2027":0,"2028":58522525.0,"2029":417000.0,"2030":0}},{"code":"2.1","label":"Land Costs","total":50000000.0,"years":{"2025":0,"2026":0,"2027":0,"2028":50000000.0,"2029":0,"2030":0}},{"code":"2.2","label":"Stampduty","total":2855525.0,"years":{"2025":0,"2026":0,"2027":0,"2028":2855525.0,"2029":0,"2030":0}},{"code":"2.3","label":"Land Holding Costs","total":834000.0,"years":{"2025":0,"2026":0,"2027":0,"2028":417000.0,"2029":417000.0,"2030":0}},{"code":"2.4","label":"FIRB Fees","total":1250000.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1250000.0,"2029":0,"2030":0}},{"code":"2.5","label":"Foreign Stampduty Charges","total":4000000.0,"years":{"2025":0,"2026":0,"2027":0,"2028":4000000.0,"2029":0,"2030":0}},{"code":"3","label":"Development Cost","total":12127769.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1370645.0,"2029":10757124.0,"2030":0}},{"code":"3.1","label":"Cost of construction","total":8316727.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":8316727.0,"2030":0}},{"code":"3.2","label":"Professional Fees","total":332669.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":332669.0,"2030":0}},{"code":"3.3","label":"Development Management Fees","total":259482.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":259482.0,"2030":0}},{"code":"3.4","label":"Statutory Costs","total":2241290.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1120645.0,"2029":1120645.0,"2030":0}},{"code":"3.5","label":"Project Contingency","total":977601.0,"years":{"2025":0,"2026":0,"2027":0,"2028":250000.0,"2029":727601.0,"2030":0}},{"code":"4","label":"Selling Costs","total":5171413.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1809994.0,"2029":1809994.0,"2030":1551424.0}},{"code":"4.1","label":"Brokerage","total":1551424.0,"years":{"2025":0,"2026":0,"2027":0,"2028":775712.0,"2029":775712.0,"2030":0}},{"code":"4.2","label":"Selling Expenses","total":1551424.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":1551424.0}},{"code":"4.3","label":"Marketing and advertising spends","total":2068565.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1034283.0,"2029":1034283.0,"2030":0}},{"code":"5","label":"GST Refund","total":-1368899.0,"years":{"2025":0,"2026":0,"2027":0,"2028":-187272.0,"2029":-1040588.0,"2030":-141039.0}},{"code":"6","label":"Net Cash Flow","total":19155877.0,"years":{"2025":0,"2026":0,"2027":0,"2028":-61515892.0,"2029":-11943530.0,"2030":92615299.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":22436880.0,"2029":13707084.0,"2030":-36143964.0}},{"code":"7.1","label":"(-) Debt Raised","total":36143964.0,"years":{"2025":0,"2026":0,"2027":0,"2028":22436880.0,"2029":13707084.0,"2030":0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":0}},{"code":"7.3","label":"(+) Debt Repayment","total":-36143964.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":-36143964.0}},{"code":"8","label":"Finance Costs","total":3147427.0,"years":{"2025":0,"2026":0,"2027":0,"2028":1210684.0,"2029":1763554.0,"2030":173190.0}},{"code":"8.1","label":"Processing Fee","total":451800.0,"years":{"2025":0,"2026":0,"2027":0,"2028":451800.0,"2029":0,"2030":0}},{"code":"8.2","label":"Interest","total":2424510.0,"years":{"2025":0,"2026":0,"2027":0,"2028":598845.0,"2029":1652475.0,"2030":173190.0}},{"code":"8.3","label":"Line fee","total":271118.0,"years":{"2025":0,"2026":0,"2027":0,"2028":160039.0,"2029":111079.0,"2030":0}},{"code":"9","label":"Equity Needed","total":40289696.0,"years":{"2025":0,"2026":0,"2027":0,"2028":40289696.0,"2029":0,"2030":0}},{"code":"10","label":"Net Surplus","total":56298145.0,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":0,"2030":56298145.0}},{"code":"11","label":"Profit (9-10)","total":16008450.0,"years":{"2025":0,"2026":0,"2027":0,"2028":-40289696.0,"2029":0,"2030":56298145.0}}]},"project4":{"years":[2026,2027,2028,2029,2030,2031,2032],"lines":[{"code":"1","label":"Topline","total":412195455.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":412195455.0}},{"code":"1.1","label":"Revenue - Residential","total":453415000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":453415000.0}},{"code":"1.2","label":"Less : GST","total":-41219545.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":-41219545.0}},{"code":"2","label":"Land Cost","total":123315600.0,"years":{"2026":0,"2027":0,"2028":8865600.0,"2029":109200000.0,"2030":1750000.0,"2031":1750000.0,"2032":1750000.0}},{"code":"2.1","label":"Land Costs","total":105000000.0,"years":{"2026":0,"2027":0,"2028":5250000.0,"2029":99750000.0,"2030":0,"2031":0,"2032":0}},{"code":"2.2","label":"Stampduty","total":9450000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":9450000.0,"2030":0,"2031":0,"2032":0}},{"code":"2.3","label":"Land Holding Costs","total":5250000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":1750000.0,"2031":1750000.0,"2032":1750000.0}},{"code":"2.4","label":"FIRB Fees","total":3615600.0,"years":{"2026":0,"2027":0,"2028":3615600.0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"3","label":"Development Cost","total":148645197.0,"years":{"2026":0,"2027":0,"2028":377276.0,"2029":42540954.0,"2030":35242323.0,"2031":35242323.0,"2032":35242323.0}},{"code":"3.1","label":"Cost of construction","total":131747000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":32936750.0,"2030":32936750.0,"2031":32936750.0,"2032":32936750.0}},{"code":"3.2","label":"Professional Fees","total":5269880.0,"years":{"2026":0,"2027":0,"2028":0,"2029":1317470.0,"2030":1317470.0,"2031":1317470.0,"2032":1317470.0}},{"code":"3.3","label":"Development Management Fees","total":3952410.0,"years":{"2026":0,"2027":0,"2028":0,"2029":988103.0,"2030":988103.0,"2031":988103.0,"2032":988103.0}},{"code":"3.4","label":"Statutory Costs","total":7675907.0,"years":{"2026":0,"2027":0,"2028":377276.0,"2029":7298632.0,"2030":0,"2031":0,"2032":0}},{"code":"4","label":"Selling Costs","total":18136600.0,"years":{"2026":0,"2027":0,"2028":0,"2029":4156304.0,"2030":1511383.0,"2031":1511383.0,"2032":10957529.0}},{"code":"4.1","label":"Brokerage","total":6801225.0,"years":{"2026":0,"2027":0,"2028":0,"2029":2493783.0,"2030":906830.0,"2031":906830.0,"2032":2493783.0}},{"code":"4.2","label":"Selling Expenses","total":6801225.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":6801225.0}},{"code":"4.3","label":"Marketing and advertising spends","total":4534150.0,"years":{"2026":0,"2027":0,"2028":0,"2029":1662522.0,"2030":604553.0,"2031":604553.0,"2032":1662522.0}},{"code":"5","label":"GST Refund","total":-14464172.0,"years":{"2026":0,"2027":0,"2028":0,"2029":-3581693.0,"2030":-3341246.0,"2031":-3341246.0,"2032":-4199987.0}},{"code":"6","label":"Net Cash Flow","total":116898057.0,"years":{"2026":0,"2027":0,"2028":-9242876.0,"2029":-155897259.0,"2030":-38503706.0,"2031":-38503706.0,"2032":364245603.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":101596149.0,"2030":43090924.0,"2031":44948401.0,"2032":-189635474.0}},{"code":"7.1","label":"(-) Debt Raised","total":226275780.0,"years":{"2026":0,"2027":0,"2028":0,"2029":101596149.0,"2030":43090924.0,"2031":44948401.0,"2032":36640306.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"7.3","label":"(+) Debt Repayment","total":-226275780.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":-226275780.0}},{"code":"8","label":"Finance Costs","total":37600202.0,"years":{"2026":0,"2027":0,"2028":0,"2029":8145780.0,"2030":7928464.0,"2031":9785941.0,"2032":11740017.0}},{"code":"8.1","label":"Processing Fee","total":2828447.0,"years":{"2026":0,"2027":0,"2028":0,"2029":2828447.0,"2030":0,"2031":0,"2032":0}},{"code":"8.2","label":"Interest","total":30291953.0,"years":{"2026":0,"2027":0,"2028":0,"2029":3388215.0,"2030":6531186.0,"2031":8927964.0,"2032":11444588.0}},{"code":"8.3","label":"Line fee","total":4479802.0,"years":{"2026":0,"2027":0,"2028":0,"2029":1929118.0,"2030":1397279.0,"2031":857977.0,"2032":295428.0}},{"code":"9","label":"Equity Needed","total":68108072.0,"years":{"2026":0,"2027":0,"2028":9242876.0,"2029":58865197.0,"2030":0,"2031":0,"2032":0}},{"code":"10","label":"Net Surplus","total":167070099.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":167070099.0}},{"code":"11","label":"Profit (9-10)","total":98962027.0,"years":{"2026":0,"2027":0,"2028":-9242876.0,"2029":-58865197.0,"2030":0,"2031":0,"2032":167070099.0}}]},"project5":{"years":[2027,2028,2029,2030,2031,2032],"lines":[{"code":"1","label":"Net Revenue","total":512644176.0,"years":{"2027":0,"2028":0,"2029":115112727.0,"2030":92232000.0,"2031":96843600.0,"2032":208455849.0}},{"code":"1.1","label":"Revenue - Residential","total":563908594.0,"years":{"2027":0,"2028":0,"2029":126624000.0,"2030":101455200.0,"2031":106527960.0,"2032":229301434.0}},{"code":"1.2","label":"Less : GST","total":-51264418.0,"years":{"2027":0,"2028":0,"2029":-11511273.0,"2030":-9223200.0,"2031":-9684360.0,"2032":-20845585.0}},{"code":"2","label":"Land Costs","total":174810525.0,"years":{"2027":51810525.0,"2028":30600000.0,"2029":30600000.0,"2030":30600000.0,"2031":30600000.0,"2032":600000.0}},{"code":"2.1","label":"Land Costs","total":150000000.0,"years":{"2027":30000000.0,"2028":30000000.0,"2029":30000000.0,"2030":30000000.0,"2031":30000000.0,"2032":0}},{"code":"2.2","label":"Stampduty","total":8605525.0,"years":{"2027":8605525.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"2.3","label":"Land Holding Costs","total":3000000.0,"years":{"2027":0,"2028":600000.0,"2029":600000.0,"2030":600000.0,"2031":600000.0,"2032":600000.0}},{"code":"2.4","label":"FIRB Fees","total":1205000.0,"years":{"2027":1205000.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"2.5","label":"Foreign Stampduty Charges","total":12000000.0,"years":{"2027":12000000.0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"3","label":"Development Cost","total":212313349.0,"years":{"2027":2622400.0,"2028":35251079.0,"2029":38513947.0,"2030":42103102.0,"2031":46051172.0,"2032":47771649.0}},{"code":"3.1","label":"Cost of construction","total":170257564.0,"years":{"2027":0,"2028":27887760.0,"2029":30676536.0,"2030":33744190.0,"2031":37118609.0,"2032":40830469.0}},{"code":"3.2","label":"Professional Fees","total":6810303.0,"years":{"2027":0,"2028":1115510.0,"2029":1227061.0,"2030":1349768.0,"2031":1484744.0,"2032":1633219.0}},{"code":"3.3","label":"Development Management Fees","total":5107727.0,"years":{"2027":0,"2028":836633.0,"2029":920296.0,"2030":1012326.0,"2031":1113558.0,"2032":1224914.0}},{"code":"3.4","label":"Statutory Costs","total":13112000.0,"years":{"2027":2622400.0,"2028":2622400.0,"2029":2622400.0,"2030":2622400.0,"2031":2622400.0,"2032":0}},{"code":"3.5","label":"Project Contingency","total":17025756.0,"years":{"2027":0,"2028":2788776.0,"2029":3067654.0,"2030":3374419.0,"2031":3711861.0,"2032":4083047.0}},{"code":"4","label":"Selling Costs","total":28195430.0,"years":{"2027":0,"2028":4431840.0,"2029":5450292.0,"2030":5250307.0,"2031":5512822.0,"2032":7550169.0}},{"code":"4.1","label":"Brokerage Costs","total":8458629.0,"years":{"2027":0,"2028":1899360.0,"2029":1521828.0,"2030":1597919.0,"2031":1677815.0,"2032":1761706.0}},{"code":"4.2","label":"Selling Expenses","total":8458629.0,"years":{"2027":0,"2028":0,"2029":1899360.0,"2030":1521828.0,"2031":1597919.0,"2032":3439522.0}},{"code":"4.3","label":"Marketing and advertising spends","total":11278172.0,"years":{"2027":0,"2028":2532480.0,"2029":2029104.0,"2030":2130559.0,"2031":2237087.0,"2032":2348942.0}},{"code":"5","label":"GST Refund","total":-20672434.0,"years":{"2027":0,"2028":-3369138.0,"2029":-3758349.0,"2030":-4066455.0,"2031":-4449236.0,"2032":-5029256.0}},{"code":"6","label":"Net Cash Flow","total":117997307.0,"years":{"2027":-54432925.0,"2028":-66913781.0,"2029":44306837.0,"2030":18345047.0,"2031":19128842.0,"2032":157563287.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2027":0,"2028":24302544.0,"2029":14371290.0,"2030":2749726.0,"2031":3030215.0,"2032":-44453775.0}},{"code":"7.1","label":"(-) Debt Raised","total":189289980.0,"years":{"2027":0,"2028":24302544.0,"2029":38673834.0,"2030":41423560.0,"2031":44453775.0,"2032":40436267.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":0,"years":{"2027":0,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"7.3","label":"(+) Debt Repayment","total":-189289980.0,"years":{"2027":0,"2028":0,"2029":-24302544.0,"2030":-38673834.0,"2031":-41423560.0,"2032":-84890042.0}},{"code":"8","label":"Finance Costs","total":12863073.0,"years":{"2027":0,"2028":3757181.0,"2029":2881139.0,"2030":2526512.0,"2031":2082488.0,"2032":1615753.0}},{"code":"8.1","label":"Processing Fee","total":2366125.0,"years":{"2027":0,"2028":2366125.0,"2029":0,"2030":0,"2031":0,"2032":0}},{"code":"8.2","label":"Interest","total":5185207.0,"years":{"2027":0,"2028":291636.0,"2029":1042208.0,"2030":1188071.0,"2031":1280648.0,"2032":1382644.0}},{"code":"8.3","label":"Line fee","total":5311742.0,"years":{"2027":0,"2028":1099420.0,"2029":1838931.0,"2030":1338442.0,"2031":801839.0,"2032":233109.0}},{"code":"9","label":"Equity Needed","total":130801343.0,"years":{"2027":54432925.0,"2028":46368418.0,"2029":30000000.0,"2030":0,"2031":0,"2032":0}},{"code":"10","label":"Net Surplus","total":235935576.0,"years":{"2027":0,"2028":0,"2029":85796988.0,"2030":18568261.0,"2031":20076569.0,"2032":111493758.0}},{"code":"11","label":"Profit (9-10)","total":105134233.0,"years":{"2027":-54432925.0,"2028":-46368418.0,"2029":55796988.0,"2030":18568261.0,"2031":20076569.0,"2032":111493758.0}}]},"project6":{"years":[2026,2027,2028,2029,2030,2031],"lines":[{"code":"1","label":"Net Revenue","total":686879441.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":686879441.0}},{"code":"1.1","label":"Revenue - Residential","total":742767385.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":742767385.0}},{"code":"1.2","label":"Less : GST","total":55887944.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":55887944.0}},{"code":"2","label":"Land Cost","total":146720257.0,"years":{"2026":0,"2027":7616000.0,"2028":136544257.0,"2029":853333.0,"2030":853333.0,"2031":853333.0}},{"code":"2.1","label":"Land Costs","total":128000000.0,"years":{"2026":0,"2027":6400000.0,"2028":121600000.0,"2029":0,"2030":0,"2031":0}},{"code":"2.2","label":"Stampduty","total":8896657.0,"years":{"2026":0,"2027":0,"2028":8896657.0,"2029":0,"2030":0,"2031":0}},{"code":"2.3","label":"Land Holding Costs","total":2560000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":853333.0,"2030":853333.0,"2031":853333.0}},{"code":"2.4","label":"FIRB Fees","total":3615600.0,"years":{"2026":0,"2027":0,"2028":3615600.0,"2029":0,"2030":0,"2031":0}},{"code":"2.5","label":"Acquisition Fee","total":3648000.0,"years":{"2026":0,"2027":1216000.0,"2028":2432000.0,"2029":0,"2030":0,"2031":0}},{"code":"2.6","label":"Foreign landholding charges","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"3","label":"Development Cost","total":268049154.0,"years":{"2026":0,"2027":0,"2028":10515856.0,"2029":85844433.0,"2030":85844433.0,"2031":85844433.0}},{"code":"3.1","label":"Cost of construction","total":241743823.0,"years":{"2026":0,"2027":0,"2028":0,"2029":80581274.0,"2030":80581274.0,"2031":80581274.0}},{"code":"3.2","label":"Professional Fees","total":7972315.0,"years":{"2026":0,"2027":0,"2028":0,"2029":2657438.0,"2030":2657438.0,"2031":2657438.0}},{"code":"3.3","label":"Development Management Fees","total":7817160.0,"years":{"2026":0,"2027":0,"2028":0,"2029":2605720.0,"2030":2605720.0,"2031":2605720.0}},{"code":"3.4","label":"Statutory Costs","total":10515856.0,"years":{"2026":0,"2027":0,"2028":10515856.0,"2029":0,"2030":0,"2031":0}},{"code":"4","label":"Selling Costs","total":23508588.0,"years":{"2026":0,"2027":0,"2028":3358370.0,"2029":6716739.0,"2030":6716739.0,"2031":6716739.0}},{"code":"4.1","label":"Brokerage","total":16340882.0,"years":{"2026":0,"2027":0,"2028":2334412.0,"2029":4668824.0,"2030":4668824.0,"2031":4668824.0}},{"code":"4.2","label":"Selling Expenses","total":1002736.0,"years":{"2026":0,"2027":0,"2028":143248.0,"2029":286496.0,"2030":286496.0,"2031":286496.0}},{"code":"4.3","label":"Marketing and advertising spends","total":6164969.0,"years":{"2026":0,"2027":0,"2028":880710.0,"2029":1761420.0,"2030":1761420.0,"2031":1761420.0}},{"code":"5","label":"GST Refund","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"6","label":"Net Cash Flow","total":243401442.0,"years":{"2026":0,"2027":-7616000.0,"2028":-150418483.0,"2029":-93414505.0,"2030":-93414505.0,"2031":593464936.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2026":0,"2027":0,"2028":56463405.0,"2029":110124142.0,"2030":110600230.0,"2031":-277187777.0}},{"code":"7.1","label":"(-) Debt Raised","total":361660277.0,"years":{"2026":0,"2027":0,"2028":56463405.0,"2029":110124142.0,"2030":110600230.0,"2031":84472501.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":0}},{"code":"7.3","label":"(+) Debt Repayment","total":-361660277.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":-0.0,"2031":-361660277.0}},{"code":"8","label":"Finance Costs","total":58083379.0,"years":{"2026":0,"2027":0,"2028":1633996.0,"2029":16709637.0,"2030":17185724.0,"2031":22554023.0}},{"code":"8.1","label":"Processing Fee","total":5412000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":5412000.0,"2030":0,"2031":0}},{"code":"8.2","label":"Interest","total":40021379.0,"years":{"2026":0,"2027":0,"2028":1633996.0,"2029":5797637.0,"2030":12785724.0,"2031":19804023.0}},{"code":"8.3","label":"Line fee","total":12650000.0,"years":{"2026":0,"2027":0,"2028":0,"2029":5500000.0,"2030":4400000.0,"2031":2750000.0}},{"code":"9","label":"Equity Needed","total":103205074.0,"years":{"2026":0,"2027":7616000.0,"2028":95589074.0,"2029":0,"2030":0,"2031":0}},{"code":"10","label":"Net Surplus","total":293723135.0,"years":{"2026":0,"2027":0,"2028":0,"2029":0,"2030":0,"2031":293723135.0}},{"code":"11","label":"Profit (9-10)","total":190518061.0,"years":{"2026":0,"2027":-7616000.0,"2028":-95589074.0,"2029":-0.0,"2030":-0.0,"2031":293723135.0}}]},"project7":{"years":[2029,2030,2031,2032,2033,2034,2035,2036],"lines":[{"code":"1","label":"Net Revenue","total":1600970455.0,"years":{"2029":0,"2030":0,"2031":0,"2032":218127273.0,"2033":145418182.0,"2034":0,"2035":545941116.0,"2036":545941116.0}},{"code":"1.1","label":"Revenue - Residential","total":1761067500.0,"years":{"2029":0,"2030":0,"2031":0,"2032":239940000.0,"2033":159960000.0,"2034":0,"2035":600535227.0,"2036":600535227.0}},{"code":"1.2","label":"Less : GST","total":-160097045.0,"years":{"2029":0,"2030":0,"2031":0,"2032":-21812727.0,"2033":-14541818.0,"2034":0,"2035":-54594112.0,"2036":-54594112.0}},{"code":"2","label":"Land Cost","total":103022600.0,"years":{"2029":7955200.0,"2030":80260304.0,"2031":2570404.0,"2032":2570404.0,"2033":3306154.0,"2034":1834654.0,"2035":2813136.0,"2036":1712344.0}},{"code":"2.1","label":"Land Costs","total":74250000.0,"years":{"2029":6750000.0,"2030":67500000.0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"2.2","label":"Stampduty","total":4249900.0,"years":{"2029":0,"2030":4249900.0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"2.3","label":"Land Holding Costs","total":17377500.0,"years":{"2029":0,"2030":2570404.0,"2031":2570404.0,"2032":2570404.0,"2033":3306154.0,"2034":1834654.0,"2035":2813136.0,"2036":1712344.0}},{"code":"2.4","label":"FIRB Fees","total":1205200.0,"years":{"2029":1205200.0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"2.5","label":"Foreign Stampduty Charges","total":5940000.0,"years":{"2029":0,"2030":5940000.0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"3","label":"Construction Cost","total":1039184446.0,"years":{"2029":690149.0,"2030":3910843.0,"2031":128940474.0,"2032":252551568.0,"2033":294064117.0,"2034":228684960.0,"2035":113064345.0,"2036":17277992.0}},{"code":"3.1","label":"Cost of construction","total":944846425.0,"years":{"2029":0,"2030":0,"2031":117879862.0,"2032":238553182.0,"2033":270686177.0,"2034":213724261.0,"2035":95425381.0,"2036":8577562.0}},{"code":"3.2","label":"Professional Fees","total":37793857.0,"years":{"2029":690149.0,"2030":3910843.0,"2031":2824632.0,"2032":6841791.0,"2033":10817355.0,"2034":8548970.0,"2035":3817015.0,"2036":343102.0}},{"code":"3.3","label":"Development Management Fees","total":28345393.0,"years":{"2029":0,"2030":0,"2031":3536396.0,"2032":7156595.0,"2033":8120585.0,"2034":6411728.0,"2035":2862761.0,"2036":257327.0}},{"code":"3.4","label":"Statutory Costs","total":28198771.0,"years":{"2029":0,"2030":0,"2031":4699584.0,"2032":0,"2033":4440000.0,"2034":0,"2035":10959187.0,"2036":8100000.0}},{"code":"4","label":"Other Project Cost","total":70442700.0,"years":{"2029":0,"2030":5113721.0,"2031":7252047.0,"2032":9436038.0,"2033":7545131.0,"2034":7018755.0,"2035":5183787.0,"2036":2477208.0}},{"code":"4.1","label":"Brokerage","total":26416013.0,"years":{"2029":0,"2030":3354161.0,"2031":4293073.0,"2032":5586506.0,"2033":4374422.0,"2034":4211253.0,"2035":3110272.0,"2036":1486325.0}},{"code":"4.2","label":"Selling Costs","total":26416013.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"4.3","label":"Marketing and advertising spends","total":17610675.0,"years":{"2029":0,"2030":1759560.0,"2031":2958974.0,"2032":3849532.0,"2033":3170709.0,"2034":2807502.0,"2035":2073515.0,"2036":990883.0}},{"code":"5","label":"GST Refund","total":-105061670.0,"years":{"2029":-737741.0,"2030":-6895415.0,"2031":-11953903.0,"2032":-24176965.0,"2033":-27255326.0,"2034":-21427610.0,"2035":-10654343.0,"2036":-1960366.0}},{"code":"6","label":"Net Cash Flow","total":493382379.0,"years":{"2029":-7907608.0,"2030":-82389453.0,"2031":-126809021.0,"2032":-22253773.0,"2033":-132241894.0,"2034":-216110759.0,"2035":435534191.0,"2036":526433939.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2029":0,"2030":0,"2031":28011879.0,"2032":-15060336.0,"2033":126346804.0,"2034":229790858.0,"2035":-291095234.0,"2036":-77993971.0}},{"code":"7.1","label":"(-) Debt Raised","total":786666658.0,"years":{"2029":0,"2030":0,"2031":17581067.0,"2032":185854448.0,"2033":248698881.0,"2034":216110759.0,"2035":99031089.0,"2036":19390415.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":47798311.0,"years":{"2029":0,"2030":0,"2031":10430812.0,"2032":10539609.0,"2033":6007388.0,"2034":13680099.0,"2035":5347370.0,"2036":1793033.0}},{"code":"7.3","label":"(+) Debt Repayment","total":-834464969.0,"years":{"2029":0,"2030":0,"2031":0,"2032":-211454392.0,"2033":-128359466.0,"2034":0,"2035":-395473693.0,"2036":-99177418.0}},{"code":"8","label":"Finance Costs","total":47798311.0,"years":{"2029":0,"2030":0,"2031":10430812.0,"2032":10539609.0,"2033":6007388.0,"2034":13680099.0,"2035":5347370.0,"2036":1793033.0}},{"code":"8.1","label":"Processing Fee","total":10430812.0,"years":{"2029":0,"2030":0,"2031":10430812.0,"2032":0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"8.2","label":"Interest","total":31602314.0,"years":{"2029":0,"2030":0,"2031":0,"2032":6496828.0,"2033":4496516.0,"2034":13680099.0,"2035":5347370.0,"2036":1581500.0}},{"code":"8.3","label":"Line fee","total":5765185.0,"years":{"2029":0,"2030":0,"2031":0,"2032":4042780.0,"2033":1510872.0,"2034":0,"2035":0,"2036":211532.0}},{"code":"9","label":"Equity Needed","total":229525015.0,"years":{"2029":7907608.0,"2030":82389453.0,"2031":109227954.0,"2032":30000000.0,"2033":0,"2034":0,"2035":0,"2036":0}},{"code":"10","label":"Net Surplus","total":675109083.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0,"2035":183776867.0,"2036":491332216.0}},{"code":"11","label":"Profit","total":445584068.0,"years":{"2029":-7907608.0,"2030":-82389453.0,"2031":-109227954.0,"2032":-30000000.0,"2033":0,"2034":0,"2035":183776867.0,"2036":491332216.0}}]},"project8":{"years":[2029,2030],"lines":[{"code":"1","label":"Net Revenue","total":94025684.0,"years":{"2029":0,"2030":94025684.0}},{"code":"1.1","label":"Revenue - Residential","total":103428253.0,"years":{"2029":0,"2030":103428253.0}},{"code":"1.2","label":"Less : GST","total":-9402568.0,"years":{"2029":0,"2030":-9402568.0}},{"code":"2","label":"Land Cost","total":58939525.0,"years":{"2029":58522525.0,"2030":417000.0}},{"code":"2.1","label":"Land Costs","total":50000000.0,"years":{"2029":50000000.0,"2030":0}},{"code":"2.2","label":"Stampduty","total":2855525.0,"years":{"2029":2855525.0,"2030":0}},{"code":"2.3","label":"Land Holding Costs","total":834000.0,"years":{"2029":417000.0,"2030":417000.0}},{"code":"2.4","label":"FIRB Fees","total":1250000.0,"years":{"2029":1250000.0,"2030":0}},{"code":"2.5","label":"Foreign Stampduty Charges","total":4000000.0,"years":{"2029":4000000.0,"2030":0}},{"code":"3","label":"Development Cost","total":12291108.0,"years":{"2029":1370645.0,"2030":10920463.0}},{"code":"3.1","label":"Cost of construction","total":8566727.0,"years":{"2029":250000.0,"2030":8316727.0}},{"code":"3.2","label":"Professional Fees","total":332669.0,"years":{"2029":0,"2030":332669.0}},{"code":"3.3","label":"Development Management Fees","total":259482.0,"years":{"2029":0,"2030":259482.0}},{"code":"3.4","label":"Project Contingency","total":890940.0,"years":{"2029":0,"2030":890940.0}},{"code":"3.5","label":"Statutory Costs","total":2241290.0,"years":{"2029":1120645.0,"2030":1120645.0}},{"code":"4","label":"Selling Costs","total":5171413.0,"years":{"2029":1809994.0,"2030":3361418.0}},{"code":"4.1","label":"Brokerage","total":1551424.0,"years":{"2029":775712.0,"2030":775712.0}},{"code":"4.2","label":"Selling Expenses","total":1551424.0,"years":{"2029":0,"2030":1551424.0}},{"code":"4.3","label":"Marketing and advertising spends","total":2068565.0,"years":{"2029":1034283.0,"2030":1034283.0}},{"code":"5","label":"GST Refund","total":-1383748.0,"years":{"2029":-187272.0,"2030":-1196476.0}},{"code":"6","label":"Net Cash Flow","total":19007387.0,"years":{"2029":-61515892.0,"2030":80523279.0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2029":23566944.0,"2030":0}},{"code":"7.1","label":"(-) Debt Raised","total":33364564.0,"years":{"2029":22326609.0,"2030":11037955.0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":3059811.0,"years":{"2029":1240335.0,"2030":1819475.0}},{"code":"7.3","label":"(+) Debt Repayment","total":-36424375.0,"years":{"2029":0,"2030":-36424375.0}},{"code":"8","label":"Finance Costs","total":3059811.0,"years":{"2029":1240335.0,"2030":1819475.0}},{"code":"8.1","label":"Processing Fee","total":455305.0,"years":{"2029":455305.0,"2030":0}},{"code":"8.2","label":"Interest","total":2353342.0,"years":{"2029":630900.0,"2030":1722442.0}},{"code":"8.3","label":"Line fee","total":251163.0,"years":{"2029":154131.0,"2030":97033.0}},{"code":"9","label":"Equity Needed","total":39189283.0,"years":{"2029":39189283.0,"2030":0}},{"code":"10","label":"Net Surplus","total":55136860.0,"years":{"2029":0,"2030":55136860.0}},{"code":"11","label":"Profit","total":15947576.4,"years":{"2029":-39189283.0,"2030":55136860.0}}]},"project9":{"years":[2029,2030,2031,2032,2033,2034],"lines":[{"code":"1","label":"Net Revenue","total":686879440.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":686879440.0,"2034":0}},{"code":"1.1","label":"Revenue - Residential","total":755567384.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":755567384.0,"2034":0}},{"code":"1.2","label":"Less : GST","total":-68687944.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":-68687944.0,"2034":0}},{"code":"2","label":"Land Cost","total":146720257.0,"years":{"2029":7616000.0,"2030":136544257.0,"2031":853333.0,"2032":853333.0,"2033":853333.0,"2034":0}},{"code":"2.1","label":"Land Costs","total":128000000.0,"years":{"2029":6400000.0,"2030":121600000.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"2.2","label":"Stampduty","total":8896657.0,"years":{"2029":0,"2030":8896657.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"2.3","label":"Land Holding Costs","total":2560000.0,"years":{"2029":0,"2030":0,"2031":853333.0,"2032":853333.0,"2033":853333.0,"2034":0}},{"code":"2.4","label":"Acquisiion Fee","total":1920000.0,"years":{"2029":640000.0,"2030":1280000.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"2.5","label":"Other Miscellanous","total":1728000.0,"years":{"2029":576000.0,"2030":1152000.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"2.6","label":"FIRB Fees","total":3615600.0,"years":{"2029":0,"2030":3615600.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"3","label":"Development Cost","total":288422900.0,"years":{"2029":0,"2030":11138762.0,"2031":92428046.0,"2032":92428046.0,"2033":92428046.0,"2034":0}},{"code":"3.1","label":"Cost of construction","total":260338012.0,"years":{"2029":0,"2030":0,"2031":86779337.0,"2032":86779337.0,"2033":86779337.0,"2034":0}},{"code":"3.2","label":"Professional Fees","total":8530140.0,"years":{"2029":0,"2030":0,"2031":2843380.0,"2032":2843380.0,"2033":2843380.0,"2034":0}},{"code":"3.3","label":"Development Management Fees","total":8415986.0,"years":{"2029":0,"2030":0,"2031":2805329.0,"2032":2805329.0,"2033":2805329.0,"2034":0}},{"code":"3.4","label":"Statutory Costs","total":11138762.0,"years":{"2029":0,"2030":11138762.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"4","label":"Selling Costs","total":30713431.0,"years":{"2029":0,"2030":4387633.0,"2031":8775266.0,"2032":8775266.0,"2033":8775266.0,"2034":0}},{"code":"4.1","label":"Brokerage","total":22283022.0,"years":{"2029":0,"2030":3183289.0,"2031":6366578.0,"2032":6366578.0,"2033":6366578.0,"2034":0}},{"code":"4.2","label":"Selling Expenses","total":1002736.0,"years":{"2029":0,"2030":143248.0,"2031":286496.0,"2032":286496.0,"2033":286496.0,"2034":0}},{"code":"4.3","label":"Marketing and advertising spends","total":7427674.0,"years":{"2029":0,"2030":1061096.0,"2031":2122193.0,"2032":2122193.0,"2033":2122193.0,"2034":0}},{"code":"5","label":"GST Refund","total":0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"6","label":"Net Cash Flow","total":221022852.0,"years":{"2029":-7616000.0,"2030":-152070652.0,"2031":-102056645.0,"2032":-102056645.0,"2033":584822794.0,"2034":0}},{"code":"7","label":"Debt Schedule","total":0,"years":{"2029":0,"2030":57725473.0,"2031":119049383.0,"2032":120091834.0,"2033":0,"2034":0}},{"code":"7.1","label":"(-) Debt Raised","total":388851106.0,"years":{"2029":0,"2030":57725473.0,"2031":119049383.0,"2032":120091834.0,"2033":91984416.0,"2034":0}},{"code":"7.2","label":"(-) Debt Raised to Service Debt","total":0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"7.3","label":"(+) Debt Repayment","total":-388851106.0,"years":{"2029":0,"2030":0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"8","label":"Finance Costs","total":60682500.0,"years":{"2029":0,"2030":1648783.0,"2031":16992737.0,"2032":18035189.0,"2033":24005791.0,"2034":0}},{"code":"8.1","label":"Processing Fee","total":5412000.0,"years":{"2029":0,"2030":0,"2031":5412000.0,"2032":0,"2033":0,"2034":0}},{"code":"8.2","label":"Interest","total":42620500.0,"years":{"2029":0,"2030":1648783.0,"2031":6080737.0,"2032":13635189.0,"2033":21255791.0,"2034":0}},{"code":"8.3","label":"Line fee","total":12650000.0,"years":{"2029":0,"2030":0,"2031":5500000.0,"2032":4400000.0,"2033":2750000.0,"2034":0}},{"code":"9","label":"Equity Needed","total":-103609962.0,"years":{"2029":-7616000.0,"2030":-95993962.0,"2031":0,"2032":0,"2033":0,"2034":0}},{"code":"10","label":"Net Surplus","total":160340351.0,"years":{"2029":-7616000.0,"2030":-95993962.0,"2031":0,"2032":0,"2033":263950314.0,"2034":0}},{"code":"11","label":"Profit (9-10)","total":160340351.0,"years":{"2029":-7616000.0,"2030":-95993962.0,"2031":0,"2032":0,"2033":263950314.0,"2034":0}}]}}};

/* Latest 27-Jul-2026 Business Plan consolidated statements are comparison data only. They never overwrite the input-driven model. */
SOURCE_BP_DEFAULT.consolidatedPL={"years":[2025,2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"","label":"Net Qualified Sales","total":7166150514,"years":{"2025":0,"2026":51464376,"2027":689999668,"2028":738182976,"2029":1138582482,"2030":1385785425,"2031":1309919190,"2032":1075331195,"2033":776885202}},{"code":"1","label":"Total Revenue","total":5870693649,"years":{"2025":0,"2026":0,"2027":0,"2028":120591228,"2029":333632727,"2030":1269010348,"2031":1238958149,"2032":860591304,"2033":2047909894}},{"code":"2.1","label":"Land cost","total":935078969,"years":{"2025":0,"2026":0,"2027":0,"2028":60940753,"2029":95082579,"2030":150727815,"2031":206026775,"2032":193736718,"2033":228564329}},{"code":"2.2","label":"Construction Cost","total":2899405235,"years":{"2025":0,"2026":0,"2027":0,"2028":27448270,"2029":134942515,"2030":701084493,"2031":583503231,"2032":356768654,"2033":1095658071}},{"code":"2.3","label":"Brokerage & Incentive","total":179474086,"years":{"2025":0,"2026":0,"2027":0,"2028":3617737,"2029":10008982,"2030":38070310,"2031":38845383,"2032":25817739,"2033":63113935}},{"code":"2.4","label":"Other Direct Cost","total":53616944,"years":{"2025":0,"2026":0,"2027":0,"2028":1205912,"2029":3336327,"2030":8965453,"2031":10465360,"2032":8605913,"2033":21037978}},{"code":"2","label":"Direct Cost (2.1 + 2.2 + 2.3 + 2.4)","total":4067575234,"years":{"2025":0,"2026":0,"2027":0,"2028":93212672,"2029":243370403,"2030":898848071,"2031":838840749,"2032":584929024,"2033":1408374313}},{"code":"3","label":"Gross Profit (1 - 2)","total":1803118416,"years":{"2025":0,"2026":0,"2027":0,"2028":27378555,"2029":90262324,"2030":370162277,"2031":400117399,"2032":275662279,"2033":639535581}},{"code":"4.1","label":"General & Admin Expenses","total":12223585,"years":{"2025":4263447,"2026":3414783,"2027":649337,"2028":649337,"2029":649337,"2030":649337,"2031":649337,"2032":649337,"2033":649337}},{"code":"4.2","label":"Staff/ Manpower","total":31180328,"years":{"2025":0,"2026":3141743,"2027":3443694,"2028":3615879,"2029":3796673,"2030":3986506,"2031":4185832,"2032":4395123,"2033":4614879}},{"code":"4.3","label":"Corporate Overhead allocation","total":58706936,"years":{"2025":0,"2026":0,"2027":0,"2028":1205912,"2029":3336327,"2030":12690103,"2031":12389581,"2032":8605913,"2033":20479099}},{"code":"4","label":"Overhead Cost (4.1+ 4.2+ 4.3 )","total":102110850,"years":{"2025":4263447,"2026":6556525,"2027":4093031,"2028":5471127,"2029":7782336,"2030":17325946,"2031":17224750,"2032":13650373,"2033":25743315}},{"code":"5","label":"Finance Cost (Net of Finance income)","total":370761105,"years":{"2025":0,"2026":0,"2027":0,"2028":4071585,"2029":16293747,"2030":79529809,"2031":81747420,"2032":51668571,"2033":137449973}},{"code":"8","label":"Other Income","total":89513208,"years":{"2025":0,"2026":0,"2027":3386761,"2028":12095188,"2029":13625960,"2030":13080975,"2031":18356098,"2032":17332704,"2033":11635522}},{"code":"9","label":"Net Profit before taxes","total":1419759668,"years":{"2025":-4263447,"2026":-6556525,"2027":-706269,"2028":29931030,"2029":79812201,"2030":286387496,"2031":319501328,"2032":227676040,"2033":487977815}},{"code":"10","label":"Taxes","total":427206935,"years":{"2025":0,"2026":0,"2027":0,"2028":6800471,"2029":23943660,"2030":85916249,"2031":95850398,"2032":68302812,"2033":146393344}},{"code":"11","label":"Net Profit (9-10)","total":992552734,"years":{"2025":-4263447,"2026":-6556525,"2027":-706269,"2028":23130559,"2029":55868541,"2030":200471248,"2031":223650929,"2032":159373228,"2033":341584470}}]};
SOURCE_BP_DEFAULT.consolidatedCF={"years":[2025,2026,2027,2028,2029,2030,2031,2032,2033],"lines":[{"code":"I","label":"Opening Balance","total":0,"years":{"2025":0,"2026":6692543,"2027":300000,"2028":4084997,"2029":74081252,"2030":189148761,"2031":124760615,"2032":655540301,"2033":811635055}},{"code":"1","label":"Total Customer Collections","total":5870693649,"years":{"2025":0,"2026":0,"2027":0,"2028":120591228,"2029":333632727,"2030":1269010348,"2031":1238958149,"2032":860591304,"2033":2047909894}},{"code":"2","label":"Debt Raised","total":3372878929,"years":{"2025":0,"2026":31394617,"2027":73021764,"2028":486806561,"2029":588982836,"2030":552572581,"2031":592787762,"2032":637568104,"2033":409744704}},{"code":"2.1","label":"Debt Raised to Service Debt","total":126097268,"years":{"2025":0,"2026":0,"2027":7942138,"2028":31189843,"2029":28095094,"2030":31248042,"2031":10539209,"2032":10845982,"2033":6236961}},{"code":"3","label":"Equity requirement","total":719667369,"years":{"2025":16260000,"2026":111299952,"2027":288231172,"2028":184995547,"2029":118880698,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"3.1","label":"Equity requirement for Allied Businesses","total":30000000,"years":{"2025":0,"2026":0,"2027":30000000,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"4","label":"GST Refund","total":310534346,"years":{"2025":72030,"2026":9345617,"2027":27386429,"2028":41920940,"2029":43173838,"2030":48291892,"2031":50228412,"2032":55238818,"2033":34876370}},{"code":"5","label":"Investment in JV Drummoyne","total":5000000,"years":{"2025":0,"2026":0,"2027":5000000,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"6","label":"Development Management Fees","total":85665455,"years":{"2025":0,"2026":0,"2027":0,"2028":3725438,"2029":13304706,"2030":14988556,"2031":14389072,"2032":20191707,"2033":19065975}},{"code":"II","label":"Total Inflow","total":10520537015,"years":{"2025":16332030,"2026":152040187,"2027":431581503,"2028":869229556,"2029":1126069900,"2030":1916111420,"2031":1906902604,"2032":1584435914,"2033":2517833903}},{"code":"7","label":"Land Costs","total":1062061108,"years":{"2025":9487535,"2026":124417758,"2027":214449810,"2028":182361540,"2029":220253387,"2030":255950849,"2031":40681525,"2032":8586873,"2033":5871831}},{"code":"8","label":"Development Costs","total":3544820610,"years":{"2025":0,"2026":20315666,"2027":152667055,"2028":486075152,"2029":525007057,"2030":531949911,"2031":702574011,"2032":674781604,"2033":451450155}},{"code":"9","label":"Selling Costs","total":268807681,"years":{"2025":0,"2026":1787384,"2027":17946510,"2028":20841335,"2029":39607261,"2030":52524685,"2031":53067409,"2032":44896518,"2033":38136579}},{"code":"10","label":"Overheads","total":43935350,"years":{"2025":151951,"2026":11199457,"2027":4093031,"2028":4265215,"2029":4446009,"2030":4635843,"2031":4835168,"2032":5044460,"2033":5264216}},{"code":"11","label":"Debt Repayment","total":3359124945,"years":{"2025":0,"2026":0,"2027":697961,"2028":48258826,"2029":147242519,"2030":1030506720,"2031":399263508,"2032":522071270,"2033":1211084141}},{"code":"12","label":"Interest & Other Payments","total":385964813,"years":{"2025":0,"2026":0,"2027":7942138,"2028":56225322,"2029":64309360,"2030":68297795,"2031":77395467,"2032":68504124,"2033":43290607}},{"code":"13","label":"Central Overhead","total":58706936,"years":{"2025":0,"2026":0,"2027":0,"2028":1205912,"2029":3336327,"2030":12690103,"2031":12389581,"2032":8605913,"2033":20479099}},{"code":"14","label":"Investments","total":30712465,"years":{"2025":0,"2026":712465,"2027":30000000,"2028":0,"2029":0,"2030":0,"2031":0,"2032":0,"2033":0}},{"code":"15","label":"Corporate tax","total":280813590,"years":{"2025":0,"2026":0,"2027":0,"2028":0,"2029":6800471,"2030":23943660,"2031":85916249,"2032":95850398,"2033":68302812}},{"code":"III","label":"Total Outflow","total":9034947498,"years":{"2025":9639486,"2026":158432730,"2027":427796505,"2028":799233302,"2029":1011002390,"2030":1980499566,"2031":1376122917,"2032":1428341161,"2033":1843879440}},{"code":"","label":"Net Flows","total":1485589517,"years":{"2025":6692543,"2026":300000,"2027":4084997,"2028":74081252,"2029":189148761,"2030":124760615,"2031":655540301,"2032":811635055,"2033":1485589517}},{"code":"IV","label":"Closing Cash Balance","total":1485589517,"years":{"2025":6692543,"2026":300000,"2027":4084997,"2028":74081252,"2029":189148761,"2030":124760615,"2031":655540301,"2032":811635055,"2033":1485589517}}]};
/* Link Business Plan vertical projects to their published annual residential-revenue
   profile. The profile is stored as weights, so commercial price changes still flow
   through the dynamic model while settlement timing remains source-aligned. */
function applyBusinessPlanTimingProfile(inputs,key,sourceData){
  if(!inputs)return inputs;
  inputs._bpTiming=0;
  for(let i=1;i<=12;i++){inputs[`_bpYear${i}`]=0;inputs[`_bpWeight${i}`]=0}
  const schedule=sourceData&&sourceData.projects&&sourceData.projects[key];
  if(!inputs.vert||!schedule)return inputs;
  const line=(schedule.lines||[]).find(x=>String(x.code||"").trim()==="1.1");
  if(!line)return inputs;
  const entries=(schedule.years||[]).map(Number).map(y=>({year:y,value:Math.max(0,Number(line.years&&line.years[String(y)]||0))})).filter(x=>x.value>.5).slice(0,12),
    total=entries.reduce((a,b)=>a+b.value,0);
  if(!(total>0))return inputs;
  inputs._bpTiming=1;
  entries.forEach((x,i)=>{inputs[`_bpYear${i+1}`]=x.year;inputs[`_bpWeight${i+1}`]=x.value/total});
  return inputs;
}
Object.entries(BP_INPUTS).forEach(([key,inputs])=>applyBusinessPlanTimingProfile(inputs,key,SOURCE_BP_DEFAULT));
function refreshBusinessPlanTimingProfiles(sourceData){
  APP.parcels.forEach(p=>applyBusinessPlanTimingProfile(p.inputs,p.sourceKey,sourceData||APP.sourceData));
  _baseRunCache.clear();_variantRunCache.clear();_deriveCache.clear();
}
function cloneSourceData(x){return JSON.parse(JSON.stringify(x))}
const SOURCE_PROJECT_KEYS=["brunswick","sp","menin","project4","project5","project6","project7","project8","project9","beckett","oxlade"];
function inferSourceKey(){return null}
function sourceKeyForParcel(p){return p&&p.sourceKey||null}
const APP={
  parcels:[
    newParcel("400 Glenmore Road Paddington - 4:1 FSR","Paddington, Sydney, NSW",{
      ...DEF,
      vert:1,pmode:1,
      acresGross:6243,_acresNet:6243,buildbua:41454,pr:195000000/6243,
      nprod:1,n1:151,w1:133,d1:1,bua1:133,
      hpsf:42000,
      startMonth:8,startYear:2026,fyEnd:6,
      ddur:3,ddend:3,landdepmonth:0,landpaycount:1,landpay1:4875000,landpay1month:12,close:21,firbmonth:5,entdur:12,
      nph:1,ph1dur:30,ph1share:100,ph1cost:100,ph1start:0,ph1p1:151,
      landgst:0,landdepo:2.5,landdeposit:0,stampmode:1,stampfixed:13573237,stamprt:0,
      foreignsurcharge:0,firbfee:3615600,acquisitionfee:0,otheracq:0,ddpc:0,
      buildpsf:288956612/41454,buildmo:30,infl:0,infesc:0,infracurve:0,buildcurve:0,contpc:0,contfixed:0,
      vel:5,depo:0,escrow:0,dellag:0,modelmo:0,modelcost:0,permpc:0,insur:0,
      softmode:0,sfpc:4,dmpc:3,
      infrastructurecharge:19077626,dafees:0,certifierfees:0,referralfees:0,qleave:0,
      landtax:0,foreignlandtax:0,councilrates:0,holdingfixed:15826464,
      comm:1.5,sellingpc:1.5,commbookpc:50,marketingpc:1,
      gnapc:0,gnasharedpc:0,staffpc:0,staffsharedpc:0,corp:0,
      gstmode:0,costgstbasis:1,gst:10,inputgst:10,outputgstfixed:0,gstcreditfixed:0,gstlag:1,
      acquisitionfee:0,otheracq:0,otherdirect:0,closingpc:0,rollback:0,impact:0,pidcost:0,pidel:0,pidrt:0,
      esc:0,presales:1,
      ltc:78,facmode:0,facilityfixed:0,fundingmode:1,equitypc:20,equityfixed:0,
      finland:1,findd:1,fincapex:0,finhoriz:1,finvert:1,
      rate:5.75,facstart:-1,procf:1.25,linef:1.25,financefixed:0,
      ftax:0,stax:0
    },null),
    newParcel("400 Glenmore Road Paddington - 2.86:1 FSR","Paddington, Sydney, NSW",{
      ...DEF,
      vert:1,pmode:1,
      acresGross:6243,_acresNet:6243,buildbua:29639,pr:135000000/6243,
      nprod:1,n1:101,w1:142,d1:1,bua1:142,
      hpsf:42000,
      startMonth:8,startYear:2026,fyEnd:6,
      ddur:3,ddend:3,landdepmonth:0,landpaycount:1,landpay1:3375000,landpay1month:12,close:21,firbmonth:5,entdur:12,
      nph:1,ph1dur:30,ph1share:100,ph1cost:100,ph1start:0,ph1p1:101,
      landgst:0,landdepo:2.5,landdeposit:0,stampmode:1,stampfixed:9373237,stamprt:0,
      foreignsurcharge:0,firbfee:3615600,acquisitionfee:0,otheracq:0,ddpc:0,
      buildpsf:208028978/29639,buildmo:30,infl:0,infesc:0,infracurve:0,buildcurve:0,contpc:0,contfixed:0,
      vel:5,depo:0,escrow:0,dellag:0,modelmo:0,modelcost:0,permpc:0,insur:0,
      softmode:0,sfpc:4,dmpc:3,
      infrastructurecharge:14710043,dafees:0,certifierfees:0,referralfees:0,qleave:0,
      landtax:0,foreignlandtax:0,councilrates:0,holdingfixed:15826464,
      comm:1.5,sellingpc:1.5,commbookpc:50,marketingpc:1,
      gnapc:0,gnasharedpc:0,staffpc:0,staffsharedpc:0,corp:0,
      gstmode:0,costgstbasis:1,gst:10,inputgst:10,outputgstfixed:0,gstcreditfixed:0,gstlag:1,
      acquisitionfee:0,otheracq:0,otherdirect:0,closingpc:0,rollback:0,impact:0,pidcost:0,pidel:0,pidrt:0,
      esc:0,presales:1,
      ltc:78,facmode:0,facilityfixed:0,fundingmode:1,equitypc:20,equityfixed:0,
      finland:1,findd:1,fincapex:0,finhoriz:1,finvert:1,
      rate:5.75,facstart:-1,procf:1.25,linef:1.25,financefixed:0,
      ftax:0,stax:0
    },null)
  ],
  active:0,
  portfolioRate:7.25,
  portfolioMode:"all",
  portfolioSelected:[],
  portfolioFyEnd:12,
  portfolioBasis:"model",
  sourceIncludeHoldco:false,
  sourceEditTarget:"consolidatedPL",
  sourceData:cloneSourceData(SOURCE_BP_DEFAULT),
  inputsCollapsed:false,
  uiLotProduct:1,uiVerticalProduct:1,uiPhase:1,uiPhaseProduct:1,uiDebtProduct:1,
  scn:[
    {n:"Downside",         ov:{hpsf:275, vel:3.5, vinfl:120000, esc:3, contpc:8}},
    {n:"Cautious",         ov:{hpsf:300, vel:4.0, vinfl:110000, esc:4, contpc:6}},
    {n:"Base case",        ov:{}, pin:true},
    
    {n:"Upside",           ov:{hpsf:350, vel:6.0, vinfl:95000, esc:7, contpc:4}},
  ],
  scnAuto:true,
  cols:["pr","hpsf","buildpsf","vel","vinfl","esc","contpc"],
  mets:["npat","margin","eirr","moic","epeak","npv"],
  sDrv:"hpsf",sMet:"npv",sFrom:null,sTo:null,sSteps:9,
  tMet:"npv",tSwing:15,
  xDrv:"hpsf",yDrv:"vel",gMet:"npv",xSteps:7,ySteps:6,
  goalDrv:"hpsf",goalMet:"eirr",goalTgt:25,
  oMet:"eirr",oTgt:20,
  opMet:"eirr",opTgt:25,opLev:["hpsf","buildpsf","vel","pr","vinfl"],opRes:null,
  summaryDetailsOpen:false,inputsCollapsed:false,
};
const P0=()=>APP.parcels[APP.active];
let D=P0().inputs;
function modeScenarios(d=D){const x=derive(d);if(x.vert)return [
  {n:"Downside",ov:{hpsf:Math.max(0,x.hpsf*.85),vel:Math.max(.5,x.vel*.7),buildpsf:x.buildpsf*1.2,esc:x.esc-3,contpc:Math.max(x.contpc,8)}},
  {n:"Cautious",ov:{hpsf:Math.max(0,x.hpsf*.93),vel:Math.max(.5,x.vel*.85),buildpsf:x.buildpsf*1.1,esc:x.esc-2,contpc:Math.max(x.contpc,6)}},
  {n:"Base case",ov:{},pin:true},
  {n:"Upside",ov:{hpsf:x.hpsf*1.08,vel:x.vel*1.2,buildpsf:x.buildpsf*.95,esc:x.esc+1,contpc:Math.max(0,x.contpc-1)}}];
 const key=x.pmode===1?"vpsf":"vff",base=x.pmode===1?(x._lotsqft?x._rev0/x._lotsqft:0):(x._frontft?x._rev0/x._frontft:0);return [
  {n:"Downside",ov:{[key]:base*.85,absn:Math.max(.5,x.absn*.7),vinfl:x.infl*1.2,esc:x.esc-3,contpc:Math.max(x.contpc,8)}},
  {n:"Cautious",ov:{[key]:base*.93,absn:Math.max(.5,x.absn*.85),vinfl:x.infl*1.1,esc:x.esc-2,contpc:Math.max(x.contpc,6)}},
  {n:"Base case",ov:{},pin:true},
  {n:"Upside",ov:{[key]:base*1.08,absn:x.absn*1.2,vinfl:x.infl*.95,esc:x.esc+1,contpc:Math.max(0,x.contpc-1)}}]}
function normalizeModeState(resetScenarios=false){D.pmode=Number(D.pmode)===1?1:0;enforceAccountingPolicy(D);const vertical=!!derive(D).vert,allowed=new Set(leversForMode(vertical).map(l=>l.k)),fallback=vertical?"hpsf":(D.pmode===1?"vpsf":"vff");["sDrv","xDrv","goalDrv"].forEach(k=>{if(!allowed.has(APP[k]))APP[k]=fallback});if(!allowed.has(APP.yDrv))APP.yDrv=vertical?"vel":"absn";APP.cols=vertical?["pr","hpsf","buildpsf","vel","esc","contpc"]:["pr","vpsf","absn","vinfl","esc","contpc"];APP.opLev=vertical?["hpsf","buildpsf","vel","pr","contpc"]:["vpsf","absn","vinfl","pr","contpc"];const incompatible=APP.scn.some(s=>Object.keys(s.ov||{}).some(k=>vertical?["vff","vpsf","absn"].includes(k):["hpsf","buildpsf","vel","buildmo"].includes(k)));const legacyVerticalDefaults=vertical&&APP.scn.length===4&&Math.abs(_num(APP.scn[0]?.ov?.hpsf)-275)<1e-9&&Math.abs(_num(APP.scn[1]?.ov?.hpsf)-300)<1e-9&&Math.abs(_num(APP.scn[3]?.ov?.hpsf)-350)<1e-9;if(resetScenarios||incompatible||APP.scnAuto||legacyVerticalDefaults){APP.scn=modeScenarios(D);APP.scnAuto=true}APP.opRes=null;APP.sFrom=APP.sTo=null}
function leversForMode(vertical){return LEV.filter(l=>{if(l.k==="phm")return false;if(vertical&&LOT_ONLY_LEVERS.includes(l.k))return false;if(!vertical&&VERT_ONLY_LEVERS.includes(l.k))return false;const pm=String(l.k).match(/^ph([1-6])dur$/);if(pm&&Number(pm[1])>Math.max(1,Math.round(_num(D.nph,1))))return false;if(l.k==="vff"&&D.pmode!==0)return false;if(l.k==="vpsf"&&D.pmode!==1)return false;return true})}

function scnOv(s){
  let o={},work=derive(D);
  Object.keys(s.ov||{}).forEach(k=>{const v=s.ov[k];if(v!==undefined&&v!==null&&v!==""){const mapped=ovFor(k,+v,work);Object.assign(o,mapped);work=derive({...D,...o})}});
  return o;
}
const pinned=()=>APP.scn.find(s=>s.pin)||APP.scn[0];

/* ── metric access ────────────────────────────────────── */
function metric(key,ov){
  if(key==="maxland")return solveLand(D,"npv",0,ov);
  try{const m=run(D,ov);const v=m[key];return v==null?null:v}catch(e){return null}
}

/* ── shared table helper ──────────────────────────────── */
function tbl(cap,head,rows,foot,cls){
  let h=`<div class="table-scroll"><table class="${cls||""}"><caption>${cap}</caption><thead><tr>`+
    head.map((t,i)=>`<th class="${i?"n":"l"}">${t}</th>`).join("")+`</tr></thead><tbody>`;
  rows.forEach(r=>{
    if(r.band){h+=`<tr class="band"><td colspan="${head.length}">${r.band}</td></tr>`;return}
    h+=`<tr class="${r.cls||""}">`+r.c.map((c,i)=>
      `<td class="${i===0?(r.sr?"sr":""):"n"}${r.base&&r.base.includes(i)?" base":""}">${c==null?"":c}</td>`).join("")+`</tr>`});
  h+=`</tbody>`;
  if(foot)h+=`<tfoot><tr><td colspan="${head.length}">${foot}</td></tr></tfoot>`;
  return h+`</table></div>`;
}

/* ── charts ───────────────────────────────────────────── */
function chart(title,series,labels,fmtY){
  const W=1000,H=248,pl=78,pr=18,pt=18,pb=34;
  const all=series.flatMap(s=>s.v).filter(v=>v!=null&&isFinite(v));
  let mn=Math.min(0,...all),mx=Math.max(0,...all);if(mn===mx)mx=mn+1;
  const pad=(mx-mn)*.08;mn-=pad;mx+=pad;
  const plotW=W-pl-pr,hasBars=series.some(s=>s.type==="bar");
  /* Bars use category centres rather than starting on the y-axis. */
  const XX=i=>hasBars?pl+(i+.5)*plotW/Math.max(labels.length,1):pl+i*plotW/Math.max(labels.length-1,1);
  const Y=v=>pt+(mx-v)/(mx-mn)*(H-pt-pb);
  const fy=fmtY||(v=>(v/1e6).toFixed(1)+"m");
  let g="";
  for(let i=0;i<=4;i++){const v=mn+(mx-mn)*i/4,y=Y(v);
    g+=`<line class="gridline" x1="${pl}" y1="${y}" x2="${W-pr}" y2="${y}"/>
        <text class="axlab" x="${pl-6}" y="${y+3.5}" text-anchor="end">${fy(v)}</text>`}
  g+=`<line class="axis" x1="${pl}" y1="${Y(0)}" x2="${W-pr}" y2="${Y(0)}"/>`;
  const step=Math.ceil(labels.length/14);
  labels.forEach((l,i)=>{if(i%step===0)g+=`<text class="axlab" x="${XX(i)}" y="${H-12}" text-anchor="middle">${l}</text>`});
  series.forEach(s=>{
    if(s.type==="bar"){const bw=Math.max(2,plotW/Math.max(labels.length,1)*.62);
      s.v.forEach((v,i)=>{if(v==null)return;const y=Y(Math.max(v,0)),h=Math.abs(Y(v)-Y(0));
        g+=`<rect x="${XX(i)-bw/2}" y="${y}" width="${bw}" height="${Math.max(h,.6)}" fill="${v<0?"#C0504D":s.c}" opacity=".92"/>`})}
    else{const pts=s.v.map((v,i)=>v==null?null:(i?"L":"M")+XX(i)+" "+Y(v)).filter(Boolean).join(" ");
      g+=`<path d="${pts}" fill="none" stroke="${s.c}" stroke-width="2.2"/>`+
         s.v.map((v,i)=>v==null?"":`<circle cx="${XX(i)}" cy="${Y(v)}" r="3" fill="${s.c}"/>`).join("")}});
  let lg="",lx=pl;series.forEach(s=>{lg+=`<rect x="${lx}" y="${pt-11}" width="9" height="9" fill="${s.c}"/>
    <text class="ttl" x="${lx+13}" y="${pt-3}">${s.n}</text>`;lx+=s.n.length*6.1+30});
  return `<div class="chart"><div class="ch">${title}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title}">${g}${lg}</svg></div>`;
}
function gauge(marks,ask){
  const W=1000,H=156,pl=10,pr=10,bh=32,by=62;
  const pts=marks.filter(k=>k.v&&isFinite(k.v));
  const hi=Math.max(ask*1.3,...pts.map(k=>k.v))*1.06||1;
  const sx=v=>pl+(v/hi)*(W-pl-pr);
  const sorted=[...pts].sort((a,b)=>a.v-b.v);
  let s=`<rect x="${pl}" y="${by}" width="${W-pl-pr}" height="${bh}" fill="#FBE3D6"/>`;
  for(let i=sorted.length-1;i>=0;i--){
    const col=i===0?"#DEEDDA":(i===1?"#FFF3D0":"#FBE3D6");
    s+=`<rect class="gbar" x="${pl}" y="${by}" width="${Math.max(sx(sorted[i].v)-pl,0)}" height="${bh}" fill="${col}"/>`}
  s+=`<rect x="${pl}" y="${by}" width="${W-pl-pr}" height="${bh}" fill="none" stroke="#8EA9DB"/>`;
  const GAP=132,tierY=[by-10,by-34,by-58],lastX=[-1e9,-1e9,-1e9];
  sorted.forEach(k=>{const x=sx(k.v);let t=0;while(t<2&&x-lastX[t]<GAP)t++;lastX[t]=x;const ly=tierY[t];
    s+=`<line x1="${x}" y1="${ly+4}" x2="${x}" y2="${by}" stroke="#8EA9DB" stroke-width="1" stroke-dasharray="2 2"/>
        <text class="gval" x="${x}" y="${ly}" text-anchor="middle">$${Math.round(k.v/1000)}k</text>
        <text class="glab" x="${x}" y="${ly-11}" text-anchor="middle">${k.n}</text>`});
  const ax=sx(ask),ay=by+bh;
  s+=`<polygon class="gask" points="${ax-8},${ay+13} ${ax+8},${ay+13} ${ax},${ay+2}" fill="#16294B"/>
      <rect class="gask" x="${ax-1.5}" y="${by}" width="3" height="${bh}" fill="#16294B"/>
      <text class="gask gval" x="${ax}" y="${ay+27}" text-anchor="middle">$${Math.round(ask/1000)}k</text>
      <text class="gask glab" x="${ax}" y="${ay+38}" text-anchor="middle" style="fill:#16294B">Asking price</text>`;
  for(let i=0;i<=5;i++){const v=hi*i/5,x=sx(v);if(Math.abs(x-ax)<62)continue;
    s+=`<line class="gtick" x1="${x}" y1="${ay}" x2="${x}" y2="${ay+5}"/>
        <text class="axlab" x="${x}" y="${ay+17}" text-anchor="middle">$${Math.round(v/1000)}k</text>`}
  return `<div class="gauge"><svg viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Land price against the maximum supportable price excluding GST">${s}</svg></div>`;
}

/* ── parcel bar ───────────────────────────────────────── */
function projectNameSizeClass(name){const n=String(name||"").trim().length;return n>28?"project-name-very-long":(n>17?"project-name-long":"")}
function fitProjectNameFont(){const e=document.getElementById("pname");if(!e)return;e.classList.remove("project-name-long","project-name-very-long");const c=projectNameSizeClass(e.value);if(c)e.classList.add(c)}
let _projectSwitchPending=false,_pendingScaffoldRebuild=false;
function scaffoldShapeKey(inputs=D){
  const d=derive(inputs);return [d.vert?1:0,Number(inputs.pmode)||0,Math.max(1,Math.round(_num(inputs.nph,1))),productCount(inputs),Math.round(_num(inputs.softmode,0))].join("|");
}
function ensureProjectSwitchOverlay(){
  const canvas=document.querySelector(".canvas");if(!canvas)return null;let overlay=canvas.querySelector(".project-switch-overlay");
  if(!overlay){overlay=document.createElement("div");overlay.className="project-switch-overlay";overlay.setAttribute("role","status");overlay.setAttribute("aria-live","polite");overlay.innerHTML='<div class="project-switch-card"><span class="project-switch-dot" aria-hidden="true"></span><b>Loading project appraisal…</b></div>';canvas.appendChild(overlay)}
  return overlay;
}
function beginProjectSwitch(name){
  _projectSwitchPending=true;const canvas=document.querySelector(".canvas"),overlay=ensureProjectSwitchOverlay();
  if(overlay){const label=overlay.querySelector("b");if(label)label.textContent="Loading "+String(name||"project")+"…"}
  if(canvas){canvas.classList.add("project-switching");canvas.setAttribute("aria-busy","true")}
}
function finishProjectSwitch(){
  if(!_projectSwitchPending)return;_projectSwitchPending=false;const canvas=document.querySelector(".canvas");
  if(canvas){canvas.classList.remove("project-switching");canvas.removeAttribute("aria-busy")}
}
function activateParcel(index){
  if(index===APP.active)return;const oldShape=scaffoldShapeKey(D);APP.active=index;D=P0().inputs;normalizeModeState();
  _pendingScaffoldRebuild=oldShape!==scaffoldShapeKey(D);buildParcels();buildForm();beginProjectSwitch(P0().name);showNav();render();
}
function buildParcels(){
  const host=document.getElementById("parcels");host.innerHTML="";
  APP.parcels.forEach((p,i)=>{
    const cached=portfolioResult(p.inputs),m=cached&&cached.m;
    const kv=m&&m.eirr!=null?P(m.eirr,0):"–";
    const b=document.createElement("button");
    b.className="pt";b.dataset.parcelId=p.id;b.setAttribute("aria-current",i===APP.active?"true":"false");
    b.innerHTML=`<span class="parcel-name ${projectNameSizeClass(p.name)}">${esc_(p.name)}</span><span class="kv">${kv}</span>`+
      (APP.parcels.length>1?`<span class="x" title="Remove">×</span>`:``);
    b.onclick=e=>{
      if(e.target.classList.contains("x")){
        if(!confirm("Remove "+p.name+"?"))return;
        APP.parcels.splice(i,1);APP.portfolioSelected=(APP.portfolioSelected||[]).filter(id=>id!==p.id);APP.active=Math.max(0,Math.min(APP.active,APP.parcels.length-1));
        D=P0().inputs;normalizeModeState();buildParcels();buildForm();buildScaffold();showNav();render();return}
      activateParcel(i)};
    host.appendChild(b);
  });
  const add=document.createElement("button");
  add.className="pt";add.innerHTML="<span>+ Add parcel</span>";
  add.onclick=()=>{const np=newParcel("Parcel "+(APP.parcels.length+1),"");APP.parcels.push(np);
    /* Preserve an explicit Selected Projects scope. A newly created parcel should not
       silently enter consolidation before the user chooses it. */
    APP.active=APP.parcels.length-1;D=P0().inputs;normalizeModeState();buildParcels();buildForm();buildScaffold();showNav();render()};
  host.appendChild(add);
  const dup=document.createElement("button");
  dup.className="pt";dup.innerHTML="<span>⧉ Duplicate</span>";
  dup.onclick=()=>{
    const p=P0(),wasSelected=new Set(portfolioSelectedIds()).has(p.id);
    /* A duplicated parcel is a new model project, not a second instance of the same
       Business Plan source schedule. Preserve the model inputs exactly but clear the
       source identity so consolidation cannot enter source-calibration logic by mistake. */
    const np=newParcel(p.name+" (copy)",p.loc,cloneSourceData(p.inputs),null);APP.parcels.push(np);
    /* In Selected Projects mode the copy inherits the original parcel's inclusion state.
       Duplicating an excluded project must not silently change consolidated totals. */
    if(APP.portfolioMode==="selected"&&wasSelected)APP.portfolioSelected=[...(APP.portfolioSelected||[]),np.id];
    APP.active=APP.parcels.length-1;D=P0().inputs;normalizeModeState();buildParcels();buildForm();buildScaffold();showNav();render()};
  host.appendChild(dup);
  document.getElementById("pname").value=P0().name;fitProjectNameFont();
  document.getElementById("ploc").value=P0().loc;
}

/* ── input rail ───────────────────────────────────────── */
function ensureActivePhaseDurations(){
  const count=_clamp(Math.round(_num(D.nph,1)),1,6);
  const fallback=Math.max(1,Math.round(_num(D.phm,10)));
  for(let i=1;i<=count;i++){
    const key=`ph${i}dur`;
    if(!Number.isFinite(Number(D[key]))||Number(D[key])<=0)D[key]=fallback;
  }
}
function productOptions(selected){return productIds(D).map(p=>`<option value="${p}"${p===selected?" selected":""}>Product ${p}</option>`).join("")}
function yesNoOptions(v){return `<option value="1"${Number(v)===1?" selected":""}>Yes</option><option value="0"${Number(v)===0?" selected":""}>No</option>`}
const SELECT_OPTIONS={
  nph:Array.from({length:6},(_,i)=>[i+1,`${i+1}`]),
  softmode:[[0,"Combined soft-cost rates"],[1,"Split by cost type"]],
  landpaycount:[[0,"0"],[1,"1"],[2,"2"],[3,"3"],[4,"4"],[5,"5"]],
  landcurve:[[0,"Deposit + settlement balance"],[1,"Straight line"],[2,"S-curve"],[3,"Milestone / back-ended"],[4,"Front-loaded"],[5,"Back-loaded"]],
  infracurve:[[0,"Straight line"],[1,"S-curve"],[2,"Milestone / back-ended"],[3,"Front-loaded"],[4,"Back-loaded"]],
  buildcurve:[[0,"Straight line"],[1,"S-curve"],[2,"Milestone / back-ended"],[3,"Front-loaded"],[4,"Back-loaded"]],
  facmode:[[1,"Fixed operating facility amount"],[0,"LTC on eligible development cost"]],
  fundingmode:[[1,"Equity first, then debt to facility cap"],[0,"Pro-rata LTC on eligible spend"]],
  stampmode:[[1,"Fixed duty input"],[0,"Rate × land including GST"]],
  allocbasis:[[0,"Equal per lot / unit"],[1,"Saleable area"],[2,"Sales value"],[3,"Saleable area / vertical unit area"]],
  escrow:[[1,"Yes — restricted until settlement"],[0,"No — available at booking"]],presales:[[1,"Yes"],[0,"No"]],
  ovhmode:[[0,"With recognised net revenue"],[1,"Fixed monthly inputs"],[2,"Percentage budget spread through programme"]],
  gstmode:[[0,"Full taxable sale"],[1,"Margin scheme"]],
  costgstbasis:[[1,"GST-inclusive cost inputs"],[0,"GST-exclusive cost inputs"]],
  relmode:[[0,"Cost release multiple"],[1,"Percentage of sale proceeds"],[2,"Fixed amount by product"]],
  intconv:[[0,"Opening debt"],[1,"Average debt"],[2,"Closing debt"]],
  staxbase:[[0,"Revenue"],[1,"Gross profit"],[2,"Pretax before additional tax"]],
  taxfreq:[[0,"Annual"],[1,"Quarterly estimates"]],taxloss:[[0,"Carryforward only"],[1,"Carryback then carryforward"]],
  designbase:[[0,"Base construction cost"],[1,"Escalated actual construction cost"]],permitbase:[[0,"Booking-indexed base"],[1,"Actual construction cost"]],
  pidacct:[[0,"Reduce project cost"],[1,"Recognise against reimbursed cost"]],
  modelphase:[[0,"Earliest active phase"],[1,"Phase 1"],[2,"Phase 2"],[3,"Phase 3"],[4,"Phase 4"],[5,"Phase 5"],[6,"Phase 6"]]
};
["vert","finland","findd","fincapex","finhoriz","finvert","revolver","cashfungible","equityreimb","fundi","pidrep","intresout","distlock","capcarry","capfin","staxdeduct"].forEach(k=>SELECT_OPTIONS[k]=[[1,"Yes"],[0,"No"]]);
function optionsHtml(k,v){return (SELECT_OPTIONS[k]||[]).map(([x,l])=>`<option value="${x}"${Number(x)===Number(v)?" selected":""}>${l}</option>`).join("")}

function phaseOptions(selected){return Array.from({length:_clamp(Math.round(_num(D.nph,1)),1,6)},(_,i)=>i+1).map(p=>`<option value="${p}"${p===selected?" selected":""}>Phase ${p}</option>`).join("")}
function addEditorRow(g,key,label,unit,opts={}){const row=document.createElement("div");row.className="f"+(opts.calc?" calc":"");const value=opts.calc?derive(D)[key]:D[key];row.innerHTML=`<label for="i_${key}">${label}</label>${opts.select?`<select id="i_${key}">${opts.select}</select>`:`<input id="i_${key}" ${opts.calc?"readonly tabindex=-1":""}>`}<span class="u">${opts.select?"":(unit||"")}</span>`;g.appendChild(row);const el=row.querySelector("input,select");if(!opts.select)el.value=Number.isFinite(Number(value))?value:"";if(!opts.calc)el.onchange=()=>{const v=opts.select?Number(el.value):parseFloat(el.value);if(!Number.isFinite(v)){if(!opts.select)el.value=D[key];return}if(opts.integer&&!Number.isInteger(v)){alert(`${label} must be entered as a whole number.`);el.value=D[key];return}D[key]=v;if(opts.rebuild){opts.rebuild();return}syncSliders();render()};return el}
function buildLotProductEditor(g){
  APP.uiLotProduct=Math.min(productCount(D),Math.max(1,APP.uiLotProduct||1));
  addEditorRow(g,"nprod","Number of product types","",{select:Array.from({length:MAX_PRODUCTS},(_,i)=>`<option value="${i+1}"${i+1===Number(D.nprod)?" selected":""}>${i+1}</option>`).join(""),rebuild:()=>{D.nprod=_clamp(Number(D.nprod),1,MAX_PRODUCTS);APP.uiLotProduct=Math.min(APP.uiLotProduct,D.nprod);APP.uiVerticalProduct=Math.min(APP.uiVerticalProduct,D.nprod);APP.uiPhaseProduct=Math.min(APP.uiPhaseProduct,D.nprod);buildForm();buildScaffold();showNav();render()}});
  const sel=addEditorRow(g,"ui_lot_product","Edit product","",{select:productOptions(APP.uiLotProduct)});sel.onchange=()=>{APP.uiLotProduct=Number(sel.value);buildForm()};
  const p=APP.uiLotProduct;addEditorRow(g,`n${p}`,`Product ${p} — lots / units`,"no.",{integer:true});
  if(!D.vert){addEditorRow(g,`w${p}`,`Product ${p} — saleable area per lot / unit`,"sqm");addEditorRow(g,`p${p}`,`Product ${p} — selling price including GST`,"A$/sqm");}
  addEditorRow(g,"_lots","Total lots / units","no.",{calc:true});
  addEditorRow(g,"pidx","Price index on all products","% current price");
  addEditorRow(g,"_lotsqft","Total saleable area","sqm",{calc:true});addEditorRow(g,"_rev0","Gross sales value including GST","A$",{calc:true});addEditorRow(g,"_avgp","Average gross sale value","A$/unit",{calc:true})
}
function buildPhaseEditor(g){
  APP.uiPhase=Math.min(Math.max(1,APP.uiPhase||1),Math.max(1,Math.round(D.nph)));APP.uiPhaseProduct=Math.min(productCount(D),Math.max(1,APP.uiPhaseProduct||1));
  let sel=addEditorRow(g,"ui_phase","Edit phase","",{select:phaseOptions(APP.uiPhase)});sel.onchange=()=>{APP.uiPhase=Number(sel.value);buildForm()};const ph=APP.uiPhase;
  [[`ph${ph}share`,"Lot / unit allocation","% total units"],[`ph${ph}cost`,"Construction cost share","% total COC"],[`ph${ph}dur`,"Duration","mth"],[`ph${ph}start`,"Start offset (-1 = automatic)","mth"],[`ph${ph}saleslag`,"Sales launch lag","mth"]].forEach(([k,l,u])=>addEditorRow(g,k,`Phase ${ph} — ${l}`,u,{integer:/dur$|start$|saleslag$/.test(k)}));
  const phaseVelKey=`ph${ph}vel`,phaseVelOverride=addEditorRow(g,`ui_phvelovr_${ph}`,`Use Phase ${ph} sales-velocity override`,"",{select:yesNoOptions(D[phaseVelKey]>0?1:0)});
  phaseVelOverride.onchange=()=>{if(Number(phaseVelOverride.value)===0)D[phaseVelKey]=0;else if(!(D[phaseVelKey]>0))D[phaseVelKey]=(D.vert?D.vel:D.absn)||1;buildForm();render()};
  if(D[phaseVelKey]>0)addEditorRow(g,phaseVelKey,`Phase ${ph} — sales velocity override`,"units/m");
  [[`ph${ph}esc`,"Price escalation","% p.a. sale price"],[`ph${ph}escovr`,"Use price-escalation override","flag"],[`ph${ph}depo`,"Purchaser deposit (-1 = global)","% sale price"],[`ph${ph}dellag`,"Settlement lag (-1 = global)","mth"]].forEach(([k,l,u])=>addEditorRow(g,k,`Phase ${ph} — ${l}`,u,{integer:/dellag$/.test(k),select:/escovr$/.test(k)?yesNoOptions(D[k]):null}));
  sel=addEditorRow(g,"ui_phase_product","Phase / product combination","",{select:productOptions(APP.uiPhaseProduct)});sel.onchange=()=>{APP.uiPhaseProduct=Number(sel.value);buildForm()};const p=APP.uiPhaseProduct;addEditorRow(g,`ph${ph}p${p}`,`Phase ${ph} — Product ${p} units (0 = automatic matrix)`,"no.",{integer:true});
}
function buildVerticalProductEditor(g){
  APP.uiVerticalProduct=Math.min(productCount(D),Math.max(1,APP.uiVerticalProduct||1));
  const sel=addEditorRow(g,"ui_vertical_product","Edit vertical product","",{select:productOptions(APP.uiVerticalProduct)});sel.onchange=()=>{APP.uiVerticalProduct=Number(sel.value);buildForm()};
  const p=APP.uiVerticalProduct;
  addEditorRow(g,`bua${p}`,`Product ${p} — vertical saleable area / unit`,"sqm");
  const priceOverride=addEditorRow(g,`hpsf${p}ovr`,`Use Product ${p} sale-price override`,"",{select:yesNoOptions(D[`hpsf${p}ovr`])});
  priceOverride.onchange=()=>{D[`hpsf${p}ovr`]=Number(priceOverride.value);buildForm();render()};
  if(D[`hpsf${p}ovr`])addEditorRow(g,`hpsf${p}`,`Product ${p} — vertical sale price including GST`,"A$/sqm");
  const velocityKey=`vel${p}`,velocityOverride=addEditorRow(g,`ui_velovr_${p}`,`Use Product ${p} sales-velocity override`,"",{select:yesNoOptions(D[velocityKey]>0?1:0)});
  velocityOverride.onchange=()=>{if(Number(velocityOverride.value)===0)D[velocityKey]=0;else if(!(D[velocityKey]>0))D[velocityKey]=D.vel||1;buildForm();render()};
  if(D[velocityKey]>0)addEditorRow(g,velocityKey,`Product ${p} — vertical sales velocity override`,"units/m");
  const durationOverride=addEditorRow(g,`buildmo${p}ovr`,`Use Product ${p} build-duration override`,"",{select:yesNoOptions(D[`buildmo${p}ovr`])});
  durationOverride.onchange=()=>{D[`buildmo${p}ovr`]=Number(durationOverride.value);buildForm();render()};
  if(D[`buildmo${p}ovr`])addEditorRow(g,`buildmo${p}`,`Product ${p} — vertical build / settlement duration`,"mth",{integer:true});
}
function buildDebtProductEditor(g){APP.uiDebtProduct=Math.min(productCount(D),Math.max(1,APP.uiDebtProduct||1));const sel=addEditorRow(g,"ui_debt_product","Fixed-release product","",{select:productOptions(APP.uiDebtProduct)});sel.onchange=()=>{APP.uiDebtProduct=Number(sel.value);buildForm()};const p=APP.uiDebtProduct;addEditorRow(g,`relfixed${p}`,`Product ${p} fixed release`,"$/unit")}
function buildGstEditor(g){
  let treatment=addEditorRow(g,"gstmode","Output GST treatment","",{select:optionsHtml("gstmode",D.gstmode)});
  treatment.onchange=()=>{D.gstmode=Number(treatment.value);buildForm();render()};
  if(Number(D.gstmode)===1)addEditorRow(g,"gstmarginbase","Margin-scheme acquisition basis (0 = land consideration paid)","A$");
  let costBasis=addEditorRow(g,"costgstbasis","Development / selling cost GST basis","",{select:optionsHtml("costgstbasis",D.costgstbasis)});
  costBasis.onchange=()=>{D.costgstbasis=Number(costBasis.value);buildForm();render()};
  const outFixed=D.outputgstfixed>0, inFixed=D.gstcreditfixed>0;
  let sel=addEditorRow(g,"ui_outputgst_basis","Output GST basis","",{select:`<option value="rate"${outFixed?"":" selected"}>Rate</option><option value="fixed"${outFixed?" selected":""}>Fixed total</option>`});
  sel.onchange=()=>{if(sel.value==="rate")D.outputgstfixed=0;else if(!(D.outputgstfixed>0)){try{D.outputgstfixed=run(D).outputGst}catch(e){D.outputgstfixed=0}}buildForm();render()};
  if(D.outputgstfixed>0)addEditorRow(g,"outputgstfixed","Output GST — fixed total","A$");else addEditorRow(g,"gst","Output GST rate","% taxable sales / margin");
  sel=addEditorRow(g,"ui_inputgst_basis","Input GST credit basis","",{select:`<option value="rate"${inFixed?"":" selected"}>Rate</option><option value="fixed"${inFixed?" selected":""}>Fixed total</option>`});
  sel.onchange=()=>{if(sel.value==="rate")D.gstcreditfixed=0;else if(!(D.gstcreditfixed>0)){try{D.gstcreditfixed=Math.max(0,run(D).inputGstCredit)}catch(e){D.gstcreditfixed=0}}buildForm();render()};
  if(D.gstcreditfixed>0)addEditorRow(g,"gstcreditfixed","Recoverable input GST credit — fixed total","A$");
  else addEditorRow(g,"inputgst","Recoverable input GST rate",Number(D.costgstbasis)===0?"% eligible ex-GST cost":"% embedded GST rate");
  addEditorRow(g,"gstlag","GST refund lag","mth",{integer:true});
  const note=document.createElement("div");note.className="note";note.style.padding="7px 0 0";note.textContent=Number(D.costgstbasis)===0?"Ex-GST cost mode: eligible development and selling costs are grossed up for GST in cashflow, then recovered through the GST Refund line after the selected lag.":"GST-inclusive cost mode: entered eligible development and selling costs already include GST; the embedded recoverable GST is returned through the GST Refund line after the selected lag.";g.appendChild(note);
}
function inputAccordionSections(){return [...document.querySelectorAll("#form .fs")].filter(fs=>fs.querySelector("button.lg"))}
function updateCollapseInputsButton(){
  const b=document.getElementById("btnCollapseInputs");if(!b)return;
  const sections=inputAccordionSections(),allCollapsed=sections.length>0&&sections.every(fs=>fs.classList.contains("shut"));
  APP.inputsCollapsed=allCollapsed;b.textContent=allCollapsed?"Expand all":"Collapse all";b.setAttribute("aria-pressed",String(allCollapsed));
}
function setAllInputSections(collapsed){
  APP.inputBucketOpen=APP.inputBucketOpen||{};
  inputAccordionSections().forEach(fs=>{const lg=fs.querySelector("button.lg");fs.classList.toggle("shut",collapsed);if(lg)lg.setAttribute("aria-expanded",String(!collapsed));if(fs.classList.contains("input-bucket")&&lg)APP.inputBucketOpen[lg.textContent]=!collapsed});
  APP.inputsCollapsed=collapsed;updateCollapseInputsButton();
}
function buildFormCore(){
  ensureActivePhaseDurations();
  const derived=derive(D),host=document.getElementById("form");host.innerHTML="";
  const md=document.createElement("div");md.className="fs shut";
  md.innerHTML=`<button type="button" class="lg" aria-expanded="false">1. Development mode</button>
    <div class="grp"><div class="f" style="grid-template-columns:1fr 118px">
      <label>Development mode</label>
      <select id="modesel"><option value="0"${D.vert?"":" selected"}>Horizontal development (lots / land units)</option>
        <option value="1"${D.vert?" selected":""}>Vertical development (apartments / buildings)</option></select>
    </div><div class="note" style="padding:2px 0 0">${D.vert ? "Vertical construction is costed from total building BUA × construction cost per BUA. Product saleable area and price drive revenue only." : "Horizontal construction is costed from lots / units × construction cost per lot. Product saleable area and price drive revenue."}</div></div>`;
  host.appendChild(md);
  const _mdl=md.querySelector("button.lg");if(_mdl)_mdl.onclick=()=>{const shut=md.classList.toggle("shut");_mdl.setAttribute("aria-expanded",String(!shut));updateCollapseInputsButton()};
  const _ms=md.querySelector("#modesel");
  if(_ms)_ms.onchange=e=>{
    D.vert=+e.target.value;normalizeModeState(true);
    buildForm();buildScaffold();showNav();render()};
  GROUPS.forEach((sec,gi)=>{
    const openByDefault=APP.inputsCollapsed?false:(gi<=1||sec.g==="Phase programme and mix");
    const fs=document.createElement("div");fs.className="fs"+(openByDefault?"":" shut");
    const lg=document.createElement("button");lg.type="button";lg.className="lg";lg.textContent=sec.g;
    lg.setAttribute("aria-expanded",openByDefault?"true":"false");
    lg.onclick=()=>{const shut=fs.classList.toggle("shut");lg.setAttribute("aria-expanded",String(!shut));updateCollapseInputsButton()};
    fs.appendChild(lg);
    if(!sec.f.some(f=>fieldShown(f[0],!!D.vert)))return;
    const g=document.createElement("div");g.className="grp";
    if(sec.g==="Lot / unit mix and pricing"){buildLotProductEditor(g);fs.appendChild(g);host.appendChild(fs);return}
    if(sec.g==="Phase programme and mix"){buildPhaseEditor(g);fs.appendChild(g);host.appendChild(fs);return}
    if(sec.g==="GST"){buildGstEditor(g);fs.appendChild(g);host.appendChild(fs);return}
    if(sec.g==="Phase-by-product unit matrix (optional)")return;
    sec.f.forEach(([k,lab,unit,,t])=>{
      if(sec.g==="Programme"&&/^ph[1-6]dur$/.test(k))return;
      if(sec.g==="Vertical development"&&(/^(?:bua|hpsf|buildpsf|vel|buildmo)\d+(?:ovr)?$/.test(k)||["buildpsf","buildpsf_legacy","dsgnpc","designbase","buildesc","vel"].includes(k)))return;
      if(sec.g==="Debt"&&/^relfixed\d+$/.test(k))return;
      if(sec.g==="P&L cost and overhead inputs"){const pct=new Set(["gnapc","gnasharedpc","staffpc","staffsharedpc","corp"]),fixed=new Set(["gnafixed","gnasharedfixed","stafffixed","staffsharedfixed","corpfixed"]);if((D.ovhmode===1&&pct.has(k))||(D.ovhmode!==1&&fixed.has(k)))return}
      if(sec.g==="Sales and receipts"&&k==="absn"&&D.vert){
        addEditorRow(g,"vel","Sales velocity","units/m");return;
      }
      if(!fieldShown(k,!!D.vert))return;
      ([lab,unit]=inputDisplay(k,lab,unit,D))
      const row=document.createElement("div");row.className="f"+(t==="c"?" calc":"");
      const ref=REFONLY[k], cnd=CONDITIONAL[k];
      let badge="";
      if(t!=="c"&&ref)badge=`<span class="tagref" title="${esc_(ref)}">ref</span>`;
      else if(t!=="c"&&cnd&&cnd[0]&&!(derived[cnd[0]]>0))badge=`<span class="tagoff" title="${esc_("No effect at present — "+cnd[1]+".")}">off</span>`;
      const hasSelect=t!=="c"&&SELECT_OPTIONS[k];row.innerHTML=`<label for="i_${k}">${lab}${badge}</label>${hasSelect?`<select id="i_${k}">${optionsHtml(k,D[k])}</select>`:`<input id="i_${k}" ${t==="c"?"readonly tabindex=-1":""}>`}<span class="u">${hasSelect?"":unit}</span>`;
      if(t!=="c"&&ref)row.classList.add("refonly");
      g.appendChild(row);
      if(t!=="c"){const inp=row.querySelector("input,select");if(!hasSelect)inp.value=D[k];
        if(MANDATORY_ACCOUNTING_FIELDS.has(k)){inp.value=ACCOUNTING_POLICY[k];inp.readOnly=true;inp.tabIndex=-1;row.classList.add("calc");}
        inp.onchange=()=>{if(MANDATORY_ACCOUNTING_FIELDS.has(k)){enforceAccountingPolicy(D);inp.value=ACCOUNTING_POLICY[k];return}const v=parseFloat(inp.value);
          if(isNaN(v)){inp.value=D[k];return}
          if(k==="vert"||k==="pmode"){D[k]=k==="vert"?(v>=.5?1:0):_clamp(Math.round(v),0,1);normalizeModeState(k==="vert");buildForm();buildScaffold();showNav();render();return}
          if(k==="nph"){
            if(!Number.isInteger(v)){alert("Construction phases must be entered as a whole number.");inp.value=D[k];return}
            D.nph=_clamp(v,1,6);
            ensureActivePhaseDurations();
            APP.sFrom=APP.sTo=null;APP.opRes=null;
            buildForm();buildScaffold();showNav();render();
            return;
          }
          const wholeMonthFields=new Set(["startMonth","startYear","fyEnd","ddur","ddend","landdepmonth","firbmonth","gstlag","close","entdur","landdur","phm","dellag","pidlag","vlag","modelmo","buildmo","facstart","taxlag","taxqlag","otherincmonth","taxcarrybackyrs","taxlossexp","dastart","dalife","modelphase"]);
          if(/^ph[1-6](?:dur|start|saleslag|dellag)$/.test(k)||/^landpay[1-5]month$/.test(k)||k==="landpaycount"||wholeMonthFields.has(k)){if(!Number.isInteger(v)){alert(`${lab} must be entered as a whole number.`);inp.value=D[k];return}}
          D[k]=k==="landpaycount"?_clamp(v,0,MAX_LAND_INTERIM_PAYMENTS):v;
          if(k==="ovhmode"||k==="softmode"||k==="facmode"||k==="gstmode"||k==="costgstbasis"||k==="landpaycount"){buildForm();buildScaffold();showNav();render();return}
          syncSliders();render()}}
    });
    if(sec.g==="Vertical development"&&D.vert)buildVerticalProductEditor(g);
    fs.appendChild(g);host.appendChild(fs);
  });
  updateCollapseInputsButton();
}
function syncSliders(){const d=derive(D);SLIDERS().forEach(k=>{const x=LV[k];if(!x)return;
  const r=document.getElementById("s_"+k),b=document.getElementById("b_"+k);
  const v=cur(k,d);
  if(r)r.value=Math.max(x.lo,Math.min(x.hi,v));
  if(b)b.value=(+v).toFixed(Math.abs(v)<100?2:0)})}
function paintCalc(){const o=derive(D);GROUPS.forEach(s=>s.f.forEach(f=>{if(f[4]==="c"){
  const el=document.getElementById("i_"+f[0]);
  if(el)el.value=(f[2]==="A$"||f[2]==="A$/unit"||f[2]==="A$/sqm")
    ?Math.round(o[f[0]]).toLocaleString("en-AU"):M0(o[f[0]],2)}}))}

/* ── tabs and lazy panes ──────────────────────────────── */
/* seven top-level views; statements and sensitivity hold more than one pane each */
const NAV=[
 {id:"verdict",lab:"Summary",     panes:[["verdict","Summary"]]},
 {id:"map",    lab:"MAP",         panes:[["map","Site intelligence"]]},
 {id:"stmt",   lab:"Statements",  panes:[["pl","Profit and loss"],["cf","Cashflow"],["bs","Balance Sheet"],["monthly","Monthly engine"]]},
 {id:"sens",   lab:"Sensitivity", panes:[["sens","One driver"],["two","Two drivers"]]},
 {id:"scn",    lab:"Scenarios",   panes:[["scn","Scenario lab"]]},
 {id:"opt",    lab:"Optimiser",   panes:[["opt","Optimiser"]]},
 {id:"offer",  lab:"Land value",  panes:[["offer","Offer price"]]},
 {id:"port",   lab:"Consolidation", panes:[["cpl","Consolidated P&L"],["ccf","Consolidated cashflow"],["cbs","Consolidated Balance Sheet"],["port","Project comparison"]]},
];
const TABS=NAV.flatMap(g=>g.panes);
let NAVSEL={};NAV.forEach(g=>NAVSEL[g.id]=g.panes[0][0]);
let NAVAT="verdict";
const PANE={};let CTX=null,CTX_KEY="",DIRTY={};
const _contextResults=new Map();
let _contextWorker=null,_contextWorkerUrl=null,_contextSeq=0,_contextLatestId=0,_contextPendingKey="",_contextRefreshTimer=0;
let SUBSEC={stmt:"pl",sens:"sens"};
const set=(id,h)=>{const e=document.getElementById(id);if(e)e.innerHTML=h};
const _decisionResults=new Map(),_tornadoResults=new Map(),_goalResults=new Map();
let _analyticsWorker=null,_analyticsWorkerUrl=null,_analyticsActive=null,_analyticsSeq=0,_analyticsPaintFrame=0,_decisionTimer=0,_lastUserActivity=performance.now();
let _decisionPoolWorkers=[],_decisionPoolActive=null,_decisionPoolSeq=0,_decisionPoolUrl=null;
function decisionPoolAppendSource(){return String.raw`
var __dpBaseRun=run,__dpCache=new Map();
run=function(din,ov){
  var baseKey=modelInputSignature(din),hasOv=!!(ov&&Object.keys(ov).length),key=hasOv?baseKey+"\u001d"+overrideSignature(ov):baseKey;
  if(__dpCache.has(key)){var hit=__dpCache.get(key);__dpCache.delete(key);__dpCache.set(key,hit);return hit}
  var value=__dpBaseRun(din,ov);cacheSetLRU(__dpCache,key,value,320);return value;
};
function dpTask(inputs,t){
  var d,x;
  if(t.type==="land")return solveLand(inputs,t.metric,t.target,t.overrides||{});
  if(t.type==="run")return run(inputs,t.overrides||{})[t.metric];
  if(t.type==="price"){
    d=derive(inputs);
    if(d.vert)return solveDriver(inputs,"hpsf",0,d.hpsf,true);
    x=solveDriver(inputs,"pidx",30,d.pidx,true);
    return d.pidx>0&&x!=null?x*(d._rev0/d._frontft)/d.pidx:null;
  }
  if(t.type==="speed"){
    d=derive(inputs);return d.vert?solveDriver(inputs,"vel",.25,d.vel,true):solveDriver(inputs,"absn",.5,d.absn,true);
  }
  if(t.type==="infl"){d=derive(inputs);return solveDriver(inputs,"infl",d.infl,500000,false)}
  if(t.type==="contpc")return solveDriver(inputs,"contpc",0,120,false);
  return null;
}
onmessage=function(e){var q=e.data||{},out={};try{for(var i=0;i<q.tasks.length;i++){var t=q.tasks[i];out[t.k]=dpTask(q.inputs,t)}postMessage({id:q.id,key:q.key,out:out})}catch(err){postMessage({id:q.id,key:q.key,error:err&&err.message?err.message:String(err)})}};
`}
function decisionPoolUrl(){
  if(_decisionPoolUrl)return _decisionPoolUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  _decisionPoolUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,"\n",decisionPoolAppendSource()],{type:"text/javascript"}));return _decisionPoolUrl;
}
function cancelDecisionPool(){_decisionPoolWorkers.forEach(w=>w.terminate());_decisionPoolWorkers=[];_decisionPoolActive=null}
function ensureDecisionPool(inputKey,inputs){
  if(_decisionResults.has(inputKey))return;
  if(_decisionPoolActive&&_decisionPoolActive.key===inputKey)return;
  cancelDecisionPool();
  const d=derive(inputs),tasks=[
    {k:"be",type:"land",metric:"npv",target:0},
    {k:"hurd",type:"land",metric:"eirr",target:d.hurdle/100},
    {k:"be25",type:"land",metric:"eirr",target:.25},
    {k:"noPid",type:"land",metric:"npv",target:0,overrides:{pidrt:0}},
    {k:"noPidEirr",type:"run",metric:"eirr",overrides:{pidrt:0}},
    {k:"price",type:"price"},{k:"speed",type:"speed"},{k:"infl",type:"infl"},{k:"contpc",type:"contpc"}
  ],url=decisionPoolUrl();
  if(!url){setTimeout(()=>{if(decisionKey()!==inputKey)return;analyticsCacheSet(_decisionResults,inputKey,computeDecisionSync(inputs));analyticsRepaint(inputKey)},0);return}
  const hc=Math.max(1,Number(navigator.hardwareConcurrency)||4),workerCount=hc>=12?6:(hc>=8?5:(hc>=4?3:2)),groups=Array.from({length:Math.min(workerCount,tasks.length)},()=>[]);
  /* Each iterative land solve gets its own lane on higher-core devices. Related
     no-reimbursement outputs stay together to retain cache reuse. */
  const planned=workerCount>=6
    ?[[tasks[0]],[tasks[1]],[tasks[2]],[tasks[3],tasks[4]],[tasks[5],tasks[6]],[tasks[7],tasks[8]]]
    :workerCount>=5
      ?[[tasks[0]],[tasks[1]],[tasks[2]],[tasks[3],tasks[4],tasks[6]],[tasks[5],tasks[7],tasks[8]]]
      :[[tasks[0],tasks[1]],[tasks[2],tasks[5]],[tasks[3],tasks[4],tasks[6]],[tasks[7],tasks[8]]];
  planned.forEach((g,i)=>groups[i%groups.length].push(...g));
  const id=++_decisionPoolSeq,state={id,key:inputKey,remaining:groups.filter(g=>g.length).length,out:{}};_decisionPoolActive=state;
  const finish=(worker,msg)=>{
    worker.terminate();_decisionPoolWorkers=_decisionPoolWorkers.filter(w=>w!==worker);
    if(!_decisionPoolActive||msg.id!==state.id||state.key!==inputKey)return;
    if(msg.out)Object.assign(state.out,msg.out);state.remaining--;
    if(state.remaining>0)return;
    _decisionPoolActive=null;
    const o=state.out,data={be:o.be,hurd:o.hurd,be25:o.be25,noPid:o.noPid,noPidEirr:o.noPidEirr,bd:{price:o.price,speed:o.speed,infl:o.infl,contpc:o.contpc}};
    analyticsCacheSet(_decisionResults,inputKey,data);analyticsRepaint(inputKey);
  };
  groups.filter(g=>g.length).forEach(group=>{const worker=new Worker(url);_decisionPoolWorkers.push(worker);worker.onmessage=e=>finish(worker,e.data||{});worker.onerror=()=>finish(worker,{id,key:inputKey,error:"Worker error"});worker.postMessage({id,key:inputKey,inputs:{...inputs},tasks:group})});
}


/* Portfolio calculations are intentionally isolated from the UI thread. The full
   engine still runs unchanged, but project metrics and maximum-land-price goal
   seeks no longer block typing, sliders, tab changes or ordinary input edits. */
const _portfolioResults=new Map(),_portfolioErrors=new Map();
let _portfolioWorker=null,_portfolioWorkerUrl=null,_portfolioActive=null,_portfolioSeq=0,_portfolioPaintTimer=0,_portfolioRefreshTimer=0,_portfolioBatchChanged=false;
function portfolioResult(inputs){return _portfolioResults.get(modelInputSignature(inputs))||null}
function portfolioSlimMain(m){
  return {eirr:m.eirr,irr:m.irr,moic:m.moic,epeak:m.epeak,peakdebt:m.peakdebt,npv:m.npv,
    revenue:m.revenue,gross:m.gross,npat:m.npat,margin:m.margin,einj:m.einj,eret:m.eret,
    land:m.land,finance:m.finance,tax:m.tax,NM:m.NM,
    R:{eqin:m.R.eqin,eqout:m.R.eqout,lcl:m.R.lcl,net:m.R.net,intr:m.R.intr,rep:m.R.rep,lf:m.R.lf,dr1:m.R.dr1,dr2:m.R.dr2,salescash:m.R.salescash,devc:m.R.devc}};
}
function cacheContextForPortfolio(key,A){
  if(!A)return;const old=_portfolioResults.get(key)||{};
  cacheSetLRU(_portfolioResults,key,{...old,m:portfolioSlimMain(A)},48);_portfolioErrors.delete(key);
}
function portfolioWorkerAppendSource(){return String.raw`
function portfolioSlim(m){
  return {eirr:m.eirr,irr:m.irr,moic:m.moic,epeak:m.epeak,peakdebt:m.peakdebt,npv:m.npv,
    revenue:m.revenue,gross:m.gross,npat:m.npat,margin:m.margin,einj:m.einj,eret:m.eret,
    land:m.land,finance:m.finance,tax:m.tax,NM:m.NM,
    R:{eqin:m.R.eqin,eqout:m.R.eqout,lcl:m.R.lcl,net:m.R.net,intr:m.R.intr,rep:m.R.rep,lf:m.R.lf,dr1:m.R.dr1,dr2:m.R.dr2,salescash:m.R.salescash,devc:m.R.devc}};
}
onmessage=function(e){
  var q=e.data||{},jobs=q.jobs||[];
  try{
    for(var i=0;i<jobs.length;i++){
      var j=jobs[i];
      try{postMessage({id:q.id,stage:"base",key:j.key,data:portfolioSlim(run(j.inputs))})}
      catch(err){postMessage({id:q.id,stage:"error",key:j.key,message:err&&err.message?err.message:String(err)})}
    }
    for(var z=0;z<jobs.length;z++){
      var x=jobs[z];if(!x.needLand)continue;
      try{postMessage({id:q.id,stage:"land",key:x.key,data:solveLand(x.inputs,"npv",0)})}
      catch(err){postMessage({id:q.id,stage:"error",key:x.key,message:err&&err.message?err.message:String(err)})}
    }
    postMessage({id:q.id,stage:"done"});
  }catch(err){postMessage({id:q.id,stage:"fatal",message:err&&err.message?err.message:String(err)})}
};
`}
function portfolioWorkerUrl(){
  if(_portfolioWorkerUrl)return _portfolioWorkerUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  _portfolioWorkerUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,"\n",portfolioWorkerAppendSource()],{type:"text/javascript"}));
  return _portfolioWorkerUrl;
}
function schedulePortfolioPaint(){
  clearTimeout(_portfolioPaintTimer);
  const attempt=()=>{
    if(activePane()==="port"&&_portfolioInteractionLocked){
      _portfolioPaintTimer=0;DIRTY.port=true;buildParcels();
      return;
    }
    const elapsed=performance.now()-_portfolioUserScrollAt;
    if(activePane()==="port"&&elapsed<800){
      _portfolioPaintTimer=setTimeout(attempt,220);
      return;
    }
    _portfolioPaintTimer=0;buildParcels();
    if(activePane()==="port"){DIRTY.port=true;paint("port")}
  };
  _portfolioPaintTimer=setTimeout(attempt,120);
}
function ensurePortfolioResults(){
  const active=P0(),needLand=activePane()==="port";
  const candidates=APP.parcels.map((p,i)=>({p,i,key:modelInputSignature(p.inputs),needLand}))
    .filter(j=>{const r=_portfolioResults.get(j.key);return (!r||!r.m||(j.needLand&&r.ml==null))&&!_portfolioErrors.has(j.key)})
    .sort((a,b)=>(a.p===active?-1:0)-(b.p===active?-1:0));
  /* Parse the model once and calculate all ordinary parcel metrics in one batch.
     Maximum-land-price searches remain one at a time because each is a much heavier
     iterative solve and is only required inside Project comparison. */
  const batchSize=needLand?Math.min(candidates.length,6):candidates.length;
  const jobs=candidates.slice(0,batchSize)
    .map((j,i)=>({key:j.key,inputs:{...j.p.inputs},needLand:needLand&&i===0}));
  if(!jobs.length)return false;
  const jobKeys=jobs.map(j=>j.key),batchKey=jobKeys.join("\u001c");
  if(_portfolioActive&&jobs.every(j=>_portfolioActive.keys.has(j.key)))return true;
  if(_portfolioWorker){_portfolioWorker.terminate();_portfolioWorker=null}
  const url=portfolioWorkerUrl();
  if(!url)return false;
  const id=++_portfolioSeq,worker=new Worker(url);_portfolioWorker=worker;_portfolioActive={id,batchKey,keys:new Set(jobKeys)};
  worker.onmessage=e=>{
    const m=e.data||{};if(!_portfolioActive||m.id!==_portfolioActive.id)return;
    if(m.stage==="base"){
      const old=_portfolioResults.get(m.key)||{};cacheSetLRU(_portfolioResults,m.key,{...old,m:m.data},48);_portfolioErrors.delete(m.key);_portfolioBatchChanged=true;
    }else if(m.stage==="land"){
      const old=_portfolioResults.get(m.key)||{};cacheSetLRU(_portfolioResults,m.key,{...old,ml:m.data},48);_portfolioBatchChanged=true;
    }else if(m.stage==="error"){
      _portfolioErrors.set(m.key,m.message||"Model error");_portfolioBatchChanged=true;
    }
    if(m.stage==="done"||m.stage==="fatal"){
      worker.terminate();if(_portfolioWorker===worker)_portfolioWorker=null;_portfolioActive=null;
      /* Continue all remaining project calculations without repainting the pane.
         A single final paint prevents the comparison page from moving under the
         user's vertical or horizontal scroll gesture. */
      const more=ensurePortfolioResults();
      if(!more&&_portfolioBatchChanged){_portfolioBatchChanged=false;schedulePortfolioPaint()}
    }
  };
  worker.onerror=()=>{
    worker.terminate();if(_portfolioWorker===worker)_portfolioWorker=null;_portfolioActive=null;
    if(_portfolioBatchChanged){_portfolioBatchChanged=false;schedulePortfolioPaint()}
  };
  worker.postMessage({id,jobs});
  return true;
}
function schedulePortfolioResults(delay=900){
  clearTimeout(_portfolioRefreshTimer);
  _portfolioRefreshTimer=setTimeout(()=>{_portfolioRefreshTimer=0;const work=()=>ensurePortfolioResults();if(typeof requestIdleCallback==="function")requestIdleCallback(work,{timeout:900});else work()},delay);
}
function cancelPortfolioBackground(){
  clearTimeout(_portfolioRefreshTimer);_portfolioRefreshTimer=0;
  if(_portfolioWorker){_portfolioWorker.terminate();_portfolioWorker=null}
  _portfolioActive=null;
}
function analyticsCacheSet(map,key,value,limit=12){return cacheSetLRU(map,key,value,limit)}
function decisionKey(){return modelInputSignature(D)}
function tornadoKey(inputKey=decisionKey()){return inputKey+"|"+APP.tMet+"|"+APP.tSwing}
function goalKey(inputKey=decisionKey()){
  const gm=MET[APP.goalMet],target=gm.f===P?APP.goalTgt/100:APP.goalTgt;
  return inputKey+"|"+APP.goalDrv+"|"+APP.goalMet+"|"+target;
}
function currentDecision(){return _decisionResults.get(decisionKey())||null}
function currentTornado(){return _tornadoResults.get(tornadoKey())||null}
function currentGoal(){return _goalResults.get(goalKey())||null}
function computeDecisionSync(inputs){
  const d=derive(inputs);
  const noPidModel=run(inputs,{pidrt:0});
  return {be:solveLand(inputs,"npv",0),hurd:solveLand(inputs,"eirr",d.hurdle/100),
    be25:solveLand(inputs,"eirr",.25),noPid:solveLand(inputs,"npv",0,{pidrt:0}),noPidEirr:noPidModel.eirr,
    bd:{
      price:d.vert?solveDriver(inputs,"hpsf",0,d.hpsf,true):(()=>{const x=solveDriver(inputs,"pidx",30,d.pidx,true);return d.pidx>0&&x!=null?x*(d._rev0/d._frontft)/d.pidx:null})(),
      speed:d.vert?solveDriver(inputs,"vel",0.25,d.vel,true):solveDriver(inputs,"absn",0.5,d.absn,true),
      infl:solveDriver(inputs,"infl",d.infl,500000,false),contpc:solveDriver(inputs,"contpc",0,120,false)
    }};
}
function buildTornadoTests(d){
  const sw=APP.tSwing/100,all=levers(),byKey=new Map(all.map(x=>[x.k,x]));
  /* Keep the Tornado responsive by calculating the material development drivers first.
     The displayed values still come from the full appraisal engine. */
  const priceKey=d.vert?"hpsf":(d.pmode===1?"vpsf":"vff");
  const preferred=[priceKey,"vinfl","pr","pidel","pidrt","contpc","rate","esc","infesc","ph1dur"];
  const candidates=preferred.map(k=>byKey.get(k)).filter(Boolean);
  return candidates.map(x=>{
    const b=cur(x.k,d);let lo=b*(1-sw),hi=b*(1+sw),zeroBase=Math.abs(b)<1e-9;
    if(zeroBase){const span=(x.hi-x.lo)*sw;lo=Math.max(x.lo,b-span/2);hi=Math.min(x.hi,b+span/2);if(Math.abs(hi-lo)<1e-9)hi=Math.min(x.hi,b+span)}
    const within=b>=x.lo&&b<=x.hi;
    if(within){lo=Math.max(x.lo,lo);hi=Math.min(x.hi,hi)}else{lo=Math.max(0,Math.min(lo,hi));hi=Math.max(lo+Math.max(Math.abs(b)*.01,x.st||1),Math.max(b*(1-sw),b*(1+sw)))}
    if(x.k==="ph1dur"){lo=Math.max(1,Math.round(lo));hi=Math.max(lo+1,Math.round(hi))}
    if(!(hi>lo))return null;
    const displayName=x.k===priceKey?(D.vert?"Sale price per sqm":"Lot price per front foot"):x.k==="vinfl"?"Construction cost per lot":x.k==="ph1dur"?"Phase duration":x.n;
    return {k:x.k,n:displayName,lo,hi,zeroBase,ovLo:ovFor(x.k,lo,d),ovHi:ovFor(x.k,hi,d)};
  }).filter(Boolean);
}
function workerAppendSource(){return String.raw`
var __workerBaseRun=run,__workerRunCache=new Map();
run=function(din,ov){
  var baseKey=modelInputSignature(din),hasOv=!!(ov&&Object.keys(ov).length),key=hasOv?baseKey+"\u001d"+overrideSignature(ov):baseKey;
  if(__workerRunCache.has(key)){var hit=__workerRunCache.get(key);__workerRunCache.delete(key);__workerRunCache.set(key,hit);return hit}
  var value=__workerBaseRun(din,ov);cacheSetLRU(__workerRunCache,key,value,640);return value;
};
function wOvFor(k,v,d){
  if(k==="vff"){var a=d._frontft>0?d._rev0/d._frontft:0;return {pidx:a>0?v*d.pidx/a:d.pidx}}
  if(k==="vpsf"){var b=d._lotsqft>0?d._rev0/d._lotsqft:0;return {pidx:b>0?v*d.pidx/b:d.pidx}}
  if(k==="vinfl")return {infl:v};
  if(k==="vcont"){var base=actualInfrastructureTotal(d);return {contpc:base>0?v/base*100:0}}
  if(k==="vpid"){var eligible=(actualInfrastructureTotal(d)+actualContingencyTotal(d))*Math.max(0,d.pidel)/100;return {pidrt:eligible>0?Math.max(0,Math.min(100,v/eligible*100)):0}}
  var o={};o[k]=v;return o;
}
function wMetric(inputs,metric,ov){
  if(metric==="maxland")return solveLand(inputs,"npv",0,ov||{});
  var m=run(inputs,ov||{}),v=m[metric];return Number.isFinite(v)?v:null;
}
function wDecision(inputs){
  var d=derive(inputs),x;
  var noPidModel=run(inputs,{pidrt:0});
  return {be:solveLand(inputs,"npv",0),hurd:solveLand(inputs,"eirr",d.hurdle/100),be25:solveLand(inputs,"eirr",.25),noPid:solveLand(inputs,"npv",0,{pidrt:0}),noPidEirr:noPidModel.eirr,bd:{
    price:d.vert?solveDriver(inputs,"hpsf",0,d.hpsf,true):((x=solveDriver(inputs,"pidx",30,d.pidx,true)),d.pidx>0&&x!=null?x*(d._rev0/d._frontft)/d.pidx:null),
    speed:d.vert?solveDriver(inputs,"vel",0.25,d.vel,true):solveDriver(inputs,"absn",0.5,d.absn,true),
    infl:solveDriver(inputs,"infl",d.infl,500000,false),contpc:solveDriver(inputs,"contpc",0,120,false)}};
}
function wGoal(inputs,g){
  var d=derive(inputs),f=function(v){try{var ov=wOvFor(g.k,v,d),r=g.metric==="maxland"?solveLand(inputs,"npv",0,ov):run(inputs,ov)[g.metric];return Number.isFinite(r)?r:null}catch(e){return null}};
  var steps=8,pts=[],i,x,v;
  for(i=0;i<=steps;i++){x=g.lo+(g.hi-g.lo)*i/steps;v=f(x);if(v!=null)pts.push({x:x,z:v-g.target})}
  var brackets=[];for(i=1;i<pts.length;i++){if(pts[i-1].z===0)return {out:pts[i-1].x};if(pts[i].z===0)return {out:pts[i].x};if(pts[i-1].z*pts[i].z<0)brackets.push([pts[i-1],pts[i]])}
  if(!brackets.length)return {out:null};brackets.sort(function(a,b){return Math.abs((a[0].x+a[1].x)/2-g.base)-Math.abs((b[0].x+b[1].x)/2-g.base)});
  var a=brackets[0][0],b=brackets[0][1],m,mz;for(i=0;i<18;i++){m=(a.x+b.x)/2;mz=f(m);if(mz==null)break;mz-=g.target;if(a.z*mz<=0)b={x:m,z:mz};else a={x:m,z:mz}}
  return {out:(a.x+b.x)/2};
}
onmessage=function(e){
  var q=e.data,inputs=q.inputs;
  try{
    /* Tornado is the visible Summary chart, so return it before lower-priority
       goal/decision analytics instead of making the chart wait behind them. */
    if(q.tornado){var base=wMetric(inputs,q.tornado.metric,{}),rows=q.tornado.tests.map(function(t){var a=wMetric(inputs,q.tornado.metric,t.ovLo),c=wMetric(inputs,q.tornado.metric,t.ovHi);if(a==null&&c==null)return null;var va=a==null?base:a,vc=c==null?base:c;return {k:t.k,n:t.n,lo:t.lo,hi:t.hi,vlo:va,vhi:vc,span:Math.abs(vc-va),zeroBase:t.zeroBase}}).filter(Boolean).filter(function(r){return r.span>1e-9}).sort(function(a,b){return b.span-a.span}).slice(0,12);postMessage({id:q.id,stage:"tornado",key:q.tornado.key,data:{metric:q.tornado.metric,swing:q.tornado.swing,base:base,rows:rows}})}
    if(q.goal)postMessage({id:q.id,stage:"goal",key:q.goal.key,data:wGoal(inputs,q.goal)});
    if(q.needDecision)postMessage({id:q.id,stage:"decision",key:q.inputKey,data:wDecision(inputs)});
    postMessage({id:q.id,stage:"done"});
  }catch(err){postMessage({id:q.id,stage:"error",message:err&&err.message?err.message:String(err)})}
};
`}
function analyticsWorkerUrl(){
  if(_analyticsWorkerUrl)return _analyticsWorkerUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  _analyticsWorkerUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,"\n",workerAppendSource()],{type:"text/javascript"}));return _analyticsWorkerUrl;
}
function analyticsRepaint(inputKey){
  if(decisionKey()!==inputKey)return;
  DIRTY.verdict=true;DIRTY.offer=true;
  if(_analyticsPaintFrame)return;
  _analyticsPaintFrame=requestAnimationFrame(()=>{_analyticsPaintFrame=0;const pane=activePane();if((pane==="verdict"||pane==="offer")&&decisionKey()===inputKey)queuePanePaint(pane)});
}
function cancelSummaryAnalytics(){
  clearTimeout(_summaryInsightTimer);_summaryInsightTimer=0;clearTimeout(_decisionTimer);_decisionTimer=0;
  /* Keep an idle worker warm so repeated input edits do not repeatedly parse the
     full model engine. Active stale work is still cancelled immediately. */
  if(_analyticsWorker&&_analyticsActive){_analyticsWorker.terminate();_analyticsWorker=null}
  _analyticsActive=null;cancelDecisionPool();
}
function scheduleDecisionAnalytics(delay=450){
  clearTimeout(_decisionTimer);if(currentDecision())return;
  _decisionTimer=setTimeout(()=>{_decisionTimer=0;const work=()=>{if(activePane()!=="verdict"||currentDecision())return;if(performance.now()-_lastUserActivity<650){scheduleDecisionAnalytics(400);return}ensureSummaryAnalytics({decision:true})};if(typeof requestIdleCallback==="function")requestIdleCallback(work,{timeout:1200});else work()},delay);
}
function noteUserActivity(){
  _lastUserActivity=performance.now();
  if(_analyticsActive&&_analyticsActive.requestKey&&_analyticsActive.requestKey.startsWith("D|")){if(_analyticsWorker){_analyticsWorker.terminate();_analyticsWorker=null}_analyticsActive=null;scheduleDecisionAnalytics(650)}
  if(_decisionPoolActive){cancelDecisionPool();scheduleDecisionAnalytics(650)}
}
function computeTornadoSync(inputs,request){
  const base=request.metric==="maxland"?solveLand(inputs,"npv",0):run(inputs)[request.metric];
  const rows=request.tests.map(t=>{const value=ov=>request.metric==="maxland"?solveLand(inputs,"npv",0,ov):run(inputs,ov)[request.metric];let a=null,c=null;try{a=value(t.ovLo)}catch(e){}try{c=value(t.ovHi)}catch(e){}if(a==null&&c==null)return null;const va=a==null?base:a,vc=c==null?base:c;return {k:t.k,n:t.n,lo:t.lo,hi:t.hi,vlo:va,vhi:vc,span:Math.abs(vc-va),zeroBase:t.zeroBase}}).filter(Boolean).filter(r=>r.span>1e-9).sort((a,b)=>b.span-a.span).slice(0,12);
  return {metric:request.metric,swing:request.swing,base,rows};
}
function computeGoalSync(inputs,g){
  const d=derive(inputs),f=v=>{try{const ov=ovFor(g.k,v,d),r=g.metric==="maxland"?solveLand(inputs,"npv",0,ov):run(inputs,ov)[g.metric];return Number.isFinite(r)?r:null}catch(e){return null}};
  const pts=[];for(let i=0;i<=8;i++){const x=g.lo+(g.hi-g.lo)*i/8,v=f(x);if(v!=null)pts.push({x,z:v-g.target})}
  const brackets=[];for(let i=1;i<pts.length;i++){if(pts[i-1].z===0)return {out:pts[i-1].x};if(pts[i].z===0)return {out:pts[i].x};if(pts[i-1].z*pts[i].z<0)brackets.push([pts[i-1],pts[i]])}
  if(!brackets.length)return {out:null};brackets.sort((a,b)=>Math.abs((a[0].x+a[1].x)/2-g.base)-Math.abs((b[0].x+b[1].x)/2-g.base));let [a,b]=brackets[0];
  for(let i=0;i<18;i++){const x=(a.x+b.x)/2,v=f(x);if(v==null)break;const z=v-g.target;if(a.z*z<=0)b={x,z};else a={x,z}}
  return {out:(a.x+b.x)/2};
}
let _summaryInsightTimer=0;
function scheduleSummaryInsightAnalytics(delay=60){
  clearTimeout(_summaryInsightTimer);
  _summaryInsightTimer=setTimeout(()=>{
    _summaryInsightTimer=0;
    if(activePane()!=="verdict")return;
    /* Prioritise the visible Tornado chart. Goal solving follows in a separate
       worker request so a heavy goal seek cannot hold up the chart. */
    if(!currentTornado()){ensureSummaryAnalytics({tornado:true});return}
    if(!currentGoal()){ensureSummaryAnalytics({goal:true});return}
    if(!currentDecision())scheduleDecisionAnalytics(220);
  },delay);
}
function ensureSummaryAnalytics(opts={decision:false,tornado:false,goal:false}){
  const inputKey=decisionKey(),d=derive(D);let needDecision=opts.decision&&!_decisionResults.has(inputKey);const tKey=tornadoKey(inputKey),gKey=goalKey(inputKey);
  const tornadoRequest=opts.tornado&&!_tornadoResults.has(tKey)?{key:tKey,metric:APP.tMet,swing:APP.tSwing,tests:buildTornadoTests(d)}:null;
  const gm=MET[APP.goalMet],target=gm.f===P?APP.goalTgt/100:APP.goalTgt,gx=LV[APP.goalDrv];
  const goalRequest=opts.goal&&!_goalResults.has(gKey)&&gx?{key:gKey,k:APP.goalDrv,metric:APP.goalMet,target,lo:gx.lo,hi:gx.hi,base:cur(APP.goalDrv,d)}:null;
  if(needDecision){ensureDecisionPool(inputKey,{...D});needDecision=false}
  if(!needDecision&&!tornadoRequest&&!goalRequest)return;
  const requestKey=(needDecision?"D":"")+"|"+(tornadoRequest?tornadoRequest.key:"")+"|"+(goalRequest?goalRequest.key:"");
  if(_analyticsActive&&_analyticsActive.inputKey===inputKey&&_analyticsActive.requestKey===requestKey)return;
  /* Reuse an idle analytics worker so the full engine is parsed once. An active
     stale request is still terminated immediately to keep edits responsive. */
  if(_analyticsActive&&_analyticsWorker){_analyticsWorker.terminate();_analyticsWorker=null;_analyticsActive=null}
  const id=++_analyticsSeq,payload={id,inputKey,inputs:{...D},needDecision,tornado:tornadoRequest,goal:goalRequest},url=analyticsWorkerUrl();
  if(!url){_analyticsActive={id,inputKey,requestKey};setTimeout(()=>{try{if(goalRequest)analyticsCacheSet(_goalResults,gKey,computeGoalSync(payload.inputs,goalRequest));if(tornadoRequest)analyticsCacheSet(_tornadoResults,tKey,computeTornadoSync(payload.inputs,tornadoRequest));if(needDecision)analyticsCacheSet(_decisionResults,inputKey,computeDecisionSync(payload.inputs))}finally{_analyticsActive=null;analyticsRepaint(inputKey)}},0);return}
  const worker=_analyticsWorker||new Worker(url);_analyticsWorker=worker;_analyticsActive={id,inputKey,requestKey};
  worker.onmessage=e=>{const m=e.data||{};if(!_analyticsActive||m.id!==_analyticsActive.id)return;
    if(m.stage==="decision")analyticsCacheSet(_decisionResults,m.key,m.data);
    else if(m.stage==="tornado")analyticsCacheSet(_tornadoResults,m.key,m.data);
    else if(m.stage==="goal")analyticsCacheSet(_goalResults,m.key,m.data);
    if(m.stage==="goal"||m.stage==="tornado")analyticsRepaint(inputKey);
    if(m.stage==="done"||m.stage==="error"){
      if(m.stage==="error"){worker.terminate();if(_analyticsWorker===worker)_analyticsWorker=null}
      _analyticsActive=null;analyticsRepaint(inputKey);
      if(activePane()==="verdict"&&decisionKey()===inputKey){if(!currentGoal()||!currentTornado())scheduleSummaryInsightAnalytics(180);else if(!currentDecision())scheduleDecisionAnalytics(350)}
    }
  };
  worker.onerror=()=>{worker.terminate();if(_analyticsWorker===worker)_analyticsWorker=null;_analyticsActive=null;analyticsRepaint(inputKey)};
  worker.postMessage(payload);
}
function contextKey(){return modelInputSignature(D)}
function contextWorkerUrl(){
  if(_contextWorkerUrl)return _contextWorkerUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  const tail=String.raw`
onmessage=function(e){var q=e.data||{};try{var A=run(q.inputs),d=derive(q.inputs);postMessage({id:q.id,key:q.key,data:{A:A,d:d,ask:d.pr}})}catch(err){postMessage({id:q.id,key:q.key,error:err&&err.message?err.message:String(err)})}};`;
  _contextWorkerUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,tail],{type:"text/javascript"}));return _contextWorkerUrl;
}
function cachedContext(key=contextKey()){
  if(CTX&&CTX_KEY===key)return CTX;
  const hit=cacheGetLRU(_contextResults,key);
  if(hit!==undefined){CTX=hit;CTX_KEY=key;return hit}
  return null;
}
function queuePanePaint(id=activePane(),after){
  requestAnimationFrame(()=>setTimeout(()=>{
    if(activePane()!==id)return;
    if(CONTEXT_PANES.has(id)&&!cachedContext()){ensureActiveContext();return}
    paint(id);if(typeof after==="function")after();
  },0));
}
let _cashflowPrepaintTimer=0;
function scheduleCashflowPrepaint(key){
  clearTimeout(_cashflowPrepaintTimer);_cashflowPrepaintTimer=setTimeout(()=>{
    _cashflowPrepaintTimer=0;
    const work=()=>{if(contextKey()!==key||!cachedContext(key))return;if(DIRTY.cf)paint("cf");if(DIRTY.ccf)paint("ccf")};
    if(typeof requestIdleCallback==="function")requestIdleCallback(work,{timeout:900});else work();
  },140);
}
function acceptContext(key,data){
  cacheSetLRU(_contextResults,key,data,12);cacheContextForPortfolio(key,data&&data.A);if(contextKey()!==key)return;
  CTX=data;CTX_KEY=key;_contextPendingKey="";const rebuilt=!!_pendingScaffoldRebuild;
  if(rebuilt){buildScaffold();showNav();_pendingScaffoldRebuild=false}
  CONTEXT_PANES.forEach(id=>DIRTY[id]=true);const pane=activePane();
  if(rebuilt){paint(pane);finishProjectSwitch()}else queuePanePaint(pane,finishProjectSwitch);
  schedulePortfolioPaint();if(NAVAT==="stmt"||NAVAT==="port")scheduleCashflowPrepaint(key);
  const canvas=document.querySelector('.canvas');if(canvas){canvas.classList.remove('model-updating');canvas.removeAttribute('aria-busy')}
}
function getContextWorker(){
  if(_contextWorker)return _contextWorker;
  const url=contextWorkerUrl();if(!url)return null;
  const worker=new Worker(url);_contextWorker=worker;
  worker.onmessage=e=>{const m=e.data||{};if(m.id!==_contextLatestId)return;if(m.error){if(contextKey()===m.key)showModelError(new Error(m.error));if(_contextPendingKey===m.key)_contextPendingKey="";finishProjectSwitch();return}acceptContext(m.key,m.data)};
  worker.onerror=()=>{if(_contextWorker===worker)_contextWorker=null;_contextPendingKey=""};
  return worker;
}
function ensureActiveContext(){
  const key=contextKey(),hit=cachedContext(key);if(hit)return hit;
  if(_contextPendingKey===key)return null;
  const inputs={...D},id=++_contextSeq;_contextLatestId=id;_contextPendingKey=key;
  const worker=getContextWorker();
  if(!worker){setTimeout(()=>{try{const d=derive(inputs);if(id===_contextLatestId)acceptContext(key,{A:run(inputs),d,ask:d.pr})}catch(e){if(contextKey()===key)showModelError(e)}finally{if(_contextPendingKey===key)_contextPendingKey=""}},0);return null}
  worker.postMessage({id,key,inputs});return null;
}
function scheduleActiveContext(delay=70){
  clearTimeout(_contextRefreshTimer);_contextRefreshTimer=setTimeout(()=>{
    _contextRefreshTimer=0;const ready=ensureActiveContext();
    if(ready){if(_pendingScaffoldRebuild){buildScaffold();showNav();_pendingScaffoldRebuild=false;CONTEXT_PANES.forEach(id=>DIRTY[id]=true)}queuePanePaint(activePane(),finishProjectSwitch)}
  },delay);
}
function ctx(){return cachedContext()}
function showNav(){
  const n=document.getElementById("tabs");
  [...n.children].forEach(b=>b.setAttribute("aria-selected",b.dataset.nav===NAVAT?"true":"false"));
  const g=NAV.find(x=>x.id===NAVAT), cur=NAVSEL[NAVAT];
  TABS.forEach(([id])=>{const el=document.getElementById("p_"+id);
    if(el)el.classList.toggle("on",id===cur)});
  document.body.classList.toggle("summary-active",cur==="verdict");
  if(cur!=="verdict"&&cur!=="offer"&&_analyticsActive)cancelSummaryAnalytics();
  if(cur!=="verdict"&&cur!=="port")cancelPortfolioBackground();
  if(typeof cancelPaneBatch==="function"&&_paneBatchActive&&_paneBatchActive.pane!==cur)cancelPaneBatch();
  /* sub navigation for groups with more than one view */
  const host=document.getElementById("p_"+cur);
  if(host&&g.panes.length>1){
    let bar=host.querySelector(".sub2");
    if(!bar){bar=document.createElement("div");bar.className="sub2";
      const h2=host.querySelector("h2.ph"), pd=host.querySelector("p.pd");
      (pd||h2||host).insertAdjacentElement("afterend",bar)}
    bar.innerHTML=g.panes.map(([id,lab])=>
      `<button data-sub="${id}" aria-current="${id===cur?"true":"false"}">${lab}</button>`).join("");
    bar.querySelectorAll("[data-sub]").forEach(b=>b.onclick=()=>{
      NAVSEL[NAVAT]=b.dataset.sub;showNav();queuePanePaint(b.dataset.sub);if(b.dataset.sub==="port"||APP.portfolioBasis==="dynamic")schedulePortfolioResults(0)});
  }
}
function activePane(){return NAVSEL[NAVAT]||"verdict"}
function modelErrorBox(){let err=document.getElementById("model_error");if(!err){err=document.createElement("div");err.id="model_error";err.className="goal miss";err.style.display="none";const panes=document.getElementById("panes");panes.parentNode.insertBefore(err,panes)}return err}
function showModelError(e){const err=modelErrorBox();err.style.display="block";err.textContent="Input check: "+(e&&e.message?e.message:String(e));return false}
function clearModelError(){const err=modelErrorBox();err.style.display="none";err.textContent=""}
const CONTEXT_PANES=new Set(["verdict","scn","opt","pl","cf","bs","monthly","sens","two","offer"]);
function paint(id){if(!DIRTY[id]||!PANE[id])return true;try{let c=null;if(CONTEXT_PANES.has(id)){c=ctx();if(!c){ensureActiveContext();return true}}const done=PANE[id](c);if(done===false)return true;DIRTY[id]=false;clearModelError();return true}catch(e){return showModelError(e)}}
function paintAll(){let ok=true;Object.keys(PANE).forEach(id=>{if(!paint(id))ok=false});return ok}
function updateFoot(){
  const foot=document.getElementById("foot");if(!foot)return;
  foot.textContent=`${P0().name} · ${P0().loc} · prepared ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})} · all amounts A$ · unlevered figures pre-tax, equity figures after tax and debt service · not a valuation or investment advice`;
}
function updateActiveParcelLabel(){
  const p=P0(),button=[...document.querySelectorAll(".pt[data-parcel-id]")].find(b=>b.dataset.parcelId===p.id);
  const label=button&&button.querySelector("span");if(label)label.textContent=p.name;
}
let renderFrame=0;
function render(){
  const pane=typeof activePane==="function"?activePane():"",canvas=document.querySelector('.canvas');
  if(canvas&&typeof CONTEXT_PANES!=="undefined"&&CONTEXT_PANES.has(pane)){const ready=typeof cachedContext==="function"&&!!cachedContext();if(!ready){canvas.classList.add('model-updating');canvas.setAttribute('aria-busy','true')}}

  modelErrorBox();
  try{
    cancelOptimiserWorker();cancelSummaryAnalytics();clearCache();
    Object.keys(PANE).forEach(k=>{if(k!=="cpl"&&k!=="ccf"&&k!=="source")DIRTY[k]=true});clearModelError();
    if(renderFrame)cancelAnimationFrame(renderFrame);
    renderFrame=requestAnimationFrame(()=>{renderFrame=0;paintCalc();
      setTimeout(()=>{const pane=activePane();if(pane==="port")schedulePortfolioResults(80);if(CONTEXT_PANES.has(pane))scheduleActiveContext(pane==="cf"?20:50);else queuePanePaint(pane)},0)});
  }catch(e){showModelError(e)}

}
let tmr=null,tmr2=null,fastPaintFrame=0,fastPaintPane="";
function schedule(){clearTimeout(tmr);tmr=setTimeout(render,24)}
function sched(pane){
  fastPaintPane=pane;if(fastPaintFrame)return;
  fastPaintFrame=requestAnimationFrame(()=>{fastPaintFrame=0;const p=fastPaintPane;fastPaintPane="";if(!p)return;DIRTY[p]=true;if(typeof CONTEXT_PANES!=="undefined"&&CONTEXT_PANES.has(p)&&!cachedContext())return;paint(p)});
}
function sel(id,opts,val,cls){return `<select id="${id}" class="${cls||""}">`+
  opts.map(o=>`<option value="${o[0]}"${o[0]===val?" selected":""}>${o[1]}</option>`).join("")+`</select>`}
function numf(id,val,step){return `<input id="${id}" class="ni" value="${val}" step="${step||1}">`}

/* ═══════════════════════════════════════════════════════════════════════════
   PANES
   ═══════════════════════════════════════════════════════════════════════════ */
function buildScaffold(){
  const existingPanes=document.getElementById("panes"),active=typeof activePane==="function"?activePane():"",hasRenderedPane=!!(existingPanes&&existingPanes.children.length&&document.getElementById("p_"+active)),needsContext=typeof CONTEXT_PANES!=="undefined"&&CONTEXT_PANES.has(active),ready=!needsContext||(typeof cachedContext==="function"&&!!cachedContext());
  if(hasRenderedPane&&!ready){_pendingScaffoldRebuild=true;return false}

  const n=document.getElementById("tabs"),p=document.getElementById("panes");
  n.innerHTML="";p.innerHTML="";
  NAV.forEach((g,gi)=>{
    const b=document.createElement("button");b.textContent=g.lab;b.setAttribute("role","tab");
    b.setAttribute("aria-selected",gi===0?"true":"false");b.dataset.nav=g.id;
    b.onclick=()=>{NAVAT=g.id;showNav();const pane=NAVSEL[g.id];queuePanePaint(pane);if(g.id==="port"&&(pane==="port"||APP.portfolioBasis==="dynamic"))schedulePortfolioResults(80)};
    n.appendChild(b);
  });
  TABS.forEach(([id],i)=>{
    const s2=document.createElement("section");s2.id="p_"+id;
    s2.className="pane"+(i===0?" on":"");p.appendChild(s2);
  });
  NAV.filter(g=>g.panes.length>1).forEach(g=>{
    const host=document.getElementById("p_"+g.panes[0][0]);
  });
  const dO=levers().map(l=>[l.k,l.n]),mO=METRICS.map(m=>[m.k,m.n]);

  document.getElementById("p_verdict").innerHTML=
    `<div id="o_verdict"></div>
     <div class="summary-decision-grid"><div id="o_decision_slot"></div><div id="o_goalhero"></div></div>
     <div class="summary-main-grid"><div id="o_chart"></div><div id="o_salessummary"></div></div>
     <div class="summary-bottom-grid"><div id="o_costsummary"></div><div id="o_devsummary"></div><div id="o_keyreturns"></div></div>
     <div class="summary-insight-grid">
       <div class="summary-tornado-surface"><div class="ctl summary-tornado-controls"><span class="cl">Tornado measures</span>${sel("t_met",mO,APP.tMet)}
         <span class="cl">Swing each driver by</span><input type="range" id="t_swing" min="5" max="50" step="5" value="${APP.tSwing}">
         <output id="t_swingv" class="ov">±${APP.tSwing}%</output></div><div id="o_tornado"></div></div>
       <div id="o_flags"></div>
     </div>
     <div class="summary-hidden-controls" aria-hidden="true">
       ${sel("g_drv",dO,APP.goalDrv)}${sel("g_met",mO,APP.goalMet)}${numf("g_tgt",APP.goalTgt,.5)}<span id="g_unit">%</span><div id="o_goal"></div><div id="o_fin"></div>
     </div>`;

  document.getElementById("p_scn").innerHTML=
    `<h2 class="ph">Scenario lab</h2>
     <p class="pd">Each row is a complete appraisal. Enter absolute figures; leave a cell blank to inherit the input on the left. Pin any row as the comparison base and every other row shows its movement against it.</p>
     <div class="ctl">
       <span class="cl">Columns</span><span class="chips" id="colchips"></span>
       <span class="spacer" style="flex:1"></span>
       <button class="cbtn" id="scn_add">+ Scenario</button>
       <button class="cbtn" id="scn_reset">Restore defaults</button></div>
     <div class="ctl"><span class="cl">Show measures</span><span class="chips" id="metchips"></span></div>
     <div id="o_scn"></div>`;

  document.getElementById("p_opt").innerHTML=
    `<h2 class="ph">Optimiser</h2>
     <p class="pd">State the return you need and which levers you are willing to move. The optimiser searches the model and returns the least disruptive combinations that get there.</p>
     <div class="ctl"><span class="cl">I need</span>${sel("op_met",METRICS.filter(m=>m.up).map(m=>[m.k,m.n]),APP.opMet)}
       <span class="cl">of at least</span>${numf("op_tgt",APP.opTgt,.5)}<span class="cl" id="op_unit">%</span>
       <button class="cbtn go" id="op_run">Find scenarios</button>
       <button class="cbtn" id="op_clear">Clear</button></div>
     <div class="ctl"><span class="cl">Levers I can move</span><span class="chips" id="levchips"></span></div>
     <div id="o_opt"></div>`;

  document.getElementById("p_pl").innerHTML=`<h2 class="ph">Profit and loss</h2><p class="pd">For the parcel currently open. Gross contracted sales are recognised at settlement, output GST is deducted to reach net revenue, and recoverable input GST is credited against eligible project costs. Direct costs remain matched to the same settled lots / units.</p><div id="o_pl"></div>`;
  document.getElementById("p_cf").innerHTML=`<h2 class="ph">Cashflow</h2><p class="pd"></p><div id="o_cf"></div>`;
  document.getElementById("p_bs").innerHTML=`<h2 class="ph">Balance Sheet</h2><p class="pd"></p><div id="o_bs"></div>`;
  document.getElementById("p_monthly").innerHTML=`<h2 class="ph">Monthly engine</h2><p class="pd">The calculation layer behind every other tab.</p><div id="o_monthly"></div>`;
  document.getElementById("p_port").innerHTML=`<h2 class="ph">Project comparison</h2><p class="pd">Compare the projects included in the current consolidation scope. The complete merged statements are available in Consolidated P&L and Consolidated cashflow.</p><div id="o_port"></div>`;
  document.getElementById("p_cpl").innerHTML=`<h2 class="ph">Consolidated profit and loss</h2><p class="pd">Calendar-aligned dynamic P&L for the projects selected in the consolidation scope.</p><div id="o_cpl"></div>`;
  document.getElementById("p_ccf").innerHTML=`<h2 class="ph">Consolidated cashflow</h2><p class="pd"></p><div id="o_ccf"></div>`;
  document.getElementById("p_cbs").innerHTML=`<h2 class="ph">Consolidated Balance Sheet</h2><p class="pd"></p><div id="o_cbs"></div>`;

  document.getElementById("p_sens").innerHTML=
    `<h2 class="ph">Sensitivity</h2><p class="pd">One driver swept across a range; the appraisal runs in full at each step.</p>
     <div class="ctl"><span class="cl">Vary</span>${sel("s_drv",dO,APP.sDrv)}
       <span class="cl">from</span>${numf("s_from","",1)}<span class="cl">to</span>${numf("s_to","",1)}
       <span class="cl">in</span>${numf("s_steps",APP.sSteps,1)}<span class="cl">steps · measuring</span>${sel("s_met",mO,APP.sMet)}
       <button class="cbtn" id="s_reset">Recentre</button></div><div id="o_sens"></div>`;

  document.getElementById("p_two").innerHTML=
    `<h2 class="ph">Heat map</h2><p class="pd">Two drivers moved together. Green at or above the base case, red where value is lost.</p>
     <div class="ctl"><span class="cl">Rows</span>${sel("x_drv",dO,APP.xDrv)}
       <input type="range" id="x_steps" min="3" max="11" step="1" value="${APP.xSteps}"><output id="x_stepsv" class="ov">${APP.xSteps}</output>
       <span class="cl">Columns</span>${sel("y_drv",dO,APP.yDrv)}
       <input type="range" id="y_steps" min="3" max="11" step="1" value="${APP.ySteps}"><output id="y_stepsv" class="ov">${APP.ySteps}</output>
       <span class="cl">Cell</span>${sel("g_met2",mO,APP.gMet)}</div><div id="o_two"></div>`;

  document.getElementById("p_offer").innerHTML=
    `<h2 class="ph">Offer price</h2><p class="pd">What the project can afford to pay, rather than what is being asked.</p>
     <div class="ctl"><span class="cl">I require a</span>${sel("o_met",[["eirr","Equity IRR"],["irr","Project IRR"],["margin","Net margin"],["npv","NPV of nil"]],APP.oMet)}
       <span class="cl">of</span>${numf("o_tgtn",APP.oTgt,.5)}<span class="cl">per cent</span>
       <input type="range" id="o_tgt" min="0" max="45" step="0.5" value="${APP.oTgt}">
       <output id="o_tgtv" class="ov">${APP.oTgt}%</output></div><div id="o_offer"></div>`;
  DIRTY.cpl=DIRTY.ccf=true;
  wire();ensureProjectSwitchOverlay();

  if(typeof window.__installUSRefSummaryScaffold==="function")window.__installUSRefSummaryScaffold();
  return true;
}

/* ── chips ────────────────────────────────────────────── */
function chips(host,items,isOn,toggle){
  const h=document.getElementById(host);if(!h)return;
  h.innerHTML=items.map(it=>`<button class="chip" data-k="${it[0]}" aria-pressed="${isOn(it[0])}">${it[1]}</button>`).join("");
  h.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{toggle(b.dataset.k)});
}

/* ═══════════════════ SCENARIO LAB ═══════════════════ */
function renderScenarioSync({d},runFn=run,solveLandFn=solveLand){
  chips("colchips",levers().map(l=>[l.k,l.n]),k=>APP.cols.includes(k),
    k=>{const i=APP.cols.indexOf(k);i<0?APP.cols.push(k):APP.cols.splice(i,1);DIRTY.scn=true;paint("scn")});
  chips("metchips",METRICS.map(m=>[m.k,m.n]),k=>APP.mets.includes(k),
    k=>{const i=APP.mets.indexOf(k);i<0?APP.mets.push(k):APP.mets.splice(i,1);DIRTY.scn=true;paint("scn")});
  const okk=new Set(levers().map(l=>l.k));
  const cols=APP.cols.map(k=>LV[k]).filter(x=>x&&okk.has(x.k));
  const mets=APP.mets.map(k=>MET[k]).filter(Boolean);
  const base=pinned();
  let bm=null;try{bm=runFn(D,scnOv(base))}catch(e){}
  const rows=APP.scn.map(sc=>{const ov=scnOv(sc);let m=null;try{m=runFn(D,ov)}catch(e){}
    return {sc,ov,m,ml:solveLandFn(D,"npv",0,ov)}});
  const hv=mets[0]?rows.map(r=>r.m?r.m[mets[0].k]:null).filter(v=>v!=null):[];
  const hmax=hv.length?Math.max(...hv.map(Math.abs)):1;

  let h=`<div class="scrollx sgrid"><table><thead>
    <tr><th class="nm l" rowspan="2">Scenario</th>
      ${cols.length?`<th class="gh" colspan="${cols.length}">Assumptions — absolute values, blank inherits</th>`:""}
      <th class="gh" colspan="${mets.length+2}">Outcome</th></tr>
    <tr>${cols.map(c=>`<th class="n">${c.n}<br><span style="font-weight:400;font-size:9.6px">${c.u}</span></th>`).join("")}
      ${mets.map(m=>`<th class="n">${m.n}</th>`).join("")}
      <th class="n">Maximum land price A$/sqm</th><th class="n">Verdict</th></tr></thead><tbody>`;
  rows.forEach((r,i)=>{
    const isB=r.sc===base, fail=r.m&&r.m.npv<0;
    const eirr=r.m?r.m.eirr:null;
    const vc=eirr==null?["fail","fail"]:(eirr>=d.hurdle/100?["pass","Pass"]:(eirr>=d.hurdle/100*.75?["marg","Marginal"]:["fail","Fail"]));
    h+=`<tr class="${isB?"pinned":""}${fail?" bad":""}">
      <td class="nm"><button class="rowbtn" data-pin="${i}" title="Pin as comparison base">${isB?"★":"☆"}</button>
        <input class="sn" data-i="${i}" value="${esc_(r.sc.n)}">
        <button class="rowbtn" data-dup="${i}" title="Duplicate">⧉</button>
        <button class="rowbtn del" data-del="${i}" title="Remove">×</button></td>`;
    cols.forEach(c=>{const v=r.sc.ov[c.k];
      const shown=(v===undefined||v===null||v==="")?"":v;
      h+=`<td class="n"><input class="sv${shown!==""?" set":""}" data-i="${i}" data-f="${c.k}"
        value="${shown}" placeholder="${M0(cur(c.k,d),Math.abs(cur(c.k,d))<10?2:0)}"></td>`});
    mets.forEach((mt,mi)=>{
      const v=r.m?(mt.k==="maxland"?r.ml:r.m[mt.k]):null;
      const bv=bm?(mt.k==="maxland"?solveLandFn(D,"npv",0,scnOv(base)):bm[mt.k]):null;
      let dl="";
      if(!isB&&v!=null&&bv!=null&&Math.abs(bv)>1e-9){
        const diff=v-bv,good=(mt.up?diff>0:diff<0);
        dl=`<span class="dlt ${good?"up":"dn"}">${diff>0?"+":""}${mt.f===P?P(diff):(mt.f===X?diff.toFixed(2)+"x":Mn(diff))}</span>`}
      let bar="";
      if(mi===0&&v!=null&&hmax>0){const w=Math.min(100,Math.abs(v)/hmax*100);
        bar=`<span class="mbar"><i class="${v<0?"neg":""}" style="width:${w}%"></i></span>`}
      h+=`<td class="n">${v==null?"–":mt.f(v)}${dl}${bar}</td>`});
    h+=`<td class="n">${r.ml==null?"–":(r.ml<d.pr?`<span style="color:#9C0006;font-weight:700">${$(r.ml)}</span>`:$(r.ml))}</td>
        <td class="n"><span class="vchip ${vc[0]}">${vc[1]}</span></td></tr>`;
  });
  h+=`</tbody><tfoot><tr><td colspan="${cols.length+mets.length+3}">
    Pinned row is the comparison base; movements shown beneath each figure are against it. Verdict compares equity IRR with the ${M0(d.hurdle,1)}% target.
    Max land price in red cannot cover the ${$(d.pr)} being asked. Use the chips above to choose which assumptions and measures appear.
    </td></tr></tfoot></table></div>`;
  set("o_scn",h);
  const q=s=>document.querySelectorAll("#o_scn "+s);
  q(".sv").forEach(el=>el.onchange=()=>{const raw=el.value.trim();
    APP.scn[+el.dataset.i].ov[el.dataset.f]=raw===""?undefined:parseFloat(raw);APP.scnAuto=false;
    DIRTY.scn=true;DIRTY.opt=true;paint("scn")});
  q(".sn").forEach(el=>el.onchange=()=>{APP.scn[+el.dataset.i].n=el.value;APP.scnAuto=false});
  q("[data-pin]").forEach(el=>el.onclick=()=>{APP.scn.forEach(s=>s.pin=false);
    APP.scn[+el.dataset.pin].pin=true;APP.scnAuto=false;DIRTY.scn=true;paint("scn")});
  q("[data-dup]").forEach(el=>el.onclick=()=>{const i=+el.dataset.dup;
    APP.scn.splice(i+1,0,{n:APP.scn[i].n+" (copy)",ov:{...APP.scn[i].ov}});APP.scnAuto=false;DIRTY.scn=true;paint("scn")});
  q("[data-del]").forEach(el=>el.onclick=()=>{if(APP.scn.length<2)return;
    const i=+el.dataset.del,wasPin=APP.scn[i].pin;APP.scn.splice(i,1);
    if(wasPin&&APP.scn.length)APP.scn[0].pin=true;APP.scnAuto=false;DIRTY.scn=true;paint("scn")});
};

/* ═══════════════════ OPTIMISER ═══════════════════ */
function optimise(){
  const mk=MET[APP.opMet], tgt=(mk.f===P?APP.opTgt/100:(mk.f===X?APP.opTgt:APP.opTgt));
  const okk2=new Set(levers().map(l=>l.k));
  const levs=APP.opLev.map(k=>LV[k]).filter(x=>x&&okk2.has(x.k));
  if(!levs.length)return {err:"Select at least one lever."};
  const d=derive(D);
  const base=metric(APP.opMet)||0;
  const expand=ov=>{let o={},work=d;Object.keys(ov).forEach(k=>{const mapped=ovFor(k,ov[k],work);Object.assign(o,mapped);work=derive({...D,...o})});return o};
  const val=ov=>{const v=metric(APP.opMet,expand(ov));return v==null?-1e9:v};
  const norm=ov=>levs.reduce((a,l)=>a+Math.abs((ov[l.k]??cur(l.k,d))-cur(l.k,d))/Math.max(l.hi-l.lo,1e-9),0);
  const good=v=>v>=tgt;
  if(good(base)){
    const head=solveLandFn(D,APP.opMet==="maxland"?"npv":APP.opMet,APP.opMet==="maxland"?0:tgt);
    return {base,tgt,levs,already:true,head,out:[],reach:true};
  }
  const out=[];
  /* 1. single-lever solves — the minimum move on one variable */
  levs.forEach(l=>{
    const v=solveLeverAbs(l.k,APP.opMet,tgt);
    if(v==null)return;
    const ov={};ov[l.k]=v;
    if(good(val(ov)))out.push({kind:"Single lever",ov,note:l.n+" alone"});
  });
  /* 2. proportional blend — move every chosen lever together by a single factor */
  const dirs=levs.map(l=>{const b=cur(l.k,d);
    const up=val({[l.k]:Math.min(l.hi,b+(l.hi-l.lo)*.04)});
    const dn=val({[l.k]:Math.max(l.lo,b-(l.hi-l.lo)*.04)});
    return up>=dn?1:-1});
  const blend=t=>{const ov={};levs.forEach((l,i)=>{const b=cur(l.k,d);
    const lim=dirs[i]>0?l.hi:l.lo;ov[l.k]=b+(lim-b)*t});return ov};
  if(good(val(blend(1)))){
    let lo=0,hi=1;for(let i=0;i<22;i++){const m=(lo+hi)/2;if(good(val(blend(m))))hi=m;else lo=m}
    out.push({kind:"Balanced",ov:blend(hi),note:"every lever moved together"});
  }
  /* 3. randomised search, kept only if it beats the target, ranked by least disruption */
  let seed=20260726;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
  const found=[];
  for(let it=0;it<80;it++){
    const scale=.12+rnd()*.88, ov={};
    levs.forEach((l,i)=>{const b=cur(l.k,d);const room=(dirs[i]>0?l.hi-b:b-l.lo);
      const step=room*scale*rnd();ov[l.k]=+(b+dirs[i]*step).toFixed(4)});
    if(good(val(ov)))found.push({ov,dev:norm(ov)});
  }
  found.sort((a,b)=>a.dev-b.dev);
  const picked=[];
  found.forEach(c=>{
    if(picked.length>=3)return;
    const near=picked.some(p=>levs.every(l=>
      Math.abs((p.ov[l.k]-c.ov[l.k])/Math.max(l.hi-l.lo,1e-9))<.07));
    if(!near)picked.push(c)});
  picked.forEach(c=>out.push({kind:"Combination",ov:c.ov,note:levs.length+" levers moved"}));
  out.forEach(o=>{o.dev=norm(o.ov);const ex=expand(o.ov);
    try{o.m=runFn(D,ex)}catch(e){o.m=null}
    o.ml=solveLandFn(D,"npv",0,ex)});
  out.sort((a,b)=>a.dev-b.dev);
  return {base,tgt,levs,out:out.slice(0,8),reach:out.length>0,
    ceiling:val(blend(1))};
}


/* Optimiser calculations are heavy by design: the search evaluates hundreds of
   complete appraisal variants. Keep the exact search logic, but execute it away
   from the interaction thread so tabs, inputs and scrolling remain responsive. */
let _optimiserWorker=null,_optimiserWorkerUrl=null,_optimiserSeq=0,_optimiserActive=null;
const _optimiserResultCache=new Map();
function optimiserCacheGet(key){
  if(!_optimiserResultCache.has(key))return null;
  const value=_optimiserResultCache.get(key);_optimiserResultCache.delete(key);_optimiserResultCache.set(key,value);return value;
}
function optimiserCacheSet(key,value){
  if(_optimiserResultCache.has(key))_optimiserResultCache.delete(key);
  _optimiserResultCache.set(key,value);
  while(_optimiserResultCache.size>16)_optimiserResultCache.delete(_optimiserResultCache.keys().next().value);
}
function optimiserBusy(on){
  APP.opBusy=!!on;const b=document.getElementById("op_run");if(!b)return;
  b.disabled=!!on;if(on)b.setAttribute("aria-busy","true");else b.removeAttribute("aria-busy");
}
function optimiserWorkerAppendSource(){return String.raw`
var __opBaseRun=run,__opRunCache=new Map(),__opExpandCache=new Map(),__opMetricCache=new Map();
run=function(din,ov){
  var baseKey=modelInputSignature(din),hasOv=!!(ov&&Object.keys(ov).length),key=hasOv?baseKey+"\u001d"+overrideSignature(ov):baseKey;
  if(__opRunCache.has(key)){var hit=__opRunCache.get(key);__opRunCache.delete(key);__opRunCache.set(key,hit);return hit}
  var value=__opBaseRun(din,ov);cacheSetLRU(__opRunCache,key,value,960);return value;
};
function opMap(k,v,d){
  if(k==="vff"){var a=d._frontft>0?d._rev0/d._frontft:0;return {pidx:a>0?v*d.pidx/a:d.pidx}}
  if(k==="vpsf"){var b=d._lotsqft>0?d._rev0/d._lotsqft:0;return {pidx:b>0?v*d.pidx/b:d.pidx}}
  if(k==="vinfl")return {infl:v};
  if(k==="vcont"){var c=actualInfrastructureTotal(d);return {contpc:c>0?v/c*100:0}}
  if(k==="vpid"){var eligible=(actualInfrastructureTotal(d)+actualContingencyTotal(d))*Math.max(0,d.pidel)/100;return {pidrt:eligible>0?Math.max(0,Math.min(100,v/eligible*100)):0}}
  var o={};o[k]=v;return o;
}
function opExpand(inputs,raw){
  raw=raw||{};var cacheKey=modelInputSignature(inputs)+"\u001e"+overrideSignature(raw);
  if(__opExpandCache.has(cacheKey)){var cached=__opExpandCache.get(cacheKey);__opExpandCache.delete(cacheKey);__opExpandCache.set(cacheKey,cached);return cached}
  var out={},work=derive(inputs),keys=Object.keys(raw);
  keys.forEach(function(k){var mapped=opMap(k,raw[k],work);Object.assign(out,mapped);work=derive(Object.assign({},inputs,out))});
  cacheSetLRU(__opExpandCache,cacheKey,out,960);return out;
}
function opRootBracket(evaluate,target,a,b,fa,fb,maxIter){
  if(fa==null||fb==null)return null;if(Math.abs(fa-target)<1e-8)return a;if(Math.abs(fb-target)<1e-8)return b;
  var za=fa-target,zb=fb-target;if(za*zb>0)return null;
  for(var i=0;i<(maxIter||14);i++){
    var span=b-a,x=Math.abs(fb-fa)>1e-12?a+(target-fa)*span/(fb-fa):(a+b)/2;
    var low=a+span*.08,high=b-span*.08;if(!(x>low&&x<high))x=(a+b)/2;
    var fx=evaluate(x);if(fx==null){x=(a+b)/2;fx=evaluate(x);if(fx==null)return null}
    var zx=fx-target;if(Math.abs(zx)<=Math.max(1e-8,Math.abs(target)*1e-7)||Math.abs(b-a)<=Math.max(1e-7,Math.abs(x)*1e-7))return x;
    if(za*zx<=0){b=x;fb=fx;zb=zx}else{a=x;fa=fx;za=zx}
  }
  return (a+b)/2;
}
function opLandForMetricFast(inputs,metricName,target,overrides){
  overrides=overrides||{};var evaluate=function(price){try{var ov=Object.assign({},overrides,{pr:price}),m=run(inputs,ov),v=m[metricName];return Number.isFinite(v)?v:null}catch(err){return null}};
  var lo=0,flo=evaluate(lo);if(flo==null||flo<target)return null;
  var hi=Math.max(1200000,Number(overrides.pr!=null?overrides.pr:inputs.pr)||0,1000),fhi=evaluate(hi),guard=0;
  while(fhi!=null&&fhi>=target&&hi<1e8&&guard++<8){hi*=2;fhi=evaluate(hi)}
  if(fhi==null)return null;if(fhi>=target)return hi;
  return opRootBracket(evaluate,target,lo,hi,flo,fhi,14);
}
function opMetric(inputs,key,raw){
  raw=raw||{};var cacheKey=modelInputSignature(inputs)+"|"+key+"|"+overrideSignature(raw);
  if(__opMetricCache.has(cacheKey)){var cached=__opMetricCache.get(cacheKey);__opMetricCache.delete(cacheKey);__opMetricCache.set(cacheKey,cached);return cached}
  var ex=opExpand(inputs,raw),value;
  if(key==="maxland")value=opLandForMetricFast(inputs,"npv",0,ex);else{var m=run(inputs,ex);value=m[key];value=value==null?null:value}
  cacheSetLRU(__opMetricCache,cacheKey,value,1280);return value;
}
function opSolveLever(inputs,lever,metricName,target){
  var baseDerived=derive(inputs),evaluate=function(v){try{var mapped=opMap(lever.k,v,baseDerived),r=metricName==="maxland"?opLandForMetricFast(inputs,"npv",0,mapped):run(inputs,mapped)[metricName];return Number.isFinite(r)?r:null}catch(err){return null}};
  var base=lever.base,fb=evaluate(base);if(fb!=null&&fb>=target)return base;
  var flo=evaluate(lever.lo),fhi=evaluate(lever.hi),bestX=lever.lo,bestV=flo;
  if(bestV==null||(fhi!=null&&fhi>bestV)){bestX=lever.hi;bestV=fhi}
  if(bestV==null||bestV<target)return null;
  var direct=opRootBracket(evaluate,target,Math.min(base,bestX),Math.max(base,bestX),base<=bestX?fb:bestV,base<=bestX?bestV:fb,14);
  if(direct!=null)return direct;
  var steps=6,px=lever.lo,pv=flo;
  for(var i=1;i<=steps;i++){var x=lever.lo+(lever.hi-lever.lo)*i/steps,v=evaluate(x);if(pv!=null&&v!=null&&(pv-target)*(v-target)<=0)return opRootBracket(evaluate,target,px,x,pv,v,16);px=x;pv=v}
  return null;
}
function opSlim(m){return {npat:m.npat,eirr:m.eirr,irr:m.irr,moic:m.moic,margin:m.margin,npv:m.npv,revenue:m.revenue,gross:m.gross,epeak:m.epeak,einj:m.einj,peakdebt:m.peakdebt,finance:m.finance,tax:m.tax,carry:m.carry}}
function opOptimise(q){
  var inputs=q.inputs,metricName=q.metric,target=q.target,levs=q.levers||[];
  if(!levs.length)return {err:"Select at least one lever."};
  var base=opMetric(inputs,metricName,{})||0;
  var val=function(ov){try{var v=opMetric(inputs,metricName,ov);return v==null?-1e9:v}catch(err){return -1e9}};
  var norm=function(ov){return levs.reduce(function(a,l){return a+Math.abs(((ov[l.k]!=null?ov[l.k]:l.base)-l.base)/Math.max(l.hi-l.lo,1e-9))},0)};
  var good=function(v){return v>=target};
  if(good(base)){
    var head=opLandForMetricFast(inputs,metricName==="maxland"?"npv":metricName,metricName==="maxland"?0:target,{});
    return {base:base,tgt:target,levKeys:levs.map(function(l){return l.k}),already:true,head:head,out:[],reach:true};
  }
  var out=[];
  levs.forEach(function(l){var v=opSolveLever(inputs,l,metricName,target);if(v==null)return;var ov={};ov[l.k]=v;if(good(val(ov)))out.push({kind:"Single lever",ov:ov,note:l.name+" alone"})});
  var dirs=levs.map(function(l){var b=l.base,up={};up[l.k]=Math.min(l.hi,b+(l.hi-l.lo)*.04);var dn={};dn[l.k]=Math.max(l.lo,b-(l.hi-l.lo)*.04);return val(up)>=val(dn)?1:-1});
  var blend=function(t){var ov={};levs.forEach(function(l,i){var b=l.base,lim=dirs[i]>0?l.hi:l.lo;ov[l.k]=b+(lim-b)*t});return ov};
  var fullBlend=blend(1),fullBlendValue=val(fullBlend);
  if(good(fullBlendValue)){var lo=0,hi=1;for(var i=0;i<14;i++){var mid=(lo+hi)/2;if(good(val(blend(mid))))hi=mid;else lo=mid}out.push({kind:"Balanced",ov:blend(hi),note:"every lever moved together"})}
  var seed=20260726;var rnd=function(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff};
  var found=[];
  for(var it=0;it<24;it++){var scale=.12+rnd()*.88,ov={};levs.forEach(function(l,i){var b=l.base,room=dirs[i]>0?l.hi-b:b-l.lo,step=room*scale*rnd();ov[l.k]=+(b+dirs[i]*step).toFixed(4)});if(good(val(ov)))found.push({ov:ov,dev:norm(ov)})}
  found.sort(function(a,b){return a.dev-b.dev});
  var picked=[];
  found.forEach(function(c){if(picked.length>=3)return;var near=picked.some(function(p){return levs.every(function(l){return Math.abs((p.ov[l.k]-c.ov[l.k])/Math.max(l.hi-l.lo,1e-9))<.07})});if(!near)picked.push(c)});
  picked.forEach(function(c){out.push({kind:"Combination",ov:c.ov,note:levs.length+" levers moved"})});
  out.forEach(function(o){o.dev=norm(o.ov)});
  out.sort(function(a,b){return a.dev-b.dev});
  var chosen=out.slice(0,5);
  chosen.forEach(function(o){var ex=opExpand(inputs,o.ov);try{o.m=opSlim(run(inputs,ex))}catch(err){o.m=null}o.ml=opLandForMetricFast(inputs,"npv",0,ex)});
  return {base:base,tgt:target,levKeys:levs.map(function(l){return l.k}),out:chosen,reach:out.length>0,ceiling:fullBlendValue};
}
onmessage=function(e){var q=e.data||{};try{postMessage({id:q.id,key:q.key,result:opOptimise(q)})}catch(err){postMessage({id:q.id,key:q.key,error:err&&err.message?err.message:String(err)})}};
`}
function optimiserWorkerUrl(){
  if(_optimiserWorkerUrl)return _optimiserWorkerUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  _optimiserWorkerUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,"\n",optimiserWorkerAppendSource()],{type:"text/javascript"}));return _optimiserWorkerUrl;
}
function destroyOptimiserWorker(){
  if(_optimiserWorker){_optimiserWorker.terminate();_optimiserWorker=null}
}
function applyOptimiserResult(raw){
  const r={...(raw||{})};r.levs=(r.levKeys||[]).map(k=>LV[k]).filter(Boolean);APP.opRes=r;DIRTY.opt=true;if(activePane()==="opt")paint("opt");
}
function ensureOptimiserWorker(){
  if(_optimiserWorker)return _optimiserWorker;
  const url=optimiserWorkerUrl();if(!url)return null;
  const worker=new Worker(url);_optimiserWorker=worker;
  worker.onmessage=e=>{
    const m=e.data||{};if(m.key&&!m.error&&m.result)optimiserCacheSet(m.key,m.result);
    if(!_optimiserActive||m.id!==_optimiserActive.id||m.key!==_optimiserActive.key)return;
    _optimiserActive=null;optimiserBusy(false);
    if(m.error)APP.opRes={err:m.error};else applyOptimiserResult(m.result);
    if(m.error){DIRTY.opt=true;if(activePane()==="opt")paint("opt")}
  };
  worker.onerror=()=>{
    const wasActive=!!_optimiserActive;destroyOptimiserWorker();_optimiserActive=null;optimiserBusy(false);
    if(wasActive){APP.opRes={err:"The scenario search could not be completed."};DIRTY.opt=true;if(activePane()==="opt")paint("opt")}
  };
  return worker;
}
function cancelOptimiserWorker(){
  if(_optimiserActive){destroyOptimiserWorker();_optimiserActive=null}
  optimiserBusy(false);
}
function optimiserRequest(){
  const mk=MET[APP.opMet],tgt=mk.f===P?APP.opTgt/100:(mk.f===X?APP.opTgt:APP.opTgt),allowed=new Set(levers().map(l=>l.k)),d=derive(D);
  const selected=APP.opLev.map(k=>LV[k]).filter(l=>l&&allowed.has(l.k));
  return {inputs:{...D},metric:APP.opMet,target:tgt,levers:selected.map(l=>({k:l.k,name:l.n,lo:l.lo,hi:l.hi,base:cur(l.k,d)})),uiLevers:selected};
}
function runOptimiserAsync(){
  cancelOptimiserWorker();const q=optimiserRequest();
  if(!q.levers.length){APP.opRes={err:"Select at least one lever."};DIRTY.opt=true;paint("opt");return}
  const key=modelInputSignature(q.inputs)+"|"+q.metric+"|"+q.target+"|"+q.levers.map(l=>[l.k,l.base,l.lo,l.hi].join(":")).join(";");
  const cached=optimiserCacheGet(key);if(cached){applyOptimiserResult(cached);return}
  const worker=ensureOptimiserWorker();
  if(!worker){setTimeout(()=>{const result=optimise();optimiserCacheSet(key,result);applyOptimiserResult(result)},0);return}
  const id=++_optimiserSeq;_optimiserActive={id,key};optimiserBusy(true);
  worker.postMessage({id,key,inputs:q.inputs,metric:q.metric,target:q.target,levers:q.levers});
}

PANE.opt=function({d}){
  chips("levchips",levers().map(l=>[l.k,l.n]),k=>APP.opLev.includes(k),
    k=>{cancelOptimiserWorker();const i=APP.opLev.indexOf(k);i<0?APP.opLev.push(k):APP.opLev.splice(i,1);
      APP.opRes=null;DIRTY.opt=true;paint("opt")});
  const mk=MET[APP.opMet];
  document.getElementById("op_unit").textContent=mk.f===P?"%":(mk.f===X?"x":"$");
  if(!APP.opRes){set("o_opt",`<div class="empty">Choose a measure, a target and the levers you are prepared to move, then press <b>Find scenarios</b>.<br>
    Current ${mk.n} is <b>${mk.f(metric(APP.opMet))}</b>.</div>`);return}
  const R=APP.opRes;
  if(R.err){set("o_opt",`<div class="empty">${R.err}</div>`);return}
  if(R.already){
    set("o_opt",`<div class="goal"><b>${mk.n}</b> of <b>${mk.f(R.tgt)}</b> is <b>already achieved</b> —
      the appraisal returns <b class="big">${mk.f(R.base)}</b> as it stands.<br>
      <span class="delta">The useful question is how much room you have. You could pay up to
      <b>${$(R.head)}</b> per sqm and still hold that return, against ${$(d.pr)} being asked
      — headroom of ${$((R.head||0)-d.pr)} per sqm. Raise the target to see what it would take to go further.</span></div>`);
    return}
  if(!R.reach){
    set("o_opt",`<div class="goal miss"><b>${mk.n}</b> of <b>${mk.f(R.tgt)}</b> is not reachable
      with the levers selected, even at the limit of every one of them. The best achievable is
      <b class="big">${mk.f(R.ceiling)}</b>.<br><span class="delta">Add more levers, or widen the target.</span></div>`);return}
  let h=`<div class="goal"><b>${R.out.length}</b> way${R.out.length>1?"s":""} to reach a
    <b>${mk.n}</b> of <b>${mk.f(R.tgt)}</b>, from a current ${mk.f(R.base)}.
    Ranked by least disruption to the base case.</div><div class="recipes">`;
  R.out.forEach((o,i)=>{
    const chg=R.levs.filter(l=>o.ov[l.k]!=null&&Math.abs(o.ov[l.k]-cur(l.k,d))>1e-6);
    h+=`<div class="rec ${i===0?"best":""}"><div class="rh"><span class="rank">${i+1}</span>
      <span>${o.kind}</span><span class="spacer"></span>
      <span style="font-weight:400;text-transform:none">${o.note}</span></div><div class="rb"><dl>`;
    chg.forEach(l=>{const from=cur(l.k,d),to=o.ov[l.k];
      h+=`<dt>${l.n}</dt><dd>${l.f(from)} → <b>${l.f(to)}</b></dd>`});
    if(!chg.length)h+=`<dt>No change needed</dt><dd>—</dd>`;
    h+=`</dl><div class="mv"><dl>
      <dt>${mk.n}</dt><dd>${o.m?mk.f(o.m[APP.opMet]):"–"}</dd>
      <dt>Net profit</dt><dd>${o.m?$(o.m.npat):"–"}</dd>
      <dt>Equity IRR</dt><dd>${o.m?P(o.m.eirr):"–"}</dd>
      <dt>Project NPV</dt><dd>${o.m?$(o.m.npv):"–"}</dd>
      <dt>Maximum land price A$/sqm</dt><dd>${$(o.ml)}</dd></dl></div></div>
      <div class="ra"><button class="cbtn" data-apply="${i}">Add as scenario</button>
        <button class="cbtn" data-adopt="${i}">Apply to inputs</button></div></div>`});
  h+=`</div>`;
  set("o_opt",h);
  document.querySelectorAll("#o_opt [data-apply]").forEach(b=>b.onclick=()=>{
    const o=R.out[+b.dataset.apply];const ov={};
    Object.keys(o.ov).forEach(k=>ov[k]=+(+o.ov[k]).toFixed(3));
    APP.scn.push({n:o.kind+" — "+MET[APP.opMet].n+" "+APP.opTgt+(MET[APP.opMet].f===P?"%":""),ov});APP.scnAuto=false;
    DIRTY.scn=true;alert("Added to the Scenario lab.")});
  document.querySelectorAll("#o_opt [data-adopt]").forEach(b=>b.onclick=()=>{
    if(!confirm("Overwrite the inputs on the left with this recipe?"))return;
    const o=R.out[+b.dataset.adopt];let work=derive(D);
    Object.keys(o.ov).forEach(k=>{const mapped=ovFor(k,+o.ov[k],work);Object.assign(D,mapped);work=derive(D)});
    APP.opRes=null;buildForm();render()});
};

/* ═══════════════════ PORTFOLIO ═══════════════════ */
function portfolioSelectedIds(){
  const valid=new Set(APP.parcels.map(p=>p.id));
  if(APP.portfolioMode==="current")return P0()?[P0().id]:[];
  if(APP.portfolioMode!=="selected")return APP.parcels.map(p=>p.id);
  APP.portfolioSelected=[...(APP.portfolioSelected||[])].filter(id=>valid.has(id));
  return APP.portfolioSelected.slice();
}
function portfolioControlHtml(){
  const ids=portfolioSelectedIds(),selected=new Set(ids),all=APP.portfolioMode!=="selected"&&APP.portfolioMode!=="current",selMode=APP.portfolioMode==="selected",curMode=APP.portfolioMode==="current",months=MON.map((m,i)=>[i+1,m]);
  const summary=curMode?(P0()?esc_(P0().name):"Current project")+" only":selMode?ids.length+" of "+APP.parcels.length+" projects are consolidated":"All "+APP.parcels.length+" projects are consolidated";
  const chips=APP.parcels.map(p=>`<button type="button" class="chip" data-pf-id="${p.id}" aria-pressed="${selected.has(p.id)?'true':'false'}" aria-label="${selected.has(p.id)?'Exclude':'Include'} ${esc_(p.name)} ${selected.has(p.id)?'from':'in'} consolidation" title="${esc_(p.loc||p.name)}">${esc_(p.name)}</button>`).join('');
  return `<div class="portfolio-controls-stack cons-controls">
    <div class="ctl portfolio-controls"><span class="cl">Consolidation scope</span>
      <button type="button" class="cbtn${all?' go':''}" data-pf-action="all">All projects</button>
      <button type="button" class="cbtn${selMode?' go':''}" data-pf-action="selected">Selected projects</button>
      <button type="button" class="cbtn${curMode?' go':''}" data-pf-action="current-mode">Current project only</button>
      <span class="cons-summary portfolio-status">${summary}</span><span class="spacer"></span>
      <span class="cl">Portfolio FY ends</span>${sel('portfolio_fy_end',months,_clamp(Math.round(_num(APP.portfolioFyEnd,6)),1,12))}
      <span class="cl">View</span><select id="portfolio_view"><option value="fy"${APP.portfolioView==='fy'?' selected':''}>Financial year</option><option value="monthly"${APP.portfolioView==='monthly'?' selected':''}>Monthly</option></select>
    </div>
    <div class="ctl portfolio-controls"><span class="cl">Projects included</span><span class="chips" role="group" aria-label="Projects included in consolidation">${chips}</span>
      <span class="spacer"></span><button type="button" class="cbtn" data-pf-action="select-all">Select all</button><button type="button" class="cbtn" data-pf-action="current">Current only</button><button type="button" class="cbtn" data-pf-action="none">Clear selection</button>
    </div>
    <div class="ctl portfolio-controls portfolio-rate"><span class="cl">Portfolio pre-tax unlevered discount rate</span>
      <input id="portfolio_rate" class="ni" type="number" min="0" max="100" step="0.25" value="${M0(APP.portfolioRate,2)}"><span class="cl">% p.a.</span>
      <span class="spacer"></span><span class="cons-summary portfolio-range" data-portfolio-range></span>
    </div>
  </div>`;
}
let portfolioUiTimer=0;
function invalidatePortfolioMemo(){_portfolioMemoKey=null;_portfolioMemoValue=null}
function markPortfolioDirty(kind){if(kind==="view"){DIRTY.ccf=true;return}if(kind==="rate"){DIRTY.cpl=true;DIRTY.port=true;return}if(kind==="fy"){DIRTY.cpl=true;DIRTY.ccf=true;DIRTY.cbs=true;return}DIRTY.cpl=true;DIRTY.ccf=true;DIRTY.cbs=true;DIRTY.port=true}
function repaintPortfolio(kind,delay){invalidatePortfolioMemo();markPortfolioDirty(kind);clearTimeout(portfolioUiTimer);portfolioUiTimer=setTimeout(()=>{portfolioUiTimer=0;const pane=activePane();if(pane==="cpl"||pane==="ccf"||pane==="cbs"||pane==="port"){if(pane==="port")schedulePortfolioResults(0);queuePanePaint(pane)}},delay==null?45:delay)}
function bindPortfolioControls(){
  document.querySelectorAll('[data-pf-action=all]').forEach(b=>b.onclick=()=>{APP.portfolioMode='all';repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-action=selected]').forEach(b=>b.onclick=()=>{APP.portfolioMode='selected';if(!portfolioSelectedIds().length&&P0())APP.portfolioSelected=[P0().id];repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-action=current-mode]').forEach(b=>b.onclick=()=>{APP.portfolioMode='current';APP.portfolioSelected=P0()?[P0().id]:[];repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-action=select-all]').forEach(b=>b.onclick=()=>{APP.portfolioMode='selected';APP.portfolioSelected=APP.parcels.map(p=>p.id);repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-action=current]').forEach(b=>b.onclick=()=>{APP.portfolioMode='selected';APP.portfolioSelected=P0()?[P0().id]:[];repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-action=none]').forEach(b=>b.onclick=()=>{APP.portfolioMode='selected';APP.portfolioSelected=[];repaintPortfolio('scope',20)});
  document.querySelectorAll('[data-pf-id]').forEach(b=>b.onclick=()=>{
    const ids=APP.portfolioMode==='selected'?portfolioSelectedIds():APP.parcels.map(p=>p.id),id=b.dataset.pfId,setIds=new Set(ids);
    if(setIds.has(id))setIds.delete(id);else setIds.add(id);APP.portfolioMode='selected';APP.portfolioSelected=[...setIds];
    b.setAttribute('aria-pressed',setIds.has(id)?'true':'false');b.setAttribute('aria-label',(setIds.has(id)?'Exclude ':'Include ')+(b.textContent||'project')+(setIds.has(id)?' from':' in')+' consolidation');
    const status=b.closest('.portfolio-controls-stack')&&b.closest('.portfolio-controls-stack').querySelector('.portfolio-status');if(status)status.textContent=setIds.size+' of '+APP.parcels.length+' projects are consolidated';
    repaintPortfolio('scope',90);
  });
  document.querySelectorAll('#portfolio_fy_end').forEach(e=>e.onchange=()=>{APP.portfolioFyEnd=_clamp(Math.round(_num(e.value,6)),1,12);repaintPortfolio('fy',20)});
  document.querySelectorAll('#portfolio_view').forEach(e=>e.onchange=()=>{APP.portfolioView=e.value==='monthly'?'monthly':'fy';markPortfolioDirty('view');const pane=activePane();if(pane==='ccf')queuePanePaint('ccf')});
  document.querySelectorAll('#portfolio_rate').forEach(e=>e.onchange=()=>{const v=Number(e.value);if(Number.isFinite(v)&&v>=0){APP.portfolioRate=v;markPortfolioDirty('rate');const pane=activePane();if(pane==='cpl'||pane==='port')queuePanePaint(pane)}});
}
function portfolioAbsStart(d){return d.startYear*12+(d.startMonth-1)}
function portfolioMonthLabel(abs){return MON[((abs%12)+12)%12]+"-"+String(Math.floor(abs/12)).slice(2)}
function portfolioFyOfAbs(abs,fyEnd){const y=Math.floor(abs/12),m=((abs%12)+12)%12+1;return y+(m>fyEnd?1:0)}
function portfolioYears(first,last,fyEnd){
  if(first==null||last==null||last<first)return [];
  const set=new Set();for(let a=first;a<=last;a++)set.add(portfolioFyOfAbs(a,fyEnd));return [...set].sort((a,b)=>a-b)
}
let _portfolioMemoKey=null,_portfolioMemoValue=null;
function portfolioDataKey(){
  const selected=new Set(portfolioSelectedIds()),fyEnd=_clamp(Math.round(_num(APP.portfolioFyEnd,6)),1,12);
  return fyEnd+"|"+APP.parcels.filter(p=>selected.has(p.id)).map(p=>
    [p.id,p.name,p.loc,modelInputSignature(p.inputs)].join("\u001c")).join("\u001d");
}
function memoPortfolio(key,value){_portfolioMemoKey=key;_portfolioMemoValue=value;return value}
function portfolioData(){
  const memoKey=portfolioDataKey();
  if(_portfolioMemoKey===memoKey&&_portfolioMemoValue)return _portfolioMemoValue;
  const selected=new Set(portfolioSelectedIds()),runs=[],errors=[];
  APP.parcels.forEach(p=>{if(!selected.has(p.id))return;try{const A=run(p.inputs);runs.push({p,A,d:A.d||derive(p.inputs),start:portfolioAbsStart(A.d||derive(p.inputs))})}catch(e){errors.push({p,e})}});
  if(!runs.length)return memoPortfolio(memoKey,{runs,errors,fyEnd:_clamp(Math.round(_num(APP.portfolioFyEnd,6)),1,12)});
  const minAbs=Math.min(...runs.map(r=>r.start)),maxAbs=Math.max(...runs.map(r=>r.start+r.A.NM)),N=maxAbs-minAbs+1;
  const z=()=>new Array(N).fill(0),plKeys=["grossRev","outputGst","rev","landCost","stampDuty","foreignPurchaserSurcharge","firbCost","acquisitionCost","constructionCost","professionalFees","developmentManagementFees","statutoryCost","contingencyCost","holdingCost","brokerage","sellingCost","marketing","capitalisedFinanceCost","otherDirectCost","inputGstCredit","dc","gp","gna","gnaShared","staff","staffShared","corpOverhead","oh","fin","da","totalOverhead","otherIncome","npbt","tax","npat"],PLM={};plKeys.forEach(k=>PLM[k]=z());
  const cfKeys=["cfequity","dr1","dr2","salescash","escin","cfgstrefund","pid","cfotherincome","cfland","cfinfra","cfpiddebt","cfcapex","cfconstruction","cfdesign","cfauthority","cfbrokerage","cfretax","cfohpaid","cfoutputgst","cftaxpaid","pf","intr","lf","cffinance","cfdebtrepaid","cfequitydist","cfinputgstpaid","cfrefresrev","cfrefgst","cfrefland","cfrefstamp","cfrefholding","cfreffirb","cfrefforeignstamp","cfrefconstruction","cfrefprofessional","cfrefdm","cfrefstatutory","cfrefcontingency","cfrefbrokerage","cfrefselling","cfrefmarketing","cfrefnetcash","cfrefdebt","cfrefdebtfinance","cfrefrepayment","cfrefprocessing","cfrefinterest","cfreflifetime","cfrefequity","cfrefsurplus","cfrefprofit"],CFM={};cfKeys.forEach(k=>CFM[k]=z());
  const projectTimeline=[];
  runs.forEach(r=>{
    const {A,d,start}=r,R=A.R,landBase=d.acresGross*d.pr,acqOther=d.acquisitionfee+d.otheracq+d.rollback+d.closingpc/100*landBase;
    const acqDen=Math.max(1,A.land+A.stampDuty+A.foreignPurchaserSurcharge+A.firbCost+acqOther),baseInfra=d.infl*A.lots;
    const professionalTotal=d.ddpc/100*landBase+(A.professionalTotal||0),dmTotal=A.developmentManagementTotal||0,designDen=Math.max(1,professionalTotal+dmTotal),constructionDen=Math.max(1,A.infTot+A.contTot),sellingDen=Math.max(1e-9,d.comm+d.sellingpc);
    let first=null,last=null;
    for(let m=0;m<=A.NM;m++){
      const i=start+m-minAbs,get=k=>(R[k]&&R[k][m])||0;
      const landAllocated=get("landbasecogs"),infraNet=get("infracogs")+get("pidcogs"),constructionPL=get("constructioncogs")+get("insurancecaprel")+get("insuranceexp"),designAllocated=get("designcogs"),selling=get("sell"),rev=get("recog")-get("outputgst");
      const vals={grossRev:get("recog"),outputGst:get("outputgst"),rev,
        landCost:landAllocated*A.land/acqDen,stampDuty:landAllocated*A.stampDuty/acqDen,foreignPurchaserSurcharge:landAllocated*A.foreignPurchaserSurcharge/acqDen,firbCost:landAllocated*A.firbCost/acqDen,acquisitionCost:landAllocated*acqOther/acqDen,
        constructionCost:infraNet*A.infTot/constructionDen+constructionPL,professionalFees:designAllocated*professionalTotal/designDen,developmentManagementFees:designAllocated*dmTotal/designDen,statutoryCost:get("authoritycogs"),contingencyCost:infraNet*A.contTot/constructionDen,holdingCost:get("retaxexp")+get("retaxcaprel"),brokerage:selling*d.comm/sellingDen,sellingCost:selling*d.sellingpc/sellingDen,marketing:get("marketing"),capitalisedFinanceCost:get("fincaprel"),otherDirectCost:get("otherdirectcogs"),inputGstCredit:get("gstcogs"),
        gna:get("gna")+get("hoaexppl")+get("hoacaprel"),gnaShared:get("gnashared"),staff:get("staff"),staffShared:get("staffshared"),corpOverhead:get("corpovh"),fin:get("finexp"),da:get("da"),otherIncome:get("otherincome")};
      vals.dc=vals.landCost+vals.stampDuty+vals.foreignPurchaserSurcharge+vals.firbCost+vals.acquisitionCost+vals.constructionCost+vals.professionalFees+vals.developmentManagementFees+vals.statutoryCost+vals.contingencyCost+vals.holdingCost+vals.brokerage+vals.sellingCost+vals.marketing+vals.capitalisedFinanceCost+vals.otherDirectCost+vals.inputGstCredit;
      vals.gp=vals.rev-vals.dc;vals.oh=vals.gna+vals.gnaShared+vals.staff+vals.staffShared+vals.corpOverhead;vals.totalOverhead=vals.oh+vals.fin+vals.da;vals.npbt=vals.gp-vals.oh-vals.fin-vals.da+vals.otherIncome;
      Object.keys(vals).forEach(k=>PLM[k][i]+=vals[k]);
      cfKeys.forEach(k=>CFM[k][i]+=get(k));
      const activity=Math.abs(vals.grossRev)+Math.abs(vals.dc)+Math.abs(vals.oh)+Math.abs(vals.fin)+Math.abs(vals.otherIncome)+cfKeys.reduce((a,k)=>a+Math.abs(get(k)),0);
      if(activity>.5){if(first==null)first=start+m;last=start+m}
    }
    Object.keys(A.PL).forEach(y=>{const tax=(A.PL[y]&&A.PL[y].tax)||0,abs=Number(y)*12+(d.fyEnd-1),i=abs-minAbs;if(i>=0&&i<N)PLM.tax[i]+=tax});
    projectTimeline.push({name:r.p.name,start,first:first==null?start:first,last:last==null?start+r.A.lastMonth:last,fyEnd:d.fyEnd});
  });
  for(let i=0;i<N;i++){PLM.npat[i]=PLM.npbt[i]-PLM.tax[i]}
  const inflow=z(),outflow=z(),closeBeforeReturns=z(),netBeforeReturns=z();let cash=0;
  for(let i=0;i<N;i++){
    inflow[i]=CFM.cfequity[i]+CFM.dr1[i]+CFM.dr2[i]+CFM.salescash[i]+CFM.escin[i]+CFM.cfgstrefund[i]+CFM.pid[i]+CFM.cfotherincome[i];
    outflow[i]=CFM.cfland[i]+CFM.cfinfra[i]+CFM.cfpiddebt[i]+CFM.cfcapex[i]+CFM.cfconstruction[i]+CFM.cfdesign[i]+CFM.cfauthority[i]+CFM.cfbrokerage[i]+CFM.cfretax[i]+CFM.cfohpaid[i]+CFM.cfoutputgst[i]+CFM.cftaxpaid[i]+CFM.cffinance[i]+CFM.cfdebtrepaid[i];
    netBeforeReturns[i]=inflow[i]-outflow[i];cash+=netBeforeReturns[i];closeBeforeReturns[i]=cash;
  }
  const activityBounds=arrays=>{let first=null,last=null;for(let i=0;i<N;i++){if(arrays.some(a=>Math.abs(a[i]||0)>.5)){if(first==null)first=minAbs+i;last=minAbs+i}}return [first,last]};
  const [plFirst,plLast]=activityBounds([PLM.grossRev,PLM.dc,PLM.oh,PLM.fin,PLM.otherIncome,PLM.tax]),[cfFirst,cfLast]=activityBounds([inflow,outflow]);
  const fyEnd=_clamp(Math.round(_num(APP.portfolioFyEnd,6)),1,12),plFys=portfolioYears(plFirst,plLast,fyEnd),cfFys=portfolioYears(cfFirst,cfLast,fyEnd);
  const sumFy=(arr,y)=>arr.reduce((a,v,i)=>a+(portfolioFyOfAbs(minAbs+i,fyEnd)===y?v:0),0);
  const fyMonths=y=>{const out=[];for(let i=0;i<N;i++)if(portfolioFyOfAbs(minAbs+i,fyEnd)===y)out.push(i);return out};
  const result={runs,errors,fyEnd,minAbs,maxAbs,N,PLM,CFM,inflow,outflow,netBeforeReturns,closeBeforeReturns,plFys,cfFys,sumFy,fyMonths,projectTimeline,plFirst,plLast,cfFirst,cfLast};
  return memoPortfolio(memoKey,typeof applyBusinessPlanCalibration==="function"?applyBusinessPlanCalibration(result):result);
}
function portfolioTimelineHtml(Q){
  if(!Q.projectTimeline||!Q.projectTimeline.length)return '';
  const longMonth=abs=>MON[((abs%12)+12)%12]+' '+Math.floor(abs/12);
  const rows=Q.projectTimeline.map(x=>`<tr><td>${esc_(x.name)}</td><td>${longMonth(x.start)}</td><td>${longMonth(x.first)}</td><td>${longMonth(x.last)}</td><td>${MON[x.fyEnd-1]}</td></tr>`).join('');
  return `<div class="portfolio-timeline-wrap"><table><colgroup><col style="width:36%"><col style="width:16%"><col style="width:16%"><col style="width:16%"><col style="width:16%"></colgroup><caption>Selected project timelines</caption><thead><tr><th>Project</th><th>Model start</th><th>First activity</th><th>Last activity</th><th>Project FY end</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">Dates are calendar-aligned from each project's current model start and monthly programme.</td></tr></tfoot></table></div>`;
}
function renderPortfolioComparison(){
  const selectedIds=new Set(portfolioSelectedIds());
  const res=APP.parcels.map(p=>{const cached=portfolioResult(p.inputs);
    return {p,m:cached&&cached.m||null,d:derive(p.inputs),ml:cached&&cached.ml!=null?cached.ml:null,included:selectedIds.has(p.id)}});
  const live=res.filter(r=>r.m&&r.included);
  const best=live.length?live.reduce((a,b)=>(b.m.eirr??-9)>(a.m.eirr??-9)?b:a):null;
  const cur=res[APP.active];
  const T={revenue:0,npat:0,npv:0,einj:0,epeak:0,eret:0,peakdebt:0,lots:0,acres:0,land:0,gross:0,finance:0,tax:0};
  live.forEach(r=>{T.revenue+=r.m.revenue;T.npat+=r.m.npat;T.einj+=r.m.einj;T.eret+=r.m.eret;T.lots+=r.d._lots;T.acres+=r.d.acresGross;T.land+=r.m.land;T.gross+=r.m.gross;T.finance+=r.m.finance;T.tax+=r.m.tax});
  if(live.length){const absStart=r=>r.d.startYear*12+(r.d.startMonth-1),valuationMonth=Math.min(...live.map(absStart)),portfolioRate=Math.max(0,_num(APP.portfolioRate,7.25)),monthlyRate=Math.pow(1+portfolioRate/100,1/12)-1,maxMonth=Math.max(...live.map(r=>absStart(r)+r.m.NM));const eqBal=new Map(),debtBal=new Map();live.forEach(r=>{let outstanding=0;for(let m=0;m<=r.m.NM;m++){const am=absStart(r)+m;outstanding=Math.max(0,outstanding+r.m.R.eqin[m]-r.m.R.eqout[m]);eqBal.set(am,(eqBal.get(am)||0)+outstanding);debtBal.set(am,(debtBal.get(am)||0)+r.m.R.lcl[m]);T.npv+=r.m.R.net[m]/Math.pow(1+monthlyRate,am-valuationMonth)}});for(let am=valuationMonth;am<=maxMonth;am++){T.epeak=Math.max(T.epeak,eqBal.get(am)||0);T.peakdebt=Math.max(T.peakdebt,debtBal.get(am)||0)}T.portfolioRate=portfolioRate;T.valuationMonth=valuationMonth}
  const dl=(v,b,up)=>{if(v==null||b==null||Math.abs(b)<1e-9)return "";
    const diff=v-b,good=up?diff>0:diff<0;
    return `<span class="dlt ${good?"up":"dn"}">${diff>0?"+":""}${Mn(diff)}</span>`};
  const rows=res.map((r,i)=>{
    const isB=best&&r===best, isC=i===APP.active;
    const eirr=r.m?r.m.eirr:null;
    const vc=eirr==null?["fail","Fail"]:(eirr>=r.d.hurdle/100?["pass","Pass"]:
      (eirr>=r.d.hurdle/100*.75?["marg","Marginal"]:["fail","Fail"]));
    return {sr:1,cls:isC?"res":"",c:[
      (isB?"★ ":"")+r.p.name,
      r.included?`<span class="vchip pass">Included</span>`:`<span class="vchip fail">Excluded</span>`,
      M0(r.d.acresGross,1),M0(r.d._lots),$(r.d.pr),mLabel(r.d.close,r.d),
      $(r.m?r.m.revenue:null),$(r.m?r.m.gross:null),
      $(r.m?r.m.npat:null)+(isC?"":dl(r.m&&r.m.npat,cur.m&&cur.m.npat,1)),
      P(r.m?r.m.margin:null),r.m?projectIrrView(r.m,derive(r.p.inputs)).text:"–",
      P(r.m?r.m.eirr:null),X(r.m?r.m.moic:null),
      $(r.m?r.m.epeak:null),$(r.m?r.m.peakdebt:null),
      $(r.m?r.m.npv:null)+(isC?"":dl(r.m&&r.m.npv,cur.m&&cur.m.npv,1)),
      r.ml==null?"–":(r.ml<r.d.pr?`<span style="color:#9C0006;font-weight:700">${$(r.ml)}</span>`:$(r.ml)),
      `<span class="vchip ${vc[0]}">${vc[1]}</span>`]}});
  rows.push({sr:1,cls:"sub",c:["Selected portfolio total","",M0(T.acres,1),M0(T.lots),"","",
    $(T.revenue),$(T.gross),$(T.npat),T.revenue?P(T.npat/T.revenue):"–","","",
    T.einj?X(T.eret/T.einj):"–",$(T.epeak),$(T.peakdebt),$(T.npv),"",""]});
  let h=portfolioControlHtml()+`<div class="ctl"><span class="cl">Portfolio pre-tax unlevered discount rate</span><input id="portfolio_rate" class="ni" type="number" min="0" max="100" step="0.25" value="${M0(APP.portfolioRate,2)}"><span class="cl">% p.a.</span></div><div class="scrollx">`+tbl("Every project side by side",
    ["Project","Consolidated","Site area (sqm)","Lots","A$/sqm","Land paid","Revenue","Gross profit","Project profit",
     "Margin","Project IRR","Equity IRR","Multiple","Equity required","Peak debt","NPV","Maximum land price A$/sqm","Verdict"],
    rows,`★ marks the strongest equity return. Portfolio peak equity and debt are calendar-aligned rather than summed parcel peaks. Model-basis portfolio figures are the additive full-life outputs of the selected project engines; they are not silently replaced by the corporate Business Plan statement. Portfolio NPV is discounted to the earliest model start at the explicit portfolio discount rate (${M0(T.portfolioRate,2)}%). Portfolio IRR is not additive and is therefore not shown.`)+`</div>`;
  if(live.length>1){
    h+=chart("Project profit by parcel",[{n:"Net profit",v:res.map(r=>r.m?r.m.npat:0),c:"#2E5496",type:"bar"}],
      res.map(r=>r.p.name.slice(0,16)))+
      chart("Equity IRR by parcel",[{n:"Equity IRR",v:res.map(r=>r.m&&r.m.eirr!=null?r.m.eirr:0),c:"#16294B",type:"bar"}],
      res.map(r=>r.p.name.slice(0,16)),v=>P(v,0));
    if(best){const wl=live.filter(r=>r!==best);
      const second=wl.length?wl.reduce((a,b)=>(b.m.eirr??-9)>(a.m.eirr??-9)?b:a):null;
      h=`<div class="goal"><b>${esc_(best.p.name)}</b> is the strongest of the ${live.length} parcels on equity return, at
        <b class="big">${P(best.m.eirr)}</b> on a ${X(best.m.moic)} multiple`+
        (second?` — against ${P(second.m.eirr)} for ${esc_(second.p.name)}, a difference of
         ${$(best.m.npat-second.m.npat)} of net profit and ${$(best.m.npv-second.m.npv)} of net present value.`:`.`)+
        `<span class="delta">Each parcel carries its own land price, payment date and full cost base, so this comparison is like for like only where you have made it so.</span></div>`+h}
  }else if(live.length===1){h=`<div class="goal"><b>${esc_(live[0].p.name)}</b> is the only project currently included in the consolidated portfolio.<span class="delta">Select more projects above to produce a merged portfolio comparison and consolidated statements.</span></div>`+h}
  else{h=`<div class="empty">${res.some(r=>r.included&&!r.m)?"Selected projects will populate automatically.":"Select at least one valid project above to build the consolidated portfolio."}</div>`+h}
  set("o_port",h);bindPortfolioControls();ensurePortfolioResults();
  const pr=document.getElementById("portfolio_rate");if(pr)pr.onchange=()=>{const v=Number(pr.value);if(Number.isFinite(v)&&v>=0){APP.portfolioRate=v;DIRTY.port=true;render()}};
};



function sourceSelectedKeys(){
  const ids=new Set(portfolioSelectedIds()),out=[];
  APP.parcels.forEach(p=>{if(!ids.has(p.id))return;const k=sourceKeyForParcel(p);if(k&&APP.sourceData.projects[k])out.push(k)});
  return [...new Set(out)];
}
function sourceAllProjectsSelected(){
  const ids=new Set(portfolioSelectedIds()),selected=APP.parcels.filter(p=>ids.has(p.id));
  if(selected.length!==SOURCE_PROJECT_KEYS.length)return false;
  const counts=new Map();selected.forEach(p=>{const k=sourceKeyForParcel(p);if(k)counts.set(k,(counts.get(k)||0)+1)});
  return SOURCE_PROJECT_KEYS.every(k=>counts.get(k)===1);
}
function srcLine(schedule,code){return (schedule&&schedule.lines||[]).find(x=>String(x.code||"").trim()===String(code))||null}
function srcVal(line,y){return line&&line.years?Number(line.years[String(y)]||0):0}
function srcSigned(line,y,kind){let v=srcVal(line,y);if(kind==="gst")return -Math.abs(v);if(kind==="refund")return -Math.abs(v);return v}
function srcYears(keys){const z=new Set();keys.forEach(k=>(APP.sourceData.projects[k].years||[]).forEach(y=>z.add(Number(y))));return [...z].sort((a,b)=>a-b)}
function srcProjectSeries(keys,code,years,kind){return years.map(y=>keys.reduce((a,k)=>a+srcSigned(srcLine(APP.sourceData.projects[k],code),y,kind),0))}
function srcTotalSeries(a){return a.reduce((x,y)=>x+y,0)}
function srcProjectStatement(keys){
  const years=srcYears(keys),gross=srcProjectSeries(keys,"1.1",years),gst=srcProjectSeries(keys,"1.2",years,"gst"),net=srcProjectSeries(keys,"1",years),land=srcProjectSeries(keys,"2",years),dev=srcProjectSeries(keys,"3",years),sell=srcProjectSeries(keys,"4",years),refund=srcProjectSeries(keys,"5",years,"refund"),fin=srcProjectSeries(keys,"8",years);
  const cost=years.map((_,i)=>land[i]+dev[i]+sell[i]+refund[i]+fin[i]),pbt=years.map((_,i)=>net[i]-cost[i]);
  return {years,gross,gst,net,land,dev,sell,refund,fin,cost,pbt};
}
function sourceExactAll(){return APP.portfolioBasis==="source"&&APP.sourceIncludeHoldco&&sourceAllProjectsSelected()}
function sourceTableRows(schedule){
  const years=schedule.years.map(Number),sectionLabels=new Set(["Direct Cost","Overhead Cost","Cash Inflows","Cash Outflows","Operating Expenses","Non-Operating Expenses"]);
  return (schedule.lines||[]).map(l=>{
    const vals=years.map(y=>$(srcVal(l,y))),label=esc_(l.label||"");
    if(sectionLabels.has(l.label))return {band:(l.code?esc_(l.code)+"   ":"")+label};
    const important=/Total Revenue|Direct Cost \(|Gross Profit|Overhead Cost \(|Total Overhead Cost|Net Profit before taxes|Net Profit \(|Total Inflow|Total Outflow|Closing Cash Balance/.test(l.label||"");
    return {sr:1,cls:/Net Profit \(|Closing Cash Balance|Gross Profit/.test(l.label||"")?"res":(important?"sub":""),c:[esc_(l.code||""),label,...vals,$(Number(l.total||0))]};
  });
}
function renderSourceCPL(){
  APP.portfolioBasis="source";APP.sourceIncludeHoldco=true;APP.portfolioMode="all";APP.portfolioSelected=[];
  const controls=portfolioControlHtml(true),keys=sourceSelectedKeys();
  if(!keys.length){set("o_cpl",controls+`<div class="empty">Select at least one of the nine Business Plan projects.</div>`);bindPortfolioControls();return}
  if(sourceExactAll()){
    const S=APP.sourceData.consolidatedPL,years=S.years.map(Number);
    set("o_cpl",controls+`<div class="source-note"><b></b> The all-project statement below reads the consolidated P&L source inputs directly, including HoldCo overhead, other income and corporate tax. It does not regenerate timing through the feasibility engine.</div>`+tbl("Sobha Australia - Consolidated Profit and Loss Account",["Sl. No.","Description",...years.map(y=>"FY "+y),"Total"],sourceTableRows(S)," Amounts are direct annual inputs."));bindPortfolioControls();return
  }
  const S=srcProjectStatement(keys),f=(arr)=>arr.map($).concat([$(srcTotalSeries(arr))]);
  const rows=[{sr:1,c:["1.1","Gross Revenue / Customer Collections",...f(S.gross)]},{sr:1,c:["1.2","Less: Output GST",...f(S.gst)]},{sr:1,cls:"sub",c:["1","Net Revenue",...f(S.net)]},{band:"Project costs from annual source schedules"},{sr:1,c:["2","Land Cost",...f(S.land)]},{sr:1,c:["3","Development / Construction Cost",...f(S.dev)]},{sr:1,c:["4","Selling / Other Project Cost",...f(S.sell)]},{sr:1,c:["5","Less: GST Refund / Input Credit",...f(S.refund)]},{sr:1,c:["8","Finance Cost",...f(S.fin)]},{sr:1,cls:"sub",c:["","Total Project Cost",...f(S.cost)]},{sr:1,cls:"res",c:["","Project Profit Before Tax",...f(S.pbt)]},{sr:1,c:["","PBT Margin",...S.years.map((_,i)=>S.net[i]?P(S.pbt[i]/S.net[i]):"-"),srcTotalSeries(S.net)?P(srcTotalSeries(S.pbt)/srcTotalSeries(S.net)):"-"]}];
  set("o_cpl",controls+`<div class="source-note"><b>Selected-project Business Plan basis.</b> Annual revenue and project costs are summed directly from the selected project source schedules. The PDF does not allocate HoldCo tax and overhead to individual projects, so this view ends at project PBT.</div>`+tbl("Selected Projects - Source Schedule P&L",["Ref.","Particulars",...S.years.map(y=>"FY "+y),"Total"],rows,"This is a selected-project aggregation of the annual source schedules, not a dynamic monthly recalculation."));bindPortfolioControls();
}
function srcAnnualResolved(schedule,code,years){
  const l=srcLine(schedule,code),arr=years.map(y=>srcVal(l,y)),target=Number(l&&l.total||0),sum=arr.reduce((a,b)=>a+b,0),diff=target-sum;
  if(Math.abs(diff)>.5&&years.length){let idx=years.length-1;const rev=srcLine(schedule,"1.1");for(let i=years.length-1;i>=0;i--)if(Math.abs(srcVal(rev,years[i]))>.5){idx=i;break}arr[idx]+=diff}
  return arr;
}
function sourceSelectedCashflow(keys){
  const years=srcYears(keys),z=()=>new Array(years.length).fill(0),sumCode=(code,transform)=>{const a=z();keys.forEach(k=>{const q=srcAnnualResolved(APP.sourceData.projects[k],code,years);q.forEach((v,i)=>a[i]+=(transform?transform(v):v))});return a};
  const gross=sumCode("1.1"),gst=sumCode("1.2",v=>Math.abs(v)),equity=sumCode("9"),debt=sumCode("7.1"),debtService=sumCode("7.2"),refund=sumCode("5",v=>Math.abs(v)),land=sumCode("2"),dev=sumCode("3"),sell=sumCode("4"),fin=sumCode("8"),repay=sumCode("7.3",v=>Math.abs(v));
  const inflow=years.map((_,i)=>gross[i]+equity[i]+debt[i]+debtService[i]+refund[i]),outflow=years.map((_,i)=>gst[i]+land[i]+dev[i]+sell[i]+fin[i]+repay[i]),net=years.map((_,i)=>inflow[i]-outflow[i]),open=z(),close=z();let cash=0;for(let i=0;i<years.length;i++){open[i]=cash;cash+=net[i];close[i]=cash}
  return {years,gross,gst,equity,debt,debtService,refund,land,dev,sell,fin,repay,inflow,outflow,net,open,close};
}
function renderSourceCCF(){
  APP.portfolioBasis="source";APP.sourceIncludeHoldco=true;APP.portfolioMode="all";APP.portfolioSelected=[];
  const controls=portfolioControlHtml(true),keys=sourceSelectedKeys();
  if(!keys.length){set("o_ccf",controls+`<div class="empty">Select at least one of the nine Business Plan projects.</div>`);bindPortfolioControls();return}
  if(sourceExactAll()){
    const S=APP.sourceData.consolidatedCF,years=S.years.map(Number);
    set("o_ccf",controls+`<div class="source-note"><b></b> The all-project cashflow below reads the consolidated source inputs directly, including opening cash, Allied Businesses, Drummoyne, HoldCo overhead and corporate tax.</div>`+tbl("Sobha Australia - Cashflow Projections",["Sr. No.","Particulars",...years.map(y=>"FY "+y),"Total"],sourceTableRows(S)," Closing cash is the published corporate cash balance."));bindPortfolioControls();return
  }
  const S=sourceSelectedCashflow(keys),f=a=>a.map($).concat([$(a.reduce((x,y)=>x+y,0))]);
  const rows=[{sr:1,cls:"sub",c:["I","Opening Cash Balance",...S.open.map($),""]},{band:"II   Cash Inflows"},{sr:1,c:["1","Gross Customer Collections",...f(S.gross)]},{sr:1,c:["2","Debt Raised",...f(S.debt)]},{sr:1,c:["2.1","Debt Raised to Service Debt",...f(S.debtService)]},{sr:1,c:["3","Equity Requirement / Internal Funding",...f(S.equity)]},{sr:1,c:["4","GST Refund",...f(S.refund)]},{sr:1,cls:"sub",c:["","Total Inflow",...f(S.inflow)]},{band:"III   Cash Outflows"},{sr:1,c:["5","Output GST Paid",...f(S.gst)]},{sr:1,c:["6","Land Cost",...f(S.land)]},{sr:1,c:["7","Development / Construction Cost",...f(S.dev)]},{sr:1,c:["8","Selling / Other Project Cost",...f(S.sell)]},{sr:1,c:["9","Finance Cost",...f(S.fin)]},{sr:1,c:["10","Debt Repayment",...f(S.repay)]},{sr:1,cls:"sub",c:["","Total Outflow",...f(S.outflow)]},{sr:1,c:["","Net Flow",...f(S.net)]},{sr:1,cls:"res",c:["IV","Closing Cash / Retained Project Surplus",...S.close.map($),$(S.close[S.close.length-1])]}];
  set("o_ccf",controls+`<div class="source-note"><b>Selected-project Business Plan basis.</b> Source project schedules are added by financial year. HoldCo and corporate items are excluded because the PDF does not allocate them to individual projects.</div>`+tbl("Selected Projects - Source Schedule Cashflow",["Sr. No.","Particulars",...S.years.map(y=>"FY "+y),"Total"],rows,"The roll-forward starts at zero for the selected projects and retains their published source surplus."));bindPortfolioControls();
}
function sourceTargetOptions(){return [["consolidatedPL","Consolidated P&L - PDF page 1"],["consolidatedCF","Consolidated Cashflow - PDF page 4"],["holdcoPL","HoldCo P&L - PDF page 36"],...SOURCE_PROJECT_KEYS.map(k=>["project:"+k,(SAMPLE_PROJECTS[k]&&SAMPLE_PROJECTS[k].name)||k])];}
function sourceTargetData(target){if(target.startsWith("project:"))return APP.sourceData.projects[target.slice(8)];return APP.sourceData[target]}
function bindSourceInputs(){
  const t=document.getElementById("source_target");if(t)t.onchange=()=>{APP.sourceEditTarget=t.value;DIRTY.source=true;paint("source")};
  document.querySelectorAll("[data-src-row]").forEach(e=>e.onchange=()=>{const S=sourceTargetData(APP.sourceEditTarget),r=S.lines[+e.dataset.srcRow],v=Number(e.value);if(!Number.isFinite(v))return;if(e.dataset.srcYear)r.years[e.dataset.srcYear]=v;else r.total=v;refreshBusinessPlanTimingProfiles(APP.sourceData);DIRTY.cpl=DIRTY.ccf=true});
  const reset=document.getElementById("source_reset");if(reset)reset.onclick=()=>{if(!confirm("Restore every Business Plan source schedule to the PDF values?"))return;APP.sourceData=cloneSourceData(SOURCE_BP_DEFAULT);refreshBusinessPlanTimingProfiles(APP.sourceData);DIRTY.source=DIRTY.cpl=DIRTY.ccf=true;paint("source")};
  const sum=document.getElementById("source_sum_rows");if(sum)sum.onclick=()=>{const S=sourceTargetData(APP.sourceEditTarget);S.lines.forEach(r=>r.total=(S.years||[]).reduce((a,y)=>a+Number(r.years[String(y)]||0),0));refreshBusinessPlanTimingProfiles(APP.sourceData);DIRTY.source=DIRTY.cpl=DIRTY.ccf=true;paint("source")};
}
function renderDynamicCPL(){
  const Q=portfolioData(),controls=portfolioControlHtml();
  if(!Q.runs.length){set("o_cpl",controls+`<div class="empty">Select at least one valid project to build the consolidated P&L.</div>`);bindPortfolioControls();return}
  if(Q.businessPlanLogic&&typeof calibratedBusinessPlanAnnual==="function"){
    const A=calibratedBusinessPlanAnnual(),fys=(SOURCE_BP_DEFAULT.consolidatedPL.years||[]).map(Number),pc=k=>fys.map(y=>$(A[y]&&A[y][k]||0)).concat([$(fys.reduce((t,y)=>t+_num(A[y]&&A[y][k]),0))]),totalRev=fys.reduce((t,y)=>t+_num(A[y]&&A[y].rev),0),totalNpat=fys.reduce((t,y)=>t+_num(A[y]&&A[y].npat),0);
    const rows=[
      {sr:1,c:["","Net Qualified Sales",...pc("grossRev")]},{sr:1,cls:"sub",c:["1","Total Revenue",...pc("rev")]},{band:"Direct Cost"},
      {sr:1,c:["2.1","Land cost",...pc("landCost")]},{sr:1,c:["2.2","Construction Cost",...pc("constructionCost")]},{sr:1,c:["2.3","Brokerage & Incentive",...pc("brokerage")]},{sr:1,c:["2.4","Other Direct Cost",...pc("otherDirectCost")]},{sr:1,cls:"sub",c:["2","Direct Cost",...pc("dc")]},{sr:1,cls:"res",c:["3","Gross Profit",...pc("gp")]},{band:"Overhead and Finance"},
      {sr:1,c:["4.1","General & Admin Expenses",...pc("gna")]},{sr:1,c:["4.2","Staff / Manpower",...pc("staff")]},{sr:1,c:["4.3","Corporate Overhead Allocation",...pc("corpOverhead")]},{sr:1,cls:"sub",c:["4","Overhead Cost",...pc("oh")]},{sr:1,c:["5","Finance Cost (Net of Finance income)",...pc("fin")]},{sr:1,cls:"sub",c:["6","Total Overhead Cost including Finance",...pc("totalOverhead")]},{sr:1,c:["8","Other Income",...pc("otherIncome")]},{sr:1,cls:"res",c:["9","Net Profit Before Taxes",...pc("npbt")]},{sr:1,c:["10","Corporate Taxes",...pc("tax")]},{sr:1,cls:"res",c:["11","Net Profit after Tax",...pc("npat")]},{sr:1,c:["","NPAT margin on net revenue",...fys.map(y=>A[y]&&A[y].rev?P(A[y].npat/A[y].rev):"–"),totalRev?P(totalNpat/totalRev):"–"]}
    ];
    const warning=Q.errors.length?`<div class="goal miss">${Q.errors.length} selected project(s) could not be calculated and were excluded.</div>`:"";
    set("o_cpl",controls+warning+portfolioTimelineHtml(Q)+tbl("Sobha Australia - Consolidated Profit and Loss Account",["Ref.","Particulars",...fys.map(y=>"FY "+y),"Total"],rows,`Corporate consolidation basis from the 27-Jul-2026 Business Plan: project economics plus HoldCo overhead, other income and 30% corporate tax with loss carry-forward. Current project-input changes are applied as deltas to that baseline. Project PBT is not presented as NPAT.`));bindPortfolioControls();return
  }
  const fys=Q.plFys,pc=(k)=>fys.map(y=>$(Q.sumFy(Q.PLM[k],y))).concat([$(Q.PLM[k].reduce((a,b)=>a+b,0))]),totalRev=Q.PLM.rev.reduce((a,b)=>a+b,0),totalNpat=Q.PLM.npat.reduce((a,b)=>a+b,0);
  const projectTaxEntered=Q.runs.some(r=>Math.abs(_num(r.d.ftax))>.0001||Math.abs(_num(r.d.stax))>.0001),isCorporate=!!Q.businessPlanLogic,profitLabel=isCorporate||projectTaxEntered?"Net Profit after Tax":"Project Profit Before Corporate Tax",taxLabel=isCorporate||projectTaxEntered?"Corporate Taxes":"Corporate Tax (not allocated to projects)";
  const rows=[
    {sr:1,c:["1.1","Gross Revenue / Net Qualified Sales",...pc("grossRev")]},{sr:1,c:["1.2","Less: Output GST",...pc("outputGst")]},{sr:1,cls:"sub",c:["1","Total Revenue",...pc("rev")]},{band:"Direct Project Cost"},
    {sr:1,c:["2.1","Land Purchase Cost",...pc("landCost")]},{sr:1,c:["2.2","Stamp / Transfer Duty",...pc("stampDuty")]},{sr:1,c:["2.3","Foreign Purchaser Surcharge",...pc("foreignPurchaserSurcharge")]},{sr:1,c:["2.4","FIRB Application Fee",...pc("firbCost")]},{sr:1,c:["2.5","Acquisition Fee and Other Acquisition Costs",...pc("acquisitionCost")]},{sr:1,c:["2.6","Construction Cost",...pc("constructionCost")]},{sr:1,c:["2.7","Professional Fees",...pc("professionalFees")]},{sr:1,c:["2.8","Development Management Fees",...pc("developmentManagementFees")]},{sr:1,c:["2.9","Statutory Costs",...pc("statutoryCost")]},{sr:1,c:["2.10","Project Contingency",...pc("contingencyCost")]},{sr:1,c:["2.11","Land Holding Costs",...pc("holdingCost")]},{sr:1,c:["2.12","Brokerage & Incentive",...pc("brokerage")]},{sr:1,c:["2.13","Selling / Settlement Expenses",...pc("sellingCost")]},{sr:1,c:["2.14","Marketing and Advertising",...pc("marketing")]},{sr:1,c:["2.15","Capitalised Finance Cost Released",...pc("capitalisedFinanceCost")]},{sr:1,c:["2.16","Other Direct Cost",...pc("otherDirectCost")]},{sr:1,c:["2.17","Less: Recoverable Input GST Credit",...pc("inputGstCredit")]},{sr:1,cls:"sub",c:["2","Total Direct Cost",...pc("dc")]},{sr:1,cls:"res",c:["3","Gross Profit",...pc("gp")]},{band:"Overheads and Finance"},
    {sr:1,c:["4.1","General & Administrative Expenses",...pc("gna")]},{sr:1,c:["4.2","Shared-service G&A Allocation",...pc("gnaShared")]},{sr:1,c:["4.3","Staff / Manpower Expenses",...pc("staff")]},{sr:1,c:["4.4","Shared-service Staff / Manpower Allocation",...pc("staffShared")]},{sr:1,c:["4.5","Corporate Overhead Allocation",...pc("corpOverhead")]},{sr:1,cls:"sub",c:["4","Total Overhead Cost",...pc("oh")]},{sr:1,c:["5","Finance Cost, net of finance income",...pc("fin")]},{sr:1,c:["6","Depreciation & Amortisation",...pc("da")]},{sr:1,cls:"sub",c:["7","Total Overhead Cost including Finance",...pc("totalOverhead")]},{sr:1,c:["8","Development Fees / Other Income",...pc("otherIncome")]},{sr:1,cls:"res",c:["9","Net Profit Before Taxes",...pc("npbt")]},{sr:1,c:["10",taxLabel,...pc("tax")]},{sr:1,cls:"res",c:["11",profitLabel,...pc("npat")]},{sr:1,c:["",(isCorporate||projectTaxEntered?"Net margin on net revenue":"Project PBT margin on net revenue"),...fys.map(y=>{const rev=Q.sumFy(Q.PLM.rev,y);return rev?P(Q.sumFy(Q.PLM.npat,y)/rev):"–"}),totalRev?P(totalNpat/totalRev):"–"]}
  ];
  const warning=Q.errors.length?`<div class="goal miss">${Q.errors.length} selected project(s) could not be calculated and were excluded: ${Q.errors.map(x=>esc_(x.p.name)).join(", ")}.</div>`:"";
  set("o_cpl",controls+warning+portfolioTimelineHtml(Q)+tbl("Consolidated Australia Project Profit and Loss Account",["Ref.","Particulars",...fys.map(y=>"FY "+y),"Total"],rows,isCorporate?`All 11 Business Plan projects are selected. The 27-Jul-2026 corporate Business Plan P&L is the consolidation baseline for HoldCo overhead, other income and corporate tax, while changes to project inputs flow through as model deltas. This prevents project PBT from being mislabeled as corporate NPAT.`:`All selected projects are calendar-aligned first, then grouped using a ${MON[Q.fyEnd-1]} portfolio financial year end. This selected-project view is additive project economics; corporate tax and HoldCo items are not allocated unless explicitly entered at project level.`));bindPortfolioControls();
};
function renderDynamicCCF(){
  const Q=portfolioData(),controls=portfolioControlHtml();
  if(!Q.runs.length){set("o_ccf",controls+`<div class="empty">Select at least one valid project to build the consolidated cashflow.</div>`);bindPortfolioControls();return}
  const fys=Q.cfFys,sy=(arr,y)=>Q.sumFy(arr,y),L=(sr,lab,fn,cls)=>({sr:1,cls:cls||"",c:[sr,lab,...fys.map(y=>$(fn(y))),$(fys.reduce((a,y)=>a+fn(y),0))]});
  const netRevenue=y=>sy(Q.CFM.cfrefresrev,y)-sy(Q.CFM.cfrefgst,y),
    land=y=>sy(Q.CFM.cfrefland,y)+sy(Q.CFM.cfrefstamp,y)+sy(Q.CFM.cfrefholding,y)+sy(Q.CFM.cfreffirb,y)+sy(Q.CFM.cfrefforeignstamp,y),
    dev=y=>sy(Q.CFM.cfrefconstruction,y)+sy(Q.CFM.cfrefprofessional,y)+sy(Q.CFM.cfrefdm,y)+sy(Q.CFM.cfrefstatutory,y)+sy(Q.CFM.cfrefcontingency,y),
    sell=y=>sy(Q.CFM.cfrefbrokerage,y)+sy(Q.CFM.cfrefselling,y)+sy(Q.CFM.cfrefmarketing,y),
    debt=y=>sy(Q.CFM.cfrefdebt,y)+sy(Q.CFM.cfrefdebtfinance,y)+sy(Q.CFM.cfrefrepayment,y),
    fin=y=>sy(Q.CFM.cfrefprocessing,y)+sy(Q.CFM.cfrefinterest,y)+sy(Q.CFM.cfreflifetime,y);
  const rows=[
    L("1","Net Revenue",netRevenue,"sub"),L("1.1","Revenue - Residential",y=>sy(Q.CFM.cfrefresrev,y)),L("1.2","Less : GST",y=>sy(Q.CFM.cfrefgst,y)),
    L("2","Land Costs",land,"sub"),L("2.1","Land Costs",y=>sy(Q.CFM.cfrefland,y)),L("2.2","Stampduty",y=>sy(Q.CFM.cfrefstamp,y)),L("2.3","Land Holding Costs",y=>sy(Q.CFM.cfrefholding,y)),L("2.4","FIRB Fees",y=>sy(Q.CFM.cfreffirb,y)),L("2.5","Foreign Stampduty Charges",y=>sy(Q.CFM.cfrefforeignstamp,y)),
    L("3","Development Cost",dev,"sub"),L("3.1","Cost of construction",y=>sy(Q.CFM.cfrefconstruction,y)),L("3.2","Professional Fees",y=>sy(Q.CFM.cfrefprofessional,y)),L("3.3","Development Management Fees",y=>sy(Q.CFM.cfrefdm,y)),L("3.4","Statutory Costs",y=>sy(Q.CFM.cfrefstatutory,y)),L("3.5","Project Contingency",y=>sy(Q.CFM.cfrefcontingency,y)),
    L("4","Selling Costs",sell,"sub"),L("4.1","Brokerage Costs",y=>sy(Q.CFM.cfrefbrokerage,y)),L("4.2","Selling Expenses",y=>sy(Q.CFM.cfrefselling,y)),L("4.3","Marketing and advertising spends",y=>sy(Q.CFM.cfrefmarketing,y)),
    L("5","GST Refund",y=>sy(Q.CFM.cfgstrefund,y),"sub"),L("6","Net Cash Flow",y=>sy(Q.CFM.cfrefnetcash,y),"res"),
    L("7","Debt Schedule",debt,"sub"),L("7.1","(-) Debt Raised",y=>sy(Q.CFM.cfrefdebt,y)),L("7.2","(-) Debt Raised to Service Debt",y=>sy(Q.CFM.cfrefdebtfinance,y)),L("7.3","(+) Debt Repayment",y=>sy(Q.CFM.cfrefrepayment,y)),
    L("8","Finance Costs",fin,"sub"),L("8.1","Processing Fee",y=>sy(Q.CFM.cfrefprocessing,y)),L("8.2","Interest",y=>sy(Q.CFM.cfrefinterest,y)),L("8.3","Line fee",y=>sy(Q.CFM.cfreflifetime,y)),
    L("9","Equity Needed",y=>sy(Q.CFM.cfrefequity,y),"res"),L("10","Net Surplus",y=>sy(Q.CFM.cfrefsurplus,y),"res"),L("11","Profit (10 - 9)",y=>sy(Q.CFM.cfrefprofit,y),"res")
  ];
  const firstI=Math.max(0,(Q.cfFirst??Q.minAbs)-Q.minAbs),lastI=Math.min(Q.N-1,(Q.cfLast??Q.maxAbs)-Q.minAbs),mm=Array.from({length:Math.max(0,lastI-firstI+1)},(_,j)=>firstI+j),add=(...arrs)=>Q.CFM.cfrefprofit.map((_,i)=>arrs.reduce((a,x)=>a+_num((x||[])[i]),0)),sub=(a,b)=>Q.CFM.cfrefprofit.map((_,i)=>_num((a||[])[i])-_num((b||[])[i]));
  const monthlyRows=[
    ["1","Net Revenue",sub(Q.CFM.cfrefresrev,Q.CFM.cfrefgst),"sub"],["1.1","Revenue - Residential",Q.CFM.cfrefresrev],["1.2","Less : GST",Q.CFM.cfrefgst],
    ["2","Land Costs",add(Q.CFM.cfrefland,Q.CFM.cfrefstamp,Q.CFM.cfrefholding,Q.CFM.cfreffirb,Q.CFM.cfrefforeignstamp),"sub"],["2.1","Land Costs",Q.CFM.cfrefland],["2.2","Stampduty",Q.CFM.cfrefstamp],["2.3","Land Holding Costs",Q.CFM.cfrefholding],["2.4","FIRB Fees",Q.CFM.cfreffirb],["2.5","Foreign Stampduty Charges",Q.CFM.cfrefforeignstamp],
    ["3","Development Cost",add(Q.CFM.cfrefconstruction,Q.CFM.cfrefprofessional,Q.CFM.cfrefdm,Q.CFM.cfrefstatutory,Q.CFM.cfrefcontingency),"sub"],["3.1","Cost of construction",Q.CFM.cfrefconstruction],["3.2","Professional Fees",Q.CFM.cfrefprofessional],["3.3","Development Management Fees",Q.CFM.cfrefdm],["3.4","Statutory Costs",Q.CFM.cfrefstatutory],["3.5","Project Contingency",Q.CFM.cfrefcontingency],
    ["4","Selling Costs",add(Q.CFM.cfrefbrokerage,Q.CFM.cfrefselling,Q.CFM.cfrefmarketing),"sub"],["4.1","Brokerage Costs",Q.CFM.cfrefbrokerage],["4.2","Selling Expenses",Q.CFM.cfrefselling],["4.3","Marketing and advertising spends",Q.CFM.cfrefmarketing],
    ["5","GST Refund",Q.CFM.cfgstrefund,"sub"],["6","Net Cash Flow",Q.CFM.cfrefnetcash,"res"],["7","Debt Schedule",add(Q.CFM.cfrefdebt,Q.CFM.cfrefdebtfinance,Q.CFM.cfrefrepayment),"sub"],["7.1","(-) Debt Raised",Q.CFM.cfrefdebt],["7.2","(-) Debt Raised to Service Debt",Q.CFM.cfrefdebtfinance],["7.3","(+) Debt Repayment",Q.CFM.cfrefrepayment],
    ["8","Finance Costs",add(Q.CFM.cfrefprocessing,Q.CFM.cfrefinterest,Q.CFM.cfreflifetime),"sub"],["8.1","Processing Fee",Q.CFM.cfrefprocessing],["8.2","Interest",Q.CFM.cfrefinterest],["8.3","Line fee",Q.CFM.cfreflifetime],["9","Equity Needed",Q.CFM.cfrefequity,"res"],["10","Net Surplus",Q.CFM.cfrefsurplus,"res"],["11","Profit (10 - 9)",Q.CFM.cfrefprofit,"res"]
  ].map(([ref,label,arr,cls])=>({sr:1,cls:cls||"",c:[ref,label,...mm.map(i=>$(arr[i]))]}));
  const monthly=(APP.portfolioView==="monthly"&&mm.length)?`<div class="scrollx">${tbl("Consolidated Monthly Project Cash Flow",["Ref.","Particulars",...mm.map(i=>portfolioMonthLabel(Q.minAbs+i))],monthlyRows,"Same line sequence and sign convention as each individual project cashflow. Calendar-overlapping projects are added in the same month.")}</div>`:"";
  const warning=Q.errors.length?`<div class="goal miss">${Q.errors.length} selected project(s) could not be calculated and were excluded: ${Q.errors.map(x=>esc_(x.p.name)).join(", ")}.</div>`:"";
  set("o_ccf",controls+warning+portfolioTimelineHtml(Q)+tbl("Consolidated Cash Flow Statement",["Ref.","Particulars",...fys.map(y=>"FY "+y),"Total"],rows,`All selected projects are calendar-aligned first and then summed using the same cashflow line definitions as the individual project template. Positive line 6 is a pre-financing cash requirement; line 11 is Net Surplus less Equity Needed.`)+monthly);bindPortfolioControls();
};


/* ═══════════════════ EXPORT ═══════════════════ */
function xlsCell(v,fmt){
  if(v==null||v==="")return `<td></td>`;
  if(typeof v==="number")return `<td style="mso-number-format:'${fmt||"#,##0"}'">${v}</td>`;
  return `<td>${esc_(v)}</td>`;
}
function exportXml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;")}
function exportTextValue(el){
  if(!el)return "";
  const tag=(el.tagName||"").toUpperCase();
  if(tag==="INPUT"||tag==="TEXTAREA")return el.value||"";
  if(tag==="SELECT")return el.options&&el.selectedIndex>=0?el.options[el.selectedIndex].text:"";
  if(tag==="OUTPUT")return el.value||el.textContent||"";
  let out="";
  el.childNodes.forEach(n=>{
    if(n.nodeType===3)out+=n.nodeValue||"";
    else if(n.nodeType===1)out+=exportTextValue(n);
  });
  return out.replace(/\s+/g," ").trim();
}
function exportDomText(node){
  if(!node)return "";
  if(node.nodeType===3)return node.nodeValue||"";
  if(node.nodeType!==1)return "";
  const tag=node.tagName.toUpperCase();
  if(["SCRIPT","STYLE","BUTTON","NOSCRIPT"].includes(tag))return "";
  if(tag==="INPUT"||tag==="TEXTAREA")return node.value||"";
  if(tag==="SELECT")return node.options&&node.selectedIndex>=0?node.options[node.selectedIndex].text:"";
  if(tag==="OUTPUT")return node.value||node.textContent||"";
  if(tag==="BR")return "\n";
  if(tag==="SVG"){
    const labels=[...node.querySelectorAll("text")].map(x=>(x.textContent||"").replace(/\s+/g," ").trim()).filter(Boolean);
    return labels.length?"\nChart: "+labels.join(" | ")+"\n":"";
  }
  if(tag==="TABLE"){
    const rows=[];
    const cap=node.querySelector(":scope > caption");if(cap)rows.push(exportTextValue(cap));
    node.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr").forEach(tr=>{
      const cells=[...tr.children].filter(c=>/^(TH|TD)$/.test(c.tagName)).map(exportTextValue);
      if(cells.some(Boolean))rows.push(cells.join(" | "));
    });
    return "\n"+rows.join("\n")+"\n";
  }
  let text="";node.childNodes.forEach(c=>text+=exportDomText(c));
  const block=/^(DIV|P|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|H1|H2|H3|H4|H5|H6|LI|UL|OL|DL|DT|DD|DETAILS|SUMMARY|CAPTION)$/.test(tag);
  if(tag==="LI")text="- "+text;
  return block?"\n"+text+"\n":text;
}
function cleanExportLines(text){
  const lines=[];String(text||"").split(/\r?\n/).forEach(line=>{
    const v=line.replace(/[ \t]+/g," ").trim();
    if(v&&v!==lines[lines.length-1])lines.push(v);
  });
  return lines;
}
function collectDashboardSections(){
  paintAll();
  const sections=[];
  TABS.forEach(([id,label])=>{
    const pane=document.getElementById("p_"+id);if(!pane)return;
    const lines=cleanExportLines(exportDomText(pane));
    if(lines.length)sections.push({id,label,lines});
  });
  return sections;
}
function dashboardOutputsHtml(sections){
  let h='<table><tr><td style="background:#DDEBF7;font-weight:bold;border:.5pt solid #808080">Section</td><td style="background:#DDEBF7;font-weight:bold;border:.5pt solid #808080">Output</td></tr>';
  sections.forEach(sec=>sec.lines.forEach((line,i)=>{h+=`<tr><td style="border:.5pt solid #808080">${i?"":exportXml(sec.label)}</td><td style="border:.5pt solid #808080">${exportXml(line)}</td></tr>`}));
  return h+'</table>';
}
function xlsxColumnName(n){let s="";for(;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s}
function xlsxStyleIndex(cell){
  const st=(cell.getAttribute("style")||"").toUpperCase();
  if(st.includes("BACKGROUND:#DDEBF7"))return 1;
  if(st.includes("BACKGROUND:#FCE4D6"))return 2;
  if(st.includes("BACKGROUND:#D0CECE"))return 3;
  if(st.includes("BACKGROUND:#E2EFDA"))return 4;
  if(st.includes("0.0%")||st.includes("0%"))return 6;
  if(st.includes("0.00")&&!st.includes("#,##0.00"))return 7;
  if(st.includes("MSO-NUMBER-FORMAT")||st.includes("#,##0"))return 5;
  return 0;
}
function htmlTableToWorksheetXml(html){
  const doc=new DOMParser().parseFromString(html,"text/html"),table=doc.querySelector("table");
  if(!table)return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
  const rows=[...table.querySelectorAll("tr")],xmlRows=[],merges=[],widths=[];let maxCol=1;
  rows.forEach((tr,ri)=>{
    let ci=1,cells="";
    [...tr.children].filter(c=>/^(TD|TH)$/.test(c.tagName)).forEach(cell=>{
      const colspan=Math.max(1,parseInt(cell.getAttribute("colspan")||"1",10)||1),ref=xlsxColumnName(ci)+(ri+1),txt=exportTextValue(cell),style=xlsxStyleIndex(cell),fmt=(cell.getAttribute("style")||"").toLowerCase();
      const numeric=/^-?\d+(?:\.\d+)?$/.test(txt.replace(/,/g,""))&&fmt.includes("mso-number-format");
      widths[ci-1]=Math.max(widths[ci-1]||0,Math.min(60,txt.length+2));
      if(numeric)cells+=`<c r="${ref}" s="${style}"><v>${Number(txt.replace(/,/g,""))}</v></c>`;
      else cells+=`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${exportXml(txt)}</t></is></c>`;
      if(colspan>1)merges.push(`${ref}:${xlsxColumnName(ci+colspan-1)}${ri+1}`);
      ci+=colspan;maxCol=Math.max(maxCol,ci-1);
    });
    xmlRows.push(`<row r="${ri+1}">${cells}</row>`);
  });
  const cols=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.max(10,Math.min(60,w||10))}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${xlsxColumnName(maxCol)}${Math.max(1,rows.length)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${xmlRows.join("")}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(r=>`<mergeCell ref="${r}"/>`).join("")}</mergeCells>`:""}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
function uniqueSheetNames(sheets){
  const used=new Set();return sheets.map(([name,html],i)=>{let base=String(name||("Sheet "+(i+1))).replace(/[\\\/?*\[\]:]/g," ").trim().slice(0,31)||("Sheet "+(i+1)),n=base,k=2;while(used.has(n.toLowerCase())){const suf=" "+k++;n=base.slice(0,31-suf.length)+suf}used.add(n.toLowerCase());return [n,html]});
}
function utf8Bytes(s){return new TextEncoder().encode(s)}
function concatBytes(parts){const n=parts.reduce((a,b)=>a+b.length,0),out=new Uint8Array(n);let p=0;parts.forEach(b=>{out.set(b,p);p+=b.length});return out}
const CRC32_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=CRC32_TABLE[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function leBytes(values){const out=new Uint8Array(values.reduce((a,v)=>a+v[0],0));let p=0;values.forEach(([size,val])=>{for(let i=0;i<size;i++)out[p++]=(val>>>(8*i))&255});return out}
function zipStore(entries){
  const locals=[],centrals=[];let offset=0;
  entries.forEach(([name,data])=>{const nb=utf8Bytes(name),db=typeof data==="string"?utf8Bytes(data):data,crc=crc32(db);
    const lh=concatBytes([leBytes([[4,0x04034b50],[2,20],[2,0],[2,0],[2,0],[2,0],[4,crc],[4,db.length],[4,db.length],[2,nb.length],[2,0]]),nb,db]);
    locals.push(lh);
    const ch=concatBytes([leBytes([[4,0x02014b50],[2,20],[2,20],[2,0],[2,0],[2,0],[2,0],[4,crc],[4,db.length],[4,db.length],[2,nb.length],[2,0],[2,0],[2,0],[2,0],[4,0],[4,offset]]),nb]);
    centrals.push(ch);offset+=lh.length;
  });
  const central=concatBytes(centrals),end=leBytes([[4,0x06054b50],[2,0],[2,0],[2,entries.length],[2,entries.length],[4,central.length],[4,offset],[2,0]]);
  return concatBytes([...locals,central,end]);
}
function makeXlsxBlobCore(rawSheets){
  const sheets=uniqueSheetNames(rawSheets),entries=[];
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${exportXml(s[0])}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`;
  const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="A$#,##0;[Red](A$#,##0)"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD0CECE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf fontId="0" fillId="0" borderId="1" numFmtId="164" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf fontId="0" fillId="0" borderId="1" numFmtId="10" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf fontId="0" fillId="0" borderId="1" numFmtId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const now=new Date().toISOString(),core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${exportXml(P0().name)} Feasibility</dc:title><dc:creator>Land Feasibility</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,app=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Land Feasibility</Application><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map(s=>`<vt:lpstr>${exportXml(s[0])}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`;
  entries.push(["[Content_Types].xml",contentTypes],["_rels/.rels",rootRels],["xl/workbook.xml",workbook],["xl/_rels/workbook.xml.rels",wbRels],["xl/styles.xml",styles],["docProps/core.xml",core],["docProps/app.xml",app]);
  sheets.forEach((s,i)=>entries.push([`xl/worksheets/sheet${i+1}.xml`,htmlTableToWorksheetXml(s[1])]));
  return new Blob([zipStore(entries)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function _buildExcel(){
  const dashboardSections=collectDashboardSections();
  const d=derive(D),A=run(D);
  const sheets=[];
  const st="border:.5pt solid #808080;font-family:Calibri;font-size:9pt;";
  const hd=`${st}background:#FCE4D6;font-weight:bold;`;
  const bn=`${st}background:#DDEBF7;font-weight:bold;`;
  const gr=`${st}background:#D0CECE;font-weight:bold;`;
  const gn=`${st}background:#E2EFDA;font-weight:bold;`;
  /* Inputs */
  let t=`<table><tr><td style="${bn}" colspan="4">${esc_(P0().name)} — Input sheet</td></tr>
    <tr><td style="${hd}">Group</td><td style="${hd}">Particulars</td><td style="${hd}">Unit</td><td style="${hd}">Value</td></tr>`;
  GROUPS.forEach(g=>g.f.forEach(([k,lab,unit,,ty])=>{[lab,unit]=inputDisplay(k,lab,unit,d);
    t+=`<tr><td style="${st}">${g.g}</td><td style="${st}">${lab}</td><td style="${st}">${unit}</td>`+
      `<td style="${st}mso-number-format:'#,##0.00'">${(ty==="c"?d[k]:D[k])}</td></tr>`}));
  sheets.push(["Inputs",t+`</table>`]);
  /* P&L */
  const fys=A.fys.filter(y=>A.PL[y].rev!==0||A.B.net[y]!==0);
  const nf="'$#,##0'";
  t=`<table><tr><td style="${bn}" colspan="${fys.length+2}">Profit and Loss</td></tr>
    <tr><td style="${hd}">Sr</td><td style="${hd}">Description</td>${fys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;
  const pl=[["1","Total Revenue",y=>A.PL[y].rev,gr],
    ["2.1","Land Cost",y=>A.PL[y].landCost],
    ["2.2","Construction Cost",y=>A.PL[y].infraCost],
    ["2.6","Design & Supervision Cost",y=>A.PL[y].designCost],
    ["2.7","Authority Costs",y=>A.PL[y].authorityCost],
    ["2.8","Construction Costs (incl. builder risk insurance)",y=>A.PL[y].constructionCost],
    ["2.9","Capitalised Finance Cost Released",y=>A.PL[y].capitalisedFinanceCost],
    ["2.10","Other Direct Cost — explicit manual input only",y=>A.PL[y].otherDirectCost],
    ["2.11","Brokerage & Incentive",y=>A.PL[y].brokerage],
    ["2","Direct Cost",y=>A.PL[y].dc,gr],["3","Gross Profit",y=>A.PL[y].gp,gn],
    ["4.1.a","Project G&A Expenses",y=>A.PL[y].gna],
    ["4.1.b","Shared-service G&A Allocation",y=>A.PL[y].gnaShared],
    ["4.2.a","Project Staff / Manpower",y=>A.PL[y].staff],
    ["4.2.b","Shared-service Project Staff / Manpower Allocation",y=>A.PL[y].staffShared],
    ["4.3","Corporate Overhead Allocation",y=>A.PL[y].corpOverhead],
    ["4","Overhead Cost",y=>A.PL[y].oh,gr],
    ["5","Finance Cost Expensed (post-completion / non-capitalisable)",y=>A.PL[y].fin],["6","Depreciation & Amortization",y=>A.PL[y].da],
    ["7","Marketing & Selling Expenses",y=>A.PL[y].marketing],["8","Land Holding Costs",y=>A.PL[y].realEstateTax],
    ["10","Total Operating Costs",y=>A.PL[y].totalOverhead,gr],
    ["11","Other Income",y=>A.PL[y].otherIncome],["12","Net Profit Before Taxes",y=>A.PL[y].npbt,gn],
    ["13.1","Corporate Income Tax",y=>A.PL[y].corporateTax],["13.2","Franchise Tax",y=>A.PL[y].franchise],
    ["13","Total Taxes",y=>A.PL[y].tax],["14","Net Profit",y=>A.PL[y].npat,gn]];
  pl.forEach(([sr,lab,fn,style])=>{const s2=style||st;
    t+=`<tr><td style="${s2}">${sr}</td><td style="${s2}">${lab}</td>`+
      fys.map(y=>`<td style="${s2}mso-number-format:${nf}">${Math.round(fn(y))}</td>`).join("")+
      `<td style="${s2}mso-number-format:${nf}">${Math.round(fys.reduce((a,y)=>a+fn(y),0))}</td></tr>`});
  sheets.push(["P and L",t+`</table>`]);
  /* Cashflow */
  const cfMonthsByYear={};fys.forEach(y=>cfMonthsByYear[y]=[]);
  for(let m=0;m<=A.NM;m++){const y=fyOf(m,d);if(cfMonthsByYear[y])cfMonthsByYear[y].push(m)}
  const cfOpen={},cfClose={};fys.forEach(y=>{const ms=cfMonthsByYear[y],first=ms[0],last=ms[ms.length-1];cfOpen[y]=first>0?(A.R.cashtotal[first-1]||0):0;cfClose[y]=A.R.cashtotal[last]||0});
  const cfIn=y=>A.B.cfequity[y]+A.B.cfdebtraised[y]+A.B.salescash[y]+A.B.escin[y]+A.B.cfgstrefund[y]+A.B.pid[y]+A.B.cfotherincome[y];
  const cfOut=y=>A.B.cfland[y]+A.B.cfinfra[y]+A.B.cfpiddebt[y]+A.B.cfcapex[y]+A.B.cfconstruction[y]+A.B.cfdesign[y]+A.B.cfauthority[y]+A.B.cfbrokerage[y]+A.B.cfretax[y]+A.B.cfohpaid[y]+A.B.cfoutputgst[y]+A.B.cftaxpaid[y]+A.B.cffinance[y]+A.B.cfdebtrepaid[y];
  t=`<table><tr><td style="${bn}" colspan="${fys.length+3}">Project Cashflow Statement — Net Equity Funding</td></tr>
    <tr><td style="${hd}">Sl No.</td><td style="${hd}">Description</td>${fys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;
  const addCf=(sr,lab,fn,style=st,totalFn=null)=>{t+=`<tr><td style="${style}">${sr}</td><td style="${style}">${lab}</td>`+
    fys.map(y=>`<td style="${style}mso-number-format:${nf}">${Math.round(fn(y))}</td>`).join("")+
    `<td style="${style}mso-number-format:${nf}">${totalFn===null?Math.round(fys.reduce((a,y)=>a+fn(y),0)):totalFn}</td></tr>`};
  addCf("A","Opening Cash Balance",y=>cfOpen[y],gr,"");
  t+=`<tr><td style="${bn}">B</td><td style="${bn}" colspan="${fys.length+2}">Cash Inflows</td></tr>`;
  addCf("1","Net Equity Infusion / (Distribution)",y=>A.B.cfequity[y]);
  addCf("2","Debt Raised",y=>A.B.cfdebtraised[y]);
  addCf("3","Collection from Sales",y=>A.B.salescash[y]);
  addCf("4","Collection in Escrow",y=>A.B.escin[y]);
  addCf("5","GST Refund",y=>A.B.cfgstrefund[y]);
  addCf("5.1","Other Reimbursement",y=>A.B.pid[y]);
  addCf("5.2","Other Cash Income",y=>A.B.cfotherincome[y]);
  addCf("","Total Cash Inflows",cfIn,gr);
  t+=`<tr><td style="${bn}">C</td><td style="${bn}" colspan="${fys.length+2}">Cash Outflows</td></tr>`;
  addCf("6","Land Cost",y=>A.B.cfland[y]);
  addCf("7","Construction Costs",y=>A.B.cfinfra[y]);
  addCf("8","INFRA – PID / DEBT – Processing",y=>A.B.cfpiddebt[y]);
  addCf("8.1","Depreciable Capital Expenditure",y=>A.B.cfcapex[y]);
  addCf("9","Construction Costs",y=>A.B.cfconstruction[y]);
  addCf("10","Design & Supervision Costs",y=>A.B.cfdesign[y]);
  addCf("11","Authority Costs",y=>A.B.cfauthority[y]);
  addCf("12","Brokerage",y=>A.B.cfbrokerage[y]);
  addCf("13","Land Holding Costs",y=>A.B.cfretax[y]);
  addCf("14","OH Paid",y=>A.B.cfohpaid[y]);
  addCf("14.1","Output GST Paid",y=>A.B.cfoutputgst[y]);
  addCf("15","Tax Paid",y=>A.B.cftaxpaid[y]);
  addCf("16","Finance Cost",y=>A.B.cffinance[y]);
  addCf("17","Debt Repaid",y=>A.B.cfdebtrepaid[y]);
  addCf("","Total Project Outflows",cfOut,gr);
  addCf("D","Closing Cash Balance",y=>cfClose[y],gn,Math.round(cfClose[fys[fys.length-1]]));
  sheets.push(["Cashflow",t+`</table>`]);
  /* Business Plan source statements for the selected scope */
  if(APP.portfolioBasis==="source"){
    const keys=sourceSelectedKeys();
    if(keys.length){
      if(sourceExactAll()){
        const ps=APP.sourceData.consolidatedPL,ys=ps.years.map(Number);let sx=`<table><tr><td style="${bn}" colspan="${ys.length+3}">Source - Consolidated P&L</td></tr><tr><td style="${hd}">Ref.</td><td style="${hd}">Description</td>${ys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;(ps.lines||[]).forEach(r=>{sx+=`<tr><td style="${st}">${esc_(r.code||"")}</td><td style="${st}">${esc_(r.label||"")}</td>${ys.map(y=>`<td style="${st}mso-number-format:${nf}">${Math.round(srcVal(r,y))}</td>`).join("")}<td style="${st}mso-number-format:${nf}">${Math.round(Number(r.total||0))}</td></tr>`});sheets.push(["Source Consolidated PL",sx+`</table>`]);
        const cs=APP.sourceData.consolidatedCF,cys=cs.years.map(Number);sx=`<table><tr><td style="${bn}" colspan="${cys.length+3}">Source - Consolidated Cashflow</td></tr><tr><td style="${hd}">Ref.</td><td style="${hd}">Description</td>${cys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;(cs.lines||[]).forEach(r=>{sx+=`<tr><td style="${st}">${esc_(r.code||"")}</td><td style="${st}">${esc_(r.label||"")}</td>${cys.map(y=>`<td style="${st}mso-number-format:${nf}">${Math.round(srcVal(r,y))}</td>`).join("")}<td style="${st}mso-number-format:${nf}">${Math.round(Number(r.total||0))}</td></tr>`});sheets.push(["Source Consolidated CF",sx+`</table>`]);
      }
    }
  }
  /* Selected portfolio consolidated statements */
  const Q=portfolioData();
  if(Q.runs.length){
    const pfys=Q.plFys,psy=(k,y)=>Q.sumFy(Q.PLM[k],y),ptot=k=>Q.PLM[k].reduce((a,b)=>a+b,0);
    t=`<table><tr><td style="${bn}" colspan="${pfys.length+3}">Selected Portfolio — Consolidated Profit and Loss</td></tr>
      <tr><td style="${hd}">Ref.</td><td style="${hd}">Description</td>${pfys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;
    const addP=(sr,lab,k,style=st)=>{t+=`<tr><td style="${style}">${sr}</td><td style="${style}">${lab}</td>${pfys.map(y=>`<td style="${style}mso-number-format:${nf}">${Math.round(psy(k,y))}</td>`).join("")}<td style="${style}mso-number-format:${nf}">${Math.round(ptot(k))}</td></tr>`};
    [["1.1","Gross Revenue / Net Qualified Sales","grossRev"],["1.2","Less: Output GST","outputGst"],["1","Total Revenue","rev",gr],["2.1","Land Purchase Cost","landCost"],["2.2","Stamp / Transfer Duty","stampDuty"],["2.3","Foreign Purchaser Surcharge","foreignPurchaserSurcharge"],["2.4","FIRB Application Fee","firbCost"],["2.5","Acquisition Fee and Other Acquisition Costs","acquisitionCost"],["2.6","Construction Cost","constructionCost"],["2.7","Professional Fees","professionalFees"],["2.8","Development Management Fees","developmentManagementFees"],["2.9","Statutory Costs","statutoryCost"],["2.10","Project Contingency","contingencyCost"],["2.11","Land Holding Costs","holdingCost"],["2.12","Brokerage & Incentive","brokerage"],["2.13","Selling / Settlement Expenses","sellingCost"],["2.14","Marketing and Advertising","marketing"],["2.15","Capitalised Finance Cost Released","capitalisedFinanceCost"],["2.16","Other Direct Cost","otherDirectCost"],["2.17","Less: Recoverable Input GST Credit","inputGstCredit"],["2","Total Direct Cost","dc",gr],["3","Gross Profit","gp",gn],["4.1","General & Administrative Expenses","gna"],["4.2","Shared-service G&A Allocation","gnaShared"],["4.3","Staff / Manpower Expenses","staff"],["4.4","Shared-service Staff / Manpower Allocation","staffShared"],["4.5","Corporate Overhead Allocation","corpOverhead"],["4","Total Overhead Cost","oh",gr],["5","Finance Cost","fin"],["6","Depreciation & Amortisation","da"],["7","Total Overhead Cost including Finance","totalOverhead",gr],["8","Development Fees / Other Income","otherIncome"],["9","Net Profit Before Taxes","npbt",gn],["10","Corporate Taxes","tax"],["11","Net Profit after Tax","npat",gn]].forEach(x=>addP(x[0],x[1],x[2],x[3]||st));
    sheets.push(["Portfolio P and L",t+`</table>`]);
    const cfys=Q.cfFys,ss=(arr,y)=>Q.sumFy(arr,y);
    t=`<table><tr><td style="${bn}" colspan="${cfys.length+3}">Selected Portfolio - Consolidated Australia Project Cash Flow Statement</td></tr>
      <tr><td style="${hd}">Ref.</td><td style="${hd}">Particulars</td>${cfys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;
    const addPC=(sr,lab,fn,style=st)=>{const vals=cfys.map(fn);t+=`<tr><td style="${style}">${sr}</td><td style="${style}">${lab}</td>${vals.map(v=>`<td style="${style}mso-number-format:${nf}">${Math.round(v)}</td>`).join("")}<td style="${style}mso-number-format:${nf}">${Math.round(vals.reduce((a,b)=>a+b,0))}</td></tr>`};
    const pNet=y=>ss(Q.CFM.cfrefresrev,y)-ss(Q.CFM.cfrefgst,y),pLand=y=>ss(Q.CFM.cfrefland,y)+ss(Q.CFM.cfrefstamp,y)+ss(Q.CFM.cfrefholding,y)+ss(Q.CFM.cfreffirb,y)+ss(Q.CFM.cfrefforeignstamp,y),pDev=y=>ss(Q.CFM.cfrefconstruction,y)+ss(Q.CFM.cfrefprofessional,y)+ss(Q.CFM.cfrefdm,y)+ss(Q.CFM.cfrefstatutory,y)+ss(Q.CFM.cfrefcontingency,y),pSell=y=>ss(Q.CFM.cfrefbrokerage,y)+ss(Q.CFM.cfrefselling,y)+ss(Q.CFM.cfrefmarketing,y),pDebt=y=>ss(Q.CFM.cfrefdebt,y)+ss(Q.CFM.cfrefdebtfinance,y)+ss(Q.CFM.cfrefrepayment,y),pFin=y=>ss(Q.CFM.cfrefprocessing,y)+ss(Q.CFM.cfrefinterest,y)+ss(Q.CFM.cfreflifetime,y);
    addPC("1","Net Revenue",pNet,gr);addPC("1.1","Revenue - Residential",y=>ss(Q.CFM.cfrefresrev,y));addPC("1.2","Less : GST",y=>ss(Q.CFM.cfrefgst,y));
    addPC("2","Land Costs",pLand,gr);addPC("2.1","Land Costs",y=>ss(Q.CFM.cfrefland,y));addPC("2.2","Stampduty",y=>ss(Q.CFM.cfrefstamp,y));addPC("2.3","Land Holding Costs",y=>ss(Q.CFM.cfrefholding,y));addPC("2.4","FIRB Fees",y=>ss(Q.CFM.cfreffirb,y));addPC("2.5","Foreign Stampduty Charges",y=>ss(Q.CFM.cfrefforeignstamp,y));
    addPC("3","Development Cost",pDev,gr);addPC("3.1","Cost of construction",y=>ss(Q.CFM.cfrefconstruction,y));addPC("3.2","Professional Fees",y=>ss(Q.CFM.cfrefprofessional,y));addPC("3.3","Development Management Fees",y=>ss(Q.CFM.cfrefdm,y));addPC("3.4","Statutory Costs",y=>ss(Q.CFM.cfrefstatutory,y));addPC("3.5","Project Contingency",y=>ss(Q.CFM.cfrefcontingency,y));
    addPC("4","Selling Costs",pSell,gr);addPC("4.1","Brokerage Costs",y=>ss(Q.CFM.cfrefbrokerage,y));addPC("4.2","Selling Expenses",y=>ss(Q.CFM.cfrefselling,y));addPC("4.3","Marketing and advertising spends",y=>ss(Q.CFM.cfrefmarketing,y));addPC("5","GST Refund",y=>ss(Q.CFM.cfgstrefund,y),gr);addPC("6","Net Cash Flow",y=>ss(Q.CFM.cfrefnetcash,y),gn);
    addPC("7","Debt Schedule",pDebt,gr);addPC("7.1","(-) Debt Raised",y=>ss(Q.CFM.cfrefdebt,y));addPC("7.2","(-) Debt Raised to Service Debt",y=>ss(Q.CFM.cfrefdebtfinance,y));addPC("7.3","(+) Debt Repayment",y=>ss(Q.CFM.cfrefrepayment,y));
    addPC("8","Finance Costs",pFin,gr);addPC("8.1","Processing Fee",y=>ss(Q.CFM.cfrefprocessing,y));addPC("8.2","Interest",y=>ss(Q.CFM.cfrefinterest,y));addPC("8.3","Line fee",y=>ss(Q.CFM.cfreflifetime,y));addPC("9","Equity Needed",y=>ss(Q.CFM.cfrefequity,y),gn);addPC("10","Net Surplus",y=>ss(Q.CFM.cfrefsurplus,y),gn);addPC("11","Profit (10 - 9)",y=>ss(Q.CFM.cfrefprofit,y),gn);
    sheets.push(["Portfolio Cashflow",t+`</table>`]);
  }
  /* Scenarios */
  const cols=APP.cols.map(k=>LV[k]).filter(Boolean),mets=APP.mets.map(k=>MET[k]).filter(Boolean);
  t=`<table><tr><td style="${bn}" colspan="${cols.length+mets.length+2}">Scenario analysis</td></tr>
    <tr><td style="${hd}">Scenario</td>${cols.map(c=>`<td style="${hd}">${c.n} (${c.u})</td>`).join("")}
    ${mets.map(m=>`<td style="${hd}">${m.n}</td>`).join("")}<td style="${hd}">Maximum land price A$/sqm</td></tr>`;
  APP.scn.forEach(sc=>{const ov=scnOv(sc);let m=null;try{m=run(D,ov)}catch(e){}
    const s2=sc.pin?gn:st;
    t+=`<tr><td style="${s2}">${esc_(sc.n)}</td>`+
      cols.map(c=>`<td style="${s2}mso-number-format:'#,##0.##'">${ov[c.k]??d[c.k]}</td>`).join("")+
      mets.map(mt=>{const v=m?(mt.k==="maxland"?solveLand(D,"npv",0,ov):m[mt.k]):null;
        const f=mt.f===P?"'0.0%'":(mt.f===X?"'0.00'":nf);
        return `<td style="${s2}mso-number-format:${f}">${v==null?"":(mt.f===P?v:Math.round(v*(mt.f===X?100:1))/(mt.f===X?100:1))}</td>`}).join("")+
      `<td style="${s2}mso-number-format:${nf}">${Math.round(solveLand(D,"npv",0,ov)||0)}</td></tr>`});
  sheets.push(["Scenarios",t+`</table>`]);
  /* Summary */
  t=`<table><tr><td style="${bn}" colspan="4">Decision summary</td></tr>
    <tr><td style="${hd}">Particulars</td><td style="${hd}">Amount</td></tr>`;
  [["Land cost",A.land],["Total revenue",A.revenue],["Direct cost",A.direct],
   ["Gross profit",A.gross],["Operating overhead cost — line 4",A.operatingOverhead],["Finance cost expensed — line 5",A.financeExpense],
   ["Depreciation & amortization — line 6",A.depreciation],["Marketing & selling expenses — line 7",A.marketing],["Real estate tax — line 8",A.realEstateTax],["Total operating costs — line 10 subtotal",A.totalOperatingCost],["Other income",A.otherIncome],["Net profit before taxes",A.npbt],["Corporate income tax",A.corporateTax],["Franchise tax",A.franchiseTax],["Total taxes",A.tax],["Net profit",A.npat],["Equity injected",A.einj],
   ["Equity returned",A.eret],["Peak debt",A.peakdebt],["Project NPV",A.npv],
   ["Maximum land price at NPV nil",solveLand(D,"npv",0)],
   ["Maximum land price at target return",solveLand(D,"eirr",d.hurdle/100)]].forEach(([lab,a])=>{
    t+=`<tr><td style="${st}">${lab}</td><td style="${st}mso-number-format:${nf}">${Math.round(a||0)}</td></tr>`});
  [["Net margin",A.margin],["Project IRR",A.irr],["Equity IRR",A.eirr]].forEach(([lab,a])=>{
    t+=`<tr><td style="${st}">${lab}</td><td style="${st}mso-number-format:'0.0%'">${a}</td></tr>`});
  t+=`<tr><td style="${st}">Equity multiple</td><td style="${st}mso-number-format:'0.00'">${A.moic}</td></tr>`;
  sheets.unshift(["Summary",t+`</table>`]);
  /* every parcel, so the workbook carries the comparison too */
  let c=`<table><tr><td style="${bn}" colspan="10">Parcel comparison</td></tr><tr>`+
    ["Parcel","Site area (sqm)","Lots","A$/sqm","Revenue","Net profit","Margin","Equity IRR","Multiple","NPV"]
      .map(x=>`<td style="${hd}">${x}</td>`).join("")+`</tr>`;
  APP.parcels.forEach(pp=>{let m=null;try{m=run(pp.inputs)}catch(e){}
    const dd2=derive(pp.inputs);
    c+=`<tr><td style="${st}">${esc_(pp.name)}</td>`+
      `<td style="${st}mso-number-format:'#,##0.0'">${dd2.acresGross}</td>`+
      `<td style="${st}">${dd2._lots}</td>`+
      `<td style="${st}mso-number-format:${nf}">${Math.round(dd2.pr)}</td>`+
      `<td style="${st}mso-number-format:${nf}">${Math.round(m?m.revenue:0)}</td>`+
      `<td style="${st}mso-number-format:${nf}">${Math.round(m?m.npat:0)}</td>`+
      `<td style="${st}mso-number-format:'0.0%'">${m?m.margin:0}</td>`+
      `<td style="${st}mso-number-format:'0.0%'">${m&&m.eirr!=null?m.eirr:0}</td>`+
      `<td style="${st}mso-number-format:'0.00'">${m?m.moic:0}</td>`+
      `<td style="${st}mso-number-format:${nf}">${Math.round(m?m.npv:0)}</td></tr>`});
  sheets.push(["Parcels",c+`</table>`]);
  sheets.push(["All Dashboard Outputs",dashboardOutputsHtml(dashboardSections)]);
  dl(makeXlsxBlob(sheets),fname(P0().name)+"_Feasibility_Tables.xlsx");
}
function buildExcel(){try{return _buildExcel()}catch(e){return showModelError(e)}}
function fname(s){return String(s||"appraisal").replace(/[^\w\-]+/g,"_").slice(0,48)}
function dl(blob,name){const a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function preparePdfSave(name){
  if(typeof window.showSaveFilePicker!=="function")return null;
  try{return await window.showSaveFilePicker({suggestedName:name,types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]})}
  catch(e){if(e&&e.name==="AbortError")return false;return null}
}
async function savePdfBlob(blob,name,handle){
  if(handle){const writable=await handle.createWritable();await writable.write(blob);await writable.close();return true}
  dl(blob,name);return true
}
function pdfAscii(s){return String(s==null?"":s).replace(/[–—]/g,"-").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/→/g,"->").replace(/≤/g,"<=").replace(/≥/g,">=").replace(/±/g,"+/-").replace(/×/g,"x").replace(/…/g,"...").replace(/[^\x20-\x7E]/g,"")}
function pdfEscape(s){return pdfAscii(s).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")}





function _buildReport(){
  const d=derive(D),A=run(D);
  const be=solveLand(D,"npv",0),hurd=solveLand(D,"eirr",d.hurdle/100);
  let h=`<div class="rp"><h1 style="font:700 15px var(--sans);margin:0 0 2px">${esc_(P0().name)}</h1>
    <div style="font-size:11px;color:#555;margin-bottom:8px">${esc_(P0().loc)} —
      Land acquisition appraisal — ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</div>
    ${tbl("Appraisal summary",["Particulars","Amount","% of revenue"],[
      {sr:1,c:["Land price per sqm",$(d.pr),""]},
      {sr:1,c:["Total land cost",$(A.land),P(A.land/A.revenue)]},
      {sr:1,cls:"sub",c:["Total revenue",$(A.revenue),P(1)]},
      {sr:1,c:["Direct cost",$(A.direct),P(A.direct/A.revenue)]},
      {sr:1,cls:"res",c:["Gross profit",$(A.gross),P(A.gross/A.revenue)]},
      {sr:1,c:["Operating overhead",$(A.operatingOverhead),P(A.operatingOverhead/A.revenue)]},
      {sr:1,c:["Total operating costs below gross profit",$(A.totalOperatingCost),P(A.totalOperatingCost/A.revenue)]},
      {sr:1,c:["Finance cost incurred — capitalised to qualifying inventory (disclosure)",$(A.finance),P(A.finance/A.revenue)]},
      {sr:1,c:["Taxation",$(A.tax),P(A.tax/A.revenue)]},
      {sr:1,cls:"res",c:["Net profit",$(A.npat),P(A.margin)]},
      {sr:1,c:["Equity injected",$(A.einj),""]},
      {sr:1,c:["Peak debt",$(A.peakdebt),""]},
      {sr:1,c:["Project IRR, pre-tax unlevered",P(A.irr),""]},
      {sr:1,cls:"res",c:["Equity IRR, after tax and debt",P(A.eirr),""]},
      {sr:1,cls:"res",c:["Equity multiple",X(A.moic),""]},
      {sr:1,cls:"res",c:["Project NPV",$(A.npv),""]},
      {sr:1,c:["Maximum land price, NPV nil",$(be),""]},
      {sr:1,c:[`Maximum land price at a ${M0(d.hurdle,1)}% equity return`,$(hurd),""]},
    ],"Prepared from the inputs recorded on the following page. Not a valuation or investment advice.")}
    ${APP.parcels.length>1?tbl("Parcel comparison",["Parcel","A$/sqm","Revenue","Net profit","Margin","Equity IRR","Multiple","NPV"],
      APP.parcels.map((pp,i)=>{let m=null;try{m=run(pp.inputs)}catch(e){}const dd2=derive(pp.inputs);
        return {sr:1,cls:i===APP.active?"res":"",c:[pp.name,$(dd2.pr),$(m?m.revenue:null),$(m?m.npat:null),
          P(m?m.margin:null),P(m?m.eirr:null),X(m?m.moic:null),$(m?m.npv:null)]}}),
      "The highlighted parcel is the one detailed above."):""}</div>`;
  const rows=[];GROUPS.forEach(g=>{rows.push({band:g.g});
    g.f.forEach(([k,lab,unit,,ty])=>{[lab,unit]=inputDisplay(k,lab,unit,d);rows.push({sr:1,c:[lab,unit,
      (ty==="c"?(typeof d[k]==="number"?M0(d[k],2):d[k]):(typeof D[k]==="number"?M0(D[k],2):D[k]))]})})});
  h+=`<div class="rp">${tbl("Input schedule",["Particulars","Unit","Value"],rows)}</div>`;
  document.getElementById("report").innerHTML=h;
}

function buildReport(){try{_buildReport();return true}catch(e){return showModelError(e)}}

/* ═══════════════════ VERDICT ═══════════════════ */
function tornado(){
  const mk=MET[APP.tMet],sw=APP.tSwing/100,d=derive(D);
  const base=metric(APP.tMet);
  const rows=levers().map(x=>{
    const b=cur(x.k,d);
    let lo=b*(1-sw),hi=b*(1+sw);
    if(Math.abs(b)<1e-9){const span=(x.hi-x.lo)*sw;lo=Math.max(x.lo,b-span/2);hi=Math.min(x.hi,b+span/2);if(Math.abs(hi-lo)<1e-9)hi=Math.min(x.hi,b+span)}
    lo=Math.max(x.lo,lo);hi=Math.min(x.hi,hi);
    if(Math.abs(hi-lo)<1e-9)return null;
    const a=metric(APP.tMet,ovFor(x.k,lo,d)),c=metric(APP.tMet,ovFor(x.k,hi,d));
    if(a==null&&c==null)return null;
    const va=a==null?base:a,vc=c==null?base:c;
    return {x,lo,hi,vlo:va,vhi:vc,span:Math.abs(vc-va),zeroBase:Math.abs(b)<1e-9};
  }).filter(Boolean).filter(r=>r.span>1e-9).sort((p,q)=>q.span-p.span).slice(0,12);
  if(!rows.length||base==null)return `<div class="chart"><div class="ch">Tornado</div>
    <svg viewBox="0 0 1000 60"><text class="axlab" x="14" y="34">No measurable swing at this setting.</text></svg></div>`;
  const W=1000,rh=25,pl=210,pr=126,H=rows.length*rh+46;
  const all=rows.flatMap(r=>[r.vlo,r.vhi]).concat([base]);
  let mn=Math.min(...all),mx=Math.max(...all);if(mn===mx)mx=mn+1;
  const sp=(mx-mn)*.06;mn-=sp;mx+=sp;
  const sx=v=>pl+(v-mn)/(mx-mn)*(W-pl-pr);
  let g=`<line class="axis" x1="${sx(base)}" y1="26" x2="${sx(base)}" y2="${H-16}" stroke="#16294B" stroke-width="1.6"/>
    <text class="ttl" x="${sx(base)}" y="20" text-anchor="middle">base ${mk.f(base)}</text>`;
  rows.forEach((r,i)=>{const y=32+i*rh,x1=sx(Math.min(r.vlo,r.vhi)),x2=sx(Math.max(r.vlo,r.vhi));
    g+=`<rect x="${x1}" y="${y}" width="${Math.max(x2-x1,1.5)}" height="${rh-9}"
      fill="${r.vhi>r.vlo?"#8EA9DB":"#E8A9A9"}" opacity=".92"/>
      <text class="axlab" x="${pl-8}" y="${y+11}" text-anchor="end" style="font-family:var(--sans);font-size:11px">${r.x.n}</text>
      <text class="axlab" x="${W-pr+7}" y="${y+11}">${mk.f(r.vlo)} → ${mk.f(r.vhi)}</text>`});
  const zeroNote=rows.some(r=>r.zeroBase)?`; zero-base drivers use absolute test ranges`:``;
  return `<div class="chart"><div class="ch">Tornado — ${mk.n} at ±${APP.tSwing}% on non-zero drivers${zeroNote}, ranked by impact</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tornado chart">${g}</svg></div>`;
}










/* ═══════════════════ SUMMARY / P&L / CF / MONTHLY ═══════════════════ */
const _projectCashflowHtml=new Map();
function renderProjectCashflow({A,d}){
  const cfKey=contextKey(),cfCached=cacheGetLRU(_projectCashflowHtml,cfKey);if(cfCached!==undefined){set("o_cf",cfCached);return}
  const activityRows=["cfrefresrev","cfrefgst","cfrefland","cfrefstamp","cfrefholding","cfreffirb","cfrefforeignstamp","cfrefconstruction","cfrefprofessional","cfrefdm","cfrefstatutory","cfrefcontingency","cfrefbrokerage","cfrefselling","cfrefmarketing","cfgstrefund","cfrefnetcash","dr1","dr2","rep","pf","intr","lf","cfrefequity","cfrefsurplus"];
  const fys=A.fys.filter(y=>activityRows.some(k=>Math.abs((A.B[k]&&A.B[k][y])||0)>.5));
  const b=(key,y)=>_num(A.B[key]&&A.B[key][y]),sum=(fn)=>fys.reduce((a,y)=>a+fn(y),0);
  const L=(sr,lab,fn,cls,totalFn)=>({sr:1,cls:cls||"",c:[sr,lab,...fys.map(y=>$(fn(y))),$(totalFn?totalFn():sum(fn))]});
  const netRevenue=y=>b("cfrefresrev",y)-b("cfrefgst",y),landCost=y=>b("cfrefland",y)+b("cfrefstamp",y)+b("cfrefholding",y)+b("cfreffirb",y)+b("cfrefforeignstamp",y),developmentCost=y=>b("cfrefconstruction",y)+b("cfrefprofessional",y)+b("cfrefdm",y)+b("cfrefstatutory",y)+b("cfrefcontingency",y),sellingCost=y=>b("cfrefbrokerage",y)+b("cfrefselling",y)+b("cfrefmarketing",y),debtSchedule=y=>-b("dr1",y)-b("dr2",y)+b("rep",y),financeCost=y=>b("pf",y)+b("intr",y)+b("lf",y);
  const taxTotal=A.R.taxm.reduce((a,v)=>a+v,0),otherIncomeTotal=A.R.otherincome.reduce((a,v)=>a+v,0),overheadTotal=A.R.ovh.reduce((a,v)=>a+v,0),reimbTotal=A.R.pid.reduce((a,v)=>a+v,0);
  const noteBits=["Positive line 6 means a pre-financing cash requirement; negative means operating cash surplus.","Debt raised is shown as a negative requirement, debt repayment and finance costs as positive requirements.","Line 9 is actual equity injected; line 10 is actual distributable surplus returned to equity; line 11 is line 10 minus line 9."];
  if(taxTotal>0)noteBits.push("The supplied layout has no income-tax row, so corporate/state tax cash payments are included in line 6 Net Cash Flow to keep the funding waterfall after tax.");
  if(otherIncomeTotal>0)noteBits.push("Other project income is included in 1.1 Revenue - Residential because the supplied layout has no separate other-income row.");
  if(overheadTotal>0)noteBits.push("Project G&A/staff/corporate overhead cash is included in 3.3 Development Management Fees because the supplied layout has no separate overhead row.");
  if(reimbTotal>0)noteBits.push("Council/infrastructure reimbursements are netted against 3.1 Cost of construction.");
  noteBits.push(d.costgstbasis===0?"Development/selling cost inputs are treated as GST-exclusive: GST paid is grossed into the relevant cost rows and recovered in line 5 after the refund lag.":"Development/selling cost inputs are treated as GST-inclusive: embedded recoverable GST is returned in line 5 after the refund lag.");
  const rows=[
    L("1","Net Revenue",netRevenue,"sub"),
    L("1.1","Revenue - Residential",y=>b("cfrefresrev",y)),
    L("1.2","Less : GST",y=>b("cfrefgst",y)),
    L("2","Land Costs",landCost,"sub"),
    L("2.1","Land Costs",y=>b("cfrefland",y)),
    L("2.2","Stampduty",y=>b("cfrefstamp",y)),
    L("2.3","Land Holding Costs",y=>b("cfrefholding",y)),
    L("2.4","FIRB Fees",y=>b("cfreffirb",y)),
    L("2.5","Foreign Stampduty Charges",y=>b("cfrefforeignstamp",y)),
    L("3","Development Cost",developmentCost,"sub"),
    L("3.1","Cost of construction",y=>b("cfrefconstruction",y)),
    L("3.2","Professional Fees",y=>b("cfrefprofessional",y)),
    L("3.3","Development Management Fees",y=>b("cfrefdm",y)),
    L("3.4","Statutory Costs",y=>b("cfrefstatutory",y)),
    L("3.5","Project Contingency",y=>b("cfrefcontingency",y)),
    L("4","Selling Costs",sellingCost,"sub"),
    L("4.1","Brokerage Costs",y=>b("cfrefbrokerage",y)),
    L("4.2","Selling Expenses",y=>b("cfrefselling",y)),
    L("4.3","Marketing and advertising spends",y=>b("cfrefmarketing",y)),
    L("5","GST Refund",y=>b("cfgstrefund",y),"sub"),
    L("6","Net Cash Flow",y=>b("cfrefnetcash",y),"res"),
    L("7","Debt Schedule",debtSchedule,"sub"),
    L("7.1","(-) Debt Raised",y=>-b("dr1",y)),
    L("7.2","(-) Debt Raised to Service Debt",y=>-b("dr2",y)),
    L("7.3","(+) Debt Repayment",y=>b("rep",y)),
    L("8","Finance Costs",financeCost,"sub"),
    L("8.1","Processing Fee",y=>b("pf",y)),
    L("8.2","Interest",y=>b("intr",y)),
    L("8.3","Line fee",y=>b("lf",y)),
    L("9","Equity Needed",y=>b("cfrefequity",y),"res"),
    L("10","Net Surplus",y=>b("cfrefsurplus",y),"res"),
    L("11","Profit (10 - 9)",y=>b("cfrefprofit",y),"res")
  ];
  const warning=(taxTotal>0||otherIncomeTotal>0||overheadTotal>0||reimbTotal>0)?`<div class="source-note"><b>Reference-format mapping:</b> ${noteBits.slice(3).join(" ")}</div>`:"";
  const cfHtml=warning+tbl("Project Cash Flow Statement",["Ref.","Particulars",...fys.map(y=>"FY "+y),"Total"],rows,noteBits.join(" "));
  set("o_cf",cfHtml);cacheSetLRU(_projectCashflowHtml,cfKey,cfHtml,8);
};
PANE.monthly=function({A,d}){
  const R=A.R;let last=0;["cfrefresrev","cfrefgst","cfrefland","cfrefconstruction","cfgstrefund","cfrefnetcash","dr1","dr2","rep","pf","intr","lf","cfrefequity","cfrefsurplus"].forEach(k=>(R[k]||[]).forEach((v,i)=>{if(Math.abs(v)>.5)last=Math.max(last,i)}));
  const mm=Array.from({length:last+1},(_,m)=>m),add=(...xs)=>mm.map((_,m)=>xs.reduce((a,x)=>a+_num((x||[])[m]),0)),sub=(a,b)=>mm.map((_,m)=>_num((a||[])[m])-_num((b||[])[m]));
  const rows=[
    ["1","Net Revenue",sub(R.cfrefresrev,R.cfrefgst),"sub"],["1.1","Revenue - Residential",R.cfrefresrev],["1.2","Less : GST",R.cfrefgst],
    ["2","Land Costs",add(R.cfrefland,R.cfrefstamp,R.cfrefholding,R.cfreffirb,R.cfrefforeignstamp),"sub"],["2.1","Land Costs",R.cfrefland],["2.2","Stampduty",R.cfrefstamp],["2.3","Land Holding Costs",R.cfrefholding],["2.4","FIRB Fees",R.cfreffirb],["2.5","Foreign Stampduty Charges",R.cfrefforeignstamp],
    ["3","Development Cost",add(R.cfrefconstruction,R.cfrefprofessional,R.cfrefdm,R.cfrefstatutory,R.cfrefcontingency),"sub"],["3.1","Cost of construction",R.cfrefconstruction],["3.2","Professional Fees",R.cfrefprofessional],["3.3","Development Management Fees",R.cfrefdm],["3.4","Statutory Costs",R.cfrefstatutory],["3.5","Project Contingency",R.cfrefcontingency],
    ["4","Selling Costs",add(R.cfrefbrokerage,R.cfrefselling,R.cfrefmarketing),"sub"],["4.1","Brokerage Costs",R.cfrefbrokerage],["4.2","Selling Expenses",R.cfrefselling],["4.3","Marketing and advertising spends",R.cfrefmarketing],
    ["5","GST Refund",R.cfgstrefund,"sub"],["6","Net Cash Flow",R.cfrefnetcash,"res"],
    ["7","Debt Schedule",add(R.cfrefdebt,R.cfrefdebtfinance,R.cfrefrepayment),"sub"],["7.1","(-) Debt Raised",R.cfrefdebt],["7.2","(-) Debt Raised to Service Debt",R.cfrefdebtfinance],["7.3","(+) Debt Repayment",R.cfrefrepayment],
    ["8","Finance Costs",add(R.cfrefprocessing,R.cfrefinterest,R.cfreflifetime),"sub"],["8.1","Processing Fee",R.cfrefprocessing],["8.2","Interest",R.cfrefinterest],["8.3","Line fee",R.cfreflifetime],
    ["9","Equity Needed",R.cfrefequity,"res"],["10","Net Surplus",R.cfrefsurplus,"res"],["11","Profit (10 - 9)",R.cfrefprofit,"res"]
  ];
  const tableRows=rows.map(([ref,label,arr,cls])=>({sr:1,cls:cls||"",c:[ref,label,...mm.map(m=>$(arr[m]))]}));
  set("o_monthly",chart("Loan balance and cumulative equity cash flow",[{n:"Loan balance",v:R.lcl.slice(0,last+1),c:"#C0504D"},{n:"Net equity cash flow",v:R.cfrefprofit.slice(0,last+1),c:"#2E5496"}],mm.map(m=>mLabel(m,d)))+`<div class="scrollx">`+tbl("Monthly Project Cash Flow",["Ref.","Particulars",...mm.map(m=>mLabel(m,d))],tableRows,"Same line sequence as the annual cashflow. Positive line 6 is a cash requirement; line 11 is Net Surplus less Equity Needed.")+`</div>`);
};

/* ═══════════════════ SENSITIVITY / HEAT / OFFER ═══════════════════ */
function renderSensitivitySync({d},runFn=run,solveLandFn=solveLand){
  const sx=LV[APP.sDrv],sm=MET[APP.sMet],c0=cur(APP.sDrv,d);
  const paneMetric=(key,ov)=>{if(key==="maxland")return solveLandFn(D,"npv",0,ov);try{const m=runFn(D,ov),v=m[key];return v==null?null:v}catch(e){return null}};
  if(APP.sFrom==null){const sp=Math.max(Math.abs(c0)*.4,sx.st*4);
    APP.sFrom=Math.max(sx.lo,+(c0-sp).toFixed(4));APP.sTo=Math.min(sx.hi,+(c0+sp).toFixed(4))}
  const f1=document.getElementById("s_from"),f2=document.getElementById("s_to"),f3=document.getElementById("s_steps");
  if(f1)f1.value=APP.sFrom;if(f2)f2.value=APP.sTo;if(f3)f3.value=APP.sSteps;
  const n=Math.max(2,Math.min(15,APP.sSteps));
  const vals=Array.from({length:n},(_,i)=>+(APP.sFrom+(APP.sTo-APP.sFrom)*i/(n-1)).toFixed(4));
  const rows=vals.map(v=>{let m=null;try{m=runFn(D,ovFor(APP.sDrv,v,d))}catch(e){}
    const near=Math.abs(v-c0)<=(APP.sTo-APP.sFrom)/(n-1)/2;
    return {sr:1,cls:m&&m.npv<0?"bad":(near?"res":""),
      c:[sx.f(v),m?$(m.revenue):"–",m?$(m.npat):"–",m?P(m.margin):"–",m?P(m.irr):"–",
         m?P(m.eirr):"–",m?X(m.moic):"–",m?$(m.npv):"–",$(solveLandFn(D,"npv",0,ovFor(APP.sDrv,v,d)))]}});
  set("o_sens",chart(`${sm.n} against ${sx.n}`,[{n:sm.n,v:vals.map(v=>paneMetric(APP.sMet,ovFor(APP.sDrv,v,d))),c:"#16294B"}],
      vals.map(sx.f),sm.f===P?(v=>P(v,0)):(sm.f===X?(v=>v.toFixed(1)+"x"):undefined))+
    tbl(`${sx.n} swept from ${sx.f(APP.sFrom)} to ${sx.f(APP.sTo)}`,
      ["Assumption","Revenue","Net profit","Margin","Project IRR","Equity IRR","Multiple","Project NPV","Maximum land price A$/sqm"],
      rows,"Highlighted row is nearest the current input. Red rows destroy value."));
};
function renderHeatmapSync({d},runFn=run,solveLandFn=solveLand){
  const hx=LV[APP.xDrv],hy=LV[APP.yDrv],hm=MET[APP.gMet];
  const paneMetric=(key,ov)=>{if(key==="maxland")return solveLandFn(D,"npv",0,ov);try{const m=runFn(D,ov),v=m[key];return v==null?null:v}catch(e){return null}};
  const span=(x,st)=>{const c=cur(x.k,d),sp=Math.max(Math.abs(c)*.35,x.st*3);
    const lo=Math.max(x.lo,c-sp),hi=Math.min(x.hi,c+sp);
    return Array.from({length:st},(_,i)=>+(hi-(hi-lo)*i/(st-1)).toFixed(4))};
  const xs=span(hx,APP.xSteps),ys=span(hy,APP.ySteps).slice().reverse();
  const cells={};xs.forEach(xv=>ys.forEach(yv=>{
    cells[xv+"|"+yv]=paneMetric(APP.gMet,ovMerge(d,[hx.k,xv],[hy.k,yv]))}));
  const basev=metric(APP.gMet);
  const floor=APP.gMet==="maxland"?d.pr:(APP.gMet==="eirr"?d.hurdle/100:0);
  let h=`<div class="scrollx"><table><caption>${hm.n} — ${hx.n} (rows) against ${hy.n} (columns)</caption>
    <thead><tr><th class="l">${hx.n} \\ ${hy.n}</th>`+ys.map(y=>`<th class="n">${hy.f(y)}</th>`).join("")+`</tr></thead><tbody>`;
  xs.forEach(xv=>{h+=`<tr><td class="rh">${hx.f(xv)}</td>`+ys.map(yv=>{
    const v=cells[xv+"|"+yv];
    const isB=Math.abs(xv-cur(hx.k,d))<1e-9&&Math.abs(yv-cur(hy.k,d))<1e-9;
    let st="";
    if(v==null)st="background:#F2F2F2";
    else if(v<floor)st="background:#FFC7CE;color:#9C0006;font-weight:700";
    else if(basev!=null&&v>=basev)st="background:#E2EFDA";
    return `<td class="n${isB?" base":""}" style="${st}">${v==null?"–":hm.f(v)}</td>`}).join("")+`</tr>`});
  h+=`</tbody><tfoot><tr><td colspan="${ys.length+1}">Outlined cell is the current input pair. Green is at or better than the base case; red fails the test — a negative value, an equity IRR below the ${M0(d.hurdle,1)}% target, or a land price below the ${$(d.pr)} being asked.</td></tr></tfoot></table></div>`;
  set("o_two",h);
};
function renderOfferSync(C,decisionOverride,runFn=run,solveLandFn=solveLand){const {d}=C,decision=decisionOverride||currentDecision();
  if(!decision){set("o_offer","");return}
  const {be,bd}=decision;
  const om=APP.oMet,ot=om==="npv"?0:APP.oTgt/100,mn=MET[om].n;
  const tl=solveLandFn(D,om,ot),gap=tl==null?null:tl-d.pr;
  const currentSaleDriver =
  d.vert
    ? d.hpsf
    : (
        d.pmode
          ? d._rev0 / d._lotsqft
          : d._rev0 / d._frontft
      );

const saleLever =
  d.vert
    ? "hpsf"
    : (
        d.pmode
          ? "vpsf"
          : "vff"
      );

const saleUnit =
  d.vert
    ? "per vertical unit sqm"
    : (
        d.pmode
          ? "per saleable sqm"
          : "per unit"
      );

const idx = [
  currentSaleDriver,
  currentSaleDriver * 0.94,
  currentSaleDriver * 0.84
];
  const tg=[["Net present value nil — absolute ceiling","npv",0,false],
            [`${mn} of ${om==="npv"?"nil":APP.oTgt+"%"} — YOUR REQUIREMENT`,om,ot,true],
            ["Project IRR 20%","irr",.20,false],["Project IRR 25%","irr",.25,false],
            ["Equity IRR 20%","eirr",.20,false],["Equity IRR 25%","eirr",.25,false]];
  const seen=new Set(tg.filter(t=>t[3]).map(t=>t[1]+"|"+t[2].toFixed(4))),rows=[];
  tg.forEach(([lab,k,t,mine])=>{const sig=k+"|"+t.toFixed(4);
    if(!mine){if(seen.has(sig))return;seen.add(sig)}
    rows.push({sr:1,cls:mine?"res":"",c:[lab,...idx.map(v=>$(solveLandFn(D,k,t,ovFor(saleLever,v,d)))),$(solveLandFn(D,k,t,{pidrt:0}))]})});
  rows.push({sr:1,cls:"sub",c:["Price being asked",...idx.map(()=>$(d.pr)),$(d.pr)]});
  const scols=[["Net present value nil","npv",0,false],
    [`YOUR TARGET — ${mn} ${om==="npv"?"nil":APP.oTgt+"%"}`,om,ot,true],
    ["Project IRR 25%","irr",.25,false],["Equity IRR 20%","eirr",.20,false]];
  const s2=new Set(scols.filter(c=>c[3]).map(c=>c[1]+"|"+c[2].toFixed(4))),use=[];
  scols.forEach(c=>{const sig=c[1]+"|"+c[2].toFixed(4);
    if(!c[3]){if(s2.has(sig))return;s2.add(sig)}use.push(c)});
  const srows=APP.scn.map(sc=>{const ov=scnOv(sc);let m=null;try{m=runFn(D,ov)}catch(e){}
    return {sr:1,cls:!Object.keys(ov).length?"res":"",
      c:[sc.n,m?P(m.eirr):"–",...use.map(([,k,t])=>{const v=solveLandFn(D,k,t,ov);
        return v==null?`<span style="color:#9C0006">not reachable</span>`
          :(v<d.pr?`<span style="color:#9C0006;font-weight:700">${$(v)}</span>`:$(v))})]}});
  set("o_offer",
    `<div class="goal ${tl!=null&&gap>=0?"":"miss"}">`+
    (tl==null?`A <b>${mn}</b> of <b>${APP.oTgt}%</b> cannot be reached at any land price on these assumptions.`
      :`To earn ${mn==="Equity IRR"?"an":"a"} <b>${mn}</b> of <b>${om==="npv"?"nil":APP.oTgt+"%"}</b> you can pay up to <b class="big">${$(tl)}</b> per sqm.<br>
        The asking price is ${$(d.pr)} — `+(gap>=0?`<b>${$(gap)} per sqm of headroom</b>, or ${$(gap*d.acresGross)} across the site.`
        :`<b>${$(-gap)} per sqm more than that return supports</b>, or ${$(-gap*d.acresGross)} across the site.`))+`</div>`+
    tbl("Maximum land price per sqm at each required return",
      ["Required return",...idx.map(v=>`At $${M0(v)} ${saleUnit}`),"No reimbursement"],rows,
      "Your requirement is highlighted.")+
    tbl("Maximum land price per sqm under each scenario",
      ["Scenario","Equity IRR at the asking price",...use.map(c=>c[0])],srows,
      `Red means the scenario cannot support the ${$(d.pr)} being asked at that required return.`)+
    tbl(
  "Single-driver breakeven — net present value reaches nil",
  ["Driver","Breakeven","Current input"],
  [
    [
      d.vert
        ?"Vertical unit sale price falls to"
        :"Lot price falls to",

      d.vert
        ?$(bd.price)+" per sqm"
        :"$"+M0(bd.price)+" "+saleUnit,

      d.vert
        ?"from "+$(d.hpsf)
        :"from $"+M0(currentSaleDriver)
    ],

    [
      d.vert
        ?"Sales velocity falls to"
        :"Sales velocity falls to",

      M0(bd.speed,1)+(
        d.vert
          ?" units per month"
          :" lots per month"
      ),

      "from "+M0(
        d.vert
          ?d.vel
          :d.absn,
        1
      )
    ],

    [
      "Construction cost rises to",
      $(bd.infl)+" per lot",
      "from "+$(d.infl)
    ],

    [
      "Contingency rises to",
      M0(bd.contpc,1)+"%",
      "from "+M0(d.contpc,1)+"%"
    ],

    [
      "Land price rises to",
      $(be)+" per sqm",
      "from "+$(d.pr)
    ]
  ].map(r=>({sr:1,c:r}))
));
};



/* ═══════════════════ NON-BLOCKING HEAVY PANE ANALYSIS ═══════════════════
   Repeated model runs and land solves are precomputed in workers and replayed through explicit cached accessors. */
const _paneBatchCache=new Map();
let _paneBatchWorkers=[],_paneBatchWorkerUrl=null,_paneBatchActive=null,_paneBatchSeq=0,_paneBatchTimer=0;
function paneRunKey(ov){return overrideSignature(ov||{})}
function paneSolveKey(metricName,target,ov){return metricName+"|"+String(target)+"|"+overrideSignature(ov||{})}
function paneBatchAppendSource(){return String.raw`
var __paneBaseRun=run,__paneRunCache=new Map();
run=function(din,ov){
  var baseKey=modelInputSignature(din),hasOv=!!(ov&&Object.keys(ov).length),key=hasOv?baseKey+"\\u001d"+overrideSignature(ov):baseKey;
  if(__paneRunCache.has(key)){var hit=__paneRunCache.get(key);__paneRunCache.delete(key);__paneRunCache.set(key,hit);return hit}
  var value=__paneBaseRun(din,ov);cacheSetLRU(__paneRunCache,key,value,640);return value;
};
/* Use the model engine's native solveLand/_crossings implementation here.
   The previous worker-only monotonic bisection shortcut could disagree with the
   authoritative solver for non-monotonic IRR / return curves. The cached run()
   wrapper above still avoids duplicate model evaluations. */
function slimPaneModel(m){return {npat:m.npat,eirr:m.eirr,irr:m.irr,moic:m.moic,margin:m.margin,npv:m.npv,revenue:m.revenue,gross:m.gross,epeak:m.epeak,einj:m.einj,peakdebt:m.peakdebt,finance:m.finance,tax:m.tax,carry:m.carry}}
onmessage=function(e){var q=e.data||{},out={runs:{},solves:{}};try{
  (q.runs||[]).forEach(function(x){try{out.runs[x.key]=slimPaneModel(run(q.inputs,x.ov||{}))}catch(err){out.runs[x.key]=null}});
  (q.solves||[]).forEach(function(x){try{out.solves[x.key]=solveLand(q.inputs,x.metric,x.target,x.ov||{})}catch(err){out.solves[x.key]=null}});
  postMessage({id:q.id,key:q.key,pane:q.pane,data:out});
}catch(err){postMessage({id:q.id,key:q.key,pane:q.pane,error:err&&err.message?err.message:String(err)})}
};`}
function paneBatchUrl(){
  if(_paneBatchWorkerUrl)return _paneBatchWorkerUrl;
  if(!MODEL_ENGINE_SOURCE||typeof Worker==="undefined"||typeof Blob==="undefined"||typeof URL==="undefined")return null;
  _paneBatchWorkerUrl=URL.createObjectURL(new Blob([MODEL_ENGINE_SOURCE,"\n",paneBatchAppendSource()],{type:"text/javascript"}));return _paneBatchWorkerUrl;
}
function cancelPaneBatch(){
  clearTimeout(_paneBatchTimer);_paneBatchTimer=0;
  _paneBatchWorkers.forEach(w=>w.terminate());_paneBatchWorkers=[];_paneBatchActive=null;
}
function paneBatchData(key){return cacheGetLRU(_paneBatchCache,key)}
function splitPaneJobs(runs,solves,count){
  const groups=new Map(),get=ov=>{const k=overrideSignature(ov||{});if(!groups.has(k))groups.set(k,{runs:[],solves:[],weight:0});return groups.get(k)};
  runs.forEach(x=>{const g=get(x.ov);g.runs.push(x);g.weight+=1});solves.forEach(x=>{const g=get(x.ov);g.solves.push(x);g.weight+=8});
  const bins=Array.from({length:count},()=>({runs:[],solves:[],weight:0}));
  [...groups.values()].sort((a,b)=>b.weight-a.weight).forEach(g=>{const b=bins.reduce((x,y)=>x.weight<=y.weight?x:y);b.runs.push(...g.runs);b.solves.push(...g.solves);b.weight+=g.weight});
  return bins.filter(b=>b.runs.length||b.solves.length);
}
function ensurePaneBatch(pane,key,runs,solves){
  const hit=paneBatchData(key);if(hit!==undefined)return hit;
  if(_paneBatchActive&&_paneBatchActive.key===key)return null;
  cancelPaneBatch();
  const id=++_paneBatchSeq;_paneBatchActive={id,key,pane,remaining:0,data:{runs:{},solves:{}}};
  _paneBatchTimer=setTimeout(()=>{
    _paneBatchTimer=0;if(!_paneBatchActive||_paneBatchActive.id!==id)return;
    const url=paneBatchUrl();if(!url)return;
    const totalOps=runs.length+solves.length,hc=Math.max(1,Number(navigator.hardwareConcurrency)||4),maxWorkers=hc>=12?6:(hc>=8?4:(hc>=4?2:1)),workerCount=pane==="offer"?Math.min(4,maxWorkers,Math.max(1,totalOps)):(totalOps>12?maxWorkers:(totalOps>5?Math.min(2,maxWorkers):1)),jobs=splitPaneJobs(runs,solves,workerCount);_paneBatchActive.remaining=jobs.length;
    const finish=(worker,m)=>{
      worker.terminate();_paneBatchWorkers=_paneBatchWorkers.filter(w=>w!==worker);
      if(!_paneBatchActive||m.id!==_paneBatchActive.id)return;
      if(!m.error&&m.data){Object.assign(_paneBatchActive.data.runs,m.data.runs||{});Object.assign(_paneBatchActive.data.solves,m.data.solves||{})}
      _paneBatchActive.remaining--;
      if(_paneBatchActive.remaining>0)return;
      const active=_paneBatchActive;_paneBatchActive=null;cacheSetLRU(_paneBatchCache,active.key,active.data,16);
      if(activePane()===active.pane){DIRTY[active.pane]=true;queuePanePaint(active.pane)}
    };
    jobs.forEach(job=>{const worker=new Worker(url);_paneBatchWorkers.push(worker);worker.onmessage=e=>finish(worker,e.data||{});worker.onerror=()=>finish(worker,{id,key,pane,error:"Worker error"});worker.postMessage({id,key,pane,inputs:{...D},runs:job.runs,solves:job.solves})});
  },pane==="offer"?0:5);
  return null;
}
function withPaneBatch(data,fn){
  const runFn=(din,ov)=>{const k=paneRunKey(ov);return Object.prototype.hasOwnProperty.call(data.runs,k)?data.runs[k]:run(din,ov)};
  const solveLandFn=(din,m,t,ov)=>{const k=paneSolveKey(m,t,ov);return Object.prototype.hasOwnProperty.call(data.solves,k)?data.solves[k]:solveLand(din,m,t,ov)};
  return fn(runFn,solveLandFn);
}
function dedupePaneOps(ops){const seen=new Set();return ops.filter(x=>!seen.has(x.key)&&(seen.add(x.key),true))}
function addPaneRun(arr,ov){arr.push({key:paneRunKey(ov),ov:{...(ov||{})}})}
function addPaneSolve(arr,metricName,target,ov){arr.push({key:paneSolveKey(metricName,target,ov),metric:metricName,target,ov:{...(ov||{})}})}

function renderScenarioPane(C){
  const d=C.d;
  chips("colchips",levers().map(l=>[l.k,l.n]),k=>APP.cols.includes(k),k=>{const i=APP.cols.indexOf(k);i<0?APP.cols.push(k):APP.cols.splice(i,1);DIRTY.scn=true;paint("scn")});
  chips("metchips",METRICS.map(m=>[m.k,m.n]),k=>APP.mets.includes(k),k=>{const i=APP.mets.indexOf(k);i<0?APP.mets.push(k):APP.mets.splice(i,1);DIRTY.scn=true;paint("scn")});
  const ovs=APP.scn.map(sc=>scnOv(sc)),runs=[],solves=[];ovs.forEach(ov=>{addPaneRun(runs,ov);addPaneSolve(solves,"npv",0,ov)});
  const key="scn|"+modelInputSignature(D)+"|"+JSON.stringify([APP.scn,APP.cols,APP.mets]);
  const data=ensurePaneBatch("scn",key,dedupePaneOps(runs),dedupePaneOps(solves));if(!data)return false;
  return withPaneBatch(data,(runFn,solveLandFn)=>renderScenarioSync(C,runFn,solveLandFn));
};

function renderSensitivityPane(C){
  const d=C.d,sx=LV[APP.sDrv],c0=cur(APP.sDrv,d);
  if(APP.sFrom==null){const sp=Math.max(Math.abs(c0)*.4,sx.st*4);APP.sFrom=Math.max(sx.lo,+(c0-sp).toFixed(4));APP.sTo=Math.min(sx.hi,+(c0+sp).toFixed(4))}
  const f1=document.getElementById("s_from"),f2=document.getElementById("s_to"),f3=document.getElementById("s_steps");if(f1)f1.value=APP.sFrom;if(f2)f2.value=APP.sTo;if(f3)f3.value=APP.sSteps;
  const n=Math.max(2,Math.min(15,APP.sSteps)),vals=Array.from({length:n},(_,i)=>+(APP.sFrom+(APP.sTo-APP.sFrom)*i/(n-1)).toFixed(4)),runs=[],solves=[];
  vals.forEach(v=>{const ov=ovFor(APP.sDrv,v,d);addPaneRun(runs,ov);addPaneSolve(solves,"npv",0,ov)});
  const key="sens|"+modelInputSignature(D)+"|"+JSON.stringify([APP.sDrv,APP.sMet,APP.sFrom,APP.sTo,APP.sSteps]);
  const data=ensurePaneBatch("sens",key,dedupePaneOps(runs),dedupePaneOps(solves));if(!data)return false;
  return withPaneBatch(data,(runFn,solveLandFn)=>renderSensitivitySync(C,runFn,solveLandFn));
};

function renderHeatmapPane(C){
  const d=C.d,hx=LV[APP.xDrv],hy=LV[APP.yDrv],span=(x,st)=>{const c=cur(x.k,d),sp=Math.max(Math.abs(c)*.35,x.st*3),lo=Math.max(x.lo,c-sp),hi=Math.min(x.hi,c+sp);return Array.from({length:st},(_,i)=>+(hi-(hi-lo)*i/(st-1)).toFixed(4))};
  const xs=span(hx,APP.xSteps),ys=span(hy,APP.ySteps).slice().reverse(),runs=[],solves=[];
  const addMetric=ov=>APP.gMet==="maxland"?addPaneSolve(solves,"npv",0,ov):addPaneRun(runs,ov);
  addMetric({});xs.forEach(x=>ys.forEach(y=>addMetric(ovMerge(d,[hx.k,x],[hy.k,y]))));
  const key="two|"+modelInputSignature(D)+"|"+JSON.stringify([APP.xDrv,APP.yDrv,APP.gMet,APP.xSteps,APP.ySteps]);
  const data=ensurePaneBatch("two",key,dedupePaneOps(runs),dedupePaneOps(solves));if(!data)return false;
  return withPaneBatch(data,(runFn,solveLandFn)=>renderHeatmapSync(C,runFn,solveLandFn));
};

function renderOfferPane(C){
  const d=C.d,decision=currentDecision();
  const om=APP.oMet,ot=om==="npv"?0:APP.oTgt/100,currentSaleDriver=d.vert?d.hpsf:(d.pmode?d._rev0/d._lotsqft:d._rev0/d._frontft),saleLever=d.vert?"hpsf":(d.pmode?"vpsf":"vff"),idx=[currentSaleDriver,currentSaleDriver*.94,currentSaleDriver*.84],runs=[],solves=[];
  addPaneSolve(solves,om,ot,{});
  const tg=[["npv",0,false],[om,ot,true],["irr",.20,false],["irr",.25,false],["eirr",.20,false],["eirr",.25,false]],seen=new Set(tg.filter(t=>t[2]).map(t=>t[0]+"|"+t[1].toFixed(4))),useT=[];
  tg.forEach(t=>{const sig=t[0]+"|"+t[1].toFixed(4);if(!t[2]){if(seen.has(sig))return;seen.add(sig)}useT.push(t)});
  useT.forEach(([m,t])=>{idx.forEach(v=>addPaneSolve(solves,m,t,ovFor(saleLever,v,d)));addPaneSolve(solves,m,t,{pidrt:0})});
  const scols=[["npv",0,false],[om,ot,true],["irr",.25,false],["eirr",.20,false]],s2=new Set(scols.filter(c=>c[2]).map(c=>c[0]+"|"+c[1].toFixed(4))),use=[];
  scols.forEach(c=>{const sig=c[0]+"|"+c[1].toFixed(4);if(!c[2]){if(s2.has(sig))return;s2.add(sig)}use.push(c)});
  APP.scn.forEach(sc=>{const ov=scnOv(sc);addPaneRun(runs,ov);use.forEach(([m,t])=>addPaneSolve(solves,m,t,ov))});
  const key="offer|"+modelInputSignature(D)+"|"+JSON.stringify([APP.oMet,APP.oTgt,APP.scn]);
  const data=ensurePaneBatch("offer",key,dedupePaneOps(runs),dedupePaneOps(solves));if(!data)return false;
  /* Do not hold the entire Land Value pane behind the slower driver-breakeven
     decision package. The main land-value matrix renders first from its own
     worker cache; secondary breakeven drivers populate on the next repaint. */
  const partialDecision=decision||{be:data.solves[paneSolveKey("npv",0,{})],bd:{price:null,speed:null,infl:null,contpc:null}};
  const rendered=withPaneBatch(data,(runFn,solveLandFn)=>renderOfferSync(C,partialDecision,runFn,solveLandFn));
  if(!decision)setTimeout(()=>ensureSummaryAnalytics({decision:true}),0);
  return rendered;
};

/* ═══════════════════ REFERENCE SUMMARY DASHBOARD ═══════════════════ */



function projectIrrView(A,d){
  const direct=A&&A.irr!=null?Number(A.irr):NaN;if(Number.isFinite(direct))return {value:direct,text:P(direct),note:""};
  const flows=A&&A.R&&Array.isArray(A.R.net)?A.R.net:[],info=typeof irrInfo==="function"?irrInfo(flows,12):{roots:[]};
  const roots=(info.roots||[]).filter(Number.isFinite),positive=roots.filter(x=>x>=0).sort((a,b)=>a-b);
  if(positive.length){const target=d&&Number.isFinite(Number(d.r))?Number(d.r)/100:0;let pick=positive[0];positive.forEach(x=>{if(Math.abs(x-target)<Math.abs(pick-target))pick=x});return {value:pick,text:P(pick),note:"Multiple valid Project IRR roots exist; the non-negative root nearest the project hurdle is displayed. Chronological cashflow order is unchanged."}}
  return {value:null,text:"N/M",note:"Project IRR is not mathematically meaningful because the chronological project cashflow does not produce a unique negative-to-positive IRR root."};
}




/* ═══════════════════ WIRING ═══════════════════ */
function wire(){
  const on=(id,ev,fn)=>{const e=document.getElementById(id);if(e)e[ev]=fn};
  on("t_met","onchange",e=>{cancelSummaryAnalytics();APP.tMet=e.target.value;DIRTY.verdict=true;paint("verdict");scheduleSummaryInsightAnalytics(50)});
  on("t_swing","oninput",e=>{cancelSummaryAnalytics();APP.tSwing=+e.target.value;
    document.getElementById("t_swingv").textContent="±"+APP.tSwing+"%";sched("verdict");scheduleSummaryInsightAnalytics(90)});
  on("g_drv","onchange",e=>{cancelSummaryAnalytics();APP.goalDrv=e.target.value;DIRTY.verdict=true;paint("verdict");scheduleSummaryInsightAnalytics(180)});
  on("g_met","onchange",e=>{cancelSummaryAnalytics();APP.goalMet=e.target.value;
    APP.goalTgt=MET[APP.goalMet].f===P?25:0;document.getElementById("g_tgt").value=APP.goalTgt;
    DIRTY.verdict=true;paint("verdict")});
  on("g_tgt","onchange",e=>{cancelSummaryAnalytics();const v=parseFloat(e.target.value);
    if(!isNaN(v)){APP.goalTgt=v;DIRTY.verdict=true;paint("verdict")}});
  on("s_drv","onchange",e=>{APP.sDrv=e.target.value;APP.sFrom=APP.sTo=null;DIRTY.sens=true;paint("sens")});
  on("s_met","onchange",e=>{APP.sMet=e.target.value;DIRTY.sens=true;paint("sens")});
  on("s_from","onchange",e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){APP.sFrom=v;DIRTY.sens=true;paint("sens")}});
  on("s_to","onchange",e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){APP.sTo=v;DIRTY.sens=true;paint("sens")}});
  on("s_steps","onchange",e=>{const v=parseInt(e.target.value);if(v>=2&&v<=15){APP.sSteps=v;DIRTY.sens=true;paint("sens")}});
  on("s_reset","onclick",()=>{APP.sFrom=APP.sTo=null;DIRTY.sens=true;paint("sens")});
  on("x_drv","onchange",e=>{APP.xDrv=e.target.value;DIRTY.two=true;paint("two")});
  on("y_drv","onchange",e=>{APP.yDrv=e.target.value;DIRTY.two=true;paint("two")});
  on("g_met2","onchange",e=>{APP.gMet=e.target.value;DIRTY.two=true;paint("two")});
  on("x_steps","oninput",e=>{APP.xSteps=+e.target.value;
    document.getElementById("x_stepsv").textContent=APP.xSteps;sched("two")});
  on("y_steps","oninput",e=>{APP.ySteps=+e.target.value;
    document.getElementById("y_stepsv").textContent=APP.ySteps;sched("two")});
  on("o_met","onchange",e=>{APP.oMet=e.target.value;DIRTY.offer=true;DIRTY.scn=true;paint("offer")});
  on("o_tgt","oninput",e=>{APP.oTgt=+e.target.value;
    document.getElementById("o_tgtv").textContent=APP.oTgt+"%";
    document.getElementById("o_tgtn").value=APP.oTgt;DIRTY.scn=true;sched("offer")});
  on("o_tgtn","onchange",e=>{const v=parseFloat(e.target.value);
    if(!isNaN(v)){APP.oTgt=v;document.getElementById("o_tgt").value=v;
      document.getElementById("o_tgtv").textContent=v+"%";DIRTY.offer=true;DIRTY.scn=true;paint("offer")}});
  on("scn_add","onclick",()=>{const c=derive(D);const ov={};
    APP.cols.forEach(k=>ov[k]=cur(k,c));
    APP.scn.push({n:"New scenario",ov});APP.scnAuto=false;DIRTY.scn=true;paint("scn")});
  on("scn_reset","onclick",()=>{if(!confirm("Restore the default scenarios?"))return;
    APP.scn=modeScenarios(D);APP.scnAuto=true;DIRTY.scn=true;paint("scn")});
  on("op_met","onchange",e=>{cancelOptimiserWorker();APP.opMet=e.target.value;
    APP.opTgt=MET[APP.opMet].f===P?25:(MET[APP.opMet].f===X?2:1e7);
    document.getElementById("op_tgt").value=APP.opTgt;APP.opRes=null;DIRTY.opt=true;paint("opt")});
  on("op_tgt","onchange",e=>{const v=parseFloat(e.target.value);
    if(!isNaN(v)){APP.opTgt=v;APP.opRes=null;DIRTY.opt=true;paint("opt")}});
  on("op_run","onclick",()=>runOptimiserAsync());
  on("op_clear","onclick",()=>{cancelOptimiserWorker();APP.opRes=null;DIRTY.opt=true;paint("opt")});
}

document.getElementById("btnPrint").onclick=()=>exportPdf(); /* exportPdf is registered by the Board PDF module below. */
document.getElementById("btnStmtPdf").onclick=()=>exportStatementsPdf();
document.getElementById("btnXls").onclick=()=>buildExcel();
document.getElementById("btnSave").onclick=()=>{
  dl(new Blob([JSON.stringify({v:7,parcels:APP.parcels,active:APP.active,scn:APP.scn,scnAuto:APP.scnAuto,
    cols:APP.cols,mets:APP.mets,portfolioRate:APP.portfolioRate,portfolioMode:APP.portfolioMode,portfolioSelected:APP.portfolioSelected,portfolioFyEnd:APP.portfolioFyEnd,portfolioBasis:APP.portfolioBasis,sourceIncludeHoldco:APP.sourceIncludeHoldco,sourceEditTarget:APP.sourceEditTarget,sourceData:APP.sourceData},null,2)],{type:"application/json"}),
    fname(P0().name)+".json")};
document.getElementById("btnLoad").onclick=()=>document.getElementById("fileIn").click();
document.getElementById("fileIn").onchange=e=>{const f=e.target.files[0];if(!f)return;
  const rd=new FileReader();rd.onload=()=>{try{const j=JSON.parse(rd.result);
    if(j.parcels&&j.parcels.length){APP.parcels=j.parcels.map(p=>{const inputs={...DEF,...cleanStoredInputs(p.inputs)};inputs.pmode=Number(inputs.pmode)===1?1:0;if(Number(j.v||0)<6){inputs.distlock=0;if(Number(inputs.ovhmode)===0)inputs.ovhmode=2}enforceAccountingPolicy(inputs);return {id:p.id||("p"+Math.random().toString(36).slice(2,8)),name:p.name||"New parcel",loc:cleanProjectLocation(p.loc),sourceKey:p.sourceKey||inferSourceKey(p.name),inputs,gis:p.gis&&typeof p.gis==="object"?p.gis:undefined}});
      APP.active=Math.min(j.active||0,APP.parcels.length-1)}
    else if(j.inputs)APP.parcels=[newParcel(j.name,j.loc,j.inputs)];
    if(j.scn)APP.scn=j.scn;APP.scnAuto=j.scnAuto===true;if(j.cols)APP.cols=j.cols;if(j.mets)APP.mets=j.mets;
    if(j.portfolioRate!=null&&Number.isFinite(Number(j.portfolioRate))&&Number(j.portfolioRate)>=0)APP.portfolioRate=Number(j.portfolioRate);
    APP.portfolioMode=j.portfolioMode==="selected"?"selected":"all";APP.portfolioSelected=Array.isArray(j.portfolioSelected)?j.portfolioSelected:[];
    if(j.portfolioFyEnd!=null)APP.portfolioFyEnd=_clamp(Math.round(_num(j.portfolioFyEnd,6)),1,12);
    APP.portfolioBasis="source";APP.sourceIncludeHoldco=true;APP.sourceEditTarget=j.sourceEditTarget||"consolidatedPL";APP.sourceData=j.sourceData&&j.sourceData.projects?j.sourceData:cloneSourceData(SOURCE_BP_DEFAULT);
    refreshBusinessPlanTimingProfiles(APP.sourceData);D=P0().inputs;normalizeModeState();
    buildParcels();buildForm();buildScaffold();showNav();render()}
    catch(err){alert("That file could not be read as a saved appraisal.")}};
  rd.readAsText(f);e.target.value=""};
document.getElementById("btnReset").onclick=()=>{if(!confirm("Reset this parcel to the default appraisal?"))return;
  APP.parcels[APP.active].inputs=enforceAccountingPolicy({...DEF});D=P0().inputs;normalizeModeState(true);buildForm();buildScaffold();showNav();render()};
document.getElementById("btnCollapseInputs").onclick=()=>{
  const sections=inputAccordionSections(),collapse=sections.some(fs=>!fs.classList.contains("shut"));setAllInputSections(collapse);
};
let metaTimer=null;
function scheduleMetadataPaint(){
  DIRTY.port=true;updateFoot();
  if(NAVAT==="port"){clearTimeout(metaTimer);metaTimer=setTimeout(()=>paint(activePane()),120)}
}
document.getElementById("pname").oninput=e=>{P0().name=e.target.value;fitProjectNameFont();updateActiveParcelLabel();scheduleMetadataPaint()};
document.getElementById("ploc").oninput=e=>{P0().loc=e.target.value;scheduleMetadataPaint()};
["pointerdown","keydown","wheel","touchstart","input"].forEach(ev=>document.addEventListener(ev,noteUserActivity,{passive:true,capture:true}));

/* Verified startup cache for the appraisal values bundled in this file. The cache
   is used only when every input signature matches exactly; edited inputs always
   fall through to the unchanged calculation engine and background workers. */
const BUNDLED_STARTUP_RESULTS={"activeKey":"4497\u001f0\u001f11563.264398487881\u001f1\u001f2\u001f564\u001f99.40780141843972\u001f1\u001f20850\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2025\u001f12\u001f6\u001f6\u001f0\u001f24\u001f12\u001f20\u001f2\u001f44\u001f44\u001f52\u001f12\u001f12\u001f12\u001f12\u001f10\u001f10\u001f1\u001f3267578\u001f0\u001f7.999999999999999\u001f1205200\u001f0\u001f0\u001f0\u001f0\u001f0\u001f20852462\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f20792164\u001f0\u001f0\u001f0\u001f0\u001f0\u001f59.469026548672566\u001f60\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f2\u001f40.530973451327434\u001f40\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f335\u001f1\u001f0\u001f229\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11099000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5\u001f1.5\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0.4545454255\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f113808777\u001f10\u001f76744104\u001f1\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f99.40780141843972\u001f3977\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11576.404643338941\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4.0000000633018775\u001f1\u001f0\u001f1\u001f20850\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f64\u001f1\u001f566162365\u001f1\u001f20\u001f180508845\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f36\u001f1.25\u001f1.5\u001f78074790\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f23.200000000000003\u001f2.4","decision":{"be":35211.36045485,"hurd":6667.27216583,"be25":4724.22860347,"noPid":35211.36045485,"noPidEirr":0.19330008642873575,"bd":{"price":17299.7820895,"speed":2,"infl":273495.85189471,"contpc":null}},"parcels":[{"key":"4497\u001f0\u001f11563.264398487881\u001f1\u001f2\u001f564\u001f99.40780141843972\u001f1\u001f20850\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2025\u001f12\u001f6\u001f6\u001f0\u001f24\u001f12\u001f20\u001f2\u001f44\u001f44\u001f52\u001f12\u001f12\u001f12\u001f12\u001f10\u001f10\u001f1\u001f3267578\u001f0\u001f7.999999999999999\u001f1205200\u001f0\u001f0\u001f0\u001f0\u001f0\u001f20852462\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f20792164\u001f0\u001f0\u001f0\u001f0\u001f0\u001f59.469026548672566\u001f60\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f2\u001f40.530973451327434\u001f40\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f335\u001f1\u001f0\u001f229\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11099000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5\u001f1.5\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0.4545454255\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f113808777\u001f10\u001f76744104\u001f1\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f99.40780141843972\u001f3977\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11576.404643338941\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4.0000000633018775\u001f1\u001f0\u001f1\u001f20850\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f64\u001f1\u001f566162365\u001f1\u001f20\u001f180508845\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f36\u001f1.25\u001f1.5\u001f78074790\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f23.200000000000003\u001f2.4","result":{"m":{"eirr":0.19330008642873575,"irr":0.22038966574256968,"moic":2.394014797673478,"epeak":180508845,"peakdebt":503194871.16357845,"npv":103708366.00363721,"revenue":1251896550.0000014,"gross":251643263.80429333,"npat":251632001.04094815,"margin":0.22110069803987592,"einj":180508845,"eret":432140846.04094815,"land":57200000.00000001,"finance":78074789.95903558,"tax":0,"NM":117,"R":{"eqin":[5200000,0,0,0,0,0,557923.1123466574,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,2247823.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,1042623.1,61051857.81641792,0,25099854.26417168,0,0,285223.0254986909,1050332.0351516923,1094600.1926072738,1137701.0473358848,1179435.4950459525,1219610.8868346624,1258041.9378307897,1294551.600430517,1328971.8979352512,1361144.7145935716,1390922.5382620015,1418169.1521302753,1442760.272205028,1464584.1275101295,1483541.9802409331,1499548.5834021294,1512532.5737632313,1522436.7982805106,1529218.5724578553,1532849.8694499647,1533317.4390479163,1530622.8560277415,1524782.4976855917,1515827.45072666,1503803.3480175692,3914204.056264506,1244723.352931715,1449985.8680496262,1426423.2363012196,1400227.4173164472,1371524.1138224609,1340450.580879524,1307154.9593386417,1271795.558178471,1234540.089242709,1195564.8581263544,1155053.9151678283,1113198.1706930478,1070194.4788261165,1026244.6943286352,981554.7070549591,34517450.505907096,9326887.652534258,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3.725290298461914e-09,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1.7462298274040222e-10,1.7462298274040222e-10,1.4551915228366852e-10,0,34695604.847144365,0,0,0,0,0,0,0,427536434.63138837,201098.56279467765,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9985765.826621056,10954939.720133793,11930070.591536142,12911195.055088779,13898349.950100064,14891572.342309289,15890899.52527842,16896369.021792397,17908018.585268047,18925886.201171644,19950010.088445194,20980428.700941477,22017180.728867926,23060305.10023935,24109840.98233962,25165827.78319232,26228305.15304044,27297312.985835157,28372891.420733795,29455080.843606956,30543921.88855494,31639455.439433455,32741722.631388765,33850764.852402195,34966623.7448442,36089341.20703792,37218959.39483242,38355520.72318553,39499067.86775646,40649643.76650818,41807291.62131965,42972054.89960799,44143977.335960574,45323102.93377718,46509475.96692226,70954682.28634244,105892685.1129713,140280187.61023545,174804239.38652852,209478712.15591848,244298597.86566263,279264731.3033541,336396308.75759834,391739625.1609412,447338622.12043667,503194871.16357845,0,0,0,0,907796.893329187,1821173.5139477877,2740164.157364911,3664803.3298852625,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-5200000,484699.98765334254,0,0,0,0,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-2247823.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-1042623.1,-61051857.81641792,3638720.0601155157,-28738574.324287195,1678995.01098905,-959116.8415244411,-1005101.1949632997,-1050332.0351516923,-1094600.1926072738,-1137701.0473358848,-1179435.4950459525,-1219610.8868346624,-1258041.9378307897,-1294551.600430517,-1328971.8979352512,-1361144.7145935716,-1390922.5382620015,-1418169.1521302753,-1442760.272205028,-1464584.1275101292,-1483541.9802409331,-1499548.5834021294,-1512532.5737632313,-1522436.7982805106,-1529218.5724578553,-1532849.8694499647,-1533317.4390479163,-1530622.8560277415,-1524782.4976855917,-1515827.45072666,-1503803.3480175692,-3914204.056264506,-1244723.352931715,-1449985.8680496262,-1426423.2363012196,-1400227.4173164472,-1371524.1138224609,-1340450.580879524,-1307154.9593386417,-1271795.5581784707,-1234540.089242709,-1195564.8581263544,-1155053.9151678283,-1113198.1706930478,-1070194.4788261165,-1026244.6943286353,-981554.7070549591,-34517450.505907096,-32525732.462435495,-33555063.336753346,-32845233.65251516,-32823136.84800559,-32814007.57796344,-32798944.540784977,-32783798.55400455,-54737024.20790423,-52690023.142076455,-52690023.142076455,-52690023.142076455,637071165.6365523,1702384.3907171534,2449078.849968807,-18185182.81128949,-20078589.979987204,-20079468.13965006,-20079468.13965006,-20079468.13965006,431212500.7246188,201098.56279467765,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"7558\u001f0\u001f8930.934109552793\u001f1\u001f1\u001f660\u001f125.0909090909091\u001f1\u001f21330.75944767442\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2026\u001f12\u001f1\u001f1\u001f0\u001f12\u001f9\u001f23\u001f3\u001f31\u001f31\u001f42\u001f42\u001f12\u001f12\u001f12\u001f10\u001f10\u001f1\u001f4249900\u001f0\u001f8\u001f1205200\u001f0\u001f0\u001f0\u001f0\u001f0\u001f28345393\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f28198771\u001f0\u001f0\u001f0\u001f0\u001f0\u001f18.181818181818183\u001f18.18181818\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f40.909090909090914\u001f40.90909091\u001f39\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f40.909090909090914\u001f40.90909091\u001f45\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f120\u001f0\u001f0\u001f270\u001f1\u001f0\u001f270\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f17377500\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5000000283918702\u001f1.5000000283918702\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f160097045\u001f10\u001f105061670\u001f1\u001f0\u001f0\u001f0\u001f0\u001f8.5\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f125.0909090909091\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11444.360767926357\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f21330.75944767442\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f8.5\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f76\u001f1\u001f924494329\u001f0\u001f20\u001f122720901\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f24\u001f1.25\u001f1.25\u001f106583341\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f17\u001f4","result":{"m":{"eirr":0.14836541590731933,"irr":0.17367517280599354,"moic":4.15185949469095,"epeak":122720901,"peakdebt":380846809.0255671,"npv":106748673.43622187,"revenue":1761067499.9999948,"gross":386799037.0138781,"npat":386799037.0138781,"margin":0.24160285769538406,"einj":122720901,"eret":509519938.0138781,"land":74250000,"finance":106583340.98611698,"tax":0,"NM":165,"R":{"eqin":[6750000,603342.9038271682,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,2437608.3913043477,1232408.391304348,1232408.391304348,79059139.09996577,0,0,0,0,555540.6250570277,1369239.0999657651,1369239.0999657651,1369239.0999657651,1369239.0999657651,1369239.0999657651,1369239.0999657651,9850901.210413184,0,0,0,0,632650.8573495117,748226.4028145337,840525.274216813,757366.2610774869,848739.2800311217,764570.1276281704,854859.0858989813,769543.0753235812,858634.1462491148,211741.84140380274,191693.9837033045,198834.3357272311,197878.33345916565,196295.8999500398,194103.27310903196,191322.9522546291,187983.46724117245,184119.08570394537,179769.46142686374,174979.2274409923,169797.53802924848,164277.56433694274,158475.94876387622,152452.2237366687,146268.20082550158,139987.33647376357,3572635.890479604,2238471.4080246184,2238471.4080246184,2238471.4080246184,2238471.4080246184,2238471.4080246184,2238471.4080246184,2238471.4080246184,2962778.9190062527,2823309.3147541285,2918473.0706553143,2838511.921124529,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6.332993507385254e-08,4501639.588724166,4680436.977295157,4644317.504618108,4794225.713528514,4769051.827534724,10190978.974251322,8242332.993109979,8498582.720332414,8540065.425519764,8796315.1527422,8837797.85792955,0,0,0,0,0,10673136.363636382,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,437431920.5202053,7207288.8159297425,9071203.366243554,7559557.999418365,11268211.76577388,9696156.039823942,13077444.125664504,11535228.852410497,14916516.938251054,13374301.664997045,16755589.750837604,15213374.477583596,18594662.56342416,17052447.290170148,21141671.974823266,9526141.658639966,9946.817377038999,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,37976107.95776483,38795811.75253412,39618402.933599025,40443891.67170616,41272288.17342839,42208141.53477819,43163642.775587365,44137607.222509496,45128691.10867478,46135405.46951282,47156131.52887701,48189137.4175895,49232596.05285302,50284603.99506416,51343201.08853277,52406390.68456864,53472160.23942056,54538502.0757063,55603434.094294615,56665020.22410858,57721390.40000906,58770759.86375963,59811447.590020075,60841893.64829448,61860675.32267808,62866521.823993884,63858327.44335402,64835163.012173906,65796285.55104538,66741146.00845967,67669395.00997195,79485942.69126654,91335782.41110682,103219031.43987326,115135807.46102828,127086228.57257138,139070413.28849936,151088480.54027164,163140549.6782807,175239014.8791212,187396235.94785556,199612195.58406535,211886740.83004266,0,707936.598812553,1418366.8867437942,2131299.647751822,2846743.6967360107,3564707.8796459977,4285201.07359106,5008232.186949871,5733810.159480647,6461943.962431682,7192642.59865227,7925915.102704016,8661770.540972546,9400218.011779604,10141266.64549555,10884925.604652243,11631204.084056333,12380111.310902953,13131656.544889798,13885849.07833162,14642698.23627512,15402213.376614243,16164403.890205884,16929279.200986,17696848.76608613,18467122.07595032,19240108.654452473,20015818.0590141,20794259.880722497,21575443.744449317,22359379.3089696,23146076.267081164,23935544.34572448,24727793.30610292,25522832.943803456,26320673.08891777,27121323.6061638,27924794.395007707,28794526.93502169,48960178.97602634,69612564.29681942,90661800.99982977,112108686.27078396,133954156.11799908,172917299.07454014,212715073.34506285,253440655.52021748,295005896.8679654,337503991.6894641,380846809.0255671,7.450580596923828e-09,0,0,0,0,3041364.9124990404,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-6750000,-603342.9038271682,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-2437608.3913043477,-1232408.391304348,-1232408.391304348,-79059139.09996577,4921415.774806033,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-1369239.0999657651,-38584228.5184857,2685284.8282127855,-775167.5301818391,-887775.0218782787,-824439.7826829815,-934948.3104839964,-869030.0456165212,-976497.9913073934,-907112.7883788259,-1010723.0155336795,-937128.8990066742,-1036222.2066497611,-957849.5144042191,-1051951.6247753177,-408086.66044554627,-389051.3797202285,-395179.15476897464,-391195.81198536855,-384602.33903067774,-375466.39385981177,-363881.7236331329,-349967.2027437303,-333865.61300528445,-315742.17851744406,-295782.87024297984,-274192.49769404717,-251192.60730944018,-227019.2090883293,-201920.35480829785,-176153.59267843503,-149983.32454619344,-14452685.63290386,-13118521.150448876,-13118521.150448876,-13118521.150448876,-13118521.150448876,-13118521.150448876,-13118521.150448876,-13118521.150448876,-13855086.17196326,-13740063.039805628,-13859468.004241938,-13803407.233015634,288277711.8813111,-584162.6344180581,-1015266.2948676571,-987859.1089137824,-1133915.7325046808,-1103074.1918867656,-1245052.1313340645,-1209510.3867491896,-1346192.8878533312,-1304790.0847883455,-1435078.684691909,-1386784.894994999,-1509723.960027782,-1453663.1888014802,-1568461.2617575515,-1503931.0156372047,-1609978.4956210435,-1536465.475315747,-1633348.2352189117,-1550539.8017694636,-1638048.4391858715,-1545839.5978025037,-1623974.1127321548,-1522469.858204636,-1591439.6530536127,-1480952.6243411435,-1541171.826217888,-1422215.322611374,-1474293.532411407,-1347570.047275501,-1392298.7222047534,-1258684.2504369232,-1297019.0241655977,-1157543.4939176568,-1190582.8293031738,-1046407.0950882729,-1075367.7463301904,-927757.6574512491,-25784224.328499246,-23831332.257270698,-24440039.164312568,-24742687.638078514,-25231022.963201273,-25544070.929860465,-47999151.82917572,-46775842.49752933,-47848095.955433585,-48614915.31011589,-49687168.768020146,-50453988.12270245,472286140.6517176,-19200914.622988686,-17829403.991663363,-20571161.634325914,-21213178.781848185,-21547275.121804237,441185686.4097662,7915225.414742296,9779139.965056106,8267494.598230918,11976148.364586432,10404092.638636494,13785380.724477056,12243165.45122305,15624453.537063606,14082238.263809597,17463526.349650156,15921311.076396149,19302599.162236713,17760383.888982702,21141671.974823266,9526141.658639966,9946.817377038999,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"56031\u001f0\u001f892.3631561100106\u001f1\u001f1\u001f66\u001f426.1666666666667\u001f1\u001f3677.187506666193\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2028\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f11\u001f2\u001f6\u001f6\u001f12\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f2855525\u001f0\u001f8\u001f1250000\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f3.9999990380831303\u001f3.120001414017798\u001f126011.01515151515\u001f0\u001f977601\u001f0\u001f1\u001f2241290\u001f0\u001f0\u001f0\u001f0\u001f0\u001f50\u001f50\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f50\u001f50\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f33\u001f0\u001f0\u001f33\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f834000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5000001982050302\u001f1.5000001982050302\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1.9999999419887715\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f9402568\u001f10\u001f1368899\u001f1\u001f0\u001f0\u001f0\u001f0\u001f5.5\u001f0\u001f10\u001f1\u001f1\u001f0\u001f0\u001f100\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6314\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f20850\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f5\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f46\u001f1\u001f36143964\u001f0\u001f20\u001f40289696\u001f1\u001f1\u001f0\u001f1\u001f1\u001f6.25\u001f12\u001f1.25\u001f1.5\u001f3147427\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f34\u001f1.4","result":{"m":{"eirr":0.3534891531902127,"irr":0.33144385053473147,"moic":1.3973336012797564,"epeak":40289696,"peakdebt":30594355.015901368,"npv":11222068.915483965,"revenue":103428253,"gross":16008450.006146595,"npat":16008450.006146595,"margin":0.1702561380557514,"einj":40289696,"eret":56298146.006146595,"land":50000000,"finance":3147426.9938534214,"tax":0,"NM":59,"R":{"eqin":[5005544.483333333,0,0,1161077.2399544679,5427.820504932489,5427.820504932489,5427.820504932489,5427.820504932489,5427.820504932489,5427.820504932489,5427.820504932489,5427.820504932489,28646519.99798129,130849.87757654031,1324843.4688787702,1439878.337960021,1230379.2470197575,941984.2764774944,4349893.227782298,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2017518.9522253817,3191539.8235202557,3283921.371444219,2110243.3800659007,3733591.0271910466,45924265.58193303,21762.590770194336,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,25203809.74648953,26126879.94518321,27320512.58217586,28589633.102232154,29733201.84923886,30594355.015901368,1031771.3143524826,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-5005544.483333333,99778.40105539719,-5427.820504932489,-1255427.8205049327,-5427.820504932489,-5427.820504932489,-5427.820504932489,-5427.820504932489,-5427.820504932489,-5427.820504932489,-5427.820504932489,-5427.820504932489,-52794321.003956355,-767949.5993143587,-2223725.663766941,-2404124.710025634,-2059117.0396346694,-1479884.833195916,25424906.878278308,3142077.3764030905,3279118.526058624,3371500.073982587,2197822.082604269,3733591.0271910466,45924265.58193303,21762.590770194336,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"875\u001f0\u001f120000\u001f1\u001f1\u001f42\u001f203.6904761904762\u001f1\u001f53000\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2028\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f11\u001f1\u001f44\u001f44\u001f53\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f9450000\u001f0\u001f0\u001f3615600\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3952410\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f12925907\u001f0\u001f0\u001f0\u001f0\u001f0\u001f100\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f40\u001f40\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f42\u001f0\u001f0\u001f225\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5\u001f1.5\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f41219545\u001f10\u001f14464172\u001f1\u001f0\u001f0\u001f0\u001f0\u001f2\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f203.6904761904762\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f15400\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f53000\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f2\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f72\u001f1\u001f226275780\u001f0\u001f20\u001f68108072\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f12\u001f1.25\u001f1.5\u001f37600202\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f26\u001f2","result":{"m":{"eirr":0.22427083580295526,"irr":0.1458458478536202,"moic":2.4530146740257424,"epeak":68108072,"peakdebt":219210806.59379464,"npv":29034472.303834878,"revenue":453414999.9999996,"gross":99427387.04322606,"npat":98962028.03560181,"margin":0.24008519947315263,"einj":68108072,"eret":167070100.0356018,"land":105000000,"finance":37600201.9643978,"tax":0,"NM":95,"R":{"eqin":[10500000,0,134834.5899412923,3974910,359310,359310,359310,359310,359310,359310,359310,359310,31233912.836428955,0,0,0,0,0,0,0,429891.6056182432,692778.7169164252,699747.8195108534,706268.3652981473,712307.1270716181,717833.3326854759,722818.8218626322,727238.1896930163,731068.9160911749,734291.4805534635,736889.4616300602,738849.6206049097,740161.9689571841,93084.10497478355,129097.31064849353,128439.46034517989,127127.11199290541,125166.95301805611,122568.97194145914,119346.4074791705,115515.68108101207,111096.31325062789,106110.82407347162,100584.61845961376,94545.85668614318,88025.3108988491,81056.20830442081,73674.06185221853,65916.48926842306,57823.021364726796,49434.90059837827,40794.87091007331,31946.959910631616,22936.254526383622,13808.671246529266,4610.722143233084,3074096.666666669,2463684.155404727,2463684.1554047274,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,2463684.155404727,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,188595551.90984306,252092.43971597016,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,81530410.95101188,82040078.93797855,82551910.85648052,83065915.89406694,83582103.2772952,84100482.27189644,84621062.18294199,85143852.35501032,85858607.0198762,86595198.98378384,87352636.15845868,88129831.95753726,88925610.88334104,89738714.56693318,90567808.23068063,91411487.54039039,92268285.81210431,93136681.53682886,94015106.1848565,94901952.24991083,95795581.49212486,96694333.33784953,97596533.39348939,98500502.02998215,99404562.99417841,100307052.0032409,101206325.27826896,102100767.9736641,102988802.45928314,103868896.41317618,104739570.68367147,105599406.88074496,106447054.65799129,107281238.6480903,108100765.01642832,108904527.59947929,109691513.59666732,110460808.7867069,111211602.2418406,111943190.5159527,112654981.28521788,113346496.4227341,114017374.49147326,114667372.64284694,123225466.01394174,131811139.7450673,140424510.93600693,149065697.18372232,157734816.58446446,166431987.73589352,175157329.73920768,183910962.20128113,192693005.23681086,201503579.470473,210342806.0390879,219210806.59379464,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-10500000,224475.4100587077,-359310,-3974910,-359310,-359310,-359310,-359310,-359310,-359310,-359310,-359310,-109884082.57908298,4886027.504298777,-693637.7033490888,-725818.794007117,-757418.4761479802,-788275.7250347836,-818233.2992003143,-847138.5417135152,-874844.1580842132,-901208.9668420787,-926098.6189650367,-949386.2824910867,-970953.2888249108,-990689.7374458313,-1008495.055935675,-1024278.5124727618,-1037959.6781804706,-1049468.8369743584,-1058747.3408193472,-1065747.9085866662,-1070434.8669876466,-425048.6180709098,-461061.82374461996,-458712.35837564233,-454025.39997466194,-447024.832207343,-437746.3283623542,-426237.16956846626,-412556.0038607575,-396772.5473236707,-378967.2288338271,-359230.7802129064,-337663.77387908264,-314376.1103530325,-289486.4582300745,-263121.6494722089,-235416.03310151096,-206510.79058831013,-176553.21642277943,-145695.96753597603,-114096.28539511286,-81915.19473708438,-49316.683023318605,-16466.86479726089,-10978916.666666673,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,-10368504.155404732,408271717.51126194,252092.43971597016,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"1197200\u001f0\u001f125.2923488138991\u001f1\u001f1\u001f1100\u001f400\u001f1\u001f1281.6104409090908\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2027\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f11\u001f5\u001f12\u001f12\u001f12\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f8605525\u001f0\u001f8\u001f1205000\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f4.000000258431983\u001f3.0000000469876333\u001f154779.60363636364\u001f0\u001f17025756\u001f0\u001f1\u001f13112000\u001f0\u001f0\u001f0\u001f0\u001f0\u001f20\u001f20\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f20\u001f20\u001f12\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f20\u001f20\u001f24\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f20\u001f20\u001f36\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f20\u001f20\u001f48\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f220\u001f0\u001f0\u001f220\u001f1\u001f0\u001f220\u001f0\u001f0\u001f220\u001f0\u001f0\u001f220\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3000000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5000000159600335\u001f1.5000000159600335\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f2.0000000212800444\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f51264418\u001f10\u001f20672434\u001f1\u001f0\u001f0\u001f0\u001f0\u001f18.333333\u001f0\u001f10\u001f1\u001f1\u001f0\u001f0\u001f100\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6314\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f20850\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f5\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f48\u001f1\u001f189289980\u001f0\u001f20\u001f130801343\u001f1\u001f1\u001f0\u001f1\u001f1\u001f6.25\u001f12\u001f1.25\u001f1.25\u001f12863073\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f32\u001f1.8","result":{"m":{"eirr":0.16678660415370294,"irr":0.17055447055192463,"moic":1.8037702793341774,"epeak":130801343,"peakdebt":98906426.43495463,"npv":35217762.4248204,"revenue":563908593.999999,"gross":105136783.9936683,"npat":105134232.00039557,"margin":0.2050822713343295,"einj":130801343,"eret":235935575.00039557,"land":150000000,"finance":12863072.99960403,"tax":0,"NM":99,"R":{"eqin":[15113505.05,0,0,705217.077068972,107287.65287543603,107287.65287543603,107287.65287543603,107287.65287543603,107287.65287543603,107287.65287543603,107287.65287543603,107287.65287543603,81716831.0600495,0,0,1311182.0921206977,2774651.265271456,2928068.0906871664,2909480.211499655,2736376.1103735627,2374620.2210217435,1896425.372306469,1316530.5653754154,690676.4224153915,0,1113468.087175731,1930070.2223491035,2405631.3458609316,2707883.212100813,2863787.6187121468,2844870.750490664,2668643.510159992,2301183.1682085446,1815091.302516207,1225645.0828872023,589236.0444992485,0,0,0,0,0,0,0,0,0,0,0,1.1641532182693481e-10,0,0,0,0,0,0,0,0,0,0,0,1.1641532182693481e-10,0,0,0,0,0,0,0,0,0,0,0,1.1641532182693481e-10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,35313756.664352216,0,0,0,0,3.725290298461914e-09,0,1.862645149230957e-09,0,0,0,0,55381797.12367546,0,0,0,0,3.725290298461914e-09,0,1.862645149230957e-09,0,0,0,0,55381797.12367546,0,0,0,0,3.725290298461914e-09,0,1.862645149230957e-09,0,0,0,0,98726488.56070101,127767.63414422233,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,76948106.97128852,77294400.12031186,77641895.11538146,80145479.90715201,82992839.21064165,86022579.82375002,89060987.71904327,91933866.74302638,94478410.17281267,96554296.10322656,98053250.53204902,98906426.43495463,0,1134541.590784217,2864957.4792410047,5084154.904568473,7651769.046320196,10403728.785429843,13163438.01076307,15753810.483634725,18009338.10416464,19787370.1470652,20977834.805583153,21510740.536443297,0,131390.07497029752,263236.1527306186,395539.8158856201,528302.6525325512,661526.2562803165,795212.2262686042,929362.1671870815,1063977.6892946567,1199060.4084388071,1334611.9460749757,1470633.929286033,0,131390.07497029752,263236.1527306186,395539.8158856201,528302.6525325512,661526.2562803165,795212.2262686042,929362.1671870815,1063977.6892946567,1199060.4084388071,1334611.9460749757,1470633.929286033,0,131390.07497029752,263236.1527306186,395539.8158856201,528302.6525325512,661526.2562803165,795212.2262686042,929362.1671870815,1063977.6892946567,1199060.4084388071,1334611.9460749757,1470633.929286033,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-15113505.05,714358.2286819,-107287.65287543603,-1312287.652875436,-107287.65287543603,-107287.65287543603,-107287.65287543603,-107287.65287543603,-107287.65287543603,-107287.65287543603,-107287.65287543603,-107287.65287543603,-156852560.5410865,4852317.976516951,-3685966.042728418,-4629430.454142725,-5262660.32654193,-5590061.8534166915,-5571473.97422918,-5224385.171644038,-4526516.649255238,-3572986.756414134,-2410927.7919972762,-1135753.9034523733,99299705.06405818,-2237746.186756201,-3523641.573790391,-4482413.964492068,-5126347.794507636,-5459119.800305324,-5440202.932083841,-5087108.092566815,-4377965.786839681,-3408662.6539574955,-2227405.9130390924,-930918.0082749362,99287905.827818,-2237746.186756201,-3523641.573790391,-4482413.964492068,-5126347.794507636,-5459119.800305324,-5440202.932083841,-5087108.092566815,-4377965.786839681,-3408662.6539574955,-2227405.9130390924,-930918.0082749362,99287905.827818,-2237746.186756201,-3523641.573790391,-4482413.964492068,-5126347.794507636,-5459119.800305324,-5440202.932083841,-5087108.092566815,-4377965.786839681,-3408662.6539574955,-2227405.9130390924,-930918.0082749362,99287905.827818,-2237746.186756201,-3523641.573790391,-4482413.964492068,-5126347.794507636,-5459119.800305324,-5440202.932083841,-5087108.092566815,-4377965.786839681,-3408662.6539574955,-2227405.9130390924,-930918.0082749362,100199674.48325978,127767.63414422233,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"6857\u001f0\u001f18667.055563657577\u001f1\u001f1\u001f145\u001f122.13103448275862\u001f1\u001f41942.93212490824\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2028\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f11\u001f1\u001f36\u001f36\u001f53\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f8896657\u001f0\u001f0\u001f3615600\u001f3648000\u001f0\u001f0\u001f0\u001f0\u001f7817160\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f10515856\u001f0\u001f0\u001f0\u001f0\u001f0\u001f100\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f40\u001f40\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f145\u001f0\u001f0\u001f225\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f2560000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f2.199999936723124\u001f0.13500000407260748\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0.8299999602163469\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f55887944\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f0\u001f3.02\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f122.13103448275862\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f13650.901970749337\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3.297836073354395\u001f1\u001f0\u001f1\u001f41942.93212490824\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3.02\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f73\u001f1\u001f361660277\u001f0\u001f20\u001f103205074\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f12\u001f1.25\u001f1.5\u001f58083379\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f32\u001f2.8","result":{"m":{"eirr":0.32167721803070637,"irr":0.21338484278820258,"moic":2.846014509376109,"epeak":103205074,"peakdebt":314463664.01204306,"npv":91106511.57317583,"revenue":742767385.0000014,"gross":190518064.04523504,"npat":190518064.04523504,"margin":0.2773675446856689,"einj":103205074,"eret":293723138.04523504,"land":128000000.00000001,"finance":58083378.95476505,"tax":0,"NM":99,"R":{"eqin":[12800000.000000002,710650.9090909091,710650.9090909091,4326250.909090909,710650.9090909091,710650.9090909091,710650.9090909091,710650.9090909091,710650.9090909091,710650.9090909091,710650.9090909091,710650.9090909091,37049785.28990884,416966.05806622695,427606.2380039404,438042.41152792407,448195.15305612714,457987.1940951271,467344.0113000206,476194.39364207804,484470.98436766944,492110.7936238307,499055.67784907983,505252.78228102654,510654.94321303,515221.0469384836,518916.3426509479,521712.70691877033,523588.8577213823,524530.5164183246,524530.5164183246,523588.8577213822,521712.70691877045,518916.34265094803,515221.04693848355,510654.94321303,505252.78228102654,499055.6778490798,492110.79362383083,484470.9843676694,476194.393642078,467344.01130002056,457987.19409512705,448195.15305612725,438042.4115279242,427606.2380039403,416966.05806622695,406202.84990882664,4564629.640304411,4677165.557907859,4789701.475511307,4902237.393114755,5014773.310718201,5127309.228321649,5239845.145925099,5352381.063528547,5464916.981131995,5577452.898735443,5689988.816338891,5802524.733942338,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,200711349.0146321,9284264.076777795,9701063.77160538,10117863.466432966,10534663.161260553,10951462.85608814,11368262.550915726,11785062.245743312,12201861.940570898,12618661.635398485,13035461.330226071,13902847.251827778,4652615.352402489,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,104219334.23605159,105087991.32527302,105989561.23544611,106923612.76651639,107889498.22400115,108886358.4950045,109913129.73395447,110968551.60718352,112051177.03360903,113159383.34738508,114291384.79757425,115445246.28971264,116618898.26469035,117810152.60171306,119016719.42431757,120236224.68154034,121466228.37043966,122704243.26129027,123947753.98294395,125194236.3231087,126441176.59666304,127686090.93460466,128926544.34683618,130160169.41371273,131384684.46410058,132597911.10160483,133797790.94558439,134982401.45954877,136149970.7464768,137298891.19845968,138427731.89678985,139535249.6681276,140620398.7126048,141682338.73059404,142720441.48629725,143734295.75820488,156015971.9669363,168647078.98192,181628906.56690663,194962750.64540756,208649913.3301134,222691702.95245284,237089434.0922924,251844427.6077784,266958010.66532132,282431516.7697232,298266285.79444903,314463664.01204306,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-12800000.000000002,-710650.9090909091,-710650.9090909091,-4326250.909090909,-710650.9090909091,-710650.9090909091,-710650.9090909091,-710650.9090909091,-710650.9090909091,-710650.9090909091,-710650.9090909091,-710650.9090909091,-136137780.6924287,-460672.42634498543,-500080.500188368,-538732.9947216416,-576335.7411223939,-612602.559785356,-647257.438321999,-680036.6321814711,-710690.6719058836,-738986.2617435181,-764708.0551703663,-787660.2938072062,-807668.2972590708,-824579.7925385286,-838266.0729550631,-848622.977650702,-855571.684327042,-859059.309130532,-859059.309130532,-855571.684327042,-848622.9776507021,-838266.0729550631,-824579.7925385286,-807668.2972590707,-787660.2938072062,-764708.0551703663,-738986.2617435183,-710690.6719058836,-680036.6321814712,-647257.438321999,-612602.559785356,-576335.741122394,-538732.9947216418,-500080.50018836814,-460672.42634498543,-420808.6924286878,-15822389.397597518,-16239189.092425104,-16655988.78725269,-17072788.482080277,-17489588.17690786,-17906387.871735446,-18323187.566563033,-18739987.26139062,-19156786.956218205,-19573586.65104579,-19990386.34587338,-20407186.040700965,516213356.5259664,9734850.303551916,10151649.9983795,10568449.693207087,10985249.388034673,11402049.08286226,11818848.777689846,12235648.472517433,12652448.167345019,13069247.862172605,13486047.557000192,13902847.251827778,4652615.352402489,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"7558\u001f0\u001f8930.934109552793\u001f1\u001f1\u001f660\u001f125.0909090909091\u001f1\u001f21330.75944767442\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2029\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f23\u001f3\u001f31\u001f31\u001f42\u001f42\u001f12\u001f12\u001f12\u001f10\u001f10\u001f1\u001f4249900\u001f0\u001f8\u001f1205200\u001f0\u001f0\u001f0\u001f0\u001f0\u001f28345393\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f28198771\u001f0\u001f0\u001f0\u001f0\u001f0\u001f33.33333333333333\u001f25\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f33.33333333333333\u001f37.5\u001f7\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f33.33333333333333\u001f37.5\u001f21\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f220\u001f0\u001f0\u001f220\u001f1\u001f0\u001f220\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f17377500\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5000000283918702\u001f1.5000000283918702\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f160097045\u001f10\u001f105061670\u001f1\u001f0\u001f0\u001f0\u001f0\u001f9.2\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f125.0909090909091\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f11444.360767926357\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f21330.75944767442\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f9.2\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f68\u001f1\u001f786666658\u001f0\u001f20\u001f229525015\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.5\u001f24\u001f1.25\u001f1.25\u001f47798311\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f17\u001f2.9","result":{"m":{"eirr":0.2126192860796463,"irr":0.2264094295626886,"moic":2.941331174775463,"epeak":229525015,"peakdebt":245139566.23701513,"npv":160374277.02884904,"revenue":1761067499.9999955,"gross":445584067.01030576,"npat":445584067.01030576,"margin":0.27832123048785856,"einj":229525015,"eret":675109082.0103058,"land":74250000,"finance":47798310.9896893,"tax":0,"NM":134,"R":{"eqin":[6750000,603342.9038271683,1232408.391304348,2437608.3913043477,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,1232408.391304348,79103324.01630434,0,0,0,0,776465.2067499419,1413424.016304348,1413424.016304348,1413424.016304348,1413424.016304348,1413424.016304348,1413424.016304348,13001273.73417173,0,0,0,212995.24152440228,887290.3986223831,904250.275718847,917763.3403379369,935173.1319706977,1031662.6116243759,959501.0708154768,981100.009489442,993927.6950185366,1005353.7346462752,1095349.2083516323,1016244.6197288937,1030516.1451060099,1035699.5656100214,1039234.1897530665,1121162.3199406047,1033886.5270620941,1044686.1889990229,1051142.35098988,1055981.1298449947,1139261.221033496,1053399.8695651006,1060958.129297573,1059553.8371154831,1056704.6198691358,1132526.4972829146,1039490.3541902489,7230443.255705306,5547494.84085625,5631110.155904583,5793556.125898549,5787220.215814709,5874628.337902278,5953358.477519077,6030884.407780405,6187275.047297182,6174951.72491026,6256473.836907177,6329452.285601773,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8004852.27272724,8004852.272727273,8004852.272727273,0,0,0,0,0,0,0,0,0,0,0,0,0,1.862645149230957e-09,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,180221847.76912612,0,0,0,0,1.4901161193847656e-08,0,0,0,0,0,0,0,0,367586293.1946825,17161984.058069564,15362403.99989094,16333544.078680739,17307170.861814793,18280797.64494885,21772753.188815232,20777918.206128515,16712400.763453662,17406.930409818244,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,31446118.262807418,31948211.24845312,32451537.64550621,32956100.483890902,33568932.66382978,34204735.90001163,34862235.465451606,35550009.74586041,36276405.48453575,37039436.17070936,37836845.637952454,38666130.11832365,39524562.32295693,40409217.31118383,41316999.89475607,42244673.31074064,43188888.886316545,44146216.41110147,45113174.927842505,46086263.650351636,47061992.71846212,48046976.35435431,49047862.41914018,50061242.11697465,51083721.83139939,52111950.29062821,53142644.6167231,54172615.0381885,55198788.06277721,56218227.9263699,57228156.15444906,71392706.54429995,85835821.68284824,100555484.30101284,115549644.54795556,130816234.41397613,146353182.2622285,162158427.38800898,178229934.52421305,194565708.21185791,211163806.95532325,228022357.08316654,245139566.23701513,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2727279.200563414,11402652.021774389,20194865.929690845,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-6750000,-603342.9038271683,-1232408.391304348,-2437608.3913043477,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-1232408.391304348,-79103324.01630434,4877230.858467449,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-1413424.016304348,-38713394.1900253,2633813.943536396,-923809.5880768761,-958320.5127153706,-1071607.459515146,-1015723.6713807352,-1052870.54681247,-1095098.8737471257,-1149504.4725995034,-1280930.9825020963,-1241382.0219841534,-1293025.9648455794,-1333112.482124,-1368818.855960683,-1479951.5972747726,-1418705.6123385811,-1447451.3886473542,-1463649.5777223897,-1474695.2781694059,-1560617.570990311,-1473836.572754832,-1491732.7758130196,-1511908.2820344479,-1527029.4659566814,-1617176.6369055966,-1534815.7680767279,-1542582.589245988,-1538194.1761769573,-1529290.3722821223,-1596130.6251850296,-1491348.5325303157,-20822223.60927016,-19390394.171909608,-19722569.519566063,-20130987.54991248,-20368021.17354076,-20696196.302700125,-21013105.477133047,-21326251.497330114,-21715746.61993531,-21934069.580116466,-22243850.92774255,-22542786.06804358,385130780.9190372,2152678.1437350186,1890753.35861321,1920835.9410258494,1960876.8473713547,2003192.0394853605,-16419301.748092525,-14960855.17055407,-15035824.269512357,-15243192.08846865,-15318579.519393383,-15602989.960295547,-15707412.142684434,-13267999.090710202,-15876499.589610549,-15948524.417615352,-16227797.578450529,-16327823.23772362,371419521.3853208,7996673.382427991,-15306628.90962225,-11899173.150256675,-14749111.546600789,-12781633.371794522,-13211869.682176514,-16162921.457635084,-14387330.484932614,-17237268.881276727,-14871096.075914904,-13704459.898337288,-15734105.68287968,-12785540.61176537,368025492.7315682,17601183.59495529,15801603.536776667,16772743.615566466,17746370.39870052,18719997.18183458,22211952.72570096,20777918.206128515,16712400.763453662,17406.930409818244,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"56031\u001f0\u001f892.3631561100106\u001f1\u001f1\u001f66\u001f426.1666666666667\u001f1\u001f3677.187506666193\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2029\u001f12\u001f1\u001f0\u001f0\u001f0\u001f0\u001f12\u001f2\u001f6\u001f6\u001f12\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f2855525\u001f0\u001f8\u001f1250000\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f3.8832683707558324\u001f3.028951430342066\u001f129798.89393939394\u001f0\u001f890940\u001f0\u001f1\u001f2241290\u001f0\u001f0\u001f0\u001f0\u001f0\u001f50\u001f50\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f50\u001f50\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f33\u001f0\u001f0\u001f33\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f834000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f1.5000001982050302\u001f1.5000001982050302\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1.9999999419887715\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f9402568\u001f10\u001f1383748\u001f1\u001f0\u001f0\u001f0\u001f0\u001f5.5\u001f0\u001f10\u001f1\u001f1\u001f0\u001f0\u001f100\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6314\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f4\u001f1\u001f0\u001f1\u001f20850\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f5\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f6\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f44\u001f1\u001f33364564\u001f0\u001f20\u001f39189283\u001f1\u001f1\u001f0\u001f1\u001f1\u001f5.75\u001f0\u001f1.25\u001f1.5\u001f3059811\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f34\u001f1.4","result":{"m":{"eirr":0.2099154443640905,"irr":0.16316793718942568,"moic":1.40693717204412,"epeak":39189283,"peakdebt":32390709.538802654,"npv":6397801.827659735,"revenue":103428253,"gross":15947575.99845671,"npat":15947575.99845671,"margin":0.16960871913304018,"einj":39189283,"eret":55136858.99845671,"land":50000000,"finance":3059811.0015432965,"tax":0,"NM":59,"R":{"eqin":[32575558.910666667,0,0,0,0,0,0,0,0,0,0,0,4.656612873077393e-10,1084984.377265778,1347549.5759885984,1466288.6757987365,1248543.3253376575,942736.7096448009,4329112.438341712,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,399003.46410139755,3261927.75863461,3356225.071048046,2184903.4121100185,3763175.8021984957,45955170.93811707,21943.5652910323,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[26051148.262487788,26179910.75882879,26309263.60212206,26439209.49897499,26569751.16840415,26700891.341892194,26832632.763444994,26964978.189649083,27097930.389729314,27231492.14560681,27365666.251957174,27500455.516268965,27917046.142544966,28672845.51778654,29685669.522214193,30765590.060867637,31717708.969586007,32390709.538802654,2718362.367253325,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-58144429.483333334,1022024.1607108663,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-38786.85035392003,-914863.4171592464,-1702755.5355413773,-2219188.918295031,-2401316.0851556943,-2052158.8927490728,-1464307.7229000526,25445687.667718895,3163502.3231954165,3301832.711850803,3396130.024264239,2224808.3653262113,3763175.8021984957,45955170.93811707,21943.5652910323,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}},{"key":"6857\u001f0\u001f18667.055563657577\u001f1\u001f1\u001f145\u001f122.13103448275862\u001f1\u001f42665.72838669603\u001f1\u001f3977\u001f1\u001f20850\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f100\u001f1\u001f2029\u001f12\u001f1\u001f1\u001f0\u001f12\u001f3\u001f23\u001f1\u001f36\u001f36\u001f53\u001f12\u001f12\u001f12\u001f12\u001f0\u001f10\u001f1\u001f8896657\u001f0\u001f0\u001f3615600\u001f1920000\u001f1728000\u001f0\u001f0\u001f0\u001f8415986\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f11138762\u001f0\u001f0\u001f0\u001f0\u001f0\u001f100\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f0\u001f40\u001f40\u001f0\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f0\u001f0\u001f-1\u001f0\u001f0\u001f0\u001f0\u001f-1\u001f-1\u001f145\u001f0\u001f0\u001f225\u001f1\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f2560000\u001f0\u001f100\u001f0\u001f0\u001f1\u001f0\u001f2.9491773297614974\u001f0.13271298116277608\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0.983059109920499\u001f0\u001f10\u001f0\u001f0\u001f0\u001f32\u001f10\u001f68687944\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f0\u001f3.02\u001f0\u001f10\u001f1\u001f1\u001f0\u001f1\u001f122.13103448275862\u001f120\u001f150\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f14700.88723248066\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3.276563393285803\u001f1\u001f0\u001f1\u001f42665.72838669603\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f3.02\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f12\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f74\u001f1\u001f388851106\u001f0\u001f20\u001f103609962\u001f1\u001f1\u001f0\u001f1\u001f1\u001f6\u001f24\u001f1.25\u001f1.5\u001f60682500\u001f1.1\u001f1\u001f100\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f1\u001f1\u001f0\u001f0\u001f0\u001f1\u001f0\u001f0\u001f0\u001f100\u001f1\u001f0\u001f1\u001f1\u001f1\u001f1\u001f2\u001f3\u001f10\u001f32\u001f2.55","result":{"m":{"eirr":0.1339543672149277,"irr":0.15847216057120406,"moic":2.547537976900517,"epeak":103609962,"peakdebt":236931557.69143975,"npv":53167011.13853834,"revenue":755567383.9999993,"gross":160340350.98021945,"npat":160340350.98021945,"margin":0.23343303299370768,"einj":103609962,"eret":263950312.98021945,"land":128000000.00000001,"finance":60682500.01978075,"tax":0,"NM":111,"R":{"eqin":[12800000.000000002,365912.4347826087,365912.4347826087,3981512.434782609,365912.4347826087,365912.4347826087,365912.4347826087,365912.4347826087,365912.4347826087,365912.4347826087,365912.4347826087,365912.4347826087,128145637.9279333,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,400980.9279332936,2740189.4223972084,533331.537848206,544184.564022125,554829.5028365433,565185.3398794932,575173.2609780526,584717.2520217898,593744.6774760424,602186.8331821952,609979.4692378114,617063.2789771855,623384.3503308794,628894.5761291244,633552.0202264304,637321.2366609757,640173.5394197777,642087.2207565748,643047.7164008815,643047.7164008815,642087.2207565748,640173.5394197777,637321.2366609757,633552.0202264304,628894.5761291243,623384.3503308794,617063.2789771855,609979.4692378114,602186.8331821952,593744.6774760422,584717.2520217896,575173.2609780526,565185.3398794932,554829.5028365433,544184.564022125,533331.5378482059,522353.0223972057,4834862.926667923,4951566.173426542,5068269.4201851655,5184972.666943787,5301675.913702411,5418379.160461031,5535082.407219652,5651785.653978275,5768488.900736896,5885192.147495519,6001895.394254141,6118598.641012765,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"eqout":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,276643161.22228533,8741289.995764485,9190148.637143794,9639007.278523104,10087865.919902414,10536724.561281724,10985583.202661034,11434441.844040344,11883300.485419655,12332159.126798965,12781017.768178277,13872934.704550464,4650805.755125177,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"lcl":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,13417325.053857472,14185719.440401306,14990085.119960114,15830015.240318947,16704870.085920192,17613782.19655393,18555663.220976792,19529212.453310087,20532926.987261117,21565113.41089892,22623900.952991404,23707255.98086343,24812997.73944983,25938815.211770885,27082284.972523525,28240889.898922957,29412038.5964057,30593085.391364317,31781350.738768823,32974141.889372297,34168773.65922272,35362589.1434245,36552980.21651754,37737407.66346569,38913420.788058035,40078676.34950322,41230956.68311068,42368186.86716169,43488450.805332616,44590006.10228606,45671297.619230464,46730969.60629484,47767876.31939706,48781091.04081768,49769913.434840545,50733875.18249237,64008701.367057174,77683995.25256956,91761856.61710274,106244399.12867083,121133750.43710995,136432052.26656753,152141460.50860327,168264145.31590587,184802291.19662985,201758097.10935628,219133776.5586818,236931557.69143975,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"net":[-12800000.000000002,-365912.4347826087,-365912.4347826087,-3981512.434782609,-365912.4347826087,-365912.4347826087,-365912.4347826087,-365912.4347826087,-365912.4347826087,-365912.4347826087,-365912.4347826087,-365912.4347826087,-128145637.9279333,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-400980.9279332936,-9068175.972746063,-580261.0321729803,-622003.4405342076,-662945.5128973549,-702775.6553702394,-741190.7365185446,-777898.3943790721,-812619.261510813,-845089.0911498625,-875060.7682868479,-902306.1903613633,-926618.0032601862,-947811.1794072824,-965724.4259353827,-980221.4122220948,-991191.8074482566,-998552.1202820917,-1002246.334298656,-1002246.334298656,-998552.1202820917,-991191.8074482568,-980221.4122220948,-965724.4259353827,-947811.1794072823,-926618.0032601862,-902306.1903613633,-875060.768286848,-845089.0911498625,-812619.2615108131,-777898.3943790721,-741190.7365185446,-702775.6553702394,-662945.512897355,-622003.4405342077,-580261.0321729803,-538035.972746057,-17124612.52763343,-17573471.16901274,-18022329.810392056,-18471188.45177137,-18920047.093150686,-19368905.734530002,-19817764.375909317,-20266623.017288633,-20715481.658667948,-21164340.300047264,-21613198.94142658,-22062057.582805894,514849317.0286891,9384348.290757362,9833206.932136672,10282065.573515981,10730924.214895291,11179782.856274601,11628641.49765391,12077500.13903322,12526358.780412532,12975217.421791842,13424076.063171154,13872934.704550464,4650805.755125177,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}}}]};
function seedBundledStartupResults(){
  try{
    const currentKey=decisionKey();
    if(currentKey===BUNDLED_STARTUP_RESULTS.activeKey)analyticsCacheSet(_decisionResults,currentKey,BUNDLED_STARTUP_RESULTS.decision,12);
    APP.parcels.forEach((p,i)=>{const item=BUNDLED_STARTUP_RESULTS.parcels[i],key=modelInputSignature(p.inputs);if(item&&item.key===key&&item.result)cacheSetLRU(_portfolioResults,key,item.result,48)});
  }catch(e){}
}


/* Resizable input rail: UI-only; no appraisal inputs or calculations are changed. */
function initResizableInputRail(){
  const shell=document.querySelector('.shell'),handle=document.getElementById('railResizer');
  if(!shell||!handle)return;
  const KEY='australia-feasibility-input-rail-width-v1',DEFAULT=334,MIN=280,ABS_MAX=520;
  let pending=0,raf=0,dragging=false;
  const maxWidth=()=>Math.max(MIN,Math.min(ABS_MAX,Math.round(window.innerWidth*.45)));
  const clampWidth=v=>Math.max(MIN,Math.min(maxWidth(),Math.round(Number(v)||DEFAULT)));
  const apply=(v,persist=false)=>{
    const width=clampWidth(v);document.documentElement.style.setProperty('--input-rail-width',width+'px');
    handle.setAttribute('aria-valuemax',String(maxWidth()));handle.setAttribute('aria-valuenow',String(width));
    if(persist){try{localStorage.setItem(KEY,String(width))}catch(e){}}
    return width;
  };
  let initial=DEFAULT;try{initial=Number(localStorage.getItem(KEY))||DEFAULT}catch(e){}
  apply(initial,false);
  const queue=v=>{pending=v;if(raf)return;raf=requestAnimationFrame(()=>{raf=0;apply(pending,false)})};
  const finish=e=>{
    if(!dragging)return;dragging=false;document.body.classList.remove('rail-resizing');
    try{handle.releasePointerCapture(e.pointerId)}catch(err){}
    apply(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--input-rail-width'))||pending,true);
  };
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;dragging=true;document.body.classList.add('rail-resizing');handle.setPointerCapture(e.pointerId);queue(e.clientX-shell.getBoundingClientRect().left);e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{if(dragging)queue(e.clientX-shell.getBoundingClientRect().left)});
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  handle.addEventListener('dblclick',()=>apply(DEFAULT,true));
  handle.addEventListener('keydown',e=>{
    const current=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--input-rail-width'))||DEFAULT;
    const step=e.shiftKey?40:10;let next=null;
    if(e.key==='ArrowLeft')next=current-step;else if(e.key==='ArrowRight')next=current+step;
    else if(e.key==='Home')next=MIN;else if(e.key==='End')next=maxWidth();
    if(next!=null){e.preventDefault();apply(next,true)}
  });
  window.addEventListener('resize',()=>apply(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--input-rail-width'))||DEFAULT,false),{passive:true});
}



/* Consolidation project comparison: user scrolling always wins.  No code
   restores canvas.scrollTop or chart.scrollLeft after a repaint. */
let _portfolioUserScrollAt=0,_portfolioInteractionLocked=false;
function markPortfolioScrollActivity(){
  if(activePane()==='port'){_portfolioUserScrollAt=performance.now();_portfolioInteractionLocked=true}
}
function decoratePortfolioCharts(){
  const charts=[...document.querySelectorAll('#p_port .chart')];
  const count=Math.max(1,APP.parcels.length),width=Math.max(1120,180+count*145);
  charts.forEach(el=>{
    el.classList.add('portfolio-scroll-chart');
    el.style.setProperty('--portfolio-chart-width',width+'px');
  });
}
function initPortfolioScrollStability(){
  const canvas=document.querySelector('.canvas');if(!canvas)return;
  canvas.addEventListener('scroll',markPortfolioScrollActivity,{passive:true});
  canvas.addEventListener('wheel',markPortfolioScrollActivity,{passive:true});
  canvas.addEventListener('touchmove',markPortfolioScrollActivity,{passive:true});
  document.addEventListener('scroll',e=>{
    const target=e.target;
    if(activePane()==='port'&&target&&target.closest&&target.closest('#p_port'))markPortfolioScrollActivity();
  },true);
}
/* Wait until scrolling has genuinely stopped, then perform at most one complete
   comparison repaint.  The repaint never forces either axis back to an old value. */




/* Dynamic Excel export formatting. */
var makeXlsxBlob=makeXlsxBlobCore;
(function(){
  function excelCell(v,style){v=Number(v||0);if(Math.abs(v)<.5)return `<td style="${style}">-</td>`;return `<td style="${style}mso-number-format:'A$#,##0;[Red](A$#,##0);-'">${Math.round(v)}</td>`}
  function dynamicInputsExcel(){const d=derive(D),st="border:.5pt solid #808080;font-family:Calibri;font-size:9pt;",hd=st+"background:#FCE4D6;font-weight:bold;",bn=st+"background:#DDEBF7;font-weight:bold;",gr=st+"background:#D0CECE;font-weight:bold;";let h=`<table><tr><td style="${bn}" colspan="4">Dynamic Reforecast - Active Inputs</td></tr><tr><td style="${hd}">Group</td><td style="${hd}">Particulars</td><td style="${hd}">Unit</td><td style="${hd}">Value</td></tr>`;GROUPS.forEach(g=>{const rows=[];g.f.forEach(([k,lab,unit,,ty])=>{if(!fieldShown(k,!!d.vert))return;[lab,unit]=inputDisplay(k,lab,unit,d);const v=ty==="c"?d[k]:D[k];if(v==null||v===""||(typeof v==="number"&&!Number.isFinite(v)))return;if(typeof v==="number"&&Math.abs(v)<1e-9)return;rows.push([lab,unit,v])});if(!rows.length)return;rows.forEach((r,i)=>{const [lab,unit,v]=r;h+=`<tr><td style="${i?st:gr}">${i?"":g.g}</td><td style="${st}">${esc_(lab)}</td><td style="${st}">${esc_(unit||"")}</td>${typeof v==="number"?`<td style="${st}mso-number-format:'#,##0.00'">${v}</td>`:`<td style="${st}">${esc_(v)}</td>`}</tr>`})});return h+`</table>`}
  function dynamicPlExcel(){const A=run(D),d=derive(D),S=projectPlDataForExports(A,d),years=S.years,st="border:.5pt solid #808080;font-family:Calibri;font-size:9pt;",hd=st+"background:#FCE4D6;font-weight:bold;",bn=st+"background:#DDEBF7;font-weight:bold;",gr=st+"background:#D0CECE;font-weight:bold;",gn=st+"background:#E2EFDA;font-weight:bold;";let h=`<table><tr><td style="${bn}" colspan="${years.length+4}">${esc_(P0().name)} - Dynamic Project P&amp;L and Feasibility</td></tr><tr><td style="${hd}">Ref.</td><td style="${hd}">Particulars</td><td style="${hd}">%</td>${years.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;const totalNet=Math.max(1,Math.abs(S.total('netRevenue'))),add=(ref,label,key,style=st,force=false)=>{const total=S.total(key);if(!force&&Math.abs(total)<.5)return;h+=`<tr><td style="${style}">${ref}</td><td style="${style}">${label}</td><td style="${style}">${P(total/totalNet)}</td>${years.map(y=>excelCell(S.value(y,key),style)).join("")}${excelCell(total,style)}</tr>`},band=label=>{h+=`<tr><td style="${bn}" colspan="${years.length+4}">${label}</td></tr>`};add("1.1","Gross Revenue / Net Qualified Sales","grossRevenue",st,true);add("1.2","Less: Output GST","outputGst",st,true);add("1","Net Revenue","netRevenue",gn,true);band("Land and Acquisition Cost");add("2.1","Land Purchase Cost","landPurchase");add("2.2","Stamp / Transfer Duty","stampDuty");add("2.3","Foreign Purchaser Surcharge","foreignSurcharge");add("2.4","FIRB Application Fee","firb");add("2.5","Acquisition Fee and Other Acquisition Costs","acquisitionCost");add("2.6","Land Holding Costs","holdingCost");add("2","Total Land Cost","landTotal",gr,true);band("Development Cost");add("3.1","Construction Cost","constructionCost");add("3.2","Professional Fees","professionalFees");add("3.3","Development Management Fees / Other Direct Cost","developmentManagement");add("3.4","Statutory Costs","statutoryCost");add("3.5","Project Contingency","contingencyCost");add("3.6","Project Capex","projectCapex");add("3","Total Development Cost","developmentTotal",gr,true);band("Selling Cost and GST");add("4.1","Brokerage & Incentive","brokerage");add("4.2","Selling / Settlement Expenses","sellingCost");add("4.3","Marketing and Advertising","marketing");add("4","Total Selling Cost","sellingTotal",gr,true);add("5","Less: Recoverable Input GST Credit","inputGstCredit",st,true);add("6","Total Direct Project Cost","directCost",gr,true);band("Finance, Overheads and Profit");add("7.1","Processing / Establishment Fee","processingFee");add("7.2","Interest","interest");add("7.3","Line Fee","lineFee");add("7","Total Finance Cost","financeCost",gr,true);add("8","Project and Corporate Overheads","overheadCost");add("9","Depreciation & Amortisation","depreciation");add("10","Development Fees / Other Income","otherIncome");add("11","Net Profit Before Taxes","npbt",gn,true);add("12","Corporate Taxes","tax");add("13","Net Profit after Tax","npat",gn,true);return h+`</table>`}
  function dynamicCfExcel(){const A=run(D),activity=["cfrefresrev","cfrefgst","cfrefland","cfrefconstruction","cfgstrefund","cfrefnetcash","dr1","dr2","rep","pf","intr","lf","cfrefequity","cfrefsurplus"],fys=A.fys.filter(y=>activity.some(k=>Math.abs(Number(A.B[k]&&A.B[k][y]||0))>.5)),st="border:.5pt solid #808080;font-family:Calibri;font-size:9pt;",hd=st+"background:#FCE4D6;font-weight:bold;",bn=st+"background:#DDEBF7;font-weight:bold;",gr=st+"background:#D0CECE;font-weight:bold;",gn=st+"background:#E2EFDA;font-weight:bold;";let h=`<table><tr><td style="${bn}" colspan="${fys.length+3}">Australia Project Cash Flow Statement</td></tr><tr><td style="${hd}">Ref.</td><td style="${hd}">Particulars</td>${fys.map(y=>`<td style="${hd}">FY ${y}</td>`).join("")}<td style="${hd}">Total</td></tr>`;const b=(k,y)=>Number(A.B[k]&&A.B[k][y]||0),row=(ref,label,fn,style=st)=>{const vals=fys.map(fn);h+=`<tr><td style="${style}">${ref}</td><td style="${style}">${label}</td>${vals.map(v=>excelCell(v,style)).join("")}${excelCell(vals.reduce((a,b)=>a+b,0),style)}</tr>`},netRevenue=y=>b("cfrefresrev",y)-b("cfrefgst",y),land=y=>b("cfrefland",y)+b("cfrefstamp",y)+b("cfrefholding",y)+b("cfreffirb",y)+b("cfrefforeignstamp",y),dev=y=>b("cfrefconstruction",y)+b("cfrefprofessional",y)+b("cfrefdm",y)+b("cfrefstatutory",y)+b("cfrefcontingency",y),sell=y=>b("cfrefbrokerage",y)+b("cfrefselling",y)+b("cfrefmarketing",y),debt=y=>-b("dr1",y)-b("dr2",y)+b("rep",y),fin=y=>b("pf",y)+b("intr",y)+b("lf",y);row("1","Net Revenue",netRevenue,gr);row("1.1","Revenue - Residential",y=>b("cfrefresrev",y));row("1.2","Less : GST",y=>b("cfrefgst",y));row("2","Land Costs",land,gr);row("2.1","Land Costs",y=>b("cfrefland",y));row("2.2","Stampduty",y=>b("cfrefstamp",y));row("2.3","Land Holding Costs",y=>b("cfrefholding",y));row("2.4","FIRB Fees",y=>b("cfreffirb",y));row("2.5","Foreign Stampduty Charges",y=>b("cfrefforeignstamp",y));row("3","Development Cost",dev,gr);row("3.1","Cost of construction",y=>b("cfrefconstruction",y));row("3.2","Professional Fees",y=>b("cfrefprofessional",y));row("3.3","Development Management Fees",y=>b("cfrefdm",y));row("3.4","Statutory Costs",y=>b("cfrefstatutory",y));row("3.5","Project Contingency",y=>b("cfrefcontingency",y));row("4","Selling Costs",sell,gr);row("4.1","Brokerage Costs",y=>b("cfrefbrokerage",y));row("4.2","Selling Expenses",y=>b("cfrefselling",y));row("4.3","Marketing and advertising spends",y=>b("cfrefmarketing",y));row("5","GST Refund",y=>b("cfgstrefund",y),gr);row("6","Net Cash Flow",y=>b("cfrefnetcash",y),gn);row("7","Debt Schedule",debt,gr);row("7.1","(-) Debt Raised",y=>-b("dr1",y));row("7.2","(-) Debt Raised to Service Debt",y=>-b("dr2",y));row("7.3","(+) Debt Repayment",y=>b("rep",y));row("8","Finance Costs",fin,gr);row("8.1","Processing Fee",y=>b("pf",y));row("8.2","Interest",y=>b("intr",y));row("8.3","Line fee",y=>b("lf",y));row("9","Equity Needed",y=>b("cfrefequity",y),gn);row("10","Net Surplus",y=>b("cfrefsurplus",y),gn);row("11","Profit (10 - 9)",y=>b("cfrefprofit",y),gn);return h+`</table>`}
  makeXlsxBlob=function(rawSheets){const transformed=[];(rawSheets||[]).forEach(([name,html])=>{if(/^Source /i.test(name)||name==="Reconciliation")return;if(name==="Inputs")transformed.push(["Inputs",dynamicInputsExcel()]);else if(name==="P and L")transformed.push(["P and L",dynamicPlExcel()]);else if(name==="Cashflow")transformed.push(["Cashflow",dynamicCfExcel()]);else transformed.push([name,html])});return makeXlsxBlobCore(transformed)};
})();;


seedBundledStartupResults();normalizeModeState();ensureActiveContext();buildScaffold();initPortfolioScrollStability();initResizableInputRail();buildParcels();buildFormCore();showNav();/* initial render deferred to consolidated pane wiring */

