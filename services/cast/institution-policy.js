// ═══════════════════════════════════════════════════════════════
// C4-08 — Institution governance policy model
//
// Institution approved preset, locked field, role, provider va policy
// versionlarini boshqaradi. Server-authoritative: client locked field'ni
// override qila olmaydi (tugallanish sharti: high-risk fieldlar institution
// policydan tashqariga chiqmaydi).
// ═══════════════════════════════════════════════════════════════

export const POLICY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  DEPRECATED: 'DEPRECATED',
});

export const POLICY_STATUS_FLOW = Object.freeze({
  [POLICY_STATUS.DRAFT]: [POLICY_STATUS.PUBLISHED],
  [POLICY_STATUS.PUBLISHED]: [POLICY_STATUS.DEPRECATED, POLICY_STATUS.DRAFT],
  [POLICY_STATUS.DEPRECATED]: [],
});

// ── High-risk field katalogi (item 4) ──
// Har bir locked field path — CastConfigSnapshotSchema'dagi haqiqiy path.
// `type`: 'exact' (qiymat majburiy) | 'limit' (maksimal qiymat)
// `maxMultiplierMs`: maxSpeedWeight → speedBonusMax konversiya (0.2 → 20000)
export const GOVERNANCE_FIELD_CATALOG = Object.freeze({
  'scoring.maxSpeedWeight': {
    type: 'limit',
    max: 1,
    map: (weight, config) => Math.min(config?.scoring?.speedBonusMax ?? 0, Math.round(weight * 100000)),
  },
  'join.maxPlayers': { type: 'limit', max: 10000 },
  'leaderboard.anonymizeLowRanks': { type: 'exact', boolean: true },
  'leaderboard.visibility': { type: 'exact' },
  'leaderboard.finalVisibility': { type: 'exact' },
  'moderation.publicChat': { type: 'exact', boolean: true },
  'moderation.directMessages': { type: 'exact', boolean: true },
  'moderation.questionWall': { type: 'exact' },
  'moderation.openTextVisibility': { type: 'exact' },
  'moderation.publicIdentity': { type: 'exact' },
  'join.identity': { type: 'exact' },
  'join.maxPlayers': { type: 'limit' },
  'recording.enabled': { type: 'exact', boolean: true },
  'media.externalImages': { type: 'exact' },
  'ai.mayExecuteLiveActions': { type: 'exact', boolean: true },
  'ai.cohostMode': { type: 'exact' },
  'personalProgress.visibility': { type: 'exact' },
});

// ── Policy model (item 1) ──
/**
 * Yangi institution policy yaratish.
 * @returns policy object (DRAFT status, version 1)
 */
