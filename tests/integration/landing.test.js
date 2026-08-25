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

describe('Landing — HTTP routing (DEMO 1:1 — tasdiqlangan demo versiyasi)', () => {
  it('GET / (uz) — demo H1, hero 2 CTA, bitta H1', async () => {
    const res = await fetch(`${serverUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("O'qituvchi ishi — <em>yengil</em>");
    expect(html).toContain('Bepul boshlash');
    expect(html).toContain('Imkoniyatlar');
    // Bitta H1
    const h1s = html.match(/<h1[\s>]/g) || [];
    expect(h1s).toHaveLength(1);
    // Demo belgilari: ghost fon + live screen
    expect(html).toContain('class="ghost"');
    expect(html).toContain('EDK-4821');
  });

  it('DEMO — ortiqcha "reklama" bo\u2018limlari YO\u2018Q (roles/demo/trust/stats/how)', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).not.toContain('ld-roles');
    expect(html).not.toContain('ld-demo');
    expect(html).not.toContain('ld-trust');
    expect(html).not.toContain('ld-how');
    expect(html).not.toContain('data-demo-open');
    // Demo tartibi: feat → qadam → signal → auth → cred → cta
    const feat = html.indexOf('id="feat"');
    const qadam = html.indexOf('id="qadam"');
    const signal = html.indexOf('id="signal"');
    const auth = html.indexOf('id="auth"');
    expect(feat).toBeGreaterThan(-1);
    expect(qadam).toBeGreaterThan(feat);
    expect(signal).toBeGreaterThan(qadam);
    expect(auth).toBeGreaterThan(signal);
    // Cred strip (demo'dagi kabi)
    expect(html).toContain('HEMIS / OneID');
    expect(html).toContain('WCAG 2.2 AA');
    // Soxta claim yo'q
    expect(html).not.toContain('24/7');
    expect(html).not.toContain('Rasmiy platforma');
  });

  it('DEMO — footer: Sahifalar/Hujjatlar/Aloqa/Til + /cast havolasi', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('href="/cast"');
    expect(html).toContain('Maxfiylik siyosati');
    expect(html).toContain('hello@deborah.uz');
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

  it('GET /ru, /en, /uz-cyrl — demo strukturasi bilan 200 (client-side i18n)', async () => {
    for (const p of ['/ru', '/en', '/uz-cyrl']) {
      const res = await fetch(`${serverUrl}${p}`);
      expect(res.status, `${p} 200 bo'lishi kerak`).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="feat"');
      expect(html).toContain('id="auth"');
    }
  });

  it('DEMO — lang guruh (UZ/RU/EN) headerda mavjud', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toMatch(/class="lang"/);
    expect(html).toContain('data-lang="uz"');
    expect(html).toContain('data-lang="ru"');
    expect(html).toContain('data-lang="en"');
  });

  it("DEMO — auth bloki landingda: REAL formalar /user/login'ga POST qiladi", async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    // Kirish formasi — real POST
    expect(html).toMatch(/<form id="fLogin" method="POST" action="\/user\/login"/);
    expect(html).toContain('name="_csrf"');
    // Register (o'qituvchi arizasi) — mode=reg
    expect(html).toContain('name="mode" value="reg"');
    expect(html).toContain('name="role" value="teacher"');
    expect(html).toContain('name="consent"');
    // Demo hint olib tashlangan
    expect(html).not.toContain('user1@gmail.com');
    expect(html).not.toContain('parol 1234');
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
  it('DEMO head — socket.io/xlsx/main.js YO\'Q, faqat landing.css (fontlar ichida)', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).not.toContain('socket.io/socket.io.js');
    expect(html).not.toContain('/xlsx');
    expect(html).not.toContain('/js/main.js');
    expect(html).toContain('href="/css/landing.css"');
  });

  it('DEMO head — canonical + OG mavjud', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toMatch(/rel="canonical" href="[^"]+"/);
    expect(html).toMatch(/property="og:title"/);
  });

  it('STEP 23 S23.08 — service worker v2.x mavjud va serv qilinadi', async () => {
    const res = await fetch(`${serverUrl}/service-worker.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/CACHE_VERSION\s*=\s*'v2\./);
  });

  it('DEMO — tema tugmasi (light/dark) va statik live-screen (no-JS)', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('id="themeBtn"');
    expect(html).toContain('class="screen reveal"');
    // Live screen statik kontenti server HTML'da (JS'siz ko'rinadi)
    expect(html).toContain('SELECT DISTINCT');
    const css = await (await fetch(`${serverUrl}/css/landing.css`)).text();
    expect(css).toContain('[data-theme');
  });

  it('DEMO — landing.js: i18n (uz/ru/en) + tema + real formalar mantiqi', async () => {
    const js = await (await fetch(`${serverUrl}/js/landing.js`)).text();
    expect(js).toContain('I18N');
    expect(js).toContain('applyLang');
    expect(js).toContain('applyTheme');
    expect(js).toContain('deriveUsername');
    expect(js).toContain("fLogin");
    expect(js).toContain("fReg");
  });
});
