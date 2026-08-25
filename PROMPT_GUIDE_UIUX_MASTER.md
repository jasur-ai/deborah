# Edikit UI/UX — PROMPT GUIDE MASTER (bosqichma-bosqich AI Agent bajarish tizimi)

> **Maqsad:** `research_ui_audit.md` (kod audit), `research_ui_top_sites_deep.md`, `research_ui_landing_deep.md`, `research_ui_auth_deep.md`, `research_ui_user_deep.md`, `research_ui_teacher_deep.md`, `research_ui_cast_deep.md`, `research_ui_style_deep.md`, `research_ui_tech_deep.md`, `research_repos_deep.md` asosida UI/UX'ni "universitar + global" darajaga ko'tarish. **Bu guide kod emas — har prompt copy-paste qilinadigan execution brief.**
> **Prinsip (operator talabi):** faqat **qilinadigan ish** — "nega" va bajarilgan research takrorlanmaydi; har prompt 30-40 qator, aniq, professional.
> **Qo'llash:** promptlar faza bo'yicha ketma-ket; keyingi prompt oldingisining `Done` sharti o'tmaguncha boshlanmaydi.
> **Repository:** `/home/user/edikit`

## Fazalar xaritasi (8 faza, 84 prompt)

| Faza | Fayl | Promptlar | Nima |
|---|---|---|---|
| A | `PROMPT_GUIDE_UIUX_A.md` | A-00..A-11 (12) | AUDIT-FIX: font, motion, light mode, fake stats, register email, forgot, admin link, perf |
| B | `PROMPT_GUIDE_UIUX_B.md` | B-00..B-13 (14) | FOUNDATION: DTCG tokens, @layer, OKLCH, theme engine, tipografiya, spacing, motion, komponentlar, a11y |
| C | `PROMPT_GUIDE_UIUX_C.md` | C-00..C-10 (11) | LANDING: hero, nav, credibility, features, proof, CTA, footer, perf |
| D | `PROMPT_GUIDE_UIUX_D.md` | D-00..D-09 (10) | AUTH UI: login, register, forgot, MFA, settings/security center |
| E | `PROMPT_GUIDE_UIUX_E.md` | E-00..E-09 (10) | USER PANEL: dashboard (Canvas), progress, test-arena, portfolio, notifications |
| F | `PROMPT_GUIDE_UIUX_F.md` | F-00..F-09 (10) | TEACHER: cockpit, test-builder, grading (SpeedGrader), analytics, roster |
| G | `PROMPT_GUIDE_UIUX_G.md` | G-00..G-08 (9) | CAST: lobby, projector, participant, host, gamification, celebration |
| H | `PROMPT_GUIDE_UIUX_H.md` | H-00..H-07 (8) | ADMIN + QA: admin UI, i18n, a11y audit, perf budget, final regression |

**JAMI = 84 prompt** (har biri 30-40 qator).

## Checkpointlar (operator sign-off)
- A-11 (AUDIT-FIX), B-13 (Foundation), C-10 (Landing), D-09 (Auth UI), E-09 (User), F-09 (Teacher), G-08 (Cast), H-07 (FINAL RELEASE)

---

## Global Master Prompt (UI/UX) — HAR promptdan oldin kontekstga qo'shiladi

