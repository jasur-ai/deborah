# Edikit — bosqichma-bosqich AI Agent Prompt Guide

> **Maqsad:** `research.md`dagi Implementation Master Plan’ni AI agent yoki engineering team orqali xavfsiz va tekshiriladigan tartibda bajarish.  
> **Qo‘llash:** promptlar 00 dan 73 gacha ketma-ket bajariladi. Keyingi prompt oldingi promptning `Done` sharti va checkpointidan o‘tmaguncha boshlanmaydi.  
> **Repository:** `/home/user/edikit`  
> **Source of truth:** `/home/user/edikit/research.md`  
> **Muhim:** bu guide kod emas; har prompt copy-paste qilinadigan execution brief hisoblanadi.

---

## A. Operator uchun qo‘llash tartibi

1. Har yangi agent sessionida avval **Global Master Prompt**ni yuboring.
2. Keyin faqat navbatdagi raqamlangan promptni yuboring.
3. Agentdan ish boshida precondition va mavjud holatni tekshirtiring.
4. Agent scope’dan tashqariga chiqmasin; keyingi prompt feature’ini oldindan qo‘shmasin.
5. Har prompt oxirida test, changed files, migration, risk va next readiness reportini talab qiling.
6. `BLOCKED` bo‘lsa sababni bartaraf qilmasdan keyingi promptga o‘tmang.
7. High-risk promptlarda assessment, security, privacy yoki accessibility sign-offni operator tasdiqlaydi.
8. Provider promptlari boshlanishidan oldin current official API va terms qayta tekshiriladi.
9. HEMIS/OneID prompti official contract yoki sandbox bo‘lmasa bajarilmaydi.
10. Source code commitini agent faqat operator aniq so‘rasa qiladi; aks holda commit-ready diff va report beradi.

---

## B. Global Master Prompt

```text
01. Sen `/home/user/edikit` repository’sida ishlaydigan senior staff engineer va assessment-platform architectsan.
02. Asosiy source of truth `/home/user/edikit/research.md`; har vazifadan oldin tegishli bo‘limlarni o‘qi.
03. Ishni boshlashdan oldin `git status`, current commit va mavjud o‘zgarishlarni tekshir.
04. Operatorga tegishli noma’lum o‘zgarishlarni overwrite, revert yoki delete qilma.
05. Har prompt scope’idan tashqaridagi keyingi feature’larni implement qilma.
06. Gate 0 xavfsizlik tugamasdan AI, camera yoki teacher feature’ni production-ready deb e’lon qilma.
07. Browser, upload, student response, webhook va AI outputni untrusted input deb qabul qil.
08. Answer key, provider secret, refresh token va private rubricni frontendga yuborma.
09. Score, timer, attempt status, strike va final grade server-authoritative bo‘lsin.
10. Disconnect student answerini o‘chirmasin; presence academic state’dan alohida bo‘lsin.
11. Barcha HTTP/Socket/job payloadlarni shared Zod contract bilan validate qil.
12. Barcha write operationlarda authorization, idempotency, audit va rate limitni tekshir.
13. Tenant boundary har DB query, API, Socket room, object va vector retrievalda majburiy.
14. Published assessment, item, rubric, brief, policy va grade rule silent edit qilinmasin.
15. Summative grade, misconduct, appeal va special consideration final qarorini AI chiqarmasin.
16. Camera feature emotion, gaze, attention yoki honesty score yaratmasin.
17. Google login boshqa provider credentiali sifatida ishlatilmasin.
18. HEMIS/OneID uchun scraping yoki undocumented endpoint ishlatma.
19. Biometrik/proctor evidence O‘zbekiston isolated storage boundary’dan chiqmasin.
20. Har o‘zgarish uchun unit, integration va zarur E2E/security test yoz.
21. Testlar real production data, live Firebase yoki production provider accountga ulanmasin.
22. Log, trace va error reportlarda secret, answer, essay, health yoki biometric data bo‘lmasin.
23. Migrationlar backward-compatible va rollback/forward-recovery rejasi bilan bo‘lsin.
24. Har vazifada accessibility, low-bandwidth va failure state’larni hisobga ol.
25. Ish tugagach changed files, migrations, contracts, tests va natijalarni aniq ro‘yxat qil.
26. Ishlatilgan barcha test commandlari va ularning natijasini report qil.
27. Qolgan risk, blocker va manual sign-offlarni yashirmasdan yoz.
28. `DONE`, `BLOCKED` yoki `PARTIAL` statusidan bittasini ber.
29. Keyingi promptga tayyor/tayyor emasligini dalil bilan yoz.
30. Operator tasdig‘isiz git commit, force push, destructive migration yoki production deploy qilma.
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

# Phase A — Gate 0 va platform foundation

## Prompt 00 — Repository preflight va execution ledger

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 0, 2, 6, 35 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: repository holatini o‘zgartirmasdan inventarizatsiya qilish va barcha keyingi promptlar uchun tekshiriladigan baseline yaratish.
05. Precondition: repository `/home/user/edikit`da va operator target branchni tasdiqlagan bo‘lishi kerak.
06. Kod yozishdan oldin `git status`, commit, package scripts, Node version, route/socket/storage tuzilmasi va mavjud testlarni tekshir.
07. source fayllar va runtime entrypointlar ro‘yxatini yarat.
08. current security blockerlarni file/line bo‘yicha qayta tasdiqla.
09. current HTTP va Socket write surface’ni inventarizatsiya qil.
10. current JSON/Firebase data root va sample countlarni yoz.
11. package dependency va outdated/runtime-risk ro‘yxatini chiqar.
12. production/dev environment farqlarini aniqlash.
13. `implementation-status.md` ledger formatini yarat.
14. hech qanday feature kodini o‘zgartirmasdan baseline report tayyorla.
15. Security/data guard: secret, credential yoki student data reportga nusxalanmasin; `.git/config`ga tegma.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: existing start command smoke test.
19. Integration/contract test: existing critical route/view smoke test.
20. E2E/security test: workspace’da kutilmagan generated file yo‘qligi testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: repository dirty holatida noma’lum source change bo‘lsa yoki baseline ishga tushmasa.
25. Done condition: baseline, blockerlar, test natijalari va Prompt 01 readiness aniq yozilgan bo‘lsa.
```

## Prompt 01 — Test harness va CI bazasi

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 0, 6, 30, 35 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: unit, integration, HTTP, Socket va Playwright testlarini keyingi xavfsizlik ishlariga tayyorlash.
05. Precondition: Prompt 00 baseline tugagan bo‘lishi kerak.
06. Kod yozishdan oldin `package.json`, mavjud Playwright scriptlari va server bootstrap coupling’ini tekshir.
07. Vitest yoki tanlangan runnerni dev dependency va scriptlarga qo‘sh.
08. serverni testda port tinglamasdan import qilinadigan factoryga ajrat.
09. Supertest HTTP harness yarat.
10. Socket.io test client helper yarat.
11. temporary test DB/store isolation helper yarat.
12. fixture va deterministic clock helper yarat.
13. unit/integration/e2e papkalarini yarat.
14. CI workflow’da lint/test/e2e minimal pipeline yoz.
15. Security/data guard: testlar real `data/db.json`ni o‘zgartirmasin; port, temp fayl va processlar cleanup qilinsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: unit sample test.
19. Integration/contract test: HTTP health/login-page smoke test.
20. E2E/security test: Socket connect/disconnect smoke test.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: test server production data yoki live Firebase’ga ulansa.
25. Done condition: `npm test` va minimal CI local equivalent green bo‘lsa.
```

## Prompt 02 — Environment validation, logger va feature flags

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 2, 3, 30 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: startup konfiguratsiyasini fail-fast, typed va secret-safe qilish.
05. Precondition: Prompt 01 test harness green bo‘lishi kerak.
06. Kod yozishdan oldin hozirgi dotenv/constants/logger/session initializationni tekshir.
07. Zod asosida `config/env` schema yarat.
08. production va test required envlarni ajrat.
09. default production credentiallarni startup blocker qil.
10. Pino structured logger va request ID middleware qo‘sh.
11. token/password/authorization header redaction yoz.
12. feature flag service va tenant override contractini yarat.
13. health/readiness endpointlarni ajrat.
14. config va logger uchun developer documentation yoz.
15. Security/data guard: env qiymatlari, provider keylar va session secret logga chiqmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: missing production env startup-failure testi.
19. Integration/contract test: log redaction testi.
20. E2E/security test: feature flag default/override testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: mavjud production secretni faylga yozish talab qilinsa.
25. Done condition: invalid production config bilan process start bo‘lmasa va valid test config green bo‘lsa.
```

## Prompt 03 — PostgreSQL, Redis va object-storage development foundation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 2, 4 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: transactional DB, durable session/cache va artifact storage uchun local/CI foundation yaratish.
05. Precondition: Prompt 02 config tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current Firebase/local-db adapter va file upload pathlarini tekshir.
07. PostgreSQL pool va health check yarat.
08. Kysely type boundary va migration runner yarat.
09. Redis client lifecycle va health check yarat.
10. MinIO/S3-compatible client abstraction yarat.
11. web va worker process entrypointlarini ajrat.
12. test transaction/reset helper yarat.
13. service shutdown drain/close yoz.
14. development setup va env namunasini hujjatlashtir.
15. Security/data guard: production runtime DB owner credential ishlatmasin; object bucket public bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: PostgreSQL connect/migration testi.
19. Integration/contract test: Redis set/TTL/cleanup testi.
20. E2E/security test: object put/get/delete/hash testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: local setup real cloud credential yoki public bucket talab qilsa.
25. Done condition: local va CI’da uchala dependency health green, shutdown leak yo‘q bo‘lsa.
```

## Prompt 04 — TypeScript va modular monolith boundary

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 2, 5 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: yangi kodni strict TypeScript modullarida yozish uchun incremental boundary o‘rnatish.
05. Precondition: Prompt 03 infrastructure clientlari tayyor bo‘lishi kerak.
06. Kod yozishdan oldin server.js, routes, middleware, socket va utils import graphini tekshir.
07. strict tsconfig va build/typecheck script yarat.
08. `src/app`, `src/config`, `src/contracts`, `src/modules` skeleton yarat.
09. legacy JSni birdan rewrite qilmasdan adapter boundary yarat.
10. HTTP error contract va shared Result/error types yarat.
11. Zod contract export patternini belgilash.
12. dependency direction qoidalarini yoz.
13. worker entrypointni TypeScript boundaryga olib kir.
14. typecheck va build artifact exclusionni tekshir.
15. Security/data guard: big-bang rewrite qilma; mavjud route ishlashi saqlansin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: strict typecheck testi.
19. Integration/contract test: legacy app adapter smoke testi.
20. E2E/security test: module dependency cycle check yoki review testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: bir prompt ichida barcha legacy view/router rewrite talab qilinsa.
25. Done condition: yangi module typed, legacy smoke green va build reproducible bo‘lsa.
```

