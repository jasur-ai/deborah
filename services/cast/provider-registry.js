/**
 * Deborah — Cast Clustering Provider Registry (C3-12)
 * ----------------------------------------------------
 * Open-Response Semantic Board uchun clustering provider'lari registri.
 *
 * - LOCAL (default): mahalliy deterministik heuristic — hech qanday API key
 *   talab qilmaydi, ma'lumot tashqariga chiqmaydi (offline-safe).
 * - EXTERNAL: ixtiyoriy semantic clustering provider — faqat
 *   CAST_CLUSTERING_PROVIDER=external + CAST_CLUSTERING_API_URL +
 *   CAST_CLUSTERING_API_KEY env'lar o'rnatilgan bo'lsa aktivlashadi.
 *
 * PURE module — I/O yo'q. Policy (training-use, retention, deletion) har
 * qanday provider request/saklashdan oldin shu registry'dan tekshiriladi
 * (plan item 15). Deletion hook faqat supportsDeletion=true provider'lar
 * uchun (item 17).
 */

export const CLUSTERING_PROVIDERS = {
  LOCAL: 'local',
  EXTERNAL: 'external',
};

export const CLUSTERING_PROVIDER_POLICIES = {
  [CLUSTERING_PROVIDERS.LOCAL]: {
    label: 'Mahalliy deterministik',
    trainingUse: false, // hech qachon tashqariga chiqmaydi
    retentionDays: 14,
    supportsDeletion: true, // lokal — darhol o'chiriladi
    needsApiKey: false,
    description: 'Offline deterministik token-similarity clustering',
    // C4-07 (item 15): SLA fieldlari — fields/region/subprocessors/training/retention/deletion
    sla: {
      region: 'local',
      dataFields: ['response_text_hash'],
      subprocessors: [],
      training: false,
      retentionDays: 14,
      deletionSlaHours: 0, // lokal — darhol
    },
    approved: true, // built-in, hech qachon tashqariga chiqmaydi
    approvedBy: 'deborah_core',
    approvedAt: 0,
  },
  [CLUSTERING_PROVIDERS.EXTERNAL]: {
    label: 'Tashqi semantic provider',
    trainingUse: false, // default: o'quv ma'lumotlariga ishlatilmaydi (saqlanadi, yuborilmaydi)
    retentionDays: 7,
    supportsDeletion: true, // deletion hook qo'llab-quvvatlanadi
    needsApiKey: true,
    description: 'Ixtiyoriy HTTP clustering endpoint (strict schema)',
    // C4-07 (item 15): SLA — tashqi provider uchun aniq ko'rsatilishi shart
    sla: {
      region: 'UNKNOWN',
      dataFields: [],
      subprocessors: [],
      training: false,
      retentionDays: 7,
      deletionSlaHours: -1, // -1 = yozilmagan — approval talab qilinadi
    },
    approved: false, // C4-07 (item 16): env bilan aniq approval bo'lmasa blok
    approvedBy: null,
    approvedAt: null,
  },
};

/** Provider ID'ni validate + policy bilan qaytarish. */
export function getClusteringProvider(id = null) {
  const pid = String(id || CLUSTERING_PROVIDERS.LOCAL);
  const policy = CLUSTERING_PROVIDER_POLICIES[pid];
  if (!policy) return null;
  return { id: pid, ...policy };
}

/** Aktiv provider — env'dan, aks holda LOCAL. */
export function getActiveClusteringProvider() {
  const fromEnv = String(process.env.CAST_CLUSTERING_PROVIDER || '').toLowerCase();
  if (
    fromEnv === CLUSTERING_PROVIDERS.EXTERNAL &&
    process.env.CAST_CLUSTERING_API_URL &&
    process.env.CAST_CLUSTERING_API_KEY
  ) {
    return getClusteringProvider(CLUSTERING_PROVIDERS.EXTERNAL);
  }
  return getClusteringProvider(CLUSTERING_PROVIDERS.LOCAL);
}

/** Provider training-use ruxsatimi? (item 15 — default: yo'q) */
export function providerAllowsTraining(providerId = null) {
  const p = getClusteringProvider(providerId);
  return p ? p.trainingUse : false;
}

/** Provider retention (kun). Retention job shu qiymatni ishlatadi. */
export function providerRetentionDays(providerId = null) {
  const p = getClusteringProvider(providerId);
  return p ? p.retentionDays : 14;
}

/** Provider deletion hook qo'llab-quvvatlaydimi? (item 17) */
export function providerSupportsDeletion(providerId = null) {
  const p = getClusteringProvider(providerId);
  return p ? p.supportsDeletion : false;
}

/** Registry metasi — director/admin UI va audit uchun. */
export const CLUSTERING_PROVIDER_META = {
  providers: CLUSTERING_PROVIDERS,
  policies: CLUSTERING_PROVIDER_POLICIES,
  active: () => getActiveClusteringProvider(),
};

// ── C4-07 (item 15/16): Provider approval gate ──
// Tashqi provider ishlatilishidan oldin institution admin tomonidan
// approval berilishi shart. Approval env orqali ham mumkin:
//   CAST_CLUSTERING_PROVIDER_APPROVED=1 — admin approval o'tkazganini bildiradi.

/** Provider approval holati. */
export function providerApprovalStatus(providerId = null) {
  const p = getClusteringProvider(providerId);
  if (!p) return { provider: providerId, approved: false, reason: 'UNKNOWN_PROVIDER' };
  if (p.id === CLUSTERING_PROVIDERS.LOCAL) {
    return { provider: p.id, approved: true, reason: 'BUILTIN_LOCAL' };
  }
  const envApproved = String(process.env.CAST_CLUSTERING_PROVIDER_APPROVED || '').toLowerCase() === '1';
  if (envApproved) return { provider: p.id, approved: true, reason: 'ENV_APPROVED' };
  return {
    provider: p.id,
    approved: false,
    reason: 'NOT_APPROVED',
    requiredFields: ['region', 'subprocessors', 'training', 'retentionDays', 'deletionSlaHours'],
  };
}

/**
 * Provider approved? — unapproved provider request/saklashdan oldin blok (item 16).
 * @throws {Error} approved bo'lmasa
 */
export function assertProviderApproved(providerId = null) {
  const st = providerApprovalStatus(providerId);
  if (!st.approved) {
    const err = new Error(`Provider approved emas: ${st.reason}`);
    err.code = 'PROVIDER_NOT_APPROVED';
    throw err;
  }
  return st;
}

/**
 * CI check — unapproved provider SDK/build'ni bloklash (item 16).
 * Provider list + approval status → build rejada bo'lsa fail.
 */
export function assertApprovedBuild(requiredApproved = true) {
  const active = getActiveClusteringProvider();
  const st = providerApprovalStatus(active?.id);
  const buildBlocked = requiredApproved && !st.approved && active?.id !== CLUSTERING_PROVIDERS.LOCAL;
  return {
    ok: !buildBlocked,
    active: active?.id,
    status: st,
    blocked: buildBlocked,
  };
}

export default {
  CLUSTERING_PROVIDERS,
  CLUSTERING_PROVIDER_POLICIES,
  getClusteringProvider,
  getActiveClusteringProvider,
  providerAllowsTraining,
  providerRetentionDays,
  providerSupportsDeletion,
  providerApprovalStatus,
  assertProviderApproved,
  assertApprovedBuild,
  CLUSTERING_PROVIDER_META,
};
