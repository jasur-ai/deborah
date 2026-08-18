/**
 * Edikit — Firebase Admin SDK
 * 
 * 🔥 Real Firebase Realtime Database ga ulanadi (agar kredensial bo'lsa)
 * 💻 Agar kredensial bo'lmasa, local-db.js (data/db.json) ga tayanadi
 * 
 * Qo'llab-quvvatlanadigan kredensial formatlari (ustuvorlik tartibida):
 *   1. FIREBASE_SERVICE_ACCOUNT         — service account JSON string (env)
 *   2. GOOGLE_APPLICATION_CREDENTIALS   — service account JSON fayl yo'li
 *   3. FIREBASE_SERVICE_ACCOUNT_PATH    — service account JSON fayl yo'li (.env)
 *   4. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY — alohida kalitlar (eski
 *      Next.js sessiya_pro formati; PRIVATE_KEY ichida \n literal bo'lishi mumkin)
 * 
 * Original Firebase config (sessiya-11767):
 *   databaseURL: https://sessiya-11767-default-rtdb.firebaseio.com
 *   projectId: sessiya-11767
 */

import 'dotenv/config';
import localDB from './local-db.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Firebase Admin SDK init ──
let _app = null;
let _db = null;
let USE_REAL_FIREBASE = false;
let _fbInstance = null;

// Try to initialize real Firebase
async function initFirebase() {
  // Test muhitida (NODE_ENV=test) REAL Firebase'ga ulanishni bloklaymiz —
  // testlar doim lokal DB (data/db.json) bilan ishlaydi. Bu test ma'lumotlari
  // cloud'ga yozilishini oldini oladi. Real Firebase faqat development /
  // production'da ishlaydi.
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  try {
    const { initializeApp, getApps, cert, getApp } = await import('firebase-admin/app');
    const { getDatabase } = await import('firebase-admin/database');

    const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://sessiya-11767-default-rtdb.firebaseio.com';
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sessiya-11767';

    let credential = null;
    let serviceAccount = null;
    const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (saEnv) {
      // Service account as JSON string
      serviceAccount = JSON.parse(saEnv);
    } else if (saPath && existsSync(resolve(saPath))) {
      // Service account as file path
      const raw = readFileSync(resolve(saPath), 'utf-8');
      serviceAccount = JSON.parse(raw);
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      // Legacy split-key format (sessiya_pro Next.js): CLIENT_EMAIL + PRIVATE_KEY.
      // PRIVATE_KEY ichidagi literal \n ni haqiqiy newline'ga o'tkazamiz.
      serviceAccount = {
        type: 'service_account',
        project_id: PROJECT_ID,
        private_key: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
      };
    }

    if (serviceAccount) {
      credential = cert(serviceAccount);
    }

    if (credential) {
      const existingApp = getApps().find(a => a.name === '[DEFAULT]');
      _app = existingApp || initializeApp({
        credential,
        databaseURL: DATABASE_URL,
        projectId: PROJECT_ID,
      });
      _db = getDatabase(_app);
      USE_REAL_FIREBASE = true;

      console.log('   ╔══════════════════════════════════════════════════╗');
      console.log('   ║  🔥  FIREBASE MODE                              ║');
      console.log('   ║──────────────────────────────────────────────────║');
      console.log(`   ║  Project: ${PROJECT_ID.padEnd(40)}║`);
      console.log('   ║  Status:  CONNECTED                              ║');
      console.log('   ╚══════════════════════════════════════════════════╝');
      console.log('');
      return true;
    }
  } catch (err) {
    console.log('   ⚠️  Firebase Admin SDK not available, using local DB');
  }
  return false;
}

// ── Firebase Realtime Database wrapper (Admin SDK API) ──
class FirebaseWrapper {
  constructor(realDb, localDb) {
    this._realDb = realDb;
    this._localDb = localDb;
    this._useReal = !!realDb;
  }

  ref(path) {
    if (this._useReal) {
      return this._realDb.ref(path);
    }
    return { path };
  }

  async get(path) {
    if (this._useReal) {
      const snap = await this._realDb.ref(path).once('value');
      return {
        exists: () => snap.exists(),
        val: () => snap.val(),
        toJSON: () => snap.toJSON(),
      };
    }
    return this._localDb.get(path);
  }

  async set(path, value) {
    if (this._useReal) {
      await this._realDb.ref(path).set(value);
      return true;
    }
    return this._localDb.set(path, value);
  }

  async update(path, value) {
    if (this._useReal) {
      await this._realDb.ref(path).update(value);
      return true;
    }
    return this._localDb.update(path, value);
  }

  async remove(path) {
    if (this._useReal) {
      await this._realDb.ref(path).remove();
      return true;
    }
    return this._localDb.remove(path);
  }

  /**
   * Atomic read-modify-write transaction (Cast answer/state races uchun).
   * Real Firebase: RTDB transaction.
   * Local DB: serialized process-lock orqali read-update-write.
   *
   * @param {string} path — transaction ishlaydigan path
   * @param {(current: any) => any} updater — pure updater; qaytgan qiymat yoziladi.
   *   updater null qaytarsa write amalga oshmaydi (abort).
   * @returns {Promise<{committed: boolean, value: any, previous: any}>}
   */
  async transaction(path, updater) {
    if (this._useReal) {
      const ref = this._realDb.ref(path);
      return new Promise((resolve, reject) => {
        ref.transaction((current) => {
          // RTDB transaction abort uchun updater null/undefined qaytarishi kerak
          return updater(current === null || current === undefined ? null : current);
        }, (err, committed, snapshot) => {
          if (err) return reject(err);
          resolve({
            committed: !!committed,
            value: snapshot ? snapshot.val() : null,
            previous: null,
          });
        });
      });
    }
    return this._localDb.transaction(path, updater);
  }
}

// ── Init + Seed check ──
const firebaseReady = await initFirebase();

if (!USE_REAL_FIREBASE) {
  // Initialize local database with seed data
  try {
    const { default: generateSeedData } = await import('./seed-data.js');
    await localDB.init(generateSeedData);
  } catch (err) {
    console.log('   ⚠️  Seed data not available, starting with empty DB');
    await localDB.init({});
  }
}

// ── Export unified API ──
_fbInstance = new FirebaseWrapper(_db, localDB);
export const fb = _fbInstance;
export { _app as app, USE_REAL_FIREBASE };
export default fb;

