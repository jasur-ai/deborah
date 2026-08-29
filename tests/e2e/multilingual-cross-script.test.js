/**
 * Deborah — Uzbek Latin/Cyrillic & Terminology Layer (e2e/security, Prompt 63)
 *
 * Full workflow (research.md §58): terminology version → terms (canonical +
 * all scripts + search_key) → content translation (original preserved) →
 * human review (construct-equivalent) → proper name (identity isolation) →
 * cross-script search (Latin query finds Cyrillic content) → glossary
 * injection.
 *
 * Security: transliteration ≠ translation/psychometric equivalence; original
 * text never lost; identity name never blind-transliterated.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chainable in-memory fake DB (Kysely-ish) ──
function makeFakeDb(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  const matches = (row, wheres) =>
    (wheres || []).every(([col, op, val]) => {
      if (op === '=') return row[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(row[col]);
      return true;
    });

  const builder = (table, state = {}) => ({
    select: (cols) => builder(table, { ...state, cols }),
    selectAll: () => builder(table, { ...state, cols: null }),
    where: (col, op, val) => builder(table, { ...state, wheres: [...(state.wheres || []), [col, op, val]] }),
    orderBy: () => builder(table, state),
    limit: (n) => builder(table, { ...state, limitN: n }),
    async execute() {
      let rows = (tables[table] || []).filter((r) => matches(r, state.wheres));
      if (state.limitN) rows = rows.slice(0, state.limitN);
      if (state.cols === null) return rows.map((r) => ({ ...r }));
      return rows;
    },
    async executeTakeFirst() {
      const rows = await this.execute();
      return rows[0] || null;
    },
  });

  const db = {
    selectFrom: (table) => builder(table),
    insertInto: (table) => ({
      values: (row) => ({
        returning: (cols) => ({
          async executeTakeFirst() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
            const o = {};
            for (const c of cols) o[c] = { id, ...row }[c];
            return o;
          },
          async execute() {
            const id = nextId++;
            (tables[table] = tables[table] || []).push({ id, ...row });
          },
        }),
        async execute() {
          const id = nextId++;
          (tables[table] = tables[table] || []).push({ id, ...row });
        },
      }),
    }),
    updateTable: (table) => ({
      set: (patch) => ({
        where: () => ({
          where: () => ({
            async execute() {
              for (const row of tables[table] || []) Object.assign(row, patch);
            },
          }),
          async execute() {
            for (const row of tables[table] || []) Object.assign(row, patch);
          },
        }),
        async execute() {
          for (const row of tables[table] || []) Object.assign(row, patch);
        },
      }),
    }),
  };
  return { db, tables };
}

describe('Prompt 63 — multilingual cross-script workflow', () => {
  let mod;
  let tables;
  let auditMock;

  beforeEach(async () => {
    vi.resetModules();
    const fake = makeFakeDb({});
    tables = fake.tables;
    auditMock = vi.fn(async () => true);
    vi.doMock('../../src/infrastructure/postgres.js', () => ({ getDb: () => fake.db }));
    vi.doMock('../../src/modules/auth/tenant-context.js', () => ({ getCurrentTenant: () => ({ id: 1 }) }));
    vi.doMock('../../src/modules/auth/audit.js', () => ({
      audit: auditMock,
      AUDIT_ACTIONS: {
        MULTILINGUAL_TERMINOLOGY_PUBLISH: 'multilingual:terminology:publish',
        MULTILINGUAL_TRANSLATION_REVIEW: 'multilingual:translation:review',
      },
    }));
    mod = await import('../../src/modules/multilingual/index.js');
  });

  it('full workflow — terminology → translation → review → cross-script search → glossary', async () => {
    // 1. Terminology version + terms (canonical + scripts)
    const v = await mod.createTerminologyVersion({ name: 'DTM Fizika', subject: 'fizika', version: 'v1', createdBy: 'admin' });
    expect(v.ok).toBe(true);
    await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'momentum', uzLatn: 'impuls', uzCyrl: 'импулс', ru: 'импульс', en: 'momentum', subject: 'fizika' });
    await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'acceleration', uzLatn: 'tezlanish', uzCyrl: 'тезланиш', ru: 'ускорение', en: 'acceleration', subject: 'fizika' });
    await mod.transitionTerminologyVersion({ versionId: v.versionId, to: 'published', actorId: 'admin' });

    // 2. Content translation — original preserved, no psychometric link
    const tr = await mod.createContentTranslation({
      contentType: 'item', contentId: 7, sourceLang: 'uz-Latn', targetLang: 'uz-Cyrl',
      originalText: "momentum impulsi saqlanadi", translatedText: 'импулс сақланади',
    });
    expect(tr.ok).toBe(true);
    expect(tables.content_translations[0].original_text).toBe('momentum impulsi saqlanadi');
    expect(tables.content_translations[0].psychometric_linked).toBe(false);

    // 3. Human review → construct-equivalent (only after review)
    const rev = await mod.reviewTranslation({ translationId: tr.translationId, reviewer: 'admin', verdict: 'construct_equivalent', notes: 'anchor sample' });
    expect(rev.ok).toBe(true);
    expect(rev.status).toBe('approved');

    // 4. Proper name — identity isolation
    const name = await mod.registerProperName({ identityType: 'institution', identityKey: 'TUIT', canonicalName: 'Toshkent Axborot Texnologiyalari Universiteti', uzLatn: 'Toshkent Axborot Texnologiyalari Universiteti', uzCyrl: 'Тошкент Ахборот Технологиялари Университети' });
    expect(name.ok).toBe(true);

    // 5. Cross-script search — Latin query finds Cyrillic-keyed content
    const byCyrl = await mod.crossScriptSearch({ query: 'импулс', subject: 'fizika' });
    expect(byCyrl.terms.some((t) => t.canonical_term === 'momentum')).toBe(true);
    const byLatn = await mod.crossScriptSearch({ query: 'impuls', subject: 'fizika' });
    expect(byLatn.terms.some((t) => t.canonical_term === 'momentum')).toBe(true);
    // Cyrillic institution name query → found via search_key
    const inst = await mod.crossScriptSearch({ query: 'Ахборот' });
    expect(inst.names.some((n) => n.canonical_name.includes('Toshkent'))).toBe(true);

    // 6. Glossary injection for AI
    const inj = await mod.getGlossaryInjection({ versionId: v.versionId, subject: 'fizika', targetLang: 'uz-Latn' });
    expect(inj.termCount).toBe(2);
    expect(inj.injection).toContain('momentum → impuls');
    expect(inj.injection).toContain('acceleration → tezlanish');

    // 7. Audit trail
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'multilingual:terminology:publish' }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'multilingual:translation:review' }));
  });

  it('security — psychometric equivalence never auto-linked; original never lost', async () => {
    // createContentTranslation always stores unevaluated + psychometric_linked false
    const tr = await mod.createContentTranslation({
      contentType: 'item', contentId: 1, sourceLang: 'uz-Cyrl', targetLang: 'uz-Latn',
      originalText: 'ўқувчи', translatedText: "o'quvchi",
    });
    expect(tr.ok).toBe(true);
    expect(tables.content_translations[0].equivalence_status).toBe('unevaluated');

    // Direct guard-level check
    const eq = mod.assertNoPsychometricEquivalence({ psychometricLinked: true });
    expect(eq.ok).toBe(false);
    const preserved = mod.assertOriginalPreserved({ original: 'x', result: '' });
    expect(preserved.ok).toBe(false);
    const identity = mod.assertIdentityNameIsolation({ isIdentity: true });
    expect(identity.ok).toBe(false);
  });

  it('security — identity proper name never blind-transliterated via content tool', async () => {
    const name = await mod.registerProperName({ identityType: 'student', identityKey: '2026-001', canonicalName: 'Aziz Karimov', uzLatn: 'Aziz Karimov', uzCyrl: 'Азиз Каримов' });
    expect(name.ok).toBe(true);
    // proper name must keep canonical field — no content transliteration overwrites it
    expect(tables.proper_names[0].canonical_name).toBe('Aziz Karimov');
    expect(tables.proper_names[0].uz_cyrl).toBe('Азиз Каримов');

    // Transliteration tool does NOT touch identity names
    const r = await mod.transliterate({ text: 'Aziz Karimov', to: 'uz-Cyrl' });
    expect(r.ok).toBe(true);
    expect(tables.proper_names[0].canonical_name).toBe('Aziz Karimov'); // unchanged
  });

  it('determinism — same content transliterates identically; golden set holds', async () => {
    const a = await mod.transliterate({ text: "o'quvchi g'oya shahar", to: 'uz-Cyrl' });
    const b = await mod.transliterate({ text: "o'quvchi g'oya shahar", to: 'uz-Cyrl' });
    expect(a.text).toBe(b.text);
    expect(a.text).toBe('ўқувчи ғоя шаҳар');
  });
});
