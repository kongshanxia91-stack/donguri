// ============================================================
// db.js — IndexedDB ラッパー(端末内完結・仕様書5章)
// stores: tasks / logs / goals / achievements / profile / meta
// ============================================================

const DB_NAME = 'donguri-rehab';
const DB_VER = 1;
let _db = null;

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

/** ローカル日付キー YYYY-MM-DD(タイムゾーン安全) */
export function dateKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tasks')) {
        const s = db.createObjectStore('tasks', { keyPath: 'id' });
        s.createIndex('isArchived', 'isArchived');
      }
      if (!db.objectStoreNames.contains('logs')) {
        const s = db.createObjectStore('logs', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('taskId', 'taskId');
        s.createIndex('task_date', ['taskId', 'date'], { unique: true });
      }
      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('achievements')) {
        db.createObjectStore('achievements', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function prom(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

// ---- 汎用 ----
export const put    = (store, val) => tx(store, 'readwrite').then(s => prom(s.put(val)));
export const get    = (store, key) => tx(store).then(s => prom(s.get(key)));
export const del    = (store, key) => tx(store, 'readwrite').then(s => prom(s.delete(key)));
export const all    = (store)      => tx(store).then(s => prom(s.getAll()));
export const clear  = (store)      => tx(store, 'readwrite').then(s => prom(s.clear()));

// ---- Task ----
export async function getTasks({ includeArchived = false } = {}) {
  const list = await all('tasks');
  list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return includeArchived ? list : list.filter(t => !t.isArchived);
}
export function newTask(data) {
  return {
    id: uuid(), title: '', category: '', frequency: 'daily',
    weekdays: [1, 2, 3, 4, 5], timesPerWeek: 3,
    goalId: null, memo: '', isArchived: false,
    createdAt: new Date().toISOString(), sortOrder: Date.now(),
    ...data,
  };
}

// ---- TaskLog ----
export async function getLog(taskId, date) {
  const s = await tx('logs');
  return prom(s.index('task_date').get([taskId, date]));
}
export async function getLogsByDate(date) {
  const s = await tx('logs');
  return prom(s.index('date').getAll(date));
}
export async function getLogsInRange(fromKey, toKey) {
  const s = await tx('logs');
  return prom(s.index('date').getAll(IDBKeyRange.bound(fromKey, toKey)));
}
export async function setLog(taskId, date, completed, note) {
  const existing = await getLog(taskId, date);
  const log = existing ?? { id: uuid(), taskId, date, completed: false, completedAt: null, note: '' };
  log.completed = completed;
  log.completedAt = completed ? new Date().toISOString() : null;
  if (note !== undefined) log.note = note;
  await put('logs', log);
  return log;
}

// ---- Goal ----
export function newGoal(data) {
  return {
    id: uuid(), title: '', type: 'habit',
    targetValue: null, currentValue: null, unit: '',
    startDate: dateKey(), endDate: null, achievedAt: null,
    ...data,
  };
}

// ---- Profile ----
const DEFAULT_PROFILE = {
  id: 'me', squirrelName: 'くるみ', squirrelLevel: 1,
  totalAcorns: 0, currentStreak: 0, longestStreak: 0,
  lastCompletedDate: null, lastStreakDate: null,
  lastOpenDate: null, fontSize: 'normal', theme: 'auto',
  onboarded: false,
};
export async function getProfile() {
  const p = await get('profile', 'me');
  return { ...DEFAULT_PROFILE, ...(p ?? {}) };
}
export async function saveProfile(p) { await put('profile', { ...p, id: 'me' }); return p; }

// ---- バックアップ ----
export async function exportAll() {
  const [tasks, logs, goals, achievements, profile] = await Promise.all([
    all('tasks'), all('logs'), all('goals'), all('achievements'), getProfile(),
  ]);
  return { app: 'donguri-rehab', version: 1, exportedAt: new Date().toISOString(), tasks, logs, goals, achievements, profile };
}
export async function importAll(data) {
  if (data?.app !== 'donguri-rehab') throw new Error('形式が違います');
  await Promise.all(['tasks', 'logs', 'goals', 'achievements'].map(clear));
  for (const t of data.tasks ?? []) await put('tasks', t);
  for (const l of data.logs ?? []) await put('logs', l);
  for (const g of data.goals ?? []) await put('goals', g);
  for (const a of data.achievements ?? []) await put('achievements', a);
  if (data.profile) await saveProfile({ ...DEFAULT_PROFILE, ...data.profile });
}
export async function wipeAll() {
  await Promise.all(['tasks', 'logs', 'goals', 'achievements', 'profile', 'meta'].map(clear));
}
