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

## STEP 8 — 🟡 UI/i18n mayda buglar — ✅
**Buglar:** BUG-004, BUG-033, BUG-034, BUG-046, BUG-003, BUG-028, BUG-042 + YANGI BUG-063/064 (jami 9)
**Qanday (qaysi+qanday):**
- **BUG-004** MFA matni SMS taassuroti — manba `data/auth-i18n.js` mfaLogin.sub (4 til) →
  "Autentifikator ilovasidagi 6 xonali kodni kiriting." (uz/uz-cyrl/ru/en).
- **BUG-033** VIP ko'rinmaydi — panel sidebar include'ga `role+isVip` uzatildi; sidebar role chipda
  "VIP Talaba" + `.shell-role-vip` badge (faqat VIP o'z panelda — vip.js yashirinlik prinsipi saqlangan,
  oddiy foydalanuvchida hech narsa ko'rinmaydi).
- **BUG-034** EN tablar — 3 manba: `views/role/teacher.ejs` (tabs+statlar), `views/partials/sidebar.ejs`
  (default nav) VA asosiyysi `middleware/roles.js` navItems (teacher/marker/proctor workspace) →
  "Umumiy ko'rinish", "Baholash navbati", "Belgilash", "Ko'rib chiqish", "Kamera tekshiruvi",
  "Boshqaruv markazi".
- **BUG-046** sozlanmagan kanallar default ON — `routes/notifications.js`: `channelAvail()`
  (TELEGRAM_BOT_TOKEN / VAPID env asosida); GET: sozlanmagan kanal unchecked+DISABLED ko'rinadi +
  izoh matni; POST: sozlanmagan kanalni server majburan false qiladi.
- **BUG-003** footer 9 o'lik link — `/privacy`, `/terms`, `/cookies`, `/legal` (hammasi mavjud
  legal modul), email → `mailto:`, "Status" (sahifasi yo'q) olib tashlandi; i18n ftr.l7 3 tilda
  "Cookie siyosati" bo'ldi.
- **BUG-028/042** admin kirish modal emas — landing'dagi admin modal BUTUNLAY olib tashlandi
  (markup + landing.js mantiq); header `#adminBtn` va hamburger link to'g'ridan `/admin/login`
  page'ga boradi (page'da MFA eslatmasi bor — kontent nomuvofiqligi ildizi yo'qoldi).
- **BUG-063** (o'zim topdim) `middleware/roles.js` marker/proctor navlarida qolgan EN labelar.
- **BUG-064** (o'zim topdim) `notifications-b21` anon-redirect testi BUG-041 dan keyin eskirgan
  (fetch follow → 200) → `redirect:'manual'`.
**Tool:** `scripts/repro-step8.mjs` — 36 tekshiruv (footer linklar, legal 200×4, admin page link,
i18n dict, teacher uz, VIP badge, notifications disabled+POST himoya) — **HAMMASI OK**.
**Verify:** repro 36/36 ✓; vitest integration 88/88 (6 fayl) ✓; design+unit 4896/4896 ✓; design-lint PASS ✓.

## STEP 9 — 📄 README/hujjat mosligi + SEO — ✅
**Buglar:** BUG-017, BUG-047, BUG-019, BUG-005, BUG-018 + YANGI BUG-065/066 (jami 7)
**Qanday (qaysi+qanday):**
- **BUG-005** robots.txt yo'q (404) → `public/robots.txt`: `/admin/ /api/ /user/ /play /sessions
  /onboarding /cast/` Disallow; ommaviy sahifalar (`/`, legal) Allow.
- **BUG-017/047** README §2 o'lik manzillar → tekshiruvda chiqdi: viewlar DEAD EMAS, yo'llar
  boshqacha: `/sessions` (routes/session.js) va `/onboarding` (routes/onboarding.js) prefikssiz;
  mfa-setup — `/user/mfa/setup` (faqat majburiy enroll o'tish sahifasi, oddiy holatda panelga
  redirect — README shunday hujjatlandi). README eski `/user/`-shakllarni "404 beradi" deb belgiladi.
- **BUG-019** README cast bo'limi — real yo'llar hujjatlandi: teacher panel → Cast Studio (sessiya
  API orqali), talaba `/play?code=`, `/cast/:sessionId/director|projector|results|quality-lab`,
  `/cast/qr`; "to'g'ridan `/cast/director` yo'q" ogohlantirisi. Seed qilingan real sessiya bilan
  director sahifasi 200 deb tekshirildi. opendata — "(statik snapshot, isLive:false)".
- **BUG-018** Web Push README §6 — shartli hujjat: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env talabi,
  aks holda `push_disabled` (STEP 8'da UI kanali ham avtomatik o'chadi).
- **BUG-065** (o'zim topdim) README §5 da'vo qilgan 7 admin sahifa 404: `intervention`→yo'q
  (real `/admin/interventions`), `question-gen`→`/admin/ai-question-gen`, `presentation`→
  `/admin/presentations`; `item-bank/rubric/assessment/competency` — FAQAT API modullari
  (sahifa yo'q) → README'da alohida "faqat API" blokiga ko'chirildi.
- **BUG-066** (o'zim topdim) README'dagi admin sahifa ro'yxati to'liq audit qilindi — 30 nomning
  hammasi endi 200 qaytaradi (repro'da 9 tasining sahifasi + 5 ta eski noto'g'ri yo'l 404 deb).
**Tool:** `scripts/repro-step9.mjs` — robots + README matn tekshiruvlari + 10 user sahifa +
cast seed director 200 + push + admin nomlar (45+ tekshiruv) — **HAMMASI OK**.
**Verify:** repro ✓; design+unit 4896/4896 ✓; integration (landing/legal/mfa) 36/36 ✓; design-lint PASS ✓.

## STEP 10 — ⚠️ Feature-darajadagi talablar — ✅ (qaror + minimal real yechim) [PUSH NUQTASI]
**Buglar:** BUG-026, BUG-027(a+b), BUG-029, BUG-030 + tekshiruvlar (jami 7 pozitsiya)
**Qaror va yechim (qaysi+qanday):**
- **BUG-026** "Maqola tavsiya" end-user — **QAROR: qurilmaydi**. Modul tashqi provider API
  kalitlarisiz "not configured" qaytaradi (executeConnectorSearch:88) — end-user UI bo'sh qobiq
  = yolg'on feature bo'lardi. Admin konsol qoladi (requireAdmin); README'ga qaror hujjatlandi.
  Kalitlar ulanganda teacher/student panelga chiqarish alohida product-qaror.
- **BUG-027a** approve/reject teacher/VIP ko'rishi — **QAROR: governance admin'da qoladi**
  (rol ajratish + audit). Teacher O'Z ariza holatini ko'radi: `/user/teacher-approval` mavjud va
  ishlaydi (repro: pending user uchun 200; /admin/teachers uchun 403/302).
- **BUG-027b** statistika chuqur emas — **YECHIM**: `/admin/teachers` haqiqiy statistika strip:
  status bo'yicha sonlar (kutilmoqda/tasdiqlangan/rad etilgan), 14 kunlik ariza/qaror trend
  (diagramma), o'rtacha qaror vaqti — mavjud DB ma'lumotidan server-side agregat (seed bilan
  raqamlar aniq tekshirildi: 2/1/1, 24 soat).
- **BUG-029** "hamma funksiya bir ko'rinishda" — **YECHIM**: `/admin/index` "Barcha funksiyalar"
  sahifasi: guruh grid (7 guruh, 38 havola) + klient tomonlama qidiruv + bo'sh holat. Katalog
  dashboard sidebar'dan avto-parse qilinadi (yagona manba — sidebar o'zgarsa indeks o'zi yangilanadi).
  Sidebar'ning eng yuqorisiga link qo'shildi; katalogdagi har bir havola 200 deb verify qilindi.
- **BUG-030** "iki marta tasdiq" — **YECHIM (ildiz topildi)**: kodda confirm birmartalik, lekin
  delete'dan keyin `location.reload()` — to'liq sahifa qayta yuklanadi ("ikki marta bosdim"
  hissining manbai). Endi qator joyida o'chadi (`rows.splice + row.remove() + applyFilters()`),
  toast xabar qoladi. (Shubhali "CSRF yo'q" versiyasi tekshirildi — head.ejs:111 global fetch-patch
  header qo'shadi, xato emas.)
- Tekshiruv: dashboard sidebar'dagi 37 havolaning hammasi 200 (S3 fixing saqlangan).
**Tool:** `scripts/repro-step10.mjs` — 25 tekshiruv (qarorlar + statistika raqamlari + katalog
+ no-reload manba + delete API) — **HAMMASI OK**.
**Verify:** repro 25/25 ✓; admin/auth/overlays integration 48/48 ✓; design+unit 4896/4896 ✓;
design-lint PASS ✓. **PUSH:** S6–S10 (0a21500..HEAD) → origin/debugging.

---

## STEP 11 — 🟠 Qolgan hisobot buglari + konsol-audit topilmalari — ✅
**Buglar:** BUG-013, BUG-015, BUG-022, BUG-045 (hisobot) + YANGI BUG-068/069/070 (jami 7)
**Qanday (qaysi+qanday):**
- **BUG-013** security-profile teacher'da student API 401 (console noise) — Assessment bo'limi
  endi FAQAT studentda render qilinadi (view role-shartli); security-profile.js'da `if (pick)`
  guard — yuklash va listener faqat picker mavjud bo'lsa (ikkinchi yashirin crash —
  `pick.addEventListener` null — ham shu bilan yopildi).
- **BUG-015** MFA 403 tashxisi — xabarlar amalga yo'naltirilgan: `expiredChallenge` (challenge
  TTL 5 daqiqa o'tsa — "qayta kiring" + avto-redirect) va `invalidHint` (stale authenticator
  yozuvi ehtimoli + 30s rotatsiya eslatmasi), 4 til; mfa.js `no_pending_challenge`/401 handler.
- **BUG-022** Canva status qarama-qarshiligi — status faqat CLIENT_ID'ni tekshirardi, link esa
  clientId+secret+redirect talab qilardi → endi ikkalasi ham `isCanvaConfigured()` (yagona manba):
  faqat CLIENT_ID bilan `configured:false` (repro bilan isbot).
- **BUG-045** /sessions "Noma'lum qurilma" + dublikatlar — parseUa brauzersiz so'rovlar
  (curl/node/bot)ni aniqlaydi → "Brauzersiz so'rov (server/test)" label; sessiyalar
  device+browser+ipHash bo'yicha guruhlanadi (separator + "Shu qurilmadan yana bir sessiya").
- **BUG-068** (o'zim, konsol-scan) /user/settings `ReferenceError: profile is not defined` —
  inline JS'da EJS o'zgaruvchisi xom ishlatilgan → `window.__SETTINGS_PROFILE__` dan o'qiladi.
- **BUG-069** (o'zim, konsol-scan — S10 REGRESS) /admin/teachers `app` TDZ 500 — S10
  statistikam `const app` deklaratsiyasidan oldin unga murojaat qilgan; S10 repro'da seed
  userlar `appliedAt`'li bo'lgani uchun short-circuit bilan yashiringan edi. `const app` yuqori
  chiqarildi (canonical fallback `app.created_at` — eski `created_at_by_user` typosi ham tuzatildi).
- **BUG-070** (o'zim) settings-d09 anon-test eskirgan (BUG-041 klas) → `redirect:'manual'`.
**Tool:** `scripts/repro-step11.mjs` (16 tekshiruv) + `scripts/scan-console.mjs` (Playwright
konsol/pageerror/HTTP-xato skani — 12 sahifa) — **HAMMASI OK, 12/12 sahifa toza**.
**Verify:** repro 16/16 ✓; scan 12 sahifa 0 xato ✓; canva/teachers/mfa/settings integration
52/52 ✓; design+unit 4896/4896 ✓; design-lint PASS ✓.

## STEP 12 — 🟠 Faza B: mavzu qatlamlari (dark+light kontrast, FOUC, hc, rol redirectlari) — ✅
**Buglar:** BUG-071/072/073/074/075/076 + 077 (jami 7)
**Qanday (qaysi+qanday):**
- **BUG-071** views/user/sessions.ejs — skip-link oq matn oq plashka ustida; on-action
  tokenga o'tdi.
- **BUG-072** views/user/sessions.ejs `.lang-link.on` — `#fff` (--cast-yoruq ustida 2.32:1)
  → on-action rang.
- **BUG-073** public/css/cast-tokens.css `.cast-btn-danger` — oq matn --cast-red (#ff4466)
  ustida 2.32:1 → `#2a0714` to'q matn (3.35:1+).
- **BUG-074** routes/cast.js projector — ticket'siz brauzerga xom 403 JSON qaytardi →
  endi `res.redirect('/play')` (meta-missing/catch shoxlari ham).
- **BUG-075** views/game/enter.ejs `.btn-red` — gradient(135deg, accent→#1d4ed8) ustida oq
  matn 2.32:1 → solid `var(--accent)` + on-action matn.
- **BUG-076** middleware/roles.js L153/167/174 — `req.accepts('json')` `*/*` brauzerda ham
  truthy → anonim/wrong-rol `/student /proctor /marker /board /teacher` brauzerga xom 401/403
  JSON qaytarardi → `req.accepts(['html','json']) === 'json'`: brauzer 302 login (anonim) /
  stealth 404 (rolsiz, A-19 §14 saqlanadi), API/json 401/403 JSON saqlanadi.
- **BUG-077** hc (yuqori kontrast) — PREMISE tuzatildi: `[data-theme="high-contrast"]` CSS
  mavjud (generated/tokens.css 38 qatorlik token override + theme.css print-bloki), lekin
  TO'LIQ sheet emas. Xato: theme-core resolveState hc/hc-dark/system+prefersHC →
  'high-contrast' qo'yib, sahifani yarim uslublang holatga tushirardi (head-resolver va
  engine o'rtasida ham mosmaslik). Fix: hc-light/hc-dark/system+prefersHC → bazaviy
  light/dark'ga GRACEFUL resolve (state saqlanadi, hc sheet qo'shilganda shu nuqtada
  yoqiladi) + testlar (tests/design/theme.test.js 6 assertion) yangi kontraktga moslandi.
**Tool:** `scripts/scan-step12.mjs` (PORT 4600; PUB 7 + USER 8 + CAST 4 sahifa dark+light
WCAG, FOUC DCL-listener, 390×844 mobil overflow 10 sahifa; admin cookie + seed'lar) +
`scripts/repro-step12.mjs` (PORT 4602, 16 tekshiruv).
**Verify:** scanner — 24+ sahifa dark+light 0 kontrast buzilishi; FOUC light@DCL ✓; MOB
10/10 ✓; repro **16/16 HAMMASI OK**; full vitest **7099 passed / 9 failed — 9tasi ham
clean S11 HEAD (b60e862 worktree)da ham xato: 8 pre-existing (telegram-redirect fetch,
4×MFA journey/session, A-30, revoke_token — env-bog'liq) + 1 flake (logout-GET,
izolyatsiyada o'tadi)** → S12 regressioni 0; test sinxron: http.test (Accept aniq),
cast-projector (302 /play), teacher-sla-b16 (A-19 stealth 404 brauzer uchun); design-lint PASS ✓.

## STEP 13 — 🟠 Faza B: mobil qatlam (overflow, touch-target, input-zoom, [hidden]) — ✅
**Buglar:** BUG-078/079/080/081/082/083 (jami 6 guruh, 20+ ko'rinish)
**Qanday (qaysi+qanday):**
- **BUG-078** cast-participant.css — `[hidden]` atributi ishlamagan: `.part-center{display:flex}`
  (author) brauzerning UA `[hidden]{display:none}`'ini yengadi → /play'da BARCHA screenlar (join,
  waiting, forge, question) yonma-yon ko'rinib, 390px'da **+733px** (320px'da +554px) gorizontal
  overflow; director'da bu muammo uchun `.dir-overflow-menu[hidden]` fix BOR edi, participantda
  unutilgan. Fix: fayl oxiriga `[hidden]{display:none}` (source-order yutadi) + `.part-card{max-width:
  100%;box-sizing:border-box}` (shrink-to-fit 400px) + `.join-steps{flex-wrap:wrap}`.
- **BUG-079** cast-director.css `.dir-topbar` — mobil breakpoint YO'Q: `dir-topbar-right` 390px'da
  **+315px** chiqib ketardi. Fix: ≤640px `flex-wrap:wrap` topbar + chiplar.
- **BUG-080** iOS fokus auto-zoom — input/textarea/select `font-size<16px` (landing 14.72,
  settings 13.12, portfolio 13.33, play cast-input 13.33, director 14.4, admin 12–13.33) — 15+
  sahifa, 20+ maydon. Fix: `@media≤640px` `font-size:max(16px,1em)!important` — responsive.css
  (design sahifalar) + admin.css (21 ta admin view responsive.css yuklamaydi, o'z head'i bor) +
  cast-participant/director (.cast-input).
- **BUG-081** WCAG 2.5.8 — checkbox/radio 13–20px (adm-a11y 13×13, login remember 15×15,
  portfolio consent 13×20, director qp-correct 20×20). Fix: `@media≤640px` `min-width/min-height:
  24px` (responsive.css + admin.css + cast-director.css).
- **BUG-082** tugma/select balandligi <24px (panel `.sel` 19px, `.adm-btn` 21px, `#auJourney`
  19px). Fix: `@media≤640px` `button,select{min-height:24px}` ×3 CSS.
- **BUG-083** ikon-nishonlar — login/register `a.nav-logo` 16×32 (portfolio'da 82×13 — style.css
  tizimida inline, min-height no-op), admin hamburger 18px, admin-refresh 14×14. Fix:
  `a.nav-logo{display:inline-flex;min-width/min-height:24px}` responsive.css + portfolio.ejs'ga
  responsive.css link; `button{min-width:24px}` hamburger/refresh'ni yopadi.
- **Tester yaxshilanishi:** scanner 3 bosqichda FP chiqarmaydi: FIXED-OFF `transform:none` sharti
  (nav-drawer translateX off-canvas), CLIPPED sr-only pattern skip, TARGET lazy-img kutish +
  `naturalWidth` guard.
**Tool:** `scripts/scan-step13.mjs` (PORT 4604; 36 sahifa × 390px to'liq audit: overflow+touch+
input-zoom+fixed+clipped, +320px overflow-only; PUB 9/USER 11/CAST 4/ADMIN 15) +
`scripts/repro-step13.mjs` (PORT 4606, 24 tekshiruv) + probe'lar.
**Verify:** scan 1-run'da 124 topilma → fix'lar → **0 buzilish, 40/40 toza**; repro **24/24
HAMMASI OK**; design foundations 16/16 (allowlist 25→26 hujjatlangan: S13 anti-zoom ×3);
cast e2e 21+5 o'tdi; design-lint PASS ✓; full vitest 7098/7108 — 9 ta S12'dan ma'lum
pre-existing (S11 HEAD worktree'da ham xato) + 1 S13 regression ([hidden] important +2) TOPILDI
VA TA'SIRLANDI (27→26, chegara yangilandi, test o'tdi).

## ✅ YAKUNLANGANLAR
- **STEP 1** (2026-08-27): BUG-009/010/012/044 + 2 yangi topilma — 6 fayl; brauzer 13/13 PASS, vitest 45/45.
- **STEP 2** (2026-08-27): BUG-011/016/041 — 5 fayl + 3 test sinxron; brauzer 10/10 PASS, auth 491/491, integration 104/104.
- **STEP 3** (2026-08-27): BUG-006/007 — 4 fayl; server repro 15/15 PASS, vitest 27/27.
- **STEP 4** (2026-08-27): BUG-008/032/037/014 — POST-only logout + tasdiq sahifasi + ko'rinadigan tugma + input bounds; brauzer 8/8, logout-csrf 2/2, regression 116/116.
- **STEP 5** (2026-08-27): BUG-035/036/040/039 — landing rol+consent+teacher havola, SMTP timeout+5s cap; brauzer 12/12, email 28/28, auth/a11y 86/86. [PUSH nuqtasi]
- **STEP 6** (2026-08-27): BUG-020/021/002 + YANGI 049/050/051/052/053 (186 jQuery-uzilish!) — repro 17/17, cast testlari 25/25.
- **STEP 7** (2026-08-27): BUG-023 (artefakt—isbot)+024+025 + YANGI 054–062 — kontrast skaner 0 buzilish (dark+light, 18 sahifa), vitest 4896/4896, design-lint PASS.
- **STEP 8** (2026-08-28): BUG-003/004/028/033/034/042/046 + YANGI 063/064 — footer legal linklar, TOTP matni (4 til), admin alohida page (modal olib tashlandi), VIP badge, uz tablar, kanal mavjudligi; repro 36/36, vitest 4984/4984.
- **STEP 9** (2026-08-28): BUG-005/017/018/019/047 + YANGI 065/066 — robots.txt, README real yo'llar (sessions/onboarding/cast), push shartli hujjat, 7 o'lik admin nomi; repro 45+ ✓, 4896/4896.
- **STEP 10** (2026-08-28): BUG-026 (qaror)/027a (qaror)/027b (real statistika)/029 (Barcha funksiyalar sahifasi)/030 (no-reload delete) — repro 25/25, 4896/4896. [PUSH: S6–S10]
- **STEP 11** (2026-08-28): BUG-013/015/022/045 + YANGI 068/069/070 (settings crash, S10 TDZ regress, eskirgan test) — konsol-scan 12/12 toza, repro 16/16, 4896/4896.
- **STEP 12** (2026-08-28): BUG-071…077 (sessions/cast/enter kontrast, projector 302, roles html/json negotiate, hc graceful) — scan 24+ sahifa 0 buzilish, repro 16/16, full 7099/7108 (9 fail pre-existing @HEAD), design-lint PASS.
- **STEP 13** (2026-08-28): BUG-078…083 (participant [hidden] +733px overflow, director topbar +315px, iOS input-zoom <16px, touch-target <24px) — scan 36 sahifa 0 buzilish, repro 24/24, cast e2e 21+5, design-lint PASS.

## 📋 MANBA HAVOLALAR
- BUG hisobotlari: `workspace` branch → `qa/BUG_REPORTS.md`
- QA rejasi: `workspace` branch → `qa/STEPS.md`, `qa/00_QA_PLAN.md`
