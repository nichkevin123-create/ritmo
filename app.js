(function () {
'use strict';
/* ── db.js ── */
const __m_db = (() => {
// Capa mínima sobre IndexedDB. Todo vive en el navegador del teléfono.

const DB_NAME = 'ritmo';
const DB_VERSION = 1;
const STORES = { habits: 'id', logs: 'id', blocks: 'id', reflections: 'date', meta: 'key' };

let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB no disponible')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir la base de datos'));
    req.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Error de escritura'));
    tx.onabort = () => reject(tx.error || new Error('Escritura cancelada'));
  });
}

async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await done(tx);
}
const put = (store, value) => putMany(store, [value]);

async function removeMany(store, keys) {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  await done(tx);
}

async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}
const setMeta = (key, value) => put('meta', { key, value });

/** Reemplaza TODO el contenido en una sola transacción atómica (o no cambia nada). */
async function replaceAll({ habits, logs, blocks, reflections, settings }) {
  const db = await openDB();
  const tx = db.transaction(['habits', 'logs', 'blocks', 'reflections', 'meta'], 'readwrite');
  for (const s of ['habits', 'logs', 'blocks', 'reflections']) tx.objectStore(s).clear();
  habits.forEach((v) => tx.objectStore('habits').put(v));
  logs.forEach((v) => tx.objectStore('logs').put(v));
  blocks.forEach((v) => tx.objectStore('blocks').put(v));
  reflections.forEach((v) => tx.objectStore('reflections').put(v));
  tx.objectStore('meta').put({ key: 'settings', value: settings });
  await done(tx);
}

async function wipeAll() {
  const db = await openDB();
  const tx = db.transaction(Object.keys(STORES), 'readwrite');
  for (const s of Object.keys(STORES)) tx.objectStore(s).clear();
  await done(tx);
}

return { openDB, getAll, putMany, removeMany, getMeta, replaceAll, wipeAll, STORES, put, setMeta };
})();

/* ── util.js ── */
const __m_util = (() => {
// Utilidades generales: fechas locales, ids, escape de HTML, SHA-256 y eventos.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

/* ---------- Fechas (siempre locales, formato AAAA-MM-DD) ---------- */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_INI = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIAS_3 = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const todayISO = () => toISO(new Date());
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function diffDays(a, b) {
  const A = parseISO(a), B = parseISO(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
const weekday = (iso) => parseISO(iso).getDay(); // 0 = domingo
/** Lunes de la semana de `iso`. */
function weekStart(iso) { const wd = weekday(iso); return addDays(iso, -((wd + 6) % 7)); }
function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s; }

function fmtDateLong(iso) {
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
function fmtDateShort(iso) {
  const d = parseISO(iso);
  return `${DIAS_3[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
}
function fmtDateTime(isoTs) {
  const d = new Date(isoTs);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* ---------- Horas (HH:MM <-> minutos) ---------- */
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function fromMin(min) { const m = clamp(Math.round(min), 0, 1439); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function durLabel(a, b) {
  const m = toMin(b) - toMin(a);
  if (m <= 0) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}

/* ---------- SHA-256 en JS puro (sirve también sin https) ---------- */
const K256 = (() => {
  const out = []; let n = 2;
  while (out.length < 64) {
    let prime = true;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
    if (prime) { const c = Math.cbrt(n); out.push(Math.floor((c - Math.floor(c)) * 4294967296) >>> 0); }
    n++;
  }
  return out;
})();
const H256 = (() => {
  const out = []; let n = 2;
  while (out.length < 8) {
    let prime = true;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
    if (prime) { const c = Math.sqrt(n); out.push(Math.floor((c - Math.floor(c)) * 4294967296) >>> 0); }
    n++;
  }
  return out;
})();

function sha256(str) {
  const msg = new TextEncoder().encode(str);
  const l = msg.length, total = (((l + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(msg); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((l * 8) / 4294967296));
  dv.setUint32(total - 4, (l * 8) >>> 0);
  const H = H256.slice(), W = new Uint32Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(W[i - 15], 7) ^ rr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rr(W[i - 2], 17) ^ rr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + W[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/* ---------- Delegación de eventos ---------- */
function delegate(root, type, selector, handler) {
  root.addEventListener(type, (ev) => {
    const t = ev.target.closest(selector);
    if (t && root.contains(t)) handler(ev, t);
  });
}

return { uid, esc, clamp, parseISO, addDays, diffDays, weekStart, isISO, fmtDateLong, fmtDateShort, fmtDateTime, cap, toMin, fromMin, nowMin, durLabel, sha256, delegate, $, $$, DIAS, DIAS_INI, DIAS_3, MESES, pad, toISO, todayISO, weekday, isTime };
})();

/* ── schema.js ── */
const __m_schema = (() => {
// Modelo de datos: constantes, valores por defecto y normalizadores (se usan también al importar).
const { isISO, isTime, toMin, clamp, todayISO } = __m_util;

const APP_ID = 'ritmo-habitos';
const SCHEMA_VERSION = 1;

const CATEGORIES = {
  salud: { label: 'Salud', color: 'var(--c-salud)', icon: '🫀' },
  mente: { label: 'Mente', color: 'var(--c-mente)', icon: '🧠' },
  trabajo: { label: 'Trabajo', color: 'var(--c-trabajo)', icon: '💼' },
  vitalidad: { label: 'Vitalidad', color: 'var(--c-vitalidad)', icon: '🔆' },
};
const DIFFICULTY = { 1: 'Fácil', 2: 'Media', 3: 'Difícil' };
const KINDS = {
  fixed: { label: 'Compromiso fijo', short: 'Fijo', color: 'var(--k-fixed)', defaultEnergy: 'medium' },
  deep: { label: 'Trabajo profundo', short: 'Profundo', color: 'var(--k-deep)', defaultEnergy: 'high' },
  recovery: { label: 'Recuperación', short: 'Recuperar', color: 'var(--k-recovery)', defaultEnergy: 'low' },
  task: { label: 'Tarea', short: 'Tarea', color: 'var(--k-task)', defaultEnergy: 'medium' },
};
const ENERGY = {
  high: { label: 'Alta', level: 3, color: 'var(--e-high)' },
  medium: { label: 'Media', level: 2, color: 'var(--e-medium)' },
  low: { label: 'Baja', level: 1, color: 'var(--e-low)' },
};
const HABIT_ICONS = ['💧', '🏃', '🧘', '📖', '✍️', '🥗', '😴', '🚶', '🏋️', '🧠', '🎯', '💼', '📵', '🌅', '🦷', '🧹', '🙏', '🎧', '☀️', '💊', '🍎', '📝', '🧊', '🌿'];

/** Mapa de energía del día por cronotipo: ventanas [desde, hasta) con su nivel. */
const CHRONOTYPES = {
  matutino: {
    label: 'Matutino', hint: 'Rindes más al amanecer',
    map: [['05:00', '12:00', 'high'], ['12:00', '15:00', 'low'], ['15:00', '18:00', 'medium'], ['18:00', '24:00', 'low']],
  },
  intermedio: {
    label: 'Intermedio', hint: 'Pico a media mañana',
    map: [['05:00', '09:00', 'medium'], ['09:00', '13:00', 'high'], ['13:00', '15:00', 'low'], ['15:00', '18:00', 'medium'], ['18:00', '24:00', 'low']],
  },
  nocturno: {
    label: 'Nocturno', hint: 'Arrancas lento y despegas tarde',
    map: [['05:00', '11:00', 'low'], ['11:00', '16:00', 'medium'], ['16:00', '22:00', 'high'], ['22:00', '24:00', 'medium']],
  },
};
const energyMapFor = (key) => (CHRONOTYPES[key] || CHRONOTYPES.intermedio).map.map((w) => ({ from: w[0], to: w[1], level: w[2] }));

function defaultSettings() {
  return { theme: 'auto', chronotype: 'intermedio', energyMap: energyMapFor('intermedio'), firstUseAt: new Date().toISOString(), onboarded: false };
}

/* ---------- Normalizadores: devuelven un registro limpio o null si es inválido ---------- */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ts = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());

function normHabit(h) {
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || !h.id) return null;
  const name = str(h.name, 80);
  if (!name) return null;
  const f = h.freq && typeof h.freq === 'object' ? h.freq : {};
  const type = ['daily', 'days', 'weekly'].includes(f.type) ? f.type : 'daily';
  let days = Array.isArray(f.days) ? [...new Set(f.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (type === 'days' && !days.length) days = [1, 2, 3, 4, 5];
  return {
    id: h.id, name,
    icon: str(h.icon, 8) || '🎯',
    category: CATEGORIES[h.category] ? h.category : 'salud',
    difficulty: [1, 2, 3].includes(h.difficulty) ? h.difficulty : 1,
    freq: { type, days: type === 'days' ? days : [], times: type === 'weekly' ? clamp(parseInt(f.times, 10) || 3, 1, 7) : 0 },
    minimal: str(h.minimal, 120),
    anchorId: typeof h.anchorId === 'string' && h.anchorId ? h.anchorId : null,
    cue: str(h.cue, 120),
    identity: str(h.identity, 120),
    startDate: isISO(h.startDate) ? h.startDate : todayISO(),
    archived: !!h.archived,
    sort: Number.isFinite(h.sort) ? h.sort : 0,
    createdAt: ts(h.createdAt), updatedAt: ts(h.updatedAt),
  };
}

const logId = (habitId, date) => `${habitId}|${date}`;
function normLog(l) {
  if (!l || typeof l !== 'object' || typeof l.habitId !== 'string' || !isISO(l.date)) return null;
  if (l.status !== 'done' && l.status !== 'mini') return null;
  return { id: logId(l.habitId, l.date), habitId: l.habitId, date: l.date, status: l.status, updatedAt: ts(l.updatedAt) };
}

function normBlock(b) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string' || !b.id || !isISO(b.date)) return null;
  if (!isTime(b.start) || !isTime(b.end) || toMin(b.end) <= toMin(b.start)) return null;
  const title = str(b.title, 100);
  if (!title) return null;
  const kind = KINDS[b.kind] ? b.kind : 'task';
  return {
    id: b.id, date: b.date, start: b.start, end: b.end, title, kind,
    energy: ENERGY[b.energy] ? b.energy : KINDS[kind].defaultEnergy,
    done: !!b.done, doneAt: b.done && typeof b.doneAt === 'string' ? b.doneAt : null,
    note: str(b.note, 300),
    seriesId: typeof b.seriesId === 'string' && b.seriesId ? b.seriesId : null,
    updatedAt: ts(b.updatedAt),
  };
}

function normReflection(r) {
  if (!r || typeof r !== 'object' || !isISO(r.date)) return null;
  const out = {
    date: r.date, worked: str(r.worked, 600), drained: str(r.drained, 600), priority: str(r.priority, 300),
    mood: Number.isInteger(r.mood) && r.mood >= 1 && r.mood <= 5 ? r.mood : 0, updatedAt: ts(r.updatedAt),
  };
  return out.worked || out.drained || out.priority || out.mood ? out : null;
}

function normSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  const chrono = CHRONOTYPES[s.chronotype] ? s.chronotype : d.chronotype;
  let map = Array.isArray(s.energyMap)
    ? s.energyMap.filter((w) => w && isTime(w.from) && (isTime(w.to) || w.to === '24:00') && ENERGY[w.level]) : [];
  if (!map.length) map = energyMapFor(chrono);
  return {
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
    chronotype: chrono, energyMap: map,
    firstUseAt: typeof s.firstUseAt === 'string' ? s.firstUseAt : d.firstUseAt,
    onboarded: !!s.onboarded,
  };
}

return { defaultSettings, normHabit, normLog, normBlock, normReflection, normSettings, APP_ID, SCHEMA_VERSION, CATEGORIES, DIFFICULTY, KINDS, ENERGY, HABIT_ICONS, CHRONOTYPES, energyMapFor, logId };
})();

/* ── store.js ── */
const __m_store = (() => {
// Estado de la app. Cada escritura va primero a IndexedDB y luego a memoria.
const db = __m_db;
const { normHabit, normLog, normBlock, normReflection, normSettings, defaultSettings, logId } = __m_schema;
const { uid, todayISO, toMin } = __m_util;

const state = {
  ready: false,
  settings: defaultSettings(),
  habits: [],
  logs: new Map(),
  blocks: [],
  reflections: new Map(),
  lastBackupAt: null,
};

const listeners = new Set();
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
const stamp = () => new Date().toISOString();

/* ---------- Carga ---------- */
function setAll({ settings, habits, logs, blocks, reflections }) {
  state.settings = settings;
  state.habits = habits;
  state.logs = new Map(logs.map((l) => [l.id, l]));
  state.blocks = blocks;
  state.reflections = new Map(reflections.map((r) => [r.date, r]));
}

async function initStore() {
  const [habits, logs, blocks, reflections, settings, lastBackupAt] = await Promise.all([
    db.getAll('habits'), db.getAll('logs'), db.getAll('blocks'), db.getAll('reflections'),
    db.getMeta('settings'), db.getMeta('lastBackupAt'),
  ]);
  setAll({
    settings: normSettings(settings),
    habits: habits.map(normHabit).filter(Boolean),
    logs: logs.map(normLog).filter(Boolean),
    blocks: blocks.map(normBlock).filter(Boolean),
    reflections: reflections.map(normReflection).filter(Boolean),
  });
  state.lastBackupAt = lastBackupAt || null;
  state.ready = true;
}

async function markBackup() {
  const now = stamp();
  await db.setMeta('lastBackupAt', now);
  state.lastBackupAt = now;
  emit();
}

/* ---------- Selectores ---------- */
const habitById = (id) => state.habits.find((h) => h.id === id) || null;
const activeHabits = () => state.habits.filter((h) => !h.archived).sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
const logStatus = (habitId, date) => { const l = state.logs.get(logId(habitId, date)); return l ? l.status : null; };
const blocksOn = (date) => state.blocks.filter((b) => b.date === date).sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end));
const reflectionOn = (date) => state.reflections.get(date) || null;
const hasAnyData = () => state.habits.length > 0 || state.blocks.length > 0 || state.reflections.size > 0;

/* ---------- Ajustes ---------- */
async function saveSettings(patch) {
  const next = normSettings({ ...state.settings, ...patch });
  await db.setMeta('settings', next);
  state.settings = next;
  emit();
}

/* ---------- Hábitos ---------- */
function createsCycle(habit, all) {
  let cur = habit.anchorId; const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === habit.id) return true;
    seen.add(cur);
    const nx = all.find((h) => h.id === cur);
    cur = nx ? nx.anchorId : null;
  }
  return false;
}

async function saveHabit(input) {
  const existing = input.id ? habitById(input.id) : null;
  const now = stamp();
  const h = normHabit({
    ...(existing || {}), ...input,
    id: existing ? existing.id : uid(),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    sort: existing ? existing.sort : state.habits.reduce((m, x) => Math.max(m, x.sort), 0) + 1,
    startDate: existing ? (input.startDate || existing.startDate) : (input.startDate || todayISO()),
  });
  if (!h) throw new Error('El hábito necesita un nombre.');
  if (h.anchorId === h.id || (h.anchorId && !habitById(h.anchorId))) h.anchorId = null;
  if (h.anchorId && createsCycle(h, state.habits)) h.anchorId = null;
  await db.put('habits', h);
  const i = state.habits.findIndex((x) => x.id === h.id);
  if (i >= 0) state.habits[i] = h; else state.habits.push(h);
  emit();
  return h;
}

async function setArchived(id, archived) {
  const h = habitById(id); if (!h) return;
  await saveHabit({ ...h, archived: !!archived });
}

async function deleteHabit(id) {
  const keys = [...state.logs.values()].filter((l) => l.habitId === id).map((l) => l.id);
  const dependants = state.habits.filter((h) => h.anchorId === id).map((h) => ({ ...h, anchorId: null, updatedAt: stamp() }));
  await db.removeMany('logs', keys);
  await db.putMany('habits', dependants);
  await db.removeMany('habits', [id]);
  keys.forEach((k) => state.logs.delete(k));
  dependants.forEach((d) => { const i = state.habits.findIndex((x) => x.id === d.id); if (i >= 0) state.habits[i] = d; });
  state.habits = state.habits.filter((h) => h.id !== id);
  emit();
}

/** status: 'done' | 'mini' | null (quitar la marca). */
async function setHabitStatus(habitId, date, status) {
  const id = logId(habitId, date);
  if (!status) {
    await db.removeMany('logs', [id]);
    state.logs.delete(id);
  } else {
    const l = normLog({ habitId, date, status, updatedAt: stamp() });
    await db.put('logs', l);
    state.logs.set(id, l);
  }
  emit();
}

/* ---------- Itinerario ---------- */
async function saveBlocks(inputs) {
  const now = stamp(); const out = [];
  for (const input of inputs) {
    const existing = input.id ? state.blocks.find((b) => b.id === input.id) : null;
    const b = normBlock({ ...(existing || {}), ...input, id: existing ? existing.id : (input.id || uid()), updatedAt: now });
    if (!b) throw new Error('Revisa el bloque: necesita título y una hora de fin posterior al inicio.');
    out.push(b);
  }
  await db.putMany('blocks', out);
  for (const b of out) {
    const i = state.blocks.findIndex((x) => x.id === b.id);
    if (i >= 0) state.blocks[i] = b; else state.blocks.push(b);
  }
  emit();
  return out;
}
const saveBlock = async (input) => (await saveBlocks([input]))[0];

async function deleteBlock(id) {
  await db.removeMany('blocks', [id]);
  state.blocks = state.blocks.filter((b) => b.id !== id);
  emit();
}

async function toggleBlock(id) {
  const b = state.blocks.find((x) => x.id === id); if (!b) return;
  await saveBlock({ ...b, done: !b.done, doneAt: !b.done ? stamp() : null });
}

/** Copia los bloques de un día a otro (sin duplicar los que ya existen igual). */
async function copyDay(fromDate, toDate) {
  const src = blocksOn(fromDate), dst = blocksOn(toDate);
  const same = (a, b) => a.start === b.start && a.end === b.end && a.title === b.title;
  const fresh = src.filter((s) => !dst.some((d) => same(s, d)))
    .map((s) => ({ ...s, id: uid(), date: toDate, done: false, doneAt: null, seriesId: null }));
  if (fresh.length) await saveBlocks(fresh);
  return fresh.length;
}

/* ---------- Reflexión ---------- */
async function saveReflection(input) {
  const r = normReflection({ ...input, updatedAt: stamp() });
  if (!r) {
    await db.removeMany('reflections', [input.date]);
    state.reflections.delete(input.date);
  } else {
    await db.put('reflections', r);
    state.reflections.set(r.date, r);
  }
  emit();
  return r;
}

/* ---------- Borrado total ---------- */
async function wipeEverything() {
  await db.wipeAll();
  setAll({ settings: { ...defaultSettings(), onboarded: true }, habits: [], logs: [], blocks: [], reflections: [] });
  await db.setMeta('settings', state.settings);
  emit();
}

return { subscribe, emit, setAll, initStore, markBackup, saveSettings, saveHabit, setArchived, deleteHabit, setHabitStatus, saveBlocks, deleteBlock, toggleBlock, copyDay, saveReflection, wipeEverything, state, habitById, activeHabits, logStatus, blocksOn, reflectionOn, hasAnyData, saveBlock };
})();

/* ── session.js ── */
const __m_session = (() => {
// Estado de la sesión de pantalla (no se guarda): pestaña, fechas elegidas y filtros.
const { todayISO } = __m_util;

const session = {
  tab: 'hoy',
  dateHoy: todayISO(),
  datePlan: todayISO(),
  dateRef: todayISO(),
  filter: 'all',
  go: () => {},          // lo asigna app.js
  refresh: () => {},     // lo asigna app.js
};

const TABS = ['hoy', 'habitos', 'plan', 'reflexion', 'progreso'];

/** Si la app estuvo abierta de un día para otro, vuelve a «hoy». */
function syncToday() {
  const t = todayISO();
  if (session.lastToday && session.lastToday !== t) {
    session.dateHoy = t; session.datePlan = t; session.dateRef = t;
  }
  session.lastToday = t;
}

return { syncToday, session, TABS };
})();

/* ── ui.js ── */
const __m_ui = (() => {
// Piezas de interfaz compartidas: iconos, hojas modales, avisos y confirmaciones.
const { esc, $ } = __m_util;

const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICONS = {
  today: P('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
  habits: P('<path d="M4 6h16M4 12h10M4 18h6"/><path d="m16 15 2 2 4-4"/>'),
  plan: P('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  reflect: P('<path d="M5 4h11a3 3 0 0 1 3 3v13l-4-3H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 9h7M8 13h4"/>'),
  stats: P('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  left: P('<path d="m15 5-7 7 7 7"/>'),
  right: P('<path d="m9 5 7 7-7 7"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  copy: P('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  download: P('<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/>'),
};
const icon = (n) => ICONS[n] || '';

const energyIcon = (level) => `<span class="energy ${level}" aria-hidden="true"><i></i><i></i><i></i></span>`;

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 5000 : 2600);
}

/* ---------- Hojas modales (se apilan; el botón «atrás» del teléfono las cierra) ---------- */
const stack = [];
let suppressPop = 0;
const pending = [];

/** Si todavía se está retrocediendo el historial por un cierre, abrir otra hoja se aplaza hasta que termine. */
function settle() { suppressPop = 0; pending.splice(0).forEach((fn) => fn()); }

function openSheet(opts) {
  if (suppressPop > 0) { pending.push(() => openSheet(opts)); return null; }
  const { title, html, onMount, onClose } = opts;
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab"></div>
    <div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('close')}</button></div>
    <div class="sheet-b">${html}</div></section>`;
  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';
  const entry = { back, onClose, closed: false };
  stack.push(entry);
  history.pushState({ sheet: stack.length }, '');
  const close = () => closeTop(true);
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  const body = $('.sheet-b', back);
  if (onMount) onMount(body, { close: () => closeEntry(entry) });
  return { el: body, close: () => closeEntry(entry) };
}

function finish(entry) {
  if (entry.closed) return;
  entry.closed = true;
  entry.back.remove();
  const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1);
  if (!stack.length) document.body.style.overflow = '';
  if (entry.onClose) entry.onClose();
}
/** Cierra desde la interfaz: retrocede el historial para que no sobren entradas. */
function closeEntry(entry) {
  if (entry.closed) return;
  const isTop = stack[stack.length - 1] === entry;
  finish(entry);
  if (isTop) { suppressPop++; history.back(); setTimeout(() => { if (suppressPop > 0) settle(); }, 500); }
}
function closeTop() { const e = stack[stack.length - 1]; if (e) closeEntry(e); }

window.addEventListener('popstate', () => {
  if (suppressPop > 0) { suppressPop--; if (suppressPop === 0) setTimeout(settle, 0); return; }
  const e = stack[stack.length - 1];
  if (e) finish(e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) { e.preventDefault(); closeTop(); } });
const sheetsOpen = () => stack.length;
function closeAllSheets() { while (stack.length) closeTop(); }

/** Confirmación con botones claros. Devuelve una promesa con true/false. */
function confirmSheet({ title, message, ok = 'Confirmar', danger = false, cancel = 'Cancelar' }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      html: `<p>${message}</p><div class="actions">
        <button class="btn ${danger ? 'danger' : 'primary'} block" data-yes>${esc(ok)}</button>
        <button class="btn block" data-no>${esc(cancel)}</button></div>`,
      onMount: (el, { close }) => {
        el.querySelector('[data-yes]').onclick = () => { answered = true; close(); resolve(true); };
        el.querySelector('[data-no]').onclick = () => { answered = true; close(); resolve(false); };
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------- Ayudantes de formulario ---------- */
function pressedGroup(root, selector, onChange) {
  root.querySelectorAll(selector).forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (onChange) onChange(btn.dataset.v);
    });
  });
}
const pressedValue = (root, selector) => root.querySelector(selector + '[aria-pressed="true"]')?.dataset.v || null;

return { toast, openSheet, closeAllSheets, confirmSheet, pressedGroup, ICONS, icon, energyIcon, sheetsOpen, pressedValue };
})();

