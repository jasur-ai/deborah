# Deborah Design Audit — Baseline (STEP 01)

> **STEP 01 — Repository baseline, backup va scope lock**
> Sana: 2026-08-06 | Tuzuvchi: Buffy (implementation agent)

## S01.01 — Repository holati

| Item | Qiymat |
|------|--------|
| **Git HEAD** | `93d1c5ff328db9ae9ba9fef1098cef7bc2bd8e6e` |
| **Reja'dagi base commit** | `5447052` (`huh major ones`) — HEAD undan keyingi commitlar bilan farqlanadi |
| **Git status** | 155 ta o'zgargan/untracked fayl (work in progress — Cast + Landing + auth qayta qurish yakunlangan) |
| **Node** | `v24.14.1` |
| **npm** | `11.11.0` |
| **Branch** | `main` |

### Git status taqsimoti

```text
Modified:   data/db.json, firebase/*.js, middleware/*.js, routes/*.js, server.js,
            socket/*.js, utils/*.js, views/**/*.ejs, public/**/*.{css,js},
            package.json, package-lock.json, implementation-status.md
Untracked:  routes/*.js (40+), middleware/*.js, services/*, src/modules/*,
            tests/**/*.test.js, views/admin/*.ejs (30+), scripts/*.js,
            ops/*, .github/*
```

> **Izoh:** Repo ish holatida — so'nggi 3 reja (Cast, Landing, plan_login §4-§5) kodlari
> push qilinmagan holda local'da turibdi. STEP 01 baseline'ini olish uchun bu holat
> qayd etildi; hech narsa commit qilinmadi.

## S01.02 — Dependency holati

- **`npm ls --depth=0`** — barcha top-level dependency'lar instal' qilingan, xato yo'q.
  Muhimlari: `express`, `socket.io`, `vitest@4.1.10`, `typescript@7.0.2`,
  `xlsx@0.18.5`, `zod@4.4.3`, `argon2` (auth hash).
- **`npm audit --omit=dev`** — vulnerability summary bor; bu stepda dependency
  versiyalari **o'zgartirilmadi** (reja S01.02 qoidasi).

### Test skriptlar

```text
test:ci         → vitest run (to'liq suite)
test:unit       → vitest run tests/unit
test:integration→ vitest run tests/integration
test:vip        → node scripts/test-vip-browser.js
test:security   → security scripts (xss/fuzz)
```

## S01.03 — Test holati (test-before)

To'liq `npm test` natijasi `design-audit/test-before.txt` da saqlanadi (keyingi bosqich).
Hozirgi ma'lum natijalar (so'nggi verifikatsiya):

| Suit | Natija |
|------|--------|
| Auth integration (login/register/forgot/reset) | 22/22 ✅ |
| Landing integration | 12/12 ✅ |
| Auth-adjacent regression (security/oidc/http/gate-0/role-shell) | 92/92 ✅ |
| Cast unit+integration (C5-12 da) | 1682/1682 ✅ |

> **Izoh:** `npm test` to'liq suite uzoq (cast suite 600s+). To'liq baseline
> yig'ish uchun `test-before.txt` ga `timeout 900 npm test` natijasi keyingi
> audit bosqichida yoziladi.

## Final Design Authority (S01.06)

- **Manba:** `style.md` (3972 qator, 11 bo'lim + A1–A10 animatsiya ilovalari)
- **Ustunlik qoidasi:** STEP 11–46 bo'limlar (rang, tipografiya, layout, component,
  motion) oldingi rang draftlaridan ustun. Xususan:
  - §4 Ranglar palitrasi (4.2 Deborah tavsiya palitra)
  - §5 Tipografiya (5.1 font stack, 5.2 scale, 5.3 weights)
  - §6 Layout & Grid (6.1 breakpoints, 6.2 patternlar)
  - §7 Card & Component (7.1–7.5)
  - §8 Animatsiya & mikro-interaksiya (8.1 timing, 8.2 core)
  - §11 Deborah Style Guide (11.1–11.5: tokens, spacing, shadow, z-index)
  - A1–A10 animatsiya ilovalari (10×10 variatsiya)
- **Ushbu hujjat:** `implementation-status.md` oxirida design rejalar ketma-ketligi
  qayd etiladi.

## Scope Lock (S01.07)

UI redesign scope (ushbu master plan doirasida):

1. **Landing** — plan_index ✅ (allaqachon qayta qurildi, landing.css/landing.js)
2. **Auth** — login/register/forgot/reset ✅ (plan_login §4-§5 qayta qurildi, auth.js)
3. **Workspace (teacher)** — F4 (STEP 25-27)
4. **Builder** — F4 (STEP 27)
5. **Cast** — F5 (STEP 28-32) — Cast backend tayyor (C1-C5), visual qatlam kutilmoqda
6. **Admin** — F6 (STEP 33)
7. **Error/PWA** — F6 (STEP 34)
8. **Content/localization/RTL** — F6 (STEP 35)

Backend functional redesign **aloohida scope** (bu master plan kod yozmaydi — faqat UI).
