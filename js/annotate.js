// Text placed over a page. Each annotation is stored in page-relative units
// so it lands in the same place at preview size and at full print size:
//   { id, text, x, y,   // top-left of the box, 0..1 of page width/height
//     size,             // 's' | 'm' | 'l'
//     bg,               // key of BACKGROUNDS
//     ink }             // 'black' | 'white' (text colour)

// The coloured boxes are 30% transparent, so the page shows through faintly.
export const BG_ALPHA = 0.7;

export const BACKGROUNDS = [
  { key: 'none', label: 'No background', rgb: null },
  { key: 'yellow', label: 'Yellow', rgb: [255, 235, 59] },
  { key: 'green', label: 'Green', rgb: [102, 187, 106] },
  { key: 'blue', label: 'Blue', rgb: [66, 133, 244] },
  { key: 'pink', label: 'Pink', rgb: [240, 98, 146] },
  { key: 'orange', label: 'Orange', rgb: [255, 152, 0] },
  { key: 'purple', label: 'Purple', rgb: [142, 68, 173] },
  { key: 'red', label: 'Red', rgb: [229, 57, 53] },
  { key: 'white', label: 'White', rgb: [255, 255, 255] },
  { key: 'black', label: 'Black', rgb: [33, 33, 33] },
];

// Font size as a fraction of the page width.
export const SIZES = {
  s: { label: 'Small', scale: 0.03 },
  m: { label: 'Medium', scale: 0.045 },
  l: { label: 'Large', scale: 0.065 },
};

export const INKS = {
  black: { label: 'Black', css: '#111111' },
  white: { label: 'White', css: '#ffffff' },
};

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function background(key) {
  return BACKGROUNDS.find((b) => b.key === key) || BACKGROUNDS[0];
}

export function backgroundCss(key, alpha = BG_ALPHA) {
  const { rgb } = background(key);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : 'transparent';
}

/** The text colour that reads best on a background. */
export function defaultInk(key) {
  const { rgb } = background(key);
  if (!rgb) return 'black';
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.55 ? 'black' : 'white';
}

/** Splits text into lines that fit maxWidth, keeping the user's own line breaks. */
export function wrapText(measure, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (line && measure(trial) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Works out where an annotation's box goes on a page of the given pixel
 * size. The box is kept fully on the page. Returns pixel values.
 */
export function layoutAnnotation(ctx, a, width, height) {
  const fontPx = Math.max(8, Math.round(width * (SIZES[a.size] || SIZES.m).scale));
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  const pad = Math.round(fontPx * 0.4);
  const lineHeight = Math.round(fontPx * 1.25);
  const maxText = Math.max(fontPx, width * 0.92 - pad * 2);
  const lines = wrapText((s) => ctx.measureText(s).width, a.text, maxText);
  const textW = Math.min(maxText, Math.max(...lines.map((l) => ctx.measureText(l).width)));
  const w = Math.ceil(textW + pad * 2);
  const h = lines.length * lineHeight + pad * 2;
  const x = Math.round(Math.max(0, Math.min(width - w, a.x * width)));
  const y = Math.round(Math.max(0, Math.min(height - h, a.y * height)));
  return { x, y, w, h, lines, fontPx, pad, lineHeight };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws annotations onto a page canvas context. `selectedId` outlines one
 * box (for the editor preview only).
 */
export function drawAnnotations(ctx, annotations, width, height, { selectedId = null } = {}) {
  for (const a of annotations) {
    if (!a.text.trim()) continue;
    const box = layoutAnnotation(ctx, a, width, height);
    ctx.save();
    if (background(a.bg).rgb) {
      ctx.fillStyle = backgroundCss(a.bg);
      roundRect(ctx, box.x, box.y, box.w, box.h, Math.round(box.fontPx * 0.25));
      ctx.fill();
    }
    ctx.fillStyle = (INKS[a.ink] || INKS.black).css;
    ctx.textBaseline = 'middle';
    box.lines.forEach((line, i) => {
      ctx.fillText(line, box.x + box.pad, box.y + box.pad + box.lineHeight * (i + 0.5), box.w - box.pad * 2);
    });
    if (a.id === selectedId) {
      ctx.strokeStyle = '#4f83f5';
      ctx.lineWidth = Math.max(2, Math.round(width / 300));
      ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
      roundRect(ctx, box.x, box.y, box.w, box.h, Math.round(box.fontPx * 0.25));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The topmost annotation whose box contains the pixel point, or null. */
export function hitTest(ctx, annotations, width, height, px, py) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const b = layoutAnnotation(ctx, annotations[i], width, height);
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return annotations[i];
  }
  return null;
}
