// Voice changer: each voice is a small chain of Web Audio nodes that sound passes through.
// makeVoice(ctx, id) returns { input, output, stop } to put between a clip and the speakers.

export const VOICES = [
  { id: 'normal', name: 'Normal', desc: 'Your real voice' },
  { id: 'robot', name: 'Robot', desc: 'Metal and buzzing' },
  { id: 'woman', name: 'Woman', desc: 'Higher and lighter' },
  { id: 'kid', name: 'Kid', desc: 'Young and high' },
  { id: 'chipmunk', name: 'Chipmunk', desc: 'High and squeaky' },
  { id: 'deep', name: 'Deep voice', desc: 'Low and big' },
  { id: 'monster', name: 'Monster', desc: 'Very low and growly' },
  { id: 'alien', name: 'Alien', desc: 'Wobbly and strange' },
  { id: 'radio', name: 'Old radio', desc: 'Crackly and thin' },
  { id: 'phone', name: 'Telephone', desc: 'Like a phone call' },
  { id: 'megaphone', name: 'Megaphone', desc: 'Loud and harsh' },
  { id: 'cave', name: 'Cave echo', desc: 'Big echoes' },
  { id: 'underwater', name: 'Underwater', desc: 'Muffled bubbles' },
  { id: 'ghost', name: 'Ghost', desc: 'Spooky and airy' },
];
// Your own voice, just higher or lower. The number is how many musical steps it moves.
export const PITCHES = [
  { id: 'up-1', name: 'A little high', desc: 'Barely higher', steps: 2 },
  { id: 'up-2', name: 'High', desc: 'Clearly higher', steps: 4 },
  { id: 'up-3', name: 'Higher', desc: 'Quite high', steps: 6 },
  { id: 'up-4', name: 'Very high', desc: 'Like a cartoon', steps: 9 },
  { id: 'up-5', name: 'Super high', desc: 'As high as it goes', steps: 12 },
  { id: 'down-1', name: 'A little low', desc: 'Barely lower', steps: -2 },
  { id: 'down-2', name: 'Low', desc: 'Clearly lower', steps: -4 },
  { id: 'down-3', name: 'Lower', desc: 'Quite low', steps: -6 },
  { id: 'down-4', name: 'Very low', desc: 'Like a giant', steps: -9 },
  { id: 'down-5', name: 'Super low', desc: 'As low as it goes', steps: -12 },
];
const pitchOf = id => PITCHES.find(p => p.id === id);
export const voiceName = id => pitchOf(id)?.name || (VOICES.find(v => v.id === id) || VOICES[0]).name;

// Changes pitch without changing speed: two delay lines whose delay slides like a saw,
// crossfaded so you never hear the jump when the slide restarts.
function pitchShift(ctx, ratio) {
  const T = 0.1, sr = ctx.sampleRate, n = Math.round(T * sr);
  const ramp = ctx.createBuffer(1, n, sr), win = ctx.createBuffer(1, n, sr);
  const rd = ramp.getChannelData(0), wd = win.getChannelData(0);
  const up = ratio > 1;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    rd[i] = up ? 1 - p : p;              // delay falling = higher pitch, rising = lower
    wd[i] = Math.sin(Math.PI * p) ** 2;  // two of these half a period apart always add up to 1
  }
  const depth = Math.abs(ratio - 1) * T;
  const input = ctx.createGain(), output = ctx.createGain();
  const sources = [];
  const start = ctx.currentTime + 0.02;
  for (const offset of [0, T / 2]) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.002;
    const mod = ctx.createBufferSource(); mod.buffer = ramp; mod.loop = true;
    const modGain = ctx.createGain(); modGain.gain.value = depth;
    mod.connect(modGain).connect(delay.delayTime);
    const fade = ctx.createBufferSource(); fade.buffer = win; fade.loop = true;
    const vca = ctx.createGain(); vca.gain.value = 0;
    fade.connect(vca.gain);
    input.connect(delay).connect(vca).connect(output);
    mod.start(start, offset); fade.start(start, offset);
    sources.push(mod, fade);
  }
  return { input, output, sources };
}

function distortion(ctx, amount) {
  const ws = ctx.createWaveShaper(), n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  ws.curve = curve; ws.oversample = '2x';
  return ws;
}
function filter(ctx, type, freq, q = 0.8) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}
function gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v; return g; }
function reverb(ctx, seconds, decay) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds), buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}
function lfo(ctx, freq, amount, target, sources) {
  const o = ctx.createOscillator(); o.frequency.value = freq;
  const g = gain(ctx, amount);
  o.connect(g).connect(target);
  o.start();
  sources.push(o);
}
// a chain of nodes plus a dry/wet split ends up in "output"
function series(nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes; }