## Prompt 05 — Public question va private answer-key ajratish

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 0, 6, 10, 11 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: active o‘yin/assessment payloadidan barcha correct-answer ma’lumotini chiqarish.
05. Precondition: Prompt 01 payload test helperlari mavjud bo‘lishi kerak.
06. Kod yozishdan oldin `socket/game-handler.js`dagi `q_correct`, `qCorrect`, questions[].correct va session write’larni tekshir.
07. public question DTO schema yarat.
08. private scoring-key DTO/schema yarat.
09. preview emitni public DTOga o‘tkaz.
10. active-question emitni public DTOga o‘tkaz.
11. session public state’dan correct fieldlarni olib tashla.
12. server scoring helperni private key bilan ishlat.
13. answer reveal policy uchun alohida sanitized event yarat.
14. network/socket snapshot regression fixture yarat.
15. Security/data guard: answer key browser, public Firebase path, log, source map yoki error detailga chiqmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: public DTO field allowlist unit testi.
19. Integration/contract test: Socket preview/active payload secret-scan testi.
20. E2E/security test: server scoring parity testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: private keyni clientga yubormasdan scoringni saqlab bo‘lmasa — arxitektura blockerini report qil.
25. Done condition: repository bo‘yicha active payloadlarda answer key nol va scoring to‘g‘ri bo‘lsa.
```

## Prompt 06 — Server-authoritative answer, time va idempotency

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 5, 6, 12 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: answer overwrite va client time manipulationni to‘liq yopish.
05. Precondition: Prompt 05 private scoring boundary green bo‘lishi kerak.
06. Kod yozishdan oldin current `player:answer`, score formula va Firebase set semanticsni tekshir.
07. typed answer command schema yarat.
08. attempt/player/item ownership check qo‘sh.
09. server received timestampdan response time hisobla.
10. first-answer mode atomic insert/transaction qil.
11. editable mode uchun monotonic revision sequence yarat.
12. idempotency key va duplicate response contractini qo‘sh.
13. ACK accepted/rejected/error code schema yarat.
14. late/stale/wrong-epoch mutationni rad et.
15. Security/data guard: client `timeMs`, client score yoki client status trusted bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: forged time scorega ta’sir qilmaslik testi.
19. Integration/contract test: duplicate/idempotent answer testi.
20. E2E/security test: concurrent first-answer race testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: storage atomicity ta’minlanmasa production pathni ochma.
25. Done condition: duplicate accepted answer nol, server time authoritative va deterministic ACK bo‘lsa.
```

## Prompt 07 — Disconnect, reconnect va answer preservation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 6, 12 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: network uzilishida player/response yo‘qolishini to‘xtatish va durable reconnect yaratish.
05. Precondition: Prompt 06 answer command tayyor bo‘lishi kerak.
06. Kod yozishdan oldin disconnect handlerning player va answers delete qiladigan qismini tekshir.
07. disconnectda faqat presence offline qil.
08. durable player/attempt identity yarat.
09. reconnect ticket/session check qo‘sh.
10. server last acknowledged sequence qaytarsin.
11. client missing sequence resend contractini yarat.
12. host/student room rejoin authorization yoz.
13. grace periodni UI presence uchun ishlat.
14. restart/reconnect E2E fixture yarat.
15. Security/data guard: disconnect strike emas; response yoki attempt hard-delete qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: disconnectdan keyin answer saqlanish testi.
19. Integration/contract test: same session reconnect testi.
20. E2E/security test: server restartdan keyin recovery integration testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: durable identityni nickname/pathga bog‘lashga to‘g‘ri kelsa.
25. Done condition: ACK qilingan answer reconnect/restartdan keyin mavjud va room rejoin authorized bo‘lsa.
```

## Prompt 08 — Socket identity, host ownership va Arena authorization

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 6, 7, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: connection-local role va public Arena mutatsiyalarini signed persistent authorizationga almashtirish.
05. Precondition: Prompt 07 reconnect identity mavjud bo‘lishi kerak.
06. Kod yozishdan oldin socket handshake, host events va Arena route/eventlarni inventarizatsiya qil.
07. short-lived signed socket ticket yarat.
08. ticketdan user/tenant/role/scope resolve qil.
09. room join server authorization qo‘sh.
10. persistent host grant va reconnect token yarat.
11. har host actionga ABAC check qo‘sh.
12. Arena add/cleanup/botAnswer owner-only qil.
13. public watcherni sanitized read-only stream qil.
14. per-event rate limit va audit qo‘sh.
15. Security/data guard: game code yoki socket.data.role o‘zi ownership bermasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: forged room join testi.
19. Integration/contract test: host reconnect ownership testi.
20. E2E/security test: unauthorized Arena mutation va event replay testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: legacy flow signed identitysiz ishlashi shart degan talab chiqsa.
25. Done condition: owner bo‘lmagan actor mutatsiya qila olmasa va public watcher secret ko‘rmasa.
```

## Prompt 09 — CSRF, password, admin va Redis session

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 6, 7 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: cookie-auth write endpointlar, weak password va default admin risklarini yopish.
05. Precondition: Prompt 02 env va Prompt 03 Redis tayyor bo‘lishi kerak.
06. Kod yozishdan oldin server CSRF bypass, routes/auth SHA-256 va constants admin defaultsni tekshir.
07. API blanket CSRF bypassni olib tashla.
08. Origin/Referer allowlist check qo‘sh.
09. signed webhooklarni alohida exemption qil.
10. Argon2id local credential service yarat.
11. legacy SHA-256 successful login rehash qil.
12. default admin bilan production startupni blokla.
13. connect-redis session store va secure cookie yoz.
14. login paytida session regenerate va role-change revoke qo‘sh.
15. Security/data guard: password/token logga chiqmasin; error user enumeration bermasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: CSRF/bad-origin rejection testi.
19. Integration/contract test: legacy hash to Argon2 migration testi.
20. E2E/security test: session fixation/default-admin startup testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: provider webhookni CSRF bilan yoki user API’ni signature bilan chalkashtirish talab qilinsa.
25. Done condition: cookie write’lar himoyalangan, password Argon2id va durable Redis session bo‘lsa.
```

## Prompt 10 — Gate 0 verification va release blocker

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 6, 30, 34 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Gate 0 natijasini mustaqil regression, security va recovery testlari bilan sertifikatlash.
05. Precondition: Prompt 05–09 implementationlari merge-ready bo‘lishi kerak.
06. Kod yozishdan oldin diff, migration, test coverage va barcha old blockerlarni qayta tekshir.
07. answer-key secret scan’ni CI gate qil.
08. HTTP/Socket auth negative suite’ni ishlat.
09. duplicate/time/race testlarini parallel ishlat.
10. disconnect/restart recovery soak testini ishlat.
11. CSRF/session/password testlarini ishlat.
12. Arena owner testlarini ishlat.
13. security findings va residual riskni yoz.
14. Gate 1 ochish yoki bloklash qarorini report qil.
15. Security/data guard: bironta critical finding accepted-risk qilib yashirilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: full unit/integration/E2E suite.
19. Integration/contract test: automated secret/payload scan.
20. E2E/security test: targeted load/reconnect test.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: har qanday critical/high blocker qolsa.
25. Done condition: answer leak, acknowledged loss, unauthorized mutation va default credential nol bo‘lsa.
```


# Phase B — Data, tenant va academic foundation

## Prompt 11 — Tenant, PostgreSQL RLS, RBAC va ABAC

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 4, 7 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: multi-tenant data isolation va scope-aware permission modelini yaratish.
05. Precondition: Gate 0 pass va PostgreSQL migration foundation tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current user/admin middleware va barcha owner lookup’larni tekshir.
07. tenant/institution/user/role/permission tables yarat.
08. runtime/migration/scoring DB rolelarini ajrat.
09. transaction tenant context helper yoz.
10. RLS policylarni qo‘sh.
11. central authorization policy service yarat.
12. course/assessment/case scope modelini qo‘sh.
13. repository querylarni tenant contextga o‘tkaz.
14. privileged action auditini yoz.
15. Security/data guard: platform admin bypass alohida explicit path bo‘lsin; generic service role RLS bypass qilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: cross-tenant repository testi.
19. Integration/contract test: role/scope permission matrix testi.
20. E2E/security test: IDOR HTTP/Socket security testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: tenant context transactiondan tashqarida yo‘qolsa yoki RLS bypass zarur bo‘lsa.
25. Done condition: cross-tenant access nol va har privileged route centralized policy ishlatsa.
```

## Prompt 12 — Google OIDC login

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 7 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Google Authorization Code + PKCE orqali xavfsiz Edikit identity yaratish.
05. Precondition: Prompt 11 user/tenant/role modeli tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current login routes, session va invitation modelini tekshir.
07. OIDC client config va redirect route yarat.
08. state/nonce/PKCE verifier session flow yoz.
09. callback token validation qil.
10. Google sub external primary ID sifatida saqla.
11. email_verified va optional hd policy tekshir.
12. invitation/account mapping flow yoz.
13. session regenerate va login audit qo‘sh.
14. incremental provider scopesni login scopelaridan ajrat.
15. Security/data guard: Google token Gamma/Manus/Canva/Anthropic credentiali sifatida ishlatilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: state/nonce/PKCE negative testi.
19. Integration/contract test: wrong issuer/audience/expired token testi.
20. E2E/security test: invitation va role-escalation E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: test uchun production Google secret yoki bypass token talab qilinsa.
25. Done condition: OIDC login xavfsiz, role DB’dan va unauthorized account privileged bo‘lmasa.
```

## Prompt 13 — Passkey, account linking va session management

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 7 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin/high-stakes step-up va xavfsiz account link/merge workflow yaratish.
05. Precondition: Prompt 12 OIDC login green bo‘lishi kerak.
06. Kod yozishdan oldin session metadata, account merge va recovery talablarini tekshir.
07. WebAuthn challenge/options endpoint yoz.
08. credential register/verify/counter saqla.
09. institution admin uchun passkey policy qo‘sh.
10. recent re-auth middleware yarat.
11. account link request/approval flow yoz.
12. identity mismatch manual queue yarat.
13. active sessions view/revoke qo‘sh.
14. recovery code/helpdesk audit flow yoz.
15. Security/data guard: raw biometric serverga kelmasin; emailning o‘zi merge authority bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: challenge replay/origin/RP ID testi.
19. Integration/contract test: account takeover/link escalation testi.
20. E2E/security test: session revoke va step-up E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: identity merge old attempt ownershipini o‘zgartirsa.
25. Done condition: passkey step-up va auditable account linking ishlasa.
```

## Prompt 14 — Academic term, course, class, group va enrollment

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 4, 8 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher workspace uchun canonical academic hierarchy va CRUD yaratish.
05. Precondition: Prompt 11 tenancy va permissionlar tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current user/tests/pre_groups data semanticsini tekshir.
07. academic term/faculty/program tables va migration yarat.
08. course catalog va term-specific class yarat.
09. group/subgroup va memberships yarat.
10. enrollment status/source/version qo‘sh.
11. teacher/co-teacher assignment yarat.
12. archive/read-only lifecycle qo‘sh.
13. external HEMIS/SIS ID fieldlarini qo‘sh.
14. CRUD API va teacher course list UI yarat.
15. Security/data guard: har entity tenant-scoped; archive old assessmentni o‘zgartirmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: unique/referential constraint testlari.
19. Integration/contract test: course staff authorization testi.
20. E2E/security test: archive/history E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: course/test ownershipni global qidiruv bilan qilishga to‘g‘ri kelsa.
25. Done condition: academic hierarchy, role scope va archive to‘liq ishlasa.
```

