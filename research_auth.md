# Edikit Auth/Integratsiya — QILINADIGAN ISHLAR (faqat amaliy reja)

> **Sana:** 2026-08-03
> **Qamrov:** Faqat qilinishi kerak bo'lgan ishlar — qanday qilinishi, qabul mezonlari bilan. Research/nega/qiyosiy tahlillar olib tashlandi.
> **Asosiy prinsip:** HEMIS'ga shartnomasiz ulanish — faqat xavfsiz yo'llar (eksport/import, ochiq ma'lumotlar, OAuth2 test). Skrepling/parol/undocumented endpoint — taqiqlangan.
> **Aloqador:** `hemis_github.md` (tyutor + GitHub resurslari), `plan_login.md`, `plan_register.md`.

---

## 1. Login tizimi (P0 — darhol)

### 1.1. Google OIDC — qilish

**Nima:** Google orqali kirish (bir tugma, ko'rinadigan).

**Qanday:**
1. `routes/oidc.js` — PKCE (code_verifier 43B), state 32B, nonce 32B; scope `openid email profile`.
2. Callback: ID token verify (iss/aud/exp/nonce), `email_verified === true` talab.
3. `users.google_sub` UNIQUE — mapping; topilmasa email bo'yicha bog'lash (verified), yo'q bo'lsa yangi account (rol tanlash).
4. Session regenerate + csrf yangi; redirect role bo'yicha (student→/panel, teacher→/teacher).
5. Login sahifasida Google tugmasi **doim ko'rinadi** (display:none yo'q), 44px, full-width.
6. Rate limit: /auth/google 10/15 daqiqa.

**Qabul mezonlari:**
- [ ] PKCE+state+nonce verify testlari yashil
- [ ] email_verified=false → aniq xato + parol fallback
- [ ] Google tugma ko'rinadi (grep display:none yo'q)
- [ ] OIDC token frontend'ga chiqmaydi; refresh token server KMS

### 1.2. Username + parol — qilish (NIST SP 800-63B-4 / OWASP darajasi)

**Parol siyosati (NIST 2025):**
1. **Min uzunlik:** MFA yo'q bo'lsa **15 belgi**; MFA ulangan bo'lsa **8 belgi** (dynamic — users.twofa_enabled ga qarab). OWASP ASVS: 128 max (silently truncate yo'q).
2. **Complexity qoidalari YO'Q** (NIST SHALL NOT) — "1 katta harf + 1 raqam + 1 belgi" talab qilinmaydi (research: bunday qoidalar zaif parol keltiradi).
3. **Davriy o'zgartirish YO'Q** — faqat kompromat isboti bo'lganda (breach detected).
4. **HIBP Pwned Passwords** — k-anonymity (SHA-1 5-prefix → API) — ro'yxatda va parol o'zgartirishda tekshirish; breach'da bo'lsa rad.
5. **zxcvbn-ts** (Dropbox) — kuch indikatori (score 0-4; admin uchun score 4 talab) — complexity qoidalari o'rniga.
6. Hints / security questions — YO'Q (NIST prohibited).
7. Unicode + space qabul (har code point 1 belgi).
8. Argon2id (mavjud) + per-user salt; **timing-safe compare** (dummy hash) — enumeration qarshi.

