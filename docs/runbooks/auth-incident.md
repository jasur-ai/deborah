# Auth Incident Response Runbook (AUTH D-26)

> Auth xavfsizlik hodisalariga javob: credential leak, session hijack, ATO burst,
> MFA bypass, email compromise, provider outage.
> Implementatsiya: `src/modules/auth/incident.js` (append-only log + response helper'lar).
> DR/recovery: `auth-recovery.md` (C-15). Deploy: `auth-deploy.md` (D-21).

## 1. Kim, qachon

| Rol | Mas'uliyat |
|---|---|
| DRI (Designated Responsible Individual) | Incident'ni ochadi, javobni boshqaradi, eskalatsiya |
| Auth owner (senior dev) | Root cause tahlili, fix, sign-off |
| SRE/DevOps | Infratuzilma tekshiruvi, Redis/session, log pull |
| Ikkinchi operator | Mustaqil tekshiruv (2 kishi qoidasi) |
| Security/Privacy (agar kerak) | HIBP/DPIA/regulyator xabarnomasi (72 soat qoidasi) |

**24/7 on-call:** auth S1 hodisalarida DRI 15 daqiqa ichida javob beradi.

## 2. Incident turlari va SLA

| Type | Tavsif | Default severity |
|---|---|---|
| `credential_leak` | HIBP / dark-web parol sizib chiqishi | S1 |
| `session_hijack` | Session cookie o'g'irlanishi | S1 |
| `ato_burst` | Ommaviy account takeover (risk_block alert) | S1 |
| `mfa_bypass` | MFA chetlab o'tish | S1 |
| `email_compromise` | Email pochtasi egallanishi | S2 |
| `provider_outage` | Email/OTP provider ishlamayapti | S2 |

**Severity SLA:** S1 — < 1 soatda javob, < 4 soatda mitigatsiya; S2 — < 4 soat;
S3 — keyingi ish kuni. Severity o'zgarsa — timeline'ga `incident:severity` append.

## 3. Workflow (qadamlar)

### 3.1 Detect
- Alert manbalari: `auth_audit` anomaliya (login fail spike), rate-limit (C-01),
  abuse (C-06 stuffing), HIBP webhook, monitoring (D-19 SLO), foydalanuvchi shikoyati.

### 3.2 Triage (15 daqiqa)
1. Haqiqiy incidentmi? (false-positive tekshiruvi — audit log'lar)
2. Type + severity aniqlanadi.
3. DRI tayinlanadi; `createIncident({ type, severity, owner, reason })` — audit `incident:created`.

### 3.3 Respond (mitigatsiya)
Har bir harakat timeline'ga **append-only** qilinadi — hech qachon overwrite yo'q:
`appendIncidentAction(id, { action, actorId })`.

**Credential leak (§08):**
1. `credentialLeakResponse({ userIds, reason })` — barcha affected user'lar
   sessiyalari revoke (`revokeByUser` — barcha qurilmalar) + `force_password_reset`
   yozuvi (keyingi login'da majburiy parol yangilash).
2. Foydalanuvchilarga xabar (email/push — alohida kanal, fire-and-forget).
3. HIBP'da yangi parol tekshiruvi; kompromat parol blacklist.

**ATO burst (§09):**
1. `atoBurstResponse({ userIds })` — affected user'lar `status='blocked'`
   (C-02 §10 permanent blok) + sessiya revoke.
2. Super-admin bildirishnomasi (`notifySuperAdmin` — chaqiruvchi).
3. Burst manbai (IP/device) tekshiruvi — stuffing detector (C-06).

**MFA bypass / emergency (§11):**
1. `mfaEmergencyOff({ reason })` — `authMfaEmergencyOff` flag ON (D-21 pattern,
   gradual rollout mexanizmi) — MFA majburiy tekshiruv vaqtincha o'chadi.
2. Root cause tuzatilgach `mfaEmergencyOn()` — flag OFF (audit `incident:mfa_emergency_on`).
3. Emergency davr oxirida barcha user'lardan qayta re-auth talab qilinadi.

### 3.4 Close + Postmortem
1. Mitigatsiya tasdiqlangach `closeIncident(id, { postmortem, reviewer })` —
   status `closed`, postmortem (tavsif + root cause + fix + oldini olish).
2. 2-kishi qoidasi: reviewer DRI bo'lmasligi kerak.
3. Postmortem keyingi release'da aks etadi (auth-maintenance.md CVE/patch).

## 4. Append-only qoidasi (§15)

- `incidents/{id}/timeline` — faqat `push`, eski yozuvlar hech qachon o'chirilmaydi.
- Har bir action audit log'da (`incident:action`) — kim, qachon, nima.
- Incident yopilgach ham timeline'ga yozish mumkin (postmortem keyin to'ldirilsa).
- PII minimal: timeline'da faqat `actorId` (user key) + action — raw IP/parol YO'Q.

## 5. Eskalatsiya

| Holat | Eskalatsiya |
|---|---|
| S1 + 30 daqiqa javobsiz | Ops lead → CTO |
| S1 + 2 soat | CTO → CEO (agar yuridik xavf: GDPR/UZ data law 72 soat) |
| Regulyator | Security owner — 72 soat ichida xabarnoma (agar PII sizib chiqqan bo'lsa) |

## 6. Drill (sinov)

```bash
# Incident drill — hermetic (real DB'ga TEGMAYDI)
npx vitest run tests/auth/integration/incident-drill-d26.test.js
```

Drill stsenariysi: credential_leak (S1) → create → append (revoke+reset) →
close (postmortem) + MFA emergency off/on. Har oy 1 marta o'tkaziladi
(auth-maintenance.md — oylik jadval).

## 7. Checklist (D-26 done condition)

- [ ] `incident.js` append-only log (create/append/close/list)
- [ ] `credentialLeakResponse` — revoke + force reset + audit
- [ ] `atoBurstResponse` — block + revoke + audit
- [ ] `mfaEmergencyOff/On` — flag toggle + audit
- [ ] Ushbu runbook + drill testi yashil
- [ ] 2-kishi qoidasi va SLA hujjatda
