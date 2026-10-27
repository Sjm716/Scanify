import * as db from './db.js';
import {
  applyAdjustments,
  defaultCorners,
  detectDocumentCorners,
  fullCorners,
  isConvexClockwise,
  outputSize,
  rotate90,
  warpPerspective,
} from './imaging.js';
import { buildPdf, PAGE_SIZES } from './pdf.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Longest side kept for the working copy of a photo, and for saved pages
// (2480px is A4 at 300 dpi).
const SOURCE_MAX = 3200;
const PAGE_MAX = 2480;
const PREVIEW_MAX = 1100;
const DETECT_MAX = 256;
const CLEAN_EDGE_TRIM = 0.012;

const QUALITY = {
  standard: { label: 'Standard', sub: 'Smaller file', maxSide: 1650, jpeg: 0.72 },
  high: { label: 'High', sub: 'Recommended', maxSide: 2200, jpeg: 0.85 },
  max: { label: 'Maximum', sub: 'Best for printing', maxSide: PAGE_MAX, jpeg: null },
};

const DEFAULT_SETTINGS = { brightness: 0, contrast: 0, filter: 'enhance', rotation: 0, cleanEdges: true };

const state = {
  view: 'home',
  groupId: null,
  editor: null,
  camera: null,
};

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

let toastTimer;
function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function busy(on, text = 'Working…') {
  $('#busy').hidden = !on;
  $('#busy-text').textContent = text;
}

/** Lets the browser paint (e.g. the spinner) before heavy synchronous work. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function defaultGroupName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function safeFileName(name) {
  return (name || 'Scanify').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Scanify';
}

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

function pref(key, fallback) {
  try {
    return localStorage.getItem(`scanify.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key, value) {
  try {
    localStorage.setItem(`scanify.${key}`, value);
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

const ICONS = {
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  mail: '<path d="M3 6h18v12H3z M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  whatsapp: '<path fill="currentColor" d="M12 2.2A9.7 9.7 0 0 0 3.7 16.9L2.3 21.8l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.4 1 2.5.1.2 1.7 2.7 4.2 3.7 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3z"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  photos: '<path d="M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  rename: '<path d="M4 7V5h16v2M12 5v14M9 19h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

function menuItem(action, icon, label, sub = '', extra = '') {
  return `<button type="button" class="menu-item ${extra}" data-sheet-action="${action}">
    <span class="ico ${icon === 'whatsapp' ? 'whatsapp' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg></span>
    <span>${escapeHtml(label)}${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}</span>
  </button>`;
}

// Bottom sheet -------------------------------------------------------------

let sheetResolve = null;

/**
 * Opens a bottom sheet. `onAction(action, sheetEl)` is called for clicks on
 * [data-sheet-action]; returning a value (other than undefined) closes the
 * sheet and resolves the promise with it.
 */
function openSheet(html, onAction = (a) => a, onOpen) {
  closeSheet(null);
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  sheet.hidden = false;
  $('#sheet-backdrop').hidden = false;
  sheet.onclick = async (e) => {
    const btn = e.target.closest('[data-sheet-action]');
    if (!btn) return;
    const result = await onAction(btn.dataset.sheetAction, sheet, btn);
    if (result !== undefined) closeSheet(result);
  };
  onOpen?.(sheet);
  const focusable = sheet.querySelector('input, button');
  if (focusable && !isTouchDevice()) focusable.focus();
  return new Promise((resolve) => (sheetResolve = resolve));
}

function closeSheet(result = null) {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.innerHTML = '';
  $('#sheet-backdrop').hidden = true;
  const r = sheetResolve;
  sheetResolve = null;
  r?.(result);
}

$('#sheet-backdrop').addEventListener('click', () => closeSheet(null));

function confirmSheet(title, text, okLabel = 'Delete') {
  return openSheet(
    `<h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(text)}</p>
     <div class="sheet-actions">
       <button type="button" class="btn secondary" data-sheet-action="cancel">Cancel</button>
       <button type="button" class="btn danger" data-sheet-action="ok">${escapeHtml(okLabel)}</button>
     </div>`,
    (a) => a === 'ok'
  );
}

