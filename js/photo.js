// Photo editor: drop in or take a photo, pick a filter, and scribble blur over anything.
import { TextLayer, newText } from './text.js?v=1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_SIDE = 2000;

const P = {
  base: null,            // the photo as a canvas (max 2000px on the long side)
  name: 'photo',
  faces: [],             // face boxes found in the photo, in photo pixels
  facesFound: false,
  filters: [],          // filters mixed together, applied in order (empty = original)
  texts: [],            // text on the photo
  amount: 0.7,
  adjust: { b: 0, c: 0, s: 0, k: 0 },
  blurStrength: 60,
  brush: 0.07,
  brushOn: false,
};
let processed = null, blurred = null, mask = null, layer = null;
let toast = msg => console.log(msg);
const view = $('#ph-canvas');
const vctx = view.getContext('2d');
const history = [], future = [];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
function copyCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
const pixels = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function fromPixels(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CAN_FILTER = (() => { const g = makeCanvas(1, 1).getContext('2d'); g.filter = 'blur(2px)'; return g.filter === 'blur(2px)'; })();

// ---------- finding faces (Google MediaPipe, runs on this computer)
let detectorP = null;
function getDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
      const { FaceDetector, FilesetResolver } = await import(`${V}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${V}/wasm`);
      return FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.35,
      });
    })();
    detectorP.catch(() => { detectorP = null; });
  }
  return detectorP;
}
export async function findFaces(canvas) {
  try {
    const det = await getDetector();
    // the model works best on smaller pictures, so look at a 640px copy
    const k = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
    const small = makeCanvas(canvas.width * k, canvas.height * k);
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    const res = det.detect(small);
    return res.detections.map(d => d.boundingBox).map(b => ({ x: b.originX / k, y: b.originY / k, w: b.width / k, h: b.height / k }));
  } catch (err) {
    console.warn('face finding failed', err);
    return [];
  }
}
// face filters need somewhere to work; with no face found they use the middle of the photo
function faceBoxes(faces, w, h) {
  return faces.length ? faces : [{ x: w * 0.3, y: h * 0.2, w: w * 0.4, h: h * 0.5 }];
}

// ---------- filters
function sample(d, w, h, x, y, out, o) {
  // past the edge, reflect back into the photo (looks natural) instead of smearing the last pixel
  if (x < 0) x = -x; else if (x > w - 1) x = 2 * (w - 1) - x;
  if (y < 0) y = -y; else if (y > h - 1) y = 2 * (h - 1) - y;
  x = clamp(x, 0, w - 1.001); y = clamp(y, 0, h - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = (y0 * w + x0) * 4, j = i + 4, k = i + w * 4, l = k + 4;
  for (let c = 0; c < 4; c++) {
    out[o + c] = (d[i + c] * (1 - fx) + d[j + c] * fx) * (1 - fy) + (d[k + c] * (1 - fx) + d[l + c] * fx) * fy;
  }
}

function faceWarp(src, faces, a, type) {
  const w = src.width, h = src.height;
  const sd = pixels(src).data;
  const img = new ImageData(new Uint8ClampedArray(sd), w, h), o = img.data;
  for (const f of faceBoxes(faces, w, h)) {
    const cx = f.x + f.w / 2, cy = f.y + f.h * 0.55;
    let rx, ry;
    if (type === 'squish' || type === 'long') { rx = f.w * 0.95; ry = f.h * 1.2; }
    else { rx = ry = Math.max(f.w, f.h) * (type === 'swirl' ? 1.3 : 1.05); }
    const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry, r2 = dx * dx + dy * dy;
        if (r2 >= 1) continue;
        const k = (1 - r2) * (1 - r2);
        let sx, sy;
        if (type === 'squish') { sx = cx + (x - cx) * (1 - 0.32 * a * k); sy = cy + (y - cy) * (1 + 0.85 * a * k); }
        else if (type === 'long') { sx = cx + (x - cx) * (1 + 0.4 * a * k); sy = cy + (y - cy) * (1 - 0.42 * a * k); }
        else if (type === 'bulge') { const m = 1 - 0.6 * a * k; sx = cx + (x - cx) * m; sy = cy + (y - cy) * m; }
        else if (type === 'pinch') { const m = 1 + 0.9 * a * k; sx = cx + (x - cx) * m; sy = cy + (y - cy) * m; }
        else {
          const ang = a * 3.4 * k, co = Math.cos(ang), si = Math.sin(ang), ox = x - cx, oy = y - cy;
          sx = cx + ox * co - oy * si; sy = cy + ox * si + oy * co;
        }
        sample(sd, w, h, sx, sy, o, (y * w + x) * 4);
      }
    }
  }
  return fromPixels(img);
}

function mirror(src, mode) {
  const w = src.width, h = src.height, hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
  const out = makeCanvas(w, h), g = out.getContext('2d');
  if (mode === 'left') {
    g.drawImage(src, 0, 0, hw, h, 0, 0, hw, h);
    g.translate(w, 0); g.scale(-1, 1);
    g.drawImage(src, 0, 0, hw, h, 0, 0, hw, h);
  } else if (mode === 'right') {
    g.drawImage(src, w - hw, 0, hw, h, w - hw, 0, hw, h);
    g.translate(w, 0); g.scale(-1, 1);
    g.drawImage(src, w - hw, 0, hw, h, w - hw, 0, hw, h);
  } else if (mode === 'top') {
    g.drawImage(src, 0, 0, w, hh, 0, 0, w, hh);
    g.translate(0, h); g.scale(1, -1);
    g.drawImage(src, 0, 0, w, hh, 0, 0, w, hh);
  } else {
    for (const fx of [1, -1]) for (const fy of [1, -1]) {
      g.save();
      g.translate(fx < 0 ? w : 0, fy < 0 ? h : 0); g.scale(fx, fy);
      g.drawImage(src, 0, 0, hw, hh, 0, 0, hw, hh);
      g.restore();
    }
  }
  return out;
}

