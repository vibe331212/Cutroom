import { HORDE, HORDE_HEADERS, JOB_ID, json, pass } from '../../../_lib/horde.js';

export async function onRequestGet({ params }) {
  if (!JOB_ID.test(params.id)) return json({ error: 'bad id' }, 400);
  return pass(await fetch(`${HORDE}/generate/check/${params.id}`, { headers: HORDE_HEADERS }));
}
