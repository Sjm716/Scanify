// Generates the Scanify "S" logo: the left half is a smooth, standard
// letterform and the right half is the same letter rendered as chunky
// 8-bit pixels. The pixel half is derived by rasterising the smooth path
// on a coarse grid so both halves line up exactly.
//
// Usage: node tools/make-logo.cjs   (requires Playwright + Chromium)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'icons');

// Centre-line of the S in a 100x100 box, drawn with a thick round stroke.
const S_PATH =
  'M 71 29 C 66 19, 52 16, 43 18 C 30 21, 25 34, 33 43 ' +
  'C 40 50, 60 50, 67 57 C 76 66, 71 81, 55 83 C 44 84, 33 80, 28 71';
const STROKE = 14;
const CELL = 5; // 20x20 pixel grid
const GRID = 20;
const COVERAGE = 0.5;

async function rasterise(page) {
  return page.evaluate(
    ({ S_PATH, STROKE, CELL, GRID, COVERAGE }) => {
      const scale = 8; // sub-samples per logo unit
      const size = 100 * scale;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.lineWidth = STROKE;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(S_PATH));
      const data = ctx.getImageData(0, 0, size, size).data;
      const cellPx = CELL * scale;
      const cells = [];
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          let on = 0, total = 0;
          for (let y = Math.floor(gy * cellPx); y < Math.floor((gy + 1) * cellPx); y++) {
            for (let x = Math.floor(gx * cellPx); x < Math.floor((gx + 1) * cellPx); x++) {
              total++;
              if (data[(y * size + x) * 4 + 3] > 127) on++;
            }
          }
          if (on / total >= COVERAGE) cells.push([gx, gy]);
        }
      }
      return cells;
    },
    { S_PATH, STROKE, CELL, GRID, COVERAGE }
  );
}

function markSvg(cells, color, { split = false } = {}) {
  const half = GRID / 2;
  const pixels = cells
    .filter(([gx]) => gx >= half)
    .map(([gx, gy]) => `<rect x="${gx * CELL}" y="${gy * CELL}" width="${CELL}" height="${CELL}"/>`)
    .join('');
  return (
    `<defs><clipPath id="sl"><rect x="0" y="0" width="50" height="100"/></clipPath></defs>` +
    `<path d="${S_PATH}" fill="none" stroke="${color}" stroke-width="${STROKE}" ` +
    `stroke-linecap="butt" clip-path="url(#sl)"/>` +
    `<g fill="${color}" shape-rendering="crispEdges">${pixels}</g>` +
    (split ? `<line x1="50" y1="10" x2="50" y2="90" stroke="${color}" stroke-opacity=".25" stroke-width=".8"/>` : '')
  );
}

function tileSvg(cells, { maskable = false } = {}) {
  // Maskable icons need the mark inside the central 80% safe zone.
  const inset = maskable ? 18 : 10;
  const s = (100 - inset * 2) / 100;
  const radius = maskable ? 0 : 22;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>` +
    `<rect width="100" height="100" rx="${radius}" fill="url(#bg)"/>` +
    `<g transform="translate(${inset} ${inset}) scale(${s})">${markSvg(cells, '#ffffff')}</g>` +
    `</svg>`
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const cells = await rasterise(page);

  const mark =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    markSvg(cells, 'currentColor') +
    `</svg>`;
  fs.writeFileSync(path.join(OUT, 'logo-mark.svg'), mark + '\n');
  fs.writeFileSync(path.join(OUT, 'icon.svg'), tileSvg(cells) + '\n');

  const renders = [
    ['icon-192.png', 192, tileSvg(cells)],
    ['icon-512.png', 512, tileSvg(cells)],
    ['icon-maskable-512.png', 512, tileSvg(cells, { maskable: true })],
    ['apple-touch-icon.png', 180, tileSvg(cells, { maskable: true })],
    ['favicon-32.png', 32, tileSvg(cells)],
  ];
  for (const [name, size, svg] of renders) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        svg.replace('<svg ', `<svg width="${size}" height="${size}" `) +
        `</body></html>`
    );
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true });
  }
  await browser.close();
  console.log(`Wrote logo with ${cells.length} pixels to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
