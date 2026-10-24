// Cutroom: a browser video editor. Plain JavaScript modules, no build step.
import { THEMES, Scene, findTheme, renderPreview } from './themes.js?v=4';
import { initPhoto, Photo, FILTERS, applyFilter, findFaces } from './photo.js?v=13';
import { VOICES, makeVoice, voiceName } from './voices.js?v=3';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const once = (el, ev) => new Promise(res => el.addEventListener(ev, res, { once: true }));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uidN = 0;
const uid = p => `${p}${++uidN}`;

function fmt(t, cs = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return cs ? `${base}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}` : base;
}

const CLIP_COLORS = ['#6c8cff', '#ff8a65', '#34c79a', '#f5b942', '#b67cff', '#3fb8f0', '#ff6f91'];
const W = 1920, H = 1080;

// ---------- state
const S = {
  sources: new Map(),      // id -> source (one imported or recorded file)
  segments: [],            // the edit: ordered pieces of sources {id, src, start, end}
  undo: [], redo: [],
  playhead: 0,
  playing: false,
  selection: null,         // {a, b} in timeline seconds
  zoom: 60,                // timeline pixels per second
  scroll: 0,
  enterHeld: false,
  theme: 'forest',
  framed: true,
  captions: { on: true, style: 'pop', pos: 'bottom', size: 1, color: '' },
  exporting: null,
  version: 0,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('cutroom.settings') || '{}');
    if (saved.theme) S.theme = saved.theme;
    if (typeof saved.framed === 'boolean') S.framed = saved.framed;
    if (saved.captions) Object.assign(S.captions, saved.captions);
  } catch {}
}
function saveSettings() {
  try { localStorage.setItem('cutroom.settings', JSON.stringify({ theme: S.theme, framed: S.framed, captions: S.captions })); } catch {}
}

// ---------- toast
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- a worker clock that keeps ticking when the tab is in the background
// (requestAnimationFrame stops in hidden tabs, which would freeze recordings and exports)
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
const tickListeners = new Set();
let lastRafAt = 0;
ticker.onmessage = () => {
  for (const f of tickListeners) f();
  // animation frames can pause even on a visible page (a covered window), so take over then
  if (performance.now() - lastRafAt > 120) frame(performance.now());
};

// ---------- audio graph: every clip plays through here so exports can capture the sound
let actx = null, master = null, exportDest = null;
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  actx = new AudioContext();
  master = actx.createGain();
  exportDest = actx.createMediaStreamDestination();
  master.connect(actx.destination);
  master.connect(exportDest);
  for (const src of S.sources.values()) wireSource(src);
}
function wireSource(src) {
  if (!actx || src.node) return;
  src.node = actx.createMediaElementSource(src.el);
  // every clip goes through its own voice slot, so a piece can sound like a robot (or anything else)
  src.voiceIn = actx.createGain();
  src.node.connect(src.voiceIn);
  src.voiceIn.connect(master);
  src.voiceId = 'normal';
  src.voiceChain = null;
}
function setSourceVoice(src, id) {
  if (!src.voiceIn || src.voiceId === id) return;
  src.voiceIn.disconnect();
  src.voiceChain?.stop();
  src.voiceChain = null;
  if (id === 'normal') src.voiceIn.connect(master);
  else {
    src.voiceChain = makeVoice(actx, id);
    src.voiceIn.connect(src.voiceChain.input);
    src.voiceChain.output.connect(master);
  }
  src.voiceId = id;
}
// keep the playing clip on the voice its piece asks for
function syncVoice() {
  if (!actx || !S.segments.length) return;
  const L = locate(S.playhead);
  const src = L && S.sources.get(L.seg.src);
  if (src) setSourceVoice(src, L.seg.voice || 'normal');
}
addEventListener('pointerdown', ensureAudio, { capture: true });
addEventListener('keydown', ensureAudio, { capture: true });

// ---------- modes (the 15 PetPost themes)
const scene = new Scene($('#scene'));

class Backdrop {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.w = w; this.h = h; this.t = 0;
  }
  set(theme) {
    if (this.theme?.id === theme.id) return;
    this.theme = theme;
    this.state = theme.setup(this.w, this.h);
  }
  step(dt) {
    if (!this.theme) return;
    this.t += dt;
    this.ctx.save();
    this.theme.frame(this.ctx, this.w, this.h, this.t, dt, this.state);
    this.ctx.restore();
  }
}
// The mode is drawn at half size behind the video and scaled up. The art is soft, so this
// looks the same and keeps playback smooth.
const backdrop = new Backdrop(W / 2, H / 2);

const TL = {};  // timeline colors, read from the current tone
function readTone() {
  const cs = getComputedStyle(document.body);
  for (const k of ['text', 'muted', 'faint', 'line', 'surface-2', 'surface-3', 'surface-solid']) TL[k] = cs.getPropertyValue('--' + k).trim();
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Captions sit on video, so a dark mode color gets lifted toward white until it reads clearly.
function brighten(hex) {
  let n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  for (let i = 0; i < 10 && luminance('#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')) < 0.28; i++) {
    r += (255 - r) * 0.18; g += (255 - g) * 0.18; b += (255 - b) * 0.18;
    r = Math.round(r); g = Math.round(g); b = Math.round(b);
  }
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function applyTheme(id) {
  const theme = findTheme(id);
  S.theme = theme.id;
  document.body.dataset.tone = theme.tone;
  const root = document.documentElement.style;
  root.setProperty('--accent', theme.accent);
  accent = brighten(theme.accent);
  root.setProperty('--on-accent', luminance(theme.accent) > 0.45 ? '#0d1117' : '#ffffff');
  scene.set(theme);
  backdrop.set(theme);
  $('#mode-chip-name').textContent = theme.name;
  $$('.mode-card').forEach(c => c.classList.toggle('active', c.dataset.mode === theme.id));
  readTone();
  tlDirty = true;
  saveSettings();
}

function buildModeGrid() {
  const grid = $('#mode-grid');
  grid.innerHTML = THEMES.map(t => `
    <button class="mode-card" data-mode="${t.id}">
      <canvas width="320" height="200" data-preview="${t.id}"></canvas>
      <div class="mc-name"><span>${esc(t.name)}</span><span class="mc-check"><svg class="i"><use href="#i-check"/></svg></span></div>
      <div class="mc-desc">${esc(t.desc)}</div>
    </button>`).join('');
  grid.querySelectorAll('canvas[data-preview]').forEach(c => renderPreview(findTheme(c.dataset.preview), c));
  grid.addEventListener('click', e => {
    const card = e.target.closest('.mode-card');
    if (!card) return;
    applyTheme(card.dataset.mode);
    toast(`${findTheme(card.dataset.mode).name} mode on`);
  });
  $$('.mode-card').forEach(c => c.classList.toggle('active', c.dataset.mode === S.theme));
}

// ---------- sources (files)
const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|oga|aac|flac|opus)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|ogv)$/i;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;
const isImage = f => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

async function importFiles(files) {
  const list = [...files];
  const img = list.find(isImage);
  if (img) { setView('photo'); Photo.open(img); }
  for (const f of list.filter(f => !isImage(f))) {
    if (Photo.isActive()) setView('video');
    const ok = /^(video|audio)\//.test(f.type) || AUDIO_EXT.test(f.name) || VIDEO_EXT.test(f.name);
    if (!ok) { toast(`${f.name} is not a video or audio file`); continue; }
    try { await addSource(f); }
    catch (err) { console.error(err); toast(`Could not open ${f.name}. Try MP4, MOV, WebM, MP3 or WAV.`); }
  }
}

function makeMediaEl(kind, url) {
  const el = document.createElement(kind);
  el.preload = 'auto';
  el.playsInline = true;
  el.src = url;
  el.addEventListener('seeked', () => {
    if (el._pending != null) { const t = el._pending; el._pending = null; el.currentTime = t; }
  });
  $('#media-pool').appendChild(el);
  return el;
}
function seekEl(el, t) {
  if (el.seeking) { el._pending = t; return; }
  if (Math.abs(el.currentTime - t) > 0.004) el.currentTime = t;
}

// Browser recordings (WebM) often report an unknown length until you seek to the end.
async function fixDuration(el) {
  if (isFinite(el.duration) && el.duration > 0) return;
  await new Promise(res => {
    const done = () => { el.removeEventListener('durationchange', check); res(); };
    const check = () => { if (isFinite(el.duration)) { el.currentTime = 0; done(); } };
    el.addEventListener('durationchange', check);
    el.currentTime = 1e101;
    setTimeout(done, 4000);
  });
}

async function addSource(file, opts = {}) {
  const url = URL.createObjectURL(file);
  const audioOnly = opts.kind === 'audio' || file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
  const el = makeMediaEl(audioOnly ? 'audio' : 'video', url);
  await new Promise((res, rej) => {
    el.addEventListener('loadedmetadata', res, { once: true });
    el.addEventListener('error', () => rej(new Error('Could not decode media')), { once: true });
  });
  await fixDuration(el);
  const isVideo = !audioOnly && el.videoWidth > 0;
  let duration = el.duration;
  if (!isFinite(duration) || duration <= 0) duration = opts.duration || 0;
  if (!duration) throw new Error('Media has no length');
  const src = {
    id: uid('s'),
    name: opts.name || file.name.replace(/\.[^.]+$/, ''),
    kind: isVideo ? 'video' : 'audio',
    file, url, el, duration,
    w: el.videoWidth || 16, h: el.videoHeight || 9,
    words: opts.words || [],
    frames: [], peaks: null, audio: null, thumb: null,
    color: CLIP_COLORS[S.sources.size % CLIP_COLORS.length],
    busy: '',
  };
  S.sources.set(src.id, src);
  wireSource(src);
  regroup(src);
  if (opts.at != null && opts.at < total() - 0.02) insertClip(src, opts.at); else appendClip(src);
  renderLibrary();
  analyze(src);
  return src;
}

function removeSource(src) {
  snapshot();
  S.segments = S.segments.filter(s => s.src !== src.id);
  S.sources.delete(src.id);
  src.el.pause();
  src.el.remove();
  setTimeout(() => URL.revokeObjectURL(src.url), 1000);
  afterEdit();
  renderLibrary();
}

async function analyze(src) {
  try {
    const buf = await src.file.arrayBuffer();
    src.audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
    src.peaks = computePeaks(src.audio);
  } catch { src.peaks = null; }
  tlDirty = true;
  if (src.kind === 'video') await makeFilmstrip(src);
  else renderLibrary();
}

function computePeaks(ab) {
  const rate = 100, per = Math.max(1, Math.floor(ab.sampleRate / rate));
  const chans = [...Array(Math.min(2, ab.numberOfChannels))].map((_, i) => ab.getChannelData(i));
  const len = chans[0].length, n = Math.ceil(len / per), out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const e = Math.min(len, (i + 1) * per);
    for (const ch of chans) for (let j = i * per; j < e; j += 3) { const v = Math.abs(ch[j]); if (v > m) m = v; }
    out[i] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] = Math.pow(out[i] / max, 0.8);
  return out;
}

async function makeFilmstrip(src) {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = src.url;
  $('#media-pool').appendChild(v);
  try {
    await Promise.race([once(v, 'loadeddata'), sleep(6000)]);
    const n = clamp(Math.ceil(src.duration / 1.5), 2, 90);
    const fh = 72, fw = Math.round(fh * (src.w / src.h));
    for (let i = 0; i < n; i++) {
      const t = Math.min(src.duration - 0.05, (i + 0.5) * src.duration / n);
      v.currentTime = t;
      await Promise.race([once(v, 'seeked'), sleep(1500)]);
      const c = document.createElement('canvas');
      c.width = fw; c.height = fh;
      c.getContext('2d').drawImage(v, 0, 0, fw, fh);
      src.frames.push({ t, c });
      if (i === 0 || i === Math.floor(n * 0.2)) { src.thumb = c.toDataURL('image/jpeg', 0.75); renderLibrary(); }
      if (i % 5 === 0) tlDirty = true;
    }
  } catch (err) { console.warn('filmstrip', err); }
  finally { v.removeAttribute('src'); v.remove(); }
  tlDirty = true;
  renderLibrary();
}

