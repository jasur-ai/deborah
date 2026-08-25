# Edikit UI/UX — FAZA F: TEACHER WORKSPACE (dashboard, test-builder, grading, analytics)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_teacher_deep.md` (glanceable cockpit, SpeedGrader benchmark, density), `research_ui_top_sites_deep.md` (Canvas SpeedGrader, GitHub/Amazon density), `uploads/style.md` 23 (teacher workspace).

---

## F-00 — Teacher workspace preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_teacher_deep.md` 1-4-bo'limlarini o'qib, teacher rejasini tuz:
   Dashboard (cockpit), Test-builder (authoring), Grading (SpeedGrader), Analytics, Roster.
03. Precondition: E-09 (User panel) yashil.
04. Hozirgi view'lar: `views/role/teacher.ejs`, `views/user/create-test.ejs` — inventarizatsiya.
05. Teacher dizayn (style.md 0): sokin, aniq, yuqori density, neutral surfaces, minimal motion.
06. Benchmark: Canvas SpeedGrader (rubrik+annotatsiya), GitHub (density), Amazon (task oqimi).
07. Baseline: `npm run typecheck` + `npm test`.
08. Security/data guard: hech narsa o'zgartirilmaydi (reja).
09. Unit test: existing smoke.
10. Integration/contract test: existing.
11. E2E/security test: workspace toza.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga F-00 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: reja tasdiqlanmasa.
16. Done condition: reja aniq, F-01 ready.
17. F-01 uchun: teacher dashboard — tayyor ekanini dalil bilan yoz.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
24. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
25. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
26. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
27. Ledger: `implementation-status-uiux.md` yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
28. Manual signoff: operator visual/tekshiruv natijasini tasdiqlaydi (screenshot/test raqam).
29. Next readiness: keyingi prompt boshlanishi uchun dalil (grep/test natijasi) yoziladi.
```

---

## F-01 — Teacher dashboard (glanceable decision cockpit)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/role/teacher.ejs` ni qayta tuzish (style.md 23 + MDPI co-design):
   - Layout: left sidebar (Bosh sahifa · Testlar · Jonli dars · Talabalar · Roster · Natijalar · Sozlamalar) — global nav.
   - Overview KPI (kam, konteks bilan — multipurposethemes):
     - Yaqinlashayotgan testlar (sana, son).
     - Oxirgi test natijasi (class average + trend) — `--color-action` raqam, gradient EMAS (A-01).
     - Xavf ostidagi talabalar (threshold alert — zigpoll).
     - Tekshirish kutilayotgan ishlar (grading queue).
   - Quick actions: [Test yaratish] [Jonli dars boshlash] [Roster import].
