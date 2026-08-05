/**
 * Build the macOS app icon from a source mark.
 *
 * electron-builder turns `apps/desktop/build/icon.png` into the .icns at package
 * time, but it wants a 1024px square and it does not do the shaping: on macOS the
 * rounded-rect body and the margin around it are part of the artwork, not the OS.
 * Apple's grid puts an 824px body on a 1024px canvas, corner radius ~22.4% of the
 * body. A full-bleed square reads as unfinished next to every other Mac icon.
 *
 * Usage: node scripts/make-icon.mjs <source.png> <out.png> [zoom]
 *
 * `zoom` (default 1) scales the artwork before clipping, then centre-crops. Use it
 * when the source carries its own margin: Apple's inset then stacks on top of that
 * margin and the mark ends up small in the dock. 1.2 is a reasonable nudge; the
 * flat ground means nothing is lost by cropping into it.
 *
 * Handles 8-bit RGBA (colour type 6) non-interlaced PNGs, which is what our source
 * is. It rejects anything else loudly rather than writing a wrong-looking icon.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const CANVAS = 1024;
const BODY = 824;
const RADIUS = BODY * 0.2237;
/** Mask samples per axis. 4 is enough to keep the corner curve smooth at 1024. */
const SUPERSAMPLE = 4;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  const idat = [];
  let header;
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString('latin1');
    if (type === 'IHDR') {
      header = {
        width: buf.readUInt32BE(o + 8),
        height: buf.readUInt32BE(o + 12),
        bitDepth: buf[o + 16],
        colorType: buf[o + 17],
        interlace: buf[o + 20],
      };
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(o + 8, o + 8 + len));
    }
    o += 12 + len;
  }
  if (!header) throw new Error('no IHDR');
  const { width, height, bitDepth, colorType, interlace } = header;
  // 6 is RGBA, 2 is RGB — a flat export with no transparency, which is what a
  // "save as PNG" from most design tools gives you. Both are worth accepting;
  // palette and grayscale are not, and say so rather than writing a wrong icon.
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    throw new Error(`need an 8-bit RGB or RGBA non-interlaced PNG, got bitDepth ${bitDepth} colorType ${colorType} interlace ${interlace}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let val = line[x];
      if (filter === 1) val += a;
      else if (filter === 2) val += b;
      else if (filter === 3) val += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
      cur[x] = val & 0xff;
    }
  }
  if (bpp === 4) return { width, height, data: out };

  // Widen RGB to RGBA so everything downstream works in one layout.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i];
    rgba[j + 1] = out[i + 1];
    rgba[j + 2] = out[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

function encodePng(width, height, data) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none. The mask makes rows poorly predictable anyway.
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bilinear, because the source is smaller than the body and nearest would alias the brush edge. */
function resize(src, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = src.width / size;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(src.height - 1, (y + 0.5) * scale - 0.5);
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(src.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = Math.min(src.width - 1, (x + 0.5) * scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(src.width - 1, x0 + 1), fx = sx - x0;
      for (let ch = 0; ch < 4; ch++) {
        const p = (yy, xx) => src.data[(yy * src.width + xx) * 4 + ch];
        const top = p(y0, x0) * (1 - fx) + p(y0, x1) * fx;
        const bottom = p(y1, x0) * (1 - fx) + p(y1, x1) * fx;
        out[(y * size + x) * 4 + ch] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width: size, height: size, data: out };
}

/** Coverage of the rounded rect at a canvas pixel, supersampled so the curve stays smooth. */
function coverage(px, py, left, top, right, bottom) {
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    const y = py + (sy + 0.5) / SUPERSAMPLE;
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const x = px + (sx + 0.5) / SUPERSAMPLE;
      if (x < left || x > right || y < top || y > bottom) continue;
      // Outside the corner boxes the rect is solid; inside, test against the arc.
      const cx = x < left + RADIUS ? left + RADIUS : x > right - RADIUS ? right - RADIUS : x;
      const cy = y < top + RADIUS ? top + RADIUS : y > bottom - RADIUS ? bottom - RADIUS : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2) hits++;
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

const [, , sourcePath, outPath, zoomArg] = process.argv;
if (!sourcePath || !outPath) {
  console.error('usage: node scripts/make-icon.mjs <source.png> <out.png> [zoom]');
  process.exit(1);
}
const zoom = Number(zoomArg ?? 1);
if (!Number.isFinite(zoom) || zoom < 1) {
  console.error(`zoom must be a number >= 1, got ${zoomArg}`);
  process.exit(1);
}

const source = decodePng(readFileSync(sourcePath));
if (source.width !== source.height) {
  console.warn(`warning: source is ${source.width}x${source.height}, not square — it will be squashed to fit`);
}
if (source.width < BODY) {
  console.warn(`warning: source is ${source.width}px, upscaled to ${BODY}px. Supply a 1024px original for a crisp icon.`);
}

const scaled = resize(source, Math.round(BODY * zoom));
// Centre-crop back to the body size. At zoom 1 the offset is 0 and this is a no-op.
const crop = Math.round((scaled.width - BODY) / 2);
const canvas = Buffer.alloc(CANVAS * CANVAS * 4); // transparent
const inset = (CANVAS - BODY) / 2;
for (let y = 0; y < BODY; y++) {
  for (let x = 0; x < BODY; x++) {
    const alpha = coverage(x, y, 0, 0, BODY, BODY);
    if (alpha === 0) continue;
    const s = ((y + crop) * scaled.width + (x + crop)) * 4;
    const d = ((y + inset) * CANVAS + (x + inset)) * 4;
    canvas[d] = scaled.data[s];
    canvas[d + 1] = scaled.data[s + 1];
    canvas[d + 2] = scaled.data[s + 2];
    canvas[d + 3] = Math.round(scaled.data[s + 3] * alpha);
  }
}

writeFileSync(outPath, encodePng(CANVAS, CANVAS, canvas));
console.log(`wrote ${outPath} — ${CANVAS}px canvas, ${BODY}px body, radius ${RADIUS.toFixed(1)}`);
