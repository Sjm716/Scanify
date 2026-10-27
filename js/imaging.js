// Pure image-processing helpers. Everything here works on plain
// { width, height, data } objects (the shape of ImageData) so it can run
// in the browser and in Node tests alike.

export const FILTERS = ['color', 'enhance', 'gray', 'bw'];

export function createImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ---------------------------------------------------------------------------
// Document edge detection
// ---------------------------------------------------------------------------

function otsuThreshold(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Default crop: the whole image with a small inset, as normalised corners. */
export function defaultCorners(inset = 0.04) {
  return [
    [inset, inset],
    [1 - inset, inset],
    [1 - inset, 1 - inset],
    [inset, 1 - inset],
  ];
}

export function fullCorners() {
  return defaultCorners(0);
}

/**
 * Finds the four corners of a (bright) document in a small image.
 * Returns normalised [tl, tr, br, bl] corners in 0..1, or null if nothing
 * document-like was found.
 */
export function detectDocumentCorners(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);

  // Paper is bright and mostly unsaturated; penalise colourful pixels so
  // that bright coloured backgrounds are less likely to be picked.
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const v = Math.max(0, Math.min(255, Math.round(luminance(r, g, b) - sat * 0.5)));
    gray[i] = v;
    hist[v]++;
  }
  const t = otsuThreshold(hist, n);

  // Largest 4-connected bright component.
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  let bestLabel = 0, bestSize = 0, label = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] || gray[i] <= t) continue;
    label++;
    let size = 0, sp = 0;
    stack[sp++] = i;
    labels[i] = label;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && !labels[p - 1] && gray[p - 1] > t) { labels[p - 1] = label; stack[sp++] = p - 1; }
      if (x < w - 1 && !labels[p + 1] && gray[p + 1] > t) { labels[p + 1] = label; stack[sp++] = p + 1; }
      if (y > 0 && !labels[p - w] && gray[p - w] > t) { labels[p - w] = label; stack[sp++] = p - w; }
      if (y < h - 1 && !labels[p + w] && gray[p + w] > t) { labels[p + w] = label; stack[sp++] = p + w; }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }
  if (bestSize < n * 0.08) return null;

  // Outline points of the component (left/right-most pixel on each row and
  // top/bottom-most on each column) are enough to build the convex hull.
  const pts = [];
  for (let y = 0; y < h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] === bestLabel) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) pts.push([first, y], [last + 1, y], [first, y + 1], [last + 1, y + 1]);
  }
  const hull = convexHull(pts);
  if (hull.length < 4) return null;

  // Start from the extreme points and greedily grow the quad's area.
  const pick = (score) => hull.reduce((best, p) => (score(p) > score(best) ? p : best), hull[0]);
  const quad = [
    pick((p) => -(p[0] + p[1])),
    pick((p) => p[0] - p[1]),
    pick((p) => p[0] + p[1]),
    pick((p) => p[1] - p[0]),
  ];
  for (let iter = 0; iter < 4; iter++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      let bestArea = quadArea(quad);
      for (const p of hull) {
        const trial = quad.slice();
        trial[k] = p;
        const a = quadArea(trial);
        if (a > bestArea + 1e-9 && isConvexClockwise(trial)) {
          bestArea = a;
          quad[k] = p;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  if (quadArea(quad) < n * 0.08) return null;
  return quad.map(([x, y]) => [clamp01(x / w), clamp01(y / h)]);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** True for a convex quad ordered tl, tr, br, bl (clockwise in screen space). */
export function isConvexClockwise(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross <= 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Perspective correction
// ---------------------------------------------------------------------------

function solve8(A, b) {
  // Gaussian elimination with partial pivoting on an 8x8 system.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) throw new Error('Degenerate quad');
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c < 9; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[8] / row[i]);
}

/** Homography mapping each src[i] point to dst[i]; returns a 3x3 row-major array. */
export function computeHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  return [...h, 1];
}

export function applyHomography(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Output size (in source pixels) for a crop quad given in pixel coordinates,
 * scaled down so the longest side is at most maxSide.
 */
export function outputSize(quadPx, maxSide = Infinity) {
  const [tl, tr, br, bl] = quadPx;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Warps the quad (pixel coords tl,tr,br,bl) of src into a straight
 * rectangle of the given size. `trim` (0..0.1) shaves that fraction off
 * every edge, which removes leftover background slivers so the page edges
 * come out clean and uniform.
 */
export function warpPerspective(src, quadPx, width, height, trim = 0) {
  const out = createImage(width, height);
  const t = Math.max(0, Math.min(0.1, trim));
  const rect = [
    [-t * width / (1 - 2 * t), -t * height / (1 - 2 * t)],
    [width + t * width / (1 - 2 * t), -t * height / (1 - 2 * t)],
    [width + t * width / (1 - 2 * t), height + t * height / (1 - 2 * t)],
    [-t * width / (1 - 2 * t), height + t * height / (1 - 2 * t)],
  ];
  const H = computeHomography(rect, quadPx);
  const sw = src.width, sh = src.height, sd = src.data, od = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = applyHomography(H, x + 0.5, y + 0.5);
      const fx = Math.max(0, Math.min(sw - 1.001, sx - 0.5));
      const fy = Math.max(0, Math.min(sh - 1.001, sy - 0.5));
      const x0 = fx | 0, y0 = fy | 0;
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - ax) + sd[i10 + c] * ax;
        const bot = sd[i01 + c] * (1 - ax) + sd[i11 + c] * ax;
        od[o + c] = top * (1 - ay) + bot * ay;
      }
      od[o + 3] = 255;
    }
  }
  return out;
}