```text
01. Sen `/home/user/edikit` repository'sida ishlaydigan senior frontend engineer va UI/UX architectsan.
02. Source of truth: `research_ui_audit.md` (kod audit), `research_ui_style_deep.md` (dizayn tizimi), `research_ui_tech_deep.md` (texnologiya); kerak bo'lsa tegishli qism faylini o'qi (landing/auth/user/teacher/cast/top_sites/repos).
03. Ishni boshlashdan oldin `git status`, current commit va mavjud o'zgarishlarni tekshir.
04. Operatorga tegishli noma'lum o'zgarishlarni overwrite/revert/delete qilma.
05. Har prompt scope'idan tashqaridagi keyingi feature'ni implement qilma.
06. Dizayn qarori: "Evidence-Led Institutional" (style.md 0) — sokin, aniq, professional; o'yinchoq/detskiy TAQIQLANGAN.
07. Detektiv qoidalar (grep testlari CI'da majburiy): `Righteous`, `Nunito`, `orbit`, `drift`, `particle`, `pulseAura`, `shimmer`, `float3d`, `gleam`, `confetti-bounce`, `--ease-bounce`, `--ease-elastic`, `minlength="4"` — YO'Q.
08. Barcha rang/space/type/motion qiymatlari — design token'dan (DTCG, 3 qavat); kodda hardcoded qiymat YO'Q.
09. Ranglar: oklch()/color-mix()/light-dark() zamonaviy; hex faqat fallback (birinchi deklaratsiya) sifatida.
10. Theme: light default + dark sifatli + system rejimi; FOUC-free (inline head script); `color-scheme` qo'yilgan.
11. Motion: token'li; micro <300ms; sahifa/theme ≤500ms; `prefers-reduced-motion: reduce` — butun tizimda o'chadi.
12. A11y: WCAG 2.2 AA — keyboard to'liq, focus ring aniq, contrast ≥4.5:1, screen reader, skip-link, `aria-live` xatolar.
13. i18n: 4 til (uz-Latn default, uz-Cyrl, ru, en); `lang` atributi; tarjima professional (transliteratsiya emas).
14. Performance: LCP<2.5s, INP<200ms, CLS<0.1, first-load JS<100kB; third-party (socket.io, analytics) faqat kerakli sahifada.
15. Zamonaviy CSS ishlat: container queries, :has(), @layer, native nesting, subgrid — JS'da yechiladigan CSS'da yech.
16. JS minimal: faqat interaktiv qismda; inline style view'larga yozilmaydi (public/css yoki head partial tokenlar).
17. View Transitions: `@supports (view-transition-name: none)` + `prefers-reduced-motion: no-preference` ichida; fallback statik.
18. Xavfsizlik: barcha dinamik matn `esc()` bilan (XSS); CSRF mavjud fetch patch; CSP/header'lar buzilmaydi.
19. Server-authoritative: ball/score/grade/timer server'da; UI faqat ko'rsatadi (auth qoida 8).
20. HEMIS/OAuth: PKCE S256, state/nonce, exact redirect; secret KMS'da, log/frontend'da YO'Q; geofence (UZ IP); student email bo'sh bo'lsa fallback.
21. PII (JSHSHIR, student_id, email, phone): UI'da minimal, yashirin maydonlarda emas; DSAR/consent buzilmaydi.
22. Copy: universitar ton; microcopy aniq; error = sabab + next step; "o'yin"/"gaming" so'zlari faqat Cast kontekstida.
23. Landing/CTA: bitta primary CTA; outcome-headed; credibility bar faqat tekshiriladigan da'volar (WCAG/No-camera/Server-confirmed/Uzbek-first).
24. Form: email+parol NIST (8 MFA / 15 single); show/hide toggle; forgot havola; autocomplete to'g'ri; inline error.
25. Notification: kam, priority, no overload; security xabarlari majburiy.
26. Gamification: progress/feedback ustun; public leaderboard — teacher nazoratida; celebration bir marta ≤900ms.
27. Canvas benchmark: student/teacher'da left-nav + cards + "Yaqinlashayotgan" + "To Do" + progress; SpeedGrader pattern (grading).
28. Har o'zgarish uchun: unit/integration test + grep-testlar (detskiy elementlar qaytmasa) + zarur E2E/a11y (axe).
29. Har prompt oxirida report: STATUS / PROMPT_ID / FILES_CHANGED / TESTS / GREP_CHECKS / RISKS / NEXT_READY.
30. Operator tasdig'isiz git commit/force push/destructive o'zgarish YO'Q; `DONE|PARTIAL|BLOCKED` — bittasi.
```

---

## Har promptdan keyingi majburiy report formati

