/**
 * AUTH D-24 — Public legal pages (/privacy, /terms, /cookies)
 * -----------------------------------------------------------------
 *  - Content source: src/modules/legal/legal-docs.js (ps D-24, 4 til)
 *  - Lang: ?lang= query → `lang` cookie → 'uz' (resolveAuthLang whitelist)
 *  - Public pages — auth talab qilinmaydi (CSRF kerak emas, GET only)
 *  - EJS auto-escape: barcha kontent <%- emas, <%= bilan render qilinadi
 */
import { Router } from 'express';
import { getLegalDoc, getLegalMeta, resolveLegalLang } from '../src/modules/legal/legal-docs.js';
import { resolveAuthLang } from '../data/auth-i18n.js';

const router = Router();

const LEGAL_DOCS = ['privacy', 'terms', 'cookies'];

/** Lang: ?lang → cookie `lang` → default. Cookie faqat whitelist bo'lsa o'qiladi. */
function resolveLang(req) {
  const q = String(req.query.lang || '');
  if (q) return resolveAuthLang(q);
  const cookie = (req.headers.cookie || '').split(';').find((c) => c.trim().startsWith('lang='));
  if (cookie) {
    const val = cookie.split('=').slice(1).join('=').trim();
    if (val) return resolveAuthLang(val);
  }
  return 'uz';
}

/**
 * Bitta hujjat sahifasi.
 * @param {'privacy'|'terms'|'cookies'} doc
 */
function renderDoc(doc) {
  return (req, res, next) => {
    try {
      const lang = resolveLang(req);
      const data = getLegalDoc(lang, doc);
      if (!data) return next(); // noma'lum doc → 404 (quyida catch-all)
      res.render('legal', {
        title: data.title,
        description: `${data.title} — Edikit (v${data.version})`,
        lang,
        doc,
        docData: data,
        legalMeta: getLegalMeta(),
        legalDocs: LEGAL_DOCS,
        // head.ejs + lang switcher uchun
        AUTH_LANGS: ['uz', 'uz-cyrl', 'ru', 'en'],
      });
    } catch (err) {
      next(err);
    }
  };
}

router.get('/privacy', renderDoc('privacy'));
router.get('/terms', renderDoc('terms'));
router.get('/cookies', renderDoc('cookies'));

// Noma'lum legal doc → 404 (HTML, ro'yxatga havola bilan)
router.get('/legal', (req, res) => {
  res.render('legal-index', {
    title: 'Hujjatlar',
    lang: resolveLang(req),
    legalDocs: LEGAL_DOCS,
    legalMeta: getLegalMeta(),
    AUTH_LANGS: ['uz', 'uz-cyrl', 'ru', 'en'],
  });
});

export default router;