function promptSheet(title, value, okLabel = 'Save') {
  return openSheet(
    `<h2>${escapeHtml(title)}</h2>
     <form class="field" data-form><input type="text" name="v" value="${escapeHtml(value)}" maxlength="80" required></form>
     <div class="sheet-actions">
       <button type="button" class="btn secondary" data-sheet-action="cancel">Cancel</button>
       <button type="button" class="btn primary" data-sheet-action="ok">${escapeHtml(okLabel)}</button>
     </div>`,
    (a, sheet) => (a === 'ok' ? sheet.querySelector('input').value.trim() || value : null),
    (sheet) => {
      sheet.querySelector('[data-form]').onsubmit = (e) => {
        e.preventDefault();
        sheet.querySelector('[data-sheet-action="ok"]').click();
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function show(view) {
  if (state.view === 'home' && view !== 'home') history.pushState({ scanify: true }, '');
  state.view = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
}

window.addEventListener('popstate', () => {
  if (!$('#sheet').hidden) closeSheet(null);
  else if (state.view === 'camera') stopCamera(true);
  else if (state.view === 'editor') cancelEditor();
  else if (state.view === 'group') goHome();
  if (state.view !== 'home') history.pushState({ scanify: true }, '');
});

async function goHome() {
  state.groupId = null;
  show('home');
  await renderHome();
}

async function openGroup(id) {
  state.groupId = id;
  show('group');
  await renderGroup();
}

// ---------------------------------------------------------------------------
// Home: groups
// ---------------------------------------------------------------------------

const objectUrls = new Set();
function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}
function releaseUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls.clear();
}

async function renderHome() {
  releaseUrls();
  const groups = await db.listGroups();
  const list = $('#group-list');
  $('#home-empty').hidden = groups.length > 0;
  const cards = await Promise.all(
    groups.map(async (g) => {
      const [first, second] = await Promise.all(g.scanIds.slice(0, 2).map((id) => db.getScan(id)));
      const imgs =
        (second ? `<img class="behind" src="${blobUrl(second.thumb)}" alt="">` : '') +
        (first ? `<img src="${blobUrl(first.thumb)}" alt="">` : '<span class="ph"></span>');
      const pages = g.scanIds.length;
      return `<button type="button" class="group-card" data-group="${g.id}">
        <span class="stack">${imgs}</span>
        <span class="grow"><span class="name ellipsis" style="display:block">${escapeHtml(g.name)}</span>
        <span class="meta" style="display:block">${pages} page${pages === 1 ? '' : 's'} · ${formatDate(g.updatedAt)}</span></span>
      </button>`;
    })
  );
  list.innerHTML = cards.join('');
}

$('#group-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-group]');
  if (card) openGroup(card.dataset.group);
});

// ---------------------------------------------------------------------------
// Group view: pages
// ---------------------------------------------------------------------------

async function renderGroup() {
  const group = await db.getGroup(state.groupId);
  if (!group) return goHome();
  releaseUrls();
  const scans = await db.getScans(group);
  $('#group-title').textContent = group.name;
  $('#group-meta').textContent = `${scans.length} page${scans.length === 1 ? '' : 's'} · Updated ${formatDate(group.updatedAt)}`;
  $('#page-grid').innerHTML = scans
    .map(
      (s, i) => `<button type="button" class="page-card" data-scan="${s.id}" aria-label="Page ${i + 1}">
        <img src="${blobUrl(s.thumb)}" alt="">
        <span class="num">${i + 1}</span>
      </button>`
    )
    .join('');
  $('[data-action="share"]').disabled = scans.length === 0;
}

$('#page-grid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-scan]');
  if (card) pageMenu(card.dataset.scan);
});

async function pageMenu(scanId) {
  const group = await db.getGroup(state.groupId);
  const index = group.scanIds.indexOf(scanId);
  const last = group.scanIds.length - 1;
  const others = (await db.listGroups()).filter((g) => g.id !== group.id);
  const action = await openSheet(
    `<h2>Page ${index + 1}</h2><div class="menu">
      ${menuItem('edit', 'edit', 'Edit edges & print quality')}
      ${index > 0 ? menuItem('up', 'up', 'Move earlier') : ''}
      ${index < last ? menuItem('down', 'down', 'Move later') : ''}
      ${menuItem('move', 'folder', 'Move to another group')}
      ${menuItem('delete', 'trash', 'Delete page', '', 'danger')}
    </div>`
  );
  if (action === 'edit') {
    const scan = await db.getScan(scanId);
    await startEditor([scan.original], { source: 'edit', scan, groupId: group.id });
  } else if (action === 'up' || action === 'down') {
    const ids = group.scanIds.slice();
    const to = action === 'up' ? index - 1 : index + 1;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    await db.updateGroup(group.id, { scanIds: ids });
    await renderGroup();
  } else if (action === 'move') {
    const dest = await chooseGroup('Move page to', others);
    if (dest) {
      await db.moveScan(scanId, dest.id);
      toast(`Moved to “${dest.name}”`);
      await renderGroup();
    }
  } else if (action === 'delete') {
    if (await confirmSheet('Delete this page?', 'This cannot be undone.')) {
      await db.deleteScan(scanId);
      await renderGroup();
    }
  }
}

