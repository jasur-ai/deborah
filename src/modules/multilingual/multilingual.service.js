/**
 * Edikit — Uzbek Latin/Cyrillic & Terminology Layer (service)
 *
 * Prompt 63 — terminology bank (versioned), content translations
 * (original_text ALWAYS preserved), proper names (identity isolation),
 * cross-script search, glossary injection. research.md §58.
 *
 * SECURITY / DATA GUARD (Prompt 63 §15, §58.2/58.4):
 *   - Transliteration translation yoki psychometric equivalence emas.
 *   - Original text doim saqlanadi.
 *   - Identity name va content transliteration birlashtirilmaydi.
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 */

import { getDb } from '../../infrastructure/postgres.js';
import { getCurrentTenant } from '../auth/tenant-context.js';
import { audit, AUDIT_ACTIONS } from '../auth/audit.js';
import {
  SUPPORTED_LOCALES,
  TERMINOLOGY_VERSION_STATUS,
  TRANSLATION_STATUS,
  EQUIVALENCE_STATUS,
  transliterateUz,
  normalizeUzName,
  buildSearchKey,
  assertNoPsychometricEquivalence,
  assertOriginalPreserved,
  assertIdentityNameIsolation,
  buildGlossaryInjection,
  assertSupportedLocale,
} from './multilingual.schema.js';

/** jsonb maydonlarni string (fake DB) / object (real PG) ikkalasida ham object qiladi. */
function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function getTenantId() {
  const ctx = getCurrentTenant();
  return ctx?.id ?? ctx?.tenantId ?? null;
}

/** Har service funksiyasida tenant scope fail-closed guard. */
function requireTenant() {
  const tenantId = getTenantId();
  if (!tenantId) return { ok: false, error: 'tenant context is required' };
  return { ok: true, tenantId };
}

// ═══════════════════════════════════════════════════════════════════
// TERMINOLOGY BANK (versioned)
// ═══════════════════════════════════════════════════════════════════

/** Create a terminology version (draft). */
export async function createTerminologyVersion({ name = '', subject = null, version = 'v1', createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!name) return { ok: false, error: 'name is required' };

  const existing = await db
    .selectFrom('terminology_versions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('name', '=', name)
    .where('version', '=', version)
    .executeTakeFirst();
  if (existing) return { ok: false, error: `terminology version ${name}@${version} already exists` };

  const row = await db
    .insertInto('terminology_versions')
    .values({ tenant_id: tenantId, name, subject, version, status: TERMINOLOGY_VERSION_STATUS.DRAFT, created_by: createdBy })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, versionId: row.id, version };
}

