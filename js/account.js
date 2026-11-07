// Account screens: sign in, create an account, sign out, and save or open projects online.
import * as Cloud from './cloud.js?v=2';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let api = null;
let mode = 'signin';
let projectId = null;
let settingsTimer = null;
let applyingSettings = false;

function ago(t) {
  const s = (Date.now() - Date.parse(t)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return new Date(t).toLocaleDateString();
}
const mb = b => `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`;

// ---------- top bar
function syncBar() {
  const u = Cloud.user();
  $('#btn-account').hidden = !!u;
  $('#account-chip').hidden = !u;
  $('#btn-save').hidden = !u;
  if (u) {
    $('#account-initial').textContent = $('#menu-initial').textContent = u.username[0].toUpperCase();
    $('#account-name').textContent = u.username;
    $('#menu-username').textContent = `@${u.username}`;
  }
  syncSaveButton();
}
export function syncSaveButton() {
  const btn = $('#btn-save');
  if (!btn || btn.hidden || btn.dataset.busy) return;
  const dirty = api.isDirty();
  btn.classList.toggle('saved', !dirty);
  $('#btn-save .lbl').textContent = dirty ? 'Save' : 'Saved';
}

// ---------- sign in / create account
function setMode(m) {
  mode = m;
  $$('#auth-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  $('#auth-title').textContent = m === 'signin' ? 'Sign in to Cutroom' : 'Create your Cutroom account';
  $('#auth-go').textContent = m === 'signin' ? 'Sign in' : 'Create account';
  $('#auth-confirm-row').hidden = m === 'signin';
  $('#auth-note').hidden = m === 'signin';
  $('#auth-password').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}
function openAuth(m = 'signin') {
  setMode(m);
  const off = !Cloud.configured();
  $('#auth-off').hidden = !off;
  $('#auth-form').hidden = off;
  api.openModal('auth-modal');
  if (!off) setTimeout(() => $('#auth-username').focus(), 50);
}
async function submitAuth(e) {
  e.preventDefault();
  const username = $('#auth-username').value, password = $('#auth-password').value;
  const err = $('#auth-error');
  err.textContent = '';
  if (!Cloud.cleanUsername(username)) { err.textContent = 'Type your username first.'; return; }
  if (!password) { err.textContent = 'Type your password first.'; return; }
  if (mode === 'signup' && password !== $('#auth-confirm').value) { err.textContent = 'The two passwords do not match.'; return; }
  const btn = $('#auth-go');
  btn.disabled = true;
  try {
    if (mode === 'signin') await Cloud.signIn(username, password);
    else await Cloud.signUp(username, password);
    api.closeModal('auth-modal');
    $('#auth-password').value = $('#auth-confirm').value = '';
    api.toast(mode === 'signin' ? `Welcome back, @${Cloud.user().username}` : `Account made. Welcome, @${Cloud.user().username}`);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- settings follow you
export function settingsChanged() {
  if (!Cloud.user() || applyingSettings) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => Cloud.saveSettings(api.getSettings()).catch(() => {}), 1200);
}
async function pullSettings() {
  try {
    const saved = await Cloud.loadSettings();
    applyingSettings = true;
    if (saved) api.applySettings(saved);
    else await Cloud.saveSettings(api.getSettings());
  } catch {} finally { applyingSettings = false; }
}

// ---------- projects
async function saveProject() {
  if (!Cloud.user()) { openAuth('signin'); return; }
  const btn = $('#btn-save');
  const p = api.getProject();
  if (!p.files.length) { api.toast('Add a clip before saving'); return; }
  btn.dataset.busy = '1';
  btn.disabled = true;
  const label = $('#btn-save .lbl');
  label.textContent = 'Saving...';
  try {
    projectId = await Cloud.saveProject({
      id: projectId, name: p.name, data: p.data, thumb: p.thumb, files: p.files,
      onProgress: f => { if (f < 1) label.textContent = `Saving ${Math.round(f * 100)}%`; },
    });
    api.markSaved();
    api.toast('Saved to your account');
  } catch (ex) {
    api.toast(ex.message, 4200);
  } finally {
    delete btn.dataset.busy;
    btn.disabled = false;
    syncSaveButton();
  }
}

async function openProjects() {
  if (!Cloud.user()) { openAuth('signin'); return; }
  api.openModal('projects-modal');
  const list = $('#projects-list');
  list.innerHTML = '<div class="projects-empty"><div class="spinner dark"></div></div>';
  $('#projects-warn').hidden = !api.isDirty() || !api.hasClips();
  try {
    const rows = await Cloud.listProjects();
    if (!rows.length) {
      list.innerHTML = '<div class="projects-empty"><b>No saved projects yet</b><span>Make an edit, then press Save at the top.</span></div>';
      return;
    }
    list.innerHTML = rows.map(r => `
      <div class="project-row" data-id="${r.id}">
        <div class="project-thumb" style="${r.thumb ? `background-image:url(${r.thumb})` : ''}"></div>
        <div class="project-meta"><b>${esc(r.name)}</b><span>${ago(r.updated_at)} · ${mb(r.size_bytes || 0)}</span></div>
        <button class="secondary-btn" data-act="open">Open</button>
        <button class="icon-btn" data-act="delete" title="Delete project"><svg class="i"><use href="#i-trash"/></svg></button>
      </div>`).join('');
  } catch (ex) {
    list.innerHTML = `<div class="projects-empty"><b>Could not load your projects</b><span>${esc(ex.message)}</span></div>`;
  }
}

async function onProjectClick(e) {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('.project-row');
  if (!btn || !row) return;
  const id = row.dataset.id;
  if (btn.dataset.act === 'delete') {
    if (row.dataset.sure !== '1') {
      // ask once more right on the button, so nothing is deleted by accident
      row.dataset.sure = '1';
      btn.classList.add('danger-confirm');
      btn.title = 'Click again to delete forever';
      api.toast('Click the trash again to delete this project forever', 2600);
      return;
    }
    btn.disabled = true;
    try {
      await Cloud.deleteProject(id);
      if (id === projectId) projectId = null;
      row.remove();
      api.toast('Project deleted');
      if (!$('.project-row')) openProjects();
    } catch (ex) { api.toast(ex.message); btn.disabled = false; }
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Opening...';
  try {
    const { row: proj, files } = await Cloud.loadProject(id, f => { btn.textContent = `Opening ${Math.round(f * 100)}%`; });
    await api.openProject(proj, files);
    projectId = id;
    api.markSaved();
    api.closeModal('projects-modal');
    api.toast(`Opened "${proj.name}"`);
  } catch (ex) {
    api.toast(ex.message, 4000);
    btn.disabled = false;
    btn.textContent = 'Open';
  }
}

export const newProject = () => { projectId = null; };

export function initAccount(a) {
  api = a;
  $('#btn-account').onclick = () => openAuth('signin');
  $('#auth-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-google').onclick = async () => {
    try { await Cloud.signInWithGoogle(); }
    catch (ex) { $('#auth-error').textContent = /provider is not enabled/i.test(ex.message) ? 'Google sign-in is not switched on yet. Use a username for now.' : ex.message; }
  };
  $('#btn-save').onclick = saveProject;

  const menu = $('#account-menu');
  $('#account-chip').onclick = e => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(10, innerWidth - r.right)}px`;
    menu.hidden = !menu.hidden;
  };
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#account-menu')) menu.hidden = true; });
  $('#menu-projects').onclick = () => { menu.hidden = true; openProjects(); };
  $('#menu-save').onclick = () => { menu.hidden = true; saveProject(); };
  $('#menu-signout').onclick = async () => {
    menu.hidden = true;
    await Cloud.signOut();
    projectId = null;
    api.toast('Signed out');
  };
  $('#projects-list').addEventListener('click', onProjectClick);

  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
  });

  Cloud.onAuth(u => { syncBar(); if (u) pullSettings(); });
  syncBar();
  Cloud.start().catch(err => console.warn('accounts', err));
}
