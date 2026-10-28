// IndexedDB persistence for groups and the scans inside them.
//
// groups: { id, name, createdAt, updatedAt, scanIds: string[] }  (scanIds is the page order)
// scans:  { id, groupId, original: Blob, processed: Blob, thumb: Blob,
//           width, height, settings, createdAt }

const DB_NAME = 'scanify';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('scans')) {
          db.createObjectStore('scans', { keyPath: 'id' }).createIndex('groupId', 'groupId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export async function listGroups() {
  const db = await open();
  const groups = await request(db.transaction('groups').objectStore('groups').getAll());
  return groups.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGroup(id) {
  const db = await open();
  return request(db.transaction('groups').objectStore('groups').get(id));
}

/** `extra` adds fields such as { kind: 'gas' } for gas photo sessions. */
export async function createGroup(name, extra = {}) {
  const db = await open();
  const now = Date.now();
  const group = { id: newId(), name, createdAt: now, updatedAt: now, scanIds: [], ...extra };
  const tx = db.transaction('groups', 'readwrite');
  tx.objectStore('groups').put(group);
  await done(tx);
  return group;
}

export async function updateGroup(id, changes) {
  const db = await open();
  const tx = db.transaction('groups', 'readwrite');
  const store = tx.objectStore('groups');
  const group = await request(store.get(id));
  if (!group) throw new Error('Group not found');
  Object.assign(group, changes, { updatedAt: Date.now() });
  store.put(group);
  await done(tx);
  return group;
}

export async function deleteGroup(id) {
  const db = await open();
  const tx = db.transaction(['groups', 'scans'], 'readwrite');
  const scans = tx.objectStore('scans');
  const keys = await request(scans.index('groupId').getAllKeys(id));
  keys.forEach((k) => scans.delete(k));
  tx.objectStore('groups').delete(id);
  await done(tx);
}

/** Puts back a group and its scans exactly as they were (used for Undo). */
export async function restoreGroup(group, scans) {
  const db = await open();
  const tx = db.transaction(['groups', 'scans'], 'readwrite');
  tx.objectStore('groups').put(group);
  scans.forEach((s) => tx.objectStore('scans').put(s));
  await done(tx);
}

export async function getScan(id) {
  const db = await open();
  return request(db.transaction('scans').objectStore('scans').get(id));
}

export async function getScans(group) {
  const db = await open();
  const store = db.transaction('scans').objectStore('scans');
  const scans = await Promise.all(group.scanIds.map((id) => request(store.get(id))));
  return scans.filter(Boolean);
}

/** Inserts or replaces a scan and makes sure its group lists it. */
export async function saveScan(scan) {
  const db = await open();
  const tx = db.transaction(['groups', 'scans'], 'readwrite');
  const groups = tx.objectStore('groups');
  const group = await request(groups.get(scan.groupId));
  if (!group) throw new Error('Group not found');
  if (!group.scanIds.includes(scan.id)) group.scanIds.push(scan.id);
  group.updatedAt = Date.now();
  groups.put(group);
  tx.objectStore('scans').put(scan);
  await done(tx);
  return scan;
}

export async function deleteScan(id) {
  const db = await open();
  const tx = db.transaction(['groups', 'scans'], 'readwrite');
  const scans = tx.objectStore('scans');
  const scan = await request(scans.get(id));
  if (scan) {
    const groups = tx.objectStore('groups');
    const group = await request(groups.get(scan.groupId));
    if (group) {
      group.scanIds = group.scanIds.filter((s) => s !== id);
      group.updatedAt = Date.now();
      groups.put(group);
    }
    scans.delete(id);
  }
  await done(tx);
}

export async function moveScan(id, toGroupId) {
  const db = await open();
  const tx = db.transaction(['groups', 'scans'], 'readwrite');
  const scans = tx.objectStore('scans');
  const groups = tx.objectStore('groups');
  const scan = await request(scans.get(id));
  const to = await request(groups.get(toGroupId));
  if (!scan || !to) throw new Error('Not found');
  if (scan.groupId === toGroupId) return;
  const from = await request(groups.get(scan.groupId));
  const now = Date.now();
  if (from) {
    from.scanIds = from.scanIds.filter((s) => s !== id);
    from.updatedAt = now;
    groups.put(from);
  }
  to.scanIds.push(id);
  to.updatedAt = now;
  groups.put(to);
  scan.groupId = toGroupId;
  scans.put(scan);
  await done(tx);
}
