import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickMimeType,
  extensionFor,
  formatDuration,
  formatBytes,
  defaultName,
  safeFileName,
  Stopwatch,
} from '../recorder/js/core.js';

test('pickMimeType prefers MP4, falls back to WebM, then to the browser default', () => {
  assert.equal(pickMimeType(() => true), 'video/mp4;codecs=avc1,mp4a.40.2');
  assert.equal(pickMimeType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType((t) => { if (t.includes('mp4')) throw new Error('x'); return true; }), 'video/webm;codecs=vp9,opus');
});

test('extensionFor', () => {
  assert.equal(extensionFor('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionFor('video/webm;codecs=vp9'), 'webm');
  assert.equal(extensionFor(''), 'webm');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(75.9), '1:15');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(Infinity), '0:00');
  assert.equal(formatDuration(-4), '0:00');
});

test('formatBytes', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5_400_000), '5.1 MB');
  assert.equal(formatBytes(300 * 1024 * 1024), '300 MB');
});

test('defaultName and safeFileName', () => {
  const name = defaultName(new Date(2026, 10, 18, 14, 5, 9));
  assert.equal(name, 'Recording 2026-11-18 at 14.05.09');
  assert.equal(safeFileName(name, 'mp4'), 'Recording 2026-11-18 at 14.05.09.mp4');
  assert.equal(safeFileName('a/b:c?  d', 'webm'), 'a-b-c- d.webm');
  assert.equal(safeFileName('   ', 'mp4'), 'Recording.mp4');
  assert.equal(safeFileName('..hidden', 'mp4'), 'hidden.mp4');
});

test('Stopwatch skips paused time', () => {
  let t = 0;
  const sw = new Stopwatch(() => t);
  sw.start();
  t = 1000;
  sw.pause();
  t = 5000;
  assert.equal(sw.elapsed(), 1000);
  sw.start();
  sw.start(); // no effect while running
  t = 7500;
  assert.equal(sw.elapsed(), 3500);
  assert.equal(sw.running, true);
});

test('imports: .mov, file types from names, video detection', async () => {
  const { extensionFor, mimeForFile, isVideoFile, baseName } = await import('../recorder/js/core.js');
  assert.equal(extensionFor('video/quicktime'), 'mov');
  assert.equal(mimeForFile('', 'ScreenRecording_01.MOV'), 'video/quicktime');
  assert.equal(mimeForFile('video/mp4', 'x.mov'), 'video/mp4');
  assert.equal(mimeForFile('', 'notes.txt'), '');
  assert.equal(isVideoFile('', 'clip.m4v'), true);
  assert.equal(isVideoFile('video/3gpp', 'a'), true);
  assert.equal(isVideoFile('image/png', 'a.png'), false);
  assert.equal(baseName('Screen Recording 2026-11-18.mp4'), 'Screen Recording 2026-11-18');
});

test('phoneKind', async () => {
  const { phoneKind } = await import('../recorder/js/core.js');
  assert.equal(phoneKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(phoneKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), 'ios'); // iPad
  assert.equal(phoneKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), '');
  assert.equal(phoneKind('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140'), 'android');
  assert.equal(phoneKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), '');
});