async function groupMenu() {
  const group = await db.getGroup(state.groupId);
  const action = await openSheet(
    `<h2>${escapeHtml(group.name)}</h2><div class="menu">
      ${menuItem('rename', 'rename', 'Rename group')}
      ${menuItem('delete', 'trash', 'Delete group', 'Deletes all pages in it', 'danger')}
    </div>`
  );
  if (action === 'rename') {
    const name = await promptSheet('Rename group', group.name);
    if (name) {
      await db.updateGroup(group.id, { name });
      await renderGroup();
    }
  } else if (action === 'delete') {
    if (await confirmSheet(`Delete “${group.name}”?`, `All ${group.scanIds.length} pages will be deleted.`)) {
      await db.deleteGroup(group.id);
      await goHome();
    }
  }
}

/**
 * Asks which group to use. Offers creating a new group plus the given
 * existing ones. Resolves to a group record or null.
 */
async function chooseGroup(title, groups) {
  const action = await openSheet(
    `<h2>${escapeHtml(title)}</h2><div class="menu">
      ${menuItem('new', 'plus', 'New group')}
      ${groups.map((g) => menuItem(`g:${g.id}`, 'folder', g.name, `${g.scanIds.length} page${g.scanIds.length === 1 ? '' : 's'}`)).join('')}
    </div>`
  );
  if (!action) return null;
  if (action === 'new') {
    const name = await promptSheet('Name the new group', defaultGroupName(), 'Create');
    return name ? db.createGroup(name) : null;
  }
  return groups.find((g) => `g:${g.id}` === action) || null;
}

// ---------------------------------------------------------------------------
// Image loading helpers
// ---------------------------------------------------------------------------

async function loadBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function scaledCanvas(source, maxSide) {
  const w = source.width || source.videoWidth, h = source.height || source.videoHeight;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function readPixels(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

function pixelsToCanvas(img, canvas = document.createElement('canvas')) {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return canvas;
}

function canvasToBlob(canvas, quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality)
  );
}

function detectCorners(source) {
  try {
    return detectDocumentCorners(readPixels(scaledCanvas(source, DETECT_MAX)));
  } catch {
    return null;
  }
}

/** Runs edge correction + print-quality settings on a canvas. */
function processPage(sourceCanvas, settings, maxSide) {
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const quad = settings.corners.map(([x, y]) => [x * w, y * h]);
  const size = outputSize(quad, maxSide);
  let img = warpPerspective(readPixels(sourceCanvas), quad, size.width, size.height, settings.cleanEdges ? CLEAN_EDGE_TRIM : 0);
  applyAdjustments(img, settings);
  img = rotate90(img, settings.rotation);
  return img;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#file-capture').click();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
    const video = $('#camera-video');
    video.srcObject = stream;
    state.camera = { stream, timer: null };
    show('camera');
    await video.play().catch(() => {});
    state.camera.timer = setInterval(updateCameraOverlay, 450);
  } catch (err) {
    console.warn('Camera unavailable, falling back to file capture', err);
    toast('Camera not available — opening your device camera instead');
    $('#file-capture').click();
  }
}

function stopCamera(goBack = false) {
  if (state.camera) {
    clearInterval(state.camera.timer);
    state.camera.stream.getTracks().forEach((t) => t.stop());
    state.camera = null;
  }
  $('#camera-video').srcObject = null;
  if (goBack) {
    if (state.groupId) openGroup(state.groupId);
    else goHome();
  }
}

/** Rectangle actually covered by the video inside its object-fit: contain box. */
function videoContentRect(video) {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(box.width / vw, box.height / vh);
  const w = vw * s, h = vh * s;
  const stage = video.parentElement.getBoundingClientRect();
  return { left: box.left - stage.left + (box.width - w) / 2, top: box.top - stage.top + (box.height - h) / 2, width: w, height: h };
}