/** List terminology versions (tenant-scoped). */
export async function listTerminologyVersions({ status = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('terminology_versions').selectAll().where('tenant_id', '=', tenantId);
  if (status) q = q.where('status', '=', status);
  return q.orderBy('created_at', 'desc').execute();
}

/** Publish a terminology version (draft→review→published). */
export async function transitionTerminologyVersion({ versionId = 0, to = '', actorId = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  const v = await db
    .selectFrom('terminology_versions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', versionId)
    .executeTakeFirst();
  if (!v) return { ok: false, error: 'terminology version not found' };
  if (!Object.values(TERMINOLOGY_VERSION_STATUS).includes(to)) return { ok: false, error: `invalid status: ${to}` };

  await db
    .updateTable('terminology_versions')
    .set({ status: to, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', versionId)
    .execute();

  if (to === TERMINOLOGY_VERSION_STATUS.PUBLISHED) {
    await audit({
      action: AUDIT_ACTIONS.MULTILINGUAL_TERMINOLOGY_PUBLISH,
      userId: actorId,
      tenantId,
      resourceType: 'terminology_version',
      resourceId: String(versionId),
      details: { name: v.name, version: v.version },
    });
  }
  return { ok: true, versionId, status: to };
}

/** Add a terminology term (canonical + all scripts + search_key). */
export async function addTerminologyTerm({
  versionId = 0, canonicalTerm = '', uzLatn = '', uzCyrl = '', ru = '', en = '',
  definition = '', forbiddenVariants = [], subject = null, source = null, reviewer = null, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!canonicalTerm) return { ok: false, error: 'canonicalTerm is required' };

  const version = await db
    .selectFrom('terminology_versions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', versionId)
    .executeTakeFirst();
  if (!version) return { ok: false, error: 'terminology version not found' };
  if (version.status !== TERMINOLOGY_VERSION_STATUS.DRAFT && version.status !== TERMINOLOGY_VERSION_STATUS.REVIEW) {
    return { ok: false, error: `cannot edit ${version.status} terminology — publish a new version` };
  }

  // search_key — canonical Latn base (cross-script search)
  const searchKey = buildSearchKey(uzLatn || uzCyrl || canonicalTerm);

  const row = await db
    .insertInto('terminology_terms')
    .values({
      tenant_id: tenantId, version_id: versionId, canonical_term: canonicalTerm,
      uz_latn: uzLatn, uz_cyrl: uzCyrl, ru, en, definition,
      forbidden_variants: JSON.stringify(forbiddenVariants || []),
      subject, source, reviewer, search_key: searchKey,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, termId: row.id, searchKey };
}

/** List terms (optionally search across scripts). */
export async function listTerminologyTerms({ versionId = 0, subject = null, query = '' } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('terminology_terms').selectAll().where('tenant_id', '=', tenantId);
  if (versionId) q = q.where('version_id', '=', versionId);
  if (subject) q = q.where('subject', '=', subject);
  const rows = await q.orderBy('canonical_term', 'asc').execute();
  let items = rows.map((r) => ({ ...r, forbidden_variants: parseJson(r.forbidden_variants) || [] }));

  if (query) {
    const key = buildSearchKey(query);
    items = items.filter((r) => (r.search_key || '').includes(key) || (r.canonical_term || '').toLowerCase().includes(query.toLowerCase()));
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════
// CONTENT TRANSLATIONS (original ALWAYS preserved)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a content translation. original_text HAR DOIM saqlanadi —
 * transliterated/translated result original'siz qabul qilinmaydi (§58.2).
 */
export async function createContentTranslation({
  contentType = 'item', contentId = 0, sourceLang = 'uz-Latn', targetLang = 'uz-Cyrl',
  originalText = '', translatedText = null, terminologyVersion = null, createdBy = null,
} = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  const src = assertSupportedLocale({ lang: sourceLang });
  if (!src.ok) return { ok: false, error: src.reason };
  const dst = assertSupportedLocale({ lang: targetLang });
  if (!dst.ok) return { ok: false, error: dst.reason };
  if (sourceLang === targetLang) return { ok: false, error: 'source and target languages must differ' };
  if (!originalText) return { ok: false, error: 'originalText is required' };

  // Original saqlanishi majburiy
  const preserved = assertOriginalPreserved({ original: originalText, result: translatedText || '' });
  if (!preserved.ok) return { ok: false, error: preserved.reason };

  // Transliteration ≠ psychometric equivalence — default unevaluated
  const eq = assertNoPsychometricEquivalence({ psychometricLinked: false, equivalenceStatus: EQUIVALENCE_STATUS.UNEVALUATED });
  if (!eq.ok) return { ok: false, error: eq.reason };

  const row = await db
    .insertInto('content_translations')
    .values({
      tenant_id: tenantId, content_type: contentType, content_id: contentId,
      source_lang: sourceLang, target_lang: targetLang,
      original_text: originalText, translated_text: translatedText,
      translation_status: TRANSLATION_STATUS.DRAFT,
      terminology_version: terminologyVersion,
      equivalence_status: EQUIVALENCE_STATUS.UNEVALUATED,
      psychometric_linked: false,
      created_by: createdBy,
    })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, translationId: row.id };
}

/** List translations for content (tenant-scoped). */
export async function listContentTranslations({ contentType = null, contentId = null, targetLang = null } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('content_translations').selectAll().where('tenant_id', '=', tenantId);
  if (contentType) q = q.where('content_type', '=', contentType);
  if (contentId) q = q.where('content_id', '=', contentId);
  if (targetLang) q = q.where('target_lang', '=', targetLang);
  return q.orderBy('created_at', 'desc').execute();
}

/**
 * Review a translation (human reviewer). Construct-equivalent verdict
 * faqat inson review'dan keyin qo'yiladi; psychometric link hech qachon
 * auto qilinmaydi.
 */
export async function reviewTranslation({ translationId = 0, reviewer = '', verdict = '', notes = '', terminologyVersion = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!reviewer) return { ok: false, error: 'reviewer is required' };
  if (!Object.values(EQUIVALENCE_STATUS).includes(verdict)) return { ok: false, error: `invalid verdict: ${verdict}` };

  const translation = await db
    .selectFrom('content_translations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', translationId)
    .executeTakeFirst();
  if (!translation) return { ok: false, error: 'translation not found' };

  // Psychometric link auto qilinmaydi (guard)
  const eq = assertNoPsychometricEquivalence({ psychometricLinked: false, equivalenceStatus: verdict });
  if (!eq.ok) return { ok: false, error: eq.reason };

  const status = verdict === EQUIVALENCE_STATUS.CONSTRUCT_EQUIVALENT ? TRANSLATION_STATUS.APPROVED : TRANSLATION_STATUS.REVIEWED;
  await db
    .updateTable('content_translations')
    .set({ translation_status: status, equivalence_status: verdict, terminology_version: terminologyVersion ?? translation.terminology_version, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', translationId)
    .execute();

  await db
    .insertInto('translation_reviews')
    .values({ tenant_id: tenantId, translation_id: translationId, reviewer, verdict, notes })
    .execute();

  await audit({
    action: AUDIT_ACTIONS.MULTILINGUAL_TRANSLATION_REVIEW,
    userId: reviewer,
    tenantId,
    resourceType: 'content_translation',
    resourceId: String(translationId),
    details: { verdict, terminologyVersion },
  });
  return { ok: true, translationId, status, verdict };
}

// ═══════════════════════════════════════════════════════════════════
// PROPER NAMES (identity isolation)
// ═══════════════════════════════════════════════════════════════════

/**
 * Register a proper name (student/institution canonical). Identity name
 * content transliterator bilan ko'r-ko'rona o'zgartirilmaydi (§58.2) —
 * canonical field + alohida script fields.
 */
export async function registerProperName({ identityType = 'student', identityKey = '', canonicalName = '', uzLatn = null, uzCyrl = null, createdBy = null } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;
  if (!identityKey || !canonicalName) return { ok: false, error: 'identityKey and canonicalName are required' };

  // Registering a proper name with EXPLICIT canonical + per-script fields is
  // the SAFE path (§58.2) — the caller provides human-confirmed script
  // variants, so this is NOT blind transliteration. The isolation guard only
  // rejects blind transliteration (allowTransliteration: false), which the
  // content transliteration tool uses — never this registration path.
  const guard = assertIdentityNameIsolation({ isIdentity: true, allowTransliteration: true });
  if (!guard.ok) return { ok: false, error: guard.reason };

  const existing = await db
    .selectFrom('proper_names')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('identity_type', '=', identityType)
    .where('identity_key', '=', identityKey)
    .executeTakeFirst();

  const searchKey = buildSearchKey(uzLatn || uzCyrl || canonicalName);

  if (existing) {
    await db
      .updateTable('proper_names')
      .set({ canonical_name: canonicalName, uz_latn: uzLatn, uz_cyrl: uzCyrl, search_key: searchKey, created_by: createdBy })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', existing.id)
      .execute();
    return { ok: true, nameId: existing.id, updated: true, searchKey };
  }

  const row = await db
    .insertInto('proper_names')
    .values({ tenant_id: tenantId, identity_type: identityType, identity_key: identityKey, canonical_name: canonicalName, uz_latn: uzLatn, uz_cyrl: uzCyrl, search_key: searchKey, created_by: createdBy })
    .returning(['id'])
    .executeTakeFirst();
  return { ok: true, nameId: row.id, updated: false, searchKey };
}

/** List proper names (cross-script searchable). */
export async function listProperNames({ identityType = null, query = '' } = {}) {
  const db = getDb();
  if (!db) return [];
  const t = requireTenant();
  if (!t.ok) return [];
  const tenantId = t.tenantId;
  let q = db.selectFrom('proper_names').selectAll().where('tenant_id', '=', tenantId);
  if (identityType) q = q.where('identity_type', '=', identityType);
  const rows = await q.orderBy('canonical_name', 'asc').execute();
  if (!query) return rows;
  const key = buildSearchKey(query);
  return rows.filter((r) => (r.search_key || '').includes(key) || (r.canonical_name || '').toLowerCase().includes(query.toLowerCase()));
}

// ═══════════════════════════════════════════════════════════════════
// GLOSSARY INJECTION + TRANSLITERATION TOOL
// ═══════════════════════════════════════════════════════════════════

/** Build glossary injection for a subject (AI prompts/content). */
export async function getGlossaryInjection({ versionId = 0, subject = null, targetLang = 'uz-Latn', limit = 50 } = {}) {
  const db = getDb();
  if (!db) return { ok: false, error: 'PostgreSQL required' };
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const tenantId = t.tenantId;

  let q = db.selectFrom('terminology_terms').selectAll().where('tenant_id', '=', tenantId);
  if (versionId) q = q.where('version_id', '=', versionId);
  if (subject) q = q.where('subject', '=', subject);
  const rows = await q.limit(Math.min(Number(limit) || 50, 200)).execute();
  const terms = rows.map((r) => ({ ...r, forbidden_variants: parseJson(r.forbidden_variants) || [] }));
  return buildGlossaryInjection({ terms, targetLang });
}

/** Transliteration tool endpoint (deterministic, original preserved by caller). */
export async function transliterate({ text = '', from = '', to = 'uz-Cyrl' } = {}) {
  const t = requireTenant();
  if (!t.ok) return { ok: false, error: t.error };
  const preserved = assertOriginalPreserved({ original: text, result: text });
  if (!preserved.ok) return { ok: false, error: preserved.reason };
  return transliterateUz({ text, from, to });
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-SCRIPT SEARCH (unified)
// ═══════════════════════════════════════════════════════════════════

/** Cross-script search across terms + proper names (unified results). */
export async function crossScriptSearch({ query = '', subject = null, limit = 20 } = {}) {
  const db = getDb();
  if (!db) return { terms: [], names: [] };
  const t = requireTenant();
  if (!t.ok) return { terms: [], names: [] };
  const tenantId = t.tenantId;
  if (!query) return { terms: [], names: [] };

  const key = buildSearchKey(query);
  const cap = Math.min(Number(limit) || 20, 100);

  let q = db.selectFrom('terminology_terms').selectAll().where('tenant_id', '=', tenantId);
  if (subject) q = q.where('subject', '=', subject);
  const termRows = await q.limit(500).execute();
  const terms = termRows
    .filter((r) => (r.search_key || '').includes(key) || (r.canonical_term || '').toLowerCase().includes(query.toLowerCase()))
    .slice(0, cap)
    .map((r) => ({ ...r, forbidden_variants: parseJson(r.forbidden_variants) || [] }));

  const nameRows = await db.selectFrom('proper_names').selectAll().where('tenant_id', '=', tenantId).limit(500).execute();
  const names = nameRows
    .filter((r) => (r.search_key || '').includes(key) || (r.canonical_name || '').toLowerCase().includes(query.toLowerCase()))
    .slice(0, cap);

  return { terms, names };
}
