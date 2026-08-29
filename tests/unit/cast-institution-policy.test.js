import { describe, it, expect } from 'vitest';
import {
  POLICY_STATUS,
  createInstitutionPolicy,
  updateDraftPolicy,
  publishPolicy,
  deprecatePolicy,
  bumpPolicyVersion,
  diffPolicies,
  resolveEffectivePolicy,
  applyInstitutionPolicy,
  assertInstitutionPolicyNotBypassed,
  isApprovedPreset,
  migrationPreviewForSavedPresets,
  pinSessionPolicy,
  governanceAuditExport,
  isSameTenant,
  getPath,
  setPath,
} from '../../services/cast/institution-policy.js';

function makePolicy(over = {}) {
  return createInstitutionPolicy({
    tenantId: 'school_12',
    name: 'School 12 policy',
    approvedPresets: ['responsive_accuracy'],
    lockedFields: { 'moderation.publicChat': false, 'ai.mayExecuteLiveActions': false },
    limits: { 'scoring.maxSpeedWeight': 0.2, 'join.maxPlayers': 500 },
    createdBy: 'admin',
    ...over,
  });
}

// ── Model + lifecycle (item 1, 5, 6, 7) ──
describe('C4-08: model va lifecycle', () => {
  it('createInstitutionPolicy — DRAFT, version 1, defaults', () => {
    const p = makePolicy();
    expect(p.status).toBe(POLICY_STATUS.DRAFT);
    expect(p.version).toBe(1);
    expect(p.tenantId).toBe('school_12');
    expect(p.lockedFields['moderation.publicChat']).toBe(false);
    expect(p.effectiveDate).toBeNull();
    expect(p.publishedAt).toBeNull();
    expect(p.audit).toEqual([]);
  });

  it('policyId avtomatik — sanitized tenantId bilan (xavfli belgilar olib tashlanadi)', () => {
    const p = createInstitutionPolicy({ tenantId: 'my school/12!' });
    expect(p.policyId).toMatch(/^inst_my_school_12_+v1$/);
    expect(p.policyId).not.toMatch(/[\s/!]/);
    // Hech qanday maxsus belgi qolmaydi (faqat _ va alfanumerik)
    expect(p.policyId.replace(/[a-zA-Z0-9_]/g, '')).toBe('');
  });

  it('updateDraftPolicy — DRAFT mutable, audit yoziladi', () => {
    const p = makePolicy();
    const next = updateDraftPolicy(p, { name: 'Updated' }, 'admin');
    expect(next.name).toBe('Updated');
    expect(next.audit.length).toBe(1);
    expect(next.audit[0].action).toBe('update');
  });

  it('updateDraftPolicy — PUBLISHED reject (immutable)', () => {
    const p = publishPolicy(makePolicy(), { by: 'admin', confirm: true });
    expect(() => updateDraftPolicy(p, { name: 'x' })).toThrow('POLICY_LOCKED');
  });

  it('publishPolicy — confirm kerak (accidental publish oldini oladi)', () => {
    const p = makePolicy();
    expect(() => publishPolicy(p, { by: 'admin', confirm: false })).toThrow('CONFIRM_REQUIRED');
  });

  it('publishPolicy — confirm bilan PUBLISHED + audit', () => {
    const p = publishPolicy(makePolicy(), { by: 'admin', confirm: true });
    expect(p.status).toBe(POLICY_STATUS.PUBLISHED);
    expect(p.publishedBy).toBe('admin');
    expect(p.publishedAt).toBeTruthy();
    expect(p.audit[0].action).toBe('publish');
  });

  it('publishPolicy — DRAFT emas → reject', () => {
    const p = deprecatePolicy(publishPolicy(makePolicy(), { by: 'a', confirm: true }), { by: 'a' });
    expect(() => publishPolicy(p, { confirm: true })).toThrow('INVALID_TRANSITION');
  });

  it('deprecatePolicy — faqat PUBLISHED', () => {
    const pub = publishPolicy(makePolicy(), { by: 'a', confirm: true });
    const dep = deprecatePolicy(pub, { by: 'a' });
    expect(dep.status).toBe(POLICY_STATUS.DEPRECATED);
    expect(dep.deprecatedBy).toBe('a');
    // DRAFT'dan deprecate mumkin emas
    expect(() => deprecatePolicy(makePolicy(), { by: 'a' })).toThrow('INVALID_TRANSITION');
  });

  it('bumpPolicyVersion — version+1, derivedFrom, yangi DRAFT', () => {
    const pub = publishPolicy(makePolicy(), { by: 'a', confirm: true });
    const v2 = bumpPolicyVersion(pub, { lockedFields: { 'moderation.publicChat': true }, by: 'a' });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe(POLICY_STATUS.DRAFT);
    expect(v2.derivedFrom).toBe(pub.policyId);
    expect(v2.lockedFields['moderation.publicChat']).toBe(true);
    expect(v2.policyId).toMatch(/_v2$/);
    // DRAFT'dan bump mumkin emas
    expect(() => bumpPolicyVersion(makePolicy())).toThrow('INVALID_VERSION');
  });
});