```text
STATUS: DONE | PARTIAL | BLOCKED
PROMPT_ID:
SUMMARY:
FILES_CHANGED:
TESTS_ADDED:
TEST_COMMANDS_AND_RESULTS:
GREP_CHECKS:  (detskiy elementlar ro'yxati — natija)
A11Y_CHECKS:  (axe 0 critical, keyboard)
I18N_IMPACT:
PERF_IMPACT:  (LCP/INP/CLS/JS kb — o'lchov bo'lsa)
KNOWN_RISKS:
MANUAL_SIGNOFF_REQUIRED:
NEXT_READY:
```

---

## A. IJRO TARTIBI VA YO'SI (bosqichma-bosqich qo'llanma)

### A.1. Session boshlash (operator uchun)
```text
1. Global Master Prompt (UI/UX) kontekstga yuboriladi.
2. Navbatdagi fazaning 1-prompti yuboriladi (masalan: A-00).
3. Agent precondition va mavjud holatni tekshiradi (git status, source o'qiydi).
4. Agent faqat o'sha prompt scope'ida ishlaydi (qo'shimcha feature YO'Q).
5. Agent test + grep-check + report beradi.
6. Operator reportni ko'rib, sign-off beradi → keyingi prompt.
```

### A.2. Har prompt sikli (agent uchun 10 qadam)
```text
01. Global Master Prompt eslatiladi (qisqa: "Master 01-30 qo'llaniladi").
02. Precondition tekshiriladi: oldingi promptning Done sharti bajarilganmi (ledger).
03. Tegishli source o'qiladi: research_ui_audit.md + kerakli qism fayli (style/tech/landing/auth/user/teacher/cast/top_sites/repos).
04. Git holati tekshiriladi: `git status`, current commit; dirty bo'lsa — operatorga xabar.
05. Raqamlangan qadamlar bajariladi (fayl:qator aniq; o'zgarish scope'da).
06. Testlar: unit (vitest), integration (supertest), E2E (playwright) — moslari.
07. GREP-CHECK bajariladi (detskiy elementlar qaytmasligi) — natija yoziladi.
08. A11y (axe 0 critical), i18n, perf spot — tekshiriladi.
09. `implementation-status-uiux.md` ledger yangilanadi (DONE/PARTIAL/BLOCKED + dalil).
10. Report beriladi (majburiy format) + NEXT_READY dalil.
```

### A.3. Checkpoint protokoli (operator sign-off)
```text
- Checkpointlar: A-11, B-13, C-10, D-09, E-09, F-09, G-08, H-07.
- Har checkpoint'da agent bajaradi:
  01. Faza qabul testlari (o'sha checkpoint promptidagi ro'yxat).
  02. Full regression: `npm run typecheck` + `npm test`.
  03. GREP-CHECK jadvali (barcha detektiv elementlar — natija).
  04. A11y: axe 0 (faza sahifalari) + keyboard.
  05. Visual: light/dark screenshot (professional ko'rinish).
  06. Sign-off: operator checklist imzolaydi → faza yopiladi.
- BLOCKED bo'lsa: sabab bartaraf qilinmaguncha keyingi faza ochilmaydi.
```

### A.4. Ledger formati (`implementation-status-uiux.md`)
```text
| Prompt | STATUS | Sana | FILES_CHANGED | TESTS | GREP | NEXT |
|--------|--------|------|---------------|-------|------|------|
| A-00   | DONE   | ...  | (yo'q)        | smoke | 22/21 | A-01 |
| ...    | ...    | ...  | ...           | ...   | ...   | ... |
Har faza oxirida: faza checklist + sign-off + qolgan ishlar.
```

### A.5. QA gate — 3x recheck (operator talabi)
```text
Har faza yakunida agent o'z ishini 3 marta mustaqil tekshiradi:
 1-tekshiruv (tozalik): grep detektiv elementlar 0; hardcode rang/font yo'q.
 2-tekshiruv (ishonchlilik): testlar + axe + keyboard; regression yo'q.
 3-tekshiruv (ko'rinish): light/dark screenshot — "universitar + global" daraja.
Faqat 3 ta tekshiruv ham o'tgach — faza checkpoint'ga chiqariladi.
```

