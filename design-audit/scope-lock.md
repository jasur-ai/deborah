# Design Scope Lock & Release Governance (STEP 01 / S01.06–S01.08, S01.11)

> Hujjat statusi: ✅ yakunlangan — STEP 01 scope lock qarorlari.

## S01.06 — Final Design Authority

- **Yagona design authority:** `style.md` (root). STEP 11–46 bo'limlar (rang, tipografiya,
  layout, component, motion) oldingi rang draftlaridan **ustun**.
- Amaliy qoida: yuzaga kelgan dizayn qarorida `style.md` ↔ implementation farq bo'lsa,
  `style.md` hal qiladi; implementation tomonda qarama-qarshilik bo'lsa — kod manba emas,
  `style.md` manba.

## S01.07 — Redesign Scope Lock

| Qatlam | Reja | Status |
|--------|------|--------|
| Landing | plan_index (P0) | ✅ Bajarilgan (landing.css/js, partials) |
| Auth | plan_login §4-§5 | ✅ Bajarilgan (login/register/forgot/reset) |
| Teacher Workspace | F4 / STEP 25–27 | ⏳ Kutilmoqda |
| Test Builder | F4 / STEP 27 | ⏳ Kutilmoqda |
| Cast (Director/Projector/Participant) | F5 / STEP 28–32 | ⏳ Backend tayyor, visual kutilmoqda |
| Admin | F6 / STEP 33 | ⏳ Kutilmoqda |
| Error / PWA | F6 / STEP 34 | ⏳ Kutilmoqda |
| Content / localization / RTL | F6 / STEP 35 | ⏳ Kutilmoqda |

**Backend functional redesign alohida scope** — bu master plan UI'ga tegishli, backend
API/logika o'zgarmaydi (faqat keyingi rejalar orqali).

## S01.08 — Feature Flag Strategiyasi

| Flag | Maqsad | Faollash | Rollback |
|------|--------|----------|----------|
| `DESIGN_V4_TOKENS` | F1 token/theme qatlami | STEP 04–10 dan keyin | Eski token alias'lari saqlanadi |
| `DESIGN_V4_LANDING` | Yangi landing | ✅ Faol (landing.css) | `/` eski index'ga qaytish mumkin |
| `DESIGN_V4_CAST` | Cast visual | STEP 28–32 dan keyin | CSS layer swap |
| `DESIGN_V4_ADMIN` | Admin redesign | STEP 33 dan keyin | admin.css eski versiya |

**Token compatibility qoidasi:** eski token alias'lari olib tashlanmaguncha eski viewlar
ishlashda davom etadi (S01.11). Feature flag faqat keyingi release'larda kiritiladi,
ushbu STEP'da env/flag o'zgarishi **yo'q**.

## S01.11 — Rollback Nuqtalari

Har release bosqichida rollback nuqtasi:

| Bosqich | Rollback nuqtasi | Kafolat |
|---------|------------------|---------|
| F0 (01–03) | `git stash` + audit fayllar | Kodga tegilmaydi, faqat audit qo'shiladi |
| F1 (04–10) | Token alias'lar eski qiymatini saqlaydi | Eski viewlar o'zgarishsiz ishlaydi |
| F2 (11–20) | Component CSS alohida fayllarda | Mavjud viewlar yangi faylni bog'lamasa buzilmaydi |
| F3–F6 | Har view alohida commit; eski view backup | Keyingi step'da qaytish mumkin |

**Amaliy:** har STEP commit'lari alohida; `implementation-status.md` da har STEP uchun
qilingan fayllar ro'yxati bor — kerak bo'lsa `git checkout -- <file>` bilan qaytariladi.
