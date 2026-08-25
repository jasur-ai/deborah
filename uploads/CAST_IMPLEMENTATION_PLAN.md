# Edikit Cast Director — batafsil implementation master plan

> **Holat:** faqat nima qilinadi va qanday bajariladi  
> **Sana:** 2026-07-29  
> **Repository:** `jasur-ai/edikit`  
> **Audited commit:** `0cbf79f`  
> **Source code holati:** ushbu hujjat yozilgan paytda application kodi o‘zgartirilmagan

## 0. Hujjatdan foydalanish tartibi

Har task quyidagi bloklarda beriladi:

- **Natija** — yaratiladigan yoki o‘zgartiriladigan qism;
- **Fayllar** — tegiladigan mavjud va yangi fayllar;
- **Bajarish** — aniq implementation qadamlari;
- **Contract** — API, data yoki event shakli;
- **Tekshiruv** — avtomatik va qo‘lda testlar;
- **Tugallanish sharti** — task yopilishi uchun majburiy holat.

Bajarish ketma-ketligi:

```text
G0 Security
→ C1 Safe Core
→ C2 Professional UX
→ C3 Responsive Teaching
→ C4 Inclusion/Governance
→ C5 Scale/Operations
```

Bir gate tugamasdan undan keyingi gate productionga chiqarilmaydi.

---

# G0 — Security va correctness blockerlar

## G0-01. Cast kodini alohida modullarga ajratish

### Natija

Cast session, scoring, timer va Socket logikasi `socket/game-handler.js` ichidan alohida servis va handlerlarga ko‘chiriladi.

### Fayllar

Yangi:

```text
routes/cast.js
socket/cast-handler.js
services/cast/config-schema.js
services/cast/test-loader.js
services/cast/session-store.js
services/cast/projections.js
services/cast/state-machine.js
services/cast/timer-service.js
services/cast/scoring.js
services/cast/permissions.js
services/cast/answer-service.js
services/cast/leaderboard.js
services/cast/event-store.js
services/cast/errors.js
utils/cast-constants.js
```

O‘zgartiriladi:

```text
server.js
routes/game.js
socket/game-handler.js
package.json
```

### Bajarish

1. `socket/game-handler.js`dagi Cast eventlarni ro‘yxat qilish.
2. `host:*`, `player:*`, `game:*` Cast eventlarini `socket/cast-handler.js`ga ko‘chirish.
3. Arena-specific eventlarni mavjud handlerda qoldirish.
4. `setupCastHandlers(io, socket)` export yaratish.
5. `server.js`da bir connection uchun ikkala handlerni ulash.
6. Business logic’ni Socket callback ichida qoldirmaslik.
7. Har Socket callbackda faqat parse, authorize, service call va ACK qoldirish.
8. Shared error kodlarini `services/cast/errors.js`ga joylash.
9. Legacy eventlar uchun vaqtinchalik compatibility mapping yaratish.
10. Compatibility mappingga removal release raqami qo‘yish.

### Contract

```js
io.on('connection', (socket) => {
  setupSocketHandlers(io, socket);      // Arena va legacy non-Cast
  setupCastHandlers(io, socket);        // New Cast
});
```

### Tekshiruv

- Existing Arena smoke test.
- Existing `/host` va `/play` route smoke test.
- Duplicate Socket listener testi.
- Har Cast event faqat bitta handlerda ro‘yxatdan o‘tishi testi.

### Tugallanish sharti

- Cast scoring/timer/state mutation `socket/game-handler.js`da qolmaydi.
- Arena behavior o‘zgarmaydi.
- Server start error bermaydi.

---

## G0-02. Server-private answer key va public projection

### Natija

Correct answer participant, projector, HTML, public state va generic Socket payloadga kirmaydi.

### Fayllar

```text
services/cast/test-loader.js
services/cast/projections.js
services/cast/session-store.js
socket/cast-handler.js
routes/cast.js
views/game/host.ejs
views/game/enter.ejs
```

### Bajarish

1. Normalized questionni ikki modelga ajratish:
   - `PrivateQuestion`;
   - `PublicQuestion`.
2. `PrivateQuestion`da `correctOptionIds`, rubric va private explanation policy saqlash.
3. `PublicQuestion`da correct answer fieldlarini taqiqlash.
4. `q_correct` yoziladigan barcha kodni olib tashlash.
5. `qCorrect` emit qilinadigan barcha kodni olib tashlash.
6. `questions` to‘liq array’ini EJS orqali host browserga bermaslik.
7. Hostga ham faqat current safe question va Director-private aggregate yuborish.
8. Correctnessni serverda `PrivateQuestion` orqali hisoblash.
9. Reveal phase kelganda alohida safe reveal projection yaratish.
10. Reveal projectionga faqat policy ruxsat bergan fieldlarni qo‘shish.
11. Session save vaqtida private/public pathlarni alohida yozish.
12. Test tugaganda retention policy bo‘yicha private snapshotni saqlash yoki o‘chirish.

### Contract

```js
// Server-private
{
  id: 'q_01',
  text: '...',
  options: [
    { id: 'o_a', text: '...' },
    { id: 'o_b', text: '...' }
  ],
  correctOptionIds: ['o_b'],
  explanation: '...',
  misconceptionByOptionId: {}
}

// Question open paytidagi participant projection
{
  questionId: 'q_01',
  text: '...',
  options: [
    { id: 'o_a', text: '...' },
    { id: 'o_b', text: '...' }
  ],
  media: null,
  phase: 'QUESTION_OPEN',
  openedAt: 1780000000000,
  closesAt: 1780000030000,
  revision: 42
}

// Reveal projection
{
  questionId: 'q_01',
  correctOptionIds: ['o_b'],
  explanation: '...',
  revision: 45
}
```

### Tekshiruv

- HTML source answer-key scan.
- Socket event snapshot scan.
- Firebase public-path scan.
- Participant DevTools payload scan.
- Projector payload scan.
- Pre-reveal correct-answer absence test.
- Post-reveal policy test.

### Tugallanish sharti

- `grep` natijasida runtime public state’da `q_correct` va `qCorrect` qolmaydi.
- Pre-reveal participant payloadidan answer key tiklab bo‘lmaydi.
- Score serverda to‘g‘ri hisoblanadi.

---

## G0-03. Test ownership va immutable test snapshot

### Natija

Teacher faqat ruxsat berilgan testni Cast qiladi; session boshlangandan keyin source test edit qilinsa active session o‘zgarmaydi.

### Fayllar

```text
services/cast/test-loader.js
routes/cast.js
middleware/auth.js
routes/game.js
```

### Bajarish

1. `source`, `key`, `chunk` uchun enum va format schema yaratish.
2. `source=user` bo‘lsa faqat `users/{req.session.user.safeKey}/tests/{key}` pathini o‘qish.
3. Barcha userlar bo‘ylab global test qidirishni Cast flow’dan olib tashlash.
4. `source=mock` va `source=pre` uchun published/active flagni tekshirish.
5. PRE chunk mavjudligini tekshirish.
6. Test name’ni client body’dan authoritative qabul qilmaslik.
7. Testni serverda normalize qilish.
8. Har question va optionga stable ID berish.
9. Snapshotning canonical JSON hashini hisoblash.
10. Sessionga `testId`, `testVersion`, `itemSetHash` yozish.
11. Active session savollarini source testdan qayta o‘qimaslik.
12. Invalid yoki ownershipsiz test uchun generic 404/403 qaytarish.

### Contract

```json
{
  "source": {
    "type": "user",
    "key": "algebra_1",
    "chunk": null
  }
}
```

Server snapshot:

```json
{
  "testId": "user:jasur:algebra_1",
  "testVersion": 7,
  "itemSetHash": "sha256:...",
  "title": "Algebra 1",
  "questionIds": ["q_01", "q_02"]
}
```

### Tekshiruv

- Own test success.
- Boshqa user testiga direct key bilan access rejection.
- Missing mock/pre rejection.
- Invalid chunk rejection.
- Source test edit qilinganda active session snapshot o‘zgarmasligi.
- Hash determinism testi.

### Tugallanish sharti

- Cast loader global `users` scan qilmaydi.
- Session source mutationdan mustaqil ishlaydi.

---

## G0-04. Stable question va option ID migration

### Natija

Answer array index bilan emas, stable `optionId` bilan yuboriladi va baholanadi.

### Fayllar

