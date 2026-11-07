// Cutroom accounts and online saving, stored in Cutroom's own Supabase project.
// Sign in with a username and password (like PetPost) or with Google.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=1';

const BUCKET = 'media';
// Usernames are turned into a made-up email, because Supabase signs people in by email.
const email = username => `${username}@users.cutroom-app.pages.dev`;
export const cleanUsername = name => String(name || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
export const configured = () => !!(SUPABASE_URL && SUPABASE_KEY);

let sb = null;
let me = null;  // { id, username }
const listeners = new Set();

async function client() {
  if (sb) return sb;
  if (!configured()) throw new Error('Accounts are not switched on yet.');
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
  // pkce: Google sends people back with ?code=... in the address, which Supabase reads by itself
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cutroom.auth', flowType: 'pkce', detectSessionInUrl: true },
  });
  return sb;
}

function check({ data, error }) {
  if (error) {
    const msg = error.message || '';
    if (/already registered|already exists|duplicate key.*username/i.test(msg)) throw new Error('That username is taken. Try another one.');
    if (/invalid login credentials/i.test(msg)) throw new Error('That username or password is not right.');
    if (/password should be at least/i.test(msg)) throw new Error('Your password needs at least 6 characters.');
    if (/exceeded the maximum allowed size|payload too large|413/i.test(msg)) throw new Error('A video is bigger than 50 MB, which is the most an online save can hold per file.');
    throw new Error(msg || 'Something went wrong talking to Cutroom online.');
  }
  return data;
}
const emit = () => listeners.forEach(f => f(me));
export const user = () => me;
export function onAuth(f) { listeners.add(f); return () => listeners.delete(f); }

async function loadMe(session) {
  if (!session?.user) { me = null; return; }
  const s = await client();
  const id = session.user.id;
  let { data: profile } = await s.from('profiles').select('username').eq('id', id).maybeSingle();
  if (!profile) {
    // first time with Google: make a username from the email, and add numbers if it is taken
    const base = cleanUsername((session.user.email || 'creator').split('@')[0]).slice(0, 18) || 'creator';
    for (let n = 0; n < 5 && !profile; n++) {
      const username = n ? `${base}${Math.floor(Math.random() * 9000 + 1000)}` : base.padEnd(3, '0');
      const res = await s.from('profiles').insert({ id, username }).select('username').maybeSingle();
      if (!res.error) profile = res.data;
    }
  }
  me = { id, username: profile?.username || 'creator', google: session.user.app_metadata?.provider === 'google' };
}

// Call once at startup: restores the last sign-in and finishes a Google sign-in.
export async function start() {
  if (!configured()) return null;
  const s = await client();
  const { data } = await s.auth.getSession();
  await loadMe(data.session);
  s.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { me = null; emit(); return; }
    if (event === 'SIGNED_IN' && session?.user?.id !== me?.id) loadMe(session).then(emit);
  });
  // tidy the address bar after Google sends you back
  if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname);
  emit();
  return me;
}

export async function signUp(username, password) {
  username = cleanUsername(username);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Usernames are 3 to 24 letters, numbers or _.');
  if (String(password).length < 6) throw new Error('Your password needs at least 6 characters.');
  const s = await client();
  const data = check(await s.auth.signUp({ email: email(username), password }));
  if (!data.session) throw new Error('Accounts need "Confirm email" turned off in Supabase. Ask Claude to fix this.');
  const res = await s.from('profiles').insert({ id: data.user.id, username });
  if (res.error) { await s.auth.signOut(); check(res); }
  me = { id: data.user.id, username };
  emit();
  return me;
}

export async function signIn(username, password) {
  const s = await client();
  const data = check(await s.auth.signInWithPassword({ email: email(cleanUsername(username)), password }));
  await loadMe(data.session);
  emit();
  return me;
}

export async function signInWithGoogle() {
  const s = await client();
  check(await s.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }));
}

export async function signOut() {
  const s = await client();
  await s.auth.signOut().catch(() => {});
  me = null;
  emit();
}

// ---------- settings
export async function loadSettings() {
  if (!me) return null;
  const s = await client();
  const { data } = await s.from('settings').select('data').eq('user_id', me.id).maybeSingle();
  return data?.data || null;
}
export async function saveSettings(obj) {
  if (!me) return;
  const s = await client();
  check(await s.from('settings').upsert({ user_id: me.id, data: obj, updated_at: new Date().toISOString() }));
}

// ---------- projects
export async function listProjects() {
  if (!me) return [];
  const s = await client();
  return check(await s.from('projects').select('id, name, thumb, size_bytes, updated_at').order('updated_at', { ascending: false }));
}

// files: [{ key, file }] for each clip; only clips not uploaded yet are sent.
export async function saveProject({ id, name, data, thumb, files, onProgress }) {
  if (!me) throw new Error('Sign in to save online.');
  const s = await client();
  id = id || crypto.randomUUID();
  const folder = `${me.id}/${id}`;
  const { data: existing } = await s.storage.from(BUCKET).list(folder, { limit: 1000 });
  const have = new Set((existing || []).map(f => f.name));
  let size = 0, done = 0;
  for (const { key, file } of files) {
    size += file.size;
    if (file.size > 52428800) throw new Error(`"${file.name}" is bigger than 50 MB, which is the most an online save can hold per file.`);
    if (!have.has(key)) check(await s.storage.from(BUCKET).upload(`${folder}/${key}`, file, { contentType: file.type || 'application/octet-stream', upsert: true }));
    onProgress?.(++done / files.length);
  }
  check(await s.from('projects').upsert({ id, user_id: me.id, name, data, thumb, size_bytes: size, updated_at: new Date().toISOString() }));
  // clips you deleted from the project are removed online too
  const keep = new Set(files.map(f => f.key));
  const stale = [...have].filter(n => !keep.has(n)).map(n => `${folder}/${n}`);
  if (stale.length) await s.storage.from(BUCKET).remove(stale);
  return id;
}

export async function loadProject(id, onProgress) {
  const s = await client();
  const row = check(await s.from('projects').select('*').eq('id', id).single());
  const files = {};
  const list = [...(row.data.sources || []), ...(row.data.mySounds || [])];
  let done = 0;
  for (const src of list) {
    const blob = check(await s.storage.from(BUCKET).download(`${me.id}/${id}/${src.key}`));
    files[src.key] = new File([blob], src.fileName || src.name, { type: src.type || blob.type });
    onProgress?.(++done / list.length);
  }
  return { row, files };
}

export async function deleteProject(id) {
  const s = await client();
  const folder = `${me.id}/${id}`;
  const { data: existing } = await s.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (existing?.length) await s.storage.from(BUCKET).remove(existing.map(f => `${folder}/${f.name}`));
  check(await s.from('projects').delete().eq('id', id));
}
