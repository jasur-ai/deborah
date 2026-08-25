# Edikit TEXNOLOGIYA QATLAMI — DEEP RESEARCH (2025-2026 yangi texnologiyalar, CSS/JS, AI, performance, token tooling)

> **Holat:** research bosqichi. Bu hujjat — "qanday texnologiya, qanday yangiliklar chiqdi" savoliga javob: 2025-2026 da chiqqan va Edikit'ni "mukammal" qilish uchun ishlatiladigan texnologiyalar. Hozirgi stack: **Express 4 + EJS (SSR) + Socket.io 4 + vanilla JS + PostgreSQL + Redis** — bu aslida 2026 performance trendlariga juda mos (kam JS = yaxshi INP).
> **Asosiy tamoyil (Netguru 2026 trend map):** Adopt now (TypeScript, signals, INP-focus, modern CSS) / Watch (View Transitions, edge, AI codegen, Astro) / Skip (Web Components as primary, Bun prod). Edikit — pragmatik: mavjud stack'ni buzmasdan, modern CSS va token tizimini qo'llash.

---

## 1. Modern CSS 2026 — Edikit qabul qilishi kerak bo'lganlar

Manbalar: blog.weskill.org (Modern CSS 2026), explainx.ai (browser support jadvali), alexcloudstar (delete the JavaScript), riadkilani (2026 CSS features), css-zone, craftedbydev (what replaces what), developer.chrome.com (new in web UI).

### 1.1. Browser support 2026 (xavfsiz ishlatish)

| Feature | Chrome | Firefox | Safari | Holat |
|---|---|---|---|---|
| Container queries | 105+ | 110+ | 16+ | ✅ universal |
| `:has()` | 105+ | 121+ | 15.4+ | ✅ **100% support** (alexcloudstar: "safe in production, no fallback needed") |
| CSS nesting | 112+ | 117+ | 16.5+ | ✅ universal |
| Cascade layers `@layer` | 99+ | 97+ | 15.4+ | ✅ universal |
| `oklch()` | 111+ | 113+ | 15.4+ | ✅ universal (~90-95%) |
| `color-mix()` | 111+ | 113+ | 16.2+ | ✅ universal |
| `@property` | 85+ | 128+ | 16.4+ | ✅ universal |
| Subgrid | 117+ | 71+ | 16+ | ✅ universal |
| `light-dark()` | 123+ | 120+ | 17.2+ | ✅ universal (2025) |
| View Transitions (cross-doc) | 126+ | 140+ | 18.2+ | ✅ barcha major (2026) |
| Scroll-driven animations | 115+ | (behind flag) | 26+ (TP) | ⚠️ **Watch** — Safari/Firefox ehtiyot |
| Anchor positioning | 125+ | (behind flag) | (in development) | ⚠️ **Watch** — fallback shart |
| `@scope` | 118+ | (behind) | 17.4+ | ⚠️ Watch |
| `text-wrap: balance/pretty` | 117+ | 121+ | 17.5+ | ✅ universal |
| `dvh/svh/lvh` | 108+ | 101+ | 15.4+ | ✅ universal |
| Popover API | 114+ | 125+ | 17+ | ✅ universal |
| `accent-color` | 93+ | 92+ | 15.4+ | ✅ universal |

### 1.2. Edikit CSS arxitektura qarori (evidence)

**Nima uchun vanilla CSS + tokens (Tailwind emas):**
- 2026'da ko'p jamoalar Tailwind'dan Native CSS + Design Tokens'ga qaytmoqda (weskill: "@layer + CSS Variables provides most of the benefits of Tailwind with none of the bundle bloat")
- `:has()` "deletes the most JavaScript per line" — form validatsiya, parent-styling JS'siz (alexcloudstar)
- `color-mix()` — butun palitra 2-3 base color'dan CSS'da (craftedbydev: "no Sass functions, no JS, no design tool needed")
- Preprocessor (Sass) kerak emas — nesting native (explainx)

**Qabul qilinadigan CSS stack:**
```text
1. @layer qatlamlari: reset → tokens → base → components → utilities (specificity urush yo'q)
2. CSS nesting (native)
3. Container queries — dashboard kartalari (sidebar/panel o'lchamiga mos)
4. :has() — form error state (label:has(+ input:invalid)), card variants
5. oklch() + color-mix() + light-dark() — rang tizimi (style.md 20 bilan mos)
6. @property — <color>-typed tokenlar (theme interpolatsiya)
7. subgrid — kartalar/chart'lar align
8. text-wrap: balance — sarlavhalar; dvh — mobil 100vh
9. accent-color — checkbox/radio theme'ga mos
10. View Transitions — sahifa/theme transition (progressiv kuchaytirish)
```

