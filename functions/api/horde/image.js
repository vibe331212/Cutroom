import { UA, json, pass } from '../../_lib/horde.js';

// Passes a finished AI Horde picture through, only from AI Horde's own storage.
export async function onRequestGet({ request }) {
  const u = new URL(request.url).searchParams.get('u') || '';
  let target;
  try { target = new URL(u); } catch { return json({ error: 'bad url' }, 400); }
  if (target.protocol !== 'https:' || !/(^|\.)(r2\.cloudflarestorage\.com|aihorde\.net)$/.test(target.hostname)) return json({ error: 'not allowed' }, 400);
  return pass(await fetch(target.toString(), { headers: { 'User-Agent': UA } }));
}
