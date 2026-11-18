import {
  pickMimeType,
  extensionFor,
  formatDuration,
  formatBytes,
  defaultName,
  safeFileName,
  Stopwatch,
} from './core.js';
import { saveRecording, deleteRecording, listRecordings } from './db.js';

const $ = (id) => document.getElementById(id);
const views = ['unsupported', 'view-ready', 'view-countdown', 'view-recording', 'view-result'];

// ---------- Options (remembered between visits) ----------
const OPTS_KEY = 'recorder.options';
const opts = { mic: false, systemAudio: true, camera: false, countdown: true };
try {
  Object.assign(opts, JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'));
} catch {
  /* storage blocked: defaults are fine */
}
const saveOpts = () => {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(opts));
  } catch {
    /* ignore */
  }
};

const canRecord = !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
const canBubble = !!document.pictureInPictureEnabled;

// ---------- Small UI helpers ----------
function show(id) {
  for (const v of views) $(v).hidden = v !== id;
}

let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

const BASE_TITLE = document.title;
const setTitle = (prefix) => (document.title = prefix ? `${prefix} – ${BASE_TITLE}` : BASE_TITLE);

// ---------- Option chips ----------
function renderChips() {
  for (const chip of document.querySelectorAll('[data-opt]')) {
    const key = chip.dataset.opt;
    chip.setAttribute('aria-pressed', String(!!opts[key]));
  }
}

for (const chip of document.querySelectorAll('[data-opt]')) {
  const key = chip.dataset.opt;
  if (key === 'camera' && !canBubble) {
    chip.disabled = true;
    chip.title = "This browser can't float the camera over other windows. Try Chrome, Edge or Safari.";
    opts.camera = false;
  }
  chip.addEventListener('click', async () => {
    opts[key] = !opts[key];
    saveOpts();
    renderChips();
    if (key === 'camera') {
      if (opts.camera) await startCamera();
      else stopCamera();
    }
    if (key === 'systemAudio' && opts.systemAudio) {
      $('option-note').textContent =
        'Tick "Share audio" in the next window to include sound. Tabs work everywhere; whole-screen sound works on Windows and ChromeOS.';
      $('option-note').hidden = false;
    } else {
      $('option-note').hidden = true;
    }
  });
}

// ---------- Camera bubble ----------
let camStream = null;

async function startCamera() {
  if (camStream) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
      audio: false,
    });
    $('camera-preview').srcObject = camStream;
    $('camera-preview-wrap').hidden = false;
  } catch {
    camStream = null;
    opts.camera = false;
    saveOpts();
    renderChips();
    toast('Camera unavailable. Check that the browser is allowed to use it.');
  }
}

function stopCamera() {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('camera-preview').srcObject = null;
  $('camera-preview-wrap').hidden = true;
}

function openBubble() {
  const video = $('camera-preview');
  if (!camStream || !canBubble || video.readyState < 1) return;
  video.requestPictureInPicture().catch(() => toast("Couldn't float the camera bubble."));
}

// ---------- Recording ----------
let session = null; // everything that belongs to the recording in progress

function stopTracks(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

function endSession() {
  if (!session) return;
  clearInterval(session.tick);
  cancelAnimationFrame(session.meterFrame);
  stopTracks(session.display);
  stopTracks(session.mic);
  session.audioCtx?.close().catch(() => {});
  $('screen-preview').srcObject = null;
  $('level-wrap').hidden = true;
  session.cancelCountdown?.();
}

async function startRecording() {
  const btn = $('btn-record');
  btn.disabled = true;
  const s = (session = { stopwatch: new Stopwatch(), started: new Date() });

  try {
    // Ask for the screen and pop out the camera in the same tick as the
    // click: both need a fresh user gesture.
    const displayRequest = navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: opts.systemAudio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: opts.systemAudio ? 'include' : 'exclude',
      monitorTypeSurfaces: 'include',
    });
    if (opts.camera) openBubble();
    s.display = await displayRequest;
  } catch (err) {
    session = null;
    btn.disabled = false;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    toast(err?.name === 'NotAllowedError' ? 'Nothing was recorded.' : `Couldn't start: ${err?.message || err}`);
    return;
  }

  // The screen picker is done; the rest can take its time.
  if (opts.mic) {
    try {
      s.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      toast('Microphone unavailable, so recording without it.');
    }
  }

  const [videoTrack] = s.display.getVideoTracks();
  videoTrack.addEventListener('ended', () => stopRecording());
  $('screen-preview').srcObject = new MediaStream([videoTrack]);

  // Mix computer sound and microphone into a single track.
  const audioTracks = [...s.display.getAudioTracks(), ...(s.mic?.getAudioTracks() || [])];
  let recordAudio = audioTracks;
  if (audioTracks.length > 1 || s.mic) {
    try {
      s.audioCtx = new AudioContext();
      const dest = s.audioCtx.createMediaStreamDestination();
      for (const track of audioTracks) {
        const src = s.audioCtx.createMediaStreamSource(new MediaStream([track]));
        src.connect(dest);
        if (s.mic && track === s.mic.getAudioTracks()[0]) startMeter(s, src);
      }
      recordAudio = dest.stream.getAudioTracks();
    } catch {
      recordAudio = audioTracks.slice(0, 1);
    }
  }
  if (opts.systemAudio && !s.display.getAudioTracks().length && !s.mic) {
    toast('No sound is being recorded. Tick "Share audio" in the picker to include it.', 5000);
  }

  if (opts.countdown && !(await countdown(s))) {
    endSession();
    session = null;
    btn.disabled = false;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    show('view-ready');
    return;
  }
  if (session !== s) return; // stopped during the countdown

  const stream = new MediaStream([videoTrack, ...recordAudio]);
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  const settings = { videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 };
  try {
    s.recorder = new MediaRecorder(stream, mimeType ? { ...settings, mimeType } : settings);
  } catch {
    s.recorder = new MediaRecorder(stream);
  }
  s.chunks = [];
  s.recorder.addEventListener('dataavailable', (e) => e.data.size && s.chunks.push(e.data));
  s.recorder.addEventListener('stop', () => finish(s));
  s.recorder.start(1000);
  s.stopwatch.start();

  show('view-recording');
  setPaused(false);
  btn.disabled = false;
  updateTimer();
  s.tick = setInterval(updateTimer, 250);
  setTimeout(() => grabThumbnail(s), 700);
}