## Prompt 15 — Roster upload security va parser

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 8 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: XLSX/CSV/OneRoster faylini production DBga yozmasdan xavfsiz staginggacha olib kelish.
05. Precondition: Prompt 03 object storage va Prompt 14 academic entities tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current browser XLSX parser, request limit va upload pathlarini tekshir.
07. stream/pre-signed upload session yarat.
08. extension/MIME/magic bytes allowlist qo‘sh.
09. size/row/sheet/cell va zip ratio limit qo‘sh.
10. macro/external relation policy yoz.
11. antivirus/quarantine worker qo‘sh.
12. formula execute qilmaydigan parser yarat.
13. Unicode/email/name normalization qo‘sh.
14. staging rows va parse report yarat.
15. Security/data guard: filename object key bo‘lmasin; parser memory/time sandbox limitda ishlasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: spoof MIME/macro/zip-bomb testi.
19. Integration/contract test: formula/hidden sheet parser testi.
20. E2E/security test: large malformed workbook cleanup testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: malware scanner unavailable fail-open qilinsa.
25. Done condition: xavfsiz fayl stagingga tushsa va production entity o‘zgarmasa.
```

## Prompt 16 — Roster mapping, validation, diff, commit va rollback

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 8 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: staged rosterdan idempotent va reviewable academic entity sync yaratish.
05. Precondition: Prompt 15 parsed staging rows mavjud bo‘lishi kerak.
06. Kod yozishdan oldin template columns, current group/course mapping va source-of-truth qoidalarini tekshir.
07. column mapping UI/API yarat.
08. required/duplicate/referential validator yoz.
09. create/update/deactivate/conflict diff hisobla.
10. course/group/year preview yarat.
11. admin approval va immutable input hash qo‘sh.
12. transactional idempotent commit yoz.
13. row-level error/report export qil.
14. rollback snapshot/compensating import yoz.
15. Security/data guard: upload avtomatik production overwrite qilmasin; external ID collision manual conflict bo‘lsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: same file idempotency testi.
19. Integration/contract test: partial invalid rows va atomicity testi.
20. E2E/security test: commit/rollback/reconciliation E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: source-of-truth fieldlari aniqlanmasa.
25. Done condition: admin previewdan keyin deterministic commit va rollback qila olsa.
```

## Prompt 17 — Accommodation sensitive/operational modeli

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 8, 26, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: approved accommodationni sensitive sababdan ajratib assessment runtimega xavfsiz qo‘llash.
05. Precondition: Prompt 14 enrollment modeli tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current systemda extra time/accessibility istisnolari bor-yo‘qligini tekshir.
07. accommodation va version tables yarat.
08. sensitive rationale encrypted/restricted qil.
09. operational options schema yarat.
10. effective/expiry/authority fieldlarini qo‘sh.
11. assessment assignment snapshot service yoz.
12. timer/break/camera/strike integration qil.
13. authorized live correction workflow yarat.
14. student confirmation va audit UI qo‘sh.
15. Security/data guard: marker/proctor diagnosisni emas, faqat zarur operational settingni ko‘rsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: extra-time timer testi.
19. Integration/contract test: break/strike/camera exemption testi.
20. E2E/security test: sensitive-field authorization testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: runtime setting uchun health diagnosisni oshkor qilish talab qilinsa.
25. Done condition: accommodation snapshot E2E ishlasa va sensitive leak nol bo‘lsa.
```

## Prompt 18 — Legacy JSON/Firebase migration dry-run

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 31 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: users/tests/results/pre_groupsni PostgreSQL canonical modelga data-loss’siz mapping qilish.
05. Precondition: Prompt 14 schema va Prompt 05 public/private item modeli tayyor bo‘lishi kerak.
06. Kod yozishdan oldin data/db.json va Firebase adapter sample/fieldlarini read-only audit qil.
07. source export/hash script yarat.
08. legacy user va credential marker mapping qil.
09. nested testsni item/version/private keyga ajrat.
10. legacy resultsni attempt/grade lineagega map qil.
11. pre/mock entity mapping yoki raw archive yoz.
12. invalid/orphan/duplicate quarantine report qil.
13. dry-run count/hash/parity report yarat.
14. rollback/dual-read planini hujjatlashtir.
15. Security/data guard: source fayl o‘zgarmasin; invalid correct key silent migrate qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: record count reconciliation testi.
19. Integration/contract test: sample scoring parity testi.
20. E2E/security test: owner/orphan/Unicode migration testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: owner/tenant mapping noaniq bo‘lsa production commit qilma.
25. Done condition: dry-runda barcha record mapped yoki explicit quarantine bo‘lsa.
```

## Prompt 19 — Data va identity checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 11, 12, 13, 14, 15, 16, 17, 18 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Phase B ni isolation, migration va role journey bo‘yicha yakuniy tekshirish.
05. Precondition: Prompt 11–18 merge-ready bo‘lishi kerak.
06. Kod yozishdan oldin migrations, RLS, OIDC, roster, accommodation va dry-run reportlarni ko‘rib chiq.
07. fresh DB migrationni ishlat.
08. cross-tenant test suite’ni ishlat.
09. Google/invitation/passkey E2E ishlat.
10. roster malicious-file suite’ni ishlat.
11. mapping/commit/rollbackni ishlat.
12. accommodation E2E ishlat.
13. legacy reconciliation reportni tasdiqla.
14. Phase C readiness va residual risk yoz.
15. Security/data guard: failed migration yoki RLS bypass accepted bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: fresh install integration suite.
19. Integration/contract test: role-based Playwright journey.
20. E2E/security test: backup/rollback rehearsal.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: cross-tenant, migration yoki identity critical issue qolsa.
25. Done condition: fresh tenant course/roster/accommodation bilan xavfsiz ishlasa.
```


# Phase C — Competency va assessment core

## Prompt 20 — Competency va curriculum graph

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 9, 25 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: versionlangan outcome/competency graph va mapping workflowini qurish.
05. Precondition: Phase B checkpoint pass bo‘lishi kerak.
06. Kod yozishdan oldin course/program structure va target CASE-compatible fieldsni tekshir.
07. framework/version/competency tables yarat.
08. relation enum va cycle validation yoz.
09. translation/alias/terminology fieldlarini qo‘sh.
10. DRAFT→REVIEW→PUBLISHED lifecycle yarat.
11. course/outcome mapping API/UI yoz.
12. AI_SUGGESTED mapping statusini qo‘sh.
13. impact/orphan/coverage querylarini yarat.
14. CASE import/export adapter skeleton yoz.
15. Security/data guard: AI mapping teacher approval’siz published bo‘lmasin; stable ID silent almashtirilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: relation/cycle/version unit testi.
19. Integration/contract test: tenant mapping authorization testi.
20. E2E/security test: framework publish/impact E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: canonical framework owner/steward aniqlanmasa.
25. Done condition: course va program outcome’lari versionlangan va itemlar ulanishiga tayyor bo‘lsa.
```

## Prompt 21 — Item bank public/private versioning

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 10 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: barcha item turlari uchun reusable, versionlangan va answer-key-safe bank yaratish.
05. Precondition: Prompt 20 competency IDs va Gate 0 private scoring boundary tayyor bo‘lishi kerak.
06. Kod yozishdan oldin legacy question schema va required MVP item turlarini tekshir.
07. question bank/item/item_version tables yarat.
08. public content Zod schema yoz.
09. private scoring-key schema va DB permission yoz.
10. item status lifecycle yarat.
11. tag/outcome/misconception mappings qo‘sh.
12. media object/alt/license mapping yarat.
13. clone/new-version/diff API yoz.
14. teacher item list/editor/review shell yarat.
15. Security/data guard: private scoring general GET/list/search DTOga kirmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: public/private serialization testi.
19. Integration/contract test: version immutability testi.
20. E2E/security test: cross-tenant item/search security testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: item type scoring contract aniqlanmasa.
25. Done condition: approved item version reusable va secret-safe bo‘lsa.
```

## Prompt 22 — Rubric builder va anchor model

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 10, 18, 20 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: analytic rubric, criterion levels, concept va anchorlarni versionlab yaratish.
05. Precondition: Prompt 21 item versioning tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current score fields va written grading target schemani tekshir.
07. rubric/version/criterion tables yarat.
08. level/max-point validation yoz.
09. required concept/contradiction schema qo‘sh.
10. student-visible va private notesni ajrat.
11. anchor response/artifact mapping yarat.
12. builder UI va preview yoz.
13. version diff/clone/publish flow yarat.
14. item/submission exact rubric pin qo‘sh.
15. Security/data guard: published rubric silent edit qilinmasin; max point arithmetic qat’iy bo‘lsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: criterion/level validation testi.
19. Integration/contract test: published version immutability testi.
20. E2E/security test: rubric preview/authorization E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: score max/weight semantics noaniq bo‘lsa.
25. Done condition: manual marker va keyingi AI grading bir xil rubric versionni ishlata olsa.
```

## Prompt 23 — QTI import/export staging

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 10, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: QTI assessment contentni staging, capability report va round-trip bilan qo‘llash.
05. Precondition: Prompt 21–22 canonical item/rubric modeli mavjud bo‘lishi kerak.
06. Kod yozishdan oldin target QTI profile va supported interaction mappingni yozib chiq.
07. QTI package upload/security validation yarat.
08. manifest/media path traversal tekshir.
09. XML parser XXE disabled qil.
10. interaction→canonical mapping yoz.
11. unsupported feature report yarat.
12. staging preview/approval flow qo‘sh.
13. canonical→QTI export yoz.
14. round-trip fixture corpus yarat.
15. Security/data guard: QTI private answer export privileged explicit action bo‘lsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: malicious XML/package security testi.
19. Integration/contract test: supported interaction import testi.
20. E2E/security test: round-trip critical-field testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: parser XXE/path traversalni yopib bo‘lmasa.
25. Done condition: supported itemlar loss’siz va unsupportedlari explicit report bo‘lsa.
```

## Prompt 24 — Assessment builder va blueprint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 11 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: course/outcome/section/item/scoring asosida assessment draft builder yaratish.
05. Precondition: Prompt 20–22 core content tayyor bo‘lishi kerak.
06. Kod yozishdan oldin assessment turlari, section va scoring requirementlarini tekshir.
07. assessment/template/version tables yarat.
08. stepper draft API/UI yarat.
09. outcome/topic weight blueprint qo‘sh.
10. item type/cognitive/difficulty distribution qo‘sh.
11. 50/30/20 deterministic count yoz.
12. item pool/randomization config yarat.
13. score/time arithmetic validator yoz.
14. student preview renderini yarat.
15. Security/data guard: draft mutable, published immutable; private key preview faqat authorized authorga.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: difficulty count/rounding unit testi.
19. Integration/contract test: blueprint total/score validation testi.
20. E2E/security test: builder save/preview E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: score yoki item snapshot semantics belgilanmasa.
25. Done condition: valid draft blueprint va student preview tayyor bo‘lsa.
```

