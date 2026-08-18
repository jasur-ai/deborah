/**
 * Deborah — IndexedDB Offline Journal (browser adapter)
 *
 * Prompt 32 — low-bandwidth/crash resilience (research.md §29). Keeps an
 * encrypted local journal of every response edit and syncs losslessly with
 * the server on reconnect.
 *
 * Contract (mirrors src/modules/offline/offline.schema.js — the same pure
 * functions are unit-tested server-side):
 *   - Every edit is appended as {seq, itemId, patch, clientTime, deviceId,
 *     epoch} with a monotonic per-(attempt, device) seq.
 *   - At-rest encryption: AES-GCM with a key derived from the attempt session
 *     secret (deriveJournalKey contract). The answer key is NEVER stored or
 *     derivable on the client (§29.3).
 *   - Online: send batches to POST /api/student/attempts/:id/offline/sync;
 *     the server ACKs the highest contiguous seq → durable entries dropped,
 *     the rest resent (lossless).
 *   - Emergency recovery: POST .../offline/export builds an immutable,
 *     checksum-signed package the student can download; a privileged admin
 *     imports it with a full audit trail.
 *   - A disconnect is NEVER a strike — the journal survives and syncs.
 *
 * Usage (ES module, loaded with type="module"):
 *   import { OfflineJournal } from '/js/offline-journal.js';
 *   const journal = new OfflineJournal({ attemptId, userId, epoch, sessionSecret });
 *   await journal.init();
 *   await journal.append({ itemId, patch });          // encrypt + store
 *   await journal.sync();                              // batch upload + ACK
 *   const pkg = await journal.exportRecovery();        // download failsafe
 */

