# QA TEST PLANI

> **Loyiha:** Deborah — jonli test/viktorina platformasi (deborah-ncj.onrender.com)
> **Repo:** github.com/jasur-ai/deborah (main) — hali clone qilinmagan (sayt testidan keyin)
> **Stack:** Node.js + Express + EJS + express-session | Cloudflare + Render
> **Sana:** 2026-08-27
> **Status:** 🟡 Jarayonda — 1-bosqich (Smoke) ✅, auth parol-bosqichi ✅, dashboardlar ⏳ MFA'da bloklangan

---

## QOIDALAR (foydalanuvchi belgilagan)

1. ✅ Clone'dan AVVAL — sayt (live URL) orqali hamma funksiya tekshiriladi
2. ✅ Ishlamagan qismlar topiladi: **sababi** va **qayerda ekanligi** aniqlanadi
3. ✅ FAQAT HISOROT — **tuzatilmaydi** (QA report, development emas)
4. ✅ Workspace hajmi **100MB dan oshmasligi shart** — har task yakunida `du -sh` bilan tekshiriladi
5. ✅ Professional yondashuv: har bir bug hujjatlashtiriladi (reproduksiya qadamlari, kutilgan natija, haqiqiy natija, severity, taxminiy sabab/joy)

---

## TEST JARAYONI

### 1-BOSQICH: Smoke test ✅
- [x] Sayt ochilishi, asosiy sahifalar yuklanishi (landing 200)
- [x] Static resurslar (CSS/JS/rasmlar/fontlar) — 11/11 fayl 200
- [x] Manifest.json valid
- [x] 404 sahifa ishlaydi

### 2-BOSQICH: Funksional test 🟡 (parol bosqichi done)
- [x] Autentifikatsiya: login (4 rol) — parol bosqichi ✅ → MFA
- [x] Admin login: /admin/login va landing modal (server tomonda ikkalasi OK)
- [ ] ⏳ Dashboardlar: teacher / VIP / oddiy user / admin (TOTP blok)
- [ ] ⏳ Teacher: test yaratish, cast o'tkazish
- [ ] ⏳ Admin panel funksiyalari
- [x] Forma validatsiyasi (HTML5: minlength, maxlength, required)
- [ ] ⏳ Filtirlar, qidiruv, pagination (dashboardlardan keyin)
- [ ] ⏳ Ruxsatlar (roles/permissions)

### 3-BOSQICH: API test 🟡
- [x] Himoyalangan sahifalar auth'siz 401 ✅
- [x] /api/mfa/verify negativ testlar (invalid_code, locked+429) ✅
- [ ] ⏳ Dashboard API'lari (bloklangan)

### 4-BOSQICH: UI/UX va moslik 🟡
- [x] Landing strukturasi, i18n lug'atlari (uz/ru/en) mavjud
- [x] PWA manifest
- [ ] ⏳ Responsive (Playwright kerak)
- [x] Broken linklar: footer'da 9 ta placeholder topildi (BUG-003)

### 5-BOSQICH: Yakuniy hisorot — 🔴 kutilmoqda

---

## SEVERITY SHKALASI

| Daraja | Belgi | Ta'rif |
|--------|-------|--------|
| Critical | 🔴 | Asosiy funksiya ishlamaydi, ma'lumot yo'qolishi, xavfsizlik teshigi |
| Major | 🟠 | Muhim funksiya buzilgan, workaround yo'q |
| Minor | 🟡 | Buzilgan lekin workaround bor, kosmetik xatolar |
| Trivial | ⚪ | Tashqi ko'rinish, matn xatolari |

---

## STATUS BELGILARI
- 🔴 Kutilmoqda / Boshlanmagan
- 🟡 Jarayonda
- 🟢 Yakunlangan