03. "Glanceable": 5 soniyada 3 savolga javob: qaysi talaba xavfda? qaysi test yomon? keyin nima? (gitnexa/cfder).
04. Konteks: har KPI — trend/benchmark ("o'tgan hafta vs").
05. Density: yuqori (GitHub/Amazon) — lekin whitespace + drill-down (SQLGene: KPI→chart→table).
06. Bento grid (2026): KPI + charts modulli (B-07).
07. Motion: sokin; panel 220-280ms; reduced-motion.
08. Security/data guard: faqat o'z guruhi/fani (tenant/RBAC C-20); IDOR yo'q.
09. Unit test: teacher dashboard (regex): sidebar, KPI row, quick actions, alert.
10. Integration/contract test: dashboard API data.
11. E2E/security test: IDOR; alert; XSS; 5 soniya glance (visual).
12. GREP-CHECK: `grep -rn "gradient\|Righteous" views/role/teacher.ejs` = 0.
13. A11y: nav, KPI aria, keyboard, contrast.
14. i18n: matnlar uz.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga F-01 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: glanceable bo'lmasa (KPI noise) yoki IDOR.
19. Done condition: teacher dashboard cockpit to'liq.
20. F-02 uchun: test-builder — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## F-02 — Test-builder (authoring flow — step-based, auto-save)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/create-test.ejs` ni qayta tuzish (research_ui_teacher 2):
   - Step flow (instapage momentum): 1) Asosiy (nom, fan, guruh) → 2) Savollar → 3) Sozlamalar (vaqt, ball) → 4) Saqlash.
   - Progress indicator: "Qadam 2/4" + bar (staticforms).
   - Auto-save: har o'zgarishda (debounce 800ms) — "Saqlandi HH:MM" (yo'qolmaydi).
   - Preview: [Talaba ko'rinishi] — sahifa yoki modal (B-09 modal).
03. Savol turlari (research.md 5.3): MC, TF, matching — izchil UI; har tur uchun template.
   - Variant: radio (MC), input (short), drag (matching — P2).
   - Distractor sifati (research.md 8.4): AI taklifi — [Qabul]/[Tahrirlash] (co-pilot model — research_ui_tech 4.3).
04. AI generator (research.md 8): [AI yordamida yaratish] — prompt modal → takliflar (teacher tasdiqlaydi; aniq "AI yaratdi" label; PII AI'ga yuborilmaydi).
   - Difficulty 50/30/20 (research.md 8.1) — UI'da ko'rsatish/tahrirlash.
05. Qoidalar: top-aligned labels (fomr.io), inline validation (B-10), field minimal (progressive profiling).
06. Motion: step o'tish 240-320ms (no-preference); reduced-motion.
07. Security/data guard: answer key server'da (client'da yo'q — qoida 19); AI'ga PII yo'q; XSS esc.
08. Unit test: create-test step flow, auto-save, AI label (regex).
09. Integration/contract test: test save → list; preview.
10. E2E/security test: answer key client'da yo'q; XSS; auto-save.
11. GREP-CHECK: `grep -rn "correct.*answer.*value\|answer_key" views/user/create-test.ejs` = 0.
12. A11y: step keyboard, progress aria, error live.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga F-02 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: answer key client'da yoki auto-save yo'q bo'lsa.
18. Done condition: test-builder to'liq, AI co-pilot.
19. F-03 uchun: grading — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## F-03 — Grading UI (SpeedGrader pattern)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Grading interface (Canvas SpeedGrader benchmark — research_ui_top_sites 2.7, research_ui_teacher 3):
   - Queue: "Tekshirish kutilayotgan" — soni aniq, nav (old/next student).
   - Layout: 3 panel — ro'yxat (students) | submission (javob) | rubric/feedback.
   - Submission: student javob (matn/savol), annotatsiya (highlight — P2).
   - Rubric: ko'rinadigan panel (research.md 7.4) — har mezon ball + feedback.
   - Keyboard: 1-5 ball, arrow nav, Enter saqlash — tezlik (density).
   - Auto-save: har ball (debounce) — "Saqlandi".
   - Batch: [Barchasini ballash] (bir xil rubrik).
03. AI grading (research.md 7.5): confidence routing — AI taklifi + teacher spot-check; aniq "AI: X ball" label + [Qabul]/[Tahrirlash].
04. Natija e'lon: [E'lon qilish] — bir marta bosish (B-32 notification), confirm modal.
05. Empty state: "Tekshirish kutilayotgan ish yo'q".
06. Motion: 160ms; reduced-motion.
07. Security/data guard: ball server; IDOR (boshqa guruh); XSS (student javob esc).
08. Unit test: grading 3-panel, rubric, keyboard (regex).
09. Integration/contract test: grading save → e'lon → notification.
10. E2E/security test: IDOR; XSS (javob); AI label; keyboard flow.
11. GREP-CHECK: `grep -rn "answer_key\|correct" views/role/teacher.ejs` = 0 (grading'da client answer yo'q).
12. A11y: ro'yxat keyboard, rubrik focus, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga F-03 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: IDOR yoki ball client bo'lsa.
18. Done condition: grading SpeedGrader-pattern, tez, xavfsiz.
19. F-04 uchun: analytics — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## F-04 — Analytics (distribution, item analysis, trend)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Analytics (research_ui_teacher 3.3, cfder, datacamp):
   - Class performance: line chart (trend) + distribution (histogram) — colorblind-safe.
   - Item analysis (research.md 8.5): har savol — to'g'ri %, distractor tanlov (bar) — "dominant distractor" (style.md 41.5).
   - Fan/guruh filter (MDPI: class+student tanlash).
   - Risk flags (zigpoll): threshold-based (attendance/pasayish) → intervention ro'yxati.
   - Export CSV (formula-injection himoya — D-10).
03. Chart'lar: lightweight (SVG/hand-made, E-02 pattern); keyboard-navigable; text fallback.
04. Rang: `--color-action/success/warning/danger`; bir xil semantika (gitnexa: rang ma'nosi o'zgarmaydi).
05. Density: chart'lar sokin; drill-down (click chart → student detail).
06. Konteks: har raqam — trend/benchmark.
07. Motion: chart update 200ms; reduced-motion.
08. Security/data guard: analytics o'z guruhi/fani; PII minimal (student_id yashirin); XSS.
09. Unit test: analytics chart'lar, filter, risk flag (regex).
10. Integration/contract test: analytics API → render; export.
11. E2E/security test: IDOR; CSV injection; XSS; chart keyboard.
12. GREP-CHECK: `grep -rn "chart.js\|d3\|recharts" views/role/teacher.ejs` = 0 (lightweight).
13. A11y: chart text fallback, contrast.
14. i18n: matnlar uz.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga F-04 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: og'ir chart lib yoki IDOR bo'lsa.
19. Done condition: analytics to'liq, dalil-based.
20. F-05 uchun: roster/talabalar — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
25. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## F-05 — Roster va talabalar (import, invite, detail)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Roster (A-10/11, C-11 UI):
   - Import: Excel upload (xlsx) — progress UI (bar), xato ro'yxati (qator + sabab), qisman muvaffaqiyat (ok/failed), [Rollback] (B-11).
   - Drag&drop + file picker; 10MB limit; file format tekshiruv.
   - Invite: email/invite link — batch (B-36); har invite 1 martalik, 7 kun; progress.
03. Talabalar ro'yxati:
   - Search (debounce 300ms), filter (guruh/fan), sort.
   - Har student: ism (PII — yashirin emas, lekin minimal), guruh, status, natija o'rtacha, xavf signali.
   - Student detail (modal/sahifa): profil, natija tarixi, portfolio, xavf → [Intervention] (E-04 recommendation).
04. HEMIS ma'lumot (C-10/C-11): OAuth'da guruh/fakultet ma'lumoti (research_repos 2.4) — roster'da ko'rsatish (agar integratsiya).
05. Motion: 160ms; reduced-motion.
06. Security/data guard: import fayl sanitize (formula-injection — A-10); PII minimal; IDOR yo'q.
07. Unit test: roster import progress, invite, student detail (regex).
08. Integration/contract test: import → staging → commit; invite.
09. E2E/security test: CSV/Excel formula injection; IDOR; XSS.
10. GREP-CHECK: `grep -rn "jshshir\|pinfl" views/role/teacher.ejs` = 0 (JSHSHIR ko'rinmaydi — qoida 21).
11. A11y: import progress live region, ro'yxat keyboard.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga F-05 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: injection yoki IDOR bo'lsa.
17. Done condition: roster/talabalar to'liq.
18. F-06 uchun: teacher density/mobile — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## F-06 — Teacher density va mobile (ko'rish uchun)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Density qoidalari (research_ui_teacher 1.3):
   - Desktop: yuqori density — KPI row, compact table (font-size 14px, line-height 1.4), whitespace token'li.
   - Tooltip/drillthrough: ortiqcha ma'lumot tooltip'da (SQLGene: "offload to tooltips").
   - Preattentive: rang/size bilan signal (xavf — qizil, yaxshi — yashil), lekin icon+text.
03. Mobile (teacher): ko'rish uchun (actions desktop'da):
   - Dashboard: KPI stack (single-column), charts soddaroq.
   - Grading: mobile'da minimal (rubrik ko'rish; ball desktop).
   - Roster: search + compact list.
   - Qaror: teacher asosiy ishi desktop; mobile — tezkor tekshirish (wesoftyou: educator control).
