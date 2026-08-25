# Edikit Auth — E-Faza: Ekstra edge cases + chuqur detallar (E-00..E-50)

> **Maqsad:** Har bir auth sohasining edge case'lari, chuqur detallari, ekstra modullar — to'liqlik uchun.

---

## E-00 — E-Faza preflight

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: ekstra edge case'lar uchun inventarizatsiya.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Edge case inventarizatsiya: session, OAuth, email, MFA, passkey, rate, UX, integration, admin.
07. Qaysilari qurilgan, qaysilari yo'q — ro'yxat.
08. Test holati o'lcha.
09. Security/data guard: secret logga chiqmasin.
10. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
11. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
12. Unit test: smoke.
13. Integration/contract test: smoke.
14. E2E/security test: workspace toza.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-auth.md`ga E-00 statusi.
17. Global report formatida qaytar.
18. Stop condition: baseline ishga tushmasa.
19. Done condition: baseline, E-01 readiness.
20. Hech qanday kod o'zgartirmasdan yakunla.
21. Edge case inventarizatsiya jadvali: har mavzu — holat (qurilgan/yo'q), qaysi bosqichda, test qamrovi.
22. E-faza risklari: eng qiyin edge case'lar ro'yxati va ularga yondashuv.
23. Baseline snapshot (commit, test soni) saqlanadi — E-faza oxirida taqqoslanadi.
24. E-01 boshlashga tayyor ekanini dalil bilan yoz.
25. E-faza kalendar: qaysi edge case'lar qachon, qaysi test'lar CI'da — hujjatda.
26. E-faza risklari (eng qiyin edge case'lar) ro'yxati va ularga yondashuv yoziladi.
27. E-faza qamrovi bo'yicha so'nggi inventarizatsiya jadvali to'liq yoziladi.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-01 — Session edge: multi-tab, back/forward, duplicate login

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session edge case'larini qurish — multi-tab, back/forward, duplicate.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Multi-tab: bitta session, ikkala tab ishlaydi (session shared); logout bitta tab'da → ikkala 401 (server revoke).
07. Back/forward: login'dan keyin back → login sahifasi redirect /panel (redirectIfAuth); form resubmit himoya.
08. Duplicate login: 2 tab login → bitta session (yangi session regenerate, eski invalid — last-write).
09. Session race: parallel request — Redis atomic.
10. Tab sync: storage event (boshqa tab logout'da UI refresh) — P1.
11. Form resubmit: PRG pattern (post-redirect-get) — login/reset.
12. Test: 2 tab, back/forward, duplicate, race.
13. Security/data guard: server-authoritative; client UI faqat.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: duplicate login; race.
17. Integration/contract test: multi-tab; back.
18. E2E/security test: logout 2-tab; form resubmit.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-01 statusi.
21. Global report formatida qaytar.
22. Stop condition: session race bo'lsa.
23. Done condition: edge to'liq, testlar yashil.
24. E-02 uchun: OAuth edge'ga tayyor.
25. Tab sync: localStorage storage event — boshqa tab logout'da UI refresh (P1, no-op xavfsiz).
26. Form resubmit PRG: login/reset POST'dan keyin 303 redirect — refresh'da resubmit yo'q.
27. Back/forward cache (bfcache): auth sahifalar no-store (E-10) — parol ko'rinmasin.
28. Session race testi: 2 parallel revoke + 2 parallel login — bitta natija, race yo'q.
29. Metrics: multi_tab_conflict_count, session_race_detected.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-02 — OAuth/OIDC edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 4-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: OAuth edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. OAuth callback duplicate (ikki marta code): bitta code bir marta — ikkinchi rad (idempotency).
07. OAuth state expiry: state 10 daqiqa TTL — eskirgan → "qayta urinib ko'ring".
08. OAuth error callback (access_denied): yumshoq xabar + parol fallback.
09. Google hd policy: OTM domain (ixtiyoriy) — mos kelmasa aniq xato.
10. Refresh token rotation race: ikki tab refresh — mutex; rotated token qayta → kompromat (A-24).
11. Token clock skew: leeway 30s.
12. Callback URL tampering: exact match (A-24) — qayta test.
13. Multiple accounts (Google): ikki Google akkaunt — "qaysi bilan?" (Google handles).
14. Session'da oauth data cleanup: flow tugagach o'chirish.
15. Security/data guard: code bir marta; state TTL; token rotation.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: duplicate code; state expiry; rotation race.
19. Integration/contract test: error callback; hd policy.
20. E2E/security test: tampering; replay.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-02 statusi.
23. Global report formatida qaytar.
24. Stop condition: code replay bo'lsa.
25. Done condition: OAuth edge to'liq.
26. E-03 uchun: email edge'ga tayyor.
27. Code exchange xatosi (invalid grant): yumshoq xabar + log (PII yo'q).
28. IdP error variantlari (temporarily_unavailable): retry/backoff — user yumshoq.
29. OAuth flow cleanup: session'dan code_verifier/state o'chirilishi tekshiriladi (memory).
30. Metrics: oauth_callback_dup, oauth_state_expired, oauth_rotation_conflict.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-03 — Email edge cases (deliverability, spoof, bounces)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Spoofing (phishing Edikit nomidan): SPF/DKIM/DMARC (A-23) + SPF report monitoring; "Edikit hech qachon parol so'ramaydi" education.
07. Bounce on verify: email invalid → email_status=bounced → "Emailni tekshiring, yangilang" UX.
08. Bounce on reset: reset email bounce → support yo'li.
09. Email provider outage: fallback SMTP (config) — A-23; queue + retry.
10. Rate limit email (spam): send 3/soat (B-06); OTP bomb (C-06).
11. Template injection: user input (ism) — escape (XSS).
12. Unicode email: punycode domain — qabul (normalizatsiya).
13. Email case: local part case-sensitive? — qabul qilamiz (unique lower).
14. Header injection: user input email'da CRLF — validate (B-05).
15. Security/data guard: SPF/DKIM/DMARC; template escape; no header injection.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: spoof config; bounce; injection.
19. Integration/contract test: provider failover; bounce flow.
20. E2E/security test: template XSS; header injection.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-03 statusi.
23. Global report formatida qaytar.
24. Stop condition: injection bo'lsa.
25. Done condition: email edge to'liq.
26. E-04 uchun: MFA edge'ga tayyor.
27. Email preview: sensitive ma'lumot (OTP) email body'da, lekin log/preview'da yo'q.
28. Unsubscribe/abuse handling: complaint'da darhol suppress + review.
29. Unicode/punycode email testi: xn-- domain qabul va normalizatsiya (B-05).
30. Metrics: email_bounce_rate, email_complaint_rate, email_spoof_attempt_blocked.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-04 — MFA edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 12-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MFA edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. TOTP clock drift: per-user drift track; window +/-1 (90s); drift katta → aniq xabar.
07. TOTP replay (bir kod 2 marta): challenge consumed (A-26) — qayta test.
08. Backup codes: barchasi ishlatilsa → "Yangilari" (rotatsiya); bitta qolsa → eslatma.
09. MFA disable: reauth + "barcha sessiyalar revoke" (A-26) + notification.
10. MFA factor change (yangi phone): reauth + risk + delay + notification (A-26).
11. MFA reset abuse: support — ko'p reset so'rov → flag (social engineering).
12. MFA on password reset: reset parolni tiklaydi, MFA login'da hali (B-24 qoidasi).
13. Step-up expiry: mfaAt 30 daqiqa — sensitive amalda eskirgan → qayta challenge.
14. Security/data guard: challenge consumed; drift; notification.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: drift; replay; disable; reset abuse.
18. Integration/contract test: disable→revoke; factor change delay.
19. E2E/security test: replay; abuse flag.
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-04 statusi.
22. Global report formatida qaytar.
23. Stop condition: replay ochiq bo'lsa.
24. Done condition: MFA edge to'liq.
25. E-05 uchun: passkey edge'ga tayyor.
26. TOTP clock drift: valid_window=1 (30s) + server time — sync muammosi.
27. Backup code reuse: ishlatilgan kod qayta ishlatilmaydi (used flag, hash).
28. Step-up mfaAt: sensitive action'da eskirgan mfaAt → qayta MFA (A-26).
29. Metrics: mfa_attempt_fail, mfa_lockout_count, mfa_reset_requested.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-05 — Passkey edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: passkey edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Device loss: recovery codes + magic link (A-27); passkey yo'qolsa — boshqa usul.
07. Synced passkey (iCloud/Google): backed_up flag; sync'da duplicate — dedupe.
08. Cross-device: phone passkey → PC (QR/modal) — modal button (A-27).
09. Browser support: Windows 10 (no conditional), iOS 17.4.1 (Chrome bug) — fallback (A-27).
10. Attestation: 'none' (privacy) — aaguid optional.
11. Counter tampering: eski counter → rad (A-27).
12. Credential ID collision: UNIQUE (A-27) — qayta test.
13. Revoke: barcha sessiyalar revoke (B-25) — qayta test.
14. Registration abort: user cancel → yumshoq.
15. Security/data guard: counter; origin; credential private.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: dedupe; counter; browser matrix.
19. Integration/contract test: cross-device; revoke.
20. E2E/security test: tamper; collision.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-05 statusi.
23. Global report formatida qaytar.
24. Stop condition: counter bo'lmasa.
25. Done condition: passkey edge to'liq.
26. E-06 uchun: rate limit edge'ga tayyor.
27. Challenge expiry: passkey challenge 5 daqiqa TTL — eskirgan → qayta boshlash.
28. User verification: platform vs cross-platform authenticator (uv flag) — qabul siyosati.
29. Credential ID yopilganda: revoke'dan keyin credential login'da rad (server).
30. Metrics: passkey_register_abort, passkey_counter_rollback, passkey_dup_blocked.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-06 — Rate limit / abuse edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rate limit edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. IPv6: /64 subnet — per-IP hisoblash (maska).
07. X-Forwarded-For spoof: trust proxy sozlangan; client XFF ignored (faqat proxy).
08. Tor/exit node: yuqori risk — Turnstile.
09. Shared IP (kampus NAT): per-account asosiy (C-01) — false lockout yo'q.
10. Botnet distributed: per-ASN (C-01) — qayta test.
11. Rate limit bypass (Redis restart): counter yo'qolsa — per-account DB (qattiq) qoladi.
12. Rate limit on 401: fail'lar limitga kiradi (C-01).
13. Whitelist (ops): internal IP — config.
14. Header leak: X-RateLimit header'larida PII yo'q.
15. Security/data guard: per-account asosiy; spoof yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: IPv6; spoof; NAT.
19. Integration/contract test: botnet; restart.
20. E2E/security test: bypass emas.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-06 statusi.
23. Global report formatida qaytar.
24. Stop condition: XFF spoof bo'lsa.
25. Done condition: rate edge to'liq.
26. E-07 uchun: UX edge'ga tayyor.
27. IPv4-mapped IPv6 (::ffff:1.2.3.4): bitta hisob — normalizatsiya.
28. Rate limit header'larida user identifikatori yo'q (faqat limit/remaining/reset).
29. Whitelist ops IP: env'da (D-01), audit'da whitelist hit qayd qilinadi.
30. Metrics: rate_limit_hit_by_tier, xff_spoof_attempt, whitelist_hit.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-07 — Auth UX edge cases (user journey)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth UX edge case'larini qurish.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Caps Lock warning (parol field): "Caps Lock yoqilgan".
07. Paste parol (show/hide): paste ruxsat (NIST) — qayta test.
08. Password manager UX: autofill, "save password" prompt (browser).
09. Error focus: xato field'ga focus (A11y).
10. Empty state login: trust + yordam link.
11. Loading state: button spinner + disable.
12. Session expiry UX: "Sessiya tugadi — qayta kiring" (yumshoq, returnUrl).
13. Lockout UX: countdown + support (C-02).
14. Offline (auth): login offlayn emas; error yumshoq (retry).
15. Slow network: skeleton, timeout (10s).
16. Security/data guard: UX'da secret yo'q.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: caps lock; focus.
20. Integration/contract test: expiry; lockout.
21. E2E/security test: offline; slow.
22. Mavjud testlarni ham ishlat.
23. `implementation-status-auth.md`ga E-07 statusi.
24. Global report formatida qaytar.
25. Stop condition: UX test'siz bo'lsa.
26. Done condition: UX edge to'liq.
27. E-08 uchun: integration edge'ga tayyor.
28. Session expiry returnUrl: qayta kirishdan keyin asl sahifaga (allowlist, A-05).
29. Slow network: login 10s timeout xabari + retry; skeleton loading.
30. Error empathy: har xato uchun yechim yo'nalishi (support/help link).
31. Metrics: login_ux_error_rate, session_expiry_reauth_count.
32. Hisobot operator tasdig'i bilan yopiladi.
```

