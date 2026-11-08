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
const tc = t => `${clock(t)}:${pad2((t % 1) * 24)}`;
const rnd = i => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = 'Inter, -apple-system, system-ui, sans-serif';
function round(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function label(c, text, x, y, size, color = '#fff', align = 'left', { font = MONO, weight = 600, shadow = true } = {}) {
  c.save();
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  if (shadow) { c.shadowColor = 'rgba(0,0,0,0.75)'; c.shadowBlur = size * 0.3; }
  c.fillText(text, x, y);
  c.restore();
}
function recDot(c, x, y, u, t, size = 1.3) {
  c.fillStyle = Math.floor(t * 2) % 2 ? 'rgba(239,43,45,0.3)' : '#ff2d2f';
  c.beginPath();
  c.arc(x, y, u * size, 0, Math.PI * 2);
  c.fill();
}
function brackets(c, v, u, inset, len, color = '#fff', width = 0.35) {
  const x0 = v.x + inset, y0 = v.y + inset, x1 = v.x + v.w - inset, y1 = v.y + v.h - inset;
  c.strokeStyle = color;
  c.lineWidth = u * width;
  c.lineCap = 'butt';
  c.beginPath();
  c.moveTo(x0, y0 + len); c.lineTo(x0, y0); c.lineTo(x0 + len, y0);
  c.moveTo(x1 - len, y0); c.lineTo(x1, y0); c.lineTo(x1, y0 + len);
  c.moveTo(x1, y1 - len); c.lineTo(x1, y1); c.lineTo(x1 - len, y1);
  c.moveTo(x0 + len, y1); c.lineTo(x0, y1); c.lineTo(x0, y1 - len);
  c.stroke();
}
function ring(c, o, v, fill, radius = 0, inner = 0) {
  c.beginPath();
  c.roundRect(o.x, o.y, o.w, o.h, radius);
  c.roundRect(v.x, v.y, v.w, v.h, inner);
  c.fillStyle = fill;
  c.fill('evenodd');
}
function lift(c, u, f) {  // a soft shadow under whatever f draws
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowBlur = u * 5;
  c.shadowOffsetY = u * 1.6;
  f();
  c.restore();
}
function grad(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}
function strip(c, x, y, w, h, alpha = 0.55) {
  c.fillStyle = `rgba(0,0,0,${alpha})`;
  c.fillRect(x, y, w, h);
}
function battery(c, x, y, u, level = 0.72, color = '#fff') {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = u * 0.28;
  round(c, x, y, u * 6.4, u * 3, u * 0.6);
  c.stroke();
  c.fillRect(x + u * 6.6, y + u * 0.9, u * 0.5, u * 1.2);
  c.fillRect(x + u * 0.6, y + u * 0.6, u * 5.2 * level, u * 1.8);
}
function levelBars(c, x, y, w, h, value, horizontal = true) {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const on = i / n < value;
    c.fillStyle = !on ? 'rgba(255,255,255,0.16)' : i > n * 0.85 ? '#ff3b30' : i > n * 0.65 ? '#ffd60a' : '#34c759';
    if (horizontal) c.fillRect(x + i * w / n, y, w / n * 0.72, h);
    else c.fillRect(x, y + h - (i + 1) * h / n, w, h / n * 0.72);
  }
}
const meter = (t, k) => Math.min(1, 0.32 + 0.28 * Math.abs(Math.sin(t * (3.1 + k))) + 0.22 * rnd(Math.floor(t * 12) + k * 40));
function safeGuides(c, v, u) {
  c.strokeStyle = 'rgba(255,255,255,0.42)';
  c.lineWidth = u * 0.14;
  c.setLineDash([u * 1.2, u * 0.9]);
  for (const k of [0.05, 0.1]) c.strokeRect(v.x + v.w * k, v.y + v.h * k, v.w * (1 - 2 * k), v.h * (1 - 2 * k));
  c.setLineDash([]);
}
function crossMark(c, x, y, s, u, color = 'rgba(255,255,255,0.9)') {
  c.strokeStyle = color;
  c.lineWidth = u * 0.2;
  c.beginPath();
  c.moveTo(x - s, y); c.lineTo(x - s * 0.3, y);
  c.moveTo(x + s * 0.3, y); c.lineTo(x + s, y);
  c.moveTo(x, y - s); c.lineTo(x, y - s * 0.3);
  c.moveTo(x, y + s * 0.3); c.lineTo(x, y + s);
  c.stroke();
}
function scanlines(c, v, u, alpha = 0.12) {
  c.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = v.y; y < v.y + v.h; y += u * 0.8) c.fillRect(v.x, y, v.w, u * 0.3);
}
function grainDots(c, v, u, seed, n, alpha) {
  c.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < n; i++) {
    c.fillRect(v.x + rnd(seed + i) * v.w, v.y + rnd(seed + i + 500) * v.h, u * (0.1 + rnd(i) * 0.25), u * (0.1 + rnd(i + 9) * 0.25));
  }
}
function heart(c, x, y, s, fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x, y + s * 0.3);
  c.bezierCurveTo(x - s, y - s * 0.5, x - s * 0.5, y - s, x, y - s * 0.35);
  c.bezierCurveTo(x + s * 0.5, y - s, x + s, y - s * 0.5, x, y + s * 0.3);
  c.fill();
}

export const FRAME_GROUPS = ['Cameras', 'Modern', 'Picture frames', 'Devices', 'Film and retro', 'Movie looks'];