**Login endpoint (OWASP):**
1. `autocomplete="username"` + `autocomplete="current-password"`; show/hide; paste ruxsat (NIST SHALL).
2. Inline xatolar (14 holat) — input saqlanadi; xato + yechim har doim.
3. **Enumeration:** "Invalid username or password" bitta xabar + **dummy argon2 compare** (mavjud/yo'q bir xil vaqt — timing attack qarshi).
4. Session regenerate; `__Host-session` cookie (P2) httpOnly/sameSite=Lax/secure; Redis session (TTL remember 30 kun / seans 8 soat).
5. Rate limit: per-IP 5 xato/15 daqiqa→5 daqiqa lockout; per-user 10→15; **per-ASN** (distributed brute force qarshi).
6. Password change: joriy parol verify SHART (OWASP abuse case); reuse check (eski bilan bir xil emas).
7. Login'da MFA step-up (admin/teacher P2) — Microsoft dalili: MFA 99.9% compromise bloklaydi.

**Qabul mezonlari:**
- [ ] Min 15/8 dynamic + HIBP + zxcvbn ishlaydi
- [ ] Dummy-hash timing test (mavjud/yo'q bir xil vaqt)
- [ ] Lockout + Retry-After + countdown UI; per-ASN limit
- [ ] Enumeration test yashil; session fixation yashil
- [ ] Password change joriy parol verify

### 1.3. Telegram OTP — P3 (mahalliy)

**Qanday:**
1. Bot token `.env`; `POST /auth/telegram/start {phone}` → t.me/EdikitBot?start=<token 20B, 5 daqiqa, 1 marta>.
2. Bot callback signed (HMAC) — verify; `POST /auth/telegram/verify {telegram_id, code}` — 6-kod, hash saqlash.
3. `users.telegram_id` UNIQUE; mapping; session regenerate.
4. Step-up: high-stakes (summative/admin) uchun telegram_id o'zi identity emas — phone/JSHSHIR qo'shimcha.
5. Rate limit: start 5/15, verify 5/15.

**Qabul mezonlari:**
- [ ] Signed callback verify; kod bitta foydalanish
- [ ] Telegram hijack qarshi step-up qoidasi
- [ ] Kod hech qachon logga

### 1.4. Passkey (WebAuthn) — P2

**Qanday:**
1. `passkey_credentials` jadvali (credential_id base64url UNIQUE, public_key, counter, aaguid).
2. Register/login: challenge 32B (bitta foydalanish), verify origin/rpId/counter(monotonic).
3. Conditional UI: `autocomplete="email webauthn"` (webauthn oxirida); fallback parol/Google.
4. Nudge: register va recovery'da "choice default" (salbiy framing yo'q).
5. 2FA step-up: admin/teacher high-stakes uchun.

**Qabul mezonlari:**
- [ ] counter monotonic; replay rad
- [ ] Windows 10 / iOS 17.4.1 fallback testlari
- [ ] nudge adoption metrikasi (passkey_created)

---


## 1b. Register + email + Teacher approval (P0 — MUHIM BO'SHLIQ)

> **2026-08-03 foydalanuvchi eslatmasi:** login/register mantig'ida 3 ta bo'shliq aniqlandi va tuzatildi:
> (1) teacher ham user — lekin **admin tasdiqlashi shart** (resurslar cheklangan); (2) register'da **email majburiy** yig'ish (parol tiklash uchun); (3) **parol tiklash email orqali**.

### 1b.1. Register (email majburiy + verify)

**Nima:** Yangi user ro'yxatdan o'tganda email majburiy so'raladi va tasdiqlanadi — parol tiklash va xabarlar uchun asos.

**Qanday:**
1. Register formasi: rol (student/teacher), ism, username, **email (majburiy)**, parol (min 8 + 1 harf + 1 raqam), invite kod (ixtiyoriy), honeypot.
2. Zod: `registerSchema` — email format + unique; username unique (safeKey).
3. Google register: email OIDC claims'dan (email_verified=true) — qo'shimcha verify shart emas.
4. Parol register: **email verify** — 6-kod emailga (15 daqiqa, hash saqlash, 1 marta); `users.email_verified`.
5. Verify UX: "Tasdiqlash kodi: 123456" + resend timer 60s; limited mode (verify'siz — o'qish/practice ruxsat, summative blok).
6. Legacy user'lar (email'siz): login'da "Email bog'lang" so'rovi (P1) — parol tiklash uchun shart.

**Qabul mezonlari:**
- [ ] Email majburiy + unique + verify ishlaydi
- [ ] Legacy user'lar email bog'lash yo'li bor
- [ ] Verify: 6-kod, resend, limited mode

### 1b.2. Teacher approval flow (Microsoft Entra PIM darajasi)

**Nima:** "Teacher" roli — hamma uchun ochiq emas; admin tasdiqlaganidan keyin beriladi (resurslar cheklangan). Pattern: Microsoft Entra PIM privileged role approval.

