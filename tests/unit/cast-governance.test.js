/**
 * Edikit — Cast C4-06 Governance Service Tests
 * ---------------------------------------------
 * coverage: minor-safe policy (bypass qilib bo'lmaydi), moderation state
 *           machine (RECEIVED→…→WITHDRAWN, AUTO_FLAGGED review), permission
 *           matrix, block list (remove vs block), join code rotation,
 *           moderator-unavailable hold, log sanitization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GOVERNANCE_MODERATION_STATE,
  MODERATION_TRANSITIONS,
  MODERATION_PERMISSIONS,
  MINOR_SAFE_POLICY,
  canTransition,
  needsReview,
  canModerate,
  applyGovernance,
  assertPolicyNotBypassed,
  blockParticipant,
  isBlocked,
  listBlocked,
  unblockParticipant,
  rotateJoinCode,
  holdWhenModeratorUnavailable,
  sanitizeForLog,
} from '../../services/cast/governance-service.js';
import { CAST_ROLES } from '../../utils/cast-constants.js';

// ── Minor-safe policy (item 1) ──
describe('C4-06: minor-safe policy', () => {
  it('policy chat/DM off, openText host_review_first, safe_alias, moderated wall', () => {
    expect(MINOR_SAFE_POLICY.moderation.publicChat).toBe(false);
    expect(MINOR_SAFE_POLICY.moderation.directMessages).toBe(false);
    expect(MINOR_SAFE_POLICY.moderation.openTextVisibility).toBe('host_review_first');
    expect(MINOR_SAFE_POLICY.moderation.questionWall).toBe('moderated');
    expect(MINOR_SAFE_POLICY.moderation.publicIdentity).toBe('safe_alias');
  });

  it('applyGovernance majburiy fieldlarni override qiladi', () => {
    const config = {
      moderation: { publicChat: true, directMessages: true, openTextVisibility: 'public_after_approval', questionWall: 'off', publicIdentity: 'anonymous' },
      join: { identity: 'anonymous' },
      personalProgress: { visibility: 'opt_in_public' },
    };
    const { config: governed, applied } = applyGovernance(config, 'minor_safe_v1');
    expect(governed.moderation.publicChat).toBe(false);
    expect(governed.moderation.directMessages).toBe(false);
    expect(governed.moderation.openTextVisibility).toBe('host_review_first');
    expect(governed.moderation.questionWall).toBe('moderated');
    expect(governed.moderation.publicIdentity).toBe('safe_alias');
    expect(governed.join.identity).toBe('safe_alias');
    expect(governed.personalProgress.visibility).toBe('private');
    expect(applied.length).toBeGreaterThanOrEqual(7);
  });

  it('bypass urinishi aniqlanadi (tugallanish sharti)', () => {
    const violations = assertPolicyNotBypassed(
      { moderation: { publicChat: true }, join: { identity: 'anonymous' } },
      'minor_safe_v1'
    );
    expect(violations).toContain('moderation.publicChat');
    expect(violations).toContain('join.identity');
  });

  it('policyga mos overrides bypass emas', () => {
    const violations = assertPolicyNotBypassed(
      { moderation: { publicChat: false }, timer: { defaultSeconds: 45 } },
      'minor_safe_v1'
    );
    expect(violations).toEqual([]);
  });

  it('boshqa policyId → hech narsa qo\'llanmaydi', () => {
    const { applied } = applyGovernance({ moderation: { publicChat: true } }, 'custom_policy');
    expect(applied).toEqual([]);
  });
});

// ── Moderation state machine (item 12) ──
describe('C4-06: moderation state machine', () => {
  it('8 ta state mavjud, WITHDRAWN terminal', () => {
    expect(Object.keys(GOVERNANCE_MODERATION_STATE).length).toBe(8);
    expect(GOVERNANCE_MODERATION_STATE.WITHDRAWN).toBe('WITHDRAWN');
    expect(MODERATION_TRANSITIONS.WITHDRAWN).toEqual([]);
  });

  it('RECEIVED → AUTO_FLAGGED → REVIEW_READY → APPROVED → PROJECTED', () => {
    expect(canTransition('RECEIVED', 'AUTO_FLAGGED')).toBe(true);
    expect(canTransition('AUTO_FLAGGED', 'REVIEW_READY')).toBe(true);
    expect(canTransition('REVIEW_READY', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'PROJECTED')).toBe(true);
  });

  it('auto-flag final punishment emas — har doim review bor (item 11)', () => {
    // AUTO_FLAGGED → terminal bo'lishi mumkin emas
    expect(MODERATION_TRANSITIONS.AUTO_FLAGGED).toContain('REVIEW_READY');
    expect(MODERATION_TRANSITIONS.AUTO_FLAGGED).toContain('APPROVED');
    expect(needsReview('AUTO_FLAGGED')).toBe(true);
    expect(needsReview('RECEIVED')).toBe(true);
  });

  it('illegal transition rad etiladi', () => {
    expect(canTransition('RECEIVED', 'PROJECTED')).toBe(false); // approve/redact kerak avval
    expect(canTransition('WITHDRAWN', 'APPROVED')).toBe(false);
    expect(canTransition('APPROVED', 'RECEIVED')).toBe(false);
  });

  it('review tugagach needsReview false', () => {
    expect(needsReview('APPROVED')).toBe(false);
    expect(needsReview('PROJECTED')).toBe(false);
    expect(needsReview('WITHDRAWN')).toBe(false);
  });
});

// ── Permission matritsasi (item 13) ──
describe('C4-06: moderation permissions', () => {
  it('owner/co_host/moderator approve+redact+project+withdraw qila oladi', () => {
    for (const role of [CAST_ROLES.OWNER, CAST_ROLES.CO_HOST, CAST_ROLES.MODERATOR]) {
      expect(canModerate('approve', role)).toBe(true);
      expect(canModerate('redact', role)).toBe(true);
      expect(canModerate('project', role)).toBe(true);
      expect(canModerate('withdraw', role)).toBe(true);
    }
  });

  it('projector/analyst moderatsiya qila olmaydi', () => {
    expect(canModerate('approve', CAST_ROLES.PROJECTOR_ONLY)).toBe(false);
    expect(canModerate('hide', CAST_ROLES.ANALYST_READONLY)).toBe(false);
    expect(canModerate('approve', 'participant')).toBe(false);
  });
});

// ── Block list (item 15) ──
describe('C4-06: block list (remove vs block)', () => {
  let db;
  beforeEach(() => {
    db = new Map();
  });
  const adapter = {
    dbGet: async (p) => ({ exists: () => db.has(p), val: () => db.get(p) }),
    dbSet: async (p, v) => db.set(p, v),
  };

  it('blockParticipant normalized bo\'yicha bloklaydi', async () => {
    await blockParticipant(adapter, 's1', { participantId: 'p1', normalized: 'troll1', reason: 'spam', blockedBy: 't' });
    expect(await isBlocked(adapter, 's1', 'troll1')).toBe(true);
    expect(await isBlocked(adapter, 's1', 'boshqa')).toBe(false);
  });

  it('block qayta urinishda already', async () => {
    await blockParticipant(adapter, 's1', { participantId: 'p1', normalized: 'troll1' });
    const second = await blockParticipant(adapter, 's1', { participantId: 'p2', normalized: 'troll1' });
    expect(second.already).toBe(true);
    expect(second.blocked).toBe(false);
  });

  it('unblock qilish mumkin', async () => {
    await blockParticipant(adapter, 's1', { participantId: 'p1', normalized: 'troll1' });
    const res = await unblockParticipant(adapter, 's1', 'troll1');
    expect(res.unblocked).toBe(true);
    expect(await isBlocked(adapter, 's1', 'troll1')).toBe(false);
  });

  it('listBlocked barcha blocklarni qaytaradi', async () => {
    await blockParticipant(adapter, 's1', { participantId: 'p1', normalized: 'troll1' });
    await blockParticipant(adapter, 's1', { participantId: 'p2', normalized: 'troll2' });
    const blocks = await listBlocked(adapter, 's1');
    expect(Object.keys(blocks).length).toBe(2);
  });
});

// ── Join code rotation (item 16) ──
describe('C4-06: join code rotation', () => {
  it('eski kod o\'chiriladi, yangi kod yoziladi, meta yangilanadi', async () => {
    const db = new Map();
    db.set('cast_codes/ABC123', { sessionId: 's1' });
    const adapter = {
      dbGet: async (p) => ({ exists: () => db.has(p), val: () => db.get(p) }),
      dbSet: async (p, v) => db.set(p, v),
      dbRemove: async (p) => db.delete(p),
      dbUpdate: async (p, v) => {
        const cur = db.get(p) || {};
        db.set(p, { ...cur, ...v });
      },
    };
    // Birinchi generatsiya collided (XYZ999 band) → ikkinchisi ishlatiladi
    db.set('cast_codes/XYZ999', { sessionId: 's1' });
    let genCount = 0;
    const gen = () => (++genCount === 1 ? 'XYZ999' : 'NEW456');
    const result = await rotateJoinCode(adapter, 's1', {
      generateCode: gen,
      meta: { joinCode: 'ABC123' },
    });
    expect(result.newCode).toBe('NEW456');
    expect(db.has('cast_codes/ABC123')).toBe(false);   // eski o'chirildi
    expect(db.get('cast_codes/NEW456')).toBeTruthy();  // yangi yozildi
    expect(db.get('cast_sessions/s1/meta').joinCode).toBe('NEW456');
  });
});

// ── Moderator hold (item 17) ──
describe('C4-06: moderator unavailable hold', () => {
  it('moderator online → hold yo\'q', () => {
    expect(holdWhenModeratorUnavailable({ moderatorOnline: true, frozen: false }, { moderation: { openTextVisibility: 'host_review_first' } })).toBe(false);
  });

  it('moderator offline + host_review_first → hold', () => {
    expect(holdWhenModeratorUnavailable({ moderatorOnline: false, frozen: true }, { moderation: { openTextVisibility: 'host_review_first' } })).toBe(true);
  });

  it('moderator offline + public_after_approval → hold (xavfsiz)', () => {
    expect(holdWhenModeratorUnavailable({ moderatorOnline: false, frozen: true }, { moderation: { openTextVisibility: 'public_after_approval' } })).toBe(true);
  });
});

// ── Log sanitization (item 14) ──
describe('C4-06: log sanitization', () => {
  it('raw text log/analytics\'ga kirmaydi — faqat uzunlik', () => {
    const clean = sanitizeForLog({ action: 'wall:withdraw', text: 'shaxsiy malumot +998901234567', redactedText: 'x' });
    expect(clean.text).toBeUndefined();
    expect(clean.redactedText).toBeUndefined();
    expect(clean.textLength).toBe(String('shaxsiy malumot +998901234567').length);
    expect(clean.redactedLength).toBe(1);
    expect(clean.action).toBe('wall:withdraw');
  });

  it('sanitize bo\'lmagan record o\'zgarishsiz', () => {
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog({ a: 1 })).toEqual({ a: 1 });
  });
});
