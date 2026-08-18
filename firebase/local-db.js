/**
 * Deborah — Local JSON Database Engine
 * 
 * Firebase Realtime Database API ni emulate qiladi.
 * JSON fayl asosida ishlaydi — hech qanday tashqi bog'liqlik yo'q.
 * 
 * API: fb.get(path), fb.set(path, value), fb.update(path, value), fb.remove(path)
 * Snapshoot: .exists(), .val()
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// AUTH B-01: users final schema — legacy user'larni normalize qilish (idempotent).
import { normalizeUserRecord } from '../src/modules/auth/user-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
// LOCAL_DB_FILE — visual/test server'lar uchun alohida DB (STEP 08):
// Playwright webServer har run'da toza DB bilan ishlaydi (deterministik
// dashboard raqamlari), real data/db.json esa buzilmaydi.
const DB_FILE = process.env.LOCAL_DB_FILE ? resolve(process.env.LOCAL_DB_FILE) : resolve(DATA_DIR, 'db.json');

// ── Ensure data directory exists ──
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── File lock to prevent concurrent write corruption ──
let writeLock = Promise.resolve();

// ── Read database from disk ──
function readDB() {
  try {
    if (existsSync(DB_FILE)) {
      return JSON.parse(readFileSync(DB_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('⚠️ Local DB read error, resetting:', err.message);
  }
  return {};
}

// ── Write database to disk ──
function writeDB(data) {
  writeLock = writeLock.then(() => {
    try {
      writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('⚠️ Local DB write error:', err.message);
    }
  });
  return writeLock;
}

// ── Navigate nested path (e.g., "users/john/tests/test123") ──
function navigate(data, path) {
  const parts = path.split('/').filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { parent: null, key: part, exists: false };
    }
    if (!(part in current)) {
      return { parent: current, key: part, exists: false };
    }
    current = current[part];
  }
  return { parent: null, key: null, value: current, exists: true };
}

function navigateWithParent(data, path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { parent: null, key: null, value: data, exists: true };
  }

  let current = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return { parent: null, key: parts[i], exists: false };
    }
    if (!(part in current)) {
      return { parent: current, key: parts[i], exists: false };
    }
    current = current[part];
  }

  const lastKey = parts[parts.length - 1];
  const exists = current !== null && typeof current === 'object' && lastKey in current;
  return {
    parent: current,
    key: lastKey,
    value: exists ? current[lastKey] : undefined,
    exists,
  };
}

// ── Navigate a path, creating missing intermediate objects (transaction-safe) ──
function navigateCreating(data, path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { parent: null, key: null, value: data, exists: true };
  }

  let current = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      // Yo'lda non-object qiymat — write'ni sokin tashlab yubormaymiz,
      // xato ko'taramiz (caller javobni bilishi kerak)
      throw new Error(`LocalDB transaction path broken at segment "${part}" (non-object parent)`);
    }
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }

  const lastKey = parts[parts.length - 1];
  const exists = current !== null && typeof current === 'object' && lastKey in current;
  return {
    parent: current,
    key: lastKey,
    value: exists ? current[lastKey] : undefined,
    exists,
  };
}

// ── Deep clone (prevents mutation) ──
function clone(val) {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val));
}

// ── Local Snapshot class (matches Firebase DataSnapshot API) ──
class LocalSnapshot {
  constructor(data) {
    this._data = data;
    this._exists = data !== null && data !== undefined;
  }

  exists() {
    return this._exists;
  }

  val() {
    return this._exists ? clone(this._data) : null;
  }

  toJSON() {
    return this.val();
  }
}

// ── Local Database API ──
class LocalDB {
  constructor() {
    this._data = {};
    this._initialized = false;
  }

  async init(seedFn) {
    if (this._initialized) return;
    this._data = readDB();

    // If empty, seed with demo data
    if (Object.keys(this._data).length === 0) {
      console.log('🌱 Local DB bo\'sh — seed ma\'lumotlar yuklanmoqda...');
      if (seedFn) {
        this._data = typeof seedFn === 'function' ? seedFn() : seedFn;
      }
      await writeDB(this._data);
      console.log(`✅ Local DB seed qilindi: ${Object.keys(this._data).length} ta asosiy yo\'nalish`);
    } else {
      console.log(`📦 Local DB yuklandi: ${Object.keys(this._data).length} ta asosiy yo\'nalish`);
      // ── Partial recovery: DB da ba'zi asosiy to'plamlar yo'q, lekin boshqa to'plamlar bor ──
      // (masalan cast_* to'plamlari test'lar davomida yozilgan). Login/preflight ishlamay
      // qolmasligi uchun seed'dan YETISHMAYOTGAN top-level to'plamlarni merge qilamiz —
      // mavjud to'plamlarga tegmaymiz.
      if (seedFn) {
        const seedData = typeof seedFn === 'function' ? seedFn() : seedFn;
        if (seedData && typeof seedData === 'object') {
          const missing = Object.keys(seedData).filter((k) => !(k in this._data));
          if (missing.length > 0) {
            for (const k of missing) this._data[k] = seedData[k];
            await writeDB(this._data);
            console.log(`✅ Local DB: ${missing.length} ta yetishmayotgan to'plam seed'dan qo'shildi (${missing.join(', ')})`);
          }
        }
      }
    }

    // ── Auto-migration (AUTH B-01): users final schema — legacy user'lar
    // canonical field'lar bilan to'ldiriladi (idempotent; isVip ham shu yerda).
    const users = this._data.users;
    if (users && typeof users === 'object') {
      let migrated = 0;
      for (const userKey of Object.keys(users)) {
        const user = users[userKey];
        if (!user || typeof user !== 'object') continue;
        const before = JSON.stringify(user);
        const normalized = normalizeUserRecord(user);
        if (JSON.stringify(normalized) !== before) {
          users[userKey] = normalized;
          migrated++;
        }
      }
      if (migrated > 0) {
        await writeDB(this._data);
        console.log(`   🔄 Migratsiya (B-01 users schema): ${migrated} ta foydalanuvchi normalize qilindi`);
      }
    }

    this._initialized = true;
  }

  /**
   * Get data at a path
   * @param {string} path — e.g., "users/john"
   * @returns {Promise<LocalSnapshot>}
   */
  async get(path) {
    this._data = readDB(); // Re-read for latest data
    const result = navigate(this._data, path);
    if (result.exists) {
      return new LocalSnapshot(result.value);
    }
    return new LocalSnapshot(null);
  }

  /**
   * Set (overwrite) data at a path
   * @param {string} path — e.g., "users/john"
   * @param {*} value
   */
  async set(path, value) {
    this._data = readDB();
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) {
      if (typeof value !== 'object' || value === null) return;
      this._data = clone(value);
    } else {
      let current = this._data;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
          current[part] = {};
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = clone(value);
    }
    await writeDB(this._data);
  }

  /**
   * Update (merge) data at a path
   * @param {string} path — e.g., "game_sessions/ABC12/state"
   * @param {object} value — partial data to merge
   */
  async update(path, value) {
    this._data = readDB();
    const result = navigateWithParent(this._data, path);
    if (result.parent !== null) {
      result.parent[result.key] = {
        ...(result.exists ? result.parent[result.key] : {}),
        ...clone(value),
      };
    } else if (result.key === null) {
      // Root level
      Object.assign(this._data, clone(value));
    }
    await writeDB(this._data);
  }

  /**
   * Remove data at a path
   * @param {string} path — e.g., "game_sessions/ABC12"
   */
  async remove(path) {
    this._data = readDB();
    const result = navigateWithParent(this._data, path);
    if (result.parent !== null) {
      delete result.parent[result.key];
    } else if (result.key === null) {
      this._data = {};
    }
    await writeDB(this._data);
  }

  /**
   * Atomic read-modify-write transaction (process-lock serialized).
   * Real Firebase transaction API'siga mos keladi.
   *
   * @param {string} path
   * @param {(current: any) => any} updater — pure updater; null qaytarsa abort
   * @returns {Promise<{committed: boolean, value: any, previous: any}>}
   */
  async transaction(path, updater) {
    // Process-lock: barcha transaction'lar navbatda bajariladi (race yo'q).
    // writeDB() chain'iga ulanmasdan o'z lock'ini boshqaramiz — aks holda
    // writeDB o'zi writeLock'ni chain qilgani uchun deadlock yuzaga keladi.
    const prev = writeLock;
    let resolveLock;
    writeLock = new Promise((r) => { resolveLock = r; });
    await prev;
    try {
      this._data = readDB();
      // Chuqur path'da oraliq segmentlar yo'q bo'lsa ham ularni YARATIB boramiz
      // (set() bilan bir xil logika) — aks holda javob xato darajaga yoziladi:
      // answers/q_02/{pid}/1 o'rniga answers/q_02 ga to'g'ridan-to'g'ri.
      const result = navigateCreating(this._data, path);
      const previous = result.exists ? clone(result.value) : null;
      const next = updater(previous);
      if (next === null || next === undefined) {
        return { committed: false, value: previous, previous };
      }

      if (result.parent !== null) {
        result.parent[result.key] = clone(next);
      } else if (result.key === null) {
        // Root-level transaction: merge semantics emas, to'liq almashtirish
        this._data = typeof next === 'object' && next !== null ? clone(next) : {};
      }
      // Transaction o'zi serialized — sync write xavfsiz
      writeFileSync(DB_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
      return { committed: true, value: clone(next), previous };
    } finally {
      resolveLock();
    }
  }
}

// ── Export singleton ──
const localDB = new LocalDB();
export default localDB;
export { LocalSnapshot };
