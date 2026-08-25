# Edikit UI/UX — FAZA E: USER PANEL (student dashboard, progress, test-arena, portfolio)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_user_deep.md` (MyLA, gamifikatsiya evidence), `research_ui_top_sites_deep.md` (Canvas benchmark: cards + Coming Up + To Do), `research_ui_style_deep.md` (UZ mobile).

---

## E-00 — User panel preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_user_deep.md` 1-3-bo'limlarini o'qib, student panel rejasini tuz:
   Dashboard (overview+progress+assignments), Test-arena (yechish), Portfolio/transkript, Notification (kam).
03. Precondition: D-09 (Auth UI) yashil.
04. Hozirgi view'lar: `views/user/panel.ejs`, `portfolio.ejs`, `assignments.ejs`, `test-arena.ejs` — inventarizatsiya (nima bor, nima yo'q).
05. Canvas benchmark: left-nav + cards + "Yaqinlashayotgan" + "To Do" + progress (research_ui_top_sites 2.7).
06. Gamifikatsiya qoidasi (research_ui_user 2.2): progress/achievement(private)/feedback; public leaderboard — teacher nazoratida.
07. Baseline: `npm run typecheck` + `npm test`.
08. Security/data guard: hech narsa o'zgartirilmaydi (reja).
09. Unit test: existing smoke.
10. Integration/contract test: existing.
11. E2E/security test: workspace toza.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga E-00 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: reja tasdiqlanmasa.
16. Done condition: reja aniq, E-01 ready.
17. E-01 uchun: panel layout — tayyor ekanini dalil bilan yoz.
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

## E-01 — Student panel layout (left-nav + cards — Canvas pattern)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/panel.ejs` ni qayta tuzish (Canvas benchmark — research_ui_top_sites 2.7):
   - Layout: left sidebar (global nav — hamma joyda bir xil):
     Bosh sahifa · Topshiriqlar · Testlar · Portfolio · Xavfsizlik · Sozlamalar.
   - Main: `.dashboard` — cards grid (B-09) + overview.
   - Sticky sidebar (desktop); mobile: bottom tab bar yoki hamburger (B-11).
