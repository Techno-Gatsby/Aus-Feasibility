/** Dependency-free .xlsx writer.
 *
 *  An .xlsx file is an OPC package: a ZIP container of XML parts. Node has
 *  zlib built in, so the whole thing can be written here without pulling in
 *  a spreadsheet library — we emit the XML parts, deflate each one, and lay
 *  out the local headers, central directory and end-of-central-directory
 *  record by hand.
 *
 *  The rule that matters more than any of the plumbing: NUMBERS ARE WRITTEN
 *  AS NUMBERS. A figure goes into the file as `<v>11400000</v>` with a
 *  number format attached, never as the string "$11.4m". A finance team will
 *  sum, pivot and re-format this workbook; text that merely looks like money
 *  makes all three impossible and is the commonest way a good export is
 *  ruined.
 *
 *  This complements app/api/export/route.ts, which emits SpreadsheetML 2003
 *  (.xls). That format stays — it is auditable plain text. This is the
 *  modern binary one Excel prefers.
 */

import { deflateRawSync } from 'zlib';

/* ------------------------------------------------------------------ types */

/** Named formats, so callers never have to think about style indices. */
export type CellStyle =
  | 'default'
  | 'header'    // column heading: bold, reversed out of dark blue
  | 'band'      // section band inside a statement: bold on grey
  | 'label'     // left-aligned text
  | 'currency'  // #,##0 with negatives red in brackets
  | 'currency2' // #,##0.00
  | 'number'    // #,##0
  | 'decimal'   // 0.00  (ratios, multiples)
  | 'percent'   // 0.00%  — the VALUE must be a fraction, 0.065 not 6.5
  | 'total'     // bold currency with a rule above
  | 'totalText' // bold text with a rule above
  | 'note';     // italic footnote

export type CellValue = number | string | boolean | null | undefined;
export type Cell = CellValue | { v: CellValue; s?: CellStyle; merge?: number };
export type Column = { header?: string; width?: number };

export type SheetSpec = {
  name: string;
  rows: Cell[][];
  columns?: Column[];
  /** Rows/columns to keep on screen while scrolling. */
  freeze?: { rows?: number; cols?: number };
};

export type WorkbookMeta = { title?: string; creator?: string; company?: string };

/* -------------------------------------------------------------- xml basics */

/** XML 1.0 forbids most control characters outright — a stray one is the
 *  difference between a workbook and Excel's repair prompt. */
const stripCtrl = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

export const xmlEsc = (v: unknown): string =>
  stripCtrl(String(v ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/* ------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time. Zero is legal but some tools render 1980-00-00
 *  and complain, so write the real clock. */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

type ZipEntry = { name: string; data: Uint8Array };

/** Build the ZIP container. Each part is deflated (method 8); if deflate
 *  fails to shrink a part, it is stored (method 0) instead — both are valid
 *  and the reader picks the method out of the header, so this can never
 *  produce a file that only half-decompresses. */
function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const { date, time } = dosDateTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    if (/[^\x20-\x7e]/.test(e.name)) throw new Error(`zip entry name must be ASCII: ${e.name}`);
    const raw = e.data;
    const crc = crc32(raw);

    let method = 8;
    let body: Uint8Array = new Uint8Array(deflateRawSync(Buffer.from(raw), { level: 9 }));
    if (body.length >= raw.length) { method = 0; body = raw; }

    const local = bytes([
      [4, 0x04034b50], [2, 20], [2, 0], [2, method], [2, time], [2, date],
      [4, crc], [4, body.length], [4, raw.length], [2, nameBytes.length], [2, 0],
    ]);
    locals.push(concat([local, nameBytes, body]));

    const central = bytes([
      [4, 0x02014b50], [2, 20], [2, 20], [2, 0], [2, method], [2, time], [2, date],
      [4, crc], [4, body.length], [4, raw.length],
      [2, nameBytes.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, offset],
    ]);
    centrals.push(concat([central, nameBytes]));

    offset += local.length + nameBytes.length + body.length;
  }

  const dir = concat(centrals);
  const end = bytes([
    [4, 0x06054b50], [2, 0], [2, 0],
    [2, entries.length], [2, entries.length],
    [4, dir.length], [4, offset], [2, 0],
  ]);
  return concat([...locals, dir, end]);
}