/* ── backup.js ── */
const __m_backup = (() => {
// Respaldo y migración: un único archivo JSON con checksum SHA-256.
const { APP_ID, SCHEMA_VERSION, normHabit, normLog, normBlock, normReflection, normSettings } = __m_schema;
const { sha256, pad } = __m_util;
const db = __m_db;
const { state, setAll, emit, markBackup } = __m_store;

const byKey = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);

/** Forma canónica y ordenada: el mismo contenido siempre produce el mismo checksum. */
function canonical(d) {
  return {
    settings: d.settings,
    habits: [...d.habits].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1)),
    logs: [...d.logs].sort(byKey((l) => l.id)),
    blocks: [...d.blocks].sort(byKey((b) => `${b.date} ${b.start} ${b.id}`)),
    reflections: [...d.reflections].sort(byKey((r) => r.date)),
  };
}

function snapshotData() {
  return canonical({
    settings: state.settings,
    habits: state.habits,
    logs: [...state.logs.values()],
    blocks: state.blocks,
    reflections: [...state.reflections.values()],
  });
}

function buildBackup(data = snapshotData()) {
  const json = JSON.stringify(data);
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: { habits: data.habits.length, logs: data.logs.length, blocks: data.blocks.length, reflections: data.reflections.length },
    checksum: 'sha256:' + sha256(json),
    data,
  };
}