function renderLibrary() {
  const L = $('#library');
  $('#media-count').textContent = S.sources.size;
  if (!S.sources.size) { L.innerHTML = '<div class="library-empty">No media yet</div>'; return; }
  L.innerHTML = '';
  for (const s of S.sources.values()) {
    const card = document.createElement('div');
    card.className = 'media-card';
    const thumbStyle = s.thumb ? `style="background-image:url(${s.thumb})"` : '';
    card.innerHTML = `
      <div class="media-thumb ${s.kind === 'audio' ? 'audio' : ''}" ${thumbStyle}>
        ${s.thumb ? '' : `<svg class="i"><use href="#i-${s.kind === 'audio' ? 'wave' : 'film'}"/></svg>`}
        <span class="badge">${fmt(s.duration, false)}</span>
      </div>
      <div class="media-meta">
        <div class="media-name" title="${esc(s.name)}">${esc(s.name)}</div>
        <div class="media-sub">${s.busy ? `<span class="busy">${esc(s.busy)}</span>` : `${s.kind === 'audio' ? 'Audio' : `Video ${s.w}x${s.h}`}${s.words.length ? ` · ${s.words.length} words` : ''}`}</div>
      </div>
      <div class="media-actions">
        <button data-act="add" title="Add to timeline again"><svg class="i"><use href="#i-plus"/></svg></button>
        <button data-act="cap" title="Auto-caption this clip"><svg class="i"><use href="#i-cc"/></svg></button>
        <button data-act="del" title="Remove from project"><svg class="i"><use href="#i-trash"/></svg></button>
      </div>`;
    card.querySelector('[data-act=add]').onclick = () => { appendClip(s); toast('Added to the end of the timeline'); };
    card.querySelector('[data-act=cap]').onclick = () => autoCaption([s]);
    card.querySelector('[data-act=del]').onclick = () => removeSource(s);
    L.appendChild(card);
  }
}

// ---------- the edit (segments)
const total = () => S.segments.reduce((a, s) => a + (s.end - s.start), 0);

function locate(t) {
  let acc = 0;
  const n = S.segments.length;
  for (let i = 0; i < n; i++) {
    const s = S.segments[i], len = s.end - s.start;
    if (t < acc + len || i === n - 1) return { seg: s, i, tl0: acc, srcT: clamp(s.start + (t - acc), s.start, s.end) };
    acc += len;
  }
  return null;
}

function snapshot() {
  S.undo.push(JSON.stringify(S.segments));
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
}
function restore(json) {
  S.segments = JSON.parse(json).filter(s => S.sources.has(s.src));
  setSelection(null);
  afterEdit();
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.segments));
  restore(S.undo.pop());
  toast('Undone', 1200);
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.segments));
  restore(S.redo.pop());
  toast('Redone', 1200);
}

function insertClip(src, t) {
  snapshot();
  splitQuiet(t);
  let acc = 0, i = 0;
  while (i < S.segments.length && acc + 0.01 < t) { acc += S.segments[i].end - S.segments[i].start; i++; }
  S.segments.splice(i, 0, { id: uid('g'), src: src.id, start: 0, end: src.duration });
  S.playhead = acc;
  afterEdit();
}

function appendClip(src) {
  const wasEmpty = !S.segments.length;
  snapshot();
  S.segments.push({ id: uid('g'), src: src.id, start: 0, end: src.duration });
  afterEdit();
  if (wasEmpty) fitZoom();
}

function deleteRange(a, b) {
  if (a > b) [a, b] = [b, a];
  if (b - a < 0.02) return;
  const wasPlaying = S.playing;
  if (wasPlaying) pause();
  snapshot();
  const out = [];
  let acc = 0;
  for (const s of S.segments) {
    const len = s.end - s.start, t0 = acc, t1 = acc + len;
    acc = t1;
    if (t1 <= a || t0 >= b) { out.push(s); continue; }
    if (t0 < a) out.push({ ...s, id: uid('g'), end: s.start + (a - t0) });
    if (t1 > b) out.push({ ...s, id: uid('g'), start: s.start + (b - t0) });
  }
  S.segments = out.filter(s => s.end - s.start > 0.01);
  setSelection(null);
  S.playhead = Math.min(a, total());
  afterEdit();
  toast(`Deleted ${(b - a).toFixed(1)} seconds`, 1800);
}

function splitAt(t) {
  const L = locate(t);
  if (!L) return;
  const cut = L.srcT;
  if (cut - L.seg.start < 0.05 || L.seg.end - cut < 0.05) return;
  snapshot();
  S.segments.splice(L.i, 1, { ...L.seg, id: uid('g'), end: cut }, { ...L.seg, id: uid('g'), start: cut });
  afterEdit();
  toast('Split', 1000);
}

function afterEdit() {
  S.version++;
  tlWordsCache = null;
  activeSeg = null;
  S.playhead = clamp(S.playhead, 0, total());
  $('#t-total').textContent = fmt(total());
  $('#empty-state').hidden = S.segments.length > 0;
  $('#btn-undo').disabled = !S.undo.length;
  $('#btn-redo').disabled = !S.redo.length;
  renderTranscript();
  clampScroll();
  tlDirty = true;
  if (!S.playing) seekPreview();
}

function setSelection(sel) {
  if (sel && Math.abs(sel.b - sel.a) < 0.001 && !tlDrag) sel = null;
  S.selection = sel;
  $('#btn-delete').disabled = !sel || Math.abs(sel.b - sel.a) < 0.02;
  markTranscriptSelection();
  tlDirty = true;
}
const selRange = () => S.selection ? [Math.min(S.selection.a, S.selection.b), Math.max(S.selection.a, S.selection.b)] : null;

// ---------- captions data
// Words are stored per source in source time: {text, t0, t1}. Groups are the short phrases shown on screen.
function regroup(src) {
  const w = src.words;
  w.sort((a, b) => a.t0 - b.t0);
  let g = 0, count = 0;
  for (let i = 0; i < w.length; i++) {
    if (i > 0) {
      const prev = w[i - 1];
      if (count >= 5 || w[i].t0 - prev.t1 > 0.7 || /[.!?,]$/.test(prev.text)) { g++; count = 0; }
    }
    w[i].g = g;
    count++;
  }
}

let tlWordsCache = null;
function tlWords() {
  if (tlWordsCache) return tlWordsCache;
  const out = [];
  let acc = 0;
  S.segments.forEach((seg, si) => {
    const src = S.sources.get(seg.src);
    if (src) for (const w of src.words) {
      if (w.t0 >= seg.start - 0.01 && w.t0 < seg.end) {
        out.push({ w, src, si, a: acc + Math.max(0, w.t0 - seg.start), b: acc + Math.min(seg.end, w.t1) - seg.start });
      }
    }
    acc += seg.end - seg.start;
  });
  return (tlWordsCache = out);
}

// ---------- playback
let activeSeg = null;
let onPlaybackEnd = null;
let shuttle = null;  // arrow key hold state

function play() {
  if (!S.segments.length) return;
  ensureAudio();
  if (S.playhead >= total() - 0.03) S.playhead = 0;
  S.playing = true;
  syncMedia(true);
  updatePlayButton();
}
function pause() {
  S.playing = false;
  for (const s of S.sources.values()) s.el.pause();
  updatePlayButton();
}
function togglePlay() { S.playing ? pause() : play(); }

function syncMedia(force) {
  const L = locate(S.playhead);
  if (!L) return;
  const src = S.sources.get(L.seg.src);
  if (!src) return;
  for (const s of S.sources.values()) if (s !== src && !s.el.paused) s.el.pause();
  if (force || activeSeg !== L.seg.id) { activeSeg = L.seg.id; seekEl(src.el, L.srcT); }
  if (S.playing) { if (src.el.paused) src.el.play().catch(() => {}); }
  else if (!src.el.paused) src.el.pause();
}

function seekPreview() {
  const L = S.segments.length ? locate(S.playhead) : null;
  if (!L) return;
  const src = S.sources.get(L.seg.src);
  for (const s of S.sources.values()) if (s !== src && !s.el.paused) s.el.pause();
  activeSeg = L.seg.id;
  seekEl(src.el, L.srcT);
}

function seek(t) {
  S.playhead = clamp(t, 0, total());
  if (S.playing) syncMedia(true); else seekPreview();
}

function stepPlayback(dt) {
  if (S.playing) {
    const L = locate(S.playhead);
    if (!L) { pause(); return; }
    const src = S.sources.get(L.seg.src);
    if (!src) { pause(); return; }
    if (activeSeg !== L.seg.id) { syncMedia(true); return; }
    const el = src.el;
    if (el.seeking || el._pending != null) return;
    const ct = el.currentTime;
    if (ct >= L.seg.end - 0.02 || el.ended) {
      const next = S.segments[L.i + 1];
      if (!next) {
        S.playhead = total();
        pause();
        const cb = onPlaybackEnd; onPlaybackEnd = null;
        if (cb) cb();
        return;
      }
      S.playhead = L.tl0 + (L.seg.end - L.seg.start) + 0.0005;
      syncMedia(true);
      return;
    }
    S.playhead = L.tl0 + Math.max(0, ct - L.seg.start);
    if (el.paused && !el.ended) el.play().catch(() => {});
  } else if (shuttle && shuttle.dir < 0) {
    // play backward: walk the playhead back and show each frame
    const held = (performance.now() - shuttle.t0) / 1000;
    const speed = held > 2 ? 2 : 1;
    S.playhead = Math.max(0, S.playhead - dt * speed);
    seekPreview();
  }
}

function startShuttle(dir) {
  if (!S.segments.length || shuttle) return;
  shuttle = { dir, t0: performance.now(), from: S.playhead, wasPlaying: S.playing };
  if (dir > 0) { if (!S.playing) play(); }
  else if (S.playing) pause();
}
function stopShuttle() {
  const k = shuttle;
  shuttle = null;
  if (!k) return;
  const quick = performance.now() - k.t0 < 220;
  if (k.dir > 0 && !k.wasPlaying) pause();
  if (quick) seek(k.from + k.dir);
}

function updatePlayButton() {
  $('#btn-play use').setAttribute('href', S.playing ? '#i-pause' : '#i-play');
}

// ---------- preview drawing
const cv = $('#preview');
const cx = cv.getContext('2d');
let accent = '#2e7d4f';

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

function draw(dt) {
  cx.setTransform(1, 0, 0, 1, 0, 0);
  const framed = S.framed;
  if (framed) {
    backdrop.step(dt);
    cx.drawImage(backdrop.canvas, 0, 0, W, H);
  } else {
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, W, H);
  }
  const L = S.segments.length ? locate(S.playhead) : null;
  if (!L) return;
  const src = S.sources.get(L.seg.src);
  if (!src) return;

  const pad = framed ? 0.075 : 0;
  const area = { x: W * pad, y: H * pad, w: W * (1 - 2 * pad), h: H * (1 - 2 * pad) };
  let capArea = area;

  if (src.kind === 'video') {
    const ar = src.w / src.h;
    let w = area.w, h = w / ar;
    if (h > area.h) { h = area.h; w = h * ar; }
    const x = area.x + (area.w - w) / 2, y = area.y + (area.h - h) / 2, r = framed ? 26 : 0;
    if (framed) {
      cx.save();
      cx.shadowColor = 'rgba(0,0,0,0.42)'; cx.shadowBlur = 60; cx.shadowOffsetY = 22;
      cx.fillStyle = '#000'; rr(cx, x, y, w, h, r); cx.fill();
      cx.restore();
    }
    cx.save();
    rr(cx, x, y, w, h, r); cx.clip();
    cx.fillStyle = '#000'; cx.fillRect(x, y, w, h);
    if (src.el.readyState >= 2) cx.drawImage(L.seg.fx?.length ? fxFrame(src, L.seg) : src.el, x, y, w, h);
    cx.restore();
    capArea = { x, y, w, h };
  } else {
    drawAudioCard(src, L.srcT, area, framed);
  }
  if (S.captions.on) drawCaptions(L, src, capArea);
}

function drawAudioCard(src, t, area, framed) {
  const w = area.w * (framed ? 0.66 : 0.8), h = area.h * (framed ? 0.56 : 0.6);
  const x = area.x + (area.w - w) / 2, y = area.y + (area.h - h) / 2;
  cx.save();
  cx.shadowColor = 'rgba(0,0,0,0.35)'; cx.shadowBlur = 50; cx.shadowOffsetY = 18;
  cx.fillStyle = 'rgba(12,14,20,0.82)';
  rr(cx, x, y, w, h, 34); cx.fill();
  cx.restore();
  cx.strokeStyle = 'rgba(255,255,255,0.1)'; cx.lineWidth = 2;
  rr(cx, x, y, w, h, 34); cx.stroke();
  const bars = 56, gap = 8, bw = (w * 0.82 - gap * (bars - 1)) / bars, bx = x + w * 0.09, mid = y + h * 0.56;
  for (let i = 0; i < bars; i++) {
    const tt = t + (i - bars / 2) * 0.045;
    let v = 0.04;
    if (src.peaks && tt >= 0) v = Math.max(0.04, src.peaks[Math.floor(tt * 100)] || 0);
    const bh = v * h * 0.5;
    const center = Math.abs(i - bars / 2) < 1.5;
    cx.globalAlpha = i < bars / 2 ? 1 : 0.38;
    cx.fillStyle = center ? '#fff' : accent;
    rr(cx, bx + i * (bw + gap), mid - bh / 2, bw, bh, bw / 2); cx.fill();
  }
  cx.globalAlpha = 1;
  cx.fillStyle = '#fff';
  cx.font = '700 40px Inter, system-ui, sans-serif';
  cx.textAlign = 'left'; cx.textBaseline = 'alphabetic';
  cx.fillText(src.name, x + w * 0.09, y + h * 0.2);
  cx.fillStyle = 'rgba(255,255,255,0.55)';
  cx.font = '600 26px Inter, system-ui, sans-serif';
  cx.fillText(`${fmt(t, false)} / ${fmt(src.duration, false)}`, x + w * 0.09, y + h * 0.2 + 42);
}

