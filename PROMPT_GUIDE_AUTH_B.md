# Edikit Auth — B-Faza: Register + Onboarding + Email (B-00..B-40)

> **Maqsad:** Register, email verify, teacher approval, onboarding, email infratuzilma — global gigant darajasida, har bosqich alohida prompt.
> **Qo'llash:** A-faza (A-00..A-31) tugagach B-00 dan boshlanadi. Har prompt 30-40 qator.
> **Source of truth:** `research_auth.md`, `research_auth_deep.md`, `hemis_github.md`.

---

## B-00 — Register/Onboarding preflight va baseline

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b-bo'limini va `research_auth_deep.md` 12-15'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Register/Onboarding/Email qismini qurishdan oldin repository holatini inventarizatsiya qilish va baseline yaratish.
05. Precondition: A-31 auth core yashil bo'lishi kerak.
06. Kod yozishdan oldin `routes/auth.js` register qismi, `views/user/login.ejs` register tab, `src/modules/onboarding/`, `firebase/local-db` users schema'ni tekshir.
07. Hozirgi register holatini inventarizatsiya qil: maydonlar, email yig'ish, verify, honeypot, rate limit.
08. `research_auth.md` 1b.1 (email majburiy), 1b.2 (teacher approval), 1b.3 (parol tiklash email) bo'limlarini qayta o'qib, qaysilari A-fazada qurilganini ro'yxatla.
09. Email provider (Postmark/SES) `.env`'da bor-yo'q; SPF/DKIM/DMARC holatini tekshir.
10. Onboarding moduli (agar bor) holatini tekshir.
11. Test holatini o'lcha: `npm test`, `npm run typecheck`.
12. Security/data guard: secret logga chiqmasin; `.git/config`ga tegma.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (agar mavjud).
15. Unit test: existing start command smoke test.
16. Integration/contract test: existing register route smoke test.
17. E2E/security test: workspace'da kutilmagan generated file yo'qligi.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga B-00 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: baseline ishga tushmasa yoki dirty repo.
22. Done condition: baseline, blockerlar, test natijalari va B-01 readiness yozilgan.
23. B-01 uchun tavsiya: users schema to'liq — yoz.
24. Hech qanday kod o'zgartirmasdan yakunla; faqat hisobot bering.
25. Baseline snapshot (commit, test soni) saqlanadi.
26. Register fayllari ro'yxati jadvalini yoz.
27. Email provider holati (bor/yo'q) yoziladi.
28. Teacher approval skeleton holati yoziladi.
29. Onboarding state machine holati yoziladi.
30. B-01 boshlashga tayyor ekanini dalil bilan yoz.
```

## B-01 — Users schema to'liq (final migration)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1, 2-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: users jadvalini to'liq yakuniy schema'ga keltirish (barcha auth fieldlari).
05. Precondition: B-00 baseline yashil bo'lishi kerak.
06. `users` jadvali (migration, backward-compatible): id (uuid), username UNIQUE, name, email UNIQUE NULL, email_verified BOOL, role (student|teacher_pending|teacher|teacher_rejected|admin|co_teacher), is_vip, password_hash, password_updated_at, google_sub UNIQUE NULL, hemis_id UNIQUE NULL, telegram_id UNIQUE NULL, twofa_enabled BOOL, mfa_totp_status, invite_code UNIQUE NULL, failed_attempts, locked_until, last_login_at, last_login_ip_hash, last_login_device_hash, email_status (verified|pending|bounced|suppressed), reject_reason, reject_cooldown_until, created_at, updated_at.
07. Indexes: username UNIQUE, email UNIQUE, google_sub UNIQUE, hemis_id UNIQUE, telegram_id UNIQUE, role_idx.
08. Enum'lar: user_role, email_status — PostgreSQL ENUM yoki CHECK constraint.
09. `updated_at` trigger (automatic).
10. Rollback migration (backward).
11. `src/modules/auth/schema.js` — Zod user DTO (public: id, name, role; private: email, phone, hemis_id).
12. Security/data guard: password_hash hech qachon DTO'da; email PII minimal.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: migration apply/rollback; unique constraint; enum.
16. Integration/contract test: fresh DB migration; user DTO public/private.
17. E2E/security test: duplicate username/email/google_sub/hemis_id blok.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga B-01 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: migration rollback bo'lmasa yoki unique bo'lmasa.
22. Done condition: users schema to'liq, testlar yashil.
23. B-02 uchun: email schema (verification_codes, email_log)ga tayyor ekanini yoz.
24. Legacy firebase user'lar migratsiyasi (Prompt 18 bilan) — alohida.
25. `updated_at` trigger barcha jadvallarda.
26. Email bo'sh legacy user'lar — P1 "bog'lash" flow.
27. Enum o'zgarishi — migration'da careful (ADD VALUE).
28. DTO public hech qachon hemis_id/google_sub'ni ko'rsatmaydi.
29. Barcha fieldlar UZ data law (PII minimal) bilan mos.
30. B-03 forma dizayniga tayyor.
```

## B-02 — Email schema (verification_codes, email_log, mfa backup)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1, 5b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email bilan bog'liq barcha jadvallarni yaratish — verification_codes, email_log, mfa_backup_codes.
05. Precondition: B-01 users schema yashil bo'lishi kerak.
06. `verification_codes` (migration): id, user_id FK, purpose (email_verify|mfa_reset|password_reset), channel (email|telegram), code_hash (SHA-256), expires_at (15 daqiqa), used_at, attempts, created_at.
07. `email_log`: id, user_id NULL, to_email_hash (PII hash), template, status (queued|sent|delivered|bounced|complained|failed), provider_msg_id, error, created_at, updated_at.
08. `mfa_backup_codes`: id, user_id FK, code_hash (HMAC-SHA256), used_at, created_at.
09. `mfa_totp`: id, user_id FK UNIQUE, secret_encrypted (AES-256-GCM), status (pending|active), last_used, created_at.
10. `user_devices` (risk — C-faza bilan): id, user_id FK, fingerprint_hash, first_seen, last_seen, trusted, created_at.
11. `invites` (B-12 bilan): id, token UNIQUE, course_id, group_id, email, telegram_id, used_by, expires_at, revoked_at, created_by.
12. Indexes: verification_codes(user_id, purpose), email_log(status), mfa_backup_codes(user_id).
13. Retention: email_log 30 kun; verification_codes 24 soat; backup codes user MFA o'chsa.
14. Security/data guard: code/secret hech qachon plaintext DB'da (hash/encrypt); email hash (PII minimal).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: migration; hash/encrypt round-trip; expiry.
18. Integration/contract test: fresh DB; relation FK.
19. E2E/security test: code_hash emas plaintext (grep); secret encrypted.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga B-02 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: code/secret plaintext bo'lsa.
24. Done condition: barcha email jadvallar, testlar yashil.
25. B-03 uchun: register forma dizayniga tayyor.
26. email_hash: HMAC-SHA256 (deterministik, DSAR uchun).
27. Purge job (retention) C-fazada.
28. user_devices risk uchun tayyor.
29. invites roster uchun tayyor.
30. B-04 username validatsiyaga tayyor.
```

## B-03 — Register forma dizayni (to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register formasini universitar darajada to'liq qurish — Google birinchi, rol tanlash, email majburiy, ≤5 maydon.
05. Precondition: B-02 schema yashil bo'lishi kerak.
06. `views/user/register.ejs` yarat (login.ejs register tab'idan ajratish):
07. Tartib: [G] Google bilan ro'yxatdan o'ting (44px, ko'rinadigan) → divider "yoki" → forma.
08. Forma maydonlari (≤5): rol (radio: Talaba/O'qituvchi), ism (2-100), email (majburiy, autocomplete="email"), username (autocomplete="username"), parol (autocomplete="new-password", show/hide, kuch indikatori zxcvbn), invite kod (ixtiyoriy, ochiladigan).
09. Email field: `type="email"`, `inputmode="email"`, live validation (syntax) + blur'da MX/disposable check (B-05).
10. Parol: zxcvbn-ts indikator (0-4), NIST policy (min 15/8 dynamic), HIBP check async.
11. Rol tanlash: Talaba → darhol (invite kerak emas); O'qituvchi → "admin tasdiqlaydi" eslatma (B-17).
12. Trust microcopy: "Bepul — kredit karta yo'q", "Ma'lumotlar O'zbekistonda xavfsiz", "Emailingiz parol tiklash uchun kerak".
13. Honeypot hidden field (bot'lar to'ldiradi → silent 200).
14. Turnstile (Cloudflare) widget — signup'da.
15. `public/js/register.js`: rol UX, email live check, parol indikator, invite toggle, inline xatolar, honeypot.
16. A11y: skip link, fokus tartibi, 44px, aria-live, contrast.
17. Mobile: bir ustun, bosh barmoq zonasi, autofill, secure keyboard.
18. 4 til: register stringlar (i18n).
19. Error inline: "Bu email band", "Disposable email ruxsat emas", "Parol breach'da", "Username band".
20. Security/data guard: hech qanday credential inline JS; CSRF hidden; honeypot.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (register_view, role_selected).
23. Unit test: forma render; maydonlar; honeypot.
24. Integration/contract test: submit → account; Google → rol modal.
25. E2E/security test: mobil 44px, XSS, honeypot, rol escalation blok.
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga B-03 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: email majburiy bo'lmasa yoki rol escalation ochiq bo'lsa.
30. Done condition: register forma universitar, testlar yashil.
31. B-04 uchun: username validatsiyaga tayyor.
32. Forma login sahifasi bilan bir xil dizayn tili (style.md).
33. Invite kod — ixtiyoriy, ko'rinadigan (roster user'lar uchun).
34. O'qituvchi tanlaganda "admin tasdiqlaydi" yumshoq eslatma.
35. Barcha write path CSRF + audit bilan.
```

## B-04 — Username validatsiya va normalizatsiya

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 2-bo'limini (OWASP username) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: username validatsiya va normalizatsiyani qurish — case-insensitive, unique, format.
05. Precondition: B-03 forma yashil bo'lishi kerak.
06. Username qoidalari (OWASP): case-insensitive ("smith" = "Smith"); unique; uzunlik 2-50; format `^[a-zA-Z0-9_.-]+$` (kirill/emoji yo'q — login identifier).
07. Normalizatsiya: `safeKey()` — lowercase, trim, NFKC Unicode normalizatsiya; DB'da lower(username) UNIQUE index.
08. Rezerv so'zlar: admin, root, support, system, test — blok (squatting qarshi).
09. Leet/confusable: "аdmin" (kirill 'а') — Unicode confusable detection (ixtiyoriy P1).
10. Username band → inline "Bu username band — boshqasini tanlang"; rate limit (enumeration).
11. `src/modules/auth/username.js` — validate() + normalize() + isReserved().
12. Security/data guard: username PII emas (public); lekin rate limit enumeration qarshi.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: case-insensitive; NFKC; rezerv; confusable.
16. Integration/contract test: duplicate (Smith/smith) blok; legacy migratsiya.
17. E2E/security test: enumeration rate limit; XSS (username output escape).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga B-04 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: case-insensitive bo'lmasa yoki rezerv bo'lmasa.
22. Done condition: username validatsiya to'liq, testlar yashil.
23. B-05 uchun: email validatsiyaga tayyor.
24. Legacy username'lar (agar uppercase) — migratsiya lower.
25. Username o'zgartirish (settings) — P1, audit.
26. Confusable — P1 (biblioteka tanlash).
27. Rezerv ro'yxat config'da.
28. Login'da ham normalize qo'llanadi (A-05 bilan).
29. Barcha write path CSRF + audit bilan.
30. Output: hech qachon username raw (escape).
```

## B-05 — Email validatsiya (syntax + MX + disposable)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5, 8-bo'limlarini (email validation) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email validatsiyani qurish — syntax + MX + disposable + typo suggestion (real-time + async SMTP).
05. Precondition: B-03 forma yashil bo'lishi kerak.
06. `src/modules/email/validate.js`:
   - `validateFast(email)` (sync, <200ms): syntax (regex + email-validator lib) → MX check (dns.resolveMx) → disposable (blok ro'yxat temp-mail/mailinator/10minutemail) → typo suggestion (common domain typo: gmial→gmail, hotmial→hotmail).
   - `validateFull(email)` (async, background): SMTP probe (mailbox mavjudligi) — queue job.
07. Register flow: validateFast sync (blur'da va submit'da) → validateFull async (create'dan keyin email_status pending; SMTP fail bo'lsa — flag).
08. Disposable blok: hard block (yumshoq emas — signup abuse); message: "Doimiy email ishlating — vaqtinchalik email qabul qilinmaydi".
09. Typo suggestion: "gmial.com o'rniga gmail.com demoqchimisiz?" — UX inline.
10. Cache: 24 soat (email → result) Redis — takroriy check tez.
11. `email_status` yangilash: verified|pending|bounced|suppressed (A-23 bilan).
12. Security/data guard: email'ni API'ga yuborishda key backend'da (frontend'da emas); MX check SSRF emas (faqat dns).
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (email_validation, email_disposable_blocked).
15. Unit test: syntax; MX; disposable; typo; cache.
16. Integration/contract test: register flow validateFast→validateFull; disposable blok.
17. E2E/security test: API key leak emas; bypass (client off) — server check.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga B-05 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: disposable blok bo'lmasa yoki API key frontend'da bo'lsa.
22. Done condition: email validatsiya to'liq, testlar yashil.
23. B-06 uchun: verify send'ga tayyor.
24. MX check DNS cache — tezlik.
25. SMTP probe — greylisting'da retry.
26. Typo suggestion — faqat ishonchli xatolikda.
27. Email PII — hash log'da.
28. Barcha write path CSRF + audit bilan.
29. Fallback: MX fail bo'lsa — fail-open (signup davom, email_status pending).
30. Disposable ro'yxat — har oy yangilash.
```

## B-06 — Email verify send (6-kod)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email verify 6-kod yuborishni qurish (register'da).
05. Precondition: B-05 email validatsiya yashil; A-23 email provider yashil.
06. POST /api/verify/send { channel: 'email' } — account yaratilgandan keyin.
07. Kod yaratish: crypto.randomInt(100000, 999999) → 6 raqam → SHA-256 hash saqlash (verification_codes).
08. Expiry: 15 daqiqa; 1 marta foydalanish; resend timer 60s.
09. Email template `verify.ejs`: "Tasdiqlash kodi: 123456 — 15 daqiqa amal qiladi. Spamni tekshiring." (4 til).
10. Provider orqali yuborish (A-23): email_log status queued→sent.
11. Rate limit: send 3/soat (per user); kod brute-force qarshi (check 5/15).
12. UX: verify ekran (kod input 6 raqam, resend, "email noto'g'ri — yangilash"); OTP autofill (mobile).
13. Limited mode: verify'siz — o'qish/practice ruxsat; summative blok; banner "Emailni tasdiqlang".
14. Audit: verify_sent (channel) — kod hech qachon logga.
15. A11y: kod input keyboard; 44px; aria-live; banner.
16. Mobile: OTP autofill (one-time-code).
17. 4 til: verify stringlar.
18. Security/data guard: kod hash; kod email'da plaintext (normal); log'da yo'q.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (verify_sent).
21. Unit test: kod yaratish; hash; expiry; resend.
22. Integration/contract test: send→email_log→delivery; rate limit.
23. E2E/security test: kod log'da yo'q (grep); brute-force; abuse.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga B-06 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: kod hash bo'lmasa yoki logga tushsa.
28. Done condition: verify send ishlaydi, testlar yashil.
29. B-07 uchun: verify check'ga tayyor.
30. Kod'ni email'da ko'rsatish — normal (verify uchun).
```

## B-07 — Email verify check + limited mode

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email verify check'ni qurish — kod tekshirish, limited mode, success UX.
05. Precondition: B-06 send yashil bo'lishi kerak.
06. POST /api/verify/check { code } → SHA-256 → verification_codes solishtirish.
07. To'g'ri → used_at set, users.email_verified=true, email_status=verified; audit verify_complete.
08. Noto'g'ri/eskirgan → 422 OTP_INVALID → "Kod noto'g'ri yoki eskirgan" + resend; attempts++ (5 → 15 daqiqa lockout).
09. Kod bitta foydalanish (replay yo'q); consumed.
10. Limited mode (policy): verify'siz — o'qish, practice (formative) ruxsat; summative (nazorat topshirish) blok; har bloklangan amalda "Emailni tasdiqlang" banner + [Tasdiqlash].
11. Success UX: "Email tasdiqlandi ✓" → banner yo'qoladi; barcha limited mode'lar ochiladi.
12. Resend: timer 60s; email noto'g'ri bo'lsa — yangilash imkoniyati (B-39 email change bilan).
13. A11y: banner live-region; kod input keyboard; 44px.
14. Mobile: OTP autofill.
15. 4 til: verify stringlar.
16. Security/data guard: kod hash; bitta foydalanish; rate limit.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (verify_complete, limited_mode_used).
19. Unit test: check logikasi; expiry; bitta foydalanish; lockout.
20. Integration/contract test: to'g'ri/noto'g'ri kod; limited mode blok; summative blok.
21. E2E/security test: brute-force, replay, summative verify'siz blok.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga B-07 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: kod takror ishlatilsa yoki summative verify'siz ochiq bo'lsa.
26. Done condition: verify check + limited mode ishlaydi, testlar yashil.
27. B-08 uchun: honeypot+Turnstile+rate limitga tayyor.
28. Limited mode policy config'da (tenant).
29. Kod input 6 ta raqam (single-digit).
30. Barcha write path CSRF + audit bilan.
```

## B-08 — Register bot himoya (honeypot + Turnstile + rate limit)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini (bot protection) va r/SaaS pattern'larini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register'ni bot'lardan himoyalash — honeypot, Turnstile, layered rate limit.
05. Precondition: B-03 forma yashil bo'lishi kerak.
06. Honeypot: yashirin input (CSS'dan yashirilgan, screen reader'ga emas); bot'lar to'ldiradi → **silent 200** (account yaratilmaydi, log bot_detected).
07. Turnstile (Cloudflare): widget signup/login/forgot'da; server verify (siteverify); `botDetected` signal — risk score'ga (C-faza).
08. Rate limit (layered): per-IP 5/15 daqiqa; per-ASN (distributed bot qarshi); per-email 3/soat; per-device (fingerprint, C-faza).
09. IP reputation: mashhur bot IP'lar (list/API) — fail'da Turnstile qattiq.
10. Disposable email blok (B-05) — bot signup qarshi asosiy.
11. Behavior signal: form fill tezligi (insanely fast = bot), mouse/keyboard — P2.
12. Signup'dan keyin email verify (B-06) — bot'lar email'ga kira olmaydi.
13. Suspicious signup (ko'p bir IP'dan) → review queue (admin) yoki Turnstile challenge.
14. Audit: bot_detected, signup_blocked, signup_review.
15. A11y: Turnstile accessible; honeypot screen reader'ga emas (aria-hidden).
16. Mobile: Turnstile managed.
17. Security/data guard: Turnstile secret backend'da; honeypot field'da ma'lumot yo'q.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (bot_detected, signup_blocked).
20. Unit test: honeypot (to'ldirilgan → silent); Turnstile mock; rate limit.
21. Integration/contract test: bot simulyatsiya → blok; legit signup → davom.
22. E2E/security test: distributed (turli IP) — per-ASN tutadi; honeypot bypass emas.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga B-08 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: honeypot silent bo'lmasa yoki Turnstile secret frontend'da bo'lsa.
27. Done condition: bot himoya layered, testlar yashil.
28. B-09 uchun: duplicate handlingga tayyor.
29. Turnstile free tier yetarli (bot qarshi).
30. Behavior P2 — ML (C-faza risk bilan).
```

## B-09 — Duplicate account handling

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 2-bo'limini (OWASP Auth) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: duplicate account (email/username) handling'ni qurish — "akkauntingiz bor" flow, account linking.
05. Precondition: B-07 verify yashil bo'lishi kerak.
06. Register'da duplicate (email OR username) → "Akkauntingiz borga o'xshaydi" + [Kirish] (login rejimiga, email prefilled) + [Parolni unutdingizmi?] — Authgear mapping.
07. Enumeration himoya: duplicate xabar — rate limit bilan; email band xabar bilan bir xil (har doim emas — lekin rate limit).
08. Account linking (Google ↔ password): email verified bo'lsa → users.google_sub bog'lash (A-07 bilan); mapping tranzaktsion.
09. Linking xavfsizlik: Google sub email verified bo'lmasa — link YO'Q; escalation yo'q.
10. HEMIS ID (C-faza): hemis_id ↔ user bog'lash — verified email sharti.
11. Merge flow (P2): ikki account bitta bo'lsa — admin review (identity mismatch queue).
12. Audit: account_linked, duplicate_attempt.
13. A11y: "Kirish" link accessible.
14. Mobile: bir xil oqim.
15. 4 til: duplicate stringlar.
16. Security/data guard: enumeration rate limit; linking verified shart.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: duplicate detection; linking; escalation blok.
20. Integration/contract test: duplicate → login flow; Google link verified email.
21. E2E/security test: escalation (boshqa user email'ga link) blok; enumeration.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga B-09 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: linking verified bo'lmasa yoki escalation ochiq bo'lsa.
26. Done condition: duplicate handling to'liq, testlar yashil.
27. B-10 uchun: Google register rol modalga tayyor.
28. Merge P2 — admin review.
29. Email band + duplicate bir xil UX (rate limit bilan).
30. Barcha write path CSRF + audit bilan.
```

## B-10 — Google register + rol modal (to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.1, 1b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Google orqali ro'yxatdan o'tishni to'liq qurish — callback, rol modal, invite bog'lash.
05. Precondition: A-07 OIDC yashil; B-03 forma yashil.
06. Flow: /auth/google → callback → users.google_sub yo'q → **rol modal** (2-qadam).
07. Modal: "Xush kelibsiz, [Ism]!" — ism/email OIDC claims'dan prefilled; rol kartalari [Talaba] [O'qituvchi]; invite kod (agar URL'da).
08. Talaba → account yaratish (email_verified=true, email from claims) → onboarding (B-24).
09. O'qituvchi → account + `teacher_pending` (B-17) → "admin tasdiqlaydi" xabar.
10. Invite bor bo'lsa: course/group bog'lash (B-12/13), rol student prefilled.
11. Account-linking: email verified → users.google_sub bog'lash (B-09).
12. Session regenerate; redirect role bo'yicha; audit (google_register_created, role_selected).
13. Admin Google bilan emas (CONFIG alohida).
14. A11y: modal focus trap; rol kartalari keyboard; 44px.
15. Mobile: modal sheet.
16. 4 til: rol modal stringlar.
17. Security/data guard: rol allowlist; invite escalation yo'q; email verified.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
20. Unit test: rol tanlash; invite prefilled; escalation blok.
21. Integration/contract test: callback→modal→account; email verified; invite.
22. E2E/security test: rol=admin rad; invite abuse; Google token leak.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga B-10 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: escalation yoki verified bo'lmasa.
27. Done condition: Google register to'liq, testlar yashil.
28. B-11 uchun: invites schema'ga tayyor.
29. Modal "Bekor qilish" → boshqa usul.
30. Google token hech qachon frontend'da.
```

## B-11 — Invites schema + yaratish (roster uchun)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini (roster/invite) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: invites jadvali va invite yaratish/revoke API'ni qurish (roster bilan).
05. Precondition: B-10 yashil; A-11 roster yashil.
06. `invites` jadvali (B-02): token (48B hex UNIQUE), course_id, group_id, email, telegram_id, used_by, expires_at (7 kun), revoked_at, created_by.
07. POST /api/invites (teacher/admin): batch yaratish (roster'dan) — har talabaga token + link.
08. Token: crypto.randomBytes(48) → base64url; DB'da hash? — token 1 marta, revoke; hash saqlash (parol kabi) — P1 (xavfsizlik).
09. Yetkazish: email template `invite.ejs` ("Taklif: Fizika 2-guruh — [Havola]") + Telegram (ulangan bo'lsa).
10. Invite link: /invite/:token — HTTPS, Referrer-Policy no-referrer.
11. Revoke: POST /api/invites/:id/revoke (teacher) — eskirgan/noto'g'ri invite'lar; audit.
12. Expiry job: 7 kundan oshgan → revoke; teacher'ga "N talaba aktivatsiya qilmadi" (P1).
13. Rate limit: invite yuborish 50/soat (batch); abuse qarshi.
14. A11y: invite email accessible.
15. Mobile: link ochish.
16. 4 til: invite stringlar.
17. Security/data guard: token 1 marta; revoke; rate limit; link'da sensitive yo'q.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (invite_created, invite_revoked).
20. Unit test: token uzunlik; batch; revoke; expiry.
21. Integration/contract test: batch→email/telegram; revoke; expiry job.
22. E2E/security test: token replay; abuse; IDOR (boshqa teacher invite revoke).
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga B-11 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: token 1 marta bo'lmasa yoki revoke auth bo'lmasa.
27. Done condition: invites to'liq, testlar yashil.
28. B-12 uchun: invite view'ga tayyor.
29. Invite hash P1 (token DB'da hash).
30. Barcha write path CSRF + audit bilan.
```

## B-12 — Invite aktivatsiya view + validatsiya

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: invite aktivatsiya sahifasi va token validatsiyasini qurish.
05. Precondition: B-11 invites yashil bo'lishi kerak.
06. `views/user/invite.ejs` yarat: "Siz taklif qilindingiz ✓" — kurs, guruh, o'qituvchi; [G] Google bilan tasdiqlash / [Username+parol yaratish].
07. Token validatsiya (GET /invite/:token): mavjud, 7 kun ichida, ishlatilmagan, revoke emas → aks holda aniq xato.
08. Xato UX: "Taklif muddati o'tgan — yangisini so'rang" + teacher'ga xabar imkoniyati.
09. Google accept: callback'da invite token (URL) → google_sub + invite bog'lash → course/group prefilled → onboarding (qisqa).
10. Parol accept: forma (ism, username, email, parol NIST) → invite bog'lash → onboarding.
11. Invite ishlatilganda: used_by set; used_at; takroriy → "Taklif allaqachon ishlatilgan".
12. A11y: 44px, fokus, screen reader (taklif ma'lumoti aniq).
13. Mobile: bir ustun, Google full-width.
14. 4 til: invite stringlar.
15. Security/data guard: token 48B random; bitta foydalanish; rate limit; CSRF.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (invite_view, invite_expired).
18. Unit test: token validatsiya holatlari (to'g'ri/buzuq/ishlatilgan/eskirgan/revoked).
19. Integration/contract test: sahifa render; token holatlari; accept.
20. E2E/security test: token brute-force (rate limit); replay.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-12 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: token bitta foydalanish bo'lmasa.
25. Done condition: invite sahifa + validatsiya, testlar yashil.
26. B-13 uchun: invite accept (Google+parol)ga tayyor.
27. Invite URL'da token ko'rinadi (link) — rate limit himoya.
28. Expiry job (B-11) davom.
29. Invite bilan rol oshirish yo'q.
30. Barcha write path CSRF + audit bilan.
```

## B-13 — Invite accept (Google + parol) + enrollment

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: invite accept'ni qurish — Google/parol bilan, course/group enrollment.
05. Precondition: B-12 invite sahifa yashil bo'lishi kerak.
06. Google accept: callback'da invite → google_sub + invite bog'lash → enrollment (course/group) yozish (Prompt 14 modeli).
07. Parol accept: forma (ism, username, email, parol NIST + HIBP + zxcvbn) → Argon2 → invite bog'lash → enrollment.
08. Enrollment transaksion: invites.used_by + enrollments + users — bitta transaction.
09. Role: student (invite o'qituvchi emas); co-teacher invite — P2 (teacher yaratadi).
10. Invite ishlatilganda takroriy → 409 "Taklif allaqachon ishlatilgan" + support.
11. Audit: invite_used (user, course, group).
12. A11y: accept forma keyboard; 44px.
13. Mobile: Google full-width; forma bir ustun.
14. 4 til: accept stringlar.
15. Security/data guard: invite 1 marta; escalation yo'q; CSRF; enrollment user-scoped.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (invite_accepted).
18. Unit test: accept logikasi; used_by; enrollment transaction.
19. Integration/contract test: Google accept; parol accept; takroriy rad; rollback.
20. E2E/security test: replay, escalation, IDOR.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-13 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: invite takror ishlatilsa yoki transaction bo'lmasa.
25. Done condition: invite accept + enrollment, testlar yashil.
26. B-14 uchun: teacher approval'ga tayyor.
27. Enrollment kalendar bilan sinxron (C-faza).
28. Invite token hech qachon audit'da to'liq emas (hash).
29. Accept'dan keyin onboarding (B-24) — qisqa (guruh bor).
30. Barcha write path CSRF + audit bilan.
```

## B-14 — Teacher approval: state machine + schema

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 9-bo'limini (Entra PIM) va `research_auth.md` 1b.2'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher approval state machine va schema'ni qurish (Entra PIM patterni).
05. Precondition: B-13 yashil bo'lishi kerak.
06. Role state machine: registered → teacher_pending → teacher (approved) | teacher_rejected → (cooldown 30 kun) → teacher_pending (qayta ariza).
07. `teacher_applications` jadvali: id, user_id FK, full_name, email, university, subject, experience TEXT, reason TEXT, status (pending|approved|rejected), reviewed_by, reviewed_at, justification, reject_reason, cooldown_until, created_at.
08. users.role: teacher_pending|teacher|teacher_rejected (B-01 bilan mos).
09. Transition qoidalari: pending→approved (admin, justification majburiy); pending→rejected (admin, reason majburiy); rejected→pending (faqat cooldown'dan keyin); approved→rejected (admin, sabab).
10. Approval window: 72 soat; o'tib ketsa eslatma; 7 kun → eskalatsiya (super-admin).
11. Approver: admin; o'z arizasini approve qilolmaydi (Entra qoidasi).
12. `src/modules/auth/teacher-approval.js` service: state machine, validate transition, audit.
13. Security/data guard: role transition faqat admin; IDOR; audit.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (teacher_application_submitted).
16. Unit test: state machine; transition; cooldown; window.
17. Integration/contract test: register→pending→approved; rejected→cooldown→qayta.
18. E2E/security test: non-admin transition blok; IDOR.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga B-14 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: state machine bo'lmasa yoki transition auth bo'lmasa.
23. Done condition: state machine + schema, testlar yashil.
24. B-15 uchun: admin ro'yxatga tayyor.
25. Eskalatsiya job (7 kun) — scheduled.
26. Cooldown config'da (30 kun default).
27. Justification majburiy (DB constraint).
28. Barcha write path CSRF + audit bilan.
```

## B-15 — Teacher approval: admin ro'yxat + approve/reject

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.2-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin "Teacher arizalari" panelini qurish — ro'yxat, filter, approve/reject + justification.
05. Precondition: B-14 schema yashil bo'lishi kerak.
06. `views/admin/teachers.ejs` yarat: ro'yxat (ism, email, universitet, fan, tajriba, sana, status), filter (pending/approved/rejected), qidiruv, pagination.
07. Har ariza: to'liq ma'lumot + [Tasdiqlash] [Rad etish + sabab (majburiy)].
08. Approve: POST /admin/teachers/:id/approve { justification } → role=teacher, status=approved, reviewed_by=admin_id → xabar (email+Telegram) "Tabriklaymiz!" → welcome onboarding.
09. Reject: POST /admin/teachers/:id/reject { reason } → role=teacher_rejected, cooldown_until=+30 kun → xabar sabab bilan.
10. Approver o'z arizasini ko'rmaydi/approve qilolmaydi.
11. Email notification admin'ga (yangi ariza) + reminder (24s/48s).
12. Eskalatsiya: 7 kun ko'rib chiqilmagan → super-admin'ga (B-16).
13. Admin audit: teacher_approved/rejected (admin_id, ts, justification).
14. Rate limit admin amallarida; CSRF.
15. A11y: ro'yxat keyboard; 44px; modal accessible.
16. Mobile: admin panel responsive.
17. 4 til: teacher admin stringlar.
18. Security/data guard: faqat admin (requireRole); IDOR; audit.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (teacher_approved, teacher_rejected).
21. Unit test: approve/reject logikasi; justification required; IDOR.
22. Integration/contract test: approve→role+xabar; reject→cooldown; reminder.
23. E2E/security test: non-admin 403; boshqa user approve blok; XSS.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga B-15 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: justification bo'lmasa yoki non-admin approve qila olsa.
28. Done condition: admin panel to'liq, testlar yashil.
29. B-16 uchun: SLA/escalationga tayyor.
30. Admin ro'yxatda PII minimal (email ko'rinadi — admin uchun).
```

## B-16 — Teacher approval: SLA, eskalatsiya, pending limited mode

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.2-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher approval SLA (eslatma+eskalatsiya) va pending limited mode'ni qurish.
05. Precondition: B-15 admin panel yashil bo'lishi kerak.
06. SLA job (scheduled): ariza 24s ko'rib chiqilmagan → admin'ga email eslatma; 48s → yana; 72s window tugadi → "qayta ko'rib chiqish" reminder; 7 kun → **eskalatsiya** super-admin'ga (email+Telegram).
07. `teacher_applications` ga sla_state (normal|reminded|escalated) qo'shish.
08. Pending limited mode (login'da): "Arizangiz ko'rib chiqilmoqda — odatda 1-3 ish kuni" ekrani.
09. Ruxsat: profil, sozlamalar, bildirishnoma; BLOK: test yaratish, cast, student data, course CRUD, natija ko'rish.
10. Har bloklangan amalda aniq xabar: "O'qituvchi sifatida tasdiqlanmagansiz".
11. Qayta login: doim pending ekrani (trap emas).
12. Rejected login: "Arizangiz rad etildi — sabab: ..." + [Qayta ariza] (cooldown'dan keyin enabled) + [Apellyatsiya] (support).
13. Qayta ariza: faqat cooldown'dan keyin (30 kun); yangi teacher_applications row.
14. Audit: teacher_sla_reminded, teacher_escalated, teacher_appeal.
15. A11y: pending/rejected ekran keyboard; 44px.
16. Mobile: bir xil.
17. 4 til: pending/rejected stringlar.
18. Security/data guard: pending/rejected teacher student data blok (403); IDOR.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
21. Unit test: SLA state; eskalatsiya; limited mode blok; cooldown.
22. Integration/contract test: ariza→eslatma→eskalatsiya; pending blok; rejected qayta ariza.
23. E2E/security test: rejected teacher student data ko'rmaydi; IDOR; cooldown bypass.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga B-16 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: limited mode blok bo'lmasa yoki eskalatsiya bo'lmasa.
28. Done condition: SLA + limited mode, testlar yashil.
29. B-17 uchun: onboarding'ga tayyor.
30. SLA job idempotent (takroriy email emas).
```

## B-17 — Onboarding: state machine + Orient

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: onboarding state machine va Orient (welcome) ekranini qurish.
05. Precondition: B-16 yashil bo'lishi kerak.
06. `onboarding_state` jadvali: user_id PK, step (welcome|first_win|checklist|done), checklist JSONB, activated_at, welcome_sent_at.
07. `src/modules/onboarding/service.js`: state machine (welcome→first_win→checklist→done), progress, skip.
08. GET /onboarding — step bo'yicha view (stepper).
09. Orient ekran: "Xush kelibsiz, [Ism]! 🎓" + ixtiyoriy savollar (fan tanlash demo uchun, maqsad) + [Skip] (skip +10-15% activation).
10. POST /api/onboarding/orient { subject?, goal? } → step=first_win.
11. Demo savollar: pre-loaded bank (universitar, oson, 4 til); answer key server'da (public DTO).
12. A11y: stepper keyboard; fokus; 44px; reduced-motion.
13. Mobile: bir ustun; sticky progress.
14. 4 til: orient stringlar.
15. Security/data guard: onboarding_state user-scoped; step monotonik (orqaga emas).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (onboarding_view, orient_done).
18. Unit test: state machine; skip; monotonic.
19. Integration/contract test: orient→first_win; qayta kirish (half-done davom).
20. E2E/security test: IDOR; step manipulation.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-17 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: step monotonik bo'lmasa yoki IDOR ochiq bo'lsa.
25. Done condition: onboarding state + Orient, testlar yashil.
26. B-18 uchun: first-win'ga tayyor.
27. Fan tanlash demo bank'ga ulanadi.
28. ReturnUrl onboarding'dan keyin saqlanadi.
29. Stepper 3 bosqich (Orient/Activate/Reinforce).
30. Barcha write path CSRF + audit bilan.
```

## B-18 — Onboarding: Activate (first-win) — ACTIVATION EVENT

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: onboarding Activate (first-win) — 5 savollik amaliyot + natija + ACTIVATION EVENT.
05. Precondition: B-17 Orient yashil bo'lishi kerak.
06. POST /api/onboarding/first-win/start → 5 savol (fan bo'yicha, oson, pre-loaded bank).
07. Savollar public DTO (answer key server'da); oddiy attempt UI (savol+variantlar).
08. POST /api/onboarding/first-win/answer { itemId, answer } → server scoring + elaborative feedback (izoh).
09. POST /api/onboarding/first-win/complete → summary: ball + izohli feedback + "X mavzuda 40% — amaliyot qiling".
10. **ACTIVATION EVENT:** onboarding_state.activated_at = now; step=checklist; analytics first_win_complete.
11. TTFV <5 daqiqa (timing test).
12. Natija ekrani: "Aha" — feedback qiymati ko'rinadi.
13. A11y: savol/variantlar screen reader (shakl+rang); 44px; keyboard.
14. Mobile: katta savol matni; tiles thumb zonada.
15. 4 til: demo savollar tilga mos.
16. Security/data guard: answer key server'da; attempt user-scoped.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (first_win_start, first_win_complete).
19. Unit test: 5 savol tanlash; scoring; feedback; activated_at.
20. Integration/contract test: start→answer→complete→checklist; TTFV timing.
21. E2E/security test: answer key scan; IDOR; replay.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga B-18 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: answer key leak yoki activation event bo'lmasa.
26. Done condition: first-win + activation, testlar yashil.
27. B-19 uchun: checklist'ga tayyor.
28. Demo savollar 4 til + 10 fan (P1 kengayadi).
29. First-win summative'ga kirmaydi.
30. Natija feedback'li (noto'g'ri javoblarga izoh).
```

## B-19 — Onboarding: Reinforce (checklist) + welcome sequence

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: onboarding checklist (Reinforce) va welcome sequence (Day 0/1/3/7) qurish.
05. Precondition: B-18 first-win yashil bo'lishi kerak.
06. Checklist 5 item (quick win birinchi): (1) Profil, (2) Telegram ulash, (3) Birinchi amaliyot ✓, (4) Kalendar, (5) Birinchi va'da (streak).
07. Checklist sticky progress (Zeigarnik); done → step=done → /panel.
08. POST /api/onboarding/checklist { itemId, done }.
09. `src/modules/onboarding/welcome.js` job (scheduled): Day 0 (welcome + first action), Day 1 (birinchi natija), Day 3 (3 tip), Day 7 (haftalik rejim) — Telegram/email.
10. Welcome idempotency: har day bir marta (welcome_sent_at + day flags); chastota cap.
11. Personalizatsiya: rol, til, fan.
12. In-app kontekstual tooltip (tour EMAS).
13. A11y: checklist keyboard; aria; sticky progress.
14. Mobile: sticky progress pastda.
15. 4 til: checklist/welcome stringlar.
16. Security/data guard: checklist user-scoped; welcome PII minimal.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (checklist_complete, welcome_sent).
19. Unit test: checklist logikasi; welcome schedule; idempotency.
20. Integration/contract test: done→panel; Day 0/1/3/7; takroriy emas.
21. E2E/security test: IDOR; spam (chastota); preview scan.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga B-19 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: checklist tugamasa step done bo'lmasa yoki welcome spam bo'lsa.
26. Done condition: checklist + welcome, testlar yashil.
27. B-20 uchun: email templates'ga tayyor.
28. Checklist item qayta ochilishi mumkin (settings).
29. Day-0 achievement checklist bilan (Trophy darsi).
30. Completion metrikasi (60-80% target).
```

## B-20 — Email templates (barcha 8 tur, 4 til)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5b-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: barcha transactional email template'larini qurish (8 tur, 4 til, accessible, spam-safe).
05. Precondition: A-23 email provider yashil bo'lishi kerak.
06. `src/modules/email/templates/` — har tur uchun .ejs:
07. 1) `verify.ejs` — "Tasdiqlash kodi: 123456 — 15 daqiqa amal qiladi. Spamni tekshiring." (6-kod).
08. 2) `reset.ejs` — "Parolni tiklash havolasi" — 15 daqiqa, bitta foydalanish, [Havola].
09. 3) `welcome.ejs` — "Xush kelibsiz! Birinchi amaliyotni boshlang" (Day 0).
10. 4) `invite.ejs` — "Siz taklif qilindingiz: Fizika 2-guruh" — [Qabul qilish].
11. 5) `teacher_approved.ejs` — "Tabriklaymiz, o'qituvchi sifatida tasdiqlandingiz!".
12. 6) `teacher_rejected.ejs` — "Arizangiz rad etildi — sabab: ...".
13. 7) `security.ejs` — "Parol/email o'zgartirildi", "Yangi qurilmadan kirish", "Suspicious login" (time, browser, geo).
14. 8) `breach.ejs` — "Parolingiz ma'lum breach'da — o'zgartiring" (P1).
15. Template qoidalari: plain-text version (accessible), preheader, qisqa, spam trigger yo'q (ALL CAPS, "FREE"), bitta CTA, footer (unsubscribe faqat marketing — transactional emas).
16. 4 til: uz-Latn, uz-Cyrl, ru, en — professional tarjima (Prompt 63).
17. A11y: text version, contrast, semantic.
18. Mobile: responsive (max-width 600px).
19. Security/data guard: email'da parol/token hech qachon (faqat kod/limitli havola); PII minimal; footer support.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
22. Unit test: template render 4 til; spam scan; text version.
23. Integration/contract test: har template → provider → deliver.
24. E2E/security test: token leak yo'q (grep); XSS (user data escape).
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. `implementation-status-auth.md`ga B-20 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: template'da parol/token bo'lsa yoki spam trigger bo'lsa.
29. Done condition: 8 template, 4 til, testlar yashil.
30. B-21 uchun: notification prefs'ga tayyor.
```

## B-21 — Notification preferences (schema + settings UI)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5b-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: notification preferences schema va settings UI'ni qurish.
05. Precondition: B-20 templates yashil bo'lishi kerak.
06. `notifications_prefs` jadvali: user_id PK, telegram_id, telegram_enabled BOOL default true, email_enabled BOOL default false, push_enabled BOOL default false, types JSONB (assignment, result, practice, deadline, feedback, security) — har tur toggle.
07. Settings UI: kanal toggle'lar (Telegram/email/push) + hodisa toggle'lar (6 tur).
08. Default: telegram on (O'zbekiston standardi), email off (spam yo'q), push off.
09. Security hodisalari (new device, password change) — **o'chirib bo'lmaydi** (majburiy xabar).
10. `src/modules/student/notifications.js` dispatch: hodisa → kanal routing (prefs bo'yicha).
11. Chastota cap: kuniga ≤2-3 (har kanal); dedupe 24 soat.
12. A11y: toggle label+aria; 44px; keyboard.
13. Mobile: accordion.
14. 4 til: notif stringlar.
15. Security/data guard: telegram_id PII (UZ); preview sensitive yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (notif_prefs_updated).
18. Unit test: prefs default; toggle; security forced.
19. Integration/contract test: prefs saqlash; dispatch routing.
20. E2E/security test: IDOR; XSS.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-21 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: security hodisalari o'chsa yoki telegram_id PII noto'g'ri saqlansa.
25. Done condition: prefs + UI, testlar yashil.
26. B-22 uchun: Telegram bot'ga tayyor.
27. Chastota cap config'da.
28. Push (PWA) — C-fazada.
29. Preview template'lar B-20'dan.
30. Barcha write path CSRF + audit bilan.
```

## B-22 — Telegram bot (ulash + xabar yuborish)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.3-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Telegram bot'ni qurish — ulash flow, xabar yuborish, chat.
05. Precondition: B-21 prefs yashil; bot token .env'da (testda mock).
06. Ulash: Settings → "Telegram'ni ulash" → t.me/EdikitBot?start=<token 20B, 5 daqiqa, 1 marta>.
07. Bot callback: signed (bot_token HMAC), user data (id, first_name, username) — verify; users.telegram_id saqlash; prefs.telegram_enabled=true.
08. Xabar yuborish: `src/modules/email/telegram.js` send(chatId, text, parseMode) — prefs bo'yicha; retry/backoff 3 marta.
09. Chat: talaba bot'ga yozsa — "Natijalarim", "Bugungi jadval" (o'z tizimidan, read-only).
10. Chastota cap: kuniga ≤2-3 (B-21 bilan); dedupe.
11. Audit: telegram_linked, telegram_sent, telegram_failed.
12. A11y: bot matn oddiy til; preview sensitive yo'q.
13. Mobile: Telegram'da qulay.
14. 4 til: bot stringlar.
15. Security/data guard: telegram_id PII (UZ); token bitta foydalanish; xabar preview sensitive yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: signed callback; token expiry; send retry.
19. Integration/contract test: ulash→xabar; chat; cap.
20. E2E/security test: noto'g'ri signed callback; spam; preview scan.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-22 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: signature verify bo'lmasa yoki preview sensitive bo'lsa.
25. Done condition: Telegram bot to'liq, testlar yashil.
26. B-23 uchun: push (PWA)ga tayyor.
27. Telegram auth (A-16) bilan ulash alohida.
28. Bot chat read-only (o'z ma'lumoti).
29. Barcha write path CSRF + audit bilan.
30. Xabar uzunligi limit (Telegram 4096).
```

## B-23 — Push notifications (PWA)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5b-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: PWA push notification'larini qurish — subscription, send, kontekstual opt-in.
05. Precondition: B-22 Telegram yashil; PWA service worker tayyor.
06. Web Push: VAPID keys (.env); `public/js/push.js` subscribe (service worker + pushManager).
07. Kontekstual opt-in: 2-3 sessiyadan keyin so'raladi (birinchi kirishda emas) — opt-in rate yuqori.
08. `push_subscriptions` jadvali: id, user_id, endpoint, p256dh, auth, created_at.
09. Send: web-push lib; payload encrypt; prefs bo'yicha (B-21).
10. Chastota cap: kuniga ≤2-3; dedupe; quiet hours (22:00-08:00 default).
11. Subscription expiry: 410 → unsubscribe.
12. Audit: push_subscribed, push_sent, push_failed.
13. A11y: push accessible; quiet hours.
14. Mobile: PWA install'dan keyin.
15. 4 til: push stringlar.
16. Security/data guard: endpoint PII; VAPID secret KMS; payload minimal (preview sensitive yo'q).
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: VAPID; encrypt; subscription expiry.
20. Integration/contract test: subscribe→send→deliver; opt-in timing.
21. E2E/security test: abuse; preview scan; quiet hours.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga B-23 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: VAPID secret KMS'da bo'lmasa yoki quiet hours bo'lmasa.
26. Done condition: push to'liq, testlar yashil.
27. B-24 uchun: email change'ga tayyor.
28. iOS Safari push — cheklangan (fallback email/Telegram).
29. Subscription cleanup job.
30. Barcha write path CSRF + audit bilan.
```

