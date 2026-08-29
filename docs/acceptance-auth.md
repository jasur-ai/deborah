# AUTH — Final Acceptance (D-27 FINAL CHECKPOINT)

**Sana:** 2026-08-17
**Precondition:** D-00..D-26 yashil; A/B/C fazalar yashil ✅
**Qoida (§18):** bironta critical/high finding accepted-risk qilib yashirilmaydi — STOP (§27).

---

## 0. Umumiy regression yig'indisi (§08)

| Suite | Natija | Izoh |
|---|---|---|
| `npm run test:auth` | **377/377 PASS** (48 fayl) | D-14..D-31 + D-21/22/23/26/32 drill'lar: unit + integration + security (auth faza) |
| `tests/unit` | **4639/4639 PASS** (221 fayl) | Butun unit suite (A/B/C/D) |
| `tests/integration` (register ishlatuvchi 66 fayl) | **448/448 PASS** | Auth integration (child server + supertest) |
| `npm run test:security:auth` | **51/51 PASS** (7 fayl) | D-18 security + F-d: XSS-scan E-faza UI qamrov (17/17) + 3 REAL fix (passkey stored XSS, account-settings esc, scan) |
| `tsc --noEmit` | **0 xato** | TypeScript toza |
| `test:security:ci` (F-d) | **ALL GATES PASS** | SAST 0/0 critical + SCA 0 + SECRETS 0 + SBOM 48; 4 REAL fix (passkey stored XSS, account-settings esc, roster spawnSync, security-ci path) |
| Load (§09, D-19) | **PASS** (4 profil) | `npm run test:load:auth` — SLO loginP95<2000ms, errorRate<0.1%, falseLockouts=0 |

---

## 1. A faza — Core auth (checklist)