/** Little-endian field packer: [byteWidth, value][]. */
function bytes(fields: [number, number][]): Uint8Array {
  const out = new Uint8Array(fields.reduce((a, f) => a + f[0], 0));
  let p = 0;
  for (const [size, value] of fields)
    for (let i = 0; i < size; i++) out[p++] = (value >>> (8 * i)) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/* ---------------------------------------------------------------- styles */

/** cellXfs indices, in the order they are written into styles.xml below.
 *  Anything referenced by a `<c s="…">` must exist here or Excel repairs. */
const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0, header: 1, band: 2, label: 3, currency: 4, currency2: 5,
  number: 6, decimal: 7, percent: 8, total: 9, totalText: 10, note: 11,
};

const STYLES_XML =
  `${DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="3">` +
  `<numFmt numFmtId="164" formatCode="#,##0;[Red](#,##0)"/>` +
  `<numFmt numFmtId="165" formatCode="#,##0.00;[Red](#,##0.00)"/>` +
  `<numFmt numFmtId="166" formatCode="0.00%"/>` +
  `</numFmts>` +
  `<fonts count="4">` +
  `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  // fills 0 and 1 are reserved by the format: none, then gray125.
  `<fills count="4">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEDF1F7"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="3">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FFD7DDE5"/></bottom><diagonal/></border>` +
  `<border><left/><right/><top style="thin"><color rgb="FF9AA8BC"/></top><bottom/><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="12">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
  `<xf numFmtId="164" fontId="2" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` +
  `<xf numFmtId="49" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2"/>` +
  `</styleSheet>`;

/* ------------------------------------------------------------- worksheets */

