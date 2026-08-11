// Generates the app icons an installable app needs, without an image toolchain.
//
// The FightIQ mark is three axis-aligned rectangles, so it rasterises exactly
// rather than approximately, and a hand-rolled PNG writer is less machinery
// than a dependency that has to be kept alive.
//
//   node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const INK = [0x08, 0x10, 0x1a];
const BLUE = [0x26, 0x8c, 0xff];
// From public/favicon.svg, on its 64 unit grid: stem, top bar, middle bar.
const GLYPH = [[19, 16, 29, 58], [19, 16, 48, 25], [29, 33, 44, 42]];

function png(size, { maskable }) {
  // A maskable icon is cropped to a circle by the platform, so the mark lives
  // inside the safe zone rather than filling the tile.
  const scale = (maskable ? 0.52 : 0.72) * size / 64;
  const offset = (size - 64 * scale) / 2;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const gx = (x - offset) / scale;
      const gy = (y - offset) / scale;
      const on = GLYPH.some(([x0, y0, x1, y1]) => gx >= x0 && gx < x1 && gy >= y0 && gy < y1);
      const [r, g, b] = on ? BLUE : INK;
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buffer) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

for (const [name, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true]]) {
  writeFileSync(`public/${name}`, png(size, { maskable }));
  console.log(`public/${name}`);
}
