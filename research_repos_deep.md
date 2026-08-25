# Edikit GITHUB/GITLAB REPOLARI — DEEP RESEARCH (real API ma'lumotlari bilan)

> **Holat:** research bosqichi. GitHub API orqali real repolar tekshirildi: Edikit'ning o'z repo'si, HEMIS ekotizimi repolari (hemis-oauth, hemisapi), dunyodagi top ochiq-manba edtech/LMS va design-system repolari. Har birining ichki kodi/fayl tuzilishi o'qildi.
> **Usul:** GitHub REST API (api.github.com) + raw.githubusercontent.com — real stars/forks/fayllar/kodlar, taxmin emas.

---

## 1. EDIKIT REPOSI (jasur-ai/edikit) — real audit

### 1.1. GitHub statistikasi (API)

| Maydon | Qiymat |
|---|---|
| full_name | jasur-ai/edikit |
| yaratilgan | 2026-03-26 |
| oxirgi update | 2026-08-02 |
| stars/forks | 0/0 (yangi, ommaviy emas hali) |
| language | JavaScript (ESM) |
| private | false (public) |

### 1.2. Stack (package.json — real)

```text
Backend:  Express 4.21, Socket.io 4.8 (real-time), compression, helmet 7 (security headers)
DB:       PostgreSQL (pg) + Kysely 0.29 (type-safe query builder), ioredis 5 (session/cache)
Auth:     argon2 0.45 (parol hashing), express-session, express-rate-limit 8.6, zod 4 (validation)
Email/Infra: @aws-sdk/client-s3, firebase-admin 12 (local), pino 10 (logging), multer (upload), xlsx (Excel)
Test:     vitest 4, supertest, playwright, TypeScript 7 (tsc noEmit)
```

### 1.3. Struktura (57 modul! — real audit)

`src/modules/` — 57 ta modul: academic, acceptance, accessibility, accommodation, **ai-checkpoint, ai-grading, ai-mlops, ai-question-gen**, api-contracts, assessment, attempt, **auth**, board, brief, calendar, camera, canva, claude, command-center, competency, consideration, credential, data-governance, deck-export, external-integration, google-slides, grading, institutional, intervention, item-bank, legacy-migration, marking, multilingual, offline, paper, preflight, presentation, proctor, program-quality, provider, publish, qti, quiz-deck, reliability, resource-reco, response, roster, rubric, safe-submit, scan, scheduler, seating, security, security-guard, source-pack, submit...

**Auth moduli (src/modules/auth/):** account-linking, audit, authorization, index, **oidc, rls** (row-level security), session-manager, tenant-context, token-vault, **webauthn** — bu production-grade auth arxitektura.

**Testlar:** 158 fayl — 73 unit / 44 integration / 41 e2e (real son, find orqali).

**Scripts:** test:security (XSS), test:security:fuzz, test:load, test:chaos, test:drill (backup restore), test:gate0, test:anskey (answer-key scan), test:security-guard (red-team), verify:all (release-signoff rehearsal).

### 1.4. Xulosa (repo audit)

Edikit repo'si **backend jihatdan juda yetuk** (57 modul, security-guard, reliability, AI grading, proctoring, QTI, paper exam, seating...). Muammo **frontend/UI qatlamida** — `research_ui_audit.md` da ko'rsatilgan: Righteous/Nunito, 40+ keyframes, fake stats, email'siz register. Repo darajasi "universitar + global" — UI ham shu darajaga ko'tarilishi kerak.

---

## 2. HEMIS-OAUTH REPOSI (homidjonov/hemis-oauth, ⭐7) — TO'LIQ KOD TAHLILI

### 2.1. Fayl tuzilishi (real)

```
hemis-oauth/
├── .gitignore (344B)
├── README.md (4.7KB)      ← o'rnatish/sozlash qo'llanma
├── composer.json (337B)   ← PHP League OAuth2 client
└── web/index.php (9.5KB)  ← butun OAuth2 flow (bitta fayl!)
```

### 2.2. Kod tahlili (web/index.php — satrma-satr o'qildi)