function updateCameraOverlay() {
  const video = $('#camera-video');
  const overlay = $('#camera-overlay');
  const rect = videoContentRect(video);
  if (!rect) return;
  Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  overlay.setAttribute('viewBox', '0 0 100 100');
  const corners = detectCorners(video);
  overlay.querySelector('polygon').setAttribute('points', corners ? corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' ') : '');
  $('#camera-hint').textContent = corners ? 'Document found — hold steady and tap' : 'Fit the document in the frame';
}

async function capturePhoto() {
  const cam = state.camera;
  if (!cam) return;
  const video = $('#camera-video');
  let blob = null;
  busy(true, 'Capturing…');
  try {
    const track = cam.stream.getVideoTracks()[0];
    if ('ImageCapture' in window) {
      try {
        blob = await new window.ImageCapture(track).takePhoto();
      } catch {
        blob = null; // fall back to grabbing a video frame
      }
    }
    if (!blob) blob = await canvasToBlob(scaledCanvas(video, 4096), 0.95);
  } finally {
    busy(false);
  }
  stopCamera();
  await startEditor([blob], { source: 'camera', groupId: state.groupId });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

async function startEditor(blobs, { source, groupId = null, scan = null }) {
  state.editor = { queue: blobs, index: 0, source, groupId, scan };
  show('editor');
  await loadEditorItem();
}

async function loadEditorItem() {
  const ed = state.editor;
  busy(true, 'Finding edges…');
  await nextFrame();
  try {
    const blob = ed.queue[ed.index];
    const bitmap = await loadBitmap(blob);
    ed.blob = blob;
    ed.sourceCanvas = scaledCanvas(bitmap, SOURCE_MAX);
    ed.previewSource = scaledCanvas(ed.sourceCanvas, PREVIEW_MAX);
    bitmap.close?.();
    ed.settings = ed.scan
      ? { ...DEFAULT_SETTINGS, ...structuredClone(ed.scan.settings) }
      : { ...DEFAULT_SETTINGS, corners: detectCorners(ed.previewSource) || defaultCorners() };
    ed.warpCache = null;
  } catch (err) {
    console.error(err);
    busy(false);
    toast('Could not open that image');
    return finishEditor();
  }
  busy(false);

  const total = ed.queue.length;
  $('#editor-queue').textContent = total > 1 ? `${ed.index + 1} of ${total}` : '';
  $('#editor-title').textContent = ed.scan ? 'Edit page' : 'New scan';
  const retake = $('[data-action="editor-retake"]');
  retake.hidden = ed.source === 'edit';
  retake.textContent = ed.source === 'camera' ? 'Retake' : 'Skip';
  $('#clean-edges').checked = ed.settings.cleanEdges;
  $('#brightness').value = ed.settings.brightness;
  $('#contrast').value = ed.settings.contrast;
  syncFilterChips();
  drawCropCanvas();
  setTab('crop');
}

function setTab(tab) {
  const ed = state.editor;
  $$('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  });
  $$('.editor-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  ed.tab = tab;
  $('#editor-next').textContent = tab === 'crop' ? 'Next' : ed.scan ? 'Save changes' : 'Save';
  if (tab === 'crop') layoutCrop();
  else schedulePreview();
}

// Crop -----------------------------------------------------------------------

function drawCropCanvas() {
  const c = $('#crop-canvas');
  const src = state.editor.previewSource;
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  layoutCrop();
}

function layoutCrop() {
  const ed = state.editor;
  if (!ed || ed.tab === 'adjust') return;
  const stage = $('#crop-stage');
  const frame = $('#crop-frame');
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const { width, height } = ed.previewSource;
  const s = Math.min(availW / width, availH / height);
  frame.style.width = `${Math.floor(width * s)}px`;
  frame.style.height = `${Math.floor(height * s)}px`;
  const canvas = $('#crop-canvas');
  canvas.style.width = frame.style.width;
  canvas.style.height = frame.style.height;
  drawCropOverlay();
}

function drawCropOverlay() {
  const corners = state.editor.settings.corners;
  const svg = $('#crop-svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const pts = corners.map(([x, y]) => `${x * 100},${y * 100}`);
  svg.querySelector('.crop-poly').setAttribute('points', pts.join(' '));
  svg.querySelector('.crop-shade').setAttribute('d', `M0,0H100V100H0Z M${pts.join(' L')}Z`);
  $$('.handle').forEach((h) => {
    const [x, y] = corners[+h.dataset.corner];
    h.style.left = `${x * 100}%`;
    h.style.top = `${y * 100}%`;
  });
}

function drawLoupe([x, y]) {
  const loupe = $('#loupe');
  const src = state.editor.previewSource;
  const ctx = loupe.getContext('2d');
  const zoomSize = 40;
  const cx = x * src.width, cy = y * src.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, loupe.width, loupe.height);
  ctx.drawImage(src, cx - zoomSize / 2, cy - zoomSize / 2, zoomSize, zoomSize, 0, 0, loupe.width, loupe.height);
  ctx.strokeStyle = '#4f83f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(loupe.width / 2, 0);
  ctx.lineTo(loupe.width / 2, loupe.height);
  ctx.moveTo(0, loupe.height / 2);
  ctx.lineTo(loupe.width, loupe.height / 2);
  ctx.stroke();
  // Keep the loupe away from the finger.
  loupe.style.left = x < 0.5 ? 'auto' : '12px';
  loupe.style.right = x < 0.5 ? '12px' : 'auto';
}

function initCropHandles() {
  for (const handle of $$('.handle')) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      $('#loupe').hidden = false;
      const k = +handle.dataset.corner;
      const move = (ev) => {
        const r = $('#crop-frame').getBoundingClientRect();
        const p = [
          Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
        ];
        const corners = state.editor.settings.corners.slice();
        corners[k] = p;
        if (isConvexClockwise(corners)) {
          state.editor.settings.corners = corners;
          state.editor.warpCache = null;
          drawCropOverlay();
        }
        drawLoupe(p);
      };
      const up = () => {
        $('#loupe').hidden = true;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      drawLoupe(state.editor.settings.corners[k]);
    });
    // Keyboard nudging for accessibility.
    handle.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const k = +handle.dataset.corner;
      const step = e.shiftKey ? 0.02 : 0.005;
      const corners = state.editor.settings.corners.slice();
      corners[k] = [
        Math.max(0, Math.min(1, corners[k][0] + d[0] * step)),
        Math.max(0, Math.min(1, corners[k][1] + d[1] * step)),
      ];
      if (isConvexClockwise(corners)) {
        state.editor.settings.corners = corners;
        state.editor.warpCache = null;
        drawCropOverlay();
      }
    });
  }
}

