# DEBUG STATUS — Deborah

> **Manba:** `workspace` branchidagi QA hisobotlari (qa/BUG_REPORTS.md, BUG-001…BUG-048, 2026-08-27)
> **Branch:** `debugging` (asos: `main` @ 6612193)
> **Qoida:** har STEP = bitta izolyatsiyalangan tuzatish to'plami → test + brauzer verify → commit
> → **FOYDALANUVCHI TASDIQI** → keyingi STEP.
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

## STEP 4 — 🟡 Logout-CSRF + role gate (xavfsizlik) — ⏳
**Buglar:** BUG-008, BUG-032, BUG-014, BUG-037
**Qanday:**
- **BUG-008/032** — `/admin/logout` va `/user/logout` GET + CSRF'siz (logout-CSRF). Fix: POST+CSRF
  (GET back-compat yo'lda qoldiriladi yoki 302→POST formaga) + barcha view havolalarini yangilash.
- **BUG-037** — logout havolasi desktop'da ko'rinmas (fold'da). Fix: sidebar'da doim ko'rinadigan
  joyga chiqarish.
- **BUG-014** — `/api/tests/save` role/VIP gate yo'q (faqat name/questions tekshiradi). Fix:
  biznes-qoidaga mos requireVip/teacher gate (mavjud middleware).
**Verify:** integration test (GET logout CSRF'siz ishlamaydi, POST ishlaydi) + UI brauzer.

## STEP 5 — 🔴/🟠 Registratsiya oqimi (teacher yo'qolgan) + SMTP timeout — ⏳
**Buglar:** BUG-035, BUG-036, BUG-040, BUG-039
**Qanday:**
- **BUG-035/036** — landing fReg: rol tanlash YO'Q, consent `hidden value="on"` (avtomatik rozilik).
  Fix: landing formaga rol tanlash (Talaba/O'qituvchi) + faol consent checkbox qo'shish.
- **BUG-040** — `/user/register` (to'liq teacher ariza formasi) landing'dan hech qayerda havolalanmagan.
  Fix: landing'da "O'qituvchi bo'lib ro'yxatdan o'tish" havolasi.
- **BUG-039** — reg POST 90–180s: SMTP transportda timeout yo'q + sinxron await. Fix:
  nodemailer `connectionTimeout/socketTimeout/greetingTimeout` (5–10s) + email yuborishni
  javobsiz (queue/async) qilish.
**Verify:** brauzer reg oqimi + SMTP unit test (timeout konfig).

## STEP 6 — 🟠 Cast: flaky join + o'lik API chaqiruv — ⏳
**Buglar:** BUG-020, BUG-021, BUG-002
**Qanday:**
- **BUG-020** — birinchi `/play?code=` urinish jim o'yin sahifasiga qulaydi (resolve pishmagan bo'sa
  null → jim fallback). Fix: resolve fail → aniq xato/retry xabari.
- **BUG-021** — `cast-director.js:183` `/api/cast/sessions/:id/meta` GET route yo'q (404, jim
  yutiladi). Fix: route qo'shish yoki chaqiruvni olib tashlash.
- **BUG-002** — join kodi matn "5 xonali" vs kod 5–7 qabul qiladi (agar main'da qolsa). Fix: matn ↔
  validatsiya sinxron.
**Verify:** cast integration test + brauzer A/B join.

## STEP 7 — 🟠 Dark mode kontrast (WCAG) — ⏳
**Buglar:** BUG-023, BUG-024, BUG-025
**Qanday:** `.btn.green` dark'da 1.04:1 (marking/grading/board), arena inputlari 1.17:1,
/admin/teachers badge 1.58:1. Fix: dark tema tokenlari (≥4.5:1) — design-audit contrast checker
 bilan isbot.
**Verify:** `design:check:full` kontrast oqimi (9 ✓ saqlanadi).

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

## 📋 MANBA HAVOLALAR
- BUG hisobotlari: `workspace` branch → `qa/BUG_REPORTS.md`
- QA rejasi: `workspace` branch → `qa/STEPS.md`, `qa/00_QA_PLAN.md`