## B-24 — Email change flow (reauth + double opt-in)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini (email change) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email change flow'ini qurish — reauth, ikkala address verify, notification.
05. Precondition: B-07 verify yashil; A-29 account events yashil.
06. POST /api/account/email/request { newEmail }:
   - **Reauth**: current password yoki MFA (step-up, mfaAt 30 daqiqa) — session yetarli emas (OWASP).
   - newEmail validatsiya (B-05 syntax/MX/disposable).
   - Rate limit 3/soat; audit email_change_requested.
07. **Ikkala address'ga verify** (OWASP majburiy — email = recovery):
   - Yangi email'ga code (B-06 template) — verify.
   - Eski email'ga xabar: "Emailingiz o'zgartirilmoqda — [Tasdiqlash]/[Bekor qilish]" (agar siz bo'lmasangiz).
08. POST /api/account/email/confirm { newCode, oldToken } → commit: users.email=new, email_verified=true, eski email'ga "o'zgartirildi" xabar.
09. Eski email xabari o'qilmagan bo'lsa — commit'dan oldin kutish? No — ikkala verify shart (code + confirm token eski email'da).
10. Commit'dan keyin: boshqa sessiyalar revoke (ixtiyoriy); audit email_changed.
11. **Xavfsizlik:** o'g'irlangan session email'ni o'zgartirib lockout qilolmaydi (reauth + ikkala verify).
12. A11y: flow keyboard; 44px; banner.
13. Mobile: bir xil.
14. 4 til: email change stringlar.
15. Security/data guard: reauth shart; ikkala verify; email PII; audit.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: reauth; ikkala verify; commit; revoke.
19. Integration/contract test: request→verify ikkala→commit; eski email xabari; lockout qarshi.
20. E2E/security test: session o'g'irlangan holda blok; IDOR; brute-force.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-24 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: reauth bo'lmasa yoki bitta verify bo'lsa.
25. Done condition: email change to'liq, testlar yashil.
26. B-25 uchun: session invalidation'ga tayyor.
27. Eski email'ga token — short-lived (15 daqiqa).
28. Email change'da HEMIS/google_sub bog'liqlik tekshiriladi.
29. Barcha write path CSRF + audit bilan.
```

## B-25 — Session invalidation edge cases (massive)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini (session) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session invalidation'ning barcha edge case'larini qurish.
05. Precondition: A-25 session yashil; B-24 email change yashil.
06. Invalidation triggerlari (har biri — sessiyalar revoke + audit):
   - Password change → barcha boshqa sessiyalar revoke (A-29).
   - Email change → barcha boshqa sessiyalar revoke (B-24).
   - MFA enable/disable → barcha sessiyalar revoke (A-26).
   - Passkey revoke → barcha sessiyalar revoke (A-27).
   - Role change (teacher approved/rejected) → sessiya regenerate (A-19/B-15).
   - Admin revoke user → barcha sessiyalar (C-23).
   - Reset password → barcha (A-06).
   - Breach detected → sessiyalar revoke + forced reset (A-29).
07. `session-store.js` revokeByUser(userId, { exceptSessionId }) — Redis + revokedAt.
08. **Multi-device test:** 2 brauzer → bitta o'zgarish → ikkinchisi 401.
09. **Replay test:** logout qilingan session token'ni qayta yuborish → 401.
10. **Concurrent invalidation:** parallel o'zgarishlar — idempotent.
11. Renewal (A-25): mid-session ID rotate; eski ID qisqa safety interval.
12. Audit: sessions_revoked (trigger).
13. A11y: revoke'dan keyin login sahifasiga yumshoq redirect (returnUrl).
14. Mobile: bir xil.
15. Security/data guard: revoke server-side; hech qachon client cookie'ga ishonmaydi.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: har trigger; except; idempotent.
19. Integration/contract test: 2-brauzer; replay; concurrent.
20. E2E/security test: revoke'dan keyin eski session ishlamaydi.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga B-25 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: bironta trigger revoke qilmasa.
25. Done condition: invalidation to'liq, testlar yashil.
26. B-26 uchun: B-faza checkpoint'ga tayyor.
27. exceptSessionId — joriy sessiya saqlanadi.
28. Redis revoke atomic.
29. Barcha write path CSRF + audit bilan.
```