## Prompt 25 — Assessment brief, policy pack va simulator

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 11, 19, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: summative assessment uchun versionlangan brief va typed institutional policy yaratish.
05. Precondition: Prompt 24 assessment draft mavjud bo‘lishi kerak.
06. Kod yozishdan oldin brief fields, AI-use A0–A4, late/resit/security/retention talablarini tekshir.
07. brief/version tables va required schema yarat.
08. material-change diff/notification policy yoz.
09. typed policy JSON schema yarat.
10. institution locked fields qo‘sh.
11. recipe library seed qil.
12. policy DRAFT→APPROVED lifecycle yarat.
13. real roster/accommodation simulator yoz.
14. publish blocker va human-readable report UI yarat.
15. Security/data guard: arbitrary policy JavaScript yo‘q; active attempt exact versionga pinlanadi.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: invalid brief/policy schema testi.
19. Integration/contract test: locked-field bypass testi.
20. E2E/security test: simulator blocker/accommodation testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: institution late/resit/security qoidalari tasdiqlanmasa.
25. Done condition: brief va policy approved bo‘lmasdan summative publish bo‘lmasa.
```

## Prompt 26 — Program calendar va workload orchestrator

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 11, 15 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: student deadline, effort, marker va feedback collisionlarini program darajasida boshqarish.
05. Precondition: Prompt 14 academic structure va Prompt 25 brief/schedule tayyor bo‘lishi kerak.
06. Kod yozishdan oldin cohort overlap, room/device va feedback dependency data manbalarini tekshir.
07. calendar/workload tables yarat.
08. student effort va marker minutes fieldlarini qo‘sh.
09. same-cohort deadline query yoz.
10. exam hard clash validator yoz.
11. feedback-before-next-task dependency yoz.
12. marker/moderation capacity warning qo‘sh.
13. what-if move impact service yarat.
14. ICS/timezone/notification flow yoz.
15. Security/data guard: AI stress/emotion infer qilmasin; date auto-publish qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: direct clash blocker testi.
19. Integration/contract test: what-if impact consistency testi.
20. E2E/security test: timezone/date-change notification E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: cohort membership yoki timezone noaniq bo‘lsa.
25. Done condition: hard clash zero va coordinator impact bilan date publish qila olsa.
```

## Prompt 27 — Immutable publish transaction va assignment snapshot

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 5, 11 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: assessment draftni public/private/version/roster/accommodation snapshot bilan atomik publish qilish.
05. Precondition: Prompt 24–26 validationlari tayyor bo‘lishi kerak.
06. Kod yozishdan oldin publish paytidagi barcha entity va outbox dependencylarini tekshir.
07. publish row lock/idempotency yarat.
08. public item snapshots yarat.
09. private scoring snapshots yarat.
10. brief/policy exact version pin qil.
11. roster assignment members snapshot qil.
12. accommodation snapshot qil.
13. version hash va calendar entry yarat.
14. notification outboxni shu transactionga qo‘sh.
15. Security/data guard: partial publish yoki private key public snapshotga tushishi mumkin emas.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: publish idempotency/race testi.
19. Integration/contract test: transaction rollback testi.
20. E2E/security test: snapshot immutability/secret scan testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: publish bir nechta storeda atomikliksiz direct write talab qilsa.
25. Done condition: bitta transactiondan reproducible SCHEDULED version yaralsa.
```

## Prompt 28 — Student assignment list, brief va preflight

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 11, 12, 26 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: studentga faqat assigned assessment, exact brief va device readiness oqimini berish.
05. Precondition: Prompt 27 published assignment mavjud bo‘lishi kerak.
06. Kod yozishdan oldin student current panel va join-code flowini tekshir.
07. assignment list API/UI yarat.
08. authorization va availability window ko‘rsat.
09. brief/policy/version render qil.
10. accommodation confirmation ko‘rsat.
11. browser/device/network capability check yoz.
12. camera/SEB requirement check hook yarat.
13. practice requirement/status ko‘rsat.
14. start eligibility/preflight result contract yoz.
15. Security/data guard: briefda answer key yoki boshqa student data chiqmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: unassigned assessment access testi.
19. Integration/contract test: brief/version authorization testi.
20. E2E/security test: device/preflight E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: assignment snapshot bilan current roster qarama-qarshi bo‘lsa silent sync qilma.
25. Done condition: student startdan oldin barcha requirement va blockerlarni ko‘rsa.
```

## Prompt 29 — Teacher Core checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 20, 21, 22, 23, 24, 25, 26, 27, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: competencydan student preflightgacha Teacher Core’ni yakuniy tekshirish.
05. Precondition: Prompt 20–28 merge-ready bo‘lishi kerak.
06. Kod yozishdan oldin schema, authorization, snapshot, UI va conformance reportlarni ko‘r.
07. fresh tenant/course/outcome yarat.
08. item/rubric review/publish qil.
09. QTI fixture import/export qil.
10. assessment blueprint/brief/policy yarat.
11. calendar blockerlarni sinab ko‘r.
12. assignment snapshot publish qil.
13. student brief/preflight journey qil.
14. residual risk va Phase D readiness yoz.
15. Security/data guard: manual DB edit yoki secret-bearing DTO bilan testni o‘tkazma.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: teacher Playwright end-to-end.
19. Integration/contract test: student preflight end-to-end.
20. E2E/security test: snapshot/tenant/security integration suite.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: public/private, roster snapshot yoki policy blockerida critical issue qolsa.
25. Done condition: low-stakes assessment startgacha to‘liq, versionlangan va secure flow bo‘lsa.
```


# Phase D — Secure attempt va proctoring

## Prompt 30 — Attempt lease, identity step va server timer

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 5, 12, 14 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: authorized studentga single-writer, server-timed attempt startini yaratish.
05. Precondition: Prompt 28 preflight va published assignment tayyor bo‘lishi kerak.
06. Kod yozishdan oldin attempt policy, identity level, accommodation va time windowlarni tekshir.
07. attempt/device/lease tables yarat.
08. assignment membership authorization yoz.
09. required identity step-up hook qo‘sh.
10. atomic single-writer lease yarat.
11. server started_at/ends_at hisobla.
12. accommodation extra time qo‘sh.
13. public content package yarat.
14. attempt start/ready/in-progress transition yoz.
15. Security/data guard: client clock, display timer yoki join code authority bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: concurrent start/lease testi.
19. Integration/contract test: time-window/extra-time testi.
20. E2E/security test: unassigned/wrong-identity start testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: parallel session policy belgilanmasa.
25. Done condition: bitta authorized attempt exact version va server timer bilan boshlansa.
```

## Prompt 31 — Response API, ACK sequence va autosave

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 12, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MCQ, structured va essay response’lar uchun reliable autosave contract yaratish.
05. Precondition: Prompt 30 IN_PROGRESS attempt mavjud bo‘lishi kerak.
06. Kod yozishdan oldin response modes, current Gate0 answer command va frontend state’ni tekshir.
07. response/revision schema yarat.
08. client_seq/idempotency/epoch tekshir.
09. first/editable/item-lock modes yoz.
10. server ACK highest sequence qaytar.
11. essay patch/snapshot interval yoz.
12. frontend save-state indicator yarat.
13. retry/backoff va offline buffer hook yarat.
14. response audit minimal event yoz.
15. Security/data guard: ACK bo‘lmasdan synced ko‘rsatilmasin; raw essay logga tushmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: out-of-order/duplicate sequence testi.
19. Integration/contract test: essay autosave/revision testi.
20. E2E/security test: late/stale/item-lock rejection testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: response mode assessment policyda explicit bo‘lmasa.
25. Done condition: response’lar deterministic ACK va retry bilan saqlansa.
```

## Prompt 32 — IndexedDB offline journal, reconnect va recovery

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 12, 30 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: low-bandwidth/crash holatida answerlarni local encrypted journal va server ACK bilan tiklash.
05. Precondition: Prompt 31 sequence contract tayyor bo‘lishi kerak.
06. Kod yozishdan oldin PWA/service worker va browser storage lifecycle’ini tekshir.
07. IndexedDB attempt journal yarat.
08. local encryption key/session strategy yoz.
09. pending/ACK sequence saqla.
10. reconnect state reconciliation yoz.
11. parallel device reject/transfer policy qo‘sh.
12. old epoch mutation reject qil.
13. emergency recovery package export yoz.
14. privileged recovery import/audit flow yarat.
15. Security/data guard: offline package answer keyni saqlamasin; disconnect strike bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: offline edit/reconnect testi.
19. Integration/contract test: browser crash/restore testi.
20. E2E/security test: stale recovery/parallel-device security testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: browser storage threat model yoki recovery authority aniqlanmasa.
25. Done condition: offline response reconnectdan keyin loss’siz sync bo‘lsa.
```

## Prompt 33 — Submit sealing va signed receipt

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 12, 17 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: pending response’larni sync qilib attemptni immutable submit qilish.
05. Precondition: Prompt 31–32 autosave/recovery green bo‘lishi kerak.
06. Kod yozishdan oldin submit UI, completeness va scoring triggerlarini tekshir.
07. pending batch flush step yarat.
08. server completeness summary qaytar.
09. explicit confirmation UI yarat.
10. attempt row lock va SUBMITTED transition yoz.
11. final response snapshot/hash yarat.
12. later mutation reject qil.
13. scoring/outbox job enqueue qil.
14. signed PDF/JSON receipt yarat.
15. Security/data guard: double submit duplicate score/job yaratmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: submit idempotency/race testi.
19. Integration/contract test: pending autosave before submit testi.
20. E2E/security test: post-submit mutation va receipt signature testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: pending response holati aniqlanmasdan deadline yopilsa.
25. Done condition: bitta immutable submission va verifiable receipt yaralsa.
```

## Prompt 34 — Uch-strike client collector va server classifier

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 13 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: visibility/fullscreen incidentlarini dedupe qilib third strike’da server termination yaratish.
05. Precondition: Prompt 30 attempt epoch va Prompt 31 event transporti mavjud bo‘lishi kerak.
06. Kod yozishdan oldin browser event, file picker, permission, accessibility va network holatlarini tekshir.
07. visibility/fullscreen collector yoz.
08. monotonic duration/client_seq yarat.
09. offline event buffer qo‘sh.
10. server threshold 2000ms yoz.
11. overlap va 5000ms dedupe classifier yoz.
12. technical/accommodation exclusions qo‘sh.
13. warning 1/2 va terminate 3 transition yoz.
14. reopen yangi epoch/audit flow yoz.
15. Security/data guard: blur o‘zi strike emas; network/camera failure strike emas.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: 1.9/2.1 second boundary testi.
19. Integration/contract test: blur+hidden+fullscreen dedupe testi.
20. E2E/security test: third-strike race/reopen old-epoch testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: browser eventni ishonchli misconduct isboti deb talab qilinsa.
25. Done condition: confirmed incidentlar to‘g‘ri count va third server-side terminate qilsa.
```