/** 1 -> A, 27 -> AA. */
export function columnName(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel bans : \ / ? * [ ] in sheet names, caps them at 31 characters and
 *  treats them case-insensitively — two sheets called "Inputs" and "inputs"
 *  is a corrupt workbook, so collisions get a numeric suffix. */
function uniqueNames(specs: SheetSpec[]): string[] {
  const used = new Set<string>();
  return specs.map((s, i) => {
    const base =
      String(s.name ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) ||
      `Sheet ${i + 1}`;
    let name = base;
    let k = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` ${k++}`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function normalise(cell: Cell): { v: CellValue; s: CellStyle; merge: number } {
  if (cell !== null && typeof cell === 'object' && 'v' in (cell as any)) {
    const c = cell as { v: CellValue; s?: CellStyle; merge?: number };
    return { v: c.v, s: c.s ?? autoStyle(c.v), merge: Math.max(1, c.merge ?? 1) };
  }
  return { v: cell as CellValue, s: autoStyle(cell as CellValue), merge: 1 };
}

const autoStyle = (v: CellValue): CellStyle =>
  typeof v === 'number' ? 'currency' : 'label';

function sheetXml(spec: SheetSpec): string {
  const rows = spec.rows ?? [];
  const widths: number[] = [];
  const merges: string[] = [];
  let maxCol = 1;

  const xmlRows = rows.map((row, r) => {
    let col = 1;
    let cells = '';
    for (const raw of row ?? []) {
      const { v, s, merge } = normalise(raw);
      const ref = `${columnName(col)}${r + 1}`;
      const style = STYLE_INDEX[s] ?? 0;

      if (v === null || v === undefined || v === '') {
        if (style) cells += `<c r="${ref}" s="${style}"/>`;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        cells += `<c r="${ref}" s="${style}"><v>${numText(v)}</v></c>`;
      } else if (typeof v === 'boolean') {
        cells += `<c r="${ref}" s="${style}" t="b"><v>${v ? 1 : 0}</v></c>`;
      } else {
        // inline strings: no shared-string table to keep in step with the cells
        cells += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }

      const width = typeof v === 'number' ? String(Math.round(v)).length + 6 : String(v ?? '').length + 2;
      if (merge === 1) widths[col - 1] = Math.max(widths[col - 1] ?? 0, Math.min(52, width));
      if (merge > 1) merges.push(`${ref}:${columnName(col + merge - 1)}${r + 1}`);

      col += merge;
      maxCol = Math.max(maxCol, col - 1);
    }
    return `<row r="${r + 1}">${cells}</row>`;
  });

  const cols = Array.from({ length: maxCol }, (_, i) => {
    const explicit = spec.columns?.[i]?.width;
    const w = explicit ?? Math.max(9, Math.min(52, widths[i] ?? 10));
    return `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`;
  }).join('');

  const fr = spec.freeze?.rows ?? 0;
  const fc = spec.freeze?.cols ?? 0;
  const pane =
    fr || fc
      ? `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${columnName(fc + 1)}${fr + 1}" activePane="bottomRight" state="frozen"/>` +
        `<selection pane="bottomRight" activeCell="${columnName(fc + 1)}${fr + 1}" sqref="${columnName(fc + 1)}${fr + 1}"/>`
      : '';

  // element order below is fixed by the schema: dimension, sheetViews,
  // sheetFormatPr, cols, sheetData, mergeCells, pageMargins.
  return (
    `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${columnName(maxCol)}${Math.max(1, rows.length)}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${xmlRows.join('')}</sheetData>` +
    (merges.length
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '') +
    `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>` +
    `</worksheet>`
  );
}

/** Excel reads plain decimal notation only — 1e21 in a <v> is not a number
 *  to it, and NaN/Infinity are not numbers to anyone. */
function numText(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const rounded = Math.abs(v) < 1e15 ? Math.round(v * 1e6) / 1e6 : v;
  const s = String(rounded);
  return s.includes('e') || s.includes('E') ? rounded.toFixed(10).replace(/\.?0+$/, '') : s;
}

/* ------------------------------------------------------------- the package */

export function buildXlsx(specs: SheetSpec[], meta: WorkbookMeta = {}): Uint8Array {
  const sheets = specs.length ? specs : [{ name: 'Sheet 1', rows: [] as Cell[][] }];
  const names = uniqueNames(sheets);
  const now = new Date();

  const contentTypes =
    `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map((_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('') +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;

  const rootRels =
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;

  const workbook =
    `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>` +
    `<sheets>${names
      .map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets>` +
    `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
    `</workbook>`;

  const wbRels =
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    names
      .map((_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const core =
    `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlEsc(meta.title ?? 'Land feasibility')}</dc:title>` +
    `<dc:creator>${xmlEsc(meta.creator ?? 'Land Feasibility')}</dc:creator>` +
    `<cp:lastModifiedBy>${xmlEsc(meta.creator ?? 'Land Feasibility')}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString()}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now.toISOString()}</dcterms:modified>` +
    `</cp:coreProperties>`;

  const app =
    `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Land Feasibility</Application>` +
    `<Company>${xmlEsc(meta.company ?? '')}</Company>` +
    `<TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">` +
    names.map((n) => `<vt:lpstr>${xmlEsc(n)}</vt:lpstr>`).join('') +
    `</vt:vector></TitlesOfParts>` +
    `</Properties>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: utf8(sheetXml({ ...s, name: names[i] })),
    })),
    { name: 'docProps/core.xml', data: utf8(core) },
    { name: 'docProps/app.xml', data: utf8(app) },
  ];

  return zip(entries, now);
}

/* ------------------------------------------------- convenience for callers */

export const cell = (v: CellValue, s: CellStyle, merge = 1): Cell => ({ v, s, merge });
export const money = (v: number | null | undefined): Cell =>
  ({ v: typeof v === 'number' && isFinite(v) ? v : null, s: 'currency' });
export const ratio = (v: number | null | undefined): Cell =>
  ({ v: typeof v === 'number' && isFinite(v) ? v : null, s: 'decimal' });
export const pct = (v: number | null | undefined): Cell =>
  ({ v: typeof v === 'number' && isFinite(v) ? v : null, s: 'percent' });
