/* Runs the per-line monthly comparison for each project whose workbook uses the
   grouped Monthly CF template. */
import {loadApp} from "./reconcile.mjs";
import {compareLines} from "./lineflow.mjs";
const M=loadApp();
export const JOBS=[
 {name:"BECKETT",  parcel:/Beckett/, wb:"Individual BPs/10. Beckett Road submitted DA.xlsx", sheet:"Monthly CF", dateRow:2, from:"D", to:"AI", wbIrr:0.2855},
 {name:"MENIN",    parcel:/Menin/,   wb:"Individual BPs/11. Menin Road working file.xlsx",   sheet:"Monthly CF", dateRow:2, from:"E", to:"AI", wbIrr:0.2971},
];
export function runJob(j,inputs){
  const p=inputs?{inputs}:M.parcels.find(x=>j.parcel.test(x.name));
  const d=M.derive(p.inputs), R=M.run(d);
  const o=compareLines({workbook:j.wb,sheet:j.sheet,dateRow:j.dateRow,firstCol:j.from,lastCol:j.to,R:R.R,d});
  return {o,R};
}
export function report(j,inputs){
  const {o,R}=runJob(j,inputs);
  console.log("\n=== "+j.name+"   "+o.periods+" periods  "+o.from+" -> "+o.to);
  console.log("line                        workbook          app         diff       %   first gap    shape");
  let ok=0,n=0;
  for(const r of o.results){
    if(r.missing){console.log("  "+r.item.padEnd(26)+"(row not found)");continue}
    n++; if(r.within1pc)ok++;
    console.log("  "+r.item.padEnd(26)+Math.round(r.wbTotal).toLocaleString().padStart(13)+Math.round(r.appTotal).toLocaleString().padStart(13)
     +Math.round(r.appTotal-r.wbTotal).toLocaleString().padStart(13)+(r.pct==null?" n/a":(r.pct>=0?"+":"")+r.pct.toFixed(1)).padStart(8)
     +String(r.firstDivergentDate||"-").padStart(12)+"  "+(r.within1pc?"":"<< ")+r.shape);
  }
  console.log("  --- "+ok+" of "+n+" lines within 1%   eirr app "+(R.eirr==null?"n/a":(R.eirr*100).toFixed(2)+"%")+"  workbook "+(j.wbIrr*100).toFixed(2)+"%");
  return {ok,n,R};
}
if(process.argv[1]&&process.argv[1].endsWith("lfrun.mjs")) for(const j of JOBS) report(j);

export const HENDRA={name:"HENDRA", parcel:/Hendra/, wb:"Individual BPs/Project -8 (Self equity - Hendra).xlsx",
  sheet:"Monthly CF - lots", dateRow:2, from:"D", to:"BZ", wbIrr:0.39153915};