## Prompt 35 — Teacher/proctor live monitor

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 13, 15, 29 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: attempt status, presence, timeline va authorized operational actionsni real-time ko‘rsatish.
05. Precondition: Prompt 30–34 attempt/events tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current host view va proctor role permissionsni tekshir.
07. monitor read model/query yarat.
08. Socket monitor room authorization yoz.
09. status counts/filter UI yarat.
10. per-attempt timeline drawer yarat.
11. pause/resume/extend actions qo‘sh.
12. terminate/reopen action va reason modal yoz.
13. incident create/contact flow qo‘sh.
14. proctor DTOdan answer key/grade/sensitive data chiqar.
15. Security/data guard: presence final attempt status emas; proctor answer key ko‘rmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: unauthorized monitor room testi.
19. Integration/contract test: realtime status/reconnect testi.
20. E2E/security test: pause/extend/reopen permission E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: monitor uchun private scoring payload reuse qilinsa.
25. Done condition: teacher/proctor live holatni ko‘rib scoped action qila olsa.
```

## Prompt 36 — Security profile va Safe Exam Browser boundary

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 14 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: S0–S4 profile’larni typed policy va client/server enforcementga ulash.
05. Precondition: Prompt 25 policy pack va Prompt 35 monitor tayyor bo‘lishi kerak.
06. Kod yozishdan oldin browser, camera, managed device va SEB integration capabilitylarini tekshir.
07. security profile schema yarat.
08. institution allowed min/max policy qo‘sh.
09. profile→control mapping yoz.
10. preflight requirement mapping qo‘sh.
11. SEB config/key verification boundary yoz.
12. managed-device/LAN capability flag qo‘sh.
13. profile badge/instruction UI yarat.
14. unsupported control blocker report qil.
15. Security/data guard: oddiy browserni lockdown deb ko‘rsatma; unsupported OS bypass qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: profile policy matrix testi.
19. Integration/contract test: SEB config verification negative testi.
20. E2E/security test: unsupported device/preflight E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: SEB rasmiy integration talabi yoki managed environment aniqlanmasa S3ni productionga ochma.
25. Done condition: har assessment profile controls aniq enforce va UI’da ko‘rinsa.
```

## Prompt 37 — Privacy-first camera evidence pilot

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 14, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: local inference, limited evidence va human review bilan camera pilot yaratish.
05. Precondition: Prompt 36 S2 profile va UZ biometric storage tayyor bo‘lishi kerak.
06. Kod yozishdan oldin camera consent, model, worker, evidence va retention boundarylarini tekshir.
07. camera preflight/permission UI yarat.
08. Web Worker/WASM 2–5 FPS pipeline yoz.
09. face present/count va phone/freeze flag qo‘sh.
10. consecutive-window threshold yoz.
11. normal frame discard qil.
12. policy bo‘lsa limited snapshot/clip saqla.
13. UZ bucket hash/access/retention yoz.
14. review timeline va disposition UI yarat.
15. Security/data guard: emotion, gaze, honesty score va automatic misconduct taqiqlansin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: raw-frame non-retention testi.
19. Integration/contract test: flag threshold/device throttle testi.
20. E2E/security test: evidence ACL/retention/delete E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: UZ storage, legal review yoki camera alternative tayyor bo‘lmasa.
25. Done condition: pilot flag, alternative path va human review bilan ishlasa.
```

## Prompt 38 — Attempt/proctoring checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 30, 31, 32, 33, 34, 35, 36, 37 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: secure attemptni mock exam, reconnect storm va accessibility holatida yakuniy tekshirish.
05. Precondition: Prompt 30–37 merge-ready bo‘lishi kerak.
06. Kod yozishdan oldin attempt invariants, monitor, profile, evidence va receiptsni ko‘rib chiq.
07. normal mock exam ishlat.
08. offline/reconnect/crash scenario ishlat.
09. third-strike scenario ishlat.
10. pause/extend/reopen scenario ishlat.
11. screen-reader/accommodation scenario ishlat.
12. camera opt-out/pilot scenario ishlat.
13. answer-key payload scan ishlat.
14. Phase E readiness/residual risk yoz.
15. Security/data guard: camera yoki browser flag academic hukmga aylantirilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: Playwright multi-user mock exam.
19. Integration/contract test: reconnect/load integration suite.
20. E2E/security test: privacy/accessibility/security negative suite.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: data loss, answer leak yoki accommodation blocker qolsa.
25. Done condition: answer loss zero va attempt governance to‘liq bo‘lsa.
```


# Phase E — Exam operations, paper va grade governance

## Prompt 39 — Exam scheduling solver

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 15, 26 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: period, room, student va proctor constraintlari bilan explainable exam schedule yaratish.
05. Precondition: Prompt 26 calendar va academic roster tayyor bo‘lishi kerak.
06. Kod yozishdan oldin room inventory, registration va accommodation inputlarini tekshir.
07. exam window/period/room tables yarat.
08. hard constraint model yoz.
09. soft penalty/weight model yoz.
10. solver adapter va deterministic seed qo‘sh.
11. solution metrics/report yarat.
12. what-if/perturbation compare yoz.
13. admin weight/constraint UI yarat.
14. human approval va schedule versioning qo‘sh.
15. Security/data guard: hard violationli yechim publish bo‘lmasin; black-box score izohsiz bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: known feasible/infeasible fixture testi.
19. Integration/contract test: hard constraint property testi.
20. E2E/security test: schedule version/publish E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: room/accommodation/proctor data to‘liq bo‘lmasa.
25. Done condition: hard violation zero va trade-off reportli schedule yaralsa.
```

## Prompt 40 — Seat, proctor, hall ticket va check-in

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 15 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: published schedule asosida seat/proctor assignment va offline-tolerant check-in yaratish.
05. Precondition: Prompt 39 approved schedule mavjud bo‘lishi kerak.
06. Kod yozishdan oldin room layout, seat feature va proctor availabilityni tekshir.
07. room seat-map schema yarat.
08. random/variant/accommodation seat allocator yoz.
09. proctor availability/workload allocator yoz.
10. hall ticket signed QR/PDF yarat.
11. room/proctor register export qil.
12. student/proctor acknowledgement qo‘sh.
13. offline check-in journal yarat.
14. reseat/replacement audit flow yoz.
15. Security/data guard: seat QR answer key yoki raw sensitive reasonni saqlamasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: seat capacity/accommodation testi.
19. Integration/contract test: proctor clash/workload testi.
20. E2E/security test: hall-ticket/offline check-in E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: room layout yoki accommodation seat talabi noaniq bo‘lsa.
25. Done condition: seat/hall-ticket mismatch va proctor clash nol bo‘lsa.
```

## Prompt 41 — Exam command center, incident va notifications

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 15, 30 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: exam-day health, attendance va incidentlarni bitta auditable command centerda boshqarish.
05. Precondition: Prompt 35 monitor va Prompt 40 check-in tayyor bo‘lishi kerak.
06. Kod yozishdan oldin incident types, severity, communication channels va ownerlarni tekshir.
07. command-center read model yarat.
08. room/attempt/check-in status cards yoz.
09. incident type/severity/state machine yarat.
10. owner/affected candidates/action fields qo‘sh.
11. pause/extension/evacuation hooks yoz.
12. email/SMS/Telegram deep-link adapter boundary yarat.
13. delivery status va old schedule invalidation qo‘sh.
14. postmortem/action-item workflow yoz.
15. Security/data guard: notification preview sensitive health/integrity detail bermasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: incident state/authorization testi.
19. Integration/contract test: mass notification idempotency testi.
20. E2E/security test: room outage/evacuation E2E drill.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: academic remedy owneri belgilanmasa.
25. Done condition: har incident owner, action, affected scope va audit bilan yopilsa.
```

## Prompt 42 — Paper packet, QR va chain of custody

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 16 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: approved examdan per-student/form paper packet va custody ledger yaratish.
05. Precondition: Prompt 27 assessment snapshot va Prompt 40 room assignment tayyor bo‘lishi kerak.
06. Kod yozishdan oldin print template, form variant, accommodation va packet countsni tekshir.
07. paper batch/packet/page tables yarat.
08. opaque packet va signed per-page QR yarat.
09. detachable identity cover va backup code yoz.
10. A/B/per-student form manifest yarat.
11. large-print/one-sided accommodation render qil.
12. PDF metadata/layer secret scan qo‘sh.
13. print proof/download/acknowledgement flow yarat.
14. custody count/handoff/unused destruction events yoz.
15. Security/data guard: QR va PDF answer key saqlamasin; download scoped va short-lived bo‘lsin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: QR signature/replay testi.
19. Integration/contract test: packet page/count/hash testi.
20. E2E/security test: print/custody authorization E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: print proof answer/rubric secretni ochsa.
25. Done condition: packet manifest reproducible va custody traceable bo‘lsa.
```

## Prompt 43 — Scan, reconciliation, OMR va OCR

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 16, 17 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: scanned paper sahifalarni silent loss’siz student/questionga reconcile qilish.
05. Precondition: Prompt 42 packets va object storage tayyor bo‘lishi kerak.
06. Kod yozishdan oldin scanner DPI/duplex, QR, OMR va OCR provider capabilitylarini tekshir.
07. scan batch upload/worker yarat.
08. orientation/dewarp/quality checks yoz.
09. QR decode va page routing qil.
10. duplicate/missing/orphan detection yoz.
11. manual reconciliation queue yarat.
12. OMR confidence/ambiguous mark queue yoz.
13. handwriting/math OCR derivative yarat.
14. expected==reconciled completion blocker qo‘sh.
15. Security/data guard: original scan immutable; enhancement/transcript derivative va hash lineage bilan.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: out-of-order/duplicate/missing page testi.
19. Integration/contract test: forged/unreadable QR reconciliation testi.
20. E2E/security test: OMR/OCR low-confidence manual-route testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: scan quality gate fail-open qilinsa.
25. Done condition: silent missing page va wrong student mapping nol bo‘lsa.
```

## Prompt 44 — Safe file, code va oral submission

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 17 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: project/file/code/audio/video assessmentlar uchun secure resumable submission yaratish.
05. Precondition: Prompt 03 object storage va Prompt 28 student assignment tayyor bo‘lishi kerak.
06. Kod yozishdan oldin brief file limits, scanner, sandbox va media requirementsni tekshir.
07. upload session/multipart contract yarat.
08. MIME/magic/hash/quarantine qo‘sh.
09. archive/macro/PDF active-content checks yoz.
10. signed submission receipt yarat.
11. authorized resubmission/version flow yarat.
12. code microVM/container limits yoz.
13. oral/media chunk resume va normalize worker yarat.
14. transcript confidence/manual listen queue qo‘sh.
15. Security/data guard: uploaded code hook ishlamasin; quarantine late penaltyga aylanmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: malicious upload/decompression testi.
19. Integration/contract test: code sandbox escape/resource-limit testi.
20. E2E/security test: media resume/receipt E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: sandbox yoki malware scanning fail-open bo‘lsa.
25. Done condition: safe accepted submission va immutable receipt yaralsa.
```

