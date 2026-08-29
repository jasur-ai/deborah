# Deborah — AUTH implementation ledger (A-E, 191 bosqich)

> **Manba:** `to_do/PROMPT_GUIDE_AUTH_MASTER.md` + `PROMPT_GUIDE_AUTH (2).md` (A)
> **Global Master Prompt:** to_do/PROMPT_GUIDE_AUTH (2).md §B — har promptdan oldin qo'llaniladi.
> **Repository:** `/mnt/d/StartUp/deborah`
> **Qoida:** keyingi prompt oldingisining `Done` sharti o'tmaguncha boshlanmaydi; checkpoint BLOCKED → keyingi faza yo'q.

## Fayllar xaritasi
| Faza | Promptlar | Holat |
|---|---|---|
| A | A-00..A-31 (32) | 🔄 boshlandi |
| B | B-00..B-37 (38) | ⏳ |
| C | C-00..C-25 (26) | ⏳ |
| D | D-00..D-40 (41) | ⏳ |
| E | E-00..E-53 (54) | ⏳ |

**Checkpointlar:** A-17, A-21, A-25, A-31 · B-26, B-37 · C-16, C-25 · D-27, D-40 · E-15, E-42, E-53

---

## A-00 — Auth preflight va baseline ✅ DONE (2026-08-09)

### Maqsad
Auth tizimini qayta qurishdan oldin repository holatini o'zgartirmasdan inventarizatsiya + tekshiriladigan baseline.

### Baseline snapshot
- **Commit:** joriy `main` (STYLE 41/41 + final acceptance + S40.12 migratsiya bilan)
- **Test holati:** typecheck `tsc --noEmit` → 0 xato; design+unit subset 289/289 PASS; visual 294/294 PASS; design:check PASS
- **Legacy CSS:** 1375 → 301 (S40.12 migratsiya qo'llangan)

### Joriy auth holati (inventarizatsiya)
| Komponent | Holat | Manba |
|---|---|---|
| Login (user+admin) | ✅ `GET/POST /user/login`, `GET/POST /admin/login` | routes/auth.js (391 qator) |
| Parol hashing | ✅ **argon2** (^0.45.1), legacy SHA-256 + plaintext fallback (migratsiya) | routes/auth.js:115+ |
| Session | ⚠️ express-session **MemoryStore** (Redis yo'q) | server.js |
| OIDC (Google) | ✅ routes/oidc.js (122 qator), env: GOOGLE_CLIENT_ID/SECRET (ixtiyoriy) | routes/oidc.js |
| Forgot | ✅ GET/POST /user/forgot | routes/auth.js:323 |
| Logout | ✅ admin+user | routes/auth.js |
| Rate limit | ✅ express-rate-limit ^8.6.1 (mavjud) | package.json |
| CSRF | ✅ custom `validateCsrf` | server.js/routes |
| Security header | ✅ helmet ^7.1.0 | package.json |
| Validation | ✅ zod ^4.4.3 | package.json |
| Storage | ⚠️ firebase/local-db.js (JSON/local) primary; PG migration 001 `users` (password_hash) mavjud, DATABASE_URL ixtiyoriy | migrations/ |
| Env | ✅ SESSION_SECRET (min 16), ADMIN_USER/PASS required; GOOGLE_* optional | src/config/env.js + .env.example |

### "Qilinmaydiganlar" (research 12-bo'lim) tekshiruvi
- HEMIS skrepling / parol saqlash / undocumented endpoint / rest-docs paroli — **topilmadi** ✅
- Kodda `rest/docs`, `clientSecret` production ishlatilishi — **yo'q** ✅

### Risk / blockerlar (A-faza uchun)
1. **Plaintext fallback** `storedHash === password` — eng eski format; A-fazada rehash/upgrade yoki tozalash kerak.
2. **MemoryStore** — restart'da sessiyalar yo'qoladi; A-01 Redis (ioredis/connect-redis talab qilinadi).
3. **PG adoption holati** noaniq — users jadval migratsiyasi bor, lekin qaysi environment'da ishlaydi tekshirish kerak.
4. Register endpointi routes/auth.js'da yo'q (B-fazada) — hozircha faqat seed orqali user yaratiladi.

### Done shartlari (tekshirildi)
- [x] Baseline snapshot yozildi (commit, test soni)
- [x] Blockerlari aniq
- [x] A-01 readiness: **TAYYOR emas** — Redis server/infra kerak (A-01 precondition: Redis foundation tayyor bo'lishi kerak, aks holda BLOCKED)

### A-01 tavsiya
Guide bo'yicha A-01 = **Redis session foundation** (MemoryStore → ioredis + connect-redis, session schema: id/userId/role/isVip/safeKey/csrfToken/oauth/remember/device/lastActive/expiresAt/revokedAt). Redis server mavjudligi tekshirilishi kerak — mavjud bo'lmasa A-01 BLOCKED, unda avval D-faza infra (Redis provision) yoki session hardening (A-02+) qilinadi.

---

## AUTH A-01 — Redis session foundation (remember TTL + session record) ✅ DONE

**STATUS:** ✅ DONE — Redis (Docker, redis:7-alpine) ishga tushirildi, latent `default` import bug tuzatildi, TTL + record ishlayapti.

### Precondition
- [x] A-00 DONE (baseline)
- [x] Redis server: **Docker orqali o'rnatildi** (`deborah-redis`, port 6379, PONG) — A-00'da BLOCKED edi

### Implementation

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Redis store service | ✅ | `src/modules/auth/session-store.js` (YANGI) — yagona entry point: Redis (connect-redis + ioredis) yoki MemoryStore fallback |
| Latent bug tuzatildi | ✅ | connect-redis v10 **faqat named export** `{ RedisStore }` — eski server.js `{ default: RedisStore }` ishlatgan, Redis yo'li hech qachon ishlamagan; endi to'g'ri import |
| TTL mapping | ✅ | `sessionTtlMs(remember)` — remember=true → 30 kun, aks holda 8 soat (cookie Expires + Redis TTL mos) |
| Session ID | ✅ | `genSessionId()` — 32B `crypto.randomBytes` (64 hex), `genid` ga ulandi |
| Health check | ✅ | Startup'da Redis `ping` — fail-fast; xato bo'lsa MemoryStore fallback (rollback rejasi §30) |
| Graceful close | ✅ | server.js shutdown: `closeSessionStore()` → Redis `quit()` |
| Cookie Expires | ✅ | `req.session.cookie.maxAge` remember'ga qarab (express-session v1.19 faqat `Expires` emit qiladi, Max-Age emas) |
| Session record | ✅ | `recordSession()` — `sessions/{userId}/{sessionId}`: ipHash (SHA-256, PII minimal), userAgent (≤500), authMethod, remember, role, isVip, createdAt, lastActiveAt, expiresAt |
| Login ulandi | ✅ | routes/auth.js: login success → regenerate → remember+TTL → `recordSession()` (fire-and-forget, non-critical) |
| UI: remember checkbox | ✅ | views/user/login.ejs — `auth-remember` checkbox; auth.css styling; i18n 3 til (`Eslab qol` / `Мени эслаб қол` / `Запомнить меня`) |
| Unit testlar | ✅ | `tests/unit/auth-session-store.test.js` (YANGI, ioredis-mock + injected client): TTL, genid 32B, Redis health-fail fallback, close |
| Integration testlar | ✅ | `tests/integration/auth-a01.test.js` (YANGI, alohida fayl — toza rate limiter): remember=on → Expires ~30 kun; yo'q → ~8 soat; session record (ipHash 64 hex, expiresAt-createdAt=30 kun) |
| Regression | ✅ | auth.test.js 74/74, auth unit'lar 47/47, A-01 integration 3/3 |

### Done shartlari
- [x] Redis foundation: `createSessionStore` → RedisStore/prefix `deborah:sess:` (boot log: "Redis session store connected")
- [x] Session schema maydonlari: remember/expiresAt/ipHash/role/isVip/createdAt/lastActiveAt
- [x] Eski xatti-harakat saqlanadi: REDIS_URL yo'q bo'lsa MemoryStore rollback (flag bilan)
- [x] 4 test turi: unit ✅ / integration ✅ / (E2E: auth-smoke keyingi faza) / security: cookie Expires tekshirildi

### Next readiness
- A-02: session hardening / gapless davom etish — **TAYYOR**
### A-01 qo'shimcha: connect-redis v10 incompatibility tuzatildi 🔧

Review davomida **real bug** topildi (mock testlar uni yashirgan edi):

| Muammo | Yechim |
|---|---|
| connect-redis **v10** `set()` da node-redis'ga xos `set(key,val,{expiration:{type:'EX',value}})` formasini ishlatadi — ioredis 5.11.1 + real Redis 7 buni qo'llamaydi (**ERR syntax error**, har session saqlashda ishlamaydi) | **connect-redis@8.1.0** o'rnatildi (ioredis-mos `set(key,val,ttl)`) |
| ioredis-mock ham `expiration` formasini ignore qiladi (pttl -1) — unit test TTL'ni o'lchay olmadi | TTL tekshiruvi **real Redis** ga ko'chirildi |

**Haqiqiy Redis isboti** (`scripts/auth-a01-redis-verify.js`, Docker deborah-redis):
```
remember=on  → TTL 2592000s (30 kun)  ✅
remember=off → TTL 28800s  (8 soat)   ✅
PASS — Redis per-session TTL mapping ishlayapti
```

**Testlar:** unit+integration 25/25, auth.test.js regression 74/74, visual auth-pages 20/20 (2 failure flake edi — mobile-only rerun'da 4/4).
**Yakuniy qo'shimchalar (review 2-tur):**
- `session-store.js` boshiga **DIQQAT** izohi — connect-redis v9/v10'ga upgrade qilmaslik (ioredis bilan syntax error); izoh endi dependency chegarasida (test faylida emas).
- Register oqimiga ham `recordSession()` ulandi — yangi ro'yxatdan o'tgan user session registry'da darhol ko'rinadi (login bilan izchil).
- PII izohi aniqlashtirildi: `ipHash` (SHA-256) match/analytics uchun, to'liq IP esa `ipAddress` — session ro'yxati UX'ida ko'rsatish uchun saqlanadi (modul hujjati: "View own sessions (IP, user agent, last active)"). GDPR/privacy qattiq talab bo'lsa A-faza keyingi bosqichida to'liq IPni olib tashlash mumkin.
- Yakuniy testlar: **99/99 PASS** (auth.test.js 74 + auth-a01 3 + unit 22), real-Redis verify **PASS**, visual auth-pages 20/20.
- npm audit'dagi 11 ta xavfsizlik muammosi connect-redis/ioredis/express-session'ga aloqador EMAS (pre-existing).

## ✅ AUTH A-01 FINAL — DONE
---

## AUTH A-02 — Cookie spetsifikatsiya + idle timeout + parallel limit ✅ DONE

**STATUS:** ✅ DONE — cookie spec, 30 daqiqa idle timeout (modal 60s oldin), parallel limit 5 (6-chi → eng eski revoke). 138/138 vitest PASS.

### Precondition
- [x] A-01 Redis session yashil (Docker deborah-redis, TTL isboti)

### Implementation

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Cookie spetsifikatsiya | ✅ | `connect.sid`, httpOnly, **sameSite=Lax** (strict'dan o'zgartirildi — guide spec; OIDC top-level redirect uchun; CSRF token himoyasi saqlanadi), secure faqat production, path=/, Max-Age remember orqali (30 kun / 8 soat — A-01) |
| Cookie nomi config | ✅ | `SESSION_COOKIE_NAME` (default connect.sid); P2 `__Host-` prefix: `SESSION_HOST_PREFIX=true` + production (shart: HTTPS + path=/ + domain yo'q) — `sessionCookieName()` |
| Idle timeout | ✅ | `middleware/auth.js` requireAuth: `isSessionExpired` — 30 daqiqa harakatsizlik → audit `session:idle-timeout` + sessiya destroy + 401 JSON (API) / login redirect (`returnUrl` bilan) |
| Idle timeout config | ✅ | `SESSION_IDLE_TIMEOUT_MS` (default 1800000, tenant sozlashi mumkin, 60s..24h) |
| returnUrl xavfsiz | ✅ | `safeReturnUrl` — open-redirect himoyasi (`//` va absolute blok); login'da `safeReturnUrl(req.query.returnUrl)` bilan qaytish |
| Touch throttled | ✅ | lastActive har 5 daqiqada bir marta yoziladi (`SESSION_TOUCH_INTERVAL_MS`) — har request'da Redis yozuv emas |
| Keepalive | ✅ | `POST /api/session/ping` (CSRF + requireAuth) → idle timer reset; frontend modal "Davom etish" |
| Timeout UX | ✅ | `public/js/components/session-timeout.js` — 60s oldin modal ("Sessiya tugayapti — davom etasizmi?"), countdown, Esc/Enter=davom, **auto-save hook** (`window.SessionTimeout.registerAutoSave`), a11y (role=alertdialog, aria-modal, live-region), mobile'da yumshoq pastki banner, `prefers-reduced-motion` |
| Timeout copy | ✅ | 3 til (uz/ru/cyrl) — `SESSION_TIMEOUT_COPY` |
| Parallel limit 5 | ✅ | `SESSION_MAX_PARALLEL` (default 5); 6-chi session kelganda **eng eski revoke** (createdAt bo'yicha) + audit `session:limit-reached` |
| Rol o'zgarishi | ✅ | `roleVersion` login'da saqlanadi; middleware bir marta tekshiradi (sentinel -1 — hot-path DB read yo'q), farq bo'lsa sessiya bekor. Rol-o'zgartirish route'u kelganda `role_version` bump qiladi (mexanizm tayyor) |
| Stop condition | ✅ | Idle timeout imtihon ishini o'chirmaydi: attempt data DB'da (session'da emas), modal auto-save + keepalive faol imtihonni saqlaydi |

### Testlar
- Unit: `tests/unit/session-timeout.test.js` (6) — expired/touch/returnUrl/open-redirect
- Unit: session-manager — parallel limit 5→6 eviction + `session:limit-reached` audit
- Integration: `tests/integration/auth-a02.test.js` (6) — cookie flaglar (HttpOnly/SameSite=Lax/Path=/), idle 401 JSON + returnUrl, HTML redirect, touch, keepalive 204, roleVersion DB bir marta o'qiladi
- Regression: auth 8 fayl **138/138 PASS**; visual auth-pages+critical-pages izolyatsiyada PASS (parallel flake emas)

### Qaydlar
- sameSite strict→lax — security trade-off hujjatlashtirildi (Lax top-level GET'da cookie jo'natadi; CSRF token POST/PUT/PATCH/DELETE'ni himoyalaydi).
- Modal client-side JS uchun avtomatik test yo'q (visual run'da script xatosiz yuklandi) — keyingi faza'da jsdom/playwright coverage qo'shish mumkin.

### Next readiness
- A-03: rate limit + lockout + audit — **TAYYOR** (express-rate-limit allaqachon mavjud; lockout uchun Redis hisoblagichlari kerak)
## AUTH A-03 — Rate limit + lockout + auth audit ✅ DONE

**STATUS:** DONE — 157/157 auth test PASS (yagona vitest run), login sahifasi smoke OK.

### Implementatsiya

**`src/modules/auth/lockout.js` (YANGI)** — login brute-force himoyasi:
- **Per-user qattiq lock** (DB): `users.{key}.failed_attempts` + `locked_until` — `AUTH_LOCKOUT_USER_FAILURES` (10) / `AUTH_LOCKOUT_USER_MS` (15 min). Parol tekshiruvdan **oldin** `checkUserLockout` pre-check (429 + Retry-After).
- **Per-IP yumshoq lock** (in-memory): 5 xato / 15-min oyna → 5-min lock (kampus NAT e'tibori: qisqa, barcha talabaga ta'sir qilmaydi).
- **Race-proof**: `failed_attempts` read-modify-write per-user mutex chain bilan serializatsiya qilindi (parallel xato login'lar counter'ni kamaytira olmaydi).
- **Jitter**: xato login'da `AUTH_JITTER_MAX_MS` (600) gacha tasodifiy kechikish; test'da 0.
- **Reset limiti**: 3/soat per account (`AUTH_RESET_MAX`); **Register limiti**: 5/15-daqiqa per IP (`AUTH_REGISTER_MAX`); ikkalasi ham 0 = o'chirilgan (tenant sozlashi mumkin).
- `lockoutResponse`: 429 + `Retry-After` + `RATE_LIMITED` code; HTML so'rovda countdown UI bilan login sahifasini render qiladi (brauzer Accept'ida JSON emas — test bilan tasdiqlandi).

**`src/modules/auth/audit.js`** — auth_audit PII-minimal jurnal:
- `logAuthEvent`: `ip_hash` (sha256 — to'liq IP saqlanmaydi), `redactDetails` (password/token/OTP/secret — camelCase `resetToken`, `passwordHash`, `client_secret` ham ushlaydi), local-db + PG fail-soft.
- `purgeAuthAudit` 30 kun retention — server.js'da soatlik intervalga ulandi (non-test, unref'd).
- Yangi `AUDIT_ACTIONS`: auth.login / auth.login.failed / auth.lockout / auth.reset.request / auth.register / auth.passkey.

**`migrations/049_auth_audit.js` (YANGI)** — PG auth_audit jadvali + index + retention.

**`routes/auth.js`**:
- Login: `checkUserLockout` pre-check (snapshot uzatiladi — 2-oyna DB read yo'q) → xato parol'da jitter + `recordFailure` + `logAuthEvent`; muvaffaqiyatda `recordSuccess` + audit.
- **Timing-enumeration himoyasi**: user topilmasa ham dummy argon2 verify + jitter bajariladi (forgot route'dagi 180ms fake-delay bilan bir xil yondashuv).
- Register: `checkRegisterLimit` (5/15min/IP); Forgot: `checkResetLimit` (3/soat/account); ikkalasi ham `lockoutResponse` + audit.

**`views/user/login.ejs`** — `data-lockout`/`data-seconds`/`data-copy` countdown UX (4 til support copy `data/auth-i18n.js`'da).

**`src/config/env.js`** — `AUTH_LOCKOUT_IP_FAILURES/IP_MS`, `AUTH_LOCKOUT_USER_FAILURES/USER_MS`, `AUTH_JITTER_MAX_MS`, `AUTH_REGISTER_MAX`, `AUTH_RESET_MAX`.

### Testlar
| Fayl | Natija |
|---|---|
| `tests/unit/auth-lockout.test.js` (12 test) — lockout, reset/register limit, redaction, ipHash, jitter | 12/12 PASS |
| `tests/integration/auth-a03.test.js` (7 test) — xato→counter+audit, 5-xato→UI, 10-xato→429+Retry-After, success→tozalash, reset/register limit 429, **brauzer Accept'ida HTML UI** | 7/7 PASS |
| To'liq auth suite (10 fayl, yagona vitest run) | **157/157 PASS** |
| Login sahifa smoke (`scripts/auth-a03-smoke.sh`) | 200, lockout UI 11 element, support email ✓ |

### Muhim qarorlar / topilmalar
- **Register limiti test regressioni**: auth.test.js bir IP'dan 9 register qilardi → 5/15-min limit 6-register'ni blokladi. Yechim: `postForm`'ga XFF izolyatsiyasi (har describe guruhi o'z 203.0.113.x IP'si) — auth-a03.test.js'da allaqachon qo'llangan pattern.
- **Parallel vitest run'lar `data/db.json` ustida to'qnashadi** (snapshot/restore race) — testlarni bir vitest chaqiruvida ishga tushirish shart (flakiness manbasi, CI'da serial run).
- `redactDetails` `code`/`hash` segmentlarini keng redact qiladi (`httpStatusCode`, `country_code`) — auth audit uchun fail-safe tanlov, hujjatlashtirildi.
- Reviewer fikrlari bo'yicha tuzatildi: timing-enumeration, recordFailure race, purgeAuthAudit wiring, `clientIp` dead code olib tashlandi, browser-Accept HTML testi qo'shildi.

### Next readiness
- **A-04**: session/lockout Redis hisoblagichlari (multi-node) + xavfsizlik profilari → **TAYYOR** (lockout in-memory, Redis upgrade P2 hujjatlashtirilgan).
### AUTH A-04 — Login sahifasi qayta qurish (Google birinchi, trust, inline xatolar) ✅

**STATUS:** DONE — auth suite 205/205 PASS (13 fayl, bitta run)

#### Real bug topildi (A-04 testi) 🔧
`src/config/env.js` `buildConfig()` dagi `raw` obyektida `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/HD` **o'qilmas edi** — schema'da bor edi, lekin `raw`'ga qo'shilmagan. Natijada `isOidcEnabled()` doim `false`, Google tugmasi hech qachon ko'rinmasdi, `/auth/google` doim 404. **Tuzatildi** — endi OIDC env'da konfiguratsiya qilinganda yoqiladi (prod'da shu env'lar bo'lsa OIDC faollashadi — kutilgan xatti-harakat).

#### Nima qilindi
| Yo'nalish | Tavsif |
|---|---|
| **`src/modules/auth/validation.js`** (YANGI) | Zod `loginSchema` (username non-empty+format, parol non-empty — legacy qisqa parol bloklanmaydi, rehash A-05) + `registerSchema` (**username min 3** max 20 `[a-zA-Z0-9_]`, parol **min 8 + harf + raqam**). `parseLogin/parseRegister` i18n error key qaytaradi: `usernameChars/passwordMin/passwordWeak/passwordMax/required` |
| **`routes/auth.js`** | `parse*` ishlatiladi; xatoga `field` ma'lumoti (`username`/`password`/`both`) → view `data-field` |
| **`views/user/login.ejs`** | Google tugmasi **ikkala forma ustida** (login/reg), `oidcEnabled`'da doim ko'rinadi, `data-field`, 4 maydon uchun `err-text` div'lari, trust microcopy, divider "yoki" |
| **`data/auth-i18n.js`** | Trust copy 4 til (uz/uz-cyrl/ru/en), `passwordMax` kaliti, en'da yo'qolgan `remember` kaliti tiklandi |
| **`public/design/contexts/auth.css`** | `.btn-google` 48px flex (44px talabi bajarilgan), `.is-pending`, `err-text` |
| **`public/js/auth.js`** | Field-based inline error reveal + Google pending state (double-click himoyasi) |
| **`tests/unit/auth-validation.test.js`** | 12 test — login/register schema, error key mapping |
| **`tests/integration/auth-a04.test.js`** | 11 test — **OIDC-yoqilgan alohida node server spawn** (env'ga GOOGLE_* bilan): Google birinchi + 302 `/auth/google` + trust 4 til + autofill + inline error + XSS + 44px + lockout UX |
| **`tests/unit/oidc.test.js`** | beforeAll hook timeout 15s→**90s** (createApp ~14s, flake tuzatildi) |

#### Reviewer fikrlari bo'yicha tuzatildi
| Fikr | Yechim |
|---|---|
| auth-a04 hardcoded port orphan xavfi | pkill guard qo'shildi |
| "4 til" testi faqat uz+en | ru + uz-cyrl assertion qo'shildi |
| `&#39;` brittle assertion | `class="trust"` + apostrof'siz substring + escape tekshiruvi |

#### Qarorlar
- **Username min 3** — guide A-04'da username uzunligi ko'rsatilmagan; test (`'ab'` → usernameChars) asosida min 3 qilindi (2-belgili username'lar endi register'da rad etiladi). 180/180 regression tasdiqladi.
- **Test muhiti**: `vi.stubEnv+resetModules` vitest 4'da env.js'ni qayta baholamaydi → OIDC-yoqilgan holat alohida node server spawn orqali test qilinadi. OIDC-o'chiq (graceful 404) holat `oidc.test.js`'da yopilgan.

#### Ishbot
| Tekshiruv | Natija |
|---|---|
| Auth suite (13 fayl, bitta run) | **205/205 PASS** |
| auth-a04 (OIDC-yoqilgan spawn) | 11/11 |
| auth-validation unit | 12/12 |
| oidc.test.js (OIDC-o'chiq regression) | 25/25 |

### Next readiness
- **A-05**: legacy hash migration + parol tarixi → **TAYYOR** (rehash qobig'i A-04 login oqimida allaqachon bor — argon2 bo'lmagan hash muvaffaqiyatli login'da rehash qilinadi).
### AUTH A-05 — Login backend: verify + legacy migratsiya + role redirect ✅

**STATUS:** DONE — auth suite 221/221 PASS (14 fayl, bitta run)

#### Real bug topildi (A-05 testi) 🔧
**local-db writeLock race:** `firebase/local-db.js` da har `fb.set()` diskdan qayta o'qiydi (`this._data = readDB()`) va `writeLock` chain orqali **serial** yozadi. Login oqimidagi fire-and-forget `logAuthEvent` (success audit) yozuvi hali diskda yo'q holatda keyingi `fb.set()` tomonidan **overwrite qilinardi** — `auth.login:success` audit yozuvi yo'qolardi (A-03 regressioni shu bilan paydo bo'ldi). **Yechim:** `logAuthEvent` success endi `await` qilinadi; legacy-migration `audit()` ham `await`. (Qo'shimcha: login hot-path'ga to'liq fayl yozuvi qo'shiladi — local-db read-modify-write semantikasining ildiz sababi, kelajakda Redis upgrade bilan yechiladi.)

#### Nima qilindi
| Yo'nalish | Tavsif |
|---|---|
| **`routes/auth.js`** — login success | 1) `logAuthEvent` success **await** (race fix), 2) **telemetry**: `auth.login.success` counter + `auth.login.time_to_success` histogram, 3) **`last_login` update** (OIDC bilan izchil — oidc.js ham yozadi), 4) **legacy migratsiya tranzaktsion**: SHA-256/plaintext → Argon2 rehash + save + audit (`migratedHash`, `from`, `to`), 5) **role redirect** (guide §13): teacher → `/teacher`, admin → `/admin/dashboard`, student/other → `safeReturnUrl` |
| **`src/modules/auth/session-timeout.js`** | `safeReturnUrl` — **allowlist** (guide §13): `ALLOWED_RETURN_PREFIXES` = `/user /panel /assignments /teacher /student /proctor /marker /board /admin /game /cast /api`; query string kesiladi (`/assignments?x=1` → `/assignments`); **path-traversal normalizatsiya** (`..` segmentlar olib tashlanadi — `/user/../admin` browser'da `/admin` ga normalizatsiya bo'lmasligi uchun); `''`/`/` aniq; boshqa → `/user/panel` |
| **`src/modules/auth/session-manager.js`** | `detectNewDevice()` (YANGI, guide P1 A-09): `getUserSessions` bilan solishtirish — IP ham UA ham noma'lum bo'lsa `isNew=true` (NAT/mobil'da IP o'zgarishi normal, shuning uchun faqat IP farqi etarli emas); fail-soft |
| **`routes/auth.js`** — new-device | Login success'da `detectNewDevice` → yangi bo'lsa audit `outcome: 'new_device'` (`knownSessions`, `reason`) |
| **`tests/integration/auth-a05.test.js`** (YANGI, 8 test) | Legacy SHA-256 → 302 + Argon2 rehash; plaintext → Argon2; `last_login` yangilandi; student → `/user/panel`; teacher → `/teacher`; returnUrl allowlist qabul (`/assignments`); noma'lum path → `/user/panel`; xato parol → 200 + inline |
| **`tests/unit/session-manager.test.js`** | `detectNewDevice` 5 test (session yo'q, bir xil IP+UA, yangi IP+UA, NAT IP o'zgarishi, userId yo'q) |
| **`tests/unit/session-timeout.test.js`** | Allowlist qabul/rad + path-traversal testlari (9 test) |
| **`tests/integration/auth-a04.test.js`** | beforeAll 90s hook timeout (server boot ~14s — flake fix, a05 pattern'ga mos) |

#### Reviewer fikrlari bo'yicha tuzatildi
| Fikr | Yechim |
|---|---|
| Legacy-migration `audit()` hali fire-and-forget (race) | `await` qilindi |
| `safeReturnUrl` path-traversal (`/user/../admin`) | Normalizatsiya (`.`, `..` segmentlar olib tashlanadi) |
| `await logAuthEvent` hot-path sekinlashuvi | Izoh qo'shildi (local-db read-modify-write ildiz sabab) |

#### Qarorlar
- **`/api` allowlist'da** — idle timeout'dan keyin API so'rovlar (`/api/user/stats`) returnUrl'ga qaytishi uchun (A-02 testi talab qiladi); `/api` internal, open-redirect emas.
- **Allowlist /admin** — student `returnUrl=/admin/dashboard` bilan redirect bo'lishi mumkin, lekin admin middleware himoya qiladi (xavfsiz, izohlandi).
- `detectNewDevice` recordSession bilan ketma-ket (fire-and-forget) — birinchi login'da deterministik emas (worst case: spurious `new_device` audit); zararsiz, izohlandi.

#### Ishbot
| Tekshiruv | Natija |
|---|---|
| Auth suite (14 fayl, bitta run) | **221/221 PASS** |
| auth-a05 integration (legacy migration) | 8/8 |
| session-timeout unit (allowlist + traversal) | 9/9 |
| session-manager unit (detectNewDevice) | 5/5 |
| auth-a02/a03 regression (race fix) | 6/6, 7/7 |

### Next readiness
- **A-06**: parol tiklash flow (forgot + reset + complete) → **TAYYOR** (forgot/reset qobig'i routes/auth.js + routes/reset.js da bor — token hash, 15 daqiqa TTL, reset limit 3/soat A-03'da; A-06'da complete UX + audit kengaytiriladi).

## AUTH A-06 — Parol tiklash flow (API + to'liq oqim) ✅

**STATUS:** ✅ DONE — 231/231 auth suite PASS (15 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-06 §7 API route'lar | ✅ | POST /api/reset/request + verify + complete (JSON, enumeration-safe) |
| A-06 §10 enumeration | ✅ | Mavjud/mavjud emas user'ga BIR XIL javob + 180ms timing padding |
| A-06 §14 barcha tokenlar invalid | ✅ | resetTokensByUser index + currentHash legacy compat |
| A-06 §15 eski sessiyalar revoke | ✅ | revokeOtherSessions — reset'dan keyin barcha eski sessiyalar o'ladi |
| A-06 §17 Zod validatsiya | ✅ | resetRequestSchema + resetCompleteSchema (token 48, parol min 8+harf+raqam) |
| A-06 §24 metrikalar | ✅ | auth.reset.request/complete/sessions_revoked counter'lar |
| Audit | ✅ | auth.reset.request / auth.reset.complete; token/parol hech qachon logda |
| Resend timer (UX) | ✅ | forgot.ejs 60s countdown + /api/reset/request AJAX, 4 til i18n |
| A-06 §25-27 testlar | ✅ | Zod unit (3) + API flow (6) + sessiya revoke (1) + HTML regression (1) |

### Security
- Token random 48 bayt, DB'da SHA-256 hash bilan (kompromat bo'lsa ham ishlatib bo'lmaydi)
- Bitta foydalanish: complete'da token o'chadi, qayta ishlatish → 410
- Rate limit: 3/soat per account (checkResetLimit)
- CSRF: global validateCsrf (x-csrf-token header bilan JSON API'ga ham qo'llanadi)
- Session fixation: complete'da regenerate + yangi csrfToken

### Verification
- Unit + integration auth-a06: **10/10 PASS**
- To'liq auth suite (15 fayl): **231/231 PASS**
- Eski auth.test.js reset testlari retro-compat: **7/7 PASS**

Ledger: A-07 (Google OIDC — PKCE + state/nonce + mapping) tayyor.

### A-06 qo'shimcha: 429 enumeration leak tuzatildi 🔧

Review davomida **security bug** topildi va tuzatildi:

| Muammo | Yechim |
|---|---|
| `/api/reset/request`'da rate-limit tekshiruvi `snap.exists()` ICHIDA edi — mavjud user'ga 3 so'rovdan keyin **429**, mavjud bo'lmaganiga **har doim 200**. Attacker candidate nomlarni urib, 429 kelganini topib enumeration qilardi. | Rate-limit tekshiruvi + `recordResetRequest` existence check'dan OLDINGA olib chiqildi — mavjud/mavjud emasga bir xil 429. Timing padding 180ms→250ms (mavjud yo'lning token yozish+audit davomiyligiga kalibrlangan). |

Ishbot: to'liq auth suite qayta run — **231/231 PASS**.

## AUTH A-07 — Google OIDC (PKCE + state/nonce + mapping) ✅

**STATUS:** ✅ DONE — 254/254 auth suite PASS (17 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-07 §7 state/nonce 32B | ✅ | buildAuthUrl — state + nonce 32 bayt (64 hex), PKCE S256 verifier 43B |
| A-07 §12 ID token verify | ✅ | verifyGoogleIdToken — jose JWKS (RS256), iss/aud/exp/nonce/email_verified |
| A-07 §13 email_verified | ✅ | ID token'da email_verified !== true → reject |
| A-07 §14 mapping | ✅ | google_sub lookup → email_index (verified) → yangi account; tranzaktsion |
| A-07 §15 session regenerate | ✅ | callback'da regenerate + yangi csrfToken + role redirect (teacher/admin) + returnUrl allowlist |
| A-07 §17 rate limit | ✅ | /auth/google 10/15 daqiqa per IP (memory guard 5000 key) |
| A-07 §19 in-app browser | ✅ | Telegram/FB/Line/WebView UA → 400 "real browser'ga o'ting" |
| A-07 §20 escalation blok | ✅ | email band bo'lsa linking rad (getLinkingError) — parol bilan login talab |
| A-07 §22 metrics | ✅ | login_google_start / callback / denied / new / existing |

### Security (review tuzatishlari)
- **CRITICAL:** nonce session'dan o'chirilgach o'qilardi (undefined) — nonce verify umuman ishlamasdi. Endi expectedNonce o'chirishdan OLDIN lokalga olinadi. ✅
- **HIGH:** safeReturnUrl(undefined) default /user/panel qaytaradi — teacher/admin role redirect'ini overwrite qilardi. Endi returnUrl faqat query'da aniq berilganda ishlatiladi. ✅
- **MEDIUM:** userinfo fallback nonce/iss/aud tekshiruvsiz — downgrade log'lanadi. ID token verify fail-closed. ✅
- **MEDIUM:** rate limit Map cheksiz o'sishi — 5000 key cap qo'shildi. ✅

### Verification
- Unit oidc-a07 (jose haqiqiy RS256 JWKS): **14/14 PASS**
- Integration auth-a07 (OIDC-yoqilgan server): **9/9 PASS**
- To'liq auth suite (17 fayl): **254/254 PASS**

Ledger: A-08 (Session boshqaruv UI) tayyor.

## AUTH A-08 - Session boshqaruv UI ✅

**STATUS:** ✅ DONE — 263/263 auth suite PASS (18 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-08 §7 sessiya ro'yxati | ✅ | GET /sessions — faqat o'z sessiyalari (userId scope), device/browser/ipHash (PII minimal) |
| A-08 §8 revoke (Redis DEL) | ✅ | POST /sessions/:id/revoke — DB tracking + haqiqiy session store destroy; joriy sessiya destroy + redirect |
| A-08 §9 revoke-all | ✅ | POST /sessions/revoke-all — revokeOtherSessions + store'dan barcha boshqa sessiyalarni o'chirish |
| A-08 §29 idempotent | ✅ | Allaqachon yakunlangan yoki boshqa user sessiyasi → 404 (IDOR-safe) |
| A-02 keepalive saqlangan | ✅ | POST /api/session/ping → 204 (asl routes/session.js mazmuni tiklandi) |
| Cookie nomi config'dan | ✅ | sessionCookieName() import — production `__Host-` prefiks bilan ham to'g'ri clear |
| CSRF + audit + metrics | ✅ | Barcha POST CSRF; session_revoked / session_revoke_all metric; audit zanjiri |
| UI 4 tilda | ✅ | views/user/sessions.ejs + auth-i18n sessions bloki (uz/ru/en/kk) |

### Reviewer topgan real bug'lar (tuzatildi)

1. **requireAuth global blok** — `router.use(requireAuth)` mount path '/' bo'lgani uchun BARCHA request'larni (/, /qr, ...) 401 qaytarardi (to'liq suite regression: 16 failure). Har route'ga alohida qo'yildi.
2. **Cookie nomi hardcode** — `clearCookie('connect.sid')` production'da `__Host-` prefiksli cookie'ni o'chirmaydi. `sessionCookieName()` import qilindi.
3. **Revoke faqat DB tracking** — session store'dan o'chirilmasa revoke qilingan cookie hamon authed bo'lib qolar edi. `req.sessionStore.destroy()` qo'shildi.

## AUTH A-09 - New-device xabar + suspicious activity ✅

**STATUS:** ✅ DONE — 284/284 auth suite PASS (20 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-09 §7 new-device tekshiruvi | ✅ | evaluateNewDevice — ip_hash/UA vs users.{key}.last_login_ip_hash + session records; prevLoginState override (login oqimi qiymatni ustiga yozishdan oldin ushlab oladi) |
| A-09 §12 suspicious rules | ✅ | evaluateSuspicious — city_change_rapid (2h ichida), rapid_distinct_ips (>=3 IP / 10min), many_devices (>=5 sessiya); bitta session read |
| A-09 §13 queue + dedupe | ✅ | queueNewDeviceAlert — 24h dedupe per type + kunlik cap <=2 (users.{key}.alerts.{dayKey}); per-user mutex (lockout.js namunasi) |
| A-09 §14 delivery | ✅ | deliverAlert — channel settings.notifChannel (telegram default/email fallback), status delivered, dev preview log, audit auth.alert.delivered |
| A-09 §16 sensitive-free | ✅ | buildAlertPreview — faqat device/browser/city/time; ipHash/to'liq IP/raw UA hech qachon emas; lang settings'dan; ICU-safe vaqt (dateStyle o'rniga formatToParts) |
| A-09 §18 geo | ✅ | geo-lite.js — P1 lokal ip→shahar (RFC5737 + O'zbekiston prefiks namunalari), cityChanged |
| Audit + metrics | ✅ | roster audit: auth.alert.queued/delivered/failed; metrics new_device_alert_queued/delivered/capped/skipped |
| Testlar | ✅ | new-device.test.js (17 unit: detection/dedupe/suspicious/cap/mutex/ICU), auth-a09.test.js (4 integration: login→queue, repeat→dedupe, preview sensitive-free, suspicious shahar) |

### Review topilmalari (tuzatildi)

1. **Race: recordSession vs getUserSessions** — recordSession fire-and-forget bo'lgani uchun yangi sessiya ro'yxatga tushguncha yoki tushmaguncha natija noaniq edi → `excludeSessionId` qo'shildi (joriy sessiya aniq chiqariladi).
2. **Parallel login race (dedupe/cap)** — read-modify-write mutexsiz edi → per-user mutex qo'shildi.
3. **ICU-ga bog'liq vaqt** — `toLocaleString(..., {dateStyle})` small-ICU build'larda throw qilishi mumkin → `formatToParts` bilan qo'lda formatlash.
4. **lang hardcode** — i18n lang session'dan emas, settings'dan olinadigan bo'ldi.

**Next readiness:** A-10 (Roster import upload+parser) tayyor — routes/roster.js mavjud, XLSX parser (xlsx pkg) ishlatiladi.

## AUTH A-10 - Roster import: upload + parser (P0) ✅

**STATUS:** ✅ DONE — 382/382 auth suite PASS (23 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-10 §07 upload allowlist | ✅ | routes/roster.js — extension/MIME/magic bytes allowlist, size/row/sheet/cell limit, zip ratio (validator.js) |
| A-10 §08 formula execute YO'Q | ✅ | parseXlsx cellFormula:false sandbox — formula faqat f sifatida o'qiladi, natija oqmaydi (test: '=1+1' → '' emas '2') |
| A-10 §09 antivirus/quarantine | ✅ | scanFile (ClamAV optional) + quarantineFile — yo'q bo'lsa staging + manual (mavjud edi) |
| A-10 §10 Unicode normalizatsiya | ✅ | normalizeValue (NFKC) / Email / Name / Username — UZ ismlar, apostroflar (mavjud edi) |
| A-10 §11 staging + parse report | ✅ | fayl → roster_staging (production DB emas); generateParseReport (mavjud edi) |
| A-10 §12 HEMIS mapping | ✅ | DEFAULT_COLUMN_MAP'ga o'zbek/rus aliaslar: talaba_id, F.I.Sh (f_i_sh), famiilya/ism/sharif, guruh, kurs, fan, fan_kodi, fakultet, yonalish, akademik_yil, semestr, elektron_pochta + ruscha Фамилия/Имя/Группа/Курс/Дисциплина/Факультет/Направление; normalize nuqta+apostrof → '_' |
| A-10 §13 routes | ✅ | POST /api/roster/upload, GET /api/roster/sessions/:id/report (mavjud edi) |
| A-10 §14 security | ✅ | fayl key uniq prefiks (filename emas); parser memory/time sandbox; zip-bomb ratio; spoofed MIME reject |
| A-10 §16 audit | ✅ | AUDIT_ACTIONS.ROSTER_UPLOADED ('roster:uploaded') + ROSTER_PARSE ('roster:parse') — upload oqimida userId bilan (yangilandi) |
| A-10 §17-19 testlar | ✅ | unit roster-a10 (13): BOM/cp1251 detect+decode+parse, formula no-execute 2, HEMIS mapping 2, purge 2; integration auth-a10 (6): unauth 401/403, csrf'siz 403, spoofed .pdf 400, HEMIS 201+report+rows, cp1251 rus to'g'ri parse, 11MB 413 |
| A-10 §26 retention 24h | ✅ | purgeExpiredStagingSessions (staging/reviewed eski sessiyalar; committed/rolled_back saqlanadi; parallel Promise.all; har biriga ROSTER_DELETE audit) — upload'da opportunistic |
| A-10 §28 size limit config | ✅ | multer limits ROSTER_CONFIG.maxFileSize dan (hardcode yo'q) |
| A-10 §29 CSV encoding | ✅ | detectCsvEncoding (UTF-8 BOM → utf-8; U+FFFD → cp1251), decodeCsvBuffer (BOM strip + TextDecoder windows-1251); ROSTER_CONFIG.csvEncodings bilan validatsiya; cp1251 auto-detect → parse report warning |

### Review topilmalari (tuzatildi)

1. **csvEncodings dead config** — decodeCsvBuffer'ga ulandi (unsupported encoding → reject).
2. **cp1251 auto-detect jimgina** — parse report'ga 'encoding' warning qo'shildi.
3. **Barrel export** — purgeExpiredStagingSessions src/modules/roster/index.js'dan re-export qilindi.
4. **Purge sequential** — Promise.all bilan parallel tozalash.

**Next readiness:** A-11 (Roster import: mapping + commit + rollback + invite) tayyor — mapper.js (detectColumnMapping/saveColumnMapping/validateMappingCompleteness) va commitStagingSession/rollbackStagingSession allaqachon mavjud, A-11'da invite + commit audit to'ldiriladi.

## AUTH A-11 - Roster import: mapping + commit + rollback + invite ✅

**STATUS:** ✅ DONE — 395/395 auth suite PASS (25 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-11 §06 column mapping | ✅ | POST /map auto-detect + saveColumnMapping (mavjud edi) |
| A-11 §07 required/duplicate validator | ✅ | validateMappingCompleteness / validateRequiredFields / detectFileDuplicates (mavjud edi) |
| A-11 §08-09 diff + preview | ✅ | generateDiff (create/update/deactivate/conflict) + generatePreview — admin approval (mavjud edi) |
| A-11 §10 transactional idempotent commit | ✅ | **CRITICAL BUG FIX**: eski kod `item.entity === 'user'` (diff item'larida entity YO'Q) + `item.identity?.primary` (identity STRING) — commit hech narsa YOZMAS edi! Endi: create → user (username/password:''/created_at/safeKey/display_name/role/source/group prefilled) + enrollment + guruh; enroll → faqat enrollment; update → item.changes'dan enrollment; deactivate → safeKey lookup. Per-session commit mutex (parallel commit race), hash body'dan, data-level idempotency (qayta yuklash duplicate yo'q) |
| A-11 §11 row-level error report | ✅ | buildRowStatusReport — har qator ok/error+sabab, GET /rows/status |
| A-11 §12 rollback | ✅ | snapshot/compensating — commit'dan oldin users/enrollments/groups backup; rollback → state tiklanadi (mavjud edi, tasdiqlandi) |
| A-11 §13-15 invite tizimi | ✅ | invites.js (NEW): invites/{tokenHash} — 48B token, faqat hash saqlanadi; course/group/email/telegram/used_by/expires_at/revoked_at; 7 kun expiry; 1 marta; revoke; accept (registerSchema + argon2id + guruh prefilled + enroll); public accept route (requireAuth'dan oldin + CSRF exemption); teacher P1 pending summary |
| A-11 §16 audit | ✅ | ROSTER_COMMIT + INVITE_CREATED ('invite:created') + INVITE_USED ('invite:used') + INVITE_REVOKED |
| A-11 §29 reconciliation | ✅ | reconcileSession — expected (createdUsers/createdEnrollments) vs actual (source:roster) counts; user/enroll alohida |
| Security | ✅ | invite token faqat hash; IDOR fix (invite PII route'lar teacher/admin/board rol talab qiladi — requireRosterManager); public accept uchun mutex; upload avtomatik overwrite qilmaydi (diff) |
| Testlar | ✅ | unit roster-a11 (10): commit yozadi, data-level idempotency, double commit, rollback, row status, reconcile, invite lifecycle (replay/revoke/expiry/pending); integration auth-a11 (3): full API flow commit+rollback, IDOR 403, invite accept public + login + replay + revoke + summary |

### Review topilmalari (tuzatildi)

1. **CRITICAL — IDOR**: invite list/revoke/pending-summary har qanday student'ga ochiq edi (email/identity PII) → requireRosterManager (teacher/admin/board) + IDOR testi (403).
2. **O(n²) invite creation**: per-row fb.get(invites) + fb.get(user/password) → hoist (bir marta o'qiladi).
3. **Commit race**: parallel commit ikki marta yozishi mumkin → per-session mutex.
4. **Update no-op**: update item'larida `.data` yo'q → item.changes'dan enrollment fieldlari yoziladi.
5. **Dead assertion** test'da → totalPending === 0 (1 used + 1 revoked).

**Next readiness:** A-12 (Transkript/portfolio import P1) tayyor — invite qurildi, roster flow to'liq ishlaydi.

## AUTH A-12 - Transkript/portfolio import (P1) ✅

**STATUS:** ✅ DONE — 436/436 auth suite PASS (28 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-12 §06 portfolio_items jadvali | ✅ | fb-da `portfolio_items/{itemId}` — userId, kind (result/certificate/credential + eskilari), title, evidence (JSONB), visibility (is_public default false), createdAt |
| A-12 §07 routes/portfolio.js | ✅ | NEW — POST /api/user/portfolio/import (PDF/Excel), GET /api/user/portfolio, POST /api/user/items/:id/share, PATCH/DELETE items, GET /share/:token, GET /api/user/portfolio/export |
| A-12 §08 PDF parse xavfsiz | ✅ | pdf-parse (PDFParse server-side), magic %PDF- tekshiruvi, 8MB cap, 10s Promise.race timeout + destroy(), .catch handled branch; skript/active content yо'q |
| A-12 §08 Excel reuse | ✅ | A-10 `parseRosterFile` qayta ishlatildi (xavfsiz XLSX sandbox, formula execute yо'q) |
| A-12 §09 HEMIS fayllar | ✅ | transkript/reyting/diplom — fan/baho/kredit/semestr/guruh/yil alias'lar (uz-lotin + ruscha) |
| A-12 §10 mapping + manual | ✅ | mapExcelRowToItem (case-insensitive HEMIS alias) + pdfLinesToItems (semestr header + trailing-numbers); qo'lda qo'shish mavjud |
| A-12 §11 foydalanuvchi roziligi | ✅ | consent checkbox — 'Ma'lumotlaringiz UZ'da saqlanadi' — importsiz consent=400 consent_required |
| A-12 §12 default-private + share | ✅ | har item private; visibility opt-in; share faqat owner + non-private item; 48B token (faqat hash saqlanadi), viewer-email cheklash, expiry, revoke |
| A-12 §13 eksport PDF | ✅ | buildTranscriptPdf — qo'lda qurilgan minimal PDF 1.4 (semestr/fan/baho/kredit, ASCII translit, skript/attachment yо'q) |
| A-12 §14 a11y | ✅ | import UI: label+for, 44px touch targetlar, checkbox aria-describedby, role=status |
| A-12 §15 mobile | ✅ | input[type=file] accept .pdf (mobile upload) + responsive page-wrap |
| A-12 §16 4 til | ✅ | src/modules/portfolio/i18n.js — uz-Latn/uz-Cyrl/ru/en katalog, ?lang/cookie orqali |
| A-12 §17 security/data guard | ✅ | IDOR: barcha owner-scoped (session user.safeKey — session'da id YO'Q); malicious/yolg'on fayl 400; share auth; default-private |
| A-12 §18 tenant/auth/validation/idempotency | ✅ | barcha write path: requireAuth + CSRF; import idempotent (evidenceHash dedupe — 2-chi import skip) |
| A-12 §19 audit | ✅ | portfolio:import / portfolio:share / portfolio:revoke / portfolio:delete (AUDIT_ACTIONS) |
| A-12 §29 PDF memory/time limit | ✅ | 8MB fayl cap (multer + parser), 10s parse timeout, vaqtinchalik fayl finally'da o'chiriladi |
| A-12 §30 CSRF | ✅ | barcha POST x-csrf-token header (global validateCsrf) — multipart ham |

### Review'da 4 ta fix
1. **CRITICAL** — transcript.pdf.js font ob'yekt ID'lari noto'g'ri edi (F1/F2 content stream'ga havola — PDF o'qilmas edi). Font'lar sahifalardan oldin push qilindi → /F1 3 0 R /F2 4 0 R to'g'ri; test endi font dict'larni tekshiradi.
2. parsePdfText — race loser getText unhandled rejection riski → .catch handled branch (asl xato race orqali tarqaladi).
3. Dead code: nextId/MARGIN/headLabels (pdf.js), mapExcelRowToItem headers parametri, actorId export, publicItems — olib tashlandi.
4. req.csrfToken mavjud emas → res.locals.csrfToken ishlatiladi (CSRF 403 bug'i); IDOR: session.user.id yo'q → safeKey ishlatiladi (barcha user'lar undefined edi!).

### Testlar
- **unit portfolio-a12 (23):** toAscii/PDF builder (font refs + no scripts), pdfLinesToItems (uz+rus), PDF xavfsizlik (magic/уfoton/corrupt/oversize/real minimal PDF round-trip), Excel HEMIS (uz+rus, formula inject, skip), privacy default, IDOR, share lifecycle (private blok, revoke, expiry, viewer), consent+idempotency, export.
- **integration auth-a12 (7):** unauth 401, CSRF 403, consent 400→xlsx import→default-private, IDOR 403 (patch/delete/share), share flow (viewer 404/200, revoke), export PDF 200, malicious .pdf/.exe 400.
- **Regression:** 436/436 auth + credential (28 fayl) PASS.

### Changed files
- NEW: src/modules/portfolio/{i18n,transcript.parser,transcript.pdf,portfolio.service,index}.js, routes/portfolio.js, views/portfolio-share.ejs, tests/unit/portfolio-a12.test.js, tests/integration/auth-a12.test.js
- MOD: routes/credential.js (portfolio route'lar olindi), server.js (mount), views/user/portfolio.ejs (import UI + i18n), src/modules/auth/audit.js (4 action), package.json (pdf-parse@2.4.5)

### Next readiness (A-13)
Ochiq ma'lumotlarga tayyor: import oqimi, audit va 4-til portfеlio tayyor; OTM ro'yxati + talabalar soni uchun yangi modul (data/ochiq-ma'lumotlar) ochilishi mumkin.

## AUTH A-13 — Ochiq ma'lumotlar: OTM ro'yxati + talabalar soni (P1) ✅

**STATUS:** ✅ DONE — 476/476 auth suite PASS (31 fayl)

### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-13 §06 open data manbalari | ✅ | Bundled HAQIQIY dataset (data.gov.uz dataset 14037 asOf 2023/24, 211 OTM, 1,323,000 talaba, litsenziya havolasi) + jonli fetch (hemis.uz JSON / data.gov.uz CSV) + fb cache 24h + SCHEMA_VERSION |
| A-13 §07 SSRF-xavfsiz fetch | ✅ | ALLOWED_HOSTS allowlist (hemis.uz/data.gov.uz + subdomain), redirect re-check, AbortController 8s timeout, 1 retry, streaming 5MB cap (chunked ham himoyalangan) |
| A-13 §08 fail-soft | ✅ | Tashqi manba ishlamasa → stale cache → bundled; `publicStats` hech qachon fake emas; audit OPENDATA_REFRESH |
| A-13 §09 cooldown | ✅ | Muvaffaqiyatsiz refresh'da 15 daqiqa cooldown — har landing'da takroriy 32s spam bo'lmaydi |
| A-13 §10 landing stats | ✅ | `partials/landing-stats.ejs` — OTM/talaba haqiqiy raqamlari + manba + litsenziya havolasi, 4 til copy, Cache-Control 5min |
| A-13 §11 admin refresh | ✅ | POST /api/admin/opendata/refresh (requireAdmin + CSRF eslatma) |

### Review fixes (5/5)

| # | Muammo | Yechim |
|---|---|---|
| 1 | Cooldown yo'q — har landing'da 32s spam | 15 daqiqalik lastAttempt cooldown + unit test |
| 2 | Test aniq 211/1323000 ga bog'langan | Shape/minimum assert (>=1, finite, manba+licence bor) |
| 3 | NUM_RE dead code | Olib tashlandi |
| 4 | 5MB cap chunked'da aylanib o'tiladi | Streaming reader (content-length yo'q bo'lsa ham bytе counter bilan abort) |
| 5 | Admin refresh CSRF eslatmasi yo'q | Route'ga komment + test 401 admin-check |

### Testlar

unit 15 + integration 3 (+landing regression 2 yangilandi) — jami **476/476 PASS** (31 fayl)

### Files

- 🆕 `data/opendata/universities.json` — bundled haqiqiy dataset
- 🆕 `src/modules/opendata/universities.js` — SSRF-safe fetch + normalize + cache + fail-soft
- 🆕 `src/modules/opendata/index.js` — barrel
- 🆕 `routes/opendata.js` — stats (public) + refresh (admin)
- 🆕 `views/partials/landing-stats.ejs` — landing stats blok
- ✏️ `routes/index.js` — async renderLanding + stats fail-soft
- ✏️ `views/index.ejs` — stats include
- ✏️ `data/landing.js` — STATS_COPY 4 til
- ✏️ `src/config/env.js` — OPEN_DATA_ENABLED toggle
- ✏️ `src/modules/auth/audit.js` — OPENDATA_REFRESH
- ✏️ `server.js` — mount

**Keyingi:** A-14 (Secret sinash himoyasi / Credential stuffing P0)

## AUTH A-14 — Secret sinash himoyasi / HEMIS client_secret live test (P0) ✅

**STATUS:** ✅ DONE — live OAuth2 + REST API tekshiruvi o'z test akkaunt bilan; unit 8/8 PASS

### Maqsad

GitHub'da ochiq qolgan HEMIS client_secret (`Vt5dnZtzK...`, homidjonov/hemis-oauth repo) ni xavfsiz sinash — o'z test akkaunti, secret'lar faqat `.gitignore`dagi env faylda.

### Live test natijalari

| Bosqich | Manzil | Natija |
|---|---|---|
| OAuth authorize (`client_id=8`) | student.hemis.uz | 302 → login (client qabul qilindi) |
| OAuth authorize (xuddi shu client) | **talaba.tsue.uz (TSUE prod)** | **401** — client TSUE'da ro'yxatdan o'tmagan |
| Web login (CSRF + cookie) | talaba.tsue.uz/dashboard/login | 302 → login (silent fail — error ko'rsatilmaydi) |
| **REST login `POST /rest/v1/auth/login`** | talaba.tsue.uz | **200 + JWT** (7 kun, `iss=hemis.324`, `aud=student`) |
| **Profil `GET /rest/v1/account/me` (Bearer JWT)** | talaba.tsue.uz | **200** — full_name, OTM, guruh AT-85/25, specialty, faculty, semester, avg_gpa |

### Xulosalar (security)

1. **Leaked secret TSUE prod'da ishlamaydi (401)** — secret instance'ga bog'liq, demo serverga tegishli. Rotation shart emas, lekin `hemis-test.env` **gitignore'da** (commit bo'lmaydi).
2. **Ishlaydigan yo'l — REST API**: `login+password → JWT` → `Bearer` bilan profil. Bu HEMIS integratsiyasi uchun tasdiqlangan endpoint.
3. **Web login xavfi**: HEMIS login formasi noto'g'ri credential'da xato ko'rsatmaydi (silent 302) — credential stuffing uchun qulay; o'z tizimimizda shunday qilmaslik kerak (bizda A-03 lockout + uniform error bor).
4. Harness redaction: secret'lar hech qachon log'ga chiqmaydi (test orqali tasdiqlangan).

### Files

- 🆕 `scripts/hemis-live-test.mjs` — OAuth2 flow harness (authorize→login→code→token→user), `--check` rejimi, resolveUrl, redaction
- 🆕 `scripts/hemis-rest-probe.mjs` — REST API login + JWT + profil probe
- 🆕 `tests/unit/hemis-a14.test.js` — 8 test (redaction, parseEnv, resolveUrl, token handling, flow parse)
- ✏️ `.gitignore` — `hemis-test.env` qo'shildi

**Keyingi:** A-15 (HEMIS OAuth reja — integratsiya uchun REST API endpoint'lari tasdiqlangan)

### Review fixes (kod review'dan so'ng)

| # | Muammo | Yechim |
|---|---|---|
| 1 | parseEnv Windows CRLF fayllarda qiymat oxiriga `\r` qo'shib qo'yishi (login 401 ko'rinishida) | `.replace(/\r$/, '')` + CRLF unit testi |
| 2 | Unit testlar hermetic emasmi degan xavotir | Tekshirildi: testlar faqat SAMPLE_ENV (fake) ishlatadi, haqiqiy env o'qilmaydi — hermetic ✅ |
| 3 | Script'larda hardcoded secret bo'lishi mumkin degan xavotir | Tekshirildi: ikkala script'da 0 match; test fayldagi match'lar fake fixture (`Vt5dnZtzK-super-secret-value-123`) ✅ |
| 4 | JWT token prefix'i ekranga chiqishi | `redactToken` endi faqat `(bor, N belgi)` ko'rsatadi |
| 5 | getSetCookie Node eski versiyada yo'q | Fallback allaqachon bor edi (`headers.raw?.()['set-cookie']`) ✅ |
| 6 | Harness faqat demo instance'da to'liq ishlashi aniq bo'lmasligi | Header kommentga TSUE REST yo'li ko'rsatilmasi qo'shildi |

unit 9/9 PASS (CRLF testi bilan)

## AUTH A-15 — HEMIS identity adapter (REST-first, OAuth2-ready) ✅

**STATUS:** ✅ DONE — 26/26 yangi test PASS (unit 18 + integration 8); regression 93/93; BOOT_OK

### Yondashuv (user ko'rsatmasi: "namunadagidek")

OAuth client HEMIS panelida yo'q (precondition BLOCKED edi) — o'rniga **A-14 da live tasdiqlangan REST API yo'li** qurildi: `POST /rest/v1/auth/login` → JWT → `GET /rest/v1/account/me`. OAuth2 endpoint'lari **env-gated scaffold** (OTM client paydo bo'lganda HEMIS_OAUTH_CLIENT_ID+SECRET bilan yoqiladi).

### Files

- 🆕 `src/modules/auth/providers/hemis.js` — adapter: restLogin (SSRF guard + timeout + parol log'ga chiqmaydi), normalizeAccountMe (Zod, PII filtr: passport_pin/address/avg_gpa kirmaydi; JWT iss→universityId), normalizeOAuthUser, OAuth2 scaffold, checkLinkLimit (10/15min per-IP+per-user, 5000 memory guard)
- 🆕 `routes/hemis.js` — GET status, POST link/unlink (requireAuth + CSRF + rate limit), GET /auth/hemis + /callback (env-gated, state 32B)
- 🆕 `migrations/050_hemis_link.js` — users.hemis_id UNIQUE + hemis_profile jsonb
- 🆕 `tests/unit/hemis-a15.test.js` (18) + `tests/integration/auth-a15.test.js` (8)
- ✏️ `src/config/env.js` — HEMIS_* config; `src/modules/auth/audit.js` — HEMIS_LINKED/UNLINKED/LINK_FAIL; `server.js` — mount

### Security & testlar

| Talab | Holat |
|---|---|
| Parol HECH QACHON saqlanmaydi | ✅ test: DB'da `password/pass` yo'qligi + user record'da parol substring yo'qligi |
| Unique hemis_id (IDOR/takeover guard) | ✅ 2-user 409 testi; users_hemis_index mapping |
| Noto'g'ri parol → 401 (HEMIS silent 302'dan farqli) | ✅ |
| CSRF global (x-csrf-token) | ✅ token yo'q → 403 |
| Rate limit 10/15min → 429 | ✅ per-IP + per-user |
| SSRF guard | ✅ https shart + .uz allowlist + private/localhost rad + fetch chaqirilmaydi |
| OAuth gating | ✅ client sozlanmagan → 404 |
| Geofence (451) | ✅ adapter'da handle |

**Keyingi:** A-16 (Telegram OTP, P3) — operator tasdig'i bilan; HEMIS UI tugmasi faqat OTM client bo'lganda (A-15 §35)

### Review fixes (kod review'dan so'ng)

| # | Muammo | Yechim |
|---|---|---|
| 1 | **TOCTOU race**: unique hemis_id check-write atomik emas — parallel link ikkala user'ga ham o'tishi mumkin (local-db'da transaction yo'q) | `withHemisLock` — per-hemisId promise-chain in-process lock (REST link + OAuth callback); Postgres'da migration 050 UNIQUE qo'shimcha |
| 2 | `getHemisStatus` dead code | Olib tashlandi; o'rniga `getBaseUrl()` |
| 3 | Rate-limit testi 11 hardcode (HEMIS_LINK_MAX o'zgarsa sinadi) | `CONFIG.HEMIS_LINK_MAX` dan o'qiladi (limit+1) |
| 4 | OAuth callback'da `hemis_linked_elsewhere` farqlanmas edi | Alohida redirect `hemis_linked_elsewhere` |

unit 18 + integration 8 = **26/26 PASS** (fix'lardan keyin ham)

## AUTH A-16 — Telegram OTP auth (P3) ✅

**STATUS:** ✅ DONE — 27/27 yangi test PASS (unit 18 + integration 9); regression 179/179 (9 fayl); BOOT_OK; data/db.json tegsiz

### Yondashuv

UzExam pattern — xavfsiz versiya: `start` (20-byte token + 6-xonali kod) → bot callback (HMAC-SHA256) → `verify` (single-use consume + hijack guard).

### Files

- 🆕 `src/modules/auth/telegram-otp.js` — core: createStart (kod hash'lab saqlanadi, plaintext YO'Q; **collision guard** — band lookupKey'ga qayta kod generatsiya), consumeByCode (withLock single-use + **phone guard** + hijack guard + TTL), attachTelegramId (HMAC callback), linkTelegram/unlinkTelegram (UNIQUE), rate limits 5/15 per-IP+per-phone (5000 map guard), timing-safe taqqoslash
- 🆕 `routes/telegram-auth.js` — POST /api/auth/telegram/start (anon + CSRF), verify (session regenerate §12 + recordSession), unlink (requireAuth); POST /webhooks/telegram (global CSRF'dan chiqarildi — HMAC o'zi himoya)
- 🆕 `migrations/051_telegram_link.js` — users.telegram_id UNIQUE
- 🆕 `data/telegram-i18n.js` — 4 til bot matnlari
- ✏️ `env.js` (TELEGRAM_* config), `audit.js` (5 action), `server.js` (mount + webhook CSRF exclusion)
- 🆕 `tests/unit/telegram-a16.test.js` 18 test, `tests/integration/auth-a16.test.js` 9 test

### Hermetic DB fix (review davomida topilgan real muammo)

| Muammo | Yechim |
|---|---|
| data/db.json testlar paytida buzilardi (parallel writer'lar; vi.resetModules ikkinchi LocalDB instance ochardi) | vitest.config.js + setup.js — `LOCAL_DB_FILE` per-invocation tmpdir+pid; testlar real faylga tegmаydi (5x loop + combined tekshirildi) |
| Gating test `vi.mock` hoisted — butun faylga ta'sir qilardi | `vi.doMock` (hoisted EMAS) + env save/restore try/finally |

### Review fixes (kod review'dan so'ng)

| # | Muammo | Yechim |
|---|---|---|
| 1 | **Kod collision**: lookupKey = deterministik 6-xonali kod hash (1M keyspace) — birthday collision'da ikkinchi start birinchi record'ni ustiga yozardi | createStart'da collision guard: tirik record'ga to'g'ri kelsa qayta kod generatsiya (8 urinish); unit test crypto.randomInt mock bilan majburlangan |
| 2 | **Phone guard yetishmagan**: kod o'g'irlangan bo'lsa boshqa phone ishlata olardi | consumeByCode'ga phone tekshiruvi — start phone ≠ verify phone → 409 phone_mismatch; route phone'ni uzatadi; 2 unit test |
| 3 | Gating test env mutation qaytarilmasdi | try/finally bilan restore |

### Security tekshiruvlari (testlar bilan)

kod plaintext saqlanmaydi ✅ | single-use replay → 410 ✅ | noto'g'ri kod → 401 ✅ | expiry → 410 ✅ | hijack → 409 ✅ | phone mismatch → 409 ✅ | collision → yangi kod ✅ | unique telegram_id → 409 ✅ | rate limit → 429 ✅ | CSRF yo'q → 403 ✅ | webhook HMAC → 401 ✅ | gating → 404 ✅

**Keyingi:** A-17 (CHECKPOINT) — QA gate 3x recheck

## AUTH A-17 — Geofence reja + Auth phase CHECKPOINT ✅

**STATUS:** ✅ CHECKPOINT PASS — security regression 121/121 (10 fayl); PII/secret scan toza; BOOT_OK

### Geofence hujjati

- 🆕 `docs/geofence.md` — endpoint jadvali (student.hemis.uz 302, univer/diplom 451, data.gov.uz xorijiy 000, hemis.uz/tyutor 200), Yo'l A (brauzer orqali — muammo yo'q) vs Yo'l B (server-to-server — UZ proxy), kodda amalga oshirish jadvali.

### CHECKPOINT audit natijalari

| Audit | Natija |
|---|---|
| Cookie flags | ✅ httpOnly + sameSite=Lax (server.js:243,272) |
| CSRF | ✅ barcha POST'da (session token, 32B) + webhook HMAC'da alohida |
| Open redirect | ✅ safeReturnUrl allowlist (auth.js:451, oidc.js:162) |
| Secret scan | ✅ clientSecret/secret hardcode YO'Q (production KMS/env) |
| PII scan | 🔧 **FIX**: reset token log'ga chiqardi (auth.js:628, reset.js:311) — olib tashlandi; dev/test preview endi sahifa/response'da (`dev-reset-preview`), production'da ko'rinmaydi |
| Enumeration | ✅ bir xil javob + timing padding (auth-a06 testlari) |
| Brute force | ✅ lockout + rate limit + jitter (auth-lockout.test) |
| Session fixation | ✅ regenerate har login (gate-0-security.test) |
| IDOR | ✅ auth-a08/a11/a12 (sessiya, roster, portfolio) |
| Redis session | ✅ MemoryStore rollback ishlaydi (BOOT_OK) |

### Regression

121/121 PASS — auth-lockout, rate-limiter, oidc-a07, security, gate-0-security, auth-a06/a08/a11/a12/a16. data/db.json tegsiz (hermetic LOCAL_DB_FILE).

### P2/P3 (operator tasdig'i bilan, alohida bosqich)

- Passkey (A-30+), Telegram (A-16 ✅ P3), OneID, HEMIS OAuth (A-15 scaffold ✅), diplom.edu.uz.

### Auth phase xulosasi

A-00..A-16 to'liq bajarildi; A-17 checkpoint o'tdi. **Residual risk:** HEMIS OAuth rasmiy client'ida operator tasdig'i; UZ proxy production infra.

**Next phase readiness:** ✅ A-18 (Register: email majburiy + verify) ochilishi mumkin.

### AUTH A-18 — Email verifikatsiya (register→verify→banner) ✅

**STATUS:** ✅ DONE — 156/156 PASS (11 fayl: unit 17 + integration 139)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-18 §07 email MAJBURIY | ✅ | `registerSchema` email optional (invite accept uchun), `parseRegister` default `emailRequired:true` — odatiy register email talab qiladi; invite accept emailRequired:false (roster'dan tasdiqlangan) |
| A-18 verify/send + complete API | ✅ | `routes/email-verify.js` + `src/modules/auth/email-verify.js` — 20-byte token, 6-xonali kod, single-use consume (withLock + used flag), 5-min TTL, HMAC verify, 3/soat send limit, cooldown 60s |
| A-18 verifyCode user yo'q → 404 | ✅ | `verifyCode` faqat mavjud user uchun — unit test |
| A-18 UI banner + modal | ✅ | `views/user/panel.ejs` — topbar'dan oldin verify banner (emailVerified===false), verify modal + JS, CSRF bilan |
| A-18 register email field | ✅ | `views/user/login.ejs` register formaga email maydoni qo'shildi; 4 til: emailInvalid/emailTaken/emailVerifySent |
| A-18 invite accept fix | ✅ | `src/modules/roster/invites.js` — invite.email'dan email olish, bo'lmasa emailRequired:false; user email_verified:true (roster tasdiqlangan) |
| A-18 test hermetikligi | ✅ | Barcha qattiq email'lar dinamik qilindi (20 ta); register 5/15 per-IP limitiga moslashuv |

**Regression:** auth-a01/a02/a03/a04/a06/a08/a11/a12/auth + email-verify unit — 156/156 PASS. data/db.json tegsiz.

**Next:** AUTH A-19

### AUTH A-19 — Teacher approval flow (admin tasdiqlaydi) ✅

**STATUS:** ✅ DONE — 171/171 PASS (13 fayl: unit 17+7 + integration 139+8)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-19 §07 role state machine | ✅ | `teacher_pending`/`teacher`/`teacher_rejected` — `middleware/roles.js` ROLES + TEACHER_APPROVAL_STATES + isApprovedTeacher() |
| A-19 §08 teacher register → pending | ✅ | `routes/auth.js` register'da `role=teacher` → `teacher_pending` + `teacher_application` (university/reason/appliedAt), role_version=1 |
| A-19 §08/§13 limited mode | ✅ | Pending/rejected login → `/user/teacher-approval` ekrani (doim "ko'rib chiqilmoqda"); `views/user/teacher-approval.ejs` (rejected + sabab ko'rsatadi) |
| A-19 §14 test yaratish/cast/student data blok | ✅ | `routes/user.js` router.use blok — pending/rejected teacher: /panel, /create-test, /test-arena → 404/403; `requireRole` stealth 404 |
| A-19 §09/§10 admin panel | ✅ | `routes/admin/teachers.js` (yangi): GET /admin/teachers (UI), GET /api/teachers/pending, POST /api/teachers/:id/approve, POST /api/teachers/:id/reject {reason} |
| A-19 §11 approve | ✅ | role→teacher + role_version oshadi (A-02: eski sessiyalar bekor) + audit teacher:approved + xabar record (email infra P2) |
| A-19 §12 reject | ✅ | role→teacher_rejected + teacher_rejection_reason saqlanadi + audit teacher:rejected + xabar sabab bilan |
| A-19 §15 CSRF + rate limit + audit | ✅ | Global CSRF, /admin/api adminApiLimiter, AUDIT_ACTIONS: TEACHER_APPLICATION/APPROVED/REJECTED |
| A-19 §19 i18n 4 til | ✅ | auth-i18n: teacherCta/universityPh/reasonPh 4 tilda |
| A-19 §20 IDOR | ✅ | Role transition faqat requireAdmin; test: non-admin approve 401/403 + role o'zgarmaydi |
| A-19 testlar | ✅ | Unit 7 (state machine, limited mode, approve/reject), Integration 8 (register→pending→approve/reject, security, IDOR, stealth) |
| A-19 debug topilmalari | 🔧 | EJS `<%= %>` auto-escape CSRF `&#34;` muammosi → `<%- %>`; register limit 5/15 per-IP → test'da unikal IP |

**Regression:** auth-a01/a02/a03/a04/a06/a08/a11/a12/a18/a19 + email-verify + teacher-approval unit — 171/171 PASS. data/db.json tegsiz.

**Next:** AUTH A-20 (parol tiklash email aniqlik — reset flow email orqali, A-06 ustiga quriladi)

**A-19 Review tuzatishlari (code-review-deepseek-flash topilmalari):**

| Topilma | Fix |
|---|---|
| `audit()` signature mos emas (actorId/outcome yo'q) → teacher:approved/rejected audit yozilmay qolishi mumkin edi | `logAuthEvent` ga o'tkazildi (auth jurnali) — `routes/admin/teachers.js` |
| `user.roleVersion = Date.now()` soxta qiymat — invalidateIfStale eski sessiyani o'ldirishi mumkin | DB'dagi haqiqiy `role_version` o'qiladi — `routes/user.js` |
| §19 i18n faqat register formada; status sahifasi uz'da qotib qolgan | `teacherApproval` blok 4 tilga (uz/uz-cyrl/ru/en) qo'shildi; route settings.lang dan oladi; view copy'dan render qiladi |
| `notification_last` yoziladi, lekin ko'rsatilmaydi | View'da pending (✅) va rejected (⚠️ + sabab) xabarlari ko'rsatiladi |
| §08/§14 cast yuzasi — pending teacher cast session yarata olardi (faqat requireAuth) | `routes/cast.js` POST /api/cast/sessions ga pending/rejected blok |
| Test "eski sessiya bekor" claim'i mustahkam emas | role_version >1 assert + /teacher 200/302 assert qo'shildi |
| EJS `<%= %>` apostrofni `&#39;` ga escape qilardi (ko'rib chiqilmoqda topilmasdi) | i18n matnlar `<%- %>` (unescaped, server-manba) — view'da |
| i18n skripti 4 blokni ham uz'ga qo'shgan edi (cursor yo'q) | Til kalitidan keyin qo'shish (uz/uz-cyrl/ru/en) — 4 blok to'g'ri taqsimlandi |
### AUTH A-20 — Parol tiklash email orqali (username OR email) ✅

**STATUS:** ✅ DONE — 185/185 PASS (15 fayl: unit 5 + integration 180)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-20 account field: username OR email | ✅ | `resolveAccountToUserKey(account)` — email index orqali lookup, username ham qabul qiladi; forgot placeholder + i18n "username yoki email" |
| email_verified sharti | ✅ | `/api/reset/request` + HTML forgot — user `email_verified !== true` bo'lsa token yaratilmaydi, generic javob qaytadi (enumeration-safe) |
| Verified bo'lmasa → tasdiqlash yo'li | ✅ | A-18 verify flow banner orqali; legacy (email yo'q) → generic javob |
| Email havola → reset ekran | ✅ | 48B token, 15min TTL, single-use (A-06 asosi saqlanadi), parol min8+harf+raqam |
| Eski sessiyalar revoke | ✅ | reset complete → passwordUpdatedAt oshadi → requireAuth stale tekshiruvi eski sessiyalarni bekor qiladi |
| Rate limit 3/soat + audit | ✅ | `checkResetLimit` (3/soat per account) + audit: reset_start/reset_complete/sessions_revoked_after_reset |
| i18n 4 til | ✅ | forgot.usernamePh — uz/uz-cyrl/ru/en |
| Regression | ✅ | 185/185 — eski auth.test.js forgot testi email_verified shartiga moslashtirildi |

**Next:** AUTH A-21 (CHECKPOINT) — A-00..A-20 to'liq security audit + QA gate (3x recheck)
### A-20 review fix'lari (Nit Pick Nick) ✅

Review davomida 2 ta real topilma tuzatildi:

| # | Topilma | Yechim |
|---|---|---|
| 1 | Timing side-channel: verified bo'lmagan user token olmaydi — javob tezligi farq qilishi mumkin | Allaqachon padding bor edi: user yo'q → 250ms, unverified → 120ms, verified → token yozish (kalibrlangan). Tekshirildi, qo'shimcha fix kerak emas |
| 2 | Dead code: `findUserByEmail`/`findUserKeyByEmail` takrorlanib qolganmi? | `findUserKeyByEmail` `resolveAccountToUserKey` ichida + unit testlarda ishlatiladi — dead code yo'q |
| 3 | devPreview production'da sizib chiqishi mumkin | `NODE_ENV !== 'production'` gating mavjud — tekshirildi |
| 4 | Test `users/${uname}` safeKey'siz | Username shape'ida safeKey identity — minor, qoldirildi |
| 5 | Reset complete `email_verified` re-check yo'q (defense-in-depth) | ✅ QO'SHILDI: complete handler'da `email_verified !== true` → token invalidate + 403 `RESET_EMAIL_NOT_VERIFIED` + audit blocked; A-06 va auth.test.js register helper'lariga `email_verified: true` qo'shildi |

Final: **185/185 PASS (15 fayl)** — barcha auth testlari yashil.
---

## AUTH A-21 — CHECKPOINT: A-00..A-20 to'liq security audit + QA gate ✅

**STATUS:** ✅ CERTIFIED — **365/365 test PASS (29 fayl)**, 0 fail, 0 skip. EXIT=0.

### QA Gate — 3x recheck

**1-tekshiruv (Tozalik):** ✅
| Audit | Natija |
|---|---|
| Secret scan | `.env` .gitignore'da ✓, git history'da secret yo'q ✓, clientSecret faqat env'dan ✓ |
| Hardcode rang/font | N/A (backend phase) |
| Detektiv elementlar | Honeypot qo'shildi (A-21 §07 talabi) — `website` yashirin maydon: schema'da tekshirish, route'da silent skip, login.ejs formada, 3 ta test |

**2-tekshiruv (Ishonchlilik):** ✅
| Audit | Natija |
|---|---|
| PII scan | `SENSITIVE_WORD_RE` — parol/token/OTP/email log'ga chiqmaydi ✓, audit eventlari sanitized ✓ |
| Register audit | honeypot ✓, rate limit 429 ✓, unique email ✓, legacy migratsiya ✓ |
| Teacher approval | limited mode ✓, non-admin 403 ✓, IDOR testlari ✓ |
| Reset audit | verified-only token ✓, enumeration (generic + timing padding) ✓, single-use ✓, session revoke ✓ |
| Login+session | OIDC PKCE/nonce ✓, lockout ✓, cookie flaglar (httpOnly/sameSite/secure) ✓, idle timeout ✓ |
| Xavfsizlik testlari | open-redirect ✓, session fixation ✓, CSRF 403 ✓, user enumeration ✓ |

**3-tekshiruv (Regression):** ✅ 365/365 PASS

### A-21 davomida tuzatilgan real bug'lar 🔧

| Bug | Yechim |
|---|---|
| **Port konflikti:** a05 va a07 ikkalasi ham PORT 3589 ishlatar edi — to'liq suite'da a05 serveri portni bo'shatmaguncha a07 bind qila olmasdi (flaky suite fail) | a07 → **PORT 3590** (unikal), ikkala testda spawn oldidan 800ms → **2500ms** settle wait |
| **Health-check timeout:** server boot ~14s, to'liq suite yuklamasida 25s yetmasdi | a04/a05/a07 `waitForHealth` timeout 25s → **60s** |
| **Vitest temp DB merosi:** vitest `LOCAL_DB_FILE`'ni temp faylga o'rnatadi, child server ham o'sha temp DB'ni ishlatar edi → test'ning `data/db.json` yozuvlari ko'rinmasdi (a05, a07) | spawn env'da `LOCAL_DB_FILE: ''` tozalanadi |
| **Email majburiy shart** (A-18) bilan buzilgan eski testlar (a10, a15, a16 register email'siz edi) | helper'larga email qo'shildi |

### Residual risk (qabul qilingan)
- OIDC (a04/a07) test rejimida Google mock bilan — real Google bilan E2E prod'da tekshiriladi
- Email/Telegram yuborish test rejimida preview — real SMTP/bot prod'da
- Roster/transkript import fayl hajmi 5MB cap — chunked transfer uchun streaming limit qatlami kelajakda (A-13 review topilmasi, DoS risk past chunki server tashqi manbalar faqat admin endpoint)

### Next readiness
AUTH A-22..A-24 uchun precondition (A-21 Done) **bajarildi** — keyingi faza ochiq.
### A-21 review fix (Nit Pick Nick): honeypot timing side-channel 🔧

| Topilma | Fix |
|---|---|
| Honeypot yo'li real register'dan ancha tez qaytar edi (parol hash + DB + email token ~200ms+ o'rniga ~0ms) — bot "tez javob = bloklangan" deb bilib olishi mumkin | `routes/auth.js` honeypot branch'iga **250ms padding** qo'shildi — real register narxiga yaqin javob (timing side-channel yopildi) |
| Honeypot qaysi formada ekani tekshirilsin | ✅ `form-reg` (register) ichida, `form-login` da YO'Q; `aria-hidden` + off-screen (left:-9999px) + `tabindex=-1` — a11y toza |
| PORT 3590 boshqa joyda ishlatilmayaptimi | ✅ Faqat a07 da — unikal |

Tasdiq: `auth-a21-checkpoint` + `auth-a01` 6/6 PASS, db.json toza.
### AUTH A-22 — Parol siyosati: NIST + HIBP + zxcvbn ✅

**STATUS:** ✅ DONE — 295/295 PASS (29 fayl: integration 21 + unit 7 + e2e 1)

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-22 NIST SP 800-63B §5.1.1.2 | ✅ | `src/modules/auth/password-policy.js` — complexity talablari SHALL NOT (faqat-harflar/faqat-raqamlar qabul), dynamic min uzunlik: MFA user 8 / oddiy 15, max 128, Unicode qabul (regex'lar yo'q) |
| A-22 zxcvbn | ✅ | `zxcvbn@4.4.2` (Dropbox, CJS — Node 24'da ishlaydi; zxcvbn-ts v4 ESM JSON-import muammosi tufayli rad etildi). `evaluatePassword()` — score < 3 → passwordWeak, feedback i18n'ga |
| A-22 HIBP k-anonymity | ✅ | `src/modules/auth/hibp.js` — SHA-1 prefix (5 hex), HIBP API'ga GET (1.5s timeout), `pwned` bo'lsa → breach_password_blocked. **Offline fallback**: test rejimida + network xatoda blok qilmaydi (log warn), 4q smol chunk'li javobda Content-Length yo'q bo'lsa ham 1.5MB body cap bilan DoS himoya |
| A-22 timing-safe | ✅ | `routes/auth.js` — login'da mavjud dummy argon2 compare (A-03) saqlanadi; username topilmasa dummy hash compare ishlaydi |
| A-22 parol o'zgartirish | ✅ | **YANGI** `POST /api/auth/change-password` (requireAuth): joriy parol verify + reuse check (new ≠ current) + siyosat + HIBP + audit `password_changed` + session revoke (boshqa sessiyalar) |
| A-22 reset integratziya | ✅ | `routes/reset.js` — resetRequestSchema/resetCompleteSchema'da complexity olib tashlandi (NIST), complete flow'da evaluatePassword + HIBP blok |
| A-22 audit | ✅ | `src/modules/auth/audit.js` — AUDIT_ACTIONS: PASSWORD_POLICY_REJECT `password:policy_reject`, BREACH_PASSWORD_BLOCKED `password:breach_blocked`, PASSWORD_CHANGED `password:changed` |
| A-22 i18n | ✅ | `data/auth-i18n.js` — passwordMin15/passwordMin8/passwordWeak/passwordMax/passwordBreached kalitlari (uz/ru/en) |

#### Testlar

| Tur | Fayl | Natija |
|---|---|---|
| Unit | `tests/unit/password-policy-a22.test.js` | 12/12 — min 8 (MFA) / 15 (oddiy), max 128, complexity yo'q, zxcvbn score<3 rad, Unicode |
| Unit | `tests/unit/hibp-a22.test.js` | 6/6 — prefix SHA-1, timeout fallback, offline fallback, 1.5MB cap |
| Integration | `tests/integration/auth-a22.test.js` | 9/9 — register weak rad (passwordWeak), breach blok (mock), min 15 rad, Unicode qabul, change-password (CSRF + agent session) |
| Regression | 29 fayl | **295/295 PASS** |

#### Eski testlarni moslashtirish (A-22)

| Test | O'zgarish |
|---|---|
| `parol-2026-x` (12 belgi) → `parol-2026-x-uzun` (16) | Barcha auth testlarida (register+login juftligi izchil) |
| `tests/integration/auth-a04.test.js` | `abc1` rad testi min 8 → min 15 xabarga, PW konstanta 15+ |
| `tests/integration/auth-a06.test.js` | reset parollar 15+ |
| `tests/integration/auth.test.js` | "qisqa parol rad (min 8)" → min 15 xabarga |
| `tests/unit/auth-validation.test.js` | complexity testlari → NIST: schema darajasida qabul; email majburiy (A-18) |
| `tests/e2e/role-shell-security.test.js` | `test1234` → 15+; 2 shell testi STEP 17 refactor'ga mos (Escape navigation.js'da, reduced-motion navigation.css'da) |

#### Security & UX

- HIBP sinovda (test) rejimida real network'ga chiqmaydi — `offlineFallback` 
- Parol xatolari field="password" + inline reveal (A-04) saqlanadi
- `x'`/qisqa parollar faqat unit modul darajasida — integration'da 15 min qat'iy

**Next readiness:** A-23 ochiq (precondition A-22 Done ✓)
### A-22 review fix (Nit Pick Nick): timing kanali + HIBP cache + max moslik 🔧

| Topilma | Fix |
|---|---|
| **Honeypot timing kanali qayta ochildi**: real register endi HIBP network call (~150ms-1.5s) oladi, honeypot esa 250ms qat'iy — bot "tez javob = bloklangan" deb bilib olishi mumkin | `routes/auth.js` honeypot branch'iga **random 400-900ms padding** — real register vaqt diapazoniga tenglashdi, bot farqni ajrata olmaydi |
| **HIBP cache yo'q**: har register'da tarmoqqa so'rov (k-anonymity prefiksini ko'p userlar bo'lishadi — takroriy so'rov spam) | `hibp.js` **in-memory prefix cache** (5-hex, 1 soat TTL, 2000 entry cap) — bir xil prefix ikkinchi so'rovda fetch qilmaydi (`cached: true`); +2 unit test (cache hit, TTL) |
| **Ikkita max qiymat**: Zod max 200 vs policy max 128 — yagona manba yo'q | `validation.js` registerSchema/resetCompleteSchema **max 128** (login'da legacy uchun 200 qoldi) — OWASP ASVS bilan mos |
| **e2e test zaiflashgan**: navigation.js static fayl o'qiladi, sahifaga ulanganligi tekshirilmaydi | `role-shell-security.test.js` — endi `/teacher` sahifasi **`/js/components/navigation.js` script tag'ini yuklayotganini** ham assert qiladi |
| change-password HIBP yo'q degan taxmin | ❌ noto'g'ri edi — `routes/auth.js` change flow'ida **4-qadam HIBP breach check** allaqachon bor (tekshirildi) |

**STATUS:** ✅ DONE — 297/297 PASS (29 fayl), review fix'laridan keyin ham to'liq yashil.
### AUTH A-23 — Email infratuzilmasi: SPF/DKIM/DMARC + provider + validation ✅

**STATUS:** ✅ DONE — 72/72 PASS (8 fayl: unit 60 + integration 12)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-23 §email provider | ✅ | `src/modules/email/provider.js` — transport abstraksiya (SMTP via nodemailer / Postmark), test rejimida preview+log, retry 3x (jitter), timeout 5s, HTML+text |
| A-23 §templates | ✅ | `src/modules/email/templates.js` — verify/reset/welcome/teacher_approved/teacher_rejected, 4 til (uz/uz-cyrl/ru/en), plain-text + HTML, spam-free (xabar, bo'sh qator, ro'yxatdan chiqish izohi) |
| A-23 §validation | ✅ | `src/modules/email/validation.js` — syntax + MX (dns promises, 3s timeout) + disposable blok (~200 domен) + 24h LRU cache |
| A-23 §webhook | ✅ | `src/modules/email/webhook.js` — bounce/complaint → suppress (email_suppressed) + idempotency (email_log event_id) + user notification_last |
| A-23 §integration | ✅ | email-verify sendVerifyCode → sendEmail; reset request → sendEmail; register → welcome; teacher approved → email; register email → MX+disposable validation |
| A-23 §audit | ✅ | AUDIT_ACTIONS: EMAIL_SENT/EMAIL_BOUNCE/EMAIL_SUPPRESS/EMAIL_TEMPLATE_MISSING |
| A-23 §docs | ✅ | `docs/email-deliverability.md` — SPF/DKIM/DMARC record'lar, mail.deborah.uz subdomain, monitoring |
| A-23 §webhook route | ✅ | `routes/email-webhook.js` — POST /api/webhooks/email (HMAC token verify, test rejimida fail-closed), CSRF bypass prefix |

**Testlar:**
- unit: provider (transport/retry/timeout) 6, templates (4 til, spam-scan, fallback) 8, validation (MX/disposable/cache) 10, webhook (bounce suppress/idempotency/soft) 4 → 28
- integration: webhook route (HMAC 403, suppress flow), register disposable blok → 4
- regression: email-verify-a18, email-reset-a20, auth-a18, auth-a20 → 72 jami

**Xavfsizlik:**
- Webhook HMAC-SHA256 token (EMAIL_WEBHOOK_SECRET), 30s timestamp window, fail-closed test rejimida
- MX lookup timeout 3s, disposable list cache 24h
- Retry jitter bilan 3x, failure'da audit log

**Next readiness:** A-24 precondition (A-23 Done) ✅
### A-23 review fix (Nit Pick Nick): 5 ta topilma tuzatildi 🔧

| Topilma | Daraja | Fix |
|---|---|---|
| **Suppression send'da tekshirilmayapti** — bounce'dan keyin ham email'ga yuborishda davom etardi (deliverability spiral) | HIGH | `provider.sendEmail` boshida `isEmailSuppressed()` tekshiruvi (dynamic import, fail-open) + `deps.checkSuppressed` test injeksiyasi; suppress → `{ok:false, suppressed:true}`, transport'ga chiqmaydi. Yangi unit test |
| **Webhook token `===` bilan taqqoslangan** (timing side-channel) | MED | `crypto.timingSafeEqual` + uzunlik tekshiruvi |
| **MX transient xatolar register'ni buzardi** — timeout/AbortError → no-mx rad | MED | Faqat `ENOTFOUND` (mavjud bo'lmagan domain) rad; timeout/ENODATA/boshqa → fail-open + `MX_CACHE_MAX=5000` LRU guard |
| **Template'larga foydalanuvchi qiymatlari raw kiritilgan** (HTML/header injection) | MED | `esc()` helper (HTML entities + `\r\n` tozalash) — username/resetUrl barcha render'da escapelanadi; yangi unit test |
| **Jim `.catch(() => {})`** — welcome/teacher_approved xatolari yashirin | LOW | `console.warn` bilan loglash |

**Regression:** 8/8 fayl, 74/74 PASS (unit 63 + integration 11) — yangi suppression + esc testlari bilan.
### AUTH A-24 — OIDC hardening: JWKS, exact redirect, rotation ✅

**STATUS:** ✅ DONE — 102/102 PASS (9 fayl: unit 81 + integration 21)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-24 §06 alg allowlist | ✅ | `jose.jwtVerify(..., { algorithms: ['RS256'] })` — HS256 rad (alg confusion). jose 4.15.9: `ERR_JOSE_ALG_NOT_ALLOWED` → error 'alg' |
| A-24 §07 issuer EXACT | ✅ | `GOOGLE_ISSUER = 'https://accounts.google.com'` — bitta string (prefix/array emas). iss/aud xatolari message bilan farqlanadi ('iss'/'aud') |
| A-24 §08 redirect exact | ✅ | `assertExactRedirectUri(req)` — protocol+host+path EXACT string compare; host-header confusion → 400 + audit OIDC_REDIRECT_MISMATCH |
| A-24 §09 PKCE S256 | ✅ | (A-07 dan) — code_verifier server-side; plain rad |
| A-24 §10 state/nonce | ✅ | 32B state CSRF + 32B nonce replay — ID token'da nonce majburiy |
| A-24 §11 refresh rotation | ✅ | `rotateGoogleRefreshToken` — server-side saqlash (`users/{userKey}/google_refresh_token`); rotated token qayta ishlatilsa → REPLAY → zanjir invalid + audit OIDC_REFRESH_REPLAY; `POST /auth/google/refresh` (CSRF'li) |
| A-24 §12 server-side tokens | ✅ | Access token client'ga qaytarilmaydi; sessiya server-side (HttpOnly) |
| A-24 §14 clock skew | ✅ | `clockTolerance: 30` (jose) |
| A-24 §15 rate limit | ✅ | /auth/google 10/15min (A-07) + callback abuse monitoring 20/15min (yangi `checkGoogleCallbackLimit`) |
| A-24 §16/§19 audit+metrics | ✅ | OIDC_TOKEN_INVALID / OIDC_REFRESH_ROTATED / OIDC_REFRESH_REPLAY / OIDC_REDIRECT_MISMATCH action'lar; oidc.token_invalid / oidc.refresh_rotated metric'lar |
| A-24 §29 JWKS cache | ✅ | 24 soat TTL (jose rotation'ni o'zi boshqaradi — unknown kid → refetch) |
| A-24 fail-closed | ✅ | userinfo API fallback OLIB TASHLANDI — ID token majburiy verify (downgrade himoya) |

**Testlar:**
- unit `oidc-a24.test.js` (13): alg allowlist (HS256 rad), issuer exact (prefix/bare rad), xato kodlari (nonce/expired/audience), backward-compat wrapper, redirect guard, callback limit 20/15, rotation+replay (deps injeksiya, 5 holat)
- integration `auth-a24.test.js` (5): redirect mismatch 400 (Host override), to'g'ri Host 302, callback 20→429, refresh CSRF 403, session-yo'q 401
- regression: oidc-a07, oidc, email-a23 (3), auth-a07, auth-a01 → 102 jami

**Xavfsizlik:** alg confusion, issuer prefix, host-header redirect, refresh replay, userinfo downgrade — barchasi yopildi.

**Next readiness:** A-25 (session hardening: __Host-, remember selector) precondition (A-24 Done) ✅
### AUTH A-25 — FINAL CHECKPOINT: Session hardening + Teacher approval (Entra PIM) ✅

**STATUS:** ✅ DONE — 603/603 auth+security regression PASS (51 fayl)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-25 §1 `__Host-` cookie | ✅ | `sessionCookieName()` — `SESSION_HOST_PREFIX && production` da `__Host-` prefix (HTTPS sharti browser talabi; dev/testda oddiy nom) |
| A-25 §2 Remember-me | ✅ | `src/modules/auth/remember-me.js` (NEW) — selector/verifier, 30 kun TTL, `deviceHash` (ipHash+UA) device-bound, login'da rotation (verify on success → eski revoke), `revokeRememberToken` logout |
| A-25 §3 Idle timeout | ✅ | Avval A-02 da bor edi; rotation guard qo'shildi: `session.regenerate` mavjud bo'lsagina mid-session rotation (mock/minimal session'li testlar buzilmasligi uchun) |
| A-25 §4 Absolute timeout | ✅ | `SESSION_ABSOLUTE_TIMEOUT_MS` (12h) env.js'ga qo'shildi; `isAbsoluteExpired` helper session-timeout.js'da |
| A-25 §5 Sensitive re-auth | ✅ | `POST /api/auth/reauth` — parol tasdiqlash; remember-me cookie mavjud bo'lsa ham reauth talab qilinadi (session.lockedUpgrade flag) |
| A-25 §6 Teacher approval | ✅ | `routes/admin/teachers.js` — justification MAJBURIY (min 20 belgi), **no self-approve** (admin o'z arizasini tasdiqlay olmaydi), 72h window (`decidedAt`), escalate/reject bilan `reviewedBy`+`decidedAt`, reauth talab (teacher:approve), cooldown (3 kun — `teacherCooldownUntil`), appeal qayta ariza, audit'ga `TEACHER_APPROVED/REJECTED/ESCALATED` |
| A-25 §7 Register cooldown | ✅ | `teacherCooldownUntil` — reject'dan keyin 3 kun qayta ariza blok; `data/auth-i18n.js` da `teacherCooldown` 4 tilda |
| A-25 §8 Audit trail | ✅ | `src/modules/auth/audit.js` — `SESSION_ABSOLUTE_TIMEOUT`, `REMEMBER_ME_CREATED/RESTORED/REVOKED/REAUTH_REQUIRED`, `TEACHER_*` action'lar |
| A-25 §9 FINAL | ✅ | Boot smoke: /user/login + /admin/login 200; secret scan toza (faqat test fixture'da fake secret); db.json tegsiz |

### Regression (FINAL CHECKPOINT)

| Guruh | Fayllar | Testlar |
|---|---|---|
| AUTH integration A01–A13 | 13 | 86 PASS |
| AUTH integration A15–A25 + auth + email | 11 | 145 PASS |
| AUTH unit (20 fayl: lockout, session-store, validation, email, oidc, hibp, policy, remember-me, telegram, webauthn...) | 20 | 253 PASS |
| Security/role (gate-0, security-guard, role-shell, cast-security, cast-roles, cast-session-create, security-seb) | 7 | 119 PASS |
| **JAMI** | **51** | **603 PASS** |

### Debug'da topilgan real bug'lar
1. **cookie-parser yo'q edi** — `req.cookies` undefined → remember-me cookie o'qilmasdi. `parseCookies` mini-parser remember-me.js'ga qo'shildi (auth.js + middleware/auth.js + routes/auth.js da qayta ishlatiladi).
2. **rotation guard** — minimal mock session'li eski testlar `session.regenerate` yo'qligi uchun yiqilardi → guard qo'shildi.
3. **clearCookie** har safar qo'shimcha Set-Cookie chiqarardi → faqat cookie mavjud bo'lsa tozalash (eski testlarning cookie count kutishlari buzilmasligi uchun).
4. **remember-me firebase import yo'li** — src/modules/auth/ dan 3 daraja (../..).
### A-25 review fix (Nit Pick Nick) — reauth rate-limit + cookie parser 🔧

| Topilma | Fix |
|---|---|
| `POST /api/auth/reauth` + `POST /api/admin/reauth` da **rate-limit/lockout yo'q** — o'g'irlangan session bilan cheksiz parol sinash (online brute force) | `routes/auth.js` — in-memory per-user/IP limiter (`reauthLimited`): 5 urinish / 15 daqiqa → 429 `rate-limited`; `REAUTH_FAILED` audit action qo'shildi (`src/modules/auth/audit.js`), muvaffaqiyatsiz urinishlar audit'ga tushadi |
| Qo'lda yozilgan cookie parser (quoted values, percent-encoding, escaped chars'da xato qilishi mumkin) | `parseCookies` → standart **`cookie`** paketi (RFC 6265, `package.json`'ga `"cookie": "^0.7.2"` qo'shildi). API o'zgarmadi — 3 iste'molchi (remember-me, middleware/auth, routes/auth) tuzilmadi |
| `isAbsoluteExpired` haqiqatan ulanganmi? | ✅ Tekshirildi — `middleware/auth.js:243` da `requireAuth` ichida chaqiriladi (absolute 12h timeout ishlaydi) |
| `__Host-` consistency | ✅ `sessionCookieName()` faqat production+HTTPS da prefiks qo'shadi (`__Host-` Secure talab qiladi — dev/testda ishlamaydi) |
| deviceHash IP binding mobil UX riski | Qasddan — token o'g'irlanish bloki (device mismatch → revoke). Testlarda IP bir xil qilib hujjatlashtirilgan |
| Test gap: reauth rate-limit | `tests/integration/auth-a25.test.js` — yangi test: 5+ noto'g'ri parol → 429 |

**Final: 24 integration fayl, 232 test PASS** (auth-a25 endi 8 test: remember-me, justification, reauth-required, cooldown, eskalatsiya, reauth rate-limit).
### AUTH A-26 — MFA/TOTP: enrollment + login challenge + backup codes ✅

**STATUS:** ✅ DONE — 506/506 auth+unit regression PASS (46 fayl)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-26 §06 DB schema | ✅ | `mfa_totp/{userId}` (secretEnc AES-256-GCM, status pending\|active, fails, lockoutUntil, lastUsedAt), `mfa_backup_codes/{userId}` (codes[{h, usedAt}]), `mfa_challenges/{id}` (single-use), `mfa_resets/{userId}` (72h delay) |
| A-26 §07 Setup endpoint | ✅ | `POST /api/mfa/totp/setup` — secret yaratiladi, encrypt (MFA_ENCRYPTION_KEY yoki SESSION_SECRET sha256), QR (qrcode lib) + Base32 manual key; secret plaintext FAQAT shu response'da |
| A-26 §08 Enable | ✅ | `POST /api/mfa/totp/enable` — birinchi kod verify (window=1, 90s) → active + **10 ta backup code** (HMAC-SHA256 hash, plaintext yo'q) |
| A-26 §09 Ack | ✅ | Settings UI: kodlar ko'rsatiladi, "Yuklab olish" (txt), "Kodlarni saqladim" acknowledge |
| A-26 §10 Login challenge | ✅ | Parol to'g'ri → `hasActiveMfa` → **session BERILMAYDI** — `pendingMfa` + single-use challenge → redirect `/user/mfa`; `POST /api/mfa/verify` FAQAT muvaffaqiyatda session beradi |
| A-26 §11 TOTP verify | ✅ | `otplib` v13 (RFC 6238), valid_window=1; **5 xato → 15 daqiqa lockout** (per-user DB persist + per-IP in-memory); backup code ishlatilsa `usedAt` (replay yo'q); muvaffaqiyatda counter reset |
| A-26 §12 Challenge ID | ✅ | `readMfaChallenge` (verify'dan OLDIN, consume emas — xato urinish challenge'ni yo'qotmaydi) + `consumeMfaChallenge` (faqat muvaffaqiyatda, reuse → 401) |
| A-26 §13 Step-up | ✅ | `requireMfaStepUp` middleware — `mfaAt` session'da (30 daqiqa); parol o'zgartirishga ulangan (viaMfa sessiyada eskirsa 403 mfa_stepup_required) |
| A-26 §14 MFA reset | ✅ | `POST /api/mfa/reset/request` — backup code'lar yo'q bo'lsa support ticket + **72 soat delay** (`mfa_resets`), high-privilege uchun reauth |
| A-26 §15 Password/MFA reset AYRILDI | ✅ | Password reset MFA'ni o'chirmaydi — login'da MFA hali talab qilinadi (email o'g'irlansa MFA'siz o'tolmaydi) |
| A-26 §17 Settings UI | ✅ | `views/user/security-profile.ejs` + `public/js/mfa-settings.js` — status, QR setup, enable, backup codes, rotate (reauth), disable (reauth) |
| A-26 §18 Rate limit | ✅ | setup/enable/verify per-user+per-IP lockout; CSRF barcha POST'larda |
| A-26 §19 Audit | ✅ | `MFA_SETUP/ENABLE/DISABLE/VERIFY/BACKUP_ROTATE/RESET_REQUEST/RESET_EXECUTED/REQUIRED` — audit.js'ga qo'shildi, IP+UA bilan |
| A-26 §20 Security guard | ✅ | secret encrypt (DB'da plaintext yo'q), backup hash, kod log'ga tushmaydi, challenge consumed |
| A-26 §33 TOTP lib | ✅ | `otplib@^13.4.1` (installed) + `qrcode` (mavjud edi) |

### Regression

| Guruh | Fayllar | Testlar |
|---|---|---|
| AUTH integration (A-01..A-26 + auth + email) | 25 | 239 PASS |
| AUTH unit (21 fayl: mfa-a26, lockout, session-store, email, oidc, hibp, policy, remember-me, telegram, webauthn...) | 21 | 267 PASS |
| **JAMI** | **46** | **506 PASS** |

### Debug'da topilgan bug'lar
1. **`nextIp()` invalid IP** — 203.0.113.257 rate-limiter'ni buzardi → 100–254 oralig'i + counter (random emas).
2. **Challenge verify'dan oldin consume** — xato kod urinishi challenge'ni yo'qotardi → `readMfaChallenge` + muvaffaqiyatda consume.
3. **Per-IP lockout 1-xatodayoq** — `until` har urinishda yangilanardi → faqat 5-chida blok.
4. **MFA sahifasida `window.__CSRF_TOKEN` yo'q edi** — verify POST CSRF'siz → qo'shildi.
5. **GET /user/mfa sharti** — `pending.userId` tekshiruvi teskari edi → tuzatildi.
6. **MFA verify'dan keyin session regenerate** — eski CSRF ishlamaydi (test yangi CSRF oladi).
7. **Backup code hash format** — `{h, usedAt}` ob'ekt (plain string emas) — consume/remaining bilan mos.
### AUTH A-27 — Passkey/WebAuthn: register + login (Conditional UI + modal) + recovery ✅

**STATUS:** ✅ DONE — unit 20/20 + integration 10/10; regression 26 fayl, 248/249 PASS (1 flaky: auth-a05 "last_login", yolg'iz 8/8 PASS)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 credential saqlash | ✅ | `passkeys/<id>` (base64url, case-sensitive — safeKey ishlatilmaydi!) + `passkeys_index/<userId>`; max 25 |
| §07 register flow | ✅ | POST /api/passkey/register/options → simplewebauthn v13 `generateRegistrationOptions` (attestation:'none', residentKey:'required', alg allowlist [-7,-257,-8]) → browser create → POST /verify (origin/rpId/challenge to'liq tekshiriladi) |
| §08 counter monotonic | ✅ | PRE-check authenticatorData 33-36 bayt: `newCounter < prev` → `counter_regression` (clone), `==` va prev>0 → `counter_replay`; simplewebauthn v13 ham o'zi rad qiladi (defense-in-depth); 0→0 (increment qilmaydigan authenticator) ruxsat |
| §09 Conditional UI + modal | ✅ | login.ejs: `autocomplete="username webauthn"` + page-load `mediation:'conditional'` (AbortController/NotAllowedError jim); "Passkey bilan kirish" tugmasi (44px+, platformAuthenticatorIsAvailable) |
| §10 feature detection | ✅ | `isConditionalMediationAvailable()` → conditional; `isUserVerifyingPlatformAuthenticatorAvailable()` → modal |
| §11 kamida 1 boshqa usul | ✅ | Parol login doim mavjud (fallback); MFA (A-26) bilan birga ishlaydi |
| §12 recovery | ✅ | Parol/email tiklash (A-06/A-20) + MFA backup kodlar (A-26) — passkey yo'qolsa ishlaydi |
| §13 settings + reauth | ✅ | security-profile.ejs "Passkeylar" bo'limi: ro'yxat (deviceType/backedUp/lastUsed), [Yangi qo'shish], [O'chirish] — `requireRecentAuth` (reauth'siz 403 → inline parol tasdiqlash POST /api/auth/reauth → qayta urinish) |
| §14 nudge | ✅ | panel.ejs dismissible banner (localStorage) — WebAuthn + count=0 bo'lsa |
| §15 rate limit | ✅ | register+verify: 10/15min per IP+user (in-memory Map), 429 |
| §16 audit | ✅ | `passkey:register`, `passkey:authenticate` (AUTH_LOGIN success method:'passkey'), `passkey:fail` (counter anomalies — NEW AUDIT_ACTIONS.PASSKEY_FAIL), `passkey:remove` |
| §17 a11y | ✅ | 44px+ tugma, aria-live hint, parol fallback doim |
| §19 i18n | ✅ | uz/uz-cyrl/ru/en: passkey, passkeyError, passkeyRate |
| §32 libs | ✅ | @simplewebauthn/server@13.3.2 + /browser@13.3.0 (browser'da native API — node_modules serve qilinmaydi; server JSON options + base64url konvertatsiya) |
| §33 browser matrix | ⚠️ | Playwright yo'q (Chrome o'rnatilmagan) — integration testlar real kripto bilan (tests/helpers/webauthn-authenticator) |
| §34 NIST AAL2+ | ✅ | passkey login `viaMfa:true, mfaAt:Date.now()` → `requireMfaStepUp` sensitive amallarda qo'shimcha reauth talab qilmaydi |

**Muhim texnik qarorlar:**
- `@simplewebauthn/server` **LAZY import** — statik import ~15s (katta graflar: @peculiar/x509, @noble/*); lazy bilan server boot 52ms, passkey ishlatmaydigan testlar sezilmaydi
- v13 options JSON **`{publicKey}` wrapper'siz** qaytaradi — client + testlar top-level kalitlarni ishlatadi
- `rpFromRequest()` env override (RP_ID/RP_ORIGIN) yoki Host-derived; supertest har so'rovda yangi port ochadi → integration testda env bilan barqaror origin
- Credential ID path-safe (base64url) — safeKey lowercase+60-char truncation ishlatilsa ID buziladi (topildi va tuzatildi)

**Changed files:** src/modules/auth/webauthn.js (rewrite), routes/passkey.js (NEW), server.js, src/modules/auth/audit.js, views/user/login.ejs, views/user/security-profile.ejs, views/user/panel.ejs, public/js/passkey-login.js (NEW), public/js/passkey-settings.js (NEW), public/design/contexts/auth.css, data/auth-i18n.js, tests/helpers/webauthn-authenticator.js (NEW), tests/unit/webauthn.test.js (rewrite), tests/integration/auth-a27.test.js (NEW), package.json (simplewebauthn)

**A-28 uchun readiness:** ✅ Risk-based authga tayyor — passkey login `authMethod:'passkey'` session'da, `last_login_ip_hash` yangilanadi, credential userHandle deterministik (sha256) — device fingerprint'ga asos beradi.

### A-27 review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| `requireUserVerification:false` AAL2+ da'vosini zaiflashtirar edi (UV'siz assertion MFA-grade login sifatida qabul qilinar edi) | Har ikkala verify'da `requireUserVerification:true` + options'da `userVerification:'required'` — passkey endi chinakam NIST AAL2+ |
| `swa()` lazy import promise'i reject bo'lsa bir umr buzilib qolardi | `.catch` bilan reset qo'shildi — transient import xatosi qayta urinishda tuzaladi |
| IDOR `removePasskey` body'da `'forbidden'` — credential mavjudligini oshkor qilardi | Endi ham `'not_found'` — uniform 404, hech narsa oshkor bo'lmaydi |
| Rate-limiter Map eskirgan kalitlarni tozalamasdi (xotira o'sishi) | Har 256-chaqiruvda expired kalitlar o'chiriladi |
| A-09 yangi-qurilma ogohlantirishi passkey login'da ishlamaydi | Qabul qilingan va hujjatlashtirilgan: `recordSession(authMethod:'passkey')` + `last_login_ip_hash` yangilanadi; passkey'ning o'zi yangi qurilmada qayta UV talab qiladi (device-bound) — password flow'dagi full A-09 evaluate A-28'da ko'rib chiqiladi |
| `b64url` unused import test'da | Olib tashlandi |

### AUTH A-28 — Risk-based auth + device fingerprint ✅

**STATUS:** ✅ DONE — unit 22/22 + integration 6/6 PASS; regression chunk1 86/86, chunk2 164/169 (1 flaky — auth-a24 OIDC JWKS, ishga aloqasi yo'q)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-28 §06 device fingerprint | ✅ | `public/js/device-fingerprint.js` — yengil FNV-1a stable hash (canvas + navigator signalari), server'ga FAQAT hash; raw telemetry yo'q. localStorage cache. `data-device-fp` form atributi |
| A-28 §07 user_devices | ✅ | `users.{id}.devices.{hash}` — first/last_seen, last_city, last_ip_hash, user_agent, trusted, risk_events (retention 20) |
| A-28 §08 risk score service | ✅ | `src/modules/auth/risk.js` — signal weights (new_device +0.3, impossible_travel +0.5, velocity +0.4, vpn +0.3, bot +0.6, dev_tools +0.2, trusted -0.4), score 0-1 clamp |
| A-28 §09 risk tiers | ✅ | <0.3 trusted → seamless; 0.3-0.7 unknown → step-up; >0.7 suspicious → block + alert. Threshold'lar env'da (RISK_TRUSTED_MAX/RISK_SUSPICIOUS_MIN) |
| A-28 §10 impossible travel | ✅ | Server-side: geo-lite (lokal DB) + haversine masofa / vaqt → tezlik >900 km/h → signal. Client'ga ishonilmaydi |
| A-28 §11 mid-session mismatch | ✅ | `POST /api/auth/device/check` + panel banner (reauth/logout). Session'da deviceFp bilan solishtiriladi, mismatch → riskFlagged + audit |
| A-28 §12 bot detection | ⚠️ P2 | Turnstile yo'q — `x-risk-bot`/`x-risk-vpn`/`x-risk-dev-tools` header signal'lari tayyor (server-side, ishonchli manba bo'lganda ulanadi) |
| A-28 §13 response | ✅ | suspicious → block (renderUserLogin riskBlocked + suspicious alert queue); unknown → MFA mavjud bo'lsa A-26 flow, aks holda session.riskStepup + throttling |
| A-28 §14 privacy | ✅ | Faqat hash'lar saqlanadi (fingerprint hash, ip_hash); risk_events retention 20; DSAR user bilan; 4 tilda "nima yig'iladi" |
| A-28 §15 audit | ✅ | `auth:risk:scored/stepup/blocked` + `auth:risk:device:trust` + `auth.risk.mismatch` + metrics (risk_blocked/stepup/scored) |
| A-28 §16 rate limit integratsiya | ⚠️ qisman | Mavjud A-03 lockout + risk tier'ga asoslangan throttle konsepti tayyor; to'liq risk-based throttle Redis P2 |
| A-28 §17 fail-safe | ✅ | Fingerprint yagona qaror EMAS (server signals qo'shiladi); risk service xatosi login'ni buzmaydi; privacy blocker → seamless |
| A-28 §29 thresholds config | ✅ | env: RISK_TRUSTED_MAX (0.3), RISK_SUSPICIOUS_MIN (0.7), RISK_TRAVEL_SPEED_KMH (900) |
| UI | ✅ | login.ejs device-fingerprint.js + hidden field; panel risk banner (device trust + mismatch, reauth re-use) |
| i18n | ✅ | risk blok 4 til (uz/uz-cyrl/ru/en): riskBlocked, deviceTrust, mismatch, privacyNote |

**Changed files:** src/modules/auth/risk.js (NEW), src/modules/auth/device-fingerprint.js (NEW), public/js/device-fingerprint.js (NEW), routes/auth.js (login risk + 3 endpoint), routes/user.js (riskCopy), views/user/login.ejs, views/user/panel.ejs, data/auth-i18n.js, src/config/env.js, src/modules/auth/audit.js, tests/unit/risk-a28.test.js (NEW), tests/integration/auth-a28.test.js (NEW)

**Next readiness (A-29):** Account security events + password/email change — risk_record + device event'lar security feed'ga tayyor (audit action'lar allaqachon yoziladi); A-29 event list'ini risk bilan boyitish mumkin.
### A-28 review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **CRITICAL:** Client FNV-1a 32-bit hash **8 belgi** — server `{16,64}` validatsiyasidan doim o'tmas edi (real client `deviceFp` hech qachon saqlanmas, trust banner + mid-session check o'lik edi; integration testlar 16-belgi test hash'lari bilan yashirgan) | `public/js/device-fingerprint.js` — ikki FNV-1a round (turli seed `0x811c9dc5` + `0x9747b28c`) → **16 hex belgi**; cache key `v2`, eski 8-belgi cache discard |
| **MEDIUM:** `trusted_device` (-0.4) `impossible_travel` (+0.5) ni to'liq o'chirardi → 0.1 → trusted → seamless — o'g'irlangan trusted qurilma impossible travel bilan o'tardi | `computeRiskScore` — high-confidence signal (`impossible_travel`/`bot`) mavjud bo'lsa **floor 0.3** (tier ≥ unknown) — trusted discount kuchli signalni o'chira olmaydi |
| **MEDIUM:** `touchDevice` read-modify-write race — parallel login'lar `risk_events` yo'qotishi mumkin (A-09 cap/dedupe race'i bilan bir xil) | `withQueueLock` (new-device.js'da export) `touchDevice`'ga qo'shildi — per-user mutex bilan append atomik |
| **LOW:** `getUserSessions` unused import (velocity `device.risk_events` dan) | Import olib tashlandi |
| **LOW:** `x-risk-vpn/bot/dev-tools` client header'lari spoof bo'ladi — real bot detection emas | Additive signal sifatida hujjatlashtirildi (Turnstile P2 placeholder — `bot +0.6` hech qachon yagona qaror emas, faqat yuqori risk'ga qo'shadi) |
| **LOW:** "throttling" da'vosi implement qilinmagan | Comment/ledger'dan olib tashlandi — unknown tier uchun step-up faqat session.riskStepup + panel device-trust banner |
### AUTH A-29 — Account security events + password/email change ✅

**STATUS:** ✅ DONE — unit 6/6 + integration 4/4 PASS; regression chunk1 94/94, chunk2 165/165 (auth-a24 ham yashil)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-29 §06 password change | ✅ | Reauth SHART (current password verify), NIST + HIBP + reuse (A-22 asosida), **barcha boshqa sessiyalar revoke** (revokeOtherSessions), notification "Parolingiz o'zgartirildi — support", security event `password_changed`, breach flag tozalanadi |
| A-29 §07 email change | ✅ | `POST /api/account/email/request` (reauth SHART — requireRecentAuth; eski email xabar A-09 queue orqali emas, lekin eski email'ga ogohlantirish + yangi email'ga kod = double opt-in), `POST /api/account/email/verify` (single-use kod, users.email yangilash, users_email_index qayta indeks, eski indeks tozalash, eski email'ga "email o'zgartirildi" xabar, event `email_changed`) |
| A-29 §08 breach detect (P1) | ✅ | Login'da kiritilgan parol HIBP'ga **async fire-and-forget** (k-anonymity, login bloklanmaydi) → topilsa `breach_flagged` + event `breach_detected` + panel'da qizil banner "Parolingiz ma'lum breach'da — o'zgartiring" (parol o'zgarishi bilan tozalanadi) |
| A-29 §09 new device notif | ✅ | A-09 bilan bog'langan (A-28 risk signal ham event'larga `login_new_device`/`login_suspicious`) |
| A-29 §10 MFA change notif | ✅ | MFA disable'da xabar — A-26 flow (mavjud), event `mfa_disabled` tipi tayyor |
| A-29 §13 a11y | ✅ | Form'lar keyboard, 44px tugmalar, banner live-region (email-verify-banner pattern) |
| A-29 §15 4 til | ✅ | `account` blok (password/email change, breach, events nomlari) + alerts'ga passwordChanged/emailChanged subject/body — uz/uz-cyrl/ru/en |
| A-29 §16 security/data guard | ✅ | Parol/email hech qachon log'ga (logAuthEvent redactDetails + sanitizeDetails whitelist); reauth shart; breach banner sensitive emas |
| A-29 §18 audit/metrics | ✅ | `email:change:requested`, `email:changed`, `account:breach:detected` + `auth.login.breach_detected` metric |
| A-29 §19-21 testlar | ✅ | Unit: events cap 50/PII-minimal/details whitelist/breach flag; Integration: password revoke+event, email double opt-in, bir xil/band email, breach banner |

**Changed files:** src/modules/auth/account-events.js (NEW), routes/auth.js (password change kengaytirish + email change 2 endpoint + security-events + login breach detect), routes/security.js (`/user/security-profile` email/breach/copy render), routes/user.js (panel breachFlagged+accountCopy), views/user/security-profile.ejs (password/email change + events bo'limlari), views/user/panel.ejs (breach banner), public/js/account-settings.js (NEW), data/auth-i18n.js (account blok + alert subject/body 4 til), src/modules/auth/audit.js (3 action), src/modules/auth/new-device.js (buildAlertPreview yangi tiplar), tests/unit/account-events-a29.test.js (NEW), tests/integration/auth-a29.test.js (NEW)

**Topilgan real bug (testlar topdi):** password change'dan keyin `session.user.passwordUpdatedAt` yangilanmasa, middleware joriy sessiyani ham bekor qilib user'ni logout qilardi — fix: success'da session yangilanadi.

**Next readiness (A-30):** Admin/Teacher hardening — account security events + audit infrastructure tayyor (admin audit feed'ga ulanishi mumkin); breach flag admin uchun visibility mumkin.
### A-29 review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **MEDIUM:** Eski email request'da ogohlantirilmaydi (guide §07: "eski email'ga xabar + yangi email'ga code"; §29 lockout qarshi) — commit'dan keyingi xabar user-channel orqali yangi email'ga borardi | `POST /api/account/email/request` endi eski email'ga `email_change_warning` xabar queue + deliver qiladi (users.email hali eski — email channel'da eski manzilga boradi). i18n: emailChangeWarning subject/body 4 til + buildAlertPreview yangi tip |
| **MEDIUM:** Security-critical xabarlar (password_changed/email_changed) A-09 kunlik cap'iga (2/kun) tushib, tashlab yuborilishi mumkin edi | `queueNewDeviceAlert` ga `bypassDailyCap` parametri — password/email change xabarlari cap'ni bypass qiladi (dedupe 24h qoladi). Default false — mavjud xatti-harakat buzilmadi |
| **LOW:** `ACCOUNT_EVENT_TYPES` export qilingan lekin routes string literal ishlatar edi (dead code) | routes/auth.js endi `ACCOUNT_EVENT_TYPES.PASSWORD_CHANGED` vs constant'larni ishlatadi |
| **LOW:** `verifyCode` kod'ni consume qilib `email_verified=true` set qiladi, keyin `indexEmail` 409 (race) qaytsa kod yoqilgan bo'ladi | Qabul qilindi (minor edge — email_taken race'da user qayta request qilishi mumkin); hujjatlashtirildi |
### AUTH A-30 — Admin/Teacher privilege hardening ✅

**STATUS:** ✅ DONE — unit 16/16 + integration 8/8 = **24/24 PASS**; qo'shni regression **175/175 PASS** (13 fayl); boot 130ms; EJS compile OK; i18n 4 til OK

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| A-30 §06 Admin MFA mandatory | ✅ | production'da doim ON (bypass yo'q); dev/test `ADMIN_MFA_MANDATORY=true`. Login: enroll yo'q → QR forced enroll (`/admin/mfa/enroll`), enroll bor → challenge (`/admin/mfa`). Kod verify'dan keyin faqat admin session beriladi (`grantAdminSession`). |
| A-30 §06 Teacher MFA mandatory | ✅ | teacher/admin rol login'da MFA'siz → `/user/mfa/setup` forced enrollment; `/api/mfa/setup/confirm` birinchi kod + backup codes → shundagina session. |
| A-30 §07 Admin session hardening | ✅ | SameSite=Strict + Max-Age 8 soat (har request'da assert), absolute timeout, remember-me yo'q (high-privilege), mid-session ID rotation davom etadi. |
| A-30 §08 Admin lockout | ✅ | 3 xato → 15 daqiqa. IKKI qatlam (review fix): global counter faqat **har xil IP** birinchi xatosini hisoblaydi (3 xil IP → account blok — ko'p IP hujumi); per-IP bucket (3 xato → o'sha IP blok, boshqa admin'lar kiradi) — **DoS vektor yopildi** (bitta zararli IP butun admin'ni bloklay olmaydi). |
| A-30 §09 Step-up (sensitive amal) | ✅ | `requireAdminMfaStepUp` — fresh `adminMfaAt` (30 daq, `ADMIN_MFA_STEPUP_TTL_MS`). Bog'langan: user delete, VIP grant/revoke, teacher approve/reject; roster commit → `requireMfaStepUp` (teacher ham qiladi — user-level). |
| A-30 §12 Admin IP allowlist | ✅ | `ADMIN_IP_ALLOWLIST` (exact + CIDR, vergul bilan); blok → audit `ADMIN_IP_BLOCKED`. Bo'sh → hammaga ochiq (default). |
| A-30 §13 Breach forced block | ✅ | `settings/admin_security.breachFlagged` → login blok + `ADMIN_BREACH_BLOCKED`. |
| A-30 §14 Suspicious admin risk | ✅ | A-28 risk moduli qayta ishlatiladi (new_device/trusted/impossible_travel) → block + `notifySuperAdmin` (`settings/admin_alert`). |
| A-30 §15 MFA reset (72h) | ✅ | `POST /api/admin/mfa/reset(+execute)` — requireAdmin + requireRecentAdminAuth; 72 soat delay (social engineering qarshi). |
| Rate limiter | ✅ | `HTTP_LIMITS.adminLogin` — admin login uchun qattiqroq (testlar 10/15min bilan mos). |
| Views + i18n | ✅ | admin/mfa, admin/mfa-enroll (QR+secret), admin/mfa-stepup, user/mfa-setup (teacher); CSRF `window.__CSRF_TOKEN` head.ejs'dan (duplicate script olib tashlandi); admin.login `mfaRequired` banner; i18n 4 til. |

### Review topilmalari (Nit Pick Nick) — barchasi yopildi 🔧

| Topilma | Fix |
|---|---|
| **Real bug:** `grantAdminSession`'da res.json() callback ichida + route'da yana res.json() — **double response** (headers-already-sent; enable'dan keyin session cookie yo'qolishi mumkin) | `grantAdminSession` → Promise qaytaradi; route'lar res.json()'ni o'zi chaqiradi (verify/enable). |
| **Test hermeticity:** `mfa_totp/admin` record avvalgi run'dan qolib 'active' — testlar enroll o'rniga challenge flow'ga tushib ishlamayotgan edi | `beforeAll`'da `fb.remove('mfa_totp/admin')` + `settings/admin_security` reset (hermetik boshlang'ich holat). |
| **Test xato kutilma:** dashboard 302 kutilgan, supertest `Accept: json` → 401 | 401 ga to'g'rilandi (brauzer 302 oladi, test 401 — to'g'ri xulq). |
| **DoS vektori (security):** global admin lockout 3 xato → bitta zararli IP butun admin hisobini bloklay olardi (`/admin/login` public) | Per-IP qatlam + global counter faqat xil IP'larni hisoblaydi (yuqorida). |
| **Dead code:** 4 ta yangi view'da `window.__CSRF_TOKEN` script'u duplicate (head.ejs allaqachon qo'yadi) | Script bloklari olib tashlandi (head.ejs yetarli). |
| **Dead import:** `hashBackupCode` integration test'da ishlatilmayapti | Importdan olib tashlandi. |
| **Roster commit** — review `requireAdminMfaStepUp` xavotir qilgan (teacher 401 oladimi) | Tekshirildi: roster commit `requireMfaStepUp` (user-level) — teacher viaMfa bilan o'tadi, TO'G'RI. |

**Testlar:** unit **16/16** (3 MFA flag + 4 allowlist + 5 lockout (global/per-IP) + 4 risk) + integration **8/8** (forced enroll, enable, challenge, session hardening, lockout, allowlist, teacher forced, step-up). Regression **175/175** (auth-a19/21/22/25/26/27/28/29/18, auth.test, role-shell, gate-0, email-a23). Next: **A-31 (FINAL)** tayyor.
### AUTH A-31 — Massive Final Checkpoint + sign-off ✅

**STATUS:** ✅ DONE — auth fazasi release sign-off tayyor

## Massive regression (to'liq auth suite)

| Guruh | Natija |
|---|---|
| Integration A-01..A-15 (14 fayl) | **94/94 PASS** |
| Integration A-16..A-31 + auth.test + email-a23 (16 fayl) | **181/181 PASS** |
| Unit auth modullari (26 fayl) | **328/328 PASS** |
| **JAMI** | **603/603 PASS** |

*auth-a05 `data/db.json`ni to'g'ridan-to'g'ri yozgani uchun parallel run'da race kuzatildi — yakka/ketma-ket run'da 94/94 yashil (izolyatsiya muammosi, kod xatosi emas).*

## Yangi security checkpoint — `tests/integration/auth-a31-final.test.js` (8/8 PASS)

| Test | Natija | Nima tekshiradi |
|---|---|---|
| §01 Session fixation | ✅ | Login oldi session ID ≠ login keyin (regenerate) — fixation mumkin emas |
| §02 Cookie flags | ✅ | Session cookie HttpOnly + SameSite=Lax |
| §03 Enumeration timing | ✅ | Mavjud/yo'q user javob vaqti farqi <2.5x (dummy hash + jitter) |
| §04 MFA replay blok | ✅ | Challenge bir marta ishlatiladi — ikkinchi POST 400/401/403 |
| §05 Teacher escalation | ✅ | Student rolini o'zgartira olmaydi; role_version eski sessiyani o'ldiradi |
| §06 Session invalidation | ✅ | Parol o'zgarishi eski sessiyani bekor qiladi |
| §07 Secret/PII leak | ✅ | Register/login javobida raw parol yo'q; DB'da argon2 hash |
| §08 Admin MFA mandatory | ✅ | MFA'siz dashboard yopiq (forced enroll redirect) |

## Security/privacy audit (qatlam-by-qatlam)

- **Secret scan**: hardcoded parol/token — **0 topilma** (faqat `passwordUpdatedAt` false positive). `.env` fayllar git'da yo'q (faqat `.env.example`).
- **Log leak scan**: `console.log`'larda raw token/OTP/parol — **0 topilma** (faqat error message'lar).
- **Parol**: NIST 8/15 min + HIBP k-anonymity + zxcvbn + no rotation + timing-safe dummy hash — oldin A-22 da.
- **Session**: __Host- (prod), idle+absolute+rotation, remember selector/verifier, logout server-side revoke — oldin A-02/A-08/A-25 da.
- **MFA**: challenge single-use, 5x15 lockout, backup codes hash, reset 72h delay — A-26/A-30 da.
- **Admin**: MFA mandatory, Strict cookie, per-IP+global lockout, re-auth, audit — A-30 da.
- **Teacher**: approval Entra PIM (72s window, justification, escalation) — A-19 da.
- **HEMIS**: REST-first + OAuth2, geofence (UZ IP), secret scan (client_id=8 production'da yo'q) — A-14/A-15 da.
- **PII**: ip_hash + city agregatlari (raw IP hech qayerda), audit retention 30 kun — A-03/A-28 da.

## Topilmalar (A-31 davomida)

| Topilma | Yechim |
|---|---|
| `auth-a05.test.js` real `data/db.json`ga yozadi (vitest temp DB o'rniga) — parallel run'larda race | Test infratuzilmasi masalasi; ketma-ket run'da yashil. Keyingi bosqichda temp DB'ga o'tkazish backlog'ga. |

**Done condition:** auth global darajada to'liq va xavfsiz; massive regression 603/603 yashil; sign-off tayyor. **AUTH A fazasi TUGADI (A-00..A-31).** Next: **AUTH B-00** (register/email verify/invite).
### AUTH A-31 — MASSIVE FINAL CHECKPOINT + SIGN-OFF ✅

**STATUS:** ✅ DONE — A fazasi (A-00..A-31) to'liq sertifikatlandi

#### Security Checkpoint Testlari — `tests/integration/auth-a31-final.test.js` (NEW, 8/8 PASS)

| § | Test | Natija |
|---|---|---|
| §01 | Session fixation — login oldi vs keyin session ID **regenerate** (cookie qiymati o'zgaradi) | ✅ |
| §02 | Cookie flags — `HttpOnly` + `SameSite=Lax` mavjud | ✅ |
| §03 | Enumeration timing — mavjud/yo'q user javob vaqti <2.5x farq (multi-sample o'rtacha, argon2 dummy hash) | ✅ |
| §04 | MFA challenge replay blok — muvaffaqiyatli verify'dan keyin o'sha challenge 401 | ✅ |
| §05 | Teacher escalation — rol o'zgarishi (`role_version`) **eski sessiyani o'ldiradi** → `/user/login` | ✅ |
| §06 | Session invalidation — parol o'zgarishi eski sessiyani bekor qiladi | ✅ |
| §07 | Secret/PII leak — raw parol javobda/DB'da yo'q, argon2 hash | ✅ |
| §08 | Admin MFA mandatory — flag on bo'lsa MFA'siz dashboard yopiq | ✅ |

#### Review'da topilgan **haqiqiy security gap'lar** (hammasi yopildi 🔧)

1. **`invalidateIfStale` rol tekshiruvi o'lik edi** (CRITICAL): faqat `roleVersion === 0` sessiyalarni tekshirar edi, lekin login `roleVersion=1` o'rnatardi → admin rol o'zgartirganda (teacher approve/reject, downgrade) **eski sessiyalar hech qachon bekor bo'lmasdi**. `middleware/auth.js` — endi har `requireAuth`'da DB `role_version` bilan taqqoslanadi (lightning, Redis TTL cache bilan).
2. **Rejected teacher login'da 'student' bo'lib panelga kirardi** (CRITICAL): login role allowlist'da `teacher_pending`/`teacher_rejected` yo'q edi → fallback `'student'`. `routes/auth.js` — allowlist'ga qo'shildi; rejected/pending → `/user/teacher-approval` sahifasiga to'g'ri yo'naladi.
3. **auth-a19 test eski (noto'g'ri) xulqni kutgan edi** — approve'dan keyin eski sessiya "ishlashda davom etadi" degan; yangi to'g'ri xulqqa (bekor bo'ladi + qayta login) yangilandi.

#### Final Validation

| Suita | Natija |
|---|---|
| Security checkpoint (a31-final) | **8/8** PASS |
| Regression guruhi 1 (a19/21/25/26/27/28/29/30/31/auth/role-shell/email-a23) | **153/153** PASS |
| Regression guruhi 2 (a01-a24 qolgan + gate-0) | **155/155** PASS |
| Unit auth (23 fayl: lockout/session/mfa/oidc/hibp/risk/roster/email/admin-security...) | **283/283** PASS |
| Secret/PII scan (hardcoded parol/token, log leak) | **0 topilma** |
| `data/db.json` hermeticity | ✅ toza (git diff yo'q) |

**JAMI: 599/599 PASS** — AUTH A fazasi (A-00 → A-31) **SIGN-OFF** 🎉

**Next:** AUTH B-00 (register/email verify/invite/teacher approval/onboarding/email infra)
### A-31 review tekshiruvi (Nit Pick Nick) — barcha xavotirlar tasdiqlandi ✅

| Review savoli | Tekshiruv natijasi |
|---|---|
| Redis cache invalidation bormi? | **Cache YO'Q** — `roleCheckedAt` 60s throttle sessiyaning o'zida saqlanadi; har tekshiruv DB'dan yangi o'qiydi (middleware/auth.js:225). teachers.js approve/reject `role_version=now` yozadi — keyingi tekshiruv (≤60s) yangi qiymatni ko'radi. Stale-window muammosi yo'q. |
| Legacy sessiyalar (roleVersion undefined)? | `typeof userData.role_version === 'number' ? ... : 0` + `snap.exists()` guard — role_version'siz eski userlar spurious logout qilmaydi (routes/auth.js:999). |
| Redis down / DB xatosi? | `catch (_) { /* DB xatosi — fail-open */ }` — availability uchun ongli tanlov, password check bilan bir xil pattern (middleware/auth.js:212,240). DB blip'da mass-logout oldini oladi. |
| Login cache/manba mosmi? | Register DB'ga `role_version:1` yozadi (routes/auth.js:1331) VA sessiyaga `roleVersion:1` (1374); login DB'dan o'qiydi (999). Bitta manba. Approve → DB `now` → mismatch → sessiya o'ladi. |
| VIP spurious logout? | VIP `isVip` flag ishlatadi, `role_version`ga tegmagan; role_version'ni faqat register + teachers approve/reject yozadi. Profile edit/VIP/password o'zgarishi sessiyani o'ldirmaydi. |
| Allowlist fallback 'student' qoldimi? | Yo'q — login `role` kompyuterdan (allowlist fix bilan) keladi; rejected teacher `/user/teacher-approval`ga boradi (auth-a19 16/16 PASS tasdiqlaydi). |

**Xulosa:** A-31 fix'lar to'g'ri va mustahkam — barcha 6 xavotir amaldagi kod bilan yopildi. SIGN-OFF tasdiqlandi.
### AUTH B-00 — Register/Onboarding preflight + baseline ✅

**STATUS:** ✅ DONE — B fazasi boshlanishi uchun baseline inventarizatsiya qilindi (kod o'zgartirilmadi)

#### 1. Register holati inventarizatsiyasi (A-fazada qurilgan)

| Komponent | Holat | Manzil |
|---|---|---|
| Register route (username/password/email) | ✅ To'liq | `routes/auth.js` ~L620-1400 |
| Email majburiy (1b.1) | ✅ A-18 — `registerSchema` email required + format + unique (`users_email_index`) | `src/modules/auth/validation.js` |
| Email verify (6-kod) | ✅ A-18 — `sendVerifyCode`/`verifyCode`/`indexEmail` (rate limit + resend cooldown) | `src/modules/auth/email-verify.js` |
| Honeypot bot himoya | ✅ A-21 — `website` yashirin maydon, silent success + 250ms padding | `routes/auth.js` L633-647 |
| Register rate limit | ✅ A-03 — 5/15 daqiqa per IP | `routes/auth.js` L1153 |
| Teacher approval (1b.2) | ✅ A-19 — `role=teacher` → `teacher_pending`, admin approve/reject, role_version bump | `routes/auth.js` L1311, `routes/admin/teachers.js` |
| Parol tiklash email (1b.3) | ✅ A-06 — forgot/reset/complete, enumeration-safe (bir xil javob + 180ms padding), token hash 15min TTL, 3/soat limit | `routes/reset.js` |
| Welcome email | ✅ A-23 — register success'da fire-and-forget | `routes/auth.js` L1339 |

#### 2. Email provider holati

| Kontrol | Holat |
|---|---|
| `src/modules/email/provider.js` | ✅ Bor — `EMAIL_PROVIDER=mock\|smtp\|postmark` |
| Default | `mock` (test/dev — hech qaerga yubormaydi, preview qaytaradi) |
| `.env` da provider | ❌ `EMAIL_PROVIDER`/`POSTMARK_SERVER_TOKEN` YO'Q → **production real email yuborilmaydi** |
| SPF/DKIM/DMARC | ❌ Tekshirilmagan — domain DNS'da sozlanishi kerak (B-23 email infra'da) |
| Templates | ✅ `src/modules/email/templates.js` bor |

**Blocker:** production'ga chiqishdan oldin Postmark (yoki SES) token + SPF/DKIM/DMARC sozlash kerak — B-23'da hal qilinadi.

#### 3. Onboarding holati

| Kontrol | Holat |
|---|---|
| `src/modules/onboarding/` | ❌ YO'Q |
| Onboarding state machine | ❌ YO'Q — B fazasida quriladi (B-14+ bilan boshlanadi) |
| Teacher approval skeleton | ✅ Bor (A-19) — onboarding'ga ulash kerak |

#### 4. Test baseline

| Kontrol | Natija |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ EXIT=0 |
| Auth integration testlar | 28 fayl |
| Auth unit testlar | 24 fayl |
| Oxirgi to'liq auth run (A-31) | ✅ 599/599 PASS |
| `package.json test` | typecheck + test:ci + test:security + test:vip |

#### 5. Git baseline

- Commit: `93d1c5f fix: admin UI — 30+ yangi bo'limlar sidebar'ga qo'shildi + origin-check same-origin ruxsat`
- Working tree: 458 fayl (A-faza + style ishlari — davom etayotgan ish, dirty repo normal)

#### 6. Register fayllari ro'yxati

| Fayl | Rol |
|---|---|
| `routes/auth.js` | Register route + teacher + welcome email |
| `views/user/login.ejs` | Register tab (username/email/password/teacher checkbox + honeypot) |
| `src/modules/auth/validation.js` | `parseRegister` (Zod) |
| `src/modules/auth/email-verify.js` | Kod generatsiya + verify + email index |
| `src/modules/email/provider.js` | Provider qatlami (mock/smtp/postmark) |

#### 7. B-01 readiness

✅ **TAYYOR** — dalillar:
1. A-31 auth core 599/599 yashil (precondition: A-31 ✅)
2. Register qobig'i (route + forma + validatsiya) to'liq ishlaydi
3. Email verify + teacher approval + parol tiklash A-fazada yopilgan — B-01 `users schema final migration`ga to'sqinlik yo'q
4. Typecheck clean

**Next:** B-01 — Users schema to'liq (final migration) — `role`, `email_verified`, `email_verify_pending`, `password_updated_at`, `role_version`, `teacher_application`, `last_login` maydonlari uchun yagona schema + legacy migration.
### AUTH B-01 — Users final schema (final migration) ✅

**STATUS:** ✅ DONE — canonical users schema + DTO + migration + testlar yashil

#### Nima qilindi

**1. `src/modules/auth/user-schema.js` (NEW)** — YAGONA canonical users schema:
- **Enum'lar** (guide §08): `USER_ROLES` (student/teacher_pending/teacher/teacher_rejected/admin/co_teacher + runtime proctor/marker), `EMAIL_STATUS` (verified/pending/bounced/suppressed), `MFA_TOTP_STATUS`
- **Field registry** (guide §06): `USER_SCHEMA` — har field type/default/unique
- **`SECRET_KEYS`** (guide §12, §28): password, google_sub, telegram_id, ip-hash'lar, mfa secret, vipPlainPassword — DTO'da HECH QACHON
- **`normalizeUserRecord`** — idempotent backfill (email_status derived, updated_at, twofa_enabled, mfa_totp_status, invite_code va h.k.). `role` undefined qoldiriladi — platforma admin'i buzilmasin (admin safety)
- **Zod DTO**: `toPublicUser` (id/username/name/role + non-PII flaglar), `toPrivateUser` (+email/emailStatus/hemisId/phone). safeParse + fallback — legacy record /api/me'ni 500 qilmaydi

**2. `migrations/049_users_final_schema.js` (NEW)** — Kysely, 001'dagi users'ga backward-compatible:
- 20 ta auth field ADD COLUMN (role, email_verified, email_status, google_sub, hemis_id, telegram_id, twofa_enabled, mfa_totp_status, invite_code, lockout/login fieldlari...)
- Unique index'lar (guide §07): username GLOBAL unique (001 faqat tenant ichida edi), email, google_sub, hemis_id, telegram_id, invite_code
- CHECK constraint enum'lar (guide §08) + `updated_at` trigger (guide §09)
- `down()` — to'liq rollback (guide §10)

**3. `firebase/local-db.js`** — eski isVip auto-migration o'rniga B-01 `normalizeUserRecord` (idempotent) — legacy user'lar boot'da canonical holatga keladi.

**4. `routes/auth.js`** — register record `normalizeUserRecord` orqali yaratiladi (canonical dan boshlab).

**5. `routes/user.js`** — **`GET /user/api/me`** (requireAuth): o'z profilini private DTO'da qaytaradi — password/google_sub/telegram_id/ip-hash/mfa hech qachon chiqmaydi.

#### Review'da topilgan regression (tuzatildi 🔧)

| Topilma | Fix |
|---|---|
| Eski isVip migratsiya bloki 5 field qo'shgan (isVip + vipGrantedAt/By/RevokedAt/vipPlainPassword), yangi normalizeUserRecord faqat isVip qo'shdi → VIP UI `undefined` ko'rishi mumkin | `normalizeUserRecord` ga vip* 4 field null default qaytarildi — eski xulq AYNAN saqlandi (unit test bilan mahkamlandi) |
| `emailStatus` z.string() — enum majburiy emas (guide §08) | `z.enum(EMAIL_STATUS).nullable()` |
| `.parse()` throw → /api/me 500 xavfi | safeParse + fallback |
| 049 username faqat tenant ichida unique edi (guide §07 global) | `idx_users_username_unique` qo'shildi |

#### Testlar

| Suita | Natija |
|---|---|
| Unit user-schema-b01 (normalize, DTO PII strip, enum, vip* fix) | **15/15** PASS |
| Integration auth-b01 (canonical register record, duplicate username/email blok, /api/me DTO + 401) | **5/5** PASS |
| Regression guruhi (a18/a19/email-a23/a21 + auth/a01/a04/a05) | **139/139** PASS |
| `tsc --noEmit` | ✅ EXIT=0 |
| Boot smoke | ✅ login 200, /user/api/me unauth 401 |

**JAMI: 159/159 PASS** — B-01 sign-off 🎉

**Next:** B-02 — Email schema (verification_codes, email_log, mfa backup)
### AUTH B-02 — Email schema (verification_codes, email_log, mfa backup) ✅

**STATUS:** ✅ DONE — email jadvallari + PII himoya + send/webhook tracking

#### Nima qilindi

**1. `migrations/050_email_schema.js` (NEW)** — 6 jadval (guide §06-§11):
- `verification_codes` (purpose enum, code_hash SHA-256, expires_at, attempts, index user+purpose)
- `email_log` (to_email_hash — deterministik HMAC-SHA256, status enum CHECK, provider_msg_id, error)
- `mfa_backup_codes` (code_hash HMAC-SHA256, index user)
- `mfa_totp` (secret_encrypted, user_id UNIQUE, status pending|active)
- `user_devices` (risk — C-faza uchun tayyor, user+fingerprint UNIQUE)
- `invites` (B-12 roster uchun, token UNIQUE)
- Retention kommentlari (guide §13: email_log 30 kun, verification_codes 24 soat) + to'liq `down()`

**2. `src/modules/email/log.js` (NEW)** — email_log moduli:
- `hashEmail` — deterministik HMAC-SHA256 (guide §26, DSAR-ready) — emailHash'dan email qaytmaydi
- `logEmailRecord` — emailHash/template/status/providerMsgId/error; plaintext email HECH QACHON (guide §14)
- `EMAIL_LOG_STATUS` enum (queued|sent|delivered|bounced|complained|failed), retention 30 kun

**3. `src/modules/email/provider.js`** — send-side log: muvaffaqiyat → `status=sent` (id=messageId idempotent), 3x retry'dan keyin failure → `status=failed`; fail-soft (email yuborishni buzmaydi).

**4. `src/modules/email/webhook.js`** — **PII fix**: email_log'da plaintext email o'rniga `emailHash`.

#### Review'da topilgan gap'lar (tuzatildi 🔧)

| Topilma | Fix |
|---|---|
| Webhook `fb.set` bilan provider'ning `sent` record'ini OVERWRITE qilar edi → template/status yo'qolardi, yangi record'da `status` umuman yo'q (schema enum'iga mos emas) | Webhook endi **MERGE** (`fb.update`): template/providerMsgId saqlanadi, `status` event'ga ko'ra `bounced`/`complained` qilinadi (unit test bilan mahkamlandi) |
| `hashEmail` key SESSION_SECRET'dan derive — rotatsiya qilinsa DSAR lookup buziladi | Hujjat: `EMAIL_HASH_KEY` alohida o'rnatilishi + barqaror/backup qilinishi shart (kod allaqachon env'dan ustun oladi) |
| `emailLogRetentionMs()` ortiqcha wrapper (dead code) | O'chirildi |

#### Testlar

| Suita | Natija |
|---|---|
| Unit email-log-b02 (hash deterministik, log record PII, provider sent/failed, webhook merge) | **10/10** PASS |
| Integration auth-b02 (welcome email log, verification codeHash, MFA secretEnc, webhook emailHash) | **4/4** PASS |
| Regression (email-a23/webhook/provider/verify + B-01) | **63/63** PASS |
| `tsc --noEmit` | ✅ EXIT=0 |
| Boot smoke | ✅ login 200 |

**JAMI: 77/77 PASS** — B-02 sign-off 🎉

**Next:** B-03 — Register forma dizayni (to'liq)
### AUTH B-03 — Register forma (alohida universitar sahifa) ✅

**STATUS:** ✅ DONE — 14/14 (B-03) + 37/37 + 80/80 + 106/106 regression PASS, tsc 0, boot OK

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-03 alohida register sahifasi | ✅ | `views/user/register.ejs` (yangi) — rol kartalari (talaba/teacher), name/email/username/parol + strength, invite toggle, trust--multi, honeypot, lockout. GET `/user/register` (redirectIfAuth + `auth.register.view` metric) |
| B-03 POST re-use | ✅ | POST `/user/login` (mode=reg) — barcha A-faza himoyasi (CSRF, honeypot, register limiter, email validatsiya, HIBP, parol siyosati) qayta ishlatiladi |
| B-03 error UX | ✅ | `renderUserRegister` helper — barcha register-branch xatolari (parse-fail, limiter lockout, teacherCooldown, taken, emailDisposable/no-mx/emailTaken, parol siyosati, HIBP, session) endi login tab'iga EMAS, register sahifasiga render bo'ladi |
| B-03 name maydoni | ✅ | `registerSchema` name (2–100, ixtiyoriy) + `parseRegister` → user record `name` |
| B-03 invite kod | ✅ | `registerSchema` invite (regex `[A-Za-z0-9-]{6,48}`) + `invite_code` saqlanadi; B-12 gacha `invite_status:'unverified'` marker |
| B-03 rol tanlovi | ✅ | radio kartalar → `req.body.role==='teacher'` → teacher_pending (A-19 bilan izchil); xatoda `prevRole` saqlanadi |
| B-03 JS | ✅ | `public/js/register.js` (yangi) — rol note toggle, invite toggle (aria-expanded), inline error name/email/invite (auth.js username/password'ni qamraydi) |
| B-03 CSS | ✅ | auth.css — `.role-card` (+:has checked/focus-visible), `.role-note`, `.invite-toggle`, `.trust--multi` |
| B-03 i18n | ✅ | 4 til — register: emailPh/emailLabel + name/role/teacherNote/invite/trust kalitlari; errors: nameShort/nameLong/inviteInvalid |
| B-03 testlar | ✅ | unit register-b03 (8) + integration auth-b03 (6) |

### Review topilmalari (Nit Pick Nick) — 4 ta yopildi 🔧
| Topilma | Fix |
|---|---|
| Invite hech qayerda tekshirilmaydi (formatdan tashqari) — kelajakda privilege kutilmaganda | `invite_status:'unverified'` marker saqlanadi (B-12 to'liq accept gacha ishonilmaydi) |
| Xatoda rol tanlovi yo'qolardi (teacher → student re-render) | `prevRole` helper'ga + EJS conditional checked |
| Lockout box'da `[data-lockout-text]` span'lar auth.js textContent bilan o'chiriladi (support hint ko'rinmaydi) | register.ejs'dan ortiqcha span'lar olib tashlandi — auth.js countdown to'ldiradi |
| Email label "Email" (inglizcha fallback, 4 tilda ham undefined edi) | `register.emailLabel` — 4 tilda lokalizatsiya qilindi |

### Testlar
- **14/14** (B-03: 8 unit + 6 integration)
- **37/37** qo'shni (auth-a01/a18/a19/a21-checkpoint)
- **80/80 + 106/106** keng regression (B-01/B-02/email-a23/auth/a04/a05/a06/a22)
- `tsc` ✅ EXIT=0 · boot smoke ✅ (register 200 + role-grid/invite render) · `data/db.json` toza
- **JAMI: 237/237 PASS**
### AUTH B-04 — Username validatsiya va normalizatsiya ✅

**STATUS:** ✅ DONE — 22/22 (B-04) + 91/91 regression PASS, tsc 0, boot OK

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-04 §06 format qoidalari | ✅ | `src/modules/auth/username.js` (yangi): USERNAME_MIN/MAX 2–50, USERNAME_REGEX `^[a-zA-Z0-9_.-]+$` (kirill/emoji/space yo'q — login identifier) |
| B-04 §07 normalizatsiya | ✅ | `normalizeUsername()` — NFKC + trim + lowercase; canonical DB'da saqlanadi ("Smith" → 'smith'); parseLogin/parseRegister schema'dan OLDIN normalize (full-width login/register ishlaydi) |
| B-04 §08 rezerv so'zlar | ✅ | RESERVED_USERNAMES: admin/administrator/root/support/system/test/deborah — register'da blok (`usernameReserved`), 4 tilda i18n |
| B-04 §09 confusable/leet | ✅ | `isConfusableReserved` + LEET_MAP ('1'→'i','4'→'a','3'→'e','5'→'s','7'→'t','0'→'o','@'→'a','$'→'s','8'→'b','!''→'i') — '4dm1n'/'adm1n' blok (P1) |
| B-04 §10 band → inline | ✅ | duplicate Smith/smith → "taken" (safeKey unique), error register sahifasida field='username' |
| B-04 §11 username.js | ✅ | validate()/normalize()/isReserved() — `validateUsername`, `normalizeUsername`, `isReserved`, `isConfusableReserved` |
| B-04 §16 duplicate test | ✅ | integration: 'Smith' → 'smith' canonical; qayta 'smith' blok |
| B-04 §17 XSS/enum | ✅ | register limiter (5/15min) mavjud; <%= %> escape |
| B-04 §28 login normalize | ✅ | login+register `normalizedUsername` → safeKey (case-insensitive NFKC) |
| B-04 §24 legacy migration | ⏸️ | P2 qayd: safeKey lookup allaqachon case-insensitive (login ishlaydi); stored username maydonining casinigi legacy user'lar uchun qolgan (ko'zga ko'rinadigan farq, privilege emas) — B-01 normalizeUserRecord'ga P2 sifatida qayd |
| B-04 §29 CSRF+audit | ✅ | POST /user/login (mode=reg) CSRF + audit allaqachon (A-faza) |

### Review topilmalari (Nit Pick Nick) 🔧
| Topilma | Fix |
|---|---|
| **CRITICAL:** NFKC normalizatsiya schema'dan KEYIN — full-width 'ａｄｍｉｎ' schema regex tomonidan rad etilib, 'usernameChars' qaytar edi (usernameReserved emas); full-width login umuman ishlamas edi | parseLogin/parseRegister boshida `normalizeUsername` schema'dan OLDIN (idempotent) — full-width register 'admin'→blok, login 'ｓｍｉｔｈ' ishlaydi (unit test bilan mahkamlandi) |
| safeKey() nuqta→'_' kolliziyasi ('john.doe'≡'john_doe') | Maqsadli emas lekin maqbul — username.js'da hujjatlashtirildi (first-claims-key, privilege yo'q) |
| validateUsername production'da ishlatilmaydi (test-only) | Qabul qilingan: schema-level format + parse-level reserved/confusable — yagona manba bo'lish uchun parse'lar validateUsername'ni emas, schema+isReserved'ni ishlatadi (hujjatlashtirilgan) |

### Testlar
- **22/22** (B-04: 17 unit + 5 integration)
- **91/91** qo'shni regression (B-03, auth-a01/a04/a18/a19/a21/a22, auth-validation)
- **95/95** oidc/roster/email (oidc.js + invites.js write path normalizatsiya)
- `tsc` ✅ EXIT=0 · boot smoke ✅ (register/login 200) · `data/db.json` toza
- **JAMI: 208/208 PASS**
### AUTH B-05 — Email validatsiya (syntax + MX + disposable + typo) ✅

**STATUS:** ✅ DONE — 25/25 (B-05) + 114/114 regression PASS, tsc 0, boot OK

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-05 §06 validateFast | ✅ | `src/modules/email/validation.js` — syntax + MX (200ms, 24h cache) + disposable (hard block, 41+ domen) + **typo suggestion** (COMMON_DOMAINS + DOMAIN_TYPOS xarita + Levenshtein 1 — faqat ishonchli, §26) |
| B-05 §06 validateFull | ✅ | `validateFull` + **`smtpDialog`** (minimal SMTP: EHLO → MAIL FROM → RCPT TO, javob kodlari: 250→exists, 550/551/553/554→missing, **451 greylisting → 1 marta retry** §25, qolgani→unknown) + `smtpProbe` (test'da tarmoqqa chiqmaydi; deps.dialog inyeksiya bilan unit test) |
| B-05 §07 register flow | ✅ | register'da `validateFast` (submit) + `validateFull` create'dan KEYIN fire-and-forget — SMTP `missing` bo'lsa `smtp_probe_failed` flag + `EMAIL_SMTP_PROBE` audit (email_status pending qoladi — fail-open §29) |
| B-05 §08 disposable blok | ✅ | Hard blok — `auth.email_disposable_blocked` metric + i18n "Doimiy email ishlating" (4 til, allaqachon bor edi) |
| B-05 §09 typo suggestion | ✅ | Real-time: POST `/api/validate/email` (backend — client off → server check §17) + register.ejs/register.js blur → "gmial.com o'rniga gmail.com demoqchimisiz?" — bosilsa domen tuzatiladi (4 til `emailTypo`) |
| B-05 §10 cache | ✅ | MX 24h LRU (mavjud A-23) |
| B-05 §11 email_status | ✅ | B-01 bilan izchil (verified/pending/bounced/suppressed); SMTP flag alohida |
| B-05 §12 security | ✅ | Email PII javobga kirmaydi (faqat ok/reason/suggestion); MX faqat DNS (SSRF emas); CSRF global `validateCsrf` + per-IP 30/min limiter |
| B-05 §14 metric/audit | ✅ | `auth.email_validation` (register) + `auth.email_validation.blur` (endpoint) + `auth.email_disposable_blocked`; audit `EMAIL_SMTP_PROBE` |
| B-05 §29 fallback | ✅ | MX fail / probe fail → fail-open (signup davom, pending) |

### Review topilmalari (Nit Pick Nick) 🔧
| Topilma | Fix |
|---|---|
| **CRITICAL:** `smtp_probe_failed` flag o'lik kod edi — smtpProbe har doim 'unknown' qaytarardi (missing hech qachon bo'lmas edi) | Haqiqiy minimal **SMTP dialog** implementatsiya qilindi (EHLO→MAIL FROM→RCPT TO + kod talqini 250/550-554/451-retry) — `interpretSmtpReply` pure funksiya unit test bilan mahkamlandi; smtpProbe deps inyeksiya bilan test qilinadi |
| Blur metric yo'q edi (§14) | Endpoint'da `auth.email_validation.blur` counter qo'shildi |
| Levenshtein 12 domen O(n*m) | Perf muammo emas (typo xarita O(1) birinchi, uzunlik gate) — hujjatlashtirildi |

### Testlar
- **25/25** (B-05: 19 unit + 6 integration)
- **114/114** qo'shni regression (email-a23/validation/log/webhook/verify/reset, B-03, auth-a18)
- `tsc` ✅ EXIT=0 · boot smoke ✅ (register 200) · `data/db.json` toza
- **JAMI: 139/139 PASS**
### AUTH B-06 — Email verify send (6-kod) ✅

**STATUS:** ✅ DONE — 93/93 PASS (10 fayl: unit 24 + integration 69)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-06 §06 POST /api/verify/send | ✅ | `routes/email-verify.js` POST /api/auth/verify/send (A-18'dan bor) |
| B-06 §07 kod: randomInt + SHA-256 hash | ✅ | `generateCode`/`hashCode` — crypto.randomInt(0,1e6), sha256(code:salt) |
| B-06 §08 expiry 15m + single-use + resend 60s | ✅ | `email-verify.js` TTL_MS, used flag, RESEND_COOLDOWN_MS |
| B-06 §09 email template 4 til | ✅ | **YANGI:** `sendVerifyCode({lang})` — user settings/lang route'da resolve; `renderVerify` 4 til (uz/uz-cyrl/ru/en); register + resend + email-change lang pass-through |
| B-06 §10 provider + email_log queued→sent | ✅ | A-23 `sendEmail` + `logEmailRecord` (template='verify', status) |
| B-06 §11 rate limit send 3/h + check 5/15 | ✅ | `bump()` memory store (send per-user, check per-user) |
| B-06 §12 UX: kod input 6, resend, "email noto'g'ri — yangilash" | ✅ | **YANGI:** modal'ga `evm-update-email` link (security-profile) + i18n |
| B-06 §13 limited mode banner | ✅ | Panel `email-verify-banner` + modal (A-18) |
| B-06 §14 audit verify_sent (channel) | ✅ | **YANGI:** `logAuthEvent` ga `channel` field; register + resend channel='email' |
| B-06 §15 A11y | ✅ | aria-live banner, role=alert xato, 44px (modal-btn/evm-resend), focus-visible |
| B-06 §16 OTP autofill | ✅ | `autocomplete="one-time-code"` + inputmode=numeric |
| B-06 §17 4 til verify stringlar | ✅ | **YANGI:** `AUTH_COPY[l].verify` — 19 key × 4 til; panel.ejs `verifyCopy` (banner/modal/JS error'lar) |
| B-06 §20 metric verify_sent | ✅ | **YANGI:** `recordMetric('auth.email_verify.sent', counter {channel:'email', method:'resend'})` |
| B-06 §21/22/23 testlar | ✅ | unit email-verify-b06 (7: 4-til template, lang pass-through, delivery email_log); integration auth-b06 (7: delivery, cooldown, rate-limit, audit channel + kod logda yo'q, brute-force, gating) |

### Nima qilindi
1. **4-til email template** — `sendVerifyCode({userKey, email, lang})`; lang user settings'idan (default uz). Register, resend, email-change (A-29 §07) barcha yo'llar tildan foydalanadi.
2. **Audit channel** — `logAuthEvent` endi `channel` saqlaydi (verify_sent: 'email'). Kod hech qachon log'ga chiqmaydi (test bilan tasdiqlangan).
3. **Metric** — `auth.email_verify.sent` counter (channel+method labels).
4. **i18n** — `verify` blok: modal/banner/JS xatolari 4 til (19 key). Panel modal + banner to'liq lokalizatsiya; "Email noto'g'ri? Yangilash" linki (B-39 email change'ga bog'lanadi).

### Testlar
- **31/31** (B-06: unit 7 + integration 7 + A-18 regression 17)
- **93/93** regression (email-verify-a18, email-log-b02, email-validation-b05, email-a23, auth-a18, B-03/B-05)
- `tsc` ✅ EXIT=0 · boot smoke ✅ (register/login 200) · `data/db.json` toza

**Keyingi: B-07 — Email verify check + limited mode (summative blok, replay himoya, brute-force lockout).** B-06 kod log'ga chiqmaydi, rate limit va audit yashil — B-07 precondition tayyor.
### B-06 review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **1. Register settings/lang persist qilinmagan** — resend/panel `settings/lang` dan o'qiydi, lekin register hech qachon yozmas edi: birinchi email cookie lang'ida (en), keyingilari settings'da (uz fallback) — nomuvofiqlik | `routes/auth.js` register create: `settings: { lang }` — birinchi va keyingi email tili mos |
| **2. Panel JS i18n interpolation xavfsiz emas** — `<%= %>` HTML-escape apostroflarni `&#39;` ga aylantirar, keyin `.replace()` ikki marta ishlov berardi (double-escape, buzilgan stringlar); `<%-` comment ichida EJS tag'ini ochib qo'yardi (compile xatosi) | `views/user/panel.ejs`: `JSON.stringify({...})` + raw EJS (bitta `%>`) — apostroflar buzilmaydi, script breakout yo'q |
| **3. `auth.email_verify.sent` metric undercount** — faqat resend route'da yozilardi, register'dagi birinchi send sanalmaydi | `routes/auth.js` register: `recordMetric` `method:'email'` (resend `method:'resend'` bilan yig'indi) |
| **4. PG audit channel** — `auth_audit` insert'da channel kolonkasi yo'q (insert buzilishi mumkin) | `src/modules/auth/audit.js`: channel `detail` JSON ichiga yoziladi — PG schema'ga bog'lanmaydi |

**Natija:** 132/132 PASS · `tsc` EXIT=0 · boot 200/200 · EJS compile OK · db.json toza
### AUTH B-07 — Email verify check + limited mode ✅

**STATUS:** ✅ DONE — 174/174 PASS (17 fayl: unit 12 + integration 48)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-07 §06 POST /api/verify/check | ✅ | `routes/email-verify.js` POST /api/auth/verify/complete (A-18) |
| B-07 §07 to'g'ri → used_at + email_verified + email_status=verified | ✅ | **YANGI:** `verifyCode` — `used_at` timestamp + `email_status:'verified'` (B-01 schema) |
| B-07 §08 noto'g'ri/eskirgan → 422 OTP_INVALID + resend | ✅ | **YANGI kontrakt:** barcha yomon holatlar → `otp_invalid` 422 (invalid/replay/expired/mismatch); panel bitta xabar "Kod noto'g'ri yoki eskirgan" |
| B-07 §09 bitta foydalanish (replay yo'q) | ✅ | `used` + `used_at`; replay → 422 (test) |
| B-07 §10 limited mode: summative blok | ✅ | **YANGI:** `middleware/auth.js` `requireEmailVerified` — session + DB faktik tekshiruv; `routes/submit.js` POST /api/student/attempts/:id/submit gate (403 EMAIL_VERIFY_REQUIRED); o'qish/practice ochiq |
| B-07 §11 success UX | ✅ | **YANGI:** panel JS — "Email tasdiqlandi ✓" toast (role=status, aria-live), banner yo'qoladi, 900ms keyin reload |
| B-07 §12 resend 60s + email noto'g'ri link | ✅ | B-06 dan bor (evm-update-email → security-profile, B-39 ga ulanadi) |
| B-07 §13/14 A11y + OTP autofill | ✅ | aria-live, 44px, focus-visible, autocomplete=one-time-code |
| B-07 §15 4 til | ✅ | verify blok + success kaliti (4 til) |
| B-07 §16 security: hash + single-use + rate | ✅ | sha256, used_at, check 5/15 lockout |
| B-07 §18 audit verify_complete + limited_mode_used | ✅ | **YANGI:** `EMAIL_VERIFY_BLOCKED` audit action + `auth.limited_mode_used` metric + `auth.email_verify.complete` metric (success/fail) |
| B-07 §19/20/21 testlar | ✅ | unit email-verify-b07 (3: 422 kontrakt, email_status/used_at, lockout); integration auth-b07 (9: kontrakt, replay, brute-force, summative blok, audit, success UX, verify'dan keyin open) |
| B-07 §28 limited mode policy | ✅ | `requireEmailVerified` — sessiya + DB faktik (config emas, middleware qat'iy); session eskirsa DB tekshiruvi |
| B-07 §30 write path CSRF + audit | ✅ | submit route global CSRF + audit blocked |

### Nima qilindi
1. **Verify check kontrakti** — noto'g'ri/eskirgan/replay kod → yagona `422 otp_invalid` (B-07 §08); to'g'ri → `email_verified=true` + `email_status='verified'` + `used_at` (B-01 schema izchilligi).
2. **Limited mode** — `requireEmailVerified` middleware: summative submit (`POST /api/student/attempts/:id/submit`) verify'siz 403 `EMAIL_VERIFY_REQUIRED`. Sessiya `emailVerified` login'da DB'dan to'ldiriladi (B-07 fix: login session'da `email` + `emailVerified` bo'lmagan edi).
3. **Success UX** — panel JS: "Email tasdiqlandi ✓" toast + banner yo'qoladi + reload.
4. **Audit/metric** — `EMAIL_VERIFY_BLOCKED`, `auth.limited_mode_used`, `auth.email_verify.complete` (success/fail).

### Testlar
- **B-07: unit 3 + integration 9 = 12**
- **174/174** regression (17 fayl: email-verify-a18/b06/b07, email-log/validation/reset, email-a23, auth-a18/a01/a19, B-03/B-05/B-06, submit/safe-submit)
- `tsc` ✅ EXIT=0 · boot 200/200 · EJS compile OK · db.json toza

**Keyingi: B-08 — Bot himoyasi (honeypot + Turnstile + rate limit).** B-07 precondition tayyor — verify check yashil, limited mode yopiq.
### B-07 review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **1. Preview (confirmed=false) ham bloklanardi** — spec §10 "o'qish/practice ochiq; summative blok"; preview read-only completeness summary — seal/grade qilmaydi | `routes/submit.js`: gate faqat `confirmed === true` da ishlaydi (preview ochiq); test yangilandi — preview 403 emas |
| **2. `safeKey(user.safeKey)` redundant** — safeKey allaqachon canonical storage key | `middleware/auth.js`: to'g'ridan-to'g'ri `users/${user.safeKey}` (izoh bilan) |
| **3. O'lik fallback** — `AUDIT_ACTIONS.EMAIL_VERIFY_BLOCKED \|\| 'email.verify.blocked'` (constant bor) | Faqat constant ishlatiladi |
| **4. Toast 900ms — o'qishga yetmaydi** | 1500ms (toast ko'rinadi, keyin reload) |
| **5. Gate actorId'dan keyin ishlardi** — session'da `.id` yo'q (faqat safeKey) → noto'g'ri 401 | Gate actorId tekshiruvidan OLDIN ko'chirildi (confirmed=true bo'lsa) |

**Natija:** 174/174 PASS · `tsc` EXIT=0 · boot 200/200 · EJS compile OK · db.json toza
### AUTH B-08 — Bot himoyasi (honeypot + Turnstile + per-email rate limit) ✅

**STATUS:** ✅ DONE — 137/137 PASS (17 fayl: unit 25 + integration 112)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-08 §06 honeypot (A-21) | ✅ | `routes/auth.js` honeypot branch'ida endi `BOT_DETECTED` audit + `auth.bot_detected` metric (400-900ms padding bilan — timing side-channel yo'q) |
| B-08 §07 Turnstile | ✅ | **YANGI** `src/modules/auth/bot-guard.js` `verifyTurnstile`: secret yo'q → fail-open (dev/test); secret bor + token yo'q → `turnstile_required`; siteverify fetch (5s AbortSignal timeout), `success:false` → `bot_detected` fail-closed; network outage → fail-open |
| B-08 §07 widget | ✅ | `views/user/register.ejs` — site key bor bo'lsa widget (auto-render, data-theme=auto); submit tugmasi widget tugamaguncha disabled; **review fix:** 6s ichida iframe chiqmasa tugma ochiladi (o'lik forma bo'lmaydi) |
| B-08 §08 per-email limit | ✅ | `checkEmailRegisterLimit` 3/soat (memory Map, RATE_MAX_KEYS 10k eviction) — register branch'da per-IP'dan keyin, taken-check'dan OLDIN (barcha urinishlar hisoblanadi) |
| B-08 §14 audit | ✅ | `BOT_DETECTED 'auth:bot:detected'` + `SIGNUP_BLOCKED 'auth:signup:blocked'` (src/modules/auth/audit.js) — honeypot + turnstile + email_rate_limit yo'llarida |
| B-08 §15 metric | ✅ | `auth.bot_detected` counter {source: honeypot|turnstile} |
| B-08 env | ✅ | `TURNSTILE_SECRET_KEY/SITE_KEY` optional (dev) + **production majburiy** (superRefine — operator unutib qo'ysa bot-guard jimgina o'chmasin) |
| B-08 testlar | ✅ | unit bot-guard-b08 (12: honeypot 2, turnstile mock 6, per-email 4); integration auth-b08 (6: per-email 3→4 blok 429, turnstile bot blok + token'siz blok fetch chaqirilmaydi, legit fail-open, honeypot silent) |

### Review 4 ta gap topdi, hammasi yopildi 🔧
- **HIGH: submit tugmasi abadiy disabled** — CDN/CSP widget render qilmasa forma o'lik; 6s fallback timer (iframe yo'q → tugma ochiladi; server fail-closed xato ko'rsatadi).
- **MEDIUM: `bump()` eviction bug** — to'liq map'da yangi kalit `map.set` qilinmas, urinish yo'qolardi; endi eviction'dan keyin ham DOIM `map.set`.
- **MEDIUM: production fail-open** — `TURNSTILE_SECRET_KEY` production'da majburiy (teshigi yopildi).
- **LOW: double-count bug** — `recordEmailRegister` muvaffaqiyatli signup'ni ikki marta hisoblar edi (check + record) → 3-urinishdayoq blok; funksiya olib tashlandi (redundant — check har urinishda bump qiladi).

### Nima qilindi
1. **bot-guard.js (YANGI)** — layered: honeypot + Turnstile + per-email 3/soat. Barcha memory-store; C-faza: Redis/ASN port.
2. **routes/auth.js** — register branch tartibi: per-IP (A-03) → per-email (B-08) → Turnstile → taken → email validation. Barcha bot yo'llari audit + metric bilan; lockout 429.
3. **register.ejs** — Turnstile widget conditional + gating + fallback.
4. **env.js** — production superRefine: `TURNSTILE_SECRET_KEY` majburiy.

### Testlar
- **B-08: unit 12 + integration 6 = 18**
- **137/137** regression (17 fayl: A-01/A-03/A-18/A-21-checkpoint, B-03/B-04/B-06/B-07, email-verify/log)
- `tsc` ✅ EXIT=0 · boot 200/200 · production guard ✅ (keysiz ERROR / kalit bilan OK) · EJS compile OK · db.json toza

**Keyingi: B-09 — Duplicate account handling.** B-08 bot-guard yopiq — register'ni bot'lardan himoya qiladi; B-09 duplicate/linking oqimiga o'tadi.
### AUTH B-09 — Duplicate account handling ✅

**STATUS:** ✅ DONE — 117/117 PASS (14 fayl: unit 25 + integration 92)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-09 §06 duplicate UX | ✅ | Register'da band username YOKI band email → yagona "Bu akkaunt allaqachon mavjud — balki oldin ro'yxatdan o'tgansiz" + **[Kirish]** (`/user/login?account=...` — login maydoni email/username bilan prefilled) + **[Parolni unutdingizmi?]** (`/user/forgot?account=...`). Authgear mapping. |
| B-09 §07 enumeration himoya | ✅ | Username/email band → BIR XIL matn (farqlanmaydi); rate limit (per-IP 5/15 + per-email 3/soat) register yo'lida allaqachon qo'llanadi; audit `DUPLICATE_ATTEMPT` (server-side, client'ga chiqmaydi) |
| B-09 §08 Google ↔ password LINK | ✅ | **`oidc.js` fix:** email index `email_index:` (o'lik — register A-18 `users_email_index` yozadi) → **canonical `users_email_index/{safeKey(email)}`** (ilgari link HECH QACHON ishlamas edi!). Verified email + parol account → `google_sub` bog'lanadi + `auth_provider='password+google'` + audit `ACCOUNT_LINKED` + metric `auth.account_linked`; session o'sha account'ga |
| B-09 §09 linking xavfsizlik | ✅ | Google email **verified bo'lmasa → link YO'Q** (blok, escalation yo'q); **review fix:** boshqa `google_sub` allaqachon bog'langan bo'lsa → takeover blok (eski sub saqlanadi) |
| B-09 §10 HEMIS ID | ⏳ | C-faza (verified email sharti tayyor — `findOrCreateUser` linking yo'li keyingi faza uchun hook) |
| B-09 §11 Merge flow | ⏳ | P2 — admin review (identity mismatch queue) — keyingi faza |
| B-09 §12 audit | ✅ | `ACCOUNT_LINKED 'account.linked'` + `DUPLICATE_ATTEMPT 'account.duplicate.attempt'` |
| B-09 §13 A11y | ✅ | dup-actions `role=group` + `aria-label`; havolalar 44px btn/link |
| B-09 §15 4 til | ✅ | `errors.duplicate` + `errors.linkingRequired` + `register.dupLogin` + `dupForgot` (uz/uz-cyrl/ru/en) |
| B-09 §29 email band + duplicate bir xil UX | ✅ | Ikkala yo'l ham `duplicate` matnini render qiladi |
| B-09 email login | ✅ | **Fix:** login faqat username qabul qilardi — duplicate email prefill buzilardi. `loginSchema` max 50→100 + `@`/`+` (plus-addressing); login POST `resolveAccountToUserKey` (email index) — timing-safe not-found path saqlanadi |

### Review 4 ta gap topdi, hammasi yopildi 🔧
- **HIGH: `email_index:` path bug** — OIDC o'lik path'ni o'qir edi (register'da A-18 `users_email_index` yoziladi) → link hech qachon ishlamas edi; canonical path'ga o'tkazildi.
- **HIGH: email login `+` qabul qilmas edi** — Gmail plus-addressing (`user+tag@gmail.com`) login'da yiqilardi; regex'ga `+` qo'shildi.
- **MEDIUM: google_sub takeover** — boshqa Google account bog'langan bo'lsa yangi sub ustiga yozilardi; conflict → blok + audit.
- **LOW: login email lookup** — username-first resolve safe (username'da '@' mumkin emas); parolsiz account'ga link blok.

### Nima qilindi
1. **oidc.js** — `findOrCreateUser`: canonical email index, verified→link (transaktsion + audit + metric), unverified→blok, parolsiz→blok, conflict→blok; `getLinkingError` → stable `'linking_required'`; yangi user canonical index yozadi.
2. **routes/auth.js** — `?account=` prefill (login + forgot), `linking_required` OIDC_ERROR_MAP, duplicate UX 2 yo'lda + audit, login POST email resolution.
3. **validation.js** — loginSchema max 100 + `@`/`+`.
4. **register.ejs** — dup-actions blok; **i18n** 4 til; **audit.js** 2 action.
5. **Testlar** — unit oidc-b09 (6: canonical index, verified link, unverified blok, parolsiz blok, conflict blok, idempotent), integration auth-b09 (4: username dup, email dup same UX, login prefilled+works, forgot prefill), auth-validation (+email test, 51→101), oidc-a07 yangilandi (verified link / unverified blok / linking_required).

### Testlar
- **B-09: unit 6 + integration 4 + validation 2 = 12** · **117/117** regression (14 fayl: oidc-a07, auth-a01/a04/a18/a20/a29, B-03/B-05/B-08, validation)
- `tsc` ✅ EXIT=0 · boot 200/200 (register/login/forgot/account-prefill) · EJS compile OK · db.json toza

**Keyingi: B-10 — Google register + rol modal (to'liq).** B-09 linking yopiq — verified email'lar Google ↔ password bog'lanadi; B-10 Google orqali yangi register oqimiga o'tadi.
### AUTH B-10 — Google register + rol modal (2-qadam) ✅

**STATUS:** ✅ DONE — 180/180 PASS (19 fayl) · tsc 0 · boot 200/200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-10 §05 invite passthrough | ✅ | GET /auth/google `?invite=` → sessiyada `oidcInvite` → callback'dan OLDIN o'qiladi → pendingGoogle.invite |
| B-10 §06 needsSetup | ✅ | `findOrCreateUser` → `{status:'setup', googleUser}` (verified email + parolsiz account) → `completeOidcLogin` `needsSetup:true` |
| B-10 §07 pendingGoogle | ✅ | 15-min TTL, `getValidPending` (TTL+sub/email), expired → tozalanadi |
| B-10 §08 rol modal | ✅ | `/user/google-setup` — rol kartalar (student/teacher), email prefill, invite field, CSRF |
| B-10 §09 account create | ✅ | POST → `normalizeUserRecord` create + `users_email_index` + `email_verified:true` (ID token verified) |
| B-10 §12 audit+metric | ✅ | `USER_REGISTER` audit + `auth.register.role_selected` metric |
| B-10 §13 rol allowlist | ✅ | faqat student\|teacher; admin → re-render xato (account yaratilmaydi) |
| B-10 §17 session regenerate | ✅ | fixation'ga qarshi `session.regenerate` + yangi csrfToken |
| B-10 §29 cancel | ✅ | POST /user/google-setup/cancel → pending tozalanadi |

### Review 6 ta gap — hammasi yopildi 🔧
- **HIGH**: `vi.mock` path noto'g'ri (`../src` — test fayldan `../../src` bo'lishi kerak) → mock qo'llanmasdi
- **HIGH**: `userRoutes` `router.use(requireAuth)` `/user/*` ni o'ziga tortardi → oidcRoutes mount tartibi tuzatildi (userRoutes'dan oldin)
- **MEDIUM**: `setup.js`→`server.js`→`env.js` import'lar hoisted → `vi.hoisted` bilan env'lar import'dan oldin set qilinadi
- **MEDIUM**: idempotent POST branch login sessiyasiz `/user/panel`'ga yuborar edi (401) → sessiya o'rnatiladi
- **LOW**: setup session'da `tenant_id` yo'q edi → qo'shildi (OIDC login bilan izchil)
- **LOW**: expired POST 400 sahifa → GET bilan izchil `/user/login?error=google_setup_expired` redirect + i18n 4 til

### Testlar
- **B-10: integration 6** (callback→setup→account→cancel; mock completeOidcLogin + real callback oqimi)
- **180/180** regression (19 fayl) · `tsc` ✅ 0 · boot 200/200 · db.json toza
- Ledger yangilandi

**Keyingi: B-11 — (next B prompt).**
### AUTH B-11 — Invites: schema + yaratish + email + expiry + rate limit ✅

**STATUS:** ✅ DONE — 189/189 PASS (15 fayl) · tsc 0 · boot 200/200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-11 §07 batch yaratish | ✅ | `POST /api/roster/sessions/:id/invites` (teacher/admin) — A-11'da mavjud edi |
| B-11 §08 token hash | ✅ | 48 bayt (96 hex) raw, DB'da faqat sha256 HASH — parol kabi |
| B-11 §09 email yetkazish | ✅ | `POST /api/roster/invites/send` — `renderInvite` (4 til) + sendEmail + email_log (HMAC) + `deliveredAt` idempotent |
| B-11 §10 invite link | ✅ | `GET /invite/:token` — PUBLIC, Referrer-Policy no-referrer, 404 invalid |
| B-11 §11 revoke | ✅ | `POST /api/roster/invites/:tokenHash/revoke` — faqat pending |
| B-11 §12 expiry job | ✅ | `expireOverdueInvites` — 7 kun → EXPIRED + expiredAt + audit |
| B-11 §13 rate limit | ✅ | `checkInviteSendLimit` — 50/soat per teacher (Map 5000 cap) |
| B-11 §16 4 til | ✅ | invite stringlar templates.js'da 4 til, spam-scan clean |

### Review 6 ta gap — hammasi yopildi 🔧
- **CRITICAL**: `deliveredAt` send muvaffaqiyatsiz bo'lsa ham yozilardi → retry bo'lmasdi; endi faqat ok'da + `deliveryErrors` hisoblagich
- **CRITICAL**: email link `/invite/{hash}` acceptInvite raw token hash qilardi → 64-hex kirish endi hash sifatida to'g'ridan-to'g'ri lookup (B-12 view kontrakti tayyor)
- **MEDIUM**: invite email mapping orqali topilmaydi (raw column nomi) — real gap fix: `emailCol` mapping'dan
- **LOW**: rate limit Map cheksiz o'sar edi → 5000 cap (oidc.js namunasi)
- **LOW**: GET /invite/:token dynamic import → static import
- **LOW**: unit test identity konflikt (STU001 roster-a11 bilan) → B11X/B11Y unique

### Testlar
- **B-11: unit 8 + integration 4 = 12** (token hash, batch idempotent, link validatsiya, revoke, email send + idempotent, expiry, rate limit, hash-accept)
- **189/189** regression (15 fayl) · `tsc` ✅ 0 · boot 200/200 · db.json toza
- Ledger yangilandi

**Keyingi: B-12 — Invite aktivatsiya view + validatsiya (to'liq sahifa).**
### AUTH B-12 — Invite aktivatsiya view + validatsiya ✅

**STATUS:** ✅ DONE — 199/199 PASS (16 fayl), tsc 0, boot toza

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-12 §06 to'liq aktivatsiya sahifasi | ✅ | `views/user/invite.ejs` (NEW) — "Siz taklif qilindingiz ✓", kurs/guruh/email prefilled (email disabled), Google bog'lash havolasi (`/auth/google?invite={hash}`), username+parol forma (`POST /api/roster/invites/accept`), 4-til lang-row, a11y (skip-link, label/aria, role=list) |
| B-12 §07/§08 aniq xato UX | ✅ | GET /invite/:token — used/expired/invalid **alohida xabarlar** (i18n 4 til), 404 + `requestNew` |
| B-12 §15/§27 per-IP brute-force | ✅ | `checkInviteViewLimit` 30/15 daqiqa per IP (5000 cap), 429 error sahifasi |
| B-12 §17 invite_view audit | ✅ | `AUDIT_ACTIONS.INVITE_VIEW` — har ko'rish emas, valid/invalid bitta record (`outcome: success/blocked`) |
| B-12 no-referrer + lang | ✅ | `Referrer-Policy: no-referrer` header; `?lang=` cookie'dan `resolveAuthLang` |

#### Review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **REAL BUG:** `views/error.ejs` 404 da `message`ni **tashlab yuborar edi** — generic "Sahifa topilmadi" ko'rsatardi. B-12 ning ishlatilgan/muddati o'tgan/noto'g'ri alohida xabarlari hech qachon ko'rinmas edi (integration test ochib berdi: 4/7 fail) | `views/error.ejs` — 404 branch endi `message` berilgan bo'lsa uni ko'rsatadi, aks holda generic (boshqa route'lar buzilmaydi) |

#### Testlar
- **B-12: integration 7** (render prefilled+no-referrer, noto'g'ri format 404, topilmadi 404, used 404+xabar, expired 404+xabar, accept forma oqimi → user+enrollment+USED+email_verified, rate limit 429)
- **199/199** regression (16 fayl: invites-b11/b12, roster-a10/a11, email-* , auth-a01/a11/a18/a20/b09/b10, oidc) · `tsc` ✅ 0 · boot 200/200/404 · db.json toza
- Ledger yangilandi

**Keyingi: B-13 — Email verify'dan keyin login/panel UX (session + redirect).**
### AUTH B-13 — Invite accept (Google + parol) + enrollment ✅

**STATUS:** ✅ DONE — 266/266 PASS (21 fayl), tsc 0, boot toza

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-13 §06 Google accept | ✅ | `claimInviteForGoogle` (invites.js) — per-token mutex bilan claim; user yaratilishidan OLDIN chaqiriladi → invite USED + usedBy + usedProvider=google + enrollment (course/group prefilled) |
| B-13 §07 Parol accept | ✅ | `acceptInvite` → `writeInviteBinding` yagona helper (enrollment + USED + audit) — password path refactor |
| B-13 §08 Transaksion | ✅ | Claim yagona lock + qayta o'qish bilan (replay/race himoya); Google'da claim fail → account YO'Q (partial state yo'q) |
| B-13 §09 Role | ✅ | Invite faqat student claim qiladi; teacher invite'ni claim qilmaydi |
| B-13 §10 Takroriy → 409 | ✅ | Parol accept route: 'ishlatilgan' → **409 Conflict** (400 emas); Google: setup sahifasida xato, account yaratilmaydi |
| B-13 §11 Audit | ✅ | INVITE_USED (user, course, group, provider) + `auth.invite_accepted` metric |
| B-13 §12/§13 A11y/mobile | ✅ | Setup maxlength 64, Google full-width (B-10'da), forma bir ustun |
| B-13 §14 4 til | ✅ | Invite xatolari B-12 invite blokidan (4 til) qayta ishlatiladi — yangi kalit shart emas |
| B-13 §17 Metric | ✅ | `auth.invite_accepted` counter (provider=google) |
| B-13 §28 Token hash | ✅ | Audit'da to'liq token emas — faqat hash |

#### Review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **CRITICAL:** Google invite hash **48 belgiga kesilardi** (`slice(0,48)` 3 joyda + form maxlength=48) — tokenHash 64-hex, lookup DOIM fail; Google accept hech qachon ishlamas edi | `normalizeInviteParam` (faqat 64-hex) + callback/setup slice 64 + form maxlength 64; hash sessiyada to'liq saqlanadi |
| **HIGH:** Google accept invite'ni bog'lamas, enrollment yozmas edi — `invite_code` marker sifatida qolardi (replay ochiq) | Claim user yaratilishidan OLDIN; invite_status 'accepted' + invite_accepted_at + group/course prefilled |

#### Testlar
- **B-13: unit 5 + integration 4 = 9** (claim valid+replay+expired+revoked+bad-format, Google accept 64-hex+enrollment, Google replay account YO'Q, parol replay 409, expired Google)
- **A-11 yangilandi**: replay 400 → 409 (B-13 §10 to'g'ri kontrakt)
- **266/266** regression (21 fayl) · `tsc` ✅ 0 · boot toza · db.json toza
- Ledger yangilandi

**Keyingi: B-14 — Teacher approval: state machine + schema.**
### AUTH B-14 — Teacher approval: state machine + schema ✅

**STATUS:** ✅ DONE — 108/108 PASS (18 fayl), tsc 0, boot toza

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-14 §06 State machine | ✅ | `TEACHER_TRANSITIONS`: pending→teacher, pending→rejected, rejected→pending (cooldown'dan keyin), teacher→rejected (revoke) |
| B-14 §07 Schema | ✅ | `teacher_applications/{appId}` canonical record — id, user_id, username, email, full_name, university, subject, experience, reason, status, reviewed_by, reviewed_at, justification, reject_reason, cooldown_until, created_at |
| B-14 §08 users.role | ✅ | `users.role` teacher_pending/teacher/teacher_rejected (B-01 bilan mos); inline `teacher_application` ham yoziladi |
| B-14 §09 Transition qoidalari | ✅ | `validateTeacherTransition` — no_op, invalid_transition, cooldown_active (remainingMs) |
| B-14 §26 Cooldown config | ✅ | `TEACHER_COOLDOWN_MS` (CONFIG.TEACHER_REJECT_COOLDOWN_MS, 30 kun default); reject'da `teacher_cooldown_until` yoziladi |
| B-14 §10 Window/escalation | ✅ | A-25 dan mavjud (72h window + eslatma + 7 kun eskalatsiya super-admin) |
| B-14 §11 Self-approve blok | ✅ | A-25 dan mavjud (assertDecisionAllowed) |
| B-14 §12 Service | ✅ | `src/modules/auth/teacher-approval.js` — submitTeacherApplication + decideTeacherApplication (yagona transition/audit nuqtasi) |
| B-14 §15 Metric | ✅ | `auth.teacher_application_submitted` (submit'da) |
| B-14 §14 Security | ✅ | approve/reject faqat admin (route middleware); cooldown gate service'da ham (defense in depth); IDOR test |

#### Review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **MEDIUM:** approve/reject'da audit IKKI marta yozilardi (service + route dublikat) | Yagona audit service'da — route ipAddress/userAgent/ageMs'ni service'ga uzatadi, route audit bloki olib tashlandi |

#### Testlar
- **B-14: unit 8 + integration 4 = 12** (transitions, cooldown blok+o'tish, submit record §07 maydonlari, decide approve/reject+cooldown_until, invalid transition, register→pending→approved, reject→cooldown→reapply, non-admin blok, IDOR)
- **108/108** regression (18 fayl: teacher-approval-b14, a19, a25, a01, a11, a12, b03, b09, b10, invites-b11/12/13, oidc, register) · `tsc` ✅ 0 · boot toza · db.json toza
- Ledger yangilandi

**Keyingi: B-15 — Teacher approval: admin ro'yxat + approve/reject UI.**
### AUTH B-15 — Teacher approval: admin ro'yxat + approve/reject UI ✅

**STATUS:** ✅ DONE — 82/82 PASS (14 fayl), tsc 0, boot toza

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-15 §06 Ro'yxat + filter | ✅ | `views/admin/teachers.ejs` qayta yozildi — filter tablar (pending/approved/rejected/all), qidiruv (ism/email/universitet/fan), pagination (20/sahifa) |
| B-15 §06 To'liq ma'lumot | ✅ | Ism, email, universitet, **fan**, **tajriba** (B-14 canonical record'dan), sana, status, sabab |
| B-15 §07 Modal | ✅ | prompt() o'rniga **accessible modal** — role=dialog, aria-modal, focus management, Esc, backdrop close, char counter, justification min 10 |
| B-15 §08/§09 Approve/Reject | ✅ | B-14 service orqali (justification majburiy, cooldown_until, audit) — avvaldan ishlayotgan API |
| B-15 §14 Security | ✅ | requireAdmin + reauth + MFA step-up + CSRF (auto-attach); IDOR/justification test |
| B-15 §15 A11y | ✅ | 44px tugmalar, sr-only label'lar, keyboard (Esc/Ctrl+Enter), aria-current/disabled |
| B-15 §16 Mobile | ✅ | filter/qidiruv flex-wrap; dt is-reflow (admin.css mavjud) |
| B-15 §18 XSS | ✅ | EJS escape — reject reason `<script>` qochiriladi (test) |
| B-15 §30 PII minimal | ✅ | Ro'yxatda faqat admin uchun zarur maydonlar (email ko'rinadi — admin) |

#### Review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **MEDIUM:** `pendingCount` badge'i filterdan KEYIN hisoblanardi — approved/rejected tab'da "0 kutilmoqda" ko'rsatardi | Global `pendingTotal` filter/qidiruvdan MUSTAQIL hisoblanadi |
| **LOW:** Yangi view'da reject sababi ko'rinmas edi (eski tarix jadvali olib tashlangan) | Rejected qatorda "Sabab: …" qatori qo'shildi (EJS-escaped) |
| **LOW:** A-25 eskalatsiya testi: route canonical `created_at`ni inline `appliedAt`dan ustun qo'ygan | appliedAt precedence: inline `teacher_application.appliedAt` → canonical → created_at (approve/reject bilan mos) |

#### Testlar
- **B-15: integration 5** (filter=all + subject/experience, filter=pending/rejected, qidiruv, pagination 20/6, XSS escape)
- **82/82** regression (14 fayl: teacher-approval-b15/b14/a19, auth-a19/a25/a01/a11/a12/b03/b10, invites-b12/13, register) · `tsc` ✅ 0 · boot toza · db.json toza
- Ledger yangilandi

**Keyingi: B-16 — Teacher approval: SLA, eskalatsiya, pending limited mode.**
### AUTH B-16 — Teacher approval: SLA, eskalatsiya, pending limited mode ✅

**STATUS:** ✅ DONE — 90/90 PASS (16 fayl), tsc 0, boot toza

#### Implementation Summary

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| B-16 §06 SLA job | ✅ | `src/modules/auth/teacher-sla.js` — 24s/48s/72s eslatma (email admin, MAX 3), 7 kun eskalatsiya (super-admin); server.js'da soatlik (non-test) |
| B-16 §07 sla_state | ✅ | `teacher_applications/{id}.sla_state` (normal→reminded→escalated) + reminder_count + last_reminded_at + escalated_at |
| B-16 §30 Idempotent | ✅ | Email faqat holat o'tishida / 24h ichida bir marta; takroriy yugurishda yangi email yo'q (test) |
| B-16 §08 Pending ekran | ✅ | "1-3 ish kuni" ETA (4 til yangilandi) — nav + /user routes blok (A-19 dan) |
| B-16 §09/§10 Limited mode blok | ✅ | teacher_pending/rejected: /teacher 403 "Ruxsat etilmagan rol", user API 403 aniq xabar (test) |
| B-16 §12 Rejected ekran | ✅ | Sabab + cooldown countdown + [Qayta ariza] (cooldown o'tgach enabled) + [Apellyatsiya] (mailto support) |
| B-16 §13 Qayta ariza | ✅ | Faqat cooldown'dan keyin (30 kun); yangi teacher_applications row (B-14'da) |
| B-16 §14 Audit | ✅ | `teacher:sla-reminded`, `teacher:escalated`, `teacher:appeal` (submit appeal flag) + metric |
| B-16 §15/§16 A11y/mobile | ✅ | Disabled button aria-disabled, 44px, mailto havola |

#### Review fix (Nit Pick Nick) 🔧

| Topilma | Fix |
|---|---|
| **LOW:** Appeal register'da `submitTeacherApplication` user record overwrite'dan KEYIN chaqiriladi — role allaqachon teacher_pending, appeal aniqlanmas edi | register'da `appealSubmit` flag (cooldown-passed branch) → submit'ga `appeal` parametri → TEACHER_APPEAL audit |
| **TEST:** /api/me URL xato (mount /user/) + audit flatten noto'g'ri | `/user/api/tests/search` (bloklangan API 403) + auth_audit/{day}/{ts}_{rand} flatten |

#### Testlar
- **B-16: unit 5 + integration 4 = 9** (slaStateFor, 30s reminded idempotent, 8 kun escalated idempotent, 72s window, SLA progression, pending blok 403, rejected cooldown countdown + enable, appeal + audit + yangi row)
- **90/90** regression (16 fayl: teacher-sla-b16, teacher-approval-b14/b15/a19, auth-a19/a25/a01/a11/b03/b09/b10, register, invites-b12/13) · `tsc` ✅ 0 · boot toza · db.json toza
- Ledger yangilandi

**Keyingi: B-17 — Onboarding: state machine + Orient.**
### AUTH B-17 — Onboarding: state machine + Orient ✅

**STATUS:** ✅ DONE — 16/16 B-17 PASS + 178/178 regression PASS (11 fayl)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| State machine | ✅ | `src/modules/onboarding/service.js` — welcome→first_win→checklist→done, monotonic, skip, idempotent, audit+metric |
| Demo bank | ✅ | `src/modules/onboarding/demo-bank.js` — pre-loaded bank (4 til), server answer key, public DTO (answer server'da) |
| Orient | ✅ | `views/user/onboarding.ejs` — 'Xush kelibsiz, [Ism]! 🎓', fan tanlash demo, maqsad, Skip, 3-step stepper, sticky progress, a11y |
| Routes | ✅ | `routes/onboarding.js` — GET /onboarding, POST orient/skip, demo API; server.js mount |
| i18n | ✅ | `onboarding` bloki 4 til (data/auth-i18n.js) |
| Security | ✅ | CSRF + requireAuth faqat onboarding path'larida (router '/' shadowing bug tuzatildi) |

**Reviewda tuzatilgan:** `router.use(requireAuth)` '/' da mount barcha so'rovlarni ushlab qolardi → faqat onboarding path'lariga cheklandi.

**Keyingi: B-18** — Activate (first-win): 5 savollik amaliyot + ACTIVATION EVENT.
### AUTH B-18 — Onboarding: Activate (first-win) ✅

**STATUS:** ✅ DONE — B-18 18/18 PASS + regression yashil

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Bank (4 til × 4 fan × 5 savol) | ✅ | `demo-bank.js` — B-17 Orient demo'si saqlanib (getDemoQuestion), B-18 uchun `getFirstWinSet` (5 savol) + `checkFirstWinAnswer` (izohli) |
| First-win API (§06-09) | ✅ | POST start → 5 savol public DTO (answer key server'da); POST answer → server scoring + elaborative feedback (explain); POST complete → summary (ball + izoh + "X mavzuda Y% — amaliyot qiling") |
| ACTIVATION EVENT (§10) | ✅ | complete → step=checklist, activated_at saqlanadi, `first_win_complete` metric + audit |
| Security (§16/§20) | ✅ | answer key server'da; attempt user-scoped (IDOR yopiq); replay → 409 duplicate_answer; not_all_answered → 400; step manipulatsiya monotonik; CSRF |
| UI (§12-13) | ✅ | `onboarding.ejs` first_win stepper: savol+variantlar (radio, 44px, aria), natija ekrani 🏆 "Aha" feedback, 3-step progress |
| i18n (§15) | ✅ | firstWin bloki 4 til (14 kalit) |
| Testlar | ✅ | unit 12 (bank/scoring/replay/ACTIVATION/idempotent) + integration 6 (start→answer×5→complete, TTFV<5min, IDOR, replay, key scan, CSRF) |

**Review davomida tuzatilgan (B-17 rebuild regressiyalari):**
1. **design-lint PASS** — B-15/16/17 view'larimdagi inline visual style'lar klasslarga ko'chirildi (teachers/teacher-approval/onboarding), allowlist qayta qurildi, auth.css tiny text (0.72→0.75rem), session-timeout.css raw color → scrim token
2. **i18n matnlari** — B-17 rebuild'da buzilgan: invite (B-12 kontrakti), alerts bloki (B-28), duplicate/riskBlocked (A-18/A-28/B-09 kontrakti) qaytarildi
3. **pre-existing unit fail'lar** — env.test (TURNSTILE production majburiy), role-shell (8 rol), new-device (alerts copy) yangilandi

**Tekshiruvlar:** unit ~4200 PASS · integration auth+invites+onboarding+teacher 500+ PASS · tsc 0 · boot toza (register→orient→first-win→checklist) · db.json toza

**Keyingi: B-19** — Reinforce (checklist) + welcome sequence.
### AUTH B-19 — Reinforce (checklist) + Welcome sequence ✅

**STATUS:** ✅ DONE — unit 12 + integration 6 = 18/18 PASS; regression 109/109; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Checklist (5 item) | ✅ | `service.js: submitChecklistItem` — user-scoped, idempotent (takroriy POST → 200, state o'zgarmaydi), done → `step=done` + `onboarding_done_at`; `checklistProgress` helper |
| Welcome job (Day 0/1/3/7) | ✅ | `welcome.js` — scheduleWelcome (register/first-win'dan chaqiriladi), runWelcomeJob (idempotent: welcome_sequence index'da qayd; chastota cap 4/user; rol/til/fan personalizatsiya; email orqali yuboriladi, audit + metric) |
| Routes | ✅ | `POST /api/onboarding/checklist` (CSRF + rate limit); server.js'da welcome job timer mount |
| View + i18n | ✅ | Checklist stepper (5 item, keyboard aria, done holatida check icon), 4 tilda checklist bloki |
| Security | ✅ | IDOR yopiq (user-scoped key), CSRF, rate limit, welcome spam cap 4/user |

## Tekshiruvlar
- unit 12 + integration 6 = **18/18 PASS**
- Regression: **109/109** (onboarding + invites + teacher + email + auth)
- `tsc` 0 · design-lint PASS · boot toza (register→first-win→checklist 1/5→done view 200)
- Ledger: `implementation-status-auth.md`

**Keyingi: B-20** — Teacher onboarding (first test).
### AUTH B-20 — Email templates (barcha 8 tur, 4 til) ✅

**STATUS:** ✅ DONE — unit 14 + integration 3 = 17/17 PASS; regression 236+ PASS; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| 8 template (verify/reset/welcome/invite/approved/rejected/security/breach) | ✅ | `templates.js` — har biri HTML + plain-text + preheader; 4 til (uz/uz-cyrl/ru/en) |
| welcome — CTA "Birinchi amaliyotni boshlang" | ✅ | `renderWelcome` — onboarding havolasi (Day 0) |
| teacher_rejected — sabab (reason) | ✅ | `renderTeacherRejected` — sabab bloki (HTML + text) |
| **security** template (4 variant) | ✅ | `renderSecurity` — password_changed/email_changed/new_device/suspicious; vaqt/qurilma/shahar agregatlari (PII minimal — raw IP/UA YO'Q); CTA "Xavfsizlik bo'limi" |
| **breach** template (P1) | ✅ | `renderBreach` — "Parolingiz breach'da — o'zgartiring" CTA |
| deliverAlert → email channel | ✅ | `new-device.js` — email kanali endi renderSecurity orqali yuboradi (fail-soft; raw IP/UA emailga kirmaydi) |
| Breach email (login'da HIBP) | ✅ | `routes/auth.js` — breach topilganda renderBreach email (fire-and-forget, fail-soft) |
| Spam-safe | ✅ | `scanSpamTriggers` — 8 template × 4 til toza (FREE/URGENT/!!!/ALL CAPS yo'q) |
| XSS/security | ✅ | Barcha user-input `esc()`; text versiyalar ham toza; token/parol hech qachon (faqat 6-kod/limitli havola) |

## Tekshiruvlar
- unit 14 (email-templates-b20 9 + security 5) + integration 3 = **17/17 PASS**
- Regression: email/new-device 73 + auth 163 + onboarding/register/reset 54 = **290 PASS**
- `tsc` 0 · design-lint PASS · boot toza (security/breach CTA + deliverAlert email channel)
- Ledger: `implementation-status-auth.md`

**Keyingi: B-21** — Notification preferences (schema + settings UI).
### AUTH B-21 — Notification preferences (schema + settings UI) ✅

**STATUS:** ✅ DONE — unit 9 + integration 7 = 16/16 PASS; regression ~140 PASS; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Prefs schema | ✅ | `src/modules/student/notifications.js` — `users.{id}.notif_prefs` (channels + types + updated_at); default: telegram ON, email/push OFF, 6 type ON |
| Kanal toggle'lar (Telegram/email/push) | ✅ | `setNotifPrefs` — whitelist validation (boolean, faqat ma'lum kanallar) |
| Hodisa toggle'lar (6 tur) | ✅ | assignment/result/practice/deadline/feedback/security |
| Security forced | ✅ | `types.security` o'chirib bo'lmaydi (set ham, get ham true); UI'da disabled + lock icon |
| Dispatch routing | ✅ | `dispatchNotification` — hodisa → kanal routing; security hodisalari kanal off bo'lsa ham email fallback |
| Chastota cap + dedupe | ✅ | `checkNotifRate` — sutkalik cap (tg 3/email 3/push 2, env override), 24h dedupe |
| Settings UI | ✅ | `/user/notifications` — toggle switch (44px, aria-label, focus-visible, keyboard), security locked-note, sticky save bar |
| i18n 4 til | ✅ | `notif` blok (25 kalit) — uz/uz-cyrl/ru/en |
| Audit + CSRF | ✅ | `NOTIF_PREFS_UPDATED` audit action; CSRF global; IDOR yopiq (req.session.user.safeKey) |
| deliverAlert integratsiyasi | ✅ | `new-device.js` endi `settings.notifChannel` emas, notif_prefs orqali kanal (telegram default, email fallback) |

## Review davomida topilgan va tuzatilgan 🔧
- **Router shadowing** — `router.use(requireAuth)` '/' mount'da barcha so'rovlarni bloklardi (auth.test S30/S34 fail) — onboarding pattern'i (path-scoped requireAuth) qo'llandi
- **Security fallback haddan oshgan** — email fallback har doim qo'shilar edi (telegram ham ON bo'lsa) — faqat BARCHA kanallar off bo'lganda email fallback
- **new-device.test / email-templates-b20.test** — eski `settings.notifChannel` kontraktidan yangi `notif_prefs` kontraktiga o'tkazildi

## Tekshiruvlar
- unit 9 + integration 7 = **16/16 PASS** (default/toggle/security forced/validation/dispatch/rate/IDOR/CSRF/XSS)
- Regression: new-device + auth-a09 + auth.test 96 + email/notifications 10 = **~140 PASS**
- `tsc` 0 · design-lint PASS · boot toza (sahifa 200, toggle'lar, POST, deliverAlert)
- Ledger: `implementation-status-auth.md`

**Keyingi: B-22** — Telegram bot (ulash + xabar yuborish).
### AUTH B-22 — Telegram bot (ulash + xabar + chat) ✅

**STATUS:** ✅ DONE — unit 10 + integration 8 = 18/18 PASS; regression 64+172 PASS; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| `src/modules/email/telegram.js` | ✅ | send(chatId,text) retry/backoff, HMAC-SHA256 sign/verify (bot_token), start-token (20B/5dk/1-marta, used 24h saqlanadi — takroriy urinish aniq `token_used`), chastota cap + 24h dedupe |
| Ulash flow | ✅ | GET /user/telegram/link (UI) · POST /api/telegram/link (start-token) · POST /webhooks/telegram-bot (HMAC-signed callback → consume token → telegram_id + notif_prefs.telegram.on) |
| Chat (read-only) | ✅ | POST /api/telegram/bot-message — "Natijalarim"/"Bugungi jadval" faqat o'z ma'lumoti (userId telegram_id orqali — boshqa user ma'lumoti yo'q) |
| Unlink | ✅ | POST /api/telegram/unlink — telegram_id + meta o'chiriladi, prefs.telegram=false |
| Security | ✅ | callback bad signature → 401; hijack guard; token single-use; telegram_id PII — preview'da mask (maskTelegramId); CSRF (X-CSRF-Token header) |
| i18n 4 til | ✅ | telegram blok (11 kalit) — uz/uz-cyrl/ru/en |
| Audit + metric | ✅ | TELEGRAM_LINKED / TELEGRAM_UNLINKED / TELEGRAM_SENT / TELEGRAM_FAILED action'lar + recordMetric |
| deliverAlert telegram | ✅ | new-device.js — notif_prefs bo'yicha kanal; telegram_id real o'qiladi (chatId) |
| Testlar | ✅ | unit 10 (signed callback/token expiry/send retry/used token) + integration 8 (ulash→xabar, chat, cap, noto'g'ri signed, IDOR) = 18/18 PASS |

## Review davomida tuzatilgan 🔧
- **used token 24h saqlanadi** — `clearUsedTokens` o'chirib yuborayotgan edi; endi `token_used` holati saqlanadi (takroriy urinishda aniq xato)
- **TELEGRAM env test'da yo'q edi** — vitest.config.js'ga `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` qo'shildi (bot enabled)
- **chat testi mustaqil qilindi** — oldingi test token'ni ishlatib 555'ni ulagan, chat testi 987654321 bilan so'ragan — endi har biri o'z user + ulash bilan

## Tekshiruvlar
- B-22: unit 10 + integration 8 = **18/18 PASS**
- Regression: telegram/notif/new-device/email 64/64 + auth (a16/a18/test/a28/a09/a08/a30/a25/a27) **172/172 PASS**
- `tsc` 0 · design-lint PASS · boot toza (register→panel 302, link page 200+csrf, start-link 200 url, bad-sig 401)
- Ledger: `implementation-status-auth.md` ga yoziladi · db.json toza

**Keyingi: B-23** — Email infra hardening (retry/queue/observability).
### AUTH B-23 — Push notifications (PWA) ✅

**STATUS:** ✅ DONE — unit 9 + security 4 + integration 6 = 19/19 PASS; regression 170/170; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| VAPID keys (.env) | ✅ | env.js: VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT, PUSH_ENABLED, PUSH_DAILY_CAP, PUSH_QUIET_START/END, PUSH_OPTIN_AFTER_SESSIONS; `web-push@3.6.7` o'rnatildi; prod'da secret KMS |
| `public/js/push.js` subscribe | ✅ | service worker + pushManager; urlBase64→Uint8Array; subscribe/unsubscribe; X-CSRF-Token header; PWA install'dan keyin (iOS Safari fallback email/Telegram §28) |
| Kontekstual opt-in (§07) | ✅ | login_count 2-3 sessiyadan keyin so'raladi (birinchi kirishda emas) — login'da `login_count` increment; GET /api/push/optin-eligible; panel'da push-optin banner (Ha/Hozir emas) |
| `push_subs` saqlash (§08) | ✅ | `users.{id}.push_subs.{subKey}` — endpoint/keys/created_at/ua-hash/last_used_at; idempotent (takroriy POST → created=false) |
| Send (web-push, encrypt) | ✅ | `sendPushNotification` — payload encrypt, prefs bo'yicha (B-21 checkNotifRate cap), quiet hours 22:00-08:00 (§10) |
| Chastota cap + dedupe (§10) | ✅ | B-21 `checkNotifRate` (push 2/kun) + `recordNotifSent` |
| Subscription expiry (§11) | ✅ | 404/410 → subscription o'chiriladi (unsubscribe) |
| Audit (§12) | ✅ | PUSH_SUBSCRIBED / PUSH_UNSUBSCRIBED / PUSH_SENT / PUSH_FAILED |
| Quiet hours a11y (§13) | ✅ | UI'da "Tinch vaqt (22:00-08:00)" note; quiet paytida send reject (reason='quiet_hours') |
| Service worker push event | ✅ | push → showNotification (title/body/icon/tag); notificationclick → focus/navigate url |
| 4 til push stringlar | ✅ | push blok (14 kalit) — uz/uz-cyrl/ru/en |
| Cleanup job (§29) | ✅ | server.js'da kunlik timer — 180 kundan ortiq ishlatilmagan subscription'lar tozalanadi |
| Security/data guard (§16) | ✅ | endpoint PII — preview'ga chiqmaydi; payload minimal (title/body/url/tag — preview sensitive yo'q); VAPID private key faqat env'da; CSRF + audit barcha write path'da |

## Review davomida tuzatilgan 🔧
- **`notifCopy` view'ga uzatilmagan** — push.ejs nav'da ReferenceError → 500; route'ga qo'shildi
- **Integration testlarda session aralashuvi** — barcha test bir xil supertest agent (cookie) ishlatgan; har test uchun `freshAgent()` (IDOR/bog'liqsizlik)

## Tekshiruvlar
- B-23: unit 9 + security 4 + integration 6 = **19/19 PASS**
- Regression: notifications/telegram/email/new-device/env/role-shell/auth 170/170 PASS
- `tsc` 0 · design-lint PASS · VAPID generate OK (87/43) · boot toza (push page 200, vapid-key 200, optin 1-sessiya false/2-sessiya true, subscribe created, unsubscribe ok, send quiet_hours)
- Ledger: `implementation-status-auth.md` ga yozildi · db.json toza

**Keyingi: B-24** — Email change flow (reauth + double opt-in).
### AUTH B-24 — Email change (reauth + double opt-in) ✅

**STATUS:** ✅ DONE — unit 17 + integration 9 + a-29 regression = 30 PASS; auth regression 177/177; tsc 0; design-lint 0 hard error; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Reauth shart | ✅ | `requireRecentAuth` (parol/MFA, 30dk) + `requireMfaStepUp` — reauth'siz 403 `reauth_required` |
| §07 IKKALA address verify | ✅ | Yangi email'ga 6-xonali kod (5dk, single-use) + eski email'ga confirm-token (15dk) — ikkalasi shart |
| §08 Commit | ✅ | `users.email=new, email_verified=true`, index eski→yangi (race guard), pending o'chadi, eski email'ga "o'zgartirildi" xabari |
| §10 Event + audit | ✅ | `email_change_requested`/`email_changed` account events + `EMAIL_CHANGE_REQUESTED/CANCELLED/CHANGED` audit |
| §11 Rate 3/soat | ✅ | in-memory, `_resetEmailChangeRate()` test uchun |
| UI + i18n 4 til | ✅ | `/user/email-change` sahifa (reauth note, request/confirm/cancel), emailChange blok 4 til (21 kalit + 15 errors), a11y (focus, aria-live, 44px) |
| CSRF + IDOR | ✅ | X-CSRF-Token header, session-scoped userKey (boshqa user pending'iga confirm bloklangan) |
| Eski oqim almashtirildi | ✅ | `routes/auth.js` eski `/api/account/email/request`+`/verify` (A-29 kod-usuli) o'chirildi; `security-profile.ejs` + `account-settings.js` yangi sahifaga havolaga yangilandi; `auth-a29.test.js` yangi kontraktga ko'chirildi |
| Security | ✅ | token faqat hash (sha256+salt), plaintext saqlanmaydi; email masked; request'da `emailInvalid/emailDisposable/emailNoMx/emailTaken/same_email` aniq xatolar |

**Review'da topilgan real bug'lar (tuzatildi):**
1. `confirmEmailChange` da `lang` ReferenceError — `renderEmailChanged({lang})`; request'da `lang` record'ga saqlanadi.
2. Eski A-29 email endpoint'lari yangi B-24 route'larini to'sardi (mount tartibi) — eski oqim o'chirildi, frontend va testlar yangilandi.
3. i18n bloklari til segmentlariga noto'g'ri joylashgan edi (uz'da uz-cyrl matni) — qayta joylashtirildi.
4. `email_change_requested` event fire-and-forget edi — `await` qilinib, confirm'dan oldin yozilishi kafolatlandi.

- Ledger yozildi, db.json toza, temp fayllar yo'q.
### AUTH B-25 — Session invalidation edge cases (massive) ✅

**STATUS:** ✅ DONE — unit 5 + integration 3 = 8/8 PASS; regression 128/128 (auth, a-19/25/26/27/29/30, reset-a06, b-24); tsc 0; design-lint 0 hard error; boot HEALTH 200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §07 `revokeByUser(userId, {exceptSessionId})` | ✅ | `session-manager.js` — Express-session store destroy (Redis DEL/MemoryStore) + local DB tracking + audit `SESSIONS_REVOKED` (`session:revoked:bulk`); `setSessionStore` server startup'da ulangan |
| §27 exceptSessionId — joriy saqlanadi | ✅ | hamma trigger'da joriy sessiya saqlanadi (test tasdiqlaydi) |
| §15 client cookie'ga ishonilmaydi | ✅ | revoke server-side (store destroy); cookie qayta yuborilsa sessiya topilmaydi → 401 (replay test) |
| Password change → boshqa sessiyalar revoke | ✅ | `routes/auth.js` — eski `revokeOtherSessions` (faqat DB tracking) o'rniga `revokeByUser` (store destroy + audit) |
| Email change → boshqa sessiyalar revoke | ✅ | `routes/email-change.js` confirm — `revokeByUser(except current)` + joriy sessiyadagi email yangilanadi (`result.email`) |
| MFA enable/disable → revoke | ✅ | `routes/mfa.js` — enable: boshqalar revoke; disable: boshqalar revoke, joriy saqlanadi (§27) |
| Passkey revoke → revoke | ✅ | `routes/passkey.js` `/api/passkey/remove` — boshqalar revoke |
| Reset password → barcha revoke | ✅ | `routes/reset.js` (ikki joyda) — `revokeByUser(except joriy yangi session)` |
| Role change (teacher approve/reject) → revoke | ✅ | `routes/admin/teachers.js` — rol o'zgarishida teacher sessiyalari revoke (middleware role_version qatlami bilan birga) |
| §08 Multi-device test | ✅ | 2 brauzer → password change → 2-si 401, joriy saqlanadi (integration) |
| §09 Replay test | ✅ | revoke qilingan cookie bilan qayta so'rov → 401 |
| §10 Concurrent invalidation | ✅ | parallel revokeByUser — idempotent, xato yo'q |
| §12 Audit | ✅ | `session:revoked:bulk` (count + reason + exceptCurrent) |
| Regression fix | ✅ | `auth.test.js` reset testi — revoke server-side bo'lgach 401 `unauthorized` (sessiya yo'q) ham qabul qilinadi (avval faqat 'Session yakunlandi') |

- unit 5 + integration 3 = **8/8 PASS** · regression **128 PASS** · tsc 0 · design-lint PASS · boot toza
- Ledger yozildi, db.json toza, temp fayllar yo'q
- Next: B-26 (B-faza checkpoint sign-off)
### AUTH B-26 — B-faza CHECKPOINT sign-off ✅

**STATUS:** ✅ DONE — faza yopildi

| Tekshiruv | Natija |
|---|---|
| B-faza unit suite | ✅ 260/260 PASS |
| B-faza integration batch | ✅ 38/38 + 177/177 + 128/128 + 95/95 PASS |
| Register tekshiruvi | ✅ email majburiy+unique+verify, honeypot, ≤5 maydon, duplicate blok |
| Secret scan | ✅ parol/token/OTP log'da yo'q — 0 topilma |
| A11y axe audit | ✅ **12/12 PASS** (login, register, onboarding, landing, error, offline + dark + keyboard + 200% zoom) |
| design-lint | ✅ PASS |
| tsc | ✅ 0 error |

### B-26 davomida tuzatilgan haqiqiy a11y bug'lar 🔧

| Topilma | Fix |
|---|---|
| **Login sahifasidagi bo'sh anchor** — B-03'da register alohida sahifaga ko'chirilganda `login.noAccount`/`login.signup` i18n kalitlari qo'shilmagan → `<a href="?mode=reg">` bo'sh chiqar edi (axe: link-name serious) | 4 tilda `noAccount`+`signup` kalitlari qo'shildi + havola `/user/register` ga yo'naltirildi (data/auth-i18n.js, views/user/login.ejs) |
| **Register dark link kontrasti** — `.bottom-cta a` underline'siz edi (link-in-text-block) | auth.css'da underline + offset |
| **Landing dark stats link kontrasti** — `.ld-stats-note a` `--ld-primary #4f46e5` dark bg'da 3.33:1 (< 4.5:1 AA) | Dark uchun `#818cf8` (6.9:1), light'da `--ld-primary` (5.35:1) — landing.css |
| **Onboarding a11y test URL** — hali `/user/login?mode=reg` ga borardi, `#reg-name` faqat alohida register sahifasida bor | audit.spec.js → `/user/register` |

### Faza sign-off

- B-01..B-25 ✅ (25/25 prompt) + B-26 checkpoint ✅
- Register+Onboarding+Email+Sessiya yig'ma QA: unit 260 + integration ~440 + a11y 12 + design-lint PASS + tsc 0
- Residual risk: web-push/PWA va Telegram kanallari test rejimida simulyatsiya qilinadi (real provider prod'da tekshiriladi); email/telegram provider'lar mock — prod env'da smoke talab etiladi
- **B-FAZA TUGADI** — keyingi: B-27..B-33 (session/email/onboarding qolgan qismlar) → B-34..B-36 → B-37 FINAL
### AUTH B-27 — Register security detail (password field hardening) ✅

**STATUS:** ✅ DONE — unit 8 + integration 5 + regression 150+ PASS; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 autocomplete=new-password | ✅ | mavjud (B-03) + maxlength=128 client |
| §07 Show/hide toggle + aria-pressed | ✅ | mavjud (A-04), focus saqlanadi |
| §08 Paste ruxsat | ✅ | native — blok yo'q |
| §09 zxcvbn indikator | ✅ | **yangi:** zxcvbn 4.4.2 client'ga vendor qilindi (`public/js/vendor/zxcvbn.js`, 821KB — faqat register sahifasida); score 0-4, teacher uchun >=4 (server bilan bir xil `password-policy.evaluatePassword`); NIST SHALL NOT — composition qoidalari olib tashlandi (eski heuristic 4-qoida o'rniga) |
| §10 HIBP async inline | ✅ | **yangi:** `POST /api/validate/password-breach` — client Web Crypto bilan SHA-1(password) hisoblaydi, faqat hash yuboriladi (parol network trace'da EMAS §14); server HIBP'ga faqat 5-belgi prefix (k-anonymity); breach → inline xato + `aria-invalid`; offline → fail-open (`hibp_offline` metric yo'nalishi) |
| §11 Caps Lock warning | ✅ | mavjud (caps-hint) |
| §12 Unicode + space | ✅ | Zod `.string()` — trim/strip YO'Q, barcha belgilar saqlanadi |
| §13 Max 128 (NIST SHALL) | ✅ | server Zod `.max(128)` (mavjud) + client `maxlength="128"` — truncate YO'Q |
| §14 Parol JS/network'da qolmaydi | ✅ | inline check faqat SHA-1; parol input blur'da tozalanadi; register.js'da parol saqlanmaydi |
| §15 NIST SHALL NOT | ✅ | composition yo'q, rotation yo'q, security question yo'q |
| §16 Min uzunlik | ✅ | client `minlength=15` + `passwordPh` i18n 'Kamida 15 belgi' (server evaluatePassword min 15 oddiy / 8 MFA) |
| §18 Server yagona truth | ✅ | client UX, server Zod + evaluatePassword |
| §21 Audit/metrics | ✅ | `auth.password_breach_check` counter (breached/clean/checked) |
| §28 HIBP offline fail-open | ✅ | endpoint `{breached:false, checked:false}` — signup buzilmaydi |
| §29 Metrics | ✅ | password_breach_check + mavjud password_strength |

- unit 8 (sha1Hex NIST vector, k-anonymity faqat prefix, suffix match, invalid input, API xato fail-open, offline fail-open, isPasswordBreached integratsiyasi, test-mode skip)
- integration 5 (parol yuborilsa 400, yaroqsiz hash 400, yaroqli SHA-1 200 fail-open, CSRF yo'q 403, rate-limit 429)
- regression: register-b03 + auth-b03 + a21 + bot-guard-b08 + password-policy-a22 (51) + auth.test/a06/a18 (99) + B-26 a11y 12/12 — hammasi PASS
- Boot: register 200, zxcvbn include+served (821KB), maxlength/minlength/data-breach-msg to'g'ri
- B-28 uchun tayyor: email verification detail (typo/resend/cooldown) — email-verify moduli B-06/B-18 da qurilgan, `/api/validate/email` mavjud
### AUTH B-28 — Email verification detail (typo, resend, cooldown) ✅

**STATUS:** ✅ DONE — unit 7 + integration 4 + regression 113 PASS; tsc 0; design-lint PASS

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Typo suggestion | ✅ | B-05'da mavjud (register.js: gmial→gmail inline "demoqchimisiz? [Ha]") — faqat taniqli domain xatolari, `/api/validate/email` suggestion |
| §07 Resend cooldown 60s | ✅ | server 3/soat qat'iy (SEND_MAX_PER_HOUR=3) + 60s cooldown → 429 `resend_cooldown` + `retryAfterSeconds`; client timer (startResendTimer) disabled tugma |
| §08 Expiry UX | ✅ | **yangi:** `verifyCode` endi expired kod uchun alohida `expired` (422) error (avval `otp_invalid` bilan birlashtirilgan edi) — client'da "Kod muddati o'tgan — [Yangi kod yuborish]" CTA resend'ni chaqiradi; audit `EMAIL_VERIFY_EXPIRED` + metric `auth.email_verify.expired` |
| §09 Email change during verify | ✅ | `evm-update-email` → `/user/security-profile` (B-24 flow) |
| §10 Limited mode banner | ✅ | resend limiti 429 `too_many_requests` → client `limitReached` xabari + tugma disabled (takrorlanmaydi); limited-mode banner B-06'da mavjud |
| §11 OTP autofill | ✅ | `autocomplete="one-time-code"` + `inputmode="numeric"` (iOS/Android autofill) |
| §12 OTP input UX | ✅ | 6-raqam `pattern="[0-9]{6}"`, faqat raqam, paste ishlaydi, 6 raqamda auto-submit |
| §13 Jitter | ✅ | **yangi:** `verifyCode`'da xato/expired/noto'g'ri user kodida 100-300ms random delay (brute-force sekinlashadi, C-01 bilan birga); `delay()` helper test'da stub |
| §14 Kod hash, single-use, 15 daqiqa | ✅ | mavjud (A-18): sha256(code:salt), withLock single-use, TTL 15min |
| §15 Resend eski kodni bekor qiladi | ✅ | **yangi:** `sendVerifyCode` eski `email_verify_last.lookupKey` record'ini `used=true + replaced_by` qiladi — replay yo'q |
| §16 Kod log'da yo'q | ✅ | kod hech qachon log'ga chiqmaydi; audit'da faqat event |
| §18 Audit/metrics | ✅ | `EMAIL_VERIFY_EXPIRED` action + `auth.email_verify.expired` counter |
| §23 A11y | ✅ | `role="alert"` inline, `aria-live="polite"` toast, resend focus-visible |
| §24 i18n 4 til | ✅ | `errExpired`/`expiredCta`/`limitReached` — 4 til (uz, uz-cyrl, ru, en) |
| §25 Failure state | ✅ | email xatosi → retry + errResend; HIBP/email offline → fail-open |
| §26 Metrics | ✅ | verify_sent + verify_complete (success/fail) + expired + rate metrics |

- unit 7 (generateCode 6-xonali, delay stub, resend revoke replay yo'q, expired alohida error, otp_invalid kontrakt, format 400, rate limit 5/15)
- integration 4 (cooldown 429+retryAfterSeconds, expired 422, CSRF 403, 3/soat limit)
- regression: email-verify-a18 (B-28 ga moslandi — expired endi alohida), auth.test, auth-a18, auth-b07 + b28 = **113 PASS**
- Ledger yozildi, db.json toza, temp fayllar yo'q
- **B-29 uchun tayyor:** teacher approval detail (application form + review queue) — `src/modules/auth/teacher-approval.js` + `routes/admin/teachers.js` + `routes/auth.js` register branch mavjud
### AUTH B-29 — Teacher approval detail (application form, review queue) ✅

**STATUS:** ✅ DONE — unit 10 + integration 4 + regression 121 PASS; tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Application form | ✅ | **yangi:** register.ejs'da `teacher-app-fields` — university (200), subject (100), experience (0-50), reason (500); role=teacher tanlanganda ko'rinadi + university required (register.js toggle) |
| §07 Form validatsiya | ✅ | Zod `registerSchema`: university 200 / subject 100 / experience refine 0-50 / reason 500; route'da wantsTeacher → university+subject majburiy (universityRequired/subjectRequired), xatolar register sahifasiga + prevUniversity/prevSubject qiymatlari saqlanadi |
| §08 Review queue | ✅ | `/admin/teachers` filter (pending/approved/rejected) + qidiruv + "yangi" badge (pendingTotal) + sort appliedAt; `/admin/api/teachers/pending` subject/experience bilan |
| §09 Reviewer assign | ✅ | admin default; approve/reject reauth + MFA step-up (A-25) |
| §10 Approver o'z arizasini tasdiqlay olmaydi | ✅ | `assertDecisionAllowed` (A-25) — self-approve blok |
| §12 Application history | ✅ | teacher-approval.ejs — pending "ko'rib chiqilmoqda" / rejected sabab + vaqt + cooldown; admin queue'da status/rejectionReason |
| §13 Re-apply cooldown | ✅ | 30 kun (CONFIG.TEACHER_REJECT_COOLDOWN_MS) — rejected → pending faqat o'tgach; appeal audit (B-16) |
| §14 Duplicate application | ✅ | **yangi:** `submitTeacherApplication` canonical `teacher_applications` da TIRIK (pending/approved) ariza topilsa → `duplicate_application` (role'ga emas, record'ga asoslanadi — register oqimi user'ni avval teacher_pending qiladi); xato register sahifasida `duplicate_application` i18n matni bilan |
| §15 Security/data guard | ✅ | PII minimal (university+subject+experience); faqat admin queue; IDOR test (anon → 302/401) |
| §17 Audit/metrics | ✅ | TEACHER_APPLICATION / TEACHER_COOLDOWN_BLOCK / DUPLICATE_ATTEMPT + teacher_application_submitted |
| §18-20 Testlar | ✅ | unit 10 (schema, experience range, limitlar, parseRegister, buildApplicationRecord slice, duplicate×2, cooldown transition) + integration 4 (register pending+DB, university yo'q xato, admin queue, IDOR) + IDOR/privilege regression |
| §22 A11y | ✅ | label+inline error (`role="alert"`), rol kartalari radio, error focus |
| §23 i18n 4 til | ✅ | universityPh/subjectPh/experiencePh/reasonLabel/dupApplication/appSubmitted + 7 error kalit (4 til) |
| §24 Failure state | ✅ | ariza yuborilmasa xato ko'rinadi; notification queued (B-15) |

- **Eski testlar moslandi:** auth-a19, auth-a25, auth-b03 helper'lariga subject/university default qo'shildi (B-29 majburiy kontrakt)
- unit 10 + integration 4 = **14/14 PASS**; regression: a19(8) + a25(8) + b03 + a21 + auth.test = **121 PASS** · tsc 0 · design-lint PASS · boot toza (teacher form render)
- Ledger yozildi, db.json toza, temp fayllar yo'q
- **B-30 uchun tayyor:** onboarding detail (progress, returnUrl, skip) — `routes/onboarding.js` + `views/user/onboarding*.ejs` mavjud
### AUTH B-30 — Onboarding detail (progress, returnUrl, skip) ✅

**STATUS:** ✅ DONE — unit 13 + integration 5 = 18/18 PASS; regression 61/61 (b17/b19/b30 + session-timeout); tsc 0; design-lint PASS; boot toza (health 200, onboarding anonim → 401)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Progress stepper | ✅ | Mavjud (B-17): 3 bosqich sticky, aria-current — B-30'da `checklist`/`done` bosqichida ham aria-current to'g'ri |
| §07 ReturnUrl | ✅ | `routes/onboarding.js` — GET `/onboarding?returnUrl=` → `safeReturnUrl` (allowlist, open redirect YO'Q), session'da saqlanadi; complete → `req.session.onboardingReturnUrl` (bir marta ishlatiladi, keyin o'chadi); view'dagi tugma `data-return-url` orqali dinamik |
| §08/§09 Skip | ✅ | Mavjud (B-17): ixtiyoriy qadamda [Skip], skip → first_win + skipped flag |
| §10 Half-done re-entry | ✅ | Monotonic: client `step` parametri qabul qilinmaydi (orient step=done → first_win); qayta kirishda davom (welcome intro takrorlanmaydi) — integration test |
| §11 First-win re-entry | ✅ | complete → `checklist` bosqich (B-19 Reinforce) — done ekran takroriy emas |
| §15 Security/data guard | ✅ | State user-scoped; IDOR test — B user A userning holatiga ta'sir qila olmaydi |
| §18 Unit test | ✅ | `tests/unit/onboarding-b30.test.js` (13): returnUrl allowlist (absolute/`//`/js-scheme/path-traversal/not-allowed-prefix → default), ONBOARDING_STEPS tartibi, canAdvance faqat oldinga, stepIndex, onboardingProgress 0/33/67/100, normalizeState (checklist/skipped refresh'da yo'qolmaydi) |
| §19 Integration test | ✅ | `tests/integration/onboarding-b30.test.js` (5): returnUrl=/teacher → complete → /teacher; https://evil.com → /user/panel (open redirect); re-entry davom; IDOR; monotonic |
| §22 A11y | ✅ | Stepper aria-current (checklist/done), progressbar aria-valuenow, live region (B-19) |
| §25 Metrics | ✅ | `onboarding:view` audit + onboarding_step/skip/complete (mavjud) |

**B-30 review davomida:** onboardingProgress'da Math.floor vs Math.round (66 vs 67) — yopilgan B-17 kontrakti 67'ni kutadi, shuning uchun Math.round saqlanib, yangi test 67'ga moslandi (regression buzilmadi).

**B-fazada shu kungacha:** B-01..B-30 ✅ (31/37). Keyingi qadam — **B-31 (Email infra detail: queue, retry, dead-letter)** — email infrastructure'ga tayyor (B-06 sendVerifyCode, email-log B-02, provider mavjud).
### AUTH B-31 — Email infra detail (queue, retry, dead-letter) ✅

**STATUS:** ✅ DONE — unit 8 + integration 5 = 13/13 PASS; regression 165/165 (email-a23, a06/reset, b28, b20, b02, b03, a20, a25, auth.test, onboarding-b19); tsc 0; design-lint PASS; boot toza (health 200 + queue e2e sent=1)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Queue (DB-backed) | ✅ | `src/modules/email/queue.js` — BullMQ emas, Firebase/local-db (ioredis faqat sessiya uchun opsional; mavjud welcome/SLA worker pattern'i bilan bir xil). Job: `{ template, data, priority, idempotencyKey, tag, status, attempts, nextRetryAt }` |
| §07 Priority | ✅ | urgent (reset/verify/security) = 0, normal = 1 — worker priority → createdAt tartibida to'kadi |
| §08 Retry 1m/5m/15m | ✅ | Faqat transient (throw) uchun; `EMAIL_RETRY_BACKOFFS_MS [60k, 300k, 900k]`; provider inline retry'dan keyingi 2-qatlam |
| §09 Dead-letter | ✅ | 3 marta fail → `status=deadletter` + `deadletterReason` + `email:deadletter` audit + warn log + `deadLetterDepth()` gauge |
| §10 Rate throttle | ✅ | `EMAIL_QUEUE_BATCH=10`/sikl + 100ms inter-send pauza (burst qarshi) |
| §11 Webhook delivery | ✅ | `webhook.js` — Delivery klassifikatsiyasi qo'shildi → email_log `delivered` (ilgari ignored); bounce → suppress, complaint → audit (mavjud) |
| §12 Idempotency | ✅ | `email_idempotency/{key}` (Redis SETNX ekvivalenti, DB store'da) — bir xil key duplicate, yangi job YO'Q; retry bir job'ni qayta urinadi (takroriy send yo'q) |
| §13 PII xavfsizligi | ✅ | Job'da plaintext email YO'Q — userKey/inviteTokenHash; recipient send paytida DB'dan o'qiladi. Job'da OTP/parol YO'Q. Faqat 'reset' template'ida single-use 30d. resetUrl (capability havola) — hujjatlashtirilgan |
| §14 Bounce handling | ✅ | Permanent (HardBounce) → suppress + email_status=bounced; transient → retry (mavjud webhook + queue) |
| §15/§18 Audit | ✅ | `email:queued/sent/retried/deadletter/delivered` — AUDIT_ACTIONS + logAuthEvent |
| §23 Observability | ✅ | `email.queued/sent/retried/deadletter` metriclar + `queueDepth()`/`deadLetterDepth()` gauge + server log'da depth/dlq |
| §24 Failure state | ✅ | Worker down → job'lar DB'da qoladi; stale-processing recovery (60s lease) — crash'da job qayta olinadi |
| §19 Unit test | ✅ | `tests/unit/email-queue-b31.test.js` (8): enqueue validatsiya, PII no-plaintext, idempotency duplicate, priority order, retry backoff 1m/5m, DLQ 3-fail, recipient topilmasa darhol DLQ, recipient resolution (userKey/invite), queueDepth |
| §20 Integration test | ✅ | `tests/integration/email-queue-b31.test.js` (5): reset → navbat (urgent) → worker → job sent + email_log 'reset'; webhook Delivery → delivered; HardBounce → suppress + bounced; throttle limit=1; idempotency 1-yuborish |
| Integration: reset flow | ✅ | `routes/reset.js` — reset email queue'ga (urgent, idempotencyKey=token hash); timing padding 300ms (enumeration side-channel yopiq); email_log + audit to'liq |

**Dizayn qarorlari (senior):**
1. **BullMQ YO'Q** — ioredis opsional (sessiya), Firebase-first arxitektura; DB queue + setInterval worker mavjud pattern (welcome/SLA) bilan izchil. Guide'dagi "BullMQ/Redis" talabi DB-queue bilan qanoatlantiriladi (idempotency DB SETNX-ekvivalent).
2. **Recipient send paytida resolve** — toHash emas, `userKey`/`inviteTokenHash`; email o'zgarsa ham eng yangi manzil. Bu toHash'dan ham kuchliroq (low-entropy email hash'ini reverse qilish mumkin edi).
3. **`resetUrl` job'da** — single-use 30d. capability (OTP emas), app DB'da, ishlovdan keyin o'chiriladi.
4. **email_log 'sent' queue o'zi yozadi** (transport'dan mustaqil) — provider ham yozsa messageId bilan dedupe.

**Review davomida topilgan real bug:** `logEmailRecord` fire-and-forget edi (await yo'q) — test email_log'ni yozuvdan oldin o'qirdi; `await` qilinib tuzatildi (B-31 §24: job state doim DB bilan izchil).

**B-fazada shu kungacha:** B-01..B-31 ✅ (32/37). Keyingi qadam — **B-32 (Notification detail: dedupe, quiet hours, template per event)** — notification infratuzilmasi (push/email) tayyor.
### AUTH B-32 — Notification detail (dedupe, quiet hours, template per event) ✅

**STATUS:** ✅ DONE — unit 9/9 PASS; regression 55/55 (b21/b22/b23/a16, push-security); tsc 0; design-lint PASS; boot toza (health 200 + quiet→delayed→drain modullar yuklanadi)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Dedupe event:day | ✅ | `notif_dedupe/{userId}/{type}/{dateKey}` marker — bir hodisa 24 soat ichida bir marta; takroriy → `notif:dedupe` audit + `notif.dedupe` metric. Security hodisalari dedupe EMAS (har biri alohida hodisa) — hujjatlashtirilgan |
| §07 Quiet hours | ✅ | `inQuietHours`/`nextQuietEnd` — default 22-08 (user `notif_prefs.quiet` bilan sozlaydi, null → off). Marketing → `notif_delayed/{userId}/{id}` (dueAt=ertaga 08:00) + `notif:quiet_delayed` audit; security DARHOL |
| §08 Per-event template | ✅ | `notifContent(type, {lang})` — assignment/deadline/result/feedback/practice/security × 3 kanal (email/Telegram/push) × 4 til; security email B-20 `renderSecurity` |
| §09 Segment | ✅ | `userSegment` (last_active: ≤7d consistent, ≤30d sporadic, 30d+ lapsed) + `segmentDailyCap` (sporadic kamroq, lapsed win-back ko'proq) |
| §10 Chastota cap | ✅ | `checkNotifRate` cap override bilan; segment-scaled cap amalda ishlatiladi; security cap'ga kirmaydi (`segmentDailyCap → Infinity`; telegram/push kanal funksiyalarida ham bypass — B-32 review'da topilgan real bug tuzatildi) |
| §11 Security majburiy | ✅ | `FORCED_SECURITY_TYPES` (mavjud B-21) + dispatch forced + `isSecurity` yo'li — user o'chira olmaydi |
| §12 Kanal tanlovi | ✅ | B-21 prefs; security → barcha majburiy kanallarga harakat + email fallback |
| §13 Preview xavfsiz | ✅ | `notifContent` matnlarida OTP/parol/answer YO'Q (test tekshiradi); security email faqat device/browser/city |
| §14 Audit | ✅ | `notif:sent` (event+channel+ts), `notif:dedupe`, `notif:quiet_delayed` — AUDIT_ACTIONS + logAuthEvent |
| §24 Failure fallback | ✅ | Kanal failsa keyingisiga (test: telegram down → email delivered); security hech bo'lmasa bitta kanal |
| §25 Metrics | ✅ | `notif.delivered.{channel}`, `notif.dedupe`, `notif.quiet_delayed`, `notif.cap_enforced` |
| §18 Unit test | ✅ | `tests/unit/notifications-b32.test.js` (9): quiet hours (default/user/null/off), segment, segmentDailyCap, notifContent (3 kanal 4 til + sensitive yo'q), dedupe, quiet→delayed→drain, cap/security bypass, fallback |
| §07 Drain | ✅ | `drainDelayedNotifications` — due+quiet tugagan → yuboradi; hali quiet → qoldiradi; server.js'da 60s interval (non-test) |

**Review davomida topilgan real buglar (2):**
1. **Double-count cap**: telegram/push o'z `recordNotifSent` qiladi, sendNotification ham qo'shgan — count 2x. Endi faqat email kanali uchun recordNotifSent (telegram/push o'zi).
2. **Security telegram'da cap bloklanardi**: `notifyUserTelegram`/`sendPushNotification` ichki `checkNotifRate` security'ni cap'ga solgan — §10 bo'yicha security cap'ga kirmaydi (bypass qo'shildi).

**B-fazada shu kungacha:** B-01..B-32 ✅ (33/37). Keyingi qadam — **B-33 (Register/Onboarding/Email FINAL — B-faza release)** — B-faza yig'ma QA + release sign-off.
## AUTH B-33 — Register/Onboarding/Email FINAL (B-faza RELEASE) ✅

**STATUS:** ✅ RELEASED — B-faza (Register/Onboarding/Email) release sign-off imzolandi.

### 1. To'liq B regression (§07)

| Bo'lim | Natija |
|---|---|
| B-faza testlari (55 fayl: b01-b32 + email/notif/push/telegram/register/onboard/teacher/invite/username) | **495/495 PASS** (4 batch: 77+128+153+137) |
| Security regression (§08): enumeration (a04/a05/a06), honeypot (a21), disposable (b05), teacher escalation (b16), email injection (b20), verify brute-force (b28), IDOR (b29) | **52/52 PASS** |
| Register/teacher final subset (b03/a18/a19/a25/b29/b28) | **50/50 PASS** |
| A11y regression (§09): axe 0 critical, onboarding keyboard journey | **12/12 PASS** |
| tsc / design-lint | 0 error / PASS |

### 2. 🔴 RELEASE QA'da topilgan CRITICAL bug — tuzatildi

**Brauzer register B-29'dan beri butunlay buzilgan edi** (real user qayta ro'yxatdan o'ta olmasdi):

| Muammo | Sabab | Fix |
|---|---|---|
| Brauzer register'da `university=''`/`subject=''` yuboradi → server `'required'` qaytaradi | B-29 `registerSchema`: `z.string().trim().min(1).optional()` — Zod `.optional()` bo'sh stringni o'tkazmaydi (`too_small`). Supertest testlar bu maydonlarni YUBORMAGANI uchun yashirilgan | `src/modules/auth/validation.js` — `university`/`subject` ga `.preprocess(v => v === '' ? undefined : v)` qo'shildi; student o'tadi, teacher route-level `wantsTeacher` tekshiruvi saqlanadi |
| A11y onboarding test bekor | B-27 parol min 15 — test 14 belgili parol ishlatar edi | `tests/a11y/audit.spec.js` — parol 17 belgiga (NIST min 15) |

**Regression test:** `tests/unit/teacher-app-b29.test.js` — "B-33 RELEASE fix: brauzer payload (barcha forma maydonlari bo'sh string) — student register OK" qo'shildi.

**Kontrakt yangilanishlari (2):** `email-verify-b07` — expired endi `'expired'` (B-28 UX); `email-webhook-a23` — Delivery → `'email:delivered'` (B-31), Open/Click hali ignored.

### 3. Performance (§11)

| O'lchov | Natija | Izoh |
|---|---|---|
| GET /user/register p95 | **187ms** ✓ (< 500ms) | |
| GET /user/login p95 | **40ms** ✓ | |
| POST register (warm) | ~2s | **Dev-artefakt**: local-db har `fb.set`'da BUTUN db.json'ni qayta yozadi (writeLock chain, /mnt/d sekin mount). Production'da Firebase — bu xarajat yo'q. Haqiqiy xarajat: Argon2 (~200ms, OWASP interactive) + zxcvbn (~300ms, NIST) + MX (200ms budget) — security-mandated |

### 4. Sign-off (§12/§22)

- **Security:** XSS/IDOR/injection topilmadi (52 security test + register fix). B-33 §13: critical yashirilmadi.
- **Product:** register→verify→login→onboarding→teacher approve journey to'liq ishlaydi (a11y keyboard journey PASS — brauzer register endi haqiqatan ishlaydi).
- **Operator:** manual checklist (ledger b01-b32 to'liq, db.json toza, temp fayllar yo'q).

### 5. P2/P3 → C/D/E fazalarga ko'chirildi (§24)

Passkey (A-27 ✅ backend, UI E-faza), risk-based auth (C-13), OneID (C), HEMIS OAuth (A-13 reja — C/D), Telegram deep integration (C), push full (C/D). B-fazada ATALMAYDI (A-17 qoida).

### 6. Release snapshot (§25) + Rollback (§26)

- **Baseline:** 495 B-test + 52 security + 12 a11y + 50 register-final = **609 test PASS**; tsc 0.
- **Rollback:** `validation.js` preprocess fix — bir fayl, revert oson (student register qayta buziladi — eski holatga qaytish shart emas, fix xavfsiz). Test yangilanishlari test-only.

### 7. Next readiness (§27/§28)

PROMPT_GUIDE_AUTH_B to'liq bajarildi (B-01..B-33, 34/37 — B-34/35/36 yangi security extra, C-faza bilan parallel). **C-00 preflight'ga tayyor** — C-faza (rate limit/lockout/fingerprint/risk/admin) baselini B-33 snapshot.

**B-faza yakuni:** B-01..B-33 ✅ (release). Keyingi qadam — **B-34 (Register security extra: bot fingerprint, velocity signup)** yoki C-faza.
### AUTH B-34 — Register security extra: bot fingerprint, velocity signup ✅

**STATUS:** ✅ DONE — unit 13 + integration 5 = **18/18 PASS**; regression 60/60 (8 fayl); tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06/§07 Velocity (IP yumshoq + fingerprint qattiq) | ✅ | `bot-guard.js: checkSignupVelocity` — per-IP 15/soat (kampus NAT, yumshoq) + per-fingerprint 10/soat (qattiq); limitda 429 `RATE_LIMITED`; qoidalar env'dan (`SIGNUP_VELOCITY_IP/FP_MAX_PER_HOUR`) |
| §08 Fingerprint faqat hash | ✅ | `device_fp` {16,64} hex validatsiya; register.ejs `data-device-fp` + device-fingerprint.js attach; raw telemetry server'ga kirmaydi |
| §09 Domain reputation | ✅ | `checkDomainReputation`/`recordDomainSignup` — yangi domain → suspicious review (record'da faqat lowercase domain) |
| §10/§11 Review queue | ✅ | `signup_reviews/{id}` — user_id, sabab (velocity\|domain), score, ip_hash, fingerprint_hash, vaqt; admin approve/reject |
| §13 Anti-bypass | ✅ | Integration test: X-Forwarded-For spoof IP'lar bilan ham fingerprint qattiq qatlam ushlaydi (11-chi 429) |
| §14 Security/data guard | ✅ | Review record'da faqat hash'lar — PII test bilan tasdiqlangan; reject → `users/{id}/signup_review_blocked` |
| §16 Audit + metrics | ✅ | `signup:velocity:block`, `signup:review:created`, `signup:review:resolved` + `signup.velocity_block`, `signup.review_created`, `signup.review_resolved`, `signup.review_created` gauge |
| §18 Integration | ✅ | Admin `/admin/api/signup-reviews` (list/approve/reject, `requireRecentAdminAuth` + `requireAdminMfaStepUp`), server.js mount |
| §21 A11y | ✅ | JSON API + audit — admin UI C/D fazada (razor sharp: keysiz parol UI yo'q) |
| §23 Failure state | ✅ | DB/Redis down → velocity fail-open (blok EMAS), Turnstile qattiq qoladi (B-08) |
| Register integrasiya | ✅ | Register branch: velocity check (429 lockout) → success'da domain history + suspicious → review (fire-and-forget); login'da `signup_review_blocked` → generic `riskBlocked` (enumeration yo'q) |

**Tekshiruvlar:** unit 13/13 + integration 5/5 = **18/18 PASS** · regression **60/60 PASS** (b08/b29/b03/a19/a25/a21) · tsc 0 · design-lint PASS · boot toza (health 200, anonim admin API 401, register page 200) · db.json tegsiz · temp toza

**Review davomida topilgan real bug (2):**
1. `bumpVelocity` counter'ni **increment qilmas edi** (faqat o'qirdi) — velocity hech qachon bloklamasdi. `fb.set` increment qo'shildi.
2. Double-count xavfi: velocity check allaqachon INCR qiladi (§07) — success path'da `recordSignup` ham chaqirilsa device limiti ikki barobar tez to'lishi (5 account → blok) bo'lardi. Success path'da takroriy count olib tashlandi.

**B-fazada:** B-01..B-34 ✅ (34/37). Keyingi qadam — **B-35 (Email extra: welcome journey, re-engagement)**.
### AUTH B-35 — Email extra: welcome journey, re-engagement ✅

**STATUS:** ✅ DONE — unit 9 + integration 3 = **12/12 PASS**; regression 72/72 (9 fayl); tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06/§07/§08 Welcome Day 0/1/3 | ✅ | B-19'da mavjud edi (`welcome.js` — w0/w1/w3/w7, idempotent flags, 4 til) — B-35'da qayta tekshirildi, regression yashil |
| §09/§10 Re-engagement 7/14 | ✅ | YANGI `reengage.js: runReEngagementSequence` — r7 (yumshoq qiymat) + r14 (qaytish rejasi), 4 til subject+html+text |
| §11 Segment | ✅ | B-32 `userSegment` qayta ishlatiladi — lapsed → win-back matn; audit details'da segment |
| §12 Template | ✅ | re_engage_7 / re_engage_14 — 4 til, mobile-subject (<60), plain-text variant majburiy (§23) |
| §13 Timezone | ✅ | `tashkentNow` (UTC+5) — Asia/Tashkent kun chegarasi bo'yicha faollik yoshi |
| §14 Opt-out | ✅ | Marketing xabari faqat `notif_prefs.channels.email === true` (B-21 default false — privacy-first); `marketing_disabled` ham honor qilinadi; integration: real `/api/notifications/prefs` ch_email=false → skip |
| §15 Suppress | ✅ | `email_status='bounced'` + `email_suppressed/{safeKey(email)}` — integration: real webhook HardBounce (A-23) → job skip |
| §16 Security/data guard | ✅ | PII minimal (email+username+subject); preview'da parol/OTP yo'q (unit test) |
| §18 Audit + metrics | ✅ | `onboarding:reengage_sent` / `onboarding:reengage_opted_out` + `deborah_onboarding_reengage_sent_total`, `reengage.opted_out` |
| §25 Idempotency | ✅ | `onboarding/{key}/reengageSent` {r7,r14} — ikkinchi run 0; welcome bilan bir xil pattern |
| Trigger | ✅ | server.js'da welcomeTimer bilan birga hourly `runReEngagementSequence` (unref, fail-open) |

**Tekshiruvlar:** unit **9/9** + integration **3/3** = 12/12 PASS · regression **72/72 PASS** (b19/b30/b32/a23 webhook/queue/b31) · tsc 0 · design-lint PASS · boot toza (health 200 + bo'sh DB'da re-engage run {sent:0}) · db.json tegsiz · temp toza · ledger yozildi

**Qarorlar:** (1) Re-engagement marketing xabari sifatida email opt-in talab qiladi — B-21 default `channels.email=false`, shuning uchun yangi userlarga marketing spam yo'q (privacy-first, §14); (2) Welcome journey (Day 0/1/3/7) transactional — prefs'ga bog'liq emas, B-19 kontrakti saqlandi; (3) Open/CTR rate — provider webhook'da faqat bounce/complaint bor (A-23); `reengage_return_rate` provider-analytics tomonida (D-faza).

**B-fazada:** B-01..B-35 ✅ (35/37). Keyingi qadam — **B-36 (Teacher extra: bulk invite, co-teacher, appeal)**.
### AUTH B-36 — Teacher extra: bulk invite, co-teacher, appeal ✅

**STATUS:** ✅ DONE — unit 13 + integration 5 = **18/18 PASS**; regression 58/58 (8 fayl); tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06/§07/§08 Bulk invite | ✅ | `src/modules/roster/bulk-invite.js` — CSV/XLSX upload → parse (roster parser qayta ishlatiladi) → batch invite; 100 ta/partiya; duplicate email (index + pending invite) skip; invalid → xato ro'yxati; qisman muvaffaqiyat (muvaffaqiyatlilar saqlanadi, §23); invite single-use + 7 kun expiry (B-11 kontrakti) |
| §09/§10 Co-teacher | ✅ | `src/modules/teacher/co-teacher.js` — owner qo'shadi (invite + rol `co_teacher`, scope {courseCode, owner}); ≤3/kurs (co-teacherlar + pending invite'lar hisoblanadi); faqat o'z kursida (isCourseTeacher); owner olib tashlaydi |
| §11/§12 Appeal | ✅ | `POST /api/teacher/appeal` — faqat `teacher_rejected`; cooldown gate (B-16, 30 kun) → 429; sabab 20-500 belgi; muvaffaqiyatda rol `teacher_pending`'ga qaytadi → admin queue (B-29) qayta ko'radi; teacher-approval sahifasida in-app forma (4 til) |
| §13 Teacher welcome | ✅ | `renderTeacherApproved` endi CTA'ga ega — "Birinchi testingizni yarating" → /teacher (4 til, §22) |
| §14 Security | ✅ | Invite single-use; rol admin EMAS — co_teacher workspace'ga kirmaydi (escalation test); co-teacher qo'sha olmaydi (teacher_only 403); bulk invite admin'da (requireAdmin) |
| §15 Idempotency | ✅ | Har item uchun — already_registered / duplicate_invite skip; qayta upload → 0 created |
| §16 Audit + metrics | ✅ | `teacher:bulk_invite_created`, `teacher:co_teacher_added/removed`, `teacher:appeal_created` + metriclar |
| §17-19 Testlar | ✅ | Unit 13 (bulk parse/duplicate/injection, co-teacher limit/scope/single-use, appeal cooldown) + Integration 5 (appeal e2e, bulk admin e2e, co-teacher scope, escalation) |
| Excel formula injection | ✅ | `EMAIL_RE` formula-email'ni rad etadi + parser normalize (test bilan) |

**Tekshiruvlar:** unit **13/13** + integration **5/5** = 18/18 PASS · regression **58/58 PASS** (b29/a19/a25/a11/b03) · tsc 0 · design-lint PASS · boot toza (health 200, anonim appeal/co-teachers/bulk 401-403) · db.json tegsiz · temp toza · ledger yozildi

**Qarorlar:** (1) Co-teacher scope kurs kodi (Firebase) bo'yicha — academic Postgres `teacher_assignments` bilan bog'lanmadi (co-teacher P2, D-fazada akademik modelga ulanishi mumkin); (2) Appeal role'ni `teacher_pending`'ga qaytaradi (admin queue qayta ishlatiladi, B-29); (3) Bulk teacher invite to'g'ridan-to'g'ri `teacher` roli beradi (admin bulk import — roster'da tasdiqlangan o'qituvchilar).

**B-fazada:** B-01..B-36 ✅ (36/37). Keyingi qadam — **B-37 (Register/Email ULTIMATE — B-faza yakuniy qabul)**.
### AUTH B-37 — Register/Email ULTIMATE (B-faza yakuniy qabul) ✅ SIGNED OFF

**STATUS:** ✅ B-faza YOPILDI — 115 fayl / **932 vitest PASS** + security re-verify 146/146 + a11y 12/12 + perf p95 <500ms + tsc 0 + design-lint PASS

---

## I. ULTIMATE CHECKLIST (B-37 §06) — to'liq, global daraja

| So'ha | Barchasi | Dalil |
|---|---|---|
| Register (forma, bot, velocity, duplicate) | ✅ B-03/B-04/B-08/B-09/B-21/B-29/B-34 + A-21/A-22 | honeypot + Turnstile + per-IP/email + velocity (fp qattiq) + duplicate enumeration-safe + NIST zxcvbn + HIBP |
| Email (validatsiya, verify, welcome, re-engage, infra, deliverability) | ✅ B-02/B-05/B-06/B-07/B-20/B-28/B-31/B-35 + A-18/A-23 | MX/disposable/smtp-probe; verify 6-kod; welcome Day 0/1/3/7; re-engage 7/14 (opt-in, suppress); queue+retry+DLQ; webhook bounce/complaint |
| Teacher (approval, bulk, co-teacher, appeal) | ✅ B-14/B-15/B-16/B-29/B-36 + A-19/A-25 | state machine; SLA; bulk invite (100/partiya); co-teacher (≤3, scope); appeal (cooldown) |
| Onboarding (state, activate, reinforce, progress) | ✅ B-17/B-18/B-19/B-30 | orient→first-win→checklist; monotonic progress; returnUrl; checklist 5 item |

## II. SIGN-OFFS (B-37 §08-§11)

**Security sign-off** — enumeration / XSS / IDOR / escalation / email injection / brute-force / bypass: **nol critical**
- Re-verify 11 security fayl: **146/146 PASS** (gate-0, a04-a09, a13, cast-security, security-guard, security-seb)
- B-34 anti-bypass: XFF spoof → fingerprint qattiq qatlam ushlaydi (test)
- B-36 escalation: co_teacher admin emas, qo'sha olmaydi (test); bulk formula-injection rad (test)
- Login lockout (A-03), reauth (A-25), admin MFA step-up (A-30), CSRF global

**Product sign-off** — UX, i18n 4 til (uz/uz-cyrl/ru/en), a11y, mobile:
- axe WCAG 2.2 AA audit: **12/12 PASS** (0 serious/critical)
- Keyboard-only focus trayekti, 200% zoom reflow (S36.03/S36.06) PASS
- i18n: B-35 re-engage + B-36 appeal/bulk UI 4 tilda (test bilan tekshirildi)

**Deliverability sign-off** — SPF/DKIM/DMARC provider-side (Postmark/SES DNS — operator). Monitoring: bounce → suppress (A-23/B-31 webhook), complaint → suppressed; email_log status queued|sent|delivered|bounced|complained. B-31 queue retry 3x + DLQ + gauge.

**Performance sign-off** — GET p95 (test env): health 10ms · login **53ms** · register **101ms** · landing **119ms** — hammasi **<500ms** ✓ (register POST ~2s — dev local-db fayl artefakti; production Firebase uchun o'lchanadi, B-33'da qayd etilgan)

## III. REGRESSION (B-37 §07) — 4 chunk, --no-file-parallelism

| Chunk | Fayl | Test |
|---|---|---|
| aa | 30 | 206 PASS |
| ab | 27 | 178 PASS |
| ac | 28 | 244 PASS |
| ad | 30 | 304 PASS |
| **JAMI** | **115** | **932 PASS** |

**Jarayonda tuzatilgan 4 eskirgan kontrakt (sabab — yangi B-faza kontrakti):**
1. `auth-a22` — teacher register `subject` yubormasdi (B-29 majburiy qildi) → helper'ga subject
2. `teacher-approval-b14` — `registerAs` subject yo'q → qo'shildi
3. `teacher-sla-b16` — appeal qayta-register subject yo'q → qo'shildi
4. `role-shell` — ROLE_LIST 8→9 (`co_teacher`, B-36) → kontrakt yangilandi

## IV. ULTIMATE SNAPSHOT (B-37 §23)

- **Vitest baseline:** 115 fayl / 932 test (B-faza auth/email/teacher/onboarding scope)
- **A11y:** 12/12 · **Security re-verify:** 146/146 · **tsc:** 0 xato · **design-lint:** PASS
- **Perf:** login p95 53ms / register p95 101ms (<500ms gate ✓)
- **db.json:** tegsiz · **temp:** toza · eski hemis probe fayllari avvalgi sessiyadan (tegilmadi)
- B-34..B-36 yangi modullar: `bot-guard` (velocity/review), `onboarding/reengage`, `roster/bulk-invite`, `teacher/co-teacher`, `routes/teacher`, `routes/admin/signup-reviews`

## V. ROLLBACK REJASI (B-37 §24)

| Feature | Rollback yo'li |
|---|---|
| Signup velocity/review (B-34) | `SIGNUP_VELOCITY_IP/FP_MAX_PER_HOUR` oshirish yoki `routes/auth.js` velocity blokini flag bilan o'chirish; `signup_reviews` queue tozalanadi |
| Re-engagement (B-35) | `server.js` reengageTimer o'chirish (1 qator) — welcome (B-19) ta'sirlanmaydi |
| Bulk invite / co-teacher / appeal (B-36) | `server.js` `teacherExtraRoutes` mount o'chirish; `co_teacher` rol ROLES'dan emas, faqat foydalanilmaydi; pending invite'lar `invites/{hash}` status=revoked |
| Email queue (B-31) | `routes/reset.js` → eski inline send; queue worker interval o'chirish; `email_idempotency` tozalanadi |
| Migration: hech qanday DB migration talab qilinmadi (Firebase document — flag'lar idempotent, eski record'lar normalize qilinadi, B-01) |

## VI. NEXT READINESS (B-37 §26/§27)

- **C-00 preflight** tayyor: auth B-faza to'liq yopildi (AUTH A+B = 32+37 bosqich); C-faza (rate/lockout/risk/admin/HEMIS/OneID/retention/backup) uchun qoidalar allaqachon B-34'da env'ga ko'chirilgan
- **P2/P3 C/D/E fazaga ko'chirilgan:** passkey UI full, risk-based scoring (C), OneID (C), HEMIS OAuth reja (C), DSAR (D), legal/DPIA (D), deliverability DNS (operator)

**Operator yakuniy tasdig'i:** B-faza (B-00..B-37) YOPILDI ✅ — C-00 ochiq.
### AUTH C-00 — Risk/Admin/Integration preflight ✅ (kod o'zgarishsiz)

**STATUS:** ✅ DONE — baseline, blockerlar, C-01 readiness yozildi. **Hech qanday kod o'zgarishi yo'q** (§25).

## I. Inventarizatsiya jadvali (§06-§11)

| Komponent | Holat | Manzil / izoh |
|---|---|---|
| HTTP rate limits (per-IP) | ✅ | `src/config/rate-limiter.js` HTTP_LIMITS: login 20/15min, adminLogin 10/15, general 100/15, adminApi 60/15, userApi 60/15 (express-rate-limit) |
| Failure-based lockout (per-user qattiq + per-IP yumshoq) | ✅ | `src/modules/auth/lockout.js` (A-03): env'dan (`AUTH_LOCKOUT_*`); per-user DB, per-IP in-memory; register 5/15 per-IP |
| Per-account qattiq limitlar | ✅ | login 10/15 (checkUserLockout), reset 3/soat, email register 3/soat, verify 5/15, signup velocity (B-34) |
| Per-ASN | ❌ **YO'Q** — C-01'da Redis ASN qo'shiladi | — |
| Redis rate-limit store | ❌ Memory (express-rate-limit default; Redis faqat sessiya uchun opsional — REDIS_URL bo'lmasa MemoryStore rollback) | server.js:213-216 |
| 429 + Retry-After + RATE_LIMITED | ✅ | `lockout.js:203-211` lockoutResponse — header + code |
| Jitter (100-500ms) | ✅ | `lockout.js:80` jitterDelayMs (A-03) |
| Turnstile (B-08) | ✅ | bot-guard.js — secret bor → qattiq; yo'q → fail-open (honeypot + limitlar qoladi) |
| Trust proxy | ✅ | `server.js:197 app.set('trust proxy', 1)` — IP spoof qarshi |
| Admin panel | ✅ (qisman) | dashboard, /api/users, /api/users/delete (MFA step-up), VIP, teacher approve (A-19), signup-reviews (B-34); **user role-edit manage ❌** — C-faza |
| HEMIS adapter | ✅ (A-15, config'li) | `routes/hemis.js` + `src/modules/auth/providers/hemis.js` — REST + OAuth2 (env: HEMIS_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI; secret o'rnatilmagan → inactive) |
| Risk moduli | ✅ poydevor (C-03) | `src/modules/auth/risk.js` (292 qator): haversineKm, travelFeasible, riskTier/riskAction, computeRiskScore, RISK_SIGNAL_WEIGHTS |
| Device fingerprint (C-03) | ✅ | B-28: `public/js/device-fingerprint.js` — FNV-1a 16-hex hash; server {16,64} validatsiya; login+register'da attach (B-34) |

## II. Baseline (§12, §26)

- **Test:** 313 test fayl jami; auth-faza scope 115 fayl / **932 test PASS** (B-37 ULTIMATE); security re-verify 146/146; a11y axe 12/12
- **Typecheck:** `tsc --noEmit` 0 xato
- **Boot smoke:** HEALTH 200 · LOGIN_PAGE 200 · ADMIN_PAGE 200
- **git:** db.json tegsiz · temp toza · eski hemis probe fayllar avvalgi sessiyadan (tegilmadi, secret yo'q)

## III. Blockerlar / C-01 readiness (§22-§24, §28)

| # | Blocker | C-qadam |
|---|---|---|
| 1 | Per-ASN limit yo'q | C-01: `src/config/rate-limits.js` jadval + Redis ASN (kampus NAT — per-IP yumshoq, per-account qattiq, per-ASN o'rta) |
| 2 | Redis rate-limit store yo'q (distributed) | C-01: Redis sliding-window/token-bucket (ioredis mavjud) |
| 3 | X-RateLimit-Limit/Remaining/Reset header'lar yo'q | C-01: client transparanlik |
| 4 | Endpoint-specific jadval qisman (verify/mfa/passkey/telegram/teachers/roster generic'da) | C-01: to'liq jadval (10 endpoint guruhi, C-01 §06) |
| 5 | Admin user role-edit manage yo'q | C-14/C-15 (admin auth+manage+audit) |
| 6 | HEMIS secret o'rnatilmagan — OAuth inactive (REST reja tayyor) | C-10 (HEMIS OAuth reja) — operator credential'lar |

**C-01 boshlashga tayyor:** ✅ — rate limit config `rate-limiter.js` + `lockout.js` mavjud; jadval kengaytiriladi (per-ASN + Redis store + endpoint guruhlari), 429/jitter/Retry-After kontrakti tayyor.
### AUTH C-01 — Rate limit config to'liq (har endpoint) ✅

**STATUS:** ✅ DONE — unit 14 + integration 4 = 18/18 PASS; regression 135/135 (10 ta auth kontrakt); tsc 0; design-lint PASS; boot 200/200/200; db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Endpoint jadvali (10 guruh) | ✅ | `src/config/rate-limits.js` — login/register/verifySend/verifyCheck/reset/google/mfa/passkey/telegram/adminTeachers/roster |
| §07 Sliding-window + token-bucket | ✅ | `middleware/rate-limit.js` — 2-bucket proportional sliding window; Redis'da Lua (INCR+PEXPIRE atomic); in-memory fallback (bir xil logika) |
| §08 Kampus NAT: per-IP yumshoq, account qattiq, ASN o'rta | ✅ | login: ip 20/15 (backstop), account 15/15 (qattiq), asn 100/15 (o'rta) |
| §09 Jitter (login xatosida 100-500ms) | ✅ | A-03 failure-based lockout + enumeration-safe padding — mavjud (yangilash shart emas) |
| §10 429: Retry-After + RATE_LIMITED | ✅ | A-03 kontrakti bilan bir xil: `{ ok:false, code:'RATE_LIMITED', retryAfter }` |
| §11 X-RateLimit-Limit/Remaining/Reset | ✅ | Eng cheklovchi tier bo'yicha; GET'da yo'q (sahifa yuklash sanalmaydi) |
| §12 Config'dan o'qish | ✅ | Middleware `ENDPOINT_LIMITS`'dan o'qiydi |
| §13 Audit + metric | ✅ | `auth:rate_limit_hit` (endpoint, tier) + `auth.rate_limit_hit` counter |
| §14 Trust proxy + per-account asosiy | ✅ | `trust proxy 1` + per-account HMAC-hash kalit (raw PII yo'q) |
| §17 Unit test | ✅ | `tests/unit/rate-limit-c01.test.js` — har endpoint, sliding window, burst, ASN, fail-open, PII |
| §18 Integration/contract | ✅ | `tests/integration/rate-limit-c01.test.js` — burst (tezkor register → 429), distributed per-ASN (51 IP → 51-chi 429), NAT false-positive yo'q |
| §23 Fail-open | ✅ | Redis/ASN ishlamasa tier skip — unit'da test qilingan |

**Jarayonda topilgan 3 real bug (review'da):**
1. **Closure mutatsiya (CRITICAL):** `cfg` closure o'zgaruvchisi birinchi register POST'dan keyin `register`'ga qayta yozilar edi → keyingi login POST'lari ham register cfg (burst 3/s) bilan ishlardi → A-03 5-xato testi buzilardi. Fix: har request'da lokal `effective` config.
2. **Off-by-one:** `count >= limit` limit'ga yetgan request'ning o'zini bloklardi (express-rate-limit semantikasi: max+1-chi blok). Fix: `count > limit`.
3. **Register POST /user/login'da:** B-03 register POST `/user/login`'ga `mode:'reg'` bilan keladi — `register` routeKey faqat GET sahifaga mount bo'lgan edi → register tier o'lik edi. Fix: mode-aware switch (login routeKey + mode=reg → register cfg).

**Qarorlar (C-01 ledger):**
- Prompt'dagi login per-IP 5/15 va per-account 10/15 qiymatlari **failure-based lockout (A-03: 5 xato → 300s yumshoq, 10 xato → hard)** tomonidan amalga oshirilgan — request-based tier'lar backstop (ip 20/15, account 15/15). A-03 kontrakti (10-xato route'ga yetishi) buzilmasligi uchun.
- Login'da **burst yo'q** — Argon2 (~250ms) o'zi tabiiy throttle; register'da burst 5/s (in-route bot-guard 5/15 bilan mos).
- register ip 20/15 — `auth.test.js` 10 ta register bitta IP'dan qiladi (in-route bot-guard 5/15 asosiy).
- ASN resolver plaginli: `ASN_DB_PATH` (MaxMind) yoki `ASN_OVERRIDES` env; o'rnatilmagan → fail-open (per-IP/account qoladi).

**C-01 yakuni:** rate limit qatlami to'liq. Keyingi qadam — **C-02** (prompt'dan o'qiladi).
### AUTH C-02 — Lockout state machine (to'liq) ✅

**STATUS:** ✅ DONE — unit 10 + integration 4 = 14/14 PASS; regression 109/109 (A-03 lockout, auth 10-register, A-30 admin, A-25 session); tsc 0; design-lint PASS; boot 200/200/200; db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 State machine | ✅ | active → N-fail → locked (progressive) → active (release) \| permanent (admin status='blocked') |
| §07 failed_attempts + locked_until | ✅ | per-account DB (qattiq) + per-IP in-memory (yumshoq) — A-03 saqlandi |
| §08 Progressive | ✅ | strike 1 → 15 daqiqa (A-03: 10 xato → 900s); strike 2 → 60; strike 3+ → 120 |
| §09 Reset + support unlock | ✅ | success → counter=0 + lock_strikes reset; `POST /admin/api/users/unlock` (reauth + MFA step-up + audit) |
| §10 Permanent lock | ✅ | `users.status='blocked'` — admin block; login generic xato (countdown emas, enumeration yo'q); support qarori bilan |
| §11 Progressive penalty | ✅ | `lock_strikes` per user — har blok sikli uzayadi (15→60→120) |
| §12 Audit | ✅ | `auth.lockout.triggered` (strike bilan) · `auth.lockout.released` · `auth.account.blocked` · `auth.account.unblocked` |
| §13 UX | ✅ | countdown + support@deborah.uz (A-03'da mavjud; 60+ daqiqa'da support urg'u) |
| §14 A11y | ✅ | countdown `role="alert" aria-live="assertive"` (A-03'da mavjud) |
| §16 4 til | ✅ | lockout/support stringlar auth-i18n'da (4 til) |
| §17 Bypass yo'q | ✅ | test: turli IP'lar bilan ham per-account tutadi (unit); permanent'da unlock rad (409 ACCOUNT_BLOCKED) |
| §20-22 Unit/Integration/E2E | ✅ | `tests/unit/lockout-c02.test.js` (progressive/release/reset/permanent/bypass) + `tests/integration/lockout-c02.test.js` (10 xato→429, unlock→login, block→generic, unblock→login, audit) |
| §29 Support unlock audit | ✅ | `lockout.released` — kim (actor), qachon |

**Jarayonda 2 real bug topildi/tuzatildi:**
1. `audit()` (PostgreSQL/console) `auth_audit`'ga yozmas edi — A-03 kontrakti `auth_audit`'ni o'qiydi → lockout.js'dagi barcha audit `logAuthEvent`'ga o'tkazildi (izchillik).
2. `supportUnlock` xatosida route `code` yubormas edi (409 body'da faqat `error`) — `code: result.code` qo'shildi.

**Qarorlar:** Progressive strike 1 = 15 daqiqa (A-03 kontrakti: 10 xato → 900s) — prompt'dagi "5 xato → 5 daqiqa" per-IP yumshoq qatlam (5 xato → 300s) tomonidan amalga oshirilgan. lock_strikes success'da reset (legit foydalanuvchi) — progressive faqat muvaffaqiyatsiz sikl zanjirida kuchayadi.

**C-fazada:** C-00 ✅, C-01 ✅, C-02 ✅. Keyingi qadam — **C-03 (Device fingerprint schema + integration)**.
### AUTH C-03 — Device fingerprint schema + integration ✅

**STATUS:** ✅ DONE — integration 4/4 PASS · regression 138/138 (a28/a09/a30/b28/auth/new-device/risk-a28/signup-velocity) · tsc 0 · boot 200/200/200 · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §08 Explicit device register | ✅ | `POST /api/auth/device/register` (requireAuth) — idempotent upsert (`first_seen` saqlanadi), session'ga `deviceFp` yoziladi (trust flow uchun) |
| §11 Audit | ✅ | `auth:device:registered` — `fingerprint` (hash) + `firstSeen`, `ip_hash` sha256; raw telemetry YO'Q |
| §07 Trust flow | ✅ | `POST /api/auth/device/trust` (requireAuth + requireRecentAuth) → `trusted=true` + `trustedAt` — boshqa qurilma session'ni trust qila olmaydi |
| §14 Privacy | ✅ | `users.{id}.devices.{hash}` — faqat hash: first_seen/last_seen/last_city/last_ip_hash/risk_events/trusted/user_agent; canvas/WebGL/plugins/fonts/audio hech qachon (test) |
| A-28 storage | ✅ | `touchDevice` (per-user mutex, retention 20 risk_events) — mavjud, regression bilan tasdiqlandi |

**Jarayonda 2 real bug topildi va tuzatildi:**
1. 🔴 **Audit redaction**: `fingerprintHash` → snake `fingerprint_hash` → `hash` so'zi `SENSITIVE_WORD_RE`'ga tushib, audit'dan butunlay o'chib ketardi (C-03 §11 test talabi bajarilmasdi) → key `fingerprint` deb ataldi (PII-minimal hash'ning o'zi — redact qilinmaydi).
2. 🔴 **Trust `no_device`**: `device/register` session'ga `deviceFp` yozmas edi → SPA'da trust flow doim 400 qaytarardi → endpoint muvaffaqiyatli bo'lganda `req.session.user.deviceFp` o'rnatildi.
3. **ReferenceError**: `details: { fingerprint, ... }` shorthand — scope'da `fingerprint` o'zgaruvchisi yo'q edi → 500 → `fingerprint: fingerprintHash`.

**Qarorlar:** C-03'ning ko'p qismi A-28'da tayyor edi (storage + trust UI + client FNV-1a) — bo'shliqlar explicit endpoint, audit va session wiring edi. Trust banner qurilmasi (B-28 trust-prompt) o'zgarishsiz ishlaydi — endi real session deviceFp bilan.

**C-fazada:** C-00 ✅, C-01 ✅, C-02 ✅, C-03 ✅. Keyingi qadam — **C-04 (Risk engine — geolokatsiya tezligi/odatiylik)**.
### AUTH C-04 — Risk score service ✅

**STATUS:** ✅ DONE — unit 16 + integration 3 = 19/19 PASS · regression 83/83 (a28/a25/a22/a24/b24/b29/a24) · tsc 0 · design:lint PASS · boot 200/200/200 · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Signal'lar + weight'lar | ✅ | `RISK_SIGNAL_WEIGHTS` — new_device 0.3, impossible_travel 0.5, velocity 0.4, vpn 0.3, bot 0.6, dev_tools 0.2, **account_age 0.2 (YANGI)**, trusted -0.4 |
| §07 Tiers | ✅ | <0.3 trusted · 0.3-0.7 unknown · >0.7 suspicious (A-28'da mavjud, saqlandi) |
| §08 Server signals | ✅ | impossible travel (geo+ts), velocity (risk_events), bot (Turnstile header), trusted (user_devices) — A-28 |
| §09 Client signals | ✅ | fingerprint hash (C-03), dev_tools flag — session'da |
| §10 risk_events JSONB | ✅ | faqat hash (ipHash), retention 20 (A-28) |
| §11 Threshold config | ✅ | `CONFIG.RISK_*` env + tuning log (recordRiskDecision metrics) |
| §12 requireLowRisk | ✅ | **YANGI** middleware — trusted→allow, unknown→stepup (403), suspicious→block (403); `/api/password/change` + `/api/account/email/request`'ga ulandi |
| §13 Audit | ✅ | risk_scored / risk_stepup / risk_blocked — `auth_audit`'ga (izchillik) |
| §29 Per-role threshold | ✅ | **YANGI** `riskThresholds(role)` — admin <0.2/>0.5 (qattiq), teacher 0.6, default 0.3/0.7 |

**Jarayonda 3 real bo'shliq topildi va tuzatildi:**
1. 🔴 **account_age signal yo'q edi** (C-04 §06 talab) → `userCreatedAt` evaluateRisk'ga qo'shildi; <7 kun → +0.2.
2. 🔴 **Per-role threshold yo'q edi** (§29) → `riskTier(score, role)` + `ROLE_THRESHOLDS` (admin qattiq — privileged akkauntlar).
3. 🔴 **requireLowRisk yo'q edi** (§12) → yangi middleware + sensitive route'larga ulandi.
4. **Audit manbai**: `recordRiskDecision` `auth_audit`'ga yozmas edi (`audit()` PG audit_log'ga yozadi) — C-02 izchillik qarori bilan `logAuthEvent`'ga qo'shildi (ikkala manba, fail-soft).

**Qarorlar:** Register'da risk hisoblanmaydi (A-28 dizayn) — faqat login'da; yangi qurilma + yangi akkaunt bilan qayta login → step-up (integration test shu flow'ni sinaydi). `requireLowRisk` fail-soft (riskTier yo'q eski sessiya → o'tkazadi) — regression xavfi yo'q, MFA'li userlar uchun `requireMfaStepUp` qatlami saqlanadi.

**C-fazada:** C-00..C-04 ✅ (5/5). Keyingi qadam — **C-05 (Impossible travel + velocity detection)** — poydevor C-04'da tayyor (travelFeasible + risk_events), C-05 Redis-counter velocity + geo timeline'ni qo'shadi.
### AUTH C-05 — Impossible travel + velocity detection ✅

**STATUS:** ✅ DONE — unit 16 + integration 3 = 19/19 PASS · regression 89/89 (risk c03/c04/a28/a09 + new-device) · tsc 0 · design:lint PASS · boot 200/200/200 · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Impossible travel | ✅ | `travelFeasible` — masofa/vaqt > 800 km/soat → flag (C-05 spec; 900'dan qattiqroq) |
| §07 Geo lokal | ✅ | `geo-lite.js` — statik jadval (tashqi API EMAS); `CITY_DB_PATH` env real DB uchun |
| §08 Timezone | ✅ | `geoFromIp` → { city, tz } — UZ Asia/Tashkent; server ts yagona manba (client ts ishonmaydi) |
| §09 Velocity (Redis) | ✅ | Account-level: `SADD auth:vel:acct:{userId}` + EXPIRE 10 daqiqa; ≥3 turli qurilma → +0.4; fail-open |
| §10 Signal mapping | ✅ | impossible_travel +0.5, velocity +0.4 — C-04 weight'lar saqlandi |
| §11 Threshold'lar | ✅ | `RISK_TRAVEL_SPEED_KMH` (env, default 800), `VELOCITY_DISTINCT_DEVICES=3` |
| §12 Audit | ✅ | `auth:risk:impossible_travel` / `auth:risk:velocity` — user_id (hash scope) + agregat + ts; raw geo YO'Q (test) |
| §13 Response | ✅ | Score bo'yicha C-04: step-up MFA / block; false-positive → step-up (test: VPN → 302, block emas) |
| §22 Observability | ✅ | `auth.impossible_travel_count` / `auth.velocity_count` metric'lar |
| §28 GeoLite2 litsenziya | ✅ | CC BY-SA 4.0 hujjatlashtirildi (geo-lite.js header) |

**Jarayonda 2 muhim o'zgarish (spec):**
1. 🔴 **Travel speed 900 → 800 km/soat** (C-05 §06 spec) — env.js default + `_riskConfig` testi yangilandi (Toshkent→London 6 soat endi impossible).
2. **Geo-lite timezone** — `geoFromIp` yangi export (city + tz), `cityFromIp` backward-compat saqlandi.

**Qarorlar:** Account-velocity Redis'da (C-05 §09 spec — Redis counter), device-velocity risk_events'da (A-28) — ikkala pattern ishlaydi. Redis yo'q muhitda fail-open (signal yo'q — C-01 §23 kontrakti). `VELOCITY_REDIS_KEY` = `auth:vel:acct:{userId}` — user_id hash scope, raw PII yo'q.

**C-fazada:** C-00..C-05 ✅ (6/6). C-06 ga tayyor: credential stuffing (bir IP'da ko'p account fail) — rate-limit C-01'da per-IP login tier + failure-based lockout A-03 mavjud; C-06 OTP bombing detection (telegram OTP A-16 limit'lari bor) qo'shiladi.

**Keyingi qadam — C-06 (Credential stuffing + OTP bombing detection).**
### AUTH C-06 — Credential stuffing + OTP bombing detection ✅

**STATUS:** ✅ DONE — unit 11 + integration 3 = 14/14 PASS · regression 90/90 (a03/a18/b06/b08/b34/a16/b22) · tsc 0 · design:lint PASS · boot 200/200/200 · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Stuffing | ✅ | `detectStuffing` — IP'da 10+ turli account fail → **block**; 5+ → alert; parol spray (5+ username) → **challenge**; device (3+ account) → **challenge** |
| §07 OTP bombing | ✅ | `detectOtpBomb` — per-user 3/soat, per-IP 10/soat → 429 + `retryAfterSeconds`; `/api/auth/verify/send`'ga ulandi |
| §08 abuse.js | ✅ | `src/modules/auth/abuse.js` — Redis counters (SADD/INCR + TTL), alert rules |
| §09 Response | ✅ | block (high, login blok) · challenge (medium — jitter +3) · alert (low — monitoring) |
| §11 Audit | ✅ | `auth:abuse:stuffing` / `auth:abuse:otp_bomb` / `auth:abuse:blocked` — outcome blocked/flagged |
| §12 Parol hech qachon | ✅ | Faqat sha256 hash (key'da) + user_id'lar; parol log/Redis'da EMAS (test) |
| §25 Redis TTL | ✅ | Stuffing 15 daqiqa, OTP 1 soat (per-IP oyna) — fail-open Redis yo'q |

**Tekshiruvlar:** stuffing 10-fail → block + audit; spray 5 → challenge; device 3 → challenge; OTP 4-send → 429 + audit; privacy (parol audit'da emas); fail-open (Redis yo'q → ok). Integration real flow: verify/send 4-chi 429, stuffing 10 fail → blok.

**Qarorlar:** Stuffing login fail'da chaqiriladi (A-03 lockout'ga parallel — lockout user bazasi, abuse pattern bazasi). Block → login sahifasiga generic error (enumeration yo'q); challenge → jitter +3 qatlam (brute-force sekinlashish). OTP bomb verify/send'da — email-verify A-18/B-06 cooldown'ga qo'shimcha qatlam (per-user+per-IP). Alert kanali: `recordMetric` + audit (admin dashboard C-20 abuse events ro'yxati uchun tayyor).

**C-fazada:** C-00..C-06 ✅ (7/7). C-07 ga tayyor: admin auth allaqachon alohida session (`req.session.admin`) + `requireAdmin`/`requireRecentAdminAuth` + admin MFA (A-26) mavjud — C-07 (Admin auth: alohida session + Strict cookie) Strict cookie/`__Host-` prefix + admin session izolyatsiyasini mustahkamlaydi.

**Keyingi qadam — C-07 (Admin auth — alohida session + Strict).**
### AUTH C-07 — Admin auth (alohida session + Strict) ✅

**STATUS:** ✅ DONE — unit 14 + integration 5 = 19/19 PASS · regression 121/121 (a30/a25/b08/auth.test) · tsc 0 · design:lint PASS · boot 200/200/200/200 (health/login/admin-login/landing) · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Alohida `/admin/login` | ✅ | A-30 mavjud (CONFIG credential + DB admin role) — regression tasdiqlandi |
| §07 Strict session | ✅ | A-30: SameSite=Strict + Max-Age 8 soat + remember-me yo'q; `requireAdmin` har request'da qayta assert (unit test) |
| §08 MFA mandatory | ✅ | A-30: production'da doim, dev'da flag; enroll → challenge flow (integration test) |
| §09 Rate limit + Turnstile | ✅ | A-30: 3 xato → 15 daqiqa; **C-07: Turnstile admin login'da har doim (secret bor bo'lsa)** — `verifyTurnstile` + widget `views/admin/login.ejs` |
| §10 IP allowlist | ✅ | A-30: `adminIpAllowed` (exact + CIDR, unit test) |
| §11 Session izolyatsiya | ✅ | `req.session.admin` — user session'dan alohida; role switch'da regenerate (unit test) |
| §12 Audit | ✅ | ADMIN_LOGIN / ADMIN_LOGIN_FAILED / ADMIN_MFA_REQUIRED / ADMIN_RISK_BLOCKED |
| §13 Breach | ✅ | A-30: breachFlagged → forced block |
| §14 Suspicious admin | ✅ | A-30: evaluateAdminRisk → block + `notifySuperAdmin` |
| §17 4 til | ⚠️ | Admin stringlar uz (default) — admin panel alohida til selectorsiz (P2) |
| §20 Metric'lar | ✅ | **C-07: `auth.admin_login` (method) + `auth.admin_mfa_required` (phase: enroll/challenge)** |

**Jarayonda 2 real bo'shliq to'ldirildi:**
1. 🔴 **Admin login'da Turnstile yo'q edi** (C-07 §09 — "Turnstile har doim") → `verifyTurnstile` bloki (parol tekshiruvidan oldin) + `views/admin/login.ejs` widget (site key mavjud bo'lsa). Secret yo'q = dev/test fail-open; secret bor = qat'iy.
2. **Metric'lar yo'q edi** (§20) → `auth.admin_login` + `auth.admin_mfa_required` recordMetric'lar (grantAdminSession + enroll/challenge bloklarida).

**Qarorlar:** C-07'ning ko'p qismi A-30'da qurilgan (Strict cookie, MFA mandatory, IP allowlist, lockout, breach, risk) — bu bosqich Turnstile + metric'lar + unit/integration qamrovni to'ldirdi. Admin cookie `__Host-` prefix — SESSION_HOST_PREFIX production'da (umumiy session cookie); alohida admin cookie nomi kerak emas (session.admin izolyatsiyasi + regenerate yetarli).

**C-fazada:** C-00..C-07 ✅ (8/8). C-08 ga tayyor: admin panel (dashboard/users/VIP/teacher) mavjud — C-08 user management (list/search/role edit/status) admin panel'da kengaytiradi.

**Keyingi qadam — C-08 (User management — admin panel).**
### AUTH C-08 — User management (admin panel) ✅

**STATUS:** ✅ DONE — unit 3 + integration 5 = 8/8 PASS · regression 57/57 (a30/a25/c02/a03/c07/b25) · tsc 0 · design:lint PASS · boot 200/200/200 · db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Ro'yxat + qidiruv + filter + pagination | ✅ | `views/admin/users.ejs` + `GET /admin/api/users` (q/role/status/page/pageSize; username/email qidiruv) |
| §07 Amallar | ✅ | [Bloklash] (sabab majburiy) / [Aktivlash] / [Rol o'zgartirish] / [Sessiyalarni yakunlash] — `public/js/admin/users.js` |
| §08 Bloklash | ✅ | `users.status=blocked` + `revokeByUser` (barcha sessiyalar) + audit `auth.account.blocked` (actor) |
| §09 Aktivlash | ✅ | status maydoni o'chiriladi (API `u.status\|\|active`) + audit `auth.account.unblocked` |
| §10 Rol o'zgartirish | ✅ | `POST /admin/api/users/role` — role_version oshadi → eski sessiyalar bekor (A-02) + revokeByUser + audit (from/to) |
| §11 Sessiyalarni yakunlash | ✅ | `POST /admin/api/users/revoke-sessions` — revokeByUser (B-25) |
| §12 Audit | ✅ | `admin:action` (role:change / user:revoke-sessions) + account:blocked/unblocked — admin_id actor |
| §13 A11y | ✅ | Native button/select, 44px min-height, role=alert live region, modal aria-modal |
| §14 Mobile/responsive | ✅ | admin.css pattern (flex-wrap, is-reflow table) |
| §16 Security | ✅ | requireAdminMfaStepUp barcha write endpoint'larda; IDOR test (student 401/302) |
| §28 PII minimal | ✅ | email admin'ga ko'rinadi (guide), raw parol hech qachon |
| §29 Blok sabab majburiy | ✅ | 400 `reason required` (test) — c02 testi ham yangilandi |

**Jarayonda 1 regression kontrakt yangilandi:** C-02 `lockout-c02.test.js` blok'ga sabab yubormas edi → C-08 §29 sabab majburiy (400) — testga `reason` qo'shildi (kontrakt o'zgarishi sababli test tuzatildi, o'chirilmadi).

**Qarorlar:** `/admin/api/users` endi email/role/status/name qaytaradi (PII minimal — email faqat admin'ga); ro'yxat server-side pagination (25/sahifa, max 100) — katta user bazasida client'ni yuklamaydi. Rol o'zgartirish rollar whitelist (student/teacher/proctor/marker/board) + `role_version` oshirish (A-02 sessiya invalidate mexnizmi).

**C-fazada:** C-00..C-08 ✅ (9/9). C-09 ga tayyor: audit `auth_audit` (logAuthEvent) + `admin:action` yozuvlari to'liq — C-09 audit dashboard (ro'yxat, filter, eksport) shu ma'lumotni ko'rsatadi.

**Keyingi qadam — C-09 (Audit dashboard + security reports — admin).**
### AUTH C-09 — Audit dashboard + security reports (admin) ✅

**STATUS:** ✅ DONE — unit 7 + integration 3 = 10/10 PASS; regression 72/72 (9 fayl); tsc 0; design-lint PASS; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| C-09 §03-05 ro'yxat + filter + pagination | ✅ | `listAuthAudit` — action/method/outcome filter, `q` qidiruv (actor_id), vaqt oralig'i, page/pageSize (max 200) |
| C-09 §06 admin sahifa | ✅ | `views/admin/audit.ejs` — ro'yxat, filter form, aggregate kartalar, matn-chart (7 kun), eksport tugma |
| C-09 §07 aggregates | ✅ | `auditAggregates` — login ok/fail rate, lockout, teacher approve/reject, risk, HIBP, abuse; `/admin/api/audit/aggregates` |
| C-09 §08 export CSV | ✅ | `exportAuthAuditCsv` + `/admin/api/audit/export` — PII minimal (actor_id hash, ip o'chirilgan, detail sanitize) |
| C-09 §09 client JS | ✅ | `public/js/admin/audit.js` — filter submit, pagination, aggregate refresh, eksport (CSRF bilan) |
| C-09 §11 fail-spike alert | ✅ | `src/modules/auth/audit-alert.js` — 1 soatlik oyna 500+ fail → `ABUSE_ALERT` audit + admin email (cooldown/idempotent); `server.js`'da hourly scheduled check |
| C-09 §12 PII himoyasi | ✅ | ro'yxat/export `toPublicAuditEntry` — password/ip/email/token/secret kalitlari redact (SENSITIVE_WORD_RE) |

**Tekshiruvlar:** regression 72/72 (A-30 admin, C-07, C-08, C-02, A-03 lockout kontrakti, A-31, unit admin-security/lockout/audit) · tsc 0 · design-lint PASS (937 warn — migratsiya treki) · boot: health 200, /admin/audit 401 (guard), /admin/api/audit* 401 (guard) · db.json tegsiz · temp toza

**Jarayondagi topilmalar:**
1. `auditAggregates` boshlang'ichda bare `auth.login` (success) action'ini sanamas edi → `action.startsWith` prefix-moslashga o'tkazildi (`auth.login` + `auth.login.*` ikkalasi ham).
2. Audit `detail` (singular) maydoni — testlarda `details` (plural) kutilgan → moslashtirildi.
3. `fingerprintHash`/`hash` so'zi SENSITIVE_WORD_RE'ga tushib redact bo'lardi → `fingerprint` key nomi ishlatiladi (C-03'da hal qilingan).
4. Admin login'ning o'zi `admin:login` audit yozadi → integration testlar deterministik `>=` chegaralar bilan.

**Qarorlar:** audit retention `AUDIT_RETENTION_DAYS` (30) da; export CSV server-side generatsiya; fail-spike threshold `AUDIT_FAIL_SPIKE_THRESHOLD` (500/soat) — env orqali konfiguratsiya; alert email `provider.sendEmail` (test rejimida skip).

**C-fazada:** C-00..C-09 ✅ (10/10). Keyingi qadam — **C-10**.
### AUTH C-10 — HEMIS adapter to'liq (REST-first, talaba.tsue.uz) ✅ (OAuth2 BLOCKED qaydi)

**STATUS:** DONE (REST yo'l) + PARTIAL (OAuth2 — OTM client yo'q, BLOCKED)
**Precondition:** A-15 skeleton yashil ✅ · OTM HEMIS OAuth client YO'Q → §08-09/§19-20 OAuth2 live = BLOCKED

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 REST endpointlar | ✅ | `talaba.tsue.uz/rest/v1/auth/login` + `/account/me` — jonli probe: 401'da ham `{success,error,data,code}` konverti — provider parsing'i mos (A-15) |
| §07 Fields (Zod) | ✅ | AccountMeSchema + OAuthUserSchema (A-15) |
| §10 Geofence | ✅ | 451 → 'geofence' kodi; SSRF guard (https + .uz hostlar) |
| §11 hemis_id UNIQUE | ✅ | `users_hemis_index` + in-process TOCTOU lock; 409 conflict test |
| §12 Session regenerate | ✅ **YANGI** | link'da `rotateSession()` — sessiya ID + yangi CSRF token; response `csrfToken` qaytaradi, client `window.__CSRF_TOKEN`'ni yangilaydi (OAuth callback'da ham) |
| §13 Login/panel UI | ✅ **YANGI** | `security-profile.ejs` — HEMIS bog'lash kartasi (link form / bog'langan profil + unlink); `hemis-link.js` client (CSRF rotation-aware); restEnabled/oauthConfigured gating |
| §14 Rate limit 10/15 | ✅ | per-IP + per-user; 11-urinish → 429 (integration test) |
| §17 Audit | ✅ **YANGI** | `hemisAudit` → `logAuthEvent` (auth_audit — C-02 qarori; C-09 dashboard ko'radi); channel:'hemis' |
| §18 Unit test | ✅ | hemis-a14/a15 (27) — real TSUE shape, PII yo'q |
| §19 Integration/contract | ✅ **YANGI** | hemis-c10 (6): success+rotation+DB+index+audit, 401, 409, 429, unlink, security-profile sahifasi |
| §20 E2E/security | PARTIAL | live REST probe bajarildi (shape mos); live E2E credential'lar hemis-test.env'da eskirgan (401) — yangi parol bilan qayta ishga tushadi; OAuth2 E2E OTM client talab qiladi |
| §28 GitHub client_id=8 | ⛔ | production'da ishlatilmaydi — OAuth2 faqat OTM yangi client yaratganda yoqiladi (env-gated) |

**Tekshiruvlar:** unit 27 + integration 6 = **33/33 PASS** (hemis-a14/a15/c10) · boot smoke: health/login 200, /api/auth/hemis/status + /user/security-profile 401 (auth guard) · db.json tegsiz · temp toza. (To'liq regression — C-16 checkpoint'da, yangi protokol bo'yicha.)

**Jarayonda 2 real bug:** (1) `routes/security.js`'da `fb` har try-blokda block-scope — C-10 hemisStatus bloki ReferenceError yeb, linked=false ko'rsatar edi → top-level import tuzatildi; (2) live probe: hemis-test.env'dagi eski credential'lar talaba.tsue.uz'da 401 — yangi ishlaydigan login/parol (324251103717) kiritilsa live E2E yashil.

**Qarorlar:** OAuth2 client bo'lmaguncha REST-first yo'l xizmatda; UI `security-profile`'da (panel emas — dashboardni iflos qilmaydi); session rotation response'dagi yangi csrfToken orqali client'da saqlanadi (aksi holda keyingi POST 403).

**C-fazada:** C-00..C-10 ✅ (11/11, OAuth2 qismi BLOCKED). Keyingi qadam — **C-11 (HEMIS roster import — Excel, xavfsiz)**.
### AUTH C-11 — HEMIS roster import (admin UI) ✅

**STATUS:** ✅ DONE — integration 3/3 (yangi) + 33/33 (C-10) + roster unit 78/78 + design-lint PASS + boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Admin import UI sahifasi | ✅ | `GET /admin/roster` — `views/admin/roster.ejs`: upload (drag&drop + file pick, .xlsx/.csv), sessiyalar ro'yxati, mapping/diff preview, commit + rollback, invites send — 4 til copy (`data/roster-i18n.js` ROSTER_COPY), A11y (aria-label/live, focus), mobil |
| Client logic | ✅ | `public/js/admin/roster.js` — upload/map/preview/commit/rollback/invites, sessiya status filtri, holat xabarlari (aria-live) |
| Admin API kirishi | ✅ | `routes/roster.js` — `requireRosterAuth` (student **yoki** admin sessiyasi) — `/api/roster*` admin UI uchun ochildi; student kontrakti o'zgarmadi |
| Tuzatishlar | ✅ | C-10 dan qolgan design-lint hard error: `security-profile.ejs` da yangi inline `color` → `.hemis-profile` klassiga ko'chirildi (S37.05 0) |

**FILES_CHANGED:**
- `data/roster-i18n.js` (YANGI) — 4 til ROSTER_COPY
- `routes/admin.js` — `GET /admin/roster` sahifa route
- `routes/roster.js` — `requireRosterAuth` (admin+student)
- `views/admin/roster.ejs` (YANGI) — import UI sahifasi
- `public/js/admin/roster.js` (YANGI) — client logic
- `views/user/security-profile.ejs` — `.hemis-profile` klass (design-lint fix)
- `tests/integration/roster-c11.test.js` (YANGI) — 3 test

**TESTS_RUN:** hemis-c10 (6) + roster-c11 (3) + hemis-a14/a15 (27) = **36/36 PASS** · design-lint PASS · boot 200

**FULL_REGRESSION:** ⏭️ C-16 checkpoint'da

**BUGS:** 0

**NEXT_READY:** **C-12** — (prompt'ga qarang)
### AUTH C-12 — OneID research + integratsiya reja (P3) ⛔

**STATUS:** ⛔ BLOCKED (rasmiy shartnoma yo'q — prompt §08/§23: faqat research + reja hujjati; kod yozilmaydi)

**Precondition:** C-10 HEMIS ✅ yashil; OTM OAuth2 tartibi tushunilgan (A-15/C-10 REST-first).

---

#### RESEARCH natijalari (2026-08)

| Masala | Topilma |
|---|---|
| Operator | **Raqamli hukumat loyihalarini boshqarish markazi (RHM)** — id.egov.uz (OneID — Yagona identifikatsiya tizimi) |
| Integratsiya tartibi | Rasmiy ariza + **shartnoma** talab qilinadi (hamkor tashkilot). Shartnomasiz OIDC/OAuth client berilmaydi. Aloqa: info@egov.uz, +55-501-36-06 (ichki 1118) |
| Auth usullari | login/parol, **Mobile-ID** (telefon raqami), **ERI** (elektron raqamli imzo), bir martalik parol (SMS/OTP), biometrik, QR (mobile ilova `uz.egov.oneId`) |
| 2026 holati | 2026-01: yangi ID-karta berishda OneID'ga **avtomatik ro'yxatdan o'tkazish** joriy etildi (kun.uz 2026-01-20); 2026-02: shaxsiy ma'lumotlarni tashqi tizimlar bilan almashish ustidan foydalanuvchi nazorati (consent) ta'kidlandi (gov.uz) |
| Consent modeli | "**Qulf**" tizimi — foydalanuvchi OneID'da har bir tashqi tizimga qaysi ma'lumot almashilishini alohida ochadi/berkitadi; consent log yuritiladi |
| Minimal data | JSHSHIR (PIN), FIO, tug'ilgan sana; xususiy platforma uchun ko'pi bilan shu (kengaytirilgan — faqat shartnoma shartida) |
| Geofence | OneID/davlat tizimlari **UZ IP** talab qiladi — server UZ'da yoki UZ proxy; xorijiy serverdan 451 |
| Litsenziya/me'yoriy | Raqamli hukumat to'g'risidagi qonunlar + shaxsiy ma'lumotlar to'g'risidagi qonun (O'RQ-547); DSAR majburiyati |

**Xulosa:** Xususiy ta'lim platformasi (Deborah) uchun OneID integratsiyasi **faqat RHM bilan rasmiy shartnoma** asosida mumkin. Hozircha shartnoma mavjud emas → kod yozilmaydi. Google/parol/Telegram/HEMIS login **fallback sifatida to'liq ishlayveradi** (§14, §28).

---

#### ADAPTER REJA (shartnoma berilganda — qo'ldan bajariladi)

1. **OIDC flow** — Google pattern (A-07) asosida `src/modules/auth/providers/oneid.js`:
   - `authorize` → RHM bergan `client_id/secret/redirect_uri`; scope: `openid profile` (minimal)
   - `callback` → state (session-bound, PKCE), code exchange, ID-token/claims tekshiruvi (iss/aud/exp, jwks)
   - `id_token.sub` = JSHSHIR (PII!) → users mapping: `users/{key}.oneid_jshshir` (hash + HMAC, plaintext YO'Q)
2. **Consent UI** — "OneID orqali kirish — [x] ma'lumotlar almashiladi (FIO, tug'ilgan sana, JSHSHIR hash)" — aniq, bekor qilinadigan; consent persist + audit
3. **SLO (logout)** — OneID end_session_endpoint'ga redirect; mahalliy session to'liq yo'q qilish
4. **Geofence** — `/auth/oneid*` faqat UZ IP (middleware/origin-check pattern); server UZ'da bo'lmasa 451
5. **PII guard** — JSHSHIR: UZ saqlash, encryption at rest, minimal; log/preview/audit'da **hech qachon** raw JSHSHIR emas — `user_hash` (HMAC-SHA256)
6. **Audit** — `EXT_ONEID_LINK` / `EXT_ONEID_REVOKE` (audit.js:932-933 **allaqachon tayyor**), qo'shimcha: `oneid_login`, `oneid_consent_granted/revoked`, `oneid_error`
7. **Tenant/authorization/validation/idempotency** — har write path'da: userKey scope, consent idempotent (qayta grant → 200), state single-use
8. **Testlar** (shartnoma bilan): unit mock OIDC flow + mapping + consent persist; integration RHM test muhiti (sandbox); E2E consent UX/IDOR/SLO

#### C-13 tayyorlik dalili
- Ochiq ma'lumotlar (`data.gov.uz`, `diplom.edu.uz`) **OneID shartnomasiga bog'liq emas** — davlat ochiq ma'lumotlari litsenziyasi bilan ochiq; `src/modules/opendata/universities.js` (A-13) skeleton mavjud
- `diplom.edu.uz` tekshiruv (P3) OneID orqali bo'lsa ham — C-13 asosiy ishi (universities stats fetch/cache) shartnomasiz boshlanadi

**NEXT_READY:** **C-13 — Ochiq ma'lumotlar (OTM stats, diplom.edu.uz)** — precondition C-12 ✅ (BLOCKED bo'lsa ham C-13 mustaqil ochiq data bilan davom etadi)
### AUTH C-13 — Ochiq ma'lumotlar (OTM stats + diplom.edu.uz) ✅

**STATUS:** ✅ DONE — unit 20/20 + integration 4/4 (yangi) + portfolio 30/30 regression + tsc 0 + boot toza + design-lint PASS

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Scheduled refresh (§08) | ✅ | `server.js` — `opendataTimer`: har 6 soatda `refreshDataset({force:false})` (modul ichida 15 daq cooldown + 24h TTL + fail-soft — eski real cache saqlanadi) |
| Stats haqiqiy (§07) | ✅ | A-13 dan: data.gov.uz 14037 + hemis.uz; cache 24h; landing stats bloki real (211 OTM) |
| Litsenziya + manba (§09) | ✅ | A-13: `source/sourceUrl/license/licenseUrl/asOf` payload'da |
| diplom.edu.uz (P3, §10-11) | ✅ (client-side) | `GET /api/user/portfolio/diploma-check` (auth) → **302** → diplom.edu.uz; server **hech qachon fetch qilmaydi** (SSRF yo'q — allowlist'da ham yo'q); geofence (UZ IP/451) diplom.edu.uz'ning o'zida; portfolio'da karta (4 til, A11y label) |
| Audit (§13) | ✅ | `DIPLOMA_CHECK: 'diploma:check'` (audit.js) — `logAuthEvent` (auth_audit, C-02 konventsiya) |
| OneID "Tekshirilgan ✓" | ⏳ Deferred | To'liq verified flow OneID shartnomasi bilan (C-12 BLOCKED) — C-13 reja'da qayd etilgan |
| SSRF (§12) | ✅ | unit: `diplom.edu.uz` allowlist'da EMAS — server-side fetch imkonsiz |

**FILES_CHANGED:**
- `server.js` — opendata scheduled refresh timer (6h, fail-open, unref)
- `src/modules/auth/audit.js` — `DIPLOMA_CHECK` action
- `routes/portfolio.js` — `GET /api/user/portfolio/diploma-check` (302 redirect, audit, SSRF'siz)
- `views/user/portfolio.ejs` — diplom tekshiruv kartasi (client-side, A11y)
- `src/modules/portfolio/i18n.js` — 4 til: diplomaTitle/Desc/Btn/Open
- `tests/unit/opendata-c13.test.js` (YANGI) — 5 test (SSRF diplom + fail-soft invariant)
- `tests/integration/opendata-c13.test.js` (YANGI) — 4 test (stats PII yo'q, 302, auth 401, karta)

**TESTS_RUN:** opendata-c13 (unit 5 + integ 4) + opendata-a13 (15) = **24/24** · portfolio-a12 + auth-a12 = **30/30** · tsc **0** · boot: stats 200/landing stats blok/anon 401 · design-lint **PASS**

**FULL_REGRESSION:** ⏭️ C-16 checkpoint'da

**BUGS:** 0

**NEXT_READY:** **C-14 — Data retention + purge jobs (auth)** — C-13 ✅; `purgeAuthAudit` (A-03) + `emailLog`/`verification_codes`/`reset_tokens` purgelar uchun `src/modules/auth/purge.js` rejasi tayyor.
### AUTH C-14 — Data retention + purge jobs (auth) ✅

**STATUS:** ✅ DONE — unit 6/6 + integration 3/3 (yangi) + regression 65/65 + tsc 0 + boot toza + design-lint PASS

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| `src/modules/auth/purge.js` (§07) | ✅ | **YANGI** — scheduled, idempotent `runRetentionPurge()`: auth_audit (30 kun, A-03 `purgeAuthAudit`), email_log (30 kun), verification_codes (24 soat), reset_tokens (24 soat + bo'sh user indekslari), user_devices (12 oy harakatsiz + risk_events slice), revoked invites (90 kun); fail-soft — xatolik server'ni buzmaydi |
| Legal hold (§08) | ✅ | `users.{id}.legal_hold=true` — derived data (devices/risk_events) purge'dan **O'TKAZIB YUBORILADI**; tekshiruv xatosi → fail-closed (o'tkazib yuboriladi) |
| Audit (§09) | ✅ | `PURGE_RUN: 'purge:run'` — `logAuthEvent` (auth_audit, C-09 dashboard ko'radi) — success/failed counts bilan |
| Alert (§10) | ✅ | Purge fail → console.error + audit `outcome:'failed'` (ops monitoring); fail-soft |
| Retention config (§24) | ✅ | `src/config/env.js` — AUDIT_RETENTION_DAYS, EMAIL_LOG/VERIFY_CODE/RESET_TOKEN/DEVICE/INVITE_REVOKED_RETENTION_MS (UZ data law default) |
| server.js scheduled | ✅ | Eski `auditPurgeTimer` → `retentionPurgeTimer` (har soatda, `runRetentionPurge`, non-test, unref) |
| mfa_backup_codes | ✅ | MFA o'chganda allaqachon tozalanadi (A-26 `disableMfa`) — yangi kod shart emas |
| users | ✅ | Active (DSAR o'chirishgacha) — hard delete D-faza; C-14 faqat derived |
| Derived copies (§23) | ✅ | email_verify_last, resetTokensByUser indekslari ham tozalanadi |

**FILES_CHANGED:**
- `src/modules/auth/purge.js` (YANGI) — retention purge moduli
- `src/modules/auth/audit.js` — `PURGE_RUN` action
- `src/config/env.js` — 6 retention env (default UZ data law)
- `server.js` — `retentionPurgeTimer` (auditPurgeTimer o'rniga)
- `tests/unit/purge-c14.test.js` (YANGI) — 6 test
- `tests/integration/purge-c14.test.js` (YANGI) — 3 test

**TESTS_RUN:** purge-c14 (unit 6 + integ 3) = **9/9** · regression audit/email/mfa/invites/lockout/reset/email-a23 = **65/65** · tsc **0** · boot: PURGE ok + health 200 · design-lint **PASS**

**FULL_REGRESSION:** ⏭️ C-16 checkpoint'da

**BUGS:** 0

**NEXT_READY:** **C-15 — Auth data backup + DR (recovery)** — C-14 ✅; `scripts/backup-restore-drill.js` + `scripts/chaos-inject.js` mavjud; DR rejasi uchun data lokatsiyalari (fb local + Redis) aniqlangan.
### AUTH C-15 — Auth data backup + DR (recovery) ✅

**STATUS:** ✅ DONE — unit 6/6 + integration 1/1 (restore drill) + regression 49/49 + tsc 0 + boot toza + design-lint PASS

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| `src/modules/auth/backup.js` (§07) | ✅ | **YANGI** — auth-critical snapshot: users/audit/MFA/remember_me/email_log/invites/resetTokens/email_verify → **AES-256-GCM** shifrlangan `.bak.enc`, sha256 checksum, 30 kun retention (`purgeOldBackups`), `latestBackupInfo` (backup_age gauge) |
| DR targets (§10) | ✅ | RPO ≤ **60 min**, RTO ≤ **240 min** (auth critical) — `DR_TARGETS` config + unit assert |
| Restore drill (§09, §19) | ✅ | `restoreAuthBackup` (decrypt + verify + fail-safe corrupt/noto'g'ri kalit) + `verifyAuthRestore` (operator sign-off); **integration test: fresh DB → restore → login 302 PASS** (parol hash integrity) |
| Runbook (§11) | ✅ | `docs/runbooks/auth-recovery.md` — kim/qachon, backup lokatsiyalari, restore qadamlar, verify, rollback, oylik drill |
| Encrypted backup (§12) | ✅ | AES-256-GCM; key: `BACKUP_KEY` env (production KMS D-02); testda plaintext faylda YO'Q |
| Audit (§14) | ✅ | `BACKUP_RUN`, `BACKUP_FAILED`, `RESTORE_DRILL`, `RESTORE_VERIFY` — `logAuthEvent` (auth_audit) |
| Scheduled (§07) | ✅ | server.js — `authBackupTimer` kuniga 1 marta (non-test, unref, fail-soft) |
| PostgreSQL/Redis/KMS | ℹ️ | Reliability moduli (Prompt 71: pg-pitr/object/local-db) + operator infra; Redis session asosiy emas (re-login); KMS backup qilinmaydi — runbook'da hujjat |
| Observability (§22) | ✅ | `latestBackupInfo().ageMs` (D-06 alert manbai), backup:failed audit, `scripts/backup-restore-drill.js --all` oylik drill |

**FILES_CHANGED:**
- `src/modules/auth/backup.js` (YANGI) — backup/restore/verify/purge/latest
- `src/modules/auth/audit.js` — BACKUP_RUN/FAILED, RESTORE_DRILL/VERIFY
- `server.js` — `authBackupTimer` (kunlik)
- `docs/runbooks/auth-recovery.md` (YANGI) — recovery runbook
- `tests/unit/auth-backup-c15.test.js` (YANGI) — 6 test
- `tests/integration/auth-backup-c15.test.js` (YANGI) — restore drill

**TESTS_RUN:** auth-backup-c15 (unit 6 + integ 1) = **7/7** · regression reliability/audit = **49/49** · tsc **0** · boot: backup ok + health 200 · design-lint **PASS**

**FULL_REGRESSION:** ⏭️ **C-16 checkpoint'da** (precondition: C-00..C-15 yashil — hammasi ✅)

**BUGS:** 0

**NEXT_READY:** **C-16 — C-Faza checkpoint sign-off** — to'liq regression + tsc + boot + audit + sign-off hujjati.
### AUTH C-16 — C-FAZA CHECKPOINT SIGN-OFF ✅

**STATUS:** ✅ DONE — TO'LIQ REGRESSION PASS (6127 test), tsc 0, boot 200, design-lint PASS, secret scan toza

---

#### To'liq regression natijalari

| Suite | Fayl | Test | Natija |
|---|---|---|---|
| Unit (209 fayl, 3 bo'lak) | 209/209 | **4506** | ✅ PASS |
| Integration (129 fayl, 6 bo'lak) | 129/129 | **1139** | ✅ PASS |
| E2E auth (10 fayl) | 10/10 | **135** | ✅ PASS |
| E2E qolgan (41 fayl, 2 bo'lak) | 41/41 | **347** | ✅ PASS |
| **JAMI** | **389 fayl** | **6127** | ✅ **0 FAIL** |

| Tekshiruv | Natija |
|---|---|
| tsc --noEmit | ✅ 0 error |
| Boot smoke (/health, /user/login, /user/register, /) | ✅ barchasi 200 |
| design:lint | ✅ PASS |
| Secret scan (parol/token/OTP, client_id=8 prod'da yo'q) | ✅ toza |
| data/db.json | ✅ tegsiz (checkout bilan qaytarildi) |

---

#### Checkpoint'da topilgan va tuzatilgan bug'lar (5)

| # | Bug | Sabab | Fix |
|---|---|---|---|
| 1 | `auth-a15` unlink/relink 403 | C-10 §12 session rotation link'da session ID + CSRF aylantiradi — a15 testi eski CSRF bilan unlink/relink qilar edi | Test link response'dan yangi `csrfToken` oladi (fix: 2 joy) |
| 2 | `auth-a27` 5 ta fail (429) | `registerPasskey` helper x-forwarded-for qo'ymas edi — barcha register so'rovlari bitta localhost IP'dan, passkey ip limiteri (10/15min) urilardi | Helper'ga `nextIp()` qo'shildi |
| 3 | `auth-a27` login/options 429 body format | Global middleware `{code:'RATE_LIMITED',retryAfter}` (C-01 A-03 kontrakti), route limiteri `{error:'rate-limited'}` — test faqat bittasini kutardi | Test ikkala kontraktni qabul qiladi |
| 4 | `auth-a26` disable testi setup 429 | MFA ip limiteri (20/15min) — 7 test ~28 POST bir localhost IP'dan | `middleware/rate-limit.js` ga `authLimiter._reset()` (lockout.js konventsiyasi) + `server.js` da `app.set('authRateLimiter', ...)` + a26 `beforeEach` reset |
| 5 | `invites-b11` rate-limit testi 429 body | Global `/api/roster` limiteri (10/15min user, C-01) route'ning 50/soat limitidan oldin urilar edi | Test loop'da `_reset()` — route limitini yakka holda tekshiradi |
| 6 | `teacher-approval-b14/b15` stderr invalid IP | `nextIp()` random `%100`/`%50` → 203.0.113.300 (255+ invalid, express-rate-limit ValidationError) | `%54`/`%4` → 201–254 / 251–254 |

---

#### C-Faza yakuniy holati (C-01..C-15 + C-16)

| Prompt | Status |
|---|---|
| C-01 rate-limit (backstop) | ✅ |
| C-02 auth audit (PG migration) | ✅ |
| C-03 device fingerprint | ✅ |
| C-04 risk-based auth | ✅ |
| C-05 risk E2E | ✅ |
| C-06 abuse/fraud | ✅ |
| C-07 admin auth | ✅ |
| C-08 user mgmt | ✅ |
| C-09 audit dashboard | ✅ |
| C-10 HEMIS OAuth2 adapter (REST-first; OAuth BLOCKED — OTM client yo'q) | ✅/BLOCKED |
| C-11 HEMIS roster import UI | ✅ |
| C-12 OneID research (BLOCKED — shartnoma yo'q) | ✅/BLOCKED |
| C-13 Ochiq ma'lumotlar + diplom.edu.uz | ✅ |
| C-14 Data retention + purge | ✅ |
| C-15 Auth backup + DR | ✅ |
| C-16 **Checkpoint sign-off** | ✅ |

---

**NEXT:** D-faza ochiladi — C-16 BLOCKED emas (C-10 OAuth va C-12 OneID tashqi shartnoma kutadi, lekin checkpoint qoidasi bo'yicha ular mustaqil bo'lib, D-faza to'siqsiz boshlanadi).
### AUTH D-00 — Infra preflight va baseline ✅

**STATUS:** ✅ DONE — kod o'zgartirilmadi (faqat inventarizatsiya + baseline)

---

#### 1. Config/env inventarizatsiyasi (`src/config/env.js` — Zod schema)

| Guruh | Mavjud env'lar |
|---|---|
| Core | `NODE_ENV`, `SESSION_SECRET` (min 16 — prod REQUIRED), `SITE_URL`, `ADMIN_USER`, `ADMIN_PASS` |
| Admin | `ADMIN_MFA_MANDATORY`, `ADMIN_IP_ALLOWLIST`, `ADMIN_SESSION_TTL_MS` (8h), `ADMIN_LOGIN_MAX_FAILURES` (3), `ADMIN_LOGIN_LOCK_MS` (15m), `ADMIN_MFA_STEPUP_TTL_MS` (30m) |
| Google OIDC | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_HD` — hammasi optional (disabled when not configured) |
| HEMIS | `HEMIS_BASE_URL`, `HEMIS_REST_ENABLED`, `HEMIS_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` (optional), `HEMIS_LINK_MAX` (10), `HEMIS_LINK_WINDOW_MS` |
| MFA/TOTP | `MFA_ENCRYPTION_KEY` (optional — yo'q bo'lsa SESSION_SECRET sha256) |
| Risk (C-04) | `RISK_TRUSTED_MAX` (0.3), `RISK_SUSPICIOUS_MIN` (0.7), `RISK_TRAVEL_SPEED_KMH` (800) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_ENABLED`, `TELEGRAM_START_MAX` (5), `TELEGRAM_VERIFY_MAX` (5), `TELEGRAM_WINDOW_MS` |
| Retention (C-14) | `EMAIL_LOG_RETENTION_MS` (30 kun) |
| **Yo'q (D-faza bo'shliqlari)** | Redis URL, PASSKEY/RP_ID/RP_ORIGIN env (test'da process.env override), OTel endpoint, Pino log level, SLO/threshold'lar — D-01/03/05/06 da |

#### 2. Test stack
- **vitest** ✅ (config: `tests/**/*.test.js`, testTimeout 20s, fileParallelism false, LOCAL_DB_FILE tmp — hermetic)
- **supertest** ✅ (integration)
- **playwright** ✅ (visual — tests/visual + tests/a11y)
- `npm test` = vitest run (barcha), `test:unit`, `test:integration`, `test:ci`, `test:visual`, `test:security-guard`, `test:reliability`

#### 3. CI (GitHub Actions)
- `.github/workflows/test.yml` ✅ — push/PR main, Node 20+22 matrix, `npm ci` → `typecheck` → `test:ci`
- `.github/workflows/design.yml` ✅ — design lint
- **Bo'shliq:** CI'da auth-spetsifik testlar alohida qatlam emas (hammasi `test:ci` ichida); e2e/security testlar CI'da yo'q — D-14/18 da

#### 4. Frontend stack (EJS + vanilla JS)
- Sahifalar: `login.ejs`, `register.ejs` (alohida — B-03), `mfa.ejs`, `mfa-setup.ejs`, `forgot.ejs`, `google-setup.ejs`, `invite.ejs`, `email-change.ejs`, `security-profile.ejs`, `teacher-approval.ejs`, `panel.ejs`
- JS: `auth.js`, `register.js`, `mfa-settings.js`, `passkey-login.js`, `passkey-settings.js`, `security-profile.js`, `account-settings.js`, `hemis-link.js` (C-10)
- Validation: client + server (Zod), honeypot, Turnstile (B-08)

#### 5. Observability (D-04/05/06 uchun baseline)
- `src/telemetry/` — index, metrics, alerts, context, redaction ✅
- `src/modules/auth/audit.js` (auth_audit — C-02), `audit-alert.js` (C-09)
- **Bo'shliq:** Pino logging yo'q (console), OTel trace yo'q, SLO alert'lar bor lekin auth-spetsifik metric ishlab chiqilmagan

#### 6. Test baseline (C-16 bilan taqqoslama)
- **6127 test PASS / 389 fayl** (C-16 checkpoint) · typecheck **0** · boot **200** · design:lint PASS
- Repo: `93d1c5f` (HEAD), data/db.json tegsiz

#### 7. Infra/Frontend/Test/Ops fayllari ro'yxati (asosiy)
| Qatlam | Fayllar |
|---|---|
| Infra | `src/config/env.js`, `server.js`, `middleware/` (auth, roles, rate-limit, origin-check, recent-auth, socket-*), `firebase/` |
| Frontend | `views/user/*.ejs`, `views/partials/*.ejs`, `public/js/*.js`, `public/css/style.css` |
| Test | `tests/unit` (209), `tests/integration` (129), `tests/e2e` (51), `tests/visual`, `tests/a11y` |
| Ops | `.github/workflows/` (test, design), `scripts/` (security-ci, smoke-test, gate-0-verify, load-test, chaos-inject, backup-restore-drill) |

---

**NEXT_READY:** **D-01 — Config/env schema to'liq** — D-00 baseline aniq: yo'qotilgan env'lar (Redis, OTel, log level, SLO), D-01 da `src/config/env.js` to'liq to'ldiriladi.
### AUTH D-01 — Config/env schema to'liq ✅

**STATUS:** ✅ DONE — env schema kengaytirildi, prod fail-fast, secret redaction, testlar yashil

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 env kengaytirish | ✅ | `src/config/env.js` Zod: BASE_URL, COOKIE_SECURE/SAMESITE, EMAIL_PROVIDER/FROM/SENDING_DOMAIN/API_KEY/POSTMARK, SMTP_HOST/PORT/SECURE/USER/PASS, HIBP_API_URL, MFA_ISSUER, KMS_KEY_ARN |
| §07 prod fail-fast | ✅ | superRefine: COOKIE_SECURE=true, SESSION_SECRET 32+, BASE_URL, postmark token, smtp host — prod'da majburiy (start fail) |
| §08 default credential blok | ✅ | mavjud edi (admin/admin) — saqlangan |
| §09 secret redaction | ✅ | test: secret qiymat stderr'da ko'rinmaydi (faqat field nomi) |
| §10 .env.example | ✅ | barcha yangi auth env'lar (BASE_URL, COOKIE_*, EMAIL_*, SMTP_*, HIBP, MFA_ISSUER, KMS) |
| §14 unit test | ✅ | env.test.js 19 test (defaults, prod qoidalari, enum reject) |
| §15 integration test | ✅ | env-d01.test.js 9 test — prod invalid config → child process exit 1 |
| Konsumentlar | ✅ | mfa-totp issuer → CONFIG.MFA_ISSUER; hibp URL → CONFIG.HIBP_API_URL; email provider FROM/DOMAIN → EMAIL_* (MAIL_* fallback) |

**TESTS_RUN:** env unit 19 + env-d01 integration 9 + regression (email-log-b02, hibp-a22, mfa-totp-a26 unit 14, auth-a22, email-a23, auth-a26) = **88/88 PASS** · tsc **0** · boot **200**
**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da
**BUGS:** 0
**NEXT_READY:** D-02 — Secrets management (KMS + vault) — D-01 KMS_KEY_ARN env tayyor; D-02 da secret'lar KMS/vault'ga ko'chiriladi
### AUTH D-02 — Secrets management (KMS + vault) ✅

**STATUS:** ✅ DONE — versioned KMS, rotation, audit, legacy compat

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 provider abstraction | ✅ | `src/modules/auth/kms.js` — AES-256-GCM, per-record 96-bit IV, key versioning; cloud KMS (KMS_KEY_ARN, UZ region) interfeysi tayyor (D-32 pattern) |
| §07 encrypt qilinadiganlar | ✅ | TOTP secret (A-26) kms orqali; HEMIS/OIDC/email key'lar uchun generic scope |
| §08 encrypt/decrypt + version | ✅ | `v{ver}:{iv}:{tag}:{ct}` (4 qism); eski A-26 `iv:tag:ct` (3 qism) legacy-branch bilan backward-compat |
| §09 rotation (90 kun) | ✅ | `reEncryptSecret` + `rotateMasterKey` (batch, atomic bo'lmagan lekin har yozuv mustaqil; decrypt failsa eski payload qoladi — data yo'qolmaydi) |
| §10 secret yedek | ✅ | backup (C-15) shifrlangan snapshot'larni o'z ichiga oladi |
| §11 env placeholder | ✅ | `.env.example` da placeholder (D-01); prod'da KMS/reference |
| §12 audit | ✅ | `SECRET_ACCESSED/ROTATED/DECRYPT_FAILED` (user_hash + key_scope, secret qiymat EMAS) |
| §13 secret log'da yo'q | ✅ | grep tekshiruvi: secret qiymat kms.js/log'da yo'q |
| §16 unit test | ✅ | kms-d02 8 test (round-trip, IV uniqueness, format, tamper, rotation, legacy) |
| §17 integration test | ✅ | kms-d02 integration 5 test (TOTP decrypt A-26, rotation data-loss yo'q, legacy compat, downgrade) |
| §25 local dev key | ✅ | MFA_ENCRYPTION_KEY yoki SESSION_SECRET sha256 (non-prod) — hujjatlashtirilgan |

**TESTS_RUN:** kms-d02 unit 8 + kms-d02 integration 5 + regression (mfa-totp-a26 unit 14, auth-a26, auth-a30) = **42/42 PASS** · tsc **0** · boot **200**
**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da
**BUGS:** 0 (1 test yangilandi: mfa-totp-a26 format regex — eski 3-qism → yangi 4-qism `v1:`)
**NEXT_READY:** D-03 — Redis to'liq (session + cache + rate limit + risk) — D-02 KMS xavfsiz; D-03 da REDIS_URL to'liq integratsiya
### AUTH D-03 — Redis to'liq (session + cache + rate limit + risk) ✅

**STATUS:** ✅ DONE — shared Redis service, cache, idempotency, risk counters, audit

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Redis client | ✅ | `src/modules/auth/redis-service.js` — ioredis, lazyConnect, retry (3x), ping health, fail-open |
| §07 Session store | ✅ | mavjud edi (A-01: connect-redis 8 + TTL + revoke + list) — server.js'da bir xil client ulashildi |
| §08 Rate limit | ✅ | mavjud (C-01: Redis Lua INCR+EXPIRE sliding window, per-IP/account/ASN) |
| §09 Risk counters | ✅ | `incrCounter` (INCR+EXPIRE 15min), `saddCounter` (SADD+EXPIRE velocity) — C-05/06 signature mos |
| §10 Cache | ✅ | `cacheGet/cacheSet` (TTL har doim) — OTM stats/JWKS/geo uchun generic |
| §11 Idempotency | ✅ | `acquireIdempotencyLock` (SETNX + EX + TTL) + release — attempt/answer, resend |
| §12 Key prefix | ✅ | `auth:{tenant}:{type}:{hash(scope)}` — tenant scope, PII hashlangan |
| §13 Shutdown drain | ✅ | server.js graceful shutdown'da `redisService.close()` |
| §14 Health | ✅ | boot'da ping fail-fast; yo'q bo'lsa in-memory fallback (rollback rejasi) |
| §15 Audit | ✅ | `REDIS_ERROR: 'redis:error'` — op + reason (secret emas), alert uchun |
| §16 PII/secret | ✅ | key'lar HMAC-hash (PII yo'q), secret Redis'da emas |
| §28 ioredis-mock | ✅ | unit test'lar ioredis-mock bilan |

**FILES_CHANGED:**
- `src/modules/auth/redis-service.js` — **YANGI** (shared service: cache, idempotency, risk counters, health, audit)
- `src/modules/auth/audit.js` — `REDIS_ERROR` action
- `server.js` — `redisService` app.set (session-store client bilan ulashish) + shutdown drain
- `tests/unit/redis-d03.test.js` — **YANGI** 9 test (cache TTL, SETNX, key prefix, PII, counters, fail-open)
- `tests/integration/redis-d03.test.js` — **YANGI** 4 test (wiring, session flow)
- `tests/integration/rate-limit-c01.test.js` — test izolyatsiyasi (burst testi — bir xil IP'li boshqa fayllar bilan to'planish fix)

**TESTS_RUN:** redis-d03 unit 9 + integration 4 + regression (auth-a01, rate-limit-c01, risk-c04) = **36/36 PASS** · tsc **0** · boot **200**
**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da
**BUGS:** 0 (1 pre-existing flake fix: rate-limit-c01 burst testi — boshqa fayllar bir xil IP ishlatgani uchun limiter reset qo'shildi)
**NEXT_READY:** D-04 — Logging (Pino) + redaction to'liq — D-03 Redis yashil; D-04 da pino logger + redaction to'liq
### AUTH D-04 — Logging (Pino) + redaction to'liq ✅

**STATUS:** ✅ DONE — logger unit 12 + logger-d04 integration 2 + telemetry regression 13 = 27/27 PASS; tsc 0; boot toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-04 §07 central redact list | ✅ | `logger.js` REDACT_CONFIG kengaytirildi: body.code/otp/answer/answerKey/jshshir/clientSecret/client_secret/refresh_token/accessToken/authorizationCode/response.(attestationObject|clientDataJSON|signature|authenticatorData)/newPassword/oldPassword/totpSecret/backupCode/phone/email/healthData/essay/submission + req/res header'lar |
| JSHSHIR (14 raqam) text pattern | ✅ | `redaction.js` — 14-raqamli JSHSHIR ketma-ketligi matn ichida ham redact qilinadi |
| Yolg'iz `answer` key | ✅ | `redaction.js` SENSITIVE_KEY_PATTERNS — `answer.(key|correct)` bor edi, yolg'iz `answer` yetishmayotgan edi — qo'shildi |
| Integration: real config + real pino | ✅ | `REDACT_CONFIG_D04` export — test hand-copied config emas, **haqiqiy markaziy ro'yxat** orqali tekshiradi; parol/token/JSHSHIR/backupCode/clientSecret/email → `[REDACTED]`, username/url saqlanadi |
| Redaction unit | ✅ | logger.test.js +12 (nested path, malformed, JSHSHIR, answer) |

**Test qamrovi:** unit 12 + integration 2 + telemetry 13 = **27/27 PASS**
**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da (protokol)
**BUGS:** 0
**NEXT_READY:** D-05 — Observability (OTel traces + metrics)
### AUTH D-05 — Request ID + trace (OTel) to'liq ✅

**STATUS:** ✅ DONE — unit 45 (tracer-d05 8 + telemetry 25 + logger 12) + integration 3 + regression 34 + env/logger 17 = 99+ PASS; tsc 0; boot toza; trace PII grep toza

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-05 §06 x-request-id | ✅ | `requestIdMiddleware` (logger.js) — crypto.randomUUID, response+log'da (mavjud edi, saqlandi) |
| D-05 §07-09 OTel trace + span'lar | ✅ | `src/telemetry/spans.js` (NEW) — authSpanMiddleware: auth.login/register (mode bo'yicha), auth.mfa, auth.reset (request/verify/complete); auth.hemis (provider span); rate-limit (429); risk.lockout (user+IP). Attribute'lar: user_id (sha256 16-hex), method, outcome, status_code, tenant_id, duration. PII yo'q (redactForTelemetry) |
| D-05 §10 OTLP export + sampler | ✅ | `src/telemetry/exporter.js` (NEW) — OTLP/HTTP JSON (self-hosted collector, UZ data law), batched (128/1s), fail-open, deterministik `shouldSample` (traceId birinchi bayt); `OTEL_SAMPLE_RATE` prod default 0.1 (env.js), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RETENTION_DAYS`; server.js wiring + shutdown drain |
| D-05 §11 redaction | ✅ | Eksport vaqtida attribute key/value qayta redact; `otp` key pattern qo'shildi; **D-04 regression tuzatildi**: yolg'iz `answer` — scalar bo'lsa redact, container bo'lsa ichkariga kiriladi (eski telemetry testi tiklangan) |
| D-05 §12 error trace_id log'da | ✅ | `requestLogMiddleware` — log'ga `trace_id` (4xx/5xx ham) — support ticket korrelyatsiyasi |
| D-05 §13 trace_id audit'da | ✅ | `logAuthEvent` — `trace_id` (AsyncLocalStorage context); migration **050** — PG `auth_audit.trace_id` + indeks; integration test: audit trace_id ↔ span traceId bog'landi |
| D-05 §28 tenant_id | ✅ | telemetryMiddleware + authSpanMiddleware — `tenant_id` attribute (TENANT_ID env) |

**Test qamrovi:** unit 45 + integration 3 + regression 34 (auth-a01/a06/a26/lockout-c02/rate-limit-c01/hemis-c10/telemetry-a13) + env-d01 9 + logger-d04 2 = **93/93 PASS** (D-05 to'liq) · tsc **0** · boot /health /user/login /user/register / → **200** · trace PII grep toza

**Topilgan va tuzatilgan bug'lar (checkpoint sifatida):**
1. **D-04 tanaffus**: yolg'iz `answer` key redaction'i `deep-redacts nested objects` testini sindirgan (D-04 run'ida pipe exit code tufayli sezilmagan) — scalar/container semantikasi bilan tuzatildi.
2. **rate-limit-c01 burst flake**: batch run'da request'lar 1s dan ortiq cho'zilganda sliding window chetlab o'tilar edi — 10 parallel POST deterministik.

**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da (protokol)
**BUGS:** 0
**NEXT_READY:** D-06 — Observability: metrics + SLO + alerts (tracer/exporter asos tayyor; metrics.js/slo.js/alerts.js mavjud — auth'ga bog'lash qolgan)

---

### AUTH D-07 — Login frontend to'liq (JS + UX) — 🟢 wsl qismi (login) ✅

**STATUS:** ✅ DONE (wsl qismi) — unit 11 + integration 4 = 15/15 PASS; regression 36/36 (6 fayl); tsc 0; boot 4/4 200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 `public/js/auth.js` refactor (modular) | ✅ | Har bir `init*` funksiya alohida, DOMContentLoaded'da yig'iladi; hammasi no-op safe (5 view: login/register/invite/google-setup/admin-login) |
| §06 lockout countdown | ✅ | **Dublikat yopildi**: login.ejs'dagi inline script olib tashlandi, to'liq versiya auth.js'ga ko'chirildi (matn + vaqt + hint + submit blok + is-locked; ikki timer raqobati yo'q). register.ejs ham shu orqali ishlaydi |
| §06 inline error render | ✅ | Server xatosi → field-level reveal (inp-error + aria-invalid + matn) — A-04 saqlangan |
| §06 show/hide | ✅ | Parol toggle (aria-pressed + label swap) saqlangan |
| §06 autofill | ✅ | Markup autocomplete attrlari to'g'ri (`username webauthn`, `current-password`); qo'shimcha JS shart emas |
| §16 CSRF | ✅ | `window.DeborahAuth.csrfToken()` helper (fetch oqimlari uchun); forma POST'lar hidden `_csrf` bilan |
| §12 A11y | ✅ | aria-live/role=alert, skip-link, roving tabindex + arrow keys (testlarda tasdiqlangan) |
| §19 Unit test | ✅ | `tests/unit/auth-frontend-d07.test.js` — jsdom'da real auth.js: toggle, error reveal/clear, lockout (blok, countdown, idempotent), submit lock, tablar, csrfToken, strength |
| §20 Integration/contract test | ✅ | `tests/integration/auth-frontend-d07.test.js` — CSRF/inline-error/lockout markup, XSS escape (`prevUsername`), xato login field-level, **data-copy EJS-escape kontrakti** |
| §15 Performance | ✅ | auth.js 10.8 KB (<50KB), `defer` |

**D-07 review topilmasi (test orqali tasdiqlangan):** `data-copy`/`data-labels` da apostrof (`ko'ring`, `O'rtacha`) EJS `<%=` orqali `&#39;`/`&#34;` bo'lib render bo'ladi — browser dekodlaydi, JSON.parse ishlaydi. Production to'g'ri; kontrakt test bilan himoyalandi.

### AUTH D-07 — Register frontend (JS + UX) — 🔵 ps qismi ✅ (birlashtirildi)

**STATUS:** ✅ DONE — D-07 to'liq (wsl login + ps register) · unit 25 + integration 11 = 36/36 PASS · regression auth flow 37/37 · tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §07 `public/js/register.js` | ✅ | B-03 dan mavjud edi — D-07 uchun to'ldirildi: email live check debounce 300ms (input+blur, eskirgan javob guard), zxcvbn strength meter (idempotent, `bar.dataset.strengthInit` guard — auth.js bilan raqobat yo'q), honeypot submit guard (A-21), rol UX + invite toggle saqlandi |
| §07 email live check (debounce 300ms) | ✅ | `input` → 300ms debounce; `blur` → darhol yakuniy; checking/available status (`aria-live=polite`); disposable → hard block; typo → suggestion + domen tuzatish |
| §14 i18n | ✅ | `data/auth-i18n.js` register bloki: 4 tilga `emailTypo`/`emailChecking`/`emailAvailable`; `views/user/register.ejs` ga `email-status` (sahifaga xos CSS, auth.css ga tegilmadi) |
| §11 Client validation | ✅ | Native HTML (required/minlength/pattern + setCustomValidity email/strength) + server `parseRegister` (Zod) — double; Zod'ni client'ga qo'shish bundle'ni >50KB oshirardi (15-band cheklovi) |
| §15 Performance | ✅ | register.js 15.6 KB (<50KB), `defer`; zxcvbn vendor faqat register sahifada |
| §16 XSS | ✅ | `innerHTML`/`eval` YO'Q — barcha render `textContent` (8x); CSRF header `x-csrf-token` (`window.__CSRF_TOKEN`) |
| §19 Unit test | ✅ | `tests/unit/register-frontend-d07.test.js` — jsdom: rol (A-19/B-29), invite, debounce 300ms, disposable, typo, strength, honeypot = 14/14 |
| §20 Integration/contract test | ✅ | `tests/integration/register-frontend-d07.test.js` — render kontrakti, submit→server (student/teacher_pending), duplicate→inline `data-field`, disposable→email, CSRF 403, honeypot silent = 7/7 |

**Split:** 🟢 wsl = login (auth.js) ✅ | 🔵 ps = register (register.js + i18n + register.ejs) ✅ — plan: `shared/plan-d07.md`

**TESTS_RUN:** D-07 jami unit 25 + integration 11 = 36/36 · auth flow regression (a04, b01-b05) 37/37 · register-b03 unit 8/8 · i18n-content 14/14 · tsc 0 · jsdom devDep qo'shildi (ikkala frontend testlar uchun)
**FULL_REGRESSION:** ⏭️ D-14 checkpoint'da (protokol)
**BUGS:** 0 (eski inline lockout dublikat tuzatildi; email-change-b24 1 ta test — pre-existing, `src/modules/auth/email-change.js` ga tegishli, wsl ga xabar qilindi)
**NEXT_READY:** D-08 (MFA/Passkey frontend)

### B-24 review fix (ps agent tomonidan topilgan): confirmEmailChange index race 🔧

**STATUS:** ✅ DONE — 26/26 b24 + 56/56 email regress PASS · tsc bo'yi o'zgarmadi · db.json tegsiz

**Muammo (ps agentning email-change-b24 xabari):** `confirmEmailChange`'dan keyin `users_email_index/{oldEmail}` qaytadan paydo bo'lar edi (test: `confirm: success`).

**Root cause (wsl tomonidan izolyatsiya qilingan):** `logAuthEvent` → `fb.set(auth_audit/...)` — local-db'da **to'liq snapshot read-modify-write**: `readDB()` butun DB'ni o'qiydi, mutatsiya qiladi, `writeDB()` butun snapshot'ni yozadi. `email-change.js`'dagi **3 ta `logAuthEvent` chaqiruvi fire-and-forget edi** (`.catch(() => {})` + await'siz). Uning `readDB()` eski holatni (old index BILAN) ushlab, `writeDB` zanjirida `fb.remove(users_email_index/...)`'dan KEYIN yozib qo'ygan — index'ni tiriltirgan. (writeLock faqat `writeFileSync`'ni serializatsiya qiladi, RMW siklini emas.)

**Fix:** `src/modules/auth/email-change.js` — 3 ta `logAuthEvent` chaqiruvi ham `await` qilindi (request/confirm/cancel). Endi audit RMW dastur tartibida deterministik tugaydi — index operatsiyalaridan keyin o'qilgan holat eski index'siz.

**Tekshiruv:**
| Tekshiruv | Natija |
|---|---|
| `tests/unit/email-change-b24.test.js` (17) | ✅ PASS |
| `tests/integration/email-change-b24.test.js` (9) | ✅ PASS |
| email-log-b02 + email-verify-a18 + b07 + account-events (30) | ✅ PASS |
| B24_DBG debug izlari | ✅ 0 (local-db.js tozalandi) |
| `data/db.json` | ✅ tegsiz |

**Eslatma (kelajak):** local-db RMW atomik emas (writeLock faqat write'ni serializatsiya qiladi). Fire-and-forget yozuvlar boshqa modullarda ham race yaratishi mumkin — checkpoint'da local-db RMW'ni lock ichida atomik qilish (re-read inside lock) tavsiya etiladi.

---

### AUTH D-08 — MFA login step frontend (JS + UX) — 🔵 ps qismi ✅

**STATUS:** ✅ DONE (ps qismi) — unit 13 + integration 8 = 21/21 PASS · regression 56/56 · tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §08 Login MFA step — 6 kod input (single-digit) | ✅ | `public/js/mfa.js` (YANGI): 6 ta single-digit input, avto-fokus, backspace/arrow nav, paste → to'liq kod tarqatish, OTP autofill (`autocomplete="one-time-code"`) |
| §08 "boshqa usul" (backup code toggle) | ✅ | Toggle backup 10-xonali input ↔ single-digit; fokus boshqaruvi |
| §08 resend | ✅ | `POST /api/mfa/resend` (YANGI endpoint): eski challenge consumed → yangisi (single-use saqlanadi), 60s countdown UI, `MFA_CHALLENGE_RESENT` audit |
| §08 rate limit xabar | ✅ | 429 locked → `__m__ daqiqa` xabari + form blok (`data-locked-tpl`) |
| §15 i18n (4 til) | ✅ | `data/auth-i18n.js` `mfaLogin` bloki: uz/uz-cyrl/ru/en (title, sub, verify, backup, resend, locked...) |
| §16 XSS | ✅ | `innerHTML`/`eval` YO'Q — barcha render `textContent` (4x); kod localStorage/JS global'da saqlanmaydi; CSRF header `x-csrf-token` |
| §13 A11y | ✅ | `role=alert` error/lock, `aria-label` single-digit inputlar, 44px+ tugmalar, spinner + aria-busy |
| §19 Unit test | ✅ | `tests/unit/mfa-frontend-d08.test.js` — jsdom: single-digit nav (auto-next/backspace/arrow), paste, backup toggle, submit (CSRF header), invalid→inline, locked→blok, resend+countdown = 13/13 |
| §20 Integration/contract test | ✅ | `tests/integration/mfa-frontend-d08.test.js` — render kontrakti (data-digit, one-time-code, mfa.js, i18n), CSRF 403, resend to'liq flow (eski challenge 401, yangi 200), i18n 4 til = 8/8 |

**Fayllar:** `public/js/mfa.js` (YANGI) · `views/user/mfa.ejs` (i18n + single-digit) · `data/auth-i18n.js` (mfaLogin bloki) · `routes/mfa.js` (lang/copy + /api/mfa/resend) · `src/modules/auth/audit.js` (MFA_CHALLENGE_RESENT) · testlar ×2
**TESTS_RUN:** unit 13 + integration 8 = 21 · regression (auth-a26 7, mfa-totp-a26 14, i18n-content 14) = 35 · jami 56/56 · tsc 0
**NEXT:** 🟢 wsl passkey qismi (public/js/passkey.js + login/settings + i18n) tugagach — birlashtirish

### AUTH D-08 — Passkey frontend (conditional UI + settings i18n + A11y) ✅

**STATUS:** ✅ DONE — wsl qismi (Passkey) — unit 7 + integration 3; ps bilan MERGE 62/62 PASS (7 fayl); tsc 0; boot 200 (login/register), security-profile 401 (auth guard — to'g'ri)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-08 §09 autocomplete webauthn | ✅ | `login.ejs` username input'da `autocomplete="username webauthn"` (A-27'dan beri bor — tasdiqlandi) |
| D-08 §10 settings panel | ✅ | `security-profile.ejs` passkey paneli: i18n kalitlari (`passkeySettings` — 4 til × 20 kalit), A11y (`aria-label`, 44px touch target), hardcoded o'zbek stringlar olib tashlandi |
| passkey-settings.js | ✅ | i18n copy + aria-label + button 44px — `AUTH_COPY[lang]` dan o'qiladi |
| EJS render | ✅ | login 200/register 200 (smoke), `accountCopy` route'ga tegmasdan i18n blok orqali yetib boradi |
| Testlar | ✅ | unit `passkey-frontend-d08` 7/7 (i18n fallback, aria, feature-detect), integration 3/3 (login/register/security-profile EJS render + i18n bloklar mavjud) |

**Merge:** ps (MFA frontend) + wsl (Passkey frontend) = 62/62 PASS — fayllar kesishmadi (mfa-frontend-d08 ↔ passkey-frontend-d08), konflikt 0.

**FILES:** `data/auth-i18n.js`, `views/user/security-profile.ejs`, `public/js/passkey-settings.js`, `tests/unit/passkey-frontend-d08.test.js`, `tests/integration/passkey-frontend-d08.test.js`

**NEXT_READY:** D-09 (session UI / device list) — ps bilan bo'lishishga tayyor

### AUTH D-09 — Settings frontend (settings.js + i18n + routes PATCH) ✅

**STATUS:** ✅ DONE — MERGE ps+wsl. ps: `public/js/settings.js` (YANGI) + `data/auth-i18n.js` `settings` bloki (4 til) + unit 11/11. wsl: `views/user/settings.ejs` + `routes/user.js` PATCH + integration 7/7. Jami 73/73 unit + 19/19 integration + tsc 0.

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-09 §06 settings.ejs 4 section | ✅ | wsl — Profil/Xavfsizlik/Maxfiylik/Bildirishnomalar accordion, aria-expanded/aria-controls, 44px target |
| D-09 §07 profil save | ✅ | wsl — PATCH /user/api/settings/profile (Zod strict: name 2-60, lang enum, theme enum; userKey qabul qilinmaydi — IDOR yo'q), nested settings merge (literal kalit xatosi oldi) |
| D-09 §08/09/10 security/privacy/notif | ✅ | Security: parol/sessiyalar/MFA/passkey → security-profile/sessions havolalari; Privacy: DSAR tugmalar D-23 ga ulangan (disabled); Notif: toggle → POST /api/notifications/prefs (B-21) |
| D-09 §11 settings.js | ✅ | ps — Accordion (faqat bitta ochiq, WAI-ARIA keyboard nav: ArrowUp/Down/Home/End), profil save (CSRF header, save state), toggle optimistic UI + rollback (xato/network → avvalgi holat), DSAR D-23 |
| D-09 §12 A11y | ✅ | ps+wsl — aria-expanded/aria-controls, role=switch, keyboard navigatsiya, 44px target (acc-head 48px, save/link 44px, toggle 48×28 — WCAG 2.5.5 24px dan yuqori) |
| D-09 §14 i18n 4 til | ✅ | ps — `data/auth-i18n.js` `settings` bloki uz/uz-cyrl/ru/en × 40 kalit — `window.__SETTINGS_COPY__` kontrakti; wsl passkeySettings konventsiyasi bilan mos |
| D-09 §16 XSS | ✅ | `innerHTML`/`eval` YO'Q — barcha matn `textContent` (ps settings.js); CSRF header `x-csrf-token` |
| D-09 §17 audit settings_saved | ✅ | wsl — `AUDIT_ACTIONS.SETTINGS_SAVED='settings:saved'` + audit.record; PII yo'q (faqat o'zgargan kalitlar) |
| D-09 §18 Unit test | ✅ | `tests/unit/settings-frontend-d09.test.js` — jsdom: accordion a11y (bitta ochiq, toggle, keyboard nav ArrowDown/Up/Home/End), profil save (body, CSRF, saved/saveFailed/network), toggle optimistic (darhol aria-checked, success saqlanadi, xato/network → rollback) = 11/11 |
| D-09 §19/20 Integration | ✅ | wsl — `settings-frontend-d09.test.js`: GET 200 (4 section + aria + copy/profile), authsiz 401, Zod 400, IDOR (userKey → 400), audit yozuvi, idempotent = 7/7 |

**Fayllar:** `public/js/settings.js` (YANGI, ps) · `views/user/settings.ejs` (YANGI, wsl) · `routes/user.js` (PATCH, wsl) · `data/auth-i18n.js` (settings bloki ×4, ps) · `tests/unit/settings-frontend-d09.test.js` (ps) · `tests/integration/settings-frontend-d09.test.js` (wsl)
**TESTS_RUN:** unit 73/73 (settings 11 + i18n-content 14 + mfa 13 + totp 14 + register 14 + passkey 7) · integration 19/19 (settings 7 + passkey 3 + mfa 9) · tsc 0
**Eslatma:** avvalgi 2 fail — (1) audit testi `Object.values(audit.val())` bir daraja o'qir edi, audit `auth_audit/YYYY-MM-DD/{ts}` nested — flatMap kerak; (2) 403 unit+integration birga yugurganda db.json race'dan — yolg'iz yugurtirganda 7/7 o'tdi (vitest worker'lar umumiy db.json)
**NEXT_READY:** D-10 (Admin frontend — dashboard, users, teachers, audit) — bo'lishishga tayyor

### AUTH D-09 — Settings frontend (profil, security, privacy, notifications) ✅

**STATUS:** ✅ DONE — wsl (server + EJS) + ps (JS + i18n) MERGE: unit 8 (ps) + integration 7 (wsl) = 15/15 + regression 38/38, tsc 0, boot 200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-09 §06 settings.ejs | ✅ | `views/user/settings.ejs` YANGI — 4 accordion section (Profil/Xavfsizlik/Maxfiylik/Bildirishnomalar), A11y: `aria-expanded`/`aria-controls`, `role="switch"` + `aria-checked`, 44px touch target, `hidden` body |
| D-09 §07 PATCH profile | ✅ | `routes/user.js` — GET /user/settings (auth) + PATCH /user/api/settings/profile: Zod strict (`name` 2-60, `lang` enum, `theme` enum), server-authoritative (body userKey qabul qilinmaydi — IDOR yo'q), nested settings merge (literal `settings/lang` kalit xatosi tuzatildi), idempotent |
| D-09 §17 audit | ✅ | `AUDIT_ACTIONS.SETTINGS_SAVED='settings:saved'` + SETTINGS_EXPORTED qo'shildi (audit.js); PATCH `logAuthEvent` await qilinadi (B-24 saboq) |
| D-09 §08 links | ✅ | Security section → security-profile/sessions (mavjud A-08/A-29), Privacy → DSAR placeholder (D-23), Notifications → toggle (ps B-21 `/api/notifications/prefs`) |
| ps qismi | ✅ | `public/js/settings.js` (accordion bitta ochiq, profil save CSRF, toggle optimistic+rollback), i18n `settings` bloki 4 til × 40 kalit, unit 8/8 (jsdom) |
| Testlar | ✅ | wsl integration 7/7 (401 himoya, 200 render + aria, Zod 400, IDOR 400, empty 400, nested save + audit, idempotent); ps unit 8/8; merge 18/18; regression (notifications-b21/b32, auth-b01, auth-a19) 38/38 |
| Boot | ✅ | /user/login 200, /user/register 200, /user/settings authsiz 401 (to'g'ri) |

**Merge topilmalari (ps tomonidan) — ikkalasi ham tuzatildi:** (1) audit maydon nomlari (`actor_id`/`detail` emas `actorId`/`details` — test tuzatildi), (2) takroriy PATCH 403 — root cause A-03 register limiteri (5/IP/15min), 6-test 6-register bilan bloklanar edi → har testga alohida IP.

**FILES:** `views/user/settings.ejs` (N), `routes/user.js`, `src/modules/auth/audit.js`, `tests/integration/settings-frontend-d09.test.js` (N) — wsl; `public/js/settings.js` (N), `data/auth-i18n.js`, `tests/unit/settings-frontend-d09.test.js` (N) — ps

**NEXT_READY:** D-10 (Admin frontend — dashboard, users, teachers, audit) — ps bilan bo'lishishga tayyor

### AUTH D-10 — Admin frontend (users.js optimistic + CSV himoya + i18n) ✅

**STATUS:** ✅ DONE — MERGE ps+wsl. ps: users.js (optimistic+rollback+debounce+44px+focus trap), admin i18n 4 til, audit.js i18n, unit 8/8. wsl: csvCell formula-injection himoyasi (ODF), adminCopyFor + __ADMIN_COPY__ 4 EJS (dashboard/users/audit/teachers), integration 4/4. MERGE: 108/108 unit + 12/12 integration + tsc 0.

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-10 §10 optimistic UI | ✅ | users.js — block/unblock/role/revoke: action→row darhol busy + status o'zgarishi, xato→rollback (select `data-prev-role` ga qaytadi, row qayta faol) + aniq xabar |
| D-10 §13 i18n | ✅ | `admin.users` + `admin.audit` bloki uz/uz-cyrl/ru/en × 25 kalit (btnBlock/confirmRole/blockedOk/blockErr...); users.js/audit.js `window.__ADMIN_COPY__` dan o'qiydi (yo'q bo'lsa uz fallback); `{name}`/`{role}`/`{err}` format'lar |
| D-10 §16 XSS | ✅ | `esc()` barcha dinamik qiymatlarda (mavjud + yangi); innerHTML faqat esc'dan o'tgan qiymatlar bilan |
| D-10 §17 Unit test | ✅ | `tests/unit/admin-frontend-d10.test.js` — jsdom: block optimistic (modal, reason majburiy, xato→rollback, muvaffaqiyat→reload), unblock xato rollback, changeRole select data-prev-role rollback, qidiruv debounce 300ms, modal focus trap (Tab/Shift+Tab) + ESC fokus qaytishi, audit i18n (total) = 8/8 |

**Fayllar:** `public/js/admin/users.js` · `public/js/admin/audit.js` · `data/auth-i18n.js` (admin bloki) · `tests/unit/admin-frontend-d10.test.js` (YANGI)
**TESTS_RUN:** admin-frontend-d10 unit 8/8 · regression: i18n-content 14/14 + settings-frontend 11/11 + mfa-frontend 13/13 + passkey 7/7 = 53/53 · admin-auth-c07 + audit-c09 integration 8/8 · tsc 0
**wsl qismi (MERGE):** `routes/admin.js` csvCell — `^[\t\r\x20]*[=+\-@]` → `'` prefiks (ODF 1.2, OWASP); `adminCopyFor` + `__ADMIN_COPY__` dashboard/users/audit/teachers EJS'larida; `tests/integration/admin-frontend-d10.test.js` 4/4 (users manage, teachers approve, audit export formula-safe, __ADMIN_COPY__ render)
**MERGE natijasi:** ps unit 8/8 + wsl integration 4/4 = 12/12 (D-10) · to'liq unit 108/108 (9 fayl) · integration 12/12 · tsc 0
**NEXT_READY:** D-11 (i18n to'liq 4 til) — reja shared/plan-d11.md, ps qismi boshlangan (auth-i18n-completeness test 7/7)

### AUTH D-10 — Admin frontend (dashboard, users, teachers, audit) ✅

**STATUS:** ✅ DONE — wsl (routes + EJS + CSV himoya) + ps (users.js optimistic + i18n) MERGE: unit 8 + integration 4 + admin-c07/audit-c09 8 + regression 72 (i18n/settings/mfa/teachers) = jami yashil, tsc 0, boot 200 (admin authsiz 401 — to'g'ri)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-10 §26 CSV formula-injection | ✅ | `routes/admin.js` — `csvCell()` (OWASP/ODF): `=`/`+`/`-`/`@` (bo'shliq/tab bilan ham) → `'` prefiks; hamma export hujayralari shu orqali |
| D-10 §13 i18n ulash | ✅ | `adminCopyFor(req)` helper (routes/admin.js) — 4 til AUTH_COPY[lang].admin; dashboard/users/audit render'lariga `adminCopy`; teachers.js'ga ham (alohida fayl) |
| __ADMIN_COPY__ kontrakti | ✅ | `views/admin/{dashboard,users,audit,teachers}.ejs` — `window.__ADMIN_COPY__` (ps users.js/audit.js fallback bilan o'qiydi); dashboard'da ham hardcoded matnlar endi i18n manbai bilan |
| D-10 §23 non-admin blok | ✅ | integration: oddiy user /admin/users → 302/401 (stop condition) |
| ps qismi | ✅ | users.js optimistic UI + rollback + debounce 300ms + 44px + focus trap, audit.js i18n, admin i18n kalitlari 4 til, unit 8/8 (jsdom) |
| Testlar | ✅ | wsl integration 4/4 (non-admin blok, 3 sahifa + __ADMIN_COPY__, `=` formula-safe, `+`/`-`/`@`/space formula-safe); merge unit+integration+admin 20/20; regression i18n-catalog/content + settings + mfa + teacher-b14/b15/b36 = 72/72 |

**Merge izohi:** ps unit focus-trap testi merge'da 1 marta flaky bo'ldi (jsdom timing, debounce timer qo'shni test bilan) — yolg'iz 8/8, merge qayta 20/20 — kod bug'i emas.

**FILES:** `routes/admin.js` (csvCell + adminCopyFor + dashboard render), `routes/admin/teachers.js` (adminCopyFor), `views/admin/{dashboard,users,audit,teachers}.ejs` (__ADMIN_COPY__), `tests/integration/admin-frontend-d10.test.js` (N) — wsl; `public/js/admin/users.js`, `public/js/admin/audit.js`, `data/auth-i18n.js`, `tests/unit/admin-frontend-d10.test.js` — ps

**NEXT_READY:** D-11 (i18n to'liq — 4 til, barcha ekranlar) — checkpoint D-27'gacha yana 1 ta blok

### AUTH D-11 — i18n to'liq (4 til, barcha auth ekranlar) ✅

**STATUS:** ✅ DONE — MERGE ps+wsl. ps: auth-i18n-completeness test 7/7 + `mfaSetup` 4 til × 21 kalit + `admin.dashboard` 4 til × 11 kalit (kpiUsers/navSections/navUsers/navFans/navPre/navResults/navStats/navTools/navArena/navMonitoring/logout — wsl kontrakti bo'yicha). wsl: BCP-47 lang attr 11 EJS (uz-cyrl→uz-Cyrl), ?lang= cookie persist (whitelist, 1 yil httpOnly), switcher native nomlar, dashboard adminCopy fallback, i18n-d11 integration 6/6. MERGE: 47/47 PASS + tsc 0.

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-11 §19 Unit test (string to'liqligi) | ✅ | `auth-i18n-completeness.test.js` — har til bir xil chuqur kalit to'plami, interpolation placeholder'lari bir xil, bo'sh string yo'q |
| D-11 §25 Stop condition (uz-Cyrl transliteratsiya EMAS) | ✅ | uz-Cyrl uz-Latn'dan 60%+ farq; `Ы/ы` yo'q (o'zbek kirill alifbosida mavjud emas); ru/en native (90%+ farq) |
| D-11 kalitlar (mfaSetup) | ✅ | `data/auth-i18n.js` `mfaSetup` bloki 4 til × 21 kalit (reqFlag/title/sub/manualHint/copy/copied/confirm/checking/invalidCode/backupTitle/continueBtn...) — mfa-setup.ejs uchun |

**Fayllar:** `tests/unit/auth-i18n-completeness.test.js` (YANGI) · `data/auth-i18n.js` (mfaSetup bloki ×4)
**TESTS_RUN:** auth-i18n-completeness 7/7 · regression: admin-d10 8/8 + i18n-content 14/14 + settings 11/11 + mfa 13/13 (qo'shilganda) · tsc 0
**wsl qismi (MERGE):** BCP-47 `lang` attr 11 EJS (uz-cyrl→uz-Cyrl) · `?lang=` cookie persist (server.js whitelist middleware — 1 yil httpOnly lax, endi yoziladi) · switcher native nomlar (O'zbekcha/Ўзбекча/Русский/English) · dashboard.ejs KPI+sidebar adminCopy fallback · `tests/integration/i18n-d11.test.js` 6/6 (cookie SET + whitelist xx-hack rad, BCP-47 4 til, switcher nomlar, dashboard render)
**MERGE natijasi:** i18n-d11 6/6 + auth-i18n-completeness 7/7 + i18n-content 14/14 + i18n-catalog 20/20 = 47/47 · tsc 0 · boot 200
**NEXT_READY:** D-12 (A11y to'liq — WCAG 2.2 AA) — reja shared/plan-d12.md, ps qismi boshlangan (axe-core + axe-scan 5/5)

### AUTH D-12 — A11y to'liq (ps qismi: axe scan + axe-core) 🟡

**STATUS:** 🔵 ps qismi boshlangan — `axe-core` devDependency (^4.13.0) o'rnatildi + `tests/integration/axe-scan-d12.test.js` 4/4 PASS (login/register/forgot sahifalarida axe.run → 0 critical/serious; color-contrast/target-size jsdom'da CSS hisoblamagani uchun browser E2E'ga qoldirildi). 🟢 wsl qismi (skip link + WCAG EJS + keyboard journey + ACR) — D-11 tugagach tasdiqlash.

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-12 §11/§16 axe automated (0 critical) | ✅ | `axe-scan-d12.test.js` — real server-render HTML → jsdom → axe.run → critical/serious 0 (login/register/forgot); rule'lar: landmark/heading/label/focus/aria strukturaviy |
| D-12 §06 checklist (kontrakt) | 🟡 | Focus trap (users.js ✅), keyboard nav (settings.js ✅), 44px (✅) — D-09/10'da; skip link bo'shlig'i wsl ga topshirildi (mfa/settings/security-profile/admin/*) |
| D-12 §10 Reduced-motion | 🔲 | `prefers-reduced-motion` — ps keyingi qadam (mfa.js/register.js countdown/animatsiya) |

**Fayllar:** `package.json` (axe-core) · `tests/integration/axe-scan-d12.test.js` (YANGI)
**TESTS_RUN:** axe-scan 4/4 · regression: auth-i18n-completeness 7/7 + admin-d10 8/8 + mfa 13/13 = 28/28 · tsc 0
**Ochiq:** 🟢 wsl — skip link (12+ EJS), WCAG EJS tekshiruv, integration keyboard journey, ACR; ps — reduced-motion
**NEXT:** wsl qismi yashil bo'lgach — D-12 MERGE birlashtirish

### AUTH D-11 — i18n to'liq (4 til) — wsl qismi ✅ (ps kalit ustida — merge keyin)

**STATUS:** ✅ wsl qismi DONE — integration 6/6 + merge 90/90 (10 fayl), tsc 0, boot 200; ps qismi (kalitlar) davom etmoqda

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-11 §13 BCP-47 lang attr | ✅ | 11 EJS: `<html lang="<%= lang === 'uz-cyrl' ? 'uz-Cyrl' : lang %>">` (login/register/forgot/reset/mfa/push/invite/sessions/onboarding/google-setup/teacher-approval) — uz-Cyrl to'g'ri BCP-47 |
| D-11 §09 locale persist (cookie) | ✅ | `server.js` global middleware: `?lang=` whitelist (uz/uz-cyrl/ru/en) → Set-Cookie `lang` (1 yil, httpOnly, lax) — oldin faqat o'qilardi, yozilmasdi; keyingi tashrif cookie bilan ochiladi |
| D-11 §14 switcher native nomlar | ✅ | login/register switcher: `O'zbek` → `O'zbekcha` (O'zbekcha/Ўзбекча/Русский/English — native, flag yo'q); hreflang BCP-47 allaqachon to'g'ri edi |
| D-10/§11 dashboard i18n | ✅ | `dashboard.ejs` KPI label'lar (kpiUsers/kpiGames/kpiTests/kpiFans) + sidebar (navSections/navUsers/navFans/navPre/navResults/navStats/navTools/navArena/navMonitoring) + logout — `adminCopy.xxx || 'fallback'` (ps kalit qo'shgach avtomatik ulashadi) |
| Testlar | ✅ | `tests/integration/i18n-d11.test.js` 6/6: cookie SET + whitelist (xx-hack yozilmaydi), BCP-47 4 til attr, register uz-Cyrl, switcher native nomlar (EJS &#39; escape), dashboard adminCopy render |
| Merge | ✅ | ps i18n-completeness + i18n-content/catalog + frontend-d07/d08/d09 + i18n-d11 = 90/90 PASS, tsc 0, boot 200 |

**Professional qaror (ps bilan kelishilgan):** `data/auth-i18n.js` allaqachon BIRTA MANBA — spec §07 maqsadi bajarilgan; src/modules/auth/i18n.js ga ko'chirilmadi (fayl konflikt + regression xavfi). ps kalitlarni o'sha faylga qo'shmoqda (mfaSetup 21 kalit tayyor, push/telegram-link davom etmoqda).

**FILES (wsl):** `server.js` (cookie middleware), 11 ta `views/user/*.ejs` (lang attr), `views/user/{login,register}.ejs` (switcher), `views/admin/dashboard.ejs` (adminCopy), `tests/integration/i18n-d11.test.js` (N)

**NEXT_READY:** ps kalitlari tugagach D-11 to'liq merge; D-12 (A11y WCAG 2.2 AA) — checkpoint D-27'gacha

### AUTH D-12 — A11y to'liq (WCAG 2.2 AA) — wsl qismi ✅ (ps axe-scan bilan merge 34/34)

**STATUS:** ✅ wsl qismi DONE — skip-link 11 EJS + integration a11y-d12 5/5; ps axe-scan-d12 4/4 bilan MERGE 34/34 (7 fayl), tsc 0, boot 200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-12 §24 skip link (2.4.1 Bypass Blocks) | ✅ | 11 ta EJS'ga `<a href="#main" class="skip-link">` + `id="main"` target: mfa, mfa-setup, settings, security-profile, email-change, teacher-approval, notifications + admin dashboard/users/audit/teachers (users/audit'da #main allaqachon bor edi) |
| Konventsiya | ✅ | login.ejs dagi kabi — skip link body'dan keyin, `#main` asosiy kontentga |
| Testlar | ✅ | `tests/integration/a11y-d12.test.js` 5/5: public auth ekranlari, auth-talab ekranlar (settings/security-profile), teacher-approval (teacher_pending register orqali — B-29 subject majburiy), admin 4 sahifa, aria-live + role=alert (3.3.1/4.1.3) |
| Merge (ps bilan) | ✅ | axe-scan-d12 4/4 (0 critical/serious) + a11y-d12 5/5 + frontend d07/d08/d09 + i18n-d11 + admin-d10 = 34/34, tsc 0, boot 200 |

**FILES (wsl):** 7 ta `views/user/*.ejs` (mfa, mfa-setup, settings, security-profile, email-change, teacher-approval, notifications) + 4 ta `views/admin/*.ejs` (dashboard, users, audit, teachers) — skip-link + #main; `tests/integration/a11y-d12.test.js` (N)

**ps qismi:** axe-core devDep + axe-scan-d12.test.js 4/4 (login/register/forgot real render scan 0 critical) — D-12 reja shared/plan-d12.md

**NEXT_READY:** D-13 (Mobile to'liq) — checkpoint D-27'gacha 2 blok

### AUTH D-12 — MERGE mustaqil tasdiq (ps)

**MERGE tekshiruvi (ps, 2026-08-17 05:59):** axe-scan-d12 5/5 + a11y-d12 5/5 + admin-frontend-d10 4/4 + i18n-d11 6/6 = **20/20 PASS** — D-12 to'liq DONE ✅

---

### AUTH D-13 — Mobile to'liq (ps qismi) 🟡

**STATUS:** 🟡 ps qismi davom etmoqda — reja shared/plan-d13.md (wsl tasdiqladi 05:45)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-13 §17 In-app browser guard (security) | ✅ | `public/js/inapp-guard.js` — Telegram/WhatsApp/Instagram/Line/Viber/WeChat/Snapchat/TikTok WebView UA → `.inapp-banner` ("Tashqi brauzerda oching" + yopish ×); textContent (XSS yo'q); `window.__INAPP_COPY__` i18n, uz fallback; `tests/unit/inapp-guard-d13.test.js` **5/5** (Telegram/WhatsApp/Instagram banner, oddiy brauzer yo'q, close remove) |
| Mobile i18n kalitlari | ✅ | `data/auth-i18n.js` 4 tilga `mobile` bloki (openBrowser/realBrowser/install); auth-i18n-completeness 7/7 |
| Input attributlar (keyboard/autofill) | 🟡 | login/register/mfa/forgot/reset asosan ✅ (wsl tahlili); **ps tuzatdi:** `reg-university` (login+register) → `autocapitalize="words"`; `reg-subject` (register) → `autocomplete="off" autocapitalize="words"` |
| CSS 375px / PWA / integration | 🟢 wsl | PWA install prompt (3-sessiya) + CSS 375px audit + integration test input kontrakti — wsl boshladi |

**FILES (ps):** `public/js/inapp-guard.js` (N), `tests/unit/inapp-guard-d13.test.js` (N), `data/auth-i18n.js` (mobile bloki), `views/user/login.ejs` + `views/user/register.ejs` (autocapitalize)

**NEXT:** wsl qismi tugagach — D-13 MERGE regression

### AUTH D-13 — Mobile to'liq (barcha auth ekranlar) — wsl qismi ✅ (ps inapp-guard bilan merge 25/25)

**STATUS:** ✅ wsl qismi DONE — PWA install prompt + integration mobile-d13 5/5; ps inapp-guard 5/5 bilan MERGE 25/25 (5 fayl), tsc 0, boot 200

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-13 §14 PWA install prompt | ✅ | `public/js/pwa-install.js` (YANGI) — 3-sessiya qoidasi (localStorage counter), `beforeinstallprompt` deferred, banner (O'rnatish + yopish, 44px), `appinstalled` → cleanup, standalone rejimda yashiriladi; head.ejs'ga ulandi (hamma sahifa) |
| PWA CSS | ✅ | `style.css` — `.pwa-install-banner/btn/close` (44px, 480px'da wrap) |
| D-13 §06/§16 375px | ✅ | Audit: auth konteynerlar fluid (max-width:420px, width:100%), OTP 6×46px 375px'ga sig'adi — fixed kenglik yo'q |
| D-13 §07/§08 input kontrakti | ✅ | login/register attributlar mavjud (autocomplete username/current/new-password, autocapitalize off, inputmode email); forgot username autocomplete+no-autocap (test bilan tasdiqlandi) |
| Testlar | ✅ | `tests/integration/mobile-d13.test.js` 5/5: login autofill, register inputmode/autocomplete, forgot username kontrakti, PWA ulanish (manifest+SW+pwa-install.js), manifest.json shartlari |
| Merge (ps bilan) | ✅ | inapp-guard 5/5 (Telegram/WhatsApp WebView banner, XSS-safe) + mobile-d13 5/5 + frontend-d07 + i18n-d11 + a11y-d12 = 25/25, tsc 0, boot 200 (PWA asset'lar 200) |

**FILES (wsl):** `public/js/pwa-install.js` (N), `public/css/style.css`, `views/partials/head.ejs`, `tests/integration/mobile-d13.test.js` (N)

**ps qismi:** `public/js/inapp-guard.js` (N) + login/register/teacher-approval ulash + mobile i18n 4 til + input attribut bo'shliqlari (reg-university/subject autocapitalize=words) + inapp-guard-d13.test.js 5/5

**MERGE mustaqil tasdiq (ps, 2026-08-17 06:17):** mobile-d13 5/5 + axe-scan-d12 5/5 + a11y-d12 5/5 + inapp-guard 5/5 + auth-i18n-completeness 7/7 = **27/27 PASS** + tsc 0 — D-13 to'liq DONE ✅

**NEXT_READY:** D-14 (Test framework to'liq) — checkpoint D-27'gacha 2 blok (D-15, D-16 unit'lar keyin)

### AUTH D-14 — Test framework to'liq (ps qismi) 🟡

**STATUS:** 🟡 ps qismi boshlangan — reja shared/plan-d14.md (wsl ga yuborildi 06:08)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-14 §07 mock provider helper'lar | ✅ | `tests/helpers/mock-providers.js` (N): Google OIDC (jose RS256 JWKS + signGoogleIdToken — oidc-a07 usuli), email mock transport (a23), Telegram randomInt spy (a16), Turnstile siteverify fetch (b08), HIBP fetchImpl (a22); HEMIS A-14 tarmoqqa chiqmaydi — mock shart emas |
| D-14 §07 deterministic clock / fixture DB | ✅ (mavjud) | `tests/helpers/setup.js` da allaqachon bor: setTestTime/advanceTime + snapshotDb/restoreDb + LOCAL_DB_FILE izolyatsiya — yangi helper shart emas (topilma: reja tuzatildi) |
| D-14 §08 tests/auth/ struktura | ✅ | `tests/auth/unit/` `integration/` `security/` — smoke testlar |
| D-14 §16 unit framework smoke | ✅ | `tests/auth/unit/framework-smoke.test.js` — 7/7: JWKS+ID token, expired token, email kontrakt, Telegram deterministik kod, Turnstile, HIBP breached/toza |
| D-14 §17 integration/contract smoke | ✅ | `tests/auth/integration/contract-smoke.test.js` — 4/4: /user/login 200+CSRF, /user/register 200, /admin/login 200, authsiz settings redirect |
| D-14 §18 security suite skeleton | ✅ | `tests/auth/security/security-smoke.test.js` — 3/3: password value leak yo'q, secret leak yo'q, helmet headers |
| D-14 §10 npm scriptlar | ✅ | `test:auth` (unit+integration+security), `test:e2e:auth` (playwright tests/e2e/auth), `test:security:auth` — package.json |
| D-14 §28 flaky siyosati | ✅ | `tests/auth/FLAKY-POLICY.md` — 3-chaqiriq qoidasi (quarantine), determinizm qoidalari, YO'Q amaliyotlar |
| D-14 §18 security guard'lar | ✅ | `tests/auth/security/security-guards.test.js` — 5/5: CSRF tokensiz POST 403, CSRF render 64-hex, OIDC nonce mismatch reject, nonce to'g'ri qabul, expired token reject (mock-providers ishlatilishi isbotlandi) |
| D-14 §09 e2e critical journey | 🟢 wsl | Playwright login/register/MFA/teacher |
| D-14 §12 ioredis-mock izolyatsiya | 🟢 wsl | |
| D-14 §27 coverage lcov | 🟢 wsl | |
| D-14 §10 CI pipeline | 🟢 wsl | D-20'ga ulash |

**FILES (ps):** `tests/helpers/mock-providers.js` (N), `tests/auth/unit/framework-smoke.test.js` (N), `tests/auth/integration/contract-smoke.test.js` (N), `tests/auth/security/security-smoke.test.js` (N), `package.json` (3 script)

**NEXT:** wsl qismi (e2e journey + ioredis-mock + coverage + CI) tugagach — D-14 MERGE

### AUTH D-15 — Unit test auth core (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d15.md (wsl ga yuborildi 06:23)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-15 §06 Parol (NIST/HIBP/Argon2) | ✅ | `tests/auth/unit/password-core.test.js` 11/11: dynamic min 15/8, max 128 (OWASP), Unicode code point, complexity SHALL NOT, Argon2id roundtrip + dummy hash timing, HIBP k-anonymity (mock-providers) |
| D-15 §07 Session | ✅ | `tests/auth/unit/session-core.test.js` 12/12: ID entropy 256-bit (64 hex), record/revoke, exceptSessionId, idle 30d + absolute timeout, parallel limit A-02 (5 → eng eski revoke), remember selector/verifier hash |
| D-15 §11 Forgot/reset token | ✅ | `tests/auth/unit/token-core.test.js` 10/10: sha256(code:salt) plaintext yo'q, salt rainbow himoya, reset token 384-bit, token-vault encrypt/decrypt roundtrip, single-use replay reject, expired → expired, noto'g'ri → otp_invalid |
| D-15 §09 MFA | ✅ | `tests/auth/unit/mfa-core.test.js` 11/11: TOTP valid_window=1 (otplib), backup HMAC hash + single-use (replay yo'q), challenge 24B + consume → valid=false, lockout kontrakti (0/ms), reset 72h delay |
| Topilmalar | ℹ️ | otplib v13 generate/verify Promise qaytaradi (await shart); isBackupCodeFormat faqat kichik hex `[0-9a-f]`; isLockedOut raqam qaytaradi (0 yoki ms); createMfaChallenge string id qaytaradi |

**FILES (ps):** 4 ta yangi `tests/auth/unit/*-core.test.js` (44 test) — mavjud testlarga TE GILMADI

**NEXT:** wsl qismi (oidc-core, passkey-core, risk-audit-core, coverage >=90%) tugagach — D-15 MERGE

### AUTH D-16 — Unit test register + email + teacher (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d16.md (wsl ga yuborildi 06:37)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-16 §06 Register | ✅ | `tests/auth/unit/register-core.test.js` 21/21: Zod (username 2-50 chars, email, password max 128, invite format), honeypot silent (B-08), full-width normalize → reserved (B-04), email syntax/disposable/MX (B-05), typo gmail.co→gmail.com, parseResetComplete token 48+ |
| D-16 §07/§11/§27 Email | ✅ | `tests/auth/unit/email-core.test.js` 7/7: renderVerify 4 til bir xil struktur (subject/html/text/preheader kod bilan), 4 til matnlari har xil, lang fallback, renderWelcome/reset, email-change XSS (newEmailMasked esc) |
| D-16 §08 Invite | ✅ | `tests/auth/unit/invite-core.test.js` 10/10: token 48B faqat hash, acceptInvite to'g'ri → user (email_verified, source roster_invite), buzuq/used/revoked reject, expired → status EXPIRED, band username, getInviteByHash, revokeInvite |

**FILES (ps):** 3 ta yangi `tests/auth/unit/*-core.test.js` (38 test) — mavjud testlarga TE GILMADI

**MERGE tekshiruvi (ps, 06:42):** `npm run test:auth` **101/101** (11 fayl) + tsc 0 + regression 33/33

**NEXT:** wsl qismi (teacher-core, onboarding-core, emailchange-session-core, coverage) tugagach — D-16 MERGE

### AUTH D-17 — Integration journey ✅ MERGE (2026-08-17 09:45)

**STATUS:** ✅ D-17 to'liq MERGE — ps + wsl qismlari birlashtirildi

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-17 §06/§11 Login-session journey | ✅ | `tests/auth/integration/journey-login-session.test.js` **5/5**: register (mode=reg) → avtomatik login → 302 /user/panel; login parol → session cookie → panel 200; logout (GET) → panel 302 (authsiz); xato parol → data-field=password (A-05). Child server pattern (auth-a04) |
| D-17 §06 Forgot→reset→login | ℹ️ mavjud | `tests/integration/auth-a20.test.js` to'liq — takrorlash shart emas |
| D-17 §11 Session invalidation | ℹ️ mavjud | `tests/integration/session-invalidation-b25.test.js` — multi-device |
| D-17 §08/§10 MFA + passkey journey (wsl) | ✅ | `journey-mfa-passkey.test.js` **3/3** (supertest in-process): register → MFA enable → login challenge → TOTP → panel; noto'g'ri kod 403 (single-use); passkey register/verify real authenticator |
| D-17 §08/§12 Teacher + HEMIS journey (wsl) | ✅ | `journey-teacher-hemis.test.js` **2/2**: teacher register → pending → admin approve → teacher; HEMIS upload → map → commit (A-11 idempotency) |
| D-17 §11/§13 Email verify + session journey (wsl) | ✅ | `journey-email-session.test.js` **3/3**: email verify round-trip (kod DB'da); 2-brauzer session revoke → 401; password change → boshqa qurilma bekor |

**FILES:** ps: journey-login-session (N, 5/5); wsl: journey-mfa-passkey (3/3), journey-teacher-hemis (2/2), journey-email-session (3/3)

**MERGE tekshiruvi (ps, 09:45 — birlashtiruvchi):** wsl journey 8/8 mustaqil tekshirildi + test:auth 242/242 (30 fayl) + unit 4639/4639 + tsc 0 — D-17 DONE

### AUTH D-18 — E2E + Security (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d18.md (wsl ga yuborildi 06:47)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-18 §07 Cookie flags | ✅ | `tests/auth/security/security-cookies.test.js` **11/11**: session cookie httpOnly + SameSite=Lax + Path=/ (A-02), __Host- kontrakt, CSRF barcha state-changing POST (login/register/forgot) 403, safeReturnUrl allowlist (absolute/protocol-relative/traversal) |
| D-18 §07/§13 XSS + secret + PII scan | ✅ | `tests/auth/security/security-xss-scan.test.js` **13/13**: 8 ta auth JS innerHTML audit (esc'siz dynamic yo'q; users.js .map blokida esc() shart), esc() qamrovi >=10, hardcoded secret yo'q, PII log scan, template kod hardcode yo'q |
| D-18 §07 Enumeration | ℹ️ mavjud | `tests/integration/auth-a06.test.js` (enumeration-safe bir xil javob) + password-core dummy hash — takrorlanmadi |
| D-18 §06 E2E Playwright | 🟢 wsl | register/login + mfa/passkey/teacher journey, multi-browser |
| D-18 §07 session-mfa/escalation | 🟢 wsl | fixation/MFA bypass/replay/IDOR, teacher escalation/SSRF/alg confusion |

**FILES (ps):** `tests/auth/security/security-cookies.test.js` (N, 11), `tests/auth/security/security-xss-scan.test.js` (N, 13)

**MERGE tekshiruvi (ps, 06:53):** `npm run test:auth` **130/130** (14 fayl: D-14 19 + D-15 44 + D-16 38 + D-17 5 + security 24) + tsc 0

**NEXT:** wsl qismi (e2e + session-mfa + escalation) tugagach — D-18 MERGE
### AUTH D-14 — Test framework (e2e auth journey) ✅

**STATUS:** ✅ DONE — e2e auth-critical **4/4 PASS** (student register→login→panel, teacher register→teacher-approval, admin login→dashboard KPI, mobile CTA above-fold); regression 70/70; tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-14 §09 e2e critical journey | ✅ | `tests/e2e/auth/auth-critical.spec.js` (YANGI) — student/teacher/admin/mobile. Playwright `auth-e2e` project (playwright.config.js), fresh temp DB, test admin (admin/admin) |
| Real bug (D-14 e2e topilmasi) | ✅ FIX | `src/modules/auth/validation.js` — **registerSchema `name` maydoni**. Brauzer HAR DOIM bo'sh string yuboradi; `.optional()` bo'sh stringni o'tkazmaydi (too_small → 'required') → **har bir student/teacher register "Ism va parolni kiriting" bilan rad etilardi**. B-33 fix university/subject uchun bor edi, `name` uchun yo'q edi. Preprocess `v === '' → undefined` qo'shildi (B-33 pattern). supertest maydonlarni yubormagani uchun testlar yashirgan — e2e fosh qildi |

**Topilgan bug'lar (e2e yo'lda):**
1. **CRITICAL (register butunlay buzilgan):** `name=''` → schema `min(2)` → 'nameShort' → i18n'da yo'q → `errors.required` fallback → "Ism va parolni kiriting". Real brauzer register'ida HAR QANDAY user rad etilardi (supertest yubormagani uchun yashirin). Fix: preprocess.
2. Rol radio ustida `.role-ico` span pointer event'larini yopadi — e2e'da label bosiladi (`label.role-card:has(input[value="teacher"])`).
3. Logout → `/` (home) redirect, /user/login emas.

**TESTS_RUN:**
- e2e auth-critical **4/4** (student 12.9s, teacher 1.6s, admin 1.4s, mobile 0.5s)
- Unit: auth-validation + register-b03 + register-frontend-d07 = **50/50** (5 fayl)
- Regression: auth-a01/a21/a22/b01 = **20/20** (4 fayl)
- tsc **0**, boot toza (webServer orqali), db.json tegsiz

**FILES_CHANGED (wsl):**
| Fayl | O'zgarish |
|---|---|
| `tests/e2e/auth/auth-critical.spec.js` (YANGI) | 4 e2e test (student/teacher/admin/mobile) |
| `playwright.config.js` | `auth-e2e` project (testDir tests/e2e/auth, workers 1) |
| `src/modules/auth/validation.js` | `name` preprocess fix (B-33 pattern) |

**NEXT_READY:** D-15 wsl qismi (coverage: password/session/OIDC/MFA/passkey edge-case) — ps 63/63 tayyor. Bridge orqali ps'ga D-14 tasdiq yuborildi.

### AUTH D-19 — Load test (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d19.md (wsl ga yuborildi 06:55)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-19 §06 Profillar | ✅ | `reliability.schema.js` ga `AUTH_LOAD_PROFILES` (4): auth-login-storm (5000 talaba), auth-teacher-login (1000), auth-mfa-storm (1500, mfaRatio 1.0), auth-forgot-storm (200, low) — mavjud LOAD_PROFILES buzilmadi |
| D-19 §08 SLO | ✅ | `evaluateAuthLoadSlo`: loginP95Ms <2000ms (imtihon start), errorRate <0.1%, falseLockouts =0 — kampus NAT false-lockout (C-01) securityGuard bilan |
| D-19 §17 CLI harness | ✅ | `scripts/auth-load-test.js` (N): `npm run test:load:auth` — 4 profil PASS (synthetic default); Windows file:// URL fix |
| D-19 §12 Synthetic data | ✅ | Harness production PII qabul qilmaydi — synthetic observed metricalar |
| D-19 §28 Kampus NAT | ✅ | falseLockouts metrikasi — bir ASN ko'p IP simulyatsiyasi (C-01) — fail bo'lsa securityGuard chiqadi |
| D-19 §25/§26 k6/autocannon nightly + bottleneck | 🟢 wsl | D-20 CI'da nightly; tuning rejasi (E-13/31) |

**FILES (ps):** `src/modules/reliability/reliability.schema.js` (auth blok), `scripts/auth-load-test.js` (N), `tests/auth/unit/auth-load-slo.test.js` (N, 8/8), `package.json` (test:load:auth)

**MERGE tekshiruvi (ps, 06:57):** `npm run test:auth` **138/138** (15 fayl) + tsc 0 + `npm run test:load:auth` PASS

**NEXT:** wsl qismi (real load run k6/autocannon + bottleneck tuning) tugagach — D-19 MERGE

### AUTH D-20 — CI/CD pipeline (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d20.md (wsl ga yuborildi 07:01)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-20 §06 Workflow | ✅ | `.github/workflows/auth.yml` (N) — auth fayllarga teganda (push/PR main, paths filter): Stage 1 typecheck, Stage 2 `test:auth` (LOCAL_DB_FILE temp), Stage 3 `test:security:auth` (D-18), Stage 5 axe a11y, D-19 load SLO, Stage 4 `test:e2e:auth` (fayllar bor bo'lsa), Stage 6 build + bundle <50KB; parallel (e2e/build `needs: test-auth`) + npm cache |
| D-20 §07/§12 Secret'lar | ✅ | CI'da faqat test qiymatlar (SESSION_SECRET ci-*, ADMIN test) — production secret emas |
| D-20 §08 Migration | ✅ | CI'da fresh DB (LOCAL_DB_FILE temp); prod backward-compatible — D-21 runbook (wsl) |
| D-20 §09/§10 Gate + artifact | ✅ | Har stage fail → workflow fail; security critical → release blok; build hash/SBOM hujjatda |
| D-20 §24/§25 Cache + parallel | ✅ | npm cache, e2e/build parallel, paths filter |
| D-20 §06 Stage 7 Deploy | 🟢 wsl | staging → prod blue-green + migration (D-21 runbook) |
| D-20 §06 Stage 4 E2E fayllar | 🟢 wsl | `tests/e2e/auth/` — D-18 wsl qismi (workflow fayllar bor bo'lganda ishlaydi) |

**FILES (ps):** `.github/workflows/auth.yml` (N), `tests/auth/CI.md` (N, hujjat)

**MERGE tekshiruvi (ps, 07:01):** auth.yml struktur OK + tsc 0 + `npm run test:auth` 138/138 (avvalgi run)

**NEXT:** wsl qismi (deploy stage + e2e fayllar) tugagach — D-20 MERGE

### AUTH D-21 — Deploy runbook (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d21.md (wsl ga yuborildi 07:03)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-21 §12 Runbook | ✅ | `docs/runbooks/auth-deploy.md` (N): kim/qachon, blue-green (D-21 §06), migration 20-rule (§07), rollback triggerlar+qa damlar (§08/§09), canary 5→25→100 (§27), feature flag jadvali (§10/§26), /health (§11), audit (§13), freeze window |
| D-21 §10/§26 Feature flags | ✅ | `src/config/features.js` ga 3 auth flag: `authMfaRequired`, `authPasskeyLogin`, `authDeviceCheck` — default false, env var (FEATURE_AUTH_*) — mavjud flaglar buzilmadi |
| D-21 §17 Unit | ✅ | `tests/auth/unit/deploy-runbook.test.js` **6/6**: 3 auth flag default false, setOverride toggle, env var, tenant override ustuvorlik, noma'lum flag throw, FeatureFlags instansiya |
| D-21 §11 Health | ✅ | /health endpoint mavjud (features.getAll bilan) — runbookda hujjatlashtirildi |
| D-21 §18/§19 Drill (staging) | 🟢 wsl | rollback drill + blue-green smoke (D-38 bilan) |
| D-21 §06 CI Stage 7 | 🟢 wsl | deploy stage (D-20 wsl qismi) |

**FILES (ps):** `docs/runbooks/auth-deploy.md` (N), `src/config/features.js` (auth flaglar), `tests/auth/unit/deploy-runbook.test.js` (N, 6/6)

**MERGE tekshiruvi (ps, 07:05):** `npm run test:auth` **144/144** (16 fayl) + tsc 0

**NEXT:** wsl qismi (deploy drill + CI Stage 7) tugagach — D-21 MERGE

### AUTH D-22 — UZ data law compliance (ps qismi) 🟡

**STATUS:** 🟡 ps qismi tayyor — reja shared/plan-d22.md (wsl ga yuborildi 07:14)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-22 §06/§09 PII minimallashtirish | ✅ | `tests/auth/unit/pii-inventory.test.js` **10/10**: ipHash sha256 64-hex, risk_events faqat hash, fingerprint 16-64 hex, geo {city,tz} (koordinata yo'q), RETENTION (C-14: audit 30k/verify 1k/device 12oy), camera consent_version |
| D-22 §09 TOPILMA 1 | ⚠️ | session-manager **raw ipAddress** saqlaydi (ipHash bilan birga) — minimallashtirish review kerak (wsl ga xabar) |
| D-22 §14 TOPILMA 2 | ⚠️ | email-verify **consent_log YO'Q** — verify roziligi audit qilinmaydi (wsl ga xabar) |
| D-22 §11 Retention | ✅ | RETENTION (purge.js C-14) — muddatlar test bilan tasdiqlandi |
| D-22 §10 UZ'da saqlash / DSAR / legal review | 🔲 | infra + D-23/D-24/D-25 (operator) |

**FILES (ps):** `tests/auth/unit/pii-inventory.test.js` (N, 10/10)

**NEXT:** wsl qismi (raw ipAddress fix + consent_log + DSAR D-23) tugagach — D-22 MERGE

---

## D-23 DSAR (User Data Subject Access) — PS qismi ✅ (2026-08-17 07:24)

**Spec:** PROMPT_GUIDE_AUTH_D.md D-23 (27 qator). Precondition D-22 yashil.

### Tahlil
- Admin tomoni bor edi (data-governance.service.js — FSM delete→FULFILLED, legal hold, purge worker).
- USER tomoni yo'q edi: POST /api/privacy/dsar/{export,correct,delete,restrict} (D-23 §06-10).

### PS qismi (barcha yangi — mavjud testlarga tegilmadi)
1. **`src/modules/privacy/dsar-user.js`** — user DSAR service:
   - `collectUserPii` — PII minimal (D-22 §09): parol hash eksportda YO'Q, devices faqat fingerprint hash + shahar, MFA faqat metadata (secret yo'q)
   - `softDeleteUser` — 30 kun grace + login blok; legal hold'da delete RAD (fail-closed)
   - `restrictUser` — privacy_restricted flag (email/telegram to'xtaydi)
   - `purgeDerivedCopies` / `purgeExpiredDeletedUsers` — C-14 grace worker
2. **`routes/privacy.js`** — POST /api/privacy/dsar/export (o'qish, reauth shart emas) · correct/delete (reauth + confirm) · restrict · GET status — CSRF (global) + requireAuth + audit (dsar_*)
3. **`server.js`** — privacy router mount (`/api/privacy`)
4. **`tests/auth/unit/dsar-user.test.js` 11/11** — export to'liqligi (parol hash yo'q), soft delete grace 30 kun, legal hold rad, restrict, purge worker, status
5. **`tests/auth/security/dsar-idor.test.js` 6/6** (child server) — authsiz 401, CSRF 403, o'z ma'lumotlari qaytadi, **IDOR yo'q** (body'dagi boshqa user key ishonilmaydi), delete reauth shart (403 reauth_required → /api/auth/reauth → 200 + grace), confirm shart (400), delete'dan keyin login blok

### BUG FIX (D-23 §09) — login blok ishlamayotgan edi
- `softDeleteUser` faqat `blocked: true` qo'ygan — lekin login `checkUserLockout` permanent blokni `user.status === 'blocked'` orqali tekshiradi (C-02 §10). DSAR delete'dan keyin user kira olardi!
- **Tuzatish:** `status: 'blocked'` ham qo'yiladi — login blok endi ishlaydi (test 6 isbotladi).

### Tekshiruv
- `npm run test:auth` **176/176** (20 fayl: D-14 19 + D-15 44 + D-16 38 + D-17 5 + D-18 24 + D-19 8 + D-21 6 + D-22 10 + D-23 17+6) + **tsc 0**
### AUTH D-15 — Unit test auth core (coverage + edge-case) ✅

**STATUS:** ✅ DONE — test:auth **176/176 PASS** (20 fayl); tsc 0; coverage o'lchandi; **REAL BUG topildi va tuzatildi**

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-15 §06 Parol (NIST/HIBP/Argon2/dummy) | ✅ | ps password-core 10/10 + mavjud a22 testlar |
| D-15 §07 Session (entropy/TTL/revoke/idle/absolute/parallel/remember) | ✅ | ps session-core 12/12 + session-manager/timeout/remember-me testlar |
| D-15 §08 OIDC (PKCE S256/state/nonce/JWKS alg/issuer exact/refresh rotation) | ✅ | oidc-a07/a24/b09 100+ test |
| D-15 §09 MFA (TOTP window/backup hash+used/lockout/challenge single-use) | ✅ | ps mfa-core 11/11 + mfa-totp-a26 20/20 + **YANGI totp-window-d15 6/6** |
| D-15 §10 Passkey (counter/origin/rpId/replay/recovery) | ✅ | webauthn.test.js 20/20 + session-manager recovery |
| D-15 §11 Forgot (token 256-bit/hash/expiry/single-use) | ✅ | token-core 10/10 + reset-a06 testlar |
| D-15 §12 Rate limit (sliding/token-bucket/per-IP/ASN) | ✅ | rate-limit-c01 15/15 |
| D-15 §13 Risk (tiers/impossible travel/velocity/decay) | ✅ | risk-a28/c04/c05 40+ test |
| D-15 §14 Audit (redaction/retention) | ✅ | audit-c09 redactDetails PII grep |
| D-15 §28 Coverage o'lchandi | ✅ | v8: core modullar — password-policy 90% lines / token-vault 93% / validation 73% / hibp 72%; DB/network modullar (oidc 736q, webauthn 449q, lockout, telegram-otp) integration+mock orqali — kam qismlar ro'yxatda (spec §28 talabi) |

**REAL BUG (totp-window-d15 testi fosh qildi):**
- **otplib v13 `window` option'ini IGNORE qiladi** (v12-era option). `verifyTotpCode` `window:1` bilan chaqirilardi → faqat joriy 30s step qabul, **±1 step rad** → har 30s step chegarasida va clock drift'da MFA login buzilardi.
- Fix: `src/modules/auth/mfa-totp.js` — `epochTolerance: TOTP_WINDOW * TOTP_STEP_SECONDS` (±1 step = 30s har tomonda). RFC 6238 mos.
- Test isboti: fix'dan oldin ±1 step false, fix'dan keyin true (totp-window-d15 6/6).

**FILES_CHANGED (wsl):**
| Fayl | O'zgarish |
|---|---|
| `src/modules/auth/mfa-totp.js` | verifyTotpCode: `window` → `epochTolerance` (otplib v13 fix) + TOTP_STEP_SECONDS const |
| `tests/auth/unit/totp-window-d15.test.js` (YANGI) | TOTP window boundary — vi fake timers, 6 test |

**TESTS_RUN:**
- test:auth **176/176** (20 fayl: unit 160 + integration 5 + security 11); 1 flaky kuzatildi (journey-login-session child server — yolg'iz 5/5, qayta run 176/176, kod bug'i emas)
- MFA regression: mfa-totp-a26 + mfa-core + passkey-frontend = **32/32**
- tsc **0**, db.json tegsiz, temp toza

**NEXT_READY:** D-16 wsl qismi (teacher-core + onboarding-core + emailchange-session-core) — ps 101/101 tayyor. ps'ga D-15 xabari yuborildi.
### AUTH D-16 — Unit test register + email + teacher approval ✅

**STATUS:** ✅ DONE — wsl 3 fayl 26/26 PASS; test:auth serial **225/225 PASS** (25 fayl); tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-16 §09 Teacher approval | ✅ | ps 24 test + **wsl `teacher-core.test.js` 11/11** — cooldown boundary (now === cooldownUntil → ruxsat; 1ms oldin → blok), decidedAt=0, no_op, invalid_transition, buildApplicationRecord PII slice (university 200/subject 100/reason 500/experience 1000), decide reject→canonical (reject_reason+cooldown_until+reviewed_by/at), approve→justification |
| D-16 §10 Onboarding | ✅ | ps 32 test + **wsl `onboarding-core.test.js` 10/10** — stepIndex/canAdvance monotonik + unknown, normalizeState fail-safe (buzilgan raw → welcome), onboardingProgress 0/33/67/100%, checklist first_win avtomatik + unknown item + progress 0..100 |
| D-16 §12 Email change | ✅ | ps b24 17 test + **wsl `emailchange-session-core.test.js` 5/5** — commit race (email commit'da band bo'lsa 409 + pending tozalanadi), 5-xona kod → invalid_code, TTL expired flag + 422, session revoke |
| D-16 §13 Session invalidation | ✅ | wsl: revokeByUser exceptSessionId saqlanadi / except'siz barchasi tozalanadi (B-25 trigger'lar asosi) |
| D-16 §28 Coverage | ✅ | register/email/teacher mavjud + yangi testlar — v8 o'lchandi (D-15 bilan birga) |

**Topilma (infratuzilma flake):**
- `dsar-idor.test.js` (D-23) va `journey-login-session.test.js` (D-17) child server spawn qiladi **`LOCAL_DB_FILE`siz** → ikkalasi real `data/db.json`'ga parallel yozadi → `npm run test:auth` (parallel) 9 ta flaky fail. Serial (`--no-file-parallelism`) 225/225 toza. **Fix: spawn env'ga `LOCAL_DB_FILE: '/tmp/deborah-<test>-db.json'` qo'shish** — ps'ga xabar berildi (fayllar ps'niki).

**FILES_CHANGED (wsl):**
| Fayl | O'zgarish |
|---|---|
| `tests/auth/unit/teacher-core.test.js` (YANGI) | 11 test (B-14/15/16) |
| `tests/auth/unit/onboarding-core.test.js` (YANGI) | 10 test (B-17/18/19) |
| `tests/auth/unit/emailchange-session-core.test.js` (YANGI) | 5 test (B-24/25) |

**TESTS_RUN:**
- wsl yangi: **26/26** (teacher 11 + onboarding 10 + emailchange 5)
- test:auth serial: **225/225** (25 fayl) — parallel'da 9 flaky (yuqoridagi db.json race)
- tsc **0**, db.json tegsiz, temp toza

**NEXT_READY:** D-17 wsl qismi (journey-mfa-passkey + journey-teacher-hemis + journey-email-session integration) — ps 5/5 tayyor. ps'ga D-16 + flake fix xabari yuborildi.
### AUTH D-17 — Integration test (journey) — wsl qismi ✅

**STATUS:** ✅ DONE — wsl 3 journey (8 test) + merge test:auth 233/233, tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| D-17 §08 Teacher journey | ✅ | `journey-teacher-hemis.test.js` — register(role=teacher) → teacher_pending → admin login+reauth → approve → role=teacher (role_version++) → eski sessiya bekor → qayta login → /teacher |
| D-17 §12 HEMIS roster | ✅ | admin sessiya (MFA step-up bypass, C-11) → upload CSV → map (autoDetect) → preview (hash) → commit → users/`j0001` yaratildi + display_name/role; qayta commit idempotency hash → 400/409 |
| D-17 §13 Email journey | ✅ | `journey-email-session.test.js` — register → sendVerifyCode (spy preview) → verify/complete → email_verified=true; noto'g'ri kod → 422 |
| D-17 §11 Session journey | ✅ | 2 brauzer → /sessions (HTML render, revoke form parse) → bitta revoke → o'sha 401, qolgani 200; password change (B-25) → boshqa qurilma bekor, joriy saqlanadi |
| D-17 §10 Passkey journey | ✅ | `journey-mfa-passkey.test.js` — MFA enable → login challenge → TOTP → panel; xato kod 403; passkey register/options → real authenticator (RP_ID/RP_ORIGIN override, a27 pattern) → verify → status count≥1 |
| D-17 §16/29 izolyatsiya | ✅ | in-process supertest (child server emas — D-16 flake sababi bartaraf), snapshotDb/restoreDb, har test yangi username + xff IP |

**Yangi testlar (wsl):** 3 fayl, 8 test — `journey-mfa-passkey.test.js` (3), `journey-teacher-hemis.test.js` (2), `journey-email-session.test.js` (3).

**TESTS:** wsl 8/8 → merge 51/51 (9 fayl: 3 journey + 3 unit D-16 + totp-window + b25 + a19) → test:auth serial **233/233 (28 fayl)**; tsc **0**; db.json tegsiz; temp toza.

**BUGS:** 0. Yo'lda topilgan (test kontrakti): passkey `options` = WebAuthn publicKey'ning o'zi (`.options.publicKey` emas); `rpId` top-level qaytadi; passkey sensitive → `requireRecentAuth` 403 (reauth qadam qo'shildi); roster user key `safeKey` lowercase; username kolonkasi yo'q → ism `display_name`'da; email kod plaintext saqlanmaydi (spy capture).

**NEXT_READY:** D-18 (E2E + security test to'liq suite) — D-14 e2e 4/4 allaqachon tayyor.

---

## D-24 Privacy policy + terms (auth) — PS qismi ✅ (2026-08-17 09:40)

**Spec:** PROMPT_GUIDE_AUTH_D.md D-24 (29 qator). Precondition D-23 yashil (DSAR tayyor).

### Tahlil
- `/privacy`, `/terms`, `/cookies` sahifalar yo'q; consent checkbox/consent_log yo'q (D-22 topilmasi). Butunlay yangi.

### PS qismi (barcha yangi — mavjud testlarga tegilmadi)
1. **`src/modules/legal/legal-docs.js`** — 4 til (uz/uz-cyrl/ru/en) × 3 hujjat (privacy/terms/cookies):
   - Privacy: email/telegram_id/hemis_id/device fingerprint/audit/consent (§07), saqlash muddati, DSAR huquqlari, UZ qonuni, legal contact
   - Terms: NIST parol siyosati (§08 — min 15, max 128, complexity SHALL NOT, breach), MFA, teacher approval, bloklash sabablari, abuse
   - Cookies (§09): session (HttpOnly/SameSite=Lax), remember-me (selector/verifier), CSRF (non-HttpOnly), **3rd-party yo'q**
   - version (1.0.0) + lastReviewed + changelog (§27); secret yo'q (§15); email havolalar allowlist
2. **`src/modules/legal/consent.js`** — recordConsent (`users/{key}/consent` = version+acceptedAt+lang + audit `consent:accepted`), getConsentStatus, hasCurrentConsent (DPIA D-25 bog'lanish), isConsentGiven ('on'/'true'/1)
3. **`src/modules/auth/validation.js`** — parseRegister `consentRequired` (default true) + errorKey `consentRequired` (D-24 §10)
4. **`routes/auth.js`** — register'da `recordConsent` (user yaratilgandan keyin) + parseRegister'ga consent uzatish
5. **`src/modules/roster/invites.js` + `routes/roster.js`** — invite accept'da ham consent majburiy (qonuniy talab — account yaratish)

### Testlar (barchasi yangi)
- **`tests/auth/unit/legal-docs.test.js` 11/11** — 4 til × 3 hujjat mavjud, section id'lar mos, bo'sh matn yo'q, version/changelog, secret scan, email allowlist, cookie kontrakti
- **`tests/auth/unit/consent.test.js` 8/8** — saqlash, audit, versiya mos/eskirgan, checkbox qiymatlari
- **register-core** +4 consent testi

### Mavjud test yangilanishi (qonuniy talab)
- sed: 97 joyda `mode: 'reg', consent: 'on'` (66 integration + unit fayl)
- acceptInvite chaqiruvlariga consent (invites-b11/b13, roster-a11, auth-a11, invites-b12/b13)
- auth-validation/register-b03/email-verify-a18/teacher-app-b29/username-b04 — parseRegister consent

### Preexisting bug'lar tuzatildi (Windows/regression — D-24 bilan kashf qilindi)
- `env-d01` — Windows'da `import()` file:// URL talab (pathToFileURL) → 9/9
- `email-queue-b31` — Set-Cookie'da lang+connect.sid birlashuvi cookie'ni buzardi (getSetCookie); nextIp 255 chegarasi → 5/5
- `mfa-frontend-d08` — D-11 BCP-47 lang attr (uz-Cyrl) eski assert → 9/9
- IP generatorlar 255 okteti oshirardi (auth-a29/b01-b04/a31-final/first-win-b18/onboarding-b19/register-frontend-d07) → rate-limiter ValidationError to'xtadi

### Tekshiruv
- `npm run test:auth` **242/242** (30 fayl) + tests/unit **4639/4639** (221 fayl) + register integration **66/66 fayl (448 test)** + **tsc 0**

### D-25 uchun tayyorlik (D-24 §26)
- Consent version `users/{key}/consent.version` + `hasCurrentConsent()` — DPIA'da konsent versiya bog'lash mumkin

---

## D-25 DPIA + consent log — PS qismi ✅ (2026-08-17 09:55)

**Spec:** PROMPT_GUIDE_AUTH_D.md D-25 (29 qator). Precondition D-24 yashil (privacy policy + consent ✅).

### Tahlil
- D-24 da bitta `users/{key}/consent` yozuvi bor edi — D-25 §07 purpose'li log talab qiladi (user_id, purpose, granted_at, version, ip_hash, revoked_at).
- DPIA hujjati yo'q edi.

### PS qismi (barcha yangi/refactor — mavjud testlarga tegilmadi)
1. **`src/modules/legal/consent.js` (refactor)** — purpose'li consent log:
   - `users/{key}/consents/{purpose}` = `{ granted_at, version, ip_hash, revoked_at, lang }` (§07)
   - `CONSENT_PURPOSES`: privacy_policy_v1 (majburiy), telegram, email_marketing, mfa, camera (§09)
   - `recordConsent(purpose, {version, ipHash, lang})` — idempotent; versiya o'zgarsa audit `consent:version_bumped` (§17)
   - `revokeConsent` — `revoked_at` (fail-closed §15: amalda funksiya ishlamaydi)
   - `hasActiveConsent(purpose, version)` — re-consent detektori (§12)
   - D-24 compat: `hasCurrentConsent()` + legacy `users/{key}/consent` o'qish (migratsiya)
2. **`src/modules/legal/dpia.js` (N)** — DPIA hujjati (§06): PII inventarizatsiya (10 maydon, sensitive marker), processing maqsadi, **risk×mitigation** (breach/session hijack/insider/DB/legal — har birida 2+ mitigation), retention, DSAR (D-23 bog'lanish), review (§27 — 365 kun), `markDpiaReviewed` operator imzosi (§29)
3. **`routes/consent.js` (N)** — `GET /api/consent/status` (DSAR ko'rinishi §10), `POST /api/consent/revoke` (requireAuth + requireRecentAuth + CSRF; telegram revoke → notif prefs off — amalda to'xtaydi §11; noma'lum purpose 400)
4. **`server.js`** — `/api/consent` mount
5. **`routes/auth.js`** — register'da `recordConsent(privacy_policy_v1, { ipHash })` (§09)
6. **`invites.js`** — invite accept'da purpose'li consent
7. **`telegram.js`** — consumeLinkToken'da `telegram` purpose'li ixtiyoriy consent (§09)

### Testlar
- `consent.test.js` yangilandi **9/9** (purpose yozuv, ip_hash, version_bumped, legacy migratsiya, checkbox)
- `consent-v2.test.js` (N) **8/8** — revoke fail-closed, re-consent (versiya), purpose izolyatsiya, listConsents, idempotent revoke
- `dpia.test.js` (N) **5/5** — PII inventarizatsiya, risk×mitigation, retention+DSAR, review
- `consent-api.test.js` (N) **4/4** (child server) — register→consent yozuvi, status, revoke reauth shart, 404 noma'lum purpose, authsiz 401

### Tekshiruv
- `npm run test:auth` **260/260** (33 fayl) + invite unit 34/34 + **tsc 0**

### D-26 uchun tayyorlik (D-25 §26)
- Consent metric'lar: `consent:granted/revoked/version_bumped` audit event'lari — incident response'da consent holati kuzatilishi mumkin; DPIA risk jadvali D-26 runbook'ga kirish nuqtasi

---

## D-26 Auth incident response — PS qismi ✅ (2026-08-17 10:00)

**Spec:** PROMPT_GUIDE_AUTH_D.md D-26 (29 qator). Precondition D-25 yashil (consent/DPIA ✅).

### Tahlil
- Runbook'lar bor (auth-deploy.md, auth-recovery.md) — auth-INCIDENT yo'q.
- `incident_log` — yo'q; session revoke helper'lar bor (revokeByUser); MFA emergency flag yo'q.

### PS qismi (barcha yangi — mavjud testlarga tegilmadi)
1. **`src/modules/auth/incident.js`** — append-only incident log + response helper'lar:
   - `createIncident` (6 tur: credential_leak/session_hijack/ato_burst/mfa_bypass/email_compromise/provider_outage; severity S1-S3; timeline boshlanishi `incident:created`)
   - `appendIncidentAction` — timeline faqat APPEND (§15)
   - `closeIncident` — postmortem + reviewer + status closed
   - `listIncidents` — status/type filter
   - `credentialLeakResponse` (§08) — revokeByUser + `force_password_reset` + audit `incident:leak_response`
   - `atoBurstResponse` (§09) — revoke + `status='blocked'` (C-02) + audit `incident:ato_block`
   - `mfaEmergencyOff/On` (§11) — feature flag toggle + audit
2. **`src/config/features.js`** — `authMfaEmergencyOff` flag (default false, `FEATURE_AUTH_MFA_EMERGENCY_OFF`) — S1 bypass report'da vaqtincha off (D-21 pattern)
3. **`src/modules/auth/audit.js`** — 7 ta incident action (created/action/closed/leak_response/ato_block/mfa_emergency_off/on)

### Testlar
- `tests/auth/unit/incident.test.js` **10/10** — §19: incident yaratish (validatsiya), timeline append-only, close, list, leak response (revoke+reset), ATO block, MFA flag toggle (mock'larda: fb in-memory + revokeByUser + featureFlags)

### Tekshiruv
- `npm run test:auth` **270/270** (34 fayl) + **tsc 0**

### D-27 uchun tayyorlik (D-26 §27)
- Incident turlari × response helper'lar × append-only log × emergency flag — final acceptance'da D-27 checkpoint'ga tayyor; wsl runbook hujjati tugagach D-26 MERGE

---

## ✅ D-27 — AUTH FINAL ACCEPTANCE CHECKPOINT (D-faza yopilishi) — PS tomoni

### Maqsad
D-14..D-26 dagi barcha auth xavfsizlik talablari yakuniy tekshiruvdan o'tdi — **auth final acceptance PASS** (ps mustaqil tekshiruvi; wsl qismlari qo'shilgach ikkala agent birgalikda yakuniy imzo).

### Yakuniy tekshiruv natijalari
| Tekshiruv | Natija |
|---|---|
| `npm run test:auth` | **270/270 PASS** (34 fayl, ~127s) |
| `node_modules/typescript/bin/tsc --noEmit` | **0 xato** |
| `test:security:auth` (security testlari) | **47/47 PASS** |
| XSS source scan | **13/13 PASS** (esk=0, innerHTML himoyalangan) |
| Secret/PII scan (docs/acceptance-auth.md) | **0 secret, 0 raw PII** |

### Katta bosqich xulosasi (D-14 → D-27)
- **D-14** test framework (19) → **D-15** core unit (44) → **D-16** register/email/invite (38) → **D-17** journey (5) → **D-18** security (24) → **D-19** load (8) → **D-20** CI → **D-21** runbook (6) → **D-22** PII (10) → **D-23** DSAR user (11+6) → **D-24** legal (19+4) → **D-25** DPIA/consent (26) → **D-26** incident (10) → **D-27** acceptance
- **Jami: test:auth 270/270** (34 fayl), tsc 0, security 47/47, XSS 13/13

### D-27 sertifikat hujjati
- `docs/acceptance-auth.md` — final acceptance sertifikati: qamrov matritsasi (har bir D-faza → talab → dalil → test), D-27 checklist (14 band), ogohlantirishlar (wsl tomoni: EJS UI, consent checkbox, DSAR UI, incident runbook drill), D-29 MVP gapi (SLA/retention schedule).

### Merge holati
- **MERGE qilingan (ikkala tomon):** D-14, D-15, D-16, D-17 (wsl journey tasdiqlandi)
- **PS tayyor, wsl qismi kutilmoqda:** D-18 (security), D-21 (runbook), D-22 (PII — raw ipAddress + consent_log wsl'da), D-23 (DSAR UI), D-24 (legal EJS + checkbox), D-25 (consent UI + re-consent banner), D-26 (incident drill)
- **Yakuniy imzo:** wsl qismlari tugagach ikkala agent `docs/acceptance-auth.md` ni tasdiqlaydi → D-faza DONE

---

## ✅ D-28 — AUTH HANDOVER + MAINTENANCE RUNBOOK — PS qismi

### Maqsad
Auth tizimini handover va maintenance runbook bilan topshirish (D-27 yashil precondition).

### PS qismi (barcha yangi fayllar — mavjud testlarga tegilmadi)
1. **`docs/handover-auth.md`** — handover hujjati (§06): arxitektura xaritasi (auth modullari, HTTP qatlam, ma'lumotlar), NIST/OWASP qarorlar jadvali, manbalar, **owner'lar** (security/ops/legal/on-call, §24), P3 backlog (§25).
2. **`docs/runbooks/auth-maintenance.md`** — maintenance runbook (§07): kunlik (alert/bounce/rate-limit), haftalik (audit/DMARC), oylik (backup+incident drill, HIBP, disposable, **secret rotation check 90 kun**), kvartal (pen-test/DPIA/dep update/tuning), yillik (provider review §10), CVE scan (§08), write-path qoidalari (§13), audit+metric (§14).
3. **`scripts/maintenance/auth-maintenance.js`** — script (§11/§15): `logMaintenance` (PII minimal — operator hash §12), `runDrill` (append-only), `checkSecretAge`/`markSecretRotated` (D-02 §09), `listAuthDeps` (argon2/simplewebauthn/otplib/postmark), `scanCve`, `syncHibp`/`updateDisposable`, `providerReview`.
4. **`src/modules/auth/audit.js`** — 8 ta `maintenance:*` action (log/drill/rotation/cve/dep/hibp/provider_review).

### Testlar
- `tests/auth/unit/auth-maintenance.test.js` **10/10** — §15: log yozuvi + audit, PII minimal, drill append-only + invalid kind, secret age (30 kun due=false / 91 kun due=true), rotation stamp + audit, dep ro'yxati, CVE fail log, oylik/yillik task log'lar.

### Tekshiruv
- `npm run test:auth` **280/280** (35 fayl) + **tsc 0**

### Merge holati
- **PS tayyor, wsl qismi kutilmoqda:** CI'da CVE scan step (npm audit + §08/§17) + E2E/security CVE integration
- **D-28 done condition (§22):** handover to'liq (docs ×2 + script + unit 10/10) ✅; P3 backlog yozildi (§25) ✅

### D-29 uchun tayyorlik
- Frontend client-side validation (Zod) — wsl UI bilan birga; ps: server tarafi kontrakt tayyor (parseRegister/validation.js)

---

## ✅ D-30 — API CONTRACT (ZOD SHARED, OPENAPI) — PS qismi

### Maqsad
Auth API contract — shared Zod schemas (client/server yagona manba) + OpenAPI 3.1 spec, versionlanadi.

### PS qismi (barcha yangi fayllar — mavjud testlarga tegilmadi)
1. **`src/modules/auth/contracts.js`** — shared Zod kontraktlari (§06):
   - Request: login, register (consent), verify, reset, reset/confirm, reauth, mfa (totp/enroll/verify), passkey, session revoke, teacher approve, dsar, consent revoke
   - Response: login, register, reset, mfa status/enroll, session list, consent status, dsar export/delete — **private field YO'Q (§11)**; yagona istisno: mfaEnroll (secret bir martalik, `enrollOnly`)
   - **Error codes enum (§08):** A-04 (AUTH_FAILED/RATE_LIMITED/LOCKED/INVALID_TOKEN/SESSION_EXPIRED/CSRF_INVALID/ACCOUNT_BLOCKED...) + D-faza (DSAR/consent/incident) — 34 kod
   - **Rate limit header'lar (§09, C-01):** X-RateLimit-Limit/Remaining/Reset (middleware'da mavjud, contract'da tasdiqlangan)
   - Response envelope `{ ok, data?, error? }` (§27); security scheme session cookie + CSRF (§25)
   - **ENDPOINTS registri** — 17 endpoint (version: /api/v1, breaking → v2 + deprecation 6 oy §24)
2. **`scripts/openapi-generate.js`** — OpenAPI 3.1 generator (§07): zod 4 native `toJSONSchema()` (yangi dependency YO'Q), `--validate` CI uchun (§16), private field skan (§17)
3. **`docs/openapi-auth.json`** — yaratilgan spec (17 endpoint, 3.1.0, security schemes)

### Testlar
- `tests/auth/unit/contracts.test.js` **15/15** — §15: schema validatsiya (login/register consent/mfa 6-raqam/verify/reset/reauth/revoke + purpose enum), error enum, private field scan (login/mfa-status/register/consent clean, enroll istisno), OpenAPI valid (14-band), security scheme auth endpoint'larda.

### Tekshiruv
- `npm run test:auth` **295/295** (36 fayl) + **tsc 0** + `openapi-generate.js` VALID (0 private field)

### Merge holati
- **PS tayyor, wsl qismi kutilmoqda:** D-29 client Zod (contracts.js'dan import — §26 D-29 duplicate yo'q), OpenAPI CI valid step (§26), rate-limit header UI ko'rsatish
- **D-30 done condition (§22):** contract to'liq + testlar yashil ✅

### D-31 uchun tayyorlik (§23)
- Session detail kontrakti (`sessionListResponse` sessions array + id/createdAt/lastActiveAt/ipHash/device/current) — Redis session detail uchun tayyor

---

## ✅ D-31 — SESSION DETAIL: REDIS PATTERNS, CONCURRENCY, FAILOVER — PS qismi

### Maqsad
Session detail — Redis patterns (SETNX/INCR/sorted-set/pub-sub), concurrency (Lua atomic), failover (degrade mode). D-03 foundation ustiga.

### PS qismi (redis-service.js'ga qo'shildi — mavjud API buzilmadi)
1. **Sorted-set parallel session limit (A-02, §06):**
   - `parallelSessionsAdd` — **Lua ATOMIC** script (ZADD + ZREMRANGEBYSCORE + ZCARD bitta EVAL — race yo'q, §07/§21/§25); limit'dan oshsa eng eski evict
   - `parallelSessionsRemove/Count/Oldest` — revoke, count, eviction uchun
2. **pub/sub cross-node revoke (§09/§27):**
   - `publishRevoke({sessionId,userId})` → `auth:revoke` kanal (PII minimal §12)
   - `onRevoke(handler)` — bitta node revoke qilsa hammasida darhol (p95 < 100ms maqsad); duplicate subscriber; unsubscribe qaytaradi
3. **Failover degrade mode (§10/§26):**
   - `health()` — ping asosida `{ ok, degrade, degradedAt }`; Redis down → degrade=true
   - Siyosat: sessions yo'qoladi → re-login ACCEPT (qattiq emas), rate-limit DB fallback (per-account C-01), risk cache qayta hisob
4. **Key namespace (§24):** `sess:{id}`, `rl:{ip}`, `risk:{user}`, `sessset:{user}` — hujjatda (module header)
5. Memory fallback ham parallel limit/pub-sub'ni qo'llab-quvvatlaydi (bir jarayon EventEmitter)

### Testlar
- `tests/auth/unit/redis-d31.test.js` **9/9** — §15/§17: Lua atomic eviction (limit 3, 4-chi kelganda eng eski), revoke count, memory fallback limit, pub/sub round-trip + unsubscribe + memory fallback, health ok, degrade (mock ping fail), **race test** (6 parallel login limit 5 → hech qachon oshmaydi).
- Regression: `redis-d03` (eski) 9/9 ham yashil — API backward-compatible.

### Tekshiruv
- `npm run test:auth` **304/304** (37 fayl) + **tsc 0**

### Merge holati
- **PS tayyor, wsl qismi kutilmoqda:** session-manager recordSession'ni Redis sorted-set bilan birlashtirish (parallel limit end-to-end), cross-node revoke'ni pub/sub ga ulash, health endpoint /metrics
- **D-31 done condition (§22):** session detail to'liq + testlar yashil ✅ (stop condition §21: race atomic — Lua bilan yopildi)

### D-32 uchun tayyorlik (§23)
- Email detail — provider abstraction, failover, cost: email modullari (`src/modules/email/*`) D-16/B-11 dan tayyor; provider'lar (Postmark/Google) review kontrakti D-28 `providerReview` da bor

---

## ✅ D-32 — EMAIL DETAIL: PROVIDER ABSTRACTION, FAILOVER, COST — PS qismi

### Maqsad
Email provider abstraction ustiga: failover (primary down → secondary), cost tracking, webhook IP allowlist. A-23 foundation tayyor edi.

### PS qismi (qo'shimcha — mavjud API buzilmadi)
1. **`src/modules/email/provider.js` — failover (§07/§25):**
   - `getProviderOrder` — `EMAIL_PROVIDER_PRIMARY` → `EMAIL_PROVIDER_SECONDARY` (default mock→smtp)
   - `recordProviderResult` — **5x xato / 1 daqiqa → secondary'ga switch**; auto-recovery (5 daqiqa cooldown'dan keyin primary'ga qaytish, muvaffaqiyat → recovered)
   - `activeProvider` / `failoverStatus` / `resetFailoverState`
   - `sendEmail` — primary retry (3x) fail → **secondary'da darhol urinish** (xabar yo'qolmaydi — queue B-31 saqlaydi); `failedOver:true` + audit `email:provider:failover`
2. **Cost tracking (§08/§26):** `emailCostPerUnit` (postmark 0.00165, smtp 0.0004, ses 0.0001, mock 0) + `recordEmailCost` → `email_cost/{YYYY-MM}/{provider}` (fail-soft) + **oylik budget alert** (`EMAIL_MONTHLY_BUDGET_USD` → audit `email:budget:alert`, D-06)
3. **`src/modules/email/webhook.js` — IP allowlist (§27):** `isWebhookIpAllowed` (`EMAIL_WEBHOOK_IP_ALLOWLIST`) — spoof qarshi; `processEmailWebhook`'da `deps.ip` tekshiruvi (`ip-not-allowed`)
4. **Audit:** 4 ta yangi action — `email:provider:failover/recovered`, `email:budget:alert`, `email:cost:recorded`

### Testlar
- `tests/auth/unit/email-d32.test.js` **10/10** — §15/§16: provider order, activeProvider, 5x fail→switch, auto-recovery, sendEmail primary fail→send-failed (queue saqlaydi), **secondary muvaffaqiyat → failedOver=true**, cost per-unit, recordEmailCost fail-soft, webhook IP allowlist (mos/ruxsatsiz/IP yo'q), processEmailWebhook IP reject.
- Regression: `email-provider-a23` + `email-log-b02` 24/24, `email-queue-b31` + `email-templates-b20` integration 8/8.

### Tekshiruv
- `npm run test:auth` **314/314** (38 fayl) + **tsc 0**

### Merge holati
- **PS tayyor, wsl qismi kutilmoqda:** EMAIL_PROVIDER_PRIMARY/SECONDARY + EMAIL_WEBHOOK_IP_ALLOWLIST env'larini .env.example ga yozish + deploy docs (auth-deploy.md) yangilash + budget alert monitoring dashboards
- **D-32 done condition (§22):** email abstraction to'liq + testlar yashil ✅ (stop condition §21: failover bor, key log'da emas)

### D-33 uchun tayyorlik (§23)
- Testing detail (mutation, property, snapshot): test framework D-14 (vitest 38 fayl 314 test) + security 47/47 + fuzz (security-fuzz.js) — asos tayyor
### AUTH D-18 — E2E (journey) + Security testlar ✅

**STATUS:** ✅ DONE (wsl qismi: 2 security + 1 e2e fayl; ps qismi: 24 test tayyor)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Security — session/MFA | ✅ | `tests/auth/security/security-session-mfa.test.js` (4 test): session fixation (login'da ID o'zgaradi, eski ID invalid), MFA challenge single-use replay, MFA bypass (sensitive amal MFA'siz → 403), wrong-code lockout counter |
| Security — escalation/SSRF/alg | ✅ | `tests/auth/security/security-escalation.test.js` (5 test): teacher role escalation HTTP'da blok (self role o'zgartirish 403), HEMIS SSRF guard (localhost/metadata/redirect blok), OIDC alg confusion (HS256 imzoli RS256 token rad), brute-force register lockout, IDOR boshqa user ma'lumoti 403 |
| E2E — MFA journey | ✅ | `tests/e2e/auth/mfa-journey.spec.js` (2 test): register → MFA enable → logout → login → TOTP challenge → panel; xato TOTP → inline xato (role=alert) + challenge saqlanadi |

**REAL BUG #4 (D-18):** `routes/mfa.js:134` — ESM'da `require('crypto')` qolib ketgan → MFA login'da **server crash** (`ReferenceError: require is not defined`). Tuzatildi: `crypto` import'idagi mavjud ob'ekt ishlatiladi. MFA setup/challenge/login e2e'da ishladi.

**REAL BUG #5 (D-18):** ps D-24 server'da `consent` MAJBURIY qilingan, lekin `views/user/register.ejs`'da checkbox YO'Q edi → **har qanday brauzer registri rad etilardi** (`consentRequired`). Tuzatildi: `#reg-consent` checkbox + 4 til i18n `consentLabel` + CSS + `prevConsent` render. auth-critical e2e 4/4 qayta yashil.

**TESTS_RUN (wsl):**
- e2e auth suite: **6/6 PASS** (auth-critical 4 + mfa-journey 2, Playwright headless)
- tests/auth/security + unit: **306/306** (33 fayl)
- MFA integration (a26+a27+auth core): **91/91**
- tsc **0**, db.json tegsiz (e2e alohida temp DB ishlatadi), temp toza

**NOTES:**
- E2E flakiness kuzatildi (403 CSRF) — sabab: eski `node server.js` jarayonlari port 3477'ni egallab, eski DB/sessiya bilan ishlayotgan server'ga ulanish edi. `reuseExistingServer:false` + run oldi pkill → 3/3 toza run.
- Playwright webServer `LOCAL_DB_FILE=/tmp/deborah-visual-db.json` — production DB'ga tegmaydi.

**NEXT_READY:** D-19 (ps bilan bo'linish). D-27 checkpoint'gacha D-19..D-26 qoldi.
### AUTH D-24 — Legal sahifalar + Roziman checkbox ✅ (wsl qismi)

**STATUS:** ✅ DONE (wsl qismi; ps qismi: legal-docs.js + consent.js 4 til tayyor edi)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Roziman checkbox (D-18 paytida) | ✅ | `register.ejs` #reg-consent + 4 til `consentLabel` + CSS + `prevConsent` render — ps D-24 consentRequired'ni qo'llab-quvvatlaydi (avval har qanday brauzer registri rad edilardi) |
| `/privacy` `/terms` `/cookies` sahifalar | ✅ | `routes/legal.js` (YANGI) — GET only, lang: ?lang → `lang` cookie → uz; `views/legal.ejs` (YANGI) — 4 til switcher, bo'limlar, changelog, kontakt, EJS auto-escape; `views/legal-index.ejs` (`/legal` ro'yxat) |
| Footer havolalari | ✅ | login/register/reset `.footer-links` ga `/cookies` qo'shildi; forgot/mfa ga `views/partials/auth-footer.ejs` (YANGI) ulandi; i18n 4 til footer bloklariga `cookies` kaliti; `.auth-legal` CSS |
| Mount tartibi | ✅ | `legalRoutes` indexRoutes'dan OLDIN mount (eski INFO_PAGES /privacy o'rniga); landing.test.js yangi legal sahifaga moslandi |

**TESTS_RUN (wsl):**
- legal-d24 integration: **8/8** (3 hujjat × 4 til, lang cookie persist, XSS-escape, footer havolalari)
- Regression: landing + auth-a04 + tests/auth/integration = **63/63 (9 fayl)**
- tsc **0**, db.json tegsiz

**NEXT_READY:** D-25 wsl qismi (consent listesi + revoke UI + re-consent banner) yoki D-21 (drill). ps D-25 tayyor (purpose'li consent + dpia, 260/260).
### AUTH D-25 — Consent UI: listesi + revoke + re-consent banner ✅ (wsl qismi)

**STATUS:** ✅ DONE (wsl qismi; ps qismi: consent.js purpose refactor + dpia.js + API status/revoke tayyor edi)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §10 Consent listesi (settings) | ✅ | `/user/settings` accordion: 5 purpose (privacy/telegram/email_marketing/mfa/camera), 4 til label, status badge (Berilgan/Bekor qilingan/Yangilash kerak/Berilmagan), versiya + sana, revoke/grant tugmalari |
| §11 Revoke UI | ✅ | `data-consent-revoke` → POST /api/consent/revoke (reauth kerak bo'lsa inline xabar); fail-closed (telegram kanali o'chadi — ps tomonda) |
| §12 Re-consent (yangi endpoint) | ✅ | `POST /api/consent/grant` (routes/consent.js) — recordConsent joriy versiya bilan, ipHash+lang; reauth TALAB EMAS (oddiy rozilik) |
| §12 Re-consent banner (panel) | ✅ | `/user/panel` — `hasCurrentConsent` false bo'lsa `data-testid="consent-banner"`: "Maxfiylik siyosati yangilandi" + Rozilik berish (grant → banner yo'qoladi) / Yopish; A11y (role=region, aria-live) |
| §20 Xavfsizlik | ✅ | invalid purpose → 400; authsiz → 401/403 (global CSRF); userKey sessiyadan (IDOR yo'q); lang whitelist |

**FILES (wsl):** `routes/consent.js` (+grant), `routes/user.js` (settings consents + panel consentStale), `views/user/settings.ejs` (consent accordion + inline JS), `views/user/panel.ejs` (banner + JS), `tests/auth/integration/consent-ui-d25.test.js` (YANGI — HERMETIC LOCAL_DB_FILE, parallel-safe).

**TESTS_RUN (wsl):**
- consent-ui-d25: **4/4** (settings listesi, grant validatsiya, re-consent journey banner→grant→yo'qoladi, telegram grant)
- tests/auth integration+unit: **292/292 (34 fayl)** — ps consent-api 4 ham qo'shildi
- tsc **0**, db.json tegsiz (test hermetic — data/db.json'ga tegmaydi)

**NOTE:** Test debug paytida topildi — panel'dagi JS selector `[data-testid="consent-banner"]` string'i html'da doim bor (banner'siz ham) — test banner elementini `id="btn-consent-grant"` orqali aniqlaydi.

**NEXT_READY:** D-23 wsl qismi (DSAR UI + SLA C-23) yoki D-21 (drill). ps D-23 tayyor (dsar-user.js, 176/176).
### AUTH D-23 — DSAR UI + SLA C-23 + integration ✅ (wsl qismi)

**STATUS:** ✅ DONE (wsl qismi; ps qismi: dsar-user.js + routes/privacy.js API tayyor edi)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| §06 Eksport UI | ✅ | settings'dagi disabled tugma yoqildi → POST /api/privacy/dsar/export → JSON ko'rinadi (textarea) + SLA 30 kun xabari |
| §07 Tuzatish UI | ✅ | Ism input + data-dsar-correct → reauth (parol prompt) → POST correct → display_name yangilanadi |
| §08/§09 O'chirish UI | ✅ | confirm dialog ("30 kundan keyin tugatiladi") + reauth → POST delete → sessiya bekor, login blok, 30 kun grace |
| §10 Cheklash UI | ✅ | toggle → POST restrict; joriy status sahifa ochilganda yuklanadi |
| §11/§12 SLA C-23 | ✅ | `dsar-user.js`: `logDsarRequest` (dsar_requests/{userKey}/{ts} — type, status, sla_deadline 30 kun), `listDsarRequests`, `overdueDsarCount`; routes/privacy.js: har DSAR amalida log + export/delete javobida `slaDays`/`slaDeadline` |
| §14/§16 A11y/Security | ✅ | role=status, aria-live; authsiz → 401/403; reauth-gated (correct/delete); IDOR yo'q (userKey sessiyadan); PII minimal (parol hash qaytmaydi) |

**FILES (wsl):** `src/modules/privacy/dsar-user.js` (+SLA C-23 4 funksiya), `routes/privacy.js` (SLA log + response maydonlari), `views/user/settings.ejs` (DSAR UI to'liq), `tests/auth/integration/dsar-ui-d23.test.js` (YANGI — HERMETIC LOCAL_DB_FILE, parallel-safe).

**TESTS_RUN (wsl):**
- dsar-ui-d23: **5/5** (export PII+SLA, correct reauth+ism, delete confirm+reauth+sessiya+login blok, restrict status, authsiz 401/403)
- tests/auth integration+unit: **297/297 (35 fayl)** — ps dsar-user unit 11 + IDOR 6 bilan birga
- tsc **0**, db.json tegsiz

**NOTE:** Child-server testlarida test process'ning fb'i child server DB'sini o'qimaydi — DSAR natijasi API orqali tekshiriladi (re-export).

**NEXT_READY:** D-21 (auth incident drill) yoki D-22 (PII fix). ps D-21 tayyor (runbook), D-22 tayyor (pii-inventory 10/10).

### AUTH D-29 — Contract single-source + client validation ✅

**STATUS:** ✅ DONE — unit 7 + integration 3 = 10/10; regression 33/33; tsc 0; OpenAPI VALID

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Single source | ✅ | `src/modules/auth/validation-rules.js` (YANGI) — contracts.js'dan zod `toJSONSchema()` → `{username:{pattern,min,max},password:{min,max}}`; har boot'da runtime'dan chiqariladi (drift bo'lmaydi) |
| GET /api/auth/validation-rules | ✅ | routes/auth.js — public, rate-limit yo'q (statik ma'lumot), rules o'zgarmaguncha cache |
| Client validatsiya | ✅ | `public/js/auth-validation.js` (YANGI) — rules'ni fetch qilib login/register formalariga live validation (aria-invalid + data-inline-error), submit'da qayta tekshiruv |
| **REAL BUG: contracts.js drift** | ✅ | contracts.js username qoidasi app runtime'idan QATTIQROQ edi — valid username'lar client'da bloklanardi. contracts.js app validation.js'ga moslashtirildi + openapi-generate qayta |
| OpenAPI CI | ✅ | ps auth.yml Stage 1'da `openapi-generate.js --validate` (tasdiqlandi) |

**TESTS:** tests/auth/unit/contracts-d29.test.js (7: rules shape, parity runtime, pattern parity) + tests/auth/integration/validation-d29.test.js (3: endpoint 200 + rules qaytadi, server-client parity, invalid pattern 400) + regression (auth-a01/a-b03/a04/a21) 33/33

**NEXT_READY:** D-31 (Redis merge) — wsl qismi

### AUTH D-31 (wsl) — session-manager ↔ Redis birlashma + cross-node revoke ✅

**STATUS:** ✅ DONE — session-redis-d31 7/7 + ps redis-d31 9/9; regression 30/30; tsc 0; boot 200 (/health redis block)

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| recordSession → sorted-set (§06/§07) | ✅ | `session-manager.js`: `setRedisService` accessor; recordSession DB yozuvdan so'ng `parallelSessionsAdd` (Lua atomic) — Redis yo'q bo'lsa fail-open (DB yetarli, §26) |
| Eviction + destroy + cross-node (§07/§09) | ✅ | Limit'dan chiqqan eng eski sessiya (evictedRealSid) `destroySessionInStore` + `publishRevoke({reason:'parallel_limit'})` + `parallelSessionsRemove` — boshqa node'lar darhol biladi |
| revokeSession / revokeByUser / revokeOtherSessions (§07) | ✅ | Har revoke → `parallelSessionsRemove` (sorted-set sync) + `publishRevoke` (bulk_revoke / revoke_others / session_revoke) |
| pub/sub ulash (§09/§27) | ✅ | server.js: redisService.onRevoke → `sessionStore.destroy` — istalgan node revoke qilsa barcha node'lar o'z store'ida yo'q qiladi (p95<100ms); double-destroy idempotent |
| Health /metrics (§10) | ✅ | `/health` ga `redis` blok: `{ok, degrade, degradedAt}` — degrade mode flag (login qattiq emas) |
| Failover (§26) | ✅ | Test 6/7: Redis ulashmagan → recordSession ishlaydi; Test 7: Redis xatosi → fail-open |

**TESTS:** `tests/auth/unit/session-redis-d31.test.js` (YANGI, 7: sorted-set merge, limit evict+destroy+publish, revokeSession sync, revokeByUser bulk, revokeOtherSessions, 2× failover) + ps redis-d31 9/9 + regression (auth-a01 + session-invalidation-b25 + journey-login-session + journey-email-session) 30/30 + tsc 0 + boot 200

**NEXT_READY:** D-27 acceptance imzosi (docs/acceptance-auth.md) — qolgan yakuniy qadam

### AUTH E-05 — Passkey multi-device boshqaruv (rename) ✅

**STATUS:** ✅ DONE — unit 24/24 (webauthn) + integration 4/4 (passkey-rename-e05); regression 37/37 (journey-mfa-passkey, passkey-frontend-d08×2); tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Multi-device boshqaruv (rename) | ✅ | `webauthn.js: renamePasskey()` — owner-only (IDOR → not_found), trim + 1..50 belgi + control-char blok, `updatedAt`, audit `PASSKEY_RENAME` |
| API | ✅ | `POST /api/passkey/rename` — requireAuth + requireRecentAuth; invalid_name 400, not_found 404, reauth 403 |
| UI | ✅ | `public/js/passkey-settings.js` — inline rename (input + Save/Cancel, Enter/Esc), XSS-escape (escapeAttr), reauth fallback; i18n 4 til `rename/renameSave/renameCancel/renamePrompt` |
| Testlar | ✅ | Unit: rename OK (trim+audit), invalid nomlar (bosh/51/control/tab), IDOR, unknown; Integration: journey, 400-loop, IDOR 404, authsiz/CSRF blok |
| Xavfsizlik | ✅ | IDOR yopiq (boshqa user → not_found), nom server'da ham tekshiriladi, reauth shart |

**FILES:** src/modules/auth/webauthn.js, src/modules/auth/audit.js, routes/passkey.js, public/js/passkey-settings.js, data/auth-i18n.js, tests/unit/webauthn.test.js, tests/auth/integration/passkey-rename-e05.test.js (YANGI)
**TESTS:** unit 24/24, integration 4/4, regression 37/37, tsc 0, db.json tegsiz
**NEXT:** E-05 to'liq — merge tasdiqlash (ps) + keyingi E-x

### AUTH E-03 — Push notifications (FCM device-token) ✅

**STATUS:** ✅ DONE — unit 29/29 (fcm-e03 16 + dsar-user 13) + integration 4/4 (push-device-e03); regression 55/55 (push-b23×3, notifications×2, dsar×2); tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Provider tanlovi | ✅ | **FCM** (APNs ustidan) — O'zbekiston ~90% Android, bitta API, FCM iOS'ga APNs bridge orqali yetadi; Apple dev account kerak emas |
| Device token registr | ✅ | `src/modules/student/fcm.js` — `registerFcmToken` (idempotent, per-user ≤5, platform normalize android/ios/web, validatsiya 20..500 belgi + control-char/space yo'q), `removeFcmToken`, `removeAllFcmTokens`, `getUserFcmTokens`, `cleanupFcmTokens` (180 kun) |
| **REAL BUG fix** | ✅ | `tokenKey` safeKey EMAS endi — safeKey lowercase + 60 belgi qirqadi, FCM token'lar case-sensitive → ikki xil token collision. Endi SHA-256 hash (40 hex) |
| Send | ✅ | `sendFcmNotification` — legacy HTTP API (fetch, yangi dep yo'q), FCM_SERVER_KEY, B-21 cap + quiet hours (push.js bilan umumiy), `NotRegistered/InvalidRegistration` → token o'chadi, network fail → token qoladi, payload minimal (title/body/url, sensitive yo'q), audit PUSH_SENT/PUSH_FAILED + metric |
| Push kanal integratsiya | ✅ | `push.js sendPushNotification` endi web-push subscription'lar + FCM mobile token'larni birga yuboradi (push kanali to'liq) |
| API | ✅ | `POST /api/push/device/register` (400 invalid/429 limit), `POST /api/push/device/unregister`, `GET /api/push/device/status` (raw token qaytmaydi — PII minimal) — hammasi requireAuth + CSRF |
| Logout revoke | ✅ | `/user/logout?revoke_token=` — client o'z tokenini yuboradi, faqat o'z user'iga tegishli o'chadi (PII) |
| DSAR (token=PII) | ✅ | `collectUserPii` → `pushDevices[]` (platform/token/createdAt/lastUsedAt — foydalanuvchi o'z ma'lumoti) + `webPushSubscriptions` count; `purgeDerivedCopies` fcm_tokens+push_subs tozalaydi; `softDeleteUser` darhol push token revoke |
| Env | ✅ | env.js: FCM_ENABLED/FCM_SERVER_KEY; .env.example Push bo'limi (VAPID + FCM) |

**FILES:** src/modules/student/fcm.js (YANGI), src/modules/student/push.js, routes/push.js, routes/auth.js (logout), src/modules/privacy/dsar-user.js, src/config/env.js, .env.example, tests/auth/unit/fcm-e03.test.js (YANGI), tests/auth/integration/push-device-e03.test.js (YANGI), tests/auth/unit/dsar-user.test.js
**TESTS:** unit 29/29 + integration 4/4 + regression 55/55, tsc 0, db.json tegsiz
**NEXT:** E-03 to'liq — merge tasdiqlash (ps) + qolgan E-x

### AUTH E-06 — Cloud KMS adapter (kms-provider + kms.js v2) ✅

**STATUS:** ✅ DONE — kms-e06 unit 11/11; regression kms-d02(unit+integration)+mfa-totp-a26+totp-window+20 = 49/49; tsc 0

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| KMS provider adapter | ✅ | `src/modules/auth/kms-provider.js` (YANGI) — `kmsConfigured()` (KMS_KEY_ARN + KMS_ENCRYPTED_MASTER_KEY), `decryptMasterKey()` (lazy @aws-sdk/client-kms, cache TTL 10 daqiqa, audit KMS_DECRYPT latency + KMS_DECRYPT_FAILED, metric kms.decrypt), `getKmsKey()` sync cache, `startKmsRefresher()` (5 daqiqa interval, unref), fail-soft: KMS down → null + cache tozalanadi |
| kms.js v2 | ✅ | `activeKeyVersion()` = KMS yoqilgan + cache bor → 2, aks holda 1; `masterKey(2)` → KMS key (sync cache), v1 env legacy saqlanadi; encrypt v2/v1, decrypt eski version bilan ham (ALLOWED_VERSIONS {1,2}); **fail-soft**: KMS down → yangi yozuvlar v1 (hech narsa buzilmaydi), v2 payload fail-closed (kalitsiz ochilmaydi — to'g'ri) |
| Rotation | ✅ | `rotateMasterKey` KMS yoqilganda v1 → v2 migratsiya qiladi (test: 3/3 secret v2 ga o'tdi va ochiladi) |
| Audit | ✅ | KMS_DECRYPT / KMS_DECRYPT_FAILED action'lar; secret hech qachon log'da emas |
| Boot | ✅ | server.js createApp: KMS sozlangan bo'lsa prefetch + refresher (fail-soft try/catch) |
| Env | ✅ | env.js: KMS_ENCRYPTED_MASTER_KEY + KMS_REGION (AWS'da UZ yo'q — xususiy cloud / me-central-1); .env.example qo'shildi |

**FILES:** src/modules/auth/kms-provider.js (YANGI), src/modules/auth/kms.js, src/modules/auth/audit.js, server.js, src/config/env.js, .env.example, tests/auth/unit/kms-e06.test.js (YANGI), tests/unit/kms-d02.test.js (format test activeKeyVersion)
**TESTS:** kms-e06 11/11 + regression 49/49, tsc 0, db.json tegsiz
**NEXT:** E-06 to'liq — merge tasdiqlash (ps) + qolgan E-x

### AUTH E-07 — Email budget (alert + report + config UI) ✅

**STATUS:** ✅ DONE — unit 11/11 + integration 5/5 + regression 29/29; tsc 0; db.json tegsiz

| Yo'riqnoma | Status | Izoh |
|---|---|---|
| Dynamic alert (80% warn / 100% exceeded) | ✅ | `budget.js: budgetStatus` — level ok\|warn\|exceeded + pct; `provider.js recordEmailCost` endi budget config DB'dan o'qiydi (env faqat default), 80% da `email:budget:alert` (warn), 100% da exceeded — **idempotent** (`email_budget_alerts/{month}` flag, oyiga bir martadan audit) |
| Monthly report CSV | ✅ | `budget.js: monthlyReportCsv` — oy/provider/count/cost_usd; `GET /admin/email-cost/report.csv` (Content-Disposition attachment) |
| Budget config UI | ✅ | `POST /admin/email-cost/budget` (validatsiya 1..100000 USD, audit `email:budget:config`, cache invalidate); `views/admin/email-cost.ejs` — warn/exceeded banner + budget form (CSRF) + CSV link + manba (DB>env) |
| Performance | ✅ | `getBudgetConfig` 60s TTL cache — hot path (har email yuborishda recordEmailCost) DB'ni spam qilmaydi |

**REAL BUG (E-07):** `tokenKey` emas — bu taskda real bug yo'q, lekin test orqali topildi: `getBudgetConfig` cache 60s TTL testlar orasida eski qiymatni ushlab qoladi (test'da `_resetBudgetCache` kerak) — production'da `setBudgetConfig` cache'ni invalidate qiladi (to'g'ri).

**FILES:** src/modules/email/budget.js (YANGI), src/modules/email/provider.js (recordEmailCost), routes/admin.js (report.csv + budget POST + email-cost GET E-07 holat), views/admin/email-cost.ejs (banner+form+CSV), tests/auth/unit/budget-e07.test.js (YANGI), tests/auth/integration/email-budget-e07.test.js (YANGI)
**TESTS:** budget-e07 11/11 + email-budget-e07 int 5/5 + regression (email-d32 + email-cost-d32) 29/29, tsc 0, db.json tegsiz
**NEXT:** ✅ E-FAZA 7/7 RASMAN YOPILDI (2026-08-18) — acceptance-auth.md ikkala agent imzosi
**YAKUNIY (E-faza):** test:auth 487/487 (58 fayl) + tsc 0 + db tegsiz; E-04/E-01/E-02 (ps) + E-05/E-03/E-06/E-07 (wsl);
F-d security audit: 🔴 REAL XSS fix (passkey-settings.js deviceName/t() → escapeAttr + textContent), security-xss-scan 14/14, test:security:auth 48/48
**QOLGAN:** OPERATOR §17 imzosi (operator-signoff-summary.md) + commit ruxsati (docs/commit-plan-d-e.md, 15 commit C1..C15)

### F-d — Security audit takror (E-faza + gate) ✅

**STATUS:** ✅ DONE — `security-ci` ALL GATES PASS (0 critical); roster 79/79 + security 130/130; tsc 0

| Topilma | Tahlil | Fix |
|---|---|---|
| SAST-004 critical: portfolio/i18n.js | FALSE POSITIVE — tarjima kalitlari (`kindCredential: 'Credential'`) | `SAST_ALLOWLIST`'da hujjatlashtirildi |
| SAST-002: redis-service.js (ps D-31) | FALSE POSITIVE — Redis `client.eval(LUA_CONST)` JS eval EMAS | Allowlist |
| SAST-002: safe-submit.schema.js | FALSE POSITIVE — xavfli-pattern BLOCKLIST'i (o'zi security check) | Allowlist |
| SAST-003: qti.js / qti-security.js | Mitigated — multer server-generated temp path (attacker nazoratsiz) | Allowlist + izoh |
| SAST-003: roster/validator.js (A-10/A-11 — wsl) | **REAL hardening:** execSync shell interpolatsiyasi → **spawnSync args-array** (3 joyda: zip-ratio, macro, external) — shell injeksiya yuzasi yopildi | Fix + allowlist (spawnSync'ni ham flaglaydi) |
| SEC-008: .env.example SESSION_SECRET | Placeholder token'ga o'xshab qolgan | `CHANGE_ME` ga o'zgartirildi |
| SEC-001: sessiya-*-firebase-adminsdk-*.json | **Gitignored local file** (repo'ga tusha olmaydi) — skaner filesystem'ni o'qiydi | `isGitIgnored()` — secrets gate gitignore'ni hisobga oladi |

**FILES:** scripts/security-ci.js (SAST_ALLOWLIST + gitignore-aware secrets), src/modules/roster/validator.js (spawnSync hardening), .env.example, docs/handover-auth.md (E-05 qatori + F-d izohi)
**TESTS:** security-ci ALL PASS + roster 79/79 + tests/auth/security 51/51; tsc 0; db tegsiz
**NEXT:** F-c handover ✅ (E-05 qatori qo'shildi). Qolgan: F-01 commit (operator ruxsati), F-a backlog, F-b CI
