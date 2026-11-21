import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

// ---------------------------------------------------------------- constants

const W = 1024;
const H = 1024;

type RGB = [number, number, number];
type Point = [number, number];
type Stop = { y: number; c: RGB };
type Glyph = { width: number; strokes: Point[][] };

function hex(s: string): RGB {
  return [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ------------------------------------------------------------- pixel buffer

const px = new Uint8Array(W * H * 4);

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = 255;
}

function blend(x: number, y: number, c: RGB, coverage: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const a = clamp(coverage, 0, 1);
  if (a <= 0) return;
  const i = (y * W + x) * 4;
  const inv = 1 - a;
  px[i] = Math.round(px[i] * inv + c[0] * a);
  px[i + 1] = Math.round(px[i + 1] * inv + c[1] * a);
  px[i + 2] = Math.round(px[i + 2] * inv + c[2] * a);
  px[i + 3] = 255;
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha: number = 1): void {
  const xa = clamp(Math.round(x0), 0, W);
  const xb = clamp(Math.round(x1), 0, W);
  const ya = clamp(Math.round(y0), 0, H);
  const yb = clamp(Math.round(y1), 0, H);
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) blend(x, y, c, alpha);
  }
}

function fillGradientV(x0: number, y0: number, x1: number, y1: number, stops: Stop[]): void {
  const xa = clamp(Math.round(x0), 0, W);
  const xb = clamp(Math.round(x1), 0, W);
  const ya = clamp(Math.round(y0), 0, H);
  const yb = clamp(Math.round(y1), 0, H);
  for (let y = ya; y < yb; y++) {
    let c: RGB = stops[0].c;
    if (y >= stops[stops.length - 1].y) {
      c = stops[stops.length - 1].c;
    } else if (y > stops[0].y) {
      for (let s = 0; s + 1 < stops.length; s++) {
        const a = stops[s];
        const b = stops[s + 1];
        if (y >= a.y && y <= b.y) {
          const t = (y - a.y) / (b.y - a.y);
          c = [
            Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
            Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
            Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
          ];
          break;
        }
      }
    }
    for (let x = xa; x < xb; x++) setPx(x, y, c);
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, softness: number, alpha: number = 1): void {
  const reach = r + softness + 1;
  const xa = clamp(Math.floor(cx - reach), 0, W);
  const xb = clamp(Math.ceil(cx + reach), 0, W);
  const ya = clamp(Math.floor(cy - reach), 0, H);
  const yb = clamp(Math.ceil(cy + reach), 0, H);
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      const cov = softness > 0 ? clamp((r - d) / softness + 0.5, 0, 1) : clamp(r - d + 0.5, 0, 1);
      if (cov > 0) blend(x, y, c, cov * alpha);
    }
  }
}

const rowCov = new Float32Array(W);

function polygon(points: Point[], c: RGB, alpha: number = 1): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const ya = clamp(Math.floor(minY), 0, H);
  const yb = clamp(Math.ceil(maxY), 0, H);
  const n = points.length;
  for (let y = ya; y < yb; y++) {
    rowCov.fill(0);
    for (let s = 0; s < 4; s++) {
      const sy = y + (s + 0.5) / 4;
      const xs: number[] = [];
      for (let e = 0; e < n; e++) {
        const a = points[e];
        const b = points[(e + 1) % n];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k];
        const xb = xs[k + 1];
        const ix0 = clamp(Math.floor(xa), 0, W);
        const ix1 = clamp(Math.ceil(xb), 0, W);
        for (let ix = ix0; ix < ix1; ix++) {
          const overlap = Math.min(xb, ix + 1) - Math.max(xa, ix);
          if (overlap > 0) rowCov[ix] += 0.25 * overlap;
        }
      }
    }
    for (let x = 0; x < W; x++) {
      if (rowCov[x] > 0) blend(x, y, c, Math.min(rowCov[x], 1) * alpha);
    }
  }
}

function strokeLine(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, alpha: number = 1): void {
  const hw = width / 2;
  const reach = hw + 1;
  const xa = clamp(Math.floor(Math.min(x0, x1) - reach), 0, W);
  const xb = clamp(Math.ceil(Math.max(x0, x1) + reach), 0, W);
  const ya = clamp(Math.floor(Math.min(y0, y1) - reach), 0, H);
  const yb = clamp(Math.ceil(Math.max(y0, y1) + reach), 0, H);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const pxc = x + 0.5;
      const pyc = y + 0.5;
      const t = len2 > 0 ? clamp(((pxc - x0) * dx + (pyc - y0) * dy) / len2, 0, 1) : 0;
      const d = Math.sqrt((pxc - (x0 + t * dx)) ** 2 + (pyc - (y0 + t * dy)) ** 2);
      const cov = clamp(hw + 0.5 - d, 0, 1);
      if (cov > 0) blend(x, y, c, cov * alpha);
    }
  }
}