03. Overview (glanceable — 1 qarashda):
   - KPI row (token'li): "Keyingi topshiriq" (due + status), "Bugungi testlar", "Umumiy progress" (bar), "So'nggi natija" (foiz + trend).
   - Konteks: "oldingi haftaga nisbatan +5%" (mypertension — multipurposethemes).
04. "Yaqinlashayotgan" (Canvas): keyingi 3 ta test/topshiriq — sana, fan, status (badge).
   "To Do" (Canvas): bugungi/kechikkan ishlar — aniq status (thefinch: "to-do faqat bugun" xatosi — kechagilar ham ko'rinadi).
05. Cards: test cards — nom, fan, savol soni, oxirgi natija, [Yechish]/[Cast] action'lar (B-09).
06. Empty states (userpilot): "Hozircha testlar yo'q — birinchi testni kuting" + yordam.
07. Motion: 160-220ms; reduced-motion.
08. Security/data guard: faqat o'z ma'lumoti (tenant); IDOR yo'q.
09. Unit test: panel layout (regex): sidebar itemlar, KPI row, cards.
10. Integration/contract test: panel 200; API data to'g'ri.
11. E2E/security test: IDOR; XSS; mobile bottom-nav.
12. GREP-CHECK: `grep -rn "Righteous\|gradient" views/user/panel.ejs` = 0 (A-01 qoldig'i).
13. A11y: nav landmark, aria-current, keyboard, 44px.
14. i18n: matnlar uz.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga E-01 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: IDOR yoki layout buzilsa.
19. Done condition: panel layout Canvas-pattern, glanceable.
20. E-02 uchun: progress — tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## E-02 — Progress visualizatsiya (MyLA — self-regulated learning)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_user_deep.md` 1.1 (MyLA) asosida progress blok:
   - Umumiy progress bar (fanlar bo'yicha) — token'li `.progress` (fill: var(--color-action), track muted; aria-valuenow).
   - Fanlar bo'yicha: har fan — progress + trend (sparkline/line — datacamp: change over time = line/sparkline).
   - Konteks: benchmark ("sinf o'rtacha") yoki shaxsiy trend ("keyingi 2 hafta").
03. Chart'lar (datacamp — research_ui_user 1.4):
   - Trend: line chart (SVG, lightweight, no heavy lib; yoki CSS/SVG hand-made).
   - Progress vs goal: bullet chart.
   - Rang: `--color-action`/`--color-success`; colorblind-safe (rang + label).
   - Aksessuar: keyboard-navigable (SVG role=img + text fallback).
04. Progress = eng qadrli gamification elementi (arxiv 2025: progress bar > points/badges) — E'LON QILISH, ball emas.
05. Real-time/near-real-time (multipurposethemes): yangi natija → progress yangilanadi (eski data ishonchni buzadi).
06. Motion: chart update 200ms (no-preference); reduced-motion static.
07. Security/data guard: progress server-authoritative (qoida 8); faqat o'z ma'lumoti.
08. Unit test: progress bar aria; chart SVG bor (regex).
09. Integration/contract test: progress API ma'lumot to'g'ri render.
10. E2E/security test: chart keyboard; XSS (data esc); IDOR.
11. GREP-CHECK: `grep -rn "chart.js\|recharts\|d3" views/user/panel.ejs` = 0 (og'ir lib yo'q — lightweight).
12. A11y: chart text fallback, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-02 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: progress server'dan emas yoki chart inaccessible bo'lsa.
18. Done condition: progress/trend to'liq, glanceable.
19. E-03 uchun: test-arena — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## E-03 — Test-arena (student test yechish)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/test-arena.ejs` ni qayta tuzish (task-led):
   - Sokin, fokus; katta tipografiya YO'Q (bu cast emas — individual yechish).
   - Header: savol raqami "5/20" + progress bar + timer (top-right, sokin).
   - Savol kontainer: savol matni (esc), variantlar (radio card, 44px, keyboard).
   - Navigation: "Keyingi"/"Oldingi" + savol panellari (barcha, skip/qaytish) + "Yakunlash".
   - Timer tugasa: auto-submit (server) + xabar.
03. Feedback (constructive — multipurposethemes):
   - Har javobdan keyin (agar instant) yoki yakunda: to'g'ri/noto'g'ri (icon+text — rangga bog'liq emas).
   - Natija ekrani: ball + foiz + fan bo'yicha tahlil + "Quyidagi mavzuni takrorlang" (recommendation — E-09/AI).
04. Offline/low-bandwidth: offline-journal (mavjud public/js/offline-journal.js) — UI'da offline banner "Oflayn rejim — javoblar saqlanadi, ulanishda yuboriladi".
05. Cheating-signal (agar): sokin "dalil" — kamera/SEB UI minimal (research.md 6).
06. Motion: 160ms feedback; reduced-motion.
07. Security/data guard: javoblar server-authoritative (qoida 8); timer server; XSS esc.
08. Unit test: arena struktura (regex): progress, timer, variants, nav.
09. Integration/contract test: yechish flow → natija API.
10. E2E/security test: timer tugashi; XSS (savol data); offline journal; IDOR.
11. GREP-CHECK: `grep -rn "answer.*key\|to'g'ri javob.*value" views/user/test-arena.ejs` = 0 (client'da answer key yo'q).
12. A11y: radio keyboard, aria-live feedback, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-03 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: answer key client'da yoki timer client bo'lsa.
18. Done condition: test-arena to'liq, xavfsiz, task-led.
19. E-04 uchun: natija/tahlil — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## E-04 — Natija va tahlil ekrani (feedback + recommendation)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Natija ekrani (E-03 dan keyin):
   - KPI: ball (server), foiz, vaqt.
   - Fan/bo'lim bo'yicha: bar (to'g'ri/noto'g'ri/bosh) — colorblind-safe.
   - Har savol tahlili (accordion): savol + sizning javobingiz + to'g'ri javob + qisqa izoh (agar rubric).
   - Trend: "Oxirgi 5 test" sparkline (E-02).
03. Recommendation (constructive — multipurposethemes, AI):
   - "Quyidagi mavzularni takrorlang" — zaif fanlar (tag/ro'yxat).
   - AI taklifi (research_ui_tech 4.3): "AI: shu mavzu bo'yicha 5 ta mashq tayyorladim" — [Boshlash] (teacher co-pilot model: AI natijasi aniq label).
04. Download/PDF: transkript/natija eksport (A-12/portfolio) — [PDF] (server-side generate).
05. Sharing: o'qituvchi bilan ulash (keyin); privacy: faqat ruxsat bilan.
06. Motion: natija reveal 240-320ms (no-preference); reduced-motion static.
07. Security/data guard: ball server; PII minimal; XSS esc (savol/javob).
08. Unit test: natija KPI, fan bar, recommendation (regex).
09. Integration/contract test: natija API → render.
10. E2E/security test: XSS (savol data); IDOR (boshqa user natijasi); PDF.
11. GREP-CHECK: `grep -rn "confetti\|celebration" views/user/` = 0 (user'da celebration yo'q — bu cast emas).
12. A11y: accordion keyboard, chart text, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-04 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: ball client yoki IDOR bo'lsa.
18. Done condition: natija/tahlil to'liq, constructive.
19. E-05 uchun: portfolio — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## E-05 — Portfolio / transkript (dalil-based)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/portfolio.ejs` ni qayta tuzish:
   - Portfolio: fanlar, natijalar tarixi (tartiblangan), sertifikatlar/badges (achievement — private), transkript.
   - Transkript (A-12): server-generate PDF; yuklab olish; HEMIS transkript bilan mos (my.edu.uz pattern — research_ui_style 5.2).
   - Timeline: natijalar vaqt bo'yicha (line/table — datacamp).
03. Achievement (gamifikatsiya — private, arxiv 2025): milestone ("1-fan yakunlandi") — badge private (Kyewski: private > public).
   - Public YO'Q (teacher nazoratida — qoida 26).
04. Eksport (D-23 DSAR): CSV/JSON — user-scoped.
05. Privacy: portfolio faqat user + teacher (rolga qarab); HEMIS da'vo qilinmaydi (qoida 28).
06. Motion: 160-220ms; reduced-motion.
07. Security/data guard: transkript server; PII minimal; IDOR yo'q.
08. Unit test: portfolio strukturasi (regex): timeline, achievement, transkript.
09. Integration/contract test: transkript PDF; eksport.
10. E2E/security test: IDOR; XSS; eksport CSV injection himoya (formula).
11. GREP-CHECK: `grep -rn "public.*leaderboard\|reyting" views/user/portfolio.ejs` = 0 (private).
12. A11y: timeline keyboard, chart text.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-05 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: IDOR yoki public achievement bo'lsa.
18. Done condition: portfolio dalil-based, private achievements.
19. E-06 uchun: notifications — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## E-06 — Notification UI (kam, priority, no overload)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Notification markaz (thefinch: Canvas xatosi — overload):
   - Ro'yxat: priority (security > result > deadline > feedback > practice).
   - Har item: icon + matn + vaqt + [Bajarildi]/[Arxiv].
   - Filter: Barcha / O'qilmagan / Muhim (security).
   - "Barchasini o'qilgan" (majburiy emas — security qoladi).
03. Badge: navbar'da o'qilmagan son (≤99+), sokin.
04. To'liq kam: kuniga ≤3 marketing; security darhol (B-32 — D-06 prefs).
05. Empty state: "Hozircha xabarlar yo'q".
06. Real-time: socket (kerakli sahifada — A-10) yoki polling (past trafik); yangi xabar toast 180ms (no-preference).
07. Security/data guard: preview'da OTP/parol yo'q; PII minimal.
08. Unit test: notification ro'yxat, badge, filter (regex).
09. Integration/contract test: notification API → render; o'qilgan.
10. E2E/security test: overload emas (kunlik son); preview PII yo'q; XSS.
11. GREP-CHECK: `grep -rn "otp\|kod.*yuborildi" views/user/notifications.ejs` = 0 (preview'da yo'q).
12. A11y: aria-live yangi xabar, keyboard, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-06 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: security xabari o'chirilsa yoki preview PII bo'lsa.
18. Done condition: notification markaz to'liq, kam, priority.
19. E-07 uchun: assignments — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## E-07 — Assignments UI (status aniq, due ko'rinadi)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/assignments.ejs` ni qayta tuzish (thefinch saboq):
   - Ro'yxat: har topshiriq — nom, fan, due (sana + qolgan vaqt), status badge:
     Yangi / Muddatli (qizil-amber) / Bajarilgan / Kechikkan (aniq).
   - Filter: Barcha / Faol / Bajarilgan / Kechikkan.
   - Sort: due bo'yicha (eng yaqin birinchi).
   - "Kechikkan" — alohida ko'rinadi (Canvas xatosi: yo'qolmaydi).
03. Detail: topshiriq sahifasi (yoki panel): izoh, fayllar, muddat, [Yakunlash] (submit — B).
04. Progress: har fan bo'yicha bajarilgan % (E-02 bilan bog'liq).
05. Offline: topshiriq yuklash/qabul (offline-journal).
06. Motion: 160ms; reduced-motion.
07. Security/data guard: faqat o'z guruhi/fani (tenant); IDOR yo'q.
08. Unit test: assignment status'lar, filter (regex).
09. Integration/contract test: assignments API; submit.
10. E2E/security test: IDOR; kechikkan ko'rinadi; XSS.
11. GREP-CHECK: `grep -rn "due\|muddat" views/user/assignments.ejs` ≥ 3 (due aniq).
12. A11y: ro'yxat keyboard, badge icon+text (rangga bog'liq emas).
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga E-07 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: kechikkan yo'qolsa yoki IDOR bo'lsa.
18. Done condition: assignments to'liq, status aniq.
19. E-08 uchun: mobile — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## E-08 — User panel mobil (UZ: talabalar telefonda)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_style_deep.md` 5 (UZ mobil — 89% internet, mobil dominant) asosida:
   - Panel mobile: bottom tab bar (Bosh sahifa / Testlar / Topshiriqlar / Portfolio) — thumb zone (logoswebdesigns).
   - Cards: single-column; 44px; 16px.
   - Progress/chart'lar: mobile'da soddaroq (katta chart emas — KPI tepada).
   - Test-arena mobile: variantlar katta (full-width, 44px+), timer ko'rinadi.
   - Offline banner (E-03): "Oflayn — javoblar saqlanadi".
03. Low-bandwidth: SSR + minimal JS (A-10); WebP; `content-visibility`.
04. PWA (head'da service worker bor): offline panel ko'rish (bazaviy) — tekshir, xato bo'lmasin.
05. Motion: mobile'da kamroq (perf).
06. Security/data guard: hech qanday PII yashirin maydonda.
07. Unit test: 375px barcha user sahifalar (Playwright viewport).
08. Integration/contract test: mobile flow — panel→test→natija.
09. E2E/security test: touch target 44px; XSS; offline.
10. GREP-CHECK: `grep -rn "font-size:.*1[0-5]px" views/user/` = 0 (16px min).
11. A11y: bottom tab aria, keyboard (desktop'da sidebar).
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga E-08 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: 375px'da flow buzilsa.
17. Done condition: user panel mobile to'liq.
18. E-09 (checkpoint) uchun: tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## E-09 — USER PANEL checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. E-faza qabul testlari:
   - Layout: left-nav (Canvas) + cards; mobile bottom tab.
   - Overview: keyingi topshiriq, bugungi testlar, progress, so'nggi natija (1 qarashda).
   - Progress: bar + trend + konteks (MyLA); chart lightweight, accessible.
   - Test-arena: timer server, progress, variant keyboard, offline, answer key client'da emas.
   - Natija: ball server, fan tahlil, recommendation (AI co-pilot), PDF.
   - Portfolio: transkript, timeline, achievement PRIVATE, eksport DSAR.
   - Notification: kam, priority, security majburiy, preview PII yo'q.
   - Assignments: status aniq (kechikkan ko'rinadi), filter, due.
   - Mobile: 375px to'liq, 44px, 16px, offline.
03. Full regression: `npm run typecheck` + `npm test`.
04. GREP-CHECK jadvali (E bo'yicha): Righteous, confetti, answer key, chart lib — 0.
05. A11y: axe 0 (user sahifalar); keyboard; reduced-motion.
06. i18n: uz to'liq; 4 til H fazada.
07. Visual: student panel professional, glanceable (Canvas benchmark) light/dark.
08. Sign-off: operator checklist (E-faza yopiladi).
09. Security/data guard: critical yashirilmaydi; server-authoritative.
10. Har yangi write path uchun tenant scope, authorization, validation tekshir.
11. Unit test: full E.
12. Integration/contract test: user journey (panel→test→natija→portfolio).
13. E2E/security test: full E E2E + axe + IDOR.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga E-09 (CHECKPOINT) statusi, dalillar, sign-off yoz.
16. Global report formatida qaytar.
17. Stop condition: birorta qabul testi fail bo'lsa.
18. Done condition: User panel to'liq, professional.
19. Qolgan ishlar: F (Teacher), G (Cast), H (Admin/QA) — ko'chirilganini yoz.
20. Butun FAZA E yakunlandi — F-00 preflight'ga tayyor.
```

