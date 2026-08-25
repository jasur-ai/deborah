# Edikit Auth — Global Gigantlar Deep Research (haqiqiy manbalar bilan)

> **Sana:** 2026-08-03
> **Metod:** 18 ta jonli web-search, 50+ manba (NIST, OWASP, OAuth/RFC, Microsoft Entra, Google/Yahoo, Postmark/SES, Auth0, GitHub, Cloudflare, Dropbox/zxcvbn). Har bir qaror — manbaga tayanadi, xotiradan emas.
> **Maqsad:** auth tizimining HAR bir qismini global gigantlar (Google, GitHub, Apple, Microsoft, Stripe, Auth0) qanday qilsa, shu darajada qurish.

---

## 1. Parol siyosati — NIST SP 800-63B Rev 4 (2025, joriy standart)

> Manba: pages.nist.gov/800-63-4 (rasmiy), captaindns.com, inventivehq.com, passwordstrength.io, netwrix.com, cybersecuritynews.com

**NIST 2025 qoidalari (SHALL/SHOULD):**
- **Uzunlik:** single-factor parol — **minimum 15 belgi** (SHOULD), MFA bilan — **minimum 8**; **maksimum kamida 64** (passphrase qo'llab-quvvatlash).
- **Tarkib qoidalari (complexity):** **TAQIQLANGAN** (SHALL NOT) — "1 katta harf + 1 raqam + 1 belgi" talabi olib tashlandi. Sabab: bunday qoidalar "P@ssw0rd1!" kabi bashorat qilish oson parollarni keltirib chiqaradi (research dalil).
- **Davriy o'zgartirish (90 kun):** **TAQIQLANGAN** (SHALL NOT) — faqat kompromat isboti bo'lganda o'zgartiriladi.
- **Breach screening:** har yangi parol **keng tarqalgan/breach bo'lganlar ro'yxatiga solishtirilishi SHART** (Pwned Passwords, k-anonymity).
- **Hints va security questions:** **TAQIQLANGAN**.
- **Unicode/space:** qabul qilinishi SHART.
- **Show password toggle:** rag'batlantiriladi; paste ruxsat — SHALL.
- **OWASP ASVS 5.0:** min 8 (MFA) / 15 (single-factor); Argon2id tavsiya (SHA-256 standalone — yo'q).
- **ANSSI:** 12 (adminlar 16); BSI moslashmoqda.

**Edikit uchun qaror (NIST/OWASP):**
1. Parol min: **15 belgi** (MFA yo'q bo'lsa) / **8 belgi** (MFA ulangan bo'lsa) — dynamic policy.
2. Complexity talabi YO'Q (zamonaviy).
3. Maks: **128** qabul (OWASP ASVS); silently truncate qilma.
4. Davriy o'zgartirish YO'Q — faqat kompromat bo'lganda.
5. **HIBP Pwned Passwords** — k-anonymity API (SHA-1 prefix 5 belgi) — ro'yxatda va o'zgartirishda tekshirish.
6. **zxcvbn-ts** (Dropbox) — kuch indikatori (score 0-4; admin uchun 4 talab).
7. Hints/security questions — YO'Q.
8. Argon2id (mavjud) + per-user salt.

---

## 2. Login endpoint — OWASP Authentication Cheat Sheet

> Manba: github.com/OWASP/CheatSheetSeries (Authentication, Session Management, MFA, Forgot Password), mojoauth.com

**Enumeration himoyasi (Top-10 xato):**
- Bitta xabar: "Invalid email or password" — mavjud/yo'q bir xil.
- **Vaqt normalizatsiyasi:** "email topilmadi" tezroq qaytmasligi uchun — **har doim bcrypt/argon2 dummy hash'ga compare** qilish (timing attack qarshi). MojoAuth misoli: `dummyHash` bilan normalize.
- Bir xil HTTP status + body + vaqt.
- Rate limit barcha auth endpointlarda (login, register, forgot, OTP-verify).

**Username/User ID:**
- Case-insensitive username ("smith" = "Smith"); unique.
- User ID — random, predictable emas.

**Password change:**
- Joriy parolni verify qilish SHART (public kompyuter abuse case — OWASP).
- Yangi parol eski bilan bir xil bo'lmasin (reuse check).

**TLS:** login form action HTTPS; hech qachon HTTP'da POST.

**MFA:** Microsoft dalili — **MFA 99.9% account compromise'ni bloklaydi**. OWASP: admin/privileged uchun majburiy; TOTP tavsiya; SMS faqat fallback; phishing-resistant (FIDO2/passkey) preferred.

**Session (OWASP Session Management):**
- Yangi session ID **har login/privilege change** (session fixation).
- Logout — server-side invalidate (cookie tozalash yetarli emas).
- **Idle timeout** + **absolute timeout** + **renewal timeout** (session ID mid-session rotate).
- **Re-authentication** sensitive amallar uchun (parol/email o'zgartirish, to'lov) — current password yoki MFA.
- Session ID entropy: 64+ bit (10000 guess/s da 585 yil).

---

## 3. Forgot Password — OWASP Forgot Password Cheat Sheet

> Manba: cheatsheetseries.owasp.org/forgot_password, onlinehashcrack.com, security.stackexchange, mojoauth

**Majburiy qoidalar:**
- **Bir xil javob** mavjud/yo'q akkaunt uchun: "Agar akkaunt mavjud bo'lsa, havola yuborildi".
- **Bir xil vaqt** (async yoki bir xil logika — quick exit yo'q).
- **Token:** CSPRNG (crypto.randomBytes), **128+ bit entropy** (22+ belgi base64url), **bitta foydalanish**, **15-60 daqiqa expiry** (high-risk 15 daqiqa), DB'da hash saqlash (parol kabi).
- Token URL: HTTPS, Referrer-Policy: no-referrer, Host header injection qarshi (hardcoded/allowlist domain), **brute-force qarshi rate limit**.
- **Rate limit per-account** (email spam qarshi — OWASP issue #965: "thousands of reset emails flooding user").
- **Akkauntni token'siz o'zgartirma** (lockout emas).
- Parolni emailda yuborish — YO'Q; faqat "parol tiklandi" xabari.
- **Avtomatik login qilma** (OWASP tavsiyasi: reset'dan keyin odatdagi login; avtomatik login complexity oshiradi). *Eslatma: ba'zi platformalar avtomatik login qiladi (Authgear), lekin OWASP xavfsizroq deb hisoblaydi — qaror operatorga.*
- Sessiyalarni invalidatsiya — so'ra yoki avtomatik.
- Security questions — yagona usul emas (guessing oson).

**Edikit qaror:**
- Token 32-byte (256-bit), 15 daqiqa, 1 marta, DB'da hash.
- Bir xil javob + vaqt (dummy lookup).
- Rate limit: per-account 3/soat + CAPTCHA (Turnstile) yuqori xavfda.
- Reset'dan keyin: sessiyalar revoke; **avtomatik login — OWASP tavsiyasiga ko'ra yo'q** (odatdagi login; UX'da "endi kiring").
- Referrer-Policy: no-referrer; HTTPS; domain allowlist.

---

## 4. OAuth 2.1 / OIDC — RFC 9700 (2025), OAuth 2.1 draft

> Manba: dev.to/pockit_tools (OAuth 2.1 checklist), sujeet.pro (RFC 9700), decryptiondigest.com, oneuptime.com, github.com/OWASP

**OAuth 2.1 majburiy checklist (RFC 9700 / BCP):**
- **PKCE (S256)** — barcha clientlar uchun MUST (plain emas, faqat S256).
- **Implicit grant** (`response_type=token`) — O'CHIRILGAN (error qaytar).
- **ROPC** (`grant_type=password`) — O'CHIRILGAN.
- **Redirect URI — exact string match**, wildcard/regex YO'Q.
- **Bearer token URL query'da** — MUST NOT; faqat Authorization header.
- **Refresh token rotation** — public clientlar uchun MUST; **rotated token qayta ishlatilsa = kompromat signali** (butun zanjir invalidate).
- **state** — CSRF qarshi (32B random).
- **nonce** — OIDC replay qarshi (ID token'da bo'lishi shart).
- **Token olish server-side** (OIDC token endpoint CORS yo'q).
- Access token 15 daqiqa; refresh 8-24 soat (web).
- **JWKS/iss/aud/exp verify** — kid/alg qat'iy (HS256 qabul qilinmasin).
- PKCE verifier — sessionStorage (localStorage emas).
- `client_secret` SPA'da — YO'Q (false security).

**Edikit (Google OIDC) qaror:**
- PKCE S256 (mavjud reja) + state 32B + nonce 32B.
- ID token verify: iss/aud/exp/nonce + JWKS (kid) — alg allowlist (RS256).
- Redirect URI exact match.
- Token exchange server-side; Google token hech qachon frontend'da.
- Refresh token (agar Google beradi) — rotation.

---

## 5. Email infratuzilmasi — deliverability (Google/Yahoo 2024 qoidalari)

> Manba: staticforms.dev, mailtrap.io, emailvendorselection.com, mailflowauthority.com, saleshive.com, smtp2go.com

**Google/Yahoo 2024 sender qoidalari (5000+/kun):**
- SPF + DKIM majburiy; DMARC (kamida p=none); spam complaint <0.1-0.3%; one-click unsubscribe (bulk).

**Best practices:**
- **Transaction email va marketing AYRILADI** (Postmark/SES yondashuvi) — aralashsa spam trap bir IP'ni blacklist qiladi (real voqea: "SaaS lost password reset delivery for 48 hours").
- **SPF + DKIM + DMARC** — authenticated domain'lar 2.7x ko'proq inbox'ga tushadi.
- **Postmark** — eng yuqori inbox placement (~90-93%); **SES** — eng arzon ($0.10/1K); Mailer To Go — zero-config.
- **Bounce handling:** hard bounce darhol suppress; webhook'lar (delivery/bounce/complaint).
- **Double opt-in** — email verification (address validity + deliverability).
- **Real-time email validation** signup'da (syntax + MX + disposable) — bounce'larni oldini oladi.
- Dedicated sending domain: `mail.edikit.uz` (main domain reputation'ni himoya).

**Edikit qaror:**
- Provider: **Postmark** (transactional-only, eng yaxshi deliverability) yoki SES (arzon, self-managed) — qaror migratsiyaga ko'ra.
- SPF+DKIM+DMARC (p=none → quarantine → reject, DMARC reportlar monitoring).
- Transaction email stream alohida (marketing bilan aralashmaydi).
- Webhooks: delivery/bounce/complaint → suppress + alert.
- Email validation: syntax + MX + disposable (register'da), SMTP probe async.

---

## 6. Session va cookie hardening

> Manba: inventivehq.com, howhttpworks.com, barrion.io, wardeck.io

**Cookie qoidalari:**
- Session cookie: `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=...` — hammasi.
- **`__Host-` prefix** — eng kuchli: Secure + Path=/ + no Domain (subdomain cookie injection qarshi).
- SameSite=Strict — admin/banking; Lax — default.
- SameSite=None — faqat Secure bilan (aks holda browser drop).
- **Server-side expiry** — cookie lifetime client hint, security emas; server idle+absolute timeout qiladi.
- Cookie <4KB; sensitive data cookie'da emas (session id key).
- Remember-me: **selector + verifier** (random token, DB'da hash), 30 kun max, device-bound, har ishlatishda regenerate; high-privilege amallar uchun full session talab.
- CSRF token: non-HttpOnly cookie + header (double-submit) yoki SameSite + token.

**Session (OWASP + barrion):**
- Idle timeout (30 daqiqa) + absolute timeout (12 soat) + renewal (mid-session rotate).
- Logout — server-side invalidate + cookie clear.
- Session binding: device fingerprint (UA + IP hash) — mismatch → step-up.

**Edikit qaror:**
- `__Host-session` cookie (P2; production domain tayyor bo'lganda).
- Remember-me: selector+verifier, 30 kun, rotation, DB hash.
- Idle 30 daqiqa + absolute 12 soat; sensitive amallarda re-auth.

---

## 7. Brute force / ATO himoyasi — layered

> Manba: abnormal.ai, whiteintel.io, cside.com, humansecurity.com, OWASP Automated Threats

**3 qatlam (prevent/detect/respond):**
- **Prevent:** MFA/passkeys; rate limit auth endpointlarda; IP/device reputation; short session.
- **Detect:** **risk-based authentication** (device fingerprint, impossible travel, velocity, VPN/proxy, time-of-access); credential stuffing pattern (bir parol ko'p username'da); behavioral baseline.
- **Respond:** step-up MFA (risk yuqori bo'lsa), session revoke, forced re-auth, user notification.
- **Credential stuffing:** NIST per-account limit + CAPTCHA + device fingerprint + IP reputation (per-IP limit yolg'iz yetarli emas — distributed).
- **OTP bombing:** rate limit verify endpointlari.

**Edikit qaror (P1/P2):**
- Rate limit: per-IP + per-account + per-ASN (distributed uchun).
- Risk scoring (P2): device fingerprint, geo, velocity → step-up MFA/CAPTCHA.
- Notify user (P1): "new device login" (mavjud reja).
- Turnstile (Cloudflare) — signup/login yuqori xavfda.

---

## 8. Email verification / disposable blok

> Manba: gamalogic.com, bulkemailchecker.com, reform.app, truelist.io

- Syntax → domain → MX → disposable → role → SMTP probe (async).
- **Disposable blok** (temp-mail, mailinator) — hard block (yoki soft).
- Real-time check (200ms) sync + SMTP async.
- Double opt-in (Google/Yahoo yo'nalishi).
- Typo suggestion ("gmial.com" → "gmail.com").
- Cache 24 soat.

**Edikit qaror:** syntax+MX+disposable sync (register), SMTP async; typo suggestion; double opt-in verify.

---

## 9. Role approval workflow — Microsoft Entra PIM patterni

> Manba: learn.microsoft.com (Entra PIM approval), Azure Admin Consent Workflow, r/sysadmin

**Microsoft Entra PIM (privileged role approval):**
- Role activation uchun approval talab; **delegated approvers** (bir yoki bir nechta).
- Approver email notification; pending request ro'yxati.
- **24 soat approval window** — o'tib ketsa qayta submit.
- Approver o'z requestini approve qilolmaydi.
- Approve/deny + justification; **audit** (kim, qachon, sabab).
- **Admin Consent Workflow:** reviewer'lar tayinlanadi; email notification; reminder; **expiration period** (pending request avtomatik expire).

**Edikit teacher approval qaror (Entra PIM asosida):**
- `teacher_pending` → admin approve/reject + justification.
- **Approval window: 72 soat** (Entra 24 soatdan uzunroq — OTM konteksti); o'tib ketsa — qayta ariza yoki avtomatik eslatma.
- Approver (admin) o'z arizasini approve qilolmaydi.
- Email notification + reminder (24s/48s).
- Expiration: 7 kun ichida ko'rib chiqilmasa — eskalatsiya (super-admin).
- Audit: teacher_approved/rejected (admin_id, ts, justification).
- Rejected: sabab ko'rinadi; cooldown 30 kun; appeal (support).

---

## 10. Passkeys / WebAuthn — UX best practices

> Manba: veduis.com, dev.to/pockit_tools, dev.to/alanwest, reddit r/webdev PSA, simplewebauthn

- **Conditional UI** (`autocomplete="username webauthn"`, webauthn oxirida) — sahnada yuklanganda init (click emas); AbortController.
- **LEKIN: Conditional UI yagona emas** (reddit PSA) — **modal "Sign in with passkey" tugmasi ham** (hardware key / cross-device uchun) — 2 usul ham.
- **counter monotonic** — eski counter rad.
- **Recovery:** recovery codes (hash saqlash) + magic link + identity verification; **kamida 2 passkey** tavsiya.
- **Kamida 1 boshqa auth usuli** — faqat passkey bo'lsa lockout xavfi.
- Passkeylar ro'yxati/settings sahifasi (ko'rish, o'chirish).
- Registration nudge — login'dan keyin (signup'ni buzmaydi).
- `browserSupportsWebAuthnAutofill` feature detection → fallback button.

---

## 11. Xulosa — Edikit auth uchun global gigant darajasi

| Qism | Global gigant qiladi | Edikit qarori |
|---|---|---|
| Parol | NIST-15/8, breach check, zxcvbn, no rotation | 15/8 dynamic, HIBP, zxcvbn-ts |
| Enumeration | bir xil javob+vaqt, dummy hash | dummy argon2 compare |
| OIDC | PKCE S256, exact redirect, JWKS, rotation | Google OIDC to'liq |
| Email | SPF/DKIM/DMARC, transactional alohida, bounce webhook | Postmark/SES + auth |
| Session | __Host-, idle+absolute, remember selector/verifier | __Host-session, selector/verifier |
| ATO | risk-based, device fingerprint, step-up | P1/P2 layered |
| Forgot | 128-bit token, 15 daq, 1 marta, bir xil javob | OWASP to'liq |
| Approval | Entra PIM: window, justification, audit | teacher approval 72s, audit |
| Passkey | Conditional+modal, recovery codes, counter | 2 usul + recovery |

**Manbalar (to'liq):** NIST SP 800-63B-4 (pages.nist.gov), OWASP CheatSheetSeries (github), RFC 9700/OAuth 2.1, Microsoft Entra PIM docs, Google/Yahoo 2024 sender rules, Postmark/Mailtrap/SMTP2GO tests, Auth0/Okta docs, Dropbox zxcvbn, simplewebauthn, Cloudflare Turnstile, GitHub Docs (OAuth), MojoAuth (auth API mistakes), Abnormal/HUMAN/cside (ATO), wardeck/barrion/inventivehq (cookies).

---

## 12. MFA/TOTP — production darajasi (OWASP MFA + real implementation)

> Manba: OWASP MFA Cheat Sheet, claudecode-lab.com (2FA data model), tech-insider.org (12-step TOTP), oloid.com, workos.com, stytch.com, security.stackexchange

**Enrollment (ikki fazali — production):**
1. Setup: TOTP secret (AES-256-GCM encrypt), QR + Base32 manual key.
2. **Enable faqat birinchi kod verify'dan keyin** (pending → active) — "skeipping this locks real users out on day one" (eng katta xato).
3. **Backup/recovery codes:** enrollment'da 10 ta, **faqat bir marta ko'rsatiladi**, DB'da faqat **HMAC-SHA256 hash**; "saved" acknowledgement majburiy (checkbox yoki kod qayta kiritish).
4. **Kamida 2 factor** tavsiya (TOTP app + backup codes yoki hardware key + phone) — bitta phone yo'qolsa lockout.

**Login challenge:**
- Parol va TOTP **ikki alohida qadam**; session FAQAT ikkalasi o'tgach beriladi (majburiy — "if session is valid at password stage, MFA is decorative").
- TOTP verify: `valid_window=1` (90 soniya; +/- 1 step — keng window phish riskini oshiradi).
- **Rate limit:** 5 xato → 15 daqiqa lockout (6 xonali kod 1 mln kombinatsiya — himoyasiz endpoint oson brute-force).
- Backup code ishlatilsa — shu zahoti used mark (replay yo'q).
- Challenge ID consumed (never reuse) — WorkOS.
- Muvaffaqiyatda attempt counter reset.

**Recovery / MFA reset (eng zaif nuqta):**
- Recovery codes birinchi; yo'q bo'lsa — **multi-signal identity verification**: support ticket + ID, time-delayed (48-72 soat) + notification barcha email'larga + cancel imkoniyati.
- **Password reset va MFA reset AYRILADI** (security.stackexchange): email'ni o'g'irlagan attacker MFA'siz reset qila olmasin — reset link faqat parolni, MFA hali login'da talab.
- Factor replacement: **reauth with existing factor** (session yetarli emas), risk-based (new device), out-of-band notification, high-value delay.
- Admin approval MFA reset high-privilege uchun (social engineering qarshi).

**Step-up auth (sensitive actions):**
- Admin invites, password change, email change, API key, data export, teacher approve — **fresh MFA challenge talab** (mfaAt freshness).
- Session'da `mfaAt` saqlanadi; sensitive amalda mfaAt eskirgan bo'lsa → qayta challenge.

**Audit:** enable/disable/failed challenge/recovery/factor change — hammasi log (IP, UA, ts, method).

---

## 13. Risk-based authentication + device fingerprint (P2)

> Manba: nhimg.org (privacy tradeoffs), descope.com (riskInfo), fluxforce.ai, fingerprint.com, unit21, stackademic

**Device fingerprint (nima):**
- Kompozit identifier: screen, GPU, codecs, audio, OS, connectivity, storage — "not perfect uniqueness, stable recognition".
- **Probabilistic trust signal** — identity dalili emas; risk engine'ga kirish.
- Privacy: GDPR/CCPA — purpose limitation, data minimization, retention; UZ data law ham.

**Risk tiers (fluxforce — binary emas):**
- trusted → seamless; unknown → step-up; suspicious → challenge; blocked → block+alert.
- Risk score 0-1 (descope) yoki 0-100 (unit21).

**Signals:**
- **Impossible travel** (geo+time): "login from Tashkent then 10 min later London" → flag.
- **Velocity**: bir device ko'p IP/country qisqa vaqt; bir IP ko'p account'da fail (credential stuffing).
- **New device** (fingerprint mismatch): session'da fingerprint o'zgarishi → hijack signal → step-up.
- **Bot detection** (Turnstile/Cloudflare), VPN/proxy, dev tools.
- **Behavioral** (typing, mouse) — P3, ML.

**Response (friction faqat risk yuqorida):**
- Low risk: seamless. Medium: step-up MFA/CAPTCHA. High: block + alert.
- Fokus: account creation, checkout, password reset — high-risk actions.

**Edikit uchun (P2):**
- FingerprintJS (open source) yoki o'z lightweight fingerprint (canvas/WebGL/UA stable hash).
- Risk score server'da: signals (new device, geo, velocity, bot) → 0-1.
- Threshold: <0.3 seamless; 0.3-0.7 step-up MFA; >0.7 block+alert.
- **Privacy:** faqat security purpose, UZ'da saqlash, DSAR; fingerprint hash (raw telemetry emas).
- Impossible travel: IP geolocation (lokal DB) + timestamp — server-side.

---

## 14. Admin hardening + account security events (P1/P2)

> Manba: OWASP (admin MFA mandatory), howhttpworks (SameSite Strict), barrion.io, Microsoft (MFA 99.9%)

**Admin/teacher privilege:**
- MFA **majburiy** (OWASP: privileged accounts) — passkey yoki TOTP.
- Session: SameSite=Strict, qisqa Max-Age, `__Host-` prefix; admin va user session AYRILADI.
- Admin login rate limit qattiqroq; IP allowlist (ixtiyoriy, OTM kontekstida).
- Re-auth: teacher approve, user o'chirish, security settings — fresh MFA.
- Admin login audit: har bir amal.

**Account security events (user notification):**
- Password change → email/Telegram "Parolingiz o'zgartirildi" (agar siz qilmagan bo'lsangiz — support).
- Email change → **ikkala (eski+yangi) address'ga tasdiqlash** (OWASP: email = recovery; o'g'irlangan session email'ni o'zgartirib lockout qilmasin).
- New device login (mavjud), MFA change, suspicious login → out-of-band notification.
- **Password breach detected (login'da):** parol HIBP'da topilsa (async) → "Parolingiz breach'da — o'zgartiring" + forced reset flow (P1).

**Email change flow (OWASP):**
- Reauth (current password/MFA) → new email'ga verify code (double opt-in) → eski email'ga xabar → commit.
- Rate limit; audit.

**Session renewal (OWASP Session):**
- Mid-session ID rotation (renewal timeout) — hijack window kamayadi; eski ID qisqa safety interval davomida amal qiladi.
- Logout → barcha cookie'lar clear (session + remember).

---

## 15. Xulosa — massive auth qatlamlari (to'liq xarita)

| Qatlam | Global gigant | Edikit prompt | Manba |
|---|---|---|---|
| Parol siyosati | NIST 15/8, HIBP, zxcvbn, no rotation | A-22 | NIST 800-63B-4 |
| Email infra | SPF/DKIM/DMARC, transactional, bounce | A-23 | Google/Yahoo 2024 |
| OIDC | PKCE S256, JWKS, exact redirect, rotation | A-24 | OAuth 2.1/RFC 9700 |
| Session | __Host-, idle+absolute+renewal, remember selector/verifier | A-25 | OWASP Session, wardeck |
| MFA/TOTP | pending→active, backup codes hash, 5x15 lockout, step-up | **A-26 (yangi)** | OWASP MFA, tech-insider |
| Passkey | Conditional+modal, counter, recovery, 2 passkey | **A-27 (yangi)** | simplewebauthn, reddit PSA |
| Risk-based | fingerprint, impossible travel, velocity, tiers | **A-28 (yangi)** | descope, fluxforce, fingerprint |
| Account events | password/email change notify, breach detect | **A-29 (yangi)** | OWASP, howhttpworks |
| Admin hardening | MFA mandatory, Strict, re-auth, audit | **A-30 (yangi)** | OWASP, Microsoft |
| Password change | current verify, reuse check, session invalidate | **A-31 (yangi)** | OWASP Auth |
| Email change | reauth, double opt-in, ikkala address | **A-32 (yangi)** | OWASP, howhttpworks |
| Final | massive regression + sign-off | **A-33 (yangi)** | barcha |
