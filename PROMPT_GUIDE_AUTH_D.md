# Edikit Auth — D-Faza: Infra + Frontend + Test + Ops + Legal (D-00..D-85)

> **Maqsad:** Auth tizimining infratuzilmasi, frontend, test, ops va legal qatlamlari — to'liq professional.

---

## D-00 — Infra preflight va baseline

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Infra/Frontend/Test/Ops qismini qurishdan oldin inventarizatsiya va baseline yaratish (kod o'zgartirilmaydi).
05. Precondition: C-16 yashil bo'lishi kerak; C-faza sign-off imzolangan.
06. Kod yozishdan oldin `src/config/env.js`, `server.js`, `middleware/`, `public/js/`, `tests/`, `.github/workflows/` holatini tekshir.
07. Hozirgi config/env holatini inventarizatsiya qil: auth env'lar (SESSION_SECRET, GOOGLE_*, EMAIL_*, HEMIS_*, TOTP, PASSKEY) — qaysilari bor, qaysilari yo'q.
08. Test framework holati: vitest, supertest, playwright — o'rnatilganmi, konfiguratsiya bormi.
09. CI holati: GitHub Actions workflow bor/yo'q; qaysi testlar CI'da ishlaydi.
10. Frontend holati: login/register/MFA/passkey/settings sahifalari qaysi stack (EJS+JS), validation qanday.
11. Test holati o'lcha: `npm test`, `npm run typecheck` — baseline soni (A-faza bilan solishtir).
12. Security/data guard: secret logga chiqmasin; `.git/config`ga tegma; `git status` toza.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (mavjud bo'lsa).
15. Unit test: existing start command smoke test.
16. Integration/contract test: existing health/root route smoke test.
17. E2E/security test: workspace'da kutilmagan generated file yo'qligi.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-00 statusi, dalillar va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: baseline ishga tushmasa yoki dirty repo bo'lsa.
22. Done condition: baseline, blockerlar, test natijalari va D-01 readiness yozilgan.
23. D-01 uchun tavsiya: config/env schema to'liq — yoz.
24. Hech qanday kod o'zgartirmasdan yakunla; faqat hisobot bering.
25. Baseline snapshot (commit, test soni) saqlanadi — D-faza oxirida taqqoslanadi.
26. Infra/Frontend/Test/Ops fayllari ro'yxati jadvalini yoz.
27. D-01 boshlashga tayyor ekanini dalil bilan yoz.
28. Infra baseline'da mavjud observability (log, trace, metrics) holati yoziladi — D-04/05/06 uchun.
29. Frontend stack (EJS+JS) va test stack (vitest) qarorlari hujjatlashtiriladi.
30. D-00 hisoboti operator tasdig'i bilan yopiladi.
```

## D-01 — Config/env schema to'liq (auth)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth uchun to'liq config/env schema'ni qurish (Zod, fail-fast).
05. Precondition: D-00 yashil bo'lishi kerak.
06. `src/config/env.js` kengaytirish (Zod):
   - NODE_ENV, PORT, BASE_URL (domain allowlist uchun).
   - SESSION_SECRET (32B+), COOKIE_SECURE, COOKIE_SAMESITE.
   - REDIS_URL, DATABASE_URL.
   - GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI.
   - EMAIL_PROVIDER (postmark|ses), EMAIL_FROM, EMAIL_API_KEY, EMAIL_SENDING_DOMAIN.
   - SMTP_HOST/PORT (fallback).
   - TELEGRAM_BOT_TOKEN (P3).
   - HEMIS_CLIENT_ID/SECRET (agar), HEMIS_BASE_URL.
   - TURNSTILE_SITE_KEY/SECRET.
   - HIBP_API_URL.
   - VAPID_PUBLIC/PRIVATE (PWA push).
   - MFA_ISSUER, KMS_KEY_ARN (secret encrypt).
   - ADMIN_USER, ADMIN_PASS (CONFIG, non-default).
   - RATE_LIMIT_* config'lar.
07. Production validation: zarur env'lar yo'q bo'lsa startup fail (fail-fast, Prompt 02).
08. Default production credential'lar blok (admin/admin — start bo'lmaydi).
09. Secret redaction: hech qachon log'da (Pino redact).
10. `.env.example` yangilash (barcha auth env'lar).
11. Security/data guard: secret env'da, KMS'da (D-02); default yo'q.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: env schema; fail-fast; redaction.
15. Integration/contract test: production config invalid → start fail.
16. E2E/security test: secret log'da yo'q (grep).
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-auth.md`ga D-01 statusi va next readinessni yoz.
19. Global report formatida changed files, migration, command va test natijalarini qaytar.
20. Stop condition: default credential bo'lsa yoki env schema bo'lmasa.
21. Done condition: config to'liq, testlar yashil.
22. D-02 uchun: secrets KMS'ga tayyor.
23. Env'lar per-environment (dev/test/prod).
24. Redaction Pino'da.
```

## D-02 — Secrets management (KMS + vault)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (secret management, key rotation).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: secrets management'ni qurish — KMS encryption, env yedek, rotation, audit.
05. Precondition: D-01 yashil bo'lishi kerak; config/env schema to'liq.
06. `src/config/secrets.js`: KMS client (agar cloud) yoki local AES-256-GCM master key (env) — provider abstraction (D-32 pattern).
07. Encrypt qilinadigan: TOTP secret (A-26), HEMIS client_secret (C-10), OIDC refresh token (A-24), email API key, Telegram bot token.
08. `kms.js` service: encrypt/decrypt (AES-256-GCM, per-record IV), key version; qayta encrypt (re-encrypt) funksiyasi.
09. Rotation: key rotation rejasi (har 90 kun); decrypt eski key bilan, re-encrypt yangi — downtime yo'q (atomic).
10. Secret yedek: KMS managed (yoki encrypted copy, alohida muhitda) — yo'qolsa recovery.
11. Env'dagi secret'lar: `.env.example`'da placeholder (D-01), production'da KMS/reference — plaintext env YO'Q (prod).
12. Audit: secret_accessed, secret_rotated, secret_decrypt_failed (user_hash bilan, secret emas).
13. Security/data guard: secret hech qachon log/frontend/trace/error'da; master key KMS'da (env'da emas prod).
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: encrypt/decrypt round-trip; version; rotation re-encrypt; IV uniqueness.
17. Integration/contract test: TOTP secret decrypt (A-26); HEMIS secret (C-10); email key.
18. E2E/security test: master key log'da yo'q (grep); rotation'da data yo'qolmaydi; downgrade qarshi.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga D-02 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: secret plaintext bo'lsa yoki rotation bo'lmasa.
23. Done condition: secrets to'liq, testlar yashil, audit ishlaydi.
24. D-03 uchun: Redis to'liq'ga tayyor ekanini dalil bilan yoz.
25. Local dev: env master key (non-prod) — hujjatlashtiriladi.
26. Barcha write path audit bilan; key version migration rejasi yoziladi.
27. Secret inventarizatsiya jadvali: har secret — qayerda (env/KMS), kim ishlatadi, rotation davri.
28. KMS region: UZ'da (data law) — xususiy cloud yoki provider UZ region.
29. Secret test: haqiqiy secret'lar test muhitida ishlatilmaydi (fixture'larda dummy).
30. D-02 hisoboti operator tasdig'i bilan yopiladi.
```

## D-03 — Redis to'liq (session + cache + rate limit + risk)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Redis'ni auth uchun to'liq qo'llash — session, cache, rate limit, risk counters.
05. Precondition: D-02 yashil bo'lishi kerak.
06. Redis client (ioredis) — `src/config/redis.js`: connection pool, retry, health.
07. Session store (A-01): Redis TTL, revoke, list.
08. Rate limit (C-01): Redis INCR+EXPIRE (sliding window), per-IP/account/ASN.
09. Risk counters (C-05/06): velocity, impossible travel, stuffing — Redis TTL 15 daqiqa.
10. Cache: OTM stats (C-13), JWKS (A-24), email validation (B-05), geo (C-05).
11. Idempotency: attempt/answer, resend — Redis SETNX.
12. Key prefix: `auth:{userId}:{type}` — tenant scope.
13. Shutdown: drain/close (Prompt 03).
14. Health: Redis ping startup fail-fast.
15. Audit: redis_error (alert).
16. Security/data guard: session data PII minimal (ip_hash); secret Redis'da emas.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: session store; rate limit; risk counter; idempotency.
20. Integration/contract test: Redis restart (session qayta); concurrent.
21. E2E/security test: key leak; PII.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-03 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: session data yo'qolsa yoki secret Redis'da bo'lsa.
26. Done condition: Redis to'liq, testlar yashil.
27. D-04 uchun: logging'ga tayyor.
28. ioredis-mock test'da.
29. Key TTL har doim.
```

## D-04 — Logging (Pino) + redaction to'liq

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (logging, redaction, PII).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: structured logging (Pino) va redaction'ni to'liq qurish.
05. Precondition: D-03 yashil bo'lishi kerak; Redis foundation tayyor.
06. `src/config/logger.js` (Pino): structured JSON, request ID (D-05), redact list — central config.
07. Redact: password, token, code, otp, secret, client_secret, refresh_token, cookie, JSHSHIR, answer — hamma nested path.
08. `redactPaths` konfig: `req.headers.authorization`, `req.body.password`, `req.body.token`, `res.headers['set-cookie']` va h.k.
09. Log level: dev (debug), prod (info), security events (warn); rate-limit hit log'da.
10. Auth log'lar: login success/fail (user_id, method, outcome — parol YO'Q), lockout, teacher approve, MFA, passkey.
11. Hech qachon log'da: parol, token, OTP, answer key, essay, health data, biometric, refresh token (qoida 19).
12. Pino redaction test: grep parol/token log faylida yo'q — CI'da majburiy (D-14/18).
13. Aksess: loglar ops'ga, UZ'da saqlash (data law); retention (C-14).
14. Security/data guard: redaction fail-open emas (test qattiq); redact list config'da (central).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: redact nested path; level; malformed input (undefined/null).
18. Integration/contract test: login log'ida parol yo'q; lockout log'ida user_id bor.
19. E2E/security test: grep secret log'da; request ID trace (D-05 bilan); JSHSHIR yo'q.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-04 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: parol log'da bo'lsa (grep) — redaction ishlamaydi.
24. Done condition: logging + redaction to'liq, testlar yashil, grep toza.
25. D-05 uchun: request ID/trace'ga tayyor ekanini dalil bilan yoz.
26. Pino-pretty dev'da; redact list config'da (central) — hujjatlashtiriladi.
27. Log retention (C-14): auth log'lar 12 oy; log'lar UZ'da saqlanadi.
28. Log aksessi: ops guruhi; admin view log (C-09) alohida (PII emas).
29. Audit log vs app log farqi hujjatlashtiriladi (audit append-only, app log redacted).
30. D-04 hisoboti operator tasdig'i bilan yopiladi.
```

## D-05 — Request ID + trace (OTel)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (observability, tracing).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: request ID va OpenTelemetry trace'ni auth uchun qurish.
05. Precondition: D-04 yashil bo'lishi kerak; logging + redaction to'liq.
06. Middleware: har request'ga `x-request-id` (crypto.randomUUID) — response'da ham, log'da ham (D-04).
07. OTel SDK: `@opentelemetry/sdk-node` — trace provider, propagator (W3C traceparent), instrumentations.
08. Span'lar: auth.login, auth.register, auth.mfa, auth.reset, auth.hemis, rate-limit, risk — server-side (client emas).
09. Attribute'lar: user_id (hash), method, outcome, status_code (PII yo'q — parol/token/OTP emas).
10. Export: OTLP (self-hosted collector) — UZ'da (data law); prod'da sampler (masalan 10%) xarajat uchun.
11. Redaction: span attribute'larida secret yo'q (test, D-04 qoidasi) — trace exporter ham redact.
12. Error trace: har 4xx/5xx trace_id log'da — support ticket korrelyatsiyasi.
13. Audit: trace_id auth_audit'da saqlanadi (C-09 bilan) — incident'da trace topish.
14. Security/data guard: trace'da PII minimal; UZ'da saqlash; retention (C-14).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: request ID format; span attribute redact; middleware order.
18. Integration/contract test: login → span yaratildi; error trace_id log'da.
19. E2E/security test: trace'da parol/token yo'q (grep); trace_id audit bilan bog'langan.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-05 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: trace'da PII bo'lsa (grep fail).
24. Done condition: request ID + trace to'liq, testlar yashil, trace_id audit'da.
25. D-06 uchun: metrics/observability'ga tayyor ekanini dalil bilan yoz.
26. OTel UZ'da (self-hosted); trace_id auth_audit'da — hujjatlashtiriladi.
27. Trace retention: 30 kun (xarajat); span count limit; sample rate config.
28. Trace'da tenant_id atributi qo'shiladi (tenant scope debug uchun).
29. D-05 hisoboti operator tasdig'i bilan yopiladi.
```

## D-06 — Observability: metrics + SLO + alerts (auth)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth metrics, SLO va alert'larini qurish.
05. Precondition: D-05 yashil bo'lishi kerak.
06. Metrics (Prometheus format):
   - auth_login_total{method,outcome}, auth_login_duration_histogram.
   - auth_register_total, auth_verify_total.
   - auth_lockout_total, auth_risk_block_total, auth_rate_limit_hit_total.
   - auth_mfa_enabled_total, auth_passkey_total.
   - auth_email_delivery_total{status}, auth_email_delivery_duration.
   - auth_teacher_approval_total{outcome}.
07. SLO'lar:
   - Login success rate: >90% (2 hafta).
   - Login latency p95: <2s.
   - Email deliverability: >90% inbox.
   - Availability: 99.9%.
08. Alert'lar (burn-rate): fail spike, lockout spike, email bounce >5%, risk block spike, rate-limit abuse.
09. Runbook link'li alert annotations.
10. Dashboard (Grafana): auth overview.
11. Audit: metric_alert (ops).
12. Security/data guard: metric'da PII yo'q (outcome/count only); UZ'da.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: metric format; histogram.
16. Integration/contract test: login → metric; alert threshold.
17. E2E/security test: metric'da PII yo'q (grep).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-06 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: SLO bo'lmasa yoki metric'da PII bo'lsa.
22. Done condition: observability to'liq, testlar yashil.
23. D-07 uchun: frontend'ga tayyor.
24. Prometheus/Grafana self-hosted UZ'da.
25. Alert via Telegram/email.
```

## D-07 — Login/Register frontend to'liq (JS + UX)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1, 1b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: login/register frontend'ini to'liq professional qilish — JS modul, UX, error handling, loading/empty states.
05. Precondition: A-04, B-03 yashil bo'lishi kerak.
06. `public/js/auth.js` refactor (modular): form handling, inline error render, show/hide, lockout countdown, autofill, CSRF header.
07. `public/js/register.js`: rol UX, email live check (debounce 300ms), parol zxcvbn indikator, invite toggle, honeypot.
08. Error handling: har error → inline + yechim (14 holat); server error → yumshoq.
09. Loading states: submit'da button "Yuborilmoqda..." + disable; retry.
10. Empty states: hech qachon bo'sh emas (trust, yordam link).
11. Client validation: Zod (register schema) — server double.
12. A11y: skip link, fokus, aria-live, 44px, contrast.
13. Mobile: bosh barmoq zonasi, autofill, secure keyboard, 375px test.
14. i18n: 4 til stringlar (auth.js strings).
15. Performance: bundle <50KB, defer, lazy (register.js faqat register sahifada).
16. Security/data guard: hech qanday credential inline JS; CSRF; XSS (escape).
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: form logic; error render; debounce.
20. Integration/contract test: submit→server; error→inline.
21. E2E/security test: mobil; XSS; honeypot; autofill.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-07 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: XSS yoki bundle katta bo'lsa.
26. Done condition: frontend to'liq, testlar yashil.
27. D-08 uchun: MFA/passkey frontend'ga tayyor.
28. i18n central (data/auth-i18n.js).
29. Barcha write path CSRF + audit bilan.
```

## D-08 — MFA/Passkey frontend (QR, backup codes, conditional UI)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10, 12-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MFA/passkey frontend'ini to'liq qurish — QR, backup codes, conditional+modal, settings.
05. Precondition: A-26, A-27 yashil bo'lishi kerak.
06. `views/user/mfa.ejs`: MFA holati, [Yoqish] → QR (otpauth) + manual key; enable faqat birinchi kod'dan keyin.
07. Backup codes: 10 ta — faqat bir marta ko'rsatiladi; [Download] [Print]; "Men saqladim" checkbox majburiy.
08. Login MFA step: 6 kod input (single-digit, OTP autofill), resend, "boshqa usul" (backup code toggle), rate limit xabar.
09. Passkey: Conditional UI (page load, autocomplete="username webauthn") + modal button; feature detection.
10. Settings: registered passkeys ro'yxati (device, last_used), [O'chirish] (reauth), [Yangi qo'shish].
11. Recovery UX: MFA yo'qolsa — "Recovery kod" yoki "Support" (time-delay) flow.
12. `public/js/mfa.js`, `public/js/passkey.js` (simplewebauthn).
13. A11y: QR alt; kod input keyboard; 44px; live-region.
14. Mobile: biometric prompt; QR skan.
15. i18n: 4 til.
16. Security/data guard: secret/backup codes hech qachon JS'da qolmaydi (faqat response'da bir marta); XSS.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: QR render; backup codes UX; conditional init.
20. Integration/contract test: enable→login; passkey conditional+modal.
21. E2E/security test: backup codes replay; XSS; IDOR.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-08 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: backup codes repeat yoki secret JS'da bo'lsa.
26. Done condition: MFA/passkey frontend to'liq, testlar yashil.
27. D-09 uchun: settings frontend'ga tayyor.
28. QR: qrcode lib (SVG).
29. simplewebauthn browser.
```

## D-09 — Settings frontend (profil, security, privacy)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3, 5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: settings frontend'ini to'liq qurish — profil, security, privacy, notifications.
05. Precondition: A-08, B-21, D-08 yashil bo'lishi kerak; session UI, prefs, MFA/passkey UI tayyor.
06. `views/user/settings.ejs`: section'lar (accordion) — Profil / Xavfsizlik / Maxfiylik / Bildirishnomalar.
07. Profil: ism, avatar (initials fallback), til, tema; save → PATCH /api/settings/profile (Zod, reauth emas — low-risk).
08. Security: parol o'zgartirish (reauth + joriy parol, A-29), sessiyalar ro'yxati (A-08), MFA (D-08), passkey (D-08), 2FA holati.
09. Privacy: "Ma'lumotlarim" (nima saqlanadi, D-24), eksport (CSV/JSON, D-23), account o'chirish (D-23 DSAR), consent boshqaruvi (D-25).
10. Notifications: Telegram/email/push toggle + hodisa toggle (B-21) — quiet hours (B-32).
11. `public/js/settings.js`: accordion, toggle, save state, optimistic UI (rollback xatoda).
12. A11y: toggle label+aria-pressed; keyboard navigatsiya; 44px target; focus management accordion.
13. Mobile: accordion responsive; touch; i18n (D-11).
14. i18n: 4 til — barcha section, xato matnlari (D-11 bilan).
15. Security/data guard: DSAR to'g'ri; eksport user-scoped; IDOR; reauth sensitive (parol, MFA, delete).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (settings_saved, settings_exported, settings_deleted).
18. Unit test: section nav; toggle; save; optimistic rollback.
19. Integration/contract test: settings save; DSAR flow; reauth sensitive.
20. E2E/security test: IDOR (boshqa user settings); XSS; DSAR delete flow; reauth bypass.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga D-09 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: DSAR/auth buzilgan bo'lsa yoki IDOR ochiq bo'lsa.
25. Done condition: settings to'liq, testlar yashil, a11y/i18n tekshirilgan.
26. D-10 uchun: admin frontend'ga tayyor ekanini dalil bilan yoz.
27. DSAR to'liq D-23'da; bu bosqichda faqat UI bog'lanish.
28. Settings o'zgarishlari audit: har PATCH log'lanadi (settings_saved) — admin ko'radi.
29. Privacy section'da DSAR'ga oid "Ma'lumotlarimni eksport qilish" tugmasi D-23'ga ulanadi.
30. D-09 hisoboti operator tasdig'i bilan yopiladi.
```

## D-10 — Admin frontend (dashboard, users, teachers, audit)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (admin, audit).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin frontend'ini to'liq qurish — dashboard, users, teachers, audit.
05. Precondition: C-07/08/09, B-15 yashil bo'lishi kerak; admin backend va audit dashboard API'lari tayyor.
06. `views/admin/dashboard.ejs`: KPI kartalar (login ok/fail, lockout, teacher arizalar, risk block, email deliverability) — C-09 API.
07. `views/admin/users.ejs` (C-08): ro'yxat (pagination), qidiruv (debounce), blok/aktiv, rol change, session revoke — confirm modal.
08. `views/admin/teachers.ejs` (B-15): arizalar ro'yxati, status filter, approve/reject (sabab majburiy), detail view.
09. `views/admin/audit.ejs` (C-09): log ro'yxati (filter: event, user, vaqt), eksport CSV, charts (accesssible SVG).
10. `public/js/admin.js`: tab'lar, filter, modal, chart render, optimistic UI; xatolik state aniq.
11. A11y: admin keyboard to'liq; 44px; charts matn alternativi; focus management modal.
12. Mobile: responsive jadval (card view); touch.
13. i18n: 4 til — admin UI to'liq (D-11 bilan).
14. Security/data guard: faqat admin (requireRole, C-20); PII minimal; XSS; audit har action (C-09).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (admin_viewed, admin_exported, admin_action).
17. Unit test: tab'lar; filter; modal; confirm; pagination.
18. Integration/contract test: dashboard data; users manage; teachers approve; audit eksport.
19. E2E/security test: non-admin blok (redirect/login); IDOR; XSS; export CSV injection.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-10 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: non-admin access ochiq bo'lsa yoki audit bo'lmasa.
24. Done condition: admin frontend to'liq, testlar yashil, a11y/i18n tekshirilgan.
25. D-11 uchun: i18n to'liq'ga tayyor ekanini dalil bilan yoz.
26. Chart lib accessible (SVG); CSV eksport formula-injection himoyasi.
27. Admin UI'da barcha action'lar audit event yuboradi (C-09) — frontend shart.
28. Admin dashboard metric'lari D-06 alert'lar bilan bog'lanadi (login fail spike).
29. D-10 hisoboti operator tasdig'i bilan yopiladi.
```

## D-11 — i18n to'liq (4 til, barcha ekranlar)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (i18n, terminology).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth UI'ni 4 tilga to'liq lokalizatsiya qilish.
05. Precondition: D-07..D-10 yashil bo'lishi kerak; barcha auth ekranlar qurilgan.
06. Tillar: uz-Latn (default), uz-Cyrl, ru, en — BCP-47 kodlari (uz, uz-Cyrl, ru, en).
07. `src/modules/auth/i18n.js`: barcha string'lar (login, register, verify, MFA, passkey, settings, admin, error'lar, lockout, teacher, email) — bitta manba.
08. Tarjima sifati: uz-Cyrl — professional tarjima (transliteratsiya EMAS); ru/en — native; "universitar" terminologiya (detskiy emas).
09. Locale saqlash: users.locale (profil); cookie; URL prefix (P2) — login/register'da switcher.
10. Form error'lar ham tarjima (barcha 14 holat, B-27/28) — server xato kodlari → key.
11. Xato kodlari (API) — i18n key'larga mapping (D-30 contract bilan birga).
12. RTL: kerak emas (uz/ru/en LTR) — lekin uzun matnlar (ru) layout testi.
13. `lang` atributi to'g'ri (uz-Latn/uz-Cyrl) — screen reader va SEO.
14. Switcher: native nomlar (O'zbekcha, Ўзбекча, Русский, English), 44px, joriy sahifani saqlash, davlat flag emas.
15. Plurallar: ru/uz grammatika (1 ta / 2 ta) — i18n library qoidalari.
16. Security/data guard: hech qanday PII tarjima string'ida; string interpolation XSS-safe.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: string to'liqligi (har til bir xil count); key yo'q emas; interpolation.
20. Integration/contract test: til o'zgarishi → UI; locale persist; switcher.
21. E2E/security test: XSS (tarjima string escape); lang attr; uzun matn overflow emas.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-11 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: bir til string yetishmasa yoki tarjima transliteratsiya bo'lsa (uz-Cyrl).
26. Done condition: i18n to'liq, testlar yashil, 4 til tekshirilgan.
27. D-12 uchun: A11y to'liq'ga tayyor ekanini dalil bilan yoz.
28. Terminology bank (uz) — Prompt 63 bilan mos; yangi string'lar keyingi bosqichlarda qo'shiladi.
```

## D-12 — A11y to'liq (WCAG 2.2 AA, barcha auth ekranlar)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: barcha auth ekranlarini WCAG 2.2 AA'ga keltirish.
05. Precondition: D-11 yashil bo'lishi kerak.
06. WCAG 2.2 AA checklist (auth):
   - 1.4.3 Contrast (4.5:1), 1.4.11 Non-text contrast.
   - 2.1.1 Keyboard (hammasi), 2.1.2 No trap, 2.1.4 Shortcuts remappable (agar).
   - 2.4.3 Focus order, 2.4.7 Focus visible, 2.4.11 Focus not obscured.
   - 2.2.1 Timing adjustable (lockout countdown — kengaytirish).
   - 3.3.1 Error identification, 3.3.2 Labels, 3.3.3 Error suggestion.
   - 4.1.2 Name/Role/Value (toggle, tab), 4.1.3 Status messages (aria-live).
07. Skip link har ekranda.
08. Screen reader: "A — qizil kvadrat" (MFA/quiz), label'lar aniq.
09. Focus trap modallarda (Escape, close).
10. Reduced-motion (countdown, animatsiyalar).
11. `axe` automated (0 critical) + manual keyboard journey.
12. Test: screen reader (NVDA/VoiceOver) critical journey.
13. Security/data guard: A11y action strike bo'lmaydi (attempt bilan bog'liq).
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: axe scan (CI).
17. Integration/contract test: keyboard journey (register→verify→login→MFA→settings).
18. E2E/security test: focus trap; aria-live; contrast.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga D-12 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: axe critical bo'lsa.
23. Done condition: A11y to'liq, testlar yashil.
24. D-13 uchun: mobile to'liq'ga tayyor.
25. ACR hujjat (Prompt 64).
```

## D-13 — Mobile to'liq (barcha auth ekranlar)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1, 1b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth ekranlarini mobile'da to'liq optimallashtirish.
05. Precondition: D-12 yashil bo'lishi kerak.
06. 375px test har ekran: CTA above fold, 44px, bosh barmoq zonasi.
07. Autofill: iOS/Android native (username/current-password/new-password/one-time-code).
08. Keyboard: username (no autocap), email (inputmode), parol (secure), OTP (numeric).
09. OTP: single-digit inputs, autofill, paste.
10. MFA QR: mobile'da skan qulay.
11. Passkey: biometric (Face ID/Touch ID), conditional UI.
12. Settings: accordion, thumb.
13. Admin: responsive (ishlatish mumkin).
14. PWA: install prompt (3-sessiya), offline (auth kerak emas — sayt).
15. i18n: til switcher mobile'da.
16. A11y: 44px, contrast.
17. Security/data guard: in-app browser (Telegram) — "real browser'ga o'ting".
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
20. Unit test: 375px layout.
21. Integration/contract test: autofill; OTP.
22. E2E/security test: 44px; bosh barmoq; XSS.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga D-13 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: 375px CTA below fold bo'lsa.
27. Done condition: mobile to'liq, testlar yashil.
28. D-14 uchun: test framework'ga tayyor.
```

## D-14 — Test framework to'liq (unit/integration/e2e/security)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (testing pyramid).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth test framework'ini to'liq qurish — unit/integration/e2e/security.
05. Precondition: D-13 yashil bo'lishi kerak; mobile to'liq.
06. Vitest: unit (har modul), integration (supertest), e2e (playwright), security — bitta orkestr.
07. Test helper'lar: mock provider (Google OIDC, email, Telegram, Turnstile, HIBP, HEMIS), deterministic clock, fixture DB, ioredis-mock — `tests/helpers/`.
08. `tests/auth/` strukturasi: unit/ integration/ e2e/ security/ fixtures/ — har modul uchun alohida fayl.
09. Coverage: auth >=90% (unit), critical journey e2e (login/register/MFA/teacher), security suite qat'iy.
10. CI: `npm run test:auth` (unit+integration), `npm run test:e2e:auth`, `npm run test:security:auth` — D-20 pipeline'ga ulanadi.
11. Deterministic: random mock (deterministic seed), fake clock (D-33), Redis mock — flaky yo'q.
12. Parallel: vitest pool; har test izolyatsiya (fresh DB, fresh Redis namespace).
13. Security/data guard: test real production data'ga ulanmaydi; mock provider; secret'lar test fixture'da ham haqiqiy emas.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: framework smoke; helper'lar ishlaydi.
17. Integration/contract test: supertest setup; mock provider qayta ishlatiladi.
18. E2E/security test: playwright setup; CI'da headless.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga D-14 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: test real provider'ga ulansa yoki flaky bo'lsa.
23. Done condition: framework to'liq, testlar yashil, CI'da ishlaydi.
24. D-15 uchun: unit test auth core'ga tayyor ekanini dalil bilan yoz.
25. Test command'lar package.json'da hujjatlashtiriladi (npm run test:auth va h.k.).
26. CI'da test parallel va izolyatsiya: har job fresh DB/Redis namespace.
27. Test qamrov report (coverage/lcov) CI artifact'ida saqlanadi.
28. Flaky test siyosati: 3 marta fail → quarantine; sabab tuzatiladi (o'chirish emas).
29. D-14 hisoboti operator tasdig'i bilan yopiladi.
```

## D-15 — Unit test auth core (parol, session, OIDC, MFA, passkey)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1, 2, 3-bo'limlarini to'liq o'qi (auth spec).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth core uchun to'liq unit test to'plamini yozish (coverage >=90%).
05. Precondition: D-14 yashil bo'lishi kerak; test framework tayyor.
06. Parol: NIST policy (8/15 dynamic), HIBP k-anonymity, zxcvbn score, Argon2 verify, timing (dummy hash), reuse/history.
07. Session: ID entropy (256-bit), TTL, revoke, idle/absolute timeout, remember selector/verifier, parallel limit (A-02).
08. OIDC: PKCE S256, state/nonce, JWKS alg allowlist (RS256), exact redirect, issuer/aud/exp, refresh rotation (A-24).
09. MFA: TOTP valid_window=1, backup hash+used, lockout 5x15, challenge consumed, reset time-delay (A-26).
10. Passkey: counter monotonic, origin/rpId, challenge replay, recovery codes (A-27).
11. Forgot: token 256-bit, hash, expiry 15-60 min, bitta foydalanish, bir xil javob+vaqt (dummy) (A-06/20).
12. Rate limit: sliding window, token bucket, per-IP/account/ASN, jitter (C-01).
13. Risk: score, tiers, impossible travel, velocity, decay (C-04/05/17).
14. Audit: redaction, retention, append-only (C-09/D-04).
15. Security/data guard: test'da secret real emas; mock provider (D-14).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: barcha yuqoridagi — har biri alohida `describe`; edge case'lar (empty, malformed, boundary).
19. Integration/contract test: — (D-17 da to'liq).
20. E2E/security test: — (D-18 da to'liq).
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga D-15 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: coverage <90% yoki critical test yo'q (login/parol/OTP).
25. Done condition: unit core to'liq, testlar yashil, coverage o'lchangan.
26. D-16 uchun: unit test register/email'ga tayyor ekanini dalil bilan yoz.
27. Har test senariysi uchun manba (NIST/OWASP bandi) comment'da ko'rsatiladi.
28. Coverage report: unit/auth — >=90% tekshiriladi; kam qismi ro'yxatlanadi.
29. D-15 hisoboti operator tasdig'i bilan yopiladi.
```

## D-16 — Unit test register + email + teacher approval

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b-bo'limini to'liq o'qi (register spec).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register/email/teacher approval unit test'larini yozish.
05. Precondition: D-15 yashil bo'lishi kerak; auth core unit testlar tayyor.
06. Register: Zod schema, honeypot (B-08), duplicate, username normalize, disposable blok, typo (B-05).
07. Verify: kod hash, expiry, bitta foydalanish, limited mode, resend cooldown (B-06/07/28).
08. Invite: token, validatsiya (to'g'ri/buzuq/ishlatilgan/eskirgan), revoke, enrollment transaction (B-11/12/13).
09. Teacher approval: state machine, approval window (72h), justification, cooldown, eskalatsiya, limited mode (B-14/15/16).
10. Onboarding: state machine, first-win scoring, checklist, activation event, welcome idempotency (B-17/18/19).
11. Email: template render 4 til, spam scan, bounce webhook, validation, queue (B-20/31).
12. Email change: reauth, ikkala verify, commit, revoke (B-24).
13. Session invalidation: har trigger (parol change, MFA change, passkey revoke, admin) (B-25).
14. Security/data guard: mock provider; synthetic data; PII yo'q.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: barcha yuqoridagi — har biri alohida describe; edge case'lar.
18. Integration/contract test: — (D-17 da).
19. E2E/security test: — (D-18 da).
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-16 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: state machine test'siz bo'lsa yoki coverage past bo'lsa.
24. Done condition: unit register/email to'liq, testlar yashil.
25. D-17 uchun: integration test'ga tayyor ekanini dalil bilan yoz.
26. Har test senariysi uchun manba (B-prompt bandi) comment'da ko'rsatiladi.
27. Email template test: 4 til render bir xil struktur (screenshot/string).
28. Coverage report: register/email/teacher — >=90%.
29. D-16 hisoboti operator tasdig'i bilan yopiladi.
```

## D-17 — Integration test (login, register, MFA, teacher, HEMIS flow)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-8-bo'limlarini to'liq o'qi (auth spec bo'limlari).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: integration test'larini yozish — har auth flow end-to-end backend.
05. Precondition: D-16 yashil bo'lishi kerak; unit testlar to'liq.
06. Login flow: parol→session→redirect; Google OIDC (mock)→mapping; MFA step; forgot→reset→login (A-04/05/07).
07. Register flow: forma→verify→limited→login; Google→rol modal; invite→enrollment (B-03..B-13).
08. Teacher: register→pending→approve→teacher; reject→cooldown; limited blok (B-14/15/16).
09. MFA: enable→login; backup code; step-up; reset time-delay (A-26).
10. Passkey: register→login (conditional+modal); revoke (A-27).
11. Session: revoke bitta/all; idle; parallel limit; invalidation triggerlari (A-02/A-08/B-25).
12. Roster: HEMIS fayl→staging→commit→rollback; invite (A-10/11, C-11).
13. Email: send→delivery→bounce→suppress; validation (A-23/B-31).
14. Risk: new device→stepup; trusted→seamless; high→block (C-04/05).
15. HEMIS OAuth (agar active): authorize→token→user→mapping (C-10) — mock yoki UZ test muhiti.
16. Security/data guard: mock provider; fresh DB har test; izolyatsiya.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: — (D-15/16 da to'liq).
20. Integration/contract test: barcha yuqoridagi flow'lar (supertest).
21. E2E/security test: — (D-18 da to'liq).
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-17 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: har qanday flow test'siz bo'lsa.
26. Done condition: integration to'liq, testlar yashil.
27. D-18 uchun: E2E/security test'ga tayyor ekanini dalil bilan yoz.
28. Har flow test'i uchun manba (A/B/C-prompt bandi) comment'da ko'rsatiladi.
29. Integration testlar CI'da ishlaydi; staging DB emas (fresh).
30. D-17 hisoboti operator tasdig'i bilan yopiladi.
```

## D-18 — E2E + Security test (to'liq suite)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: E2E va security test'larini to'liq yozish.
05. Precondition: D-17 yashil bo'lishi kerak.
06. E2E (Playwright): register journey, login journey, MFA journey, passkey, teacher journey, settings, admin.
07. Security testlar:
   - Enumeration: bir xil javob+vaqt (100 req o'rtacha).
   - Brute force: distributed (per-ASN).
   - Session fixation: regenerate.
   - CSRF: barcha POST.
   - Cookie flags: httpOnly/secure/sameSite/__Host-.
   - Open redirect: returnUrl evil.
   - Alg confusion (OIDC HS256).
   - Replay: MFA challenge, passkey counter, reset token.
   - IDOR: boshqa user sessiya/portfolio/settings.
   - MFA bypass: "session password stage'da".
   - Teacher escalation.
   - Secret scan: clientSecret/client_id=8 production'da yo'q.
   - PII scan: parol/token/OTP/email log'da yo'q (grep).
   - XSS: barcha input.
   - SSRF: opendata.
   - Timing: dummy hash.
08. `tests/auth/security/` — har biri alohida test.
09. Playwright: multi-browser (chromium/firefox/webkit), mobile viewport.
10. Coverage: critical journey 100%.
11. Security/data guard: test real provider'ga ulanmaydi; secret mock.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: —.
15. Integration/contract test: —.
16. E2E/security test: barcha yuqoridagi.
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-auth.md`ga D-18 statusi va next readinessni yoz.
19. Global report formatida changed files, migration, command va test natijalarini qaytar.
20. Stop condition: security critical test fail bo'lsa.
21. Done condition: E2E/security to'liq, testlar yashil.
22. D-19 uchun: load test'ga tayyor.
23. axe integration (a11y E2E).
```

## D-19 — Load test (auth, imtihon peak)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (load, SLO).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth uchun load test'ni qurish — imtihon peak, login storm.
05. Precondition: D-18 yashil bo'lishi kerak; E2E+security suite o'tgan.
06. Scenario: 5000 talaba bir vaqtda login (imtihon start); 1000 teacher login; MFA storm; forgot storm (past).
07. Tools: k6 (open source) yoki autocannon — CI'da nightly (D-20).
08. Metrics: p95 login latency <2s; error <0.1%; no data loss; throughput o'lchanadi.
09. Redis: session write throughput; rate limit counter; risk cache — bottleneck aniqlanadi.
10. DB: users lookup; auth_audit write (non-blocking, async); MFA tekshirish.
11. Rate limit: login storm'da false lockout YO'Q (kampus NAT e'tibori, C-01).
12. Test data: synthetic (PII yo'q); user'lar fixture'dan (D-37 seed).
13. Security/data guard: load test production data'ga ulanmaydi; staging muhitida.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: — (yangi kod kam).
17. Integration/contract test: load script ishlaydi; SLO check.
18. E2E/security test: peak SLO natijasi hujjatda.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga D-19 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: peak SLO fail bo'lsa — tuning kerak (E-13/31).
23. Done condition: load test to'liq, SLO natijalari hujjatlashtirilgan.
24. D-20 uchun: CI/CD'ga tayyor ekanini dalil bilan yoz.
25. k6 script CI'da (nightly); natija report hujjatda.
26. Load test natijalari (p95, error rate, throughput) hujjatda saqlanadi.
27. Bottleneck topilsa — tuning rejasi yoziladi (E-13/31 bilan).
28. Kampus NAT simulyatsiyasi: bir ASN ko'p IP (false lockout yo'q).
29. D-19 hisoboti operator tasdig'i bilan yopiladi.
```

## D-20 — CI/CD pipeline (auth stage)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: CI/CD pipeline'ini qurish — auth uchun test, security, build, deploy stage'lar.
05. Precondition: D-19 yashil bo'lishi kerak.
06. `.github/workflows/auth.yml`:
   - Stage 1: install + typecheck.
   - Stage 2: unit+integration (vitest, mock provider, ioredis-mock, test DB).
   - Stage 3: security suite (D-18).
   - Stage 4: E2E (playwright, service worker mock).
   - Stage 5: a11y (axe).
   - Stage 6: build (npm run build, bundle size check).
   - Stage 7: deploy (staging → prod, blue-green, migration).
07. Secret'lar: GitHub secrets (env'lar mock'da); production secret CI'da emas.
08. Migration: CI'da fresh DB migrate; prod'da backward-compatible.
09. Gate: har stage fail → build blok; security critical → release blok.
10. Artifact: SBOM (Prompt 70), build hash.
11. Audit: CI_RUN (log).
12. Security/data guard: CI secret'lar encrypt; test real provider'ga ulanmaydi.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: CI script lint.
16. Integration/contract test: CI dry-run.
17. E2E/security test: CI gate'lar.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-20 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: CI security stage bo'lmasa.
22. Done condition: CI/CD to'liq, testlar yashil.
23. D-21 uchun: deploy runbook'ga tayyor.
24. Cache: npm, playwright.
25. Parallel stage'lar (tezlik).
```

## D-21 — Deploy runbook (auth, blue-green, rollback)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (deploy, rollback).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: deploy runbook'ini qurish — auth uchun blue-green, migration, rollback.
05. Precondition: D-20 yashil bo'lishi kerak; CI/CD pipeline ishlaydi.
06. Blue-green: ikki environment (blue/green); auth service qatlami; DNS/LB switch — downtime minimal.
07. Migration deploy: backward-compatible migration avval (20-rule), kod keyin; rollback rejasi har migration uchun.
08. Rollback trigger: error rate >1%, login fail spike, security alert, auth latency p95 >5s.
09. Rollback qadamlar: old release switch, migration rollback (agar backward-incompatible — yo'q bo'lishi kerak), Redis session — login'lar qayta (accept).
10. Feature flags: auth yangiliklar flag orqali (mas. MFA majburiy, passkey) — gradual rollout (5% → 100%).
11. Health check: /health (DB, Redis, provider) — deploy'da avval health, keyin trafik.
12. Runbook hujjati: `docs/runbooks/auth-deploy.md` — kim, qachon, qadamlar, rollback (D-26 bilan birga).
13. Audit: deploy_started, deploy_completed, deploy_rolled_back (operator, ts).
14. Security/data guard: deploy secret'lar env/KMS (D-02); rollback data loss yo'q; freeze window (D-38).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: health endpoint; flag toggle.
18. Integration/contract test: blue-green smoke (health → login).
19. E2E/security test: rollback drill (D-38 bilan) — staging'da.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-21 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: rollback drill bo'lmasa yoki migration backward-incompatible bo'lsa.
24. Done condition: deploy runbook to'liq, drill o'tgan.
25. D-22 uchun: legal'ga tayyor ekanini dalil bilan yoz.
26. Feature flag ro'yxati hujjatda: nomi, default, rollout qadamlari (5/25/100%).
27. Blue-green o'tish: health → 1% trafik → 10% → 100% (canary).
28. Deploy tarixi: `implementation-status-auth.md`ga har release yoziladi.
29. D-21 hisoboti operator tasdig'i bilan yopiladi.
```

## D-22 — UZ data law compliance (auth PII)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: O'zbekiston shaxsiy ma'lumotlar qonunchiligiga muvofiqlikni qurish (auth PII).
05. Precondition: D-21 yashil bo'lishi kerak.
06. PII inventarizatsiya (auth): email, phone, telegram_id, hemis_id, google_sub, ip_hash, device fingerprint hash, geo (city), audit log.
07. Qonuniy asos: rozilik (email verify), shartnoma (ta'lim xizmati), qonuniy majburiyat.
08. Maqsad chegarasi: faqat auth/security uchun.
09. Minimallashtirish: ip_hash (to'liq IP emas), fingerprint hash, geo city.
10. UZ'da saqlash: server UZ region'da (data law); xorijiy provider'da emas.
11. Saqlash muddati: retention (C-14).
12. Xavfsizlik: encryption (D-02), access control.
13. Foydalanuvchi huquqlari: DSAR (D-23), tuzatish, o'chirish, cheklash.
14. Rozilik yozuvlari: consent_log (verify, camera, MFA) — audit.
15. Hujjatlar: privacy policy (D-24), DPIA (D-25).
16. Security/data guard: PII minimal; UZ'da; DSAR.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: PII inventory test.
20. Integration/contract test: retention; consent.
21. E2E/security test: PII xorij'ga chiqmaydi (config test).
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-22 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: PII UZ'dan chiqsa yoki minimallashtirish bo'lmasa.
26. Done condition: legal compliance to'liq.
27. D-23 uchun: DSAR'ga tayyor.
28. Legal review (operator).
```

## D-23 — DSAR (Data Subject Access Request) auth

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (DSAR, retention).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: DSAR flow'ini qurish — eksport, tuzatish, o'chirish, cheklash.
05. Precondition: D-22 yashil bo'lishi kerak; UZ data law compliance tayyor.
06. `POST /api/privacy/dsar/export`: barcha user PII (profile, audit hash'lar, devices, MFA metadata, consent log) → JSON/CSV (30 kun ichida, O'zbekiston qonuni).
07. `POST /api/privacy/dsar/correct`: profil tuzatish (reauth) — users.update; audit'da qayd.
08. `POST /api/privacy/dsar/delete`: account o'chirish (hard delete + derived copy purge; legal hold qarshi) — eng muhim.
09. Delete flow: reauth + confirmation (sabab ixtiyoriy) → soft delete (30 kun grace, login blok) → hard delete + purge (C-14).
10. `POST /api/privacy/dsar/restrict`: ma'lumotlarni cheklash (legal hold flag) — processing to'xtaydi (email/telegram yuborilmaydi).
11. DSAR log: dsar_requests (user, type, status, sla_deadline) — audit; admin ko'radi.
12. SLA: 30 kun (O'zbekiston) — tracking + eslatma (C-23 cron); kechikish alert.
13. Derived copies: audit hash'lar (PII emas — qoladi), backup (C-15) — grace'dan keyin purge.
14. A11y: DSAR UI accessible; delete confirmation aniq ("tugatilmaydi") .
15. Mobile: bir xil flow.
16. Security/data guard: DSAR auth (reauth); legal hold fail-open emas; derived copy purge; IDOR yo'q.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (dsar_exported, dsar_deleted, dsar_restricted).
19. Unit test: eksport data completeness; delete derived; legal hold; grace window.
20. Integration/contract test: eksport→delete→purge; restrict; SLA tracking.
21. E2E/security test: IDOR; reauth; legal hold'da delete emas; delete'dan keyin login emas.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-23 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: derived copy purge bo'lmasa yoki legal hold bo'lmasa.
26. Done condition: DSAR to'liq, testlar yashil, SLA ishlaydi.
27. D-24 uchun: privacy policy'ga tayyor ekanini dalil bilan yoz.
28. DSAR SLA monitoring: dsar_request_age metric, 25 kun alert (D-06).
29. DSAR eksport fayli maxsus bucket (UZ), 7 kun TTL, user'ga xavfsiz link.
30. D-23 hisoboti operator tasdig'i bilan yopiladi.
```

## D-24 — Privacy policy + terms (auth qismi)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (legal, UZ qonuni).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: privacy policy va terms'ni auth qismi uchun yozish (4 til).
05. Precondition: D-23 yashil bo'lishi kerak; DSAR flow tayyor.
06. Privacy policy (uz-Latn/Cyrl/ru/en): qanday ma'lumot, maqsad, saqlash muddati, DSAR, UZ qonuni, contact (security@edikit.uz).
07. Auth'ga oid: email (verify/reset), telegram_id (bildirishnoma), hemis_id (login), device fingerprint (xavfsizlik), audit log, consent log.
08. Terms: account, parol siyosati (NIST), MFA, teacher approval, bloklash sabablari, mas'uliyat, abuse.
09. Cookie policy: session cookie, remember-me, CSRF (non-HttpOnly), 3rd-party cookie yo'q.
10. Consent: register'da "Roziman" (checkbox, majburiy — auth uchun) + shartnoma versiyasi (D-25).
11. Hujjatlar: `/privacy`, `/terms`, `/cookies` — 4 til; footer'da havola; version ko'rsatiladi.
12. Legal review: operator/advokat imzosi — hujjat tasdiqlangan sanasi.
13. A11y: hujjatlar accessible (sarlavha strukturasi, kontrast, print).
14. Mobile: readable (uzun matn, havolalar).
15. Security/data guard: hujjat'da secret yo'q; aniq, adolatli, tushunarli til (universitar daraja).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: hujjat 4 til mavjud (string check).
19. Integration/contract test: /privacy 200; consent version bog'lanish.
20. E2E/security test: XSS (hujjat render); link'lar ishlaydi.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga D-24 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: consent bo'lmasa yoki hujjat yo'q bo'lsa.
25. Done condition: privacy/terms to'liq, legal review o'tgan.
26. D-25 uchun: DPIA'ga tayyor ekanini dalil bilan yoz.
27. Hujjat versionlari: har o'zgarishda version + sana; changelog.
28. Legal contact va DPO (agar) ko'rsatiladi; operator to'ldiradi.
29. D-24 hisoboti operator tasdig'i bilan yopiladi.
```

## D-25 — DPIA + consent log (auth)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (privacy, consent).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: DPIA (data protection impact) va consent log'ni qurish.
05. Precondition: D-24 yashil bo'lishi kerak; privacy policy tayyor.
06. DPIA hujjati (auth): PII inventarizatsiya, processing maqsadi, risk (breach, misuse, insider), mitigation (encryption, access, retention, DSAR).
07. `consent_log` jadvali: user_id, purpose (email_verify, telegram, mfa, camera, privacy_policy_v1), granted_at, version, ip_hash, revoked_at.
08. Consent version: policy version saqlash (o'zgarishda re-consent) — eski version foydalanuvchiga yangi so'rov.
09. Register'da: privacy_policy_v1 checkbox (majburiy); telegram — alohida consent (ixtiyoriy) (B-22).
10. Consent audit: har consent log'da; DSAR'da ko'rinadi (D-23); admin ko'ra oladi.
11. Revoke: user consent'ni bekor qilishi (settings D-09) — amalda funksiya to'xtaydi (telegram uziladi, email marketing to'xtaydi).
12. Re-consent: policy yangilansa, eski consent'lar revoke emas — yangi so'rov (banner) ko'rsatiladi.
13. A11y: consent checkbox accessible; banner focus.
14. Mobile: bir xil flow; banner responsive.
15. Security/data guard: consent PII minimal; version; revoke fail-open emas (amalda ishlaydi).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (consent_granted, consent_revoked, consent_version_bumped).
18. Unit test: consent version; revoke; re-consent.
19. Integration/contract test: register→consent; revoke→funksiya to'xtadi (telegram yuborilmaydi).
20. E2E/security test: consent'siz email emas; XSS; IDOR.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga D-25 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: consent bo'lmasa yoki version bo'lmasa.
25. Done condition: DPIA + consent to'liq, testlar yashil, legal review o'tgan.
26. D-26 uchun: incident response'ga tayyor ekanini dalil bilan yoz.
27. DPIA review: har yili yoki PII o'zgarishida qayta ko'rib chiqiladi.
28. Consent metric: consent_granted/revoked count, re-consent pending.
29. D-25 hisoboti operator tasdig'i bilan yopiladi.
```

## D-26 — Auth incident response (runbook)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (incident response).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth incident response runbook'ini qurish.
05. Precondition: D-25 yashil bo'lishi kerak; consent/DPIA tayyor.
06. Incident turlari (auth): credential leak, session hijack, ATO burst, MFA bypass, email compromise, provider outage (Google/email/HEMIS).
07. Har biri uchun: detection (alert, D-06), severity (S1-S3), owner, steps, communication, postmortem — jadval hujjatda.
08. Credential leak: HIBP alert → barcha affected user'lar sessiyalarini revoke + forced reset + notification (email/push) + audit.
09. ATO burst: risk_block alert (C-04) → affected user'lar blok + reset + notification + super-admin (C-20).
10. Provider outage: Google/email down → fallback (parol, Telegram, B-22), status page, notification (B-32), ETA.
11. MFA bypass report: darhol S1 — MFA off (temporary, feature flag), audit, fix, re-enable (flag orqali, D-21).
12. Contact: security@edikit, ops Telegram (B-22) — on-call ro'yxati.
13. Runbook hujjati (`docs/runbooks/auth-incident.md`): kim, qadamlar, SLA (S1 <1 soat response).
14. Drill: har oy (staging'da) — incident simulyatsiya (credential leak, ATO) — D-38 bilan.
15. Audit: incident_log (id, type, severity, timeline, actions, postmortem) — append-only.
16. Security/data guard: incident'da PII minimal; user notification honest (xavfsizlikka tegishli bo'lsa, qonun talabi).
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: runbook steps (mock); flag toggle.
20. Integration/contract test: leak response flow (revoke+reset+notify).
21. E2E/security test: drill simulyatsiya natijasi hujjatda.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga D-26 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: runbook bo'lmasa yoki drill o'tkazilmagan bo'lsa.
26. Done condition: incident response to'liq, drill o'tgan.
27. D-27 uchun: final acceptance'ga tayyor ekanini dalil bilan yoz.
28. Incident contactlar jadvali (on-call, security, ops) hujjatda — operator to'ldiradi.
29. D-26 hisoboti operator tasdig'i bilan yopiladi.
```

## D-27 — Auth final acceptance (D-faza checkpoint)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini to'liq yakuniy acceptance testlari bilan sertifikatlash.
05. Precondition: D-00..D-26 yashil; A/B/C fazalar yashil.
06. FINAL ACCEPTANCE:
07. Barcha fazalar: A (core), B (register/email), C (risk/admin/integration), D (infra/frontend/test/ops/legal) — checklist.
08. Full regression: unit+integration+E2E+security (A-31, B-26, C-16, D-18).
09. Load: imtihon peak (D-19).
10. Security: pen-test review, secret scan, PII scan.
11. Legal: DPIA, consent, DSAR, retention, UZ data law.
12. Ops: deploy, rollback drill, incident drill, backup restore.
13. A11y: axe 0, keyboard journey, screen reader.
14. i18n: 4 til to'liq.
15. Observability: SLO, alerts, runbook.
16. Docs: runbook'lar, architecture, user guide.
17. Sign-off: security, privacy, legal, ops, product.
18. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
21. Unit test: full suite.
22. Integration/contract test: multi-role acceptance.
23. E2E/security test: full drill.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga D-27 (FINAL CHECKPOINT) statusi yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: har qanday critical/high blocker qolsa.
28. Done condition: auth tizimi to'liq, release sign-off tayyor.
29. Operator yakuniy sign-off; `research_auth_deep.md` manbalar arxivi.
30. Next-version backlog yoziladi (P3: OneID, HEMIS data, push to'liq).
```

## D-28 — Auth handover + maintenance runbook

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini handover va maintenance runbook'ini yozish.
05. Precondition: D-27 yashil bo'lishi kerak.
06. Handover hujjati: arxitektura (auth modullari), qarorlar (NIST/OWASP), manbalar, owner'lar.
07. Maintenance runbook:
   - Har kuni: alert check, email bounce, rate-limit abuse.
   - Har hafta: audit review, DMARC report.
   - Har oy: backup restore drill, incident drill, HIBP sync, disposable list update, key rotation check.
   - Har kvartal: pen-test, DPIA review, dependency update, tuning logs.
08. Dependency update: auth lib'lar (argon2, oidc, simplewebauthn, otplib) — CVE scan (CI).
09. Secret rotation: mas. 90 kun (D-02).
10. Provider review: Google/Postmark/HEMIS terms — har yil.
11. Audit: maintenance_log.
12. Security/data guard: maintenance'da PII minimal.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: maintenance scripts.
16. Integration/contract test: rotation; update.
17. E2E/security test: CVE scan.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-28 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: maintenance plan bo'lmasa.
22. Done condition: handover to'liq.
23. E-faza (ekstra) — operator qaroriga ko'ra.
24. Owner'lar aniq (security, ops, legal).
25. Next-version backlog (P3) yoziladi.
```

## D-29 — Frontend detail: form validation (client, Zod)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1, 1b-bo'limlarini to'liq o'qi (login/register spec).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: client-side validation'ni Zod bilan to'liq qurish.
05. Precondition: D-07 yashil bo'lishi kerak; login/register frontend tayyor.
06. Zod schemas (client): loginSchema, registerSchema, resetSchema, verifySchema, mfaSchema — server bilan bir xil (D-30 shared).
07. Debounce: email live check 300ms (B-05), username 300ms (B-04) — request soni cheklangan.
08. Inline error: field yonida, aria-live polite (D-07) — xato fokus'da emas, lekin ko'rinadi.
09. Focus first error: submit'da birinchi xato field'ga fokus (A11y, E-07).
10. Submit disable: invalid'da (har keystroke) — lekin blok emas, xabar ko'rsatiladi.
11. Server double validation: client UX, server security (D-07) — client bypass qilinsa server rad etadi.
12. Error normalizatsiya: server xato kodi → i18n key (D-11) → inline matn.
13. Parol field qoidalari: NIST (B-27) — client zxcvbn indikator + server qat'iy.
14. Security/data guard: client validation UX; server security yagona truth.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: Zod schema; debounce; focus first error; submit disable.
18. Integration/contract test: server double validation (bypass qilinsa 400).
19. E2E/security test: client off (JS) → server to'liq himoya qiladi.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga D-29 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: server double bo'lmasa (client-only validation xavfli).
24. Done condition: form validation to'liq, testlar yashil.
25. D-30 uchun: API contract'ga tayyor ekanini dalil bilan yoz.
26. Client Zod schema'lar shared paketdan import qilinadi (D-30) — duplicate yo'q.
27. Form state: aria-invalid, aria-describedby (xato id) — a11y.
28. Validate-on-change vs validate-on-blur: login'da blur (xato kam), register'da change.
29. D-29 hisoboti operator tasdig'i bilan yopiladi.
```

## D-30 — API contract (Zod shared, OpenAPI)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (API contract, OpenAPI).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth API contract'ni qurish — shared Zod, OpenAPI.
05. Precondition: D-29 yashil bo'lishi kerak; form validation tayyor.
06. `src/modules/auth/contracts.js`: barcha request/response Zod (login, register, verify, reset, mfa, passkey, session, teacher, risk) — shared client/server.
07. OpenAPI: /api/v1 spec (auth) — generate (zod-to-openapi); validate har CI'da; versionlanadi.
08. Error codes: barcha (A-04: AUTH_FAILED, RATE_LIMITED, LOCKED, INVALID_TOKEN...) — contract'da enum.
09. Rate limit headers: X-RateLimit-Limit/Remaining/Reset (C-01) — contract'da; client ko'rsatadi.
10. Version: /api/v1 (breaking change → v2); deprecation policy hujjatda.
11. Response no private field: password, token, otp, secret — response'da YO'Q (schema safePick).
12. Security/data guard: private field'lar (password, token) response'da yo'q; Zod shared yagona manba.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: schema; contract; zod-to-openapi generate.
16. Integration/contract test: OpenAPI valid (swagger lint); har endpoint schema'ga mos.
17. E2E/security test: private field scan (response'da parol/token yo'q grep).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-30 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: private field bo'lsa (response'da) yoki OpenAPI invalid.
22. Done condition: API contract to'liq, testlar yashil.
23. D-31 uchun: session detail'ga tayyor ekanini dalil bilan yoz.
24. Contract breaking change jarayoni: v2 chiqarish, v1 deprecation 6 oy.
25. OpenAPI spec'da security scheme (session cookie, CSRF) ko'rsatiladi.
26. Contract test har PR'da (CI) — schema mismatch fail.
27. Response envelope (ok, data, error) barcha endpointda bir xil.
28. D-30 hisoboti operator tasdig'i bilan yopiladi.
```

## D-31 — Session detail: Redis patterns, concurrency, failover

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi (session, Redis).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session detail — Redis patterns, concurrency, failover.
05. Precondition: D-03 yashil bo'lishi kerak; Redis foundation tayyor.
06. Redis patterns: SETNX (idempotency), INCR (rate), sorted-set (parallel limit, A-02), pub/sub (session invalidate cross-node).
07. Concurrency: parallel login/revoke — atomic (Redis Lua script) — race yo'q (ikki login bir vaqtda, bitta revoke).
08. Failover: Redis down → session yo'qoladi? — login'lar qayta (accept), rate limit DB fallback (per-account, C-01), risk cache qayta hisob.
09. Cross-node: pub/sub session revoke (multi-instance) — bitta node revoke qilsa hammasida darhol.
10. Health: Redis ping (D-03) — health check; degrade mode flag (login qattiq emas).
11. Session serializatsiya: buffer JSON (PII minimal), TTL slayding — D-03.
12. Security/data guard: session PII minimal; failover data loss (login'lar — ok, accept); tenant scope.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: patterns (SETNX, INCR, sorted-set); Lua atomic.
16. Integration/contract test: failover (Redis down → login qayta); cross-node revoke.
17. E2E/security test: pub/sub revoke darhol ishlaydi; race (parallel login/revoke).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-31 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: concurrency race bo'lsa (atomic emas).
22. Done condition: session detail to'liq, testlar yashil.
23. D-32 uchun: email detail'ga tayyor ekanini dalil bilan yoz.
24. Redis key namespace: `sess:{id}`, `rl:{ip}`, `risk:{user}` — prefiks hujjatda.
25. Lua script'lar versionlanadi va test qilinadi (race).
26. Failover siyosati: Redis down → login'lar qattiq emas (fallback DB), rate per-account.
27. Cross-node revoke latensiyasi: p95 <100ms (pub/sub).
28. D-31 hisoboti operator tasdig'i bilan yopiladi.
```

## D-32 — Email detail: provider abstraction, failover, cost

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini to'liq o'qi (Postmark/SES/SMTP2GO).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email provider abstraction + failover + cost tracking.
05. Precondition: A-23 yashil bo'lishi kerak; email foundation (SPF/DKIM/DMARC) tayyor.
06. `src/modules/email/provider.js`: interface (send, webhook parse) — postmark, ses, smtp implement (strategy pattern).
07. Failover: primary down → secondary (SES ↔ SMTP); queue (B-31) — xabar yo'qolmaydi.
08. Cost: per-provider tracking (E-30) — har email cost, oylik budget alert (D-06).
09. Template registry: B-20 — provider agnostic (provider render emas, local render).
10. Webhook mapping: delivery/bounce/complaint (A-23) — har provider'ning webhook'ini bitta interface'ga.
11. Headers: Message-ID, List-Unsubscribe (marketing), Reply-To — provider'da bir xil.
12. Security/data guard: provider key KMS (D-02); no injection (template data sanitize); PII minimal (to_hash queue'da, B-31).
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: interface; failover switch; cost calc.
16. Integration/contract test: secondary ishlaydi; webhook parse (har provider fixture).
17. E2E/security test: key leak yo'q; injection emas; spam scan (B-20).
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-32 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: failover bo'lmasa yoki key log'da bo'lsa.
22. Done condition: email abstraction to'liq, testlar yashil.
23. D-33 uchun: testing detail'ga tayyor ekanini dalil bilan yoz.
24. Provider'lar orasida subject/from bir xil (SPF/DKIM valid) — deliverability.
25. Failover trigger: 5x provider error 1 daqiqada → secondary; recovery avtomatik.
26. Cost tracking: email_cost_total, per-provider, oylik budget alert (D-06).
27. Provider webhook IP allowlist — spoof qarshi (A-23).
28. D-32 hisoboti operator tasdig'i bilan yopiladi.
```

## D-33 — Testing detail: mutation, property, snapshot

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (mutation, property testing).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: testing detail — mutation, property, snapshot, fuzz.
05. Precondition: E-11 yashil bo'lishi kerak; edge test'lar tayyor.
06. Mutation (stryker): auth core — mutation killed >=80% (parol, session, OTP, risk kritik).
07. Property (fast-check): parol policy, session TTL, risk score, token unique — invariant tekshirish.
08. Snapshot: API response (D-30) — regression; version'da yangilanadi (review bilan).
09. Fuzz: login/register input (E-11) — random malformed data, no crash, no XSS.
10. Time travel: fake clock — TTL, expiry, cooldown (deterministic, D-14).
11. Concurrency: parallel test (D-31) — race aniqlash (vitest concurrency).
12. Security/data guard: test synthetic; real secret yo'q; deterministik.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: mutation/property suites.
16. Integration/contract test: snapshot update; fuzz integration.
17. E2E/security test: fuzz security; time travel E2E.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-33 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: mutation <80% (kritik modul) — tuzatish kerak.
22. Done condition: testing detail to'liq, testlar yashil.
23. D-34 uchun: security detail'ga tayyor ekanini dalil bilan yoz.
24. Mutation report: killed/total, kritik modul % — hujjatda.
25. Property test seed'lar deterministic (repeat) — flaky yo'q.
26. Snapshot review: har snapshot o'zgarishi PR'da ko'rib chiqiladi.
27. Fuzz corpus: umumiy malformed input'lar (null, unicode, long, emoji).
28. D-33 hisoboti operator tasdig'i bilan yopiladi.
```

## D-34 — Security detail: headers, CSP, TLS audit

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (headers, CSP, TLS).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: security detail — headers, CSP, TLS audit.
05. Precondition: E-10 yashil bo'lishi kerak; security edge'lar tayyor.
06. Headers audit: HSTS, X-Content-Type-Options, X-Frame-Options (DENY auth), Referrer-Policy (no-referrer auth), CSP — har auth sahifa.
07. CSP: script-src 'self' (inline yo'q), connect-src (API origin), frame-ancestors 'none' (auth), base-uri 'self', form-action 'self'.
08. TLS: HTTPS hamma joyda (HSTS preload); cert auto-renewal (LE/ZeroSSL); redirect http→https.
09. TLS version: TLS 1.2+; ciphers strong (Mozilla intermediate); TLS 1.0/1.1 yo'q.
10. Header test: security suite (D-18) — har auth sahifada headers check; CI'da (D-20).
11. CSP violation report: report-to endpoint (ops) — false-positive monitoring.
12. Security/data guard: header hammasi; TLS; frame-ancestors auth'da 'none' (clickjacking).
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: header config (Helmet, D-07 bilan).
16. Integration/contract test: TLS handshake; redirect.
17. E2E/security test: header scan (security headers checker); CSP inline yo'q.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-34 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: header bo'lmasa yoki TLS 1.0 ochiq bo'lsa.
22. Done condition: security detail to'liq, testlar yashil, audit natijasi hujjatda.
23. D-35 uchun: final'ga tayyor ekanini dalil bilan yoz.
24. Security headers checkeri natijasi (A+ hedef) hujjatda saqlanadi.
25. HSTS preload ro'yxatiga kirish rejasi (agar production domain tayyor).
26. Cert renewal monitor: cert_expiry_days metric, 14 kun alert (D-06).
27. CSP report: report-only'dan enforce'ga o'tish bosqichi (test muhiti).
28. D-34 hisoboti operator tasdig'i bilan yopiladi.
```

## D-35 — Infra/Frontend/Test FINAL (D-faza release)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi (barcha infra/security).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: D-faza release — Infra/Frontend/Test/Ops/Legal to'liq regression, sign-off.
05. Precondition: D-29..D-34 yashil; D-00..D-28 yashil; ledger to'liq.
06. D-faza checklist: config/env (D-01), secrets (D-02), Redis (D-03), logging (D-04), trace (D-05), observability (D-06), frontend (login/register/MFA/passkey/settings/admin D-07..D-10), i18n (D-11), a11y (D-12), mobile (D-13), test framework (D-14), unit (D-15/16), integration (D-17), e2e+security (D-18), load (D-19), CI/CD (D-20), deploy (D-21), legal (D-22..D-26), DSAR, consent, incident — to'liq yashil.
07. Full regression (D): `npm test`, `npm run typecheck`, E2E, security, load natijalari.
08. Security regression: headers/CSP/TLS, PII, secret, private field, IDOR, XSS — nol critical.
09. Legal regression: DSAR, consent, retention, DPIA, hujjatlar — to'liq.
10. A11y regression: axe 0 critical; keyboard; focus.
11. i18n regression: 4 til to'liq; terminology bank.
12. Sign-off: security (header/secret/field), legal (DSAR/consent), ops (deploy/incident drill), operator.
13. Security/data guard: critical yashirilmaydi; P2/P3 E-fazaga.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: full D suite.
17. Integration/contract test: journey (frontend→API→DB→email→provider).
18. E2E/security test: full D E2E + security suite.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga D-35 (RELEASE) statusi, dalillar, sign-off va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: critical security yoki sign-off olinsa — RELEASE yo'q.
23. Done condition: D-faza release checklist to'liq, testlar yashil, sign-off imzolangan.
24. Qolgan P2/P3 ro'yxati (passkey extra, pen-test, red-team) — E-fazaga ko'chirilganini yoz.
25. Butun PROMPT_GUIDE_AUTH_D release'ga tayyor ekanini dalil bilan yoz.
26. Release snapshot: commit hash, test soni — E-faza preflight baseline.
27. Rollback rejasi: D-faza o'zgarishlari (migration, config, flag) bo'yicha.
28. D-faza release commit'i operator tasdig'i bilan yopiladi.
29. D-35 hisoboti operator tasdig'i bilan yopiladi.
```

## D-36 — Frontend extra: security badges, trust indicators

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: frontend extra — security badges, trust indicators.
05. Precondition: D-07 yashil bo'lishi kerak; login/register frontend tayyor.
06. Trust: "Ma'lumotlar UZ'da saqlanadi", "Argon2 shifrlash" (login/register pastki qismi) — haqiqiy va tekshiriladigan.
07. Security badge: "MFA yoqilgan", "Passkey mavjud" (settings D-09) — statusdan keladi, yolg'on emas.
08. Device badge: "Bu qurilma eslab qolindi" (C-03/C-18) — trusted device ko'rsatiladi.
09. Risk notice: suspicious login'da (A-09) — "Yangi qurilma — bu sizmisiz?" + yordam havolasi.
10. Verification badge: email verified ✓, teacher approved ✓ (B-07/B-16) — profil.
11. Security/data guard: badge'da secret yo'q; faqat true status; no false claim ("HEMIS bilan integratsiya" yozilmaydi — qoida 28).
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: badge render (true/false); status source.
15. Integration/contract test: trust device badge; MFA status.
16. E2E/security test: XSS; false badge emas (no claim without status).
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. A11y: badge icon+text (rangga bog'liq emas); screen reader.
19. i18n: badge matnlari 4 tilda (D-11).
20. `implementation-status-auth.md`ga D-36 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: badge secret bo'lsa yoki false claim bo'lsa.
23. Done condition: trust indicators to'liq, testlar yashil.
24. D-37 uchun: infra extra'ga tayyor ekanini dalil bilan yoz.
25. Badge'larda havola: "Ma'lumotlar UZ'da" → privacy policy (D-24).
26. Trust indicator'lar A/B test uchun flag'lanadi (D-21).
27. Badge matnlari copywriter review (universitar ton).
28. D-36 hisoboti operator tasdig'i bilan yopiladi.
```

## D-37 — Infra extra: migration strategy, data seed, env per-env

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: infra extra — migration strategy, seed, env per-env.
05. Precondition: D-01 yashil bo'lishi kerak; config/env schema tayyor.
06. Migration strategy: backward-compatible (20-rule), rollback (D-01/D-21); version'lar schema_migrations.
07. Migration testi: CI'da fresh DB'ga apply + rollback (D-20) — har PR'da.
08. Seed: dev user'lar (student, teacher_pending, teacher, admin) — `tests/fixtures` va dev seed; password dummy (Argon2 real).
09. Env per-env: dev/test/prod — env.example (D-01) placeholder; prod KMS (D-02); env'larni solishtirish testi.
10. Data version: schema_migrations jadvali; migration nomi timestamp.
11. Security/data guard: seed'da secret yo'q; prod seed EMAS (faqat dev/test); PII yo'q (synthetic).
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: migration apply; seed idempotent (ikki marta ishlasa duplicate yo'q).
15. Integration/contract test: fresh DB migration + seed + login (dev user).
16. E2E/security test: prod seed flag yo'q (grep); secret env.example'da yo'q.
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-auth.md`ga D-37 statusi va next readinessni yoz.
19. Global report formatida changed files, migration, command va test natijalarini qaytar.
20. Stop condition: rollback bo'lmasa yoki prod seed bo'lsa.
21. Done condition: infra extra to'liq, testlar yashil.
22. D-38 uchun: ops extra'ga tayyor ekanini dalil bilan yoz.
23. Migration fayllari nomi: `YYYYMMDDHHMM_name.sql` — tarix aniq.
24. Seed user parollar: test passwordlar faqat dev/test; prod'da yo'q.
25. Env farqlari testi: dev/test/prod env'lari teng (missing env fail-fast).
26. Rollback testi: har migration'ning down() ishlaydi (D-21 bilan).
27. Seed'da platform_admin hisobi alohida (birinchi login'da parol o'zgartirish majburiy).
28. D-37 hisoboti operator tasdig'i bilan yopiladi.
```

## D-38 — Ops extra: runbook drills, freeze window

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (ops).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: ops extra — runbook drills, release freeze window.
05. Precondition: D-21/26 yashil bo'lishi kerak; deploy va incident runbook tayyor.
06. Drills: deploy rollback, incident (credential leak, ATO), backup restore (C-15) — har oy staging'da (D-21/D-26 bilan).
07. Drill protokoli: scenario, owner, qadamlar, natija (o'tdi/o'tmadi), postmortem — jadval.
08. Release freeze: imtihon davri (7-14 kun) — auth o'zgarmaydi (faqat critical fix, flag bilan).
09. Change window: auth deploy — past trafik (tun, UZ vaqti); freeze ichida emas.
10. Security/data guard: freeze; drill; emergency fix yo'li (bypass freeze, sign-off).
11. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
12. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
13. Unit test: drill script (dry-run).
14. Integration/contract test: freeze kalendar logikasi; emergency path.
15. E2E/security test: drill simulyatsiya (staging).
16. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
17. `implementation-status-auth.md`ga D-38 statusi va next readinessni yoz.
18. Global report formatida changed files, migration, command va test natijalarini qaytar.
19. Stop condition: drill bo'lmasa yoki freeze bo'lmasa.
20. Done condition: ops extra to'liq, drill o'tgan.
21. D-39 uchun: legal extra'ga tayyor ekanini dalil bilan yoz.
22. Drill kalendar: har oy uchinchi hafta; natija jadvalda (o'tdi/o'tmadi).
23. Freeze davrlari: imtihon kalendaridan (semestr) avtomatik aniqlanadi.
24. Emergency fix yo'li: freeze ichida critical fix — sign-off + rollback rejasi.
25. Drill postmortem: har drilldan keyin 1 sahifa xulosa.
26. Freeze ichida ham monitoring/alert ishlaydi (D-06) — auth himoya to'xtamaydi.
27. Drill va freeze hujjatlari `docs/runbooks/` da saqlanadi — operator review.
28. D-38 hisoboti operator tasdig'i bilan yopiladi.
```

## D-39 — Legal extra: data map, retention policy doc

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (legal, retention).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: legal extra — data map, retention policy doc.
05. Precondition: D-22/25 yashil bo'lishi kerak; UZ law va consent tayyor.
06. Data map: har PII (email, telegram_id, hemis_id, JSHSHIR, fingerprint, audit) — manba, maqsad, saqlash, o'chirish, access.
07. Retention policy doc: jadval (C-14: session 7 kun, verify 15 daqiqa, audit 12 oy, login 12 oy...) — legal review.
08. Data flow diagram: auth PII oqimi (UZ'da) — register→DB→email provider→backup; qayerda, qancha.
09. Access matrix: kim qaysi PII'ga kirishi mumkin (C-20 RBAC bilan mos).
10. Security/data guard: map to'liq; legal; access minimal.
11. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
12. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
13. Unit test: data map schema valid; retention policy jadval konsistent (C-14 bilan).
14. Integration/contract test: retention purge C-14 bilan mos (to'liq emas — tekshiruv).
15. E2E/security test: data flow (PII qaerga ketadi) tekshiruv.
16. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
17. `implementation-status-auth.md`ga D-39 statusi va next readinessni yoz.
18. Global report formatida changed files, migration, command va test natijalarini qaytar.
19. Stop condition: map bo'lmasa yoki retention mos emas bo'lsa.
20. Done condition: legal extra to'liq, hujjatlar legal review o'tgan.
21. D-40 uchun: ultimate qabulga tayyor ekanini dalil bilan yoz.
22. Data map'da har PII uchun manba (forma, provider, HEMIS) ko'rsatiladi.
23. Retention policy doc C-14 config'idan avtomatik tekshiriladi (konsistensiya testi).
24. Data flow diagram: external provider'larga (email, KMS) nima ketadi — aniq.
25. Access matrix C-20 RBAC bilan mosligi testi (bir xil rol nomlari).
26. Data map DSAR (D-23) bilan bog'lanadi: eksport har PII'ni qamraydi (checklist).
27. Data map va retention hujjatlari `docs/legal/` da saqlanadi — operator review.
28. D-39 hisoboti operator tasdig'i bilan yopiladi.
```

## D-40 — Infra/Frontend/Test ULTIMATE (D-faza yakuniy)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini va `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: D-faza ultimate qabul — hamma D bosqichlari global darajada tasdiqlanadi.
05. Precondition: D-36..D-39 yashil; D-00..D-35 yashil; E-faza uchun ready.
06. D-faza ultimate checklist: infra (config, secrets, Redis, logging, trace, observability), frontend (login/register/MFA/passkey/settings/admin/i18n/a11y/mobile), test (framework/unit/integration/e2e/security/load), ops (CI/CD, deploy, incident, drills, freeze), legal (DSAR, consent, DPIA, data map, retention) — to'liq, global daraja.
07. Full regression (D): `npm test`, typecheck, E2E, security, load, mutation.
08. Security sign-off: headers/CSP/TLS, secret, private field, IDOR, XSS — nol critical.
09. Legal sign-off: DSAR, consent, retention, DPIA, data map — to'liq.
10. Ops sign-off: deploy/incident/backup drill natijalari, freeze kalendar — to'liq.
11. Product sign-off: frontend UX, i18n 4 til, a11y, mobile — operator checklist.
12. Security/data guard: critical yashirilmaydi; PII minimal (UZ, DSAR); P2/P3 E-fazaga.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: full D suite (muhim path 100%).
16. Integration/contract test: full journey (frontend→API→DB→email→provider→audit).
17. E2E/security test: full D E2E + security scenarios.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga D-40 (ULTIMATE) statusi, dalillar, sign-off va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: critical security yoki sign-off olinsa — ULTIMATE yo'q.
22. Done condition: D-faza ultimate checklist to'liq, testlar yashil, sign-off imzolangan.
23. Ultimate snapshot: commit hash, test soni, metriclar (coverage, load) — E-faza baseline.
24. Butun PROMPT_GUIDE_AUTH_D yakunlandi — E-00 preflight'ga tayyor ekanini dalil bilan yoz.
25. Operator yakuniy tasdig'i: D-faza yopiladi, E-faza ochiladi — yozma tasdiq talab qilinadi.
26. Ultimate snapshot: commit hash, test soni, metriclar (coverage, load, mutation) — E-faza baseline.
27. Butun PROMPT_GUIDE_AUTH_D (41 prompt) yopilganligi operatorga tasdiqlanadi.
28. E-00 preflight'ga tayyor ekanini dalil bilan yoz.
```

