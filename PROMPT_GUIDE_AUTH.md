# Edikit Auth/Integratsiya — bosqichma-bosqich AI Agent Prompt Guide

> **Maqsad:** `research_auth.md` (qilinadigan ishlar) va `hemis_github.md` (resurslar) asosida auth/integratsiya tizimini xavfsiz, tekshiriladigan tartibda bajarish.
> **Qo'llash:** promptlar A-00 dan A-24 gacha ketma-ket bajariladi. Keyingi prompt oldingisining `Done` sharti o'tmaguncha boshlanmaydi.
> **Repository:** `/home/user/edikit`
> **Source of truth:** `research_auth.md`, `hemis_github.md`
> **Muhim:** bu guide kod emas; har prompt copy-paste qilinadigan execution brief.

---

## A. Operator uchun qo'llash tartibi

1. Har yangi agent sessionida avval **Global Master Prompt**ni yuboring.
2. Keyin faqat navbatdagi raqamlangan promptni yuboring.
3. Agent ish boshida precondition va mavjud holatni tekshirsin.
4. Agent scope'dan tashqariga chiqmasin; keyingi prompt feature'ini oldindan qo'shmasin.
5. Har prompt oxirida test, changed files, migration, risk va next readiness reportini talab qiling.
6. `BLOCKED` bo'lsa sababni bartaraf qilmasdan keyingi promptga o'tmang.
7. High-risk promptlarda (auth, HEMIS, secret) assessment/security sign-off operator tasdiqlaydi.
8. Provider promptlarida (Google, Telegram, HEMIS) current official API va terms qayta tekshiriladi.
9. Source code commitini agent faqat operator aniq so'rasa qiladi; aks holda commit-ready diff va report beradi.
10. Har bosqichda `implementation-status-auth.md` ledger yangilanadi.

---

## B. Global Master Prompt

```text
01. Sen `/home/user/edikit` repository'sida ishlaydigan senior full-stack engineer va auth/security architectsan.
02. Asosiy source of truth: `/home/user/research_auth.md` va `/home/user/hemis_github.md`; har vazifadan oldin tegishli bo'limni to'liq o'qi.
03. Ishni boshlashdan oldin `git status`, current commit va mavjud o'zgarishlarni tekshir.
04. Operatorga tegishli noma'lum o'zgarishlarni overwrite, revert yoki delete qilma.
05. Har prompt scope'idan tashqaridagi keyingi feature'ni implement qilma.
06. Browser, upload, webhook va AI outputni untrusted input deb qabul qil.
07. Answer key, provider secret, refresh token va private data'ni frontendga yuborma; client credential server'da KMS.
08. Score, timer, streak va final grade server-authoritative bo'lsin; client qiymat trusted bo'lmasin.
09. Barcha HTTP/Socket/job payloadlarni shared Zod contract bilan validate qil.
10. Har write operationda authorization, idempotency, audit va rate limitni tekshir.
11. Tenant boundary har DB query, API va Socket roomda majburiy; IDOR test yoz.
12. HEMIS bilan ulanish FAQAT xavfsiz yo'llar bilan: OAuth2 (rasmiy flow), eksport/import, ochiq ma'lumotlar.
13. HEMIS skrepling, talaba parolini saqlash, `rest/docs` parolini buzish, undocumented endpoint — TAQIQLANGAN.
14. HEMIS geofenced (faqat UZ IP) — server-to-server ulanish UZ server/proxy orqali; xorijiy serverdan test 451 bo'ladi.
15. GitHub'dagi ochiq `clientSecret` (client_id=8) production'da ishlatilmaydi; faqat o'z test akkaunti bilan sinash mumkin.
16. OIDC/HEMIS token boshqa provider credentiali sifatida ishlatilmasin.
17. PII (JSHSHIR, telegram_id, hemis_id, email) UZ hududida, minimal, DSAR qo'llab-quvvatlanadi.
18. Har o'zgarish uchun unit, integration va zarur E2E/security test yoz; testlar mock provider ishlatadi.
19. Log, trace va error reportda secret, parol, token, OTP yoki answer bo'lmasin.
20. Migrationlar backward-compatible va rollback rejasi bilan bo'lsin.
21. Har vazifada accessibility (WCAG 2.2 AA), low-bandwidth va failure state'ni hisobga ol.
22. Ish tugagach changed files, migrations, contracts, tests va natijalarni aniq ro'yxat qil.
23. Ishlatilgan barcha test commandlari va natijalarini report qil.
24. Qolgan risk, blocker va manual sign-offlarni yashirmasdan yoz.
25. `DONE`, `BLOCKED` yoki `PARTIAL` statusidan bittasini ber.
26. Keyingi promptga tayyor/tayyor emasligini dalil bilan yoz.
27. Operator tasdig'isiz git commit, force push yoki destructive migration qilma.
28. Landing/login copy: "HEMIS bilan integratsiya" yozilmaydi; "HEMIS bilan kirish" faqat OAuth ishga tushganda.
29. Faqat joriy bosqichni qur; P2/P3 (passkey, Telegram, OneID, HEMIS OAuth) operator tasdig'isiz boshlanmaydi.
30. Universitar daraja qoidasi: terminologiya professional; bolalarcha/o'yincha narsa yo'q.
```

---

## C. Har promptdan keyingi majburiy report formati

```text
STATUS: DONE | PARTIAL | BLOCKED
PROMPT_ID:
SUMMARY:
FILES_CHANGED:
MIGRATIONS:
API_OR_EVENT_CONTRACTS:
SECURITY_CONTROLS:
ACCESSIBILITY_IMPACT:
TESTS_ADDED:
TEST_COMMANDS_AND_RESULTS:
DATA_MIGRATION_OR_BACKFILL:
OBSERVABILITY_ADDED:
KNOWN_RISKS:
MANUAL_SIGNOFF_REQUIRED:
ROLLBACK_OR_RECOVERY:
NEXT_PROMPT_READY: YES | NO
```

---

# Phase 1 — Login foundation (P0)

