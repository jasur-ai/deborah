# DEBUG STATUS — Deborah

> **Manba:** `workspace` branchidagi QA hisobotlari (qa/BUG_REPORTS.md, BUG-001…BUG-048, 2026-08-27)
> **Branch:** `debugging` (asos: `main` @ 6612193)
> **Qoida (2026-08-27 yangilandi):** STEP 6–30 oldindan tasdiqlandi — BIRMA-BIR, sifat bilan.
> Har STEP ≥7 bug (hisorotdagi + o'zim topgan verifikatsiyali topilmalar), verify (test/brauzer)
> → commit → keyingi STEP. PUSH har 5 STEPda (10/15/20/25/30 oxirida). main faqat yakunda.
> Har STEP yakunda session memory ko'rib chiqiladi (≤100 qator).

---

## STEP 1 — 🔴 Kritik frontend JS crash'lari ("sinov ishlamayapti" ildizi) — ✅ YAKUNLANDI
**Buglar:** BUG-009, BUG-010, BUG-012, BUG-044
**Qanday:**
- **BUG-009** — `window.__CSRF_TOKEN = <%= JSON.stringify(csrfToken) %>` `<%= %>` HTML-escape qiladi
  (`&#34;...&#34;`) → SyntaxError → butun script bloki o'ladi (panel.ejs:579'da `__RISK_COPY__`,
  `__ACCOUNT_COPY__` ham o'lgan). Fix: 3 faylda (`user/panel.ejs`, `user/mfa.ejs`,
  `user/create-test.ejs`) `<%=` → `<%-` (lohihadagi to'g'ri pattern — head.ejs, teachers.ejs shunday).
- **BUG-010** — `create-test.ejs:119` izohida literal `</script>` yozilgan → HTML parser scriptni
 ERTA yopadi → qolgan JS sahifa matni sifatida ko'rinadi. Fix: izohda `<\/script>` qilib yozish.
- **BUG-012 + BUG-044** — `main.js:6` global `const $` ↔ `test-arena.ejs:180` inline `const $`
  qayta deklaratsiya → butun arena script bloki SyntaxError → `loadArena`/`addBots` umuman
  tuzilmaydi → "Yuklash" tugmasi o'lik. Fix: arena inline'ida `$` → `$id` (rename, ~20 ta joy).
**Qo'shimcha topilmalar (shu stepda):**
- **YANGI #1** — `game/enter.ejs:334` `isAdmin` ta'riflanmagan → ReferenceError → /play auto-fill/rejoin
  o'lik edi. Fix: `endBtn.href = isAdmin ? '/' : '/'` (bema'ni ikki yo'l) → `'/'`.
- **YANGI #2** — `onboarding.ejs` 17 ta `<%= JSON.stringify` — shu klass, barchasi `<%-` qilindi.
  HTML atribut ichidagilar (login.ejs, observability.ejs) TO'G'RI — tegilmadi.
- **__TB_INIT** — create-test.ejs:123-125 (editKey/name/questions) ham shu kasallikda edi — tuzatildi.

**Verify (isbot):** EJS compile 6/6 ✓ · vitest 6 fayl 45/45 ✓ · Playwright 13/13 PASS
(panel: 3 global tirik; arena: loadArena/addBots=function; create-test: 'breakout' ko'rinmas;
/play: head+inline const \$ birga) — `scripts/repro-step1.mjs`.

## STEP 2 — 🟠 Auth/session backend buglari — ✅ YAKUNLANDI
**Buglar:** BUG-011, BUG-016, BUG-041
**Qanday:**
- **BUG-011** — `mfa-settings.js:119`: MFA o'chirilgan userda `enableBtn=null` → TypeError → IIFE
  o'ladi. Fix: element mavjudligini tekshirish (null-guard) yoki shartli init.