// ------------------------------------------------------------------ texture

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function grain(amount: number): void {
  for (let y = 0; y < H; y++) {
    const cellY = y >> 2;
    const a = y >= 780 && y <= 1010 ? Math.round(amount / 3) : amount;
    const span = a * 2 + 1;
    for (let x = 0; x < W; x++) {
      const n = (hash2(x >> 2, cellY) % span) - a;
      const i = (y * W + x) * 4;
      px[i] = clamp(px[i] + n, 0, 255);
      px[i + 1] = clamp(px[i + 1] + n, 0, 255);
      px[i + 2] = clamp(px[i + 2] + n, 0, 255);
    }
  }
}

function vignette(strength: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = Math.max(Math.abs(x - 511.5), Math.abs(y - 511.5)) / 511.5;
      const t = clamp((m - 0.35) / 0.65, 0, 1);
      const f = 1 - strength * t * t * (3 - 2 * t);
      const i = (y * W + x) * 4;
      px[i] = Math.round(px[i] * f);
      px[i + 1] = Math.round(px[i + 1] * f);
      px[i + 2] = Math.round(px[i + 2] * f);
    }
  }
}

// ------------------------------------------------------- monoline alphabet

const GLYPHS: Record<string, Glyph> = {
  A: { width: 60, strokes: [[[0, 100], [30, 0], [60, 100]], [[12, 62], [48, 62]]] },
  B: { width: 56, strokes: [[[0, 0], [0, 100]], [[0, 0], [36, 0], [52, 12], [52, 38], [36, 50], [0, 50]], [[0, 50], [40, 50], [56, 62], [56, 88], [40, 100], [0, 100]]] },
  C: { width: 58, strokes: [[[58, 14], [44, 0], [16, 0], [0, 16], [0, 84], [16, 100], [44, 100], [58, 86]]] },
  D: { width: 58, strokes: [[[0, 0], [0, 100]], [[0, 0], [36, 0], [58, 22], [58, 78], [36, 100], [0, 100]]] },
  E: { width: 52, strokes: [[[52, 0], [0, 0], [0, 100], [52, 100]], [[0, 50], [42, 50]]] },
  F: { width: 52, strokes: [[[52, 0], [0, 0], [0, 100]], [[0, 50], [42, 50]]] },
  G: { width: 58, strokes: [[[58, 14], [44, 0], [16, 0], [0, 16], [0, 84], [16, 100], [44, 100], [58, 84], [58, 56], [32, 56]]] },
  H: { width: 58, strokes: [[[0, 0], [0, 100]], [[58, 0], [58, 100]], [[0, 50], [58, 50]]] },
  I: { width: 16, strokes: [[[8, 0], [8, 100]]] },
  J: { width: 52, strokes: [[[52, 0], [52, 84], [38, 100], [14, 100], [0, 84], [0, 68]]] },
  K: { width: 56, strokes: [[[0, 0], [0, 100]], [[54, 0], [0, 52]], [[16, 38], [56, 100]]] },
  L: { width: 50, strokes: [[[0, 0], [0, 100], [50, 100]]] },
  M: { width: 76, strokes: [[[0, 100], [0, 0], [38, 58], [76, 0], [76, 100]]] },
  N: { width: 60, strokes: [[[0, 100], [0, 0], [60, 100], [60, 0]]] },
  O: { width: 64, strokes: [[[32, 0], [48, 7], [60, 25], [64, 50], [60, 75], [48, 93], [32, 100], [16, 93], [4, 75], [0, 50], [4, 25], [16, 7], [32, 0]]] },
  P: { width: 56, strokes: [[[0, 100], [0, 0], [38, 0], [56, 14], [56, 38], [38, 52], [0, 52]]] },
  Q: { width: 64, strokes: [[[32, 0], [48, 7], [60, 25], [64, 50], [60, 75], [48, 93], [32, 100], [16, 93], [4, 75], [0, 50], [4, 25], [16, 7], [32, 0]], [[42, 80], [62, 100]]] },
  R: { width: 56, strokes: [[[0, 100], [0, 0], [38, 0], [56, 14], [56, 38], [38, 52], [0, 52]], [[30, 52], [56, 100]]] },
  S: { width: 56, strokes: [[[56, 12], [42, 0], [14, 0], [0, 12], [0, 38], [14, 50], [42, 50], [56, 62], [56, 88], [42, 100], [14, 100], [0, 88]]] },
  T: { width: 56, strokes: [[[0, 0], [56, 0]], [[28, 0], [28, 100]]] },
  U: { width: 58, strokes: [[[0, 0], [0, 82], [16, 100], [42, 100], [58, 82], [58, 0]]] },
  V: { width: 58, strokes: [[[0, 0], [29, 100], [58, 0]]] },
  W: { width: 80, strokes: [[[0, 0], [16, 100], [40, 34], [64, 100], [80, 0]]] },
  X: { width: 56, strokes: [[[0, 0], [56, 100]], [[56, 0], [0, 100]]] },
  Y: { width: 56, strokes: [[[0, 0], [28, 48], [56, 0]], [[28, 48], [28, 100]]] },
  Z: { width: 54, strokes: [[[0, 0], [54, 0], [0, 100], [54, 100]]] },
  " ": { width: 40, strokes: [] },
};

