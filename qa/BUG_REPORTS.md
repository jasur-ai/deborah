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
