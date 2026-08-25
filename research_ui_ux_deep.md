# Edikit UI/UX — Butun tizim bo'yicha DEEP RESEARCH (landing + style + cast + teacher + auth + user)

> **Holat:** research bosqichi (kod/prompt yo'q). Auth tizimi "qurib bo'lingan" deb qabul qilinadi; endi **butun platforma bitta yaxlit tizim sifatida to'g'rilanadi** — style, landing/index, cast, teacher, user va auth sahifalari bir xil dizayn tili, bitta rang/token tizimi, bitta motion tizimi bilan.
> **Sana:** 2026-08-03 (ikkinchi chuqur research round — 6 ta alohida hujjat)
> **Hujjatlar to'plami (har qism alohida, maydalab):**
> 1. `research_ui_audit.md` — **HAQIQIY KOD AUDITI** (repo'dan satrma-satr o'qilgan: font/gradient/keyframes/theme/landing/auth — har topilma fayl:qator + evidence bilan, qabul mezonlari grep testlari bilan)
> 2. `research_repos_deep.md` — **GITHUB/GITLAB REPOLARI** (Edikit repo'si real audit: 57 modul, 158 test; HEMIS-oauth to'liq kod tahlili + real javob tuzilishi + leaked secret; hemisapi; top ochiq-manba edtech/LMS — moodle/frappe/chamilo; design-system — primer/carbon/semi; Kahoot-klon bo'shlig'i)
> 3. `research_ui_top_sites_deep.md` — **TOP-SAYTLAR BENCHMARK 2026** (dunyo top-100: Google/YouTube/ChatGPT/Wikipedia/Amazon/GitHub/Canvas; Awwwards/Webby g'oliblari; 2026 trendlar — funksional minimalizm, dark mode, tipografiya-hero, bento; har qism uchun benchmark xaritasi)
> 4. `research_ui_landing_deep.md` — index/landing sahifa (hero, CTA, nav, motion, performance, 151-hero tahlili)
> 5. `research_ui_auth_deep.md` — auth UI (login/register/forgot/MFA/settings, forma ilmi, error matrix, enumeration)
> 6. `research_ui_user_deep.md` — student panel (MyLA dashboard, gamifikatsiya evidence, test-arena, portfolio)
> 7. `research_ui_teacher_deep.md` — teacher workspace (glanceable cockpit, authoring, grading, analytics, rol UX)
> 8. `research_ui_cast_deep.md` — cast (Kahoot/Quizizz/Mentimeter tahlili, projector, participant, host, gamification balance)
> 9. `research_ui_style_deep.md` — dizayn tizimi (token arxitektura, tipografiya, microcopy) + O'zbekiston konteksti (DataReportal, my.edu.uz, HEMIS)
> 10. `research_ui_tech_deep.md` — **TEXNOLOGIYA QATLAMI** (2025-2026 yangi CSS: :has/container/@layer/oklch/light-dark/@property, View Transitions, INP/Core Web Vitals, W3C DTCG tokens + Style Dictionary, AI EdTech co-pilot, frontend arxitektura, Adopt/Watch/Skip jadvali)
> **Asosiy savollar:** Index sahifada nima bo'lishi kerak? Qanday transitionlar? Ranglar light/dark'da keskin o'zgarmasligi uchun nima qilish kerak? Userlar qanday o'zgarishlarni yaxshi qabul qiladi? Qanday qilinsa official, lekin juda funksional?
> **Avvalgi qarorlar:** `uploads/style.md` (46 bo'lim, 325+ manba) — "Evidence-Led Institutional" yo'nalishi, Edikit Cobalt + Signal Cyan + Insight Amber, OKLCH master palitra, motion tokenlari. Bu hujjat o'sha qarorlarni yangi evidence bilan mustahkamlaydi va butun qismlar bo'ylab birlashtiradi.
> **Repo holati:** `views/index.ejs` hozir "MllyCore-inspired" — orbit/drift/pulse/shimmer animatsiyalar bilan (aynan "detskiy" muammo). `views/user/*` va `views/role/*` — alohida sahifalar.

---

## 0. Executive xulosa (research natijasi bir sahifada)

1. **Index/landing:** "official" landing = qat'iy evidence-ga asoslangan struktura: benefit-headed hero (bitta CTA), credibility bar (tekshiriladigan da'volar), product proof (feature emas — natija), real social proof, oddiy footer. Landing'da **kam harakat**, mahsulot haqiqiy screenshot'da ko'rinadi, "orbit/particle/drift" kabi dekorativ animatsiya **yo'q** (ular professional emas, balki detskiy qabul qilinadi).
2. **Transition:** ilmiy asos — 100ms feedback, 200–300ms modal/sahifa, 500ms yuqori chegara, 1s limit (Nielsen Norman Group). View Transitions API (2025-2026 da barcha brauzerlarda) — sahifa transitionlari uchun. `prefers-reduced-motion` — majburiy.
3. **Light/dark keskin o'zgarish:** muammo real — FOUC (noto'g'ri theme flash), sRGB'da interpolatsiya ("muddy middle"), sof qora (#000) ishlatish. Yechim: **OKLCH perceptual ranglar** (interpolatsiya oklch'da), `@property` bilan silliq transition, `data-theme` + inline script (FOUC yo'q), View Transitions API bilan theme switch effekti (aylana/yarim aylanish), `meta theme-color` yangilash. Dark'da ranglarni desaturatsiya qilish (Material 3 qoidasi).
4. **Userlar nimani yaxshi qabul qiladi (evidence):** dark mode — 80%+ afzal ko'radi, lekin **foydalanuvchi nazorati** (light/dark/system) shart; silliq theme transition — "professional" degan taassurot; progressive disclosure — ortiqcha yuk yo'q; trust microcopy — form yakunlashni oshiradi; haddan ortiq animatsiya — aksincha qabul qilinmaydi.
5. **Official lekin funksional:** ishonch = dizayn sifati + oldindan oshkoralik + aniq tarkib + aloqa (USWDS). Universitet darajasi: 75% user'lar kreditni dizayn sifatiga qarab baholaydi, 94% birinchi taassurot dizaynga bog'liq (Stanford). "Official" = isbotlangan da'volar, barqaror konsistensiya, professional ton — lekin funksional = vazifa-tezkor interfeys (teacher'da info density, cast'da fokus).

---

## 1. Umumiy pozitsiya: bitta tizim, bitta dizayn tili

### 1.1. Nega endi birgalikda qarash kerak

Auth "tayyor" degani — auth sahifalari (login/register/forgot/MFA/passkey/settings) endi mustaqil emas. Foydalanuvchi oqimi **bitta uzluksiz yo'l**: landing → register/login → onboarding → user panel (student) yoki teacher workspace → cast (jonli dars). Har bir qism hozir alohida rivojlangan (teacher research, cast plan, style spec, auth research) — endi ularni **bitta yaxlit tizim** sifatida moslashtirish kerak:

```text
BIR TIZIM
├── 1 ta rang/token tizimi (light/dark/high-contrast — OKLCH master)
├── 1 ta tipografiya tizimi
├── 1 ta motion/transition tizimi (token'li, reduced-motion'li)
├── 1 ta theme engine (data-theme + FOUC-free + system sync)
├── 1 ta komponent tili (landing va app bir xil button/input)
└── 4 ta "surface persona" (farqli lekin bir oila):
    ├── Landing  — official storytelling, task-free
    ├── Auth     — calm, minimal motion, trust microcopy
    ├── User     — task-led, glanceable, personal
    ├── Teacher  — high density, sokin, professional
    └── Cast     — fokus, katta tipografiya, cheklangan energiya
```

### 1.2. Hozirgi xatoliklar (repo auditidan) — nima to'g'rilanadi

`views/index.ejs`'da hozir: `float3d`, `orbitL`, `orbitS`, `drift`, `pulseAura`, `shimmerBtn`, `countUp`, `revealCard`, `badgePulse` — bu "premium/gaming" uslub. Evidence shuni ko'rsatadiki:

- Uzluksiz aylanuvchi/orbit'li elementlar **professional taassurot bermaydi** — e'tiborni mahsulotdan chalg'itadi; foydalanuvchi 17–50ms ichida estetik hukm qiladi (Google research) va 0.05s ichida sahifa haqida fikr shakllanadi (Stanford/Morweb) — shu birinchi soniyada orbit'lar "o'yincha" degan signal beradi.
- "Pulse aura" va "shimmer" — marketing-sayt texnikasi; ta'lim platformasining rasmiy sahnasiga mos emas (style.md 41-bo'lim: "no particles, no orbits, no blurred blobs").
- Har elementni animatsiya qiladigan "premium motion" — NN/g'ga ko'ra 500ms dan ortiq har qanday animatsiya "yopishqoq/annoying" qabul qilinadi; hamma narsa harakatlansa — hech narsa ajralib turmaydi.

---

## 2. INDEX / LANDING SAHIFA — nima bo'lishi kerak (evidence)

### 2.1. "Official" landing strukturasi (evidence-based)

Manbalar: Unbounce 2024 benchmark, Leadpages, CXL, Instapage, Involve Digital, landing-page.io, neelnetworks (WebP/CWV), uforocks, lapa.ninja (education landing). Birlashtirilgan xulosa:

```text
1. ABOVE THE FOLD (100% visitorlar ko'radi — 60% scroll ham qilmaydi)
   ├── 1 ta benefit-headed H1 (10 so'zdan kam, outcome)
   ├── Subheadline (30 so'zdan kam, aniq value)
   ├── 1 ta primary CTA (bitta maqsad; bitta CTA 22% yaxshiroq convert)
   ├── Supporting proof (bir qator trust signal)
   └── Minimal nav (landing'da nav minimal — 5-7 item max)
2. CREDIBILITY MOMENT (hero'ning ostida — "nima uchun ishonish kerak")
   └── Logolar/statistika/tekshiriladigan da'volar
3. VALUE PROPOSITION (foydalanuvchi tilida — feature emas, natija)
4. PRODUCT PROOF (haqiqiy screenshot/demo; "feature emas — natija")
5. SOCIAL PROOF (real, tekshiriladigan testimonial — generic emas)
6. BENEFITS (muammo → yechim)
7. CTA takror (har katta section'dan keyin)
8. OFFICIAL FOOTER (contact, privacy, terms, status, changelog, til)
```

### 2.2. Above-the-fold qoidalari (raqamlar bilan)

- **60% visitor hech qachon scroll qilmaydi** → above-the-fold hamma muhim narsa (headline + subheadline + CTA + proof) — Involve Digital.
- **0.05s** ichida user sahifa haqida fikr shakllantiradi; **94%** birinchi taassurot dizaynga bog'liq (Stanford, Morweb) — demak first viewport professional bo'lishi shart.
- **17–50ms** — estetik hukm (Google) → motion birinchi signal; "motion opens the door, color sets the tone, copy explains why to stay" (UXmatters 2026).
- **Headline** — 80% "qolish yoki ketish" qaroriga ta'sir; benefit-led, 10 so'zdan kam (Leadpages).
- **Bitta CTA** — raqobatdosh CTA'lar convertni 22% pasaytiradi (landing-page.io / Unbounce).
- **1 soniya kechikish = -7% conversion** (Leadpages) → performance landing'ning bir qismi.
- **Mobile-first** — 70%+ konversiyalar mobile'da; 375px'da CTA above-the-fold (landing-page.io, Involve).
- **First-person CTA** ("Bepul boshlash") second-person'dan yaxshiroq (Involve).
- **WebP + width/height + critical CSS + CDN** — CLS/LCP uchun (neelnetworks): CLS'ni yo'q qilish "barqaror" taassurot beradi.

### 2.3. Education landing'ga xos (lapa.ninja + CXL + Instapage)

Education landing'ning samarali elementlari:
1. Clear value proposition (ta'lim benefit'i darhol)
2. Visual showcase (haqiqiy demo — not abstract)
3. Pain-point messaging (o'qituvchi muammosi: "sinf nimani tushunganini bilmayman")
4. Social proof (institut/testimonial — ruxsat bilan)
5. Trust signals (credential, security, "data UZ'da")
6. Mobile optimization
7. Clear navigation, single goal

O'qituvchiga yo'naltirilgan landing (Edikit asosiy persona):
- Headline **learning outcome**'ga qaratilgan ("Sinf nimani tushunganini shu zahoti ko'ring") — CXL/Instapage: "Career-outcome-led headlines" vs platform-framing; ta'limda "learning goal" birinchi.
- **Social proof darhol emas, hero ostida** — education'da trust "kurikulum transparensiyasi" orqali (CXL).
- **"Low-risk CTA"** — "Bepul boshlash" / "Demo'ni ko'rish" (CXL: low-risk, skill-building framing).

### 2.4. Edikit landing uchun tavsiya (style.md 41 bilan mos, evidence bilan mustahkamlangan)

style.md 41-bo'limdagi "Official landing masterpiece" blueprint'ini quyidagi evidence qo'llab-quvvatlaydi:

| Section | Evidence asos |
|---|---|
| H1: "Sinf nimani tushunganini shu zahoti ko'ring" | Outcome-headed, 10 so'zdan kam (Leadpages); learning goal (Instapage) |
| Eyebrow "JONLI BAHOLASH · RESPONSIVE TEACHING" | Scannability (Linear benchmark) |
| 2 CTA: [Bepul boshlash] [Demo Castni ko'rish] | Bitta primary + bitta secondary; low-risk (CXL) |
| "Sessiya kodingiz bormi? Kod bilan kiring →" | Participant shortcut — education'da audience segmentation (Kanopi/Arizona "I am" pattern) |
| Trust microline ("Ilova o'rnatilmaydi · Public reyting nazoratda · Accessibility-first") | Credibility moment — proof below hero (Involve/Instapage) |
| Trust bar: WCAG 2.2 AA, No-camera Cast, Server-confirmed answers, Uzbek-first | **Tekshiriladigan** da'volar — "no unverified certification logo" (style.md 41.3; digital.gov trust) |
| Product frame (real component capture) | Product proof — haqiqiy screenshot (CXL: "visual demo or animation 27% more time on page" — lekin demo = mahsulot, dekor emas) |
| Ask → See → Adapt | Brand story — "Savoldan qarorgacha" (storytelling Instapage/education) |
| Official footer | Transparency: contact, privacy, status, changelog (digital.gov trust pillars) |

**Yangi landing'da YO'Q bo'lishi kerak** (evidence asosida):
- Orbit/drift/particle dekor (detskiy signal; NN/g motion principles)
- Fake statistika ("10,000+ users" — tekshirib bo'lmaydi; trustni buzadi)
- Generic testimonial ("Ajoyib platforma!")
- "HEMIS bilan integratsiya" degan yolg'on da'vo (Global Master Prompt qoida 28)
- Haddan ortiq nav havolalari (landing'da minimal nav)

---

## 3. TRANSITION TIZIMI — ilmiy asos va texnik yechim

### 3.1. Duration ilmi (Nielsen Norman Group + UXmatters + Material)

- **0.1s (100ms)** — "instant" hisoblanadi; feedback uchun pastki chegara (NN/g response limits).
- **100ms** — checkbox/toggle kabi oddiy feedback (NN/g animation-duration).
- **200–300ms** — modal/panel kabi jiddiy o'zgarishlar (NN/g).
- **400–500ms** — katta harakat; 500ms dan oshsa — "yopishqoq/annoying" (NN/g/UXmatters).
- **1s** — yuqori chegara (NN/g) — user sezadi, lekin bog'liqlikni tushunadi.
- **Kirish > chiqish**: element paydo bo'lishi chiqishidan biroz uzunroq (300ms paydo, 200–250ms chiqish) (NN/g).
- **Easing**: linear — "robotik"; fizik olamdagi kabi tezlashish/tezlanish kerak (NN/g; style.md 6.3 easing tokenlari).
- **0.1s ichida javob** — sabab-oqibat hissi (NN/g animation-usability: "effect must begin within 0.1 seconds").

### 3.2. View Transitions API (2025–2026 holat)

Manbalar: developer.chrome.com, webperfclinic, corewebvitals.io, openreplay, weskill, trade-assistance, spectrumhq.

- **Qo'llab-quvvatlash:** Chrome 111+ (same-doc), Chrome 126+ (cross-doc), Safari 18.2+ (cross-doc), Firefox — 2026'da barcha major brauzerlar (85%+ qamrov; weskill/trade-assistance).
- **MPA (multi-page) transition:** `@view-transition { navigation: auto; }` — bir necha qator CSS bilan sahifa transitionlari, SPA JS narxiga o'xshash — "single highest-leverage feature on the web platform in 2026" (trade-assistance).
- **SPA (same-document):** `document.startViewTransition(() => updateDOM())` — feature-detect qilish shart.
- **Shared element morph:** `view-transition-name: hero;` — 1-2 element har sahifada "morph" bo'ladi (weskill: identify 1-2 hero elements; <10 named elements per page — spectrumhq).
- **Directional transitions:** back/forward farqli (`navigation-type="back"` yoki `.back-transition` class) (Chrome docs).
- **Performance:** compositor thread — 60fps; lekin mobile'da ~70ms LCP overhead; `transform`/`opacity` ishlatish (CLS yo'q); **Speculation Rules API bilan prerender** — transition "instant" (corewebvitals).
- **Reduced motion — majburiy:** `@media (prefers-reduced-motion: reduce) { ::view-transition-* { animation-duration: 0.01s !important; } }` — "not optional" (Chrome docs, webperfclinic).
- **Fokus boshqaruvi:** `transition.finished` dan keyin focus to'g'ri joyga (spectrumhq).

### 3.3. Edikit uchun transition qatlamlari (bitta tizim)

```text
LAYER 1 — Micro-feedback (button hover/press, toggle, checkbox)
  100–160ms, style.md tokenlari (--motion-quick/fast/ui)
LAYER 2 — Component (modal, dropdown, tooltip, toast, side panel)
  160–280ms (--motion-panel)
LAYER 3 — Page/phase (sahifa transitionlari)
  240–320ms (--motion-page) — View Transitions API
LAYER 4 — Theme switch (light↔dark)
  400–500ms max — View Transitions API circle reveal yoki @property crossfade
LAYER 5 — Celebration (Cast'da achievement)
  500–900ms bir marta (style.md 6.2) — faqat Cast, reduced-motion'da yo'q
```

**Qoidalar:**
- Sahifa transition'ida: default crossfade (240–320ms) + 1–2 shared element (logo/header) — overdo qilmaslik.
- Directional: forward (slide-left), back (slide-right) — faqat asosiy flow'larda (panel→test→result).
- Auth sahifalarida: **minimal** — login'da modal emas, sahifa yuklanishida oddiy crossfade; 401/redirect holatlarida hech qanday katta animatsiya (xavfsizlik UX — "calm").
- Cast'da: **state-led** — "Savol ochildi", "Vaqt tugadi", "Natija" — bu state'lar orasidagi transitionlar semantic (response mosaic animatsiyasi), lekin 500ms dan oshmaydi.
- `prefers-reduced-motion` — butun tizimda qat'iy; `@media (prefers-reduced-motion: no-preference)` ichida hamma motion.

---

## 4. RANG TIZIMI — light/dark keskin o'zgarish muammosi va yechim

### 4.1. Muammo: nima uchun "keskin" ko'rinadi

1. **FOUC / FART (Flash of wrong theme):** sahifa yuklanganda avval default (light) ko'rsatiladi, JS keyin dark'ni qo'yadi — "white flash" — dark user'lar uchun ayniqsa bezovta (dev.to, medium, Stack Overflow, denis-anfruns).
2. **sRGB interpolatsiya:** light→dark orasidagi CSS transition sRGB'da bo'lsa, ranglar "loyqa/muddy" orqali o'tadi (csstools, huebert).
3. **Sof qora (#000) ishlatish:** OLED'da ko'z charchaydi, LCD'da "kulrang" ko'rinadi; off-black (#121212–#222222) tavsiya (dev.to, LogRocket, Medium).
4. **Saturated brand ranglari dark'da "vibrate" qiladi** — ko'zni og'ritadi; dark'da desaturatsiya qilish kerak (Medium design-bootcamp, Netguru, Material 3).
5. **Elevation/shadow:** dark'da box-shadow ko'rinmaydi — Material 3 "tonal elevation" (surface tint) ishlatadi (M3 docs).
6. **Bir xil rang ikkala theme'da bir xil emas:** dark'da aksent rang "ko'rinmay qoladi" yoki "qichqiradi" — har theme uchun alohida test (Smashing, LogRocket).

### 4.2. Yechim 1 — OKLCH perceptual ranglar (style.md 20 bilan mos)

Manbalar: csstools, huebert, devpane, carmenansio, auricartisan, colorui, camoa, stevekinney, jarshalab.

- **OKLCH = perceptually uniform** — L qiymati ko'zning idrok etgan yorqinligi bilan mos; HSL'da bir xil 50% lightness'da sariq "yonib" ko'rinadi, ko'k "og'ir" — OKLCH'da teng (devpane).
- **Light↔dark tokenlarini "flip" qilish oson:** `oklch()` da L ni aylantirish kifoya — hue/chroma o'zgarmaydi (csstools: "you can often just flip the lightness scale and the colors remain consistent").
- **Interpolatsiya `in oklch`:** gradient/transition oklch'da bo'lsa — "muddy middle" yo'q (csstools, huebert, colorui). `linear-gradient(in oklch, ...)`, `color-mix(in oklch, ...)`.
- **`@property` bilan token transition:** CSS custom property'lar default "string" — interpolatsiya qilinmaydi, "snap" bo'ladi; `@property --color-action { syntax: '<color>'; }` bersangiz, silliq transition ishlaydi (carmenansio — interactive theme switching uchun asos).
- **Gamut:** chroma ≤0.37 — sRGB xavfsiz; P3/OLED uchun oklch native (csstools, colorui).
- **Fallback:** eski brauzerlar uchun hex/rgb birinchi, oklch keyin (jarshalab: 95%+ qamrov).

### 4.3. Yechim 2 — Token arxitektura (Material 3 qoidasi bilan)

Manbalar: M3 docs (resumelens, dev.to mohitrajput987, claudepluginhub, lobehub), LogRocket dark mode.

**3 qavatli token:**
```text
QAVAT 1 — Primitive (OKLCH scale): --blue-500: oklch(0.52 0.20 263) ...
QAVAT 2 — Semantic (rol): --color-action, --color-surface, --color-text, --color-border, --color-success/warning/danger
QAVAT 3 — Component: --btn-primary-bg, --input-border, --card-surface ...
```

**Material 3 dan olinadigan asosiy qoidalar:**
- **Color roles** (primary, on-primary, primary-container, on-primary-container, surface, on-surface, surface-variant, outline, error...) — component'lar bevosita rang emas, rol ishlatadi (resumelens).
- **Light↔dark inversion:** light'da `primary = T40`, dark'da `primary = T80`; container light'da T90, dark'da T30 — **hue va chroma bir xil, faqat tone o'zgaradi** (claudepluginhub). Aynan shu qoida "ranglar keskin o'zgarmasligi"ni ta'minlaydi — bir xil oila, faqat yorug'lik darajasi.
- **Tonal elevation (shadow o'rniga):** dark'da shadow ko'rinmaydi → surface'ga primary tint (`color-mix(in srgb, primary 5-8%, surface)`) — qatlam chuqurligi saqlanadi (claudepluginhub, M3).
- **Desaturatsiya:** dark theme'da saturated ranglarni pasaytirish (LogRocket, Netguru, Medium) — style.md 20.3 allaqachon "dark neutral scale" bergan.
- **style.md 20.2 master palitra** — bu qoidalar bilan mos: light canvas L97.58, dark canvas L16; action light L52 (chroma .20), dark L63 (chroma .18) — **bir xil hue (262–263)**, turli L/C. Aynan shu "keskin emas" ta'sirni beradi.

### 4.4. Yechim 3 — Theme switch mexanikasi (FOUC-free, silliq)

Manbalar: vercel/next.js discussion, dev.to gaisdev, Stack Overflow (Next.js 12), denis-anfruns (Astro FOUC), medium (mastering dark mode), jonshamir (view transition theme), notanumber, rudrodip.

**Mexanika:**
```text
1. INLINE SCRIPT (head'da, CSS'dan oldin):
   (function(){
     try {
       var t = localStorage.getItem('theme');
       var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
       var resolved = t || (sysDark ? 'dark' : 'light');
       document.documentElement.setAttribute('data-theme', resolved);
       document.documentElement.style.colorScheme = resolved;
       document.documentElement.style.backgroundColor = (resolved==='dark' ? '#080D18' : '#F5F7FB');
     } catch(e) {}
   })();
   → FOUC yo'q: theme birinchi paint'dan oldin qo'yiladi (vercel discussion, gaisdev, denis-anfruns).
2. data-theme="light|dark" — barcha CSS tokenlar shu atributga bog'liq.
3. <meta name="theme-color"> dinamic yangilash (mobile address bar) (gaisdev).
4. User tanlovi: localStorage; o'rnatilmagan bo'lsa — system (prefers-color-scheme).
5. System o'zgarishida (faqat 'system' rejimida) matchMedia change listener (medium mastering dark mode).
6. SILLIQ O'TISH: View Transitions API bilan:
   document.startViewTransition(() => { toggle('data-theme'); });
   → circle reveal (tugmadan chiqadigan aylana) yoki oddiy crossfade (jonshamir, notanumber, rudrodip).
   Fallback: @property + transition: background-color 400ms, color 400ms (jonshamir).
7. prefers-reduced-motion: reduce bo'lsa — startViewTransition ishlatilmaydi, instant flip (notanumber).
8. "System" variantini UI'da ko'rsatish (3 tanlov: Light/Dark/System) — user nazorati (medium).
```

**Muhim nuqta (jonshamir):** View Transition theme switch "static screenshots" — animated elementlar bor sahifada artifact berishi mumkin; @property yondashuvi xavfsizroq. **Tavsiya: Edikit'da default = @property crossfade (400–500ms), View Transition circle — ixtiyoriy (P2), reduced-motion'da instant.**

### 4.5. Dark mode qabul qilish statistikasi (nima uchun bu muhim)

Manbalar: stellar, huedserve, altersquare, marketingscoop.

- ~80% user dark mode **bo'lishini xohlaydi**; 65–82% foydalanadi (stellar 2025: 80% prefer, 65%+ use; altersquare: 82% mobile users prefer; marketingscoop: 80%+ use across platforms).
- Education/finance'da **light mode "professional/clear"** deb qabul qilinadi (55% education apps — huedserve) → Edikit'da light default, lekin dark **to'liq sifatli** (style.md: "dark va light alohida sifatli theme, bir-birining inversion'i emas").
- Dark mode **kutilgan funksiya** — yo'qligi "brand behind the curve" signali (Medium 2025).
- **OLED battery:** dark mode 30–47% battery tejaydi (altersquare, huedserve) — mobil'da real benefit.

---

## 5. USERLAR QANDAY O'ZGARISHLARNI YAXSHI QABUL QILADI (evidence)

### 5.1. Theme/o'zgarishlar

- **Nazorat:** user'larga tanlash (light/dark/system) berish — "the best UX decision" (cybrosys, LogRocket, Smashing). Majburiy qilib qo'yilgan theme — qabul qilinmaydi.
- **Silliq transition = professional:** "Theme switching shouldn't feel sudden or broken" — abrupt o'zgarish bezovta; gentle fade "polished" qabul qilinadi (Medium, dev.to, netguru, smashing).
- **Eslab qolish:** tanlov persist (localStorage/profile) — "consistent and thoughtful" (smashing).
- **Keskin ranglar dark'da qabul qilinmaydi:** neon/saturated — ko'z charchaydi; desaturated aksentlar — yaxshi qabul (LogRocket, Netguru, smashing).

### 5.2. Animatsiya/transitionlar

- **Ma'noli motion:** state'ni tushuntiruvchi harakat qabul qilinadi; "animatsiya uchun animatsiya" — yoqmaydi (concretecms, NN/g).
- **Qisqa va aniq:** 100–500ms qabul qilinadi; 500ms+ "drag" (NN/g).
- **Reduced motion:** vestibulyar/kognitiv sezuvchan userlar uchun majburiy — "not optional" (Chrome docs, webperfclinic).
- **Motion first impression:** birinchi 5 soniyada motion "esheik ochadi", color "ton qo'yadi" — motion sifati color'dan ham ko'proq birinchi taassurotga ta'sir qiladi (UXmatters 2026).

### 5.3. Trust signal va microcopy

- **Security badge form completion'ni 15–25% oshiradi** (fintech'da; maviklabs) — lekin haddan ortiq bo'lsa "desperate" ko'rinadi (gapsystudio).
- **Progressive disclosure** — ortiqcha yukni kamaytiradi; "reveal on scroll", "feature gating by action" (digia, gapsystudio, logrocket) — fintech'da KYC-gated investitsiya misoli: "gate teaches by pacing".
- **Microcopy:** "No credit card required" kabi reassurance conversion'ni oshiradi (uforocks).
- **Transparency:** "max 2x/month" kabi aniq promise — trust (maviklabs).
- **Yolg'on da'vo = trust o'limi:** tekshirib bo'lmaydigan statistika ("1M users") yoki logo'lar — userlar sezadi (gapsystudio, digital.gov).
- **Navigation 5–7 item max** — progressive disclosure (jasminedirectory).

### 5.4. Edtech'ga xos (userlar nimani yaxshi ko'radi)

Manbalar: wesoftyou, multipurposethemes, thefinch.design, gitnexa.

- **Role-based interfeys:** student (sodda, motivatsion), teacher (nazorat, data), admin (dashboard) — "feels built for someone, not everyone" (wesoftyou).
- **Notification overload = eng katta shikoyat** (Canvas Capterra review'lar — thefinch): "to-do view faqat bugun uchun" — kechikkan narsalar yo'qoladi. → Bildirishnomalar kam, aniq, priority.
- **Consistent design system** — "guardrail that ensures usability" (wesoftyou).
- **Gamification — learning goal bilan bog'liq bo'lsa**; aks holda distraction (wesoftyou).
- **Progressive disclosure dashboard'da:** balance summary tepada, detail pastda (digia) — teacher overview'da birinchi qarashda "glanceable".

---

## 6. OFFICIAL LEKIN FUNKSIONAL — qanday qilish kerak

### 6.1. Rasmiy/organik ishonch (USWDS + digital.gov + UXDT India)

USWDS trust pillars (digital.gov, designsystem.digital.gov):
1. **Dizayn sifati** — aniq navigatsiya, professional visual design, copyedited matn.
2. **Oldindan oshkoralik** — contact aniq, policy linklar ochiq.
3. **To'g'ri va dolzarb tarkib** — knowledge va intention seziladi.
4. **Bog'lanish** — boshqa rasmiy manbalarga havolalar (transparency).

UXDT (India gov) trust/credibility:
- Timestamp ("content last updated") — davlat portali uchun ishonch (uxdt.nic.in).
- SSL/HTTPS, contact, helpline — tekshiriladigan.
- "Be honest about limitations."

**Edikit uchun:** landing'da — "WCAG 2.2 AA maqsadi", "Server-confirmed answers", "Uzbek-first" — bular **hujjat/havola bilan tasdiqlanadigan** da'volar (style.md 41.3). Footer'da contact, status, changelog — transparency. Yolg'on badge yo'q.

### 6.2. Universitet darajasi (higher-ed evidence)

- **75% user kreditni dizayn sifatiga qarab baholaydi** (Morweb/Kanopi).
- **94% birinchi taassurot dizaynga bog'liq** (Stanford study, Morweb).
- **0.05s** — opinion forming (Morweb).
- **Consistency:** rang palitra, ton, logo joylashuvi — hammasi bitta hikoya (Morweb).
- **Audience segmentation:** Arizona "I am" dropdown — har persona uchun yo'l (Kanopi).
- **Institutional storytelling:** Georgetown tarix/statistika — trust (Morweb).
- **38% user'lar unattractive/difficult saytdan ketadi** (Adobe, Morweb).

### 6.3. "Official" vs "funksional" muvozanat (Edikit uchun)

```text
OFFICIAL (ishonch)                          FUNKSIONAL (vazifa)
├── Qat'iy grid, keng white space            ├── Teacher'da info density (kam scroll)
├── Cheklangan palitra (cobalt/cyan/amber)   ├── Cast'da katta tipografiya (sinfga ko'rinadi)
├── Konservativ motion                      ├── Fokus davlatlarida aniq feedback
├── Professional ton (copy)                 ├── Quick actions (1-2 click)
├── Transparency (footer, docs)             ├── Keyboard/screen reader to'liq
└── Tekshiriladigan da'volar                └── Offline/low-bandwidth ishlash
```

**Asosiy qoida (style.md 0):** landing'da product-led storytelling; app'da task-led interface; cast'da state-led interface. Har bir "persona" o'z darajasida official (bir xil oila) — lekin funksional prioritar farq qiladi.

### 6.4. Qismlar bo'yicha "official lekin funksional" matritsasi

| Qism | Official elementlar | Funksional elementlar | Motion |
|---|---|---|---|
| **Landing** | Evidence bar, real demo, footer, minimal nav | Bitta CTA, above-fold, mobile-first | Kam: hero'da faqat product frame; scroll reveal minimal |
| **Auth** (login/register/forgot/MFA) | Trust microcopy ("Ma'lumotlar UZ'da"), contact, security text | Autofill, paste, OTP autofill, keyboard | Deyarli yo'q; faqat state feedback (100-160ms) |
| **User panel** (student) | Shaxsiy ko'rsatkichlar, portfolio | Glanceable dashboard, "next task", progress | Minimal UI transition; data viz sokin |
| **Teacher** | Natija/analytics (dalil) | High density, quick actions, mass actions | Sokin; panel 220-280ms; chart update 200ms |
| **Cast** | Sinovdan o'tgan qoidalar ("no-camera core") | Fokus, katta tip, response mosaic | State-led: savol ochilishi/natija (300-500ms), celebration bir marta |
| **Admin** | Audit, RBAC, log | Batch, filter, export | Minimal (ish interfeysi) |

---

## 7. TEXNIK INTEGRATSIYA XULOSASI (keyingi bosqichga tayyorgarlik)

### 7.1. Bitta theme engine spetsifikatsiyasi (tezislar)

- `data-theme="light|dark"` html'da; inline head script (FOUC-free); `meta theme-color` dinamic.
- Tokenlar 3 qavat (primitive OKLCH → semantic rol → component); har token 2 qiymat (hex fallback + oklch).
- `@property` bilan `<color>`-typed tokenlar — theme switch'da silliq interpolatsiya.
- View Transitions API: sahifa transition (240–320ms crossfade + 1–2 shared element); theme switch (400–500ms @property crossfade, ixtiyoriy circle reveal).
- `prefers-reduced-motion: reduce` — barcha motion o'chadi (View Transition ham).
- Light = default; dark to'liq sifatli; "system" rejimi.

### 7.2. Qaysi fayllar to'g'rilanadi (research natijasi bo'yicha inventarizatsiya)

- `views/index.ejs` — landing'ni evidence struktura bo'yicha qayta qurish (orbit/drift/pulse/shimmer o'chiriladi).
- `views/partials/head` — theme engine, tokenlar, FOUC script.
- `public/css/*` (yoki yangi token fayli) — OKLCH master + semantic tokenlar + motion tokenlar.
- `views/user/login.ejs`, `register.ejs` (auth) — style bilan moslash (calm, trust microcopy).
- `views/user/panel.ejs`, `portfolio.ejs` — task-led, glanceable.
- `views/role/teacher.ejs`, `board.ejs`, `student.ejs` — teacher/cast persona.
- `views/admin/*` — professional ish interfeysi.

### 7.3. Keyingi bosqich (bu research asosida)

Keyingi bosqichda — juda mayda, batafsil prompt guide (style/cast/teacher/auth/user har bir qismi uchun), har prompt 30-40 qator, Global Master Prompt prefix bilan. Bu research hujjat o'sha promptlarning "source of truth" manbasi bo'ladi (research_auth_deep.md singari).

---

## 8. MANBALAR RO'YXATI (joriy research uchun)

### Landing / conversion
1. landing-page.io — 15 Best Landing Page Examples 2025 (single CTA +22%, 70%+ mobile conversions, 27% time-on-page demo)
2. Leadpages — Landing Page Best Practices (headline 80%, -7% per 1s delay)
3. CXL — How to Build High-Converting Landing Page (above-fold, social proof, benefit copy)
4. Instapage — 30 Landing Page Examples 2026 (education/learning-goal framing, credibility)
5. Involve Digital — High-Converting Landing Page Design 2026 (60% no-scroll, 3-5x single offer, first-person CTA)
6. Unbounce — Landing Page Best Practices (above-the-fold, directional cues)
7. neelnetworks — 2026 Guide (WebP, CLS, critical CSS, CDN)
8. uforocks — 10 Landing Page Optimization (microcopy reassurance, P.I.E.)
9. lapa.ninja — Education Landing Pages (434 examples; education elements)
10. aivix — High Converting Landing Pages 2025 (education conversion benchmarks)

### Transition / motion
11. NN/g — Animation Duration (100ms toggle, 200-300ms modal, 500ms drag threshold)
12. NN/g — Response Time Limits (0.1s instant, 1s upper)
13. NN/g — Animation for Attention and Comprehension (0.1s cause-effect)
14. UXmatters — Designing Interface Animation (200-500ms range; NN/g based)
15. UXmatters 2026 — Why Motion Changes First Impressions More Than Color (17-50ms judgment; 5-second rule)
16. developer.chrome.com — View Transitions API (directional, reduced-motion, named elements)
17. webperfclinic — View Transitions API Guide 2026 (feature-detect, LCP, reduced-motion)
18. corewebvitals.io — View Transitions performance (LCP overhead, Speculation Rules)
19. trade-assistance — Cross-Document View Transitions 2026 (Safari 18.2, cross-browser)
20. spectrumhq — View Transitions Guide (focus management, <10 named elements)
21. weskill — View Transitions 2026 (compositor 60fps, shared elements, interrupted nav)
22. openreplay — View Transitions intro (basic crossfade first)
23. concretecms — Motion that makes sense (meaningful motion)

### Color / themes
24. csstools — oklch() guide (dark mode flip, gradients, @property)
25. huebert — OKLCH vs OKLAB vs HSL (token authoring, interpolation)
26. devpane — OKLCH guide (perceptual consistency, 5-shade palette)
27. carmenansio — oklch + @property + color-mix (semantic tokens, animated themes)
28. auricartisan — Oklab/Oklch perceptual (tonal scales, relative color)
29. colorui — OKLCH explained (gradients, fallbacks)
30. camoa — oklch/oklab dev guide (decision table)
31. stevekinney — OKLCH Tailwind (dark mode L values)
32. jarshalab — OKLCH (95%+ browser support)
33. jonshamir — Animated dark mode with modern CSS (@property vs View Transition)
34. notanumber — Animated Dark Mode Toggle (View Transitions circle, reduced-motion)
35. rudrodip — theme-toggle-effect (circle reveal CSS)
36. MinhOmega — react-theme-switch-animation (View Transition theme effects)
37. vercel/next.js discussion #12533 — FOUC prevention inline script
38. dev.to gaisdev — Prevent Theme Flash React (inline script, theme-color meta)
39. Stack Overflow — Next.js 12 dark mode FOUC (dangerouslySetInnerHTML)
40. denis-anfruns — FOUC in Astro (blocking head script, style injection)
41. Medium — Mastering Dark Mode (system option, matchMedia change)
42. LogRocket — Dark mode UI best practices (surface variants, desaturation, design systems table)
43. Smashing Magazine — Inclusive Dark Mode 2025 (smooth transitions, contrast, color perception)
44. Netguru — 11 Tips Dark Theme 2025 (smooth transitions, desaturation)
45. Medium design-bootcamp — Transitioning light to dark (saturated vs desaturated, opacity hierarchy)
46. dev.to dct_technology — Dark Mode Best Practices (toggle placement, persistence, transitions)
47. dev.to prateekshaweb — Dark Mode Web Design (tokens, no pure black, desaturate, grayscale check)
48. Medium jackbrownkarmaa — Dark Mode Best Practices 2025 (WCAG 3.0, gentle fade)
49. Medium cybrosys — Dark vs Light UX (user control, off-black/white)
50. momentslog — Customizing UI for different themes (smooth transitions, a11y)

### Dark mode stats
51. stellar — Dark Mode 2025 (~80% prefer, 65%+ use)
52. huedserve — Dark vs Light 2025 (78% dark general; 55% light in education/finance)
53. altersquare — 82% mobile users prefer dark, 47% battery saving
54. marketingscoop — 80%+ use across platforms

### Trust / institutional
55. digital.gov — An Introduction to Trust (4 pillars: design quality, disclosure, correct content, connection)
56. designsystem.digital.gov — USWDS Design Principles (trust earned, reliability)
57. uxdt.nic.in — Trust and Credibility UI/UX Guidelines (timestamps, SSL, contact)
58. Morweb — Best College & University Websites 2026 (75% credibility by design, Stanford 94%, 0.05s, Adobe 38%)
59. Kanopi — Higher Ed Website Design 2026 (audience segmentation, 75% credibility)
60. gapsystudio — UX Trust Design (social proof balance, progressive disclosure, legibility)
61. logrocket — Trust-driven UX (Airbnb/PayPal; guarantees, progressive disclosure)
62. maviklabs — Design for Trust 2026 (security badges +15-25% form completion)
63. jasminedirectory — Interface of Trust (5-7 nav items, progressive disclosure)

### Edtech UX
64. wesoftyou — Top 7 EdTech UI/UX Principles (personas, gamification aligned with goals)
65. thefinch.design — EdTech App UX 2026 (Canvas notification overload, role-based dashboards)
66. multipurposethemes — Modern LMS Dashboard UX (customizable, real-time analytics, mobile-first)
67. gitnexa — UX Design for Education Platforms (sidebar/tabs/search-first navigation)

### Material 3 / design systems
68. resumelens — Angular Material 3 theming (color roles, surface containers, tonal elevation)
69. dev.to mohitrajput987 — M2 to M3 (dynamic color, tonal elevation, state layers)
70. claudepluginhub — Material Design 3 (elevation tint, dark inversion T40→T80)
71. lobehub — material-design-3 skill (MD3 tokens, dynamic switching)

---

## 9. QISQA JAVOBLAR (user savollariga to'g'ridan-to'g'ri)

**1. Index sahifada nimalar bo'lishi kerak?**
Above-the-fold: benefit H1 + subheadline + bitta primary CTA + participant shortcut + trust microline; keyin credibility bar (tekshiriladigan da'volar), Ask→See→Adapt hikoya, product proof (haqiqiy demo), real social proof, official footer. Dekorativ animatsiya yo'q.

**2. Qanday transitionlar?**
Micro 100-160ms; component 160-280ms; sahifa 240-320ms (View Transitions API); theme switch 400-500ms; celebration 500-900ms (faqat Cast, bir marta). Reduced-motion — hammasi o'chadi. Sahifa transition'ida crossfade + 1-2 shared element, overdo yo'q.

**3. Ranglar light/dark'da keskin o'zgarmasligi uchun?**
OKLCH'da yozilgan tokenlar (bir xil hue, faqat L/C o'zgaradi); `@property` bilan silliq interpolatsiya; FOUC'ni inline script bilan yo'qotish; theme switch'ni View Transition/@property crossfade bilan (400-500ms); dark'da desaturatsiya; sof qora emas — off-black; Material 3 "tonal elevation" (shadow o'rniga tint).

**4. Userlar qanday o'zgarishlarni yaxshi qabul qiladi?**
Nazorat (light/dark/system tanlash), silliq transition (professional signal), eslab qolish, ma'noli motion, qisqa duration, trust microcopy, progressive disclosure, kam bildirishnoma, tekshiriladigan da'volar, tez yuklanish.

**5. Official lekin funksional?**
Official = qat'iy grid, cheklangan palitra, konservativ motion, transparency, tekshiriladigan da'volar, professional ton. Funksional = task-led (teacher'da density, cast'da fokus, user'da glanceable), keyboard/a11y to'liq, offline/low-bandwidth. Ikkalasi bir token tizimi ostida — bitta oila, har persona o'z darajasi.

---

## 10. O'ZBEKISTON KONTEKSTI (qo'shimcha — muhim xulosalar)

**Raqamlar (DataReportal Digital 2026: Uzbekistan):** internet 33.1 mln (89%), mobil 91.1% (95.6% 3G/4G/5G), median mobil tezlik 55.5 Mbps (+53%/yil), 11% offline (qishloq/keksa).

**Xulosalar:**
- **Mobile-first majburiy** — talabalar asosiy qurilmasi telefon; auth + student panel mobile'da to'liq
- **OTP pattern tanish** — UZ davlat platformalari (my.edu.uz, kontrakt/litsey.edu.uz) SMS OTP ishlatadi → Edikit OTP/email + Telegram OTP — foydalanuvchiga tanish
- **Holat kuzatish** (MyMaktab ariza tracking) — Edikit teacher approval/test statuslarida shu pattern
- **Transkript/diplom** — HEMIS'da transkript yuklab olish odat → Edikit portfolio (A-12)
- **Telegram dominant** — Telegram OTP/bildirishnoma (B-22) — UZ'da muhim kanal
- **Light default** — UZ davlat portallari light; education'da light "professional" (huedserve) → Edikit light default, dark bonus
- **Low-bandwidth tolerant** — SSR EJS, minimal JS, WebP (qishloq tezligi)
- **"Official" tanish** — UZ foydalanuvchilari davlat portallarining soddaligiga o'rganib qolgan → Edikit: shu darajada aniq, lekin chiroyliroq va zamonaviy

---

## 11. XULOSA: bitta tizim, 6 hujjat, keyingi qadam

```text
RESEARCH TO'PLAMI (tayyor):
├── research_ui_ux_deep.md        ← MASTER (bu hujjat)
├── research_ui_audit.md          ← HAQIQIY KOD AUDITI (repo satrma-satr)
├── research_ui_top_sites_deep.md ← TOP-SAYTLAR BENCHMARK 2026 (top-100 + award g'oliblari)
├── research_ui_landing_deep.md   ← Landing/index (evidence struktura)
├── research_ui_auth_deep.md      ← Auth UI ekranlari
├── research_ui_user_deep.md      ← Student panel + gamifikatsiya
├── research_ui_teacher_deep.md   ← Teacher workspace
├── research_ui_cast_deep.md      ← Cast (host/projector/participant)
├── research_ui_style_deep.md     ← Token/tipografiya/microcopy + UZ kontekst
└── research_ui_tech_deep.md      ← TEXNOLOGIYA (CSS 2026, INP, DTCG tokens, AI EdTech)

KEYINGI BOSQICH (operator qarori):
→ Bu 10 hujjat asosida maydalab prompt guide yoziladi:
  style/landing/auth-ui/user/teacher/cast/admin/tech — har qism 30-40 qatorli
  promptlar, Global Master Prompt prefix bilan (research_auth_deep.md singari).
```