### 1.3. Scroll-driven animations (riadkilani + joshwcomeau + locallylost)

```css
.section { view-timeline: --reveal block; }
figure { animation: fade-in 1s ease both; animation-timeline: --reveal; animation-range: entry 0% cover 60%; }
```
- JS scroll listener o'rniga (locallylost: "replaces JavaScript parallax libraries")
- **Qoida:** `@supports (animation-timeline: view()) { @media (prefers-reduced-motion: no-preference) { ... } }` (Chrome I/O 2024)
- Edikit'da: landing scroll reveal, cast'da dashboard — faqat no-preference'da
- **Watch** sifatida qoladi (Safari/Firefox'da to'liq emas) — fallback static

### 1.4. light-dark() (developer.chrome.com — new in web UI)

```css
:root { color-scheme: light dark; }
.btn { background: light-dark(white, oklch(0.25 0.03 264)); }
```
- Ikkala theme bir qatorda; endi faqat color emas — **barcha value** (images ham) (Chrome July 2026: "no longer limited to just color values")
- `contrast-color()` — WCAG AA asosida avtomatik qora/oq text (Chrome July 2026)
- Edikit: `light-dark()` + `@property` + View Transitions — theme engine uchun zamonaviy trio

---

## 2. Core Web Vitals 2026 — INP (yangi metrik)

Manbalar: web.dev/articles/vitals, web.dev/articles/optimize-inp, web.dev/articles/inp, logoswebdesigns (INP 2026), nitropack, skymoon, searchenginejournal, web.dev (thresholds defined).

### 2.1. Chegaralar (2026)