function drawCaptions(L, src, A) {
  const words = src.words;
  if (!words.length) return;
  const t = L.srcT;
  let lo = 0, hi = words.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m].t0 <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return;
  const g = words[i].g;
  let j0 = i, j1 = i;
  while (j0 > 0 && words[j0 - 1].g === g) j0--;
  while (j1 < words.length - 1 && words[j1 + 1].g === g) j1++;
  const vis = words.slice(j0, j1 + 1).filter(w => w.t0 >= L.seg.start - 0.01 && w.t0 < L.seg.end);
  if (!vis.length) return;
  if (t > vis[vis.length - 1].t1 + 0.6) return;
  const cur = words[i];

  const st = S.captions.style;
  const hl = S.captions.color || accent;
  const upper = st === 'pop' || st === 'box';
  const k = S.captions.size * Math.max(0.55, A.w / 1650);
  const fs = ({ pop: 78, box: 72, glow: 70, clean: 52, karaoke: 70, minimal: 44 }[st] || 70) * k;
  const weight = { pop: 900, box: 900, glow: 800, clean: 600, karaoke: 800, minimal: 600 }[st] || 800;
  cx.font = `${weight} ${fs}px Inter, system-ui, sans-serif`;
  cx.textBaseline = 'middle';
  cx.textAlign = 'left';
  const items = vis.map(w => ({ w, text: upper ? w.text.toUpperCase() : w.text }));
  const space = cx.measureText(' ').width + fs * (st === 'box' ? 0.22 : 0.06);
  const grow = st === 'pop' ? 1.1 : 1;  // the spoken word is drawn a little bigger
  items.forEach(it => { it.width = cx.measureText(it.text).width * (it.w === cur ? grow : 1); });

  const maxW = A.w * 0.84;
  const lines = [[]];
  let lw = 0;
  for (const it of items) {
    const add = (lines[lines.length - 1].length ? space : 0) + it.width;
    if (lw + add > maxW && lines[lines.length - 1].length) { lines.push([it]); lw = it.width; }
    else { lines[lines.length - 1].push(it); lw += add; }
  }
  const lh = fs * 1.22, blockH = lines.length * lh;
  const pos = S.captions.pos;
  let y0 = pos === 'top' ? A.y + A.h * 0.08 : pos === 'middle' ? A.y + (A.h - blockH) / 2 : A.y + A.h * 0.92 - blockH;
  const cxm = A.x + A.w / 2;

  if (st === 'clean') {
    const widest = Math.max(...lines.map(l => l.reduce((a, it, n) => a + it.width + (n ? space : 0), 0)));
    cx.fillStyle = 'rgba(0,0,0,0.66)';
    rr(cx, cxm - widest / 2 - fs * 0.5, y0 - fs * 0.25, widest + fs, blockH + fs * 0.5, fs * 0.32);
    cx.fill();
  }

  lines.forEach((line, li) => {
    const lineW = line.reduce((a, it, n) => a + it.width + (n ? space : 0), 0);
    let x = cxm - lineW / 2;
    const y = y0 + li * lh + lh / 2;
    for (const it of line) {
      const isCur = it.w === cur, isPast = it.w.t0 < cur.t0;
      cx.save();
      if (st === 'pop') {
        cx.translate(x, y);
        if (isCur) cx.scale(grow, grow);
        cx.lineJoin = 'round';
        cx.lineWidth = fs * 0.2;
        cx.strokeStyle = '#000';
        cx.strokeText(it.text, 0, 0);
        cx.fillStyle = isCur ? hl : '#fff';
        cx.fillText(it.text, 0, 0);
      } else if (st === 'box') {
        cx.lineJoin = 'round';
        if (isCur) {
          const px = fs * 0.14;
          cx.fillStyle = hl;
          cx.shadowColor = 'rgba(0,0,0,0.35)'; cx.shadowBlur = fs * 0.2; cx.shadowOffsetY = fs * 0.06;
          rr(cx, x - px, y - fs * 0.62, it.width + px * 2, fs * 1.24, fs * 0.2); cx.fill();
          cx.shadowColor = 'transparent';
          cx.fillStyle = luminance(hl) > 0.4 ? '#000' : '#fff';
          cx.fillText(it.text, x, y);
        } else {
          cx.lineWidth = fs * 0.18; cx.strokeStyle = '#000';
          cx.strokeText(it.text, x, y);
          cx.fillStyle = '#fff';
          cx.fillText(it.text, x, y);
        }
      } else if (st === 'glow') {
        cx.shadowColor = hl; cx.shadowBlur = fs * (isCur ? 0.55 : 0.3);
        cx.fillStyle = isCur ? hl : '#fff';
        cx.fillText(it.text, x, y);
        cx.fillText(it.text, x, y);
      } else if (st === 'clean') {
        cx.fillStyle = isCur ? '#fff' : 'rgba(255,255,255,0.55)';
        cx.fillText(it.text, x, y);
      } else if (st === 'karaoke') {
        cx.shadowColor = 'rgba(0,0,0,0.7)'; cx.shadowBlur = fs * 0.25; cx.shadowOffsetY = fs * 0.05;
        cx.fillStyle = isCur || isPast ? hl : '#fff';
        cx.fillText(it.text, x, y);
      } else {
        cx.shadowColor = 'rgba(0,0,0,0.85)'; cx.shadowBlur = fs * 0.3; cx.shadowOffsetY = 2;
        cx.fillStyle = '#fff';
        cx.fillText(it.text, x, y);
      }
      cx.restore();
      x += it.width + space;
    }
  });
}

function sizePreview() {
  const wrap = $('#canvas-wrap');
  const r = wrap.getBoundingClientRect();
  const availW = r.width - 28, availH = r.height - 18;
  let w = availW, h = w * 9 / 16;
  if (h > availH) { h = availH; w = h * 16 / 9; }
  cv.style.width = `${Math.max(0, Math.floor(w))}px`;
  cv.style.height = `${Math.max(0, Math.floor(h))}px`;
}

// ---------- timeline
const tl = $('#timeline');
const tx = tl.getContext('2d');
let tlW = 0, tlH = 0, tlDirty = true, tlDrag = null;
const GUTTER = 86, RULER = 26;
const ROW_SIZES = [64, 46, 30];
const ROWS = [{ key: 'video', label: 'Video', h: 64 }, { key: 'audio', label: 'Audio', h: 46 }, { key: 'cap', label: 'Captions', h: 30 }];
const rowY = [0, 0, 0];
// shrink the tracks to fit short windows, so nothing gets cut off
function layoutRows() {
  const room = tlH - RULER - 10 - 7 * 2 - 6;
  const k = clamp(room / ROW_SIZES.reduce((a, b) => a + b, 0), 0.4, 1);
  let y = RULER + 10;
  ROWS.forEach((r, i) => { r.h = Math.round(ROW_SIZES[i] * k); rowY[i] = y; y += r.h + 7; });
}
layoutRows();
const tX = t => GUTTER + t * S.zoom - S.scroll;
const xT = x => (x - GUTTER + S.scroll) / S.zoom;