function backupFilename(d = new Date()) {
  return `ritmo-respaldo-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** Normaliza y repara: descarta lo inválido, quita duplicados y rompe referencias huérfanas. */
function sanitize(raw) {
  let dropped = 0;
  const take = (arr, fn, key) => {
    const out = new Map();
    for (const x of Array.isArray(arr) ? arr : []) {
      const n = fn(x);
      if (!n) { dropped++; continue; }
      out.set(key(n), n);
    }
    return out;
  };
  const habits = take(raw.habits, normHabit, (h) => h.id);
  const logs = take(raw.logs, normLog, (l) => l.id);
  for (const [k, l] of logs) if (!habits.has(l.habitId)) { logs.delete(k); dropped++; }
  for (const [id, h] of habits) {
    if (h.anchorId && (!habits.has(h.anchorId) || h.anchorId === id)) habits.set(id, { ...h, anchorId: null });
  }
  const blocks = take(raw.blocks, normBlock, (b) => b.id);
  const reflections = take(raw.reflections, normReflection, (r) => r.date);
  return {
    data: canonical({ settings: normSettings(raw.settings), habits: [...habits.values()], logs: [...logs.values()], blocks: [...blocks.values()], reflections: [...reflections.values()] }),
    dropped,
  };
}

/** Lee un archivo de respaldo: distingue «no es JSON», «no es de Ritmo» y «de una versión más nueva». */
function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'no_json', message: 'El archivo no es un JSON válido. ¿Elegiste el archivo correcto?' }; }
  if (!obj || obj.app !== APP_ID || typeof obj.data !== 'object' || obj.data === null) {
    return { ok: false, error: 'no_ritmo', message: 'Este archivo no es un respaldo de Ritmo.' };
  }
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'newer', message: 'Este respaldo viene de una versión más nueva de Ritmo. Actualiza la app primero.' };
  }
  let integrity = 'missing';
  if (typeof obj.checksum === 'string') integrity = obj.checksum === 'sha256:' + sha256(JSON.stringify(obj.data)) ? 'ok' : 'mismatch';
  const { data, dropped } = sanitize(obj.data);
  return {
    ok: true, integrity, dropped, data, exportedAt: obj.exportedAt || null,
    counts: { habits: data.habits.length, logs: data.logs.length, blocks: data.blocks.length, reflections: data.reflections.length },
  };
}

/** Combinar: agrega lo que falta; si existe en ambos gana el más reciente. Nunca borra nada. */
function mergeData(cur, inc) {
  const stats = { added: 0, updated: 0 };
  const mergeBy = (a, b, key) => {
    const m = new Map(a.map((x) => [key(x), x]));
    for (const x of b) {
      const k = key(x), ex = m.get(k);
      if (!ex) { m.set(k, x); stats.added++; } else if ((x.updatedAt || '') > (ex.updatedAt || '')) { m.set(k, x); stats.updated++; }
    }
    return [...m.values()];
  };
  return {
    stats,
    data: sanitize({
      settings: cur.settings,
      habits: mergeBy(cur.habits, inc.habits, (h) => h.id),
      logs: mergeBy(cur.logs, inc.logs, (l) => l.id),
      blocks: mergeBy(cur.blocks, inc.blocks, (b) => b.id),
      reflections: mergeBy(cur.reflections, inc.reflections, (r) => r.date),
    }).data,
  };
}

/** Relee TODO desde IndexedDB y compara con lo que debía quedar guardado. */
async function verifyAgainst(expected) {
  const [habits, logs, blocks, reflections, settings] = await Promise.all([
    db.getAll('habits'), db.getAll('logs'), db.getAll('blocks'), db.getAll('reflections'), db.getMeta('settings'),
  ]);
  const stored = canonical({ settings: normSettings(settings), habits, logs, blocks, reflections });
  return sha256(JSON.stringify(stored)) === sha256(JSON.stringify(canonical(expected)));
}

async function applyImport(parsed, mode) {
  const before = snapshotData();
  let data = parsed.data, stats = null;
  if (mode === 'merge') { const m = mergeData(before, parsed.data); data = m.data; stats = m.stats; }
  else data = { ...parsed.data, settings: { ...parsed.data.settings, onboarded: true } };
  await db.setMeta('undoSnapshot', { at: new Date().toISOString(), data: before });
  await db.replaceAll(data);
  setAll({ settings: data.settings, habits: data.habits, logs: data.logs, blocks: data.blocks, reflections: data.reflections });
  const verified = await verifyAgainst(data);
  emit();
  return { verified, stats, counts: { habits: data.habits.length, logs: data.logs.length, blocks: data.blocks.length, reflections: data.reflections.length } };
}

async function hasUndo() { return !!(await db.getMeta('undoSnapshot')); }

async function undoLastImport() {
  const snap = await db.getMeta('undoSnapshot');
  if (!snap) return false;
  const { data } = sanitize(snap.data);
  await db.replaceAll(data);
  setAll({ settings: data.settings, habits: data.habits, logs: data.logs, blocks: data.blocks, reflections: data.reflections });
  await db.setMeta('undoSnapshot', undefined);
  emit();
  return true;
}

/** Entrega el archivo: menú «Compartir» del teléfono si existe; si no, descarga normal. */
async function deliverFile(name, text, mime = 'application/json') {
  const file = new File([text], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Respaldo de Ritmo' }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

async function exportBackup() {
  const backup = buildBackup();
  const result = await deliverFile(backupFilename(), JSON.stringify(backup, null, 1));
  if (result !== 'cancelled') await markBackup();
  return { result, counts: backup.counts };
}

return { canonical, snapshotData, buildBackup, backupFilename, sanitize, parseBackup, mergeData, verifyAgainst, applyImport, hasUndo, undoLastImport, deliverFile, exportBackup };
})();

/* ── calc.js ── */
const __m_calc = (() => {
// Cálculos puros: cumplimiento, rachas flexibles, energía y métricas del dashboard.
const { state, activeHabits, logStatus, blocksOn } = __m_store;
const { ENERGY } = __m_schema;
const { addDays, weekday, weekStart, toMin, fromMin, todayISO } = __m_util;

const isDone = (habitId, date) => logStatus(habitId, date) !== null;

/** ¿Toca este hábito ese día? (los semanales «N veces» se pueden hacer cualquier día). */
function isScheduled(h, date) {
  if (date < h.startDate) return false;
  if (h.freq.type === 'daily') return true;
  if (h.freq.type === 'days') return h.freq.days.includes(weekday(date));
  return true;
}
const isQuota = (h) => h.freq.type === 'weekly';

function weekCount(h, anyDateInWeek) {
  const ws = weekStart(anyDateInWeek); let n = 0;
  for (let i = 0; i < 7; i++) if (isDone(h.id, addDays(ws, i))) n++;
  return n;
}

function freqLabel(h) {
  if (h.freq.type === 'daily') return 'Todos los días';
  if (h.freq.type === 'weekly') return `${h.freq.times} veces por semana`;
  const names = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const d = h.freq.days;
  if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'Lunes a viernes';
  return [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x)).map((x) => names[x]).join(' · ');
}

/**
 * Racha flexible: un día fallado se perdona («nunca falles dos veces»); dos seguidos la rompen.
 * Hoy sin marcar todavía no cuenta como fallo. Para hábitos «N veces por semana» se cuenta en semanas.
 */
function streakOf(h, today = todayISO()) {
  const unit = isQuota(h) ? 'semanas' : 'días';
  const hits = [];
  if (isQuota(h)) {
    const thisWeek = weekStart(today);
    for (let ws = weekStart(h.startDate); ws <= thisWeek; ws = addDays(ws, 7)) {
      const met = weekCount(h, ws) >= h.freq.times;
      if (ws === thisWeek && !met) continue; // semana en curso: aún pendiente
      hits.push(met);
    }
  } else {
    for (let d = h.startDate; d <= today; d = addDays(d, 1)) {
      if (!isScheduled(h, d)) continue;
      const ok = isDone(h.id, d);
      if (d === today && !ok) continue; // hoy pendiente
      hits.push(ok);
    }
  }
  let cur = 0, miss = 0, best = 0;
  for (const ok of hits) {
    if (ok) { cur++; miss = 0; if (cur > best) best = cur; } else { miss++; if (miss >= 2) cur = 0; }
  }
  return { current: cur, best, unit, atRisk: cur > 0 && miss === 1, total: hits.filter(Boolean).length };
}

/* ---------- Cumplimiento ---------- */
/** Cumplimiento del día: hábitos que tocaban (+ los «N por semana» que sí hiciste, como bonus). */
function dayCompletion(date, habits = activeHabits()) {
  let total = 0, done = 0;
  for (const h of habits) {
    const ok = isDone(h.id, date);
    if (isQuota(h)) { if (ok && date >= h.startDate) { total++; done++; } continue; }
    if (isScheduled(h, date)) { total++; if (ok) done++; }
  }
  return { total, done, pct: total ? done / total : null };
}

function rangeCompletion(from, to, habits = activeHabits()) {
  let total = 0, done = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const c = dayCompletion(d, habits); total += c.total; done += c.done; }
  return { total, done, pct: total ? done / total : null };
}

function habitRate(h, from, to) {
  if (isQuota(h)) {
    let exp = 0, got = 0;
    for (let ws = weekStart(from); ws <= weekStart(to); ws = addDays(ws, 7)) {
      if (addDays(ws, 6) < h.startDate || ws > to) continue;
      exp += h.freq.times; got += Math.min(weekCount(h, ws), h.freq.times);
    }
    return exp ? got / exp : null;
  }
  let sch = 0, ok = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { if (!isScheduled(h, d)) continue; sch++; if (isDone(h.id, d)) ok++; }
  return sch ? ok / sch : null;
}

function categoryRates(from, to) {
  const out = {};
  for (const h of activeHabits()) {
    const r = habitRate(h, from, to); if (r === null) continue;
    (out[h.category] ||= []).push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}

/** Matriz de intensidad por día para el mapa de calor (últimas `weeks` semanas, lunes a domingo). */
function heatmapDays(weeks, today = todayISO(), habit = null) {
  const start = addDays(weekStart(today), -7 * (weeks - 1)); const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    if (date > today) { cells.push({ date, level: -1 }); continue; }
    if (habit) {
      const st = logStatus(habit.id, date);
      cells.push({ date, level: st === 'done' ? 4 : st === 'mini' ? 2 : (isScheduled(habit, date) && !isQuota(habit) ? 0 : -2), status: st });
    } else {
      const c = dayCompletion(date);
      cells.push({ date, level: c.pct === null ? -2 : c.pct === 0 ? 0 : c.pct < 0.5 ? 1 : c.pct < 0.8 ? 2 : c.pct < 1 ? 3 : 4, pct: c.pct });
    }
  }
  return cells;
}

/* ---------- Itinerario ---------- */
function blockStats(from, to, today = todayISO()) {
  let total = 0, done = 0; const byKind = {};
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    for (const b of blocksOn(d)) {
      total++; if (b.done) done++;
      const k = (byKind[b.kind] ||= { total: 0, done: 0 }); k.total++; if (b.done) k.done++;
    }
  }
  return { total, done, pct: total ? done / total : null, byKind };
}

/** Planificado vs. hecho, en minutos de trabajo profundo (la métrica que más mueve la aguja). */
function deepMinutes(from, to, today = todayISO()) {
  let planned = 0, done = 0;
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    for (const b of blocksOn(d)) {
      if (b.kind !== 'deep') continue;
      const m = toMin(b.end) - toMin(b.start); planned += m; if (b.done) done += m;
    }
  }
  return { planned, done };
}

/* ---------- Energía ---------- */
function energyAt(min, map = state.settings.energyMap) {
  for (const w of map) {
    const a = toMin(w.from), b = w.to === '24:00' ? 1440 : toMin(w.to);
    if (min >= a && min < b) return w.level;
  }
  return 'low';
}

/** 2 = coincide con tu ventana de energía, 1 = cerca, 0 = opuesto. Los compromisos fijos no se mueven: no puntúan. */
function alignScore(block, map = state.settings.energyMap) {
  if (block.kind === 'fixed') return null;
  const win = ENERGY[energyAt(toMin(block.start), map)].level, need = ENERGY[block.energy].level;
  const gap = Math.abs(win - need);
  return gap === 0 ? 2 : gap === 1 ? 1 : 0;
}

function alignmentRate(from, to, today = todayISO()) {
  let pts = 0, n = 0;
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    for (const b of blocksOn(d)) { const s = alignScore(b); if (s === null) continue; pts += s; n++; }
  }
  return n ? pts / (2 * n) : null;
}

/** Primera hora de una ventana con el nivel pedido, para sugerir «mueve este bloque a…». */
function suggestStart(energy, map = state.settings.energyMap) {
  const w = map.find((x) => x.level === energy);
  return w ? w.from : null;
}

function overlaps(blocks) {
  const bad = new Set();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (toMin(blocks[i].start) < toMin(blocks[j].end) && toMin(blocks[j].start) < toMin(blocks[i].end)) { bad.add(blocks[i].id); bad.add(blocks[j].id); }
    }
  }
  return bad;
}

/** Hueco libre más largo del día entre 06:00 y 22:00 (para sugerir dónde meter un bloque). */
function freeSlots(date, minLen = 30) {
  const bs = blocksOn(date); const slots = []; let cur = 360;
  for (const b of bs) {
    const s = toMin(b.start), e = toMin(b.end);
    if (s - cur >= minLen) slots.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (1320 - cur >= minLen) slots.push([cur, 1320]);
  return slots.map(([a, b]) => ({ start: fromMin(a), end: fromMin(b) }));
}

/* ---------- Lecturas didácticas del dashboard ---------- */
function insights(today = todayISO()) {
  const out = [];
  const habits = activeHabits();
  if (!habits.length) return out;
  const from8 = addDays(weekStart(today), -49);
  const byWd = Array.from({ length: 7 }, () => ({ t: 0, d: 0 }));
  for (let d = from8; d <= today; d = addDays(d, 1)) { const c = dayCompletion(d); const w = byWd[weekday(d)]; w.t += c.total; w.d += c.done; }
  const names = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ranked = byWd.map((w, i) => ({ i, p: w.t >= 4 ? w.d / w.t : null })).filter((x) => x.p !== null).sort((a, b) => b.p - a.p);
  if (ranked.length >= 3) {
    out.push({ icon: '📈', text: `Tu mejor día es el ${names[ranked[0].i]} (${Math.round(ranked[0].p * 100)} %).` });
    const worst = ranked[ranked.length - 1];
    if (worst.p < ranked[0].p - 0.15) out.push({ icon: '🛟', text: `El ${names[worst.i]} es tu día frágil (${Math.round(worst.p * 100)} %): ese día usa solo la versión de 2 minutos.` });
  }
  const from30 = addDays(today, -29);
  const rated = habits.map((h) => ({ h, r: habitRate(h, from30, today) })).filter((x) => x.r !== null);
  if (rated.length >= 2) {
    const weak = rated.sort((a, b) => a.r - b.r)[0];
    if (weak.r < 0.6) out.push({ icon: '🔧', text: `«${weak.h.name}» es tu hábito más frágil (${Math.round(weak.r * 100)} %). Hazlo más pequeño o ánclalo a otro que ya cumples.` });
  }
  const risk = habits.filter((h) => streakOf(h, today).atRisk);
  if (risk.length) out.push({ icon: '⚠️', text: `Racha en riesgo: ${risk.slice(0, 2).map((h) => `«${h.name}»`).join(' y ')}. Falló una vez: hoy no falles la segunda.` });
  const al = alignmentRate(addDays(today, -6), today);
  if (al !== null && al < 0.6) out.push({ icon: '⚡', text: 'Varios bloques no coinciden con tu energía natural. Mueve el trabajo profundo a tu ventana de energía alta.' });
  return out;
}

function reflectionStreak(today = todayISO()) {
  let n = 0, d = state.reflections.has(today) ? today : addDays(today, -1);
  while (state.reflections.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

return { isScheduled, weekCount, freqLabel, streakOf, dayCompletion, rangeCompletion, habitRate, categoryRates, heatmapDays, blockStats, deepMinutes, energyAt, alignScore, alignmentRate, suggestStart, overlaps, freeSlots, insights, reflectionStreak, isQuota };
})();

/* ── content.js ── */
const __m_content = (() => {
// Textos de coaching, hábitos de arranque y glosario. Todo es contenido estático propio.

/** Hábitos sugeridos para empezar: todos con versión de 2 minutos. */
const STARTERS = [
  { name: 'Beber un vaso de agua al despertar', icon: '💧', category: 'salud', difficulty: 1, minimal: 'Beber un sorbo', identity: 'Soy una persona que cuida su cuerpo', cue: 'Al levantarme' },
  { name: 'Respirar con calma', icon: '🧘', category: 'mente', difficulty: 1, minimal: '3 respiraciones profundas', identity: 'Soy una persona serena', cue: '' },
  { name: 'Leer unas páginas', icon: '📖', category: 'mente', difficulty: 1, minimal: 'Leer una sola página', identity: 'Soy una persona que aprende cada día', cue: 'En la cama, antes de dormir' },
  { name: 'Caminar o moverme', icon: '🚶', category: 'vitalidad', difficulty: 2, minimal: 'Ponerme los zapatos y salir a la puerta', identity: 'Soy una persona activa', cue: '' },
  { name: 'Un bloque de trabajo profundo', icon: '🎯', category: 'trabajo', difficulty: 3, minimal: 'Trabajar 10 minutos sin distracciones', identity: 'Soy una persona que termina lo importante', cue: 'Primera hora de trabajo' },
  { name: 'Planificar el día de mañana', icon: '📝', category: 'trabajo', difficulty: 1, minimal: 'Escribir solo la prioridad de mañana', identity: 'Soy una persona que dirige su día', cue: 'Al cerrar la jornada' },
];

const QUESTIONS = [
  { key: 'worked', label: '¿Qué funcionó hoy?', hint: 'Un logro, una decisión acertada, algo que repetirías. Por pequeño que sea.', ph: 'Hoy funcionó…' },
  { key: 'drained', label: '¿Dónde perdí energía?', hint: 'Una reunión, una distracción, una hora del día. Sin juzgarte: solo detectar el patrón.', ph: 'Perdí energía en…' },
  { key: 'priority', label: '¿Cuál es mi prioridad innegociable de mañana?', hint: 'Una sola cosa. Mañana aparecerá primero en tu pantalla de «Hoy».', ph: 'Mañana lo innegociable es…' },
];
const MOODS = [['😣', 'Muy cansado'], ['😕', 'Bajo'], ['😐', 'Normal'], ['🙂', 'Bien'], ['😄', 'Excelente']];

const GREETINGS = [
  [5, 12, 'Buenos días'], [12, 19, 'Buenas tardes'], [19, 24, 'Buenas noches'], [0, 5, 'Buenas noches'],
];
const greeting = (hour) => (GREETINGS.find(([a, b]) => hour >= a && hour < b) || GREETINGS[0])[2];

const NUDGES = [
  'Un hábito pequeño que haces siempre vale más que uno grande que haces a veces.',
  'No tienes que sentir ganas. Solo empieza la versión de 2 minutos.',
  'Cada ✓ es un voto por la persona que quieres ser.',
  'Fallar un día es un accidente. Fallar dos es el comienzo de un nuevo hábito: no falles dos veces.',
  'Diseña tu entorno: lo fácil de hacer se repite, lo difícil se abandona.',
  'Tu energía es un recurso: pon lo importante en tu mejor ventana del día.',
  'Mide progreso, no perfección. Un 70 % constante le gana a un 100 % que dura una semana.',
];

/** Guía didáctica dentro de la app («Aprende»). `html` es contenido fijo, no escribe el usuario. */
const TIPS = [
  {
    id: 'empezar', title: 'Cómo empezar sin abrumarte (primera semana)',
    html: `<p><b>Regla de oro: empieza ridículamente pequeño.</b> Esta semana solo necesitas <b>1 hábito</b> y su <b>versión de 2 minutos</b>.</p>
      <ol><li>Elige <b>un</b> hábito que te importe de verdad (no cinco).</li>
      <li>Escribe su versión mínima: «leer una página», «ponerme los zapatos», «escribir una línea».</li>
      <li>Anclalo a algo que ya haces sin pensar (café, cepillarte los dientes).</li>
      <li>Marca ✓ cada vez. Si un día solo hiciste la versión mínima, usa el botón <b>2′</b>: <b>cuenta</b> igual.</li></ol>
      <p>Cuando lleves 7–10 días sin esfuerzo, sube un escalón o agrega el segundo hábito. Nunca más de uno a la vez.</p>`,
  },
  {
    id: 'dos-minutos', title: 'La regla de los 2 minutos',
    html: `<p>Cualquier hábito se puede reducir a algo que tome <b>menos de 2 minutos</b>. El objetivo al inicio no es el resultado: es <b>aparecer</b>.</p>
      <p>Correr 5 km → atarte las zapatillas. Estudiar una hora → abrir el libro y leer un párrafo. Meditar 20 min → 3 respiraciones. Ya empezaste, y empezar es el 80 % de la batalla; si hay ganas, sigues.</p>`,
  },
  {
    id: 'rachas', title: 'Rachas flexibles: constancia sin castigo',
    html: `<p>Tu racha <b>perdona un día fallado</b>: si fallas uno, la racha sigue viva (queda en amarillo, «en riesgo»). Si fallas <b>dos seguidos</b>, se reinicia, pero tu <b>mejor racha</b> queda guardada.</p>
      <p>La regla de fondo: <b>nunca falles dos veces</b>. Un tropiezo es un dato, no un veredicto. Los días en que no toca (por ejemplo, hábitos de lunes a viernes) no cuentan como fallo.</p>`,
  },
  {
    id: 'anclaje', title: 'Anclaje de hábitos (habit stacking)',
    html: `<p>La fórmula: <b>«Después de [hábito actual], haré [hábito nuevo]»</b>. Lo que ya haces es el disparador del nuevo.</p>
      <p>Ejemplo: «Después de servirme el café, escribo mi prioridad del día». En la app, al crear un hábito elige «Después de…» y aparecerá enlazado debajo del que le sirve de ancla.</p>`,
  },
  {
    id: 'identidad', title: 'Identidad: cada ✓ es un voto',
    html: `<p>Los hábitos duraderos nacen de <b>quién quieres ser</b>, no de qué quieres lograr. En lugar de «quiero correr un maratón», piensa «soy una persona activa».</p>
      <p>Escribe una frase de identidad en cada hábito. Cada vez que marcas ✓ estás emitiendo un voto a favor de esa identidad; no necesitas unanimidad, solo mayoría.</p>`,
  },
  {
    id: 'energia', title: 'Energía: pon lo importante en tu mejor hora',
    html: `<p>No todas las horas valen lo mismo. Elige tu <b>cronotipo</b> en Ajustes y Ritmo dibujará tu <b>mapa de energía</b> del día.</p>
      <ul><li><b>Energía alta</b> → trabajo profundo, decisiones difíciles, lo creativo.</li>
      <li><b>Energía media</b> → reuniones, tareas operativas, planificación.</li>
      <li><b>Energía baja</b> → correos, trámites, orden, recuperación.</li></ul>
      <p>En «Análisis» verás tu <b>alineación de energía</b>: qué tanto de tu plan coincide con tus ritmos naturales.</p>`,
  },
  {
    id: 'bloques', title: 'Time blocking: tu día en bloques',
    html: `<p>Un bloque es una cita contigo mismo. Combina tres tipos: <b>compromisos fijos</b> (no se mueven), <b>trabajo profundo</b> (90–120 min sin interrupciones) y <b>recuperación</b> (pausas reales, comida, caminata).</p>
      <p>Consejos: máximo <b>1–2 bloques de trabajo profundo</b> por día; deja <b>colchón</b> entre bloques; si un bloque se cae, muévelo, no lo borres con culpa. Planifica mañana en tu check-in nocturno.</p>`,
  },
  {
    id: 'checkin', title: 'El check-in nocturno (3 minutos)',
    html: `<p>Responde las 3 preguntas cada noche, aunque sea con una frase:</p>
      <ol><li><b>¿Qué funcionó hoy?</b> Entrena el cerebro a ver avances.</li>
      <li><b>¿Dónde perdí energía?</b> Detecta fugas sin culparte.</li>
      <li><b>¿Cuál es mi prioridad innegociable de mañana?</b> Mañana aparece primero en «Hoy».</li></ol>
      <p>Una vez por semana, relee tus últimas respuestas: ahí están tus patrones.</p>`,
  },
  {
    id: 'metricas', title: 'Cómo leer tus métricas',
    html: `<ul><li><b>Cumplimiento de hábitos</b>: hábitos hechos ÷ hábitos que tocaban. El 2′ cuenta como hecho.</li>
      <li><b>Efectividad del itinerario</b>: bloques completados ÷ bloques planificados (solo días ya ocurridos).</li>
      <li><b>Alineación de energía</b>: qué tan bien coinciden tus bloques con tu mapa de energía (los compromisos fijos no puntúan).</li>
      <li><b>Mapa de calor</b>: cuanto más oscuro, mejor el día. Busca <b>constancia</b>, no días perfectos.</li></ul>
      <p>Referencia: 70–80 % sostenido es excelente. Si bajas de 50 %, el hábito está demasiado grande: redúcelo.</p>`,
  },
];

return { STARTERS, QUESTIONS, MOODS, GREETINGS, greeting, NUDGES, TIPS };
})();

/* ── charts.js ── */
const __m_charts = (() => {
// Gráficos propios en SVG/HTML: sin librerías, con etiquetas accesibles.
const { esc, toMin, DIAS_INI, parseISO, addDays, weekStart, fmtDateShort, MESES } = __m_util;
const { heatmapDays } = __m_calc;
const { KINDS, ENERGY } = __m_schema;

/** Mapa de calor estilo calendario: columnas = semanas (lunes a domingo). */
function heatmapHTML(weeks, today, habit = null) {
  const cells = heatmapDays(weeks, today, habit);
  const html = cells.map((c) => {
    const label = c.level === -1 ? '' : habit
      ? `${fmtDateShort(c.date)}: ${c.status === 'done' ? 'hecho' : c.status === 'mini' ? 'versión mínima' : 'sin marcar'}`
      : `${fmtDateShort(c.date)}: ${c.pct === null || c.pct === undefined ? 'sin hábitos' : Math.round(c.pct * 100) + ' %'}`;
    return `<i data-l="${c.level}" class="${c.date === today ? 'today' : ''}" title="${esc(label)}" aria-label="${esc(label)}"></i>`;
  }).join('');
  return `<div class="heat" style="grid-template-columns:repeat(${weeks},1fr)" role="img" aria-label="Mapa de calor de las últimas ${weeks} semanas">${html}</div>
    <div class="legend" style="margin-top:8px"><span>Menos</span>${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--h${l})"></i>`).join('')}<span>Más</span></div>`;
}

