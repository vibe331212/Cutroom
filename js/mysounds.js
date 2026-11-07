// "My sounds": sound files you import yourself, remembered in this browser (IndexedDB),
// so they are still there the next time you open Cutroom.
const DB = 'cutroom', STORE = 'mysounds';

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

// { id, name, type, blob, added }
export const listMySounds = () => run('readonly', s => s.getAll()).then(r => (r || []).sort((a, b) => a.added - b.added)).catch(() => []);
export const saveMySound = item => run('readwrite', s => s.put(item));
export const deleteMySound = id => run('readwrite', s => s.delete(id));