function wave(src, a) {
  const w = src.width, h = src.height, sd = pixels(src).data;
  const img = new ImageData(w, h), o = img.data;
  const amp = Math.min(w, h) * 0.04 * a;
  for (let y = 0; y < h; y++) {
    const shift = Math.sin(y / h * Math.PI * 9) * amp;
    for (let x = 0; x < w; x++) sample(sd, w, h, x + shift, y + Math.sin(x / w * Math.PI * 7) * amp * 0.6, o, (y * w + x) * 4);
  }
  return fromPixels(img);
}

function glitch(src, a) {
  const w = src.width, h = src.height, sd = pixels(src).data;
  const img = new ImageData(w, h), o = img.data;
  const sh = Math.max(2, Math.round(w * 0.014 * a));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      o[i] = sd[(y * w + Math.min(w - 1, x + sh)) * 4];
      o[i + 1] = sd[i + 1];
      o[i + 2] = sd[(y * w + Math.max(0, x - sh)) * 4 + 2];
      o[i + 3] = 255;
    }
  }
  const split = fromPixels(img), out = copyCanvas(split), g = out.getContext('2d');
  const R = rng(7);
  for (let n = 0; n < 16; n++) {
    const y = R() * h, sh2 = h * (0.01 + R() * 0.05), off = (R() - 0.5) * w * 0.12 * a;
    g.drawImage(split, 0, y, w, sh2, off, y, w, sh2);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < h; y += Math.max(3, h / 240)) g.fillRect(0, y, w, Math.max(1, h / 900));
  return out;
}

function hexRGB(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function makeLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3), cs = stops.map(([p, c]) => [p, hexRGB(c)]);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0;
    while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
    const [p0, c0] = cs[k], [p1, c1] = cs[k + 1], u = clamp((t - p0) / (p1 - p0), 0, 1);
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = c0[c] + (c1[c] - c0[c]) * u;
  }
  return lut;
}
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function mapPixels(src, fn) {
  const img = pixels(src), d = img.data;
  for (let i = 0; i < d.length; i += 4) fn(d, i);
  return fromPixels(img);
}

const THERMAL = makeLUT([[0, '#05001a'], [0.22, '#3b0a8c'], [0.42, '#c0147d'], [0.6, '#ff4a1c'], [0.8, '#ffc400'], [1, '#ffffff']]);
function thermal(src) {
  return mapPixels(src, (d, i) => { const v = lum(d, i) | 0; d[i] = THERMAL[v * 3]; d[i + 1] = THERMAL[v * 3 + 1]; d[i + 2] = THERMAL[v * 3 + 2]; });
}

function vignette(c, strength) {
  const g = c.getContext('2d'), w = c.width, h = c.height;
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  return c;
}
function noir(src) {
  return vignette(mapPixels(src, (d, i) => { const v = clamp((lum(d, i) - 128) * 1.55 + 122, 0, 255); d[i] = d[i + 1] = d[i + 2] = v; }), 0.6);
}
function vintage(src) {
  const R = rng(3);
  return vignette(mapPixels(src, (d, i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2], n = (R() - 0.5) * 26;
    d[i] = clamp((0.393 * r + 0.769 * g + 0.189 * b) * 0.86 + 34 + n, 0, 255);
    d[i + 1] = clamp((0.349 * r + 0.686 * g + 0.168 * b) * 0.84 + 26 + n, 0, 255);
    d[i + 2] = clamp((0.272 * r + 0.534 * g + 0.131 * b) * 0.8 + 18 + n, 0, 255);
  }), 0.45);
}

const POP = [['#1c1259', '#ff3d7f', '#ffe600'], ['#0b2e5c', '#00c2ff', '#ff7a00'], ['#3a0a63', '#7cff4f', '#ff4fd8'], ['#5c1010', '#ffd400', '#2de2e6']];
function popArt(src) {
  const w = src.width, h = src.height, hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
  const small = makeCanvas(hw, hh);
  small.getContext('2d').drawImage(src, 0, 0, hw, hh);
  const base = pixels(small).data;
  const out = makeCanvas(w, h), g = out.getContext('2d');
  POP.forEach((pal, q) => {
    const cols = pal.map(hexRGB), img = new ImageData(hw, hh), o = img.data;
    for (let i = 0; i < base.length; i += 4) {
      const v = lum(base, i), c = cols[v < 85 ? 0 : v < 170 ? 1 : 2];
      o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255;
    }
    g.putImageData(img, (q % 2) * hw, Math.floor(q / 2) * hh);
  });
  return out;
}

