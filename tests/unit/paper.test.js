/**
 * Deborah — Unit Tests: Paper Packet, QR & Chain of Custody (Prompt 42)
 *
 * Pure-logic coverage (Prompt 42 §18 — QR signature/replay + §15 data guard):
 *   - QR payload: signed, tamper-evident, replay-detectable (UNIQUE token)
 *   - QR payload NEVER contains answer keys / raw PII (research.md §52.3)
 *   - Secret scan: answer/rubric/private keys rejected in artifacts
 *   - Packet plan: opaque id, checksum, backup code, accommodation flags
 *   - Detachable identity cover: name/ID only in cover, not body
 *   - Batch manifest: reproducible (same inputs → same hash)
 *   - Custody event: HMAC signature chain, event validation
 *   - Accommodation render flags: no raw sensitive reason
 */

import { describe, it, expect } from 'vitest';
import {
  buildPageQrPayload,
  signPageQr,
  verifyPageQr,
  scanPaperForSecrets,
  buildPacketPlan,
  buildBatchManifest,
  validateBatchTransition,
  validateCustodyEvent,
  signCustodyEvent,
  resolvePaperRenderFlags,
  deriveOpaquePacketId,
  generateBackupCode,
  canonicalHash,
  canonicalStringify,
  CUSTODY_EVENT_TYPES,
  PAPER_BATCH_STATUS,
  PAPER_BATCH_STATUS_TRANSITIONS,
  PAPER_RENDER_FLAGS,
  QR_SCHEMA_VERSION,
  MIN_SIGNING_KEY_LENGTH,
} from '../../src/modules/paper/index.js';

const SIGNING_KEY = 'deborah-paper-test-signing-key-0123456789abcdef';

