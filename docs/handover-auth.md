# Auth Handover — Deborah (AUTH D-28 §06)

> Ushbu hujjat auth tizimini yangi muhandisga / navbatchiga topshirish uchun:
> arxitektura xaritasi, qarorlar (NIST/OWASP), manbalar va owner'lar.
> **Precondition: D-27 final acceptance yashil** (docs/acceptance-auth.md — 270/270 test + tsc 0 + security 47/47).

## 1. Arxitektura xaritasi

### 1.1 Qatlamlar (research_auth_deep.md §15 qatlam xaritasi)

| Qatlam | Modul | Qisqacha |
|---|---|---|
| Parol siyosati | `src/modules/auth/password-policy.js` | NIST 800-63B: 8+ belgi, HIBP breach, no rotation |
| Email infra | `src/modules/email/*`, `src/modules/auth/email-verify.js` | SPF/DKIM/DMARC, transactional, bounce, double opt-in |
| OIDC | `src/modules/auth/oidc.js` | PKCE S256, JWKS, exact redirect, rotation |
| Session | `src/modules/auth/session-*.js`, `remember-me.js`, `token-vault.js` | `__Host-` cookie, idle+absolute+renewal, selector/verifier |
| MFA/TOTP | `src/modules/auth/mfa-totp.js`, `routes/mfa.js` | pending→active, backup codes hash, 5x15 lockout, step-up |
| Passkey | `src/modules/auth/webauthn.js` | simplewebauthn, counter, recovery |
| Risk-based | `src/modules/auth/risk.js`, `device-fingerprint.js`, `geo-lite.js`, `asn.js`, `abuse.js`, `new-device.js` | fingerprint, impossible travel, velocity, tiers |
| Account events | `src/modules/auth/account-events.js`, `email-change.js` | password/email change notify, breach detect |
| Admin hardening | `src/modules/auth/admin-security.js`, `authorization.js`, `roles.js` | MFA mandatory, Strict, re-auth, audit |
| Lockout | `src/modules/auth/lockout.js` | 5x15, permanent `status='blocked'` |
| Incident | `src/modules/auth/incident.js` | append-only incident log + response helper'lar |
| Legal/Privacy | `src/modules/legal/*`, `src/modules/privacy/dsar-user.js` | DPIA, purpose'li consent, DSAR (export/correct/delete/restrict) |

### 1.2 HTTP qatlam

| Fayl | Vazifa |
|---|---|
| `routes/auth.js` | register/login/logout/reset/reauth/password-change/email-change |
| `routes/mfa.js` | TOTP/passkey enrol-verify-reset |
| `routes/session.js` | session list + revoke |
| `routes/privacy.js` | DSAR endpoint'lar (POST export/correct/delete/restrict + status) |
| `routes/consent.js` | consent status + revoke (reauth) |
| `routes/roster.js` | teacher invite (invite accept → consent) |
| `middleware/auth.js` | requireAuth, requireRecentAuth (reauthedAt), login blok |
| `middleware/rate-limit.js` | IP/username velocity |
| `middleware/origin-check.js` | CSRF origin tekshiruvi |
| `middleware/recent-auth.js` | step-up talablari |

### 1.3 Ma'lumotlar

| Data | Lokatsiya | Eslatma |
|---|---|---|
| users, credentials, audit, consent | Firebase (`firebase/admin.js` fb) | `users/{key}/consents/{purpose}`, `maintenance_log/*`, `incidents/*` |
| Secret'lar | `src/modules/auth/kms.js` (D-02) | 90 kun rotation, log'da hech qachon |
| Session | `src/modules/auth/session-store.js` (Redis/fb) | revokeByUser helper |
| Backup | `src/modules/auth/backup.js` | AES-256-GCM, 30 kun (C-15, auth-recovery.md) |

## 2. Qarorlar (NIST/OWASP)

| Qaror | Standart | Manba |
|---|---|---|
| Parol: 8+, HIBP, breach blok, no rotation | NIST 800-63B-4 | A-22 |
| MFA: TOTP 5x15 lockout, step-up, backup codes hash | OWASP MFA / tech-insider | A-26 |
| Passkey: simplewebauthn, counter, recovery | WebAuthn L3 / reddit PSA | A-27 |
| Session: `__Host-`, idle+absolute+renewal, remember selector/verifier | OWASP Session / wardeck | A-25 |
| OIDC: PKCE S256, JWKS, exact redirect, rotation | OAuth 2.1 / RFC 9700 | A-24 |
| Email: SPF/DKIM/DMARC, double opt-in | Google/Yahoo 2024 | A-23 |
| DSAR delete: 30 kun grace + login blok | GDPR/Lex-Uz | D-23 |
| Consent: purpose'li, revoke fail-closed, version bump | D-24/25 | consent.js |
| Incident: append-only log, emergency flag | D-26 | incident.js |