## B-26 — B-Faza checkpoint sign-off (Register+Onboarding+Email)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b, 4, 5b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: B-faza (Register/Onboarding/Email) mustaqil sertifikatlash.
05. Precondition: B-00..B-25 yashil bo'lishi kerak.
06. CHECKPOINT audit:
07. Register: email majburiy+unique+verify; honeypot+Turnstile; disposable blok; duplicate handling; ≤5 maydon.
08. Google register: rol modal; invite; verified; escalation yo'q.
09. Invite: 1 marta; revoke; expiry; enrollment transaction.
10. Teacher approval: state machine; 72s window; justification; eskalatsiya; limited mode blok; cooldown.
11. Onboarding: Orient→first-win (ACTIVATION EVENT)→checklist; TTFV <5 daqiqa; welcome sequence idempotent.
12. Email: SPF/DKIM/DMARC; transactional alohida; bounce suppress; 8 template 4 til; push/Telegram.
13. Email change: reauth; ikkala verify; notification.
14. Session invalidation: barcha triggerlar.
15. Enumeration/brute-force/fixation/CSRF/cookie/open-redirect testlari yashil.
16. Secret scan: provider key'lar KMS; parol/token/OTP log'da yo'q (grep).
17. A11y: axe 0 critical; keyboard journey (register→verify→approve→onboarding).
18. Mobile: 44px, autofill, OTP.
19. Security/data guard: bironta critical finding yashirilmasin.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
22. Unit test: full B suite.
23. Integration/contract test: register→verify→login→approve→onboarding journey.
24. E2E/security test: barcha security testlar.
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. `implementation-status-auth.md`ga B-26 (CHECKPOINT) statusi yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: critical/high blocker qolsa.
29. Done condition: B-faza to'liq; C-faza ochiladi.
30. Operator review va sign-off; residual risk.
```

## B-27 — Register security detail (password field hardening)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 1-bo'limini (NIST SP 800-63B-4) to'liq o'qi; parol qoidalarini qog'ozga yoz.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register parol field'ini xavfsizlik nuqtai nazaridan mustahkamlash (NIST talablari bo'yicha).
05. Precondition: B-03 yashil bo'lishi kerak; `views/user/register.ejs` parol inputi mavjud.
06. `autocomplete="new-password"` — majburiy; browser bu inputni yangi parol deb tanishtirsin (eski parol autofill bo'lmasin).
07. Show/hide toggle (NIST tavsiyasi) + `aria-pressed` holat; input type password/text orasida almashish.
08. Paste ruxsat (NIST SHALL): clipboard'dan parol qo'yish bloklanmaydi — brauzer native.
09. zxcvbn indikator (B-03): jonli kuch bali; talaba uchun >=3, admin/teacher uchun >=4 talab.
10. HIBP async check (A-22): breach'dagi parol yozilishi bilan inline xato ko'rsat; server-da qayta tekshir (yagona manba).
11. Caps Lock warning (E-07): parol katta harflar bilan kiritilganda ogohlantirish (istalgancha, faqat informativ).
12. Unicode va space qabul (NIST): kiritilgan barcha belgilar saqlansin, hech qanday strip/trim parolga tegmasin.
13. Parol max 128 belgi (NIST SHALL): 128 dan uzunini server rad etadi, truncate YO'Q — client va server bir xil limit.
14. Parol hech qachon JS o'zgaruvchisida qolmaydi (input blur/clear) va network trace'da ham.
15. NIST SHALL NOT: composition qoidasi yo'q (katta+kichik+raqam majburiy EMAS), periodic rotation yo'q, security question yo'q.
16. Min uzunlik: MFA bo'lsa 8, bo'lmasa 15 (NIST 63B-4) — config orqali; registration'da hozircha 12-15.
17. Input `id`/`name="password"` standart — password manager uygunlashuvi (autocomplete bilan birga).
18. Server validatsiya (Zod): min/max, Unicode, rejim; client faqat UX, server yagona truth.
19. Security/data guard: parol log, error, Sentry, network trace'da bo'lmasin; console.log'da ham taqiqlangan.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (password_set, password_breach_block).
22. Unit test: autocomplete attr; HIBP block; zxcvbn score; Unicode+space; 128 limit; truncate yo'q.
23. Integration/contract test: breach'dagi parol register'da rad; legacy parol hash bilan solishtirish.
24. E2E/security test: XSS parol inputda; parol DOM'da qolmaydi; paste ishlaydi; password manager flow.
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. A11y (WCAG 2.2 AA): toggle focus'da, aria-pressed, screen reader label; kontrast.
27. i18n: zxcvbn xabarlari va xato matnlari 4 tilda; xato ko'rsatish inline.
28. Failure state: HIBP offline bo'lsa yumshoq o'tish (blok emas) — `hibp_offline` metric.
29. Metrics: password_strength_distribution, breach_blocked_count, show_toggle_usage.
30. `implementation-status-auth.md`ga B-27 statusi va next readinessni yoz.
31. Global report formatida changed files, migration, command va test natijalarini qaytar.
32. Stop condition: parol JS'da qolsa yoki server limit clientdan farq qilsa.
33. Done condition: parol field to'liq NIST uygun, testlar yashil, metriclar qo'shilgan.
34. B-28 uchun: email verification detail'ga tayyor ekanini dalil bilan yoz.
```