## Prompt 45 — Academic grade rules va deterministic calculation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 18 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: weighted, hurdle, late, exempt, resit va rounding qoidalarini versionlangan DSL’da hisoblash.
05. Precondition: Prompt 22 rubric va Prompt 25 policy tayyor bo‘lishi kerak.
06. Kod yozishdan oldin institution grading rules va boundary misollarini product owner bilan tasdiqla.
07. academic rule schema/table yarat.
08. decimal arithmetic service yoz.
09. raw/moderated/adjusted/final layers yarat.
10. missing/zero/exempt/pending semantics yoz.
11. hurdle/weight/late/resit cap yoz.
12. rounding/boundary stage yoz.
13. calculation input/output snapshot yarat.
14. human-readable breakdown API/UI yoz.
15. Security/data guard: arbitrary code eval yo‘q; final grade float bilan hisoblanmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: boundary/property-based tests.
19. Integration/contract test: missing/exempt/resit fixture tests.
20. E2E/security test: old rule-version reproducibility testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: institution rule semantics tasdiqlanmasa.
25. Done condition: barcha approved examples exact va qayta reproducible chiqsa.
```

## Prompt 46 — Marker allocation, calibration va moderation

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 18, 20 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: pseudonymous marking va risk-based moderation workflowini yaratish.
05. Precondition: Prompt 22 rubric, Prompt 44 submission va Prompt 45 rules tayyor bo‘lishi kerak.
06. Kod yozishdan oldin marker roles, workload, conflicts va moderation policylarini tekshir.
07. marking allocation/workload service yarat.
08. pseudonymous response DTO/UI yoz.
09. anchor calibration run yarat.
10. criterion score/comment save yoz.
11. single/sample/second/double modes qo‘sh.
12. disagreement threshold/adjudication yoz.
13. external examiner scoped access qo‘sh.
14. completion/progress/overdue metrics yoz.
15. Security/data guard: marker sensitive case reason yoki unrelated identityni ko‘rmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: allocation/conflict authorization testi.
19. Integration/contract test: calibration threshold testi.
20. E2E/security test: double-mark disagreement E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: marker identity masking assessment turiga mos kelmasa explicit exception yozilmasa.
25. Done condition: moderation policy bo‘yicha agreed mark va audit yaralsa.
```

## Prompt 47 — Board, ratification, result release va grade ledger

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 18 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: provisional markni authorized board orqali immutable final resultga aylantirish.
05. Precondition: Prompt 45–46 calculation va moderation complete bo‘lishi kerak.
06. Kod yozishdan oldin board roles, quorum, holding grade va release policylarini tekshir.
07. board/meeting/attendee/decision tables yarat.
08. board-ready blocker checker yoz.
09. quorum/conflict declaration qo‘sh.
10. gradebook snapshot hash yarat.
11. ratification transaction yoz.
12. release batch/notification qo‘sh.
13. append-only grade amendment ledger yarat.
14. SIS/HEMIS outbox/reconciliation hook qo‘sh.
15. Security/data guard: final grade direct UPDATE bilan overwrite qilinmasin; ratification’siz release yo‘q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: board blocker/quorum testi.
19. Integration/contract test: ratification/release idempotency testi.
20. E2E/security test: grade amendment ledger/SIS reconciliation testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: board authority yoki grade status policy tasdiqlanmasa.
25. Done condition: final result authority, snapshot va change history bilan chiqsa.
```

## Prompt 48 — Special consideration, deferral, resit, appeal va scoring incident

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 18, 19 va 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: sensitive case, attempt lineage, remedy va wrong-key rescore workflowini yopish.
05. Precondition: Prompt 47 result governance va Prompt 30 attempt modeli tayyor bo‘lishi kerak.
06. Kod yozishdan oldin case turlari, deadlines, cap, remedy authority va privacy requirementlarini tekshir.
07. case/evidence/decision tables yarat.
08. restricted encrypted evidence storage yoz.
09. extension/deferral/resit/regrade/appeal states yoz.
10. attempt lineage/cap/policy pin qo‘sh.
11. equivalent assessment assignment yoz.
12. SLA/owner/notification UI yarat.
13. scoring incident freeze/impact/remedy yoz.
14. idempotent rescore va amendment integration qil.
15. Security/data guard: AI case hukmi chiqarmasin; marker sensitive evidence ko‘rmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: case ACL/retention testi.
19. Integration/contract test: deferral/resit lineage/cap testi.
20. E2E/security test: wrong-key freeze/rescore/appeal E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: remedy authority, deadline yoki cap policy noaniq bo‘lsa.
25. Done condition: case’dan remedy va final ledgergacha auditable oqim bo‘lsa.
```

## Prompt 49 — Exam, paper va grade checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 15, 16, 17, 18, 19 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: exam operationsdan final result/appealgacha controlled mock cycle o‘tkazish.
05. Precondition: Prompt 39–48 merge-ready bo‘lishi kerak.
06. Kod yozishdan oldin solver, packets, submission, marking, board va casesni end-to-end tekshir.
07. schedule/seat/proctor yarat.
08. online va paper cohort mock qil.
09. scan/reconcile va submission receipt tekshir.
10. marker calibration/moderation qil.
11. grade rules hisobla.
12. board ratify/release qil.
13. wrong-key rescore va appeal drill qil.
14. Phase F readiness/residual risk yoz.
15. Security/data guard: manual hidden DB correction bilan drill o‘tkazma.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: multi-role Playwright cycle.
19. Integration/contract test: paper reconciliation fixture suite.
20. E2E/security test: grade/board/case integration suite.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: grade correctness yoki result governance critical issue qolsa.
25. Done condition: hard conflict, page loss, arithmetic error va unauthorized final release nol bo‘lsa.
```


# Phase F — AI, resources va content

## Prompt 50 — Source pack va secure RAG ingestion

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 20, 22, 23, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher-approved source’larni provenance/citation bilan safe corpusga aylantirish.
05. Precondition: Prompt 44 safe upload va pgvector foundation tayyor bo‘lishi kerak.
06. Kod yozishdan oldin PDF/DOCX/PPTX/URL extractor va tenant ACL talablarini tekshir.
07. source pack/source/chunk tables yarat.
08. safe upload va URL SSRF validation yoz.
09. text/OCR/page extraction worker yarat.
10. HTML/script/instruction isolation yoz.
11. chunk/page/quote provenance saqla.
12. embedding model/version va tenant namespace yoz.
13. teacher source approval UI yarat.
14. citation claim contract va RAG eval fixture yarat.
15. Security/data guard: document text system instruction emas; cross-tenant vector retrieval taqiqlansin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: SSRF/malicious PDF/prompt-injection testi.
19. Integration/contract test: tenant vector ACL testi.
20. E2E/security test: citation page/quote integrity testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: extractor source locationni saqlay olmasa.
25. Done condition: approved corpusdan provenance bilan retrieval ishlasa.
```

## Prompt 51 — Written AI grading shadow mode

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 20 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rubric/evidence structured AI draftni student/final grade’dan yashirin shadow rejimda ishlatish.
05. Precondition: Prompt 22 rubric, Prompt 46 human marks va Prompt 50 source pack tayyor bo‘lishi kerak.
06. Kod yozishdan oldin provider privacy, PII redaction va output schema requirementlarini tekshir.
07. AI grading job/registry records yarat.
08. PII redaction va prompt template yoz.
09. concept/evidence/contradiction pipeline yarat.
10. strict criterion JSON schema enforce qil.
11. evidence span validate qil.
12. deterministic score aggregation yoz.
13. confidence/disagreement routing yoz.
14. human compare/override/reason UI yarat.
15. Security/data guard: LLM total score final authority emas; model web/tool access qilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: prompt injection/keyword/negation testi.
19. Integration/contract test: invalid JSON/evidence span testi.
20. E2E/security test: AI-human shadow comparison E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: provider data terms yoki exact model version nazorat qilinmasa.
25. Done condition: shadow score reproducible va teacher finalini o‘zgartirmasa.
```

## Prompt 52 — AI grading evaluation, MLOps va rollback

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 20, 30 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: golden set, deployment gate, drift va model rollbackni production boshqaruviga aylantirish.
05. Precondition: Prompt 51 shadow runs va human gold marks mavjud bo‘lishi kerak.
06. Kod yozishdan oldin evaluation metrics, subgroup va model-change triggerlarini tekshir.
07. AI system/model/prompt/eval tables to‘ldir.
08. golden/adversarial dataset versionla.
09. QWK/MAE/F1/calibration hisobla.
10. language/subgroup breakdown yoz.
11. OFFLINE→SHADOW→ASSIST gate service yarat.
12. override/drift/cost dashboard yoz.
13. model version pin/allowlist yarat.
14. rollback/disable kill switch va runbook yoz.
15. Security/data guard: golden set trainingga qo‘shilmasin; old final grade silent regrade qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: metric calculation unit testi.
19. Integration/contract test: model change regression gate testi.
20. E2E/security test: kill-switch/rollback E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: holdout yetarli yoki human adjudication mavjud bo‘lmasa.
25. Done condition: approved threshold va rollback bilan TEACHER_ASSISTga tayyor bo‘lsa.
```

## Prompt 53 — AI question generator 50/30/20

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 21 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: source-grounded, difficulty-controlled item draft pipeline yaratish.
05. Precondition: Prompt 20 competency, Prompt 21 item bank va Prompt 50 source pack tayyor bo‘lishi kerak.
06. Kod yozishdan oldin target item types, model provider va validator capabilitylarini tekshir.
07. generation input/blueprint schema yarat.
08. 50/30/20 count algorithm yoz.
09. har slot uchun 3–5 candidate job yarat.
10. answer/source verifier yoz.
11. distractor misconception generator yoz.
12. ambiguity/multi-correct/duplicate validators yoz.
13. language/accessibility/difficulty checks qo‘sh.
14. teacher review/edit/reject/publish flow yarat.
15. Security/data guard: AI_DRAFT teacher approval’siz APPROVED bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: difficulty count property testi.
19. Integration/contract test: unsupported/source-missing candidate rejection testi.
20. E2E/security test: generate→review→item-bank E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: source pack yoki answer verifier yetarli bo‘lmasa.
25. Done condition: requested count exact va barcha item source/validator/teacher reviewga ega bo‘lsa.
```

## Prompt 54 — Resource recommendation connectorlari

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 23 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: maqola, paper, video, news va institutional materialni verified metadata bilan tavsiya qilish.
05. Precondition: Prompt 50 source model va provider job infrastructure tayyor bo‘lishi kerak.
06. Kod yozishdan oldin OpenAlex/Semantic Scholar/Crossref/CORE/YouTube/RSS quota va termsni tekshir.
07. canonical resource schema yarat.
08. connector adapter contract yoz.
09. API fetch/cache/quota/backoff qo‘sh.
10. DOI/URL/title dedupe yoz.
11. license/OA/language metadata qo‘sh.
12. weighted ranking service yarat.
13. LLM summaryni retrieved recordga chekla.
14. teacher trust/hide/save/source-pack feedback UI yarat.
15. Security/data guard: LLM bibliographic record yaratmasin; YouTube transcript scraping qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: connector normalization/dedupe testi.
19. Integration/contract test: quota/cache/provider outage testi.
20. E2E/security test: citation/why-recommended UI E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: provider ToS yoki quota production loadga mos bo‘lmasa.
25. Done condition: real recordlardan izohli recommendation chiqsa.
```