function neon(src) {
  const w = src.width, h = src.height, sd = pixels(src).data;
  const L = new Float32Array(w * h);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) L[p] = lum(sd, i);
  const edges = new ImageData(w, h), e = edges.data;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = -L[p - w - 1] - 2 * L[p - 1] - L[p + w - 1] + L[p - w + 1] + 2 * L[p + 1] + L[p + w + 1];
      const gy = -L[p - w - 1] - 2 * L[p - w] - L[p - w + 1] + L[p + w - 1] + 2 * L[p + w] + L[p + w + 1];
      const m = Math.min(255, Math.hypot(gx, gy) * 1.2);
      const i = p * 4;
      e[i] = e[i + 1] = e[i + 2] = 255; e[i + 3] = m > 40 ? m : 0;
    }
  }
  const lines = fromPixels(edges), lg = lines.getContext('2d');
  const rainbow = lg.createLinearGradient(0, 0, w, h);
  ['#ff2fd6', '#7a5cff', '#2de2e6', '#3dff8b', '#ffe14d'].forEach((c, i, a) => rainbow.addColorStop(i / (a.length - 1), c));
  lg.globalCompositeOperation = 'source-in';
  lg.fillStyle = rainbow; lg.fillRect(0, 0, w, h);
  const out = makeCanvas(w, h), g = out.getContext('2d');
  g.fillStyle = '#05030d'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  if (CAN_FILTER) { g.filter = `blur(${Math.max(2, w / 300)}px)`; g.drawImage(lines, 0, 0); g.filter = 'none'; }
  g.drawImage(lines, 0, 0);
  g.drawImage(lines, 0, 0);
  return out;
}

function pixelArt(src, a) {
  const w = src.width, h = src.height, block = Math.max(3, Math.round(Math.max(w, h) * (0.006 + 0.03 * a)));
  const small = makeCanvas(w / block, h / block);
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const out = makeCanvas(w, h), g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, w, h);
  return out;
}

// kind: 'face' uses the strength slider on faces, 'amount' is strength, 'mix' blends with the photo, 'none' has no slider
export const FILTERS = [
  { id: 'original', name: 'Original', kind: 'none', run: src => src },
  { id: 'squish', name: 'Squished face', kind: 'face', run: (s, a, f) => faceWarp(s, f, a, 'squish') },
  { id: 'bighead', name: 'Big head', kind: 'face', run: (s, a, f) => faceWarp(s, f, a, 'bulge') },
  { id: 'tiny', name: 'Tiny face', kind: 'face', run: (s, a, f) => faceWarp(s, f, a, 'pinch') },
  { id: 'long', name: 'Long face', kind: 'face', run: (s, a, f) => faceWarp(s, f, a, 'long') },
  { id: 'swirl', name: 'Swirl face', kind: 'face', run: (s, a, f) => faceWarp(s, f, a, 'swirl') },
  { id: 'mirror-l', name: 'Mirror left', kind: 'none', run: s => mirror(s, 'left') },
  { id: 'mirror-r', name: 'Mirror right', kind: 'none', run: s => mirror(s, 'right') },
  { id: 'mirror-t', name: 'Upside twin', kind: 'none', run: s => mirror(s, 'top') },
  { id: 'kaleido', name: 'Kaleidoscope', kind: 'none', run: s => mirror(s, 'quad') },
  { id: 'wave', name: 'Wavy', kind: 'amount', run: (s, a) => wave(s, a) },
  { id: 'glitch', name: 'Glitch', kind: 'amount', run: (s, a) => glitch(s, a) },
  { id: 'popart', name: 'Pop art', kind: 'mix', run: s => popArt(s) },
  { id: 'neon', name: 'Neon lines', kind: 'mix', run: s => neon(s) },
  { id: 'thermal', name: 'Heat vision', kind: 'mix', run: s => thermal(s) },
  { id: 'vintage', name: 'Vintage', kind: 'mix', run: s => vintage(s) },
  { id: 'noir', name: 'Noir', kind: 'mix', run: s => noir(s) },
  { id: 'pixel', name: 'Pixel art', kind: 'amount', run: (s, a) => pixelArt(s, a) },
];
const findFilter = id => FILTERS.find(f => f.id === id) || FILTERS[0];

export function applyFilter(src, id, amount, faces) {
  const f = findFilter(id);
  let out = f.run(src, amount, faces);
  if (f.kind === 'mix' && amount < 0.999) {
    const m = copyCanvas(src), g = m.getContext('2d');
    g.globalAlpha = amount; g.drawImage(out, 0, 0);
    out = m;
  }
  return out;
}

// Soften: a smooth blur over the whole photo.
function soften(src, amount) {
  if (!amount) return src;
  const w = src.width, h = src.height, px = amount * Math.max(w, h) / 45;
  const out = makeCanvas(w, h), g = out.getContext('2d');
  if (CAN_FILTER) {
    g.filter = `blur(${px}px)`;
    const pad = px * 2;
    g.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2);
    g.filter = 'none';
  } else {
    // browsers without canvas blur: shrink and grow back, which softens too
    const f = clamp(px, 1.5, 40), small = makeCanvas(w / f, h / f), sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(src, 0, 0, small.width, small.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, 0, 0, w, h);
  }
  return out;
}

function applyAdjust(src, { b, c, s }) {
  if (!b && !c && !s) return src;
  const add = b * 90, cf = 1 + c, sf = 1 + s;
  return mapPixels(src, (d, i) => {
    const l = lum(d, i);
    for (let k = 0; k < 3; k++) {
      let v = l + (d[i + k] - l) * sf;
      v = (v - 128) * cf + 128 + add;
      d[i + k] = v;
    }
  });
}