## B-28 — Email verification detail (typo, resend, cooldown)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini va `research_auth_deep.md` 7-bo'limini (email validation) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email verification UX detail — typo suggestion, resend cooldown, expiry UX, autofill.
05. Precondition: B-05/06/07 yashil bo'lishi kerak; verify send/check endpointlari ishlayapti.
06. Typo suggestion (B-05): gmial→gmail, hotmial→hotmail — inline "demoqchimisiz? [Ha]" ; faqat taniqli domain xatolari.
07. Resend cooldown: 60 soniya timer ko'rinadi (B-06); server 3/soat limit qat'iy; cooldown'da tugma disabled.
08. Expiry UX: kod muddati o'tgan bo'lsa — "Kod muddati o'tgan — [Yangi kod yuborish]" (email prefilled, qayta yozish shart emas).
09. Email change during verify: noto'g'ri email kiritilgan bo'lsa — "Emailni yangilash" havolasi (B-24 flow'ga yo'naltiradi).
10. Limited mode banner (B-07): resend limitiga yetilganda — "Keyinroq urinib ko'ring (HH:MM)", banner takrorlanmaydi.
11. OTP autofill: input `autocomplete="one-time-code"`; iOS/Android SMS autofill qo'llab-quvvatlansin (D-13 bilan).
12. OTP input UX: 6 raqamli, faqat raqam, paste ishlaydi, kiritishda avtomatik keyingi field (agar alohida field bo'lsa).
13. Kodni tekshirishda jitter: xato kodda kichik random delay (100-300ms) — brute force sekinlashadi (C-01 bilan).
14. Verify check server qoidalari: kod hash'da saqlanadi (plaintext emas), bir martalik, 15 daqiqa expiry (A-20 qoidalari).
15. Resend oldingi kodni bekor qiladi (yangi kod = eski kod o'chadi) — replay yo'q.
16. Security/data guard: kod log'ga yozilmaydi; email preview'da kod yashirin emas (u ko'rsatiladi), lekin audit'da yo'q.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (verify_resend, verify_expired, verify_typo_shown).
19. Unit test: typo suggestion mapping; cooldown timer; expiry UX; autofill attr; 6-raqam validatsiya.
20. Integration/contract test: resend 4-chi urinish rad; eski kod bekor; limit header/error code.
21. E2E/security test: autofill flow; XSS kod inputida; brute-force jitter; limited mode banner.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. A11y: timer live region (screen reader), fokus tartibi, kontrast, `aria-live`.
24. i18n: barcha xabar/timer matnlari 4 tilda; text uzunligiga layout mos.
25. Failure state: email yuborish xatosi — retry button + support contact; blok emas.
26. Metrics: verify_success_rate, verify_typo_accept_rate, resend_usage, expired_count.
27. `implementation-status-auth.md`ga B-28 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: resend limitsiz bo'lsa yoki kod plaintext saqlansa.
30. Done condition: verify detail to'liq, testlar yashil, metriclar qo'shilgan.
31. B-29 uchun: teacher approval detail'ga tayyor ekanini dalil bilan yoz.
```

## B-29 — Teacher approval detail (application form, review queue)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.2-bo'limini va `research_auth_deep.md` 10-bo'limini (Entra PIM pattern) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher approval detail — application form, review queue, notification, history, re-apply.
05. Precondition: B-14/15/16 yashil bo'lishi kerak; state machine va admin approve/reject ishlayapti.
06. Application form (register'da): universitet, fan, tajriba yillari, sabab (ixtiyoriy, 500 belgi) — `teacher_applications` jadvali.
07. Form validatsiya: universitet ro'yxatdan (ochiq data, A-13), fan tekst 100 belgi, tajriba 0-50 yil — Zod schema.
08. Review queue (admin): pending birinchi, sort (sana desc), badge "yangi"; status filter (pending/approved/rejected).
09. Reviewer assign: default bitta admin; pool (P2) — assign log; takroriy approve'da xato.
10. Approver o'z arizasini tasdiqlay olmaydi (Entra PIM qoidasi) — admin o'zi teacher bo'lsa blok.
11. Notification: admin'ga yangi ariza (B-15) — email/push/Telegram; reminder 24/48 soat (B-16 SLA).
12. Application history: user'da status, sabab, vaqt ko'rinadi; rejected sababini admin yozadi (majburiy).
13. Re-apply: rejected bo'lsa cooldown (7 kun) dan keyin yangi ariza; eski ariza arxivlanadi (history'da qoladi).
14. Duplicate application: pending/approved mavjud bo'lsa yangi yaratilmaydi — "Arizangiz ko'rib chiqilmoqda".
15. Security/data guard: application PII minimal (universitet+fan+tajriba); faqat admin ko'radi; tenant scope.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir (IDOR test majburiy).
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (application_created, application_approved, application_rejected).
18. Unit test: form validatsiya; duplicate; re-apply cooldown; own-approval blok.
19. Integration/contract test: review queue sort/filter; notification; history API.
20. E2E/security test: IDOR (boshqa user arizasini ko'rish blok); privilege escalation; tenant leak.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. A11y: form label/error inline; queue keyboard bilan navigatsiya; status color+text (rangga bog'liq emas).
23. i18n: forma va admin UI 4 tilda; sabab maydoni uzunligi ko'rsatiladi.
24. Failure state: notification yuborilmasa — ariza baribir saqlanadi (queued retry B-31).
25. Metrics: approval_time_median, re_apply_rate, pending_older_than_24h.
26. `implementation-status-auth.md`ga B-29 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: queue bo'lmasa yoki own-approval blok bo'lmasa.
29. Done condition: teacher detail to'liq, testlar yashil, audit loglar qo'shilgan.
30. B-30 uchun: onboarding detail'ga tayyor ekanini dalil bilan yoz.
```

## B-30 — Onboarding detail (progress, returnUrl, skip)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini va `research_auth_deep.md` 14-bo'limini (UX/passkey onboarding) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: onboarding detail — progress stepper, returnUrl, skip, half-done re-entry, first-win.
05. Precondition: B-17/18/19 yashil bo'lishi kerak; state machine, Activate event, checklist bor.
06. Progress: stepper 3 bosqich (Profil → Xavfsizlik → Tayyor), sticky top, hozirgi bosqich ko'rsatiladi (B-17).
07. ReturnUrl: onboarding'dan keyin `/panel` yoki original return (A-05 allowlist bilan tekshiriladi; open redirect YO'Q).
08. Skip: har ixtiyoriy qadamda [Skip] (B-17) — majburiy qadamlar (email verify, parol) skip bo'lmaydi.
09. Skip effekti: skip qilgan qadam keyingi kirishda yana taklif qilinadi (nagging yumshoq), +10-15% activation (B-17 metrik).
10. Half-done: onboarding yarim qolsa — qayta kirishda davom (B-17); step monotonik (orqaga emas, oldinga).
11. First-win re-entry: onboarding tugatilgan bo'lsa — boshqa ko'rsatilmaydi (takroriy emas); faqat profil to'ldirish taklifi.
12. Checklist persistence: har item done saqlanadi (B-19) — refresh'da yo'qolmaydi; Redis cache emas, DB.
13. Welcome idempotency: Day 0/1/3/7 email/push har biri bir marta (B-19) — takroriy welcome YO'Q.
14. Skip/return saqlash: `onboarding_progress` (user_id, step, items_done[], skipped[]) — audit bilan.
15. Security/data guard: state user-scoped (tenant); monotonic update faqat server; IDOR yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (onboarding_step, onboarding_skip, onboarding_complete).
18. Unit test: returnUrl allowlist; skip; half-done; monotonic step; checklist persistence.
19. Integration/contract test: re-entry flow; welcome idempotency; first-win re-entry.
20. E2E/security test: IDOR (boshqa user progress); open redirect; monotonic bypass.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. A11y: stepper aria-current, keyboard navigatsiya, focus management, live region status.
23. i18n: stepper, skip, checklist matnlari 4 tilda; uzun matnlarga layout.
24. Failure state: state yozilmasa — retry yumshoq, blok emas; offline'da checkboxlar local saqlanmaydi.
25. Metrics: onboarding_completion_rate, skip_rate_per_step, half_done_return_rate, welcome_delivered.
26. `implementation-status-auth.md`ga B-30 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: monotonic bo'lmasa yoki open redirect ochiq bo'lsa.
29. Done condition: onboarding detail to'liq, testlar yashil, metriclar qo'shilgan.
30. B-31 uchun: email infra detail'ga tayyor ekanini dalil bilan yoz.
```

## B-31 — Email infra detail (queue, retry, dead-letter)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini (Google/Yahoo/Postmark/SES) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email infra detail — queue, retry, dead-letter, priority, webhook, rate throttle.
05. Precondition: A-23 (email foundation) va B-20 (templates) yashil bo'lishi kerak.
06. Email queue (BullMQ/Redis): job = (template_id, to_hash, data, priority, idempotency_key) — ziddiyatsiz.
07. Priority: urgent (reset, verify, security) birinchi; normal (welcome, re-engagement) keyin (E-22 bilan).
08. Retry: 3 marta — backoff 1m/5m/15m; faqat transient error (timeout, 5xx, throttle) uchun.
09. Dead-letter: 3 marta fail → DLQ (ops review); DLQ'dagi job monitor qilinadi (alert).
10. Rate limit yuborish: per-provider (Postmark 100/s, SES quota) — queue throttle; burst qarshi.
11. Webhook: delivery/bounce/complaint → `email_log` update (A-23) — bounce'da email suppress, complaint'da darhol to'xtatish.
12. Idempotency: bir xil `idempotency_key` ikki marta yuborilmaydi (Redis SETNX) — retry takroriy yubormaydi.
13. PII xavfsizligi: queue job'ida `to_hash` (email hash), `data` minimal; queue redisga PII to'liq yozilmaydi.
14. Bounce handling: permanent (550) → email invalid, suppress list; transient → retry (B-05 bilan birga).
15. Audit: email_queued, email_sent, email_retried, email_deadletter, email_bounced, email_complained.
16. Security/data guard: queue'da OTP/parol YO'Q; template render server-side, ma'lumotlarni preview'da ko'rsatishda ehtiyot.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: queue enqueue; retry backoff; DLQ; priority order; idempotency.
20. Integration/contract test: webhook delivery/bounce/complaint; throttle; suppress list.
21. E2E/security test: PII queue'da yo'q; retry takroriy emas; bounce loop yo'q (max retry).
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. Observability: email_* metrics, queue depth gauge, DLQ size alert (D-06 bilan).
24. Failure state: queue worker down — job'lar Redis'da qoladi, restart'da davom; xabar yo'qolmaydi.
25. Metrics: email_sent_total, email_bounce_rate, email_complaint_rate, dlq_depth, retry_count_dist.
26. `implementation-status-auth.md`ga B-31 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: DLQ bo'lmasa yoki idempotency bo'lmasa.
29. Done condition: email infra to'liq, testlar yashil, webhooklar ishlaydi.
30. B-32 uchun: notification detail'ga tayyor ekanini dalil bilan yoz.
```

## B-32 — Notification detail (dedupe, quiet hours, template per event)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5b-bo'limini va `research_auth_deep.md` 5-bo'limini (email) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: notification detail — dedupe, quiet hours, per-event template, segment, chastota cap.
05. Precondition: B-21/22/23 yashil bo'lishi kerak; preferences, Telegram, push ishlayapti.
06. Dedupe: bir hodisa bir marta (24 soat ichida) — Redis SETNX + key (user_id:event:day); takroriy YO'Q.
07. Quiet hours: 22:00-08:00 (default, user sozlashi mumkin) — marketing/push kechiktiriladi; security xabarlari (parol o'zgarishi) DARHOL yuboriladi.
08. Per-event template: assignment_new, deadline, result, feedback, practice, security (B-20) — har event o'z template'i, 3 kanal (email/Telegram/push).
09. Segment: consistent (kam xabar), sporadic (o'rtacha), lapsed (qiymat xabarlari) (B-21) — segmentga mos chastota.
10. Chastota cap: kuniga ≤2-3 marketing xabar; security xabarlari cap'ga kirmaydi (B-21).
11. Security events majburiy: parol o'zgarishi, yangi device, MFA o'zgarishi — user o'chira olmaydi (B-21).
12. Kanal tanlovi: preferences'ga ko'ra (B-21) — email default, Telegram/push ixtiyoriy; majburiy security → barcha kanal.
13. Preview xavfsizligi: notification preview'da OTP/parol/answer YO'Q; faqat "Xavfsizlik kodi yuborildi" (C-01 email).
14. Audit: notif_sent (event, channel, ts), notif_dedupe, notif_quiet_delayed.
15. Security/data guard: PII minimal; tenant scope; notification contenti untrusted input'da sanitize.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: dedupe; quiet hours; per-event template render; cap.
19. Integration/contract test: segment logic; security bypass quiet; channel select.
20. E2E/security test: spam (cap) yo'q; preview sensitive yo'q; dedupe bypass yo'q.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. A11y: email/push kontrast va text; push notification harakat emas (motion reducers).
23. i18n: 4 tilda template; sanalar locale bo'yicha; uzun matn truncate.
24. Failure state: kanal xatosi — boshqa kanalga fallback (email muvaffaqiyatsiz → push), hech bo'lmasa security xabari.
25. Metrics: notif_delivered_by_channel, dedupe_rate, quiet_delay_count, cap_enforced_count.
26. `implementation-status-auth.md`ga B-32 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: dedupe bo'lmasa yoki security xabari o'chiriladigan bo'lsa.
29. Done condition: notification detail to'liq, testlar yashil, metriclar qo'shilgan.
30. B-33 uchun: B-faza final release'ga tayyor ekanini dalil bilan yoz.
```

## B-33 — Register/Onboarding/Email FINAL (B-faza release)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b, 4, 5b-bo'limlarini va `research_auth_deep.md` 3,5,10-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: B-faza (Register/Onboarding/Email) release — to'liq regression, security sign-off, product sign-off.
05. Precondition: B-00..B-32 yashil; barcha testlar o'tgan; ledger to'liq.
06. B-faza checklist: register forma, username, email validatsiya, verify send/check, honeypot+Turnstile, duplicate, Google register, invite, teacher approval (form+queue+SLA), onboarding (state+activate+reinforce), email templates (8x4), notif prefs, Telegram, push, email change, session invalidation — hammasi yashil.
07. Full regression (B): `npm test` to'liq; regression bo'lsa critical sabab bilan tuzat (fix + test).
08. Security regression: enumeration (A-04), honeypot (B-08), disposable (B-05), teacher escalation (B-16), email injection (B-20), verify brute-force (B-28), IDOR (B-29).
09. A11y regression: axe 0 critical, keyboard bilan to'liq auth journey, contrast, focus.
10. i18n regression: 4 til barcha yangi ekranlar; RTL emas (LTR), lekin uzun matnlar sig'ishi.
11. Performance: register/login response p95 < 500ms; email queue yuk ostida (B-31 throttle).
12. Sign-off: security (XSS/IDOR/injection topilmasin), product (flow UX to'liq), operator (manual checklist).
13. Security/data guard: critical yashirilmaydi; P2/P3 (passkey, OneID, HEMIS OAuth) bu release'da yo'q (A-17 qoida).
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: full B suite (barcha modul).
17. Integration/contract test: full journey (register→verify→login→onboarding→teacher approve).
18. E2E/security test: full B E2E suite + security scenarios.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga B-33 (RELEASE) statusi, dalillar, sign-off va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: critical security topilsa yoki sign-off olinmasa — RELEASE yo'q.
23. Done condition: B-faza release checklist to'liq, barcha testlar yashil, sign-off imzolangan.
24. Qolgan P2/P3 ro'yxati (passkey, risk, Telegram deep, OneID) — C/D/E fazalarga ko'chirilganini yoz.
25. Release snapshot: commit hash, test soni — C-faza preflight uchun baseline saqlanadi.
26. Rollback rejasi: B-faza o'zgarishlari uchun migration/feature bo'yicha orqaga qaytarish yo'li yoziladi.
27. Butun PROMPT_GUIDE_AUTH_B release'ga tayyor ekanini dalil bilan yoz.
28. Operator tasdig'i bilan B-33 yopiladi — C-00 preflight'ga tayyorligi tasdiqlanadi.
```

## B-34 — Register security extra: bot fingerprint, velocity signup

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini (email/bot) va 14-bo'limini (risk-based) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register bot himoya extra — device fingerprint, signup velocity, domain reputation, review queue.
05. Precondition: B-08 yashil bo'lishi kerak; honeypot+Turnstile ishlayapti; C-01/06 ready.
06. Signup velocity: bir IP/device ko'p account (10/soat) → blok (C-01/06) — qoidalar C-01 config'dan olinadi.
07. Velocity tekshiruvi: register'da IP + fingerprint hash bo'yicha INCR (Redis); limitdan oshsa 429 + Turnstile qattiq.
08. Device fingerprint signup'da (C-03): yangi device'da Turnstile qattiq; tanish device'da yumshoq — fingerprint faqat hash, PII emas.
09. Email domain reputation: tashqi IP/domain tekshirish — yangi/baland-risk domain (B-05) → qo'shimcha tekshiruv yoki review.
10. Review queue: suspicious signup (velocity/fingerprint/domain) → `signup_reviews` admin queue (B-08) — manual verify.
11. Review item: user_id, sabab (velocity|fingerprint|domain), score, ip_hash, vaqt — admin approve/reject.
12. Rate limit xususiyatlari: per-IP + per-fingerprint + per-ASN (C-01); kampus NAT uchun yumshoq per-IP.
13. Anti-bypass: X-Forwarded-For spoof qarshi trust proxy (C-01); fingerprint yangilanishi (C-18) bilan bypass emas.
14. Security/data guard: per-IP/device; no bypass; fingerprint hash'da saqlanadi, raw ma'lumot UZ'da, DSAR (D-23).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (signup_velocity_block, signup_review_created, signup_review_resolved).
17. Unit test: velocity; fingerprint hash; domain reputation; review queue logic.
18. Integration/contract test: review approve/reject; bypass (spoofed header); kampus NAT false-positive.
19. E2E/security test: bypass emas (proxy/VPN); bot emulation; review flow UX.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. A11y: review queue admin keyboard; status color+text; no captcha-only blok (yordam).
22. i18n: review sabablari 4 tilda; user xabari 4 tilda.
23. Failure state: Redis down — velocity yumshoq (blok emas), Turnstile qattiq qoladi (B-08).
24. Metrics: signup_velocity_block_count, review_queue_depth, review_resolve_time, false_positive_rate.
25. `implementation-status-auth.md`ga B-34 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: velocity bo'lmasa yoki bypass ochiq bo'lsa.
28. Done condition: bot extra to'liq, testlar yashil, false-positive nazoratda.
29. B-35 uchun: email extra'ga tayyor ekanini dalil bilan yoz.
```

## B-35 — Email extra: welcome journey, re-engagement

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5b-bo'limini va `research_auth_deep.md` 5-bo'limini (email best practices) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: welcome journey (Day 0/1/3) va re-engagement (7/14 kun) email'larini qurish.
05. Precondition: B-19/20 yashil bo'lishi kerak; onboarding activate, checklist, templates bor.
06. Welcome Day 0: welcome + birinchi action (profil, birinchi test) — onboarding activate'da trigger (B-19).
07. Welcome Day 1: natija/stat — birinchi faollikdan keyin; no-activation bo'lsa rag'bat (B-19).
08. Welcome Day 3: 3 tip taklif (test, guruh, o'qituvchi) — segmentga mos (B-19/B-32).
09. Re-engagement 7 kun: harakatsiz — yumshoq qiymat xabari (natija, yangi material) — cap ichida (B-32).
10. Re-engagement 14 kun: reja taklifi — qaytish incentive; 30 kunda final (agar policy bo'lsa).
11. Segment: consistent (kam xabar), lapsed (qiymat) (B-32) — segment logikasi qayta ishlatiladi.
12. Template: welcome_day0, welcome_day1, welcome_day3, re_engage_7, re_engage_14 (B-20) — 4 tilda.
13. Trigger mexaizmi: cron/job (D-05/06) kunlik — user timezone (Asia/Tashkent) bo'yicha yuborish vaqti.
14. Opt-out: bildirishnoma sozlamalar (B-21) — marketing to'liq o'chirish; security majburiy qoladi.
15. Suppress: bounce/complaint'dagi email (A-23/B-31) welcome'ga kirmaydi; inactive+suppress to'xtaydi.
16. Security/data guard: preview sensitive YO'Q; chastota cap (B-32); PII minimal; tenant scope.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (welcome_sent, reengage_sent, reengage_opted_out).
19. Unit test: journey trigger; segment; template render; timezone.
20. Integration/contract test: re-engagement 7/14; opt-out; suppress.
21. E2E/security test: spam (cap) yo'q; opt-out ishlaydi; preview sensitive yo'q.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. A11y: email HTML accessible (alt text, kontrast, font); plain-text variant majburiy.
24. i18n: 4 til; sarlavha uzunligi (mobile); locale sanalar.
25. Failure state: job fail — keyingi kuni retry (B-31 queue); takroriy welcome YO'Q (idempotency B-19).
26. Metrics: welcome_open_rate, welcome_ctr, reengage_return_rate, opt_out_rate.
27. `implementation-status-auth.md`ga B-35 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: opt-out bo'lmasa yoki idempotency bo'lmasa.
30. Done condition: welcome journey to'liq, testlar yashil, metriclar qo'shilgan.
31. B-36 uchun: teacher extra'ga tayyor ekanini dalil bilan yoz.
```

## B-36 — Teacher extra: bulk invite, co-teacher, appeal

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.2-bo'limini va `research_auth_deep.md` 10-bo'limini (Entra PIM) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher extra — bulk invite, co-teacher, appeal, welcome.
05. Precondition: B-29 yashil bo'lishi kerak; teacher application/approval to'liq.
06. Bulk invite: roster'dan ko'p teacher (C-11 bilan) — Excel/CSV yuklash → batch invite (B-11) — har biri individual link.
07. Batch qoidalar: 100 ta/partiya; duplicate email skip; invalid skip + xato ro'yxat; progress UI; rollback (qisman muvaffaqiyat).
08. Invite quvvati: har invite 1 martalik, 7 kun expiry (B-11); revoked invite qayta yuborilmaydi.
09. Co-teacher (P2): teacher o'zi qo'shadi — invite + role `co_teacher`; asosiy teacher tasdiqlaydi; tenant/guruh scope.
10. Co-teacher chegarasi: guruhda ≤3 co-teacher; rol faqat o'z guruhida; asosiy teacher olib tashlay oladi.
11. Appeal: rejected teacher — support apellyatsiya (B-16) → yangi review; cooldown va hujjat talab qilinishi mumkin.
12. Appeal flow: user rejected sababini ko'radi (B-29), [Apellyatsiya] → sabab yozadi → admin queue (B-29 qayta ishlatiladi).
13. Teacher welcome: approval'da onboarding (B-19) — birinchi test yaratish CTA; email welcome_teacher (B-20).
14. Security/data guard: invite 1 martalik; role admin; co-teacher privilege escalation emas; tenant scope.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir (bulk'da har item).
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (bulk_invite_created, co_teacher_added, appeal_created, appeal_resolved).
17. Unit test: bulk parse; duplicate skip; co-teacher limit; appeal cooldown; invite single-use.
18. Integration/contract test: batch progress; invite revoke; co-teacher guruh scope.
19. E2E/security test: escalation (co-teacher admin emas); IDOR; bulk injection (Excel formula).
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. A11y: bulk upload progress (live region), xato ro'yxati; admin review keyboard.
22. i18n: bulk UI, appeal forma, welcome_teacher 4 tilda.
23. Failure state: bulk partial — muvaffaqiyatlilar saqlanadi, xatolar ro'yxati ko'rsatiladi (rollback qisman).
24. Metrics: bulk_invite_accept_rate, co_teacher_usage, appeal_resolve_time, appeal_success_rate.
25. `implementation-status-auth.md`ga B-36 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: escalation ochiq bo'lsa yoki invite multi-use bo'lsa.
28. Done condition: teacher extra to'liq, testlar yashil, audit to'liq.
29. B-37 uchun: B-faza ultimate qabulga tayyor ekanini dalil bilan yoz.
```

## B-37 — Register/Email ULTIMATE (B-faza yakuniy qabul)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b, 4, 5b-bo'limlarini va `research_auth_deep.md` 1,3,5,10-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: B-faza ultimate qabul — hamma B bosqichlari global gigant darajasida tasdiqlanadi.
05. Precondition: B-34..B-36 yashil; B-00..B-33 yashil; C-faza uchun ready.
06. B-faza ultimate checklist: register (forma, bot, velocity, duplicate), email (validatsiya, verify, welcome, re-engage, infra, deliverability), teacher (approval, bulk, co-teacher, appeal), onboarding (state, activate, reinforce, progress) — to'liq, global daraja.
07. Full regression (B): `npm test` to'liq; `npm run typecheck`; E2E suite.
08. Security sign-off: enumeration, XSS, IDOR, escalation, email injection, brute-force, bypass — nol critical.
09. Product sign-off: flow UX, i18n 4 til, a11y, mobile — operator checklist imzolaydi.
10. Deliverability sign-off: SPF/DKIM/DMARC (p=none→quarantine yo'lida), bounce<2%, complaint<0.1% (A-23/B-31 monitoring).
11. Performance sign-off: register/login p95 <500ms; queue yuk ostida barqaror (B-31).
12. Security/data guard: critical yashirilmaydi; PII minimal (UZ, DSAR); P2/P3 C/D/E fazaga.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: full B suite (barcha modul, 100% muhim path).
16. Integration/contract test: full journey (register→verify→teacher→onboarding→bulk).
17. E2E/security test: full B E2E + security scenarios.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga B-37 (ULTIMATE) statusi, dalillar, sign-off va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: critical security yoki sign-off olinsa — ULTIMATE yo'q.
22. Done condition: B-faza ultimate checklist to'liq, testlar yashil, sign-off imzolangan.
23. Ultimate snapshot: commit hash, test soni, metriclar (activation, deliverability) — C-faza uchun baseline.
24. Rollback rejasi: B-faza to'liq o'zgarishlari uchun — migration/feature bo'yicha orqaga qaytarish yo'li.
25. Operator yakuniy tasdig'i: B-faza yopiladi, C-00 ochiladi — yozma tasdiq talab qilinadi.
26. Butun PROMPT_GUIDE_AUTH_B yakunlandi — C-00 preflight'ga tayyor ekanini dalil bilan yoz.
27. B-faza yakuniy hisobot: bajarilgan 38 bosqich, testlar, sign-offlar — to'liq yoziladi.
28. B-faza rollback yo'li (migration, config, flag) operator tasdig'i bilan yopiladi.
```