| Item | Dalil | Holat |
|---|---|---|
| Login/register/session | `tests/integration/auth-a01..a31` + `tests/auth/unit/password-core/session-core/token-core/mfa-core` | ✅ |
| Password policy (NIST: min 15, max 128, complexity SHALL NOT) | `password-core.test.js` 11/11 + `auth-a22` | ✅ |
| Argon2id + dummy hash timing (enumeration yo'q) | `password-core` + `auth-a03` (jitter) | ✅ |
| Lockout (5 xato, jitter, permanent blok) | `auth-a03`, `lockout-c02`, `password-core` | ✅ |
| Session (idle 30d, absolute 12h, rotation, revoke) | `session-core` 12/12, `auth-a25`, `session-invalidation-b25` | ✅ |
| Remember-me (selector/verifier, httpOnly) | `session-core`, `security-cookies` 11/11 | ✅ |
| MFA/TOTP (valid_window=1, backup single-use, challenge consume) | `mfa-core` 11/11, `auth-a26`, `journey-mfa-passkey` | ✅ |
| CSRF (barcha state-changing POST) | `security-guards` 5/5, `security-cookies` | ✅ |
| Reauth (sensitive amallar) | `auth-a25`, `dsar-idor`, `consent-api` | ✅ |
| Enumeration himoyasi (bir xil javob, timing) | `auth-a06`, `password-core` (dummy hash) | ✅ |

## 2. B faza — Register / email (checklist)

| Item | Dalil | Holat |
|---|---|---|
| Register validatsiya (Zod, username/email/parol/invite) | `register-core` 21/21 + 4 consent, `auth-b01..b09` | ✅ |
| Honeypot (B-08 silent bot) | `register-core`, `auth-b08` | ✅ |
| Full-width normalize + reserved (B-04) | `register-core`, `username-b04` | ✅ |
| Email verify round-trip (kod hash, single-use) | `email-verify-a18`, `journey-email-session` | ✅ |
| Email template 4 til + XSS | `email-core` 7/7, `auth-a23` | ✅ |
| Invite (token 48B, status machine, replay) | `invite-core` 10/10, `auth-a11`, `invites-b11/b12/b13` | ✅ |
| Consent (D-24 majburiy checkbox + D-25 purpose log) | `consent` 9/9 + `consent-v2` 8/8 + `consent-api` 4/4 | ✅ |
| Teacher approval (pending→approve, role_version) | `teacher-core`, `teacher-app-b29`, `journey-teacher-hemis` | ✅ |

## 3. C faza — Risk / admin / integration (checklist)

| Item | Dalil | Holat |
|---|---|---|
| Risk-based auth (tiers, device fingerprint, step-up) | `auth-a28`, `risk-c04/c05`, `device-c03` | ✅ |
| Credential stuffing / OTP bombing (Redis) | `abuse-c06`, `rate-limit-c01` | ✅ |
| Admin auth (allowlist, MFA mandatory, IP) | `admin-auth-c07`, `auth-a30` | ✅ |
| HEMIS / roster integration (staging, commit, idempotency) | `hemis-c10`, `auth-a11`, `journey-teacher-hemis` | ✅ |
| Data governance / purge (C-14) | `purge-c14`, `data-governance` | ✅ |
| PII minimal (ip_hash, fingerprint hash, geo) | `pii-inventory` 10/10 (D-22: raw IP session'da yo'q + verify consent), `auth-a09` | ✅ |

## 4. D faza — Infra / frontend / test / ops / legal (checklist)

| Item | Dalil | Holat |
|---|---|---|
| Test framework (D-14: mock-providers, flaky policy) | `tests/auth/` 34 fayl, `FLAKY-POLICY.md` | ✅ |
| E2E critical journey (D-17 wsl) | `journey-mfa-passkey` 3/3, `journey-teacher-hemis` 2/2, `journey-email-session` 3/3 | ✅ |
| CI (D-20 auth.yml 7 stage) | `.github/workflows/auth.yml` + `tests/auth/CI.md` | ✅ |
| Load SLO (D-19) | `auth-load-slo` 8/8 + CLI 4 profil | ✅ |
| Deploy runbook + drill (D-21) | `docs/runbooks/auth-deploy.md`, `deploy-runbook` 6/6, `deploy-drill-d21` 5/5 | ✅ |
| DSAR (D-23 export/correct/delete/restrict) | `dsar-user` 11/11 + `dsar-idor` 6/6 + `dsar-ui-d23` 5/5 + settings.ejs UI | ✅ |
| Legal docs 4 til (D-24) | `legal-docs` 11/11 | ✅ |
| DPIA (D-25) | `dpia` 5/5 | ✅ |
| Incident response (D-26 append-only + drill) | `incident` 10/10 + `auth-incident.md` + `incident-drill-d26` 8/8 | ✅ |
| A11y (§13 — axe 0, keyboard, screen reader) | `axe-scan-d12` 5/5, `a11y-d12` (wsl final) | ✅* |
| i18n 4 til (§14) | `auth-i18n-completeness` 7/7 + D-11 merge (wsl final) | ✅* |
| Ops drill (§12 — deploy/rollback/incident/backup) | D-21/26 runbook'lar + `deploy-drill-d21` 5/5 + `incident-drill-d26` 8/8 | ✅ |
| Email detail (D-32 failover + cost) | `email-d32` 10/10 + `email-cost-d32` 3/3 + /admin/email-cost dashboard | ✅ |
| Redis session detail (D-31 merge) | `session-redis-d31` 7/7 + `redis-d31` 9/9 — sorted-set Lua atomic (A-02), revoke pub/sub cross-node, /health degrade | ✅ |
| Sign-off (§17) | Quyidagi jadval — operator to'ldiradi | ⏳ |

*✅ = testlar yashil; wsl final drill natijalari qo'shiladi.

---

## 5. Security (§10)

| Scan | Natija |
|---|---|
| Secret scan (hardcoded secret yo'q — auth JS) | ✅ `security-xss-scan` 13/13 |
| PII scan (parol log'da yo'q) | ✅ `security-xss-scan` + `pii-inventory` |
| Pen-test review | ✅ `security-session-mfa` 4/4 + `security-escalation` 5/5 + e2e auth 6/6 |

## 6. Legal (§11)

| Item | Dalil |
|---|---|
| DPIA | ✅ `dpia.js` (PII/risk×mitigation/retention/DSAR/review) |
| Consent | ✅ `consent.js` (purpose log, version, revoke) |
| DSAR | ✅ `dsar-user.js` + `/api/privacy/dsar/*` |
| Retention | ✅ DPIA retention jadvali + session 30d/12h |
| UZ data law | ✅ Privacy policy 4 til (§ D-24) |

## 7. Sign-off (§17) — operator to'ldiradi

| Rol | Imzo | Sana |
|---|---|---|
| Security | | |
| Privacy | | |
| Legal | | |
| Ops | | |
| Product | | |

### Agent imzolari (implementatsiya dalillari — operator imzosidan oldin)

| Agent | Imzo | Sana | Qamrov dalillari |
|---|---|---|---|
| 🔵 ps | ✅ | 2026-08-17 | D-07..D-32 ps qismlari — test:auth 377/377 (48 fayl) + unit 4639/4639 + integration 448/448 + security 47/47 + tsc 0 |
| 🟢 wsl | ✅ | 2026-08-17 | D-07 login JS, D-08 passkey frontend, D-09 settings, D-10 admin copy, D-11 BCP-47 11 EJS, D-12 skip-link, D-13 PWA, D-14 e2e (4/4) + register name fix, D-15 TOTP window fix, D-16 core 26/26, D-17 journey 8/8, D-18 e2e+security 11/11 + 2 REAL bug fix (mfa.js require crash, register consent checkbox), D-23 DSAR UI+SLA C-23 5/5, D-24 legal sahifalar 8/8, D-25 consent UI 4/4, D-29 client validation 10/10 + contracts.js drift fix, D-31 Redis merge 7/7 + regression 30/30 |
| 🔵 ps | ✅ (E-faza) | 2026-08-18 | E-04 OIDC (rotation 9/9 + multi-provider 6/6) + E-01 OneID (identity-e01 21/21) + E-02 HEMIS webhook (hemis-webhook-e02 19/19) — test:auth 490/490 (58 fayl) + tsc 0 |
| 🟢 wsl | ✅ (E-faza) | 2026-08-18 | E-05 Passkey rename (webauthn 24/24 + e05 int 4/4 + regression 37/37), E-03 FCM push (fcm-e03 16/16 + dsar 13/13 + e03 int 4/4 + regression 55/55 + REAL fix tokenKey sha256), E-06 Cloud KMS (kms-e06 11/11 + regression 49/49 + production boot smoke 200), E-07 Email budget (budget-e07 11/11 + email-budget-e07 int 5/5 + regression 29/29) — test:auth 486/486 (58 fayl) + tsc 0 + db tegsiz |

## 8. Next-version backlog (§30) — E-fazada bajarildi (2026-08-18)

- ~~P3: OneID (yagona identifikatsiya)~~ → ✅ **E-01** (canonical oneid_sub + migration)
- ~~P3: HEMIS data sync (to'liq, push orqali)~~ → ✅ **E-02** (push webhook + retry)
- ~~P3: Push notifications to'liq (B-23 kontekstual opt-in ustida)~~ → ✅ **E-03** (FCM device-token)

**Yangi P3 takliflar (F-faza, roadmap-f-faza.md):**
- P3: Multi-provider OIDC (E-04 registry ustida — Microsoft/GitHub provider'lar)
- P3: OneID federatsiya (identity/{oneid} → tashqi sistemalar bilan exchange)
- P3: HEMIS push ga pull-fallback (webhook down → davriy pull)
- P3: Email budget — multi-provider xarajat taqsimoti hisoboti

## 9. E faza — Skalalash / identifikatsiya (roadmap-e-faza.md) [DONE 7/7]

| E-x | Vazifa | Holat | Dalil |
|---|---|---|---|
| E-04 | OIDC qo'shimchalari (key rotation + multi-provider) | ✅ ps | oidc-rotation-e04 9/9 + oidc-multiprovider-e04 6/6 (test:auth 392/392) |
| E-01 | OneID (identifikatsiya modeli + migration) | ✅ ps | identity-e01 21/21 + account-linking 20/20 + user-schema-b01 15/15 (test:auth 417/417) |
| E-05 | Passkey multi-device (rename) | ✅ wsl | webauthn unit 24/24 (rename 4) + passkey-rename-e05 int 4/4 + regression 37/37 |
| E-03 | Push notifications (FCM device-token) | ✅ wsl | fcm-e03 16/16 + dsar-user 13/13 + push-device-e03 int 4/4 + regression 55/55; **REAL bug fix: tokenKey sha256 (safeKey collision)** |
| E-06 | Cloud KMS adapter (kms-provider v2) | ✅ wsl | kms-e06 11/11 + regression 49/49 (kms-d02, mfa-totp-a26, totp-window) |
| E-02 | HEMIS push sync | ✅ ps | hemis-webhook-e02 19/19 (HMAC-SHA256 timing-safe + IP allowlist + idempotency + retry 1m/5m/15m + deadletter) + HEMIS regression 33/33 + roster 102/102 |
| E-07 | Email budget dashboard (P2) | ✅ wsl | budget-e07 unit 11/11 (dynamic alert 80%/100% idempotent + monthly CSV report + config UI) + email-budget-e07 int 5/5 (CSV download + budget POST valid/invalid + warn banner) + regression 29/29 (email-d32 + email-cost-d32) + tsc 0 |

### E faza umumiy regression (wsl checkpoint 2026-08-18)

| Suite | Natija | Izoh |
|---|---|---|
| `npm run test:auth` | **490/490 PASS** (58 fayl) | E-04/E-01/E-02 (ps) + E-05/E-03/E-06/E-07 (wsl) + F-d XSS qamrov yangi testlar bilan |
| `tsc --noEmit` | **0 xato** | — |

---
*D-27 FINAL CHECKPOINT — ikkala agent imzosi ✅ (22:5x). D-29 MERGE ✅ (22:14) — validation-rules.js single source + GET /api/auth/validation-rules + auth-validation.js (aria-invalid) + contracts-d29 7/7 + validation-d29 3/3. D-31 wsl DONE ✅ (22:5x) — session-manager→sorted-set merge (recordSession parallelSessionsAdd) + revoke publishRevoke cross-node + onRevoke→store destroy + /health redis blok; session-redis-d31 7/7 + regression 30/30 + tsc 0 + boot 200. Qolgan yagona: §17 operator imzosi (Security/Privacy/Legal/Ops/Product).*
*E faza (2026-08-18) — RASMAN YOPILDI ✅ 7/7 + IKKALA AGENT IMOZOSI: E-04/E-01/E-02 (ps, 06:56) + E-05/E-03/E-06/E-07 (wsl, 06:57). test:auth 490/490 (58 fayl) + tsc 0 + db tegsiz. F-d security audit: XSS-scan E-faza UI qamrov (17/17) + 3 REAL fix. Qolgan yagona: §17 operator imzosi (Security/Privacy/Legal/Ops/Product) — operator-signoff-summary.md tayyor.*