## E-08 — HEMIS/OpenData edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md` va `research_auth.md` 8, 9-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: HEMIS/OpenData edge case'larini qurish.
05. Precondition: C-10/11/13 yashil bo'lishi kerak.
06. HEMIS geofence (451): xorijiy server → "UZ server kerak" hujjat; foydalanuvchi brauzeri orqali.
07. HEMIS OAuth timeout: token exchange 10s timeout — retry/backoff.
08. HEMIS user fields missing (email yo'q): mapping email bo'lmasa → phone/username.
09. HEMIS client revoked: token 401 → "qayta ulang" + OTM'dan yangi.
10. HEMIS roster fayl: duplicate student_id — mapping konflikt (manual).
11. HEMIS fayl encoding: UTF-8/cp1251 — detect.
12. OpenData API down: eski cache (fail-soft) (C-13).
13. OpenData dataset change: schema version (C-13).
14. diplom.edu.uz: OneID'li — talaba o'zi; natija cache.
15. Security/data guard: HEMIS secret KMS; SSRF qarshi; geofence.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: timeout; fields missing; encoding.
19. Integration/contract test: client revoked; roster conflict.
20. E2E/security test: geofence; SSRF.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-08 statusi.
23. Global report formatida qaytar.
24. Stop condition: geofence/SSRF ochiq bo'lsa.
25. Done condition: integration edge to'liq.
26. E-09 uchun: admin edge'ga tayyor.
27. HEMIS OAuth user picture: external URL — referrer/no-cache, proxy qilmaslik (PII).
28. OpenData schema o'zgarishi: version check + migration (C-13).
29. Roster fayl kattaligi: 10MB limit, stream parse (A-10).
30. Metrics: hemis_timeout_count, hemis_client_revoked, open_data_stale.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-09 — Admin edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 14-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin edge case'larini qurish.
05. Precondition: C-07/08/09 yashil bo'lishi kerak.
06. Admin session expiry: qisqa (8 soat) — ish davomida qayta login.
07. Admin MFA reset (super-admin): ikki admin — biri MFA yo'qotsa, ikkinchisi approve.
08. Admin bulk action: ko'p user blok — batch + audit + undo.
09. Admin IP change: allowlist'dan tashqari → blok + alert (super-admin).
10. Admin role delegation: proctor/marker roli (P3) — scoped.
11. Audit tampering: append-only (auth_audit immutable).
12. Admin account compromise: suspicious → super-admin alert + auto-block.
13. Audit dashboard performance: index + pagination (C-09).
14. Security/data guard: audit append-only; admin credential log'da yo'q.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: expiry; bulk; delegation.
18. Integration/contract test: MFA reset; IP change.
19. E2E/security test: audit tamper; compromise.
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-09 statusi.
22. Global report formatida qaytar.
23. Stop condition: audit tamper bo'lsa.
24. Done condition: admin edge to'liq.
25. E-10 uchun: security edge'ga tayyor.
26. Admin audit eksport: signed (hash) — tamper aniqlash (E-17).
27. Admin login geofence: UZ IP majburiy (qoida 14) — xorijiy 451.
28. Admin password change: 90 kun (ixtiyoriy) — NIST rotation SHALL NOT (faqat breach'da).
29. Metrics: admin_session_expiry, admin_mfa_reset_count, admin_ip_block.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-10 — Security edge cases (final hardening)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth security edge case'larini yakuniy mustahkamlash.
05. Precondition: D-28 yashil bo'lishi kerak.
06. HTTP security headers: HSTS, X-Content-Type-Options, X-Frame-Options, CSP (auth sahifalar).
07. CSP: frame-ancestors (auth iframe'da emas), script-src (inline yo'q).
08. TLS: HTTPS hamma joyda (A-04), HSTS preload (prod).
09. Clickjacking: X-Frame-Options DENY auth sahifalarida.
10. Autofill injection: parol field'ida autocomplete correct (A-04).
11. Timing: dummy hash (A-22), login vaqt normalize (bir xil logika).
12. Cache: auth sahifalar no-cache (no-store) — back'da parol ko'rinmasin.
13. Referrer: auth sahifalar no-referrer (reset URL).
14. Memory: parol JS'da qolmasin (clear input).
15. Security/data guard: hamma yuqoridagi — header test, cache test.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: header config; cache.
19. Integration/contract test: CSP; HSTS.
20. E2E/security test: clickjacking; cache; referrer.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-10 statusi.
23. Global report formatida qaytar.
24. Stop condition: header bo'lmasa.
25. Done condition: security edge to'liq.
26. E-11 uchun: test edge'ga tayyor.
27. Cache no-store: login/register/reset/settings sahifalarida — back'da parol ko'rinmaydi.
28. Timing normalize: login fail'da dummy hash + jitter (A-22) — bir xil vaqt.
29. Autofill: autocomplete to'g'ri (A-04) — browser'da parol eski qiymat qo'ymaydi.
30. Metrics: header_test_fail, cache_test_fail, referrer_leak_detected.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-11 — Test edge cases (property, fuzz, regression)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: test edge case'larini qurish — property, fuzz, regression.
05. Precondition: D-28 yashil bo'lishi kerak.
06. Property test (fast-check): parol policy (har xil input), session TTL, risk score range, token unique.
07. Fuzz (register/login input): random strings — no crash, no injection.
08. Mutation test (stryker): test sifati (mutation killed).
09. Regression suite: har fazadan (A/B/C/D/E) — CI'da.
10. Snapshot test: API contract (login/reset/verify response).
11. Time travel test: expiry (15 daqiqa), lockout, retention — fake clock.
12. Concurrency test: parallel login, duplicate, race.
13. Idempotency test: qayta yuborish (submit, verify, reset).
14. Security/data guard: test data synthetic.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: property/fuzz.
18. Integration/contract test: snapshot.
19. E2E/security test: mutation; regression.
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-11 statusi.
22. Global report formatida qaytar.
23. Stop condition: fuzz crash bo'lsa.
24. Done condition: test edge to'liq.
25. E-12 uchun: monitoring edge'ga tayyor.
26. Regression suite CI'da har PR (D-20) — A/B/C/D/E zanjiri.
27. Fuzz corpus: null, unicode, long (>1MB), emoji, SQL injection pattern — no crash.
28. Property invariant: risk score 0..1, session ID unique, TTL > 0.
29. Metrics: mutation_killed_rate, fuzz_crash_count, regression_fail.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-12 — Monitoring/alert edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: monitoring/alert edge case'larini qurish.
05. Precondition: D-06 yashil bo'lishi kerak.
06. Alert fatigue: threshold'lar tuning; dedupe (bir xil incident bir marta).
07. False positive: NAT (kampus) — per-account asosiy.
08. Alert routing: security (S1) → on-call; ops (S3) → email.
09. Escalation: S1 15 daqiqada javob yo'q → next.
10. Metric gap: login fail spike → alert (C-09).
11. Email deliverability drop: bounce >5% → alert (A-23).
12. Provider outage: Google/email/HEMIS → status + alert.
13. Runbook link: har alert annotation.
14. Test alert: synthetic (weekly).
15. Security/data guard: alert'da PII yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: threshold; dedupe.
19. Integration/contract test: routing; escalation.
20. E2E/security test: synthetic alert.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-12 statusi.
23. Global report formatida qaytar.
24. Stop condition: dedupe bo'lmasa.
25. Done condition: monitoring edge to'liq.
26. E-13 uchun: perf edge'ga tayyor.
27. Alert annotation: runbook link + severity + owner (E-18 support bilan).
28. On-call ro'yxati: operator to'ldiradi (kim, kanal, almashtirish).
29. Test alert: haftalik synthetic — pipeline ishlayotganini tekshirish.
30. Metrics: alert_dedupe_rate, alert_false_positive_rate, oncall_response_time.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-13 — Performance edge cases (auth)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth performance edge'larini qurish.
05. Precondition: D-19 yashil bo'lishi kerak.
06. Login latency: Argon2 cost tuning (CPU vs sec) — p95 <1s.
07. HIBP check: async (login'da bloklamaydi) — A-29.
08. Email send: queue (non-blocking) — login'da email emas.
09. Redis: pipeline/batch — rate limit, risk counter.
10. DB: users lookup index; auth_audit batch insert.
11. Rate limit overhead: Redis INCR minimal (1 req).
12. Cache: JWKS, geo, email validation (24 soat).
13. Frontend: bundle <50KB (D-07); preload login.
14. Profile: argon2, bcrypt, crypto — benchmark.
15. Security/data guard: perf test production'da emas.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: argon2 cost; pipeline.
19. Integration/contract test: p95 login.
20. E2E/security test: HIBP async.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-13 statusi.
23. Global report formatida qaytar.
24. Stop condition: p95 >2s bo'lsa.
25. Done condition: perf edge to'liq.
26. E-14 uchun: i18n edge'ga tayyor.
27. Argon2 benchmark: m=64MB? — UZ server xotira; cost'ni sinash (m, t, p).
28. HIBP async: login'da bloklamaydi — background check, natija keyingi login (A-29).
29. Frontend bundle: login sahifa <50KB (D-07) — 2G tezroq.
30. Metrics: login_p95, argon2_time, hibp_async_latency.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-14 — i18n/localization edge cases

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: i18n edge case'larini qurish.
05. Precondition: D-11 yashil bo'lishi kerak.
06. uz-Cyrl: transliteratsiya emas — professional tarjima (Prompt 63).
07. Plural/grammar: "1 kun / 2 kun / 5 kun" — uz/ru plural rules.
08. Date/time format: locale (uz/ru/en), timezone Asia/Tashkent.
09. Name order: uz (Ism Familiya), ru (Familia Imya) — forma'da.
10. Unicode: uz 'ʻ' (okina), Cyrillic — DB collation.
11. Length: ru/en string'lar uzunroq — layout test (overflow).
12. RTL: kerak emas, lekin test.
13. Terminology: "Nazorat" vs "Test" — terminology bank (uz).
14. Missing translation: fallback en + flag.
15. Security/data guard: tarjima string'da PII yo'q.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: plural; format; fallback.
19. Integration/contract test: locale switch.
20. E2E/security test: overflow; Unicode.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-14 statusi.
23. Global report formatida qaytar.
24. Stop condition: plural bo'lmasa.
25. Done condition: i18n edge to'liq.
26. E-15 uchun: final'ga tayyor.
27. uz-Cyrl 'ў'/'қ'/'ғ' belgilari: font subset (D-31) — ko'rinish testi.
28. Fallback: til string topilmasa en + log (flag) — user bloklanmaydi.
29. Date: 01.02.2026 (uz), 01.02.2026 (ru), Feb 1, 2026 (en) — locale.
30. Metrics: missing_translation_count, locale_switch_count.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-15 — Auth FINAL super-checkpoint

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: butun auth tizimini yakuniy super-checkpoint bilan sertifikatlash (A-E fazalar).
05. Precondition: A-00..A-31, B-00..B-26, C-00..C-16, D-00..D-28, E-00..E-14 yashil.
06. FINAL:
07. Barcha fazalar checklist: core, register, email, risk, admin, integration, infra, frontend, test, ops, legal, edge.
08. Full regression: unit+integration+E2E+security+load.
09. Security: pen-test, secret scan, PII scan, headers, timing.
10. Legal: DPIA, consent, DSAR, retention, UZ law.
11. Ops: deploy, rollback, incident, backup restore, monitoring.
12. A11y: axe 0, keyboard, screen reader.
13. i18n: 4 til to'liq, plural, Unicode.
14. Docs: runbook'lar, architecture, user guide.
15. Sign-off: security, privacy, legal, ops, product.
16. Security/data guard: bironta critical finding yashirilmasin.
17. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
18. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
19. Unit test: full suite.
20. Integration/contract test: multi-role acceptance.
21. E2E/security test: full drill.
22. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
23. `implementation-status-auth.md`ga E-15 (FINAL) statusi yoz.
24. Global report formatida changed files, migration, command va test natijalarini qaytar.
25. Stop condition: har qanday critical/high blocker qolsa.
26. Done condition: auth tizimi to'liq, global gigant darajasida, release tayyor.
27. Operator yakuniy sign-off.
28. `research_auth_deep.md` manbalar arxivi (NIST/OWASP/OAuth/Entra).
29. Next-version backlog (P3): OneID, HEMIS data, push to'liq, ML risk.
30. Butun PROMPT_GUIDE_AUTH zanjiri yakunlandi.
```

## E-16 — Auth documentation (developer + user)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth uchun developer va user dokumentatsiyasini yozish.
05. Precondition: E-15 yashil bo'lishi kerak.
06. Developer docs (`docs/auth/`): arxitektura, modullar, config, env, endpoint'lar (OpenAPI), flow'lar, qarorlar (NIST/OWASP), manbalar.
07. Endpoint docs: har endpoint — request/response, error code, rate limit, auth.
08. OpenAPI: `/api/v1` spec (auth) — generate/validate (Prompt 67).
09. User docs (`docs/user/`): login, register, verify, MFA, passkey, teacher approval, reset — 4 til.
10. Admin docs: teacher approve, user manage, audit.
11. Runbook'lar (D-21/26): deploy, incident.
12. FAQ: auth (24 ta — kirish, parol, MFA, passkey, teacher).
13. Support KB: email'siz user, MFA yo'qolgan, HEMIS ulanish.
14. Security/data guard: docs'da secret yo'q; misol'da fake data.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: docs link'lar valid.
18. Integration/contract test: OpenAPI valid.
19. E2E/security test: docs'da secret yo'q (grep).
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-16 statusi.
22. Global report formatida qaytar.
23. Stop condition: docs'da secret bo'lsa.
24. Done condition: docs to'liq.
25. E-17 uchun: audit trail'ga tayyor.
26. Docs strukturasi: docs/auth/ (dev), docs/user/ (user), docs/admin/ (admin), docs/runbooks/ (ops).
27. Har flow uchun diagramma (login, register, MFA, passkey, reset, teacher).
28. Qarorlar logi (ADR): NIST/OWASP/OAuth 2.1 qarorlari — manba bilan.
29. Docs'da secret/real PII yo'q (grep test); misollar fake.
30. Metrics: docs_coverage, broken_link_count.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-17 — Auth audit trail (append-only, forensics)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth audit trail'ni forensics darajasida qurish.
05. Precondition: A-03 yashil bo'lishi kerak.
06. auth_audit append-only: UPDATE/DELETE taqiqlangan (trigger).
07. Integrity: har row hash (chain: prev_hash + data → hash) — tamper detection.
08. Trace: request_id (D-05), session_id (hash), ip_hash, ua.
09. Detail JSONB: reason, attempt, method — PII minimal.
10. Retention: 30 kun (C-14); legal hold (D-23).
11. Forensics query: user bo'yicha timeline, IP bo'yicha, action bo'yicha.
12. Export: signed (hash) — audit uchun.
13. Alert: tamper detected → S1.
14. Security/data guard: append-only; hash chain; PII minimal.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: chain integrity; append-only.
18. Integration/contract test: tamper detection; forensics.
19. E2E/security test: hash mismatch.
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-17 statusi.
22. Global report formatida qaytar.
23. Stop condition: tamper bo'lsa.
24. Done condition: audit trail to'liq.
25. E-18 uchun: support'ga tayyor.
26. Hash chain: har row hash = H(prev_hash + data) — tamper zanjir buzadi (alert).
27. Forensics query: user timeline, IP bo'yicha, action bo'yicha — admin C-09.
28. Eksport signed: audit uchun fayl imzosi (hash) tekshiriladi.
29. Retention: 30 kun (C-14), legal hold (D-23) — archive.
30. Metrics: audit_append_ok, tamper_detected (S1 alert).
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-18 — Auth support flow (tickets, verification)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth support flow'ini qurish — ticket, identity verification, manual unlock.
05. Precondition: E-17 yashil bo'lishi kerak.
06. Ticket types: account_locked, mfa_lost, email_change, hemis_issue, teacher_rejected, suspicious.
07. `support_tickets` jadvali: id, user_id, type, status, detail, created_at, resolved_by, resolution.
08. Identity verification: email + phone + (agar) MFA metadata; high-risk — ID upload (P3).
09. Manual unlock: admin (audit) — lockout release.
10. MFA reset manual: super-admin approval (A-26/30).
11. SLA: S1 (account takeover) 4 soat; S3 (lockout) 24 soat.
12. Notification: ticket status (email/Telegram).
13. Audit: ticket_created, ticket_resolved.
14. Security/data guard: support'da parol yo'q; identity verify.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: ticket flow; verification.
18. Integration/contract test: unlock; MFA reset.
19. E2E/security test: identity spoof; IDOR.
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-18 statusi.
22. Global report formatida qaytar.
23. Stop condition: identity verify bo'lmasa.
24. Done condition: support to'liq.
25. E-19 uchun: final'ga tayyor.
26. Identity verification: email + phone + MFA metadata; yuqori risk — ID hujjat (P3).
27. Ticket SLA: S1 4 soat, S3 24 soat — eslatma (C-23 cron).
28. Manual unlock audit: admin_id, sabab, vaqt — append-only (E-17).
29. User notification: ticket status o'zgarishi (email/Telegram, B-32).
30. Metrics: ticket_sla_breach, manual_unlock_count, mfa_reset_approval_time.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-19 — Auth final regression + sign-off

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini yakuniy regression va sign-off bilan tugatish.
05. Precondition: E-16..E-18 yashil.
06. FINAL REGRESSION: full suite (unit+integration+E2E+security+load+a11y).
07. Release readiness: barcha fazalar (A-E) checklist, docs, runbook, sign-off.
08. Sign-off to'plami: security, privacy, legal, ops, product.
09. `implementation-status-auth.md`ga E-19 (RELEASE) statusi.
10. Operator yakuniy sign-off.
11. Next-version backlog (P3).
12. Stop condition: critical blocker qolsa.
13. Done condition: auth RELEASE.
14. Global report formatida qaytar.
15. Butun PROMPT_GUIDE_AUTH (A-E) yakunlandi.
16. Full regression: unit+integration+E2E+security+load+a11y — natijalar hujjatda.
17. Release readiness checklist: barcha fazalar (A-E), docs, runbook, sign-off — to'liq.
18. Sign-off to'plami: security, privacy, legal, ops, product — har biri imzo (operator).
19. Release tag: vX.Y.Z + changelog (auth qismi).
20. `implementation-status-auth.md`ga E-19 (RELEASE) statusi, dalillar yoziladi.
21. Next-version backlog (P3): OneID, HEMIS data, device flow, DPoP, ML risk.
22. Stop condition: critical blocker qolsa — RELEASE yo'q.
23. Done condition: auth RELEASE, global gigant darajasida.
24. Operator yakuniy sign-off imzolanadi.
25. Butun PROMPT_GUIDE_AUTH (A-E) zanjiri yakunlandi — hujjatda.
26. Release snapshot: commit hash, test soni, sign-offlar — arxivda saqlanadi.
27. Next-version backlog (P3) yangilandi: OneID, HEMIS data, device flow, DPoP, ML risk.
28. Operator tasdig'i bilan E-19 yopiladi — E-20 boshlanadi.
```

## E-20 — Session token lifecycle (extra hardening)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session token lifecycle'ini ekstra mustahkamlash.
05. Precondition: A-01/02 yashil bo'lishi kerak.
06. Token rotation: renewal timeout (A-25) — har 15 daqiqa ID rotate; eski ID 30s safety.
07. Token entropy: 32B random (256-bit) — OWASP (585 yil).
08. Token storage: Redis (A-01) — cookie'da faqat ID.
09. Token binding: device fingerprint (C-03) + UA + IP hash — mismatch → step-up.
10. Token revocation: barcha triggerlar (B-25) + admin (C-08) + support (E-18).
11. Token expiry: idle 30 daqiqa + absolute 12 soat (A-02) + renewal.
12. Remember-me: selector+verifier (A-25), 30 kun, rotation.
13. Logout: server-side invalidate + cookie clear + audit.
14. Security/data guard: binding; rotation; revocation.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: rotation; binding; expiry.
18. Integration/contract test: renewal; revocation.
19. E2E/security test: stolen token (binding mismatch → step-up).
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-20 statusi.
22. Global report formatida qaytar.
23. Stop condition: binding bo'lmasa.
24. Done condition: lifecycle to'liq.
25. E-21 uchun: OAuth extra'ga tayyor.
26. Renewal race: 2 parallel request — bitta yangi ID (mutex, D-31).
27. Stolen token test: binding mismatch (boshqa device) → step-up MFA (A-26).
28. Revocation trigger matrix: parol, MFA, passkey, admin, support, breach — to'liq (B-25).
29. Remember-me rotation: selector+verifier 30 kun, har foydalanishda rotate.
30. Metrics: session_rotated, session_binding_mismatch, remember_me_usage.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-21 — OAuth extra (device flow, PAR, DPoP reja)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 4-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: OAuth extra imkoniyatlarni rejalashtirish/qurish.
05. Precondition: A-24, E-02 yashil bo'lishi kerak.
06. Device Authorization Grant (P3): CLI/TV — user_code, verification_uri, poll.
07. PAR (Pushed Authorization Request) (P3): authorize request → PUSH → refer (RFC 9126).
08. DPoP (P3): access token binding (RFC 9449) — high-security.
09. OIDC logout (P3): end_session (Google, OneID) — SLO.
10. Claims: minimal (openid email profile); hd (A-24).
11. Scopes: kamida; ortiqcha so'ramaslik.
12. Client metadata: redirect allowlist (A-24) — config.
13. Security/data guard: PAR/DPoP P3 (reja); token binding.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: (agar qurilsa) device flow; PAR.
17. Integration/contract test: (agar) logout.
18. E2E/security test: (agar) DPoP.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-21 statusi (P3 reja).
21. Global report formatida qaytar.
22. Stop condition: P3 operator tasdig'isiz qurilmasin.
23. Done condition: reja tayyor.
24. E-22 uchun: email extra'ga tayyor.
25. Device flow (P3): user_code 8 belgi, 10 daqiqa TTL, rate limit poll — reja.
26. PAR (P3): authorize payload'ni PUSH qilish, refer — CSRF kamayadi.
27. DPoP (P3): access token binding (RFC 9449) — high-security admin uchun.
28. OIDC logout (P3): end_session endpoint Google/OneID — SLO testi.
29. Reja hujjati `implementation-status-auth.md`ga yoziladi; operator tasdig'i shart.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-22 — Email extra (transactional, priority, DKIM rotation)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email extra imkoniyatlarni qurish.
05. Precondition: A-23, E-03 yashil bo'lishi kerak.
06. Priority queue: reset/verify (urgent) > welcome/security (normal) — deliverability.
07. DKIM key rotation: 90 kun — old+new sign (overlap), old o'chirish.
08. SPF limit: 10 lookup — provider include'lar optimallashtirish.
09. DMARC report review: haftalik (D-28); p=reject.
10. Seed test: har oy (Gmail/Outlook/Yahoo) — inbox rate (A-23).
11. Unsubscribe (bulk emas — transactional'da kerak emas; lekin footer support).
12. Email blacklist: bitta address bounce → suppress (A-23).
13. Email validation API: o'z (B-05) — third-party (ZeroBounce) P3.
14. Security/data guard: DKIM rotation; SPF; DMARC.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: priority; DKIM rotation.
18. Integration/contract test: seed test; DMARC report.
19. E2E/security test: spoof (SPF fail).
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-22 statusi.
22. Global report formatida qaytar.
23. Stop condition: DKIM rotation bo'lmasa.
24. Done condition: email extra to'liq.
25. E-23 uchun: MFA extra'ga tayyor.
26. Priority queue: urgent (reset/verify) > normal (welcome) — B-31 bilan.
27. DKIM rotation: 90 kun, overlap (old+new sign 2 hafta), key record update.
28. SPF: 10 lookup limit — include'lar optimallashtirish; DMARC p=reject yo'lida.
29. Seed test: Gmail/Outlook/Yahoo oyiga — inbox rate >=90% (A-23).
30. Metrics: dkim_rotation_ok, spf_lookup_count, dmarc_policy, inbox_rate.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-23 — MFA extra (TOTP lib audit, hardware key, recovery email)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 12-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MFA extra imkoniyatlarni qurish.
05. Precondition: A-26, E-04 yashil bo'lishi kerak.
06. TOTP lib audit: otplib/speakeasy — RFC 6238, timing-safe, window.
07. Hardware key (YubiKey): FIDO2 — A-27 (passkey) qo'llab-quvvatlaydi.
08. Recovery email (P3): alohida recovery address — MFA/reset uchun.
09. MFA push (P3): Web Push (D-23) yoki mobile app — approval.
10. MFA backup: yedek (P3) — SMS (fallback, SIM swap e'tibor).
11. Multiple MFA: TOTP + passkey — ikkalasi (A-26/27).
12. MFA reminder: MFA yoqilmagan user'ga eslatma (P2).
13. Security/data guard: lib audit; hardware.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: lib RFC; timing.
17. Integration/contract test: hardware (agar).
18. E2E/security test: replay.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-23 statusi.
21. Global report formatida qaytar.
22. Stop condition: lib timing-safe bo'lmasa.
23. Done condition: MFA extra to'liq.
24. E-24 uchun: passkey extra'ga tayyor.
25. TOTP lib audit: RFC 6238, base32 secret, timing-safe compare, window=1 — natija hujjatda.
26. Hardware key (P3): FIDO2 YubiKey — passkey transport 'usb'/'nfc' — reja.
27. Recovery email (P3): alohida address — MFA/reset recovery — reja.
28. MFA reminder (P2): MFA yoqilmagan user'larga eslatma (B-32) — reja.
29. Metrics: totp_verify_ok, totp_lockout, mfa_reminder_sent.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-24 — Passkey extra (attestation, synced, cross-device)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: passkey extra imkoniyatlarni qurish.
05. Precondition: A-27, E-05 yashil bo'lishi kerak.
06. Attestation (P3): 'enterprise' — device trust (YubiKey) — high-security.
07. Synced passkey: backed_up flag; "synced" ko'rsatish (settings).
08. Cross-device: QR (hybrid transport) — A-27 modal.
09. Passkey naming: "iPhone 15 Pro", "Work Laptop" — settings.
10. Min 2 passkey prompt: enrollment'da "yana bitta qurilma".
11. Passkey only mode (P3): parol o'chirish (optional).
12. Recovery: passkey yo'qolsa — recovery codes + email (A-27).
13. Security/data guard: attestation P3; counter.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: attestation (agar); naming.
17. Integration/contract test: cross-device.
18. E2E/security test: synced duplicate.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-24 statusi.
21. Global report formatida qaytar.
22. Stop condition: P3 attestation tasdig'isiz.
23. Done condition: passkey extra reja/to'liq.
24. E-25 uchun: rate extra'ga tayyor.
25. Attestation (P3): 'enterprise' — YubiKey device trust — reja, operator tasdig'i.
26. Synced passkey: backed_up flag ko'rsatish (settings) — user xabardor.
27. Cross-device QR: hybrid transport (phone→PC) — A-27 modal qayta test.
28. Passkey naming: qurilma nomi (browser/OS) + user rename (D-09).
29. Metrics: passkey_synced_count, passkey_cross_device_count, passkey_named.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-25 — Rate limit extra (per-role, per-action, geo)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rate limit extra imkoniyatlarni qurish.
05. Precondition: C-01, E-06 yashil bo'lishi kerak.
06. Per-role limit: admin qattiq (3/15), teacher o'rta, student yumshoq.
07. Per-action: login fail, reset send, verify — har xil (C-01).
08. Geo limit (P3): yuqori xavf region'lar — qattiq.
09. Dynamic limit: risk-based (C-04) — yuqori risk'da qattiq.
10. Whitelist: ops IP (E-06).
11. Header'lar: X-RateLimit (C-01) — PII yo'q.
12. Retry-After: doim (C-01).
13. Security/data guard: per-account asosiy; no bypass.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: per-role; dynamic.
17. Integration/contract test: risk-based limit.
18. E2E/security test: bypass emas.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-25 statusi.
21. Global report formatida qaytar.
22. Stop condition: per-account bo'lmasa.
23. Done condition: rate extra to'liq.
24. E-26 uchun: UX extra'ga tayyor.
25. Per-role limit: admin qattiq (3/15), teacher o'rta, student yumshoq — C-01 config.
26. Dynamic limit: risk-based (C-04) — yuqori risk qattiq (E-47 bilan).
27. Geo limit (P3): yuqori xavf region — reja, operator tasdig'i.
28. Whitelist ops: env (D-01) — audit'da qayd.
29. Metrics: rate_limit_by_role, dynamic_tighten_count.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-26 — Auth UX extra (onboarding, help, progressive disclosure)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth UX extra imkoniyatlarni qurish.
05. Precondition: D-07/08/09, E-07 yashil bo'lishi kerak.
06. Progressive disclosure: MFA faqat kerak bo'lganda (step-up) — friction kamaytirish.
07. Help inline: "Parolni unutdingizmi?" — context (E-07).
08. Onboarding tip: login'dan keyin "yaxshilash" takliflari (MFA, passkey, Telegram) — P2.
09. Error empathy: "Kod noto'g'ri — qayta urinib ko'ring" (E-07).
10. Security badge: "Bu qurilma eslab qolindi" (trust).
11. Trust signals: "Ma'lumotlar UZ'da" (login/register).
12. Empty states: login/register (E-07).
13. Reduced friction: autofill, OTP paste (D-13).
14. Security/data guard: UX'da secret yo'q.
15. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
16. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
17. Unit test: disclosure; help.
18. Integration/contract test: onboarding tip.
19. E2E/security test: friction (screenshot).
20. Mavjud testlarni ham ishlat.
21. `implementation-status-auth.md`ga E-26 statusi.
22. Global report formatida qaytar.
23. Stop condition: friction test bo'lmasa.
24. Done condition: UX extra to'liq.
25. E-27 uchun: integration extra'ga tayyor.
26. Progressive disclosure: MFA faqat step-up'da (C-22) — friction kam.
27. Help inline: "Parolni unutdingizmi?" context'li (E-07).
28. Onboarding tip (P2): login'dan keyin MFA/passkey/Telegram taklifi (B-19).
29. Trust signal: "Ma'lumotlar UZ'da" (D-36) — login/register.
30. Metrics: stepup_friction, tip_acceptance_rate.
31. Hisobot operator tasdig'i bilan yopiladi.
```

## E-27 — Integration extra (HEMIS push, OneID SLO, Telegram deep)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md`, `research_auth.md` 3, 8-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: integration extra imkoniyatlarni rejalashtirish.
05. Precondition: C-10/12, E-08 yashil bo'lishi kerak.
06. HEMIS push (P3): natijalar → HEMIS'ga (rasmiy contract bo'lsa; yozma ish baholari).
07. OneID SLO (P3): end_session — global logout.
08. Telegram deep (P3): bot'da login (auth), natija, jadval.
09. HEMIS data (P3): roster/reyting (rasmiy API bo'lsa) — hozir BLOCKED.
10. my.gov.uz: hujjatlar (P3).
11. LMS (LTI 1.3): OTM Moodle/Canvas — P3.
12. Security/data guard: har biri rasmiy contract/API; geofence.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: (agar) adapter.
16. Integration/contract test: (agar) live.
17. E2E/security test: (agar).
18. Mavjud testlarni ham ishlat.
19. `implementation-status-auth.md`ga E-27 statusi (P3 reja).
20. Global report formatida qaytar.
21. Stop condition: rasmiy contract bo'lmasa — BLOCKED.
22. Done condition: reja tayyor.
23. E-28 uchun: security extra'ga tayyor.
24. HEMIS push (P3): natijalar → HEMIS — rasmiy contract bo'lmasa BLOCKED; reja.
25. OneID SLO (P3): end_session — global logout (C-12 bilan).
26. Telegram deep (P3): bot'da login, natija, jadval — B-22 reja.
27. Har P3 reja: contract/shartnoma sharti, geofence, secret KMS — hujjatda.
28. Metrics: (agar) hemis_push_count, oneid_slo_count.
29. Hisobot operator tasdig'i bilan yopiladi.
```

## E-28 — Security extra (threat model, ASVS, red-team)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth threat model va ASVS/red-team'ni qurish.
05. Precondition: E-10 yashil bo'lishi kerak.
06. Threat model (STRIDE): spoofing, tampering, repudiation, info disclosure, DoS, elevation — har auth modul.
07. ASVS 5.0 (auth): V2 (auth), V3 (session), V6 (password) — requirement matrix.
08. Red-team: credential stuffing, phishing sim, session hijack, MFA bypass, passkey replay, RAG/prompt (auth AI) — simulyatsiya.
09. Pen-test: kvartal (D-28); external (P3).
10. SAST/SCA: CI (D-20) — auth lib CVE.
11. SBOM: auth deps (Prompt 70).
12. Finding management: owner, SLA, retest.
13. Security/data guard: red-team test data synthetic.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: ASVS matrix.
17. Integration/contract test: red-team sim.
18. E2E/security test: finding retest.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-28 statusi.
21. Global report formatida qaytar.
22. Stop condition: ASVS critical bo'lmasa.
23. Done condition: threat model to'liq.
24. E-29 uchun: test extra'ga tayyor.
25. STRIDE threat model: har auth modul uchun jadval (threat, mitter, mitigatsiya).
26. ASVS 5.0: V2 (auth), V3 (session), V6 (password) — requirement matrix (o'tgan/yo'q).
27. Red-team simulyatsiya: stuffing, phishing, session hijack, MFA bypass — staging'da.
28. Finding management: owner, SLA (S1 <1 hafta), retest — hujjatda.
29. Metrics: asvs_pass_rate, redteam_finding_count, critical_open.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-29 — Test extra (golden set, contract, a11y automation)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: test extra imkoniyatlarni qurish.
05. Precondition: D-18, E-11 yashil bo'lishi kerak.
06. Golden set: login/reset/verify — expected response snapshot (contract).
07. Contract test: OpenAPI (E-16) — schema valid.
08. A11y automation: axe CI (D-12) — har PR.
09. Playwright: video/screenshot on fail (debug).
10. Parallel test: CI shard (D-20).
11. Coverage report: auth (90%) — CI gate.
12. Flaky test: retry + quarantine.
13. Security/data guard: test data synthetic.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: golden.
17. Integration/contract test: contract.
18. E2E/security test: axe.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-29 statusi.
21. Global report formatida qaytar.
22. Stop condition: coverage <90%.
23. Done condition: test extra to'liq.
24. E-30 uchun: monitoring extra'ga tayyor.
25. Golden set: login/reset/verify expected snapshot (contract) — regression asosi.
26. Contract test: OpenAPI schema valid (E-16) — CI'da.
27. A11y automation: axe CI (D-12) har PR — 0 critical.
28. Parallel: CI shard (D-20); flaky retry + quarantine.
29. Metrics: coverage_auth, axe_critical_count, contract_fail.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-30 — Monitoring extra (health, uptime, cost)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: monitoring extra imkoniyatlarni qurish.
05. Precondition: D-06, E-12 yashil bo'lishi kerak.
06. Health endpoint: /health (DB, Redis, provider — fail-fast) — uptime.
07. Uptime monitor: external (UptimeRobot/Pingdom) — auth login sayti.
08. Provider cost: email (Postmark/SES), HIBP, Turnstile, OTel — budget alert.
09. Capacity: login TPS (D-19) — scaling signal.
10. SLO burn: login success, latency — D-06.
11. Error budget: 0.1% error — release gate.
12. Audit: health_check.
13. Security/data guard: health'da secret yo'q.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: health.
17. Integration/contract test: uptime.
18. E2E/security test: cost alert.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-30 statusi.
21. Global report formatida qaytar.
22. Stop condition: health bo'lmasa.
23. Done condition: monitoring extra to'liq.
24. E-31 uchun: perf extra'ga tayyor.
25. Health: /health (DB, Redis, provider) — fail-fast, uptime (D-21).
26. External uptime: login sahifasi (UptimeRobot/Pingdom) — 99.9%.
27. Provider cost: email, HIBP, Turnstile, OTel — oylik budget alert (D-06).
28. Capacity: login TPS (D-19) — scaling signal (replica).
29. Metrics: health_fail, uptime_pct, provider_cost_budget.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-31 — Performance extra (cold start, cache, DB tuning)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: performance extra imkoniyatlarni qurish.
05. Precondition: E-13 yashil bo'lishi kerak.
06. Cold start: login sahifasi SSR (EJS) — TTFB <200ms; preload.
07. Cache: users lookup (Redis, 60s, invalidate on change), JWKS (24h), geo (24h).
08. DB tuning: index (B-01), connection pool, query plan (explain).
09. Argon2 cost: benchmark (E-13) — m3 max.
10. Redis pipeline: rate/risk (E-13).
11. Frontend: critical CSS, font subset, bundle (D-07).
12. Load: TPS scaling (D-19) — replica plan.
13. Security/data guard: cache PII minimal.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: cache invalidate.
17. Integration/contract test: TTFB.
18. E2E/security test: cache PII.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-31 statusi.
21. Global report formatida qaytar.
22. Stop condition: cache PII bo'lsa.
23. Done condition: perf extra to'liq.
24. E-32 uchun: final'ga tayyor.
25. Cold start: login TTFB <200ms (SSR EJS, preload) — D-13.
26. Cache: users (Redis 60s, invalidate), JWKS (24h), geo (24h) — invalidation testi.
27. DB: index (B-01), connection pool, explain plan — tuning hujjati.
28. Redis pipeline: rate/risk batch (E-13) — p95.
29. Metrics: login_ttfb, cache_hit_rate, db_query_p95.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-32 — Auth FINAL acceptance (A-E to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini A-E fazalar bo'yicha yakuniy acceptance.
05. Precondition: E-20..E-31 yashil.
06. FINAL ACCEPTANCE: barcha fazalar (A-E) checklist, full regression, load, security, legal, ops, a11y, i18n, docs.
07. Sign-off: security, privacy, legal, ops, product.
08. `implementation-status-auth.md`ga E-32 (FINAL) statusi.
09. Operator yakuniy sign-off; release.
10. Next-version backlog (P3): OneID, HEMIS data, device flow, ML risk.
11. Stop condition: critical blocker qolsa.
12. Done condition: auth RELEASE, global gigant darajasida.
13. Butun PROMPT_GUIDE_AUTH (A-E, 5 faza) yakunlandi.
14. FINAL ACCEPTANCE checklist: barcha fazalar (A-E) to'liq — hujjatda.
15. Full regression + load + security + legal + ops + a11y + i18n — natijalar.
16. Sign-off: security, privacy, legal, ops, product — har biri imzo (operator).
17. Release tag vX.Y.Z + changelog.
18. `implementation-status-auth.md`ga E-32 (FINAL) statusi, dalillar yoziladi.
19. Next-version backlog (P3): OneID, HEMIS data, device flow, ML risk.
20. Stop condition: critical blocker qolsa — RELEASE yo'q.
21. Done condition: auth RELEASE, global gigant darajasida.
22. Operator yakuniy sign-off imzolanadi.
23. Butun PROMPT_GUIDE_AUTH (A-E, 5 faza) yakunlandi.
24. Acceptance dalillari: test soni, coverage, security findings, legal hujjatlar — arxivda.
25. Release snapshot: commit hash, sign-offlar, changelog — saqlanadi.
26. Operator tasdig'i bilan E-32 yopiladi — E-33 boshlanadi.
27. Hisobot operator tasdig'i bilan yopiladi.
28. E-32 acceptance natijalari `implementation-status-auth.md`da to'liq yoziladi.
```

## E-33 — Frontend extra (login/register accessibility, i18n strings audit)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1, 1b-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: frontend extra — accessibility, i18n strings audit.
05. Precondition: D-07/12, E-07 yashil bo'lishi kerak.
06. i18n string audit: har ekran 4 til; placeholder, error, aria-label tarjima; key to'liq.
07. A11y: focus ring, skip, aria-live error, contrast, 44px — qayta audit.
08. Login/register: keyboard journey to'liq; screen reader test (NVDA/VoiceOver).
09. Form autocomplete: username/current-password/new-password/one-time-code (D-13).
10. Password manager: save prompt; autofill.
11. Mobile: 375px, thumb, keyboard (D-13).
12. Error empathy: har error yechim bilan.
13. Security/data guard: string'da PII yo'q.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: i18n key; a11y.
17. Integration/contract test: keyboard.
18. E2E/security test: axe; screen reader.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-33 statusi.
21. Global report formatida qaytar.
22. Stop condition: i18n key yo'q bo'lsa.
23. Done condition: frontend extra to'liq.
24. E-34 uchun: admin extra'ga tayyor.
25. i18n string audit: har ekran 4 til — placeholder, error, aria-label, title — to'liq.
26. A11y qayta audit: focus ring, skip link, aria-live error, contrast, 44px.
27. Screen reader test: NVDA (Win), VoiceOver (macOS/iOS) — login/register.
28. Autocomplete: username/current-password/new-password/one-time-code (D-13).
29. Metrics: i18n_missing, axe_critical, sr_journey_pass.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-34 — Admin extra (audit export, bulk, delegation)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: admin extra imkoniyatlarni qurish.
05. Precondition: C-09, E-09 yashil bo'lishi kerak.
06. Audit export: CSV (PII minimal, hash) — signed.
07. Bulk user action: blok, rol, invite — batch + audit + undo (E-09).
08. Delegation (P3): proctor/marker roli — scoped (E-09).
09. Admin API: versioned, rate limit (C-01), audit.
10. Admin notifications: ariza, alert, SLA (B-16).
11. Admin 2FA: majburiy (C-07), passkey (A-27).
12. Admin session timeout: qisqa (8 soat), Strict (C-07).
13. Security/data guard: admin audit; PII minimal.
14. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
15. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
16. Unit test: export; bulk.
17. Integration/contract test: delegation.
18. E2E/security test: audit.
19. Mavjud testlarni ham ishlat.
20. `implementation-status-auth.md`ga E-34 statusi.
21. Global report formatida qaytar.
22. Stop condition: audit yo'q bo'lsa.
23. Done condition: admin extra to'liq.
24. E-35 uchun: integration final'ga tayyor.
25. Audit export: CSV (PII minimal, hash) — signed (E-17), formula-injection himoya.
26. Bulk user action: blok, rol, invite — batch + audit + undo (E-09).
27. Delegation (P3): proctor/marker scoped rol — reja, operator tasdig'i.
28. Admin API: versioned (D-30), rate limit (C-01), audit (C-09).
29. Metrics: admin_export_count, bulk_action_undo, delegation_usage.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-35 — Integration final (HEMIS/OneID/OpenData acceptance)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md`, `research_auth.md` 6, 8, 9-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: integration (HEMIS/OneID/OpenData) yakuniy acceptance.
05. Precondition: C-10..C-13, E-08/27 yashil bo'lishi kerak.
06. HEMIS OAuth2: OTM client bilan live test (UZ server); geofence; mapping; secret KMS.
07. HEMIS roster: Excel import to'liq (xavfsiz); commit/rollback; invite.
08. OneID: research + reja (shartnoma sharti — BLOCKED).
09. OpenData: OTM stats (data.gov.uz); diplom.edu.uz (UZ IP).
10. Geofence hujjati: 451 testlari.
11. Secret scan: client_id=8 production'da yo'q.
12. Security/data guard: geofence; KMS; SSRF.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: adapter (mock).
16. Integration/contract test: live (test OTM).
17. E2E/security test: geofence; SSRF; secret.
18. Mavjud testlarni ham ishlat.
19. `implementation-status-auth.md`ga E-35 statusi.
20. Global report formatida qaytar.
21. Stop condition: geofence/secret ochiq bo'lsa.
22. Done condition: integration final.
23. E-36 uchun: security final'ga tayyor.
24. HEMIS OAuth2 live test: OTM client bilan (UZ server) — geofence 451 testi.
25. Roster import to'liq: Excel xavfsiz (C-11), commit/rollback, invite.
26. OneID: research + reja (shartnoma sharti — BLOCKED) — hujjatda.
27. OpenData: OTM stats (data.gov.uz), diplom.edu.uz (UZ IP).
28. Secret scan: client_id=8 production'da yo'q (grep CI).
29. Metrics: hemis_live_ok, roster_import_success, open_data_age.
30. Hisobot operator tasdig'i bilan yopiladi.
```

## E-36 — Security final (full suite + report)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth security final suite va report.
05. Precondition: E-10/28 yashil bo'lishi kerak.
06. Full suite: enumeration, brute-force, fixation, CSRF, cookie, open-redirect, alg, replay, counter, IDOR, MFA bypass, teacher escalation, secret/PII scan, XSS, SSRF, timing, headers, cache, referrer.
07. Report: finding'lar, severity, owner, SLA, retest.
08. Residual risk: documented.
09. Sign-off: security.
10. Security/data guard: critical finding yashirilmaydi.
11. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
12. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
13. Unit test: suite.
14. Integration/contract test: report.
15. E2E/security test: retest.
16. Mavjud testlarni ham ishlat.
17. `implementation-status-auth.md`ga E-36 statusi.
18. Global report formatida qaytar.
19. Stop condition: critical qolsa.
20. Done condition: security final.
21. E-37 uchun: session final'ga tayyor.
22. Full suite: enumeration, brute-force, fixation, CSRF, cookie, open-redirect, alg, replay, counter, IDOR, MFA bypass, escalation, secret/PII scan, XSS, SSRF, timing, headers, cache, referrer — har biri natija.
23. Report: finding, severity (CVSS), owner, SLA, retest — hujjatda.
24. Residual risk: dokumentlanadi (operator tasdiqlaydi).
25. Sign-off: security (imzo).
26. Metrics: security_findings, critical_open, retest_pass_rate.
27. Residual risk'lar operator tasdig'i bilan qabul qilinadi (hujjatda).
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-37 — Session final (lifecycle, invalidation, forensics)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session final — lifecycle, invalidation, forensics.
05. Precondition: E-20/17 yashil bo'lishi kerak.
06. Lifecycle: creation (entropy), renewal (rotation), binding (fingerprint), expiry (idle/absolute), revocation (all triggers), deletion (logout/purge).
07. Invalidation matrix: har trigger test (B-25).
08. Forensics: session timeline, device, geo (E-17).
09. Audit: session_created/rotated/revoked.
10. Security/data guard: binding; rotation; revoke.
11. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
12. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
13. Unit test: lifecycle.
14. Integration/contract test: invalidation matrix.
15. E2E/security test: forensics.
16. Mavjud testlarni ham ishlat.
17. `implementation-status-auth.md`ga E-37 statusi.
18. Global report formatida qaytar.
19. Stop condition: bironta trigger bo'lmasa.
20. Done condition: session final.
21. E-38 uchun: email final'ga tayyor.
22. Lifecycle: creation (entropy), renewal (rotation), binding (fingerprint), expiry (idle/absolute), revocation (all triggers), deletion — har biri test.
23. Invalidation matrix: har trigger (B-25) — jadval, test natijasi.
24. Forensics: session timeline, device, geo — E-17 query.
25. Audit: session_created/rotated/revoked — append-only.
26. Metrics: session_invalidated_count, session_forensics_query_time.
27. Invalidation matrix'da har trigger natijasi (o'tdi/o'tmadi) jadvalda.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-38 — Email final (deliverability + infra)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 5-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: email final — deliverability, infra, templates.
05. Precondition: A-23, E-03/22 yashil bo'lishi kerak.
06. Deliverability: SPF/DKIM/DMARC (p=reject), seed test ≥90%, bounce <5%, complaint <0.1%.
07. Infra: Postmark/SES, transactional alohida, priority queue, retry.
08. Templates: 8 tur, 4 til, spam-safe, accessible (B-20).
09. Bounce handling: suppress (A-23); delivery webhook.
10. Validation: syntax/MX/disposable (B-05); SMTP async.
11. Security/data guard: injection; header; DKIM rotation.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: template; validation.
15. Integration/contract test: seed test; bounce.
16. E2E/security test: injection; spoof.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-38 statusi.
19. Global report formatida qaytar.
20. Stop condition: deliverability <90%.
21. Done condition: email final.
22. E-39 uchun: MFA final'ga tayyor.
23. Deliverability: SPF/DKIM/DMARC (p=reject yo'lida), seed >=90%, bounce <5%, complaint <0.1%.
24. Infra: Postmark/SES, transactional alohida (marketing'dan), priority queue, retry (B-31).
25. Templates: 8 tur, 4 til, spam-safe, accessible (B-20) — final check.
26. Bounce: suppress (A-23), delivery webhook — email_log.
27. Metrics: inbox_rate, bounce_rate, complaint_rate, spam_score.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-39 — MFA/passkey final (recovery, audit)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10, 12-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MFA/passkey final — recovery, audit, acceptance.
05. Precondition: E-04/05/23/24 yashil bo'lishi kerak.
06. Recovery: backup codes (hash), time-delay, support, super-admin (A-26).
07. Audit: enable/disable/challenge/factor change — mfa_audit (E-17).
08. Acceptance: MFA mandatory admin; step-up sensitive; passkey 2 usul.
09. Security/data guard: challenge consumed; counter; recovery.
10. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
11. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
12. Unit test: recovery; audit.
13. Integration/contract test: acceptance.
14. E2E/security test: replay; recovery abuse.
15. Mavjud testlarni ham ishlat.
16. `implementation-status-auth.md`ga E-39 statusi.
17. Global report formatida qaytar.
18. Stop condition: recovery zaif bo'lsa.
19. Done condition: MFA/passkey final.
20. E-40 uchun: rate final'ga tayyor.
21. Recovery: backup codes (hash, used), time-delay 72h (A-26), support, super-admin.
22. Audit: mfa enable/disable/challenge/factor change — mfa_audit (E-17).
23. Acceptance: admin MFA majburiy, step-up sensitive, passkey 2 usul (A-27).
24. Metrics: mfa_enabled_rate, backup_code_used, recovery_attempt_abuse.
25. Recovery resurslari: support kontakt, hujjat (E-18) — user yo'lini to'liq tekshiriladi.
26. Recovery audit'da har attempt (E-17) qayd qilinadi — abuse flag.
27. Hisobot operator tasdig'i bilan yopiladi.
28. E-39 acceptance: MFA/passkey recovery to'liq — `implementation-status-auth.md`ga yoziladi.
```

## E-40 — Rate limit final (abuse report)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rate limit final — abuse report, tuning.
05. Precondition: C-01/02, E-06/25 yashil bo'lishi kerak.
06. Abuse report: haftalik (C-09) — fail spike, lockout, stuffing, bomb.
07. Tuning: threshold'lar (E-25) — false-positive review.
08. NAT e'tibor: per-account asosiy (C-01).
09. Distributed: per-ASN (C-01).
10. Security/data guard: no bypass; PII minimal.
11. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
12. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
13. Unit test: tuning.
14. Integration/contract test: report.
15. E2E/security test: bypass.
16. Mavjud testlarni ham ishlat.
17. `implementation-status-auth.md`ga E-40 statusi.
18. Global report formatida qaytar.
19. Stop condition: bypass bo'lsa.
20. Done condition: rate final.
21. E-41 uchun: UX final'ga tayyor.
22. Abuse report: haftalik (C-09) — fail spike, lockout, stuffing, bomb — jadval.
23. Tuning: threshold'lar (E-25) — false-positive review (operator).
24. NAT e'tibor: per-account asosiy (C-01) — false lockout yo'q.
25. Distributed: per-ASN (C-01) — botnet qarshi.
26. Metrics: abuse_events, false_positive_rate, tuning_applied.
27. Abuse report hujjati C-09 dashboard'da ko'rinadi — operator review.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-41 — UX final (acceptance testing)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth UX final acceptance.
05. Precondition: E-07/26/33 yashil bo'lishi kerak.
06. Acceptance journey: register→verify→login→MFA→passkey→settings→teacher→reset — real user.
07. Usability test: 5 user (O'zbekiston) — task completion, feedback.
08. Friction metrikasi: TTFV (onboarding), login vaqt, reset completion.
09. A11y: keyboard, screen reader (D-12).
10. Mobile: 375px (D-13).
11. i18n: 4 til (D-11).
12. Security/data guard: test user synthetic.
13. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
14. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
15. Unit test: journey.
16. Integration/contract test: usability.
17. E2E/security test: friction.
18. Mavjud testlarni ham ishlat.
19. `implementation-status-auth.md`ga E-41 statusi.
20. Global report formatida qaytar.
21. Stop condition: task fail bo'lsa.
22. Done condition: UX final.
23. E-42 uchun: final release'ga tayyor.
24. Acceptance journey: register→verify→login→MFA→passkey→settings→teacher→reset — real flow.
25. Usability test: 5 user (O'zbekiston) — task completion, feedback — hujjatda.
26. Friction: TTFV, login vaqt, reset completion — metrikalar.
27. A11y: keyboard, screen reader (D-12); mobile 375px (D-13); i18n 4 til (D-11).
28. Metrics: task_success_rate, ttfv, reset_completion_rate.
29. Hisobot operator tasdig'i bilan yopiladi.
```

## E-42 — Auth FINAL RELEASE (A-E, barcha faza)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini FINAL RELEASE'ga chiqarish.
05. Precondition: E-33..E-41 yashil; A/B/C/D fazalar yashil.
06. FINAL RELEASE:
07. Barcha fazalar (A-E) checklist — 191 prompt (32+38+26+41+54).
08. Full regression: unit+integration+E2E+security+load+a11y.
09. Security: pen-test, secret/PII scan, headers, threat model, ASVS.
10. Legal: DPIA, consent, DSAR, retention, UZ law.
11. Ops: deploy, rollback, incident, backup, monitoring, runbook.
12. Docs: developer, user, admin, runbook.
13. Sign-off: security, privacy, legal, ops, product.
14. Release tag + changelog.
15. Security/data guard: bironta critical finding yashirilmaydi.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: full suite.
19. Integration/contract test: multi-role acceptance.
20. E2E/security test: full drill.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-42 (RELEASE) statusi.
23. Global report formatida qaytar.
24. Stop condition: critical blocker qolsa.
25. Done condition: auth RELEASE — global gigant darajasida, to'liq.
26. Operator yakuniy sign-off.
27. Next-version backlog (P3): OneID, HEMIS data, device flow, DPoP, ML risk.
28. Butun PROMPT_GUIDE_AUTH (A-E, 5 faza) yakunlandi.
```

## E-43 — Session extra: renewal details, binding, revocation audit

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 6-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: session extra — renewal detail, binding, revocation audit.
05. Precondition: E-20/37 yashil bo'lishi kerak.
06. Renewal: har 15 daqiqa ID rotate; eski 30s safety (A-25).
07. Binding: fingerprint + UA + IP hash (C-03); mismatch → step-up.
08. Revocation audit: har revoke (trigger, admin, support) — auth_audit.
09. Session list: settings (A-08) — qurilma, geo, vaqt.
10. Session limit: 5 ta (A-02) — eng eski evict.
11. Security/data guard: binding; rotation; audit.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: renewal; binding.
15. Integration/contract test: revocation audit.
16. E2E/security test: mismatch step-up.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-43 statusi.
19. Global report formatida qaytar.
20. Stop condition: binding bo'lmasa.
21. Done condition: session extra to'liq.
22. E-44 uchun: password extra'ga tayyor.
23. Renewal: har 15 daqiqa ID rotate; eski 30s safety (A-25) — race testi.
24. Binding: fingerprint + UA + IP hash (C-03); mismatch → step-up (C-22).
25. Revocation audit: har revoke (trigger, admin, support) — auth_audit (E-17).
26. Session list: settings (A-08) — qurilma, geo, vaqt; limit 5 ta (A-02).
27. Metrics: renewal_count, binding_mismatch_stepup, revoke_audit_ok.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-44 — Password extra: reuse, breach timeline, history

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 1-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: password extra — reuse check, breach timeline, history.
05. Precondition: A-22 yashil bo'lishi kerak.
06. Reuse: yangi parol eski bilan bir xil emas (A-29); tarix (5 oxirgi) — hash saqlash (P2).
07. Breach timeline: HIBP'da parol qachon breach bo'lgan — user'ga "2023 breach" (P2).
08. History: parol tarix (P2) — oxirgi 5 hash (salt'li).
09. Forced reset: breach'da (A-29) — login'da majburiy.
10. Strength: zxcvbn (A-22).
11. Security/data guard: tarix hash; breach log'da yo'q.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: reuse; history.
15. Integration/contract test: forced reset.
16. E2E/security test: breach timeline.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-44 statusi.
19. Global report formatida qaytar.
20. Stop condition: reuse bo'lmasa.
21. Done condition: password extra to'liq.
22. E-45 uchun: MFA recovery extra'ga tayyor.
23. Reuse: yangi parol eski bilan bir xil emas (A-29); tarix 5 hash (salt'li) (P2).
24. Breach timeline: HIBP'da parol qachon breach — user'ga ko'rsatish (P2).
25. Forced reset: breach'da login'da majburiy (A-29) — UX yumshoq.
26. Strength: zxcvbn (A-22) — real vaqt indikator.
27. Metrics: password_reuse_block, forced_reset_count, breach_timeline_shown.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-45 — MFA recovery extra: time-delay, multi-signal, admin

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 12-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: MFA recovery extra — time-delay, multi-signal, admin approval.
05. Precondition: E-04/39 yashil bo'lishi kerak.
06. Recovery signals: email code + phone + (agar) session + (P3) ID — multi.
07. Time-delay: 72 soat (A-26) — notification barcha email'lar + cancel.
08. Admin approval: high-privilege (A-26/30) — super-admin.
09. Recovery audit: har attempt (E-17) — abuse flag.
10. Recovery lockout: 3 so'rov → 24 soat (E-04).
11. Security/data guard: multi-signal; delay; audit.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: signals; delay; lockout.
15. Integration/contract test: admin approval.
16. E2E/security test: abuse.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-45 statusi.
19. Global report formatida qaytar.
20. Stop condition: multi-signal bo'lmasa.
21. Done condition: recovery extra to'liq.
22. E-46 uchun: passkey recovery extra'ga tayyor.
23. Recovery signals: email code + phone + session + (P3) ID — multi-signal majburiy.
24. Time-delay: 72 soat (A-26) — notification barcha email'lar + cancel imkoniyati.
25. Admin approval: high-privilege (A-26/30) — super-admin; o'zini o'zi emas.
26. Recovery audit: har attempt (E-17) — abuse flag; 3 so'rov → 24 soat blok.
27. Metrics: recovery_attempt, recovery_delay_ok, recovery_abuse_flag.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-46 — Passkey recovery extra: synced, backup, cross-device

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 10-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: passkey recovery extra — synced, backup, cross-device.
05. Precondition: E-05/24 yashil bo'lishi kerak.
06. Synced: iCloud/Google — backed_up flag; recovery uchun.
07. Backup: 2+ passkey (A-27) — biri yo'qolsa.
08. Cross-device: phone passkey → PC (E-05).
09. Recovery flow: passkey yo'qolsa → recovery codes + email + time-delay (E-45).
10. Re-enroll: yangi passkey (A-27).
11. Security/data guard: counter; origin.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: synced; backup.
15. Integration/contract test: recovery.
16. E2E/security test: counter.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-46 statusi.
19. Global report formatida qaytar.
20. Stop condition: backup bo'lmasa.
21. Done condition: passkey recovery to'liq.
22. E-47 uchun: rate extra'ga tayyor.
23. Synced: iCloud/Google — backed_up flag; recovery uchun ko'rsatish.
24. Backup: 2+ passkey (A-27) — biri yo'qolsa ikkinchisi ishlaydi.
25. Cross-device: phone passkey → PC (E-05) — QR/modal.
26. Recovery flow: passkey yo'qolsa → recovery codes + email + time-delay (E-45).
27. Metrics: passkey_backup_count, cross_device_usage, recovery_flow_count.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-47 — Rate extra: quota, abuse, adaptive

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 7-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: rate extra — quota, abuse, adaptive.
05. Precondition: E-06/25/40 yashil bo'lishi kerak.
06. Quota: login/reset kunlik (per-account) — abuse (E-06).
07. Adaptive: risk-based limit (C-04) — yuqori risk qattiq.
08. Abuse dashboard: haftalik (E-40).
09. Whitelist: ops (E-06).
10. Header'lar: X-RateLimit (C-01).
11. Security/data guard: per-account; no bypass.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: quota; adaptive.
15. Integration/contract test: abuse.
16. E2E/security test: bypass.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-47 statusi.
19. Global report formatida qaytar.
20. Stop condition: adaptive bo'lmasa.
21. Done condition: rate extra to'liq.
22. E-48 uchun: UX extra'ga tayyor.
23. Quota: login/reset kunlik (per-account) — abuse'ga qarshi (E-06).
24. Adaptive: risk-based limit (C-04) — yuqori risk qattiq; hujum paytida global.
25. Abuse dashboard: haftalik (E-40) — false-positive review.
26. Whitelist ops (E-06): env'da — audit'da qayd.
27. Metrics: quota_hit, adaptive_tighten, abuse_reported.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-48 — UX extra: auth settings, security center, help

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md` 1-5-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: UX extra — security center, help, trust.
05. Precondition: E-07/26/41 yashil bo'lishi kerak.
06. Security center: settings'da — MFA, passkey, sessiyalar, qurilmalar, bildirishnoma (B-21, A-08, C-03).
07. Help: inline FAQ (E-07) + support (E-18).
08. Trust: "Ma'lumotlar UZ'da", "MFA tavsiya" (E-26).
09. Security score (P3): personal score (MFA, passkey, parol kuch).
10. Onboarding tip: "Yaxshilash" (E-26).
11. Security/data guard: UX'da secret yo'q.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: center; help.
15. Integration/contract test: score.
16. E2E/security test: XSS.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-48 statusi.
19. Global report formatida qaytar.
20. Stop condition: center bo'lmasa.
21. Done condition: UX extra to'liq.
22. E-49 uchun: integration extra'ga tayyor.
23. Security center: settings'da MFA, passkey, sessiyalar, qurilmalar, bildirishnoma — yagona joy.
24. Help: inline FAQ (E-07) + support (E-18) — kontekstli.
25. Trust: "Ma'lumotlar UZ'da", "MFA tavsiya" (E-26) — D-36 bilan.
26. Security score (P3): personal (MFA, passkey, parol) — reja.
27. Metrics: security_center_usage, help_click, trust_badge_view.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-49 — Integration extra: HEMIS secret rotation, OneID consent

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `hemis_github.md`, `research_auth.md` 3, 8-bo'limlarini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: integration extra — HEMIS secret rotation, OneID consent.
05. Precondition: C-10/12, E-08/27 yashil bo'lishi kerak.
06. HEMIS secret rotation: 90 kun (D-02); OTM'dan yangi.
07. HEMIS client health: token 401 → alert + OTM notify.
08. OneID consent (P3): "OneID orqali kirish — [x] ma'lumotlar" aniq (C-12).
09. OneID SLO: end_session (E-27).
10. HEMIS data (P3): rasmiy API bo'lsa — BLOCKED hozir.
11. Security/data guard: secret KMS; consent.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: rotation.
15. Integration/contract test: client health.
16. E2E/security test: consent.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-49 statusi.
19. Global report formatida qaytar.
20. Stop condition: secret rotation bo'lmasa.
21. Done condition: integration extra to'liq.
22. E-50 uchun: security extra'ga tayyor.
23. HEMIS secret rotation: 90 kun (D-02) — OTM'dan yangi client; eski revoke.
24. HEMIS client health: token 401 → alert + OTM notify (D-06).
25. OneID consent (P3): aniq ro'yxat — "[x] ma'lumotlar" (C-12) — reja.
26. OneID SLO: end_session (E-27) — reja.
27. Metrics: hemis_secret_rotated, client_401_alert, consent_granted.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-50 — Security extra: dependency CVE, supply chain

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: security extra — dependency CVE, supply chain.
05. Precondition: E-28 yashil bo'lishi kerak.
06. Deps audit: npm audit, Snyk — auth lib'lar (argon2, oidc, simplewebauthn, otplib, zod).
07. CVE monitoring: haftalik (D-28) — auth critical.
08. Supply chain: lockfile, checksum, provenance (npm).
09. SBOM: auth deps (D-28).
10. Vendor review: Google, Postmark, HEMIS, Cloudflare — yillik.
11. Security/data guard: dep update; SBOM.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: CVE scan.
15. Integration/contract test: SBOM.
16. E2E/security test: supply chain.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-50 statusi.
19. Global report formatida qaytar.
20. Stop condition: CVE critical bo'lsa.
21. Done condition: supply chain to'liq.
22. E-51 uchun: final'ga tayyor.
23. Deps audit: npm audit, Snyk — auth lib'lar (argon2, oidc, simplewebauthn, otplib, zod).
24. CVE monitoring: haftalik (D-28) — auth critical; update rejasi.
25. Supply chain: lockfile, checksum, provenance (npm) — CI'da.
26. SBOM: auth deps — hujjat (D-28).
27. Metrics: cve_critical_open, dep_update_lag, sbom_version.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-51 — Auth ULTIMATE FINAL (A-E, 191 bosqich)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini ULTIMATE FINAL — barcha 5 faza (A-E, 191 prompt) bo'yicha yakuniy qabul.
05. Precondition: A/B/C/D/E fazalar to'liq (barcha promptlar DONE).
06. ULTIMATE FINAL:
07. Barcha fazalar checklist (A: 32, B: 38, C: 26, D: 41, E: 54 — jami 191).
08. Full regression: unit+integration+E2E+security+load+a11y+i18n.
09. Security: pen-test, secret/PII scan, threat model, ASVS, supply chain.
10. Legal: DPIA, consent, DSAR, retention, UZ data law, privacy policy.
11. Ops: deploy, rollback, incident, backup, monitoring, runbook, handover.
12. Docs: developer, user, admin.
13. Sign-off: security, privacy, legal, ops, product.
14. Release tag + changelog.
15. Security/data guard: bironta critical finding yashirilmaydi.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: full suite.
19. Integration/contract test: multi-role acceptance.
20. E2E/security test: full drill.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-51 (ULTIMATE FINAL) statusi.
23. Global report formatida qaytar.
24. Stop condition: har qanday critical/high blocker qolsa.
25. Done condition: auth tizimi to'liq, global gigant darajasida, RELEASE.
26. Operator yakuniy sign-off.
27. Next-version backlog (P3): OneID, HEMIS data, device flow, DPoP, ML risk, security score.
28. Butun PROMPT_GUIDE_AUTH (A-E, 5 faza) yakunlandi.
```

## E-52 — Auth penetration test plan (to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth_deep.md` 15-bo'limini to'liq o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth penetration test rejasini yozish.
05. Precondition: E-50 yashil bo'lishi kerak.
06. Scope: barcha auth endpoint, session, MFA, passkey, reset, admin, HEMIS.
07. Test cases: OWASP ASVS (E-28), WSTG — barcha.
08. Tools: Burp, OWASP ZAP, nuclei.
09. Environment: staging (production emas).
10. Report: finding, severity, owner, retest.
11. Security/data guard: staging; PII synthetic.
12. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
13. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
14. Unit test: plan.
15. Integration/contract test: tools config.
16. E2E/security test: run.
17. Mavjud testlarni ham ishlat.
18. `implementation-status-auth.md`ga E-52 statusi.
19. Global report formatida qaytar.
20. Stop condition: critical finding bo'lsa.
21. Done condition: pen-test plan to'liq.
22. E-53 uchun: final'ga tayyor.
23. Scope: barcha auth endpoint, session, MFA, passkey, reset, admin, HEMIS — hujjatda.
24. Test cases: OWASP ASVS (E-28) + WSTG — barcha guruhlar.
25. Tools: Burp, OWASP ZAP, nuclei — config, staging muhit.
26. Report: finding, severity (CVSS), owner, retest — hujjatda.
27. Metrics: pentest_findings, critical_open, retest_pass.
28. Hisobot operator tasdig'i bilan yopiladi.
```

## E-53 — Auth ULTIMATE RELEASE (yakuniy, A-E to'liq)

```text
01. Global Master Promptni ushbu promptdan oldin kontekstga qo'sh.
02. Ishchi katalog `/home/user/edikit`; faqat shu repository ichida ishlagin.
03. `research_auth.md`, `research_auth_deep.md`, `hemis_github.md` — barcha bo'limlarni qayta o'qi.
04. Sen senior engineer sifatida quyidagi maqsadni bajar: auth tizimini ULTIMATE RELEASE — barcha 5 faza (A-E, 191 bosqich).
05. Precondition: barcha fazalar (A-E) to'liq DONE.
06. ULTIMATE RELEASE:
07. Barcha fazalar checklist (A: 32, B: 38, C: 26, D: 41, E: 54 — jami 191).
08. Full regression + load + a11y + i18n.
09. Security: pen-test, threat model, ASVS, supply chain.
10. Legal: DPIA, consent, DSAR, UZ law.
11. Ops: deploy, rollback, incident, backup, monitoring, handover.
12. Docs: developer, user, admin, runbook.
13. Sign-off: security, privacy, legal, ops, product.
14. Release tag + changelog.
15. Security/data guard: bironta critical yashirilmaydi.
16. Har yangi write path uchun tenant scope, authorization, validation va idempotency'ni tekshir.
17. Privileged actionlar uchun audit event va zarur metric/trace qo'sh.
18. Unit test: full suite.
19. Integration/contract test: multi-role acceptance.
20. E2E/security test: full drill.
21. Mavjud testlarni ham ishlat.
22. `implementation-status-auth.md`ga E-53 (ULTIMATE RELEASE) statusi.
23. Global report formatida qaytar.
24. Stop condition: critical qolsa.
25. Done condition: auth ULTIMATE RELEASE — global gigant darajasida, to'liq, ishonchli.
26. Operator yakuniy sign-off.
27. Next-version backlog (P3).
28. Butun PROMPT_GUIDE_AUTH (A-E, 5 faza) yakunlandi.
```