### A.6. Git intizomi
```text
- Agent commit QILMAYDI — faqat commit-ready diff + report.
- Operator commit/force push/destructive o'zgarishni tasdiqlaydi.
- Har prompt rollback rejasi: o'zgarish qaytarilsa — boshqa fazalar sinmaydi (izolyatsiya).
```

### A.7. BLOCKED / PARTIAL handling
```text
- BLOCKED: precondition yoki tashqi manba yetishmaydi (masalan: OTM client, API) — sabab hujjatda, keyingi prompt yopiladi.
- PARTIAL: qisman bajarildi — nima bajarilgani/nimasi qolmaganini aniq yoz; keyingi prompt BLOCKED/PARTIAL zanjirda qolmaydi.
- Operator qarorisiz BLOCKED ni aylanib o'tish YO'Q (qoida: checkpoint BLOCKED → keyingi faza yo'q).
```

---

## B. PROMPT SIFAT STANDARTI (har prompt — 30-40 qator, shu tuzilma)

Har bir prompt (hatto eng oddiy band ham) quyidagi tuzilmaga ega bo'lishi SHART:

```text
01. Global Master Prompt eslatiladi.
02. Ishchi katalog / repo.
03. Source o'qiladi (research fayl).
04. Maqsad (bitta jumla — nima bajariladi).
05. Precondition (oldingi Done sharti).
06..: Raqamlangan bajarish qadamlari (fayl:qator, aniq o'zgarish, 15-25 qadam).
..: Security/data guard.
..: 4 test turi (unit / integration / E2E / security).
..: GREP-CHECK (detskiy elementlar — natija).
..: A11y + i18n + perf spot.
..: Mavjud testlarni ishlatish (regression).
..: Ledger yangilash.
..: Global report formatida qaytarish.
..: Stop condition (nima bo'lsa to'xtaydi).
..: Done condition (nima bo'lsa tugadi).
..: Next readiness (keyingi prompt dalil).
```

**Qoida:** 30 qatordan kam yoki 40 dan ortiq prompt — qabul qilinmaydi (operator audit qiladi: `python audit_uiux.py`).

---

## C. MANBALAR ZANJIRI (har faza qaysi research'dan oziqlanadi)

| Faza | Research manba |
|---|---|
| A (AUDIT-FIX) | `research_ui_audit.md`, `research_ui_auth_deep.md`, `research_ui_landing_deep.md`, `research_ui_tech_deep.md` |
| B (FOUNDATION) | `research_ui_style_deep.md`, `research_ui_tech_deep.md`, `uploads/style.md` |
| C (LANDING) | `research_ui_landing_deep.md`, `research_ui_top_sites_deep.md`, `uploads/style.md` 41 |
| D (AUTH UI) | `research_ui_auth_deep.md`, `research_ui_top_sites_deep.md` |
| E (USER) | `research_ui_user_deep.md`, `research_ui_top_sites_deep.md` (Canvas) |
| F (TEACHER) | `research_ui_teacher_deep.md`, `research_ui_top_sites_deep.md` (SpeedGrader) |
| G (CAST) | `research_ui_cast_deep.md`, `uploads/style.md` 24/27 |
| H (ADMIN/QA) | `research_ui_teacher_deep.md`, `research_ui_auth_deep.md`, `research_ui_style_deep.md`, `research_ui_tech_deep.md` |

---

## D. QOIDALAR
- Ketma-ketlik dependency; checkpoint BLOCKED → keyingi faza yo'q.
- Har faza oxirida `implementation-status-uiux.md` ledger (DONE/PARTIAL/BLOCKED).
- Audit fayllari (`research_ui_*.md`) o'zgartirilmaydi — ular manba.
- Har prompt 30-40 qator (operator audit: `python audit_uiux.py`).
- 3x recheck (QA gate) har faza yakunida majburiy.
- Commit faqat operator tasdig'i bilan.
- Yakuniy H-07'da 2 bosqichli yakun: faqat kerakli qism qoladi; ortiqcha narsa olib tashlanadi.