function resizeTL() {
  const r = $('#tl-body').getBoundingClientRect();
  const d = devicePixelRatio || 1;
  tlW = r.width; tlH = r.height;
  tl.width = Math.round(r.width * d); tl.height = Math.round(r.height * d);
  tl.style.width = `${r.width}px`; tl.style.height = `${r.height}px`;
  tx.setTransform(d, 0, 0, d, 0, 0);
  layoutRows();
  clampScroll();
  tlDirty = true;
}
function clampScroll() {
  const max = Math.max(0, total() * S.zoom - (tlW - GUTTER) + 140);
  S.scroll = clamp(S.scroll, 0, max);
}
function zoomTo(z, anchorX) {
  const ax = anchorX ?? tX(S.playhead);
  const t = xT(ax);
  S.zoom = clamp(z, 2, 500);
  S.scroll = GUTTER + t * S.zoom - ax;
  clampScroll();
  $('#zoom').value = Math.round(Math.log(S.zoom / 2) / Math.log(250) * 100);
  tlDirty = true;
}
function fitZoom() {
  const T = total();
  if (!T || !tlW) return;
  S.scroll = 0;
  zoomTo((tlW - GUTTER - 50) / T, GUTTER);
  S.scroll = 0;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawTimeline() {
  const Wd = tlW, Hd = tlH;
  if (!Wd) return;
  tx.clearRect(0, 0, Wd, Hd);
  const T = total();

  tx.save();
  tx.beginPath(); tx.rect(GUTTER, 0, Wd - GUTTER, Hd); tx.clip();

  // ruler
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find(s => s * S.zoom >= 76) || 600;
  const minor = step / 5;
  const t0 = Math.max(0, xT(GUTTER)), t1 = xT(Wd);
  tx.font = '600 10.5px Inter, system-ui, sans-serif';
  tx.textBaseline = 'middle';
  for (let n = Math.floor(t0 / minor); n * minor <= t1; n++) {
    const t = n * minor, x = Math.round(tX(t)) + 0.5;
    const major = n % 5 === 0;
    tx.strokeStyle = major ? TL.faint : TL.line;
    tx.beginPath(); tx.moveTo(x, major ? 6 : 14); tx.lineTo(x, RULER - 4); tx.stroke();
    if (major) {
      tx.fillStyle = TL.faint;
      const label = step < 1 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : fmt(t, false);
      tx.fillText(label, x + 5, 11);
    }
  }

  // empty rows
  ROWS.forEach((r, ri) => {
    tx.fillStyle = TL['surface-2'];
    rr(tx, GUTTER, rowY[ri], Math.max(0, Math.min(Wd, tX(T) + 400) - GUTTER), r.h, 9); tx.fill();
  });

  // clips
  const [vy, ay, cy] = rowY, [vh, ah, ch] = ROWS.map(r => r.h);
  let acc = 0;
  S.segments.forEach(seg => {
    const len = seg.end - seg.start;
    const xa = tX(acc), xb = tX(acc + len);
    acc += len;
    if (xb < GUTTER || xa > Wd) return;
    const src = S.sources.get(seg.src);
    if (!src) return;
    const cw = Math.max(1, xb - xa - 2), x0 = xa + 1;

    // video row
    tx.save();
    rr(tx, x0, vy, cw, vh, 9); tx.clip();
    tx.fillStyle = hexA(src.color, 0.35); tx.fillRect(x0, vy, cw, vh);
    if (src.kind === 'video' && src.frames.length) {
      const f0 = src.frames[0].c, fw = f0.width * (vh / f0.height);
      const n = src.frames.length;
      const startX = Math.max(x0, GUTTER - fw);
      for (let x = x0 + Math.floor((startX - x0) / fw) * fw; x < x0 + cw && x < Wd; x += fw) {
        const st = seg.start + (x - xa) / S.zoom;
        const idx = clamp(Math.round(st / src.duration * n - 0.5), 0, n - 1);
        tx.drawImage(src.frames[idx].c, x, vy, fw, vh);
      }
    } else if (src.kind === 'audio') {
      tx.fillStyle = hexA(src.color, 0.25);
      for (let x = x0; x < x0 + cw; x += 14) tx.fillRect(x, vy, 7, vh);
    }
    const grad = tx.createLinearGradient(0, vy, 0, vy + 26);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    tx.fillStyle = grad; tx.fillRect(x0, vy, cw, 26);
    if (cw > 40) {
      tx.fillStyle = '#fff';
      tx.font = '600 11px Inter, system-ui, sans-serif';
      tx.fillText(src.name, Math.max(x0, GUTTER) + 8, vy + 11);
    }
    tx.restore();
    tx.strokeStyle = hexA(src.color, 0.9); tx.lineWidth = 1.5;
    rr(tx, x0 + 0.75, vy + 0.75, cw - 1.5, vh - 1.5, 8.5); tx.stroke();
    if (seg.fx?.length) {
      // a filtered piece gets an accent outline and an "FX" badge
      tx.strokeStyle = accent; tx.lineWidth = 2.5;
      rr(tx, x0 + 1.25, vy + 1.25, cw - 2.5, vh - 2.5, 8); tx.stroke();
      if (cw > 44) {
        const label = `FX ${seg.fx.length}`;
        tx.font = '800 10px Inter, system-ui, sans-serif';
        const lw = tx.measureText(label).width + 12, bx = Math.min(x0 + cw, Wd) - lw - 6;
        tx.fillStyle = accent; rr(tx, bx, vy + vh - 20, lw, 15, 7.5); tx.fill();
        tx.fillStyle = luminance(accent) > 0.45 ? '#0d1117' : '#fff';
        tx.fillText(label, bx + 6, vy + vh - 12.5);
      }
    }

    // audio row: waveform
    tx.save();
    rr(tx, x0, ay, cw, ah, 9); tx.clip();
    tx.fillStyle = hexA(src.color, 0.18); tx.fillRect(x0, ay, cw, ah);
    if (src.peaks) {
      tx.fillStyle = hexA(src.color, 0.95);
      const mid = ay + ah / 2, pxStep = 2;
      const from = Math.max(x0, GUTTER), to = Math.min(x0 + cw, Wd);
      for (let x = from; x < to; x += pxStep) {
        const s0 = seg.start + (x - xa) / S.zoom, s1 = s0 + pxStep / S.zoom;
        let m = 0;
        for (let i = Math.floor(s0 * 100), e = Math.max(i + 1, Math.floor(s1 * 100)); i < e; i++) { const v = src.peaks[i] || 0; if (v > m) m = v; }
        const bh = Math.max(1, m * (ah - 8));
        tx.fillRect(x, mid - bh / 2, 1.3, bh);
      }
    }
    tx.restore();
    if (seg.voice && cw > 50) {
      const label = voiceName(seg.voice);
      tx.font = '700 10px Inter, system-ui, sans-serif';
      const lw = tx.measureText(label).width + 14, bx = Math.max(x0, GUTTER) + 6;
      tx.fillStyle = '#7c3aed'; rr(tx, bx, ay + 4, lw, 15, 7.5); tx.fill();
      tx.fillStyle = '#fff'; tx.fillText(label, bx + 7, ay + 11.5);
    }
  });

  // caption chips
  const words = tlWords();
  const curIdx = currentWordIndex();
  tx.font = '600 10.5px Inter, system-ui, sans-serif';
  words.forEach((tw, i) => {
    const xa = tX(tw.a), xb = tX(Math.max(tw.b, tw.a + 0.08));
    if (xb < GUTTER || xa > Wd) return;
    const w = Math.max(2, xb - xa - 1.5);
    tx.fillStyle = i === curIdx ? accent : TL['surface-3'];
    rr(tx, xa, cy + 3, w, ch - 6, 5); tx.fill();
    if (w > 18) {
      tx.save();
      tx.beginPath(); tx.rect(xa + 3, cy, w - 6, ch); tx.clip();
      tx.fillStyle = i === curIdx ? '#fff' : TL.text;
      tx.fillText(tw.w.text, xa + 4, cy + ch / 2 + 0.5);
      tx.restore();
    }
  });

  // cut markers between clips
  acc = 0;
  for (let i = 0; i < S.segments.length - 1; i++) {
    acc += S.segments[i].end - S.segments[i].start;
    const x = tX(acc);
    if (x < GUTTER || x > Wd) continue;
    tx.fillStyle = TL.text;
    tx.globalAlpha = 0.5;
    tx.fillRect(x - 0.75, vy - 3, 1.5, rowY[2] + ch - vy + 6);
    tx.globalAlpha = 1;
  }

  // selection
  const sel = selRange();
  if (sel) {
    const xa = tX(sel[0]), xb = tX(sel[1]);
    const top = rowY[0] - 4, bottom = rowY[2] + ch + 4;
    tx.fillStyle = 'rgba(239,68,68,0.22)';
    tx.fillRect(xa, top, xb - xa, bottom - top);
    tx.fillStyle = '#ef4444';
    tx.fillRect(xa - 1, top, 2, bottom - top);
    tx.fillRect(xb - 1, top, 2, bottom - top);
    const label = `${(sel[1] - sel[0]).toFixed(1)}s selected  ·  press Delete`;
    tx.font = '700 11px Inter, system-ui, sans-serif';
    const lw = tx.measureText(label).width + 16;
    const lx = clamp((xa + xb) / 2 - lw / 2, GUTTER + 2, Wd - lw - 2);
    tx.fillStyle = '#ef4444';
    rr(tx, lx, 2, lw, 20, 10); tx.fill();
    tx.fillStyle = '#fff';
    tx.fillText(label, lx + 8, 12.5);
  }

  // playhead
  const px = Math.round(tX(S.playhead)) + 0.5;
  if (px >= GUTTER - 1 && px <= Wd + 1) {
    tx.strokeStyle = TL.text; tx.lineWidth = 1.5;
    tx.beginPath(); tx.moveTo(px, RULER - 4); tx.lineTo(px, Hd); tx.stroke();
    tx.fillStyle = accent;
    tx.beginPath();
    tx.moveTo(px - 7, RULER - 14); tx.lineTo(px + 7, RULER - 14); tx.lineTo(px + 7, RULER - 7); tx.lineTo(px, RULER - 1); tx.lineTo(px - 7, RULER - 7);
    tx.closePath(); tx.fill();
  }
  tx.restore();

  // labels in the gutter
  tx.font = '700 11px Inter, system-ui, sans-serif';
  tx.textBaseline = 'middle';
  ROWS.forEach((r, ri) => {
    tx.fillStyle = TL.faint;
    tx.fillText(r.label, 16, rowY[ri] + r.h / 2);
  });
  tx.strokeStyle = TL.line; tx.lineWidth = 1;
  tx.beginPath(); tx.moveTo(GUTTER - 8.5, 8); tx.lineTo(GUTTER - 8.5, Hd - 8); tx.stroke();

  if (!S.segments.length) {
    tx.fillStyle = TL.faint;
    tx.font = '500 12.5px Inter, system-ui, sans-serif';
    tx.fillText('Your clips will show up here', GUTTER + 16, rowY[0] + ROWS[0].h / 2);
  }
}

function followPlayhead() {
  if (!S.playing && !shuttle) return;
  const x = tX(S.playhead);
  const span = tlW - GUTTER;
  if (x > tlW - 40) { S.scroll += span * 0.75; clampScroll(); tlDirty = true; }
  else if (x < GUTTER + 10 && S.scroll > 0) { S.scroll -= span * 0.75; clampScroll(); tlDirty = true; }
}

function tlTime(e) {
  const r = tl.getBoundingClientRect();
  return clamp(xT(e.clientX - r.left), 0, total());
}
tl.addEventListener('pointerdown', e => {
  if (!S.segments.length || e.button !== 0) return;
  try { tl.setPointerCapture(e.pointerId); } catch {}
  const t = tlTime(e);
  if (S.enterHeld || e.shiftKey) {
    tlDrag = { mode: 'select', a: t };
    if (S.playing) pause();
    setSelection({ a: t, b: t });
  } else {
    tlDrag = { mode: 'scrub', wasPlaying: S.playing };
    if (S.playing) pause();
    setSelection(null);
    seek(t);
  }
});
tl.addEventListener('pointermove', e => {
  if (!tlDrag) return;
  const r = tl.getBoundingClientRect(), x = e.clientX - r.left;
  if (x > tlW - 30) { S.scroll += 12; clampScroll(); }
  else if (x < GUTTER + 10) { S.scroll -= 12; clampScroll(); }
  const t = tlTime(e);
  if (tlDrag.mode === 'select') setSelection({ a: tlDrag.a, b: t });
  else seek(t);
});
const endTlDrag = () => {
  if (!tlDrag) return;
  const d = tlDrag;
  tlDrag = null;
  if (d.mode === 'select') {
    const sel = selRange();
    if (!sel || sel[1] - sel[0] < 0.03) setSelection(null);
  } else if (d.wasPlaying) play();
};
tl.addEventListener('pointerup', endTlDrag);
tl.addEventListener('pointercancel', endTlDrag);
tl.addEventListener('dblclick', e => {
  const t = tlTime(e);
  const L = locate(t);
  if (!L) return;
  setSelection({ a: L.tl0, b: L.tl0 + (L.seg.end - L.seg.start) });
});
tl.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = tl.getBoundingClientRect();
    zoomTo(S.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left);
  } else {
    S.scroll += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    clampScroll();
  }
  tlDirty = true;
}, { passive: false });

// ---------- transcript panel
let spans = [];
let lastCur = -1;
let wordDrag = null;

function renderTranscript() {
  const box = $('#transcript');
  const words = tlWords();
  lastCur = -1;
  if (!words.length) {
    spans = [];
    box.innerHTML = `
      <div class="transcript-empty">
        <div class="te-mark"><svg class="i"><use href="#i-text"/></svg></div>
        <div class="h">No script yet</div>
        <p>${S.segments.length ? 'Generate captions and every word you say shows up here. Then you can cut your video just by deleting words.' : 'Record or import a clip first. Your words will show up here so you can edit by text.'}</p>
        ${S.segments.length ? '<button class="secondary-btn" data-go="autocap"><svg class="i"><use href="#i-wand"/></svg>Generate captions</button>' : ''}
      </div>`;
    return;
  }
  let html = '', prev = null;
  words.forEach((tw, i) => {
    if (!prev || tw.src !== prev.src || tw.a - prev.b > 1.6) {
      if (prev) html += '</div>';
      html += `<div class="para"><span class="para-time">${fmt(tw.a, false)}</span>`;
    }
    html += `<span class="w future" data-i="${i}">${esc(tw.w.text)}</span> `;
    prev = tw;
  });
  box.innerHTML = html + '</div>';
  spans = $$('.w', box);
  markTranscriptSelection();
  highlightTranscript(true);
}

function currentWordIndex() {
  const words = tlWords();
  let lo = 0, hi = words.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (words[m].a <= S.playhead + 0.001) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i >= 0 && S.playhead > words[i].b + 0.8) {
    // between words: keep past styling but do not show a current word
    return -1 - i;
  }
  return i;
}

function highlightTranscript(force) {
  if (!spans.length) return;
  const ci = currentWordIndex();
  if (ci === lastCur && !force) return;
  const pastUpTo = ci >= 0 ? ci : -ci - 1;
  if (force || Math.abs(pastUpTo - (lastCur >= 0 ? lastCur : -lastCur - 1)) > 40) {
    spans.forEach((s, i) => { s.classList.toggle('past', i < pastUpTo); s.classList.toggle('future', i > pastUpTo); s.classList.remove('cur'); });
  } else {
    const a = Math.max(0, Math.min(pastUpTo, lastCur >= 0 ? lastCur : -lastCur - 1) - 1);
    const b = Math.min(spans.length - 1, Math.max(pastUpTo, lastCur >= 0 ? lastCur : -lastCur - 1) + 1);
    for (let i = a; i <= b; i++) { spans[i].classList.toggle('past', i < pastUpTo); spans[i].classList.toggle('future', i > pastUpTo); spans[i].classList.remove('cur'); }
  }
  if (ci >= 0 && spans[ci]) {
    spans[ci].classList.add('cur');
    spans[ci].classList.remove('past', 'future');
    if (S.playing) {
      const box = $('[data-panel=transcript]');
      const r = spans[ci].getBoundingClientRect(), br = box.getBoundingClientRect();
      if (r.top < br.top + 20 || r.bottom > br.bottom - 50) box.scrollTop += r.top - br.top - br.height / 3;
    }
  } else if (pastUpTo >= 0 && spans[pastUpTo]) {
    spans[pastUpTo].classList.add('past');
    spans[pastUpTo].classList.remove('future');
  }
  lastCur = ci;
}

function markTranscriptSelection() {
  const sel = selRange();
  const words = tlWords();
  spans.forEach((s, i) => {
    const w = words[i];
    s.classList.toggle('sel', !!sel && w && w.a < sel[1] - 0.01 && w.b > sel[0] + 0.01);
  });
}

