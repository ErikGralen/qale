/**
 * Build the Windows app icon (.ico) from the same source mark as the Mac one.
 *
 * Why this exists at all: electron-builder wants `apps/desktop/build/icon.ico`
 * for a Windows build, and if it cannot find one it falls back to deriving an
 * .ico from `build/icon.png`. That fallback is silent and it produces the wrong
 * artwork, because icon.png is not the mark: it is the mark already shaped for
 * macOS by make-icon.mjs, an 824px body centred on a 1024px canvas with rounded
 * corners and 100px of transparent margin baked in. macOS needs that, because on
 * macOS the rounded-rect body is artwork rather than OS chrome. Windows does the
 * opposite: it masks nothing and insets nothing, so shipping the Mac PNG means
 * every taskbar button, alt-tab card and title bar shows a small rounded stamp
 * floating inside a box of empty space, visibly smaller than every neighbouring
 * icon. So Windows gets its own file, built full-bleed straight from the source.
 *
 * Usage: node scripts/make-ico.mjs <source.png> <out.ico>
 *
 * What goes in the file.
 *
 * An .ico is a directory of independent images, and Windows picks the entry
 * closest to the size it needs. Shipping only a 256 and letting the shell scale
 * is what makes a taskbar icon look muddy: the shell's downscale is a cheap one
 * and it runs on every draw. SIZES below covers the sizes Windows actually asks
 * for (16 taskbar/title bar, 24 and 32 explorer and alt-tab, 48 the medium
 * explorer view, 64/128/256 large icons, jump lists and the Start tile), each
 * resampled properly once, here, at build time.
 *
 * Why the entries are not all PNG.
 *
 * An .ico entry can hold either a PNG file verbatim or an uncompressed DIB
 * (BITMAPINFOHEADER + bottom-up BGRA + a 1-bit AND mask). PNG entries are the
 * modern shape and are far smaller, but PNG-in-ICO only became legal in Vista,
 * and the compatibility story below 256px is still patchy across the pile of
 * code that will read this file: makensis rewriting the installer's icon
 * resource, resedit stamping the icon into Qale.exe, and whatever renders a
 * shortcut. The convention Windows itself follows in shell32.dll, and that every
 * icon editor emits, is DIB for the small sizes and PNG only for 256, where the
 * uncompressed form would be a gratuitous 256 KB. That is what this writes. The
 * cost is about 90 KB of DIB in a committed file; the benefit is that no reader
 * in that chain gets a format it might not handle.
 *
 * Downscaling.
 *
 * Every size is area-averaged from the full 1024px source rather than stepped
 * down through the previous size, so no rounding error accumulates, and never by
 * nearest-neighbour, which at 1024 -> 16 would sample 4 pixels out of every 4096
 * and turn a brush-drawn mark into noise. See resizeArea in ./png.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { decodePng, encodePng, resizeArea } from './png.mjs';

/**
 * Sizes Windows asks for. 16/24/32/48 are the shell's standard set, 64/128 keep
 * the intermediate DPI scalings (125%, 150%, 200% of a 32px slot) from being
 * interpolated at draw time, and 256 is both the large-icon view and the minimum
 * electron-builder enforces on a supplied .ico.
 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
/** Below this, an entry is written as an uncompressed DIB. See the header comment. */
const PNG_FROM = 256;

/**
 * Encode one image as the DIB variant of an .ico entry.
 *
 * Three details here are the ones that get this wrong:
 *  - biHeight is doubled. The header describes the colour bitmap and the AND
 *    mask stacked into one image, so it claims twice the real height. Readers
 *    that trust biHeight literally show a squashed icon; readers that halve it
 *    (Windows, resedit) are correct.
 *  - rows are bottom-up, the DIB default, and the pixel order is BGRA not RGBA.
 *  - the AND mask is still required even at 32bpp, where the alpha channel is
 *    what actually gets used. Windows ignores it in every modern path, but it
 *    has to be present and correctly sized or the entry is malformed. We derive
 *    it from alpha anyway so the icon still has a sane silhouette if something
 *    old enough to only read the mask ever renders it.
 */
function encodeDib({ width, height, data }) {
  const xorStride = width * 4;
  // 1 bit per pixel, each row padded out to a 4-byte boundary.
  const maskStride = Math.ceil(width / 32) * 4;
  const xorSize = xorStride * height;
  const maskSize = maskStride * height;

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(width, 4); // biWidth
  header.writeInt32LE(height * 2, 8); // biHeight: colour rows + mask rows
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(xorSize + maskSize, 20); // biSizeImage
  // Pixels-per-metre and the palette counts are meaningless for a 32bpp icon
  // and stay zero; every reader recomputes the geometry from width/height.

  const xor = Buffer.alloc(xorSize);
  const mask = Buffer.alloc(maskSize);
  for (let y = 0; y < height; y++) {
    const srcRow = y * xorStride;
    const dstRow = (height - 1 - y) * xorStride; // bottom-up
    const maskRow = (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      xor[d] = data[s + 2]; // B
      xor[d + 1] = data[s + 1]; // G
      xor[d + 2] = data[s]; // R
      xor[d + 3] = data[s + 3]; // A
      // Set bit = "transparent" in the legacy mask. Half alpha has to fall on
      // one side or the other; opaque is the safer guess for a solid mark.
      if (data[s + 3] < 128) mask[maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, mask]);
}

const [, , sourcePath, outPath] = process.argv;
if (!sourcePath || !outPath) {
  console.error('usage: node scripts/make-ico.mjs <source.png> <out.ico>');
  process.exit(1);
}

const source = decodePng(readFileSync(sourcePath));
if (source.width !== source.height) {
  console.warn(`warning: source is ${source.width}x${source.height}, not square, so Windows will show it stretched`);
}
const largest = SIZES[SIZES.length - 1];
if (source.width < largest) {
  // resizeArea refuses to upscale, so this is fatal rather than ugly. Say why
  // before it throws, because "resizeArea only downscales" on its own is cryptic.
  console.error(`source is ${source.width}px but the icon needs a ${largest}px entry. Supply a ${largest}px (ideally 1024px) original.`);
  process.exit(1);
}

const entries = SIZES.map((size) => {
  const image = size === source.width ? source : resizeArea(source, size);
  const body = size >= PNG_FROM ? encodePng(size, size, image.data) : encodeDib(image);
  return { size, body, isPng: size >= PNG_FROM };
});

// ICONDIR: 2 bytes reserved (0), 2 bytes type (1 = icon), 2 bytes count. Then
// one 16-byte ICONDIRENTRY per image, then the image bodies back to back.
const dir = Buffer.alloc(6 + entries.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(entries.length, 4);

let offset = dir.length;
entries.forEach((entry, i) => {
  const o = 6 + i * 16;
  // Width and height are single bytes, so 256 has to be written as 0. Getting
  // this wrong is how a 256 entry ends up invisible: it reads back as 0x0.
  dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o);
  dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, o + 1);
  dir.writeUInt8(0, o + 2); // colours in palette: 0 for true colour
  dir.writeUInt8(0, o + 3); // reserved
  dir.writeUInt16LE(1, o + 4); // colour planes
  dir.writeUInt16LE(32, o + 6); // bits per pixel
  dir.writeUInt32LE(entry.body.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += entry.body.length;
});

const ico = Buffer.concat([dir, ...entries.map((e) => e.body)]);
writeFileSync(outPath, ico);
const summary = entries.map((e) => `${e.size}${e.isPng ? 'png' : 'dib'}`).join(' ');
console.log(`wrote ${outPath}: ${(ico.length / 1024).toFixed(0)} KB, ${entries.length} entries: ${summary}`);
