import { UA, json, pass } from '../_lib/horde.js';

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const prompt = (q.get('prompt') || '').trim().slice(0, 1500);
  if (!prompt) return json({ error: 'empty prompt' }, 400);
  const params = new URLSearchParams({ width: '1280', height: '720', seed: q.get('seed') || '1', nologo: 'true' });
  return pass(await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`, { headers: { 'User-Agent': UA } }));
}