$('#transcript').addEventListener('pointerdown', e => {
  const sp = e.target.closest('.w');
  if (!sp || sp.isContentEditable || e.button !== 0) return;
  const i = +sp.dataset.i;
  wordDrag = { i0: i, i1: i, moved: false };
  e.preventDefault();
});
$('#transcript').addEventListener('pointerover', e => {
  if (!wordDrag) return;
  const sp = e.target.closest('.w');
  if (!sp) return;
  const i = +sp.dataset.i;
  if (i !== wordDrag.i1) {
    wordDrag.i1 = i; wordDrag.moved = true;
    const words = tlWords(), a = Math.min(wordDrag.i0, i), b = Math.max(wordDrag.i0, i);
    setSelection({ a: words[a].a, b: words[b].b });
  }
});
addEventListener('pointerup', () => {
  if (!wordDrag) return;
  const d = wordDrag;
  wordDrag = null;
  const words = tlWords();
  if (!d.moved) {
    const w = words[d.i0];
    if (!w) return;
    if (S.enterHeld) { setSelection({ a: w.a, b: w.b }); return; }
    setSelection(null);
    seek(w.a);
  }
});
$('#transcript').addEventListener('dblclick', e => {
  const sp = e.target.closest('.w');
  if (!sp) return;
  const tw = tlWords()[+sp.dataset.i];
  if (!tw) return;
  setSelection(null);
  sp.contentEditable = 'true';
  sp.focus();
  document.getSelection().selectAllChildren(sp);
  const finish = save => {
    sp.removeEventListener('blur', onBlur);
    sp.removeEventListener('keydown', onKey);
    sp.contentEditable = 'false';
    const text = sp.textContent.trim();
    if (save && text) { tw.w.text = text; regroup(tw.src); }
    sp.textContent = tw.w.text;
    tlDirty = true;
  };
  const onBlur = () => finish(true);
  const onKey = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); sp.blur(); }
    if (ev.key === 'Escape') { sp.textContent = tw.w.text; sp.blur(); }
  };
  sp.addEventListener('blur', onBlur);
  sp.addEventListener('keydown', onKey);
});
$('#transcript').addEventListener('click', e => {
  if (e.target.closest('[data-go=autocap]')) autoCaption([...S.sources.values()]);
});

// ---------- auto captions (Whisper, on this computer)
const ASR_WORKER = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
env.allowLocalModels = false;
let asr;
self.onmessage = async (e) => {
  const { id, audio } = e.data;
  try {
    if (!asr) asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: p => self.postMessage({ id, type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } }),
    });
    self.postMessage({ id, type: 'status', text: 'listening' });
    let out, word = true;
    try { out = await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }); }
    catch (err) { word = false; out = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }); }
    self.postMessage({ id, type: 'done', chunks: out.chunks || [], text: out.text || '', word });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};`;
let asrWorker = null;
let asrBusy = false;

function asrRun(audio, onMsg) {
  if (!asrWorker) asrWorker = new Worker(URL.createObjectURL(new Blob([ASR_WORKER], { type: 'text/javascript' })), { type: 'module' });
  const id = uid('job');
  return new Promise((res, rej) => {
    const h = e => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'done') { asrWorker.removeEventListener('message', h); res(m); }
      else if (m.type === 'error') { asrWorker.removeEventListener('message', h); rej(new Error(m.message)); }
      else onMsg(m);
    };
    asrWorker.addEventListener('message', h);
    asrWorker.postMessage({ id, audio }, [audio.buffer]);
  });
}

async function to16k(ab) {
  const len = Math.max(1, Math.ceil(ab.duration * 16000));
  const oc = new OfflineAudioContext(1, len, 16000);
  const b = oc.createBufferSource();
  b.buffer = ab; b.connect(oc.destination); b.start();
  const r = await oc.startRendering();
  return new Float32Array(r.getChannelData(0));
}

function wordsFromChunks(chunks, word) {
  const out = [];
  for (const c of chunks) {
    const [s, e] = c.timestamp || [0, 0];
    const t0 = s ?? 0, t1 = e ?? t0 + 0.4;
    if (word) {
      const text = c.text.trim();
      if (text) out.push({ text, t0, t1: Math.max(t1, t0 + 0.08) });
    } else {
      const parts = c.text.trim().split(/\s+/).filter(Boolean);
      const weights = parts.map(p => p.length + 2), sum = weights.reduce((a, b) => a + b, 0);
      let t = t0;
      parts.forEach((p, i) => { const d = (t1 - t0) * weights[i] / sum; out.push({ text: p, t0: t, t1: t + d }); t += d; });
    }
  }
  return out;
}

async function autoCaption(list) {
  list = list.filter(Boolean);
  if (!list.length) { toast('Add a clip first'); return; }
  if (asrBusy) { toast('Already making captions, hang on'); return; }
  asrBusy = true;
  const bar = $('#autocap-progress'), fill = bar.firstElementChild, status = $('#autocap-status');
  const btns = [$('#btn-autocap'), $('#btn-autocap2')];
  setTab('captions');
  bar.hidden = false; btns.forEach(b => { b.disabled = true; });
  status.textContent = 'Getting ready...';
  const files = {};
  let done = 0;
  try {
    for (const src of list) {
      src.busy = 'Making captions...';
      renderLibrary();
      status.textContent = `Reading audio from ${src.name}`;
      if (!src.audio) {
        try { src.audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await src.file.arrayBuffer()); }
        catch { toast(`${src.name} has no sound to caption`); src.busy = ''; continue; }
      }
      const pcm = await to16k(src.audio);
      const res = await asrRun(pcm, m => {
        if (m.type === 'progress' && m.p.status === 'progress' && m.p.total) {
          files[m.p.file] = [m.p.loaded, m.p.total];
          const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
          fill.style.width = `${Math.round(l / t * 100)}%`;
          status.textContent = `Downloading speech model ${Math.round(l / t * 100)}%`;
        } else if (m.type === 'status') {
          fill.style.width = `${Math.round((done + 0.5) / list.length * 100)}%`;
          status.textContent = `Listening to ${src.name}...`;
        }
      });
      src.words = wordsFromChunks(res.chunks, res.word);
      regroup(src);
      src.busy = '';
      done++;
      fill.style.width = `${Math.round(done / list.length * 100)}%`;
      tlWordsCache = null;
      renderTranscript();
      renderLibrary();
      tlDirty = true;
    }
    status.textContent = done ? `Captions ready for ${done} clip${done > 1 ? 's' : ''}` : '';
    if (done) {
      S.captions.on = true;
      syncCaptionUI();
      if (!S.playing) seekPreview();
      const name = $(`#cap-styles [data-style=${S.captions.style}] small`)?.textContent || '';
      toast(`Captions are ready in your ${name} style. Press Space to watch.`, 3600);
    }
  } catch (err) {
    console.error(err);
    status.textContent = `Could not make captions (${err.message || err}). The first time needs internet to download the speech model. Try again, and if it keeps failing, tell Claude this message.`;
    toast('Captions failed, see the Captions tab');
  } finally {
    for (const s of list) s.busy = '';
    renderLibrary();
    asrBusy = false;
    btns.forEach(b => { b.disabled = false; });
    setTimeout(() => { bar.hidden = true; fill.style.width = '0'; }, 1500);
  }
}

function srtTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function buildSRT() {
  const words = tlWords();
  const cues = [];
  for (const tw of words) {
    const last = cues[cues.length - 1];
    if (last && last.src === tw.src && last.g === tw.w.g && last.si === tw.si) { last.b = tw.b; last.text.push(tw.w.text); }
    else cues.push({ src: tw.src, g: tw.w.g, si: tw.si, a: tw.a, b: tw.b, text: [tw.w.text] });
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(Math.max(c.b, c.a + 0.3))}\n${c.text.join(' ')}\n`).join('\n');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
const fileBase = () => ($('#project-name').value.trim() || 'Cutroom project').replace(/[\\/:*?"<>|]+/g, '-');

// ---------- recording
const REC = { mode: 'screenface', mic: true, live: true, corner: 'br', size: 0.24, where: 'end' };
let rec = null;
let recCount = 0;

function pickMime(audioOnly) {
  const list = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

function mkStreamVideo(stream) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  $('#media-pool').appendChild(v);
  v.play().catch(() => {});
  return v;
}

// Draws the screen with your face in a circle onto one canvas, which becomes the recorded video.
function makeCompositor(display, cam) {
  const sv = mkStreamVideo(display), fv = mkStreamVideo(cam);
  const set = display.getVideoTracks()[0].getSettings();
  let w = set.width || 1920, h = set.height || 1080;
  const k = Math.min(1, 1920 / w, 1920 / h);
  w = Math.round(w * k / 2) * 2; h = Math.round(h * k / 2) * 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const drawFrame = () => {
    if (sv.readyState >= 2) g.drawImage(sv, 0, 0, w, h);
    else { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
    const d = Math.round(Math.min(w, h) * REC.size), m = Math.round(Math.min(w, h) * 0.04);
    const px = REC.corner.includes('r') ? w - m - d / 2 : m + d / 2;
    const py = REC.corner.includes('b') ? h - m - d / 2 : m + d / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = d * 0.14; g.shadowOffsetY = d * 0.03;
    g.beginPath(); g.arc(px, py, d / 2, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.arc(px, py, d / 2, 0, Math.PI * 2); g.clip();
    if (fv.readyState >= 2 && fv.videoWidth) {
      const s = Math.max(d / fv.videoWidth, d / fv.videoHeight), dw = fv.videoWidth * s, dh = fv.videoHeight * s;
      g.translate(px, py); g.scale(-1, 1);
      g.drawImage(fv, -dw / 2, -dh / 2, dw, dh);
    }
    g.restore();
    g.lineWidth = Math.max(4, d * 0.028);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.beginPath(); g.arc(px, py, d / 2, 0, Math.PI * 2); g.stroke();
  };
  drawFrame();
  tickListeners.add(drawFrame);
  const stream = c.captureStream(30);
  return {
    track: stream.getVideoTracks()[0],
    stop() { tickListeners.delete(drawFrame); stream.getTracks().forEach(t => t.stop()); sv.srcObject = null; fv.srcObject = null; sv.remove(); fv.remove(); },
  };
}

async function beginRecording() {
  const mode = REC.mode;
  const needScreen = mode === 'screen' || mode === 'screenface';
  const needCam = mode === 'camera' || mode === 'screenface';
  const needMic = mode === 'audio' || REC.mic;
  if (!navigator.mediaDevices) { toast('Recording needs a secure page (localhost or https)'); return; }
  closeModal('rec-modal');
  pause();
  let display = null, cam = null, mic = null;
  const stopAll = () => [display, cam, mic].forEach(s => s && s.getTracks().forEach(t => t.stop()));
  try {
    if (needScreen) display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    if (needCam) cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    if (needMic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    stopAll();
    toast(err && err.name === 'NotAllowedError' ? 'Permission was not given, so recording did not start' : 'Could not start recording. Is a camera or mic connected?');
    return;
  }
  ensureAudio();

  // mix the mic and any shared screen sound into one track
  let audioTrack = null;
  const audioIns = [mic, display].filter(s => s && s.getAudioTracks().length);
  if (audioIns.length) {
    const dest = actx.createMediaStreamDestination();
    audioIns.forEach(s => actx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest));
    audioTrack = dest.stream.getAudioTracks()[0];
  }
  let videoTrack = null, compositor = null;
  if (mode === 'screen') videoTrack = display.getVideoTracks()[0];
  else if (mode === 'camera') videoTrack = cam.getVideoTracks()[0];
  else if (mode === 'screenface') { compositor = makeCompositor(display, cam); videoTrack = compositor.track; }
  if (mode === 'audio' && !audioTrack) { stopAll(); toast('No microphone found'); return; }

  const out = new MediaStream([videoTrack, audioTrack].filter(Boolean));
  const mime = pickMime(mode === 'audio');
  let recorder;
  try { recorder = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : {}); }
  catch { stopAll(); compositor?.stop(); toast('This browser cannot record this kind of video'); return; }

  const insertAt = REC.where === 'playhead' && S.segments.length ? S.playhead : null;
  rec = { recorder, mode, display, cam, mic, compositor, chunks: [], words: [], startedAt: 0, pausedAcc: 0, pausedAt: 0, stopping: false, sr: null, hasMic: !!mic, stopAll, insertAt };
  recorder.ondataavailable = e => { if (e.data.size) rec?.chunks.push(e.data); };
  recorder.onstop = finishRecording;
  [display, cam].forEach(s => s && s.getVideoTracks()[0].addEventListener('ended', stopRecording));

  await countdown(3);
  if (!rec || rec.stopping) return;
  recorder.start(1000);
  rec.startedAt = performance.now();
  showHud();
  if (REC.live && rec.hasMic) startLiveCaptions();
}

async function countdown(n) {
  const el = $('#countdown'), span = el.firstElementChild;
  el.hidden = false;
  for (let i = n; i > 0; i--) {
    span.textContent = i;
    span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
    await sleep(1000);
  }
  el.hidden = true;
}

const recElapsed = () => !rec || !rec.startedAt ? 0 : ((rec.pausedAt || performance.now()) - rec.startedAt - rec.pausedAcc) / 1000;

let hudTimer = null;
function showHud() {
  $('#rec-hud').hidden = false;
  $('#rec-hud').classList.remove('paused');
  $('#rec-pause').textContent = 'Pause';
  $('#rec-cap').textContent = rec.hasMic ? (REC.live ? 'Listening...' : 'Recording') : 'Recording video only';
  hudTimer = setInterval(() => { $('#rec-time').textContent = fmt(recElapsed(), false); }, 250);
}
function hideHud() {
  $('#rec-hud').hidden = true;
  clearInterval(hudTimer);
}

function togglePauseRecording() {
  if (!rec) return;
  const r = rec.recorder;
  if (r.state === 'recording') {
    r.pause(); rec.pausedAt = performance.now();
    $('#rec-hud').classList.add('paused'); $('#rec-pause').textContent = 'Resume';
  } else if (r.state === 'paused') {
    rec.pausedAcc += performance.now() - rec.pausedAt; rec.pausedAt = 0; r.resume();
    $('#rec-hud').classList.remove('paused'); $('#rec-pause').textContent = 'Pause';
  }
}

function stopRecording() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.duration = recElapsed();
  stopLiveCaptions();
  $('#countdown').hidden = true;
  if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  else finishRecording();
}

async function finishRecording() {
  const r = rec;
  rec = null;
  if (!r) return;
  hideHud();
  r.stopAll();
  r.compositor?.stop();
  const type = (r.recorder.mimeType || 'video/webm').split(';')[0];
  const blob = new Blob(r.chunks, { type });
  if (!blob.size) { toast('Recording was empty'); return; }
  const n = ++recCount;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `Recording ${n}.${ext}`, { type });
  try {
    const at = r.insertAt;
    if (at == null) S.playhead = total();
    await addSource(file, { kind: r.mode === 'audio' ? 'audio' : undefined, words: r.words, duration: r.duration, name: `Recording ${n}`, at });
    if (at == null) S.playhead = Math.max(0, total() - r.duration);
    toast(at != null ? 'Recording added at the playhead' : S.segments.length > 1 ? 'Recording added to the end of your video' : (r.words.length ? 'Recording added with live captions' : 'Recording added to your timeline'));
  } catch (err) {
    console.error(err);
    download(blob, `Recording ${n}.${ext}`);
    toast('Could not open the recording here, so it was downloaded instead');
  }
}

// Live captions while you record use the browser's speech recognition (Chrome, Edge, Safari).
function startLiveCaptions() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#rec-cap').textContent = 'Recording (use Auto-caption afterwards)'; return; }
  const r = rec;
  let session = 0, lastFinal = '';
  const starts = new Map();
  const sr = new SR();
  sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-US';
  sr.onresult = e => {
    if (!rec || rec !== r || r.pausedAt) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], key = `${session}:${i}`;
      if (!starts.has(key)) starts.set(key, Math.max(0, recElapsed() - 0.6));
      if (res.isFinal) {
        pushWords(r, res[0].transcript, starts.get(key), recElapsed());
        lastFinal = res[0].transcript.trim();
        starts.delete(key);
      } else interim += res[0].transcript;
    }
    $('#rec-cap').textContent = (interim || lastFinal || 'Listening...').trim();
  };
  sr.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { r.sr = null; $('#rec-cap').textContent = 'Recording (live captions unavailable, use Auto-caption after)'; }
  };
  sr.onend = () => {
    if (rec === r && r.sr === sr && !r.stopping) { session++; starts.clear(); try { sr.start(); } catch {} }
  };
  r.sr = sr;
  try { sr.start(); } catch {}
}
function stopLiveCaptions() {
  if (!rec?.sr) return;
  const sr = rec.sr;
  rec.sr = null;
  try { sr.stop(); } catch {}
}
function pushWords(r, text, t0, t1) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  t1 = Math.max(t1 - 0.2, t0 + parts.length * 0.14);
  const weights = parts.map(p => p.length + 2), sum = weights.reduce((a, b) => a + b, 0);
  let t = t0;
  parts.forEach((p, i) => { const d = (t1 - t0) * weights[i] / sum; r.words.push({ text: p, t0: t, t1: t + d * 0.92 }); t += d; });
}

// ---------- export
let exportKind = 'video';

async function runExport() {
  if (!S.segments.length) { toast('Add something to the timeline first'); return; }
  ensureAudio();
  await actx.resume();
  pause();
  setSelection(null);
  S.captions.on = $('#export-caps').checked;
  syncCaptionUI();
  seek(0);
  await sleep(300);

  $('#export-setup').hidden = true;
  $('#export-run').hidden = false;
  $('#export-close').hidden = true;
  $('#export-sub').textContent = 'Keep this tab open. Your edit is playing through once to save it.';

  const vTracks = exportKind === 'video' ? cv.captureStream(30).getVideoTracks() : [];
  const stream = new MediaStream([...vTracks, ...exportDest.stream.getAudioTracks()]);
  const mime = pickMime(exportKind === 'audio');
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(res => { recorder.onstop = res; });
  S.exporting = { recorder, cancelled: false, startedAt: performance.now() };
  recorder.start(500);
  onPlaybackEnd = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  play();
  await stopped;
  vTracks.forEach(t => t.stop());
  const ex = S.exporting;
  S.exporting = null;
  onPlaybackEnd = null;
  closeModal('export-modal');
  resetExportModal();
  if (ex.cancelled) { toast('Export cancelled'); return; }
  const type = (recorder.mimeType || mime || 'video/webm').split(';')[0];
  const ext = type.includes('mp4') ? (exportKind === 'audio' ? 'm4a' : 'mp4') : 'webm';
  download(new Blob(chunks, { type }), `${fileBase()}.${ext}`);
  toast('Export finished and downloaded');
}
function updateExportProgress() {
  if (!S.exporting) return;
  const T = total() || 1, p = clamp(S.playhead / T, 0, 1);
  $('#export-bar').style.width = `${(p * 100).toFixed(1)}%`;
  $('#export-pct').textContent = `${Math.floor(p * 100)}%`;
  $('#export-eta').textContent = `${fmt(T - S.playhead, false)} left`;
}
function cancelExport() {
  if (!S.exporting) return;
  S.exporting.cancelled = true;
  pause();
  if (S.exporting.recorder.state !== 'inactive') S.exporting.recorder.stop();
}
function resetExportModal() {
  $('#export-setup').hidden = false;
  $('#export-run').hidden = true;
  $('#export-close').hidden = false;
  $('#export-sub').textContent = 'Your edit plays through once while it is saved.';
  $('#export-bar').style.width = '0';
}

// ---------- thumbnails (free, no account: AI Horde for best quality, Pollinations for speed)
// server.py talks to both services; asking from the server is what keeps them key-free.
const THUMB_STYLES = {
  photo: 'photorealistic photo, shot on a DSLR, sharp focus',
  cinematic: 'cinematic film still, anamorphic lighting, color graded',
  render: '3D render, soft studio lighting, glossy materials',
  illustration: 'clean digital illustration, bold shapes',
  anime: 'anime key visual, vibrant cel shading',
  comic: 'comic book art, bold ink lines, halftone shading',
  neon: 'neon cyberpunk lighting, glowing accents, dark background',
  minimal: 'minimalist flat design, lots of empty space',
};
const FAST_GAP = 46000;  // Pollinations' free tier: one picture every 45 seconds
let lastFastAt = 0;
const OLD_SERVER = 'Close Cutroom and open it again with Start Cutroom.command to turn on free thumbnails.';

class ThumbError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}
async function blobURL(res) {
  if (!res.ok) throw new ThumbError(`HTTP ${res.status}`, res.status);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new ThumbError('not an image', 502);
  return URL.createObjectURL(blob);
}
const tileLabel = (tile, text) => { const sp = tile.querySelector('.thumb-state span'); if (sp) sp.textContent = text; };
const waitText = s => s >= 90 ? `about ${Math.round(s / 60)} minutes` : s >= 50 ? 'about a minute' : `about ${Math.max(5, Math.round(s / 5) * 5)} seconds`;

function makeTile(grid) {
  const tile = document.createElement('div');
  tile.className = 'thumb-tile';
  tile.innerHTML = `
    <div class="thumb-media"><div class="shimmer"></div><div class="thumb-state"><div class="spinner"></div><span>Getting in line...</span></div><div class="thumb-headline"></div></div>
    <div class="thumb-actions">
      <button data-a="dl" disabled><svg class="i"><use href="#i-download"/></svg>Download</button>
      <button data-a="open" disabled><svg class="i"><use href="#i-external"/></svg>Open</button>
      <button data-a="again" disabled><svg class="i"><use href="#i-refresh"/></svg>New version</button>
    </div>`;
  grid.prepend(tile);
  return tile;
}
function resetTile(tile) {
  tile.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const media = tile.querySelector('.thumb-media');
  media.querySelector('.thumb-state')?.remove();
  media.insertAdjacentHTML('afterbegin', '<div class="shimmer"></div><div class="thumb-state"><div class="spinner"></div><span>Getting in line...</span></div>');
}

async function generateThumbs() {
  const base = $('#th-prompt').value.trim();
  if (!base) { toast('Describe your thumbnail first'); $('#th-prompt').focus(); return; }
  const style = THUMB_STYLES[$('#th-style').value];
  const prompt = [base, style, 'YouTube thumbnail, 16:9, eye-catching composition, highly detailed'].filter(Boolean).join(', ');
  const tiles = [...Array(+$('#th-count').value)].map(() => makeTile($('#thumb-grid')));
  updateHeadlines();
  const btn = $('#btn-thumb');
  btn.disabled = true;
  try { await makeThumbs(tiles, prompt, $('#th-engine').value); }
  finally { btn.disabled = false; }
}

async function makeThumbs(tiles, prompt, engine) {
  if (engine === 'best') {
    try { await hordeThumbs(tiles, prompt); return; }
    catch (err) {
      console.warn('AI Horde', err);
      if (err.message === OLD_SERVER) { tiles.forEach(t => showThumbError(t, OLD_SERVER, prompt, engine)); return; }
      tiles.forEach(t => tileLabel(t, 'Best quality is busy, using Fast instead...'));
    }
  }
  for (const tile of tiles) await fastThumb(tile, prompt);
}

// AI Horde: free community computers. One request makes all versions; we wait our turn in line.
// The browser asks AI Horde directly (it allows that, and it uses your own connection). If that
// fails, our own server asks instead (server.py on your computer, functions/ on the website).
const HORDE = 'https://aihorde.net/api/v2';
const HORDE_HEADERS = { apikey: '0000000000', 'Client-Agent': 'Cutroom:1.0:web', 'Content-Type': 'application/json' };
const HORDE_MODELS = ['Juggernaut XL', 'AlbedoBase XL 3.1', 'AlbedoBase XL (SDXL)'];  // family-safe only
const HORDE_NEGATIVE = 'text, words, letters, watermark, logo, signature, blurry, deformed, ugly, extra fingers, nsfw, nude';

async function hordeSubmit(prompt, n) {
  const seed = String(Math.floor(Math.random() * 1e9));
  try {
    const res = await fetch(`${HORDE}/generate/async`, {
      method: 'POST', headers: HORDE_HEADERS,
      body: JSON.stringify({
        prompt: `${prompt} ### ${HORDE_NEGATIVE}`,
        params: { width: 1024, height: 576, steps: 25, cfg_scale: 6, sampler_name: 'k_euler_a', n, seed },
        nsfw: false, censor_nsfw: true, models: HORDE_MODELS, r2: true, shared: false,
      }),
    });
    const j = await res.json();
    if (res.ok && j.id) return { id: j.id, direct: true };
  } catch {}
  let res;
  try {
    res = await fetch('/api/horde/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, n, seed }) });
  } catch { throw new ThumbError(OLD_SERVER, 0); }
  if (res.status === 404 || res.status === 501) throw new ThumbError(OLD_SERVER, res.status);
  if (!res.ok) throw new ThumbError(`submit ${res.status}`, res.status);
  const { id } = await res.json();
  if (!id) throw new ThumbError('no job id', 502);
  return { id, direct: false };
}

async function hordeImage(job, i) {
  if (!job.direct) return blobURL(await fetch(`/api/horde/result/${job.id}?i=${i}`));
  const st = await (await fetch(`${HORDE}/generate/status/${job.id}`, { headers: HORDE_HEADERS })).json();
  const g = (st.generations || [])[i];
  if (!g) throw new ThumbError('not ready', 404);
  if (g.censored) throw new ThumbError('censored', 451);
  // the picture lives on a storage server; fetch it directly, or through our server if that is blocked
  try { return await blobURL(await fetch(g.img)); }
  catch { return blobURL(await fetch(`/api/horde/image?u=${encodeURIComponent(g.img)}`)); }
}

