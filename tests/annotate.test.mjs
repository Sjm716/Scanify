import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUNDS, BG_ALPHA, backgroundCss, defaultInk, hitTest, layoutAnnotation, wrapText } from '../js/annotate.js';

// Every character is half the font size wide.
function fakeCtx() {
  return {
    font: '',
    measureText(s) {
      const px = Number(/(\d+)px/.exec(this.font)[1]);
      return { width: s.length * px * 0.5 };
    },
  };
}

const note = (over = {}) => ({ id: 'a', text: 'PAID', x: 0.1, y: 0.2, size: 'm', bg: 'yellow', ink: 'black', ...over });

test('backgrounds are 30% transparent', () => {
  assert.equal(BG_ALPHA, 0.7);
  assert.equal(backgroundCss('yellow'), 'rgba(255, 235, 59, 0.7)');
  assert.equal(backgroundCss('none'), 'transparent');
  assert.ok(BACKGROUNDS.length >= 8);
});

test('picks a readable text colour for each background', () => {
  assert.equal(defaultInk('yellow'), 'black');
  assert.equal(defaultInk('white'), 'black');
  assert.equal(defaultInk('none'), 'black');
  assert.equal(defaultInk('black'), 'white');
  assert.equal(defaultInk('purple'), 'white');
});

test('wraps long text and keeps line breaks', () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapText(measure, 'one two three four', 100), ['one two', 'three four']);
  assert.deepEqual(wrapText(measure, 'top\n\nbottom', 1000), ['top', '', 'bottom']);
});

test('scales with the page so preview and print match', () => {
  const ctx = fakeCtx();
  const small = layoutAnnotation(ctx, note(), 1000, 1400);
  const big = layoutAnnotation(ctx, note(), 2000, 2800);
  assert.equal(big.fontPx, small.fontPx * 2);
  assert.ok(Math.abs(big.x - small.x * 2) <= 1 && Math.abs(big.y - small.y * 2) <= 1);
  assert.ok(Math.abs(big.w - small.w * 2) <= 2);
});

test('keeps the box on the page', () => {
  const ctx = fakeCtx();
  const b = layoutAnnotation(ctx, note({ x: 0.99, y: 0.99 }), 1000, 1400);
  assert.ok(b.x + b.w <= 1000 && b.y + b.h <= 1400);
  const long = layoutAnnotation(ctx, note({ text: 'word '.repeat(80), x: 0 }), 1000, 1400);
  assert.ok(long.w <= 1000 && long.lines.length > 1);
});

test('hit testing finds the topmost box', () => {
  const ctx = fakeCtx();
  const anns = [note({ id: 'under' }), note({ id: 'over' })];
  assert.equal(hitTest(ctx, anns, 1000, 1400, 110, 290).id, 'over');
  assert.equal(hitTest(ctx, anns, 1000, 1400, 900, 1300), null);
});

test('fuel badge sits a third of the way down, inside the square photo-grid thumbnail', async () => {
  const { fuelBadgeBox } = await import('../js/watermark.js');
  // Grid thumbnails show the centred square of a photo.
  const visible = (w, h, b) => {
    const s = Math.min(w, h), left = (w - s) / 2, top = (h - s) / 2;
    return b.x >= left && b.x + b.size <= left + s && b.y >= top && b.y + b.size <= top + s;
  };
  for (const [w, h] of [[3000, 4000], [4000, 3000], [1080, 1920], [1920, 1080], [3000, 3000]]) {
    const b = fuelBadgeBox(w, h);
    assert.ok(visible(w, h, b), `badge visible in thumbnail for ${w}x${h}`);
    assert.ok(Math.abs(b.y + b.size / 2 - h / 3) <= 1, `centred a third of the way down for ${w}x${h}`);
  }
  const land = fuelBadgeBox(4000, 3000);
  const port = fuelBadgeBox(3000, 4000);
  assert.equal(land.size, port.size); // same size whichever way the phone is held
  assert.equal(land.size, 270);
  assert.ok(port.x + port.size > 3000 * 0.9, 'portrait: near the right edge');
  assert.ok(fuelBadgeBox(100, 80).size >= 24); // never too small to see
});
