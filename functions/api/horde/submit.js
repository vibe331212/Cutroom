import { HORDE, HORDE_HEADERS, HORDE_MODELS, NEGATIVE, json, pass } from '../../_lib/horde.js';

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const prompt = String(body.prompt || '').trim().slice(0, 1500);
  if (!prompt) return json({ error: 'empty prompt' }, 400);
  const job = {
    prompt: `${prompt} ### ${NEGATIVE}`,
    params: { width: 1024, height: 576, steps: 25, cfg_scale: 6, sampler_name: 'k_euler_a', n: Math.max(1, Math.min(4, parseInt(body.n, 10) || 1)), seed: String(body.seed || '') },
    nsfw: false, censor_nsfw: true, models: HORDE_MODELS, r2: true, shared: false,
  };
  return pass(await fetch(`${HORDE}/generate/async`, { method: 'POST', headers: HORDE_HEADERS, body: JSON.stringify(job) }));
}
