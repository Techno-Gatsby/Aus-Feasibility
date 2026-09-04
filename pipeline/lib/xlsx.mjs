/* SpreadsheetML reader: sheets by NAME, columns by HEADER TEXT.
   Column letters are never used as identifiers - the same field sits at AX in the
   ASGS workbook and AU in the National one, because the LGA sheet carries fewer
   leading geography columns. Anything keyed on position silently reads the wrong
   column when Cotality changes the layout. */
import { readFileSync } from "node:fs";
import { openZip } from "./zip.mjs";

const unescapeXml = (s) => s.indexOf("&") < 0 ? s : s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&");

const colToNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const numToCol = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

/* Shared formulas carry their text once, on the master cell of the range; every
   other cell holds only the si that points back at it. A monthly cashflow row is
   one shared formula across fifty-odd columns, so without translating the master
   by each cell's row and column offset the whole grid reads blank. Quoted
   segments are stepped over so a sheet name never gets shifted like a reference. */
const shiftFormula = (text, dRow, dCol) => text.replace(
  /"[^"]*"|'[^']*'|(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g,
  (m, absCol, col, absRow, row) => {
    if (col === undefined) return m;
    return (absCol || "") + (absCol ? col : numToCol(colToNum(col) + dCol))
         + (absRow || "") + (absRow ? row : String(Number(row) + dRow));
  });

