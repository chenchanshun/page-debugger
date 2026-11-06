// Code-drawn debug chevrons, exported at native Windows icon sizes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
function segmentDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
}
function png(size) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let count = 0, r = 0, g = 0, b = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / size * 32, py = (y + (sy + .5) / 4) / size * 32;
      const cx = Math.max(7, Math.min(25, px)), cy = Math.max(7, Math.min(25, py));
      if (Math.hypot(px - cx, py - cy) > 6) continue;
      const white = [[12, 10, 6.5, 16], [6.5, 16, 12, 22], [20, 10, 25.5, 16], [25.5, 16, 20, 22], [18, 8, 14, 24]]
        .some(line => segmentDistance(px, py, ...line) <= 1.25);
      r += white ? 255 : 45; g += white ? 255 : 105; b += white ? 255 : 230; count++;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (count) { bytes[offset] = r / count; bytes[offset + 1] = g / count; bytes[offset + 2] = b / count; bytes[offset + 3] = count / 16 * 255; }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
const directory = path.join(__dirname, '..', 'src', 'assets'); fs.mkdirSync(directory, { recursive: true });
const sizes = [16, 32, 48, 256]; const images = sizes.map(png);
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((image, index) => {
  const entry = Buffer.alloc(16); entry[0] = sizes[index] % 256; entry[1] = sizes[index] % 256;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(image.length, 8); entry.writeUInt32LE(offset, 12);
  offset += image.length; return entry;
});
fs.writeFileSync(path.join(directory, 'app.ico'), Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(path.join(directory, 'app.png'), images[3]);
