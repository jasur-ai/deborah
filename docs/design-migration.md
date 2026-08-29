# Design Migration & Rollout (STEP 40)

> **Maqsad:** Design system sahifama-sahifa migratsiya qilinadi; har bosqich
> rollback qilinadi; redesign "big-bang" riskisiz production'ga kiradi.
>
> **Joriy holat:** ✅ Redesign tayyor (STEP 1–39), feature flag infratuzilmasi
> qo'shildi, legacy usage baseline qayd etildi.

---

## 1. Migration order (S40.01)

Quyidagi tartib **lock** qilingan — o'zgartirish faqat design review + approval
bilan:

| # | Kontekst | Status | Feature flag | O'chirish release |
|---|----------|--------|--------------|-------------------|
| 1 | Tokens/theme | ✅ DONE (S05–09) | `theme` | — |
| 2 | Components (base kit) | ✅ DONE (S12–18) | `theme` | — |
| 3 | Landing | ✅ DONE (S21–25) | `landing` | — |
| 4 | Auth (login/register/forgot) | ✅ DONE (S24) | `auth` | — |
| 5 | Workspace/builder | ✅ DONE (S26–28) | `workspace` | — |
| 6 | Cast (director/participant/projector) | ✅ DONE (S29–32) | `cast` | — |
| 7 | Admin panellari | ✅ DONE (S33–35) | `admin` | — |
| 8 | Legacy cleanup (S40.12) | ⏳ alohida release | — | Next major |

> **Qoida:** Bir PR'da foundation **va** barcha pages rewrite qilinmaydi.
> Har bir slice: component/page + visual baseline bilan kichik PR (S40.04).

## 2. Feature flags (S40.02, S40.07)

`utils/feature-flags.js` — 6 mustaqil kontekst flag'i:

| Flag | Context | Nima boshqaradi |
|------|---------|-----------------|
| `DEBORAH_FF_THEME` | theme | Design tokens/semantic palette |
| `DEBORAH_FF_LANDING` | landing | Public landing sahifasi |
| `DEBORAH_FF_AUTH` | auth | Login/register/forgot |
| `DEBORAH_FF_WORKSPACE` | workspace | User panel / test builder |
| `DEBORAH_FF_CAST` | cast | Cast director/participant/projector |
| `DEBORAH_FF_ADMIN` | admin | Admin dashboard/panellari |

**Manbalar (priority):** query (`?ff_cast=0`, faqat non-prod) → env → cookie →
default ON.

**Session-stable (S40.02):** `theme` va `cast` — cookie bilan biriktiriladi.
**Active Cast session o'rtasida visual shell almashtirilmaydi** — session
boshlanganda flag yopiladi va session davomida o'zgarmaydi.

**Rollout pattern:**
```
DEBORAH_FF_CAST=0  →  tanlangan test ishlab chiqarishga (query/cookie)
                  →  1% foydalanuvchi (infra)
                  →  5% → 25% → 50% → 100%
                  →  flag'ni olib tashlash (cleanup release)
```

## 3. Legacy variable aliases (S40.03)

- Legacy aliases (`--accent`, `--bg`, `--text`, `--muted`, `--card`, `--surf`,
  `--border`, `--gold`, `--green` va h.k.) semantic token'larga **alias**
  sifatida tokens.css'da saqlanadi (F1 — compatibility).
- `scripts/legacy-usage.js` har release'da usage inventory'ni hisoblaydi va
  `design-audit/legacy-usage.json` trend'ini yangilaydi.
- **Baseline (STEP 40):** 1375 legacy usage (CSS 328 + views inline 1047).
- Har release'da bu raqam **kamayishi** kerak; ko'paysa — CI warning (regression).
- **Final major cleanup:** barcha legacy aliases + inline style'lar olib
  tashlanadi (S40.12) — alohida release.

## 4. Per-PR quality gates (S40.05)

