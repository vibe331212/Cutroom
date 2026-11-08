// Backgrounds behind the video, and frames around or over it. Everything is drawn in code.
// A frame with "inset" takes room around the video; one without is drawn on top of it.

export const BACKGROUNDS = [
  { id: 'none', name: 'None' },
  { id: 'gray', name: 'Gray', stops: ['#adb0b5', '#83868c'] },
  { id: 'charcoal', name: 'Charcoal', stops: ['#3a3c42', '#1f2024'] },
  { id: 'white', name: 'White', stops: ['#ffffff', '#e6e7ea'] },
  { id: 'black', name: 'Black', stops: ['#000000', '#000000'] },
  { id: 'ocean', name: 'Ocean', stops: ['#38bdf8', '#1e3a8a'] },
  { id: 'sunset', name: 'Sunset', stops: ['#fbbf24', '#db2777'] },
  { id: 'grape', name: 'Grape', stops: ['#a78bfa', '#4c1d95'] },
  { id: 'forest', name: 'Forest', stops: ['#4ade80', '#14532d'] },
  { id: 'grid', name: 'Studio grid' },
  { id: 'blur', name: 'Blurred video' },
];

let blurCanvas = null;
export function drawBackground(c, id, W, H, source) {
  const b = BACKGROUNDS.find(x => x.id === id);
  if (!b || id === 'none') return false;
  if (b.stops) {
    const g = c.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, b.stops[0]);
    g.addColorStop(1, b.stops[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  } else if (id === 'grid') {
    c.fillStyle = '#e9eaec';
    c.fillRect(0, 0, W, H);
    const step = W / 24;
    c.strokeStyle = 'rgba(40,44,52,0.13)';
    c.lineWidth = Math.max(1, W / 960);
    c.beginPath();
    for (let x = step; x < W; x += step) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = step; y < H; y += step) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
  } else if (id === 'blur') {
    // shrinking the picture and growing it back blurs it, in every browser
    c.fillStyle = '#17181c';
    c.fillRect(0, 0, W, H);
    const ready = source && (source.readyState === undefined || source.readyState >= 2) && (source.videoWidth !== 0);
    if (ready) {
      blurCanvas = blurCanvas || Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
      const g = blurCanvas.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.drawImage(source, 0, 0, 32, 18);
      c.save();
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(blurCanvas, 0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(0, 0, W, H);
      c.restore();
    }
  }
  return true;
}

const pad2 = n => String(Math.floor(n)).padStart(2, '0');
const clock = t => `${pad2(t / 3600)}:${pad2((t / 60) % 60)}:${pad2(t % 60)}`;
const mono = (size, weight = 700) => `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
function round(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function label(c, text, x, y, size, color = '#fff', align = 'left') {
  c.font = mono(size);
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.7)';
  c.shadowBlur = size * 0.25;
  c.fillText(text, x, y);
  c.restore();
}
function recDot(c, x, y, u, t) {
  if (Math.floor(t * 2) % 2) return;  // it blinks
  c.fillStyle = '#ef2b2d';
  c.beginPath();
  c.arc(x, y, u * 1.5, 0, Math.PI * 2);
  c.fill();
}
function brackets(c, v, u, inset, len, color = '#fff', width = 0.5) {
  const x0 = v.x + inset, y0 = v.y + inset, x1 = v.x + v.w - inset, y1 = v.y + v.h - inset;
  c.strokeStyle = color;
  c.lineWidth = u * width;
  c.lineCap = 'square';
  c.beginPath();
  c.moveTo(x0, y0 + len); c.lineTo(x0, y0); c.lineTo(x0 + len, y0);
  c.moveTo(x1 - len, y0); c.lineTo(x1, y0); c.lineTo(x1, y0 + len);
  c.moveTo(x1, y1 - len); c.lineTo(x1, y1); c.lineTo(x1 - len, y1);
  c.moveTo(x0 + len, y1); c.lineTo(x0, y1); c.lineTo(x0, y1 - len);
  c.stroke();
}
// fills the ring between the outer edge and the video
function ring(c, o, v, fill, radius = 0) {
  c.beginPath();
  c.roundRect(o.x, o.y, o.w, o.h, radius);
  c.rect(v.x, v.y, v.w, v.h);
  c.fillStyle = fill;
  c.fill('evenodd');
}

export const FRAMES = [
  { id: 'none', name: 'None' },
  {
    id: 'camcorder', name: 'Camcorder',
    draw(c, v, o, t, u) {
      brackets(c, v, u, u * 5, u * 11);
      recDot(c, v.x + u * 11, v.y + u * 12, u, t);
      label(c, 'REC', v.x + u * 14, v.y + u * 12, u * 4.4);
      label(c, clock(t), v.x + v.w - u * 10, v.y + u * 12, u * 4.4, '#fff', 'right');
      // focus cross in the middle
      const mx = v.x + v.w / 2, my = v.y + v.h / 2;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = u * 0.35;
      c.beginPath();
      c.moveTo(mx - u * 4, my); c.lineTo(mx + u * 4, my);
      c.moveTo(mx, my - u * 4); c.lineTo(mx, my + u * 4);
      c.stroke();
      // battery
      const bx = v.x + v.w - u * 19, by = v.y + v.h - u * 14;
      c.strokeStyle = '#fff';
      c.lineWidth = u * 0.5;
      round(c, bx, by, u * 8, u * 4, u * 0.6);
      c.stroke();
      c.fillStyle = '#fff';
      c.fillRect(bx + u * 8.3, by + u * 1.2, u * 0.8, u * 1.6);
      c.fillRect(bx + u * 0.9, by + u * 0.9, u * 4.4, u * 2.2);
      label(c, 'HD', v.x + u * 10, v.y + v.h - u * 12, u * 4.4);
    },
  },
  {
    id: 'phone-cam', name: 'Phone camera',
    draw(c, v, o, t, u) {
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = u * 0.22;
      c.beginPath();
      for (const k of [1 / 3, 2 / 3]) {
        c.moveTo(v.x + v.w * k, v.y); c.lineTo(v.x + v.w * k, v.y + v.h);
        c.moveTo(v.x, v.y + v.h * k); c.lineTo(v.x + v.w, v.y + v.h * k);
      }
      c.stroke();
      const s = u * 17, mx = v.x + v.w / 2, my = v.y + v.h / 2;
      brackets(c, { x: mx - s / 2, y: my - s / 2, w: s, h: s }, u, 0, u * 4, '#ffd60a', 0.4);
      const text = clock(t), w = u * 25, h = u * 7, x = mx - w / 2, y = v.y + u * 4;
      c.fillStyle = '#e5242a';
      round(c, x, y, w, h, u * 1.5);
      c.fill();
      label(c, text, mx, y + h / 2 + u * 0.2, u * 4, '#fff', 'center');
    },
  },
  {
    id: 'security', name: 'Security camera',
    draw(c, v, o, t, u) {
      c.fillStyle = 'rgba(20,70,40,0.16)';
      c.fillRect(v.x, v.y, v.w, v.h);
      c.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = v.y; y < v.y + v.h; y += u * 1.1) c.fillRect(v.x, y, v.w, u * 0.4);
      label(c, 'CAM 01', v.x + u * 5, v.y + u * 7, u * 4.6, '#d7ffe1');
      label(c, clock(t), v.x + v.w - u * 5, v.y + u * 7, u * 4.6, '#d7ffe1', 'right');
      recDot(c, v.x + u * 7, v.y + v.h - u * 7, u, t);
      label(c, 'LIVE', v.x + u * 10, v.y + v.h - u * 7, u * 4.2, '#d7ffe1');
    },
  },
  {
    id: 'vhs', name: 'VHS tape',
    draw(c, v, o, t, u) {
      // a band of static that slowly rolls up the picture
      const span = v.h + u * 20, y = v.y + v.h - ((t * u * 11) % span);
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(v.x, y, v.w, u * 5);
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillRect(v.x, y + u * 1.6, v.w, u * 0.5);
      c.restore();
      const x = v.x + u * 6, my = v.y + u * 8;
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(x, my - u * 2.2); c.lineTo(x + u * 3.4, my); c.lineTo(x, my + u * 2.2);
      c.fill();
      label(c, 'PLAY', x + u * 5, my, u * 5);
      label(c, 'SP', v.x + v.w - u * 6, my, u * 5, '#fff', 'right');
      label(c, clock(t), v.x + u * 6, v.y + v.h - u * 8, u * 5);
    },
  },
  {
    id: 'film', name: 'Film strip', inset: { l: 9, r: 9, t: 0, b: 0 },
    draw(c, v, o, t, u) {
      ring(c, o, v, '#0d0d0f');
      const gap = u * 8, hw = u * 3.6, hh = u * 4.6, shift = (t * u * 26) % gap;
      c.fillStyle = '#e9e6dd';
      c.save();
      c.beginPath();
      c.rect(o.x, o.y, o.w, o.h);
      c.clip();
      for (let y = o.y - gap + shift; y < o.y + o.h; y += gap) {
        for (const x of [o.x + (v.x - o.x - hw) / 2, v.x + v.w + (v.x - o.x - hw) / 2]) {
          round(c, x, y, hw, hh, u * 0.7);
          c.fill();
        }
      }
      c.restore();
    },
  },
  {
    id: 'instant', name: 'Instant photo', inset: { l: 4, r: 4, t: 4, b: 15 },
    draw(c, v, o) { ring(c, o, v, '#fbfaf6'); },
  },
  {
    id: 'wood', name: 'Wood frame', inset: { l: 6, r: 6, t: 6, b: 6 },
    draw(c, v, o, t, u) {
      const g = c.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      g.addColorStop(0, '#9a6432');
      g.addColorStop(0.5, '#6f4220');
      g.addColorStop(1, '#8a5629');
      ring(c, o, v, g);
      c.strokeStyle = 'rgba(40,20,5,0.75)';
      c.lineWidth = u * 0.9;
      c.strokeRect(v.x - u * 0.4, v.y - u * 0.4, v.w + u * 0.8, v.h + u * 0.8);
      c.strokeStyle = 'rgba(255,220,170,0.28)';
      c.lineWidth = u * 0.5;
      c.strokeRect(o.x + u * 0.4, o.y + u * 0.4, o.w - u * 0.8, o.h - u * 0.8);
    },
  },
  {
    id: 'gold', name: 'Gold frame', inset: { l: 6, r: 6, t: 6, b: 6 },
    draw(c, v, o, t, u) {
      const g = c.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      g.addColorStop(0, '#fff0a8');
      g.addColorStop(0.35, '#c99a2e');
      g.addColorStop(0.65, '#f6d976');
      g.addColorStop(1, '#a87a1d');
      ring(c, o, v, g);
      c.strokeStyle = '#6b4c10';
      c.lineWidth = u * 0.7;
      c.strokeRect(v.x - u * 0.35, v.y - u * 0.35, v.w + u * 0.7, v.h + u * 0.7);
      c.strokeStyle = 'rgba(107,76,16,0.55)';
      c.lineWidth = u * 0.3;
      c.strokeRect(o.x + u * 2.6, o.y + u * 2.6, o.w - u * 5.2, o.h - u * 5.2);
    },
  },
  {
    id: 'white', name: 'White border', inset: { l: 3, r: 3, t: 3, b: 3 },
    draw(c, v, o) { ring(c, o, v, '#ffffff'); },
  },
  {
    id: 'comic', name: 'Comic', inset: { l: 3, r: 3, t: 3, b: 3 },
    draw(c, v, o, t, u) {
      ring(c, o, v, '#ffffff');
      c.strokeStyle = '#000';
      c.lineWidth = u * 1.5;
      c.strokeRect(v.x - u * 0.2, v.y - u * 0.2, v.w + u * 0.4, v.h + u * 0.4);
    },
  },
  {
    id: 'neon', name: 'Neon', inset: { l: 2.5, r: 2.5, t: 2.5, b: 2.5 },
    draw(c, v, o, t, u) {
      c.save();
      c.lineWidth = u * 0.9;
      for (const [color, size] of [['#ff2bd6', u * 5], ['#29d9ff', u * 3]]) {
        c.shadowColor = color;
        c.shadowBlur = size;
        c.strokeStyle = color;
        c.strokeRect(v.x - u * 0.5, v.y - u * 0.5, v.w + u, v.h + u);
      }
      c.restore();
    },
  },
  {
    id: 'tv', name: 'Old TV', inset: { l: 5, r: 5, t: 5, b: 13 },
    draw(c, v, o, t, u) {
      ring(c, o, v, '#2b2622', u * 3);
      // rounded screen corners
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.roundRect(v.x, v.y, v.w, v.h, u * 5);
      c.fillStyle = '#2b2622';
      c.fill('evenodd');
      const y = v.y + v.h + (o.y + o.h - v.y - v.h) / 2;
      for (const k of [0.9, 0.82]) {
        c.fillStyle = '#7e7367';
        c.beginPath();
        c.arc(o.x + o.w * k, y, u * 2.6, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#4a433c';
      for (let i = 0; i < 12; i++) c.fillRect(o.x + o.w * 0.07 + i * u * 2.2, y - u * 2.2, u * 1.1, u * 4.4);
    },
  },
  {
    id: 'browser', name: 'Web page', inset: { l: 1, r: 1, t: 8, b: 1 },
    draw(c, v, o, t, u) {
      ring(c, o, v, '#e8e9ec', u * 1.5);
      const y = o.y + (v.y - o.y) / 2;
      ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
        c.fillStyle = color;
        c.beginPath();
        c.arc(o.x + u * (3.5 + i * 3.2), y, u * 1.1, 0, Math.PI * 2);
        c.fill();
      });
      c.fillStyle = '#fff';
      round(c, o.x + o.w * 0.25, y - u * 2.2, o.w * 0.5, u * 4.4, u * 1.2);
      c.fill();
    },
  },
  {
    id: 'vignette', name: 'Dark edges',
    draw(c, v) {
      const r = Math.hypot(v.w, v.h) / 2, mx = v.x + v.w / 2, my = v.y + v.h / 2;
      const g = c.createRadialGradient(mx, my, r * 0.45, mx, my, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.78)');
      c.fillStyle = g;
      c.fillRect(v.x, v.y, v.w, v.h);
    },
  },
  {
    id: 'cinema', name: 'Movie bars',
    draw(c, v) {
      const h = v.h * 0.12;
      c.fillStyle = '#000';
      c.fillRect(v.x, v.y, v.w, h);
      c.fillRect(v.x, v.y + v.h - h, v.w, h);
    },
  },
];

export const frameOf = id => FRAMES.find(f => f.id === id) || FRAMES[0];

// Takes the room a frame needs out of an area. Returns the smaller area and the size unit (u) it used.
export function frameArea(area, id) {
  const ins = frameOf(id).inset, u = Math.min(area.w, area.h) / 100;
  if (!ins) return { ...area, u };
  return { x: area.x + ins.l * u, y: area.y + ins.t * u, w: area.w - (ins.l + ins.r) * u, h: area.h - (ins.t + ins.b) * u, u };
}
// v is where the video ended up, and the border hugs it. Pictures on top follow the video's size.
export function drawFrame(c, id, v, t, unit) {
  const f = frameOf(id);
  if (!f.draw) return;
  const ins = f.inset;
  const u = ins ? unit : Math.min(v.w, v.h) / 100;
  const o = ins ? { x: v.x - ins.l * u, y: v.y - ins.t * u, w: v.w + (ins.l + ins.r) * u, h: v.h + (ins.t + ins.b) * u } : v;
  c.save();
  c.beginPath();
  c.rect(o.x - u * 6, o.y - u * 6, o.w + u * 12, o.h + u * 12);
  c.clip();
  f.draw(c, v, o, t, u);
  c.restore();
}

// A little picture for the buttons in the panel.
export function lookPicture(canvas, { bg = 'gray', frame = 'none' } = {}) {
  const W = canvas.width, H = canvas.height, c = canvas.getContext('2d');
  const mock = document.createElement('canvas');
  mock.width = 320; mock.height = 180;
  const g = mock.getContext('2d'), sky = g.createLinearGradient(0, 0, 0, 180);
  sky.addColorStop(0, '#7dd3fc');
  sky.addColorStop(1, '#3b82a6');
  g.fillStyle = sky;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = '#35624a';
  g.beginPath();
  g.moveTo(0, 150); g.lineTo(90, 95); g.lineTo(170, 140); g.lineTo(250, 80); g.lineTo(320, 130); g.lineTo(320, 180); g.lineTo(0, 180);
  g.fill();
  if (!drawBackground(c, bg, W, H, mock)) { c.fillStyle = '#111317'; c.fillRect(0, 0, W, H); }
  const k = bg === 'none' ? 0.04 : 0.1;
  const fit = frameArea({ x: W * k, y: H * k, w: W * (1 - 2 * k), h: H * (1 - 2 * k) }, frame);
  let w = fit.w, h = w * 9 / 16;
  if (h > fit.h) { h = fit.h; w = h * 16 / 9; }
  const v = { x: fit.x + (fit.w - w) / 2, y: fit.y + (fit.h - h) / 2, w, h };
  c.drawImage(mock, v.x, v.y, v.w, v.h);
  drawFrame(c, frame, v, 42, fit.u);
}