| Metrik | Yaxshi | O'rtacha | Yomon | Izoh |
|---|---|---|---|---|
| **LCP** | ≤2.5s | 2.5-4s | >4s | yuklanish |
| **INP** | ≤200ms | 200-500ms | >500ms | **interaktivlik (FID o'rniga, 2024-03-12 dan)** |
| **CLS** | ≤0.1 | 0.1-0.25 | >0.25 | vizual barqarorlik |

### 2.2. INP nima va nima uchun muhim

- FID faqat birinchi interaction'ni o'lchagan; INP **har bir interaction** — "time from clicking a button to the menu actually opening" (logoswebdesigns)
- **43% saytlar INP'da yiqilmoqda** — eng ko'p fail qilingan CWV (logoswebdesigns)
- INP 500→200ms — **+22% engagement** (Google Web Vitals research)
- **Yechim:** JS minimal; long tasks <50ms; `scheduler.yield()`; third-party defer/async; `content-visibility: auto` offscreen; layout thrashing yo'q (logoswebdesigns)
- **Static/hand-coded saytlar INP'ni default o'tadi** (<100ms) — "static, hand-coded sites pass INP by default because they barely run JavaScript on user input"

### 2.3. Edikit uchun xulosa (muhim!)

```text
Edikit EJS (SSR) + vanilla JS = INP-friendly arxitektura (kam JS main thread).
LEKIN:
1. `views/index.ejs`'dagi ko'p keyframes/animatsiyalar — kompositor'da, lekin JS scroll listener'lar bo'lsa main thread band.
2. Cast (Socket.io) — real-time; Socket handler'lar yengil bo'lishi kerak (INP <200ms).
3. Third-party: Turnstile, analytics — defer/async, idle'da yuklash.
4. content-visibility: auto — uzun sahifalar (landing) uchun.
5. Har bir interaktiv element INP budget'da: click → paint <200ms.
6. LCP: landing hero (product frame) — WebP/AVIF, preload, CDN.
7. CLS: width/height, font-display: swap, sticky header balandligi rezerv.
```

---

## 3. Design Tokens — W3C DTCG spec (2025.10 — STABIL)

Manbalar: themotiondesign (spec real), digitalapplied (systems 2026), artofstyleframe (tokens to code), designtools.fyi (Tokens Studio), oneminutebranding, designmd (tokens vs DESIGN.md).

### 3.1. Yangi narsa: W3C Design Tokens spec STABIL bo'ldi

- **W3C Design Tokens Community Group — 2025.10 format — stable, versioned spec** (themotiondesign, digitalapplied)
- **`$value` / `$type`** sintaksis — de-fakto standart (oneminutebranding)
- **17 token turi:** color, dimension, fontFamily, fontWeight, duration, cubicBezier, number, string, boolean, strokeStyle, border, transition, shadow, gradient, typography, fontStyle (themotiondesign)
- **Alias:** `{color.brand.blue-600}` — reference, copy emas; build'da resolve (themotiondesign)
- **$type inference:** guruhga $type — 80 color token uchun boilerplate kamayadi (themotiondesign)
- **24+ tashkilot:** Adobe, Amazon, Google, Microsoft, Meta, Figma, Sketch, Salesforce, Shopify, Tokens Studio, Penpot (digitalapplied)
- **OKLCH/P3 qo'llab-quvvatlanadi** (digitalapplied)

### 3.2. Toolchain (2026 standart)

```text
Figma Variables (Collections + Modes: light/dark/multi-brand)
  → Tokens Studio plugin (export DTCG JSON → Git repo)
  → Style Dictionary v4/v5 (transform → CSS variables, SCSS, JS, Tailwind config)
  → CI/CD (token PR review → auto-generate)
```

- **Tokens Studio** — standart Figma plugin; Style Dictionary V4'ni o'zi maintain qiladi; open source (designtools.fyi)
- **Style Dictionary v5** — 2025.10 to'liq compat (digitalapplied, artofstyleframe)
- **Round-trip:** Figma'da token rename → DTCG → Style Dictionary → CSS — avtomatik (themotiondesign: "if a designer renames a token in Figma, that change propagates")
- **Penpot** — open source, native DTCG token support (first design tool) (the-design-system-guide)

### 3.3. AI + tokens (yangi kontekst)

- **AI-generated code tokens'siz = inconsistent by default** (oneminutebranding) → tokens = AI uchun ham source of truth
- **CLAUDE.md / DESIGN.md** — AI agent'larga token kontekstini berish (oneminutebranding, designmd: tokens JSON — "LLM-readable but lacks context"; DESIGN.md — "designed for context windows")
- **Figma MCP server** — AI editor'lar (Cursor/Claude Code) Figma'ni o'qiy oladi (sanjaytarani)
- **Edikit uchun:** `tokens.json` (W3C DTCG) + Style Dictionary → `:root` CSS variables; AI prompt'larida token nomlari ishlatiladi

---

## 4. AI in EdTech 2026 — nimalar yangi

Manbalar: preissmurphy (7 AI products), tcs.com (EdTech trends), ijtle (AI classroom), edtechinnovationhub (AI tutor shortlist), cleveroad (AI edtech), learnspark, reddit r/edtech (LMS AI), eschoolnews (49 predictions), globenewswire, tommasomariaricci (AI guide 2026).

### 4.1. Raqamlar

- **47% EdTech firmalar AI'ni core feature'ga qo'shgan** (2026) (preissmurphy)
- AI-driven adaptive pathing — **+35% completion** (preissmurphy)
- AI-assisted authoring — **3.7x tezroq content** / -60% production time (preissmurphy, ijtle)
- **82% learner'lar personalized learning path xohlaydi** (preissmurphy)
- **AI tutor Harvard RCT 2025 (Scientific Reports): +0.73–1.3 SD** — active learning'ga nisbatan, kamroq vaqtda ikki barobar ko'proq o'rganish (tommasomariaricci)
- AI grading: **41%** adoption; adaptive platforms **43%**; chatbots **35%**; ITS **29%** (ijtle)
- EdTech AI market: $8.3B (2024) → $75.2B (2034) (cleveroad)

### 4.2. "Teacher co-pilot" modeli (asosiy trend)

> "The most successful AI classroom deployments follow the teacher co-pilot model — AI serves as a real-time assistant: generating differentiated lesson prompts, suggesting resources, producing bilingual mini-lessons, auto-tagging concepts. **Teachers edit, approve, and deliver** — adding the human context AI cannot replicate." (ijtle)

- AI **teacher'ni almashtirmaydi** — admin/grading yukini oladi, teacher relationship/mentorship'ga fokuslanadi (tommasomariaricci, eschoolnews)
- **Agentic AI** — LMS'da avtonom flow'lar (ERP, routine queries) (tcs)
- **Hybrid architecture** (cleveroad): purpose-built educational AI (learning workflows) + general LLM (tutoring/conversation) — 2026 standart

### 4.3. Edikit uchun (research.md bilan mos)

Edikit'da allaqachon: AI test generator (research.md 8 — difficulty 50/30/20), AI grading pipeline (research.md 7 — rubric + confidence routing), AI presentation studio (research.md 9). UI/UX uchun:

```text
1. AI = "co-pilot" — teacher har AI natijani ko'radi/tahrirlaydi/tasdiqlaydi (ijtle model)
2. AI takliflari UI'da aniq label: "AI yaratdi — [Tahrirlash] [Qabul]" (transparency)
3. Adaptive: talabaga qiyinchilik moslashuvi — "Sizning darajangizga mos" (tcs)
4. AI feedback: instant micro-feedback har javobda (ijtle)
5. AI grading: rubrik + confidence (research.md 7.5) — teacher spot-check
6. AI chat/assistant: "Kurs bo'yicha yordam" (reddit: in-course assistant)
7. Privacy: AI'ga PII yuborilmasligi (Global Master Prompt) — UZ'da, data law
8. "Novelty era is over" (eschoolnews): AI feature'lar measurable outcome ko'rsatishi kerak
```

---

## 5. Frontend arxitektura 2026 — Edikit qarori

Manbalar: netguru (frontend trends), luminoid (frameworks), c-sharpcorner, veroscale, dev.to (frameworks), sencha (SSR trends), nucamp (JS trends), mgsoftware, devtrios (Svelte vs React).

### 5.1. Trend map (Netguru 2026)

| Verdict | Trend |
|---|---|
| **Adopt now** | TypeScript default, signals (Svelte 5 Runes/Angular/Solid), INP-focus, modern CSS |
| **Watch** | WebAssembly, View Transitions, edge rendering, AI codegen (v0/Copilot), Astro |
| **Skip** | Web Components primary, Bun prod |

### 5.2. Frameworks 2026 (jami xulosa)

- **React/Next.js** — eng katta ecosystem, RSC (render vaqt 2.4s→0.8s), AI tooling eng yaxshi (mgsoftware: 24M weekly npm, 230k stars)
- **Svelte/SvelteKit** — eng kichik bundle (15-20kb), eng yaxshi developer satisfaction (88%), low-bandwidth/emerging markets uchun ideal (devtrios)
- **Astro** — zero-JS by default, islands; content/marketing saytlar (veroscale)
- **Vue/Nuxt** — eng yumshoq learning curve (nucamp)
- **Qwik** — resumability; ultra-fast LCP (c-sharpcorner)
- 2026 konvergentsiya: fine-grained reactivity + server-first + compiler + AI-assisted (nucamp)

### 5.3. Edikit uchun (muhim — qaror)

```text
Edikit hozir: Express 4 + EJS (SSR) + Socket.io + vanilla JS.

SABOQ (evidence):
1. EJS SSR = INP-friendly (kam client JS) — almashtirish SHART EMAS (logoswebdesigns:
   "static, hand-coded sites pass INP by default").
2. Landing + auth + user + teacher — SSR EJS qoladi; interaktiv qismlar uchun
   "islands" pattern (Astro uslubi): faqat kerakli komponentlarda vanilla JS
   modullari (Svelte 5 yoki vanilla JS mixin).
3. Cast (real-time) — Socket.io + yengil client state; "signals" pattern
   (Svelte 5 Runes yoki vanilla — xohish).
4. TypeScript — allaqachon qisman (tsconfig bor); to'liq qilish (Adopt now).
5. Agar kelajakda frontend framework kerak bo'lsa: SvelteKit (kichik bundle,
   low-bandwidth UZ uchun ideal — devtrios) yoki Next.js (ecosystem).
6. AI codegen (v0/Cursor) — promplar bilan, lekin inson review (nucamp:
   "AI can't decide client vs server, or keep your app secure").
```

---

## 6. Performance budget (Edikit — raqamlar)

Manbalar: mgsoftware (<100kB JS first load), neelnetworks (WebP/CLS), logoswebdesigns (INP).

```text
┌─ BUDGET ────────────────────────────────┐
│ LCP < 2.5s (mobile 75p)                 │
│ INP < 200ms (75p)                       │
│ CLS < 0.1                               │
│ First-load JS < 100kB                   │
│ Landing hero: WebP/AVIF < 200KB; video <2MB│
│ Fonts: preconnect, subset, display:swap │
│ Third-party: defer/async, idle-load     │
│ content-visibility: auto (offscreen)    │
│ Server: Redis cache, CDN (Cloudflare)   │
└─────────────────────────────────────────┘
```

---

## 7. Edikit texnologiya qarorlari jadvali (Adopt / Watch / Skip)

| Texnologiya | Qaror | Nega |
|---|---|---|
| `:has()`, container queries, nesting, @layer, subgrid | **ADOPT** | universal support, JS'ni kamaytiradi |
| `oklch()`, `color-mix()`, `light-dark()`, `contrast-color()` | **ADOPT** | rang tizimi (style.md 20), theme |
| `@property` | **ADOPT** | `<color>` token interpolatsiya |
| View Transitions API | **ADOPT** (progressiv) | sahifa/theme transition; `@supports` fallback |
| `text-wrap: balance`, `dvh`, `accent-color`, Popover | **ADOPT** | sarlavha/mobil/form |
| Scroll-driven animations | **WATCH** | Safari/Firefox emas; fallback static |
| Anchor positioning, @scope | **WATCH** | fallback shart |
| W3C DTCG tokens + Style Dictionary v5 | **ADOPT** | tokens.json manba; AI ham ishlatadi |
| Tokens Studio / Figma Variables | **ADOPT** (agar Figma) | round-trip |
| EJS SSR + vanilla JS islands | **QOLADI** | INP-friendly; framework kerak emas |
| TypeScript to'liq | **ADOPT** | xavfsizlik, contract |
| SvelteKit (kelajak, agar) | **WATCH** | kichik bundle, UZ low-bandwidth |
| AI co-pilot (generator/grading/tutor) | **ADOPT** | research.md bilan; transparency |
| Socket.io (Cast) | **QOLADI** | real-time; yengil handler |
| Tailwind | **SKIP** | native CSS + @layer + tokens yetarli (weskill) |
| Web Components primary | **SKIP** | interop immatur (netguru) |
| Bun prod | **SKIP** | ecosystem stabil emas (netguru) |

---

## 8. Qabul mezonlari (texnologiya qatlami tasdiqlanganda)

1. `tokens.json` (W3C DTCG, $value/$type) + Style Dictionary → CSS variables (CI'da)
2. CSS: @layer + nesting + container queries + :has() + oklch/color-mix/light-dark + @property
3. Theme engine: `light-dark()` + @property + View Transitions + FOUC-free inline script
4. INP <200ms (RUM o'lchovi); LCP <2.5s; CLS <0.1 (mobile 75p)
5. First-load JS <100kB; third-party defer/async
6. AI: co-pilot model — har AI natija [Tahrirlash]/[Qabul] bilan; PII AI'ga yuborilmaydi
7. View Transitions — @supports + prefers-reduced-motion fallback
8. TypeScript to'liq (auth/UI modullari)
9. Perf budget hujjatda; monitoring (CrUX/RUM)

---

## 9. Manbalar

### Modern CSS
blog.weskill.org (Modern CSS 2026) · explainx.ai (browser support) · alexcloudstar.com (delete JS) · blog.riadkilani.com (2026 CSS, 2025 CSS) · css-zone.com · craftedbydev.com (what replaces what) · developer.chrome.com/blog/new-in-web-ui-io26 · developer.chrome.com/blog/new-in-web-ui-io-2024 · joshwcomeau.com (scroll-driven) · locallylost.com · css-tricks.com · web.dev/blog/baseline-digest-may-2026 · daily.dev (CSS trends) · dev.to prathamisonline

### Core Web Vitals / INP
web.dev/articles/vitals · web.dev/articles/optimize-inp · web.dev/articles/inp · web.dev/articles/defining-core-web-vitals-thresholds · logoswebdesigns.com (INP 2026) · nitropack.io (CWV strategy) · skymooninfotech.com · searchenginejournal.com · publift.com

### Design tokens / tooling
themotiondesign.com (DTCG real) · digitalapplied.com (design systems 2026) · artofstyleframe.com (tokens to code) · designtools.fyi (Tokens Studio) · oneminutebranding.com · designmd.app (tokens vs DESIGN.md) · docs.tokens.studio (Style Dictionary) · learn.thedesignsystem.guide (Penpot) · sanjaytarani.com (Figma MCP handoff) · figma.com/community (Tokens Studio)

### AI EdTech
preissmurphy.com (7 AI products) · tcs.com (EdTech trends 2026) · ijtle.com (AI classroom) · edtechinnovationhub.com (AI tutor shortlist) · cleveroad.com (AI edtech) · learnspark.io · reddit r/edtech (LMS AI) · eschoolnews.com (49 predictions) · globenewswire.com · tommasomariaricci.com (AI education guide)

### Frontend architecture
netguru.com/blog/front-end-trends · blog.luminoid.dev (frameworks 2026) · c-sharpcorner.com (top 10 JS) · veroscale.au (framework decision) · dev.to 0x1da49 (frameworks) · sencha.com (SSR trends) · nucamp.co (JS trends) · mgsoftware.nl · devtrios.com (Svelte vs React)