**Qanday:**
1. `users.role`: `student` (avtomatik), `teacher_pending`, `teacher` (approved), `teacher_rejected`.
2. Teacher register → `teacher_pending`; login'da **cheklangan rejim**: "Arizangiz ko'rib chiqilmoqda — odatda 1-3 ish kuni"; test yaratish/cast/student data blok; har bloklangan amalda aniq xabar.
3. **Approval window: 72 soat** (Entra 24 soat asosida, OTM konteksti) — o'tib ketsa avtomatik eslatma; 7 kun → **eskalatsiya** (super-admin).
4. **Approver:** admin; **o'z arizasini approve qilolmaydi** (Entra qoidasi).
5. Admin panel: "Teacher arizalari" — ro'yxat (ism, email, universitet, fan, tajriba, sana, ariza matni), filter/qidiruv/pagination; [Tasdiqlash] [Rad etish] + **justification (majburiy)**.
6. **Email notification** admin'ga (yangi ariza) + **reminder** (24s/48s ko'rib chiqilmagan).
7. Tasdiqlanganda: role → `teacher`; xabar (email+Telegram): "Tabriklaymiz, o'qituvchi sifatida tasdiqlandingiz!"; welcome onboarding (birinchi test); limited mode o'chadi.
8. Rad etilganda: role → `teacher_rejected`; xabar: **sabab bilan** ("Fan dalillari yetarli emas"); **cooldown 30 kun**; appeal (support).
9. **Audit:** teacher_approved/rejected (admin_id, ts, justification) — Entra PIM audit darajasi.
10. Duplicate aniqlash: (email OR username) mavjud → "Akkauntingiz borga o'xshaydi" + login.
11. Bot himoya: honeypot + Turnstile + rate limit (3/soat per IP).
12. Co-teacher: teacher o'zi qo'shadi (P2) — admin emas.

**Qabul mezonlari:**
- [ ] pending → approved/rejected state machine to'liq; justification majburiy
- [ ] 72s approval window; reminder (24/48); eskalatsiya (7 kun)
- [ ] Approver o'z arizasini approve qilolmaydi
- [ ] Pending'da barcha teacher amallari blok (test/cast/student data)
- [ ] Rad etilganda sabab + cooldown 30 kun; appeal
- [ ] IDOR: non-admin approve 403; rejected student data ko'rmaydi
- [ ] Audit: admin_id + justification

### 1b.3. Parol tiklash — email orqali (OWASP Forgot Password darajasi)

**Nima:** Parol tiklash asosiy kanali — **verified email**. Telegram — fallback (agar ulangan).