async function hordeThumbs(tiles, prompt) {
  const job = await hordeSubmit(prompt, tiles.length);
  const checkURL = job.direct ? `${HORDE}/generate/check/${job.id}` : `/api/horde/check/${job.id}`;
  const t0 = Date.now();
  for (;;) {
    await sleep(4000);
    if (Date.now() - t0 > 12 * 60000) throw new ThumbError('took too long', 504);
    let c;
    try { c = await (await fetch(checkURL, job.direct ? { headers: HORDE_HEADERS } : {})).json(); } catch { continue; }
    if (c.faulted || c.is_possible === false) throw new ThumbError('faulted', 502);
    if (c.done) break;
    const text = c.queue_position > 0
      ? `In line: ${c.queue_position} ahead of you, ${waitText(c.wait_time || 60)}`
      : c.processing ? 'Painting your thumbnail now...' : `Almost there, ${waitText(c.wait_time || 20)}`;
    tiles.forEach(t => tileLabel(t, text));
  }
  await Promise.all(tiles.map(async (tile, i) => {
    try { showThumb(tile, await hordeImage(job, i), prompt, 'best'); }
    catch (err) {
      showThumbError(tile, err.status === 451 ? 'The safety filter blocked this one. Try different words.' : 'This one did not come out. Try again.', prompt, 'best');
    }
  }));
}

// Pollinations: quick, but only one picture every 45 seconds and sometimes busy.
async function fastThumb(tile, prompt, attempt = 0) {
  while (Date.now() - lastFastAt < FAST_GAP) {
    tileLabel(tile, `Next picture in ${Math.ceil((FAST_GAP - (Date.now() - lastFastAt)) / 1000)} seconds (free limit)`);
    await sleep(500);
  }
  tileLabel(tile, attempt ? 'Trying again...' : 'Painting your thumbnail...');
  try {
    const res = await fetch(`/api/thumb?${new URLSearchParams({ prompt, seed: Math.floor(Math.random() * 1e9) })}`);
    lastFastAt = Date.now();
    if (res.status === 404) { showThumbError(tile, OLD_SERVER, prompt, 'fast'); return; }
    showThumb(tile, await blobURL(res), prompt, 'fast');
  } catch (err) {
    if (attempt < 2) { await sleep(4000); return fastThumb(tile, prompt, attempt + 1); }
    showThumbError(tile, 'The picture service is busy right now. Try again in a minute, or pick Best quality.', prompt, 'fast');
  }
}

function showThumb(tile, url, prompt, engine) {
  const media = tile.querySelector('.thumb-media');
  const img = new Image();
  img.alt = 'Generated thumbnail';
  img.src = url;
  media.querySelector('.shimmer')?.remove();
  media.querySelector('.thumb-state')?.remove();
  const old = media.querySelector('img');
  if (old) { URL.revokeObjectURL(old.src); old.remove(); }
  media.prepend(img);
  tile._img = img;
  tile.querySelectorAll('button').forEach(b => { b.disabled = false; });
  tile.querySelector('[data-a=dl]').onclick = () => downloadThumb(tile);
  tile.querySelector('[data-a=open]').onclick = () => window.open(img.src, '_blank', 'noopener');
  tile.querySelector('[data-a=again]').onclick = () => { resetTile(tile); makeThumbs([tile], prompt, engine); };
}

function showThumbError(tile, msg, prompt, engine) {
  const media = tile.querySelector('.thumb-media');
  media.querySelector('.shimmer')?.remove();
  const st = media.querySelector('.thumb-state');
  if (!st) return;
  st.innerHTML = `<span>${esc(msg)}</span><button class="secondary-btn">Try again</button>`;
  st.querySelector('button').addEventListener('click', () => { resetTile(tile); makeThumbs([tile], prompt, engine); });
}

function updateHeadlines() {
  const text = $('#th-headline').value.trim();
  $$('.thumb-headline').forEach(h => { h.textContent = text; });
}

async function downloadThumb(tile) {
  const img = tile._img;
  const headline = $('#th-headline').value.trim();
  const name = `${fileBase()} thumbnail.png`;
  try {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 1280, 720);
    if (headline) drawHeadline(g, headline.toUpperCase(), 1280, 720);
    const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/png'));
    download(blob, name);
  } catch {
    download(await (await fetch(img.src)).blob(), name.replace('.png', '.jpg'));
  }
}
function drawHeadline(g, text, w, h) {
  const maxW = w * 0.64;
  let fs = 132;
  g.font = `900 ${fs}px Inter, system-ui, sans-serif`;
  const words = text.split(/\s+/);
  let lines;
  for (;;) {
    lines = [''];
    for (const wd of words) {
      const test = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${wd}` : wd;
      if (g.measureText(test).width > maxW && lines[lines.length - 1]) lines.push(wd);
      else lines[lines.length - 1] = test;
    }
    if (lines.length <= 3 || fs < 60) break;
    fs -= 10;
    g.font = `900 ${fs}px Inter, system-ui, sans-serif`;
  }
  const lh = fs * 1.02;
  let y = h * 0.92 - lines.length * lh + lh * 0.8;
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  for (const line of lines) {
    g.lineWidth = fs * 0.16; g.strokeStyle = '#000';
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.strokeText(line, w * 0.06, y);
    g.shadowColor = 'transparent';
    g.fillStyle = '#fff';
    g.fillText(line, w * 0.06, y);
    y += lh;
  }
}

// ---------- video filters: the photo filters, on the clip piece under the playhead or on the selection
const MAX_FX = 10;
const FX_W = 720;  // frames are filtered at this width, which keeps playback smooth
const fxCanvas = document.createElement('canvas');
let fxCache = { key: '', out: null };
let fxFaceVer = 0;
const fxFaces = new Map();  // source id -> { faces, t, busy }
const fxKind = id => (FILTERS.find(f => f.id === id) || {}).kind;
const fxName = id => (FILTERS.find(f => f.id === id) || {}).name || id;

function fxFrame(src, seg) {
  const el = src.el, h = Math.max(2, Math.round(FX_W * src.h / src.w));
  const amount = seg.fxAmount ?? 0.7;
  const key = `${src.id}|${el.currentTime.toFixed(3)}|${seg.fx.join()}|${amount}|${fxFaceVer}`;
  if (fxCache.key === key) return fxCache.out;
  if (fxCanvas.width !== FX_W || fxCanvas.height !== h) { fxCanvas.width = FX_W; fxCanvas.height = h; }
  fxCanvas.getContext('2d', { willReadFrequently: true }).drawImage(el, 0, 0, FX_W, h);
  const faces = seg.fx.some(id => fxKind(id) === 'face') ? facesFor(src) : [];
  let out = fxCanvas;
  for (const id of seg.fx) out = applyFilter(out, id, amount, faces);
  fxCache = { key, out };
  return out;
}

// Faces move in a video, so look for them again every quarter second (in the background).
function facesFor(src) {
  let e = fxFaces.get(src.id);
  if (!e) { e = { faces: [], t: -1, busy: false }; fxFaces.set(src.id, e); }
  const t = src.el.currentTime;
  if (!e.busy && Math.abs(e.t - t) > 0.25) {
    e.busy = true;
    const snap = document.createElement('canvas');
    snap.width = fxCanvas.width; snap.height = fxCanvas.height;
    snap.getContext('2d').drawImage(fxCanvas, 0, 0);
    findFaces(snap).then(f => { e.faces = f; e.t = t; e.busy = false; fxFaceVer++; });
  }
  return e.faces;
}

// What a filter click changes: the selection if there is one, otherwise the piece under the playhead.
function fxTarget() {
  const sel = selRange();
  if (sel && sel[1] - sel[0] >= 0.05) return { a: sel[0], b: sel[1], sel: true };
  const L = S.segments.length ? locate(S.playhead) : null;
  if (!L) return null;
  return { a: L.tl0, b: L.tl0 + (L.seg.end - L.seg.start), sel: false };
}
function fxAt(t) { const L = locate(t.a + 0.001); return L ? L.seg : null; }

function splitQuiet(t) {
  const L = locate(t);
  if (!L) return;
  const cut = L.srcT;
  if (cut - L.seg.start < 0.02 || L.seg.end - cut < 0.02) return;
  S.segments.splice(L.i, 1, { ...L.seg, id: uid('g'), end: cut }, { ...L.seg, id: uid('g'), start: cut });
}
function setFx(t, fx, amount) {
  snapshot();
  if (t.sel) { splitQuiet(t.a); splitQuiet(t.b); }
  let acc = 0;
  for (const s of S.segments) {
    const len = s.end - s.start, mid = acc + len / 2;
    if (mid > t.a && mid < t.b) {
      if (fx.length) { s.fx = [...fx]; s.fxAmount = amount; } else { delete s.fx; delete s.fxAmount; }
    }
    acc += len;
  }
  afterEdit();
}

function pickVideoFx(id, mix) {
  const t = fxTarget();
  if (!t) { toast('Add a video to the timeline first'); return; }
  const seg = fxAt(t), src = S.sources.get(seg.src);
  if (src.kind !== 'video') { toast('Filters work on video clips, not audio'); return; }
  const cur = seg.fx || [];
  let next;
  if (id === 'original') next = [];
  else if (mix) {
    if (cur.includes(id)) next = cur.filter(f => f !== id);
    else if (cur.length >= MAX_FX) { toast(`You can mix up to ${MAX_FX} filters`); return; }
    else next = [...cur, id];
  } else {
    if (cur.length === 1 && cur[0] === id) return;
    next = [id];
  }
  setFx(t, next, +$('#vfx-amount').value);
  fxPanelKey = '';
  const where = t.sel ? 'your selection' : 'this part of the video';
  toast(next.length ? `${next.length > 1 ? `${next.length} filters` : fxName(id)} on ${where}` : `Filters removed from ${where}`, 1800);
}

function setVoice(t, id) {
  snapshot();
  if (t.sel) { splitQuiet(t.a); splitQuiet(t.b); }
  let acc = 0;
  for (const s of S.segments) {
    const len = s.end - s.start, mid = acc + len / 2;
    if (mid > t.a && mid < t.b) { if (id === 'normal') delete s.voice; else s.voice = id; }
    acc += len;
  }
  afterEdit();
}
let previewStop = null;
function pickVoice(id) {
  const t = fxTarget();
  if (!t) { toast('Add a video or recording first'); return; }
  setVoice(t, id);
  fxPanelKey = '';
  ensureAudio();
  // play a few seconds so you can hear it right away
  clearTimeout(previewStop);
  seek(t.a);
  play();
  previewStop = setTimeout(() => { if (S.playing) pause(); }, 4000);
  toast(id === 'normal' ? 'Back to your normal voice' : `${voiceName(id)} voice on ${t.sel ? 'your selection' : 'this part'}`, 1800);
}

let fxPanelKey = '';
function syncFxPanel() {
  if (!$('[data-panel=effects]').classList.contains('active')) return;
  const t = fxTarget();
  const seg = t ? fxAt(t) : null;
  const fx = seg?.fx || [];
  const key = `${t ? `${t.a.toFixed(2)}-${t.b.toFixed(2)}-${t.sel}` : ''}|${fx.join()}|${seg?.fxAmount}|${S.version}|${seg?.voice}`;
  if (key === fxPanelKey) return;
  const moved = fxPanelKey.split('|')[0] !== key.split('|')[0];
  fxPanelKey = key;
  $('#fx-target').innerHTML = !t ? 'Add a video to the timeline to use filters.'
    : `<span class="fx-dot"></span><span>Changing <b>${t.sel ? 'your selection' : 'the part under the playhead'}</b>, ${fmt(t.a, false)} to ${fmt(t.b, false)}</span>`;
  $$('#voice-grid .voice-card').forEach(c => c.classList.toggle('active', c.dataset.voice === (seg?.voice || 'normal')));
  $$('#vfx-grid .filter-card').forEach(c => {
    const n = fx.indexOf(c.dataset.filter);
    c.classList.toggle('active', c.dataset.filter === 'original' ? !fx.length : n >= 0);
    c.querySelector('.fc-badge').textContent = fx.length > 1 && n >= 0 ? n + 1 : '';
  });
  $('#vfx-mix').hidden = fx.length < 2;
  $('#vfx-count').textContent = `Mixing ${fx.length} of ${MAX_FX}`;
  $('#vfx-list').textContent = fx.map(fxName).join(' + ');
  $('#vfx-amount-box').hidden = !fx.some(id => fxKind(id) !== 'none');
  if (seg?.fxAmount != null) { $('#vfx-amount').value = seg.fxAmount; }
  $('#vfx-amount-val').textContent = `${Math.round(+$('#vfx-amount').value * 100)}%`;
  if (moved) scheduleFxThumbs();
}

// Previews of each filter, made from the frame under the playhead.
let fxThumbTimer = null;
function scheduleFxThumbs() { clearTimeout(fxThumbTimer); fxThumbTimer = setTimeout(makeFxThumbs, 350); }
async function makeFxThumbs() {
  const L = S.segments.length ? locate(S.playhead) : null;
  const src = L && S.sources.get(L.seg.src);
  if (!src || src.kind !== 'video' || src.el.readyState < 2) return;
  const w = 200, h = Math.round(w * src.h / src.w);
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  small.getContext('2d').drawImage(src.el, 0, 0, w, h);
  const k = w / FX_W, faces = (fxFaces.get(src.id)?.faces || []).map(f => ({ x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k }));
  for (const f of FILTERS) {
    const out = applyFilter(small, f.id, f.kind === 'mix' ? 1 : 0.85, faces);
    const el = $(`#vfx-grid .filter-card[data-filter="${f.id}"] .fc-img`);
    if (el) { el.style.backgroundImage = `url(${out.toDataURL('image/jpeg', 0.8)})`; el.innerHTML = ''; }
    await sleep(0);
  }
}

function buildFxPanel() {
  $('#voice-grid').innerHTML = VOICES.map(v => `
    <button class="voice-card" data-voice="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.desc)}</span></button>`).join('');
  $('#voice-grid').addEventListener('click', e => { const c = e.target.closest('.voice-card'); if (c) pickVoice(c.dataset.voice); });
  $('#vfx-grid').innerHTML = FILTERS.map(f => `
    <button class="filter-card" data-filter="${f.id}">
      <div class="fc-img"><svg class="i"><use href="#i-${f.kind === 'face' ? 'face' : 'image'}"/></svg></div>
      <div class="fc-name">${esc(f.name)}</div>
      <span class="fc-badge"></span>
    </button>`).join('');
  $('#vfx-grid').addEventListener('click', e => {
    const c = e.target.closest('.filter-card');
    if (c) pickVideoFx(c.dataset.filter, (e.metaKey || e.ctrlKey) && e.altKey);
  });
  $('#vfx-clear').onclick = () => pickVideoFx('original', false);
  let sliding = false;
  $('#vfx-amount').addEventListener('input', e => {
    const t = fxTarget();
    if (!t) return;
    if (!sliding) { snapshot(); sliding = true; }
    // change the strength live on the filtered pieces in the target
    let acc = 0;
    for (const s of S.segments) {
      const len = s.end - s.start;
      if (s.fx && acc + len > t.a + 0.001 && acc < t.b - 0.001) s.fxAmount = +e.target.value;
      acc += len;
    }
    $('#vfx-amount-val').textContent = `${Math.round(+e.target.value * 100)}%`;
    tlDirty = true;
  });
  $('#vfx-amount').addEventListener('change', () => { sliding = false; });
}

// ---------- modals
function openModal(id) { $(`#${id}`).hidden = false; }
function closeModal(id) { $(`#${id}`).hidden = true; }
$$('.modal').forEach(m => {
  m.addEventListener('click', e => {
    if (m.id === 'export-modal' && S.exporting) return;
    if (e.target === m || e.target.closest('[data-close]')) closeModal(m.id);
  });
});
const anyModalOpen = () => $$('.modal').some(m => !m.hidden);

// ---------- keyboard
const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

addEventListener('keydown', e => {
  if (S.exporting || Photo.isActive()) return;
  if (e.key === 'Escape') {
    const open = $$('.modal').find(m => !m.hidden);
    if (open) { closeModal(open.id); return; }
    if (typing(document.activeElement)) { document.activeElement.blur(); return; }
    setSelection(null);
    return;
  }
  if (typing(e.target) || anyModalOpen()) return;
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Enter') {
    e.preventDefault();  // stops Return from clicking a focused button
    if (!e.repeat) { S.enterHeld = true; $('#timeline-panel').classList.add('selecting'); }
    return;
  }
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) { seek(S.playhead + dir * 5); return; }
    if (!e.repeat) startShuttle(dir);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const sel = selRange();
    if (sel) deleteRange(sel[0], sel[1]);
    else toast('Hold Return and drag on the timeline to pick a part first', 2200);
    return;
  }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (e.key === 's' || e.key === 'S') { splitAt(S.playhead); return; }
  if (e.key === 'k') { pause(); return; }
  if (e.key === 'Home') { seek(0); return; }
  if (e.key === 'End') { seek(total()); return; }
  if (e.key === '=' || e.key === '+') { zoomTo(S.zoom * 1.4); return; }
  if (e.key === '-' || e.key === '_') { zoomTo(S.zoom / 1.4); return; }
});
addEventListener('keyup', e => {
  if (e.key === 'Enter') { S.enterHeld = false; $('#timeline-panel').classList.remove('selecting'); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') stopShuttle();
});
addEventListener('blur', () => {
  S.enterHeld = false;
  $('#timeline-panel').classList.remove('selecting');
  stopShuttle();
});

// ---------- drag and drop files
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  importFiles(e.dataTransfer.files);
});

