/**
 * Deborah — Home Routes (plan_index §3)
 * Landing: til routing (/, /ru, /en, /uz-cyrl), rol CTA (?role=), copy bank.
 */

import { Router } from 'express';
import { LANDING_COPY, STATS_COPY, resolveLandingLang } from '../data/landing.js';
import { getStats } from '../src/modules/opendata/index.js';
import { isOidcEnabled } from '../src/modules/auth/oidc.js';
import { isOAuthConfigured as isHemisOAuthConfigured } from '../src/modules/auth/providers/hemis.js';

const router = Router();

// S34: CAST LANDING — hammaga ko'rinadigan bosh sahifa (uploads/cast.html namunasi 1:1,
// OneID/HEMIS'siz, REAL auth + REAL join). O'qituvchi landing'i /ustoz'da (ochiq ko'rinmaydi).
async function renderCastLanding(req, res) {
  res.render('cast-landing', {
    title: 'Deborah — savolni sinf ekraniga uzatish',
    description: "Bir tugma bilan savol sinf ekraniga uzatiladi. Javoblar real vaqtda yig'iladi.",
    siteUrl: '',
    path: '/',
    lang: 'uz',
    csrfToken: req.session?.csrfToken || '',
    oidcEnabled: isOidcEnabled(),
    hemisEnabled: false,
  });
}

async function renderLanding(req, res, langKey) {
  const lang = resolveLandingLang(langKey);
  const path = lang === 'uz' ? '/' : `/${lang}`;
  // AUTH A-13: haqiqiy ochiq ma'lumotlar stats (cache/bundled — tez; fail-soft)
  let opendata = null;
  try {
    opendata = await getStats();
  } catch {
    opendata = null; // stats bloki ko'rsatilmaydi — landing ishlashda davom etadi
  }
  res.render('index', {
    title: LANDING_COPY[lang].meta.title,
    description: LANDING_COPY[lang].meta.description,
    copy: { ...LANDING_COPY[lang], stats: STATS_COPY[lang] },
    lang,
    path,
    opendata,
    csrfToken: req.session?.csrfToken || '',
    // REAL provider holati: tugmalar jimgina emas — sozlanmagan bo'lsa aniq xabar
    oidcEnabled: isOidcEnabled(),
    hemisEnabled: isHemisOAuthConfigured(),
  });
}

router.get('/', (req, res) => {
  renderCastLanding(req, res).catch((e) => res.status(500).send(String(e?.message || e)));
});

// Til yo'llari ham cast landing'ga (client-side i18n: uz/ru/en + uz-cyrl)
router.get('/ru', (req, res) => renderCastLanding(req, res).catch((e) => res.status(500).send(String(e?.message || e))));
router.get('/en', (req, res) => renderCastLanding(req, res).catch((e) => res.status(500).send(String(e?.message || e))));
router.get('/uz-cyrl', (req, res) => renderCastLanding(req, res).catch((e) => res.status(500).send(String(e?.message || e))));

// S34: O'QITUVCHI LANDING (uploads/index.html 1:1) — /ustoz'da (ochiq ko'rinmaydi).
// renderLanding() endi faqat /ustoz uchun ishlatiladi (redirectIfAuth auth.js'da).
router.get('/ustoz-landing', (req, res) => {
  renderLanding(req, res, 'uz').catch((e) => res.status(500).send(String(e?.message || e)));
});

// ═══════════════════════════════════════════════════════════
// STEP 21 S21.08 — Legal / trust hujjat sahifalari
// (footer va landing trust slot tomonidan havola qilinadi)
// ═══════════════════════════════════════════════════════════
const UPDATED_AT = '2026-08-07';

const INFO_PAGES = {
  '/shartlar': {
    title: 'Foydalanish shartlari — Deborah',
    pageTitle: 'Foydalanish shartlari',
    pageMeta: 'Deborah platformasidan foydalanish qoidalari.',
    sections: [
      { h2: '1. Umumiy qoidalar', body: [
        "Deborah — o'qituvchi va talabalarga mo'ljallangan ta'lim platformasi. Saytdan foydalanish orqali siz ushbu shartlarga rozilik bildirasiz.",
        'Xizmatdan foydalanishda O\'zbekiston Respublikasi qonunchiligiga rioya qilishingiz shart.',
      ] },
      { h2: '2. Hisob va xavfsizlik', body: [
        "Hisobingiz parolini maxfiy saqlang. Hisobingiz ostida amalga oshirilgan barcha harakatlar uchun siz javobgarsiz.",
        "O'qituvchi hisobidan yuborilgan test va sessiyalar tegishli kurs doirasida amal qiladi.",
      ] },
      { h2: '3. Kontent', body: [
        'Platformaga yuklagan test va materiallar uchun javobgarlik sizga tegishli.',
        "Mualliflik huquqlarini buzuvchi yoki noqonuniy kontentni joylash taqiqlanadi.",
      ] },
      { h2: '4. Xizmatdan to\'xtatish', body: [
        'Ushbu shartlarni buzgan holda hisoblar bloklanishi yoki o\'chirilishi mumkin.',
      ] },
      { h2: '5. Aloqa', body: [
        'Savollar va takliflar uchun: https://t.me/deborah',
      ] },
    ],
  },
  '/security': {
    title: 'Xavfsizlik — Deborah',
    pageTitle: 'Xavfsizlik',
    pageMeta: 'Sessiya himoyasi va ruxsatlar nazorati.',
    sections: [
      { h2: '1. Sessiya himoyasi', body: [
        'Har bir sessiya noyob kod va xavfsizlik profillari bilan himoyalanadi.',
      ] },
      { h2: '2. Ruxsatlar', body: [
        "O'qituvchi, talaba, proktor va admin rollari alohida ruxsatlarga ega.",
      ] },
      { h2: '3. Kamera majburiy emas', body: [
        "Cast jonli darslari uchun kamera shart emas. Kamera tasvirlari faqat qat'iy nazorat talab qiladigan imtihonlarda ishlatiladi.",
      ] },
    ],
  },
  '/accessibility': {
    title: 'Qulaylik — Deborah',
    pageTitle: 'Qulaylik (Accessibility)',
    pageMeta: "Interfeysning qulaylik majburiyatlari.",
    sections: [
      { h2: '1. Standartlar', body: [
        "Interfeys WCAG talablariga moslashtiriladi: kontrast, yorliqlash va klaviatura navigatsiyasi.",
      ] },
      { h2: '2. Kam harakat (reduced motion)', body: [
        "Animatsiyalar kamaytirilgan harakat rejimida o'chiriladi.",
      ] },
      { h2: '3. Kamera shartsiz', body: [
        "Cast sessiyalarida kamera talab qilinmaydi — bu qulaylik masalasi.",
      ] },
    ],
  },
};

for (const [path, page] of Object.entries(INFO_PAGES)) {
  router.get(path, (req, res) => {
    res.render('info', { ...page, description: page.pageMeta, pageLang: 'uz', backLabel: 'Bosh sahifa', updatedAt: UPDATED_AT });
  });
}

export default router;
