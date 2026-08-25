# Edikit UI/UX — FAZA G: CAST (jonli dars — host/projector/participant)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_cast_deep.md` (raqobat, projector, participant, host, gamification), `uploads/style.md` 24/27 (cast visual grammar, projector), `research_ui_tech_deep.md` (Socket perf, INP).

---

## G-00 — Cast preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_cast_deep.md` 2-6-bo'limlarini o'qib, Cast rejasini tuz:
   Lobby (kod), Projector (katta ekran — state'lar), Participant (telefon), Host (boshqaruv), Celebration.
03. Precondition: F-09 (Teacher) yashil.
04. Hozirgi view'lar: `views/game/enter.ejs`, `views/game/host.ejs`, `views/role/board.ejs`, `views/role/student.ejs` — inventarizatsiya (A-02'da arcade keyframes o'chirilgan — qayta tekshir).
05. Cast dizayn (style.md 24): fokus, katta tipografiya (projector), kuchli feedback, cheklangan energiya, accessibility-safe celebration.
06. Raqobat saboqlari (research_ui_cast 1): Kahoot energiyasi emas — Mentimeter/Genially professionalizm.
07. Baseline: `npm run typecheck` + `npm test`.
08. Security/data guard: hech narsa o'zgartirilmaydi (reja).
09. Unit test: existing smoke.
10. Integration/contract test: existing.
11. E2E/security test: workspace toza.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga G-00 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: reja tasdiqlanmasa.
16. Done condition: reja aniq, G-01 ready.
17. G-01 uchun: lobby — tayyor ekanini dalil bilan yoz.
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

## G-01 — Cast lobby (kod, qo'shilganlar, boshlash)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/game/enter.ejs` ni qayta tuzish (professional, arcade emas):
   - Projector lobby: "Sessiya kodi" (6 belgi, katta tip — `.t-display` 3-4rem, letter-spacing), `--color-action` (gold/gradient EMAS).
   - Qo'shilganlar: avatar'lar (initials) + soni ("12 ta qo'shildi") — jonli (socket).
   - [Boshlash] (host) — bitta primary; "Savollar soni" vaqt.
   - Sokin dekor: hech qanday glow/gleam (A-02).
03. Participant join (G-05'da to'liq): bu sahifa — kod kiritish (katta keyboard).
04. State: kod yaratilganda auto-scroll; yangi qo'shilgan — avatar animatsiya (120ms, no-preference).
05. Error: kod xato → inline "Bunday sessiya yo'q" (enum qoidasi — C-01); [Qayta].
06. Motion: 160-220ms; reduced-motion.
07. Security/data guard: kod session-scoped; PII minimal (avatar initials).
08. Unit test: lobby strukturasi (regex): kod, son, boshlash.
09. Integration/contract test: socket join → son o'zgaradi; boshlash.
10. E2E/security test: kod enum; XSS (ism); reduced-motion.
11. GREP-CHECK: `grep -rn "glow\|gleam\|confetti\|Righteous" views/game/enter.ejs` = 0.
12. A11y: kod katta, screen reader, kontrast (projector — yuqori kontrast).
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga G-01 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: arcade element qolsa.
18. Done condition: lobby professional, state'lar aniq.
19. G-02 uchun: projector — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
26. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## G-02 — Projector state'lar (savol, lock, reveal, natija)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/role/board.ejs` ni qayta tuzish (style.md 27 — projector field):
   - State-led (style.md 0): LOBBY → QUESTION → LOCK → REVEAL → RESULTS.
   - QUESTION: savol (katta tip — sinf oxiridan o'qiladi, ~2-3rem min), variantlar A/B/C/D (katta, kontrast, rang + shape/label — colorblind), timer (katta countdown ring/bar, top-right).
   - LOCK: "Javoblar qabul qilindi" — qisqa (300ms).
   - REVEAL: to'g'ri javob highlight (icon + color) + response mosaic (sinf signali — shaxsiy emas) + action'lar [Muhokama] [Qayta tushuntirish] [Keyingi] (style.md 41.5).
   - RESULTS: ballar (jamoa bo'lsa — jamoa), yakuniy; "Sinflar bo'yicha o'sish" (progress).
03. Readability: kontrast yuqori (projector kunduzi), font sans (Manrope — legibility), minimal element (bitta savol + variantlar + timer; dekor yo'q).
04. Response mosaic: sinf javob taqsimoti (dominant distractor — teacher-private emas, bu umumiy mosaic; tahlil teacher'da).
   - Vizual: bar/mosaic — colorblind-safe.
05. Motion (style.md 24): state o'tish 300-500ms (semantic); reveal'da to'g'ri javob highlight 300ms; celebration bir marta 500-900ms (G-06); reduced-motion qat'iy.
06. Device'da savol (Kahoot toggle — accessibility): `[Savol qurilmada]` — participant'larda ham savol (G-04).
07. Security/data guard: javoblar server; timer server; PII yo'q (projector'da ism emas — response aggregate).
08. Unit test: projector state'lar (regex): QUESTION/LOCK/REVEAL/RESULTS, timer, mosaic.
09. Integration/contract test: socket state o'tishlari; timer tugashi.
10. E2E/security test: state race; XSS (savol); mosaic PII yo'q.
11. GREP-CHECK: `grep -rn "optShimmer\|optSweep\|gleam\|glow\|confetti" views/role/board.ejs` = 0.
12. A11y: screen reader state, contrast 7:1 (projector), keyboard host.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga G-02 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: arcade element yoki state race bo'lsa.
18. Done condition: projector state'lar to'liq, readability.
19. G-03 uchun: participant — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## G-03 — Participant (telefon — kod, javob, feedback)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Participant view (views/role/student.ejs / enter):
   - JOIN: kod (6 belgi, katta keyboard) → ism (qisqa, 20 belgi) → LOBBY ("Qo'shildingiz — kutamiz").
   - QUESTION: variantlar (A/B/C/D, katta touch 44px+, full-width, rang + shape — colorblind); savol device'da (agar G-02 toggle).
   - ANSWERED: "Javobingiz qabul qilindi" (sokin, icon) — qayta o'zgartirish yo'q (server).
   - REVEAL: to'g'ri/noto'g'ri (shaxsiy, sokin — check/x + color, icon+text).
   - RESULTS: shaxsiy ball/foiz; jamoa bo'lsa jamoa o'rni (public individual leaderboard — teacher nazoratida, qoida 26).
03. Accessibility: screen reader state'lar (aria-live), read-aloud (ixtiyoriy), variant rang+belgi, reduced-motion, 44px, 16px.
04. Motion: feedback 160ms; reveal 240ms; reduced-motion.
05. Offline/reconnect: WebSocket reconnect — state yig'iladi; banner "Ulanish tiklandi".
06. Security/data guard: ism sanitize (XSS), kod session; javob server; PII minimal.
07. Unit test: participant flow (regex): kod, ism, variant, feedback.
08. Integration/contract test: socket join→answer→reveal→results.
09. E2E/security test: XSS (ism); qayta javob blok; reconnect; PII yo'q.
10. GREP-CHECK: `grep -rn "answer_key\|correct.*value" views/role/student.ejs` = 0.
11. A11y: 44px, aria-live, contrast, read-aloud hook.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga G-03 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: answer client'da yoki PII bo'lsa.
17. Done condition: participant to'liq, accessible.
18. G-04 uchun: host — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## G-04 — Host (o'qituvchi boshqaruv paneli)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Host view (views/game/host.ejs) — professional boshqaruv:
   - Lobby: kod, qo'shilganlar, [Boshlash], [Sozlamalar].
   - Jonli: hozirgi savol (kichik preview), javoblar soni, timer nazorati:
     [Pauza] [Savolni yopish] [Muhokama] [Keyingi] — bitta asosiy action har state'da.
   - Teacher-private stats (style.md 41.5): har savol — to'g'ri %, dominant distractor, sinf signali (projector'da ko'rsatilmaydi).
   - Natija: har savol tahlili; [Yakunlash] → class summary.
03. Keyboard: Space (boshlash/pauza), arrows (keyingi) — tez boshqaruv (density).
04. Tekshirish: "Javoblar 20/30" — jonli; kutish state'da [Yopish].
05. Error state: talaba uzilgan — reconnect avtomatik; tarmoq — banner.
06. Motion: state 160-220ms; reduced-motion.
07. Security/data guard: host faqat teacher/owner (socket auth); stats server; PII yo'q.
08. Unit test: host control'lar (regex): boshlash, pauza, yopish, muhokama, keyingi, stats.
09. Integration/contract test: host socket → projector/participant state sync.
10. E2E/security test: not-owner blok; XSS; stats PII yo'q.
11. GREP-CHECK: `grep -rn "Righteous\|gleam\|glow\|confetti" views/game/host.ejs` = 0.
12. A11y: keyboard, focus, contrast.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga G-04 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: host owner tekshiruvi yo'q bo'lsa.
18. Done condition: host to'liq, bitta-action, stats private.
19. G-05 uchun: gamification/celebration — tayyor.
20. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
21. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
22. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
23. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
24. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
25. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## G-05 — Gamification balance va celebration (mature)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Gamifikatsiya (research_ui_user 2.2 + research_ui_cast 5):
   - Ballar BOR, lekin: public reyting — teacher nazoratida (qoida 26); jamoa-based afzal (studypulse: team leaderboard — shared purpose).
   - Overjustification qarshi: ball yagona motivator emas — savol sifati/feedback asosiy.
   - Barqaror ball: speed penalty kam (Kahoot xatosi: "one mistake drops you" — reddit teaching) — sinf o'sishi ko'rsatiladi.
03. Celebration (style.md 6.2, 24): accessibility-safe:
   - To'g'ri javob daqiqasi: 500-900ms **bir marta** (no-preference'da); confetti emas — sokin check + progress (controlled spring faqat achievement badge/avatar once).
   - `prefers-reduced-motion: reduce` — statik (check icon).
04. Progress: "Sinflar bo'yicha o'sish" — o'yin davomida (mosaic/progress bar), ball emas.
05. Achievement: private (Kyewski: private > public); jamoa achievement — class-wide (studypulse: "Can we collectively answer 500 questions?").
06. Security/data guard: ball server-authoritative (qoida 8); client emas.
07. Unit test: celebration reduced-motion'da yo'q (regex/emulate).
08. Integration/contract test: ball server → UI.
09. E2E/security test: ball forge emas (client o'zgartira olmaydi); celebration bir marta.
10. GREP-CHECK: `grep -rn "confetti\|infinite" views/role/board.ejs views/game/*.ejs` = 0.
11. A11y: celebration flashing emas (no >3Hz); reduced-motion.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga G-05 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: over-gamification yoki ball client bo'lsa.
17. Done condition: gamification mature, celebration safe.
18. G-06 uchun: cast perf — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## G-06 — Cast performance (Socket/INP — real-time yengil)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_tech_deep.md` 2.3 (INP) — Cast'ga qo'llash:
   - Socket handler'lar yengil: event payload minimal (faqat o'zgargan state — savol id, timer, response count); full state emas.
   - INP <200ms: click (javob/variant) → paint tez; long task yo'q; `scheduler.yield()` kerak bo'lsa.
   - Timer: server tick → client render (requestAnimationFrame yoki CSS animation — transform/opacity).
   - Mosaic: cheklangan node soni (DOM massiv emas; aggregate).
03. Reconnect: socket reconnect + state resync (idempotent event'lar — no duplicate).
04. Optimistic UI: javob tanlashda darhol visual (server confirm keyin) — lekin ball server.
05. Battery: mobile participant — animatsiya cheklangan, `content-visibility` (G-02/03).
06. Security/data guard: event auth (host faqat owner); payload'da PII yo'q; rate limit socket (C-01).
07. Unit test: event payload kichik (regex/assert).
08. Integration/contract test: INP o'lchov (Playwright + DevTools); reconnect resync.
09. E2E/security test: duplicate event yo'q; rate limit; XSS (socket data esc).
10. GREP-CHECK: `grep -rn "socket.emit.*full\|send.*state" views/ socket/` — payload yengil (agar katta bo'lsa tuzatish).
11. A11y: o'zgarmagan.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga G-06 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: INP >200ms yoki payload og'ir bo'lsa.
16. Done condition: cast real-time yengil, INP target.
17. G-07 uchun: cast mobile — tayyor.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
24. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
25. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
26. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
```

---

## G-07 — Cast mobile + a11y tekshiruv (katta sinf)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Mobile (participant):
   - 375px: variant full-width, 44px+, thumb zone; kod katta.
   - Projector (host device — planshet/laptop): viewport to'liq; timer ko'rinadi.
   - Device'da savol toggle (G-02): participant telefonida savol (katta sinf — Kahoot pattern; read-aloud).
03. Katta sinf (200+): 
   - Socket scale: join storm (D-19 load); lobby soni tez yangilanadi.
   - Mosaic: 200 javob → aggregate (bar), individual emas (privacy + perf).
04. A11y (katta sinf — FIDO/accessibility): screen reader, read-aloud (text-to-speech ixtiyoriy), variant rang+shape, reduced-motion, kontrast 7:1 projector.
05. Low-bandwidth (UZ qishloq — research_ui_style 5): yengil payload, WebP yo'q (text-only), CSS token bitta fayl.
06. Security/data guard: katta sinf'da PII (ism) minimal; kod session.
07. Unit test: 375px participant; 200+ simulyatsiya (load).
08. Integration/contract test: katta sinf join (load test — D-19).
09. E2E/security test: screen reader spot; XSS; reconnect.
10. GREP-CHECK: `grep -rn "font-size:.*1[0-5]px" views/role/student.ejs` = 0.
11. A11y: 44px, contrast, read-aloud.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga G-07 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: katta sinf'da qotish yoki a11y fail bo'lsa.
17. Done condition: cast mobile + katta sinf + a11y to'liq.
18. G-08 (checkpoint) uchun: tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## G-08 — CAST checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. G-faza qabul testlari:
   - Lobby: kod professional, son, boshlash; arcade yo'q.
   - Projector: state'lar (LOBBY/QUESTION/LOCK/REVEAL/RESULTS), katta tip, timer, mosaic, Discuss/Reteach/Next, readability.
   - Participant: kod→ism→variant→feedback; accessible; answer client'da emas.
   - Host: bitta-action, teacher-private stats, keyboard, owner auth.
   - Gamification: mature, jamoa-based, celebration bir marta safe, ball server.
   - Perf: INP<200, payload yengil, reconnect resync.
   - Mobile: 375px, 44px, katta sinf, a11y.
03. Full regression: `npm run typecheck` + `npm test` (socket/cast testlar).
04. GREP-CHECK jadvali (G bo'yicha): glow/gleam/confetti/optShimmer/Righteous/answer_key — 0.
05. A11y: axe 0 (cast); keyboard host; reduced-motion; contrast 7:1 projector.
06. i18n: uz to'liq; 4 til H fazada.
07. Visual: cast professional (Mentimeter/Genially benchmark — arcade EMAS) light/dark.
08. Sign-off: operator checklist (G-faza yopiladi).
09. Security/data guard: critical yashirilmaydi; server-authoritative.
10. Har yangi write path uchun tenant scope, authorization, validation tekshir.
11. Unit test: full G.
12. Integration/contract test: cast journey (host→projector→participant→results).
13. E2E/security test: full G E2E + axe + load + XSS.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga G-08 (CHECKPOINT) statusi, dalillar, sign-off yoz.
16. Global report formatida qaytar.
17. Stop condition: birorta qabul testi fail bo'lsa.
18. Done condition: Cast to'liq, professional, accessible.
19. Qolgan ishlar: H (Admin/QA — i18n, a11y audit, perf, final) — ko'chirilganini yoz.
20. Butun FAZA G yakunlandi — H-00 preflight'ga tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

