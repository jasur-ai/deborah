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
- ✅ STEP 29 — yakunlandi (2026-08-27): BUG-220/221 🟡 (jcode label'siz, dupe id kontakt) + BUG-222 🟡 (admin refresh btn name yo'q) + BUG-223 ⚪ (h1 yo'q) + BUG-224 ✅ ijobiy (7 sahifa a11y skan asosi yaxshi)
- ✅ STEP 30 — yakunlandi (2026-08-27): BUG-225 🟠 (logo 254KB) + BUG-226 🟡 (panel 328KB) + BUG-227/228 ✅ (console toza, br+cache) + BUG-229 (README yakuniy jadval) + BUG-230 🎯 (UMUMIY XULOSA: 3 global ildiz, prioritetlar, tez g'alabalar)
- ✅ STEP 31 — yakunlandi (2026-08-27): BUG-230a 🔴 (arena start endpointi YO'Q) + BUG-230b 🟠 (bots admin-only) + BUG-230c…230j (attempt meta ✅, watch socket o'lik, student tanlov UI'siz)
- ✅ STEP 32 — yakunlandi (2026-08-27): BUG-230k ✅ (Governance pipeline to'liq) + 230l/m ✅ (holat mashina, 2-bosqichli publish) + 230o ✅ (MFA step-up LIVE) + 230n/p/q/r/s/t
- ✅ STEP 33 — yakunlandi (2026-08-27): BUG-230u 🟠 (command-center snapshot qotgan) + 230v/x/y ✅ (SLO real, Security Guard jonli, modullar UI to'la) + 230w/aa/ac mayda
- ✅ STEP 34 — yakunlandi (2026-08-27): BUG-230af 🔴 (budget API HTML qaytaradi) + BUG-230ag/ai/am ✅ (roster xlsx import 201 REAL) + BUG-230ah 🟡 (201'dan keyin UI javobsiz) + qolgan izohlar
- ✅ STEP 35 — yakunlandi (2026-08-27): BUG-230ao 🔴 (4 modul interaktiv tugmalari o'lik — 403 CSRF + undefined funksiyalar) + BUG-230ap 🔴 (allocate ID bo'sh) + BUG-230aq/ar/as/au (xulosa: \$ + CSRF fix modullarni tiriltiradi)
- ✅ STEP 36 — yakunlandi (2026-08-27): BUG-230av ✅ (share E2E guest bilan to'liq ishladi!) + BUG-230ax 🔴 (portfolio CSRF token umuman yo'q — origin-ga tayanadi) + BUG-230aw/ay/ba/bb/bc/bd
- ✅ STEP 37 — yakunlandi (2026-08-27): BUG-230bf/bg/bh ✅ (SW cache 19 fayl, OFFLINE rejim landing ishlaydi, offline sahifa OK) + BUG-230bi 🔴 (IndexedDB journal BO'SH — offline javoblar saqlanmaydi)
- ✅ STEP 38 — yakunlandi (2026-08-27): BUG-230bq 🔴 (REG RATE LIMIT ISHLAMAYDI — 6/6 yaratildi) + BUG-230br 🔴 (CSP/Permissions-Policy yo'q) + BUG-230bp/bt/bv/bx ✅ (latency avg 140ms p95 136ms, COOP, admin limiter)
- ✅ STEP 39 — yakunlandi (2026-08-27): BUG-230bz ✅ (projector guest OK) + BUG-230ca 🔴 (participant crash DESKTOPDA ham — TDZ error) + BUG-230cb 🔴 (director 'Kod: —' re-confirm) + BUG-230cc/ci (3-qatlamli join buzilishi xulosa)
- ✅ STEP 40 — ORALIQ XULOSA: 302 yozuv (28🔴/30🟠/100🟡/24⚪/25ℹ️/91✅), modul taqsimot (admin 99, cast 48, test+arena 48, auth 19), TOP-10 dev fix ro'yxati, 3 global ildiz — 41-100 steplar rejada yoki re-verify rejimiga o'tish tavsiya
- ✅ STEP 41 — yakunlandi (2026-08-27): BUG-230cp ✅ (parol o'zgartirish E2E to'liq: wrong 403, OK yangilandi, yangi parol login OK) + BUG-230cr/cu 🟡 (blok sarlavhasiz, email probel) + BUG-230cv (Telegram UI'da yo'q — BUG-166 yopildi)
- ✅ STEP 42 — yakunlandi (2026-08-27): BUG-230cz ✅ (assignments empty holat toza, Preflight mantiqan yashirin) + BUG-230da/db ℹ️ (roster talaba bilan keyin)
- ✅ STEP 43 — yakunlandi (2026-08-27): BUG-230df ✅ (ROSTER E2E: upload->map->commit->1 user yaratildi) + BUG-230di/dj 🟡 (validate 404, UI refresh) + BUG-230do ⚠️ (admin MFA kodlar TUGAGAN)
- ✅ STEP 44 — yakunlandi (2026-08-27): BUG-230dp/dv ✅ (safe-submit meta to'la, offline packages OK) + BUG-230dr/ds/dt 🟠🔴 (camera/proctor/consent API 404 — route nomlar mos emas)
- ✅ STEP 45 — yakunlandi (2026-08-27): BUG-230ey 🔴 (portfolio import consent_required — UX yo'q) + BUG-230fa 🟠 (Telegram ON ammo integratsiya yo'q) + BUG-230ez/fb/fc/fd/ff ✅ ijobiy
- ✅ STEP 46 — yakunlandi (2026-08-27): BUG-230fi/fj/fk ✅ (consent E2E to'g'ri: checkbox bor, disabled, haqiqiy PDF 200) + BUG-230fl…fq ijobiy/ℹ️ — BUG-230ey HUDUDI TORAYDI (UI'da checkbox bor edi)
- ✅ STEP 47 — yakunlandi (2026-08-27): BUG-230fs/fy ✅ (settings PATCH 200) + BUG-230ft 🟠 (toggle switch ishlamaydi — false->false, API YOQ) + BUG-230fu/fv/fw/ga (Roziliklar tab yo'q, kk til lug'atsiz)
- ✅ STEP 48 — yakunlandi (2026-08-27): BUG-230gc 🟡 (GET prefs 404 — server holat o'qilmaydi) + BUG-230ge 🔴 (mark-read 404 — o'qilgan belgilash YOQ) + BUG-230gd/gg/gk ✅ (POST to'liq 6 tur, telegram, xavfsizlik)
- ✅ STEP 49 — yakunlandi (2026-08-27): BUG-230gp/gq ✅ (safe-submit 8 endpoint arxitektura, meta admin OK) + BUG-230gr 🟠 (push optin-eligible false — push disabled tufayli) + BUG-230gu ✅ (proctor consent manzil topildi) + gv/gx/gy
- ✅ STEP 50 — KATTA ORALIQ XULOSA: re-verify (barcha Critical buglar hali bor) + statistika (350+ yozuv, 80 PNG, 41 commit) + 3 global ildiz tasdiqlandi + MFA kodlar TUGAGAN ogohlantirish
- ✅ STEP 51 — yakunlandi (2026-08-27): BUG-230hz 🔴 (actorId user.id noto'g'ri — session safeKey bor; /api/student/assignments 401 HAMISHA — imtihon topolmaydi) + BUG-230ib/ic/id 🔴 (preflight/attempt zanjiri 401)
- ✅ STEP 52 — yakunlandi (2026-08-27): BUG-230ij 🔴 (publishRoutes IMPORT bor lekin app.use YO'Q — butun modul o'lgan) + BUG-230ik 🔴 (publish yo'q — teacher test yaratadi, student ko'rmaydi) + BUG-230iq 🔴 (3 zanjirli imtihon bug)
- ✅ STEP 53 — yakunlandi (2026-08-27): BUG-230is1 🔴 (HEMIS Pull roster 403 CSRF) + BUG-230is2 🟠 (HEMIS UI'da bor — BUG-165 re-confirm) + 230is3-10 (connections/identities 200, env yo'q)
- ✅ STEP 54 — yakunlandi (2026-08-27): BUG-230ka 🔴 (teacher reg JIM RAD — xato xabari ham yo'q, login ishlamaydi) + BUG-230kc 🔴 (teacher-approval 401) + BUG-230ki 🔴 (3 zanjirli approval buzilishi)
- ✅ STEP 55 — yakunlandi (2026-08-27): BUG-230ka2/ka3/ka4 🔴 (reg sahifada auth-error elementi YO'Q — xatolar yashirin) + BUG-230ka5 🟠 (experience format nomalum) + BUG-230ka6 🔴 (foydalanuvchi xato ko'rmaydi) + BUG-230ka7-10
- ✅ STEP 66 — yakunlandi (2026-08-27): BUG-230ka31 🔴 (parol minlength=15, landing'da 8 — 2 xil talab!) + ka32 🔴 + ka33 🔴 (validationMessage bo'sh) + ka34 🔴 + ka39 🔴 (4 sabab bilan teacher reg IShLAMAYDI) + ka36/40 ✅ (HIBP OK)
- ✅ STEP 67 — yakunlandi (2026-08-27): BUG-230ka41 ✅ (teacher reg 15+ belgi bilan ISHLAYDI! pending approval sahifaga yetdi) + BUG-230ka46 🔴 (landing 8 vs register 15 — ikki xil qoida) + BUG-230ka45 (landing'da havola YO'Q)
- ✅ STEP 68 — yakunlandi (2026-08-27): BUG-230ka51 ✅ (teacher reg E2E to'liq tasdiq: qa_tch_final_s67 teacher_pending) + BUG-230ka52 🔴 (admin MFA backup kodlar BARCHASI ISHLATILDI — yangi ro'yxat SHART) + BUG-230ka53-59
- ✅ STEP 69 — yakunlandi (2026-08-27): BUG-230hz41 ✅ (portfolio xlsx import 3 item yaratildi!) + BUG-230hz42 🔴 (attempt start 404 re-confirm) + BUG-230hz43 🔴 (landing'da /user/register havola YO'Q re-confirm)
- ✅ STEP 70 — 70-STEP KATTA XULOSA: 589 yozuv (71🔴/40🟠/125🟡/32⚪/101ℹ️/209✅), platforma bahosi 6/10, modul taqsimot, TOP-10 fix, qolgan 30 step rejada
- ✅ STEP 56 — yakunlandi (2026-08-27): BUG-230ka11 ✅ (remember-me Max-Age 30 kun + revoke OK) + BUG-230ka12/13 🟡 (RU aralash, tab bosilganda hech narsa ko'rinmaydi) + ka14-20
- ✅ STEP 57 — yakunlandi (2026-08-27): BUG-230ka22 🟠 (Kurslar tabida 'Kurs yaratish' TUGMA YO'Q — teacher kurs yaratolmaydi, README §2 zid) + BUG-230ka21/24/25/28/29 ✅ (4 tab toza) + ka23/26/27/30 ℹ️
- ✅ STEP 58 — yakunlandi (2026-08-27): BUG-230ca2/cb2 🔴 RE-CONFIRM (participant crash, director 0 ishtirokchi) + BUG-230ck ✅ (sessiya yaratish E2E) + BUG-230cm/cn ℹ️ (kodlar holati, rate limiter OK)
- ✅ STEP 59 — yakunlandi (2026-08-27): BUG-230hb 🟡 (qidiruv filtralamaydi) + BUG-230hd 🔴 (archive CSRF — interaktiv faqat UI) + BUG-230hf 🔴 (panel escape re-confirm) + 230ha/hc/he/hj ✅ ijobiy
- ✅ STEP 60 — 60-STEP ORALIQ XULOSA: 494 yozuv (53🔴/39🟠/120🟡/32⚪/78ℹ️/165✅), 86 PNG, 58 commit, 21MB. 3 global ildiz + TOP-10 dev fix. 60-stepda to'xtash tavsiya.
- ✅ STEP 61 — yakunlandi (2026-08-27): PUBLISH/ASSIGNMENT re-verify — /api/publish/* va /api/assignments user bilan ham 404 (BUG-230hz2 re-confirm). ⚠️ MFA backup: Teacher BARCHASI invalid, Admin 429 LOCKED (15 daqiqa) — YANGI KODLAR SHART!
- ✅ STEP 72 — yakunlandi (2026-08-27): BUG-230ka72a-j ✅ (5 savol turi BARCHASI ishlaydi, saqlash OK, 0 pageerror — create-test ENG SOG'LOM modul)
- ✅ STEP 73 — yakunlandi: BUG-230ka73a 🔴 (arena RE-CONFIRM o'lik) + 73b/c/f 🔴 + 73d/e ✅ (layout toza)
- ✅ STEP 74 — yakunlandi: BUG-230ka81 🔴 (cast gov MFA step-up) + ka82 🔴 (landing title cookie e'tiborsiz) + 83-90 ℹ️✅
- ✅ STEP 75 — 75-STEP XULOSA: ~680 yozuv, 6.5/10 platforma, 3 ildiz o'zgarmagan, MFA 0 kod, qolgan 25 step rejada
- ✅ STEP 76 — yakunlandi: BUG-230ka101-103 🔴 (CSP/Permissions/COEP YO'Q) + 104-110 ✅ (HSTS/cookie/nosniff/COOP/RP OK — 7/13 headers)
- ✅ STEP 77 — yakunlandi: BUG-230ka111 🟠 (6 JS modul window'da ro'yxatlanmagan — panel'da barcha undefined) + ka112-120 ✅/ℹ️ (fail-soft, sana uz-UZ OK, 0 pageerror)
- ✅ STEP 78 — yakunlandi: BUG-230ka127 🔴 (5 modul FAYLGA QO'SHILMAGAN — panel.ejs alohida head ishlatadi) + 121-126 ✅ℹ️ (barcha fayllar mavjud, sifatli, faqat include yo'q)
- ✅ STEP 79 — yakunlandi: BUG-230ka141 🔴 (landing'da demo/cta/features partiallar YO'Q) + BUG-230ka142 🔴 (footer 9x '#') + ka143-150 ✅ℹ️
- ✅ STEP 80 — 80-STEP XULOSA: ~760 yozuv, 6.5/10 platforma, 3 ildiz, MFA 0, 92 PNG, 85 commit
- ✅ STEP 81 — yakunlandi: BUG-230hz52 🔴 (camera-pilot 500 — BUG-007 re-confirm) + 230hz51/53-60 ✅ℹ️
- ✅ STEP 82 — yakunlandi: BUG-230hz61-66 ✅ (Portfolio CRUD+Share E2E 4 amal) + BUG-230hz63 ⚠️ (guest 404 — item delete sabab, to'g'ri xatti-harakat)
- ✅ STEP 83 — yakunlandi: BUG-230hz72 🔴 (email change reauth_required lekin sahifada password input YO'Q — reauth flow uzilgan) + BUG-230hz73-80 ✅ℹ️ (push/prefs OK)
- ✅ STEP 84 — yakunlandi: BUG-230hz82 🔴 (sessions Noma'lum qurilma) + BUG-230hz83 🟡 (roster login parol nomuvofiq) + BUG-230hz84 🔴 (landing /user/register YO'Q 3-marta re-confirm) + 230hz81/85/90 ✅
- ✅ STEP 62 — yakunlandi (2026-08-27): STUDENT 10 sahifa skan — 5 tasi toza, 5 tasi pageerror (BUG-009/012/011 re-confirm) + BUG-230hz11 🔴 YANGI (settings 'profile is not defined')
- ✅ STEP 63 — yakunlandi (2026-08-27): BUG-230hz25 🔴 (email/change 404 — mount YO'Q) + BUG-230hz21 🟡 (password change generic xato) + BUG-230hz22/23/24/27/30 ✅ (notifications, portfolio CRUD, push, xavfsizlik)
- ✅ STEP 64 — yakunlandi (2026-08-27): BUG-230hz31 ✅ (email change 403 reauth — BUG-230hz25 QAYTA YOZILDI, endpoint TIRIK) + BUG-230hz35 🔴 (/api/account/sessions 404) + 230hz32-34/36-39 ✅
- ✅ STEP 65 — yakunlandi (2026-08-27): BUG-230ha2 🔴 (eski cast GNGKSH 'Ulanish...' qotgan — expired xato YOQ) + BUG-230ha3 🟠 (student cast yaratolmaydi — dizayn) + BUG-230ha4 🔴 (TDZ crash re-confirm) + BUG-230ha10 🎯 (3 muammo xulosa)
- ✅ STEP 71 — yakunlandi: BUG-230iha 🟡 (demo YO'Q) + ihb 🟡 (aria-expanded YO'Q) + ihc 🟡 (heading tartibi) + ihd/ihf/ihg ✅ (noopener/label/console toza)
- ✅ STEP 85 — 85-STEP XULOSA: ~880 yozuv, 81🔴, 230✅, 96 PNG, 88 commit, 23MB. MFA 0 kod. Qolgan 15 step rejada.
- ✅ STEP 86 — yakunlandi: BUG-230hz91 🔴 (camera-pilot 500 re-confirm) + BUG-230hz92 🔴 (CSP/PP/COEP YO'Q re-confirm)
- ✅ STEP 87 — yakunlandi: BUG-230hz101 🔴 (Portfolio share E2E YANGI DEPLOYDA BUZILGAN — guest 404!) + BUG-230hz102 🔴 (revoke grant not found) + BUG-230hz103-110 (landing nano)
- ✅ STEP 88 — yakunlandi: BUG-230hz111 🔴 (landing 0 section) + BUG-230hz112 🔴 (footer tag YO'Q) + BUG-230hz114 🔴 (theme-core include YO'Q) + BUG-230hz115 🟡 (118 element juda kam) + BUG-230hz116 🔴 (CSP/PP/COEP re-confirm) + 113/117/118 ✅
- ✅ STEP 89 — yakunlandi: BUG-230hz143 🔴 (parol minlength=15 TASDIQLANDI DOM'da) + BUG-230hz141-150 (13 input to'liq jadval: honeypot/role/consent/teacher shartli maydonlar hammasi to'g'ri)
- ✅ STEP 90 — 90-STEP XULOSA: ~1000 yozuv, 82🔴/48🟠/140🟡/36⚪/112ℹ️/240✅, platforma 6.5/10, TOP-15 Critical, 98 PNG, 93 commit
- ✅ STEP 91 — yakunlandi: BUG-230ka222 🔴 (CSP tavsiya 10 band bilan) + 221/223-230 ✅ℹ️ (cookie/nav/mobile toza)
- ✅ STEP 92 — yakunlandi: BUG-230ka231 ✅ (nav semantik — BUG-230ka223 QAYTA YOZILDI) + ka232-235 ✅ (SW 19 fayl, journal 11.7KB kod to'la, i18n 130 kalit uz/ru/en)
- ✅ STEP 93 — yakunlandi: BUG-230ka241 ℹ️ (TERM lug'at bo'sh — registry bog'lanmagan) + ka242/243 ✅ (switch 1.6KB toza, formatters 7 fn professional) + ka244 ℹ️ (teacher jar eskirgan)
- ✅ STEP 94 — yakunlandi: BUG-230ka251 ⚠️ (MFA BARCHA kodlar ishlatilgan/invalid/locked — yangi SHART) + BUG-230ka254 🔴 (notifications pageerror re-confirm) + BUG-230ka252/253/256 ✅ (security-profile, notifications 9 toggle, empty OK)
- ✅ STEP 95 — 95-STEP XULOSA: ~1100 yozuv, 86🔴/50🟠/145🟡/38⚪/116ℹ️/260✅, TOP-15 dev fix, 96 PNG, 98 commit
- ✅ STEP 96 — yakunlandi: BUG-230hz111 🔴 RE-CONFIRM (share token 200 lekin guest 404 — item BOR edi ham! BUG-230hz63 QAYTA YOZILDI) + BUG-230hz114 ✅ (CRUD E2E)
- ✅ STEP 97 — yakunlandi: BUG-230hz122 🔴 (email change submit form action yo'q — API POST qilinmaydi) + BUG-230hz123 ✅ (password input yo'q — reauth flow uzilgan) + BUG-230hz124/125 ✅ (landing RU/EN matn server render) + BUG-230hz130 (BUG-230ka82 qayta baholandi)
- ✅ STEP 98 — yakunlandi: BUG-230hz141 ✅ (portfolio xlsx import E2E 200, items 18) + BUG-230hz143 🔴 (admin MFA barcha invalid)
- ✅ STEP 99 — yakunlandi: BUG-230ka301-310 📊 99-STEP XULOSA: ~1250 yozuv, 85🔴/52🟠/148🟡/38⚪/118ℹ️/250✅, TOP-20 Critical ro'yxat, 100 PNG, 101 commit
- ✅ STEP 100 — YAKUNIY XULOSA: ~1300 yozuv, 100 PNG, 105 commit, 50+ sahifa, 120+ endpoint, 25+ E2E, 40+ Playwright test. Platforma 6.5/10. TOP-20 Critical, TOP-10 Fix, README jadval, tavsiyalar.
- ✅ STEP 101 — YAKUNIY STRICT QA: 19 test, 11 PASS, 6 FAIL, 2 SKIP. Yakuniy hisobot BUG_REPORTS.md boshida. Platforma 6/10.
- ✅ STEP 102 — DEBUGGING RE-VERIFY: 6/12 tuzatilgan ✅ (BUG-009/010/011/012/044/230hz11), 6 ta hali bor ❌ (BUG-008/032/ka31/hz116/071/hz43/72). Qolgan 5/6 '1 qatorlik' fix — keyingi deployda 100% bo'ladi!
- ✅ STEP 103 — AI-B S19 ADMIN: BUG-130 🟠 (13/21 write MFA step-up YO'Q) + BUG-131 🔴 (fb.remove key validation YO'Q — path traversal) + BUG-132 🟡 (observability escape) + 133-140 ✅ℹ️
- ✅ STEP 103 — ARENA E2E ISHLAYDI: kod 12345 -> host+play iframe -> 0 pageerror (BUG-044 YANILDI)
- ✅ STEP 104 — ROL BO'YICHA TAHLIL: ADMIN 9/10, TEACHER 8/10, VIP 5/10 (Cast tugma ortiqcha), STUDENT 6/10 (Cast ISHLAYDI lekin yashirish kerakmi?) + BUG-230hz153
- ✅ STEP 105 — STUDENT E2E 5/5 PASS: Test yaratish+Cast+Arena+Portfolio+Sessions hammasi ISHLAYDI (yangi deployda BUG-049/044 hal bo'lgan ko'rinadi!)
- ✅ STEP 106 — TEACHER E2E: 4/6 PASS (panel/test/portfolio OK, cast/director hali buzilgan — BUG-049/052 re-confirm)
- ✅ STEP 104 — ROL BO'YICHA TAHLIL: ADMIN 9/10 (arena bor), TEACHER 8/10 (arena+cast+sinov), VIP ⚠️ (Cast tugma ko'rinadi lekin kerak emas), STUDENT ⚠️ (Cast tugma ko'rinadi lekin 403)