// Adjust ---------------------------------------------------------------------

let previewPending = false;
function schedulePreview() {
  if (previewPending) return;
  previewPending = true;
  requestAnimationFrame(() => {
    previewPending = false;
    renderPreview();
  });
}

function renderPreview() {
  const ed = state.editor;
  if (!ed || ed.tab !== 'adjust') return;
  const s = ed.settings;
  // Warping is the expensive part; cache it while only the sliders change.
  const key = JSON.stringify([s.corners, s.cleanEdges]);
  if (!ed.warpCache || ed.warpCache.key !== key) {
    const src = ed.previewSource;
    const quad = s.corners.map(([x, y]) => [x * src.width, y * src.height]);
    const size = outputSize(quad, PREVIEW_MAX);
    ed.warpCache = { key, img: warpPerspective(readPixels(src), quad, size.width, size.height, s.cleanEdges ? CLEAN_EDGE_TRIM : 0) };
  }
  const base = ed.warpCache.img;
  let img = { width: base.width, height: base.height, data: new Uint8ClampedArray(base.data) };
  applyAdjustments(img, s);
  img = rotate90(img, s.rotation);
  const canvas = pixelsToCanvas(img, $('#preview-canvas'));
  // Fit the canvas into the stage while keeping its aspect ratio.
  const stage = canvas.parentElement;
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.min(availW / img.width, availH / img.height);
  canvas.style.width = `${Math.floor(img.width * k)}px`;
  canvas.style.height = `${Math.floor(img.height * k)}px`;
}

