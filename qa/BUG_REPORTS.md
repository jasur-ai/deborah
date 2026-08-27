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

## ⏳ BLOKLANGAN / KEYINGI BOSQICH

| # | Blok sababi | Kerakli resurs |
|---|-------------|----------------|
| B-01 | Teacher, VIP va oddiy user dashboardlari to'liq QA | Har hisob uchun **1 ta backup kod** (10 hex belgi) yoki TOTP secret (base32, enroll sahifasidan) |
| B-02 | `/user/camera-pilot` 500 tekshiruvi (BUG-007 qurboni) | User sessiyasi |
| B-03 | Session Render sleep'dan keyin omon qolishi (Redis yoki MemoryStore?) | Dashboard sessiyasi — keyingi turnarda tabiiy tekshiriladi |
| B-04 | Muvaffaqiyatli login'dan KEYINGI to'liq oqim (BUG-001 TOTP bosqichi) | TOTP secret yoki backup kod |

---

## TESTDAN O'TGAN CREDENTIALS (faqat parol bosqichi)

| Login | Parol | Rol | Login natijasi |
|-------|-------|-----|----------------|
| teacher | Teacher2026 | Ustoz | 302 → /user/mfa ✅ |
| jasur | jasur | VIP user | 302 → /user/mfa ✅ |
| jasurjonai | jasur0408 | Oddiy user | 302 → /user/mfa ✅ |
| edikit_admin | admin0408 | Admin | 302 → /admin/mfa ✅ |

> ⚠️ **Eslatma:** Parol/tokenlar chat'da qoldi — sessiya tugagach rotate qilish tavsiya etiladi.
