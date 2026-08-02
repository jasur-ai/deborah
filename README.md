# Edikit

**Real-time multiplayer quiz platform → full exam management system (Node.js Edition)**

Edikit — jonli viktorina (Kahoot/Quizizz uslubidagi) o'yinlaridan tortib, universitet darajasidagi to'liq imtihon boshqaruv tizimigacha o'sgan ta'lim texnologiyalari (EdTech) platformasi. O'zbek tilidagi bozor uchun mo'ljallangan.

## ✨ Imkoniyatlar

### 🎮 Asosiy o'yin
- Real-time multiplayer quiz (Socket.io) — host / enter / arena
- Mavzu va kartoon qahramonlar (emoji) tanlash
- Jonli reyting va natijalar

### 🧑‍🏫 Imtihon boshqaruvi
- **Assessment builder**: competency, item bank, rubric, QTI import/export
- **Attempt lifecycle**: preflight, attempt lease, response, offline journal, safe submit
- **Proctoring**: kamera evidence, SEB, security profiles, proctor events
- **Qog'oz imtihonlar**: paper packet, scan/OMR, answer-key reconciliation
- **Baholash**: mark schemes, grade rules, AI grading, board ratification, special consideration
- **AI yordamchi**: AI question generation, MLOps, Claude adapter, resource recommendation

### 🏛️ Institut darajasi
- Tenant/RBAC/RLS, akademik struktura, roster, accommodation
- Kalendar, publish, brief/policy, command center, exam seating
- Program quality, credentials, multilingual (Uzbek Latin/Cyrillic), accessibility (WCAG 2.2 AA)
- Data governance, HEMIS/OneID adapter, external integrations (Canva, Google Slides, Gamma)

### 🔒 Xavfsizlik va ishonchlilik
- ASVS 4.0, threat model, AI red-team
- OpenTelemetry observability (metrics, SLO, alerts)
- Reliability: peak load, chaos, backup/DR, release safety
- Final migration, institutional pilot, procurement pack (HECVAT/ACR/DPA/SLA/exit)
- System acceptance va handover (release sign-off, next-version backlog)

## 🚀 Ishga tushirish

```bash
# Talablar: Node.js >= 18

npm install          # Bog'liqliklarni o'rnatish
npm run seed         # Demo ma'lumotlarni yaratish
npm start            # http://localhost:3000
```

### Tezkor ishga tushirish

```bash
npm run dev    # --watch rejimida
npm run mock   # Mock server
```

## 🧪 Testlar

```bash
npm run typecheck         # TypeScript 0 xato
npm run test:unit         # Unit testlar
npm run test:integration  # Integration testlar
npm run test:ci           # Barcha vitest testlari
npm run test:security     # XSS security suite
npm run test:reliability  # Reliability + load/chaos/backup drills
npm run test:gate0        # Release gate-0 verifikasiyasi
npm run verify:all        # To'liq release verifikasiyasi (typecheck + barcha testlar + drills + sign-off)
```

**Hozirgi holat**: 3000+ test yashil (unit 2039, integration 527, e2e 434), XSS 60/60, 0 TypeScript xato.

## 📁 Arxitektura

| Papka | Maqsad |
|-------|--------|
| `server.js` | Express + Socket.io asosiy server (`createApp()` test factory) |
| `routes/` | 61+ API/bet route handleri |
| `src/modules/` | Feature modullar (biznes logika: schema/service/index) |
| `middleware/` | Auth, CSRF, origin, roles, socket identity, rate limiting, telemetry |
| `views/` | EJS shablonlar (admin/user/role/game) |
| `migrations/` | PostgreSQL migratsiyalar (Kysely) |
| `firebase/` | Lokal JSON DB emulyatsiyasi (`local-db.js`) |
| `socket/` | Socket.io o'yin handleri |
| `tests/` | unit / integration / e2e testlar |
| `scripts/` | CI, security, reliability, migration skriptlari |
| `.github/workflows/` | GitHub Actions CI |

### Asosiy texnologiyalar

Express 4 · Socket.io 4 · EJS · PostgreSQL (Kysely) · Firebase-admin (lokal) · Redis (session) · Zod · Argon2 · Helmet · Pino · Vitest · TypeScript

## 🏗️ Rivojlanish holati

`implementation-status.md` — butun rivojlanish tarixi (Prompt 11–73, har bir bosqich STATUS + test sonlari bilan).

- **Prompt 71** — Reliability: peak load, chaos, backup/DR, release safety ✅
- **Prompt 72** — Final migration, institutional pilot, procurement pack ✅
- **Prompt 73** — Final system acceptance va handover (CHECKPOINT — yakuniy) ✅

Yakuniy checkpoint: **release sign-off tayyor**, barcha 8 domain sign-off, next-version backlog shakllangan.

## 📄 Hujjatlar

- `ARCHITECTURE.md` — arxitektura qarorlari
- `implementation-status.md` — bosqichma-bosqich holat
- `reports/sbom.json` — Software Bill of Materials
- `style.md` — kod uslubi

## 📄 Litsenziya

Tijoriy / xususiy loyiha.
