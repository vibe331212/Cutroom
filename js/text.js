// Text you can put anywhere on a photo or video: size, color, font, sideways, and style.
// Positions and sizes are fractions of the picture, so text stays put at any export size.

export const FONTS = [
  { id: 'inter', name: 'Inter', family: 'Inter', weight: 800, look: 'Clean' },
  { id: 'bebas', name: 'Bebas Neue', family: 'Bebas Neue', weight: 400, look: 'Tall' },
  { id: 'anton', name: 'Anton', family: 'Anton', weight: 400, look: 'Bold' },
  { id: 'bangers', name: 'Bangers', family: 'Bangers', weight: 400, look: 'Comic' },
  { id: 'marker', name: 'Permanent Marker', family: 'Permanent Marker', weight: 400, look: 'Marker' },
  { id: 'pacifico', name: 'Pacifico', family: 'Pacifico', weight: 400, look: 'Surf' },
  { id: 'lobster', name: 'Lobster', family: 'Lobster', weight: 400, look: 'Fancy' },
  { id: 'playfair', name: 'Playfair Display', family: 'Playfair Display', weight: 800, look: 'Classy' },
  { id: 'pixel', name: 'Press Start 2P', family: 'Press Start 2P', weight: 400, look: 'Pixel' },
  { id: 'caveat', name: 'Caveat', family: 'Caveat', weight: 700, look: 'Handwritten' },
];
export const TEXT_COLORS = ['#ffffff', '#111111', '#ffd400', '#ff4f9a', '#3fb6ff', '#39e75f', '#ff7a1a', '#b67cff', '#ff3b3b'];
const STYLES = [
  { id: 'outline', name: 'Outline' }, { id: 'shadow', name: 'Shadow' }, { id: 'box', name: 'Box' }, { id: 'plain', name: 'Plain' },
];
const fontOf = id => FONTS.find(f => f.id === id) || FONTS[0];
const fontCSS = (f, px) => `${f.weight} ${px}px "${f.family}", Inter, system-ui, sans-serif`;
const isDark = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 110; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let nid = 0;

export function newText(extra = {}) {
  return { id: `t${Date.now().toString(36)}${++nid}`, text: 'Your text', x: 0.5, y: 0.5, size: 0.09, color: '#ffffff', font: 'inter', rot: 0, style: 'outline', ...extra };
}

// Make sure a font has loaded before drawing it, then redraw.
export function loadFont(id, done) {
  const f = fontOf(id);
  if (!document.fonts) return;
  document.fonts.load(fontCSS(f, 48), 'Aa').then(() => done && done()).catch(() => {});
}

// Draws one text. Returns its box size (in canvas pixels, before rotation) for clicking on it.
export function drawText(g, it, W, H) {
  const f = fontOf(it.font), fs = Math.max(4, it.size * H);
  const lines = String(it.text || ' ').split('\n');
  const lh = fs * 1.18;
  g.save();
  g.translate(it.x * W, it.y * H);
  g.rotate((it.rot || 0) * Math.PI / 180);
  g.font = fontCSS(f, fs);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const bw = Math.max(fs * 0.4, ...lines.map(l => g.measureText(l).width));
  const bh = lh * lines.length;
  const dark = isDark(it.color);
  if (it.style === 'box') {
    const pad = fs * 0.3;
    g.fillStyle = dark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.62)';
    g.beginPath(); g.roundRect(-bw / 2 - pad, -bh / 2 - pad * 0.7, bw + pad * 2, bh + pad * 1.4, fs * 0.25); g.fill();
  }
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    if (it.style === 'outline') {
      g.lineJoin = 'round';
      g.lineWidth = fs * 0.16;
      g.strokeStyle = dark ? '#ffffff' : '#000000';
      g.strokeText(line, 0, y);
    } else if (it.style === 'shadow') {
      g.shadowColor = dark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)';
      g.shadowBlur = fs * 0.25;
      g.shadowOffsetY = fs * 0.06;
    }
    g.fillStyle = it.color;
    g.fillText(line, 0, y);
  });
  g.restore();
  return { w: bw + fs * 0.5, h: bh + fs * 0.3 };
}

// One text tool for a canvas. `items()` gives the texts that can be seen right now.
export class TextLayer {
  constructor({ panel, canvas, wrap, items, add, remove, changed, before, video = false, timing }) {
    Object.assign(this, { panel, canvas, wrap, items, add, remove, changed, before, video, timing });
    this.boxes = new Map();
    this.selected = null;
    this.drag = null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'text-select';
    this.overlay.hidden = true;
    wrap.appendChild(this.overlay);
    this.buildPanel();
    this.bindPointer();
  }