export const FRAMES = [
  { id: 'none', name: 'None' },

  // ---------- cameras: looks like you are filming
  {
    id: 'cinema-cam', name: 'Cinema camera', group: 'Cameras',
    draw(c, v, o, t, u) {
      safeGuides(c, v, u);
      crossMark(c, v.x + v.w / 2, v.y + v.h / 2, u * 3.4, u);
      const bar = u * 6.4;
      strip(c, v.x, v.y, v.w, bar);
      strip(c, v.x, v.y + v.h - bar, v.w, bar);
      const ty = v.y + bar / 2, by = v.y + v.h - bar / 2, size = u * 2.7;
      recDot(c, v.x + u * 3, ty, u, t, 1.1);
      label(c, 'REC', v.x + u * 5.2, ty, size, '#ff4b4d');
      label(c, tc(t), v.x + v.w / 2, ty, u * 3.3, '#fff', 'center');
      label(c, '4K  24P  10-BIT', v.x + v.w - u * 3, ty, size, '#fff', 'right');
      const parts = ['ISO 800', '180.0°', 'F2.8', '5600K', 'ND 0.6'];
      parts.forEach((p, i) => label(c, p, v.x + u * 3 + i * u * 15, by, size));
      battery(c, v.x + v.w - u * 10, by - u * 1.5, u);
      label(c, '72%', v.x + v.w - u * 11, by, size, '#fff', 'right');
      // sound levels
      const mx = v.x + u * 3, my = v.y + v.h * 0.32, mh = v.h * 0.36;
      strip(c, mx - u, my - u * 3.4, u * 7, mh + u * 4.8, 0.42);
      label(c, 'L', mx + u * 0.8, my - u * 1.8, u * 1.9, '#fff', 'center');
      label(c, 'R', mx + u * 4.2, my - u * 1.8, u * 1.9, '#fff', 'center');
      levelBars(c, mx, my, u * 1.6, mh, meter(t, 1), false);
      levelBars(c, mx + u * 3.4, my, u * 1.6, mh, meter(t, 2), false);
      // exposure graph
      const gw = u * 26, gh = u * 11, gx = v.x + v.w - gw - u * 3, gy = v.y + v.h - bar - gh - u * 2;
      strip(c, gx, gy, gw, gh, 0.42);
      c.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 52; i++) {
        const k = i / 52, a = Math.exp(-((k - 0.42) ** 2) / 0.05) * 0.8 + rnd(i + Math.floor(t * 3)) * 0.2;
        c.fillRect(gx + i * gw / 52, gy + gh - a * gh * 0.92, gw / 52 * 0.8, a * gh * 0.92);
      }
    },
  },
  {
    id: 'camcorder', name: 'Camcorder', group: 'Cameras',
    draw(c, v, o, t, u) {
      brackets(c, v, u, u * 4, u * 9, '#fff', 0.45);
      const size = u * 3.3, top = v.y + u * 9, low = v.y + v.h - u * 9;
      recDot(c, v.x + u * 9, top, u, t);
      label(c, 'REC', v.x + u * 11.5, top, size);
      label(c, clock(t), v.x + v.w - u * 9, top, size, '#fff', 'right');
      const mx = v.x + v.w / 2, my = v.y + v.h / 2;
      brackets(c, { x: mx - u * 11, y: my - u * 8, w: u * 22, h: u * 16 }, u, 0, u * 3, '#fff', 0.3);
      crossMark(c, mx, my, u * 2.4, u);
      // zoom scale
      const zx = mx - u * 16, zy = low;
      label(c, 'W', zx - u * 1.8, zy, size * 0.8, '#fff', 'right');
      label(c, 'T', zx + u * 33.8, zy, size * 0.8);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i <= 16; i++) c.fillRect(zx + i * u * 2, zy - u * (i % 4 ? 0.5 : 1), u * 0.22, u * (i % 4 ? 1 : 2));
      c.fillStyle = '#fff';
      const zoom = zx + (0.3 + 0.1 * Math.sin(t * 0.3)) * u * 32;
      c.fillRect(zoom - u * 0.3, zy - u * 1.6, u * 0.6, u * 3.2);
      battery(c, v.x + v.w - u * 16, low - u * 1.5, u);
      label(c, 'AF', v.x + u * 9, low, size);
      label(c, 'HD', v.x + u * 15, low, size);
      label(c, 'MIC', v.x + u * 9, low - u * 5, size * 0.72);
      levelBars(c, v.x + u * 15, low - u * 5.7, u * 16, u * 1.3, meter(t, 3));
    },
  },
  {
    id: 'phone-cam', name: 'Phone camera', group: 'Cameras',
    draw(c, v, o, t, u) {
      c.strokeStyle = 'rgba(255,255,255,0.38)';
      c.lineWidth = u * 0.14;
      c.beginPath();
      for (const k of [1 / 3, 2 / 3]) {
        c.moveTo(v.x + v.w * k, v.y); c.lineTo(v.x + v.w * k, v.y + v.h);
        c.moveTo(v.x, v.y + v.h * k); c.lineTo(v.x + v.w, v.y + v.h * k);
      }
      c.stroke();
      const mx = v.x + v.w / 2, my = v.y + v.h / 2, s = u * 15;
      brackets(c, { x: mx - s / 2, y: my - s / 2, w: s, h: s }, u, 0, u * 2.6, '#ffd60a', 0.28);
      c.fillStyle = '#ffd60a';
      c.fillRect(mx + s / 2 + u * 1.6, my - u * 4, u * 0.22, u * 8);
      c.beginPath();
      c.arc(mx + s / 2 + u * 1.7, my - u * 0.6, u * 1, 0, Math.PI * 2);
      c.fill();
      const w = u * 19, h = u * 5.6, x = mx - w / 2, y = v.y + u * 3;
      c.fillStyle = '#e8262c';
      round(c, x, y, w, h, u * 1.3);
      c.fill();
      label(c, clock(t), mx, y + h / 2 + u * 0.1, u * 2.9, '#fff', 'center', { shadow: false });
      label(c, '4K · 30', v.x + u * 4, v.y + u * 5.8, u * 2.5, '#fff', 'left', { font: SANS });
      // zoom buttons
      const zy = v.y + v.h - u * 7;
      [['.5', 0], ['1x', 1], ['2', 2], ['5', 3]].forEach(([text, i]) => {
        const zx = mx - u * 9 + i * u * 6, big = i === 1;
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.beginPath();
        c.arc(zx, zy, u * (big ? 2.6 : 2), 0, Math.PI * 2);
        c.fill();
        label(c, text, zx, zy + u * 0.1, u * (big ? 2.3 : 1.9), big ? '#ffd60a' : '#fff', 'center', { font: SANS, shadow: false });
      });
      // record button
      const rx = v.x + v.w - u * 9, ry = my;
      c.strokeStyle = '#fff';
      c.lineWidth = u * 0.6;
      c.beginPath();
      c.arc(rx, ry, u * 5, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#ff3b30';
      round(c, rx - u * 2, ry - u * 2, u * 4, u * 4, u * 0.8);
      c.fill();
    },
  },
  {
    id: 'photo-cam', name: 'Pro photo camera', group: 'Cameras',
    draw(c, v, o, t, u) {
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = u * 0.16;
      const mx = v.x + v.w / 2, my = v.y + v.h / 2 - u * 3;
      for (let a = -4; a <= 4; a++) for (let b = -2; b <= 2; b++) {
        const on = a === 1 && b === 0, s = u * 1.5, x = mx + a * u * 8, y = my + b * u * 8;
        c.strokeStyle = on ? '#3bff6a' : 'rgba(255,255,255,0.4)';
        c.lineWidth = u * (on ? 0.35 : 0.14);
        c.strokeRect(x - s, y - s, s * 2, s * 2);
      }
      const bar = u * 9, y = v.y + v.h - bar;
      strip(c, v.x, y, v.w, bar, 0.82);
      const m = y + bar / 2, size = u * 3;
      ['1/250', 'F4.0', 'ISO 400'].forEach((text, i) => label(c, text, v.x + u * 4 + i * u * 16, m, size, i === 1 ? '#3bff6a' : '#fff'));
      const sx = v.x + v.w / 2 - u * 2;
      for (let i = -6; i <= 6; i++) {
        c.fillStyle = '#fff';
        c.fillRect(sx + i * u * 1.8, m - u * (i % 3 ? 0.5 : 1.1), u * 0.22, u * (i % 3 ? 1 : 2.2));
      }
      c.fillStyle = '#3bff6a';
      c.fillRect(sx + Math.sin(t * 0.7) * u * 3 - u * 0.3, m + u * 1.4, u * 0.7, u * 1.2);
      battery(c, v.x + v.w - u * 11, m - u * 1.5, u, 0.9);
      label(c, '[ 248 ]', v.x + v.w - u * 13, m, size, '#fff', 'right');
    },
  },
  {
    id: 'action', name: 'Action camera', group: 'Cameras',
    draw(c, v, o, t, u) {
      const r = Math.hypot(v.w, v.h) / 2, g = c.createRadialGradient(v.x + v.w / 2, v.y + v.h / 2, r * 0.68, v.x + v.w / 2, v.y + v.h / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.72)');
      c.fillStyle = g;
      c.fillRect(v.x, v.y, v.w, v.h);
      const y = v.y + u * 6, w = u * 40, x = v.x + v.w / 2 - w / 2;
      c.fillStyle = 'rgba(0,0,0,0.5)';
      round(c, x, y - u * 3, w, u * 6, u * 3);
      c.fill();
      recDot(c, x + u * 3.4, y, u, t, 1);
      label(c, clock(t), x + u * 6, y, u * 3, '#fff');
      label(c, '4K60', x + u * 24, y, u * 2.6, '#7cf7ff');
      battery(c, x + w - u * 9.5, y - u * 1.5, u, 0.62);
      const sx = v.x + u * 5, sy = v.y + v.h - u * 7;
      label(c, `${pad2(18 + 8 * Math.sin(t * 0.8))}`, sx, sy, u * 8, '#fff', 'left', { font: SANS, weight: 800 });
      label(c, 'MPH', sx + u * 12, sy + u * 1.4, u * 2.4, '#fff', 'left', { font: SANS });
      label(c, 'WIDE', v.x + v.w - u * 5, sy, u * 2.6, '#fff', 'right', { font: SANS, weight: 700 });
    },
  },
  {
    id: 'drone', name: 'Drone', group: 'Cameras',
    draw(c, v, o, t, u) {
      const mx = v.x + v.w / 2, my = v.y + v.h / 2, green = '#62ff9a';
      c.strokeStyle = green;
      c.lineWidth = u * 0.28;
      c.beginPath();
      c.arc(mx, my, u * 12, Math.PI * 1.1, Math.PI * 1.9);
      c.moveTo(mx + u * 12, my); c.arc(mx, my, u * 12, 0, Math.PI);
      c.stroke();
      crossMark(c, mx, my, u * 3, u, green);
      // tilt lines
      for (const k of [-2, -1, 1, 2]) {
        const y = my + k * u * 7 + Math.sin(t * 0.5) * u;
        c.fillStyle = 'rgba(98,255,154,0.75)';
        c.fillRect(mx - u * 20, y, u * 7, u * 0.2);
        c.fillRect(mx + u * 13, y, u * 7, u * 0.2);
      }
      const alt = 120 + 8 * Math.sin(t * 0.4), speed = 12 + 3 * Math.sin(t * 0.7);
      [[`ALT ${alt.toFixed(1)} M`, 0], [`SPD ${speed.toFixed(1)} M/S`, 1], [`DST ${(240 + t * 3).toFixed(0)} M`, 2]].forEach(([text, i]) => label(c, text, v.x + u * 4, v.y + v.h - u * (12 - i * 3.6), u * 2.5, green));
      // compass
      c.fillStyle = 'rgba(0,0,0,0.42)';
      c.fillRect(mx - u * 26, v.y + u * 3, u * 52, u * 7);
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], head = (t * 2) % 40;
      c.save();
      c.beginPath();
      c.rect(mx - u * 26, v.y + u * 3, u * 52, u * 7);
      c.clip();
      for (let i = -9; i <= 9; i++) {
        const x = mx + i * u * 5 - (head % 5) * u;
        c.fillStyle = green;
        c.fillRect(x, v.y + u * 3, u * 0.2, u * (i % 2 ? 1 : 1.8));
        if (!(i % 2)) label(c, dirs[((i / 2 + Math.floor(head / 10)) % 8 + 8) % 8], x, v.y + u * 7, u * 2.2, green, 'center');
      }
      c.restore();
      battery(c, v.x + v.w - u * 13, v.y + u * 5, u, 0.66, green);
      recDot(c, v.x + v.w - u * 16, v.y + v.h - u * 7, u, t);
      label(c, tc(t), v.x + v.w - u * 4, v.y + v.h - u * 7, u * 2.6, green, 'right');
    },
  },
  {
    id: 'security', name: 'Security camera', group: 'Cameras',
    draw(c, v, o, t, u) {
      c.fillStyle = 'rgba(20,70,40,0.2)';
      c.fillRect(v.x, v.y, v.w, v.h);
      scanlines(c, v, u, 0.14);
      const ink = '#d7ffe1', size = u * 3.1;
      strip(c, v.x + u * 3, v.y + u * 3, u * 44, u * 11, 0.4);
      label(c, 'CAM 04  LOBBY', v.x + u * 4.5, v.y + u * 6, size, ink);
      label(c, `2026-11-08  ${clock(t + 49320)}`, v.x + u * 4.5, v.y + u * 11, size * 0.82, ink);
      recDot(c, v.x + v.w - u * 13, v.y + u * 6.5, u, t);
      label(c, 'REC', v.x + v.w - u * 4, v.y + u * 6.5, size, ink, 'right');
      // moving motion box
      const bx = v.x + v.w * 0.55 + Math.sin(t * 0.4) * u * 12, by = v.y + v.h * 0.4 + Math.cos(t * 0.3) * u * 5;
      brackets(c, { x: bx, y: by, w: u * 22, h: u * 28 }, u, 0, u * 3, '#ffe14a', 0.3);
      label(c, 'MOTION', bx, by - u * 2, u * 2.1, '#ffe14a');
      label(c, 'NIGHT VISION  IR ON', v.x + u * 4.5, v.y + v.h - u * 6, size * 0.75, ink);
    },
  },
  {
    id: 'live', name: 'Live stream', group: 'Cameras',
    draw(c, v, o, t, u) {
      const y = v.y + u * 4, h = u * 5.4;
      c.fillStyle = '#e8263a';
      round(c, v.x + u * 4, y, u * 11, h, u * 1.1);
      c.fill();
      label(c, 'LIVE', v.x + u * 9.5, y + h / 2 + u * 0.1, u * 2.9, '#fff', 'center', { font: SANS, weight: 800, shadow: false });
      c.fillStyle = 'rgba(0,0,0,0.55)';
      round(c, v.x + u * 16, y, u * 15, h, u * 1.1);
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = u * 0.28;
      c.beginPath();
      c.ellipse(v.x + u * 19, y + h / 2, u * 1.5, u * 0.95, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(v.x + u * 19, y + h / 2, u * 0.45, 0, Math.PI * 2);
      c.fill();
      label(c, `${(1200 + Math.floor(t * 2)).toLocaleString('en-US')}`, v.x + u * 21.5, y + h / 2 + u * 0.1, u * 2.6, '#fff', 'left', { font: SANS, shadow: false });
      label(c, clock(t), v.x + v.w - u * 4, y + h / 2, u * 2.8, '#fff', 'right');
      // little comments
      const names = ['Sam', 'Riley', 'Max', 'Jo'], words = ['this is so cool', 'first!', 'wow', 'keep going'];
      const start = Math.floor(t / 3);
      for (let i = 0; i < 3; i++) {
        const y2 = v.y + v.h - u * (6 + i * 6), n = (start + i) % 4;
        c.fillStyle = 'rgba(0,0,0,0.42)';
        round(c, v.x + u * 4, y2 - u * 2.4, u * 30, u * 4.8, u * 2.4);
        c.fill();
        c.fillStyle = `hsl(${n * 80 + 20} 80% 60%)`;
        c.beginPath();
        c.arc(v.x + u * 6.6, y2, u * 1.4, 0, Math.PI * 2);
        c.fill();
        label(c, `${names[n]}  ${words[n]}`, v.x + u * 9, y2 + u * 0.1, u * 2.1, '#fff', 'left', { font: SANS, shadow: false });
      }
    },
  },
  {
    id: 'call', name: 'Video call', group: 'Cameras',
    draw(c, v, o, t, u) {
      const mx = v.x + v.w / 2, y = v.y + v.h - u * 8;
      c.fillStyle = 'rgba(25,27,32,0.78)';
      round(c, mx - u * 19, y - u * 4.6, u * 38, u * 9.2, u * 4.6);
      c.fill();
      [[-13, '#3c3f47'], [-4.4, '#3c3f47'], [4.4, '#3c3f47'], [13, '#e5383b']].forEach(([k, color], i) => {
        const x = mx + k * u;
        c.fillStyle = color;
        c.beginPath();
        c.arc(x, y, u * 3.2, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#fff';
        c.strokeStyle = '#fff';
        c.lineWidth = u * 0.32;
        if (i === 0) {  // microphone
          round(c, x - u * 0.7, y - u * 1.8, u * 1.4, u * 2.4, u * 0.7);
          c.fill();
          c.beginPath();
          c.arc(x, y - u * 0.3, u * 1.3, 0, Math.PI);
          c.moveTo(x, y + u); c.lineTo(x, y + u * 1.7);
          c.stroke();
        } else if (i === 1) {  // camera
          round(c, x - u * 1.7, y - u * 1, u * 2.4, u * 2, u * 0.4);
          c.fill();
          c.beginPath();
          c.moveTo(x + u * 0.9, y); c.lineTo(x + u * 1.8, y - u * 0.8); c.lineTo(x + u * 1.8, y + u * 0.8);
          c.fill();
        } else if (i === 2) {  // share
          c.strokeRect(x - u * 1.6, y - u * 1.1, u * 3.2, u * 2.2);
        } else {  // end
          c.lineWidth = u * 0.7;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(x - u * 1.5, y); c.lineTo(x + u * 1.5, y);
          c.stroke();
          c.lineCap = 'butt';
        }
      });
      c.fillStyle = 'rgba(0,0,0,0.55)';
      round(c, v.x + u * 3, v.y + v.h - u * 8.5, u * 14, u * 5, u * 1.2);
      c.fill();
      label(c, 'You', v.x + u * 5, v.y + v.h - u * 5.9, u * 2.4, '#fff', 'left', { font: SANS, shadow: false });
      levelBars(c, v.x + u * 10, v.y + v.h - u * 6.5, u * 5.5, u * 1.1, meter(t, 4));
      c.fillStyle = 'rgba(0,0,0,0.55)';
      round(c, v.x + u * 3, v.y + u * 3, u * 15, u * 5, u * 1.2);
      c.fill();
      recDot(c, v.x + u * 5.2, v.y + u * 5.5, u, t, 0.9);
      label(c, clock(t), v.x + u * 7, v.y + u * 5.6, u * 2.1, '#fff', 'left', { shadow: false });
    },
  },

  // ---------- modern
  {
    id: 'glass', name: 'Glass', group: 'Modern', inset: { l: 3.5, r: 3.5, t: 3.5, b: 3.5 }, radius: 3, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, 'rgba(255,255,255,0.28)', u * 6, u * 3));
      ring(c, o, v, grad(c, o.x, o.y, o.x, o.y + o.h, ['rgba(255,255,255,0.32)', 'rgba(255,255,255,0.05)']), u * 6, u * 3);
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = u * 0.16;
      round(c, o.x + u * 0.1, o.y + u * 0.1, o.w - u * 0.2, o.h - u * 0.2, u * 6);
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.22)';
      round(c, v.x - u * 0.1, v.y - u * 0.1, v.w + u * 0.2, v.h + u * 0.2, u * 3);
      c.stroke();
    },
  },
  {
    id: 'gradient', name: 'Color edge', group: 'Modern', inset: { l: 1.4, r: 1.4, t: 1.4, b: 1.4 }, radius: 3.2,
    draw(c, v, o, t, u) {
      const mx = v.x + v.w / 2, my = v.y + v.h / 2;
      const g = c.createConicGradient(t * 0.5, mx, my);
      ['#ff4d6d', '#ff9f1c', '#ffe14a', '#2ee6a6', '#3a86ff', '#b14dff', '#ff4d6d'].forEach((s, i) => g.addColorStop(i / 6, s));
      ring(c, o, v, g, u * 4.6, u * 3.2);
    },
  },
  {
    id: 'neon', name: 'Neon', group: 'Modern', inset: { l: 3, r: 3, t: 3, b: 3 }, radius: 2, still: true,
    draw(c, v, o, t, u) {
      c.save();
      const tube = (color, grow, blur, width) => {
        c.shadowColor = color;
        c.shadowBlur = u * blur;
        c.strokeStyle = color;
        c.lineWidth = u * width;
        round(c, v.x - grow, v.y - grow, v.w + grow * 2, v.h + grow * 2, u * 2 + grow);
        c.stroke();
      };
      for (let i = 0; i < 2; i++) tube('#ff2bd6', u * 0.9, 5, 0.55);
      c.shadowBlur = 0;
      tube('#ffd0f5', u * 0.9, 1, 0.16);
      for (let i = 0; i < 2; i++) tube('#29d9ff', u * 2.2, 4, 0.4);
      tube('#d3f7ff', u * 2.2, 1, 0.12);
      c.restore();
    },
  },
  {
    id: 'float', name: 'Floating card', group: 'Modern', radius: 3.4, inset: { l: 3, r: 3, t: 3, b: 3 }, still: true,
    draw(c, v, o, t, u) {
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.55)';
      c.shadowBlur = u * 7;
      c.shadowOffsetY = u * 2.6;
      ring(c, v, { x: v.x + 1, y: v.y + 1, w: v.w - 2, h: v.h - 2 }, 'rgba(255,255,255,0.9)', u * 3.4, u * 3.4);
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = u * 0.16;
      round(c, v.x, v.y, v.w, v.h, u * 3.4);
      c.stroke();
    },
  },
  {
    id: 'thin', name: 'Thin corners', group: 'Modern', still: true,
    draw(c, v, o, t, u) {
      brackets(c, v, u, u * 3.5, u * 7, 'rgba(255,255,255,0.95)', 0.22);
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = u * 0.1;
      c.strokeRect(v.x + u * 2.2, v.y + u * 2.2, v.w - u * 4.4, v.h - u * 4.4);
      c.fillStyle = 'rgba(255,255,255,0.9)';
      const mx = v.x + v.w / 2, my = v.y + v.h / 2;
      for (const [x, y] of [[mx, v.y + u * 2.2], [mx, v.y + v.h - u * 2.2], [v.x + u * 2.2, my], [v.x + v.w - u * 2.2, my]]) c.fillRect(x - u * 0.3, y - u * 0.3, u * 0.6, u * 0.6);
    },
  },
  {
    id: 'double', name: 'Double line', group: 'Modern', inset: { l: 3, r: 3, t: 3, b: 3 }, still: true,
    draw(c, v, o, t, u) {
      c.strokeStyle = '#fff';
      c.lineWidth = u * 0.42;
      c.strokeRect(v.x - u * 0.8, v.y - u * 0.8, v.w + u * 1.6, v.h + u * 1.6);
      c.lineWidth = u * 0.14;
      c.strokeRect(v.x - u * 2.3, v.y - u * 2.3, v.w + u * 4.6, v.h + u * 4.6);
    },
  },
  {
    id: 'hud', name: 'Tech screen', group: 'Modern',
    draw(c, v, o, t, u) {
      const ink = '#54e6ff', mx = v.x + v.w / 2, my = v.y + v.h / 2;
      c.strokeStyle = ink;
      c.fillStyle = ink;
      // cut corner outline
      const k = u * 5, m = u * 2.4, x0 = v.x + m, y0 = v.y + m, x1 = v.x + v.w - m, y1 = v.y + v.h - m;
      c.lineWidth = u * 0.2;
      c.beginPath();
      c.moveTo(x0 + k, y0); c.lineTo(mx - u * 16, y0); c.lineTo(mx - u * 14, y0 + u * 1.6); c.lineTo(mx + u * 14, y0 + u * 1.6); c.lineTo(mx + u * 16, y0);
      c.lineTo(x1 - k, y0); c.lineTo(x1, y0 + k); c.lineTo(x1, y1 - k); c.lineTo(x1 - k, y1); c.lineTo(x0 + k, y1); c.lineTo(x0, y1 - k); c.lineTo(x0, y0 + k);
      c.closePath();
      c.stroke();
      // spinning rings
      for (const [r, s, a] of [[13, 0.5, 1.1], [16, -0.3, 0.7]]) {
        c.lineWidth = u * 0.24;
        c.beginPath();
        c.arc(mx, my, u * r, t * s, t * s + a * Math.PI);
        c.stroke();
        c.beginPath();
        c.arc(mx, my, u * r, t * s + Math.PI, t * s + Math.PI + a * 0.6);
        c.stroke();
      }
      crossMark(c, mx, my, u * 3, u, ink);
      label(c, tc(t), mx, y0 + u * 4.2, u * 2.7, ink, 'center');
      label(c, 'SYSTEM ONLINE', x0 + u * 3, y0 + u * 3.6, u * 2, ink);
      label(c, `SIGNAL ${(90 + 8 * Math.sin(t)).toFixed(0)}%`, x1 - u * 3, y0 + u * 3.6, u * 2, ink, 'right');
      for (let i = 0; i < 10; i++) {
        const h = u * (1 + 5 * Math.abs(Math.sin(t * 2 + i * 0.7)));
        c.fillRect(x0 + u * 3 + i * u * 1.5, y1 - u * 2.6 - h, u * 0.9, h);
      }
      label(c, `X ${(240 + Math.sin(t) * 40).toFixed(0)}  Y ${(160 + Math.cos(t) * 30).toFixed(0)}`, x1 - u * 3, y1 - u * 3.4, u * 2, ink, 'right');
    },
  },

  // ---------- picture frames
  {
    id: 'gallery', name: 'Gallery mat', group: 'Picture frames', inset: { l: 9, r: 9, t: 9, b: 9 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, '#f5f3ee'));
      // the outer black frame
      const edge = u * 1.3;
      c.fillStyle = '#17171a';
      c.beginPath();
      c.rect(o.x, o.y, o.w, o.h);
      c.rect(o.x + edge, o.y + edge, o.w - edge * 2, o.h - edge * 2);
      c.fill('evenodd');
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.lineWidth = u * 0.12;
      c.strokeRect(o.x + edge * 0.45, o.y + edge * 0.45, o.w - edge * 0.9, o.h - edge * 0.9);
      // cut edge of the mat
      const b = u * 0.45;
      for (const [points, fill] of [
        [[v.x - b, v.y - b, v.x + v.w + b, v.y - b, v.x + v.w, v.y, v.x, v.y], '#c9c5bb'],
        [[v.x - b, v.y - b, v.x, v.y, v.x, v.y + v.h, v.x - b, v.y + v.h + b], '#dcd8ce'],
        [[v.x + v.w + b, v.y - b, v.x + v.w + b, v.y + v.h + b, v.x + v.w, v.y + v.h, v.x + v.w, v.y], '#ffffff'],
        [[v.x - b, v.y + v.h + b, v.x, v.y + v.h, v.x + v.w, v.y + v.h, v.x + v.w + b, v.y + v.h + b], '#ffffff'],
      ]) {
        c.fillStyle = fill;
        c.beginPath();
        for (let i = 0; i < points.length; i += 2) c[i ? 'lineTo' : 'moveTo'](points[i], points[i + 1]);
        c.fill();
      }
    },
  },
  {
    id: 'wood', name: 'Wood frame', group: 'Picture frames', inset: { l: 6, r: 6, t: 6, b: 6 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, '#6f4220'));
      const sides = [
        [[o.x, o.y, o.x + o.w, o.y, v.x + v.w, v.y, v.x, v.y], true],
        [[o.x, o.y + o.h, o.x + o.w, o.y + o.h, v.x + v.w, v.y + v.h, v.x, v.y + v.h], true],
        [[o.x, o.y, v.x, v.y, v.x, v.y + v.h, o.x, o.y + o.h], false],
        [[o.x + o.w, o.y, v.x + v.w, v.y, v.x + v.w, v.y + v.h, o.x + o.w, o.y + o.h], false],
      ];
      sides.forEach(([p, flat], s) => {
        c.save();
        c.beginPath();
        for (let i = 0; i < 8; i += 2) c[i ? 'lineTo' : 'moveTo'](p[i], p[i + 1]);
        c.closePath();
        c.clip();
        c.fillStyle = grad(c, p[0], p[1], flat ? p[0] : p[0] + (s === 2 ? 1 : -1) * u * 6, flat ? p[1] + (s === 0 ? 1 : -1) * u * 6 : p[1], ['#a06a38', '#7c4a24', '#5a3417']);
        c.fillRect(o.x, o.y, o.w, o.h);
        // wood grain runs along each side
        for (let i = 0; i < 46; i++) {
          c.strokeStyle = `rgba(${rnd(i + s) > 0.5 ? '40,20,5' : '255,210,150'},${0.06 + rnd(i * 3 + s) * 0.16})`;
          c.lineWidth = u * (0.05 + rnd(i + 7) * 0.14);
          c.beginPath();
          if (flat) {
            const y = (s === 0 ? o.y : v.y + v.h) + rnd(i * 5 + s) * u * 6;
            c.moveTo(o.x, y);
            c.bezierCurveTo(o.x + o.w * 0.3, y + u * (rnd(i) - 0.5), o.x + o.w * 0.7, y + u * (rnd(i + 2) - 0.5), o.x + o.w, y);
          } else {
            const x = (s === 2 ? o.x : v.x + v.w) + rnd(i * 5 + s) * u * 6;
            c.moveTo(x, o.y);
            c.bezierCurveTo(x + u * (rnd(i) - 0.5), o.y + o.h * 0.3, x + u * (rnd(i + 2) - 0.5), o.y + o.h * 0.7, x, o.y + o.h);
          }
          c.stroke();
        }
        c.restore();
      });
      // joins at the corners
      c.strokeStyle = 'rgba(25,12,3,0.65)';
      c.lineWidth = u * 0.14;
      c.beginPath();
      for (const [a, b, d, e] of [[o.x, o.y, v.x, v.y], [o.x + o.w, o.y, v.x + v.w, v.y], [o.x, o.y + o.h, v.x, v.y + v.h], [o.x + o.w, o.y + o.h, v.x + v.w, v.y + v.h]]) { c.moveTo(a, b); c.lineTo(d, e); }
      c.stroke();
      c.strokeStyle = 'rgba(25,12,3,0.8)';
      c.lineWidth = u * 0.5;
      c.strokeRect(v.x - u * 0.2, v.y - u * 0.2, v.w + u * 0.4, v.h + u * 0.4);
      c.strokeStyle = 'rgba(255,225,180,0.3)';
      c.lineWidth = u * 0.22;
      c.strokeRect(o.x + u * 0.2, o.y + u * 0.2, o.w - u * 0.4, o.h - u * 0.4);
    },
  },
  {
    id: 'gold', name: 'Gold frame', group: 'Picture frames', inset: { l: 7.5, r: 7.5, t: 7.5, b: 7.5 }, still: true,
    draw(c, v, o, t, u) {
      const gold = ['#fff3b0', '#b98a24', '#f8df86', '#8e6716', '#f3d470'];
      lift(c, u, () => ring(c, o, v, grad(c, o.x, o.y, o.x + o.w, o.y + o.h, gold)));
      const step = (grow, width, color) => {
        c.strokeStyle = color;
        c.lineWidth = u * width;
        c.strokeRect(v.x - grow, v.y - grow, v.w + grow * 2, v.h + grow * 2);
      };
      step(u * 0.35, 0.7, '#5f430c');
      step(u * 1.3, 0.6, grad(c, o.x, o.y, o.x + o.w, o.y + o.h, ['#8e6716', '#fff3b0', '#8e6716']));
      step(u * 6.6, 0.26, 'rgba(95,67,12,0.75)');
      step(u * 7.3, 0.2, 'rgba(255,245,200,0.8)');
      // beads around the frame
      const bead = (x, y) => {
        c.fillStyle = '#6d4e10';
        c.beginPath();
        c.arc(x + u * 0.08, y + u * 0.1, u * 0.48, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffeeaa';
        c.beginPath();
        c.arc(x, y, u * 0.38, 0, Math.PI * 2);
        c.fill();
      };
      const b = u * 3.9, gap = u * 1.9;
      for (let x = v.x - b; x <= v.x + v.w + b; x += gap) { bead(x, v.y - b); bead(x, v.y + v.h + b); }
      for (let y = v.y - b; y <= v.y + v.h + b; y += gap) { bead(v.x - b, y); bead(v.x + v.w + b, y); }
      // a flower in each corner
      for (const [x, y] of [[o.x + u * 3.9, o.y + u * 3.9], [o.x + o.w - u * 3.9, o.y + u * 3.9], [o.x + u * 3.9, o.y + o.h - u * 3.9], [o.x + o.w - u * 3.9, o.y + o.h - u * 3.9]]) {
        c.fillStyle = '#7b5a14';
        c.beginPath();
        c.arc(x, y, u * 3.4, 0, Math.PI * 2);
        c.fill();
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          c.fillStyle = i % 2 ? '#ffe9a0' : '#d9ac44';
          c.beginPath();
          c.ellipse(x + Math.cos(a) * u * 1.8, y + Math.sin(a) * u * 1.8, u * 1.3, u * 0.7, a, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#fff6c9';
        c.beginPath();
        c.arc(x, y, u * 0.9, 0, Math.PI * 2);
        c.fill();
      }
    },
  },
  {
    id: 'metal', name: 'Brushed metal', group: 'Picture frames', inset: { l: 4.5, r: 4.5, t: 4.5, b: 4.5 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, grad(c, o.x, o.y, o.x + o.w, o.y + o.h, ['#f1f3f5', '#9aa0a8', '#dfe2e6', '#7e848c', '#c9cdd2']), u * 1.2));
      c.save();
      c.beginPath();
      c.roundRect(o.x, o.y, o.w, o.h, u * 1.2);
      c.rect(v.x, v.y, v.w, v.h);
      c.clip('evenodd');
      for (let i = 0; i < 240; i++) {
        c.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '40,44,50'},${rnd(i + 3) * 0.1})`;
        c.fillRect(o.x, o.y + rnd(i * 2) * o.h, o.w, u * 0.1);
      }
      c.restore();
      c.strokeStyle = '#3f4349';
      c.lineWidth = u * 0.34;
      c.strokeRect(v.x - u * 0.15, v.y - u * 0.15, v.w + u * 0.3, v.h + u * 0.3);
      for (const [x, y] of [[o.x + u * 2.25, o.y + u * 2.25], [o.x + o.w - u * 2.25, o.y + u * 2.25], [o.x + u * 2.25, o.y + o.h - u * 2.25], [o.x + o.w - u * 2.25, o.y + o.h - u * 2.25]]) {
        c.fillStyle = grad(c, x - u, y - u, x + u, y + u, ['#fff', '#6c7178']);
        c.beginPath();
        c.arc(x, y, u * 1, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#3f4349';
        c.lineWidth = u * 0.22;
        c.beginPath();
        c.moveTo(x - u * 0.6, y - u * 0.25); c.lineTo(x + u * 0.6, y + u * 0.25);
        c.stroke();
      }
    },
  },
  {
    id: 'instant', name: 'Instant photo', group: 'Picture frames', inset: { l: 4.5, r: 4.5, t: 4.5, b: 17 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, grad(c, o.x, o.y, o.x + o.w * 0.3, o.y + o.h, ['#fffefb', '#f1eee6']), u * 0.6));
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      c.shadowColor = 'rgba(0,0,0,0.7)';
      c.shadowBlur = u * 1.6;
      c.strokeStyle = '#000';
      c.lineWidth = u * 0.3;
      c.strokeRect(v.x - u * 0.2, v.y - u * 0.2, v.w + u * 0.4, v.h + u * 0.4);
      c.restore();
      // a glossy shine
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.beginPath();
      c.moveTo(v.x, v.y); c.lineTo(v.x + v.w * 0.45, v.y); c.lineTo(v.x + v.w * 0.2, v.y + v.h); c.lineTo(v.x, v.y + v.h);
      c.fill();
      c.restore();
    },
  },
  {
    id: 'white', name: 'White border', group: 'Picture frames', inset: { l: 3, r: 3, t: 3, b: 3 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, '#ffffff'));
      c.strokeStyle = 'rgba(0,0,0,0.14)';
      c.lineWidth = u * 0.1;
      c.strokeRect(v.x, v.y, v.w, v.h);
    },
  },

  // ---------- devices
  {
    id: 'browser', name: 'Web page', group: 'Devices', inset: { l: 0.8, r: 0.8, t: 10.5, b: 0.8 }, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, '#f4f5f7', u * 2.4));
      const y1 = o.y + u * 3, y2 = o.y + u * 7.8;
      ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
        c.fillStyle = color;
        c.beginPath();
        c.arc(o.x + u * (3 + i * 2.6), y1, u * 0.85, 0, Math.PI * 2);
        c.fill();
      });
      // tabs
      c.fillStyle = '#fff';
      round(c, o.x + u * 12, o.y + u * 0.9, u * 28, u * 4.4, u * 1);
      c.fill();
      label(c, 'My new video', o.x + u * 14, y1 + u * 0.05, u * 1.9, '#2a2c31', 'left', { font: SANS, shadow: false, weight: 500 });
      label(c, '+', o.x + u * 43, y1, u * 2.8, '#6a6e76', 'center', { font: SANS, shadow: false, weight: 400 });
      // arrows and address bar
      c.strokeStyle = '#6a6e76';
      c.lineWidth = u * 0.28;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(o.x + u * 3.6, y2 - u * 0.9); c.lineTo(o.x + u * 2.7, y2); c.lineTo(o.x + u * 3.6, y2 + u * 0.9);
      c.moveTo(o.x + u * 6.4, y2 - u * 0.9); c.lineTo(o.x + u * 7.3, y2); c.lineTo(o.x + u * 6.4, y2 + u * 0.9);
      c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = '#e4e6ea';
      round(c, o.x + u * 10, y2 - u * 1.9, o.w - u * 20, u * 3.8, u * 1.9);
      c.fill();
      label(c, 'www.my-new-video.com', o.x + o.w / 2, y2 + u * 0.05, u * 1.8, '#4c5058', 'center', { font: SANS, shadow: false, weight: 500 });
      c.fillStyle = '#9498a1';
      c.beginPath();
      c.arc(o.x + o.w - u * 4, y2, u * 1.1, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    id: 'phone', name: 'Phone', group: 'Devices', inset: { l: 7, r: 3, t: 3, b: 3 }, radius: 3.4, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, '#0b0c0f', u * 7, u * 3.4));
      c.strokeStyle = grad(c, o.x, o.y, o.x + o.w, o.y + o.h, ['#d6d9de', '#6b6f77', '#c4c8ce', '#585b62']);
      c.lineWidth = u * 0.6;
      round(c, o.x + u * 0.3, o.y + u * 0.3, o.w - u * 0.6, o.h - u * 0.6, u * 6.8);
      c.stroke();
      c.fillStyle = '#000';
      round(c, o.x + u * 2.4, o.y + o.h / 2 - u * 9, u * 3, u * 18, u * 1.5);
      c.fill();
      c.fillStyle = '#1c2a3a';
      c.beginPath();
      c.arc(o.x + u * 3.9, o.y + o.h / 2 + u * 5.5, u * 0.9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#8b8f97';
      for (const [x, w] of [[0.18, 7], [0.3, 7], [0.72, 13]]) c.fillRect(o.x + o.w * x, o.y - u * 0.3, u * w, u * 0.4);
    },
  },
  {
    id: 'laptop', name: 'Laptop', group: 'Devices', inset: { l: 7, r: 7, t: 3, b: 7 }, still: true,
    draw(c, v, o, t, u) {
      const lidX = v.x - u * 2, lidW = v.w + u * 4, lidY = v.y - u * 3, base = v.y + v.h + u * 1.6;
      lift(c, u, () => {
        c.fillStyle = '#0d0e11';
        c.beginPath();
        c.roundRect(lidX, lidY, lidW, base - lidY, [u * 2, u * 2, 0, 0]);
        c.rect(v.x, v.y, v.w, v.h);
        c.fill('evenodd');
      });
      c.fillStyle = '#2c3038';
      c.beginPath();
      c.arc(v.x + v.w / 2, v.y - u * 1.5, u * 0.42, 0, Math.PI * 2);
      c.fill();
      lift(c, u, () => {
        c.fillStyle = grad(c, 0, base, 0, base + u * 4.6, ['#e9ebee', '#b6bac0', '#8f939a']);
        c.beginPath();
        c.moveTo(lidX - u * 4, base);
        c.lineTo(lidX + lidW + u * 4, base);
        c.lineTo(lidX + lidW + u * 2, base + u * 4.6);
        c.lineTo(lidX - u * 2, base + u * 4.6);
        c.fill();
      });
      c.fillStyle = '#a2a6ad';
      round(c, v.x + v.w / 2 - u * 9, base, u * 18, u * 1.3, [0, 0, u * 0.9, u * 0.9]);
      c.fill();
    },
  },
  {
    id: 'game', name: 'Video game', group: 'Devices',
    draw(c, v, o, t, u) {
      const size = u * 3.2, top = v.y + u * 6;
      for (let i = 0; i < 5; i++) heart(c, v.x + u * (6 + i * 5), top, u * 2.2, i < 4 ? '#ff3858' : 'rgba(255,255,255,0.3)');
      label(c, `SCORE ${String(12400 + Math.floor(t * 50)).padStart(6, '0')}`, v.x + v.w - u * 4, top, size, '#ffe14a', 'right');
      label(c, 'LEVEL 7', v.x + v.w / 2, top, size, '#fff', 'center');
      // experience bar
      const y = v.y + v.h - u * 6, w = v.w * 0.5, x = v.x + (v.w - w) / 2;
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(x - u * 0.5, y - u * 0.5, w + u, u * 3);
      c.fillStyle = grad(c, x, y, x + w, y, ['#3cf08a', '#29d9ff']);
      c.fillRect(x, y, w * (0.2 + ((t * 0.03) % 0.8)), u * 2);
      label(c, 'XP', x - u * 1.5, y + u, size * 0.8, '#fff', 'right');
      // map
      const m = u * 21, mx = v.x + v.w - m - u * 3, my = v.y + u * 11;
      c.fillStyle = 'rgba(8,22,16,0.68)';
      c.fillRect(mx, my, m, m);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = u * 0.22;
      c.strokeRect(mx, my, m, m);
      c.strokeStyle = 'rgba(120,255,170,0.25)';
      c.lineWidth = u * 0.1;
      c.beginPath();
      for (let i = 1; i < 4; i++) {
        c.moveTo(mx + i * m / 4, my); c.lineTo(mx + i * m / 4, my + m);
        c.moveTo(mx, my + i * m / 4); c.lineTo(mx + m, my + i * m / 4);
      }
      c.stroke();
      for (let i = 0; i < 4; i++) {
        c.fillStyle = '#ff3858';
        c.fillRect(mx + rnd(i + 1) * m * 0.85 + Math.sin(t + i) * u * 0.8, my + rnd(i + 8) * m * 0.85, u * 0.9, u * 0.9);
      }
      c.fillStyle = '#ffe14a';
      c.beginPath();
      c.arc(mx + m / 2, my + m / 2, u * 0.8, 0, Math.PI * 2);
      c.fill();
      // aim
      crossMark(c, v.x + v.w / 2, v.y + v.h / 2, u * 2.8, u, '#fff');
    },
  },

  // ---------- film and retro
  {
    id: 'film', name: '35mm film', group: 'Film and retro', inset: { l: 10, r: 10, t: 0, b: 0 },
    draw(c, v, o, t, u) {
      ring(c, o, v, '#0d0c0b');
      const gap = u * 7, hw = u * 3.8, hh = u * 4.4, shift = (t * u * 26) % gap;
      c.save();
      c.beginPath();
      c.rect(o.x, o.y, o.w, o.h);
      c.clip();
      for (const side of [o.x, v.x + v.w]) {
        const x = side + (v.x - o.x - hw) * 0.28;
        c.fillStyle = '#e7e2d6';
        for (let y = o.y - gap + shift; y < o.y + o.h; y += gap) {
          round(c, x, y, hw, hh, u * 0.8);
          c.fill();
        }
        // the printed numbers on the edge of real film
        c.save();
        c.translate(side + (v.x - o.x) * 0.84, v.y + shift);
        c.rotate(Math.PI / 2);
        c.fillStyle = '#e8a33c';
        c.font = `700 ${u * 1.5}px ${MONO}`;
        c.textBaseline = 'middle';
        for (let i = -1; i < 7; i++) c.fillText(`CUTROOM 400  ${pad2(((i + 7) * 3) % 36)}A`, i * u * 28, 0);
        c.restore();
      }
      c.restore();
    },
  },
  {
    id: 'vhs', name: 'VHS tape', group: 'Film and retro',
    draw(c, v, o, t, u) {
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      // colors that bleed at the edges, and a band of static rolling up the picture
      c.fillStyle = 'rgba(255,30,60,0.07)';
      c.fillRect(v.x, v.y, u * 1.4, v.h);
      c.fillStyle = 'rgba(40,120,255,0.08)';
      c.fillRect(v.x + v.w - u * 1.4, v.y, u * 1.4, v.h);
      scanlines(c, v, u, 0.1);
      const span = v.h + u * 20, y = v.y + v.h - ((t * u * 11) % span);
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(v.x, y, v.w, u * 5);
      for (let i = 0; i < 26; i++) {
        c.fillStyle = `rgba(255,255,255,${0.1 + rnd(i + Math.floor(t * 18)) * 0.5})`;
        c.fillRect(v.x + rnd(i * 3 + Math.floor(t * 18)) * v.w, y + rnd(i) * u * 5, u * (1 + rnd(i * 2) * 8), u * 0.14);
      }
      c.restore();
      const x = v.x + u * 6, my = v.y + u * 8, size = u * 4.6;
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(x, my - u * 2); c.lineTo(x + u * 3.2, my); c.lineTo(x, my + u * 2);
      c.fill();
      label(c, 'PLAY', x + u * 5, my, size);
      label(c, 'SP', v.x + v.w - u * 6, my, size, '#fff', 'right');
      label(c, clock(t), v.x + u * 6, v.y + v.h - u * 12.5, size);
      label(c, 'NOV 08 1996', v.x + u * 6, v.y + v.h - u * 7, size * 0.82);
      label(c, 'AM 09:41', v.x + v.w - u * 6, v.y + v.h - u * 7, size * 0.82, '#fff', 'right');
    },
  },
  {
    id: 'tv', name: 'Old TV', group: 'Film and retro', inset: { l: 5, r: 20, t: 5, b: 5 }, radius: 4.5, still: true,
    draw(c, v, o, t, u) {
      lift(c, u, () => ring(c, o, v, grad(c, o.x, o.y, o.x + o.w, o.y + o.h, ['#8a5a30', '#5f3a1c', '#7a4e28']), u * 3, u * 4.5));
      // black edge around the screen
      c.strokeStyle = '#17120e';
      c.lineWidth = u * 1.5;
      round(c, v.x - u * 0.7, v.y - u * 0.7, v.w + u * 1.4, v.h + u * 1.4, u * 5);
      c.stroke();
      // glass shine
      c.save();
      c.beginPath();
      c.roundRect(v.x, v.y, v.w, v.h, u * 4.5);
      c.clip();
      const g = c.createRadialGradient(v.x + v.w / 2, v.y + v.h / 2, Math.hypot(v.w, v.h) * 0.3, v.x + v.w / 2, v.y + v.h / 2, Math.hypot(v.w, v.h) * 0.52);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      c.fillStyle = g;
      c.fillRect(v.x, v.y, v.w, v.h);
      scanlines(c, v, u, 0.09);
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.beginPath();
      c.ellipse(v.x + v.w * 0.25, v.y + v.h * 0.14, v.w * 0.32, v.h * 0.2, -0.25, 0, Math.PI * 2);
      c.fill();
      c.restore();
      // control panel
      const px = v.x + v.w + u * 2.2, pw = u * 15;
      c.fillStyle = '#26211c';
      round(c, px, v.y, pw, v.h, u * 1.4);
      c.fill();
      for (const k of [0.17, 0.44]) {
        const x = px + pw / 2, y = v.y + v.h * k, r = u * 4.8;
        c.fillStyle = grad(c, x - r, y - r, x + r, y + r, ['#d9d9d9', '#6e6e6e']);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#34302c';
        c.beginPath();
        c.arc(x, y, r * 0.66, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#e5e1d8';
        c.lineWidth = u * 0.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(k * 20) * r * 0.62, y + Math.sin(k * 20) * r * 0.62);
        c.stroke();
      }
      c.fillStyle = '#0d0b09';
      for (let i = 0; i < 9; i++) c.fillRect(px + u * 2, v.y + v.h * 0.64 + i * u * 2.6, pw - u * 4, u * 1.2);
    },
  },
  {
    id: 'comic', name: 'Comic', group: 'Film and retro', inset: { l: 3, r: 3, t: 3, b: 3 },
    draw(c, v, o, t, u) {
      // dots in the corners
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      c.fillStyle = 'rgba(0,0,0,0.75)';
      const step = u * 2.2;
      for (const [cx, cy] of [[v.x, v.y + v.h], [v.x + v.w, v.y]]) {
        for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
          const x = cx + (cx === v.x ? 1 : -1) * a * step, y = cy + (cy === v.y ? 1 : -1) * b * step, r = u * Math.max(0, 0.95 - (a + b) * 0.075);
          if (r <= 0) continue;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
      ring(c, o, v, '#ffffff');
      c.strokeStyle = '#000';
      c.lineWidth = u * 1.3;
      c.strokeRect(v.x - u * 0.2, v.y - u * 0.2, v.w + u * 0.4, v.h + u * 0.4);
      // a burst with a word in it
      const x = v.x + u * 15, y = v.y + u * 13, grow = 1 + Math.sin(t * 5) * 0.03;
      c.save();
      c.translate(x, y);
      c.scale(grow, grow);
      c.rotate(-0.12);
      c.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2, r = u * (i % 2 ? 7.4 : 12.5);
        c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 1.3, Math.sin(a) * r);
      }
      c.closePath();
      c.fillStyle = '#ffe14a';
      c.fill();
      c.strokeStyle = '#000';
      c.lineWidth = u * 0.7;
      c.stroke();
      label(c, 'WOW!', 0, u * 0.3, u * 5.2, '#e8262c', 'center', { font: SANS, weight: 900, shadow: false });
      c.restore();
    },
  },
  {
    id: 'super8', name: 'Home movie', group: 'Film and retro',
    draw(c, v, o, t, u) {
      const beat = Math.floor(t * 12);
      c.fillStyle = 'rgba(255,190,110,0.1)';
      c.fillRect(v.x, v.y, v.w, v.h);
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      grainDots(c, v, u, beat * 7, 70, 0.55);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = u * 0.08;
      for (let i = 0; i < 2; i++) {
        const x = v.x + rnd(beat + i * 9) * v.w;
        c.beginPath();
        c.moveTo(x, v.y); c.lineTo(x + u * (rnd(beat) - 0.5) * 2, v.y + v.h);
        c.stroke();
      }
      // the rounded corners of an old film gate
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.roundRect(v.x + u * 1.6, v.y + u * 1.6, v.w - u * 3.2, v.h - u * 3.2, u * 7);
      c.fillStyle = '#080604';
      c.fill('evenodd');
      c.restore();
    },
  },

  // ---------- movie looks
  {
    id: 'cinema', name: 'Movie bars', group: 'Movie looks',
    draw(c, v, o, t, u) {
      const h = v.h * 0.12;
      c.fillStyle = '#000';
      c.fillRect(v.x, v.y, v.w, h);
      c.fillRect(v.x, v.y + v.h - h, v.w, h);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(v.x, v.y + h, v.w, u * 0.1);
      c.fillRect(v.x, v.y + v.h - h, v.w, u * 0.1);
    },
  },
  {
    id: 'ultra', name: 'Ultra wide', group: 'Movie looks', still: true,
    draw(c, v) {
      const h = Math.max(0, (v.h - v.w / 2.76) / 2);
      c.fillStyle = '#000';
      c.fillRect(v.x, v.y, v.w, h);
      c.fillRect(v.x, v.y + v.h - h, v.w, h);
    },
  },
  {
    id: 'vignette', name: 'Dark edges', group: 'Movie looks', still: true,
    draw(c, v) {
      const r = Math.hypot(v.w, v.h) / 2, mx = v.x + v.w / 2, my = v.y + v.h / 2;
      const g = c.createRadialGradient(mx, my, r * 0.45, mx, my, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0.82)');
      c.fillStyle = g;
      c.fillRect(v.x, v.y, v.w, v.h);
    },
  },
  {
    id: 'leak', name: 'Light leak', group: 'Movie looks',
    draw(c, v, o, t) {
      c.save();
      c.beginPath();
      c.rect(v.x, v.y, v.w, v.h);
      c.clip();
      c.globalCompositeOperation = 'screen';
      const x = v.x + v.w * (0.08 + 0.05 * Math.sin(t * 0.5)), y = v.y + v.h * 0.35;
      for (const [px, py, r, color] of [[x, y, v.w * 0.42, '255,90,20'], [x - v.w * 0.03, y + v.h * 0.25, v.w * 0.26, '255,190,60'], [v.x + v.w * 1.02, v.y + v.h * 0.85, v.w * 0.3, '220,40,110']]) {
        const g = c.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${color},0.75)`);
        g.addColorStop(1, `rgba(${color},0)`);
        c.fillStyle = g;
        c.fillRect(v.x, v.y, v.w, v.h);
      }
      c.restore();
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
// how round the video's corners are, in pixels
export const frameRadius = (id, u) => (frameOf(id).radius || 0) * u;