/** Barras de los últimos días (0–100 %). `items`: [{label, pct, today}] */
function barsSVG(items, { height = 120 } = {}) {
  const W = 320, H = height, pad = 22, bw = (W - 20) / items.length;
  const bars = items.map((it, i) => {
    const x = 10 + i * bw + bw * 0.18, w = bw * 0.64;
    const h = it.pct === null ? 0 : Math.max(3, (H - pad - 8) * it.pct);
    const y = H - pad - h;
    const fill = it.pct === null ? 'var(--h0)' : it.pct >= 0.8 ? 'var(--h4)' : it.pct >= 0.5 ? 'var(--h3)' : 'var(--h2)';
    const txt = it.pct === null ? 'sin hábitos' : Math.round(it.pct * 100) + ' %';
    return `<g><title>${esc(it.label)}: ${txt}</title>
      <rect x="${x.toFixed(1)}" y="${(it.pct === null ? H - pad - 3 : y).toFixed(1)}" width="${w.toFixed(1)}" height="${(it.pct === null ? 3 : h).toFixed(1)}" rx="5" fill="${fill}"/>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${it.today ? 'style="font-weight:700;fill:var(--text)"' : ''}>${esc(it.label)}</text></g>`;
  }).join('');
  const grid = [0.5, 1].map((p) => `<line x1="8" x2="${W - 8}" y1="${(H - pad - (H - pad - 8) * p).toFixed(1)}" y2="${(H - pad - (H - pad - 8) * p).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cumplimiento por día">${grid}${bars}</svg>`;
}

/** Anillo de progreso. */
function ringSVG(pct, size = 64, label = '') {
  const r = size / 2 - 6, c = 2 * Math.PI * r, v = pct === null ? 0 : pct;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || Math.round(v * 100) + ' %')}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="7"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--brand)" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" style="font-size:${size * 0.24}px;font-weight:700;fill:var(--text)">${pct === null ? '–' : Math.round(v * 100)}</text></svg>`;
}

/** Mapa de energía del día (05:00–24:00): franjas de energía de fondo + bloques encima. */
function dayMapSVG(blocks, map, nowMin = null) {
  const T0 = 300, T1 = 1440, W = 320, H = 74, L = 6, R = 6;
  const x = (m) => L + ((m - T0) / (T1 - T0)) * (W - L - R);
  const bands = map.map((w) => {
    const a = Math.max(T0, toMin(w.from)), b = w.to === '24:00' ? T1 : Math.min(T1, toMin(w.to));
    if (b <= a) return '';
    return `<rect x="${x(a).toFixed(1)}" y="14" width="${(x(b) - x(a)).toFixed(1)}" height="30" fill="${ENERGY[w.level].color}" opacity=".22"><title>Energía ${ENERGY[w.level].label.toLowerCase()} (${w.from}–${w.to})</title></rect>`;
  }).join('');
  const ticks = [6, 9, 12, 15, 18, 21].map((h) => `<text x="${x(h * 60).toFixed(1)}" y="${H - 4}" text-anchor="middle">${h}</text>`).join('');
  const bl = blocks.map((b, i) => {
    const a = Math.max(T0, toMin(b.start)), e = Math.min(T1, toMin(b.end));
    if (e <= a) return '';
    const lane = i % 2 ? 31 : 17;
    return `<rect x="${x(a).toFixed(1)}" y="${lane}" width="${Math.max(3, x(e) - x(a)).toFixed(1)}" height="12" rx="3" fill="${KINDS[b.kind].color}" opacity="${b.done ? 1 : 0.8}"><title>${esc(b.title)} ${b.start}–${b.end}</title></rect>`;
  }).join('');
  const now = nowMin !== null && nowMin >= T0 && nowMin <= T1 ? `<line x1="${x(nowMin).toFixed(1)}" x2="${x(nowMin).toFixed(1)}" y1="6" y2="52" stroke="var(--text)" stroke-width="2"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de energía y bloques del día">${bands}${bl}${now}${ticks}</svg>`;
}

