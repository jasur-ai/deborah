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

describe('Landing — HTTP routing (CAST demo 1:1 — tasdiqlangan cast.html port)', () => {
  it('GET / (uz) — S33 namuna: hero H1 (bitta) + jonli cast ekrani', async () => {
    const res = await fetch(`${serverUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Namuna (uploads/index.html) hero nusxasi
    expect(html).toContain('O\'qituvchi ishi — <em>yengil</em>.<br>Dars — samarali.');
    expect(html).toContain("O'qituvchilar uchun · AI yordamchi bilan");
    expect(html).toContain('Bepul boshlash');
    // Bitta H1
    const h1s = html.match(/<h1[\s>]/g) || [];
    expect(h1s).toHaveLength(1);
    // Jonli cast ekrani (hero ichida)
    expect(html).toContain('EDK-4821');
    expect(html).toContain('Response mosaic · 42 javob');
    expect(html).toContain('SELECT DISTINCT');
  });

  it('S33 — tartib: hero → stats → feat → qadam → signal → auth → cred → cta', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    const pos = (needle) => html.indexOf(needle);
    expect(pos('id="top"')).toBeGreaterThan(-1);
    expect(pos('class="stats"')).toBeGreaterThan(pos('id="top"'));
    expect(pos('id="feat"')).toBeGreaterThan(pos('class="stats"'));
    expect(pos('id="qadam"')).toBeGreaterThan(pos('id="feat"'));
    expect(pos('id="signal"')).toBeGreaterThan(pos('id="qadam"'));
    expect(pos('id="auth"')).toBeGreaterThan(pos('id="signal"'));
    expect(pos('class="cred-in"')).toBeGreaterThan(pos('id="auth"'));
    expect(pos('class="cta-stamp')).toBeGreaterThan(pos('class="cred-in"'));
    // hero ichida jonli cast ekrani
    expect(pos('id="cast"')).toBeGreaterThan(pos('id="top"'));
    expect(pos('id="cast"')).toBeLessThan(pos('class="stats"'));
    // 9 ta imkoniyat kartasi
    expect((html.match(/class="f-card reveal"/g) || []).length).toBe(9);
    // Join overlay: 5–7 xonali kod (maxlength 7)
    expect(html).toContain('id="joinOverlay"');
    expect(html).toMatch(/id="jcode"[^>]*maxlength="7"/);
    // Eski demo bo'limlari YO'Q
    for (const gone of ['ld-roles', 'ld-demo', 'ld-trust', 'ld-how', 'data-theme-state-btn']) {
      expect(html).not.toContain(gone);
    }
  });

  it('CAST — footer: Sahifalar/Hujjatlar/Aloqa + deborah.uz + ©2026', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toContain('Sahifalar');
    expect(html).toContain('Hujjatlar');
    expect(html).toContain('Aloqa');
    expect(html).toContain('deborah.uz');
    expect(html).toContain('© 2026');
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

  it('CAST — /ru, /en, /uz-cyrl 200 (client-side i18n, bir xil struktura)', async () => {
    for (const p of ['/ru', '/en', '/uz-cyrl']) {
      const res = await fetch(`${serverUrl}${p}`);
      expect(res.status, `${p} 200 bo'lishi kerak`).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="cast"');
      expect(html).toContain('id="auth"');
    }
  });

  it('CAST — lang guruhi (UZ/RU/EN) headerda', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).toMatch(/class="lang"/);
    expect(html).toContain('data-lang="uz"');
    expect(html).toContain('data-lang="ru"');
    expect(html).toContain('data-lang="en"');
  });

  it("CAST — auth bloki: REAL formalar /user/login'ga POST (login + reg)", async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    // Kirish formasi — real POST, email username sifatida
    expect(html).toMatch(/<form id="fLogin" action="\/user\/login" method="POST"/);
    expect(html).toContain('name="_csrf"');
    // Register — mode=reg, consent, username email'dan (server normalize qiladi)
    expect(html).toMatch(/<form id="fReg" action="\/user\/login"[^>]*>/);
    expect(html).toContain('name="mode" value="reg"');
    expect(html).toContain('name="consent" value="on"');
    expect(html).toContain('id="rUser"');
    // Providerlar — REAL endpointlar (JS __AUTH_PROVIDERS bilan guard)
    expect(html).toContain('data-prov="google"');
    expect(html).not.toContain('data-prov="oneid"'); // OneID 2026-08-27'da butunlay olib tashlandi
    expect(html).toMatch(/__AUTH_PROVIDERS\s*=\s*\{/);
    // Demo hint olib tashlangan
    expect(html).not.toContain('user1@gmail.com');
    expect(html).not.toContain('parol 1234');
  });

  it('open-redirect yo\'q — CTA linklari internal', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    const hrefs = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const ctaHrefs = hrefs.filter((h) => h.startsWith('http') || h.startsWith('//'));
    const allowed = ['https://t.me/', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://data.gov.uz'];
    for (const h of ctaHrefs) {
      expect(allowed.some((a) => h.startsWith(a))).toBe(true);
    }
  });

  it('landing.css / landing.js / font assetlar mavjud (200)', async () => {
    const css = await fetch(`${serverUrl}/css/landing.css`);
    expect(css.status).toBe(200);
    const js = await fetch(`${serverUrl}/js/landing.js`);
    expect(js.status).toBe(200);
    const font = await fetch(`${serverUrl}/fonts/landing-demo-1.woff2`);
    expect(font.status).toBe(200);
  });

  it("404 bilmayan til yo'li uchun — boshqa route emas", async () => {
    const res = await fetch(`${serverUrl}/ru/imkoniyatlar`);
    const html = await res.text();
    expect(html).not.toContain('ld-hero-h1');
  });

  it('app route lar buzilmagan — /user/login hali login sahifasi', async () => {
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

  it('CAST head — socket.io/xlsx/main.js YO\'Q, faqat landing.css', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    expect(html).not.toContain('socket.io/socket.io.js');
    expect(html).not.toContain('/xlsx');
    expect(html).not.toContain('/js/main.js');
    expect(html).toContain('href="/css/landing.css"');
    // Font landing.css @font-face'ida (HTML'da emas)
    const css = await (await fetch(`${serverUrl}/css/landing.css`)).text();
    expect(css).toContain('/fonts/landing-demo-1.woff2');
  });

  it('CAST head — canonical + OG mavjud', async () => {
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

  it('CAST — tema tugmasi (#themeBtn toggle) + statik cast screen (no-JS)', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    // Demo 1:1: header'dagi klassik oy/quyosh tugmasi (segmented EMAS)
    expect(html).toContain('class="tbtn" id="themeBtn"');
    expect(html).not.toContain('data-theme-state-btn');
    expect(html).toContain('class="screen reveal"'); // S33: hero ichida, reveal animatsiya bilan
    // Cast screen statik kontenti server HTML'da (JS'siz ko'rinadi)
    expect(html).toContain('SELECT DISTINCT');
    expect(html).toContain('data-opt');
    const css = await (await fetch(`${serverUrl}/css/landing.css`)).text();
    expect(css).toContain('[data-theme');
  });

  it('LANDING AUTH — username-check: mavjud/reserved/invalid/bo‘sh (real-time)', async () => {
    const free = await (await fetch(`${serverUrl}/user/login/username-check?username=yangiuser${Date.now() % 100000}`)).json();
    expect(free.ok).toBe(true);
    expect(free.reason).toBeNull();
    const resv = await (await fetch(`${serverUrl}/user/login/username-check?username=root`)).json();
    expect(resv.ok).toBe(false);
    expect(resv.reason).toBe('reserved');
    const bad = await (await fetch(`${serverUrl}/user/login/username-check?username=a%40b`)).json();
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('invalid');
  });

  it('LANDING AUTH — X-Landing JSON rejimi: xato inline (2-panelga tashlamaydi)', async () => {
    const page = await fetch(`${serverUrl}/`);
    const html = await page.text();
    const csrf = (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
    const cookie = page.headers.get('set-cookie')?.split(';')[0] || '';
    const res = await fetch(`${serverUrl}/user/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Landing': '1', cookie },
      body: new URLSearchParams({
        _csrf: csrf, mode: 'reg', consent: 'on', lang: 'uz',
        username: `json${Date.now() % 100000}`, email: `json${Date.now() % 100000}@test.uz`,
        name: 'Json User', password: 'faqatharflar',
      }).toString(),
    });
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(String(j.error)).toContain('harf va bitta raqam');
    expect(j.form).toBe('register');
  });

  it('LANDING AUTH — reg formada KO\'RINADIGAN username maydoni + hint + loginId', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    // username endi visible input (hidden emas) — live tekshiruv bilan
    expect(html).toMatch(/<input id="rUser" name="username" type="text"/);
    expect(html).toContain('id="rUserHint"');
    expect(html).toContain('data-i18n="auth.passHint"');
    // login email YOKI username
    expect(html).toContain('data-i18n="auth.loginId"');
  });

  it('LANDING HEADER — o\'ng menyu: Kirish + Admin FAQAT ichida (S31/S33 user namunasi)', async () => {
    const html = await (await fetch(`${serverUrl}/`)).text();
    const m = html.match(/<div class="hmenu"[^>]*>[\s\S]*?<\/div>/) || [''];
    // Admin menyu ICHIDA (BUG-028: alohida page), tashqarida ko'rinmaydi
    expect(m[0]).toContain('href="/admin/login"');
    expect(html).not.toContain('id="adminBtn"'); // S31: tashqi Admin tugmasi o'ldi
    // Kirish — /ustoz (niqob) menyu ichida
    expect(m[0]).toContain('href="/ustoz"');
    // S33 (namuna): oltin Kirish ctrls ichida (lang + temadan KEYIN) → #auth kartaga
    const ctrls = html.match(/<div class="ctrls">[\s\S]*?<\/header>/) || [''];
    expect(ctrls[0]).toContain('class="kbtn" href="#auth"');
    expect(ctrls[0].indexOf('id="themeBtn"')).toBeLessThan(ctrls[0].indexOf('class="kbtn"'));
    expect(ctrls[0]).toContain('data-lang="ru"'); // UZ/RU/EN
    // ⋮ menyu tugmasi ham ctrls ichida (chap burger yo'q)
    expect(ctrls[0]).toContain('id="hbtn"');
    expect(html.indexOf('class="logo"')).toBeLessThan(html.indexOf('id="hbtn"'));
    // footer kontakt anchor (demo #kontakt)
    expect(html).toContain('<footer class="ftr" id="kontakt">');
  });

  it('CAST — landing.js: i18n (uz/ru/en) + tema + real provider/join/admin mantiqi', async () => {
    const js = await (await fetch(`${serverUrl}/js/landing.js`)).text();
    expect(js).toContain('I18N');
    expect(js).toContain('applyLang');
    expect(js).toContain('applyTheme');
    // Real ulanishlar
    expect(js).toContain("'/play?code='");
    expect(js).toContain("'/auth/google'");
    expect(js).not.toContain("'/auth/hemis'"); // HEMIS 2026-08-27'da butunlay olib tashlandi
    expect(js).not.toContain('adminOverlay'); // BUG-028/042: admin modal olib tashlandi — alohida page
    expect(js).toContain('__AUTH_PROVIDERS');
    // Provider-off xabarlari (3 til)
    expect(js).toContain('prov.g.off');
    expect(js).not.toContain('prov.o.off'); // OneID xabarlari olib tashlandi
  });
});
