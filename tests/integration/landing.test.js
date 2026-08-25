import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotDb, restoreDb, startServer, stopServer } from '../helpers/setup.js';

let serverUrl;

beforeAll(async () => {
  snapshotDb();
  serverUrl = await startServer();
});

afterAll(async () => {
  await stopServer();
  restoreDb();
});

describe('Landing — copy bank (data/landing.js)', () => {
  it('4 til mavjud va barcha section stringlari bor', async () => {
    const { LANDING_LANGS, LANDING_COPY } = await import('../../data/landing.js');
    expect(LANDING_LANGS).toHaveLength(4);
    for (const lang of LANDING_LANGS) {
      const c = LANDING_COPY[lang];
      expect(c.meta.title).toBeTruthy();
      expect(c.hero.h1).toBeTruthy();
      expect(c.hero.participantCta).toBeTruthy();
      expect(c.roles.teacherCta).toBeTruthy();
      expect(c.features.cards.length).toBe(6);
      expect(c.how.teacherSteps.length).toBe(3);
      expect(c.trust.items.length).toBe(4);
      expect(c.cta.button).toBeTruthy();
      expect(c.cta.proof).toBeUndefined();
    }
  });

  it('resolveLandingLang — noma\'lum til default uz', async () => {
    const { resolveLandingLang } = await import('../../data/landing.js');
    expect(resolveLandingLang('en')).toBe('en');
    expect(resolveLandingLang('ru')).toBe('ru');
    expect(resolveLandingLang('uz-cyrl')).toBe('uz-cyrl');
    expect(resolveLandingLang('fr')).toBe('uz');
    expect(resolveLandingLang(undefined)).toBe('uz');
  });

  it('STEP 21 S21.07 — fake trust claim lar copy da YO\'Q (24/7, rasmiy, soxta statistika)', async () => {
    const { LANDING_LANGS, LANDING_COPY } = await import('../../data/landing.js');
    const banned = ['24/7', 'Official platform', 'Rasmiy platforma', 'Официальная платформа', 'Расмий платформа', '10,000+', '10 000+', '100,000+', '100 000+', 'Universities trust us'];
    for (const lang of LANDING_LANGS) {
      const raw = JSON.stringify(LANDING_COPY[lang]);
      for (const b of banned) {
        expect(raw, `${lang}: "${b}" topildi`).not.toContain(b);
      }
    }
  });

  it('STEP 21 S21.08 — trust item lar 4 tadan, hammasi internal doc link', async () => {
    const { LANDING_LANGS, LANDING_COPY } = await import('../../data/landing.js');
    const docRoutes = ['/privacy', '/security', '/accessibility'];
    for (const lang of LANDING_LANGS) {
      const items = LANDING_COPY[lang].trust.items;
      expect(items).toHaveLength(4);
      for (const t of items) {
        expect(t.icon).toBeTruthy();
        expect(t.title).toBeTruthy();
        expect(t.desc).toBeTruthy();
        expect(t.link.startsWith('/')).toBe(true);
        expect(docRoutes.some((r) => t.link === r || t.link.startsWith(r))).toBe(true);
      }
      // 24/7 xavfli so'zlar features'da ham yo'q
      expect(JSON.stringify(LANDING_COPY[lang].features.cards)).not.toContain('24/7');
    }
  });

  it('copy da XSS xavfli kalitlar yo\'q (email/source)', async () => {
    const { LANDING_LANGS, LANDING_COPY } = await import('../../data/landing.js');
    for (const lang of LANDING_LANGS) {
      const raw = JSON.stringify(LANDING_COPY[lang]);
      expect(raw).not.toContain('javascript:');
      expect(raw).not.toContain('<script');
    }
  });
});

