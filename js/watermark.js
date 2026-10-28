// The red gas pump stamped into the corner of fuel log photos, so they are
// easy to spot among other pictures in a photo album.

// Same drawing as the app's pump icon, on a 24x24 grid.
const PUMP_BODY = 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16zM6.5 6v4h5V6z';
const PUMP_BASE = 'M2.5 21h13';
const PUMP_HOSE = 'M14 9h1.5A1.5 1.5 0 0 1 17 10.5V16a1.5 1.5 0 0 0 3 0V8.5L17.5 6';

const RED = '#e53935';

/**
 * Where the badge goes on a photo, sized from the photo's shorter side so it
 * looks the same at any resolution.
 *
 * Photo apps (Google Photos, iPhone Photos) show grid thumbnails as a square
 * cut from the middle of the photo, so the badge is kept inside that square:
 * at the right edge of the square, with its centre a third of the way down.
 */
export function fuelBadgeBox(width, height) {
  const short = Math.min(width, height);
  const size = Math.max(24, Math.round(short * 0.09));
  const margin = Math.round(short * 0.025);
  const squareLeft = (width - short) / 2;
  const squareTop = (height - short) / 2;
  const x = Math.round(squareLeft + short - margin - size);
  const y = Math.round(Math.max(squareTop + margin, height / 3 - size / 2));
  return { x, y, size };
}

/** Draws the fuel badge onto a photo's 2D context. */
export function drawFuelBadge(ctx, width, height) {
  const { x, y, size } = fuelBadgeBox(width, height);
  ctx.save();
  // White tile so the pump reads on dark and busy backgrounds alike.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.beginPath();
  // roundRect is missing on older iPhones (before iOS 16); a square works too.
  if (ctx.roundRect) ctx.roundRect(x, y, size, size, size * 0.22);
  else ctx.rect(x, y, size, size);
  ctx.fill();
  // Pump artwork, inset within the tile.
  const pad = size * 0.14;
  ctx.translate(x + pad, y + pad);
  ctx.scale((size - pad * 2) / 24, (size - pad * 2) / 24);
  ctx.fillStyle = RED;
  ctx.strokeStyle = RED;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fill(new Path2D(PUMP_BODY), 'evenodd');
  ctx.lineWidth = 2;
  ctx.stroke(new Path2D(PUMP_BASE));
  ctx.lineWidth = 1.8;
  ctx.stroke(new Path2D(PUMP_HOSE));
  ctx.restore();
}