function countdown(s) {
  return new Promise((resolve) => {
    let n = 3;
    const el = $('countdown-number');
    el.textContent = n;
    setTitle(`Starting in ${n}`);
    show('view-countdown');
    const timer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(timer);
        s.cancelCountdown = null;
        setTitle('');
        resolve(true);
      } else {
        el.textContent = n;
        setTitle(`Starting in ${n}`);
      }
    }, 1000);
    s.cancelCountdown = () => {
      clearInterval(timer);
      s.cancelCountdown = null;
      setTitle('');
      resolve(false);
    };
  });
}

function startMeter(s, source) {
  const analyser = s.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const bar = $('level-bar');
  $('level-wrap').hidden = false;
  const draw = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    bar.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
    s.meterFrame = requestAnimationFrame(draw);
  };
  draw();
}

function updateTimer() {
  if (!session) return;
  const text = formatDuration(session.stopwatch.elapsed() / 1000);
  $('timer').textContent = text;
  setTitle(session.paused ? `❚❚ ${text} paused` : `● ${text}`);
}

function setPaused(paused) {
  if (!session) return;
  session.paused = paused;
  $('live-badge').classList.toggle('paused', paused);
  $('live-label').textContent = paused ? 'PAUSED' : 'REC';
  $('btn-pause').textContent = paused ? 'Resume' : 'Pause';
  updateTimer();
}

function togglePause() {
  const r = session?.recorder;
  if (!r) return;
  if (r.state === 'recording') {
    r.pause();
    session.stopwatch.pause();
    setPaused(true);
  } else if (r.state === 'paused') {
    r.resume();
    session.stopwatch.start();
    setPaused(false);
  }
}

function stopRecording() {
  const s = session;
  if (!s) return;
  if (s.cancelCountdown) {
    s.cancelCountdown();
    return;
  }
  if (s.recorder && s.recorder.state !== 'inactive') {
    s.stopwatch.pause();
    s.recorder.stop(); // fires 'stop' -> finish()
  }
  endSession();
}

function grabThumbnail(s) {
  const video = $('screen-preview');
  if (session !== s || !video.videoWidth) return;
  const w = 320;
  const h = 180;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
  const dw = video.videoWidth * scale;
  const dh = video.videoHeight * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  canvas.toBlob((blob) => (s.thumb = blob), 'image/jpeg', 0.8);
}

async function finish(s) {
  if (session === s) session = null;
  setTitle('');
  stopCamera();
  const type = s.recorder.mimeType || 'video/webm';
  const blob = new Blob(s.chunks, { type });
  if (!blob.size) {
    toast('Nothing was captured. Please try again.');
    showReady();
    return;
  }
  const rec = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    name: defaultName(s.started),
    created: s.started.getTime(),
    duration: s.stopwatch.elapsed() / 1000,
    size: blob.size,
    mime: type,
    blob,
    thumb: s.thumb || null,
  };
  try {
    await saveRecording(rec);
    navigator.storage?.persist?.().catch(() => {});
    toast('Saved. Download it or keep it here for later.');
  } catch {
    toast("Couldn't save to this device (storage may be full). Download it now to keep it.", 6000);
    unsaved.set(rec.id, rec);
  }
  await renderLibrary(rec.id);
  showResult(rec);
}

