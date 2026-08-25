# Edikit UI/UX — HAQIQIY KOD AUDITI (satrma-satr, repo'dan olingan dalillar bilan)

> **Holat:** research bosqichi — bu safar **repo kodini satrma-satr o'qib** yozilgan audit (search snippet emas). Har bir topilma: fayl:qator + research evidence bilan.
> **O'qilgan fayllar:** `views/index.ejs` (788 qator, to'liq), `views/partials/head.ejs` (61), `views/user/login.ejs` (to'liq), `views/user/panel.ejs` (bosh), `views/role/teacher.ejs`, `views/game/enter.ejs`, `views/game/host.ejs`, `views/role/board.ejs`, `public/css/style.css` (896), `public/js/theme.js` (to'liq), `public/js/main.js` (168).
> **Xulosa (bir jumla):** hozirgi UI "Premium/gaming" uslubda — Righteous+Nunito fontlar, gradientlar, 40+ keyframes, default dark, fake statistika, email'siz register, "kamida 4 belgi" parol. Bu aynan "detskiy" qabul qilinadi va research'dagi hamma tavsiyaga qarama-qarshi.

---

## 1. FONT TIZIMI — "detskiy" signal №1 (eng katta muammo)

### 1.1. Dalillar (repo)

```css
/* public/css/style.css:75-76 */
--font-display: 'Righteous', system-ui, sans-serif;   /* funky display font */
--font-body:    'Nunito', -apple-system, ...;          /* dumaloq, o'yinchoq */
```

- **`Righteous` 22 ta viewda** (grep: `grep -rl "Righteous" views/ | wc -l` = 22)
- **`Nunito` 21 ta viewda**
- Ishlatilish misollari:
  - `views/user/panel.ejs`: `.greeting{font-family:'Righteous',cursive;font-size:1.5rem}`, `.sec-title{font-family:'Righteous'...}`, `.nav-logo{font-family:'Righteous',cursive;...background:linear-gradient(135deg,var(--accent),var(--gold));-webkit-background-clip:text...}` (gradient matn logo!)
  - `views/role/teacher.ejs:10`: `.ov-stat .n{font-family:'Righteous',cursive;...linear-gradient(135deg,var(--accent),var(--gold));-webkit-background-clip:text}`
  - `views/game/enter.ejs:45`: `.lob-code{font-family:'Righteous',cursive;font-size:4.5rem;color:var(--gold);...animation:glow 2.5s...}`
  - `views/game/enter.ejs:88`: `.lb-title{font-family:'Righteous',cursive;font-size:2rem;color:var(--gold);...animation:gleam 2s...}`

### 1.2. Evidence (nima uchun noto'g'ri)

- **style.md 42** — "Official but recognizable" tipografiya; Righteous — "arcade/display" font
- **gapsystudio**: "Too quirky fonts are often amateur-ish; ultra-generic fonts are lazy. Choose typefaces in line with your brand but assertive. **Legibility is more important than personality**"
- **multipurposethemes (LMS)**: "Stick to two or three font styles maximum. Use weight and size to show importance" — Righteous gradient-matn hamma sarlavhada = bitta "style", hech qanday hierarchy emas
- **memorable.design/alfdesigngroup**: hero'da sans-serif legibility (sinf projektori uchun ham)
- **style.md 29**: "Typography, iconography and illustration refinement"

### 1.3. Tuzatish (evidence asosida)

```text
--font-display: 'Manrope'/'Inter'/'Space Grotesk' (600-800) — official, lekin taniladigan
--font-body:    'Inter'/'Manrope' (400-700) — sans-serif, legibility
--font-mono:    ishlatilgan joyda (kod)
→ Righteous/Nunito barcha 22+21 viewdan olib tashlanadi (grep testi)
→ Gradient-matn logo o'chiriladi (style.md: qat'iy, official)
→ Tipografiya scale: display/headline/title/body/label/caption tokenlar (design.dev)
```

---

## 2. RANG TIZIMI — light mode "xira kulrang", OKLCH yo'q

### 2.1. Dalillar (repo)

```css
/* public/css/style.css:14-20 (DARK) */
--bg-deep: #050914; --bg-primary: #080C1A; --bg-surface: #0C1124;
--bg-card: #0F1630; --bg-card-hover: #131B3A; --bg-elevated: #182244;

/* public/css/style.css:202-208 (LIGHT!) */
--bg-deep: #B8BCCF; --bg-primary: #C0C4D5; --bg-surface: #B4B8CB;
--bg-card: #D0D4E3; --bg-card-hover: #C8CCDD; --bg-elevated: #D8DCEA;
```

