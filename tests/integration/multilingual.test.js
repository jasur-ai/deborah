/**
 * Deborah — Uzbek Latin/Cyrillic & Terminology Layer (integration tests, Prompt 63)
 *
 * Service qatlami (fake DB): terminology version create/publish, term
 * add + cross-script search_key, content translation (original preserved),
 * human review (construct-equivalent), proper name identity isolation,
 * glossary injection, transliteration tool.
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

describe('multilingual — service (Prompt 63)', () => {
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

  it('terminology version — create/duplicate/publish/term add + search_key', async () => {
    const v = await mod.createTerminologyVersion({ name: 'DTM Matematika', subject: 'matematika', version: 'v1', createdBy: 'admin' });
    expect(v.ok).toBe(true);
    const dup = await mod.createTerminologyVersion({ name: 'DTM Matematika', subject: 'matematika', version: 'v1' });
    expect(dup.ok).toBe(false);

    const pub = await mod.transitionTerminologyVersion({ versionId: v.versionId, to: 'published', actorId: 'admin' });
    expect(pub.ok).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'multilingual:terminology:publish' }));

    // Term add — published version'da tahrirlash bloklanadi
    const blockedTerm = await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'x', uzLatn: 'x' });
    expect(blockedTerm.ok).toBe(false);

    // Draft version'da term qo'shish
    const v2 = await mod.createTerminologyVersion({ name: 'DTM Matematika', subject: 'matematika', version: 'v2' });
    const term = await mod.addTerminologyTerm({
      versionId: v2.versionId, canonicalTerm: 'momentum', uzLatn: 'impuls', uzCyrl: 'импулс', ru: 'импульс', en: 'momentum', subject: 'matematika',
    });
    expect(term.ok).toBe(true);
    expect(term.searchKey).toBe('impuls');

    const terms = await mod.listTerminologyTerms({ versionId: v2.versionId });
    expect(terms).toHaveLength(1);
    expect(terms[0].search_key).toBe('impuls');
  });

  it('content translation — original ALWAYS preserved; psychometric link blocked', async () => {
    const r = await mod.createContentTranslation({
      contentType: 'item', contentId: 1, sourceLang: 'uz-Latn', targetLang: 'uz-Cyrl',
      originalText: "o'quvchi momentumni tushunadi", translatedText: 'ўқувчи импулсни тушунади',
    });
    expect(r.ok).toBe(true);
    expect(tables.content_translations).toHaveLength(1);
    expect(tables.content_translations[0].original_text).toBe("o'quvchi momentumni tushunadi");
    expect(tables.content_translations[0].equivalence_status).toBe('unevaluated');
    expect(tables.content_translations[0].psychometric_linked).toBe(false);

    // original required
    const noOriginal = await mod.createContentTranslation({ contentType: 'item', contentId: 2, sourceLang: 'uz-Latn', targetLang: 'uz-Cyrl', originalText: '' });
    expect(noOriginal.ok).toBe(false);

    // same lang rejected
    const sameLang = await mod.createContentTranslation({ contentType: 'item', contentId: 3, sourceLang: 'uz-Latn', targetLang: 'uz-Latn', originalText: 'x' });
    expect(sameLang.ok).toBe(false);
  });

  it('translation review — construct-equivalent faqat inson reviewdan keyin; audit', async () => {
    const r = await mod.createContentTranslation({
      contentType: 'item', contentId: 1, sourceLang: 'uz-Latn', targetLang: 'uz-Cyrl',
      originalText: 'xat', translatedText: 'хат',
    });
    const rev = await mod.reviewTranslation({ translationId: r.translationId, reviewer: 'admin', verdict: 'construct_equivalent', notes: 'ok' });
    expect(rev.ok).toBe(true);
    expect(rev.status).toBe('approved');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'multilingual:translation:review' }));
    expect(tables.translation_reviews).toHaveLength(1);

    const bad = await mod.reviewTranslation({ translationId: r.translationId, reviewer: 'admin', verdict: 'whatever' });
    expect(bad.ok).toBe(false);
  });

  it('proper name — identity isolation guard + canonical field', async () => {
    const r = await mod.registerProperName({ identityType: 'student', identityKey: '2026-001', canonicalName: 'Aziz Karimov', uzLatn: 'Aziz Karimov', uzCyrl: 'Азиз Каримов' });
    expect(r.ok).toBe(true);
    expect(r.searchKey).toBe('aziz karimov');
    expect(tables.proper_names).toHaveLength(1);

    // upsert idempotent
    const again = await mod.registerProperName({ identityType: 'student', identityKey: '2026-001', canonicalName: 'Aziz Karimov', uzLatn: 'Aziz Karimov', uzCyrl: 'Азиз Каримов' });
    expect(again.ok).toBe(true);
    expect(again.updated).toBe(true);
    expect(tables.proper_names).toHaveLength(1);

    const names = await mod.listProperNames({ query: 'Азиз' });
    expect(names).toHaveLength(1);
  });

  it('glossary injection — subject terms to AI prompt', async () => {
    const v = await mod.createTerminologyVersion({ name: 'G', subject: 'fizika', version: 'v1' });
    await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'momentum', uzLatn: 'impuls', uzCyrl: 'импулс', subject: 'fizika' });
    await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'force', uzLatn: 'kuch', uzCyrl: 'куч', subject: 'fizika' });

    const inj = await mod.getGlossaryInjection({ versionId: v.versionId, subject: 'fizika', targetLang: 'uz-Latn' });
    expect(inj.ok).toBe(true);
    expect(inj.termCount).toBe(2);
    expect(inj.injection).toContain('momentum → impuls');
    expect(inj.injection).toContain('force → kuch');
  });

  it('transliteration tool — deterministic, ambiguous highlight', async () => {
    const r = await mod.transliterate({ text: "o'quvchi g'oya", to: 'uz-Cyrl' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('ўқувчи ғоя');
    expect(r.ambiguous.length).toBeGreaterThan(0);
  });

  it('cross-script search — Latin query finds Cyrillic-keyed terms and names', async () => {
    const v = await mod.createTerminologyVersion({ name: 'G', subject: 'matematika', version: 'v1' });
    await mod.addTerminologyTerm({ versionId: v.versionId, canonicalTerm: 'impuls', uzLatn: 'impuls', uzCyrl: 'импулс', subject: 'matematika' });
    await mod.registerProperName({ identityType: 'student', identityKey: 's1', canonicalName: 'Aziz Karimov', uzLatn: 'Aziz Karimov', uzCyrl: 'Азиз Каримов' });

    // Cyrillic query "импулс" → search_key "impuls" → topadi
    const r = await mod.crossScriptSearch({ query: 'импулс', subject: 'matematika' });
    expect(r.terms.some((t) => t.canonical_term === 'impuls')).toBe(true);

    // Latin query "impuls" → ham topadi
    const r2 = await mod.crossScriptSearch({ query: 'impuls', subject: 'matematika' });
    expect(r2.terms).toHaveLength(1);

    // Cyrillic name query → proper name topiladi
    const r3 = await mod.crossScriptSearch({ query: 'Азиз' });
    expect(r3.names.some((n) => n.canonical_name === 'Aziz Karimov')).toBe(true);
  });
});
