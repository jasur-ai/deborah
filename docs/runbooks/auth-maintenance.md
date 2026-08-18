# Auth Maintenance Runbook (AUTH D-28 §07)

> Auth tizimining muntazam parvarishi — jadval bo'yicha task'lar.
> Har bir amal `maintenance_log`'ga yoziladi (script: `scripts/maintenance/auth-maintenance.js`).
> **PII minimal (§12):** log'da email/telegram_id/to'liq IP hech qachon — faqat owner key hash.

## 0. Asboblar

```bash
# Maintenance log + drill + rotation tekshiruvi (har bir task oxirida):
node -e "import('./scripts/maintenance/auth-maintenance.js').then(async m => {
  console.log(await m.logMaintenance({ action: 'task:done', operator: 'ops' }));
})"
```

## 1. Kunlik (on-call)

| Task | Qanday | Mezon |
|---|---|---|
| Alert check | Monitoring dashboards + `audit-alert.js` | 0 open S1/S2 |
| Email bounce | `email: bounced` audit + provider bounce webhook | bounce < 2% |
| Rate-limit abuse | `rate-limit` log — IP velocity | 0 doimiy bloklangan anomaliya |

## 2. Haftalik

| Task | Qanday | Mezon |
|---|---|---|
| Audit review | `audit/*` — login_failed, reset_request, consent revoke | Anomaliya yo'q |
| DMARC report | Provider DMARC aggregate | SPF/DKIM pass ≥ 95% |

## 3. Oylik

| Task | Script | Mezon |
|---|---|---|
| Backup restore drill | `runDrill({kind:'backup_restore'})` (C-15) | RPO ≤ 1 soat, RTO ≤ 4 soat |
| Incident drill | `runDrill({kind:'incident'})` (D-26) | S1 response < 1 soat |
| HIBP sync | `syncHibp()` (A-22) | breach list yangi |
| Disposable list update | `updateDisposable()` (A-23) | yangi domain'lar qo'shilgan |
| Secret rotation check | `checkSecretAge()` (D-02 §09) | age < 90 kun; **due bo'lsa darhol rotate** |

## 4. Har kvartal

| Task | Qanday | Mezon |
|---|---|---|
| Pen-test | Tashqi/ichki pentest + `security-fuzz.js` | 0 critical/high |
| DPIA review | `dpia.js` + legal owner | Risk'lar o'zgarmagan |
| Dependency update | `scanCve()` (CI) + auth lib'lar (argon2, oidc, simplewebauthn, otplib, postmark) | 0 critical CVE |
| Tuning logs | Alert chegaralari, rate-limit tuning | False-positive kamaygan |

## 5. Har yil

| Task | Qanday | Mezon |
|---|---|---|
| Provider review (§10) | `providerReview({providers:['Google','Postmark','HEMIS']})` | Terms/ToS o'zgarishi revizyon |
| Full auth audit | `implementation-status-auth.md` + acceptance | D-faza hujjatlari yangi |

## 6. Secret rotation (§09) — 90 kun

```bash
# 1) KMS orqali yangi secret generatsiya (qiymat log'ga yozilmaydi)
# 2) Yangi secret'ni deploy (auth-deploy.md)
# 3) Eski secret'ni revoke (grace davri bilan)
# 4) Stamp yangilash:
node -e "import('./scripts/maintenance/auth-maintenance.js').then(async m => console.log(await m.markSecretRotated({ operator: 'ops' })))"
# 5) Tekshiruv: audit'da `maintenance:secret:rotated` + `checkSecretAge().due === false`
```

## 7. Dependency CVE scan (§08) — CI'da

- CI: `npm audit --audit-level=high` + `scanCve()` natijasi maintenance_log'ga
- Auth lib'lar whitelist: argon2, @simplewebauthn/*, otplib, postmark, express-session, cookie-parser
- 0 critical/high → yashil; aks holda `result:'fail'` + incident (D-26) ochiladi

## 8. Yangi write path qoidalari (§13)

Har bir yangi write path (route/modul) uchun tekshirish shart:
1. **Tenant scope** — user faqat o'z `users/{key}` ga yozadi (IDOR testi, D-23)
2. **Authorization** — requireAuth + requireRecentAuth (privileged action'lar)
3. **Validation** — parseRegister / schema tekshiruvi
4. **Idempotency** — takroriy POST (mas. consent grant) ustiga yozadi, zararsiz

Privileged action'lar uchun **audit event + metric/trace** qo'shiladi (§14).

## 9. Stop condition (§21)

- Maintenance plan (ushbu hujjat) bo'lmasa — task'lar bajarilmaydi, navbatchi eskalatsiya qiladi.