- **BUG-016** — `mfa-totp.js recordFailedAttempt`: eskirgan `lockoutUntil` (o'tgan timestamp)
  saqlanaveradi → lock tugagach birinchi xatoda `locked:true` + **manfiy** `retryAfterSeconds`
  (-2931s live dalil). Fix: `lockoutUntil <= now` bo'lsa 0 ga tushirish.
- **BUG-041** — `GET /user/teacher-approval` auth'siz 401 xom JSON qaytaradi. Fix: HTML login
  redirect (boshqa sahifalar kabi).
**Qilingan (aniq):**
- **BUG-011 — 2 qatlamli fix**: (a) security-profile.ejs'da `mfaAllowed` hoist — mfa-settings.js
  FAQAT teacher/admin'da yuklanadi (sabab: MFA kartasi role-shartli render, script esa shartsiz
  yuklanar, student'da barcha element ref'lari null → L119 TypeError → IIFE o'lgan);
  (b) mfa-settings.js IIFE boshiga `if (!card) return;` guard (defense-in-depth).
- **BUG-016**: recordFailedAttempt'da eskirgan `lockoutUntil` (o'tgan timestamp) saqlanib
  qolardi → lock tugagach birinchi xatoda `locked:true` + MANFIY retryAfterSeconds (-2931s).
  Fix: `prevLockout = lockoutUntil > now ? ... : 0` — faqat kelajakdagi qiymat saqlanadi.
  O'qish tomoni (isLockedOut) allaqachon to'g'ri edi — faqat yozish clamp qilindi.
- **BUG-041 — ILDIZ**: `req.accepts('json')` brauzer `Accept: */*` tufayli deyarli har doim true →
  sahifalar ham xom 401 JSON qaytarardi. Fix: `req.accepts(['html','json']) === 'json'` — 5 ta
  middleware'da (expireSessionResponse, requireAuth, requireEmailVerified ×2, requireAdmin) —
  butun klass yopildi: brauzer → 302 login redirect (returnUrl bilan), API/Accept:json → 401 JSON.
- **Test yangilandi (3 joy, eski xatti-harakatni assert qilgan)**: dsar-ui-d23 (302|401 tolerant,
  auth.test.js B-25 naqshi), auth.test.js L457 (location endi returnUrl bilan), L725
  (`redirect: 'manual'` — fetch redirect'ni kuzatib 200 olardi).

**Verify (isbot):** vitest auth paketi **491/491** (yangi BUG-016 regression case bilan) +
integration 104/104 · Playwright brauzer **10/10 PASS** (`scripts/repro-step2.mjs`): student
security-profile 0 pageerror + mfa-settings.js so'ralmaydi; teacher'da script yuklanadi + enable
tugma tirik; guest teacher-approval → 302 login (brauzer Accept) / 401 JSON (Accept:json).

## STEP 3 — 🔴 Admin panel buzilgan navigatsiya (5 havola) — ✅ YAKUNLANDI
**Buglar:** BUG-006, BUG-007
**Qilingan (aniq):**
- **BUG-007** — `footer-scripts.ejs` HECH QACHON mavjud bo'lmagan (git tarixi bo'sh), ikkala view
  o'z scriptlarini allaqachon yuklagan → o'lik include olib tashlandi: `admin/camera-review.ejs`
  (500 edi), `user/camera-pilot.ejs` (xavfda edi). Bo'sh partial yaratish = fake feature.
- **BUG-006 — routelar mavjud, yo'llar boshqacha ekan** (duplicate route ochildi emas, hreflar
  to'g'rilandi): `/admin/question-gen`→`/admin/ai-question-gen`, `/admin/presentation`→
  `/admin/presentations`, `/admin/intervention`→`/admin/interventions`, `/admin/contracts`→
  `/admin/api-contracts`. 2 fayl: `dashboard.ejs` (4 href) + `partials/sidebar.ejs` (4 href +
  4 `_isActive` — 12 ta admin sahifada ishlatiladi).

