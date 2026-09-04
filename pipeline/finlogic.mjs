/* Every financing input the engine actually reads, per parcel, next to what the
   facility then does. Written for the walkthrough of how each project is funded:
   the inputs alone do not tell you whether a lever binds, so the computed side
   (peak debt, interest, fees, equity) is printed beside them. */
import { loadApp } from "./reconcile.mjs";

const KEYS = ["ltc","facmode","facilityfixed","fundingmode","equitypc","equityfixed",
  "rate","facstart","procf","linef","linefbasis","drawshare","drawphasecount",
  "intconv","relmode","relpc","relsalespc","revolver","fundi","capfin",
  "intres","intresout","finland","findd","finhoriz","finvert","fincapex","finsell",
  "escrow","depo","mincash","cashfungible","distmode","financefixed"];

const FILE = process.argv[2] || undefined;
const M = loadApp(FILE);
const sum = (a) => a.reduce((x,y)=>x+y,0);
for (const p of M.parcels) {
  const d = M.derive(p.inputs);
  const R = M.run(d);
  const raw = p.inputs;
  console.log("\n=== " + p.name);
  console.log("  set explicitly on the parcel: " + KEYS.filter(k=>k in raw).map(k=>k+"="+raw[k]).join("  "));
  console.log("  effective: " + KEYS.map(k=>k+"="+d[k]).join("  "));
  console.log("  -> peak debt " + Math.round(R.peakdebt).toLocaleString()
    + " | interest " + Math.round(sum(R.R.intr)).toLocaleString()
    + " | estab fee " + Math.round(sum(R.R.pf)).toLocaleString()
    + " | line fee " + Math.round(sum(R.R.lf)).toLocaleString()
    + " | finance total " + Math.round(R.finTot).toLocaleString());
  console.log("  -> equity injected " + Math.round(R.cashEquityInjected).toLocaleString()
    + " | equity peak " + Math.round(R.epeak).toLocaleString()
    + " | eq IRR " + (R.eirr*100).toFixed(2) + "%"
    + " | facility limit " + Math.round(Math.max(...R.R.lcl)).toLocaleString());
}
