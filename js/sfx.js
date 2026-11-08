// Sound effects. Real recordings come from Kenney (CC0, see sounds-real.js); the rest are made
// from scratch with Web Audio. Each sound is loaded once, then played on the timeline and in exports.
import { REAL_SOUNDS, REAL_GROUPS } from './sounds-real.js?v=2';
import { makeVoice } from './voices.js?v=5';

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

// A voice made from scratch. A breathy, rich tone (like air buzzing through vocal cords) goes
// through 4 filters that move like a mouth shaping vowels. "tract" sets the voice size:
// 1 is a grown man, about 1.15 a woman, 1.3 a kid.
const VOWEL = {
  i: [270, 2290, 3010], y: [260, 2200, 3000], e: [530, 1840, 2480], a: [730, 1090, 2440],
  o: [570, 840, 2410], u: [300, 870, 2240], w: [290, 610, 2150],
};
const waves = new WeakMap();
function glottalWave(ctx) {
  let w = waves.get(ctx);
  if (!w) {
    const n = 60, real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, 1.35);  // fewer high harmonics, like a real voice
    w = ctx.createPeriodicWave(real, imag);
    waves.set(ctx, w);
  }
  return w;
}
function voice(ctx, out, { t = 0, d = 1, pitch, vowels, tract = 1.15, vol = 0.5, breath = 0.22, vib = 4 }) {
  const src = ctx.createOscillator();
  src.setPeriodicWave(glottalWave(ctx));
  pitch.forEach(([at, f], i) => i ? src.frequency.linearRampToValueAtTime(f, t + at * d) : src.frequency.setValueAtTime(f, t));
  // a little wobble so it is not robotic
  const wob = ctx.createOscillator(), wobG = ctx.createGain();
  wob.frequency.value = 5 + Math.random() * 1.5;
  wobG.gain.setValueAtTime(0, t);
  wobG.gain.linearRampToValueAtTime(vib, t + d * 0.5);
  wob.connect(wobG).connect(src.frequency);
  const jit = ctx.createBufferSource(), jitF = ctx.createBiquadFilter(), jitG = ctx.createGain();
  jit.buffer = noiseBuffer(ctx); jit.loop = true; jitF.type = 'lowpass'; jitF.frequency.value = 18; jitG.gain.value = pitch[0][1] * 0.04;
  jit.connect(jitF).connect(jitG).connect(src.frequency);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.07, d * 0.15));
  amp.gain.setValueAtTime(vol, t + d * 0.72);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + d);
  const voiced = ctx.createGain(); voiced.gain.value = 1;
  src.connect(voiced);
  // breath: soft noise through the same mouth shape, strongest at the start
  const air = ctx.createBufferSource(), airG = ctx.createGain();
  air.buffer = noiseBuffer(ctx); air.loop = true;
  airG.gain.setValueAtTime(breath * 1.8, t);
  airG.gain.linearRampToValueAtTime(breath * 0.6, t + d * 0.3);
  air.connect(airG);
  const mouth = ctx.createGain();
  voiced.connect(mouth); airG.connect(mouth);
  const widths = [90, 120, 180, 260], levels = [1, 0.6, 0.32, 0.14];
  for (let k = 0; k < 4; k++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    if (k === 3) bp.frequency.setValueAtTime(3500 * tract, t);
    else vowels.forEach(([at, v], i) => {
      const f = VOWEL[v][k] * tract, time = t + at * d;
      i ? bp.frequency.linearRampToValueAtTime(f, time) : bp.frequency.setValueAtTime(f, time);
    });
    bp.Q.value = (k === 3 ? 3500 : VOWEL[vowels[0][1]][k]) * tract / widths[k];
    const lvl = ctx.createGain(); lvl.gain.value = levels[k] * 5;
    mouth.connect(bp).connect(lvl).connect(amp);
  }
  amp.connect(out);
  const end = t + d + 0.05;
  for (const n of [src, wob, jit, air]) { n.start(t); n.stop(end); }
}
// many different people at once
function crowd(ctx, out, { d, n = 16, vowels, shape, breath = 0.35 }) {
  for (let i = 0; i < n; i++) {
    const tract = [1, 1.08, 1.15, 1.22, 1.3][i % 5], base = (tract > 1.12 ? 190 : 115) * (0.85 + Math.random() * 0.4);
    const start = Math.random() * 0.25;
    voice(ctx, out, { t: start, d: d - start - Math.random() * 0.2, tract, vol: 0.09, breath, vib: 6, vowels, pitch: shape.map(([at, k]) => [at, base * k * (0.95 + Math.random() * 0.1)]) });
  }
  noise(ctx, out, { d, vol: 0.05, f: 700, q: 0.5, a: 0.2 });  // background murmur
}