// ---------- the picture pipeline: photo -> filter -> adjust -> processed, then blur through the mask
let rebuildTimer = null, rebuildToken = 0;
function scheduleRebuild(delay = 0) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, delay);
}
async function rebuild() {
  if (!P.base) return;
  const token = ++rebuildToken;
  const slow = P.filters.some(id => findFilter(id).kind !== 'none');
  if (slow) { busy(true, 'Applying filter...'); await sleep(16); }
  if (token !== rebuildToken) return;
  let out = P.base;
  for (const id of P.filters) out = applyFilter(out, id, P.amount, P.faces);
  processed = soften(applyAdjust(out === P.base ? copyCanvas(out) : out, P.adjust), P.adjust.k || 0);
  rebuildBlur();
  busy(false);
  compose();
}
function rebuildBlur() {
  if (!processed) return;
  const w = processed.width, h = processed.height, k = Math.max(w, h) / 1000;
  blurred = makeCanvas(w, h);
  const g = blurred.getContext('2d');
  const st = P.blurStrength / 100;
  // the blur is always pixels: shrink the photo, then grow it back with hard edges
  const block = Math.max(4, Math.round((6 + st * 40) * k));
  const small = makeCanvas(w / block, h / block);
  small.getContext('2d').drawImage(processed, 0, 0, small.width, small.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, w, h);
}
function compose(original = false) {
  if (!P.base || !processed) return;
  vctx.globalCompositeOperation = 'copy';
  vctx.drawImage(original ? (P.original || P.base) : processed, 0, 0);
  vctx.globalCompositeOperation = 'source-over';
  if (original) return;
  const lg = layer.getContext('2d');
  lg.globalCompositeOperation = 'copy';
  lg.drawImage(blurred, 0, 0);
  lg.globalCompositeOperation = 'destination-in';
  lg.drawImage(mask, 0, 0);
  lg.globalCompositeOperation = 'source-over';
  vctx.drawImage(layer, 0, 0);
  textLayer?.draw(vctx, view.width, view.height);
}
function busy(on, text) {
  $('#ph-busy').hidden = !on;
  if (text) $('#ph-busy-text').textContent = text;
}

// ---------- AI Unblur: a free model that runs on this computer and needs no sign-in
const UNBLUR_WORKER = `
import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
env.allowLocalModels = false;
const MODEL = 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr';
let up = null, device = 'wasm';
const progress = id => p => self.postMessage({ id, type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } });
self.onmessage = async e => {
  const { id, data, width, height } = e.data;
  try {
    if (!up) up = await pipeline('image-to-image', MODEL, { dtype: 'q8', device: 'wasm', progress_callback: progress(id) });
    self.postMessage({ id, type: 'status' });
    const out = await up(new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb());
    self.postMessage({ id, type: 'done', data: out.data, width: out.width, height: out.height, channels: out.channels }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};`;
let unblurWorker = null;
const UNBLUR_SIDE = 320;  // the model makes a picture 4 times this size

function runUnblur(small, onMsg) {
  if (!unblurWorker) unblurWorker = new Worker(URL.createObjectURL(new Blob([UNBLUR_WORKER], { type: 'text/javascript' })), { type: 'module' });
  const id = `u${Date.now()}`;
  const img = pixels(small);
  return new Promise((res, rej) => {
    const h = e => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'done') { unblurWorker.removeEventListener('message', h); res(m); }
      else if (m.type === 'error') { unblurWorker.removeEventListener('message', h); rej(new Error(m.message)); }
      else onMsg(m);
    };
    unblurWorker.addEventListener('message', h);
    unblurWorker.postMessage({ id, data: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]);
  });
}

async function aiUnblur() {
  if (!P.base) { toast('Open or take a photo first'); return; }
  const btn = $('#ph-unblur'), base = P.base;
  btn.disabled = true;
  busy(true, 'Getting AI Unblur ready...');
  const files = {};
  try {
    const k = Math.min(1, UNBLUR_SIDE / Math.max(base.width, base.height));
    const small = makeCanvas(base.width * k, base.height * k), sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(base, 0, 0, small.width, small.height);
    const out = await runUnblur(small, m => {
      if (m.type === 'progress' && m.p.status === 'progress' && m.p.total) {
        files[m.p.file] = [m.p.loaded, m.p.total];
        const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
        busy(true, `Downloading AI Unblur ${Math.round(l / t * 100)}%`);
      } else if (m.type === 'status') busy(true, 'AI is unblurring your photo...');
    });
    if (P.base !== base) return;  // a different photo was opened meanwhile
    const rgba = new ImageData(out.width, out.height), o = rgba.data, ch = out.channels;
    for (let i = 0, j = 0; i < o.length; i += 4, j += ch) {
      o[i] = out.data[j]; o[i + 1] = out.data[j + 1]; o[i + 2] = out.data[j + 2]; o[i + 3] = 255;
    }
    const sharp = makeCanvas(base.width, base.height), g = sharp.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(fromPixels(rgba), 0, 0, sharp.width, sharp.height);
    pushHistory();
    P.base = sharp;
    P.adjust.k = 0;  // the Soften slider goes back to none
    syncUI();
    await rebuild();
    makeThumbs(true);
    toast('Photo unblurred. Hold "compare" to see the difference, or Cmd+Z to undo.', 3600);
  } catch (err) {
    console.error(err);
    busy(false);
    toast('AI Unblur could not finish. The first time needs internet. Try again.', 4000);
  } finally {
    busy(false);
    btn.disabled = false;
  }
}

