const DB_NAME = 'rappel_ia';
const STORE = 'reminders';
const timers = new Map();

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
  });
}

async function getAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
  });
}

async function putOne(reminder) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(reminder);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function deleteOne(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function fire(r) {
  await deleteOne(r.id);
  timers.delete(r.id);

  const urgent = r.importance === 'urgent';

  await self.registration.showNotification(
    urgent ? `\uD83D\uDEA8 URGENT : ${r.message}` : `\uD83D\uDD14 ${r.message}`,
    {
      body: urgent
        ? 'Rappel urgent \u2014 Touchez pour ouvrir RappelIA'
        : 'Touchez pour ouvrir RappelIA',
      vibrate: urgent
        ? [300, 100, 300, 100, 300, 100, 600]
        : [300, 100, 300],
      requireInteraction: true,
      renotify: true,
      tag: r.id,
      data: { id: r.id, scope: self.registration.scope }
    }
  );

  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'FIRED', id: r.id }));
}

function schedule(r) {
  if (timers.has(r.id)) return;
  const delay = new Date(r.datetime).getTime() - Date.now();
  if (delay <= 0) {
    fire(r);
    return;
  }
  const t = setTimeout(() => fire(r), delay);
  timers.set(r.id, t);
}

async function rescheduleAll() {
  const all = await getAll();
  const ids = new Set(all.map(r => r.id));
  for (const [id, t] of timers) {
    if (!ids.has(id)) { clearTimeout(t); timers.delete(id); }
  }
  for (const r of all) {
    const delay = new Date(r.datetime).getTime() - Date.now();
    if (delay <= 0) fire(r);
    else schedule(r);
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim().then(rescheduleAll)));

self.addEventListener('message', async e => {
  const { type, reminder, id } = e.data || {};
  if (type === 'ADD') { await putOne(reminder); schedule(reminder); }
  if (type === 'DELETE') {
    await deleteOne(id);
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
  }
  if (type === 'PING') rescheduleAll();
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const alive = cs.find(c => c.visibilityState === 'visible') || cs[0];
      return alive ? alive.focus() : self.clients.openWindow(e.notification.data?.scope || '/');
    })
  );
});
