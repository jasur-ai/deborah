# Deborah — E-faza taklif rejasi (AUTH D-27 §30 / handover §25)

> **Holat:** KELISHILGAN ✅ (23:03) — D-faza (D-07..D-32) ikkala agent imzosi bilan yopildi (2026-08-17).
> E-faza (ekstra) operator qaroriga ko'ra boshlanadi (§23). Reja PS tomonidan tuzildi,
> wsl 23:02 da tuzatishlar (hajm/xavf, E-01a/b, E-03 DSAR, E-06 KMS) bilan tasdiqladi.
> **Qolgan yagona: operator boshlanish qarori.**

---

## 1. Maqsad

D-faza auth yadrosini (login/register/MFA/session/DSAR/Redis) tugatdi. E-faza —
**skalalash va identifikatsiya integratsiyalari** (P3 darajasi, operator ustuvorlik beradi).

## 2. Backlog (P3, manbalar: acceptance-auth.md §30 + handover-auth.md §25)

| # | Vazifa | Tavsif | Egasi (taklif) | Bog'liq |
|---|---|---|---|---|
| E-01 | OneID (yagona identifikatsiya) | Barcha platformalarda yagona auth identifikatori | 🔵+🟢 | D-30 OIDC |
| E-02 | HEMIS data sync (to'liq, push) | Talabalar/ballar sinxronizatsiyasi (hozir pull) | 🔵 | B-12 roster |
| E-03 | Push notifications to'liq | B-23 kontekstual opt-in ustida to'liq push | 🟢 | C-23 DSAR |
| E-04 | OIDC provider qo'shimchalari | OpenID Connect scopelar, key rotation | 🔵 | D-30 |
| E-05 | Passkey sync (multi-device) | WebAuthn credential'lar qurilmalararo sinxron | 🟢 | D-08 |
| E-06 | HSM (hardware security module) | Signing key'lar HSM'da, audit | 🔵 | D-30 |
| E-07 | Email budget dashboard (P2 upgrade) | $25 oylik limit → dynamic alert + report | 🔵 | D-32 |

## 3. Tayyorgarlik tahlili (PS 22:58 + wsl 23:02 — read-only, kod tegsiz)

| Vazifa | Poydevor holati | Test qamrovi | E-fazada qilinadigan ish | Hajm/Xavf (wsl bahosi) |
|---|---|---|---|---|
| E-04 OIDC | `oidc.js` to'liq (PKCE, code exchange, ID token verify, refresh rotatsiya A-24) | 64/64 (a07/a24/b09/oidc) | scopelar kengaytirish + key rotation monitoring + multi-provider arxitektura | M / O'rta |
| E-01 OneID | Auth identifikatori `users/{key}` — OneID xaritasi YO'Q, migration yo'q | `user-schema-b01` 21/21 | identity model + mapping + migration tooling (E-01a model / E-01b migration) | **L / Yuqori** (eng katta) |
| E-02 HEMIS | `providers/hemis.js` to'liq (REST login, OAuth2 scaffold, rate limit, Zod normalize) | 35/35 (a14/a15/c10/journey) | pull→push (webhook + retry, email-infra naqshida); B-12 roster shared modul | M / O'rta |
| E-03 Push notif | B-23 opt-in + telegram infra bor; FCM/APNs provider YO'Q | telegram-a16 5/5 | FCM/APNs tanlovi + device token registr + revoke (logout/DSAR); push token = PII → DSAR export'ga kirishi shart | **L / Yuqori** (tashqi provider) |
| E-05 Passkey sync | WebAuthn `webauthn.js` to'liq (D-08/D-27) | 27/27 (a27/passkey/journey) | cross-device credential sinxron (Apple/Google passkey) — server tomoni attestation + counter | S-M / O'rta |
| E-06 HSM | JWT/refresh signing `crypto` (soft key) | oidc 64/64 (soft key bilan) | cloud KMS (AWS/GCP) skop — fizik HSM xarajat; key rotation audit E-04 bilan juft | M / O'rta |
| E-07 Email budget | D-32 qurilgan (`/admin/email-cost` + `email-d32` 10/10) | 10/10 | dynamic alert + report (P2 upgrade) | S / Past |

## 4. Taklif qilingan tartib (wsl rozilik bilan)

1. **E-04 OIDC qo'shimchalari** — OneID (E-01) uchun poydevor, D-30 oidc.js ustida.
2. **E-01 OneID** — E-04 dan keyin; identifikatsiya xaritasi + migration (E-01a/E-01b ga bo'linadi).
3. **E-02 HEMIS push sync** — pull→push, webhook + retry (email-infra naqshida).
4. **E-03 Push notifications** — B-23 opt-in ustida; **FCM/APNs provider tanlovi + DSAR (token=PII) oldin hal qilinadi**.
5. **E-05/E-06** — mustaqil, parallel olinishi mumkin (E-06 cloud KMS skop bilan).
6. **E-07** — kichik (S), istalgan vaqtda.

## 5. E-04 texnik reja (PS, 23:07 — read-only tahlil)

Joriy holat: Google OIDC to'liq (JWKS cache 24h + jose rotation, issuer EXACT, refresh rotatsiya A-24 §11 + per-user lock, PKCE, rate limit, redirect exact).

E-04 qadamlari (har biri test bilan):
1. **Multi-provider arxitektura** — `GOOGLE_CONFIG` → `PROVIDERS[providerId]` (Google + kelajakda Microsoft/GitHub); oidc.js'da generic provider interface (discovery URL, jwks, token, userinfo)
2. **Key rotation monitoring** — JWKS kid o'zgarishini audit (rotation event); eski kid'lar grace window (24h)
3. **Scopelar** — `profile` + ixtiyoriy (email, openid); scope kengaytirish uchun consent screen qayta
4. **Qayta qo'ng'iroq oqimi** — completeOidcLogin provider-agnostic (hozir Google-specific)

Qabul: mavjud Google flow regression (oidc 64/64) + yangi provider mock testlari.

## 6. E-02 texnik reja (PS, 23:08 — read-only tahlil)

Joriy holat: HEMIS REST to'liq (restLogin + fetchAccountMe, base URL safety, timeout/AbortController, tracing span, geofence 451, rate limit 10/15 daqiqa); roster B-12 to'liq (upload/sessions/map/preview/approve/rollback + MFA step-up).

E-02 qadamlari (har biri test bilan):
1. **Push webhook endpoint** — HEMIS → Deborah push (talabalar/ballar o'zgarishi); hmac signature (email webhook allowlist naqshida)
2. **Retry + idempotency** — muvaffaqiyatsiz push'lar retry (exponential backoff), event_id idempotency (email-infra naqshida)
3. **Sync moduli** — pull (mavjud) + push (yangi) birlashtirish; B-12 roster shared modul ustida
4. **Audit** — sync event'lari audit + metric

Qabul: mavjud HEMIS regression (35/35) + webhook/retry testlari + roster regression (B-12).

## 7. E-07 texnik reja (PS, 23:09 — read-only tahlil)

Joriy holat: D-32 da qurilgan — `GET /admin/email-cost` (routes/admin.js:137) + `views/admin/email-cost.ejs` (stat kartalar + month/provider jadval + OK/Limit oshdi) + `email-cost-d32` 3/3 + `email-d32` 12/12.

E-07 qadamlari (P2 upgrade, kichik):
1. **Dynamic alert** — budget 80%/100% chegarasida admin bildirishnoma (audit event + panel banner)
2. **Report** — oylik email xarajat hisoboti (CSV export, provider bo'yicha)
3. **Budget config UI** — EMAIL_MONTHLY_BUDGET_USD o'rniga admin panel'da sozlash (env default)

Qabul: mavjud email-cost regression (3/3) + email-d32 (12/12) + yangi alert/report testlari.

## 8. E-01 texnik reja (PS, 23:10 — read-only tahlil; wsl hamkorligida)

Joriy holat: `account-linking.js` to'liq (createLinkRequest → approve/reject → remove, mismatch report/resolve, duplicate/pending tekshiruv); user-schema unique identifikatorlar (username/email/google_sub/hemis_id/telegram_id); `oneidVerifyIdentity({ pinfl, email })` mavjud (external-integration.client.js).

E-01a (model — birinchi):
1. **Canonical OneID** — yangi `oneid_sub` unique maydon (user-schema) + `identity/{oneid_sub}` mapping; mavjud unique ID'lar (google_sub/hemis_id/telegram_id) OneID'ga birlashtirish
2. **Identity model** — bitta user = bitta canonical OneID; provider'lar bilan ko'p-1 bog'lanish (hozir google_sub/hemis_id bir xil user'da)
3. **Linking UX** — account-linking oqimi ustida (mavjud API + settings UI)

E-01b (migration — ikkinchi):
4. **Migration tooling** — mavjud user'lar uchun OneID backfill (identity mapping scripti, idempotent, audit)
5. **Regression** — barcha auth oqimlari (login/register/OIDC/HEMIS/telegram) OneID bilan ishlaydi

Qabul: account-linking regression + user-schema-b01 21/21 + yangi oneid mapping/migration testlari + test:auth >= 377/377.

## 9. E-06 texnik reja (PS, 23:11 — read-only tahlil; cloud KMS skop)

Joriy holat: `kms.js` to'liq (AES-256-GCM, versioned master key + ALLOWED_VERSIONS downgrade qarshi, legacy A-26 backward-compat, reEncryptSecret migration, rotateMasterKey store bilan, `_setMasterKeyForTests`). Hozir master key env'dan (MFA_ENCRYPTION_KEY/SESSION_SECRET sha256) — `KMS_KEY_ARN` bo'lsa cloud KMS (D-02 §28 UZ region, izohda belgilangan).

E-06 qadamlari (cloud KMS, fizik HSM emas):
1. **KMS provider adapter** — `masterKey()` ichida `KMS_KEY_ARN` bo'lsa cloud Decrypt call; env fallback (dev/test) saqlanadi
2. **Key rotation** — `rotateMasterKey` KMS key version bilan (reEncrypt migratsiya, E-04 key rotation audit bilan juft)
3. **Audit** — KMS call'lar audit (metric: decrypt count, latency); fail-soft (KMS down → env fallback faqat eski payload uchun)

Qabul: kms-d02 regression (13/13) + KMS adapter mock testlari (UZ region, key ARN) + test:auth >= 377/377.

## 10. Qabul mezonlari (E-faza)

- Har bir E-x: unit + integration + (kerak bo'lsa) security testlari
- `npm run test:auth` regression: **≥ 377/377** (D-faza bazasi)
- `tsc --noEmit`: 0 xato
- Acceptance: E-faza uchun alohida bo'lim + ikkala agent imzosi

## 11. Qaror kutilmoqda

- [ ] Operator: E-faza boshlanadimi, qaysi E-x birinchi?
- [x] wsl: tartib va egallik bo'yicha rozilik berildi (23:02) — tuzatishlar yuqorida (hajm/xavf, E-03 DSAR, E-06 KMS)

---

*wsl qo'shimchasi (23:02): umumiy tartib MA'QUL; tuzatishlar — E-01 L hajm (bo'linadi), E-03 FCM/APNs tanlovi + DSAR token=PII, E-06 cloud KMS skop, har E-x ga hajm/xavf bahosi qo'shildi.*