export function createInstitutionPolicy({
  tenantId,
  policyId,
  name,
  approvedPresets = [],
  lockedFields = {},
  limits = {},
  effectiveDate = null,
  createdBy = null,
}) {
  if (!tenantId) throw new Error('INVALID_POLICY: tenantId required');
  return {
    policyId: policyId || `inst_${sanitizeId(tenantId)}_v1`,
    tenantId,
    name: name || 'Cast institution policy',
    version: 1,
    status: POLICY_STATUS.DRAFT,
    approvedPresets: [...approvedPresets],
    lockedFields: { ...lockedFields },
    limits: { ...limits },
    effectiveDate: effectiveDate ? new Date(effectiveDate).getTime() : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy,
    publishedAt: null,
    publishedBy: null,
    deprecatedAt: null,
    deprecatedBy: null,
    audit: [],
  };
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

// ── Lifecycle (item 5, 6) ──
/**
 * DRAFT policy'ni yangilash (draft mutable, published immutable).
 * Publish qilingan policy'ni tahrirlab bo'lmaydi — yangi version ochiladi.
 */
export function updateDraftPolicy(policy, patch = {}, by = null) {
  if (policy.status !== POLICY_STATUS.DRAFT) {
    throw new Error('POLICY_LOCKED: only DRAFT policies are mutable');
  }
  const next = { ...policy, ...patch };
  next.audit = [
    ...(policy.audit || []),
    { at: Date.now(), by, action: 'update', version: policy.version },
  ];
  next.updatedAt = Date.now();
  return next;
}

/**
 * Publish — admin permission + explicit confirmation (item 6).
 * `confirm` true bo'lmasa reject (accidental publish oldini oladi).
 */
export function publishPolicy(policy, { by = null, confirm = false } = {}) {
  if (policy.status !== POLICY_STATUS.DRAFT) {
    throw new Error('INVALID_TRANSITION: only DRAFT can be published');
  }
  if (!confirm) {
    throw new Error('CONFIRM_REQUIRED: publish requires explicit confirmation');
  }
  return {
    ...policy,
    status: POLICY_STATUS.PUBLISHED,
    publishedAt: Date.now(),
    publishedBy: by,
    audit: [...(policy.audit || []), { at: Date.now(), by, action: 'publish', version: policy.version }],
  };
}

/** Deprecate — active policy o'z faoliyatini to'xtatadi. */
export function deprecatePolicy(policy, { by = null } = {}) {
  if (policy.status !== POLICY_STATUS.PUBLISHED) {
    throw new Error('INVALID_TRANSITION: only PUBLISHED can be deprecated');
  }
  return {
    ...policy,
    status: POLICY_STATUS.DEPRECATED,
    deprecatedAt: Date.now(),
    deprecatedBy: by,
    audit: [...(policy.audit || []), { at: Date.now(), by, action: 'deprecate', version: policy.version }],
  };
}

// ── Versioning (item 7) ──
/**
 * Publish qilingan policy asosida yangi version (DRAFT) ochish.
 * Effective date va version qo'shiladi.
 */
export function bumpPolicyVersion(policy, { name, lockedFields, limits, approvedPresets, effectiveDate, by = null } = {}) {
  if (policy.status === POLICY_STATUS.DRAFT) {
    throw new Error('INVALID_VERSION: DRAFT policy already mutable — use updateDraftPolicy');
  }
  return {
    ...createInstitutionPolicy({
      tenantId: policy.tenantId,
      policyId: bumpPolicyId(policy.policyId),
      name: name || policy.name,
      approvedPresets: approvedPresets ?? policy.approvedPresets,
      lockedFields: lockedFields ?? policy.lockedFields,
      limits: limits ?? policy.limits,
      effectiveDate: effectiveDate ?? policy.effectiveDate,
      createdBy: by,
    }),
    version: policy.version + 1,
    derivedFrom: policy.policyId,
  };
}

function bumpPolicyId(policyId) {
  const m = /_v(\d+)$/.exec(policyId || '');
  if (!m) return `${policyId}_v2`;
  const next = parseInt(m[1], 10) + 1;
  return policyId.slice(0, m.index) + `_v${next}`;
}

// ── Diff (item 8) ──
/** Ikki policy versiyasi orasidagi farqlar (o'qiladigan shaklda). */
export function diffPolicies(a, b) {
  const diff = { lockedFields: [], limits: [], approvedPresets: { added: [], removed: [] } };
  const allLocked = new Set([...Object.keys(a.lockedFields || {}), ...Object.keys(b.lockedFields || {})]);
  for (const path of allLocked) {
    if ((a.lockedFields || {})[path] !== (b.lockedFields || {})[path]) {
      diff.lockedFields.push({ path, from: (a.lockedFields || {})[path], to: (b.lockedFields || {})[path] });
    }
  }
  const allLimits = new Set([...Object.keys(a.limits || {}), ...Object.keys(b.limits || {})]);
  for (const path of allLimits) {
    if ((a.limits || {})[path] !== (b.limits || {})[path]) {
      diff.limits.push({ path, from: (a.limits || {})[path], to: (b.limits || {})[path] });
    }
  }
  const apA = new Set(a.approvedPresets || []);
  const apB = new Set(b.approvedPresets || []);
  for (const p of apB) if (!apA.has(p)) diff.approvedPresets.added.push(p);
  for (const p of apA) if (!apB.has(p)) diff.approvedPresets.removed.push(p);
  return diff;
}

// ── Effective resolution (item 2, 7) ──
/**
 * Berilgan vaqtda amalda bo'lgan policy — eng yuqori version'dagi PUBLISHED
 * va effectiveDate <= at. Hech biri bo'lmasa null (governance yo'q).
 * @param {Array} policies — policy objectlar ro'yxati (shu tenant uchun)
 * @param {number} [at] — hozirgi vaqt ms
 */
export function resolveEffectivePolicy(policies = [], at = Date.now()) {
  const published = (policies || []).filter(
    (p) => p && p.status === POLICY_STATUS.PUBLISHED && (!p.effectiveDate || p.effectiveDate <= at)
  );
  if (published.length === 0) return null;
  // Eng yuqori version; teng bo'lsa — eng yangi effectiveDate, keyin policyId
  // (deterministik — bir xil version'li ikki policy qaysi biri yutishini aniq qiladi)
  return published.sort((x, y) => {
    const v = (y.version || 1) - (x.version || 1);
    if (v !== 0) return v;
    const d = (y.effectiveDate || 0) - (x.effectiveDate || 0);
    if (d !== 0) return d;
    return String(x.policyId).localeCompare(String(y.policyId));
  })[0];
}

// ── Apply (item 12) ──
/**
 * Effective institution policy'ni resolved config'ga qo'llash.
 * - lockedFields 'exact' → majburiy qiymat
 * - limits → clamp (maksimal)
 * @returns {{config:object, applied:string[], clamped:string[]}}
 */
export function applyInstitutionPolicy(config, policy) {
  if (!policy) return { config, applied: [], clamped: [] };
  const applied = [];
  const clamped = [];
  for (const [path, value] of Object.entries(policy.lockedFields || {})) {
    if (setPath(config, path, value)) applied.push(path);
  }
  for (const [path, limit] of Object.entries(policy.limits || {})) {
    if (path === 'scoring.maxSpeedWeight') {
      // Contract: maxSpeedWeight 0..1 → speedBonusMax max ball (100000 asos)
      const cur = config?.scoring?.speedBonusMax ?? 0;
      const max = Math.round(limit * 100000);
      if (cur > max) {
        config.scoring.speedBonusMax = max;
        clamped.push('scoring.speedBonusMax');
      }
    } else if (path === 'join.maxPlayers') {
      const cur = config?.join?.maxPlayers;
      if (typeof cur === 'number' && cur > limit) {
        config.join.maxPlayers = limit;
        clamped.push('join.maxPlayers');
      }
    } else {
      const cur = getPath(config, path);
      if (typeof cur === 'number' && typeof limit === 'number' && cur > limit) {
        setPath(config, path, limit);
        clamped.push(path);
      }
    }
  }
  return { config, applied, clamped };
}

/** Locked field override urinishlarini aniqlash (client bypass → reject). */
export function assertInstitutionPolicyNotBypassed(overrides = {}, policy) {
  if (!policy) return [];
  const violations = [];
  for (const [path, value] of Object.entries(policy.lockedFields || {})) {
    const overrideVal = getPath(overrides, path);
    if (overrideVal !== undefined && overrideVal !== value) {
      violations.push(path);
    }
  }
  for (const [path, limit] of Object.entries(policy.limits || {})) {
    if (path === 'scoring.maxSpeedWeight') continue; // clamp orqali qo'llanadi
    const overrideVal = getPath(overrides, path);
    if (typeof overrideVal === 'number' && overrideVal > limit) {
      violations.push(path);
    }
  }
  return violations;
}

// ── Approved preset registry (item 2, 3) ──
/** Approved preset'lar ichida ekanini tekshirish. Bo'sh ro'yxat = hech qanday cheklov yo'q. */
export function isApprovedPreset(policy, presetId) {
  if (!policy) return true;
  const approved = policy.approvedPresets || [];
  if (approved.length === 0) return true; // cheklov yo'q
  return approved.includes(presetId);
}

// ── Migration preview (item 10) ──
/**
 * Saved teacher preset'larni yangi policy bilan solishtirish — qaysi preset
 * locked field'ga mos kelmaydi (migration preview).
 * @param {Array} savedPresets — [{id, name, overrides, config}]
 * @returns {Array} — har preset uchun conflicts ro'yxati
 */
export function migrationPreviewForSavedPresets(savedPresets = [], policy) {
  if (!policy) return (savedPresets || []).map((p) => ({ id: p.id, name: p.name, conflicts: [] }));
  return (savedPresets || []).map((p) => {
    const source = p.overrides || p.config || {};
    const conflicts = [];
    for (const [path, value] of Object.entries(policy.lockedFields || {})) {
      const cur = getPath(source, path);
      if (cur !== undefined && cur !== value) conflicts.push({ path, from: cur, to: value });
    }
    for (const [path, limit] of Object.entries(policy.limits || {})) {
      if (path === 'scoring.maxSpeedWeight') {
        const cur = getPath(source, 'scoring.speedBonusMax');
        const max = Math.round(limit * 100000);
        if (typeof cur === 'number' && cur > max) conflicts.push({ path: 'scoring.speedBonusMax', from: cur, to: max });
        continue;
      }
      const cur = getPath(source, path);
      if (typeof cur === 'number' && typeof limit === 'number' && cur > limit) {
        conflicts.push({ path, from: cur, to: limit });
      }
    }
    return { id: p.id, name: p.name, conflicts };
  });
}

// ── Session pin (item 9) ──
/**
 * Existing sessionlarni old policy versionida pin qilish — yangi policy
 * e'lon qilinganda eski sessiyalar o'z version'ini saqlaydi.
 * @returns sessionMeta'ga qo'shiladigan governance blok
 */
export function pinSessionPolicy(policy) {
  return {
    policyId: policy.policyId,
    policyVersion: policy.version,
    pinnedAt: Date.now(),
  };
}

// ── Audit export (item 13) ──
/**
 * Governance audit export — raw data/name YO'Q, faqat at/by/action/version
 * (safe export — raw response, answer key, token olib yurmaydi).
 */
export function governanceAuditExport(policy) {
  return {
    policyId: policy.policyId,
    tenantId: policy.tenantId,
    version: policy.version,
    status: policy.status,
    createdAt: policy.createdAt,
    publishedAt: policy.publishedAt,
    deprecatedAt: policy.deprecatedAt,
    audit: (policy.audit || []).map(({ at, by, action, version }) => ({ at, by, action, version })),
  };
}

// ── Tenant boundary (item 14) ──
/**
 * Barcha read/write'da tenant boundary tekshirish.
 * @returns true agar session/target tenantId policy.tenantId bilan mos
 */
export function isSameTenant(policy, tenantId) {
  return !!policy && policy.tenantId === tenantId;
}

// ── Storage roots ──
export const INSTITUTION_POLICY_ROOT = () => 'institution_policies';
export const INSTITUTION_POLICY_PATH = (tenantId, policyId) =>
  `institution_policies/${sanitizeId(tenantId)}/${sanitizeId(policyId)}`;

// ── Helpers ──
export function getPath(obj, path) {
  if (!obj || !path) return undefined;
  let node = obj;
  for (const part of path.split('.')) {
    if (node === undefined || node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

export function setPath(obj, path, value) {
  if (!obj || !path) return false;
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (node[last] !== value) {
    node[last] = value;
    return true;
  }
  return false;
}

export default {
  POLICY_STATUS,
  POLICY_STATUS_FLOW,
  GOVERNANCE_FIELD_CATALOG,
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
  INSTITUTION_POLICY_ROOT,
  INSTITUTION_POLICY_PATH,
  getPath,
  setPath,
};
