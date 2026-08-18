# Edikit — F-faza taklifi: Field validation + Release (D/E yopilgach)

**Sana:** 2026-08-18 · **Precondition:** D-faza (377/377) + E-faza (486/486) yashil, ikkala agent imzosi ✅
**Qolgan yagona:** OPERATOR §17 imzosi (Security/Privacy/Legal/Ops/Product)

---

## 1. Holat — D/E fazalar yakunlandi

| Blok | Natija | Imzo |
|---|---|---|
| D-faza (D-07..D-32) | test:auth 377/377 (48 fayl) + tsc 0 | 🔵+🟢 (2026-08-17) |
| E-faza (E-01..E-07) | test:auth 486/486 (58 fayl) + tsc 0 | 🔵+🟢 (2026-08-18) |
| **Commit** | 668 fayl (540 yangi + 128 o'zgartirilgan) — hali commit qilinmagan | ⏳ operator ruxsati |

## 2. Operator harakatlari (final-acceptance.md §17/§23)

| Item | Tavsif | Holat |
|---|---|---|
| **§17 imzo** | Security / Privacy / Legal / Ops / Product | ⏳ `operator-signoff-summary.md` tayyor |
| **S39 field sessiyalar** | n≥30 → `research/results/raw/*.csv` → `research/report.md` | ⏳ |
| **S41.10 pilot** | projector/real-class → `research/results/field-report.md` | ⏳ |
| **S41.12 sign-off** | 8 domain → `release-signoff` signed state | ⏳ |

## 3. F-faza taklifi (operator qaroridan keyin)

F-faza — kod emas, **real sinov + release** fazasi (agentlar yordami cheklangan, ko'p qismi operator/inson ishi):

| # | Vazifa | Kim | Tavsif |
|---|---|---|---|
| F-01 | **Commit D+E** | ps/wsl — reja tayyor | 15 commit (C1..C15) — docs/commit-plan-d-e.md; operator ruxsati kutilmoqda |
| F-02 | **§17 operator imzosi** | Operator | 5 rol (Security/Privacy/Legal/Ops/Product) |
| F-03 | **S39 field sessiyalar** | Operator | n≥30 real foydalanuvchi, `research/results/raw/*.csv` |
| F-04 | **S41.10 pilot** | Operator | projector/real-class sinov → `field-report.md` |
| F-05 | **S41.12 sign-off** | Operator | 8 domain → `release-signoff` signed |
| F-06 | **Release** | Operator | `launch:gate --full` (22 pass) → production deploy |

**Agentlar F-01 (commit) ni bajarishi mumkin; F-02..F-06 operator ishi.**

## 4. Agentlar bajarishi mumkin bo'lgan qo'shimcha ishlar (F-fazaga parallel)

Agar operator §17'ni imzolaguncha agentlar ish qilishi kerak bo'lsa:

| # | Vazifa | Havf | Tavsif |
|---|---|---|---|
| F-a | **Backlog yangilash** | ✅ DONE | acceptance-auth.md §30 — P3'lar (OneID/HEMIS/Push) → DONE + yangi P3 takliflar (07:0x) |
| F-b | **CI yaxshilash** | ✅ DONE | auth.yml E-faza path'lari (hemis/email/student/portfolio/passkey/push) — 2 blok |
| F-c | **Dokumentatsiya** | ✅ DONE | handover-auth.md 6-qism E-faza handover + wsl E-05 qatori |
| F-d | **Security audit takror** | ✅ DONE | XSS-scan E-faza UI (17/17) + security-ci ALL GATES PASS; 4 REAL fix (passkey stored XSS, account-settings esc, roster spawnSync, security-ci path) |

## 5. Qabul mezonlari

- Commit: 668 fayl mantiqiy guruhlarda, `test:auth` 486/486 yashil commit'lar bo'ylab
- §17: 5 rol imzosi `operator-signoff-summary.md` da
- S39: `research/results/raw/*.csv` (n≥30) + `research/report.md`
- S41.10: `research/results/field-report.md`
- S41.12: `release-signoff` signed state
- Release: `launch:gate --full` yashil + production deploy runbook (`docs/runbooks/auth-deploy.md`)

---

*Holat (07:35): F-a..F-d bajarildi, F-01 rejasi tayyor (commit-plan-d-e.md). Qolgan: operator §17 imzo + commit ruxsati → F-01 commit'lar.*
