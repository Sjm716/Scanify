import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPdf, jpegSize } from '../js/pdf.js';

const RGB_4x3 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkKKKK8U/TD//Z', 'base64');
const GRAY_2x5 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAFAAIBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==', 'base64');

test('reads JPEG dimensions and components', () => {
  assert.deepEqual(jpegSize(RGB_4x3), { width: 4, height: 3, components: 3 });
  assert.deepEqual(jpegSize(GRAY_2x5), { width: 2, height: 5, components: 1 });
});

test('builds a multi-page PDF with a valid xref table', () => {
  const pdf = buildPdf([RGB_4x3, GRAY_2x5], { pageSize: 'a4', title: 'Tax (2026) — receipts' });
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/ColorSpace \/DeviceGray/);
  assert.match(text, /\/Title \(Tax \\\(2026\\\) \? receipts\)/);
  // Landscape image gets a landscape A4 page.
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);

  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  const entries = text.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`);
  });
});

test('pdfinfo accepts the generated file', (t) => {
  let out;
  const dir = mkdtempSync(join(tmpdir(), 'scanify-'));
  const file = join(dir, 'out.pdf');
  writeFileSync(file, buildPdf([RGB_4x3, GRAY_2x5, RGB_4x3], { pageSize: 'letter' }));
  try {
    out = execFileSync('pdfinfo', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') return t.skip('pdfinfo not installed');
    throw err;
  }
  assert.match(out, /Pages:\s+3/);
});
