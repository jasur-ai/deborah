# Edikit UI/UX — FAZA C: LANDING (index sahifa to'liq qayta qurish)

> **Old shart:** Global Master Prompt (UI/UX) har promptdan oldin.
> **Source:** `research_ui_landing_deep.md` (evidence struktura, 151-hero tahlili), `research_ui_top_sites_deep.md` (benchmark: Google/BBC/Overlake/By-Kin), `uploads/style.md` 41 (official landing blueprint).

---

## C-00 — Landing preflight

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_landing_deep.md` 2-4-bo'limlarini o'qib, landing strukturasini rejalashtir:
   Header → Hero → Credibility bar → Brand story (Ask→See→Adapt) → Product proof → How it works → Social proof → CTA → Footer.
03. Precondition: B-13 (Foundation) yashil.
04. Hozirgi `views/index.ejs` (788 qator) ni inventarizatsiya qil: nima qoladi (hero kontainer, section'lar), nima ketadi (particles/orbits — A-02 da ketgan; fake stats — A-05 da ketgan).
05. Qaror: landing uchun yangi struktura — `views/index.ejs` qayta yoziladi (inline style kamaytiriladi, base B'dan).
06. Har section uchun vazifa: (1) benefit, (2) isbot, (3) harakat — aniq.
07. Baseline: `npm run typecheck` + `npm test`.
08. Security/data guard: hech narsa o'zgartirilmaydi (faqat reja).
09. Unit test: existing smoke.
10. Integration/contract test: existing.
11. E2E/security test: workspace toza.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga C-00 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: struktura tasdiqlanmasa.
16. Done condition: landing reja aniq, C-01 ready.
17. C-01 uchun: header — tayyor ekanini dalil bilan yoz.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
24. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
25. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
26. Security: CSRF (mavjud fetch patch), XSS (esc), PII minimal — bu o'zgarishda buzilmasligi tekshirildi.
27. Ledger: `implementation-status-uiux.md` yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
28. Manual signoff: operator visual/tekshiruv natijasini tasdiqlaydi (screenshot/test raqam).
29. Next readiness: keyingi prompt boshlanishi uchun dalil (grep/test natijasi) yoziladi.
```

---

