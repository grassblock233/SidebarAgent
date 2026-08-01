import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function inRoundedSquare(x, y, size) {
  const inset = size * 0.06;
  const radius = size * 0.2;
  const left = inset;
  const right = size - inset;
  const top = inset;
  const bottom = size - inset;
  if (x >= left + radius && x <= right - radius) return y >= top && y <= bottom;
  if (y >= top + radius && y <= bottom - radius) return x >= left && x <= right;
  const centerX = x < size / 2 ? left + radius : right - radius;
  const centerY = y < size / 2 ? top + radius : bottom - radius;
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function inLetterA(x, y, size) {
  const center = size * 0.5;
  const top = size * 0.24;
  const bottom = size * 0.76;
  if (y < top || y > bottom) return false;

  const progress = (y - top) / (bottom - top);
  const halfWidth = size * (0.04 + progress * 0.2);
  const stroke = size * 0.085;
  const distanceFromCenter = Math.abs(x - center);
  const legs = Math.abs(distanceFromCenter - halfWidth) <= stroke / 2;
  const crossbar = y >= size * 0.52 && y <= size * 0.59 && distanceFromCenter <= halfWidth;
  return legs || crossbar;
}

function makePng(size) {
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * rowBytes + 1 + x * 4;
      const background = inRoundedSquare(x + 0.5, y + 0.5, size);
      const letter = background && inLetterA(x + 0.5, y + 0.5, size);
      const color = letter ? [255, 255, 255, 255] : background ? [21, 95, 80, 255] : [0, 0, 0, 0];
      raw.set(color, offset);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const assetsDirectory = path.resolve("assets");
fs.mkdirSync(assetsDirectory, { recursive: true });
for (const size of sizes) {
  fs.writeFileSync(path.join(assetsDirectory, `icon-${size}.png`), makePng(size));
}
console.log(`Generated ${sizes.length} icons in ${assetsDirectory}`);