04. Kontrast: density'da ham WCAG AA.
05. Security/data guard: hech qanday PII yashirin maydonda.
06. Unit test: 375px teacher sahifalar (Playwright).
07. Integration/contract test: mobile ko'rish flow.
08. E2E/security test: touch target, XSS.
09. GREP-CHECK: `grep -rn "font-size:.*1[0-5]px" views/role/teacher.ejs` — table'da 14px ruxsat (body 16px).
10. A11y: table keyboard, contrast.
11. i18n: matnlar uz.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga F-06 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: mobile'da grading buzilsa yoki contrast fail.
16. Done condition: density professional, mobile ko'rish uchun.
17. F-07 uchun: rol/header — tayyor.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## F-07 — Teacher header/rol UX (header, rol switcher)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Teacher header (B-11 base):
   - Logo + breadcrumb (test/panellar — SearchPilot: breadcrumb +5%) + theme toggle + avatar (ism/rol) + [Chiqish].
   - Rol badge: "O'qituvchi" (approved — B-16); co-teacher/proctor — B-36/P3.
   - Avatar: initials (PII minimal), gradient EMAS (A-01).
03. Rol switcher (reddit r/userexperience — KoalaTrainer): teacher+student ikkalasi bo'lsa — "O'qituvchi ko'rinishi / Talaba ko'rinishi" toggle (server render, RBAC C-20).
   - UI: avatar menu'da — faqat kerakli rol ko'rinadi (ProfessorApe: "why are they seeing it?").