function clap(ctx, out, t, vol) {
  noise(ctx, out, { t, d: 0.03 + Math.random() * 0.03, vol, f: 1100 + Math.random() * 900, q: 0.8, a: 0.001 });
}

const MADE = ['Reactions', 'Cartoon', 'Transitions', 'Alerts', 'Music', 'Nature'];
const MADE_SOUNDS = [
  // ---------- Reactions
  { id: 'wow', name: 'Wow', group: 'Reactions', dur: 1.1, make: (c, o) => voice(c, o, { d: 1.05, tract: 1.15, pitch: [[0, 210], [0.35, 330], [0.7, 280], [1, 170]], vowels: [[0, 'w'], [0.2, 'a'], [0.65, 'a'], [0.9, 'u'], [1, 'w']] }) },
  { id: 'wow-deep', name: 'Wow (deep)', group: 'Reactions', dur: 1.1, make: (c, o) => voice(c, o, { d: 1.05, tract: 1, pitch: [[0, 115], [0.35, 180], [0.7, 150], [1, 98]], vowels: [[0, 'w'], [0.2, 'a'], [0.65, 'a'], [0.9, 'u'], [1, 'w']] }) },
  { id: 'woah', name: 'Woah', group: 'Reactions', dur: 1.1, make: (c, o) => voice(c, o, { d: 1.05, tract: 1.15, pitch: [[0, 230], [0.3, 310], [1, 185]], vowels: [[0, 'w'], [0.18, 'o'], [0.55, 'a'], [1, 'a']] }) },
  { id: 'yay', name: 'Yay (kid)', group: 'Reactions', dur: 0.9, make: (c, o) => voice(c, o, { d: 0.85, tract: 1.3, pitch: [[0, 300], [0.4, 440], [1, 380]], vowels: [[0, 'y'], [0.15, 'e'], [0.6, 'e'], [1, 'i']] }) },
  { id: 'ooh', name: 'Ooh', group: 'Reactions', dur: 1.1, make: (c, o) => voice(c, o, { d: 1.05, tract: 1.15, breath: 0.32, pitch: [[0, 250], [0.45, 340], [1, 230]], vowels: [[0, 'u'], [0.5, 'o'], [1, 'u']] }) },
  { id: 'crowd-ooh', name: 'Crowd ooh', group: 'Reactions', dur: 1.9, make: (c, o) => crowd(c, o, { d: 1.85, vowels: [[0, 'u'], [0.5, 'o'], [1, 'u']], shape: [[0, 1], [0.45, 1.35], [1, 0.95]] }) },
  { id: 'crowd-aww', name: 'Crowd aww', group: 'Reactions', dur: 1.7, make: (c, o) => crowd(c, o, { d: 1.65, vowels: [[0, 'a'], [0.7, 'a'], [1, 'w']], shape: [[0, 1.3], [0.3, 1.35], [1, 0.85]] }) },
  { id: 'cheer', name: 'Cheer', group: 'Reactions', dur: 2.6, make: (c, o) => {
    crowd(c, o, { d: 2.4, n: 14, breath: 0.45, vowels: [[0, 'y'], [0.15, 'e'], [0.6, 'a'], [1, 'a']], shape: [[0, 1.4], [0.3, 1.6], [1, 1.3]] });
    for (let i = 0; i < 200; i++) clap(c, o, 0.15 + Math.random() * 2.3, 0.18);
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
// real recordings first, then the made-from-scratch ones (for sounds Kenney does not have)
export const SOUND_GROUPS = ['My sounds', ...REAL_GROUPS, ...MADE.map(g => `Made in Cutroom: ${g}`)];
export const SOUNDS = [...REAL_SOUNDS, ...MADE_SOUNDS.map(s => ({ ...s, group: `Made in Cutroom: ${s.group}` }))];
// Voice types you can pick for voice sounds. "Man" is the recording as it is.
export const VOICE_TYPES = [
  { id: 'man', name: 'Man' }, { id: 'woman', name: 'Woman' }, { id: 'kid', name: 'Kid' }, { id: 'deep', name: 'Deep' },
  { id: 'robot', name: 'Robot' }, { id: 'chipmunk', name: 'Chipmunk' }, { id: 'monster', name: 'Monster' },
  { id: 'alien', name: 'Alien' }, { id: 'ghost', name: 'Ghost' },
];
for (const s of SOUNDS) if (['wow', 'wow-deep', 'woah', 'yay', 'ooh', 'crowd-ooh', 'crowd-aww', 'cheer'].includes(s.id)) s.voice = true;

// sounds you import yourself (see mysounds.js)
export function addCustomSound({ id, name, url }) {
  if (!SOUNDS.some(s => s.id === id)) SOUNDS.unshift({ id, name, group: 'My sounds', file: url, custom: true });
}
// A sound found by online search. It becomes one of My sounds once it is added to a video.
export function addOnlineSound({ id, name, url, by, dur }) {
  const had = SOUNDS.find(s => s.id === id);
  if (had) return Object.assign(had, { by, dur });  // already one of My sounds
  const s = { id, name, group: 'Online', file: url, online: true, by, dur };
  SOUNDS.push(s);
  return s;
}
export function removeCustomSound(id) {
  const i = SOUNDS.findIndex(s => s.id === id && s.custom);
  if (i >= 0) { URL.revokeObjectURL(SOUNDS[i].file); SOUNDS.splice(i, 1); }
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}|`)) cache.delete(k);
}

export const soundOf = id => SOUNDS.find(s => s.id === id);

const cache = new Map();
// Builds a sound once (in a quick offline render) and remembers it.
// Voice sounds can be made in another voice type (see VOICE_TYPES).
export function renderSound(id, voice = 'man') {
  const s = soundOf(id);
  if (!s.voice) voice = 'man';
  const key = `${id}|${voice}`;
  if (!cache.has(key)) {
    let made;
    if (voice === 'woman' && s.woman) {
      // Kenney recorded a real woman saying it too
      made = fetch(s.woman).then(r => r.arrayBuffer()).then(b => new OfflineAudioContext(2, 1, SR).decodeAudioData(b));
    } else if (voice !== 'man') {
      // run the plain version through the voice changer
      made = renderSound(id, 'man').then(buf => {
        const tail = ['ghost', 'monster'].includes(voice) ? 1.2 : 0.25;
        const ctx = new OfflineAudioContext(2, Math.ceil((buf.duration + tail) * SR), SR);
        const src = ctx.createBufferSource(), chain = makeVoice(ctx, voice);
        src.buffer = buf;
        src.connect(chain.input);
        chain.output.connect(ctx.destination);
        src.start(0.02);
        return ctx.startRendering();
      });
    } else if (s.file) {
      // a real recording: load the file and decode it
      made = fetch(s.file).then(r => r.arrayBuffer()).then(b => new OfflineAudioContext(2, 1, SR).decodeAudioData(b));
    } else {
      const ctx = new OfflineAudioContext(2, Math.ceil(s.dur * SR), SR);
      const out = ctx.createGain();
      out.connect(ctx.destination);
      s.make(ctx, out);
      made = ctx.startRendering();
    }
    made.catch(() => cache.delete(key));  // a failed load can be tried again
    cache.set(key, made.then(buf => {
      // make every sound about as loud as the others
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      if (peak > 0) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.85 / peak; }
      return buf;
    }));
  }
  return cache.get(key);
}
