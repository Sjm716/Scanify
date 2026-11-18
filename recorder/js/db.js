// IndexedDB storage for recordings. Each record keeps the video blob, a
// thumbnail and the details shown in the library.
const DB_NAME = 'screen-recorder';
const STORE = 'recordings';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('created', 'created');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage was cancelled'));
  });
}

export const saveRecording = (rec) => run('readwrite', (s) => s.put(rec));
export const getRecording = (id) => run('readonly', (s) => s.get(id));
export const deleteRecording = (id) => run('readwrite', (s) => s.delete(id));
export async function listRecordings() {
  const all = await run('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.created - a.created);
}
