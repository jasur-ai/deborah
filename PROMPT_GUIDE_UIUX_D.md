# Edikit UI/UX — FAZA D: AUTH UI (login/register/forgot/MFA/settings sahifalari)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_auth_deep.md` (forma ilmi, error matrix, enumeration), `research_ui_audit.md` 6-bo'lim (A-faza topilmalar), `research_ui_top_sites_deep.md` (Google minimal, Jeton trust, Aventura empathy).

---

## D-00 — Auth UI preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_auth_deep.md` 2-7-bo'limlarini o'qib, auth sahifalar rejasini tuz:
   Login, Register, Forgot, Reset, MFA (challenge), Settings/Security center — har biri uchun spec.
03. Precondition: C-10 (Landing) yashil.
04. Hozirgi auth view'lar: `views/user/login.ejs` (tab login/register), `views/user/security-profile.ejs`; boshqa auth sahifalar (forgot/mfa) backend'da bo'lsa — UI tekshir.
05. Auth sahifalar uchun base: B-dan (form component, theme, a11y) + A-dan (email, NIST, forgot, show/hide).
06. Auth dizayn: "calm" — minimal motion, trust microcopy, bitta fokus (Google/Jeton benchmark).
07. Baseline: `npm run typecheck` + `npm test`.
08. Security/data guard: hech narsa o'zgartirilmaydi (faqat reja).
09. Unit test: existing smoke.
10. Integration/contract test: existing.
11. E2E/security test: workspace toza.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga D-00 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: auth sahifalar ro'yxati tasdiqlanmasa.
16. Done condition: reja aniq, D-01 ready.
17. D-01 uchun: login — tayyor ekanini dalil bilan yoz.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
24. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
25. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
26. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
27. Ledger: `implementation-status-uiux.md` yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
28. Manual signoff: operator visual/tekshiruv natijasini tasdiqlaydi (screenshot/test raqam).
29. Next readiness: keyingi prompt boshlanishi uchun dalil (grep/test natijasi) yoziladi.
```

---

## D-01 — Login sahifasi (to'liq — forma, error, trust)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/login.ejs` ni qayta tuzish (A-08 + B base):
   - Struktura: markazda logo + "Platformaga kirish" (qisqa) + forma.
   - Field 1: "Email yoki login" — `input name="identifier" type="text" autocomplete="username" autocapitalize="off"` (email ham qabul — backend).
   - Field 2: "Parol" — `autocomplete="current-password"` + show/hide toggle (A-07 pattern).
   - "Parolni unutdingizmi?" — parol ostida (A-08).
   - CTA: [Kirish] `.btn-primary` full-width.
   - "Hisobingiz yo'qmi? Ro'yxatdan o'tish" — offramp (tab o'rniga link — rol tafovuti uchun alohida sahifa).
03. Error state (B-10): inline field error + `aria-invalid` + `aria-live`; enum: "Email yoki parol noto'g'ri" (bir xil); vaqt normalize (dummy hash — backend ishi).
04. Trust microcopy: forma ostida "Ma'lumotlar O'zbekistonda saqlanadi · Hech qachon uchinchi shaxsga berilmaydi" + privacy havolasi.
05. OIDC: [Google bilan kirish] (mavjud fetch /auth/status — ochish); Telegram (B-22) — keyin D-05.
   - OIDC divider: "yoki" — sokin.
06. `autofocus` birinchi field'ga; `autocomplete` to'g'ri.
07. Mobile: single-column, 44px, 16px font, thumb zone.
08. Enumeration: login xato matni bir xil (username/parol farq emas).
09. Security/data guard: parol log'da yo'q; server-authoritative; CSRF mavjud.
10. Unit test: login.ejs struktura (regex): identifier, password, forgot, show/hide, trust.
11. Integration/contract test: login POST ishlaydi; forgot route 200.
12. E2E/security test: error aria-live; enum matni bir xil; XSS yo'q; 44px.
13. GREP-CHECK: `grep -n "name=\"username\"" views/user/login.ejs` = 0 (identifier); `grep -n "Parolni unutdingizmi"` ≥1.
14. A11y: label-for, focus, aria-invalid, keyboard.
15. i18n: matnlar uz (H da 4 til).
16. Mavjud testlarni ham ishlat.
17. `implementation-status-uiux.md` ga D-01 statusi yoz.
18. Global report formatida qaytar.
19. Stop condition: enum xato yoki show/hide yo'q bo'lsa.
20. Done condition: login to'liq, professional, calm.
21. D-02 uchun: register — tayyor.
```

---

## D-02 — Register sahifasi (email + NIST parol + rol tanlash)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/register.ejs` (yoki login tab o'rniga alohida sahifa) qurish (A-07 + B base):
   - Struktura: logo + "Hisob yarating" + forma.
   - Field 1: "Email" — `type="email" autocomplete="email"` (MAJBURIY — B-01 schema; A-07).
   - Field 2: "Parol" — `autocomplete="new-password"`, show/hide, `minlength="8"` (client UX; server NIST 8/15 qat'iy — A-22).
     - Parol qoidalari pre-submit: "Kamida 8 belgi" (composition YO'Q — NIST).
     - Parol kuch indikatori (ixtiyoriy, keyin E-44/P2).
   - Rol tanlash: [Talaba] [O'qituvchi] — card/radio (Edikit'ga xos; teacher approval B-29 keyin).
   - CTA: [Hisob yaratish].
   - Trust: "Ma'lumotlar O'zbekistonda saqlanadi" + privacy checkbox (majburiy, pre-ticked EMAS).
03. "Confirm password" EMAS (ivyforms: 1 field + show/hide — 95% uchun 2x yozish noqulay; xato bo'lsa reset).
04. Error inline (B-10): email format, duplicate ("Bunday hisob allaqachon mavjud" → login offramp), parol uzunlik.
05. Email verify oqimi: keyingi qadam (B-06/07 UI — D-03).
06. Progressive profiling: faqat email+parol+rol; qolgani onboarding (B-17).
07. Mobile: single-column; 44px; 16px.
08. Security/data guard: parol hech qachon JS'da qolmaydi; server NIST; CSRF.
09. Unit test: register.ejs da email, minlength 8, rol, consent checkbox (regex).
10. Integration/contract test: register POST (email) ishlaydi; verify send (B-06).
11. E2E/security test: 4-belgili parol server rad; duplicate → login offramp; XSS; consent pre-ticked emas.
12. GREP-CHECK: `grep -rn 'minlength="4"' views/` = 0; `grep -n 'name="email"' views/user/register.ejs` ≥1.
13. A11y: label-for, error aria-live, radio group fieldset.
14. i18n: matnlar uz.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga D-02 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: email yo'q yoki confirm-password bo'lsa.
19. Done condition: register to'liq, minimal, NIST.
20. D-03 uchun: verify/forgot — tayyor.
```

---

## D-03 — Email verify + Forgot/Reset UI

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Email verify sahifasi (B-06/07 UI):
   - OTP 6 raqam: `input inputmode="numeric" autocomplete="one-time-code"` — autofocus, autosubmit, paste enabled, 16px+ (iOS zoom).
   - Resend: 60s timer (disabled), limit 3/soat; "Kod muddati o'tgan — [Yangi kod]".
   - Error: "Kod noto'g'ri yoki muddati o'tgan" + qayta urinish (authgear error map).
   - Trust: "Emailingizga kod yuborildi (user@example.com)" + "Spam'ni tekshiring".
03. Forgot sahifasi (A-06/20 UI):
   - Qadam 1: "Parolni tiklash" — email field → [Yuborish].
   - Qadam 2 (bir xil javob — enumeration): "Agar bu email mavjud bo'lsa, tiklash havolasi yuborildi" + "Spam'ni tekshiring" + [Qayta yuborish] + [Login'ga qaytish].
   - Reset link: 15-60 daqiqa (backend); expired → [Yangi havola] (email prefilled).
04. Reset sahifasi:
   - "Yangi parol" + show/hide + qoidalar (NIST) → [Parolni yangilash].
   - Success: "Parol yangilandi" → login'ga (auto-login EMAS — OWASP) + "Boshqa qurilmalardan chiqildi" xabari.
   - Branches: expired/reused link → aniq xato + yechim (dead-end YO'Q — ux.detroit3d).
05. Enumeration: forgot'da bir xil javob; dummy timing (backend).
06. Motion: auth'da minimal (faqat state feedback 100-160ms); sahifa o'tish — oddiy.
07. Security/data guard: kod/token frontend'da qolmaydi; log'da yo'q; server hash.
08. Unit test: verify/forgot/reset sahifalari matnlari (regex); autocomplete one-time-code.
09. Integration/contract test: flow — forgot→email→reset→login (Playwright mock email).
10. E2E/security test: enum bir xil; expired link; OTP autofill; XSS.
11. GREP-CHECK: `grep -rn "auto-login\|avtomatik kirish" views/` = 0.
12. A11y: OTP aria-label, timer aria-live, keyboard.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga D-03 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: dead-end branch yoki auto-login bo'lsa.
18. Done condition: verify/forgot/reset to'liq, enum-safe.
19. D-04 uchun: MFA UI — tayyor.
```

---

## D-04 — MFA challenge UI (TOTP, backup codes)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. MFA challenge sahifasi (A-26 UI):
   - "Xavfsizlik kodini kiriting" — 6 raqam OTP (D-03 pattern: autofocus, autosubmit, paste).
   - "Boshqa usul" — fallback: backup code, passkey (keyin), telefon (P2).
   - "Ushbu qurilmani eslab qolish" checkbox (trusted device — MFA har safar emas; A-25).
   - Error: "Kod noto'g'ri" + qayta urinish + "5 urinishdan keyin blok" (C-02).
   - Recovery offramp: "Qurilmangiz yo'qmi? Qayta tiklash" (E-45 flow).
03. Backup codes sahifasi (A-26):
   - Bir martalik 10 ta kod ro'yxati (faqat bir marta ko'rsatiladi) + "Saqladim" acknowledgement + yuklab olish (text) + nusxalash.
   - Kodlar HMAC hash (backend); UI'da plaintext faqat shu bir martada.
04. MFA enrollment (A-26): QR (TOTP) — 2 bosqich: skaner → birinchi kodni tekshirish → active.
   - QR render: haqiqiy secret server'dan (frontend'ga plaintext emas — QR tasvir server).
05. Motion: auth'da minimal; success state 160ms.
06. Security/data guard: backup kodlar log/frontend persist emas; QR secret frontend'da qolmaydi.
07. Unit test: MFA sahifalar matnlari (regex); backup "Saqladim" bor.
08. Integration/contract test: challenge→success; backup code ishlaydi (mock).
09. E2E/security test: replay yo'q (challenge consumed); 5 urinish blok; XSS.
10. GREP-CHECK: `grep -rn "backup.*secret\|otp.*log" views/` = 0.
11. A11y: OTP aria, error live, keyboard.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga D-04 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: backup kod qayta ko'rsatilsa yoki replay ochiq bo'lsa.
17. Done condition: MFA UI to'liq, xavfsiz, foydalanuvchi-dostona.
18. D-05 uchun: settings/security center — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## D-05 — Settings / Security center (profil, xavfsizlik, maxfiylik)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/user/security-profile.ejs` (mavjud) + settings'ni qayta tuzish (B base):
   - Section'lar (accordion — D-09):
     1. Profil: ism, avatar (initials fallback), til, tema → PATCH.
     2. Xavfsizlik: parol o'zgartirish (joriy + yangi, show/hide, bir qadam — ux.stackexchange), MFA status (yoqish/o'chirish → D-04), backup codes, passkey (keyin), sessiyalar (A-08), qurilmalar (C-03/18).
     3. Maxfiylik: "Ma'lumotlarim" (nima saqlanadi), eksport (CSV/JSON — D-23), account o'chirish (reauth + confirm), consent (D-25).
     4. Bildirishnomalar: Telegram/email/push toggle + hodisa toggle (B-21/32).
   - Toggle komponent: `.switch` (token, accent-color, aria-checked), 44px.
03. Security center (research_ui_auth 6):
   - Badge: "MFA yoqilgan" / "Passkey mavjud" — statusdan (haqiqiy, yolg'on emas).
   - Reauth sensitive action'lar (parol, MFA o'chirish, delete) — A-29.
   - Parol o'zgartirish: joriy parol + yangi (bir qadam; show/hide).
04. DSAR: eksport/o'chirish — reauth + confirmation (D-23); delete'da "30 kun ichida tugatiladi" aniq.
05. Trust microcopy: "Ma'lumotlar O'zbekistonda saqlanadi" + privacy link.
06. Motion: accordion 220ms; toggle 160ms; reduced-motion.
07. Security/data guard: settings PATCH server validatsiya; IDOR yo'q; PII minimal.
08. Unit test: settings section'lar, toggle aria, reauth (regex).
09. Integration/contract test: settings save (PATCH); DSAR flow; reauth.
10. E2E/security test: IDOR (boshqa user settings); XSS; delete confirm.
11. GREP-CHECK: `grep -rn "aria-checked" views/user/` ≥1 (toggle).
12. A11y: accordion keyboard, focus, aria-expanded, 44px.
13. i18n: matnlar uz.
14. Mavjud testlarni ham ishlat.
15. `implementation-status-uiux.md` ga D-05 statusi yoz.
16. Global report formatida qaytar.
17. Stop condition: IDOR yoki reauth yo'q bo'lsa.
18. Done condition: settings/security center to'liq.
19. D-06 uchun: trust/notification detail — tayyor.
```

---

## D-06 — Auth trust + bildirishnoma prefs detail

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Trust elementi auth sahifalarida (barchasi):
   - Login/register: "Ma'lumotlar O'zbekistonda saqlanadi · Hech qachon uchinchi shaxsga berilmaydi" (D-01/02).
   - Badge (ixtiyoriy): "Argon2 shifrlash" — haqiqiy (A-22).
   - "HEMIS bilan integratsiya" yozilmaydi; "HEMIS bilan kirish" faqat OAuth ishga tushganda (qoida 28).
03. Bildirishnoma prefs (B-21/32 UI):
   - Hodisa toggle'lari: assignment_new, deadline, result, feedback, practice, security.
   - Security xabarlari MAJBURIY (o'chirib bo'lmaydi — B-21).
   - Kanal: email/Telegram/push (B-22/23); Telegram ulash flow (bot link, kod).
   - Quiet hours: 22:00-08:00 default (ixtiyoriy toggle).
   - Chastota: "kuniga ≤3" (no overload — thefinch).
04. Notification preview xavfsizligi: OTP/parol preview'da yo'q ("Xavfsizlik kodi yuborildi" — C-01 email).
05. Motion: minimal.
06. Security/data guard: security prefs o'chirilmaydi; PII minimal.
07. Unit test: prefs toggle'lar; security majburiy (regex).
08. Integration/contract test: prefs save; Telegram ulash.
09. E2E/security test: security xabar o'chirilmaydi; preview PII yo'q; XSS.
10. GREP-CHECK: `grep -rn "integratsiya\|HEMIS bilan" views/user/` = 0 (landing'da ham — qoida 28).
11. A11y: toggle aria; contrast.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga D-06 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: security xabar o'chiriladigan bo'lsa.
17. Done condition: trust + notification prefs to'liq.
18. D-07 uchun: session/devices UI — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## D-07 — Sessiyalar va qurilmalar UI (A-08, C-03/18)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Sessiyalar ro'yxati (A-08):
   - Har sessiya: qurilma nomi (brauzer/OS), geo (shahar — IP hash emas), oxirgi faollik, "Hozirgi" badge.
   - [Boshqa barchasidan chiqish] + har biri uchun [Chiqarish] — reauth sensitive (A-29).
   - Session limit 5 (A-02) — "eng eski avtomatik chiqariladi" eslatma.
03. Qurilmalar (C-18):
   - Trusted devices ro'yxati: nom, sana, IP hash (ko'rinmaydi — yashirin), [O'chirish] (reauth).
   - "Bu qurilma eslab qolindi" badge (D-36 trust).
   - Yangi qurilma step-up xabari (C-04): "Yangi qurilma — bu sizmisiz?" (email/push).
04. UI pattern: card ro'yxat (B-09), status badge (icon+text — rangga bog'liq emas), empty state ("Sessiyalar yo'q").
05. Motion: 160-220ms; reduced-motion.
06. Security/data guard: geo shahar darajasida (PII minimal); revoke darhol server; IDOR yo'q.
07. Unit test: session/device ro'yxat, revoke reauth (regex).
08. Integration/contract test: revoke → session invalid; new device step-up.
09. E2E/security test: IDOR; reauth bypass; XSS.
10. GREP-CHECK: `grep -rn "ip_hash\|IP hash" views/user/` = 0 (yashirin).
11. A11y: ro'yxat keyboard, badge icon+text.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga D-07 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: revoke reauth'siz bo'lsa.
17. Done condition: sessiya/qurilma UI to'liq.
18. D-08 uchun: auth mobile — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## D-08 — Auth mobil optimallashtirish (UZ kontekst)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_auth_deep.md` 8-bo'limi + `research_ui_style_deep.md` 5 (UZ mobil):
   - 375px test barcha auth sahifalar: login, register, verify, forgot, reset, MFA, settings.
   - Single-column; 44px target; 16px input font (iOS zoom yo'q).
   - Input type to'g'ri: email (email keyboard), tel (agar), numeric (OTP).
   - Thumb zone: CTA pastki qismda emas, ko'z darajasida; scroll minimal.
03. OTP autofill: iOS/Android SMS autofill (`autocomplete="one-time-code"`) — D-03.
04. Passkey conditional UI (A-27): login'da `autocomplete="username webauthn"` — browser passkey taklifi; modal fallback (hardware).
   - Feature detect: `browserSupportsWebAuthnAutofill` — yordamlamasa oddiy login.
05. Telegram OTP/bildirishnoma (B-22): telefon'da Telegram app — deep link (t.me/bot), kod autofill emas — qo'lda.
06. Low-bandwidth: SSR (EJS — allaqachon), CSS token'lar bitta fayl, JS minimal; offline error "Ulanishda muammo" + retry.
07. Viewport: `viewport-fit=cover` (head'da bor — saqlanadi); safe-area padding (iPhone).
08. Security/data guard: hech qanday PII yashirin maydonda emas.
09. Unit test: 375px'da elementlar sig'adi (Playwright viewport); 16px font (regex).
10. Integration/contract test: barcha auth flow mobile'da (Playwright 375).
11. E2E/security test: keyboard type to'g'ri; XSS yo'q; autofill.
12. GREP-CHECK: `grep -rn "font-size:.*1[0-5]px" views/user/` — input'da <16px yo'q.
13. A11y: touch target, keyboard.
14. i18n: matnlar uz.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-uiux.md` ga D-08 statusi yoz.
17. Global report formatida qaytar.
18. Stop condition: 375px'da flow buzilsa.
19. Done condition: auth mobile to'liq, UZ-ready.
20. D-09 (checkpoint) uchun: tayyor.
21. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
22. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
23. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
24. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
25. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## D-09 — AUTH UI checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. D-faza qabul testlari:
   - Login: identifier+parol, show/hide, forgot, 1 CTA, trust, enum bir xil.
   - Register: email majburiy, parol NIST 8+, rol tanlash, consent pre-ticked emas, confirm-password yo'q.
   - Verify/Forgot/Reset: OTP autofill, enum-safe, no auto-login, resend+prefill, dead-end yo'q.
   - MFA: challenge+backup, replay yo'q, recovery offramp, remember-device.
   - Settings/Security: section'lar, reauth sensitive, DSAR, security badge.
   - Trust: "Ma'lumotlar UZ'da", HEMIS da'vo yo'q.
   - Sessions/Devices: revoke reauth, geo shahar, IP hash yashirin.
   - Mobile: 375px to'liq, 44px, 16px, OTP autofill, passkey conditional.
03. Full regression: `npm run typecheck` + `npm test` (auth backend testlar buzilmagan).
04. GREP-CHECK jadvali (D bo'yicha).
05. A11y: axe 0 (barcha auth); keyboard to'liq; reduced-motion.
06. i18n: uz to'liq; 4 til H fazada.
07. Visual: auth calm, professional (Google/Jeton benchmark) light/dark.
08. Sign-off: operator checklist (D-faza yopiladi).
09. Security/data guard: critical yashirilmaydi; enumeration/OTP qoidalari saqlanadi.
10. Har yangi write path uchun tenant scope, authorization, validation tekshir.
11. Unit test: full D.
12. Integration/contract test: auth journey (register→verify→login→MFA→settings).
13. E2E/security test: full D E2E + axe + enum + replay.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga D-09 (CHECKPOINT) statusi, dalillar, sign-off yoz.
16. Global report formatida qaytar.
17. Stop condition: birorta qabul testi fail bo'lsa.
18. Done condition: Auth UI to'liq, professional, xavfsiz.
19. Qolgan ishlar: E (User), F (Teacher), G (Cast), H (Admin/QA) — ko'chirilganini yoz.
20. Butun FAZA D yakunlandi — E-00 preflight'ga tayyor.
```

