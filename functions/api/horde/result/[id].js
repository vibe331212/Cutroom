import { HORDE, HORDE_HEADERS, JOB_ID, UA, json, pass } from '../../../_lib/horde.js';

export async function onRequestGet({ params, request }) {
  if (!JOB_ID.test(params.id)) return json({ error: 'bad id' }, 400);
  const i = parseInt(new URL(request.url).searchParams.get('i') || '0', 10) || 0;
  const res = await fetch(`${HORDE}/generate/status/${params.id}`, { headers: HORDE_HEADERS });
  if (!res.ok) return pass(res);
  const gens = (await res.json()).generations || [];
  if (i >= gens.length) return json({ error: 'not ready' }, 404);
  if (gens[i].censored) return json({ error: 'censored' }, 451);
  return pass(await fetch(gens[i].img, { headers: { 'User-Agent': UA } }));
}
