/** Minimal PDF writer. No dependency: a PDF is a text container with an
 *  offset table, and the subset needed for a financial report is small.
 *
 *  Built fresh rather than porting the legacy 63 KB generator, which is
 *  coupled to the old data shapes. This is driven by lib/statements.ts, so
 *  the PDF, the screen and the workbook all read the same builders and
 *  cannot show different numbers.
 *
 *  Base-14 Helvetica only — no font embedding, so output stays small and
 *  opens everywhere. That limits us to WinAnsi, which is why text is
 *  sanitised rather than assumed safe. */

const W = 842, H = 595;               // A4 landscape, points
const M = 36;                          // margin
const GUTTER = 10;                     // keeps right-aligned columns apart

export type Align = 'l' | 'r';
export type Col = { w: number; align?: Align };

/** WinAnsi has no en dash, curly quotes or the arrows we use on screen.
 *  Substituting is better than emitting bytes the viewer renders as noise. */
function win(s: string) {
  return String(s ?? '')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[▲▼]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}
const esc = (s: string) => win(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Helvetica advance widths, /1000 em. Needed because we right-align money
 *  columns, and guessing the width puts the decimal points out. */
const WIDTHS: Record<string, number> = {};
{
  const base =
    '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,' +
    '556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,' +
    '1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,' +
    '667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,' +
    '333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,' +
    '556,556,333,500,278,556,500,722,500,500,500,334,260,334,584';
  base.split(',').forEach((w, i) => { WIDTHS[String.fromCharCode(32 + i)] = Number(w); });
}
export function textWidth(s: string, size: number, bold = false) {
  let t = 0;
  for (const ch of win(s)) t += WIDTHS[ch] ?? 556;
  return (t / 1000) * size * (bold ? 1.06 : 1);   // Helvetica-Bold runs wider
}

export class Pdf {
  private pages: string[] = [];
  private ops: string[] = [];
  private y = H - M;
  private pageNo = 0;
  private title: string;
  private subtitle: string;

  constructor(title: string, subtitle = '') {
    this.title = title; this.subtitle = subtitle;
    this.newPage();
  }

  private rgb(hex: string) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`;
  }

  /** Right-aligned text stops short of the column edge. Without a gutter a
   *  right-aligned value ends exactly where the next column starts, and the
   *  two run together: "0.0%typical cap 65%". */
  text(s: string, x: number, size = 9, bold = false, colour = '#18181b', align: Align = 'l', width = 0) {
    const gutter = align === 'r' ? GUTTER : 0;
    const w = align === 'r' ? textWidth(s, size, bold) : 0;
    const px = align === 'r' ? x + width - w - gutter : x;
    this.ops.push(
      `BT ${this.rgb(colour)} rg /${bold ? 'FB' : 'FR'} ${size} Tf ` +
      `${px.toFixed(2)} ${this.y.toFixed(2)} Td (${esc(s)}) Tj ET\n`,
    );
  }
  rule(colour = '#d4d4d8', yOff = -3) {
    this.ops.push(
      `${this.rgb(colour)} RG 0.5 w ${M} ${(this.y + yOff).toFixed(2)} m ` +
      `${(W - M).toFixed(2)} ${(this.y + yOff).toFixed(2)} l S\n`,
    );
  }
  band(label: string) {
    this.ensure(20);
    this.ops.push(
      `${this.rgb('#f4f4f5')} rg ${M} ${(this.y - 4).toFixed(2)} ${(W - 2 * M).toFixed(2)} 14 re f\n`,
    );
    this.text(label, M + 4, 7.5, true, '#71717a');
    this.y -= 18;
  }
  move(dy: number) { this.y -= dy; }
  get cursor() { return this.y; }

  ensure(need: number) {
    if (this.y - need < M + 24) this.newPage();
  }

  newPage() {
    if (this.ops.length) this.pages.push(this.ops.join(''));
    this.ops = []; this.y = H - M; this.pageNo++;
    this.text(this.title, M, 13, true);
    if (this.subtitle) {
      const w = textWidth(this.title, 13, true);
      this.text(this.subtitle, M + w + 10, 8.5, false, '#71717a');
    }
    this.y -= 6; this.rule('#18181b'); this.y -= 14;
  }

  /** Table with a fixed column plan. Rows that would split across a page
   *  break cleanly and the header repeats — a statement that loses its
   *  column headings mid-way is unreadable. */
  table(header: string[], cols: Col[], rows: (string | null)[][], kinds: (string | undefined)[] = []) {
    const drawHead = () => {
      let x = M;
      header.forEach((h, i) => {
        this.text(h, x, 7.5, true, '#71717a', cols[i].align ?? 'l', cols[i].w);
        x += cols[i].w;
      });
      this.y -= 4; this.rule('#d4d4d8'); this.y -= 11;
    };
    drawHead();
    rows.forEach((r, ri) => {
      const kind = kinds[ri];
      if (kind === 'band') { this.band(String(r[0] ?? '')); return; }
      if (this.y - 14 < M + 24) { this.newPage(); drawHead(); }
      const bold = kind === 'sub' || kind === 'result';
      if (kind === 'result') {
        this.ops.push(
          `${this.rgb('#fafafa')} rg ${M} ${(this.y - 3).toFixed(2)} ${(W - 2 * M).toFixed(2)} 13 re f\n`,
        );
      }
      let x = M;
      r.forEach((c, i) => {
        if (c != null) this.text(String(c), x, 8, bold, bold ? '#18181b' : '#3f3f46',
                                 cols[i].align ?? 'l', cols[i].w);
        x += cols[i].w;
      });
      this.y -= 13;
    });
    this.y -= 6;
  }

  note(s: string) {
    const max = W - 2 * M;
    const words = win(s).split(/\s+/);
    let line = '';
    this.y -= 4;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (textWidth(test, 7.5) > max) {
        this.ensure(12); this.text(line, M, 7.5, false, '#71717a'); this.y -= 10; line = word;
      } else line = test;
    }
    if (line) { this.ensure(12); this.text(line, M, 7.5, false, '#71717a'); this.y -= 10; }
    this.y -= 4;
  }

  build(): Buffer {
    this.pages.push(this.ops.join(''));
    const objs: string[] = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const kids: string[] = [];
    this.pages.forEach((stream, i) => {
      const po = 5 + i * 2, co = po + 1;
      kids.push(`${po} 0 R`);
      objs[co] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
      objs[po] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /Font << /FR 3 0 R /FB 4 0 R >> >> /Contents ${co} 0 R >>`;
    });
    objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${this.pages.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) {
      if (objs[i] == null) { offsets[i] = 0; continue; }
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++)
      out += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}
