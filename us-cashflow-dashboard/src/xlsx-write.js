// Minimal .xlsx writer. No dependencies; runs in the browser and in Node 18+.
//   XLSXWrite.build({sheets: [{name, rows, cols, freeze, filter}], active}) -> Promise<Uint8Array>
//     rows    rows[i][j] is the cell at row i+1, column j+1: null, a number, a string, or
//             {v, f, s, inline}: f a formula (no '='), v its value as last calculated (number or
//             string; '' for a blank result), s a style, inline to write the string in the cell
//             rather than in the shared-strings table. A styled cell without v or f stays blank.
//     style   {b, i, sz, color, fill, fmt, wrap, ha, va}: bold, italic, size, font and fill colour
//             ('RRGGBB'), number format (code, or a built-in id), wrap text, alignment.
//     cols    column widths in characters (null = default)
//     freeze  {rows, cols}: rows above and columns left of the split stay in view
//     filter  'A2:K90': an autofilter over that range (header row first)
// Excel recalculates every formula when it opens the file.
(function (root) {
  'use strict';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tx = (s) => '<t' + (/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '') + '>' + esc(s) + '</t>';
  function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  const num = (v) => (typeof v === 'number' && isFinite(v) ? String(v) : null);

  // ---- shared strings and styles, collected while the sheets are written ----
  function strings() {
    const list = [], ids = new Map(); let count = 0;
    return {
      id(s) { count++; let i = ids.get(s); if (i == null) { i = list.length; ids.set(s, i); list.push(s); } return i; },
      xml: () => HEAD + '<sst xmlns="' + NS + '" count="' + count + '" uniqueCount="' + list.length + '">' + list.map((s) => '<si>' + tx(s) + '</si>').join('') + '</sst>',
    };
  }
  function styles() {
    const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const fmts = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], ids = new Map();
    const idx = (list, x) => { let i = list.indexOf(x); if (i < 0) { i = list.length; list.push(x); } return i; };
    const font = (s) => idx(fonts, '<font>' + (s.b ? '<b/>' : '') + (s.i ? '<i/>' : '') + '<sz val="' + (s.sz || 11) + '"/>'
      + (s.color ? '<color rgb="FF' + s.color + '"/>' : '') + '<name val="Calibri"/><family val="2"/></font>');
    font({});
    return {
      id(s) {
        if (!s) return 0;
        const k = JSON.stringify(s); let n = ids.get(k);
        if (n != null) return n;
        const fo = font(s);
        const fi = s.fill ? idx(fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + s.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
        const nf = s.fmt == null ? 0 : typeof s.fmt === 'number' ? s.fmt : 164 + idx(fmts, s.fmt);
        const al = s.wrap || s.ha || s.va ? '<alignment' + (s.ha ? ' horizontal="' + s.ha + '"' : '') + (s.va ? ' vertical="' + s.va + '"' : '') + (s.wrap ? ' wrapText="1"' : '') + '/>' : '';
        n = xfs.length; ids.set(k, n);
        xfs.push('<xf numFmtId="' + nf + '" fontId="' + fo + '" fillId="' + fi + '" borderId="0" xfId="0"' + (nf ? ' applyNumberFormat="1"' : '')
          + (fo ? ' applyFont="1"' : '') + (fi ? ' applyFill="1"' : '') + (al ? ' applyAlignment="1">' + al + '</xf>' : '/>'));
        return n;
      },
      xml: () => HEAD + '<styleSheet xmlns="' + NS + '">'
        + (fmts.length ? '<numFmts count="' + fmts.length + '">' + fmts.map((f, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(f) + '"/>').join('') + '</numFmts>' : '')
        + '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>'
        + '<fills count="' + fills.length + '">' + fills.join('') + '</fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>',
    };
  }

  // ---- one worksheet ----
  function cellXml(ref, c, sst, st) {
    const o = c !== null && typeof c === 'object' ? c : { v: c };
    const s = st.id(o.s), sa = s ? ' s="' + s + '"' : '', v = o.v;
    if (o.f != null && o.f !== '') {
      const f = '<f>' + esc(String(o.f).replace(/^=/, '')) + '</f>';
      if (typeof v === 'string') return '<c r="' + ref + '"' + sa + ' t="str">' + f + '<v>' + esc(v) + '</v></c>';
      const n = num(v);
      return '<c r="' + ref + '"' + sa + '>' + f + (n == null ? '' : '<v>' + n + '</v>') + '</c>';
    }
    if (typeof v === 'number') { const n = num(v); return n == null ? (s ? '<c r="' + ref + '"' + sa + '/>' : '') : '<c r="' + ref + '"' + sa + '><v>' + n + '</v></c>'; }
    if (typeof v === 'boolean') return '<c r="' + ref + '"' + sa + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>';
    if (v == null || v === '') return s ? '<c r="' + ref + '"' + sa + '/>' : '';
    if (o.inline) return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is>' + tx(String(v)) + '</is></c>';
    return '<c r="' + ref + '"' + sa + ' t="s"><v>' + sst.id(String(v)) + '</v></c>';
  }
  function sheetXml(sh, sst, st, selected) {
    const rows = []; let maxR = 1, maxC = 1;
    (sh.rows || []).forEach((row, i) => {
      if (!row) return;
      let cs = '';
      row.forEach((c, j) => { if (c == null) return; const x = cellXml(colName(j + 1) + (i + 1), c, sst, st); if (x) { cs += x; if (j + 1 > maxC) maxC = j + 1; } });
      if (cs) { rows.push('<row r="' + (i + 1) + '">' + cs + '</row>'); maxR = i + 1; }
    });
    const fr = (sh.freeze && sh.freeze.rows) || 0, fc = (sh.freeze && sh.freeze.cols) || 0;
    let pane = '';
    if (fr || fc) {
      const ap = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight', tl = colName(fc + 1) + (fr + 1);
      pane = '<pane' + (fc ? ' xSplit="' + fc + '"' : '') + (fr ? ' ySplit="' + fr + '"' : '') + ' topLeftCell="' + tl + '" activePane="' + ap + '" state="frozen"/>'
        + '<selection pane="' + ap + '" activeCell="' + tl + '" sqref="' + tl + '"/>';
    }
    const cols = (sh.cols || []).map((w, j) => (w ? '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>' : '')).join('');
    return HEAD + '<worksheet xmlns="' + NS + '" xmlns:r="' + RNS + '">'
      + '<dimension ref="A1:' + colName(maxC) + maxR + '"/>'
      + '<sheetViews><sheetView' + (selected ? ' tabSelected="1"' : '') + ' workbookViewId="0">' + pane + '</sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>' + (cols ? '<cols>' + cols + '</cols>' : '')
      + '<sheetData>' + rows.join('') + '</sheetData>'
      + (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '')
      + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  // ---- zip (deflated when the platform can, else stored) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
    catch (e) { return null; }
  }
  async function zip(files) {
    const enc = new TextEncoder(), out = [], dir = [], d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), raw = f.data, crc = crc32(raw);
      let body = await deflate(raw), method = 8;
      if (!body || body.length >= raw.length) { body = raw; method = 0; }
      const h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      [[0, 0x04034b50, 4], [4, 20, 2], [8, method, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, body.length, 4], [22, raw.length, 4], [26, name.length, 2]]
        .forEach(([p, v, n]) => (n === 4 ? h.setUint32(p, v, true) : h.setUint16(p, v, true)));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [10, method, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, body.length, 4], [24, raw.length, 4], [28, name.length, 2], [42, off, 4]]
        .forEach(([p, v, n]) => (n === 4 ? c.setUint32(p, v, true) : c.setUint16(p, v, true)));
      out.push(new Uint8Array(h.buffer), name, body); dir.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + body.length;
    }
    const size = dir.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    const parts = out.concat(dir, [new Uint8Array(e.buffer)]), all = new Uint8Array(off + size + 22);
    let p = 0; parts.forEach((u) => { all.set(u, p); p += u.length; });
    return all;
  }

  // ---- the workbook ----
  // Sheet names: at most 31 characters, none of []:*?/\ and unique.
  function sheetNames(list) {
    const seen = new Set();
    return list.map((n, i) => {
      let s = String(n || 'Sheet' + (i + 1)).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1), k = 2;
      while (seen.has(s.toLowerCase())) s = s.slice(0, 27) + ' (' + k++ + ')';
      seen.add(s.toLowerCase()); return s;
    });
  }
  async function build(book) {
    const sst = strings(), st = styles(), list = book.sheets || [], active = book.active || 0;
    const names = sheetNames(list.map((s) => s.name));
    const xml = list.map((sh, i) => sheetXml(sh, sst, st, i === active));
    const quote = (n) => "'" + n.replace(/'/g, "''") + "'";
    const filters = list.map((sh, i) => (sh.filter ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">'
      + esc(quote(names[i]) + '!' + sh.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')) + '</definedName>' : '')).join('');
    const n = list.length;
    const files = [
      ['[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + xml.map((x, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
      ['_rels/.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="' + RNS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', HEAD + '<workbook xmlns="' + NS + '" xmlns:r="' + RNS + '">'
        + '<bookViews><workbookView activeTab="' + active + '"/></bookViews><sheets>'
        + names.map((nm, i) => '<sheet name="' + esc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
        + (filters ? '<definedNames>' + filters + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
      ['xl/_rels/workbook.xml.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + names.map((x, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + RNS + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
        + '<Relationship Id="rId' + (n + 1) + '" Type="' + RNS + '/styles" Target="styles.xml"/>'
        + '<Relationship Id="rId' + (n + 2) + '" Type="' + RNS + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
      ['xl/styles.xml', st.xml()],
      ['xl/sharedStrings.xml', sst.xml()],
    ].concat(xml.map((x, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', x]));
    const enc = new TextEncoder();
    return zip(files.map(([name, s]) => ({ name, data: enc.encode(s) })));
  }

  root.XLSXWrite = { build, colName, MIME };
})(typeof window !== 'undefined' ? window : globalThis);
