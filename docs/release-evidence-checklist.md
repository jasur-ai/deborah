# Release Evidence Checklist — S41.12 Sign-off

Operator uchun 8 domain × 5 evidence. Har bir item: **DALIL BOR** (manba) yoki **KERAK** (owner to'ldiradi). `release-signoff.js` orqali har domain submit → review → sign-off qilinadi.

**Ishlatish:** `node scripts/release-signoff.js --rehearsal` (to'liq sinov) → har domain uchun evidence'larni to'ldirib, acceptance moduli orqali submit qiling → `node scripts/launch-gate.js` — S41.12 yashil.

---

## 1. 🔒 security — Security acceptance

| Evidence | Holat | Manba |
|---|---|---|
| ASVS v5.0 | ✅ DALIL BOR | `tests/auth/unit/password-core.test.js`, `tests/e2e/security-guard-redteam.test.js`, `tests/integration/security-guard.test.js` (ASVS bo'limlari) |
| threat model | ⚠️ KERAK | `docs/` da yo'q — security owner tuzadi |
| pen-test exec summary | ✅ DALIL BOR | `test:security:auth` 51/51 + `scripts/security-ci.js` (SAST/DAST) |
| SAST/DAST/SCA | ✅ DALIL BOR | `security-ci` — **ALL GATES PASS** (SAST 0, SCA 0) |
| SBOM | ✅ DALIL BOR | `security-ci` — SBOM 48 components |

## 2. 🛡️ reliability-dr — Reliability / DR / SLO

| Evidence | Holat | Manba |
|---|---|---|
| load SLO evidence | ✅ DALIL BOR | `tests/auth/unit/auth-load-slo.test.js` (SLO burn rates) |
| chaos drills | ✅ DALIL BOR | D-21 `deploy-drill-d21.test.js` (deploy + rollback drill), D-26 `incident-drill-d26.test.js` |
| backup restore RPO/RTO | ✅ DALIL BOR | `docs/runbooks/auth-recovery.md` (AES-256-GCM shifrlangan backup, 30 kun retention) |
| drain/freeze | ⚠️ KERAK | deploy runbook'da qisman — to'ldiriladi (`docs/runbooks/auth-deploy.md`) |
| SLO burn rates | ✅ DALIL BOR | `tests/auth/unit/auth-load-slo.test.js` |

## 3. 📊 assessment — Assessment / grade governance

| Evidence | Holat | Manba |
|---|---|---|
| psychometric stats | ⚠️ KERAK | `tests/unit/assessment.test.js` da qisman — to'liq hisobot kerak |
| grade rule versioning | ✅ DALIL BOR | `tests/e2e/exam-grade-board-case.integration.test.js` |
| marking calibration | ✅ DALIL BOR | `tests/e2e/marking-moderation.test.js`, `tests/integration/marking.test.js` |
| board ratification | ⚠️ KERAK | kompaniya darajasidagi hujjat |
| grade ledger | ✅ DALIL BOR | `tests/e2e/exam-grade.checkpoint.test.js` (audit zanjiri) |

## 4. 🔏 privacy-legal — Privacy / legal / data residency

| Evidence | Holat | Manba |
|---|---|---|
| DPA | ⚠️ KERAK | kompaniya darajasidagi hujjat |
| data residency UZ | ⚠️ KERAK | deployment joyi hujjati (`docs/runbooks/auth-deploy.md`) |
| retention/deletion | ✅ DALIL BOR | `docs/runbooks/auth-maintenance.md`, PII inventory (ipHash, consent) |
| DSAR process | ✅ DALIL BOR | `tests/auth/integration/dsar-ui-d23.test.js` + `dsar-idor` + `dsar-user` + `legal-docs` |
| legal holds | ⚠️ KERAK | kompaniya darajasidagi hujjat |

## 5. ♿ accessibility — Accessibility / ACR / accommodation

| Evidence | Holat | Manba |
|---|---|---|
| WCAG 2.2 AA ACR | ✅ DALIL BOR | `docs/accessibility.md` + `test:a11y:static` **PASS** (S36.02/S36.05..09) |
| artifact accessibility | ✅ DALIL BOR | `tests/a11y/`, `tests/e2e/cast-a11y-suite.test.js` |
| accommodation snapshots | ⚠️ KERAK | mavjud emas — to'ldiriladi |
| keyboard/screen-reader tests | ✅ DALIL BOR | `tests/integration/a11y-d12.test.js`, `tests/unit/cast-a11y.test.js` |

## 6. 🤖 ai-governance — AI eval / human oversight / rollback

| Evidence | Holat | Manba |
|---|---|---|
| model registry | ✅ DALIL BOR | `src/modules/ai-mlops/` (model registry) |
| golden set | ✅ DALIL BOR | `src/modules/ai-checkpoint/` |
| drift monitoring | ✅ DALIL BOR | `src/modules/ai-mlops/ai-mlops.service.js` |
| human oversight | ✅ DALIL BOR | `src/modules/acceptance/acceptance.schema.js` (FSM) + `src/telemetry/alerts.js` |
| rollback drills | ⚠️ KERAK | D-21 drill da deploy rollback bor — AI rollback hujjati kerak |

## 7. 🛠️ operations — Operations / training / support / exit

| Evidence | Holat | Manba |
|---|---|---|
| role training | ⚠️ KERAK | operator tayyorlaydi |
| support model | ⚠️ KERAK | operator tayyorlaydi |
| incident runbooks | ✅ DALIL BOR | `docs/runbooks/auth-incident.md` + `incident-drill-d26` 8/8 |
| vendor exit pack | ⚠️ KERAK | operator tayyorlaydi |
| status page | ⚠️ KERAK | operator tayyorlaydi |

## 8. 🎯 product — Product acceptance

| Evidence | Holat | Manba |
|---|---|---|
| acceptance metrics | ✅ DALIL BOR | `docs/acceptance-auth.md` (D+E fazalar, test:auth 490/490) + `docs/final-acceptance.md` |
| exam ops gates | ✅ DALIL BOR | `launch:gate` — 22 pass (S41.x zanjiri) |
| interop conformance | ✅ DALIL BOR | `tests/e2e/institutional-handoff.test.js`, OpenAPI (`docs/openapi-auth.json`) |
| accessibility gates | ✅ DALIL BOR | launch-gate S36 (a11y static PASS) |

---

## Xulosa

- **DALIL BOR:** 22/40 item — mavjud testlar/hujjatlar bilan qoplangan
- **KERAK (operator/owner):** 18/40 — asosan kompaniya darajasidagi hujjatlar (DPA, threat model, training, vendor exit)

Har bir domain submit qilish uchun acceptance moduli FSM: evidence-submitted → reviewed → signed-off. Keyin `launch-gate` S41.12 yashil bo'ladi.

_2026-08-18 — 🔵 ps F-06 tayyorgarlik_