// ---------- history (undo / redo)
function snap() {
  return { base: P.base, mask: mask ? copyCanvas(mask) : null, filters: [...P.filters], amount: P.amount, adjust: { ...P.adjust }, texts: JSON.parse(JSON.stringify(P.texts)) };
}
function pushHistory() {
  if (!P.base) return;
  history.push(snap());
  if (history.length > 30) history.shift();
  future.length = 0;
  syncButtons();
}
function restore(st) {
  const same = st.base === P.base && st.filters.join() === P.filters.join() && st.amount === P.amount && JSON.stringify(st.adjust) === JSON.stringify(P.adjust);
  if (st.base) P.base = st.base;
  P.filters = [...st.filters]; P.amount = st.amount; P.adjust = { ...st.adjust };
  P.texts = st.texts || [];
  textLayer?.syncPanel(); textLayer?.syncOverlay();
  const m = mask.getContext('2d');
  m.globalCompositeOperation = 'copy';
  m.drawImage(st.mask, 0, 0);
  m.globalCompositeOperation = 'source-over';
  syncUI();
  if (same) compose(); else scheduleRebuild();
}
function undo() { if (!history.length) return; future.push(snap()); restore(history.pop()); syncButtons(); }
function redo() { if (!future.length) return; history.push(snap()); restore(future.pop()); syncButtons(); }
function syncButtons() {
  $('#ph-undo').disabled = !history.length;
  $('#ph-redo').disabled = !future.length;
}

// ---------- opening a photo
async function open(file) {
  let source;
  try { source = await createImageBitmap(file); }
  catch {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast('Could not open that photo. Try a JPG or PNG. (iPhone HEIC photos open in Safari.)');
      return;
    }
  }
  setPhoto(source, (file.name || 'photo').replace(/\.[^.]+$/, ''));
}

async function setPhoto(source, name) {
  const sw = source.width, sh = source.height, k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  P.base = makeCanvas(sw * k, sh * k);
  P.base.getContext('2d').drawImage(source, 0, 0, P.base.width, P.base.height);
  P.original = P.base;
  P.name = name;
  P.faces = []; P.facesFound = false;
  P.filters = [];
  P.texts = [];
  textLayer?.select(null);
  P.adjust = { b: 0, c: 0, s: 0, k: 0 };
  mask = makeCanvas(P.base.width, P.base.height);
  layer = makeCanvas(P.base.width, P.base.height);
  view.width = P.base.width; view.height = P.base.height;
  history.length = 0; future.length = 0;
  document.body.classList.remove('photo-empty');
  $('#ph-download').disabled = false;
  syncUI(); syncButtons(); sizeView();
  await rebuild();
  makeThumbs(false);
  setFaceStatus('Looking for faces...');
  const base = P.base;
  const faces = await findFaces(base);
  if (P.base !== base) return;
  P.faces = faces;
  P.facesFound = true;
  setFaceStatus(faces.length ? `Found ${faces.length} face${faces.length > 1 ? 's' : ''}` : 'No face found', faces.length > 0);
  makeThumbs(true);
  if (P.filters.some(id => findFilter(id).kind === 'face')) scheduleRebuild();
}
function setFaceStatus(text, found) {
  const el = $('#face-status');
  el.textContent = text;
  el.classList.toggle('found', !!found);
  el.title = found === false ? 'Face filters will change the middle of the photo instead' : '';
}

// Small previews of every filter, made from a tiny copy of the photo.
let thumbToken = 0;
async function makeThumbs(withFaces) {
  const token = ++thumbToken;
  const k = 220 / Math.max(P.base.width, P.base.height);
  const small = makeCanvas(P.base.width * k, P.base.height * k);
  small.getContext('2d').drawImage(P.base, 0, 0, small.width, small.height);
  const faces = P.faces.map(f => ({ x: f.x * k, y: f.y * k, w: f.w * k, h: f.h * k }));
  for (const f of FILTERS) {
    if (f.kind === 'face' && !withFaces) continue;
    if (token !== thumbToken) return;
    const out = applyFilter(small, f.id, f.kind === 'mix' ? 1 : 0.85, faces);
    const el = $(`#filter-grid .filter-card[data-filter="${f.id}"] .fc-img`);
    if (el) { el.style.backgroundImage = `url(${out.toDataURL('image/jpeg', 0.82)})`; el.innerHTML = ''; }
    await sleep(0);
  }
}

// ---------- sizing the picture on screen
function sizeView() {
  const wrap = $('#ph-wrap'), r = wrap.getBoundingClientRect();
  const aw = r.width - 28, ah = r.height - 28, ar = view.width / view.height;
  let w = aw, h = w / ar;
  if (h > ah) { h = ah; w = h * ar; }
  view.style.width = `${Math.max(0, Math.floor(w))}px`;
  view.style.height = `${Math.max(0, Math.floor(h))}px`;
}