// ---------- Result view ----------
let current = null;
let playerUrl = null;
const unsaved = new Map(); // recordings that couldn't be stored

function showResult(rec) {
  current = rec;
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(rec.blob);
  const player = $('player');
  player.src = playerUrl;
  // WebM files from MediaRecorder don't state their length, which breaks the
  // seek bar. Seeking far past the end makes the browser work it out.
  player.onloadedmetadata = () => {
    if (player.duration === Infinity) {
      player.currentTime = 1e101;
      player.ontimeupdate = () => {
        player.ontimeupdate = null;
        player.currentTime = 0;
      };
    }
  };
  $('rec-name').value = rec.name;
  renderMeta();
  const file = toFile(rec);
  $('btn-share').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  show('view-result');
  markCurrent();
}

function renderMeta() {
  const rec = current;
  const when = new Date(rec.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('rec-meta').textContent = [
    formatDuration(rec.duration),
    formatBytes(rec.size),
    extensionFor(rec.mime).toUpperCase(),
    when,
  ].join(' · ');
}

const toFile = (rec) =>
  new File([rec.blob], safeFileName(rec.name, extensionFor(rec.mime)), { type: rec.blob.type || rec.mime });

function download(rec) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(rec.blob);
  a.download = safeFileName(rec.name, extensionFor(rec.mime));
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function rename(name) {
  if (!current) return;
  current.name = name.trim() || defaultName(new Date(current.created));
  $('rec-name').value = current.name;
  if (!unsaved.has(current.id)) await saveRecording(current).catch(() => {});
  await renderLibrary(current.id);
}

function showReady() {
  current = null;
  $('player').removeAttribute('src');
  $('player').load();
  show(canRecord ? 'view-ready' : 'unsupported');
  markCurrent();
  if (opts.camera && canRecord) startCamera();
}

// ---------- Library ----------
let thumbUrls = [];
let libraryItems = [];

async function renderLibrary() {
  let items = [];
  try {
    items = await listRecordings();
  } catch {
    /* storage unavailable */
  }
  items = [...unsaved.values(), ...items];
  libraryItems = items;
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  const list = $('library-list');
  list.replaceChildren(
    ...items.map((rec) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      btn.dataset.id = rec.id;
      const img = document.createElement(rec.thumb ? 'img' : 'div');
      img.className = 'thumb';
      if (rec.thumb) {
        const url = URL.createObjectURL(rec.thumb);
        thumbUrls.push(url);
        img.src = url;
        img.alt = '';
      }
      const text = document.createElement('div');
      text.className = 'item-text';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = rec.name;
      const sub = document.createElement('div');
      sub.className = 'small muted';
      sub.textContent = `${new Date(rec.created).toLocaleDateString(undefined, {
        dateStyle: 'medium',
      })} · ${formatBytes(rec.size)}`;
      text.append(title, sub);
      const dur = document.createElement('span');
      dur.className = 'item-dur';
      dur.textContent = formatDuration(rec.duration);
      btn.append(img, text, dur);
      btn.addEventListener('click', () => {
        if (session) return toast('Stop the current recording first.');
        showResult(rec);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      li.append(btn);
      return li;
    })
  );
  $('library').hidden = items.length === 0;
  markCurrent();
}

function markCurrent() {
  for (const btn of document.querySelectorAll('#library-list .item')) {
    btn.setAttribute('aria-current', String(!!current && btn.dataset.id === current.id));
  }
}

// ---------- Wire up ----------
$('btn-record').addEventListener('click', startRecording);
$('btn-pause').addEventListener('click', togglePause);
$('btn-stop').addEventListener('click', stopRecording);
$('btn-cancel-countdown').addEventListener('click', stopRecording);
$('btn-download').addEventListener('click', () => current && download(current));
$('btn-share').addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.share({ files: [toFile(current)], title: current.name });
  } catch (err) {
    if (err?.name !== 'AbortError') toast("Couldn't share. Try Download instead.");
  }
});
$('btn-delete').addEventListener('click', async () => {
  if (!current || !confirm(`Delete "${current.name}"? This can't be undone.`)) return;
  unsaved.delete(current.id);
  await deleteRecording(current.id).catch(() => {});
  await renderLibrary();
  toast('Recording deleted.');
  showReady();
});
$('btn-new').addEventListener('click', showReady);
$('rec-name').addEventListener('change', (e) => rename(e.target.value));
$('rec-name').addEventListener('keydown', (e) => e.key === 'Enter' && e.target.blur());

window.addEventListener('beforeunload', (e) => {
  if (session) {
    e.preventDefault();
    e.returnValue = '';
  }
});

renderChips();
showReady();
renderLibrary();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Exposed for the end-to-end test.
window.__recorder = { get session() { return session; }, get items() { return libraryItems; } };