const CONDENSE = 0.93;

function wordWidthEm(word: string, trackingEm: number): number {
  let total = 0;
  for (let i = 0; i < word.length; i++) {
    total += GLYPHS[word[i]].width * CONDENSE;
    if (i < word.length - 1) total += trackingEm;
  }
  return total;
}

function wordInkWidth(word: string, trackingEm: number, capHeight: number, strokeEm: number): number {
  const scale = capHeight / 100;
  return wordWidthEm(word, trackingEm) * scale + strokeEm * scale;
}

function drawWord(word: string, baseline: number, capHeight: number, strokeEm: number, trackingEm: number, c: RGB): void {
  const scale = capHeight / 100;
  const top = baseline - capHeight;
  let pen = 512 - (wordWidthEm(word, trackingEm) * scale) / 2;
  for (const ch of word) {
    const g = GLYPHS[ch];
    for (const line of g.strokes) {
      for (let i = 0; i + 1 < line.length; i++) {
        strokeLine(
          pen + line[i][0] * CONDENSE * scale, top + line[i][1] * scale,
          pen + line[i + 1][0] * CONDENSE * scale, top + line[i + 1][1] * scale,
          strokeEm * scale, c,
        );
      }
    }
    pen += (g.width * CONDENSE + trackingEm) * scale;
  }
}

// -------------------------------------------------------------------- scene

const CREAM = hex("#FFF3E0");
const SILHOUETTE = hex("#08161F");
const RIM = hex("#2C6B72");

function drawSky(): void {
  fillGradientV(0, 0, W, H, [
    { y: 0, c: hex("#071726") },
    { y: 380, c: hex("#123C4A") },
    { y: 520, c: hex("#2E5F63") },
    { y: 616, c: hex("#EF9D55") },
    { y: 640, c: hex("#E98B4A") },
    { y: 660, c: hex("#F2B06A") },
  ]);
}

function drawStars(): void {
  const c = hex("#F4EFE4");
  const placed: Point[] = [];
  for (let i = 0; placed.length < 14 && i < 200; i++) {
    const x = 56 + (hash2(i, 101) % 912);
    const y = 36 + (hash2(i, 202) % 186);
    let clear = true;
    for (const p of placed) {
      if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < 44 * 44) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    placed.push([x, y]);
    const r = 1 + (hash2(i, 303) % 2);
    const op = 0.5 + 0.35 * ((hash2(i, 404) % 100) / 100);
    disc(x, y, r, c, 0.7, op);
  }
}

function drawBirds(): void {
  const c = hex("#0A1B26");
  const spots: Point[] = [[330, 300], [372, 276], [250, 336], [410, 250]];
  for (const [bx, by] of spots) {
    strokeLine(bx - 7, by + 3, bx, by, 1.6, c);
    strokeLine(bx, by, bx + 7, by + 3, 1.6, c);
  }
}

function drawSun(): void {
  disc(512, 604, 168, hex("#FFB765"), 22, 0.14);
  disc(512, 604, 126, hex("#FFC46B"), 3);
}

function drawSea(): void {
  fillGradientV(0, 664, W, H, [
    { y: 664, c: hex("#16757F") },
    { y: 860, c: hex("#0A3E4C") },
    { y: 1024, c: hex("#031722") },
  ]);
}

function drawRipples(): void {
  const c = hex("#9FC9C2");
  let y = 680;
  while (y < 1012) {
    const t = (y - 680) / 332;
    const op = 0.12 - 0.06 * t;
    const thick = t < 0.45 ? 2 : 1;
    for (let dy = 0; dy < thick; dy++) {
      for (let x = 0; x < W; x++) {
        if (hash2(x >> 4, y + dy) % 19 === 0) continue;
        const v = 0.65 + 0.35 * ((hash2(x >> 3, y + dy) % 100) / 100);
        blend(x, y + dy, c, op * v);
      }
    }
    y += Math.round(6 + 20 * t);
  }
}