/** Rotates by a multiple of 90 degrees clockwise. */
export function rotate90(img, turns) {
  const q = ((turns % 4) + 4) % 4;
  if (!q) return img;
  const { width: w, height: h, data } = img;
  const ow = q % 2 ? h : w, oh = q % 2 ? w : h;
  const out = createImage(ow, oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (q === 1) { nx = h - 1 - y; ny = x; }
      else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const si = (y * w + x) * 4, di = (ny * ow + nx) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Print-quality adjustments
// ---------------------------------------------------------------------------

function percentile(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function adaptiveThreshold(gray, w, h, offset) {
  // Local-mean threshold using an integral image; keeps text crisp even
  // when the lighting across the page is uneven.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(4, Math.round(Math.max(w, h) / 32));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] -
        integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = gray[y * w + x] < mean - offset ? 0 : 255;
    }
  }
  return out;
}

/**
 * Applies the print-quality settings in place.
 *   brightness: -100 (darker) .. 100 (lighter)
 *   contrast:   -100 .. 100
 *   filter:     'color' | 'enhance' | 'gray' | 'bw'
 */
export function applyAdjustments(img, { brightness = 0, contrast = 0, filter = 'color' } = {}) {
  const { width: w, height: h, data } = img;
  const n = w * h;

  // Build one lookup table per channel: auto-levels (enhance) followed by
  // brightness and contrast.
  const luts = [0, 1, 2].map(() => new Uint8ClampedArray(256));
  let lo = [0, 0, 0], hi = [255, 255, 255];
  if (filter === 'enhance' || filter === 'bw' || filter === 'gray') {
    const hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < n; i++) {
      hists[0][data[i * 4]]++;
      hists[1][data[i * 4 + 1]]++;
      hists[2][data[i * 4 + 2]]++;
    }
    lo = hists.map((hh) => percentile(hh, n, 0.01));
    hi = hists.map((hh) => percentile(hh, n, filter === 'enhance' ? 0.97 : 0.99));
  }
  const b = brightness * 1.28;
  const c = Math.max(-127, Math.min(127, contrast * 1.27));
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  for (let ch = 0; ch < 3; ch++) {
    const range = Math.max(1, hi[ch] - lo[ch]);
    for (let v = 0; v < 256; v++) {
      let x = ((v - lo[ch]) * 255) / range;
      x = cf * (x - 128) + 128 + b;
      luts[ch][v] = x;
    }
  }

  if (filter === 'bw') {
    const gray = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      gray[i] = luminance(luts[0][data[o]], luts[1][data[o + 1]], luts[2][data[o + 2]]);
    }
    // Brightness also moves the ink threshold: lighter drops faint marks,
    // darker keeps more of them.
    const bin = adaptiveThreshold(gray, w, h, 12 + brightness / 8);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = bin[i];
    }
    return img;
  }

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = luts[0][data[o]], g = luts[1][data[o + 1]], bl = luts[2][data[o + 2]];
    if (filter === 'gray') {
      r = g = bl = luminance(r, g, bl);
    } else if (filter === 'enhance') {
      // Gentle saturation boost for colour documents.
      const l = luminance(r, g, bl);
      r = l + (r - l) * 1.2;
      g = l + (g - l) * 1.2;
      bl = l + (bl - l) * 1.2;
    }
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = bl;
  }
  return img;
}
