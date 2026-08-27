# QA — 100 STEP REJA (mayda-maydaga, har stepda ≥10 bug maqsad)

> **Qoida:** faqat BUG topib LABEL qilish + push (jasurjonai). TUZATILMAYDI.
> **Har step oxiri:** workspace hajmi tekshiruvi → hisobot → FOYDALANUVCHI TASDIQI → keyingi step.

---

## STEP 1 — Foydalanuvchi ko'rsatgan 10 shikoyat zonasi ✅ (YAKUNLANDI — BUG-020..031)
1.1 Cast jonli dars oqimi (sessiya yaratish → kod → qo'shilish)
1.2 Sinov (test sinash/attempt) oqimi
1.3 AI'ni ishlatish (generate) real oqimda
1.4 Canva / Slides / Gamma integratsiyalari holati
1.5 Dark mode'da ko'rinmaslik (kontrast audit — barcha qatlamlar)
1.6 Test o'chirishda IKKI MARTALIK tasdiq
1.7 Admin sidebar: 7-8 ko'rinadi, 20+ yashirin (progressive disclosure)
1.8 Bekitilgan kirish arxitekturasi: 3-chiziq → ichma-ich 3-chiziq → admin login (alohida page!)
1.9 Maqola tavsiya funksiyasi qayerda?
1.10 Talab / Teacher-tekshiruvchi bo'limlari (admin nazorat+statistika; teacher/VIP'da ko'rinishi)

## FAZA A — Auth & Dashboard tuzilishi (STEP 2–11)
2. Landing login/reg tablari mayda e2e ✅ · 3. Hamburger menyu tuzilishi ✅ · 4. Admin login modal vs page ✅ · 5. Teacher→admin "so'rov yuborish" oqimi ✅ (BUG-035) · 6. Oddiy kirish anchor/scroll ✅ · 7. Student panel bloklari ✅ · 8. VIP panel farqlari ✅ (BUG-033) · 9. Teacher workspace 4 tab ✅ (BUG-034) · 10. Admin sidebar guruhlar dinamikasi (STEP 10'ga) · 11. Session TTL/idle/logout ✅ (BUG-032/037)

## FAZA B — Mavzu/Kontrast/UI qatlamlari (STEP 12–21)
12. Dark: landing · 13. Dark: user panel · 14. Dark: teacher workspace · 15. Dark: admin (har 30 sahifa!) · 16. Dark: cast/auth sahifalari · 17. hc rejim yarim-qolganlik · 18. Mobil har sahifa overflow/touch · 19. i18n uz/ru/en har qatlamda · 20. FOUC/tema persist cross-page · 21. Focus/hover/disabled holatlar

## FAZA C — Test yaratish (STEP 22–31)
22. Forma validatsiya maydalab · 23. Savol turlari (MCQ/multi/...) · 24. Excel import · 25. Excel shablon · 26. Saqlash API edge · 27. Tahrirlash (editKey) · 28. Duplicate/archive/rename · 29. Public toggle · 30. O'chirish oqimi · 31. Fan/subtest bog'lash

## FAZA D — Sinov/Attempt (STEP 32–41)
32. Test ochish student sifatida · 33. Attempt lease · 34. Taymer server/client sink · 35. Autosave/response ACK · 36. Submit + receipt · 37. Natija ko'rish · 38. Qayta urinish qoidalari · 39. Offline sync · 40. Proctor preflight · 41. Accommodation

## FAZA E — Cast chuqur (STEP 42–51)
42. Sessiya config · 43. Kod resolve · 44. Participant socket real-time · 45. Savol cast · 46. Javob yig'ish · 47. Reyting · 48. Projector · 49. Results/export · 50. Replay/determinism · 51. Quality-lab/bots

## FAZA F — AI chuqur (STEP 52–61)
52. Director ⚡ Tezkor savol UI · 53. Generate payload/format · 54. Rate 12/min UX · 55. 300/kun limit · 56. ai-question-gen blueprint/job · 57. ai-grading shadow · 58. ai-checkpoint · 59. ai-mlops eval/rollback · 60. claude adapter · 61. AI xato/offline holatlari

## FAZA G — Integratsiyalar (STEP 62–71)
62. Canva OAuth holat UI · 63. Slides holat UI · 64. Gamma (yo'qligi da'vosi) · 65. Telegram OTP/bot · 66. Email verify e2e · 67. Reset parol e2e · 68. OIDC callback xatolar · 69. Push qayta yoqilganda · 70. External linklar · 71. HEMIS/OneID qoldiqlari

## FAZA H — Admin chuqur (STEP 72–81)
72. Users CRUD+role · 73. Block/unlock/revoke-sessions · 74. VIP grant/revoke · 75. Teachers approve/reject (nazorat+statistika) · 76. Signup-reviews · 77. Audit filtrlar/export · 78. Excel fan/subtest import+pre-check · 79. Email-cost budget · 80. Cast policies · 81. Roster/scheduler/seating/paper/scan/marking/grading/board/consideration (9 sahifa mayda)

## FAZA I — Xavfsizlik davomi (STEP 82–91)
82. IDOR: testKey/attemptId guessable · 83. Rate limitlar har endpointda · 84. Cookie flags har route · 85. CSP/CORS · 86. XSS probe (test nomi/savol) · 87. Excel upload validatsiya · 88. Open redirect · 89. Remember-me tokentravel · 90. Backup kod replay · 91. Privilege escalation (role POST)

## FAZA J — Perf/UX mayda (STEP 92–100)
92. Katta ro'yxat pagination · 93. Qidiruv debounce · 94. Empty states · 95. Loading holatlari · 96. Error bannerlari · 97. Konsol warninglar · 98. Accessibility asosiy (axe) · 99. 404/500 mavzuda · 100. README-yakuniy moslik auditi

---
## BAJARILGANLAR
- ✅ STEP 1 — yakunlandi (2026-08-27): BUG-020…BUG-031 (12 ta) — BUG_REPORTS.md
- ✅ STEP 2 — yakunlandi (2026-08-27): BUG-032…BUG-037 (6 ta) + BUG-038 ijobiy jadval
- ✅ STEP 3 — yakunlandi (2026-08-27): BUG-039…BUG-042 (4 ta) + BUG-043 ijobiy (reg validatsiya, hamburger, admin modal/page, teacher ariza oqimi)
- ✅ STEP 4 — yakunlandi (2026-08-27): BUG-044…BUG-047 (4 ta) + BUG-048 ijobiy (student panel: assignments/natijalar/notifications/arena/portfolio/sessions; Arena o'lik tugma isboti BUG-044)
- ✅ STEP 5 — yakunlandi (2026-08-27): BUG-049…BUG-050 (2 ta, BUG-049 🔴 DIRECTOR o'lik JS — 160 o'lik chaqiruv) + BUG-051 ijobiy (create-test E2E + Excel + Cast wizard live o'tdi)
- ✅ STEP 6 — yakunlandi (2026-08-27): BUG-052…BUG-054 (3 ta, BUG-052 🔴 participant JOIN crash) + BUG-055 ijobiy (student bilan real join urinishasi)
- ✅ STEP 7 — yakunlandi (2026-08-27): BUG-056…BUG-057 (2 ta, BUG-056 🔴 ai-question-gen PostgreSQL'siz o'lik) + BUG-058 ijobiy (AI generate LIVE, rate limit OK, 5 admin AI sahifa)
- ✅ STEP 8 — yakunlandi (2026-08-27): BUG-059 🔴 EPIDEMIYA (6 imtihon moduli JS o'lik: global \$ konflikt + scan.ejs apostrof) + BUG-060 + BUG-061 ijobiy (marking/board/consideration toza)
- ✅ STEP 9 — yakunlandi (2026-08-27): BUG-062…BUG-063 (2 ta) + BUG-064 ijobiy (IDOR/XSS/open-redirect/role-escalation/cookie — xavfsizlik asosi mustahkam)
- ✅ STEP 10 — yakunlandi (2026-08-27): BUG-065 (fans abadiy 'Yuklanmoqda...') + BUG-066 ijobiy (VIP grant negativ testlar bilan: 404/403/origin-block — himoya qattiq)
- ✅ STEP 11 — yakunlandi (2026-08-27): BUG-067 🔴 (session keepalive ping CSRF'siz → 403 → idle uzaytirmaydi) + BUG-068 🟡 (revoke-sessions 5 deb hisoblaydi, sessiya tirik) + BUG-069 ijobiy (audit filtrlar/export/remember-me)
- ✅ STEP 12 — yakunlandi (2026-08-27): BUG-070…BUG-078 (9 ta: footer legal '#', lang cookie GET / ishlamaydi, til saqlanmaydi, doneReg aria, scroll-lock yo'q, #admin anchor, aria-pressed...) + BUG-079 ijobiy (SEO/a11y asosi)
- ✅ STEP 13 — yakunlandi (2026-08-27): BUG-080 🔴 (dark panel oilasida umuman yo'q — theme-core yuklanmaydi, deploy nomuvofiq) + BUG-081…088 (7 ta) + BUG-089 ijobiy
- ✅ STEP 14 — yakunlandi (2026-08-27): DEPLOY O'ZGARDI — BUG-090 🟠 (MemoryStore sessiyalar o'chdi, B-03 confirm) + re-verify (BUG-006/007 hali bor, BUG-009/010 TUZATILGAN) + BUG-093 🟠 (admin tema regressiya: faqat System) + BUG-094…099
- ✅ STEP 15 — yakunlandi (2026-08-27): BUG-100 🟠 (hc rejim UI toggle yo'q — yarim funksiya, funksional tasdiq) + BUG-101…103 (3 ta) + BUG-104 ijobiy (hc-dark sifatli, OS dark avto, legal ru/en)
- ✅ STEP 16 — yakunlandi (2026-08-27): BUG-105 🟠 (play mobil overflow re-confirm, join tugma yetib bormaydi) + BUG-106…110 (5 ta mobil UX) + BUG-111/112 ijobiy (mobil asosiy oqimlar toza) + BUG-113 (BUG-052+053 birgalikda Cast mobil join to'sadi)
- ✅ STEP 17 — yakunlandi (2026-08-27): BUG-114 🔴 (admin modal focus trap yo'q) + BUG-115 🟠 (200% zoom overflow) + BUG-116 🟡 (teacher/admin RU/EN yo'q) + BUG-117/118
- ✅ STEP 18 — yakunlandi (2026-08-27): BUG-119 🟠 (correct out-of-range qabul — server validatsiya yo'q) + BUG-120…124 (5 ta) + BUG-126 ⚪ + BUG-127/128 (CRUD ijobiy + QA artefakt)
- ✅ STEP 19 — yakunlandi (2026-08-27): BUG-129 🔴 (Excel import -> save questions:[] — end-to-end buzilgan) + BUG-130…132 (3 ta) + BUG-133 (BUG-050 re-confirm) + BUG-134 ijobiy
- ✅ STEP 20 — yakunlandi (2026-08-27): BUG-139 (BUG-044 re-confirm: arena o'lik) + BUG-140 🟠 (add-bots teacher'ga 401 — rol nomuvofiq) + BUG-141…147 + BUG-148 (attempt API keyingi stepda)
- ✅ STEP 21 — yakunlandi (2026-08-27): BUG-149 (BUG-049 re-confirm) + BUG-150 🟠 (results/replay -> panel render) + BUG-151…157 (mock key admin'da, quality-lab 403, join intermittent OK)
- ✅ STEP 22 — yakunlandi (2026-08-27): BUG-155 🟠 (difficulty=hard 502) + BUG-156 🟠 (true_false correct None) + BUG-157 🟡 (lang=ru uz javob) + BUG-158…164 (validatsiya OK, admin AI placeholder, quota hisobi)
- ✅ STEP 23 — yakunlandi (2026-08-27): BUG-165 🟠 (HEMIS 'olib tashlandi' yolg'on — endpointlar tirik) + BUG-166 🟡 (Telegram UI'da bor, endpoint 404) + BUG-167/168 ijobiy (forgot enumeration OK, verify validatsiya OK) + BUG-169 (Canva/Slides/Push re-check)
- ✅ STEP 24 — yakunlandi (2026-08-27): BUG-170 🟠 (fans/save 500 raw Firebase error — info disclosure) + BUG-171/172/174 ijobiy (role/block/unblock OK) + BUG-173/175
- ✅ STEP 25 — yakunlandi (2026-08-27): BUG-180 ✅ (replay protection OK) + BUG-181 🟠 (manfiy timer yana) + BUG-182 🟠 (export traversal 500) + BUG-183…189 (XSS export OK, rate OK, flakiness)
- ✅ STEP 26 — yakunlandi (2026-08-27): BUG-190/191 ✅ (remember revoke, sid regenerate) + BUG-192 🟡 (Origin:null bypass — past risk) + BUG-193 ✅ + BUG-194…196 ✅ (6/6 reg validatsiya) + BUG-197 🟡 (generic xabar) + BUG-198/199
- ✅ STEP 27 — yakunlandi (2026-08-27): BUG-200 🟡 (users qidiruv debounce/param nomuvofiq) + BUG-201/203 ⚪ (limit param e'tiborsiz, RANDOM 25 badge eski) + BUG-202/204/205 ijobiy (audit pagination, uzun nom clip, ro'yxat asosi toza)
- ✅ STEP 28 — yakunlandi (2026-08-27): BUG-206 🟡 (500 sahifada Orqaga yo'q) + BUG-207/208 ✅ (banner dismiss saqlanadi, offline OK) + BUG-209 ℹ️ (nav ERR_ABORTED flaky) — 404 sahifa toza