export function makeVoice(ctx, id) {
  const input = gain(ctx, 1), output = gain(ctx, 1);
  const sources = [];
  const link = (from, to) => { from.connect(to); return to; };
  const withPitch = ratio => { const p = pitchShift(ctx, ratio); sources.push(...p.sources); return p; };

  const pitched = pitchOf(id);
  if (pitched) {
    const p = withPitch(2 ** (pitched.steps / 12));
    input.connect(p.input);
    p.output.connect(output);
  } else switch (id) {
    case 'robot': {
      // ring modulation (multiplying by a buzzing tone) plus a short metallic echo
      const ring = gain(ctx, 0);
      lfo(ctx, 55, 1, ring.gain, sources);
      const comb = ctx.createDelay(0.1); comb.delayTime.value = 0.009;
      const fb = gain(ctx, 0.55);
      input.connect(ring); ring.connect(comb); comb.connect(fb).connect(comb);
      const mix = gain(ctx, 1.6);
      ring.connect(mix); comb.connect(mix);
      series([mix, filter(ctx, 'highpass', 180), output]);
      break;
    }
    case 'woman': {
      const p = withPitch(1.28);
      input.connect(p.input);
      const air = filter(ctx, 'highshelf', 3500, 0.7); air.gain.value = 3;
      series([p.output, filter(ctx, 'highpass', 140), air, output]);
      break;
    }
    case 'kid': {
      const p = withPitch(1.55);
      input.connect(p.input);
      series([p.output, filter(ctx, 'highpass', 260), filter(ctx, 'lowpass', 7000), output]);
      break;
    }
    case 'chipmunk': { const p = withPitch(1.7); input.connect(p.input); series([p.output, filter(ctx, 'highpass', 200), output]); break; }
    case 'deep': { const p = withPitch(0.72); input.connect(p.input); series([p.output, filter(ctx, 'lowshelf', 200, 0.7), gain(ctx, 0.75), output]); break; }
    case 'monster': {
      const p = withPitch(0.55);
      input.connect(p.input);
      const low = filter(ctx, 'lowshelf', 150, 0.7); low.gain.value = 8;
      series([p.output, distortion(ctx, 6), low, filter(ctx, 'lowpass', 2600), gain(ctx, 0.42), output]);
      break;
    }
    case 'alien': {
      const p = withPitch(1.3);
      input.connect(p.input);
      const ring = gain(ctx, 0.6);
      lfo(ctx, 7, 0.5, ring.gain, sources);  // a fast wobble
      const flt = filter(ctx, 'bandpass', 1400, 1.4);
      lfo(ctx, 0.8, 700, flt.frequency, sources);
      series([p.output, ring, flt, gain(ctx, 6), output]);
      break;
    }
    case 'radio': {
      const noise = ctx.createBufferSource(), nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (Math.random() < 0.002 ? 1 : 0.15);
      noise.buffer = nb; noise.loop = true; noise.start(); sources.push(noise);
      series([input, filter(ctx, 'highpass', 500), filter(ctx, 'lowpass', 2800), distortion(ctx, 18), gain(ctx, 0.7), output]);
      series([noise, filter(ctx, 'bandpass', 2000, 0.6), gain(ctx, 0.025), output]);
      break;
    }
    case 'phone': series([input, filter(ctx, 'highpass', 400, 0.9), filter(ctx, 'lowpass', 3200, 0.9), filter(ctx, 'peaking', 1500, 1), distortion(ctx, 3), gain(ctx, 1.2), output]); break;
    case 'megaphone': {
      const peak = filter(ctx, 'peaking', 1800, 1.2); peak.gain.value = 10;
      series([input, filter(ctx, 'highpass', 700, 1), peak, distortion(ctx, 40), filter(ctx, 'lowpass', 4500), gain(ctx, 0.55), output]);
      break;
    }
    case 'cave': {
      input.connect(output);
      const d = ctx.createDelay(2); d.delayTime.value = 0.32;
      const fb = gain(ctx, 0.5), wet = gain(ctx, 0.55);
      input.connect(d); d.connect(filter(ctx, 'lowpass', 2500)).connect(fb).connect(d);
      d.connect(wet).connect(output);
      const rv = reverb(ctx, 2.6, 2.2);
      input.connect(rv); link(rv, gain(ctx, 0.45)).connect(output);
      break;
    }
    case 'underwater': {
      const lp = filter(ctx, 'lowpass', 520, 3);
      lfo(ctx, 1.6, 180, lp.frequency, sources);
      const wob = ctx.createDelay(0.05); wob.delayTime.value = 0.012;
      lfo(ctx, 3.2, 0.004, wob.delayTime, sources);
      series([input, wob, lp, gain(ctx, 0.8), output]);
      break;
    }
    case 'ghost': {
      const p = withPitch(0.88);
      input.connect(p.input);
      const trem = gain(ctx, 0.7);
      lfo(ctx, 4.5, 0.3, trem.gain, sources);
      const rv = reverb(ctx, 3.5, 1.6);
      series([p.output, filter(ctx, 'highpass', 300), trem]);
      trem.connect(gain(ctx, 1.4)).connect(output);
      trem.connect(rv); link(rv, gain(ctx, 1.6)).connect(output);
      break;
    }
    default: input.connect(output);
  }
  // a limiter at the end keeps loud moments from crackling
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12;
  limiter.attack.value = 0.003; limiter.release.value = 0.15;
  output.connect(limiter);
  return {
    input, output: limiter,
    stop() {
      for (const s of sources) { try { s.stop(); } catch {} }
      try { input.disconnect(); } catch {}
      try { output.disconnect(); } catch {}
      try { limiter.disconnect(); } catch {}
    },
  };
}