```text
utils/helpers.js
services/cast/test-loader.js
services/cast/answer-service.js
services/cast/scoring.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. `normalizeQuestion()`ning Cast uchun yangi versiyasini yaratish.
2. Existing persistent ID bo‘lsa saqlash.
3. ID bo‘lmasa session snapshot yaratishda deterministic ID berish.
4. Duplicate option text bo‘lsa ham har optionga alohida ID berish.
5. Participant `optionIndex` o‘rniga `selectedOptionIds` yuborishi.
6. Single-choice uchun array uzunligini `1` bilan tekshirish.
7. Multiple-select uchun allowed option ID set bilan tekshirish.
8. Unknown option ID’ni rad etish.
9. Host va participant shuffled orderdan qat’i nazar bir xil ID ishlatishi.
10. Legacy index payloadni faqat migration flag bilan vaqtincha qabul qilish.
11. Legacy mappingni session snapshot orderi bilan serverda bajarish.
12. Migration flag o‘chirilgach index payloadga `UNSUPPORTED_PAYLOAD` qaytarish.

### Contract

```json
{
  "commandId": "uuid",
  "sessionId": "cast_...",
  "questionId": "q_01",
  "selectedOptionIds": ["o_b"],
  "attemptNo": 1
}
```

### Tekshiruv

- Shuffled option correctness.
- Duplicate option text.
- Invalid option ID.
- Multiple-select duplicate ID.
- Legacy index migration.
- Host/player different visual order.

### Tugallanish sharti

- New Cast answer contractda `optionIndex` yo‘q.
- Shuffling scoringni o‘zgartirmaydi.

---

## G0-05. Server-authoritative answer time va idempotency

### Natija

Answer va score server vaqti bilan yoziladi; retry duplicate score yaratmaydi.

### Fayllar

```text
services/cast/answer-service.js
services/cast/session-store.js
services/cast/timer-service.js
firebase/admin.js
firebase/local-db.js
socket/cast-handler.js
```

### Bajarish

1. `firebase/admin.js` wrapperga `transaction(path, updater)` qo‘shish.
2. Real Firebase uchun RTDB transaction ishlatish.
3. Local DB uchun process lock ostida read-update-write transaction yaratish.
4. Answer unique pathini `sessionId/questionId/participantId/attemptNo` bilan tuzish.
5. Answer command kelganda server `Date.now()` receipt time olish.
6. Session state va question IDni transaction ichida tekshirish.
7. Strict timerda `receivedAt > closesAt` bo‘lsa rad etish.
8. Soft timerda `late=true` markerini policy bo‘yicha yozish.
9. Birinchi accepted answerni immutable saqlash.
10. Aynan bir `commandId` qaytsa oldingi ACKni qaytarish.
11. Boshqa `commandId` bilan duplicate attempt kelsa `ALREADY_ANSWERED` qaytarish.
12. `allowAnswerChange=true` bo‘lsa revisioned replacement yozish.
13. Score faqat accepted server recorddan hisoblanishi.
14. Client yuborgan `timeMs`ni telemetry sifatida ham default saqlamaslik.
15. ACK yo‘qolsa `cast:getMyAnswerStatus` orqali status qaytarish.

### Contract

Accepted record:

```json
{
  "answerId": "ans_...",
  "commandId": "cmd_...",
  "participantId": "p_...",
  "questionId": "q_01",
  "selectedOptionIds": ["o_b"],
  "receivedAt": 1780000012000,
  "elapsedMs": 12000,
  "late": false,
  "attemptNo": 1,
  "status": "ACCEPTED"
}
```

ACK:

```json
{
  "ok": true,
  "commandId": "cmd_...",
  "answerId": "ans_...",
  "status": "ACCEPTED",
  "serverAt": 1780000012005,
  "revision": 43
}
```

### Tekshiruv

- Same command retry.
- Different-command duplicate.
- Exact close boundary.
- Late strict answer.
- Late soft answer.
- ACK lost after DB save.
- Concurrent two-device submit.
- Local DB transaction race.
- Firebase transaction race.

### Tugallanish sharti

- Bir participant/bir attempt uchun bitta accepted record mavjud.
- Duplicate retry ballni o‘zgartirmaydi.
- Client clock scorega ta’sir qilmaydi.

---

## G0-06. Session-authenticated Socket va role authorization

### Natija

Host Socket Express session orqali teacher accountga bog‘lanadi; participant scoped membership ticket bilan ishlaydi.

### Fayllar

```text
server.js
middleware/auth.js
services/cast/permissions.js
services/cast/session-store.js
socket/cast-handler.js
routes/cast.js
```

### Bajarish

1. Express session middleware’ni alohida `sessionMiddleware` constantga chiqarish.
2. `app.use(sessionMiddleware)` qilish.
3. `io.engine.use(sessionMiddleware)` qilish.
4. Socket connect paytida `socket.request.session.user`ni o‘qish.
5. Authenticated teacher uchun stable actor ID yaratish.
6. Session create’da owner actor ID yozish.
7. Director join paytida owner/co-host role recordini serverdan tekshirish.
8. Participant join muvaffaqiyatidan keyin signed/scoped membership ticket berish.
9. Reconnectda ticket signature, expiry, session va participant IDni tekshirish.
10. `socket.data.role/code`ni authorization source sifatida ishlatmaslik.
11. Har command uchun `permissions.can(actor, action, session)` chaqirish.
12. Projector uchun read-only ticket yaratish.
13. Co-host va moderator invitation redeem flow yaratish.
14. Role ticketlarni revoke qilish.
15. Unauthorized attemptni safe auditga yozish.
16. Socket CORS’ni `*`dan same-origin/approved-origin listga o‘tkazish.

### Contract

```js
const ACTIONS = {
  SESSION_START: 'session:start',
  QUESTION_OPEN: 'question:open',
  QUESTION_CLOSE: 'question:close',
  ANSWER_SUBMIT: 'answer:submit',
  REVEAL: 'question:reveal',
  MODERATE: 'content:moderate',
  SESSION_END: 'session:end'
};
```

Role record:

```json
{
  "actorId": "user:jasur",
  "role": "owner",
  "sessionId": "cast_...",
  "permissionsVersion": 1,
  "revokedAt": null
}
```

### Tekshiruv

- Anonymous host command rejection.
- Other teacher rejection.
- Participant host-command rejection.
- Projector mutation rejection.
- Revoked co-host rejection.
- Expired membership ticket rejection.
- Session cookie Socket handshake test.
- Cross-origin rejection.

### Tugallanish sharti

- Barcha Cast mutationlar server role checkdan o‘tadi.
- URL yoki join code host permission bermaydi.

---

## G0-07. CSRF va API write policy

### Natija

Cast REST mutationlari CSRF token va authenticated session talab qiladi.

### Fayllar

```text
server.js
middleware/error.js
routes/cast.js
public/js/cast-studio.js
public/js/cast-director.js
```

### Bajarish

1. Global `/api/` CSRF bypassni olib tashlash yoki allowlistga qisqartirish.
2. JSON requestda `x-csrf-token` headerni qabul qilish.
3. EJS boot data’da tokenni data attribute yoki safe JSON orqali berish.
4. Cast fetch wrapper yaratish.
5. Har write requestga CSRF header qo‘shish.
6. GET endpointni mutation qilmasligini tekshirish.
7. Session create, invite create/revoke, preset save/delete, media upload/delete va retention actionlarini himoyalash.
8. CSRF error uchun `403 CSRF_INVALID` JSON qaytarish.
9. Token rotate bo‘lsa client boot refresh qilish.

### Contract

```js
await fetch('/api/cast/sessions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': window.__BOOT__.csrfToken
  },
  body: JSON.stringify(payload)
});
```

### Tekshiruv

- Missing token.
- Wrong token.
- Valid token.
- Cross-site form POST.
- JSON POST.
- Token rotation.

### Tugallanish sharti

- Barcha Cast REST write endpointlar CSRF’siz 403 qaytaradi.

---

# C1 — Safe Cast Core

## C1-01. Dependency va script tayyorlash

### Natija

Schema, unit test, e2e va keyingi scale bosqichlari uchun dependency va npm scriptlar tayyorlanadi.

### Fayllar

```text
package.json
package-lock.json
playwright.config.js
```

### Bajarish

C1 uchun:

1. `zod`ni runtime dependency sifatida qo‘shish.
2. Node built-in `node:test` bilan unit test script yaratish.
3. Existing Playwright uchun config yaratish.
4. `test:unit`, `test:integration`, `test:e2e`, `test:cast`, `test` scriptlarini qo‘shish.
5. Runtime media processing C2’da kerak bo‘lsa `sharp`ni devDependency’dan dependency’ga ko‘chirish.
6. Upload C2 uchun `multer` va magic-byte tekshiruvchi package’ni alohida commitda qo‘shish.
7. Redis C5 dependencylarini C1 commitiga qo‘shmaslik.

### Contract

```json
{
  "scripts": {
    "test:unit": "node --test tests/unit/*.test.js",
    "test:integration": "node --test tests/integration/*.test.js",
    "test:e2e": "playwright test",
    "test:cast": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

### Tekshiruv

- Clean `npm ci`.
- `npm run test:unit`.
- `npm run test:e2e`.
- Production start.

### Tugallanish sharti

- Lockfile package bilan mos.
- Test command CI va localda bir xil ishlaydi.

---

## C1-02. Canonical Cast config schema

### Natija

Barcha Cast setup qiymatlari bitta versioned schema orqali parse va validate qilinadi.

### Fayllar

```text
services/cast/config-schema.js
utils/cast-constants.js
tests/unit/cast-config.test.js
```

### Bajarish

1. Enumlarni `utils/cast-constants.js`ga joylash.
2. `CastConfigInputSchema` yaratish.
3. `CastConfigSnapshotSchema` yaratish.
4. Teacher yuborishi mumkin bo‘lmagan system fieldlarni input schemadan chiqarish.
5. Defaultlarni preset resolver orqali qo‘llash.
6. Cross-field validationni `superRefine` bilan yozish.
7. Timer `off` bo‘lsa strict-only close triggerni rad etish.
8. Anonymous identity + public personal leaderboardni rad etish.
9. Team mode’da team countni tekshirish.
10. Speed bonusni institution cap bilan cheklash.
11. `fully_auto` + no valid close trigger combinationini rad etish.
12. Unsupported question type capability bilan config’ni tekshirish.
13. Unknown fieldlarni strip emas, strict rejection qilish.
14. Snapshotga `schemaVersion`, preset version va governance policy ID qo‘shish.
15. Config canonical serialization va hash funksiyasini yaratish.

### Contract

Top-level schema:

```text
schemaVersion
source
preset
pace
playback
timer
scoring
leaderboard
feedback
join
randomization
presentation
teams
responsiveTeaching
moderation
accessibility
participation
localization
dataLifecycle
resilience
postCast
ai
```

Validation error:

```json
{
  "ok": false,
  "error": {
    "code": "CAST_CONFIG_INVALID",
    "fields": [
      {
        "path": "timer.defaultSeconds",
        "code": "OUT_OF_RANGE",
        "message": "Vaqt 5–600 soniya oralig‘ida bo‘lishi kerak."
      }
    ]
  }
}
```

### Tekshiruv

- Har enum valid/invalid test.
- Boundary value test.
- Unknown field test.
- Cross-field matrix test.
- Preset default test.
- Canonical hash determinism.
- Old schema migration fixture.

### Tugallanish sharti

- Session create faqat parsed snapshotni qabul qiladi.
- Query string config source bo‘lmaydi.

---

## C1-03. Preset registry

### Natija

Responsive Accuracy, Classic Live, Team Challenge va Formative Check versioned registry’dan olinadi.

### Fayllar

```text
services/cast/presets.js
services/cast/config-schema.js
tests/unit/cast-presets.test.js
```

### Bajarish

1. Har presetni immutable object sifatida yozish.
2. Har presetga `id`, `version`, `labelKey`, `recommended`, `defaults` berish.
3. Responsive Accuracy’ni default qilish.
4. Preset ustiga teacher override’larini merge qilish.
5. Merge’dan keyin `customized`ni hisoblash.
6. Institution policy locked fieldlarni merge’dan keyin qayta qo‘llash.
7. Preset diff generator yaratish.
8. Deprecated preset version uchun migration map yaratish.
9. Session snapshotga resolved final config yozish.

### Contract

Responsive Accuracy defaults:

```json
{
  "pace": "instructor",
  "playback": {
    "advanceMode": "host_controlled",
    "closeTrigger": "host_or_soft_timeout",
    "thinkSeconds": 5
  },
  "timer": {
    "mode": "soft",
    "defaultSeconds": 30
  },
  "scoring": {
    "mode": "accuracy",
    "correctBase": 1000,
    "speedBonusMax": 0
  },
  "leaderboard": {
    "visibility": "off_during_learning",
    "frequency": "end_only",
    "topN": 5
  }
}
```

### Tekshiruv

- Default preset snapshot.
- Override merge.
- Locked override rejection.
- Customized flag.
- Version migration.
- Diff output.

### Tugallanish sharti

- UI va server bir xil registry versionini ishlatadi.
- Client yuborgan preset object authoritative emas.

---

## C1-04. Cast capability va preflight API

### Natija

Setup ochilganda test imkoniyatlari serverdan safe metadata sifatida olinadi.

### Fayllar

```text
routes/cast.js
services/cast/test-loader.js
services/cast/capabilities.js
services/cast/config-schema.js
```

### Bajarish

1. `POST /api/cast/preflight` endpoint yaratish.
2. Requestda source reference va draft config qabul qilish.
3. Test ownershipni tekshirish.
4. Full private testni serverda load qilish.
5. Question type countlarini hisoblash.
6. Unsupported type va missing-answer blockerlarni yaratish.
7. Long stem, missing explanation, missing alt text va media warninglarini yaratish.
8. Per-question timer recommendationlarini hisoblash.
9. Estimated durationni phase configdan hisoblash.
10. Public response’da answer key, correct index va rubricni bermaslik.
11. Preflight receiptga short expiry va hash berish.
12. Session create’da receipt hash va source hashni qayta tekshirish.

### Contract

Request:

```json
{
  "source": { "type": "user", "key": "algebra_1", "chunk": null },
  "draftConfig": { "presetId": "responsive_accuracy", "overrides": {} }
}
```

Response:

```json
{
  "ok": true,
  "preflightId": "pf_...",
  "expiresAt": 1780000300000,
  "test": {
    "title": "Algebra 1",
    "questionCount": 20,
    "typeCounts": { "single_choice": 18, "true_false": 2 }
  },
  "capabilities": {
    "supportsTeams": true,
    "supportsAnswerShuffle": true,
    "supportsPartialCredit": false
  },
  "blockers": [],
  "warnings": [],
  "estimatedDurationSeconds": 860
}
```

### Tekshiruv

- Answer-key absence snapshot.
- Missing answer blocker.
- Unsupported type blocker.
- Long text warning.
- Ownership rejection.
- Expired preflight.
- Source edit after preflight.

### Tugallanish sharti

- Setup client full questionsni olmaydi.
- Session create expired/stale preflightni qabul qilmaydi.

---

## C1-05. Cast session creation API

### Natija

Validated POST session yaratadi va Director/Lobby URLlarini qaytaradi.

### Fayllar

```text
routes/cast.js
services/cast/session-store.js
services/cast/test-loader.js
services/cast/config-schema.js
services/cast/event-store.js
server.js
```

### Bajarish

1. `POST /api/cast/sessions` endpoint yaratish.
2. `requireAuth` va CSRF qo‘llash.
3. Requestni Zod bilan parse qilish.
4. Preflight receiptni tekshirish.
5. Test snapshotni serverda qayta load qilish.
6. Final config resolve/validate qilish.
7. Cryptographic random `sessionId` yaratish.
8. Ambiguous belgilarsiz join code yaratish.
9. Join code collisionni transaction bilan tekshirish.
10. Owner role recordini yaratish.
11. Private questions va answer keysni private pathga yozish.
12. Public question metadata projectionini alohida yozish.
13. Initial state `LOBBY_OPEN`, revision `1` bilan yozish.
14. `SESSION_CREATED` eventini revision `1` bilan yozish.
15. Projector read ticket yaratish.
16. Response’da Director route, projector route, code va revision qaytarish.
17. Partial write bo‘lsa compensating cleanup qilish.
18. Idempotency key bilan double-click session duplicationini bloklash.

### Contract

Request:

```json
{
  "requestId": "uuid",
  "preflightId": "pf_...",
  "source": { "type": "user", "key": "algebra_1", "chunk": null },
  "presetId": "responsive_accuracy",
  "overrides": {}
}
```

Response:

```json
{
  "ok": true,
  "sessionId": "cast_...",
  "joinCode": "7K4MXQ",
  "revision": 1,
  "directorUrl": "/cast/cast_.../director",
  "projectorUrl": "/cast/cast_.../projector?t=one_time_ticket",
  "joinUrl": "/play?code=7K4MXQ"
}
```

### Tekshiruv

- Double-click idempotency.
- Code collision.
- DB partial failure.
- Stale preflight.
- Invalid config.
- Other-user source.
- Correct initial event/state.

### Tugallanish sharti

- `/host?...time&type&auto` session yaratmaydi.
- Session create javobida secret answer data yo‘q.

---

## C1-06. Session data model va store adapter

### Natija

Cast data access bitta adapter orqali ishlaydi va raw Firebase pathlar handlerlarda ishlatilmaydi.

### Fayllar

```text
services/cast/session-store.js
services/cast/event-store.js
firebase/admin.js
firebase/local-db.js
```

### Bajarish

1. Quyidagi logical collectionlarni yaratish:
   - session meta;
   - config snapshot;
   - authoritative state;
   - public questions;
   - private questions;
   - roles;
   - participants;
   - answers;
   - scores;
   - events;
   - moderation;
   - action pack.
2. `session-store.js`da typed JSDoc bilan methodlar yaratish.
3. Handlerlardan to‘g‘ridan-to‘g‘ri `fb.get/set/update/remove`ni olib tashlash.
4. Revisioned state update uchun transaction method yaratish.
5. Event va state commitini bitta logical operationga birlashtirish.
6. Atomic multi-path update real Firebase’da ishlatish.
7. Local adapter uchun serialized transaction yaratish.
8. Soft-delete/ended metadata qo‘shish.
9. Cleanup’ni immediate hard delete timeridan retention jobga ko‘chirish.
10. Disconnectda participant va answerlarni o‘chirmaslik.

### Contract

Logical paths:

```text
cast_sessions/{sessionId}/meta
cast_sessions/{sessionId}/config
cast_sessions/{sessionId}/state
cast_sessions/{sessionId}/questions_public/{questionId}
cast_sessions/{sessionId}/roles/{actorId}
cast_sessions/{sessionId}/participants/{participantId}
cast_sessions/{sessionId}/scores/{participantId}
cast_sessions/{sessionId}/moderation/{contentId}
cast_sessions/{sessionId}/action_pack

cast_private/{sessionId}/questions/{questionId}
cast_private/{sessionId}/answers/{questionId}/{participantId}/{attemptNo}
cast_private/{sessionId}/events/{revisionKey}
cast_private/{sessionId}/audit/{auditId}

cast_codes/{joinCode}
```

Store interface:

```js
createSession(input)
getSessionMeta(sessionId)
getConfig(sessionId)
getState(sessionId)
commitEvent({ sessionId, expectedRevision, event })
getEventsAfter(sessionId, revision)
getPublicQuestion(sessionId, questionId)
getPrivateQuestion(sessionId, questionId)
putAnswerIfAbsent(input)
getAnswerStatus(input)
upsertParticipant(input)
markPresence(input)
endSession(input)
```

### Tekshiruv

- Store contract unit tests.
- Local/Firebase parity tests.
- Revision conflict test.
- Disconnect persistence test.
- Ended session persistence test.
- Cleanup retention test.

### Tugallanish sharti

- New Cast handler raw path bilmaydi.
- Disconnect participant answerini o‘chirmaydi.

---

## C1-07. Server state machine va event commit

### Natija

Har live action allowed transition va expected revision orqali bajariladi.

### Fayllar

```text
services/cast/state-machine.js
services/cast/event-store.js
services/cast/session-store.js
socket/cast-handler.js
tests/unit/cast-state-machine.test.js
```

### Bajarish

1. Phase enum yaratish.
2. Har phase uchun allowed commandlar mapini yaratish.
3. Har phase uchun allowed next phase mapini yaratish.
4. `applyEvent(state, event)` pure reducer yozish.
5. Reducerda side effect ishlatmaslik.
6. Command service current state va expected revisionni tekshirishi.
7. Valid commanddan domain event yaratish.
8. Event commitdan keyin revisionni `+1` qilish.
9. State snapshotni event bilan bir commitda yangilash.
10. Clientga committed eventni emit qilish.
11. Stale revisionda latest state summary qaytarish.
12. Duplicate command IDda oldingi resultni qaytarish.
13. Invalid phase uchun stable error code qaytarish.
14. Ended sessionda barcha mutationlarni bloklash.
15. Golden event sequence fixture yaratish.

### Contract

State:

```json
{
  "phase": "QUESTION_OPEN",
  "revision": 42,
  "questionPosition": 3,
  "questionId": "q_04",
  "openedAt": 1780000000000,
  "closesAt": 1780000030000,
  "pausedAt": null,
  "totalPausedMs": 0,
  "timerMode": "soft",
  "primaryDirectorId": "user:jasur",
  "endedAt": null
}
```

Error:

```json
{
  "ok": false,
  "commandId": "cmd_...",
  "error": {
    "code": "STALE_REVISION",
    "message": "Sessiya holati yangilangan.",
    "latestRevision": 43
  },
  "snapshot": {}
}
```

### Tekshiruv

- Every allowed transition.
- Every forbidden transition.
- Concurrent commands.
- Duplicate command.
- Ended session mutation.
- Replay reducer determinism.

### Tugallanish sharti

- Host/client interval state o‘zgartirmaydi.
- Har mutation yangi revision yoki deterministic rejection beradi.

---

## C1-08. Server timer service

### Natija

Off, soft va strict timer server timestamp va revision bilan ishlaydi.

### Fayllar

```text
services/cast/timer-service.js
services/cast/state-machine.js
socket/cast-handler.js
public/js/cast-director.js
public/js/cast-participant.js
public/js/cast-projector.js
```

### Bajarish

1. `openQuestion`da `openedAt` va `closesAt`ni serverda hisoblash.
2. Off mode’da `closesAt=null` qilish.
3. Soft mode expiry’da `TIMER_SOFT_EXPIRED` event yaratish.
4. Strict mode expiry’da `QUESTION_LOCKED` event yaratish.
5. Timer callbackda expected question ID va revisionni tekshirish.
6. Stale timer callbackni no-op qilish.
7. Pause’da `pausedAt` yozish va scheduled timer’ni cancel qilish.
8. Resume’da pause durationni `closesAt`ga qo‘shish.
9. Add-time’da current `closesAt`ga seconds qo‘shish.
10. Extension count va limitni tekshirish.
11. Timer registry’ni process-local optimization sifatida ishlatish.
12. Server restartdan keyin state timestampdan timerlarni rehydrate qilish.
13. Clientga server time sync event yuborish.
14. Clientda `estimatedServerNow = Date.now() + offset` ishlatish.
15. Timer display intervalini presentation-only qilish.
16. Background tab foreground bo‘lganda remainingni timestampdan qayta hisoblash.
17. Exact boundary acceptance rule’ni bitta constant bilan belgilash.

### Contract

```text
remainingMs = closesAt - estimatedServerNow
```

Pause event:

```json
{
  "type": "QUESTION_PAUSED",
  "payload": {
    "pausedAt": 1780000010000,
    "remainingMs": 20000
  }
}
```

Resume event:

```json
{
  "type": "QUESTION_RESUMED",
  "payload": {
    "resumedAt": 1780000015000,
    "closesAt": 1780000035000,
    "totalPausedMs": 5000
  }
}
```

### Tekshiruv

- Off/soft/strict.
- Pause/resume.
- Multiple add-time.
- Add-time at expiry boundary.
- Old timer callback after next question.
- Server restart rehydrate.
- Browser background throttling.
- Clock offset update.

### Tugallanish sharti

- Server expiry authority hisoblanadi.
- Client interval to‘xtasa session state buzilmaydi.

---

## C1-09. Versioned scoring service

### Natija

Accuracy, Balanced, Speed, No Points, Participation va team score serverda versioned pure function orqali hisoblanadi.

### Fayllar

```text
services/cast/scoring.js
services/cast/leaderboard.js
utils/helpers.js
tests/unit/cast-scoring.test.js
```

### Bajarish

1. Legacy `calculatePoints()`ni new Cast pathdan chiqarish.
2. `calculateQuestionScore(input)` pure function yaratish.
3. Correctnessni stable option IDs bilan hisoblash.
4. Accuracy mode: correct `1000`, wrong `0`.
5. Balanced mode: base `800`, speed max `200`, alpha `1.5`.
6. Speed mode: base `600`, speed max `400`, alpha `1.25`.
7. No Points mode: `0`, raw correctness saqlanadi.
8. Participation mode: accepted response uchun configured fixed point.
9. Remaining ratio’ni `0..1` clamp qilish.
10. Soft-late answer speed bonusini `0` qilish.
11. Strict-late answerni scorega kiritmaslik.
12. Partial-credit fractionni question-type scorer’dan olish.
13. Multiplierni final bosqichda qo‘llash.
14. Integer roundingni bitta qoidaga birlashtirish.
15. Score breakdownni private recordda saqlash.
16. Raw correctnessni total pointsdan alohida saqlash.
17. Session configdagi scoring versionni scorer registry’ga resolve qilish.
18. Unknown scoring versionda session startni bloklash.
19. Re-score faqat authorized maintenance command bilan ishlashi.
20. Re-score old/new diff va audit yozishi.

### Contract

```js
remainingRatio = clamp(1 - elapsedMs / limitMs, 0, 1)
speedComponent = speedBonusMax * Math.pow(remainingRatio, alpha)
score = round((correctBase * creditFraction + speedComponent) * multiplier)
```

Score breakdown:

```json
{
  "scoringVersion": "score_v2",
  "mode": "balanced",
  "isCorrect": true,
  "creditFraction": 1,
  "base": 800,
  "speed": 136,
  "multiplier": 1,
  "total": 936
}
```

### Tekshiruv

- Correct/wrong.
- Elapsed `0`.
- Exact limit.
- Over limit.
- Soft late.
- Strict late.
- Partial credit.
- Multiplier.
- Deterministic rounding.
- Version fixture.
- Client time tampering.

### Tugallanish sharti

- Same server input har safar same score beradi.
- Score breakdown formula bilan mos.

---

## C1-10. Deterministic randomization

### Natija

Question va option order stable seed va stable IDs bilan qayta tiklanadi.

### Fayllar

```text
services/cast/randomization.js
services/cast/projections.js
public/js/cast-director.js
public/js/cast-participant.js
tests/unit/cast-randomization.test.js
```

### Bajarish

1. Server-side seeded PRNG implementatsiya yoki audited small implementation tanlash.
2. `seedVersion` registry yaratish.
3. Session random seedni cryptographic random bytesdan yaratish.
4. Question shuffle orderni session startda hisoblab snapshotga yozish.
5. Answer orderni policy bo‘yicha session/question/participant seed bilan hisoblash.
6. Host va participant projectionda option ID va shape mappingni saqlash.
7. Correctnessni orderdan mustaqil qilish.
8. Fixed-order question type’larda shuffle’ni bloklash.
9. Replay uchun computed order yoki seed/versionni saqlash.
10. Legacy host/player alohida shuffle funksiyalarini olib tashlash.

### Contract

```text
questionSeed = hash(seedVersion, sessionSeed, questionId)
participantSeed = hash(seedVersion, sessionSeed, questionId, participantId)
```

Projection option:

```json
{
  "id": "o_b",
  "text": "42",
  "displayPosition": 0,
  "symbol": "triangle",
  "colorToken": "option-1"
}
```

### Tekshiruv

- Same seed same order.
- Different participant policy.
- Host semantic mapping.
- Replay order.
- Correctness after shuffle.
- Fixed-order blocker.

### Tugallanish sharti

- Array index scoringda ishlatilmaydi.
- Host va student semantic optionni bir xil ko‘radi.

---

## C1-11. Command/event envelope va ACK

### Natija

Barcha Cast Socket commandlari idempotent envelope va structured ACK ishlatadi.

### Fayllar

```text
socket/cast-handler.js
services/cast/command-service.js
services/cast/event-store.js
public/js/cast-socket-client.js
```

### Bajarish

1. Shared client `sendCommand(type, payload)` wrapper yaratish.
2. `crypto.randomUUID()` bilan command ID yaratish.
3. Client known revisionni envelopega qo‘shish.
4. Socket.IO acknowledgement callback ishlatish.
5. ACK timeoutni 3–5 soniya oralig‘ida config qilish.
6. Timeoutda bir xil command ID bilan retry qilish.
7. Server processed-command result cache/store yaratish.
8. Command ID/session/actor mismatchni rad etish.
9. Server event envelopega event ID, revision va server time qo‘shish.
10. Client event dedupe setini bounded LRU bilan saqlash.
11. Revision gap aniqlansa snapshot recovery chaqirish.
12. Old revision eventni ignore qilish.
13. Future gap eventni buffer qilmasdan snapshot bilan reconcile qilish.

### Contract

Command:

```json
{
  "commandId": "uuid",
  "sessionId": "cast_...",
  "actorId": "user:jasur",
  "expectedRevision": 42,
  "type": "cast:addTime",
  "payload": { "seconds": 15 },
  "sentAtClient": 1780000000000
}
```

ACK:

```json
{
  "ok": true,
  "commandId": "uuid",
  "newRevision": 43,
  "serverAt": 1780000000100
}
```

Event:

```json
{
  "eventId": "evt_...",
  "sessionId": "cast_...",
  "revision": 43,
  "type": "cast:timeAdded",
  "serverAt": 1780000000100,
  "payload": { "seconds": 15, "closesAt": 1780000045000 }
}
```

### Tekshiruv

- Lost ACK retry.
- Duplicate command.
- Stale revision.
- Revision gap.
- Old event.
- Reordered network callbacks.
- Actor mismatch.

### Tugallanish sharti

- Bir command bir marta mutation qiladi.
- Client status ACK bilan boshqariladi.

---

# C2 — Professional Cast UX

## C2-01. Paneldagi Cast Setup Studio

### Natija

`Cast` bosilganda query-param modal o‘rniga accessible, validated Setup Studio ochiladi.

### Fayllar

Yangi:

```text
views/partials/cast-studio.ejs
public/css/cast-studio.css
public/js/cast-studio.js
public/js/cast-api.js
```

O‘zgartiriladi:

```text
views/user/panel.ejs
views/partials/head.ejs
public/css/style.css
```

### Bajarish

1. `panel.ejs`dagi inline Cast modal HTML/CSS/JSni olib tashlash.
2. Cast tugmalarida escaped test name uzatishni to‘xtatish.
3. Tugmaga `data-source`, `data-key`, `data-chunk` yozish.
4. Event delegation bilan `CastStudio.open(reference)` chaqirish.
5. Studio ochilganda source reference’dan preflight fetch qilish.
6. Loading skeleton ko‘rsatish.
7. Error bo‘lsa retry va close action ko‘rsatish.
8. Mode cardlar yuklangach Responsive Accuracy’ni tanlash.
9. Essential fieldlarni birinchi qatlamda ko‘rsatish.
10. Advanced fieldlarni collapsible drawerga joylash.
11. Har change’da local draft config update qilish.
12. Debounced server preflight qayta chaqirish.
13. Estimated duration va warninglarni yangilash.
14. Blocker bo‘lsa `Lobby ochish`ni disable qilish.
15. Submitda `POST /api/cast/sessions` yuborish.
16. Submit tugmasini request tugaguncha disable qilish.
17. Successda Director URLga `location.assign()` qilish.
18. Double-click uchun bir xil `requestId` ishlatish.
19. Modal close’da abort controller bilan pending fetchni cancel qilish.
20. Reopen’da draftni test reference bo‘yicha sessionStorage’dan optional tiklash.

### UI tuzilmasi

```text
Dialog header
  Test title
  Question count
  Close
Mode cards
Essentials
  Pace
  Think time
  Timer
  Scoring
  Leaderboard
  Join
Advanced drawer
  Flow
  Feedback
  Randomization
  Team
  Theme/audio
  Accessibility
  Responsive teaching
Preflight panel
  Blockers
  Warnings
  Duration
Footer
  Cancel
  Lobby ochish
```

### Accessibility

1. `role="dialog"`, `aria-modal="true"`.
2. Title bilan `aria-labelledby`.
3. Description bilan `aria-describedby`.
4. Focus trap.
5. Open paytida first mode card yoki dialog title focus.
6. Close paytida oldingi Cast button focus restore.
7. Escape dirty bo‘lmasa close.
8. Dirty bo‘lsa confirmation view.
9. Mode cardlarni radio group qilish.
10. Error summaryga focus berish.
11. Hidden advanced control tab orderga kirmasligi.
12. Minimum touch target 44px.

### Tekshiruv

- User/mock/pre reference.
- Focus trap va restore.
- Keyboard-only mode selection.
- Dirty Escape.
- Slow preflight.
- Failed preflight.
- Double submit.
- Mobile viewport.
- Screen-reader label.
- No query config in Director URL.

### Tugallanish sharti

- `TIME_OPTS`, `TYPE_OPTS`, `selectedCastType` va `cast-auto-check` legacy kodi olib tashlangan.
- Session faqat validated POSTdan yaratiladi.

---

## C2-02. Mode card va progressive disclosure

### Natija

Teacher pedagogik presetni card orqali tanlaydi; alohida settinglar mustaqil field bo‘lib qoladi.

### Fayllar

```text
public/js/cast-studio.js
public/css/cast-studio.css
services/cast/presets.js
```

### Bajarish

1. To‘rtta primary mode card yaratish.
2. Cardga icon, label, short summary, recommended badge berish.
3. Card selectionni `presetId`ga map qilish.
4. Selectionda preset defaultsni draftga qo‘llash.
5. Teacher settingni o‘zgartirsa `customized=true` qilish.
6. `Reset` action bilan preset defaultsni qaytarish.
7. Governance lock bo‘lgan fieldda lock icon va policy label ko‘rsatish.
8. Disabled mode’da capability cheklovini inline ko‘rsatish.
9. Self-Paced Race tayyor bo‘lmaguncha feature flag ortida saqlash.
10. `More modes` P2 sectionini production flag off holatida yashirish.

### Cardlar

```text
Responsive Accuracy — default/recommended
Classic Live
Team Challenge
Formative Check
```

### Tekshiruv

- Har card defaults.
- Customized badge.
- Reset.
- Disabled card keyboard behavior.
- Locked field behavior.
- Feature flag.

### Tugallanish sharti

- `mode`, `pace`, `flow`, `timer`, `scoring` bitta `type` fieldga birlashtirilmaydi.

---

## C2-03. Setup fieldlari va validation UX

### Natija

Har setting typed control, inline error va dependency state bilan ishlaydi.

### Fayllar

```text
public/js/cast-studio.js
public/css/cast-studio.css
services/cast/config-schema.js
```

### Bajarish

1. Pace uchun segmented radio yaratish.
2. Flow uchun `host_controlled`, `semi_auto`, `fully_auto` radio yaratish.
3. Timer uchun `off`, `soft`, `strict` radio yaratish.
4. Quick time chiplar: 10, 15, 20, 30, 45, 60, 90.
5. Custom time numeric input: 5–600.
6. Think time numeric/chip: 0, 3, 5, 10, custom 0–30.
7. Scoring mode select/card yaratish.
8. Leaderboard visibility va frequency’ni alohida boshqarish.
9. Join identity, late join, max playersni alohida boshqarish.
10. Feedback policy fieldlarini alohida boshqarish.
11. Randomization togglelarini alohida boshqarish.
12. Theme/background/audio/motion fieldlarini alohida boshqarish.
13. Per-question override editor yaratish.
14. Server field error pathini matching controlga map qilish.
15. Error controlni `aria-invalid=true` qilish.
16. Error textni `aria-describedby` bilan bog‘lash.
17. Warningni dismiss emas, resolve yoki explicit override bilan boshqarish.
18. High-risk warning override’iga confirmation checkbox qo‘shish.
19. Blocker va warningni visual va semantic jihatdan ajratish.
20. Launch button valid state’ni har draft update’da qayta hisoblash.

### Dependency qoidalari

```text
Timer off + fully auto       → blocker
Anonymous + personal public  → blocker
Team enabled + teamCount < 2 → blocker
No points + speed bonus > 0  → auto reset/error
Hybrid + speed mode          → warning yoki institution blocker
Music + reading-heavy items  → warning
Public full leaderboard      → warning/institution blocker
Strict timer + long response → warning
```

### Tekshiruv

- Har field boundary.
- Every dependency pair.
- Error focus.
- Server/client error consistency.
- Screen reader.
- Mobile keyboard numeric input.

### Tugallanish sharti

- Invalid combination UI va serverda bir xil rad etiladi.

---

## C2-04. Estimated duration

### Natija

Setup Studio sessionning taxminiy davomiyligini config va test metadata’dan hisoblaydi.

### Fayllar

```text
services/cast/duration-estimator.js
routes/cast.js
public/js/cast-studio.js
tests/unit/cast-duration.test.js
```

### Bajarish

1. Server-side pure estimator yaratish.
2. Har question uchun think + answer + reveal vaqtini yig‘ish.
3. Leaderboard frequency bo‘yicha block vaqtini qo‘shish.
4. Team talk va discussion planned blocklarini qo‘shish.
5. Off timerli host-controlled phase uchun range qaytarish.
6. Per-question override’ni hisobga olish.
7. Quick Prompt kabi ad-hoc blockni estimate’dan alohida belgilash.
8. UI’da exact emas, range ko‘rsatish.
9. Config o‘zgarganda debounced preflight response bilan update qilish.

### Contract

```json
{
  "minimumSeconds": 720,
  "expectedSeconds": 860,
  "maximumSeconds": 1100,
  "label": "Taxminan 14–18 daqiqa"
}
```

### Tekshiruv

- No timer.
- Every question leaderboard.
- Every N leaderboard.
- Per-question override.
- Team talk.
- Zero questions.

### Tugallanish sharti

- UI local formula bilan server formulasi ajralib ketmaydi.

---

## C2-05. Director, Projector va Participant route’lari

### Natija

Uchta alohida view va permission boundary yaratiladi.

### Fayllar

Yangi:

```text
views/cast/director.ejs
views/cast/projector.ejs
views/cast/participant.ejs
public/css/cast-director.css
public/css/cast-projector.css
public/css/cast-participant.css
public/js/cast-director.js
public/js/cast-projector.js
public/js/cast-participant.js
public/js/cast-socket-client.js
```

O‘zgartiriladi:

```text
routes/cast.js
routes/game.js
views/game/host.ejs
views/game/enter.ejs
```

### Bajarish

1. `GET /cast/:sessionId/director` route yaratish.
2. Route’da authenticated owner/co-host role tekshirish.
3. `GET /cast/:sessionId/projector` route yaratish.
4. Projector one-time ticketni redeem qilib HttpOnly yoki in-memory scoped sessionga aylantirish.
5. `GET /play`ni participant boot shellga yo‘naltirish.
6. Participant join code’dan session IDni server orqali resolve qilish.
7. EJSga minimal boot data berish.
8. Full session/questionsni EJSga serialize qilmaslik.
9. Har view o‘z CSS va JS entrypointini yuklashi.
10. Legacy `/host` route’ni panelga redirect yoki compatibility page qilish.
11. Existing active legacy sessionlar uchun temporary fallback saqlash.
12. New sessionlarni faqat new Director view’da ochish.

### Boot contract

```json
{
  "sessionId": "cast_...",
  "actor": { "id": "user:jasur", "role": "owner" },
  "csrfToken": "...",
  "locale": "uz-Latn",
  "socketPath": "/socket.io",
  "initialRevision": 1
}
```

Projector bootda teacher identity, private roster va answer key bo‘lmaydi.

### Tekshiruv

- Owner Director access.
- Other user rejection.
- Projector ticket redeem.
- Reused ticket rejection.
- Projector host command rejection.
- EJS source secret scan.
- Legacy route behavior.

### Tugallanish sharti

- Director va Projector bir xil DOM/view emas.
- Participant view private state olmaydi.

---

## C2-06. Lobby va join-code flow

### Natija

Code, QR, link, roster, late join va lobby lock server policy bilan ishlaydi.

### Fayllar

```text
services/cast/join-service.js
services/cast/nickname.js
routes/cast.js
socket/cast-handler.js
public/js/cast-director.js
public/js/cast-projector.js
public/js/cast-participant.js
```

### Bajarish

1. Join code alphabetdan `0/O/1/I/L`ni chiqarish.
2. Join code’ni uppercase canonical qilish.
3. Inputda whitespace va hyphenni normalize qilish.
4. `player:checkCode` + `player:checkName` two-step race’ni bitta atomic join commandga almashtirish.
5. Join transactionda code status, lobby lock, capacity va identityni tekshirish.
6. Participant IDni serverda yaratish.
7. Display aliasni normalized va sanitized qilish.
8. Duplicate aliasga automatic numbered suggestion qaytarish.
9. Safe nickname generator yaratish.
10. Reserved role name va confusable/invisible characterlarni bloklash.
11. Successful join’da membership ticket qaytarish.
12. Browser sessionStorage’da ticketni saqlash.
13. Full page refreshda rejoin command yuborish.
14. Disconnectda participant recordni o‘chirmasdan `presence=offline` qilish.
15. Late join policy `off`, `next_question`, `until_question`ni ishlatish.
16. Lock-on-start eventini state machine orqali commit qilish.
17. Host lock/unlock command yaratish.
18. Remove va blockni alohida command qilish.
19. Kick qilingan participant ticketini revoke qilish.
20. Join rate limitni IP + code + normalized alias bo‘yicha qatlamlash.
21. QRga join URL qo‘yish.
22. QR yonida short URL va code text berish.
23. QR fail bo‘lsa manual code flow saqlash.

### Contract

Join command:

```json
{
  "commandId": "uuid",
  "type": "cast:join",
  "payload": {
    "joinCode": "7K4MXQ",
    "displayName": "Jasur",
    "avatarId": "dark-wolf"
  }
}
```

Join ACK:

```json
{
  "ok": true,
  "sessionId": "cast_...",
  "participantId": "p_...",
  "displayAlias": "Jasur",
  "membershipTicket": "signed...",
  "joinMode": "lobby",
  "revision": 4
}
```

### Tekshiruv

- Simultaneous same alias.
- Full lobby.
- Locked lobby.
- Late join.
- Rejoin.
- Kicked rejoin.
- Code brute force.
- Shared NAT.
- Unicode name.
- QR/manual parity.

### Tugallanish sharti

- Duplicate-name precheck race yo‘q.
- Disconnect answerlarni o‘chirmaydi.

---

## C2-07. Participant answer interaction

### Natija

Participant state, select, submit, ACK, offline va recovery holatlari aniq boshqariladi.

### Fayllar

```text
public/js/cast-participant.js
public/css/cast-participant.css
views/cast/participant.ejs
```

### Bajarish

1. Client state enum yaratish:
   - `WAITING`;
   - `THINKING`;
   - `OPEN`;
   - `SELECTED`;
   - `SENDING`;
   - `SAVED`;
   - `RETRYING`;
   - `LOCKED`;
   - `PAUSED`;
   - `REVEAL`;
   - `ENDED`.
2. State reducer orqali DOM render qilish.
3. Think phase’da answer buttonlarni disable qilish.
4. Single-choice defaultni select-then-submit qilish.
5. Preset policy bilan one-tap submitni yoqish.
6. Multiple-selectda explicit submit ishlatish.
7. Submit bosilganda buttonlarni lock qilish.
8. Pending commandni memory va sessionStorage’da saqlash.
9. ACK kelganda `SAVED`ga o‘tish.
10. Timeoutda ayni command ID bilan retry qilish.
11. Reconnectda answer statusni so‘rash.
12. Server accepted bo‘lsa local pendingni clear qilish.
13. Server question closed desa late message ko‘rsatish.
14. Userga raw score pre-reveal ko‘rsatmaslik.
15. Correctnessni faqat reveal policy bilan ko‘rsatish.
16. Duplicate event/SFXni revision bilan dedupe qilish.
17. Minimum 44–48px touch target qo‘llash.
18. Keyboard 1–9 shortcutni optional qilish va screen-reader bilan to‘qnashmasligini tekshirish.
19. Status message uchun polite/assertive live regionlarni ajratish.

### Microcopy state map

```text
SELECTED  → Javob tanlandi.
SENDING   → Yuborilmoqda…
SAVED     → Javob saqlandi.
RETRYING  → Ulanish tiklanmoqda. Javobingiz saqlanadi.
LOCKED    → Savol yopildi; javob qabul qilinmadi.
PAUSED    → O‘qituvchi sessiyani pauza qildi.
TIME_ADD  → 15 soniya qo‘shildi.
```

### Tekshiruv

- Tap/keyboard.
- One-tap/select-submit.
- Double click.
- Offline before submit.
- ACK loss.
- Reconnect after save.
- Question closes during sending.
- Duplicate events.
- Screen reader.
- 320px viewport.

### Tugallanish sharti

- UI `Javob saqlandi`ni faqat server ACK yoki answer-status confirmationdan keyin ko‘rsatadi.

---

## C2-08. Director control panel

### Natija

Host barcha primary live commandlarni private Director View’dan boshqaradi.

### Fayllar

```text
views/cast/director.ejs
public/js/cast-director.js
public/css/cast-director.css
socket/cast-handler.js
services/cast/permissions.js
```

### Bajarish

1. Director layoutni uch qismga bo‘lish:
   - current content;
   - live evidence;
   - control rail.
2. Primary control railga Start, Pause, Resume, Add Time, Close, Reveal, Next, End joylash.
3. Contextga mos kelmagan actionlarni hide emas, disabled + reason qilish.
4. Har control `sendCommand()` wrapperdan foydalanishi.
5. Pending commandda control spinner va duplicate click lock qo‘shish.
6. Stale revisionda snapshotni apply qilib userga notification berish.
7. Add Time uchun +5/+10/+15/+30 va custom menu qilish.
8. Close Answers va Reveal’ni alohida action qilish.
9. Distribution show/hide’ni alohida action qilish.
10. Leaderboard show/hide’ni alohida action qilish.
11. Skip Invalid Question uchun confirmation va audit reason olish.
12. End Session uchun step-up/recent-auth va two-step confirmation qilish.
13. Keyboard shortcut registry yaratish.
14. Input focused paytida shortcutni disable qilish.
15. Remote-sized compact layout yaratish.
16. Live indicatorlarni 4–10Hz aggregate event bilan update qilish.
17. Long roster uchun virtual list yoki paged rendering ishlatish.
18. Network healthni simple statusga map qilish.
19. Projector connection statusni ko‘rsatish.
20. Co-host primary statusni ko‘rsatish.

### Control-state misollari

```text
LOBBY_OPEN     → Start enabled
THINK_TIME     → Pause, Skip enabled
QUESTION_OPEN  → Pause, Add Time, Close enabled
QUESTION_LOCKED→ Reveal, Discuss, Reteach, Next enabled
REVEAL         → Transfer, Leaderboard, Next enabled
ENDED          → all mutation disabled
```

### Tekshiruv

- Every phase control matrix.
- Double command.
- Stale revision.
- Keyboard shortcuts.
- End confirmation.
- Co-host permission difference.
- Network disconnect/recovery.

### Tugallanish sharti

- Host timer expiryga bog‘lanib qolmaydi.
- Pause, add time, close, reveal, distribution va leaderboard mustaqil ishlaydi.

---

## C2-09. Projector View

### Natija

Public screen private data olmasdan lobby, question, distribution, explanation va leaderboardni ko‘rsatadi.

### Fayllar

```text
views/cast/projector.ejs
public/js/cast-projector.js
public/css/cast-projector.css
services/cast/projections.js
```

### Bajarish

1. Projector state reducer yaratish.
2. Lobby view’da QR, code, short link va policy bo‘yicha participant count ko‘rsatish.
3. Full roster default ko‘rsatmaslik.
4. Question view’da stem, media, option, timer va answer count ko‘rsatish.
5. Answer optionni rang + symbol + text bilan ko‘rsatish.
6. Teacher-private distributionni public event kelmaguncha ko‘rsatmaslik.
7. Reveal eventda correct optionni accessible state bilan belgilash.
8. Explanation va worked example uchun alohida layout qilish.
9. Leaderboardda faqat policy ruxsat bergan Top N/team data ko‘rsatish.
10. Low rank va private scorelarni payloadga kiritmaslik.
11. Public open textni faqat `APPROVED`/`REDACTED` state’da ko‘rsatish.
12. Withdraw event kelganda contentni darhol olib tashlash.
13. Revision gapda snapshot request qilish.
14. Refreshdan keyin current public snapshotni tiklash.
15. Media load fail bo‘lsa text fallback va host indicator ko‘rsatish.
16. 4:3, 16:9, 720p, 1080p va overscan CSS testlarini yozish.
17. Typography tokenlarini qo‘llash.

### Typography

```css
--cast-question-size: clamp(28px, 3.2vw, 64px);
--cast-option-size: clamp(22px, 2vw, 40px);
--cast-meta-size: clamp(20px, 1.7vw, 32px);
--cast-code-size: clamp(48px, 8vw, 120px);
```

### Tekshiruv

- Projector payload secret scan.
- Refresh recovery.
- Long stem.
- Five options.
- Math.
- Image failure.
- Top-N privacy.
- Withdraw content.
- Bright projector contrast.

### Tugallanish sharti

- Projector DOM va payload’da private roster, answer key va full low rank yo‘q.

---

## C2-10. Co-host, moderator va remote control

### Natija

Scoped invitation, primary Director lease, takeover va conflict handling ishlaydi.

### Fayllar

```text
routes/cast.js
services/cast/permissions.js
services/cast/role-service.js
services/cast/lease-service.js
socket/cast-handler.js
public/js/cast-director.js
```

### Bajarish

1. Role enum: owner, co_host, moderator, projector_only, analyst_readonly.
2. Permission matrixni serverda immutable registry qilish.
3. `POST /api/cast/sessions/:id/invites` endpoint yaratish.
4. Invitationga role, expiry, inviter, one-time nonce yozish.
5. Redeem endpointda authenticated accountga role record yaratish.
6. Redeemdan keyin invitation nonce’ni invalidate qilish.
7. Revoke endpoint yaratish.
8. `primaryDirectorId`, `leaseEpoch`, `leaseExpiresAt` state fieldlarini qo‘shish.
9. Primary Director heartbeat command yaratish.
10. Owner handoff command va co-host accept command yaratish.
11. Owner disconnectda grace period ishga tushirish.
12. Eligible co-host takeover command yaratish.
13. Lease epoch/fencing tokenni har control commandga qo‘shish.
14. Old epoch commandini `CONTROL_FENCED` bilan rad etish.
15. Eligible controller bo‘lmasa safe-pause qilish.
16. Owner reclaim uchun recent-auth/step-up talab qilish.
17. Moderatorga content approve/hide/kick, lekin question progression bermaslik.
18. Analystga read-only aggregate berish.
19. Projector-only role’ga command channel bermaslik.
20. Ownership va role actionlarini audit qilish.

### Contract

Invite:

```json
{
  "role": "co_host",
  "expiresInSeconds": 900
}
```

Lease:

```json
{
  "primaryDirectorId": "user:jasur",
  "leaseEpoch": 7,
  "leaseExpiresAt": 1780000015000
}
```

Command qo‘shimchasi:

```json
{
  "controlLeaseEpoch": 7
}
```

### Tekshiruv

- One-time redeem.
- Reused invite.
- Revoked role.
- Simultaneous takeover.
- Owner reclaim.
- Network partition split brain.
- Stale epoch command.
- Moderator scope.
- Projector mutation.

### Tugallanish sharti

- Bir paytda faqat current lease epoch commandlari authoritative bo‘ladi.

---

## C2-11. Leaderboard service va privacy

### Natija

Leaderboard visibility, frequency, ties va public/private projection config orqali boshqariladi.

### Fayllar

```text
services/cast/leaderboard.js
services/cast/projections.js
public/js/cast-director.js
public/js/cast-projector.js
public/js/cast-participant.js
```

### Bajarish

1. Score recorddan deterministic ranking function yozish.
2. Tie policy’ni config’dan olish.
3. Same score uchun same rank berish.
4. Stable display orderni participant ID hash yoki previous order bilan saqlash.
5. `off`, `personal_only`, `top_n`, `relative_neighbors`, `team_only`, `full_private_host` projectionlari yaratish.
6. Public Top N boundary tie policy’ni implement qilish.
7. Low ranksni public payloaddan chiqarish.
8. Exact score hide bo‘lsa rounded/relative display qilish.
9. Frequency scheduler’ni state choreography bilan bog‘lash.
10. `manual`, `never`, `end_only`, `every_question`, `every_n`, `milestones`ni implement qilish.
11. Late join va disconnected participant policy’ni config bilan boshqarish.
12. Host private full leaderboardni alohida event/channel orqali yuborish.
13. Participantga faqat o‘z personal rankini scoped payloadda berish.
14. Zero va one-player state’larni alohida render qilish.
15. Final leaderboard snapshotni immutable saqlash.

### Contract

Public Top N:

```json
{
  "mode": "top_n",
  "entries": [
    { "displayAlias": "Bilimdon Tulki", "rank": 1, "scoreDisplay": "1 920" }
  ],
  "hiddenCount": 24,
  "revision": 56
}
```

Personal:

```json
{
  "participantId": "p_...",
  "rank": 8,
  "neighbors": [7, 8, 9],
  "score": 1620
}
```

### Tekshiruv

- Ties.
- Top-N boundary.
- Low-rank payload absence.
- Personal scope.
- Team-only.
- Frequency.
- Zero/one player.
- Late join.

### Tugallanish sharti

- Full private leaderboard public Socket roomga emit qilinmaydi.

---

## C2-12. Theme, background, audio va motion

### Natija

Approved theme registry, accessible background, audio unlock va per-user motion/mute ishlaydi.

### Fayllar

```text
services/cast/theme-registry.js
services/cast/media-service.js
routes/cast.js
public/css/cast-tokens.css
public/js/cast-audio.js
public/js/cast-studio.js
public/js/cast-projector.js
```

### Bajarish

1. Theme token schema yaratish.
2. Focus Dark, Focus Light, High Contrast Dark va High Contrast Light theme’larini qo‘shish.
3. Existing `BG_STYLES` arrayni versioned theme registry bilan almashtirish.
4. Theme preview thumbnail yaratish.
5. Contrast preflight function yaratish.
6. Background fail bo‘lsa Focus Dark fallback qilish.
7. Question/option uchun opaque yoki scrim surface majburiy qilish.
8. Teacher background uploadini feature flag ortiga qo‘yish.
9. Upload uchun size/dimension/MIME validation qilish.
10. EXIF/GPS metadata’ni strip qilish.
11. SVGni sanitize yoki rasterize qilish.
12. Remote URL importni default off qilish.
13. Asset owner, license, hash va retention metadata yozish.
14. Audio pack registry yaratish.
15. Lobby music default off/optional qilish.
16. Question music default off qilish.
17. SFX low default qilish.
18. First user gesture’da Web Audio unlock qilish.
19. Host/projector volume’ni alohida boshqarish.
20. Participant mute preference’ni local saqlash.
21. Event ID bilan SFX dedupe qilish.
22. OS `prefers-reduced-motion`ni defaultga apply qilish.
23. User `reduced` yoki `none` tanlovini ustun qilish.
24. Confetti va decorative motionni no-motion’da o‘chirish.
25. Audio instruction uchun text/visual equivalent berish.

### Contract

Theme:

```json
{
  "id": "focus_dark",
  "version": 1,
  "tokens": {
    "pageBg": "#07111f",
    "surface": "#102033",
    "text": "#ffffff",
    "mutedText": "#c5d2e0",
    "focus": "#ffd60a"
  },
  "motionVariant": "reduced"
}
```

### Tekshiruv

- Theme token validation.
- Contrast.
- Background failure.
- Autoplay blocked.
- Mute persistence.
- Reconnect SFX duplicate.
- Reduced/no motion.
- Malicious SVG.
- EXIF removal.

### Tugallanish sharti

- `bg: 0` hardcode yo‘q.
- Theme/audio/motion configdan va personal accessibility preferencedan keladi.

---

# C3 — Responsive Teaching Engine

## C3-01. Teacher-private evidence panel

### Natija

Question lockdan keyin teacher answer coverage, accuracy, distractor va technical statusni private ko‘radi.

### Fayllar

```text
services/cast/evidence-service.js
services/cast/projections.js
public/js/cast-director.js
public/css/cast-director.css
```

### Bajarish

1. Answer statuslarni alohida hisoblash:
   - accepted;
   - wrong;
   - no_response;
   - not_shown;
   - late_join;
   - disconnected;
   - technical_failure;
   - abstain.
2. Numerator va denominatorni response’da birga qaytarish.
3. Accuracy’ni accepted scorable responsesdan hisoblash.
4. Active va eligible denominatorni alohida qaytarish.
5. Distractor count va percentni option ID bo‘yicha hisoblash.
6. Confidence coverage’ni alohida hisoblash.
7. Response time’ni descriptive aggregate sifatida qaytarish.
8. Tiny countlarda individual identityni aggregate paneldan chiqarmaslik.
9. Teacher named drill-downni alohida permission bilan berish.
10. First-vote va revote evidence’ni alohida snapshot qilish.
11. Public projector event yaratmaslik.
12. Evidence eventni Director private roomga yuborish.

### Contract

```json
{
  "questionId": "q_04",
  "eligible": 30,
  "active": 28,
  "accepted": 24,
  "correct": 19,
  "incorrect": 5,
  "noResponse": 3,
  "lateJoin": 1,
  "technicalFailure": 2,
  "accuracyPercent": 79,
  "distribution": [
    { "optionId": "o_a", "count": 4 },
    { "optionId": "o_b", "count": 19 },
    { "optionId": "o_c", "count": 1 }
  ],
  "confidenceCoverage": 18,
  "revision": 48
}
```

### Tekshiruv

- Wrong/no-response separation.
- Late join.
- Disconnect.
- Technical failure.
- First/revote separation.
- Projector payload absence.

### Tugallanish sharti

- Har percentage yonida count/denominator mavjud.
- Private evidence public roomga chiqmaydi.

---

## C3-02. Hinge recommendation engine

### Natija

Rule engine teacherga Move on, Discuss yoki Reteach recommendationini structured data bilan beradi.

### Fayllar

```text
services/cast/hinge-engine.js
services/cast/evidence-service.js
public/js/cast-director.js
tests/unit/cast-hinge.test.js
```

### Bajarish

1. Pure `recommendHingeAction(evidence, config)` function yozish.
2. Minimum accepted-response coverage threshold qo‘shish.
3. Sample kichik bo‘lsa `INSUFFICIENT_EVIDENCE` qaytarish.
4. Accuracy bandlarni policy configga qo‘yish.
5. Dominant distractor bo‘lsa misconception signalini qo‘shish.
6. High-confidence wrong bo‘lsa priority signal qo‘shish.
7. Timeout yoki network issue yuqori bo‘lsa technical caution qo‘shish.
8. Recommendationni action emas, suggestion object sifatida qaytarish.
9. Director cardda underlying countsni ko‘rsatish.
10. Teacher accept/dismiss/override eventlarini yozish.
11. Rule versionni eventga yozish.
12. Recommendation avtomatik next/revote/reteach command yubormasligi.

### Contract

```json
{
  "recommendation": "DISCUSS",
  "ruleVersion": "hinge_v1",
  "signals": [
    { "code": "MIXED_ACCURACY", "value": 0.58 },
    { "code": "DOMINANT_DISTRACTOR", "optionId": "o_c", "count": 10 }
  ],
  "allowedActions": ["MOVE_ON", "DISCUSS", "RETEACH"],
  "teacherDecision": null
}
```

### Tekshiruv

- ≥80% band.
- 35–79% band.
- <35% band.
- Low coverage.
- Dominant distractor.
- High network failure.
- Teacher override.
- No automatic mutation.

### Tugallanish sharti

- Recommendation card teacher commandisiz phase’ni o‘zgartirmaydi.

---

## C3-03. Vote → Discuss → Revote

### Natija

First vote immutable saqlanadi; teacher discussion ochadi; revote alohida attempt sifatida yoziladi.

### Fayllar

```text
services/cast/state-machine.js
services/cast/answer-service.js
services/cast/evidence-service.js
socket/cast-handler.js
public/js/cast-director.js
public/js/cast-participant.js
```

### Bajarish

1. Answer phase’ga `voteRound: 1 | 2` qo‘shish.
2. First vote answer pathini `attemptNo=1` bilan immutable qilish.
3. Question lockdan keyin first distributionni Director-private saqlash.
4. `cast:startDiscussion` command yaratish.
5. Discussion duration va optional team/pair instructionsni state’ga yozish.
6. Discussion tugaganda teacher `cast:openRevote` yuborishi.
7. Revote answer pathini `attemptNo=2` bilan yozish.
8. First vote’ni overwrite qilmaslik.
9. Revote paytida previous answerni participantga policy bo‘yicha ko‘rsatish/yashirish.
10. Revote close’da before/after matrix hisoblash.
11. Score policy’ni `first_only`, `revote_only`, `learning_only_no_leaderboard` enum bilan boshqarish.
12. Defaultda original leaderboard score’ni saqlash.
13. Explanation va transfer actionlarini revote’dan keyin ochish.
14. Exportda first/revote’ni alohida ustunlar qilish.

### Contract

```json
{
  "firstVote": { "optionIds": ["o_c"], "correct": false },
  "revote": { "optionIds": ["o_b"], "correct": true },
  "change": "WRONG_TO_CORRECT"
}
```

### Tekshiruv

- First vote overwrite attempt.
- Discussion without lock rejection.
- Revote duplicate.
- First/revote score policy.
- Reconnect during discussion.
- Late join before revote.
- Export separation.

### Tugallanish sharti

- First vote data doim saqlanadi.
- Public first distribution teacher ruxsatisiz chiqmaydi.

---

## C3-04. Confidence Lens

### Natija

Selected questionlarda answer bilan confidence olinadi va private aggregate matrix yaratiladi.

### Fayllar

```text
services/cast/confidence-service.js
services/cast/config-schema.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. Confidence policy enum: `off`, `strategic_items`, `all_items`.
2. Question metadata’da `askConfidence` flag qo‘shish.
3. Answer submitdan keyin yoki birga confidence prompt ko‘rsatish.
4. Confidence enum: low, medium, high.
5. Confidence’ni answer recorddan alohida field/pathda saqlash.
6. Missing confidence’ni wrong deb hisoblamaslik.
7. Matrixni correctness bilan serverda join qilish.
8. Teacherga 2x2/3x2 aggregate ko‘rsatish.
9. Individual confidence’ni projector va leaderboarddan chiqarish.
10. Confidence’ni score/grade formulasiga bermaslik.
11. First va revote confidence’ni alohida saqlash.
12. Tiny cohortda matrix cell suppression qilish.

### Contract

```json
{
  "coverage": 18,
  "correctHigh": 8,
  "correctLowOrMedium": 5,
  "wrongLowOrMedium": 3,
  "wrongHigh": 2
}
```

### Tekshiruv

- Missing confidence.
- First/revote confidence.
- Public payload absence.
- Tiny cell suppression.
- Score independence.

### Tugallanish sharti

- Confidence grade va public rankga ta’sir qilmaydi.

---

## C3-05. Misconception Map

### Natija

Distractor metadata teacher tasdiqlaydigan misconception signaliga aylanadi.

### Fayllar

```text
services/cast/misconception-service.js
services/cast/test-loader.js
public/js/cast-director.js
views/user/create-test.ejs
```

### Bajarish

1. Question option metadata modeliga `misconceptionId` qo‘shish.
2. Misconception registry modelini yaratish.
3. `teacherExplanation`, `contrastExampleId`, `followUpItemId` fieldlarini qo‘shish.
4. Authoring UI’da distractorga misconception biriktirish controlini qo‘shish.
5. Evidence service dominant distractorni topishi.
6. Mapping mavjud bo‘lsa Director card yaratish.
7. Teacher confirm/reject action qo‘shish.
8. Confirm qilinganda explanation/contrast/transfer actionlarini taklif qilish.
9. Student individualini misconception label bilan saqlamaslik.
10. Aggregate reportga confirmed misconception count yozish.
11. Mapping versionini session snapshotga pin qilish.

### Contract

```json
{
  "optionId": "o_c",
  "misconceptionId": "mean_ignores_repeated_values",
  "teacherExplanation": "...",
  "contrastExampleId": "ex_12",
  "followUpItemId": "q_18"
}
```

### Tekshiruv

- Mapped distractor.
- Unmapped distractor.
- Confirm/reject.
- Source mapping edit after session.
- No individual public label.

### Tugallanish sharti

- Misconception action teacher confirmation talab qiladi.

---

## C3-06. Quick Prompt

### Natija

Teacher active session ichida original testni o‘zgartirmasdan ad-hoc savol yuboradi.

### Fayllar

```text
services/cast/quick-prompt-service.js
services/cast/state-machine.js
public/js/cast-director.js
public/js/cast-participant.js
```

### Bajarish

1. Prompt type enum yaratish: MCQ, T/F, confidence, prediction, rating, short_answer, exit_ticket.
2. Director’da prompt composer drawer yaratish.
3. Draftni local state’da saqlash.
4. Launchdan oldin server schema validation qilish.
5. Quick promptga session-scoped question ID berish.
6. Private correct answer faqat scored type’da serverga yozish.
7. Promptni choreography’ga new block sifatida qo‘shish.
8. Resultni source test versioniga qo‘shmaslik.
9. `Save to library`ni alohida authenticated POST action qilish.
10. Open text promptni moderation-first qilish.
11. Exit ticketni end flow bilan bog‘lash.

### Contract

```json
{
  "type": "single_choice",
  "text": "...",
  "options": [
    { "id": "o_1", "text": "..." },
    { "id": "o_2", "text": "..." }
  ],
  "correctOptionIds": ["o_2"],
  "timer": { "mode": "soft", "seconds": 30 }
}
```

### Tekshiruv

- Every type.
- Invalid prompt.
- Source test immutability.
- Open text moderation.
- Save to library permission.
- Reconnect during prompt.

### Tugallanish sharti

- Quick Prompt session eventida qoladi; original testga silent yozilmaydi.

---

## C3-07. Reasoning Capture

### Natija

Selected items answerdan keyin qisqa justification oladi va teacher-private moderation queuega yuboradi.

### Fayllar

```text
services/cast/reasoning-service.js
services/cast/moderation-service.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. Question metadata’da `reasoning: off|optional|required` qo‘shish.
2. Character limitni 140–280 configurable qilish.
3. Answer saved bo‘lgach reasoning input ochish.
4. Required mode’da blank reasoningni phase completion uchun incomplete belgilash.
5. Network retry uchun reasoningga alohida command ID berish.
6. Raw reasoningni private storega yozish.
7. Moderation state `RECEIVED` bilan boshlash.
8. Director queue’da preview ko‘rsatish.
9. Approve, redact, hide va project actionlarini qo‘shish.
10. Public projectorga faqat approved/redacted text yuborish.
11. Score’ni auto o‘zgartirmaslik.
12. Teacher manual rubric feature’ni future separate capability qilish.
13. Retention classni raw open text bilan bir xil boshqarish.

### Tekshiruv

- Required/optional/off.
- Character boundary.
- Lost ACK.
- Harmful text.
- PII text.
- Projector approval boundary.
- No score mutation.

### Tugallanish sharti

- Unmoderated reasoning public ko‘rinmaydi.

---

## C3-08. Mastery, transfer va redemption

### Natija

Teacher equivalent transfer yoki redemption itemini ishga tushiradi; learning progress original leaderboarddan alohida saqlanadi.

### Fayllar

```text
services/cast/mastery-service.js
services/cast/state-machine.js
services/cast/evidence-service.js
public/js/cast-director.js
```

### Bajarish

1. Question metadata’da `transferItemIds` va `redemptionItemIds` qo‘shish.
2. Teacherga item picker ko‘rsatish.
3. Selected itemni session snapshot/private loaderdan olish.
4. Transfer phase’ni normal question answer flow bilan ishlatish.
5. Transfer resultni original item resultdan alohida yozish.
6. Redemption attempt limitni configdan olish.
7. Defaultda original public leaderboard score’ni o‘zgartirmaslik.
8. `learningProgress` recordda wrong→correct, first→transfer holatini saqlash.
9. Personal redemptionni participant-private qilish.
10. Class-wide redemptionni aggregate flow qilish.
11. Unlimited trial-and-errorni bloklash.
12. Action Packga next-step yozish.

### Contract

```json
{
  "sourceQuestionId": "q_04",
  "followUpQuestionId": "q_18",
  "type": "TRANSFER",
  "attemptNo": 1,
  "leaderboardImpact": "NONE"
}
```

### Tekshiruv

- Transfer mapping.
- Missing follow-up.
- Attempt limit.
- Private redemption scope.
- Leaderboard unchanged.
- Learning progress update.

### Tugallanish sharti

- Redemption score va original competition score alohida.

---

## C3-09. Whole-Class Goal va Personal Best

### Natija

Competitiondan tashqari class cooperative progress va participant-private personal progress ko‘rsatiladi.

### Fayllar

```text
services/cast/class-goal-service.js
services/cast/personal-progress-service.js
public/js/cast-director.js
public/js/cast-projector.js
public/js/cast-participant.js
```

### Bajarish

1. Goal types: accuracy threshold, misconceptions resolved, knowledge points, mastery rounds.
2. Goal target va progressni session configda saqlash.
3. Goal progressni aggregate eventsdan hisoblash.
4. Projector cardda individual ayb/rank ko‘rsatmaslik.
5. Goal complete event va reduced-motion celebration yaratish.
6. Personal progressni roster-linked participant uchun hisoblash.
7. Comparable scoring/config fingerprintni tekshirish.
8. Personal bestni participant-private ko‘rsatish.
9. Public personal best opt-in bo‘lmasa projector’ga chiqarmaslik.
10. Shared-device evidence’da individual personal best yaratmaslik.

### Tekshiruv

- Every goal type.
- Goal completion.
- No participant blame.
- Personal privacy.
- Incompatible session.
- Shared-device blocker.

### Tugallanish sharti

- Cooperative goal va personal progress leaderboarddan mustaqil ishlaydi.

---

## C3-10. Confusion Signal va moderated Question Wall

### Natija

Participant private quick signal yuboradi; free-text question faqat moderationdan keyin public bo‘ladi.

### Fayllar

```text
services/cast/confusion-service.js
services/cast/moderation-service.js
public/js/cast-participant.js
public/js/cast-director.js
public/js/cast-projector.js
```

### Bajarish

1. Fixed signal enum yaratish: confused, too_fast, technical_issue, need_example.
2. Signalga per-participant cooldown qo‘shish.
3. Same signalni time window ichida dedupe qilish.
4. Director’ga aggregate count yuborish.
5. Individual identityni default yashirish.
6. Teacher acknowledgement action qo‘shish.
7. Question Wall text submit schema yaratish.
8. Textni private moderation queuega yozish.
9. PII/profanity rule flaglarini queue priority sifatida qo‘shish.
10. Approve/redact/hide/project/withdraw commandlarini yaratish.
11. Projector uchun approved safe projection yaratish.
12. Host disconnectda public moderation queue projectionini freeze qilish.
13. Moderator role’ga scoped access berish.
14. Raw textni generic logsdan chiqarish.

### Tekshiruv

- Signal cooldown.
- Duplicate signal.
- Open-text approval.
- Redaction.
- Withdraw.
- Moderator outage.
- Host disconnect.
- Projector payload.

### Tugallanish sharti

- Participant-to-participant chat va DM mavjud emas.
- `RECEIVED` content public chiqmaydi.

---

## C3-11. Prediction → Observation → Explanation flow

### Natija

Prediction, stimulus observation va explanation uchta alohida phase va record sifatida ishlaydi.

### Fayllar

```text
services/cast/poe-service.js
services/cast/state-machine.js
services/cast/evidence-service.js
public/js/cast-director.js
public/js/cast-participant.js
public/js/cast-projector.js
```

### Bajarish

1. `PREDICTION_OPEN`, `OBSERVATION`, `EXPLANATION_OPEN` phase’larini state machine’ga qo‘shish.
2. Prediction question ID va response’ni normal answer flow bilan yozish.
3. Prediction confidence’ni optional field sifatida olish.
4. Prediction lockdan keyin teacher-private distribution yaratish.
5. Observation phase’da image, animation, video, experiment instruction yoki live note projectionini ochish.
6. Observation media readinessni barcha active clientlardan aggregate qilish.
7. Strict timer bo‘lsa media ready thresholdga yetmaguncha answer timerini ochmaslik.
8. Explanation phase’da short answer yoki MCQ reasoning olish.
9. Prediction va explanationni bitta participant ID bilan bog‘lash.
10. Prediction→explanation change matrix hisoblash.
11. Teacherga aggregate pattern va approved exemplar ko‘rsatish.
12. Public exemplarni moderationdan o‘tkazish.
13. Action Packga POE summary qo‘shish.
14. Observation media fail bo‘lsa hostga retry, skip va text fallback berish.

### Contract

```json
{
  "flowId": "poe_01",
  "predictionQuestionId": "q_pred",
  "observationId": "obs_01",
  "explanationQuestionId": "q_exp",
  "timerPolicy": {
    "predictionSeconds": 20,
    "observationSeconds": null,
    "explanationSeconds": 90
  }
}
```

### Tekshiruv

- Prediction without confidence.
- Media readiness.
- Media failure.
- Explanation moderation.
- Reconnect in every phase.
- Prediction/explanation join.
- Action Pack summary.

### Tugallanish sharti

- Uch phase bir-birini overwrite qilmaydi va replay’da qayta tiklanadi.

---

## C3-12. Open-Response Semantic Board

### Natija

Open response’lar private olinadi, de-identified clustering qilinadi va teacher tasdiqlagan cluster/exemplarlar projectorga chiqariladi.

### Fayllar

```text
services/cast/open-response-service.js
services/cast/moderation-service.js
services/cast/clustering-adapter.js
services/cast/provider-registry.js
public/js/cast-director.js
public/js/cast-projector.js
```

### Bajarish

1. Raw open response’ni private storega yozish.
2. Har response’ga moderation state berish.
3. PII/profanity flagdan o‘tmagan response’ni external providerga yubormaslik.
4. Approved processing scope bo‘yicha direct identifierlarni olib tashlash.
5. Clustering adapter interface yaratish.
6. Provider requestga session-scoped opaque response ID va cleaned text berish.
7. Provider response’ni strict schema bilan parse qilish.
8. Suggested cluster ID, label, response IDs va confidence qaytarish.
9. Teacherga unclustered, suggested va confirmed ustunlarini ko‘rsatish.
10. Teacher merge, split, rename, move va confirm actionlarini qo‘shish.
11. Har manual actionni event logga yozish.
12. Projector’ga faqat confirmed label, count va approved exemplar yuborish.
13. Raw participant identityni projector projectiondan chiqarish.
14. Provider timeoutda manual tag board fallback ishlatish.
15. Provider training-use policy va retentionni registry’dan tekshirish.
16. Cluster resultni score yoki final gradega aylantirmaslik.
17. Delete/retention jobda provider-side deletion hookini chaqirish.

### Contract

```json
{
  "clusterRunId": "cluster_...",
  "status": "SUGGESTED",
  "clusters": [
    {
      "id": "c_1",
      "label": "Formulani noto‘g‘ri tanlash",
      "responseIds": ["r_opaque_1", "r_opaque_2"],
      "teacherConfirmed": false
    }
  ],
  "unclusteredResponseIds": []
}
```

### Tekshiruv

- PII response providerga yuborilmasligi.
- Harmful response safe hold.
- Provider invalid schema.
- Provider timeout.
- Merge/split/rename.
- Projector safe projection.
- Deletion hook.

### Tugallanish sharti

- Public board teacher confirmationisiz yaratilmaydi.

---

## C3-13. Student Question Forge

### Natija

Student savol, javob, explanation va source draftini yuboradi; teacher edit/approve qilgach Quick Prompt yoki library itemiga aylantiradi.

### Fayllar

```text
services/cast/question-forge-service.js
services/cast/moderation-service.js
routes/cast.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. Forge capability’ni session config va institution policy bilan boshqarish.
2. Participant formiga stem, type, options, proposed answer, explanation va source fieldlarini qo‘shish.
3. Draft schema va character limits yaratish.
4. Draftni private moderation queuega yozish.
5. Duplicate participant submitni command ID bilan idempotent qilish.
6. PII/profanity/content flaglarini qo‘llash.
7. Existing test bank bilan exact hash duplicate tekshirish.
8. Optional semantic duplicate’ni provider feature flag bilan tekshirish.
9. Teacherga preview/edit/approve/reject actionlarini berish.
10. Approve’da new session-scoped question ID yaratish.
11. `Launch now`ni Quick Prompt service bilan ulash.
12. `Save to library`ni authenticated POST va ownership bilan bajarish.
13. Library save’da teacher final answer/explanationni qayta validate qilish.
14. Student attributionni institution policy bo‘yicha private/public alias bilan boshqarish.
15. Reject reasonni participantga optional safe microcopy bilan berish.
16. Original draft va teacher edited versionni auditda alohida saqlash.
17. Draftni avtomatik score/publicationga yubormaslik.

### Contract

```json
{
  "draftId": "forge_...",
  "authorParticipantId": "p_...",
  "questionType": "single_choice",
  "stem": "...",
  "options": [],
  "proposedAnswer": [],
  "explanation": "...",
  "source": "...",
  "status": "REVIEW_READY"
}
```

### Tekshiruv

- Invalid draft.
- Duplicate submit.
- PII/harmful content.
- Teacher edit.
- Launch now.
- Save ownership.
- Cross-session access.
- Attribution policy.

### Tugallanish sharti

- Teacher approval’siz student draft live savol yoki question bank itemiga aylanmaydi.

---

## C3-14. Session Choreography Composer va Orchestration Dashboard

### Natija

Teacher reusable block sequence yaratadi; Director current/next block, timing va live signalni bitta dashboardda boshqaradi.

### Fayllar

```text
services/cast/choreography-schema.js
services/cast/choreography-service.js
services/cast/state-machine.js
public/js/cast-choreography.js
public/js/cast-director.js
public/css/cast-director.css
```

### Bajarish

1. Block enum yaratish: Lobby, Instructions, Think, Question, Confidence, Reveal, Discuss, Revote, Explanation, Leaderboard, Class Goal, Break, Quick Prompt, Redemption, Exit Ticket.
2. Har block uchun typed config schema yaratish.
3. Choreography template modeliga ID, version, owner va blocks array qo‘shish.
4. Composer’da add, reorder, duplicate, edit va delete actionlarini yaratish.
5. Drag-and-dropga keyboard move up/down alternative berish.
6. Block dependency validation yozish.
7. Revote oldidan first vote mavjudligini tekshirish.
8. Reveal oldidan scorable question mavjudligini tekshirish.
9. Fully-auto flowda har block uchun valid exit trigger talab qilish.
10. Estimated durationni block sequence’dan hisoblash.
11. Template preview/rehearsal actionini qo‘shish.
12. Session create’da choreography’ni immutable snapshot qilish.
13. Director dashboardda `current block`, `next block`, `elapsed`, `remaining`, `coverage`, `health` ko‘rsatish.
14. Teacherga planned next’ni override qilish imkonini berish.
15. Override eventiga actor, old block, new block va revision yozish.
16. Invalid jumpni state machine’da rad etish.
17. Projector va Participant projectionlarini current block type bo‘yicha render qilish.
18. Saved template migration va diff yaratish.

### Contract

```json
{
  "templateId": "chor_...",
  "version": 2,
  "blocks": [
    { "id": "b1", "type": "LOBBY", "config": {} },
    { "id": "b2", "type": "THINK", "config": { "seconds": 5 } },
    { "id": "b3", "type": "QUESTION", "config": { "questionId": "q_01" } },
    { "id": "b4", "type": "CONFIDENCE", "config": {} },
    { "id": "b5", "type": "REVEAL", "config": {} }
  ]
}
```

### Tekshiruv

- Block add/reorder/delete.
- Keyboard reorder.
- Invalid dependency.
- Fully-auto missing trigger.
- Duration.
- Runtime override.
- Replay sequence.
- Version migration.

### Tugallanish sharti

- Runtime progression choreography snapshot va state-machine transition bilan mos ishlaydi.

---

## C3-15. Rehearsal, Bot Simulation va Cast Quality Lab

### Natija

Teacher production participantlarsiz sessionni botlar bilan tekshiradi; preflight va postflight quality report oladi.

### Fayllar

```text
services/cast/rehearsal-service.js
services/cast/bot-simulator.js
services/cast/quality-lab.js
routes/cast.js
public/js/cast-studio.js
views/cast/quality-lab.ejs
```

### Bajarish

1. Rehearsal sessionni `environment=simulation` bilan yaratish.
2. Simulation data’ni real analytics va rosterdan ajratish.
3. Scenario registry yaratish:
   - 10/30/100 participants;
   - fast correct;
   - slow correct;
   - wrong cluster;
   - disconnect;
   - late join;
   - no answers;
   - all instant;
   - duplicate answer;
   - lost ACK;
   - host disconnect.
4. Bot participant IDsni dedicated namespace’da yaratish.
5. Bot answerlarini normal answer service orqali yuborish.
6. Botga private answer keyni frontend orqali bermaslik; server scenario engine selection yaratishi.
7. Director va Projector UI’ni real eventlar bilan ishlatish.
8. Rehearsal reset/stop actionlarini qo‘shish.
9. Preflight Quality Lab rulesini yaratish:
   - answer-key blocker;
   - missing answer;
   - unsupported type;
   - no timer + fully auto;
   - short timer + long stem;
   - public full leaderboard;
   - music + reading-heavy;
   - missing explanation;
   - contrast/media/accessibility.
10. Postflight rulesini yaratish:
    - timeout rate;
    - delivery latency;
    - auto-close readiness;
    - dominant distractor;
    - revote gain;
    - high-confidence wrong;
    - participant coverage;
    - background/audio mute;
    - host intervention.
11. Findinglarga severity, field path, question ID va action ID berish.
12. Teacher accept/dismiss/resolve statusini saqlash.
13. Rehearsal reportni production resultdan alohida qilish.

### Contract

```json
{
  "findingId": "find_...",
  "severity": "BLOCKER",
  "code": "ANSWER_KEY_PUBLIC",
  "fieldPath": null,
  "questionId": "q_01",
  "status": "OPEN"
}
```

### Tekshiruv

- Every simulation scenario.
- Simulation isolation.
- Bot duplicate/lost ACK.
- Quality rule fixtures.
- Finding resolve/dismiss.
- Real analytics exclusion.

### Tugallanish sharti

- Rehearsal production leaderboard, roster va institutional metricsga kirmaydi.

---

## C3-16. Self-Paced Race

### Natija

Har participant o‘z question cursoriga ega bo‘ladi; server individual progression va completionni boshqaradi.

### Fayllar

```text
services/cast/self-paced-service.js
services/cast/state-machine.js
services/cast/projections.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. Mode’ni C2 feature flag ortida ishga tushirish.
2. Global question phase o‘rniga participant cursor modelini yaratish.
3. Har participant uchun current position, openedAt, closesAt va completed count saqlash.
4. Answer accepted bo‘lgach server next safe question projectionini berish.
5. Question randomization orderini participant/session seed bilan snapshot qilish.
6. Late joinni first question yoki configured start pointdan boshlash.
7. Pause session commandini barcha participant cursorlariga apply qilish.
8. End sessionda incomplete participant statusini saqlash.
9. Speed score bo‘lsa server per-question timing ishlatish.
10. Network fairness healthini reportga qo‘shish.
11. Public live full rankni default off qilish.
12. Director’da progress distribution: 0–25%, 26–50%, 51–75%, 76–100% ko‘rsatish.
13. Participantga own progress va private rank policy berish.
14. Question answer keyini next question projectionda bermaslik.
15. Recovery snapshotni participant cursoriga scope qilish.

### Contract

```json
{
  "participantId": "p_...",
  "questionOrder": ["q_03", "q_01", "q_02"],
  "position": 1,
  "currentQuestionId": "q_01",
  "completed": 1,
  "total": 3,
  "status": "ACTIVE"
}
```

### Tekshiruv

- Different participant pace.
- Pause all.
- Late join.
- Reconnect cursor.
- Per-question expiry.
- End incomplete.
- Public rank privacy.

### Tugallanish sharti

- Bir participant progressioni boshqa participant cursorini o‘zgartirmaydi.

---

## C3-17. Pedagogically safe power-ups

### Natija

Power-up faqat teacher-enabled presetda ishlaydi va correctness recordni o‘zgartirmaydi.

### Fayllar

```text
services/cast/powerup-service.js
services/cast/scoring.js
services/cast/config-schema.js
public/js/cast-participant.js
public/js/cast-director.js
```

### Bajarish

1. Power-up capability’ni default off qilish.
2. Allowed types registry yaratish: hint, extra_time, team_consult, private_redemption.
3. Random answer elimination va opponent sabotage’ni registryga kiritmaslik.
4. Teacher/preset tomonidan allowed typesni belgilash.
5. Participant inventoryni serverda saqlash.
6. Activation commandni idempotent qilish.
7. Extra time’ni personal timer capability bo‘lmasa global timerga silent apply qilmaslik.
8. Hint ko‘rsatilganini answer record metadata’da saqlash.
9. Correctnessni raw evidence sifatida o‘zgartirmaslik.
10. Point multiplier bo‘lsa engagement score breakdownda alohida ko‘rsatish.
11. Team power-upni barcha memberga consistent apply qilish.
12. Accessibility userga power-up animationisiz same information berish.
13. Power-up usage’ni public shame yoki misconduct signaliga aylantirmaslik.

### Tekshiruv

- Disabled mode.
- Inventory duplicate activation.
- Hint metadata.
- Extra-time policy.
- Team consistency.
- Raw correctness unchanged.

### Tugallanish sharti

- Power-up learning evidence fieldlarini overwrite qilmaydi.

---

# C4 — Inclusion, privacy va governance

## C4-01. Team Challenge va shared-device

### Natija

Team session, normalized scoring va one-device-per-team evidence to‘g‘ri saqlanadi.

### Fayllar

```text
services/cast/team-service.js
services/cast/scoring.js
services/cast/join-service.js
public/js/cast-studio.js
public/js/cast-director.js
public/js/cast-participant.js
```

### Bajarish

1. Team model: ID, safe name, member IDs, active member count.
2. Assignment: manual, random, balanced, roster.
3. Team countni 2–8 validate qilish.
4. Member absence va late joinni team membershipda qayta hisoblash.
5. Team talk phase va timer qo‘shish.
6. Response modelni `individual_then_aggregate` va `single_team_device`ga ajratish.
7. Single-team-device’da answer team ID bilan yozish.
8. Team answerni individual memberlarga nusxalamaslik.
9. Normalized average’ni answered eligible members bo‘yicha hisoblash.
10. Equal-size-only sum mode’ga guard qo‘shish.
11. Team tie policy’ni leaderboard servicega berish.
12. Projector’da team-only rank ko‘rsatish.
13. Individual progressni private yoki off qilish.
14. Shared-device reportga `evidenceUnit=group` yozish.
15. Reporter rotation reminder qo‘shish.

### Contract

```json
{
  "teamId": "team_1",
  "evidenceUnit": "group",
  "members": ["p_1", "p_2", "p_3"],
  "responseOwnerId": "team_1",
  "scoreAggregation": "normalized_average"
}
```

### Tekshiruv

- Unequal team size.
- Absent member.
- Team device reconnect.
- Team duplicate answer.
- Individual record absence.
- Team-only leaderboard.

### Tugallanish sharti

- Group response individual mastery sifatida export qilinmaydi.

---

## C4-02. Hybrid va low-bandwidth mode

### Natija

In-room va remote participant bir sessionda ishlaydi; network holati scoring va reportingda ajratiladi.

### Fayllar

```text
services/cast/config-schema.js
services/cast/evidence-service.js
public/js/cast-participant.js
public/js/cast-director.js
public/js/cast-studio.js
```

### Bajarish

1. Delivery enum: in_room, remote, hybrid.
2. Participant join recordga delivery type qo‘shish.
3. Hybrid presetda question-on-device’ni majburiy qilish.
4. Hybrid presetda speed bonusni default 0 qilish.
5. Speed mode tanlansa blocking/warning policy qo‘llash.
6. Remote participantga text status va transcript berish.
7. Projector/screen-share’ni timer authority qilmaslik.
8. Network qualityni answer recorddan alohida telemetry sifatida bucketlash.
9. Technical failure va no-response’ni alohida hisoblash.
10. Low-bandwidthda media derivative va payload size’ni kamaytirish.
11. Decorative event/animationlarni disable qilish.
12. Current question va minimal state’ni cache qilish.
13. Offline pending answerni bir xil command ID bilan retry qilish.
14. Director’da in-room/remote coverage’ni alohida ko‘rsatish.
15. Reportga delivery fingerprint qo‘shish.

### Tekshiruv

- 300/800ms latency.
- Packet loss.
- Network switch.
- Background tab.
- Screen-share delay.
- In-room/remote missing split.
- Low-bandwidth media fallback.

### Tugallanish sharti

- Remote network issue wrong answerga aylantirilmaydi.

---

## C4-03. No-device paper-card mode

### Natija

Teacher device orqali four-orientation card scan qilinadi; raw classroom frame saqlanmaydi.

### Fayllar

```text
services/cast/card-scan-service.js
public/js/cast-card-scanner.js
views/cast/director.ejs
```

### Bajarish

1. Feature’ni P3 flag ortiga qo‘yish.
2. Card ID va four orientation mapping formatini belgilash.
3. Camera permissionni faqat scanner action bosilganda so‘rash.
4. Frame processingni client-local qilish.
5. Raw frame upload endpoint yaratmaslik.
6. Raw frame recordingni o‘chirish.
7. Detected card ID va option IDni server answer commandiga aylantirish.
8. Unknown/duplicate cardni flag qilish.
9. Glare/occlusion confidence threshold qo‘shish.
10. Not-scanned participantni wrong deb belgilamaslik.
11. Director’da scanned/expected count ko‘rsatish.
12. Lockdan oldin manual correction qilish.
13. Manual correctionga actor/time/reason audit yozish.
14. Paper mode’ni MCQ va T/F bilan cheklash.
15. Reportga `evidenceUnit=card_response` yozish.

### Tekshiruv

- Four orientation.
- Duplicate card.
- Glare.
- Occlusion.
- Not scanned.
- Manual correction.
- Raw frame persistence scan.
- Permission denial fallback.

### Tugallanish sharti

- Camera frame serverga yuborilmaydi va storage’da qolmaydi.

---

## C4-04. Accessibility implementation

### Natija

Setup, Director, Projector va Participant critical flow keyboard, screen reader, high contrast va reduced motion bilan ishlaydi.

### Fayllar

```text
public/css/cast-tokens.css
public/css/cast-studio.css
public/css/cast-director.css
public/css/cast-projector.css
public/css/cast-participant.css
public/js/cast-a11y.js
views/cast/*.ejs
```

### Bajarish

1. WCAG-compatible color tokens yaratish.
2. Focus ring tokenini barcha interactive controllarga qo‘llash.
3. Native button/input/radio semanticsdan foydalanish.
4. Custom controlga keyboard behavior va ARIA state qo‘shish.
5. Status live regionlarni markazlashtirish.
6. Timer har second announce qilinmasligi uchun threshold announcement qilish.
7. 30, 10, 5, 0 second announcement policy yaratish.
8. Answer saved uchun polite live region ishlatish.
9. Question closed/error uchun assertive live region ishlatish.
10. Rangga qo‘shimcha symbol va text label berish.
11. Chart uchun accessible table alternative yaratish.
12. Projector audio instructionga visual text berish.
13. Motionni transform/opacity bilan cheklash.
14. `prefers-reduced-motion`da nonessential animationni o‘chirish.
15. 200% zoomda horizontal critical scrollni yo‘qotish.
16. 320px participant layoutni test qilish.
17. Touch targetsni 44px minimum qilish.
18. High contrast dark/light theme qo‘shish.
19. Question-on-device’ni accessibility setting sifatida doim mavjud qilish.
20. Personal long-time/no-timer accommodation hookini configga qo‘shish.
21. QR yonida plain short URL va code berish.
22. Media alt, caption va transcript fieldlarini render qilish.
23. Keyboard shortcutlarni optional va discoverable qilish.
24. Focus phase o‘zgarganda userni kutilmagan joyga ko‘chirmaslik.

### Tekshiruv

- Keyboard-only e2e.
- NVDA/VoiceOver smoke.
- axe yoki teng automated scan.
- 200% zoom.
- Reduced motion.
- High contrast.
- Audio off.
- Color-blind simulation.
- Large text.
- QR-free join.

### Tugallanish sharti

- Critical join→answer→ACK→reveal flow assistive tech bilan tugallanadi.

---

## C4-05. Internationalization va RTL foundation

### Natija

UI `uz-Latn`, `uz-Cyrl`, `ru`, `en` translation keylari bilan ishlaydi va RTL layoutga tayyor bo‘ladi.

### Fayllar

```text
services/i18n/catalog.js
public/js/i18n.js
locales/uz-Latn/cast.json
locales/uz-Cyrl/cast.json
locales/ru/cast.json
locales/en/cast.json
public/css/cast-tokens.css
views/cast/*.ejs
```

### Bajarish

1. Hardcoded Cast stringlarni translation keylarga ko‘chirish.
2. UI locale va content locale’ni alohida saqlash.
3. BCP-47 canonical locale registry yaratish.
4. Plural/select uchun ICU-compatible formatter ishlatish.
5. Sentence fragment concatenationni yo‘qotish.
6. Date, number, percent va list uchun `Intl` ishlatish.
7. Join code’ni locale-independent ASCII saqlash.
8. User textga `dir="auto"` qo‘llash.
9. Dynamic alias/textni `<bdi>` bilan isolate qilish.
10. Documentda `lang` va `dir`ni locale bo‘yicha o‘rnatish.
11. CSSni logical propertiesga o‘tkazish.
12. Left/right ma’noli iconlarni RTL’da test qilish.
13. Timer va code mixed bidi isolation qilish.
14. Uzbek apostrophe input normalization layer yaratish.
15. Contentni avtomatik transliteration qilmaslik.
16. Machine translation bo‘lsa originalni saqlash va label qo‘yish.
17. Pseudo-locale yaratish.
18. 30–50% expansion bilan layout test qilish.
19. Missing key telemetry’ni PII’siz yuborish.
20. Fallback chainni `requested → base → uz-Latn` qilish.

### Tekshiruv

- Every locale key completeness.
- Pseudo-locale clipping.
- RTL setup/director/projector/participant.
- Mixed Arabic + code.
- Plural/number formatting.
- User-generated bidi text.

### Tugallanish sharti

- Cast UI’da hardcoded primary microcopy qolmaydi.

---

## C4-06. Child-safe moderation va identity policy

### Natija

Minor preset public chat/DM, public full identity va unmoderated open textni bloklaydi.

### Fayllar

```text
services/cast/moderation-service.js
services/cast/nickname.js
services/cast/governance-service.js
public/js/cast-director.js
public/js/cast-participant.js
```

### Bajarish

1. Minor-safe policy presetini serverda yaratish.
2. Public chat va participant DM capabilitylarini false qilish.
3. Open text default visibility’ni `host_review_first` qilish.
4. Full legal name va roster IDni projector projectiondan chiqarish.
5. Safe alias generatorni locale catalog bilan yaratish.
6. Reserved role impersonationni bloklash.
7. Unicode NFKC normalizationni comparison uchun ishlatish.
8. Original display textni safe escaped shaklda saqlash.
9. Invisible bidi control va zero-width abuse’ni filter/flag qilish.
10. Profanity listni locale bo‘yicha versionlash.
11. Auto flagni final punishment sifatida ishlatmaslik.
12. Moderation state machine yaratish.
13. Approve/redact/hide/project/withdraw permissionlarini tekshirish.
14. Harmful raw textni logs va analyticsdan chiqarish.
15. Participant remove va membership blockni alohida saqlash.
16. Lobby raid paytida invitation/code rotate action qo‘shish.
17. Moderator unavailable bo‘lsa contentni private hold qilish.

### Moderation state

```text
RECEIVED
AUTO_FLAGGED
REVIEW_READY
APPROVED
REDACTED
HIDDEN
PROJECTED
WITHDRAWN
```

### Tekshiruv

- Unsafe nickname.
- Reserved role.
- Confusable/invisible text.
- Auto-flag false positive.
- Unmoderated projector block.
- Withdraw latency.
- Kicked rejoin.
- Provider outage.

### Tugallanish sharti

- Minor policy server validationni chetlab o‘tib bo‘lmaydi.

---

## C4-07. Data inventory, retention va deletion

### Natija

Har Cast data class uchun purpose, retention, expiry va deletion pipeline ishlaydi.

### Fayllar

```text
services/cast/data-policy.js
services/cast/retention-job.js
services/cast/deletion-service.js
services/cast/provider-registry.js
scripts/cast-retention.js
routes/cast.js
```

### Bajarish

1. Data class enum yaratish.
2. Institution policy recordiga har class uchun retention days qo‘shish.
3. Default proposal qiymatlarini configda berish:
   - join token: session + 15 min;
   - recovery state: 24 soat;
   - named answers: 90 kun;
   - raw open text: 30 kun;
   - action pack: 1 term;
   - aggregate metrics: 13 oy;
   - audit/security log: 180 kun;
   - support bundle: 14 kun;
   - backup: approved rolling policy.
4. Session create’da policy versionini snapshotga pin qilish.
5. Daily/hourly retention worker yaratish.
6. Expired active DB recordlarni delete/anonymize qilish.
7. Cache, search va object storage cleanup hooklarini chaqirish.
8. Tokenlarni revoke qilish.
9. Backup tombstone yozish.
10. Restore jarayonida tombstoneni qayta qo‘llash.
11. Deletion completion auditga raw data yozmaslik.
12. Legal hold recordiga actor, scope, reason, expiry qo‘shish.
13. Tiny aggregate cohortni suppress qilish.
14. De-identification re-identification review flagini qo‘shish.
15. Provider registryda fields/region/subprocessors/training/retention/deletion SLA saqlash.
16. Unapproved provider SDK/buildni CI check bilan bloklash.
17. Camera/microphone data classni Cast Core’da disabled qilish.
18. O‘zbekiston-specific legal approval checklistini institution configga qo‘shish.

### Contract

```json
{
  "policyId": "institution_default_v1",
  "classes": {
    "named_answer": { "days": 90, "expiryAction": "DELETE" },
    "open_text": { "days": 30, "expiryAction": "DELETE" },
    "aggregate": { "days": 395, "expiryAction": "REVIEW_OR_DELETE" }
  }
}
```

Deletion job result:

```json
{
  "jobId": "ret_...",
  "policyId": "institution_default_v1",
  "processed": 120,
  "deleted": 118,
  "failed": 2,
  "failedIds": ["opaque_1", "opaque_2"]
}
```

### Tekshiruv

- Expiry boundary.
- Legal hold.
- Primary/cache/object cleanup.
- Backup restore tombstone.
- Failed deletion retry.
- Audit no raw text.
- Provider approval gate.

### Tugallanish sharti

- Retention faqat documentation emas, scheduled tested job sifatida ishlaydi.

---

## C4-08. Institution governance

### Natija

Institution approved preset, locked field, role, provider va policy versionlarini boshqaradi.

### Fayllar

```text
services/cast/governance-service.js
routes/admin.js
views/admin/dashboard.ejs
public/js/cast-studio.js
services/cast/config-schema.js
```

### Bajarish

1. Governance policy modelini yaratish.
2. Approved preset registry qo‘shish.
3. Locked field pathlari listini qo‘shish.
4. Max speed weight, public-name, leaderboard, participant limit, recording, media va AI policy fieldlarini qo‘shish.
5. Policy draft/published/deprecated statuslarini qo‘shish.
6. Publish uchun admin permission va confirmation qilish.
7. Effective date va version qo‘shish.
8. Policy diff ko‘rsatish.
9. Existing sessionlarni old policy versionida pin qilish.
10. Saved teacher preset migration preview yaratish.
11. Locked fieldni Setup Studio’da read-only ko‘rsatish.
12. Client lockni chetlab o‘tgan requestni serverda rad etish.
13. Governance audit export yaratish.
14. Tenant/institution boundaryni barcha read/write’da tekshirish.

### Contract

```json
{
  "policyId": "school_12_cast_v3",
  "version": 3,
  "status": "PUBLISHED",
  "lockedFields": {
    "leaderboard.anonymizeLowRanks": true,
    "moderation.publicChat": false,
    "ai.mayExecuteLiveActions": false
  },
  "limits": {
    "scoring.maxSpeedWeight": 0.2,
    "join.maxPlayers": 500
  }
}
```

### Tekshiruv

- Locked client override.
- Policy version pinning.
- Publish permission.
- Diff.
- Migration preview.
- Cross-tenant access.

### Tugallanish sharti

- High-risk fieldlar institution policydan tashqariga chiqmaydi.

---

# C5 — Results, scale va operations

## C5-01. Post-Cast Action Pack

### Natija

Session tugaganda teacherga aggregate evidence va bir bosishli follow-up actionlar beriladi.

### Fayllar

```text
services/cast/action-pack-service.js
services/cast/evidence-service.js
routes/cast.js
views/cast/results.ejs
public/js/cast-results.js
```

### Bajarish

1. End session commanddan keyin async action-pack job yaratish.
2. Session config fingerprintni reportga yozish.
3. Participation va missing reason summary yaratish.
4. Class accuracy va accepted denominatorni ko‘rsatish.
5. Hardest questionlarni minimum sample bilan aniqlash.
6. Confirmed misconception summary yaratish.
7. Confidence matrix summary yaratish.
8. First→revote change summary yaratish.
9. Transfer/redemption resultini alohida ko‘rsatish.
10. Timeout/network issue summary yaratish.
11. Item-quality flaglarni `review`, `revise`, `retire` actionlariga bog‘lash.
12. `Assign practice`, `Create intervention group`, `Create redemption session`, `Duplicate Cast config`, `Save preset`, `Export` actionlarini qo‘shish.
13. Student private recap projectionini yaratish.
14. Student recapga faqat own response, approved explanation va next steps berish.
15. Public low rankni recapdan chiqarish.
16. AI draft feature flag yoqilsa aggregate/de-identified input va teacher approval qo‘llash.
17. Action Pack retention policy’ni apply qilish.

### Contract

```json
{
  "sessionId": "cast_...",
  "fingerprint": "sha256:...",
  "participation": {},
  "questionSummaries": [],
  "misconceptions": [],
  "revoteChanges": [],
  "networkSummary": {},
  "recommendedTeacherActions": [],
  "generatedAt": 1780000900000,
  "policyVersion": 1
}
```

### Tekshiruv

- Zero participant.
- Missing reasons.
- First/revote summary.
- Private recap scope.
- Export permissions.
- Retention expiry.

### Tugallanish sharti

- End sessiondan keyin report raw public leaderboardga bog‘liq emas.

---

## C5-02. Event Replay va teacher reflection

### Natija

Camera/video yozuvsiz event timeline replay va private teacher reflection ishlaydi.

### Fayllar

```text
services/cast/replay-service.js
services/cast/event-store.js
views/cast/replay.ejs
public/js/cast-replay.js
```

### Bajarish

1. Replay input sifatida session snapshot + ordered eventlarni ishlatish.
2. Reducer bilan har revisiondagi safe state’ni tiklash.
3. Teacher Replay, Student Recap va Institution Audit projectionlarini alohida qilish.
4. Teacher Replay’da config, aggregate distribution, action, network va misconception markerlarini ko‘rsatish.
5. Student Replay’da faqat own response va approved feedback ko‘rsatish.
6. Withdrawn/redacted contentni current redaction policy bilan ko‘rsatish.
7. Deleted raw data uchun placeholder yoki event-only marker ishlatish.
8. Event schema migration registry yaratish.
9. Golden replay fixturelar saqlash.
10. Teacher reflection promptlarini private note sifatida saqlash.
11. Reflection note’ni performance evaluationga yubormaslik.
12. Recording capabilityni alohida feature flag va alohida data policyga qoldirish.
13. Default replayda camera/mic permission so‘ramaslik.

### Teacher reflection fieldlari

```text
Surprise question
Evidence changed after action
Item to revise
Next lesson action
Timer/network/accessibility impact
```

### Tekshiruv

- Full replay determinism.
- Old schema migration.
- Deleted content.
- Withdrawn content.
- Student cross-access.
- No camera permission.

### Tugallanish sharti

- Bir session eventlari same final state’ni qayta yaratadi.

---

## C5-03. Psychometric-safe metrics va comparison guard

### Natija

Report denominator, missing status, evidence limit va config compatibility bilan ishlaydi.

### Fayllar

```text
services/cast/metrics-service.js
services/cast/comparison-service.js
public/js/cast-results.js
```

### Bajarish

1. Har percent bilan numerator va denominator qaytarish.
2. Decimal percentni UI’da integer yoki policy rounding bilan ko‘rsatish.
3. Wrong, no-response, late-join, disconnected, technical-failure va abstainni alohida saqlash.
4. Small sample threshold ostida item discrimination ko‘rsatmaslik.
5. `INSUFFICIENT_EVIDENCE` statusini metricga qo‘shish.
6. Optional Wilson intervalni aggregate reportga qo‘shish.
7. Leaderboard pointsni mastery fieldidan ajratish.
8. Cast result exportini high-stakes grade exportdan ajratish.
9. Comparison uchun config fingerprintni tekshirish.
10. Same test version, timer, scoring, reveal, locale va delivery contextni solishtirish.
11. Incompatible bo‘lsa direct delta/rankni bloklash.
12. Compatible sessionlar uchun descriptive side-by-side berish.
13. Different test form uchun equating feature flagni off qilish.
14. Teacher/class ranking endpoint yaratmaslik.
15. Personal longitudinal progressda comparable content tag va coverage’ni tekshirish.
16. Tiny subgroup metricni suppress qilish.

### Contract

```json
{
  "metric": "accuracy",
  "numerator": 19,
  "denominator": 24,
  "percent": 79,
  "status": "VALID_DESCRIPTIVE",
  "interval": { "low": 59, "high": 91 }
}
```

Comparison:

```json
{
  "compatible": false,
  "differences": [
    "scoring.mode",
    "timer.defaultSeconds",
    "delivery"
  ],
  "allowedViews": ["SEPARATE_REPORTS"]
}
```

### Tekshiruv

- Every missing status.
- Small sample.
- Compatible fingerprint.
- Incompatible fingerprint.
- Different form.
- Tiny subgroup.
- Shared-device evidence.

### Tugallanish sharti

- Incompatible session uchun misleading direct rank/delta ko‘rsatilmaydi.

---

## C5-04. Analytics event pipeline

### Natija

Product/reliability analytics structured, PII-minimized eventlar bilan ishlaydi.

### Fayllar

```text
services/cast/analytics.js
services/cast/data-policy.js
services/cast/provider-registry.js
```

### Bajarish

1. Event taxonomy constantlarini yaratish.
2. Setup eventlari: opened, mode selected, setting changed, warning shown/resolved, validated, created.
3. Lobby eventlari: joined, rejoined, rejected, locked, removed, started.
4. Question eventlari: previewed, opened, ready, submitted, acknowledged, extended, paused, locked, revealed.
5. Pedagogic eventlar: confidence, discussion, revote, hint, reteach, transfer, misconception, quick prompt, redemption.
6. Recovery eventlari: disconnected, reconnect attempted, state recovered, snapshot loaded, pending answer retried, host takeover.
7. Event payloadga pseudonymous IDs va latency bucket berish.
8. Raw answer/open text, answer key, full name, email, accommodation va tokenlarni schema bilan rad etish.
9. Analytics event validationdan o‘tmasa drop + safe metric qilish.
10. Retention classni event bilan birga yozish.
11. Product metric dashboard: setup time, launch success, join latency, ACK p95, recovery, timeout, teacher action, revote gain, accessibility use.
12. Teacher ranking metric yaratmaslik.
13. Provider unavailable bo‘lsa live Castga ta’sir qilmasdan buffer/drop policy ishlatish.

### Tekshiruv

- Schema valid/invalid.
- PII fixture rejection.
- Answer key fixture rejection.
- Provider outage.
- Retention expiry.
- Event count dedupe.

### Tugallanish sharti

- Raw academic response telemetry pipelinega kirmaydi.

---

## C5-05. Performance budget va payload control

### Natija

Setup, lobby, question va Socket payloadlari belgilangan budget va update frequencyda ishlaydi.

### Fayllar

```text
services/cast/projections.js
public/js/cast-*.js
public/css/cast-*.css
scripts/cast-bundle-report.js
```

### Bajarish

1. Cast critical HTML/CSS/JS compressed budgetni CI’da o‘lchash.
2. Initial lobby critical asset uchun 250KB target warning qo‘yish.
3. Background asset uchun 300KB optimized target qo‘yish.
4. Theme thumbnail va media’ni lazy load qilish.
5. Participantga full test yubormaslik.
6. Faqat current public questionni yuborish.
7. Safe next-question prefetchni feature flag bilan ishlatish.
8. Socket max payload limitini serverda o‘rnatish.
9. Answer commandni minimal fieldlarda saqlash.
10. Director response countni 4–10Hz coalesce qilish.
11. Projector countni 2–4Hz coalesce qilish.
12. Distributionni question lockda snapshot qilib yuborish.
13. Leaderboardni batch hisoblash.
14. Timer DOMni 10fps yoki second-level update bilan render qilish.
15. Har tickda full DOM rebuild qilmaslik.
16. Long roster virtual list ishlatish.
17. Responsive media derivatives yaratish.
18. Media dimensions bilan layout shiftni kamaytirish.
19. Video autoplayni timer startdan ajratish.
20. Bundle/payload budget exceed bo‘lsa CI warning/fail policy qo‘llash.

### Tekshiruv

- Bundle report.
- Socket payload snapshot sizes.
- 100-participant render profiling.
- Timer long-task profiling.
- Media failure.
- Slow 3G simulation.

### Tugallanish sharti

- Har answer uchun all-participant broadcast qilinmaydi.
- Full session object participantga yuborilmaydi.

---

## C5-06. Multi-node va recovery-compatible realtime

### Natija

Tier L va undan yuqori uchun multiple Socket.IO node, shared adapter va durable state ishlaydi.

### Fayllar

```text
server.js
config/realtime.js
services/cast/session-store.js
services/cast/event-store.js
package.json
.env.example
```

### Bajarish

1. `REALTIME_MODE=single|redis_streams` config qo‘shish.
2. C5’da `redis`, `@socket.io/redis-streams-adapter`, `connect-redis` dependencylarini qo‘shish.
3. Express sessionni Redis storega o‘tkazish.
4. Socket.IO Redis Streams adapterini config orqali ulash.
5. Connection-state recovery capabilityni adapter mode bilan test qilish.
6. Long-polling yoqilgan bo‘lsa load balancer sticky session sozlash.
7. WebSocket-only mode bo‘lsa old browser/network fallback policy belgilash.
8. Session state, answers va eventsni process-local memorydan chiqarish.
9. Hot sessionni `sessionId` bo‘yicha room/shardga ajratish.
10. Server bootda active timer/session rehydration job yaratish.
11. Node graceful shutdownda new connectionni to‘xtatish va active socket drain qilish.
12. Nginx/LB timeoutni `pingInterval + pingTimeout`dan yuqori qilish.
13. File descriptor va OS connection limitlarini deployment configda sozlash.
14. Redis unavailable bo‘lsa new XXL session admissionni bloklash.
15. Active small session uchun documented degraded/safe-pause policy ishlatish.

### Contract

Environment:

```text
REALTIME_MODE=redis_streams
REDIS_URL=redis://...
SOCKET_RECOVERY_MAX_MS=120000
CAST_NODE_ID=node-01
CAST_MAX_TIER=XL
```

### Tekshiruv

- Two-node join.
- Sticky session.
- Cross-node room broadcast.
- Node kill.
- Redis restart/failover.
- Session-store continuity.
- Timer rehydrate.
- Recovery adapter support.

### Tugallanish sharti

- Node restart active session state/answersni yo‘qotmaydi.

---

## C5-07. Backpressure va degradation

### Natija

Saturation paytida answer/host command prioritetda qoladi; decorative update kamayadi.

### Fayllar

```text
services/cast/backpressure.js
socket/cast-handler.js
services/cast/analytics.js
public/js/cast-director.js
```

### Bajarish

1. Event priority enum yaratish:
   - P0 answer durability/ACK;
   - P0 safety/host command;
   - P1 state/recovery;
   - P2 aggregate counters;
   - P3 animation/reaction/analytics.
2. Queue depth va lag thresholdlar qo‘shish.
3. Threshold 1da aggregate refreshni sekinlashtirish.
4. Threshold 2da P3 eventlarni drop/coalesce qilish.
5. Threshold 3da new large-lobby admissionni queue qilish.
6. Accepted answerni drop qilmaslik.
7. DB write muvaffaqiyatsiz bo‘lsa ACK success qaytarmaslik.
8. Static leaderboard fallback yaratish.
9. Media prefetchni suspend qilish.
10. Teacherga simple degraded health indicator berish.
11. Ops’ga detailed alert yuborish.
12. Degradation start/end eventlarini safe audit qilish.

### Tekshiruv

- Queue saturation.
- Analytics outage.
- DB slow.
- Redis lag.
- P3 drop.
- Answer preservation.
- Admission control.

### Tugallanish sharti

- Degraded mode’da accepted-answer ground truth yo‘qolmaydi.

---

## C5-08. Observability, support bundle va runbook

### Natija

Live health dashboard, PII-safe logs, diagnostic bundle va incident runbooklar tayyor bo‘ladi.

### Fayllar

```text
services/cast/telemetry.js
services/cast/support-bundle.js
routes/cast.js
ops/runbooks/*.md
ops/dashboards/cast.json
```

### Bajarish

1. Metrics: connections, ACK p50/p95/p99, retries, duplicates, reconnect, recovery, revision drift, Redis lag, DB queue, event drops, projector stale, moderation age.
2. Structured log schema yaratish.
3. Log sanitizerda answer key, raw answer, open text, token, cookie, full URL, name/email va secretlarni redact qilish.
4. Trace/correlation IDni REST→Socket→store bo‘ylab olib yurish.
5. Teacher health statusni `Barqaror`, `Kechikish yuqori`, `Tiklanmoqda`ga map qilish.
6. Support bundle endpoint yaratish.
7. Bundlega config fingerprint, safe event summary, browser/device, latency, reconnect va failed request IDs qo‘shish.
8. Bundle preview va explicit submit qilish.
9. Bundle auto-expiry job qo‘shish.
10. Runbooklar yozish:
   - host disconnect;
   - all participants disconnect;
   - Redis outage;
   - DB failure;
   - ACK spike;
   - wrong reveal;
   - join raid;
   - moderation outage;
   - CDN outage;
   - region outage;
   - answer-key exposure;
   - personal-data incident;
   - rollback;
   - deletion failure.
11. SEV-0..SEV-3 classification yaratish.
12. Feature kill switchlar qo‘shish.
13. Synthetic Cast monitor join→answer→close→reveal flowini periodik bajarishi.

### Tekshiruv

- Log secret scan.
- Bundle secret scan.
- Synthetic monitor.
- Alert trigger.
- Bundle expiry.
- Runbook tabletop.
- Feature kill switch.

### Tugallanish sharti

- Support bundle raw response, answer key, token va roster olib yurmaydi.

---

## C5-09. Load-test va capacity certification

### Natija

Tier S, M, L, XL va XXL alohida test va report bilan sertifikatlanadi.

### Fayllar

```text
load/cast-socket-client.js
load/cast-scenarios.js
load/cast-k6.js
scripts/cast-load-report.js
ops/capacity/*.md
```

### Bajarish

1. Socket.IO-compatible load client yaratish.
2. Tierlar:
   - S 1–30;
   - M 31–100;
   - L 101–500;
   - XL 501–1 000;
   - XXL 1 001–10 000.
3. Gradual join scenario yozish.
4. 5-second join burst yozish.
5. Final 2-second answer burst yozish.
6. 10k uchun 5k answer command/s target scenario yozish.
7. ACK loss/retry scenario yozish.
8. 10% reconnect storm yozish.
9. Host pause/add-time/close race yozish.
10. Node kill va Redis failover yozish.
11. Slow DB yozish.
12. Projector refresh yozish.
13. Bitta hot event + 20 normal class scenario yozish.
14. 45–90 minute soak yozish.
15. Distributed generator ishlatish.
16. Generator CPU/network bottleneckni alohida o‘lchash.
17. Accepted answer countni generator ground truth bilan solishtirish.
18. p50/p95/p99, error, CPU, memory, Redis lag, DB lag va egress report qilish.
19. Har tier uchun certified max config saqlash.
20. Session create’da certified limitdan yuqorini rad/schedule qilish.

### Proposed release threshold

```text
S/M ACK p95    ≤ 500ms
L/XL ACK p95   ≤ 750ms
XXL ACK p95    ≤ 1000ms
S/M recovery   ≤ 3s
L/XL recovery  ≤ 5s
XXL recovery   ≤ 8s
Accepted loss  = 0
```

### Tekshiruv

- Har scenario repeatability.
- Ground truth.
- Node failover.
- No duplicate score.
- No answer key leak under load.
- Admission control.

### Tugallanish sharti

- Marketing/product capacity claim faqat signed capacity report bilan mos bo‘ladi.

---

## C5-10. Capacity va infrastructure cost modeli

### Natija

Har certified tier uchun compute, realtime, egress, storage, observability va support costi inputlardan hisoblanadi.

### Fayllar

```text
services/cast/cost-model.js
ops/capacity/cost-inputs.json
ops/capacity/cost-report.md
scripts/cast-cost-report.js
```

### Bajarish

1. Cloud/provider-independent cost input schema yaratish.
2. Node count, node-hour price va test durationni input qilish.
3. Peak concurrent connection va realtime provider rate’ni input qilish.
4. Average answer command/ACK/event payload byte’larini load testdan olish.
5. Egressni payload × recipient × frequency bo‘yicha hisoblash.
6. Answer, event log, replay, media va backup storage hajmini hisoblash.
7. Metrics/log/trace ingestion va retention hajmini hisoblash.
8. Scheduled event rehearsal va on-call support soatini alohida kiritish.
9. Tier S/M/L/XL/XXL uchun scenario report yaratish.
10. Full leaderboard per-answer broadcast kabi disabled anti-patternni baseline hisobiga kiritmaslik.
11. Projected va actual costni eventdan keyin solishtirish.
12. Cost regression thresholdni release reportga qo‘shish.
13. Provider narxlarini kodga hardcode qilmasdan input file orqali boshqarish.

### Contract

```json
{
  "tier": "XL",
  "peakConnections": 1000,
  "durationMinutes": 60,
  "nodeCount": 3,
  "nodeHourPrice": 0,
  "egressPricePerGb": 0,
  "storagePricePerGbMonth": 0,
  "observabilityPricePerGb": 0,
  "supportHours": 0,
  "supportHourlyCost": 0
}
```

Formula group:

```text
compute = nodeCount × nodeHours × nodeHourPrice
realtime = peakConnections × configuredRate
network = outboundBytes / 1GB × egressPricePerGb
storage = retainedBytes / 1GB × storagePricePerGbMonth
observability = telemetryBytes / 1GB × observabilityPricePerGb
support = supportHours × supportHourlyCost
total = compute + realtime + network + storage + observability + support
```

### Tekshiruv

- Zero-price fixture.
- Payload increase regression.
- Retention increase.
- Tier comparison.
- Actual/projected reconciliation.

### Tugallanish sharti

- Capacity release report measured payload va editable provider inputlari bilan cost beradi.

---

# Test va release execution

## T-01. Unit test katalogi

### Fayllar

```text
tests/unit/cast-config.test.js
tests/unit/cast-presets.test.js
tests/unit/cast-state-machine.test.js
tests/unit/cast-timer.test.js
tests/unit/cast-scoring.test.js
tests/unit/cast-randomization.test.js
tests/unit/cast-permissions.test.js
tests/unit/cast-hinge.test.js
tests/unit/cast-leaderboard.test.js
tests/unit/cast-duration.test.js
tests/unit/cast-metrics.test.js
```

### Bajarish

1. Har service pure functionlarini table-driven test qilish.
2. Boundary va invalid input fixturelar yaratish.
3. Golden config/preset/state/scoring snapshotlar yaratish.
4. Time testlarida fake clock ishlatish.
5. Randomization testlarida fixed seed ishlatish.
6. Authorizationda har role/action combinationni test qilish.
7. No answer-key projection testini snapshotga qo‘shish.
8. Coverage thresholdni core Cast services uchun belgilash.

### Tugallanish sharti

- G0/C1 pure core har commitda testdan o‘tadi.

---

## T-02. Integration test katalogi

### Fayllar

```text
tests/integration/cast-session-create.test.js
tests/integration/cast-answer.test.js
tests/integration/cast-recovery.test.js
tests/integration/cast-roles.test.js
tests/integration/cast-retention.test.js
tests/integration/cast-projections.test.js
```

### Bajarish

1. Test Firebase/local adapter fixture yaratish.
2. Session create full flow test qilish.
3. Answer transaction va duplicate race test qilish.
4. State revision conflict test qilish.
5. Socket session auth test qilish.
6. Projector/participant/Director projection boundary test qilish.
7. Disconnect persistence test qilish.
8. Retention/deletion test qilish.
9. Event replay final-state test qilish.
10. Multi-node test environmentni C5’da qo‘shish.

### Tugallanish sharti

- Critical persistence va authorization flow integration test bilan yopilgan.

---

## T-03. Playwright E2E

### Fayllar

```text
tests/e2e/cast-setup.spec.js
tests/e2e/cast-lobby.spec.js
tests/e2e/cast-answer.spec.js
tests/e2e/cast-director.spec.js
tests/e2e/cast-projector.spec.js
tests/e2e/cast-recovery.spec.js
tests/e2e/cast-accessibility.spec.js
tests/e2e/cast-moderation.spec.js
```

### Bajarish

1. Teacher login fixture yaratish.
2. Test create/seed fixture yaratish.
3. Setup Studio mode/config/session create test qilish.
4. Two participant join test qilish.
5. Start→think→answer→ACK→lock→reveal→next→end flowini test qilish.
6. Pause/add-time/close controlini test qilish.
7. Projector safe projectionni test qilish.
8. Lost connection va refresh recoveryni test qilish.
9. Co-host takeoverni test qilish.
10. Keyboard-only critical pathni test qilish.
11. Unmoderated text projector’da yo‘qligini test qilish.
12. Mobile 320px screenshot test qilish.
13. Projector 4:3/16:9 screenshot test qilish.
14. RTL screenshot/interaction testini C4’da qo‘shish.

### Tugallanish sharti

- Critical Cast flow real browserlarda avtomatik tugaydi.

---

## T-04. Security test

### Bajarish

1. HTML/JS/Socket answer-key scan.
2. Unauthorized role matrix.
3. CSRF test.
4. Join-code brute-force rate limit.
5. Answer replay.
6. Option ID manipulation.
7. Duplicate command.
8. Stale revision.
9. XSS nickname/open response.
10. Malicious SVG.
11. SSRF remote media policy.
12. Token query/referrer/log leak scan.
13. Projector privilege escalation.
14. Cross-tenant source/session access.
15. Log/support bundle secret scan.
16. Retention delete/restore test.

### Tugallanish sharti

- G0 blocker topilsa release to‘xtaydi.

---

## T-05. Accessibility test

### Bajarish

1. Automated accessibility scan.
2. Keyboard-only setup.
3. Keyboard-only Director.
4. Keyboard-only participant answer.
5. NVDA + Chrome smoke.
6. VoiceOver + Safari smoke.
7. 200% zoom.
8. 320px viewport.
9. Reduced motion.
10. No motion.
11. High contrast.
12. Audio off.
13. Color-independent answer/reveal.
14. QR-free join.
15. Long timer accommodation.
16. RTL screen reader smoke.

### Tugallanish sharti

- Join→answer→ACK→reveal critical flow assistive technology bilan bajariladi.

---

## T-06. Real-class field pilot

### Bosqichlar

```text
F0 internal 5–10
F1 volunteer 10–15
F2 real class 20–35
F3 lecture 80–150
F4 institution 300–500
F5 scheduled 1 000
F6 certified 10 000
```

### Bajarish

1. Har bosqich uchun approved test va preset tayyorlash.
2. 3m, 8m, 15m projector viewing test qilish.
3. Bright/dim room test qilish.
4. 720p/1080p, 4:3/16:9 test qilish.
5. Weak Wi-Fi cornerni sinash.
6. Low-end Android va iPhone Safari’ni sinash.
7. Teacher one-hand remote flowini sinash.
8. Screen-reader participantni sinash.
9. Audio-off va reduced-motionni sinash.
10. Setup time, join completion, ACK success, coverage, recovery va unplanned stopni o‘lchash.
11. Teacher cognitive load va control-state tushunishini yig‘ish.
12. Student pressure/fairness feedbackini yig‘ish.
13. Har pilotdan keyin severity triage qilish.
14. Stop criterion bo‘lsa sessionni to‘xtatish.
15. Keyingi tierga faqat signed field report bilan o‘tish.

### Stop criteria

```text
answer-key exposure
accepted-answer loss
wrong correct-answer reveal
unmoderated harmful projector content
host ownership failure
critical accessibility failure
privacy/consent scope breach
```

### Tugallanish sharti

- F3siz classroom GA yo‘q.
- F5/F6siz 1k/10k claim yo‘q.

---

# Release roadmap

## Release C1 — Safe Cast Core

### Bajarish tartibi

1. G0-01 module split.
2. G0-02 answer-key separation.
3. G0-03 ownership/snapshot.
4. G0-04 stable IDs.
5. G0-05 answer time/idempotency.
6. G0-06 Socket auth/roles.
7. G0-07 CSRF.
8. C1-02 config schema.
9. C1-03 presets.
10. C1-04 preflight.
11. C1-05 session create.
12. C1-06 store.
13. C1-07 state machine.
14. C1-08 timer.
15. C1-09 scoring.
16. C1-10 randomization.
17. C1-11 command/ACK.
18. C2 Setup Studio.
19. C2 Lobby/Participant/Director/Projector.
20. Core accessibility.
21. Unit/integration/e2e/security tests.
22. F0–F2 pilot.

### C1 production gate

```text
answer key public emas
client time authority emas
accepted answer idempotent
server state revisioned
config POST validated
Accuracy default
leaderboard privacy ishlaydi
pause/add-time/close/reveal ishlaydi
reconnect state tiklanadi
critical accessibility flow ishlaydi
```

---

## Release C2 — Responsive Teaching

### Bajarish tartibi

1. Teacher-private evidence.
2. Hinge engine.
3. Vote–Discuss–Revote.
4. Confidence Lens.
5. Misconception Map.
6. Quick Prompt.
7. Think-Time Gate.
8. Transfer/Redemption.
9. Class Goal.
10. Confusion Signal.
11. Post-Cast Action Pack.
12. F2–F3 pilot.

---

## Release C3 — Collaboration va Inclusion

### Bajarish tartibi

1. Team Challenge.
2. Co-host/Remote.
3. Shared-device.
4. Hybrid/Low-bandwidth.
5. Question Wall moderation.
6. Institution governance.
7. `uz-Latn`, `uz-Cyrl`, `ru`, `en`.
8. RTL foundation.
9. Data lifecycle jobs.
10. F3–F4 pilot.

---

## Release C4 — Advanced Reasoning

### Bajarish tartibi

1. Reasoning Capture.
2. POE flow.
3. Open-response clustering.
4. Student Question Forge.
5. Choreography Composer.
6. Event Replay.
7. Personal Progress.
8. Cast Quality Lab.

### Open-response clustering implementation

1. Raw textni private storeda saqlash.
2. PII/moderationdan o‘tmagan textni providerga yubormaslik.
3. Approved/de-identified textni embedding adapterga yuborish.
4. Suggested clusterlarni teacherga private ko‘rsatish.
5. Teacher merge/split/rename/confirm qilishi.
6. Projector’ga faqat confirmed cluster label va approved exemplar yuborish.
7. Provider outage’da manual tag/board fallback ishlatish.
8. Auto score va final grade chiqarmaslik.

### Student Question Forge implementation

1. Student draftni private moderation queuega yozish.
2. Question, answer, explanation va source fieldlarini validate qilish.
3. Duplicate/similar question flagini teacherga ko‘rsatish.
4. Teacher approve/edit/reject qilishi.
5. Approved itemni Quick Prompt sifatida launch qilish.
6. Library save’ni alohida teacher action qilish.
7. Student draftni avtomatik public qilmaslik.

---

## Release C5 — Scale va AI Shadow

### Bajarish tartibi

1. Redis session store.
2. Redis Streams adapter.
3. Multi-node.
4. Backpressure.
5. Observability.
6. Load certification.
7. Incident drills.
8. AI Co-host shadow.
9. F4–F6 certification.

### AI Co-host shadow implementation

1. Rule engine outputini baseline sifatida saqlash.
2. LLM adapterga faqat aggregate/de-identified structured input berish.
3. Outputni strict suggestion schema bilan parse qilish.
4. Provider timeout/cost cap qo‘llash.
5. Suggestionni Director’da shadow yoki recommendation card ko‘rsatish.
6. Teacher accept/dismiss eventini yig‘ish.
7. AIga live command tool bermaslik.
8. Answer reveal, score change, punishment, final grade, misconduct, session end actionlarini taqiqlash.
9. Suggestion correctness, false interruption, acceptance, subgroup effect, latency va costni baholash.
10. Shadow evaluation gate’dan keyingina suggestion mode’ga o‘tish.

---

# Final default session config

```json
{
  "schemaVersion": 2,
  "preset": {
    "id": "responsive_accuracy",
    "version": 1,
    "customized": false
  },
  "pace": "instructor",
  "playback": {
    "advanceMode": "host_controlled",
    "closeTrigger": "host_or_soft_timeout",
    "thinkSeconds": 5,
    "minimumOpenSeconds": 3
  },
  "timer": {
    "mode": "soft",
    "defaultSeconds": 30,
    "allowHostExtend": true,
    "maxExtensionsPerQuestion": 3
  },
  "scoring": {
    "mode": "accuracy",
    "version": "score_v2",
    "correctBase": 1000,
    "speedBonusMax": 0,
    "wrongPoints": 0,
    "tieBreak": "same_rank_then_stable_display"
  },
  "leaderboard": {
    "visibility": "off_during_learning",
    "finalVisibility": "top_n",
    "topN": 5,
    "frequency": "end_only",
    "anonymizeLowRanks": true,
    "showExactScore": false
  },
  "feedback": {
    "correctness": "teacher_controlled",
    "correctAnswer": "teacher_controlled",
    "explanation": "teacher_controlled",
    "responseDistribution": "teacher_private_first"
  },
  "join": {
    "identity": "safe_alias",
    "allowLateJoin": true,
    "lateJoinPolicy": "next_question",
    "lateJoinUntilQuestion": 3,
    "lockLobbyOnStart": true,
    "maxPlayers": 100
  },
  "presentation": {
    "themeId": "focus_dark",
    "motion": "reduced",
    "lobbyMusic": "off",
    "questionMusic": "off",
    "soundEffects": "low"
  },
  "responsiveTeaching": {
    "hingeRecommendations": true,
    "confidencePolicy": "strategic_items",
    "peerInstructionAvailable": true,
    "firstVoteDistribution": "teacher_private",
    "misconceptionMap": true,
    "reasoningCapture": "selected_items",
    "confusionSignal": true,
    "quickPrompt": true
  },
  "moderation": {
    "publicChat": false,
    "directMessages": false,
    "openTextVisibility": "host_review_first",
    "questionWall": "moderated",
    "publicIdentity": "safe_alias"
  },
  "accessibility": {
    "showQuestionOnDevice": true,
    "highContrastAvailable": true,
    "reducedMotionDefault": true,
    "audioHasVisualEquivalent": true,
    "keyboardDirector": true,
    "screenReaderStatus": true
  },
  "postCast": {
    "actionPack": true,
    "eventReplay": true,
    "studentPrivateRecap": true,
    "teacherReflection": true
  },
  "ai": {
    "cohostMode": "off",
    "mayExecuteLiveActions": false,
    "teacherApprovalRequired": true
  }
}
```

---

# Yakuniy launch checklist

## Security

- [ ] Answer key HTML’da yo‘q.
- [ ] Answer key participant Socket payloadida yo‘q.
- [ ] Answer key projector payloadida yo‘q.
- [ ] Client time scoring authority emas.
- [ ] Answer overwrite bloklangan.
- [ ] Duplicate answer idempotent.
- [ ] Host Socket authenticated.
- [ ] Projector read-only.
- [ ] CSRF Cast REST write’larda ishlaydi.
- [ ] Cross-tenant access bloklangan.

## Realtime

- [ ] State revisioned.
- [ ] Timer server-authoritative.
- [ ] Pause/resume/add-time exact ishlaydi.
- [ ] Stale timer no-op.
- [ ] Stale command rejection ishlaydi.
- [ ] Lost ACK retry duplicate score bermaydi.
- [ ] Reconnect snapshot ishlaydi.
- [ ] Host disconnect recovery ishlaydi.
- [ ] Co-host fencing ishlaydi.

## UX

- [ ] Responsive Accuracy default.
- [ ] Setup Studio accessible.
- [ ] Preflight blocker/warning ishlaydi.
- [ ] Estimated duration chiqadi.
- [ ] Lobby lock/late join ishlaydi.
- [ ] Participant ACK states aniq.
- [ ] Director controls phasega mos.
- [ ] Projector private data olmaydi.
- [ ] Leaderboard low ranksni yashiradi.
- [ ] Theme/audio/motion preference ishlaydi.

## Responsive teaching

- [ ] Teacher-private evidence ishlaydi.
- [ ] Hinge recommendation teacher authority bilan ishlaydi.
- [ ] First vote immutable.
- [ ] Revote alohida.
- [ ] Confidence private.
- [ ] Misconception teacher-confirmed.
- [ ] Quick Prompt source testni o‘zgartirmaydi.
- [ ] Reasoning moderated.
- [ ] Transfer/redemption leaderboarddan alohida.
- [ ] Action Pack yaratiladi.

## Inclusion va privacy

- [ ] Keyboard critical flow ishlaydi.
- [ ] Screen-reader critical flow ishlaydi.
- [ ] Reduced motion ishlaydi.
- [ ] Audio-off flow ishlaydi.
- [ ] QR alternatives bor.
- [ ] Shared response individual deb yozilmaydi.
- [ ] Hybrid speed default off.
- [ ] Unmoderated text public emas.
- [ ] Retention job ishlaydi.
- [ ] Deletion restore testidan o‘tgan.

## Scale va operations

- [ ] Certified tier load testdan o‘tgan.
- [ ] Accepted-answer loss `0`.
- [ ] Backpressure P0 answerlarni saqlaydi.
- [ ] Metrics va alerts ishlaydi.
- [ ] Logs PII/secret saqlamaydi.
- [ ] Support bundle safe.
- [ ] Runbook tabletop o‘tkazilgan.
- [ ] Backup/restore drill o‘tkazilgan.
- [ ] Field pilot signed report bilan yopilgan.
- [ ] Capacity claim certified tierga mos.
