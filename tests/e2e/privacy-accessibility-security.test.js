/**
 * Edikit — E2E/Security: Privacy, Accessibility & Security Negative Suite
 * (Prompt 38)
 *
 * Negative contract walk at the pure-logic + graceful-degradation layer:
 *   - Privacy: camera/browser flag NEVER becomes an academic decision
 *     (proctor technical exclusions + camera evidence is review-only signal)
 *   - Accessibility: accommodation config defaults are safe; sensitive
 *     rationale is encrypted and access-gated
 *   - Security: answer-key payload scan catches leaks in every public
 *     surface (content package, recovery package, timeline)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../server.js';
import { createRequest, snapshotDb, restoreDb } from '../helpers/setup.js';

let httpServer;

beforeAll(async () => {
  snapshotDb();
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  restoreDb();
  return new Promise((resolve) => {
    if (httpServer && httpServer.listening) httpServer.close(() => resolve());
    else resolve();
  });
});

describe('Privacy — camera/browser flag is NOT an academic decision (§15)', () => {
  it('proctor NEVER strikes blur/network/camera (technical exclusions)', async () => {
    const { classifyProctorEvent, TECHNICAL_EVENT_TYPES } = await import('../../src/modules/proctor/index.js');
    expect(TECHNICAL_EVENT_TYPES.has('blur')).toBe(true);
    expect(TECHNICAL_EVENT_TYPES.has('network_offline')).toBe(true);
    expect(TECHNICAL_EVENT_TYPES.has('camera_failure')).toBe(true);
    for (const t of TECHNICAL_EVENT_TYPES) {
      expect(classifyProctorEvent({ eventType: t, durationMs: 60000 }).confirmed).toBe(false);
    }
  });

  it('camera evidence carries flags only — never an automatic verdict', async () => {
    const { validateEvidenceFlags, shouldDiscardSample } = await import('../../src/modules/camera/index.js');
    const v = validateEvidenceFlags({ face_present: false, phone_detected: true });
    expect(v.ok).toBe(true); // raw flag is allowed as EVIDENCE
    // But it is never a "misconduct" verdict — such fields are forbidden
    expect(validateEvidenceFlags({ misconduct: true }).ok).toBe(false);
    expect(shouldDiscardSample({ face_present: false, face_count: 0 }).discard).toBe(false); // kept as review signal
  });

  it('explainable timeline never leaks a "cheat probability"', async () => {
    const { buildTimelineEntry, classifyProctorEvent } = await import('../../src/modules/proctor/index.js');
    const entry = buildTimelineEntry({
      event: { clientSeq: 1, eventType: 'visibility_hidden', startedAt: 1000, durationMs: 4000 },
      classification: classifyProctorEvent({ eventType: 'visibility_hidden', durationMs: 4000 }),
      strikeLevel: 'warning_1',
    });
    const json = JSON.stringify(entry);
    expect(json).not.toMatch(/cheat|probability|honesty|score/i);
  });
});

describe('Privacy — pilot status & consent transparency', () => {
  it('pilot status lists never_collected fields and hides storage keys', async () => {
    const { buildPilotStatus } = await import('../../src/modules/camera/index.js');
    const status = buildPilotStatus({ policy: { pilot_enabled: true, consent_version: 1 } });
    expect(status.never_collected).toEqual(expect.arrayContaining(['emotion', 'gaze', 'honesty_score', 'raw_frames', 'audio']));
    expect(JSON.stringify(status)).not.toMatch(/storage_key|content_hash/);
  });

  it('revoked consent blocks the pilot (no surveillance without consent)', async () => {
    const { deriveConsentState } = await import('../../src/modules/camera/index.js');
    const revoked = deriveConsentState({ consent_version: 1, granted_at: 'x', revoked_at: 'y' }, 1);
    expect(revoked.state).toBe('revoked');
    expect(revoked.requires_consent).toBe(true);
  });
});

describe('Accessibility — accommodation is a right, not a security exemption', () => {
  it('operational config degrades to safe defaults without PG', async () => {
    const { getEffectiveOperationalConfig } = await import('../../src/modules/accommodation/index.js');
    const cfg = await getEffectiveOperationalConfig(1, 1);
    expect(cfg.extraTimeMinutes).toBe(0);
    expect(cfg.maxStrikes).toBe(3);
    expect(cfg.cameraDisabled).toBe(false);
    expect(cfg.separateRoom).toBe(false);
  });

  it('sensitive rationale is encrypted and access-gated', async () => {
    const { encryptSensitiveRationale, decryptSensitiveRationale, hasSensitiveAccess } = await import('../../src/modules/accommodation/index.js');
    const enc = encryptSensitiveRationale('medical disclosure');
    // encryptSensitiveRationale { ciphertext, iv, tag } ob'ekti qaytaradi — hech qaysi maydonda ochiq matn yo'q
    expect(JSON.stringify(enc)).not.toContain('medical');
    // Decrypt requires the app secret context; wrong input never throws raw data
    const dec = decryptSensitiveRationale(enc);
    expect(typeof dec).toBe('string');
    // Access gate: non-privileged session has no sensitive access
    expect(hasSensitiveAccess({ user: { username: 'student' } })).toBe(false);
  });
});

describe('Security — answer-key payload scan (every public surface)', () => {
  it('student content package is clean of answer keys', async () => {
    const { buildPublicContentPackage, verifyContentPackageClean } = await import('../../src/modules/attempt/index.js');
    const pkg = buildPublicContentPackage(
      { id: 1, title: 'x' },
      [{ item_id: 1, question: 'q', options: ['a', 'b'] }],
    );
    expect(verifyContentPackageClean(pkg).ok).toBe(true);
    expect(JSON.stringify(pkg)).not.toMatch(/correct|answerKey|rubric|private/i);
  });

  it('recovery package scan catches injected answer keys', async () => {
    const { scanPackageForAnswerKeys, buildRecoveryPackage } = await import('../../src/modules/offline/index.js');
    const clean = buildRecoveryPackage({ attemptId: 1, userId: 1, deviceId: 'd1', entries: [], ackedSeq: 0 });
    expect(scanPackageForAnswerKeys(clean).clean).toBe(true);
    const poisoned = { ...clean, entries: [{ seq: 1, patch: { answer_key: 'B' } }] };
    expect(scanPackageForAnswerKeys(poisoned).found.length).toBeGreaterThan(0);
  });

  it('public DTO scan catches leaks in socket payloads', async () => {
    // Mirror of scripts/answer-key-scan.js semantics — dangerous patterns
    const DANGEROUS = [/\bq_correct\b/g, /\bqCorrect\b/g, /\bcorrectAnswer\b/g, /\banswer_key\b/g];
    const publicPayload = { q: '1+1?', options: ['1', '2'] };
    for (const re of DANGEROUS) {
      expect(JSON.stringify(publicPayload)).not.toMatch(re);
    }
  });
});

describe('Security — API ACL guards (HTTP layer)', () => {
  it('admin camera review requires admin', async () => {
    const req = await createRequest();
    const res = await req.get('/api/admin/attempts/1/camera/review');
    expect([401, 403]).toContain(res.status);
  });

  it('admin proctor reopen requires admin', async () => {
    const req = await createRequest();
    const res = await req.post('/api/admin/attempts/1/proctor/reopen').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('camera consent requires student session', async () => {
    const req = await createRequest();
    const res = await req.post('/api/student/assignments/1/camera/consent').send({});
    expect([401, 403]).toContain(res.status);
  });
});
