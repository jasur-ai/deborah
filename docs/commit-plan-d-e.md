# Edikit — D+E faza Commit rejasi (F-01)

**Sana:** 2026-08-18 · **Hajm:** ~670 fayl (540 yangi + 128 o'zgartirilgan)
**Precondition:** test:auth 487/487 (58 fayl) + tsc 0 + db tegsiz — yashil
**Operator ruxsati kutilmoqda** — bu reja ruxsat bo'lgach darhol bajarish uchun.

---

## 1. Commit guruhlari (mantiqiy tartibda)

Har bir commit mustaqil yashil bo'lishi shart emas (butun faza bitta yaxlit ish),
lekin guruhlar review uchun tushunarli bo'ladi.

| # | Commit nomi | Qamrov | Taxminiy fayl |
|---|---|---|---|
| C1 | `feat(auth): D-faza auth yadro modullari` | `src/modules/auth/*` (session, mfa, oidc, lockout, risk, password-policy, ...) | ~45 |
| C2 | `feat(auth): D-faza route'lar` | `routes/auth.js` + yangi route'lar (mfa, session, reset, consent, privacy, ...) | ~20 |
| C3 | `feat(auth): D-faza UI` | `views/user`, `views/admin`, `public/js` (auth/register/mfa/settings) | ~70 |
| C4 | `feat(auth): D-faza testlar` | `tests/auth/**`, `tests/unit/auth-*`, `tests/integration/auth-*` | ~200 |
| C5 | `feat(auth): privacy + legal + DSAR` | consent, dsar, dpia, legal views, purge | ~40 |
| C6 | `feat(auth): ops + security` | incident, deploy runbook, CI, redis-service, audit | ~50 |
| C7 | `feat(hemis): HEMIS + roster integratsiya` | routes/hemis*, src/modules/hemis, roster | ~15 |
| C8 | `feat(auth): E-01 OneID + E-04 OIDC` | identity.js, oidc rotation/multi-provider, user-schema | ~10 |
| C9 | `feat(auth): E-02 HEMIS webhook` | hemis/webhook.js, routes/hemis-webhook.js | ~5 |
| C10 | `feat(push): E-03 FCM + E-05 passkey` | student/push, fcm, passkey routes + UI | ~15 |
| C11 | `feat(kms): E-06 cloud KMS` | kms-provider.js + kms.js o'zgarishi | ~5 |
| C12 | `feat(email): E-07 budget + D-32` | email/budget.js, email-cost UI, routes | ~10 |
| C13 | `chore(scripts): check + build scriptlar` | scripts/check-*, build-*, migrate-* | ~60 |
| C14 | `feat(cast): cast + design modullar` | cast, services, design-audit, locales | ~50 |
| C15 | `docs: acceptance + handover + roadmap` | docs/*.md (acceptance-auth, roadmap-e/f, operator-summary) | ~15 |

## 2. Bajarish qoidalari

1. **Har bir commit oldidan:** `npm run test:auth` yashil bo'lishi talab emas (faza yaxlit),
   lekin C15 (docs) dan keyin yakuniy `test:auth` + `tsc` + `test:security:auth` run qilinadi.
2. **db.json** — HECH QACHON commit qilinmaydi (LOCAL_DB_FILE, .gitignore).
3. **node_modules, .env, bot_data, data/** — .gitignore'da, commit qilinmaydi.
4. **Secret'lar** — hech qanday token/parol commit qilinmaydi (pre-commit secret scan).
5. **Nopok fayllar** — `tmp-handler.js`, `admin-debug.test.js`, `~$*.docx` kabi vaqtinchalik
   fayllar commit'dan chiqariladi (agar loyihaga tegishli bo'lmasa).

## 3. Yakuniy tekshiruv (commit'lardan keyin)

```bash
npm run test:auth        # 487/487 (58 fayl)
npm run typecheck        # 0 xato
npm run test:security:auth  # 47+ xato yo'q
git status               # faqat db.json/data/ teksiz qoladi
```

## 4. Status

- [ ] Operator ruxsati
- [ ] C1..C15 commit'lar
- [ ] Yakuniy tekshiruv + push (operator bilan)

---
*Reja `docs/roadmap-f-faza.md` F-01 vazifasi uchun. Bajarish operator ruxsatidan keyin.*
