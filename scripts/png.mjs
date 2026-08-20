/**
 * A minimal PNG codec, shared by the two icon builders.
 *
 * This used to live inside scripts/make-icon.mjs. It moved out the day a second
 * builder appeared (scripts/make-ico.mjs, for Windows), because the alternative
 * was a second hand-rolled copy of the same 130 lines of filter reconstruction
 * and CRC table, and two copies of a decoder is two places for the same subtle
 * bug to be fixed once.
 *
 * Everything here is `node:zlib` plus arithmetic on purpose. Adding sharp or
 * jimp to build an icon would pull a native binary (or a megabyte of pure-JS
 * codec) into the toolchain for a file that changes about once a year, and the
 * install-script approval list in pnpm-workspace.yaml is deliberately short.
 *
 * Scope is what our own source art actually is: 8-bit, non-interlaced, colour
 * type 6 (RGBA) or 2 (RGB). Anything else throws loudly rather than quietly
 * writing a wrong-looking icon, which is the failure we care about: a silently
 * mangled icon looks like a design problem, not a build problem, and gets
 * debugged in the wrong place for an hour.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decode a PNG to `{ width, height, data }` where data is tightly packed RGBA. */
export function decodePng(buf) {
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
  // 6 is RGBA, 2 is RGB, a flat export with no transparency, which is what a
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

/** Encode tightly packed RGBA as an 8-bit colour-type-6 PNG. */
export function encodePng(width, height, data) {
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
export function resizeBilinear(src, size) {
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

/**
 * Area-average ("box") downscale, with fractional coverage at the edges of each
 * destination pixel so a non-integer ratio does not visibly wobble.
 *
 * Bilinear is the wrong tool going down: it reads a 2x2 neighbourhood no matter
 * how far it is shrinking, so 1024 -> 16 samples 4 of the 4096 source pixels
 * that fall in the destination pixel and throws the rest away. On a brush-drawn
 * mark that lands as a broken, sparkly 16px icon, which is exactly the size
 * Windows shows most often (taskbar, alt-tab, title bar). Averaging the whole
 * footprint is the minimum honest answer, and at these ratios it is close to
 * what a good resampler would give anyway.
 *
 * Colour is averaged in premultiplied alpha. Straight-alpha averaging lets the
 * RGB of fully transparent pixels bleed into the result, which shows up as a
 * dark or white halo around a soft edge. Our current source is fully opaque so
 * this is a no-op today, but the halo is the classic bug here and it is one
 * multiply to not have it.
 *
 * Refuses to upscale: that would silently give blocky nearest-neighbour output.
 */
export function resizeArea(src, size) {
  if (size > src.width || size > src.height) {
    throw new Error(`resizeArea only downscales, asked for ${size} from ${src.width}x${src.height}`);
  }
  const out = Buffer.alloc(size * size * 4);
  const sxScale = src.width / size;
  const syScale = src.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * syScale, y1 = (y + 1) * syScale;
    const yStart = Math.floor(y0), yEnd = Math.min(src.height, Math.ceil(y1));
    for (let x = 0; x < size; x++) {
      const x0 = x * sxScale, x1 = (x + 1) * sxScale;
      const xStart = Math.floor(x0), xEnd = Math.min(src.width, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (let sy = yStart; sy < yEnd; sy++) {
        // How much of this source row falls inside the destination pixel.
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = xStart; sx < xEnd; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * src.width + sx) * 4;
          const alpha = src.data[i + 3];
          const wa = w * (alpha / 255);
          r += src.data[i] * wa;
          g += src.data[i + 1] * wa;
          b += src.data[i + 2] * wa;
          a += alpha * w;
          total += w;
        }
      }
      const o = (y * size + x) * 4;
      const outAlpha = a / total;
      if (outAlpha <= 0) continue; // leave the pixel fully transparent black
      // Undo the premultiply. The divisor is the summed weight times the mean
      // alpha, which is the total premultiplied weight the colours carry.
      const scale = total * (outAlpha / 255);
      out[o] = Math.min(255, Math.round(r / scale));
      out[o + 1] = Math.min(255, Math.round(g / scale));
      out[o + 2] = Math.min(255, Math.round(b / scale));
      out[o + 3] = Math.round(outAlpha);
    }
  }
  return { width: size, height: size, data: out };
}
