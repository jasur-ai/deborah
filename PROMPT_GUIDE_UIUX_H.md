# Edikit UI/UX — FAZA H: ADMIN + QA (admin UI, i18n, a11y audit, perf, final regression)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_teacher_deep.md` (admin pattern), `research_ui_auth_deep.md` (admin auth), `research_ui_style_deep.md` (i18n 4 til, microcopy), `research_ui_tech_deep.md` (perf budget, DTCG), `research_ui_top_sites_deep.md` (ethical UX, a11y 95.9% fail).

---

## H-00 — Admin/QA preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_teacher_deep.md` + `research_ui_auth_deep.md` 6-bo'limini o'qib, reja:
   Admin UI (dashboard/users/audit), i18n 4 til (uz-Latn/Cyrl/ru/en), a11y audit (axe), perf budget, final regression.
03. Precondition: G-08 (Cast) yashil.
04. Hozirgi view'lar: `views/admin/*` (dashboard, users, teachers, audit, camera-review) — inventarizatsiya; `views/role/marker.ejs`, `proctor.ejs`.
05. H-faza — yakuniy: barcha oldingi fazalar (A-G) to'g'rilanishi tekshiriladi; i18n to'liq; a11y/perf hujjatda.
06. Baseline: `npm run typecheck` + `npm test`.
07. Security/data guard: hech narsa o'zgartirilmaydi (reja).
08. Unit test: existing smoke.
09. Integration/contract test: existing.
10. E2E/security test: workspace toza.
11. Mavjud testlarni ham ishlat.
12. `implementation-status-uiux.md` ga H-00 statusi yoz.
13. Global report formatida qaytar.
14. Stop condition: reja tasdiqlanmasa.
15. Done condition: reja aniq, H-01 ready.
16. H-01 uchun: admin UI — tayyor ekanini dalil bilan yoz.
17. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
18. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
19. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
20. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
21. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
22. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
23. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
24. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
25. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
26. Ledger: `implementation-status-uiux.md` yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
27. Manual signoff: operator visual/tekshiruv natijasini tasdiqlaydi (screenshot/test raqam).
28. Next readiness: keyingi prompt boshlanishi uchun dalil (grep/test natijasi) yoziladi.
29. Observability (agar frontend o'lchovi kerak): `implementation-status-uiux.md` ga perf/a11y raqam yoziladi.
```

---

## H-01 — Admin UI (dashboard, users, teachers, audit — professional)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/admin/*` ni B base + professional pattern bilan tuzish (C-07/08/09 backend mavjud):
   - Dashboard: KPI (login ok/fail, lockout, teacher arizalar, risk block, email deliverability) — konteks + trend (F-01 pattern).
   - Users: ro'yxat (pagination), search (debounce 300ms), filter, blok/aktiv, rol change, session revoke — confirm modal.
   - Teachers: arizalar queue (pending birinchi, badge yangi), approve/reject (sabab majburiy), detail.
   - Audit: log ro'yxati (filter event/user/vaqt), export CSV (signed — E-17; formula-injection himoya).
   - Charts: lightweight SVG (E-02/F-04 pattern) — accessible, colorblind-safe.
03. Admin dizayn: ish interfeysi — yuqori density (GitHub/Amazon), sokin, minimal motion; **bitta token oilasi** (boshqa dizayn emas).
04. Admin auth (C-07): alohida session, MFA majburiy, idle qisqa; UI'da "MFA yoqilgan" badge.
05. Empty/error/loading (F-08 pattern): skeleton, retry, empty CTA.
06. Motion: minimal (160-220ms); reduced-motion.
07. Security/data guard: faqat admin (requireRole C-20); audit har action; PII minimal; IDOR yo'q.
08. Unit test: admin view'lar (regex): KPI, users manage, teacher queue, audit export.
09. Integration/contract test: admin API (C-07/08/09) → render.
10. E2E/security test: non-admin blok; IDOR; CSV injection; XSS.
11. GREP-CHECK: `grep -rn "Righteous\|gradient" views/admin/` = 0.
12. A11y: keyboard to'liq, focus, contrast, charts text.
13. i18n: matnlar uz (H-03 da 4 til).
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga H-01 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: non-admin access yoki IDOR bo'lsa.
18. Done condition: admin UI professional, xavfsiz.
19. H-02 uchun: admin mobile — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## H-02 — Admin mobil + rol ekranlar (marker/proctor)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Admin mobile (ko'rish): dashboard KPI stack, ro'yxatlar compact; action'lar desktop'da (H-06 qarori).
03. `views/role/marker.ejs`, `proctor.ejs` (B-36/P3):
   - Marker: rubric bo'yicha ball (F-03 pattern — speedgrading), ro'yxat nav.
   - Proctor: kamera evidence ro'yxati (research.md 6) — sokin, dalil-fokus (viewer modal), status (ok/flag).
   - Bu rol'lar scoped (C-20) — UI'da faqat o'z guruhidagi narsalar.
04. Camera UI: preview'da PII (yuz) — `Referrer-Policy: no-referrer`, no-cache; screen reader (alt tavsif); accessibility (camera yozish ruxsati — consent B/D).
05. Motion: minimal; reduced-motion.
06. Security/data guard: proctor view faqat rol; PII (kamera) UZ'da, minimal; IDOR.
07. Unit test: marker/proctor view'lar (regex); 375px admin.
08. Integration/contract test: marker ball → grading; proctor evidence.
09. E2E/security test: rol blok; XSS; camera PII (referrer/cache).
10. GREP-CHECK: `grep -rn "gradient\|Righteous" views/role/marker.ejs views/role/proctor.ejs` = 0.
11. A11y: camera alt, keyboard, contrast.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga H-02 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: rol scope buzilsa yoki camera PII leak bo'lsa.
17. Done condition: admin/marker/proctor to'liq.
18. H-03 uchun: i18n — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
26. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
27. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
```

---

## H-03 — i18n 4 til (uz-Latn, uz-Cyrl, ru, en) — barcha UI

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_style_deep.md` 2.2 (i18n) asosida:
   - Barcha UI string'lar `i18n` modulidan (mavjud `src/modules/multilingual` yoki auth i18n.js — tekshir; bitta manba).
   - Tillar: uz-Latn (default), uz-Cyrl, ru, en — BCP-47; `lang` atributi to'g'ri.
   - Har string: 4 tilda; xato matnlari ham (14+ holat).
03. Tarjima sifati: uz-Cyrl — professional tarjima (transliteratsiya EMAS); ru/en — native; "universitar" terminologiya (detskiy emas).
   - Terminology bank: "Jonli dars" (Cast), "Nazorat" (test), "O'qituvchi", "Talaba" — izchil (letsgroto: glossary).
04. Locale saqlash: users.locale (profil) + cookie; switcher (footer/header — native nomlar: O'zbekcha, Ўзбекча, Русский, English; 44px).
05. Plurallar: uz/ru grammatika ("1 ta savol / 2 ta savol") — i18n qoidalari.
06. Uzun matnlar (ru) — layout testi (overflow yo'q); LTR (RTL emas).
07. Data format: sana/vaqt locale (Asia/Tashkent timezone); raqam format.
08. `lang` attributi + `dir="ltr"`; tarjima string'da PII yo'q; interpolation XSS-safe (esc).
09. Security/data guard: string'da secret/PII yo'q; xato kodlari → i18n key (API).
10. Unit test: har til string count bir xil; key yo'q emas; lang atributi.
11. Integration/contract test: til o'zgarishi → UI (Playwright); switcher persist.
12. E2E/security test: XSS (tarjima esc); uz-Cyrl glyph; overflow.
13. GREP-CHECK: `grep -rn "lang=\"uz\"" views/` — har sahifa dynamic lang; hardcoded matn kamaygan (i18n funksiyasi).
14. A11y: lang atributi screen reader uchun; switcher focus.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga H-03 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: bir til string yetishmasa yoki transliteratsiya bo'lsa.
19. Done condition: 4 til to'liq, professional.
20. H-04 uchun: a11y audit — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
25. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
26. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## H-04 — A11y audit (WCAG 2.2 AA — barcha sahifa)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Full a11y audit (research_ui_top_sites 4.5: 95.9% fail — Edikit ustunlik):
   - Sahifalar: landing, login, register, verify, forgot, reset, MFA, settings, panel, test-arena, portfolio, notifications, assignments, teacher (dashboard/builder/grading/analytics/roster), cast (lobby/projector/participant/host), admin (dashboard/users/teachers/audit), marker/proctor.
   - Har sahifada: axe 0 critical+serious; keyboard to'liq; focus visible; contrast 4.5:1 (7:1 projector).
   - Screen reader spot (NVDA/VoiceOver): login, panel, cast participant.
   - `prefers-reduced-motion` — barcha motion o'chadi (A-03).
   - Semantic HTML: heading ketma-ketligi, landmark, label-for, aria.
03. Tuzatishlar: topilganlarni fix (fokus, aria, contrast, heading).
04. `axe-core` CI'ga: `npm run test:a11y` — har PR (D-18/29 pattern); axe 0 gate.
05. Motion audit: 500ms max; reduced-motion to'liq.
06. Security/data guard: a11y fix'lar logika o'zgartirmaydi.
07. Unit test: axe integration (CI).
08. Integration/contract test: axe har sahifa (Playwright).
09. E2E/security test: screen reader journey (login→panel→test); keyboard.
10. GREP-CHECK: axe report 0 critical/serious barcha sahifada.
11. A11y: WCAG 2.2 AA — qabul mezonlari hujjatda (style.md 33/41.3).
12. i18n: lang atributi hammasida.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga H-04 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: axe serious yoki keyboard trap bo'lsa.
17. Done condition: a11y audit to'liq, axe 0, hujjatda.
18. H-05 uchun: perf budget — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## H-05 — Perf budget (LCP/INP/CLS/JS) — butun platforma

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_tech_deep.md` 6 (budget) — platforma bo'yicha:
   - Target: LCP<2.5s, INP<200ms, CLS<0.1 (mobile 75p), first-load JS<100kB.
   - Har sahifa turi: landing (yengil — A-10), auth (kam JS), panel/teacher (JS kerakli), cast (socket — G-06), admin.
03. O'lchov: PageSpeed/Lighthouse (mobile) har sahifa turi — natija jadval.
04. Fail bo'lganlarni tuzatish:
   - LCP: hero/preload/WebP (C-09), font swap.
   - INP: long tasks, third-party defer, content-visibility.
   - CLS: media dimensions, header rezerv, font swap.
   - JS: sahifa-selectiv (A-10), keraksiz lib yo'q (E-02/F-04 chart).
05. Third-party inventarizatsiya: socket.io (kerakli sahifa), font (preconnect), SW — hammasi budget'da.
06. Redis/DB: server-side caching (boshqa faza) — UI budget qat'iy.
07. Monitoring: CrUX/RUM (D-06) — perf regression alert.
08. Security/data guard: optimallashtirish logika o'zgartirmaydi.
09. Unit test: budget config (CI'da lighthouse gate — ixtiyoriy).
10. Integration/contract test: har sahifa turi Lighthouse raqamlari.
11. E2E/security test: budget fail bo'lsa — fix.
12. GREP-CHECK: `grep -rn "cdn.socket.io" views/partials/head.ejs` = 0 (A-10 saqlangan).
13. A11y: perf o'zgarishlari a11y'ni buzmaydi.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga H-05 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: budget fail bo'lsa.
18. Done condition: perf budget to'liq, hujjatda, monitoring.
19. H-06 uchun: microcopy audit — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## H-06 — Microcopy va copy audit (universitar ton)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_style_deep.md` 4 (microcopy) + `research_ui_top_sites` (ethical UX) asosida:
   - Barcha UI matn audit: button (verb+benefit — "Boshlash" emas "Hisob yaratish"), error (empatiya + nima + keyingi qadam), empty state (Notion pattern), confirm.
   - "Universitar" ton: professional, tushunarli; "o'yinchoq" so'zlar faqat Cast kontekstida ("Jonli dars" asosiy).
   - Trust: "Ma'lumotlar O'zbekistonda saqlanadi" — barcha forma.
03. Error microcopy (authgear map — research_ui_auth 4):
   - "Parol noto'g'ri. Qayta urinib ko'ring yoki parolni tiklang." (empatiya + yechim).
   - "Kod noto'g'ri yoki muddati o'tgan — [Qayta yuborish]".
   - "Ulanishda muammo — [Qayta urinish]" (input yo'qolmaydi).
04. Button copy: "Create My Account" > "Register" (first-person — ivyforms); "Bepul boshlash" — landing.
05. Empty states: "Hozircha testlar yo'q — 3 daqiqada birinchi testingizni yarating" (outcome timeframe).
06. No dark patterns (clay.global): consent aniq, unsubscribe oson, reversible.
07. Terminology bank (letsgroto): hujjat — do/don't, glossary (uz/ru/en).
08. Security/data guard: microcopy'da secret/PII yo'q; xato kodlari i18n key (H-03).
09. Unit test: copy regex (kerakli matnlar); no "Submit"/"Click here" (ixtiyoriy).
10. Integration/contract test: barcha UI matn i18n key'dan (H-03 bilan).
11. E2E/security test: XSS (matn esc); dark pattern yo'q.
12. GREP-CHECK: `grep -rn "Click here\|Submit\b" views/` = 0 (agar mavjud bo'lsa tuzatish).
13. A11y: button aria (icon-only — label).
14. i18n: 4 til copy (H-03).
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga H-06 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: dark pattern yoki no-empathy error bo'lsa.
19. Done condition: microcopy to'liq, universitar ton.
20. H-07 (final) uchun: tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## H-07 — UI/UX FINAL RELEASE (A-H barcha faza)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. H-faza yakuniy qabul — BUTUN UI/UX (A-H):
   - A (audit-fix) → B (foundation) → C (landing) → D (auth UI) → E (user) → F (teacher) → G (cast) → H (admin/i18n/a11y/perf) — barcha checklist to'liq (ledger).
03. QABUL TESTLARI (barchasi):
   - GREP-CHECK global: `grep -rn "Righteous\|Nunito" views/ public/` = 0; `orbit\|drift\|particle\|pulseAura\|shimmer\|float3d\|gleam\|glow\|confetti\|optShimmer\|optSweep\|--ease-bounce\|--ease-elastic` = 0; `minlength="4"` = 0; `prefers-reduced-motion` ≥1; `theme-floating` = 0.
   - `npm run typecheck` + `npm test` (to'liq regression) — 0 xato.
   - axe 0 critical/serious barcha sahifa (H-04).
   - Perf budget: LCP<2.5s, INP<200ms, CLS<0.1, JS<100kB (H-05).
   - i18n: 4 til to'liq (H-03).
   - Light/dark: professional, kontrast AA, silliq theme switch ≤500ms.
   - Backend auth/security testlar buzilmagan (P0).
04. Visual QA: landing, auth, panel, teacher, cast, admin — light/dark screenshot (benchmark: BBC/Google/Canvas/Mentimeter).
05. Sign-off: operator checklist + security (backend) — UI/UX release tasdiqlanadi.
06. Security/data guard: critical yashirilmaydi; qolgan P2/P3 (passkey extra, OneID UI, HEMIS OAuth UI) — ro'yxat.
07. `implementation-status-uiux.md` ga H-07 (FINAL RELEASE) statusi, dalillar, sign-off yoz.
08. Global report formatida qaytar.
09. Stop condition: birorta qabul testi fail bo'lsa — RELEASE yo'q.
10. Done condition: UI/UX to'liq, "universitar + global" daraja, release tayyor.
11. Next-version backlog (P3): OneID login UI, HEMIS OAuth button (rasmiy qachon), passkey ekranlar chuqur, device flow, ML risk UI, security score.
12. Butun PROMPT_GUIDE_UIUX zanjiri (A-H, ~83 prompt) yakunlandi — hujjatda.
13. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
14. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
15. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
16. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
17. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
18. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
19. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
20. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
21. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
22. Ledger: `implementation-status-uiux.md` yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
```