## Prompt A-00 — Auth preflight va baseline

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-3-bo'limlarini va `hemis_github.md`ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini qayta qurishdan oldin repository holatini o'zgartirmasdan inventarizatsiya qilish va tekshiriladigan baseline yaratish.
05. Precondition: repository `/home/user/edikit`da va operator target branchni tasdiqlagan bo'lishi kerak.
06. Kod yozishdan oldin `routes/auth.js`, `routes/oidc.js`, `middleware/auth.js`, `server.js`, `src/config/env.js`, `package.json`'dagi auth bog'liqliklarini tekshir.
07. Hozirgi auth holatini inventarizatsiya qil: login/register endpointlari, session config, password hashing, CSRF, rate limit, OIDC holati.
08. `research_auth.md` 12-bo'limidagi "Qilinmaydiganlar"ni (skrepling, parol saqlash, undocumented endpoint) qayta o'qib, hech biriga mos kod yo'qligini tekshir.
09. `.env.example` va `src/config/env.js`'da auth uchun zarur env'lar (SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET) bor-yo'qligini tekshir; yo'q bo'lsa ro'yxatla.
10. `firebase/local-db` users schema'sini va PostgreSQL'ga o'tish holatini tekshir (users jadvali mavjudmi).
11. Joriy test holatini o'lcha: `npm test`, `npm run typecheck` natijalari.
12. Security/data guard: hech qanday secret/credential log'ga chiqmasin; `.git/config`ga tegma; `git status` toza bo'lsin.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (mavjud bo'lsa).
15. Unit test: existing start command smoke test (`npm start` va `/` response 200).
16. Integration/contract test: existing auth route smoke test (`/user/login` GET 200).
17. E2E/security test: workspace'da kutilmagan generated file yo'qligi testi.
18. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
19. `implementation-status-auth.md`ga A-00 statusi, dalillar va next readinessni yoz.
20. Global report formatida changed files, migration, command va test natijalarini qaytar.
21. Stop condition: repository dirty holatida noma'lum source change bo'lsa yoki baseline ishga tushmasa.
22. Done condition: baseline, blockerlar, test natijalari va A-01 readiness aniq yozilgan bo'lsa.
23. A-01 uchun tavsiya: qaysi qism birinchi (Google OIDC yoki session) — yoz.
24. Hech qanday kod o'zgartirmasdan yakunla; faqat hisobot bering.
25. Baseline snapshot (commit hash, test soni) — keyingi bosqichda taqqoslash uchun saqlanadi.
26. Auth fayllari ro'yxati va ularning javobgarligi jadvalini yoz.
27. Redis/PostgreSQL mavjudligini tekshir (Prompt 03 foundation tayyor mi).
28. Joriy parol hashing (Argon2?) va legacy (SHA-256/plaintext) holatini yoz.
29. CSRF/rate-limit mavjudligini tekshir.
30. A-01 boshlashga tayyor ekanini dalil bilan yoz.
```

## Prompt A-01 — Redis session foundation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3-bo'limini (Session boshqaruvi) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session store'ni Redis'ga ko'chirish (MemoryStore o'rniga) va session modelini qurish.
05. Precondition: A-00 baseline yashil; Prompt 03 (Redis foundation) teacher research'da tayyor bo'lishi kerak; yo'q bo'lsa BLOCKED deb report qil.
06. Kod yozishdan oldin `server.js` session config, `package.json`'dagi express-session/connect-redis bog'liqliklarini tekshir.
07. `connect-redis` ni o'rnat va sozla: Redis client (ioredis), TTL mapping.
08. Session schema: id (32B random hex), userId, role, isVip, safeKey, csrfToken, oauth, remember, device {ua, ipHash, city}, createdAt, lastActive, expiresAt, revokedAt.
09. Remember TTL: remember=true → 30 kun; false → 8 soat (cookie Max-Age mos).
10. Legacy MemoryStore → Redis migratsiya: rollback rejasi (flag bilan fallback).
11. `src/modules/auth/session-store.js` yarat: get/set/destroy/revoke/list (user bo'yicha).
12. Session ID taxmin qilinmaydi (32B crypto.randomBytes).
13. Session data PII minimal: ip_hash (to'liq IP emas), city (geolocation emas).
14. Health check: Redis ping startup'da; fail-fast.
15. Shutdown: Redis disconnect/drain.
16. Security/data guard: session cookie httpOnly; session data'da secret yo'q.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (session_created, session_destroyed).
19. Unit test: session ID uzunlik/tasodifiylik; TTL mapping; revoke logikasi.
20. Integration/contract test: Redis persist/restart (session saqlanadi); list (user bo'yicha).
21. E2E/security test: session fixation (regenerate), restart'dan keyin session.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga A-01 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: Redis health ishlamasa yoki session data yo'qolsa.
26. Done condition: Redis session ishlaydi, TTL to'g'ri, testlar yashil.
27. A-02 uchun: cookie spetsifikatsiyaga tayyor ekanini yoz.
28. Redis local/CI'da mock (ioredis-mock) — testlar real Redis talab qilmasin.
29. Session store service boshqa modullardan import qilinadi (yagona).
30. Rollback rejasi hujjatlashtiriladi (MemoryStore flag).
```

## Prompt A-02 — Cookie spetsifikatsiya + idle timeout + parallel limit

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3-bo'limini (Session) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: cookie spetsifikatsiyasi, idle timeout va parallel session limitini qurish.
05. Precondition: A-01 Redis session yashil bo'lishi kerak.
06. Kod yozishdan oldin current cookie config (`connect.sid`, secure, sameSite) ni tekshir.
07. Cookie: name `connect.sid`, httpOnly, sameSite=Lax, secure (prod), path=/, Max-Age (remember 30 kun / session 8 soat); (P2) `__Host-` prefix.
08. Idle timeout: middleware'da lastActive tekshirish — 30 daqiqa harakatsizlik → 401 + redirect login (returnUrl bilan).
09. Idle timeout UX: 60 soniya oldin modal ogohlantirish ("Sessiya tugayapti — davom etasizmi?") + auto-save.
10. Parallel session limit: 5 ta; 6-chisi kelganda eng eski revoke (Redis sorted set by createdAt).
11. `middleware/auth.js` ga session touch (lastActive update) har request'da (throttled: 5 daqiqada bir).
12. Role change'da session regenerate.
13. A11y: timeout ogohlantirish live-region; keyboard.
14. Mobile: timeout ogohlantirish yumshoq.
15. Security/data guard: cookie secure/sameSite; idle timeout imtihonda ishni o'chirmaydi (attempt saqlanadi).
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (session_idle_timeout, session_limit_reached).
18. Unit test: TTL; idle timeout hisoblash; parallel limit 5→6.
19. Integration/contract test: idle timeout → 401; revoke-all; remember cookie.
20. E2E/security test: cookie flag tekshiruvi; fixation; limit abuse.
21. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
22. `implementation-status-auth.md`ga A-02 statusi va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: idle timeout imtihonda ishni o'chirsa (attempt saqlanishi shart).
25. Done condition: cookie/limit/timeout ishlaydi, attempt saqlanadi, testlar yashil.
26. A-03 uchun: rate limitga tayyor ekanini yoz.
27. `__Host-` prefix P2'da (proxy/domain shart).
28. Session touch throttled (har request'da Redis yozish emas).
29. Timeout davomiyligi config'da (tenant sozlashi mumkin).
30. Barcha write path audit bilan.
```

## Prompt A-03 — Rate limit + lockout + audit

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.2, 3, 10-bo'limlarini (rate limit, audit) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth endpointlar uchun rate limit/lockout va auth_audit jadvalini qurish.
05. Precondition: A-02 cookie/limit yashil bo'lishi kerak.
06. Kod yozishdan oldin mavjud rate limit va trust proxy sozlamasini tekshir.
07. `middleware/rate-limit.js` yarat: login per-IP 5 xato/15 daqiqa → 5 daqiqa lockout; per-user 10 xato/15 daqiqa → 15 daqiqa.
08. Reset: 3/soat (per account); verify: 5/15 daqiqa; passkey: 10/15 daqiqa; register: 5/15 daqiqa.
09. Lockout: users.failed_attempts, users.locked_until; login'da tekshirish.
10. Kampus NAT e'tibor: per-IP limit yumshoq, per-user limit qattiq; X-Forwarded-For trust proxy to'g'ri.
11. Jitter: login xatosida tasodifiy kechikish (brute force sekinlashtirish).
12. Lockout UX: "5 daqiqadan keyin qayta urinib ko'ring" + countdown; support link.
13. `429` response: Retry-After header; error code RATE_LIMITED.
14. `auth_audit` jadvali (migration): ts, actor_id, action, outcome, method, ip_hash, ua, detail JSONB — retention 30 kun (scheduled purge).
15. Action'lar: auth.login/fail/lockout/reset/revoke/passkey/telegram/oneid/hemis/register.
16. `src/modules/auth/audit.js` service: log(action, outcome, method, ctx) — async, non-blocking; parol/token/OTP hech qachon logga.
17. Security/data guard: rate limit IP spoof qarshi; audit PII minimal (ip_hash); parol/token yo'q.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (lockout_triggered, audit_write).
20. Unit test: counter; lockout davomiyligi; Retry-After; audit redaction.
21. Integration/contract test: 5 xato → lockout → 5 daqiqa → success; audit row.
22. E2E/security test: brute force simulyatsiya; audit'da PII grep (parol/token yo'q).
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-03 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: kampus NAT'da false lockout yoki audit'da parol yozilsa.
27. Done condition: rate limit + lockout + audit ishlaydi, testlar yashil.
28. A-04 uchun: login sahifasi qayta qurishga tayyor ekanini yoz.
29. Rate limit config'da sozlanuvchi (per-tenant P2).
30. Audit index: (ts, action), (actor_id).
```

## Prompt A-04 — Login sahifasi qayta qurish

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-bo'limini (Login tizimi) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: login sahifasini qayta qurish — Google birinchi (ko'rinadigan), tartib, trust, inline xatolar.
05. Precondition: A-03 rate limit/audit yashil bo'lishi kerak.
06. Kod yozishdan oldin hozirgi `views/user/login.ejs`ni to'liq o'qi.
07. Google tugmasini DOIM ko'rinadigan qil: joriy `display:none` + `fetch('/auth/status')` bug'ini olib tashla.
08. Google tugma: 44px, full-width, brand (G) icon + "Google bilan davom eting".
09. Tartib: Google → divider "yoki" → username+parol formasi → divider → Telegram (P3 placeholder) → "Akkauntingiz yo'qmi? [Bepul ro'yxatdan o'ting]".
10. Trust microcopy (pastda): "Ma'lumotlaringiz O'zbekistonda xavfsiz saqlanadi".
11. Footer: Bosh sahifa | Privacy | Shartlar (4 til).
12. Username field: `autocomplete="username"`, `autocapitalize="off"`, clear label.
13. Parol field: `autocomplete="current-password"`, show/hide 👁 (aria-pressed), paste ruxsat.
14. Parol min 8 (Zod min(8)); legacy 4-belgili user'lar login'da rehash (Argon2).
15. Inline xatolar (14 holat): field yonida, `role="alert"`, input saqlanadi (tozalanmaydi); har xato + yechim.
16. Enumeration himoya: "Bu username topilmadi" mavjud/yo'q bir xil javob (time-equal) + rate limit.
17. Lockout UX: "5 daqiqadan keyin qayta urinib ko'ring" + countdown; forma disabled.
18. `public/js/auth.js` yarat: Google tugma behavior, forma submit, inline xato render, lockout countdown, show/hide.
19. A11y: skip link, fokus tartibi (Google→username→parol→Kirish), 44px, aria-live xatolar, contrast 4.5:1.
20. Mobile: bir ustun, bosh barmoq zonasi, secure keyboard, autofill.
21. 4 til: i18n stringlar (auth.title, auth.google, auth.or, error.*) — `src/modules/auth/i18n.js`.
22. Security/data guard: hech qanday credential inline JS'da emas; CSRF hidden; parol/token logga yo'q.
23. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
24. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (login_view, login_google_start, login_password_start).
25. Unit test: tartib render; Google tugma ko'rinadi (grep display:none yo'q); Zod login schema.
26. Integration/contract test: /user/login 200; Google link /auth/google; xato mapping.
27. E2E/security test: mobil 44px, XSS, Google ko'rinadigan, autofill atributlari.
28. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
29. `implementation-status-auth.md`ga A-04 statusi va next readinessni yoz.
30. Global report formatida changed files, migration, command va test natijalarini qaytar.
31. Stop condition: Google yashirin qolsa yoki parol min 8 qo'llanilmasa.
32. Done condition: login sahifasi universitar, Google birinchi, inline xatolar, testlar yashil.
33. A-05 uchun: login backend (verify + rehash)ga tayyor ekanini yoz.
34. Login sahifasi landing bilan bir xil dizayn tili (style.md).
35. Telegramsiz placeholder ko'rinmaydi (P3'da ochiladi).
```

## Prompt A-05 — Login backend (verify + legacy migratsiya + redirect)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.2-bo'limini (username+parol) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: login backend'ini qurish — Argon2 verify, legacy migratsiya, lockout, session regenerate, role redirect.
05. Precondition: A-04 login sahifasi yashil; A-03 rate limit yashil.
06. Kod yozishdan oldin current `routes/auth.js` POST /user/login handlerini to'liq o'qi.
07. POST /user/login logic: rate limit check → safeKey(username) → users lookup.
08. Yo'q → 404 generic "Bu username topilmadi" (enumeration: time-equal + audit fail).
09. Bor → verify: Argon2id (verifyPassword); legacy SHA-256 (hashPass) → success + rehash; legacy plaintext → success + rehash.
10. Xato → failed_attempts++, lockout check (5/10 qoida), inline xato, audit fail.
11. Lockout: users.locked_until set; 429 + Retry-After; audit lockout.
12. Success: session regenerate (yangi ID + yangi csrf), remember flag (cookie Max-Age), isVip o'qish, last_login update, reset failed_attempts.
13. Redirect role bo'yicha: student → /panel, teacher → /teacher/overview, admin → /admin/dashboard; returnUrl allowlist (/, /panel, /assignments, /teacher/*, /admin/*).
14. New-device tekshirish (P1 A-09): ip_hash/UA yangi bo'lsa → xabar queue.
15. Audit: auth.login success/fail (method password).
16. Zod: loginSchema; CSRF tekshirish.
17. A11y: server error → inline render (A-04 bilan).
18. Security/data guard: parol hech qachon logga; enumeration time-equal; rate limit.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (login_success method, time_to_success).
21. Unit test: Argon2 verify; legacy migratsiya (SHA-256→Argon2, plaintext→Argon2); lockout.
22. Integration/contract test: success → regenerate + redirect; fail → 401/429; rehash.
23. E2E/security test: forged (client score emas), brute force, fixation.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga A-05 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: rehash qilinmasa yoki role redirect noto'g'ri bo'lsa.
28. Done condition: login backend to'liq, xavfsiz, testlar yashil.
29. A-06 uchun: parol tiklashga tayyor ekanini yoz.
30. Legacy migratsiya tranzaktsion (rehash + save).
```

