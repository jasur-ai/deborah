# Edikit AUTH UI — DEEP RESEARCH (login/register/forgot/MFA/settings ekranlari)

> **Holat:** research bosqichi. Auth backend tayyor (A-faza, 191 prompt). Bu hujjat — auth **sahifalarining UI/UX** qismini maydalab o'rganish: forma struktura, error handling, CTA copy, mobil, a11y, trust microcopy — hammasi style.md bilan bitta tizimda.
> **Asosiy g'oya:** auth = user har kuni takrorlaydigan, kechirimsiz oqim. 4 kuch: security × clarity × speed × recoverability — muvozanat (ux.detroit3d). "Every locked door needs a legitimate key."

---

## 1. Forma ilmi (raqamlar)

| Raqam | Ma'no | Manba |
|---|---|---|
| **3-4 field** | Signup sweet spot; 3-field forma 10% convert (Omnisend); har qo'shimcha field -5-10% | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/), [involve.me](https://www.involve.me/blog/form-best-practices) |
| **+86%** | Multi-step (to'g'ri guruhlangan + progress) — single-step'dan (HubSpot) | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/) |
| **-22%** | Inline validation — real-time feedback form abandonment'ni kamaytiradi (Wroblewski) | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/), [fomr.io](https://fomr.io/blog/form-ux-best-practices) |
| **+15.4%** | Single-column vs multi-column completion (involve.me) | [involve.me](https://www.involve.me/blog/form-best-practices) |
| **10.5%** | Parol field'i — mean abandonment rate (Zuko) → social login/passwordless muhim | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/) |
| **+26%** | Forma yonida social proof (GetLeadForms) | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/) |
| **+15-25%** | Security badge — form completion (fintech) | [maviklabs](https://www.maviklabs.com/blog/design-for-trust-2026/) |
| **16px+** | Input font — iOS zoom olib tashlash (min) | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/) |
| **44px** | Touch target min | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/), [essential-addons](https://essential-addons.com/complete-guide-to-call-to-action-design) |
| **+63%** | Mobil-optimallashtirilgan forma completion (Tinyform 2025) | [ivyforms](https://ivyforms.com/blog/sign-up-form-best-practices/) |
| **35%** | Baymard: yaxshi checkout form design → conversion +35% (formaga tatbiq) | [ivyforms](https://ivyforms.com/blog/form-design-examples/) |

## 2. Login sahifasi — spec

### 2.1. Struktura (authgear + echobind + ux.detroit3d)

```text
╔═ LOGIN ══════════════════════════════════════
║ Logo (markazda, sokin)
║ "Xush kelibsiz" / "Kirish" — qisqa, benefit emas
║ (Email | Parol + show/hide) — 2 field
║ "Parolni unutdingizmi?" — parol field yaqinida (echobind)
║ [Kirish] — bitta primary CTA
║ Microcopy trust: "Ma'lumotlar UZ'da saqlanadi" (maviklabs)
║ --- yoki ---
║ [Google bilan kirish] (<=3 social, echobind)
║ "Hisobingiz yo'qmi? Ro'yxatdan o'tish" — offramp
╚══════════════════════════════════════════════
```

### 2.2. Muhim detallar

- **Autofocus** birinchi field'ga (magezon)
- **autocomplete**: username/email + current-password (NIST; authgear)
- **Show/hide toggle** — standart 2023+ (ivyforms: CorsoUX 2026 — no longer security concern)
- **Remember me** — checkbox (authgear)
- **Forgot link** — parol field ostida, contrast bilan (medium banking UX; Nielsen visibility)
- **Social login**: ≤3 ta (Google birinchi, UZ'da Telegram ikkinchi) — echobind/ivyforms
- **Birlashtirilgan login/signup** — email kiritilgach yo'naltirish (authgear) — lekin Edikit'da rol tafovuti bor (teacher/student), shuning uchun alohida tab/toggle aniqroq
- **Error handling** (authgear error-recovery mapping):
  - Noto'g'ri parol → inline "Parol noto'g'ri", inputlar saqlanadi
  - Bir necha fail → "Parolni unutdingizmi?" ko'rsatish
  - Noma'lum email → "No account for this email — Sign up" (prefill)
  - Locked → "5 daqiqaga bloklandi" + sabab + alternativlar (reset/support)
  - Network error → "Ulanishda muammo" + Retry (inputni o'chirmaydi — authgear)
  - CAPTCHA → low-friction/invisible (Edikit: Turnstile)

### 2.3. Enumeration qoidasi (auth UX + security)

- Login'da "email yoki parol noto'g'ri" — bitta umumiy xabar (reddit/webdev, DB6)
- Reset'da bir xil javob ("agar email mavjud bo'lsa, kod yuborildi") — time attack'ga qarshi dummy hash (Jona-Anders: synthetic delay)
- Xato vaqtini normalize qilish (dummy hash + jitter)

---

## 3. Register sahifasi — spec

### 3.1. Field minimalizm

```text
Ro'yxatdan o'tish (birinchi qadam — MINIMAL):
1. Email (autocomplete="email")
2. Parol (bitta field + show/hide + strength indikator)  ← "confirm password" EMAS
   (ivyforms/reddit: 1 field + eye icon — 95% foydalanuvchi uchun 2x yozish noqulay;
    xatolik bo'lsa reset flow bor — spudulous hisobi: 2 field = 6.9h friction/5k user vs 2h)
3. Rol tanlash: [Talaba] [O'qituvchi] (Edikit'ga xos; teacher approval keyin)
4. [Hisob yaratish] CTA
```

Keyingi qadamlar (progressive profiling — ivyforms):
- Email verify (OTP 6-raqam, autofill one-time-code)
- Onboarding: ism, universitet, fan (teacher)
- "Confirm password" o'rniga — show/hide (ivyforms: "Use a confirmation code sent to email rather than a Confirm Password repeat field")

### 3.2. Register error / state matrix (authgear + uxpatterns)

| Holat | UX javob |
|---|---|
| Email band | "Bunday hisob allaqachon mavjud" → login'ga o'tish (email prefilled) + "Parolni tiklash" |
| Email not verified | "Emailni tasdiqlang" + [Qayta yuborish] + email'ni yangilash imkoni + limited mode |
| Parol zaif | Inline: "Kamida 8 belgi..." — aniq, vague "too weak" emas (ivyforms) |
| OTP xato | "Kod noto'g'ri yoki muddati o'tgan" + [Qayta yuborish] + timer (authgear) |
| Reset link expired | "Yangi havola olish" — kontekst saqlanadi (email prefilled) |
| CAPTCHA | Turnstile invisible; audio alternative |
| Server error | "Ulanishda muammo" + Retry — input saqlanadi |

### 3.3. Trust microcopy (register'da)

- "Emailingiz hech qachon uchinchi shaxsga berilmaydi" (medium microcopy — Ministry example)
- "Ma'lumotlar O'zbekistonda saqlanadi" (Edikit xususiyati)
- Privacy policy link checkbox (majburiy, pre-ticked EMAS — ivyforms GDPR)
- "Ro'yxatdan o'tish orqali siz Foydalanish shartlari va Maxfiylik siyosatiga rozilik bildirasiz"

---

## 4. Parol tiklash flow — spec (uxpatterns + authgear + ux.detroit3d + NN/g)

```text
1. REQUEST: "Parolni tiklash" → email field → [Yuborish]
2. CONFIRMATION: "Emailingizni tekshiring" — bir xil xabar (enumeration himoyasi)
   + "Spam'ni tekshiring" + [Qayta yuborish] + [Login'ga qaytish]
3. EMAIL: time-limited link (15-60 daqiqa) — uxpatterns: token expiry 15min-1h
4. RESET FORM: Yangi parol (+show/hide) → [Parolni yangilash]
5. SUCCESS: "Parol yangilandi" → login (auto-login emas — OWASP)
   + "Boshqa qurilmalardan chiqish" (session invalidation xabari)
```

Branches (ux.detroit3d — har xato branch'da chiqish yo'li):
- Expired link → [Yangi havola] (email prefilled)
- Reused link → xato (bitta foydalanish)
- Email never arrives → [Resend] + [Boshqa usul]
- User esladi → [Login'ga qaytish]
- Mobile'da email app ↔ browser almashish — deep link testi (uxpatterns)

Spool statistikasi: ~10% faol user har oy reset flow'dan o'tadi (uxdesign.cc) → bu flow **asosiy UX** sifatida qaralishi kerak, "contact support" emas.

---

## 5. MFA/2FA UX — spec (logrocket + authgear + FIDO)

### 5.1. OTP entry
- Autofocus + autosubmit; 6-raqam, alohida input per digit (yoki bitta), **paste enabled**
- `autocomplete="one-time-code"` (iOS SMS autofill)
- 16px+ font (iOS zoom)

### 5.2. Setup flow
- Two-phase: pending → first code verify → active
- Bir nechta usul tanlash (TOTP, passkey, backup codes) — majburlash emas
- "Remember this device" — trusted device (MFA har safar emas)
- Fallback: "Boshqa usul" → backup codes → recovery
- Recovery: eskalatsiya (backup codes → secondary email/phone → waiting-period reset → human review) — ux.detroit3d
- "Try another way" — no-device recovery branch (ux.detroit3d)

### 5.3. Recovery UX (muhim — "recovery is your security level" — ux.detroit3d)
- Time-delay + notification barcha email'larga + cancel
- "3 urinish → 24 soat blok" (E-04)
- Support flow real flow sifatida (ticket emas)

---

## 6. Settings / Security center UX

- Section'lar: Profil / Xavfsizlik / Maxfiylik / Bildirishnomalar (D-09)
- Security center: MFA, passkey, sessiyalar, qurilmalar, 2FA status
- Security badge: "MFA yoqilgan", "Passkey mavjud" — statusdan keladi, yolg'on emas (D-36)
- Parol o'zgartirish: joriy parol + yangi (bir qadam — ux.stackexchange: two-step "scary", bir qadam)
- DSAR: eksport/o'chirish — reauth + confirmation (D-23)
- Theme switcher: Light/Dark/System — **user nazorati** (LogRocket/Smashing)

---

## 7. A11y (auth — majburiy)

- Har input: `<label for>` (NN/g: placeholder label o'rnini bosmaydi)
- Error: inline + `role="alert"`/aria-live (ivyforms WCAG 2.1 AA)
- Contrast ≥4.5:1; error rangga bog'liq emas (icon+text)
- Keyboard: to'liq flow; focus ring
- 44px target; 16px input font
- Autocomplete to'g'ri (password manager)
- Reduced motion: auth'da motion minimal — baribir qat'iy

---

## 8. Mobile (auth)

- Single column; input type to'g'ri (email/tel) → to'g'ri keyboard
- Sticky submit? — auth'da emas, forma qisqa (ivyforms)
- OTP autofill; passkey conditional UI (webauthn token)
- 375px test; thumb zone
- Offline: "Ulanishda muammo" + retry (authgear)

---

## 9. Qabul mezonlari (auth UI tuzatilganda)

1. Login: 2 field + show/hide + forgot + 1 CTA + social (≤3) + trust microcopy
2. Register: minimal field (3-4), confirm-password yo'q, progressive profiling
3. Reset: bir xil javob (enumeration), token 15-60min, auto-login yo'q, resend+prefill
4. MFA: autofocus+autosubmit+paste, remember-device, fallback, recovery flow to'liq
5. Error matrix: har xato → retry/offramp/recovery (dead-end yo'q — ux.detroit3d)
6. Inline validation; label + aria; 16px; 44px; contrast
7. Trust microcopy: "Ma'lumotlar UZ'da", privacy link (pre-ticked emas)
8. Enumeration: login/reset bir xil javob; dummy hash timing
9. Passkey conditional UI + modal (A-27)
10. Theme switcher Light/Dark/System

---

## 10. Manbalar

ivyforms.com/blog/sign-up-form-best-practices · ivyforms.com/blog/form-design-examples · authgear.com/post/login-signup-ux-guide · echobind.com/post/designing-signup-and-login-forms · magezon.com/sign-up-form-ux-guidelines · fomr.io/blog/form-ux-best-practices · involve.me/blog/form-best-practices · staticforms.dev/blog/form-ux-best-practices · medium (ChaymaeLougmani banking reset) · ux.detroit3d.com/flows/15-authentication-flow · uxpatterns.dev (password-reset) · blog.logrocket.com/ux-design/2fa-user-flow-best-practices · uxdesign.cc (better logins) · ux.stackexchange (password change) · reddit r/webdev (forgot flow) · reddit r/UXDesign (1 vs 2 password fields) · maviklabs.com (trust) · essential-addons.com · plat4m.medium.com · ixdf.org (UI forms)