function weekLabel(iso) {
  const s = weekStart(iso), e = addDays(s, 6), a = parseISO(s), b = parseISO(e);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MESES[b.getMonth()].slice(0, 3)}` : `${a.getDate()} ${MESES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MESES[b.getMonth()].slice(0, 3)}`;
}
const weekdayHeaders = () => DIAS_INI;

return { heatmapHTML, barsSVG, ringSVG, dayMapSVG, weekLabel, weekdayHeaders };
})();

/* ── views/habitos.js ── */
const __m_views_habitos = (() => {
// Catálogo de hábitos: lista, ficha con mapa de calor, y formulario (incluye anclaje y versión de 2 minutos).
const { esc, delegate, todayISO, addDays, DIAS_INI } = __m_util;
const { state, activeHabits, habitById, logStatus, saveHabit, setArchived, deleteHabit } = __m_store;
const { CATEGORIES, DIFFICULTY, HABIT_ICONS } = __m_schema;
const { streakOf, freqLabel, habitRate, weekCount, isQuota } = __m_calc;
const { heatmapHTML } = __m_charts;
const { STARTERS } = __m_content;
const { session } = __m_session;
const { openSheet, confirmSheet, toast, pressedGroup, pressedValue, icon } = __m_ui;

const pct = (r) => (r === null ? '–' : Math.round(r * 100) + ' %');
const catDot = (c) => `<span class="dot" style="background:${CATEGORIES[c].color}"></span>`;

function streakChip(h, today = todayISO()) {
  const s = streakOf(h, today);
  if (!s.current) return '';
  return `<span class="streak ${s.atRisk ? 'risk' : ''}" title="${s.atRisk ? 'Falló una vez: no falles la segunda' : 'Racha actual'}">🔥 ${s.current} ${s.unit === 'semanas' ? 'sem' : ''}${s.atRisk ? ' · en riesgo' : ''}</span>`;
}

function weekPips(h, today) {
  let out = '';
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i), st = logStatus(h.id, d);
    out += `<span class="pip ${st ? 'on' : ''}" title="${d}" style="${st === 'mini' ? 'opacity:.55' : ''}"></span>`;
  }
  return `<span style="display:inline-flex;gap:3px;align-items:center">${out}</span>`;
}

function viewHabitos() {
  const today = todayISO();
  const all = activeHabits();
  const list = session.filter === 'all' ? all : all.filter((h) => h.category === session.filter);
  const archived = state.habits.filter((h) => h.archived);
  const chips = [['all', 'Todos'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])]
    .map(([k, l]) => `<button class="chip" data-act="filter" data-v="${k}" aria-pressed="${session.filter === k}">${esc(l)}</button>`).join('');

  const rows = list.map((h) => {
    const q = isQuota(h) ? ` · ${weekCount(h, today)}/${h.freq.times} esta semana` : '';
    return `<div class="item" data-act="open" data-id="${h.id}" role="button" tabindex="0">
      <span class="ico">${esc(h.icon)}</span>
      <div class="body"><div class="nm">${esc(h.name)}</div>
        <div class="sub">${catDot(h.category)}<span>${CATEGORIES[h.category].label} · ${DIFFICULTY[h.difficulty]}</span><span>${esc(freqLabel(h))}${q}</span>${streakChip(h, today)}</div>
        <div class="sub" style="margin-top:6px">${weekPips(h, today)}<span class="tiny">últimos 7 días</span></div></div>
    </div>`;
  }).join('');

  const empty = !all.length ? `<div class="card empty"><div class="big">🌱</div><b>Aún no tienes hábitos</b>
    <p class="small">Empieza con uno solo y su versión de 2 minutos. Toca uno para crearlo:</p>
    <div class="list" style="text-align:left">${STARTERS.map((s, i) => `<button class="item" data-act="starter" data-i="${i}"><span class="ico">${s.icon}</span><div class="body"><div class="nm">${esc(s.name)}</div><div class="sub">2 min: ${esc(s.minimal)}</div></div></button>`).join('')}</div></div>` : '';

  const arch = archived.length ? `<details><summary>Archivados (${archived.length})</summary><div class="list">${archived.map((h) =>
    `<div class="item"><span class="ico">${esc(h.icon)}</span><div class="body"><div class="nm">${esc(h.name)}</div><div class="sub">Su historial se conserva</div></div><button class="btn sm" data-act="restore" data-id="${h.id}">Restaurar</button></div>`).join('')}</div></details>` : '';

  return {
    title: 'Hábitos', subtitle: all.length ? `${all.length} activo${all.length === 1 ? '' : 's'} · identidad primero` : 'Tu catálogo de micro-hábitos',
    html: `${all.length ? `<div class="scroll-x">${chips}</div>` : ''}
      ${all.length > 3 ? '<div class="banner info"><span>💡</span><span>Más hábitos no es mejor. Si algo te cuesta, <b>hazlo más pequeño</b> antes de abandonarlo.</span></div>' : ''}
      <div class="list">${rows}</div>${empty}${arch}
      <button class="fab" data-act="new" aria-label="Nuevo hábito">${icon('plus')}</button>`,
    bind(page) {
      delegate(page, 'click', '[data-act]', async (ev, t) => {
        const a = t.dataset.act;
        if (a === 'filter') { session.filter = t.dataset.v; session.refresh(); }
        else if (a === 'open') openHabitDetail(t.dataset.id);
        else if (a === 'new') openHabitForm(null);
        else if (a === 'restore') { await setArchived(t.dataset.id, false); toast('Hábito restaurado'); }
        else if (a === 'starter') { await createFromStarter(+t.dataset.i); }
      });
      delegate(page, 'keydown', '[data-act="open"]', (ev, t) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openHabitDetail(t.dataset.id); } });
    },
  };
}

async function createFromStarter(i) {
  const s = STARTERS[i];
  await saveHabit({ ...s, freq: { type: 'daily', days: [], times: 0 } });
  toast('Listo. Hoy solo haz la versión de 2 minutos 🌱');
}

/* ---------- Ficha del hábito ---------- */
function openHabitDetail(id) {
  const h = habitById(id); if (!h) return;
  const today = todayISO();
  const s = streakOf(h, today);
  const rate30 = habitRate(h, addDays(today, -29), today);
  const votes = [...state.logs.values()].filter((l) => l.habitId === id).length;
  const anchor = h.anchorId ? habitById(h.anchorId) : null;
  const deps = state.habits.filter((x) => x.anchorId === id && !x.archived);
  const q = isQuota(h) ? `<div class="banner info" style="margin-bottom:12px"><span>📅</span><span>Esta semana: <b>${weekCount(h, today)} de ${h.freq.times}</b>. Esta racha se cuenta en semanas.</span></div>` : '';
  openSheet({
    title: `${h.icon} ${h.name}`,
    html: `<div class="chips" style="margin-bottom:12px"><span class="chip">${catDot(h.category)} ${CATEGORIES[h.category].label}</span>
        <span class="chip">${DIFFICULTY[h.difficulty]}</span><span class="chip">${esc(freqLabel(h))}</span></div>${q}
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><b>${s.current}</b><span>racha (${s.unit})</span></div>
        <div class="stat"><b>${s.best}</b><span>mejor racha</span></div>
        <div class="stat"><b>${pct(rate30)}</b><span>últimos 30 días</span></div></div>
      <div class="card" style="margin-bottom:12px"><div class="card-h"><h3>Últimas 16 semanas</h3></div>${heatmapHTML(16, today, h)}</div>
      ${h.identity ? `<div class="tip"><b>${esc(h.identity)}</b><span class="small muted">${votes} ${votes === 1 ? 'voto' : 'votos'} a favor de esta identidad (cada ✓ cuenta).</span></div>` : ''}
      ${h.minimal ? `<p class="small"><b>Versión de 2 minutos:</b> ${esc(h.minimal)}</p>` : '<p class="small muted">Sin versión de 2 minutos: edítalo y agrega una para los días difíciles.</p>'}
      ${anchor ? `<p class="small"><b>Anclado a:</b> después de «${esc(anchor.name)}»${h.cue ? ' · ' + esc(h.cue) : ''}</p>` : (h.cue ? `<p class="small"><b>Pista:</b> ${esc(h.cue)}</p>` : '')}
      ${deps.length ? `<p class="small"><b>Después de este:</b> ${deps.map((d) => esc(d.name)).join(', ')}</p>` : ''}
      <div class="actions"><button class="btn primary block" data-edit>Editar</button>
        <button class="btn block" data-arch>${h.archived ? 'Restaurar' : 'Archivar (conserva el historial)'}</button>
        <button class="btn danger block" data-del>Eliminar para siempre</button></div>`,
    onMount: (el, { close }) => {
      el.querySelector('[data-edit]').onclick = () => { close(); openHabitForm(id); };
      el.querySelector('[data-arch]').onclick = async () => { await setArchived(id, !h.archived); close(); toast(h.archived ? 'Hábito restaurado' : 'Archivado: su historial sigue guardado'); };
      el.querySelector('[data-del]').onclick = async () => {
        const ok = await confirmSheet({ title: '¿Eliminar el hábito?', message: `Se borrarán «${esc(h.name)}» y todo su historial (${votes} marcas). No se puede deshacer. Si solo quieres pausarlo, usa Archivar.`, ok: 'Eliminar', danger: true });
        if (ok) { await deleteHabit(id); close(); toast('Hábito eliminado'); }
      };
    },
  });
}

/* ---------- Formulario crear / editar ---------- */
function descendantsOf(id) {
  const out = new Set([id]); let grew = true;
  while (grew) { grew = false; for (const h of state.habits) if (h.anchorId && out.has(h.anchorId) && !out.has(h.id)) { out.add(h.id); grew = true; } }
  return out;
}

function openHabitForm(id, prefill = {}) {
  const ex = id ? habitById(id) : null;
  const h = ex || { name: '', icon: '🎯', category: 'salud', difficulty: 1, freq: { type: 'daily', days: [1, 2, 3, 4, 5], times: 3 }, minimal: '', anchorId: null, cue: '', identity: '', ...prefill };
  const banned = ex ? descendantsOf(ex.id) : new Set();
  const anchors = activeHabits().filter((x) => !banned.has(x.id));
  const days = h.freq.days && h.freq.days.length ? h.freq.days : [1, 2, 3, 4, 5];
  const seg = (name, items, cur) => `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  openSheet({
    title: ex ? 'Editar hábito' : 'Nuevo hábito',
    html: `<form id="hf" novalidate>
      <div class="field"><label for="hf-name">¿Qué hábito quieres construir?</label><input type="text" id="hf-name" maxlength="80" value="${esc(h.name)}" placeholder="Ej.: Leer antes de dormir" autocomplete="off"></div>
      <div class="field"><span class="lbl">Ícono</span><div class="emoji-grid" data-seg="icon">${HABIT_ICONS.map((e) => `<button type="button" data-v="${e}" aria-pressed="${h.icon === e}" aria-label="${e}">${e}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Categoría</span>${seg('cat', Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]), h.category)}</div>
      <div class="field"><span class="lbl">Dificultad (cuánto esfuerzo te pide)</span>${seg('diff', Object.entries(DIFFICULTY), h.difficulty)}</div>
      <div class="field"><span class="lbl">Frecuencia</span>${seg('freq', [['daily', 'Diario'], ['days', 'Días'], ['weekly', 'Veces/sem.']], h.freq.type)}
        <div id="hf-days" class="daypick ${h.freq.type === 'days' ? '' : 'hidden'}" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-d="${d}" aria-pressed="${days.includes(d)}">${DIAS_INI[d]}</button>`).join('')}</div>
        <div id="hf-times" class="${h.freq.type === 'weekly' ? '' : 'hidden'}" style="margin-top:8px"><label class="small muted" for="hf-n">¿Cuántas veces por semana?</label>
          <input type="number" id="hf-n" min="1" max="7" value="${h.freq.times || 3}" inputmode="numeric"></div></div>
      <div class="field"><label for="hf-min">Versión de 2 minutos (para los días malos)</label><input type="text" id="hf-min" maxlength="120" value="${esc(h.minimal)}" placeholder="Ej.: Leer una sola página">
        <span class="tiny muted">Si hoy solo tuvieras 2 minutos, ¿qué harías? Cuenta como hecho.</span></div>
      <div class="field"><label for="hf-anchor">Anclaje: «Después de…» (habit stacking)</label><select id="hf-anchor"><option value="">— Ninguno —</option>
        ${anchors.map((a) => `<option value="${a.id}" ${h.anchorId === a.id ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="hf-cue">Pista: ¿cuándo y dónde?</label><input type="text" id="hf-cue" maxlength="120" value="${esc(h.cue)}" placeholder="Ej.: Al servirme el café, en la cocina"></div>
      <div class="field"><label for="hf-id">Identidad (opcional)</label><input type="text" id="hf-id" maxlength="120" value="${esc(h.identity)}" placeholder="Soy una persona que…"></div>
      <p id="hf-err" class="small warn-t hidden" role="alert"></p>
      <div class="actions"><button class="btn primary block" type="submit">${ex ? 'Guardar cambios' : 'Crear hábito'}</button></div></form>`,
    onMount: (el, { close }) => {
      const sel = { icon: h.icon, cat: h.category, diff: h.difficulty, freq: h.freq.type };
      for (const name of Object.keys(sel)) pressedGroup(el.querySelector(`[data-seg="${name}"]`), 'button', (v) => {
        sel[name] = name === 'diff' ? +v : v;
        if (name === 'freq') { el.querySelector('#hf-days').classList.toggle('hidden', v !== 'days'); el.querySelector('#hf-times').classList.toggle('hidden', v !== 'weekly'); }
      });
      el.querySelectorAll('#hf-days button').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
      el.querySelector('#hf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = el.querySelector('#hf-err'); err.classList.add('hidden');
        const name = el.querySelector('#hf-name').value.trim();
        const dsel = [...el.querySelectorAll('#hf-days button[aria-pressed="true"]')].map((b) => +b.dataset.d);
        if (!name) { err.textContent = 'Ponle un nombre al hábito.'; err.classList.remove('hidden'); el.querySelector('#hf-name').focus(); return; }
        if (sel.freq === 'days' && !dsel.length) { err.textContent = 'Elige al menos un día de la semana.'; err.classList.remove('hidden'); return; }
        try {
          await saveHabit({
            ...(ex ? { id: ex.id } : {}), name, icon: sel.icon, category: sel.cat, difficulty: sel.diff,
            freq: { type: sel.freq, days: dsel, times: parseInt(el.querySelector('#hf-n').value, 10) || 3 },
            minimal: el.querySelector('#hf-min').value, anchorId: el.querySelector('#hf-anchor').value || null,
            cue: el.querySelector('#hf-cue').value, identity: el.querySelector('#hf-id').value,
          });
          close(); toast(ex ? 'Cambios guardados' : 'Hábito creado. Empieza con la versión de 2 minutos 🌱');
        } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
      });
      if (!ex) setTimeout(() => el.querySelector('#hf-name').focus(), 250);
    },
  });
}

return { streakChip, viewHabitos, createFromStarter, openHabitDetail, openHabitForm, catDot };
})();

/* ── views/plan.js ── */
const __m_views_plan = (() => {
// Itinerario: bloques de tiempo, mapa de energía, checklist y formulario de bloques.
const { esc, delegate, todayISO, addDays, weekStart, parseISO, fmtDateLong, DIAS_3, toMin, fromMin, nowMin, durLabel, isTime, uid, weekday, cap } = __m_util;
const { state, blocksOn, saveBlocks, saveBlock, deleteBlock, toggleBlock, copyDay } = __m_store;
const { KINDS, ENERGY } = __m_schema;
const { alignScore, energyAt, overlaps } = __m_calc;
const { dayMapSVG, weekLabel } = __m_charts;
const { session } = __m_session;
const { openSheet, toast, pressedGroup, icon, energyIcon } = __m_ui;

/** Primer hueco libre dentro de una ventana del nivel de energía pedido. */
function findSlot(date, level, durMin, excludeId = null) {
  const others = blocksOn(date).filter((b) => b.id !== excludeId);
  for (const w of state.settings.energyMap.filter((x) => x.level === level)) {
    const a = toMin(w.from), b = w.to === '24:00' ? 1440 : toMin(w.to);
    for (let s = a; s + durMin <= b; s += 5) {
      if (!others.some((o) => s < toMin(o.end) && toMin(o.start) < s + durMin)) return fromMin(s);
    }
  }
  return null;
}

function blockRow(b, date, bad, isToday) {
  const k = KINDS[b.kind];
  const now = isToday && nowMin() >= toMin(b.start) && nowMin() < toMin(b.end) && !b.done;
  const sc = alignScore(b);
  return `<div class="item ${b.done ? 'done' : ''}" style="${now ? 'border-color:var(--brand)' : ''}">
    <span class="kbar" style="background:${k.color}"></span>
    <button class="chk" data-act="tick" data-id="${b.id}" aria-pressed="${b.done}" aria-label="Completar: ${esc(b.title)}">${icon('check')}</button>
    <button class="body" data-act="edit" data-id="${b.id}">
      <div class="nm">${esc(b.title)}</div>
      <div class="sub"><span class="time">${b.start}–${b.end}</span><span>${k.short}</span><span>${energyIcon(b.energy)} ${ENERGY[b.energy].label}</span>
        ${now ? '<span class="warn-t" style="color:var(--brand-strong)">● ahora</span>' : ''}${bad.has(b.id) ? '<span class="warn-t">⚠ se cruza</span>' : ''}${sc === 0 ? '<span class="warn-t">⚡ fuera de tu energía</span>' : ''}</div>
    </button></div>`;
}

function viewPlan() {
  const today = todayISO(), date = session.datePlan, isToday = date === today;
  const blocks = blocksOn(date), bad = overlaps(blocks);
  const done = blocks.filter((b) => b.done).length;
  const pct = blocks.length ? Math.round((done / blocks.length) * 100) : 0;
  const ws = weekStart(date);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i), n = blocksOn(d).length;
    return `<button data-act="day" data-d="${d}" class="${d === today ? 'today' : ''}" aria-pressed="${d === date}" aria-label="${fmtDateLong(d)}">${DIAS_3[parseISO(d).getDay()]}<b>${parseISO(d).getDate()}</b><span class="pip ${n ? 'on' : ''}"></span></button>`;
  }).join('');
  const deepMin = blocks.filter((b) => b.kind === 'deep').reduce((s, b) => s + toMin(b.end) - toMin(b.start), 0);
  // El aviso con sugerencia solo salta cuando el bloque pide MÁS energía de la que tienes a esa hora (lo que de verdad duele).
  const misaligned = blocks.filter((b) => !b.done && alignScore(b) === 0 && ENERGY[b.energy].level > ENERGY[energyAt(toMin(b.start))].level).slice(0, 2);
  const tips = misaligned.map((b) => {
    const dur = toMin(b.end) - toMin(b.start), at = findSlot(date, b.energy, dur, b.id);
    return `<div class="banner"><span>⚡</span><span><b>«${esc(b.title)}»</b> pide energía ${ENERGY[b.energy].label.toLowerCase()} pero cae en tu hora de energía ${ENERGY[energyAt(toMin(b.start))].label.toLowerCase()}.
      ${at ? `<br><button class="link" data-act="move" data-id="${b.id}" data-at="${at}">Moverlo a las ${at}</button>` : ''}</span></div>`;
  }).join('');
  const list = blocks.map((b) => blockRow(b, date, bad, isToday)).join('');
  const empty = !blocks.length ? `<div class="card empty"><div class="big">🗓️</div><b>Sin bloques este día</b>
    <p class="small">Planifica con intención: un bloque profundo, uno de recuperación y tus compromisos fijos.</p>
    <div class="actions"><button class="btn soft" data-act="copy" data-from="${addDays(date, -1)}">Copiar los bloques de ayer</button>
    <button class="btn" data-act="copy" data-from="${addDays(date, -7)}">Copiar del mismo día, semana pasada</button></div></div>` : '';
  return {
    title: 'Plan', subtitle: cap(fmtDateLong(date)) + (isToday ? ' · hoy' : ''),
    html: `<div class="card"><div class="card-h"><button class="icon-btn" data-act="wk" data-n="-7" aria-label="Semana anterior">${icon('left')}</button>
        <b>${weekLabel(date)}</b><button class="icon-btn" data-act="wk" data-n="7" aria-label="Semana siguiente">${icon('right')}</button></div>
      <div class="strip">${strip}</div>${isToday ? '' : '<div style="text-align:center;margin-top:8px"><button class="link small" data-act="today">Ir a hoy</button></div>'}</div>
      <div class="card"><div class="card-h"><h3>Tu día en bloques</h3><span class="small muted">${blocks.length} bloque${blocks.length === 1 ? '' : 's'}</span></div>
        ${dayMapSVG(blocks, state.settings.energyMap, isToday ? nowMin() : null)}
        <div class="legend" style="margin-top:6px;flex-wrap:wrap"><span>Fondo = tu energía:</span>${Object.entries(ENERGY).map(([, e]) => `<i style="background:${e.color};opacity:.35"></i><span>${e.label.toLowerCase()}</span>`).join('')}</div>
        <div class="chips" style="margin-top:8px">${Object.entries(KINDS).map(([, k]) => `<span class="chip"><span class="dot" style="background:${k.color}"></span>${k.short}</span>`).join('')}</div>
        ${deepMin ? `<p class="small muted" style="margin:8px 0 0">${durLabel('00:00', fromMin(deepMin))} de trabajo profundo planificado${deepMin > 240 ? '. Ojo: más de 4 h profundas al día suele ser demasiado.' : '.'}</p>` : ''}
        ${blocks.length ? `<div style="margin-top:12px"><div class="card-h" style="margin-bottom:6px"><span class="small muted">Progreso del plan</span><b>${done}/${blocks.length}</b></div><div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></div>` : ''}</div>
      ${tips}${bad.size ? '<div class="banner"><span>⚠️</span><span>Hay bloques que se cruzan. Ajusta las horas para tener colchón entre ellos.</span></div>' : ''}
      <div class="list">${list}</div>${empty}
      <button class="fab" data-act="new" aria-label="Nuevo bloque">${icon('plus')}</button>`,
    bind(page) {
      delegate(page, 'click', '[data-act]', async (ev, t) => {
        const a = t.dataset.act;
        if (a === 'day') { session.datePlan = t.dataset.d; session.refresh(); }
        else if (a === 'wk') { session.datePlan = addDays(date, +t.dataset.n); session.refresh(); }
        else if (a === 'today') { session.datePlan = today; session.refresh(); }
        else if (a === 'tick') { await toggleBlock(t.dataset.id); navigator.vibrate?.(8); }
        else if (a === 'edit') openBlockForm(t.dataset.id);
        else if (a === 'new') openBlockForm(null, { date });
        else if (a === 'move') {
          const b = state.blocks.find((x) => x.id === t.dataset.id); if (!b) return;
          const dur = toMin(b.end) - toMin(b.start), s = t.dataset.at;
          await saveBlock({ ...b, start: s, end: fromMin(toMin(s) + dur) }); toast('Bloque movido a tu hora de energía');
        } else if (a === 'copy') {
          const n = await copyDay(t.dataset.from, date);
          toast(n ? `${n} bloque${n === 1 ? '' : 's'} copiado${n === 1 ? '' : 's'}` : 'Ese día no tiene bloques para copiar');
        }
      });
    },
  };
}

/* ---------- Formulario de bloque ---------- */
const REPEATS = [['none', 'No se repite'], ['daily7', 'Todos los días (7 días)'], ['weekdays', 'Lunes a viernes (2 semanas)'], ['weekly4', 'Cada semana (4 semanas)']];
function repeatDates(date, mode) {
  if (mode === 'daily7') return Array.from({ length: 7 }, (_, i) => addDays(date, i));
  if (mode === 'weekly4') return [0, 7, 14, 21].map((n) => addDays(date, n));
  if (mode === 'weekdays') { const out = []; for (let i = 0; out.length < 10 && i < 30; i++) { const d = addDays(date, i); if (weekday(d) >= 1 && weekday(d) <= 5) out.push(d); } return out; }
  return [date];
}

function openBlockForm(id, prefill = {}) {
  const ex = id ? state.blocks.find((b) => b.id === id) : null;
  const date = ex ? ex.date : (prefill.date || session.datePlan);
  const free = (() => { const bs = blocksOn(date); const last = bs.length ? toMin(bs[bs.length - 1].end) : 540; return fromMin(Math.min(last, 1260)); })();
  const b = ex || { title: '', kind: 'task', energy: 'medium', start: free, end: fromMin(Math.min(toMin(free) + 60, 1439)), note: '', ...prefill };
  const seg = (name, items, cur) => `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  openSheet({
    title: ex ? 'Editar bloque' : 'Nuevo bloque',
    html: `<form id="bf" novalidate>
      <div class="field"><label for="bf-t">¿Qué harás en este bloque?</label><input type="text" id="bf-t" maxlength="100" value="${esc(b.title)}" placeholder="Ej.: Escribir el informe" autocomplete="off"></div>
      <div class="field"><span class="lbl">Tipo de bloque</span>${seg('kind', Object.entries(KINDS).map(([k, v]) => [k, v.short]), b.kind)}</div>
      <div class="field"><span class="lbl">Energía que requiere</span>${seg('energy', Object.entries(ENERGY).map(([k, v]) => [k, v.label]), b.energy)}</div>
      <div class="row2"><div class="field"><label for="bf-s">Inicio</label><input type="time" id="bf-s" value="${b.start}"></div>
        <div class="field"><label for="bf-e">Fin</label><input type="time" id="bf-e" value="${b.end}"></div></div>
      <div class="chips" style="margin:-4px 0 12px">${[30, 45, 60, 90, 120].map((m) => `<button type="button" class="chip" data-dur="${m}">${m < 60 ? m + ' min' : m === 90 ? '1 h 30' : m / 60 + ' h'}</button>`).join('')}</div>
      <p id="bf-hint" class="small" style="min-height:2.6em"></p>
      <div class="field"><label for="bf-n">Nota (opcional)</label><input type="text" id="bf-n" maxlength="300" value="${esc(b.note)}" placeholder="Ej.: Sala 2, llevar la laptop"></div>
      ${ex ? (ex.seriesId ? '<label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" id="bf-series"> Aplicar también a los siguientes de esta serie</label>' : '')
        : `<div class="field"><label for="bf-r">Repetir</label><select id="bf-r">${REPEATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`}
      <p id="bf-err" class="small warn-t hidden" role="alert"></p>
      <div class="actions"><button class="btn primary block" type="submit">${ex ? 'Guardar cambios' : 'Agregar al plan'}</button>
        ${ex ? '<button class="btn danger block" type="button" data-del>Eliminar bloque</button>' : ''}</div></form>`,
    onMount: (el, { close }) => {
      const sel = { kind: b.kind, energy: b.energy }; let energyTouched = !!ex;
      const $s = el.querySelector('#bf-s'), $e = el.querySelector('#bf-e'), hint = el.querySelector('#bf-hint');
      const showHint = () => {
        if (!isTime($s.value) || !isTime($e.value)) { hint.textContent = ''; return; }
        const probe = { kind: sel.kind, energy: sel.energy, start: $s.value };
        const win = energyAt(toMin($s.value)), sc = alignScore(probe);
        if (sel.kind === 'fixed') hint.innerHTML = `<span class="muted">Compromiso fijo: no se mueve. A esa hora tu energía es <b>${ENERGY[win].label.toLowerCase()}</b>.</span>`;
        else if (sc === 2) hint.innerHTML = `<span style="color:var(--brand-strong)">✓ Buen encaje: a esa hora tu energía es <b>${ENERGY[win].label.toLowerCase()}</b>.</span>`;
        else if (sc === 1) hint.innerHTML = `<span class="muted">Encaje aceptable. A esa hora tu energía es <b>${ENERGY[win].label.toLowerCase()}</b>.</span>`;
        else { const at = findSlot(date, sel.energy, Math.max(30, toMin($e.value) - toMin($s.value)), ex ? ex.id : null); hint.innerHTML = `<span class="warn-t">⚡ Pide energía ${ENERGY[sel.energy].label.toLowerCase()} y a esa hora tu energía es ${ENERGY[win].label.toLowerCase()}.${at ? ` Prueba a las ${at}.` : ''}</span>`; }
      };
      pressedGroup(el.querySelector('[data-seg="kind"]'), 'button', (v) => {
        sel.kind = v;
        if (!energyTouched) { sel.energy = KINDS[v].defaultEnergy; el.querySelectorAll('[data-seg="energy"] button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === sel.energy))); }
        showHint();
      });
      pressedGroup(el.querySelector('[data-seg="energy"]'), 'button', (v) => { sel.energy = v; energyTouched = true; showHint(); });
      el.querySelectorAll('[data-dur]').forEach((c) => c.addEventListener('click', () => { if (isTime($s.value)) { $e.value = fromMin(toMin($s.value) + +c.dataset.dur); showHint(); } }));
      [$s, $e].forEach((i) => i.addEventListener('input', showHint));
      showHint();
      el.querySelector('#bf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = el.querySelector('#bf-err'); err.classList.add('hidden');
        const title = el.querySelector('#bf-t').value.trim();
        const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
        if (!title) return fail('Ponle un título al bloque.');
        if (!isTime($s.value) || !isTime($e.value)) return fail('Indica la hora de inicio y de fin.');
        if (toMin($e.value) <= toMin($s.value)) return fail('La hora de fin debe ser posterior a la de inicio.');
        const base = { title, kind: sel.kind, energy: sel.energy, start: $s.value, end: $e.value, note: el.querySelector('#bf-n').value };
        try {
          if (ex) {
            const list = [{ ...ex, ...base }];
            if (el.querySelector('#bf-series')?.checked) state.blocks.filter((x) => x.seriesId === ex.seriesId && x.date > ex.date).forEach((x) => list.push({ ...x, ...base }));
            await saveBlocks(list);
          } else {
            const mode = el.querySelector('#bf-r').value, dates = repeatDates(date, mode), seriesId = dates.length > 1 ? uid() : null;
            await saveBlocks(dates.map((d) => ({ ...base, id: uid(), date: d, seriesId, done: false })));
          }
          close(); toast(ex ? 'Bloque actualizado' : 'Bloque agregado al plan');
        } catch (e2) { fail(e2.message); }
      });
      el.querySelector('[data-del]')?.addEventListener('click', () => { close(); confirmDeleteBlock(ex); });
      if (!ex) setTimeout(() => el.querySelector('#bf-t').focus(), 250);
    },
  });
}

function confirmDeleteBlock(b) {
  const later = b.seriesId ? state.blocks.filter((x) => x.seriesId === b.seriesId && x.date > b.date) : [];
  openSheet({
    title: '¿Eliminar bloque?',
    html: `<p>«${esc(b.title)}» (${b.start}–${b.end})</p><div class="actions">
      <button class="btn danger block" data-one>Eliminar solo este</button>
      ${later.length ? `<button class="btn danger block" data-all>Este y los ${later.length} siguientes de la serie</button>` : ''}
      <button class="btn block" data-no>Cancelar</button></div>`,
    onMount: (el, { close }) => {
      el.querySelector('[data-one]').onclick = async () => { await deleteBlock(b.id); close(); toast('Bloque eliminado'); };
      const all = el.querySelector('[data-all]');
      if (all) all.onclick = async () => { for (const x of [b, ...later]) await deleteBlock(x.id); close(); toast('Serie eliminada'); };
      el.querySelector('[data-no]').onclick = () => close();
    },
  });
}

return { findSlot, viewPlan, openBlockForm };
})();