// ---------- video / photo views
function setView(v) {
  const photo = v === 'photo';
  if (photo && S.playing) pause();
  document.body.classList.toggle('photo-mode', photo);
  $$('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  S.enterHeld = false;
  $('#timeline-panel').classList.remove('selecting');
  stopShuttle();
}

function openRecord() {
  const has = S.segments.length > 0;
  $('#opt-where').hidden = !has;
  $('#rec-where-at').textContent = `At the playhead (${fmt(S.playhead, false)})`;
  openModal('rec-modal');
}

// ---------- wire up the UI
function syncCaptionUI() {
  $('#cap-on').checked = S.captions.on;
  $('#export-caps').checked = S.captions.on;
  $('#btn-cc').classList.toggle('on', S.captions.on);
  $$('#cap-styles .style-card').forEach(b => b.classList.toggle('active', b.dataset.style === S.captions.style));
  $$('#cap-colors button').forEach(b => b.classList.toggle('active', b.dataset.color === (S.captions.color || '')));
  const capEl = $('#cap-styles');
  if (S.captions.color) capEl.style.setProperty('--cap', S.captions.color); else capEl.style.removeProperty('--cap');
  $$('#cap-pos button').forEach(b => b.classList.toggle('active', b.dataset.pos === S.captions.pos));
  $('#cap-size').value = S.captions.size;
  $('#cap-size-val').textContent = `${Math.round(S.captions.size * 100)}%`;
  $('#frame-on').checked = S.framed;
  $('#btn-frame').classList.toggle('on', S.framed);
  saveSettings();
}

function setTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  if (name === 'effects') { fxPanelKey = ''; scheduleFxThumbs(); }
}

function wireUI() {
  $('#btn-record').onclick = () => openRecord();
  $('#btn-record-more').onclick = () => openRecord();
  $('#btn-import').onclick = () => $('#file-input').click();
  $('#file-input').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
  $('#empty-state').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'record') openModal('rec-modal'); else $('#file-input').click();
  });
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-keys').onclick = () => openModal('keys-modal');
  $('#btn-export').onclick = () => {
    if (Photo.isActive()) { Photo.openExport(); return; }
    if (!S.segments.length) { toast('Add something to the timeline first'); return; }
    $('#export-caps').checked = S.captions.on;
    openModal('export-modal');
  };
  $('#mode-chip').onclick = () => { setView('video'); setTab('modes'); };
  $('#view-switch').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

  $('#btn-play').onclick = togglePlay;
  $('#btn-start').onclick = () => seek(0);
  $('#btn-back').onclick = () => seek(S.playhead - 5);
  $('#btn-fwd').onclick = () => seek(S.playhead + 5);
  $('#btn-cc').onclick = () => { S.captions.on = !S.captions.on; syncCaptionUI(); };
  $('#btn-frame').onclick = () => { S.framed = !S.framed; syncCaptionUI(); };

  $('#btn-split').onclick = () => splitAt(S.playhead);
  $('#btn-delete').onclick = () => { const s = selRange(); if (s) deleteRange(s[0], s[1]); };
  $('#zoom').oninput = e => zoomTo(2 * Math.pow(250, e.target.value / 100));
  $('#zoom-in').onclick = () => zoomTo(S.zoom * 1.4);
  $('#zoom-out').onclick = () => zoomTo(S.zoom / 1.4);

  $('#tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) setTab(t.dataset.tab); });
  $('#cap-on').onchange = e => { S.captions.on = e.target.checked; syncCaptionUI(); };
  $('#cap-styles').addEventListener('click', e => { const b = e.target.closest('.style-card'); if (b) { S.captions.style = b.dataset.style; syncCaptionUI(); } });
  $('#cap-pos').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.captions.pos = b.dataset.pos; syncCaptionUI(); } });
  $('#cap-size').oninput = e => { S.captions.size = +e.target.value; syncCaptionUI(); };
  const runAutoCaption = () => autoCaption([...new Set(S.segments.map(s => S.sources.get(s.src)))]);
  $('#btn-autocap').onclick = runAutoCaption;
  $('#btn-autocap2').onclick = runAutoCaption;
  $('#cap-colors').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.captions.color = b.dataset.color; syncCaptionUI(); } });
  $('#btn-srt').onclick = () => {
    const srt = buildSRT();
    if (!srt) { toast('No captions yet. Generate them first.'); return; }
    download(new Blob([srt], { type: 'text/plain' }), `${fileBase()}.srt`);
  };
  $('#frame-on').onchange = e => { S.framed = e.target.checked; syncCaptionUI(); };

  $('#btn-thumb').onclick = generateThumbs;

  $('#th-headline').oninput = updateHeadlines;
  $('#th-chips').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const ta = $('#th-prompt');
    ta.value = ta.value.trim() ? `${ta.value.trim().replace(/[,.]$/, '')}, ${b.textContent}` : b.textContent;
    ta.focus();
  });

  // recording setup
  const recModes = $('#rec-modes');
  const syncRecUI = () => {
    $$('.rec-mode', recModes).forEach(b => b.classList.toggle('active', b.dataset.mode === REC.mode));
    $('#opt-bubble').hidden = REC.mode !== 'screenface';
    $('#opt-mic').classList.toggle('disabled', REC.mode === 'audio');
    $('#rec-mic').checked = REC.mode === 'audio' ? true : REC.mic;
    $('#opt-live').classList.toggle('disabled', REC.mode !== 'audio' && !REC.mic);
    $$('#rec-corner button').forEach(b => b.classList.toggle('active', b.dataset.corner === REC.corner));
  };
  recModes.addEventListener('click', e => { const b = e.target.closest('.rec-mode'); if (b) { REC.mode = b.dataset.mode; syncRecUI(); } });
  $('#rec-mic').onchange = e => { REC.mic = e.target.checked; syncRecUI(); };
  $('#rec-live').onchange = e => { REC.live = e.target.checked; };
  $('#rec-corner').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { REC.corner = b.dataset.corner; syncRecUI(); } });
  $('#rec-size').oninput = e => { REC.size = +e.target.value; };
  $('#rec-start').onclick = beginRecording;
  $('#rec-where').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    REC.where = b.dataset.where;
    $$('#rec-where button').forEach(x => x.classList.toggle('active', x === b));
  });
  $('#rec-stop').onclick = stopRecording;
  $('#rec-pause').onclick = togglePauseRecording;
  syncRecUI();

  // export
  $('#export-kinds').addEventListener('click', e => {
    const b = e.target.closest('.export-kind');
    if (!b) return;
    exportKind = b.dataset.kind;
    $$('.export-kind').forEach(k => k.classList.toggle('active', k === b));
  });
  $('#export-go').onclick = runExport;
  $('#export-cancel').onclick = cancelExport;

  // buttons should never keep focus, so Return and Space always reach the editor
  document.addEventListener('pointerup', e => {
    const b = e.target.closest('button');
    if (b && !b.closest('.modal')) setTimeout(() => b.blur(), 0);
  });

  new ResizeObserver(sizePreview).observe($('#canvas-wrap'));
  new ResizeObserver(resizeTL).observe($('#tl-body'));
}

// ---------- main loop
let lastNow = performance.now(), lastPH = -1, lastVersion = -1;
function frame(now) {
  const dt = clamp((now - lastNow) / 1000, 0, 0.1);
  lastNow = now;
  stepPlayback(dt);
  draw(dt);
  if (S.playhead !== lastPH || S.version !== lastVersion) {
    lastPH = S.playhead; lastVersion = S.version;
    $('#t-cur').textContent = fmt(S.playhead);
    highlightTranscript();
    followPlayhead();
    updateExportProgress();
    tlDirty = true;
  }
  syncFxPanel();
  syncVoice();
  if (tlDirty) { tlDirty = false; drawTimeline(); }
}
function loop(now) {
  lastRafAt = performance.now();
  frame(now);
  requestAnimationFrame(loop);
}

// ---------- start
loadSettings();
initPhoto({ toast, openModal, closeModal });
buildFxPanel();
buildModeGrid();
wireUI();
applyTheme(S.theme);
syncCaptionUI();
renderLibrary();
afterEdit();
S.undo = [];
$('#btn-undo').disabled = true;
sizePreview();
resizeTL();
requestAnimationFrame(loop);

// handy for debugging in the console
window.cutroom = { S, importFiles, addSource, deleteRange, seek, play, pause };