## 3. Manbalar

- `D:/StartUp/to_do/research_auth_deep.md` — 15-bo'lim qatlam xaritasi (A-22..A-33)
- `docs/acceptance-auth.md` — D-27 final sertifikat (qamrov matritsasi + checklist)
- `docs/runbooks/auth-deploy.md`, `docs/runbooks/auth-recovery.md` — deploy + DR
- `docs/runbooks/auth-maintenance.md` — D-28 maintenance jadvali
- `implementation-status-auth.md` — har bir D-faza statusi (yashil dalli bilan)

## 4. Owner'lar (§24)

| Owner | Mas'uliyat | Kontakt |
|---|---|---|
| **Security owner** | Parol/MFA/passkey/risk/incident modullari, CVE scan, pen-test | ps agent (D-14..D-28 test+security) |
| **Ops owner** | Deploy, backup/restore, Redis, rate-limit, alert, maintenance jadvali | wsl agent (deploy/runbook/CI) |
| **Legal owner** | DPIA review, consent, DSAR, provider review (Google/Postmark/HEMIS) | wsl agent + operator |
| **On-call (SRE/DevOps)** | Alert check, incident birinchi javob (auth-recovery.md) | Operator |

## 5. Next-version backlog (P3, §25) — E-fazada bajarildi (2026-08-18)

- ~~C-23: DSAR SLA tracking (wsl UI)~~ → ✅ D-23 (dsar-ui-d23 5/5)
- ~~D-29: Frontend form validation (client-side Zod)~~ → ✅ D-29 (contracts-d29 7/7)
- ~~OIDC provider qo'shimchalari~~ → ✅ E-04 (multi-provider registry + key rotation)
- ~~Passkey sync~~ → ✅ E-05 (multi-device rename, IDOR fix)
- ~~HSM~~ → ✅ E-06 (cloud KMS adapter v2)
- ~~E-faza (ekstra)~~ → ✅ E-01..E-07 TO'LIQ (test:auth 486/486, ikkala imzo)

## 6. E-faza handover qo'shimchasi (2026-08-18)

| Modul | Tavsif | Manba |
|---|---|---|
| `src/modules/auth/identity.js` | Canonical OneID (generateOneId/ensureOneId/linkProviderToOneId/resolveOneId/removeOneIdMapping/syncLinkedOneIds/backfillOneIds) | E-01 |
| `src/modules/hemis/webhook.js` | HEMIS push webhook (HMAC + IP allowlist + idempotency + retry 1m/5m/15m + deadletter) | E-02 |
| `src/modules/auth/kms-provider.js` | Cloud KMS adapter (KMS_KEY_ARN, lazy @aws-sdk, cache TTL, fail-soft) | E-06 |
| `src/modules/email/budget.js` | Email budget (ok/warn 80%/exceeded 100%, CSV report, config UI, 60s TTL) | E-07 |
| `src/modules/student/push.js` + `fcm.js` | FCM device-token push (tokenKey sha256) | E-03 |
| `src/modules/auth/webauthn.js` (renamePasskey) | Passkey multi-device boshqaruv (owner-only IDOR fix, audit PASSKEY_RENAME) + `POST /api/passkey/rename` | E-05 |
| OIDC rotation/multi-provider | `watchJwksRotation` + `PROVIDERS[providerId]` registry | E-04 |

**F-d security audit (2026-08-18):** `security-ci` gate yashil (0 critical) — `roster/validator.js` execSync → spawnSync args-array (shell injeksiya yuzasi yopildi, roster 79/79), `.env.example` placeholder tozalandi, qolgan false positive'lar `SAST_ALLOWLIST`'da hujjatlashtirildi (Redis EVAL const, tarjima kalitlari, xavfli-pattern blocklist, qti multer-path), secrets gate gitignore'ni hisobga oladi.

**E-faza qabul:** `npm run test:auth` → 486/486 (58 fayl) + `tsc --noEmit` 0 + db tegsiz.
**Keyingi:** F-faza (`docs/roadmap-f-faza.md`) — commit (668 fayl), §17 operator imzosi, S39/S41 pilot + release.