// Frames that never change are drawn once and kept, so playing the video stays smooth.
let keptKey = '', kept = null;
// v is where the video ended up, and the border hugs it. Pictures on top follow the video's size.
export function drawFrame(c, id, v, t, unit) {
  const f = frameOf(id);
  if (!f.draw) return;
  const ins = f.inset;
  const u = ins ? unit : Math.min(v.w, v.h) / 100;
  const o = ins ? { x: v.x - ins.l * u, y: v.y - ins.t * u, w: v.w + (ins.l + ins.r) * u, h: v.h + (ins.t + ins.b) * u } : v;
  const big = c.canvas.width > 1000;
  if (f.still && big) {
    const key = `${id}|${c.canvas.width}|${v.x}|${v.y}|${v.w}|${v.h}|${u}`;
    if (key !== keptKey) {
      kept = document.createElement('canvas');
      kept.width = c.canvas.width;
      kept.height = c.canvas.height;
      f.draw(kept.getContext('2d'), v, o, t, u);
      keptKey = key;
    }
    c.drawImage(kept, 0, 0);
    return;
  }
  c.save();
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
  c.save();
  c.beginPath();
  c.roundRect(v.x, v.y, v.w, v.h, frameRadius(frame, fit.u));
  c.clip();
  c.drawImage(mock, v.x, v.y, v.w, v.h);
  c.restore();
  drawFrame(c, frame, v, 42, fit.u);
}