// ---------- blur brush: hold Cmd+Shift and move, or turn on the brush and drag
let last = null, keyStroke = false, dragging = false;
const brushR = () => P.brush * Math.min(view.width, view.height) / 2;
function toImg(e) {
  const r = view.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * view.width, y: (e.clientY - r.top) / r.height * view.height, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
}
function paint(p, erase) {
  const m = mask.getContext('2d');
  m.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  m.strokeStyle = m.fillStyle = '#fff';
  m.lineCap = m.lineJoin = 'round';
  m.lineWidth = brushR() * 1.6;
  // a soft glow around the stroke makes the blur fade out at its edges
  m.shadowColor = '#fff';
  m.shadowBlur = brushR() * 0.5;
  if (last) { m.beginPath(); m.moveTo(last.x, last.y); m.lineTo(p.x, p.y); m.stroke(); }
  else { m.beginPath(); m.arc(p.x, p.y, brushR() * 0.8, 0, Math.PI * 2); m.fill(); }
  m.globalCompositeOperation = 'source-over';
  m.shadowBlur = 0;
  last = p;
  compose();
}
function showBrush(e, on, erase) {
  const el = $('#ph-brush'), wrap = $('#ph-wrap');
  wrap.classList.toggle('painting', on);
  $('#ph-mode-pill').textContent = erase ? 'Unblurring' : 'Blurring';
  if (!on) { el.style.display = 'none'; return; }
  const wr = wrap.getBoundingClientRect(), vr = view.getBoundingClientRect();
  const d = brushR() * 2 * vr.width / view.width;
  el.style.display = 'block';
  el.style.width = el.style.height = `${d}px`;
  el.style.left = `${e.clientX - wr.left}px`;
  el.style.top = `${e.clientY - wr.top}px`;
  el.classList.toggle('erase', erase);
}
function onMove(e) {
  if (!P.base) return;
  const keys = (e.metaKey || e.ctrlKey) && e.shiftKey;
  const erase = e.altKey;
  const p = toImg(e);
  showBrush(e, (keys || P.brushOn) && p.inside, erase);
  if (keys && p.inside) {
    if (!keyStroke) { pushHistory(); keyStroke = true; last = null; }
    paint(p, erase);
  } else if (dragging) {
    paint(p, erase);
  } else {
    if (keyStroke) { keyStroke = false; last = null; }
  }
}

// ---------- taking a photo
let camStream = null;
async function openCamera() {
  openModal('cam-modal');
  $('#cam-msg').hidden = false;
  $('#cam-msg').textContent = 'Starting camera...';
  $('#cam-snap').disabled = true;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: false });
    const v = $('#cam-video');
    v.srcObject = camStream;
    await v.play();
    $('#cam-msg').hidden = true;
    $('#cam-snap').disabled = false;
  } catch (err) {
    $('#cam-msg').textContent = err && err.name === 'NotAllowedError'
      ? 'Camera permission was not given. Allow the camera in your browser and try again.'
      : 'No camera was found.';
  }
}
function closeCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  $('#cam-video').srcObject = null;
  $('#cam-count').textContent = '';
  closeModal('cam-modal');
}
async function snapPhoto() {
  const v = $('#cam-video');
  if (!v.videoWidth) return;
  $('#cam-snap').disabled = true;
  if ($('#cam-timer').checked) {
    for (let i = 3; i > 0; i--) { $('#cam-count').textContent = i; await sleep(1000); }
    $('#cam-count').textContent = '';
  }
  const c = makeCanvas(v.videoWidth, v.videoHeight), g = c.getContext('2d');
  g.translate(c.width, 0); g.scale(-1, 1);  // save it the way you saw it, like a mirror
  g.drawImage(v, 0, 0);
  const flash = $('#cam-flash');
  flash.classList.add('go');
  requestAnimationFrame(() => setTimeout(() => flash.classList.remove('go'), 30));
  await sleep(250);
  closeCamera();
  const n = new Date();
  setPhoto(c, `Photo ${n.getHours()}-${String(n.getMinutes()).padStart(2, '0')}`);
}

// ---------- export
const PE = { format: 'png', size: 0, quality: 0.9 };
const FORMAT_HELP = { png: 'Best quality, bigger file.', jpeg: 'Smaller file, works everywhere.', webp: 'Smallest file, good for websites.' };
let peTimer = null;

function renderExport() {
  compose();
  const long = Math.max(view.width, view.height);
  const k = PE.size && PE.size < long ? PE.size / long : 1;
  const c = makeCanvas(view.width * k, view.height * k), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(view, 0, 0, c.width, c.height);
  return c;
}
const exportBlob = c => new Promise(res => c.toBlob(res, `image/${PE.format}`, PE.format === 'png' ? undefined : PE.quality));
const sizeText = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

function syncExport() {
  $$('#pe-format button').forEach(b => b.classList.toggle('active', b.dataset.format === PE.format));
  $$('#pe-size button').forEach(b => b.classList.toggle('active', +b.dataset.size === PE.size));
  $('#pe-format-help').textContent = FORMAT_HELP[PE.format];
  $('#pe-quality-box').hidden = PE.format === 'png';
  $('#pe-quality-val').textContent = `${Math.round(PE.quality * 100)}%`;
  // work out the real file size in the background
  $('#pe-info').textContent = 'Working out the file size...';
  clearTimeout(peTimer);
  peTimer = setTimeout(async () => {
    const c = renderExport(), b = await exportBlob(c);
    $('#pe-info').textContent = `${c.width} x ${c.height} pixels, about ${sizeText(b.size)}`;
  }, 120);
}

export function openExport() {
  if (!P.base) { toast('Open or take a photo first'); return; }
  compose();
  $('#pe-img').src = view.toDataURL('image/jpeg', 0.8);
  $('#pe-name').value = `${P.name} edited`;
  syncExport();
  openModal('photo-export-modal');
}

