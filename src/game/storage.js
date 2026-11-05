// Sauvegarde locale : profil du joueur dans localStorage, instantané du monde dans IndexedDB (plus volumineux).
const PROFILE_KEY = 'petri.profile.v1';
const DB_NAME = 'petri', STORE = 'snapshots';

export function loadProfile() {
  try { const s = localStorage.getItem(PROFILE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); return true; } catch (e) { console.warn('Sauvegarde du profil impossible', e); return false; }
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWorldSnapshot(snapshot) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot, 'world');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) { console.warn('Sauvegarde du monde impossible', e); return false; }
}

export async function loadWorldSnapshot() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('world');
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

export async function clearAll() {
  try { localStorage.removeItem(PROFILE_KEY); } catch { /* */ }
  try {
    const db = await openDB();
    await new Promise((resolve) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch { /* */ }
}
