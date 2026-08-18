/**
 * AUTH C-15 — Auth data backup + DR (recovery)
 * -------------------------------------------
 *  1. runAuthBackup: shifrlangan snapshot (AES-256-GCM) + checksum + audit
 *  2. restoreAuthBackup: to'g'ri kalit bilan roundtrip; noto'g'ri kalit → fail
 *  3. purgeOldBackups: 30 kundan eski fayllar tozalanadi
 *  4. latestBackupInfo: eng so'nggi backup meta (backup_age gauge uchun)
 *  5. DR targets: RPO ≤ 60 min, RTO ≤ 240 min (config validatsiya)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fb } from '../../firebase/admin.js';
import { snapshotDb, restoreDb } from '../helpers/setup.js';
import {
  runAuthBackup,
  restoreAuthBackup,
  purgeOldBackups,
  latestBackupInfo,
  DR_TARGETS,
} from '../../src/modules/auth/backup.js';

const DAY = 24 * 60 * 60 * 1000;
let backupDir;

beforeAll(async () => {
  await snapshotDb();
});

afterAll(async () => {
  await restoreDb();
});

describe('AUTH C-15 — backup + restore roundtrip', () => {
  it('DR targets: RPO ≤ 60 min, RTO ≤ 240 min (auth critical)', () => {
    expect(DR_TARGETS.rpoMinutes).toBeLessThanOrEqual(60);
    expect(DR_TARGETS.rtoMinutes).toBeLessThanOrEqual(240);
  });

  it('runAuthBackup: shifrlangan snapshot + checksum + auth:backup:run audit', async () => {
    await fb.set('users/c15_u1', { username: 'c15_u1', password: 'hash', created_at: Date.now() });
    const r = await runAuthBackup();
    expect(r.ok).toBe(true);
    expect(r.file).toBeTruthy();
    expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(r.file)).toBe(true);

    // Shifrlangan — plaintext JSON yo'q
    const raw = fs.readFileSync(r.file, 'utf8');
    expect(raw).not.toContain('c15_u1');
    expect(raw).not.toContain('username');
    // Fayl boshi iv (12B) + authTag (16B) + enc — random bytes
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(28);

    // Audit yozildi
    const auditSnap = await fb.get('auth_audit');
    let found = false;
    if (auditSnap.exists()) {
      for (const day of Object.values(auditSnap.val())) {
        for (const rec of Object.values(day || {})) {
          if (rec?.action === 'auth:backup:run' && rec?.outcome === 'success') found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('restoreAuthBackup: to\'g\'ri kalit bilan roundtrip (data qaytadi)', async () => {
    const r = await runAuthBackup();
    expect(r.ok).toBe(true);
    // restore'dan oldin path'ni tozalaymiz
    await fb.remove('users/c15_u1');
    const restored = await restoreAuthBackup(r.file);
    expect(restored.ok).toBe(true);
    expect((await fb.get('users/c15_u1')).exists()).toBe(true);
  });

  it('restoreAuthBackup: buzilgan fayl / noto\'g\'ri kalit → fail (decrypt error)', async () => {
    const tmp = path.join(os.tmpdir(), `c15-bad-${Date.now()}.bak.enc`);
    fs.writeFileSync(tmp, Buffer.alloc(64, 7)); // iv+tag+enc, lekin valid emas
    const r = await restoreAuthBackup(tmp);
    expect(r.ok).toBe(false);
    fs.unlinkSync(tmp);
  });

  it('latestBackupInfo: eng so\'nggi backup meta qaytadi (backup_age gauge)', async () => {
    const r = await runAuthBackup();
    expect(r.ok).toBe(true);
    const info = latestBackupInfo();
    expect(info).toBeTruthy();
    expect(info.file).toMatch(/\.bak\.enc$/);
    expect(info.ageMs).toBeLessThan(60 * 1000); // hozirgina yaratildi
  });
});

describe('AUTH C-15 — retention (30 kun)', () => {
  it('purgeOldBackups: eski fayl o\'chadi, yangi qoladi', async () => {
    const r = await runAuthBackup();
    expect(r.ok).toBe(true);
    const dir = path.dirname(r.file);
    // Eski fayl yaratamiz (mtime eski)
    const oldFile = path.join(dir, `auth-2000-01-01-${Date.now() - 40 * DAY}.bak.enc`);
    fs.writeFileSync(oldFile, Buffer.alloc(64, 1));
    const oldTime = new Date(Date.now() - 40 * DAY);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const purged = await purgeOldBackups();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    // Yangi backup qoldi
    const info = latestBackupInfo();
    expect(info.file).toBe(path.basename(r.file));
  });
});
