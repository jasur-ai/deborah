# Edikit Auth — C-Faza: Risk + Admin + Integration (C-00..C-45)

> **Maqsad:** Risk-based auth, admin/backoffice, HEMIS/OneID/OpenData integratsiya — global gigant darajasida.
> **Qo'llash:** B-faza (B-26 checkpoint) tugagach C-00 dan boshlanadi.

---

## C-00 — Risk/Admin/Integration preflight

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7, 13, 14-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Risk/Admin/Integration qismini qurishdan oldin inventarizatsiya va baseline yaratish (kod o'zgartirilmaydi).
05. Precondition: B-26 yashil bo'lishi kerak; B-faza sign-off imzolangan.
06. Kod yozishdan oldin `middleware/rate-limit.js`, `src/modules/auth/risk.js` (agar bor), admin routes, HEMIS adapter (agar bor) fayllarini tekshir.
07. Hozirgi rate limit holatini inventarizatsiya qil: per-IP/account/ASN qoidalari, Redis ishlatilishi, 429 handling.
08. Turnstile mavjudligi (B-08) va Cloudflare proxy sozlamasini tekshir — IP trust proxy to'g'rimi.
09. Admin panel holati (dashboard, user manage, teacher approve) — qaysi funksiya bor, qaysi yo'q.
10. HEMIS adapter holati (A-15/C-10 rejasi) — BLOCKED yoki active, OTM client mavjudmi.
11. Device fingerprint (C-03) — hozirgi holat: bor/yo'q, qaysi signal saqlanadi.
12. Test holati o'lcha: `npm test`, `npm run typecheck` — baseline soni.
13. Security/data guard: secret logga chiqmasin; `.git/config`ga tegma; `git status` toza.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (mavjud bo'lsa).
16. Unit test: existing start command smoke test.
17. Integration/contract test: existing auth/risk route smoke test.
18. E2E/security test: workspace'da kutilmagan generated file yo'qligi.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga C-00 statusi, dalillar va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: baseline ishga tushmasa yoki dirty repo bo'lsa.
23. Done condition: baseline, blockerlar, test natijalari va C-01 readiness yozilgan.
24. C-01 uchun tavsiya: rate limit config to'liq — yoz.
25. Hech qanday kod o'zgartirmasdan yakunla; faqat hisobot bering.
26. Baseline snapshot (commit, test soni) saqlanadi — C-faza oxirida taqqoslanadi.
27. Risk/Admin/Integration fayllari ro'yxati jadvalini yoz.
28. C-01 boshlashga tayyor ekanini dalil bilan yoz.
```

## C-01 — Rate limit config to'liq (har endpoint)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: barcha auth endpointlar uchun rate limit config jadvalini qurish.
05. Precondition: C-00 yashil bo'lishi kerak.
06. `src/config/rate-limits.js` — jadval:
   - POST /user/login: per-IP 5/15 daqiqa → 5 daqiqa lockout; per-account 10/15; per-ASN 100/15.
   - POST /user/register: per-IP 5/15; per-ASN 50/15; Turnstile.
   - POST /api/verify/send: per-user 3/soat; per-IP 10/soat.
   - POST /api/verify/check: per-user 5/15 → 15 daqiqa lockout.
   - POST /api/reset/*: per-account 3/soat; per-IP 10/soat; Turnstile.
   - POST /auth/google: 10/15 daqiqa.
   - POST /api/mfa/*: 5/15 → lockout.
   - POST /passkey/*: 10/15.
   - POST /auth/telegram/*: 5/15.
   - POST /admin/teachers/*: 20/15 (admin).
   - POST /api/roster/*: 10/15 (teacher).
07. Implementatsiya: sliding-window + token-bucket (Redis) — burst qarshi.
08. Kampus NAT: per-IP yumshoq, per-account qattiq, per-ASN o'rta.
09. Jitter: login xatosida random delay (100-500ms).
10. 429 response: Retry-After + error code RATE_LIMITED.
11. Header'lar: X-RateLimit-Limit/Remaining/Reset (client transparanlik).
12. `middleware/rate-limit.js` refactor: config'dan o'qiydi.
13. Audit: rate_limit_hit (endpoint, tier).
14. Security/data guard: IP spoof qarshi trust proxy; per-account asosiy.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: har endpoint limit; sliding window; token bucket.
18. Integration/contract test: burst; distributed (turli IP — per-ASN).
19. E2E/security test: NAT false-positive yo'q; bypass emas.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga C-01 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: endpoint limitsiz yoki bypass ochiq bo'lsa.
24. Done condition: rate limit to'liq, testlar yashil.
25. C-02 uchun: lockout state machine'ga tayyor.
26. Config per-tenant (P2).
27. Redis atomic (INCR + EXPIRE).
28. Barcha write path audit bilan.
```

## C-02 — Lockout state machine (to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: lockout state machine'ni to'liq qurish — fail counter, lockout, release, reset.
05. Precondition: C-01 yashil bo'lishi kerak.
06. State: active → N-fail → locked (5 daqiqa) → active (release) | permanent (admin).
07. users.failed_attempts + locked_until; counter per-account + per-IP.
08. Lockout: 5 xato (login) → 5 daqiqa; 10 → 15 daqiqa; 20 → 1 soat + "support" (progressive).
09. Reset: muvaffaqiyatli login'da counter=0; support manual unlock (audit).
10. Permanent lock: admin blok (users.status=blocked) — support qaror.
11. Progressive penalty: har blokdan keyin uzayadi (5→15→60 daqiqa).
12. Audit: lockout_triggered, lockout_released, account_blocked.
13. UX: "5 daqiqadan keyin qayta urinib ko'ring" + countdown + support link.
14. A11y: countdown live-region.
15. Mobile: bir xil.
16. 4 til: lockout stringlar.
17. Security/data guard: lockout server-side; bypass yo'q (per-account).
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
20. Unit test: progressive; release; reset; permanent.
21. Integration/contract test: 5→5 daqiqa; 10→15; success reset.
22. E2E/security test: bypass (turli IP) — per-account tutadi; DoS (false lockout) — NAT e'tibor.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga C-02 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: progressive bo'lmasa yoki bypass ochiq bo'lsa.
27. Done condition: lockout to'liq, testlar yashil.
28. C-03 uchun: device fingerprint'ga tayyor.
29. Support unlock audit bilan.
30. Barcha write path CSRF + audit bilan.
```

## C-03 — Device fingerprint schema + integration

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini (fingerprint) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: device fingerprint tizimini qurish — client collect, hash, user_devices.
05. Precondition: C-02 yashil bo'lishi kerak.
06. Client: FingerprintJS (open source) — `public/js/fingerprint.js`: FP ID + components (canvas, WebGL, UA, plugins) → server'ga hash.
07. `user_devices` jadvali (B-02): user_id, fingerprint_hash, first_seen, last_seen, trusted, risk_events JSONB, created_at.
08. POST /api/device/register (login'da): fingerprint_hash yuborish → user_devices upsert (first_seen).
09. Trusted flow: yangi device → "Bu qurilmani eslab qolish?" (user confirm) → trusted=true; remember-me selector bilan bog'lash.
10. Privacy (majburiy): fingerprint hash (raw components server'da emas); security purpose; UZ saqlash; DSAR; retention 12 oy.
11. Audit: device_registered, device_trusted.
12. A11y: trust prompt keyboard.
13. Mobile: bir xil.
14. 4 til: device stringlar.
15. Security/data guard: hash deterministik; raw telemetry yo'q; probabilistic signal (identity dalili emas).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: hash; upsert; trusted.
19. Integration/contract test: login → device register; trust flow.
20. E2E/security test: raw components log'da yo'q (grep); spoof (client hash) — server signals qo'shimcha.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga C-03 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: raw telemetry saqlansa yoki hash bo'lmasa.
25. Done condition: fingerprint to'liq, testlar yashil.
26. C-04 uchun: risk score service'ga tayyor.
27. FingerprintJS licences (oss) tekshiriladi.
28. Browser privacy (Safari ITP) — fallback UA hash.
29. Barcha write path CSRF + audit bilan.
```

## C-04 — Risk score service

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: risk score service'ni qurish — signals → score 0-1 → tiers.
05. Precondition: C-03 fingerprint yashil bo'lishi kerak.
06. `src/modules/auth/risk.js`:
   - score = f(new_device, impossible_travel, velocity, vpn_proxy, bot, dev_tools, trusted, account_age).
   - Weight'lar: new_device +0.3, impossible_travel +0.5, velocity +0.4, vpn_proxy +0.3, bot +0.6, dev_tools +0.2, trusted -0.4, account_age<7d +0.2.
07. Tiers: <0.3 trusted (seamless); 0.3-0.7 unknown (step-up MFA/CAPTCHA); >0.7 suspicious (block + alert).
08. Server-side signals: impossible travel (geo+ts), velocity (Redis counter), bot (Turnstile), trusted (user_devices).
09. Client signals: fingerprint hash (C-03), dev_tools flag.
10. `risk_events` JSONB: har signal log (hash, raw emas).
11. Threshold'lar config'da (tenant sozlashi); tuning log (12-24 oy).
12. Response: middleware `requireLowRisk` → allow/stepup/block; step-up → MFA challenge (A-26).
13. Audit: risk_scored (score, tier), risk_stepup, risk_blocked.
14. A11y: step-up accessible.
15. Mobile: bir xil.
16. Security/data guard: probabilistic — yagona qaror emas; false-positive'da support; privacy.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: score hisoblash; tiers; weight'lar.
20. Integration/contract test: yangi device → step-up; trusted → seamless; high → block.
21. E2E/security test: threshold bypass; false-positive support; spoof.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga C-04 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: score yagona qaror bo'lsa yoki threshold bo'lmasa.
26. Done condition: risk score to'liq, testlar yashil.
27. C-05 uchun: impossible travel'ga tayyor.
28. ML (P3) — BKT style, interpretable.
29. Threshold'lar per-role (admin qattiq).
30. Barcha write path audit bilan.
```

## C-05 — Impossible travel + velocity detection

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi (risk signals, impossible travel, velocity).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: impossible travel va velocity detection'ni server-side qurish.
05. Precondition: C-04 risk service yashil bo'lishi kerak; risk.js signal interfeysi tayyor.
06. Impossible travel: login'da IP → geo (lokal DB, city-level); oxirgi login geo+ts bilan solishtirish: masofa/vaqt > 800 km/soat → flag (C-04 signal).
07. Geo DB: lokal (MaxMind GeoLite2 yoki o'z DB) — tashqi API EMAS (UZ privacy, offline ishlash); yillik yangilanish (C-24).
08. Timezone mosligi: user Asia/Tashkent; geo hisobda shahar + timezone; server ts yagona manba (client ts ishonmaydi).
09. Velocity (Redis): 10 daqiqa ichida bir device ko'p IP/country; bir IP'da ko'p account fail (credential stuffing); bir account ko'p device.
10. Signal mapping: impossible_travel +0.5, velocity +0.4 (C-04) — weight'lar config'da.
11. Threshold'lar: masofa/vaqt chegarasi config; velocity count (3+ hodisa) config; qiymatlar env.
12. Audit: impossible_travel_detected, velocity_detected (user_hash, geo, ts) — raw geo yo'q.
13. Response: score'ga qarab step-up MFA (A-26) yoki blok (high) — user xabari aniq, yordam havolasi.
14. False-positive: VPN/kampus NAT (C-19) — step-up'da MFA orqali o'tish imkoni, support contact.
15. Security/data guard: geo PII minimal (city), UZ'da saqlash, DSAR; client clock ishonmaydi (server ts).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: masofa/vaqt hisobi; velocity pattern; threshold; timezone.
19. Integration/contract test: 10 daqiqada 2 shahar → flag; stuffing pattern → flag; VPN false-positive → step-up.
20. E2E/security test: client ts forge — server ts ishlatilishi; block UX; support flow.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. Observability: impossible_travel_count, velocity_count, stepup_from_risk rate (D-06 bilan).
23. `implementation-status-auth.md`ga C-05 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: client ts trusted bo'lsa yoki geo tashqi API'da bo'lsa.
26. Done condition: impossible travel + velocity ishlaydi, testlar yashil, signallar C-04'ga ulanadi.
27. C-06 uchun: credential stuffing detection'ga tayyor ekanini dalil bilan yoz.
28. GeoLite2 litsenziya (CC BY-SA) hujjatlashtiriladi; UZ'da hosting — geo DB lokal.
```

## C-06 — Credential stuffing + OTP bombing detection

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: credential stuffing va OTP bombing detection'ni qurish.
05. Precondition: C-05 yashil bo'lishi kerak.
06. Credential stuffing detection:
   - Bir IP/ASN'da ko'p account'da fail (10+ fail / 15 daqiqa) → flag.
   - Bir parol ko'p username'da (password spray) → flag.
   - Bir device ko'p account (fingerprint) → flag.
   - Rate limit per-ASN (C-01) asosiy + detection alert.
07. OTP bombing:
   - /api/verify/send va /api/mfa/* send'da per-user 3/soat; per-IP 10/soat.
   - Bir email'ga ko'p kod → flag + admin alert.
   - Turnstile yuqori xavfda.
08. `src/modules/auth/abuse.js` — Redis counters + alert rules.
09. Response: block (high), Turnstile challenge (medium), alert (low).
10. Admin dashboard (C-20): abuse events ro'yxati.
11. Audit: stuffing_detected, otp_bomb_detected, abuse_blocked.
12. Security/data guard: parol hech qachon log'da; faqat pattern.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: stuffing pattern; spray; OTP bomb.
16. Integration/contract test: 10 fail turli account → flag; send 10 → blok.
17. E2E/security test: distributed (ASN); false-positive NAT.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga C-06 statusi va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: pattern detection bo'lmasa.
22. Done condition: stuffing + bomb detection, testlar yashil.
23. C-07 uchun: admin auth'ga tayyor.
24. Alert kanallari: admin email/Telegram.
25. Redis counters TTL (15 daqiqa).
```

## C-07 — Admin auth (alohida session + Strict)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin auth'ni alohida qurish — Strict session, MFA mandatory, IP allowlist.
05. Precondition: C-06 yashil bo'lishi kerak.
06. Admin login alohida (`/admin/login`, A-fazada mavjud) — CONFIG credential + DB admin role.
07. Admin session: **SameSite=Strict**, `__Host-` cookie, qisqa Max-Age (8 soat), remember-me YO'Q.
08. **MFA mandatory** admin (A-26): TOTP/passkey login'da majburiy (skip yo'q).
09. Admin rate limit qattiq: 3 xato → 15 daqiqa; Turnstile har doim.
10. IP allowlist (ixtiyoriy, config): admin faqat allowlist IP'laridan (OTM konteksti).
11. Admin session user session'dan AYRILADI (role switch'da regenerate).
12. Admin login audit: har bir amal (kim, qachon, IP hash, amal).
13. Admin account security: password/email change → email+Telegram; breach → forced reset.
14. Suspicious admin login (risk high) → block + super-admin alert.
15. A11y: admin login accessible.
16. Mobile: admin panel responsive (ishlatish mumkin).
17. 4 til: admin stringlar.
18. Security/data guard: admin credential logga yo'q; MFA bypass yo'q.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (admin_mfa_required, admin_login).
21. Unit test: Strict cookie; MFA mandatory; IP allowlist.
22. Integration/contract test: admin login MFA'siz blok; role switch.
23. E2E/security test: MFA bypass, Strict, IDOR, suspicious.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga C-07 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: MFA mandatory bo'lmasa yoki Strict bo'lmasa.
28. Done condition: admin auth to'liq, testlar yashil.
29. C-08 uchun: user management'ga tayyor.
30. Admin role CONFIG + DB.
```

## C-08 — User management (admin panel)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin user management panelini qurish — ro'yxat, qidiruv, status, revoke.
05. Precondition: C-07 admin auth yashil bo'lishi kerak.
06. `views/admin/users.ejs` yarat: ro'yxat (ism, username, email, rol, status, sana), qidiruv (username/email), filter (rol/status), pagination.
07. Har user: [Ko'rish] (profil, sessiyalar, audit), [Bloklash]/[Aktivlash], [Rol o'zgartirish] (admin only), [Barcha sessiyalarni yakunlash].
08. Bloklash: users.status=blocked → barcha sessiyalar revoke; login blok; audit account_blocked (admin_id).
09. Aktivlash: status=active → login qayta; audit.
10. Rol o'zgartirish: student↔teacher (admin) — session regenerate; audit role_changed.
11. Barcha sessiyalarni yakunlash: revokeByUser (B-25) — "user qayta kiring".
12. Audit: user_managed (admin_id, action, target).
13. A11y: ro'yxat keyboard; 44px.
14. Mobile: responsive.
15. 4 til: admin users stringlar.
16. Security/data guard: faqat admin (requireRole); IDOR; blok audit.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: blok/aktiv; rol change; revoke.
20. Integration/contract test: blok→401; aktiv→login; rol→session regenerate.
21. E2E/security test: non-admin blok; IDOR; XSS.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga C-08 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: non-admin manage qila olsa yoki blok audit bo'lmasa.
26. Done condition: user management to'liq, testlar yashil.
27. C-09 uchun: audit dashboard'ga tayyor.
28. User PII minimal (email admin'ga ko'rinadi).
29. Blok sabab majburiy.
```

## C-09 — Audit dashboard + security reports (admin)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: audit dashboard va security reports'ni qurish (auth_audit asosida).
05. Precondition: C-08 yashil bo'lishi kerak.
06. `views/admin/audit.ejs` yarat: auth_audit ro'yxati — filter (action, method, outcome, vaqt), qidiruv, pagination.
07. Aggregate'lar: login success/fail rate, lockout soni, teacher arizalar, risk block, HIBP hit, abuse events.
08. Charts: vaqt bo'yicha (login, fail, lockout, block) — accessible (matn alternativ).
09. Security reports: eksport CSV (PII minimal, hash'lar).
10. Alert'lar: threshold oshsa (fail spike) → admin email/Telegram.
11. Retention: 30 kun (purge job C-14); eksport 30 kun ichida.
12. A11y: charts matn; keyboard.
13. Mobile: responsive.
14. 4 til: audit stringlar.
15. Security/data guard: audit'da parol/token/OTP yo'q (grep test); PII minimal.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: aggregate; filter; eksport.
19. Integration/contract test: audit data → dashboard; alert.
20. E2E/security test: audit PII scan; IDOR.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga C-09 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: audit'da PII bo'lsa yoki dashboard bo'lmasa.
25. Done condition: audit dashboard to'liq, testlar yashil.
26. C-10 uchun: HEMIS integratsiyaga tayyor.
27. Retention purge C-14'da.
28. Alert threshold config'da.
```

## C-10 — HEMIS OAuth2 adapter (to'liq, OTM client bilan)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md` 2.2A, 3.1-bo'limlarini va `research_auth.md` 8-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: HEMIS OAuth2 adapter'ni to'liq qurish (OTM client mavjud bo'lsa).
05. Precondition: A-15 skeleton yashil; **OTM HEMIS panelida client yaratgan** (client_id+secret+redirect); aks holda BLOCKED.
06. `src/modules/auth/providers/hemis.js` — endpointlar (hemis-oauth namunasidan):
   - authorize: `student.hemis.uz/oauth/authorize`
   - token: `student.hemis.uz/oauth/access-token`
   - user: `student.hemis.uz/oauth/api/user?fields=...`
07. Fields (Zod): id, uuid, university_id, type, firstname, surname, patronymic, login, picture, email, phone, birth_date.
08. OAuth2 authorization_code: state 32B, exact redirect, token exchange client_secret (KMS).
09. PKCE qo'llab-quvvatlansa — S256 (OAuth 2.1 qoidasi); tekshiriladi.
10. Geofence (majburiy): HEMIS faqat UZ IP — server UZ'da yoki proxy; xorijiy server → 451.
11. Mapping: users.hemis_id UNIQUE; email verified sharti; yangi → account (rol tanlash).
12. Session regenerate; redirect role bo'yicha; audit (auth.hemis).
13. Login UI: "HEMIS bilan kirish" — faqat client ishga tushganda.
14. Client credential KMS; redirect allowlist; rate limit 10/15.
15. Security/data guard: hemis token boshqa provider uchun emas; IDOR; geofence.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: adapter mock; fields schema; state.
19. Integration/contract test: live (test OTM) authorize→token→user; mapping; replay.
20. E2E/security test: token leak; IDOR; escalation; geofence.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga C-10 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: OTM client bo'lmasa (BLOCKED) yoki geofence bo'lmasa.
25. Done condition: HEMIS adapter to'liq, testlar yashil.
26. C-11 uchun: HEMIS roster import'ga tayyor.
27. Provider terms tekshiriladi.
28. GitHub client_id=8 production'da ishlatilmaydi — OTM yangi.
29. Barcha write path CSRF + audit bilan.
```

## C-11 — HEMIS roster import (Excel, xavfsiz) — to'liq

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: HEMIS Excel roster import'ini to'liq qurish — upload, staging, mapping, commit, rollback, invite.
05. Precondition: A-10/11 skeleton yashil bo'lishi kerak.
06. Upload: stream/pre-signed; MIME+magic bytes; size/row/sheet limit; zip ratio; formula execute YO'Q (parser qiymat o'qiydi); macro YO'Q.
07. HEMIS format: jamlanma qaydnoma, talabalar bazasi — kolonkalar mapping (student_id, ism, guruh, kurs, fan, email, phone).
08. Parser: staging rows (production emas); Unicode/name normalizatsiya (UZ apostroflar).
09. Mapping UI: column → field; required/duplicate validator.
10. Diff: create/update/deactivate preview; admin approval.
11. Commit: transactional (users+enrollments+invites); idempotent (qayta yuklash duplicate emas).
12. Rollback: snapshot/compensating import.
13. Invite: har talabaga token (B-11); email/Telegram.
14. Reconciliation: commit'dan keyin count tekshirish.
15. Row-level error report (export).
16. Audit: roster_uploaded, roster_commit, invite_created.
17. A11y: import UI keyboard.
18. Mobile: upload mumkin (view).
19. 4 til: roster stringlar.
20. Security/data guard: formula/zip-bomb; staging 24 soat purge; PII minimal.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
23. Unit test: parser; mapping; diff; idempotency; formula.
24. Integration/contract test: HEMIS fayl → staging → commit → rollback; invite.
25. E2E/security test: zip-bomb; macro; malicious file; IDOR.
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga C-11 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: formula/zip-bomb ochiq bo'lsa yoki commit atomik bo'lmasa.
30. Done condition: roster import to'liq, testlar yashil.
31. C-12 uchun: OneID research'ga tayyor.
32. CSV encoding: UTF-8 BOM, cp1251 (rus).
33. Antivirus/quarantine worker (agar).
```

## C-12 — OneID research + integratsiya reja (P3)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3-bo'limini (OneID) va `hemis_github.md`'dagi davlat tizimlari qaydlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: OneID integratsiya imkoniyatini rasmiy research qilish va (shartnoma bo'lsa) adapter rejasi tayyorlash.
05. Precondition: C-10 HEMIS yashil bo'lishi kerak; OTM OAuth2 tartibi tushunilgan.
06. RESEARCH (tadqiqot): Raqamli hukumat markaziga (id.egov.uz) rasmiy so'rov — xususiy ta'lim platformasi uchun integratsiya tartibi, OIDC mavjudligi, talablar, consent modeli, xarajat.
07. Topilmalarni hujjatlashtirish: auth usullari (login/parol, Mobile-ID, ERI, biometrik, QR), 2026 consent modeli (qulf tizimi), minimal data ro'yxati (JSHSHIR, FIO, tug'ilgan sana).
08. SHARTNOMA bo'lmasa — BLOCKED: faqat research + reja hujjati; kod yozilmaydi (qoida).
09. Shartnoma bo'lsa — adapter reja: OIDC flow (Google pattern, A-07 asos), JSHSHIR → users mapping, consent UI "OneID orqali kirish — [x] ma'lumotlar almashiladi", SLO (logout).
10. Geofence: OneID/davlat tizimlari UZ IP — server UZ'da yoki UZ proxy; xorijiy serverdan 451.
11. JSHSHIR PII: UZ saqlash, minimal, encryption at rest, DSAR; JSHSHIR hech qachon log/preview'da emas.
12. Audit: oneid_login, oneid_consent_granted/revoked, oneid_error (user_hash bilan, raw JSHSHIR emas).
13. Security/data guard: JSHSHIR yuqori PII; consent aniq va bekor qilinadigan; scraping/parol saqlash YO'Q.
14. Fallback: OneID'siz Google/parol/Telegram login ishlayveradi (OneID qo'shimcha, yagona emas).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (agar adapter bo'lsa).
17. Unit test: (agar adapter) mock OIDC flow; mapping; consent persist.
18. Integration/contract test: (agar adapter) live sandbox (RHM test muhiti).
19. E2E/security test: (agar adapter) consent UX, IDOR, SLO.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga C-12 statusi (BLOCKED/deferred) va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: shartnoma bo'lmasa — BLOCKED (faqat reja); kod yo'q.
24. Done condition: research + reja hujjati tayyor; integratsiya shartnoma shartida.
25. C-13 uchun: ochiq ma'lumotlar'ga tayyor ekanini dalil bilan yoz.
26. OneID consent UX — foydalanuvchi "qulf"ni ochishi kerak; consent log audit'da (D-25 bilan).
27. Reja hujjati `implementation-status-auth.md`ga biriktiriladi (OneID_reja bo'limi).
28. OneID integratsiya kiritilguncha Google/parol/Telegram login to'liq ishlaydi — fallback hujjatlashtiriladi.
```

## C-13 — Ochiq ma'lumotlar (OTM stats, diplom.edu.uz)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: ochiq ma'lumotlar integratsiyasini qurish — data.gov.uz OTM stats, diplom.edu.uz tekshirish.
05. Precondition: C-12 yashil bo'lishi kerak.
06. `src/modules/opendata/universities.js`: data.gov.uz dataset 14037 fetch → normalize → cache (Redis 24 soat).
07. OTM stats: nomi (uz/ru), bakalavriat/magistratura soni — landing stats (haqiqiy).
08. Cache + scheduled refresh (semestr); failure → eski cache.
09. License: ochiq ma'lumotlar litsenziyasi hurmat; manba ko'rsatish.
10. `diplom.edu.uz` tekshirish (P3): portfolio'da "Tekshirilgan ✓" — talaba o'zi tekshiradi (OneID orqali).
11. Geofence: diplom.edu.uz faqat UZ IP (451) — foydalanuvchi brauzeridan (server emas).
12. SSRF qarshi: fetch allowlist domain.
13. Audit: opendata_refresh, diploma_verified.
14. A11y: stats accessible.
15. Mobile: stats view.
16. 4 til: opendata stringlar.
17. Security/data guard: ochiq ma'lumotlar — PII yo'q; SSRF qarshi.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
20. Unit test: parser; normalize; cache; SSRF.
21. Integration/contract test: fetch→stats; diploma flow.
22. E2E/security test: yolg'on raqam yo'q (grep); SSRF.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga C-13 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: yolg'on stats yoki SSRF ochiq bo'lsa.
27. Done condition: ochiq ma'lumotlar to'liq, testlar yashil.
28. C-14 uchun: retention/purge'ga tayyor.
29. Dataset o'zgarsa schema version.
30. UZ server/proxy geofence uchun.
```

## C-14 — Data retention + purge jobs (auth)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth data retention va purge job'larini qurish (UZ data law).
05. Precondition: C-13 yashil bo'lishi kerak.
06. Retention jadvali:
   - auth_audit: 30 kun.
   - email_log: 30 kun.
   - verification_codes: 24 soat.
   - reset_tokens: 24 soat.
   - risk_events: 12 oy.
   - user_devices: 12 oy (harakatsiz).
   - mfa_backup_codes: MFA o'chganda.
   - invites: 90 kun (revoked).
   - users: active (DSAR o'chirishgacha).
07. `src/modules/auth/purge.js` (scheduled, idempotent): har jadval uchun purge query; log.
08. Legal hold: users.legal_hold flag — purge'da o'tkazib yuboriladi (Prompt 65).
09. Audit: purge_run (counts).
10. Alert: purge fail → ops.
11. Security/data guard: purge soft (log) + hard (DSAR); legal hold fail-open emas.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: retention hisoblash; legal hold.
15. Integration/contract test: purge job; DSAR delete.
16. E2E/security test: legal hold'da purge emas; derived copy (cache) purge.
17. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
18. `implementation-status-auth.md`ga C-14 statusi va next readinessni yoz.
19. Global report formatida changed files, migration, command va test natijalarini qaytar.
20. Stop condition: retention bo'lmasa yoki legal hold bo'lmasa.
21. Done condition: retention/purge to'liq, testlar yashil.
22. C-15 uchun: backup/DR'ga tayyor.
23. Derived copies (cache, search) ham purge.
24. Retention config'da.
```

## C-15 — Auth data backup + DR (recovery)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi (audit/backup qoidalari).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth data backup va disaster recovery'ni qurish (RPO/RTO aniq).
05. Precondition: C-14 yashil bo'lishi kerak; retention/purge ishlayapti.
06. PostgreSQL backup: PITR (WAL archiving), daily full + hourly WAL; retention 30 kun; auth jadvallari (users, sessions, credentials) alohida.
07. Redis backup: RDB snapshot + AOF; session yo'qolsa — re-login (asosiy ma'lumot emas); rate-limit counter qayta tiklanadi.
08. KMS secrets: KMS managed (D-02) — backup qilmaymiz, KMS redundancy provider'da.
09. Restore drill: har oy test muhitida — restore + verify (login, session, MFA, parol hash integrity).
10. RPO: 1 soat (WAL); RTO: 4 soat (auth critical) — o'lchov va hujjat.
11. Recovery runbook: kim, qachon, qanday qadamlar — `docs/runbooks/auth-recovery.md`; drill'da sinovdan o'tadi.
12. Encrypted backup: AES-256, KMS key; UZ'da saqlash (data law); backup'da ham PII himoya.
13. Cross-region (ixtiyoriy, P2): UZ region'da secondary — masofa cheklovlari uchun.
14. Audit: backup_run, backup_failed, restore_drill, restore_verify (operator sign-off).
15. Security/data guard: backup encrypted; PII backup'da ham himoya; backup access minimal (2 kishi).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: backup config validatsiya; retention qoidasi.
19. Integration/contract test: restore drill (fresh DB) — login, session, MFA to'liq ishlaydi.
20. E2E/security test: restore'dan keyin login; data integrity (checksum); encrypted backup tekshiruvi.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. Observability: backup_age gauge, restore_drill_count, backup_failed alert (D-06).
23. `implementation-status-auth.md`ga C-15 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: restore drill o'tkazilmagan bo'lsa — DR tasdiqlanmaydi.
26. Done condition: backup/DR to'liq, restore drill o'tgan, testlar yashil.
27. C-16 uchun: C-faza checkpoint'ga tayyor ekanini dalil bilan yoz.
28. Backup UZ region'da; rollback rejasi hujjatlashtiriladi.
```

## C-16 — C-Faza checkpoint sign-off (Risk+Admin+Integration)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 7, 8, 9, 10-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: C-faza mustaqil sertifikatlash.
05. Precondition: C-00..C-15 yashil bo'lishi kerak.
06. CHECKPOINT audit:
07. Rate limit: har endpoint; sliding-window; per-ASN; jitter; 429 headers.
08. Lockout: progressive; release; permanent; bypass yo'q.
09. Device fingerprint: hash; trusted; privacy (raw yo'q).
10. Risk: score 0-1; tiers; impossible travel; velocity; stuffing/bomb detection; step-up.
11. Admin: alohida session Strict; MFA mandatory; IP allowlist; user management; audit dashboard.
12. HEMIS: OAuth2 adapter (OTM client); geofence; roster import xavfsiz; secret KMS.
13. OneID: research + reja (shartnoma sharti).
14. Open data: OTM stats; diplom.edu.uz; SSRF qarshi.
15. Retention/purge; legal hold; backup/DR (restore drill).
16. Secret scan: HEMIS client_id=8 production'da yo'q; provider key'lar KMS; parol/token/OTP log'da yo'q.
17. Geofence hujjati (451 testlari).
18. A11y: axe 0 critical; keyboard.
19. Security/data guard: bironta critical finding yashirilmasin.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
22. Unit test: full C suite.
23. Integration/contract test: risk→step-up; admin manage; HEMIS flow.
24. E2E/security test: barcha security testlar.
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. `implementation-status-auth.md`ga C-16 (CHECKPOINT) statusi yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: critical/high blocker qolsa.
29. Done condition: C-faza to'liq; D-faza ochiladi.
30. Operator review va sign-off; residual risk.
```

## C-17 — Risk detail: signal aggregation + score interpretation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi (risk signals, aggregation, tiers).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: risk signal aggregation va score interpretation'ni chuqurlashtirish.
05. Precondition: C-04/05/06 yashil bo'lishi kerak; signallar risk.js'ga ulanadi.
06. Aggregation: har signal weight'li yig'indi; log'da faqat hash (raw signal emas) (C-04); yig'indi config'da.
07. Interpretation: score → action (seamless <0.3 / stepup 0.3-0.7 / block >0.7) (C-04) — chegaralar config.
08. Confidence: signal soni — 1 signal past confidence (step-up), 3+ yuqori (block mumkin); confidence C-04'ga qo'shiladi.
09. Per-role threshold: admin/teacher qattiq (C-04) — rol bo'yicha config, e'lon qilinadi.
10. History: user risk trend — yangi (birinchi marta) vs doimiy (pattern); trend API/audit.
11. Time decay: eski signal kamayadi (masalan 30 kun ichida yarmiga) — config; qattiq emas (NIST no-rotation falsafa).
12. Kombinatsiya: new device + VPN + velocity → high; trusted device + kam signal → seamless (C-18).
13. Salbiy signal: trusted device (-0.4), account age (+0.2) (C-04) — yig'indida hisoblanadi.
14. Security/data guard: probabilistic (identity proof emas); PII minimal; DSAR; UZ'da saqlash.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (risk_score_computed, risk_tier_changed).
17. Unit test: aggregation; confidence; decay; kombinatsiya.
18. Integration/contract test: trend; per-role threshold; salbiy signal.
19. E2E/security test: threshold bypass emas; block UX; support flow.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. Observability: risk_tier_distribution, stepup_rate, block_rate (D-06).
22. `implementation-status-auth.md`ga C-17 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: confidence hisoblanmasa yoki decay bo'lmasa.
25. Done condition: risk detail to'liq, testlar yashil, tierlar aniq.
26. C-18 uchun: device detail'ga tayyor ekanini dalil bilan yoz.
27. Risk config'ning barcha qiymatlari env/table'da — kodda qattiq qiymat yo'q, hujjatlashtiriladi.
28. C-17 natijalari C-22 (session/action risk) uchun asos bo'ladi — interfeys hujjatlashtiriladi.
```

## C-18 — Device detail: fingerprint stability + trusted management

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi (device fingerprint, trusted devices).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: device detail — fingerprint stability, trusted device management, expiry, limit.
05. Precondition: C-03 yashil bo'lishi kerak; fingerprint schema va integration bor.
06. Stability: fingerprint o'zgarishi (browser update, OS update) — eski trust reset, re-enroll (yangi login'da qayta trust); aniqlash logikasi.
07. Trusted devices: settings ro'yxati (qurilma nomi, sana, IP hash) — [O'chirish] tugmasi reauth talab qiladi (A-29).
08. Trust expiry: 90 kun — qayta trust (sessiya emas, faqat trust markasi); config'da.
09. Trust vs remember-me: farq aniq — trust = risk signal (C-03), remember-me = session uzunroq (A-25); birlashtirilmaydi.
10. New device UX: "Yangi qurilma — bu sizmisiz?" + step-up (C-04) — email/push xabar (B-32 security).
11. Device limit: 10 ta — yangisi kelganda eng eski evict; evict audit'da.
12. Revoked device: fingerprint tekshiruvda revoked list (Redis) — darhol blok (session invalidation B-25 bilan).
13. Fingerprint privacy: hash'da, raw ma'lumot UZ'da minimal, DSAR; preview'da qurilma nomi (brauzer/OS) ko'rsatiladi.
14. Security/data guard: hash; privacy; tenant scope; IDOR yo'q.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (device_trusted, device_revoked, device_evicted).
17. Unit test: stability re-enroll; expiry; limit evict; revoke.
18. Integration/contract test: trust revoke → darhol blok; new device step-up.
19. E2E/security test: IDOR (boshqa user device ro'yxati); revoke reauth; evict logikasi.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. A11y: device ro'yxati keyboard; status color+text; revoke konfirmatsiya.
22. i18n: 4 tilda device nomi, xabarlar.
23. Metrics: trusted_device_count, revoke_count, expiry_reset_count, new_device_stepup_rate.
24. `implementation-status-auth.md`ga C-18 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: stability re-enroll bo'lmasa yoki revoke darhol ishlamasa.
27. Done condition: device detail to'liq, testlar yashil, metriclar qo'shilgan.
28. C-19 uchun: geo detail'ga tayyor ekanini dalil bilan yoz.
```

## C-19 — Geo detail: UZ geolocation + VPN detection

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi (geo, VPN, impossible travel).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: geo detail — UZ geolocation, VPN/proxy detection, privacy.
05. Precondition: C-05 yashil bo'lishi kerak; geo lookup ishlayapti.
06. Geo: lokal DB (GeoLite2) — city-level; UZ'da (privacy, offline); yillik yangilanish (C-24).
07. UZ context: Tashkent, Samarqand, Andijon shaharlari city-level; impossible travel hisobida masofa aniq.
08. VPN/proxy: IP reputation list (lokal yoki tashqi manba, masalan ochiq list) — risk +0.3 (C-04); faqat signal, blok emas.
09. Datacenter/ASN: kampus NAT va mobil operatorlar (UZ) — false-positive kamaytirish (C-01 per-ASN bilan).
10. Geo privacy: shahar (raw emas), IP hash; PII minimal; DSAR; 12 oy retention (C-14).
11. Offline geo: DB lokal — tashqi API YO'Q (latency, privacy, geofence).
12. VPN detection chegarasi: yuqori reputation VPN (masalan, korporativ) — trust emas, step-up; xabar aniq.
13. Geo + session: login'da geo saqlanadi (session), mid-session o'zgarishi → step-up (C-22 session risk).
14. Security/data guard: geo PII minimal; UZ'da saqlash; raw IP log'da emas (hash).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (vpn_signal, geo_lookup_failed).
17. Unit test: geo lookup; VPN list match; UZ shahar mapping.
18. Integration/contract test: impossible travel UZ (Toshkent→Samarqand); VPN step-up; kampus NAT false-positive.
19. E2E/security test: privacy (raw IP yo'q); block emas — step-up; support flow.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. Observability: vpn_signal_count, geo_miss_count, false_positive_stepup rate (D-06).
22. `implementation-status-auth.md`ga C-19 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: geo tashqi API'da bo'lsa yoki raw IP log'da bo'lsa.
25. Done condition: geo detail to'liq, testlar yashil, privacy saqlangan.
26. C-20 uchun: admin detail'ga tayyor ekanini dalil bilan yoz.
27. Geo hisoblar uchun UZ shahar koordinatalari (masofa hisobi) jadvali hujjatlashtiriladi.
28. C-19 natijalari C-05/C-22 bilan birga ishlaydi — signal nomlari birlashtiriladi.
```

## C-20 — Admin detail: role matrix, permissions, audit policy

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini va `research_auth_deep.md` 15-bo'limini (admin hardening) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin role matrix va permission modelini to'liq qurish (RBAC + ABAC).
05. Precondition: C-07/08 yashil bo'lishi kerak; admin auth va user management ishlayapti.
06. Rollar: platform_admin, institution_admin, teacher, co_teacher, proctor, marker, student (teacher section'da mavjud rollar bilan mos).
07. Permission matrix: har rol × action (login, user manage, roster import, teacher approve, audit view, session revoke, export, backup) — jadval hujjatda.
08. `src/modules/auth/rbac.js`: `hasPermission(role, action)` — central; middleware'da `requirePermission(action)`.
09. ABAC: tenant/course/group scope (teacher section'da mavjud) — har query'da scope; harfli IDOR test.
10. Admin actions audit: hammasi (C-09) — kim, qachon, nima, IP hash; append-only.
11. Delegation (P3): proctor scoped (C-08) — vaqtinchalik rol, expiry; approval bilan (Entra PIM pattern, B-16).
12. Separation of duty: audit view va user manage bir xil rolda emas (P2) — konflikt yo'q.
13. Session qoidalari: admin session alohida (C-07), idle timeout qisqa (A-02), re-auth sensitive (A-25).
14. Security/data guard: RBAC central; ABAC; audit; default-deny (yangisini qo'shganda ochiq emas).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: matrix; hasPermission; default-deny; ABAC scope.
18. Integration/contract test: rol almashish → permission o'zgaradi (sessiya tekshiruvi); proctor expiry.
19. E2E/security test: IDOR; escalation (student→admin); orphan permission.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. A11y: admin matrix UI keyboard; status color+text.
22. i18n: rol nomlari va xabarlar 4 tilda.
23. Metrics: permission_denied_count, escalation_attempt_count (alert), admin_action_volume.
24. `implementation-status-auth.md`ga C-20 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: RBAC bo'lmasa yoki default-deny bo'lmasa.
27. Done condition: role matrix to'liq, testlar yashil, audit to'liq.
28. C-21 uchun: final release'ga tayyor ekanini dalil bilan yoz.
```

## C-21 — Risk/Admin/Integration FINAL (C-faza release)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 7-10-bo'limlarini va `research_auth_deep.md` 13,14,15-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: C-faza release — Risk/Admin/Integration to'liq regression, sign-off.
05. Precondition: C-17..C-20 yashil; C-00..C-16 yashil; ledger to'liq.
06. C-faza checklist: rate limit (C-01), lockout (C-02), fingerprint (C-03), risk (C-04), impossible travel (C-05), stuffing (C-06), admin auth (C-07), user manage (C-08), audit (C-09), HEMIS adapter (C-10), roster import (C-11), OneID reja (C-12), open data (C-13), retention (C-14), backup/DR (C-15) — to'liq yashil.
07. Full regression (C): `npm test`, `npm run typecheck`, E2E suite.
08. Security regression: bypass (rate/fingerprint), geofence (HEMIS/OneID), secret (GitHub test), escalation (RBAC), IDOR, stuffing.
09. A11y regression: admin panel keyboard, axe 0 critical.
10. i18n regression: 4 til — admin, risk xabarlari, device/geo UI.
11. Performance: risk hisobi p95 < 50ms; rate limit Redis yuk ostida (C-01).
12. Sign-off: security (bypass yo'q), ops (backup/DR drill o'tgan), operator (checklist).
13. Security/data guard: critical yashirilmaydi; P2/P3 (passkey deep, OneID shartnoma) D/E fazaga.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: full C suite (barcha modul).
17. Integration/contract test: risk→admin→integration journey; restore drill natijasi.
18. E2E/security test: full C E2E + security scenarios.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga C-21 (RELEASE) statusi, dalillar, sign-off va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: critical security yoki sign-off olinsa — RELEASE yo'q.
23. Done condition: C-faza release checklist to'liq, testlar yashil, sign-off imzolangan.
24. Qolgan P2/P3 ro'yxati (OneID shartnoma, Telegram deep, passkey extra) — D/E fazaga ko'chirilganini yoz.
25. Release snapshot: commit hash, test soni — D-faza preflight uchun baseline saqlanadi.
26. Rollback rejasi: C-faza o'zgarishlari uchun migration/feature bo'yicha orqaga qaytarish yo'li yoziladi.
27. Butun PROMPT_GUIDE_AUTH_C release'ga tayyor ekanini dalil bilan yoz.
28. C-faza release commit'i operator tasdig'i bilan yopiladi — `implementation-status-auth.md`ga yoziladi.
```

## C-22 — Risk extra: session risk, action risk, adaptive

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini to'liq o'qi (session risk, adaptive).
04. Sen senior engineer sifatida quyidagi maqsadni bajar: risk extra — session risk, action risk, adaptive thresholds.
05. Precondition: C-17 yashil bo'lishi kerak; risk aggregation ishlayapti.
06. Session risk: mid-session fingerprint mismatch (C-04) — session'da qayta hisob; mismatch → step-up (A-26).
07. Session risk tekshirish: har sensitive request'da (C-20) — Redis'da session risk cache (5 daqiqa), har request emas.
08. Action risk: high-risk action (teacher approve, export, admin) — step-up; action config'da (C-20 matrix bilan).
09. Adaptive: risk threshold o'zgarishi (learning) (E-47) — masalan, platform umumiy hujum paytida qattiq; config + Redis.
10. Adaptive logikasi: dynamic threshold (global hujum signali) → default'dan qattiq; user xabari aniq.
11. Risk + session: login riski + session riski yig'indi emas — alohida hisob, bir-birini mustahkamlaydi (C-04).
12. Step-up natijasi: mfaAt yangilanishi (A-26) — keyingi sensitive action 30 daqiqa ichida yana step-up emas.
13. Security/data guard: probabilistic; no single signal; PII minimal; tenant scope.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (session_risk_stepup, action_risk_stepup, adaptive_tighten).
16. Unit test: session mismatch; action step-up; adaptive threshold.
17. Integration/contract test: mid-session device o'zgarishi → step-up; admin action step-up.
18. E2E/security test: no single signal bypass; step-up UX; adaptive false-tighten.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. Observability: session_stepup_rate, action_stepup_rate, adaptive_events (D-06).
21. `implementation-status-auth.md`ga C-22 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: session risk bo'lmasa yoki adaptive single-signal bo'lsa.
24. Done condition: risk extra to'liq, testlar yashil, metriclar qo'shilgan.
25. C-23 uchun: admin extra'ga tayyor ekanini dalil bilan yoz.
26. Session risk cache (5 daqiqa) TTL va invalidation (session o'zgarganda) hujjatlashtiriladi.
27. Step-up natijasida yangilangan mfaAt (A-26) keyingi sensitive action'da ishlatiladi — kontrakt tekshiriladi.
28. C-22 signal nomlari C-04/C-05 bilan yagona lug'atda (session_risk, action_risk) — hujjatlashtiriladi.
```

## C-23 — Admin extra: scheduled tasks, bulk, notifications

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini va `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin extra — scheduled tasks, bulk operations, notifications.
05. Precondition: C-08/09 yashil bo'lishi kerak; user manage va audit dashboard ishlayapti.
06. Scheduled tasks (cron): retention purge (C-14), teacher SLA (B-16), welcome sequence (B-19), invite expiry (B-11), backup (C-15), geo/disposable update (C-24).
07. Cron qoidalari: har task idempotent, lock (Redis SETNX), audit, retry (B-31 pattern), timezone Asia/Tashkent.
08. Bulk operations: user blok/rol o'zgarishi (E-09) — batch (100 ta), progress UI, qisman muvaffaqiyat, xato ro'yxati, audit har item.
09. Bulk confirm: admin ikki marta tasdiqlash (destructive) — rollback rejasi (E-09).
10. Notifications: admin'ga (ariza, alert, SLA, hujum signali) (C-09) — email/push/Telegram (B-22/23), quiet hours exception (security darhol).
11. Admin notification preferences: alohida (C-07) — qaysi event qaysi kanal.
12. Scheduled task monitoring: har task o'z metric (duration, success/fail), alert (D-06).
13. Security/data guard: admin audit; cron idempotent; bulk'da tenant scope; destructive confirmation.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (cron_run, bulk_executed, admin_notified).
16. Unit test: cron idempotency; bulk partial; lock.
17. Integration/contract test: notification delivery; bulk rol change → session re-check.
18. E2E/security test: cron duplicate run yo'q; bulk destructive confirm; IDOR.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. Observability: cron_success/fail, bulk_size, notification_fail (D-06).
21. `implementation-status-auth.md`ga C-23 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: cron idempotent bo'lmasa yoki bulk audit bo'lmasa.
24. Done condition: admin extra to'liq, testlar yashil, metriclar qo'shilgan.
25. C-24 uchun: integration extra'ga tayyor ekanini dalil bilan yoz.
26. Cron tasklar jadvali (nomi, schedule, owner, SLA) `implementation-status-auth.md`ga yoziladi.
27. Bulk'da qisman muvaffaqiyat response kontrakti (ok, failed[], errors[]) hujjatlashtiriladi.
28. Admin notification kanal fallback tartibi (email→push→Telegram) C-23'da tekshiriladi.
```

## C-24 — Integration extra: HEMIS sync, OpenData refresh, geo

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md` va `research_auth.md` 6, 8-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: integration extra — HEMIS sync (P3, BLOCKED hozir), OpenData refresh, geo/disposable update.
05. Precondition: C-10/11/13 yashil bo'lishi kerak; adapter, roster import, open data ishlayapti.
06. HEMIS sync (P3): rasmiy API bo'lsa (hozir BLOCKED — dostup yo'q); pull→diff→commit modeli (C-11 roster modeli); safe path (OAuth2/export) — scraping YO'Q.
07. OpenData refresh: semestr boshida (C-13) — OTM ro'yxati, talabalar soni cache update; source monitoring (sahifa o'zgarsa alert).
08. Geo update: GeoLite2 yillik (C-19) — yangilanish paytida lookup downtime yo'q (swap).
09. Disposable list update: oylik (B-05) — yangi domainlar qo'shiladi; hash/index yangilanadi.
10. IP reputation update: oylik (C-19 VPN) — yangi VPN/datacenter list.
11. Update qoidalari: har update idempotent, atomic (transaction), audit (updated_at, version), rollback.
12. Geofence: barcha tashqi ulanish UZ IP/proxy; xorijiy test 451 (qoida).
13. Security/data guard: SSRF himoya (C-10/11); external content validate; secret YO'Q (C-10 adapter).
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (open_data_refreshed, geo_updated, disposable_updated).
16. Unit test: refresh logikasi; atomic swap; idempotency.
17. Integration/contract test: sync (agar API bo'lsa); refresh cron (C-23 bilan).
18. E2E/security test: geofence; SSRF; cache stale emas.
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. Observability: open_data_age, geo_db_version, disposable_list_version (D-06).
21. `implementation-status-auth.md`ga C-24 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: geofence bo'lmasa yoki update atomic bo'lmasa.
24. Done condition: integration extra to'liq, testlar yashil, update'lar ishlaydi.
25. C-25 uchun: C-faza ultimate qabulga tayyor ekanini dalil bilan yoz.
26. Tashqi manbalar (data.gov.uz, GeoLite2, disposable list) URL va version jadvali hujjatlashtiriladi.
27. Update'lar paytida eski version ishlaydi (atomic swap) — downtime testi yoziladi.
28. C-24'da HEMIS sync faqat rasmiy API ochilganda (BLOCKED) — BLOCKED qolsa P2 ro'yxatda davom etadi.
```

## C-25 — Risk/Admin/Integration ULTIMATE (C-faza yakuniy)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 7-10-bo'limlarini va `research_auth_deep.md` 13,14,15-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: C-faza ultimate qabul — hamma C bosqichlari global darajada tasdiqlanadi.
05. Precondition: C-22..C-24 yashil; C-00..C-21 yashil; D-faza uchun ready.
06. C-faza ultimate checklist: rate limit, lockout, fingerprint, risk (score+session+action+adaptive), impossible travel, stuffing, admin (auth+matrix+bulk+cron), integration (HEMIS safe, OneID reja, open data, geo, backup/DR) — to'liq, global daraja.
07. Full regression (C): `npm test`, `npm run typecheck`, E2E suite.
08. Security sign-off: bypass (rate/fingerprint/adaptive), geofence, secret, escalation, stuffing — nol critical.
09. Ops sign-off: backup/DR drill natijasi, cron monitor, alertlar ishlaydi.
10. Product sign-off: admin UX, risk xabarlari, i18n 4 til, a11y.
11. Performance sign-off: risk p95 <50ms, rate Redis yuk ostida, admin dashboard <1s.
12. Security/data guard: critical yashirilmaydi; PII minimal (UZ, DSAR); P2/P3 D/E fazaga.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: full C suite (barcha modul, muhim path 100%).
16. Integration/contract test: full journey (rate→risk→admin→integration→backup).
17. E2E/security test: full C E2E + security scenarios.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga C-25 (ULTIMATE) statusi, dalillar, sign-off va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: critical security yoki sign-off olinsa — ULTIMATE yo'q.
22. Done condition: C-faza ultimate checklist to'liq, testlar yashil, sign-off imzolangan.
23. Ultimate snapshot: commit hash, test soni, metriclar (risk tier, block, step-up) — D-faza baseline.
24. Butun PROMPT_GUIDE_AUTH_C yakunlandi — D-00 preflight'ga tayyor ekanini dalil bilan yoz.
25. Operator yakuniy tasdig'i: C-faza yopiladi, D-faza ochiladi — yozma tasdiq talab qilinadi.
26. Rollback rejasi: C-faza to'liq o'zgarishlari (migration, config, cron) bo'yicha orqaga qaytarish yo'li yoziladi.
27. C-faza yakuniy hisobot: bajarilgan 26 bosqich, testlar, sign-offlar, qolgan P2/P3 — to'liq yoziladi.
28. Butun PROMPT_GUIDE_AUTH_C (26 prompt) yopilganligi operatorga tasdiqlanadi — D-00 ochiladi.
```