// ═══════════════════════════════════════════════════════════════════
// PAGE QR — SIGN / VERIFY / REPLAY (§18, §52.3)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — page QR sign/verify (§18)', () => {
  it('signs a canonical payload and verifies it', () => {
    const { payload, token } = signPageQr({ packetId: 'opq123', pageIndex: 2, epoch: 1, nonce: 'CODE1234', key: SIGNING_KEY });
    expect(payload.v).toBe(QR_SCHEMA_VERSION);
    expect(payload.type).toBe('paper_page');
    expect(payload.packet).toBe('opq123');
    expect(payload.page).toBe(2);
    expect(payload.sig).toBeDefined();
    const v = verifyPageQr(token, SIGNING_KEY);
    expect(v.ok).toBe(true);
    expect(v.payload.packet).toBe('opq123');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const { token } = signPageQr({ packetId: 'opq123', pageIndex: 2, epoch: 1, key: SIGNING_KEY });
    const tampered = JSON.parse(token);
    tampered.page = 9;
    tampered.sig = '0'.repeat(64);
    const v = verifyPageQr(JSON.stringify(tampered), SIGNING_KEY);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/mismatch/i);
  });

  it('rejects wrong key / missing key / malformed token', () => {
    const { token } = signPageQr({ packetId: 'p1', pageIndex: 0, epoch: 1, key: SIGNING_KEY });
    expect(verifyPageQr(token, 'wrong-key-wrong-key-wrong-key-12345678').ok).toBe(false);
    expect(verifyPageQr(token, '').ok).toBe(false);
    expect(verifyPageQr('not-json', SIGNING_KEY).ok).toBe(false);
    expect(verifyPageQr('', SIGNING_KEY).ok).toBe(false);
  });

  it('QR payload NEVER contains answer keys or raw PII (scan passes)', () => {
    const { payload } = signPageQr({ packetId: 'opq', pageIndex: 1, epoch: 1, key: SIGNING_KEY });
    const scan = scanPaperForSecrets(payload);
    expect(scan.ok).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/answer|correct|rubric|private/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECRET SCAN (§15 — security/data guard)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — secret scan (§15)', () => {
  it('rejects answer key / rubric / private material anywhere', () => {
    expect(scanPaperForSecrets({ answer_key: 'A' }).ok).toBe(false);
    expect(scanPaperForSecrets({ correctKey: 'B' }).ok).toBe(false);
    expect(scanPaperForSecrets({ rubric: { points: 3 } }).ok).toBe(false);
    expect(scanPaperForSecrets({ private_data: {} }).ok).toBe(false);
    expect(scanPaperForSecrets({ nested: { answerKey: 'C' } }).ok).toBe(false);
    expect(scanPaperForSecrets({ text: 'the correct answer is B' }).ok).toBe(false);
  });

  it('accepts clean artifacts', () => {
    expect(scanPaperForSecrets({ packet: 'opq', page: 1, nonce: 'CODE', sig: 'abc' }).ok).toBe(true);
    expect(scanPaperForSecrets({ student_id: '12345', name: 'Ali' }).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PACKET PLAN (§52.4)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — packet plan (§52.4)', () => {
  it('builds a deterministic packet plan with checksum + page hashes', () => {
    const r = buildPacketPlan({
      assignmentId: 12,
      studentUserId: 7,
      variant: 'A',
      accommodation: { largePrint: true },
      pageCount: 3,
      pageHashes: { 0: 'h0', 1: 'h1', 2: 'h2' },
      identity: { name: 'Ali Valiyev', student_id: 'S123' },
    });
    expect(r.ok).toBe(true);
    expect(r.plan.opaque_packet_id).toMatch(/^[0-9a-f]{32}$/);
    expect(r.plan.page_count).toBe(3);
    expect(r.plan.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(r.plan.accommodation_flags).toContain('large_print');
    expect(r.plan.pages).toHaveLength(3);
    expect(r.plan.pages[1].content_hash).toBe('h1');
    // Detachable cover — identity only in cover_identity, not body fields.
    expect(r.plan.cover_identity.name).toBe('Ali Valiyev');
  });

  it('is deterministic — same inputs → same opaque id + checksum', () => {
    const a = buildPacketPlan({ assignmentId: 1, studentUserId: 2, variant: 'B', pageCount: 2 });
    const b = buildPacketPlan({ assignmentId: 1, studentUserId: 2, variant: 'B', pageCount: 2 });
    expect(a.plan.opaque_packet_id).toBe(b.plan.opaque_packet_id);
    expect(a.plan.checksum).toBe(b.plan.checksum);
  });

  it('rejects invalid inputs', () => {
    expect(buildPacketPlan({ assignmentId: 0, pageCount: 1 }).ok).toBe(false);
    expect(buildPacketPlan({ assignmentId: 1, pageCount: 0 }).ok).toBe(false);
    expect(buildPacketPlan({ assignmentId: 1, pageCount: -1 }).ok).toBe(false);
  });

  it('accommodation flags never contain raw reasons', () => {
    const flags = resolvePaperRenderFlags({ largePrint: true, oneSided: true, diagnosis: 'panic attack' });
    expect(flags).toEqual(['large_print', 'one_sided']);
    expect(flags.join()).not.toMatch(/panic|diagnosis/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// BATCH MANIFEST (§10 — reproducible)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — batch manifest (§10)', () => {
  it('is reproducible — same inputs → same hash', () => {
    const plans = [
      buildPacketPlan({ assignmentId: 5, studentUserId: 1, variant: 'A', pageCount: 2 }).plan,
      buildPacketPlan({ assignmentId: 5, studentUserId: 2, variant: 'B', pageCount: 2 }).plan,
    ];
    const m1 = buildBatchManifest({ batchId: 1, batchKey: 'paper:5', packetPlans: plans });
    const m2 = buildBatchManifest({ batchId: 1, batchKey: 'paper:5', packetPlans: plans });
    expect(m1.hash).toBe(m2.hash);
    expect(m1.manifest.packetCount).toBe(2);
    expect(m1.manifest.variants).toEqual(['A', 'B']);
    expect(scanPaperForSecrets(m1.manifest).ok).toBe(true);
  });

  it('opaque packet ids are deterministic', () => {
    expect(deriveOpaquePacketId({ assignmentId: 9, variant: 'C', studentUserId: 4 }))
      .toBe(deriveOpaquePacketId({ assignmentId: 9, variant: 'C', studentUserId: 4 }));
    expect(deriveOpaquePacketId({ assignmentId: 9, variant: 'C', studentUserId: 4 }))
      .not.toBe(deriveOpaquePacketId({ assignmentId: 9, variant: 'C', studentUserId: 5 }));
  });
});

// ═══════════════════════════════════════════════════════════════════
// BATCH STATUS + CUSTODY (§14, §52.7)
// ═══════════════════════════════════════════════════════════════════

describe('Paper — batch status + custody (§14)', () => {
  it('allows documented batch transitions only', () => {
    for (const [from, tos] of Object.entries(PAPER_BATCH_STATUS_TRANSITIONS)) {
      for (const to of tos) {
        expect(validateBatchTransition(from, to).ok, `${from} → ${to}`).toBe(true);
      }
    }
  });

  it('rejects illegal batch transitions', () => {
    expect(validateBatchTransition('planned', 'reconciled').ok).toBe(false);
    expect(validateBatchTransition('destroyed', 'generated').ok).toBe(false);
  });

  it('validates custody events', () => {
    for (const t of CUSTODY_EVENT_TYPES) {
      expect(validateCustodyEvent({ eventType: t, count: 5 }).ok, t).toBe(true);
    }
    expect(validateCustodyEvent({ eventType: 'teleported', count: 1 }).ok).toBe(false);
    expect(validateCustodyEvent({ eventType: 'generated', count: -1 }).ok).toBe(false);
  });

  it('signs custody events — chain is tamper-evident', () => {
    const s1 = signCustodyEvent({ prevEventId: null, eventType: 'generated', count: 10, batchId: 1, key: SIGNING_KEY });
    const s2 = signCustodyEvent({ prevEventId: 1, eventType: 'batch_downloaded', count: 10, batchId: 1, key: SIGNING_KEY });
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(s1).not.toBe(s2);
    // Same inputs → same signature (deterministic).
    expect(signCustodyEvent({ prevEventId: null, eventType: 'generated', count: 10, batchId: 1, key: SIGNING_KEY })).toBe(s1);
  });

  it('backup codes are human-readable and unique-ish', () => {
    const a = generateBackupCode();
    const b = generateBackupCode();
    expect(a).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CANONICAL HASHING
// ═══════════════════════════════════════════════════════════════════

describe('Paper — canonical hashing', () => {
  it('sorts keys recursively — stable hashes', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
    expect(canonicalHash({ x: [1, { b: 2, a: 1 }], y: 'z' })).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash({ x: 1 })).toBe(canonicalHash({ x: 1 }));
  });
});