/* ── demo.js ── */
const __m_demo = (() => {
// Datos de ejemplo (8 semanas) para explorar la app. Deterministas: siempre salen iguales.
const { addDays, weekday, toMin, fromMin, nowMin, todayISO } = __m_util;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TEMPLATE = [
  // [inicio, fin, título, tipo, energía, días de la semana (0=dom)]
  ['09:00', '11:00', 'Proyecto principal', 'deep', 'high', [1, 2, 3, 4, 5]],
  ['11:15', '12:00', 'Correos y mensajes', 'task', 'low', [1, 2, 3, 4, 5]],
  ['13:00', '14:00', 'Almuerzo y pausa real', 'recovery', 'low', [0, 1, 2, 3, 4, 5, 6]],
  ['15:00', '16:00', 'Reunión de equipo', 'fixed', 'medium', [1, 3]],
  ['16:15', '17:15', 'Trámites y pendientes', 'task', 'medium', [2, 4]],
  ['17:30', '18:00', 'Planificar mañana', 'task', 'medium', [1, 2, 3, 4, 5]],
  ['20:30', '21:00', 'Lectura tranquila', 'recovery', 'low', [0, 1, 2, 3, 4, 5, 6]],
];
const WORKED = ['Terminé el bloque profundo sin revisar el celular.', 'Salí a caminar aunque tenía poco tiempo.', 'Planifiqué el día la noche anterior y se notó.', 'Hice la versión de 2 minutos y eso me destrabó.', 'Dije que no a algo que no era prioridad.'];
const DRAINED = ['Las reuniones largas después del almuerzo.', 'Revisar redes antes de empezar a trabajar.', 'Cambiar de tarea cada 15 minutos.', 'Dormí poco y la tarde se me hizo cuesta arriba.', 'Mensajes urgentes que no eran urgentes.'];
const PRIORITY = ['Avanzar el informe principal.', 'Caminar 20 minutos temprano.', 'Cerrar el trámite pendiente.', 'Dos bloques profundos antes del mediodía.', 'Descansar bien y llegar fresco.'];

function demoData(today = todayISO()) {
  const r = rng(20261104);
  const start = addDays(today, -55);
  const now = new Date().toISOString();
  const H = (i, name, icon, category, difficulty, freq, extra = {}) => ({
    id: `demo-h${i}`, name, icon, category, difficulty, freq, minimal: '', anchorId: null, cue: '', identity: '', startDate: start,
    archived: false, sort: i, createdAt: now, updatedAt: now, ...extra,
  });
  const habits = [
    H(1, 'Beber un vaso de agua al despertar', '💧', 'salud', 1, { type: 'daily' }, { minimal: 'Beber un sorbo', identity: 'Soy una persona que cuida su cuerpo', cue: 'Al levantarme' }),
    H(2, 'Respirar con calma', '🧘', 'mente', 1, { type: 'daily' }, { minimal: '3 respiraciones profundas', anchorId: 'demo-h1', identity: 'Soy una persona serena' }),
    H(3, 'Caminar 20 minutos', '🚶', 'vitalidad', 2, { type: 'weekly', times: 4 }, { minimal: 'Salir a la puerta con zapatos', identity: 'Soy una persona activa' }),
    H(4, 'Leer unas páginas', '📖', 'mente', 2, { type: 'daily' }, { minimal: 'Leer una página', identity: 'Soy una persona que aprende cada día', cue: 'En la cama, antes de dormir' }),
    H(5, 'Bloque de trabajo profundo', '🎯', 'trabajo', 3, { type: 'days', days: [1, 2, 3, 4, 5] }, { minimal: '10 minutos sin distracciones', identity: 'Soy una persona que termina lo importante' }),
    H(6, 'Apagar pantallas a las 22:00', '😴', 'vitalidad', 2, { type: 'daily' }, { minimal: 'Apagar la TV', anchorId: 'demo-h4' }),
  ];
  const base = { 1: 0.88, 2: 0.78, 4: 0.7, 5: 0.82, 6: 0.62 };
  const wdBoost = [-0.12, 0.04, 0.06, 0.04, 0.02, -0.04, -0.14]; // domingo flojo, lunes fuerte
  const logs = [];
  const add = (hid, date, st) => logs.push({ id: `${hid}|${date}`, habitId: hid, date, status: st, updatedAt: now });
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const wd = weekday(d);
    for (const h of habits) {
      if (h.freq.type === 'weekly') continue;
      if (h.freq.type === 'days' && !h.freq.days.includes(wd)) continue;
      const hid = h.id; const idx = +hid.slice(6);
      if (d === today && r() > 0.5) continue;
      const p = (base[idx] || 0.7) + wdBoost[wd] + (d > addDays(today, -14) ? 0.08 : 0);
      const x = r();
      if (x < p * 0.82) add(hid, d, 'done'); else if (x < p) add(hid, d, 'mini');
    }
  }
  // Caminar (4 veces/sem): días fijos con algo de ruido
  for (let d = start; d <= today; d = addDays(d, 1)) {
    if ([1, 3, 5, 6].includes(weekday(d)) && r() < 0.78 && !(d === today)) add('demo-h3', d, r() < 0.2 ? 'mini' : 'done');
  }

  const blocks = [];
  const nm = nowMin();
  for (let d = addDays(today, -14); d <= addDays(today, 2); d = addDays(d, 1)) {
    const wd = weekday(d);
    TEMPLATE.forEach(([s, e, title, kind, energy, days], i) => {
      if (!days.includes(wd)) return;
      let done = false;
      // Los dos últimos días el trabajo profundo sale cumplido, para que el panel de ejemplo no arranque en cero.
      if (d < today) { const x = r(); done = x < (kind === 'fixed' ? 0.95 : 0.8) || (kind === 'deep' && d >= addDays(today, -2)); }
      else if (d === today) done = toMin(e) <= nm && r() < 0.8;
      blocks.push({ id: `demo-b-${d}-${i}`, date: d, start: s, end: e, title, kind, energy, done, doneAt: done ? now : null, note: '', seriesId: null, updatedAt: now });
    });
  }
  // Un bloque profundo mal alineado (en tu hora baja) para que veas la sugerencia de energía
  blocks.push({ id: `demo-b-${today}-x`, date: today, start: fromMin(14 * 60 + 15), end: fromMin(15 * 60), title: 'Redactar propuesta', kind: 'deep', energy: 'high', done: false, doneAt: null, note: '', seriesId: null, updatedAt: now });

  const reflections = [];
  for (let k = 1; k <= 9; k++) {
    const d = addDays(today, -k);
    reflections.push({ date: d, worked: WORKED[Math.floor(r() * WORKED.length)], drained: DRAINED[Math.floor(r() * DRAINED.length)], priority: PRIORITY[Math.floor(r() * PRIORITY.length)], mood: 2 + Math.floor(r() * 4), updatedAt: now });
  }
  return { habits, logs, blocks, reflections };
}

return { demoData };
})();

/* ── views/ajustes.js ── */
const __m_views_ajustes = (() => {
// Ajustes: respaldo y migración, apariencia, energía, almacenamiento, guía de coaching y borrado.
const { esc, fmtDateTime, diffDays, todayISO } = __m_util;
const { state, saveSettings, hasAnyData, wipeEverything } = __m_store;
const { CHRONOTYPES, energyMapFor } = __m_schema;
const { exportBackup, parseBackup, applyImport, hasUndo, undoLastImport, sanitize } = __m_backup;
const { demoData } = __m_demo;
const { TIPS } = __m_content;
const { session } = __m_session;
const { openSheet, confirmSheet, toast, pressedGroup } = __m_ui;

const APP_VERSION = '1.0.0';
const counts = () => `${state.habits.length} hábitos · ${state.logs.size} marcas · ${state.blocks.length} bloques · ${state.reflections.size} check-ins`;

function backupStatus() {
  if (!state.lastBackupAt) return { text: 'Nunca has hecho un respaldo', bad: true };
  const days = diffDays(state.lastBackupAt.slice(0, 10), todayISO());
  const when = fmtDateTime(state.lastBackupAt);
  return { text: `Último respaldo: ${when}${days >= 1 ? ` (hace ${days} ${days === 1 ? 'día' : 'días'})` : ' (hoy)'}`, bad: days >= 7 };
}

async function loadDemoData() {
  if (hasAnyData()) {
    const ok = await confirmSheet({ title: '¿Cargar datos de ejemplo?', message: 'Reemplazarán lo que tienes ahora. Antes guardamos una copia: podrás volver con «Deshacer última importación».', ok: 'Cargar ejemplo' });
    if (!ok) return false;
  }
  const { data } = sanitize({ ...demoData(), settings: { ...state.settings, onboarded: true } });
  await applyImport({ ok: true, data }, 'replace');
  toast('Datos de ejemplo cargados. Bórralos desde Ajustes cuando quieras.');
  return true;
}

function openLearn(openId = null) {
  openSheet({
    title: 'Aprende: el método',
    html: `<p class="muted small" style="margin-top:0">Ciencia del comportamiento en pocas líneas. Empieza por la primera.</p>
      ${TIPS.map((t) => `<details ${t.id === openId ? 'open' : ''}><summary>${esc(t.title)}</summary><div>${t.html}</div></details>`).join('')}`,
  });
}

/* ---------- Importar ---------- */
function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json,text/plain'; inp.style.display = 'none';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); }, { once: true });
    inp.addEventListener('cancel', () => { inp.remove(); resolve(null); }, { once: true });
    document.body.appendChild(inp); inp.click();
  });
}

async function startImport() {
  const file = await pickFile(); if (!file) return;
  let text;
  try { text = await file.text(); } catch { toast('No se pudo leer el archivo.', true); return; }
  const p = parseBackup(text);
  if (!p.ok) { toast(p.message, true); return; }
  const empty = !hasAnyData();
  const integ = p.integrity === 'ok' ? '<div class="banner info"><span>✓</span><span><b>Integridad verificada.</b> El archivo está completo y sin cambios.</span></div>'
    : p.integrity === 'mismatch' ? '<div class="banner bad"><span>⚠️</span><span><b>El archivo fue modificado o se dañó.</b> Puedes importarlo bajo tu responsabilidad.</span></div>'
    : '<div class="banner"><span>ℹ️</span><span>Este archivo no trae checksum (no se puede verificar su integridad).</span></div>';
  openSheet({
    title: 'Importar respaldo',
    html: `${integ}<div class="card" style="margin:12px 0"><b>Contenido del archivo</b><p class="small muted" style="margin:6px 0 0">${p.counts.habits} hábitos · ${p.counts.logs} marcas · ${p.counts.blocks} bloques · ${p.counts.reflections} check-ins${p.exportedAt ? '<br>Creado: ' + fmtDateTime(p.exportedAt) : ''}${p.dropped ? `<br><span class="warn-t">${p.dropped} registro(s) inválido(s) se descartarán.</span>` : ''}</p></div>
      <div class="field"><span class="lbl">¿Cómo importar?</span><div class="seg" data-seg="mode">
        <button type="button" data-v="replace" aria-pressed="${empty}">Reemplazar todo</button><button type="button" data-v="merge" aria-pressed="${!empty}">Combinar</button></div>
        <p class="small muted" id="imp-help" style="margin:4px 0 0"></p></div>
      ${p.integrity === 'mismatch' ? '<label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="imp-ok"> Entiendo el riesgo y quiero importarlo</label>' : ''}
      <div class="actions"><button class="btn primary block" id="imp-go">Importar</button></div>`,
    onMount: (el, { close }) => {
      let mode = empty ? 'replace' : 'merge';
      const help = () => { el.querySelector('#imp-help').textContent = mode === 'replace' ? (empty ? 'Esta app está vacía: se cargará todo el contenido del archivo.' : 'Se reemplazará todo lo actual. Guardamos una copia para poder deshacer.') : 'Agrega lo que falta; si algo existe en ambos, gana lo más reciente. Nunca borra nada.'; };
      pressedGroup(el.querySelector('[data-seg="mode"]'), 'button', (v) => { mode = v; help(); }); help();
      el.querySelector('#imp-go').onclick = async () => {
        if (p.integrity === 'mismatch' && !el.querySelector('#imp-ok').checked) { toast('Marca la casilla para continuar.', true); return; }
        try {
          const res = await applyImport(p, mode);
          close();
          openSheet({
            title: res.verified ? 'Importación verificada ✓' : 'Importación terminada',
            html: `<div class="banner ${res.verified ? 'info' : 'bad'}"><span>${res.verified ? '✓' : '⚠️'}</span><span>${res.verified ? '<b>Verificado:</b> la app tiene exactamente lo que había en el archivo.' : 'No se pudo verificar la copia. Revisa tus datos.'}</span></div>
              <p>Ahora tienes: <b>${res.counts.habits}</b> hábitos · <b>${res.counts.logs}</b> marcas · <b>${res.counts.blocks}</b> bloques · <b>${res.counts.reflections}</b> check-ins.</p>
              ${res.stats ? `<p class="small muted">Combinar: ${res.stats.added} agregados, ${res.stats.updated} actualizados.</p>` : ''}
              <p class="small muted">Compara estos totales con los del teléfono anterior para confirmar que la migración salió bien.</p>
              <div class="actions"><button class="btn primary block" data-ok>Listo</button></div>`,
            onMount: (e2, c2) => { e2.querySelector('[data-ok]').onclick = () => { c2.close(); session.go('hoy'); }; },
          });
        } catch (e) { toast('No se pudo importar: ' + e.message, true); }
      };
    },
  });
}