(function (global) {
  'use strict';

  const DB_NAME = 'deborah-offline';
  const DB_VERSION = 1;
  const STORE_JOURNAL = 'journal';
  const STORE_META = 'meta';
  const MAX_BATCH = 200;

  /**
   * Derive the AES-GCM key — MUST match src/modules/offline/offline.schema.js
   * deriveJournalKey (server): PRK = HMAC-SHA256(key=salt, msg=sessionSecret);
   * OKM = HMAC-SHA256(key=PRK, msg=info || 0x01) where info =
   * `deborah-journal:v1:${attemptId}:${userId}:${deviceId}:${salt}`. Keeping the
   * browser derivation identical to the server keeps the "same contract"
   * claim true (e.g. for future server-assisted decryption of exports).
   */
  async function deriveKey({ sessionSecret, userId, attemptId, deviceId }) {
    const enc = new TextEncoder();
    // Must equal server JOURNAL_KEY_SALT (offline.schema.js) — non-empty so
    // WebCrypto importKey never throws DataError on a zero-length HMAC key.
    const salt = 'deborah-journal';
    // PRK = HMAC-SHA256(key=salt, msg=sessionSecret)
    const saltKey = await crypto.subtle.importKey(
      'raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const prk = await crypto.subtle.sign('HMAC', saltKey, enc.encode(String(sessionSecret)));
    // OKM = HMAC-SHA256(key=PRK, msg=info || 0x01)
    const info = enc.encode(`deborah-journal:v1:${attemptId}:${userId}:${deviceId}:${salt}`);
    const infoPlusOne = new Uint8Array(info.length + 1);
    infoPlusOne.set(info, 0);
    infoPlusOne[info.length] = 1;
    const okmKey = await crypto.subtle.importKey(
      'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const okm = await crypto.subtle.sign('HMAC', okmKey, infoPlusOne);
    return crypto.subtle.importKey('raw', okm, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  /** Bytes → base64 via a chunked binary string (spread would RangeError on large essay payloads). */
  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /** base64 → bytes. */
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Encrypt a payload at rest (AES-GCM with AAD = attempt:seq). */
  async function encrypt(key, payload, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(String(aad)) },
      key, new TextEncoder().encode(JSON.stringify(payload))
    );
    const combined = new Uint8Array(iv.length + enc.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(enc), iv.length);
    return bytesToBase64(combined);
  }

  /** Decrypt a payload (returns null on tamper). */
  async function decrypt(key, b64, aad) {
    try {
      const raw = base64ToBytes(b64);
      const iv = raw.slice(0, 12);
      const data = raw.slice(12);
      const dec = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(String(aad)) },
        key, data
      );
      return JSON.parse(new TextDecoder().decode(dec));
    } catch (_) {
      return null;
    }
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
          db.createObjectStore(STORE_JOURNAL, { keyPath: 'seq' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * OfflineJournal — encrypted IndexedDB journal for a single attempt.
   */
  class OfflineJournal {
    /**
     * @param {Object} opts
     * @param {number} opts.attemptId
     * @param {number|string} opts.userId
     * @param {number} opts.epoch - attempt epoch (bumped on teacher reopen)
     * @param {string} opts.sessionSecret - server-issued attempt session secret
     * @param {string} [opts.deviceId] - defaults to crypto-random fingerprint
     */
    constructor({ attemptId, userId, epoch, sessionSecret, deviceId = null }) {
      this.attemptId = attemptId;
      this.userId = userId;
      this.epoch = epoch;
      this.sessionSecret = sessionSecret;
      this.deviceId = deviceId || this._makeDeviceId();
      this.db = null;
      this.key = null;
      this.ackedSeq = 0;
      this._ready = null;
    }

    _makeDeviceId() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return 'dev-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** Open the DB, derive the key, load the acked watermark. */
    async init() {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        this.db = await openDB();
        this.key = await deriveKey({
          sessionSecret: this.sessionSecret,
          userId: this.userId,
          attemptId: this.attemptId,
          deviceId: this.deviceId,
        });
        const meta = await reqToPromise(tx(this.db, STORE_META, 'readonly').get('acked'));
        this.ackedSeq = (meta && meta.ackedSeq) || 0;
      })();
      return this._ready;
    }

    /**
     * Append an edit to the journal (encrypted at rest).
     * @param {Object} edit - { itemId, patch }
     * @returns {Promise<Object>} the stored journal entry
     */
    async append(edit) {
      await this.init();
      const nextSeq = this.ackedSeq + (await this._pendingCount()) + 1;
      const entry = {
        seq: nextSeq,
        itemId: edit.itemId,
        patch: edit.patch,
        clientTime: Date.now(),
        deviceId: this.deviceId,
        epoch: this.epoch,
      };
      const encrypted = await encrypt(this.key, entry, `${this.attemptId}:${entry.seq}`);
      const store = tx(this.db, STORE_JOURNAL, 'readwrite');
      await reqToPromise(store.put({ seq: entry.seq, enc: encrypted }));
      return entry;
    }

    async _pendingCount() {
      const store = tx(this.db, STORE_JOURNAL, 'readonly');
      const count = await reqToPromise(store.count());
      return count;
    }

    /** Read all journal entries (decrypted). */
    async _readAll() {
      const store = tx(this.db, STORE_JOURNAL, 'readonly');
      const all = await reqToPromise(store.getAll());
      const out = [];
      for (const row of all) {
        const dec = await decrypt(this.key, row.enc, `${this.attemptId}:${row.seq}`);
        if (dec) out.push(dec);
      }
      return out.sort((a, b) => a.seq - b.seq);
    }

    /**
     * Sync pending entries with the server (batch + ACK, lossless).
     * @returns {Promise<Object>} { ackedSeq, sent, results }
     */
    async sync() {
      await this.init();
      const entries = await this._readAll();
      const pending = entries.filter((e) => e.seq > this.ackedSeq).slice(0, MAX_BATCH);

      if (pending.length === 0) return { ackedSeq: this.ackedSeq, sent: 0, results: [] };

      const res = await fetch(`/api/student/attempts/${this.attemptId}/offline/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          epoch: this.epoch,
          entries: pending,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `sync failed: ${res.status}`);
      }

      const result = await res.json();
      const acked = result.ackedSeq || 0;

      // Drop durable entries (≤ acked) — they are server-persisted now.
      const store = tx(this.db, STORE_JOURNAL, 'readwrite');
      for (const e of entries) {
        if (e.seq <= acked) await reqToPromise(store.delete(e.seq));
      }
      await reqToPromise(tx(this.db, STORE_META, 'readwrite').put({ ackedSeq: acked }, 'acked'));
      this.ackedSeq = acked;

      return { ackedSeq: acked, sent: pending.length, results: result.results || [] };
    }

    /**
     * Build + export an emergency recovery package (download failsafe).
     * @returns {Promise<Object>} server package + { downloadUrl }
     */
    async exportRecovery() {
      await this.init();
      const entries = await this._readAll();
      const res = await fetch(`/api/student/attempts/${this.attemptId}/offline/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.deviceId, entries, meta: { reason: 'offline_export' } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `export failed: ${res.status}`);
      }
      return res.json();
    }

    /** Pending (unsynced) entry count — for the UI save-state indicator. */
    async pendingCount() {
      await this.init();
      const all = await this._readAll();
      return all.filter((e) => e.seq > this.ackedSeq).length;
    }

    /** Wipe the local journal (after successful submit / transfer). */
    async clear() {
      await this.init();
      const store = tx(this.db, STORE_JOURNAL, 'readwrite');
      await reqToPromise(store.clear());
      await reqToPromise(tx(this.db, STORE_META, 'readwrite').put({ ackedSeq: 0 }, 'acked'));
      this.ackedSeq = 0;
    }
  }

  global.OfflineJournal = OfflineJournal;
})(typeof window !== 'undefined' ? window : globalThis);
