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
