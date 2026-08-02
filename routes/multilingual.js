/**
 * Edikit — Uzbek Latin/Cyrillic & Terminology Layer Routes
 *
 * Prompt 63 REST API:
 *   - GET    /admin/multilingual                        — admin UI
 *   - GET    /api/admin/multilingual/versions           — list terminology versions
 *   - POST   /api/admin/multilingual/versions           — create version
 *   - POST   /api/admin/multilingual/versions/:id/status — transition status
 *   - GET    /api/admin/multilingual/terms              — list/search terms
 *   - POST   /api/admin/multilingual/terms              — add term
 *   - GET    /api/admin/multilingual/translations       — list translations
 *   - POST   /api/admin/multilingual/translations       — create translation
 *   - POST   /api/admin/multilingual/translations/:id/review — review translation
 *   - GET    /api/admin/multilingual/proper-names       — list proper names
 *   - POST   /api/admin/multilingual/proper-names       — register proper name
 *   - GET    /api/admin/multilingual/glossary           — glossary injection
 *   - POST   /api/admin/multilingual/transliterate      — transliteration tool
 *   - GET    /api/admin/multilingual/search             — cross-script search
 *
 * Security (Prompt 63 §15, §58.2/58.4): hamma route'lar requireAdmin;
 * transliteration ≠ translation/psychometric equivalence; original text
 * doim saqlanadi; identity name alohida; privileged actionlar audited.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  createTerminologyVersion,
  listTerminologyVersions,
  transitionTerminologyVersion,
  addTerminologyTerm,
  listTerminologyTerms,
  createContentTranslation,
  listContentTranslations,
  reviewTranslation,
  registerProperName,
  listProperNames,
  getGlossaryInjection,
  transliterate,
  crossScriptSearch,
} from '../src/modules/multilingual/index.js';

const router = Router();

function actorId(req) {
  return req.session?.admin?.username || req.session?.admin?.id || req.session?.user?.username || req.session?.user?.id || null;
}

/** GET /admin/multilingual — admin UI. */
router.get('/admin/multilingual', requireAdmin, (req, res) => {
  res.render('admin/multilingual', {
    title: 'Multilingual',
    user: req.session.admin,
    csrfToken: req.csrfToken?.(),
  });
});

// ── Terminology versions ───────────────────────────────────────────

router.get('/api/admin/multilingual/versions', requireAdmin, async (req, res) => {
  try {
    const versions = await listTerminologyVersions({ status: req.query.status || null });
    res.json({ versions });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/versions', requireAdmin, async (req, res) => {
  try {
    const r = await createTerminologyVersion({
      name: req.body?.name || '',
      subject: req.body?.subject || null,
      version: req.body?.version || 'v1',
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, versionId: r.versionId, version: r.version });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/versions/:id/status', requireAdmin, async (req, res) => {
  try {
    const r = await transitionTerminologyVersion({ versionId: Number(req.params.id), to: req.body?.status || '', actorId: actorId(req) });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Terminology terms ──────────────────────────────────────────────

router.get('/api/admin/multilingual/terms', requireAdmin, async (req, res) => {
  try {
    const terms = await listTerminologyTerms({
      versionId: Number(req.query.versionId || 0),
      subject: req.query.subject || '',
      query: req.query.query || '',
    });
    res.json({ terms });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/terms', requireAdmin, async (req, res) => {
  try {
    const r = await addTerminologyTerm({
      versionId: Number(req.body?.versionId || 0),
      canonicalTerm: req.body?.canonicalTerm || '',
      uzLatn: req.body?.uzLatn || '',
      uzCyrl: req.body?.uzCyrl || '',
      ru: req.body?.ru || '',
      en: req.body?.en || '',
      definition: req.body?.definition || '',
      forbiddenVariants: req.body?.forbiddenVariants || [],
      subject: req.body?.subject || null,
      source: req.body?.source || null,
      reviewer: req.body?.reviewer || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, termId: r.termId, searchKey: r.searchKey });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Content translations ───────────────────────────────────────────

router.get('/api/admin/multilingual/translations', requireAdmin, async (req, res) => {
  try {
    const items = await listContentTranslations({
      contentType: req.query.contentType || null,
      contentId: req.query.contentId ? Number(req.query.contentId) : null,
      targetLang: req.query.targetLang || null,
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/translations', requireAdmin, async (req, res) => {
  try {
    const r = await createContentTranslation({
      contentType: req.body?.contentType || 'item',
      contentId: Number(req.body?.contentId || 0),
      sourceLang: req.body?.sourceLang || 'uz-Latn',
      targetLang: req.body?.targetLang || 'uz-Cyrl',
      originalText: req.body?.originalText || '',
      translatedText: req.body?.translatedText ?? null,
      terminologyVersion: req.body?.terminologyVersion || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, translationId: r.translationId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/translations/:id/review', requireAdmin, async (req, res) => {
  try {
    const r = await reviewTranslation({
      translationId: Number(req.params.id),
      reviewer: actorId(req),
      verdict: req.body?.verdict || '',
      notes: req.body?.notes || '',
      terminologyVersion: req.body?.terminologyVersion || null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, translationId: r.translationId, status: r.status, verdict: r.verdict });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Proper names ───────────────────────────────────────────────────

router.get('/api/admin/multilingual/proper-names', requireAdmin, async (req, res) => {
  try {
    const names = await listProperNames({ identityType: req.query.identityType || null, query: req.query.query || '' });
    res.json({ names });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/proper-names', requireAdmin, async (req, res) => {
  try {
    const r = await registerProperName({
      identityType: req.body?.identityType || 'student',
      identityKey: req.body?.identityKey || '',
      canonicalName: req.body?.canonicalName || '',
      uzLatn: req.body?.uzLatn || null,
      uzCyrl: req.body?.uzCyrl || null,
      createdBy: actorId(req),
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, nameId: r.nameId, updated: r.updated, searchKey: r.searchKey });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── Glossary + transliteration + search ────────────────────────────

router.get('/api/admin/multilingual/glossary', requireAdmin, async (req, res) => {
  try {
    const r = await getGlossaryInjection({
      versionId: Number(req.query.versionId || 0),
      subject: req.query.subject || null,
      targetLang: req.query.targetLang || 'uz-Latn',
      limit: Number(req.query.limit || 50),
    });
    res.json({ ok: r.ok, injection: r.injection, termCount: r.termCount });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.post('/api/admin/multilingual/transliterate', requireAdmin, async (req, res) => {
  try {
    const r = await transliterate({
      text: req.body?.text || '',
      from: req.body?.from || '',
      to: req.body?.to || 'uz-Cyrl',
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, text: r.text, from: r.from, to: r.to, ambiguous: r.ambiguous });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get('/api/admin/multilingual/search', requireAdmin, async (req, res) => {
  try {
    const r = await crossScriptSearch({ query: req.query.query || '', subject: req.query.subject || null, limit: Number(req.query.limit || 20) });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