// ── Diff (item 8) ──
describe('C4-08: diff', () => {
  it('diffPolicies — locked/limits/presets farqlarini ko rsatadi', () => {
    const a = makePolicy();
    const b = makePolicy({
      lockedFields: { 'moderation.publicChat': true, 'ai.mayExecuteLiveActions': false },
      limits: { 'join.maxPlayers': 1000 },
      approvedPresets: ['responsive_accuracy', 'formative_check'],
    });
    const diff = diffPolicies(a, b);
    expect(diff.lockedFields).toContainEqual({ path: 'moderation.publicChat', from: false, to: true });
    expect(diff.limits).toContainEqual({ path: 'join.maxPlayers', from: 500, to: 1000 });
    expect(diff.approvedPresets.added).toContain('formative_check');
  });

  it('diffPolicies — bir xil bo lsa bo sh diff', () => {
    const a = makePolicy();
    const diff = diffPolicies(a, { ...a });
    expect(diff.lockedFields).toEqual([]);
    expect(diff.limits).toEqual([]);
    expect(diff.approvedPresets.added).toEqual([]);
    expect(diff.approvedPresets.removed).toEqual([]);
  });
});

// ── Effective resolution (item 2, 7) ──
describe('C4-08: resolveEffectivePolicy', () => {
  it('null — hech qanday PUBLISHED yo q', () => {
    expect(resolveEffectivePolicy([makePolicy()])).toBeNull();
  });

  it('eng yuqori version PUBLISHED tanlanadi', () => {
    const v1 = publishPolicy(makePolicy(), { by: 'a', confirm: true });
    const v2 = publishPolicy(bumpPolicyVersion(v1, { by: 'a' }), { by: 'a', confirm: true });
    const eff = resolveEffectivePolicy([v1, v2]);
    expect(eff.policyId).toBe(v2.policyId);
    expect(eff.version).toBe(2);
  });

  it('DEPRECATED hisobga olinmaydi', () => {
    const v1 = deprecatePolicy(publishPolicy(makePolicy(), { by: 'a', confirm: true }), { by: 'a' });
    expect(resolveEffectivePolicy([v1])).toBeNull();
  });

  it('effectiveDate kelajakda bo lsa hali amalda emas', () => {
    const p = publishPolicy(makePolicy({ effectiveDate: Date.now() + 86400000 }), { by: 'a', confirm: true });
    expect(resolveEffectivePolicy([p], Date.now())).toBeNull();
    expect(resolveEffectivePolicy([p], Date.now() + 2 * 86400000)).not.toBeNull();
  });
});

// ── Apply + bypass (item 4, 12) ──
describe('C4-08: applyInstitutionPolicy va bypass', () => {
  it('lockedFields majburiy qo llanadi', () => {
    const policy = makePolicy();
    const config = { moderation: { publicChat: true }, ai: { mayExecuteLiveActions: true }, scoring: { speedBonusMax: 0 }, join: { maxPlayers: 100 } };
    const { config: out, applied } = applyInstitutionPolicy(config, policy);
    expect(out.moderation.publicChat).toBe(false);
    expect(out.ai.mayExecuteLiveActions).toBe(false);
    expect(applied).toContain('moderation.publicChat');
    expect(applied).toContain('ai.mayExecuteLiveActions');
  });

  it('limits clamp — maxSpeedWeight → speedBonusMax (0.2 → 20000)', () => {
    const policy = makePolicy();
    const config = { scoring: { speedBonusMax: 50000 }, join: { maxPlayers: 1000 } };
    const { config: out, clamped } = applyInstitutionPolicy(config, policy);
    expect(out.scoring.speedBonusMax).toBe(20000);
    expect(out.join.maxPlayers).toBe(500);
    expect(clamped).toContain('scoring.speedBonusMax');
    expect(clamped).toContain('join.maxPlayers');
  });

  it('limits chegaradan past bo lsa o zgarmaydi', () => {
    const policy = makePolicy();
    const config = { scoring: { speedBonusMax: 1000 }, join: { maxPlayers: 50 } };
    const { config: out, clamped } = applyInstitutionPolicy(config, policy);
    expect(out.scoring.speedBonusMax).toBe(1000);
    expect(out.join.maxPlayers).toBe(50);
    expect(clamped).toEqual([]);
  });

  it('assertInstitutionPolicyNotBypassed — locked override → violation', () => {
    const policy = makePolicy();
    const overrides = { moderation: { publicChat: true } };
    const violations = assertInstitutionPolicyNotBypassed(overrides, policy);
    expect(violations).toContain('moderation.publicChat');
  });

  it('assertInstitutionPolicyNotBypassed — mos override → bo sh', () => {
    const policy = makePolicy();
    const overrides = { moderation: { publicChat: false } };
    expect(assertInstitutionPolicyNotBypassed(overrides, policy)).toEqual([]);
  });

  it('assertInstitutionPolicyNotBypassed — limit dan oshgan override → violation', () => {
    const policy = makePolicy();
    const overrides = { join: { maxPlayers: 600 } };
    expect(assertInstitutionPolicyNotBypassed(overrides, policy)).toContain('join.maxPlayers');
  });

  it('policy bo lmasa hech qanday majburiyat yo q', () => {
    const config = { moderation: { publicChat: true } };
    const { config: out, applied, clamped } = applyInstitutionPolicy(config, null);
    expect(out.moderation.publicChat).toBe(true);
    expect(applied).toEqual([]);
    expect(clamped).toEqual([]);
  });
});

