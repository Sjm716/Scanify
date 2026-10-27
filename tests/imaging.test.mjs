import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAdjustments,
  applyHomography,
  computeHomography,
  createImage,
  detectDocumentCorners,
  isConvexClockwise,
  outputSize,
  rotate90,
  warpPerspective,
} from '../js/imaging.js';

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Dark wooden-desk-ish background with a bright "paper" quad and some text lines. */
function scene(w, h, quad) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const paper = inside(quad, x + 0.5, y + 0.5);
      const ink = paper && y % 12 < 2 && x % 40 < 30;
      const v = paper ? (ink ? 40 : 235) : 70 + ((x * 7 + y * 3) % 20);
      img.data[o] = v;
      img.data[o + 1] = paper ? v : v - 20;
      img.data[o + 2] = paper ? v : v - 40;
      img.data[o + 3] = 255;
    }
  }
  return img;
}

test('detects the corners of a skewed document', () => {
  const w = 240, h = 320;
  const quad = [[40, 30], [200, 50], [215, 290], [25, 275]];
  const corners = detectDocumentCorners(scene(w, h, quad));
  assert.ok(corners, 'expected a document to be found');
  corners.forEach(([x, y], i) => {
    assert.ok(Math.abs(x * w - quad[i][0]) < 5, `corner ${i} x: ${x * w} vs ${quad[i][0]}`);
    assert.ok(Math.abs(y * h - quad[i][1]) < 5, `corner ${i} y: ${y * h} vs ${quad[i][1]}`);
  });
});

test('returns null when there is no document', () => {
  const img = createImage(100, 100);
  img.data.fill(120);
  assert.equal(detectDocumentCorners(img), null);
});

test('homography maps the four points exactly', () => {
  const src = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const dst = [[10, 20], [90, 5], [120, 80], [-5, 60]];
  const H = computeHomography(src, dst);
  src.forEach((p, i) => {
    const [u, v] = applyHomography(H, ...p);
    assert.ok(Math.abs(u - dst[i][0]) < 1e-6 && Math.abs(v - dst[i][1]) < 1e-6);
  });
});

test('warp straightens a skewed page into a clean rectangle', () => {
  const w = 240, h = 320;
  const quad = [[40, 30], [200, 50], [215, 290], [25, 275]];
  const src = scene(w, h, quad);
  const size = outputSize(quad);
  const out = warpPerspective(src, quad, size.width, size.height, 0.012);
  // Every edge pixel should be paper (bright or ink), never the dark desk.
  const edge = [];
  for (let x = 0; x < out.width; x++) edge.push([x, 0], [x, out.height - 1]);
  for (let y = 0; y < out.height; y++) edge.push([0, y], [out.width - 1, y]);
  const deskLike = edge.filter(([x, y]) => {
    const o = (y * out.width + x) * 4;
    return out.data[o + 2] < out.data[o] - 15; // desk is warmer (less blue)
  });
  assert.equal(deskLike.length, 0);
});

test('outputSize respects the max side', () => {
  const s = outputSize([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], 2000);
  assert.deepEqual(s, { width: 2000, height: 1500 });
});

test('brightness makes the page lighter or darker', () => {
  const base = createImage(2, 1);
  base.data.set([100, 100, 100, 255, 150, 150, 150, 255]);
  const lighter = applyAdjustments({ ...base, data: new Uint8ClampedArray(base.data) }, { brightness: 50 });
  const darker = applyAdjustments({ ...base, data: new Uint8ClampedArray(base.data) }, { brightness: -50 });
  assert.ok(lighter.data[0] > 100 && darker.data[0] < 100);
});

test('black & white filter produces only pure black and white', () => {
  const img = scene(120, 160, [[10, 10], [110, 10], [110, 150], [10, 150]]);
  applyAdjustments(img, { filter: 'bw' });
  for (let i = 0; i < img.data.length; i += 4) assert.ok(img.data[i] === 0 || img.data[i] === 255);
});

test('grayscale filter removes colour', () => {
  const img = createImage(1, 1);
  img.data.set([200, 50, 10, 255]);
  applyAdjustments(img, { filter: 'gray' });
  assert.equal(img.data[0], img.data[1]);
  assert.equal(img.data[1], img.data[2]);
});

test('rotate90 swaps dimensions and moves pixels clockwise', () => {
  const img = createImage(2, 1);
  img.data.set([255, 0, 0, 255, 0, 0, 255, 255]); // red, blue
  const r = rotate90(img, 1);
  assert.equal(r.width, 1);
  assert.equal(r.height, 2);
  assert.deepEqual([...r.data.slice(0, 3)], [255, 0, 0]); // red on top
  assert.deepEqual([...rotate90(img, 4).data], [...img.data]);
});

test('isConvexClockwise rejects twisted quads', () => {
  assert.ok(isConvexClockwise([[0, 0], [1, 0], [1, 1], [0, 1]]));
  assert.ok(!isConvexClockwise([[0, 0], [1, 1], [1, 0], [0, 1]]));
});