function syncFilterChips() {
  $$('[data-filter]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.filter === state.editor.settings.filter)));
}

// Save -----------------------------------------------------------------------

async function saveEditorItem() {
  const ed = state.editor;
  let groupId = ed.groupId;
  if (!groupId) {
    const group = await chooseGroup('Save scan to', await db.listGroups());
    if (!group) return;
    groupId = ed.groupId = group.id;
  }
  busy(true, 'Saving page…');
  await nextFrame();
  try {
    const page = pixelsToCanvas(processPage(ed.sourceCanvas, ed.settings, PAGE_MAX));
    const processed = await canvasToBlob(page, 0.92);
    const thumb = await canvasToBlob(scaledCanvas(page, 360), 0.8);
    const scan = {
      id: ed.scan?.id || db.newId(),
      groupId: ed.scan?.groupId || groupId,
      original: ed.blob,
      processed,
      thumb,
      width: page.width,
      height: page.height,
      settings: structuredClone(ed.settings),
      createdAt: ed.scan?.createdAt || Date.now(),
    };
    await db.saveScan(scan);
  } catch (err) {
    console.error(err);
    toast('Saving failed — your device may be low on storage');
    return;
  } finally {
    busy(false);
  }

  if (ed.index < ed.queue.length - 1) {
    ed.index++;
    toast(`Page saved (${ed.index} of ${ed.queue.length})`);
    await loadEditorItem();
    return;
  }
  const fromCamera = ed.source === 'camera';
  const edited = !!ed.scan;
  finishEditor(groupId);
  if (edited) {
    toast('Changes saved');
  } else if (fromCamera) {
    const next = await openSheet(
      `<h2>Page added</h2><p class="muted">Scan more pages of the same document to keep them together in this group.</p>
       <div class="menu">${menuItem('scan', 'camera', 'Scan next page')}${menuItem('done', 'folder', 'Done')}</div>`
    );
    if (next === 'scan') openCamera();
  } else {
    toast(ed.queue.length > 1 ? `${ed.queue.length} pages saved` : 'Page saved');
  }
}

function finishEditor(groupId = state.editor?.groupId) {
  state.editor = null;
  $('#loupe').hidden = true;
  if (groupId) openGroup(groupId);
  else goHome();
}

function cancelEditor() {
  closeSheet(null);
  finishEditor(state.editor?.scan ? state.editor.groupId : state.groupId);
}

async function editorRetake() {
  const ed = state.editor;
  if (ed.source === 'camera') {
    state.editor = null;
    openCamera();
  } else if (ed.index < ed.queue.length - 1) {
    ed.index++;
    await loadEditorItem();
  } else {
    finishEditor(ed.groupId || state.groupId);
  }
}

// ---------------------------------------------------------------------------
// Export: PDF or JPG, save, email, WhatsApp
// ---------------------------------------------------------------------------

async function reencode(blob, q) {
  if (!q.jpeg) return blob;
  const bmp = await loadBitmap(blob);
  const c = scaledCanvas(bmp, q.maxSide);
  bmp.close?.();
  return canvasToBlob(c, q.jpeg);
}

const FORMATS = {
  pdf: { label: 'PDF' },
  jpg: { label: 'JPG images' },
};

async function makePdf(group, { pageSize, quality }) {
  const scans = await db.getScans(group);
  const q = QUALITY[quality] || QUALITY.high;
  const jpegs = [];
  for (const s of scans) jpegs.push(new Uint8Array(await (await reencode(s.processed, q)).arrayBuffer()));
  const bytes = buildPdf(jpegs, { pageSize, title: group.name });
  return new File([bytes], `${safeFileName(group.name)}.pdf`, { type: 'application/pdf' });
}

/** One JPG per page; a single page is named after the group alone. */
async function makeJpgs(group, { quality }) {
  const scans = await db.getScans(group);
  const q = QUALITY[quality] || QUALITY.high;
  const base = safeFileName(group.name);
  const files = [];
  for (const [i, s] of scans.entries()) {
    const name = scans.length === 1 ? `${base}.jpg` : `${base} - page ${i + 1}.jpg`;
    files.push(new File([await reencode(s.processed, q)], name, { type: 'image/jpeg' }));
  }
  return files;
}

/** Builds the export as a list of files: one PDF, or one JPG per page. */
async function makeExport(group, opts) {
  return opts.format === 'jpg' ? makeJpgs(group, opts) : [await makePdf(group, opts)];
}

/** Human wording for what is being sent, e.g. "PDF", "image", "3 images". */
function describeFiles(files) {
  if (files[0].type === 'application/pdf') return 'PDF';
  return files.length === 1 ? 'image' : `${files.length} images`;
}

function downloadFiles(files) {
  // Space the clicks out a little: browsers drop rapid back-to-back downloads.
  files.forEach((file, i) =>
    setTimeout(() => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, i * 300)
  );
}

function canShareFiles(files) {
  try {
    return !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

async function shareFiles(files, text) {
  try {
    await navigator.share({ files, title: files.length === 1 ? files[0].name : undefined, text });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') return true; // user closed the share sheet
    console.warn('Share failed', err);
    return false;
  }
}

async function saveToDevice(files) {
  const what = describeFiles(files);
  if (window.showSaveFilePicker && !isTouchDevice() && files.length === 1) {
    const [file] = files;
    const type =
      file.type === 'application/pdf'
        ? { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }
        : { description: 'JPG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } };
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: file.name, types: [type] });
      const w = await handle.createWritable();
      await w.write(file);
      await w.close();
      toast(`${what} saved`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  // On phones the share sheet offers "Save to Files" / "Save image".
  if (isTouchDevice() && canShareFiles(files) && (await shareFiles(files))) return;
  downloadFiles(files);
  toast(`${what} downloaded`);
}

async function sendEmail(files, group) {
  const what = describeFiles(files);
  const subject = `${group.name} (${files[0].type === 'application/pdf' ? 'PDF' : 'JPG'})`;
  const names = files.map((f) => `“${f.name}”`).join(', ');
  const body = `Hi,\n\nPlease find ${names} attached (${group.scanIds.length} page${group.scanIds.length === 1 ? '' : 's'}), scanned with Scanify.\n`;
  if (canShareFiles(files) && (await shareFiles(files, body))) return;
  // mailto: links can't carry attachments, so download the files for the
  // user to attach and open a pre-filled email.
  downloadFiles(files);
  toast(`${what} downloaded — attach to the email that just opened`, 5000);
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n(Attach the downloaded files.)')}`;
}

async function sendWhatsApp(files, group) {
  const what = describeFiles(files);
  const text = `${group.name} — ${what} from Scanify`;
  // On phones, the share sheet sends the actual files; pick WhatsApp in it.
  if (isTouchDevice() && canShareFiles(files) && (await shareFiles(files, text))) return;
  // Elsewhere, open WhatsApp (app or web) with a prefilled message and
  // download the files so they can be attached to the chat.
  downloadFiles(files);
  toast(`${what} downloaded — attach in the WhatsApp chat`, 5000);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function exportSheet() {
  const group = await db.getGroup(state.groupId);
  if (!group?.scanIds.length) return;
  const pages = group.scanIds.length;
  const opts = {
    format: pref('format', 'pdf'),
    pageSize: pref('pageSize', 'a4'),
    quality: pref('quality', 'high'),
  };
  let exportPromise = null;
  const rebuild = () => {
    exportPromise = makeExport(group, opts);
    exportPromise.catch(() => {});
  };
  // Build the files up front so share buttons can call navigator.share while
  // the tap still counts as a user gesture.
  rebuild();

  const seg = (name, options, current) =>
    `<div class="seg" data-seg="${name}">${Object.entries(options)
      .map(([k, v]) => `<button type="button" class="chip" role="radio" data-value="${k}" aria-checked="${k === current}">${escapeHtml(v.label)}</button>`)
      .join('')}</div>`;

  // Wording that follows the chosen format.
  const summary = () =>
    opts.format === 'jpg'
      ? `${pages} page${pages === 1 ? '' : 's'} as ${pages === 1 ? 'a JPG image' : `${pages} JPG images`}`
      : `${pages} page${pages === 1 ? '' : 's'} in one PDF`;
  const noun = () => (opts.format === 'jpg' ? (pages === 1 ? 'image' : 'images') : 'PDF');
  const syncLabels = (sheet) => {
    sheet.querySelector('[data-summary]').textContent = summary();
    sheet.querySelector('[data-page-size]').hidden = opts.format === 'jpg';
    sheet.querySelector('[data-sub="save"]').textContent = `Download the ${noun()}`;
    sheet.querySelector('[data-sub="email"]').textContent = `Send the ${noun()} as ${pages === 1 || opts.format === 'pdf' ? 'an attachment' : 'attachments'}`;
    sheet.querySelector('[data-sub="whatsapp"]').textContent = `Send the ${noun()} in a chat`;
  };

  await openSheet(
    `<h2>Export “${escapeHtml(group.name)}”</h2>
     <p class="muted small" data-summary></p>
     <div class="field">Format ${seg('format', FORMATS, opts.format)}</div>
     <div class="field" data-page-size>Page size ${seg('pageSize', PAGE_SIZES, opts.pageSize)}</div>
     <div class="field">Quality ${seg('quality', QUALITY, opts.quality)}</div>
     <div class="menu">
       ${menuItem('save', 'download', 'Save to device', '…')}
       ${menuItem('email', 'mail', 'Email', '…')}
       ${menuItem('whatsapp', 'whatsapp', 'WhatsApp', '…')}
       ${navigator.share ? menuItem('share', 'share', 'More sharing options') : ''}
     </div>`,
    async (action) => {
      let files;
      try {
        files = await exportPromise;
      } catch (err) {
        console.error(err);
        toast(`Could not create the ${noun()}`);
        return null;
      }
      if (action === 'save') await saveToDevice(files);
      else if (action === 'email') await sendEmail(files, group);
      else if (action === 'whatsapp') await sendWhatsApp(files, group);
      else if (action === 'share') {
        if (!(canShareFiles(files) && (await shareFiles(files)))) downloadFiles(files);
      } else return undefined;
      return action;
    },
    (sheet) => {
      for (const a of ['save', 'email', 'whatsapp']) {
        sheet.querySelector(`[data-sheet-action="${a}"] .sub`).dataset.sub = a;
      }
      syncLabels(sheet);
      sheet.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-seg] .chip');
        if (!chip) return;
        const name = chip.parentElement.dataset.seg;
        opts[name] = chip.dataset.value;
        setPref(name, chip.dataset.value);
        $$('.chip', chip.parentElement).forEach((c) => c.setAttribute('aria-checked', String(c === chip)));
        syncLabels(sheet);
        rebuild();
      });
    }
  );
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function importFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name));
  if (!images.length) return;
  closeSheet(null);
  stopCamera();
  await startEditor(images, { source: 'import', groupId: state.groupId });
}