## Prompt 55 — Intervention loop, adaptive practice va support

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 24 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: assessment evidence’dan teacher-approved action, reassessment va formative mastery oqimini yaratish.
05. Precondition: Prompt 20 competency, Prompt 53 items va grade evidence tayyor bo‘lishi kerak.
06. Kod yozishdan oldin misconception, intervention, reassessment va BKT inputlarini tekshir.
07. misconception mappings va cluster review yarat.
08. intervention library/version tables yarat.
09. next-action card service/UI yoz.
10. teacher approve/edit/dismiss/assign flow yarat.
11. different-item reassessment yarat.
12. before/after/retention metrics yoz.
13. rule+BKT mastery estimate va scheduler yarat.
14. support signal/case va student contest flow qo‘sh.
15. Security/data guard: permanent low-ability label, auto penalty yoki private chat sentiment ishlatilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: misconception→intervention mapping testi.
19. Integration/contract test: reassessment/item non-duplication testi.
20. E2E/security test: mastery/support privacy E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: intervention capacity yoki outcome mapping mavjud bo‘lmasa.
25. Done condition: teacher action va measurable reassessment loop yopilsa.
```

## Prompt 56 — Canonical presentation va native editor MVP

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 22, 26 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: provider-independent slide document, outline flow va accessible native editor yaratish.
05. Precondition: Prompt 50 source packs va object storage tayyor bo‘lishi kerak.
06. Kod yozishdan oldin canonical block/layout/export/accessibility talablarini tekshir.
07. presentation/version canonical schema yarat.
08. source→outline→approval flow yoz.
09. structured slide/block editor yarat.
10. reorder/theme/notes/citations qo‘sh.
11. image/chart/table blocklari yoz.
12. alt text/contrast/overflow QA yoz.
13. version diff/rollback/comments qo‘sh.
14. PPTX/PDF worker export skeleton yarat.
15. Security/data guard: provider raw response canonical modeldan tashqariga sizib ketmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: canonical schema/version testlari.
19. Integration/contract test: editor save/diff/rollback testi.
20. E2E/security test: PPTX/PDF snapshot/accessibility testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: canonical layout yoki export mapping noaniq bo‘lsa.
25. Done condition: source citationli deck native edit va export qilinsa.
```

## Prompt 57 — Claude native adapter

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 22, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Claude’ni Edikit ichidagi streaming source-synthesis va canonical JSON provider sifatida ulash.
05. Precondition: Prompt 50 source packs, Prompt 56 canonical deck va KMS tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current Anthropic API capability, Files format va data policy’ni tekshir.
07. server-side provider client yoz.
08. KMS API key retrieval qo‘sh.
09. Files/text conversion mapping yoz.
10. streaming SSE/Socket job progress yoz.
11. citation/search-result mapping qil.
12. strict canonical JSON validation yoz.
13. retry/circuit/cost/usage qo‘sh.
14. provider/model/prompt/attribution metadata saqla.
15. Security/data guard: API key browserga chiqmasin; student PII default yuborilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: provider client mocked contract testi.
19. Integration/contract test: stream interruption/retry testi.
20. E2E/security test: citation→canonical deck E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: exact provider docs/data terms tekshirilmasa.
25. Done condition: Claude output validated canonical artifact bo‘lsa.
```

## Prompt 58 — Gamma va Manus async adapterlari

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 22, 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Gamma generation va Manus task/artifact oqimini unified provider job contractga ulash.
05. Precondition: Prompt 56 provider-independent presentation service tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current Gamma/Manus create/status/webhook/export capabilitylarini tekshir.
07. PresentationProvider interface implement qil.
08. Gamma create/poll/backoff/cancel yoz.
09. Gamma preview/export artifact mapping qil.
10. Manus file/project/task create yoz.
11. Manus signed webhook va follow-up yoz.
12. provider artifactni local object storagega copy qil.
13. idempotency/circuit/dead-letter qo‘sh.
14. capability/attribution/limitation UI ko‘rsat.
15. Security/data guard: Gamma embedded edit capability yo‘q bo‘lsa soxta edit bermasin; credentiallar alohida.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: Gamma polling/idempotency mock testi.
19. Integration/contract test: Manus webhook replay/out-of-order testi.
20. E2E/security test: provider failure/artifact-copy E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: provider API/terms current tekshirilmasa yoki expiring artifact copy qilinmasa.
25. Done condition: ikkala provider unified job status va safe artifact bilan ishlasa.
```

## Prompt 59 — Canva, Google Slides, export va quiz-from-deck

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 22 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: Canva modal/OAuth va Google Slides minimum-scope integratsiyasini canonical deck bilan yopish.
05. Precondition: Prompt 56 canonical deck va Prompt 12 account framework tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current Canva Button/Connect va Google Slides/Drive scopesni tekshir.
07. Canva Button modal create/edit callbacks yoz.
08. callback design/artifact version mapping qil.
09. Canva Connect PKCE/token vault yoz.
10. temporary edit/view/import/export flow qo‘sh.
11. Google incremental OAuth drive.file yoz.
12. Slides create/batchUpdate/export yoz.
13. canonical deckdan quizConcepts/source pack flow yoz.
14. PPTX/PDF/handout attribution/accessibility final qil.
15. Security/data guard: Google login token boshqa providerga berilmasin; full Drive scope default bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: OAuth state/PKCE/revoke testi.
19. Integration/contract test: Canva callback/Google batchUpdate mock testi.
20. E2E/security test: deck→quiz→export E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: provider entitlement yoki callback security tasdiqlanmasa.
25. Done condition: Canva/Google unlinkable, minimum-scope va canonical artifact saqlansa.
```

## Prompt 60 — AI/content checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 50, 51, 52, 53, 54, 55, 56, 57, 58, 59 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: source, AI grading, questions, resources va presentationlarni measured pilot orqali yakuniy tekshirish.
05. Precondition: Prompt 50–59 merge-ready va provider sandbox credentiallari mavjud bo‘lishi kerak.
06. Kod yozishdan oldin AI registry, provider data flow, evaluation va artifact lineage’ni tekshir.
07. malicious source/RAG red-team ishlat.
08. written grading shadow benchmark ishlat.
09. question generation expert review sample qil.
10. resource citation/URL check qil.
11. intervention/reassessment pilot qil.
12. native/provider deck comparison qil.
13. provider outage/cost/quota drill qil.
14. Phase G readiness/residual risk yoz.
15. Security/data guard: summative AI authority yoki unverified source publish qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: AI adversarial/golden suite.
19. Integration/contract test: provider contract/failure integration suite.
20. E2E/security test: teacher multi-feature Playwright pilot.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: data privacy, model eval yoki provider failure critical issue qolsa.
25. Done condition: human-governed, source-grounded va rollbackable AI oqimlari bo‘lsa.
```


# Phase G — Institutional quality va production hardening

## Prompt 61 — Portfolio va verifiable credentials

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 25, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: student evidence portfolio va Open Badges/CLR-compatible credential lifecycle yaratish.
05. Precondition: Prompt 20 competency va ratified grade/evidence tayyor bo‘lishi kerak.
06. Kod yozishdan oldin credential criteria, issuer authority va evidence visibilityni tekshir.
07. portfolio/item/share-grant tables yarat.
08. default-private student portfolio UI yoz.
09. credential definition/criteria version yarat.
10. deterministic eligibility service yoz.
11. authorized issue/revoke/status flow yoz.
12. Open Badges/CLR/VC serialization yoz.
13. QR/verifier/selective share qo‘sh.
14. expiry/renewal/appeal/audit qo‘sh.
15. Security/data guard: LLM credential bermasin; raw sensitive submission public credentialga chiqmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: eligibility/issuer authorization testi.
19. Integration/contract test: signature/status/revocation testi.
20. E2E/security test: selective share/revoke E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: issuer governance yoki evidence retention belgilanmasa.
25. Done condition: verifier valid/revoked holatni to‘g‘ri ko‘rsa.
```

## Prompt 62 — Program quality va accreditation workspace

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 25 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: curriculum map, aggregate evidence, finding va improvement action workflowini yaratish.
05. Precondition: Prompt 20 competency va Prompt 61 evidence model tayyor bo‘lishi kerak.
06. Kod yozishdan oldin I/R/M/A mapping, sample va accreditation standardlarini tekshir.
07. curriculum map/version tables yarat.
08. course↔program outcome mapping UI yoz.
09. direct/indirect evidence aggregation yoz.
10. minimum cell suppression qo‘sh.
11. assessment cycle/finding yarat.
12. improvement action owner/deadline yoz.
13. follow-up evidence/close blocker qo‘sh.
14. manifest/hash accreditation export yarat.
15. Security/data guard: individual teacher punishment leaderboard yaratma; sensitive raw PII aggregate UIga chiqmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: mapping gap/version testi.
19. Integration/contract test: cell suppression/authorization testi.
20. E2E/security test: finding→action→follow-up E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: program owner yoki accreditation criteria tasdiqlanmasa.
25. Done condition: program cycle evidence bilan yopilsa.
```

## Prompt 63 — Uzbek Latin/Cyrillic va terminology layer

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 26 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: uz-Latn, uz-Cyrl, ru va en content/version/searchni birinchi-class qilish.
05. Precondition: canonical content/item/presentation schemas mavjud bo‘lishi kerak.
06. Kod yozishdan oldin current strings, names, apostrophes va language fieldsni tekshir.
07. BCP-47/script fieldsni schema/APIga qo‘sh.
08. deterministic transliteration service yoz.
09. original text preservation qo‘sh.
10. ambiguous token highlight qil.
11. proper-name canonical fieldni ajrat.
12. terminology bank/version yarat.
13. cross-script search normalization/index yoz.
14. AI prompts/contentga glossary injection qo‘sh.
15. Security/data guard: transliteration translation yoki psychometric equivalence deb qabul qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: Latin↔Cyrillic golden set testi.
19. Integration/contract test: Uzbek name/apostrophe normalization testi.
20. E2E/security test: cross-script search/terminology E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: identity name va content transliteration birlashtirilsa.
25. Done condition: original matn saqlanib ikki scriptda consistent ishlasa.
```

## Prompt 64 — WCAG 2.2 AA va artifact accessibility

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 26, 29 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher/student/admin/proctor critical journeys va generated artifactlarni accessible qilish.
05. Precondition: asosiy frontend ekranlari va exportlar mavjud bo‘lishi kerak.
06. Kod yozishdan oldin semantic DOM, keyboard, timer, editor, PDF/DOCX/PPTX outputlarni audit qil.
07. landmark/heading/label/focus standartini qo‘llash.
08. keyboard va skip-link navigation yoz.
09. color/contrast/reduced-motion settings qo‘sh.
10. timer/save/warning live-regionlarini sozla.
11. question/formula/media accessible control yoz.
12. drag-drop alternative va touch targets qo‘sh.
13. PDF/DOCX/PPTX reading order/alt text QA qo‘sh.
14. ACR evidence va known-gap backlog yarat.
15. Security/data guard: automated checkerning o‘zi yetarli emas; accessibility action strike bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: axe automated suite.
19. Integration/contract test: manual keyboard + screen reader critical journey.
20. E2E/security test: accommodation/generated artifact user acceptance testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: timed/high-stakes flowda accessibility blocker qolsa.
25. Done condition: critical journeylar WCAG target va approved alternatives bilan ishlasa.
```