/* ---------- Pantalla de ajustes ---------- */
async function openSettings() {
  const st = backupStatus(), undo = await hasUndo();
  let persisted = null, usage = null;
  try { persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null; usage = navigator.storage?.estimate ? (await navigator.storage.estimate()).usage : null; } catch { /* sin datos */ }
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const set = state.settings;
  const seg = (name, items, cur) => `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  openSheet({
    title: 'Ajustes',
    html: `<div class="card" style="margin-bottom:14px"><h2 style="margin-bottom:6px">Respaldo y migración</h2>
        <div class="banner ${st.bad ? '' : 'info'}" style="margin-bottom:10px"><span>${st.bad ? '⚠️' : '✓'}</span><span>${st.text}<br><span class="small">${counts()}</span></span></div>
        <div class="actions"><button class="btn primary block" data-act="export">Exportar respaldo completo (JSON)</button>
          <button class="btn block" data-act="import">Elegir archivo de respaldo (.json)</button>
          ${undo ? '<button class="btn block" data-act="undo">Deshacer última importación</button>' : ''}</div>
        <p class="tiny muted" style="margin-bottom:0">Un solo archivo con todos tus hábitos, rachas, itinerarios y check-ins. Guarda dos copias en lugares distintos (Archivos + Drive/iCloud privado). El archivo no está cifrado: no lo compartas públicamente.</p></div>
      <div class="card" style="margin-bottom:14px"><h2 style="margin-bottom:8px">Apariencia</h2>${seg('theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], set.theme)}</div>
      <div class="card" style="margin-bottom:14px"><h2 style="margin-bottom:4px">Mi ritmo de energía</h2><p class="small muted" style="margin-top:0">Define cuándo conviene tu trabajo profundo. Se dibuja en el mapa del Plan.</p>
        ${seg('chrono', Object.entries(CHRONOTYPES).map(([k, v]) => [k, v.label]), set.chronotype)}<p class="small muted" id="chr-hint" style="margin:8px 0 0">${CHRONOTYPES[set.chronotype].hint}</p></div>
      <div class="card" style="margin-bottom:14px"><h2 style="margin-bottom:6px">Aprende el método</h2><p class="small muted" style="margin-top:0">Regla de 2 minutos, anclaje, identidad, rachas flexibles y más.</p>
        <button class="btn soft block" data-act="learn">Abrir la guía de coaching</button></div>
      <div class="card" style="margin-bottom:14px"><h2 style="margin-bottom:6px">Almacenamiento</h2>
        <p class="small" style="margin:0 0 8px">Protección contra borrado: <b>${persisted === null ? 'no disponible' : persisted ? 'activa' : 'no garantizada'}</b>${usage != null ? ` · uso: ${usage < 1048576 ? Math.max(1, Math.round(usage / 1024)) + ' KB' : (usage / 1048576).toFixed(1) + ' MB'}` : ''}<br>App instalada: <b>${standalone ? 'sí' : 'no (se recomienda instalar)'}</b></p>
        ${persisted === false ? '<button class="btn sm" data-act="persist">Solicitar protección</button>' : ''}
        ${!standalone && session.installPrompt ? '<button class="btn sm soft" data-act="install">Instalar en pantalla de inicio</button>' : ''}</div>
      <div class="card"><h2 style="margin-bottom:8px">Datos</h2><div class="actions"><button class="btn block" data-act="demo">Cargar datos de ejemplo</button>
        <button class="btn danger block" data-act="wipe">Borrar todo y empezar de cero</button></div>
        <p class="tiny muted" style="margin:10px 0 0">Ritmo ${APP_VERSION} · 100 % local: sin cuentas, sin servidores, sin seguimiento.</p></div>`,
    onMount: (el, { close }) => {
      pressedGroup(el.querySelector('[data-seg="theme"]'), 'button', (v) => saveSettings({ theme: v }));
      pressedGroup(el.querySelector('[data-seg="chrono"]'), 'button', async (v) => { await saveSettings({ chronotype: v, energyMap: energyMapFor(v) }); el.querySelector('#chr-hint').textContent = CHRONOTYPES[v].hint; toast('Mapa de energía actualizado'); });
      el.addEventListener('click', async (ev) => {
        const t = ev.target.closest('[data-act]'); if (!t) return;
        const a = t.dataset.act;
        if (a === 'export') {
          try { const r = await exportBackup(); if (r.result !== 'cancelled') { toast(`Respaldo listo: ${r.counts.habits} hábitos · ${r.counts.logs} marcas · ${r.counts.blocks} bloques. Guárdalo en un lugar seguro.`); close(); } }
          catch (e) { toast('No se pudo exportar: ' + e.message, true); }
        } else if (a === 'import') { close(); startImport(); }
        else if (a === 'undo') {
          const ok = await confirmSheet({ title: '¿Deshacer la última importación?', message: 'Volverás a los datos que tenías justo antes de importar.', ok: 'Deshacer' });
          if (ok && await undoLastImport()) { close(); toast('Importación deshecha'); }
        } else if (a === 'learn') { close(); openLearn(); }
        else if (a === 'persist') { try { const g = await navigator.storage.persist(); toast(g ? 'Protección activada' : 'El navegador no la concedió. Haz respaldos semanales.', !g); } catch { toast('No disponible en este navegador.', true); } }
        else if (a === 'install') { try { session.installPrompt.prompt(); await session.installPrompt.userChoice; } catch { /* ignorar */ } session.installPrompt = null; close(); }
        else if (a === 'demo') { if (await loadDemoData()) close(); }
        else if (a === 'wipe') {
          const ok = await confirmSheet({ title: '¿Borrar todo?', message: 'Se eliminarán hábitos, rachas, itinerarios y check-ins de este teléfono. <b>No se puede deshacer.</b> ¿Ya exportaste un respaldo?', ok: 'Borrar todo', danger: true });
          if (ok) { await wipeEverything(); close(); session.go('hoy'); toast('Todo borrado. Empiezas de cero.'); }
        }
      });
    },
  });
}

return { loadDemoData, openLearn, openSettings, APP_VERSION };
})();

/* ── views/hoy.js ── */
const __m_views_hoy = (() => {
// Pantalla «Hoy»: prioridad, progreso en tiempo real, hábitos con anclaje, plan del día y cierre.
const { esc, delegate, todayISO, addDays, fmtDateLong, cap, toMin, nowMin, parseISO } = __m_util;
const { state, activeHabits, habitById, logStatus, setHabitStatus, blocksOn, toggleBlock, reflectionOn, saveSettings } = __m_store;
const { CATEGORIES, KINDS, ENERGY } = __m_schema;
const { isScheduled, isQuota, weekCount, streakOf } = __m_calc;
const { session } = __m_session;
const { greeting, NUDGES, STARTERS } = __m_content;
const { icon, toast, energyIcon, openSheet } = __m_ui;
const { streakChip, catDot, openHabitDetail, openHabitForm, createFromStarter } = __m_views_habitos;
const { openBlockForm, findSlot } = __m_views_plan;
const { loadDemoData } = __m_views_ajustes;

const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 200, 365];

/** Hábitos visibles ese día, con los anclados justo debajo de su ancla. */
function orderWithAnchors(list) {
  const ids = new Set(list.map((h) => h.id));
  const kids = new Map();
  for (const h of list) if (h.anchorId && ids.has(h.anchorId)) (kids.get(h.anchorId) || kids.set(h.anchorId, []).get(h.anchorId)).push(h);
  const out = [], seen = new Set();
  const walk = (h, stacked) => { if (seen.has(h.id)) return; seen.add(h.id); out.push({ h, stacked }); (kids.get(h.id) || []).forEach((k) => walk(k, true)); };
  list.filter((h) => !h.anchorId || !ids.has(h.anchorId)).forEach((h) => walk(h, false));
  list.forEach((h) => walk(h, false));
  return out;
}

async function toggleHabit(id, date, kind) {
  const cur = logStatus(id, date);
  const next = kind === 'mini' ? (cur === 'mini' ? null : 'mini') : (cur === 'done' ? null : 'done');
  await setHabitStatus(id, date, next);
  if (!next) return;
  navigator.vibrate?.(10);
  const h = habitById(id), s = h && streakOf(h);
  if (s && MILESTONES.includes(s.current)) toast(`🔥 ¡${s.current} ${s.unit} seguidos con «${h.name}»!`);
}

function habitRow(h, date, stacked) {
  const st = logStatus(h.id, date);
  const anchor = h.anchorId ? habitById(h.anchorId) : null;
  const q = isQuota(h) ? `<span>${weekCount(h, date)}/${h.freq.times} esta semana</span>` : '';
  const hint = anchor && !stacked ? `<span>Después de «${esc(anchor.name)}»</span>` : (h.cue ? `<span>${esc(h.cue)}</span>` : '');
  return `<div class="item ${st ? 'done' : ''} ${stacked ? 'stacked' : ''}">
    <button class="chk ${st === 'mini' ? 'mini' : ''}" data-act="hab" data-id="${h.id}" aria-pressed="${!!st}" aria-label="${st ? 'Desmarcar' : 'Marcar'}: ${esc(h.name)}">${icon('check')}</button>
    <span class="ico">${esc(h.icon)}</span>
    <button class="body" data-act="open" data-id="${h.id}"><div class="nm">${esc(h.name)}</div>
      <div class="sub">${catDot(h.category)}${st === 'mini' ? '<span>hecho en versión mínima</span>' : ''}${q}${hint}${streakChip(h, date)}</div></button>
    ${h.minimal && st !== 'done' ? `<button class="mini-btn" data-act="mini" data-id="${h.id}" aria-pressed="${st === 'mini'}" title="Versión de 2 minutos: ${esc(h.minimal)}" style="${st === 'mini' ? 'border-style:solid;border-color:var(--brand);color:var(--brand-strong)' : ''}">2′</button>` : ''}
  </div>`;
}

function blockRow(b, isToday) {
  const k = KINDS[b.kind], on = isToday && nowMin() >= toMin(b.start) && nowMin() < toMin(b.end) && !b.done;
  return `<div class="item ${b.done ? 'done' : ''}" style="${on ? 'border-color:var(--brand)' : ''}"><span class="kbar" style="background:${k.color}"></span>
    <button class="chk" data-act="blk" data-id="${b.id}" aria-pressed="${b.done}" aria-label="Completar: ${esc(b.title)}">${icon('check')}</button>
    <button class="body" data-act="editblk" data-id="${b.id}"><div class="nm">${esc(b.title)}</div>
      <div class="sub"><span class="time">${b.start}–${b.end}</span><span>${k.short}</span><span>${energyIcon(b.energy)} ${ENERGY[b.energy].label}</span>${on ? '<span class="warn-t" style="color:var(--brand-strong)">● ahora</span>' : ''}</div></button></div>`;
}

function welcome() {
  return `<div class="card"><h2 style="font-size:1.25rem">Bienvenido a Ritmo 🌱</h2>
    <p class="muted">Tu sistema personal de hábitos e itinerario. Funciona <b>sin internet</b> y tus datos viven <b>solo en tu teléfono</b>.</p>
    <div class="tip"><b>La regla para no abrumarte</b>Empieza con <b>un solo hábito</b> y su versión de 2 minutos. Elige uno:</div>
    <div class="list">${STARTERS.map((s, i) => `<button class="item" data-act="starter" data-i="${i}"><span class="ico">${s.icon}</span><div class="body"><div class="nm">${esc(s.name)}</div><div class="sub">En su versión de 2 min: ${esc(s.minimal)}</div></div></button>`).join('')}</div>
    <div class="actions" style="margin-top:12px"><button class="btn soft block" data-act="newhab">Crear mi propio hábito</button>
      <button class="btn block" data-act="demo">Explorar con datos de ejemplo</button></div></div>`;
}

function viewHoy() {
  const today = todayISO(), date = session.dateHoy, isToday = date === today;
  const habits = activeHabits().filter((h) => isQuota(h) ? date >= h.startDate : isScheduled(h, date));
  const blocks = blocksOn(date);
  if (!state.habits.length && !state.blocks.length) {
    return { title: greeting(new Date().getHours()), subtitle: cap(fmtDateLong(today)), html: welcome(), bind: bindHoy };
  }
  const hDone = habits.filter((h) => logStatus(h.id, date)).length, bDone = blocks.filter((b) => b.done).length;
  const total = habits.length + blocks.length, done = hDone + bDone;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const prio = reflectionOn(addDays(date, -1))?.priority;
  const nowMin_ = nowMin();
  const cur = isToday ? blocks.find((b) => !b.done && toMin(b.start) <= nowMin_ && nowMin_ < toMin(b.end)) : null;
  const nxt = isToday && !cur ? blocks.find((b) => !b.done && toMin(b.start) > nowMin_) : null;
  const focus = cur ? `<div class="banner info"><span>▶</span><span><b>Ahora:</b> ${esc(cur.title)} · ${cur.start}–${cur.end} (${KINDS[cur.kind].short.toLowerCase()}, energía ${ENERGY[cur.energy].label.toLowerCase()})</span></div>`
    : nxt ? `<div class="banner info"><span>⏭</span><span><b>Siguiente:</b> ${esc(nxt.title)} a las ${nxt.start}</span></div>` : '';
  const checkin = reflectionOn(date)
    ? '<div class="banner info"><span>✓</span><span>Check-in del día completado. Buen cierre.</span></div>'
    : `<button class="btn ${isToday && new Date().getHours() >= 18 ? 'primary' : 'soft'} block" data-act="reflect">Hacer el check-in del día (3 preguntas)</button>`;
  const nudge = NUDGES[Math.floor(parseISO(date).getTime() / 86400000) % NUDGES.length];
  const ordered = orderWithAnchors(habits);
  return {
    title: isToday ? greeting(new Date().getHours()) : 'Repaso del día', subtitle: cap(fmtDateLong(date)),
    html: `<div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px">
        <button class="icon-btn" data-act="prev" aria-label="Día anterior">${icon('left')}</button>
        <div style="text-align:center"><b>${isToday ? 'Hoy' : cap(fmtDateLong(date))}</b>${isToday ? '' : '<br><button class="link small" data-act="gotoday">Volver a hoy</button>'}</div>
        <button class="icon-btn" data-act="next" aria-label="Día siguiente" ${isToday ? 'disabled style="opacity:.35"' : ''}>${icon('right')}</button></div>
      ${prio ? `<div class="card" style="border-color:var(--brand)"><div class="card-h" style="margin-bottom:6px"><span class="chip" style="background:var(--brand-soft);color:var(--brand-strong)">Prioridad innegociable</span></div>
        <div style="font-weight:650;font-size:1.05rem">${esc(prio)}</div>
        <button class="link small" data-act="blockprio" data-t="${esc(prio)}" style="margin-top:6px">Bloquear tiempo para esto →</button></div>` : ''}
      <div class="card"><div class="card-h"><div><div class="big-num">${pct}%</div><div class="small muted">del día completado</div></div>
        <div class="small" style="text-align:right"><div>Hábitos <b>${hDone}/${habits.length}</b></div><div>Plan <b>${bDone}/${blocks.length}</b></div></div></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso del día"><i style="width:${pct}%"></i></div>
        <p class="small muted" style="margin:10px 0 0">${total && done === total ? '🎉 Día completo. Cierra con tu check-in.' : esc(nudge)}</p></div>
      ${focus}
      <div><div class="card-h"><h2>Hábitos</h2><button class="link small" data-act="newhab">+ Nuevo</button></div>
        ${habits.length ? `<div class="list">${ordered.map(({ h, stacked }) => habitRow(h, date, stacked)).join('')}</div>` : '<div class="card empty small">Hoy no toca ningún hábito. Descansa o crea uno.</div>'}</div>
      <div><div class="card-h"><h2>Plan del día</h2><button class="link small" data-act="plan">${blocks.length ? 'Abrir plan' : '+ Planificar'}</button></div>
        ${blocks.length ? `<div class="list">${blocks.map((b) => blockRow(b, isToday)).join('')}</div>` : '<div class="card empty small">Aún no hay bloques para este día.</div>'}</div>
      ${checkin}`,
    bind: bindHoy,
  };
}

function bindHoy(page) {
  delegate(page, 'click', '[data-act]', async (ev, t) => {
    const a = t.dataset.act, date = session.dateHoy, today = todayISO();
    if (a === 'hab') await toggleHabit(t.dataset.id, date, 'done');
    else if (a === 'mini') await toggleHabit(t.dataset.id, date, 'mini');
    else if (a === 'open') openHabitDetail(t.dataset.id);
    else if (a === 'blk') { await toggleBlock(t.dataset.id); navigator.vibrate?.(8); }
    else if (a === 'editblk') openBlockForm(t.dataset.id);
    else if (a === 'prev') { session.dateHoy = addDays(date, -1); session.refresh(); }
    else if (a === 'next' && date < today) { session.dateHoy = addDays(date, 1); session.refresh(); }
    else if (a === 'gotoday') { session.dateHoy = today; session.refresh(); }
    else if (a === 'plan') { session.datePlan = date; session.go('plan'); }
    else if (a === 'reflect') { session.dateRef = date; session.go('reflexion'); }
    else if (a === 'newhab') openHabitForm(null);
    else if (a === 'starter') await createFromStarter(+t.dataset.i);
    else if (a === 'demo') await loadDemoData();
    else if (a === 'blockprio') {
      const at = findSlot(date, 'high', 90);
      openBlockForm(null, { date, title: t.dataset.t.slice(0, 100), kind: 'deep', energy: 'high', ...(at ? { start: at, end: `${String(Math.floor((toMin(at) + 90) / 60)).padStart(2, '0')}:${String((toMin(at) + 90) % 60).padStart(2, '0')}` } : {}) });
    }
  });
}

return { toggleHabit, viewHoy };
})();

/* ── views/reflexion.js ── */
const __m_views_reflexion = (() => {
// Check-in diario (metacognición): 3 preguntas guiadas, ánimo e historial.
const { esc, delegate, todayISO, addDays, fmtDateLong, fmtDateShort, cap } = __m_util;
const { state, reflectionOn, saveReflection, blocksOn, activeHabits } = __m_store;
const { dayCompletion, reflectionStreak } = __m_calc;
const { QUESTIONS, MOODS } = __m_content;
const { session } = __m_session;
const { icon, toast, pressedGroup, pressedValue } = __m_ui;
const { openBlockForm, findSlot } = __m_views_plan;

function viewReflexion() {
  const today = todayISO(), date = session.dateRef, isToday = date === today;
  const r = reflectionOn(date) || { worked: '', drained: '', priority: '', mood: 0 };
  const c = dayCompletion(date), blocks = blocksOn(date), bd = blocks.filter((b) => b.done).length;
  const streak = reflectionStreak(today);
  const history = [...state.reflections.values()].filter((x) => x.date !== date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
  const q = QUESTIONS.map((x, i) => `<div class="field"><label for="rf-${x.key}">${i + 1}. ${x.label}</label>
      <textarea id="rf-${x.key}" maxlength="${x.key === 'priority' ? 300 : 600}" placeholder="${esc(x.ph)}" rows="${x.key === 'priority' ? 2 : 3}">${esc(r[x.key])}</textarea>
      <span class="tiny muted">${x.hint}</span></div>`).join('');
  return {
    title: 'Check-in', subtitle: cap(fmtDateLong(date)) + (isToday ? ' · hoy' : ''),
    html: `<div class="card" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px">
        <button class="icon-btn" data-act="prev" aria-label="Día anterior">${icon('left')}</button>
        <div style="text-align:center"><b>${isToday ? 'Hoy' : fmtDateShort(date)}</b>${isToday ? '' : '<br><button class="link small" data-act="gotoday">Volver a hoy</button>'}</div>
        <button class="icon-btn" data-act="next" aria-label="Día siguiente" ${isToday ? 'disabled style="opacity:.35"' : ''}>${icon('right')}</button></div>
      <div class="card"><div class="card-h"><h2>Tu día en números</h2>${streak ? `<span class="chip">📝 ${streak} ${streak === 1 ? 'día' : 'días'} de check-in</span>` : ''}</div>
        <div class="stats"><div class="stat"><b>${c.total ? Math.round(c.pct * 100) + '%' : '–'}</b><span>hábitos (${c.done}/${c.total})</span></div>
        <div class="stat"><b>${blocks.length ? bd + '/' + blocks.length : '–'}</b><span>bloques del plan</span></div>
        <div class="stat"><b>${r.mood ? MOODS[r.mood - 1][0] : '–'}</b><span>ánimo</span></div></div></div>
      <form id="rf" class="card" novalidate><h2 style="margin-bottom:4px">3 preguntas para cerrar el día</h2><p class="small muted" style="margin-top:0">Una frase basta. No se trata de escribir bien, sino de mirarte con claridad.</p>
        ${q}
        <div class="field"><span class="lbl">¿Cómo cierras el día?</span><div class="mood" data-seg="mood">${MOODS.map(([e, l], i) => `<button type="button" data-v="${i + 1}" aria-pressed="${r.mood === i + 1}" aria-label="${l}" title="${l}">${e}</button>`).join('')}</div></div>
        <div class="actions"><button class="btn primary block" type="submit">Guardar check-in</button></div>
        <p id="rf-after" class="small ${r.priority ? '' : 'hidden'}" style="margin-bottom:0"><button type="button" class="link" data-act="block">Bloquear tiempo para tu prioridad de mañana →</button></p></form>
      ${history.length ? `<div><div class="card-h"><h2>Tus últimos check-ins</h2></div>${history.map((h) => `<details><summary>${fmtDateShort(h.date)} ${h.mood ? MOODS[h.mood - 1][0] : ''}</summary><div class="small">
          ${h.worked ? `<p><b>Funcionó:</b> ${esc(h.worked)}</p>` : ''}${h.drained ? `<p><b>Perdí energía:</b> ${esc(h.drained)}</p>` : ''}${h.priority ? `<p><b>Prioridad:</b> ${esc(h.priority)}</p>` : ''}
          <button class="link" data-act="goto" data-d="${h.date}">Editar este día</button></div></details>`).join('')}</div>` : ''}`,
    bind(page) {
      pressedGroup(page.querySelector('[data-seg="mood"]'), 'button');
      page.querySelector('#rf-priority').addEventListener('input', (e) => page.querySelector('#rf-after').classList.toggle('hidden', !e.target.value.trim()));
      delegate(page, 'click', '[data-act]', (ev, t) => {
        const a = t.dataset.act;
        if (a === 'prev') { session.dateRef = addDays(date, -1); session.refresh(); }
        else if (a === 'next' && date < today) { session.dateRef = addDays(date, 1); session.refresh(); }
        else if (a === 'gotoday') { session.dateRef = today; session.refresh(); }
        else if (a === 'goto') { session.dateRef = t.dataset.d; session.refresh(); window.scrollTo(0, 0); }
        else if (a === 'block') {
          const title = page.querySelector('#rf-priority').value.trim().slice(0, 100), tomorrow = addDays(date, 1), at = findSlot(tomorrow, 'high', 90);
          const mm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          const s = at ? at.split(':').reduce((h, m) => h * 60 + +m) : null;
          openBlockForm(null, { date: tomorrow, title, kind: 'deep', energy: 'high', ...(at ? { start: at, end: mm(s + 90) } : {}) });
        }
      });
      page.querySelector('#rf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const val = (k) => page.querySelector('#rf-' + k).value.trim();
        const mood = +(pressedValue(page, '[data-seg="mood"] button') || 0);
        const rec = await saveReflection({ date, worked: val('worked'), drained: val('drained'), priority: val('priority'), mood });
        toast(rec ? (rec.priority ? '✓ Check-in guardado. Tu prioridad te espera mañana.' : '✓ Check-in guardado.') : 'Escribe al menos una respuesta para guardar.', !rec);
      });
    },
  };
}

return { viewReflexion };
})();

/* ── views/progreso.js ── */
const __m_views_progreso = (() => {
// Mini-dashboard didáctico: cumplimiento semanal, efectividad del itinerario, energía y rachas.
const { esc, delegate, todayISO, addDays, weekStart, DIAS_INI, parseISO, toMin, fromMin } = __m_util;
const { state, activeHabits, logStatus } = __m_store;
const { CATEGORIES, KINDS } = __m_schema;
const { dayCompletion, rangeCompletion, blockStats, deepMinutes, alignmentRate, categoryRates, streakOf, insights, reflectionStreak } = __m_calc;
const { heatmapHTML, barsSVG, ringSVG } = __m_charts;
const { MOODS } = __m_content;
const { openLearn } = __m_views_ajustes;
const { catDot } = __m_views_habitos;

const pct = (r) => (r === null || r === undefined ? null : Math.round(r * 100));
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}` : `${min} min`);

function ringCard(title, value, sub, tip) {
  return `<div class="card" style="text-align:center;padding:12px 6px"><div style="display:grid;place-items:center">${ringSVG(value, 72, `${title}: ${value === null ? 'sin datos' : Math.round(value * 100) + ' %'}`)}</div>
    <div style="font-weight:650;font-size:.82rem;margin-top:6px">${title}</div><div class="tiny muted">${sub}</div></div>`;
}

function viewProgreso() {
  const today = todayISO(), ws = weekStart(today), pws = addDays(ws, -7);
  const habits = activeHabits();
  if (!habits.length && !state.blocks.length) {
    return { title: 'Análisis', subtitle: 'Tu rendimiento personal', html: '<div class="card empty"><div class="big">📊</div><b>Aún no hay datos</b><p class="small">Crea un hábito y márcalo unos días: aquí verás tu constancia, tu energía y tus rachas.</p></div>', bind() {} };
  }
  const wk = rangeCompletion(ws, today), pwk = rangeCompletion(pws, addDays(ws, -1));
  const delta = wk.pct !== null && pwk.pct !== null ? Math.round((wk.pct - pwk.pct) * 100) : null;
  const bs = blockStats(addDays(today, -6), today), al = alignmentRate(addDays(today, -6), today);
  const deep = deepMinutes(ws, today);
  const bars = Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { label: DIAS_INI[parseISO(d).getDay()], pct: dayCompletion(d).pct, today: d === today }; });
  const cats = categoryRates(addDays(today, -29), today);
  const ranked = habits.map((h) => ({ h, s: streakOf(h, today) })).sort((a, b) => b.s.current - a.s.current || b.s.best - a.s.best).slice(0, 5);
  const ins = insights(today);
  const moods = [...state.reflections.values()].filter((r) => r.mood && r.date >= addDays(today, -13));
  const moodAvg = moods.length ? moods.reduce((s, r) => s + r.mood, 0) / moods.length : null;
  const rs = reflectionStreak(today);
  return {
    title: 'Análisis', subtitle: 'Constancia, energía y enfoque',
    html: `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        ${ringCard('Hábitos', wk.pct, 'esta semana')}${ringCard('Itinerario', bs.pct, 'últimos 7 días')}${ringCard('Energía', al, 'alineación 7 d')}</div>
      <div class="card"><div class="card-h"><h2>Cumplimiento semanal</h2>
        ${delta === null ? '' : `<span class="chip" style="${delta >= 0 ? 'background:var(--brand-soft);color:var(--brand-strong)' : ''}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} pts vs. semana pasada</span>`}</div>
        <p class="small muted" style="margin-top:0">${wk.total ? `${wk.done} de ${wk.total} hábitos cumplidos esta semana.` : 'Aún sin hábitos esta semana.'} Lo que importa es la constancia, no la perfección.</p>
        ${barsSVG(bars)}</div>
      <div class="card"><div class="card-h"><h2>Constancia (12 semanas)</h2></div>${heatmapHTML(12, today)}</div>
      <div class="card"><div class="card-h"><h2>Itinerario y trabajo profundo</h2></div>
        <div class="stats"><div class="stat"><b>${bs.total ? bs.done + '/' + bs.total : '–'}</b><span>bloques hechos (7 d)</span></div>
          <div class="stat"><b>${deep.planned ? hm(deep.done) : '–'}</b><span>${deep.planned ? 'profundo de ' + hm(deep.planned) : 'profundo (semana)'}</span></div>
          <div class="stat"><b>${al === null ? '–' : pct(al) + '%'}</b><span>alineación de energía</span></div></div>
        ${Object.entries(bs.byKind).length ? `<div style="margin-top:12px">${Object.entries(bs.byKind).map(([k, v]) => `<div class="rate-row"><span><span class="dot" style="background:${KINDS[k].color}"></span> ${KINDS[k].label}</span><b>${v.done}/${v.total}</b><div class="progress"><i style="width:${Math.round((v.done / v.total) * 100)}%"></i></div></div>`).join('')}</div>` : ''}</div>
      ${Object.keys(cats).length ? `<div class="card"><div class="card-h"><h2>Por categoría (30 días)</h2></div>${Object.entries(cats).map(([k, v]) => `<div class="rate-row"><span>${catDot(k)} ${CATEGORIES[k].label}</span><b>${pct(v)}%</b><div class="progress"><i style="width:${pct(v)}%"></i></div></div>`).join('')}</div>` : ''}
      ${ranked.length ? `<div class="card"><div class="card-h"><h2>Rachas flexibles</h2></div>${ranked.map(({ h, s }) => `<div class="rate-row" style="margin-bottom:8px"><span>${esc(h.icon)} ${esc(h.name)}</span><b>${s.current ? '🔥 ' + s.current : '–'} <span class="muted small">/ mejor ${s.best} ${s.unit === 'semanas' ? 'sem' : ''}</span></b></div>`).join('')}</div>` : ''}
      <div class="card"><div class="card-h"><h2>Reflexión</h2></div><div class="stats" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat"><b>${rs}</b><span>${rs === 1 ? 'día' : 'días'} seguidos de check-in</span></div>
        <div class="stat"><b>${moodAvg === null ? '–' : MOODS[Math.round(moodAvg) - 1][0]}</b><span>ánimo medio (14 días)</span></div></div></div>
      <div class="card"><div class="card-h"><h2>Lo que dicen tus datos</h2></div>
        ${ins.length ? ins.map((i) => `<p style="margin:0 0 10px"><span aria-hidden="true">${i.icon}</span> ${esc(i.text)}</p>`).join('') : '<p class="muted small" style="margin:0">Con una o dos semanas de registros aparecerán aquí tus patrones: mejores días, hábitos frágiles y rachas en riesgo.</p>'}</div>
      <button class="btn block" data-act="learn">¿Cómo leer estas métricas?</button>`,
    bind(page) { delegate(page, 'click', '[data-act="learn"]', () => openLearn('metricas')); },
  };
}

return { viewProgreso };
})();

/* ── app.js ── */
const __m_app = (() => {
// Arranque: carcasa, navegación, tema, recordatorio de respaldo y service worker.
const { initStore, state, subscribe, hasAnyData } = __m_store;
const { session, syncToday } = __m_session;
const { icon, sheetsOpen, toast } = __m_ui;
const { exportBackup } = __m_backup;
const { todayISO, diffDays, esc } = __m_util;
const { viewHoy } = __m_views_hoy;
const { viewHabitos } = __m_views_habitos;
const { viewPlan } = __m_views_plan;
const { viewReflexion } = __m_views_reflexion;
const { viewProgreso } = __m_views_progreso;
const { openSettings } = __m_views_ajustes;

const VIEWS = { hoy: viewHoy, habitos: viewHabitos, plan: viewPlan, reflexion: viewReflexion, progreso: viewProgreso };
const NAV = [['hoy', 'Hoy', 'today'], ['habitos', 'Hábitos', 'habits'], ['plan', 'Plan', 'plan'], ['reflexion', 'Check-in', 'reflect'], ['progreso', 'Análisis', 'stats']];
let main, titleEl, subEl, navEl, lastTab = null;

function buildShell() {
  const app = document.getElementById('app');
  app.innerHTML = `<header class="topbar"><div class="title"><h1 id="t-title">Ritmo</h1><p id="t-sub" class="small muted"></p></div>
      <button class="icon-btn" id="btn-settings" aria-label="Ajustes y respaldo">${icon('gear')}</button></header>
    <main id="view" tabindex="-1" aria-live="polite"></main>`;
  navEl = document.createElement('nav');
  navEl.className = 'nav'; navEl.setAttribute('aria-label', 'Secciones');
  navEl.innerHTML = `<div class="nav-in">${NAV.map(([k, l, i]) => `<button data-tab="${k}" aria-label="${l}">${icon(i)}<span>${l}</span></button>`).join('')}</div>`;
  document.body.appendChild(navEl);
  main = document.getElementById('view'); titleEl = document.getElementById('t-title'); subEl = document.getElementById('t-sub');
  navEl.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
  document.getElementById('btn-settings').addEventListener('click', openSettings);
}

function applyTheme() {
  const t = state.settings.theme, root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131412' : '#f5f4f0');
}

function backupBanner() {
  if (session.tab !== 'hoy' || !hasAnyData()) return '';
  const today = todayISO();
  const since = state.lastBackupAt ? diffDays(state.lastBackupAt.slice(0, 10), today) : diffDays(state.settings.firstUseAt.slice(0, 10), today);
  if (state.lastBackupAt ? since < 7 : since < 2) return '';
  return `<div class="banner"><span>💾</span><span>${state.lastBackupAt ? `Tu último respaldo fue hace <b>${since} días</b>.` : 'Aún no has hecho <b>ningún respaldo</b>.'} Tus datos viven solo en este teléfono.
    <br><button class="link" data-act="backup-now">Respaldar ahora</button></span></div>`;
}

function render() {
  if (!state.ready) return;
  syncToday();
  const v = VIEWS[session.tab]();
  titleEl.textContent = v.title; subEl.textContent = v.subtitle || '';
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = backupBanner() + v.html;
  page.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act="backup-now"]')) return;
    try { const r = await exportBackup(); if (r.result !== 'cancelled') toast('Respaldo listo. Guárdalo en un lugar seguro.'); } catch (err) { toast('No se pudo exportar: ' + err.message, true); }
  });
  v.bind(page);
  const y = lastTab === session.tab ? window.scrollY : 0;
  main.replaceChildren(page);
  window.scrollTo(0, y);
  lastTab = session.tab;
  navEl.querySelectorAll('[data-tab]').forEach((b) => (b.dataset.tab === session.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

function go(tab) { session.tab = tab; lastTab = null; render(); }

function fatal(err) {
  document.getElementById('app').innerHTML = `<div class="page" style="padding-top:40px"><div class="card"><h2>No podemos guardar datos en este navegador</h2>
    <p>Ritmo guarda todo en tu teléfono, pero este navegador no lo permite. Suele pasar en <b>modo privado/incógnito</b> o si bloqueaste los datos del sitio.</p>
    <p class="small muted">Abre la app en una pestaña normal o instálala en la pantalla de inicio.</p><p class="tiny muted">${esc(err && err.message)}</p></div></div>`;
}

function setupUpdates() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const bar = (reg) => {
    if (document.getElementById('upd')) return;
    const d = document.createElement('div');
    d.id = 'upd'; d.className = 'toast'; d.style.display = 'flex'; d.style.gap = '12px'; d.style.alignItems = 'center';
    d.innerHTML = '<span>Hay una versión nueva de Ritmo</span><button class="btn sm primary" id="upd-go">Actualizar</button>';
    document.body.appendChild(d);
    d.querySelector('#upd-go').onclick = () => reg.waiting && reg.waiting.postMessage('SKIP_WAITING');
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) bar(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) bar(reg); });
    });
  }).catch(() => { /* sin service worker: la app sigue funcionando en línea */ });
  // Solo se recarga al ACTUALIZAR (ya había un service worker). En la primera visita el nuevo worker toma el control
  // sin recargar: así nunca se pierde un formulario a medias.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

async function boot() {
  buildShell();
  session.go = go; session.refresh = render;
  try { await initStore(); } catch (e) { fatal(e); return; }
  applyTheme();
  subscribe(() => { applyTheme(); render(); });
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* opcional */ }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); session.installPrompt = e; });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  const idleRefresh = () => {
    const a = document.activeElement;
    if (sheetsOpen() || session.tab === 'reflexion' || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    render();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) idleRefresh(); });
  setInterval(() => { if (!document.hidden) idleRefresh(); }, 60000);
  render();
  setupUpdates();
  window.__ritmo = { state, go, render };
}

boot();

return { applyTheme, render, go };
})();
})();