Har PR (migration slice'lar uchun) quyidagilardan o'tishi shart:

| Gate | Buyruq | Fail hard |
|------|--------|-----------|
| Template compile | `node scripts/check-views.js` | ✅ |
| HTTP smoke | `node scripts/smoke-test.js` | ✅ |
| Design lint | `npm run design:lint` | ✅ |
| Perf budget | `npm run perf:budget` | ✅ |
| Visual baseline | `npm run test:visual` | ✅ |
| Axe a11y | `npm run test:a11y` | ✅ |
| Unit/integration | `npm run test:ci` | ✅ |

CI: `.github/workflows/design.yml` + `design:check:full` (S37/38 gate'lar).

## 5. Rollout sequence (S40.06)

```
1. Internal dogfood      — butun jamoa 2 hafta (bug report yo'li ochiq)
2. 5 teacher pilot       — 1 hafta, haftalik feedback sessiya
3. 3–5 class pilot       — real sinovlar, task success o'lchanadi (S39)
4. Percentage rollout    — 1% → 5% → 25% → 50% → 100% (DEBORAH_FF_*)
5. Observation window    — har bosqichda ≥ 3 kun monitoring
```

Har bosqichda o'tish mezoni: `design-migration.md` §7 rollback criterion'larning
hech biri trigger bo'lmasligi.

## 6. Monitoring dashboard (S40.08)

Rollout paytida kuzatiladigan metrikalar:

| Metrika | Manba | Threshold |
|---------|-------|-----------|
| Error rate | observability routes | < 0.5% (old bilan taqqos) |
| Bounce rate (landing) | analytics | +5pp dan oshmasin |
| Task success | research/analyze (S39) | ≥ baseline |
| Support tickets | support pipeline | trend up bo'lmasin |
| Theme usage | analytics event | default theme qabul qilingan |
| CWV (LCP/INP/CLS) | performance-budget (S38) | LCP≤2.5s, INP≤200ms, CLS≤0.1 |

## 7. Rollback criteria (S40.09)

Quyidagilardan **bittasi** trigger bo'lsa — kontekst flag'i OFF qilinadi
(env o'zgarishi, deploy talab qilmaydi):

1. **HTTP/render failure** — 5xx ≥ 1% yoki sahifa render xatosi
2. **Answer-flow regression** — javob qabul qilish/jonli natija buzilishi
3. **A11y P0** — axe critical violation yoki klaviatura blokirovkasi
4. **Performance threshold** — LCP/INP target'dan 2x oshish
5. **Severe teacher confusion** — 2+ teacher bir xil UX muammosi haqida xabar

Rollback: `DEBORAH_FF_<CTX>=0` → legacy visual shell (agar mavjud bo'lsa) yoki
oldingi deploy versiyasi. Rollback 15 daqiqada amalga oshirilishi kerak.

## 8. SW/cache compatibility (S40.10)

- Service worker `CACHE_VERSION` har deploy'da yangilanadi (`v2.x.x-hash`).
- **Old/new deployment orasida:** precache ro'yxatidagi assetlar ikkala
  versiyada ham mavjud bo'lishi shart (`perf:budget` S38.10 tekshiradi).
- Screenshot regression: visual gate har PR'da yangi design'ni baseline bilan
  solishtiradi.
- Offline fayl (`/offline`) va minimal fallback HTML har ikkala versiyada ham
  bir xil xizmat qiladi.

## 9. Deprecation changelog (S40.11)

Har release'da yangilanadi:

### v2.1.0 (STEP 40)
- 🆕 Feature flag tizimi (`utils/feature-flags.js`) — 6 kontekst
- 📊 Legacy usage baseline: 1375 (CSS 328 + views 1047)
- 📄 Migration docs (bu fayl)
- Deprecated: `var(--accent)` → `var(--deborah-semantic-color-action-primary)`
  (davom etmoqda — cleanup release'da tugaydi)

## 10. Cleanup release (S40.12)

Rollout 100% bo'lgach — alohida major release:

1. Barcha `DEBORAH_FF_*` env'lar va flag kodlarini olib tashlash
2. `public/css/style.css` legacy bloklarini (accent palitra override'lar) o'chirish
3. Legacy alias'lar (S40.03 ro'yxati) semantic token'lardan ajratish
4. View'lardagi inline `var(--legacy)` → semantic token'ga ko'chirish (1047 ta)
5. `design-audit/legacy-usage.json` trend'da **0** ga yetkazish
6. Ushbu fayldagi "cleanup release" bo'limini o'chirish

---

## Status

- [x] S40.01 Migration order lock
- [x] S40.02 Feature flags (utils/feature-flags.js + server.js middleware)
- [x] S40.03 Legacy aliases + usage inventory (scripts/legacy-usage.js)
- [x] S40.04 Per-slice PR qoidasi (hujjat)
- [x] S40.05 Per-PR quality gates (design:check + workflow)
- [x] S40.06 Rollout sequence (hujjat)
- [x] S40.07 Independent rollout (6 flag)
- [x] S40.08 Monitoring dashboard (metrika ro'yxati)
- [x] S40.09 Rollback criteria (5 trigger)
- [x] S40.10 SW/cache compatibility (perf:budget S38.10)
- [x] S40.11 Deprecation changelog (bu fayl §9)
- [ ] S40.12 Cleanup release (rollout 100% dan keyin)