**Verify (isbot):** server repro **15/15 PASS** (`scripts/repro-step3.mjs`): admin sessiyada 5
sahifa 200 (camera-review oldin 500), dashboard+sidebar HTML'da yangi hreflar/eskilar yo'q,
student camera-pilot 200. vitest camera/admin/e2e 27/27 ✓.

## STEP 4 — 🟡 Logout-CSRF + role gate (xavfsizlik) — ✅ YAKUNLANDI
**Buglar:** BUG-008, BUG-032, BUG-014, BUG-037
**Qilingan (aniq):**
- **BUG-008/032 — POST-only logout**: `GET /user/logout` va `/admin/logout` endi TASDIQ sahifasi
  (`views/logout-confirm.ejs`, _csrf bilan POST form) — sessiyani o'ldirmaydi; real chiqish
  `POST` (global validateCsrf avtomatik). POST /user/logout'da remember-token + push revoke
  mantiqi saqlandi (revoke_token endi body'dan). session-timeout.js `data-st-logout` endi
  dinamik POST form yuboradi. 40 ta eski GET havoli viewlarda o'zgartirilmadi — ular tasdiq
  sahifasiga tushadi (1 klik qo'shadi, ishlaydi).
- **BUG-037 — ko'rinadigan Chiqish**: sidebar "Akkaunt" bo'limiga doim ko'rinadigan Chiqish
  tugmasi (POST + _csrf) qo'shildi — dropdown ochmasdan ham chiqish mumkin (Playwright
  offsetParent bilan isbot).
- **BUG-014 — POLSIYA ANIQLANDI + hardening**: test yaratish barcha rollar uchun DIZAYN BO'YICHA
  (panel'da studentga "Birinchi testingizni yaratin" empty state; arena source=user o'z testlari;
  game.js'dagi teacher/VIP gate faqat mock/pre imtihonlarga). Role gate qo'shilmadi (feature
  sinishi bo'lardi). Buning o'rniga server-side input bounds: nom ≤300, ≤300 savol, savol matni
  ≤2000, ≤12 variant (chelebsiz payload — resurs xavfsizligi).
- **Testlar**: yangi `tests/integration/logout-csrf.test.js` (GET=200 tasdiq/sessiya tirik,
  POST CSRF'siz=403, POST _csrf=302+sessiya o'lgan; admin xuddi shunday) 2/2; mfa-frontend-d08
  GET-logout hiylasi POST+yangi-csrf'ga o'tkazildi (9/9); e2e auth spec'lariga tasdiq click.

**Verify (isbot):** Playwright brauzer **8/8 PASS** (`scripts/repro-step4.mjs`): tugma ko'rinadi,
GET→tasdiq (sessiya tirik), sidebar tugma (POST+CSRF)→bosh sahifa, panel login'ga redirect.
vitest: logout-csrf 2/2 + a20/a26/mfa-d08/auth/profile 116/116.

## STEP 5 — 🔴/🟠 Registratsiya oqimi (teacher yo'qolgan) + SMTP timeout — ✅ YAKUNLANDI
**Buglar:** BUG-035, BUG-036, BUG-040, BUG-039
**Qilingan (aniq):**
- **BUG-035** — landing fReg'ga rol tanlash (Talaba/O'qituvchi radio kartalar) qo'shildi.
  Server `role=teacher`'ni allaqachon qabul qilardi (wantsTeacher, L944) — forma yetib
  bermasdi. Teacher tanlansa landing.js NATIV POST qiladi → server to'liq `/user/register`
  ariza sahifasini PREFILLED render qiladi (university/subject majburiy — mavhunga mos;
  AJAX bu HTML'ni o'qiy olmasdi, shuning uchun nativ submit).
- **BUG-036** — `hidden consent=on` (avtomatik rozilik) → FAOL `required` checkbox
  (/privacy + /terms havolalari bilan). Server-side consent talabi (D-24) allaqachon bor edi.
- **BUG-040** — fReg ostida "O'qituvchi uchun to'liq ariza →" havolasi (/user/register).
- **BUG-039 — 2 qatlam**: (1) provider.js createTransport'ga `connectionTimeout:10s,
  greetingTimeout:10s, socketTimeout:15s` (avval cheksiz — sekin SMTP so'rovni 90-180s
  bloqlardi); (2) reg oqimidagi `await sendVerifyCode` → `Promise.race` 5s cap — javob
  SMTP'ga bog'lanmay qoldi, email orqada davom etadi (mock/tez provider zudlik bilan
  resolve — testlar ta'sirlanmaydi).
- i18n: landing.js lug'atiga auth.role/roleStudent/roleTeacher/teacherLink (uz/ru/en).

**Verify (isbot):** Playwright brauzer **12/12 PASS** (`scripts/repro-step5.mjs`): rol
radiolari + consent required/unchecked + teacher havolasi; ru tilida ruscha matn; consent'siz
submit bloklanadi; teacher → to'liq forma (university maydoni + username prefilled + roller
saqlangan); student + consent → registratsiya o'tdi. vitest: email paketi 28/28 + auth/a11y/
first-win 86/86.

## STEP 6 — 🔴 Cast kirish oqimi + director bloklari — ✅ YAKUNLANDI (8 bug)
**Buglar:** BUG-020, BUG-021, BUG-002 + 5 ta YANGI (049–053)
**Qilingan (aniq — 8 bug):**
- **BUG-049 (YANGI, KRITIK)** — cast join-kodlari `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (6 harf+raqam),
  lekin landing join-dialog faqat RAQAM qoldirardi (`\D` strip) → haqiqiy cast kodini kiritib
  BO'LMASDI ("cast ishlamayapti" ildizi). Fix: A-Z0-9 uppercase filter + `/^[A-Z0-9]{5,6}$/`.
- **BUG-002** — "5 xonali raqam" matnlari haqiqatga moslandi (uz/ru/en + placeholder AB12CD +
  join.p matni: cast 6 belgi / o'yin 5 raqam).
- **BUG-050 (YANGI)** — /play formasi `maxlength=5` + `\d{5}` + numeric klaviatura → cast kodi
  kiritilmaydi. Fix: maxlength 6, autocapitalize, dual-path: 6 harfli kod → `/play?code=`
  redirect; 5 raqam → eski quiz socket oqimi (saqlangan).
- **BUG-051 (YANGI)** — URL autofill `\d{5}` → cast kodlari uchun ham qabul.
- **BUG-020** — resolve fail jim fallback → endi `castMiss` xabari: "Kod topilmadi yoki sessiya
  hozir tayyorlanmoqda — qayta urinib ko'ring" (game.js cast-format aniqlashi bilan).
- **BUG-021** — `GET /api/cast/sessions/:id/meta` route QO'SHILDI (requireAuth; title/joinCode/
  phase/revision; yo'q sessiya → 404 not_found).
- **BUG-052 (YANGI)** — loadLobbyInfo javobni umuman o'qimasdi → endi #dir-title/#dir-code-big
  yangilanadi.
- **BUG-053 (YANGI, YIRIK)** — cast-director.js'da **186 ta jQuery-uzilish** `$('#id')` — helper
  bare id kutardi → `getElementById('#id')`=null → Tezkor savol/Transfer/Maqsad/POE/Orb butun
  bloklari o'lik (live TypeError). Fix: tolerant helper `String(sel).replace(/^#/,'')` — 186
  binding bir zumda tirildi (forenzika: getElementById instrumentatsiyasi bilan isbot).

**Verify (isbot):** repro **17/17 PASS** (`scripts/repro-step6.mjs`): meta API 4 holat, /play 3
holat, landing kichik-harf→uppercase→navigatsiya, forma dual-path, director 200 + meta 200 +
**pageerror=0**. vitest cast paketi 25/25.

## STEP 7 — 🟠 Dark mode kontrast (WCAG) — ✅
**Buglar:** BUG-023, BUG-024, BUG-025 + YANGI BUG-054…BUG-062 (jami 12 ta)
**Qanday (qaysi+qanday):**
- **BUG-023** `.btn.green` (1.04:1) — **o'lchov artefakti ekanligi ISBOTLANDI**: QA skaneri gradient
  stoplarini o'qimagan (chrome computed style'da hex→rgb bo'ladi), bg qorong'u ota-tagga tushgan.
  Ground-truth: fg #04120c, bg `linear-gradient(#00e5a0→#00b37e)` RENDER BO'LADI, worst-stop 6.9:1 ✓.
  Kod o'zgartirilmadi — hisobotda noto'g'ri o'lchov deb hujjatlandi.
- **BUG-024** arena raqamli inputlari (1.17:1) — hozirgi buildda tokenlar yuklanadi, o'lchandi 12:1 ✓;
  himoyalancha `color:var(--text-primary,#f2ede3)` + placeholder fallback qo'shildi (test-arena.ejs).
- **BUG-025** teachers badge + "Kutilmoqda" `a.on` (#fff cyan ustida 1.7–1.8) → `var(--action-on-action,#041018)`.
- **BUG-054** `.auth-admin-flag` gradient uchi #7c3aed (3.27) → #0891b2 (ikkala stop ≥5:1).
- **BUG-055** test-builder dark `.tb-err-summary-title` (3.58) → #fca5a5.
- **BUG-056** `.role-tab.active` #fff (1.76) → on-action token.
- **BUG-057** admin login sahifasida brand-cobalt token yuklanmaydi — badge 1.05 (ko'rinmas!) →
  `var(--…,#7dd3fc)` fallback + #041018 matn.
- **BUG-058** (o'zim topdim) 23 ta viewda takrorlangan inline `.btn/.tab.active/.verify-btn/.mfa-icon`
  `gradient(var(--action-primary),#1d4ed8)+#fff` — oq matn cyan stopda 1.7:1 → qat'iy
  `var(--action-primary)` + `var(--action-on-action,#041018)` (38 qoida, 23 fayl).
- **BUG-059** arena `.btn-bots` oq matn yashil gradientda 1.65 → #04120c.
- **BUG-060** LIGHT: sidebar hard-kodlangan #241f18 + light token matni = 1.05:1 → sidebar to'liq
  tokenlashtirildi (premium-theme.css: surface/border/action tokenlar).
- **BUG-061** LIGHT: gradient-matn (background-clip:text) worst-stop 2.4:1 → light'da qat'iy
  action-primary override; arena `.logo` qat'iy oltin stoplar (topbar doim qorong'u).
- **BUG-062** LIGHT aksentlar: amber linklar/badgelar → status tokenlar (light warning #7f5a18
  qoraytirildi), admin `.admin-del-btn` light #095e9e, `--accent-glow` light #1D4ED8, panel `.on`
  → on-action, `.ws-search-btn/.ws-state-action/shell-role-user` ranglari.
- Bonus: design-lint S37.05 (sidebar.ejs inline style — STEP4 dan qolgan) → `.shell-nav-btn` klassi.
**Tool:** `scripts/repro-step7.mjs` — Playwright WCAG-2.2 kompozit kontrast skaner: dark+light,
gradient worst-stop, background-clip:text, to'liq alfa kompozit (shaffof qatlamlar zanjiri),
barcha inputlar. 18 sahifa (6 user + 12 admin): **0 ta buzilish**.
**Verify:** skaner 0/0 (dark+light); vitest design+unit **4896/4896** ✓; design-lint PASS ✓.

## STEP 8 — 🟡 UI/i18n mayda buglar — ⏳
**Buglar:** BUG-004, BUG-033, BUG-034, BUG-046, BUG-003, BUG-028, BUG-042
**Qanday:**
- **BUG-004** — MFA matni "Telefoningizdagi" → TOTP/authenticator deb to'g'rilash (agar qolsa).
- **BUG-033** — VIP badge UI'da yo'q (`roleLabel` student default). Fix: VIP belgisi panel'da.
- **BUG-034** — teacher.ejs "Overview"/"Grading queue" EN → uz.
- **BUG-046** — notifications: `ch_telegram` default ON (integratsiya yo'q). Fix: mavjud bo'lmagan
  kanal default OFF + disabled belgi.
- **BUG-003** — footer `#` linklar (main'da 0 ta topildi — verify qilinadi, yopiladi).
- **BUG-028/042** — landing admin modal → alohida `/admin/login` page yo'lini ustun qilish
  (foydalanuvchi talabi: alohida page). ⚠️ UI arxitektura qarori — STEPda tasdiqlanadi.
**Verify:** brauzer skrinshot + i18n grep.

## STEP 9 — 📄 README/hujjat mosligi + SEO — ⏳
**Buglar:** BUG-017, BUG-047, BUG-019, BUG-005, BUG-018
**Qanday:**
- **BUG-017/047** — README'dagi o'lik manzillar (`/user/sessions` → `/sessions`, mfa-setup →
  `/user/mfa/setup`); dead view `user/sessions.ejs` yo'q qilinadi yoki route ulanadi.
- **BUG-019** — README cast manzillari to'g'rilash.
- **BUG-005** — robots.txt qo'shish.
- **BUG-018** — Web Push README'da "env kutilmoqda" deb belgilash (kod emas, env masalasi).
**Verify:** README link audit skripti.

## STEP 10 — ⚠️ Feature-darajadagi talablar (bug emas — muhokama) — ⏳
**Buglar:** BUG-026, BUG-027, BUG-029, BUG-030
- **BUG-026** — "Maqola tavsiya" end-user ko'rmaydi (faqat admin). → Yangi feature.
- **BUG-027** — teacher nazorat/statistika chuqurlashtirish. → Yangi feature.
- **BUG-029** — admin sidebar "hammasi bir ko'rinishda". → UI arxitektura qarori.
- **BUG-030** — "ikki marta tasdiq" kodda topilmadi — interaktiv repro kutilmoqda.
**Qaror:** har biri alohida tasdiq bilan (scope katta — fake feature qilmaymiz).

---

## ✅ YAKUNLANGANLAR
- **STEP 1** (2026-08-27): BUG-009/010/012/044 + 2 yangi topilma — 6 fayl; brauzer 13/13 PASS, vitest 45/45.
- **STEP 2** (2026-08-27): BUG-011/016/041 — 5 fayl + 3 test sinxron; brauzer 10/10 PASS, auth 491/491, integration 104/104.
- **STEP 3** (2026-08-27): BUG-006/007 — 4 fayl; server repro 15/15 PASS, vitest 27/27.
- **STEP 4** (2026-08-27): BUG-008/032/037/014 — POST-only logout + tasdiq sahifasi + ko'rinadigan tugma + input bounds; brauzer 8/8, logout-csrf 2/2, regression 116/116.
- **STEP 5** (2026-08-27): BUG-035/036/040/039 — landing rol+consent+teacher havola, SMTP timeout+5s cap; brauzer 12/12, email 28/28, auth/a11y 86/86. [PUSH nuqtasi]
- **STEP 6** (2026-08-27): BUG-020/021/002 + YANGI 049/050/051/052/053 (186 jQuery-uzilish!) — repro 17/17, cast testlari 25/25.
- **STEP 7** (2026-08-27): BUG-023 (artefakt—isbot)+024+025 + YANGI 054–062 — kontrast skaner 0 buzilish (dark+light, 18 sahifa), vitest 4896/4896, design-lint PASS.

## 📋 MANBA HAVOLALAR
- BUG hisobotlari: `workspace` branch → `qa/BUG_REPORTS.md`
- QA rejasi: `workspace` branch → `qa/STEPS.md`, `qa/00_QA_PLAN.md`