## Prompt A-06 — Parol tiklash flow (forgot + reset + complete)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 2-bo'limini (Parol tiklash) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: parol tiklash flow'ini minimal va xavfsiz qurish (3 ekran).
05. Precondition: A-05 login backend yashil bo'lishi kerak.
06. `reset_tokens` jadvali (migration): token (48B random hex UNIQUE), user_id, expires_at (15 daqiqa), used_at, invalidated_at.
07. `routes/reset.js` yarat: POST /api/reset/request, POST /api/reset/verify, POST /api/reset/complete.
08. `views/user/forgot.ejs` yarat (1 ekran): account field (username yoki email) + [Havola yuborish] + resend timer 60s.
09. Request logic: rate limit 3/soat (per account) → users lookup → token yarat (crypto.randomBytes(48)) → expires 15 daqiqa.
10. Javob HAR DOIM: { ok:true, message:'Agar akkaunt mavjud bo'lsa, havola yuborildi' } (enumeration himoya).
11. Yetkazish: email bo'lsa email havola; aks holda Telegram (P3) yoki "email/Telegram bog'lang" xabari.
12. `views/user/reset.ejs` yarat (1 ekran): yangi parol (min 8 + 1 harf + 1 raqam, kuch indikatori, show/hide) + [Saqlash].
13. Verify: token validmi (mavjud, 15 daqiqa, ishlatilmagan) → 410 RESET_TOKEN_EXPIRED bo'lsa "Yangi havola oling" (account prefilled).
14. Complete: token tekshir → Argon2 hash → password update → token invalid → BOSHQA tokenlar ham invalid.
15. Complete'dan keyin: barcha eski sessiyalar revoke → session regenerate → avtomatik login (yangi sessiya) → role redirect.
16. Muvaffaqiyat ekrani: "Parol yangilandi ✓" (qisqa) → redirect.
17. Zod: resetRequestSchema, newPasswordSchema (token length 48, password min 8 regex); CSRF.
18. Audit: auth.reset (request/verify/complete) — token/parol hech qachon logga.
19. A11y: kuch indikatori aria; show/hide; 44px; aria-live.
20. Mobile: bir ustun, secure keyboard, autofill (new-password).
21. 4 til: reset stringlar.
22. Security/data guard: token bitta foydalanish; eski sessiyalar revoke; avtomatik login yangi sessiya; enumeration himoya.
23. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
24. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (reset_start, reset_complete, sessions_revoked_after_reset).
25. Unit test: token uzunlik/unique; expiry; bitta foydalanish; Zod.
26. Integration/contract test: request→verify→complete→avtomatik login; eski sessiya revoke; stale token 410.
27. E2E/security test: takroriy ishlatish blok, session fixation, brute force reset, enumeration.
28. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
29. `implementation-status-auth.md`ga A-06 statusi va next readinessni yoz.
30. Global report formatida changed files, migration, command va test natijalarini qaytar.
31. Stop condition: token takror ishlatilsa yoki eski sessiyalar qolsa.
32. Done condition: reset flow to'liq (<3 ekran), testlar yashil.
33. A-07 uchun: Google OIDC ga tayyor ekanini yoz.
34. Avtomatik login yangi sessiya ekani test bilan tasdiqlanadi.
35. Reset'dan keyin audit'da barcha eski sessiyalar ro'yxati.
```

## Prompt A-07 — Google OIDC (PKCE + state/nonce + mapping)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.1-bo'limini (Google OIDC) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Google OIDC login'ini PKCE, state, nonce va account mapping bilan qurish.
05. Precondition: A-05 login backend yashil; Google OAuth credentials .env'da (testda mock).
06. Kod yozishdan oldin current `routes/oidc.js` va `src/config/env.js`ni tekshir.
07. `GET /auth/google`: session'da oauth { state 32B, nonce 32B, codeVerifier 43B } saqla (PKCE S256).
08. Redirect: accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri=/auth/google/callback&response_type=code&scope=openid%20email%20profile&state&nonce&code_challenge&code_challenge_method=S256.
09. Scope minimal (openid email profile); hd policy (OTM domain) — ixtiyoriy config.
10. `GET /auth/google/callback`: state tekshir (session oauth.state) — mismatch → 400 + audit.
11. code → token exchange (code_verifier bilan) — server'da (client'ga emas).
12. ID token verify: iss=https://accounts.google.com, aud=CLIENT_ID, exp, nonce.
13. email_verified === true talab; verified bo'lmasa → aniq xato + parol fallback.
14. users.google_sub lookup: topilsa login; topilmasa email bo'yicha bog'lash (verified); yo'q bo'lsa yangi account (rol tanlash).
15. Session regenerate + yangi csrf; redirect role bo'yicha + returnUrl allowlist.
16. Google token boshqa provider uchun ishlatilmaydi; refresh token (agar) KMS/encrypted server'da.
17. Rate limit: /auth/google 10/15 daqiqa; callback abuse monitoring.
18. A11y: Google tugma screen reader label; callback error accessible.
19. Mobile: consent redirect back UX; in-app browser (Telegram) → "real browser'ga o'ting" xabari (P1).
20. Security/data guard: id_token cookie'da emas; token frontend'ga chiqmasin; account-linking escalation yo'q.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (login_google_start, login_google_callback, account_linked_google).
23. Unit test: state/nonce/PKCE negative; token verify (iss/aud/exp); email_verified; mapping.
24. Integration/contract test: wrong issuer/audience/expired → reject; callback replay; yangi user → rol modal.
25. E2E/security test: mock OIDC full flow (success/fail/cancel), session regenerate, escalation blok.
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga A-07 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: PKCE/state/nonce to'liq verify qilinmasa yoki escalation ochiq bo'lsa.
30. Done condition: OIDC xavfsiz, mapping to'g'ri, testlar yashil.
31. A-08 uchun: session boshqaruv UI'ga tayyor ekanini yoz.
32. Provider terms/API current tekshiriladi (Global Master Prompt 8).
33. Google login boshqa provider credentiali sifatida ishlatilmaydi (Prompt 16).
34. Mapping tranzaktsion (google_sub + user).
35. Callback'da CSRF (state) + rate limit.
```

## Prompt A-08 — Session boshqaruv UI

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3-bo'limini (Session boshqaruvi) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: aktiv sessiyalarni ko'rish/yakunlash UI'sini qurish.
05. Precondition: A-01 session foundation yashil bo'lishi kerak.
06. `routes/session.js` yarat: GET /sessions, POST /sessions/:id/revoke, POST /sessions/revoke-all.
07. `views/user/sessions.ejs` yarat: har sessiya — qurilma, brauzer, shahar, oxirgi faollik, "Joriy ✓", [Yakunlash].
08. Revoke: Redis DEL + revokedAt + audit (auth.revoke); joriy revoke → redirect /login (returnUrl bilan).
09. Revoke-all: barcha sessiyalarni invalid; joriy ham → qayta login.
10. Faqat o'z sessiyalarini ko'rish (user_id scope); IDOR test.
11. `src/modules/auth/session-store.js` ga list(userId) qo'sh (Redis scan + filter).
12. Settings'da "Xavfsizlik" ostidan ham ochiladi.
13. A11y: ro'yxat keyboard, [Yakunlash] 44px, focus.
14. Mobile: card ko'rinishida, pastki CTA.
15. 4 til: session stringlar.
16. Security/data guard: faqat o'z sessiyalari; revoke audit; CSRF.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (session_revoked, session_revoke_all).
19. Unit test: list; revoke; revoke-all; IDOR.
20. Integration/contract test: revoke bitta → 401 boshqa qurilmada; revoke-all.
21. E2E/security test: boshqa user sessiyasiga kirish blok; CSRF.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga A-08 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: IDOR ochiq bo'lsa.
26. Done condition: sessiya boshqaruv ishlaydi, testlar yashil.
27. A-09 uchun: new-device xabarga tayyor ekanini yoz.
28. Sessiya metadata: ua parse (qurilma/brauzer), ip_hash → shahar (P1).
29. Revoke idempotent (2-marta → OK/404).
30. Barcha write path CSRF + audit bilan.
```

## Prompt A-09 — New-device xabar + suspicious activity

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 3-bo'limini (new-device) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: yangi qurilmadan kirish xabari va suspicious activity ogohlantirishini qurish.
05. Precondition: A-08 session UI yashil bo'lishi kerak.
06. Login'da ip_hash/UA tekshirish: users.last_login_ip_hash bilan solishtirish.
07. Yangi bo'lsa → xabar queue: email/Telegram "Yangi qurilmadan kirish aniqlandi: [qurilma], [shahar], [vaqt]".
08. Xabar ichida: "Bu siz bo'lmasangiz — parolni o'zgartiring" + [Sessiyalarni yakunlash] link.
09. Suspicious rules: geolocation keskin o'zgarish; tez ketma-ket login; ko'p qurilma bir akkauntda.
10. Suspicious → aniq xabar (qo'rqitish emas, ko'rsatma) + audit.
11. `src/modules/auth/new-device.js` service: tekshirish, queue, dedupe (24 soatda 1 marta).
12. Xabar kanali: settings'da sozlangan (Telegram default, email fallback).
13. Preview'da sensitive yo'q (faqat qurilma/vaqt/shahar).
14. A11y: xabar linklari keyboard; 44px.
15. Mobile: xabar push/Telegram.
16. 4 til: xabar template'lar.
17. Security/data guard: ip_hash PII; shahar aggregate; preview sensitive yo'q.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (new_device_alert_sent, suspicious_alert).
20. Unit test: yangi qurilma aniqlash; dedupe; suspicious rules.
21. Integration/contract test: login → xabar queue → yetkazish; takroriy → dedupe.
22. E2E/security test: xabar preview scan (sensitive yo'q), abuse.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-09 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: preview'da sensitive bo'lsa yoki dedupe bo'lmasa.
27. Done condition: new-device xabar ishlaydi, testlar yashil.
28. A-10 uchun: roster importga tayyor ekanini yoz.
29. Shahar aniqlash (ip → city) P1'da (lokal DB).
30. Xabar chastotasi cap (kuniga ≤2).
```

## Prompt A-10 — Roster import: upload + parser (P0)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini (Roster import) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Excel/CSV roster import'ining upload va parser qismini qurish (HEMIS eksport bilan mos).
05. Precondition: A-09 yashil; Prompt 15 (roster upload security) teacher research'da tayyor bo'lishi kerak.
06. Kod yozishdan oldin mavjud XLSX parser va upload limitlarini tekshir.
07. Upload: stream/pre-signed; extension/MIME/magic bytes allowlist; size/row/sheet/cell limit; zip ratio limit.
08. Macro/external relation policy: formula execute YO'Q (parser qiymat o'qiydi, formula ishlamaydi).
09. Antivirus/quarantine worker (agar mavjud bo'lsa); yo'q bo'lsa staging + manual.
10. Unicode/email/name normalizatsiya (UZ ismlar, apostroflar).
11. Staging rows: fayl → staging (production DB'ga emas); parse report (qatorlar, xatolar).
12. HEMIS eksport formati bilan mos: kolonkalar mapping (talaba ID, ism, guruh, kurs, fan).
13. `routes/roster.js` yarat: POST /api/roster/upload (staging), GET /api/roster/staging/:id (report).
14. Security/data guard: fayl object key'da filename emas; parser memory/time sandbox; formula/zip-bomb qarshi.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (roster_uploaded, roster_parse).
17. Unit test: spoof MIME/macro/zip-bomb; formula execute yo'q; Unicode.
18. Integration/contract test: HEMIS formatli fayl staging'ga tushadi; parse report.
19. E2E/security test: large malformed workbook cleanup.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga A-10 statusi va next readinessni yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: zip-bomb/makro ochiq bo'lsa yoki parser formula execute qilsa.
24. Done condition: upload+staging xavfsiz, parse report, testlar yashil.
25. A-11 uchun: mapping+commit+rollbackga tayyor ekanini yoz.
26. Staging fayllar retention: 24 soat, keyin purge.
27. Quarantine worker'da hech qachon fail-open emas.
28. Fayl hajmi limit: config'da (mas. 10MB).
29. CSV encoding: UTF-8 BOM, cp1251 (rus) qo'llab-quvvatlash.
30. Barcha write path audit bilan.
```

## Prompt A-11 — Roster import: mapping + commit + rollback + invite

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 4-bo'limini (Roster import) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: roster'ning mapping, diff, commit, rollback va invite aktivatsiyasini qurish.
05. Precondition: A-10 upload/staging yashil bo'lishi kerak.
06. Column mapping UI/API: staging column → field (name, group, course, student_id, email).
07. Required/duplicate/referential validator: majburiy fieldlar, duplicate student_id, mavjud emas group.
08. Diff hisoblash: create/update/deactivate/conflict preview (admin approval).
09. Preview: yangi/o'zgargan/o'chiriladigan talabalar ro'yxati (admin ko'radi).
10. Transactional idempotent commit: bitta transaksiyada users+enrollments; qayta yuklash duplicate emas.
11. Row-level error report: har qator uchun status (ok/xato+sabab) — export qilish mumkin.
12. Rollback: snapshot/compensating import (commit'dan oldin backup).
13. Har talabaga invite: token (48B), email/Telegram; aktivatsiya (Google/parol → guruh prefilled).
14. Invite: 1 marta, revoke, expiry 7 kun; teacher'ga "N aktivatsiya qilmadi" xabari (P1).
15. `invites` jadvali: token, course_id, group_id, email, telegram_id, used_by, expires_at, revoked_at.
16. Audit: roster_commit, invite_created, invite_used.
17. Security/data guard: upload avtomatik production overwrite qilmaydi; external ID collision manual conflict.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (roster_commit, invite_created).
20. Unit test: diff logikasi; idempotency (same file 2 marta); row-level error.
21. Integration/contract test: partial invalid rows → atomic; rollback; invite aktivatsiya.
22. E2E/security test: commit/rollback/reconciliation; invite abuse.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-11 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: commit atomik bo'lmasa yoki invite 1-marta bo'lmasa.
27. Done condition: mapping/commit/rollback/invite ishlaydi, testlar yashil.
28. A-12 uchun: transkript/portfolio importga tayyor ekanini yoz.
29. Reconciliation: commit'dan keyin count tekshirish.
30. Rollback rejasi hujjatlashtiriladi.
```

## Prompt A-12 — Transkript/portfolio import (P1)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 5-bo'limini (Transkript/portfolio import) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: talaba transkript/diplom import'ini (PDF/Excel) va portfolio_items'ni qurish.
05. Precondition: A-11 roster yashil bo'lishi kerak.
06. `portfolio_items` jadvali: user_id, kind (result/certificate/credential), title, evidence JSONB, is_public (default false), created_at.
07. `routes/portfolio.js` yarat: POST /api/portfolio/import (PDF/Excel), GET /api/portfolio, POST /api/portfolio/share.
08. PDF parse: xavfsiz (PDF.js server yoki parse library; active content yo'q); Excel: A-10 parser qayta ishlatiladi.
09. HEMIS'dan olingan fayllar: transkript, reyting daftarcha, diplom (`student.<otm>.uz/dashboard/diploma`).
10. Mapping: fayldan fan/baho/kredit → portfolio item; manual tahrir ham mumkin.
11. Foydalanuvchi roziligi: importdan oldin "ma'lumotlaringiz UZ'da saqlanadi" xabar.
12. Default-private; share faqat talaba ruxsati (link).
13. Eksport: transkript PDF (semestr, fan, baho, kredit).
14. A11y: import UI keyboard; 44px.
15. Mobile: PDF yuklash.
16. 4 til: portfolio stringlar.
17. Security/data guard: fayl xavfsiz; default-private; share auth; IDOR.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (portfolio_import, portfolio_share).
20. Unit test: PDF/Excel parse (xavfsiz); mapping; privacy.
21. Integration/contract test: import→item; share link; eksport PDF.
22. E2E/security test: IDOR; share auth; malicious PDF.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-12 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: share auth buzilgan yoki malicious PDF ochiq bo'lsa.
27. Done condition: transkript import + portfolio ishlaydi, testlar yashil.
28. A-13 uchun: ochiq ma'lumotlarga tayyor ekanini yoz.
29. PDF parse memory/time limit.
30. Barcha write path CSRF + audit bilan.
```

## Prompt A-13 — Ochiq ma'lumotlar: OTM ro'yxati + talabalar soni (P1)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 6-bo'limini (Ochiq ma'lumotlar) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: OTM ro'yxati va talabalar sonini ochiq ma'lumotlardan olish (landing stats).
05. Precondition: A-12 yashil bo'lishi kerak.
06. Manba: `data.gov.uz/uz/datasets/14037` ("Oliy ta'lim muassasai") — CSV/JSON; `hemis.uz/universities` (ochiq, HTTP 200).
07. `src/modules/opendata/universities.js` yarat: fetch → normalize → cache (Redis 24 soat).
08. Dataset: OTM nomi (uz/ru), bakalavriat jami, magistratura jami.
09. Landing stats: OTM soni, talabalar soni (yig'indi) — haqiqiy raqamlar; yolg'on emas.
10. Cache + scheduled refresh (semestrda bir); failure → eski cache (fail-soft).
11. License: ochiq ma'lumotlar litsenziyasi hurmat; manba ko'rsatish.
12. Geofence: data.gov.uz xorijiy serverdan 000 (vaqt tugadi) — UZ server/proxy kerak yoki brauzer orqali.
13. Security/data guard: ochiq ma'lumotlar — PII yo'q; fetch SSRF qarshi (allowlist domain).
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (opendata_refresh).
16. Unit test: parser; normalize; cache.
17. Integration/contract test: fetch→stats; cache hit/miss; refresh.
18. E2E/security test: SSRF; yolg'on raqam yo'q (grep).
19. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
20. `implementation-status-auth.md`ga A-13 statusi va next readinessni yoz.
21. Global report formatida changed files, migration, command va test natijalarini qaytar.
22. Stop condition: yolg'on statistika yoki SSRF ochiq bo'lsa.
23. Done condition: OTM stats ishlaydi, haqiqiy, testlar yashil.
24. A-14 uchun: GitHub secret sinashga tayyor ekanini yoz.
25. Stats config'da toggle (oni/offi).
26. Dataset o'zgarsa — schema version.
27. OTM logolari landing'da (Ishonch) — stats bilan birga.
28. UZ server/proxy rejasi (geofence) A-17'da.
29. Barcha fetchlar timeout + retry.
30. Litsenziya havolasi footer'da.
```

## Prompt A-14 — GitHub secret sinab ko'rish (xavfsiz tekshiruv)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 7-bo'limini (GitHub secret sinash) va `hemis_github.md` 2.2-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: GitHub'dagi ochiq HEMIS client (client_id=8) sinab ko'rish — xavfsiz tartib bilan; natija hujjatlashtirish.
05. Precondition: operator xavfsiz sinashga rozilik bergan; o'z test HEMIS akkauntingiz mavjud bo'lishi kerak (o'z OTM'ingiz).
06. TEST REJIMI (faqat o'z akkaunti bilan; boshqa talaba paroli YO'Q):
07. Qadam 1: `GET https://student.hemis.uz/oauth/authorize?client_id=8&redirect_uri=<o'z redirect>&response_type=code` → login sahifasi.
08. Qadam 2: o'z HEMIS akkaunti bilan login → consent → `code` (callback'da).
09. Qadam 3: `POST https://student.hemis.uz/oauth/access-token` { client_id=8, client_secret=<github>, code, grant_type=authorization_code }.
10. Qadam 4: token olinsa → `GET /oauth/api/user?fields=id,uuid,type,name,login,email,university_id` → user ma'lumotlari.
11. Natija qayd etiladi: client ishlaydi (secret to'g'ri) / secret noto'g'ri / client o'chirilgan.
12. SINOV NATIJASI PRODUCTION'GA ISHLATILMAYDI (secret 4 yil ochiq — compromised).
13. Test'da olingan user ma'lumotlari logga yozilmaydi (faqat summary: ishlaydi/yo'q).
14. Security/data guard: hech qanday parol Edikit serverida saqlanmaydi; test credential hujjatlashtirilmaydi (log'da yo'q).
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (hemis_oauth_test).
17. Unit test: (agar adapter yozilsa) OAuth2 flow mock.
18. Integration/contract test: authorize→token→user (agar client ishlasa, live test).
19. E2E/security test: xato secret → aniq xato; no user data leak.
20. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
21. `implementation-status-auth.md`ga A-14 statusi va natijani yoz.
22. Global report formatida changed files, migration, command va test natijalarini qaytar.
23. Stop condition: boshqa talaba paroli ishlatilsa yoki secret production'ga qo'yilsa.
24. Done condition: sinov xavfsiz bajarildi, natija aniq (ishlaydi/yo'q), hujjatlashtirilgan.
25. A-15 uchun: HEMIS OAuth2 adapterga tayyor ekanini yoz (OTM client bo'lsa).
26. Sinovda olingan token darhol discard qilinadi.
27. Client ishlasa ham — yangi client so'rash tavsiya qilinadi (secret ochiq).
28. Test natijasi operatorga report qilinadi.
29. Hech qanday screenshot PII bilan saqlanmaydi.
30. Barcha sinov xavfsiz (GET/POST rasmiy endpoint).
```

## Prompt A-15 — HEMIS OAuth2 adapter (P2/P3 — OTM client bo'lganda)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 8-bo'limini (HEMIS OAuth2) va `hemis_github.md` 2.2A, 3.1-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: HEMIS OAuth2 login adapterini qurish — OTM client mavjud bo'lganda (test OTM bilan).
05. Precondition: A-05 login backend yashil; **OTM HEMIS panelida client yaratgan** (client_id+secret+redirect); aks holda BLOCKED (faqat reja).
06. `hemis-oauth` namunasidan endpointlar: authorize `student.hemis.uz/oauth/authorize`, token `/oauth/access-token`, user `/oauth/api/user`.
07. `src/modules/auth/providers/hemis.js` yarat: authorize (state 32B), token exchange (client_secret), user fetch.
08. User fields (Zod): id, uuid, university_id, type, firstname, surname, patronymic, login, picture, email, phone, birth_date.
09. `users.hemis_id` UNIQUE (migration); mapping hemis_id ↔ user; yangi → account yaratish (rol tanlash).
10. Session regenerate + csrf yangi; redirect role bo'yicha + returnUrl allowlist.
11. Client credential KMS/encrypted (env + secret manager); redirect URI allowlist.
12. PKCE qo'llab-quvvatlansa ishlatiladi (HEMIS OAuth2 — qo'llab-quvvatlashi tekshiriladi).
13. Geofence: HEMIS faqat UZ IP — server UZ'da yoki proxy (A-17); test OTM bilan live test.
14. OIDC `.well-known` yo'q — id_token emas, user endpoint orqali.
15. Rate limit: /auth/hemis 10/15 daqiqa.
16. Login UI: "HEMIS bilan kirish" tugmasi — faqat client ishga tushganda ko'rinadi.
17. Audit: auth.hemis (success/fail), hemis_linked.
18. A11y: tugma 44px; screen reader label; callback error accessible.
19. Mobile: consent redirect back; in-app browser xabari.
20. 4 til: hemis stringlar.
21. Security/data guard: hemis token boshqa provider uchun emas; credential KMS; IDOR.
22. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
23. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (hemis_login_start, hemis_login_callback).
24. Unit test: adapter mock (authorize/token/user); fields schema; state.
25. Integration/contract test: live (test OTM) authorize→token→user; mapping; replay.
26. E2E/security test: token leak; IDOR; escalation; geofence (xorijiy IP → 451).
27. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
28. `implementation-status-auth.md`ga A-15 statusi va next readinessni yoz.
29. Global report formatida changed files, migration, command va test natijalarini qaytar.
30. Stop condition: OTM client bo'lmasa (BLOCKED) yoki credential KMS'da bo'lmasa.
31. Done condition: adapter ishlaydi (test OTM), xavfsiz, testlar yashil.
32. A-16 uchun: Telegram OTP (P3)ga tayyor ekanini yoz — operator tasdig'i bilan.
33. Provider terms/API current tekshiriladi (Global Master Prompt 8).
34. Client_id=8 (GitHub) production'da ishlatilmaydi — OTM yangi client beradi.
35. Landing "HEMIS bilan kirish" faqat shu adapter ishga tushganda.
```

## Prompt A-16 — Telegram OTP (P3)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1.3-bo'limini (Telegram OTP) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Telegram orqali 6-xonali kod auth flow'ini qurish (UzExam patterni — xavfsiz versiya).
05. Precondition: A-05 login backend yashil; operator P3 ni tasdiqlagan; Telegram bot token .env'da (testda mock).
06. `routes/telegram-auth.js` yarat: POST /auth/telegram/start { phone }, POST /auth/telegram/verify { telegram_id, code }.
07. Start: t.me/EdikitBot?start=<token 20B random, 5 daqiqa, 1 marta> — telefon/email orqali yuborish.
08. Bot callback: signed (bot_token HMAC), user data (id, first_name, username) — signature verify.
09. Verify: 6-kod (telegram message yoki signed callback) → users.telegram_id lookup.
10. Mapping: mavjud user → telegram_id saqlash; yangi → account yaratish (invite bilan) yoki invite mapping.
11. Step-up: high-stakes (summative, admin) uchun telegram_id o'zi identity emas — phone/JSHSHIR qo'shimcha.
12. Session regenerate + audit (auth.telegram).
13. Rate limit: start 5/15 daqiqa, verify 5/15 daqiqa; kod bitta foydalanish, 5 daqiqa.
14. UX: login'da "Telegram orqali" tugmasi (3-o'rin); kod kiritish ekrani; resend timer.
15. Kod hech qachon logga; kod hash saqlash.
16. A11y: kod ekrani keyboard; 44px.
17. Mobile: Telegram in-app browser — "real browser'ga o'ting" xabari.
18. 4 til: telegram auth stringlar.
19. Security/data guard: bot signature verify; kod bitta foydalanish; step-up qoidasi.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (login_telegram_start, login_telegram_verify).
22. Unit test: signed callback verify; token expiry; kod hash.
23. Integration/contract test: start→verify round-trip; mapping; step-up.
24. E2E/security test: replay, rate limit, noto'g'ri signed callback.
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. `implementation-status-auth.md`ga A-16 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: bot signature verify bo'lmasa yoki kod bitta foydalanish bo'lmasa.
29. Done condition: Telegram auth ishlaydi, step-up qoidasi bor, testlar yashil.
30. A-17 uchun: geofence reja + checkpointga tayyor ekanini yoz.
```

## Prompt A-17 — Geofence reja + Auth checkpoint sign-off

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 9, 10, 11-bo'limlarini (Geofence, Audit, Bosqichlar) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: geofence rejasini hujjatlashtirish va Auth phase'ini yakuniy sertifikatlash.
05. Precondition: A-00..A-16 bajarilgan (P0/P1 qismlari yashil).
06. Geofence hujjati: qaysi endpoint geofenced (jadval): student.hemis.uz (302, ishlaydi), univer.hemis.uz (451), diplom.edu.uz (451), data.gov.uz (000/xorij), hemis.uz (200), tyutor.hemis.uz (200).
07. Yechim: HEMIS/davlat tizimlariga server-to-server — UZ server/proxy; foydalanuvchi brauzeri orqali (Yo'l A) — muammo yo'q.
08. Test muhitida: UZ proxy faqat test (production'da emas).
09. CHECKPOINT: Auth phase mustaqil regression/security testlari bilan sertifikatlash.
10. Qayta tekshir: Redis session, rate limit, audit, cookie, OIDC (Google), reset, session UI, new-device, roster, transkript, ochiq ma'lumotlar, HEMIS OAuth (agar), Telegram (agar).
11. Enumeration test: "topilmadi" bir xil javob+vaqt.
12. Brute force test: rate limit + lockout + jitter.
13. Session fixation test: regenerate har login.
14. CSRF test: barcha POST.
15. Cookie flag test: httpOnly/secure/sameSite.
16. Open redirect test: returnUrl allowlist.
17. Secret scan: `clientSecret`/`client_id=8` production'da yo'q (grep); KMS'da.
18. PII scan: log/audit'da parol/token/OTP/hemis token yo'q (grep).
19. IDOR test: boshqa user sessiya/portfolio/roster.
20. A11y: axe 0 critical; keyboard journey.
21. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
22. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
23. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
24. Unit test: full auth suite.
25. Integration/contract test: login/reset/session/oidc/roster/portfolio integration.
26. E2E/security test: lockout, fixation, CSRF, cookie, open redirect, IDOR, secret scan.
27. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
28. `implementation-status-auth.md`ga A-17 (CHECKPOINT) statusi yoz.
29. Global report formatida changed files, migration, command va test natijalarini qaytar.
30. Stop condition: har qanday critical/high blocker qolsa.
31. Done condition: auth xavfsiz, to'liq; keyingi phase ochiladi.
32. Operator review va sign-off talab qilinadi (checkpoint).
33. Residual risk va next phase readiness yoziladi.
34. P2/P3 (passkey, Telegram, OneID, HEMIS OAuth) — alohida bosqich, operator tasdig'i bilan.
35. Auth phase yakunlangan deb e'lon qilinadi.
```

---

## D. Yakuniy operator qoidasi

- Promptlar ketma-ketligi dependency order hisoblanadi: A-00→A-17.
- Checkpoint: **A-17** — operator review va sign-off talab qilinadi.
- Checkpoint `BLOCKED` bo'lsa keyingi phase ochilmaydi.
- P2/P3 bosqichlari (passkey, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) operator tasdig'isiz boshlanmaydi.
- HEMIS bilan ulanish FAQAT xavfsiz yo'llar (OAuth2 rasmiy, eksport/import, ochiq ma'lumotlar); skrepling/parol/undocumented — taqiqlangan.
- Har provider integratsiyasida official documentation va terms aynan bajarish kunida qayta tekshiriladi.
- `research_auth.md` va `hemis_github.md` source of truth; `PROMPT_GUIDE_AUTH.md` bajarish tartibi.
- Har bosqichda `implementation-status-auth.md` ledger yangilanadi.

---

# Phase 1b — Register + email + Teacher approval (P0 — MUHIM BO'SHLIQ)

> **2026-08-03:** Foydalanuvchi eslatmasi — login/register mantig'ida bo'shliqlar aniqlandi: (1) teacher admin tasdiqlashi shart, (2) email majburiy (parol tiklash uchun), (3) parol tiklash email orqali. Ushbu promptlar shuni to'ldiradi.

## Prompt A-18 — Register: email majburiy + verify

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.1-bo'limini (Register email) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: register'da email majburiy yig'ish va email verify (OTP) qurish — parol tiklash uchun asos.
05. Precondition: A-04 login sahifasi yashil bo'lishi kerak.
06. Kod yozishdan oldin current register endpointi (mode=reg) va users jadvalini tekshir.
07. Register formasi: rol (student/teacher), ism, username, **email (majburiy)**, parol (min 8 + 1 harf + 1 raqam), invite kod (ixtiyoriy), honeypot.
08. Zod registerSchema: email format + unique; username unique (safeKey); parol kuch.
09. PostgreSQL users ALTER (migration): email TEXT UNIQUE NULL, email_verified BOOLEAN DEFAULT false.
10. Google register: email OIDC claims'dan (email_verified=true) — qo'shimcha verify shart emas.
11. Parol register: email verify — 6-kod emailga (crypto, hash saqlash, 15 daqiqa, 1 marta); `verification_codes` jadvali.
12. Email template: "Tasdiqlash kodi: 123456 — 15 daqiqa amal qiladi. Spamni tekshiring."
13. Verify UX: kod input + resend timer 60s; noto'g'ri email → yangilash.
14. Limited mode: verify'siz — o'qish/practice ruxsat; summative (nazorat topshirish) blok; UI'da "Emailni tasdiqlang" banner.
15. Legacy user'lar (email'siz): login'da "Email bog'lang" so'rovi (P1) — parol tiklash uchun shart.
16. Rate limit: verify send 3/soat, check 5/15 daqiqa; kod brute-force qarshi.
17. Audit: register_created, verify_sent, verify_complete — kod hech qachon logga.
18. A11y: kod input keyboard; 44px; aria-live; banner live-region.
19. Mobile: OTP autofill (native).
20. 4 til: register/verify stringlar.
21. Security/data guard: email unique; kod hash; enumeration (band email xabari) rate limit bilan.
22. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
23. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (register_view, verify_complete).
24. Unit test: Zod email/unique; kod hash; expiry; resend.
25. Integration/contract test: register→verify→email_verified; limited mode blok; duplicate email.
26. E2E/security test: kod brute-force, replay, XSS.
27. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
28. `implementation-status-auth.md`ga A-18 statusi va next readinessni yoz.
29. Global report formatida changed files, migration, command va test natijalarini qaytar.
30. Stop condition: email unique bo'lmasa yoki kod logga tushsa.
31. Done condition: email majburiy + verify ishlaydi, testlar yashil.
32. A-19 uchun: teacher approvalga tayyor ekanini yoz.
33. Email yuborish: SMTP provider (nodemailer) mock'da; production config.
34. Legacy user migratsiya: email bo'sh — "bog'lash" flow P1.
35. Barcha write path CSRF + audit bilan.
```

## Prompt A-19 — Teacher approval flow (admin tasdiqlaydi)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.2-bo'limini (Teacher approval) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher roli uchun admin approval flow'ini qurish — resurslar cheklangan, hamma teacher bo'lolmaydi.
05. Precondition: A-18 email verify yashil bo'lishi kerak.
06. Kod yozishdan oldin users.role structure va admin panel routing'ini tekshir.
07. `users.role` qadriyatlari: `student` (avtomatik), `teacher_pending`, `teacher` (approved), `teacher_rejected`.
08. Teacher register → `teacher_pending`; login'da **cheklangan rejim**: "Arizangiz ko'rib chiqilmoqda" ekrani; test yaratish/cast/student data blok.
09. Admin panel: "Teacher arizalari" bo'limi — ro'yxat (ism, email, universitet, sana, ariza matni), [Tasdiqlash] [Rad etish] + sabab.
10. `routes/admin/teachers.js` yarat: GET /admin/teachers/pending, POST /admin/teachers/:id/approve, POST /admin/teachers/:id/reject { reason }.
11. Tasdiqlanganda: role → `teacher`; xabar (email/Telegram): "Tabriklaymiz, o'qituvchi sifatida tasdiqlandingiz!"; limited mode o'chadi.
12. Rad etilganda: role → `teacher_rejected`; xabar: sabab bilan; qayta ariza imkoniyati (P1).
13. Pending'da qayta login: doim "ko'rib chiqilmoqda" ekrani (task emas).
14. Tasdiqlanmagan teacher: hech qachon student data ko'rmaydi, test yaratmaydi (authorization test).
15. Admin approval: CSRF, rate limit, audit (teacher_approved, teacher_rejected).
16. Co-teacher: teacher o'zi qo'shadi (P2) — admin emas.
17. A11y: admin ro'yxat keyboard; xabar accessible.
18. Mobile: admin panel responsive.
19. 4 til: teacher approval stringlar.
20. Security/data guard: role transition faqat admin; IDOR (boshqa user approve) blok.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (teacher_approved, teacher_rejected).
23. Unit test: role state machine; limited mode blok; approve/reject.
24. Integration/contract test: register→pending→approve→teacher; reject→sabab; qayta ariza.
25. E2E/security test: non-admin approve blok; rejected teacher student data ko'rmaydi; IDOR.
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga A-19 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: rejected/pending teacher student data ko'rsa yoki non-admin approve qila olsa.
30. Done condition: teacher approval flow ishlaydi, testlar yashil.
31. A-20 uchun: parol tiklash email aniqlikka tayyor ekanini yoz.
32. Teacher arizasida qo'shimcha maydonlar: universitet, fan, tajriba (ixtiyoriy).
33. Admin xabarnoma: yangi ariza → admin'ga email/Telegram.
34. Role o'zgarishi audit'da qayd etiladi.
35. Barcha write path CSRF + audit bilan.
```

## Prompt A-20 — Parol tiklash: email orqali (to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1b.3, 2-bo'limlarini (Parol tiklash email) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: parol tiklashning asosiy kanalini email qilish (verified email) — A-06'dagi bo'shliqni to'ldirish.
05. Precondition: A-18 email verify yashil; A-06 reset skeleton yashil.
06. Kod yozishdan oldin A-06'da qurilgan reset flow'ni tekshir.
07. Forgot: account field (username yoki **email**) → users lookup (username OR email).
08. Email topilsa va `email_verified=true` → **emailga havola** (48B token, 15 daqiqa, 1 marta) — `reset_tokens` jadvali.
09. Email verified bo'lmasa → "Emailingizni tasdiqlang" yo'li (A-18 resend verify) — reset avval verify talab.
10. Email yo'q (legacy user) → "Email bog'lang" so'rovi + support; Telegram ulangan bo'lsa → Telegram orqali token (P3).
11. Javob har doim bir xil: "Agar akkaunt mavjud bo'lsa, havola yuborildi" (enumeration himoya).
12. Email template: "Parolni tiklash havolasi — 15 daqiqa amal qiladi. Spamni tekshiring."
13. Reset ekran: yangi parol (min 8 + 1 harf + 1 raqam, kuch indikatori, show/hide) → Argon2 → token invalid → **barcha eski sessiyalar revoke** → session regenerate → avtomatik login.
14. Rate limit: 3/soat (per account); token bitta foydalanish.
15. Audit: auth.reset (request/verify/complete) — token/parol hech qachon logga.
16. A11y: forgot/reset ekran keyboard; 44px; aria-live.
17. Mobile: bir ustun; email autofill.
18. 4 til: reset stringlar.
19. Security/data guard: enumeration himoya; verified email shart; eski sessiyalar revoke.
20. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
21. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (reset_start, reset_complete, sessions_revoked_after_reset).
22. Unit test: username OR email lookup; verified check; token expiry; bitta foydalanish.
23. Integration/contract test: email verified → havola → reset; verify'siz → "Emailni tasdiqlang"; legacy → bog'lash/support.
24. E2E/security test: enumeration, brute force, stale token, eski sessiya revoke.
25. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
26. `implementation-status-auth.md`ga A-20 statusi va next readinessni yoz.
27. Global report formatida changed files, migration, command va test natijalarini qaytar.
28. Stop condition: verify'siz reset ochiq bo'lsa yoki enumeration ochiq bo'lsa.
29. Done condition: parol tiklash email orqali to'liq ishlaydi, testlar yashil.
30. A-21 uchun: final checkpointga tayyor ekanini yoz.
31. Telegram fallback P3'da qo'shiladi.
32. Legacy user email bog'lash flow P1'da (login'da so'rov).
33. Reset'dan keyin avtomatik login yangi sessiya.
34. Barcha write path CSRF + audit bilan.
35. Support yo'li: email'siz user'lar uchun manual reset (admin).
```

## Prompt A-21 — Final Auth checkpoint sign-off (Register + Teacher approval bilan)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 9, 10, 11-bo'limlarini (Geofence, Audit, Bosqichlar) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Register + Teacher approval qo'shilgandan keyin Auth phase'ini yakuniy sertifikatlash.
05. Precondition: A-18, A-19, A-20 yashil; A-00..A-17 bajarilgan (P0/P1 qismlari).
06. CHECKPOINT: Auth phase mustaqil regression/security testlari bilan sertifikatlash.
07. Register audit: email majburiy+unique+verify; honeypot; rate limit; legacy migratsiya.
08. Teacher approval audit: pending→approved/rejected; limited mode (student data/test/cast blok); non-admin blok; IDOR.
09. Parol tiklash audit: email verified shart; enumeration; bitta foydalanish; eski sessiya revoke.
10. Login audit: Google OIDC (PKCE/nonce/email_verified); parol rehash; lockout.
11. Session audit: Redis; cookie flaglar; idle timeout; parallel limit; new-device.
12. Roster/transkript audit: commit/rollback; invite 1 marta; portfolio privacy.
13. Geofence: HEMIS/davlat tizimlari UZ IP sharti hujjatlashtirilgan.
14. Secret scan: `clientSecret`/`client_id=8` production'da yo'q (grep); KMS'da.
15. PII scan: log/audit'da parol/token/OTP/email yo'q (grep); email verified.
16. Enumeration/brute-force/fixation/CSRF/cookie/open-redirect testlari yashil.
17. A11y: axe 0 critical; keyboard journey (register→verify→login).
18. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
21. Unit test: full auth suite (login+register+approval+reset+session).
22. Integration/contract test: register→verify→login; teacher pending→approve→teacher; reset email.
23. E2E/security test: lockout, fixation, CSRF, cookie, open redirect, IDOR, teacher escalation, secret scan.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga A-21 (CHECKPOINT — yakuniy) statusi yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: har qanday critical/high blocker qolsa (teacher escalation, email verify bo'shliq, secret).
28. Done condition: auth to'liq, xavfsiz, teacher approval ishlaydi; keyingi phase ochiladi.
29. Operator review va yakuniy sign-off talab qilinadi.
30. Residual risk va next-version backlog yoziladi.
31. P2/P3 (passkey, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) — alohida bosqich, operator tasdig'i bilan.
32. Butun PROMPT_GUIDE_AUTH zanjiri yakunlandi.
33. Keyingi phase (agar): user bo'limi / teacher workspace — alohida reja bilan.
34. `research_auth.md` 11-bo'lim bosqichlar jadvali yakuniy tasdiqlanadi.
35. Auth phase yakunlangan deb e'lon qilinadi.
```

---

## E. Yakuniy operator qoidasi (yangilangan)

- Promptlar ketma-ketligi: A-00→A-21.
- Checkpointlar: **A-17** (Login foundation) va **A-21** (Final — Register+Teacher approval bilan).
- Checkpoint `BLOCKED` bo'lsa keyingi phase ochilmaydi.
- **Register'da email majburiy + verify** (parol tiklash uchun) — A-18; **Teacher admin tasdiqlaydi** (resurslar cheklangan) — A-19; **Parol tiklash email orqali** — A-20.
- P2/P3 bosqichlari (passkey, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) operator tasdig'isiz boshlanmaydi.
- HEMIS bilan ulanish FAQAT xavfsiz yo'llar; skrepling/parol/undocumented — taqiqlangan.
- Har provider integratsiyasida official documentation va terms aynan bajarish kunida qayta tekshiriladi.
- `research_auth.md` va `hemis_github.md` source of truth; `PROMPT_GUIDE_AUTH.md` bajarish tartibi.
- Har bosqichda `implementation-status-auth.md` ledger yangilanadi.

---

# Phase 2 — Global gigant darajasida chuqurlashtirish (NIST/OWASP/Entra)

> **2026-08-03:** Haqiqiy research (research_auth_deep.md) asosida — parol siyosati (NIST SP 800-63B-4), email infra (Google/Yahoo 2024), OIDC hardening (OAuth 2.1), teacher approval (Entra PIM) qismlari chuqurlashtirildi.

## Prompt A-22 — Parol siyosati: NIST + HIBP + zxcvbn

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 1, 2-bo'limlarini (NIST, OWASP) va `research_auth.md` 1.2'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: parol siyosatini NIST SP 800-63B-4 darajasiga keltirish — dynamic min uzunlik, HIBP breach check, zxcvbn kuch indikatori, timing-safe compare.
05. Precondition: A-05 login backend yashil bo'lishi kerak.
06. Dynamic min uzunlik: users.twofa_enabled bo'lsa 8 belgi, aks holda **15 belgi** (NIST); max 128 (OWASP ASVS), silently truncate yo'q.
07. Complexity qoidalarini olib tashla (NIST SHALL NOT): "1 katta harf + 1 raqam + 1 belgi" talab yo'q.
08. Davriy o'zgartirishni o'chir: faqat kompromat isboti bo'lganda (breach detected flag).
09. **HIBP Pwned Passwords** integrasiya: k-anonymity — SHA-1 hash → 5 belgi prefix → API → full hash ro'yxatda bo'lsa rad (parol plaintext API'ga yuborilmaydi).
10. HIBP tekshiruv: ro'yxatda va parol o'zgartirishda; offline fallback (agar API ishlamasa — fail-open signup, log).
11. **zxcvbn-ts** (Dropbox) kuch indikatori: client'da score 0-4; admin/teacher uchun score >= 4 talab (server'da zxcvbn ham).
12. Hints / security questions — yo'q (NIST prohibited).
13. Unicode + space qabul: har Unicode code point 1 belgi (NIST).
14. **Timing-safe compare:** login'da username topilmasa ham **dummy argon2 compare** bajarish (enumeration/timing attack qarshi — MojoAuth/OWASP misoli).
15. Password change: joriy parol verify SHART (OWASP abuse case); yangi parol eski bilan bir xil bo'lmasin (reuse check).
16. Argon2id + per-user salt (mavjud); parametrlar NIST (memory-hard).
17. `src/modules/auth/password-policy.js` yarat: evaluate(password, {mfa, username, email}) → {ok, reason, zxcvbnScore}.
18. Security/data guard: parol hech qachon logga; HIBP'ga faqat SHA-1 prefix; zxcvbn client'da (parol server'ga emas).
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (password_policy_reject, breach_password_blocked).
21. Unit test: dynamic min (8/15); HIBP k-anonymity (prefix yuboriladi, full emas); zxcvbn score; dummy-hash timing.
22. Integration/contract test: breach parol rad; reuse rad; Unicode qabul.
23. E2E/security test: timing attack (mavjud/yo'q bir xil vaqt — 100 ta request o'rtacha), HIBP offline fallback.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga A-22 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: parol plaintext HIBP'ga yuborilsa yoki timing farq katta bo'lsa.
28. Done condition: parol siyosati NIST darajasida, HIBP+zxcvbn ishlaydi, timing test yashil.
29. A-23 uchun: email infratuzilmaga tayyor ekanini yoz.
30. Legacy user'lar (4-belgi) — login'da qayta kuchli parol so'rov (P1).
```

## Prompt A-23 — Email infratuzilmasi: SPF/DKIM/DMARC + provider + validation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini (email deliverability) va `research_auth.md` 5b'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email infratuzilmasini qurish — transactional provider, SPF/DKIM/DMARC, bounce webhook, email validation (disposable blok).
05. Precondition: A-18 email verify yashil bo'lishi kerak.
06. Provider tanlash: **Postmark** (transactional-only, ~93% inbox) yoki **SES** (arzon, self-managed) — `.env`'da config; mock'da nodemailer transport.
07. **SPF + DKIM + DMARC:** DNS record'lar; dedicated sending domain `mail.edikit.uz`; DMARC p=none → quarantine → reject (DMARC report monitoring).
08. **Transactional va marketing AYRILADI** — Edikit faqat transactional (welcome, verify, reset); marketing alohida (agar keyin).
09. Bounce/complaint webhooks: hard bounce → darhol suppress (users.email_status=bounced); complaint → alert (target <0.1% — Google/Yahoo).
10. Delivery tracking: sent/delivered/bounced status — auth_audit yoki email_log jadvali.
11. **Email validation signup'da:** syntax + MX + disposable (temp-mail blok) — sync 200ms; SMTP probe async; typo suggestion; cache 24 soat.
12. Disposable blok: hard block (yoki soft — qaror); message: "Doimiy email ishlating".
13. Double opt-in: verify 6-kod (A-18 bilan) — address validity + deliverability.
14. Template: qisqa, clear, spam trigger yo'q (ALL CAPS, "FREE"), plain-text version, preheader.
15. `src/modules/email/provider.js` + `templates/` (verify, reset, welcome, teacher_approved, teacher_rejected) — barchasi 4 til.
16. Retry/backoff: yuborish muvaffaqiyatsiz bo'lsa 3 marta; webhook idempotency.
17. Security/data guard: email'da parol/token hech qachon; reset link faqat token; sender domain SPF.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (email_sent, email_bounced, email_complaint).
20. Unit test: provider abstraction (mock); template render 4 til; disposable blok.
21. Integration/contract test: SPF/DKIM/DMARC DNS tekshirish; bounce webhook → suppress; validation flow.
22. E2E/security test: spam trigger yo'q (template scan); email enumeration (bounce farqi yo'q); disposable.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-23 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: SPF/DKIM/DMARC sozlanmasa yoki transactional/marketing aralashsa.
27. Done condition: email ishonchli yetib boradi (seed test >=90%), bounce suppress, disposable blok.
28. A-24 uchun: OIDC hardeningga tayyor ekanini yoz.
29. Postmark/SES tanlovi operator bilan (byudjet/DevOps).
30. Email provider credentials KMS; hech qachon frontend'da.
```

## Prompt A-24 — OIDC hardening: JWKS, exact redirect, rotation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 4-bo'limini (OAuth 2.1) va `research_auth.md` 1.1'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Google OIDC'ni OAuth 2.1/RFC 9700 darajasiga mustahkamlash — JWKS, exact redirect, token rotation.
05. Precondition: A-07 OIDC yashil bo'lishi kerak.
06. **JWKS verify:** ID token'ni Google JWKS (kid) bilan verify; **alg allowlist** (RS256; HS256 rad) — alg confusion qarshi.
07. **Issuer exact:** `https://accounts.google.com` — prefix emas, exact.
08. **Redirect URI exact match** (OAuth 2.1 MUST) — registered URI bilan exact string (wildcard/regex yo'q); trailing slash muhim.
09. **PKCE S256** — plain emas (faqat S256); server'da code_verifier tekshirish.
10. **state** (32B) CSRF; **nonce** (32B) replay — ID token'da nonce bo'lishi shart.
11. **Refresh token rotation** (agar Google beradi): har ishlatishda yangi; rotated token qayta ishlatilsa → kompromat signali → butun zanjir invalid + audit.
12. Access/refresh token: server-side (HttpOnly cookie); hech qachon localStorage; token URL'da emas.
13. Token exchange server-side (OIDC token endpoint CORS yo'q — client'da qilma).
14. Clock skew: JWT vaqt validatsiyasi (leeway 30s).
15. Rate limit: /auth/google 10/15 daqiqa; callback abuse monitoring.
16. Audit: login_google_success/fail (issuer/audience/nonce xatolari).
17. Security/data guard: Google token boshqa provider credentiali sifatida emas; client_secret KMS.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (oidc_token_invalid, oidc_refresh_rotated).
20. Unit test: JWKS alg allowlist (HS256 rad); issuer exact; nonce mismatch; exp.
21. Integration/contract test: refresh rotation; replay (rotated token qayta); exact redirect.
22. E2E/security test: alg confusion, state mismatch, callback replay.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-24 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: alg allowlist bo'lmasa yoki exact redirect bo'lmasa.
27. Done condition: OIDC OAuth 2.1 darajasida, testlar yashil.
28. A-25 uchun: session hardening (__Host-, remember selector)ga tayyor ekanini yoz.
29. JWKS cache (24 soat) + rotation handling.
30. Provider terms/API current tekshiriladi.
```

## Prompt A-25 — Session hardening + Teacher approval chuqur (Entra PIM) + Final

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6, 9-bo'limlarini (cookie, Entra PIM) va `research_auth.md` 1b.2'ni to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session cookie'ni __Host- darajasiga keltirish, remember-me selector/verifier, teacher approval'ni Entra PIM darajasida qurish, final checkpoint.
05. Precondition: A-22, A-23, A-24 yashil; A-19 teacher approval skeleton yashil.
06. **__Host-session cookie** (P2): name `__Host-session`, Secure, Path=/, no Domain — subdomain cookie injection qarshi; SameSite=Lax.
07. **Remember-me selector/verifier:** selector (random) cookie, verifier (random) DB'da hash; 30 kun max; har ishlatishda rotate; device-bound (UA+IP hash); high-privilege amallarda full session talab (selector token yetarli emas).
08. **Idle timeout 30 daqiqa + absolute 12 soat + renewal** (session ID mid-session rotate — hijack window kamayadi).
09. **Re-authentication sensitive amallar** (parol/email o'zgartirish, teacher approve): current password yoki MFA (OWASP).
10. Teacher approval Entra PIM darajasida (A-19'ni kengaytirish):
11. Approval window 72 soat; o'tib ketsa eslatma; 7 kun eskalatsiya (super-admin).
12. Approver o'z arizasini approve qilolmaydi; justification majburiy.
13. Email notification admin'ga + reminder (24s/48s).
14. Rejected: sabab + cooldown 30 kun + appeal (support).
15. Audit: teacher_approved/rejected (admin_id, ts, justification) — auth_audit.
16. FINAL CHECKPOINT: auth phase mustaqil regression/security testlari bilan sertifikatlash.
17. Qayta tekshir: parol siyosati (NIST/HIBP/zxcvbn), email (SPF/DKIM/DMARC/bounce), OIDC (JWKS/rotation), session (__Host-/remember), teacher approval (Entra), login (dummy timing), forgot (OWASP).
18. Secret scan: clientSecret/client_id=8 production'da yo'q; provider key'lar KMS.
19. PII scan: log/audit'da parol/token/OTP/email yo'q; email verified.
20. Enumeration/brute-force/fixation/CSRF/cookie/open-redirect testlari yashil.
21. A11y: axe 0 critical; keyboard journey.
22. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
23. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
24. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
25. Unit test: full auth suite (NIST policy + email + OIDC + session + teacher).
26. Integration/contract test: register→verify→login→approve→teacher; reset email; remember-me rotation.
27. E2E/security test: timing, alg, __Host-, teacher escalation, secret scan.
28. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
29. `implementation-status-auth.md`ga A-25 (CHECKPOINT — yakuniy) statusi yoz.
30. Global report formatida changed files, migration, command va test natijalarini qaytar.
31. Stop condition: har qanday critical/high blocker qolsa.
32. Done condition: auth to'liq, global gigant darajasida, xavfsiz; sign-off tayyor.
33. Operator review va yakuniy sign-off talab qilinadi.
34. P2/P3 (passkey, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) — alohida bosqich, operator tasdig'i bilan.
35. Butun PROMPT_GUIDE_AUTH zanjiri yakunlandi; `research_auth_deep.md` manbalar arxivi sifatida qoladi.
```

---

## F. Yakuniy operator qoidasi (final)

- Promptlar ketma-ketligi: A-00→A-25.
- Checkpointlar: **A-17** (Login foundation), **A-21** (Register+Teacher), **A-25** (Global gigant daraja — FINAL).
- Har checkpoint `BLOCKED` bo'lsa keyingi phase ochilmaydi.
- **Manbalar majburiy:** NIST SP 800-63B-4, OWASP CheatSheets, OAuth 2.1/RFC 9700, Microsoft Entra PIM, Google/Yahoo sender rules — implementatsiyada shu manbalarga qayta tekshiriladi (`research_auth_deep.md`).
- P2/P3 (passkey, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) operator tasdig'isiz boshlanmaydi.
- HEMIS bilan ulanish FAQAT xavfsiz yo'llar; skrepling/parol/undocumented — taqiqlangan.
- `research_auth.md` (qilinadigan) + `research_auth_deep.md` (manbalar) + `hemis_github.md` (resurslar) — source of truth.
- Har bosqichda `implementation-status-auth.md` ledger yangilanadi.

---

# Phase 3 — MFA, Passkey, Risk-based, Account Security (massive to'liqlik)

> **2026-08-03:** research_auth_deep 12-15-bo'limlar asosida — MFA/TOTP, passkey, risk-based auth, account events, admin hardening, password/email change — global gigant darajasida.

## Prompt A-26 — MFA/TOTP: enrollment + login + backup codes

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 12-bo'limini (MFA/TOTP) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: TOTP MFA'ni production darajasida qurish — ikki fazali enrollment, login challenge, backup codes, step-up, audit.
05. Precondition: A-22 parol siyosati yashil; operator P2 ni tasdiqlagan (MFA).
06. DB schema (migration): `mfa_totp` (user_id, secret_encrypted AES-256-GCM, status pending|active, last_used, created_at), `mfa_backup_codes` (user_id, code_hash HMAC-SHA256, used_at), `mfa_audit` (user_id, action, method, ip_hash, ua, ts, detail).
07. Setup endpoint: POST /api/mfa/totp/setup → secret yarat, AES-256-GCM encrypt, QR (otpauth://) + Base32 manual key qaytar (secret plaintext FAQAT shu response'da).
08. Enable endpoint: POST /api/mfa/totp/enable { token } → birinchi kod verify (valid_window=1, 90s) → status pending→active → **10 ta backup code yarat** (token_hex(5), faqat bir marta ko'rsatiladi, HMAC-SHA256 hash saqlanadi).
09. Backup code acknowledgement: "Men kodlarni saqladim" checkbox majburiy; kodlarni ko'rsatish + download/print.
10. Login challenge: parol to'g'ri → **pending_mfa_user_id** (session'da, session hali BERILMAYDI) → POST /api/mfa/verify { code } (TOTP yoki backup) → **faqat shunda session beriladi** (majburiy: parol bosqichida session bo'lmasa, MFA himoyasiz).
11. TOTP verify: `valid_window=1`; **5 xato → 15 daqiqa lockout**; backup code ishlatilsa — shu zahoti used_at set (replay yo'q); muvaffaqiyatda counter reset.
12. Challenge ID: consumed (reuse yo'q — WorkOS).
13. Step-up: sensitive amallar (parol/email o'zgartirish, teacher approve, admin amallar, data export) — `mfaAt` session'da; eskirgan bo'lsa (30 daqiqa) → qayta challenge.
14. MFA reset (eng zaif nuqta): recovery codes birinchi; yo'q bo'lsa — **support ticket + ID verification + time-delay 72 soat + barcha email'larga notification + cancel imkoniyati**; high-privilege (admin/teacher) — admin approval.
15. **Password reset va MFA reset AYRILADI:** reset link faqat parolni tiklaydi; MFA login'da hali talab (email o'g'irlangan attacker MFA'siz o'tolmaydi).
16. Factor replacement: reauth existing factor; risk-based (new device); out-of-band notification; audit.
17. Settings UI: MFA holati, qurilmalar, backup codes rotate (eski invalid).
18. Rate limit: setup/enable/verify/reset 5/15 daqiqa; Turnstile yuqori xavfda.
19. Audit: enable/disable/failed challenge/recovery/factor change — hammasi mfa_audit (IP, UA, ts, method).
20. Security/data guard: secret encrypt; backup code hash; kod hech qachon logga; challenge consumed.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (mfa_enabled, mfa_challenge_fail, mfa_reset).
23. Unit test: secret encrypt/decrypt; TOTP verify (valid_window); backup hash + used; lockout.
24. Integration/contract test: setup→enable→login; backup code login; step-up; MFA reset (time-delay); password reset MFA'siz o'tmaydi.
25. E2E/security test: "session password stage'da berilmasligi" (boshqa tab'da authenticated route — 401); replay; brute-force.
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga A-26 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: secret plaintext DB'da yoki session parol bosqichida berilsa.
30. Done condition: MFA/TOTP production darajasida, testlar yashil.
31. A-27 uchun: passkeyga tayyor ekanini yoz.
32. SMS MFA — asosiy emas (faqat fallback/recovery; SIM swap riski).
33. TOTP lib: otplib/speakeasy (RFC 6238); QR: qrcode lib.
34. MFA majburiy admin/teacher (A-30 bilan).
35. Barcha write path CSRF + audit bilan.
```

## Prompt A-27 — Passkey/WebAuthn: register + login + recovery

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10-bo'limini (passkeys) to'liq o'qi; simplewebauthn pattern.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: passkey (WebAuthn) ni production darajasida qurish — register, Conditional+Modal UI, counter, recovery, settings.
05. Precondition: A-26 MFA yashil; operator P2 ni tasdiqlagan (passkey).
06. `passkey_credentials` jadvali (migration): id, user_id, credential_id (base64url UNIQUE), public_key, counter, device_type, backed_up, transports JSONB, aaguid, created_at, last_used.
07. Register: POST /passkey/options (challenge 32B, rp.id=domain, user.id/name, excludeCredentials) → client `navigator.credentials.create({attestation:'none'})` → POST /passkey/register verify (origin, rpId, counter=0).
08. **Counter monotonic:** har auth'dan keyin update; eski counter → rad (replay qarshi).
09. Login UI — IKKALA usul (reddit PSA):
   - **Conditional UI**: `autocomplete="username webauthn"` (webauthn OXIRIDA), page load'da init (click emas), `useBrowserAutofill:true`, AbortController (user boshqa usul tanlasa abort).
   - **Modal button** "Passkey bilan kirish" — hardware key / cross-device uchun (Conditional UI yolg'iz qilinsa, YubiKey/phone passkey ishlamaydi).
10. Feature detection: `browserSupportsWebAuthnAutofill()` → conditional; `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` → button render.
11. **Kamida 1 boshqa auth usuli** (parol/MFA) — faqat passkey bo'lsa lockout xavfi; **kamida 2 passkey** tavsiya (enrollment'da "yana bitta qurilma" taklif).
12. Recovery: recovery codes (A-26 bilan) + email magic link; passkey yo'qolsa — recovery flow.
13. Settings sahifasi: registered passkeys ro'yxati (device_type, backed_up, last_used), [O'chirish], [Yangi qo'shish] — reauth talab.
14. Nudge: login'dan keyin "Tezroq kirish uchun passkey qo'shing" (signup'ni buzmaydi).
15. Rate limit: /passkey/register + /passkey/verify 10/15 daqiqa; challenge bitta foydalanish.
16. Audit: passkey_created, passkey_login, passkey_fail, passkey_revoked (counter anomalies).
17. A11y: passkey button 44px; dialog accessible; fallback parol har doim.
18. Mobile: biometric prompt; sync (iCloud/Google).
19. 4 til: passkey stringlar.
20. Security/data guard: raw biometric serverga kelmaydi (WebAuthn spec); credential private; counter verify.
21. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
22. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (passkey_created, passkey_login).
23. Unit test: counter monotonic; origin/rpId; challenge replay; alg allowlist.
24. Integration/contract test: register→login (conditional+modal); recovery; revoke; browser support matrix (Win10 fallback).
25. E2E/security test: replay, cross-origin attestation rad, counter manipulation, IDOR (boshqa user credential).
26. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
27. `implementation-status-auth.md`ga A-27 statusi va next readinessni yoz.
28. Global report formatida changed files, migration, command va test natijalarini qaytar.
29. Stop condition: counter verify bo'lmasa yoki Conditional UI yolg'iz bo'lsa (modal yo'q).
30. Done condition: passkey to'liq (2 usul + recovery), testlar yashil.
31. A-28 uchun: risk-based authga tayyor ekanini yoz.
32. @simplewebauthn/server + /browser libs (MIT).
33. Browser support matrix test qilinadi (Chrome/Safari/Firefox/Edge/Win10/iOS 17.4.1 bug).
34. Passkey = phishing-resistant MFA (NIST AAL2+).
35. Barcha write path CSRF + audit bilan.
```

## Prompt A-28 — Risk-based auth + device fingerprint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 13-bo'limini (risk-based) to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: risk-based authentication'ni qurish — device fingerprint, risk tiers, step-up, impossible travel, velocity.
05. Precondition: A-26 MFA yashil; operator P2 ni tasdiqlagan.
06. Device fingerprint: **FingerprintJS** (open source) yoki o'z lightweight (canvas/WebGL/UA/plugins stable hash) — client'da hisoblanadi, server'ga hash yuboriladi (raw telemetry emas).
07. `user_devices` jadvali: user_id, fingerprint_hash, first_seen, last_seen, trusted (user confirm), risk_events JSONB.
08. Risk score service `src/modules/auth/risk.js`: signals → score 0-1:
   - new device (fingerprint mismatch) +0.3
   - impossible travel (geo+ts: Toshkent → 10 daqiqada London) +0.5
   - velocity (bir IP ko'p account fail; bir device ko'p IP) +0.4
   - VPN/proxy +0.3, bot detected (Turnstile) +0.6, dev tools +0.2
   - trusted device (user confirmed) -0.4
09. Risk tiers (fluxforce — binary emas): <0.3 trusted → seamless; 0.3-0.7 unknown → step-up MFA/CAPTCHA; >0.7 suspicious → block + alert.
10. **Impossible travel:** server-side (IP geolocation lokal DB + timestamp) — client'ga ishonmaymiz.
11. **Mid-session fingerprint mismatch** (nhimg): active session'da fingerprint o'zgarishi → hijack signal → step-up (mavjud session'da ham tekshirish).
12. Bot detection: Turnstile (Cloudflare) — login/signup/reset yuqori xavfda; `botDetected` signal risk score'ga.
13. Response: risk yuqori bo'lsa — step-up MFA (A-26), CAPTCHA, throttling yoki block; fokus high-risk actions (account creation, password reset).
14. **Privacy (majburiy):** fingerprint hash (raw emas); security purpose; UZ'da saqlash; DSAR; retention qisqa; "nima yig'iladi" tushuntirish.
15. Audit: risk_score, action (allow/stepup/block), signals (hash'da, raw emas).
16. Rate limit integration: risk-based throttle (yuqori risk → sekinroq).
17. Security/data guard: fingerprint probabilistic signal — yagona access decision EMAS; user false-positive'da support yo'li.
18. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
19. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (risk_scored, risk_blocked, risk_stepup).
20. Unit test: risk score hisoblash; tiers; impossible travel; velocity.
21. Integration/contract test: yangi device → step-up; trusted → seamless; fingerprint mismatch mid-session → step-up.
22. E2E/security test: spoof qilishga urinish (client hash forge — server signals qo'shimcha); false-positive support.
23. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
24. `implementation-status-auth.md`ga A-28 statusi va next readinessni yoz.
25. Global report formatida changed files, migration, command va test natijalarini qaytar.
26. Stop condition: fingerprint yagona qaror bo'lsa yoki raw telemetry saqlansa.
27. Done condition: risk-based ishlaydi (tiers + step-up), privacy to'g'ri, testlar yashil.
28. A-29 uchun: account security eventsga tayyor ekanini yoz.
29. Threshold'lar config'da (tenant sozlashi); tuning logs (12-24 oy).
30. Barcha write path CSRF + audit bilan.
```

## Prompt A-29 — Account security events + password change + email change

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini (account events) to'liq o'qi; OWASP Auth.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: account security events (password/email change notification, breach detect) va password/email change flow'larini qurish.
05. Precondition: A-26 MFA yashil; A-23 email yashil.
06. **Password change flow** (POST /api/account/password):
   - Reauth: current password verify SHART (OWASP abuse case: public kompyuter).
   - New password: NIST policy (A-22) + HIBP + **reuse check** (eski bilan bir xil emas).
   - **Barcha boshqa sessiyalar revoke** (joriydan tashqari); audit.
   - Notification: email/Telegram "Parolingiz o'zgartirildi" — "Agar siz bo'lmasangiz — support" link.
07. **Email change flow** (POST /api/account/email):
   - Reauth: current password yoki MFA (step-up — A-26).
   - **Ikkala address'ga verify** (OWASP: email = recovery; eski email'ga xabar + yangi email'ga code).
   - Commit'dan keyin eski email'ga "email o'zgartirildi" xabar; boshqa sessiyalar revoke (ixtiyoriy).
   - Rate limit; audit (email_change_requested, email_changed).
08. **Breach detection on login (P1):** login'da kiritilgan parolni HIBP'ga async tekshirish (k-anonymity); breach'da bo'lsa → "Parolingiz ma'lum breach'da — o'zgartiring" banner + forced reset flow (login'da o'tkazib, keyin reset majburiy) — P1.
09. **New device login notification** (A-09 bilan bog'liq): risk-based (A-28) signal'da ham.
10. MFA change notification: o'chirish/almashtirishda out-of-band xabar (A-26).
11. Suspicious login (risk high): user notification (vaqt, browser, geo) — A-09 kengaytirish.
12. Notification channels: email + Telegram (settings bo'yicha); preview'da sensitive yo'q.
13. A11y: change flow keyboard; 44px; banner live-region.
14. Mobile: bir ustun; autofill.
15. 4 til: account events stringlar.
16. Security/data guard: password/email hech qachon logga; reauth shart; breach banner sensitive emas.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (password_changed, email_changed, breach_detected).
19. Unit test: password change reauth+reuse; email change ikkala verify; HIBP async.
20. Integration/contract test: change→sessiya revoke→notification; email change double opt-in; breach forced reset.
21. E2E/security test: sessiya o'g'irlangan holda email/password o'zgartirish blok (reauth); IDOR.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga A-29 statusi va next readinessni yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: reauth bo'lmasa yoki email change bitta address'ga verify bo'lsa.
26. Done condition: account security events to'liq, testlar yashil.
27. A-30 uchun: admin hardeningga tayyor ekanini yoz.
28. Breach detect P1 (async, login'da).
29. Email change'da eski email xabari — lockout qarshi.
30. Barcha write path CSRF + audit bilan.
```

## Prompt A-30 — Admin/Teacher hardening

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini (admin hardening) to'liq o'qi; OWASP.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin/teacher account'larini global gigant darajasida mustahkamlash — MFA mandatory, Strict session, re-auth, audit.
05. Precondition: A-26 MFA, A-19 teacher approval, A-25 session yashil.
06. **MFA mandatory** admin/teacher (OWASP: privileged accounts): login'da TOTP/passkey majburiy (skip yo'q); users.role admin/teacher → mfa_required.
07. Admin/teacher session: **SameSite=Strict** (Lax emas), qisqa Max-Age (8 soat), `__Host-` prefix; remember-me yo'q (high-privilege).
08. Admin login rate limit qattiqroq (3 xato → 15 daqiqa); Turnstile har doim.
09. **Re-auth sensitive amallar:** teacher approve, user o'chirish, security settings, roster commit — fresh MFA (mfaAt 30 daqiqa).
10. Admin panel audit: har bir amal (kim, qachon, nima, IP hash) — auth_audit.
11. Admin login session alohida (user session bilan aralashmaydi) — role switch'da session regenerate.
12. IP allowlist (ixtiyoriy, OTM kontekstida): admin faqat OTM IP'laridan (config).
13. Admin account security events: password/email change → email+Telegram; breach detect → forced reset.
14. Suspicious admin login (risk high — A-28) → block + super-admin alert.
15. Admin MFA reset: **super-admin approval** (social engineering qarshi) — A-26.
16. A11y: admin panel keyboard; MFA accessible.
17. 4 til: admin stringlar.
18. Security/data guard: admin credentials hech qachon logga; MFA mandatory bypass yo'q.
19. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
20. Privileged actionlar uchun audit event va zarur metric/trace qo'sh (admin_mfa_required, admin_action).
21. Unit test: MFA mandatory (admin skip blok); Strict cookie; re-auth.
22. Integration/contract test: admin login MFA'siz blok; teacher approve re-auth; role switch session regenerate.
23. E2E/security test: MFA bypass, Strict cookie, admin session IDOR, suspicious block.
24. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
25. `implementation-status-auth.md`ga A-30 statusi va next readinessni yoz.
26. Global report formatida changed files, migration, command va test natijalarini qaytar.
27. Stop condition: admin MFA mandatory bo'lmasa yoki bypass ochiq bo'lsa.
28. Done condition: admin/teacher hardening to'liq, testlar yashil.
29. A-31 uchun: massive final checkpointga tayyor ekanini yoz.
30. Barcha write path CSRF + audit bilan.
```

## Prompt A-31 — Massive Final Checkpoint + sign-off

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: butun auth tizimini global gigant darajasida yakuniy sertifikatlash — massive regression, security, privacy, accessibility.
05. Precondition: A-00..A-30 barcha yashil; operator P2/P3 tasdiqlagan (MFA, passkey, risk, Telegram, HEMIS).
06. **Qatlam-by-qatlam audit:**
07. Parol siyosati: NIST 15/8, HIBP k-anonymity, zxcvbn, no rotation, timing-safe dummy hash.
08. Login: enumeration (bir xil javob+vaqt), lockout (per-IP/account/ASN), MFA step.
09. MFA/TOTP: pending→active, backup codes hash, 5x15 lockout, challenge consumed, MFA reset time-delay.
10. Passkey: Conditional+Modal, counter monotonic, recovery, 2 passkey, settings revoke.
11. OIDC (Google): PKCE S256, JWKS alg allowlist, exact redirect, nonce, refresh rotation.
12. Email: SPF/DKIM/DMARC, transactional alohida, bounce suppress, disposable blok.
13. Session: __Host-, idle+absolute+renewal, remember selector/verifier, logout server-side.
14. Risk-based: fingerprint, impossible travel, velocity, tiers, step-up, privacy (hash, UZ).
15. Account events: password/email change reauth+notify, breach detect, new device.
16. Admin: MFA mandatory, Strict, re-auth, audit.
17. Teacher approval: Entra PIM (72s window, justification, eskalatsiya, audit).
18. Forgot password: OWASP (256-bit token, hash, 15 daqiqa, 1 marta, bir xil javob, no auto-login).
19. HEMIS: xavfsiz yo'llar (OAuth2 rasmiy, eksport/import, ochiq ma'lumotlar); geofence (UZ IP); secret scan (client_id=8 production'da yo'q).
20. **Security testlar (majburiy):** enumeration timing (100 req avg), brute-force distributed, fixation, CSRF, cookie flags, open redirect, alg confusion, replay, counter, IDOR, MFA bypass, teacher escalation, secret/PII scan (grep parol/token/OTP/email log'da yo'q).
21. **Privacy audit:** PII minimal (ip_hash), UZ saqlash, DSAR (eksport/delete), retention 30 kun, consent (email verify).
22. **A11y:** axe 0 critical; keyboard journey (register→verify→login→MFA→passkey→settings).
23. **Accessibility:** barcha ekranlar 44px, contrast, live-region, reduced-motion.
24. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
25. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
26. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
27. Unit test: full auth suite (har modul).
28. Integration/contract test: to'liq user journey (register→verify→login→MFA→teacher approve→reset).
29. E2E/security test: yuqoridagi barcha security testlar.
30. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
31. `implementation-status-auth.md`ga A-31 (CHECKPOINT — FINAL) statusi yoz.
32. Global report formatida changed files, migration, command va test natijalarini qaytar.
33. Stop condition: har qanday critical/high blocker qolsa.
34. Done condition: auth global gigant darajasida, to'liq, xavfsiz; release sign-off tayyor.
35. Operator review va yakuniy sign-off; `research_auth_deep.md` manbalar arxivi; next-version backlog.
```

---

## G. Yakuniy operator qoidasi (FINAL)

- Promptlar ketma-ketligi: A-00→A-31 (32 ta bosqich).
- Checkpointlar: A-17 (Login), A-21 (Register+Teacher), A-25 (Global daraja), A-31 (FINAL).
- Har checkpoint `BLOCKED` bo'lsa keyingi phase ochilmaydi.
- **Manbalar majburiy:** NIST SP 800-63B-4, OWASP CheatSheets (Auth/Session/MFA/Forgot), OAuth 2.1/RFC 9700, Microsoft Entra PIM, Google/Yahoo sender rules, simplewebauthn — `research_auth_deep.md`.
- P2/P3 (MFA, passkey, risk, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) operator tasdig'isiz boshlanmaydi.
- HEMIS: faqat xavfsiz yo'llar; skrepling/parol/undocumented — taqiqlangan; geofence (UZ IP).
- `research_auth.md` (qilinadigan) + `research_auth_deep.md` (manbalar, massive) + `hemis_github.md` (resurslar) — source of truth.
- Har bosqichda `implementation-status-auth.md` ledger; status faqat DONE/PARTIAL/BLOCKED.
- Universitar daraja + global gigant daraja qoidalari butun zanjir bo'ylab majburiy.