$('#file-import').addEventListener('change', (e) => {
  importFiles(e.target.files);
  e.target.value = '';
});
$('#file-capture').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (file) await startEditor([file], { source: 'camera', groupId: state.groupId });
});

const actions = {
  home: goHome,
  scan: () => {
    state.groupId = null;
    openCamera();
  },
  import: () => $('#file-import').click(),
  'group-menu': groupMenu,
  'group-add': async () => {
    const a = await openSheet(
      `<h2>Add a page</h2><div class="menu">${menuItem('scan', 'camera', 'Scan with camera')}${menuItem('import', 'photos', 'Import photos')}</div>`
    );
    if (a === 'scan') openCamera();
    else if (a === 'import') $('#file-import').click();
  },
  share: exportSheet,
  'camera-close': () => stopCamera(true),
  capture: capturePhoto,
  'editor-cancel': cancelEditor,
  'editor-retake': editorRetake,
  'editor-next': () => (state.editor.tab === 'crop' ? setTab('adjust') : saveEditorItem()),
  'crop-auto': () => {
    const ed = state.editor;
    const corners = detectCorners(ed.previewSource);
    if (!corners) toast('No clear document edges found — drag the corners into place');
    ed.settings.corners = corners || defaultCorners();
    ed.warpCache = null;
    drawCropOverlay();
  },
  'crop-full': () => {
    state.editor.settings.corners = fullCorners();
    state.editor.warpCache = null;
    drawCropOverlay();
  },
  'rotate-left': () => {
    state.editor.settings.rotation = (state.editor.settings.rotation + 3) % 4;
    schedulePreview();
  },
  'rotate-right': () => {
    state.editor.settings.rotation = (state.editor.settings.rotation + 1) % 4;
    schedulePreview();
  },
  'adjust-reset': () => {
    const s = state.editor.settings;
    Object.assign(s, { brightness: 0, contrast: 0, filter: DEFAULT_SETTINGS.filter, rotation: 0 });
    $('#brightness').value = 0;
    $('#contrast').value = 0;
    syncFilterChips();
    schedulePreview();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action]();
});

$$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
$$('[data-filter]').forEach((c) =>
  c.addEventListener('click', () => {
    state.editor.settings.filter = c.dataset.filter;
    syncFilterChips();
    schedulePreview();
  })
);
for (const id of ['brightness', 'contrast']) {
  $(`#${id}`).addEventListener('input', (e) => {
    state.editor.settings[id] = +e.target.value;
    schedulePreview();
  });
}
$('#clean-edges').addEventListener('change', (e) => {
  state.editor.settings.cleanEdges = e.target.checked;
  state.editor.warpCache = null;
});
window.addEventListener('resize', () => {
  if (state.view !== 'editor') return;
  if (state.editor?.tab === 'crop') layoutCrop();
  else schedulePreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(null);
});

initCropHandles();
renderHome();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // When an update takes over from an older version, reload once so the new
  // files are used straight away — unless the user is in the middle of a scan.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || state.view === 'camera' || state.view === 'editor') return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Installed apps are often resumed rather than relaunched, so also look
      // for updates whenever Scanify comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Service worker not registered', err));
}

// Exposed for automated tests.
window.scanify = { state, db };
