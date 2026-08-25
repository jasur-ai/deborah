# Edikit UI/UX — FAZA A: AUDIT-FIX (P0/P1 tezkor tuzatishlar)

> **Old shart:** `PROMPT_GUIDE_UIUX_MASTER.md` Global Master Prompt har promptdan oldin yuboriladi.
> **Source:** `research_ui_audit.md` (kod audit — fayl:qator topilmalar), `research_ui_auth_deep.md` (forma ilmi), `research_ui_landing_deep.md` (CTA/hero), `research_ui_tech_deep.md` (INP/CSS).

---

## A-00 — UI preflight va baseline (audit snapshot)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Ishchi katalog `/home/user/edikit`; `git status` va current commit yoz.
03. `research_ui_audit.md` 1-9-bo'limlarini o'qib, haqiqiy holatni tasdiqla (fayl:qator tekshir).
04. Baseline snapshot yarat (kod o'zgartirilmaydi):
   - `grep -rl "Righteous" views/ | wc -l` (kutilgan: 22)
   - `grep -rl "Nunito" views/ | wc -l` (kutilgan: 21)
   - `grep -rn "orbit\|drift\|particle\|pulseAura\|shimmer\|float3d\|gleam\|optShimmer\|confetti" views/ | wc -l`
   - `grep -rn "prefers-reduced-motion" public/ views/ | wc -l` (kutilgan: 0)
   - `grep -rn 'minlength="4"' views/ | wc -l`
   - `grep -rn "Local DB\|Node.js Edition\|demo statistik" views/index.ejs | wc -l`
05. Hozirgi `npm run typecheck` va `npm test` natijalarini yoz (baseline).
06. Har topilmani `implementation-status-uiux.md` ga jadval qilib yoz (topilma → fayl:qator → faza).
07. A-faza kalendar: qaysi prompt qaysi topilmani tuzatadi — yoz.
08. Security/data guard: hech narsa o'zgartirilmaydi; secret log'ga chiqmaydi.
09. Unit test: existing smoke (`npm start` va `/` 200).
10. Integration/contract test: existing auth route smoke.
11. E2E/security test: workspace'da kutilmagan generated file yo'q.
12. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
13. `implementation-status-uiux.md` ga A-00 statusi va next readinessni yoz.
14. Global report formatida qaytar (GREP_CHECKS bilan).
15. Stop condition: baseline ishga tushmasa yoki dirty repo bo'lsa.
16. Done condition: baseline snapshot aniq, barcha grep natijalari yozilgan.
17. Hech qanday kod o'zgartirmasdan yakunla.
18. A-01 uchun: font tizimi — tayyor ekanini dalil bilan yoz.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## A-01 — Font tizimi: Righteous/Nunito o'chirish, professionalga almashtirish

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_audit.md` 1-bo'limini o'qib, barcha `Righteous`/`Nunito` joylarini top (grep).
03. Precondition: A-00 baseline yashil.
04. `public/css/style.css` dagi `--font-display` va `--font-body` qiymatlarini almashtir:
   - `--font-display: 'Manrope', system-ui, sans-serif;` (600-800 og'irliklar)
   - `--font-body: 'Inter', system-ui, -apple-system, sans-serif;` (400-700)
   - (Agar yuklanish ma'qul bo'lsa: Google Fonts'da Manrope+Inter variable font; aks holda system stack — lekin Righteous/Nunito YO'Q)
05. `views/partials/head.ejs` dagi Google Fonts link'ini yangilash: `family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600;700` (display=swap).
06. Har bir view'da `font-family:'Righteous',cursive` ni `var(--font-display)` ga, `'Nunito',sans-serif` ni `var(--font-body)` ga almashtir (grep-list bo'yicha, 22+21 joy).
07. Gradient-matn logo'larni o'chirish: `-webkit-background-clip:text` + `-webkit-text-fill-color:transparent` + `background:linear-gradient(135deg,var(--accent),var(--gold))` — oddiy `color:var(--text-primary)` yoki `var(--accent)` bilan almashtir (panel greeting, nav-logo, teacher ov-stat).
08. Tipografiya qoidalarini qo'llash: sarlavhalar og'irlik 700-800, body 400-500; boshqa font-family ishlatilmasin (grep: faqat var(--font-*) bo'lsin).
09. `public/css/admin.css` va boshqa CSS'da ham almashtir (agar Righteous/Nunito bo'lsa).
10. Security/data guard: font URL'lari https; `preconnect` saqlanadi.
11. Har yangi write path uchun tenant scope, authorization, validation tekshir (UI'da kerak bo'lsa).
12. Unit test: font token'lar mavjud (style.css da --font-display/--font-body).
13. Integration/contract test: head.ejs da yangi font link bor.
14. E2E/security test: sahifa yuklanadi, font no-FOUT (display=swap).
15. GREP-CHECK (majburiy): `grep -rl "Righteous" views/ public/` = 0; `grep -rl "Nunito" views/ public/` = 0; `grep -rn "background-clip:text" views/` = 0.
16. A11y: font contrast/lazim bo'lsa `font-display: swap` (FOIT yo'q).
17. i18n: 4 til glyph (o', g', sh, ў, қ, ғ) Manrope/Inter da mavjud — tekshir (fallback system-ui kirill).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-uiux.md` ga A-01 statusi, grep natijalari yoz.
20. Global report formatida qaytar.
21. Stop condition: `grep Righteous` nol bo'lmasa.
22. Done condition: barcha grep 0, sahifalar professional ko'rinadi (visual tekshiruv).
23. A-02 uchun: landing motion — tayyor.
24. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
25. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
26. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
27. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## A-02 — Landing/index: orbit/drift/particle/pulse/shimmer o'chirish

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/index.ejs` dagi quyidagi keyframes va elementlarni olib tashlash:
   - `@keyframes float3d`, `orbitL`, `orbitS`, `drift`, `pulseAura`, `shimmerBtn`, `badgePulse` (grep-list).
   - `.particle.p1..p6` div'lar (HTML'da 6 ta) — o'chirish.
   - `.orbit-ring.orbit-1/2` div'lar — o'chirish.
   - `revealCard` — o'chirish (A-faza'da), keyin B/C fazada kerak bo'lsa View Transitions bilan qaytariladi.
   - `countUp` animatsiyasi — o'chirish (statistika A-05'da hal qilinadi).
03. `transition: all .45s var(--ease-spring)` — `var(--ease-spring)` ni o'chirish, o'rniga `var(--ease-standard)` yoki oddiy 160ms.
04. Hero'da endi: sokin fon (radial gradient emas — `var(--bg)` oddiy), logo + H1 + sub + CTA. Hech qanday doimiy harakatlanuvchi element.
05. Natijani tekshirish: sahifada infinite animatsiya yo'q (grep `infinite` → 0 index.ejs da).
06. Security/data guard: JS'da scroll listener qo'shilmagan (A-02'da faqat CSS/HTML tozalash).
07. Har yangi write path uchun tenant scope, authorization, validation tekshir.
08. Unit test: index.ejs da keyframes nomlari yo'q (regex test).
09. Integration/contract test: `/` 200, hero strukturasi bor.
10. E2E/security test: sahifa 60fps (compositor — DevTools), CLS o'zgarmagan.
11. GREP-CHECK: `grep -n "orbit\|drift\|particle\|pulseAura\|shimmerBtn\|float3d\|badgePulse\|revealCard\|countUp" views/index.ejs` = 0.
12. A11y: reduced-motion'da ham (hammasi o'chirilgan — default).
13. i18n: matn o'zgarmagan (faqat vizual).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga A-02 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: index.ejs da infinite animatsiya qolsa.
18. Done condition: landing sokin, professional (visual tekshiruv), grep 0.
19. A-03 uchun: reduced-motion — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## A-03 — prefers-reduced-motion global (WCAG 2.2.2)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `public/css/style.css` (yoki head partial) ga GLOBAL qoida qo'shish:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
03. Barcha view'larga tatbiq: style.css global import qilinadi (head.ejs da allaqachon).
04. Agar view'da inline `<style>` da animatsiya bo'lsa — o'sha qoidalar ham global `no-preference` ichida emas, lekin global reduce qoidasi ustun keladi (0.01ms !important).
05. `theme.js` dagi 900ms transition: reduce'da instant (keyingi B-04/05 da to'liq; A'da qoida global qo'shiladi).
06. Keyingi barcha yangi animatsiyalar qoidasi: `@media (prefers-reduced-motion: no-preference) { ... }` ichida.
07. Security/data guard: hech qanday JS logika o'zgarmaydi (faqat CSS).
08. Unit test: style.css da global reduce qoidasi bor (regex test).
09. Integration/contract test: `emulate prefers-reduced-motion` da sahifa yuklanadi, animatsiya yo'q (Playwright emulateMedia).
10. E2E/security test: WCAG 2.2.2 — axe da motion issue 0.
11. GREP-CHECK: `grep -rn "prefers-reduced-motion" public/ views/` ≥ 1 (global).
12. A11y: screen reader, keyboard — o'zgarmagan.
13. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
14. `implementation-status-uiux.md` ga A-03 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: global qoida yo'q bo'lsa.
17. Done condition: reduce'da barcha animatsiya o'chadi (test tasdiqlaydi).
18. A-04 uchun: light mode palitra — tayyor.
```

---

## A-04 — Light mode palitra tuzatish (#C0C4D5 → OKLCH light)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_audit.md` 2-bo'limini o'qib, `public/css/style.css` light blokini aniqlang (202-221 qatorlar atrofida).
03. `[data-theme="light"]` (yoki `.theme-light`) blokidagi neutral ranglarni OKLCH light scale'ga almashtirish (style.md 20.2):
   - `--bg-deep:      oklch(95.95% 0.0080 253.9)`  /* #EEF2F7 */
   - `--bg-primary:   oklch(97.58% 0.0057 264.5)`  /* #F5F7FB — oq-ish, xira EMAS */
   - `--bg-surface:   oklch(96.50% 0.0070 260.0)`  /* oraliq */
   - `--bg-card:      oklch(100% 0 0)`             /* #FFFFFF */
   - `--bg-elevated:  oklch(94.00% 0.0100 260.0)`
   - `--bg-overlay:   oklch(97.58% 0.0057 264.5 / 0.78)`
04. Accent'lar: `--accent: oklch(52.32% 0.2007 262.9)` (#255EDB Edikit Cobalt) va oilasi (accent-dark/deep/glow) — style.md 20.2 light qiymatlari.
05. Har token uchun hex fallback birinchi satr: `--bg-primary: #F5F7FB; --bg-primary: oklch(97.58% 0.0057 264.5);`
06. Light'da oq ustida oq input muammosi: `.inp`, `.search-inp`, `.btn-secondary` kabi `rgba(255,255,255,.04)` fonlar → light'da `rgba(0,0,0,.03)` yoki token (`--bg-surface`).
07. `--gold`/`--purple`/`--cyan` light qiymatlarini ham moslash (style.md 20.2).
08. Light'da kontrastni tekshir: text #1F2937 (L27.81) oq (#FFF) ustida ≥7:1; muted #566176 ≥4.5:1.
09. Dark blok (hozir #080C1A) — keyingi B-03'da to'liq OKLCH; A'da faqat light tuzatiladi (dark'da hech narsa buzilmasin).
10. Security/data guard: hech qanday JS/backend o'zgarmaydi.
11. Unit test: style.css light blokida `oklch(97.58%` mavjud (regex).
12. Integration/contract test: light theme'da sahifalar yuklanadi, input ko'rinadi (Playwright data-theme=light screenshot).
13. E2E/security test: light'da kontrast axe 0 critical; hech qanday "oq ustida oq" element yo'q.
14. GREP-CHECK: `grep -n "#C0C4D5\|#B8BCCF\|#B4B8CB\|#D0D4E3" public/css/style.css` = 0.
15. A11y: light'da WCAG AA barcha sahifa.
16. i18n: o'zgarmagan.
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-uiux.md` ga A-04 statusi yoz.
19. Global report formatida qaytar.
20. Stop condition: eski xira light qiymatlari qolsa.
21. Done condition: light mode oq-ish, professional, kontrast AA.
22. A-05 uchun: landing statistika — tayyor.
```

---

## A-05 — Landing: fake statistika, texnologiya label'lar, typo'lar

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/index.ejs` "Rasmiy / Edikit statistikasi" section'ini o'zgartirish:
   - "demo statistik ko'rsatkichlar" matni — olib tashlash.
   - `15+ Fan yo'nalishlari`, `100+ Savollar`, `5-xim O'yin kodi`, `24/7 Mavjud` — SOXTA raqamlar; tekshiriladigan bo'lmasa butun stat-blokni o'chirish.
   - Agar haqiqiy stat bo'lsa (DB dan): "O'yin kodi: 5 raqamli" (5-xim typo'ni tuzatish).
03. Texnologiya label'larini olib tashlash: `Node.js`, `Socket.io`, `Express`, `Local DB` badge'lar (footer-badge'lar).
04. Footer: `© 2026 Edikit v2.0 — Node.js Edition` → `© 2026 Edikit` (tex stack oshkor emas).
05. "Official Platform v2.0" badge → "JONLI BAHOLASH · RESPONSIVE TEACHING" yoki olib tashlash (B/C fazada credibility bar keladi).
06. `O'yinga kirish` (gamepad) CTA'larini tekshirish: A-06'da CTA qarori; A'da faqat "o'yin" so'zi professionalizmi: Cast'ga ishora bo'lsa "Jonli dars" deb o'zgartirish mumkin.
07. Trust qoidasi: yolg'on da'vo YO'Q (style.md 41.6; digital.gov) — tekshirilmaydigan hamma narsa olib tashlanadi.
08. Security/data guard: hech qanday haqiqiy ma'lumot noto'g'ri ko'rsatilmaydi.
09. Unit test: index.ejs da "demo statistik", "Local DB", "Node.js Edition", "5-xim" yo'q (regex test).
10. Integration/contract test: `/` 200; footer aniq.
11. E2E/security test: sahifa yuklanadi; XSS yo'q (matn esc).
12. GREP-CHECK: `grep -rn "demo statistik\|Local DB\|Node.js Edition\|5-xim\|100+ Savollar\|15+ Fan" views/index.ejs` = 0.
13. i18n: matnlar 4 tilga tayyorlanadi (keyingi H fazada; A'da default uz).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga A-05 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: soxta stat yoki tex label qolsa.
18. Done condition: landing'da faqat haqiqiy/tekshiriladigan ma'lumot.
19. A-06 uchun: H1/CTA — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
27. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
```

---

## A-06 — Landing: H1, CTA, product visual (evidence asosida)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_landing_deep.md` 2-3-bo'limlarini o'qib (hero evidence), `views/index.ejs` hero'ni o'zgartirish:
   - H1: "Interaktiv Platforma" → "Sinf nimani tushunganini shu zahoti ko'ring." (outcome, <10 so'z)
   - Sub: "Edikit o'qituvchiga testni jonli o'tkazish, javoblarni ko'rish va darsni dalil asosida boshqarishga yordam beradi." (30 so'zdan kam)
03. CTA blok:
   - PRIMARY: `[Bepul boshlash]` → `/user/login` (bitta asosiy).
   - SECONDARY: `[Demo Castni ko'rish]` → `/play` (subordinate).
   - `Admin` tugmasi — A-09'da olib tashlanadi (public'da YO'Q).
04. Microcopy CTA ostida: "Ilova o'rnatilmaydi · Reyting o'qituvchi nazoratida" (trust, risk-reducer).
05. Hero visual: hozirgi logo 80px + bo'sh joy o'rniga — REAL product frame placeholder (A'da oddiy: Cast/panel screenshot uchun kontainer; C fazada to'liq demo frame).
   - `.hero-visual` kontainer: aspect-ratio 16/10, border, "Demo" label — haqiqiy screenshot keyin.
06. Hero'da bitta maqsad: login CTA; boshqa nav qo'shilmagan.
07. Security/data guard: `/admin` havolasi public sahifadan yo'q (A-09 bilan).
08. Unit test: index.ejs da yangi H1/CTA matnlari (regex).
09. Integration/contract test: `/` 200; CTA → `/user/login`.
10. E2E/security test: hero'da bitta primary CTA (a.hero-btn-primary soni = 1).
11. GREP-CHECK: `grep -n "Interaktiv Platforma" views/index.ejs` = 0; `grep -n "hero-btn-primary" views/index.ejs` = 1 (faqat bitta).
12. A11y: H1 bitta; heading ketma-ketligi h1→h2; CTA focus.
13. i18n: matnlar uz (C/H fazada 4 til).
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga A-06 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: generic H1 yoki 3 CTA bo'lsa.
18. Done condition: outcome H1 + bitta primary CTA + microcopy + visual kontainer.
19. A-07 uchun: register email — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## A-07 — Register: email maydoni + NIST parol (minlength 4 → 8/15)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_audit.md` 6-bo'limini o'qib (auth topilmalar), `views/user/login.ejs` register form'ini tuzatish:
   - `Foydalanuvchi nomi` dan tashqari **`Email` maydoni qo'shish**: `<label>Email</label> <input name="email" type="email" autocomplete="email" required>` (B-01 schema email majburiy — UI backend'ga ulanadi).
   - Username ixtiyoriy/opsional bo'lishi mumkin (B-04) — lekin email MAJBURIY.
03. Parol: `minlength="4"` → `minlength="8"` (MFA bo'lmasa 15 — A-22 qarori; hozircha 8, backend NIST 15 tekshiradi).
   - Placeholder: "kamida 4 ta belgi" → "Kamida 8 ta belgi".
   - `autocomplete="new-password"` saqlanadi.
   - **Show/hide toggle qo'shish**: parol input yonida eye tugmasi (type password/text almashish, `aria-pressed`).
04. Parol qoidalari pre-submit ko'rsatiladi: "Kamida 8 belgi" (NIST: composition qoidasi yo'q — faqat uzunlik).
05. Register CTA: "Ro'yxatdan o'tish" — aniq.
06. Email validatsiya client (B-05 asosida): `type="email"` + required; xato inline (keyin D fazada to'liq).
07. Trust microcopy: "Ma'lumotlar O'zbekistonda saqlanadi · Hech qachon uchinchi shaxsga berilmaydi" (forma ostida).
08. Security/data guard: backend NIST (15/8) qat'iy — client faqat UX; email duplicate backend tekshiradi (B-09).
09. Unit test: login.ejs da `name="email"` va `minlength="8"` bor (regex).
10. Integration/contract test: register POST email bilan ishlaydi (backend mock).
11. E2E/security test: 4-belgili parol rad etiladi (server); show/hide ishlaydi; XSS yo'q.
12. GREP-CHECK: `grep -rn 'minlength="4"' views/` = 0; `grep -n 'name="email"' views/user/login.ejs` ≥ 1.
13. A11y: label-for, error aria-live, show/hide keyboard.
14. i18n: matnlar uz (keyin 4 til).
15. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
16. `implementation-status-uiux.md` ga A-07 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: email maydoni yo'q yoki minlength<8 bo'lsa.
19. Done condition: register email+parol (NIST), show/hide, trust microcopy.
20. A-08 uchun: forgot password — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
25. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## A-08 — Login: Forgot password havolasi + error state + trust

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/login.ejs` login form'ini tuzatish:
   - Parol field ostiga **"Parolni unutdingizmi?"** havolasi (→ `/user/forgot` yoki mavjud reset route; A-06/A-20 auth'dan; yo'q bo'lsa route tayyorlanadi).
   - Havola: `.link` style, contrast, parol field'ga yaqin (Nielsen visibility).
03. Show/hide parol toggle login'da ham (A-07 dagi pattern — bir xil).
04. Error state: hozir `.msg` bitta blok — to'g'ri; lekin inline field error qo'shish (keyin D-01'da to'liq; A'da: error bo'lsa parol field'ida `aria-invalid` + xato matni field yonida).
05. "Foydalanuvchi nomi" label → "Email yoki login" (register endi email; login ham email qabul qilsin — backend tekshir).
   - `name="username"` o'rniga `name="identifier"` yoki backend'ga mos — lekin autocomplete: `autocomplete="username"` saqlanadi (email ham).
06. Trust microcopy login'da: "Ma'lumotlar O'zbekistonda saqlanadi" + Xavfsizlik havolasi (keyin).
07. Google button — saqlanadi; Telegram (B-22) keyin D fazada.
08. Enumeration qoidasi: xato matni bir xil ("Email yoki parol noto'g'ri") — backend qarori; UI'da yoziladi.
09. Security/data guard: forgot route mavjud (A-06 auth'dan); yo'q bo'lsa `routes/auth.js` da `/user/forgot` GET (UI uchun) qo'shiladi — backend ishi auth faza.
10. Unit test: login.ejs da "Parolni unutdingizmi?" havolasi bor (regex).
11. Integration/contract test: forgot sahifa 200.
12. E2E/security test: forgot link ishlaydi; show/hide; XSS yo'q.
13. GREP-CHECK: `grep -n "Parolni unutdingizmi" views/user/login.ejs` ≥ 1.
14. A11y: havola fokus, aria-invalid error'da.
15. i18n: matnlar uz.
16. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
17. `implementation-status-uiux.md` ga A-08 statusi yoz.
18. Global report formatida qaytar.
19. Stop condition: forgot havolasi yo'q bo'lsa.
20. Done condition: login'da forgot + show/hide + inline error + trust.
21. A-09 uchun: admin link — tayyor.
22. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
23. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
24. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
25. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
26. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
27. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## A-09 — Admin havolasini public sahifalardan olib tashlash + footer

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_audit.md` 5.1 bo'limidagi topilmalar bo'yicha:
   - `views/index.ejs`: hero CTA'dagi `Admin` tugmasi (hero-btn-secondary) — olib tashlash.
   - Footer'dagi `Admin panel` linki — olib tashlash.
   - `views/user/login.ejs` footer'dagi `Admin panel` linki — olib tashlash.
03. Admin'ga kirish faqat: `/admin/login` bevosita URL (public index'da ro'yxat emas) yoki o'qituvchi/admin rolida.
04. Footer (index.ejs) endi:
   - `© 2026 Edikit`
   - Havolalar: `Kirish` (`/user/login`), `Privacy`, `Terms` (sahifalar keyin D/H; havola placeholder bo'lsa ham).
   - Hech qanday admin/gamepad oshkor emas.
05. "O'yinga kirish" (gamepad) → "Jonli dars" yoki `/play` sarlavhasi professional: "Sessiya kodi bilan kirish" (participant uchun, style.md 41.1).
06. Security/data guard: public sahifada admin auth yo'li ko'rinmasligi (xavfsizlik) — qoida 23.
07. Unit test: index.ejs va login.ejs da `Admin` havolasi yo'q (regex).
08. Integration/contract test: `/` va `/user/login` 200; `/admin/login` mavjud (bevosita).
09. E2E/security test: public sahifada admin link yo'q; `/admin/login` 200.
10. GREP-CHECK: `grep -rn 'admin/login' views/index.ejs views/user/login.ejs` = 0 (footer/hero), `grep -rn 'Admin panel' views/` = 0.
11. A11y: footer linklar aniq label.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
14. `implementation-status-uiux.md` ga A-09 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: public'da admin link qolsa.
17. Done condition: admin faqat bevosita URL; footer official.
18. A-10 uchun: performance — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## A-10 — Performance: socket.io/main.js faqat kerakli sahifalarda

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_tech_deep.md` 2.3 (INP) va `research_ui_audit.md` 8-bo'limi asosida:
   - `views/partials/head.ejs` dagi `<script src="https://cdn.socket.io/4.7.5/socket.io.min.js">` — faqat socket kerak bo'lgan sahifalarga ko'chirish (play, cast, game/*, role/*).
   - `public/js/main.js` — faqat kerakli sahifalarda yoki kritik qismlari head'da; landing'da ikkalasi ham yuklanmasin.
03. Usul: head.ejs'da socket.io/main.js ni olib tashlash; kerakli view'larda (game/enter, game/host, role/*) `<script src="/js/socket-needed">` yoki `<script src="https://cdn.socket.io...">` qo'shish.
04. Yuqori darajadagi taxmin: landing'da JS <50kB (A-06 CTA dan tashqari JS kam).
05. Third-party: Turnstile/analytics bo'lsa — `defer`/`async`; `requestIdleCallback`'da yuklash (agar mavjud).
06. `content-visibility: auto` — uzun landing section'lariga qo'shish (CWV CLS/INP yaxshilanadi).
07. `@font-face`/Google Fonts: `display=swap` saqlanadi; preconnect bor.
08. Security/data guard: socket token/secret frontend'ga yuborilmaydi; mavjud auth buzilmaydi.
09. Unit test: head.ejs da socket.io CDN yo'q (regex).
10. Integration/contract test: landing'da socket script yo'q; `/play` da bor.
11. E2E/security test: landing INP/LCP yaxshilangan (o'lchov: PageSpeed/Lighthouse).
12. GREP-CHECK: `grep -n "cdn.socket.io" views/partials/head.ejs` = 0; `grep -rln "cdn.socket.io" views/` = faqat kerakli view'lar.
13. A11y: o'zgarmagan.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga A-10 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: landing'da socket.io yoki main.js yuklansa.
18. Done condition: sahifa-selectiv JS, landing yengil, INP target.
19. A-11 (checkpoint) uchun: tayyor ekanini dalil bilan yoz.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
27. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
28. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
```

---

## A-11 — AUDIT-FIX checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_audit.md` 10-bo'limidagi QABUL MEZONLARI (grep testlari) — barchasini bajar:
   - `grep -r "Righteous\|Nunito" views/ public/` = 0
   - `grep -r "orbit\|drift\|particle\|pulseAura\|shimmerBtn\|float3d\|optShimmer\|optSweep\|gleam\|confetti" views/` = 0
   - `grep -r "prefers-reduced-motion" public/ views/` ≥ 1
   - `grep -rn 'minlength="4"' views/` = 0
   - `grep -n 'name="email"' views/user/login.ejs` ≥ 1
   - `grep -n "Parolni unutdingizmi" views/user/login.ejs` ≥ 1
   - `grep -n "#C0C4D5" public/css/style.css` = 0
   - `grep -rn "demo statistik\|Local DB\|Node.js Edition\|5-xim" views/` = 0
   - `grep -rn "Admin panel\|admin/login" views/index.ejs views/user/login.ejs` = 0
   - `grep -n "cdn.socket.io" views/partials/head.ejs` = 0
03. Full regression: `npm run typecheck` + `npm test` — natijalar yoz.
04. A11y spot-check: axe 0 critical (login, landing, panel); keyboard login flow.
05. Visual tekshiruv: light + dark'da landing/login professional (screenshot review).
06. A-faza checklist: A-00..A-10 hammasi DONE bo'lishi kerak (ledger).
07. Sign-off: operator checklist imzolaydi (A-faza yopiladi).
08. Security/data guard: critical yashirilmaydi; qolgan P2 (theme engine, landing to'liq) B/C ga.
09. Har yangi write path uchun tenant scope, authorization, validation tekshir.
10. Unit test: full A (yangi testlar).
11. Integration/contract test: journey login→register.
12. E2E/security test: full A E2E.
13. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
14. `implementation-status-uiux.md` ga A-11 (CHECKPOINT) statusi, dalillar, sign-off yoz.
15. Global report formatida qaytar.
16. Stop condition: birorta grep fail yoki critical qolsa.
17. Done condition: A-faza checklist to'liq, sign-off imzolangan.
18. Qolgan P2 ro'yxati (theme engine, landing, panel, cast) — B-G fazalarga ko'chirilganini yoz.
19. Butun FAZA A yakunlandi — B-00 preflight'ga tayyor.
```

