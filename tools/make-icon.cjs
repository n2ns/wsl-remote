// Generates resources/icon.png (128x128) without image libraries: a dark blue rounded square with
// three light bars. Run with `node tools/make-icon.cjs`.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const W = 128;
const H = 128;
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable.push(c >>> 0);
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const inside = (x, y) => {
  const r = 22;
  const cx = Math.min(Math.max(x, r), W - 1 - r);
  const cy = Math.min(Math.max(y, r), H - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const rows = [];
for (let y = 0; y < H; y++) {
  const row = [0];
  for (let x = 0; x < W; x++) {
    let px = [0, 0, 0, 0];
    if (inside(x, y)) {
      px = [0x1f, 0x4e, 0x79, 255];
      const bar = (y >= 40 && y < 50 && x >= 28 && x < 100) || (y >= 60 && y < 70 && x >= 28 && x < 84) || (y >= 80 && y < 90 && x >= 28 && x < 92);
      if (bar) px = [0xe8, 0xf1, 0xf8, 255];
    }
    row.push(...px);
  }
  rows.push(Buffer.from(row));
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'resources', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
