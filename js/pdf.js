// Minimal PDF writer that embeds JPEG pages directly (DCTDecode), so no
// re-encoding or third-party library is needed.

export const PAGE_SIZES = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'US Letter', width: 612, height: 792 },
  fit: { label: 'Fit to image', width: null, height: null },
};

const encoder = new TextEncoder();

/** Reads width/height from a baseline or progressive JPEG's SOF marker. */
export function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + len;
  }
  throw new Error('JPEG size not found');
}

/**
 * Builds a PDF with one JPEG per page.
 * @param {Uint8Array[]} jpegs
 * @param {{pageSize?: 'a4'|'letter'|'fit', margin?: number, title?: string}} opts
 * @returns {Uint8Array}
 */
export function buildPdf(jpegs, { pageSize = 'a4', margin = 0, title = 'Scanify document' } = {}) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (num, body) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    for (const b of [].concat(body)) push(b);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  // Object numbering: 1 catalog, 2 pages, 3 info, then 3 objects per page.
  const pageNums = jpegs.map((_, i) => 4 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${jpegs.length} >>`);
  obj(3, `<< /Title (${escapePdfString(title)}) /Producer (Scanify) >>`);

  jpegs.forEach((jpeg, i) => {
    const { width: iw, height: ih, components } = jpegSize(jpeg);
    const colorSpace = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    let pw, ph;
    const size = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
    if (size.width) {
      // Match the page orientation to the image.
      const landscape = iw > ih;
      pw = landscape ? size.height : size.width;
      ph = landscape ? size.width : size.height;
    } else {
      // Fit: page width of A4 (portrait) or A4 height (landscape), image aspect.
      const long = PAGE_SIZES.a4.height;
      const scale = long / Math.max(iw, ih);
      pw = iw * scale + margin * 2;
      ph = ih * scale + margin * 2;
    }
    const availW = pw - margin * 2, availH = ph - margin * 2;
    const s = Math.min(availW / iw, availH / ih);
    const dw = iw * s, dh = ih * s;
    const dx = (pw - dw) / 2, dy = (ph - dh) / 2;

    const [pageNum, contentNum, imageNum] = [pageNums[i], pageNums[i] + 1, pageNums[i] + 2];
    obj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(dy)} cm /Im0 Do Q`;
    obj(contentNum, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(imageNum, [
      `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace ${colorSpace} ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
  });

  const total = 4 + jpegs.length * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function f(n) {
  return Number(n.toFixed(2)).toString();
}

function escapePdfString(s) {
  // Keep to printable ASCII so the Info string stays valid PDFDocEncoding.
  return s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
}
