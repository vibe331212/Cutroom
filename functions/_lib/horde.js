// Shared settings for the free thumbnail makers (the same as server.py, for the website).
export const UA = 'Cutroom/1.0 (video editor)';
export const HORDE = 'https://aihorde.net/api/v2';
export const HORDE_HEADERS = { apikey: '0000000000', 'Client-Agent': 'Cutroom:1.0:web', 'User-Agent': UA, 'Content-Type': 'application/json' };
// family-safe models only, with the adult filter on
export const HORDE_MODELS = ['Juggernaut XL', 'AlbedoBase XL 3.1', 'AlbedoBase XL (SDXL)'];
export const NEGATIVE = 'text, words, letters, watermark, logo, signature, blurry, deformed, ugly, extra fingers, nsfw, nude';
export const JOB_ID = /^[0-9a-f-]{36}$/;

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export async function pass(res) {
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
}