- **Light mode `--bg-primary: #C0C4D5`** — bu kulrang-lavanda, **oq emas**! (toza white = #FFFFFF). Sahifa fonida `#C0C4D5` — xira, "iflos" ko'rinadi.
- Barcha ranglar **hex** — `oklch()` YO'Q (style.md 20 talab qiladi)
- `--accent: #3B82F6` (light `#2563EB`) — style.md master'dagi **Edikit Cobalt #255EDB** bilan mos emas
- `--ease-bounce` (0.68,-0.55,0.265,1.55) va `--ease-elastic` — style.md 6.3 "No bounce/spring" ga zid (hatto token sifatida mavjud)

### 2.2. Evidence

- **style.md 0**: "ko'k-kulrang xira light mode emas" — aynan shu holat! Light theme alohida sifatli bo'lishi kerak, "bir-birining inversion'i emas"
- **style.md 20.3**: Light neutral scale: L100-95 canvas (oq!), L94-88 nested... — hozirgi #C0C4D5 ≈ L~78 — spec'dan ancha qorong'i
- **csstools/devpane**: oklch() perceptual L — light/dark'da "flip lightness" qoidasi
- **LogRocket/dev.to**: dark'da off-black (#080C1A ✓ to'g'ri), light'da off-white (✗ #C0C4D5 emas)
- **M3**: hue/chroma bir xil, faqat tone o'zgaradi — hozirgi light/dark palitra buni buzadi (light'da accent #2563EB, dark'da #3B82F6 — bir xil oila emas)

### 2.3. Tuzatish

```text
→ OKLCH master palitra (style.md 20.2 dagi qiymatlar):
  light canvas oklch(97.58% 0.0057 264.5) #F5F7FB  (oq-ish, xira emas)
  dark  canvas oklch(16.00% 0.0249 264.6) #080D18
→ @layer + color-mix() + light-dark() (CSS 2026 — research_ui_tech_deep 1.4)
→ Har token: hex fallback + oklch ikki qiymat (style.md 20.2)
→ Ease tokenlardan bounce/elastic o'chirish; faqat standard/enter/exit/emphasis (style.md 6.3)
```

---

## 3. MOTION — 40+ keyframes, 900ms theme, reduced-motion YO'Q

### 3.1. Dalillar (repo — hisoblangan)

| Fayl | Keyframes | Infinite | Muammo |
|---|---|---|---|
| `views/index.ejs` | 9 (float3d, orbitL 40s, orbitS 30s, drift 18-24s×6, pulseAura, shimmerBtn, countUp, revealCard 1s, badgePulse 3s) | 6 particle + 2 orbit + badgePulse | Doimiy harakat; revealCard **1s** (NN/g: 500ms max); orbit/drift = detskiy |
| `views/game/enter.ejs` | **11** (glow 2.5s, blink, optShimmer 4.5s, optSweep 5.5s, pop, gleam 2s, slideIn, bounce confetti 1.2s, sp) | ko'p | "Arcade" uslub; confetti **bounce infinite**; optShimmer/optSweep doimiy |
| `views/game/host.ejs` | 8 (glow, popIn, optShimmer, optSweep, pop, gleam, slideIn, sp) | ko'p | Xuddi shu arcade |
| `views/user/assignments.ejs`, `camera-pilot.ejs`, `security-profile.ejs`, `admin/camera-review.ejs`, `role/proctor.ejs` | 1-2 tadan | — | Har viewda inline keyframes |
| `public/js/theme.js` | **900ms** theme transition + 1050ms cleanup | — | NN/g: 500ms "drag" boshlanadi; 1s = limit |

**Reduced-motion:** `grep -r "prefers-reduced-motion" public/ views/` — **YO'Q** (hech qayerda emas!) — WCAG 2.2.2 / NN/g majburiy talab buzilgan.

**Easing:** `views/index.ejs:206,467` — `transition: all .45s var(--ease-spring)` — **spring/bounce** (cubic-bezier(0.34,1.56,0.64,1)) — style.md 6.3: "No bounce/spring in productivity UI".

### 3.2. Evidence

- **NN/g Animation Duration**: 100ms toggle; 200-300ms modal; **500ms = "feel like a real drag"**; 1s = upper limit
- **UXmatters**: 200-500ms range
- **Chrome I/O 2024**: hamma animatsiya `@media (prefers-reduced-motion: no-preference)` ichida bo'lishi shart
- **style.md 6**: motion tokenlari (80-500ms); "No bounce/spring"; property rules (transform/opacity)
- **style.md 24 (Cast)**: "cheklangan energiya, accessibility-safe celebration" — hozirgi cast = unlimited arcade energy
- **research_ui_tech_deep**: scroll-driven animatsiya CSS'da (JS emas), @supports + reduced-motion

### 3.3. Tuzatish (motion rejasi)

```text
→ index.ejs: orbit/drift/particle/pulse/shimmer/float3d keyframes O'CHIRILADI
  (grep testi: bu nomlar yo'q bo'lishi kerak)
→ revealCard 1s → 240-320ms, faqat 1-2 jiddiy section, no-preference'da
→ Cast: glow/gleam/optShimmer/optSweep/confetti-bounce → state-led 300-500ms bir marta
→ theme.js: 900ms → @property + View Transitions 400-500ms (jonshamir);
  reduced-motion'da instant flip (notanumber)
→ BUTUN tizimga: @media (prefers-reduced-motion: reduce) global (0.01ms)
```

---

## 4. THEME — default DARK, "system" yo'q, JS-hack

### 4.1. Dalillar

```js
/* views/partials/head.ejs:50 */
if(!t)t='dark';  /* ← DEFAULT DARK */
/* public/js/theme.js */
setTimeout(function(){ root.setAttribute(ATTR, next); ... }, 20);  /* JS-hack */
setTimeout(function(){ document.documentElement.removeAttribute(TRANS_ATTR); }, 1050);
```

- **Default = DARK** — education/UZ kontekstida light default tavsiya (huedserve: education'da light "professional/clear"; UZ davlat portallari light)
- **Faqat dark/light** — "System" rejimi yo'q (cybrosys/LogRocket: "best UX decision — let users switch + auto based on system")
- **theme-floating button** — har sahifada bottom-right suzuvchi tugma (standart: top-right — dev.to; landing'da header'da bo'lishi kerak)
- 20ms setTimeout + 1050ms cleanup — brittle JS; zamonaviy: `light-dark()` + `@property` + View Transitions (research_ui_tech_deep 1.4/3.3)

### 4.2. Evidence

- **Smashing 2025**: "Switching between dark and light modes should be smooth and unobtrusive... remembering your preferences"
- **cybrosys**: "Offering both modes through a toggle or auto-switching based on system preferences gives users control"
- **head.ejs FOUC** — ijobiy: inline head script sync (FOUC yo'q, to'g'ri) — LEKIN `color-scheme` property qo'yilmagan (native form controls/scrollbar theme'ga mos emas) — gaisdev/denis-anfruns

### 4.3. Tuzatish

```text
→ Default: light (education) yoki "system" birinchi marta
→ 3 rejim: Light / Dark / System (localStorage: 'light'|'dark'|'system'; system → matchMedia listener)
→ Inline head script: data-theme + color-scheme + background + theme-color (FOUC-free)
→ Theme switch: @property transition 400-500ms yoki View Transitions; reduced-motion instant
→ Toggle: header'da (top-right), landing/auth/panel hammasida bir xil joy
```

---

## 5. LANDING (index.ejs) — struktura evidence'ga zid

### 5.1. Dalillar (satrma-satr)

| Joy | Kod | Muammo | Evidence |
|---|---|---|---|
| H1 (`~605`) | `Interaktiv Platforma` | Generic, outcome emas | webanatomy: value prop 89% "table stakes"; Involve: headline 10 so'z benefit; "Sinf nimani tushunganini shu zahoti ko'ring" |
| CTA (`~611-620`) | `Boshlash` + `O'yinga kirish` (gamepad icon) + `Admin` | 3 CTA (22% yo'qotish); "o'yin" — detskiy; **Admin link PUBLIC** | landing-page.io: single CTA +22%; style.md 41.7 "Admin utility small"; xavfsizlik: admin entry leak |
| Badge (`~583`) | `Official Platform v2.0` | "v2.0" — texnik; credibility emas | style.md 41.3: credibility bar = WCAG/No-camera/Server-confirmed/Uzbek-first |
| Features | `Real-time Multiplayer`, `Mock Fanlar`, `PRE Test tizimi` | Feature-focused, emas natija; "Mock" — jargon | Instapage/CXL: benefit framing; style.md 41.5 "Do not lead with tech stack/abstract AI" |
| Statistics | `demo statistik ko'rsatkichlar`, `15+`, `100+`, `5-xim` (typo!), `24/7`, `Local DB` badge | **FAKE stats** + typo + texnologiya oshkor | gapsystudio: "too much social proof = desperate"; digital.gov: "Correct and current content"; style.md 41.7 "Local DB labels removed"; trust = tekshiriladigan da'volar |
| Footer | `© 2026 Edikit v2.0 — Node.js Edition`; 2 link (O'yinga kirish, Admin) | Tex stack oshkor; privacy/terms/contact YO'Q | digital.gov trust pillars: contact, policy, status, changelog |
| Hero visual | Logo 80px + abstract | **Product screenshot YO'Q** | webanatomy: product visual 68% adoption; alfdesigngroup: "hero visual shows the product" |
| Social proof | YO'Q | Credibility moment yetishmaydi | webanatomy: social proof above fold 41% → best-in-class 81% |

### 5.2. Landing uchun to'liq tuzatish rejasi → `research_ui_landing_deep.md` 3-bo'lim

---

## 6. AUTH UI (login.ejs) — email yo'q, "4 belgi parol", forgot yo'q

### 6.1. Dalillar (satrma-satr)

```html
<!-- login.ejs login form -->
<label>Foydalanuvchi nomi</label>
<input name="username" ... autocomplete="username">
<label>Parol</label>
<input name="password" type="password" ... autocomplete="current-password">
<!-- Forgot password havolasi YO'Q -->

<!-- login.ejs register form -->
<label>Foydalanuvchi nomi</label>
<input name="username" ... pattern="[a-zA-Z0-9_]{2,20}">
<label>Parol</label>
<input name="password" type="password" ... minlength="4">  <!-- ← "kamida 4 ta belgi" -->
```

### 6.2. Topilmalar + evidence

| № | Topilma | Evidence |
|---|---|---|
| 1 | **Register'da email maydoni YO'Q** — faqat username+parol; lekin auth B-01 users schema email majburiy, B-05 email validatsiya, B-06 verify — **UI backend'den uzilib qolgan** | ivyforms: email+password 3-4 field; B-03/B-05/B-06 |
| 2 | **Parol minlength=4** — NIST SP 800-63B-4: min 15 (single-factor) / 8 (MFA); "4 belgi" — xavfsizlik falokat | NIST 63B-4; A-22 |
| 3 | **"Forgot password?" havolasi YO'Q** — A-06/A-20 rejalashtirilgan, UI'da yo'q; Nielsen heuristic #1 visibility | echobind: "put Forgot link near password field"; authgear error map |
| 4 | **Show/hide parol toggle YO'Q** | NIST tavsiyasi; ivyforms: standard 2023+ |
| 5 | **Trust microcopy YO'Q** ("Ma'lumotlar UZ'da", privacy) | ivyforms: security badge +15-25% completion; maviklabs |
| 6 | **Google button** — hidden, `/auth/status` fetch'da ochiladi; **Telegram (B-22) YO'Q** | UZ'da Telegram dominant (DataReportal; my.edu.uz OTP pattern) |
| 7 | **Admin panel link** login footer'da — public | xavfsizlik; style.md 41.7 |
| 8 | Inline `<style>` butun sahifa — design system yo'q | token sprawl; research_ui_style_deep 1 |
| 9 | Light theme'da `.inp` background `rgba(255,255,255,.04)` — **oq ustida oq input** (light mode'da ko'rinmas!) | LogRocket: dark'da light-adapted tokens; light theme alohida test |
| 10 | `.btn-primary` `linear-gradient(135deg,var(--accent),var(--accent-dark))` — gradient tugma | style.md: flat/official; M3: solid container |

### 6.3. Tuzatish → `research_ui_auth_deep.md` 2-4-bo'limlar (to'liq spec)

---

## 7. PANEL/TEACHER — "glanceable" emas, detskiy elementlar

- `panel.ejs`: body::before **radial gradient blobs** (style.md: "no blurred blobs"); `backdrop-filter: blur(18px)` navbar (low-end perf); hover `scale(1.05)` (style.md: no scale, max translateY(-1px)); Righteous sarlavhalar
- `teacher.ejs:10`: statistika raqami gradient-matn Righteous — evidence: glanceable cockpit sokin bo'lishi kerak (style.md 23; MDPI: teacher vaqt bosimi ostida)
- **Student panel'da progress/trend/chart yo'q** (faqat test ro'yxati) — MyLA evidence: awareness/self-reflection uchun progress visualizatsiyasi kerak (research_ui_user_deep 1)
- **Gamifikatsiya**: confetti/bounce/ball — BPL emas, progress+feedback (arxiv 2025: progress bar eng qadrli GDE)

---

## 8. ARXITEKTURA / PERFORMANCE — real INP muammolari

| № | Topilma | INP/CWV ta'siri | Evidence |
|---|---|---|---|
| 1 | **socket.io CDN har sahifada** (`head.ejs:37`) — landing'da ham! | ~35-45KB JS yuklanadi, keraksiz | logoswebdesigns: third-party defer/idle; INP |
| 2 | **main.js har sahifada** (168 qator) — landing uchun keraksiz | Parse/exec main thread | INP <200ms; "static sites pass INP by default" |
| 3 | Har view'da inline `<style>` (index 788 qator ichida ~500 qator CSS) | HTML bloat, LCP | critical CSS inline — lekin bu 500+ qator, LCP zarar |
| 4 | `backdrop-filter: blur(18px)` — navbar | Paint cost low-end | web.dev: backdrop-filter og'ir |
| 5 | 40+ infinite keyframes — kompositor yuki | Battery/frame | NN/g motion; performance budget |
| 6 | 3rd-party: fonts.googleapis (2 font-family), socket CDN, PWA SW | — | font preconnect ✓ bor; display=swap ✓ |
| 7 | **CSP yo'q** (head'da ko'rinmadi; server.js tekshirish kerak) | XSS risk | security headers (D-34) |

**Performance budget (research_ui_tech_deep 6):** LCP<2.5s, INP<200ms, CLS<0.1, JS<100kB first-load.

---

## 9. XULOSA — priority ro'yxat (audit asosida)

```text
P0 (xavfsizlik/funktsiya):
 1. Register: email maydoni + verify (B-05/06) — hozir UI backend'den uzilgan
 2. Parol minlength 4 → NIST 8/15 (A-22) — xavfsizlik
 3. Forgot password havolasi (A-06) — login'ga qo'shish
 4. Admin link'ni public sahifalardan olib tashlash
 5. prefers-reduced-motion global — WCAG buzilishi

P1 (detskiy → official):
 6. Righteous/Nunito → professional font (22+21 view)
 7. Orbit/drift/particle/pulse/shimmer/glow/gleam/confetti-bounce — o'chirish
 8. Light mode #C0C4D5 → #F5F7FB (style.md 20.2 OKLCH)
 9. Fake statistika + "Local DB"/"Node.js Edition" label'lar — olib tashlash
 10. Landing H1/CTA — outcome-based, bitta CTA, credibility bar, product screenshot

P2 (tizim):
 11. tokens.json (W3C DTCG) + Style Dictionary → CSS variables (research_ui_tech_deep 3)
 12. @layer + color-mix + light-dark + @property (modern CSS)
 13. theme.js 900ms → 400-500ms @property/View Transition; Light/Dark/System
 14. socket.io/main.js faqat kerakli sahifalarda
 15. Student panel: progress/trend vizualizatsiya (MyLA)
```

---

## 10. QABUL MEZONLARI (audit yopilganda — grep testlari bilan)

1. `grep -r "Righteous\|Nunito" views/ public/` = **0 natija**
2. `grep -r "orbit\|drift\|particle\|pulseAura\|shimmerBtn\|float3d\|optShimmer\|optSweep\|gleam\|confetti" views/` = **0**
3. `grep -r "prefers-reduced-motion" public/ views/` = **≥1 global** (va `no-preference` ichida hamma motion)
4. `grep -rn "minlength=\"4\"" views/` = 0; register'da `email` input bor
5. Login'da `Forgot password` havolasi bor
6. Light theme `--bg-primary` = oq-ish (`oklch(97%+ 0 264)` yoki `#F5F7FB`)
7. Landing'da: 1 primary CTA, credibility bar, product screenshot, fake stats yo'q, footer'da privacy/terms/contact
8. `theme.js`: 3 rejim (light/dark/system), FOUC-free, reduced-motion instant
9. socket.io faqat `/play` va Cast sahifalarida
10. Student panel'da progress/trend vizualizatsiya bor