**Qanday (OWASP majburiy):**
1. Forgot: username yoki **email** → users lookup → email verified bo'lsa → **emailga havola**.
2. **Token:** CSPRNG 32-byte (256-bit) → base64url 43 belgi → **DB'da hash** (parol kabi), **15 daqiqa expiry**, **1 marta foydalanish**.
3. **Bir xil javob + bir xil vaqt:** "Agar akkaunt mavjud bo'lsa, havola yuborildi" — dummy lookup bilan (async/bir xil logika).
4. **Rate limit per-account:** 3/soat + Turnstile (email spam/flood qarshi — OWASP issue #965).
5. **Reset URL:** HTTPS, `Referrer-Policy: no-referrer`, domain allowlist (Host header injection qarshi), token brute-force qarshi rate limit.
6. Email verified bo'lmasa → "Emailingizni tasdiqlang" yo'li (resend verify).
7. Email yo'q (legacy) → "Email bog'lang" + support; Telegram ulangan bo'lsa → Telegram orqali.
8. Reset ekran: yangi parol (NIST 15/8 + HIBP + zxcvbn) → Argon2 → eski tokenlar invalid → eski sessiyalar revoke.
9. **Reset'dan keyin avtomatik login YO'Q** (OWASP tavsiyasi: odatdagi login; "endi kiring" UX). Parolni emailda yuborish YO'Q — faqat "parol tiklandi" xabari.
10. Token'siz akkaunt o'zgartirilmaydi (lockout emas).

**Qabul mezonlari:**
- [ ] Token 256-bit, hash saqlash, 15 daqiqa, 1 marta
- [ ] Bir xil javob + vaqt (dummy); rate limit + Turnstile
- [ ] Referrer-Policy no-referrer; domain allowlist
- [ ] Reset'dan keyin sessiyalar revoke; avtomatik login yo'q
- [ ] Verify'siz → "Emailni tasdiqlang"; legacy → bog'lash/support

## 2. Parol tiklash (P0)

**Qanday:**
1. `routes/reset.js`: request/verify/complete; `reset_tokens` (48B hex, 15 daqiqa, 1 marta).
2. Forgot ekran (1 sahifa): account field; javob har doim "Agar akkaunt mavjud bo'lsa, havola yuborildi".
3. Reset ekran (1 sahifa): yangi parol (min 8 + 1 harf + 1 raqam, indikator, show/hide).
4. Complete: Argon2 hash, eski tokenlar invalid, **barcha eski sessiyalar revoke**, session regenerate, avtomatik login.
5. Rate limit: 3/soat (per account).

**Qabul mezonlari:**
- [ ] Flow <3 ekran; 75% drop-off qarshi (minimal)
- [ ] Enumeration himoya; bitta foydalanish; eski sessiya revoke
- [ ] Reset'dan keyin avtomatik login yangi sessiya

---

## 3. Session boshqaruvi (P0/P1)

**Qanday:**
1. Redis session (connect-redis): schema {id, userId, role, isVip, safeKey, csrfToken, oauth, remember, device{ua,ipHash,city}, createdAt, lastActive, expiresAt, revokedAt}.
2. Idle timeout 30 daqiqa (middleware lastActive touch throttled 5 daqiqa); UI ogohlantirish 60s oldin.
3. Parallel limit 5; 6-chisi → eng eski revoke.
4. `routes/session.js`: GET /sessions, POST /sessions/:id/revoke, POST /sessions/revoke-all.
5. New-device xabar: ip_hash/UA yangi → email/Telegram "Yangi qurilmadan kirish" (dedupe 24 soat).
6. `auth_audit` jadvali: action/outcome/method/ip_hash/detail — 30 kun retention; parol/token hech qachon logga.

**Qabul mezonlari:**
- [ ] IDOR test (boshqa user sessiyasi blok)
- [ ] Cookie httpOnly/secure/sameSite testlari
- [ ] Audit PII minimal (grep parol/token yo'q)

---

## 4. Roster import (P0 — HEMIS'siz, Yo'l A)

### 4.1. Excel/CSV import (asosiy)

**Nima:** O'qituvchi/admin HEMIS'dan eksport qilgan Excel'ni Edikit'ga yuklaydi → roster/guruh/kurs.

**Qanday:**
1. Upload: stream/pre-signed; MIME+magic bytes allowlist; size/row/sheet limit; formula execute YO'Q; antivirus/quarantine.
2. Parser: staging rows; Unicode/email/name normalizatsiya; mapping UI (column→field).
3. Diff: create/update/deactivate preview; admin approval; transactional idempotent commit.
4. Rollback: snapshot/compensating import.
5. Har talabaga invite (havola/kod) — email/Telegram; invite aktivatsiya (Google/parol → guruh prefilled).
6. HEMIS eksport formati bilan mos: HEMIS "Eksport tugmasi" → Excel (jamlanma qaydnoma, talabalar bazasi) — kolonkalar mapping.

**Qabul mezonlari:**
- [ ] Zip-bomb/makro/MIME spoof testlari yashil
- [ ] Preview→commit→rollback ishlaydi; idempotent (qayta yuklash duplicate emas)
- [ ] Invite: 1 marta, revoke, expiry 7 kun

---

## 5. Transkript/portfolio import (P1 — Yo'l A)

**Qanday:**
1. Talaba HEMIS'dan o'z transkripti/reyting daftarchasi/diplomini yuklab oladi (mobil ilova, @hemisedu_bot, `student.<otm>.uz/dashboard/diploma`).
2. Edikit'ga import: PDF parse / Excel / foydalanuvchi kiritadi (manual).
3. `portfolio_items` jadvali: kind (result/certificate/credential), title, evidence, is_public (default-private).
4. Foydalanuvchi roziligi bilan; PII minimal; DSAR qo'llab-quvvatlash.
5. UZ hududida saqlash (data governance).

**Qabul mezonlari:**
- [ ] PDF/Excel import ishlaydi (xavfsiz parse)
- [ ] Default-private; share auth; IDOR test
- [ ] DSAR export/delete

---



## 5b. Email infratuzilmasi (P0 — deliverability)

> Manba: Google/Yahoo 2024 sender rules, Postmark/Mailtrap/SMTP2GO, OWASP.

**Nima:** Parol tiklash, verify, welcome xabarlari — ishonchli yetib borishi shart (spam'ga tushmasa auth buziladi).

**Qanday:**
1. **Provider: Postmark** (transactional-only, ~93% inbox placement) yoki **SES** ($0.10/1K, self-managed) — qaror migratsiyaga ko'ra.
2. **SPF + DKIM + DMARC:** p=none → quarantine → reject (DMARC reportlar monitoring); dedicated sending domain `mail.edikit.uz`.
3. **Transaction va marketing AYRILADI** (Postmark/SES — aralashsa blacklist xavfi; real voqea: password reset 48 soat yetib bormagan).
4. **Bounce/complaint webhooks:** hard bounce → darhol suppress; complaint → alert (0.1% target — Google/Yahoo).
5. **Email validation signup'da:** syntax + MX + disposable (temp-mail blok) sync (200ms) + SMTP probe async; typo suggestion ("gmial.com" → "gmail.com"); cache 24 soat.
6. **Double opt-in:** verify 6-kod (email_verified) — address validity + deliverability.
7. Template: qisqa, clear, spam trigger yo'q; plain-text version.

**Qabul mezonlari:**
- [ ] SPF/DKIM/DMARC sozlangan; DMARC p=reject
- [ ] Transactional stream alohida; bounce suppress
- [ ] Disposable blok + typo suggestion; double opt-in
- [ ] Provider test (seed list) ≥90% inbox
## 6. Ochiq ma'lumotlar (P1 — Yo'l B, 0 shartnoma)

### 6.1. OTM ro'yxati + talabalar soni (landing stats)

**Qanday:**
1. Manba: `data.gov.uz/uz/datasets/14037` ("Oliy ta'lim muassasai") — barcha OTMlar, bakalavriat/magistratura soni (CSV/JSON).
2. `hemis.uz/universities` — ochiq (HTTP 200) OTM ro'yxati.
3. Landing stats: haqiqiy raqamlar (OTM soni, talabalar soni) — yolg'on emas.
4. Download/cache: har semestr yangilash; litsenziya (ochiq ma'lumotlar) hurmat.

**Qabul mezonlari:**
- [ ] Stats haqiqiy manbadan (grep yolg'on raqam yo'q)
- [ ] Cache + yangilash job ishlaydi

### 6.2. diplom.edu.uz tekshirish (P3 — Yo'l C)

**Qanday:**
1. `diplom.edu.uz` — diplom haqiqiyligini ochiq tekshirish (~2 mln bitiruvchi).
2. Portfolio'da "Tekshirilgan ✓" — talaba tekshiradi (OneID orqali kirish talab qilinishi mumkin).
3. **Geofence:** diplom.edu.uz faqat UZ IP'dan (451) — tekshiruv foydalanuvchi brauzeridan (talaba o'zi), serverdan emas.

**Qabul mezonlari:**
- [ ] Tekshiruv flow foydalanuvchi tomonida; natija Edikit'da saqlanadi
- [ ] Geofence sababli server-to-server emas

---

## 7. GitHub secret sinab ko'rish (P0 tekshiruv — xavfsiz tartib)

**Kontekst:** GitHub'da ochiq qolgan HEMIS client (`client_id=8`, `hemis-oauth` repo). Test natijasi: **client aktiv** (authorize → 302 login). Sinash — o'z test akkauntingiz bilan.

**Qanday (xavfsiz):**
1. **O'z test akkauntingiz bilan** (o'z OTM'ingiz talabasi/xodimi):
   - `GET student.hemis.uz/oauth/authorize?client_id=8&redirect_uri=<o'z redirect>&response_type=code`
   - Login (o'z akkaunti) → code → `POST /oauth/access-token` (client_id=8 + secret) → token
   - `GET /oauth/api/user?fields=...` → user ma'lumotlari
2. Natija qayd etiladi: secret to'g'ri/noto'g'ri; client ishlaydi/yo'q.
3. **Production'da ishlatilmaydi** (secret 4 yil ochiq — compromised); production uchun OTM'dan yangi client so'raladi.

**TAQIQLANADI:**
- ❌ Boshqa talabaning paroli bilan login
- ❌ `rest/docs` parolini buzish / undocumented endpoint
- ❌ Bu secret'ni production'da ishlatish
- ❌ GitHub'dagi boshqa test credential'lar

**Qabul mezonlari:**
- [ ] Sinov faqat o'z akkaunti bilan; natija hujjatlashtirilgan
- [ ] Hech qanday parol Edikit serverida saqlanmagan

---

## 8. HEMIS OAuth2 login (P2/P3 — OTM client bo'lsa, ixtiyoriy)

**Qanday:**
1. OTM admini o'z HEMIS panelida ("Tizim/oAuth klientlar") client yaratadi: nom + Edikit redirect URL → Client ID + Secret.
2. Edikit: standart OAuth2 authorization_code flow (hemis-oauth namunasiga asosan).
   - authorize: `https://student.hemis.uz/oauth/authorize`
   - token: `https://student.hemis.uz/oauth/access-token`
   - user: `https://student.hemis.uz/oauth/api/user?fields=id,uuid,university_id,type,firstname,surname,login,email,phone`
3. `users.hemis_id` UNIQUE; mapping; session regenerate.
4. **Geofence:** HEMIS faqat UZ IP'dan — server UZ'da yoki foydalanuvchi brauzeri orqali.
5. Client credential KMS/encrypted; redirect URI allowlist; PKCE qo'llab-quvvatlansa ishlatiladi.
6. OIDC `.well-known` yo'q — faqat OAuth2 (id_token yo'q, user endpoint orqali).

**Qabul mezonlari:**
- [ ] OTM client berilgan bo'lsa — flow ishlaydi (test OTM bilan)
- [ ] Geofence reja (UZ server/proxy)
- [ ] Credential KMS; redirect allowlist; IDOR

---

## 9. Geofence reja (majburiy — barcha HEMIS ulanishlari uchun)

**Topilma:** `univer.hemis.uz`, `diplom.edu.uz` → 451 "faqat O'zbekiston hududidan"; `student.hemis.uz` → 302 (ishlaydi); `hemis.uz`, `tyutor.hemis.uz` → 200 (ochiq).

**Qanday:**
1. HEMIS bilan server-to-server (OAuth callback, import) — **UZ'da joylashgan server/proxy** kerak.
2. Alternativa: foydalanuvchi brauzeri orqali (Yo'l A eksport/import — brauzer UZ'da, muammo yo'q).
3. Test muhitida: UZ proxy/VPN faqat test uchun (ishlab chiqarishda emas).
4. Hujjatlashtirish: qaysi endpoint geofenced (jadval).

**Qabul mezonlari:**
- [ ] Barcha HEMIS ulanishlarida geofence hisobga olingan
- [ ] Xorijiy serverdan HEMIS'ga to'g'ridan-to'g'ri ulanish yo'q (451 test)

---

## 10. Audit/security (barcha yuqoridagilar uchun umumiy)

**Qanday:**
1. `auth_audit`: barcha login/reset/revoke/passkey/telegram/oneid/hemis — success/fail/blocked; ip_hash; 30 kun.
2. Zod contract hamma payload; CSRF barcha POST; rate limit hamma write.
3. Log/audit'da secret/parol/token/OTP — hech qachon.
4. UZ data governance: PII (JSHSHIR, telegram_id, hemis_id, email) — UZ hududida, minimal, DSAR.
5. Landing copy: "HEMIS bilan integratsiya" yozilmaydi (dostup yo'q); "HEMIS bilan kirish" faqat OAuth ishga tushganda.

**Qabul mezonlari:**
- [ ] Secret scan (grep client_secret/parol yo'q)
- [ ] CSRF/rate-limit/audit testlari yashil
- [ ] PII minimal + DSAR

---

## 11. Bosqichlar jadvali

| # | Ish | Bosqich | Bog'liqlik |
|---|---|---|---|
| 1 | Google OIDC login | P0 | — |
| 2 | Username+parol+rehash | P0 | — |
| 3 | Parol tiklash (email orqali) | P0 | 2, 1b.1(email) |
| 3a | Register: email majburiy + verify | P0 | — |
| 3b | Teacher approval flow (admin) | P0 | 3a |
| 3c | Legacy user email bog'lash | P1 | 3a |
| 4 | Session (Redis/limit/audit) | P0/P1 | 1-3 |
| 5 | Roster Excel/CSV import | P0 | — |
| 6 | GitHub secret sinash (xavfsiz) | P0 tekshiruv | — |
| 7 | Ochiq ma'lumotlar (OTM stats) | P1 | — |
| 8 | Transkript/portfolio import | P1 | 5 |
| 9 | Passkey | P2 | 1-4 |
| 10 | Telegram OTP | P3 | 1-4 |
| 11 | diplom.edu.uz tekshirish | P3 | 8 |
| 12 | HEMIS OAuth2 login | P2/P3 (OTM client) | 4, 9-geofence |

---

## 12. Qilinmaydiganlar (aniq)

- ❌ HEMIS REST API (`rest/docs` parolli) — ochiq emas
- ❌ HEMIS sahifalarini skrepling / talaba parolini saqlash
- ❌ Undocumented/ichki endpoint'lar
- ❌ OneID (faqat rasmiy shartnoma bo'lsa)
- ❌ HEMIS data API (roster/reyting) — ochiq emas; eksport/import o'rnini bosadi
- ❌ GitHub'dagi ochiq secret'ni production'da ishlatish
