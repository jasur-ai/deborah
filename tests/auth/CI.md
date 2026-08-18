# Auth CI/CD Pipeline (AUTH D-20)

**Workflow:** `.github/workflows/auth.yml` — auth fayllariga teganda ishlaydi (push/PR main).

## Stage'lar (D-20 §06)

| Stage | Job | Command | Gate |
|---|---|---|---|
| 1. Install + typecheck | `test-auth` | `npm ci` + `npm run typecheck` | fail → blok |
| 2. Unit + integration | `test-auth` | `npm run test:auth` (vitest, mock provider, `LOCAL_DB_FILE` temp) | fail → blok |
| 3. Security suite | `test-auth` | `npm run test:security:auth` (D-18: CSRF/cookies/XSS/secret/PII scan) | fail → blok |
| 5. A11y (axe) | `test-auth` | `axe-scan-d12` + `a11y-d12` — 0 critical/serious | fail → blok |
| Pre-check | `test-auth` | `npm run test:load:auth` (D-19 SLO harness) | fail → blok |
| 4. E2E (playwright) | `e2e-auth` | `npm run test:e2e:auth` (chromium, headless) — fayllar mavjud bo'lsa | fail → blok |
| 6. Build + bundle | `build-auth` | `npm run build` + auth JS bundle < 50KB | fail → blok |
| 7. Deploy | (wsl) | staging → prod blue-green + migration (D-21 runbook) | — |

## Secret'lar (D-20 §07/§12)

- CI'da faqat **test qiymatlar**: `SESSION_SECRET=ci-secret-for-auth-stage`, `ADMIN_USER/PASS` test.
- Production secret'lar GitHub Secrets'da — CI'da emas, real provider'ga test ulanmaydi.
- Har qanday yangi env: test qiymat bilan qo'shiladi, production secret log'ga chiqmaydi.

## Migration (D-20 §08)

- CI: fresh DB (`LOCAL_DB_FILE` temp) — migratsiya har run'da toza.
- Prod: backward-compatible migratsiya (D-21 runbook, wsl qismi).

## Gate va release (D-20 §09/§10)

- Har stage fail → workflow fail.
- Security critical fail (D-18 security suite) → release blok.
- Artifact: build hash; SBOM (Prompt 70) — release'da.

## Tezlik (D-20 §24/§25)

- npm + playwright cache; `e2e-auth`/`build-auth` parallel (`needs: test-auth`).
- Auth fayllarga tegilmasa workflow ishlamaydi (paths filter).
