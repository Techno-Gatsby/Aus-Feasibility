/* Minimal ZIP reader - enough for .xlsx, no dependencies.
   Reads the central directory, then inflates only the members asked for, so a
   20 MB workbook costs one buffer read plus the sheets actually wanted. */
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

export function openZip(buf) {
  let eo = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eo = i; break; }
  }
  if (eo < 0) throw new Error("not a zip: no end-of-central-directory record");
  let n = buf.readUInt16LE(eo + 10);
  let p = buf.readUInt32LE(eo + 16);
  const entries = new Map();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error("bad central directory entry at " + p);
    const method = buf.readUInt16LE(p + 10);
    const csize  = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extLen  = buf.readUInt16LE(p + 30);
    const cmtLen  = buf.readUInt16LE(p + 32);
    const offset  = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, offset });
    p += 46 + nameLen + extLen + cmtLen;
  }
  return {
    names: () => [...entries.keys()],
    /* Sizes in the local header can be zeroed when a data descriptor is used,
       so the compressed size always comes from the central directory. */
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error("not in zip: " + name);
      if (buf.readUInt32LE(e.offset) !== LOC) throw new Error("bad local header: " + name);
      const nameLen = buf.readUInt16LE(e.offset + 26);
      const extLen  = buf.readUInt16LE(e.offset + 28);
      const start = e.offset + 30 + nameLen + extLen;
      const raw = buf.subarray(start, start + e.csize);
      return e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    },
  };
}