  // call while drawing the picture, so clicks know where each text is
  draw(g, W, H) {
    for (const it of this.items()) this.boxes.set(it.id, drawText(g, it, W, H));
  }

  selectedItem() { return this.items(true).find(t => t.id === this.selected) || null; }

  select(id) {
    this.selected = id;
    this.syncPanel();
    this.syncOverlay();
  }

  // ---------- clicking and dragging on the picture
  toCanvas(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * this.canvas.width, y: (e.clientY - r.top) / r.height * this.canvas.height, r };
  }
  hit(px, py) {
    const W = this.canvas.width, H = this.canvas.height;
    const list = this.items();
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i], b = this.boxes.get(it.id);
      if (!b) continue;
      const a = -(it.rot || 0) * Math.PI / 180, dx = px - it.x * W, dy = py - it.y * H;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return it;
    }
    return null;
  }
  bindPointer() {
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || this.isBusy?.()) return;
      const p = this.toCanvas(e);
      const it = this.hit(p.x, p.y);
      if (!it) { if (this.selected) this.select(null); return; }
      e.preventDefault();
      e.stopPropagation();
      this.select(it.id);
      this.before();
      this.drag = { id: it.id, ox: it.x, oy: it.y, sx: p.x, sy: p.y };
      try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    });
    this.canvas.addEventListener('pointermove', e => {
      const p = this.toCanvas(e);
      if (!this.drag) { this.canvas.style.cursor = this.hit(p.x, p.y) ? 'move' : ''; return; }
      const it = this.selectedItem();
      if (!it) return;
      it.x = clamp(this.drag.ox + (p.x - this.drag.sx) / this.canvas.width, 0, 1);
      it.y = clamp(this.drag.oy + (p.y - this.drag.sy) / this.canvas.height, 0, 1);
      this.changed();
      this.syncOverlay();
    });
    const end = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    new ResizeObserver(() => this.syncOverlay()).observe(this.canvas);
  }

  // the dashed box around the picked text (a page element, so it never shows up in exports)
  syncOverlay() {
    const it = this.selectedItem();
    const visible = it && this.items().some(t => t.id === it.id);
    const b = it && this.boxes.get(it.id);
    if (!visible || !b) { this.overlay.hidden = true; return; }
    const cr = this.canvas.getBoundingClientRect(), wr = this.wrap.getBoundingClientRect();
    const k = cr.width / this.canvas.width;
    const o = this.overlay;
    o.hidden = false;
    o.style.width = `${b.w * k}px`;
    o.style.height = `${b.h * k}px`;
    o.style.left = `${cr.left - wr.left + it.x * cr.width}px`;
    o.style.top = `${cr.top - wr.top + it.y * cr.height}px`;
    o.style.transform = `translate(-50%, -50%) rotate(${it.rot || 0}deg)`;
  }

  // ---------- the panel
  buildPanel() {
    const P = this.panel;
    P.innerHTML = `
      <div class="row-between"><div><div class="h">Text</div><div class="sub">Drag text on the ${this.video ? 'video' : 'photo'} to move it.</div></div>
        <button class="primary-btn" data-t="add"><svg class="i"><use href="#i-plus"/></svg>Add text</button></div>
      <div class="text-chips" data-t="chips"></div>
      <div class="text-edit" data-t="edit" hidden>
        <textarea data-t="content" rows="2" maxlength="300" placeholder="Type your text"></textarea>
        <div class="field-label">Font</div>
        <div class="font-grid" data-t="fonts">${FONTS.map(f => `<button data-font="${f.id}" style="font-family:'${f.family}',Inter;font-weight:${f.weight}"><b>Aa</b><span>${f.look}</span></button>`).join('')}</div>
        <div class="field-label"><span>Size</span><span data-t="size-val"></span></div>
        <input type="range" data-t="size" min="0.02" max="0.4" step="0.005">
        <div class="field-label">Color</div>
        <div class="swatches text-swatches" data-t="colors">${TEXT_COLORS.map(c => `<button data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}<label class="swatch-pick" title="Pick any color"><input type="color" data-t="pick"><svg class="i"><use href="#i-plus"/></svg></label></div>
        <div class="field-label">Style</div>
        <div class="seg" data-t="styles">${STYLES.map(s => `<button data-style="${s.id}">${s.name}</button>`).join('')}</div>
        <div class="field-label"><span>Turn</span><span data-t="rot-val"></span></div>
        <input type="range" data-t="rot" min="-180" max="180" step="1">
        <div class="turn-row">
          <button class="tool-btn" data-t="left">Sideways left</button>
          <button class="tool-btn" data-t="straight">Straight</button>
          <button class="tool-btn" data-t="right">Sideways right</button>
        </div>
        ${this.video ? `
        <div class="field-label">When it shows</div>
        <div class="text-time" data-t="time"></div>
        <div class="turn-row">
          <button class="tool-btn" data-t="start">Start at playhead</button>
          <button class="tool-btn" data-t="end">End at playhead</button>
          <button class="tool-btn" data-t="whole">Whole video</button>
        </div>` : ''}
        <button class="ghost-btn full danger-text" data-t="delete"><svg class="i"><use href="#i-trash"/></svg>Delete this text</button>
      </div>
      <div class="panel-foot" data-t="empty">Add text, then drag it anywhere. ${this.video ? 'It shows from the playhead for 3 seconds; change that below.' : ''}</div>`;
    const q = n => P.querySelector(`[data-t="${n}"]`);
    this.q = q;
    q('add').onclick = () => {
      let it;
      try { it = this.add(); } catch { return; }
      this.changed();
      this.select(it.id);
      setTimeout(() => { q('content').focus(); q('content').select(); }, 30);
    };
    q('chips').addEventListener('click', e => { const c = e.target.closest('[data-id]'); if (c) this.select(c.dataset.id); });
    let typing = false;
    q('content').addEventListener('input', e => { this.edit(it => { it.text = e.target.value; }, !typing); typing = true; });
    q('content').addEventListener('blur', () => { typing = false; });
    q('content').addEventListener('keydown', e => e.stopPropagation());
    q('fonts').addEventListener('click', e => {
      const b = e.target.closest('[data-font]');
      if (b) { this.edit(it => { it.font = b.dataset.font; }); loadFont(b.dataset.font, () => this.changed()); }
    });
    let sliding = false;
    const slide = (name, fn) => {
      q(name).addEventListener('input', e => { this.edit(it => fn(it, +e.target.value), !sliding); sliding = true; });
      q(name).addEventListener('change', () => { sliding = false; });
    };
    slide('size', (it, v) => { it.size = v; });
    slide('rot', (it, v) => { it.rot = v; });
    q('colors').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) this.edit(it => { it.color = b.dataset.color; }); });
    q('pick').addEventListener('input', e => this.edit(it => { it.color = e.target.value; }, !sliding));
    q('styles').addEventListener('click', e => { const b = e.target.closest('[data-style]'); if (b) this.edit(it => { it.style = b.dataset.style; }); });
    q('left').onclick = () => this.edit(it => { it.rot = -90; });
    q('straight').onclick = () => this.edit(it => { it.rot = 0; });
    q('right').onclick = () => this.edit(it => { it.rot = 90; });
    if (this.video) {
      q('start').onclick = () => this.edit(it => this.timing.start(it));
      q('end').onclick = () => this.edit(it => this.timing.end(it));
      q('whole').onclick = () => this.edit(it => this.timing.whole(it));
    }
    q('delete').onclick = () => { const it = this.selectedItem(); if (!it) return; this.before(); this.remove(it.id); this.select(null); this.changed(); };
    for (const f of FONTS) loadFont(f.id);
  }

  edit(fn, record = true) {
    const it = this.selectedItem();
    if (!it) return;
    if (record) this.before();
    fn(it);
    this.changed();
    this.syncPanel();
    this.syncOverlay();
  }

  syncPanel() {
    const q = this.q, all = this.items(true), it = this.selectedItem();
    q('chips').innerHTML = all.map(t => `<button data-id="${t.id}" class="${t.id === this.selected ? 'active' : ''}" style="font-family:'${fontOf(t.font).family}',Inter">${esc((t.text || ' ').split('\n')[0].slice(0, 18) || ' ')}</button>`).join('');
    q('chips').hidden = !all.length;
    q('edit').hidden = !it;
    q('empty').hidden = !!it;
    if (!it) return;
    if (document.activeElement !== q('content')) q('content').value = it.text;
    this.panel.querySelectorAll('[data-font]').forEach(b => b.classList.toggle('active', b.dataset.font === it.font));
    this.panel.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('active', b.dataset.color === it.color));
    this.panel.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === it.style));
    q('size').value = it.size;
    q('size-val').textContent = `${Math.round(it.size * 1000) / 10}%`;
    q('rot').value = it.rot || 0;
    q('rot-val').textContent = `${Math.round(it.rot || 0)} degrees`;
    q('pick').value = /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : '#ffffff';
    if (this.video) q('time').textContent = this.timing.text(it);
  }
}
