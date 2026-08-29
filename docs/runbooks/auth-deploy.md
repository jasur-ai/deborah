# Auth Deploy Runbook (AUTH D-21)

> Auth deploy: blue-green, backward-compatible migration, rollback, canary.
> DR/recovery uchun: `auth-recovery.md` (C-15). CI: `.github/workflows/auth.yml` (D-20).

## 1. Kim, qachon

| Rol | Mas'uliyat |
|---|---|
| Auth owner (senior dev) | Release'ni tayyorlaydi, feature flag rollout'ini boshqaradi, sign-off |
| SRE/DevOps | Blue-green switch, health tekshiruvi, trafik canary, rollback |
| Ikkinchi operator | Mustaqil tekshiruv (2 kishi qoidasi) |
| DRI | Deploy_started/completed/rolled_back audit yozuvlari, eskalatsiya |

Deploy vaqtlari: ish kunlari 10:00–16:00 Toshkent; **freeze window** (D-38): imtihon mavsumi + Nyu-yil — auth release yo'q.

## 2. Blue-green (D-21 §06/§27)

1. `blue` joriy prod; `green` yangi release.
2. Migration (backward-compatible, 20-rule) **avval** green'da run (D-21 §07).
3. `GET /health` green'da — DB/Redis/provider OK (D-21 §11).
4. Canary trafik: **1% → 10% → 100%** (D-21 §27); har bosqichda SLO kuzatish.
5. 100% da `deploy_completed` audit + deploy tarixi (implementation-status-auth.md §28).

## 3. Migration 20-rule (D-21 §07)

- Har migration **backward-compatible**: eski kod yangi DB bilan ishlaydi, yangi kod eski DB bilan.
- Rule: migratsiya yangi kod deploy'dan **oldingi** release'da o'tadi (20-rule).
- Backward-incompatible migration → yo'q qilinadi yoki 2 bosqichli (add → migrate → drop).

## 4. Rollback (D-21 §08/§09)

**Triggerlar** (har biri 5 daqiqa ichida 2 marta tasdiqlansa):
- Error rate > 1%
- Login fail spike (5x o'sish)
- Security alert (audit/rate-limit anomaliyasi)
- Auth latency p95 > 5s

**Qadamlar:**
1. `deploy_rolled_back` audit (operator, ts).
2. DNS/LB → old release (blue) switch.
3. Migration rollback: backward-compatible bo'lgani uchun faqat flag'lar qaytariladi (drop yo'q).
4. Redis session: login'lar qayta amalga oshadi (accept — D-21 §09).
5. Feature flaglar: yangi flaglar OFF → old holat.
6. Root cause tahlili → keyingi release.

## 5. Email provider failover + budget (D-32 §25-§27)

- **Failover:** `EMAIL_PROVIDER_PRIMARY` 5x xato/1 daqiqa'da → `EMAIL_PROVIDER_SECONDARY`
  (auto-recovery 5 daqiqa cooldown). Provider tartibi `src/modules/email/provider.js`.
- **Webhook:** `EMAIL_WEBHOOK_IP_ALLOWLIST` (vergul bilan IP'lar) — spoof qarshi.
- **Budget:** `EMAIL_MONTHLY_BUDGET_USD` — oylik xarajat chegarasi; oshsa
  `email:budget:alert` audit + monitor (email_cost/{YYYY-MM}/{provider}).
- Deploy'da yangi env'lar `green`'ga oldin kiritiladi (backward-compatible — eski
  kod `EMAIL_PROVIDER` legacy'ni o'qiydi, D-32 default tushadi).

## 6. Feature flags (D-21 §10/§26)


| Flag | Default | Rollout | Env var |
|---|---|---|---|
| `authMfaRequired` | false | 5% → 25% → 100% | `FEATURE_AUTH_MFA_REQUIRED` |
| `authPasskeyLogin` | false | 5% → 25% → 100% | `FEATURE_AUTH_PASSKEY_LOGIN` |
| `authDeviceCheck` | false | 5% → 25% → 100% | `FEATURE_AUTH_DEVICE_CHECK` |

Rollout qoidalari: har bosqichda 24-48 soat kuzatish; SLO buzilsa — flag OFF (rollback tez).

## 6. Health check (D-21 §11)

`GET /health` → `{ status, features, rateLimiter, realtime, backpressure }`.
Deploy'da: health OK bo'lmasa trafik yuborilmaydi.

## 7. Audit (D-21 §13)

`deploy_started` → `deploy_completed` | `deploy_rolled_back` (operator, timestamp) — auth audit log'ida.
