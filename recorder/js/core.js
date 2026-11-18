// Pure helpers for the screen recorder. No DOM access, so they run under
// Node's test runner as well as in the browser.

// Formats, best first. MP4 plays everywhere and stores its length, so it is
// preferred where the browser can record it (Chrome 126+, Edge, Safari).
// WebM is the fallback (Firefox, older Chrome).
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** First MIME type the recorder supports, or '' to let the browser choose. */
export function pickMimeType(isSupported) {
  for (const type of MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* some browsers throw on unknown codecs */
    }
  }
  return '';
}

/** File extension for a MIME type such as "video/webm;codecs=vp9". */
export function extensionFor(mime) {
  const m = mime || '';
  if (/quicktime/i.test(m)) return 'mov'; // iPhone screen recordings
  if (/mp4|m4v/i.test(m)) return 'mp4';
  return 'webm';
}

/** MIME type for an imported file, using its name when the browser gives no type. */
export function mimeForFile(type, name) {
  if (type) return type;
  const ext = String(name || '').split('.').pop().toLowerCase();
  return { mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' }[ext] || '';
}

/** True for files that look like videos, by type or by name. */
export function isVideoFile(type, name) {
  return /^video\//.test(type || '') || /\.(mov|mp4|m4v|webm)$/i.test(name || '');
}

/** File name without its extension, for naming imported videos. */
export function baseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}

/**
 * 'ios', 'android' or '' for other devices. iPads report a Mac user agent,
 * so a "Mac" with a touch screen counts as iOS.
 */
export function phoneKind(userAgent = '', platform = '', maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (platform === 'MacIntel' && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return '';
}

/** 75 -> "1:15", 3725 -> "1:02:05". Takes seconds. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 1536 -> "1.5 KB", 5_400_000 -> "5.1 MB". */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Math.max(0, bytes || 0);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

/** Default name for a recording made at `date`: "Recording 2026-11-18 at 14.05.09". */
export function defaultName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `Recording ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    ` at ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}`
  );
}

/** Makes a name safe to use as a file name on Windows, macOS and Linux. */
export function safeFileName(name, ext) {
  const base =
    String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 120) || 'Recording';
  return `${base}.${ext}`;
}

/**
 * Tracks recorded time across pauses. `now` is injectable for tests.
 * elapsed() returns milliseconds actually recorded.
 */
export class Stopwatch {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.total = 0;
    this.since = null;
  }
  start() {
    if (this.since === null) this.since = this.now();
  }
  pause() {
    if (this.since !== null) {
      this.total += this.now() - this.since;
      this.since = null;
    }
  }
  get running() {
    return this.since !== null;
  }
  elapsed() {
    return this.total + (this.since === null ? 0 : this.now() - this.since);
  }
}