async function exportPhoto() {
  const c = renderExport();
  const blob = await exportBlob(c);
  if (!blob) { toast('This browser cannot save that file type. Try PNG or JPG.'); return; }
  const ext = PE.format === 'jpeg' ? 'jpg' : PE.format;
  const name = ($('#pe-name').value.trim() || `${P.name} edited`).replace(/[\\/:*?"<>|]+/g, '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  closeModal('photo-export-modal');
  toast(`Saved ${name}.${ext} (${sizeText(blob.size)})`);
}

// ---------- choosing filters: click for one, hold Cmd+Option and click to mix up to 10
const MAX_MIX = 10;
const mixKeys = e => (e.metaKey || e.ctrlKey) && e.altKey;
let focusIndex = -1;

function pickFilter(id, mix) {
  if (!P.base) { toast('Open or take a photo first'); return; }
  let next;
  if (id === 'original') next = [];
  else if (mix) {
    const i = P.filters.indexOf(id);
    if (i >= 0) next = P.filters.filter(f => f !== id);
    else if (P.filters.length >= MAX_MIX) { toast(`You can mix up to ${MAX_MIX} filters`); return; }
    else next = [...P.filters, id];
  } else {
    if (P.filters.length === 1 && P.filters[0] === id) return;
    next = [id];
  }
  pushHistory();
  P.filters = next;
  syncUI();
  scheduleRebuild();
  if (findFilter(id).kind === 'face' && next.includes(id) && P.facesFound && !P.faces.length) toast('No face found, so this changes the middle of the photo');
  if (mix && next.length >= 2 && next.includes(id)) toast(`${findFilter(id).name} added. ${next.length} filters mixed.`, 1600);
}

// Arrow keys walk through the filters (3 per row); Return picks the highlighted one.
function moveFocus(step) {
  const cards = $$('#filter-grid .filter-card');
  focusIndex = clamp((focusIndex < 0 ? 0 : focusIndex + step), 0, cards.length - 1);
  cards.forEach((c, i) => c.classList.toggle('focus', i === focusIndex));
  cards[focusIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function showMixHint(on) {
  $('#mix-hint').hidden = !on;
}

// ---------- UI
function syncUI() {
  const kinds = P.filters.map(id => findFilter(id).kind);
  $$('#filter-grid .filter-card').forEach(c => {
    const n = P.filters.indexOf(c.dataset.filter);
    const on = c.dataset.filter === 'original' ? !P.filters.length : n >= 0;
    c.classList.toggle('active', on);
    c.querySelector('.fc-badge').textContent = P.filters.length > 1 && n >= 0 ? n + 1 : '';
  });
  $('#amount-box').hidden = kinds.every(k => k === 'none');
  $('#amount-label').textContent = kinds.length > 1 ? 'Strength of all filters' : kinds[0] === 'mix' ? 'Amount' : 'Strength';
  const bar = $('#mix-bar');
  bar.hidden = P.filters.length < 2;
  $('#mix-list').textContent = P.filters.map(id => findFilter(id).name).join(' + ');
  $('#mix-count').textContent = `Mixing ${P.filters.length} of ${MAX_MIX}`;
  $('#ph-amount').value = P.amount;
  $('#amount-val').textContent = `${Math.round(P.amount * 100)}%`;
  for (const k of ['b', 'c', 's', 'k']) {
    $(`#adj-${k}`).value = P.adjust[k];
    $(`#adj-${k}-val`).textContent = Math.round(P.adjust[k] * 100);
  }
  $('#brush-val').textContent = `${Math.round(P.brush * 100)}%`;
  $('#blur-val').textContent = `${P.blurStrength}%`;
  $('#ph-brush-btn').classList.toggle('on', P.brushOn);
}

let openModal = id => { $(`#${id}`).hidden = false; };
let closeModal = id => { $(`#${id}`).hidden = true; };
export const isActive = () => document.body.classList.contains('photo-mode');

let textLayer = null;

export function initPhoto(api) {
  toast = api.toast || toast;
  openModal = api.openModal || openModal;
  closeModal = api.closeModal || closeModal;
  document.body.classList.add('photo-empty');

  $('#filter-grid').innerHTML = FILTERS.map(f => `
    <button class="filter-card" data-filter="${f.id}">
      <div class="fc-img"><svg class="i"><use href="#i-${f.kind === 'face' ? 'face' : 'image'}"/></svg></div>
      <div class="fc-name">${f.name}</div>
      <span class="fc-badge"></span>
    </button>`).join('');
  $('#filter-grid').addEventListener('click', e => {
    const c = e.target.closest('.filter-card');
    if (!c) return;
    focusIndex = $$('#filter-grid .filter-card').indexOf(c);
    pickFilter(c.dataset.filter, mixKeys(e));
  });
  $('#mix-clear').onclick = () => { if (P.filters.length) { pushHistory(); P.filters = []; syncUI(); scheduleRebuild(); } };

  let sliding = false;
  const startSlide = () => { if (!sliding) { pushHistory(); sliding = true; } };
  const endSlide = () => { sliding = false; };
  $('#ph-amount').addEventListener('input', e => { startSlide(); P.amount = +e.target.value; syncUI(); scheduleRebuild(140); });
  $('#ph-amount').addEventListener('change', endSlide);
  for (const k of ['b', 'c', 's', 'k']) {
    $(`#adj-${k}`).addEventListener('input', e => { startSlide(); P.adjust[k] = +e.target.value; syncUI(); scheduleRebuild(90); });
    $(`#adj-${k}`).addEventListener('change', endSlide);
  }
  $('#ph-blur').addEventListener('input', e => { P.blurStrength = +e.target.value; syncUI(); rebuildBlur(); compose(); });
  $('#ph-brush-size').addEventListener('input', e => { P.brush = +e.target.value; syncUI(); });
  $('#ph-clear-blur').onclick = () => {
    if (!mask) return;
    pushHistory();
    mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
    compose();
  };

  $('#ph-unblur').onclick = aiUnblur;
  $('#ph-open').onclick = () => $('#ph-file').click();
  $('#ph-take').onclick = openCamera;
  $('#ph-empty').addEventListener('click', e => {
    const b = e.target.closest('[data-ph]');
    if (b) b.dataset.ph === 'open' ? $('#ph-file').click() : openCamera();
  });
  $('#ph-file').onchange = e => { const f = e.target.files[0]; if (f) open(f); e.target.value = ''; };
  $('#ph-undo').onclick = undo;
  $('#ph-redo').onclick = redo;
  $('#ph-brush-btn').onclick = () => { P.brushOn = !P.brushOn; syncUI(); toast(P.brushOn ? 'Blur brush on: click and drag on the photo' : 'Blur brush off', 1800); };
  $('#ph-reset').onclick = () => {
    if (!P.base) return;
    pushHistory();
    P.filters = []; P.texts = []; textLayer?.select(null); P.amount = 0.7; P.adjust = { b: 0, c: 0, s: 0, k: 0 };
    mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
    syncUI(); scheduleRebuild();
  };
  const cmp = $('#ph-compare');
  cmp.addEventListener('pointerdown', () => compose(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cmp.addEventListener(ev, () => compose());
  $('#ph-download').onclick = openExport;
  $('#pe-format').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { PE.format = b.dataset.format; syncExport(); } });
  $('#pe-size').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { PE.size = +b.dataset.size; syncExport(); } });
  $('#pe-quality').addEventListener('input', e => { PE.quality = +e.target.value; syncExport(); });
  $('#pe-go').onclick = exportPhoto;

  $('#cam-snap').onclick = snapPhoto;
  $('#cam-modal').addEventListener('click', e => {
    if (e.target.id === 'cam-modal' || e.target.closest('[data-cam-close]')) closeCamera();
  });

  const wrap = $('#ph-wrap');
  addEventListener('pointermove', e => { if (isActive()) onMove(e); });
  wrap.addEventListener('pointerdown', e => {
    if (!P.base || e.button !== 0) return;
    const p = toImg(e);
    const keys = (e.metaKey || e.ctrlKey) && e.shiftKey;
    if (!p.inside || !(P.brushOn || keys)) return;
    e.preventDefault();
    if (!keyStroke) pushHistory();
    dragging = true; last = null;
    paint(p, e.altKey);
  });
  addEventListener('pointerup', () => { dragging = false; if (!keyStroke) last = null; });

  addEventListener('keydown', e => {
    if (!isActive()) return;
    if (e.key === 'Escape' && !$('#cam-modal').hidden) { closeCamera(); return; }
    if (!$('#photo-export-modal').hidden) {
      if (e.key === 'Escape') closeModal('photo-export-modal');
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); exportPhoto(); }
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    const mod = e.metaKey || e.ctrlKey;
    showMixHint(mixKeys(e));
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (!P.base || !$('#cam-modal').hidden) return;
    const steps = { ArrowUp: -3, ArrowDown: 3, ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in steps && e.target.type !== 'range') { e.preventDefault(); moveFocus(steps[e.key]); return; }
    if (e.key === 'Enter' && focusIndex >= 0) {
      e.preventDefault();
      pickFilter($$('#filter-grid .filter-card')[focusIndex].dataset.filter, mixKeys(e));
    }
  });
  addEventListener('keyup', e => {
    if (!isActive()) return;
    showMixHint(mixKeys(e));
    if (e.key === 'Meta' || e.key === 'Shift' || e.key === 'Control') {
      keyStroke = false; last = null;
      if (!P.brushOn) showBrush(e, false, false);
    }
  });
  addEventListener('blur', () => { keyStroke = false; dragging = false; last = null; showMixHint(false); });

  new ResizeObserver(sizeView).observe(wrap);
  syncUI();

  textLayer = new TextLayer({
    panel: $('#ph-text-panel'), canvas: view, wrap,
    items: () => P.texts,
    add: () => {
      if (!P.base) { toast('Open or take a photo first'); throw new Error('no photo'); }
      pushHistory();
      const it = newText();
      P.texts.push(it);
      return it;
    },
    remove: id => { P.texts = P.texts.filter(t => t.id !== id); },
    changed: () => compose(),
    before: pushHistory,
  });
  textLayer.isBusy = () => P.brushOn;
}

// Adds a text on top of the open photo (used when a thumbnail is opened here).
function addText(props) {
  if (!P.base) return;
  P.texts.push(newText(props));
  compose();
  textLayer?.syncPanel();
}

export const Photo = { open, isActive, openExport, addText };

// handy for debugging in the console
window.cutroomPhoto = { P, open, setPhoto, FILTERS };