function drawSunPath(): void {
  const c = hex("#FFD79A");
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const y = Math.round(676 + t * 32);
    const hgt = 2 + (hash2(i, 91) % 3);
    const w = Math.round(150 - 50 * t);
    const op = 0.42 - 0.1 * t;
    const x0 = 512 - w / 2;
    for (let dy = 0; dy < hgt; dy++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        const u = (x + 0.5 - x0) / w;
        if (u < 0 || u > 1) continue;
        const f = u < 1 / 3 ? u * 3 : u > 2 / 3 ? (1 - u) * 3 : 1;
        blend(x, y + dy, c, op * f);
      }
    }
  }
}

function scrimV(y0: number, y1: number, c: RGB, a0: number, a1: number): void {
  for (let y = y0; y < y1; y++) {
    const a = a0 + (a1 - a0) * ((y - y0) / (y1 - y0));
    for (let x = 0; x < W; x++) blend(x, y, c, a);
  }
}

function drawStacks(): void {
  polygon([[414, 692], [419, 610], [423, 548], [429, 498], [450, 502], [447, 560], [445, 622], [449, 692]], SILHOUETTE);
  polygon([[492, 692], [495, 612], [493, 556], [499, 500], [519, 496], [523, 558], [521, 630], [526, 692]], SILHOUETTE);
  polygon([[423, 548], [425, 486], [433, 458], [449, 442], [470, 438], [492, 444], [508, 458], [516, 486], [519, 540], [500, 530], [472, 526], [448, 530]], SILHOUETTE);
  polygon([[582, 692], [585, 622], [581, 574], [588, 550], [598, 558], [606, 542], [616, 554], [621, 582], [619, 642], [624, 692]], SILHOUETTE);
  polygon([[346, 692], [354, 668], [372, 642], [396, 622], [418, 636], [434, 666], [440, 692]], SILHOUETTE);
  const archRim: Point[] = [[414, 692], [419, 610], [423, 548], [425, 486], [433, 458], [449, 442]];
  const columnRim: Point[] = [[582, 692], [585, 622], [581, 574], [588, 550]];
  const rockRim: Point[] = [[346, 692], [354, 668], [372, 642], [396, 622]];
  for (const rim of [archRim, columnRim, rockRim]) {
    for (let i = 0; i + 1 < rim.length; i++) {
      strokeLine(rim[i][0], rim[i][1], rim[i + 1][0], rim[i + 1][1], 2, RIM);
    }
  }
}

function drawBoats(): void {
  const dark = hex("#08161F");
  const sail = hex("#F3E3CB");
  strokeLine(806, 688, 806, 648, 2, dark);
  polygon([[806, 650], [806, 684], [779, 680]], sail);
  polygon([[777, 688], [835, 688], [827, 697], [785, 697]], dark);
  strokeLine(256, 694, 256, 672, 2, dark);
  polygon([[256, 673], [256, 692], [240, 689]], sail);
  polygon([[239, 694], [273, 694], [268, 701], [244, 701]], dark);
}

function drawForeground(): void {
  const dark = hex("#04101A");
  const cliff: Point[] = [[0, 1024], [0, 742], [66, 780], [112, 780], [112, 812], [168, 812], [168, 846], [224, 880], [286, 946], [330, 1024]];
  polygon(cliff, dark);
  for (let i = 1; i + 1 < cliff.length; i++) {
    strokeLine(cliff[i][0], cliff[i][1], cliff[i + 1][0], cliff[i + 1][1], 2, RIM);
  }
}

function drawFrame(): void {
  fillRect(46, 46, 978, 48, CREAM, 0.45);
  fillRect(46, 976, 978, 978, CREAM, 0.45);
  fillRect(46, 48, 48, 976, CREAM, 0.45);
  fillRect(976, 48, 978, 976, CREAM, 0.45);
}

function drawType(): void {
  drawWord("VELCARA", 864, 154, 9, 20, CREAM);
  const inkW = wordInkWidth("VELCARA", 20, 154, 9);
  fillRect(512 - inkW / 2, 878, 512 + inkW / 2, 882, CREAM);
  drawWord("ISLES", 954, 62, 11, 20, CREAM);
}

// -------------------------------------------------------------- PNG encoder

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0;
    Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * stride + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------------- main

function main(): void {
  drawSky();
  drawStars();
  drawBirds();
  drawSun();
  drawSea();
  drawRipples();
  drawSunPath();
  drawStacks();
  drawBoats();
  scrimV(680, H, hex("#04121C"), 0, 0.7);
  drawForeground();
  grain(6);
  vignette(0.18);
  drawFrame();
  drawType();
  const dir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "entry.png"), encodePNG());
}

main();