## C-01 — Landing header (minimal, sticky)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/index.ejs` header'ini B-11 base bilan qurish:
   - `.site-header`: sticky, blur(12px), border-bottom token.
   - Chap: logo (`.nav-logo`, oddiy rang — gradient YO'Q, A-01).
   - O'ng: [Kirish] (ghost) + [Bepul boshlash] (primary sm) + theme toggle (icon-btn).
   - Nav item minimal (unbounce: landing'da distraction yo'q) — FAQAT Kirish/Boshlash; boshqa linklar footer'da.
03. Mobile (375px): logo + theme toggle + bitta CTA ("Boshlash") ko'rinadi; "Kirish" hamburger/secondary ichida.
04. `--header-h: 60px` rezerv (CLS 0).
05. Sticky tekshiruvi: scroll'da header qoladi, section'lar tagida yashirmaydi.
06. Security/data guard: admin linki yo'q (A-09).
07. Unit test: index header class'lar (regex); nav soni ≤3.
08. Integration/contract test: 375px'da header layout (Playwright).
09. E2E/security test: keyboard header (focus order), sticky CLS.
10. GREP-CHECK: `grep -rn "hero-btn-secondary\|Admin" views/index.ejs` = 0 (A-09 qoldig'i).
11. A11y: header landmark, aria-label nav, theme toggle aria.
12. i18n: matnlar uz (H da 4 til).
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-01 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: header CLS yoki 44px target buzilsa.
17. Done condition: minimal sticky header.
18. C-02 uchun: hero — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
26. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
```

---

## C-02 — Hero (outcome H1, bitta CTA, microcopy, visual kontainer)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `views/index.ejs` hero'ni A-06 asosida yakunlash (visual to'ldiriladi):
   - Eyebrow: "JONLI BAHOLASH · RESPONSIVE TEACHING" (Evidence Mark bilan, style.md 41.1).
   - H1: "Sinf nimani tushunganini shu zahoti ko'ring." — `.t-display`, `text-wrap: balance`, max-width ~14ch.
   - Sub: "Edikit o'qituvchiga testni jonli o'tkazish, javoblarni ko'rish va darsni dalil asosida boshqarishga yordam beradi." (≤30 so'z).
   - CTA: [Bepul boshlash] (primary lg) + [Demo Castni ko'rish] (ghost, subordinate).
   - Microcopy: "Ilova o'rnatilmaydi · Reyting o'qituvchi nazoratida" (risk-reducer).
   - Participant shortcut: "Sessiya kodingiz bormi? Kod bilan kirish →" (style.md 41.1).
03. Hero visual `.hero-visual`: 
   - A-06 kontainer → REAL product frame: haqiqiy screenshot (Director/Projector/Participant — panel/test sahifasidan) yoki demo placeholder (SVG mock — "Demo" label).
   - aspect-ratio 16/10; border token; radius lg; shadow sm; `loading="eager"` (LCP element).
   - Responsive: mobile'da visual matn OSTIDA (alfdesigngroup — text first).
04. LCP optimallashtirish: hero visual WebP/AVIF, width/height aniq (CLS 0), `fetchpriority="high"`.
05. Hero'da bitta maqsad: login; nav distraction yo'q.
06. Security/data guard: demo'da haqiqiy PII yo'q (test data).
07. Unit test: hero matnlar/CTA (regex); hero-visual mavjud.
08. Integration/contract test: `/` 200; LCP element preload.
09. E2E/security test: hero visual CLS 0; bitta primary CTA; LCP <2.5s (PageSpeed).
10. GREP-CHECK: `grep -n "Interaktiv Platforma\|O'yinga kirish" views/index.ejs` = 0.
11. A11y: H1 bitta; img alt; CTA focus.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-02 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: LCP fail yoki ikkita primary CTA bo'lsa.
17. Done condition: hero to'liq, LCP yaxshi.
18. C-03 uchun: credibility bar — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## C-03 — Credibility bar (faqat tekshiriladigan da'volar)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. Hero ostida `.trust-bar` (style.md 41.3):
   - 4 da'vo (faqat haqiqiy/tekshiriladigan):
     - "WCAG 2.2 AA maqsadi" → accessibility hujjatiga havola.
     - "No-camera Cast core" → privacy hujjati.
     - "Server-confirmed answers" → xavfsizlik hujjati.
     - "Uzbek-first interface" → til/portfolio hujjati.
   - Har biri: icon + qisqa matn; havola hujjatga (mavjud bo'lmasa — target anchor yoki yo'q havola, lekin da'vo haqiqiy bo'lishi kerak).
03. YO'Q: yolg'on logo'lar, "10,000+ user" (tekshirib bo'lmaydi), unverified certification (style.md 41.6; digital.gov).
04. Dizayn: sokin — row, muted text, border-top/bottom token; hover subtle.
05. Mobile: 2x2 grid (4 ta) — crowd emas.
06. Security/data guard: da'volar yolg'on bo'lmasin (qoida 29; A-05).
07. Unit test: trust-bar da 4 item (regex).
08. Integration/contract test: havolalar 200 (yoki anchor mavjud).
09. E2E/security test: yolg'on stat emas (grep: "10,000" yo'q).
10. GREP-CHECK: `grep -rn "10,000\|1M+\|users" views/index.ejs` = 0 (stat da'volar).
11. A11y: link'lar aniq label; icon+text.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-03 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: tekshirilmaydigan da'vo qolsa.
17. Done condition: credibility bar haqiqiy, official.
18. C-04 uchun: brand story — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
```

---

## C-04 — Brand story: Ask → See → Adapt

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `.story-section` (style.md 41.4):
   - Eyebrow: "QANDAY ISHLAYDI".
   - H2: "Savoldan qarorgacha — bitta aniq oqim."
   - 3 qadam (Evidence Mark):
     1. "So'ra — savolni oching" (Ask)
     2. "Ko'r — sinf signalini ko'ring" (See)
     3. "Moslashtir — davom eting, muhokama qiling yoki qayta tushuntiring" (Adapt)
   - Har qadam: raqam/icon + H3 + 1 qisqa paragraf (benefit).
03. Bento grid (2026 — research_ui_top_sites_deep 4.6): 3 ta modulli card (asymmetric), container queries (B-07).
04. Motion: card enter — View Transitions scroll-driven yoki simple `animation: fade-up 320ms` (no-preference'da); reduced-motion'da statik (A-03/B-08).
05. Storytelling: benefit-first (feature emas — CXL/Instapage).
06. Security/data guard: CSS/HTML only.
07. Unit test: story 3 qadam matn (regex).
08. Integration/contract test: bento grid responsive (375/1440).
09. E2E/security test: motion reduced-motion'da yo'q; XSS yo'q.
10. GREP-CHECK: `grep -n "Ask\|See\|Adapt" views/index.ejs` ≥ 3 (inglizcha terminlar label sifatida ruxsat).
11. A11y: H2/H3 ketma-ketlik; no motion blok.
12. i18n: 4 til (keyin H).
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-04 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: qadamlar benefit emas yoki bento buzilsa.
17. Done condition: Ask→See→Adapt to'liq.
18. C-05 uchun: product proof — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## C-05 — Product proof (haqiqiy demo — feature emas, natija)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `.proof-section` (style.md 41.5):
   - H2: "Sinf signali — bir qarashda." (natija yoki o'xshash).
   - Asosiy visual: REAL mahsulot screenshot (Cast/panel — teacher-private distribution, answer coverage, dominant distractor, Discuss/Reteach/Next) — haqiqiy component capture, "Demo" label.
   - Yonida 3-4 proof point (icon + qisqa):
     - "Har savol bo'yicha sinf signali (response mosaic)"
     - "Dominant distractor'ni ko'ring"
     - "Muhokama / Qayta tushuntirish / Keyingi — dars davomida"
     - "Qayta ovoz berish (before/after revote)"
03. YO'Q: avatars, points, confetti, tech stack, abstract AI (style.md 41.5).
04. Screenshot: haqiqiy (test data), WebP, width/height (CLS 0), lazy (below fold).
05. Before/after revote vizualizatsiyasi (ikki holat — sinf tushunishi o'zgarishi).
06. Security/data guard: screenshot'da haqiqiy talaba PII yo'q (test data).
07. Unit test: proof points soni (regex).
08. Integration/contract test: screenshot yuklanadi (lazy), CLS 0.
09. E2E/security test: proof'da PII yo'q (grep: JSHSHIR pattern yo'q).
10. GREP-CHECK: `grep -rn "confetti\|avatars\|points" views/index.ejs` = 0.
11. A11y: img alt tavsif; statlar screen reader.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-05 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: fake/unhaqiqiy visual yoki feature-list bo'lsa.
17. Done condition: product proof real, natija-fokus.
18. C-06 uchun: how it works — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
```

---

## C-06 — How it works (3-4 qadam, outcome timeframe)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `.how-section`:
   - H2: "3 daqiqada jonli dars." (outcome timeframe — research_ui_landing 2.1: eng kam uchraydigan, eng katta imkoniyat).
   - 3 qadam (qisqa, action):
     1. "Test yarating" — savollar qo'shing, AI taklifidan foydalaning.
     2. "Jonli o'tkazing" — 5 xonali kod, talabalar telefonda qo'shiladi.
     3. "Natijani ko'ring va moslashtiring" — sinf signali, muhokama, qayta.
   - Har qadam: icon + H3 + 1 paragraf; qisqa (scannable).
03. Step-based flow momentum (instapage): 1→2→3 vizual oqim (arrow/line).
04. Card'lar: token'li (B-09), hover border 120ms; bento/row responsive.
05. Motion: faqat no-preference'da (fade-up 320ms, scroll-driven).
06. Security/data guard: CSS/HTML only.
07. Unit test: 3 qadam matn (regex); "3 daqiqa" bor.
08. Integration/contract test: responsive row→stack (375).
09. E2E/security test: reduced-motion statik; XSS yo'q.
10. A11y: H2/H3; icon+text (rangga bog'liq emas).
11. i18n: matnlar uz.
12. Mavjud testlarni ham ishlat.
13. `implementation-status-uiux.md` ga C-06 statusi yoz.
14. Global report formatida qaytar.
15. Stop condition: qadamlar long-form bo'lsa yoki timeframe yo'q.
16. Done condition: how-it-works to'liq, qisqa, action.
17. C-07 uchun: social proof — tayyor.
18. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
19. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
20. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
21. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
22. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
23. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
24. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## C-07 — Social proof (real, tekshiriladigan)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `.social-proof` (style.md 41.6):
   - Standart: real ism/lavozim (yoki ruxsatlangan anonim rol) + muassasa (ruxsat bilan) + aniq foydalanish + natija + sana + rozilik.
   - 1-3 ta proof card (generic "Ajoyib platforma!" YO'Q).
   - Misol formati:
     "O'qituvchi, OTM (ruxsat bilan) — 'Jonli testda 30 talaba javobini birdan ko'rdim, dominant xatoni darhol tuzatdik.' — 2026-05"
03. Hozircha REAL testimonial yo'q bo'lsa: section ko'rsatilmaydi (bo'sh social proof — yolg'on emas; C-07 da faqat real mavjud bo'lsa).
   - Alternativ: "Ochiq demo" — haqiqiy misol oqimi (video/screenshot).
04. YO'Q: inventoriya raqamlar, logo'lar ruxsatsiz.
05. Dizayn: sokin card'lar, quote stil; hover subtle.
06. Security/data guard: rozilik hujjati; PII minimal.
07. Unit test: proof'da sana/rol bor (regex); bo'sh bo'lsa section yo'q.
08. Integration/contract test: proof'lar mavjud bo'lsa 200.
09. E2E/security test: yolg'on quote yo'q.
10. GREP-CHECK: `grep -rn "Ajoyib\|Amazing\|10,000+" views/index.ejs` = 0.
11. A11y: blockquote, cite.
12. i18n: matnlar uz.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-07 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: ruxsatsiz/tekshirilmaydigan proof bo'lsa.
17. Done condition: social proof real yoki section olib tashlangan.
18. C-08 uchun: CTA + footer — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
```

---

## C-08 — Final CTA + official footer

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `.cta-section`:
   - H2: "Birinchi jonli darsingizga tayyormisiz?"
   - Sub: "Test yarating, o'tkazing, natijani ko'ring — bepul."
   - CTA: [Bepul boshlash] (primary lg) + microcopy "Karta talab qilinmaydi".
03. `.footer` (official — style.md 41.7; digital.gov trust):
   - Kolonka 1 — Mahsulot: Cast, O'qituvchilar, Changelog, Status.
   - Kolonka 2 — Yordam: Accessibility, Xavfsizlik, Privacy, Terms.
   - Kolonka 3 — Aloqa: Contact (email), Til switcher (4 til).
   - Pastki: "© 2026 Edikit" (A-05: tex stack yo'q).
   - Havolalar: haqiqiy route (mavjud bo'lmasa — placeholder sahifa H fazada; ama linklar bor).
04. Admin utility: faqat bevosita (A-09); footer'da YO'Q.
05. Til switcher: native nomlar (O'zbekcha, Ўзбекча, Русский, English), 44px.
06. Security/data guard: contact PII minimal (email public).
07. Unit test: footer kolonkalar (regex); admin yo'q.
08. Integration/contract test: havolalar 200 yoki anchor.
09. E2E/security test: footer'da XSS yo'q; til switcher ishlaydi (keyin H to'liq).
10. GREP-CHECK: `grep -rn "Node.js Edition\|Local DB" views/index.ejs` = 0.
11. A11y: footer nav, contact aniq, focus.
12. i18n: footer matnlari 4 tilga tayyor (H).
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-08 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: footer'da yolg'on/keraksiz havola bo'lsa.
17. Done condition: CTA + official footer.
18. C-09 uchun: performance — tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
```

---

## C-09 — Landing performance (LCP/CLS/INP budget)

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. `research_ui_tech_deep.md` 6-bo'limi (budget) — landing'ga qo'llash:
   - LCP <2.5s: hero visual WebP/AVIF, `fetchpriority="high"`, preload, width/height (C-02).
   - CLS <0.1: barcha media width/height; font `display=swap`; sticky header `--header-h` rezerv; layout shift yo'q.
   - INP <200ms: landing'da JS minimal (A-10: socket.io/main.js yo'q); `content-visibility: auto` below-fold section'lar.
   - First-load JS <50kB (landing).
03. Tahlil: PageSpeed/Lighthouse natijasini yoz; fail bo'lsa tuzat (masalan, font subset, img compression).
04. Third-party: faqat font (Google) — `preconnect` + `display=swap`; boshqa script yo'q.
05. `loading="lazy"` below-fold media; `decoding="async"`.
06. CSS: critical inline (head'da — A-10) yoki link; render-blocking kam.
07. Security/data guard: hech qanday logika o'zgarmaydi.
08. Unit test: img width/height attributlari (regex); lazy.
09. Integration/contract test: Lighthouse LCP/CLS/INP target (mobile).
10. E2E/security test: budget natijalari hujjatda (PageSpeed raqamlar).
11. GREP-CHECK: `grep -rn "cdn.socket.io\|/js/main.js" views/index.ejs` = 0.
12. A11y: media fallback.
13. Mavjud testlarni ham ishlat.
14. `implementation-status-uiux.md` ga C-09 statusi yoz.
15. Global report formatida qaytar.
16. Stop condition: LCP >2.5s yoki CLS >0.1 bo'lsa.
17. Done condition: landing budget'da, natijalar hujjatda.
18. C-10 (checkpoint) uchun: tayyor.
19. Barcha yangi class'lar design token ishlatadi (B-01); kodda hardcoded rang/o'lcham qo'shilmaydi.
20. `git diff` natijasi ko'rib chiqiladi; operatorga tegishli noma'lum o'zgarishlar overwrite qilinmaydi.
21. Rollback: bu o'zgarish commit'dan qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya tekshirildi).
22. Regression: `npm run typecheck` + `npm test` bajariladi — oldingi fazalar (A-G) buzilmagan.
23. Visual tekshiruv: light va dark rejimda screenshot (Playwright) — professional ko'rinish tasdiqlanadi.
24. i18n: barcha yangi matnlar i18n key'dan keladi yoki keyingi H-03'da 4 tilga tarjima qilinadi (hozingi default uz).
25. A11y spot: keyboard focus, `aria` atributlari, kontrast — axe 0 critical (sahifa interaktiv bo'lsa majburiy).
26. Reduced-motion: bu o'zgarishda harakat bo'lsa — `prefers-reduced-motion: reduce` da o'chganligi tekshiriladi (A-03).
```

---

## C-10 — LANDING checkpoint sign-off

```text
01. Global Master Prompt (UI/UX) kontekstga qo'shildi.
02. C-faza qabul testlari:
   - Header: minimal, sticky, CLS 0, admin yo'q.
   - Hero: outcome H1, bitta primary CTA, microcopy, participant shortcut, real visual.
   - Credibility bar: 4 ta haqiqiy da'vo (WCAG/No-camera/Server-confirmed/Uzbek-first).
   - Ask→See→Adapt: 3 qadam benefit-first.
   - Product proof: real demo, natija-fokus, PII yo'q.
   - How it works: "3 daqiqada", 3 qadam.
   - Social proof: real yoki yo'q.
   - Footer: official, 4 kolonka, admin yo'q, til switcher.
   - Perf: LCP<2.5, CLS<0.1, INP<200, JS<50kB.
03. Full regression: `npm run typecheck` + `npm test`.
04. GREP-CHECK jadvali (C bo'yicha): fake stat, admin, gamepad, tex label, "Interaktiv Platforma" — 0.
05. A11y: axe 0 (landing); keyboard to'liq; reduced-motion.
06. i18n: uz to'liq; 4 til H fazada (ro'yxat tayyor).
07. Visual tekshiruv: landing light/dark professional (screenshot; benchmark: BBC/Overlake).
08. Sign-off: operator checklist (C-faza yopiladi).
09. Security/data guard: critical yashirilmaydi.
10. Har yangi write path uchun tenant scope, authorization, validation tekshir.
11. Unit test: full C (yangi testlar).
12. Integration/contract test: landing journey (header→hero→CTA→footer).
13. E2E/security test: full C E2E + axe + perf.
14. Mavjud testlarni ham ishlat; regression bo'lsa sababini tuzatmasdan testni o'chirib qo'yma.
15. `implementation-status-uiux.md` ga C-10 (CHECKPOINT) statusi, dalillar, sign-off yoz.
16. Global report formatida qaytar.
17. Stop condition: birorta qabul testi fail bo'lsa.
18. Done condition: Landing to'liq, official, perf budget'da.
19. Qolgan ishlar: D (Auth UI), E (User), F (Teacher), G (Cast), H (Admin/QA) — ko'chirilganini yoz.
20. Butun FAZA C yakunlandi — D-00 preflight'ga tayyor.
```