04. Breadcrumbs: Teacher > Testlar > [Test nomi] — label qisqa, `aria-current`.
05. Notification badge: o'qituvchi uchun (ariza, SLA, xavf) — B-16/C-09 (kam, priority — E-06 pattern).
06. Motion: 160ms; reduced-motion.
07. Security/data guard: rol o'zgarishi server (C-20); IDOR yo'q.
08. Unit test: header breadcrumb, rol badge, switcher (regex).
09. Integration/contract test: rol switcher (server); breadcrumb.
10. E2E/security test: rolga mos UI (student admin'ni ko'rmaydi); XSS.
11. GREP-CHECK: `grep -rn "Righteous\|gradient" views/role/teacher.ejs` = 0.
12. A11y: avatar aria, breadcrumb nav, keyboard.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga F-07 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: rolga mos bo'lmagan element ko'rinsa.
18. Done condition: teacher header/rol to'liq.
19. F-08 uchun: teacher empty/error — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## F-08 — Teacher empty/error/loading states

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Empty states (userpilot pattern — Notion):
   - "Hozircha testlar yo'q" → [Test yaratish] (3 daqiqa — outcome timeframe).
   - "Talabalar yo'q" → [Roster import] / [Invite].
   - "Tekshirish kutilayotgan yo'q" → "Barchasi tekshirilgan ✓".
   - Har empty: icon + qisqa matn + bitta CTA (benefit).
03. Error states (authgear map):
   - API error: "Ma'lumot yuklanmadi — [Qayta urinish]" (input yo'qolmaydi).
   - Form error: inline (B-10) — "X + qanday tuzatish".
   - Network: "Ulanishda muammo — [Qayta urinish]" + status havolasi (agar).
04. Loading:
   - Skeleton (B-09 card) — layout shift yo'q (CLS).
   - Button loading: spinner (0.8s faqat) + `aria-busy`; disabled.
05. Toast (success): 180ms enter, auto-dismiss 4s, `aria-live`, sokin (no confetti).
06. Motion: reduced-motion qat'iy.
07. Security/data guard: error'da PII/secret yo'q; xato log server'da.
08. Unit test: empty/error/loading state'lar (regex).
09. Integration/contract test: API fail → error state → retry.
10. E2E/security test: error'da secret yo'q (grep); retry ishlaydi; XSS.
11. GREP-CHECK: `grep -rn "secret\|token" views/role/teacher.ejs` — error matnlarida yo'q.
12. A11y: skeleton aria-busy, error aria-live, toast live.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga F-08 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: dead-end error yoki secret leak bo'lsa.
18. Done condition: states to'liq, calm.
19. F-09 (checkpoint) uchun: tayyor.
```

---

## F-09 — TEACHER checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. F-faza qabul testlari:
   - Dashboard: cockpit (3 savolga javob), KPI konteks, quick actions, bento.
   - Test-builder: step flow, auto-save, preview, AI co-pilot (label), answer key client'da emas.
   - Grading: SpeedGrader pattern (3 panel, rubrik, keyboard, batch), AI confidence, e'lon.
   - Analytics: distribution/item analysis/trend, filter, risk flag, export (injection-safe).
   - Roster: import progress, invite, student detail, JSHSHIR ko'rinmaydi.
   - Density/mobile: desktop yuqori density, mobile ko'rish, 44px, contrast.
   - Header/rol: breadcrumb, rol badge, switcher, RBAC.
   - States: empty/error/loading/toast to'liq.
03. Full regression: `npm run typecheck` + `npm test`.
04. GREP-CHECK jadvali (F bo'yicha): gradient, Righteous, answer key, JSHSHIR, chart lib — 0.
05. A11y: axe 0 (teacher sahifalar); keyboard (grading to'liq); reduced-motion.
06. i18n: uz to'liq; 4 til H fazada.
07. Visual: teacher professional, dense (GitHub/Canvas benchmark) light/dark.
08. Sign-off: operator checklist (F-faza yopiladi).
09. Security/data guard: critical yashirilmaydi; tenant/RBAC.
10. Har yangi write path uchun tenant scope, authorization, validation tekshir.
11. Unit test: full F.
12. Integration/contract test: teacher journey (dashboard→builder→grading→analytics).
13. E2E/security test: full F E2E + axe + IDOR.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga F-09 (CHECKPOINT) statusi, dalillar, sign-off yoz.
16. Global report formatida qaytar.
17. Stop condition: birorta qabul testi fail bo'lsa.
18. Done condition: Teacher workspace to'liq, professional.
19. Qolgan ishlar: G (Cast), H (Admin/QA) — ko'chirilganini yoz.
20. Butun FAZA F yakunlandi — G-00 preflight'ga tayyor.
```

