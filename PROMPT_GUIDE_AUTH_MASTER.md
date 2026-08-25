# Edikit Auth — MASTER INDEX (A-E, 191 bosqich)

> **Yakuniy yig'ma:** Auth tizimi — 5 faza, 191 ta bosqichma-bosqich prompt. Har biri 30-40 qator, global gigant darajasida (NIST/OWASP/OAuth 2.1/Entra PIM/Google/Yahoo).
> **Qo'llash:** A-00 dan boshlab ketma-ket; har checkpoint'da operator sign-off.

## Fayllar
| Faza | Fayl | Promptlar | Nima |
|---|---|---|---|
| A | `PROMPT_GUIDE_AUTH.md` | A-00..A-31 (32) | Core: session, login, parol, OIDC, forgot, session UI, roster, transkript, ochiq data, secret sinash, HEMIS OAuth, Telegram, geofence, NIST/OWASP chuqurlash, MFA, passkey, risk, admin, account events, final |
| B | `PROMPT_GUIDE_AUTH_B.md` | B-00..B-37 (38) | Register, email verify, invite, teacher approval (Entra), onboarding, email infra, notification, email change, session invalidation, bot himoya |
| C | `PROMPT_GUIDE_AUTH_C.md` | C-00..C-25 (26) | Rate limit, lockout, fingerprint, risk, impossible travel, stuffing, admin auth/manage/audit, HEMIS/OneID/OpenData, retention, backup |
| D | `PROMPT_GUIDE_AUTH_D.md` | D-00..D-40 (41) | Infra: config, secrets, Redis, logging, trace, observability; Frontend: login/register/MFA/passkey/settings/admin, i18n, a11y, mobile, form validation, API contract; Test: framework, unit, integration, e2e, security, load; Ops: CI/CD, deploy, incident, legal, DSAR, consent, DPIA, acceptance |
| E | `PROMPT_GUIDE_AUTH_E.md` | E-00..E-53 (54) | Edge cases: session/OAuth/email/MFA/passkey/rate/UX/integration/admin/security/test/monitoring/perf; threat model, ASVS, red-team, pen-test, docs, support, audit trail, final release |

**JAMI: 32+38+26+41+54 = 191 bosqich** (har biri 30-40 qator).

## Checkpointlar (operator sign-off)
- A-17 (Login foundation), A-21 (Register+Teacher), A-25 (Global daraja), A-31 (A-faza FINAL)
- B-26, B-37 (B-faza)
- C-16, C-25 (C-faza)
- D-27, D-40 (D-faza)
- E-15, E-42, E-53 (E-faza / ULTIMATE RELEASE)

## Manbalar (majburiy)
- `research_auth.md` — qilinadigan ishlar
- `research_auth_deep.md` — manbalar arxivi (NIST SP 800-63B-4, OWASP CheatSheets, OAuth 2.1/RFC 9700, Entra PIM, Google/Yahoo 2024, Postmark/SES, simplewebauthn)
- `hemis_github.md` — HEMIS/tyutor/GitHub resurslar

## Qoidalar
- Ketma-ketlik dependency; checkpoint BLOCKED → keyingi phase yo'q.
- P2/P3 (MFA, passkey, risk, Telegram, OneID, HEMIS OAuth, diplom.edu.uz) — operator tasdig'i.
- HEMIS: faqat xavfsiz yo'llar (OAuth2 rasmiy, eksport/import, ochiq data); skrepling/parol/undocumented — taqiqlangan; geofence (UZ IP).
- Universitar + global gigant daraja qoidalari butun zanjir bo'ylab.
- Har bosqichda `implementation-status-auth.md` ledger (DONE/PARTIAL/BLOCKED).