## Prompt 65 — Data classification, privacy, retention va purge

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: D0–D6 classification, legal hold, DSAR va multi-store deletionni operational qilish.
05. Precondition: barcha domain table/object/providerlar mavjud bo‘lishi kerak.
06. Kod yozishdan oldin data inventory, region, retention va provider delete capabilitylarini tekshir.
07. data asset inventory/processing tables yarat.
08. har entity/objectga class va retention bog‘la.
09. D3/D4 restricted/KMS/UZ boundary enforce qil.
10. legal hold service yoz.
11. archive→scheduled→purged worker yoz.
12. DB/object/vector/cache/provider deletion yoz.
13. DSAR access/correct/export/delete flow yoz.
14. deletion receipt va backup-expiry record yarat.
15. Security/data guard: D4 UZ tashqariga chiqmasin; legal hold fail-open bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: data-class access matrix testi.
19. Integration/contract test: legal-hold/purge derived-copy testi.
20. E2E/security test: DSAR/export/delete E2E testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: legal basis/retention yoki data region counsel tomonidan tasdiqlanmasa.
25. Done condition: purge barcha derived store’larni yopib receipt bersa.
```

## Prompt 66 — Official HEMIS va OneID adapter boundary

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 8, 27 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rasmiy contract mavjud bo‘lganda roster/grade va identity integrationni xavfsiz ulash.
05. Precondition: Prompt 16 roster, Prompt 47 ratified grade va Prompt 12 identity tayyor bo‘lishi kerak.
06. Kod yozishdan oldin rasmiy API/export/protocol, scopes, rate limits va contractni qayta tekshir.
07. provider adapter interface implement qil.
08. source-of-truth field mapping yoz.
09. HEMIS pull→staging→diff flow qo‘sh.
10. ratified-only grade push yoz.
11. idempotency/retry/dead-letter qo‘sh.
12. pull-back reconciliation yarat.
13. OneID identity account provider yoz.
14. token vault/revoke/audit qo‘sh.
15. Security/data guard: scraping, undocumented endpoint yoki token reuse taqiqlansin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: adapter sandbox contract testi.
19. Integration/contract test: grade push idempotency/reconciliation testi.
20. E2E/security test: OneID account-link takeover testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: rasmiy shartnoma/protocol/sandbox mavjud bo‘lmasa promptni BLOCKED deb yakunla.
25. Done condition: official sandboxda sync va identity xavfsiz ishlasa.
```

## Prompt 67 — API, Socket, job, webhook va outbox contract audit

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 28 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: barcha module boundarylarini versionlangan Zod/OpenAPI/event contracts bilan birlashtirish.
05. Precondition: asosiy domain modullar implement qilingan bo‘lishi kerak.
06. Kod yozishdan oldin HTTP/Socket/jobs/webhooksda duplicate schema va inconsistent errorlarni tekshir.
07. `/api/v1` route inventory yarat.
08. shared Zod request/response schemasga o‘tkaz.
09. OpenAPI generate/validate qil.
10. cursor/idempotency/ETag conventions qo‘llash.
11. Socket event allowlist/auth/rate limit audit qil.
12. job payload/version/trace contract yoz.
13. webhook raw-signature/replay/out-of-order audit qil.
14. transactional outbox va consumer idempotency audit qil.
15. Security/data guard: private scoring/sensitive case generic API schema’ga qo‘shilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: OpenAPI contract test.
19. Integration/contract test: Socket/job schema compatibility testi.
20. E2E/security test: webhook/outbox replay/idempotency testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: undocumented privileged endpoint yoki unversioned event qolsa.
25. Done condition: barcha write surface versionlangan, validated va auditable bo‘lsa.
```

## Prompt 68 — Role-based frontend completion

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 29 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: teacher, student, admin, proctor, marker va board journeylarini yagona accessible shell’da tugatish.
05. Precondition: Prompt 67 APIs va domain flowlar stabil bo‘lishi kerak.
06. Kod yozishdan oldin screen inventory, navigation, mobile va unsaved-state behaviorini tekshir.
07. role-aware shell/sidebar/switcher yarat.
08. Teacher Overview/course tabsni tugat.
09. assessment builder/monitor/grading queue tugat.
10. student calendar/brief/attempt/result/case tugat.
11. admin roster/policy/exam/privacy screens tugat.
12. proctor/marker/board scoped screens tugat.
13. loading/error/empty/offline/job states yoz.
14. help/language/keyboard/mobile polish qil.
15. Security/data guard: UI permission backend authorization o‘rnini bosmasin; secret DTO render qilinmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: role navigation/authorization Playwright.
19. Integration/contract test: offline/error/unsaved-state Playwright.
20. E2E/security test: keyboard/mobile/accessibility Playwright.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: critical backend contract hali o‘zgaruvchan bo‘lsa.
25. Done condition: har rol end-to-end taskni manual DB yordamisiz tugata olsa.
```

## Prompt 69 — OpenTelemetry, metrics, SLO va alerts

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 30 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: HTTP/Socket/job/provider/domain flowlarni privacy-safe observability bilan qoplash.
05. Precondition: barcha critical service va worker entrypointlari mavjud bo‘lishi kerak.
06. Kod yozishdan oldin logger, request ID, queue va provider telemetryni tekshir.
07. OTel SDK va context propagation qo‘sh.
08. HTTP/DB/Redis/job/provider spans yoz.
09. Socket manual spans qo‘sh.
10. platform/domain metrics instrument qil.
11. PII/answer/essay/token redaction audit qil.
12. SLO dashboard va burn-rate alerts yarat.
13. cost/quota/provider circuit alerts qo‘sh.
14. runbook linkli alert annotations yoz.
15. Security/data guard: raw response, health evidence, answer key yoki token telemetryga tushmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: trace propagation integration testi.
19. Integration/contract test: log/span redaction testi.
20. E2E/security test: metric/alert synthetic incident testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: observability backend sensitive region/policyga mos bo‘lmasa.
25. Done condition: critical journey trace va SLO dashboardda ko‘rinsa.
```

## Prompt 70 — ASVS, threat model va AI red-team

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 30, 34 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: web/API/socket/upload/RAG/AI securityni requirement-level gate qilish.
05. Precondition: Prompt 67 contract audit va Prompt 69 telemetry tayyor bo‘lishi kerak.
06. Kod yozishdan oldin current threat model, dependencies, SBOM va pen-test scope’ni tekshir.
07. module trust-boundary threat model yangila.
08. ASVS 5 target requirement matrix yarat.
09. SAST/SCA/secrets/SBOM CI gates qo‘sh.
10. DAST/API/socket fuzz suite qo‘sh.
11. cross-tenant/IDOR suite kengaytir.
12. upload/webhook/provider token tests qo‘sh.
13. RAG/prompt/tool/denial-of-wallet red-team qil.
14. finding owner/SLA/retest evidence yarat.
15. Security/data guard: critical/high finding accepted qilib productionga o‘tkazilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: ASVS automated/manual evidence suite.
19. Integration/contract test: cross-tenant/upload/socket red-team.
20. E2E/security test: AI adversarial/provider-cost abuse suite.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: pen-test scope yoki remediation owner mavjud bo‘lmasa.
25. Done condition: target controls evidence va unresolved critical/high zero bo‘lsa.
```

## Prompt 71 — Peak load, chaos, backup, DR va release safety

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 30, 34 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: exam peak va dependency failurelarda data integrityni isbotlash.
05. Precondition: Prompt 69 observability va production-like environment tayyor bo‘lishi kerak.
06. Kod yozishdan oldin capacity forecast, RPO/RTO, failover va deploy processni tekshir.
07. T−30/T0/autosave/submit load profile yoz.
08. reconnect storm va app-node kill test qil.
09. Redis/DB/object/provider failure inject qil.
10. PostgreSQL PITR/backup restore qil.
11. object/key recovery drill qil.
12. RPO/RTO evidence yoz.
13. blue-green/canary/worker-socket drain yoz.
14. 7–14 day high-stakes freeze/rollback runbook yarat.
15. Security/data guard: load test production PII/answer key bilan ishlamasin; failure data corruption bilan pass bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: peak load SLO testi.
19. Integration/contract test: chaos/reconnect data-loss testi.
20. E2E/security test: isolated backup restore va release rollback testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: backup restore yoki rollback amalda sinovdan o‘tmasa.
25. Done condition: ACK loss zero va RPO/RTO target rehearsalda pass bo‘lsa.
```

## Prompt 72 — Final migration, institutional pilot va procurement pack

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 31, 32, 34 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: legacy cutover, role training, real pilot va institution handoffni bajarish.
05. Precondition: Prompt 61–71 green va change freeze window tasdiqlangan bo‘lishi kerak.
06. Kod yozishdan oldin migration dry-run, support, legal, security va buyer evidence’ni tekshir.
07. final legacy backup/hash ol.
08. migration/reconciliation/cutover qil.
09. PostgreSQL primary va legacy read-only flag qil.
10. teacher/admin/proctor/marker training o‘tkaz.
11. student practice exam o‘tkaz.
12. low-stakes keyin controlled midterm pilot qil.
13. HECVAT/ACR/security/DPA/SLA/exit pack tayyorla.
14. pilot metrics/incidents/rollback decision report qil.
15. Security/data guard: pilot oldidan Gate 0, legal/privacy, accessibility yoki DR blocker waiver bilan yashirilmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: cutover/rollback rehearsal.
19. Integration/contract test: role/practice/pilot E2E acceptance.
20. E2E/security test: full tenant export/restore/delete exit testi.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: migration reconciliation, legal sign-off yoki incident response tayyor bo‘lmasa.
25. Done condition: pilot xavfsiz, supportable va buyer evidence bilan yopilsa.
```

## Prompt 73 — Final system acceptance va handover

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo‘sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research.md`ning 34 bo‘limlarini to‘liq o‘qi va ularga zid yechim kiritma.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: research.md acceptance matrix bo‘yicha butun Edikit release’ini formal qabul qilish.
05. Precondition: Prompt 00–72 ledgerda DONE yoki explicit BLOCKED/DEFERRED authority bilan bo‘lishi kerak.
06. Kod yozishdan oldin all evidence, tests, incidents, residual risks, versions va operational ownerlarni tekshir.
07. security acceptance matrixni tekshir.
08. reliability/DR/SLO evidence tekshir.
09. assessment/psychometric/grade governance tekshir.
10. privacy/legal/data residency tekshir.
11. accessibility/ACR/accommodation tekshir.
12. AI eval/human oversight/rollback tekshir.
13. operations/training/support/vendor-exit tekshir.
14. release sign-off va next-version backlog yarat.
15. Security/data guard: marketing claim test evidence’dan oshmasin; deferred high-risk feature enabled bo‘lmasin.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency’ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo‘sh.
18. Unit test: full regression/security/load suite.
19. Integration/contract test: multi-role production-like acceptance cycle.
20. E2E/security test: restore/export/purge/rollback final drill.
21. Mavjud testlarni ham ishlat; regression bo‘lsa sababini tuzatmasdan testni o‘chirib qo‘yma.
22. `implementation-status.md`ga prompt statusi, dalillar va next readinessni yoz.
23. Global report formatida changed files, migration, command va test natijalarini qaytar.
24. Stop condition: birorta mandatory gate evidence’siz yoki critical risk ownersiz qolsa.
25. Done condition: product, assessment, security, privacy, accessibility va operations sign-off birga bo‘lsa.
```

---

## D. Yakuniy operator qoidasi

- Promptlar ketma-ketligi dependency order hisoblanadi.
- Checkpoint promptlari: **10, 19, 29, 38, 49, 60 va 73**.
- Checkpoint `BLOCKED` bo‘lsa keyingi phase ochilmaydi.
- Har provider integration promptida official documentation va terms aynan bajarish kunida qayta tekshiriladi.
- Har real midterm/final oldidan security, accessibility, DR va operational mock qayta ishlatiladi.
- `research.md` architecture va acceptance source of truth bo‘lib qoladi; `PROMPT_GUIDE.md` bajarish tartibini beradi.