export function openWorkbook(file) {
  const zip = openZip(readFileSync(file));
  const wb = zip.read("xl/workbook.xml").toString("utf8");
  const rels = zip.read("xl/_rels/workbook.xml.rels").toString("utf8");

  const relTarget = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) relTarget.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) if (!relTarget.has(m[2])) relTarget.set(m[2], m[1]);

  const sheets = new Map();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = (m[0].match(/name="([^"]*)"/) || [])[1];
    const rid  = (m[0].match(/r:id="([^"]*)"/) || [])[1];
    if (name && rid && relTarget.has(rid)) {
      sheets.set(unescapeXml(name), "xl/" + relTarget.get(rid).replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  let shared = null;
  const sharedStrings = () => {
    if (shared) return shared;
    shared = [];
    if (!zip.names().includes("xl/sharedStrings.xml")) return shared;
    const xml = zip.read("xl/sharedStrings.xml").toString("utf8");
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = "";
      for (const m of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
      shared.push(unescapeXml(t));
    }
    return shared;
  };

  return {
    sheetNames: () => [...sheets.keys()],
    /* Returns { header:[...], rows:[ {header->value} ] }. Values stay strings;
       callers coerce, because "" and "0" mean different things here. */
    sheet(name) {
      const part = sheets.get(name);
      if (!part) throw new Error(`no sheet "${name}" in ${file} (have: ${[...sheets.keys()].join(", ")})`);
      const S = sharedStrings();
      const xml = zip.read(part).toString("utf8");

      const cellValue = (c) => {
        const type = (c.match(/\bt="([^"]+)"/) || [])[1];
        if (type === "inlineStr") {
          let t = ""; for (const m of c.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
          return unescapeXml(t);
        }
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v == null) return "";
        return type === "s" ? (S[+v] ?? "") : unescapeXml(v);
      };
      const colOf = (c) => {
        const r = (c.match(/\br="([A-Z]+)\d+"/) || [])[1];
        if (!r) return null;
        let n = 0; for (const ch of r) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
      };

      let header = null; const rows = [];
      for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const cm of rm[1].matchAll(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g)) {
          const i = colOf(cm[0]);
          if (i != null) cells[i] = cellValue(cm[0]);
        }
        if (!header) { header = cells.map((h) => (h || "").trim()); continue; }
        const o = {};
        for (let i = 0; i < header.length; i++) if (header[i]) o[header[i]] = cells[i] ?? "";
        rows.push(o);
      }
      return { header: header || [], rows };
    },

    /* Raw grid, addressed the way a spreadsheet is: get("B7") or get(7,"B").
       The header-based sheet() above assumes row 1 is a header row - true of the
       Cotality exports, false of nearly every hand-built feasibility workbook,
       which carry title rows, merged banners and several tables stacked on one
       sheet. Reconciling against those needs cells, not columns. */
    rawSheet(name) {
      const part = sheets.get(name);
      if (!part) throw new Error(`no sheet "${name}" in ${file} (have: ${[...sheets.keys()].join(", ")})`);
      const S = sharedStrings();
      const xml = zip.read(part).toString("utf8");

      const cells = new Map();
      const pendingF = new Map();   /* ref -> {text, si} before shared refs resolve */
      const masters = new Map();    /* si  -> {ref, text} */
      let maxRow = 0;
      for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        for (const cm of rm[1].matchAll(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g)) {
          const ref = (cm[0].match(/\br="([A-Z]+\d+)"/) || [])[1];
          if (!ref) continue;
          const r0 = +ref.replace(/[A-Z]+/, "");
          if (r0 > maxRow) maxRow = r0;
          /* Capture the formula before the value guards below: a cell can carry
             logic with no cached <v>, and that is exactly the cell worth reading
             when the question is what the sheet computes rather than what it
             last showed. */
          const fm = cm[0].match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
          if (fm) {
            const attrs = fm[1] || "", text = fm[2] == null ? "" : unescapeXml(fm[2]);
            const si = (attrs.match(/\bsi="(\d+)"/) || [])[1];
            pendingF.set(ref, { text, si });
            if (si != null && text && /\bt="shared"/.test(attrs)) masters.set(si, { ref, text });
          }
          const type = (cm[0].match(/\bt="([^"]+)"/) || [])[1];
          let v;
          if (type === "inlineStr") {
            v = ""; for (const t of cm[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += t[1];
            v = unescapeXml(v);
          } else {
            const raw = (cm[0].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
            if (raw == null) continue;
            v = type === "s" ? (S[+raw] ?? "") : unescapeXml(raw);
          }
          if (v === "") continue;
          cells.set(ref, v);
        }
      }
      const formulas = new Map();
      for (const [ref, info] of pendingF) {
        if (info.text) { formulas.set(ref, info.text); continue; }
        const m = info.si != null ? masters.get(info.si) : null;
        if (!m) continue;
        const [, mc, mr] = m.ref.match(/([A-Z]+)(\d+)/);
        const [, sc, sr] = ref.match(/([A-Z]+)(\d+)/);
        formulas.set(ref, shiftFormula(m.text, +sr - +mr, colToNum(sc) - colToNum(mc)));
      }
      const get = (a, b) => cells.get(b === undefined ? String(a) : String(b) + a) ?? "";
      /* Tolerates the separators and symbols people type into feasibility sheets.
         Returns null rather than NaN so blank and zero stay distinguishable. */
      const num = (...a) => {
        const v = String(get(...a)).replace(/[$,\s]/g, "");
        if (v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      /* Key a reconciliation on label text rather than a cell address, which
         shifts the moment anyone inserts a row. */
      const find = (needle, opts) => {
        const o = opts || {}, limit = o.limit || 1;
        const want = String(needle).toLowerCase(), hits = [];
        for (const [ref, v] of cells) {
          if (o.col && ref.replace(/\d+/, "") !== o.col) continue;
          if (String(v).toLowerCase().includes(want)) {
            hits.push({ ref, col: ref.replace(/\d+/, ""), row: +ref.replace(/[A-Z]+/, ""), value: v });
            if (hits.length >= limit) break;
          }
        }
        return limit === 1 ? (hits[0] || null) : hits;
      };
      const f = (a, b) => formulas.get(b === undefined ? String(a) : String(b) + a) ?? "";
      /* These sheets put the driver rate beside its label and the dollar result
         after it - Beckett's "Marketing & Brokerage fee" is C25, 0.03, 1302276.
         The rate is the only one of the three that compares to a model input, so
         it is worth addressing directly rather than dividing back out of totals. */
      const rate = (ref, span = 4) => {
        const m = String(ref).match(/([A-Z]+)(\d+)/);
        if (!m) return null;
        for (let i = 1; i <= span; i++) {
          const v = num(numToCol(colToNum(m[1]) + i) + m[2]);
          if (v != null && v !== 0 && Math.abs(v) <= 1) return v;
        }
        return null;
      };
      return { get, num, find, cells, maxRow, f, formulas, rate };
    },
  };
}
