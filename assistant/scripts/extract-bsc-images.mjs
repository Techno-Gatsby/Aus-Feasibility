import fs from "node:fs";
import path from "node:path";

const pdf = path.resolve(
  "../assistant-runtime/uploads",
  "1787222885134-JLL IM - Bruce Street Collective_ Crows Nest.pdf"
);
const outDir = path.resolve("../assistant-runtime/output/media");
fs.mkdirSync(outDir, { recursive: true });

const buf = fs.readFileSync(pdf);

function jpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const found = [];
for (let i = 0; i < buf.length - 3; i++) {
  if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
    for (let j = i + 3; j < buf.length - 1; j++) {
      if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
        const slice = buf.subarray(i, j + 2);
        const dim = jpegSize(slice);
        if (dim && dim.w > 400 && dim.h > 300) found.push({ start: i, slice, ...dim });
        i = j + 1;
        break;
      }
    }
  }
}

found.forEach((f, n) => {
  const file = path.join(outDir, `bsc-${String(n).padStart(2, "0")}-${f.w}x${f.h}.jpg`);
  fs.writeFileSync(file, f.slice);
  console.log(`${path.basename(file)}  ${f.w}x${f.h}  ${(f.slice.length / 1024).toFixed(0)}KB  offset ${f.start}`);
});
console.log(`total ${found.length}`);