describe('Landing — HTTP routing', () => {
  it('GET / (uz) — yangi promise-led H1 va bitta main CTA', async () => {
    const res = await fetch(`${serverUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sinf nimani tushunganini');
    expect(html).toContain('ld-hero-h1');
    expect(html).toContain('data-demo-open');
    // Bitta H1 (S21.11)
    const h1s = html.match(/<h1[\s>]/g) || [];
    expect(h1s).toHaveLength(1);
    // Ikkala rol kartasi
    expect(html).toContain('O&#39;qituvchi sifatida boshlash');
    expect(html).toContain('Talaba sifatida boshlash');
  });

  it('STEP 21 S21.04 — participant shortcut /play va trust slot mavjud', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('href="/play"');
    expect(html).toContain('ld-trust-item');
    expect(html).toContain('ld-hero-participant');
    // S21.07: eski soxta claim lar HTML da yo'q
    expect(html).not.toContain('24/7');
    expect(html).not.toContain('Rasmiy platforma');
    // AUTH A-13: ld-stats endi SOXTA emas — haqiqiy ochiq ma'lumotlar
    // (manba + litsenziya bilan). Yolg'on raqam yo'q: musbat son ko'rsatilishi kerak.
    expect(html).toMatch(/data-stat="universities">\d+</);
    expect(html).toContain('data.gov.uz');
  });

  it('STEP 21 S21.06 — admin link footer utility\'da', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('href="/admin/login"');
  });

  it('STEP 21 S21.08/09 — doc sahifalar 200 qaytaradi', async () => {
    for (const p of ['/shartlar', '/security', '/accessibility']) {
      const res = await fetch(`${serverUrl}${p}`);
      expect(res.status, `${p} 200 bo\\'lishi kerak`).toBe(200);
      const html = await res.text();
      expect(html).toContain('info-h1');
    }
  });

  it('AUTH D-24 — /privacy yangi legal sahifa (4 til) 200', async () => {
    const res = await fetch(`${serverUrl}/privacy?lang=uz`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Maxfiylik siyosati');
    expect(html).toContain('legal-box');
  });

  it('GET /ru, /en, /uz-cyrl — tegishli tilda yangi H1', async () => {
    const en = await (await fetch(`${serverUrl}/en`)).text();
    expect(en).toContain('See what your class understands');
    const ru = await (await fetch(`${serverUrl}/ru`)).text();
    expect(ru).toContain('Узнайте, что понял класс');
    const cyrl = await (await fetch(`${serverUrl}/uz-cyrl`)).text();
    expect(cyrl).toContain('Синф нимани тушунганини шу заҳоти');
  });

  it('lang switcher hreflang mavjud', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    for (const lang of ['uz', 'ru', 'en', 'uz-cyrl']) {
      expect(html).toContain(`hreflang="${lang === 'uz-cyrl' ? 'uz-Cyrl' : lang}"`);
    }
  });

  it("rol CTA'lar login sahifasiga yo'naltiradi (Kirish → /user/login, refresh yo'q)", async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    // S34: ?role=student/teacher eski CTA landing'ni qayta yuklab (refresh) berardi —
    // endi Kirish real login sahifasiga boradi (o'qituvchi → mode=reg register oqimi).
    expect(html).not.toContain('?role=student');
    expect(html).not.toContain('?role=teacher');
    expect(html).toContain('/user/login');
    expect(html).toContain('/user/login?mode=reg');
  });

  it('open-redirect yo\'q — CTA linklari internal', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    const hrefs = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const ctaHrefs = hrefs.filter((h) => h.startsWith('http') || h.startsWith('//'));
    // Faqat ruxsat etilgan tashqi manzillar: Telegram + Google Fonts (CDN) +
    // AUTH A-13 ochiq ma'lumotlar manbasi (data.gov.uz — rasmiy, allowlist'da)
    const allowed = ['https://t.me/', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://data.gov.uz'];
    for (const h of ctaHrefs) {
      expect(allowed.some((a) => h.startsWith(a))).toBe(true);
    }
  });

  it('landing.css va landing.js assetlar mavjud (200)', async () => {
    const css = await fetch(`${serverUrl}/css/landing.css`);
    expect(css.status).toBe(200);
    const js = await fetch(`${serverUrl}/js/landing.js`);
    expect(js.status).toBe(200);
  });

  it('404 bilmagan til yo\'li uchun — boshqa route emas', async () => {
    const res = await fetch(`${serverUrl}/ru/imkoniyatlar`);
    const html = await res.text();
    expect(html).not.toContain('ld-hero-h1');
  });

  it('app route lar buzilmagan — /login hali login sahifasi', async () => {
    const res = await fetch(`${serverUrl}/user/login`, { redirect: 'manual' });
    expect(res.status).toBeLessThan(400);
    const html = await res.text();
    expect(html).not.toContain('ld-hero-h1');
    expect(html).toMatch(/name="password"/);
  });

  it('description fallback — head.ejs landing bo\'lmagan sahifada undefined emas', async () => {
    const html = await (await fetch(`${serverUrl}/user/login`)).text();
    expect(html).not.toContain('content="undefined"');
  });
  it('STEP 23 S23.04/05 — landing head: socket.io/xlsx/main.js YO\'Q, self-hosted font preload', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).not.toContain('socket.io/socket.io.js');
    expect(html).not.toContain('/xlsx');
    expect(html).not.toContain('/js/main.js');
    expect(html).toMatch(/rel="preload" href="\/fonts\//);
    expect(html).toMatch(/\/fonts\/source-sans-3/);
  });

  it('STEP 23 S23.06 — canonical + OG poster + JSON-LD mavjud', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toMatch(/rel="canonical" href="[^"]+"/);
    expect(html).toMatch(/property="og:image" content="[^"]+poster\.webp"/);
    expect(html).toContain('application/ld+json');
    expect(html).toContain('WebApplication');
    expect(html).toContain('EducationalApplication');
  });

  it('STEP 23 S23.08 — service worker v2.x mavjud va serv qilinadi', async () => {
    const res = await fetch(`${serverUrl}/service-worker.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/CACHE_VERSION\s*=\s*'v2\./);
  });

  it('STEP 23 S23.10 — light theme token va no-JS statik stage', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('ld-stage');
    const css = await (await fetch(`${serverUrl}/css/landing.css`)).text();
    expect(css).toContain("[data-theme='light']");
    expect(css).toMatch(/\[data-theme='light'\]/);
  });

  it('STEP 23 S23.11 — landing.js first-click analytics (privacy-safe)', async () => {
    const js = await (await fetch(`${serverUrl}/js/landing.js`)).text();
    expect(js).toContain('data-analytics');
    expect(js).toContain('firstClick');
  });
});
