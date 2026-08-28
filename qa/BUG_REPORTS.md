# BUG HISSOBOTLARI — Deborah (deborah-ncj.onrender.com)

> **Stack (aniqlangan):** Node.js + Express + EJS + express-session, Cloudflare + Render
> **Sana:** 2026-08-27 | **QA:** qora-quti (black-box), live sayt orqali
> **Qoida:** FAQAT HISOBOT — hech narsa tuzatilmaydi

---

## ✅ ISHLAYOTGAN QISMLAR (tekshirildi, xato topilmadi)

| # | Tekshiruv | Natija |
|---|-----------|--------|
| P-01 | Landing sahifa, title, static assetlar (11 fayl) | 200 OK, to'liq yuklanadi |
| P-02 | Security headers (helmet): HSTS, X-Frame-Options: SAMEORIGIN, nosniff, referrer-policy | To'g'ri sozlangan |
| P-03 | Cookie xavfsizligi: HttpOnly, Secure, SameSite=Lax | To'g'ri |
| P-04 | CSRF: barcha formalarda `_csrf`, API'da `X-CSRF-Token` header | Ishlayapti |
| P-05 | Login (parol bosqichi) 4 ta rol: teacher, jasur (VIP), jasurjonai, edikit_admin | 302 → MFA bosqichi |
| P-06 | Landing'dagi admin modal oqimi (server tomonda): POST /admin/login landing session bilan | 302 → /admin/mfa ✅ |
| P-07 | Auth'siz himoyalangan sahifalar: /admin, /admin/dashboard, /user/dashboard, /teacher, /user/teacher | 401 — kirish bloklangan |
| P-08 | User enumeration himoyasi (admin login): xato login va xato parol uchun bir xil generic xabar | "Login yoki parol noto'g'ri" |
| P-09 | MFA brute-force himoya: 5 xato urinishdan keyin `locked` + HTTP 429, 15 daqiqa | Ishlayapti |
| P-10 | ~~MFA lockout faqat joriy challenge~~ **TO'G'IRLANGAN:** lockout **per-user kumulyativ** — challenge'lar bo'ylab yig'iladi, bo'sh kod ham sanaladi; UI'ida ham yozilgan ("5 marta xato kiritilsa, 15 daqiqa bloklanasiz"); kod + backup ikkalasi birHisobga | To'g'ri dizayn (challenge-hop brute force'ni ham to'sadi) |
| P-11 | Google OAuth: PKCE (S256), state, nonce, access_type=offline | Zamonaviy himoyali oqim |
| P-12 | 404 sahifa (noma'lum URL) | To'g'ri ishlaydi |
| P-13 | PWA manifest.json | Valid |
| P-14 | /play sahifa (o'yin kodi kiritish) | 200 OK |

---

## 🟡 TOPILGAN KAMCHILIKLAR (BUG/UX)

### BUG-001: 🔴 Admin kirish muammosi — "dashboarddagi admin joydan kirmayapti" (FOYDALANUVCHI HISOBOTI)
- **Severity:** 🔴 Critical (admin panelga kirish)
- **Holat:** Chuqur tekshiruv yakuni:
  - ✅ Server-side: ikkala yo'l ham bir xil ishlaydi (302 → /admin/mfa)
  - ✅ Real brauzer (Playwright): landing modal → parol → **/admin/mfa redirect ishlaydi**, console xato yo'q (evidence: 01–04 PNG)
  - ✅ Admin MFA sahifasi to'g'ri render bo'ladi: bitta kod inputi + Tasdiqlash (6 box emas — bu o'ziga xoslik, bug emas)
  - ❗ Foydalanuvchi "dashboard" deganda qaysi joy nazarda tutilgani aniqlanmagan — login/register sahifalar footeridagi "Admin" havolasi ham /admin/login'ga olib boradi (kode q.173 login.ejs, q.218 register.ejs)
- **Asosiy shubha:** MFA kod bosqichi — foydalanuvchi TOTP kodiga ega bo'lmasa login "ishlamaydi" his qilinishi mumkin. Back Up kodlar topildi (qarang BUG-001a)
- **Holat:** TOTP bosqichi testi kutilmoqda (backup kod bilan kirgach to'liq yopiladi)

### BUG-001a: ℹ️ TUSHUNTIRISH — yuborilgan "secret" aslida 10 ta backup kod ekan
- Foydalanuvchi yuborgan 100-xonali hex = **10 ta backup kod (har biri 10 hex belgi)** ketma-ket yopishtirilgan
- TOTP raw secret esa faqat enroll paytida base32 ko'rsatiladi (`/admin/mfa/enroll`, otplib generateSecret → SHA1/6/30)
- DB'da secret AES-256-GCM'da `v{ver}:iv:tag:enc` formatida — hech qachon plaintext emas (kms.js)
- **Natija:** TOTP derivatsiya testlari (hex→bytes SHA1/256/512, ASCII) shu sababga ko'ra hammasi invalid bo'lgan — derivatsiya emas, MANBA noto'g'ri edi

### BUG-002: 🟡 Join kodi uzunligi nomuvofiqligi
- **Joy:** Landing "join" dialogi + `/play`
- **Tafsilot:** UI matn "Host tomonidan berilgan **5 xonali** kodni kiriting" deydi, lekin `landing.js` (q. 191–196) **5–7 xonali** kiritishga ruxsat beradi (`slice(0,7)`, tekshiruv `<5||>7`)
- **Xavf:** Foydalanuvchi 6-7 xonali kod kiritsa server tomonda nima qaytarishi aniqlanmagan (keyingi testda)
- **Severity:** 🟡 Minor

### BUG-003: 🟡 Footer'da 9 ta o'lik (placeholder) link
- **Joy:** Landing footer — "Hujjatlar" bo'limi va ftr.l5–l9 linklari
- **Tafsilot:** `href="#"` — hech qayerga olib bormaydi
- **Severity:** 🟡 Minor (UX)

### BUG-004: 🟡 MFA sahifasi matni chalkashtiruvchi
- **Joy:** `/user/mfa`, `/admin/mfa`
- **Tafsilot:** "Telefoningizdagi 6 xonali kodni kiriting" — SMS taassurot beradi. Aslida bu **TOTP** (authenticator ilova, "Kod har 30 soniyada yangilanadi"). SMS kutgan foydalanuvchi adashishi mumkin.
- **Severity:** 🟡 Minor (UX)

### BUG-005: ⚪ robots.txt yo'q (404)
- **Severity:** ⚪ Trivial (SEO)

### BUG-006: 🔴 Admin panel navigatsiyasida 5 ta buzilgan havola
- **Joy:** `/admin/dashboard` sidebar (`views/admin/dashboard.ejs` q.46–87)
- **Severity:** 🟠 Major (admin funksiyalari ochilmaydi)
- **Tafsilotlar (live tekshirildi, 2026-08-27):**
  | Nav link | Natija | Kod holati |
  |----------|--------|------------|
  | Camera Review → `/admin/camera-review` | **500** 🔴 | Route bor (routes/camera.js:211), lekin `views/partials/footer-scripts.ejs` MAVJUD EMAS → EJS include crash |
  | AI Question Gen → `/admin/question-gen` | **404** | View bor, GET route yo'q (faqat `/api/admin/ai-question-gen/*`) |
  | Presentation → `/admin/presentation` | **404** | View bor (presentation.ejs), route yo'q |
  | Intervention → `/admin/intervention` | **404** | View bor (intervention.ejs), route yo'q |
  | API Contracts → `/admin/contracts` | **404** | Route yo'q; ishlaydigan manzil `/admin/api-contracts` (200) — nav href noto'g'ri |
- **Statistika:** 37 nav linkdan 5 tasi buzilgan (13.5%)
- **Izoh:** TUZATILMAYDI — faqat hisobot

### BUG-007: 🔴 `/admin/camera-review` 500 — yetishmayotgan partial fayl
- **Severity:** 🟠 Major
- **Root cause:** `views/partials/footer-scripts.ejs` fayli yo'q, lekin uni 2 ta view include qiladi:
  1. `views/admin/camera-review.ejs` (q.88) → live'da 500 tasdiqlandi
  2. `views/user/camera-pilot.ejs` → xuddi shu xavf (user sessiyasida tekshiriladi)
- **Reproduksiya:** Admin panel → Camera Review → "Serverda xatolik yuz berdi" (500 HTML)

### BUG-008: 🟡 `/admin/logout` GET orqali, CSRF'siz
- **Joy:** `routes/auth.js:693` — `router.get('/admin/logout')` → `session.destroy()`
- **Xavf:** Logout-CSRF (tashqi saytdan havola orqali adminni majburiy chiqarish). `SameSite=Lax` qisman himoya
- **Best practice:** POST + CSRF token
- **Severity:** 🟡 Minor

---

## ✅ ADMINDA ISHLAYOTGAN QISMLAR (live tekshirildi)

| # | Tekshiruv | Natija |
|---|-----------|--------|
| A-01 | 30/37 admin sahifa | 200 OK |
| A-02 | 9 read-only API (/api/users, stats, results, audit, fans, pre-groups, cast/policies, teachers/pending, signup-reviews) | 200 OK |
| A-03 | Dashboard vizual (1440px, real brauzer) | Toza, 0 console xato |
| A-04 | /admin/users jadval: qidiruv, VIP toggle, o'chirish tugmalari | Ko'rinadi, UI toza |
| A-05 | MFA step-up arxitekturasi (adminMfaAt 30 daq, sensitive amallar) | Kode mavjud, loyihalangan |
| A-06 | Backup kod oqimi (login → MFA → backup code) | Ishlayapti (live tasdiqlandi) |

---

### BUG-009: 🔴 CSRF token JS regressiyasi — panel.ejs (LIVE TASDIQLANDI)
- **Joy:** `views/user/panel.ejs:578` (xuddi shu pattern `mfa.ejs:76`, `create-test.ejs:120` — repo'da)
- **Severity:** 🔴 Critical (i18n copy yo'qoladi; keyingi deployda MFA sahifasi ham singadi)
- **Root cause:** `window.__CSRF_TOKEN = <%= JSON.stringify(csrfToken || '') %>;` — `<%= %>` HTML-escape qiladi → `&#34;816a...&#34;` → **SyntaxError** → butun script blok o'ladi
- **O'lgan global'lar (live brauzerda tasdiqlandi):** `__RISK_COPY__` (undefined), `__ACCOUNT_COPY__` (undefined) — risk banner va akkaunt i18n matnlari ishlamaydi
- **Qutqarilgan:** `head.ejs:109` dagi toza token ishlayveradi (shuning uchun POST'lar hozircha OK — live test: session ping 204 ✅)
- **⚠️ Deploy xavfi:** live `mfa.ejs` hali eski (to'g'ri) versiya — repo'dagi main'ni deploy qilsalar MFA sahifasi ham singadi → "to'g'ri kod kiritdim-403 dedim" muammosi takrorlanadi
- **To'g'ri pattern (loyihadagi boshqa viewlar):** `window.__CSRF_TOKEN = '<%= csrfToken %>';`

### BUG-010: 🔴 create-test.ejs:119 — komentariyada literal `</script>` (LIVE TASDIQLANDI)
- **Joy:** `views/user/create-test.ejs:119` — izoh matni: "`</script>` breakout'ning oldi olinadi"
- **Severity:** 🔴 Critical (sahifa JS qismi o'lgan + manba kodi foydalanuvchiga ko'rinadi)
- **Mexanism:** HTML parser izoh ichidagi `</script>` ni haqiqiy yopuvchi tag deb o'qiydi → script blok ERTA tugaydi → qolgan JS **sahifa matni sifatida render bo'ladi** (live'da ko'rinadi: "` breakout'ning oldi olina...") va **umuman ishga tushmaydi**
- **Yon effektlar:** shu blokda `window.__CSRF_TOKEN` tayinlash ham bor — o'lik; console toza ko'rinadi (JS sifatida parse qilinmaydi) — yashirin bug
- **Tavsiya (hisobot uchun):** izohdagi `</script>` ni `<\/script>` qilib yozish yoki izohni o'zgartirish

### BUG-011: 🟠 mfa-settings.js:119 — MFA o'chirilgan foydalanuvchida crash (LIVE STACK)
- **Joy:** `/js/mfa-settings.js:119` — `enableBtn.addEventListener(...)` da `enableBtn = null`
- **Reproduksiya:** MFA'siz hisob (jasurjonai) → /user/security-profile → `TypeError: Cannot read properties of null (reading 'addEventListener')`
- **Ta'sir:** security-profile'dagi 2FA sozlash va undan keyingi funksiyalar ishlamasligi mumkin (IIFE 119-qatordan crash)
- **Sabab:** view holatga qarab elementni render qilmayapti, lekin JS uni doim mavjud deb hisoblaydi

### BUG-012: 🟠 Test Arena — `const $` qayta deklaratsiya konflikti (LIVE: 6 pageerror)
- **Joy:** `/js/main.js` (global `const $`) ↔ `/user/test-arena` inline script (`const $`)
- **Simptom:** `Identifier '$' has already been declared` ×6; arena global funksiyalari undefined
- **O'lgan kod (inline blok, 9.7KB):** `setStatus`, `updatePhoneScale`, `watchGame`, `scheduleAnswers` + `/arena/api/check-session`, `/arena/api/add-bots`, `/arena/api/cleanup-bots` chaqiruvlari
- **Ta'sir:** Test Arena jonli kuzatish/bot funksiyalari buzilgan

### BUG-013: 🟡 security-profile — teacher uchun student API 401
- **Joy:** `/api/student/assignments` (route: `routes/preflight.js:46`) teacher sessiyasida 401 (console noise ×4)
- **Sabab:** sahifa roldan qat'i nazar student endpointini chaqiryapti; endpointning student-only guard'i to'g'ri, sahifa role-aware bo'lishi kerak

### BUG-014: 🟡 /api/tests/save — role/VIP gate yo'q (biznes-qoida tekshiruvi kerak)
- **Joy:** `routes/user.js:285` — faqat `name` va `questions` tekshiriladi; `requireVip` middleware mavjud, lekin bu endpoint'da qo'llanilmagan
- **Kuzatish:** oddiy user (jasurjonai) create-test sahifasiga to'liq kiradi. Agar test yaratish teacher/VIP imtiyazi bo'lsa — server-side gate kerak

### BUG-015: ℹ️ "Kod to'g'ri bo'lsa ham 403" — tashxis yakuni
- **Live fakt:** `/api/mfa/verify` ISHLAYAPTI (to'g'ri kod → 200 `{"ok":true,"role":"teacher"}` — 3x tasdiqlandi)
- **Eng ehtimoliy sabablar (foydalanuvchi tomonida):**
  1. Authenticator'dagi **eski/stale TOTP yozuv** (secret rotate bo'lgan, eski yozuv qolgan) → server `invalid_code` 403
  2. Challenge TTL **5 daqiqa** (`CHALLENGE_TTL_MS`, mfa-totp.js) — kiritish kechiksa challenge o'ladi (`no_pending_challenge`)
  3. 5 xato urinish → **15 daqiqa hisob-level lock** (403 `locked`)
- **Qo'shimcha:** BUG-009 deploy bo'lsa MFA sahifasidagi CSRF ham singaydi → 403 aniq takrorlanadi

### BUG-016: 🟠 Expired lockout qayta "locked" + MANFIY retryAfterSeconds qaytaradi
- **Joy:** `src/modules/auth/mfa-totp.js:247-263` (`recordFailedAttempt`)
- **Live dalil:** `{"ok":false,"error":"invalid_code","retryAfterSeconds":-2931}` (2026-08-27)
- **Root cause:** eski lockout tugagach `lockoutUntil` DB'da o'tgan timestamp qoladi; yangi xatoda `fails < 5` bo'lsa `lockoutUntil = rec.lockoutUntil || 0` — o'tgan qiymat truthy → SAQLANADI; `locked = lockoutUntil > 0` → true → `retryAfterSeconds = ceil((eski_until - now)/1000)` = **manfiy**
- **Ta'sir:** 15 daqiqalik lock tugagach birinchi xato urinishdayoq foydalanuvchi `locked` javobini manfiy timer bilan oladi (client timeri buziladi, chalkash UX)
- **Tuzatish tavsiyasi (faqat hisobot):** `lockoutUntil <= now` bo'lsa 0 ga tushirish

### BUG-017: 🟡 README §2'da da'vo qilingan sahifalar 404 — dead views
- **Dalil (live, teacher+user):** `/user/sessions` 404, `/user/onboarding` 404, `/user/mfa-setup` 404
- **Kod:** `views/user/sessions.ejs` VA `views/user/onboarding.ejs` MAVJUD — route ulanmagan (dead views); mfa-setup haqiqiy manzil `/user/mfa/setup` (ishlaydi)
- **Ta'sir:** README foydalanuvchini mavjud bo'lmagan manzillarga yo'naltiradi

### BUG-018: 🟡 Web Push live'da o'chirilgan (README §6'da da'vo qilingan)
- **Dalil:** `GET /api/push/vapid-key` → `400 {"ok":false,"error":"push_disabled"}`
- **Kod:** route bor (routes/push.js, server.js:395) — env (VAPID) sozlanmagan
- **Ta'sir:** README'dagi "Web Push (/api/push/*)" hozir ishlamaydi

### BUG-019: ℹ️ README-vs-live chalkashliklar (to'plam)
| README da'vosi | Real holat |
|----------------|------------|
| `/cast/director`, `/cast/participant`... | Route'lar `/cast/:sessionId/director` ko'rinishda (sessiya ID talab); participant — `/play?code=` orqali. README manzillari to'liq emas (bosilsa 404) |
| Cast Director kirish yo'li | Teacher panelda to'g'ridan-to'g'ri link YO'Q (faqat cast-studio.css yuklanadi) — sessiya API orqali yaratiladi |
| opendata | `/api/opendata/stats` 200, lekin `isLive:false` (statik) |
| Registratsiya | ✅ ishlaydi (email verify banner); birinchi so'rov 90s+ cho'zilishi mumkin (SMTP) — timeout xavfi |
| Teacher ariza (admin tasdiqlaydi) | Registratsiyada experience/subject maydonlari bor ✅ |
| Passkey "real ishlaydi" | ✅ + `reauth_required` (parol qayta tasdiqlash — to'g'ri dizayn) |

### ℹ️ "3 xil UI" tashxisi (foydalanuvchi kuzatuvi TASDIQLANDI)
Loyihada **4 alohida UI qatlami** bor, har biri o'z dizayn va mavzu mexanizmi bilan:
| Qatlam | Dizayn | Mavzu boshqaruvi |
|--------|--------|------------------|
| Landing | Vintage/gold (landing.css) | 1 tugma, dark↔light (2 holat) |
| User/Teacher panel | Design-system ko'k (head.ejs tokens) | `panelThemeBtn` — light↔dark (2 holat; **System'ga qaytish YO'Q**) |
| Admin panel | Command UI (admin.css) | System/Light/Dark — 3 tugma (segmented) |
| Cast | cast-studio.css, `data-cast-theme` | OS'dan mustaqil (alohida) |

**Chalkashliklar:** (1) `theme-core`'da `hc-light/hc-dark` holatlari MAVJUD, lekin HECH QAYSI UI'da toggle YO'Q — yarim qolgan funksiya; (2) mavzu boshqaruvi har qatlamda har xil (1 tugma / 1 tugma / 3 tugma) — yagona tajriba yo'q; (3) panel System holatidan chiqib ketgan bo'lsa qaytarish imkoni yo'q

### ✅ README DA'VOLARI — TASDIQLANGANLAR (live)
| Da'vo | Holat |
|-------|-------|
| Admin login | ✅ |
| Login + ro'yxatdan o'tish | ✅ (test user: qa_tester_0827, email verify banner ko'rsatildi) |
| Talaba kod bilan /play | ✅ ("Bunday kod topilmadi" handler) |
| Google OIDC | ✅ (PKCE live) |
| MFA (TOTP) + backup | ✅ |
| User sahifalar (panel/create-test/arena/assignments/portfolio/settings/notifications) | ✅ 200 (JS darajasida BUG-009/010/011/012 bor) |
| security-profile | ✅ (MFA-off crash: BUG-011) |
| email-change, forgot/reset, mfa-setup | ✅ (mfa-setup = /user/mfa/setup) |
| Cast moduli arxitekturasi | ✅ live (kirish nuqtalari yashirin: BUG-019) |
| Gemini AI | ✅ LIVE: {"enabled":true,"model":"gemini-3.6-flash"} |
| Legal (/privacy, /terms, /cookies) | ✅ 200 |
| PWA (manifest, SW, /offline) | ✅ (SW ro'yxatdan o'tdi) |
| opendata | ✅ 200 (isLive:false) |
| Socket.io | ✅ v4.8.3 |
| Push | ⚠️ push_disabled (BUG-018) |
| 45+ admin sahifa | ⚠️ 30 OK; 5 nav buzilgan (BUG-006/007) |
| Mobil 375px | ✅ overflow yo'q (landing+panel) |

### BUG-020: 🟠 Cast qo'shilish FLAKY — birinchi urinish ishlamaydi ("cast ishlamayapti" ✅ TASDIQ)
- **Live dalil (A/B, 2026-08-27):** teacher API orqali sessiya yaratildi (`cast_HdxBU0Wz0sZo`, joinCode `FWRYEA`) → **birinchi** `GET /play?code=FWRYEA` oddiy o'yin-kod sahifasiga tushdi (participant render YO'Q, xato xabari HAM yo'q); bir necha daqiqadan keyin **xuddi shu manzil** "Cast — Ishtirokchi"ni ochdi
- **Sabab (kod):** `services/cast/session-store.js:142` `resolveSessionByCode` → FB `cast_codes/{code}` yozuvi; yozuv pishmasligi/kechikish bo'lsa `null` qaytadi va route **jim** o'yin-join sahifasiga qulaydi (game.js:141-149) — foydalanuvchiga "kod ishlamadi" ko'rinadi
- **Severity:** 🟠 Major (jonli darsning kirish eshigi nozik)
- **Tavsiya:** resolve fail bo'lsa "Sessiya hozir tayyorlanmoqda" xatosi yoki retry

### BUG-021: 🟡 Director lobbi meta API 404 — o'lik chaqiruv
- **Joy:** `public/js/cast-director.js:183` → `GET /api/cast/sessions/:id/meta`
- **Dalil:** live'da 404; `routes/cast.js`'da bunday GET route yo'q; JS'da `try/catch` bilan **jim yutiladi**
- **Ta'sir:** director lobbi ma'lumoti hech qachon yangilanmaydi

### BUG-022: 🟠 Canva — status "configured" deydi, link "not configured" (qarama-qarshi)
- **Dalil (live, admin):** `GET /api/admin/canva/status` → `{"configured":true,...}`; lekin `POST /api/admin/canva/link` → `400 {"error":"Canva not configured"}`
- **README zidi:** README "kod tayyor — konsol URI kutilmoqda" deydi
- **Foydalanuvchi talabi:** ishlamaydigan integratsiya "sozlanmagan" holatida ko'rsatilishi yoki yashirilishi kerak — hozir tugma bosilsa xato
- **Slides:** ✅ OAuth link 200 — ishlayapti; Gamma butunlay yo'q (README to'g'ri)

### BUG-023: 🟠 DARK MODE: admin yashil tugmalar deyarli KO'RINMAYDI (kontrast 1.04)
- **Usul:** Playwright + WCAG kontrast, `data-theme-state=dark`, barcha admin sahifalar skan
- **Aniq elementlar:** `/admin/marking` "Taqsimlash", `/admin/grading` "Hisoblash", `/admin/board` "Blocker'larni tekshirish" / "Release to SIS" — `.btn.green` **1.04**
- **Dalil:** `qa/evidence/22_dark_admin.png`
- **Bu "dark mode'da umuman ko'rinmayapti" shikoyatining aniq manbalaridan biri**

### BUG-024: 🟠 DARK MODE: Test Arena javob inputlari o'qilmaydi (kontrast 1.17)
- **Joy:** `/user/test-arena` raqamli inputlar
- **Ta'sir:** talaba dark'da o'z javobini ko'rmaydi — imtihon vaziyatida kritik

### BUG-025: 🟡 DARK MODE: /admin/teachers badge va link qiyin (1.58 / 1.81)
- **Elementlar:** "0 kutilmoqda" badge, "Kutilmoqda" havolasi

### BUG-026: 🟡 "Maqola tavsiya" funksiyasi end-user'da UMUMAN YO'Q
- **Kod:** resource-reco moduli bor (`src/modules/resource-reco/`) — lekin FAQAT admin: `/admin/resource-reco` + API (requireAdmin)
- **Live dalil:** teacher/student panellari DOM'ida "maqola"/"tavsiya" 0 marta
- **Foydalanuvchi talabi:** talaba/teacher/VIP ko'rishi kerak — hozir admin qutvida yotibdi

### BUG-027: 🟡 "Talab / Teacher-tekshiruvchi" nazorati faqat admin'da + statistika chuqur emas
- **Holat:** teacher arizalari `/admin/teachers` (approve/reject + pending badge) va signup-reviews — **requireAdmin qulfda** (teacher sessiyasiga 401)
- **Foydalanuvchi talabi:** (a) bu bo'limlar teacher/VIP interfeyslarida ham ko'rishi kerak; (b) admin bosganda ULAR USTIDAN nazorat va STATISTIKA chiqishi kerak (hozir faqat ro'yxat + pendingCount; trend yo'q)

### BUG-028: 🟡 Admin kirish arxitekturasi foydalanuvchi talabiga mos emas
| Talab | Live holat |
|-------|-----------|
| Admin login ALOHIDA PAGE (modal emas) | Landing "Admin" tugmasi **modal** ochadi; `/admin/login` bor lekin landing yo'li modalga |
| 3-chiziq ICHIDA yana 3-chiziq → admin login | Hamburger FAQAT 1 daraja; `#adminBtn` to'g'ridan-to'g'ri modal (landing.js:221-224) |
| Teacher "adminka so'rovi" 3-chiziq ichida alohida | Yo'q — oddiy registratsiya formasi ichida (experience/subject) |
| Oddiy kirish → pastga scroll | ✅ `#auth` anchor ishlaydi |

### BUG-029: 🟡 Admin sidebar — kichik ekranda "7-8 ko'rinadi" to'g'ri
- **Dalil:** 1440×900'da 47 tugma ko'rinadi; **1366×768'da 20+ tugma fold ostida**; mobilda drawer ortida
- **Foydalanuvchi talabi:** "kirganda hamma funksiya bir ko'rinishda" — hozir guruh+skrol

### BUG-030: ℹ️ "O'chirishda ikki marta tasdiq" — kodi darajasida TOPILMADI (open item)
- **Kod:** admin `deleteUser/deleteFan/deletePreGroup` — **birmartalik** `showConfirm`; teacher test delete — `workspace-library.js:253` birmartalik
- **Live test:** teacher testi 1 klik+1 tasdiqda o'chdi (sahifa reload — "ikki marta bosdim" hissi shundan bo'lishi mumkin)
- **Ehtimol:** dialog birinchi klikni yutishi (fokus/z-index) — interaktiv replar keyingi stepda

### BUG-031: ✅ AI va Slides backend LIVE — "AI ishlamayapti" UI qatlamida
- **Dalil:** `POST /api/ai/generate-questions` (teacher, prompt) → **200 real savollar** (uz, 4 variant); `slides/link` → 200 OAuth URL
- **UI:** create-test save `test-builder.js` orqali (tashqi, tirik); inline blok BUG-010 dan o'lik — AI tugmalari shu blokda bo'lsa ishlamaydi; Director ⚡ Quick Prompt — STEP 52-53'da
- **Xulosa:** "AI ishlamayapti" ehtimol UI simlanishi yoki Director oqimida — backend sog'lom

### BUG-032: 🟡 User logout ham GET + CSRF'siz (admin'dagi bilan bir xil zaiflik)
- **Joy:** `routes/auth.js:2330` — `router.get('/user/logout')`
- **Ta'sir:** logout-CSRF: tashqi sahifadan `<img src=".../user/logout">` bilan foydalanuvchini majburiy chiqarish mumkin (SameSite=Lax top-level GET'da cookie yuboradi)
- **Ijobiy:** remember-token revoke + push token revoke mantiqi bor — lekin himoya POST+CSRF bo'lishi kerak edi

### BUG-033: 🟠 VIP holat UI'da UMUMAN ko'rsatilmaydi
- **Live dalil:** jasur (VIP) panel: badge **"Talaba @jasur"** — VIP/Premium belgisi yo'q
- **Kod:** `routes/user.js:139` `isVip` faqat kontent yuklash uchun (fans/preGroups); **UI badge/render yo'q** (`roleLabel` student default)
- **Foydalanuvchi talabi:** "VIP userlar shu yerdan kiradi" — VIP farqi ko'rinishi kerak edi

### BUG-034: 🟡 Teacher tab nomlari hardcoded EN — uz i18n aralash
- **Joy:** `views/role/teacher.ejs:26,29` — "Overview", "Grading queue" (tarjimasiz), qolgan tablar uz
- **Ta'sir:** bir menyuda ikki til aralash

### BUG-035: 🟠 IKKI XIL registratsiya formasi — teacher o'zini landing'dan topolmaydi
- **Dalil (live DOM):** Landing `#fReg`: faqat name/email/username/password — **rol tanlash YO'Q**, consent `hidden value="on"`, device_fp yo'q. `/user/login` `#form-reg`: + role tanlash (teacher ariza, shartli experience/subject), consent YUBORILMAYDI, device_fp bor
- **Ta'sir:** landing'dan ro'yxatdan o'tgan hamma **student** bo'ladi; teacher istaganda rol tanlashni umuman ko'rmaydi — "teacher register qilolmaydi" shikoyatining asosiy manbalaridan biri; forma konfiglari sinxron emas

### BUG-036: 🟡 Consent mexanizmi nomuvofiq — landing'da AVTOMATIK rozilik
- **Joy:** `views/index.ejs` fReg: `input type=hidden name=consent value=on`
- **Ta'sir:** rozilik checkboxi ko'rsatilmaydi — forma consent'ni o'zi yuboradi (privacy me'yorida consent faol harakat bo'lishi kerak); /user/login formada esa umuman yuborilmaydi — bir oqim, ikki xil legal holat

### BUG-037: 🟡 Logout havolasi desktop'da ko'rinmas holatda
- **Live dalil (1440x900):** `/user/logout` havolasi `offsetParent: null` (drawer/fold'da), `elementFromPoint` → sidebar head bloklaydi
- **Ta'sir:** foydalanuvchi "Chiqish"ni topa olmaydi; topa qolsa ham GET (BUG-032)

### BUG-038: IJOBIY — Auth mayda elementlari professional darajada (xato topilmadi)
| Element | Holat |
|---------|-------|
| Landing tablar (login/reg) | ishlaydi |
| Reg bo'sh submit validatsiya | 4 maydon invalid, xato bloklari bor |
| Parol eye toggle / kuchi indikatori / CapsLock | bor |
| Honeypot, remember-me, autocomplete | to'g'ri |
| Forgot link | /user/forgot?lang=uz |
| aria-live xato bloklari | 8 ta |
| #auth anchor scroll | ishlaydi (861px) |
| Hamburger mobile | ochiladi |
| i18n uz/ru/en tugmalari | bor |
| User logout oqimi | ishlaydi (panel qayta login talab qiladi) |
| Teacher workspace 4 tab | hammasi ochiladi |
| Student panel empty states | ko'rsatiladi |
| Session idle TTL | 30 daqiqa default (env.js:37) |

### BUG-039: 🔴 Registratsiya POST ba'zan 90-180s TIMEOUT (takrorlangan 2x)
- **Live dalil:** 2026-08-27 — 2 xil testda `POST /user/login (mode=reg)` **180s va 90s+ timeout**; bir xil so'rov keyinroq 0.4s da o'tdi (user yaratilgan edi). Login POST o'sha paytda 1.7s — faqat reg sekin
- **Root cause (kod):** reg oqimi **sinxron email yuboradi**: `routes/auth.js:2033` `await sendVerifyCode(...)` → `email-verify.js:159` `await sendEmail(...)` → `provider.js:350` `sendViaSmtp` — **nodemailer transportda timeout sozlanmagan** (`createTransport`'da `connectionTimeout/socketTimeout/greetingTimeout` yo'q) + `RETRY_DELAYS_MS=[1s,3s,9s]` — SMTP sekin bo'lsa so'rov minutlar blok
- **Ta'sir:** foydalanuvchi forma yuboradi, cheksiz spinner → timeout → qayta yuboradi → "allaqachon mavjud" xatosi (chalkash; dublikat urinish)
- **Tavsiya (hisobot):** SMTP transportga qisqa timeout (5-10s) + emailni queue'ga async (queue.js mavjud, lekin bu yo'lda ishlatilmagan)

### BUG-040: 🟠 Teacher ariza sahifasi landing'dan TOPILMAYDI — oqim uzilgan
- **Tuzilma (kod+live):** to'liq teacher registratsiyasi `/user/register` sahifasida: rol kartalar (Talaba/O'qituvchi), teacher tanlansa Universitet/Fan/Tajriba/Maqsad dinamik ochiladi (live ✅), invite kod, consent CHECKBOX (to'g'ri!), device_fp, honeypot ("Website")
- **Muammo:** landing'dagi 4 ta havola hammasi `#auth` (oddiy fReg'ga); `/user/register`ga havola YO'Q — faqat bilib topiladi
- **Ta'sir:** landing'dan ro'yxatdan o'tgan teacher bo'lish imkoniyatidan xabardor bo'lmaydi; `role=teacher` kelmasa `wantsTeacher=false` → hamma student (BUG-035 davomi)
- **Server mantiq:** `role=teacher` → `teacher_pending` roliga o'tadi, `/user/teacher-approval` ekrani (auth.js:2185) — oqim to'liq, lekin topilmaydi

### BUG-041: 🟡 `/user/teacher-approval` auth'siz 401 JSON qaytaradi
- **Dalil:** `GET /user/teacher-approval` (guest) → 401 xom JSON (65B)
- **Ta'sir:** sessiya tugagan foydalanuvchi dizaynsiz JSON ko'radi (sahifalar HTML/login redirect bo'lishi kerak)

### BUG-042: 🟡 Admin login page vs modal kontenti nomuvofiq
- **Dalil (live):** `/admin/login` page'da MFA eslatma matni bor, faqat bosh sahifa havolasi; landing modal'da MFA ma'lumoti YO'Q — bir xil amal, ikki xil kontent
- **Ta'sir:** foydalanuvchi talab qilgan "alohida page" MAVJUD va funksional — lekin landing uni modalga yo'naltirib page'ni yashiradi (BUG-028 bilan bog'liq)

### BUG-043: ✅ IJOBIY — Teacher ariza formasi (/user/register) to'liq va professional
- Live DOM: rol kartalar (radio, Talaba default), teacher tanlovida 4 maydon dinamik, invite toggle, consent checkbox (unchecked — to'g'ri), honeypot, prevRole/prev* saqlanadi (B-03), server zod validatsiya (B-29) — arxitektura to'g'ri, FAQAT topilmayapti (BUG-040)

### BUG-044: 🔴 Arena "Yuklash" tugmasi O'LIK — `loadArena is not defined` ("sinov ishlamayapti" ✅ TO'LIQ ISBOT)
- **Live dalil (bosilganda):** `pageerror: ["Identifier '$' has already been declared", "loadArena is not defined"]`, API chaqiruv: 0 ta, visual javob yo'q
- **Zanjir:** BUG-012 (`/js/main.js` global `const $` ↔ arena inline `const $`) → inline script SyntaxError → `loadArena`/`addBots`/`cleanupBots` umuman tuzilmaydi → asosiy "Yuklash" tugma jim
- **Qo'shimcha:** `source=user` + testsiz holatda empty-state YO'Q — foydalanuvchi o'lik tugmani bosadi, hech narsa bo'lmaydi
- **Ta'sir:** "Sinov rejimi" real brauzerda **to'liq ishlamaydi** — "sinov ishlamayapti" shikoyatining aniq texnik manbasi
- **Izoh:** backend `/arena/api/*` tirik — muammo FAQAT frontend simlanish

### BUG-045: 🟡 /sessions — qurilmalar "Noma'lum qurilma/brauzer" + dublikat qatorlar
- **Dalil (live):** 4 sessiyadan 3 tasi "Noma'lum qurilma", **JORIY QURILMA ham**; bir xil IP 2 qator (joriy + 22 min) — qurilma bo'yicha guruhlanmagan
- **Ta'sir:** foydalanuvchi qurilmalarni ajrata olmaydi → "shubhali qurilmani o'chiring" maslahati ishlamaydi
- **Izoh:** headless UA parse qilinmasligi mumkin — real brauzerda qayta tekshirish kerak (open item)

### BUG-046: 🟡 Notifications sozlamalari — mavjud bo'lmagan kanallar default ON
- **Dalil (live DOM):** `ch_telegram` **checked=true** (Telegram integratsiyasi env kutilmoqda — README), `ch_push` checkbox bor (lekin push_disabled — BUG-018)
- **Ta'sir:** foydalanuvchi ishonch bilan yoqadi, xabarlar kelmaydi

### BUG-047: 🟡 Sessions sahifasi yo'li README'da noto'g'ri
- **Dalil:** real sahifa **`/sessions`** (200, route: `routes/session.js:101`); README §2 va dead view `user/sessions.ejs` `/user/sessions` deydi → 404 (BUG-017 bilan bog'liq; security-profile havolasi to'g'ri)

### BUG-048: ✅ IJOBIY — Student panel bloklari asosan toza (live tekshirildi)
| Blok | Holat |
|------|-------|
| /user/assignments | toza empty state, Preflight arxitekturasi bor |
| Panel natijalar/topshiriqlar | empty state'lar professional ("Birinchi testingizni yaratin") |
| VIP upsell | "Tayyor to'plamlar — VIP imkoni" studentga ko'rinadi |
| /user/portfolio | privacy chip, item-share, public /share/:token link-gated (README mos) |
| /user/notifications | granular prefs (kanallar + turlar), empty state bor |
| /sessions | ishlaydi, revoke tugmalar, "Barchasini o'chirish" |

### BUG-049: 🔴 cast-director.js — `$` helper mos emaslik: Director sahifasi (jonli dars pulti) katta qismi O'LIK
- **Root cause (kod):** `public/js/cast-director.js` — `const $ = (id) => document.getElementById(id);` lekin qator 1203: `$('#qp-close').addEventListener(...)` — **hash bilan** chaqiruv → `getElementById('#qp-close')` = null → TypeError → **butun IIFE 1203-da o'ladi**
- **Statistika:** 1203-dan OLDIN `$('#…')` x26 (callback'larda — ishlatilganda crash), KEYIN **x160 — umuman ishlamaydi**
- **Live dalil:** `pageerror: "Cannot read properties of null (reading 'addEventListener')" at cast-director.js:1203:17 (2504:3)`; lobbi **"Kod: —"** (join kod ko'rsatilmaydi — sessiyada kod bor, BUG-020 API testida proven)
- **Ta'sir:** jonli dars pulti: Quick Prompt (⚡ AI yozib beradi — README flagman da'vosi) buzil; kod ko'rsatish va keyingi handlerlar o'lik. Static tugmalar ko'rinadi lekin ko'plari javob bermaydi
- **Boshqa cast fayllar toza** (participant/projector/results/replay: 0 hash-chaqiruv) — faqat director
- **Tavsiya (hisobot):** `$`ni `document.querySelector`ga o'zgartirish yoki hash'siz chaqirish
- **Bu "cast ishlamayapti" shikoyatining ENG KATTA texnik manbasi** (BUG-020 flaky join bilan birga)

### BUG-050: 🟡 Create-test: bitta "Saqlash" bosilishiga 2xPOST /user/api/tests/save
- **Live dalil (Playwright):** saqlash → `POST 200 x2` (autosave debounce + manual yoki double-fire); "Saqlandi" ko'rsatildi
- **Ta'sir:** server idempotent bo'lmasa dublikat xavfi; trafik 2x
- **Tavsiya:** scheduleSave va manual save orasida in-flight guard

### BUG-051: ✅ IJOBIY — Create-test UI E2E + Excel + Cast Studio wizard ISHLAYDI (real brauzerda)
| Oqim | Natija |
|------|--------|
| Test yaratish UI (nom → savol → matn/variantlar/to'g'ri javob → Saqlash) | "Saqlandi", POST 200, 0 pageerror (test-builder.js tirik) |
| Savol turlari | 5 tur: single_choice, true_false, multiple_select, short_answer, exit_ticket |
| Excel import | modal + 2 qadam (Shablon → Yuklash), accept=.xlsx,.xls |
| Excel shablon download | ishlaydi (download event) |
| Cast Studio wizard | 4 preset (Responsive Accuracy/Tavsiya, Classic Live, Team Challenge, Formative Check) + sozlamalar → "Lobbi ochish" → preflight+sessions 200 → /cast/:id/director ("Cast — STEP5 UI Testi") |
| Dalillar | 28, 29, 31, 32, 33, 34 PNG (qa/evidence) |

### BUG-052: 🔴 Cast participant JOIN buzilgan — "Qayta ulanmoqda…" + `undefined (setting 'promise')` crash
- **Live dalil (student, mobil 480px):** join kod+ism kiritilib "Qo'shilish" bosildi → sahifada **"Cannot set properties of undefined (setting 'promise')"** xom matn + **"Qayta ulanmoqda…"**; director'da ishtirokchi soni **0** (QA Talaba ko'rinmadi — 2 urinishda ham)
- **Root cause (kod):** `public/js/cast-socket-client.js:75` — double-submit guard `this.pendingAcks.get(commandId).promise`ni o'qiydi, lekin `.set(commandId, {promise...})` faqat 105-qatorda bo'ladi; retry/tez chaqiruv race'ida `.get()` undefined → crash
- **Simptom:** status doim "Ulanish…/Qayta ulanmoqda…" — join ACK ololmayapti
- **Ta'sir:** **talaba jonli darsga qo'shilolmaydi** — asosiy user-oqimi (BUG-049 + BUG-020 bilan Cast deyarli ishlamay holatda)

### BUG-053: 🟠 Participant sahifasi MOBILDA 1168px gorizontal OVERFLOW (480px viewport)
- **Dalil:** `scrollWidth 1168 vs clientWidth 480`; "👀 Kuzatuv" karta va "✅ Ko'rdim" tugma **viewport tashqarisida** (Playwright 30s click qilolmadi — "element is outside of the viewport")
- **Ta'sir:** talaba telefonida join/kuzatuv bilan ishlash imkonsiz; desktop'da toza

### BUG-054: 🟡 Join formada karta raqami maydoni rejim tanlanmasdan ham ko'rinadi
- **Dalil:** forma: Join kod (avto ✅), Ism, "Karta raqami (CARD-001)" hozirroq ko'rinadi, Sinfda/Uzoqdan tanlov
- **Ta'sir:** chalkashlik — qaysi maydon qachon majburiyi nomaqlum

### BUG-055: ✅ IJOBIY — Participant sahifa arxitekturasi (statik) professional
| Element | Holat |
|---------|-------|
| Join formasi | kod avto-to'ldiriladi, ism/karta/in-room-remote |
| PoE bloklari | Kuzatuv, Tushuntirish, confidence tugmalar, "Juda tez/Texnik muammo" feedback |
| Wall/Forge | savol devori + AI manba kiritish UI |
| Step indikator | 1 Kod → 2 Ism → 3 Lobbi |
| Socket klient | command envelope, ACK, dedupe, retry arxitekturasi tayyor |

### BUG-056: 🔴 AI Question Generator (admin) ISHLAMAYDI — "PostgreSQL required"
- **Live dalil (admin sessiya, to'liq payload):** `POST /api/admin/ai-question-gen/blueprints` → `400 {"ok":false,"error":"PostgreSQL required"}`; ro'yxat `blueprints:[]`
- **UI qo'shimcha:** "+ Blueprint yaratish" tugma live'da **403** qaytadi (UI payload format bilan muvofiqligi buzilgan) — foydalanuvchiga yashirin xato
- **Kod:** `routes/ai-question-gen.js:63` — blueprint yaratish PG talab qiladi; Render'da Postgres yo'q
- **Ta'sir:** README §3 da'vosi ("ai-question-gen blueprint/job pipeline") **butunlay ishlamaydi**; sahifa ochiladi lekin funksiya yo'q, xato yashirin
- **Tavsiya:** env to'ldirish yoki sahifada "PostgreSQL sozlanmagan" holati ko'rsatilishi

### BUG-057: 🟡 Claude Adapter sahifasi — "API key: noma'lum"
- **Dalil (live):** `/admin/claude` — "API key: noma'lum" (10 ta boshqaruv elementi)
- **Ta'sir:** holat aniq ko'rsatilishi kerak (Canva bilan bir xil dizayn muammosi, BUG-022)

### BUG-058: ✅ IJOBIY — AI zonalari holati (live)
| Zona | Holat |
|------|-------|
| `/api/ai/generate-questions` (teacher) | 3/3 so'rov 200 — real savollar |
| Director ⚡ Tezkor savol | Tugma+overlay+placeholder bor — lekin ochilishi BUG-049 qurboni (`orb-overlay` click to'sadi) |
| /admin/ai-question-gen | sahifa 200, modul PG'siz o'lik (BUG-056) |
| /admin/ai-grading (Shadow), ai-checkpoint, ai-mlops, claude | sahifalar 200, navigatsiya toza |
| rate limit 12/daq | 3 tezkor so'rovda 429 yo'q — to'g'ri |

### BUG-059: 🔴 IMTIHON MODULLARI EPIDEMIYASI — 6 sahifada JS O'LIK (global `$` konflikt + sintaksis)
- **Live dalil (admin, har sahifada pageerror):**
  - /admin/scheduler: `Identifier '$' has already been declared` — Solver/Versions/Xonalar o'lik
  - /admin/seating: xuddi shu — Seat-map/Check-in o'lik
  - /admin/paper: xuddi shu — QR/chain-of-custody o'lik
  - /admin/grading: xuddi shu — Rule/Hisoblash o'lik
  - /admin/scan: `missing ) after argument list` — OMR/Reconciliation o'lik
  - /admin/roster: 5 dead btn (fayl import interaktivligi shubhali)
- **Root cause 1:** `public/js/main.js:6` — `const $ = ...` GLOBAL scope'da (IIFE emas), `partials/head.ejs:100` orqali HAR sahifada yuklanadi; `scheduler.js:16`da ham global `const $` → qayta deklaratsiya → butun fayl o'ladi
- **Root cause 2:** `views/admin/scan.ejs` inline JS: `showMsg('Sahifa qo'shildi: ...')` — apostrof escape qilinmagan (node --check bilan isbotlandi)
- **Ta'sir:** imtihon boshqaruvning 6 moduli (README §5 da'vosi) faqat vizual — interaktiv funksiya yo'q
- **Tuzatish pattern:** main.js IIFE + scan.ejs apostrof escape

### BUG-060: 🟡 "Mock Fanlar" atamasi — demo/real holat chalkash
- **Dalil:** /admin/roster sidebar'da "Mock Fanlar" havolasi — admin real/demo ma'lumotni ajrata olmaydi

### BUG-061: ✅ IJOBIY — 3 modul toza + elementlar
- /admin/marking, /admin/board, /admin/consideration: 0 pageerror, to'liq tugma to'plamlari (Assignment/Taqsimlash/Kalibratsiya, Meeting/Ratify/Release to SIS, Case/Incident)
- Dalillar: 41–49 PNG

### BUG-062: 🟡 Delete muvaffaqiyatsiz (boshqa user'ning / mavjud emas key) ham `{"success":true}` qaytaradi
- **Live dalil:** student `POST /user/api/tests/delete {key: teacher_testi}` → `200 {"success":true}` (aslida hech narsa o'chmadi); mavjud emas key ham `success:true`
- **Kod:** `routes/user.js:342` — route owner-scoped (`req.session.user.safeKey`), lekin `fb.remove()` natijasi tekshirilmaydi
- **Ta'sir:** foydalanuvchi boshqa user testini o'chira olmaganini bilmaydi — "o'chirildi" deb ishonadi
- **Ijobiy (tasdiqlandi):** owner-scoped dizayn **IDOR'ni to'liq to'sadi** (definitiv test: student teacher yangi testini o'chira olmadi — panelida qoldi; export: student→teacher 404, teacher o'zi 200)

### BUG-063: 🟡 Content-Security-Policy header YO'Q
- **Dalil:** `curl -I` — CSP 0 moslik; HSTS/nosniff/X-Frame-Options/referrer-policy bor (helmet qisman)
- **Ta'sir:** deep-defence yo'q (inline script'lar ko'p — CSP qiyin, lekin report-only'dan boshlash mumkin)

### BUG-064: ✅ IJOBIY — Xavfsizlik asosi mustahkam (live tekshirildi)
| Tekshiruv | Natija |
|-----------|--------|
| IDOR: student → teacher test delete/export | bloklangan (owner-scoped safeKey) |
| testKey guessability | 10-belgi base36 crypto random, guess'lar 404 |
| Open redirect (returnUrl=evil, //evil) | himoyalangan (302→panel / 403) |
| Role escalation endpointlari (student) | 404 |
| Cookie flags (student+admin) | HttpOnly + Secure + SameSite=Lax |
| Login rate limit | max 15/account (C-01 test bilan hujjatlashtirilgan) |
| XSS: `<script>` nom saqlash → panel | escape qilingan; export JSON+attachment (xavfsiz) |

### BUG-065: 🟡 Admin dashboard "Namuna fanlar" — sahifa ochilganda "Yuklanmoqda..." abadiy qotadi
- **Live dalil:** /admin/dashboard ochilganda #fans-list = "Yuklanmoqda..." (2.5s+), hech qanday API chaqiruv yo'q; "Yangilash" tugma bosilsa loadFans() ishlaydi
- **Root cause:** routes/admin.js:84 activeTab: req.query.tab || 'danger' — default tab 'danger', lekin refreshActiveTab() FAQAT fans/pre/results/stats/vip tablarini yuklaydi; sahifa ochilganda chaqirilmaydi
- **Ta'sir:** admin fanlarni ko'rish uchun har safar "Yangilash" bosishi kerak; natijalar bloki ham xuddi shu pattern'da
- **Ijobiy tomoni:** qo'lda "Yangilash" ishlaydi (116 foydalanuvchi, 145 test real; qidiruv "jasur" filtrlaydi)

### BUG-066: ✅ IJOBIY — VIP grant/revoke oqimi to'liq ishlaydi (negativ testlar bilan)
| Test | Natija |
|------|--------|
| VIP berish (real user) | 200 "VIP huquqi berildi" (parol ko'rsatilmaydi — S33.03) |
| Yo'q user'ga grant | 404 "Bunday foydalanuvchi topilmadi" |
| CSRF: token'siz / boshqa sahifa tokeni | 403 blok (per-page token scope — qattiq) |
| Evil origin POST | 403 ORIGIN_BLOCKED |
| Statistika real | 116 foydalanuvchi / 0 o'yin / 145 test |
| Users qidiruv "jasur" | filtri ishlaydi |
| Natijalar bloki | real userlar bilan |
| pageerror | 0 |

### BUG-067: 🔴 Session keepalive ping CSRF'siz — 403 → idle timeout davom etirilmaydi
- **Live dalil:** panel ochiq + `POST /api/session/ping` (x-csrf-token bilan ham) → **403 "CSRF token validation failed"**
- **Root cause (kod):** `public/js/components/session-timeout.js:83,96` — keepalive fetch **faqat Content-Type** header yuboradi, `x-csrf-token` YO'Q; server `server.js:293 validateCsrf` BARCHA POST'larda talab qiladi
- **Ilova:** panel.ejs'dagi o'lik blok (BUG-009) global `__CSRF_TOKEN`'ni buzadi — lekin session-timeout.js umuman token ishlatmaydi, demak ikkala bug mustaqil
- **Ta'sir (jadval bilan):** foydalanuvchi sahifada faol bo'lsa-da, "Davom etish" / keepalive 403 bilan yiqiladi → SESSION_IDLE_TIMEOUT_MS (30 daq) tugagach majburiy chiqariladi; "sessiya uzaytirish" funksiyasi nominal
- **Tuzatish (hisobot):** fetch'ga `x-csrf-token: window.__CSRF_TOKEN` qo'shish

### BUG-068: 🟡 Admin "Barcha sessiyalarni yakunlash" — 5 sessiya revoke deb hisoblaydi, lekin foydalanuvchi sessiyasi TIRIK qoladi
- **Live dalil:** `POST /admin/api/users/revoke-sessions {key: jasurjonai}` → `200 {"success":true,"count":5}`; foydalanuvchi keyin panel ochsa → **200, sessiya ishlayveradi** (connect.sid o'zgarmagan)
- **Kod:** `session-manager.js:79 revokeByUser` — `destroySessionInStore(realSid)`; count=5 — eski/merchant session record'lari sanalgan, joriy live sessiya record'i bo'lmasa (yoki remember-me qayta login qilmasa) foydalanuvchi ichida qolaveradi
- **Ta'sir:** admin "xavfsizlik uchun chiqarildi" deb ishonadi — amalda foydalanuvchi tizimda; hisob yopish/o'chirish kabi amallarda kritik farq
- **Keyingi tekshiruv:** remember-me auto-relogin oqimi bilan birga (STEP 67-68'da)

### BUG-069: ✅ IJOBIY — Audit tizimi to'liq funksional (live)
| Tekshiruv | Natija |
|-----------|--------|
| /admin/audit sahifa | 200 |
| api/audit | 200 — real yozuvlar (auth:risk:scored...) |
| action filtri (auth.login) | ✅ faqat shu action (25 item) |
| aggregates | ✅ login_success:41, login_fail:2, hibp_hit... |
| export CSV | ✅ 31KB, header qo'shtirnoq bilan, formula-injeksiya yo'q |
| Remember-me | ✅ deborah_remember cookie (selector:verifier, Max-Age 30 kun, Expires set) |
| SessionTimeout client | ✅ obj mavjud (lekin BUG-067 keepalive 403) |

### BUG-070: 🟡 Landing tema tugmasi aria-pressed YO'Q
- `#themeBtn` aria-label bor, aria-pressed/title yo'q (WCAG 4.1.2) — screen reader holatni bilmaydi

### BUG-071: 🟠 Footer LEGAL linklari "#" — sahifalar MAVJUD turibdi!
- **Dalil (live DOM):** footer'da "Maxfiylik siyosati", "Foydalanish shartlari", "Xavfsizlik", "Qonuniy ma'lumotlar" — HAMMASI `href="#"`; "hello@deborah.uz" ham `href="#"` (mailto emas)
- **Zid:** `/privacy`, `/terms`, `/cookies` sahifalari LIVE (200, BUG-001 tekshiruvida) — lekin footer ulanmagan!
- **Ta'sir:** foydalanuvchi qonuniy hujjatlarni saytdan topa olmaydi (hushtaq emas — privacy qonuni talab qiladi ko'rinishini); email bosilmaydi

### BUG-072: 🟡 Landing `GET /` — `lang` cookie'siga qaramaydi (server-side i18n nomuvofiq)
- **Dalil:** `Cookie: lang=ru` bilan `GET /` → `<html lang="uz">`, matnlar uz; `GET /user/login` → ruscha ✅
- **Ta'sir:** foydalanuvchi tilni tanlagan (client JS doc lang o'zgartiradi) — lekin server render har doim uz; RU foydalanuvchi refresh'da miltillab uz ko'radi va SEO ikki tilli aralash

### BUG-073: 🟡 Til tanlovu saqlanmaydi (localStorage/cookie yo'q)
- **Dalil:** RU bosilgach: `localStorage.getItem('lang')` = null, cookie'da lang yo'q; faqat `document.documentElement.lang='ru'` (client memory)
- **Ta'sir:** yangi tab/refreshdan keyin tanlov yo'qolishi mumkin (reload'da client JS hozircha qayta qo'yadi — lekin boshqa tabda yo'q)

### BUG-074: 🟡 Reg forma xabar bloki (`#doneReg`) role/aria-live YO'Q
- **Dalil:** `role=null`, `aria-live=null` — JS orqali qo'shiladigan "muvaffaqiyat/xato" xabar screen reader'ga yetmaydi (WCAG 4.1.3 Status Messages)

### BUG-075: 🟡 Mobil hamburger menyu — body scroll-lock YO'Q
- **Dalil (375px):** menyu ochiq holatda `body.overflow = hidden auto` (scroll mumkin), `position: static` — fonda sahifa aylanadi (modal UX konventsiyasiga zid; menyu tashqarisiga tegsa yopiladi lekin scroll chiqib ketadi)

### BUG-076: 🟡 `#admin` anchor mavjud emas — nav/menyu `href="#admin"` bo'sh hash
- **Dalil:** `#main/#cast/#kontakt/#auth` mavjud; `#admin` YO'Q (JS interceptor bilan modal ochiladi)
- **Ta'sir:** JS o'lsa (devlar) link hech qayerga olib bormaydi; a11y'da "link" e'lon qilingan amal tugma bo'lishi kerak edi

### BUG-077: ⚪ `nav.cast` uch tilda tarjimasiz ("Cast")
- **Dalil:** uz/ru/en — hammasida "Cast" (brend so'z bo'lishi mumkin, lekin `cast` funksiya nomi bilan aralashadi; ru'da "Трансляция" kutish mumkin)

### BUG-078: ⚪ Footer "O'qituvchilar" havolasi `/user/login` ga olib boradi
- **Dalil:** `href="/user/login"` — teacher registratsiyasi `/user/register`da (BUG-040); nomuvofiq joynatish

### BUG-079: ✅ IJOBIY — Landing SEO/a11y asosi yaxshi (STEP 12 ijobiy qismi)
| Tekshiruv | Natija |
|-----------|--------|
| og:title/desc/image, canonical, favicon | ✅ hammasi bor |
| skip-link | ✅ `#main` ishlaydi (target mavjud) |
| reg autocomplete | ✅ email / new-password (to'g'ri) |
| Dark landing kontrast | ✅ 0 muammo (51-53 PNG) |
| Dark persist login sahifasida | ✅ |
| FOUC | ✅ yo'q |
| til RU matnlar sifati | ✅ "Вход администратора", "или по email" — tarjima sifatli |
| mobil menyu | ✅ ochiladi, 4 item |
| pageerror | ✅ 0 |

### BUG-080: 🔴 DARK MODE panel oilasida UMUMAN ishlamaydi — theme-core yuklanmaydi (deploy nomuvofiq)
- **Live dalil (5 sahifa):** `/user/panel`, `/teacher`, `/user/security-profile`, `/user/create-test`, `/user/settings` — `script[src*=theme-core]` **YO'Q**, `window.DeborahThemeCore = undefined`, `<html>`da data-theme attrlari **bo'sh**; localStorage'da 'dark' bo'lsa ham e'tiborsiz (sahifa doim light)
- **Repo zidi:** `views/user/panel.ejs:4` head.ejs include qiladi, `partials/head.ejs:104` esa `<script src="/js/theme-core.js">` beradi — **live deploy boshqa (eski) versiya**
- **Ta'sir:** foydalanuvchi "dark mode umuman ko'rinmayapti" shikoyatining **2-katta manbasi**: landing/admin dark, panel oilasi esa dark'ni umuman bilmaydi — bir foydalanuvchi uchun 2 xil realit
- **Qamrov:** teacher VA student panellari + barcha user sahifalar

### BUG-081: 🟠 Tema uzluksizligi YO'Q: landing dark → panel majburan light
- **Dalil:** bir brauzer, localStorage dark: landing `data-theme=dark` ✅, `/user/panel` — light (BUG-080)
- **Ta'sir:** sahifadan sahifaga o'tganda butun dizayn rejimi sakraydi — professional tajribaga zid

### BUG-082: 🟡 panelThemeBtn nomuvofiq: ba'zan bor, ba'zan YO'Q
- **Dalil:** oldingi sessiyada teacher panelida `panelThemeBtn` (aria "Tema (light/dark)") bor edi; joriy teacher/student sessiyalarda **umuman yo'q** (hech qanday tema tugmasi DOM'da yo'q)
- **Ta'sir:** tema boshqaruvi tasodifiy — foydalanuvchi bir kuni ko'radi, keyingi kuni yo'qoladi

### BUG-083: 🟡 Student panelda tema boshqaruvi UMUMAN yo'q
- **Dalil:** jasurjonai panelida tema tugmasi 0 ta — student dark/light tanlay olmaydi (faqat admin/landing'da bor)

### BUG-084: 🟡 Panel sahifalarida `<html lang="">` — BO'SH lang atributi
- **Dalil:** /user/panel `lang=""` (landing'da `lang="uz"`); empty lang ekrano'quvchi tilini aniqlay olmaydi (WCAG 3.1.1)

### BUG-085: 🟡 Panel sahifalarida skip-link YO'Q
- **Dalil:** landingda `.skip-link` bor (ishlaydi), panel sahifalarida umuman yo'q — klaviatura foydalanuvchisi sidebar'dan o'tib qoladi

### BUG-086: 🟡 Teacher panelida 401 console shovqini x2
- **Dalil:** /user/panel va /teacher console'da 2x "Failed to load resource: 401" (student endpoint chaqiruvlari — BUG-013 oilasi)

### BUG-087: 🟡 METODIK TUZATISH: avvalgi dark skan natijalari qismen false-negative
- **Izoh:** STEP 4'da user sahifalari dark "toza" deb yozilgan edi — aslida tema qo'llanilmagani uchun light'da tekshirilgan; dark skan natijalari FAQAT theme-core yuklanadigan sahifalarda (landing/admin/auth) amal qiladi

### BUG-088: ⚪ Panel oilasi CSS'ida dark variantlar umuman ishlatilmaydi
- **Dalil:** live panel sahifalar `style.css`/`premium-theme.css`'ni ham yuklamaydi (head resource tekshiruvi) — deploy'da boshqa head; repo bilan live farqi BUG-009 "deploy xavfi" tasdig'i

### BUG-089: ✅ IJOBIY — Panel oilasi toza tomonlari (live)
| Tekshiruv | Natija |
|-----------|--------|
| 320px kichik telefon overflow | yo'q |
| Duplicate id'lar | yo'q |
| Teacher workspace dark skan | (tema qo'llanilmagan holatda) toza |
| 401 noise tashqarisida boshqa console error | yo'q |
| Dalillar | 54, 56, 57 PNG |

### BUG-090: 🟠 LIVE DEPLOY test davomida O'ZGARDI — MemoryStore sessiyalar o'chdi (B-03 TASDIQLANDI)
- **Dalil:** admin sessiya 35-sahifa skan o'rtasida 401 bo'ldi (dashboard/marking oldin 200 edi); teacher sessiyasi ham o'ldi; `server.js:214` Redis bo'lmasa `MemoryStore` — Render har deploy/restart'da sessiyalar yo'q
- **Ta'sir:** har deployda barcha foydalanuvchilar majburiy chiqadi (production uchun kritik); QA'da esa natijalar deploy versiyasiga bog'liq — re-verify talab
- **Keyingi bosqichlarda:** har step boshida sessiya jonliligi tekshiriladi

### BUG-091: ✅ RE-VERIFY (yangi deploy): BUG-006 (4x nav 404) va BUG-007 (camera-review 500) HAM MAVJUD
- question-gen/contracts/presentation/intervention → 404; camera-review → 500 (title "500 — Xatolik")
- Dev: `footer-scripts.ejs` partial + 3 route hali qo'shilmagan

### BUG-092: ✅ RE-VERIFY — YAXSHI YANGILIK: BUG-009 va BUG-010 yangi deployda TUZATILGAN
- /user/create-test: "breakout" leak YO'Q, `__CSRF_TOKEN = &#34;` YO'Q, 0 pageerror
- /user/panel: escaped pattern YO'Q (escape fix deploy bo'lgan)
- Lekin: `__RISK_COPY__` hali undefined (BUG-095)

### BUG-093: 🟠 REGRESSIYA: Admin tema boshqaruvi endi FAQAT 'System' — Light/Dark tugmalari YO'QOLGAN
- **Dalil:** dashboard themeBtns = ['System'] (oldin System/Light/Dark segment edi); marking'da 'Dark' tugma topilmaydi
- **Ta'sir:** light-OS foydalanuvchi admin'da dark'ni umuman yoqa olmaydi (dark talab qiluvchi foydalanuvchi uchun imkoniyat yo'q); hc rejim ham yo'q (BUG 3-UI tashxisi bilan birga)

### BUG-094: 🔴 RE-CONFIRM (BUG-080 yangi deployda HAM): Panel oilasida theme-core YO'Q
- /user/panel (yangi deploy, tirik sessiya): tc=False, attrs=[] — dark panel oilada hali ham ishlamaydi

### BUG-095: 🟡 `__RISK_COPY__` hali undefined (BUG-009 QISMAN fix)
- Escape tuzatilgan, lekin risk banner copy globali hali yuklanmaydi — risk banner i18n ishlamaydi

### BUG-096: 🟡 Dark skan (35 admin sahifa): 0 muammo — metodik izoh
- Barcha sahifalar 'System' rejimda light render bo'ldi; natija FAQAT theme-core faol sahifalar uchun amal qiladi. Light-OS foydalanuvchi dark'ni yoqa olmaydi (BUG-093) — shuning uchun dark kontrast testi endi mazmunsiz

### BUG-097: 🟡 Arena sahifasi o'zgargan — `.btn-load` topilmaydi (BUG-044 status: QAYTA TEKSHIRUV)
- Yangi deployda arena layout boshqacha; "Yuklash" tugma nomi/selektori o'zgargan — BUG-044 (loadArena o'likligi) yangi versiyada qayta tekshirilishi kerak

### BUG-098: 🟡 MFA backup kodlar buxgalteriyasi (muhim ogohlantirish)
- Admin: **2 ta qoldi** (daffd2e925, e36030562f) — ehtiyot ishlating
- Teacher: **5 ta kandidat** (3fc3a80ee7, fe36c1242c, 80adf33dca, c745de5358, 507655b928); ishlamaganlar: 5b329539bd, daffd2e925 (eski rotatsiya taxmini tasdiqlandi)
- Har xato urinish lockout'ga yig'iladi (5 → 15 daq) — kodlarni ketma-ket sinamasdan tekshirib yuborish tavsiya etiladi

### BUG-099: ✅ IJOBIY — Yangi deployda create-test 0 pageerror (leak/escape yo'q) — teacher asosiy oqimi toza boshlandi; BUG-092 bilan birga dev fix'lari ishlayapti

### BUG-100: 🟠 hc rejim UX: faqat localStorage bilan yoqiladi — UI toggle umuman yo'q (yarim funksiya)
- **Dalil (live):** localStorage `hc-dark` → landing `data-theme=high-contrast` ✅ ishlaydi (0 kontrast muammo, skrinshot 58/59); admin ham qabul qiladi. Lekin HECH QAYSI UI'da hc tugmasi yo'q (BUG 3-UI tashxisida 'yarim qolgan' deb yozilgan edi — endi funksional tasdiq)
- **Ta'sir:** ko'rish imkoniyati cheklangan foydalanuvchi hc rejimni faqat DevTools orqali yoqa oladi — real foydalanuvchilar uchun mavjud emas

### BUG-101: 🟡 Landing `lang` tanlovi cookie'ga YOZILMAYDI — server bilmaydi (BUG-072 chuqurlashtirildi)
- **Dalil:** RU bosilgach `localStorage.lang=null`, cookie'da `lang` yo'q; `document.documentElement.lang='ru'` faqat client. `GET /` esa `lang=ru` cookie'sini o'qiy olmaydi (BUG-072), `/user/login` esa o'qiydi — bir xil mexanizm ikkita sahifada ikki xil
- **Kelib chiqishi:** landing.js faqat DOM matnini almashtiradi, saqlash yo'q

### BUG-102: ⚪ Admin jadval sanalari ISO formatda (`2026-08-27 17:25:57`) — uz lokali emas
- **Dalil:** /admin/users sanalar ISO-like; landing/demo'da esa `27/08/2026, 07:59:49` (toLocaleString) — bir saytda 2 format
- **Ta'sir:** izchillik; admin jadvallarida ISO qulay, lekin user panel'dan farqi chalkashlik

### BUG-103: 🟡 Audit action nomlari dev-formatda (`auth:risk:scored`, `admin:mfa:required`) — admin uchun odam tilida emas
- **Dalil:** /admin/audit — action'lar colon-notation; UI'da tarjima/label map yo'q (ko'rinishi tekshirildi)
- **Ta'sir:** admin log'ni o'qiy olmaydi (texnik bilim talab)

### BUG-104: ✅ IJOBIY — hc-dark sifati va i18n asosi (live)
| Tekshiruv | Natija |
|-----------|--------|
| hc-dark landing (kontrast >= 2.5 skan) | 0 muammo — hc palitra ishlaydi |
| hc-dark admin | 0 muammo |
| System + OS dark emulyatsiya | ✅ avtomatik dark (localStorage bo'sh bo'lsa) |
| Legal ru/en (server, cookie orqali) | ✅ Политика конфиденциальности / Privacy Policy — to'liq til versiyalari |
| Login EN copy | ✅ (Sign in/Email...) |
| term-utils (DeborahTerms) | ✅ mavjud (4.2KB) |

### BUG-105: 🟠 RE-CONFIRM (yangi deploy): /play mobil 1168px overflow — JOIN TUGMA BOSILMAYDI
- **Dalil (2x urinish):** `scrollWidth 1168 vs 480`; "Qo'shilish" tugma `scrollIntoView` dan keyin ham **"Element is outside of the viewport"** — oddiy tap yetib bormaydi
- **BUG-053 + BUG-052 birga:** talaba mobil qurilmadan jonli darsga qo'shilolmaydi (desktop'da crash — BUG-052)

### BUG-106: 🟡 admin/marking mobilda to'liq navigatsiya YO'Q
- **Dalil:** hamburger/drawer yo'q (`hamburger: None`); faqat 4 havola ko'rinadi (Dashboard/Grading/Safe Submit/Chiqish) — 20+ admin bo'limga chiqa olmaydi; boshqa admin sahifalarda hamburger bor (nomuvofiq)

### BUG-107: 🟡 admin/users jadvali mobilda scroll wrapper'siz
- **Dalil:** jadval 866px (viewport 375px), wrapper `overflow-x: visible` — o'ng ustunlar (VIP, O'chirish) qirqilib ko'rinadi yoki sahifa darajasida cho'zadi

### BUG-108: 🟡 Touch targets < 44px (WCAG 2.5.8 / Apple HIG 44pt)
- **Dalil:** landing til tugmalari 28-30px; admin "Menyu" hamburgeri 18px keng; login tema "System" chipi 29px bo'luvchi
- **Ta'sir:** barmoq bilan aniq bosish qiyin — xato bosishlar

### BUG-109: 🟡 1 ta inputda font-size < 16px — iOS fokusda avtomatik zoom
- **Dalil:** login sahifada kamida 1 input `<16px` — iPhone foydalanuvchisi har fokusda sahifa zoom bo'ladi

### BUG-110: 🟡 Admin drawer nomuvofiq: dashboardda bor, markingda YO'Q
- **Dalil:** dashboard mobilda drawer ochiladi (sidebar tugmalari ko'rinadi — ishlaydi), marking'da umuman yo'q (BUG-106 bilan bir muammo, boshqa ko'rinish)

### BUG-111: ✅ IJOBIY — Mobil asosiy oqimlar toza (yangi deploy)
| Sahifa | 375px overflow | Kichik targetlar |
|--------|----------------|------------------|
| /user/panel, /teacher, create-test, security-profile, assignments, sessions | yo'q | yo'q |
| landing, login | yo'q | til tugmalari (BUG-108) |
| admin dashboard/users/roster/audit | yo'q | drawer ishlaydi |

### BUG-112: ⚪ Honeypot to'g'ri yashirin (fokus qutisida 1px input topilmadi) — bot himoyasi a11y'ga xalal bermaydi

### BUG-113: 🟡 BUG-052 holati yangi deployda: join tugma umuman yetib bormaydi — 'promise' crash'iga yetib bormasdan funksiya o'lik; ikkala bug birgalikda Cast mobil join'ni to'liq to'sadi (dev uchun: overflow fix + socket race fix ikkalasi kerak)

### BUG-114: 🔴 ADMIN MODAL FOCUS TRAP YO'Q — klaviatura fon sahifaga qochadi
- **Dalil (live):** admin overlay ochiq holatda 12x Tab -> fokus **overlay tashqarisidagi BUTTON'ga chiqdi**; focus trap yo'q
- **WCAG 2.4.3:** modal dialog fokusni ichida ushlab turishi shart

### BUG-115: 🟠 200% FONT ZOOM — LANDING overflow (WCAG 1.4.4)
- **Dalil:** font 32px emulyatsiyada landing scrollWidth 822 > 720; keng element: Til tanlov bloki (140px fixed)

### BUG-116: 🟡 Teacher/Admin interfeyslarda RU/EN tarjima YO'Q (faqat uz)
- **Dalil:** /teacher va /admin/users lang=ru cookie bilan — kirill matn 0; i18n faqat auth/landing qatlamida

### BUG-117: 🟡 CapsLock hint live holati — interaktiv repl keyingi stepda
- Element bor (hidden), koddа keydown handler bor; past xavf

### BUG-118: ✅ IJOBIY — Klaviatura a11y asosi yaxshi
| Tekshiruv | Natija |
|-----------|--------|
| focus-visible CSS | deklaratsiyalangan |
| Tab fokus ko'rinishi | 2px solid outline |
| Admin modal Esc | yopiladi |
| Reg label association | 0 xato |
| admin login focus | ko'rinchan |

### BUG-119: 🟠 `correct` index range tashqarisida ham SAQLANADI — savol "doim xato" bo'ladi
- **Dalil:** `POST /user/api/tests/save` `{options:["a","b"], correct:5}` → **200 success** (server validatsiya yo'q)
- **Ta'sir:** API/buzilgan client orqali kiritilgan savolda to'g'ri javob hech qachon tanlanmaydi — talaba to'g'ri javobni belgilasa ham "noto'g'ri" baholanadi (baholash intigri)
- **UI:** create-test UI radio bilan cheklaydi — FAQAT server himoyasi yo'q

### BUG-120: 🟡 1 variantli savol saqlanadi (kamida 2 bo'lishi kerak)
- **Dalil:** `{options:["a"], correct:0}` → 200 success; UI'da 4 variant default beriladi, lekin server cheklovi yo'q
- **Ta'sir:** API orqali yagona variantli savol — yaroqsiz test

### BUG-121: 🟡 Test nomi uzunlik limiti YO'Q (300+ belgi qabul)
- **Dalil:** 300-belgili nom → 200; UI maxlength ham yo'q
- **Ta'sir:** layout buzilishi, DB katta maydonlar

### BUG-122: 🟡 Variantlar soni server'da cheklanmagan (8+ qabul; UI 6 bilan cheklaydi)
- **Dalil:** 8 variant → 200 success
- **Ta'sir:** API client'lari UI qoidalarini chetlab o'tadi — cast render'da nomuvofiq ko'rinish mumkin

### BUG-123: ⚪ Savollar soni limit YO'Q (100 savol → 200)
- 10mb body limitgacha bo'lgan payloadlar qabul qilinadi; rate limit ham yo'q (faqat CSRF)

### BUG-124: 🟡 IKKI XIL testKey formati: save `mtbXXXXXXXXXXXX` vs duplicate `t_<timestamp>_<rand>`
- **Dalil:** save → `mtbwqkke0vb9`; duplicate → `t_1787858413763_2shqar`
- **Ta'sir:** key formati izchil emas — debug/migratsiyada chalkashlik; sortlash timestamp-prefixed key bilan farqli

### BUG-125: 🟡 `toggle-public` birmartalik bosishda test OMMAGA chiqadi (confirm YO'Q)
- **Kod:** `workspace-library.js:243` — visibility toggle `apiAction`'ga to'g'ridan-to'g'ri; delete'da confirm bor, public'da YO'Q
- **Ta'sir:** xato bosish bilan shaxsiy test (talaba javoblari bo'lishi mumkin) ommaviy ko'rinadi

### BUG-126: ⚪ archive endpoint `archived` param'siz chaqirilsa `{"archived":false}` qaytaradi (toggle mantiq; JS to'g'ri param yuboradi)

### BUG-127: ✅ IJOBIY — Test CRUD asosi mustahkam (live tekshirildi)
| Amal | Natija |
|------|--------|
| bo'sh nom / bo'sh savollar | 400 Invalid data |
| edit (editKey) | 200, preserve isPublic/createdAt |
| duplicate/archive/rename/toggle-public | 200 |
| 5 savol turi saqlash | 200 (single/true_false/multi/short/exit_ticket) |
| 100 savol | 200 |

### BUG-128: ℹ️ QA test artefaktlari teacher panelida qoldi (V2, V3, T-*, EDIT-test...)
- cleanup regex data-key'ni topmadi (attr format farqi); admin paneldan qo'lda o'chirish mumkin yoki keyingi stepda cleanup

### BUG-129: 🔴 EXCEL IMPORT -> SAQLASH UZILGAN: preview ko'rsatadi, save'da `questions:[]`
- **Live dalil:** to'g'ri formatli xlsx (2 savol) import → preview 3 qator ko'rinadi → "Saqlash" bosilganda POST payload: `{"name":"EXCEL-RT2","questions":[],"editKey":""}` → **400 Invalid data** → UI: **"Saqlashda xato"** (2 marta retry, xuddi shu)
- **Root cause:** import parser (XLSX.js) qatorlarni o'qiydi va preview render qiladi, LEKIN parse natijasi `test-builder.js` state'iga (`state.questions`) bog'lanmaydi — import va builder modullari orasida integratsiya yo'q/buzilgan
- **Ta'sir:** **Excel import funksiyasi end-to-end ISHLAMAYDI** (README §5 "savollar, variantlar" oqimining yarmi) — foydalanuvchi fayl yuklaydi, preview ko'radi, saqlay olmaydi
- **Tuzatish (hisobot):** import callback'da state.questions = parsed; render qayta chaqirilishi kerak

### BUG-130: 🟡 Buzilgan fayl (text renamed .xlsx) — SOKIN 0 qator, xato xabari YO'Q
- **Dalil:** `import_bad.xlsx` (plain text) yuklandi → 0 qator preview, **hech qanday "fayl o'qilmadi" xabari yo'q**
- **Ta'sir:** foydalanuvchi nima uchun import bo'lmaganini bilmaydi

### BUG-131: 🟡 Ustunlar yetishmaydigan fayl QABUL qilinadi (strukturaviy validatsiya yo'q)
- **Dalil:** faqat 3 ustunli (Savol/A/B) fayl → 2 qator preview — D/To'g'ri ustunlari bo'lmasa ham jim qabul
- **Ta'sir:** import qilsa bo'sh variantlar (yoki BUG-129 tufayli umuman saqlanmaydi)

### BUG-132: 🟡 Saqlash xatosi umumiy "Saqlashda xato" — sabab ko'rsatilmaydi (bo'sh questions ekanini foydalanuvchi bilmaydi)

### BUG-133: ✅ RE-VERIFY: BUG-050 (2xPOST) yangi deployda ham mavjud (xatolikda 2x retry tabiiy, lekin oddiy saqlashda ham 2x kuzatilgan edi)

### BUG-134: ✅ IJOBIY — Excel import texnik tomonlari (live)
| Tekshiruv | Natija |
|-----------|--------|
| 500 qatorli fayl preview | ✅ 501 qator tez, 0 pageerror |
| accept filtri | ✅ .xlsx,.xls |
| Shablon download | ✅ (STEP 5) |
| Preview render | ✅ (lekin state'ga bog'lanmaydi — BUG-129) |

### BUG-139: ✅ RE-CONFIRM (yangi deploy): BUG-044 ARENA HAM O'LIK — `loadArena is not defined`
- **Dalil:** "Yuklash" (.btn-load) bosildi → `Identifier '$'...` + `loadArena is not defined`, **API chaqiruv 0**, holat matni "Tayyor" (yolg'on)
- Yangi deployda ham `$` global konflikti (BUG-012) tuzatilmagan

### BUG-140: 🟠 Botlar tugmasi TEACHER'ga ko'rinadi, backend ADMIN talab qiladi (rol nomuvofiq)
- **Dalil:** `POST /arena/api/add-bots` (teacher sessiya) → **401 "Admin avtorizatsiyasi talab qilinadi"**
- **Ta'sir:** JS tuzatsa ham o'qituvchi botlarni qo'sha olmaydi — UI rolga qarab yashirishi yoki backend teacher'ga ruxsat berishi kerak

### BUG-141: 🟡 "Tayyor" YALG'ON holat — yuklanmaganidan keyin ham Tayyor ko'rsatiladi
- **Dalil:** Yuklash bosilib xato berdi, lekin status matni "Tayyor" qoldi (hech qanday xato holati ko'rsatilmaydi)

### BUG-142: 🟡 Update-banner arena sahifasida ham — har sahifada "Yangi versiya mavjud" (foydalanuvchi charchatadi)

### BUG-143: ✅ IJOBIY — Botlar/Tozalash tugmalari `disabled` boshlanishda (to'g'ri holat boshqaruvi)

### BUG-144: ✅ IJOBIY — Arena backend tirik: `GET /arena/api/check-session` 200 `{"exists":false}`
- Backend arxitekturasi jonli — muammo FAQAT frontend simlanish (BUG-044/012)

### BUG-145: 🟡 `/arena/api/state` 404 — client'ning kutgan endpointlaridan biri umuman yo'q (dead client path)

### BUG-146: ℹ️ `source=user` oqimi ham xuddi shu `loadArena`'ga bog'langan — student "Sinov rejimi" havolasi teng o'lik (BUG-044 qamrovi)

### BUG-147: ⚪ Arena sahifasida 17 script yuklanadi (charts/data-table kabi ishlatilmaydiganlar ham) — sahifa og'irligi

### BUG-148: ℹ️ UI oqimi to'liq bloklangani sababli attempt/submit API'lari UI'dan yetib bormaydi — bu API'lar STEP 39-41'da to'g'ridan-to'g'ri tekshiriladi

### BUG-149: ✅ RE-CONFIRM (yangi deploy): BUG-049 Director JS HAM O'LIK
- **Dalil:** yangi sessiya (cast_9qD8zEwbdoeP, kod APDD3G): `pageerror: null addEventListener`; **"Kod: —"** (kod bor, ko'rsatilmaydi); Sessiyani boshlash/+5s/Pauza tugmalari ko'rinadi lekin handlerlari o'lik
- Director `cast-director.js:1203` crash — hali tuzatilmagan

### BUG-150: 🟠 /cast/:id/results va /replay → 200 lekin **"Mening Panelim"** render qiladi
- **Dalil:** teacher bilan `/cast/{sid}/results` va `/replay` → HTTP 200, title "Mening Panelim" (panel'ga redirect + 200)
- **Ta'sir:** o'yin tugagach natijalar sahifasi o'rniga panel ochiladi — xato ham yo'q, natija ham yo'q; API muvaffaqiyatsizligi UX'da yashirilgan

### BUG-151: 🟡 /cast/:id/quality-lab → 403 (teacher) — ruxsat siyosati nomalum
- Director'ga kiradigan teacher quality-lab'ga kira olmaydi; UI'da buning izohi yo'q

### BUG-152: ✅ BUG-020 INTERMITTENT tasdiqlandi: bu safar birinchi urinishda join OK
- **Dalil:** student (mobil) `/play?code=APDD3G` → "Cast — Ishtirokchi" (1-urinishda); oldingi testda birinchi urinish ishlamagan edi — flaky tabiat tasdiqlandi

### BUG-153: 🟡 Mock fan key faqat ADMIN API'da — teacher Cast Studio'da mock tanlash yo'li yo'q
- **Dalil:** mock_key `dasturlash2_mpvfzfns` /admin/api/fans'dan olindi; teacher Cast Studio source ro'yxati bo'sh ko'rsatilgan edi
- **Ta'sir:** o'qituvchi mock/mashq sessiya o'tkazish yo'lini topolmaydi

### BUG-154: ✅ Mock manba bilan sessiya API oqimi to'liq ishlaydi (preflight 200 + sessions 200)

### BUG-155: 🟡 "Ko'rinadi lekin o'lik" UX — Director'da 12+ statik tugma (Sessiyani boshlash, Keyingi savol, +5s…+30s, Pauza, Javobni ko'rsatish) ko'rinadi, lekin BUG-049 tufayli aksariyati javob bermaydi
- **Ta'sir:** foydalanuvchi uchun eng yomon holat: tugmalar bor, bosilsa jim

### BUG-156: ⚪ Cast sahifalari `data-cast-theme` bilan OS'dan mustaqil — tema konflikti yo'q (dizayn qarori to'g'ri ishlaydi)

### BUG-157: 🟡 `/cast/None/director` ham 200 render qiladi (noto'g'ri sessionId'ga ham sahifa) — 404/redirect bo'lishi kerak

### BUG-158: ✅ IJOBIY — Dalil: 64_director_new.png (yangi deploy, kod APDD3G holati bilan)

### BUG-155: 🟠 `difficulty=hard` → 502 — AI hard rejim ISHLAMAYDI
- **Dalil:** `{"prompt":"kvant mexanika","difficulty":"hard"}` → **502** (easy/medium/mixed ishlaydi)
- **Ta'sir:** o'qituvchi qiyinlik darajasini hard tanlasa — xato; UI'da param bor, backend/iqlimdagi Gemini so'rovi yiqiladi

### BUG-156: 🟠 true_false savolida `correct` MAYDONI YO'Q (None)
- **Dalil:** `type=true_false` generate → 2 options ✅ lekin `correct: None`
- **Ta'sir:** AI'dan kelgan to'g'ri/noto'g'ri savol baholanolmaydi (normalizatsiya true_false uchun uzilmagan) — panel/cast'ga qo'shilsa noto'g'ri ishlaydi

### BUG-157: 🟡 `lang=ru` so'rovi O'ZBEKCHA javob qaytaradi
- **Dalil:** fotosintez savoli lang=ru bilan — kirill matn yo'q; lang param Gemini promptga to'liq yetmaydi yoki javob tili kafolatlanmaydi
- **Ta'sir:** ru/en foydalanuvchi ruscha/inglizcha savol ololmaydi (API qabul qiladi, natija boshqa tilda)

### BUG-158: ✅ GENERATE VALIDATSIYA to'g'ri (live)
- count=0 → clamp 1; count=100 → clamp 10 (200); prompt 700 → 400; authsiz → 403; lang=de → default uz (jim)

### BUG-159: 🟡 Admin ai-grading/ai-mlops sahifalari PLACEHOLDER darajada
- **Dalil:** job/eval/candidate raqamlari ko'rsatilmaydi (nums None), faqat sidebar "BOSHQARUV" matni — modullar sahifasi bor, funksiya/ma'lumot bo'sh

### BUG-160: ℹ️ AI kunlik limit (300/kun) hisobi
- QA testlari davomida ~30 so'rov birlik sarflandi (count=100 clamp bilan 10 ta bir so'rovda!); real foydalanuvchilar uchun limit katta, lekin har bir generate qimmat — UI'da qolgan limit ko'rsatilmasligi mumkin (tekshiruv)

### BUG-161: ✅ Rate limit 12/daq to'g'ri (rapid so'rovlarda 429 yo'q — chegara ichida)

### BUG-162: ✅ AI sifati: real Gemini (gemini-3.6-flash), uz tilida sifatli savollar (variantlar bilan)

### BUG-163: ⚪ Director Quick Prompt overlay UI BUG-049'dan hali o'lik (re-confirmed: orb-overlay click to'sadi)

### BUG-164: ⚪ 300/kun limitga yetish testi OCHIQ (quota tejash uchun sinov qilinmadi)

### BUG-165: 🟠 HEMIS "butunlay olib tashlandi" da'vosi YALG'ON — endpointlari TIRIK yashirin qolgan
- **Dalil:** `GET /user/hemis` → **401** (auth talab qiladi = route TIRIK); `server.js`'da hemis import/use 4 marta; `external-integration.ejs`'da hemis matni bor
- **README zidi:** "🗑 2026-08-27'da UI'dan butunlay olib tashlandi" — faqat havolalar olib tashlangan, API yashashda (dead surface + xavfsizlik skaneri uchun yashirin sirt)

### BUG-166: 🟡 Telegram login UI'da ko'rsatiladi lekin endpointlar 404 (env yo'q)
- **Dalil:** /user/login sahifasida "Telegram" matni bor; `GET /auth/telegram` va `/auth/telegram/start` → **404**
- **Ta'sir:** foydalanuvchi Telegram bilan kirishni topadi, bosishi mumkin — ishlamaydi (BUG-018 push bilan bir xil dizayn muammosi: env yo'q bo'lsa UI'dan yashirish kerak)

### BUG-167: ✅ RE-VERIFY: Forgot-parol enumeration himoyasi OK
- **Dalil:** mavjud va mavjud emas email → ikkalasi ham 200, bir xil turdagi javob matni (fayq qilish imkoni yo'q)

### BUG-168: ✅ RE-VERIFY: Email verify complete validatsiyasi to'g'ri
- wrong kod → 422 otp_invalid; 5/10 xona va bo'sh → 400 invalid_code_format (hech qanday bypass yo'q)

### BUG-169: ⚪ RE-VERIFY: Canva 400 (BUG-022 o'zgarmagan), Slides 200 (ishlaydi), Push `push_disabled` (BUG-018 o'zgarmagan)

### BUG-170: 🟠 fans/save 500 — Firebase 'undefined' xatosi raw qaytadi
- **Dalil:** `POST /admin/api/fans/save {name, questions:[{text,options,correct}]}` → **500 `{"error":"set failed: value argument contains undefined in property 'm..."}`**
- **Ildiz:** payload'ning ba'zi maydonlari undefined (ehtimol fan obyektida metadata/id kutiladi); server sanitizatsiya qilmaydi va **Firebase'ning internal xato matnini foydalanuvchiga raw qaytaradi** (info disclosure + UX)
- **Ta'sir:** minimal payload bilan yangi mock fan yaratish mumkin emas; UI to'liq payload yuborsa ishlashi mumkin (tekshirildi: UI `name+questions` yuboradi — xuddi shu payload bilan UI ham yiqilishi kerak, interaktiv repl keyin)

### BUG-171: ✅ Role o'zgartirish ishlaydi (student->teacher->student, from/to javob bilan)

### BUG-172: ✅ Block/unblock oqimi to'g'ri
- block+reason → 200; bloklangan foydalanuvchi login'da **"blok" xabari** bilan to'siladi (jim yo'qolmaydi); unblock → 200 (idempotent)
- block reason'siz → 400 "reason required" (yaxshi validatsiya)

### BUG-173: 🟡 pre-groups/save minimal payload bilan 400 "Invalid data" — API shakli hujjatlanmagan
- UI to'liq obyekt yuboradi (ishlaydi), lekin API mustaqil ishlatish uchun shartli maydonlar nomalum

### BUG-174: ✅ signup-reviews pendingDepth 0 — holat konsistent

### BUG-175: ℹ️ QA artefaktlar holati: landing_reg_0827 (VIP berilgan — BUG-066 testida), qa_tester_0827 (block/unblock testidan o'tdi) — xohlasangiz admin paneldan o'chirib tashlang

### BUG-180: ✅ REPLAY PROTECTION ISHLAYDI (xavfsizlik)
- **Dalil:** ishlatilgan backup kod (`9883e203c6`) qayta verify → **403 invalid_code** (kod single-use, mfa-totp.js' consumeBackupCode hujjatlashtirilganidek)

### BUG-181: 🟠 BUG-016 YANA BOR: `retryAfterSeconds:-4061` (manfiy timer) invalid urinishda
- Yangi deployda ham expired lockout manfiy timer qaytaryapti — hali tuzatilmagan

### BUG-182: 🟠 Export key TRAVERSAL -> 500 UNHANDLED
- **Dalil:** `GET /user/api/tests/export?key=../../etc/passwd` va `key=mtb../x` → **500** (404 bo'lishi kerak edi)
- Firebase path'da taqiqlangan belgilar exception tashlaydi, route catch'lanmagan yagona 500'ga qaytadi
- **Yaxshi tomoni:** ma'lumot oqishi yo'q (500, content yo'q); **yomon tomoni:** crafted input bilan server xatosi + log shovqini

### BUG-183: ✅ XSS EXPORT xavfsiz: nomda quote/script bilan ham export JSON valid qaytadi (name nested), JSON buzilmaydi

### BUG-184: ✅ verify/send RATE LIMIT ishlaydi: 429 too_many_requests + retryAfterSeconds (10/soat chegara)

### BUG-185: ✅ Export auth'siz 401 (himoya OK)

### BUG-186: 🟡 SERVER FLAKINESS: POST so'rovlar ba'zan 60-120s TIMEOUT (2x kuzatildi: save va verify/send) — SMTP'dan tashqari umumiy sekinlik (Render instance yuklamasi yoki bloklanuvchi call'lar); foydalanuvchiga spinner cheksiz

### BUG-187: ⚪ Export JSON tuzilishi: `name` top-level emas (nested) — API hujjatlari yo'q

### BUG-188: ✅ QA cleanup: XSS test o'chirildi (artefakt qolmadi)

### BUG-189: ℹ️ verify/send 10/soat limit menga tegishli (testlar sabab) — foydalanuvchi uchun me'yor yetarli

### BUG-190: ✅ Remember-me logout'dan keyin O'LMAGAN (revoke OK)
- **Dalil:** logout → eski `deborah_remember` cookie bilan /user/panel → **401** (token revoke ishlaydi, session qayta tirilmaydi)

### BUG-191: ✅ SESSION FIXATION himoyasi OK
- **Dalil:** anonim sid `b53416ec...` → login'dan keyin `347555ae...` — **regenerate** bo'ldi (session.fixation himoyasi faol)

### BUG-192: 🟡 `Origin: null` origin-check'dan O'TADI (defense-in-depth zaifligi)
- **Dalil:** VIP grant so'rovi `Origin: null` bilan → **404 handler'ga yetdi** (same-origin 404, evil 403)
- **Kontekst:** haqiqiy hujum uchun CSRF token baribir kerak (per-session), shuning uchun risk PAST — lekin sandboxed-iframe vektorida ikkinchi himoya qatlami ishlamaydi
- **Tavsiya:** `Origin: null`'ni ham rad etish yoki token talabni kuchaytirish

### BUG-193: ✅ Subdomain trick bloklangan: `deborah-ncj.onrender.com.evil.com` → 403 ORIGIN_BLOCKED

### BUG-194–196: ✅ REGISTRATSIYA VALIDATSIYA ZANJIRI TO'LIQ ISHLAYDI (6/6 reject)
| Test | Natija |
|------|--------|
| password1 (kuchsiz) | reject |
| username bo'shliqli | reject |
| username `admin` (reserved) | reject |
| username confusable `admіn` | reject |
| email noto'g'ri format | reject |
| consent yo'q | reject |

### BUG-197: 🟡 Validatsiya xabarlari GENERIC + NOTO'G'RI — har 6 holatda bir xil "Ism va parolni kiriting" chiqadi
- **Dalil:** parol kuchsiz / username band / email format xato — barchasida bir xil required xabar; parseRegister errorKey (passwordWeak, usernameReserved, emailInvalid...) render'da xaritlanmayapti
- **Ta'sir:** foydalanuvchi asl sababni bilmaydi — 6 xil xato uchun bitta noto'g'ri maslahat (B-03 errorKey tizimi bor, lekin chiqish yo'q)

### BUG-198: ✅ Register sahifasi har chaqiruvda yangi CSRF (token ishlatilganidan keyin ham yangi forma)

### BUG-199: ℹ️ Xulosa: auth validatsiya zanjiri mustahkam, faqat foydalanuvchiga ko'rinadigan xabar matnlari buzilgan (BUG-197)

### BUG-200: 🟡 Users qidiruv DEBOUNCE/endpoint param nomuvofiq — tez yozishda filtr ishlamaydi
- **Dalil (live):** `si.type("jasur", delay=10)` (progrommatik tez yozish) + 1.2s kutish → qatorlar **117** (filtralanmagan); `?search=jasur` param ham 25 ta default qaytardi, faqat `?q=jasur` → 3 ta to'g'ri
- **Ildiz:** dashboard UI qidiruvi `?q=` orqali ishlaydi (API to'g'ri), lekin input event handler debounce'siz yoki endpoint param nomi UI bilan mos emas — foydalanuvchi tez yozsa natija yangilanmaydi
- **Ta'sir:** qidiruv natijalari kechikadi/yangilanmaydi

### BUG-201: ⚪ `?limit=5` param e'tiborsiz (pageSize 25 qotib qolgan)
- **Dalil:** `?limit=5` → 25 ta qaytardi (`pageSize` 25); faqat page param ishlaydi
- **Ta'sir:** API consumer uchun kutilmagan (hujjat yo'q — qabul qilinadigan param `q` va `page`)

### BUG-202: ✅ Audit pagination ISHLAYDI (page1 != page2, har safar 25 item)

### BUG-203: 🟡 "RANDOM 25" badge — fans API'da 7 ta fan (badge matni eski/noto'g'ri)
- **Dalil:** sidebar/dashboard "Namuna fanlar RANDOM 25" — API 7 ta qaytaradi; 25 emas

### BUG-204: ✅ 300-belgili test nomi panel'da text-overflow: clip bilan to'g'ri kesiladi (overflow yo'q) — BUG-121 faqat API darajasida (UI himoyalangan)

### BUG-205: ✅ IJOBIY — Ro'yxat oqimlari asosi toza (live)
| Tekshiruv | Natija |
|-----------|--------|
| users API paginatsiya (page) | ✅ ishlaydi (25/page, total field bilan) |
| `?q=` qidiruv | ✅ 3 natija (jasur*) |
| audit pagination | ✅ |
| uzun nom UI kesish | ✅ clip |
| 320/375px mobil | ✅ (oldingi step) |

### BUG-205a: ✅ (TAXRIR) 404 sahifa to'liq funksional — BUG yo'q (avvalgi 404 topilmalari qayta tekshirildi)
- Bosh sahifa/Kirish/Orqaga havolalari, uz lang ✅; tema tugmasi YO'Q (404 sahifa soddalashtirilgan — qabul qilinadigan)

### BUG-206: 🟡 500 sahifada "Orqaga" havolasi YO'Q (faqat Bosh sahifa) — foydalanuvchi kontekstni yo'qotadi
- **Dalil:** camera-review 500 sahifa: faqat `href=/` (bosh sahifa); 404 sahifada esa "Orqaga" (history.back) bor — ikki xato sahifasi har xil
- **Ijobiy:** Xato identifikatori (mtbxjn4d-upt4yl) ko'rsatiladi — support uchun yaxshi

### BUG-207: ✅ Update banner dismiss SAQLANADI (reload'dan keyin qaytmaydi)
- **Dalil:** "Yangi versiya mavjud — Yangilash" X bilan yopildi → reload'dan keyin qaytmadi ✅ (eski BUG-009 kuzatuvi faqat yangi deploy chiqqanda ko'rinadi)

### BUG-208: ✅ Offline sahifa va PWA tayyor (200, SW oldin ro'yxatdan o'tgan)

### BUG-209: ℹ️ Admin dashboard navigation ba'zan ERR_ABORTED — update-banner reload bilan raqobat
- **Dalil:** goto dashboard 1 marta `net::ERR_ABORTED` (update-banner auto-reload bilan bir vaqtda); qayta urinishda o'tdi — flaky navigatsiya

### BUG-220: 🟡 Landing "Join kod" inputi label'siz (jcode) — placeholder faqat '00000'
- **Dalil:** `#jcode` label=0, aria-label yo'q, placeholder faqat raqamlar — screen reader "matn kiritish maydoni" deb e'lon qiladi, maqsadi nomaqlum (WCAG 1.3.1/3.3.2)
- **Kontekst:** bu cast join kodi maydoni (landing'dagi alohida dialog)

### BUG-221: 🟡 Landing'da DUPLICATE ID `kontakt` (2 x element bir id)
- **Dalil:** `#kontakt` 2 marta — anchor navigatsiya birinchisiga o'tadi, ikkinchisi malla; HTML valid emas

### BUG-222: 🟡 Admin dashboard refresh tugmasida accessible name YO'Q
- **Dalil:** `.admin-refresh-btn` (onclick=loadUsers) — faqat ikonka, aria-label/title yo'q; screen reader "tugma" deydi (qaysi blokni yangilashi nomaqlum)

### BUG-223: ⚪ /play va create-test sahifalarida h1 YO'Q (0 ta) — sahifa ierarxiyasi h1 bilan boshlanishi kerak (WCAG best-practice)

### BUG-224: ✅ IJOBIY — A11y asosi ko'p jihatdan YAXSHI (7 sahifa skan)
| Tekshiruv | Natija |
|-----------|--------|
| img alt | ✅ 7 sahifada 0 muammo |
| button accessible name | ✅ faqat 1 istisno (BUG-222) |
| tabindex>0 (antipattern) | ✅ 0 |
| a href'siz (ko'rinadigan) | ✅ 0 |
| duplicate id | ✅ faqat landing (BUG-221) |
| form label association | ✅ login/panel/admin toza |
| html lang | ✅ barcha sahifada uz (panel oilasi BUG-084 bundan mustasno) |
| h1 | ✅ ko'pchilik sahifada 1 ta |

### STEP 30 YAKUNIY — PERF + KONSOL + README MOSLIK (10 topilma)

### BUG-225: 🟠 logo-vintage.png **254KB** — har admin sahifada yuklanadi (boshqa sahifalarda ham header'da)
- **Dalil:** /admin/dashboard 57 request ~328KB, eng kattasi `/images/logo-vintage.png` (254KB, PNG formatda)
- **Tavsiya:** WebP/AVIF + o'lcham optimizatsiya (80-90% tejash mumkin); dashboard'da icon-size kerak — 254KB ortiqcha

### BUG-226: 🟡 PANEL 67 request ~328KB — eng og'ir sahifa (landing 18 req / 75KB bilan solishtirganda 3.7x)
- **Ijobiy tomoni:** landing yengil ✅; br compress ✅; static cache-control max-age=86400 ✅ (1 kun — statik uchun qisqa, lekin bor)

### BUG-227: ✅ Konsol WARNINGlar: landing/panel/admin — 0 ta (jami skan)

### BUG-228: ✅ Brotli (br) + cache qaytariladi — server konfiguratsiyasi OK

### BUG-229: 📋 README MOSLIK YAKUNIY JADVAL (30 step davomida to'plangan asosiylar)
| README da'vo | Real holat |
|---|---|
| "Jonli dars o'yinlari (Kahoot uslubi)" | ❌ Director JS o'lik (BUG-049), join flaky (BUG-020/052), mobil overflow (BUG-053) |
| "AI yordamchi" | ⚠️ API LIVE ✅, lekin UI ochilmaydi (BUG-049), hard rejim 502 (BUG-155), true_false correct None (BUG-156) |
| "Imtihonlarni to'liq boshqarish" | ❌ 6 modul JS o'lik (BUG-059), camera-review 500 (BUG-007) |
| "Excel import" | ❌ import->save uzilgan (BUG-129) |
| "492 test, CI majburiy" | ❓ CI status ko'rinmadi (tekshirilmagan) |
| "Rollar: student/teacher/admin/proctor/marker/board" | ✅ role guard ishlaydi |
| "Passkey, MFA, parol tiklash real" | ✅ (reauth_required bilan) |
| "PWA/offline" | ✅ SW + offline sahifa |
| "Web Push" | ❌ push_disabled (BUG-018) |
| "Telegram OTP + bot" | ❌ endpoint 404, UI'da esa ko'rinadi (BUG-166) |
| "Canva/Slides" | ⚠️ Canva not configured, Slides LIVE |
| "3 mavzu (light/dark/hc)" | ⚠️ landing/admin'da dark OK, panel oilasida YO'Q (BUG-080), hc UI toggle yo'q (BUG-100) |
| "45+ admin sahifa" | ⚠️ 30 OK, 5 nav buzilgan, 6 modul JS o'lik |

### BUG-230: 🎯 UMUMIY XULOSA (senior darajadagi yakun)
- **Kuchli tomonlar:** backend xavfsizlik arxitekturasi (CSRF/origin/IDOR/replay/rate-limit), auth oqimlari (MFA/backup/remember/OIDC), Gemini integratsiya, PWA, mobil responsive asosi, admin statistika real ma'lumot bilan
- **Global ildizlar (3 pattern):** (1) JS modul scope/escape buzilishlari — sahifa darajasida hamma narsani o'ldiradi; (2) repo-live deploy nomuvofikligi (eski versiya ishlayapti — head.ejs theme-core, panel fix'larini ko'rmaydi); (3) env/infra yetishmasligi (Redis, PostgreSQL, VAPID, Telegram, SMTP sekinligi) — modullar yashirin yiqiladi
- **Prioritet 1 (foydalanuvchi yo'qotadi):** BUG-049 (director), BUG-052/053 (join), BUG-044 (arena), BUG-129 (excel), BUG-059 (6 modul), BUG-080 (dark panel), BUG-067 (keepalive)
- **Prioritet 2:** BUG-006/007 (nav), BUG-033 (VIP UI), BUG-071 (legal linklar), BUG-093 (tema regressiya), BUG-098 (kodlar kamayib qoldi)
- **Tez g'alabalar (1-qatorlik):** \$ IIFE fix (BUG-012/044/049 birjo'p), escape fix (BUG-009/010 tuzatilgan), footer-scripts.ejs qo'shish, SMTP timeout

### STEP 31 YAKUNIY — ATTEMPT/ARENA OQIMI (10 topilma)

### BUG-230a: 🔴 ARENA UCHUN START ENDPOINTI YO'Q — test yuklanadi lekin HECH QANDAYYO'L BOSHLASH YO'Q
- **Dalil:** teacher test yaratildi (mtcfsh4zlryl) → `/api/attempt/start|create|lease`, `/arena/api/start` — HAMMASI 404
- **Kod:** `routes/arena.js`'da FAQAT 3 endpoint: check-session (GET), add-bots (admin), cleanup-bots (admin) — start/join endpointi umuman yo'q
- **Ta'sir:** arena "Yuklash" ishlasa ham (BUG-044), boshlash yo'li YO'Q — funksiya konseptual tugallanmagan

### BUG-230b: 🟠 arena add-bots/cleanup-bots `requireAdmin` — lekin arena TEACHER/student funksiyasi
- O'qituvchi o'z arena sinovida bot ishlatolmaydi (UI tugmasi ko'rinadi, backend rad etadi) — BUG-140ning keng qamrovi

### BUG-230c: ✅ attempt META ma'lumotlari konsistent: statuses ready/in_progress/submitted/terminated + transitions map bor
- `GET /api/student/attempt/meta` 200 — imtihon holat mashinasi hujjatlashtirilgan

### BUG-230d: 🟡 `/api/student/assignments` teacherga 401 (BUG-013 re-confirm yangi deployda ham)

### BUG-230e: ✅ response META: first/editable/item_lock rejimlar + pending/accepted holatlar — javob siyosati sozlangan

### BUG-230f: 🔴 ARENA WATCH (real-time) — `arena:watch` socket event bor (game-handler.js:449) lekin sahifada yuklanadigan sahifa-skript o'lik (BUG-044) → socket hech qachon ulanmaydi
- `arena:stateUpdate`, `arena:playerCount` eventlar server tomonda tayyor — client murojaat qilmaydi

### BUG-230g: 🟡 Student arena source=user sahifasida test tanlash SELECTI YO'Q (opts bo'sh) — o'z testini tanlash UI'siz (loadBtn bor lekin nima yuklashi nomaqlum)

### BUG-230h: ℹ️ README'dagi `/api/response/*` (ACK+autosave) va `/api/submit/*` (muhr+imzo receipt) endpoints `routes/response.js`'da meta qismigina live tekshirildi; submit imzolash oqimi assignment'ga bog'liq (assignments 401 → yetib bo'lmadi — B-01 qoldiq)

### BUG-230i: 🟡 Mock fanlar "RANDOM 25" da'vosi — constants MOCK_COUNT: 25, lekin API 7 ta qaytardi (BUG-203 re-confirm, koddan ham: MOCK_COUNT=25 mantiq qaeradadir qo'llanilmaydi)

### BUG-230j: ✅ teacher yangi test (S31-Arena-Test) cleanup qilindi — artefakt yo'q

### ✅ FOYDALANUVCHI TALABLARI TEKSHIRUVI

### ✅ FOYDALANUVCHI TALABLARI TEKSHIRUVI
| Talab | Holat |
|-------|-------|
| "Profilim"ga kirishda parol so'ralmasligi kerak | ✅ BAJARILGAN — /user/profile parolsiz ochiladi, password input yo'q |
| Parol/kod almashtirishda parol so'ralishi kerak | ⏳ oqim alohida tekshiriladi (security-profile MFA-off crash sababli BUG-011 to'sqin) |
| User hisoblarda MFA'siz kirish (o'chirilgach) | ✅ ISHLAYDI — jasur va jasurjonai to'g'ridan-to'g'ri /user/panel (302) |

---

## ⏳ BLOKLANGAN / KEYINGI BOSQICH

| # | Blok sababi | Kerakli resurs |
|---|-------------|----------------|
| B-01 | ~~Teacher/VIP/user dashboardlari~~ ✅ YAKUNLANDI (2026-08-27) — teacher backup kod bilan, jasur/jasurjonai MFA'siz | — |
| B-02 | ~~`/user/camera-pilot` 500~~ ✅ TASDIQLANDI — teacher sessiyasida ham 500 (BUG-007) | — |
| B-03 | Session Render sleep'dan keyin omon qolishi (Redis yoki MemoryStore) | Keyingi sessiyada tabiiy tekshiruv |
| B-04 | Parol o'zgartirish oqimida current password talabi | BUG-011 crash tugatilgach |
| B-05 | Tuzatishlar verify: BUG-009/010 fix'dan keyin regressed testlar | Dev javobi keyin |

---

## ✅ USER PANELLARIDA ISHLAYOTGAN QISMLAR (live tekshirildi)

| # | Tekshiruv | Natija |
|---|-----------|--------|
| U-01 | /user/panel, /user/profile, /user/security-profile, /user/settings, /user/notifications, /user/portfolio | 200 OK (3 rolda ham) |
| U-02 | /teacher 4 tab (workspace, assessments, courses, grading) | 200 OK, console toza |
| U-03 | /user/create-test | 200 (lekin BUG-010 JS va BUG-014 gate) |
| U-04 | MFA o'chirilgan user kirishi (jasur, jasurjonai) | ✅ to'g'ridan-to'g'ri panel |
| U-05 | Role guard: oddiy user/VIP → /teacher | 403 ✅ (ruxsat himoyasi ishlaydi) |
| U-06 | Profil parolsiz ochilishi (talab) | ✅ |
| U-07 | MFA'siz foydalanuvchi /user/mfa/setup | 302 → panel ✅ |
| U-08 | Teacher backup kod bilan MFA oqimi | ✅ 200 `{"ok":true,"role":"teacher"}` |

---

## TESTDAN O'TGAN CREDENTIALS

| Login | Parol | Rol | Yakuniy holat |
|-------|-------|-----|----------------|
| teacher | Teacher2026 | Ustoz | ✅ To'liq kirildi (backup kod) |
| jasur | jasur | VIP user | ✅ To'liq kirildi (MFA o'chirilgan) |
| jasurjonai | jasur0408 | Oddiy user | ✅ To'liq kirildi (MFA o'chirilgan) |
| edikit_admin | admin0408 | Admin | ✅ To'liq kirildi (2x backup kod, 8 qoldi) |

> ⚠️ **Backup kodlar:** teacher — 1/12 ishlatildi (9883e203c6). Sistemada rotatsiya 10 ta kod generatsiya qiladi — siz bergan 12 dan oxirgi 2 tasi (c745de5358, 507655b928) eski rotatsiyadan bo'lishi mumkin.
> ⚠️ **Xavfsizlik:** parollar chat'da qoldi — sessiya tugagach rotate qiling. Test tugach user hisoblariga MFA'ni qayta yoqing.
