/**
 * Edikit — Local JSON Database Engine
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const DB_FILE = resolve(DATA_DIR, 'db.json');

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
      const raw = readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(raw);
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
}

// ── Export singleton ──
const localDB = new LocalDB();
export default localDB;
export { LocalSnapshot };
