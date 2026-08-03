// Generates the Play Store graphics from the app's own brand geometry.
//
// No image library is available here, so this writes PNGs directly: raw pixels →
// zlib deflate → PNG chunks with CRC32. Shapes are evaluated analytically per
// sub-pixel (3×3 supersampling) which gives clean antialiased edges without
// needing a rasteriser.
//
// The bee is transcribed from android/app/src/main/res/drawable/ic_launcher_bee.xml
// so the store icon and the launcher icon are the same mark.

import zlib from "node:zlib";
import fs from "node:fs";

// ── PNG encoding ──────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param channels 3 = RGB (no alpha), 4 = RGBA */
function writePng(path, width, height, pixels, channels) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
  return png.length;
}

// ── geometry helpers (all return true if the point is inside) ─────────────
const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function rotAbout(px, py, cx, cy, deg) {
  const a = (-deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

const inEllipse = (px, py, cx, cy, rx, ry, deg = 0) => {
  const [x, y] = deg ? rotAbout(px, py, cx, cy, deg) : [px, py];
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
};

const inRect = (px, py, x0, y0, w, h) => px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h;

/** Vertical stadium: circles at both ends joined by a rect. */
const inCapsule = (px, py, cx, top, bottom, r) =>
  (px - cx) ** 2 + (py - top) ** 2 <= r * r ||
  (px - cx) ** 2 + (py - bottom) ** 2 <= r * r ||
  inRect(px, py, cx - r, top, r * 2, bottom - top);

/** Half ring — `side` is "top" or "bottom". Used for the U. */
function inHalfRing(px, py, cx, cy, rOuter, rInner, side) {
  const d2 = (px - cx) ** 2 + (py - cy) ** 2;
  if (d2 > rOuter * rOuter || d2 < rInner * rInner) return false;
  return side === "top" ? py <= cy : py >= cy;
}

/**
 * Right half of an elliptical ring — the bowl of a B.
 *
 * A circular ring will not do here: with a bold stroke the counter collapses to
 * a pinhole, and the letter stops reading as a B at all.
 */
function inHalfEllipseRing(px, py, cx, cy, rxO, ryO, rxI, ryI) {
  if (px < cx) return false;
  const outside = ((px - cx) / rxO) ** 2 + ((py - cy) / ryO) ** 2 <= 1;
  if (!outside) return false;
  if (rxI <= 0 || ryI <= 0) return true;
  const insideHole = ((px - cx) / rxI) ** 2 + ((py - cy) / ryI) ** 2 < 1;
  return !insideHole;
}

function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── the bee, transcribed from ic_launcher_bee.xml (108×108 viewport) ──────
// Body capsule: circles r16 at (54,50) and (54,64); stripes at y 46.5 / 57 / 67.5
function beeLayers(orange) {
  return [
    // wings, 45% white, rotated ±38° about their own centres
    { hit: (x, y) => inEllipse(x, y, 32, 31, 13, 7.5, -38), color: [255, 255, 255], alpha: 0.45 },
    { hit: (x, y) => inEllipse(x, y, 76, 31, 13, 7.5, 38), color: [255, 255, 255], alpha: 0.45 },
    // body
    { hit: (x, y) => inCapsule(x, y, 54, 50, 64, 16), color: [255, 255, 255], alpha: 1 },
    // Stripes, painted in the background colour. The vector lets them run wider
    // than the body because it sits on flat orange; here the background carries
    // a honeycomb pattern, so an overhang would rub a notch out of it. Clip
    // each stripe to the body.
    ...[46.5, 57.0, 67.5].map((sy) => ({
      hit: (x, y) => inRect(x, y, 32, sy, 44, 5) && inCapsule(x, y, 54, 50, 64, 16),
      color: orange,
      alpha: 1,
    })),
  ];
}

// ── geometric letterforms — only B, U and Z are needed for "BUZZ BUZZ" ────
function glyph(ch, x0, y0, w, h, t) {
  const parts = [];
  if (ch === "B") {
    const cx = x0 + t / 2;
    const rxO = w - t / 2;
    const ryO = h / 4;
    parts.push((x, y) => inRect(x, y, x0, y0, t, h)); // stem, full height
    parts.push((x, y) => inHalfEllipseRing(x, y, cx, y0 + ryO, rxO, ryO, rxO - t, ryO - t));
    parts.push((x, y) => inHalfEllipseRing(x, y, cx, y0 + h - ryO, rxO, ryO, rxO - t, ryO - t));
  } else if (ch === "U") {
    const r = w / 2;
    parts.push((x, y) => inRect(x, y, x0, y0, t, h - r));
    parts.push((x, y) => inRect(x, y, x0 + w - t, y0, t, h - r));
    parts.push((x, y) => inHalfRing(x, y, x0 + r, y0 + h - r, r, r - t, "bottom"));
  } else if (ch === "Z") {
    parts.push((x, y) => inRect(x, y, x0, y0, w, t));
    parts.push((x, y) => inRect(x, y, x0, y0 + h - t, w, t));
    const s = t * 0.72;
    parts.push((x, y) =>
      inPolygon(x, y, [
        [x0 + w - s, y0 + t],
        [x0 + w, y0 + t],
        [x0 + s, y0 + h - t],
        [x0, y0 + h - t],
      ]),
    );
  }
  return (x, y) => parts.some((p) => p(x, y));
}

function wordLayers(text, x0, y0, h, color) {
  // Lighter than the first attempt: a 0.19 stroke closed up the B's counters.
  const t = h * 0.155;
  const w = h * 0.62;
  const gap = h * 0.17;
  const space = h * 0.34;
  const layers = [];
  let x = x0;
  for (const ch of text) {
    if (ch === " ") {
      x += space;
      continue;
    }
    layers.push({ hit: glyph(ch, x, y0, w, h, t), color, alpha: 1 });
    x += w + gap;
  }
  return { layers, width: x - gap - x0 };
}

// ── renderer ──────────────────────────────────────────────────────────────
function render({ width, height, channels, background, layers, samples = 3 }) {
  const px = Buffer.alloc(width * height * channels);
  const step = 1 / (samples + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 1; sy <= samples; sy++) {
        for (let sx = 1; sx <= samples; sx++) {
          const fx = x + sx * step;
          const fy = y + sy * step;
          let [cr, cg, cb] = background(fx, fy);
          let ca = 1;
          for (const layer of layers) {
            if (!layer.hit(fx, fy)) continue;
            const al = layer.alpha ?? 1;
            // A colour may be a function, so a layer can sample the gradient
            // underneath it — that is how the bee's stripes stay in step with
            // the background instead of being a flat orange band.
            const col = typeof layer.color === "function" ? layer.color(fx, fy) : layer.color;
            cr = cr * (1 - al) + col[0] * al;
            cg = cg * (1 - al) + col[1] * al;
            cb = cb * (1 - al) + col[2] * al;
            ca = ca * (1 - al) + al;
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = samples * samples;
      const i = (y * width + x) * channels;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      if (channels === 4) px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

const ORANGE = rgb("#FF4400");
const ORANGE_DEEP = rgb("#D93400");

// ── 1. app icon, 512×512 ──────────────────────────────────────────────────
{
  const S = 512;
  // Map the 108-unit bee viewport onto the square, scaled up so the mark fills
  // the icon properly (the launcher version is small because of the adaptive
  // safe zone; the store icon has no mask).
  const scale = 4.32;
  const cx = 54, cy = 49;
  const toV = (x, y) => [(x - S / 2) / scale + cx, (y - S / 2) / scale + cy];

  const bee = beeLayers(ORANGE);
  const layers = bee.map((l) => ({
    ...l,
    hit: (x, y) => {
      const [vx, vy] = toV(x, y);
      return l.hit(vx, vy);
    },
  }));

  const px = render({
    width: S,
    height: S,
    channels: 4,
    background: () => ORANGE,
    layers,
  });
  const bytes = writePng("icon-512.png", S, S, px, 4);
  console.log(`  icon-512.png             512×512   ${(bytes / 1024).toFixed(0)} KB  (32-bit RGBA)`);
}

// ── 2. feature graphic, 1024×500 ──────────────────────────────────────────
{
  const W = 1024, H = 500;

  // Honeycomb: faint white hexagon outlines, on-theme without being loud.
  const hexR = 62;
  const hexRow = hexR * Math.sqrt(3);
  function inHoneycomb(x, y) {
    // Find nearest hex centre on a staggered grid, then test the ring.
    const col = Math.round(x / (hexR * 1.5));
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc;
      const cxh = c * hexR * 1.5;
      const cyOffset = c % 2 === 0 ? 0 : hexRow / 2;
      const row = Math.round((y - cyOffset) / hexRow);
      for (let dr = -1; dr <= 1; dr++) {
        const cyh = (row + dr) * hexRow + cyOffset;
        const pts = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          pts.push([cxh + hexR * Math.cos(a), cyh + hexR * Math.sin(a)]);
        }
        const inner = pts.map(([hx, hy]) => [
          cxh + (hx - cxh) * 0.93,
          cyh + (hy - cyh) * 0.93,
        ]);
        if (inPolygon(x, y, pts) && !inPolygon(x, y, inner)) return true;
      }
    }
    return false;
  }

  const scale = 3.6;
  const beeCx = 250, beeCy = H / 2;
  const toV = (x, y) => [(x - beeCx) / scale + 54, (y - beeCy) / scale + 49];

  const bgAt = (x, y) => {
    const t = Math.min(1, Math.max(0, (x / W) * 0.85 + (y / H) * 0.15));
    return [
      Math.round(ORANGE[0] + (ORANGE_DEEP[0] - ORANGE[0]) * t),
      Math.round(ORANGE[1] + (ORANGE_DEEP[1] - ORANGE[1]) * t),
      Math.round(ORANGE[2] + (ORANGE_DEEP[2] - ORANGE[2]) * t),
    ];
  };

  // Stripe layers (index 3+) sample the gradient so they read as cut-outs in
  // the bee rather than as flat orange bars sitting on top of it.
  const bee = beeLayers(null).map((l, i) => ({
    color: i >= 3 ? bgAt : l.color,
    alpha: l.alpha,
    hit: (x, y) => {
      const [vx, vy] = toV(x, y);
      return l.hit(vx, vy);
    },
  }));

  // Size the wordmark to the space right of the bee, then centre it there.
  // Play may crop the edges of a feature graphic, so keep a real margin.
  const MARGIN = 70;
  const textLeft = 415;
  const capH = 78;
  const measured = 6.49 * capH; // 8 letters + 1 space, from the advance formula
  const startX = textLeft + (W - MARGIN - textLeft - measured) / 2;
  const word = wordLayers("BUZZ BUZZ", startX, H / 2 - capH / 2, capH, [255, 255, 255]);

  const rightEdge = startX + word.width;
  if (rightEdge > W - MARGIN) {
    throw new Error(
      `Wordmark overflows: ends at ${rightEdge.toFixed(0)} but the safe edge is ${W - MARGIN}. Reduce capH.`,
    );
  }

  const px = render({
    width: W,
    height: H,
    channels: 3,
    background: bgAt,
    layers: [
      { hit: inHoneycomb, color: [255, 255, 255], alpha: 0.075 },
      ...bee,
      ...word.layers,
    ],
  });

  const bytes = writePng("feature-graphic-1024x500.png", W, H, px, 3);
  console.log(`  feature-graphic-1024x500.png  1024×500   ${(bytes / 1024).toFixed(0)} KB  (24-bit RGB, no alpha)`);
  console.log(`  wordmark width: ${word.width.toFixed(0)}px, ends at x=${(430 + word.width).toFixed(0)} of 1024`);
}
