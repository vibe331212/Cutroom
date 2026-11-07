// Sound effects, all made from scratch with Web Audio (no recordings are copied).
// Each sound is built once into an audio buffer, then played on the timeline and in exports.

const SR = 44100;
const noiseCache = new WeakMap();

function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, SR * 2, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}
// a volume curve: quick fade in, then fade out by the end
function env(param, t, a, d, peak) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + a);
  param.exponentialRampToValueAtTime(0.0001, t + d);
}
function tone(ctx, out, { type = 'sine', f, f2, t = 0, d = 0.3, vol = 0.5, a = 0.005, glide = 'exp' }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) glide === 'lin' ? o.frequency.linearRampToValueAtTime(f2, t + d) : o.frequency.exponentialRampToValueAtTime(f2, t + d);
  env(g.gain, t, a, d, vol);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + d + 0.05);
  return o;
}
function noise(ctx, out, { t = 0, d = 0.2, vol = 0.5, type = 'bandpass', f = 1500, f2, q = 1, a = 0.003 }) {
  const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuffer(ctx); s.loop = true;
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + d);
  env(g.gain, t, a, d, vol);
  s.connect(flt).connect(g).connect(out);
  s.start(t, Math.random()); s.stop(t + d + 0.05);
}
function vibrato(ctx, osc, { t = 0, d = 1, rate = 6, depth = 10, decay = false }) {
  const l = ctx.createOscillator(), g = ctx.createGain();
  l.frequency.value = rate;
  g.gain.setValueAtTime(depth, t);
  if (decay) g.gain.exponentialRampToValueAtTime(0.01, t + d);
  l.connect(g).connect(osc.frequency);
  l.start(t); l.stop(t + d + 0.05);
}
const note = n => 440 * Math.pow(2, (n - 69) / 12);  // MIDI note number to pitch

// A voice-like sound: a buzzy tone shaped by 3 filters that move like a mouth saying vowels.
function voice(ctx, out, { t = 0, d = 1, f0 = 180, f0end = 150, vowels, vol = 0.5, vib = 5 }) {
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0, t);
  src.frequency.linearRampToValueAtTime(f0 * 1.15, t + d * 0.35);
  src.frequency.linearRampToValueAtTime(f0end, t + d);
  vibrato(ctx, src, { t, d, rate: 5.5, depth: vib });
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
  g.gain.setValueAtTime(vol, t + d * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  [0, 1, 2].forEach(k => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = [9, 11, 13][k];
    vowels.forEach(([at, ...fs], i) => {
      const time = t + at * d;
      i ? bp.frequency.linearRampToValueAtTime(fs[k], time) : bp.frequency.setValueAtTime(fs[k], time);
    });
    const lvl = ctx.createGain(); lvl.gain.value = [1, 0.6, 0.3][k] * 3;
    src.connect(bp).connect(lvl).connect(g);
  });
  g.connect(out);
  src.start(t); src.stop(t + d + 0.05);
}
const W = [300, 650, 2300], A = [780, 1200, 2500], O = [450, 800, 2400], U = [330, 870, 2250], E = [550, 1850, 2550];

function clap(ctx, out, t, vol) {
  noise(ctx, out, { t, d: 0.03 + Math.random() * 0.03, vol, f: 1100 + Math.random() * 900, q: 0.8, a: 0.001 });
}

