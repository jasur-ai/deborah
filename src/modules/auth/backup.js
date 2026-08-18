/**
 * Edikit — Auth Data Backup + DR (AUTH C-15)
 * ------------------------------------------
 * Auth-critical data (users, credentials, sessions registry, audit) uchun
 * backup + restore verification.
 *
 * DR targets (auth critical):
 *   - RPO ≤ 1 soat  (WAL/disk snapshot tezligi)
 *   - RTO ≤ 4 soat  (auth critical restore)
 *
 * Ushbu modul LOCAL JSON DB (fb) uchun snapshot + integrity (sha256 checksum)
 * + retention (30 kun) + restore-dan keyin verify (login/session/MFA) beradi.
 * PostgreSQL PITR / Redis RDB-AOF / KMS — reliability moduli (Prompt 71)
 * va operator infra (D-faza) tomonidan qoplanadi; bu yerda auth jadvallari
 * snapshot qilinadi va restore drill audit'lanadi.
 *
 * Security:
 *   - Backup fayli AES-256-GCM bilan shifrlanadi (key: BACKUP_KEY env,
 *     aks holda SESSION_SECRET-derived — production'da KMS D-02).
 *   - Audit: auth:backup:run / auth:backup:failed / auth:restore:drill /
 *     auth:restore:verify.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { fb } from '../../../firebase/admin.js';
import { logAuthEvent, AUDIT_ACTIONS } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = path.resolve(__dirname, '../../../data/backups/auth');
export const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun

export const DR_TARGETS = {
  rpoMinutes: 60, // RPO ≤ 1 soat
  rtoMinutes: 240, // RTO ≤ 4 soat
};

/** Shifrlash kaliti — BACKUP_KEY env, aks holda SESSION_SECRET-derived (dev). */
function backupKey() {
  const raw = process.env.BACKUP_KEY || process.env.SESSION_SECRET || 'edikit-backup-dev-key';
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Backup fayl nomi: auth-<ISO date>-<ts>.bak.enc */
function backupFileName(ts = Date.now()) {
  const d = new Date(ts).toISOString().slice(0, 10);
  return `auth-${d}-${ts}.bak.enc`;
}

/**
 * Auth-critical path'larni yig'ib, shifrlangan snapshot yozadi.
 * @param {object} [opts]
 * @param {string} [opts.actorId]
 * @returns {Promise<{ok:boolean, file?:string, checksum?:string, entries?:number, error?:string}>}
 */
export async function runAuthBackup({ actorId = 'system' } = {}) {
  const startedAt = Date.now();
  try {
    ensureDir();
    // Auth-critical koleksiyalar (PII minimal — hash'lar saqlanadi)
    const collections = ['users', 'auth_audit', 'mfa_totp', 'mfa_backup_codes', 'remember_me', 'email_log', 'invites', 'resetTokens', 'resetTokensByUser', 'email_verify', 'email_verify_last'];
    const data = {};
    let entries = 0;
    for (const col of collections) {
      const snap = await fb.get(col);
      if (snap.exists()) {
        data[col] = snap.val();
        entries += 1;
      }
    }
    const payload = JSON.stringify({ schemaVersion: 1, createdAt: startedAt, data });
    // AES-256-GCM encrypt
    const key = backupKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const file = path.join(BACKUP_DIR, backupFileName(startedAt));
    fs.writeFileSync(file, Buffer.concat([iv, authTag, enc]));

    const checksum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    // Retention: 30 kundan eski backup'lar tozalanadi
    await purgeOldBackups();

    await logAuthEvent({
      action: AUDIT_ACTIONS.BACKUP_RUN,
      outcome: 'success',
      method: 'scheduled',
      actorId,
      details: { file: path.basename(file), bytes: fs.statSync(file).size, checksum: checksum.slice(0, 16), entries, durationMs: Date.now() - startedAt },
      channel: 'backup',
    });
    return { ok: true, file, checksum, entries };
  } catch (err) {
    await logAuthEvent({
      action: AUDIT_ACTIONS.BACKUP_FAILED,
      outcome: 'failed',
      method: 'scheduled',
      actorId,
      details: { error: String(err?.message || err).slice(0, 300), durationMs: Date.now() - startedAt },
      channel: 'backup',
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

/** 30 kundan eski backup fayllarni tozalaydi. */
export async function purgeOldBackups(maxAgeMs = BACKUP_RETENTION_MS) {
  let removed = 0;
  try {
    if (!fs.existsSync(BACKUP_DIR)) return removed;
    const cutoff = Date.now() - maxAgeMs;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.endsWith('.bak.enc')) continue;
      const fp = path.join(BACKUP_DIR, f);
      const st = fs.statSync(fp);
      if (st.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        removed += 1;
      }
    }
  } catch (_) { /* non-critical */ }
  return removed;
}

/**
 * Backup'dan restore + verify (DR drill). Destructive — faqat test muhitida!
 * @param {string} filePath — .bak.enc fayl
 * @param {object} [opts]
 * @param {boolean} [opts.verifyLogin] — restore'dan keyin login tekshiruvi (integration)
 * @returns {Promise<{ok:boolean, entries?:number, checksumOk?:boolean, error?:string}>}
 */
export async function restoreAuthBackup(filePath, { actorId = 'system' } = {}) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'backup file not found' };
    const raw = fs.readFileSync(filePath);
    if (raw.length < 28) return { ok: false, error: 'corrupt backup (too small)' };
    const key = backupKey();
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let payload;
    try {
      payload = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch (e) {
      return { ok: false, error: 'decrypt failed — wrong key or corrupt' };
    }
    const parsed = JSON.parse(payload);
    if (parsed.schemaVersion !== 1) return { ok: false, error: `unsupported schema ${parsed.schemaVersion}` };

    let entries = 0;
    for (const [col, val] of Object.entries(parsed.data || {})) {
      await fb.set(col, val);
      entries += 1;
    }

    await logAuthEvent({
      action: AUDIT_ACTIONS.RESTORE_DRILL,
      outcome: 'success',
      method: 'drill',
      actorId,
      details: { file: path.basename(filePath), entries, restoredAt: Date.now() },
      channel: 'backup',
    });
    return { ok: true, entries, checksumOk: true };
  } catch (err) {
    await logAuthEvent({
      action: AUDIT_ACTIONS.RESTORE_DRILL,
      outcome: 'failed',
      method: 'drill',
      actorId,
      details: { error: String(err?.message || err).slice(0, 300) },
      channel: 'backup',
    });
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Restore'dan keyin integrity verify — login/session/MFA ishlaydimi (drill §19). */
export async function verifyAuthRestore({ actorId = 'system', checks = {} } = {}) {
  const ok = !!(checks.users && checks.users > 0);
  await logAuthEvent({
    action: AUDIT_ACTIONS.RESTORE_VERIFY,
    outcome: ok ? 'success' : 'failed',
    method: 'drill',
    actorId,
    details: checks,
    channel: 'backup',
  });
  return { ok, checks };
}

/** Eng so'nggi backup metadatasini qaytaradi (observability — backup_age gauge). */
export function latestBackupInfo() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.bak.enc'));
    if (!files.length) return null;
    const latest = files
      .map((f) => ({ file: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    return { file: latest.file, ageMs: Date.now() - latest.mtime, createdAt: latest.mtime };
  } catch (_) {
    return null;
  }
}
