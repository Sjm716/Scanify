// End-to-end smoke test: drives Scanify in headless Chromium with a fake
// camera, scans and imports a synthetic skewed document, groups the pages
// and exports a PDF.
//
// Usage: node tests/e2e.js [screenshot-dir]

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// require() so a globally installed Playwright is found too.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'scanify-e2e-'));

// Draws a photo-like scene: a skewed sheet of paper with text on a desk.
const SCENE = ({ w, h, tint }) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#5b3a22');
  g.addColorStop(1, '#3b2414');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const q = [[0.2, 0.12], [0.8, 0.17], [0.86, 0.9], [0.13, 0.86]].map(([x, y]) => [x * w, y * h]);
  ctx.fillStyle = tint;
  ctx.beginPath();
  q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.fill();
  ctx.save();
  ctx.translate(q[0][0], q[0][1]);
  ctx.rotate(Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]));
  ctx.fillStyle = '#333';
  ctx.font = `bold ${Math.round(w / 22)}px sans-serif`;
  ctx.fillText('INVOICE #1042', w * 0.05, h * 0.08);
  ctx.font = `${Math.round(w / 45)}px sans-serif`;
  for (let i = 0; i < 14; i++) ctx.fillText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', w * 0.05, h * (0.15 + i * 0.04));
  ctx.restore();
  return c;
};

async function makeFixtures(browser) {
  const page = await browser.newPage();
  const jpeg = await page.evaluate(async (src) => {
    const scene = eval(src);
    const c = scene({ w: 1200, h: 1600, tint: '#f4f1ea' });
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, `(${SCENE})`);
  const w = 640, h = 480;
  const rgba = await page.evaluate(
    ({ src, w, h }) => {
      const c = eval(src)({ w, h, tint: '#f8f8f8' });
      return [...c.getContext('2d').getImageData(0, 0, w, h).data];
    },
    { src: `(${SCENE})`, w, h }
  );
  await page.close();

  // Convert to a one-frame Y4M (I420) for Chromium's fake camera.
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [r, g, b] = [rgba[o], rgba[o + 1], rgba[o + 2]];
      Y[y * w + x] = Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16);
      if (x % 2 === 0 && y % 2 === 0) {
        const i = (y / 2) * (w / 2) + x / 2;
        U[i] = Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128);
        V[i] = Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128);
      }
    }
  }
  const y4m = join(tmp, 'camera.y4m');
  writeFileSync(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\nFRAME\n`), Y, U, V]));
  return { jpeg: Buffer.from(jpeg), y4m };
}

async function main() {
  const server = spawn(process.execPath, [join(ROOT, 'tools/serve.cjs'), String(PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  const plain = await chromium.launch();
  const fixtures = await makeFixtures(plain);
  await plain.close();

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${fixtures.y4m}`],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  await context.grantPermissions(['camera']);
  // Headless Chromium can't show the native save dialog; use the download fallback.
  await context.addInitScript(() => delete window.showSaveFilePicker);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('#home-empty:not([hidden])');
    await shot('01-home-empty');

    // --- Scan with the (fake) camera -------------------------------------
    await page.click('[data-action="scan"]');
    await page.waitForSelector('#view-camera.active');
    await page.waitForFunction(() => document.querySelector('#camera-overlay polygon').getAttribute('points'), null, { timeout: 5000 });
    await shot('02-camera');
    await page.click('[data-action="capture"]');
    await page.waitForSelector('#view-editor.active');
    await page.waitForSelector('#busy', { state: 'hidden' });
    await shot('03-crop');

    await page.click('[data-action="editor-next"]');
    await page.click('[data-filter="bw"]');
    await page.locator('#brightness').fill('30');
    await page.waitForTimeout(300);
    await shot('04-adjust');
    await page.click('[data-action="editor-next"]'); // Save → choose group
    await page.click('[data-sheet-action="new"]');
    await page.fill('#sheet input', 'Invoices');
    await page.click('[data-sheet-action="ok"]');
    await page.waitForSelector('#view-group.active');
    await page.waitForSelector('#sheet:not([hidden]) [data-sheet-action="done"]');
    await shot('05-page-added');
    await page.click('[data-sheet-action="done"]');

    // --- Import a second page into the same group ------------------------
    await page.setInputFiles('#file-import', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: fixtures.jpeg });
    await page.waitForSelector('#view-editor.active');
    await page.waitForSelector('#busy', { state: 'hidden' });
    const corners = await page.evaluate(() => window.scanify.state.editor.settings.corners);
    const expected = [[0.2, 0.12], [0.8, 0.17], [0.86, 0.9], [0.13, 0.86]];
    corners.forEach(([x, y], i) => {
      assert.ok(Math.abs(x - expected[i][0]) < 0.02 && Math.abs(y - expected[i][1]) < 0.02, `corner ${i}: ${x},${y}`);
    });
    // Drag a corner handle a little to exercise manual adjustment.
    const handle = await page.locator('.handle[data-corner="0"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 3, handle.y + handle.height / 2 + 3, { steps: 3 });
    await page.mouse.up();
    await page.click('[data-action="editor-next"]');
    await page.click('[data-action="editor-next"]');
    await page.waitForSelector('#view-group.active');
    await page.waitForFunction(() => document.querySelectorAll('.page-card').length === 2);
    await shot('06-group');

    // --- Export ---------------------------------------------------------
    await page.click('[data-action="share"]');
    await page.waitForSelector('#sheet:not([hidden]) [data-sheet-action="save"]');
    await page.click('[data-seg="pageSize"] [data-value="letter"]');
    await shot('07-export');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-sheet-action="save"]')]);
    assert.equal(download.suggestedFilename(), 'Invoices.pdf');
    const pdfPath = join(tmp, 'Invoices.pdf');
    await download.saveAs(pdfPath);
    const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    assert.match(info, /Pages:\s+2/);
    assert.match(info, /Page size:\s+(612 x 792|792 x 612) pts \(letter\)/);

    // --- Export as JPG images: one file per page --------------------------
    await page.click('[data-action="share"]');
    await page.waitForSelector('#sheet:not([hidden]) [data-sheet-action="save"]');
    await page.click('[data-seg="format"] [data-value="jpg"]');
    assert.ok(await page.locator('[data-page-size]').isHidden(), 'page size only applies to PDF');
    assert.match(await page.textContent('[data-summary]'), /2 pages as 2 JPG images/);
    await shot('07b-export-jpg');
    const jpgs = [];
    page.on('download', (d) => jpgs.push(d));
    await page.click('[data-sheet-action="save"]');
    await page.waitForFunction(() => !document.querySelector('#toast').hidden);
    await page.waitForTimeout(1000);
    assert.deepEqual(jpgs.map((d) => d.suggestedFilename()).sort(), ['Invoices - page 1.jpg', 'Invoices - page 2.jpg']);
    for (const d of jpgs) {
      const path = join(tmp, d.suggestedFilename());
      await d.saveAs(path);
      const head = readFileSync(path).subarray(0, 3);
      assert.deepEqual([...head], [0xff, 0xd8, 0xff], 'a JPEG file');
    }

    // Home shows the group.
    await page.click('[data-action="home"]');
    await page.waitForSelector('.group-card');
    await shot('08-home');
    assert.match(await page.textContent('.group-card'), /Invoices.*2 pages/s);

    assert.deepEqual(errors, []);
    console.log('E2E passed');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