export const SOUND_GROUPS = ['Reactions', 'Cartoon', 'Transitions', 'Alerts', 'Music', 'Nature'];
export const SOUNDS = [
  // ---------- Reactions
  { id: 'wow', name: 'Wow', group: 'Reactions', dur: 1.1, make: (c, o) => voice(c, o, { d: 1.05, f0: 210, f0end: 160, vowels: [[0, ...W], [0.25, ...A], [0.75, ...A], [1, ...U]] }) },
  { id: 'crowd-ooh', name: 'Crowd ooh', group: 'Reactions', dur: 1.8, make: (c, o) => {
    for (let i = 0; i < 9; i++) voice(c, o, { t: Math.random() * 0.12, d: 1.6, f0: 130 + Math.random() * 140, f0end: 120 + Math.random() * 60, vowels: [[0, ...U], [0.5, ...O], [1, ...U]], vol: 0.12, vib: 8 });
  } },
  { id: 'crowd-aww', name: 'Crowd aww', group: 'Reactions', dur: 1.6, make: (c, o) => {
    for (let i = 0; i < 9; i++) voice(c, o, { t: Math.random() * 0.1, d: 1.45, f0: 200 + Math.random() * 120, f0end: 130 + Math.random() * 40, vowels: [[0, ...A], [0.6, ...A], [1, ...W]], vol: 0.12, vib: 6 });
  } },
  { id: 'applause', name: 'Applause', group: 'Reactions', dur: 3, make: (c, o) => {
    for (let i = 0; i < 380; i++) { const t = Math.random() * 2.8; clap(c, o, t, 0.35 * Math.min(1, t * 3) * (1 - t / 3.2)); }
  } },
  { id: 'cheer', name: 'Cheer', group: 'Reactions', dur: 2.6, make: (c, o) => {
    noise(c, o, { d: 2.5, vol: 0.25, f: 900, q: 0.6, a: 0.4 });
    for (let i = 0; i < 8; i++) voice(c, o, { t: Math.random() * 0.4, d: 1.6 + Math.random() * 0.6, f0: 260 + Math.random() * 200, f0end: 300 + Math.random() * 150, vowels: [[0, ...E], [0.4, ...A], [1, ...A]], vol: 0.1, vib: 12 });
    for (let i = 0; i < 160; i++) clap(c, o, 0.2 + Math.random() * 2.2, 0.2);
  } },
  { id: 'gasp', name: 'Gasp', group: 'Reactions', dur: 0.7, make: (c, o) => noise(c, o, { d: 0.6, vol: 0.6, f: 700, f2: 2600, q: 2, a: 0.08 }) },
  { id: 'kiss', name: 'Kiss', group: 'Reactions', dur: 0.3, make: (c, o) => { tone(c, o, { f: 1400, f2: 2600, d: 0.09, vol: 0.4 }); noise(c, o, { t: 0.06, d: 0.05, vol: 0.4, f: 3000, q: 2 }); } },

  // ---------- Cartoon
  { id: 'boing', name: 'Boing', group: 'Cartoon', dur: 1, make: (c, o) => { const s = tone(c, o, { f: 180, f2: 260, d: 0.95, vol: 0.6, glide: 'lin' }); vibrato(c, s, { d: 0.95, rate: 14, depth: 90, decay: true }); } },
  { id: 'slide-up', name: 'Slide whistle up', group: 'Cartoon', dur: 0.9, make: (c, o) => { const s = tone(c, o, { f: 450, f2: 1900, d: 0.85, vol: 0.45, a: 0.05 }); vibrato(c, s, { d: 0.85, rate: 7, depth: 25 }); } },
  { id: 'slide-down', name: 'Slide whistle down', group: 'Cartoon', dur: 0.9, make: (c, o) => { const s = tone(c, o, { f: 1900, f2: 420, d: 0.85, vol: 0.45, a: 0.05 }); vibrato(c, s, { d: 0.85, rate: 7, depth: 25 }); } },
  { id: 'pop', name: 'Pop', group: 'Cartoon', dur: 0.2, make: (c, o) => { tone(c, o, { f: 520, f2: 110, d: 0.08, vol: 0.8 }); noise(c, o, { d: 0.02, vol: 0.4, f: 3000 }); } },
  { id: 'bonk', name: 'Bonk', group: 'Cartoon', dur: 0.4, make: (c, o) => { tone(c, o, { type: 'triangle', f: 620, f2: 280, d: 0.18, vol: 0.7 }); tone(c, o, { f: 1240, f2: 900, d: 0.08, vol: 0.3 }); noise(c, o, { d: 0.04, vol: 0.4, f: 1800, q: 3 }); } },
  { id: 'squeak', name: 'Squeak', group: 'Cartoon', dur: 0.3, make: (c, o) => { const s = tone(c, o, { f: 1700, f2: 2500, d: 0.22, vol: 0.4, glide: 'lin' }); vibrato(c, s, { d: 0.22, rate: 30, depth: 120 }); } },
  { id: 'zip', name: 'Zip', group: 'Cartoon', dur: 0.4, make: (c, o) => { for (let i = 0; i < 16; i++) noise(c, o, { t: i * 0.02, d: 0.015, vol: 0.4, f: 800 + i * 220, q: 4 }); } },
  { id: 'spring', name: 'Jump', group: 'Cartoon', dur: 0.35, make: (c, o) => tone(c, o, { type: 'square', f: 300, f2: 900, d: 0.25, vol: 0.18 }) },

  // ---------- Transitions
  { id: 'whoosh', name: 'Whoosh', group: 'Transitions', dur: 0.9, make: (c, o) => { noise(c, o, { d: 0.42, vol: 0.6, f: 300, f2: 2600, q: 2.5, a: 0.3 }); noise(c, o, { t: 0.4, d: 0.45, vol: 0.5, f: 2600, f2: 500, q: 2.5, a: 0.01 }); } },
  { id: 'swoosh', name: 'Quick swoosh', group: 'Transitions', dur: 0.4, make: (c, o) => noise(c, o, { d: 0.35, vol: 0.7, f: 600, f2: 4000, q: 3, a: 0.12 }) },
  { id: 'riser', name: 'Riser', group: 'Transitions', dur: 2.3, make: (c, o) => { tone(c, o, { type: 'sawtooth', f: 90, f2: 1100, d: 2.2, vol: 0.18, a: 1.8 }); noise(c, o, { d: 2.2, vol: 0.35, type: 'highpass', f: 400, f2: 6000, a: 2 }); } },
  { id: 'impact', name: 'Big hit', group: 'Transitions', dur: 1.6, make: (c, o) => { tone(c, o, { f: 130, f2: 32, d: 1.5, vol: 0.9 }); noise(c, o, { d: 0.9, vol: 0.6, type: 'lowpass', f: 2500, f2: 120, q: 0.5 }); } },
  { id: 'glitch', name: 'Glitch', group: 'Transitions', dur: 0.6, make: (c, o) => {
    for (let i = 0; i < 14; i++) { const t = Math.random() * 0.5; Math.random() < 0.5 ? tone(c, o, { type: 'square', f: 200 + Math.random() * 1800, t, d: 0.03, vol: 0.15 }) : noise(c, o, { t, d: 0.04, vol: 0.4, f: 500 + Math.random() * 4000, q: 6 }); }
  } },
  { id: 'rewind', name: 'Rewind', group: 'Transitions', dur: 1.1, make: (c, o) => { for (let i = 0; i < 10; i++) tone(c, o, { type: 'sawtooth', f: 2400, f2: 260, t: i * 0.1, d: 0.1, vol: 0.12 }); noise(c, o, { d: 1, vol: 0.15, f: 2500, q: 0.7 }); } },
  { id: 'record-scratch', name: 'Record scratch', group: 'Transitions', dur: 0.7, make: (c, o) => {
    // the filter swings up and down fast, like a record pulled back and forth
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuffer(c); f.type = 'bandpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(350, 0);
    for (let i = 1; i <= 6; i++) f.frequency.exponentialRampToValueAtTime(i % 2 ? 2400 : 350, i * 0.1);
    env(g.gain, 0, 0.01, 0.65, 0.9);
    s.connect(f).connect(g).connect(o); s.start(0); s.stop(0.7);
  } },

  // ---------- Alerts
  { id: 'ding', name: 'Ding', group: 'Alerts', dur: 1.6, make: (c, o) => { [[1, 0.5], [2.01, 0.18], [3.02, 0.08]].forEach(([k, v]) => tone(c, o, { f: 1318 * k, d: 1.5, vol: v, a: 0.002 })); } },
  { id: 'chime', name: 'Chime', group: 'Alerts', dur: 1.5, make: (c, o) => { [84, 88, 91, 96].forEach((n, i) => tone(c, o, { f: note(n), t: i * 0.09, d: 1.1, vol: 0.3, a: 0.002 })); } },
  { id: 'notify', name: 'Notification', group: 'Alerts', dur: 0.5, make: (c, o) => { tone(c, o, { f: 988, d: 0.18, vol: 0.4 }); tone(c, o, { f: 1480, t: 0.11, d: 0.3, vol: 0.4 }); } },
  { id: 'success', name: 'Success', group: 'Alerts', dur: 0.8, make: (c, o) => { [72, 79, 84].forEach((n, i) => tone(c, o, { type: 'triangle', f: note(n), t: i * 0.12, d: i === 2 ? 0.55 : 0.18, vol: 0.4 })); } },
  { id: 'error', name: 'Wrong buzzer', group: 'Alerts', dur: 0.9, make: (c, o) => { [0, 0.38].forEach(t => { tone(c, o, { type: 'square', f: 105, t, d: 0.32, vol: 0.2, a: 0.01 }); tone(c, o, { type: 'square', f: 111, t, d: 0.32, vol: 0.2, a: 0.01 }); }); } },
  { id: 'level-up', name: 'Level up', group: 'Alerts', dur: 0.9, make: (c, o) => { [67, 71, 74, 79, 83, 86, 91].forEach((n, i) => tone(c, o, { type: 'square', f: note(n), t: i * 0.065, d: i === 6 ? 0.4 : 0.07, vol: 0.12 })); } },
  { id: 'coin', name: 'Coin', group: 'Alerts', dur: 0.6, make: (c, o) => { [[79, 0], [84, 0.06], [88, 0.12]].forEach(([n, t], i) => tone(c, o, { type: 'square', f: note(n), t, d: i === 2 ? 0.4 : 0.07, vol: 0.13 })); } },
  { id: 'click', name: 'Click', group: 'Alerts', dur: 0.1, make: (c, o) => { noise(c, o, { d: 0.012, vol: 0.6, f: 4000, q: 1 }); tone(c, o, { f: 1900, d: 0.02, vol: 0.3 }); } },
  { id: 'camera', name: 'Camera shutter', group: 'Alerts', dur: 0.4, make: (c, o) => { noise(c, o, { d: 0.05, vol: 0.7, f: 2800, q: 1.5 }); noise(c, o, { t: 0.11, d: 0.07, vol: 0.6, f: 1800, q: 1.5 }); } },
  { id: 'typing', name: 'Typing', group: 'Alerts', dur: 1.8, make: (c, o) => { let t = 0; for (let i = 0; i < 14; i++) { t += 0.06 + Math.random() * 0.12; noise(c, o, { t, d: 0.025, vol: 0.5, f: 2200 + Math.random() * 1500, q: 2 }); } } },
  { id: 'register', name: 'Cash register', group: 'Alerts', dur: 1.4, make: (c, o) => { noise(c, o, { d: 0.3, vol: 0.35, type: 'lowpass', f: 1500, q: 0.7 }); tone(c, o, { f: 2350, t: 0.28, d: 1, vol: 0.35, a: 0.002 }); tone(c, o, { f: 2960, t: 0.28, d: 1, vol: 0.25, a: 0.002 }); } },
  { id: 'doorbell', name: 'Doorbell', group: 'Alerts', dur: 1.8, make: (c, o) => { tone(c, o, { f: note(76), d: 0.9, vol: 0.4, a: 0.003 }); tone(c, o, { f: note(72), t: 0.55, d: 1.2, vol: 0.4, a: 0.003 }); } },
  { id: 'phone', name: 'Phone ring', group: 'Alerts', dur: 1.9, make: (c, o) => {
    // two close tones that flutter on and off quickly, twice
    for (const start of [0, 1]) for (let t = start; t < start + 0.8; t += 0.05) [440, 480].forEach(f => tone(c, o, { f, t, d: 0.045, vol: 0.18, a: 0.004 }));
  } },

  // ---------- Music
  { id: 'drum-roll', name: 'Drum roll', group: 'Music', dur: 2.6, make: (c, o) => {
    for (let t = 0; t < 1.9; t += 0.032 + Math.random() * 0.01) noise(c, o, { t, d: 0.05, vol: 0.12 + t * 0.15, f: 1800, q: 0.8 });
    noise(c, o, { t: 1.95, d: 0.6, vol: 0.5, type: 'highpass', f: 5000 }); tone(c, o, { f: 140, f2: 60, t: 1.95, d: 0.4, vol: 0.7 });
  } },
  { id: 'rimshot', name: 'Joke drum', group: 'Music', dur: 1.3, make: (c, o) => { tone(c, o, { f: 230, f2: 140, d: 0.15, vol: 0.6 }); tone(c, o, { f: 170, f2: 95, t: 0.16, d: 0.18, vol: 0.6 }); noise(c, o, { t: 0.34, d: 0.9, vol: 0.4, type: 'highpass', f: 6500 }); } },
  { id: 'sad-trombone', name: 'Sad trombone', group: 'Music', dur: 2.4, make: (c, o) => {
    [[62, 0, 0.42], [61, 0.45, 0.42], [60, 0.9, 0.42], [59, 1.35, 0.95]].forEach(([n, t, d], i) => {
      const s = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      s.type = 'sawtooth'; s.frequency.value = note(n - 12);
      if (i === 3) vibrato(c, s, { t, d, rate: 6, depth: 6 });
      f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1300, t + 0.12); f.frequency.linearRampToValueAtTime(600, t + d);
      env(g.gain, t, 0.04, d, 0.35);
      s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + d + 0.05);
    });
  } },
  { id: 'dramatic', name: 'Dramatic', group: 'Music', dur: 2.6, make: (c, o) => {
    [[43, 0, 0.25], [43, 0.32, 0.25], [39, 0.66, 1.8]].forEach(([n, t, d]) => {
      [1, 1.005, 2].forEach(k => tone(c, o, { type: 'sawtooth', f: note(n) * k, t, d, vol: 0.12, a: 0.02 }));
      noise(c, o, { t, d: 0.3, vol: 0.3, type: 'lowpass', f: 300 });
    });
  } },
  { id: 'horn', name: 'Party horn', group: 'Music', dur: 1.5, make: (c, o) => {
    [0, 0.28, 0.56].forEach((t, i) => [459, 577, 688].forEach(f => tone(c, o, { type: 'sawtooth', f: f * (i === 2 ? 1 : 0.99), t, d: i === 2 ? 0.8 : 0.22, vol: 0.1, a: 0.01 })));
  } },
  { id: 'tada', name: 'Ta-da', group: 'Music', dur: 1.5, make: (c, o) => { [[60, 64, 67], [65, 69, 72]].forEach((ch, i) => ch.forEach(n => tone(c, o, { type: 'triangle', f: note(n + 12), t: i * 0.16, d: i ? 1.2 : 0.14, vol: 0.18 }))); } },

  // ---------- Nature
  { id: 'thunder', name: 'Thunder', group: 'Nature', dur: 3.5, make: (c, o) => { noise(c, o, { d: 0.25, vol: 0.5, type: 'highpass', f: 1500 }); noise(c, o, { t: 0.05, d: 3.3, vol: 0.9, type: 'lowpass', f: 500, f2: 90, q: 0.5, a: 0.15 }); } },
  { id: 'explosion', name: 'Explosion', group: 'Nature', dur: 2.4, make: (c, o) => { noise(c, o, { d: 2.2, vol: 0.9, type: 'lowpass', f: 2500, f2: 120, q: 0.6, a: 0.005 }); tone(c, o, { f: 90, f2: 28, d: 1.8, vol: 0.9 }); } },
  { id: 'heartbeat', name: 'Heartbeat', group: 'Nature', dur: 1.9, make: (c, o) => { [0, 0.26, 0.95, 1.21].forEach((t, i) => tone(c, o, { f: i % 2 ? 55 : 70, f2: 35, t, d: 0.18, vol: 0.9 })); } },
  { id: 'crickets', name: 'Crickets', group: 'Nature', dur: 2.5, make: (c, o) => { for (let b = 0; b < 4; b++) for (let i = 0; i < 6; i++) tone(c, o, { f: 4400, t: b * 0.6 + i * 0.035, d: 0.025, vol: 0.12 }); } },
  { id: 'bird', name: 'Bird tweet', group: 'Nature', dur: 1, make: (c, o) => { [0, 0.15, 0.3, 0.55].forEach((t, i) => tone(c, o, { f: 2400 + i * 200, f2: 4200, t, d: 0.09, vol: 0.25 })); } },
  { id: 'magic', name: 'Magic sparkle', group: 'Nature', dur: 1.4, make: (c, o) => { for (let i = 0; i < 26; i++) tone(c, o, { f: 1800 + Math.random() * 4200, t: i * 0.035 + Math.random() * 0.03, d: 0.35, vol: 0.12, a: 0.002 }); } },
  { id: 'ghost', name: 'Spooky ooo', group: 'Nature', dur: 2.2, make: (c, o) => { const s = tone(c, o, { f: 420, f2: 360, d: 2.1, vol: 0.3, a: 0.4, glide: 'lin' }); vibrato(c, s, { d: 2.1, rate: 5, depth: 18 }); } },
  { id: 'clock', name: 'Ticking clock', group: 'Nature', dur: 2.1, make: (c, o) => { for (let i = 0; i < 4; i++) { tone(c, o, { f: i % 2 ? 1400 : 1900, t: i * 0.5, d: 0.04, vol: 0.5 }); noise(c, o, { t: i * 0.5, d: 0.02, vol: 0.3, f: 3500, q: 3 }); } } },
];
export const soundOf = id => SOUNDS.find(s => s.id === id);

const cache = new Map();
// Builds a sound once (in a quick offline render) and remembers it.
export function renderSound(id) {
  if (!cache.has(id)) {
    const s = soundOf(id);
    const ctx = new OfflineAudioContext(2, Math.ceil(s.dur * SR), SR);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    s.make(ctx, out);
    cache.set(id, ctx.startRendering().then(buf => {
      // make every sound about as loud as the others
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      if (peak > 0) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.85 / peak; }
      return buf;
    }));
  }
  return cache.get(id);
}
