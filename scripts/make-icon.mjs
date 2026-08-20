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
 * The PNG decode/encode/resample lives in ./png.mjs, shared with make-ico.mjs.
 * Windows is deliberately NOT this shape: see that script for why it is full-bleed.
 *
 * Handles 8-bit RGBA (colour type 6) non-interlaced PNGs, which is what our source
 * is. It rejects anything else loudly rather than writing a wrong-looking icon.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { decodePng, encodePng, resizeBilinear } from './png.mjs';

const CANVAS = 1024;
const BODY = 824;
const RADIUS = BODY * 0.2237;
/** Mask samples per axis. 4 is enough to keep the corner curve smooth at 1024. */
const SUPERSAMPLE = 4;

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

const scaled = resizeBilinear(source, Math.round(BODY * zoom));
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
