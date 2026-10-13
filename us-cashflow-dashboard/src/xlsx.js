// Minimal .xlsx reader. No dependencies; runs in the browser and in Node 18+
// (both have DecompressionStream). Reads the values Excel saved with the file, so a
// workbook must be saved after recalculating. Sheets are parsed only when asked for.
(function (root) {
  'use strict';

  async function inflateRaw(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Central-directory walk; returns name -> async () => Uint8Array.
  function zipEntries(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not an .xlsx file (no zip directory found)');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const td = new TextDecoder(), files = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = async () => {
        const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), s = off + 30 + lnl + lxl;
        const data = u8.subarray(s, s + csize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error('unsupported zip compression method ' + method);
      };
      p += 46 + nl + xl + cl;
    }
    return files;
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unxml = (s) => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, k) =>
    k[0] === '#' ? String.fromCodePoint(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : +k.slice(1)) : (ENT[k] != null ? ENT[k] : m));
  const attr = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? unxml(m[1]) : null; };
  const texts = (xml) => { let out = ''; xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, t) => { out += unxml(t); return m; }); return out; };

  function colNum(ref) { let n = 0; for (let i = 0; i < ref.length; i++) { const c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n; }
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  // Excel 1900 date system serial -> 'YYYY-MM-DD'.
  function serialToISO(v) {
    if (typeof v !== 'number' || !isFinite(v) || v < 1) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }

  // A shared formula's text moved from its master cell by (dr, dc): relative references
  // shift, $-anchored parts and quoted text stay.
  const REF = /('[^']*'|"[^"]*")|(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g;
  const shiftFormula = (f, dr, dc) => (!dr && !dc ? f : f.replace(REF, (m, q, a, col, b, row) =>
    q ? q : a + (a ? col : colName(colNum(col) + dc)) + b + (b ? row : +row + dr)));

  function parseSheet(name, xml, shared) {
    const rows = {}, formulas = {}, sharedF = {};
    let maxRow = 0, maxCol = 0, uncached = 0, errors = 0;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let rm, lastRow = 0;
    while ((rm = rowRe.exec(xml))) {
      const r = +(attr(rm[1], 'r') || lastRow + 1); lastRow = r;
      if (!rm[2]) continue;
      const cells = {};
      let cm, lastCol = 0, any = false;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[2]))) {
        const ref = attr(cm[1], 'r'), c = ref ? colNum(ref) : lastCol + 1; lastCol = c;
        const body = cm[2] || '';
        const t = attr(cm[1], 't');
        // Formula text; a shared formula's followers carry only its index, so shift the master's text.
        const fm = body.indexOf('<f') >= 0 && body.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
        if (fm) {
          const si = attr(fm[1], 'si');
          let ft = fm[2] ? unxml(fm[2]) : null;
          if (si != null) {
            const m = sharedF[si];
            if (ft) sharedF[si] = { t: ft, r, c }; else ft = m ? shiftFormula(m.t, r - m.r, c - m.c) : null;
          }
          (formulas[r] = formulas[r] || {})[c] = ft || '';
        }
        // <v>1</v>, <v xml:space="preserve"> x</v>, or <v/> for a formula that returned "".
        const vm = body.match(/<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/);
        let v = null;
        if (t === 'inlineStr') { const im = body.match(/<is>([\s\S]*?)<\/is>/); v = im ? texts(im[1]) : null; }
        else if (vm) {
          const raw = vm[1] == null ? '' : vm[1];
          if (raw === '') v = null;
          else if (t === 's') v = shared[+raw];
          else if (t === 'str') v = unxml(raw);
          else if (t === 'b') v = raw === '1';
          else if (t === 'e') { v = null; errors++; }
          else { v = Number(raw); if (!isFinite(v)) v = null; }
        } else if (/<f\b/.test(body)) uncached++;
        if (v === null || v === '') continue;
        cells[c] = v; any = true;
        if (c > maxCol) maxCol = c;
      }
      if (any) { rows[r] = cells; if (r > maxRow) maxRow = r; }
    }
    return {
      name, rows, maxRow, maxCol, uncached, errors,
      get(r, c) { const row = rows[r]; return row ? (row[c] === undefined ? null : row[c]) : null; },
      // The cell's formula ('' when it has one we could not read), or null for a typed value.
      formula(r, c) { const row = formulas[r]; return row && row[c] !== undefined ? row[c] : null; },
      row(r) { return rows[r] || {}; },
      rowNums() { return Object.keys(rows).map(Number).sort((a, b) => a - b); },
    };
  }

  async function open(buf) {
    const files = zipEntries(buf);
    const td = new TextDecoder();
    const text = async (p) => (files[p] ? td.decode(await files[p]()) : null);
    const wbx = await text('xl/workbook.xml');
    if (!wbx) throw new Error('not an Excel workbook (xl/workbook.xml missing)');
    const rels = (await text('xl/_rels/workbook.xml.rels')) || '';
    const target = {};
    rels.replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => { target[attr(a, 'Id')] = attr(a, 'Target'); return m; });
    const sheets = [];
    wbx.replace(/<sheet\b([^>]*)\/?>/g, (m, a) => {
      const rid = attr(a, 'r:id') || (a.match(/\s[\w]+:id="([^"]*)"/) || [])[1];
      let p = target[rid] || '';
      p = p.startsWith('/') ? p.slice(1) : 'xl/' + p.replace(/^\.\//, '');
      sheets.push({ name: attr(a, 'name'), path: p, state: attr(a, 'state') || 'visible' });
      return m;
    });
    let shared = null;
    const loadShared = async () => {
      if (shared) return shared;
      shared = [];
      const sx = await text('xl/sharedStrings.xml');
      if (sx) sx.replace(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, (m, inner) => { shared.push(inner ? texts(inner) : ''); return m; });
      return shared;
    };
    const cache = {};
    return {
      sheetNames: sheets.map((s) => s.name),
      has(name) { return sheets.some((s) => s.name === name); },
      async sheet(name) {
        if (cache[name]) return cache[name];
        const s = sheets.find((x) => x.name === name);
        if (!s) return null;
        const xml = await text(s.path);
        if (xml == null) return null;
        return (cache[name] = parseSheet(name, xml, await loadShared()));
      },
    };
  }

  root.XLSXLite = { open, colNum, colName, serialToISO };
})(typeof window !== 'undefined' ? window : globalThis);