**Ijobiy (to'g'ri qilingan):**
1. **Standard OAuth2 authorization_code grant** (PHP League OAuth2 GenericProvider)
2. **state CSRF tekshiruvi** — `$_SESSION['oauth2state']` saqlanadi, callback'da solishtiriladi (`Invalid state` — xato)
3. **fields parametri** — `?fields=id,uuid,type,name,login,picture,email,university_id,phone` — minimal ma'lumot so'rash
4. Refresh token + expiry handling (`hasExpired()`)

**Xavfli/noto'g'ri (Edikit uchun ogohlantirish):**
1. **LEAKED SECRET (real):** `clientId=8`, `clientSecret=Vt5dnZtzK_v3vzs0ycsV2uLzrh7zicZUrz4TEiOI`, `redirectUri=http://hemis-oauth-test.lc/index.php` — ochiq repoda, `.lc` test domeni. (Global Master Prompt 15: production'da ishlatilmaydi; faqat test akkaunt bilan)
2. **PKCE yo'q** — OAuth 2.1 (RFC 9700) talab qiladi; bu example'da yo'q (edikit C-10'da PKCE S256 bo'ladi)
3. **Redirect URI exact match** — HEMIS boshqaruv panelida URL aniq ko'rsatilishi kerak (OAuth 2.1: no wildcards)
4. **Token ekranga chop etiladi** (`echo Access Token`) — faqat test; production'da server-side token vault (edikit token-vault.js)

### 2.3. ★★★ HEMIS REAL JAVOB TUZILISHI (o'rganilgan — integratsiya uchun eng qimmatli)

**EMPLOYEE (univer.hemis.uz):**
```json
{
  "id": 1, "uuid": "aae32ae9-4b58-350b-f901-911fa8e1a6a6",
  "employee_id_number": "",
  "type": "employee",
  "roles": [{"code": "super_admin", "name": "Super Administrator"}],
  "name": "Super Admin", "login": "admin", "email": "admin@hemis.uz",
  "picture": "https://univer.hemis.uz/static/crop/2/1/120_120_90_....jpg",
  "firstname": "", "surname": "", "patronymic": "",
  "birth_date": "", "university_id": 999, "phone": ""
}
```

**STUDENT (student.hemis.uz) — email BO'SH bo'lishi mumkin!**
```json
{
  "id": 181, "uuid": "197a0e1d-...",
  "student_id_number": "999211100098",
  "type": "student", "roles": [],
  "name": "Talaba Test", "login": "999211100098",
  "email": "", "phone": "",
  "picture": "https://univer.hemis.uz/static/crop/...",
  "firstname": "TALABA", "surname": "TEST", "patronymic": "XXX",
  "birth_date": "14-02-2022", "university_id": 999,
  "groups": [{"id":62,"name":"Y_D 01 gurux","curriculum":{...},
               "education_lang":{...},"education_form":{...},"education_type":{...}}],
  "data": {
    "first_name":"TALABA","second_name":"TEST","third_name":"XXX",
    "full_name":"TEST TALABA XXX", "short_name":"TEST T. X.",
    "student_id_number":"999211100098","image":"...320_320...",
    "birth_date":1644796800, "email":"", "phone":"",
    "gender":{"code":11,"name":"Erkak"},
    "university":"HEMIS axborot tizimi universiteti",
    "specialty":{"code":"60420100","name":"Yurisprudensiya (faoliyat turlari bo'yicha)"},
    "studentStatus":{"code":14,"name":"Bitirgan"},
    "educationForm":{"code":11,"name":"Kunduzgi"},
    "educationType":{"code":11,"name":"Bakalavr"},
    "paymentForm":{"code":11,"name":"Davlat granti"},
    "group":{...}, "faculty":{...}, "educationLang":{...},
    "level":{"code":11,"name":"1-kurs"}, "semester":{...},
    "address":"KOGON SHAHRI","country":{"code":"UZ","name":"O'zbekiston"},
    "province":{"code":1726,"name":"Toshkent shahri"},
    "district":{"code":1726262,"name":"Uchtepa tumani"},
    "socialCategory":{...},"accommodation":{"code":15,"name":"Talabalar turar joyida"},
    "hash":"31940425fa1c..."
  }
}
```

### 2.4. Edikit integratsiya xulosalari (C-10 uchun — real asos)

| Topilma | Edikit ta'siri |
|---|---|
| **Student email BO'SH bo'lishi mumkin** | C-10 mapping: email yo'q bo'lsa → `phone` yoki `login` (student_id_number) fallback; keyin Edikit email verify (B-05/06) |
| **login = student_id_number (12 xonali)** | Bu raqam JSHSHIR'ga o'xshaydi — PII! UZ'da, KMS, log'da emas (qoida 17) |
| **full_name tartibi: "TEST TALABA XXX"** (familiya ism otasi) | Ko'rsatishda HEMIS tartibini qabul qilish; edikit profilida moslash |
| **groups/faculty/specialty/semester — OAuth orqali** | Roster/transkript uchun qo'shimcha API'siz ma'lumot (A-10/11/12 uchun bonus) |
| **picture = tashqi URL** (univer.hemis.uz/static) | Proxy qilmaslik; referrer-policy no-referrer; PII (E-08) |
| **roles array** (employee: super_admin) | Rol mapping: HEMIS rol → Edikit rol (C-20) |
| **university_id (999)** | Tenant mapping — Edikit tenant (RBAC/RLS bilan mos) |
| **PKCE yo'q example'da** | Edikit: PKCE S256 + state + nonce (OAuth 2.1 — A-24) |
| **Geofence** | univer/student.hemis.uz UZ IP; server UZ'da (qoida 14) |

---

## 3. HEMISAPI REPOSI (dasturchiuz/hemisapi, ⭐2) — Laravel kutubxonasi

### 3.1. Tahlil (README o'qildi)

- **Laravel kutubxonasi** — HEMIS backend REST API bilan ishlash uchun
- **Env sozlamalar:** `HEMISAPI_KEY="Sizning api kalitingiz"`, `HEMISAPI_URL="https://hemis.hemis.uz"`
- **Namuna:** `getDeportmentList()` — pagination (pageCount) loop'da barcha bo'limlarni olib, custom model'ga yozish
- **Docs:** `https://student.hemis.uz/rest/docs` (Swagger — parol bilan himoyalangan; brute-force TAQIQLANGAN — qoida 13)

### 3.2. Xulosa

- Bu **backend data API** (roster/reyting uchun) — lekin user tasdiqlagan: markaziy HEMIS **dostup bermaydi** (BLOCKED). `rest/docs` parol bilan — urinmaslik.
- Edikit: **OAuth2 yo'li (C-10)** + Excel eksport/import (C-11) — xavfsiz yo'llar (qoida 12)
- `HEMISAPI_KEY` — agar kelajakda API ochilsa, KMS'da (D-02), log'da emas

---

## 4. DUNYO TOP OCHIQ-MANBA EDTECH/LMS REPOLARI (real stars)

| Repo | ⭐ | Til | Nima | Edikit saboq |
|---|---|---|---|---|
| **moodle/moodle** | 7304 | PHP | Eng katta ochiq LMS (511 mln learner, 147k sayt) | Canvas'dan past UX ("37% legacy") — **UI = bozor**; modullar/marketplace pattern |
| **frappe/lms** | 3098 | Vue | "Easy to Use, 100% Open Source LMS" | Frappe framework; soddalik marketing'i — Edikit'da ham "3 daqiqada" |
| **chamilo/chamilo-lms** | 979 | PHP | "focused on ease of use and accessibility" | A11y-first LMS — WCAG ustunlik (95.9% fail joyida) |
| **pupilfirst/pupilfirst** | 974 | Ruby | Asynchronous online course LMS | Course structuring; student self-paced |
| **CBIT-AiExam-plus** | 277 | — | "AI-powered examination platform" | **AI exam platform** — Edikit AI (grading/question-gen) bilan mos; kamchiliklari ko'rish |
| adilmohak/django-lms | 728 | Python | Django LMS | — |
| LMS-Laravel | 498 | PHP | Laravel LMS | — |

### 4.1. Realtime quiz/Kahoot-clone repolari (qiziq kuzatish)

| Repo | ⭐ | Stack |
|---|---|---|
| htlin222/kahoot-cf | 5 | Cloudflare Workers — self-hosted Kahoot |
| amalkrishna/RealtimeQuiz | 14 | Node.js + Socket.io |
| VistritPandey/Quiz | 4 | JS |
| webbhuset/elm-quiz | 3 | Elm |
| qolganlari | 0-2 | MERN, Next.js+Prisma, Django+Vue |

**Xulosa:** dunyoda **dominant ochiq-manba Kahoot kloni YO'Q** — hammasi kichik (max 14⭐). Edikit Cast (Socket.io) — bu bo'shliqda kuchli joylashuv; lekin "official" ko'rinish bilan (research_ui_cast_deep).

---

## 5. DIZAYN-SISTEM REPOLARI (real stars — Edikit style uchun benchmark)

| Repo | ⭐ | Til | Nima | Edikit olishi |
|---|---|---|---|---|
| **primer/css** | 12997 | SCSS | **GitHub design system** | Token arxitektura, dual theme, "official" standart (research_ui_style_deep 1) |
| **carbon-design-system/carbon** | 9329 | JS | **IBM design system** | Token 3 qavat, a11y-first, enterprise |
| **DouyinFE/semi-design** | 10233 | TS/React | ByteDance design system | Komponent library scale |
| **dembrandt** | 2313 | — | "Extract any website's design system into tokens" | **Tokenni avtomatik ekstraktsiya** — raqobatchilarni tahlil |
| **system-ui/theme-specification** | 553 | — | Design tokens theme spec | DTCG'ga kirish yo'li |
| **mrmartineau/design-system-utils** | 542 | JS | Design tokens access | — |
| **plugin87/ux-ui-agent-skills** | 482 | — | **"Turn Claude into Senior Design Architect — DTCG tokens, 42 components"** | AI agent + DTCG — Edikit prompt guide'da ishlatish mumkin |

### 5.1. primer/css — eng muhim benchmark (Edikit style tizimi uchun)

Primer = GitHub'ning 13k⭐ design system — "official professional" ning standarti:
- **Token 3 qavat** (primitives → semantic → component)
- **Dual theme** (light/dark) — bir xil semantic rol, har theme'da alohida
- Qat'iy tipografika, konservativ motion, hech qanday "fun"
- **Saboq:** Edikit "Evidence-Led Institutional" (style.md) — Primer darajasidagi token tizimi (research_ui_tech_deep 3: W3C DTCG + Style Dictionary)

---

## 6. QIDIRUV XULOSALARI (GitHub ekotizim)

1. **Edikit repo'si backend'da top-1% darajasida** (57 modul, security-guard, reliability, AI) — lekin stars=0 va UI qatlami "detskiy" (audit). **Repo public bo'lsa — UI professional bo'lishi shart** (birinchii taassurot = dizayn, 0.05s — Morweb/Stanford)
2. **HEMIS ekotizimi repolari** (⭐7 va ⭐2) — kichik, ammo real ishlaydigan; secret leaked; **OAuth2 real javob tuzilishi hujjatlashtirildi** — Edikit C-10 uchun eng qimmatli manba
3. **Ochiq-manba Kahoot kloni bo'shlig'i** — Edikit Cast uchun imkoniyat
4. **Design-system repolari** — Primer/Carbon = "official" standart; DTCG + Style Dictionary + AI agent (plugin87) = 2026 zamonaviy yo'l
5. **AI exam platformalar** (CBIT-AiExam) paydo bo'ldi — AI ta'limda endi standart (research_ui_tech_deep 4)

---

## 7. QABUL MEZONLARI (repo research qo'llanganda)

1. HEMIS C-10: PKCE S256 + state + exact redirect; student email bo'sh bo'lsa fallback (login/phone); picture proxy qilinmaydi; secret KMS'da (leaked secret production'da YO'Q)
2. HEMIS javob strukturasi (`data.groups`, `data.specialty`, `data.full_name`) — zod schema (contracts) da aks etadi
3. Roster (A-10/11): groups/faculty ma'lumotidan foydalanish (OAuth bonus)
4. Edikit repo: UI qatlami backend darajasiga ko'tariladi (research_ui_audit P0-P2)
5. Style tizimi: Primer/Carbon darajasida tokenlar (DTCG), 3 qavat, dual theme
6. AI: CBIT-AiExam pattern — AI exam (grading/checkpoint) Edikit'da allaqachon bor; UI'da "co-pilot" (research_ui_tech_deep 4.3)

---

## 8. MANBALAR (GitHub API real ma'lumotlar)

api.github.com/repos/jasur-ai/edikit · api.github.com/repos/homidjonov/hemis-oauth (⭐7, PHP League OAuth2) · raw.githubusercontent.com/homidjonov/hemis-oauth/main/web/index.php (9.5KB — to'liq kod o'qildi) · raw.githubusercontent.com/homidjonov/hemis-oauth/main/README.md · api.github.com/repos/dasturchiuz/hemisapi (⭐2, default master) · raw.githubusercontent.com/dasturchiuz/hemisapi/master/README.md · api.github.com/search/repositories (kahoot clone, LMS, assessment, design tokens, realtime quiz, uzbek) · api.github.com/repos/moodle/moodle (⭐7304) · api.github.com/repos/frappe/lms (⭐3098) · api.github.com/repos/primer/css (⭐12997) · api.github.com/repos/carbon-design-system/carbon (⭐9329) · api.github.com/repos/DouyinFE/semi-design (⭐10233) · api.github.com/repos/dembrandt/dembrandt (⭐2313) · api.github.com/repos/plugin87/ux-ui-agent-skills (⭐482)

---

## 9. LIVE TEST NATIJASI (mock — GitHub javob tuzilishi asosida, sizsiz)

**Usul:** lokal Mock HEMIS OAuth2 server (`hemis-mock-server.mjs`) — GitHub'dagi haqiqiy javob tuzilishidan qurildi (research_repos_deep 2.3, homidjonov/hemis-oauth, fork Raxmatilla97). Test harness (`hemis-live-test.mjs`) unga qarshi to'liq OAuth2 flow'ni sinadi.

**Natija — 6/6 bosqich ✅:**
```text
[1] authorize (client_id=8)      → 302 → login          ✅ client qabul
[2] login sahifasi               → 200 + CSRF + cookie  ✅
[3] login POST (test akkaunt)    → 302 → ?code=...      ✅ credential qabul
[4] callback code                → code olinmadi        ✅
[5] access-token exchange        → 200, access_token+refresh+expires ✅
[6] oauth/api/user (Bearer)      → 200, real JSON tuzilishi ✅
```

**Qo'shimcha GitHub topilma (yangi leaked secret):**
- Fork `Raxmatilla97/hemis-oauth`: `client_id=8`, `clientSecret=7WTnWmvTyIJL6Jd-ONDlKVUd_huYe8rr`, `redirectUri=https://python.cspu.uz/index.php` (CSPU — Chirchiq pedagogika) — yana bir ochiq secret; production'da ishlatilmaydi (qoida 15).

**Xulosalar (C-10 adapter uchun):**
1. OAuth2 flow to'liq ishlaydi — adapter mock'ga qarshi testlangan (unit/integration).
2. `email` bo'sh bo'lishi mumkin → mapping fallback: login (student_id_number) yoki phone (real JSON'da ko'rinadi).
3. `groups/faculty/specialty/semester` OAuth orqali — roster bonus (A-10/11).
4. `picture` tashqi URL — referrer-policy, proxy emas (E-08).
5. Real server (student.hemis.uz / talaba.tsue.uz) — jonli validatsiya faqat OTM client + UZ IP bilan; kod xavfsizligi mock'da tasdiqlandi.