// ── Approved preset registry (item 2, 3) ──
describe('C4-08: isApprovedPreset', () => {
  it('approved ichida → true', () => {
    const p = makePolicy();
    expect(isApprovedPreset(p, 'responsive_accuracy')).toBe(true);
  });
  it('approved tashqarida → false', () => {
    const p = makePolicy();
    expect(isApprovedPreset(p, 'team_challenge')).toBe(false);
  });
  it('bo sh approved → cheklov yo q (true)', () => {
    const p = makePolicy({ approvedPresets: [] });
    expect(isApprovedPreset(p, 'team_challenge')).toBe(true);
  });
  it('policy yo q → true', () => {
    expect(isApprovedPreset(null, 'team_challenge')).toBe(true);
  });
});

// ── Migration preview (item 10) ──
describe('C4-08: migrationPreviewForSavedPresets', () => {
  it('locked field ga mos kelmaydigan presetlar conflict ko rsatadi', () => {
    const policy = makePolicy();
    const saved = [
      { id: 'p1', name: 'Open chat', overrides: { moderation: { publicChat: true } } },
      { id: 'p2', name: 'Safest', overrides: { moderation: { publicChat: false } } },
    ];
    const preview = migrationPreviewForSavedPresets(saved, policy);
    expect(preview[0].conflicts.length).toBeGreaterThan(0);
    expect(preview[1].conflicts).toEqual([]);
  });

  it('limit oshgan preset conflict — maxSpeedWeight', () => {
    const policy = makePolicy();
    const saved = [{ id: 'p1', name: 'Fast', overrides: { scoring: { speedBonusMax: 90000 } } }];
    const preview = migrationPreviewForSavedPresets(saved, policy);
    expect(preview[0].conflicts).toContainEqual(expect.objectContaining({ path: 'scoring.speedBonusMax', to: 20000 }));
  });

  it('policy bo lmasa hamma preset clean', () => {
    const saved = [{ id: 'p1', name: 'x', overrides: { moderation: { publicChat: true } } }];
    const preview = migrationPreviewForSavedPresets(saved, null);
    expect(preview[0].conflicts).toEqual([]);
  });
});

// ── Pin + audit (item 9, 13) ──
describe('C4-08: pinSessionPolicy va governanceAuditExport', () => {
  it('pinSessionPolicy — policyId/version/pinnedAt', () => {
    const p = publishPolicy(makePolicy(), { by: 'a', confirm: true });
    const pin = pinSessionPolicy(p);
    expect(pin.policyId).toBe(p.policyId);
    expect(pin.policyVersion).toBe(1);
    expect(pin.pinnedAt).toBeTruthy();
  });

  it('governanceAuditExport — safe, raw text yo q, faqat at/by/action/version', () => {
    const p = publishPolicy(makePolicy(), { by: 'admin', confirm: true });
    const exp = governanceAuditExport(p);
    expect(exp.policyId).toBe(p.policyId);
    expect(exp.audit).toEqual([expect.objectContaining({ action: 'publish', by: 'admin' })]);
    // raw text hech qachon chiqmaydi
    expect(JSON.stringify(exp)).not.toMatch(/raw|answerKey|password|token/i);
  });
});

// ── Tenant boundary (item 14) ──
describe('C4-08: tenant boundary', () => {
  it('isSameTenant — mos tenant true, boshqa false', () => {
    const p = makePolicy();
    expect(isSameTenant(p, 'school_12')).toBe(true);
    expect(isSameTenant(p, 'school_13')).toBe(false);
  });
});

// ── Helpers ──
describe('C4-08: getPath/setPath', () => {
  it('getPath — nested', () => {
    expect(getPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5);
    expect(getPath({}, 'a.b')).toBeUndefined();
  });
  it('setPath — yangi object yaratadi va qiymatni qaytaradi', () => {
    const obj = {};
    const changed = setPath(obj, 'a.b', 7);
    expect(changed).toBe(true);
    expect(obj.a.b).toBe(7);
  });
  it('setPath — bir xil qiymat false qaytaradi', () => {
    const obj = { a: 1 };
    expect(setPath(obj, 'a', 1)).toBe(false);
  });
});
